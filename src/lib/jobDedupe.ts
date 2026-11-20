import type { JobPriority, JobRecord, NetworkingContact, PipelineStage } from '../types/job';

const PLACEHOLDER_URL_PATTERNS = [
  /^https?:\/\/(www\.)?google\.com\/search/i,
  /^https?:\/\/mail\.google\.com\//i,
  /^https?:\/\/(www\.)?example\.com/i,
];

const TRACKING_QUERY_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'trk',
  'trkemail',
  'refid',
  'trackingid',
  'lipi',
  'midtoken',
  'midsig',
  'eid',
  'otptoken',
  'gh_src',
  'lever-source',
  'ashby_jid',
  'source',
  'src',
  'ref',
  'referrer',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'currentjobid',
  'eBP',
  'ebp',
  'origin',
  'position',
  'pagenum',
  's',
  'v',
]);

const CORPORATE_SUFFIXES = new Set([
  'inc',
  'incorporated',
  'llc',
  'llp',
  'lp',
  'ltd',
  'limited',
  'corp',
  'corporation',
  'co',
  'company',
  'plc',
  'gmbh',
  'ag',
  'sa',
  'nv',
  'bv',
  'usa',
  'us',
]);

const TITLE_STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'in',
  'at',
  'for',
  'and',
  'or',
  'to',
  'with',
  'on',
  'by',
  'role',
  'position',
  'job',
  'opening',
  'opportunity',
  'remote',
  'hybrid',
  'onsite',
  'on-site',
  'us',
  'usa',
  'united',
  'states',
]);

const TITLE_ABBREVIATIONS: Record<string, string> = {
  ops: 'operations',
  mgmt: 'management',
  mgt: 'management',
  corp: 'corporate',
  intl: 'international',
  strat: 'strategy',
  tech: 'technology',
  mktg: 'marketing',
  biz: 'business',
  dev: 'development',
  fin: 'finance',
  comm: 'commercial',
  sr: 'senior',
  jr: 'junior',
};

const SENIORITY_TOKENS = new Set([
  'intern',
  'internship',
  'co-op',
  'coop',
  'junior',
  'associate',
  'senior',
  'staff',
  'principal',
  'lead',
  'manager',
  'director',
  'vp',
  'head',
  'chief',
  'executive',
  'entry',
  'fellow',
  'fellowship',
]);

const STAGE_PRIORITY: Record<PipelineStage, number> = {
  offer: 600,
  interviewing: 500,
  applied: 400,
  saved: 300,
  inbox: 100,
  archived: 0,
};

const PRIORITY_RANK: Record<JobPriority, number> = {
  asap: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function isPlaceholderOrEmptyJobUrl(rawUrl?: string | null): boolean {
  if (!rawUrl || !rawUrl.trim()) return true;
  const trimmed = rawUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) return true;
  return PLACEHOLDER_URL_PATTERNS.some((re) => re.test(trimmed));
}

