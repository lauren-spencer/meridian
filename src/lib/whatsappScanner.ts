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

const MODEL_NAME = GEMINI_LITE_MODEL;

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function sha256Short(input: string): string {
  return crypto
    .createHash('sha256')
    .update(input.trim().toLowerCase())
    .digest('hex')
    .slice(0, 16);
}

interface ParsedWhatsAppMessage {
  sender: string;
  body: string;
}

const IOS_LINE = /^\[?\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APap][Mm])?\]?\s*[-–]?\s*([^:]{1,60}):\s*(.*)$/;

export function parseWhatsAppText(rawText: string): ParsedWhatsAppMessage[] {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const messages: ParsedWhatsAppMessage[] = [];
  let current: ParsedWhatsAppMessage | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(IOS_LINE);
    if (match) {
      if (current) messages.push(current);
      current = {
        sender: match[1].trim(),
        body: match[2].trim(),
      };
    } else if (current) {
      current.body += `\n${line}`;
    } else {
      // Plain pasted messages without WhatsApp timestamps
      current = {
        sender: 'WhatsApp Message',
        body: line,
      };
    }
  }
  if (current) messages.push(current);

  // Filter to messages that plausibly contain a job posting, referral, or URL
  const candidateMessages = messages.filter(
    (m) =>
      m.body.length >= 20 &&
      !/Messages and calls are end-to-end encrypted|<Media omitted>|omitted$/i.test(
        m.body
      ) &&
      (/hiring|role|position|job|intern|engineer|manager|director|analyst|apply|referral|resume|http|linkedin|greenhouse|lever|ashby|careers/i.test(
        m.body
      ) ||
        messages.length <= 8)
  );

  return candidateMessages.slice(-30);
}

const WHATSAPP_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    jobs: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          company: { type: Type.STRING },
          companyDomain: { type: Type.STRING },
          location: { type: Type.STRING },
          locationType: { type: Type.STRING },
          employmentType: { type: Type.STRING },
          salaryMin: { type: Type.NUMBER, nullable: true },
          salaryMax: { type: Type.NUMBER, nullable: true },
          salaryLabel: { type: Type.STRING },
          jobUrl: { type: Type.STRING },
          deadlineAt: { type: Type.STRING, nullable: true },
          skills: { type: Type.ARRAY, items: { type: Type.STRING } },
          summary: { type: Type.STRING },
          fullDescription: { type: Type.STRING },
          matchScore: { type: Type.NUMBER },
          matchReason: { type: Type.STRING },
          referrerNote: { type: Type.STRING },
        },
        required: [
          'title',
          'company',
          'location',
          'locationType',
          'salaryLabel',
          'skills',
          'summary',
          'matchScore',
          'matchReason',
        ],
      },
    },
  },
  required: ['jobs'],
};

