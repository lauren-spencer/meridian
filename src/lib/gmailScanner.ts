import crypto from 'node:crypto';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  AgentRunReport,
  DislikeReason,
  JobRecord,
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

export const DEFAULT_GMAIL_QUERY =
  '(from:jobalerts-noreply@linkedin.com OR from:messages-noreply@linkedin.com OR from:alert@indeed.com OR from:wellfound.com OR from:joinhandshake.com OR from:12twenty.com) newer_than:60d';

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

  // Prefer HTML when available for job digests because URLs to LinkedIn / 12twenty roles live in anchor hrefs
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

function detectSenderOrigin(from: string, subject: string): 'LinkedIn (Gmail)' | 'Kellogg / 12twenty (Gmail)' | 'Gmail Alert' {
  const combined = `${from} ${subject}`.toLowerCase();
  if (combined.includes('12twenty') || combined.includes('kellogg') || combined.includes('northwestern')) {
    return 'Kellogg / 12twenty (Gmail)';
  }
  if (combined.includes('linkedin')) {
    return 'LinkedIn (Gmail)';
  }
  return 'Gmail Alert';
}

function hashEmailJob(messageId: string, title: string, company: string, jobUrl?: string): string {
  const canonical = jobUrl && /^https?:\/\//i.test(jobUrl)
    ? jobUrl.split('#')[0].split('?')[0].toLowerCase()
    : `gmail:${messageId}:${company.toLowerCase()}:${title.toLowerCase()}`;
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
    const err = new Error(
      'Gmail session expired or missing permission. Please sign in with Google again.'
    ) as Error & { status?: number };
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
  const discoveredAt = now.toISOString().slice(0, 10);
  const discoveredTime = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

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
            sourceName: 'Gmail (LinkedIn / Kellogg / 12twenty)',
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
      ? new Date(Number(msg.internalDate)).toISOString().slice(0, 10)
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

  const extractionPrompt = `You are extracting real job openings, recruiting outreach roles, and career portal postings from a user's Gmail emails (specifically from LinkedIn, Kellogg Career Management, and 12twenty).

USER CRITERIA:
${input.searchPrompt}

ACTIVE FILTER RULES:
${activeRules || '- None'}

RECENT LIKES (👍): ${likes || 'None yet'}
RECENT DISLIKES (👎): ${dislikes || 'None yet'}

INSTRUCTIONS:
- Read the emails below and extract ONLY genuine job roles, recruiting outreach opportunities, or 12twenty/Kellogg job postings (skip generic newsletters, social connection requests, profile views, security alerts, or unrelated notifications).
- A single digest email (e.g. LinkedIn Job Alert or 12twenty weekly digest) may contain multiple distinct jobs — extract up to 10 best matching jobs across all emails.
- For each job return:
  - messageId: exact messageId of the source email
  - title: role title
  - company: hiring company name
  - jobUrl: direct posting URL from the email if present, else null
  - salaryMin / salaryMax: integer annual USD base if mentioned, else null
  - salaryLabel: e.g. "$190k – $220k" or "Not listed"
  - location: city/region or "Remote"
  - locationType: strictly "Remote", "Hybrid", or "Onsite"
  - deadlineAt: "YYYY-MM-DD" if an application deadline or campus recruiting deadline (common in Kellogg/12twenty emails!) is mentioned, else null
  - skills: 3-5 concise skills or domain tags
  - summary: 1-2 crisp sentences about the role (mentioning if it came from a LinkedIn alert, recruiter note, or Kellogg/12twenty recruiting post)
  - fullDescription: detailed job description text extracted from the email (responsibilities, requirements, compensation, timeline) formatted cleanly with headings/bullets
  - matchScore: integer 0-100 calibrated against USER CRITERIA, ACTIVE FILTER RULES, and recent feedback
  - matchReason: 1 crisp sentence explaining the match score
  - originLabel: "LinkedIn (Gmail)" or "Kellogg / 12twenty (Gmail)"

EMAILS TO PARSE:
${JSON.stringify(emailDigestPayload)}`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: extractionPrompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: GMAIL_EXTRACTION_SCHEMA,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
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

    const urlHash = hashEmailJob(item.messageId, item.title, item.company, item.jobUrl ?? undefined);
    if (existingSet.has(urlHash) || seenInBatch.has(urlHash)) {
      duplicatesSkipped += 1;
      continue;
    }
    seenInBatch.add(urlHash);

    const originName =
      item.originLabel ||
      msgOriginById.get(item.messageId) ||
      'Gmail (LinkedIn / Kellogg / 12twenty)';

    const emailDate = msgDateById.get(item.messageId) || discoveredAt;

    newJobs.push({
      id: `job-gmail-${Date.now()}-${i}`,
      urlHash,
      title: item.title.trim(),
      company: item.company.trim(),
      companyDomain: originName.includes('LinkedIn') ? 'linkedin.com' : '12twenty.com',
      stage: 'inbox',
      isNew: true,
      matchScore: Math.min(100, Math.max(0, Math.round(Number(item.matchScore) || 75))),
      matchReason: item.matchReason?.trim() || `Extracted from ${originName}.`,
      salaryMin: typeof item.salaryMin === 'number' ? item.salaryMin : null,
      salaryMax: typeof item.salaryMax === 'number' ? item.salaryMax : null,
      salaryLabel: item.salaryLabel || 'Not listed',
      location: item.location || 'Unspecified',
      locationType: normalizeLocationType(item.locationType),
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
        sourceName: `Gmail (${validMessages.length} emails from LinkedIn / Kellogg / 12twenty)`,
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
