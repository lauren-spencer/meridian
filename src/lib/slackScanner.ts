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

export function buildSlackAuthUrl(
  redirectUri: string,
  state?: string
): {
  configured: boolean;
  hasClientId: boolean;
  hasClientSecret: boolean;
  url?: string;
} {
  const rawId = process.env.SLACK_CLIENT_ID?.trim() || '';
  const rawSecret = process.env.SLACK_CLIENT_SECRET?.trim() || '';
  const hasClientId = Boolean(rawId) && !rawId.includes('MY_SLACK_CLIENT_ID');
  const hasClientSecret = Boolean(rawSecret) && !rawSecret.includes('MY_SLACK_CLIENT_SECRET');

  if (!hasClientId || !hasClientSecret) {
    return { configured: false, hasClientId, hasClientSecret };
  }

  const params = new URLSearchParams({
    client_id: rawId,
    redirect_uri: redirectUri,
    user_scope: 'channels:read,channels:history,groups:read,groups:history',
  });
  if (state) {
    params.set('state', state);
  }

  return {
    configured: true,
    hasClientId,
    hasClientSecret,
    url: `https://slack.com/oauth/v2/authorize?${params.toString()}`,
  };
}

function formatSlackExchangeError(code: string, redirectUri: string): string {
  switch (code) {
    case 'redirect_uri_mismatch':
    case 'bad_redirect_uri':
      return `Slack rejected the Redirect URL (${redirectUri}). Add this exact URL in your Slack App under OAuth & Permissions -> Redirect URLs and click Save URLs.`;
    case 'invalid_client_id':
      return 'Invalid SLACK_CLIENT_ID. Double-check the Client ID from your Slack App Basic Information page.';
    case 'bad_client_secret':
      return 'Invalid SLACK_CLIENT_SECRET. Copy the exact Client Secret from your Slack App Basic Information page into AI Studio Secrets.';
    case 'invalid_code':
    case 'code_already_used':
      return 'Slack authorization code expired or was already used. Please click Connect Slack again.';
    case 'invalid_scope':
      return 'Slack rejected the requested scopes. Under OAuth & Permissions -> User Token Scopes, add: channels:read, channels:history, groups:read, groups:history.';
    default:
      return `Slack OAuth exchange failed: ${code}`;
  }
}

export async function exchangeSlackCode(
  code: string,
  redirectUri: string
): Promise<{
  accessToken: string;
  teamName: string;
  authedUserId: string;
}> {
  const clientId = process.env.SLACK_CLIENT_ID?.trim();
  const clientSecret = process.env.SLACK_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing SLACK_CLIENT_ID or SLACK_CLIENT_SECRET in AI Studio Secrets.'
    );
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = (await res.json()) as {
    ok?: boolean;
    error?: string;
    team?: { name?: string };
    authed_user?: { id?: string; access_token?: string };
    access_token?: string;
  };

  if (!data.ok) {
    throw new Error(formatSlackExchangeError(data.error || 'unknown_error', redirectUri));
  }

  const token = data.authed_user?.access_token || data.access_token;
  if (!token) {
    throw new Error(
      'Slack connected, but did not return a user access token. Ensure channels:read and channels:history are added under User Token Scopes (not just Bot Token Scopes).'
    );
  }

  return {
    accessToken: token,
    teamName: data.team?.name || 'Slack Workspace',
    authedUserId: data.authed_user?.id || '',
  };
}

interface SlackChannel {
  id: string;
  name: string;
}

interface SlackMessage {
  ts: string;
  text: string;
  channelName: string;
}

