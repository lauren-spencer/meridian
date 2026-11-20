import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  FilePenLine,
  Link2,
  Lock,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Unlock,
  Upload,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  EMPLOYMENT_TYPES,
  detectIsMbaRole,
  downloadBase64Docx,
  getCoverLetterUnlockStatus,
  normalizeEmploymentType,
  parseResumeFileOnServer,
  selectBestCoverLetterSampleForJob,
  selectBestResumeForJob,
} from '../lib/resumeClient';
import { getClientTimeZone, getLocalTodayIso } from '../lib/dateTime';
import type { JobDetailsUpdatePatch } from '../lib/firestoreStore';
import {
  CareerExperienceItem,
  CoverLetterSample,
  DislikeReason,
  GeneratedCoverLetter,
  JobEvent,
  JobPriority,
  JobRecord,
  LocationType,
  NetworkingChannel,
  NetworkingContact,
  NetworkingContactSentiment,
  NetworkingContactStatus,
  PipelineStage,
  ResumeCommentCategory,
  ResumeReviewComment,
  ResumeReviewDocument,
  RoleResume,
} from '../types/job';
import { DislikeReasonPopover } from './DislikeReasonPopover';

function parseSalaryBoundsFromLabel(label: string): {
  salaryMin: number | null;
  salaryMax: number | null;
} {
  const clean = label.trim();
  if (!clean || /not listed|unspecified|n\/a|tbd/i.test(clean)) {
    return { salaryMin: null, salaryMax: null };
  }
  const matches = Array.from(clean.matchAll(/\$?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kK])?/g));
  const values: number[] = [];
  for (const m of matches) {
    const rawNum = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isFinite(rawNum)) continue;
    const isK = Boolean(m[2]);
    const val = isK ? Math.round(rawNum * 1000) : Math.round(rawNum);
    if (val >= 20000 && val <= 5000000) {
      values.push(val);
    }
  }
  if (values.length === 0) return { salaryMin: null, salaryMax: null };
  if (values.length === 1) return { salaryMin: values[0], salaryMax: values[0] };
  return {
    salaryMin: Math.min(values[0], values[1]),
    salaryMax: Math.max(values[0], values[1]),
  };
}

interface JobDetailDrawerProps {
  job: JobRecord | null;
  events: JobEvent[];
  resumes: RoleResume[];
  targetRoleTypes: string[];
  coverLetterSamples: CoverLetterSample[];
  careerExperiences: CareerExperienceItem[];
  careerContextNotes: string;
  resumeReviewResult?: {
    review: ResumeReviewDocument;
    docxBase64: string;
    fileName: string;
  } | null;
  coverLetterResult?: {
    coverLetter: GeneratedCoverLetter;
    docxBase64: string;
    fileName: string;
  } | null;
  onSaveResume: (resume: RoleResume) => void;
  onSaveCoverLetterSample: (sample: CoverLetterSample) => void;
  onOpenResumesView: (focusSection?: 'context') => void;
  onSaveResumeReview: (
    jobId: string,
    result: {
      review: ResumeReviewDocument;
      docxBase64: string;
      fileName: string;
    }
  ) => void;
  onSaveCoverLetterResult: (
    jobId: string,
    result: {
      coverLetter: GeneratedCoverLetter;
      docxBase64: string;
      fileName: string;
    }
  ) => void;
  onClose: () => void;
  onMoveStage: (jobId: string, nextStage: PipelineStage) => void;
  onUpdateJobAttributes: (
    jobId: string,
    patch: { employmentType?: string; isMbaRole?: boolean; priority?: JobPriority | null }
  ) => void;
  onUpdateJobDetails: (jobId: string, patch: JobDetailsUpdatePatch) => void;
  onExtractDetailsFromUrl: (jobUrl: string, stage: PipelineStage) => Promise<JobRecord>;
  onUpdateNotes: (jobId: string, notes: string) => void;
  onUpdateFullDescription: (jobId: string, fullDescription: string) => void;
  onFetchFullDescription: (jobId: string, jobUrl: string) => Promise<void>;
  onUpdateNetworkingContacts: (jobId: string, contacts: NetworkingContact[]) => void;
  onThumbsUp: (jobId: string) => void;
  onThumbsDown: (jobId: string, reason?: DislikeReason) => void;
  onRestoreJob: (jobId: string) => void;
  onDeleteJob: (jobId: string) => void;
  onAddEvent: (event: Omit<JobEvent, 'id'>) => void;
}

const STAGES: { id: PipelineStage; label: string }[] = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'saved', label: 'Saved' },
  { id: 'applied', label: 'Applied' },
  { id: 'interviewing', label: 'Interviewing' },
  { id: 'offer', label: 'Offer' },
  { id: 'archived', label: 'Archived' },
];

const NETWORKING_CHANNELS: NetworkingChannel[] = [
  'LinkedIn',
  'Email',
  'Slack',
  'Warm Intro',
  'Coffee Chat',
  'Other',
];

const NETWORKING_STATUSES: NetworkingContactStatus[] = [
  'To Reach Out',
  'Message Sent',
  'Replied',
  'Coffee Chat Scheduled',
  'Referred',
];

const NETWORKING_SENTIMENTS: NetworkingContactSentiment[] = [
  'Champion',
  'Warm',
  'Neutral',
  'Cold',
  'Unresponsive',
];

function statusTextClass(status: NetworkingContactStatus): string {
  switch (status) {
    case 'Referred':
      return 'text-emerald-700 font-medium';
    case 'Coffee Chat Scheduled':
    case 'Replied':
      return 'text-blue-700 font-medium';
    case 'Message Sent':
      return 'text-amber-700 font-medium';
    default:
      return 'text-zinc-600';
  }
}

function sentimentSelectClass(sentiment: NetworkingContactSentiment): string {
  switch (sentiment) {
    case 'Champion':
      return 'text-emerald-700 font-medium bg-emerald-50/70 border-emerald-200';
    case 'Warm':
      return 'text-blue-700 font-medium bg-blue-50/60 border-blue-200';
    case 'Cold':
      return 'text-amber-700 font-medium bg-amber-50/70 border-amber-200';
    case 'Unresponsive':
      return 'text-red-700 font-medium bg-red-50/70 border-red-200';
    default:
      return 'text-zinc-700 bg-zinc-50 border-zinc-200';
  }
}

function getFollowUpState(
  followUpDate?: string
): 'overdue' | 'today' | 'upcoming' | 'none' {
  if (!followUpDate) return 'none';
  const todayIso = getLocalTodayIso();
  if (followUpDate < todayIso) return 'overdue';
  if (followUpDate === todayIso) return 'today';
  return 'upcoming';
}

type LinkedInDraftTone = 'intro' | 'warm' | 'referral';

const LINKEDIN_NOTE_LIMIT = 300;

function LinkedInIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M19 3A2 2 0 0 1 21 5V19A2 2 0 0 1 19 21H5A2 2 0 0 1 3 19V5A2 2 0 0 1 5 3H19M18.5 18.5V13.2A3.26 3.26 0 0 0 15.24 9.94C14.39 9.94 13.4 10.46 12.92 11.24V10.13H10.13V18.5H12.92V13.57C12.92 12.8 13.54 12.17 14.31 12.17A1.4 1.4 0 0 1 15.71 13.57V18.5H18.5M6.88 8.56A1.68 1.68 0 0 0 8.56 6.88C8.56 5.95 7.81 5.19 6.88 5.19A1.69 1.69 0 0 0 5.19 6.88C5.19 7.81 5.95 8.56 6.88 8.56M8.27 18.5V10.13H5.5V18.5H8.27Z" />
    </svg>
  );
}

function getLinkedInTargetUrl(job: JobRecord, contact: NetworkingContact | null): string {
  if (contact?.profileUrl && /linkedin\.com/i.test(contact.profileUrl)) {
    return contact.profileUrl.startsWith('http')
      ? contact.profileUrl
      : `https://${contact.profileUrl}`;
  }
  const query = contact
    ? `${contact.name} ${job.company}`
    : `${job.company} ${job.title}`;
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`;
}

function buildLinkedInConnectionDraft(
  job: JobRecord,
  contact: NetworkingContact | null,
  tone: LinkedInDraftTone = 'intro'
): string {
  const topSkills = job.skills.slice(0, 2).join(' and ');
  const skillPhrase = topSkills ? topSkills : 'this space';
  const company = job.company.trim();
  const title = job.title.trim();

  if (!contact) {
    const general = `Hi there, I'm excited about the ${title} opening at ${company}, especially the focus on ${skillPhrase}. I'd love to connect and learn more about what the team is building.`;
    return general.length <= LINKEDIN_NOTE_LIMIT
      ? general
      : `Hi there, I'm excited about the ${title} role at ${company} and would love to connect to learn more about the team.`;
  }

  const firstName = contact.name.trim().split(/\s+/)[0] || 'there';
  const roleText = (contact.role || '').trim();
  const roleLower = `${roleText} ${contact.notes || ''}`.toLowerCase();
  const isRecruiter = /recruit|talent|people|sourc/.test(roleLower);
  const isLeader = /hiring manager|vp|director|head of|cto|ceo|founder|chief|principal/.test(
    roleLower
  );
  const shortRole =
    roleText && roleText.toLowerCase() !== 'connection' ? roleText : '';

  let message = '';

  if (tone === 'warm') {
    message = shortRole
      ? `Hi ${firstName}, hope you're doing well! I'm exploring the ${title} role at ${company} and came across your work as ${shortRole}. Would love to connect and hear your perspective on the team.`
      : `Hi ${firstName}, hope you're doing well! I'm exploring the ${title} role at ${company} and would love to connect on LinkedIn and hear your perspective on the team.`;
  } else if (tone === 'referral') {
    message = `Hi ${firstName}, I'm preparing to apply for the ${title} role at ${company}—my background in ${skillPhrase} aligns closely with the team's focus. Would love to connect and ask a quick question about the role!`;
  } else if (isRecruiter) {
    message = `Hi ${firstName}, I came across the ${title} opening at ${company} and was drawn to the focus on ${skillPhrase}. My background maps closely to the role—would love to connect and stay in touch.`;
  } else if (isLeader) {
    message = `Hi ${firstName}, I've been following ${company}'s work and saw the ${title} opening on your team. With my background in ${skillPhrase}, I'd love to connect and follow what your team is building.`;
  } else if (shortRole) {
    message = `Hi ${firstName}, I noticed your work as ${shortRole} at ${company} while exploring the ${title} role. Given my background in ${skillPhrase}, I'd love to connect and hear about your experience on the team.`;
  } else {
    message = `Hi ${firstName}, I'm exploring the ${title} opening at ${company} and saw you're on the team. Given my background in ${skillPhrase}, I'd love to connect on LinkedIn and learn more about your work there.`;
  }

  if (message.length <= LINKEDIN_NOTE_LIMIT) return message;

  // Compact fallback guaranteed to stay within LinkedIn's 300-char limit
  const compact = `Hi ${firstName}, I'm exploring the ${title} role at ${company}. With my background in ${skillPhrase}, I'd love to connect and learn more about the team.`;
  return compact.length <= LINKEDIN_NOTE_LIMIT
    ? compact
    : `Hi ${firstName}, I'm interested in the ${title} role at ${company} and would love to connect on LinkedIn.`.slice(
        0,
        LINKEDIN_NOTE_LIMIT
      );
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to execCommand below for sandboxed iframes
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

