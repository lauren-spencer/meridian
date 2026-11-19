import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import type {
  CareerExperienceItem,
  CoverLetterSample,
  GeneratedCoverLetter,
  JobRecord,
  RoleResume,
} from '../types/job';

function getGeminiClient(): GoogleGenAI {
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

const COVER_LETTER_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    candidateName: { type: Type.STRING },
    contactLine: { type: Type.STRING },
    dateLine: { type: Type.STRING },
    recipientLine: { type: Type.STRING },
    salutation: { type: Type.STRING },
    paragraphs: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    signOff: { type: Type.STRING },
    tailoringNotes: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: [
    'candidateName',
    'contactLine',
    'dateLine',
    'recipientLine',
    'salutation',
    'paragraphs',
    'signOff',
    'tailoringNotes',
  ],
};

export interface GenerateCoverLetterInput {
  job: Pick<
    JobRecord,
    | 'title'
    | 'company'
    | 'location'
    | 'locationType'
    | 'employmentType'
    | 'isMbaRole'
    | 'skills'
    | 'summary'
    | 'fullDescription'
    | 'notes'
  >;
  sample: CoverLetterSample;
  baseResume?: RoleResume | null;
  careerContextNotes?: string;
  careerExperiences?: CareerExperienceItem[];
  customInstructions?: string;
}

export async function generateCoverLetterForJob(
  input: GenerateCoverLetterInput
): Promise<GeneratedCoverLetter> {
  const ai = getGeminiClient();

  const todayDisplay = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const jobDescriptionBlock = (
    input.job.fullDescription?.trim() || input.job.summary?.trim() || ''
  ).slice(0, 10000);

  const experiencesBlock = (input.careerExperiences ?? [])
    .filter((e) => e.title.trim() || e.organization.trim() || e.details.trim())
    .map(
      (e, idx) =>
        `${idx + 1}. ${e.title} @ ${e.organization} (${e.dates || 'dates n/a'})\n   ${e.details}`
    )
    .join('\n\n');

  const prompt = `You are an expert executive career writer drafting a tailored, authentic 1-page cover letter for a specific job opening.

CRITICAL VOICE & TRUTHFULNESS RULES:
1. MATCH THE CANDIDATE'S VOICE: Closely mirror the tone, cadence, paragraph structure, formality, and approximate length of the CANDIDATE'S COVER LETTER SAMPLE below. Do NOT sound like generic AI prose ("I am thrilled to apply...", "In today's fast-paced world...", "I am a passionate, results-driven...").
2. ZERO FABRICATION: Every company, role, project, metric, degree, and achievement you cite MUST come directly from the candidate's cover letter sample, base resume, or extended career context. Never invent numbers, titles, or skills.
3. TARGETED SPECIFICITY: Connect 2-3 concrete experiences from the candidate's background directly to the exact priorities, responsibilities, and domain of the TARGET JOB below.
4. CLEAN 1-PAGE LENGTH: Keep to 3-4 crisp, high-impact body paragraphs (~260-380 words total) that fit comfortably on a single letter page.
5. HEADER & SALUTATION: Extract candidateName and contactLine cleanly from the sample or base resume. Set dateLine to "${todayDisplay}". Set recipientLine to "Hiring Team, ${input.job.company}" (or specific team if clear from the JD). Set salutation to match the sample's style (e.g. "Dear ${input.job.company} Hiring Team,").
6. TAILORING NOTES: Return 3-4 concise bullet strings explaining which sample voice patterns you preserved and which job requirements / resume experiences you highlighted.

TARGET JOB:
- Title: ${input.job.title}
- Company: ${input.job.company}
- Location: ${input.job.location} (${input.job.locationType})
- Employment Type: ${input.job.employmentType || 'Full-time'}${input.job.isMbaRole ? ' (MBA Role)' : ''}
- Key Skills: ${input.job.skills.join(', ') || 'Not listed'}
- Personal Notes: ${input.job.notes || 'None'}
- Full Job Description:
${jobDescriptionBlock || 'Not provided — tailor to role title and company context.'}

CANDIDATE'S COVER LETTER SAMPLE (Role Track: ${input.sample.roleType}, File: ${input.sample.fileName}):
"""
${input.sample.rawText.slice(0, 8000)}
"""

${
  input.baseResume
    ? `CANDIDATE'S BASE RESUME (Role Track: ${input.baseResume.roleType}, File: ${input.baseResume.fileName}):
"""
${input.baseResume.rawText.slice(0, 9000)}
"""`
    : 'BASE RESUME: Not provided (rely strictly on Cover Letter Sample and Extended Career Context).'
}

EXTENDED CAREER CONTEXT & ADDITIONAL EXPERIENCES:
${input.careerContextNotes?.trim() ? `Notes:\n${input.careerContextNotes.trim().slice(0, 3500)}\n` : ''}${
    experiencesBlock ? `Experiences:\n${experiencesBlock.slice(0, 5000)}` : 'None provided.'
  }

${
  input.customInstructions?.trim()
    ? `ADDITIONAL USER GUIDANCE FOR THIS LETTER:\n${input.customInstructions.trim().slice(0, 800)}`
    : ''
}`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: COVER_LETTER_SCHEMA,
      thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
    },
  });

  const rawText = (response.text ?? '').trim();
  const parsed = JSON.parse(rawText) as {
    candidateName?: string;
    contactLine?: string;
    dateLine?: string;
    recipientLine?: string;
    salutation?: string;
    paragraphs?: string[];
    signOff?: string;
    tailoringNotes?: string[];
  };

  return {
    roleTypeUsed: input.sample.roleType,
    sampleFileName: input.sample.fileName,
    candidateName: (parsed.candidateName || 'Candidate').trim(),
    contactLine: (parsed.contactLine || '').trim(),
    dateLine: (parsed.dateLine || todayDisplay).trim(),
    recipientLine: (parsed.recipientLine || `Hiring Team, ${input.job.company}`).trim(),
    salutation: (parsed.salutation || `Dear ${input.job.company} Hiring Team,`).trim(),
    paragraphs: Array.isArray(parsed.paragraphs)
      ? parsed.paragraphs.map((p) => String(p).trim()).filter(Boolean)
      : [],
    signOff: (parsed.signOff || `Sincerely,\n${parsed.candidateName || ''}`).trim(),
    tailoringNotes: Array.isArray(parsed.tailoringNotes)
      ? parsed.tailoringNotes.map((n) => String(n).trim()).filter(Boolean).slice(0, 6)
      : [],
    generatedAt: new Date().toISOString(),
  };
}

