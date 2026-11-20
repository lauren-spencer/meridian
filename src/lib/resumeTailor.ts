import { GoogleGenAI, Type } from '@google/genai';
import {
  AlignmentType,
  BorderStyle,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  Document,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import mammoth from 'mammoth';
import type {
  CareerExperienceItem,
  JobRecord,
  ResumeCommentCategory,
  ResumeReviewComment,
  ResumeReviewDocument,
  RoleResume,
} from '../types/job.ts';
import { formatTimeInTimeZone } from './dateTime.ts';
import {
  GEMINI_LITE_MODEL,
  GEMINI_WRITER_MODEL,
  LITE_THINKING_CONFIG,
  WRITER_THINKING_CONFIG,
} from './geminiModels.ts';

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

/**
 * Extracts plain text from an uploaded document (.docx, .pdf, .txt, .md).
 */
export async function parseUploadedResume(params: {
  fileName: string;
  mimeType?: string;
  base64Data: string;
}): Promise<{ rawText: string }> {
  const lowerName = params.fileName.toLowerCase();
  const buffer = Buffer.from(params.base64Data, 'base64');

  if (buffer.length === 0) {
    throw new Error('Uploaded file appears empty.');
  }

  // .docx via mammoth
  if (
    lowerName.endsWith('.docx') ||
    params.mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const result = await mammoth.extractRawText({ buffer });
    const text = (result.value || '')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!text) {
      throw new Error(
        'Could not extract text from this .docx file. Make sure it contains selectable text (not only scanned images).'
      );
    }
    return { rawText: text.slice(0, 25000) };
  }

  // .txt or .md
  if (
    lowerName.endsWith('.txt') ||
    lowerName.endsWith('.md') ||
    params.mimeType === 'text/plain' ||
    params.mimeType === 'text/markdown'
  ) {
    const text = buffer
      .toString('utf8')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!text) {
      throw new Error('Uploaded text file is empty.');
    }
    return { rawText: text.slice(0, 25000) };
  }

  // .pdf via Gemini multimodal verbatim transcription
  if (lowerName.endsWith('.pdf') || params.mimeType === 'application/pdf') {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: GEMINI_LITE_MODEL,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: params.base64Data,
            },
          },
          {
            text: 'Transcribe this document verbatim into clean plain text. Preserve all section headings, company names, role titles, dates, locations, bullet points (prefixed with "- "), education, and skills. Do not summarize or omit any metrics or wording. Output only the plain text.',
          },
        ],
      },
      config: {
        thinkingConfig: LITE_THINKING_CONFIG,
      },
    });
    const text = (response.text ?? '').trim();
    if (!text) {
      throw new Error('Could not extract text from the uploaded PDF.');
    }
    return { rawText: text.slice(0, 25000) };
  }

  throw new Error(
    'Unsupported file format. Please upload a .docx, .pdf, .txt, or .md file.'
  );
}

/**
 * Splits a base resume's raw text into clean, verbatim, non-empty lines so review
 * comments can anchor to exact 1-based line numbers without ever altering the resume.
 */
function extractVerbatimBaseLines(rawText: string): string[] {
  return rawText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 260);
}

