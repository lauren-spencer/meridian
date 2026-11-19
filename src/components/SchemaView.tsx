import React, { useMemo, useState } from 'react';
import { Check, Copy, Database, Download, Lock } from 'lucide-react';
import firebaseBlueprint from '../../firebase-blueprint.json';
import { WEEK1_POSTGRES_SCHEMA } from '../data/initialData';
import type { JobRecord } from '../types/job';

interface SchemaViewProps {
  isSignedIn: boolean;
  jobs: JobRecord[];
  counts: {
    jobs: number;
    sources: number;
    resumes: number;
    rules: number;
    events: number;
    feedback: number;
    imports: number;
  };
}

interface FirestoreCollectionMeta {
  path: string;
  entity: string;
  keyFields: string;
  purpose: string;
  countKey?: keyof SchemaViewProps['counts'] | 'profile';
}

const FIRESTORE_COLLECTIONS: FirestoreCollectionMeta[] = [
  {
    path: '/users/{userId}',
    entity: 'UserProfile',
    keyFields: 'roleTypes, locations, keywords, gmailSenders, slackChannels, autoScheduleMinutes, careerExperiences',
    purpose: 'Private user profile, intake criteria, update cadence, channel lists, and extended off-resume career context.',
    countKey: 'profile',
  },
  {
    path: '/users/{userId}/jobs/{jobId}',
    entity: 'Job',
    keyFields: 'title, company, stage, matchScore, fullDescription, networkingContacts[], skills[], notes',
    purpose: 'Normalized job pipeline powering Table, Kanban, Calendar, and Networking tabs (including contact status, follow-up dates, and sentiment).',
    countKey: 'jobs',
  },
  {
    path: '/users/{userId}/sources/{sourceId}',
    entity: 'JobSource',
    keyFields: 'name, url, atsType, cadenceHours, enabled, lastCheckedAt, totalFound',
    purpose: 'Configured ATS feeds (Greenhouse, Lever, Ashby), RSS feeds, and scan run metrics.',
    countKey: 'sources',
  },
  {
    path: '/users/{userId}/resumes/{resumeId}',
    entity: 'RoleResume',
    keyFields: 'roleType, fileName, rawText, uploadedAt',
    purpose: 'Uploaded base resumes mapped per target role track (e.g., PM, PMM, Strategy) for 1-page .docx tailoring.',
    countKey: 'resumes',
  },
  {
    path: '/users/{userId}/rules/{ruleId}',
    entity: 'LearnedRule',
    keyFields: 'text, origin, active',
    purpose: 'Manual and AI-synthesized filtering rules used when scoring incoming roles.',
    countKey: 'rules',
  },
  {
    path: '/users/{userId}/events/{eventId}',
    entity: 'JobEvent',
    keyFields: 'jobId, date, label, type',
    purpose: 'Scheduled interviews and follow-up reminders rendered on the Search Calendar.',
    countKey: 'events',
  },
  {
    path: '/users/{userId}/feedback/{feedbackId}',
    entity: 'FeedbackEntry',
    keyFields: 'jobId, vote, reason, createdDateLabel',
    purpose: 'Thumbs-up and thumbs-down triage log driving few-shot scoring and rule suggestions.',
    countKey: 'feedback',
  },
  {
    path: '/users/{userId}/imports/{importId}',
    entity: 'ImportBatch',
    keyFields: 'fileName, totalRows, importedCount, skippedDuplicates',
    purpose: 'Audit trail for uploaded CSV/JSON role imports and mapped records.',
    countKey: 'imports',
  },
];

