import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { JobEvent, JobRecord } from '../types/job';

interface CalendarViewProps {
  jobs: JobRecord[];
  events: JobEvent[];
  onSelectJob: (job: JobRecord) => void;
  onAddEvent: (event: Omit<JobEvent, 'id'>) => void;
  onDeleteEvent: (eventId: string) => void;
}

type CalendarItemType = 'discovered' | 'deadline' | 'custom' | 'networking';

interface CalendarEntry {
  id: string;
  date: string; // YYYY-MM-DD
  kind: CalendarItemType;
  label: string;
  sublabel: string;
  job?: JobRecord;
  eventId?: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function toIsoDate(year: number, monthIndex: number, day: number): string {
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
}

export function CalendarView({
  jobs,
  events,
  onSelectJob,
  onAddEvent,
  onDeleteEvent,
}: CalendarViewProps) {
  // Default to November 2026 (aligned with current local date 2026-11-18)
  const [currentYear, setCurrentYear] = useState(2026);
  const [currentMonth, setCurrentMonth] = useState(10); // 0-indexed: 10 = Nov
  const [selectedDate, setSelectedDate] = useState('2026-11-18');

  const [showDiscovered, setShowDiscovered] = useState(true);
  const [showDeadlines, setShowDeadlines] = useState(true);
  const [showCustom, setShowCustom] = useState(true);
  const [showNetworking, setShowNetworking] = useState(true);

  // Add follow-up/interview form
  const activeJobs = useMemo(
    () => jobs.filter((j) => j.stage !== 'archived'),
    [jobs]
  );
  const [newEventJobId, setNewEventJobId] = useState(activeJobs[0]?.id ?? '');
  const [newEventType, setNewEventType] = useState<'interview' | 'followup'>('interview');
  const [newEventLabel, setNewEventLabel] = useState('');

  const entriesByDate = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    const push = (entry: CalendarEntry) => {
      const existing = map.get(entry.date) ?? [];
      existing.push(entry);
      map.set(entry.date, existing);
    };

    const jobById = new Map(jobs.map((j) => [j.id, j]));

    if (showDiscovered) {
      for (const job of activeJobs) {
        push({
          id: `disc-${job.id}`,
          date: job.discoveredAt,
          kind: 'discovered',
          label: `${job.company} · ${job.title}`,
          sublabel: `Discovered (${job.matchScore}% match)`,
          job,
        });
      }
    }

    if (showDeadlines) {
      for (const job of activeJobs) {
        if (job.deadlineAt) {
          push({
            id: `dead-${job.id}`,
            date: job.deadlineAt,
            kind: 'deadline',
            label: `Deadline · ${job.company}`,
            sublabel: job.title,
            job,
          });
        }
      }
    }

    if (showCustom) {
      for (const evt of events) {
        const linkedJob = jobById.get(evt.jobId);
        push({
          id: `evt-${evt.id}`,
          date: evt.date,
          kind: 'custom',
          label: evt.label,
          sublabel: evt.type === 'interview' ? 'Interview' : 'Follow-up',
          job: linkedJob,
          eventId: evt.id,
        });
      }
    }

    if (showNetworking) {
      for (const job of activeJobs) {
        for (const contact of job.networkingContacts ?? []) {
          if (contact.followUpDate && /^\d{4}-\d{2}-\d{2}$/.test(contact.followUpDate)) {
            push({
              id: `net-${job.id}-${contact.id}`,
              date: contact.followUpDate,
              kind: 'networking',
              label: `${contact.name} (${job.company})`,
              sublabel: `Networking · ${contact.status} (${contact.channel})`,
              job,
            });
          }
        }
      }
    }

    return map;
  }, [activeJobs, jobs, events, showDiscovered, showDeadlines, showCustom, showNetworking]);

  const calendarCells = useMemo(() => {
    const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const cells: { iso: string | null; day: number | null }[] = [];

    for (let i = 0; i < firstDayOfMonth; i++) {
      cells.push({ iso: null, day: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ iso: toIsoDate(currentYear, currentMonth, d), day: d });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ iso: null, day: null });
    }
    return cells;
  }, [currentYear, currentMonth]);

  const monthHeading = new Date(currentYear, currentMonth, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const handleToday = () => {
    setCurrentYear(2026);
    setCurrentMonth(10);
    setSelectedDate('2026-11-18');
  };

  const selectedEntries = entriesByDate.get(selectedDate) ?? [];

  const handleCreateEvent = (e: React.FormEvent) => {
    e.preventDefault();
    const targetJobId = newEventJobId || activeJobs[0]?.id;
    const job = activeJobs.find((j) => j.id === targetJobId);
    if (!targetJobId || !job) return;
    const labelText =
      newEventLabel.trim() ||
      `${newEventType === 'interview' ? 'Interview' : 'Follow-up'} — ${job.company}`;

    onAddEvent({
      jobId: targetJobId,
      date: selectedDate,
      type: newEventType,
      label: labelText,
    });
    setNewEventLabel('');
  };

  const kindMeta: Record<
    CalendarItemType,
    { prefix: string; cellStyle: string; textStyle: string }
  > = {
    discovered: {
      prefix: 'Found',
      cellStyle: 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200',
      textStyle: 'text-zinc-600',
    },
    deadline: {
      prefix: 'Due',
      cellStyle: 'bg-amber-50 text-amber-800 hover:bg-amber-100',
      textStyle: 'text-amber-700',
    },
    custom: {
      prefix: 'Event',
      cellStyle: 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100',
      textStyle: 'text-emerald-700',
    },
    networking: {
      prefix: 'Net',
      cellStyle: 'bg-blue-50 text-blue-800 hover:bg-blue-100',
      textStyle: 'text-blue-700',
    },
  };

  return (
    <div className="space-y-5">
      {/* Header & Layer toggles */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950">
            Search Calendar
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Track discovered postings, extracted application deadlines, and your scheduled interviews or follow-ups.
          </p>
        </div>

        {/* Interactive calendar layer filter buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowDiscovered((v) => !v)}
            aria-pressed={showDiscovered}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
              showDiscovered
                ? 'bg-zinc-900 text-white border-zinc-900'
                : 'bg-white text-zinc-500 border-zinc-200 hover:text-zinc-900'
            }`}
          >
            Discovered Dates
          </button>
          <button
            type="button"
            onClick={() => setShowDeadlines((v) => !v)}
            aria-pressed={showDeadlines}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
              showDeadlines
                ? 'bg-amber-600 text-white border-amber-600'
                : 'bg-white text-zinc-500 border-zinc-200 hover:text-zinc-900'
            }`}
          >
            Application Deadlines
          </button>
          <button
            type="button"
            onClick={() => setShowCustom((v) => !v)}
            aria-pressed={showCustom}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
              showCustom
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-white text-zinc-500 border-zinc-200 hover:text-zinc-900'
            }`}
          >
            Interviews &amp; Follow-ups
          </button>
          <button
            type="button"
            onClick={() => setShowNetworking((v) => !v)}
            aria-pressed={showNetworking}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
              showNetworking
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-zinc-500 border-zinc-200 hover:text-zinc-900'
            }`}
          >
            Networking
          </button>
        </div>
      </div>

      {/* Main 2-column calendar + agenda layout */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Monthly Grid */}
        <div className="xl:col-span-8 bg-white border border-zinc-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-950">{monthHeading}</h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handlePrevMonth}
                aria-label="Previous month"
                className="p-1.5 text-zinc-600 hover:text-zinc-950 hover:bg-zinc-100 rounded-md cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleToday}
                className="px-2.5 py-1 text-xs font-medium text-zinc-700 hover:text-zinc-950 hover:bg-zinc-100 rounded-md cursor-pointer"
              >
                Today
              </button>
              <button
                type="button"
                onClick={handleNextMonth}
                aria-label="Next month"
                className="p-1.5 text-zinc-600 hover:text-zinc-950 hover:bg-zinc-100 rounded-md cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50/70">
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                className="py-2 px-2 text-center text-[11px] font-medium text-zinc-500"
              >
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 divide-x divide-y divide-zinc-100">
            {calendarCells.map((cell, idx) => {
              if (!cell.iso || !cell.day) {
                return <div key={`empty-${idx}`} className="min-h-[104px] bg-zinc-50/40" />;
              }

              const dayEntries = entriesByDate.get(cell.iso) ?? [];
              const isToday = cell.iso === '2026-11-18';
              const isSelected = cell.iso === selectedDate;

              return (
                <div
                  key={cell.iso}
                  onClick={() => setSelectedDate(cell.iso!)}
                  className={`min-h-[104px] p-1.5 transition-colors cursor-pointer ${
                    isSelected ? 'bg-blue-50/40' : 'hover:bg-zinc-50/70'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`text-xs font-mono tabular-nums px-1.5 py-0.5 rounded ${
                        isToday
                          ? 'bg-blue-600 text-white font-semibold'
                          : isSelected
                            ? 'text-blue-700 font-semibold'
                            : 'text-zinc-700'
                      }`}
                    >
                      {cell.day}
                    </span>
                    {dayEntries.length > 0 && (
                      <span className="text-[10px] font-mono text-zinc-400 tabular-nums">
                        {dayEntries.length}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1">
                    {dayEntries.slice(0, 3).map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedDate(cell.iso!);
                          if (entry.job) onSelectJob(entry.job);
                        }}
                        className={`w-full text-left px-1.5 py-0.5 rounded text-[11px] truncate block transition-colors cursor-pointer ${
                          kindMeta[entry.kind].cellStyle
                        }`}
                      >
                        <span className="font-medium mr-1">{kindMeta[entry.kind].prefix}:</span>
                        {entry.label}
                      </button>
                    ))}
                    {dayEntries.length > 3 && (
                      <div className="text-[10px] text-zinc-500 px-1 font-mono tabular-nums">
                        +{dayEntries.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected Day Agenda & Quick Scheduler */}
        <div className="xl:col-span-4 bg-white border border-zinc-200 rounded-lg divide-y divide-zinc-200">
          <div className="p-4">
            <div className="text-xs font-mono text-zinc-500 tabular-nums">
              {selectedDate}
            </div>
            <h2 className="mt-0.5 text-sm font-semibold text-zinc-950">
              Agenda for {new Date(`${selectedDate}T12:00:00`).toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
              })}
            </h2>
          </div>

          <div className="p-4 space-y-3 max-h-[340px] overflow-y-auto">
            {selectedEntries.length === 0 ? (
              <p className="text-xs text-zinc-500 py-4 text-center">
                No discovered roles, deadlines, or interviews on this date.
              </p>
            ) : (
              selectedEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start justify-between gap-2 pb-3 border-b border-zinc-100 last:border-b-0 last:pb-0"
                >
                  <button
                    type="button"
                    onClick={() => entry.job && onSelectJob(entry.job)}
                    className="text-left min-w-0 flex-1 cursor-pointer group"
                  >
                    <div
                      className={`text-[11px] font-medium ${kindMeta[entry.kind].textStyle}`}
                    >
                      {entry.sublabel}
                    </div>
                    <div className="mt-0.5 text-[13px] font-medium text-zinc-900 group-hover:text-blue-700 truncate">
                      {entry.label}
                    </div>
                  </button>

                  {entry.eventId && (
                    <button
                      type="button"
                      onClick={() => onDeleteEvent(entry.eventId!)}
                      aria-label={`Remove ${entry.label}`}
                      className="p-1 text-zinc-400 hover:text-red-600 rounded cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Schedule Interview / Follow-up form */}
          <form onSubmit={handleCreateEvent} className="p-4 space-y-3 bg-zinc-50/50">
            <h3 className="text-xs font-semibold text-zinc-900">
              Add Interview or Follow-up on {selectedDate}
            </h3>

            <div className="space-y-2">
              <select
                aria-label="Linked role"
                value={newEventJobId || activeJobs[0]?.id || ''}
                onChange={(e) => setNewEventJobId(e.target.value)}
                className="w-full h-9 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              >
                {activeJobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.company} — {job.title}
                  </option>
                ))}
              </select>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setNewEventType('interview')}
                  className={`py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                    newEventType === 'interview'
                      ? 'bg-zinc-900 text-white border-zinc-900'
                      : 'bg-white text-zinc-600 border-zinc-200 hover:text-zinc-900'
                  }`}
                >
                  Interview
                </button>
                <button
                  type="button"
                  onClick={() => setNewEventType('followup')}
                  className={`py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                    newEventType === 'followup'
                      ? 'bg-zinc-900 text-white border-zinc-900'
                      : 'bg-white text-zinc-600 border-zinc-200 hover:text-zinc-900'
                  }`}
                >
                  Follow-up
                </button>
              </div>

              <input
                type="text"
                value={newEventLabel}
                onChange={(e) => setNewEventLabel(e.target.value)}
                placeholder="e.g., Technical architecture screen"
                className="w-full h-9 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>

            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add to Calendar</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
