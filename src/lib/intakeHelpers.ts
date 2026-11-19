import type { LocationType, UserIntakeProfile } from '../types/job';

export interface GmailSenderPreset {
  label: string;
  sender: string;
  description: string;
}

export const GMAIL_SENDER_PRESETS: GmailSenderPreset[] = [
  {
    label: 'LinkedIn Job Alerts',
    sender: 'jobalerts-noreply@linkedin.com',
    description: 'Daily/weekly LinkedIn saved search alerts',
  },
  {
    label: 'LinkedIn Messages',
    sender: 'messages-noreply@linkedin.com',
    description: 'Recruiter InMails and direct outreach',
  },
  {
    label: 'Indeed Alerts',
    sender: 'alert@indeed.com',
    description: 'Indeed job alert digests',
  },
  {
    label: 'Handshake',
    sender: 'joinhandshake.com',
    description: 'Campus & early-career job alerts',
  },
  {
    label: 'Wellfound',
    sender: 'wellfound.com',
    description: 'Startup job matches & founder messages',
  },
  {
    label: 'Glassdoor',
    sender: 'glassdoor.com',
    description: 'Glassdoor job recommendations',
  },
  {
    label: 'Built In',
    sender: 'builtin.com',
    description: 'Tech hub job roundups',
  },
  {
    label: '12twenty / Campus Career',
    sender: '12twenty.com',
    description: 'University career portal & recruiting deadlines',
  },
  {
    label: 'Kellogg Career',
    sender: 'kellogg.northwestern.edu',
    description: 'Kellogg recruiting newsletters & events',
  },
];

export const DEFAULT_GMAIL_SENDERS: string[] = [
  'jobalerts-noreply@linkedin.com',
  'messages-noreply@linkedin.com',
  'alert@indeed.com',
  'wellfound.com',
];

export const DEFAULT_SLACK_CHANNELS: string[] = [
  'jobs',
  'hiring',
  'careers',
  'referrals',
];

export const DEFAULT_WHATSAPP_GROUPS: string[] = [
  'Job Board & Referrals',
];

export const ROLE_TYPE_SUGGESTIONS: string[] = [
  'Software Engineer',
  'Senior / Staff Engineer',
  'Product Manager',
  'Strategy & Operations',
  'Data Scientist / ML Engineer',
  'Product Designer',
  'Chief of Staff',
  'Corporate Strategy / BizOps',
  'Consulting',
  'Finance / Venture Capital',
];

export const EMPLOYMENT_TYPE_OPTIONS: string[] = [
  'Full-time',
  'Internship',
  'Contract',
  'Part-time',
];

export const WORK_MODE_OPTIONS: LocationType[] = ['Remote', 'Hybrid', 'Onsite'];

export interface DashboardCadenceOption {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  minutes: number;
}

export const DASHBOARD_CADENCE_OPTIONS: DashboardCadenceOption[] = [
  {
    id: 'hourly',
    label: 'Every hour',
    description: 'Fastest alerts for high-velocity roles',
    enabled: true,
    minutes: 60,
  },
  {
    id: '4h',
    label: 'Every 4 hours',
    description: 'Recommended balance of freshness & focus',
    enabled: true,
    minutes: 240,
  },
  {
    id: '12h',
    label: 'Twice daily (12h)',
    description: 'Morning & evening pipeline refresh',
    enabled: true,
    minutes: 720,
  },
  {
    id: 'daily',
    label: 'Daily (24h)',
    description: 'One consolidated daily digest',
    enabled: true,
    minutes: 1440,
  },
  {
    id: 'manual',
    label: 'Manual only',
    description: 'Refresh only when you click Run Agent',
    enabled: false,
    minutes: 240,
  },
];

export function normalizeSenderInput(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^from:/i, '')
    .replace(/^@/, '')
    .replace(/[<>"']/g, '')
    .slice(0, 120);
}

export function buildGmailQueryFromSenders(
  senders: string[],
  lookbackDays = 60
): string {
  const cleaned = Array.from(
    new Set(senders.map(normalizeSenderInput).filter(Boolean))
  ).slice(0, 30);

  if (cleaned.length === 0) {
    return `(subject:("job alert" OR "new jobs" OR "is hiring" OR "application deadline") OR from:linkedin.com) newer_than:${lookbackDays}d`;
  }

  const clauses = cleaned.map((entry) => {
    if (entry.includes(' ')) {
      return `"${entry}"`;
    }
    return `from:${entry}`;
  });

  return `(${clauses.join(' OR ')}) newer_than:${lookbackDays}d`;
}

export function compileIntakeToSearchPrompt(intake: {
  roleTypes: string[];
  locations: string[];
  workModes: LocationType[];
  keywords: string[];
  employmentTypes: string[];
}): string {
  const parts: string[] = [];

  if (intake.roleTypes.length > 0) {
    parts.push(`Target roles: ${intake.roleTypes.join(', ')}.`);
  }
  if (intake.employmentTypes.length > 0) {
    parts.push(`Employment type: ${intake.employmentTypes.join(', ')}.`);
  }
  if (intake.workModes.length > 0 || intake.locations.length > 0) {
    const modeStr =
      intake.workModes.length > 0 ? intake.workModes.join(' or ') : 'Any work mode';
    const locStr =
      intake.locations.length > 0 ? ` in ${intake.locations.join(', ')}` : '';
    parts.push(`Location preference: ${modeStr}${locStr}.`);
  }
  if (intake.keywords.length > 0) {
    parts.push(`Priority keywords & focus areas: ${intake.keywords.join(', ')}.`);
  }

  return (
    parts.join(' ') ||
    'Relevant roles matching my background, preferred locations, and career goals.'
  );
}

export function createDefaultIntakeProfile(
  uid = '',
  email = '',
  displayName = ''
): UserIntakeProfile {
  return {
    uid,
    email,
    displayName,
    onboardingCompleted: false,
    roleTypes: ['Product Manager', 'Senior / Staff Engineer'],
    locations: ['Chicago, IL', 'New York, NY', 'San Francisco, CA'],
    workModes: ['Remote', 'Hybrid'],
    keywords: ['AI/ML', 'B2B SaaS', 'TypeScript', 'Product Strategy'],
    employmentTypes: ['Full-time'],
    gmailSenders: [...DEFAULT_GMAIL_SENDERS],
    slackChannels: [...DEFAULT_SLACK_CHANNELS],
    whatsappGroups: [...DEFAULT_WHATSAPP_GROUPS],
  };
}
