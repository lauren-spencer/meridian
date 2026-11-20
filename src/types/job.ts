export type PipelineStage =
  | 'inbox'
  | 'saved'
  | 'applied'
  | 'interviewing'
  | 'offer'
  | 'archived';

export type LocationType = 'Remote' | 'Hybrid' | 'Onsite';

export type EmploymentType = 'Full-time' | 'Internship' | 'Part-time' | 'Contract';

export type JobPriority = 'asap' | 'high' | 'medium' | 'low' | 'applied';

export type AtsType =
  | 'Greenhouse'
  | 'Lever'
  | 'Ashby'
  | 'Custom Markdown'
  | 'RSS Feed'
  | 'Gmail'
  | 'Slack'
  | 'WhatsApp'
  | 'CSV Import'
  | 'Target Company';

export type DislikeReason =
  | 'Wrong employment type'
  | 'Low pay'
  | 'Company fit'
  | 'Wrong role type'
  | 'Location';

export type WorkspaceView =
  | 'table'
  | 'kanban'
  | 'calendar'
  | 'sources'
  | 'resumes'
  | 'criteria'
  | 'schema';

export interface RoleResume {
  id: string;
  roleType: string;
  fileName: string;
  rawText: string;
  uploadedAt: string; // YYYY-MM-DD
}

export interface CoverLetterSample {
  id: string;
  roleType: string;
  fileName: string;
  rawText: string;
  uploadedAt: string; // YYYY-MM-DD
}

export interface GeneratedCoverLetter {
  roleTypeUsed: string;
  sampleFileName: string;
  candidateName: string;
  contactLine: string;
  dateLine: string;
  recipientLine: string;
  salutation: string;
  paragraphs: string[];
  signOff: string;
  tailoringNotes: string[];
  generatedAt: string;
}

export interface CareerExperienceItem {
  id: string;
  title: string;
  organization: string;
  dates: string;
  onResume: boolean;
  details: string;
}

export type ResumeCommentCategory = 'move' | 'add' | 'remove' | 'missing';

export interface ResumeReviewComment {
  id: string;
  category: ResumeCommentCategory;
  /** 1-based line number in baseLines (null for document-wide / missing-section comments) */
  anchorLineNumber: number | null;
  /** Short verbatim excerpt from the base resume line that this comment targets */
  anchorQuote: string;
  /** Resume section heading or area (e.g., "Experience — Roche", "Skills", "Missing from Resume") */
  sectionLabel: string;
  /** Crisp headline of the recommendation */
  title: string;
  /** Specific feedback explaining what to move, add, remove, or what is missing based on the JD */
  comment: string;
  /** Optional concrete wording suggestion or off-resume item to draw from (never auto-applied) */
  suggestedText?: string;
  /** True when the suggestion draws from the user's non-resume skills/experience context */
  fromExtendedContext?: boolean;
}

export interface ResumeReviewDocument {
  roleTypeUsed: string;
  baseResumeFileName: string;
  /** Verbatim lines of the selected base resume (untouched) */
  baseLines: string[];
  overallFitNote: string;
  comments: ResumeReviewComment[];
  missingRequirements: string[];
  usedExtendedContext: boolean;
  generatedAt: string;
}

export interface UserIntakeProfile {
  uid: string;
  email: string;
  displayName: string;
  onboardingCompleted: boolean;
  roleTypes: string[];
  locations: string[];
  workModes: LocationType[];
  keywords: string[];
  employmentTypes: string[];
  gmailSenders: string[];
  slackChannels: string[];
  whatsappGroups: string[];
  careerContextNotes?: string;
  careerExperiences?: CareerExperienceItem[];
}

export type NetworkingChannel =
  | 'LinkedIn'
  | 'Email'
  | 'Slack'
  | 'Warm Intro'
  | 'Coffee Chat'
  | 'Other';

export type NetworkingContactStatus =
  | 'To Reach Out'
  | 'Message Sent'
  | 'Replied'
  | 'Coffee Chat Scheduled'
  | 'Referred';

export type NetworkingContactSentiment =
  | 'Champion'
  | 'Warm'
  | 'Neutral'
  | 'Cold'
  | 'Unresponsive';

export interface NetworkingContact {
  id: string;
  name: string;
  role: string;
  channel: NetworkingChannel;
  status: NetworkingContactStatus;
  sentiment?: NetworkingContactSentiment;
  lastContactDate?: string; // YYYY-MM-DD
  followUpDate?: string; // YYYY-MM-DD
  profileUrl?: string;
  notes?: string;
}

