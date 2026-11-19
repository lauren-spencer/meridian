import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  CopyCheck,
  ExternalLink,
  Layers,
  Loader2,
  MessageSquare,
  Users,
  X,
} from 'lucide-react';
import type { JobRecord, PipelineStage } from '../types/job';
import {
  DuplicateJobGroup,
  isPlaceholderOrEmptyJobUrl,
} from '../lib/jobDedupe';

interface DeduplicateModalProps {
  open: boolean;
  groups: DuplicateJobGroup[];
  onClose: () => void;
  onConfirmMerge: (
    selections: { primaryId: string; duplicateIds: string[] }[]
  ) => Promise<void>;
}

const STAGE_LABEL: Record<PipelineStage, string> = {
  inbox: 'Inbox',
  saved: 'Saved',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  archived: 'Archived',
};

const PRIORITY_LABEL: Record<string, string> = {
  asap: 'ASAP',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export function DeduplicateModal({
  open,
  groups,
  onClose,
  onConfirmMerge,
}: DeduplicateModalProps) {
  const [selectedGroups, setSelectedGroups] = useState<Record<string, boolean>>({});
  const [primaryByGroup, setPrimaryByGroup] = useState<Record<string, string>>({});
  const [isMerging, setIsMerging] = useState(false);

  useEffect(() => {
    if (!open) return;
    const nextSelected: Record<string, boolean> = {};
    const nextPrimary: Record<string, string> = {};
    for (const group of groups) {
      nextSelected[group.groupId] = true;
      nextPrimary[group.groupId] = group.recommendedPrimaryId;
    }
    setSelectedGroups(nextSelected);
    setPrimaryByGroup(nextPrimary);
  }, [open, groups]);

  const summary = useMemo(() => {
    let activeGroupCount = 0;
    let totalToRemove = 0;
    for (const group of groups) {
      if (selectedGroups[group.groupId]) {
        activeGroupCount += 1;
        totalToRemove += Math.max(0, group.jobs.length - 1);
      }
    }
    return { activeGroupCount, totalToRemove };
  }, [groups, selectedGroups]);

  if (!open) return null;

  const handleToggleAll = (checked: boolean) => {
    const next: Record<string, boolean> = {};
    for (const g of groups) {
      next[g.groupId] = checked;
    }
    setSelectedGroups(next);
  };

  const handleMergeClick = async () => {
    const selections: { primaryId: string; duplicateIds: string[] }[] = [];
    for (const group of groups) {
      if (!selectedGroups[group.groupId]) continue;
      const primaryId = primaryByGroup[group.groupId] || group.recommendedPrimaryId;
      const duplicateIds = group.jobs
        .filter((j) => j.id !== primaryId)
        .map((j) => j.id);
      if (duplicateIds.length > 0) {
        selections.push({ primaryId, duplicateIds });
      }
    }
    if (selections.length === 0) {
      onClose();
      return;
    }

    setIsMerging(true);
    try {
      await onConfirmMerge(selections);
      onClose();
    } finally {
      setIsMerging(false);
    }
  };

  const allSelected = groups.length > 0 && summary.activeGroupCount === groups.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Review and merge duplicate roles"
    >
      <div className="bg-white border border-zinc-200 rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-200 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600" />
              <h2 className="text-base font-semibold text-zinc-950">
                Review &amp; Merge Duplicate Roles
              </h2>
            </div>
            <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
              Notes, networking contacts, priorities, salaries, deadlines, descriptions, links, and calendar events from removed duplicates are merged into the kept role so nothing is lost.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isMerging}
            className="p-1.5 text-zinc-400 hover:text-zinc-700 rounded-md hover:bg-zinc-100 cursor-pointer"
            aria-label="Close duplicate review modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        {groups.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <CopyCheck className="w-8 h-8 text-emerald-600 mx-auto mb-3" />
            <p className="text-sm font-medium text-zinc-900">
              No duplicate roles found
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              All roles in your workspace appear to be unique.
            </p>
          </div>
        ) : (
          <>
            {/* Select all strip */}
            <div className="px-6 py-2.5 bg-zinc-50 border-b border-zinc-200 flex items-center justify-between text-xs">
              <label className="inline-flex items-center gap-2 text-zinc-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => handleToggleAll(e.target.checked)}
                  className="rounded border-zinc-300 text-blue-600 focus:ring-blue-600 cursor-pointer"
                />
                <span className="font-medium">
                  Select all {groups.length} duplicate {groups.length === 1 ? 'group' : 'groups'}
                </span>
              </label>
              <span className="text-zinc-500 font-mono">
                {summary.totalToRemove} redundant {summary.totalToRemove === 1 ? 'copy' : 'copies'} selected to merge
              </span>
            </div>

            {/* Duplicate groups list */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {groups.map((group) => {
                const isGroupChecked = Boolean(selectedGroups[group.groupId]);
                const chosenPrimaryId =
                  primaryByGroup[group.groupId] || group.recommendedPrimaryId;

                return (
                  <div
                    key={group.groupId}
                    className={`border rounded-lg transition-colors ${
                      isGroupChecked
                        ? 'border-zinc-200 bg-white'
                        : 'border-zinc-200/70 bg-zinc-50/50 opacity-70'
                    }`}
                  >
                    {/* Group header */}
                    <div className="px-4 py-2.5 bg-zinc-50/80 border-b border-zinc-100 flex items-center justify-between gap-3">
                      <label className="inline-flex items-center gap-2.5 min-w-0 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isGroupChecked}
                          onChange={(e) =>
                            setSelectedGroups((prev) => ({
                              ...prev,
                              [group.groupId]: e.target.checked,
                            }))
                          }
                          className="rounded border-zinc-300 text-blue-600 focus:ring-blue-600 cursor-pointer shrink-0"
                        />
                        <span className="text-xs font-semibold text-zinc-900 truncate">
                          {group.jobs[0].company}
                        </span>
                        <span className="text-zinc-300">·</span>
                        <span className="text-xs text-zinc-600 truncate">
                          {group.jobs.length} copies
                        </span>
                      </label>
                      <span className="text-[11px] font-medium text-zinc-500 whitespace-nowrap shrink-0">
                        {group.reason}
                      </span>
                    </div>

                    {/* Copies inside group */}
                    <div className="divide-y divide-zinc-100">
                      {group.jobs.map((job: JobRecord) => {
                        const isPrimary = job.id === chosenPrimaryId;
                        const hasRealUrl = !isPlaceholderOrEmptyJobUrl(job.jobUrl);
                        const contactCount = job.networkingContacts?.length ?? 0;
                        const hasNotes = Boolean(job.notes && job.notes.trim());

                        return (
                          <label
                            key={job.id}
                            className={`px-4 py-3 flex items-start gap-3 cursor-pointer transition-colors ${
                              isPrimary && isGroupChecked
                                ? 'bg-blue-50/35'
                                : 'hover:bg-zinc-50/70'
                            }`}
                          >
                            <input
                              type="radio"
                              name={`primary-${group.groupId}`}
                              checked={isPrimary}
                              disabled={!isGroupChecked}
                              onChange={() =>
                                setPrimaryByGroup((prev) => ({
                                  ...prev,
                                  [group.groupId]: job.id,
                                }))
                              }
                              className="mt-1 text-blue-600 focus:ring-blue-600 cursor-pointer shrink-0"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs font-medium text-zinc-950 truncate">
                                  {job.title}
                                </span>
                                <span
                                  className={`text-[11px] font-medium ${
                                    !isGroupChecked
                                      ? 'text-zinc-400'
                                      : isPrimary
                                      ? 'text-blue-700'
                                      : 'text-rose-600'
                                  }`}
                                >
                                  {!isGroupChecked
                                    ? 'Skipped'
                                    : isPrimary
                                    ? 'Keep (Primary)'
                                    : 'Merge & Remove'}
                                </span>
                              </div>

                              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-zinc-500">
                                <span className="font-medium text-zinc-700">
                                  {STAGE_LABEL[job.stage]}
                                </span>
                                <span>·</span>
                                <span>{job.sourceName}</span>
                                <span>·</span>
                                <span className="font-mono">{job.discoveredAt}</span>
                                <span>·</span>
                                <span className="font-mono">{job.matchScore}% match</span>
                                {job.priority && (
                                  <>
                                    <span>·</span>
                                    <span className="font-medium text-zinc-700">
                                      Priority: {PRIORITY_LABEL[job.priority] ?? job.priority}
                                    </span>
                                  </>
                                )}
                                {job.salaryLabel &&
                                  job.salaryLabel.toLowerCase() !== 'not listed' && (
                                    <>
                                      <span>·</span>
                                      <span className="font-mono text-zinc-700">
                                        {job.salaryLabel}
                                      </span>
                                    </>
                                  )}
                                {job.deadlineAt && (
                                  <>
                                    <span>·</span>
                                    <span>Due {job.deadlineAt}</span>
                                  </>
                                )}
                              </div>

                              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
                                {hasRealUrl && (
                                  <a
                                    href={job.jobUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                    <span>Posting URL</span>
                                  </a>
                                )}
                                {hasNotes && (
                                  <span className="inline-flex items-center gap-1 text-zinc-600">
                                    <MessageSquare className="w-3 h-3" />
                                    <span>Has notes</span>
                                  </span>
                                )}
                                {contactCount > 0 && (
                                  <span className="inline-flex items-center gap-1 text-zinc-600">
                                    <Users className="w-3 h-3" />
                                    <span>
                                      {contactCount} {contactCount === 1 ? 'contact' : 'contacts'}
                                    </span>
                                  </span>
                                )}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-zinc-200 bg-zinc-50/70 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isMerging}
            className="px-3.5 py-2 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>

          {groups.length > 0 && (
            <button
              type="button"
              onClick={() => void handleMergeClick()}
              disabled={isMerging || summary.totalToRemove === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 rounded-md cursor-pointer disabled:cursor-not-allowed transition-colors"
            >
              {isMerging ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Merging &amp; cleaning up...</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>
                    Merge &amp; Remove {summary.totalToRemove}{' '}
                    {summary.totalToRemove === 1 ? 'Duplicate' : 'Duplicates'}
                  </span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
