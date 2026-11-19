import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  downloadBase64Docx,
  parseResumeFileOnServer,
  selectBestResumeForJob,
} from '../lib/resumeClient';
import {
  CareerExperienceItem,
  DislikeReason,
  JobEvent,
  JobRecord,
  NetworkingChannel,
  NetworkingContact,
  NetworkingContactSentiment,
  NetworkingContactStatus,
  PipelineStage,
  RoleResume,
  TailoredResumeDocument,
} from '../types/job';
import { DislikeReasonPopover } from './DislikeReasonPopover';

interface JobDetailDrawerProps {
  job: JobRecord | null;
  events: JobEvent[];
  resumes: RoleResume[];
  careerExperiences: CareerExperienceItem[];
  careerContextNotes: string;
  tailoredResult?: {
    tailored: TailoredResumeDocument;
    docxBase64: string;
    fileName: string;
  } | null;
  onSaveResume: (resume: RoleResume) => void;
  onOpenResumesView: () => void;
  onSaveTailoredResult: (
    jobId: string,
    result: {
      tailored: TailoredResumeDocument;
      docxBase64: string;
      fileName: string;
    }
  ) => void;
  onClose: () => void;
  onMoveStage: (jobId: string, nextStage: PipelineStage) => void;
  onUpdateNotes: (jobId: string, notes: string) => void;
  onUpdateFullDescription: (jobId: string, fullDescription: string) => void;
  onFetchFullDescription: (jobId: string, jobUrl: string) => Promise<void>;
  onUpdateNetworkingContacts: (jobId: string, contacts: NetworkingContact[]) => void;
  onThumbsUp: (jobId: string) => void;
  onThumbsDown: (jobId: string, reason?: DislikeReason) => void;
  onRestoreJob: (jobId: string) => void;
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
  const todayIso = new Date().toISOString().slice(0, 10);
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
  careerExperiences,
  careerContextNotes,
  tailoredResult,
  onSaveResume,
  onOpenResumesView,
  onSaveTailoredResult,
  onClose,
  onMoveStage,
  onUpdateNotes,
  onUpdateFullDescription,
  onFetchFullDescription,
  onUpdateNetworkingContacts,
  onThumbsUp,
  onThumbsDown,
  onRestoreJob,
  onAddEvent,
}: JobDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'networking'>('overview');
  const [notesDraft, setNotesDraft] = useState('');
  const [dislikeOpen, setDislikeOpen] = useState(false);

  // Full job description UI state
  const [jdExpanded, setJdExpanded] = useState(true);
  const [editingJd, setEditingJd] = useState(false);
  const [jdDraft, setJdDraft] = useState('');
  const [isFetchingJd, setIsFetchingJd] = useState(false);

  // Resume Tailor UI state
  const [selectedResumeId, setSelectedResumeId] = useState<string>('');
  const [tailorFocus, setTailorFocus] = useState('');
  const [isTailoring, setIsTailoring] = useState(false);
  const [isExportingClean, setIsExportingClean] = useState(false);
  const [isQuickUploadingResume, setIsQuickUploadingResume] = useState(false);
  const [tailorError, setTailorError] = useState<string | null>(null);
  const [showRedlinePreview, setShowRedlinePreview] = useState(true);

  // Scheduled events state
  const [eventDate, setEventDate] = useState('2026-11-24');
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
      setDislikeOpen(false);
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
      setTailorError(null);
      setTailorFocus('');
      const best = selectBestResumeForJob(job, resumes);
      setSelectedResumeId(best?.id || '');
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
  const canFetchFromUrl =
    Boolean(job.jobUrl) &&
    /^https?:\/\//i.test(job.jobUrl) &&
    !job.jobUrl.includes('.example') &&
    !job.jobUrl.includes('mail.google.com');

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
    if (!job.jobUrl || isFetchingJd) return;
    setIsFetchingJd(true);
    try {
      await onFetchFullDescription(job.id, job.jobUrl);
    } finally {
      setIsFetchingJd(false);
    }
  };

  const handleAddContact = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = contactName.trim();
    if (!cleanName) return;

    const todayIso = new Date().toISOString().slice(0, 10);
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
    const todayIso = new Date().toISOString().slice(0, 10);
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
  const hasExtendedContext =
    careerExperiences.length > 0 || Boolean(careerContextNotes.trim());

  const handleQuickUploadResume = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setTailorError(null);
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
        uploadedAt: new Date().toISOString().slice(0, 10),
      };
      onSaveResume(created);
      setSelectedResumeId(created.id);
    } catch (err: unknown) {
      setTailorError(
        err instanceof Error ? err.message : 'Could not parse uploaded resume.'
      );
    } finally {
      setIsQuickUploadingResume(false);
    }
  };

  const handleTailorResume = async () => {
    if (!activeBaseResume || isTailoring) return;
    setTailorError(null);
    setIsTailoring(true);
    try {
      const res = await fetch('/api/resumes/tailor', {
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
          customInstructions: tailorFocus.trim() || undefined,
        }),
      });
      const data = (await res.json()) as {
        tailored?: TailoredResumeDocument;
        docxBase64?: string;
        fileName?: string;
        error?: string;
      };
      if (!res.ok || !data.tailored || !data.docxBase64) {
        throw new Error(data.error || 'Failed to tailor resume.');
      }
      onSaveTailoredResult(job.id, {
        tailored: data.tailored,
        docxBase64: data.docxBase64,
        fileName: data.fileName || `${job.company}_Tailored_Resume.docx`,
      });
      setShowRedlinePreview(true);
    } catch (err: unknown) {
      setTailorError(
        err instanceof Error ? err.message : 'Could not tailor resume.'
      );
    } finally {
      setIsTailoring(false);
    }
  };

  const handleDownloadCleanDocx = async () => {
    if (!tailoredResult || isExportingClean) return;
    setIsExportingClean(true);
    try {
      const res = await fetch('/api/resumes/export-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tailored: tailoredResult.tailored,
          highlightEditsInRed: false,
        }),
      });
      const data = (await res.json()) as { docxBase64?: string; error?: string };
      if (!res.ok || !data.docxBase64) {
        throw new Error(data.error || 'Failed to export clean .docx');
      }
      const cleanName = tailoredResult.fileName.replace(/\.docx$/i, '_Clean.docx');
      downloadBase64Docx(data.docxBase64, cleanName);
    } catch (err: unknown) {
      setTailorError(
        err instanceof Error ? err.message : 'Could not export clean .docx.'
      );
    } finally {
      setIsExportingClean(false);
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

          <button
            type="button"
            onClick={onClose}
            aria-label="Close role details"
            className="p-1.5 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-md cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
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

            <div className="flex items-center gap-2 relative">
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
            </div>
          </div>

          {/* Structured Key Attributes */}
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
                {job.salaryLabel}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Location</dt>
              <dd className="mt-0.5 text-zinc-900">
                {job.locationType} · {job.location}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Discovered</dt>
              <dd className="mt-0.5 font-mono text-zinc-900 tabular-nums">
                {job.discoveredAt} · {job.discoveredTime}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Application Deadline</dt>
              <dd className="mt-0.5 font-mono text-zinc-900 tabular-nums">
                {job.deadlineAt ?? 'Rolling'}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Source Link</dt>
              <dd className="mt-0.5">
                {job.jobUrl ? (
                  <a
                    href={job.jobUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                  >
                    <span>Open posting</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <span className="text-zinc-400">No URL listed</span>
                )}
              </dd>
            </div>
          </dl>

          {/* Match Rationale */}
          <div className="pt-5 border-t border-zinc-100 space-y-2">
            <h3 className="text-xs font-semibold text-zinc-900">Agent Match Summary</h3>
            <p className="text-sm leading-relaxed text-zinc-700">{job.matchReason}</p>
            <div className="text-xs text-zinc-500">
              Key skills: <span className="text-zinc-800">{job.skills.join(' · ')}</span>
            </div>
          </div>

          {/* 1-Page Resume Tailor (.docx with red edits) */}
          <div className="pt-5 border-t border-zinc-100 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileText className="w-3.5 h-3.5 text-blue-600" />
                <h3 className="text-xs font-semibold text-zinc-900">
                  Tailor 1-Page Resume (.docx)
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

            {resumes.length === 0 ? (
              <div className="p-3.5 bg-zinc-50/80 border border-zinc-200 rounded-lg space-y-2.5">
                <p className="text-xs text-zinc-600 leading-relaxed">
                  Upload a role-specific base resume (e.g., PM, PMM, Strategy) to generate a tailored 1-page <span className="font-mono text-zinc-800">.docx</span> with edits highlighted in red.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-md cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    <span>
                      {isQuickUploadingResume
                        ? 'Reading resume...'
                        : 'Upload Resume (.docx / .pdf)'}
                    </span>
                    <input
                      type="file"
                      accept=".docx,.pdf,.txt,.md"
                      disabled={isQuickUploadingResume}
                      onChange={(e) => void handleQuickUploadResume(e)}
                      className="sr-only"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenResumesView();
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md cursor-pointer"
                  >
                    Add Off-Resume Roles
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
                    Base track
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

                <div className="text-[11px] text-zinc-500">
                  {hasExtendedContext ? (
                    <span>
                      Extended context active:{' '}
                      <span className="text-zinc-800 font-medium">
                        {careerExperiences.length} role{careerExperiences.length === 1 ? '' : 's'}
                        {offResumeCount > 0 ? ` (${offResumeCount} off-resume)` : ''}
                        {careerContextNotes.trim() ? ' + extra background notes' : ''}
                      </span>
                    </span>
                  ) : (
                    <span>
                      Tip: Add off-resume roles or projects in{' '}
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenResumesView();
                        }}
                        className="text-blue-600 hover:underline cursor-pointer"
                      >
                        Resumes &amp; Context
                      </button>{' '}
                      so Meridian can pull in unlisted achievements.
                    </span>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={tailorFocus}
                    onChange={(e) => setTailorFocus(e.target.value)}
                    placeholder="Optional focus (e.g., highlight B2B pricing & SQL analytics)"
                    className="flex-1 h-8 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-blue-600"
                  />
                  <button
                    type="button"
                    disabled={isTailoring}
                    onClick={() => void handleTailorResume()}
                    className="inline-flex items-center justify-center gap-1.5 h-8 px-3 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-md whitespace-nowrap cursor-pointer disabled:cursor-wait shrink-0"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>
                      {isTailoring
                        ? 'Tailoring 1-Page .docx...'
                        : tailoredResult
                        ? 'Re-Tailor Resume'
                        : 'Tailor for This Role'}
                    </span>
                  </button>
                </div>

                {tailorError && (
                  <div className="p-2.5 bg-red-50 border border-red-200 rounded-md flex items-start gap-2 text-xs text-red-700">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{tailorError}</span>
                  </div>
                )}

                {tailoredResult && (
                  <div className="pt-3 border-t border-zinc-200 space-y-3">
                    {/* Download Actions */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[11px] font-mono text-zinc-500">
                        1-page fit · {tailoredResult.tailored.roleTypeUsed} ·{' '}
                        {tailoredResult.tailored.generatedAt}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            downloadBase64Docx(
                              tailoredResult.docxBase64,
                              tailoredResult.fileName
                            )
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-zinc-950 hover:bg-zinc-800 rounded-md cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download .docx (Edits in Red)</span>
                        </button>
                        <button
                          type="button"
                          disabled={isExportingClean}
                          onClick={() => void handleDownloadCleanDocx()}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md cursor-pointer disabled:cursor-wait"
                        >
                          <span>{isExportingClean ? 'Exporting...' : 'Clean .docx'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Change Summary & Off-Resume Pulls */}
                    {tailoredResult.tailored.changeSummary.length > 0 && (
                      <div className="text-xs space-y-1">
                        <div className="font-semibold text-zinc-800">Key Edits Made</div>
                        <ul className="list-disc pl-4 space-y-0.5 text-zinc-600">
                          {tailoredResult.tailored.changeSummary.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {tailoredResult.tailored.pulledFromExtendedContext.length > 0 && (
                      <div className="p-2.5 bg-red-50/50 border border-red-200/70 rounded-md text-xs space-y-1">
                        <div className="font-semibold text-red-800">
                          Pulled from Your Off-Resume Experience
                        </div>
                        <ul className="list-disc pl-4 space-y-0.5 text-red-700">
                          {tailoredResult.tailored.pulledFromExtendedContext.map(
                            (item, i) => (
                              <li key={i}>{item}</li>
                            )
                          )}
                        </ul>
                      </div>
                    )}

                    {/* Collapsible 1-Page Redline Preview */}
                    <div>
                      <button
                        type="button"
                        onClick={() => setShowRedlinePreview((v) => !v)}
                        className="inline-flex items-center gap-1 text-[11.5px] font-medium text-zinc-700 hover:text-zinc-950 cursor-pointer"
                      >
                        <span>
                          {showRedlinePreview
                            ? 'Hide Redline Preview'
                            : 'Show Redline Preview'}
                        </span>
                        {showRedlinePreview ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>

                      {showRedlinePreview && (
                        <div className="mt-2 p-4 bg-white border border-zinc-200 rounded-md shadow-2xs space-y-3 text-[11.5px] leading-snug text-zinc-900 max-h-96 overflow-y-auto">
                          <div className="text-center border-b border-zinc-200 pb-2">
                            <div className="text-sm font-bold text-zinc-950">
                              {tailoredResult.tailored.candidateName}
                            </div>
                            {tailoredResult.tailored.contactLine && (
                              <div className="text-[10.5px] text-zinc-500 mt-0.5">
                                {tailoredResult.tailored.contactLine}
                              </div>
                            )}
                          </div>

                          {tailoredResult.tailored.headlineRuns &&
                            tailoredResult.tailored.headlineRuns.length > 0 && (
                              <p>
                                {tailoredResult.tailored.headlineRuns.map((run, idx) => (
                                  <span
                                    key={idx}
                                    className={run.edited ? 'text-red-700 font-medium' : ''}
                                  >
                                    {run.text}
                                  </span>
                                ))}
                              </p>
                            )}

                          {tailoredResult.tailored.sections.map((section, sIdx) => (
                            <div key={sIdx} className="space-y-1.5">
                              <div className="text-[10.5px] font-bold tracking-wide text-zinc-900 border-b border-zinc-200 pb-0.5">
                                {section.heading}
                              </div>

                              {section.summaryRuns && section.summaryRuns.length > 0 && (
                                <p>
                                  {section.summaryRuns.map((run, rIdx) => (
                                    <span
                                      key={rIdx}
                                      className={run.edited ? 'text-red-700 font-medium' : ''}
                                    >
                                      {run.text}
                                    </span>
                                  ))}
                                </p>
                              )}

                              {(section.entries ?? []).map((entry, eIdx) => (
                                <div key={eIdx} className="space-y-0.5 pt-0.5">
                                  <div className="flex items-baseline justify-between gap-2 font-semibold text-zinc-950">
                                    <span>{entry.headerLeft}</span>
                                    <span className="text-[10.5px] font-normal text-zinc-600 shrink-0">
                                      {entry.headerRight}
                                    </span>
                                  </div>
                                  {(entry.subHeaderLeft || entry.subHeaderRight) && (
                                    <div className="flex items-baseline justify-between gap-2 italic text-zinc-600">
                                      <span>{entry.subHeaderLeft}</span>
                                      {entry.subHeaderRight && (
                                        <span className="text-[10.5px] shrink-0">
                                          {entry.subHeaderRight}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  {entry.bullets.length > 0 && (
                                    <ul className="list-disc pl-4 space-y-0.5 pt-0.5">
                                      {entry.bullets.map((b, bIdx) => (
                                        <li key={bIdx}>
                                          {b.runs.map((run, rIdx) => (
                                            <span
                                              key={rIdx}
                                              className={
                                                run.edited ? 'text-red-700 font-medium' : ''
                                              }
                                            >
                                              {run.text}
                                            </span>
                                          ))}
                                          {b.wasPulledFromContext && (
                                            <span className="ml-1.5 text-[10px] font-mono text-red-600">
                                              [from off-resume context]
                                            </span>
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              ))}
                            </div>
                          ))}
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
                {canFetchFromUrl && !editingJd && (
                  <button
                    type="button"
                    disabled={isFetchingJd}
                    onClick={() => void handleFetchJdClick()}
                    className="inline-flex items-center gap-1 text-[11.5px] font-medium text-blue-600 hover:text-blue-700 disabled:text-zinc-400 cursor-pointer disabled:cursor-wait"
                  >
                    <Download className="w-3 h-3" />
                    <span>{isFetchingJd ? 'Fetching JD...' : hasRichFullDesc ? 'Refresh JD' : 'Fetch Full JD'}</span>
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
