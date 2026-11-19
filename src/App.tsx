import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { CalendarView } from './components/CalendarView';
import { ChatDrawer } from './components/ChatDrawer';
import { CriteriaView } from './components/CriteriaView';
import { ImportRolesModal } from './components/ImportRolesModal';
import { IntakeModal } from './components/IntakeModal';
import { JobDetailDrawer } from './components/JobDetailDrawer';
import { KanbanView } from './components/KanbanView';
import { ResumesView } from './components/ResumesView';
import { SchemaView } from './components/SchemaView';
import { Sidebar } from './components/Sidebar';
import { SourcesView } from './components/SourcesView';
import { TableView } from './components/TableView';
import { TopBar } from './components/TopBar';
import {
  detectAtsType,
  INITIAL_EVENTS,
  INITIAL_FEEDBACK,
  INITIAL_JOBS,
  INITIAL_RULES,
  INITIAL_SEARCH_PROMPT,
  INITIAL_SOURCES,
  VERIFIED_LIVE_PRESETS,
} from './data/initialData';
import {
  createEventInCloud,
  createFeedbackInCloud,
  createImportBatchInCloud,
  createJobsInCloud,
  createRuleInCloud,
  createSourceInCloud,
  createTargetCompaniesBatchInCloud,
  deleteEventInCloud,
  deleteFeedbackInCloud,
  deleteJobInCloud,
  deleteJobsBatchInCloud,
  deleteRoleResumeInCloud,
  deleteRuleInCloud,
  deleteSourceInCloud,
  deleteTargetCompanyInCloud,
  loadUserWorkspace,
  saveUserProfileToCloud,
  updateCareerContextInCloud,
  updateJobFullDescriptionInCloud,
  updateJobNetworkingContactsInCloud,
  updateJobNotesInCloud,
  updateJobRescoreBatchInCloud,
  updateJobsEnrichmentBatchInCloud,
  updateJobTriageInCloud,
  updateRuleInCloud,
  updateSourceConfigInCloud,
  updateSourceMetricsInCloud,
  updateTargetCompanyInCloud,
  updateTargetCompanyMetricsInCloud,
  updateWorkspaceSettingsInCloud,
  upsertRoleResumeInCloud,
} from './lib/firestoreStore';
import type { ParsedTargetCompanyRow } from './lib/csvParser';
import {
  clearGmailAccessToken,
  getGmailAccessToken,
  initGoogleAuth,
  signInWithGoogleAccount,
  signInWithGoogleGmail,
  signOutGoogle,
} from './lib/googleAuth';
import {
  buildGmailQueryFromSenders,
  compileIntakeToSearchPrompt,
  createDefaultIntakeProfile,
} from './lib/intakeHelpers';
import {
  AgentRunReport,
  AiRuleSuggestion,
  CareerExperienceItem,
  DislikeReason,
  FeedbackEntry,
  ImportBatchRecord,
  JobEnrichmentPatch,
  JobEvent,
  JobRecord,
  JobSource,
  LearnedRule,
  NetworkingContact,
  PipelineStage,
  PreferenceSynthesisResult,
  RoleResume,
  RuleSuggestion,
  ServerScheduleState,
  TailoredResumeDocument,
  TargetCompany,
  ToastNotification,
  UserIntakeProfile,
  WorkspaceView,
} from './types/job';
import type {
  ChatAction,
  ChatApiResponse,
  ChatMessage,
  WorkspaceChatContext,
} from './types/chat';

const STORAGE_KEY = 'meridian_w1_state_v1';
const CHAT_STORAGE_KEY = 'meridian_chat_history_v1';

const VALID_REASONS: DislikeReason[] = [
  'Wrong employment type',
  'Low pay',
  'Company fit',
  'Wrong role type',
  'Location',
];

const VALID_STAGES: PipelineStage[] = [
  'inbox',
  'saved',
  'applied',
  'interviewing',
  'offer',
  'archived',
];

function isUntitledJob(job: JobRecord): boolean {
  if (job.stage === 'archived') return false;
  const t = (job.title || '').trim().toLowerCase();
  const c = (job.company || '').trim().toLowerCase();
  return (
    (!t || t === 'untitled role' || t === 'untitled') &&
    Boolean(c) &&
    c !== 'unknown company'
  );
}

function getIncompleteJobsForEnrichment(jobList: JobRecord[]) {
  return jobList
    .filter((j) => {
      if (j.stage === 'archived') return false;
      const t = (j.title || '').trim().toLowerCase();
      const s = (j.salaryLabel || '').trim().toLowerCase();
      const loc = (j.location || '').trim().toLowerCase();
      const desc = (j.fullDescription || '').trim();
      const sum = (j.summary || '').trim();
      const missingTitle = !t || t === 'untitled role' || t === 'untitled';
      const missingSalary = !s || s === 'not listed' || s === 'unspecified' || s === 'n/a';
      const missingLocation = !loc || loc === 'unspecified' || loc === 'n/a';
      const missingDesc = desc.length < 180;
      const missingSummary = sum.length < 40;
      return missingTitle || missingSalary || missingLocation || missingDesc || missingSummary;
    })
    .slice(0, 15)
    .map((j) => ({
      id: j.id,
      title: j.title,
      company: j.company,
      salaryLabel: j.salaryLabel,
      location: j.location,
      locationType: j.locationType,
      employmentType: j.employmentType,
      jobUrl: j.jobUrl,
      summary: j.summary,
      fullDescription: j.fullDescription,
      skills: j.skills,
    }));
}

function loadChatHistory(): ChatMessage[] {
  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as ChatMessage[];
    }
  } catch {
    // Ignore parse errors
  }
  return [];
}

const REASON_TO_RULE: Record<DislikeReason, { rule: string; summary: string }> = {
  'Wrong employment type': {
    rule: 'Filter out mismatched employment types (e.g., internships, contract, or part-time roles)',
    summary:
      'You have repeatedly downvoted roles with the wrong employment type. Enforce strict employment-type filtering on future runs?',
  },
  'Low pay': {
    rule: 'Require listed compensation range to meet your target floor',
    summary:
      'Multiple hidden roles fell below your compensation expectations. Add a compensation filter to future agent runs?',
  },
  'Company fit': {
    rule: 'Prioritize target-stage companies and industries aligned with your strong matches',
    summary:
      'You have filtered out roles based on company fit. Narrow company stage & domain scoring weights?',
  },
  'Wrong role type': {
    rule: 'Exclude off-track role functions and keep title matching tightly aligned to your target role types',
    summary:
      'Several recent downvotes cited wrong role types. Tighten title and function matching during discovery?',
  },
  Location: {
    rule: 'Strictly match your preferred cities and work mode (Remote / Hybrid / Onsite)',
    summary:
      'You have repeatedly hidden roles due to location. Enforce strict location & work-mode filtering?',
  },
};

interface PersistedState {
  jobs: JobRecord[];
  sources: JobSource[];
  targetCompanies: TargetCompany[];
  events: JobEvent[];
  feedbackHistory: FeedbackEntry[];
  searchPrompt: string;
  rules: LearnedRule[];
  dismissedReasons: DislikeReason[];
  lastRunLabel: string;
  runHistory: AgentRunReport[];
  importHistory: ImportBatchRecord[];
  resumes: RoleResume[];
  autoScheduleEnabled: boolean;
  autoScheduleMinutes: number;
  aiSynthesis: PreferenceSynthesisResult | null;
  intakeProfile: UserIntakeProfile;
  gmailQueryOverride: string;
  gmailLastScanLabel: string | null;
}

const LEGACY_MOCK_SOURCE_IDS = new Set([
  'src-veridian',
  'src-kestrel',
  'src-loomis',
  'src-cinder',
  'src-bramble',
]);

function backfillSeedJobDetails(jobs: JobRecord[]): JobRecord[] {
  const seedMap = new Map(INITIAL_JOBS.map((j) => [j.id, j]));
  return jobs.map((job) => {
    const seed = seedMap.get(job.id);
    if (!seed) return job;
    const seedContacts = seed.networkingContacts ?? [];
    const seedContactMap = new Map(seedContacts.map((c) => [c.id, c]));
    return {
      ...job,
      fullDescription:
        job.fullDescription && job.fullDescription.trim().length > 0
          ? job.fullDescription
          : seed.fullDescription,
      networkingContacts:
        Array.isArray(job.networkingContacts) && job.networkingContacts.length > 0
          ? job.networkingContacts.map((c) => {
              const seedMatch = seedContactMap.get(c.id);
              return !c.sentiment && seedMatch?.sentiment
                ? { ...c, sentiment: seedMatch.sentiment }
                : c;
            })
          : seed.networkingContacts,
    };
  });
}

function loadInitialState(): PersistedState {
  const defaultIntake = createDefaultIntakeProfile();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      if (Array.isArray(parsed.jobs) && Array.isArray(parsed.sources)) {
        const onlyLegacySources =
          parsed.sources.length > 0 &&
          parsed.sources.every((s) => LEGACY_MOCK_SOURCE_IDS.has(s.id));

        return {
          jobs: backfillSeedJobDetails(parsed.jobs),
          sources: onlyLegacySources ? INITIAL_SOURCES : parsed.sources,
          targetCompanies: Array.isArray(parsed.targetCompanies)
            ? parsed.targetCompanies
            : [],
          events: Array.isArray(parsed.events) ? parsed.events : INITIAL_EVENTS,
          feedbackHistory: Array.isArray(parsed.feedbackHistory)
            ? parsed.feedbackHistory
            : INITIAL_FEEDBACK,
          searchPrompt: parsed.searchPrompt ?? INITIAL_SEARCH_PROMPT,
          rules: Array.isArray(parsed.rules) ? parsed.rules : INITIAL_RULES,
          dismissedReasons: Array.isArray(parsed.dismissedReasons)
            ? parsed.dismissedReasons.filter((r): r is DislikeReason =>
                VALID_REASONS.includes(r)
              )
            : [],
          lastRunLabel: parsed.lastRunLabel ?? 'Not run yet',
          runHistory: Array.isArray(parsed.runHistory) ? parsed.runHistory : [],
          importHistory: Array.isArray(parsed.importHistory)
            ? parsed.importHistory
            : [],
          resumes: Array.isArray(parsed.resumes) ? parsed.resumes : [],
          autoScheduleEnabled: Boolean(parsed.autoScheduleEnabled),
          autoScheduleMinutes:
            typeof parsed.autoScheduleMinutes === 'number'
              ? parsed.autoScheduleMinutes
              : 240,
          aiSynthesis: parsed.aiSynthesis ?? null,
          intakeProfile: parsed.intakeProfile
            ? {
                ...defaultIntake,
                ...parsed.intakeProfile,
                careerContextNotes: parsed.intakeProfile.careerContextNotes ?? '',
                careerExperiences: Array.isArray(parsed.intakeProfile.careerExperiences)
                  ? parsed.intakeProfile.careerExperiences
                  : [],
              }
            : defaultIntake,
          gmailQueryOverride: parsed.gmailQueryOverride ?? '',
          gmailLastScanLabel: parsed.gmailLastScanLabel ?? null,
        };
      }
    }
  } catch {
    // Ignore storage parse failures and fall back to seed data
  }

  return {
    jobs: INITIAL_JOBS,
    sources: INITIAL_SOURCES,
    targetCompanies: [],
    events: INITIAL_EVENTS,
    feedbackHistory: INITIAL_FEEDBACK,
    searchPrompt: INITIAL_SEARCH_PROMPT,
    rules: INITIAL_RULES,
    dismissedReasons: [],
    lastRunLabel: 'Ready',
    runHistory: [],
    importHistory: [],
    resumes: [],
    autoScheduleEnabled: false,
    autoScheduleMinutes: 240,
    aiSynthesis: null,
    intakeProfile: {
      ...defaultIntake,
      careerContextNotes: '',
      careerExperiences: [],
    },
    gmailQueryOverride: '',
    gmailLastScanLabel: null,
  };
}

