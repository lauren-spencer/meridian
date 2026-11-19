import crypto from 'node:crypto';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  AgentRunReport,
  DislikeReason,
  JobRecord,
  LocationType,
} from '../types/job.ts';

const MODEL_NAME = 'gemini-4-hydrogen';

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
  const todayIso = now.toISOString().slice(0, 10);
  const nowTime = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

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
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
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
    const dedupKey = item.jobUrl?.trim()
      ? item.jobUrl.trim()
      : `${item.company}|${item.title}|${item.location || ''}`;
    const urlHash = sha256Short(dedupKey);
    if (existingSet.has(urlHash)) {
      duplicatesSkipped += 1;
      continue;
    }
    existingSet.add(urlHash);

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
      employmentType: item.employmentType || 'Full-time',
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
