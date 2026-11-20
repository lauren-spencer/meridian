import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { getLocalTodayIso } from './dateTime';
import { buildGmailQueryFromSenders } from './intakeHelpers';
import type {
  AtsType,
  CareerExperienceItem,
  CoverLetterSample,
  DislikeReason,
  FeedbackEntry,
  ImportBatchRecord,
  JobEvent,
  JobEnrichmentPatch,
  JobPriority,
  JobRecord,
  JobSource,
  LearnedRule,
  LocationType,
  NetworkingChannel,
  NetworkingContact,
  NetworkingContactSentiment,
  NetworkingContactStatus,
  PipelineStage,
  RoleResume,
  TargetCompany,
  UserIntakeProfile,
} from '../types/job';

// Defensive sanitization matching firebase-blueprint.json & firestore.rules verbatim
function safeId(raw: string, fallbackPrefix = 'id'): string {
  const cleaned = raw
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
  return cleaned.length > 0
    ? cleaned
    : `${fallbackPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function clampStr(val: unknown, maxLen: number, fallback = ''): string {
  if (typeof val !== 'string') return fallback.slice(0, maxLen);
  return val.slice(0, maxLen);
}

function clampStringList(val: unknown, maxItems: number, maxItemLen = 120): string[] {
  if (!Array.isArray(val)) return [];
  const out: string[] = [];
  for (const item of val) {
    if (typeof item === 'string') {
      const trimmed = item.trim().slice(0, maxItemLen);
      if (trimmed.length > 0) {
        out.push(trimmed);
      }
    }
    if (out.length >= maxItems) break;
  }
  return out;
}

function clampScore(n: unknown): number {
  const num = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 70;
  return Math.max(0, Math.min(100, num));
}

const VALID_STAGES: PipelineStage[] = [
  'inbox',
  'saved',
  'applied',
  'interviewing',
  'offer',
  'archived',
];

const VALID_LOC_TYPES: LocationType[] = ['Remote', 'Hybrid', 'Onsite'];

const VALID_ATS: AtsType[] = [
  'Greenhouse',
  'Lever',
  'Ashby',
  'Custom Markdown',
  'RSS Feed',
  'Gmail',
  'Slack',
  'WhatsApp',
  'CSV Import',
  'Target Company',
];

function validStage(s: unknown): PipelineStage {
  return VALID_STAGES.includes(s as PipelineStage) ? (s as PipelineStage) : 'inbox';
}

function validLocType(l: unknown): LocationType {
  return VALID_LOC_TYPES.includes(l as LocationType) ? (l as LocationType) : 'Remote';
}

function validAts(a: unknown): AtsType {
  return VALID_ATS.includes(a as AtsType) ? (a as AtsType) : 'Custom Markdown';
}

const VALID_PRIORITIES: JobPriority[] = ['asap', 'high', 'medium', 'low'];

function validPriority(p: unknown): JobPriority | undefined {
  return VALID_PRIORITIES.includes(p as JobPriority) ? (p as JobPriority) : undefined;
}

const VALID_NET_CHANNELS: NetworkingChannel[] = [
  'LinkedIn',
  'Email',
  'Slack',
  'Warm Intro',
  'Coffee Chat',
  'Other',
];

const VALID_NET_STATUSES: NetworkingContactStatus[] = [
  'To Reach Out',
  'Message Sent',
  'Replied',
  'Coffee Chat Scheduled',
  'Referred',
];

const VALID_NET_SENTIMENTS: NetworkingContactSentiment[] = [
  'Champion',
  'Warm',
  'Neutral',
  'Cold',
  'Unresponsive',
];

function sanitizeNetworkingContacts(raw: unknown): NetworkingContact[] {
  if (!Array.isArray(raw)) return [];
  const out: NetworkingContact[] = [];
  for (const item of raw.slice(0, 30)) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const name = clampStr(obj.name, 120).trim();
    if (!name) continue;
    const contact: NetworkingContact = {
      id: safeId(typeof obj.id === 'string' ? obj.id : '', 'net'),
      name,
      role: clampStr(obj.role, 120),
      channel: VALID_NET_CHANNELS.includes(obj.channel as NetworkingChannel)
        ? (obj.channel as NetworkingChannel)
        : 'LinkedIn',
      status: VALID_NET_STATUSES.includes(obj.status as NetworkingContactStatus)
        ? (obj.status as NetworkingContactStatus)
        : 'To Reach Out',
    };
    if (VALID_NET_SENTIMENTS.includes(obj.sentiment as NetworkingContactSentiment)) {
      contact.sentiment = obj.sentiment as NetworkingContactSentiment;
    }
    if (typeof obj.lastContactDate === 'string' && obj.lastContactDate.trim()) {
      contact.lastContactDate = clampStr(obj.lastContactDate.trim(), 20);
    }
    if (typeof obj.followUpDate === 'string' && obj.followUpDate.trim()) {
      contact.followUpDate = clampStr(obj.followUpDate.trim(), 20);
    }
    if (typeof obj.profileUrl === 'string' && obj.profileUrl.trim()) {
      contact.profileUrl = clampStr(obj.profileUrl.trim(), 500);
    }
    if (typeof obj.notes === 'string' && obj.notes.trim()) {
      contact.notes = clampStr(obj.notes.trim(), 500);
    }
    out.push(contact);
  }
  return out;
}

function sanitizeCareerExperiences(raw: unknown): CareerExperienceItem[] {
  if (!Array.isArray(raw)) return [];
  const out: CareerExperienceItem[] = [];
  for (const item of raw.slice(0, 30)) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const title = clampStr(obj.title, 160).trim();
    const org = clampStr(obj.organization, 160).trim();
    const details = clampStr(obj.details, 2500).trim();
    if (!title && !org && !details) continue;
    out.push({
      id: safeId(typeof obj.id === 'string' ? obj.id : '', 'exp'),
      title: title || 'Additional Role / Project',
      organization: org || 'Independent / Additional',
      dates: clampStr(obj.dates, 60).trim(),
      onResume: Boolean(obj.onResume),
      details,
    });
  }
  return out;
}

export interface LoadedCloudWorkspace {
  profileExists: boolean;
  profile: UserIntakeProfile | null;
  searchPrompt: string | null;
  gmailQuery: string | null;
  autoScheduleEnabled: boolean;
  autoScheduleMinutes: number;
  jobs: JobRecord[];
  sources: JobSource[];
  rules: LearnedRule[];
  feedbackHistory: FeedbackEntry[];
  events: JobEvent[];
  imports: ImportBatchRecord[];
  resumes: RoleResume[];
  coverLetterSamples: CoverLetterSample[];
  targetCompanies: TargetCompany[];
  dismissedDuplicatePairs: string[];
}

export async function loadUserWorkspace(uid: string): Promise<LoadedCloudWorkspace> {
  const userPath = `users/${uid}`;
  let profileSnap;
  try {
    profileSnap = await getDoc(doc(db, 'users', uid));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }

  if (!profileSnap.exists()) {
    return {
      profileExists: false,
      profile: null,
      searchPrompt: null,
      gmailQuery: null,
      autoScheduleEnabled: false,
      autoScheduleMinutes: 240,
      jobs: [],
      sources: [],
      rules: [],
      feedbackHistory: [],
      events: [],
      imports: [],
      resumes: [],
      coverLetterSamples: [],
      targetCompanies: [],
      dismissedDuplicatePairs: [],
    };
  }

  const p = profileSnap.data();
  const profile: UserIntakeProfile = {
    uid,
    email: clampStr(p.email, 254),
    displayName: clampStr(p.displayName, 120),
    onboardingCompleted: Boolean(p.onboardingCompleted),
    roleTypes: clampStringList(p.roleTypes, 20),
    locations: clampStringList(p.locations, 20),
    workModes: clampStringList(p.workModes, 5).filter((m): m is LocationType =>
      VALID_LOC_TYPES.includes(m as LocationType)
    ),
    keywords: clampStringList(p.keywords, 30),
    employmentTypes: clampStringList(p.employmentTypes, 6),
    gmailSenders: clampStringList(p.gmailSenders, 30),
    slackChannels: clampStringList(p.slackChannels, 20),
    whatsappGroups: clampStringList(p.whatsappGroups, 20),
    careerContextNotes:
      typeof p.careerContextNotes === 'string'
        ? clampStr(p.careerContextNotes, 15000)
        : '',
    careerExperiences: sanitizeCareerExperiences(p.careerExperiences),
  };

  const fetchSubcollection = async (name: string) => {
    const subPath = `users/${uid}/${name}`;
    try {
      const q = query(collection(db, 'users', uid, name), where('ownerId', '==', uid));
      const snap = await getDocs(q);
      return snap.docs.map((d) => d.data());
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, subPath);
    }
  };

  const [
    rawJobs,
    rawSources,
    rawRules,
    rawFeedback,
    rawEvents,
    rawImports,
    rawResumes,
    rawCoverLetterSamples,
    rawTargetCompanies,
  ] = await Promise.all([
    fetchSubcollection('jobs'),
    fetchSubcollection('sources'),
    fetchSubcollection('rules'),
    fetchSubcollection('feedback'),
    fetchSubcollection('events'),
    fetchSubcollection('imports'),
    fetchSubcollection('resumes'),
    fetchSubcollection('coverLetterSamples'),
    fetchSubcollection('targetCompanies'),
  ]);

  const jobs: JobRecord[] = rawJobs.map((j) => ({
    id: String(j.id),
    urlHash: clampStr(j.urlHash, 128),
    title: clampStr(j.title, 200),
    company: clampStr(j.company, 160),
    companyDomain: clampStr(j.companyDomain, 160),
    stage: validStage(j.stage),
    isNew: Boolean(j.isNew),
    matchScore: clampScore(j.matchScore),
    previousMatchScore:
      typeof j.previousMatchScore === 'number' ? clampScore(j.previousMatchScore) : undefined,
    matchReason: clampStr(j.matchReason, 600),
    salaryMin: typeof j.salaryMin === 'number' ? j.salaryMin : null,
    salaryMax: typeof j.salaryMax === 'number' ? j.salaryMax : null,
    salaryLabel: clampStr(j.salaryLabel, 80, 'Not listed'),
    location: clampStr(j.location, 160),
    locationType: validLocType(j.locationType),
    employmentType: typeof j.employmentType === 'string' ? j.employmentType : undefined,
    isMbaRole:
      typeof j.isMbaRole === 'boolean'
        ? j.isMbaRole
        : /\bmba\b/i.test(String(j.title || '')),
    priority: validPriority(j.priority),
    sourceId: clampStr(j.sourceId, 128),
    sourceName: clampStr(j.sourceName, 160),
    atsType: validAts(j.atsType),
    jobUrl: clampStr(j.jobUrl, 1000),
    discoveredAt: clampStr(j.discoveredAt, 32),
    discoveredTime: clampStr(j.discoveredTime, 32),
    deadlineAt: typeof j.deadlineAt === 'string' ? j.deadlineAt : null,
    skills: clampStringList(j.skills, 25),
    summary: clampStr(j.summary, 2000),
    fullDescription:
      typeof j.fullDescription === 'string' && j.fullDescription.trim()
        ? clampStr(j.fullDescription, 16000)
        : undefined,
    networkingContacts: sanitizeNetworkingContacts(j.networkingContacts),
    notes: clampStr(j.notes, 4000),
    feedback: j.feedback === 'up' || j.feedback === 'down' ? j.feedback : null,
    dislikeReason:
      typeof j.dislikeReason === 'string'
        ? (j.dislikeReason as DislikeReason)
        : undefined,
  }));

  const sources: JobSource[] = rawSources.map((s) => ({
    id: String(s.id),
    name: clampStr(s.name, 160),
    url: clampStr(s.url, 1000),
    atsType: validAts(s.atsType),
    cadenceHours: typeof s.cadenceHours === 'number' ? s.cadenceHours : 4,
    enabled: Boolean(s.enabled),
    lastCheckedAt: clampStr(s.lastCheckedAt, 80, 'Not checked'),
    totalFound: typeof s.totalFound === 'number' ? s.totalFound : 0,
    lastNewCount: typeof s.lastNewCount === 'number' ? s.lastNewCount : 0,
  }));

  const rules: LearnedRule[] = rawRules.map((r) => ({
    id: String(r.id),
    text: clampStr(r.text, 400),
    origin: r.origin === 'synthesized' ? 'synthesized' : 'manual',
    active: Boolean(r.active),
  }));

  const feedbackHistory: FeedbackEntry[] = rawFeedback.map((f) => ({
    id: String(f.id),
    jobId: clampStr(f.jobId, 128),
    jobTitle: clampStr(f.jobTitle, 200),
    company: clampStr(f.company, 160),
    vote: f.vote === 'down' ? 'down' : 'up',
    reason: typeof f.reason === 'string' ? (f.reason as DislikeReason) : undefined,
    createdAt: clampStr(f.createdDateLabel, 40, 'Recent'),
  }));

  const events: JobEvent[] = rawEvents.map((e) => ({
    id: String(e.id),
    jobId: clampStr(e.jobId, 128),
    date: clampStr(e.date, 10),
    label: clampStr(e.label, 160),
    type: e.type === 'interview' ? 'interview' : 'followup',
  }));

  const imports: ImportBatchRecord[] = rawImports.map((imp) => ({
    id: String(imp.id),
    fileName: clampStr(imp.fileName, 200),
    totalRows: typeof imp.totalRows === 'number' ? imp.totalRows : 0,
    importedCount: typeof imp.importedCount === 'number' ? imp.importedCount : 0,
    skippedDuplicates:
      typeof imp.skippedDuplicates === 'number' ? imp.skippedDuplicates : 0,
    createdAt:
      imp.createdAt && typeof imp.createdAt.toDate === 'function'
        ? imp.createdAt.toDate().toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })
        : 'Recent',
  }));

  const resumes: RoleResume[] = rawResumes.map((res) => ({
    id: String(res.id),
    roleType: clampStr(res.roleType, 120),
    fileName: clampStr(res.fileName, 200),
    rawText: clampStr(res.rawText, 25000),
    uploadedAt: clampStr(res.uploadedAt, 32, 'Recent'),
  }));

  const coverLetterSamples: CoverLetterSample[] = rawCoverLetterSamples.map((sample) => ({
    id: String(sample.id),
    roleType: clampStr(sample.roleType, 120),
    fileName: clampStr(sample.fileName, 200),
    rawText: clampStr(sample.rawText, 25000),
    uploadedAt: clampStr(sample.uploadedAt, 32, 'Recent'),
  }));

  const targetCompanies: TargetCompany[] = rawTargetCompanies.map((c) => ({
    id: String(c.id),
    name: clampStr(c.name, 160),
    careersUrl: typeof c.careersUrl === 'string' && c.careersUrl.trim() ? clampStr(c.careersUrl, 1000) : undefined,
    notes: typeof c.notes === 'string' && c.notes.trim() ? clampStr(c.notes, 500) : undefined,
    enabled: c.enabled !== false,
    lastCheckedAt: clampStr(c.lastCheckedAt, 80, 'Not checked yet'),
    lastFoundCount: typeof c.lastFoundCount === 'number' ? c.lastFoundCount : 0,
  }));

  return {
    profileExists: true,
    profile,
    searchPrompt: typeof p.searchPrompt === 'string' ? p.searchPrompt : null,
    gmailQuery: typeof p.gmailQuery === 'string' ? p.gmailQuery : null,
    autoScheduleEnabled: Boolean(p.autoScheduleEnabled),
    autoScheduleMinutes:
      typeof p.autoScheduleMinutes === 'number' ? p.autoScheduleMinutes : 240,
    jobs,
    sources,
    rules,
    feedbackHistory,
    events,
    imports,
    resumes,
    coverLetterSamples,
    targetCompanies,
    dismissedDuplicatePairs: clampStringList(p.dismissedDuplicatePairs, 200, 260),
  };
}

export async function saveUserProfileToCloud(
  uid: string,
  params: {
    profile: UserIntakeProfile;
    searchPrompt: string;
    gmailQuery?: string;
    autoScheduleEnabled: boolean;
    autoScheduleMinutes: number;
  }
): Promise<void> {
  const path = `users/${uid}`;
  const ref = doc(db, 'users', uid);

  const normalizedEmail = clampStr(params.profile.email || 'user@meridian.app', 254);
  const safeEmail = normalizedEmail.length >= 3 ? normalizedEmail : 'user@meridian.app';
  const senders = clampStringList(params.profile.gmailSenders, 30);
  const compiledGmailQuery = clampStr(
    params.gmailQuery?.trim() || buildGmailQueryFromSenders(senders),
    1000
  );

  try {
    const existingSnap = await getDoc(ref);
    if (!existingSnap.exists()) {
      await setDoc(ref, {
        uid,
        email: safeEmail,
        displayName: clampStr(params.profile.displayName, 120),
        onboardingCompleted: Boolean(params.profile.onboardingCompleted),
        roleTypes: clampStringList(params.profile.roleTypes, 20),
        locations: clampStringList(params.profile.locations, 20),
        workModes: clampStringList(params.profile.workModes, 5),
        keywords: clampStringList(params.profile.keywords, 30),
        employmentTypes: clampStringList(params.profile.employmentTypes, 6),
        searchPrompt: clampStr(params.searchPrompt, 3000),
        gmailQuery: compiledGmailQuery,
        gmailSenders: senders,
        slackChannels: clampStringList(params.profile.slackChannels, 20),
        whatsappGroups: clampStringList(params.profile.whatsappGroups, 20),
        autoScheduleEnabled: Boolean(params.autoScheduleEnabled),
        autoScheduleMinutes: Math.max(
          5,
          Math.min(1440, Math.round(params.autoScheduleMinutes || 240))
        ),
        careerContextNotes: clampStr(params.profile.careerContextNotes ?? '', 15000),
        careerExperiences: sanitizeCareerExperiences(params.profile.careerExperiences),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        displayName: clampStr(params.profile.displayName, 120),
        email: safeEmail,
        onboardingCompleted: Boolean(params.profile.onboardingCompleted),
        roleTypes: clampStringList(params.profile.roleTypes, 20),
        locations: clampStringList(params.profile.locations, 20),
        workModes: clampStringList(params.profile.workModes, 5),
        keywords: clampStringList(params.profile.keywords, 30),
        employmentTypes: clampStringList(params.profile.employmentTypes, 6),
        searchPrompt: clampStr(params.searchPrompt, 3000),
        gmailQuery: compiledGmailQuery,
        gmailSenders: senders,
        slackChannels: clampStringList(params.profile.slackChannels, 20),
        whatsappGroups: clampStringList(params.profile.whatsappGroups, 20),
        autoScheduleEnabled: Boolean(params.autoScheduleEnabled),
        autoScheduleMinutes: Math.max(
          5,
          Math.min(1440, Math.round(params.autoScheduleMinutes || 240))
        ),
        careerContextNotes: clampStr(params.profile.careerContextNotes ?? '', 15000),
        careerExperiences: sanitizeCareerExperiences(params.profile.careerExperiences),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateWorkspaceSettingsInCloud(
  uid: string,
  patch: {
    searchPrompt?: string;
    gmailQuery?: string;
    gmailSenders?: string[];
    slackChannels?: string[];
    whatsappGroups?: string[];
    autoScheduleEnabled?: boolean;
    autoScheduleMinutes?: number;
  }
): Promise<void> {
  const path = `users/${uid}`;
  const ref = doc(db, 'users', uid);
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (typeof patch.searchPrompt === 'string') {
    payload.searchPrompt = clampStr(patch.searchPrompt, 3000);
  }
  if (typeof patch.gmailQuery === 'string') {
    payload.gmailQuery = clampStr(patch.gmailQuery, 1000);
  }
  if (Array.isArray(patch.gmailSenders)) {
    payload.gmailSenders = clampStringList(patch.gmailSenders, 30);
  }
  if (Array.isArray(patch.slackChannels)) {
    payload.slackChannels = clampStringList(patch.slackChannels, 20);
  }
  if (Array.isArray(patch.whatsappGroups)) {
    payload.whatsappGroups = clampStringList(patch.whatsappGroups, 20);
  }
  if (typeof patch.autoScheduleEnabled === 'boolean') {
    payload.autoScheduleEnabled = patch.autoScheduleEnabled;
  }
  if (typeof patch.autoScheduleMinutes === 'number') {
    payload.autoScheduleMinutes = Math.max(
      5,
      Math.min(1440, Math.round(patch.autoScheduleMinutes))
    );
  }

  try {
    await updateDoc(ref, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateDismissedDuplicatePairsInCloud(
  uid: string,
  pairs: string[]
): Promise<void> {
  const path = `users/${uid}`;
  const ref = doc(db, 'users', uid);
  try {
    await updateDoc(ref, {
      dismissedDuplicatePairs: clampStringList(pairs, 200, 260),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

function serializeJobForCreate(uid: string, job: JobRecord): {
  docId: string;
  data: Record<string, unknown>;
} {
  const docId = safeId(job.id, 'job');
  const data: Record<string, unknown> = {
    id: docId,
    ownerId: uid,
    urlHash: clampStr(job.urlHash || docId, 128) || docId,
    title: clampStr(job.title || 'Untitled Role', 200) || 'Untitled Role',
    company: clampStr(job.company || 'Unknown Company', 160) || 'Unknown Company',
    companyDomain: clampStr(job.companyDomain, 160),
    stage: validStage(job.stage),
    isNew: Boolean(job.isNew),
    matchScore: clampScore(job.matchScore),
    matchReason: clampStr(job.matchReason, 600),
    salaryMin:
      typeof job.salaryMin === 'number' && Number.isFinite(job.salaryMin)
        ? Math.max(0, Math.min(5000000, Math.round(job.salaryMin)))
        : null,
    salaryMax:
      typeof job.salaryMax === 'number' && Number.isFinite(job.salaryMax)
        ? Math.max(0, Math.min(5000000, Math.round(job.salaryMax)))
        : null,
    salaryLabel: clampStr(job.salaryLabel || 'Not listed', 80),
    location: clampStr(job.location, 160),
    locationType: validLocType(job.locationType),
    sourceId: clampStr(job.sourceId, 128),
    sourceName: clampStr(job.sourceName, 160),
    atsType: validAts(job.atsType),
    jobUrl: clampStr(job.jobUrl, 1000),
    discoveredAt: clampStr(job.discoveredAt, 32),
    discoveredTime: clampStr(job.discoveredTime, 32),
    deadlineAt: job.deadlineAt ? clampStr(job.deadlineAt, 32) : null,
    skills: clampStringList(job.skills, 25),
    summary: clampStr(job.summary, 2000),
    notes: clampStr(job.notes, 4000),
    feedback: job.feedback === 'up' || job.feedback === 'down' ? job.feedback : 'none',
    dislikeReason: job.dislikeReason ? clampStr(job.dislikeReason, 80) : null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (typeof job.previousMatchScore === 'number') {
    data.previousMatchScore = clampScore(job.previousMatchScore);
  }
  if (typeof job.employmentType === 'string' && job.employmentType.trim()) {
    data.employmentType = clampStr(job.employmentType, 60);
  }
  data.isMbaRole =
    typeof job.isMbaRole === 'boolean'
      ? job.isMbaRole
      : /\bmba\b/i.test(job.title || '');
  if (validPriority(job.priority)) {
    data.priority = job.priority;
  }
  if (typeof job.fullDescription === 'string' && job.fullDescription.trim()) {
    data.fullDescription = clampStr(job.fullDescription, 16000);
  }
  if (Array.isArray(job.networkingContacts) && job.networkingContacts.length > 0) {
    data.networkingContacts = sanitizeNetworkingContacts(job.networkingContacts);
  }

  return { docId, data };
}

export async function createJobsInCloud(uid: string, jobs: JobRecord[]): Promise<void> {
  if (jobs.length === 0) return;
  const basePath = `users/${uid}/jobs`;
  // Chunk into Firestore batch max 400 writes per batch
  try {
    for (let i = 0; i < jobs.length; i += 400) {
      const slice = jobs.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const job of slice) {
        const { docId, data } = serializeJobForCreate(uid, job);
        const ref = doc(db, 'users', uid, 'jobs', docId);
        batch.set(ref, data);
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, basePath);
  }
}

export async function updateJobTriageInCloud(
  uid: string,
  jobId: string,
  patch: {
    stage: PipelineStage;
    isNew: boolean;
    feedback: 'up' | 'down' | null;
    dislikeReason?: DislikeReason;
  }
): Promise<void> {
  const id = safeId(jobId, 'job');
  const path = `users/${uid}/jobs/${id}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'jobs', id), {
      stage: validStage(patch.stage),
      isNew: Boolean(patch.isNew),
      feedback: patch.feedback === 'up' || patch.feedback === 'down' ? patch.feedback : 'none',
      dislikeReason: patch.dislikeReason ? clampStr(patch.dislikeReason, 80) : null,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateJobNotesInCloud(
  uid: string,
  jobId: string,
  notes: string
): Promise<void> {
  const id = safeId(jobId, 'job');
  const path = `users/${uid}/jobs/${id}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'jobs', id), {
      notes: clampStr(notes, 4000),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateJobNetworkingContactsInCloud(
  uid: string,
  jobId: string,
  contacts: NetworkingContact[]
): Promise<void> {
  const id = safeId(jobId, 'job');
  const path = `users/${uid}/jobs/${id}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'jobs', id), {
      networkingContacts: sanitizeNetworkingContacts(contacts),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateJobFullDescriptionInCloud(
  uid: string,
  jobId: string,
  fullDescription: string,
  extra?: { jobUrl?: string; companyDomain?: string; employmentType?: string }
): Promise<void> {
  const id = safeId(jobId, 'job');
  const path = `users/${uid}/jobs/${id}`;
  const payload: Record<string, unknown> = {
    fullDescription: clampStr(fullDescription, 16000),
    updatedAt: serverTimestamp(),
  };
  if (extra?.jobUrl && extra.jobUrl.trim()) {
    payload.jobUrl = clampStr(extra.jobUrl.trim(), 1000);
  }
  if (extra?.companyDomain && extra.companyDomain.trim()) {
    payload.companyDomain = clampStr(extra.companyDomain.trim(), 160);
  }
  if (extra?.employmentType && extra.employmentType.trim()) {
    payload.employmentType = clampStr(extra.employmentType.trim(), 60);
  }
  try {
    await updateDoc(doc(db, 'users', uid, 'jobs', id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateJobAttributesInCloud(
  uid: string,
  jobId: string,
  patch: {
    employmentType?: string;
    isMbaRole?: boolean;
    priority?: JobPriority | null;
  }
): Promise<void> {
  const id = safeId(jobId, 'job');
  const path = `users/${uid}/jobs/${id}`;
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (typeof patch.employmentType === 'string' && patch.employmentType.trim()) {
    payload.employmentType = clampStr(patch.employmentType.trim(), 60);
  }
  if (typeof patch.isMbaRole === 'boolean') {
    payload.isMbaRole = patch.isMbaRole;
  }
  if (patch.priority === null) {
    payload.priority = null;
  } else if (patch.priority !== undefined && validPriority(patch.priority)) {
    payload.priority = patch.priority;
  }
  try {
    await updateDoc(doc(db, 'users', uid, 'jobs', id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export interface JobDetailsUpdatePatch {
  title?: string;
  company?: string;
  companyDomain?: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryLabel?: string;
  location?: string;
  locationType?: LocationType;
  employmentType?: string;
  isMbaRole?: boolean;
  priority?: JobPriority | null;
  jobUrl?: string;
  deadlineAt?: string | null;
  skills?: string[];
  summary?: string;
  fullDescription?: string;
  matchScore?: number;
  previousMatchScore?: number;
  matchReason?: string;
}

export async function updateJobDetailsInCloud(
  uid: string,
  jobId: string,
  patch: JobDetailsUpdatePatch
): Promise<void> {
  const id = safeId(jobId, 'job');
  const path = `users/${uid}/jobs/${id}`;
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };

  if (typeof patch.title === 'string' && patch.title.trim()) {
    payload.title = clampStr(patch.title.trim(), 200);
  }
  if (typeof patch.company === 'string' && patch.company.trim()) {
    payload.company = clampStr(patch.company.trim(), 160);
  }
  if (typeof patch.companyDomain === 'string') {
    payload.companyDomain = clampStr(patch.companyDomain.trim(), 160);
  }
  if (patch.salaryMin !== undefined) {
    payload.salaryMin =
      typeof patch.salaryMin === 'number' && Number.isFinite(patch.salaryMin)
        ? Math.max(0, Math.min(5000000, Math.round(patch.salaryMin)))
        : null;
  }
  if (patch.salaryMax !== undefined) {
    payload.salaryMax =
      typeof patch.salaryMax === 'number' && Number.isFinite(patch.salaryMax)
        ? Math.max(0, Math.min(5000000, Math.round(patch.salaryMax)))
        : null;
  }
  if (typeof patch.salaryLabel === 'string') {
    payload.salaryLabel = clampStr(patch.salaryLabel.trim() || 'Not listed', 80);
  }
  if (typeof patch.location === 'string') {
    payload.location = clampStr(patch.location.trim(), 160);
  }
  if (patch.locationType !== undefined) {
    payload.locationType = validLocType(patch.locationType);
  }
  if (typeof patch.employmentType === 'string' && patch.employmentType.trim()) {
    payload.employmentType = clampStr(patch.employmentType.trim(), 60);
  }
  if (typeof patch.isMbaRole === 'boolean') {
    payload.isMbaRole = patch.isMbaRole;
  }
  if (patch.priority === null) {
    payload.priority = null;
  } else if (patch.priority !== undefined && validPriority(patch.priority)) {
    payload.priority = patch.priority;
  }
  if (typeof patch.jobUrl === 'string') {
    payload.jobUrl = clampStr(patch.jobUrl.trim(), 1000);
  }
  if (patch.deadlineAt !== undefined) {
    payload.deadlineAt =
      typeof patch.deadlineAt === 'string' && patch.deadlineAt.trim()
        ? clampStr(patch.deadlineAt.trim(), 32)
        : null;
  }
  if (Array.isArray(patch.skills)) {
    payload.skills = clampStringList(patch.skills, 25);
  }
  if (typeof patch.summary === 'string') {
    payload.summary = clampStr(patch.summary.trim(), 2000);
  }
  if (typeof patch.fullDescription === 'string') {
    payload.fullDescription = clampStr(patch.fullDescription.trim(), 16000);
  }
  if (typeof patch.matchScore === 'number') {
    payload.matchScore = clampScore(patch.matchScore);
  }
  if (typeof patch.previousMatchScore === 'number') {
    payload.previousMatchScore = clampScore(patch.previousMatchScore);
  }
  if (typeof patch.matchReason === 'string') {
    payload.matchReason = clampStr(patch.matchReason.trim(), 600);
  }

  try {
    await updateDoc(doc(db, 'users', uid, 'jobs', id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateJobRescoreBatchInCloud(
  uid: string,
  patches: { id: string; previousMatchScore: number; matchScore: number; matchReason: string }[]
): Promise<void> {
  if (patches.length === 0) return;
  const basePath = `users/${uid}/jobs`;
  try {
    const batch = writeBatch(db);
    for (const p of patches.slice(0, 400)) {
      const id = safeId(p.id, 'job');
      batch.update(doc(db, 'users', uid, 'jobs', id), {
        previousMatchScore: clampScore(p.previousMatchScore),
        matchScore: clampScore(p.matchScore),
        matchReason: clampStr(p.matchReason, 600),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, basePath);
  }
}

export async function deleteJobInCloud(uid: string, jobId: string): Promise<void> {
  const id = safeId(jobId, 'job');
  const path = `users/${uid}/jobs/${id}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'jobs', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function deleteJobsBatchInCloud(uid: string, jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return;
  const basePath = `users/${uid}/jobs`;
  try {
    for (let i = 0; i < jobIds.length; i += 400) {
      const slice = jobIds.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const jobId of slice) {
        const id = safeId(jobId, 'job');
        batch.delete(doc(db, 'users', uid, 'jobs', id));
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, basePath);
  }
}

export async function updateJobsEnrichmentBatchInCloud(
  uid: string,
  patches: (JobEnrichmentPatch & { previousMatchScore?: number })[]
): Promise<void> {
  if (patches.length === 0) return;
  const basePath = `users/${uid}/jobs`;
  try {
    const batch = writeBatch(db);
    for (const p of patches.slice(0, 400)) {
      const id = safeId(p.id, 'job');
      const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
      if (typeof p.title === 'string' && p.title.trim()) {
        payload.title = clampStr(p.title.trim(), 200);
      }
      if (typeof p.companyDomain === 'string' && p.companyDomain.trim()) {
        payload.companyDomain = clampStr(p.companyDomain.trim(), 160);
      }
      if (typeof p.salaryMin === 'number' && Number.isFinite(p.salaryMin)) {
        payload.salaryMin = Math.max(0, Math.min(5000000, Math.round(p.salaryMin)));
      }
      if (typeof p.salaryMax === 'number' && Number.isFinite(p.salaryMax)) {
        payload.salaryMax = Math.max(0, Math.min(5000000, Math.round(p.salaryMax)));
      }
      if (typeof p.salaryLabel === 'string' && p.salaryLabel.trim()) {
        payload.salaryLabel = clampStr(p.salaryLabel.trim(), 80);
      }
      if (typeof p.location === 'string' && p.location.trim()) {
        payload.location = clampStr(p.location.trim(), 160);
      }
      if (p.locationType && VALID_LOC_TYPES.includes(p.locationType)) {
        payload.locationType = p.locationType;
      }
      if (typeof p.employmentType === 'string' && p.employmentType.trim()) {
        payload.employmentType = clampStr(p.employmentType.trim(), 60);
      }
      if (typeof p.isMbaRole === 'boolean') {
        payload.isMbaRole = p.isMbaRole;
      }
      if (typeof p.jobUrl === 'string' && p.jobUrl.trim()) {
        payload.jobUrl = clampStr(p.jobUrl.trim(), 1000);
      }
      if (Array.isArray(p.skills) && p.skills.length > 0) {
        payload.skills = clampStringList(p.skills, 25);
      }
      if (typeof p.summary === 'string' && p.summary.trim()) {
        payload.summary = clampStr(p.summary.trim(), 2000);
      }
      if (typeof p.fullDescription === 'string' && p.fullDescription.trim()) {
        payload.fullDescription = clampStr(p.fullDescription.trim(), 16000);
      }
      if (typeof p.matchScore === 'number') {
        payload.matchScore = clampScore(p.matchScore);
      }
      if (typeof p.previousMatchScore === 'number') {
        payload.previousMatchScore = clampScore(p.previousMatchScore);
      }
      if (typeof p.matchReason === 'string' && p.matchReason.trim()) {
        payload.matchReason = clampStr(p.matchReason.trim(), 600);
      }
      batch.update(doc(db, 'users', uid, 'jobs', id), payload);
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, basePath);
  }
}

export async function createSourceInCloud(uid: string, source: JobSource): Promise<void> {
  const id = safeId(source.id, 'src');
  const path = `users/${uid}/sources/${id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'sources', id), {
      id,
      ownerId: uid,
      name: clampStr(source.name || 'Career Board', 160) || 'Career Board',
      url: clampStr(source.url || 'https://example.com', 1000) || 'https://example.com',
      atsType: validAts(source.atsType),
      cadenceHours: Math.max(1, Math.min(168, Math.round(source.cadenceHours || 4))),
      enabled: Boolean(source.enabled),
      lastCheckedAt: clampStr(source.lastCheckedAt, 80),
      totalFound: Math.max(0, Math.round(source.totalFound || 0)),
      lastNewCount: Math.max(0, Math.round(source.lastNewCount || 0)),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateSourceConfigInCloud(
  uid: string,
  sourceId: string,
  patch: { enabled?: boolean; cadenceHours?: number }
): Promise<void> {
  const id = safeId(sourceId, 'src');
  const path = `users/${uid}/sources/${id}`;
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (typeof patch.enabled === 'boolean') payload.enabled = patch.enabled;
  if (typeof patch.cadenceHours === 'number') {
    payload.cadenceHours = Math.max(1, Math.min(168, Math.round(patch.cadenceHours)));
  }
  try {
    await updateDoc(doc(db, 'users', uid, 'sources', id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateSourceMetricsInCloud(
  uid: string,
  sourceId: string,
  metrics: { lastCheckedAt: string; totalFound: number; lastNewCount: number }
): Promise<void> {
  const id = safeId(sourceId, 'src');
  const path = `users/${uid}/sources/${id}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'sources', id), {
      lastCheckedAt: clampStr(metrics.lastCheckedAt, 80),
      totalFound: Math.max(0, Math.round(metrics.totalFound || 0)),
      lastNewCount: Math.max(0, Math.round(metrics.lastNewCount || 0)),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteSourceInCloud(uid: string, sourceId: string): Promise<void> {
  const id = safeId(sourceId, 'src');
  const path = `users/${uid}/sources/${id}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'sources', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createRuleInCloud(uid: string, rule: LearnedRule): Promise<void> {
  const id = safeId(rule.id, 'rule');
  const path = `users/${uid}/rules/${id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'rules', id), {
      id,
      ownerId: uid,
      text: clampStr(rule.text, 400) || 'Custom rule',
      origin: rule.origin === 'synthesized' ? 'synthesized' : 'manual',
      active: Boolean(rule.active),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateRuleInCloud(
  uid: string,
  ruleId: string,
  patch: { active?: boolean; text?: string }
): Promise<void> {
  const id = safeId(ruleId, 'rule');
  const path = `users/${uid}/rules/${id}`;
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (typeof patch.active === 'boolean') payload.active = patch.active;
  if (typeof patch.text === 'string') payload.text = clampStr(patch.text, 400);
  try {
    await updateDoc(doc(db, 'users', uid, 'rules', id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteRuleInCloud(uid: string, ruleId: string): Promise<void> {
  const id = safeId(ruleId, 'rule');
  const path = `users/${uid}/rules/${id}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'rules', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createFeedbackInCloud(
  uid: string,
  entry: FeedbackEntry
): Promise<void> {
  const id = safeId(entry.id, 'fb');
  const path = `users/${uid}/feedback/${id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'feedback', id), {
      id,
      ownerId: uid,
      jobId: clampStr(entry.jobId, 128) || 'job',
      jobTitle: clampStr(entry.jobTitle, 200),
      company: clampStr(entry.company, 160),
      vote: entry.vote === 'down' ? 'down' : 'up',
      reason: entry.reason ? clampStr(entry.reason, 80) : null,
      createdDateLabel: clampStr(entry.createdAt, 40),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteFeedbackInCloud(
  uid: string,
  feedbackId: string
): Promise<void> {
  const id = safeId(feedbackId, 'fb');
  const path = `users/${uid}/feedback/${id}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'feedback', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createEventInCloud(uid: string, event: JobEvent): Promise<void> {
  const id = safeId(event.id, 'evt');
  const path = `users/${uid}/events/${id}`;
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(event.date)
    ? event.date
    : getLocalTodayIso();
  try {
    await setDoc(doc(db, 'users', uid, 'events', id), {
      id,
      ownerId: uid,
      jobId: clampStr(event.jobId, 128) || 'job',
      date: validDate,
      label: clampStr(event.label, 160) || 'Milestone',
      type: event.type === 'interview' ? 'interview' : 'followup',
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteEventInCloud(uid: string, eventId: string): Promise<void> {
  const id = safeId(eventId, 'evt');
  const path = `users/${uid}/events/${id}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'events', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createImportBatchInCloud(
  uid: string,
  batch: Omit<ImportBatchRecord, 'createdAt'>
): Promise<void> {
  const id = safeId(batch.id, 'imp');
  const path = `users/${uid}/imports/${id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'imports', id), {
      id,
      ownerId: uid,
      fileName: clampStr(batch.fileName || 'uploaded-roles.csv', 200),
      totalRows: Math.max(0, Math.round(batch.totalRows || 0)),
      importedCount: Math.max(0, Math.round(batch.importedCount || 0)),
      skippedDuplicates: Math.max(0, Math.round(batch.skippedDuplicates || 0)),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateCareerContextInCloud(
  uid: string,
  patch: {
    careerContextNotes?: string;
    careerExperiences?: CareerExperienceItem[];
  }
): Promise<void> {
  const path = `users/${uid}`;
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (typeof patch.careerContextNotes === 'string') {
    payload.careerContextNotes = clampStr(patch.careerContextNotes, 15000);
  }
  if (Array.isArray(patch.careerExperiences)) {
    payload.careerExperiences = sanitizeCareerExperiences(patch.careerExperiences);
  }
  try {
    await updateDoc(doc(db, 'users', uid), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function upsertRoleResumeInCloud(
  uid: string,
  resume: RoleResume
): Promise<void> {
  const id = safeId(resume.id, 'res');
  const path = `users/${uid}/resumes/${id}`;
  const ref = doc(db, 'users', uid, 'resumes', id);
  const roleType = clampStr(resume.roleType || 'General', 120) || 'General';
  const fileName = clampStr(resume.fileName || 'resume.docx', 200) || 'resume.docx';
  const rawText = clampStr(resume.rawText || ' ', 25000) || ' ';
  const uploadedAt = clampStr(
    resume.uploadedAt || getLocalTodayIso(),
    32
  );
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        id,
        ownerId: uid,
        roleType,
        fileName,
        rawText,
        uploadedAt,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        roleType,
        fileName,
        rawText,
        uploadedAt,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteRoleResumeInCloud(
  uid: string,
  resumeId: string
): Promise<void> {
  const id = safeId(resumeId, 'res');
  const path = `users/${uid}/resumes/${id}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'resumes', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createTargetCompaniesBatchInCloud(
  uid: string,
  companies: TargetCompany[]
): Promise<void> {
  if (companies.length === 0) return;
  const basePath = `users/${uid}/targetCompanies`;
  try {
    for (let i = 0; i < companies.length; i += 400) {
      const slice = companies.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const company of slice) {
        const id = safeId(company.id, 'tc');
        const data: Record<string, unknown> = {
          id,
          ownerId: uid,
          name: clampStr(company.name || 'Target Company', 160) || 'Target Company',
          enabled: company.enabled !== false,
          lastCheckedAt: clampStr(company.lastCheckedAt || 'Pending first pull', 80),
          lastFoundCount: Math.max(0, Math.round(company.lastFoundCount || 0)),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        if (company.careersUrl && company.careersUrl.trim()) {
          data.careersUrl = clampStr(company.careersUrl.trim(), 1000);
        }
        if (company.notes && company.notes.trim()) {
          data.notes = clampStr(company.notes.trim(), 500);
        }
        batch.set(doc(db, 'users', uid, 'targetCompanies', id), data);
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, basePath);
  }
}

export async function updateTargetCompanyInCloud(
  uid: string,
  companyId: string,
  patch: { name?: string; careersUrl?: string; notes?: string; enabled?: boolean }
): Promise<void> {
  const id = safeId(companyId, 'tc');
  const path = `users/${uid}/targetCompanies/${id}`;
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (typeof patch.name === 'string' && patch.name.trim()) {
    payload.name = clampStr(patch.name.trim(), 160);
  }
  if (typeof patch.careersUrl === 'string') {
    payload.careersUrl = clampStr(patch.careersUrl.trim(), 1000);
  }
  if (typeof patch.notes === 'string') {
    payload.notes = clampStr(patch.notes.trim(), 500);
  }
  if (typeof patch.enabled === 'boolean') {
    payload.enabled = patch.enabled;
  }
  try {
    await updateDoc(doc(db, 'users', uid, 'targetCompanies', id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateTargetCompanyMetricsInCloud(
  uid: string,
  companyId: string,
  metrics: { lastCheckedAt: string; lastFoundCount: number }
): Promise<void> {
  const id = safeId(companyId, 'tc');
  const path = `users/${uid}/targetCompanies/${id}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'targetCompanies', id), {
      lastCheckedAt: clampStr(metrics.lastCheckedAt, 80),
      lastFoundCount: Math.max(0, Math.round(metrics.lastFoundCount || 0)),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteTargetCompanyInCloud(
  uid: string,
  companyId: string
): Promise<void> {
  const id = safeId(companyId, 'tc');
  const path = `users/${uid}/targetCompanies/${id}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'targetCompanies', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function upsertCoverLetterSampleInCloud(
  uid: string,
  sample: CoverLetterSample
): Promise<void> {
  const id = safeId(sample.id, 'cl');
  const path = `users/${uid}/coverLetterSamples/${id}`;
  const ref = doc(db, 'users', uid, 'coverLetterSamples', id);
  const roleType = clampStr(sample.roleType || 'General', 120) || 'General';
  const fileName = clampStr(sample.fileName || 'cover-letter.docx', 200) || 'cover-letter.docx';
  const rawText = clampStr(sample.rawText || ' ', 25000) || ' ';
  const uploadedAt = clampStr(
    sample.uploadedAt || getLocalTodayIso(),
    32
  );
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        id,
        ownerId: uid,
        roleType,
        fileName,
        rawText,
        uploadedAt,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        roleType,
        fileName,
        rawText,
        uploadedAt,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteCoverLetterSampleInCloud(
  uid: string,
  sampleId: string
): Promise<void> {
  const id = safeId(sampleId, 'cl');
  const path = `users/${uid}/coverLetterSamples/${id}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'coverLetterSamples', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