export interface JobEvent {
  id: string;
  jobId: string;
  date: string; // YYYY-MM-DD
  label: string;
  type: 'interview' | 'followup';
}

export interface JobRecord {
  id: string;
  urlHash: string;
  title: string;
  company: string;
  companyDomain: string;
  stage: PipelineStage;
  isNew: boolean;
  matchScore: number; // 0 - 100
  previousMatchScore?: number;
  matchReason: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryLabel: string;
  location: string;
  locationType: LocationType;
  employmentType?: string;
  isMbaRole?: boolean;
  priority?: JobPriority;
  sourceId: string;
  sourceName: string;
  atsType: AtsType;
  jobUrl: string;
  discoveredAt: string; // YYYY-MM-DD
  discoveredTime: string; // e.g., "06:15 AM"
  deadlineAt: string | null; // YYYY-MM-DD
  skills: string[];
  summary: string;
  fullDescription?: string;
  networkingContacts?: NetworkingContact[];
  notes: string;
  feedback: 'up' | 'down' | null;
  dislikeReason?: DislikeReason;
}

export interface JobSource {
  id: string;
  name: string;
  url: string;
  atsType: AtsType;
  cadenceHours: number;
  enabled: boolean;
  lastCheckedAt: string;
  totalFound: number;
  lastNewCount: number;
}

export interface TargetCompany {
  id: string;
  name: string;
  careersUrl?: string;
  notes?: string;
  enabled: boolean;
  lastCheckedAt: string;
  lastFoundCount: number;
}

export interface JobEnrichmentPatch {
  id: string;
  title?: string;
  companyDomain?: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryLabel?: string;
  location?: string;
  locationType?: LocationType;
  employmentType?: string;
  isMbaRole?: boolean;
  jobUrl?: string;
  skills?: string[];
  summary?: string;
  fullDescription?: string;
  matchScore?: number;
  matchReason?: string;
}

export interface FeedbackEntry {
  id: string;
  jobId: string;
  jobTitle: string;
  company: string;
  vote: 'up' | 'down';
  reason?: DislikeReason;
  createdAt: string;
}

export interface LearnedRule {
  id: string;
  text: string;
  origin: 'manual' | 'synthesized';
  active: boolean;
}

export interface RuleSuggestion {
  id: string;
  reasonTrigger: DislikeReason;
  count: number;
  proposedRule: string;
  summary: string;
  dismissed: boolean;
}

export interface ToastNotification {
  id: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export interface AgentSourceRunResult {
  sourceId: string;
  sourceName: string;
  atsType: AtsType;
  status: 'ok' | 'error';
  rawFetched: number;
  duplicatesSkipped: number;
  newlyScored: number;
  durationMs: number;
  errorMessage?: string;
}

export interface AgentRunReport {
  id: string;
  completedAt: string;
  completedTime: string;
  trigger?: 'manual' | 'scheduled';
  totalFetched: number;
  totalSkipped: number;
  totalAdded: number;
  enrichedCount?: number;
  sourceResults: AgentSourceRunResult[];
}

export interface AiRuleSuggestion {
  id: string;
  proposedRule: string;
  rationale: string;
  evidenceCount: number;
  dismissed?: boolean;
}

export interface PreferenceSynthesisResult {
  preferenceSummary: string;
  suggestions: AiRuleSuggestion[];
  synthesizedAt: string;
}

export interface ServerScheduleState {
  enabled: boolean;
  intervalMinutes: number;
  nextRunAt: string | null;
  isRunning: boolean;
}

export type MappableJobField =
  | 'ignore'
  | 'title'
  | 'company'
  | 'location'
  | 'locationType'
  | 'employmentType'
  | 'salaryLabel'
  | 'jobUrl'
  | 'stage'
  | 'deadlineAt'
  | 'discoveredAt'
  | 'skills'
  | 'summary'
  | 'notes'
  | 'sourceName';

export interface ColumnMappingSuggestion {
  sourceColumn: string;
  targetField: MappableJobField;
  confidence: number;
  reason: string;
}

export interface ImportBatchRecord {
  id: string;
  fileName: string;
  totalRows: number;
  importedCount: number;
  skippedDuplicates: number;
  createdAt: string;
}
