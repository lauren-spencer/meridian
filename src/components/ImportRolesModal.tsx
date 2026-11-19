import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Check,
  Database,
  FileSpreadsheet,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  buildNormalizedJobsFromMapping,
  heuristicColumnMapping,
  parseTargetCompaniesCsv,
  parseUploadedRolesText,
  type ParsedTargetCompanyRow,
} from '../lib/csvParser';
import type {
  ColumnMappingSuggestion,
  JobRecord,
  MappableJobField,
} from '../types/job';

interface ImportRolesModalProps {
  open: boolean;
  initialMode?: 'roles' | 'companies';
  existingHashes: string[];
  onClose: () => void;
  onImportJobs: (params: {
    jobs: JobRecord[];
    fileName: string;
    totalRows: number;
    skippedDuplicates: number;
    autoScoreWithAi: boolean;
  }) => Promise<void>;
  onImportTargetCompanies: (
    companies: ParsedTargetCompanyRow[],
    sourceLabel?: string
  ) => Promise<void>;
}

const TARGET_FIELD_OPTIONS: { value: MappableJobField; label: string }[] = [
  { value: 'title', label: 'Role Title (required)' },
  { value: 'company', label: 'Company (required)' },
  { value: 'location', label: 'Location' },
  { value: 'locationType', label: 'Work Mode (Remote/Hybrid/Onsite)' },
  { value: 'employmentType', label: 'Employment Type' },
  { value: 'salaryLabel', label: 'Compensation / Salary' },
  { value: 'jobUrl', label: 'Posting URL' },
  { value: 'stage', label: 'Pipeline Stage' },
  { value: 'deadlineAt', label: 'Application Deadline' },
  { value: 'discoveredAt', label: 'Discovered / Posted Date' },
  { value: 'skills', label: 'Skills / Keywords' },
  { value: 'sourceName', label: 'Source / Board' },
  { value: 'summary', label: 'Role Summary' },
  { value: 'notes', label: 'Notes / Referral' },
  { value: 'ignore', label: 'Ignore column' },
];

const SAMPLE_CSV = `Role Name,Company,City,Work Mode,Type,Compensation,Posting Link,Status,Deadline,Notes
Senior Product Manager,Stripe,San Francisco CA,Hybrid,Full-time,$210k - $265k,https://stripe.com/jobs/listing/senior-pm,Saved,2026-12-05,Referred by Alex
Staff Frontend Engineer,Linear,Remote US,Remote,Full-time,$225k - $270k,https://linear.app/careers/staff-fe,Applied,2026-12-12,Submitted via Ashby
Strategy & Operations Lead,Ramp,New York NY,Hybrid,Full-time,$185k - $220k,https://ramp.com/careers/strategy-ops,Inbox,2026-12-18,Saw in alumni Slack`;

const SAMPLE_COMPANIES_CSV = `Company,Careers URL,Notes
Stripe,https://stripe.com/jobs,Target Product & Strategy roles
Anthropic,https://www.anthropic.com/careers,AI Product & GTM
Linear,,Design-led product team
Figma,https://www.figma.com/careers,Growth & Platform PM`;

