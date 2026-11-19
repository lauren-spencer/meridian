import crypto from 'node:crypto';
import { GoogleGenAI, Type } from '@google/genai';
import {
  detectIsMbaRoleServer,
  enrichIncompleteJobs,
  isPlaceholderJobUrl,
  normalizeEmploymentTypeServer,
} from './agentRunner.ts';
import type {
  AgentRunReport,
  DislikeReason,
  JobRecord,
  LocationType,
} from '../types/job.ts';
import { formatIsoDateInTimeZone, formatTimeInTimeZone } from './dateTime.ts';
import { GEMINI_LITE_MODEL, LITE_THINKING_CONFIG } from './geminiModels.ts';
import {
  canonicalizeJobUrl,
  hasMatchingDedupeKey,
  normalizeCompanyKey,
  normalizeTitleKey,
  registerDedupeKeys,
} from './jobDedupe.ts';

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

export const DEFAULT_GMAIL_QUERY =
  'from:jobalerts-noreply@linkedin.com newer_than:60d';

interface GmailMessagePart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
}

interface GmailMessagePayload {
  headers?: { name: string; value: string }[];
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
}

interface GmailMessageResource {
  id: string;
  threadId: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailMessagePayload;
}

function decodeBase64Url(encoded: string): string {
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function stripHtmlKeepingLinks(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(
      /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_m, href: string, inner: string) => {
        const label = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!label) return '';
        if (/unsubscribe|preferences|privacy|help\.linkedin|tracking/i.test(href)) {
          return label;
        }
        return `${label} (${href})`;
      }
    )
    .replace(/<\/(p|div|tr|li|br|h1|h2|h3|h4)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractBodyFromPayload(payload?: GmailMessagePayload): string {
  if (!payload) return '';

  const textChunks: string[] = [];
  const htmlChunks: string[] = [];

  const walk = (part: GmailMessagePart) => {
    if (part.body?.data) {
      const decoded = decodeBase64Url(part.body.data);
      if (part.mimeType === 'text/plain') {
        textChunks.push(decoded);
      } else if (part.mimeType === 'text/html') {
        htmlChunks.push(decoded);
      }
    }
    if (Array.isArray(part.parts)) {
      for (const child of part.parts) {
        walk(child);
      }
    }
  };

  walk(payload);

  // Prefer HTML when available for job digests because direct role URLs live in anchor hrefs
  if (htmlChunks.length > 0) {
    return stripHtmlKeepingLinks(htmlChunks.join('\n')).slice(0, 4000);
  }
  if (textChunks.length > 0) {
    return textChunks.join('\n').replace(/\s+\n/g, '\n').trim().slice(0, 4000);
  }
  return '';
}

function getHeader(payload: GmailMessagePayload | undefined, name: string): string {
  const lower = name.toLowerCase();
  return (
    payload?.headers?.find((h) => h.name.toLowerCase() === lower)?.value ?? ''
  );
}

function detectSenderOrigin(from: string, subject: string): string {
  const combined = `${from} ${subject}`.toLowerCase();
  if (combined.includes('linkedin')) return 'LinkedIn (Gmail)';
  if (combined.includes('indeed')) return 'Indeed (Gmail)';
  if (combined.includes('wellfound') || combined.includes('angel.co')) return 'Wellfound (Gmail)';
  if (combined.includes('glassdoor')) return 'Glassdoor (Gmail)';
  if (combined.includes('builtin')) return 'Built In (Gmail)';
  if (combined.includes('handshake')) return 'Handshake (Gmail)';
  return 'Gmail Alert';
}

function hashEmailJob(title: string, company: string, jobUrl?: string): string {
  const canonicalUrl = canonicalizeJobUrl(jobUrl);
  const canonical = canonicalUrl
    ? canonicalUrl
    : `role:${normalizeCompanyKey(company) || company.trim().toLowerCase()}::${normalizeTitleKey(title) || title.trim().toLowerCase()}`;
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

function normalizeLocationType(raw?: string): LocationType {
  if (raw === 'Remote' || raw === 'Hybrid' || raw === 'Onsite') return raw;
  if (raw && /remote/i.test(raw)) return 'Remote';
  if (raw && /hybrid/i.test(raw)) return 'Hybrid';
  return 'Onsite';
}

export interface GmailScanInput {
  accessToken: string;
  query?: string;
  maxMessages?: number;
  existingHashes: string[];
  searchPrompt: string;
  rules: { text: string; active: boolean }[];
  recentFeedback: {
    jobTitle: string;
    company: string;
    vote: 'up' | 'down';
    reason?: DislikeReason;
  }[];
  timeZone?: string;
}

export interface GmailScanOutput {
  newJobs: JobRecord[];
  emailsScanned: number;
  matchedSenders: string[];
  runReport: AgentRunReport;
}

const GMAIL_EXTRACTION_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      messageId: { type: Type.STRING },
      title: { type: Type.STRING },
      company: { type: Type.STRING },
      jobUrl: { type: Type.STRING, nullable: true },
      salaryMin: { type: Type.INTEGER, nullable: true },
      salaryMax: { type: Type.INTEGER, nullable: true },
      salaryLabel: { type: Type.STRING },
      location: { type: Type.STRING },
      locationType: { type: Type.STRING },
      employmentType: { type: Type.STRING },
      deadlineAt: { type: Type.STRING, nullable: true },
      skills: { type: Type.ARRAY, items: { type: Type.STRING } },
      summary: { type: Type.STRING },
      fullDescription: { type: Type.STRING },
      matchScore: { type: Type.INTEGER },
      matchReason: { type: Type.STRING },
      originLabel: { type: Type.STRING },
    },
    required: [
      'messageId',
      'title',
      'company',
      'salaryLabel',
      'location',
      'locationType',
      'skills',
      'summary',
      'matchScore',
      'matchReason',
    ],
  },
};

