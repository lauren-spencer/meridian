import { GoogleGenAI, Type } from '@google/genai';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  TabStopPosition,
  TabStopType,
  TextRun,
} from 'docx';
import mammoth from 'mammoth';
import type {
  CareerExperienceItem,
  JobRecord,
  RoleResume,
  TailoredResumeDocument,
  TailoredResumeDiffRun,
  TailoredResumeSection,
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
 * Extracts plain text from an uploaded resume (.docx, .pdf, .txt, .md).
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
            text: 'Transcribe this resume verbatim into clean plain text. Preserve all section headings, company names, role titles, dates, locations, bullet points (prefixed with "- "), education, and skills. Do not summarize or omit any metrics or wording. Output only the plain text resume.',
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
    'Unsupported resume format. Please upload a .docx, .pdf, .txt, or .md file.'
  );
}

const DIFF_RUN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    text: {
      type: Type.STRING,
      description: 'Text fragment. Preserve leading/trailing spaces between adjacent runs so concatenation reads naturally.',
    },
    edited: {
      type: Type.BOOLEAN,
      description:
        'True if this exact text fragment was newly added, rewritten, swapped in from off-resume context, or meaningfully rephrased compared to the base resume. False if unchanged from the base resume.',
    },
  },
  required: ['text', 'edited'],
};

const TAILORED_RESUME_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    candidateName: {
      type: Type.STRING,
      description: 'Candidate full name from the base resume.',
    },
    contactLine: {
      type: Type.STRING,
      description: 'Single compact contact line separated by " | " (email, phone, LinkedIn, location).',
    },
    headlineRuns: {
      type: Type.ARRAY,
      items: DIFF_RUN_SCHEMA,
      description: 'Optional crisp 1-line summary/headline only if the base resume has one; otherwise empty array.',
    },
    sections: {
      type: Type.ARRAY,
      description:
        'Ordered 1-page resume sections (e.g., EXPERIENCE, EDUCATION, LEADERSHIP & PROJECTS, SKILLS). Keep strictly compact so the entire resume fits on 1 US Letter page.',
      items: {
        type: Type.OBJECT,
        properties: {
          heading: {
            type: Type.STRING,
            description: 'Section heading in uppercase (e.g., EXPERIENCE, EDUCATION, SKILLS).',
          },
          entries: {
            type: Type.ARRAY,
            description: 'Role, education, or project entries in this section (empty for plain summary/skills sections).',
            items: {
              type: Type.OBJECT,
              properties: {
                headerLeft: {
                  type: Type.STRING,
                  description: 'Company, university, or organization name.',
                },
                headerRight: {
                  type: Type.STRING,
                  description: 'Location or dates aligned right.',
                },
                subHeaderLeft: {
                  type: Type.STRING,
                  description: 'Role title or degree.',
                },
                subHeaderRight: {
                  type: Type.STRING,
                  description: 'Dates or GPA/honors aligned right (leave empty if dates are in headerRight).',
                },
                bullets: {
                  type: Type.ARRAY,
                  description: '2-4 crisp, quantified impact bullets (max ~22 words each so each fits 1-2 lines).',
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      runs: {
                        type: Type.ARRAY,
                        items: DIFF_RUN_SCHEMA,
                        description:
                          'Ordered diff runs forming the complete bullet sentence (without leading bullet symbol). Mark modified or newly pulled phrases with edited=true.',
                      },
                      wasPulledFromContext: {
                        type: Type.BOOLEAN,
                        description:
                          'True if this bullet or fact was brought in from the candidate extended/off-resume experience or brain dump.',
                      },
                      sourceNote: {
                        type: Type.STRING,
                        description:
                          'Short explanation when edited or pulled from extended context (e.g., "Pulled from off-resume pricing project").',
                      },
                    },
                    required: ['runs'],
                  },
                },
              },
              required: ['headerLeft', 'headerRight', 'subHeaderLeft', 'bullets'],
            },
          },
          summaryRuns: {
            type: Type.ARRAY,
            items: DIFF_RUN_SCHEMA,
            description: 'Compact single-paragraph line(s) for Skills / Technical Stack / Languages sections.',
          },
        },
        required: ['heading'],
      },
    },
    changeSummary: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '3-5 crisp bullet points summarizing the highest-leverage tailoring edits made for this specific role.',
    },
    pulledFromExtendedContext: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        'List of specific off-resume roles, projects, or metrics pulled from the candidate extended context (empty array if none were relevant or provided).',
    },
  },
  required: [
    'candidateName',
    'contactLine',
    'sections',
    'changeSummary',
    'pulledFromExtendedContext',
  ],
};