const RESUME_REVIEW_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    overallFitNote: {
      type: Type.STRING,
      description:
        '2-3 concise sentences summarizing how well this base resume fits the target role and the single highest-leverage adjustment to make.',
    },
    missingRequirements: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        '3-6 crisp keywords, qualifications, tools, or domain requirements emphasized in the job description that are currently missing or under-evidenced on the base resume.',
    },
    comments: {
      type: Type.ARRAY,
      description:
        '8-14 specific, actionable margin review comments anchored to exact line numbers of the base resume covering what to MOVE, ADD, REMOVE, or what is MISSING.',
      items: {
        type: Type.OBJECT,
        properties: {
          category: {
            type: Type.STRING,
            description: 'Must be one of: "move", "add", "remove", "missing".',
          },
          anchorLineNumber: {
            type: Type.INTEGER,
            description:
              'Exact 1-based line number from the numbered base resume ([L#]) where this comment should attach. Use 0 only if the comment applies to the resume overall (e.g., a missing requirement with no natural line anchor).',
          },
          anchorQuote: {
            type: Type.STRING,
            description:
              'Short verbatim snippet (up to ~120 chars) from the anchored base resume line, or the section heading where an addition/gap belongs.',
          },
          sectionLabel: {
            type: Type.STRING,
            description:
              'Section or role label on the base resume (e.g., "Experience — Roche", "Skills", "Education", "Overall / Missing").',
          },
          title: {
            type: Type.STRING,
            description:
              'Short, scannable action headline (e.g., "Move pricing model bullet to #1 under Acme", "Add off-resume SQL dashboard project", "Remove generic event planning bullet", "Missing: FDA regulatory launch exposure").',
          },
          comment: {
            type: Type.STRING,
            description:
              'Concrete, specific reviewer note explaining what to move, add, remove, or address as missing, tied directly to the job description. Never rewrite the whole resume—speak as a sharp human career coach leaving margin comments.',
          },
          suggestedText: {
            type: Type.STRING,
            description:
              'Optional short suggested bullet/phrase or off-resume item to consider inserting (empty string if not applicable, e.g., for simple remove/move comments). Never fabricate facts.',
          },
          fromExtendedContext: {
            type: Type.BOOLEAN,
            description:
              'True only if this comment explicitly recommends bringing in a skill, role, project, or metric from the candidate non-resume / extended career context.',
          },
        },
        required: [
          'category',
          'anchorLineNumber',
          'anchorQuote',
          'sectionLabel',
          'title',
          'comment',
        ],
      },
    },
  },
  required: ['overallFitNote', 'missingRequirements', 'comments'],
};

function normalizeCategory(raw: unknown): ResumeCommentCategory {
  const val = String(raw ?? '').trim().toLowerCase();
  if (val === 'move' || val === 'add' || val === 'remove' || val === 'missing') {
    return val;
  }
  if (val.includes('move') || val.includes('reorder') || val.includes('elevat')) {
    return 'move';
  }
  if (val.includes('remove') || val.includes('cut') || val.includes('trim') || val.includes('delete')) {
    return 'remove';
  }
  if (val.includes('miss') || val.includes('gap')) {
    return 'missing';
  }
  return 'add';
}

/**
 * Reviews a role-specific base resume against a target job description using Gemini
 * and leaves anchored margin comments (Move / Add / Remove / Missing) without
 * directly editing the base resume.
 */