function renderFormattedDescription(text: string) {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  return (
    <div className="space-y-3 text-[13.5px] leading-relaxed text-zinc-700">
      {blocks.map((block, idx) => {
        const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
        if (lines.length === 0) return null;

        // Check if first line is a short section heading followed by body or bullets
        const firstLine = lines[0];
        const isHeadingLine =
          firstLine.length <= 54 &&
          !firstLine.startsWith('-') &&
          !firstLine.startsWith('•') &&
          !firstLine.endsWith('.') &&
          (lines.length > 1 || /^[A-Z][A-Za-z0-9 &/'-]+:?$/.test(firstLine));

        const restLines = isHeadingLine ? lines.slice(1) : lines;
        const bulletLines = restLines.filter((l) => /^[-•*]\s+/.test(l));
        const plainLines = restLines.filter((l) => !/^[-•*]\s+/.test(l));

        return (
          <div key={idx} className="space-y-1.5">
            {isHeadingLine && (
              <h4 className="text-xs font-semibold text-zinc-900 pt-1">
                {firstLine.replace(/:$/, '')}
              </h4>
            )}
            {plainLines.map((line, pIdx) => (
              <p key={`p-${pIdx}`} className="text-zinc-700">
                {line}
              </p>
            ))}
            {bulletLines.length > 0 && (
              <ul className="list-disc pl-4 space-y-1 text-zinc-700">
                {bulletLines.map((b, bIdx) => (
                  <li key={`b-${bIdx}`}>{b.replace(/^[-•*]\s+/, '')}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function JobDetailDrawer({
  job,
  events,
  resumes,
  targetRoleTypes,
  coverLetterSamples,
  careerExperiences,
  careerContextNotes,
  resumeReviewResult,
  coverLetterResult,
  onSaveResume,
  onSaveCoverLetterSample,
  onOpenResumesView,
  onSaveResumeReview,
  onSaveCoverLetterResult,
  onClose,
  onMoveStage,
  onUpdateJobAttributes,
  onUpdateJobDetails,
  onExtractDetailsFromUrl,
  onUpdateNotes,
  onUpdateFullDescription,
  onFetchFullDescription,
  onUpdateNetworkingContacts,
  onThumbsUp,
  onThumbsDown,
  onRestoreJob,
  onDeleteJob,
  onAddEvent,
}: JobDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'networking'>('overview');
  const [notesDraft, setNotesDraft] = useState('');
  const [dislikeOpen, setDislikeOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Full role details edit & URL autopopulate state
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [editJobUrl, setEditJobUrl] = useState('');
  const [editCompanyDomain, setEditCompanyDomain] = useState('');
  const [editSalaryLabel, setEditSalaryLabel] = useState('');
  const [editSalaryMin, setEditSalaryMin] = useState<number | null>(null);
  const [editSalaryMax, setEditSalaryMax] = useState<number | null>(null);
  const [editLocation, setEditLocation] = useState('');
  const [editLocationType, setEditLocationType] = useState<LocationType>('Hybrid');
  const [editEmploymentType, setEditEmploymentType] = useState('Full-time');
  const [editIsMbaRole, setEditIsMbaRole] = useState(false);
  const [editPriority, setEditPriority] = useState<JobPriority | ''>('');
  const [editDeadlineAt, setEditDeadlineAt] = useState('');
  const [editSkillsText, setEditSkillsText] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [editFullDescription, setEditFullDescription] = useState('');
  const [editMatchScore, setEditMatchScore] = useState<number | undefined>(undefined);
  const [editMatchReason, setEditMatchReason] = useState<string | undefined>(undefined);
  const [isPopulatingFromUrl, setIsPopulatingFromUrl] = useState(false);
  const [populateError, setPopulateError] = useState<string | null>(null);
  const [populateSuccess, setPopulateSuccess] = useState<string | null>(null);

  // Full job description UI state
  const [jdExpanded, setJdExpanded] = useState(true);
  const [editingJd, setEditingJd] = useState(false);
  const [jdDraft, setJdDraft] = useState('');
  const [isFetchingJd, setIsFetchingJd] = useState(false);

  // Resume Review Comments UI state
  const [selectedResumeId, setSelectedResumeId] = useState<string>('');
  const [reviewFocus, setReviewFocus] = useState('');
  const [isReviewingResume, setIsReviewingResume] = useState(false);
  const [isQuickUploadingResume, setIsQuickUploadingResume] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [commentCategoryFilter, setCommentCategoryFilter] = useState<
    'all' | ResumeCommentCategory
  >('all');
  const [commentViewMode, setCommentViewMode] = useState<'comments' | 'annotated'>('comments');
  const [copiedCommentId, setCopiedCommentId] = useState<string | null>(null);

  // Cover Letter Generator UI state
  const [selectedSampleId, setSelectedSampleId] = useState<string>('');
  const [coverLetterFocus, setCoverLetterFocus] = useState('');
  const [isGeneratingCoverLetter, setIsGeneratingCoverLetter] = useState(false);
  const [isUploadingSampleRole, setIsUploadingSampleRole] = useState<string | null>(null);
  const [coverLetterError, setCoverLetterError] = useState<string | null>(null);
  const [showCoverLetterPreview, setShowCoverLetterPreview] = useState(true);
  const [coverLetterCopied, setCoverLetterCopied] = useState(false);

  // Scheduled events state
  const [eventDate, setEventDate] = useState(() => getLocalTodayIso());
  const [eventType, setEventType] = useState<'interview' | 'followup'>('interview');
  const [eventLabel, setEventLabel] = useState('');

  // Networking tracker state
  const [showAddContact, setShowAddContact] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactRole, setContactRole] = useState('');
  const [contactChannel, setContactChannel] = useState<NetworkingChannel>('LinkedIn');
  const [contactStatus, setContactStatus] = useState<NetworkingContactStatus>('To Reach Out');
  const [contactSentiment, setContactSentiment] =
    useState<NetworkingContactSentiment>('Neutral');
  const [contactFollowUp, setContactFollowUp] = useState('');
  const [contactProfileUrl, setContactProfileUrl] = useState('');
  const [contactNotes, setContactNotes] = useState('');
  const [networkingStatusFilter, setNetworkingStatusFilter] = useState<
    'all' | NetworkingContactStatus
  >('all');
  const [networkingSentimentFilter, setNetworkingSentimentFilter] = useState<
    'all' | NetworkingContactSentiment
  >('all');
  const [editingContactNoteId, setEditingContactNoteId] = useState<string | null>(null);
  const [contactNoteDraft, setContactNoteDraft] = useState('');

  // LinkedIn outreach export state
  const [showLinkedInExport, setShowLinkedInExport] = useState(false);
  const [selectedLinkedInContactId, setSelectedLinkedInContactId] = useState<string>('');
  const [linkedInTone, setLinkedInTone] = useState<LinkedInDraftTone>('intro');
  const [linkedInDrafts, setLinkedInDrafts] = useState<Record<string, string>>({});
  const [linkedInCopiedKey, setLinkedInCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (job) {
      setActiveTab('overview');
      setNotesDraft(job.notes);
      setJdDraft(job.fullDescription || job.summary || '');
      setEditingJd(false);
      setJdExpanded(true);
      setIsEditingDetails(false);
      setPopulateError(null);
      setPopulateSuccess(null);
      setIsPopulatingFromUrl(false);
      setDislikeOpen(false);
      setConfirmDelete(false);
      setShowAddContact(false);
      setNetworkingStatusFilter('all');
      setNetworkingSentimentFilter('all');
      setEditingContactNoteId(null);
      setContactNoteDraft('');
      setShowLinkedInExport(false);
      setSelectedLinkedInContactId(job.networkingContacts?.[0]?.id || '__general__');
      setLinkedInTone('intro');
      setLinkedInDrafts({});
      setLinkedInCopiedKey(null);
      setReviewError(null);
      setReviewFocus('');
      setCommentCategoryFilter('all');
      setCopiedCommentId(null);
      setCoverLetterError(null);
      setCoverLetterFocus('');
      setCoverLetterCopied(false);
      const best = selectBestResumeForJob(job, resumes);
      setSelectedResumeId(best?.id || '');
      const bestSample = selectBestCoverLetterSampleForJob(job, coverLetterSamples);
      setSelectedSampleId(bestSample?.id || '');
    }
  }, [job?.id]);

  useEffect(() => {
    if (!job) return;
    if (resumes.length > 0 && !resumes.some((r) => r.id === selectedResumeId)) {
      const best = selectBestResumeForJob(job, resumes);
      setSelectedResumeId(best?.id || resumes[0].id);
    }
  }, [resumes, selectedResumeId, job]);

  useEffect(() => {
    if (!job) return;
    if (
      coverLetterSamples.length > 0 &&
      !coverLetterSamples.some((s) => s.id === selectedSampleId)
    ) {
      const bestSample = selectBestCoverLetterSampleForJob(job, coverLetterSamples);
      setSelectedSampleId(bestSample?.id || coverLetterSamples[0].id);
    }
  }, [coverLetterSamples, selectedSampleId, job]);

  useEffect(() => {
    if (job && !editingJd) {
      setJdDraft(job.fullDescription || job.summary || '');
    }
  }, [job?.fullDescription, job?.summary, editingJd, job]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (job) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [job, onClose]);

  if (!job) return null;

  const jobEvents = events.filter((e) => e.jobId === job.id);
  const contacts = job.networkingContacts ?? [];
  const fullDescText = (job.fullDescription || '').trim();
  const hasRichFullDesc = fullDescText.length > 280;
  const normalizedEmploymentType = normalizeEmploymentType(
    job.employmentType,
    job.title,
    `${job.summary} ${job.fullDescription || ''}`
  );
  const isMbaRole = job.isMbaRole ?? detectIsMbaRole(job.title);
  const coverLetterUnlock = getCoverLetterUnlockStatus(
    targetRoleTypes,
    coverLetterSamples
  );
  const activeCoverLetterSample =
    coverLetterSamples.find((s) => s.id === selectedSampleId) ??
    selectBestCoverLetterSampleForJob(job, coverLetterSamples) ??
    coverLetterSamples[0] ??
    null;

  const handleSchedule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventDate) return;
    onAddEvent({
      jobId: job.id,
      date: eventDate,
      type: eventType,
      label:
        eventLabel.trim() ||
        `${eventType === 'interview' ? 'Interview' : 'Follow-up'} — ${job.company}`,
    });
    setEventLabel('');
  };

  const handleSaveJd = () => {
    onUpdateFullDescription(job.id, jdDraft.trim());
    setEditingJd(false);
  };

  const handleFetchJdClick = async () => {
    if (isFetchingJd) return;
    setIsFetchingJd(true);
    try {
      await onFetchFullDescription(job.id, job.jobUrl || '');
    } finally {
      setIsFetchingJd(false);
    }
  };

  const openEditDetails = (focusUrl = false) => {
    setActiveTab('overview');
    setEditTitle(job.title);
    setEditCompany(job.company);
    setEditJobUrl(job.jobUrl || '');
    setEditCompanyDomain(job.companyDomain || '');
    setEditSalaryLabel(job.salaryLabel || '');
    setEditSalaryMin(job.salaryMin ?? null);
    setEditSalaryMax(job.salaryMax ?? null);
    setEditLocation(job.location || '');
    setEditLocationType(job.locationType);
    setEditEmploymentType(normalizedEmploymentType);
    setEditIsMbaRole(isMbaRole);
    setEditPriority(
      job.priority ??
        (job.stage === 'applied' || job.stage === 'interviewing' || job.stage === 'offer'
          ? 'applied'
          : '')
    );
    setEditDeadlineAt(job.deadlineAt ?? '');
    setEditSkillsText(job.skills.join(', '));
    setEditSummary(job.summary || '');
    setEditFullDescription(job.fullDescription || '');
    setEditMatchScore(undefined);
    setEditMatchReason(undefined);
    setPopulateError(null);
    setPopulateSuccess(null);
    setIsEditingDetails(true);
    if (focusUrl) {
      window.setTimeout(() => {
        document.getElementById('edit-job-url')?.focus();
      }, 40);
    }
  };

  const handlePopulateFromUrl = async () => {
    const rawUrl = editJobUrl.trim();
    if (!rawUrl) {
      setPopulateError('Enter a public job posting URL first.');
      return;
    }
    const normalizedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    setEditJobUrl(normalizedUrl);
    setPopulateError(null);
    setPopulateSuccess(null);
    setIsPopulatingFromUrl(true);
    try {
      const extracted = await onExtractDetailsFromUrl(normalizedUrl, job.stage);
      if (extracted.title && extracted.title.trim()) {
        setEditTitle(extracted.title.trim());
      }
      if (
        extracted.company &&
        extracted.company.trim() &&
        extracted.company.trim().toLowerCase() !== 'unknown company'
      ) {
        setEditCompany(extracted.company.trim());
      }
      if (extracted.jobUrl) {
        setEditJobUrl(extracted.jobUrl);
      }
      if (extracted.companyDomain) {
        setEditCompanyDomain(extracted.companyDomain);
      }
      if (
        extracted.salaryLabel &&
        extracted.salaryLabel.trim() &&
        extracted.salaryLabel.trim().toLowerCase() !== 'not listed'
      ) {
        setEditSalaryLabel(extracted.salaryLabel.trim());
        setEditSalaryMin(extracted.salaryMin ?? null);
        setEditSalaryMax(extracted.salaryMax ?? null);
      }
      if (
        extracted.location &&
        extracted.location.trim() &&
        extracted.location.trim().toLowerCase() !== 'unspecified'
      ) {
        setEditLocation(extracted.location.trim());
      }
      if (extracted.locationType) {
        setEditLocationType(extracted.locationType);
      }
      if (extracted.employmentType) {
        setEditEmploymentType(
          normalizeEmploymentType(
            extracted.employmentType,
            extracted.title,
            extracted.summary
          )
        );
      }
      if (typeof extracted.isMbaRole === 'boolean') {
        setEditIsMbaRole(extracted.isMbaRole);
      }
      if (extracted.deadlineAt) {
        setEditDeadlineAt(extracted.deadlineAt);
      }
      if (Array.isArray(extracted.skills) && extracted.skills.length > 0) {
        setEditSkillsText(extracted.skills.join(', '));
      }
      if (extracted.summary && extracted.summary.trim()) {
        setEditSummary(extracted.summary.trim());
      }
      if (extracted.fullDescription && extracted.fullDescription.trim()) {
        setEditFullDescription(extracted.fullDescription.trim());
      }
      if (typeof extracted.matchScore === 'number') {
        setEditMatchScore(extracted.matchScore);
      }
      if (extracted.matchReason && extracted.matchReason.trim()) {
        setEditMatchReason(extracted.matchReason.trim());
      }
      setPopulateSuccess(
        'Auto-populated role details from the URL. Review any fields below and click Save Changes.'
      );
    } catch (err: unknown) {
      setPopulateError(
        err instanceof Error
          ? err.message
          : 'Could not read that URL. Check that it is a public posting link or edit the fields manually.'
      );
    } finally {
      setIsPopulatingFromUrl(false);
    }
  };

  const handleSaveEditedDetails = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = editTitle.trim() || job.title;
    const cleanCompany = editCompany.trim() || job.company;
    const rawUrl = editJobUrl.trim();
    const cleanUrl = rawUrl
      ? /^https?:\/\//i.test(rawUrl)
        ? rawUrl
        : `https://${rawUrl}`
      : '';

    let derivedDomain = editCompanyDomain.trim();
    if (cleanUrl) {
      try {
        derivedDomain = new URL(cleanUrl).hostname.replace(/^www\./, '');
      } catch {
        // Keep existing domain
      }
    }

    const cleanSalaryLabel = editSalaryLabel.trim() || 'Not listed';
    const parsedBounds =
      cleanSalaryLabel !== (job.salaryLabel || '')
        ? parseSalaryBoundsFromLabel(cleanSalaryLabel)
        : { salaryMin: editSalaryMin, salaryMax: editSalaryMax };
    const finalSalaryMin =
      parsedBounds.salaryMin !== null ? parsedBounds.salaryMin : editSalaryMin;
    const finalSalaryMax =
      parsedBounds.salaryMax !== null ? parsedBounds.salaryMax : editSalaryMax;

    const skillsList = editSkillsText
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 25);

    const patch: JobDetailsUpdatePatch = {
      title: cleanTitle,
      company: cleanCompany,
      companyDomain: derivedDomain,
      jobUrl: cleanUrl,
      salaryLabel: cleanSalaryLabel,
      salaryMin: finalSalaryMin,
      salaryMax: finalSalaryMax,
      location: editLocation.trim() || 'Unspecified',
      locationType: editLocationType,
      employmentType: editEmploymentType,
      isMbaRole: editIsMbaRole,
      priority:
        editPriority === 'asap' ||
        editPriority === 'high' ||
        editPriority === 'medium' ||
        editPriority === 'low' ||
        editPriority === 'applied'
          ? editPriority
          : null,
      deadlineAt: editDeadlineAt.trim() || null,
      skills: skillsList,
      summary: editSummary.trim(),
      ...(editFullDescription.trim()
        ? { fullDescription: editFullDescription.trim() }
        : {}),
      ...(typeof editMatchScore === 'number' && editMatchScore !== job.matchScore
        ? { previousMatchScore: job.matchScore, matchScore: editMatchScore }
        : {}),
      ...(editMatchReason ? { matchReason: editMatchReason } : {}),
    };

    onUpdateJobDetails(job.id, patch);
    setIsEditingDetails(false);
    setPopulateError(null);
    setPopulateSuccess(null);
  };

  const handleAddContact = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = contactName.trim();
    if (!cleanName) return;

    const todayIso = getLocalTodayIso();
    const nextContact: NetworkingContact = {
      id: `net-${Date.now()}`,
      name: cleanName,
      role: contactRole.trim() || 'Connection',
      channel: contactChannel,
      status: contactStatus,
      sentiment: contactSentiment,
      lastContactDate: contactStatus === 'To Reach Out' ? undefined : todayIso,
      followUpDate: contactFollowUp.trim() || undefined,
      profileUrl: contactProfileUrl.trim() || undefined,
      notes: contactNotes.trim() || undefined,
    };

    onUpdateNetworkingContacts(job.id, [nextContact, ...contacts]);
    setContactName('');
    setContactRole('');
    setContactChannel('LinkedIn');
    setContactStatus('To Reach Out');
    setContactSentiment('Neutral');
    setContactFollowUp('');
    setContactProfileUrl('');
    setContactNotes('');
    setShowAddContact(false);
  };

  const handleChangeContactStatus = (
    contactId: string,
    nextStatus: NetworkingContactStatus
  ) => {
    const todayIso = getLocalTodayIso();
    const updated = contacts.map((c) =>
      c.id === contactId
        ? {
            ...c,
            status: nextStatus,
            lastContactDate:
              nextStatus === 'To Reach Out' ? c.lastContactDate : todayIso,
          }
        : c
    );
    onUpdateNetworkingContacts(job.id, updated);
  };

  const handleChangeContactSentiment = (
    contactId: string,
    nextSentiment: NetworkingContactSentiment
  ) => {
    const updated = contacts.map((c) =>
      c.id === contactId ? { ...c, sentiment: nextSentiment } : c
    );
    onUpdateNetworkingContacts(job.id, updated);
  };

  const handleChangeContactFollowUp = (
    contactId: string,
    nextFollowUpDate: string
  ) => {
    const cleanDate = nextFollowUpDate.trim();
    const updated = contacts.map((c) =>
      c.id === contactId
        ? { ...c, followUpDate: cleanDate || undefined }
        : c
    );
    onUpdateNetworkingContacts(job.id, updated);
  };

  const handleSaveContactNotes = (contactId: string, nextNotes: string) => {
    const trimmed = nextNotes.trim();
    const updated = contacts.map((c) =>
      c.id === contactId ? { ...c, notes: trimmed || undefined } : c
    );
    onUpdateNetworkingContacts(job.id, updated);
    setEditingContactNoteId(null);
    setContactNoteDraft('');
  };

  const handleRemoveContact = (contactId: string) => {
    onUpdateNetworkingContacts(
      job.id,
      contacts.filter((c) => c.id !== contactId)
    );
  };

  const engagedCount = contacts.filter(
    (c) =>
      c.status === 'Replied' ||
      c.status === 'Coffee Chat Scheduled' ||
      c.status === 'Referred'
  ).length;

  const positiveSentimentCount = contacts.filter(
    (c) => c.sentiment === 'Champion' || c.sentiment === 'Warm'
  ).length;

  const upcomingFollowUpDates = contacts
    .map((c) => c.followUpDate)
    .filter((d): d is string => Boolean(d))
    .sort();
  const nextFollowUpDate = upcomingFollowUpDates[0] ?? null;
  const hasDueFollowUp = contacts.some((c) => {
    const st = getFollowUpState(c.followUpDate);
    return st === 'overdue' || st === 'today';
  });

  const filteredContacts = contacts.filter((c) => {
    if (networkingStatusFilter !== 'all' && c.status !== networkingStatusFilter) {
      return false;
    }
    const effectiveSentiment: NetworkingContactSentiment = c.sentiment ?? 'Neutral';
    if (
      networkingSentimentFilter !== 'all' &&
      effectiveSentiment !== networkingSentimentFilter
    ) {
      return false;
    }
    return true;
  });

  const activeLinkedInContact: NetworkingContact | null =
    contacts.find((c) => c.id === selectedLinkedInContactId) ?? contacts[0] ?? null;
  const activeLinkedInDraftKey = activeLinkedInContact?.id || '__general__';
  const activeLinkedInMessage =
    linkedInDrafts[activeLinkedInDraftKey] ??
    buildLinkedInConnectionDraft(job, activeLinkedInContact, linkedInTone);
  const activeLinkedInUrl = getLinkedInTargetUrl(job, activeLinkedInContact);

  const openLinkedInExportForContact = (contact?: NetworkingContact) => {
    const target = contact ?? contacts[0] ?? null;
    const key = target?.id || '__general__';
    setSelectedLinkedInContactId(key);
    setLinkedInDrafts((prev) =>
      prev[key] !== undefined
        ? prev
        : {
            ...prev,
            [key]: buildLinkedInConnectionDraft(job, target, linkedInTone),
          }
    );
    setShowLinkedInExport(true);
  };

  const handleLinkedInToneChange = (nextTone: LinkedInDraftTone) => {
    setLinkedInTone(nextTone);
    setLinkedInDrafts((prev) => ({
      ...prev,
      [activeLinkedInDraftKey]: buildLinkedInConnectionDraft(
        job,
        activeLinkedInContact,
        nextTone
      ),
    }));
  };

  const handleCopyLinkedInDraft = async (copyKey: string, text: string) => {
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setLinkedInCopiedKey(copyKey);
      window.setTimeout(() => {
        setLinkedInCopiedKey((prev) => (prev === copyKey ? null : prev));
      }, 2200);
    }
  };

  const handleCopyAllLinkedInDrafts = async () => {
    if (contacts.length === 0) {
      await handleCopyLinkedInDraft('all', activeLinkedInMessage);
      return;
    }
    const combined = contacts
      .map((c) => {
        const msg =
          linkedInDrafts[c.id] ?? buildLinkedInConnectionDraft(job, c, linkedInTone);
        return `${c.name} (${c.role} @ ${job.company})\n${getLinkedInTargetUrl(job, c)}\n${msg}`;
      })
      .join('\n\n---\n\n');
    await handleCopyLinkedInDraft('all', combined);
  };

  const activeBaseResume =
    resumes.find((r) => r.id === selectedResumeId) ?? resumes[0] ?? null;

  const offResumeCount = careerExperiences.filter((e) => !e.onResume).length;
  const hasAdditionalNonResumeInfo =
    offResumeCount > 0 || Boolean(careerContextNotes.trim());

  const handleQuickUploadResume = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setReviewError(null);
    setIsQuickUploadingResume(true);
    try {
      const rawText = await parseResumeFileOnServer(file);
      const inferredTrack = job.title.toLowerCase().includes('marketing')
        ? 'Product Marketing Manager'
        : job.title.toLowerCase().includes('product')
        ? 'Product Manager'
        : job.title.toLowerCase().includes('strategy')
        ? 'Strategy & Operations'
        : 'Primary Resume';
      const created: RoleResume = {
        id: `res-${Date.now().toString(36)}`,
        roleType: inferredTrack,
        fileName: file.name,
        rawText,
        uploadedAt: getLocalTodayIso(),
      };
      onSaveResume(created);
      setSelectedResumeId(created.id);
    } catch (err: unknown) {
      setReviewError(
        err instanceof Error ? err.message : 'Could not parse uploaded resume.'
      );
    } finally {
      setIsQuickUploadingResume(false);
    }
  };

  const handleReviewResume = async () => {
    if (!activeBaseResume || isReviewingResume) return;
    setReviewError(null);
    setIsReviewingResume(true);
    try {
      const res = await fetch('/api/resumes/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job: {
            title: job.title,
            company: job.company,
            location: job.location,
            locationType: job.locationType,
            skills: job.skills,
            summary: job.summary,
            fullDescription: job.fullDescription,
          },
          baseResume: activeBaseResume,
          careerExperiences,
          careerContextNotes,
          customInstructions: reviewFocus.trim() || undefined,
          timeZone: getClientTimeZone(),
        }),
      });
      const data = (await res.json()) as {
        review?: ResumeReviewDocument;
        docxBase64?: string;
        fileName?: string;
        error?: string;
      };
      if (!res.ok || !data.review || !data.docxBase64) {
        throw new Error(data.error || 'Failed to generate resume review comments.');
      }
      onSaveResumeReview(job.id, {
        review: data.review,
        docxBase64: data.docxBase64,
        fileName: data.fileName || `${job.company}_Resume_Comments.docx`,
      });
      setCommentCategoryFilter('all');
    } catch (err: unknown) {
      setReviewError(
        err instanceof Error ? err.message : 'Could not review base resume.'
      );
    } finally {
      setIsReviewingResume(false);
    }
  };

  const handleCopyReviewText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCommentId(id);
      window.setTimeout(() => {
        setCopiedCommentId((prev) => (prev === id ? null : prev));
      }, 2000);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleCopyAllReviewComments = async () => {
    if (!resumeReviewResult) return;
    const rev = resumeReviewResult.review;
    const formatted = [
      `Resume Review Comments — ${job.title} @ ${job.company}`,
      `Base Resume: ${rev.roleTypeUsed} (${rev.baseResumeFileName})`,
      '',
      `Overall Fit: ${rev.overallFitNote}`,
      ...(rev.missingRequirements.length > 0
        ? ['', `Key Gaps: ${rev.missingRequirements.join(' · ')}`]
        : []),
      '',
      ...rev.comments.map((c) => {
        const loc =
          c.anchorLineNumber !== null
            ? `Line ${c.anchorLineNumber} · ${c.sectionLabel}`
            : c.sectionLabel;
        return [
          `[${c.category.toUpperCase()}] ${c.title} (${loc})`,
          c.anchorQuote ? `  On: "${c.anchorQuote}"` : null,
          `  Note: ${c.comment}`,
          c.suggestedText ? `  Suggested idea: ${c.suggestedText}` : null,
        ]
          .filter(Boolean)
          .join('\n');
      }),
    ].join('\n');
    await handleCopyReviewText('all-comments', formatted);
  };

  const handleQuickUploadCoverLetterSample = async (
    roleType: string,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setCoverLetterError(null);
    setIsUploadingSampleRole(roleType);
    try {
      const rawText = await parseResumeFileOnServer(file);
      const existing = coverLetterSamples.find(
        (s) => s.roleType.toLowerCase() === roleType.toLowerCase()
      );
      const created: CoverLetterSample = {
        id:
          existing?.id ||
          `cl-${roleType.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-${Date.now().toString(36)}`,
        roleType,
        fileName: file.name,
        rawText,
        uploadedAt: getLocalTodayIso(),
      };
      onSaveCoverLetterSample(created);
      setSelectedSampleId(created.id);
    } catch (err: unknown) {
      setCoverLetterError(
        err instanceof Error ? err.message : 'Could not parse uploaded cover letter sample.'
      );
    } finally {
      setIsUploadingSampleRole(null);
    }
  };

  const handleGenerateCoverLetter = async () => {
    if (!activeCoverLetterSample || isGeneratingCoverLetter) return;
    setCoverLetterError(null);
    setIsGeneratingCoverLetter(true);
    try {
      const res = await fetch('/api/cover-letters/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job: {
            title: job.title,
            company: job.company,
            location: job.location,
            locationType: job.locationType,
            employmentType: normalizedEmploymentType,
            isMbaRole,
            skills: job.skills,
            summary: job.summary,
            fullDescription: job.fullDescription,
            notes: job.notes,
          },
          sample: activeCoverLetterSample,
          baseResume: activeBaseResume,
          careerExperiences,
          careerContextNotes,
          customInstructions: coverLetterFocus.trim() || undefined,
          timeZone: getClientTimeZone(),
        }),
      });
      const data = (await res.json()) as {
        coverLetter?: GeneratedCoverLetter;
        docxBase64?: string;
        fileName?: string;
        error?: string;
      };
      if (!res.ok || !data.coverLetter || !data.docxBase64) {
        throw new Error(data.error || 'Failed to generate cover letter.');
      }
      onSaveCoverLetterResult(job.id, {
        coverLetter: data.coverLetter,
        docxBase64: data.docxBase64,
        fileName: data.fileName || `${job.company}_Cover_Letter.docx`,
      });
      setShowCoverLetterPreview(true);
    } catch (err: unknown) {
      setCoverLetterError(
        err instanceof Error ? err.message : 'Could not generate cover letter.'
      );
    } finally {
      setIsGeneratingCoverLetter(false);
    }
  };

  const handleCopyCoverLetter = async () => {
    if (!coverLetterResult) return;
    const cl = coverLetterResult.coverLetter;
    const plain = [
      cl.candidateName,
      cl.contactLine,
      '',
      cl.dateLine,
      '',
      cl.recipientLine,
      '',
      cl.salutation,
      '',
      ...cl.paragraphs.map((p) => `${p}\n`),
      cl.signOff,
    ]
      .filter((line) => line !== undefined)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const ok = await copyTextToClipboard(plain);
    if (ok) {
      setCoverLetterCopied(true);
      window.setTimeout(() => setCoverLetterCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div
        className="fixed inset-0 bg-zinc-950/25 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${job.title} at ${job.company}`}
        className="relative z-50 w-full max-w-xl bg-white h-full border-l border-zinc-200 flex flex-col shadow-xl"
      >
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-zinc-200 flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-zinc-500">
              {job.isNew && (
                <>
                  <span className="font-semibold text-blue-600">New</span>
                  <span aria-hidden="true">·</span>
                </>
              )}
              <span className="font-medium text-zinc-700">{job.company}</span>
              <span aria-hidden="true">·</span>
              <span>{job.atsType}</span>
            </div>
            <h2 className="mt-1 text-lg font-semibold text-zinc-950 leading-snug">
              {job.title}
            </h2>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (isEditingDetails) {
                  setIsEditingDetails(false);
                  setPopulateError(null);
                  setPopulateSuccess(null);
                } else {
                  openEditDetails();
                }
              }}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                isEditingDetails
                  ? 'text-zinc-900 bg-zinc-100 border-zinc-300'
                  : 'text-zinc-700 bg-white border-zinc-200 hover:bg-zinc-50 hover:text-zinc-950'
              }`}
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>{isEditingDetails ? 'Cancel Edit' : 'Edit Info'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close role details"
              className="p-1.5 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-md cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Drawer Tab Navigation */}
        <div
          role="tablist"
          aria-label="Role detail sections"
          className="px-6 border-b border-zinc-200 bg-zinc-50/50 flex items-center gap-6 shrink-0"
        >
          <button
            type="button"
            role="tab"
            id="drawer-tab-overview"
            aria-selected={activeTab === 'overview'}
            aria-controls="drawer-panel-overview"
            onClick={() => setActiveTab('overview')}
            className={`relative py-2.5 text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'overview'
                ? 'text-zinc-950'
                : 'text-zinc-500 hover:text-zinc-800'
            }`}
          >
            <span>Overview</span>
            {activeTab === 'overview' && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-zinc-950 rounded-full" />
            )}
          </button>

          <button
            type="button"
            role="tab"
            id="drawer-tab-networking"
            aria-selected={activeTab === 'networking'}
            aria-controls="drawer-panel-networking"
            onClick={() => setActiveTab('networking')}
            className={`relative py-2.5 inline-flex items-center gap-1.5 text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'networking'
                ? 'text-zinc-950'
                : 'text-zinc-500 hover:text-zinc-800'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Networking</span>
            <span className="font-mono text-[11px] text-zinc-400 tabular-nums">
              {contacts.length}
            </span>
            {hasDueFollowUp && (
              <span
                title="Follow-up due today or overdue"
                className="w-1.5 h-1.5 rounded-full bg-amber-500"
              />
            )}
            {activeTab === 'networking' && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-zinc-950 rounded-full" />
            )}
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {activeTab === 'overview' ? (
            <div
              id="drawer-panel-overview"
              role="tabpanel"
              aria-labelledby="drawer-tab-overview"
              className="space-y-6"
            >
          {/* Quick Triage & Stage Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-5 border-b border-zinc-100">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label htmlFor="detail-stage" className="text-xs font-medium text-zinc-500">
                  Stage
                </label>
                <select
                  id="detail-stage"
                  value={job.stage}
                  onChange={(e) => onMoveStage(job.id, e.target.value as PipelineStage)}
                  className="h-8 px-2.5 text-xs font-medium bg-white border border-zinc-200 rounded-md text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                >
                  {STAGES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <label
                  htmlFor="detail-priority"
                  className="text-xs font-medium text-zinc-500"
                >
                  Priority
                </label>
                <select
                  id="detail-priority"
                  aria-label="Role priority"
                  value={
                    job.priority ??
                    (job.stage === 'applied' ||
                    job.stage === 'interviewing' ||
                    job.stage === 'offer'
                      ? 'applied'
                      : '')
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    onUpdateJobAttributes(job.id, {
                      priority:
                        val === 'asap' ||
                        val === 'high' ||
                        val === 'medium' ||
                        val === 'low' ||
                        val === 'applied'
                          ? val
                          : null,
                    });
                  }}
                  className={`h-8 px-2.5 text-xs font-medium rounded-md border cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 ${
                    job.priority === 'asap'
                      ? 'bg-rose-100/80 text-rose-800 border-rose-300 font-semibold'
                      : job.priority === 'high'
                      ? 'bg-red-50/70 text-red-700 border-red-200 font-semibold'
                      : job.priority === 'medium'
                      ? 'bg-amber-50/70 text-amber-700 border-amber-200'
                      : job.priority === 'low'
                      ? 'bg-blue-50/60 text-blue-700 border-blue-200'
                      : job.priority === 'applied' ||
                        (!job.priority &&
                          (job.stage === 'applied' ||
                            job.stage === 'interviewing' ||
                            job.stage === 'offer'))
                      ? 'bg-emerald-100/85 text-emerald-800 border-emerald-300 font-semibold'
                      : 'bg-white text-zinc-700 border-zinc-200'
                  }`}
                >
                  <option value="">None</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="asap">ASAP</option>
                  <option value="applied">Applied</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2 relative">
              {confirmDelete ? (
                <div className="inline-flex items-center gap-1.5">
                  <span className="text-xs text-red-700 font-medium">Delete role?</span>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDelete(false);
                      onDeleteJob(job.id);
                    }}
                    className="px-2.5 py-1 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md cursor-pointer"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="px-2 py-1 text-xs text-zinc-500 hover:text-zinc-900 rounded-md cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  {job.stage === 'archived' ? (
                    <button
                      type="button"
                      onClick={() => onRestoreJob(job.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Restore to Saved</span>
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onThumbsUp(job.id)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                          job.feedback === 'up'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-white text-zinc-700 border-zinc-200 hover:bg-emerald-50 hover:text-emerald-800'
                        }`}
                      >
                        <ThumbsUp className="w-3.5 h-3.5" />
                        <span>{job.feedback === 'up' ? 'Upvoted' : 'Thumbs Up'}</span>
                      </button>

                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setDislikeOpen((v) => !v)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-red-50 hover:text-red-700 hover:border-red-200 rounded-md transition-colors cursor-pointer"
                        >
                          <ThumbsDown className="w-3.5 h-3.5" />
                          <span>Hide</span>
                        </button>
                        {dislikeOpen && (
                          <DislikeReasonPopover
                            onSelect={(reason) => {
                              setDislikeOpen(false);
                              onThumbsDown(job.id, reason);
                            }}
                            onClose={() => setDislikeOpen(false)}
                          />
                        )}
                      </div>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setDislikeOpen(false);
                      setConfirmDelete(true);
                    }}
                    title="Delete role permanently"
                    aria-label="Delete role"
                    className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 rounded-md transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Inline Edit Role Details & URL Auto-Populate Form */}
          {isEditingDetails && (
            <form
              onSubmit={handleSaveEditedDetails}
              className="p-4 bg-zinc-50/90 border border-zinc-200 rounded-lg space-y-4"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Pencil className="w-3.5 h-3.5 text-blue-600" />
                  <h3 className="text-xs font-semibold text-zinc-950">
                    Edit Role Details
                  </h3>
                </div>
                <span className="text-[11px] text-zinc-500">
                  Paste a posting URL to auto-fill, or edit any field
                </span>
              </div>

              {/* Posting URL + Auto-Populate */}
              <div className="p-3 bg-white border border-zinc-200 rounded-md space-y-2">
                <label
                  htmlFor="edit-job-url"
                  className="block text-[11px] font-medium text-zinc-700"
                >
                  Job Posting URL
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Link2 className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="edit-job-url"
                      type="text"
                      value={editJobUrl}
                      onChange={(e) => setEditJobUrl(e.target.value)}
                      placeholder="https://boards.greenhouse.io/... or company careers URL"
                      className="w-full h-8 pl-8 pr-2.5 text-xs font-mono bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={isPopulatingFromUrl || !editJobUrl.trim()}
                    onClick={() => void handlePopulateFromUrl()}
                    className="inline-flex items-center justify-center gap-1.5 h-8 px-3 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 rounded-md whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed"
                  >
                    {isPopulatingFromUrl ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {isPopulatingFromUrl ? 'Pulling details...' : 'Auto-Populate from URL'}
                    </span>
                  </button>
                </div>

                {populateError && (
                  <div className="p-2 bg-red-50 border border-red-200 rounded text-[11.5px] text-red-700 flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{populateError}</span>
                  </div>
                )}

                {populateSuccess && (
                  <div className="p-2 bg-emerald-50 border border-emerald-200 rounded text-[11.5px] text-emerald-800 flex items-start gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{populateSuccess}</span>
                  </div>
                )}
              </div>

              {/* Core Role Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label
                    htmlFor="edit-job-title"
                    className="block text-[11px] font-medium text-zinc-600 mb-1"
                  >
                    Role Title
                  </label>
                  <input
                    id="edit-job-title"
                    type="text"
                    required
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full h-8 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="edit-job-company"
                    className="block text-[11px] font-medium text-zinc-600 mb-1"
                  >
                    Company
                  </label>
                  <input
                    id="edit-job-company"
                    type="text"
                    required
                    value={editCompany}
                    onChange={(e) => setEditCompany(e.target.value)}
                    className="w-full h-8 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="edit-job-salary"
                    className="block text-[11px] font-medium text-zinc-600 mb-1"
                  >
                    Compensation
                  </label>
                  <input
                    id="edit-job-salary"
                    type="text"
                    value={editSalaryLabel}
                    onChange={(e) => setEditSalaryLabel(e.target.value)}
                    placeholder="e.g., $180k - $215k"
                    className="w-full h-8 px-2.5 text-xs font-mono bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="edit-job-location"
                    className="block text-[11px] font-medium text-zinc-600 mb-1"
                  >
                    Location
                  </label>
                  <input
                    id="edit-job-location"
                    type="text"
                    value={editLocation}
                    onChange={(e) => setEditLocation(e.target.value)}
                    placeholder="e.g., Chicago, IL"
                    className="w-full h-8 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="edit-job-workmode"
                    className="block text-[11px] font-medium text-zinc-600 mb-1"
                  >
                    Work Mode
                  </label>
                  <select
                    id="edit-job-workmode"
                    value={editLocationType}
                    onChange={(e) => setEditLocationType(e.target.value as LocationType)}
                    className="w-full h-8 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                  >
                    <option value="Remote">Remote</option>
                    <option value="Hybrid">Hybrid</option>
                    <option value="Onsite">Onsite</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="edit-job-employment"
                    className="block text-[11px] font-medium text-zinc-600 mb-1"
                  >
                    Employment Type
                  </label>
                  <select
                    id="edit-job-employment"
                    value={editEmploymentType}
                    onChange={(e) => setEditEmploymentType(e.target.value)}
                    className="w-full h-8 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                  >
                    {EMPLOYMENT_TYPES.map((et) => (
                      <option key={et} value={et}>
                        {et}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="edit-job-priority"
                    className="block text-[11px] font-medium text-zinc-600 mb-1"
                  >
                    Priority
                  </label>
                  <select
                    id="edit-job-priority"
                    value={editPriority}
                    onChange={(e) =>
                      setEditPriority(e.target.value as JobPriority | '')
                    }
                    className="w-full h-8 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                  >
                    <option value="">No priority</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="asap">ASAP</option>
                    <option value="applied">Applied</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="edit-job-deadline"
                    className="block text-[11px] font-medium text-zinc-600 mb-1"
                  >
                    Application Deadline
                  </label>
                  <input
                    id="edit-job-deadline"
                    type="text"
                    value={editDeadlineAt}
                    onChange={(e) => setEditDeadlineAt(e.target.value)}
                    placeholder="YYYY-MM-DD (leave blank for Rolling)"
                    className="w-full h-8 px-2.5 text-xs font-mono bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                  />
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-800 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={editIsMbaRole}
                  onChange={(e) => setEditIsMbaRole(e.target.checked)}
                  className="rounded border-zinc-300 text-blue-600 focus:ring-blue-600 cursor-pointer"
                />
                <span>MBA role</span>
              </label>

              <div>
                <label
                  htmlFor="edit-job-skills"
                  className="block text-[11px] font-medium text-zinc-600 mb-1"
                >
                  Key Skills (comma-separated)
                </label>
                <input
                  id="edit-job-skills"
                  type="text"
                  value={editSkillsText}
                  onChange={(e) => setEditSkillsText(e.target.value)}
                  placeholder="Product Strategy, GTM, SQL, B2B SaaS"
                  className="w-full h-8 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>

              <div>
                <label
                  htmlFor="edit-job-summary"
                  className="block text-[11px] font-medium text-zinc-600 mb-1"
                >
                  Role Summary
                </label>
                <textarea
                  id="edit-job-summary"
                  rows={2}
                  value={editSummary}
                  onChange={(e) => setEditSummary(e.target.value)}
                  placeholder="Short role overview..."
                  className="w-full p-2 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>

              {editFullDescription && (
                <div>
                  <label
                    htmlFor="edit-job-fulldesc"
                    className="block text-[11px] font-medium text-zinc-600 mb-1"
                  >
                    Full Job Description (populated from URL / editable)
                  </label>
                  <textarea
                    id="edit-job-fulldesc"
                    rows={4}
                    value={editFullDescription}
                    onChange={(e) => setEditFullDescription(e.target.value)}
                    className="w-full p-2 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-200/80">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingDetails(false);
                    setPopulateError(null);
                    setPopulateSuccess(null);
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-950 rounded-md cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-1.5 text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-md cursor-pointer"
                >
                  Save Changes
                </button>
              </div>
            </form>
          )}

          {/* Structured Key Attributes */}
          <div className="space-y-3">
            {!isEditingDetails && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-zinc-900">Role Details</h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openEditDetails(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11.5px] font-medium text-blue-700 bg-blue-50/70 hover:bg-blue-100/80 border border-blue-200 rounded-md transition-colors cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Auto-Populate from URL</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditDetails(false)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11.5px] font-medium text-zinc-700 bg-white hover:bg-zinc-50 border border-zinc-200 rounded-md transition-colors cursor-pointer"
                  >
                    <Pencil className="w-3 h-3" />
                    <span>Edit Fields</span>
                  </button>
                </div>
              </div>
            )}

            <dl className="grid grid-cols-2 gap-y-3.5 gap-x-6 text-xs">
              <div>
                <dt className="text-zinc-500">Match Score</dt>
                <dd className="mt-0.5 font-mono text-sm font-semibold text-zinc-950 tabular-nums">
                  {job.matchScore}%
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Compensation</dt>
                <dd className="mt-0.5 font-mono text-sm font-medium text-zinc-950 tabular-nums">
                  <button
                    type="button"
                    onClick={() => openEditDetails(false)}
                    title="Click to edit compensation"
                    className="text-left hover:text-blue-700 hover:underline underline-offset-2 cursor-pointer"
                  >
                    {job.salaryLabel}
                  </button>
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Location</dt>
                <dd className="mt-0.5 text-zinc-900">
                  <button
                    type="button"
                    onClick={() => openEditDetails(false)}
                    title="Click to edit location"
                    className="text-left hover:text-blue-700 hover:underline underline-offset-2 cursor-pointer"
                  >
                    {job.locationType} · {job.location}
                  </button>
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Discovered</dt>
                <dd className="mt-0.5 font-mono text-zinc-900 tabular-nums">
                  {job.discoveredAt} · {job.discoveredTime}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Employment Type</dt>
                <dd className="mt-1">
                  <select
                    aria-label="Employment type"
                    value={normalizedEmploymentType}
                    onChange={(e) =>
                      onUpdateJobAttributes(job.id, { employmentType: e.target.value })
                    }
                    className="h-7 px-2 text-xs font-medium bg-white border border-zinc-200 rounded-md text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                  >
                    {EMPLOYMENT_TYPES.map((et) => (
                      <option key={et} value={et}>
                        {et}
                      </option>
                    ))}
                  </select>
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">MBA Role</dt>
                <dd className="mt-1.5">
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-900 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={isMbaRole}
                      onChange={(e) =>
                        onUpdateJobAttributes(job.id, { isMbaRole: e.target.checked })
                      }
                      className="rounded border-zinc-300 text-blue-600 focus:ring-blue-600 cursor-pointer"
                    />
                    <span>{isMbaRole ? 'Yes (MBA role)' : 'Mark as MBA role'}</span>
                  </label>
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Application Deadline</dt>
                <dd className="mt-0.5 font-mono text-zinc-900 tabular-nums">
                  <button
                    type="button"
                    onClick={() => openEditDetails(false)}
                    title="Click to edit application deadline"
                    className="text-left hover:text-blue-700 hover:underline underline-offset-2 cursor-pointer"
                  >
                    {job.deadlineAt ?? 'Rolling'}
                  </button>
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Source Link</dt>
                <dd className="mt-0.5 flex flex-wrap items-center gap-2">
                  {job.jobUrl ? (
                    <>
                      <a
                        href={job.jobUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                      >
                        <span>Open posting</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      {!isEditingDetails && (
                        <button
                          type="button"
                          onClick={() => openEditDetails(true)}
                          className="text-[11px] text-zinc-500 hover:text-zinc-900 underline underline-offset-2 cursor-pointer"
                        >
                          Edit / Re-pull
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openEditDetails(true)}
                      className="inline-flex items-center gap-1 text-blue-600 hover:underline font-medium cursor-pointer"
                    >
                      <Link2 className="w-3 h-3" />
                      <span>Add URL &amp; Auto-fill</span>
                    </button>
                  )}
                </dd>
              </div>
            </dl>
          </div>

          {/* Match Rationale */}
          <div className="pt-5 border-t border-zinc-100 space-y-2">
            <h3 className="text-xs font-semibold text-zinc-900">Agent Match Summary</h3>
            <p className="text-sm leading-relaxed text-zinc-700">{job.matchReason}</p>
            <div className="text-xs text-zinc-500">
              Key skills: <span className="text-zinc-800">{job.skills.join(' · ')}</span>
            </div>
          </div>

          {/* Resume Review Comments (.docx with native Word margin comments — no direct editing) */}
          <div className="pt-5 border-t border-zinc-100 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <MessageSquareText className="w-3.5 h-3.5 text-blue-600" />
                <h3 className="text-xs font-semibold text-zinc-900">
                  Resume Review Comments (.docx)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenResumesView();
                }}
                className="text-[11.5px] font-medium text-blue-600 hover:text-blue-700 cursor-pointer"
              >
                Manage Resumes &amp; Context
              </button>
            </div>

            {/* Prominent note when user has not yet added non-resume skills & experience */}
            {!hasAdditionalNonResumeInfo && (
              <div className="p-3 bg-amber-50/85 border border-amber-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-start gap-2 min-w-0">
                  <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-950 leading-relaxed">
                    <span className="font-semibold">
                      Add your non-resume skills &amp; experience for better comments.
                    </span>{' '}
                    <span className="text-amber-900/90">
                      Upload a master doc or add off-resume roles, projects, and skills so the agent can suggest specific unlisted experience to bring in—not just flag what&apos;s missing.
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenResumesView('context');
                  }}
                  className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11.5px] font-medium text-amber-950 bg-white border border-amber-300 hover:bg-amber-100/70 rounded-md whitespace-nowrap cursor-pointer shrink-0"
                >
                  <Upload className="w-3 h-3" />
                  <span>Add Additional Info</span>
                </button>
              </div>
            )}

            {resumes.length === 0 ? (
              <div className="p-3.5 bg-zinc-50/80 border border-zinc-200 rounded-lg space-y-2.5">
                <p className="text-xs text-zinc-600 leading-relaxed">
                  Upload a role-specific base resume (<span className="font-mono text-zinc-800">.docx</span> recommended). Instead of rewriting your resume, the agent leaves anchored review comments telling you what to move, add, remove, or what&apos;s missing for this role.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-md cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    <span>
                      {isQuickUploadingResume
                        ? 'Reading resume...'
                        : 'Upload .docx Resume'}
                    </span>
                    <input
                      type="file"
                      accept=".docx,.txt,.md,.pdf"
                      disabled={isQuickUploadingResume}
                      onChange={(e) => void handleQuickUploadResume(e)}
                      className="sr-only"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenResumesView('context');
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md cursor-pointer"
                  >
                    Add Non-Resume Skills &amp; Roles
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-3.5 bg-zinc-50/70 border border-zinc-200 rounded-lg space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                  <label
                    htmlFor="drawer-resume-track"
                    className="sm:col-span-3 text-[11.5px] font-medium text-zinc-600"
                  >
                    Base resume
                  </label>
                  <select
                    id="drawer-resume-track"
                    value={activeBaseResume?.id || ''}
                    onChange={(e) => setSelectedResumeId(e.target.value)}
                    className="sm:col-span-9 h-8 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 focus:outline-none focus:border-blue-600"
                  >
                    {resumes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.roleType} — {r.fileName}
                      </option>
                    ))}
                  </select>
                </div>

                {hasAdditionalNonResumeInfo && (
                  <div className="text-[11px] text-zinc-500">
                    Non-resume context active:{' '}
                    <span className="text-zinc-800 font-medium">
                      {offResumeCount > 0
                        ? `${offResumeCount} off-resume role${offResumeCount === 1 ? '' : 's'}`
                        : ''}
                      {offResumeCount > 0 && careerContextNotes.trim() ? ' + ' : ''}
                      {careerContextNotes.trim() ? 'additional skills & background notes' : ''}
                    </span>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={reviewFocus}
                    onChange={(e) => setReviewFocus(e.target.value)}
                    placeholder="Optional focus (e.g., highlight healthcare strategy, keep to 1 page)"
                    className="flex-1 h-8 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-blue-600"
                  />
                  <button
                    type="button"
                    disabled={isReviewingResume}
                    onClick={() => void handleReviewResume()}
                    className="inline-flex items-center justify-center gap-1.5 h-8 px-3 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-md whitespace-nowrap cursor-pointer disabled:cursor-wait shrink-0"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>
                      {isReviewingResume
                        ? 'Leaving Comments...'
                        : resumeReviewResult
                        ? 'Re-Review Resume'
                        : 'Leave Review Comments'}
                    </span>
                  </button>
                </div>

                {reviewError && (
                  <div className="p-2.5 bg-red-50 border border-red-200 rounded-md flex items-start gap-2 text-xs text-red-700">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{reviewError}</span>
                  </div>
                )}

                {resumeReviewResult &&
                  (() => {
                    const rev = resumeReviewResult.review;
                    const counts: Record<ResumeCommentCategory, number> = {
                      move: rev.comments.filter((c) => c.category === 'move').length,
                      add: rev.comments.filter((c) => c.category === 'add').length,
                      remove: rev.comments.filter((c) => c.category === 'remove').length,
                      missing: rev.comments.filter((c) => c.category === 'missing').length,
                    };
                    const filteredComments =
                      commentCategoryFilter === 'all'
                        ? rev.comments
                        : rev.comments.filter((c) => c.category === commentCategoryFilter);

                    const categoryMeta: Record<
                      ResumeCommentCategory,
                      {
                        label: string;
                        badge: string;
                        border: string;
                        lineHighlight: string;
                      }
                    > = {
                      move: {
                        label: 'Move',
                        badge: 'bg-blue-50 text-blue-800 border-blue-200',
                        border: 'border-l-blue-500',
                        lineHighlight: 'bg-blue-50/50 border-blue-200',
                      },
                      add: {
                        label: 'Add',
                        badge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
                        border: 'border-l-emerald-500',
                        lineHighlight: 'bg-emerald-50/50 border-emerald-200',
                      },
                      remove: {
                        label: 'Remove',
                        badge: 'bg-rose-50 text-rose-800 border-rose-200',
                        border: 'border-l-rose-500',
                        lineHighlight: 'bg-rose-50/50 border-rose-200',
                      },
                      missing: {
                        label: 'Missing',
                        badge: 'bg-amber-50 text-amber-800 border-amber-200',
                        border: 'border-l-amber-500',
                        lineHighlight: 'bg-amber-50/50 border-amber-200',
                      },
                    };

                    const commentsByLine = new Map<number, ResumeReviewComment[]>();
                    const generalComments: ResumeReviewComment[] = [];
                    for (const c of filteredComments) {
                      if (
                        c.anchorLineNumber !== null &&
                        c.anchorLineNumber >= 1 &&
                        c.anchorLineNumber <= rev.baseLines.length
                      ) {
                        const existing = commentsByLine.get(c.anchorLineNumber) ?? [];
                        existing.push(c);
                        commentsByLine.set(c.anchorLineNumber, existing);
                      } else {
                        generalComments.push(c);
                      }
                    }

                    const renderCommentCard = (
                      c: ResumeReviewComment,
                      compact = false
                    ) => {
                      const meta = categoryMeta[c.category];
                      return (
                        <div
                          key={c.id}
                          className={`bg-white border border-zinc-200 border-l-[3px] ${meta.border} rounded-md ${
                            compact ? 'p-2.5' : 'p-3'
                          } space-y-1.5`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-1.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide border rounded ${meta.badge}`}
                              >
                                {meta.label}
                              </span>
                              <span className="text-[11px] font-mono text-zinc-500">
                                {c.anchorLineNumber !== null
                                  ? `Line ${c.anchorLineNumber}`
                                  : 'Overall'}
                                {c.sectionLabel ? ` · ${c.sectionLabel}` : ''}
                              </span>
                            </div>
                            {c.fromExtendedContext && (
                              <span className="text-[10.5px] font-medium text-emerald-700">
                                From your non-resume info
                              </span>
                            )}
                          </div>

                          <div className="text-xs font-semibold text-zinc-900">
                            {c.title}
                          </div>

                          {!compact && c.anchorQuote && (
                            <div className="text-[11px] text-zinc-500 bg-zinc-50 border border-zinc-200/80 rounded px-2 py-1 italic truncate">
                              &ldquo;{c.anchorQuote}&rdquo;
                            </div>
                          )}

                          <p className="text-xs text-zinc-700 leading-relaxed">
                            {c.comment}
                          </p>

                          {c.suggestedText && (
                            <div className="pt-1 flex items-start justify-between gap-2 bg-zinc-50 border border-zinc-200/80 rounded px-2.5 py-1.5">
                              <div className="text-[11.5px] text-zinc-800 leading-relaxed">
                                <span className="font-semibold text-zinc-600">
                                  Suggested idea:{' '}
                                </span>
                                {c.suggestedText}
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  void handleCopyReviewText(c.id, c.suggestedText || '')
                                }
                                title="Copy suggested wording"
                                className="p-1 text-zinc-400 hover:text-zinc-800 rounded cursor-pointer shrink-0"
                              >
                                {copiedCommentId === c.id ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    };

                    return (
                      <div className="pt-3 border-t border-zinc-200 space-y-3">
                        {/* Download & Copy Actions */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-[11px] font-mono text-zinc-500">
                            {rev.comments.length} comments · {rev.roleTypeUsed} ·{' '}
                            {rev.generatedAt}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                downloadBase64Docx(
                                  resumeReviewResult.docxBase64,
                                  resumeReviewResult.fileName
                                )
                              }
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-zinc-950 hover:bg-zinc-800 rounded-md cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Download Commented .docx</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleCopyAllReviewComments()}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md cursor-pointer"
                            >
                              {copiedCommentId === 'all-comments' ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                                  <span>Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  <span>Copy Comments</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Overall Fit & Missing Requirements */}
                        <div className="p-3 bg-white border border-zinc-200 rounded-md space-y-2">
                          <div className="text-xs text-zinc-800 leading-relaxed">
                            <span className="font-semibold text-zinc-950">
                              Overall Review:{' '}
                            </span>
                            {rev.overallFitNote}
                          </div>
                          {rev.missingRequirements.length > 0 && (
                            <div className="text-[11.5px] text-amber-900 bg-amber-50/70 border border-amber-200/80 rounded px-2.5 py-1.5">
                              <span className="font-semibold">
                                Missing from base resume:{' '}
                              </span>
                              {rev.missingRequirements.join(' · ')}
                            </div>
                          )}
                        </div>

                        {/* Category Filters & View Switcher */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1">
                            {(
                              [
                                ['all', `All (${rev.comments.length})`],
                                ['move', `Move (${counts.move})`],
                                ['add', `Add (${counts.add})`],
                                ['remove', `Remove (${counts.remove})`],
                                ['missing', `Missing (${counts.missing})`],
                              ] as const
                            ).map(([key, label]) => {
                              const active = commentCategoryFilter === key;
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  onClick={() => setCommentCategoryFilter(key)}
                                  className={`px-2 py-1 text-[11px] font-medium rounded border cursor-pointer transition-colors ${
                                    active
                                      ? 'bg-zinc-900 text-white border-zinc-900'
                                      : 'bg-white text-zinc-600 border-zinc-200 hover:text-zinc-900 hover:bg-zinc-50'
                                  }`}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>

                          <div className="inline-flex items-center bg-white border border-zinc-200 rounded-md p-0.5 text-[11px]">
                            <button
                              type="button"
                              onClick={() => setCommentViewMode('comments')}
                              className={`px-2 py-0.5 rounded font-medium cursor-pointer ${
                                commentViewMode === 'comments'
                                  ? 'bg-zinc-900 text-white'
                                  : 'text-zinc-600 hover:text-zinc-900'
                              }`}
                            >
                              Comments
                            </button>
                            <button
                              type="button"
                              onClick={() => setCommentViewMode('annotated')}
                              className={`px-2 py-0.5 rounded font-medium cursor-pointer ${
                                commentViewMode === 'annotated'
                                  ? 'bg-zinc-900 text-white'
                                  : 'text-zinc-600 hover:text-zinc-900'
                              }`}
                            >
                              On Base Resume
                            </button>
                          </div>
                        </div>

                        {/* Comments List OR Verbatim Annotated Base Resume */}
                        {filteredComments.length === 0 ? (
                          <div className="p-3 bg-white border border-zinc-200 rounded-md text-xs text-zinc-500">
                            No {commentCategoryFilter} comments for this review.
                          </div>
                        ) : commentViewMode === 'comments' ? (
                          <div className="space-y-2 max-h-96 overflow-y-auto pr-0.5">
                            {filteredComments.map((c) => renderCommentCard(c, false))}
                          </div>
                        ) : (
                          <div className="p-3.5 bg-white border border-zinc-200 rounded-md space-y-2.5 max-h-[28rem] overflow-y-auto">
                            <div className="text-[11px] text-zinc-500 border-b border-zinc-100 pb-2">
                              Showing your untouched base resume (<span className="font-mono text-zinc-700">{rev.baseResumeFileName}</span>) with review comments anchored inline.
                            </div>

                            {generalComments.length > 0 && (
                              <div className="space-y-1.5 pb-2 border-b border-zinc-100">
                                <div className="text-[10.5px] font-semibold uppercase tracking-wide text-zinc-500">
                                  Document-Wide / Missing Notes
                                </div>
                                {generalComments.map((c) => renderCommentCard(c, true))}
                              </div>
                            )}

                            <div className="space-y-1">
                              {rev.baseLines.map((line, idx) => {
                                const lineNum = idx + 1;
                                const attached = commentsByLine.get(lineNum) ?? [];
                                const primaryMeta =
                                  attached.length > 0
                                    ? categoryMeta[attached[0].category]
                                    : null;
                                return (
                                  <div key={lineNum} className="space-y-1.5">
                                    <div
                                      className={`flex items-start gap-2 px-2 py-1 rounded text-[11.5px] leading-snug ${
                                        primaryMeta
                                          ? `border ${primaryMeta.lineHighlight} text-zinc-950 font-medium`
                                          : 'text-zinc-700'
                                      }`}
                                    >
                                      <span className="text-[10px] font-mono text-zinc-400 select-none w-6 shrink-0 pt-0.5 tabular-nums">
                                        L{lineNum}
                                      </span>
                                      <span className="flex-1 whitespace-pre-wrap break-words">
                                        {line}
                                      </span>
                                    </div>
                                    {attached.length > 0 && (
                                      <div className="pl-7 space-y-1.5 pb-1">
                                        {attached.map((c) => renderCommentCard(c, true))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
              </div>
            )}
          </div>

          {/* Cover Letter Generator (.docx) — unlocked after uploading role-specific samples */}
          <div className="pt-5 border-t border-zinc-100 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FilePenLine className="w-3.5 h-3.5 text-blue-600" />
                <h3 className="text-xs font-semibold text-zinc-900">
                  Cover Letter Generator (.docx)
                </h3>
                {coverLetterUnlock.unlocked ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                    <Unlock className="w-3 h-3" />
                    <span>Unlocked</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700">
                    <Lock className="w-3 h-3" />
                    <span>Locked</span>
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenResumesView();
                }}
                className="text-[11.5px] font-medium text-blue-600 hover:text-blue-700 cursor-pointer"
              >
                Manage Samples
              </button>
            </div>

            {!coverLetterUnlock.unlocked ? (
              <div className="p-3.5 bg-zinc-50/80 border border-zinc-200 rounded-lg space-y-3">
                <div className="flex items-start gap-2 text-xs text-zinc-600 leading-relaxed">
                  <Lock className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <p>
                    Upload a sample cover letter (<span className="font-mono text-zinc-800">.docx</span>) for each target role you&apos;re looking for to unlock the Cover Letter Generator ({coverLetterUnlock.uploadedCount} of{' '}
                    {coverLetterUnlock.requiredCount} uploaded).
                  </p>
                </div>

                <div className="divide-y divide-zinc-200/70 bg-white border border-zinc-200 rounded-md px-3">
                  {coverLetterUnlock.requiredRoles.map(({ roleType: reqRole, matchedSample }) => {
                    const isUploadingThis = isUploadingSampleRole === reqRole;
                    return (
                      <div
                        key={reqRole}
                        className="py-2 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          {matchedSample ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          ) : (
                            <Lock className="w-3 h-3 text-amber-600 shrink-0" />
                          )}
                          <span className="font-medium text-zinc-800 truncate">
                            {reqRole}
                          </span>
                        </div>
                        {matchedSample ? (
                          <span className="text-[11px] font-mono text-emerald-700 truncate max-w-[160px]">
                            {matchedSample.fileName}
                          </span>
                        ) : (
                          <label className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded cursor-pointer shrink-0">
                            <Upload className="w-3 h-3" />
                            <span>{isUploadingThis ? 'Reading...' : 'Upload .docx'}</span>
                            <input
                              type="file"
                              accept=".docx,.txt,.md,.pdf"
                              disabled={Boolean(isUploadingSampleRole)}
                              onChange={(e) =>
                                void handleQuickUploadCoverLetterSample(reqRole, e)
                              }
                              className="sr-only"
                            />
                          </label>
                        )}
                      </div>
                    );
                  })}
                </div>

                {coverLetterError && (
                  <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{coverLetterError}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-3.5 bg-zinc-50/70 border border-zinc-200 rounded-lg space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                  <label
                    htmlFor="drawer-cover-letter-sample"
                    className="sm:col-span-3 text-[11.5px] font-medium text-zinc-600"
                  >
                    Voice sample
                  </label>
                  <select
                    id="drawer-cover-letter-sample"
                    value={activeCoverLetterSample?.id || ''}
                    onChange={(e) => setSelectedSampleId(e.target.value)}
                    className="sm:col-span-9 h-8 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 focus:outline-none focus:border-blue-600"
                  >
                    {coverLetterSamples.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.roleType} — {s.fileName}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={coverLetterFocus}
                    onChange={(e) => setCoverLetterFocus(e.target.value)}
                    placeholder="Optional angle (e.g., highlight coffee chat with Alex or enterprise launch)"
                    className="flex-1 h-8 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-blue-600"
                  />
                  <button
                    type="button"
                    disabled={isGeneratingCoverLetter}
                    onClick={() => void handleGenerateCoverLetter()}
                    className="inline-flex items-center justify-center gap-1.5 h-8 px-3 text-xs font-medium text-white bg-zinc-950 hover:bg-zinc-800 disabled:bg-zinc-400 rounded-md whitespace-nowrap cursor-pointer disabled:cursor-wait shrink-0"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>
                      {isGeneratingCoverLetter
                        ? 'Drafting Letter...'
                        : coverLetterResult
                        ? 'Regenerate Letter'
                        : 'Generate Cover Letter'}
                    </span>
                  </button>
                </div>

                {coverLetterError && (
                  <div className="p-2.5 bg-red-50 border border-red-200 rounded-md flex items-start gap-2 text-xs text-red-700">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{coverLetterError}</span>
                  </div>
                )}

                {coverLetterResult && (
                  <div className="pt-3 border-t border-zinc-200 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[11px] font-mono text-zinc-500">
                        Voice: {coverLetterResult.coverLetter.roleTypeUsed} ·{' '}
                        {coverLetterResult.coverLetter.generatedAt}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            downloadBase64Docx(
                              coverLetterResult.docxBase64,
                              coverLetterResult.fileName
                            )
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-zinc-950 hover:bg-zinc-800 rounded-md cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download .docx</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleCopyCoverLetter()}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md cursor-pointer"
                        >
                          {coverLetterCopied ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copy Text</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {coverLetterResult.coverLetter.tailoringNotes.length > 0 && (
                      <div className="text-xs space-y-1">
                        <div className="font-semibold text-zinc-800">Tailoring Notes</div>
                        <ul className="list-disc pl-4 space-y-0.5 text-zinc-600">
                          {coverLetterResult.coverLetter.tailoringNotes.map((note, idx) => (
                            <li key={idx}>{note}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div>
                      <button
                        type="button"
                        onClick={() => setShowCoverLetterPreview((v) => !v)}
                        className="inline-flex items-center gap-1 text-[11.5px] font-medium text-zinc-700 hover:text-zinc-950 cursor-pointer"
                      >
                        <span>
                          {showCoverLetterPreview ? 'Hide Letter Preview' : 'Show Letter Preview'}
                        </span>
                        {showCoverLetterPreview ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>

                      {showCoverLetterPreview && (
                        <div className="mt-2 p-4 bg-white border border-zinc-200 rounded-md shadow-2xs space-y-2.5 text-[12px] leading-relaxed text-zinc-800 max-h-96 overflow-y-auto">
                          <div className="border-b border-zinc-200 pb-2">
                            <div className="text-sm font-bold text-zinc-950">
                              {coverLetterResult.coverLetter.candidateName}
                            </div>
                            {coverLetterResult.coverLetter.contactLine && (
                              <div className="text-[11px] text-zinc-500">
                                {coverLetterResult.coverLetter.contactLine}
                              </div>
                            )}
                          </div>
                          <div className="text-[11px] text-zinc-500">
                            {coverLetterResult.coverLetter.dateLine}
                          </div>
                          {coverLetterResult.coverLetter.recipientLine && (
                            <div className="whitespace-pre-line text-zinc-700">
                              {coverLetterResult.coverLetter.recipientLine}
                            </div>
                          )}
                          <div className="font-medium text-zinc-900">
                            {coverLetterResult.coverLetter.salutation}
                          </div>
                          {coverLetterResult.coverLetter.paragraphs.map((para, pIdx) => (
                            <p key={pIdx}>{para}</p>
                          ))}
                          <div className="pt-1 whitespace-pre-line font-medium text-zinc-900">
                            {coverLetterResult.coverLetter.signOff}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Full Job Description */}
          <div className="pt-5 border-t border-zinc-100 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-zinc-900">Full Job Description</h3>
              <div className="flex items-center gap-2">
                {!editingJd && (
                  <button
                    type="button"
                    disabled={isFetchingJd}
                    onClick={() => void handleFetchJdClick()}
                    className="inline-flex items-center gap-1 text-[11.5px] font-medium text-blue-600 hover:text-blue-700 disabled:text-zinc-400 cursor-pointer disabled:cursor-wait"
                  >
                    <Download className="w-3 h-3" />
                    <span>
                      {isFetchingJd
                        ? 'Pulling from web...'
                        : hasRichFullDesc
                        ? 'Refresh JD from Web'
                        : 'Pull Full JD from Web'}
                    </span>
                  </button>
                )}
                {!editingJd && (
                  <button
                    type="button"
                    onClick={() => {
                      setJdDraft(job.fullDescription || job.summary || '');
                      setEditingJd(true);
                    }}
                    className="inline-flex items-center gap-1 text-[11.5px] text-zinc-500 hover:text-zinc-900 cursor-pointer"
                  >
                    <Pencil className="w-3 h-3" />
                    <span>Edit</span>
                  </button>
                )}
                {hasRichFullDesc && !editingJd && (
                  <button
                    type="button"
                    onClick={() => setJdExpanded((v) => !v)}
                    className="inline-flex items-center gap-0.5 text-[11.5px] text-zinc-500 hover:text-zinc-900 cursor-pointer"
                  >
                    <span>{jdExpanded ? 'Collapse' : 'Expand'}</span>
                    {jdExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
              </div>
            </div>

            {editingJd ? (
              <div className="space-y-2">
                <textarea
                  rows={9}
                  value={jdDraft}
                  onChange={(e) => setJdDraft(e.target.value)}
                  placeholder="Paste or edit the full job description..."
                  className="w-full p-2.5 text-xs leading-relaxed bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingJd(false)}
                    className="px-2.5 py-1 text-xs text-zinc-500 hover:text-zinc-900 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveJd}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-md cursor-pointer"
                  >
                    Save Description
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-zinc-50/70 border border-zinc-200/80 rounded-lg p-4">
                {fullDescText ? (
                  <div className={!jdExpanded && hasRichFullDesc ? 'max-h-40 overflow-hidden relative' : ''}>
                    {renderFormattedDescription(fullDescText)}
                    {!jdExpanded && hasRichFullDesc && (
                      <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-zinc-50 to-transparent pointer-events-none" />
                    )}
                  </div>
                ) : (
                  <p className="text-sm leading-relaxed text-zinc-600">{job.summary}</p>
                )}
              </div>
            )}
          </div>

          {/* Calendar Events for this role */}
          <div className="pt-5 border-t border-zinc-100 space-y-3">
            <h3 className="text-xs font-semibold text-zinc-900">
              Scheduled Interviews &amp; Follow-ups
            </h3>

            {jobEvents.length > 0 && (
              <ul className="space-y-1.5 text-xs">
                {jobEvents.map((evt) => (
                  <li
                    key={evt.id}
                    className="flex items-center justify-between py-1.5 border-b border-zinc-100 last:border-b-0"
                  >
                    <span className="text-zinc-800">
                      <span className="font-medium text-emerald-700 mr-1.5">
                        {evt.type === 'interview' ? 'Interview' : 'Follow-up'}
                      </span>
                      {evt.label}
                    </span>
                    <span className="font-mono text-zinc-500 tabular-nums shrink-0">
                      {evt.date}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <form onSubmit={handleSchedule} className="grid grid-cols-12 gap-2">
              <input
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                aria-label="Event date"
                className="col-span-5 h-8 px-2 text-xs font-mono bg-white border border-zinc-200 rounded-md text-zinc-800"
              />
              <select
                value={eventType}
                onChange={(e) => setEventType(e.target.value as 'interview' | 'followup')}
                aria-label="Event type"
                className="col-span-4 h-8 px-2 text-xs bg-white border border-zinc-200 rounded-md text-zinc-800"
              >
                <option value="interview">Interview</option>
                <option value="followup">Follow-up</option>
              </select>
              <button
                type="submit"
                className="col-span-3 inline-flex items-center justify-center gap-1 h-8 px-2 text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-md cursor-pointer"
              >
                <CalendarPlus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
              <input
                type="text"
                value={eventLabel}
                onChange={(e) => setEventLabel(e.target.value)}
                placeholder="Optional label (e.g., Hiring manager call)"
                className="col-span-12 h-8 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-800 placeholder:text-zinc-400"
              />
            </form>
          </div>

          {/* Personal Notes */}
          <div className="pt-5 border-t border-zinc-100 space-y-2">
            <label htmlFor="job-notes" className="block text-xs font-semibold text-zinc-900">
              Personal Notes
            </label>
            <textarea
              id="job-notes"
              rows={3}
              value={notesDraft}
              onChange={(e) => {
                setNotesDraft(e.target.value);
                onUpdateNotes(job.id, e.target.value);
              }}
              placeholder="Track interview prep notes, compensation details, or key questions..."
              className="w-full p-2.5 text-sm bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>
            </div>
          ) : (
            <div
              id="drawer-panel-networking"
              role="tabpanel"
              aria-labelledby="drawer-tab-networking"
              className="space-y-5"
            >
              {/* Outreach Summary Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pb-4 border-b border-zinc-100">
                <div>
                  <div className="text-[11px] text-zinc-500">Contacts</div>
                  <div className="mt-0.5 font-mono text-base font-semibold text-zinc-950 tabular-nums">
                    {contacts.length}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-zinc-500">Engaged</div>
                  <div className="mt-0.5 font-mono text-base font-semibold text-blue-700 tabular-nums">
                    {engagedCount}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-zinc-500">Warm / Champion</div>
                  <div className="mt-0.5 font-mono text-base font-semibold text-emerald-700 tabular-nums">
                    {positiveSentimentCount}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-zinc-500">Next Follow-up</div>
                  <div
                    className={`mt-0.5 font-mono text-xs font-semibold tabular-nums pt-1 ${
                      nextFollowUpDate && getFollowUpState(nextFollowUpDate) === 'overdue'
                        ? 'text-red-600'
                        : nextFollowUpDate && getFollowUpState(nextFollowUpDate) === 'today'
                        ? 'text-amber-700'
                        : 'text-zinc-900'
                    }`}
                  >
                    {nextFollowUpDate ?? 'None set'}
                  </div>
                </div>
              </div>

              {/* Action & Filter Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (showLinkedInExport) {
                        setShowLinkedInExport(false);
                      } else {
                        openLinkedInExportForContact();
                      }
                    }}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                      showLinkedInExport
                        ? 'bg-[#0A66C2] text-white border-[#0A66C2]'
                        : 'bg-white text-[#0A66C2] border-[#0A66C2]/30 hover:bg-[#0A66C2]/5'
                    }`}
                  >
                    <LinkedInIcon className="w-3.5 h-3.5" />
                    <span>Export to LinkedIn</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddContact((v) => !v)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                      showAddContact
                        ? 'bg-zinc-100 text-zinc-800 border-zinc-300'
                        : 'bg-zinc-900 text-white border-zinc-900 hover:bg-zinc-800'
                    }`}
                  >
                    {showAddContact ? (
                      <span>Cancel</span>
                    ) : (
                      <>
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>Add Contact</span>
                      </>
                    )}
                  </button>
                </div>

                {contacts.length > 1 && (
                  <div className="flex items-center gap-1.5">
                    <select
                      aria-label="Filter contacts by status"
                      value={networkingStatusFilter}
                      onChange={(e) =>
                        setNetworkingStatusFilter(
                          e.target.value as 'all' | NetworkingContactStatus
                        )
                      }
                      className="h-7 px-2 text-[11px] bg-white border border-zinc-200 rounded-md text-zinc-700"
                    >
                      <option value="all">All statuses</option>
                      {NETWORKING_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Filter contacts by sentiment"
                      value={networkingSentimentFilter}
                      onChange={(e) =>
                        setNetworkingSentimentFilter(
                          e.target.value as 'all' | NetworkingContactSentiment
                        )
                      }
                      className="h-7 px-2 text-[11px] bg-white border border-zinc-200 rounded-md text-zinc-700"
                    >
                      <option value="all">All sentiment</option>
                      {NETWORKING_SENTIMENTS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* LinkedIn Connection Draft Exporter */}
              {showLinkedInExport && (
                <div className="p-3.5 bg-sky-50/50 border border-[#0A66C2]/25 rounded-lg space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900">
                        <LinkedInIcon className="w-3.5 h-3.5 text-[#0A66C2]" />
                        <span>LinkedIn Connection Draft</span>
                      </div>
                      <p className="text-[11.5px] text-zinc-600 mt-0.5">
                        {contacts.length > 0
                          ? `Pre-populated for ${contacts.length} contact${contacts.length === 1 ? '' : 's'} identified for ${job.company}. Copy & open LinkedIn to paste into Connect → Add a note.`
                          : `No contacts saved yet for ${job.company}. Customize this general draft or add a specific contact below.`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowLinkedInExport(false)}
                      aria-label="Close LinkedIn draft exporter"
                      className="p-1 text-zinc-400 hover:text-zinc-700 rounded cursor-pointer shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {contacts.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                      <label
                        htmlFor="linkedin-export-contact"
                        className="sm:col-span-3 text-[11.5px] font-medium text-zinc-600"
                      >
                        Contact
                      </label>
                      <select
                        id="linkedin-export-contact"
                        value={activeLinkedInContact?.id || ''}
                        onChange={(e) => {
                          const chosen =
                            contacts.find((c) => c.id === e.target.value) ?? null;
                          openLinkedInExportForContact(chosen ?? undefined);
                        }}
                        className="sm:col-span-9 h-8 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 focus:outline-none focus:border-[#0A66C2]"
                      >
                        {contacts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} — {c.role} ({c.status})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="inline-flex items-center rounded-md border border-zinc-200 bg-white p-0.5 text-[11px]">
                      {(
                        [
                          { id: 'intro', label: 'Concise Intro' },
                          { id: 'warm', label: 'Warm / Alum' },
                          { id: 'referral', label: 'Referral Ask' },
                        ] as { id: LinkedInDraftTone; label: string }[]
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => handleLinkedInToneChange(opt.id)}
                          className={`px-2 py-1 rounded font-medium transition-colors cursor-pointer ${
                            linkedInTone === opt.id
                              ? 'bg-zinc-900 text-white'
                              : 'text-zinc-600 hover:text-zinc-900'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <span
                      className={`text-[11px] font-mono tabular-nums ${
                        activeLinkedInMessage.length > LINKEDIN_NOTE_LIMIT
                          ? 'text-red-600 font-semibold'
                          : activeLinkedInMessage.length > 265
                          ? 'text-amber-700'
                          : 'text-zinc-500'
                      }`}
                    >
                      {activeLinkedInMessage.length} / {LINKEDIN_NOTE_LIMIT} chars
                    </span>
                  </div>

                  <textarea
                    rows={4}
                    aria-label="Draft LinkedIn connection message"
                    value={activeLinkedInMessage}
                    onChange={(e) =>
                      setLinkedInDrafts((prev) => ({
                        ...prev,
                        [activeLinkedInDraftKey]: e.target.value,
                      }))
                    }
                    className="w-full p-2.5 text-xs leading-relaxed bg-white border border-zinc-200 rounded-md text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#0A66C2]/20 focus:border-[#0A66C2]"
                  />

                  {activeLinkedInMessage.length > LINKEDIN_NOTE_LIMIT && (
                    <p className="text-[11px] text-red-600">
                      LinkedIn connection invitations are capped at {LINKEDIN_NOTE_LIMIT} characters. Trim{' '}
                      {activeLinkedInMessage.length - LINKEDIN_NOTE_LIMIT} characters before sending.
                    </p>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void handleCopyLinkedInDraft('single', activeLinkedInMessage)
                        }
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-zinc-800 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md cursor-pointer"
                      >
                        {linkedInCopiedKey === 'single' ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            <span className="text-emerald-700">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy Message</span>
                          </>
                        )}
                      </button>

                      <a
                        href={activeLinkedInUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => {
                          void handleCopyLinkedInDraft('open', activeLinkedInMessage);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#0A66C2] hover:bg-[#004182] rounded-md"
                      >
                        <LinkedInIcon className="w-3.5 h-3.5" />
                        <span>
                          {linkedInCopiedKey === 'open'
                            ? 'Copied — Opening LinkedIn'
                            : activeLinkedInContact?.profileUrl &&
                              /linkedin\.com/i.test(activeLinkedInContact.profileUrl)
                            ? 'Copy & Open Profile'
                            : 'Copy & Find on LinkedIn'}
                        </span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>

                    <div className="flex items-center gap-2">
                      {activeLinkedInContact &&
                        activeLinkedInContact.status === 'To Reach Out' && (
                          <button
                            type="button"
                            onClick={() =>
                              handleChangeContactStatus(
                                activeLinkedInContact.id,
                                'Message Sent'
                              )
                            }
                            className="text-[11.5px] font-medium text-emerald-700 hover:text-emerald-800 cursor-pointer"
                          >
                            Mark Sent
                          </button>
                        )}
                      {contacts.length > 1 && (
                        <button
                          type="button"
                          onClick={() => void handleCopyAllLinkedInDrafts()}
                          className="text-[11.5px] font-medium text-zinc-600 hover:text-zinc-900 cursor-pointer"
                        >
                          {linkedInCopiedKey === 'all'
                            ? `Copied all ${contacts.length}`
                            : `Copy all (${contacts.length})`}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Add Contact Form */}
              {showAddContact && (
                <form
                  onSubmit={handleAddContact}
                  className="p-3.5 bg-zinc-50/70 border border-zinc-200 rounded-lg space-y-2.5"
                >
                  <div className="text-xs font-semibold text-zinc-900">
                    Add Contact for {job.company}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      required
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      placeholder="Contact name (e.g., Jordan Lee)"
                      className="h-8 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400"
                    />
                    <input
                      type="text"
                      value={contactRole}
                      onChange={(e) => setContactRole(e.target.value)}
                      placeholder="Role / relation (e.g., Hiring Manager, Alum)"
                      className="h-8 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400"
                    />
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <select
                      aria-label="Outreach channel"
                      value={contactChannel}
                      onChange={(e) =>
                        setContactChannel(e.target.value as NetworkingChannel)
                      }
                      className="h-8 px-2 text-xs bg-white border border-zinc-200 rounded-md text-zinc-800"
                    >
                      {NETWORKING_CHANNELS.map((ch) => (
                        <option key={ch} value={ch}>
                          {ch}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Outreach status"
                      value={contactStatus}
                      onChange={(e) =>
                        setContactStatus(e.target.value as NetworkingContactStatus)
                      }
                      className="h-8 px-2 text-xs bg-white border border-zinc-200 rounded-md text-zinc-800"
                    >
                      {NETWORKING_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Contact sentiment"
                      value={contactSentiment}
                      onChange={(e) =>
                        setContactSentiment(
                          e.target.value as NetworkingContactSentiment
                        )
                      }
                      className="h-8 px-2 text-xs bg-white border border-zinc-200 rounded-md text-zinc-800"
                    >
                      {NETWORKING_SENTIMENTS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <input
                      type="date"
                      value={contactFollowUp}
                      onChange={(e) => setContactFollowUp(e.target.value)}
                      aria-label="Follow-up date"
                      title="Optional follow-up reminder date"
                      className="h-8 px-2 text-xs font-mono bg-white border border-zinc-200 rounded-md text-zinc-800"
                    />
                  </div>

                  <input
                    type="text"
                    value={contactProfileUrl}
                    onChange={(e) => setContactProfileUrl(e.target.value)}
                    placeholder="Optional LinkedIn URL or email link"
                    className="w-full h-8 px-2.5 text-xs font-mono bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400"
                  />

                  <input
                    type="text"
                    value={contactNotes}
                    onChange={(e) => setContactNotes(e.target.value)}
                    placeholder="Short outreach note (e.g., Met at info session, asked for referral)"
                    className="w-full h-8 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400"
                  />

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAddContact(false)}
                      className="px-2.5 py-1.5 text-xs text-zinc-500 hover:text-zinc-900 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-md cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Save Contact</span>
                    </button>
                  </div>
                </form>
              )}

              {/* Contacts Empty State */}
              {contacts.length === 0 && !showAddContact && (
                <div className="p-6 text-center bg-zinc-50/70 border border-dashed border-zinc-200 rounded-lg space-y-2">
                  <Users className="w-5 h-5 text-zinc-400 mx-auto" />
                  <div className="text-xs font-semibold text-zinc-900">
                    No contacts tracked for {job.company} yet
                  </div>
                  <p className="text-xs text-zinc-500 max-w-sm mx-auto leading-relaxed">
                    Add hiring managers, recruiters, alumni, or referrals to track outreach status, sentiment, and follow-up dates. Follow-up dates sync automatically to your Search Calendar.
                  </p>
                </div>
              )}

              {/* Filtered Empty State */}
              {contacts.length > 0 && filteredContacts.length === 0 && (
                <div className="p-4 text-center bg-zinc-50 border border-zinc-200 rounded-lg space-y-1.5">
                  <p className="text-xs text-zinc-600">
                    No contacts match the active status/sentiment filter.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setNetworkingStatusFilter('all');
                      setNetworkingSentimentFilter('all');
                    }}
                    className="text-xs font-medium text-blue-600 hover:underline cursor-pointer"
                  >
                    Clear filters
                  </button>
                </div>
              )}

              {/* Contact Cards */}
              {filteredContacts.length > 0 && (
                <div className="space-y-3">
                  {filteredContacts.map((contact) => {
                    const effectiveSentiment: NetworkingContactSentiment =
                      contact.sentiment ?? 'Neutral';
                    const followUpState = getFollowUpState(contact.followUpDate);
                    const isEditingNote = editingContactNoteId === contact.id;

                    return (
                      <div
                        key={contact.id}
                        className="p-3.5 border border-zinc-200 rounded-lg bg-white space-y-3"
                      >
                        {/* Header row */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[13px] font-semibold text-zinc-950">
                                {contact.name}
                              </span>
                              {contact.profileUrl && (
                                <a
                                  href={
                                    contact.profileUrl.startsWith('http')
                                      ? contact.profileUrl
                                      : `https://${contact.profileUrl}`
                                  }
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label={`Open profile for ${contact.name}`}
                                  className="text-blue-600 hover:text-blue-700"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                            <div className="text-[11.5px] text-zinc-500">
                              {contact.role} · {contact.channel}
                              {contact.lastContactDate && (
                                <span className="font-mono text-zinc-400">
                                  {' '}
                                  · Last touch {contact.lastContactDate}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => openLinkedInExportForContact(contact)}
                              title={`Draft LinkedIn message for ${contact.name}`}
                              aria-label={`Draft LinkedIn message for ${contact.name}`}
                              className={`p-1.5 rounded transition-colors cursor-pointer ${
                                showLinkedInExport &&
                                activeLinkedInContact?.id === contact.id
                                  ? 'text-[#0A66C2] bg-sky-50'
                                  : 'text-zinc-400 hover:text-[#0A66C2] hover:bg-sky-50/70'
                              }`}
                            >
                              <LinkedInIcon className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveContact(contact.id)}
                              aria-label={`Remove ${contact.name}`}
                              className="p-1.5 text-zinc-400 hover:text-red-600 rounded cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Status, Sentiment, and Follow-up Date Grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-0.5">
                          <div className="space-y-1">
                            <label
                              htmlFor={`status-${contact.id}`}
                              className="block text-[10.5px] font-medium text-zinc-500"
                            >
                              Outreach Status
                            </label>
                            <select
                              id={`status-${contact.id}`}
                              value={contact.status}
                              onChange={(e) =>
                                handleChangeContactStatus(
                                  contact.id,
                                  e.target.value as NetworkingContactStatus
                                )
                              }
                              className={`w-full h-8 px-2 text-xs bg-zinc-50 border border-zinc-200 rounded-md focus:outline-none focus:border-blue-600 ${statusTextClass(
                                contact.status
                              )}`}
                            >
                              {NETWORKING_STATUSES.map((st) => (
                                <option key={st} value={st}>
                                  {st}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-1">
                            <label
                              htmlFor={`sentiment-${contact.id}`}
                              className="block text-[10.5px] font-medium text-zinc-500"
                            >
                              Sentiment
                            </label>
                            <select
                              id={`sentiment-${contact.id}`}
                              value={effectiveSentiment}
                              onChange={(e) =>
                                handleChangeContactSentiment(
                                  contact.id,
                                  e.target.value as NetworkingContactSentiment
                                )
                              }
                              className={`w-full h-8 px-2 text-xs border rounded-md focus:outline-none focus:border-blue-600 ${sentimentSelectClass(
                                effectiveSentiment
                              )}`}
                            >
                              {NETWORKING_SENTIMENTS.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <label
                                htmlFor={`followup-${contact.id}`}
                                className="block text-[10.5px] font-medium text-zinc-500"
                              >
                                Follow-up Date
                              </label>
                              {followUpState === 'overdue' && (
                                <span className="text-[10px] font-medium text-red-600">
                                  Overdue
                                </span>
                              )}
                              {followUpState === 'today' && (
                                <span className="text-[10px] font-medium text-amber-700">
                                  Due today
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <input
                                id={`followup-${contact.id}`}
                                type="date"
                                value={contact.followUpDate ?? ''}
                                onChange={(e) =>
                                  handleChangeContactFollowUp(
                                    contact.id,
                                    e.target.value
                                  )
                                }
                                className={`w-full h-8 px-2 text-xs font-mono bg-white border rounded-md tabular-nums focus:outline-none focus:border-blue-600 ${
                                  followUpState === 'overdue'
                                    ? 'border-red-300 text-red-700'
                                    : followUpState === 'today'
                                    ? 'border-amber-300 text-amber-800'
                                    : 'border-zinc-200 text-zinc-800'
                                }`}
                              />
                              {contact.followUpDate && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleChangeContactFollowUp(contact.id, '')
                                  }
                                  title="Clear follow-up date"
                                  aria-label={`Clear follow-up date for ${contact.name}`}
                                  className="p-1 text-zinc-400 hover:text-zinc-700 rounded cursor-pointer shrink-0"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Notes display / inline editor */}
                        {isEditingNote ? (
                          <div className="space-y-1.5 pt-1">
                            <textarea
                              rows={2}
                              value={contactNoteDraft}
                              onChange={(e) => setContactNoteDraft(e.target.value)}
                              placeholder="Add call takeaways, referral context, or next steps..."
                              className="w-full p-2 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 focus:outline-none focus:border-blue-600"
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingContactNoteId(null);
                                  setContactNoteDraft('');
                                }}
                                className="text-[11px] text-zinc-500 hover:text-zinc-900 cursor-pointer"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleSaveContactNotes(contact.id, contactNoteDraft)
                                }
                                className="px-2.5 py-1 text-[11px] font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded cursor-pointer"
                              >
                                Save Note
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start justify-between gap-2 pt-0.5">
                            {contact.notes ? (
                              <p className="text-xs text-zinc-600 leading-relaxed">
                                {contact.notes}
                              </p>
                            ) : (
                              <span className="text-[11.5px] text-zinc-400 italic">
                                No outreach notes yet
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setEditingContactNoteId(contact.id);
                                setContactNoteDraft(contact.notes ?? '');
                              }}
                              aria-label={`Edit notes for ${contact.name}`}
                              className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-800 cursor-pointer shrink-0"
                            >
                              <Pencil className="w-3 h-3" />
                              <span>{contact.notes ? 'Edit' : 'Add note'}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