function estimateVisualLines(doc: {
  headlineRuns?: TailoredResumeDiffRun[];
  sections: TailoredResumeSection[];
}): number {
  let lines = 3; // Name + contact + header border
  if (doc.headlineRuns && doc.headlineRuns.length > 0) {
    const txt = doc.headlineRuns.map((r) => r.text).join('');
    lines += Math.max(1, Math.ceil(txt.length / 98)) + 0.5;
  }
  for (const section of doc.sections) {
    lines += 1.6; // Heading + spacing
    if (section.summaryRuns && section.summaryRuns.length > 0) {
      const txt = section.summaryRuns.map((r) => r.text).join('');
      lines += Math.max(1, Math.ceil(txt.length / 102));
    }
    for (const entry of section.entries ?? []) {
      lines += 2.2; // Company + title header rows
      for (const bullet of entry.bullets ?? []) {
        const txt = bullet.runs.map((r) => r.text).join('');
        lines += Math.max(1, Math.ceil(txt.length / 96));
      }
    }
  }
  return Math.round(lines);
}

/**
 * Tailors a role-specific base resume to a target job description using Gemini,
 * actively pulling relevant details from the user's extended/off-resume experience
 * and emitting run-level redline markers while strictly enforcing a 1-page budget.
 */
export async function tailorResumeForJob(params: {
  job: Pick<
    JobRecord,
    'title' | 'company' | 'location' | 'locationType' | 'skills' | 'summary' | 'fullDescription'
  >;
  baseResume: RoleResume;
  careerExperiences: CareerExperienceItem[];
  careerContextNotes: string;
  customInstructions?: string;
  timeZone?: string;
}): Promise<TailoredResumeDocument> {
  const ai = getGeminiClient();

  const extendedExperiencesText =
    params.careerExperiences.length > 0
      ? params.careerExperiences
          .map(
            (exp, idx) =>
              `${idx + 1}. [${exp.onResume ? 'ON RESUME (EXTRA DETAIL)' : 'NOT CURRENTLY ON RESUME'}] ${exp.title} @ ${exp.organization}${exp.dates ? ` (${exp.dates})` : ''}\n   Details: ${exp.details}`
          )
          .join('\n\n')
      : '(No structured extended roles added yet.)';

  const brainDumpText = params.careerContextNotes?.trim()
    ? params.careerContextNotes.trim().slice(0, 12000)
    : '(No additional career brain dump notes provided.)';

  const jdText = (params.job.fullDescription || params.job.summary || '').slice(0, 12000);

  const systemInstruction = `You are an elite executive career coach and resume editor.
Your task is to tailor the candidate's BASE RESUME for the TARGET JOB, strictly keeping the final resume to ONE PAGE (US Letter) and marking EVERY edit/addition with edited=true so the user can review every redlined change in red inside Microsoft Word (.docx).

CRITICAL RULES:
1. STRICT HONESTY — ZERO FABRICATION: Never invent companies, titles, metrics, tools, or outcomes. Every claim MUST come strictly from either the BASE RESUME or the EXTENDED CAREER CONTEXT provided below.
2. PULL FROM EXTENDED / OFF-RESUME CONTEXT: Carefully review the candidate's "Extended Career Context" (including roles/projects marked NOT CURRENTLY ON RESUME and the Career Brain Dump). Whenever an off-resume role, project, achievement, or deeper detail directly matches the target job's requirements better than an existing less-relevant bullet on the base resume, SWAP IT IN or weave it into the right experience/projects section! Mark every pulled-in phrase or bullet with edited=true and set wasPulledFromContext=true with a short sourceNote.
3. SURGICAL REDLINING (edited: true vs false):
   - Preserve untouched base resume phrases with edited=false so the user can clearly distinguish original text (black) from tailored edits (red).
   - Mark any newly written words, reframed verbs, added JD keywords, pulled-in off-resume bullets, or reordered/edited skill additions with edited=true.
   - Ensure adjacent runs preserve spaces cleanly (e.g., [{ text: "Led launch of ", edited: false }, { text: "B2B self-serve billing workflow ", edited: true }, { text: "driving $1.8M ARR.", edited: false }]).
   - If an entire bullet is newly pulled from extended context or completely rewritten, a single run with edited=true is great.
4. STRICT ONE-PAGE BUDGET:
   - The final resume MUST fit comfortably on ONE single US Letter page (~38 to 48 visual lines total).
   - Target 12–16 total bullets across the whole resume (max 18–26 words per bullet; crisp 1–2 lines per bullet).
   - If you pull in an off-resume role or bullet, trim or tighten lower-relevance bullets from the base resume so total length stays strictly 1 page.
   - Keep Education and Skills concise (1–3 compact lines each).
5. ATS & RECRUITER POLISH:
   - Mirror the target job's exact domain terminology, leadership scope, and core competencies naturally.
   - Use strong action verbs and preserve quantified metrics.`;

  const userPrompt = `TARGET JOB:
Title: ${params.job.title}
Company: ${params.job.company}
Location: ${params.job.location} (${params.job.locationType})
Key Skills: ${params.job.skills.join(', ')}

JOB DESCRIPTION:
${jdText}

${params.customInstructions?.trim() ? `USER'S CUSTOM TAILORING FOCUS FOR THIS ROLE:\n${params.customInstructions.trim()}\n` : ''}
BASE RESUME (Role Track: ${params.baseResume.roleType} | File: ${params.baseResume.fileName}):
${params.baseResume.rawText.slice(0, 18000)}

EXTENDED CAREER CONTEXT (ALL ROLES INCLUDING OFF-RESUME ROLES & EXTRA ACHIEVEMENTS):
${extendedExperiencesText}

ADDITIONAL CAREER NOTES / PROJECTS NOT ON RESUME:
${brainDumpText}

Produce the tailored 1-page resume JSON with redline diff runs (edited=true for every edit or addition from extended context).`;

  const response = await ai.models.generateContent({
    model: GEMINI_WRITER_MODEL,
    contents: userPrompt,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: TAILORED_RESUME_SCHEMA,
      thinkingConfig: WRITER_THINKING_CONFIG,
    },
  });

  const rawJson = (response.text ?? '').trim();
  if (!rawJson) {
    throw new Error('Resume tailoring returned an empty response. Please try again.');
  }

  const parsed = JSON.parse(rawJson) as {
    candidateName?: string;
    contactLine?: string;
    headlineRuns?: TailoredResumeDiffRun[];
    sections?: TailoredResumeSection[];
    changeSummary?: string[];
    pulledFromExtendedContext?: string[];
  };

  const sections: TailoredResumeSection[] = Array.isArray(parsed.sections)
    ? parsed.sections.map((sec) => ({
        heading: String(sec.heading || 'EXPERIENCE').toUpperCase(),
        entries: Array.isArray(sec.entries)
          ? sec.entries.map((ent) => ({
              headerLeft: String(ent.headerLeft || ''),
              headerRight: String(ent.headerRight || ''),
              subHeaderLeft: String(ent.subHeaderLeft || ''),
              subHeaderRight: ent.subHeaderRight ? String(ent.subHeaderRight) : undefined,
              bullets: Array.isArray(ent.bullets)
                ? ent.bullets
                    .filter((b) => Array.isArray(b.runs) && b.runs.length > 0)
                    .map((b) => ({
                      runs: b.runs.map((r) => ({
                        text: String(r.text ?? ''),
                        edited: Boolean(r.edited),
                      })),
                      wasPulledFromContext: Boolean(b.wasPulledFromContext),
                      sourceNote: b.sourceNote ? String(b.sourceNote) : undefined,
                    }))
                : [],
            }))
          : undefined,
        summaryRuns: Array.isArray(sec.summaryRuns)
          ? sec.summaryRuns.map((r) => ({
              text: String(r.text ?? ''),
              edited: Boolean(r.edited),
            }))
          : undefined,
      }))
    : [];

  const headlineRuns = Array.isArray(parsed.headlineRuns)
    ? parsed.headlineRuns
        .filter((r) => typeof r.text === 'string' && r.text.length > 0)
        .map((r) => ({ text: r.text, edited: Boolean(r.edited) }))
    : undefined;

  const estimatedLineCount = estimateVisualLines({ headlineRuns, sections });

  return {
    roleTypeUsed: params.baseResume.roleType,
    baseResumeFileName: params.baseResume.fileName,
    candidateName: String(parsed.candidateName || 'Candidate Name').trim(),
    contactLine: String(parsed.contactLine || '').trim(),
    headlineRuns: headlineRuns && headlineRuns.length > 0 ? headlineRuns : undefined,
    sections,
    changeSummary: Array.isArray(parsed.changeSummary)
      ? parsed.changeSummary.map((s) => String(s)).filter(Boolean).slice(0, 6)
      : [],
    pulledFromExtendedContext: Array.isArray(parsed.pulledFromExtendedContext)
      ? parsed.pulledFromExtendedContext.map((s) => String(s)).filter(Boolean).slice(0, 8)
      : [],
    estimatedLineCount,
    generatedAt: formatTimeInTimeZone(new Date(), params.timeZone),
  };
}

/**
 * Generates a crisp, strictly 1-page Microsoft Word (.docx) Buffer.
 * Dynamically scales margins & typography (9pt–10.5pt Calibri) based on estimated
 * visual line count so the resume never spills onto page 2.
 * When highlightEditsInRed=true (default), all edited/added runs render in red (#C62828).
 */
export async function buildTailoredResumeDocxBuffer(
  tailored: TailoredResumeDocument,
  highlightEditsInRed = true
): Promise<Buffer> {
  const RED_HEX = 'C62828';
  const DARK_HEX = '18181B';
  const MUTED_HEX = '52525B';
  const RULE_HEX = 'D4D4D8';
  const FONT = 'Calibri';

  const lines =
    tailored.estimatedLineCount ||
    estimateVisualLines({
      headlineRuns: tailored.headlineRuns,
      sections: tailored.sections,
    });

  // Dynamic 1-page density tiers (all US Letter 8.5 x 11 in)
  // Standard Word twips: 1 inch = 1440 twips; font size in half-points (20 = 10pt)
  const isVeryDense = lines > 50;
  const isDense = lines > 42 && lines <= 50;

  const marginTwips = isVeryDense ? 540 : isDense ? 648 : 720; // 0.375" / 0.45" / 0.5"
  const bodySize = isVeryDense ? 18 : isDense ? 19 : 20; // 9pt / 9.5pt / 10pt
  const headingSize = isVeryDense ? 20 : 21; // 10pt / 10.5pt
  const nameSize = isVeryDense ? 30 : 32; // 15pt / 16pt
  const lineSpacing = isVeryDense ? 215 : isDense ? 228 : 240; // slightly tighter leading when dense
  const sectionSpaceBefore = isVeryDense ? 90 : isDense ? 115 : 140;
  const entrySpaceBefore = isVeryDense ? 55 : isDense ? 75 : 95;
  const bulletSpaceAfter = isVeryDense ? 20 : isDense ? 32 : 42;

  // US Letter width = 12240 twips; right tab position = content width
  const rightTabPos = 12240 - marginTwips * 2;

  const buildRuns = (
    runs: TailoredResumeDiffRun[],
    options?: { size?: number; italics?: boolean; bold?: boolean }
  ): TextRun[] =>
    runs.map(
      (r) =>
        new TextRun({
          text: r.text,
          font: FONT,
          size: options?.size ?? bodySize,
          italics: options?.italics,
          bold: options?.bold,
          color: highlightEditsInRed && r.edited ? RED_HEX : DARK_HEX,
        })
    );

  const children: Paragraph[] = [];

  // Candidate Name
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 35, line: lineSpacing },
      children: [
        new TextRun({
          text: tailored.candidateName,
          font: FONT,
          size: nameSize,
          bold: true,
          color: DARK_HEX,
        }),
      ],
    })
  );

  // Contact Line
  if (tailored.contactLine) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 70, line: lineSpacing },
        children: [
          new TextRun({
            text: tailored.contactLine,
            font: FONT,
            size: Math.max(17, bodySize - 1),
            color: MUTED_HEX,
          }),
        ],
      })
    );
  }

  // Optional 1-line summary / headline
  if (tailored.headlineRuns && tailored.headlineRuns.length > 0) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 20, after: 70, line: lineSpacing },
        children: buildRuns(tailored.headlineRuns),
      })
    );
  }

  // Sections
  for (const section of tailored.sections) {
    children.push(
      new Paragraph({
        spacing: { before: sectionSpaceBefore, after: 45, line: lineSpacing },
        border: {
          bottom: {
            color: RULE_HEX,
            space: 2,
            style: BorderStyle.SINGLE,
            size: 6,
          },
        },
        keepNext: true,
        children: [
          new TextRun({
            text: section.heading.toUpperCase(),
            font: FONT,
            size: headingSize,
            bold: true,
            color: DARK_HEX,
          }),
        ],
      })
    );

    if (section.summaryRuns && section.summaryRuns.length > 0) {
      children.push(
        new Paragraph({
          spacing: { before: 20, after: 45, line: lineSpacing },
          children: buildRuns(section.summaryRuns),
        })
      );
    }

    for (let eIdx = 0; eIdx < (section.entries ?? []).length; eIdx++) {
      const entry = section.entries![eIdx];

      // Entry Line 1: Organization / Company (bold)  [TAB]  Dates / Location
      children.push(
        new Paragraph({
          spacing: {
            before: eIdx === 0 ? 25 : entrySpaceBefore,
            after: 15,
            line: lineSpacing,
          },
          tabStops: [
            {
              type: TabStopType.RIGHT,
              position: rightTabPos || TabStopPosition.MAX,
            },
          ],
          keepNext: true,
          children: [
            new TextRun({
              text: entry.headerLeft,
              font: FONT,
              size: bodySize,
              bold: true,
              color: DARK_HEX,
            }),
            ...(entry.headerRight
              ? [
                  new TextRun({
                    text: `\t${entry.headerRight}`,
                    font: FONT,
                    size: bodySize,
                    bold: true,
                    color: DARK_HEX,
                  }),
                ]
              : []),
          ],
        })
      );

      // Entry Line 2: Title / Degree (italic)  [TAB]  Optional Right Subheader
      if (entry.subHeaderLeft || entry.subHeaderRight) {
        children.push(
          new Paragraph({
            spacing: { before: 0, after: 30, line: lineSpacing },
            tabStops: [
              {
                type: TabStopType.RIGHT,
                position: rightTabPos || TabStopPosition.MAX,
              },
            ],
            keepNext: true,
            children: [
              new TextRun({
                text: entry.subHeaderLeft || '',
                font: FONT,
                size: bodySize,
                italics: true,
                color: MUTED_HEX,
              }),
              ...(entry.subHeaderRight
                ? [
                    new TextRun({
                      text: `\t${entry.subHeaderRight}`,
                      font: FONT,
                      size: bodySize,
                      italics: true,
                      color: MUTED_HEX,
                    }),
                  ]
                : []),
            ],
          })
        );
      }

      // Bullets
      for (const bullet of entry.bullets ?? []) {
        const allEdited =
          bullet.runs.length > 0 && bullet.runs.every((r) => r.edited);
        children.push(
          new Paragraph({
            spacing: { before: 0, after: bulletSpaceAfter, line: lineSpacing },
            indent: { left: 260, hanging: 150 },
            children: [
              new TextRun({
                text: '•  ',
                font: FONT,
                size: bodySize,
                color: highlightEditsInRed && allEdited ? RED_HEX : DARK_HEX,
              }),
              ...buildRuns(bullet.runs),
            ],
          })
        );
      }
    }
  }

  const doc = new Document({
    creator: 'Meridian Workspace',
    title: `${tailored.candidateName} — Tailored Resume`,
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 12240, // 8.5 in
              height: 15840, // 11 in
            },
            margin: {
              top: marginTwips,
              bottom: marginTwips,
              left: marginTwips,
              right: marginTwips,
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
