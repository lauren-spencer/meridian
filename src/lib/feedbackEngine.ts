import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  AiRuleSuggestion,
  DislikeReason,
  JobRecord,
  PreferenceSynthesisResult,
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

export interface RichFeedbackItem {
  jobTitle: string;
  company: string;
  vote: 'up' | 'down';
  reason?: DislikeReason;
  locationType?: string;
  salaryLabel?: string;
  skills?: string[];
}

export interface RescoreInput {
  jobs: Pick<
    JobRecord,
    'id' | 'title' | 'company' | 'salaryLabel' | 'location' | 'locationType' | 'skills' | 'summary'
  >[];
  searchPrompt: string;
  rules: { text: string; active: boolean }[];
  recentFeedback: RichFeedbackItem[];
}

export interface RescoredJobPatch {
  id: string;
  matchScore: number;
  matchReason: string;
}

const RESCORE_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      matchScore: { type: Type.INTEGER },
      matchReason: { type: Type.STRING },
    },
    required: ['id', 'matchScore', 'matchReason'],
  },
};

export async function rescoreJobsWithFeedback(
  input: RescoreInput
): Promise<RescoredJobPatch[]> {
  if (input.jobs.length === 0) return [];

  const ai = getGeminiClient();

  const activeRules = input.rules
    .filter((r) => r.active)
    .map((r) => `- ${r.text}`)
    .join('\n');

  const likes = input.recentFeedback
    .filter((f) => f.vote === 'up')
    .slice(0, 15)
    .map(
      (f) =>
        `${f.jobTitle} @ ${f.company}${f.locationType ? ` [${f.locationType}]` : ''}${f.salaryLabel ? ` (${f.salaryLabel})` : ''}`
    )
    .join('\n- ');

  const dislikes = input.recentFeedback
    .filter((f) => f.vote === 'down')
    .slice(0, 15)
    .map(
      (f) =>
        `${f.jobTitle} @ ${f.company}${f.reason ? ` — reason: ${f.reason}` : ''}${f.locationType ? ` [${f.locationType}]` : ''}`
    )
    .join('\n- ');

  const prompt = `Re-score each candidate job below (0–100) using the user's updated target criteria, active filter rules, and few-shot feedback history.

USER CRITERIA:
${input.searchPrompt}

ACTIVE FILTER RULES:
${activeRules || '- None'}

RECENT LIKES (👍):
${likes ? `- ${likes}` : '- None yet'}

RECENT DISLIKES (👎):
${dislikes ? `- ${dislikes}` : '- None yet'}

INSTRUCTIONS:
- Return one object per job matching its exact "id".
- Adjust matchScore decisively upward if the role closely resembles Recent Likes and satisfies all Active Rules.
- Penalize matchScore decisively downward if the role violates an Active Rule or shares attributes with Recent Dislikes (e.g., wrong employment type, low pay, company fit, wrong role type, location).
- Write a crisp 1-sentence matchReason citing the concrete criteria or feedback alignment.

JOBS TO RE-SCORE:
${JSON.stringify(input.jobs.slice(0, 20))}`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: RESCORE_SCHEMA,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  const parsed = JSON.parse((response.text ?? '[]').trim()) as RescoredJobPatch[];
  return parsed
    .filter((item) => item && typeof item.id === 'string')
    .map((item) => ({
      id: item.id,
      matchScore: Math.min(100, Math.max(0, Math.round(Number(item.matchScore) || 70))),
      matchReason: String(item.matchReason || '').trim(),
    }));
}

export interface SynthesizeFeedbackInput {
  searchPrompt: string;
  rules: { text: string; active: boolean }[];
  recentFeedback: RichFeedbackItem[];
}

const SYNTHESIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    preferenceSummary: {
      type: Type.STRING,
      description:
        'A concise 1-2 sentence synthesis of what the user consistently gravitates toward and filters out.',
    },
    suggestions: {
      type: Type.ARRAY,
      description:
        '1 to 3 concrete, non-duplicate filter rules inferred from recent likes and dislikes.',
      items: {
        type: Type.OBJECT,
        properties: {
          proposedRule: {
            type: Type.STRING,
            description: 'Short, actionable rule text (under 90 chars).',
          },
          rationale: {
            type: Type.STRING,
            description:
              '1 sentence referencing the specific feedback pattern that prompted this rule.',
          },
          evidenceCount: {
            type: Type.INTEGER,
            description: 'How many feedback signals support this suggestion.',
          },
        },
        required: ['proposedRule', 'rationale', 'evidenceCount'],
      },
    },
  },
  required: ['preferenceSummary', 'suggestions'],
};

export async function synthesizePreferencesWithGemini(
  input: SynthesizeFeedbackInput
): Promise<PreferenceSynthesisResult> {
  const ai = getGeminiClient();

  const existingRulesText = input.rules.map((r) => `- ${r.text}`).join('\n');
  const feedbackLines = input.recentFeedback
    .slice(0, 25)
    .map(
      (f) =>
        `- ${f.vote === 'up' ? 'LIKED' : 'DISLIKED'}: ${f.jobTitle} @ ${f.company}` +
        `${f.locationType ? ` | ${f.locationType}` : ''}` +
        `${f.salaryLabel ? ` | ${f.salaryLabel}` : ''}` +
        `${f.reason ? ` | Reason: ${f.reason}` : ''}` +
        `${f.skills && f.skills.length > 0 ? ` | Skills: ${f.skills.join(', ')}` : ''}`
    )
    .join('\n');

  const prompt = `Analyze this user's recent job triage feedback (likes and dislikes) against their current search prompt and existing rules.

CURRENT TARGET PROMPT:
${input.searchPrompt}

EXISTING RULES (do NOT propose duplicates of these):
${existingRulesText || '- None'}

RECENT FEEDBACK HISTORY:
${feedbackLines || '- No feedback logged yet'}

INSTRUCTIONS:
1. Write a sharp 1-2 sentence "preferenceSummary" capturing the user's real revealed preferences.
2. Propose 1 to 3 genuinely new, specific, non-duplicate filter rules in "suggestions" based on clear patterns in the feedback (especially recurring dislikes or strong positive signals). If there is very little feedback, return 1 helpful refinement suggestion.`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: SYNTHESIS_SCHEMA,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    preferenceSummary?: string;
    suggestions?: {
      proposedRule: string;
      rationale: string;
      evidenceCount: number;
    }[];
  };

  const existingLower = new Set(input.rules.map((r) => r.text.toLowerCase().trim()));
  const suggestions: AiRuleSuggestion[] = (parsed.suggestions ?? [])
    .filter(
      (s) =>
        s &&
        typeof s.proposedRule === 'string' &&
        s.proposedRule.trim().length > 0 &&
        !existingLower.has(s.proposedRule.toLowerCase().trim())
    )
    .slice(0, 3)
    .map((s, idx) => ({
      id: `aisug-${Date.now()}-${idx}`,
      proposedRule: s.proposedRule.trim(),
      rationale: s.rationale?.trim() || 'Inferred from recent triage feedback.',
      evidenceCount: Math.max(1, Math.round(Number(s.evidenceCount) || 1)),
      dismissed: false,
    }));

  const nowTime = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return {
    preferenceSummary:
      parsed.preferenceSummary?.trim() ||
      'Log a few more upvotes and downvotes to generate a detailed preference profile.',
    suggestions,
    synthesizedAt: `Today, ${nowTime}`,
  };
}
