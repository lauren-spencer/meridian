import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  FileText,
  Globe,
  Hash,
  Info,
  Mail,
  MessageCircle,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { VERIFIED_LIVE_PRESETS } from '../data/initialData';
import {
  buildGmailQueryFromSenders,
  compileIntakeToSearchPrompt,
  DASHBOARD_CADENCE_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  GMAIL_SENDER_PRESETS,
  normalizeSenderInput,
  ROLE_TYPE_SUGGESTIONS,
  WORK_MODE_OPTIONS,
} from '../lib/intakeHelpers';
import {
  DEFAULT_RESUME_ROLE_TYPES,
  parseResumeFileOnServer,
} from '../lib/resumeClient';
import type {
  CareerExperienceItem,
  JobSource,
  LocationType,
  RoleResume,
  UserIntakeProfile,
} from '../types/job';
import { GoogleSignInButton } from './GoogleSignInButton';

interface IntakeModalProps {
  open: boolean;
  isFirstRun: boolean;
  isSignedIn: boolean;
  userEmail: string | null;
  userDisplayName: string | null;
  isAuthLoading: boolean;
  gmailConnected: boolean;
  gmailError: string | null;
  slackConnected: boolean;
  slackTeamName: string | null;
  slackConfigured: boolean;
  slackHasClientId: boolean;
  slackHasClientSecret: boolean;
  slackRedirectUri: string | null;
  slackError: string | null;
  initialProfile: UserIntakeProfile;
  initialResumes: RoleResume[];
  initialAutoScheduleEnabled: boolean;
  initialAutoScheduleMinutes: number;
  sources: JobSource[];
  importedCountInSession: number;
  targetCompaniesCount: number;
  onSignInAccount: (includeGmailScope: boolean) => Promise<void>;
  onConnectGmail: () => Promise<void>;
  onConnectSlack: () => void;
  onSaveResume: (resume: RoleResume) => void;
  onDeleteResume: (resumeId: string) => void;
  onOpenImportModal: () => void;
  onOpenTargetCompaniesImport: () => void;
  onUploadWhatsAppInIntake: (rawText: string, groupName: string) => Promise<number>;
  onClose: () => void;
  onCompleteIntake: (params: {
    profile: UserIntakeProfile;
    selectedSourceUrls: string[];
    customSourceUrl?: string;
    autoScheduleEnabled: boolean;
    autoScheduleMinutes: number;
    triggerInitialPull: boolean;
  }) => Promise<void>;
}