export async function reviewResumeForJob(params: {
  job: Pick<
    JobRecord,
    'title' | 'company' | 'location' | 'locationType' | 'skills' | 'summary' | 'fullDescription'
  >;
  baseResume: RoleResume;
  careerExperiences: CareerExperienceItem[];
  careerContextNotes: string;
  customInstructions?: string;
  timeZone?: string;
}): Promise<ResumeReviewDocument> {
  const ai = getGeminiClient();

  const baseLines = extractVerbatimBaseLines(params.baseResume.rawText);
  if (baseLines.length === 0) {
    throw new Error('The selected base resume appears empty.');
  }

  const numberedBaseResume = baseLines
    .map((line, idx) => `[L${idx + 1}] ${line}`)
    .join('\n')
    .slice(0, 20000);

  const offResumeItems = params.careerExperiences.filter((exp) => !exp.onResume);
  const hasExtendedContext =
    offResumeItems.length > 0 ||
    params.careerExperiences.length > 0 ||
    Boolean(params.careerContextNotes?.trim());

  const extendedExperiencesText =
    params.careerExperiences.length > 0
      ? params.careerExperiences
          .map(
            (exp, idx) =>
              `${idx + 1}. [${exp.onResume ? 'ON RESUME (EXTRA DETAIL)' : 'OFF-RESUME — NOT ON BASE RESUME'}] ${exp.title} @ ${exp.organization}${exp.dates ? ` (${exp.dates})` : ''}\n   Details: ${exp.details}`
          )
          .join('\n\n')
      : '(No structured off-resume roles or projects added yet.)';

  const brainDumpText = params.careerContextNotes?.trim()
    ? params.careerContextNotes.trim().slice(0, 12000)
    : '(No additional non-resume skills or background notes provided yet.)';

  const jdText = (params.job.fullDescription || params.job.summary || '').slice(0, 12000);

  const systemInstruction = `You are a sharp, executive-level career coach and hiring manager reviewing a candidate's BASE RESUME for a specific TARGET JOB.

CRITICAL ROLE — COMMENT ONLY, DO NOT DIRECTLY EDIT:
Instead of rewriting the candidate's resume, you leave anchored, specific margin comments on the existing BASE RESUME lines telling the candidate exactly:
1. "move" — What to move up, reorder, or elevate (e.g., move a highly relevant bullet to the top of a role, shift a relevant section/project higher, reorder skills to mirror JD priorities).
2. "add" — What to add right at a specific section/line (e.g., surface specific JD terminology/metrics, expand a relevant point, or bring in a specific role, project, skill, or metric from the candidate's NON-RESUME / EXTENDED CONTEXT).
3. "remove" — What to cut, condense, or trim (e.g., low-relevance bullets, outdated coursework, or redundant detail that should be removed to make space for higher-value points and maintain a tight 1-page resume).
4. "missing" — Critical qualifications, tools, domain expertise, or experiences emphasized by the job description that are currently absent from the base resume.

STRICT GROUNDING RULES:
- ZERO FABRICATION: Never invent employers, titles, tools, metrics, or experiences the candidate has not listed in either the BASE RESUME or the NON-RESUME / EXTENDED CONTEXT.
- When NON-RESUME / EXTENDED CONTEXT is provided and contains a relevant unlisted project, role, skill, or deeper metric, explicitly recommend adding it via an "add" comment with fromExtendedContext=true and cite the exact real detail in suggestedText.
- When NON-RESUME / EXTENDED CONTEXT is empty or does not cover a JD requirement, flag the gap honestly under category="missing" and suggest what kind of experience/metric to add if the candidate has it.
- Anchor every comment to the exact 1-based line number [L#] from the numbered BASE RESUME where the reviewer would attach a margin comment in Word/Google Docs (use anchorLineNumber=0 only for truly document-wide missing gaps).
- Provide a balanced, practical set of 8–14 high-signal comments covering Move, Add, Remove, and Missing (include at least one of each category whenever genuinely warranted by the resume & JD).
- Keep comments crisp, direct, and actionable (2–3 sentences max per comment).`;

  const userPrompt = `TARGET JOB:
Title: ${params.job.title}
Company: ${params.job.company}
Location: ${params.job.location} (${params.job.locationType})
Key Skills: ${params.job.skills.join(', ')}

JOB DESCRIPTION:
${jdText}

${params.customInstructions?.trim() ? `USER'S REVIEW FOCUS FOR THIS ROLE:\n${params.customInstructions.trim()}\n` : ''}
NUMBERED BASE RESUME (Role Track: ${params.baseResume.roleType} | File: ${params.baseResume.fileName}):
${numberedBaseResume}

CANDIDATE'S NON-RESUME / EXTENDED ROLES & PROJECTS:
${extendedExperiencesText}

CANDIDATE'S ADDITIONAL NON-RESUME SKILLS, ACHIEVEMENTS & BACKGROUND NOTES:
${brainDumpText}

Leave anchored margin review comments (move, add, remove, missing) on this base resume for the target role.`;

  const response = await ai.models.generateContent({
    model: GEMINI_WRITER_MODEL,
    contents: userPrompt,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: RESUME_REVIEW_SCHEMA,
      thinkingConfig: WRITER_THINKING_CONFIG,
    },
  });

  const rawJson = (response.text ?? '').trim();
  if (!rawJson) {
    throw new Error('Resume review returned an empty response. Please try again.');
  }

  const parsed = JSON.parse(rawJson) as {
    overallFitNote?: string;
    missingRequirements?: string[];
    comments?: Array<{
      category?: string;
      anchorLineNumber?: number;
      anchorQuote?: string;
      sectionLabel?: string;
      title?: string;
      comment?: string;
      suggestedText?: string;
      fromExtendedContext?: boolean;
    }>;
  };

  const comments: ResumeReviewComment[] = Array.isArray(parsed.comments)
    ? parsed.comments
        .filter((c) => c && (c.comment || c.title))
        .slice(0, 20)
        .map((c, idx) => {
          const rawLine =
            typeof c.anchorLineNumber === 'number' && Number.isFinite(c.anchorLineNumber)
              ? Math.round(c.anchorLineNumber)
              : 0;
          const validLineNumber =
            rawLine >= 1 && rawLine <= baseLines.length ? rawLine : null;
          const fallbackQuote =
            validLineNumber !== null
              ? baseLines[validLineNumber - 1].slice(0, 120)
              : '';
          return {
            id: `rc-${idx + 1}`,
            category: normalizeCategory(c.category),
            anchorLineNumber: validLineNumber,
            anchorQuote: String(c.anchorQuote || fallbackQuote).trim().slice(0, 180),
            sectionLabel: String(c.sectionLabel || 'Resume').trim().slice(0, 80),
            title: String(c.title || 'Review note').trim().slice(0, 140),
            comment: String(c.comment || '').trim(),
            suggestedText: c.suggestedText?.trim() ? c.suggestedText.trim() : undefined,
            fromExtendedContext: Boolean(c.fromExtendedContext && hasExtendedContext),
          };
        })
    : [];

  return {
    roleTypeUsed: params.baseResume.roleType,
    baseResumeFileName: params.baseResume.fileName,
    baseLines,
    overallFitNote: String(
      parsed.overallFitNote ||
        'Review comments attached to your base resume based on this job description.'
    ).trim(),
    comments,
    missingRequirements: Array.isArray(parsed.missingRequirements)
      ? parsed.missingRequirements.map((s) => String(s).trim()).filter(Boolean).slice(0, 10)
      : [],
    usedExtendedContext: hasExtendedContext,
    generatedAt: formatTimeInTimeZone(new Date(), params.timeZone),
  };
}

const CATEGORY_TAG: Record<ResumeCommentCategory, string> = {
  move: 'MOVE',
  add: 'ADD',
  remove: 'REMOVE',
  missing: 'MISSING',
};

function isLikelySectionHeading(line: string, index: number): boolean {
  if (index === 0) return false;
  const trimmed = line.trim();
  if (trimmed.length < 3 || trimmed.length > 48) return false;
  if (/^[•\-–—*]/.test(trimmed)) return false;
  const letters = trimmed.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 4 && letters === letters.toUpperCase()) return true;
  return /^(experience|work experience|professional experience|education|skills|technical skills|leadership|projects|certifications|summary|profile|awards|activities|publications)$/i.test(
    trimmed.replace(/[:|]+$/, '').trim()
  );
}

function isLikelyBulletLine(line: string): boolean {
  return /^[•\-–—*▪◦]\s*/.test(line.trim());
}

/**
 * Generates a Microsoft Word (.docx) file containing the UNTOUCHED base resume text
 * with native Microsoft Word margin comments attached to each anchored line
 * (and general/missing comments attached at the top of the document).
 */
export async function buildCommentedResumeDocxBuffer(
  review: ResumeReviewDocument,
  jobContext?: { title: string; company: string }
): Promise<Buffer> {
  const DARK_HEX = '18181B';
  const MUTED_HEX = '52525B';
  const RULE_HEX = 'D4D4D8';
  const FONT = 'Calibri';

  const now = new Date();
  const lines = review.baseLines.length > 0 ? review.baseLines : ['(Base resume text)'];

  // Assign deterministic 0-based integer comment IDs and group by target 1-based line number.
  // Document-wide / missing comments (anchorLineNumber === null) attach cleanly to line 1.
  const commentsByLine = new Map<number, Array<{ id: number; item: ResumeReviewComment }>>();
  const wordComments: Array<{
    id: number;
    author: string;
    initials: string;
    date: Date;
    children: Paragraph[];
  }> = [];

  // Optional comment #0 for overall fit summary if jobContext is provided
  let nextCommentId = 0;

  for (const item of review.comments) {
    const id = nextCommentId++;
    const targetLine =
      item.anchorLineNumber !== null &&
      item.anchorLineNumber >= 1 &&
      item.anchorLineNumber <= lines.length
        ? item.anchorLineNumber
        : 1;

    const bucket = commentsByLine.get(targetLine) ?? [];
    bucket.push({ id, item });
    commentsByLine.set(targetLine, bucket);

    const tag = CATEGORY_TAG[item.category];
    const commentParagraphs: Paragraph[] = [
      new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({
            text: `[${tag}] ${item.title}`,
            bold: true,
            font: FONT,
            size: 19,
          }),
        ],
      }),
      new Paragraph({
        spacing: { after: item.suggestedText ? 60 : 0 },
        children: [
          new TextRun({
            text: item.comment,
            font: FONT,
            size: 18,
          }),
        ],
      }),
    ];

    if (item.suggestedText) {
      commentParagraphs.push(
        new Paragraph({
          spacing: { after: item.fromExtendedContext ? 40 : 0 },
          children: [
            new TextRun({
              text: 'Suggested idea: ',
              bold: true,
              font: FONT,
              size: 18,
            }),
            new TextRun({
              text: item.suggestedText,
              italics: true,
              font: FONT,
              size: 18,
            }),
          ],
        })
      );
    }

    if (item.fromExtendedContext) {
      commentParagraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: '(Drawn from your non-resume skills & experience)',
              italics: true,
              color: MUTED_HEX,
              font: FONT,
              size: 16,
            }),
          ],
        })
      );
    }

    wordComments.push({
      id,
      author: 'Meridian Resume Review',
      initials: 'MR',
      date: now,
      children: commentParagraphs,
    });
  }

  // If there is an overallFitNote and at least 1 line, attach a summary comment on line 1 too
  if (review.overallFitNote) {
    const id = nextCommentId++;
    const bucket = commentsByLine.get(1) ?? [];
    bucket.unshift({
      id,
      item: {
        id: 'rc-overview',
        category: 'add',
        anchorLineNumber: 1,
        anchorQuote: lines[0],
        sectionLabel: 'Overall Review',
        title: jobContext
          ? `Review Summary — ${jobContext.title} @ ${jobContext.company}`
          : 'Overall Resume Review Summary',
        comment: review.overallFitNote,
      },
    });
    commentsByLine.set(1, bucket);

    const overviewChildren: Paragraph[] = [
      new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({
            text: jobContext
              ? `OVERALL REVIEW (${jobContext.title} @ ${jobContext.company})`
              : 'OVERALL RESUME REVIEW',
            bold: true,
            font: FONT,
            size: 19,
          }),
        ],
      }),
      new Paragraph({
        spacing: { after: review.missingRequirements.length > 0 ? 60 : 0 },
        children: [
          new TextRun({
            text: review.overallFitNote,
            font: FONT,
            size: 18,
          }),
        ],
      }),
    ];

    if (review.missingRequirements.length > 0) {
      overviewChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Key gaps to watch: ${review.missingRequirements.join(' · ')}`,
              italics: true,
              font: FONT,
              size: 17,
            }),
          ],
        })
      );
    }

    wordComments.unshift({
      id,
      author: 'Meridian Resume Review',
      initials: 'MR',
      date: now,
      children: overviewChildren,
    });
  }

  // Build untouched base resume paragraphs with native Word comment ranges
  const bodyParagraphs: Paragraph[] = lines.map((rawLine, idx) => {
    const lineNum = idx + 1;
    const attached = commentsByLine.get(lineNum) ?? [];
    const isNameLine = idx === 0;
    const isContactLine = idx === 1 && /@|\||linkedin|github|\d{3}/i.test(rawLine);
    const isHeading = isLikelySectionHeading(rawLine, idx);
    const isBullet = isLikelyBulletLine(rawLine);

    const displayText = isBullet
      ? `•  ${rawLine.replace(/^[•\-–—*▪◦]\s*/, '')}`
      : rawLine;

    const run = new TextRun({
      text: displayText,
      font: FONT,
      size: isNameLine ? 30 : isHeading ? 21 : isContactLine ? 18 : 20,
      bold: isNameLine || isHeading,
      color: isContactLine ? MUTED_HEX : DARK_HEX,
    });

    const paragraphChildren: Array<
      TextRun | CommentRangeStart | CommentRangeEnd | CommentReference
    > = [
      ...attached.map((entry) => new CommentRangeStart(entry.id)),
      run,
      ...attached.map((entry) => new CommentRangeEnd(entry.id)),
      ...attached.map((entry) => new CommentReference(entry.id)),
    ];

    return new Paragraph({
      alignment: isNameLine || isContactLine ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: {
        before: isHeading ? 140 : isNameLine ? 0 : 24,
        after: isNameLine ? 30 : isContactLine ? 80 : isHeading ? 40 : 28,
        line: 230,
      },
      ...(isHeading
        ? {
            border: {
              bottom: {
                color: RULE_HEX,
                space: 2,
                style: BorderStyle.SINGLE,
                size: 6,
              },
            },
            keepNext: true,
          }
        : {}),
      ...(isBullet ? { indent: { left: 260, hanging: 150 } } : {}),
      children: paragraphChildren,
    });
  });

  const doc = new Document({
    creator: 'Meridian Workspace',
    title: jobContext
      ? `${review.baseResumeFileName} — Review Comments for ${jobContext.company}`
      : `${review.baseResumeFileName} — Review Comments`,
    ...(wordComments.length > 0 ? { comments: { children: wordComments } } : {}),
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 12240, // 8.5 in
              height: 15840, // 11 in
            },
            margin: {
              top: 720,
              bottom: 720,
              left: 720,
              right: 720,
            },
          },
        },
        children: bodyParagraphs,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