export function ImportRolesModal({
  open,
  initialMode = 'roles',
  existingHashes,
  onClose,
  onImportJobs,
  onImportTargetCompanies,
}: ImportRolesModalProps) {
  const [mode, setMode] = useState<'roles' | 'companies'>(initialMode);
  const [step, setStep] = useState<'upload' | 'map'>('upload');
  const [rawText, setRawText] = useState('');
  const [fileName, setFileName] = useState('pasted-roles.csv');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, MappableJobField>>({});
  const [suggestions, setSuggestions] = useState<Record<string, ColumnMappingSuggestion>>({});
  const [isAiMapping, setIsAiMapping] = useState(false);
  const [autoScoreWithAi, setAutoScoreWithAi] = useState(true);
  const [extractUntitledAsTargetCompanies, setExtractUntitledAsTargetCompanies] =
    useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Target Companies CSV state
  const [companyCsvText, setCompanyCsvText] = useState('');
  const [companyFileName, setCompanyFileName] = useState('target-companies.csv');

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setError(null);
    }
  }, [open, initialMode]);

  const existingHashSet = useMemo(() => new Set(existingHashes), [existingHashes]);

  const untitledCompanyCount = useMemo(() => {
    if (rows.length === 0) return 0;
    const probe = buildNormalizedJobsFromMapping({
      rows,
      mapping,
      existingHashes: existingHashSet,
      fileName,
      extractUntitledAsTargetCompanies: true,
    });
    return probe.extractedTargetCompanies.length;
  }, [rows, mapping, existingHashSet, fileName]);

  const previewResult = useMemo(() => {
    if (rows.length === 0) {
      return {
        jobs: [],
        skippedDuplicates: 0,
        skippedInvalid: 0,
        extractedTargetCompanies: [] as ParsedTargetCompanyRow[],
      };
    }
    return buildNormalizedJobsFromMapping({
      rows,
      mapping,
      existingHashes: existingHashSet,
      fileName,
      extractUntitledAsTargetCompanies,
    });
  }, [rows, mapping, existingHashSet, fileName, extractUntitledAsTargetCompanies]);

  const parsedTargetCompanies = useMemo(() => {
    if (!companyCsvText.trim()) return [];
    try {
      return parseTargetCompaniesCsv(companyCsvText);
    } catch {
      return [];
    }
  }, [companyCsvText]);

  if (!open) return null;

  const processRawContent = async (content: string, name: string) => {
    setError(null);
    try {
      const parsed = parseUploadedRolesText(content, name);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setFileName(name);
      const initialMap = heuristicColumnMapping(parsed.headers);
      setMapping(initialMap);
      setStep('map');

      // Ask Gemini to refine column mappings based on header names + sample data
      setIsAiMapping(true);
      try {
        const res = await fetch('/api/import/map', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            headers: parsed.headers,
            sampleRows: parsed.rows.slice(0, 4),
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            mappings?: ColumnMappingSuggestion[];
          };
          if (Array.isArray(data.mappings) && data.mappings.length > 0) {
            const nextMap: Record<string, MappableJobField> = { ...initialMap };
            const suggByCol: Record<string, ColumnMappingSuggestion> = {};
            for (const s of data.mappings) {
              nextMap[s.sourceColumn] = s.targetField;
              suggByCol[s.sourceColumn] = s;
            }
            setMapping(nextMap);
            setSuggestions(suggByCol);
          }
        }
      } catch {
        // Heuristic mapping already populated
      } finally {
        setIsAiMapping(false);
      }
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not parse uploaded data. Please upload valid CSV, TSV, or JSON.'
      );
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setRawText(text);
      void processRawContent(text, file.name);
    };
    reader.readAsText(file);
  };

  const handleCompanyFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setCompanyCsvText(text);
      setCompanyFileName(file.name);
    };
    reader.readAsText(file);
  };

  const handleConfirmCompanyImport = async () => {
    if (parsedTargetCompanies.length === 0) {
      setError('No companies detected. Paste at least one company name or upload a CSV file.');
      return;
    }
    setIsImporting(true);
    setError(null);
    try {
      await onImportTargetCompanies(parsedTargetCompanies, companyFileName);
      setCompanyCsvText('');
      onClose();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Failed to save target companies.'
      );
    } finally {
      setIsImporting(false);
    }
  };

  const handleConfirmImport = async () => {
    const hasJobs = previewResult.jobs.length > 0;
    const hasCompanies = previewResult.extractedTargetCompanies.length > 0;
    if (!hasJobs && !hasCompanies) {
      setError(
        'No new non-duplicate roles or target companies to import. Check your Title and Company column mappings.'
      );
      return;
    }
    setIsImporting(true);
    setError(null);
    try {
      if (hasJobs) {
        await onImportJobs({
          jobs: previewResult.jobs,
          fileName,
          totalRows: rows.length,
          skippedDuplicates: previewResult.skippedDuplicates,
          autoScoreWithAi,
        });
      }
      if (hasCompanies) {
        await onImportTargetCompanies(
          previewResult.extractedTargetCompanies,
          fileName
        );
      }
      setStep('upload');
      setRawText('');
      setHeaders([]);
      setRows([]);
      onClose();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Failed to import records into database.'
      );
    } finally {
      setIsImporting(false);
    }
  };

  const hasTitleMapping = Object.values(mapping).includes('title');
  const hasCompanyMapping = Object.values(mapping).includes('company');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-modal-title"
    >
      <div className="bg-white border border-zinc-200 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {mode === 'companies' ? (
              <Building2 className="w-4 h-4 text-blue-600 shrink-0" />
            ) : (
              <Database className="w-4 h-4 text-blue-600 shrink-0" />
            )}
            <div>
              <h2
                id="import-modal-title"
                className="text-base font-semibold text-zinc-950 tracking-tight"
              >
                {mode === 'companies'
                  ? 'Upload Target Companies (CSV)'
                  : 'Import & Map Existing Roles'}
              </h2>
              <p className="text-xs text-zinc-500">
                {mode === 'companies'
                  ? 'Upload companies you want Meridian to watch for your desired roles during every agent pull.'
                  : 'Upload a CSV, TSV, or JSON job tracker export — rows without a role title can automatically become Target Companies.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close import modal"
            className="p-1.5 text-zinc-400 hover:text-zinc-900 rounded-md cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="px-6 pt-3 pb-0 border-b border-zinc-200 bg-zinc-50/70 flex items-center gap-5 shrink-0">
          <button
            type="button"
            onClick={() => {
              setMode('roles');
              setError(null);
            }}
            className={`relative pb-2.5 text-xs font-medium transition-colors cursor-pointer ${
              mode === 'roles'
                ? 'text-zinc-950'
                : 'text-zinc-500 hover:text-zinc-800'
            }`}
          >
            <span>Import Roles (CSV / JSON)</span>
            {mode === 'roles' && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-zinc-950 rounded-full" />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('companies');
              setError(null);
            }}
            className={`relative pb-2.5 inline-flex items-center gap-1.5 text-xs font-medium transition-colors cursor-pointer ${
              mode === 'companies'
                ? 'text-zinc-950'
                : 'text-zinc-500 hover:text-zinc-800'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Import Target Companies (CSV)</span>
            {mode === 'companies' && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-zinc-950 rounded-full" />
            )}
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2 text-xs text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {mode === 'companies' ? (
            <div className="space-y-5">
              <label className="block border border-dashed border-zinc-300 hover:border-blue-500 hover:bg-blue-50/20 rounded-lg p-7 text-center transition-colors cursor-pointer">
                <input
                  type="file"
                  accept=".csv,.tsv,.txt"
                  onChange={handleCompanyFileSelect}
                  className="sr-only"
                />
                <Building2 className="w-6 h-6 text-zinc-400 mx-auto mb-2" />
                <div className="text-sm font-medium text-zinc-900">
                  Choose a Target Companies CSV file
                </div>
                <p className="text-xs text-zinc-500 mt-1">
                  Works with a single-column company list or columns like <span className="font-mono">Company, Careers URL, Notes</span>.
                </p>
              </label>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="paste-companies-textarea"
                    className="text-xs font-medium text-zinc-700"
                  >
                    Or paste company names / CSV rows (one per line)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setCompanyCsvText(SAMPLE_COMPANIES_CSV);
                      setCompanyFileName('sample-target-companies.csv');
                    }}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 cursor-pointer"
                  >
                    Load sample company CSV
                  </button>
                </div>
                <textarea
                  id="paste-companies-textarea"
                  rows={6}
                  value={companyCsvText}
                  onChange={(e) => setCompanyCsvText(e.target.value)}
                  placeholder={'Company,Careers URL,Notes\nStripe,https://stripe.com/jobs,Target PM roles\nAnthropic,,AI Product'}
                  className="w-full p-3 text-xs font-mono bg-zinc-50 border border-zinc-200 rounded-lg text-zinc-900 placeholder:text-zinc-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>

              {parsedTargetCompanies.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-zinc-900">
                      Preview ({parsedTargetCompanies.length}{' '}
                      {parsedTargetCompanies.length === 1 ? 'company' : 'companies'} detected)
                    </span>
                    <span className="text-zinc-500">
                      Meridian will watch these companies for your target roles on every pull
                    </span>
                  </div>
                  <div className="border border-zinc-200 rounded-lg overflow-x-auto max-h-56 overflow-y-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-zinc-50 border-b border-zinc-200 text-[11px] font-medium text-zinc-500">
                          <th className="py-2 pl-3.5 pr-2">Company</th>
                          <th className="py-2 px-2">Careers URL</th>
                          <th className="py-2 pl-2 pr-3.5">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {parsedTargetCompanies.slice(0, 15).map((c) => (
                          <tr key={c.name}>
                            <td className="py-2 pl-3.5 pr-2 font-medium text-zinc-900">
                              {c.name}
                            </td>
                            <td className="py-2 px-2 font-mono text-zinc-500 max-w-[240px] truncate">
                              {c.careersUrl || 'Auto-discover'}
                            </td>
                            <td className="py-2 pl-2 pr-3.5 text-zinc-500 max-w-[220px] truncate">
                              {c.notes || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : step === 'upload' ? (
            <div className="space-y-5">
              {/* File dropzone */}
              <label className="block border border-dashed border-zinc-300 hover:border-blue-500 hover:bg-blue-50/20 rounded-lg p-8 text-center transition-colors cursor-pointer">
                <input
                  type="file"
                  accept=".csv,.tsv,.json,.txt"
                  onChange={handleFileSelect}
                  className="sr-only"
                />
                <Upload className="w-6 h-6 text-zinc-400 mx-auto mb-2.5" />
                <div className="text-sm font-medium text-zinc-900">
                  Choose a CSV, TSV, or JSON file from your computer
                </div>
                <p className="text-xs text-zinc-500 mt-1">
                  Works with exports from Excel, Google Sheets, Notion, Airtable, Huntr, or Simplify.
                </p>
              </label>

              <div className="flex items-center gap-3 text-xs text-zinc-400">
                <div className="flex-1 border-t border-zinc-200" />
                <span>or paste rows directly</span>
                <div className="flex-1 border-t border-zinc-200" />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="paste-roles-textarea"
                    className="text-xs font-medium text-zinc-700"
                  >
                    Paste CSV, Tab-Separated Spreadsheet Rows, or JSON
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setRawText(SAMPLE_CSV);
                      setFileName('sample-tracker-export.csv');
                    }}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 cursor-pointer"
                  >
                    Load sample template
                  </button>
                </div>
                <textarea
                  id="paste-roles-textarea"
                  rows={7}
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder="Role Name,Company,Location,Salary,URL,Status..."
                  className="w-full p-3 text-xs font-mono bg-zinc-50 border border-zinc-200 rounded-lg text-zinc-900 placeholder:text-zinc-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Mapping status header */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-zinc-200">
                <div className="flex items-center gap-2 text-xs text-zinc-600">
                  <FileSpreadsheet className="w-4 h-4 text-blue-600" />
                  <span className="font-medium text-zinc-950">{fileName}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">{rows.length} rows detected</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">{headers.length} columns</span>
                </div>
                <div className="flex items-center gap-3">
                  {isAiMapping && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-blue-600 font-medium">
                      <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                      <span>AI mapping columns...</span>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setStep('upload')}
                    className="text-xs font-medium text-zinc-500 hover:text-zinc-900 cursor-pointer"
                  >
                    Change file
                  </button>
                </div>
              </div>

              {(!hasTitleMapping || !hasCompanyMapping) && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-800">
                  Map at least <strong>Role Title</strong> and <strong>Company</strong> below so records normalize cleanly into your pipeline.
                </div>
              )}

              {/* Column Mapping Table */}
              <div className="border border-zinc-200 rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-zinc-50 border-b border-zinc-200 text-[11px] font-medium text-zinc-500">
                      <th className="py-2.5 pl-4 pr-3">Uploaded Column</th>
                      <th className="py-2.5 px-3">Sample Value</th>
                      <th className="py-2.5 px-3">Meridian Schema Field</th>
                      <th className="py-2.5 pl-3 pr-4 text-right">Match Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 text-xs">
                    {headers.map((col) => {
                      const sampleVal =
                        rows.find((r) => r[col]?.trim())?.[col] ?? '—';
                      const target = mapping[col] ?? 'ignore';
                      const sugg = suggestions[col];
                      return (
                        <tr key={col} className="hover:bg-zinc-50/70">
                          <td className="py-2.5 pl-4 pr-3 font-mono font-medium text-zinc-900">
                            {col}
                          </td>
                          <td className="py-2.5 px-3 text-zinc-500 max-w-[200px] truncate">
                            {sampleVal}
                          </td>
                          <td className="py-2.5 px-3">
                            <select
                              aria-label={`Map column ${col}`}
                              value={target}
                              onChange={(e) =>
                                setMapping((prev) => ({
                                  ...prev,
                                  [col]: e.target.value as MappableJobField,
                                }))
                              }
                              className="h-8 w-full max-w-[240px] px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                            >
                              {TARGET_FIELD_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2.5 pl-3 pr-4 text-right text-[11px] text-zinc-400 max-w-[180px] truncate">
                            {sugg ? sugg.reason : target === 'ignore' ? 'Skipped' : 'Mapped'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Normalized Preview */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-zinc-900">
                    Database Record Preview (first {Math.min(5, previewResult.jobs.length)} of{' '}
                    <span className="font-mono tabular-nums">{previewResult.jobs.length}</span> ready)
                  </span>
                  <div className="text-zinc-500 font-mono tabular-nums flex items-center gap-2">
                    <span className="text-emerald-700 font-medium">
                      {previewResult.jobs.length} new
                    </span>
                    {previewResult.skippedDuplicates > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{previewResult.skippedDuplicates} duplicates skipped</span>
                      </>
                    )}
                  </div>
                </div>

                {previewResult.jobs.length > 0 && (
                  <div className="border border-zinc-200 rounded-lg overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-zinc-50 border-b border-zinc-200 text-[11px] font-medium text-zinc-500">
                          <th className="py-2 pl-3.5 pr-2">Title</th>
                          <th className="py-2 px-2">Company</th>
                          <th className="py-2 px-2">Location</th>
                          <th className="py-2 px-2">Salary</th>
                          <th className="py-2 px-2">Stage</th>
                          <th className="py-2 pl-2 pr-3.5">Deadline</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {previewResult.jobs.slice(0, 5).map((job) => (
                          <tr key={job.id}>
                            <td className="py-2 pl-3.5 pr-2 font-medium text-zinc-900 max-w-[200px] truncate">
                              {job.title}
                            </td>
                            <td className="py-2 px-2 text-zinc-700">{job.company}</td>
                            <td className="py-2 px-2 text-zinc-500">
                              {job.location} · {job.locationType}
                            </td>
                            <td className="py-2 px-2 font-mono text-zinc-600 tabular-nums">
                              {job.salaryLabel}
                            </td>
                            <td className="py-2 px-2 capitalize text-zinc-600">
                              {job.stage}
                            </td>
                            <td className="py-2 pl-2 pr-3.5 font-mono text-zinc-500 tabular-nums">
                              {job.deadlineAt || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Untitled Role -> Target Company Watchlist Banner */}
              {untitledCompanyCount > 0 && (
                <div className="p-3.5 bg-blue-50/70 border border-blue-200 rounded-lg space-y-2">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={extractUntitledAsTargetCompanies}
                      onChange={(e) =>
                        setExtractUntitledAsTargetCompanies(e.target.checked)
                      }
                      className="mt-0.5 rounded border-zinc-300 text-blue-600 focus:ring-blue-600"
                    />
                    <span className="text-xs text-zinc-700 leading-relaxed">
                      <strong className="font-semibold text-zinc-950">
                        Add {untitledCompanyCount} company-only{' '}
                        {untitledCompanyCount === 1 ? 'row' : 'rows'} (blank or &ldquo;Untitled Role&rdquo;) to Target Companies Watchlist
                      </strong>{' '}
                      — instead of creating empty &ldquo;Untitled Role&rdquo; entries, Meridian will watch those companies and alert you when your desired roles open up.
                    </span>
                  </label>
                </div>
              )}

              {/* AI scoring checkbox */}
              {previewResult.jobs.length > 0 && (
                <label className="flex items-start gap-2.5 pt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoScoreWithAi}
                    onChange={(e) => setAutoScoreWithAi(e.target.checked)}
                    className="mt-0.5 rounded border-zinc-300 text-blue-600 focus:ring-blue-600"
                  />
                  <span className="text-xs text-zinc-600 leading-relaxed">
                    <strong className="font-medium text-zinc-900">
                      Score imported roles against my intake criteria with Gemini
                    </strong>{' '}
                    — calculates a 0–100 match score and fit explanation right after import.
                  </span>
                </label>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-zinc-200 bg-zinc-50/70 flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 text-xs font-medium text-zinc-600 hover:text-zinc-900 cursor-pointer"
          >
            Cancel
          </button>

          {mode === 'companies' ? (
            <button
              type="button"
              disabled={isImporting || parsedTargetCompanies.length === 0}
              onClick={() => void handleConfirmCompanyImport()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 rounded-md transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              <Check className="w-3.5 h-3.5" />
              <span>
                {isImporting
                  ? 'Saving Target Companies...'
                  : `Add ${parsedTargetCompanies.length} Target ${
                      parsedTargetCompanies.length === 1 ? 'Company' : 'Companies'
                    }`}
              </span>
            </button>
          ) : step === 'upload' ? (
            <button
              type="button"
              disabled={!rawText.trim()}
              onClick={() => void processRawContent(rawText, fileName)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 rounded-md transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              <span>Parse &amp; Map Columns</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              disabled={
                isImporting ||
                (previewResult.jobs.length === 0 &&
                  previewResult.extractedTargetCompanies.length === 0)
              }
              onClick={() => void handleConfirmImport()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 rounded-md transition-colors cursor-pointer disabled:cursor-wait"
            >
              <Check className="w-3.5 h-3.5" />
              <span>
                {isImporting
                  ? 'Importing to Database...'
                  : previewResult.jobs.length > 0 &&
                    previewResult.extractedTargetCompanies.length > 0
                  ? `Import ${previewResult.jobs.length} Roles + ${previewResult.extractedTargetCompanies.length} Target Companies`
                  : previewResult.extractedTargetCompanies.length > 0
                  ? `Add ${previewResult.extractedTargetCompanies.length} Target Companies`
                  : `Import ${previewResult.jobs.length} ${
                      previewResult.jobs.length === 1 ? 'Role' : 'Roles'
                    } to Database`}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
