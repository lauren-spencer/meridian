import { ThinkingLevel } from '@google/genai';

/**
 * Quota-efficient Gemini model selection:
 * - GEMINI_LITE_MODEL ('gemini-3.1-flash-lite') has the highest RPM/RPD quota
 *   and lowest token overhead, supporting ThinkingLevel.MINIMAL (no extra thinking tokens).
 * - GEMINI_WRITER_MODEL also uses 'gemini-3.1-flash-lite' with ThinkingLevel.LOW
 *   for tailored resumes and cover letters to keep quota consumption minimal.
 */
export const GEMINI_LITE_MODEL = 'gemini-3.1-flash-lite';
export const GEMINI_WRITER_MODEL = 'gemini-3.1-flash-lite';

export const LITE_THINKING_CONFIG = {
  thinkingLevel: ThinkingLevel.MINIMAL,
};

export const WRITER_THINKING_CONFIG = {
  thinkingLevel: ThinkingLevel.LOW,
};

/**
 * Formats upstream Gemini API errors (including JSON-encoded 429/403 payloads)
 * into clean, actionable messages while preserving HTTP status codes.
 */
export function formatGeminiApiError(
  error: unknown,
  fallbackMessage: string
): { statusCode: number; message: string } {
  const errObj = error as { status?: number; code?: number; message?: string };
  let statusCode =
    typeof errObj?.status === 'number' && errObj.status >= 400 && errObj.status < 600
      ? errObj.status
      : typeof errObj?.code === 'number' && errObj.code >= 400 && errObj.code < 600
      ? errObj.code
      : 500;

  const rawMsg = typeof errObj?.message === 'string' ? errObj.message.trim() : '';

  // Detect JSON-encoded Google API error payloads inside err.message
  if (rawMsg.includes('RESOURCE_EXHAUSTED') || statusCode === 429 || rawMsg.includes('"code":429')) {
    return {
      statusCode: 429,
      message:
        'Gemini API quota limit reached (429). Per-minute limits reset in 60s and daily free-tier limits reset at midnight PT (2:00 AM CST). For higher limits, select a billing-enabled API key in Settings > Secrets.',
    };
  }

  if (rawMsg.includes('PERMISSION_DENIED') || statusCode === 403) {
    return {
      statusCode: 403,
      message:
        'Gemini API permission denied (403). Please verify your API key in Settings > Secrets.',
    };
  }

  if (rawMsg.includes('API_KEY_INVALID')) {
    return {
      statusCode: 400,
      message:
        'Gemini API key appears invalid. Please check your API key in Settings > Secrets.',
    };
  }

  return {
    statusCode,
    message: rawMsg || fallbackMessage,
  };
}
