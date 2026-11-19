import React, { useState } from 'react';
import { GripVertical, ThumbsDown, ThumbsUp } from 'lucide-react';
import { DislikeReason, JobRecord, PipelineStage } from '../types/job';
import { DislikeReasonPopover } from './DislikeReasonPopover';

interface KanbanViewProps {
  jobs: JobRecord[];
  onSelectJob: (job: JobRecord) => void;
  onMoveStage: (jobId: string, nextStage: PipelineStage) => void;
  onThumbsUp: (jobId: string) => void;
  onThumbsDown: (jobId: string, reason?: DislikeReason) => void;
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
}: KanbanViewProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<PipelineStage | null>(null);
  const [openDislikeId, setOpenDislikeId] = useState<string | null>(null);

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
            .sort((a, b) => b.matchScore - a.matchScore);
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
                        <GripVertical
                          className="w-3.5 h-3.5 text-zinc-300 group-hover:text-zinc-500 shrink-0 cursor-grab active:cursor-grabbing"
                          aria-hidden="true"
                        />
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

                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-400">
                        <span>{job.locationType}</span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">{job.atsType}</span>
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