function escapeCsvCell(value: string | number | null | undefined): string {
  const str = value == null ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildJobsCsv(jobs: JobRecord[]): string {
  const headers = [
    'id',
    'title',
    'company',
    'stage',
    'match_score',
    'salary',
    'location',
    'location_type',
    'source_name',
    'ats_type',
    'discovered_at',
    'deadline_at',
    'job_url',
    'skills',
    'networking_contacts',
    'notes',
  ];

  const rows = jobs.map((j) => {
    const contactSummary = (j.networkingContacts ?? [])
      .map(
        (c) =>
          `${c.name} (${c.role} | ${c.status}${c.sentiment ? ` | ${c.sentiment}` : ''}${
            c.followUpDate ? ` | Follow-up ${c.followUpDate}` : ''
          })`
      )
      .join('; ');

    return [
      j.id,
      j.title,
      j.company,
      j.stage,
      j.matchScore,
      j.salaryLabel,
      j.location,
      j.locationType,
      j.sourceName,
      j.atsType,
      j.discoveredAt,
      j.deadlineAt ?? '',
      j.jobUrl,
      j.skills.join('; '),
      contactSummary,
      j.notes,
    ]
      .map(escapeCsvCell)
      .join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

export function SchemaView({ isSignedIn, jobs, counts }: SchemaViewProps) {
  const [schemaTab, setSchemaTab] = useState<'firestore' | 'postgres'>('firestore');
  const [copied, setCopied] = useState(false);

  const blueprintJson = useMemo(
    () => JSON.stringify(firebaseBlueprint, null, 2),
    []
  );

  const activeSnippet =
    schemaTab === 'firestore' ? blueprintJson : WEEK1_POSTGRES_SCHEMA;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeSnippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for sandboxed iframes
      try {
        const el = document.createElement('textarea');
        el.value = activeSnippet;
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      } catch {
        // Ignore
      }
    }
  };

  const handleExportCsv = () => {
    const csv = buildJobsCsv(jobs);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `meridian-pipeline-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getCountLabel = (key?: FirestoreCollectionMeta['countKey']): string => {
    if (!key) return '—';
    if (key === 'profile') return '1';
    return String(counts[key]);
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
            <Database className="w-3.5 h-3.5 text-blue-600" />
            <span className="font-medium text-zinc-700">
              Firebase Firestore (NoSQL Document Store)
            </span>
            <span aria-hidden="true">·</span>
            <span>{isSignedIn ? 'Cloud sync active' : 'Local browser cache until sign-in'}</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950">
            Database Schema
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Live Firestore collection hierarchy scoped per authenticated user with owner-only security rules. No relational SQL server is provisioned.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto shrink-0">
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md transition-colors whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Pipeline CSV ({jobs.length})</span>
          </button>

          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-md transition-colors whitespace-nowrap cursor-pointer"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            <span>
              {copied
                ? 'Copied'
                : schemaTab === 'firestore'
                ? 'Copy Firestore JSON'
                : 'Copy SQL Reference'}
            </span>
          </button>
        </div>
      </div>

      {/* Security & Architecture Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3.5 bg-white border border-zinc-200 rounded-lg">
          <div className="text-[11px] font-medium text-zinc-500">Database Engine</div>
          <div className="mt-1 text-sm font-semibold text-zinc-950">
            Cloud Firestore
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">
            Document &amp; subcollection model backed by Firebase Auth.
          </p>
        </div>
        <div className="p-3.5 bg-white border border-zinc-200 rounded-lg">
          <div className="text-[11px] font-medium text-zinc-500 flex items-center gap-1">
            <Lock className="w-3 h-3 text-emerald-600" />
            <span>Access Control</span>
          </div>
          <div className="mt-1 text-sm font-semibold text-zinc-950">
            Owner-Only (Verified UID)
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">
            Default-deny rules isolate every user&apos;s jobs, contacts, and resumes.
          </p>
        </div>
        <div className="p-3.5 bg-white border border-zinc-200 rounded-lg">
          <div className="text-[11px] font-medium text-zinc-500">
            Tracked Collections
          </div>
          <div className="mt-1 font-mono text-sm font-semibold text-zinc-950 tabular-nums">
            {FIRESTORE_COLLECTIONS.length} paths · {counts.jobs} jobs · {counts.resumes} resumes
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">
            CSV/JSON uploads map directly into your Firestore jobs collection.
          </p>
        </div>
      </div>

      {/* Live Firestore Collections Table */}
      <div className="bg-white border border-zinc-200 rounded-lg overflow-x-auto">
        <table className="w-full border-collapse text-left min-w-[640px]">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50/70 text-[11px] font-medium text-zinc-500">
              <th className="py-2.5 pl-4 pr-3">Firestore Path</th>
              <th className="py-2.5 px-3">Entity</th>
              <th className="py-2.5 px-3 text-right">Records</th>
              <th className="py-2.5 pl-3 pr-4">Responsibility &amp; Key Fields</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 text-xs">
            {FIRESTORE_COLLECTIONS.map((col) => (
              <tr key={col.path} className="align-top">
                <td className="py-3 pl-4 pr-3 font-mono font-medium text-zinc-900 whitespace-nowrap">
                  {col.path}
                </td>
                <td className="py-3 px-3 font-mono text-blue-700 whitespace-nowrap">
                  {col.entity}
                </td>
                <td className="py-3 px-3 font-mono text-zinc-700 text-right tabular-nums whitespace-nowrap">
                  {getCountLabel(col.countKey)}
                </td>
                <td className="py-3 pl-3 pr-4 space-y-1">
                  <div className="text-zinc-700">{col.purpose}</div>
                  <div className="text-[11px] font-mono text-zinc-400">
                    {col.keyFields}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Schema Blueprint Viewer */}
      <div className="bg-zinc-950 text-zinc-100 rounded-lg border border-zinc-800 overflow-hidden">
        <div className="px-4 py-2 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setSchemaTab('firestore');
                setCopied(false);
              }}
              className={`px-2.5 py-1 rounded font-mono text-xs transition-colors cursor-pointer ${
                schemaTab === 'firestore'
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              firebase-blueprint.json (Live)
            </button>
            <button
              type="button"
              onClick={() => {
                setSchemaTab('postgres');
                setCopied(false);
              }}
              className={`px-2.5 py-1 rounded font-mono text-xs transition-colors cursor-pointer ${
                schemaTab === 'postgres'
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              optional_postgres_reference.sql
            </button>
          </div>
          <span className="font-mono text-[11px] text-zinc-400">
            {schemaTab === 'firestore'
              ? 'Active Firestore Schema'
              : 'Reference DDL only (not connected)'}
          </span>
        </div>
        <pre className="p-4 text-xs font-mono leading-relaxed overflow-x-auto max-h-[460px] overflow-y-auto text-zinc-200">
          <code>{activeSnippet}</code>
        </pre>
      </div>
    </div>
  );
}