const SLACK_EXTRACT_SCHEMA = {
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
          channelName: { type: Type.STRING },
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

export interface SlackScanInput {
  accessToken: string;
  channels?: string[];
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

export async function scanSlackForJobs(input: SlackScanInput): Promise<{
  newJobs: JobRecord[];
  messagesScanned: number;
  channelsScanned: string[];
  runReport: AgentRunReport;
}> {
  const startMs = Date.now();
  const listRes = await fetch(
    'https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=200',
    {
      headers: { Authorization: `Bearer ${input.accessToken}` },
    }
  );
  const listData = (await listRes.json()) as {
    ok?: boolean;
    error?: string;
    channels?: { id?: string; name?: string; is_member?: boolean }[];
  };

  if (!listData.ok) {
    const err = new Error(`Slack API error: ${listData.error || 'unauthorized'}`) as Error & {
      status?: number;
    };
    if (listData.error === 'invalid_auth' || listData.error === 'token_revoked') {
      err.status = 401;
    }
    throw err;
  }

  const wantedPatterns = (
    input.channels && input.channels.length > 0
      ? input.channels
      : ['jobs', 'hiring', 'careers', 'referrals']
  ).map((c) => c.trim().toLowerCase().replace(/^#/, ''));

  const matchingChannels: SlackChannel[] = (listData.channels ?? [])
    .filter((ch): ch is { id: string; name: string; is_member?: boolean } =>
      Boolean(ch.id && ch.name)
    )
    .filter((ch) => {
      const lname = ch.name.toLowerCase();
      return wantedPatterns.some((p) => lname.includes(p));
    })
    .slice(0, 6);

  const collectedMessages: SlackMessage[] = [];
  for (const ch of matchingChannels) {
    const histRes = await fetch(
      `https://slack.com/api/conversations.history?channel=${encodeURIComponent(ch.id)}&limit=25`,
      {
        headers: { Authorization: `Bearer ${input.accessToken}` },
      }
    );
    const histData = (await histRes.json()) as {
      ok?: boolean;
      messages?: { ts?: string; text?: string; subtype?: string }[];
    };
    if (!histData.ok || !Array.isArray(histData.messages)) continue;

    for (const msg of histData.messages) {
      if (!msg.text || msg.text.length < 30 || msg.subtype === 'channel_join') continue;
      if (
        /hiring|role|position|engineer|manager|intern|apply|referral|careers|greenhouse|lever|ashby|linkedin\.com\/jobs|http/i.test(
          msg.text
        )
      ) {
        collectedMessages.push({
          ts: msg.ts || String(Date.now()),
          text: msg.text.slice(0, 1200),
          channelName: ch.name,
        });
      }
    }
  }

  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const nowTime = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (collectedMessages.length === 0) {
    return {
      newJobs: [],
      messagesScanned: 0,
      channelsScanned: matchingChannels.map((c) => `#${c.name}`),
      runReport: {
        id: `run-slack-${Date.now()}`,
        completedAt: todayIso,
        completedTime: nowTime,
        trigger: 'manual',
        totalFetched: 0,
        totalSkipped: 0,
        totalAdded: 0,
        sourceResults: [
          {
            sourceId: 'src-slack',
            sourceName: 'Slack Job Channels',
            atsType: 'Slack',
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
  const activeRules = input.rules.filter((r) => r.active).map((r) => `- ${r.text}`).join('\n');
  const feedbackLines = input.recentFeedback
    .slice(0, 12)
    .map(
      (f) =>
        `- ${f.vote === 'up' ? 'LIKED' : 'DISLIKED'}: ${f.jobTitle} at ${f.company}${
          f.reason ? ` (${f.reason})` : ''
        }`
    )
    .join('\n');

  const prompt = `Extract distinct, concrete job postings shared in these Slack channel messages and score each against the candidate's criteria.
Ignore general chatter that does not describe a specific open job.

Candidate Search Criteria:
${input.searchPrompt || 'Relevant roles matching candidate background.'}

Active Filter Rules:
${activeRules || 'None'}

Recent Triage Feedback:
${feedbackLines || 'None'}

Slack Messages:
${collectedMessages
  .slice(0, 25)
  .map((m, idx) => `[${idx + 1}] #${m.channelName}: ${m.text}`)
  .join('\n\n')}`;

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: prompt,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: SLACK_EXTRACT_SCHEMA,
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
      channelName?: string;
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
      id: `slack-${urlHash}`,
      urlHash,
      title: item.title.slice(0, 180),
      company: item.company.slice(0, 140),
      companyDomain:
        item.companyDomain ||
        `${item.company.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
      stage: 'inbox',
      isNew: true,
      matchScore: Math.max(0, Math.min(100, Math.round(item.matchScore || 75))),
      matchReason: item.matchReason || 'Extracted from Slack job channel.',
      salaryMin: typeof item.salaryMin === 'number' ? item.salaryMin : null,
      salaryMax: typeof item.salaryMax === 'number' ? item.salaryMax : null,
      salaryLabel: item.salaryLabel || 'Not listed',
      location: item.location || 'Unspecified',
      locationType: locType,
      employmentType: item.employmentType || 'Full-time',
      sourceId: 'src-slack',
      sourceName: item.channelName ? `Slack #${item.channelName}` : 'Slack Channels',
      atsType: 'Slack',
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
      notes: '',
      feedback: null,
    });
  }

  return {
    newJobs,
    messagesScanned: collectedMessages.length,
    channelsScanned: matchingChannels.map((c) => `#${c.name}`),
    runReport: {
      id: `run-slack-${Date.now()}`,
      completedAt: todayIso,
      completedTime: nowTime,
      trigger: 'manual',
      totalFetched: collectedMessages.length,
      totalSkipped: duplicatesSkipped,
      totalAdded: newJobs.length,
      sourceResults: [
        {
          sourceId: 'src-slack',
          sourceName: `Slack (${matchingChannels.map((c) => `#${c.name}`).join(', ') || 'No matching channels'})`,
          atsType: 'Slack',
          status: 'ok',
          rawFetched: collectedMessages.length,
          duplicatesSkipped,
          newlyScored: newJobs.length,
          durationMs: Date.now() - startMs,
        },
      ],
    },
  };
}