export function canonicalizeJobUrl(rawUrl?: string | null): string {
  if (isPlaceholderOrEmptyJobUrl(rawUrl)) return '';
  const trimmed = rawUrl!.trim();
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');

    // Normalize LinkedIn job links (/comm/jobs/view/123456..., /jobs/view/slug-123456/, ?currentJobId=123456)
    if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
      const pathMatch = u.pathname.match(/(?:comm\/)?jobs\/view\/(?:[^/?#]*-)?(\d{7,12})(?:\/|$)/i);
      if (pathMatch?.[1]) {
        return `https://linkedin.com/jobs/view/${pathMatch[1]}`;
      }
      const currentJobId = u.searchParams.get('currentJobId');
      if (currentJobId && /^\d{7,12}$/.test(currentJobId)) {
        return `https://linkedin.com/jobs/view/${currentJobId}`;
      }
    }

    // Normalize Indeed job links (?jk=...)
    if (host === 'indeed.com' || host.endsWith('.indeed.com')) {
      const jk = u.searchParams.get('jk') || u.searchParams.get('vjk');
      if (jk && /^[a-zA-Z0-9_-]{8,32}$/.test(jk)) {
        return `https://indeed.com/viewjob?jk=${jk.toLowerCase()}`;
      }
    }

    // Strip hash and tracking query parameters
    u.hash = '';
    const keptParams: [string, string][] = [];
    for (const [k, v] of u.searchParams.entries()) {
      const lowerKey = k.toLowerCase();
      if (lowerKey.startsWith('utm_') || TRACKING_QUERY_PARAMS.has(lowerKey)) {
        continue;
      }
      keptParams.push([lowerKey, v]);
    }
    keptParams.sort(([a], [b]) => a.localeCompare(b));

    const cleanPath = u.pathname.replace(/\/+$/, '').toLowerCase() || '';
    const queryStr =
      keptParams.length > 0
        ? `?${keptParams.map(([k, v]) => `${k}=${encodeURIComponent(v.toLowerCase())}`).join('&')}`
        : '';

    return `https://${host}${cleanPath}${queryStr}`;
  } catch {
    return trimmed.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
  }
}

export function normalizeCompanyKey(rawCompany?: string | null): string {
  if (!rawCompany) return '';
  let text = rawCompany
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text || text === 'unknown company' || text === 'unspecified company') {
    return '';
  }

  // Strip trailing corporate legal suffixes (e.g. "Eli Lilly and Company" -> "eli lilly", "Roche Inc" -> "roche")
  const tokens = text.split(' ').filter(Boolean);
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    if (CORPORATE_SUFFIXES.has(last)) {
      tokens.pop();
      if (tokens.length > 1 && tokens[tokens.length - 1] === 'and') {
        tokens.pop();
      }
    } else {
      break;
    }
  }

  text = tokens.join(' ').trim();
  return text;
}

export function isUntitledJobTitle(rawTitle?: string | null): boolean {
  const t = (rawTitle ?? '').trim().toLowerCase();
  return !t || t === 'untitled' || t === 'untitled role' || t === 'unknown role';
}

