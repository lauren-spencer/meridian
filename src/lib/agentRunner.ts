import crypto from 'node:crypto';
import { GoogleGenAI, Type } from '@google/genai';
import type {
  AgentRunReport,
  AgentSourceRunResult,
  AtsType,
  DislikeReason,
  JobEnrichmentPatch,
  JobRecord,
  JobSource,
  LocationType,
  TargetCompany,
} from '../types/job.ts';
import { formatIsoDateInTimeZone, formatTimeInTimeZone } from './dateTime.ts';
import { GEMINI_LITE_MODEL, LITE_THINKING_CONFIG } from './geminiModels.ts';

let cachedClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Please check your API key in Settings > Secrets.'
    );
  }
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedClient;
}

interface RawScrapedPosting {
  sourceId: string;
  sourceName: string;
  atsType: AtsType;
  company: string;
  companyDomain: string;
  title: string;
  jobUrl: string;
  urlHash: string;
  location: string;
  isRemoteHint: boolean | null;
  department?: string;
  rawDescription: string;
  publishedAt?: string;
}

export interface IncompleteJobCandidate {
  id: string;
  title: string;
  company: string;
  jobUrl: string;
  salaryLabel: string;
  location: string;
  locationType: LocationType;
  employmentType?: string;
  skills: string[];
  summary: string;
  fullDescription?: string;
  notes?: string;
}

export interface AgentRunInput {
  sources: JobSource[];
  targetCompanies?: TargetCompany[];
  incompleteJobs?: IncompleteJobCandidate[];
  existingHashes: string[];
  searchPrompt: string;
  rules: { text: string; active: boolean }[];
  recentFeedback: {
    jobTitle: string;
    company: string;
    vote: 'up' | 'down';
    reason?: DislikeReason;
  }[];
  maxNewPerRun?: number;
  timeZone?: string;
}

export interface AgentRunOutput {
  newJobs: JobRecord[];
  enrichedJobs: JobEnrichmentPatch[];
  checkedCompanyIds: { id: string; foundCount: number }[];
  runReport: AgentRunReport;
}

const FETCH_TIMEOUT_MS = 10_000;

function canonicalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    const dropParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gh_src', 'lever-source'];
    for (const key of dropParams) {
      u.searchParams.delete(key);
    }
    const normalizedPath = u.pathname.replace(/\/+$/, '') || '/';
    u.pathname = normalizedPath;
    return u.toString().toLowerCase();
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

export function hashCanonicalUrl(rawUrl: string): string {
  return crypto
    .createHash('sha256')
    .update(canonicalizeUrl(rawUrl))
    .digest('hex')
    .slice(0, 16);
}

