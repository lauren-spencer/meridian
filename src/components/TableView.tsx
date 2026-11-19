import React, { useMemo, useState } from 'react';
import {
  ArrowUpDown,
  Building2,
  Layers,
  Link2,
  RefreshCw,
  Search,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  RotateCcw,
  X,
} from 'lucide-react';
import {
  DislikeReason,
  EmploymentType,
  JobPriority,
  JobRecord,
  JobSource,
  LocationType,
  PipelineStage,
} from '../types/job';
import {
  EMPLOYMENT_TYPES,
  detectIsMbaRole,
  normalizeEmploymentType,
} from '../lib/resumeClient';
import { DislikeReasonPopover } from './DislikeReasonPopover';

type TableTab = 'new' | 'active' | 'all' | 'archived';
type SortField = 'matchScore' | 'discoveredAt' | 'salaryMax' | 'company' | 'priority';
type SortDirection = 'asc' | 'desc';

const PRIORITY_RANK: Record<JobPriority, number> = {
  asap: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function prioritySelectClass(priority?: JobPriority): string {
  switch (priority) {
    case 'asap':
      return 'text-rose-800 font-semibold bg-rose-100/80 border-rose-300 hover:border-rose-400';
    case 'high':
      return 'text-red-700 font-semibold bg-red-50/70 border-red-200 hover:border-red-300';
    case 'medium':
      return 'text-amber-700 font-medium bg-amber-50/70 border-amber-200 hover:border-amber-300';
    case 'low':
      return 'text-blue-700 font-medium bg-blue-50/60 border-blue-200 hover:border-blue-300';
    default:
      return 'text-zinc-400 bg-white border-zinc-200 hover:border-zinc-300 hover:text-zinc-600';
  }
}

interface TableViewProps {
  jobs: JobRecord[];
  sources: JobSource[];
  isAgentRunning: boolean;
  isRescoring: boolean;
  onSelectJob: (job: JobRecord) => void;
  onThumbsUp: (jobId: string) => void;
  onThumbsDown: (jobId: string, reason?: DislikeReason) => void;
  onRestoreJob: (jobId: string) => void;
  onDeleteJob: (jobId: string) => void;
  onToggleMbaRole: (jobId: string, isMbaRole: boolean) => void;
  onChangePriority: (jobId: string, priority: JobPriority | null) => void;
  onOpenAddByUrl?: () => void;
  onMoveUntitledToTargetCompanies?: () => void;
  duplicateGroupCount?: number;
  duplicateExtraCount?: number;
  onOpenDeduplicate?: () => void;
  onRunAgent: () => void;
  onRescoreActiveJobs: () => void;
  initialTab?: TableTab;
}

const STAGE_LABEL: Record<PipelineStage, string> = {
  inbox: 'Inbox',
  saved: 'Saved',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  archived: 'Archived',
};

const STAGE_TEXT_COLOR: Record<PipelineStage, string> = {
  inbox: 'text-blue-700',
  saved: 'text-zinc-800',
  applied: 'text-indigo-700',
  interviewing: 'text-amber-700',
  offer: 'text-emerald-700',
  archived: 'text-zinc-400',
};

function formatShortDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function TableView({
  jobs,
  sources,
  isAgentRunning,
  isRescoring,
  onSelectJob,
  onThumbsUp,
  onThumbsDown,
  onRestoreJob,
  onDeleteJob,
  onToggleMbaRole,
  onChangePriority,
  onOpenAddByUrl,
  onMoveUntitledToTargetCompanies,
  duplicateGroupCount = 0,
  duplicateExtraCount = 0,
  onOpenDeduplicate,
  onRunAgent,
  onRescoreActiveJobs,
  initialTab = 'active',
}: TableViewProps) {
  const [tab, setTab] = useState<TableTab>(initialTab);
  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState<'all' | LocationType>('all');
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState<'all' | EmploymentType>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | JobPriority | 'none'>('all');
  const [mbaOnly, setMbaOnly] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('discoveredAt');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [openDislikeId, setOpenDislikeId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const newCount = jobs.filter((j) => j.isNew && j.stage !== 'archived').length;
    const activeCount = jobs.filter((j) => j.stage !== 'archived').length;
    const archivedCount = jobs.filter((j) => j.stage === 'archived').length;
    const untitledCount = jobs.filter((j) => {
      if (j.stage === 'archived') return false;
      const t = (j.title || '').trim().toLowerCase();
      const c = (j.company || '').trim().toLowerCase();
      return (!t || t === 'untitled role' || t === 'untitled') && Boolean(c) && c !== 'unknown company';
    }).length;
    return { newCount, activeCount, allCount: jobs.length, archivedCount, untitledCount };
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase();

    return jobs
      .filter((job) => {
        if (tab === 'new' && !(job.isNew && job.stage !== 'archived')) return false;
        if (tab === 'active' && job.stage === 'archived') return false;
        if (tab === 'archived' && job.stage !== 'archived') return false;
        if (locationFilter !== 'all' && job.locationType !== locationFilter) return false;
        if (employmentTypeFilter !== 'all') {
          const normalizedType = normalizeEmploymentType(
            job.employmentType,
            job.title,
            job.summary
          );
          if (normalizedType !== employmentTypeFilter) return false;
        }
        if (priorityFilter !== 'all') {
          if (priorityFilter === 'none') {
            if (job.priority) return false;
          } else if (job.priority !== priorityFilter) {
            return false;
          }
        }
        if (mbaOnly) {
          const isMba = job.isMbaRole ?? detectIsMbaRole(job.title);
          if (!isMba) return false;
        }
        if (sourceFilter !== 'all') {
          if (sourceFilter === 'target-company') {
            if (job.atsType !== 'Target Company') return false;
          } else if (job.sourceId !== sourceFilter) {
            return false;
          }
        }
        if (q) {
          const haystack = `${job.title} ${job.company} ${job.location} ${job.employmentType || ''} ${job.priority || ''} ${job.skills.join(' ')} ${job.sourceName}`.toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        // Keep newly discovered roles surfaced first when sorting by date desc
        if (sortField === 'discoveredAt' && sortDir === 'desc') {
          if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
        }
        let cmp = 0;
        if (sortField === 'priority') {
          const rankA = a.priority ? PRIORITY_RANK[a.priority] : 0;
          const rankB = b.priority ? PRIORITY_RANK[b.priority] : 0;
          cmp = rankA - rankB;
          if (cmp === 0) cmp = a.matchScore - b.matchScore;
        } else if (sortField === 'matchScore') {
          cmp = a.matchScore - b.matchScore;
        } else if (sortField === 'salaryMax') {
          cmp = (a.salaryMax ?? 0) - (b.salaryMax ?? 0);
        } else if (sortField === 'company') {
          cmp = a.company.localeCompare(b.company);
        } else {
          cmp = a.discoveredAt.localeCompare(b.discoveredAt);
        }
        return sortDir === 'asc' ? cmp : -cmp;
      });
  }, [
    jobs,
    tab,
    search,
    locationFilter,
    employmentTypeFilter,
    priorityFilter,
    mbaOnly,
    sourceFilter,
    sortField,
    sortDir,
  ]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  return (
    <div className="space-y-5">
      {/* Page heading & summary strip */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950">
            Role Discovery Table
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Review newly pulled roles, upvote matches into your pipeline, or hide off-target listings to tune future agent runs.
          </p>
        </div>

        {/* Quiet unboxed summary metrics */}
        <div className="flex items-center gap-4 text-xs text-zinc-500 tabular-nums shrink-0">
          <span>
            <strong className="font-semibold text-blue-600 font-mono">{counts.newCount}</strong> new to triage
          </span>
          <span aria-hidden="true" className="text-zinc-300">·</span>
          <span>
            <strong className="font-semibold text-zinc-900 font-mono">{counts.activeCount}</strong> active
          </span>
          <span aria-hidden="true" className="text-zinc-300">·</span>
          <span>
            <strong className="font-semibold text-zinc-600 font-mono">{counts.archivedCount}</strong> archived
          </span>
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        {/* Segmented tabs (functional filter controls) */}
        <div
          role="tablist"
          aria-label="Filter jobs by triage state"
          className="inline-flex items-center p-1 bg-zinc-100 rounded-lg self-start"
        >
          {(
            [
              { id: 'new', label: `New (${counts.newCount})` },
              { id: 'active', label: `Active (${counts.activeCount})` },
              { id: 'all', label: `All (${counts.allCount})` },
              { id: 'archived', label: `Archived (${counts.archivedCount})` },
            ] as const
          ).map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => setTab(item.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-white text-zinc-950 shadow-2xs'
                    : 'text-zinc-600 hover:text-zinc-950'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Search + dropdown filters */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 sm:flex-initial sm:w-64">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search role, company, skill..."
              aria-label="Search roles"
              className="w-full h-9 pl-8 pr-3 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          <select
            aria-label="Filter by work mode"
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value as 'all' | LocationType)}
            className="h-9 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
          >
            <option value="all">All locations</option>
            <option value="Remote">Remote</option>
            <option value="Hybrid">Hybrid</option>
            <option value="Onsite">Onsite</option>
          </select>

          <select
            aria-label="Filter by employment type"
            value={employmentTypeFilter}
            onChange={(e) =>
              setEmploymentTypeFilter(e.target.value as 'all' | EmploymentType)
            }
            className="h-9 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
          >
            <option value="all">All types</option>
            {EMPLOYMENT_TYPES.map((et) => (
              <option key={et} value={et}>
                {et}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by priority"
            value={priorityFilter}
            onChange={(e) =>
              setPriorityFilter(e.target.value as 'all' | JobPriority | 'none')
            }
            className="h-9 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
          >
            <option value="all">All priorities</option>
            <option value="asap">ASAP</option>
            <option value="high">High priority</option>
            <option value="medium">Medium priority</option>
            <option value="low">Low priority</option>
            <option value="none">No priority</option>
          </select>

          <label className="inline-flex items-center gap-1.5 h-9 px-2.5 text-xs text-zinc-700 bg-white border border-zinc-200 rounded-md cursor-pointer select-none whitespace-nowrap">
            <input
              type="checkbox"
              checked={mbaOnly}
              onChange={(e) => setMbaOnly(e.target.checked)}
              className="rounded border-zinc-300 text-blue-600 focus:ring-blue-600 cursor-pointer"
            />
            <span>MBA only</span>
          </label>

          <select
            aria-label="Filter by source"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="h-9 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
          >
            <option value="all">All sources</option>
            <option value="src-gmail">Gmail Job Alerts</option>
            <option value="src-slack">Slack Channels</option>
            <option value="src-whatsapp">WhatsApp Groups</option>
            <option value="src-csv-import">Uploaded CSV / JSON</option>
            <option value="src-manual-url">Manual URL</option>
            <option value="target-company">Target Companies Watchlist</option>
            {sources.map((src) => (
              <option key={src.id} value={src.id}>
                {src.name}
              </option>
            ))}
          </select>

          {onOpenAddByUrl && (
            <button
              type="button"
              onClick={onOpenAddByUrl}
              title="Add a single job posting by pasting its URL"
              className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-zinc-800 bg-white border border-zinc-200 hover:bg-zinc-50 hover:border-zinc-300 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Link2 className="w-3.5 h-3.5 text-blue-600" />
              <span>Add Role URL</span>
            </button>
          )}

          {onOpenDeduplicate && (
            <button
              type="button"
              onClick={onOpenDeduplicate}
              title={
                duplicateExtraCount > 0
                  ? `Review and merge ${duplicateExtraCount} duplicate roles`
                  : 'Check for duplicate roles in your workspace'
              }
              className={`inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                duplicateExtraCount > 0
                  ? 'text-amber-800 bg-amber-50 border-amber-300 hover:bg-amber-100/80'
                  : 'text-zinc-700 bg-white border-zinc-200 hover:bg-zinc-50'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>
                {duplicateExtraCount > 0
                  ? `Duplicates (${duplicateExtraCount})`
                  : 'Check Duplicates'}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={onRescoreActiveJobs}
            disabled={isRescoring}
            title="Re-score Inbox and Saved roles using your latest criteria and feedback"
            className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 disabled:text-zinc-400 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-wait"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRescoring ? 'animate-spin' : ''}`} />
            <span>{isRescoring ? 'Re-scoring...' : 'Re-score'}</span>
          </button>
        </div>
      </div>

      {/* Duplicate Roles Detection & Cleanup Banner */}
      {duplicateExtraCount > 0 && onOpenDeduplicate && (
        <div className="px-4 py-3 bg-amber-50/75 border border-amber-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs text-zinc-700">
            <Layers className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              <strong className="font-semibold text-zinc-950">
                {duplicateExtraCount} duplicate {duplicateExtraCount === 1 ? 'role' : 'roles'} detected
              </strong>{' '}
              across {duplicateGroupCount} {duplicateGroupCount === 1 ? 'group' : 'groups'} (same posting link or role &amp; company). Review and merge them into single clean entries without losing notes, contacts, or pipeline stage.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenDeduplicate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-md whitespace-nowrap shrink-0 cursor-pointer self-start sm:self-center"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Review &amp; Merge</span>
          </button>
        </div>
      )}

      {/* Untitled Role -> Target Companies Watchlist Helper Banner */}
      {counts.untitledCount > 0 && onMoveUntitledToTargetCompanies && (
        <div className="px-4 py-3 bg-blue-50/60 border border-blue-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs text-zinc-700">
            <Building2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              <strong className="font-semibold text-zinc-950">
                {counts.untitledCount} {counts.untitledCount === 1 ? 'row has' : 'rows have'} &ldquo;Untitled Role&rdquo;
              </strong>{' '}
              — if these are target companies you want Meridian to watch for your desired roles, move them to your Target Companies Watchlist in one click (or run the agent to search for open roles &amp; fill missing fields).
            </p>
          </div>
          <button
            type="button"
            onClick={onMoveUntitledToTargetCompanies}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md whitespace-nowrap shrink-0 cursor-pointer self-start sm:self-center"
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Move to Target Companies</span>
          </button>
        </div>
      )}

      {/* High-density data grid */}
      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50/70 text-[11px] font-medium text-zinc-500">
                <th className="py-2.5 pl-4 pr-3 w-28 whitespace-nowrap">Status</th>
                <th className="py-2.5 px-3 w-24 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => toggleSort('priority')}
                    className="inline-flex items-center gap-1 hover:text-zinc-900 cursor-pointer"
                  >
                    <span>Priority</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-2.5 px-3 min-w-[260px]">
                  <button
                    type="button"
                    onClick={() => toggleSort('company')}
                    className="inline-flex items-center gap-1 hover:text-zinc-900 cursor-pointer"
                  >
                    <span>Role &amp; Company</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-2.5 px-3 w-24 whitespace-nowrap">Type</th>
                <th className="py-2.5 px-3 text-center w-14 whitespace-nowrap">MBA</th>
                <th className="py-2.5 px-3 text-right w-24 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => toggleSort('matchScore')}
                    className="inline-flex items-center gap-1 hover:text-zinc-900 cursor-pointer"
                  >
                    <span>Match</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-2.5 px-3 text-right w-36 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => toggleSort('salaryMax')}
                    className="inline-flex items-center gap-1 hover:text-zinc-900 cursor-pointer"
                  >
                    <span>Compensation</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-2.5 px-3 w-36 whitespace-nowrap">Location</th>
                <th className="py-2.5 px-3 w-40 whitespace-nowrap">Source</th>
                <th className="py-2.5 px-3 text-right w-28 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => toggleSort('discoveredAt')}
                    className="inline-flex items-center gap-1 hover:text-zinc-900 cursor-pointer"
                  >
                    <span>Discovered</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-2.5 pl-3 pr-4 text-right w-28 whitespace-nowrap">Triage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 text-[13px]">
              {isAgentRunning && (
                <tr className="bg-blue-50/30 animate-pulse">
                  <td colSpan={11} className="py-3 px-4 text-xs text-blue-700">
                    Scanning configured ATS feeds, checking Target Companies, and enriching incomplete role details...
                  </td>
                </tr>
              )}

              {filteredJobs.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 px-4 text-center">
                    <p className="text-sm font-medium text-zinc-900">
                      {tab === 'new'
                        ? 'Inbox clear — all newly pulled roles have been triaged.'
                        : 'No roles match your current filters.'}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {tab === 'new'
                        ? 'Run an agent check now to pull fresh openings from your configured sources, or view your active pipeline.'
                        : 'Try clearing your search query or switching tabs.'}
                    </p>
                    <div className="mt-4 flex items-center justify-center gap-3">
                      {tab === 'new' ? (
                        <>
                          <button
                            type="button"
                            onClick={onRunAgent}
                            className="px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
                          >
                            Run Agent Now
                          </button>
                          <button
                            type="button"
                            onClick={() => setTab('active')}
                            className="px-3.5 py-2 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md cursor-pointer"
                          >
                            View Active Pipeline
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setSearch('');
                            setLocationFilter('all');
                            setEmploymentTypeFilter('all');
                            setPriorityFilter('all');
                            setMbaOnly(false);
                            setSourceFilter('all');
                            setTab('active');
                          }}
                          className="px-3.5 py-2 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md cursor-pointer"
                        >
                          Reset Filters
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredJobs.map((job) => {
                  const normalizedType = normalizeEmploymentType(
                    job.employmentType,
                    job.title,
                    job.summary
                  );
                  const isMba = job.isMbaRole ?? detectIsMbaRole(job.title);
                  const scoreColor =
                    job.matchScore >= 90
                      ? 'text-emerald-700'
                      : job.matchScore >= 75
                        ? 'text-zinc-900'
                        : 'text-amber-700';

                  return (
                    <tr
                      key={job.id}
                      onClick={() => onSelectJob(job)}
                      className={`group transition-colors cursor-pointer ${
                        job.isNew
                          ? 'bg-blue-50/35 hover:bg-blue-50/60'
                          : 'hover:bg-zinc-50/80'
                      }`}
                    >
                      {/* Status */}
                      <td className="py-3 pl-4 pr-3 whitespace-nowrap align-middle">
                        <div className="flex items-center gap-1.5 text-xs">
                          {job.isNew && (
                            <>
                              <span className="font-semibold text-blue-600">New</span>
                              <span className="text-zinc-300" aria-hidden="true">·</span>
                            </>
                          )}
                          <span className={`font-medium ${STAGE_TEXT_COLOR[job.stage]}`}>
                            {STAGE_LABEL[job.stage]}
                          </span>
                        </div>
                      </td>

                      {/* Priority */}
                      <td
                        className="py-3 px-3 whitespace-nowrap align-middle"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <select
                          aria-label={`Priority for ${job.title} at ${job.company}`}
                          value={job.priority ?? ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            onChangePriority(
                              job.id,
                              val === 'asap' ||
                                val === 'high' ||
                                val === 'medium' ||
                                val === 'low'
                                ? val
                                : null
                            );
                          }}
                          className={`h-7 px-2 text-[11.5px] rounded border transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-600/20 ${prioritySelectClass(
                            job.priority
                          )}`}
                        >
                          <option value="">—</option>
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="asap">ASAP</option>
                        </select>
                      </td>

                      {/* Role & Company */}
                      <td className="py-3 px-3 align-middle">
                        <div className="font-medium text-zinc-950 group-hover:text-blue-700 transition-colors leading-snug">
                          {job.title}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
                          <span className="text-zinc-700 font-medium">{job.company}</span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate max-w-[260px]">
                            {job.skills.slice(0, 3).join(' / ')}
                          </span>
                          {job.dislikeReason && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-red-600">{job.dislikeReason}</span>
                            </>
                          )}
                        </div>
                      </td>

                      {/* Employment Type */}
                      <td className="py-3 px-3 whitespace-nowrap align-middle text-xs text-zinc-700">
                        {normalizedType}
                      </td>

                      {/* MBA Role checkbox */}
                      <td
                        className="py-3 px-3 text-center whitespace-nowrap align-middle"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isMba}
                          onChange={(e) => onToggleMbaRole(job.id, e.target.checked)}
                          aria-label={`Mark ${job.title} at ${job.company} as MBA role`}
                          title={isMba ? 'MBA role (checked)' : 'Check to mark as MBA role'}
                          className="rounded border-zinc-300 text-blue-600 focus:ring-blue-600 cursor-pointer"
                        />
                      </td>

                      {/* Match Score (+ optional delta after feedback re-scoring) */}
                      <td className="py-3 px-3 text-right whitespace-nowrap align-middle">
                        <div className="inline-flex items-baseline justify-end gap-1 font-mono text-xs tabular-nums">
                          <span className={`font-medium ${scoreColor}`}>
                            {job.matchScore}%
                          </span>
                          {typeof job.previousMatchScore === 'number' &&
                            job.previousMatchScore !== job.matchScore && (
                              <span
                                className={`text-[10.5px] ${
                                  job.matchScore > job.previousMatchScore
                                    ? 'text-emerald-600'
                                    : 'text-amber-600'
                                }`}
                                title={`Previously ${job.previousMatchScore}%`}
                              >
                                {job.matchScore > job.previousMatchScore ? '+' : ''}
                                {job.matchScore - job.previousMatchScore}
                              </span>
                            )}
                        </div>
                      </td>

                      {/* Compensation */}
                      <td className="py-3 px-3 text-right whitespace-nowrap align-middle font-mono text-xs text-zinc-700 tabular-nums">
                        {job.salaryLabel}
                      </td>

                      {/* Location */}
                      <td className="py-3 px-3 whitespace-nowrap align-middle text-xs text-zinc-600">
                        <div>{job.locationType}</div>
                        <div className="text-[11px] text-zinc-400 truncate max-w-[130px]">
                          {job.location}
                        </div>
                      </td>

                      {/* Source */}
                      <td className="py-3 px-3 whitespace-nowrap align-middle text-xs text-zinc-600">
                        <div className="truncate max-w-[150px] text-zinc-700">{job.sourceName}</div>
                        <div className="text-[11px] text-zinc-400">{job.atsType}</div>
                      </td>

                      {/* Discovered */}
                      <td className="py-3 px-3 text-right whitespace-nowrap align-middle font-mono text-xs text-zinc-500 tabular-nums">
                        {formatShortDate(job.discoveredAt)}
                      </td>

                      {/* Triage & Delete actions */}
                      <td
                        className="py-3 pl-3 pr-4 text-right whitespace-nowrap align-middle relative"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {confirmDeleteId === job.id ? (
                          <div className="inline-flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmDeleteId(null);
                                onDeleteJob(job.id);
                              }}
                              className="px-2 py-1 text-[11px] font-medium text-white bg-red-600 hover:bg-red-700 rounded cursor-pointer"
                            >
                              Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              aria-label="Cancel delete"
                              className="p-1 text-zinc-400 hover:text-zinc-800 rounded cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : job.stage === 'archived' ? (
                          <div className="inline-flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => onRestoreJob(job.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-zinc-600 hover:text-zinc-950 hover:bg-zinc-100 rounded-md transition-colors cursor-pointer"
                              title="Restore role to Saved"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Restore</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(job.id)}
                              aria-label={`Delete ${job.title} at ${job.company}`}
                              title="Permanently delete role"
                              className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => onThumbsUp(job.id)}
                              aria-label={`Thumbs up ${job.title} at ${job.company}`}
                              title={
                                job.isNew
                                  ? 'Upvote and move to Saved'
                                  : 'Marked as strong match'
                              }
                              className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                                job.feedback === 'up'
                                  ? 'text-emerald-700 bg-emerald-50'
                                  : 'text-zinc-400 hover:text-emerald-700 hover:bg-emerald-50'
                              }`}
                            >
                              <ThumbsUp className="w-3.5 h-3.5" />
                            </button>

                            <div className="relative">
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenDislikeId((prev) => (prev === job.id ? null : job.id))
                                }
                                aria-label={`Thumbs down ${job.title} at ${job.company}`}
                                title="Hide role and train agent"
                                className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                                  openDislikeId === job.id
                                    ? 'text-red-700 bg-red-50'
                                    : 'text-zinc-400 hover:text-red-700 hover:bg-red-50'
                                }`}
                              >
                                <ThumbsDown className="w-3.5 h-3.5" />
                              </button>

                              {openDislikeId === job.id && (
                                <DislikeReasonPopover
                                  onSelect={(reason) => {
                                    setOpenDislikeId(null);
                                    onThumbsDown(job.id, reason);
                                  }}
                                  onClose={() => setOpenDislikeId(null)}
                                />
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                setOpenDislikeId(null);
                                setConfirmDeleteId(job.id);
                              }}
                              aria-label={`Delete ${job.title} at ${job.company}`}
                              title="Delete role"
                              className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
