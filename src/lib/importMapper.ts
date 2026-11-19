import { GoogleGenAI, Type } from '@google/genai';
import type { ColumnMappingSuggestion, MappableJobField } from '../types/job.ts';
import { GEMINI_LITE_MODEL, LITE_THINKING_CONFIG } from './geminiModels.ts';

const MODEL_NAME = GEMINI_LITE_MODEL;

const VALID_FIELDS: MappableJobField[] = [
  'ignore',
  'title',
  'company',
  'location',
  'locationType',
  'employmentType',
  'salaryLabel',
  'jobUrl',
  'stage',
  'deadlineAt',
  'discoveredAt',
  'skills',
  'summary',
  'notes',
  'sourceName',
];

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

const MAPPING_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    mappings: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          sourceColumn: { type: Type.STRING },
          targetField: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
          reason: { type: Type.STRING },
        },
        required: ['sourceColumn', 'targetField', 'confidence', 'reason'],
      },
    },
  },
  required: ['mappings'],
};

export async function suggestColumnMappingWithGemini(input: {
  headers: string[];
  sampleRows: Record<string, string>[];
}): Promise<ColumnMappingSuggestion[]> {
  const headers = input.headers.filter((h) => h.trim().length > 0).slice(0, 40);
  if (headers.length === 0) return [];

  const ai = getAiClient();

  const prompt = `Map each uploaded spreadsheet/JSON column to the best matching field in Meridian's normalized jobs database schema.
Allowed targetField values (use exact strings):
- title (job role / position title)
- company (employer / organization name)
- location (city, state, country)
- locationType (Remote, Hybrid, or Onsite)
- employmentType (Full-time, Internship, Contract, Part-time)
- salaryLabel (compensation, pay range, OTE)
- jobUrl (application link or posting URL)
- stage (pipeline status: inbox, saved, applied, interviewing, offer, archived)
- deadlineAt (application due date / close date)
- discoveredAt (date posted / date found / date added)
- skills (comma-separated tags, tech stack, keywords)
- summary (job description or role summary)
- notes (personal notes, referral contact, comments)
- sourceName (job board or referral source, e.g., LinkedIn, Indeed, Greenhouse)
- ignore (if column does not map cleanly or is redundant)

Try not to map two columns to the same targetField unless needed (prefer mapping the best column and setting duplicates to ignore or notes).

Uploaded Columns:
${JSON.stringify(headers)}

Sample Rows (first 4):
${JSON.stringify(input.sampleRows.slice(0, 4), null, 2)}`;

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: prompt,
    config: {
      thinkingConfig: LITE_THINKING_CONFIG,
      responseMimeType: 'application/json',
      responseSchema: MAPPING_SCHEMA,
    },
  });

  const parsed = JSON.parse(response.text || '{"mappings":[]}') as {
    mappings?: {
      sourceColumn: string;
      targetField: string;
      confidence: number;
      reason: string;
    }[];
  };

  const byCol = new Map<string, ColumnMappingSuggestion>();
  for (const item of parsed.mappings ?? []) {
    const field = VALID_FIELDS.includes(item.targetField as MappableJobField)
      ? (item.targetField as MappableJobField)
      : 'ignore';
    byCol.set(item.sourceColumn, {
      sourceColumn: item.sourceColumn,
      targetField: field,
      confidence: Math.max(0, Math.min(100, Math.round(item.confidence || 80))),
      reason: item.reason || 'Matched by column header and sample values.',
    });
  }

  return headers.map(
    (col) =>
      byCol.get(col) ?? {
        sourceColumn: col,
        targetField: 'ignore',
        confidence: 50,
        reason: 'Unmapped column — select a target field if needed.',
      }
  );
}