export interface WhatsAppScanInput {
  rawText: string;
  groupName?: string;
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

export async function scanWhatsAppMessages(input: WhatsAppScanInput): Promise<{
  newJobs: JobRecord[];
  messagesScanned: number;
  runReport: AgentRunReport;
}> {
  const startMs = Date.now();
  const groupLabel = input.groupName?.trim() || 'WhatsApp Group';
  const parsedMessages = parseWhatsAppText(input.rawText);

  const now = new Date();
  const todayIso = formatIsoDateInTimeZone(now, input.timeZone);
  const nowTime = formatTimeInTimeZone(now, input.timeZone);

  if (parsedMessages.length === 0) {
    return {
      newJobs: [],
      messagesScanned: 0,
      runReport: {
        id: `run-wa-${Date.now()}`,
        completedAt: todayIso,
        completedTime: nowTime,
        trigger: 'manual',
        totalFetched: 0,
        totalSkipped: 0,
        totalAdded: 0,
        sourceResults: [
          {
            sourceId: 'src-whatsapp',
            sourceName: `WhatsApp · ${groupLabel}`,
            atsType: 'WhatsApp',
            status: 'ok',
            rawFetched: 0,
            duplicatesSkipped: 0,
            newlyScored: 0,
            durationMs: Date.now() - startMs,
          },
        ],
      },
    };
  }

  const ai = getAiClient();
  const activeRules = input.rules
    .filter((r) => r.active)
    .map((r) => `- ${r.text}`)
    .join('\n');
  const feedbackLines = input.recentFeedback
    .slice(0, 12)
    .map(
      (f) =>
        `- ${f.vote === 'up' ? 'LIKED' : 'DISLIKED'}: ${f.jobTitle} at ${f.company}${
          f.reason ? ` (${f.reason})` : ''
        }`
    )
    .join('\n');

  const prompt = `Extract distinct open job roles or referral opportunities from these WhatsApp messages ("${groupLabel}") and score each against the candidate's target criteria.
Include any referral contact mention in referrerNote. Skip non-job chatter.

Candidate Search Criteria:
${input.searchPrompt || 'Relevant roles matching candidate background.'}

Active Filter Rules:
${activeRules || 'None'}

Recent Triage Feedback:
${feedbackLines || 'None'}

WhatsApp Messages:
${parsedMessages
  .map((m, i) => `[${i + 1}] ${m.sender}: ${m.body.slice(0, 1000)}`)
  .join('\n\n')}`;

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: prompt,
    config: {
      thinkingConfig: LITE_THINKING_CONFIG,
      responseMimeType: 'application/json',
      responseSchema: WHATSAPP_SCHEMA,
    },
  });

  const parsed = JSON.parse(response.text || '{"jobs":[]}') as {
    jobs?: {
      title: string;
      company: string;
      companyDomain?: string;
      location: string;
      locationType: string;
      employmentType?: string;
      salaryMin?: number | null;
      salaryMax?: number | null;
      salaryLabel: string;
      jobUrl?: string;
      deadlineAt?: string | null;
      skills: string[];
      summary: string;
      fullDescription?: string;
      matchScore: number;
      matchReason: string;
      referrerNote?: string;
    }[];
  };

  const existingSet = new Set(input.existingHashes);
  const newJobs: JobRecord[] = [];
  let duplicatesSkipped = 0;

  for (const item of parsed.jobs ?? []) {
    if (!item.title || !item.company) continue;
    const canonicalUrl = canonicalizeJobUrl(item.jobUrl);
    const dedupKey = canonicalUrl
      ? canonicalUrl
      : `role:${normalizeCompanyKey(item.company) || item.company.trim().toLowerCase()}::${normalizeTitleKey(item.title) || item.title.trim().toLowerCase()}`;
    const urlHash = sha256Short(dedupKey);
    const dedupeCandidate = {
      urlHash,
      jobUrl: item.jobUrl,
      company: item.company,
      title: item.title,
    };
    if (hasMatchingDedupeKey(existingSet, dedupeCandidate)) {
      duplicatesSkipped += 1;
      continue;
    }
    registerDedupeKeys(existingSet, dedupeCandidate);

    const locType: LocationType =
      item.locationType === 'Hybrid' || item.locationType === 'Onsite'
        ? item.locationType
        : 'Remote';

    newJobs.push({
      id: `wa-${urlHash}`,
      urlHash,
      title: item.title.slice(0, 180),
      company: item.company.slice(0, 140),
      companyDomain:
        item.companyDomain ||
        `${item.company.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
      stage: 'inbox',
      isNew: true,
      matchScore: Math.max(0, Math.min(100, Math.round(item.matchScore || 76))),
      matchReason: item.matchReason || `Extracted from WhatsApp (${groupLabel}).`,
      salaryMin: typeof item.salaryMin === 'number' ? item.salaryMin : null,
      salaryMax: typeof item.salaryMax === 'number' ? item.salaryMax : null,
      salaryLabel: item.salaryLabel || 'Not listed',
      location: item.location || 'Unspecified',
      locationType: locType,
      employmentType: normalizeEmploymentTypeServer(
        item.employmentType,
        item.title,
        item.fullDescription || item.summary
      ),
      isMbaRole: detectIsMbaRoleServer(item.title),
      sourceId: 'src-whatsapp',
      sourceName: `WhatsApp · ${groupLabel}`,
      atsType: 'WhatsApp',
      jobUrl: item.jobUrl || '',
      discoveredAt: todayIso,
      discoveredTime: nowTime,
      deadlineAt:
        item.deadlineAt && /^\d{4}-\d{2}-\d{2}$/.test(item.deadlineAt)
          ? item.deadlineAt
          : null,
      skills: Array.isArray(item.skills) ? item.skills.slice(0, 8) : [],
      summary: item.summary || '',
      fullDescription: item.fullDescription?.trim() || item.summary || '',
      notes: item.referrerNote ? `WhatsApp note: ${item.referrerNote}` : '',
      feedback: null,
    });
  }

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
      console.error('Post-WhatsApp enrichment failed (non-blocking):', err);
    }
  }

  return {
    newJobs,
    messagesScanned: parsedMessages.length,
    runReport: {
      id: `run-wa-${Date.now()}`,
      completedAt: todayIso,
      completedTime: nowTime,
      trigger: 'manual',
      totalFetched: parsedMessages.length,
      totalSkipped: duplicatesSkipped,
      totalAdded: newJobs.length,
      sourceResults: [
        {
          sourceId: 'src-whatsapp',
          sourceName: `WhatsApp · ${groupLabel}`,
          atsType: 'WhatsApp',
          status: 'ok',
          rawFetched: parsedMessages.length,
          duplicatesSkipped,
          newlyScored: newJobs.length,
          durationMs: Date.now() - startMs,
        },
      ],
    },
  };
}
