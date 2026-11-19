import React, { useState } from 'react';
import { GripVertical, ThumbsDown, ThumbsUp, Trash2, X } from 'lucide-react';
import { DislikeReason, JobPriority, JobRecord, PipelineStage } from '../types/job';
import { DislikeReasonPopover } from './DislikeReasonPopover';

const PRIORITY_RANK: Record<JobPriority, number> = {
  asap: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function prioritySelectClass(priority?: JobPriority): string {
  switch (priority) {
    case 'asap':
      return 'text-rose-800 font-semibold bg-rose-100/80 border-rose-300';
    case 'high':
      return 'text-red-700 font-semibold bg-red-50/70 border-red-200';
    case 'medium':
      return 'text-amber-700 font-medium bg-amber-50/70 border-amber-200';
    case 'low':
      return 'text-blue-700 font-medium bg-blue-50/60 border-blue-200';
    default:
      return 'text-zinc-400 bg-white border-zinc-200 hover:border-zinc-300 hover:text-zinc-600';
  }
}

interface KanbanViewProps {
  jobs: JobRecord[];
  onSelectJob: (job: JobRecord) => void;
  onMoveStage: (jobId: string, nextStage: PipelineStage) => void;
  onThumbsUp: (jobId: string) => void;
  onThumbsDown: (jobId: string, reason?: DislikeReason) => void;
  onDeleteJob: (jobId: string) => void;
  onChangePriority: (jobId: string, priority: JobPriority | null) => void;
}

const COLUMNS: {
  id: PipelineStage;
  title: string;
  subtitle: string;
}[] = [
  { id: 'inbox', title: 'Inbox', subtitle: 'Needs triage' },
  { id: 'saved', title: 'Saved', subtitle: 'Ready to apply' },
  { id: 'applied', title: 'Applied', subtitle: 'Awaiting reply' },
  { id: 'interviewing', title: 'Interviewing', subtitle: 'Active loops' },
  { id: 'offer', title: 'Offer', subtitle: 'Final stage' },
];

export function KanbanView({
  jobs,
  onSelectJob,
  onMoveStage,
  onThumbsUp,
  onThumbsDown,
  onDeleteJob,
  onChangePriority,
}: KanbanViewProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<PipelineStage | null>(null);
  const [openDislikeId, setOpenDislikeId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, jobId: string) => {
    setDraggingId(jobId);
    e.dataTransfer.setData('text/plain', jobId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, stage: PipelineStage) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverStage !== stage) {
      setDragOverStage(stage);
    }
  };

  const handleDrop = (e: React.DragEvent, stage: PipelineStage) => {
    e.preventDefault();
    const jobId = e.dataTransfer.getData('text/plain') || draggingId;
    if (jobId) {
      onMoveStage(jobId, stage);
    }
    setDraggingId(null);
    setDragOverStage(null);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOverStage(null);
  };

  const archivedCount = jobs.filter((j) => j.stage === 'archived').length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950">
            Pipeline Board
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Drag roles across stages as you triage and apply. Moving a role out of Inbox automatically clears its New flag.
          </p>
        </div>
        <div className="text-xs text-zinc-500 tabular-nums shrink-0">
          <span className="font-mono font-medium text-zinc-800">{archivedCount}</span> archived roles hidden from board
        </div>
      </div>

      {/* Horizontal 5-column Kanban board */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 items-start">
        {COLUMNS.map((column) => {
          const columnJobs = jobs
            .filter((j) => j.stage === column.id)
            .sort((a, b) => {
              const rankA = a.priority ? PRIORITY_RANK[a.priority] : 0;
              const rankB = b.priority ? PRIORITY_RANK[b.priority] : 0;
              if (rankA !== rankB) return rankB - rankA;
              return b.matchScore - a.matchScore;
            });
          const isDropTarget = dragOverStage === column.id;

          return (
            <section
              key={column.id}
              aria-label={`${column.title} stage`}
              onDragOver={(e) => handleDragOver(e, column.id)}
              onDragLeave={() => {
                if (dragOverStage === column.id) setDragOverStage(null);
              }}
              onDrop={(e) => handleDrop(e, column.id)}
              className={`rounded-lg border transition-colors min-h-[420px] flex flex-col ${
                isDropTarget
                  ? 'bg-blue-50/50 border-blue-400'
                  : 'bg-zinc-100/60 border-zinc-200/80'
              }`}
            >
              {/* Column header */}
              <div className="px-3.5 py-3 border-b border-zinc-200/80 flex items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-[13px] font-semibold text-zinc-900 truncate">
                    {column.title}
                  </h2>
                  <p className="text-[11px] text-zinc-500">{column.subtitle}</p>
                </div>
                <span className="font-mono text-xs font-medium text-zinc-500 tabular-nums shrink-0">
                  {columnJobs.length}
                </span>
              </div>

              {/* Cards list */}
              <div className="p-2.5 space-y-2.5 flex-1">
                {columnJobs.length === 0 ? (
                  <div className="py-8 px-3 text-center text-xs text-zinc-400 border border-dashed border-zinc-200 rounded-md">
                    Drop a role here
                  </div>
                ) : (
                  columnJobs.map((job) => (
                    <article
                      key={job.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, job.id)}
                      onDragEnd={handleDragEnd}
                      onClick={() => onSelectJob(job)}
                      className={`group relative bg-white border rounded-md p-3 cursor-pointer transition-all ${
                        draggingId === job.id
                          ? 'opacity-40 border-blue-400'
                          : job.isNew
                            ? 'border-blue-200 hover:border-blue-400'
                            : 'border-zinc-200 hover:border-zinc-300'
                      }`}
                    >
                      {/* Top row: quiet kicker + drag affordance */}
                      <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500">
                        <div className="flex items-center gap-1.5 min-w-0 truncate">
                          {job.isNew && (
                            <>
                              <span className="font-semibold text-blue-600">New</span>
                              <span aria-hidden="true">·</span>
                            </>
                          )}
                          <span className="font-medium text-zinc-700 truncate">{job.company}</span>
                        </div>
                        <div
                          className="flex items-center gap-1 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {confirmDeleteId === job.id ? (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setConfirmDeleteId(null);
                                  onDeleteJob(job.id);
                                }}
                                className="px-1.5 py-0.5 text-[10.5px] font-medium text-white bg-red-600 hover:bg-red-700 rounded cursor-pointer"
                              >
                                Delete
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                aria-label="Cancel delete"
                                className="p-0.5 text-zinc-400 hover:text-zinc-800 rounded cursor-pointer"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(job.id)}
                                aria-label={`Delete ${job.title}`}
                                title="Delete role"
                                className="p-0.5 text-zinc-300 opacity-0 group-hover:opacity-100 hover:text-red-600 rounded transition-opacity cursor-pointer"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                              <GripVertical
                                className="w-3.5 h-3.5 text-zinc-300 group-hover:text-zinc-500 cursor-grab active:cursor-grabbing"
                                aria-hidden="true"
                              />
                            </>
                          )}
                        </div>
                      </div>

                      {/* Primary title */}
                      <h3 className="mt-1 text-[13px] font-medium text-zinc-950 leading-snug group-hover:text-blue-700 transition-colors">
                        {job.title}
                      </h3>

                      {/* Unboxed metadata row */}
                      <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px] text-zinc-500 tabular-nums">
                        <span
                          className={`font-mono font-medium ${
                            job.matchScore >= 90
                              ? 'text-emerald-700'
                              : job.matchScore >= 75
                                ? 'text-zinc-800'
                                : 'text-amber-700'
                          }`}
                        >
                          {job.matchScore}% match
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-zinc-700">{job.salaryLabel}</span>
                      </div>

                      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-zinc-400">
                        <div className="flex items-center gap-1.5 min-w-0 truncate">
                          <span>{job.locationType}</span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{job.atsType}</span>
                        </div>
                        <select
                          aria-label={`Priority for ${job.title}`}
                          value={job.priority ?? ''}
                          onClick={(e) => e.stopPropagation()}
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
                          className={`h-6 px-1.5 text-[10.5px] rounded border shrink-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-600/20 ${prioritySelectClass(
                            job.priority
                          )}`}
                        >
                          <option value="">Priority</option>
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="asap">ASAP</option>
                        </select>
                      </div>

                      {/* Inline triage actions for Inbox cards */}
                      {column.id === 'inbox' && (
                        <div
                          className="mt-2.5 pt-2 border-t border-zinc-100 flex items-center justify-between relative"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="text-[11px] text-zinc-400 font-mono tabular-nums">
                            {job.discoveredTime}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onThumbsUp(job.id)}
                              aria-label={`Save ${job.title}`}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 rounded transition-colors cursor-pointer"
                            >
                              <ThumbsUp className="w-3 h-3" />
                              <span>Save</span>
                            </button>
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenDislikeId((prev) => (prev === job.id ? null : job.id))
                                }
                                aria-label={`Archive ${job.title}`}
                                className="p-1 text-zinc-400 hover:text-red-700 hover:bg-red-50 rounded transition-colors cursor-pointer"
                              >
                                <ThumbsDown className="w-3 h-3" />
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
                          </div>
                        </div>
                      )}
                    </article>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