export function IntakeModal({
  open,
  isFirstRun,
  isSignedIn,
  userEmail,
  userDisplayName,
  isAuthLoading,
  gmailConnected,
  gmailError,
  slackConnected,
  slackTeamName,
  slackConfigured,
  slackHasClientId,
  slackHasClientSecret,
  slackRedirectUri,
  slackError,
  initialProfile,
  initialResumes,
  initialAutoScheduleEnabled,
  initialAutoScheduleMinutes,
  sources,
  importedCountInSession,
  targetCompaniesCount,
  onSignInAccount,
  onConnectGmail,
  onConnectSlack,
  onSaveResume,
  onDeleteResume,
  onOpenImportModal,
  onOpenTargetCompaniesImport,
  onUploadWhatsAppInIntake,
  onClose,
  onCompleteIntake,
}: IntakeModalProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(isSignedIn ? 2 : 1);

  const [roleTypes, setRoleTypes] = useState<string[]>(initialProfile.roleTypes);
  const [customRoleInput, setCustomRoleInput] = useState('');

  const [locations, setLocations] = useState<string[]>(initialProfile.locations);
  const [locationInput, setLocationInput] = useState('');

  const [workModes, setWorkModes] = useState<LocationType[]>(initialProfile.workModes);

  const [keywords, setKeywords] = useState<string[]>(initialProfile.keywords);
  const [keywordInput, setKeywordInput] = useState('');

  const [employmentTypes, setEmploymentTypes] = useState<string[]>(
    initialProfile.employmentTypes
  );

  // Step 3: Role-specific resumes & extended/off-resume experience context
  const [resumeUploadTrack, setResumeUploadTrack] = useState<string>(
    initialProfile.roleTypes[0] || DEFAULT_RESUME_ROLE_TYPES[0]
  );
  const [isParsingResume, setIsParsingResume] = useState(false);
  const [resumeUploadError, setResumeUploadError] = useState<string | null>(null);
  const [careerExperiences, setCareerExperiences] = useState<CareerExperienceItem[]>(
    initialProfile.careerExperiences ?? []
  );
  const [careerContextNotes, setCareerContextNotes] = useState<string>(
    initialProfile.careerContextNotes ?? ''
  );
  const [expTitle, setExpTitle] = useState('');
  const [expOrg, setExpOrg] = useState('');
  const [expDates, setExpDates] = useState('');
  const [expDetails, setExpDetails] = useState('');
  const [expOffResume, setExpOffResume] = useState(true);

  // Dashboard auto-update cadence preference
  const [cadenceChoiceId, setCadenceChoiceId] = useState<string>(() => {
    if (!initialAutoScheduleEnabled) return '4h'; // Recommend Every 4 hours on fresh intake
    const match = DASHBOARD_CADENCE_OPTIONS.find(
      (opt) => opt.enabled && opt.minutes === initialAutoScheduleMinutes
    );
    return match ? match.id : '4h';
  });

  // Dynamic Gmail alert senders (defaults to LinkedIn only; fully customizable)
  const [gmailSenders, setGmailSenders] = useState<string[]>(
    initialProfile.gmailSenders
  );
  const [senderInput, setSenderInput] = useState('');

  // Slack channels
  const [slackChannels, setSlackChannels] = useState<string[]>(
    initialProfile.slackChannels
  );
  const [slackChannelInput, setSlackChannelInput] = useState('');
  const [showSlackDetails, setShowSlackDetails] = useState(false);
  const [slackConnectAttempted, setSlackConnectAttempted] = useState(false);
  const [copiedSlackUrl, setCopiedSlackUrl] = useState(false);

  // WhatsApp groups + optional quick upload
  const [whatsappGroups, setWhatsappGroups] = useState<string[]>(
    initialProfile.whatsappGroups
  );
  const [whatsappGroupInput, setWhatsappGroupInput] = useState('');
  const [waScanning, setWaScanning] = useState(false);
  const [waImportedCount, setWaImportedCount] = useState(0);

  // Career board selection
  const allBoardOptions = useMemo(() => {
    const map = new Map<string, { name: string; url: string; atsType: string }>();
    for (const s of sources) {
      map.set(s.url.toLowerCase(), { name: s.name, url: s.url, atsType: s.atsType });
    }
    for (const p of VERIFIED_LIVE_PRESETS) {
      if (!map.has(p.url.toLowerCase())) {
        map.set(p.url.toLowerCase(), p);
      }
    }
    return Array.from(map.values());
  }, [sources]);

  const [selectedUrls, setSelectedUrls] = useState<string[]>(() =>
    sources.filter((s) => s.enabled).map((s) => s.url)
  );
  const [customBoardUrl, setCustomBoardUrl] = useState('');
  const [triggerInitialPull, setTriggerInitialPull] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Keep cadence choice synced when reopening modal for an existing profile
  useEffect(() => {
    if (!open) return;
    if (!isFirstRun) {
      if (!initialAutoScheduleEnabled) {
        setCadenceChoiceId('manual');
      } else {
        const match = DASHBOARD_CADENCE_OPTIONS.find(
          (opt) => opt.enabled && opt.minutes === initialAutoScheduleMinutes
        );
        setCadenceChoiceId(match ? match.id : '4h');
      }
    }
  }, [open, isFirstRun, initialAutoScheduleEnabled, initialAutoScheduleMinutes]);

  const resumeTrackOptions = useMemo(() => {
    const merged = [...roleTypes, ...DEFAULT_RESUME_ROLE_TYPES];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of merged) {
      const clean = r.trim();
      if (!clean) continue;
      if (!seen.has(clean.toLowerCase())) {
        seen.add(clean.toLowerCase());
        out.push(clean);
      }
    }
    return out;
  }, [roleTypes]);

  if (!open) return null;

  const toggleItem = <T extends string>(
    list: T[],
    setter: React.Dispatch<React.SetStateAction<T[]>>,
    item: T
  ) => {
    setter((prev) =>
      prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item]
    );
  };

  const addTag = (
    raw: string,
    list: string[],
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    clearInput: () => void,
    maxItems: number,
    transform?: (v: string) => string
  ) => {
    const parts = raw
      .split(/[,;\n]/)
      .map((s) => (transform ? transform(s) : s.trim()))
      .filter(Boolean);
    if (parts.length === 0) return;
    setter((prev) => {
      const next = [...prev];
      for (const p of parts) {
        if (!next.some((x) => x.toLowerCase() === p.toLowerCase()) && next.length < maxItems) {
          next.push(p);
        }
      }
      return next;
    });
    clearInput();
  };

  const handleWhatsAppFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      if (!text.trim()) return;
      const gName = file.name.replace(/\.txt$/i, '').replace(/^_chat/i, 'WhatsApp Group');
      setWaScanning(true);
      try {
        const added = await onUploadWhatsAppInIntake(text, gName);
        setWaImportedCount((c) => c + added);
        if (!whatsappGroups.includes(gName)) {
          setWhatsappGroups((prev) => [...prev, gName].slice(0, 20));
        }
      } finally {
        setWaScanning(false);
      }
    };
    reader.readAsText(file);
  };

  const compiledPromptPreview = compileIntakeToSearchPrompt({
    roleTypes,
    locations,
    workModes,
    keywords,
    employmentTypes,
  });

  const compiledGmailPreview = buildGmailQueryFromSenders(gmailSenders);

  const selectedCadence =
    DASHBOARD_CADENCE_OPTIONS.find((opt) => opt.id === cadenceChoiceId) ??
    DASHBOARD_CADENCE_OPTIONS[1];

  const handleIntakeResumeFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setResumeUploadError(null);
    setIsParsingResume(true);
    try {
      const rawText = await parseResumeFileOnServer(file);
      const track = resumeUploadTrack || roleTypes[0] || 'Product Manager';
      const existing = initialResumes.find(
        (r) => r.roleType.toLowerCase() === track.toLowerCase()
      );
      onSaveResume({
        id:
          existing?.id ||
          `res-${track.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 36)}-${Date.now().toString(36)}`,
        roleType: track,
        fileName: file.name,
        rawText,
        uploadedAt: new Date().toISOString().slice(0, 10),
      });
    } catch (err: unknown) {
      setResumeUploadError(
        err instanceof Error ? err.message : 'Could not parse uploaded resume.'
      );
    } finally {
      setIsParsingResume(false);
    }
  };

  const handleAddIntakeExperience = () => {
    if (!expTitle.trim() && !expDetails.trim()) return;
    const item: CareerExperienceItem = {
      id: `exp-${Date.now()}`,
      title: expTitle.trim() || 'Additional Role / Project',
      organization: expOrg.trim() || 'Independent / Additional',
      dates: expDates.trim(),
      onResume: !expOffResume,
      details: expDetails.trim(),
    };
    setCareerExperiences((prev) => [item, ...prev].slice(0, 30));
    setExpTitle('');
    setExpOrg('');
    setExpDates('');
    setExpDetails('');
    setExpOffResume(true);
  };

  const handleFinish = async () => {
    setIsSaving(true);
    try {
      await onCompleteIntake({
        profile: {
          uid: initialProfile.uid,
          email: userEmail || initialProfile.email,
          displayName: userDisplayName || initialProfile.displayName,
          onboardingCompleted: true,
          roleTypes,
          locations,
          workModes,
          keywords,
          employmentTypes,
          gmailSenders,
          slackChannels,
          whatsappGroups,
          careerContextNotes: careerContextNotes.trim(),
          careerExperiences,
        },
        selectedSourceUrls: selectedUrls,
        customSourceUrl: customBoardUrl.trim() || undefined,
        autoScheduleEnabled: selectedCadence.enabled,
        autoScheduleMinutes: selectedCadence.minutes,
        triggerInitialPull,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const STEPS = [
    { num: 1 as const, label: 'Account' },
    { num: 2 as const, label: 'Target Roles' },
    { num: 3 as const, label: 'Resumes & Context' },
    { num: 4 as const, label: 'Channels & Cadence' },
    { num: 5 as const, label: 'Import & Pull' },
  ];

  return (
    <div
      className="fixed inset-0 z-40 bg-[#FAFAFA]/95 backdrop-blur-xs overflow-y-auto flex items-start sm:items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="intake-heading"
    >
      <div className="bg-white border border-zinc-200 rounded-xl shadow-xl w-full max-w-3xl overflow-hidden my-auto">
        {/* Top bar */}
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-[15px] font-bold tracking-tight text-zinc-950 font-[var(--font-display)]">
              Meridian
            </span>
            <span className="text-zinc-300" aria-hidden="true">
              /
            </span>
            <h1 id="intake-heading" className="text-sm font-medium text-zinc-700 truncate">
              {isFirstRun ? 'Workspace Intake & Setup' : 'Edit Intake & Channels'}
            </h1>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-xs text-zinc-500 hover:text-zinc-900 inline-flex items-center gap-1 cursor-pointer"
          >
            <span>{isFirstRun ? 'Skip for now' : 'Close'}</span>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Clean Step Indicator */}
        <div className="px-6 py-3 bg-zinc-50/70 border-b border-zinc-200 flex items-center gap-2 sm:gap-5 overflow-x-auto">
          {STEPS.map((s) => {
            const active = step === s.num;
            const completed = step > s.num;
            return (
              <button
                key={s.num}
                type="button"
                onClick={() => setStep(s.num)}
                className={`inline-flex items-center gap-2 text-xs whitespace-nowrap transition-colors cursor-pointer ${
                  active
                    ? 'text-zinc-950 font-semibold'
                    : completed
                    ? 'text-blue-700 font-medium'
                    : 'text-zinc-400 hover:text-zinc-700'
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full inline-flex items-center justify-center font-mono text-[11px] tabular-nums border ${
                    active
                      ? 'bg-zinc-950 text-white border-zinc-950'
                      : completed
                      ? 'bg-blue-50 text-blue-700 border-blue-200'
                      : 'bg-white text-zinc-400 border-zinc-200'
                  }`}
                >
                  {completed ? <Check className="w-3 h-3" /> : s.num}
                </span>
                <span>{s.label}</span>
              </button>
            );
          })}
        </div>

        {/* Step Content */}
        <div className="p-6 sm:p-7 max-h-[68vh] overflow-y-auto space-y-6">
          {/* STEP 1: Account Creation */}
          {step === 1 && (
            <div className="space-y-5">
              <div className="space-y-1.5">
                <h2 className="text-lg font-semibold tracking-tight text-zinc-950">
                  Create your Meridian workspace account
                </h2>
                <p className="text-sm text-zinc-500 leading-relaxed">
                  Sign in with Google to persist your search criteria, email &amp; chat alert rules, imported spreadsheets, and triage history across sessions.
                </p>
              </div>

              {isSignedIn && userEmail ? (
                <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-lg flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-zinc-950 truncate">
                        {userDisplayName || 'Meridian Account'}
                      </div>
                      <div className="text-xs text-zinc-600 font-mono truncate">
                        {userEmail}
                        {gmailConnected && ' · Gmail read-only active'}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md whitespace-nowrap cursor-pointer"
                  >
                    Continue
                  </button>
                </div>
              ) : (
                <div className="p-5 bg-zinc-50/70 border border-zinc-200 rounded-lg space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="text-sm font-semibold text-zinc-950">
                        Sign in with Google (Recommended)
                      </div>
                      <p className="text-xs text-zinc-500 leading-relaxed max-w-md">
                        Recommended to use the Google account where you receive job alert emails (LinkedIn, Indeed, Handshake, campus boards, or recruiter outreach) so Meridian can scan them in Step 4.
                      </p>
                    </div>
                    <div className="shrink-0">
                      <GoogleSignInButton
                        disabled={isAuthLoading}
                        onClick={() =>
                          void onSignInAccount(true).then(() => setStep(2))
                        }
                        label={isAuthLoading ? 'Signing in...' : 'Continue with Google'}
                      />
                    </div>
                  </div>

                  {gmailError && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2 text-xs text-red-700">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{gmailError}</span>
                    </div>
                  )}

                  <div className="pt-3 border-t border-zinc-200/80 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                    <span>Prefer to connect Gmail later?</span>
                    <button
                      type="button"
                      disabled={isAuthLoading}
                      onClick={() =>
                        void onSignInAccount(false)
                          .then(() => setStep(2))
                          .catch(() => {})
                      }
                      className="font-medium text-zinc-700 hover:text-zinc-950 underline underline-offset-2 cursor-pointer"
                    >
                      Sign in without Gmail permission
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div className="p-3.5 border border-zinc-200 rounded-lg space-y-1">
                  <Briefcase className="w-4 h-4 text-blue-600" />
                  <div className="text-xs font-semibold text-zinc-900">Tailored Intake</div>
                  <p className="text-[11.5px] text-zinc-500 leading-relaxed">
                    Define target roles, cities, keywords, and employment types.
                  </p>
                </div>
                <div className="p-3.5 border border-zinc-200 rounded-lg space-y-1">
                  <Mail className="w-4 h-4 text-blue-600" />
                  <div className="text-xs font-semibold text-zinc-900">Multi-Channel Pull</div>
                  <p className="text-[11.5px] text-zinc-500 leading-relaxed">
                    Pull roles from Gmail alert senders, Slack, WhatsApp, and ATS boards.
                  </p>
                </div>
                <div className="p-3.5 border border-zinc-200 rounded-lg space-y-1">
                  <Database className="w-4 h-4 text-blue-600" />
                  <div className="text-xs font-semibold text-zinc-900">Import Existing Lists</div>
                  <p className="text-[11.5px] text-zinc-500 leading-relaxed">
                    Upload CSV/JSON trackers and auto-map columns to your database.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Role Criteria Intake */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-zinc-950">
                  What roles are you looking for?
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Meridian uses these fields to filter incoming postings and score every role from 0–100.
                </p>
              </div>

              {/* Pacing & "Edit Anytime" Site Map Notice */}
              <div className="p-3.5 bg-zinc-50 border border-zinc-200 rounded-lg flex items-start gap-2.5 text-xs text-zinc-600">
                <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <div className="space-y-1.5 leading-relaxed">
                  <p className="text-zinc-800">
                    <strong className="font-semibold text-zinc-950">
                      Heads up — initial setup can take a few minutes.
                    </strong>{' '}
                    Every step in this wizard is optional, and you can skip ahead or update any section anytime later:
                  </p>
                  <ul className="space-y-0.5 text-[11.5px] text-zinc-600 list-disc pl-4">
                    <li>
                      <strong className="font-medium text-zinc-800">Target roles, locations &amp; criteria:</strong>{' '}
                      Left sidebar → <span className="font-medium text-zinc-900">Preferences</span> (or reopen <span className="font-medium text-zinc-900">Setup Wizard</span>)
                    </li>
                    <li>
                      <strong className="font-medium text-zinc-800">Resumes &amp; off-resume experience:</strong>{' '}
                      Left sidebar → <span className="font-medium text-zinc-900">Resumes &amp; Context</span>
                    </li>
                    <li>
                      <strong className="font-medium text-zinc-800">Gmail alerts, Slack, WhatsApp, ATS boards &amp; Target Companies:</strong>{' '}
                      Left sidebar → <span className="font-medium text-zinc-900">Sources</span>
                    </li>
                    <li>
                      <strong className="font-medium text-zinc-800">Upload existing roles or Target Companies CSV:</strong>{' '}
                      Top bar → <span className="font-medium text-zinc-900">Import Roles</span> or <span className="font-medium text-zinc-900">Sources</span>
                    </li>
                  </ul>
                </div>
              </div>

              {/* Role Types */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-zinc-900">
                  Target Role Types
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ROLE_TYPE_SUGGESTIONS.map((role) => {
                    const active = roleTypes.includes(role);
                    return (
                      <button
                        key={role}
                        type="button"
                        onClick={() => toggleItem(roleTypes, setRoleTypes, role)}
                        className={`px-2.5 py-1.5 text-xs rounded-md border transition-colors cursor-pointer ${
                          active
                            ? 'bg-zinc-950 text-white border-zinc-950 font-medium'
                            : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50'
                        }`}
                      >
                        {role}
                      </button>
                    );
                  })}
                  {roleTypes
                    .filter((r) => !ROLE_TYPE_SUGGESTIONS.includes(r))
                    .map((custom) => (
                      <button
                        key={custom}
                        type="button"
                        onClick={() => toggleItem(roleTypes, setRoleTypes, custom)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md bg-blue-600 text-white border border-blue-600 font-medium cursor-pointer"
                      >
                        <span>{custom}</span>
                        <X className="w-3 h-3" />
                      </button>
                    ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customRoleInput}
                    onChange={(e) => setCustomRoleInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTag(customRoleInput, roleTypes, setRoleTypes, () => setCustomRoleInput(''), 20);
                      }
                    }}
                    placeholder="Add custom title (e.g., AI Product Manager, GTM Strategy)..."
                    className="flex-1 h-9 px-3 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      addTag(customRoleInput, roleTypes, setRoleTypes, () => setCustomRoleInput(''), 20)
                    }
                    className="px-3 h-9 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md cursor-pointer"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Employment Type & Work Mode */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-zinc-900">
                    Employment Type
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {EMPLOYMENT_TYPE_OPTIONS.map((opt) => {
                      const active = employmentTypes.includes(opt);
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => toggleItem(employmentTypes, setEmploymentTypes, opt)}
                          className={`px-3 py-1.5 text-xs rounded-md border transition-colors cursor-pointer ${
                            active
                              ? 'bg-zinc-950 text-white border-zinc-950 font-medium'
                              : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50'
                          }`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-zinc-900">
                    Work Mode
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {WORK_MODE_OPTIONS.map((mode) => {
                      const active = workModes.includes(mode);
                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => toggleItem(workModes, setWorkModes, mode)}
                          className={`px-3 py-1.5 text-xs rounded-md border transition-colors cursor-pointer ${
                            active
                              ? 'bg-zinc-950 text-white border-zinc-950 font-medium'
                              : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50'
                          }`}
                        >
                          {mode}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Locations */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-zinc-900">
                  Preferred Locations
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={locationInput}
                    onChange={(e) => setLocationInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTag(locationInput, locations, setLocations, () => setLocationInput(''), 20);
                      }
                    }}
                    placeholder="Add cities or regions (e.g., Chicago IL, New York NY, London UK)..."
                    className="flex-1 h-9 px-3 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      addTag(locationInput, locations, setLocations, () => setLocationInput(''), 20)
                    }
                    className="px-3 h-9 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md cursor-pointer"
                  >
                    Add
                  </button>
                </div>
                {locations.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-700 pt-1">
                    {locations.map((loc) => (
                      <span key={loc} className="inline-flex items-center gap-1">
                        <span>{loc}</span>
                        <button
                          type="button"
                          onClick={() => setLocations((prev) => prev.filter((x) => x !== loc))}
                          aria-label={`Remove ${loc}`}
                          className="text-zinc-400 hover:text-zinc-900 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Keywords */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-zinc-900">
                  Keywords, Skills &amp; Industry Focus
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTag(keywordInput, keywords, setKeywords, () => setKeywordInput(''), 30);
                      }
                    }}
                    placeholder="Comma-separated (e.g., AI/ML, B2B SaaS, FinTech, $180k+, Series B-D)..."
                    className="flex-1 h-9 px-3 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      addTag(keywordInput, keywords, setKeywords, () => setKeywordInput(''), 30)
                    }
                    className="px-3 h-9 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md cursor-pointer"
                  >
                    Add
                  </button>
                </div>
                {keywords.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-700 pt-1">
                    {keywords.map((kw) => (
                      <span key={kw} className="inline-flex items-center gap-1 font-mono text-[11.5px]">
                        <span>{kw}</span>
                        <button
                          type="button"
                          onClick={() => setKeywords((prev) => prev.filter((x) => x !== kw))}
                          aria-label={`Remove ${kw}`}
                          className="text-zinc-400 hover:text-zinc-900 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-md text-xs text-zinc-600 leading-relaxed">
                <span className="font-semibold text-zinc-800">Agent Prompt Preview: </span>
                {compiledPromptPreview}
              </div>
            </div>
          )}

          {/* STEP 3: Role-Specific Resumes & Extended Career Context */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-zinc-950">
                  Upload role resumes &amp; share your full experience
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">
                  Optional — you can skip this for now and upload or edit anytime under <strong className="font-medium text-zinc-700">Resumes &amp; Context</strong> in the left sidebar. Please upload resumes as <span className="font-mono text-zinc-800">.docx</span> files (PDFs take noticeably longer to process).
                </p>
              </div>

              {/* Role-Type Base Resume Uploader */}
              <div className="border border-zinc-200 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                    <span className="text-sm font-semibold text-zinc-950">
                      Base Resumes (1 per Role Type · .docx Recommended)
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-zinc-400">
                    {initialResumes.length} uploaded
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    aria-label="Resume role track"
                    value={resumeUploadTrack}
                    onChange={(e) => setResumeUploadTrack(e.target.value)}
                    className="sm:w-60 h-9 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900"
                  >
                    {resumeTrackOptions.map((track) => (
                      <option key={track} value={track}>
                        {track}
                      </option>
                    ))}
                  </select>

                  <label className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-md cursor-pointer whitespace-nowrap">
                    <Upload className="w-3.5 h-3.5" />
                    <span>
                      {isParsingResume
                        ? 'Parsing resume...'
                        : 'Upload .docx Resume'}
                    </span>
                    <input
                      type="file"
                      accept=".docx,.txt,.md,.pdf"
                      disabled={isParsingResume}
                      onChange={(e) => void handleIntakeResumeFile(e)}
                      className="sr-only"
                    />
                  </label>
                </div>
                <p className="text-[11px] text-zinc-500">
                  Upload a <span className="font-mono text-zinc-700">.docx</span> file for the fastest upload — PDF parsing can take much longer.
                </p>

                {resumeUploadError && (
                  <div className="p-2.5 bg-red-50 border border-red-200 rounded-md flex items-start gap-2 text-xs text-red-700">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{resumeUploadError}</span>
                  </div>
                )}

                {initialResumes.length > 0 && (
                  <div className="divide-y divide-zinc-100 border border-zinc-200 rounded-md bg-zinc-50/50">
                    {initialResumes.map((res) => (
                      <div
                        key={res.id}
                        className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <span className="font-semibold text-zinc-900">
                            {res.roleType}
                          </span>
                          <span className="mx-1.5 text-zinc-300">·</span>
                          <span className="font-mono text-zinc-600 truncate">
                            {res.fileName}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => onDeleteResume(res.id)}
                          aria-label={`Remove ${res.roleType} resume`}
                          className="p-1 text-zinc-400 hover:text-red-600 cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Extended Career Experience (including off-resume roles & projects) */}
              <div className="border border-zinc-200 rounded-lg p-4 space-y-3">
                <div className="space-y-0.5">
                  <div className="text-sm font-semibold text-zinc-950">
                    All Roles &amp; Off-Resume Experience Details
                  </div>
                  <p className="text-xs text-zinc-500">
                    Add earlier jobs, internships, side projects, or extra wins that didn&apos;t fit on your 1-page resume so Meridian can pull them in when relevant.
                  </p>
                </div>

                <div className="p-3 bg-zinc-50/70 border border-zinc-200 rounded-md space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={expTitle}
                      onChange={(e) => setExpTitle(e.target.value)}
                      placeholder="Role / Project (e.g., Pricing Strategy Lead)"
                      className="h-8 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400"
                    />
                    <input
                      type="text"
                      value={expOrg}
                      onChange={(e) => setExpOrg(e.target.value)}
                      placeholder="Company / Org"
                      className="h-8 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400"
                    />
                    <input
                      type="text"
                      value={expDates}
                      onChange={(e) => setExpDates(e.target.value)}
                      placeholder="Dates (e.g., 2021–2023)"
                      className="h-8 px-2.5 text-xs font-mono bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400"
                    />
                  </div>
                  <textarea
                    rows={2}
                    value={expDetails}
                    onChange={(e) => setExpDetails(e.target.value)}
                    placeholder="Key accomplishments, metrics, tools, or leadership details not on your current resume..."
                    className="w-full p-2 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="inline-flex items-center gap-1.5 text-xs text-zinc-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={expOffResume}
                        onChange={(e) => setExpOffResume(e.target.checked)}
                        className="rounded border-zinc-300 text-blue-600"
                      />
                      <span>Not currently on my resume</span>
                    </label>
                    <button
                      type="button"
                      onClick={handleAddIntakeExperience}
                      disabled={!expTitle.trim() && !expDetails.trim()}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-300 rounded-md cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Role</span>
                    </button>
                  </div>
                </div>

                {careerExperiences.length > 0 && (
                  <div className="divide-y divide-zinc-100 border border-zinc-200 rounded-md">
                    {careerExperiences.map((exp) => (
                      <div
                        key={exp.id}
                        className="p-2.5 flex items-start justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="font-medium text-zinc-900">
                            {exp.title}{' '}
                            <span className="font-normal text-zinc-500">
                              @ {exp.organization}
                              {exp.dates ? ` (${exp.dates})` : ''}
                            </span>
                            {!exp.onResume && (
                              <span className="ml-1.5 text-[11px] font-medium text-blue-700">
                                · Off-resume
                              </span>
                            )}
                          </div>
                          <p className="text-zinc-600 line-clamp-2">{exp.details}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setCareerExperiences((prev) =>
                              prev.filter((item) => item.id !== exp.id)
                            )
                          }
                          aria-label={`Remove ${exp.title}`}
                          className="p-1 text-zinc-400 hover:text-red-600 cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-1">
                  <label
                    htmlFor="intake-career-notes"
                    className="block text-xs font-medium text-zinc-800"
                  >
                    Other projects, skills, or achievements not listed on your resume (optional)
                  </label>
                  <textarea
                    id="intake-career-notes"
                    rows={3}
                    value={careerContextNotes}
                    onChange={(e) => setCareerContextNotes(e.target.value)}
                    placeholder="Brain dump anything else you've built, launched, analyzed, or led — e.g., cross-functional launches, SQL/Python projects, consulting cases, speaking, or domain expertise..."
                    className="w-full p-2.5 text-xs leading-relaxed bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Channels & Permissions (Gmail dynamic senders, Slack, WhatsApp, ATS Boards, Cadence) */}
          {step === 4 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-zinc-950">
                  Connect your job alert channels
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Choose which email senders, Slack channels, WhatsApp groups, and career boards Meridian should scan. You can add or remove senders anytime in Sources.
                </p>
              </div>

              {/* 1. Gmail Job Alert Senders */}
              <div className="border border-zinc-200 rounded-lg p-4 space-y-3.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Mail className="w-4 h-4 text-blue-600 shrink-0" />
                      <span className="text-sm font-semibold text-zinc-950">
                        Gmail Job Alerts
                      </span>
                      <span className="text-[11px] font-medium text-blue-700">
                        Recommended
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500">
                      Use the Google account where you receive job alert emails. Read-only access.
                    </p>
                  </div>

                  {gmailConnected ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 shrink-0">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Connected ({userEmail})</span>
                    </span>
                  ) : (
                    <GoogleSignInButton
                      onClick={() => void onConnectGmail()}
                      disabled={isAuthLoading}
                      label="Connect Gmail"
                    />
                  )}
                </div>

                {gmailError && (
                  <div className="p-2.5 bg-red-50 border border-red-200 rounded-md flex items-start gap-2 text-xs text-red-700">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{gmailError}</span>
                  </div>
                )}

                {/* Dynamic sender addresses intake */}
                <div className="pt-3 border-t border-zinc-100 space-y-2.5">
                  <div className="text-xs font-medium text-zinc-800">
                    Which email addresses or domains send you job updates?
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {GMAIL_SENDER_PRESETS.map((preset) => {
                      const active = gmailSenders.includes(preset.sender);
                      return (
                        <button
                          key={preset.sender}
                          type="button"
                          title={preset.description}
                          onClick={() =>
                            toggleItem(gmailSenders, setGmailSenders, preset.sender)
                          }
                          className={`px-2.5 py-1 text-xs rounded-md border transition-colors cursor-pointer ${
                            active
                              ? 'bg-zinc-900 text-white border-zinc-900 font-medium'
                              : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={senderInput}
                      onChange={(e) => setSenderInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addTag(
                            senderInput,
                            gmailSenders,
                            setGmailSenders,
                            () => setSenderInput(''),
                            30,
                            normalizeSenderInput
                          );
                        }
                      }}
                      placeholder="Add any sender email or domain (e.g., careers@school.edu, newsletter@jobs.co)..."
                      className="flex-1 h-8 px-2.5 text-xs font-mono bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        addTag(
                          senderInput,
                          gmailSenders,
                          setGmailSenders,
                          () => setSenderInput(''),
                          30,
                          normalizeSenderInput
                        )
                      }
                      className="inline-flex items-center gap-1 px-2.5 h-8 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add</span>
                    </button>
                  </div>

                  {gmailSenders.length > 0 && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] font-mono text-zinc-600">
                      {gmailSenders.map((sender) => (
                        <span key={sender} className="inline-flex items-center gap-1">
                          <span>{sender}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setGmailSenders((prev) => prev.filter((x) => x !== sender))
                            }
                            aria-label={`Remove ${sender}`}
                            className="text-zinc-400 hover:text-red-600 cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="text-[11px] font-mono text-zinc-400 truncate">
                    Filter: {compiledGmailPreview}
                  </div>
                </div>
              </div>

              {/* 2. Slack Channels */}
              <div className="border border-zinc-200 rounded-lg p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Hash className="w-4 h-4 text-zinc-700 shrink-0" />
                      <span className="text-sm font-semibold text-zinc-950">
                        Slack Job Channels
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500">
                      Scan community, alumni, or referral Slack channels for roles and direct hiring posts.
                    </p>
                  </div>

                  {slackConnected ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 shrink-0">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Connected ({slackTeamName || 'Slack'})</span>
                    </span>
                  ) : (
                    <div className="flex items-center gap-2 shrink-0">
                      {slackConfigured && (
                        <button
                          type="button"
                          onClick={() => {
                            setSlackConnectAttempted(true);
                            onConnectSlack();
                          }}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-md whitespace-nowrap cursor-pointer"
                        >
                          Connect Slack
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowSlackDetails((v) => !v)}
                        className="px-3 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:bg-zinc-50 rounded-md whitespace-nowrap cursor-pointer"
                      >
                        {showSlackDetails ? 'Hide Steps' : 'How to Set Up Slack'}
                      </button>
                    </div>
                  )}
                </div>

                {slackConnectAttempted && slackError && (
                  <div className="p-2.5 bg-red-50 border border-red-200 rounded-md flex items-start gap-2 text-xs text-red-700">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{slackError}</span>
                  </div>
                )}

                {showSlackDetails && !slackConnected && (
                  <div className="p-3.5 bg-zinc-50 border border-zinc-200 rounded-md text-[11.5px] text-zinc-600 space-y-2">
                    <div className="font-semibold text-zinc-900">
                      Step-by-step: How to connect Slack
                    </div>
                    <ol className="list-decimal pl-4 space-y-1.5 leading-relaxed">
                      <li>
                        Visit{' '}
                        <a
                          href="https://api.slack.com/apps"
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:underline font-medium"
                        >
                          api.slack.com/apps
                        </a>{' '}
                        and click <strong>Create New App</strong> → <strong>From scratch</strong>, then pick your workspace.
                      </li>
                      <li>
                        Open <strong>OAuth &amp; Permissions</strong> in the left sidebar and add this Redirect URL:
                        <div className="mt-1 flex items-center gap-1.5">
                          <div className="flex-1 font-mono text-[11px] bg-white border border-zinc-200 rounded px-2 py-1 text-zinc-800 break-all select-all">
                            {slackRedirectUri || `${window.location.origin}/api/slack/callback`}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const target =
                                slackRedirectUri || `${window.location.origin}/api/slack/callback`;
                              void navigator.clipboard?.writeText(target);
                              setCopiedSlackUrl(true);
                              window.setTimeout(() => setCopiedSlackUrl(false), 1800);
                            }}
                            title="Copy Redirect URL"
                            className="p-1.5 bg-white border border-zinc-200 hover:bg-zinc-100 rounded text-zinc-600 cursor-pointer shrink-0"
                          >
                            {copiedSlackUrl ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </li>
                      <li>
                        Scroll to <strong>User Token Scopes</strong> and add{' '}
                        <code className="font-mono text-zinc-800">channels:read</code>,{' '}
                        <code className="font-mono text-zinc-800">channels:history</code>,{' '}
                        <code className="font-mono text-zinc-800">groups:read</code>, and{' '}
                        <code className="font-mono text-zinc-800">groups:history</code>.
                      </li>
                      <li>
                        Copy your <strong>Client ID</strong> and <strong>Client Secret</strong> from <strong>Basic Information</strong> into your app environment variables (<code className="font-mono text-zinc-800">SLACK_CLIENT_ID</code> and <code className="font-mono text-zinc-800">SLACK_CLIENT_SECRET</code>).
                        {slackHasClientId && slackHasClientSecret && (
                          <span className="ml-1 text-emerald-700 font-medium">
                            (Already configured!)
                          </span>
                        )}
                      </li>
                      <li>
                        You can finish this anytime later — just open <strong>Sources</strong> in the left sidebar and click <strong>Connect Slack</strong>.
                      </li>
                    </ol>
                  </div>
                )}

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={slackChannelInput}
                    onChange={(e) => setSlackChannelInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTag(
                          slackChannelInput,
                          slackChannels,
                          setSlackChannels,
                          () => setSlackChannelInput(''),
                          20,
                          (v) => v.trim().replace(/^#/, '').toLowerCase()
                        );
                      }
                    }}
                    placeholder="Add Slack channel names (e.g., jobs, referrals, alumni-hiring)..."
                    className="flex-1 h-8 px-2.5 text-xs font-mono bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      addTag(
                        slackChannelInput,
                        slackChannels,
                        setSlackChannels,
                        () => setSlackChannelInput(''),
                        20,
                        (v) => v.trim().replace(/^#/, '').toLowerCase()
                      )
                    }
                    className="px-2.5 h-8 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md cursor-pointer"
                  >
                    Add
                  </button>
                </div>

                {slackChannels.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] font-mono text-zinc-600">
                    {slackChannels.map((ch) => (
                      <span key={ch} className="inline-flex items-center gap-1">
                        <span>#{ch}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setSlackChannels((prev) => prev.filter((x) => x !== ch))
                          }
                          aria-label={`Remove #${ch}`}
                          className="text-zinc-400 hover:text-red-600 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* 3. WhatsApp Job Groups */}
              <div className="border border-zinc-200 rounded-lg p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <MessageCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="text-sm font-semibold text-zinc-950">
                        WhatsApp Recruiting Groups
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500">
                      Upload an exported WhatsApp group chat (.txt) now or configure live WhatsApp webhook forwarding later in Sources.
                    </p>
                  </div>

                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-800 bg-white border border-zinc-300 hover:bg-zinc-50 rounded-md whitespace-nowrap cursor-pointer shrink-0">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{waScanning ? 'Scanning chat...' : 'Upload .txt Export'}</span>
                    <input
                      type="file"
                      accept=".txt"
                      disabled={waScanning}
                      onChange={handleWhatsAppFile}
                      className="sr-only"
                    />
                  </label>
                </div>

                {waImportedCount > 0 && (
                  <div className="text-xs text-emerald-700 font-medium">
                    Extracted {waImportedCount} {waImportedCount === 1 ? 'role' : 'roles'} from your WhatsApp chat export.
                  </div>
                )}

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={whatsappGroupInput}
                    onChange={(e) => setWhatsappGroupInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTag(
                          whatsappGroupInput,
                          whatsappGroups,
                          setWhatsappGroups,
                          () => setWhatsappGroupInput(''),
                          20
                        );
                      }
                    }}
                    placeholder="Track WhatsApp group name (e.g., MBA Tech Recruiting, Alumni Jobs)..."
                    className="flex-1 h-8 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      addTag(
                        whatsappGroupInput,
                        whatsappGroups,
                        setWhatsappGroups,
                        () => setWhatsappGroupInput(''),
                        20
                      )
                    }
                    className="px-2.5 h-8 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md cursor-pointer"
                  >
                    Add
                  </button>
                </div>

                {whatsappGroups.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600">
                    {whatsappGroups.map((g) => (
                      <span key={g} className="inline-flex items-center gap-1">
                        <span>{g}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setWhatsappGroups((prev) => prev.filter((x) => x !== g))
                          }
                          aria-label={`Remove ${g}`}
                          className="text-zinc-400 hover:text-red-600 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* 4. Live ATS Career Boards */}
              <div className="border border-zinc-200 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-zinc-700 shrink-0" />
                  <span className="text-sm font-semibold text-zinc-950">
                    Company Career Boards (ATS Feeds)
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {allBoardOptions.map((board) => {
                    const checked = selectedUrls.includes(board.url);
                    return (
                      <label
                        key={board.url}
                        className="flex items-center justify-between gap-2 px-3 py-2 border border-zinc-200 rounded-md text-xs hover:bg-zinc-50 cursor-pointer"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSelectedUrls((prev) =>
                                prev.includes(board.url)
                                  ? prev.filter((u) => u !== board.url)
                                  : [...prev, board.url]
                              )
                            }
                            className="rounded border-zinc-300 text-blue-600 focus:ring-blue-600"
                          />
                          <span className="font-medium text-zinc-900 truncate">
                            {board.name}
                          </span>
                        </span>
                        <span className="text-[11px] text-zinc-400 shrink-0">
                          {board.atsType}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <input
                  type="url"
                  value={customBoardUrl}
                  onChange={(e) => setCustomBoardUrl(e.target.value)}
                  placeholder="Optional: paste another company careers URL (Greenhouse, Lever, Ashby, or any page)..."
                  className="w-full h-8 px-2.5 text-xs font-mono bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400"
                />
              </div>

              {/* 5. Dashboard Update Frequency */}
              <div className="border border-zinc-200 rounded-lg p-4 space-y-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-blue-600 shrink-0" />
                    <span className="text-sm font-semibold text-zinc-950">
                      How often should Meridian update your dashboard?
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500">
                    Controls automatic background refreshes for your career boards and live pipeline alerts. You can change this anytime in Sources.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {DASHBOARD_CADENCE_OPTIONS.map((opt) => {
                    const active = cadenceChoiceId === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setCadenceChoiceId(opt.id)}
                        className={`text-left p-3 rounded-md border transition-colors cursor-pointer ${
                          active
                            ? 'bg-zinc-950 text-white border-zinc-950'
                            : 'bg-white text-zinc-800 border-zinc-200 hover:bg-zinc-50'
                        }`}
                      >
                        <div className="text-xs font-semibold">{opt.label}</div>
                        <div
                          className={`mt-0.5 text-[11px] leading-snug ${
                            active ? 'text-zinc-300' : 'text-zinc-500'
                          }`}
                        >
                          {opt.description}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: Upload Existing Roles & Launch Pull */}
          {step === 5 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-zinc-950">
                  Import existing roles &amp; launch your first pull
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Already tracking roles in a spreadsheet, Notion, or Airtable? Upload them now and Gemini will map your columns into Meridian&apos;s database.
                </p>
              </div>

              <div className="p-5 border border-zinc-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-zinc-950 flex items-center gap-2">
                    <Database className="w-4 h-4 text-blue-600" />
                    <span>Upload &amp; Map Existing Roles (CSV / JSON)</span>
                  </div>
                  <p className="text-xs text-zinc-500 leading-relaxed max-w-md">
                    Maps your spreadsheet headers into Meridian&apos;s database. Any rows with a company but blank role title can automatically be added to your Target Companies Watchlist.
                  </p>
                  {importedCountInSession > 0 && (
                    <div className="text-xs font-medium text-emerald-700 pt-1">
                      Imported {importedCountInSession}{' '}
                      {importedCountInSession === 1 ? 'role' : 'roles'} in this session.
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onOpenImportModal}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-zinc-900 bg-white border border-zinc-300 hover:bg-zinc-50 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload &amp; Map Roles</span>
                </button>
              </div>

              <div className="p-5 border border-zinc-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-zinc-950 flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-blue-600" />
                    <span>Upload Target Companies Watchlist (CSV)</span>
                  </div>
                  <p className="text-xs text-zinc-500 leading-relaxed max-w-md">
                    Have dream companies where your ideal role hasn&apos;t opened yet? Upload a CSV of company names so Meridian watches them for your target roles on every pull.
                  </p>
                  {targetCompaniesCount > 0 && (
                    <div className="text-xs font-medium text-emerald-700 pt-1">
                      Watching {targetCompaniesCount} target{' '}
                      {targetCompaniesCount === 1 ? 'company' : 'companies'}.
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onOpenTargetCompaniesImport}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-zinc-900 bg-white border border-zinc-300 hover:bg-zinc-50 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload Companies CSV</span>
                </button>
              </div>

              {/* Summary of Intake */}
              <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-lg space-y-2 text-xs">
                <div className="font-semibold text-zinc-900">Your Intake Summary</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-zinc-600">
                  <div>
                    <span className="text-zinc-400">Roles: </span>
                    <span className="text-zinc-900 font-medium">
                      {roleTypes.join(', ') || 'Any'}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-400">Employment: </span>
                    <span className="text-zinc-900 font-medium">
                      {employmentTypes.join(', ') || 'Full-time'}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-400">Locations: </span>
                    <span className="text-zinc-900 font-medium">
                      {[...workModes, ...locations].join(', ') || 'Flexible'}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-400">Resumes &amp; Context: </span>
                    <span className="text-zinc-900 font-medium">
                      {initialResumes.length} resume{initialResumes.length === 1 ? '' : 's'}
                      {careerExperiences.length > 0
                        ? ` · ${careerExperiences.length} extended role${careerExperiences.length === 1 ? '' : 's'}`
                        : ''}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-400">Channels &amp; Watchlist: </span>
                    <span className="text-zinc-900 font-medium">
                      {selectedUrls.length} ATS boards
                      {targetCompaniesCount > 0 ? ` · ${targetCompaniesCount} target companies` : ''}
                      {gmailConnected ? ` · Gmail (${gmailSenders.length} senders)` : ''}
                      {slackConnected ? ` · Slack` : ''}
                      {whatsappGroups.length > 0 ? ` · WhatsApp` : ''}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-400">Dashboard Update Cadence: </span>
                    <span className="text-zinc-900 font-medium">
                      {selectedCadence.label}
                    </span>
                  </div>
                </div>
              </div>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={triggerInitialPull}
                  onChange={(e) => setTriggerInitialPull(e.target.checked)}
                  className="mt-0.5 rounded border-zinc-300 text-blue-600 focus:ring-blue-600"
                />
                <span className="text-xs text-zinc-600 leading-relaxed">
                  <strong className="font-medium text-zinc-900">
                    Pull matching roles immediately after saving
                  </strong>{' '}
                  — runs your selected career boards{gmailConnected ? ', Gmail alerts' : ''}
                  {slackConnected ? ', and Slack channels' : ''} and scores new matches against your intake criteria.
                </span>
              </label>
            </div>
          )}
        </div>

        {/* Footer Controls */}
        <div className="px-6 py-3.5 border-t border-zinc-200 bg-zinc-50/70 flex items-center justify-between gap-3">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4 | 5) : s))}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-600 hover:text-zinc-950 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2.5">
            {step < 5 ? (
              <button
                type="button"
                onClick={() => setStep((s) => (s < 5 ? ((s + 1) as 1 | 2 | 3 | 4 | 5) : s))}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors cursor-pointer"
              >
                <span>Next</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                disabled={isSaving}
                onClick={() => void handleFinish()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-md transition-colors cursor-pointer disabled:cursor-wait"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSaving ? 'animate-spin' : ''}`} />
                <span>
                  {isSaving
                    ? 'Saving Profile...'
                    : triggerInitialPull
                    ? 'Save Profile & Pull Roles'
                    : 'Save Profile'}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