export function normalizeTitleKey(rawTitle?: string | null): string {
  if (isUntitledJobTitle(rawTitle)) return '';
  const cleaned = (rawTitle ?? '')
    .toLowerCase()
    // Remove common parenthetical mode/location tags like (Remote), (Hybrid), (US), (Chicago, IL)
    .replace(/\(\s*(remote|hybrid|on-?site|us|usa|united states|full[- ]?time|part[- ]?time)\s*\)/gi, ' ')
    .replace(/\[\s*(remote|hybrid|on-?site|us|usa)\s*\]/gi, ' ')
    .replace(/&/g, ' and ')
    .replace(/\binternships\b/g, 'intern')
    .replace(/\binternship\b/g, 'intern')
    .replace(/[–—/|:,;•·()[\]{}]+/g, ' ')
    .replace(/[’'`"!?]/g, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned;
}

function canonicalizeTitleToken(tok: string): string {
  const expanded = TITLE_ABBREVIATIONS[tok] ?? tok;
  if (expanded.length > 5 && expanded.endsWith('ies')) {
    return `${expanded.slice(0, -3)}y`;
  }
  if (expanded.length > 4 && expanded.endsWith('s') && !expanded.endsWith('ss') && !expanded.endsWith('us')) {
    return expanded.slice(0, -1);
  }
  return expanded;
}

function extractTitleTokens(normalizedTitle: string): string[] {
  if (!normalizedTitle) return [];
  const raw = normalizedTitle.split(' ').filter(Boolean).map(canonicalizeTitleToken);
  const meaningful = raw.filter((tok) => tok.length > 1 && !TITLE_STOP_WORDS.has(tok));
  return meaningful.length > 0 ? meaningful : raw;
}

function extractYears(normalizedTitle: string): string[] {
  const matches = normalizedTitle.match(/\b20\d{2}\b/g);
  return matches ? Array.from(new Set(matches)).sort() : [];
}

function extractSenioritySet(tokens: string[]): Set<string> {
  const set = new Set<string>();
  for (const t of tokens) {
    if (SENIORITY_TOKENS.has(t)) {
      if (t === 'internship' || t === 'co-op' || t === 'coop') set.add('intern');
      else set.add(t);
    }
  }
  return set;
}

function levenshteinDistance(a: string, b: string, maxDist = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  const curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > maxDist) return maxDist + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/**
 * Generates deterministic multi-signal deduplication keys for a job record.
 * Used both client-side and server-side inside `existingHashes` so scanners across
 * Gmail, Slack, WhatsApp, ATS feeds, Target Companies, and CSV uploads share identical matching.
 */
export function buildJobDedupeKeys(job: {
  urlHash?: string | null;
  jobUrl?: string | null;
  company?: string | null;
  title?: string | null;
}): string[] {
  const keys: string[] = [];

  if (job.urlHash && job.urlHash.trim()) {
    keys.push(job.urlHash.trim());
  }

  const canonicalUrl = canonicalizeJobUrl(job.jobUrl);
  if (canonicalUrl) {
    keys.push(`url:${canonicalUrl}`);
  }

  const companyKey = normalizeCompanyKey(job.company);
  const titleKey = normalizeTitleKey(job.title);
  if (companyKey && titleKey) {
    keys.push(`ct:${companyKey}::${titleKey}`);
    const sortedTokens = Array.from(new Set(extractTitleTokens(titleKey))).sort();
    if (sortedTokens.length >= 2) {
      keys.push(`cts:${companyKey}::${sortedTokens.join(' ')}`);
    }
  }

  return keys;
}

/**
 * Builds the flat deduplication token list to pass as `existingHashes` to all scanners/imports.
 */
export function buildExistingDedupeTokens(
  jobs: Pick<JobRecord, 'urlHash' | 'jobUrl' | 'company' | 'title'>[]
): string[] {
  const set = new Set<string>();
  for (const job of jobs) {
    for (const key of buildJobDedupeKeys(job)) {
      set.add(key);
    }
  }
  return Array.from(set);
}

/**
 * Checks whether a candidate job matches any key already in `existingSet`.
 */
export function hasMatchingDedupeKey(
  existingSet: Set<string>,
  candidate: {
    urlHash?: string | null;
    jobUrl?: string | null;
    company?: string | null;
    title?: string | null;
  }
): boolean {
  const keys = buildJobDedupeKeys(candidate);
  return keys.some((k) => existingSet.has(k));
}

/**
 * Registers all dedupe keys for a job into `existingSet`.
 */
export function registerDedupeKeys(
  existingSet: Set<string>,
  candidate: {
    urlHash?: string | null;
    jobUrl?: string | null;
    company?: string | null;
    title?: string | null;
  }
): void {
  for (const key of buildJobDedupeKeys(candidate)) {
    existingSet.add(key);
  }
}

export function makeDuplicatePairKey(idA: string, idB: string): string {
  const a = idA.trim().slice(0, 128);
  const b = idB.trim().slice(0, 128);
  return a <= b ? `${a}::${b}` : `${b}::${a}`;
}

export function buildDismissedPairKeysForCluster(jobIds: string[]): string[] {
  const uniqueIds = Array.from(new Set(jobIds.map((id) => id.trim()).filter(Boolean)));
  const pairs: string[] = [];
  for (let i = 0; i < uniqueIds.length; i++) {
    for (let j = i + 1; j < uniqueIds.length; j++) {
      pairs.push(makeDuplicatePairKey(uniqueIds[i], uniqueIds[j]));
    }
  }
  return pairs;
}

export type DuplicateMatchReason =
  | 'Same role title & company'
  | 'Similar role title at same company';

/**
 * Pairwise comparison to determine whether two jobs represent the same role.
 * Strictly requires the SAME normalized company (roles at different companies are
 * NEVER treated as duplicates, even with identical titles), and allows slight fuzzy
 * matching of role titles within the same company (guarded by year & seniority checks).
 */
export function detectDuplicatePairReason(
  a: Pick<JobRecord, 'urlHash' | 'jobUrl' | 'company' | 'title'>,
  b: Pick<JobRecord, 'urlHash' | 'jobUrl' | 'company' | 'title'>
): DuplicateMatchReason | null {
  // Hard invariant: roles at different companies are never duplicates
  const compA = normalizeCompanyKey(a.company);
  const compB = normalizeCompanyKey(b.company);
  if (!compA || !compB || compA !== compB) {
    return null;
  }

  const titleA = normalizeTitleKey(a.title);
  const titleB = normalizeTitleKey(b.title);
  if (!titleA || !titleB) {
    return null;
  }

  if (titleA === titleB) {
    return 'Same role title & company';
  }

  // Guard 1: Do not match if explicit years conflict (e.g. 2026 vs 2027)
  const yearsA = extractYears(titleA);
  const yearsB = extractYears(titleB);
  if (yearsA.length > 0 && yearsB.length > 0 && yearsA.join(',') !== yearsB.join(',')) {
    return null;
  }

  const tokensA = Array.from(new Set(extractTitleTokens(titleA)));
  const tokensB = Array.from(new Set(extractTitleTokens(titleB)));
  if (tokensA.length === 0 || tokensB.length === 0) {
    return null;
  }

  // Exact word-order-invariant title match (e.g. "2027 Summer MBA Intern" vs "MBA Summer Intern 2027")
  const sortedA = [...tokensA].sort().join(' ');
  const sortedB = [...tokensB].sort().join(' ');
  if (sortedA === sortedB) {
    return 'Same role title & company';
  }

  // Guard 2: Do not fuzzy-match if explicit seniority levels conflict
  // (e.g. "Product Manager" vs "Senior Product Manager", or "Intern" vs "Director")
  const senA = extractSenioritySet(tokensA);
  const senB = extractSenioritySet(tokensB);
  if (senA.size !== senB.size || [...senA].some((s) => !senB.has(s))) {
    return null;
  }

  // Slight fuzzy match 1: Tiny character typo/edit on full normalized title (<= 2 edits for >= 10 chars)
  if (Math.min(titleA.length, titleB.length) >= 10 && levenshteinDistance(titleA, titleB, 2) <= 2) {
    return 'Similar role title at same company';
  }

  // Slight fuzzy match 2: High token overlap (Jaccard >= 0.72) or clean subset with <= 2 extra tokens
  // (e.g. "Global Pharma Strategy Intern" vs "2027 MBA Summer Global Pharma Strategy Intern" or extra city tag)
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let shared = 0;
  for (const tok of setA) {
    if (setB.has(tok)) shared += 1;
  }
  const unionSize = setA.size + setB.size - shared;
  const jaccard = unionSize > 0 ? shared / unionSize : 0;

  if (jaccard >= 0.72 && shared >= 2) {
    return 'Similar role title at same company';
  }

  const minSize = Math.min(setA.size, setB.size);
  const maxSize = Math.max(setA.size, setB.size);
  if (shared === minSize && minSize >= 2 && maxSize - minSize <= 2) {
    return 'Similar role title at same company';
  }

  return null;
}

export function findMatchingExistingJob(
  candidate: Pick<JobRecord, 'urlHash' | 'jobUrl' | 'company' | 'title'>,
  existingJobs: JobRecord[]
): JobRecord | undefined {
  const candidateComp = normalizeCompanyKey(candidate.company);
  const candidateUrl = canonicalizeJobUrl(candidate.jobUrl);
  for (const existing of existingJobs) {
    const existingComp = normalizeCompanyKey(existing.company);
    // Hard invariant: never collapse two jobs with different known companies
    if (candidateComp && existingComp && candidateComp !== existingComp) {
      continue;
    }
    if (detectDuplicatePairReason(candidate, existing)) {
      return existing;
    }
    if (candidate.urlHash && existing.urlHash && candidate.urlHash === existing.urlHash) {
      return existing;
    }
    if (candidateUrl) {
      const existingUrl = canonicalizeJobUrl(existing.jobUrl);
      if (existingUrl && existingUrl === candidateUrl) {
        return existing;
      }
    }
  }
  return undefined;
}

function scoreRecordKeepPriority(job: JobRecord): number {
  let score = STAGE_PRIORITY[job.stage] ?? 0;

  if (job.networkingContacts && job.networkingContacts.length > 0) {
    score += 80 + Math.min(job.networkingContacts.length * 5, 25);
  }
  if (job.notes && job.notes.trim().length > 0) {
    score += 60;
  }
  if (job.priority) {
    score += 35 + PRIORITY_RANK[job.priority] * 5;
  }
  if (job.feedback === 'up') {
    score += 35;
  } else if (job.feedback === 'down') {
    score += 10;
  }
  if (!isPlaceholderOrEmptyJobUrl(job.jobUrl)) {
    score += 30;
  }
  if (job.fullDescription && job.fullDescription.trim().length > 250) {
    score += 25;
  }
  if (job.salaryLabel && job.salaryLabel.trim() && job.salaryLabel.toLowerCase() !== 'not listed') {
    score += 15;
  }
  if (job.deadlineAt) {
    score += 15;
  }
  if (
    job.location &&
    job.location.trim() &&
    !/^(unspecified|not listed|unknown)$/i.test(job.location.trim())
  ) {
    score += 10;
  }
  if (job.skills && job.skills.length > 0) {
    score += Math.min(job.skills.length * 2, 10);
  }
  return score;
}

export interface DuplicateJobGroup {
  groupId: string;
  reason: DuplicateMatchReason;
  recommendedPrimaryId: string;
  jobs: JobRecord[];
}

/**
 * Clusters duplicate jobs strictly by same normalized role title at the same normalized company,
 * excluding any pairs explicitly marked by the user as "Not duplicates".
 */
export function findDuplicateJobGroups(
  jobs: JobRecord[],
  dismissedPairs?: Set<string> | string[]
): DuplicateJobGroup[] {
  const n = jobs.length;
  if (n < 2) return [];

  const dismissedSet =
    dismissedPairs instanceof Set
      ? dismissedPairs
      : new Set(Array.isArray(dismissedPairs) ? dismissedPairs : []);

  const parent = Array.from({ length: n }, (_, i) => i);
  const groupReason = new Map<number, DuplicateMatchReason>();

  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };

  const union = (a: number, b: number, reason: DuplicateMatchReason) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    parent[rb] = ra;
    const existing = groupReason.get(ra) ?? groupReason.get(rb);
    // If any pair in the cluster is fuzzy, label as similar; otherwise exact
    if (
      existing === 'Similar role title at same company' ||
      reason === 'Similar role title at same company'
    ) {
      groupReason.set(ra, 'Similar role title at same company');
    } else {
      groupReason.set(ra, reason);
    }
  };

  // Group strictly within the SAME normalized company (different companies are never compared)
  const byCompany = new Map<string, number[]>();

  for (let i = 0; i < n; i++) {
    const job = jobs[i];
    const compKey = normalizeCompanyKey(job.company);
    if (!compKey) continue;

    const list = byCompany.get(compKey) ?? [];
    for (const prevIdx of list) {
      const prevJob = jobs[prevIdx];
      if (dismissedSet.has(makeDuplicatePairKey(prevJob.id, job.id))) {
        continue;
      }
      const reason = detectDuplicatePairReason(prevJob, job);
      if (reason) {
        union(prevIdx, i, reason);
      }
    }
    list.push(i);
    byCompany.set(compKey, list);
  }

  const clusters = new Map<number, JobRecord[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = clusters.get(root) ?? [];
    list.push(jobs[i]);
    clusters.set(root, list);
  }

  const groups: DuplicateJobGroup[] = [];
  for (const [root, clusterJobs] of clusters.entries()) {
    if (clusterJobs.length < 2) continue;

    // Sort cluster so the strongest primary candidate is first
    const sorted = [...clusterJobs].sort((a, b) => {
      const scoreDiff = scoreRecordKeepPriority(b) - scoreRecordKeepPriority(a);
      if (scoreDiff !== 0) return scoreDiff;
      return a.discoveredAt.localeCompare(b.discoveredAt);
    });

    groups.push({
      groupId: `dup-${sorted[0].id}`,
      reason: groupReason.get(root) ?? 'Same role title & company',
      recommendedPrimaryId: sorted[0].id,
      jobs: sorted,
    });
  }

  // Sort groups by number of duplicates descending, then company name
  groups.sort((a, b) => {
    const lenDiff = b.jobs.length - a.jobs.length;
    if (lenDiff !== 0) return lenDiff;
    return a.jobs[0].company.localeCompare(b.jobs[0].company);
  });

  return groups;
}