function stripHtmlToText(html: string, maxLength = 3500): string {
  const decoded = html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  const cleaned = decoded
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<\/(p|div|li|h1|h2|h3|h4|tr|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned;
}

function htmlToCompactMarkdown(html: string, baseUrl: string, maxLength = 14000): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ');

  // Preserve anchor links with resolved absolute URLs so Gemini can extract job URLs
  text = text.replace(
    /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_match, href: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!label) return '';
      try {
        const resolved = new URL(href, baseUrl).toString();
        return `[${label}](${resolved})`;
      } catch {
        return label;
      }
    }
  );

  text = text
    .replace(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi, '\n## $1\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
    .replace(/<\/(p|div|section|article|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function extractDomain(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return 'careers.site';
  }
}

function titleCaseSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'MeridianJobAgent/1.0 (+https://meridian.local)',
        Accept: 'application/json, text/html, application/xml;q=0.9, */*;q=0.8',
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonFromModelText<T>(rawText: string, fallback: T): T {
  const trimmed = rawText.trim();
  if (!trimmed) return fallback;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const startArr = candidate.indexOf('[');
    const endArr = candidate.lastIndexOf(']');
    if (startArr !== -1 && endArr > startArr) {
      try {
        return JSON.parse(candidate.slice(startArr, endArr + 1)) as T;
      } catch {
        // continue
      }
    }
    const startObj = candidate.indexOf('{');
    const endObj = candidate.lastIndexOf('}');
    if (startObj !== -1 && endObj > startObj) {
      try {
        return JSON.parse(candidate.slice(startObj, endObj + 1)) as T;
      } catch {
        // continue
      }
    }
    return fallback;
  }
}

function isPlaceholderTitle(title?: string): boolean {
  const t = (title ?? '').trim().toLowerCase();
  return !t || t === 'untitled role' || t === 'untitled' || t === 'tbd' || t === 'n/a';
}

function isPlaceholderSalary(salary?: string): boolean {
  const s = (salary ?? '').trim().toLowerCase();
  return !s || s === 'not listed' || s === 'not disclosed' || s === 'unspecified' || s === 'n/a' || s === 'tbd';
}

function isPlaceholderLocation(loc?: string): boolean {
  const l = (loc ?? '').trim().toLowerCase();
  return !l || l === 'unspecified' || l === 'not listed' || l === 'unknown' || l === 'n/a' || l === 'tbd';
}

function isPlaceholderSummary(summary?: string): boolean {
  const s = (summary ?? '').trim();
  return s.length < 40 || /^imported from /i.test(s);
}

function isPlaceholderDescription(desc?: string): boolean {
  return (desc ?? '').trim().length < 300;
}

export function isPlaceholderJobUrl(url?: string): boolean {
  const trimmed = (url ?? '').trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return true;
  if (/\.example\b|mail\.google\.com|slack\.com\/archives/i.test(trimmed)) return true;
  return false;
}

export function detectIsMbaRoleServer(title?: string): boolean {
  if (!title) return false;
  return /\bmba\b/i.test(title);
}

export function normalizeEmploymentTypeServer(
  raw?: string | null,
  title?: string | null,
  extraText?: string | null
): 'Full-time' | 'Internship' | 'Part-time' | 'Contract' {
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

function detectAtsFromCareersUrl(url: string): AtsType {
  const lower = url.toLowerCase();
  if (lower.includes('greenhouse.io')) return 'Greenhouse';
  if (lower.includes('lever.co')) return 'Lever';
  if (lower.includes('ashbyhq.com')) return 'Ashby';
  if (lower.endsWith('.xml') || lower.includes('rss') || lower.includes('feed')) return 'RSS Feed';
  return 'Custom Markdown';
}

async function probeTargetCompanyAts(company: TargetCompany): Promise<RawScrapedPosting[]> {
  if (company.careersUrl && /^https?:\/\//i.test(company.careersUrl.trim())) {
    const atsType = detectAtsFromCareersUrl(company.careersUrl.trim());
    const syntheticSource: JobSource = {
      id: company.id,
      name: `Target · ${company.name}`,
      url: company.careersUrl.trim(),
      atsType,
      cadenceHours: 24,
      enabled: true,
      lastCheckedAt: '',
      totalFound: 0,
      lastNewCount: 0,
    };
    const results = await fetchBySourceAdapter(syntheticSource);
    return results.map((r) => ({
      ...r,
      company: company.name,
      atsType: 'Target Company' as const,
      sourceId: company.id,
      sourceName: `Target · ${company.name}`,
    }));
  }

  // Fast probe of Greenhouse / Ashby / Lever public boards by normalized slug
  const slug = company.name
    .toLowerCase()
    .replace(/\b(inc|llc|corp|corporation|co|ltd|technologies|labs|hq)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
  if (!slug || slug.length < 2) return [];

  const probes: { url: string; atsType: AtsType }[] = [
    { url: `https://boards.greenhouse.io/${slug}`, atsType: 'Greenhouse' },
    { url: `https://jobs.ashbyhq.com/${slug}`, atsType: 'Ashby' },
    { url: `https://jobs.lever.co/${slug}`, atsType: 'Lever' },
  ];

  for (const probe of probes) {
    try {
      const endpoint =
        probe.atsType === 'Greenhouse'
          ? `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`
          : probe.atsType === 'Ashby'
          ? `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`
          : `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;

      const res = await fetchWithTimeout(endpoint, 3500);
      if (!res.ok) continue;

      const syntheticSource: JobSource = {
        id: company.id,
        name: `Target · ${company.name}`,
        url: probe.url,
        atsType: probe.atsType,
        cadenceHours: 24,
        enabled: true,
        lastCheckedAt: '',
        totalFound: 0,
        lastNewCount: 0,
      };
      const items = await fetchBySourceAdapter(syntheticSource);
      if (items.length > 0) {
        return items.map((r) => ({
          ...r,
          company: company.name,
          atsType: 'Target Company' as const,
          sourceId: company.id,
          sourceName: `Target · ${company.name}`,
        }));
      }
    } catch {
      // Try next public board
    }
  }
  return [];
}

async function searchTargetCompaniesWithGemini(
  companies: TargetCompany[],
  searchPrompt: string,
  rules: { text: string; active: boolean }[]
): Promise<RawScrapedPosting[]> {
  if (companies.length === 0) return [];
  const ai = getGeminiClient();
  const activeRules = rules
    .filter((r) => r.active)
    .map((r) => `- ${r.text}`)
    .join('\n');

  const companyList = companies
    .slice(0, 10)
    .map((c) => `- ${c.name}${c.careersUrl ? ` (${c.careersUrl})` : ''}${c.notes ? ` — ${c.notes}` : ''}`)
    .join('\n');

  const prompt = `Search the live web for currently open job postings at these target companies that match the candidate's target criteria.

TARGET COMPANIES TO CHECK:
${companyList}

CANDIDATE CRITERIA:
${searchPrompt || 'Relevant open roles matching the user profile.'}

ACTIVE FILTER RULES:
${activeRules || '- None'}

INSTRUCTIONS:
- Only include REAL, currently open job postings you find via web search at the listed target companies.
- Do NOT invent fake postings or placeholder URLs. If a company has no matching open roles right now, omit it.
- Return up to 8 best-matching open roles across these companies.
- Respond ONLY with a valid JSON array (no extra commentary) where each item has:
  {
    "company": "Exact company name from the list",
    "title": "Exact job title",
    "jobUrl": "Direct careers/ATS/posting URL",
    "location": "City, State or Remote",
    "isRemote": true or false,
    "salaryLabel": "Compensation range if listed, else Not listed",
    "description": "Concise 2-4 sentence summary + key requirements and compensation if found"
  }`;

  const response = await ai.models.generateContent({
    model: GEMINI_LITE_MODEL,
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      thinkingConfig: LITE_THINKING_CONFIG,
    },
  });

  const found = parseJsonFromModelText<
    {
      company?: string;
      title?: string;
      jobUrl?: string;
      location?: string;
      isRemote?: boolean;
      salaryLabel?: string;
      description?: string;
    }[]
  >(response.text ?? '[]', []);

  const byLowerName = new Map(companies.map((c) => [c.name.toLowerCase().trim(), c]));
  const postings: RawScrapedPosting[] = [];

  for (const item of found) {
    if (!item?.title || !item?.company) continue;
    if (isPlaceholderTitle(item.title)) continue;
    const rawUrl = (item.jobUrl ?? '').trim();
    if (!/^https?:\/\//i.test(rawUrl) || /\.example\b/i.test(rawUrl)) continue;

    const matchedCompany =
      byLowerName.get(item.company.toLowerCase().trim()) ||
      companies.find(
        (c) =>
          item.company!.toLowerCase().includes(c.name.toLowerCase()) ||
          c.name.toLowerCase().includes(item.company!.toLowerCase())
      );

    const companyName = matchedCompany?.name || item.company.trim();
    const sourceId = matchedCompany?.id || `tc-${companyName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const loc = item.location?.trim() || (item.isRemote ? 'Remote' : 'Unspecified');
    const compPrefix =
      item.salaryLabel && !isPlaceholderSalary(item.salaryLabel)
        ? `Compensation: ${item.salaryLabel}\n`
        : '';

    postings.push({
      sourceId,
      sourceName: `Target · ${companyName}`,
      atsType: 'Target Company',
      company: companyName,
      companyDomain: extractDomain(rawUrl),
      title: item.title.trim(),
      jobUrl: rawUrl,
      urlHash: hashCanonicalUrl(rawUrl),
      location: loc,
      isRemoteHint: typeof item.isRemote === 'boolean' ? item.isRemote : /remote/i.test(loc) ? true : null,
      rawDescription: `${compPrefix}${item.description?.trim() || item.title}`.trim(),
    });
  }

  return postings;
}

export async function enrichIncompleteJobs(
  incompleteJobs: IncompleteJobCandidate[],
  searchPrompt: string,
  rules: { text: string; active: boolean }[]
): Promise<JobEnrichmentPatch[]> {
  if (incompleteJobs.length === 0) return [];

  // Select up to 12 active roles that have missing/placeholder fields, prioritizing missing URLs & JDs
  const eligible = incompleteJobs.filter(
    (j) =>
      isPlaceholderTitle(j.title) ||
      isPlaceholderJobUrl(j.jobUrl) ||
      isPlaceholderSalary(j.salaryLabel) ||
      isPlaceholderLocation(j.location) ||
      isPlaceholderSummary(j.summary) ||
      isPlaceholderDescription(j.fullDescription) ||
      !j.employmentType ||
      !j.skills ||
      j.skills.length === 0
  );

  eligible.sort((a, b) => {
    const score = (j: IncompleteJobCandidate) =>
      (isPlaceholderJobUrl(j.jobUrl) ? 4 : 0) +
      (isPlaceholderDescription(j.fullDescription) ? 3 : 0) +
      (isPlaceholderTitle(j.title) ? 2 : 0) +
      (isPlaceholderSalary(j.salaryLabel) ? 1 : 0) +
      (!j.employmentType ? 1 : 0);
    return score(b) - score(a);
  });

  const candidates = eligible.slice(0, 12);
  if (candidates.length === 0) return [];

  // Try lightweight page fetch for candidates that already have a real public posting URL
  const fetchedSnippets = new Map<string, string>();
  await Promise.all(
    candidates.map(async (job) => {
      const url = (job.jobUrl ?? '').trim();
      if (isPlaceholderJobUrl(url)) {
        return;
      }
      try {
        const res = await fetchWithTimeout(url, 5000);
        if (!res.ok) return;
        const html = await res.text();
        const text = stripHtmlToText(html, 5000);
        if (text.length >= 120) {
          fetchedSnippets.set(job.id, text);
        }
      } catch {
        // Fall back to Google Search grounding
      }
    })
  );

  const ai = getGeminiClient();
  const activeRules = rules
    .filter((r) => r.active)
    .map((r) => `- ${r.text}`)
    .join('\n');

  const payload = candidates.map((j) => ({
    id: j.id,
    company: j.company,
    currentTitle: j.title,
    jobUrl: isPlaceholderJobUrl(j.jobUrl) ? '' : j.jobUrl,
    currentSalaryLabel: j.salaryLabel,
    currentLocation: j.location,
    currentLocationType: j.locationType,
    currentEmploymentType: j.employmentType ?? '',
    notes: (j.notes ?? '').slice(0, 200),
    missingFields: [
      isPlaceholderTitle(j.title) ? 'title' : null,
      isPlaceholderJobUrl(j.jobUrl) ? 'jobUrl' : null,
      isPlaceholderSalary(j.salaryLabel) ? 'salary' : null,
      isPlaceholderLocation(j.location) ? 'location' : null,
      !j.employmentType ? 'employmentType' : null,
      isPlaceholderSummary(j.summary) ? 'summary' : null,
      isPlaceholderDescription(j.fullDescription) ? 'fullDescription' : null,
      (!j.skills || j.skills.length === 0) ? 'skills' : null,
    ].filter(Boolean),
    fetchedPageExcerpt: fetchedSnippets.get(j.id)?.slice(0, 3600) ?? '',
  }));

  const prompt = `You are enriching incomplete job tracker records (from email alerts, Slack, WhatsApp, CSV imports, or job boards) using the fetched job page excerpts AND live Google Search.

CANDIDATE TARGET CRITERIA:
${searchPrompt || 'Roles matching user preferences.'}

ACTIVE RULES:
${activeRules || '- None'}

INSTRUCTIONS:
- For each job below, use fetchedPageExcerpt AND live Google Search to find EVERY missing/placeholder field:
  * If jobUrl is missing/empty, search the web for the canonical public job posting URL (company careers page, Greenhouse, Lever, Ashby, Workday, LinkedIn, etc.).
  * If fullDescription is missing/short, pull the complete, detailed multi-section job description (About the Role, Key Responsibilities, Qualifications, Compensation & Benefits) from the posting page or search results.
  * If employmentType is missing, determine strictly one of: "Full-time", "Internship", "Part-time", or "Contract".
  * If currentTitle is "Untitled Role", look for an open matching role at that company matching CANDIDATE TARGET CRITERIA.
  * If salary is "Not listed", look up the listed compensation range on the posting or company career board.
  * Fill missing location, work mode (Remote/Hybrid/Onsite), skills (3-5), and concise summary.
- Use ONLY verified facts from fetchedPageExcerpt or live Google Search results. Do NOT fabricate fake salaries or fake URLs. If a field genuinely cannot be found, leave it null.
- Respond ONLY with a valid JSON array (no extra text) of objects:
  {
    "id": "exact job id",
    "title": "string or null (only if missing/Untitled Role and a real role title was found)",
    "jobUrl": "string or null (canonical public https:// posting URL if missing)",
    "salaryMin": integer USD base or null,
    "salaryMax": integer USD base or null,
    "salaryLabel": "e.g. $180k – $215k or null if not found",
    "location": "City, State or Remote or null",
    "locationType": "Remote" | "Hybrid" | "Onsite" | null,
    "employmentType": "Full-time" | "Internship" | "Part-time" | "Contract" | null,
    "skills": ["3-5 skills"] or [],
    "summary": "1-2 concise sentences or null",
    "fullDescription": "Complete multi-section job description (About, Responsibilities, Qualifications, Comp) or null",
    "matchScore": integer 0-100 or null,
    "matchReason": "1 crisp sentence or null"
  }

INCOMPLETE JOBS TO ENRICH:
${JSON.stringify(payload)}`;

  const response = await ai.models.generateContent({
    model: GEMINI_LITE_MODEL,
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      thinkingConfig: LITE_THINKING_CONFIG,
    },
  });

  const rawPatches = parseJsonFromModelText<
    {
      id?: string;
      title?: string | null;
      jobUrl?: string | null;
      salaryMin?: number | null;
      salaryMax?: number | null;
      salaryLabel?: string | null;
      location?: string | null;
      locationType?: string | null;
      employmentType?: string | null;
      skills?: string[];
      summary?: string | null;
      fullDescription?: string | null;
      matchScore?: number | null;
      matchReason?: string | null;
    }[]
  >(response.text ?? '[]', []);

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const patches: JobEnrichmentPatch[] = [];

  for (const item of rawPatches) {
    if (!item?.id) continue;
    const orig = byId.get(item.id);
    if (!orig) continue;

    const patch: JobEnrichmentPatch = { id: orig.id };
    let changed = false;

    if (isPlaceholderTitle(orig.title) && item.title && !isPlaceholderTitle(item.title)) {
      patch.title = item.title.trim().slice(0, 180);
      patch.isMbaRole = detectIsMbaRoleServer(patch.title);
      changed = true;
    }
    if (
      isPlaceholderJobUrl(orig.jobUrl) &&
      item.jobUrl &&
      !isPlaceholderJobUrl(item.jobUrl)
    ) {
      patch.jobUrl = item.jobUrl.trim().slice(0, 950);
      patch.companyDomain = extractDomain(patch.jobUrl);
      changed = true;
    }
    if (isPlaceholderSalary(orig.salaryLabel) && item.salaryLabel && !isPlaceholderSalary(item.salaryLabel)) {
      patch.salaryLabel = item.salaryLabel.trim().slice(0, 75);
      if (typeof item.salaryMin === 'number' && Number.isFinite(item.salaryMin) && item.salaryMin > 0) {
        patch.salaryMin = Math.round(item.salaryMin);
      }
      if (typeof item.salaryMax === 'number' && Number.isFinite(item.salaryMax) && item.salaryMax > 0) {
        patch.salaryMax = Math.round(item.salaryMax);
      }
      changed = true;
    }
    if (isPlaceholderLocation(orig.location) && item.location && !isPlaceholderLocation(item.location)) {
      patch.location = item.location.trim().slice(0, 140);
      changed = true;
    }
    if (
      item.locationType &&
      (item.locationType === 'Remote' || item.locationType === 'Hybrid' || item.locationType === 'Onsite') &&
      (isPlaceholderLocation(orig.location) || orig.locationType !== item.locationType)
    ) {
      patch.locationType = item.locationType;
      changed = true;
    }
    if (!orig.employmentType && (item.employmentType || item.title || item.fullDescription)) {
      patch.employmentType = normalizeEmploymentTypeServer(
        item.employmentType,
        patch.title ?? orig.title,
        item.fullDescription ?? fetchedSnippets.get(orig.id) ?? orig.summary
      );
      changed = true;
    }
    if ((!orig.skills || orig.skills.length === 0) && Array.isArray(item.skills) && item.skills.length > 0) {
      patch.skills = item.skills.map((s) => String(s).trim()).filter(Boolean).slice(0, 6);
      if (patch.skills.length > 0) changed = true;
    }
    if (isPlaceholderSummary(orig.summary) && item.summary && item.summary.trim().length >= 30) {
      patch.summary = item.summary.trim().slice(0, 1800);
      changed = true;
    }
    if (isPlaceholderDescription(orig.fullDescription)) {
      const candidateDesc = item.fullDescription?.trim() || '';
      const fetchedRaw = fetchedSnippets.get(orig.id)?.trim() || '';
      if (candidateDesc.length >= 160) {
        patch.fullDescription = candidateDesc.slice(0, 12000);
        changed = true;
      } else if (fetchedRaw.length >= 240) {
        patch.fullDescription = fetchedRaw.slice(0, 12000);
        changed = true;
      }
    }
    if (changed && typeof item.matchScore === 'number' && Number.isFinite(item.matchScore)) {
      patch.matchScore = Math.min(100, Math.max(0, Math.round(item.matchScore)));
      if (item.matchReason && item.matchReason.trim()) {
        patch.matchReason = item.matchReason.trim().slice(0, 500);
      }
    }

    if (changed) {
      patches.push(patch);
    }
  }

  // If we newly discovered a real jobUrl for any patch that still lacks a full JD, fetch the posting page
  await Promise.all(
    patches.map(async (patch) => {
      if (
        patch.jobUrl &&
        !isPlaceholderJobUrl(patch.jobUrl) &&
        (!patch.fullDescription || patch.fullDescription.length < 300)
      ) {
        try {
          const res = await fetchWithTimeout(patch.jobUrl, 4500);
          if (!res.ok) return;
          const html = await res.text();
          const text = stripHtmlToText(html, 8000);
          if (text.length > (patch.fullDescription?.length ?? 0) && text.length >= 240) {
            patch.fullDescription = text;
          }
        } catch {
          // Non-blocking
        }
      }
    })
  );

  return patches;
}

// ---- Adapter 1: Greenhouse Public JSON API ----
function parseGreenhouseToken(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (u.hostname.includes('boards-api.greenhouse.io')) {
      const idx = parts.indexOf('boards');
      return idx >= 0 ? parts[idx + 1] ?? null : null;
    }
    if (u.hostname.includes('greenhouse.io')) {
      return parts[0] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchGreenhouseSource(source: JobSource): Promise<RawScrapedPosting[]> {
  const token = parseGreenhouseToken(source.url);
  if (!token) {
    throw new Error(`Could not detect Greenhouse board token from URL: ${source.url}`);
  }

  const endpoint = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;
  const res = await fetchWithTimeout(endpoint);
  if (!res.ok) {
    throw new Error(`Greenhouse API returned HTTP ${res.status} for board "${token}"`);
  }

  const data = (await res.json()) as {
    jobs?: {
      id: number;
      title: string;
      absolute_url: string;
      location?: { name?: string };
      content?: string;
      updated_at?: string;
      departments?: { name: string }[];
    }[];
  };

  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const company = source.name.replace(/\s*(Careers|Jobs|Greenhouse|Board)$/i, '').trim() || titleCaseSlug(token);

  return jobs
    .filter((j) => j.title && j.absolute_url)
    .map((j) => {
      const location = j.location?.name?.trim() || 'Unspecified';
      return {
        sourceId: source.id,
        sourceName: source.name,
        atsType: 'Greenhouse' as const,
        company,
        companyDomain: extractDomain(j.absolute_url),
        title: j.title.trim(),
        jobUrl: j.absolute_url,
        urlHash: hashCanonicalUrl(j.absolute_url),
        location,
        isRemoteHint: /remote/i.test(location) ? true : null,
        department: j.departments?.[0]?.name,
        rawDescription: j.content ? stripHtmlToText(j.content, 10000) : j.title,
        publishedAt: j.updated_at,
      };
    });
}

// ---- Adapter 2: Ashby Public JSON API ----
function parseAshbyBoard(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (u.hostname.includes('api.ashbyhq.com')) {
      const idx = parts.indexOf('job-board');
      return idx >= 0 ? parts[idx + 1] ?? null : null;
    }
    if (u.hostname.includes('ashbyhq.com')) {
      return parts[0] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchAshbySource(source: JobSource): Promise<RawScrapedPosting[]> {
  const board = parseAshbyBoard(source.url);
  if (!board) {
    throw new Error(`Could not detect Ashby board slug from URL: ${source.url}`);
  }

  const endpoint = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`;
  const res = await fetchWithTimeout(endpoint);
  if (!res.ok) {
    throw new Error(`Ashby API returned HTTP ${res.status} for board "${board}"`);
  }

  const data = (await res.json()) as {
    jobs?: {
      id: string;
      title: string;
      jobUrl?: string;
      applyUrl?: string;
      location?: string;
      isRemote?: boolean;
      workplaceType?: string;
      department?: string;
      team?: string;
      descriptionPlain?: string;
      descriptionHtml?: string;
      compensation?: { compensationTierSummary?: string };
      publishedAt?: string;
    }[];
  };

  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const company = source.name.replace(/\s*(Careers|Jobs|Ashby|Board)$/i, '').trim() || titleCaseSlug(board);

  return jobs
    .filter((j) => j.title && (j.jobUrl || j.applyUrl))
    .map((j) => {
      const jobUrl = j.jobUrl || j.applyUrl || source.url;
      const compText = j.compensation?.compensationTierSummary
        ? `Compensation: ${j.compensation.compensationTierSummary}\n`
        : '';
      const desc =
        j.descriptionPlain?.slice(0, 10000) ||
        (j.descriptionHtml ? stripHtmlToText(j.descriptionHtml, 10000) : j.title);

      return {
        sourceId: source.id,
        sourceName: source.name,
        atsType: 'Ashby' as const,
        company,
        companyDomain: extractDomain(jobUrl),
        title: j.title.trim(),
        jobUrl,
        urlHash: hashCanonicalUrl(jobUrl),
        location: j.location?.trim() || (j.isRemote ? 'Remote' : 'Unspecified'),
        isRemoteHint:
          typeof j.isRemote === 'boolean'
            ? j.isRemote
            : j.workplaceType === 'Remote'
              ? true
              : null,
        department: j.department || j.team,
        rawDescription: `${compText}${desc}`.trim(),
        publishedAt: j.publishedAt,
      };
    });
}

// ---- Adapter 3: Lever Public JSON API ----
function parseLeverCompany(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (u.hostname.includes('api.lever.co')) {
      const idx = parts.indexOf('postings');
      return idx >= 0 ? parts[idx + 1] ?? null : null;
    }
    if (u.hostname.includes('lever.co')) {
      return parts[0] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchLeverSource(source: JobSource): Promise<RawScrapedPosting[]> {
  const companySlug = parseLeverCompany(source.url);
  if (!companySlug) {
    throw new Error(`Could not detect Lever company slug from URL: ${source.url}`);
  }

  const endpoint = `https://api.lever.co/v0/postings/${encodeURIComponent(companySlug)}?mode=json`;
  const res = await fetchWithTimeout(endpoint);
  if (!res.ok) {
    throw new Error(`Lever API returned HTTP ${res.status} for "${companySlug}"`);
  }

  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error(`Lever board "${companySlug}" returned no job postings.`);
  }

  const company = source.name.replace(/\s*(Careers|Jobs|Lever|Board)$/i, '').trim() || titleCaseSlug(companySlug);

  return (
    data as {
      id: string;
      text: string;
      hostedUrl?: string;
      applyUrl?: string;
      workplaceType?: string;
      categories?: { location?: string; team?: string; department?: string };
      descriptionPlain?: string;
      additionalPlain?: string;
      createdAt?: number;
    }[]
  )
    .filter((j) => j.text && (j.hostedUrl || j.applyUrl))
    .map((j) => {
      const jobUrl = j.hostedUrl || j.applyUrl || source.url;
      const location = j.categories?.location?.trim() || 'Unspecified';
      const combinedDesc = [j.descriptionPlain, j.additionalPlain]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 10000);

      return {
        sourceId: source.id,
        sourceName: source.name,
        atsType: 'Lever' as const,
        company,
        companyDomain: extractDomain(jobUrl),
        title: j.text.trim(),
        jobUrl,
        urlHash: hashCanonicalUrl(jobUrl),
        location,
        isRemoteHint:
          j.workplaceType === 'remote' || /remote/i.test(location) ? true : null,
        department: j.categories?.department || j.categories?.team,
        rawDescription: combinedDesc || j.text,
        publishedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
      };
    });
}

// ---- Adapter 4: RSS / Atom Feed ----
async function fetchRssSource(source: JobSource): Promise<RawScrapedPosting[]> {
  const res = await fetchWithTimeout(source.url);
  if (!res.ok) {
    throw new Error(`RSS feed returned HTTP ${res.status}`);
  }
  const xml = await res.text();
  const items = xml.match(/<(item|entry)[\s\S]*?<\/\1>/gi) ?? [];
  const company = source.name.replace(/\s*(RSS|Feed|Careers|Jobs)$/i, '').trim() || extractDomain(source.url);

  const parsed: RawScrapedPosting[] = [];
  for (const block of items.slice(0, 40)) {
    const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const linkMatch =
      block.match(/<link[^>]*href=["']([^"']+)["']/i) ||
      block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const descMatch =
      block.match(/<description[^>]*>([\s\S]*?)<\/description>/i) ||
      block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);

    const title = titleMatch?.[1]
      ?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, '')
      .trim();
    const jobUrl = linkMatch?.[1]
      ?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .trim();

    if (!title || !jobUrl) continue;
    const desc = descMatch?.[1]
      ? stripHtmlToText(descMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'), 1500)
      : title;

    parsed.push({
      sourceId: source.id,
      sourceName: source.name,
      atsType: 'RSS Feed',
      company,
      companyDomain: extractDomain(jobUrl),
      title,
      jobUrl,
      urlHash: hashCanonicalUrl(jobUrl),
      location: /remote/i.test(`${title} ${desc}`) ? 'Remote' : 'Unspecified',
      isRemoteHint: /remote/i.test(`${title} ${desc}`) ? true : null,
      rawDescription: desc,
    });
  }

  return parsed;
}

// ---- Adapter 5: Generic Career Page Markdown Scraper (HTML -> Markdown -> Gemini Extractor) ----
async function fetchCustomMarkdownSource(source: JobSource): Promise<RawScrapedPosting[]> {
  const res = await fetchWithTimeout(source.url);
  if (!res.ok) {
    throw new Error(`Career page returned HTTP ${res.status}`);
  }
  const html = await res.text();
  const markdown = htmlToCompactMarkdown(html, source.url, 14000);
  if (markdown.length < 80) {
    throw new Error('Career page returned very little readable text (may require JS rendering).');
  }

  const ai = getGeminiClient();
  const extractionSchema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        company: { type: Type.STRING },
        jobUrl: { type: Type.STRING },
        location: { type: Type.STRING },
        snippet: { type: Type.STRING },
      },
      required: ['title', 'jobUrl'],
    },
  };

  const response = await ai.models.generateContent({
    model: GEMINI_LITE_MODEL,
    contents: `Extract up to 15 open job postings from this converted Markdown career page (${source.url}). Only include real job listings present on the page, resolving full URLs. If none are found, return an empty array.\n\n${markdown}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: extractionSchema,
      thinkingConfig: LITE_THINKING_CONFIG,
    },
  });

  const extracted = JSON.parse((response.text ?? '[]').trim()) as {
    title: string;
    company?: string;
    jobUrl: string;
    location?: string;
    snippet?: string;
  }[];

  const fallbackCompany =
    source.name.replace(/\s*(Careers|Jobs)$/i, '').trim() || extractDomain(source.url);

  return extracted
    .filter((item) => item.title && item.jobUrl)
    .map((item) => {
      let resolvedUrl = item.jobUrl;
      try {
        resolvedUrl = new URL(item.jobUrl, source.url).toString();
      } catch {
        resolvedUrl = source.url;
      }
      const loc = item.location?.trim() || 'Unspecified';
      return {
        sourceId: source.id,
        sourceName: source.name,
        atsType: 'Custom Markdown' as const,
        company: item.company?.trim() || fallbackCompany,
        companyDomain: extractDomain(resolvedUrl),
        title: item.title.trim(),
        jobUrl: resolvedUrl,
        urlHash: hashCanonicalUrl(resolvedUrl),
        location: loc,
        isRemoteHint: /remote/i.test(loc) ? true : null,
        rawDescription: item.snippet?.trim() || item.title,
      };
    });
}

async function fetchBySourceAdapter(source: JobSource): Promise<RawScrapedPosting[]> {
  switch (source.atsType) {
    case 'Greenhouse':
      return fetchGreenhouseSource(source);
    case 'Ashby':
      return fetchAshbySource(source);
    case 'Lever':
      return fetchLeverSource(source);
    case 'RSS Feed':
      return fetchRssSource(source);
    case 'Custom Markdown':
    default:
      return fetchCustomMarkdownSource(source);
  }
}

// Lightweight local pre-filter before LLM scoring so 300-job ATS boards only send top relevant candidates
function preRankCandidates(
  candidates: RawScrapedPosting[],
  searchPrompt: string,
  maxCandidates: number
): RawScrapedPosting[] {
  const stopWords = new Set([
    'with', 'from', 'that', 'this', 'have', 'your', 'only', 'more', 'role', 'roles',
    'work', 'working', 'primarily', 'minimum', 'base', 'companies', 'company', 'into',
    'over', 'prefer', 'preferred', 'looking', 'want', 'need', 'must', 'like', 'none',
  ]);

  const tokens = Array.from(
    new Set(
      searchPrompt
        .toLowerCase()
        .replace(/[^a-z0-9+#\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 2 && !stopWords.has(w))
    )
  );

  const scored = candidates.map((c) => {
    const titleLower = c.title.toLowerCase();
    const bodyLower = `${c.title} ${c.location} ${c.department ?? ''} ${c.rawDescription.slice(0, 800)}`.toLowerCase();
    let score = 0;

    for (const token of tokens) {
      if (titleLower.includes(token)) score += 4;
      else if (bodyLower.includes(token)) score += 1;
    }

    if (c.isRemoteHint && /remote/i.test(searchPrompt)) {
      score += 3;
    }

    // Mild boost for engineering / software roles if prompt mentions engineer
    if (/engineer/i.test(searchPrompt) && /engineer|architect|systems|backend|infrastructure|platform|fullstack/i.test(titleLower)) {
      score += 4;
    }

    return { candidate: c, preScore: score };
  });

  scored.sort((a, b) => b.preScore - a.preScore);

  // Balance across sources when multiple sources have strong unseen candidates
  const selected: RawScrapedPosting[] = [];
  const perSourceCount = new Map<string, number>();
  const perSourceCap = Math.max(2, Math.ceil(maxCandidates / 2));

  for (const item of scored) {
    if (selected.length >= maxCandidates) break;
    const count = perSourceCount.get(item.candidate.sourceId) ?? 0;
    if (count >= perSourceCap) continue;
    selected.push(item.candidate);
    perSourceCount.set(item.candidate.sourceId, count + 1);
  }

  // Fill remaining slots if any source had fewer postings
  if (selected.length < maxCandidates) {
    const pickedHashes = new Set(selected.map((s) => s.urlHash));
    for (const item of scored) {
      if (selected.length >= maxCandidates) break;
      if (!pickedHashes.has(item.candidate.urlHash)) {
        selected.push(item.candidate);
        pickedHashes.add(item.candidate.urlHash);
      }
    }
  }

  return selected;
}

const SCORING_RESPONSE_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      urlHash: { type: Type.STRING },
      matchScore: { type: Type.INTEGER },
      matchReason: { type: Type.STRING },
      salaryMin: { type: Type.INTEGER, nullable: true },
      salaryMax: { type: Type.INTEGER, nullable: true },
      salaryLabel: { type: Type.STRING },
      location: { type: Type.STRING },
      locationType: { type: Type.STRING },
      employmentType: { type: Type.STRING },
      deadlineAt: { type: Type.STRING, nullable: true },
      skills: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
      summary: { type: Type.STRING },
    },
    required: [
      'urlHash',
      'matchScore',
      'matchReason',
      'salaryLabel',
      'location',
      'locationType',
      'employmentType',
      'skills',
      'summary',
    ],
  },
};

interface GeminiScoredItem {
  urlHash: string;
  matchScore: number;
  matchReason: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryLabel: string;
  location: string;
  locationType: string;
  employmentType: string;
  deadlineAt: string | null;
  skills: string[];
  summary: string;
}

async function scoreCandidatesWithGemini(
  candidates: RawScrapedPosting[],
  input: AgentRunInput
): Promise<Map<string, GeminiScoredItem>> {
  if (candidates.length === 0) return new Map();

  const ai = getGeminiClient();

  const activeRules = input.rules
    .filter((r) => r.active)
    .map((r) => `- ${r.text}`)
    .join('\n');

  const likes = input.recentFeedback
    .filter((f) => f.vote === 'up')
    .slice(0, 8)
    .map((f) => `${f.jobTitle} @ ${f.company}`)
    .join('; ');

  const dislikes = input.recentFeedback
    .filter((f) => f.vote === 'down')
    .slice(0, 8)
    .map((f) => `${f.jobTitle} @ ${f.company}${f.reason ? ` (${f.reason})` : ''}`)
    .join('; ');

  const candidatePayload = candidates.map((c) => ({
    urlHash: c.urlHash,
    title: c.title,
    company: c.company,
    location: c.location,
    isRemoteHint: c.isRemoteHint,
    department: c.department ?? '',
    description: c.rawDescription.slice(0, 1400),
  }));

  const prompt = `Evaluate and normalize each newly discovered job posting against the candidate's target criteria and feedback memory.

USER CRITERIA:
${input.searchPrompt}

ACTIVE FILTER RULES:
${activeRules || '- None'}

RECENT LIKES (👍): ${likes || 'None yet'}
RECENT DISLIKES (👎): ${dislikes || 'None yet'}

INSTRUCTIONS:
- Return one object per posting matching its exact urlHash.
- matchScore: integer 0-100 calibrated strictly against USER CRITERIA, ACTIVE FILTER RULES, and likes/dislikes.
- matchReason: 1 crisp sentence explaining why it scored that way (mention concrete matches or trade-offs).
- salaryMin / salaryMax: integer USD annual base salary if explicitly stated in the description, otherwise null.
- salaryLabel: formatted like "$195k – $235k" if stated, otherwise "Not listed".
- locationType: strictly one of "Remote", "Hybrid", or "Onsite".
- employmentType: strictly one of "Full-time", "Internship", "Part-time", or "Contract".
- deadlineAt: "YYYY-MM-DD" ONLY if an explicit application closing date appears in the description, otherwise null.
- skills: 3 to 5 concise technical skills extracted from the posting.
- summary: 2 concise sentences summarizing the role scope.

NEW POSTINGS TO EVALUATE:
${JSON.stringify(candidatePayload)}`;

  const response = await ai.models.generateContent({
    model: GEMINI_LITE_MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: SCORING_RESPONSE_SCHEMA,
      thinkingConfig: LITE_THINKING_CONFIG,
    },
  });

  const parsed = JSON.parse((response.text ?? '[]').trim()) as GeminiScoredItem[];
  const byHash = new Map<string, GeminiScoredItem>();
  for (const item of parsed) {
    if (item && item.urlHash) {
      byHash.set(item.urlHash, item);
    }
  }
  return byHash;
}

function normalizeLocationType(raw: string | undefined, isRemoteHint: boolean | null): LocationType {
  if (raw === 'Remote' || raw === 'Hybrid' || raw === 'Onsite') return raw;
  if (raw && /remote/i.test(raw)) return 'Remote';
  if (raw && /hybrid/i.test(raw)) return 'Hybrid';
  if (isRemoteHint) return 'Remote';
  return 'Onsite';
}

export async function runAgentPipeline(input: AgentRunInput): Promise<AgentRunOutput> {
  const enabledSources = input.sources.filter((s) => s.enabled);
  const enabledCompanies = (input.targetCompanies ?? []).filter((c) => c.enabled).slice(0, 12);
  const existingSet = new Set(input.existingHashes);
  const maxNewPerRun = Math.min(Math.max(input.maxNewPerRun ?? 6, 1), 12);

  const sourceResults: AgentSourceRunResult[] = [];
  const allUnseen: RawScrapedPosting[] = [];
  const seenInThisRun = new Set<string>();
  const checkedCompanyMap = new Map<string, number>();

  // Step A + Step B: Fetch each enabled ATS source in parallel with isolated error handling & deduplicate
  await Promise.all(
    enabledSources.map(async (source) => {
      const started = Date.now();
      try {
        const rawPostings = await fetchBySourceAdapter(source);
        let duplicatesSkipped = 0;

        for (const posting of rawPostings) {
          if (existingSet.has(posting.urlHash) || seenInThisRun.has(posting.urlHash)) {
            duplicatesSkipped += 1;
          } else {
            seenInThisRun.add(posting.urlHash);
            allUnseen.push(posting);
          }
        }

        sourceResults.push({
          sourceId: source.id,
          sourceName: source.name,
          atsType: source.atsType,
          status: 'ok',
          rawFetched: rawPostings.length,
          duplicatesSkipped,
          newlyScored: 0,
          durationMs: Date.now() - started,
        });
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.name === 'AbortError'
              ? 'Request timed out after 10s'
              : err.message
            : 'Failed to fetch source';
        sourceResults.push({
          sourceId: source.id,
          sourceName: source.name,
          atsType: source.atsType,
          status: 'error',
          rawFetched: 0,
          duplicatesSkipped: 0,
          newlyScored: 0,
          durationMs: Date.now() - started,
          errorMessage: message,
        });
      }
    })
  );

  // Step C: Scan enabled Target Companies (ATS probe first, then live Google Search fallback for remaining)
  if (enabledCompanies.length > 0) {
    const tcStarted = Date.now();
    const companiesNeedingWebSearch: TargetCompany[] = [];
    let tcRawFetched = 0;
    let tcDupes = 0;

    await Promise.all(
      enabledCompanies.map(async (company) => {
        checkedCompanyMap.set(company.id, 0);
        try {
          const directPostings = await probeTargetCompanyAts(company);
          if (directPostings.length > 0) {
            tcRawFetched += directPostings.length;
            let companyUnseen = 0;
            for (const posting of directPostings) {
              if (existingSet.has(posting.urlHash) || seenInThisRun.has(posting.urlHash)) {
                tcDupes += 1;
              } else {
                seenInThisRun.add(posting.urlHash);
                allUnseen.push(posting);
                companyUnseen += 1;
              }
            }
            checkedCompanyMap.set(company.id, companyUnseen);
          } else {
            companiesNeedingWebSearch.push(company);
          }
        } catch {
          companiesNeedingWebSearch.push(company);
        }
      })
    );

    if (companiesNeedingWebSearch.length > 0) {
      try {
        const webPostings = await searchTargetCompaniesWithGemini(
          companiesNeedingWebSearch,
          input.searchPrompt,
          input.rules
        );
        tcRawFetched += webPostings.length;
        for (const posting of webPostings) {
          if (existingSet.has(posting.urlHash) || seenInThisRun.has(posting.urlHash)) {
            tcDupes += 1;
          } else {
            seenInThisRun.add(posting.urlHash);
            allUnseen.push(posting);
            checkedCompanyMap.set(
              posting.sourceId,
              (checkedCompanyMap.get(posting.sourceId) ?? 0) + 1
            );
          }
        }
      } catch (err) {
        console.error('Target company web search failed:', err);
      }
    }

    sourceResults.push({
      sourceId: 'src-target-companies',
      sourceName: `Target Companies (${enabledCompanies.length} watched)`,
      atsType: 'Target Company',
      status: 'ok',
      rawFetched: tcRawFetched,
      duplicatesSkipped: tcDupes,
      newlyScored: 0,
      durationMs: Date.now() - tcStarted,
    });
  }

  // Step D: Pull full web job descriptions for newly discovered roles with short excerpts, then score + enrich incomplete roles
  const candidatesToScore = preRankCandidates(allUnseen, input.searchPrompt, maxNewPerRun);

  await Promise.all(
    candidatesToScore.map(async (candidate) => {
      if (candidate.rawDescription.length >= 450 || isPlaceholderJobUrl(candidate.jobUrl)) {
        return;
      }
      try {
        const res = await fetchWithTimeout(candidate.jobUrl, 4500);
        if (!res.ok) return;
        const html = await res.text();
        const extracted = stripHtmlToText(html, 8500);
        if (extracted.length > candidate.rawDescription.length && extracted.length >= 220) {
          candidate.rawDescription = extracted;
        }
      } catch {
        // Non-blocking: keep original excerpt
      }
    })
  );

  const [scoredByHash, enrichedJobs] = await Promise.all([
    scoreCandidatesWithGemini(candidatesToScore, input),
    enrichIncompleteJobs(input.incompleteJobs ?? [], input.searchPrompt, input.rules).catch((err) => {
      console.error('Incomplete role enrichment failed:', err);
      return [] as JobEnrichmentPatch[];
    }),
  ]);

  const now = new Date();
  const discoveredAt = formatIsoDateInTimeZone(now, input.timeZone);
  const discoveredTime = formatTimeInTimeZone(now, input.timeZone);

  const newJobs: JobRecord[] = candidatesToScore.map((candidate, idx) => {
    const scored = scoredByHash.get(candidate.urlHash);
    const scoreVal =
      typeof scored?.matchScore === 'number'
        ? Math.min(100, Math.max(0, Math.round(scored.matchScore)))
        : 75;
    const employmentType = normalizeEmploymentTypeServer(
      scored?.employmentType,
      candidate.title,
      candidate.rawDescription
    );

    return {
      id: `job-live-${Date.now()}-${idx}`,
      urlHash: candidate.urlHash,
      title: candidate.title,
      company: candidate.company,
      companyDomain: candidate.companyDomain,
      stage: 'inbox',
      isNew: true,
      matchScore: scoreVal,
      matchReason:
        scored?.matchReason ||
        `Extracted from ${candidate.sourceName} and matched against your target criteria.`,
      salaryMin: typeof scored?.salaryMin === 'number' ? scored.salaryMin : null,
      salaryMax: typeof scored?.salaryMax === 'number' ? scored.salaryMax : null,
      salaryLabel: scored?.salaryLabel || 'Not listed',
      location: scored?.location || candidate.location,
      locationType: normalizeLocationType(scored?.locationType, candidate.isRemoteHint),
      employmentType,
      isMbaRole: detectIsMbaRoleServer(candidate.title),
      sourceId: candidate.sourceId,
      sourceName: candidate.sourceName,
      atsType: candidate.atsType,
      jobUrl: candidate.jobUrl,
      discoveredAt,
      discoveredTime,
      deadlineAt:
        scored?.deadlineAt && /^\d{4}-\d{2}-\d{2}$/.test(scored.deadlineAt)
          ? scored.deadlineAt
          : null,
      skills:
        Array.isArray(scored?.skills) && scored.skills.length > 0
          ? scored.skills.slice(0, 5)
          : ['General'],
      summary: scored?.summary || candidate.rawDescription.slice(0, 260),
      fullDescription:
        candidate.rawDescription.length > 80
          ? candidate.rawDescription.slice(0, 10000)
          : scored?.summary || candidate.rawDescription,
      notes: '',
      feedback: null,
    };
  });

  // Update per-source newlyScored counts
  const addedBySource = new Map<string, number>();
  let targetCompanyAdded = 0;
  for (const job of newJobs) {
    addedBySource.set(job.sourceId, (addedBySource.get(job.sourceId) ?? 0) + 1);
    if (job.atsType === 'Target Company') {
      targetCompanyAdded += 1;
    }
  }
  for (const res of sourceResults) {
    if (res.sourceId === 'src-target-companies') {
      res.newlyScored = targetCompanyAdded;
    } else {
      res.newlyScored = addedBySource.get(res.sourceId) ?? 0;
    }
  }

  // Sort results in the same order as input.sources (with target companies at the end)
  const orderMap = new Map(enabledSources.map((s, i) => [s.id, i]));
  sourceResults.sort(
    (a, b) => (orderMap.get(a.sourceId) ?? 99) - (orderMap.get(b.sourceId) ?? 99)
  );

  const runReport: AgentRunReport = {
    id: `run-${Date.now()}`,
    completedAt: discoveredAt,
    completedTime: discoveredTime,
    totalFetched: sourceResults.reduce((acc, r) => acc + r.rawFetched, 0),
    totalSkipped: sourceResults.reduce((acc, r) => acc + r.duplicatesSkipped, 0),
    totalAdded: newJobs.length,
    enrichedCount: enrichedJobs.length,
    sourceResults,
  };

  const checkedCompanyIds = Array.from(checkedCompanyMap.entries()).map(([id, foundCount]) => ({
    id,
    foundCount,
  }));

  return { newJobs, enrichedJobs, checkedCompanyIds, runReport };
}

export interface FetchedWebDescriptionResult {
  fullDescription: string;
  discoveredJobUrl?: string;
  employmentType?: string;
}

export async function fetchFullJobDescriptionFromUrl(
  jobUrl?: string,
  fallbackContext?: { title?: string; company?: string; location?: string }
): Promise<FetchedWebDescriptionResult> {
  const ai = getGeminiClient();
  const trimmedUrl = (jobUrl ?? '').trim();

  // Attempt direct public URL fetch first when a non-Gmail/non-placeholder URL is provided
  if (trimmedUrl && !isPlaceholderJobUrl(trimmedUrl)) {
    try {
      const parsedUrl = new URL(trimmedUrl);
      if (['http:', 'https:'].includes(parsedUrl.protocol)) {
        const res = await fetchWithTimeout(parsedUrl.toString());
        if (res.ok) {
          const html = await res.text();
          const compact = htmlToCompactMarkdown(html, parsedUrl.toString(), 14000);
          if (compact.length >= 160) {
            const response = await ai.models.generateContent({
              model: GEMINI_LITE_MODEL,
              contents: `Extract the clean, complete job description from this job posting page. Preserve key sections (About the Role, Responsibilities, Qualifications, Compensation & Benefits) in clean plain text with short headings and bullet points (- ). Remove navigation chrome, cookie banners, and unrelated links.\n\nPAGE CONTENT:\n${compact}`,
              config: {
                thinkingConfig: LITE_THINKING_CONFIG,
              },
            });
            const text = (response.text || '').trim() || stripHtmlToText(html, 8000);
            if (text.length >= 120) {
              return {
                fullDescription: text.slice(0, 12000),
                employmentType: normalizeEmploymentTypeServer(
                  null,
                  fallbackContext?.title,
                  text
                ),
              };
            }
          }
        }
      }
    } catch {
      // Fall through to live Google Search fallback below
    }
  }

  // Fallback: Live Google Search to locate the canonical posting URL & full job description
  const title = fallbackContext?.title?.trim() || '';
  const company = fallbackContext?.company?.trim() || '';
  const location = fallbackContext?.location?.trim() || '';

  if (!title && !company && !trimmedUrl) {
    throw new Error('Provide a job posting URL or role title and company to fetch the full description.');
  }

  const searchResponse = await ai.models.generateContent({
    model: GEMINI_LITE_MODEL,
    contents: `Find the official public job posting on the web for this role and extract the complete job description:
- Role Title: ${title || 'Unknown'}
- Company: ${company || 'Unknown'}
- Location: ${location || 'Any'}
- Reference URL: ${trimmedUrl || 'None'}

Respond ONLY with a valid JSON object (no extra text):
{
  "discoveredJobUrl": "canonical public https:// posting URL if found, else null",
  "employmentType": "Full-time" | "Internship" | "Part-time" | "Contract" | null,
  "fullDescription": "Clean, complete multi-section job description (About the Role, Responsibilities, Qualifications, Compensation & Benefits) with short headings and bullet points (- )."
}`,
    config: {
      tools: [{ googleSearch: {} }],
      thinkingConfig: LITE_THINKING_CONFIG,
    },
  });

  const parsed = parseJsonFromModelText<{
    discoveredJobUrl?: string | null;
    employmentType?: string | null;
    fullDescription?: string | null;
  }>(searchResponse.text ?? '{}', {});

  let fullDescription = (parsed.fullDescription ?? '').trim();
  const discoveredJobUrl =
    parsed.discoveredJobUrl && !isPlaceholderJobUrl(parsed.discoveredJobUrl)
      ? parsed.discoveredJobUrl.trim().slice(0, 950)
      : undefined;

  // If search found a real canonical URL and description is still sparse, fetch the page directly
  if (discoveredJobUrl && fullDescription.length < 300) {
    try {
      const res = await fetchWithTimeout(discoveredJobUrl, 5000);
      if (res.ok) {
        const html = await res.text();
        const extracted = stripHtmlToText(html, 9000);
        if (extracted.length > fullDescription.length) {
          fullDescription = extracted;
        }
      }
    } catch {
      // keep search result
    }
  }

  if (!fullDescription || fullDescription.length < 60) {
    throw new Error(
      'Could not retrieve a full public job description from the web (the posting may be closed or require sign-in).'
    );
  }

  return {
    fullDescription: fullDescription.slice(0, 12000),
    discoveredJobUrl,
    employmentType: normalizeEmploymentTypeServer(
      parsed.employmentType,
      title,
      fullDescription
    ),
  };
}

function detectAtsFromUrl(url: string): AtsType {
  const lower = url.toLowerCase();
  if (lower.includes('greenhouse.io')) return 'Greenhouse';
  if (lower.includes('lever.co')) return 'Lever';
  if (lower.includes('ashbyhq.com')) return 'Ashby';
  if (lower.includes('rss') || lower.includes('.xml')) return 'RSS Feed';
  return 'Custom Markdown';
}

export async function extractJobFromUrl(input: {
  jobUrl: string;
  searchPrompt: string;
  rules: { text: string; active: boolean }[];
  recentFeedback?: AgentRunInput['recentFeedback'];
  stage?: JobRecord['stage'];
  timeZone?: string;
}): Promise<JobRecord> {
  let normalizedUrl = input.jobUrl.trim();
  if (!normalizedUrl) {
    throw new Error('Please enter a job posting URL.');
  }
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalizedUrl);
  } catch {
    throw new Error('Please enter a valid http:// or https:// job posting URL.');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Only http:// and https:// URLs are supported.');
  }

  const canonicalUrl = parsedUrl.toString();
  const domain = extractDomain(canonicalUrl);
  const atsType = detectAtsFromUrl(canonicalUrl);
  const ai = getGeminiClient();

  let pageMarkdown = '';
  try {
    const res = await fetchWithTimeout(canonicalUrl, 9000);
    if (res.ok) {
      const html = await res.text();
      pageMarkdown = htmlToCompactMarkdown(html, canonicalUrl, 16000);
    }
  } catch {
    // Will fall back to live Google Search grounding
  }

  const activeRules = (input.rules ?? [])
    .filter((r) => r.active)
    .map((r) => `- ${r.text}`)
    .join('\n');

  const feedbackText = (input.recentFeedback ?? [])
    .slice(0, 10)
    .map((f) =>
      f.vote === 'up'
        ? `- UPVOTED: ${f.jobTitle} at ${f.company}`
        : `- HIDDEN (${f.reason || 'not a fit'}): ${f.jobTitle} at ${f.company}`
    )
    .join('\n');

  const promptCore = `Extract the job details from this posting and score how well it fits the candidate's target criteria.

URL: ${canonicalUrl}

CANDIDATE SEARCH CRITERIA:
${input.searchPrompt || 'General career search'}

ACTIVE RULES:
${activeRules || 'None'}

RECENT FEEDBACK:
${feedbackText || 'None'}

Respond ONLY with a valid JSON object matching this exact structure (no markdown commentary):
{
  "title": "Exact role title (never leave blank if determinable from the posting or URL)",
  "company": "Company name",
  "location": "City, State / Remote",
  "locationType": "Remote" | "Hybrid" | "Onsite",
  "employmentType": "Full-time" | "Internship" | "Part-time" | "Contract",
  "salaryMin": integer USD annual base or null,
  "salaryMax": integer USD annual base or null,
  "salaryLabel": "e.g. $180k - $220k or Not listed",
  "deadlineAt": "YYYY-MM-DD or null",
  "skills": ["up to 5 core skills/keywords"],
  "summary": "2-3 sentence concise overview of the role",
  "fullDescription": "Complete, well-formatted multi-section job description (About the Role, Responsibilities, Qualifications, Compensation & Benefits) with short headings and bullet points (- ).",
  "matchScore": integer 0-100,
  "matchReason": "1-2 sentence explanation of fit against candidate criteria"
}`;

  let extracted: {
    title?: string;
    company?: string;
    location?: string;
    locationType?: string;
    employmentType?: string;
    salaryMin?: number | null;
    salaryMax?: number | null;
    salaryLabel?: string;
    deadlineAt?: string | null;
    skills?: string[];
    summary?: string;
    fullDescription?: string;
    matchScore?: number;
    matchReason?: string;
  } = {};

  if (pageMarkdown.length >= 220) {
    const response = await ai.models.generateContent({
      model: GEMINI_LITE_MODEL,
      contents: `${promptCore}\n\nFETCHED PAGE CONTENT:\n${pageMarkdown}`,
      config: {
        responseMimeType: 'application/json',
        thinkingConfig: LITE_THINKING_CONFIG,
      },
    });
    extracted = parseJsonFromModelText(response.text ?? '{}', {});
  } else {
    const response = await ai.models.generateContent({
      model: GEMINI_LITE_MODEL,
      contents: `Use Google Search to look up the public job posting at ${canonicalUrl} (the page required JS or blocked direct fetch) and extract all available details.\n\n${promptCore}`,
      config: {
        tools: [{ googleSearch: {} }],
        thinkingConfig: LITE_THINKING_CONFIG,
      },
    });
    extracted = parseJsonFromModelText(response.text ?? '{}', {});
  }

  const now = new Date();
  const discoveredAt = formatIsoDateInTimeZone(now, input.timeZone);
  const discoveredTime = formatTimeInTimeZone(now, input.timeZone);

  const fallbackCompany =
    domain
      .replace(/\.(com|io|co|ai|org|net|app|jobs)$/i, '')
      .split('.')
      .pop() || 'Unknown Company';
  const company =
    extracted.company?.trim() ||
    fallbackCompany.charAt(0).toUpperCase() + fallbackCompany.slice(1);
  const title = extracted.title?.trim() || 'Role from URL';
  const fullDescription =
    (extracted.fullDescription || '').trim().slice(0, 12000) ||
    (extracted.summary || '').trim() ||
    pageMarkdown.slice(0, 8000);
  const summary =
    (extracted.summary || '').trim().slice(0, 400) ||
    fullDescription.slice(0, 260) ||
    `Manually added from ${canonicalUrl}`;

  const rawScore =
    typeof extracted.matchScore === 'number' && !Number.isNaN(extracted.matchScore)
      ? Math.max(0, Math.min(100, Math.round(extracted.matchScore)))
      : 78;

  const employmentType = normalizeEmploymentTypeServer(
    extracted.employmentType,
    title,
    `${summary}\n${fullDescription}`
  );
  const location = extracted.location?.trim() || 'Unspecified';
  const isRemoteHint = /remote/i.test(`${location} ${title}`) ? true : null;

  return {
    id: `job-url-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    urlHash: hashCanonicalUrl(canonicalUrl),
    title,
    company,
    companyDomain: domain,
    stage: input.stage || 'saved',
    isNew: false,
    matchScore: rawScore,
    matchReason:
      extracted.matchReason?.trim() ||
      `Added manually from ${domain} and scored against your search criteria.`,
    salaryMin: typeof extracted.salaryMin === 'number' ? extracted.salaryMin : null,
    salaryMax: typeof extracted.salaryMax === 'number' ? extracted.salaryMax : null,
    salaryLabel: extracted.salaryLabel?.trim() || 'Not listed',
    location,
    locationType: normalizeLocationType(extracted.locationType, isRemoteHint),
    employmentType,
    isMbaRole: detectIsMbaRoleServer(title),
    sourceId: 'src-manual-url',
    sourceName: 'Manual URL',
    atsType,
    jobUrl: canonicalUrl,
    discoveredAt,
    discoveredTime,
    deadlineAt:
      extracted.deadlineAt && /^\d{4}-\d{2}-\d{2}$/.test(extracted.deadlineAt)
        ? extracted.deadlineAt
        : null,
    skills:
      Array.isArray(extracted.skills) && extracted.skills.length > 0
        ? extracted.skills.map((s) => String(s).trim()).filter(Boolean).slice(0, 5)
        : ['General'],
    summary,
    fullDescription,
    notes: '',
    feedback: null,
  };
}
