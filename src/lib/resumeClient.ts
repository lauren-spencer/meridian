import type {
  CoverLetterSample,
  EmploymentType,
  JobRecord,
  RoleResume,
} from '../types/job';

export const DEFAULT_RESUME_ROLE_TYPES = [
  'Product Manager',
  'Product Marketing Manager',
  'Strategy & Operations',
  'Software Engineer',
  'Business Operations',
  'Management Consultant',
];

export const EMPLOYMENT_TYPES: EmploymentType[] = [
  'Full-time',
  'Internship',
  'Part-time',
  'Contract',
];

export function detectIsMbaRole(title: string): boolean {
  if (!title) return false;
  return /\bmba\b/i.test(title);
}

export function normalizeEmploymentType(
  raw?: string | null,
  title?: string | null,
  extraText?: string | null
): EmploymentType {
  const candidates = [raw ?? '', title ?? '', (extraText ?? '').slice(0, 600)];
  for (const source of candidates) {
    const text = source.toLowerCase();
    if (!text.trim()) continue;
    if (/\b(intern|internship|summer\s+associate|summer\s+analyst|co-?op)\b/i.test(text)) {
      return 'Internship';
    }
    if (/\b(part[\s-]?time)\b/i.test(text)) {
      return 'Part-time';
    }
    if (/\b(contract|contractor|freelance|temporary|temp\b|consultant\s+contract)\b/i.test(text)) {
      return 'Contract';
    }
    if (/\b(full[\s-]?time|fte|permanent)\b/i.test(text)) {
      return 'Full-time';
    }
  }
  return 'Full-time';
}

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

function scoreTrackAgainstText<T extends { roleType: string }>(
  haystack: string,
  items: T[]
): T | null {
  if (items.length === 0) return null;
  if (items.length === 1) return items[0];

  let bestItem = items[0];
  let bestScore = -1;

  for (const item of items) {
    const rt = ` ${item.roleType.toLowerCase()} `;
    let score = 0;

    const tokens = item.roleType
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2);
    for (const tok of tokens) {
      if (haystack.includes(tok)) score += 3;
    }

    for (const fam of ROLE_SYNONYMS) {
      const itemMatchesFam = fam.patterns.some((p) => rt.includes(p));
      const jobMatchesFam = fam.patterns.some((p) => haystack.includes(p));
      if (itemMatchesFam && jobMatchesFam) {
        score += fam.key === 'pmm' ? 8 : 6;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  }

  return bestItem;
}

/**
 * Picks the closest matching uploaded RoleResume for a target job.
 */
export function selectBestResumeForJob(
  job: Pick<JobRecord, 'title' | 'skills' | 'summary'>,
  resumes: RoleResume[]
): RoleResume | null {
  const haystack = ` ${job.title} ${job.skills.join(' ')} `.toLowerCase();
  return scoreTrackAgainstText(haystack, resumes);
}

/**
 * Picks the closest matching uploaded CoverLetterSample for a target job.
 */
export function selectBestCoverLetterSampleForJob(
  job: Pick<JobRecord, 'title' | 'skills' | 'summary'>,
  samples: CoverLetterSample[]
): CoverLetterSample | null {
  const haystack = ` ${job.title} ${job.skills.join(' ')} `.toLowerCase();
  return scoreTrackAgainstText(haystack, samples);
}

export interface CoverLetterRoleRequirement {
  roleType: string;
  matchedSample: CoverLetterSample | null;
}

export interface CoverLetterUnlockStatus {
  unlocked: boolean;
  requiredRoles: CoverLetterRoleRequirement[];
  missingRoles: string[];
  uploadedCount: number;
  requiredCount: number;
}

function roleMatchesSample(targetRole: string, sample: CoverLetterSample): boolean {
  const a = targetRole.trim().toLowerCase();
  const b = sample.roleType.trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;

  const aTokens = a.split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  const bTokens = b.split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  if (aTokens.length > 0 && aTokens.every((t) => b.includes(t))) return true;
  if (bTokens.length > 0 && bTokens.every((t) => a.includes(t))) return true;

  const aPad = ` ${a} `;
  const bPad = ` ${b} `;
  for (const fam of ROLE_SYNONYMS) {
    const aFam = fam.patterns.some((p) => aPad.includes(p));
    const bFam = fam.patterns.some((p) => bPad.includes(p));
    if (aFam && bFam) return true;
  }

  return false;
}

/**
 * Computes whether the Cover Letter Generator is unlocked.
 * Requires an uploaded cover letter sample for every role in the user's target roleTypes
 * (or at least 1 sample if no target roleTypes are configured yet).
 */
export function getCoverLetterUnlockStatus(
  targetRoleTypes: string[],
  samples: CoverLetterSample[]
): CoverLetterUnlockStatus {
  const cleanRoles = Array.from(
    new Set(targetRoleTypes.map((r) => r.trim()).filter(Boolean))
  );

  if (cleanRoles.length === 0) {
    const hasAny = samples.length > 0;
    return {
      unlocked: hasAny,
      requiredRoles: [
        {
          roleType: 'Target Role Sample',
          matchedSample: samples[0] ?? null,
        },
      ],
      missingRoles: hasAny ? [] : ['Target Role Sample'],
      uploadedCount: hasAny ? 1 : 0,
      requiredCount: 1,
    };
  }

  const requiredRoles: CoverLetterRoleRequirement[] = cleanRoles.map((roleType) => {
    const matchedSample =
      samples.find((s) => s.roleType.trim().toLowerCase() === roleType.toLowerCase()) ??
      samples.find((s) => roleMatchesSample(roleType, s)) ??
      null;
    return { roleType, matchedSample };
  });

  const missingRoles = requiredRoles
    .filter((r) => !r.matchedSample)
    .map((r) => r.roleType);

  return {
    unlocked: missingRoles.length === 0,
    requiredRoles,
    missingRoles,
    uploadedCount: requiredRoles.length - missingRoles.length,
    requiredCount: requiredRoles.length,
  };
}

