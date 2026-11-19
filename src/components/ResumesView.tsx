import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  DEFAULT_RESUME_ROLE_TYPES,
  parseResumeFileOnServer,
} from '../lib/resumeClient';
import type { CareerExperienceItem, RoleResume } from '../types/job';

interface ResumesViewProps {
  roleTypesFromIntake: string[];
  resumes: RoleResume[];
  careerExperiences: CareerExperienceItem[];
  careerContextNotes: string;
  onSaveResume: (resume: RoleResume) => void;
  onDeleteResume: (resumeId: string) => void;
  onSaveCareerExperiences: (items: CareerExperienceItem[]) => void;
  onSaveCareerContextNotes: (notes: string) => void;
}

export function ResumesView({
  roleTypesFromIntake,
  resumes,
  careerExperiences,
  careerContextNotes,
  onSaveResume,
  onDeleteResume,
  onSaveCareerExperiences,
  onSaveCareerContextNotes,
}: ResumesViewProps) {
  const suggestedRoleTypes = useMemo(() => {
    const merged = [...roleTypesFromIntake, ...DEFAULT_RESUME_ROLE_TYPES];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of merged) {
      const trimmed = r.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(trimmed);
      }
    }
    return out;
  }, [roleTypesFromIntake]);

  // Upload / Paste resume form state
  const [selectedRoleType, setSelectedRoleType] = useState<string>(
    suggestedRoleTypes[0] || 'Product Manager'
  );
  const [customRoleType, setCustomRoleType] = useState('');
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showPasteResume, setShowPasteResume] = useState(false);
  const [pasteFileName, setPasteFileName] = useState('');
  const [pasteRawText, setPasteRawText] = useState('');
  const [expandedResumeId, setExpandedResumeId] = useState<string | null>(null);

  // Extended career experiences (off-resume & deep details)
  const [showAddExp, setShowAddExp] = useState(false);
  const [expTitle, setExpTitle] = useState('');
  const [expOrg, setExpOrg] = useState('');
  const [expDates, setExpDates] = useState('');
  const [expOnResume, setExpOnResume] = useState(false);
  const [expDetails, setExpDetails] = useState('');

  // Brain dump notes
  const [notesDraft, setNotesDraft] = useState(careerContextNotes);
  const [notesSavedBanner, setNotesSavedBanner] = useState(false);

  const effectiveRoleType = (customRoleType.trim() || selectedRoleType).trim() || 'General';

  const upsertByRoleType = (roleType: string, fileName: string, rawText: string) => {
    const existing = resumes.find(
      (r) => r.roleType.toLowerCase() === roleType.toLowerCase()
    );
    const next: RoleResume = {
      id:
        existing?.id ||
        `res-${roleType.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-${Date.now().toString(36)}`,
      roleType,
      fileName,
      rawText,
      uploadedAt: new Date().toISOString().slice(0, 10),
    };
    onSaveResume(next);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError(null);
    setIsParsingFile(true);
    try {
      const rawText = await parseResumeFileOnServer(file);
      upsertByRoleType(effectiveRoleType, file.name, rawText);
      setCustomRoleType('');
    } catch (err: unknown) {
      setUploadError(
        err instanceof Error ? err.message : 'Could not parse uploaded resume.'
      );
    } finally {
      setIsParsingFile(false);
    }
  };

  const handleReplaceFile = async (
    roleType: string,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError(null);
    setIsParsingFile(true);
    try {
      const rawText = await parseResumeFileOnServer(file);
      upsertByRoleType(roleType, file.name, rawText);
    } catch (err: unknown) {
      setUploadError(
        err instanceof Error ? err.message : 'Could not parse replacement resume.'
      );
    } finally {
      setIsParsingFile(false);
    }
  };

  const handleSavePastedResume = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pasteRawText.trim()) return;
    upsertByRoleType(
      effectiveRoleType,
      pasteFileName.trim() || `${effectiveRoleType.replace(/\s+/g, '_')}_Resume.docx`,
      pasteRawText.trim()
    );
    setPasteRawText('');
    setPasteFileName('');
    setShowPasteResume(false);
  };

  const handleAddExperience = (e: React.FormEvent) => {
    e.preventDefault();
    if (!expTitle.trim() && !expDetails.trim()) return;
    const item: CareerExperienceItem = {
      id: `exp-${Date.now()}`,
      title: expTitle.trim() || 'Project / Role',
      organization: expOrg.trim() || 'Independent / Additional',
      dates: expDates.trim(),
      onResume: expOnResume,
      details: expDetails.trim(),
    };
    onSaveCareerExperiences([item, ...careerExperiences]);
    setExpTitle('');
    setExpOrg('');
    setExpDates('');
    setExpOnResume(false);
    setExpDetails('');
    setShowAddExp(false);
  };

  const handleToggleOnResume = (expId: string) => {
    onSaveCareerExperiences(
      careerExperiences.map((item) =>
        item.id === expId ? { ...item, onResume: !item.onResume } : item
      )
    );
  };

  const handleDeleteExperience = (expId: string) => {
    onSaveCareerExperiences(careerExperiences.filter((item) => item.id !== expId));
  };

  const handleSaveNotes = () => {
    onSaveCareerContextNotes(notesDraft);
    setNotesSavedBanner(true);
    window.setTimeout(() => setNotesSavedBanner(false), 2500);
  };

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Page Header */}
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-950 font-[var(--font-display)]">
          Resumes &amp; Extended Career Context
        </h1>
        <p className="text-sm text-zinc-500 leading-relaxed max-w-3xl">
          Upload one base resume per target role track (e.g., PM, PMM, Strategy) and capture roles, projects, or achievements that aren&apos;t currently on your 1-page resume. When you tailor a resume in any job&apos;s sidebar, Meridian picks the right base track, pulls in relevant off-resume details, and exports a 1-page <span className="font-mono text-xs text-zinc-700">.docx</span> with every edit highlighted in red.
        </p>
      </div>

      {/* SECTION 1: Role-Specific Base Resumes */}
      <section className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <FileText className="w-4 h-4 text-blue-600" />
            <div>
              <h2 className="text-sm font-semibold text-zinc-950">
                Base Resumes by Role Type
              </h2>
              <p className="text-xs text-zinc-500">
                Upload one resume per role track (.docx, .pdf, or .txt). Uploading again for the same track replaces it cleanly.
              </p>
            </div>
          </div>
          <span className="text-xs font-mono text-zinc-500 tabular-nums">
            {resumes.length} {resumes.length === 1 ? 'track' : 'tracks'} uploaded
          </span>
        </div>

        <div className="p-6 space-y-5">
          {/* Upload Bar */}
          <div className="p-4 bg-zinc-50/80 border border-zinc-200 rounded-lg space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-4 space-y-1">
                <label
                  htmlFor="resume-role-track"
                  className="block text-xs font-medium text-zinc-700"
                >
                  Role Track
                </label>
                <select
                  id="resume-role-track"
                  value={selectedRoleType}
                  onChange={(e) => setSelectedRoleType(e.target.value)}
                  className="w-full h-9 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                >
                  {suggestedRoleTypes.map((rt) => (
                    <option key={rt} value={rt}>
                      {rt}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-4 space-y-1">
                <label
                  htmlFor="resume-custom-track"
                  className="block text-xs font-medium text-zinc-700"
                >
                  Or Custom Role Type
                </label>
                <input
                  id="resume-custom-track"
                  type="text"
                  value={customRoleType}
                  onChange={(e) => setCustomRoleType(e.target.value)}
                  placeholder="e.g., AI PM, Corp Dev, GTM Strategy"
                  className="w-full h-9 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>

              <div className="sm:col-span-4 flex items-center gap-2">
                <label className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 px-3 text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-md cursor-pointer whitespace-nowrap">
                  <Upload className="w-3.5 h-3.5" />
                  <span>{isParsingFile ? 'Reading file...' : 'Upload .docx / .pdf'}</span>
                  <input
                    type="file"
                    accept=".docx,.pdf,.txt,.md"
                    disabled={isParsingFile}
                    onChange={(e) => void handleFileChange(e)}
                    className="sr-only"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setShowPasteResume((v) => !v)}
                  className="h-9 px-3 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md whitespace-nowrap cursor-pointer"
                >
                  Paste Text
                </button>
              </div>
            </div>

            {uploadError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-md flex items-start gap-2 text-xs text-red-700">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{uploadError}</span>
              </div>
            )}

            {showPasteResume && (
              <form
                onSubmit={handleSavePastedResume}
                className="pt-3 border-t border-zinc-200 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-zinc-800">
                    Paste base resume for <span className="text-blue-700">{effectiveRoleType}</span>
                  </span>
                  <input
                    type="text"
                    value={pasteFileName}
                    onChange={(e) => setPasteFileName(e.target.value)}
                    placeholder="Optional file label (e.g., Alex_PM_Resume.docx)"
                    className="h-7 px-2 text-xs bg-white border border-zinc-200 rounded-md text-zinc-800 w-64"
                  />
                </div>
                <textarea
                  rows={6}
                  required
                  value={pasteRawText}
                  onChange={(e) => setPasteRawText(e.target.value)}
                  placeholder="Paste your full 1-page resume text here..."
                  className="w-full p-2.5 text-xs font-mono leading-relaxed bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-blue-600"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowPasteResume(false)}
                    className="px-2.5 py-1.5 text-xs text-zinc-500 hover:text-zinc-900 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
                  >
                    Save Resume Track
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Uploaded Resume Tracks List */}
          {resumes.length === 0 ? (
            <div className="py-8 text-center border border-dashed border-zinc-200 rounded-lg space-y-1">
              <p className="text-sm font-medium text-zinc-800">
                No role resumes uploaded yet
              </p>
              <p className="text-xs text-zinc-500 max-w-md mx-auto">
                Upload your PM, PMM, Strategy, or Engineering resume above so you can generate 1-page redlined <span className="font-mono">.docx</span> resumes straight from any role&apos;s sidebar.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 border border-zinc-200 rounded-lg">
              {resumes.map((res) => {
                const isExpanded = expandedResumeId === res.id;
                const wordCount = res.rawText.trim().split(/\s+/).filter(Boolean).length;
                return (
                  <div key={res.id} className="p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-zinc-950">
                            {res.roleType}
                          </span>
                          <span className="text-zinc-300" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-xs font-mono text-zinc-600 truncate">
                            {res.fileName}
                          </span>
                        </div>
                        <div className="text-[11.5px] font-mono text-zinc-400 tabular-nums">
                          Uploaded {res.uploadedAt} · {wordCount} words parsed
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedResumeId(isExpanded ? null : res.id)
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-zinc-600 hover:text-zinc-950 bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 rounded-md cursor-pointer"
                        >
                          <span>{isExpanded ? 'Hide Text' : 'Inspect Text'}</span>
                          {isExpanded ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <label className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md cursor-pointer">
                          <Upload className="w-3 h-3" />
                          <span>Replace</span>
                          <input
                            type="file"
                            accept=".docx,.pdf,.txt,.md"
                            disabled={isParsingFile}
                            onChange={(e) => void handleReplaceFile(res.roleType, e)}
                            className="sr-only"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => onDeleteResume(res.id)}
                          aria-label={`Delete ${res.roleType} resume`}
                          className="p-1.5 text-zinc-400 hover:text-red-600 rounded-md cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <pre className="p-3.5 bg-zinc-50 border border-zinc-200 rounded-md text-[11.5px] font-mono text-zinc-700 whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed">
                        {res.rawText}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* SECTION 2: Extended Career Context (Roles & Accomplishments Not On Resume) */}
      <section className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <BookOpen className="w-4 h-4 text-blue-600" />
            <div>
              <h2 className="text-sm font-semibold text-zinc-950">
                All Roles &amp; Off-Resume Experience Bank
              </h2>
              <p className="text-xs text-zinc-500">
                Add roles, earlier jobs, side projects, consulting engagements, or extra impact details that didn&apos;t fit on your 1-page resume. Meridian pulls from here whenever an off-resume detail makes you a stronger fit for a specific job.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowAddExp((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-md cursor-pointer shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{showAddExp ? 'Cancel' : 'Add Role / Project'}</span>
          </button>
        </div>

        <div className="p-6 space-y-5">
          {showAddExp && (
            <form
              onSubmit={handleAddExperience}
              className="p-4 bg-zinc-50/80 border border-zinc-200 rounded-lg space-y-3"
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <input
                  type="text"
                  required
                  value={expTitle}
                  onChange={(e) => setExpTitle(e.target.value)}
                  placeholder="Role or project title (e.g., GTM Strategy Lead)"
                  className="h-9 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400"
                />
                <input
                  type="text"
                  value={expOrg}
                  onChange={(e) => setExpOrg(e.target.value)}
                  placeholder="Company / org / club (e.g., Acme Corp)"
                  className="h-9 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400"
                />
                <input
                  type="text"
                  value={expDates}
                  onChange={(e) => setExpDates(e.target.value)}
                  placeholder="Dates (e.g., 2021–2023 or Fall 2025)"
                  className="h-9 px-2.5 text-xs font-mono bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400"
                />
              </div>

              <textarea
                rows={4}
                required
                value={expDetails}
                onChange={(e) => setExpDetails(e.target.value)}
                placeholder="Share concrete accomplishments, metrics, tools, cross-functional work, or context that isn't currently on your resume (e.g., Built pricing elasticity model for 3 enterprise tiers, lifted NRR by 8%, led 4-person launch across Sales & Eng)..."
                className="w-full p-2.5 text-xs leading-relaxed bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-blue-600"
              />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-xs text-zinc-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!expOnResume}
                    onChange={(e) => setExpOnResume(!e.target.checked)}
                    className="rounded border-zinc-300 text-blue-600 focus:ring-blue-600"
                  />
                  <span>Not currently on my resume (extra context for tailoring)</span>
                </label>

                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Save Experience</span>
                </button>
              </div>
            </form>
          )}

          {careerExperiences.length === 0 && !showAddExp ? (
            <div className="p-4 bg-zinc-50/70 border border-zinc-200 rounded-lg flex items-start gap-3">
              <Sparkles className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <div className="text-xs text-zinc-600 leading-relaxed">
                <span className="font-semibold text-zinc-900">Why add off-resume roles?</span>{' '}
                A 1-page resume leaves out most of your career. Adding older roles, internships, pro-bono consulting, technical side projects, or deeper metrics for your current roles lets Meridian swap in the exact proof points a hiring manager wants — highlighted in red so you can approve every change.
              </div>
            </div>
          ) : (
            careerExperiences.length > 0 && (
              <div className="divide-y divide-zinc-100 border border-zinc-200 rounded-lg">
                {careerExperiences.map((item) => (
                  <div key={item.id} className="p-4 space-y-1.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-zinc-950">
                            {item.title}
                          </span>
                          <span className="text-xs text-zinc-500">
                            @ {item.organization}
                          </span>
                          {item.dates && (
                            <span className="text-xs font-mono text-zinc-400">
                              · {item.dates}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleToggleOnResume(item.id)}
                          className={`mt-0.5 text-[11px] font-medium cursor-pointer ${
                            item.onResume
                              ? 'text-zinc-500 hover:text-zinc-800'
                              : 'text-blue-700 hover:text-blue-800'
                          }`}
                        >
                          {item.onResume
                            ? 'On current resume (extra depth)'
                            : 'Off-resume — available for agent to pull in'}
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDeleteExperience(item.id)}
                        aria-label={`Remove ${item.title}`}
                        className="p-1 text-zinc-400 hover:text-red-600 rounded cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-xs text-zinc-700 leading-relaxed whitespace-pre-line">
                      {item.details}
                    </p>
                  </div>
                ))}
              </div>
            )
          )}

          {/* Freeform Extended Career Brain Dump */}
          <div className="pt-4 border-t border-zinc-100 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <label
                  htmlFor="career-context-notes"
                  className="block text-xs font-semibold text-zinc-900"
                >
                  Additional Background, Metrics &amp; Unlisted Accomplishments
                </label>
                <p className="text-xs text-zinc-500">
                  Freeform notes on tools, domains, awards, side projects, languages, or specific projects that didn&apos;t make your base resumes.
                </p>
              </div>
              {notesSavedBanner && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 shrink-0">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Saved</span>
                </span>
              )}
            </div>

            <textarea
              id="career-context-notes"
              rows={5}
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              placeholder="Example: Also built an internal SQL/Looker self-serve revenue dashboard used by 40 reps; ran 25 enterprise pricing discovery interviews in healthcare SaaS; fluent in Spanish; led university venture fund diligence on 6 AI startups..."
              className="w-full p-3 text-xs leading-relaxed bg-white border border-zinc-200 rounded-lg text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />

            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-mono text-zinc-400 tabular-nums">
                {notesDraft.length.toLocaleString()} / 15,000 chars
              </span>
              <button
                type="button"
                onClick={handleSaveNotes}
                disabled={notesDraft === careerContextNotes}
                className="px-3.5 py-1.5 text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-300 rounded-md cursor-pointer disabled:cursor-default"
              >
                Save Extended Context
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