export default function App() {
  const initial = useMemo(() => loadInitialState(), []);

  const [activeView, setActiveView] = useState<WorkspaceView>('table');
  const [tableTabKey, setTableTabKey] = useState(0);
  const [preferredTableTab, setPreferredTableTab] = useState<
    'new' | 'active' | 'all' | 'archived'
  >('active');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [jobs, setJobs] = useState<JobRecord[]>(initial.jobs);
  const [sources, setSources] = useState<JobSource[]>(initial.sources);
  const [targetCompanies, setTargetCompanies] = useState<TargetCompany[]>(
    initial.targetCompanies
  );
  const [events, setEvents] = useState<JobEvent[]>(initial.events);
  const [feedbackHistory, setFeedbackHistory] = useState<FeedbackEntry[]>(
    initial.feedbackHistory
  );
  const [searchPrompt, setSearchPrompt] = useState<string>(initial.searchPrompt);
  const [rules, setRules] = useState<LearnedRule[]>(initial.rules);
  const [dismissedReasons, setDismissedReasons] = useState<DislikeReason[]>(
    initial.dismissedReasons
  );
  const [lastRunLabel, setLastRunLabel] = useState<string>(initial.lastRunLabel);
  const [runHistory, setRunHistory] = useState<AgentRunReport[]>(initial.runHistory);
  const [importHistory, setImportHistory] = useState<ImportBatchRecord[]>(
    initial.importHistory
  );
  const [resumes, setResumes] = useState<RoleResume[]>(initial.resumes);
  const [tailoredByJobId, setTailoredByJobId] = useState<
    Record<
      string,
      {
        tailored: TailoredResumeDocument;
        docxBase64: string;
        fileName: string;
      }
    >
  >({});

  // Account + Intake profile + Modals
  const [intakeProfile, setIntakeProfile] = useState<UserIntakeProfile>(
    initial.intakeProfile
  );
  const [intakeOpen, setIntakeOpen] = useState<boolean>(
    !initial.intakeProfile.onboardingCompleted
  );
  const [intakeOpenCounter, setIntakeOpenCounter] = useState(0);
  const openIntakeModal = useCallback(() => {
    setIntakeOpenCounter((c) => c + 1);
    setIntakeOpen(true);
  }, []);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importModalMode, setImportModalMode] = useState<'roles' | 'companies'>('roles');
  const openImportModal = useCallback((mode: 'roles' | 'companies' = 'roles') => {
    setImportModalMode(mode);
    setImportModalOpen(true);
  }, []);
  const [importedCountInSession, setImportedCountInSession] = useState(0);

  // Firebase Auth account state
  const [authUid, setAuthUid] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userDisplayName, setUserDisplayName] = useState<string | null>(null);
  const cloudProfileExistsRef = useRef(false);
  const authUidRef = useRef<string | null>(null);

  // Server-authoritative schedule state
  const [autoScheduleEnabled, setAutoScheduleEnabled] = useState<boolean>(
    initial.autoScheduleEnabled
  );
  const [autoScheduleMinutes, setAutoScheduleMinutes] = useState<number>(
    initial.autoScheduleMinutes
  );
  const [nextScheduledRunAt, setNextScheduledRunAt] = useState<string | null>(null);

  // Stage 1 & Stage 2 feedback loop states
  const [aiSynthesis, setAiSynthesis] = useState<PreferenceSynthesisResult | null>(
    initial.aiSynthesis
  );
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [isRescoring, setIsRescoring] = useState(false);
  const votesSinceSynthesis = useRef(0);

  // Gmail OAuth state (token stays strictly in memory via googleAuth.ts)
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailError, setGmailError] = useState<string | null>(null);
  const [isGmailSigningIn, setIsGmailSigningIn] = useState(false);
  const [isGmailScanning, setIsGmailScanning] = useState(false);
  const [gmailQueryOverride, setGmailQueryOverride] = useState<string>(
    initial.gmailQueryOverride
  );
  const [gmailLastScanLabel, setGmailLastScanLabel] = useState<string | null>(
    initial.gmailLastScanLabel
  );

  // Slack 3P OAuth state (token stays strictly in memory in a ref)
  const slackTokenRef = useRef<string | null>(null);
  const activeSlackStateRef = useRef<string | null>(null);
  const handledSlackStatesRef = useRef<Set<string>>(new Set());
  const slackPollTimerRef = useRef<number | null>(null);
  const [slackConnected, setSlackConnected] = useState(false);
  const [slackTeamName, setSlackTeamName] = useState<string | null>(null);
  const [slackError, setSlackError] = useState<string | null>(null);
  const [slackAuthConfig, setSlackAuthConfig] = useState<{
    configured: boolean;
    hasClientId: boolean;
    hasClientSecret: boolean;
    url: string | null;
    state: string | null;
    redirectUri: string | null;
    devRedirectUri: string | null;
    sharedRedirectUri: string | null;
  }>({
    configured: false,
    hasClientId: false,
    hasClientSecret: false,
    url: null,
    state: null,
    redirectUri: null,
    devRedirectUri: null,
    sharedRedirectUri: null,
  });
  const [isSlackScanning, setIsSlackScanning] = useState(false);

  // WhatsApp scanning state
  const [isWhatsAppScanning, setIsWhatsAppScanning] = useState(false);

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [runningSourceId, setRunningSourceId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastNotification[]>([]);
  const toastCounter = useRef(0);

  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => loadChatHistory());
  const [isChatSending, setIsChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const pushToast = useCallback(
    (message: string, actionLabel?: string, onAction?: () => void) => {
      toastCounter.current += 1;
      const id = `toast-${toastCounter.current}`;
      setToasts((prev) => [...prev.slice(-2), { id, message, actionLabel, onAction }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 5500);
    },
    []
  );

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Helper: safely persist to Firestore only when user is authenticated & cloud profile exists
  const persistCloud = useCallback((fn: (uid: string) => Promise<void>) => {
    const uid = authUidRef.current;
    if (!uid || !cloudProfileExistsRef.current) return;
    void fn(uid).catch((err) => {
      console.error('Cloud sync failed:', err);
    });
  }, []);

  // Pre-fetch fresh Slack OAuth URL & state so window.open runs synchronously on click (prevents popup blocking)
  const refreshSlackAuthConfig = useCallback(async () => {
    try {
      const origin = encodeURIComponent(window.location.origin);
      const res = await fetch(`/api/slack/auth/url?origin=${origin}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        configured?: boolean;
        hasClientId?: boolean;
        hasClientSecret?: boolean;
        url?: string | null;
        state?: string | null;
        redirectUri?: string | null;
        devRedirectUri?: string | null;
        sharedRedirectUri?: string | null;
      };
      setSlackAuthConfig({
        configured: Boolean(data.configured),
        hasClientId: Boolean(data.hasClientId),
        hasClientSecret: Boolean(data.hasClientSecret),
        url: data.url ?? null,
        state: data.state ?? null,
        redirectUri: data.redirectUri ?? null,
        devRedirectUri: data.devRedirectUri ?? null,
        sharedRedirectUri: data.sharedRedirectUri ?? null,
      });
    } catch {
      // Non-blocking
    }
  }, []);

  useEffect(() => {
    void refreshSlackAuthConfig();
    return () => {
      if (slackPollTimerRef.current !== null) {
        window.clearInterval(slackPollTimerRef.current);
      }
    };
  }, [refreshSlackAuthConfig]);

  // Initialize Firebase Auth & load cloud workspace from Firestore on sign-in
  useEffect(() => {
    const unsubscribe = initGoogleAuth(({ user, gmailAccessToken }) => {
      if (user) {
        authUidRef.current = user.uid;
        setAuthUid(user.uid);
        setUserEmail(user.email);
        setUserDisplayName(user.displayName);
        setGmailConnected(Boolean(gmailAccessToken));

        void loadUserWorkspace(user.uid)
          .then((cloud) => {
            if (cloud.profileExists && cloud.profile) {
              cloudProfileExistsRef.current = true;
              setIntakeProfile(cloud.profile);
              if (cloud.searchPrompt) setSearchPrompt(cloud.searchPrompt);
              if (cloud.jobs.length > 0) setJobs(backfillSeedJobDetails(cloud.jobs));
              if (cloud.sources.length > 0) setSources(cloud.sources);
              if (cloud.targetCompanies.length > 0) {
                setTargetCompanies(cloud.targetCompanies);
              }
              if (cloud.rules.length > 0) setRules(cloud.rules);
              if (cloud.feedbackHistory.length > 0) {
                setFeedbackHistory(cloud.feedbackHistory);
              }
              if (cloud.events.length > 0) setEvents(cloud.events);
              if (cloud.imports.length > 0) setImportHistory(cloud.imports);
              if (cloud.resumes.length > 0) setResumes(cloud.resumes);
              setAutoScheduleEnabled(cloud.autoScheduleEnabled);
              setAutoScheduleMinutes(cloud.autoScheduleMinutes);
              if (cloud.profile.onboardingCompleted) {
                setIntakeOpen(false);
              }
            } else {
              cloudProfileExistsRef.current = false;
              setIntakeProfile((prev) => ({
                ...prev,
                uid: user.uid,
                email: user.email || prev.email,
                displayName: user.displayName || prev.displayName,
              }));
            }
          })
          .catch((err) => {
            console.error('Could not load cloud workspace:', err);
          });
      } else {
        authUidRef.current = null;
        cloudProfileExistsRef.current = false;
        setAuthUid(null);
        setUserEmail(null);
        setUserDisplayName(null);
        setGmailConnected(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // Persist chat history locally
  useEffect(() => {
    try {
      window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chatMessages));
    } catch {
      // Ignore quota errors
    }
  }, [chatMessages]);

  // Persist local workspace cache (never stores OAuth tokens)
  useEffect(() => {
    try {
      const payload: PersistedState = {
        jobs,
        sources,
        targetCompanies,
        events,
        feedbackHistory,
        searchPrompt,
        rules,
        dismissedReasons,
        lastRunLabel,
        runHistory,
        importHistory,
        resumes,
        autoScheduleEnabled,
        autoScheduleMinutes,
        aiSynthesis,
        intakeProfile,
        gmailQueryOverride,
        gmailLastScanLabel,
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore quota errors
    }
  }, [
    jobs,
    sources,
    targetCompanies,
    events,
    feedbackHistory,
    searchPrompt,
    rules,
    dismissedReasons,
    lastRunLabel,
    runHistory,
    importHistory,
    resumes,
    autoScheduleEnabled,
    autoScheduleMinutes,
    aiSynthesis,
    intakeProfile,
    gmailQueryOverride,
    gmailLastScanLabel,
  ]);

  // Idempotent application of completed agent / Gmail / Slack / WhatsApp runs
  const seenReportIdsRef = useRef<Set<string>>(
    new Set(initial.runHistory.map((r) => r.id))
  );

  const applyCompletedAgentRun = useCallback(
    (
      addedJobs: JobRecord[],
      report: AgentRunReport | undefined,
      trigger: 'manual' | 'scheduled' = 'manual',
      extras?: {
        enrichedJobs?: JobEnrichmentPatch[];
        checkedCompanyIds?: { id: string; foundCount: number }[];
      }
    ) => {
      if (report && seenReportIdsRef.current.has(report.id)) {
        return;
      }
      if (report) {
        seenReportIdsRef.current.add(report.id);
      }

      const enrichedPatches = Array.isArray(extras?.enrichedJobs)
        ? extras.enrichedJobs
        : [];
      const checkedCompanies = Array.isArray(extras?.checkedCompanyIds)
        ? extras.checkedCompanyIds
        : [];

      if (addedJobs.length > 0 || enrichedPatches.length > 0) {
        const patchMap = new Map(enrichedPatches.map((p) => [p.id, p]));
        setJobs((prev) => {
          const updatedPrev =
            patchMap.size > 0
              ? prev.map((j) => {
                  const p = patchMap.get(j.id);
                  if (!p) return j;
                  return {
                    ...j,
                    title: p.title ?? j.title,
                    salaryLabel: p.salaryLabel ?? j.salaryLabel,
                    salaryMin: p.salaryMin ?? j.salaryMin,
                    salaryMax: p.salaryMax ?? j.salaryMax,
                    location: p.location ?? j.location,
                    locationType: p.locationType ?? j.locationType,
                    employmentType: p.employmentType ?? j.employmentType,
                    skills: p.skills && p.skills.length > 0 ? p.skills : j.skills,
                    summary: p.summary ?? j.summary,
                    fullDescription: p.fullDescription ?? j.fullDescription,
                    jobUrl: p.jobUrl ?? j.jobUrl,
                  };
                })
              : prev;

          if (addedJobs.length > 0) {
            const existing = new Set(updatedPrev.map((j) => j.urlHash));
            const uniqueNew = addedJobs.filter((j) => !existing.has(j.urlHash));
            if (uniqueNew.length > 0) {
              persistCloud((uid) => createJobsInCloud(uid, uniqueNew));
              return [...uniqueNew, ...updatedPrev];
            }
          }
          return updatedPrev;
        });

        if (enrichedPatches.length > 0) {
          persistCloud((uid) =>
            updateJobsEnrichmentBatchInCloud(uid, enrichedPatches)
          );
        }
      }

      if (checkedCompanies.length > 0) {
        const checkedMap = new Map(checkedCompanies.map((c) => [c.id, c.foundCount]));
        const checkedLabel = report
          ? `Today, ${report.completedTime}`
          : 'Just now';
        setTargetCompanies((prev) =>
          prev.map((tc) => {
            const found = checkedMap.get(tc.id);
            if (found === undefined) return tc;
            const nextCount = (tc.lastFoundCount ?? 0) + found;
            persistCloud((uid) =>
              updateTargetCompanyMetricsInCloud(uid, tc.id, {
                lastCheckedAt: checkedLabel,
                lastFoundCount: nextCount,
              })
            );
            return {
              ...tc,
              lastCheckedAt: checkedLabel,
              lastFoundCount: nextCount,
            };
          })
        );
      }

      if (report) {
        setRunHistory((prev) => {
          if (prev.some((r) => r.id === report.id)) return prev;
          return [report, ...prev].slice(0, 12);
        });
        setLastRunLabel(`Today, ${report.completedTime}`);

        const resultBySource = new Map(
          report.sourceResults.map((r) => [r.sourceId, r])
        );
        setSources((prev) =>
          prev.map((s) => {
            const res = resultBySource.get(s.id);
            if (!res) return s;
            const updated: JobSource = {
              ...s,
              lastCheckedAt:
                res.status === 'ok'
                  ? `Today, ${report.completedTime}`
                  : 'Error (see run log)',
              totalFound: res.status === 'ok' ? res.rawFetched : s.totalFound,
              lastNewCount: res.newlyScored,
            };
            persistCloud((uid) =>
              updateSourceMetricsInCloud(uid, s.id, {
                lastCheckedAt: updated.lastCheckedAt,
                totalFound: updated.totalFound,
                lastNewCount: updated.lastNewCount,
              })
            );
            return updated;
          })
        );

        const failedCount = report.sourceResults.filter(
          (r) => r.status === 'error'
        ).length;
        const prefix = trigger === 'scheduled' ? 'Scheduled agent' : 'Agent';
        const enrichedCount = enrichedPatches.length;

        if (addedJobs.length > 0) {
          const enrichNote =
            enrichedCount > 0 ? `, enriched ${enrichedCount} incomplete` : '';
          pushToast(
            `${prefix} found ${addedJobs.length} new ${
              addedJobs.length === 1 ? 'role' : 'roles'
            }${enrichNote} (${report.totalFetched} scanned, ${report.totalSkipped} deduped)`,
            'Review New',
            () => {
              setPreferredTableTab('new');
              setTableTabKey((k) => k + 1);
              setActiveView('table');
            }
          );
        } else if (enrichedCount > 0) {
          pushToast(
            `${prefix} enriched ${enrichedCount} incomplete ${
              enrichedCount === 1 ? 'role' : 'roles'
            } with missing details`
          );
        } else if (failedCount > 0) {
          pushToast(
            `${failedCount} source${failedCount > 1 ? 's' : ''} failed — check Recent Agent Runs`,
            'View Log',
            () => setActiveView('sources')
          );
        } else if (trigger === 'manual') {
          pushToast(
            `Scanned ${report.totalFetched} items — all matching roles already indexed (${report.totalSkipped} deduped).`
          );
        }
      }
    },
    [pushToast, persistCloud]
  );

  // Real-time SSE subscription for live server-pushed updates across open tabs
  useEffect(() => {
    const es = new EventSource('/api/events');

    const onScheduleUpdated = (event: MessageEvent) => {
      try {
        const state = JSON.parse(event.data) as ServerScheduleState;
        setAutoScheduleEnabled(state.enabled);
        setAutoScheduleMinutes(state.intervalMinutes);
        setNextScheduledRunAt(state.nextRunAt);
        setIsAgentRunning(state.isRunning);
      } catch {
        // Ignore malformed frame
      }
    };

    const onAgentStarted = () => setIsAgentRunning(true);

    const onAgentCompleted = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as {
          trigger?: 'manual' | 'scheduled';
          newJobs?: JobRecord[];
          enrichedJobs?: JobEnrichmentPatch[];
          checkedCompanyIds?: { id: string; foundCount: number }[];
          runReport?: AgentRunReport;
        };
        applyCompletedAgentRun(
          Array.isArray(payload.newJobs) ? payload.newJobs : [],
          payload.runReport,
          payload.trigger ?? 'manual',
          {
            enrichedJobs: payload.enrichedJobs,
            checkedCompanyIds: payload.checkedCompanyIds,
          }
        );
      } catch {
        // Ignore
      } finally {
        setIsAgentRunning(false);
        setRunningSourceId(null);
      }
    };

    const onJobsRescored = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as {
          patches?: { id: string; matchScore: number; matchReason: string }[];
        };
        if (!Array.isArray(payload.patches) || payload.patches.length === 0) return;
        const patchMap = new Map(payload.patches.map((p) => [p.id, p]));
        setJobs((prev) =>
          prev.map((j) => {
            const patch = patchMap.get(j.id);
            if (!patch) return j;
            return {
              ...j,
              previousMatchScore: j.matchScore,
              matchScore: patch.matchScore,
              matchReason: patch.matchReason || j.matchReason,
            };
          })
        );
      } catch {
        // Ignore
      }
    };

    const onAgentError = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { message?: string };
        if (payload.message) pushToast(payload.message);
      } catch {
        // Ignore
      } finally {
        setIsAgentRunning(false);
      }
    };

    const onSlackOAuth = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as {
          state?: string;
          ok?: boolean;
          accessToken?: string;
          teamName?: string;
          error?: string;
        };
        if (
          payload.state &&
          activeSlackStateRef.current &&
          payload.state !== activeSlackStateRef.current
        ) {
          return;
        }
        window.dispatchEvent(
          new CustomEvent('meridian:slack_oauth_sse', { detail: payload })
        );
      } catch {
        // Ignore
      }
    };

    es.addEventListener('schedule:updated', onScheduleUpdated);
    es.addEventListener('agent:started', onAgentStarted);
    es.addEventListener('agent:completed', onAgentCompleted);
    es.addEventListener('jobs:rescored', onJobsRescored);
    es.addEventListener('agent:error', onAgentError);
    es.addEventListener('slack:oauth', onSlackOAuth);

    return () => es.close();
  }, [applyCompletedAgentRun, pushToast]);

  // Sync latest workspace criteria, sources, target companies, incomplete roles, hashes & feedback to the server scheduler
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetch('/api/workspace/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sources,
          targetCompanies,
          incompleteJobs: getIncompleteJobsForEnrichment(jobs),
          existingHashes: jobs.map((j) => j.urlHash),
          searchPrompt,
          rules: rules.map((r) => ({ text: r.text, active: r.active })),
          recentFeedback: feedbackHistory.slice(0, 15).map((f) => ({
            jobTitle: f.jobTitle,
            company: f.company,
            vote: f.vote,
            reason: f.reason,
          })),
        }),
      }).catch(() => {
        // Non-blocking sync
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [sources, targetCompanies, jobs, searchPrompt, rules, feedbackHistory]);

  const buildRichFeedback = useCallback(() => {
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    return feedbackHistory.slice(0, 20).map((f) => {
      const linked = jobById.get(f.jobId);
      return {
        jobTitle: f.jobTitle,
        company: f.company,
        vote: f.vote,
        reason: f.reason,
        locationType: linked?.locationType,
        salaryLabel: linked?.salaryLabel,
        skills: linked?.skills,
      };
    });
  }, [jobs, feedbackHistory]);

  const selectedJob = useMemo(
    () => jobs.find((j) => j.id === selectedJobId) ?? null,
    [jobs, selectedJobId]
  );

  // Deterministic pattern-based rule suggestions
  const ruleSuggestions = useMemo<RuleSuggestion[]>(() => {
    const counts = new Map<DislikeReason, number>();
    for (const entry of feedbackHistory) {
      if (entry.vote === 'down' && entry.reason) {
        counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1);
      }
    }

    const suggestions: RuleSuggestion[] = [];
    counts.forEach((count, reason) => {
      const template = REASON_TO_RULE[reason];
      const alreadyActiveRule = rules.some(
        (r) => r.text.toLowerCase() === template.rule.toLowerCase()
      );
      if (count >= 2 && !alreadyActiveRule && !dismissedReasons.includes(reason)) {
        suggestions.push({
          id: `sug-${reason}`,
          reasonTrigger: reason,
          count,
          proposedRule: template.rule,
          summary: template.summary,
          dismissed: false,
        });
      }
    });
    return suggestions;
  }, [feedbackHistory, rules, dismissedReasons]);

  const pendingSuggestionCount = useMemo(() => {
    const aiPending = (aiSynthesis?.suggestions ?? []).filter((s) => !s.dismissed).length;
    return ruleSuggestions.length + aiPending;
  }, [ruleSuggestions, aiSynthesis]);

  const newCount = useMemo(
    () => jobs.filter((j) => j.isNew && j.stage !== 'archived').length,
    [jobs]
  );
  const activePipelineCount = useMemo(
    () => jobs.filter((j) => j.stage !== 'archived').length,
    [jobs]
  );
  const untitledJobCount = useMemo(
    () => jobs.filter((j) => isUntitledJob(j)).length,
    [jobs]
  );

  // Effective Gmail query compiled dynamically from user's editable sender list
  const effectiveGmailQuery = useMemo(
    () =>
      gmailQueryOverride.trim() ||
      buildGmailQueryFromSenders(intakeProfile.gmailSenders),
    [gmailQueryOverride, intakeProfile.gmailSenders]
  );

  // Stage 2: AI Preference Synthesis
  const runPreferenceSynthesis = useCallback(
    async (silent = false) => {
      if (isSynthesizing) return;
      setIsSynthesizing(true);
      try {
        const res = await fetch('/api/feedback/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            searchPrompt,
            rules: rules.map((r) => ({ text: r.text, active: r.active })),
            recentFeedback: buildRichFeedback(),
          }),
        });
        const data = (await res.json()) as Partial<PreferenceSynthesisResult> & {
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || 'Failed to synthesize preferences');
        }
        const result: PreferenceSynthesisResult = {
          preferenceSummary: data.preferenceSummary || '',
          suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
          synthesizedAt: data.synthesizedAt || 'Just now',
        };
        setAiSynthesis(result);
        if (result.suggestions.length > 0) {
          pushToast(
            `Agent synthesized ${result.suggestions.length} new filter rule ${
              result.suggestions.length === 1 ? 'suggestion' : 'suggestions'
            }`,
            'Review Rules',
            () => setActiveView('criteria')
          );
        } else if (!silent) {
          pushToast('Preference profile updated from your recent feedback');
        }
      } catch (err: unknown) {
        if (!silent) {
          pushToast(
            err instanceof Error ? err.message : 'Could not synthesize preferences.'
          );
        }
      } finally {
        setIsSynthesizing(false);
      }
    },
    [isSynthesizing, searchPrompt, rules, buildRichFeedback, pushToast]
  );

  // Stage 1: Re-score active or newly imported roles
  const rescoreSpecificJobs = useCallback(
    async (targets: JobRecord[], customPrompt?: string) => {
      if (targets.length === 0) return;
      setIsRescoring(true);
      try {
        const res = await fetch('/api/agent/rescore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobs: targets.map((j) => ({
              id: j.id,
              title: j.title,
              company: j.company,
              salaryLabel: j.salaryLabel,
              location: j.location,
              locationType: j.locationType,
              skills: j.skills,
              summary: j.summary,
            })),
            searchPrompt: customPrompt ?? searchPrompt,
            rules: rules.map((r) => ({ text: r.text, active: r.active })),
            recentFeedback: buildRichFeedback(),
          }),
        });

        const data = (await res.json()) as {
          patches?: { id: string; matchScore: number; matchReason: string }[];
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || 'Failed to re-score roles');
        }

        const patches = Array.isArray(data.patches) ? data.patches : [];
        if (patches.length > 0) {
          const patchMap = new Map(patches.map((p) => [p.id, p]));
          const cloudPatches: {
            id: string;
            previousMatchScore: number;
            matchScore: number;
            matchReason: string;
          }[] = [];

          setJobs((prev) =>
            prev.map((j) => {
              const patch = patchMap.get(j.id);
              if (!patch) return j;
              cloudPatches.push({
                id: j.id,
                previousMatchScore: j.matchScore,
                matchScore: patch.matchScore,
                matchReason: patch.matchReason || j.matchReason,
              });
              return {
                ...j,
                previousMatchScore: j.matchScore,
                matchScore: patch.matchScore,
                matchReason: patch.matchReason || j.matchReason,
              };
            })
          );

          persistCloud((uid) => updateJobRescoreBatchInCloud(uid, cloudPatches));
          pushToast(
            `Scored ${patches.length} roles against your latest criteria and feedback`
          );
        }
      } catch (err: unknown) {
        pushToast(err instanceof Error ? err.message : 'Failed to re-score roles.');
      } finally {
        setIsRescoring(false);
      }
    },
    [searchPrompt, rules, buildRichFeedback, persistCloud, pushToast]
  );

  const handleRescoreActiveJobs = async () => {
    if (isRescoring) return;
    const targets = jobs.filter((j) => j.stage === 'inbox' || j.stage === 'saved');
    if (targets.length === 0) {
      pushToast('No Inbox or Saved roles to re-score right now.');
      return;
    }
    await rescoreSpecificJobs(targets);
  };

  // Triage: Thumbs Up
  const handleThumbsUp = (jobId: string) => {
    const target = jobs.find((j) => j.id === jobId);
    if (!target) return;

    const nextStage: PipelineStage =
      target.stage === 'inbox' || target.stage === 'archived'
        ? 'saved'
        : target.stage;

    setJobs((prev) =>
      prev.map((j) =>
        j.id === jobId
          ? {
              ...j,
              isNew: false,
              stage: nextStage,
              feedback: 'up',
              dislikeReason: undefined,
            }
          : j
      )
    );

    persistCloud((uid) =>
      updateJobTriageInCloud(uid, jobId, {
        stage: nextStage,
        isNew: false,
        feedback: 'up',
        dislikeReason: undefined,
      })
    );

    if (target.feedback !== 'up') {
      const entry: FeedbackEntry = {
        id: `fb-${Date.now()}`,
        jobId: target.id,
        jobTitle: target.title,
        company: target.company,
        vote: 'up',
        createdAt: new Date().toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        }),
      };
      setFeedbackHistory((prev) => [entry, ...prev].slice(0, 30));
      persistCloud((uid) => createFeedbackInCloud(uid, entry));

      votesSinceSynthesis.current += 1;
      if (votesSinceSynthesis.current >= 3) {
        votesSinceSynthesis.current = 0;
        void runPreferenceSynthesis(true);
      }
    }

    pushToast(`Saved "${target.title}" at ${target.company}`);
  };

  // Triage: Thumbs Down
  const handleThumbsDown = (jobId: string, reason?: DislikeReason) => {
    const target = jobs.find((j) => j.id === jobId);
    if (!target) return;

    const prevStage = target.stage;
    const prevIsNew = target.isNew;
    const prevFeedback = target.feedback;

    setJobs((prev) =>
      prev.map((j) =>
        j.id === jobId
          ? {
              ...j,
              isNew: false,
              stage: 'archived',
              feedback: 'down',
              dislikeReason: reason,
            }
          : j
      )
    );

    persistCloud((uid) =>
      updateJobTriageInCloud(uid, jobId, {
        stage: 'archived',
        isNew: false,
        feedback: 'down',
        dislikeReason: reason,
      })
    );

    const entryId = `fb-${Date.now()}`;
    const entry: FeedbackEntry = {
      id: entryId,
      jobId: target.id,
      jobTitle: target.title,
      company: target.company,
      vote: 'down',
      reason,
      createdAt: new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      }),
    };
    setFeedbackHistory((prev) => [entry, ...prev].slice(0, 30));
    persistCloud((uid) => createFeedbackInCloud(uid, entry));

    votesSinceSynthesis.current += 1;
    if (votesSinceSynthesis.current >= 3) {
      votesSinceSynthesis.current = 0;
      void runPreferenceSynthesis(true);
    }

    pushToast(
      reason
        ? `Archived "${target.company}" (${reason})`
        : `Archived "${target.title}"`,
      'Undo',
      () => {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? {
                  ...j,
                  stage: prevStage,
                  isNew: prevIsNew,
                  feedback: prevFeedback,
                  dislikeReason: undefined,
                }
              : j
          )
        );
        persistCloud((uid) =>
          updateJobTriageInCloud(uid, jobId, {
            stage: prevStage,
            isNew: prevIsNew,
            feedback: prevFeedback,
            dislikeReason: undefined,
          })
        );
        setFeedbackHistory((prev) => prev.filter((f) => f.id !== entryId));
        persistCloud((uid) => deleteFeedbackInCloud(uid, entryId));
      }
    );
  };

  const handleRestoreJob = (jobId: string) => {
    const target = jobs.find((j) => j.id === jobId);
    if (!target) return;
    setJobs((prev) =>
      prev.map((j) =>
        j.id === jobId
          ? {
              ...j,
              stage: 'saved',
              isNew: false,
              feedback: null,
              dislikeReason: undefined,
            }
          : j
      )
    );
    persistCloud((uid) =>
      updateJobTriageInCloud(uid, jobId, {
        stage: 'saved',
        isNew: false,
        feedback: null,
        dislikeReason: undefined,
      })
    );
    pushToast(`Restored "${target.title}" to Saved`);
  };

  const handleDeleteJob = (jobId: string) => {
    const target = jobs.find((j) => j.id === jobId);
    if (!target) return;
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
    setSelectedJobId((prev) => (prev === jobId ? null : prev));
    persistCloud((uid) => deleteJobInCloud(uid, jobId));
    pushToast(`Deleted "${target.title}" at ${target.company}`);
  };

  const handleMoveStage = (jobId: string, nextStage: PipelineStage) => {
    const target = jobs.find((j) => j.id === jobId);
    if (!target) return;
    const nextIsNew = nextStage === 'inbox' ? target.isNew : false;
    setJobs((prev) =>
      prev.map((j) =>
        j.id === jobId
          ? {
              ...j,
              stage: nextStage,
              isNew: nextIsNew,
            }
          : j
      )
    );
    persistCloud((uid) =>
      updateJobTriageInCloud(uid, jobId, {
        stage: nextStage,
        isNew: nextIsNew,
        feedback: target.feedback,
        dislikeReason: target.dislikeReason,
      })
    );
  };

  const handleUpdateNotes = (jobId: string, notes: string) => {
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, notes } : j)));
    persistCloud((uid) => updateJobNotesInCloud(uid, jobId, notes));
  };

  const handleUpdateFullDescription = (jobId: string, fullDescription: string) => {
    setJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, fullDescription } : j))
    );
    persistCloud((uid) => updateJobFullDescriptionInCloud(uid, jobId, fullDescription));
    pushToast('Saved updated job description');
  };

  const handleFetchFullDescription = async (jobId: string, jobUrl: string) => {
    try {
      const res = await fetch('/api/jobs/fetch-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobUrl }),
      });
      const data = (await res.json()) as { fullDescription?: string; error?: string };
      if (!res.ok || !data.fullDescription) {
        throw new Error(
          data.error || 'Could not extract full description from this posting URL.'
        );
      }
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, fullDescription: data.fullDescription } : j
        )
      );
      persistCloud((uid) =>
        updateJobFullDescriptionInCloud(uid, jobId, data.fullDescription!)
      );
      pushToast('Fetched full job description');
    } catch (err: unknown) {
      pushToast(
        err instanceof Error ? err.message : 'Failed to fetch full job description.'
      );
    }
  };

  const handleUpdateNetworkingContacts = (
    jobId: string,
    contacts: NetworkingContact[]
  ) => {
    setJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, networkingContacts: contacts } : j))
    );
    persistCloud((uid) => updateJobNetworkingContactsInCloud(uid, jobId, contacts));
  };

  // Resumes & Extended Career Context handlers
  const handleSaveResume = (resume: RoleResume) => {
    setResumes((prev) => {
      const idx = prev.findIndex(
        (r) =>
          r.id === resume.id ||
          r.roleType.toLowerCase() === resume.roleType.toLowerCase()
      );
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...resume, id: prev[idx].id };
        persistCloud((uid) => upsertRoleResumeInCloud(uid, next[idx]));
        return next;
      }
      persistCloud((uid) => upsertRoleResumeInCloud(uid, resume));
      return [resume, ...prev];
    });
    pushToast(`Saved ${resume.roleType} resume (${resume.fileName})`);
  };

  const handleDeleteResume = (resumeId: string) => {
    setResumes((prev) => prev.filter((r) => r.id !== resumeId));
    persistCloud((uid) => deleteRoleResumeInCloud(uid, resumeId));
    pushToast('Removed base resume');
  };

  const handleSaveCareerExperiences = (items: CareerExperienceItem[]) => {
    setIntakeProfile((prev) => ({ ...prev, careerExperiences: items }));
    persistCloud((uid) =>
      updateCareerContextInCloud(uid, { careerExperiences: items })
    );
  };

  const handleSaveCareerContextNotes = (notes: string) => {
    setIntakeProfile((prev) => ({ ...prev, careerContextNotes: notes }));
    persistCloud((uid) =>
      updateCareerContextInCloud(uid, { careerContextNotes: notes })
    );
    pushToast('Saved extended career context');
  };

  const handleSaveTailoredResult = (
    jobId: string,
    result: {
      tailored: TailoredResumeDocument;
      docxBase64: string;
      fileName: string;
    }
  ) => {
    setTailoredByJobId((prev) => ({ ...prev, [jobId]: result }));
    pushToast('Generated 1-page tailored resume (.docx with edits in red)');
  };

  // Account & Gmail Auth handlers
  const handleSignInAccount = async (includeGmailScope: boolean) => {
    setIsGmailSigningIn(true);
    setGmailError(null);
    try {
      const { user, accessToken } = await signInWithGoogleAccount(includeGmailScope);
      authUidRef.current = user.uid;
      setAuthUid(user.uid);
      setUserEmail(user.email);
      setUserDisplayName(user.displayName);
      if (accessToken) {
        setGmailConnected(true);
      }
      pushToast(`Signed in as ${user.email ?? 'Google Account'}`);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Google Sign-In was cancelled or failed.';
      setGmailError(msg);
      pushToast(msg);
      throw err;
    } finally {
      setIsGmailSigningIn(false);
    }
  };

  const handleScanGmail = useCallback(
    async (explicitToken?: string, queryOverride?: string, promptOverride?: string) => {
      const token = explicitToken ?? getGmailAccessToken();
      if (!token) {
        setGmailConnected(false);
        pushToast('Sign in with Google to scan Gmail job alerts.', 'Open Sources', () =>
          setActiveView('sources')
        );
        return;
      }
      if (isGmailScanning) return;

      setIsGmailScanning(true);
      try {
        const res = await fetch('/api/gmail/scan', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            query: queryOverride ?? effectiveGmailQuery,
            maxMessages: 14,
            existingHashes: jobs.map((j) => j.urlHash),
            searchPrompt: promptOverride ?? searchPrompt,
            rules: rules.map((r) => ({ text: r.text, active: r.active })),
            recentFeedback: feedbackHistory.slice(0, 15).map((f) => ({
              jobTitle: f.jobTitle,
              company: f.company,
              vote: f.vote,
              reason: f.reason,
            })),
          }),
        });

        const data = (await res.json()) as {
          newJobs?: JobRecord[];
          emailsScanned?: number;
          runReport?: AgentRunReport;
          error?: string;
        };

        if (res.status === 401) {
          clearGmailAccessToken();
          setGmailConnected(false);
          throw new Error(data.error || 'Gmail session expired. Please sign in again.');
        }

        if (!res.ok) {
          throw new Error(data.error || `Gmail scan failed (${res.status})`);
        }

        const nowTime = new Date().toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        });
        setGmailLastScanLabel(`Today, ${nowTime}`);

        const addedJobs = Array.isArray(data.newJobs) ? data.newJobs : [];
        applyCompletedAgentRun(addedJobs, data.runReport, 'manual');

        if (addedJobs.length === 0 && typeof data.emailsScanned === 'number') {
          pushToast(
            data.emailsScanned === 0
              ? 'No recent job emails matched your configured Gmail senders.'
              : `Scanned ${data.emailsScanned} Gmail messages — no new unseen roles to add.`
          );
        }
      } catch (err: unknown) {
        pushToast(
          err instanceof Error ? err.message : 'Failed to scan Gmail messages.'
        );
      } finally {
        setIsGmailScanning(false);
      }
    },
    [
      isGmailScanning,
      effectiveGmailQuery,
      jobs,
      searchPrompt,
      rules,
      feedbackHistory,
      applyCompletedAgentRun,
      pushToast,
    ]
  );

  const handleConnectGmail = async (scanImmediately = true) => {
    setIsGmailSigningIn(true);
    setGmailError(null);
    try {
      const { user, accessToken } = await signInWithGoogleGmail();
      authUidRef.current = user.uid;
      setAuthUid(user.uid);
      setUserEmail(user.email);
      setUserDisplayName(user.displayName);
      setGmailConnected(true);
      pushToast(`Connected Gmail (${user.email ?? 'Google Account'})`);
      if (scanImmediately) {
        void handleScanGmail(accessToken);
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Google Sign-In was cancelled or failed.';
      setGmailError(msg);
      pushToast(msg);
    } finally {
      setIsGmailSigningIn(false);
    }
  };

  const handleDisconnectAccount = async () => {
    await signOutGoogle();
    setGmailConnected(false);
    setGmailError(null);
    setAuthUid(null);
    setUserEmail(null);
    setUserDisplayName(null);
    pushToast('Signed out of Google account');
  };

  // Slack 3P OAuth popup + message listener (per oauth-integration skill)
  const handleScanSlack = useCallback(
    async (explicitToken?: string, channelsOverride?: string[], promptOverride?: string) => {
      const token = explicitToken ?? slackTokenRef.current;
      if (!token) {
        setSlackConnected(false);
        pushToast('Connect Slack in Sources to scan job channels.');
        return;
      }
      if (isSlackScanning) return;
      setIsSlackScanning(true);
      try {
        const res = await fetch('/api/slack/scan', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            channels: channelsOverride ?? intakeProfile.slackChannels,
            existingHashes: jobs.map((j) => j.urlHash),
            searchPrompt: promptOverride ?? searchPrompt,
            rules: rules.map((r) => ({ text: r.text, active: r.active })),
            recentFeedback: feedbackHistory.slice(0, 15).map((f) => ({
              jobTitle: f.jobTitle,
              company: f.company,
              vote: f.vote,
              reason: f.reason,
            })),
          }),
        });

        const data = (await res.json()) as {
          newJobs?: JobRecord[];
          messagesScanned?: number;
          channelsScanned?: string[];
          runReport?: AgentRunReport;
          error?: string;
        };

        if (res.status === 401) {
          slackTokenRef.current = null;
          setSlackConnected(false);
          throw new Error(data.error || 'Slack session expired. Please reconnect.');
        }

        if (!res.ok) {
          throw new Error(data.error || `Slack scan failed (${res.status})`);
        }

        const addedJobs = Array.isArray(data.newJobs) ? data.newJobs : [];
        applyCompletedAgentRun(addedJobs, data.runReport, 'manual');

        if (addedJobs.length === 0) {
          pushToast(
            data.channelsScanned && data.channelsScanned.length > 0
              ? `Scanned ${data.channelsScanned.join(', ')} — no new unseen roles.`
              : 'No joined Slack channels matched your channel filter.'
          );
        }
      } catch (err: unknown) {
        pushToast(
          err instanceof Error ? err.message : 'Failed to scan Slack channels.'
        );
      } finally {
        setIsSlackScanning(false);
      }
    },
    [
      isSlackScanning,
      intakeProfile.slackChannels,
      jobs,
      searchPrompt,
      rules,
      feedbackHistory,
      applyCompletedAgentRun,
      pushToast,
    ]
  );

  const handleSlackOAuthResult = useCallback(
    (payload: {
      state?: string;
      ok: boolean;
      accessToken?: string;
      teamName?: string;
      error?: string;
    }) => {
      const dedupeKey =
        payload.state || `${payload.ok ? 'ok' : 'err'}-${payload.accessToken?.slice(0, 12) || payload.error || ''}`;
      if (handledSlackStatesRef.current.has(dedupeKey)) return;
      handledSlackStatesRef.current.add(dedupeKey);

      if (slackPollTimerRef.current !== null) {
        window.clearInterval(slackPollTimerRef.current);
        slackPollTimerRef.current = null;
      }
      activeSlackStateRef.current = null;

      if (payload.ok && payload.accessToken) {
        slackTokenRef.current = payload.accessToken;
        setSlackConnected(true);
        setSlackTeamName(payload.teamName || 'Slack Workspace');
        setSlackError(null);
        pushToast(
          `Connected Slack (${payload.teamName || 'Workspace'}) — scanning channels...`
        );
        void handleScanSlack(payload.accessToken);
      } else {
        const msg = payload.error || 'Slack connection failed.';
        setSlackError(msg);
        pushToast(msg);
      }
      void refreshSlackAuthConfig();
    },
    [handleScanSlack, pushToast, refreshSlackAuthConfig]
  );

  // Listen across postMessage, BroadcastChannel, and SSE bridge so COOP opener clearing never drops Slack OAuth
  useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) {
        return;
      }
      if (event.data?.type === 'SLACK_OAUTH_SUCCESS' && event.data?.accessToken) {
        handleSlackOAuthResult({
          state: typeof event.data.state === 'string' ? event.data.state : undefined,
          ok: true,
          accessToken: String(event.data.accessToken),
          teamName: String(event.data.teamName || 'Slack Workspace'),
        });
      } else if (event.data?.type === 'SLACK_OAUTH_ERROR') {
        handleSlackOAuthResult({
          state: typeof event.data.state === 'string' ? event.data.state : undefined,
          ok: false,
          error: String(event.data.error || 'Slack connection failed.'),
        });
      }
    };

    const handleSseBridge = (event: Event) => {
      const detail = (event as CustomEvent<{
        state?: string;
        ok?: boolean;
        accessToken?: string;
        teamName?: string;
        error?: string;
      }>).detail;
      if (!detail) return;
      handleSlackOAuthResult({
        state: detail.state,
        ok: Boolean(detail.ok),
        accessToken: detail.accessToken,
        teamName: detail.teamName,
        error: detail.error,
      });
    };

    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        bc = new BroadcastChannel('meridian_slack_oauth');
        bc.onmessage = (ev: MessageEvent) => {
          if (ev.data?.type === 'SLACK_OAUTH_SUCCESS' && ev.data?.accessToken) {
            handleSlackOAuthResult({
              state: typeof ev.data.state === 'string' ? ev.data.state : undefined,
              ok: true,
              accessToken: String(ev.data.accessToken),
              teamName: String(ev.data.teamName || 'Slack Workspace'),
            });
          } else if (ev.data?.type === 'SLACK_OAUTH_ERROR') {
            handleSlackOAuthResult({
              state: typeof ev.data.state === 'string' ? ev.data.state : undefined,
              ok: false,
              error: String(ev.data.error || 'Slack connection failed.'),
            });
          }
        };
      } catch {
        // Ignore if BroadcastChannel restricted
      }
    }

    window.addEventListener('message', handleOAuthMessage);
    window.addEventListener('meridian:slack_oauth_sse', handleSseBridge);
    return () => {
      window.removeEventListener('message', handleOAuthMessage);
      window.removeEventListener('meridian:slack_oauth_sse', handleSseBridge);
      bc?.close();
    };
  }, [handleSlackOAuthResult]);

  // Synchronous click handler: calls window.open immediately without awaiting network first
  const handleConnectSlack = () => {
    setSlackError(null);
    if (!slackAuthConfig.configured || !slackAuthConfig.url) {
      const missing: string[] = [];
      if (!slackAuthConfig.hasClientId) missing.push('SLACK_CLIENT_ID');
      if (!slackAuthConfig.hasClientSecret) missing.push('SLACK_CLIENT_SECRET');
      const msg =
        missing.length > 0
          ? `Missing ${missing.join(' and ')} in Settings > Secrets. Add ${
              missing.length === 1 ? 'it' : 'them'
            } and refresh to connect Slack.`
          : 'Slack OAuth is initializing — please click Connect Slack again in a moment.';
      setSlackError(msg);
      pushToast(msg, 'View Setup', () => {
        setIntakeOpen(false);
        setActiveView('sources');
      });
      void refreshSlackAuthConfig();
      return;
    }

    const oauthState = slackAuthConfig.state;
    activeSlackStateRef.current = oauthState;

    const popup = window.open(
      slackAuthConfig.url,
      'slack_oauth_popup',
      'width=600,height=700'
    );

    if (!popup) {
      const blockedMsg =
        'Your browser blocked the Slack sign-in popup. Allow popups for this site and try again.';
      setSlackError(blockedMsg);
      pushToast(blockedMsg);
      void refreshSlackAuthConfig();
      return;
    }

    // Poll one-time server session fallback in case COOP severs window.opener
    if (oauthState) {
      if (slackPollTimerRef.current !== null) {
        window.clearInterval(slackPollTimerRef.current);
      }
      const startedAt = Date.now();
      let closedAt: number | null = null;
      slackPollTimerRef.current = window.setInterval(() => {
        if (handledSlackStatesRef.current.has(oauthState)) {
          if (slackPollTimerRef.current !== null) {
            window.clearInterval(slackPollTimerRef.current);
            slackPollTimerRef.current = null;
          }
          return;
        }
        const elapsed = Date.now() - startedAt;
        if (popup.closed && closedAt === null) {
          closedAt = Date.now();
        }
        const closedElapsed = closedAt ? Date.now() - closedAt : 0;
        if (elapsed > 90_000 || closedElapsed > 3_500) {
          if (slackPollTimerRef.current !== null) {
            window.clearInterval(slackPollTimerRef.current);
            slackPollTimerRef.current = null;
          }
          return;
        }

        void fetch(`/api/slack/session?state=${encodeURIComponent(oauthState)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then(
            (
              data: {
                pending?: boolean;
                ok?: boolean;
                accessToken?: string;
                teamName?: string;
                error?: string;
              } | null
            ) => {
              if (!data || data.pending) return;
              handleSlackOAuthResult({
                state: oauthState,
                ok: Boolean(data.ok),
                accessToken: data.accessToken,
                teamName: data.teamName,
                error: data.error,
              });
            }
          )
          .catch(() => {
            // Keep polling
          });
      }, 1200);
    }

    // Prepare a fresh state/URL in background for any subsequent reconnect
    void refreshSlackAuthConfig();
  };

  const handleDisconnectSlack = () => {
    slackTokenRef.current = null;
    setSlackConnected(false);
    setSlackTeamName(null);
    setSlackError(null);
    pushToast('Disconnected Slack');
  };

  // WhatsApp Chat Export / Paste Scanner
  const handleScanWhatsApp = async (
    rawText: string,
    groupName: string
  ): Promise<number> => {
    if (isWhatsAppScanning) return 0;
    setIsWhatsAppScanning(true);
    try {
      const res = await fetch('/api/whatsapp/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText,
          groupName,
          existingHashes: jobs.map((j) => j.urlHash),
          searchPrompt,
          rules: rules.map((r) => ({ text: r.text, active: r.active })),
          recentFeedback: feedbackHistory.slice(0, 15).map((f) => ({
            jobTitle: f.jobTitle,
            company: f.company,
            vote: f.vote,
            reason: f.reason,
          })),
        }),
      });
      const data = (await res.json()) as {
        newJobs?: JobRecord[];
        messagesScanned?: number;
        runReport?: AgentRunReport;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || `WhatsApp scan failed (${res.status})`);
      }

      const added = Array.isArray(data.newJobs) ? data.newJobs : [];
      applyCompletedAgentRun(added, data.runReport, 'manual');
      if (added.length === 0) {
        pushToast(
          `Scanned ${data.messagesScanned ?? 0} WhatsApp messages — no new unseen roles found.`
        );
      }
      return added.length;
    } catch (err: unknown) {
      pushToast(
        err instanceof Error ? err.message : 'Failed to extract jobs from WhatsApp messages.'
      );
      return 0;
    } finally {
      setIsWhatsAppScanning(false);
    }
  };

  // Dynamic channel preferences updaters (sync to cloud immediately)
  const handleChangeGmailSenders = (senders: string[]) => {
    setIntakeProfile((prev) => ({ ...prev, gmailSenders: senders }));
    const compiled = gmailQueryOverride.trim() || buildGmailQueryFromSenders(senders);
    persistCloud((uid) =>
      updateWorkspaceSettingsInCloud(uid, {
        gmailSenders: senders,
        gmailQuery: compiled,
      })
    );
  };

  const handleChangeGmailQueryOverride = (q: string) => {
    setGmailQueryOverride(q);
    const compiled = q.trim() || buildGmailQueryFromSenders(intakeProfile.gmailSenders);
    persistCloud((uid) => updateWorkspaceSettingsInCloud(uid, { gmailQuery: compiled }));
  };

  const handleChangeSlackChannels = (channels: string[]) => {
    setIntakeProfile((prev) => ({ ...prev, slackChannels: channels }));
    persistCloud((uid) =>
      updateWorkspaceSettingsInCloud(uid, { slackChannels: channels })
    );
  };

  const handleChangeWhatsAppGroups = (groups: string[]) => {
    setIntakeProfile((prev) => ({ ...prev, whatsappGroups: groups }));
    persistCloud((uid) =>
      updateWorkspaceSettingsInCloud(uid, { whatsappGroups: groups })
    );
  };

  // CSV / JSON Upload & Schema Mapping Import
  const handleImportJobs = async (params: {
    jobs: JobRecord[];
    fileName: string;
    totalRows: number;
    skippedDuplicates: number;
    autoScoreWithAi: boolean;
  }) => {
    const existing = new Set(jobs.map((j) => j.urlHash));
    const uniqueNew = params.jobs.filter((j) => !existing.has(j.urlHash));
    if (uniqueNew.length === 0) {
      pushToast('All uploaded roles are already in your database.');
      return;
    }

    setJobs((prev) => [...uniqueNew, ...prev]);
    setImportedCountInSession((c) => c + uniqueNew.length);

    const batchRecord: ImportBatchRecord = {
      id: `imp-${Date.now()}`,
      fileName: params.fileName,
      totalRows: params.totalRows,
      importedCount: uniqueNew.length,
      skippedDuplicates: params.skippedDuplicates,
      createdAt: new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      }),
    };
    setImportHistory((prev) => [batchRecord, ...prev].slice(0, 15));

    persistCloud(async (uid) => {
      await createJobsInCloud(uid, uniqueNew);
      await createImportBatchInCloud(uid, {
        id: batchRecord.id,
        fileName: batchRecord.fileName,
        totalRows: batchRecord.totalRows,
        importedCount: batchRecord.importedCount,
        skippedDuplicates: batchRecord.skippedDuplicates,
      });
    });

    pushToast(
      `Imported ${uniqueNew.length} ${
        uniqueNew.length === 1 ? 'role' : 'roles'
      } from ${params.fileName} into database`
    );

    if (params.autoScoreWithAi) {
      void rescoreSpecificJobs(uniqueNew.slice(0, 15));
    }
  };

  // Target Companies Watchlist handlers (manual, CSV import, and "Untitled Role" migration)
  const handleAddTargetCompany = (
    name: string,
    careersUrl?: string,
    notes?: string
  ) => {
    const cleanName = name.trim();
    if (!cleanName) return;
    const exists = targetCompanies.some(
      (c) => c.name.trim().toLowerCase() === cleanName.toLowerCase()
    );
    if (exists) {
      pushToast(`"${cleanName}" is already in your Target Companies Watchlist.`);
      return;
    }
    const created: TargetCompany = {
      id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: cleanName,
      careersUrl: careersUrl?.trim() || undefined,
      notes: notes?.trim() || undefined,
      enabled: true,
      lastCheckedAt: 'Pending pull',
      lastFoundCount: 0,
    };
    setTargetCompanies((prev) => [created, ...prev]);
    persistCloud((uid) => createTargetCompaniesBatchInCloud(uid, [created]));
    pushToast(`Watching "${cleanName}" for your desired roles`);
  };

  const handleImportTargetCompanies = async (
    rows: ParsedTargetCompanyRow[],
    sourceLabel?: string
  ) => {
    const existingKeys = new Set(
      targetCompanies.map((c) => c.name.trim().toLowerCase())
    );
    const created: TargetCompany[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const cleanName = row.name.trim();
      if (!cleanName) continue;
      const key = cleanName.toLowerCase();
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      created.push({
        id: `tc-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
        name: cleanName,
        careersUrl: row.careersUrl?.trim() || undefined,
        notes: row.notes?.trim() || undefined,
        enabled: true,
        lastCheckedAt: 'Pending pull',
        lastFoundCount: 0,
      });
    }

    if (created.length === 0) {
      pushToast('All listed target companies are already in your watchlist.');
      return;
    }

    setTargetCompanies((prev) => [...created, ...prev]);
    persistCloud((uid) => createTargetCompaniesBatchInCloud(uid, created));
    pushToast(
      `Added ${created.length} target ${
        created.length === 1 ? 'company' : 'companies'
      }${sourceLabel ? ` from ${sourceLabel}` : ''} to your watchlist`
    );
  };

  const handleToggleTargetCompany = (companyId: string) => {
    const target = targetCompanies.find((c) => c.id === companyId);
    if (!target) return;
    const nextEnabled = !target.enabled;
    setTargetCompanies((prev) =>
      prev.map((c) => (c.id === companyId ? { ...c, enabled: nextEnabled } : c))
    );
    persistCloud((uid) =>
      updateTargetCompanyInCloud(uid, companyId, { enabled: nextEnabled })
    );
  };

  const handleDeleteTargetCompany = (companyId: string) => {
    const target = targetCompanies.find((c) => c.id === companyId);
    setTargetCompanies((prev) => prev.filter((c) => c.id !== companyId));
    persistCloud((uid) => deleteTargetCompanyInCloud(uid, companyId));
    if (target) {
      pushToast(`Removed "${target.name}" from Target Companies`);
    }
  };

  const handleMoveUntitledToTargetCompanies = () => {
    const untitled = jobs.filter((j) => isUntitledJob(j));
    if (untitled.length === 0) return;

    const existingKeys = new Set(
      targetCompanies.map((c) => c.name.trim().toLowerCase())
    );
    const created: TargetCompany[] = [];

    for (let i = 0; i < untitled.length; i++) {
      const job = untitled[i];
      const cleanName = job.company.trim();
      const key = cleanName.toLowerCase();
      if (!cleanName || existingKeys.has(key)) continue;
      existingKeys.add(key);
      created.push({
        id: `tc-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
        name: cleanName,
        careersUrl:
          job.jobUrl && /^https?:\/\//i.test(job.jobUrl) ? job.jobUrl : undefined,
        notes: job.notes?.trim() || undefined,
        enabled: true,
        lastCheckedAt: 'Pending pull',
        lastFoundCount: 0,
      });
    }

    const removedIds = new Set(untitled.map((j) => j.id));
    if (created.length > 0) {
      setTargetCompanies((prev) => [...created, ...prev]);
      persistCloud((uid) => createTargetCompaniesBatchInCloud(uid, created));
    }
    setJobs((prev) => prev.filter((j) => !removedIds.has(j.id)));
    setSelectedJobId((prev) => (prev && removedIds.has(prev) ? null : prev));
    persistCloud((uid) => deleteJobsBatchInCloud(uid, Array.from(removedIds)));

    pushToast(
      `Moved ${untitled.length} "Untitled Role" ${
        untitled.length === 1 ? 'row' : 'rows'
      } to your Target Companies Watchlist`,
      'View Watchlist',
      () => setActiveView('sources')
    );
  };

  // Live ATS Agent Runner (also checks Target Companies, enriches incomplete roles, and scans Gmail & Slack when connected)
  const executeAgentRun = async (
    targetSourceId?: string,
    overrides?: {
      sources?: JobSource[];
      searchPrompt?: string;
      gmailQuery?: string;
      slackChannels?: string[];
    }
  ) => {
    if (isAgentRunning) return;

    const activeSourceList = overrides?.sources ?? sources;
    const activePrompt = overrides?.searchPrompt ?? searchPrompt;

    const targetSources = targetSourceId
      ? activeSourceList
          .filter((s) => s.id === targetSourceId)
          .map((s) => ({ ...s, enabled: true }))
      : activeSourceList.filter((s) => s.enabled);

    const activeTargetCompanies = targetSourceId
      ? []
      : targetCompanies.filter((c) => c.enabled);
    const incompleteJobs = targetSourceId
      ? []
      : getIncompleteJobsForEnrichment(jobs);

    const hasGmailToken = !targetSourceId && Boolean(getGmailAccessToken());
    const hasSlackToken = !targetSourceId && Boolean(slackTokenRef.current);
    const hasServerWork =
      targetSources.length > 0 ||
      activeTargetCompanies.length > 0 ||
      incompleteJobs.length > 0;

    if (!hasServerWork && !hasGmailToken && !hasSlackToken) {
      pushToast(
        'Nothing to scan yet. Enable an ATS board, add Target Companies, or connect Gmail/Slack in Sources.'
      );
      return;
    }

    setIsAgentRunning(true);
    setRunningSourceId(targetSourceId ?? null);

    try {
      if (hasServerWork) {
        const response = await fetch('/api/agent/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sources: targetSources,
            targetCompanies: activeTargetCompanies,
            incompleteJobs,
            existingHashes: jobs.map((j) => j.urlHash),
            searchPrompt: activePrompt,
            rules: rules.map((r) => ({ text: r.text, active: r.active })),
            recentFeedback: feedbackHistory.slice(0, 15).map((f) => ({
              jobTitle: f.jobTitle,
              company: f.company,
              vote: f.vote,
              reason: f.reason,
            })),
            maxNewPerRun: targetSourceId ? 4 : 8,
          }),
        });

        const data = (await response.json()) as {
          newJobs?: JobRecord[];
          enrichedJobs?: JobEnrichmentPatch[];
          checkedCompanyIds?: { id: string; foundCount: number }[];
          runReport?: AgentRunReport;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error || `Agent run failed (${response.status})`);
        }

        applyCompletedAgentRun(
          Array.isArray(data.newJobs) ? data.newJobs : [],
          data.runReport,
          'manual',
          {
            enrichedJobs: data.enrichedJobs,
            checkedCompanyIds: data.checkedCompanyIds,
          }
        );
      }

      if (hasGmailToken) {
        await handleScanGmail(
          undefined,
          overrides?.gmailQuery ?? effectiveGmailQuery,
          activePrompt
        );
      }

      if (hasSlackToken) {
        await handleScanSlack(
          undefined,
          overrides?.slackChannels ?? intakeProfile.slackChannels,
          activePrompt
        );
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Agent run failed. Please try again.';
      pushToast(msg);
    } finally {
      setIsAgentRunning(false);
      setRunningSourceId(null);
    }
  };

  // Complete Onboarding Intake -> save profile, cadence, resumes & pull matching roles
  const handleCompleteIntake = async (params: {
    profile: UserIntakeProfile;
    selectedSourceUrls: string[];
    customSourceUrl?: string;
    autoScheduleEnabled: boolean;
    autoScheduleMinutes: number;
    triggerInitialPull: boolean;
  }) => {
    const compiledPrompt = compileIntakeToSearchPrompt(params.profile);
    const compiledGmailQuery = buildGmailQueryFromSenders(params.profile.gmailSenders);

    // Reconcile selected career boards + optional custom URL
    const selectedSet = new Set(params.selectedSourceUrls.map((u) => u.toLowerCase()));
    let nextSources = sources.map((s) => ({
      ...s,
      enabled: selectedSet.has(s.url.toLowerCase()),
    }));

    const existingUrlSet = new Set(nextSources.map((s) => s.url.toLowerCase()));
    for (const preset of VERIFIED_LIVE_PRESETS) {
      if (
        selectedSet.has(preset.url.toLowerCase()) &&
        !existingUrlSet.has(preset.url.toLowerCase())
      ) {
        nextSources = [
          ...nextSources,
          {
            id: `src-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            name: preset.name,
            url: preset.url,
            atsType: preset.atsType,
            cadenceHours: 4,
            enabled: true,
            lastCheckedAt: 'Pending first pull',
            totalFound: 0,
            lastNewCount: 0,
          },
        ];
        existingUrlSet.add(preset.url.toLowerCase());
      }
    }

    if (
      params.customSourceUrl &&
      !existingUrlSet.has(params.customSourceUrl.toLowerCase())
    ) {
      const cleanUrl = params.customSourceUrl.trim();
      const label = cleanUrl
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .split('/')[0];
      nextSources = [
        {
          id: `src-${Date.now()}`,
          name: label || 'Custom Careers',
          url: cleanUrl,
          atsType: detectAtsType(cleanUrl),
          cadenceHours: 4,
          enabled: true,
          lastCheckedAt: 'Pending first pull',
          totalFound: 0,
          lastNewCount: 0,
        },
        ...nextSources,
      ];
    }

    setIntakeProfile(params.profile);
    setSearchPrompt(compiledPrompt);
    setGmailQueryOverride('');
    setSources(nextSources);
    setAutoScheduleEnabled(params.autoScheduleEnabled);
    setAutoScheduleMinutes(params.autoScheduleMinutes);
    setIntakeOpen(false);

    // Apply chosen dashboard update frequency immediately on the server scheduler
    void fetch('/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: params.autoScheduleEnabled,
        intervalMinutes: params.autoScheduleMinutes,
        context: {
          sources: nextSources,
          targetCompanies,
          incompleteJobs: getIncompleteJobsForEnrichment(jobs),
          existingHashes: jobs.map((j) => j.urlHash),
          searchPrompt: compiledPrompt,
          rules: rules.map((r) => ({ text: r.text, active: r.active })),
          recentFeedback: feedbackHistory.slice(0, 15).map((f) => ({
            jobTitle: f.jobTitle,
            company: f.company,
            vote: f.vote,
            reason: f.reason,
          })),
        },
      }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((state: ServerScheduleState | null) => {
        if (state) setNextScheduledRunAt(state.nextRunAt);
      })
      .catch(() => {
        // Non-blocking
      });

    // Persist account profile + workspace to Firestore if signed in
    const uid = authUidRef.current;
    if (uid) {
      try {
        const wasNewProfile = !cloudProfileExistsRef.current;
        await saveUserProfileToCloud(uid, {
          profile: { ...params.profile, uid },
          searchPrompt: compiledPrompt,
          gmailQuery: compiledGmailQuery,
          autoScheduleEnabled: params.autoScheduleEnabled,
          autoScheduleMinutes: params.autoScheduleMinutes,
        });
        cloudProfileExistsRef.current = true;

        if (wasNewProfile) {
          // Seed initial sources, target companies, rules, uploaded resumes, and jobs into user's cloud DB
          await Promise.all([
            ...nextSources.map((s) => createSourceInCloud(uid, s)),
            ...rules.map((r) => createRuleInCloud(uid, r)),
            ...resumes.map((r) => upsertRoleResumeInCloud(uid, r)),
            createTargetCompaniesBatchInCloud(uid, targetCompanies),
            createJobsInCloud(uid, jobs),
          ]);
        } else {
          await Promise.all([
            ...nextSources.map((s) => createSourceInCloud(uid, s)),
            ...resumes.map((r) => upsertRoleResumeInCloud(uid, r)),
            createTargetCompaniesBatchInCloud(uid, targetCompanies),
          ]);
        }
      } catch (err) {
        console.error('Failed saving intake to Firestore:', err);
      }
    }

    pushToast('Saved intake profile, cadence, and channel settings');

    if (params.triggerInitialPull) {
      void executeAgentRun(undefined, {
        sources: nextSources,
        searchPrompt: compiledPrompt,
        gmailQuery: compiledGmailQuery,
        slackChannels: params.profile.slackChannels,
      });
    }
  };

  const handleRunAgent = () => void executeAgentRun();
  const handleRunSingleSource = (sourceId: string) => void executeAgentRun(sourceId);

  // Server-authoritative scheduler updates
  const updateServerSchedule = async (enabled: boolean, intervalMinutes: number) => {
    setAutoScheduleEnabled(enabled);
    setAutoScheduleMinutes(intervalMinutes);
    persistCloud((uid) =>
      updateWorkspaceSettingsInCloud(uid, {
        autoScheduleEnabled: enabled,
        autoScheduleMinutes: intervalMinutes,
      })
    );
    try {
      const res = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          intervalMinutes,
          context: {
            sources,
            targetCompanies,
            incompleteJobs: getIncompleteJobsForEnrichment(jobs),
            existingHashes: jobs.map((j) => j.urlHash),
            searchPrompt,
            rules: rules.map((r) => ({ text: r.text, active: r.active })),
            recentFeedback: feedbackHistory.slice(0, 15).map((f) => ({
              jobTitle: f.jobTitle,
              company: f.company,
              vote: f.vote,
              reason: f.reason,
            })),
          },
        }),
      });
      if (res.ok) {
        const state = (await res.json()) as ServerScheduleState;
        setNextScheduledRunAt(state.nextRunAt);
        pushToast(
          state.enabled
            ? `Scheduled agent runs enabled (every ${
                intervalMinutes >= 60
                  ? `${intervalMinutes / 60}h`
                  : `${intervalMinutes}m`
              })`
            : 'Scheduled server runs paused'
        );
      }
    } catch {
      pushToast('Failed to update server schedule.');
    }
  };

  // Sources handlers
  const handleAddSource = (name: string, url: string, cadenceHours: number) => {
    const newSource: JobSource = {
      id: `src-${Date.now()}`,
      name,
      url,
      atsType: detectAtsType(url),
      cadenceHours,
      enabled: true,
      lastCheckedAt: 'Pending first pull',
      totalFound: 0,
      lastNewCount: 0,
    };
    setSources((prev) => [newSource, ...prev]);
    persistCloud((uid) => createSourceInCloud(uid, newSource));
    pushToast(`Added "${name}" (${newSource.atsType})`);
  };

  const handleToggleSource = (sourceId: string) => {
    const target = sources.find((s) => s.id === sourceId);
    if (!target) return;
    const nextEnabled = !target.enabled;
    setSources((prev) =>
      prev.map((s) => (s.id === sourceId ? { ...s, enabled: nextEnabled } : s))
    );
    persistCloud((uid) =>
      updateSourceConfigInCloud(uid, sourceId, { enabled: nextEnabled })
    );
  };

  const handleUpdateCadence = (sourceId: string, cadenceHours: number) => {
    setSources((prev) =>
      prev.map((s) => (s.id === sourceId ? { ...s, cadenceHours } : s))
    );
    persistCloud((uid) =>
      updateSourceConfigInCloud(uid, sourceId, { cadenceHours })
    );
  };

  const handleDeleteSource = (sourceId: string) => {
    setSources((prev) => prev.filter((s) => s.id !== sourceId));
    persistCloud((uid) => deleteSourceInCloud(uid, sourceId));
  };

  // Calendar event handlers
  const handleAddEvent = (event: Omit<JobEvent, 'id'>) => {
    const created: JobEvent = { ...event, id: `evt-${Date.now()}` };
    setEvents((prev) => [...prev, created]);
    persistCloud((uid) => createEventInCloud(uid, created));
    pushToast(`Scheduled "${created.label}" on ${created.date}`);
  };

  const handleDeleteEvent = (eventId: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== eventId));
    persistCloud((uid) => deleteEventInCloud(uid, eventId));
  };

  // Criteria & Rules handlers
  const handleSaveSearchPrompt = (prompt: string) => {
    setSearchPrompt(prompt);
    persistCloud((uid) => updateWorkspaceSettingsInCloud(uid, { searchPrompt: prompt }));
  };

  const handleAddRule = (text: string) => {
    const rule: LearnedRule = {
      id: `rule-${Date.now()}`,
      text,
      origin: 'manual',
      active: true,
    };
    setRules((prev) => [...prev, rule]);
    persistCloud((uid) => createRuleInCloud(uid, rule));
  };

  const handleToggleRule = (ruleId: string) => {
    const target = rules.find((r) => r.id === ruleId);
    if (!target) return;
    const nextActive = !target.active;
    setRules((prev) =>
      prev.map((r) => (r.id === ruleId ? { ...r, active: nextActive } : r))
    );
    persistCloud((uid) => updateRuleInCloud(uid, ruleId, { active: nextActive }));
  };

  const handleDeleteRule = (ruleId: string) => {
    setRules((prev) => prev.filter((r) => r.id !== ruleId));
    persistCloud((uid) => deleteRuleInCloud(uid, ruleId));
  };

  const handleAcceptSuggestion = (suggestion: RuleSuggestion) => {
    const created: LearnedRule = {
      id: `rule-${Date.now()}`,
      text: suggestion.proposedRule,
      origin: 'synthesized',
      active: true,
    };
    setRules((prev) => [...prev, created]);
    persistCloud((uid) => createRuleInCloud(uid, created));
    pushToast('Added learned filter rule to agent criteria');
  };

  const handleDismissSuggestion = (suggestionId: string) => {
    const target = ruleSuggestions.find((s) => s.id === suggestionId);
    if (target) {
      setDismissedReasons((prev) => [...prev, target.reasonTrigger]);
    }
  };

  const handleAcceptAiSuggestion = (suggestion: AiRuleSuggestion) => {
    const exists = rules.some(
      (r) => r.text.toLowerCase() === suggestion.proposedRule.toLowerCase()
    );
    if (!exists) {
      const created: LearnedRule = {
        id: `rule-${Date.now()}`,
        text: suggestion.proposedRule,
        origin: 'synthesized',
        active: true,
      };
      setRules((prev) => [...prev, created]);
      persistCloud((uid) => createRuleInCloud(uid, created));
    }
    setAiSynthesis((prev) =>
      prev
        ? {
            ...prev,
            suggestions: prev.suggestions.map((s) =>
              s.id === suggestion.id ? { ...s, dismissed: true } : s
            ),
          }
        : prev
    );
    pushToast('Added synthesized rule — click Re-score to refresh rankings');
  };

  const handleDismissAiSuggestion = (suggestionId: string) => {
    setAiSynthesis((prev) =>
      prev
        ? {
            ...prev,
            suggestions: prev.suggestions.map((s) =>
              s.id === suggestionId ? { ...s, dismissed: true } : s
            ),
          }
        : prev
    );
  };

  // Apply structured workspace actions returned by the Gemini chatbot
  const applyChatActions = (actions: ChatAction[]): string[] => {
    const summaries: string[] = [];

    for (const action of actions) {
      if (action.type === 'update_criteria_prompt' && action.prompt?.trim()) {
        handleSaveSearchPrompt(action.prompt.trim());
        summaries.push('Updated target search criteria');
      } else if (action.type === 'add_rule' && action.ruleText?.trim()) {
        const text = action.ruleText.trim();
        if (!rules.some((r) => r.text.toLowerCase() === text.toLowerCase())) {
          const created: LearnedRule = {
            id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            text,
            origin: 'manual',
            active: true,
          };
          setRules((prev) => [...prev, created]);
          persistCloud((uid) => createRuleInCloud(uid, created));
        }
        summaries.push(`Added filter rule: "${text}"`);
      } else if (action.type === 'remove_rule' && action.ruleId) {
        const existing = rules.find((r) => r.id === action.ruleId);
        if (existing) {
          handleDeleteRule(action.ruleId);
          summaries.push(`Removed rule: "${existing.text}"`);
        }
      } else if (
        action.type === 'toggle_rule' &&
        action.ruleId &&
        typeof action.active === 'boolean'
      ) {
        const existing = rules.find((r) => r.id === action.ruleId);
        if (existing) {
          setRules((prev) =>
            prev.map((r) =>
              r.id === action.ruleId ? { ...r, active: action.active! } : r
            )
          );
          persistCloud((uid) =>
            updateRuleInCloud(uid, action.ruleId!, { active: action.active! })
          );
          summaries.push(
            `${action.active ? 'Enabled' : 'Paused'} rule: "${existing.text}"`
          );
        }
      } else if (action.type === 'log_feedback' && action.jobId && action.vote) {
        const target = jobs.find((j) => j.id === action.jobId);
        if (target) {
          if (action.vote === 'up') {
            handleThumbsUp(target.id);
            summaries.push(`Saved ${target.title} at ${target.company}`);
          } else if (action.vote === 'down') {
            const validReason =
              action.reason && VALID_REASONS.includes(action.reason)
                ? action.reason
                : undefined;
            handleThumbsDown(target.id, validReason);
            summaries.push(
              validReason
                ? `Archived ${target.title} at ${target.company} (${validReason})`
                : `Archived ${target.title} at ${target.company}`
            );
          }
        }
      } else if (
        action.type === 'move_job_stage' &&
        action.jobId &&
        action.stage &&
        VALID_STAGES.includes(action.stage)
      ) {
        const target = jobs.find((j) => j.id === action.jobId);
        if (target) {
          handleMoveStage(target.id, action.stage);
          summaries.push(
            `Moved ${target.title} (${target.company}) to ${action.stage}`
          );
        }
      }
    }

    return summaries;
  };

  const handleSendChatMessage = async (text: string) => {
    const nowTime = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const userMsg: ChatMessage = {
      id: `msg-u-${Date.now()}`,
      role: 'user',
      text,
      timestamp: nowTime,
    };

    const priorHistory = chatMessages.map((m) => ({
      role: m.role,
      text: m.text,
    }));

    setChatMessages((prev) => [...prev, userMsg]);
    setIsChatSending(true);
    setChatError(null);

    const workspaceContext: WorkspaceChatContext = {
      searchPrompt,
      rules,
      jobs: jobs.map((j) => ({
        id: j.id,
        title: j.title,
        company: j.company,
        stage: j.stage,
        isNew: j.isNew,
        matchScore: j.matchScore,
        salaryLabel: j.salaryLabel,
        locationType: j.locationType,
        location: j.location,
      })),
      recentFeedback: feedbackHistory.slice(0, 12).map((f) => ({
        jobTitle: f.jobTitle,
        company: f.company,
        vote: f.vote,
        reason: f.reason,
      })),
    };

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: priorHistory,
          workspaceContext,
        }),
      });

      const payload = (await response.json()) as Partial<ChatApiResponse> & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || `Request failed (${response.status})`);
      }

      const appliedSummaries = applyChatActions(
        Array.isArray(payload.actions) ? payload.actions : []
      );

      const replyTime = new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });

      const assistantMsg: ChatMessage = {
        id: `msg-m-${Date.now()}`,
        role: 'model',
        text: payload.reply || 'Done.',
        timestamp: replyTime,
        appliedSummaries:
          appliedSummaries.length > 0 ? appliedSummaries : undefined,
      };

      setChatMessages((prev) => [...prev, assistantMsg]);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Could not reach the assistant. Please try again.';
      setChatError(msg);
    } finally {
      setIsChatSending(false);
    }
  };

  const handleResetChat = () => {
    setChatMessages([]);
    setChatError(null);
  };

  const connectedChannelCount =
    sources.filter((s) => s.enabled).length +
    (targetCompanies.some((c) => c.enabled) ? 1 : 0) +
    (gmailConnected ? 1 : 0) +
    (slackConnected ? 1 : 0);

  return (
    <div className="min-h-screen flex bg-[#FAFAFA] text-zinc-950">
      <Sidebar
        activeView={activeView}
        onSelectView={(view) => setActiveView(view)}
        newCount={newCount}
        activePipelineCount={activePipelineCount}
        sourceCount={connectedChannelCount}
        resumeCount={resumes.length}
        pendingRuleSuggestions={pendingSuggestionCount}
        lastRunLabel={lastRunLabel}
        chatOpen={chatOpen}
        chatMessageCount={chatMessages.length}
        onOpenChat={() => setChatOpen(true)}
        onOpenIntake={openIntakeModal}
        onOpenImport={() => openImportModal('roles')}
        userEmail={userEmail}
        userDisplayName={userDisplayName}
        onSignIn={openIntakeModal}
        onSignOut={() => void handleDisconnectAccount()}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar
          activeView={activeView}
          isAgentRunning={
            isAgentRunning || isGmailScanning || isSlackScanning || isWhatsAppScanning
          }
          chatOpen={chatOpen}
          chatMessageCount={chatMessages.length}
          onToggleChat={() => setChatOpen((prev) => !prev)}
          onOpenImport={() => openImportModal('roles')}
          onRunAgent={handleRunAgent}
          onOpenMobileMenu={() => setMobileNavOpen(true)}
        />

        <main className="flex-1 p-5 sm:p-6 lg:p-8 max-w-[1600px] w-full">
          {activeView === 'table' && (
            <TableView
              key={tableTabKey}
              jobs={jobs}
              sources={sources}
              isAgentRunning={
                isAgentRunning || isGmailScanning || isSlackScanning || isWhatsAppScanning
              }
              isRescoring={isRescoring}
              onSelectJob={(job) => setSelectedJobId(job.id)}
              onThumbsUp={handleThumbsUp}
              onThumbsDown={handleThumbsDown}
              onRestoreJob={handleRestoreJob}
              onDeleteJob={handleDeleteJob}
              onMoveUntitledToTargetCompanies={handleMoveUntitledToTargetCompanies}
              onRunAgent={handleRunAgent}
              onRescoreActiveJobs={handleRescoreActiveJobs}
              initialTab={preferredTableTab}
            />
          )}

          {activeView === 'kanban' && (
            <KanbanView
              jobs={jobs}
              onSelectJob={(job) => setSelectedJobId(job.id)}
              onMoveStage={handleMoveStage}
              onThumbsUp={handleThumbsUp}
              onThumbsDown={handleThumbsDown}
              onDeleteJob={handleDeleteJob}
            />
          )}

          {activeView === 'calendar' && (
            <CalendarView
              jobs={jobs}
              events={events}
              onSelectJob={(job) => setSelectedJobId(job.id)}
              onAddEvent={handleAddEvent}
              onDeleteEvent={handleDeleteEvent}
            />
          )}

          {activeView === 'sources' && (
            <SourcesView
              sources={sources}
              runHistory={runHistory}
              importHistory={importHistory}
              isAgentRunning={isAgentRunning}
              runningSourceId={runningSourceId}
              autoScheduleEnabled={autoScheduleEnabled}
              autoScheduleMinutes={autoScheduleMinutes}
              nextScheduledRunAt={nextScheduledRunAt}
              gmailUserEmail={userEmail}
              gmailConnected={gmailConnected}
              gmailError={gmailError}
              isGmailSigningIn={isGmailSigningIn}
              isGmailScanning={isGmailScanning}
              gmailSenders={intakeProfile.gmailSenders}
              gmailQueryOverride={gmailQueryOverride}
              gmailLastScanLabel={gmailLastScanLabel}
              onChangeGmailSenders={handleChangeGmailSenders}
              onChangeGmailQueryOverride={handleChangeGmailQueryOverride}
              onConnectGmail={() => void handleConnectGmail(true)}
              onDisconnectGmail={() => void handleDisconnectAccount()}
              onScanGmail={() => void handleScanGmail()}
              slackConnected={slackConnected}
              slackTeamName={slackTeamName}
              slackConfigured={slackAuthConfig.configured}
              slackHasClientId={slackAuthConfig.hasClientId}
              slackHasClientSecret={slackAuthConfig.hasClientSecret}
              slackRedirectUri={slackAuthConfig.redirectUri}
              slackDevRedirectUri={slackAuthConfig.devRedirectUri}
              slackSharedRedirectUri={slackAuthConfig.sharedRedirectUri}
              slackError={slackError}
              slackChannels={intakeProfile.slackChannels}
              isSlackScanning={isSlackScanning}
              onChangeSlackChannels={handleChangeSlackChannels}
              onConnectSlack={handleConnectSlack}
              onDisconnectSlack={handleDisconnectSlack}
              onScanSlack={() => void handleScanSlack()}
              whatsappGroups={intakeProfile.whatsappGroups}
              isWhatsAppScanning={isWhatsAppScanning}
              onChangeWhatsAppGroups={handleChangeWhatsAppGroups}
              onScanWhatsApp={async (rawText, groupName) => {
                await handleScanWhatsApp(rawText, groupName);
              }}
              onOpenImportModal={() => openImportModal('roles')}
              targetCompanies={targetCompanies}
              untitledJobCount={untitledJobCount}
              onAddTargetCompany={handleAddTargetCompany}
              onToggleTargetCompany={handleToggleTargetCompany}
              onDeleteTargetCompany={handleDeleteTargetCompany}
              onOpenTargetCompaniesImport={() => openImportModal('companies')}
              onMoveUntitledToTargetCompanies={handleMoveUntitledToTargetCompanies}
              onToggleAutoSchedule={() =>
                void updateServerSchedule(!autoScheduleEnabled, autoScheduleMinutes)
              }
              onChangeAutoScheduleMinutes={(mins) =>
                void updateServerSchedule(autoScheduleEnabled, mins)
              }
              onAddSource={handleAddSource}
              onToggleSource={handleToggleSource}
              onUpdateCadence={handleUpdateCadence}
              onDeleteSource={handleDeleteSource}
              onRunSingleSource={handleRunSingleSource}
            />
          )}

          {activeView === 'resumes' && (
            <ResumesView
              roleTypesFromIntake={intakeProfile.roleTypes}
              resumes={resumes}
              careerExperiences={intakeProfile.careerExperiences ?? []}
              careerContextNotes={intakeProfile.careerContextNotes ?? ''}
              onSaveResume={handleSaveResume}
              onDeleteResume={handleDeleteResume}
              onSaveCareerExperiences={handleSaveCareerExperiences}
              onSaveCareerContextNotes={handleSaveCareerContextNotes}
            />
          )}

          {activeView === 'criteria' && (
            <CriteriaView
              searchPrompt={searchPrompt}
              onSavePrompt={handleSaveSearchPrompt}
              rules={rules}
              onAddRule={handleAddRule}
              onToggleRule={handleToggleRule}
              onDeleteRule={handleDeleteRule}
              suggestions={ruleSuggestions}
              onAcceptSuggestion={handleAcceptSuggestion}
              onDismissSuggestion={handleDismissSuggestion}
              aiSynthesis={aiSynthesis}
              isSynthesizing={isSynthesizing}
              onRunSynthesis={() => void runPreferenceSynthesis(false)}
              onAcceptAiSuggestion={handleAcceptAiSuggestion}
              onDismissAiSuggestion={handleDismissAiSuggestion}
              isRescoring={isRescoring}
              onRescoreActiveJobs={handleRescoreActiveJobs}
              feedbackHistory={feedbackHistory}
              onOpenChat={() => setChatOpen(true)}
            />
          )}

          {activeView === 'schema' && (
            <SchemaView
              isSignedIn={Boolean(authUid)}
              jobs={jobs}
              counts={{
                jobs: jobs.length,
                sources: sources.length,
                targetCompanies: targetCompanies.length,
                resumes: resumes.length,
                rules: rules.length,
                events: events.length,
                feedback: feedbackHistory.length,
                imports: importHistory.length,
              }}
            />
          )}
        </main>
      </div>

      {/* Onboarding & Account Intake Modal */}
      <IntakeModal
        key={intakeOpenCounter}
        open={intakeOpen}
        isFirstRun={!intakeProfile.onboardingCompleted}
        isSignedIn={Boolean(authUid)}
        userEmail={userEmail}
        userDisplayName={userDisplayName}
        isAuthLoading={isGmailSigningIn}
        gmailConnected={gmailConnected}
        gmailError={gmailError}
        slackConnected={slackConnected}
        slackTeamName={slackTeamName}
        slackConfigured={slackAuthConfig.configured}
        slackHasClientId={slackAuthConfig.hasClientId}
        slackHasClientSecret={slackAuthConfig.hasClientSecret}
        slackRedirectUri={slackAuthConfig.redirectUri}
        slackError={slackError}
        initialProfile={intakeProfile}
        initialResumes={resumes}
        initialAutoScheduleEnabled={autoScheduleEnabled}
        initialAutoScheduleMinutes={autoScheduleMinutes}
        sources={sources}
        importedCountInSession={importedCountInSession}
        targetCompaniesCount={targetCompanies.length}
        onSignInAccount={handleSignInAccount}
        onConnectGmail={() => handleConnectGmail(false)}
        onConnectSlack={handleConnectSlack}
        onSaveResume={handleSaveResume}
        onDeleteResume={handleDeleteResume}
        onOpenImportModal={() => openImportModal('roles')}
        onOpenTargetCompaniesImport={() => openImportModal('companies')}
        onUploadWhatsAppInIntake={handleScanWhatsApp}
        onClose={() => setIntakeOpen(false)}
        onCompleteIntake={handleCompleteIntake}
      />

      {/* CSV / JSON Upload & Column Mapper Modal */}
      <ImportRolesModal
        open={importModalOpen}
        initialMode={importModalMode}
        existingHashes={jobs.map((j) => j.urlHash)}
        onClose={() => setImportModalOpen(false)}
        onImportJobs={handleImportJobs}
        onImportTargetCompanies={handleImportTargetCompanies}
      />

      {/* Job Detail Slide-over Drawer */}
      <JobDetailDrawer
        job={selectedJob}
        events={events}
        resumes={resumes}
        careerExperiences={intakeProfile.careerExperiences ?? []}
        careerContextNotes={intakeProfile.careerContextNotes ?? ''}
        tailoredResult={selectedJob ? tailoredByJobId[selectedJob.id] ?? null : null}
        onSaveResume={handleSaveResume}
        onOpenResumesView={() => setActiveView('resumes')}
        onSaveTailoredResult={handleSaveTailoredResult}
        onClose={() => setSelectedJobId(null)}
        onMoveStage={handleMoveStage}
        onUpdateNotes={handleUpdateNotes}
        onUpdateFullDescription={handleUpdateFullDescription}
        onFetchFullDescription={handleFetchFullDescription}
        onUpdateNetworkingContacts={handleUpdateNetworkingContacts}
        onThumbsUp={handleThumbsUp}
        onThumbsDown={handleThumbsDown}
        onRestoreJob={handleRestoreJob}
        onDeleteJob={handleDeleteJob}
        onAddEvent={handleAddEvent}
      />

      {/* Multi-turn Gemini Search & Feedback Assistant Drawer */}
      <ChatDrawer
        open={chatOpen}
        messages={chatMessages}
        isSending={isChatSending}
        error={chatError}
        onClose={() => setChatOpen(false)}
        onSendMessage={handleSendChatMessage}
        onResetChat={handleResetChat}
      />

      {/* Subtle Live Auto-Update / Triage Toast Stack */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-[calc(100vw-2.5rem)]"
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className="bg-zinc-950 text-zinc-100 border border-zinc-800 rounded-lg shadow-lg px-4 py-3 flex items-center justify-between gap-3 text-xs"
            >
              <span className="leading-snug">{toast.message}</span>
              <div className="flex items-center gap-2 shrink-0">
                {toast.actionLabel && toast.onAction && (
                  <button
                    type="button"
                    onClick={() => {
                      toast.onAction?.();
                      dismissToast(toast.id);
                    }}
                    className="font-medium text-blue-400 hover:text-blue-300 whitespace-nowrap cursor-pointer"
                  >
                    {toast.actionLabel}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => dismissToast(toast.id)}
                  aria-label="Dismiss notification"
                  className="text-zinc-500 hover:text-zinc-200 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