function isUsefulText(val?: string | null): boolean {
  if (!val) return false;
  const t = val.trim().toLowerCase();
  return Boolean(t) && t !== 'not listed' && t !== 'unspecified' && t !== 'unknown';
}

function mergeNetworkingContacts(lists: (NetworkingContact[] | undefined)[]): NetworkingContact[] {
  const byKey = new Map<string, NetworkingContact>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const contact of list) {
      const key = `${contact.name.trim().toLowerCase()}::${(contact.role || '').trim().toLowerCase()}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, contact);
      } else {
        byKey.set(key, {
          ...existing,
          role: existing.role || contact.role,
          sentiment: existing.sentiment || contact.sentiment,
          lastContactDate: existing.lastContactDate || contact.lastContactDate,
          followUpDate: existing.followUpDate || contact.followUpDate,
          profileUrl: existing.profileUrl || contact.profileUrl,
          notes:
            existing.notes && contact.notes && !existing.notes.includes(contact.notes)
              ? `${existing.notes}\n${contact.notes}`.slice(0, 500)
              : existing.notes || contact.notes,
        });
      }
    }
  }
  return Array.from(byKey.values()).slice(0, 30);
}

export interface MergedDuplicateResult {
  mergedJob: JobRecord;
  removedJobIds: string[];
  detailsChanged: boolean;
  notesChanged: boolean;
  contactsChanged: boolean;
  triageChanged: boolean;
}

/**
 * Merges all non-empty data from redundant duplicate records into the chosen primary record
 * so no notes, networking contacts, priorities, salaries, deadlines, descriptions, or URLs are lost.
 */
export function computeMergedDuplicateJob(
  primary: JobRecord,
  duplicates: JobRecord[]
): MergedDuplicateResult {
  let merged: JobRecord = { ...primary };
  const removedJobIds = duplicates.map((d) => d.id);

  // Merge notes without duplicating identical text
  const noteParts: string[] = [];
  const seenNotes = new Set<string>();
  for (const rec of [primary, ...duplicates]) {
    const trimmed = (rec.notes || '').trim();
    if (trimmed && !seenNotes.has(trimmed.toLowerCase())) {
      seenNotes.add(trimmed.toLowerCase());
      noteParts.push(trimmed);
    }
  }
  const mergedNotes = noteParts.join('\n\n').slice(0, 4000);
  const notesChanged = mergedNotes !== (primary.notes || '');
  merged.notes = mergedNotes;

  // Merge networking contacts
  const mergedContacts = mergeNetworkingContacts([
    primary.networkingContacts,
    ...duplicates.map((d) => d.networkingContacts),
  ]);
  const contactsChanged =
    JSON.stringify(mergedContacts) !== JSON.stringify(primary.networkingContacts ?? []);
  if (mergedContacts.length > 0) {
    merged.networkingContacts = mergedContacts;
  }

  // Preserve triage feedback if primary had none
  let triageChanged = false;
  if (!merged.feedback) {
    const withFeedback = duplicates.find((d) => d.feedback === 'up' || d.feedback === 'down');
    if (withFeedback) {
      merged.feedback = withFeedback.feedback;
      merged.dislikeReason = withFeedback.dislikeReason;
      triageChanged = true;
    }
  }

  // Merge richer detail fields
  let detailsChanged = false;

  // Priority: keep primary if set; else pick highest urgency among duplicates
  if (!merged.priority) {
    let bestPriority: JobPriority | undefined;
    for (const d of duplicates) {
      if (d.priority && (!bestPriority || PRIORITY_RANK[d.priority] > PRIORITY_RANK[bestPriority])) {
        bestPriority = d.priority;
      }
    }
    if (bestPriority) {
      merged.priority = bestPriority;
      detailsChanged = true;
    }
  }

  // Job URL: upgrade if primary is empty/placeholder and a duplicate has a real URL
  if (isPlaceholderOrEmptyJobUrl(merged.jobUrl)) {
    const withRealUrl = duplicates.find((d) => !isPlaceholderOrEmptyJobUrl(d.jobUrl));
    if (withRealUrl) {
      merged.jobUrl = withRealUrl.jobUrl;
      if (withRealUrl.companyDomain) {
        merged.companyDomain = withRealUrl.companyDomain;
      }
      detailsChanged = true;
    }
  }

  // Salary
  if (!isUsefulText(merged.salaryLabel)) {
    const withSalary = duplicates.find((d) => isUsefulText(d.salaryLabel));
    if (withSalary) {
      merged.salaryLabel = withSalary.salaryLabel;
      merged.salaryMin = withSalary.salaryMin ?? merged.salaryMin;
      merged.salaryMax = withSalary.salaryMax ?? merged.salaryMax;
      detailsChanged = true;
    }
  }

  // Location
  if (!isUsefulText(merged.location)) {
    const withLoc = duplicates.find((d) => isUsefulText(d.location));
    if (withLoc) {
      merged.location = withLoc.location;
      merged.locationType = withLoc.locationType;
      detailsChanged = true;
    }
  }

  // Deadline
  if (!merged.deadlineAt) {
    const withDeadline = duplicates.find((d) => Boolean(d.deadlineAt));
    if (withDeadline?.deadlineAt) {
      merged.deadlineAt = withDeadline.deadlineAt;
      detailsChanged = true;
    }
  }

  // Employment Type
  if (!isUsefulText(merged.employmentType)) {
    const withEmp = duplicates.find((d) => isUsefulText(d.employmentType));
    if (withEmp?.employmentType) {
      merged.employmentType = withEmp.employmentType;
      detailsChanged = true;
    }
  }

  // MBA role flag
  if (!merged.isMbaRole && duplicates.some((d) => d.isMbaRole)) {
    merged.isMbaRole = true;
    detailsChanged = true;
  }

  // Full description: upgrade if a duplicate has a substantially richer description
  const bestDescDup = duplicates.reduce<JobRecord | null>((best, d) => {
    const len = (d.fullDescription || '').trim().length;
    const bestLen = (best?.fullDescription || '').trim().length;
    return len > bestLen ? d : best;
  }, null);
  const currentDescLen = (merged.fullDescription || '').trim().length;
  if (bestDescDup && (bestDescDup.fullDescription || '').trim().length > currentDescLen + 100) {
    merged.fullDescription = bestDescDup.fullDescription;
    detailsChanged = true;
  }

  // Summary: upgrade if primary summary is short/generic
  if ((merged.summary || '').trim().length < 40) {
    const withBetterSummary = duplicates.find((d) => (d.summary || '').trim().length >= 40);
    if (withBetterSummary) {
      merged.summary = withBetterSummary.summary;
      detailsChanged = true;
    }
  }

  // Skills: union (deduped case-insensitively, capped at 12)
  const skillMap = new Map<string, string>();
  for (const rec of [primary, ...duplicates]) {
    for (const s of rec.skills ?? []) {
      const trimmed = s.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (!skillMap.has(key)) skillMap.set(key, trimmed);
    }
  }
  const mergedSkills = Array.from(skillMap.values()).slice(0, 12);
  if (mergedSkills.length > (primary.skills?.length ?? 0)) {
    merged.skills = mergedSkills;
    detailsChanged = true;
  }

  return {
    mergedJob: merged,
    removedJobIds,
    detailsChanged,
    notesChanged,
    contactsChanged,
    triageChanged,
  };
}
