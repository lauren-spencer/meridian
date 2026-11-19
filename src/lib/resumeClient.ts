import type { JobRecord, RoleResume } from '../types/job';

export const DEFAULT_RESUME_ROLE_TYPES = [
  'Product Manager',
  'Product Marketing Manager',
  'Strategy & Operations',
  'Software Engineer',
  'Business Operations',
  'Management Consultant',
];

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read selected file.'));
    reader.readAsDataURL(file);
  });
}

export async function parseResumeFileOnServer(file: File): Promise<string> {
  const base64Data = await fileToBase64(file);
  const res = await fetch('/api/resumes/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type,
      base64Data,
    }),
  });
  const data = (await res.json()) as { rawText?: string; error?: string };
  if (!res.ok || !data.rawText) {
    throw new Error(data.error || `Failed to parse ${file.name}`);
  }
  return data.rawText;
}

export function downloadBase64Docx(base64: string, fileName: string): void {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName.endsWith('.docx') ? fileName : `${fileName}.docx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const ROLE_SYNONYMS: { key: string; patterns: string[] }[] = [
  { key: 'pmm', patterns: ['product marketing', 'pmm', 'gtm', 'go-to-market', 'marketing'] },
  { key: 'pm', patterns: ['product manager', 'product management', ' pm', 'pm ', 'group pm', 'technical pm'] },
  { key: 'strategy', patterns: ['strategy', 'bizops', 'business operations', 'chief of staff', 'corporate development', 'corp dev', 'consulting'] },
  { key: 'eng', patterns: ['engineer', 'developer', 'architect', 'swe', 'backend', 'frontend', 'full stack', 'distributed'] },
  { key: 'data', patterns: ['data scientist', 'analytics', 'machine learning', 'ml ', 'ai '] },
  { key: 'design', patterns: ['designer', 'ux', 'ui ', 'product design'] },
];

/**
 * Picks the closest matching uploaded RoleResume for a target job.
 */
export function selectBestResumeForJob(
  job: Pick<JobRecord, 'title' | 'skills' | 'summary'>,
  resumes: RoleResume[]
): RoleResume | null {
  if (resumes.length === 0) return null;
  if (resumes.length === 1) return resumes[0];

  const haystack = ` ${job.title} ${job.skills.join(' ')} `.toLowerCase();

  let bestResume = resumes[0];
  let bestScore = -1;

  for (const res of resumes) {
    const rt = ` ${res.roleType.toLowerCase()} `;
    let score = 0;

    // Direct token overlap with roleType
    const tokens = res.roleType
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2);
    for (const tok of tokens) {
      if (haystack.includes(tok)) score += 3;
    }

    // Synonym family matching (distinguishes PM vs PMM vs Strategy cleanly)
    for (const fam of ROLE_SYNONYMS) {
      const resumeMatchesFam = fam.patterns.some((p) => rt.includes(p));
      const jobMatchesFam = fam.patterns.some((p) => haystack.includes(p));
      if (resumeMatchesFam && jobMatchesFam) {
        score += fam.key === 'pmm' ? 8 : 6;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestResume = res;
    }
  }

  return bestResume;
}