interface ExtractedGmailJob {
  messageId: string;
  title: string;
  company: string;
  jobUrl?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryLabel: string;
  location: string;
  locationType: string;
  employmentType?: string;
  deadlineAt?: string | null;
  skills: string[];
  summary: string;
  fullDescription?: string;
  matchScore: number;
  matchReason: string;
  originLabel?: string;
}

export async function scanGmailForJobs(input: GmailScanInput): Promise<GmailScanOutput> {
  const started = Date.now();
  const query = input.query?.trim() || DEFAULT_GMAIL_QUERY;
  const maxMessages = Math.min(Math.max(input.maxMessages ?? 12, 1), 20);

  const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  listUrl.searchParams.set('q', query);
  listUrl.searchParams.set('maxResults', String(maxMessages));

  const listRes = await fetch(listUrl.toString(), {
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
    },
  });

  if (listRes.status === 401 || listRes.status === 403) {
    const rawBody = await listRes.text().catch(() => '');
    let googleReason = '';
    let googleMsg = '';
    try {
      const parsed = JSON.parse(rawBody) as {
        error?: { message?: string; errors?: { reason?: string }[]; status?: string };
      };
      googleMsg = parsed.error?.message || '';
      googleReason =
        parsed.error?.errors?.[0]?.reason || parsed.error?.status || '';
    } catch {
      googleMsg = rawBody.slice(0, 180);
    }

    let friendlyMessage =
      'Gmail session expired or missing permission. Please click Sign in with Google again.';
    if (
      /accessNotConfigured|has not been used|disabled/i.test(
        `${googleReason} ${googleMsg}`
      )
    ) {
      friendlyMessage = googleMsg
        ? `The Gmail API is not enabled yet on your Google Cloud project. ${googleMsg}`
        : 'The Gmail API is not enabled on the Google Cloud project yet. Enable "Gmail API" in Google Cloud Console for your project, then reconnect.';
    } else if (
      /insufficient|scope|PERMISSION_DENIED/i.test(`${googleReason} ${googleMsg}`)
    ) {
      friendlyMessage =
        'Google Sign-In succeeded, but Gmail read permission was not granted. Click Sign in with Google again and make sure the "View your email messages" checkbox is checked on the Google consent screen.';
    } else if (googleMsg) {
      friendlyMessage = `Gmail authorization error: ${googleMsg}`;
    }

    const err = new Error(friendlyMessage) as Error & { status?: number };
    err.status = 401;
    throw err;
  }

  if (!listRes.ok) {
    const errText = await listRes.text().catch(() => '');
    throw new Error(`Gmail API error (${listRes.status}): ${errText.slice(0, 200)}`);
  }

  const listData = (await listRes.json()) as {
    messages?: { id: string; threadId: string }[];
  };

  const messageRefs = Array.isArray(listData.messages) ? listData.messages : [];
  const now = new Date();
  const discoveredAt = formatIsoDateInTimeZone(now, input.timeZone);
  const discoveredTime = formatTimeInTimeZone(now, input.timeZone);

  if (messageRefs.length === 0) {
    return {
      newJobs: [],
      emailsScanned: 0,
      matchedSenders: [],
      runReport: {
        id: `run-gmail-${Date.now()}`,
        completedAt: discoveredAt,
        completedTime: discoveredTime,
        trigger: 'manual',
        totalFetched: 0,
        totalSkipped: 0,
        totalAdded: 0,
        sourceResults: [
          {
            sourceId: 'src-gmail',
            sourceName: 'Gmail Job Alerts',
            atsType: 'Gmail',
            status: 'ok',
            rawFetched: 0,
            duplicatesSkipped: 0,
            newlyScored: 0,
            durationMs: Date.now() - started,
          },
        ],
      },
    };
  }

  // Fetch full message contents in parallel
  const messages = await Promise.all(
    messageRefs.map(async (ref) => {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(ref.id)}?format=full`,
        {
          headers: { Authorization: `Bearer ${input.accessToken}` },
        }
      );
      if (!msgRes.ok) return null;
      return (await msgRes.json()) as GmailMessageResource;
    })
  );

  const validMessages = messages.filter((m): m is GmailMessageResource => m !== null);
  const senderSet = new Set<string>();

  const emailDigestPayload = validMessages.map((msg) => {
    const from = getHeader(msg.payload, 'From');
    const subject = getHeader(msg.payload, 'Subject');
    const dateHeader = getHeader(msg.payload, 'Date');
    const origin = detectSenderOrigin(from, subject);
    senderSet.add(origin);

    const bodyText = extractBodyFromPayload(msg.payload) || msg.snippet || '';
    const msgIsoDate = msg.internalDate
      ? formatIsoDateInTimeZone(new Date(Number(msg.internalDate)), input.timeZone)
      : discoveredAt;

    return {
      messageId: msg.id,
      origin,
      from,
      subject,
      date: msgIsoDate,
      dateHeader,
      body: bodyText.slice(0, 2600),
    };
  });

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

  const extractionPrompt = `You are extracting real job openings, recruiting outreach roles, and job alert postings from a user's Gmail emails.

USER CRITERIA:
${input.searchPrompt}

ACTIVE FILTER RULES:
${activeRules || '- None'}

RECENT LIKES (👍): ${likes || 'None yet'}
RECENT DISLIKES (👎): ${dislikes || 'None yet'}

INSTRUCTIONS:
- Read the emails below and extract ONLY genuine job roles, recruiter outreach opportunities, or job alert postings (skip generic newsletters, social connection requests, profile views, security alerts, or unrelated notifications).
- A single digest email (e.g. LinkedIn Job Alert or job board digest) may contain multiple distinct jobs — extract up to 10 best matching jobs across all emails.
- For each job return:
  - messageId: exact messageId of the source email
  - title: role title
  - company: hiring company name
  - jobUrl: direct posting URL from the email if present, else null
  - salaryMin / salaryMax: integer annual USD base if mentioned, else null
  - salaryLabel: e.g. "$190k – $220k" or "Not listed"
  - location: city/region or "Remote"
  - locationType: strictly "Remote", "Hybrid", or "Onsite"
  - employmentType: strictly "Full-time", "Internship", "Part-time", or "Contract"
  - deadlineAt: "YYYY-MM-DD" if an application deadline is mentioned, else null
  - skills: 3-5 concise skills or domain tags
  - summary: 1-2 crisp sentences about the role (mentioning if it came from a LinkedIn alert, job board digest, or recruiter email)
  - fullDescription: detailed job description text extracted from the email (responsibilities, requirements, compensation, timeline) formatted cleanly with headings/bullets
  - matchScore: integer 0-100 calibrated against USER CRITERIA, ACTIVE FILTER RULES, and recent feedback
  - matchReason: 1 crisp sentence explaining the match score
  - originLabel: e.g. "LinkedIn (Gmail)" or "Gmail Alert"

EMAILS TO PARSE:
${JSON.stringify(emailDigestPayload)}`;

  const response = await ai.models.generateContent({
    model: GEMINI_LITE_MODEL,
    contents: extractionPrompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: GMAIL_EXTRACTION_SCHEMA,
      thinkingConfig: LITE_THINKING_CONFIG,
    },
  });

  const extracted = JSON.parse((response.text ?? '[]').trim()) as ExtractedGmailJob[];
  const existingSet = new Set(input.existingHashes);
  const seenInBatch = new Set<string>();
  const msgDateById = new Map(emailDigestPayload.map((e) => [e.messageId, e.date]));
  const msgOriginById = new Map(emailDigestPayload.map((e) => [e.messageId, e.origin]));

  let duplicatesSkipped = 0;
  const newJobs: JobRecord[] = [];

  for (let i = 0; i < extracted.length; i++) {
    const item = extracted[i];
    if (!item?.title || !item?.company) continue;

    const cleanUrl =
      item.jobUrl && /^https?:\/\//i.test(item.jobUrl)
        ? item.jobUrl
        : `https://mail.google.com/mail/u/0/#inbox/${item.messageId}`;

    const urlHash = hashEmailJob(item.title, item.company, item.jobUrl ?? undefined);
    const dedupeCandidate = {
      urlHash,
      jobUrl: item.jobUrl ?? undefined,
      company: item.company,
      title: item.title,
    };
    if (
      hasMatchingDedupeKey(existingSet, dedupeCandidate) ||
      hasMatchingDedupeKey(seenInBatch, dedupeCandidate)
    ) {
      duplicatesSkipped += 1;
      continue;
    }
    registerDedupeKeys(seenInBatch, dedupeCandidate);

    const originName =
      item.originLabel ||
      msgOriginById.get(item.messageId) ||
      'Gmail Alert';

    const emailDate = msgDateById.get(item.messageId) || discoveredAt;
    const inferredDomain = (() => {
      try {
        const host = new URL(cleanUrl).hostname.replace(/^www\./, '');
        if (host && host !== 'mail.google.com') return host;
      } catch {
        // fallback below
      }
      return `${item.company.toLowerCase().replace(/[^a-z0-9]/g, '') || 'company'}.com`;
    })();

    newJobs.push({
      id: `job-gmail-${Date.now()}-${i}`,
      urlHash,
      title: item.title.trim(),
      company: item.company.trim(),
      companyDomain: inferredDomain,
      stage: 'inbox',
      isNew: true,
      matchScore: Math.min(100, Math.max(0, Math.round(Number(item.matchScore) || 75))),
      matchReason: item.matchReason?.trim() || `Extracted from ${originName}.`,
      salaryMin: typeof item.salaryMin === 'number' ? item.salaryMin : null,
      salaryMax: typeof item.salaryMax === 'number' ? item.salaryMax : null,
      salaryLabel: item.salaryLabel || 'Not listed',
      location: item.location || 'Unspecified',
      locationType: normalizeLocationType(item.locationType),
      employmentType: normalizeEmploymentTypeServer(
        item.employmentType,
        item.title,
        item.fullDescription || item.summary
      ),
      isMbaRole: detectIsMbaRoleServer(item.title),
      sourceId: 'src-gmail',
      sourceName: originName,
      atsType: 'Gmail',
      jobUrl: cleanUrl,
      discoveredAt: emailDate,
      discoveredTime,
      deadlineAt:
        item.deadlineAt && /^\d{4}-\d{2}-\d{2}$/.test(item.deadlineAt)
          ? item.deadlineAt
          : null,
      skills:
        Array.isArray(item.skills) && item.skills.length > 0
          ? item.skills.slice(0, 5)
          : ['Recruiting'],
      summary: item.summary?.trim() || 'Extracted from job alert email.',
      fullDescription: item.fullDescription?.trim() || item.summary?.trim() || '',
      notes: '',
      feedback: null,
    });
  }

  // Automatically enrich newly discovered Gmail roles missing a direct posting URL or full web JD
  const needingEnrichment = newJobs.filter(
    (j) => isPlaceholderJobUrl(j.jobUrl) || (j.fullDescription ?? '').trim().length < 300
  );
  if (needingEnrichment.length > 0) {
    try {
      const patches = await enrichIncompleteJobs(
        needingEnrichment.map((j) => ({
          id: j.id,
          title: j.title,
          company: j.company,
          jobUrl: j.jobUrl,
          salaryLabel: j.salaryLabel,
          location: j.location,
          locationType: j.locationType,
          employmentType: j.employmentType,
          skills: j.skills,
          summary: j.summary,
          fullDescription: j.fullDescription,
          notes: j.notes,
        })),
        input.searchPrompt,
        input.rules
      );
      const patchById = new Map(patches.map((p) => [p.id, p]));
      for (const job of newJobs) {
        const patch = patchById.get(job.id);
        if (!patch) continue;
        if (patch.title) {
          job.title = patch.title;
          job.isMbaRole = detectIsMbaRoleServer(patch.title);
        }
        if (patch.jobUrl) job.jobUrl = patch.jobUrl;
        if (patch.companyDomain) job.companyDomain = patch.companyDomain;
        if (patch.salaryLabel) job.salaryLabel = patch.salaryLabel;
        if (typeof patch.salaryMin === 'number') job.salaryMin = patch.salaryMin;
        if (typeof patch.salaryMax === 'number') job.salaryMax = patch.salaryMax;
        if (patch.location) job.location = patch.location;
        if (patch.locationType) job.locationType = patch.locationType;
        if (patch.employmentType) job.employmentType = patch.employmentType;
        if (patch.skills && patch.skills.length > 0) job.skills = patch.skills;
        if (patch.summary) job.summary = patch.summary;
        if (patch.fullDescription) job.fullDescription = patch.fullDescription;
      }
    } catch (err) {
      console.error('Post-Gmail enrichment failed (non-blocking):', err);
    }
  }

  const runReport: AgentRunReport = {
    id: `run-gmail-${Date.now()}`,
    completedAt: discoveredAt,
    completedTime: discoveredTime,
    trigger: 'manual',
    totalFetched: validMessages.length,
    totalSkipped: duplicatesSkipped,
    totalAdded: newJobs.length,
    sourceResults: [
      {
        sourceId: 'src-gmail',
        sourceName: `Gmail (${validMessages.length} job alert emails)`,
        atsType: 'Gmail',
        status: 'ok',
        rawFetched: extracted.length,
        duplicatesSkipped,
        newlyScored: newJobs.length,
        durationMs: Date.now() - started,
      },
    ],
  };

  return {
    newJobs,
    emailsScanned: validMessages.length,
    matchedSenders: Array.from(senderSet),
    runReport,
  };
}
