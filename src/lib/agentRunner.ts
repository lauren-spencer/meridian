import crypto from 'node:crypto';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  AgentRunReport,
  AgentSourceRunResult,
  AtsType,
  DislikeReason,
  JobRecord,
  JobSource,
  LocationType,
} from '../types/job.ts';

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

export interface AgentRunInput {
  sources: JobSource[];
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
}

export interface AgentRunOutput {
  newJobs: JobRecord[];
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

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
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
    model: 'gemini-4-hydrogen',
    contents: `Extract up to 15 open job postings from this converted Markdown career page (${source.url}). Only include real job listings present on the page, resolving full URLs. If none are found, return an empty array.\n\n${markdown}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: extractionSchema,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
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
- deadlineAt: "YYYY-MM-DD" ONLY if an explicit application closing date appears in the description, otherwise null.
- skills: 3 to 5 concise technical skills extracted from the posting.
- summary: 2 concise sentences summarizing the role scope.

NEW POSTINGS TO EVALUATE:
${JSON.stringify(candidatePayload)}`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: SCORING_RESPONSE_SCHEMA,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
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
  const existingSet = new Set(input.existingHashes);
  const maxNewPerRun = Math.min(Math.max(input.maxNewPerRun ?? 6, 1), 10);

  const sourceResults: AgentSourceRunResult[] = [];
  const allUnseen: RawScrapedPosting[] = [];
  const seenInThisRun = new Set<string>();

  // Step A + Step B: Fetch each enabled source in parallel with isolated error handling & deduplicate
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

  // Pre-rank unseen postings and score top batch with Gemini
  const candidatesToScore = preRankCandidates(allUnseen, input.searchPrompt, maxNewPerRun);
  const scoredByHash = await scoreCandidatesWithGemini(candidatesToScore, input);

  const now = new Date();
  const discoveredAt = now.toISOString().slice(0, 10);
  const discoveredTime = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const newJobs: JobRecord[] = candidatesToScore.map((candidate, idx) => {
    const scored = scoredByHash.get(candidate.urlHash);
    const scoreVal =
      typeof scored?.matchScore === 'number'
        ? Math.min(100, Math.max(0, Math.round(scored.matchScore)))
        : 75;

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
          : ['Engineering'],
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
  for (const job of newJobs) {
    addedBySource.set(job.sourceId, (addedBySource.get(job.sourceId) ?? 0) + 1);
  }
  for (const res of sourceResults) {
    res.newlyScored = addedBySource.get(res.sourceId) ?? 0;
  }

  // Sort results in the same order as input.sources
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
    sourceResults,
  };

  return { newJobs, runReport };
}

export async function fetchFullJobDescriptionFromUrl(jobUrl: string): Promise<string> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(jobUrl);
  } catch {
    throw new Error('Invalid job posting URL.');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Only http/https job URLs are supported.');
  }

  const res = await fetchWithTimeout(parsedUrl.toString());
  if (!res.ok) {
    throw new Error(`Could not load job page (HTTP ${res.status}).`);
  }

  const html = await res.text();
  const compact = htmlToCompactMarkdown(html, parsedUrl.toString(), 14000);
  if (compact.length < 80) {
    throw new Error('Job page returned too little readable text (it may require sign-in or JS rendering).');
  }

  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Extract the clean, complete job description from this job posting page. Preserve key sections (About the Role, Responsibilities, Qualifications, Compensation & Benefits) in clean plain text with short headings and bullet points (- ). Remove navigation chrome, cookie banners, and unrelated links.\n\nPAGE CONTENT:\n${compact}`,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  const text = (response.text || '').trim();
  if (!text) {
    return stripHtmlToText(html, 8000);
  }
  return text.slice(0, 12000);
}
