import { GoogleGenAI, Type } from '@google/genai';
import type { ChatApiResponse, WorkspaceChatContext } from '../types/chat.ts';
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

const CHAT_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    reply: {
      type: Type.STRING,
      description:
        'A concise, helpful conversational reply to the user explaining any workspace changes made or answering their question.',
    },
    actions: {
      type: Type.ARRAY,
      description:
        'Optional list of structured workspace mutations requested by the user. Return an empty array if no state changes are needed.',
      items: {
        type: Type.OBJECT,
        properties: {
          type: {
            type: Type.STRING,
            description:
              'One of: update_criteria_prompt, add_rule, remove_rule, toggle_rule, log_feedback, move_job_stage',
          },
          prompt: {
            type: Type.STRING,
            description: 'Full updated target criteria prompt (for update_criteria_prompt).',
          },
          ruleText: {
            type: Type.STRING,
            description: 'Concise filter rule text (for add_rule).',
          },
          ruleId: {
            type: Type.STRING,
            description: 'Existing rule id from workspace context (for remove_rule or toggle_rule).',
          },
          active: {
            type: Type.BOOLEAN,
            description: 'Desired active boolean (for toggle_rule).',
          },
          jobId: {
            type: Type.STRING,
            description: 'Existing job id from workspace context (for log_feedback or move_job_stage).',
          },
          vote: {
            type: Type.STRING,
            description: 'Either "up" or "down" (for log_feedback).',
          },
          reason: {
            type: Type.STRING,
            description:
              'Optional dislike reason for vote="down". Must be one of: "Wrong employment type", "Low pay", "Company fit", "Wrong role type", "Location".',
          },
          stage: {
            type: Type.STRING,
            description:
              'Target pipeline stage for move_job_stage: "inbox", "saved", "applied", "interviewing", "offer", or "archived".',
          },
        },
        required: ['type'],
      },
    },
  },
  required: ['reply', 'actions'],
};

function buildSystemInstruction(context: WorkspaceChatContext): string {
  const rulesText =
    context.rules.length > 0
      ? context.rules
          .map(
            (r) =>
              `- [${r.id}] (${r.active ? 'active' : 'paused'}, ${r.origin}): ${r.text}`
          )
          .join('\n')
      : '- (No explicit rules yet)';

  const jobsText = context.jobs
    .slice(0, 25)
    .map(
      (j) =>
        `- [${j.id}] ${j.title} @ ${j.company} | stage=${j.stage}${j.isNew ? ' (NEW)' : ''} | match=${j.matchScore}% | ${j.salaryLabel} | ${j.locationType} (${j.location})`
    )
    .join('\n');

  const feedbackText =
    context.recentFeedback.length > 0
      ? context.recentFeedback
          .slice(0, 12)
          .map(
            (f) =>
              `- ${f.vote === 'up' ? 'THUMBS UP' : 'THUMBS DOWN'}: ${f.jobTitle} @ ${f.company}${f.reason ? ` (reason: ${f.reason})` : ''}`
          )
          .join('\n')
      : '- (No feedback logged yet)';

  return `You are Meridian's Job Search & Feedback Assistant.
Your job is to help the user refine what roles they are looking for, record feedback on specific jobs in their workspace, adjust filter rules, and analyze patterns in their likes and dislikes.

Behavior guidelines:
- Be concise, direct, and grounded in the user's actual workspace state below.
- When the user asks to change what they are looking for (e.g., salary floor, remote preference, tech stack, seniority, company stage), emit an "update_criteria_prompt" action with a cleanly rewritten full criteria prompt preserving their other unchanged preferences, AND/OR emit an "add_rule" action for crisp hard constraints.
- When the user gives feedback on a specific listed role (e.g., "hide the Solutions Architect role, wrong role type" or "save the Kestrel query engine job"), match it to its exact jobId below and emit a "log_feedback" action (or "move_job_stage" if they ask to move it to applied/interviewing/offer).
- When the user asks to remove or pause an existing rule, reference its exact ruleId below.
- Only invent actions when the user clearly requests or confirms a change; if they are just asking a question or brainstorming, return an empty actions array and answer thoughtfully.
- Keep replies crisp (2–4 sentences unless summarizing multiple roles).

CURRENT WORKSPACE STATE:
Target Criteria Prompt:
${context.searchPrompt}

Filter Rules:
${rulesText}

Tracked Roles:
${jobsText}

Recent Feedback Memory:
${feedbackText}`;
}

export async function runMeridianChat(params: {
  message: string;
  history: { role: 'user' | 'model'; text: string }[];
  workspaceContext: WorkspaceChatContext;
}): Promise<ChatApiResponse> {
  const ai = getGeminiClient();

  const formattedHistory = params.history
    .filter((item) => item.text.trim().length > 0)
    .slice(-20)
    .map((item) => ({
      role: item.role,
      parts: [{ text: item.text }],
    }));

  const chat = ai.chats.create({
    model: GEMINI_LITE_MODEL,
    history: formattedHistory,
    config: {
      systemInstruction: buildSystemInstruction(params.workspaceContext),
      responseMimeType: 'application/json',
      responseSchema: CHAT_RESPONSE_SCHEMA,
      thinkingConfig: LITE_THINKING_CONFIG,
    },
  });

  const response = await chat.sendMessage({
    message: params.message,
  });

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('The assistant returned an empty response. Please try again.');
  }

  try {
    const parsed = JSON.parse(rawText) as Partial<ChatApiResponse>;
    return {
      reply:
        typeof parsed.reply === 'string' && parsed.reply.trim()
          ? parsed.reply.trim()
          : 'Updated your workspace preferences.',
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    };
  } catch {
    return {
      reply: rawText,
      actions: [],
    };
  }
}