export async function buildCoverLetterDocxBuffer(
  letter: GeneratedCoverLetter
): Promise<Buffer> {
  const children: Paragraph[] = [];

  // Candidate header
  children.push(
    new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: letter.candidateName,
          bold: true,
          size: 30, // 15pt
          font: 'Calibri',
          color: '111827',
        }),
      ],
    })
  );

  if (letter.contactLine) {
    children.push(
      new Paragraph({
        spacing: { after: 200 },
        border: {
          bottom: {
            style: BorderStyle.SINGLE,
            size: 6,
            color: 'D4D4D8',
            space: 6,
          },
        },
        children: [
          new TextRun({
            text: letter.contactLine,
            size: 19, // 9.5pt
            font: 'Calibri',
            color: '52525B',
          }),
        ],
      })
    );
  }

  // Date
  children.push(
    new Paragraph({
      spacing: { before: 160, after: 140 },
      children: [
        new TextRun({
          text: letter.dateLine,
          size: 21, // 10.5pt
          font: 'Calibri',
          color: '27272A',
        }),
      ],
    })
  );

  // Recipient
  if (letter.recipientLine) {
    for (const line of letter.recipientLine.split('\n').filter((l) => l.trim())) {
      children.push(
        new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({
              text: line.trim(),
              size: 21,
              font: 'Calibri',
              color: '27272A',
            }),
          ],
        })
      );
    }
  }

  // Salutation
  children.push(
    new Paragraph({
      spacing: { before: 160, after: 160 },
      children: [
        new TextRun({
          text: letter.salutation,
          size: 21,
          font: 'Calibri',
          color: '18181B',
        }),
      ],
    })
  );

  // Body paragraphs
  for (const para of letter.paragraphs) {
    children.push(
      new Paragraph({
        spacing: { after: 180, line: 276 },
        children: [
          new TextRun({
            text: para,
            size: 21, // 10.5pt
            font: 'Calibri',
            color: '18181B',
          }),
        ],
      })
    );
  }

  // Sign-off (supports multi-line "Sincerely,\nName")
  const signOffLines = letter.signOff.split('\n').filter((l) => l.trim());
  signOffLines.forEach((line, idx) => {
    children.push(
      new Paragraph({
        spacing: {
          before: idx === 0 ? 120 : 40,
          after: idx === signOffLines.length - 1 ? 0 : 40,
        },
        children: [
          new TextRun({
            text: line.trim(),
            bold: idx === signOffLines.length - 1 && signOffLines.length > 1,
            size: 21,
            font: 'Calibri',
            color: '18181B',
          }),
        ],
      })
    );
  });

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1080, // 0.75 in
              bottom: 1080,
              left: 1080,
              right: 1080,
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
