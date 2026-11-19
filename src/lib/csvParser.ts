import type {
  JobRecord,
  LocationType,
  MappableJobField,
  PipelineStage,
} from '../types/job';
import { detectIsMbaRole, normalizeEmploymentType } from './resumeClient';

export interface ParsedTabularData {
  headers: string[];
  rows: Record<string, string>[];
}

export function computeClientHash(input: string): string {
  // Deterministic 16-char FNV-1a 64-bit hex hash for instant client deduplication
  const normalized = input.trim().toLowerCase();
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5 ^ 0x9e3779b9;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + i;
    h2 = Math.imul(h2, 0x01000193);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${part1}${part2}`;
}

function detectDelimiter(headerLine: string): string {
  const tabs = (headerLine.match(/\t/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  return tabs > commas ? '\t' : ',';
}

function parseDelimitedRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field.trim());
      field = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(field.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = '';
      i += 1;
    } else if (ch === '\n' || ch === '\r') {
      row.push(field.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }

  return rows;
}

export function parseUploadedRolesText(
  rawText: string,
  fileName = ''
): ParsedTabularData {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error('File or pasted text is empty.');
  }

  // Try JSON first if filename ends in .json or content starts with [ or {
  if (
    fileName.toLowerCase().endsWith('.json') ||
    trimmed.startsWith('[') ||
    trimmed.startsWith('{')
  ) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const items = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { jobs?: unknown[] }).jobs)
        ? (parsed as { jobs: unknown[] }).jobs
        : [parsed];

      const objects = items.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item && typeof item === 'object' && !Array.isArray(item))
      );

      if (objects.length === 0) {
        throw new Error('JSON did not contain an array of job objects.');
      }

      const headerSet = new Set<string>();
      for (const obj of objects.slice(0, 100)) {
        Object.keys(obj).forEach((k) => headerSet.add(k));
      }
      const headers = Array.from(headerSet);
      const rows = objects.slice(0, 500).map((obj) => {
        const rec: Record<string, string> = {};
        for (const h of headers) {
          const val = obj[h];
          if (val === null || val === undefined) rec[h] = '';
          else if (Array.isArray(val)) rec[h] = val.join(', ');
          else if (typeof val === 'object') rec[h] = JSON.stringify(val);
          else rec[h] = String(val);
        }
        return rec;
      });

      return { headers, rows };
    } catch (err) {
      if (fileName.toLowerCase().endsWith('.json')) {
        throw new Error(
          err instanceof Error ? err.message : 'Invalid JSON format.'
        );
      }
    }
  }

  // Parse CSV or TSV
  const firstNewline = trimmed.indexOf('\n');
  const firstLine = firstNewline === -1 ? trimmed : trimmed.slice(0, firstNewline);
  const delimiter = detectDelimiter(firstLine);
  const matrix = parseDelimitedRows(trimmed, delimiter);

  if (matrix.length < 2) {
    throw new Error(
      'Expected a header row followed by at least one job row (CSV, TSV, or JSON).'
    );
  }

  const headers = matrix[0].map((h, idx) => h.trim() || `Column ${idx + 1}`);
  const rows = matrix.slice(1, 501).map((cells) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => {
      rec[h] = (cells[idx] ?? '').trim();
    });
    return rec;
  });

  return { headers, rows };
}

export function heuristicColumnMapping(
  headers: string[]
): Record<string, MappableJobField> {
  const mapping: Record<string, MappableJobField> = {};
  const used = new Set<MappableJobField>();

  const rules: { field: MappableJobField; regex: RegExp }[] = [
    { field: 'title', regex: /^(job\s*)?(title|role|position|name)$/i },
    { field: 'company', regex: /^(company|employer|org|organization|firm)$/i },
    { field: 'jobUrl', regex: /(url|link|apply|posting)/i },
    { field: 'salaryLabel', regex: /(salary|comp|pay|ote|range)/i },
    { field: 'locationType', regex: /(work\s*mode|remote|hybrid|onsite|arrangement)/i },
    { field: 'location', regex: /(location|city|office|region)/i },
    { field: 'employmentType', regex: /(employment|job\s*type|full.?time|intern|contract)/i },
    { field: 'stage', regex: /(stage|status|pipeline|state)/i },
    { field: 'deadlineAt', regex: /(deadline|due|close|expires)/i },
    { field: 'discoveredAt', regex: /(posted|discovered|date\s*added|created)/i },
    { field: 'skills', regex: /(skill|tag|keyword|stack|tech)/i },
    { field: 'sourceName', regex: /(source|board|channel|origin|via)/i },
    { field: 'summary', regex: /(summary|description|desc|about)/i },
    { field: 'notes', regex: /(note|comment|referral|contact)/i },
  ];

  for (const h of headers) {
    let matched: MappableJobField = 'ignore';
    for (const rule of rules) {
      if (rule.regex.test(h.trim()) && !used.has(rule.field)) {
        matched = rule.field;
        used.add(rule.field);
        break;
      }
    }
    mapping[h] = matched;
  }

  return mapping;
}

function normalizeStage(raw: string): PipelineStage {
  const s = raw.trim().toLowerCase();
  if (!s) return 'saved';
  if (s.includes('inbox') || s.includes('new')) return 'inbox';
  if (s.includes('apply') || s.includes('applied') || s.includes('submitted')) return 'applied';
  if (s.includes('interview') || s.includes('screen') || s.includes('onsite') || s.includes('final')) return 'interviewing';
  if (s.includes('offer')) return 'offer';
  if (s.includes('reject') || s.includes('archive') || s.includes('pass') || s.includes('closed')) return 'archived';
  return 'saved';
}

function normalizeLocationType(raw: string, fallbackLocation: string): LocationType {
  const combined = `${raw} ${fallbackLocation}`.toLowerCase();
  if (combined.includes('remote')) return 'Remote';
  if (combined.includes('hybrid')) return 'Hybrid';
  if (combined.includes('onsite') || combined.includes('on-site') || combined.includes('in-person') || combined.includes('in office')) {
    return 'Onsite';
  }
  return 'Hybrid';
}

function normalizeIsoDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function parseSalaryBounds(label: string): { min: number | null; max: number | null } {
  const matches = label.match(/\$?\s*(\d{2,3})(?:,(\d{3})|\s*[kK])/g);
  if (!matches || matches.length === 0) return { min: null, max: null };
  const nums = matches
    .map((m) => {
      const clean = m.replace(/[$,\s]/g, '').toLowerCase();
      if (clean.endsWith('k')) return Number(clean.slice(0, -1)) * 1000;
      return Number(clean);
    })
    .filter((n) => Number.isFinite(n) && n >= 10000 && n <= 2000000);
  if (nums.length === 0) return { min: null, max: null };
  return {
    min: Math.min(...nums),
    max: Math.max(...nums),
  };
}

export interface ParsedTargetCompanyRow {
  name: string;
  careersUrl?: string;
  notes?: string;
}

export function buildNormalizedJobsFromMapping(params: {
  rows: Record<string, string>[];
  mapping: Record<string, MappableJobField>;
  existingHashes: Set<string>;
  fileName: string;
  extractUntitledAsTargetCompanies?: boolean;
}): {
  jobs: JobRecord[];
  extractedTargetCompanies: ParsedTargetCompanyRow[];
  skippedDuplicates: number;
  skippedInvalid: number;
} {
  const fieldToColumns = new Map<MappableJobField, string[]>();
  for (const [col, field] of Object.entries(params.mapping)) {
    if (field === 'ignore') continue;
    const list = fieldToColumns.get(field) ?? [];
    list.push(col);
    fieldToColumns.set(field, list);
  }

  const getVal = (row: Record<string, string>, field: MappableJobField): string => {
    const cols = fieldToColumns.get(field);
    if (!cols || cols.length === 0) return '';
    return cols
      .map((c) => (row[c] ?? '').trim())
      .filter(Boolean)
      .join(' · ');
  };

  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const nowTime = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const seen = new Set(params.existingHashes);
  const seenCompanyNames = new Set<string>();
  const jobs: JobRecord[] = [];
  const extractedTargetCompanies: ParsedTargetCompanyRow[] = [];
  let skippedDuplicates = 0;
  let skippedInvalid = 0;

  for (const row of params.rows) {
    const title = getVal(row, 'title');
    const company = getVal(row, 'company');
    if (!title && !company) {
      skippedInvalid += 1;
      continue;
    }

    const isUntitled = !title || /^untitled(\s+role)?$/i.test(title.trim());
    const jobUrl = getVal(row, 'jobUrl');
    const notes = getVal(row, 'notes');

    if (params.extractUntitledAsTargetCompanies && isUntitled && company) {
      const key = company.trim().toLowerCase();
      if (!seenCompanyNames.has(key)) {
        seenCompanyNames.add(key);
        extractedTargetCompanies.push({
          name: company.trim().slice(0, 140),
          careersUrl: /^https?:\/\//i.test(jobUrl) ? jobUrl.slice(0, 950) : undefined,
          notes: notes ? notes.slice(0, 400) : undefined,
        });
      }
      continue;
    }

    const finalTitle = title || 'Untitled Role';
    const finalCompany = company || 'Unspecified Company';
    const location = getVal(row, 'location') || 'Unspecified';
    const dedupKey = jobUrl || `${finalCompany}|${finalTitle}|${location}`;
    const urlHash = computeClientHash(dedupKey);

    if (seen.has(urlHash)) {
      skippedDuplicates += 1;
      continue;
    }
    seen.add(urlHash);

    const salaryLabel = getVal(row, 'salaryLabel') || 'Not listed';
    const { min, max } = parseSalaryBounds(salaryLabel);
    const stageRaw = getVal(row, 'stage');
    const stage = normalizeStage(stageRaw);
    const locationType = normalizeLocationType(getVal(row, 'locationType'), location);
    const rawEmploymentType = getVal(row, 'employmentType');
    const summary = getVal(row, 'summary');
    const employmentType = normalizeEmploymentType(rawEmploymentType, finalTitle, summary);
    const deadlineAt = normalizeIsoDate(getVal(row, 'deadlineAt'));
    const discoveredAt = normalizeIsoDate(getVal(row, 'discoveredAt')) || todayIso;
    const skillsRaw = getVal(row, 'skills');
    const skills = skillsRaw
      ? skillsRaw
          .split(/[,;|/]/)
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 10)
      : [];
    const sourceName =
      getVal(row, 'sourceName') ||
      `Import · ${params.fileName.replace(/\.[^.]+$/, '') || 'Uploaded List'}`;

    jobs.push({
      id: `imp-${urlHash}`,
      urlHash,
      title: finalTitle.slice(0, 180),
      company: finalCompany.slice(0, 140),
      companyDomain: `${finalCompany.toLowerCase().replace(/[^a-z0-9]/g, '') || 'company'}.com`,
      stage,
      isNew: stage === 'inbox',
      matchScore: 78,
      matchReason: `Imported from ${params.fileName || 'uploaded file'}.`,
      salaryMin: min,
      salaryMax: max,
      salaryLabel: salaryLabel.slice(0, 75),
      location: location.slice(0, 140),
      locationType,
      employmentType,
      isMbaRole: detectIsMbaRole(finalTitle),
      sourceId: 'src-csv-import',
      sourceName: sourceName.slice(0, 140),
      atsType: 'CSV Import',
      jobUrl: jobUrl.slice(0, 950),
      discoveredAt,
      discoveredTime: nowTime,
      deadlineAt,
      skills,
      summary: summary.slice(0, 1800),
      notes: notes.slice(0, 3500),
      feedback: null,
    });
  }

  return { jobs, extractedTargetCompanies, skippedDuplicates, skippedInvalid };
}

export function parseTargetCompaniesCsv(rawText: string): ParsedTargetCompanyRow[] {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return [];
  }

  const firstNewline = trimmed.indexOf('\n');
  const firstLine = firstNewline === -1 ? trimmed : trimmed.slice(0, firstNewline);
  const delimiter = detectDelimiter(firstLine);
  const matrix = parseDelimitedRows(trimmed, delimiter);

  if (matrix.length === 0) {
    return [];
  }

  const headerRow = matrix[0].map((c) => c.trim().toLowerCase());
  const looksLikeHeader = headerRow.some((h) =>
    /^(company|company\s*name|target\s*company|organization|org|employer|firm|name|careers?\s*url|url|website|notes?)$/i.test(
      h
    )
  );

  let nameCol = 0;
  let urlCol = -1;
  let notesCol = -1;

  if (looksLikeHeader) {
    const foundName = headerRow.findIndex((h) =>
      /(company|org|employer|firm|name)/i.test(h)
    );
    if (foundName >= 0) nameCol = foundName;
    urlCol = headerRow.findIndex((h) => /(url|link|career|site|website)/i.test(h));
    notesCol = headerRow.findIndex((h) => /(note|comment|role|interest|reason|priority|stage)/i.test(h));
  } else if (matrix[0].length >= 2) {
    const secondLooksUrl = matrix.some((r) => /^https?:\/\//i.test((r[1] ?? '').trim()));
    if (secondLooksUrl) {
      urlCol = 1;
      if (matrix[0].length >= 3) notesCol = 2;
    } else {
      notesCol = 1;
    }
  }

  const dataRows = looksLikeHeader ? matrix.slice(1) : matrix;
  const seen = new Set<string>();
  const companies: ParsedTargetCompanyRow[] = [];

  for (const row of dataRows.slice(0, 500)) {
    const rawName = (row[nameCol] ?? '').trim();
    if (!rawName) continue;
    const key = rawName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const rawUrl = urlCol >= 0 ? (row[urlCol] ?? '').trim() : '';
    const rawNotes = notesCol >= 0 ? (row[notesCol] ?? '').trim() : '';
    const normalizedUrl =
      rawUrl && /^https?:\/\//i.test(rawUrl)
        ? rawUrl.slice(0, 950)
        : rawUrl && /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(rawUrl)
        ? `https://${rawUrl}`.slice(0, 950)
        : undefined;

    companies.push({
      name: rawName.slice(0, 140),
      careersUrl: normalizedUrl,
      notes: rawNotes ? rawNotes.slice(0, 400) : undefined,
    });
  }

  return companies;
}
