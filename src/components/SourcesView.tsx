import React, { useState } from 'react';
import {
  AlertCircle,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  Hash,
  LogOut,
  Mail,
  MessageCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { detectAtsType, VERIFIED_LIVE_PRESETS } from '../data/initialData';
import {
  buildGmailQueryFromSenders,
  GMAIL_SENDER_PRESETS,
  normalizeSenderInput,
} from '../lib/intakeHelpers';
import type {
  AgentRunReport,
  ImportBatchRecord,
  JobSource,
  TargetCompany,
} from '../types/job';
import { GoogleSignInButton } from './GoogleSignInButton';

interface SourcesViewProps {
  sources: JobSource[];
  runHistory: AgentRunReport[];
  importHistory: ImportBatchRecord[];
  isAgentRunning: boolean;
  runningSourceId: string | null;
  autoScheduleEnabled: boolean;
  autoScheduleMinutes: number;
  nextScheduledRunAt: string | null;
  // Gmail dynamic sender props
  gmailUserEmail: string | null;
  gmailConnected: boolean;
  gmailError: string | null;
  isGmailSigningIn: boolean;
  isGmailScanning: boolean;
  gmailSenders: string[];
  gmailQueryOverride: string;
  gmailLastScanLabel: string | null;
  onChangeGmailSenders: (senders: string[]) => void;
  onChangeGmailQueryOverride: (q: string) => void;
  onConnectGmail: () => void;
  onDisconnectGmail: () => void;
  onScanGmail: () => void;
  // Slack 3P OAuth props
  slackConnected: boolean;
  slackTeamName: string | null;
  slackConfigured: boolean;
  slackHasClientId: boolean;
  slackHasClientSecret: boolean;
  slackRedirectUri: string | null;
  slackDevRedirectUri: string | null;
  slackSharedRedirectUri: string | null;
  slackError: string | null;
  slackChannels: string[];
  isSlackScanning: boolean;
  onChangeSlackChannels: (channels: string[]) => void;
  onConnectSlack: () => void;
  onDisconnectSlack: () => void;
  onScanSlack: () => void;
  // WhatsApp props
  whatsappGroups: string[];
  isWhatsAppScanning: boolean;
  onChangeWhatsAppGroups: (groups: string[]) => void;
  onScanWhatsApp: (rawText: string, groupName: string) => Promise<void>;
  // Import existing roles modal
  onOpenImportModal: () => void;
  // Target Companies watchlist
  targetCompanies: TargetCompany[];
  untitledJobCount: number;
  onAddTargetCompany: (name: string, careersUrl?: string, notes?: string) => void;
  onToggleTargetCompany: (companyId: string) => void;
  onDeleteTargetCompany: (companyId: string) => void;
  onOpenTargetCompaniesImport: () => void;
  onMoveUntitledToTargetCompanies: () => void;
  // Scheduler & ATS source handlers
  onToggleAutoSchedule: () => void;
  onChangeAutoScheduleMinutes: (minutes: number) => void;
  onAddSource: (name: string, url: string, cadenceHours: number) => void;
  onToggleSource: (sourceId: string) => void;
  onUpdateCadence: (sourceId: string, cadenceHours: number) => void;
  onDeleteSource: (sourceId: string) => void;
  onRunSingleSource: (sourceId: string) => void;
}

function formatNextRun(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

export function SourcesView({
  sources,
  runHistory,
  importHistory,
  isAgentRunning,
  runningSourceId,
  autoScheduleEnabled,
  autoScheduleMinutes,
  nextScheduledRunAt,
  gmailUserEmail,
  gmailConnected,
  gmailError,
  isGmailSigningIn,
  isGmailScanning,
  gmailSenders,
  gmailQueryOverride,
  gmailLastScanLabel,
  onChangeGmailSenders,
  onChangeGmailQueryOverride,
  onConnectGmail,
  onDisconnectGmail,
  onScanGmail,
  slackConnected,
  slackTeamName,
  slackConfigured,
  slackHasClientId,
  slackHasClientSecret,
  slackRedirectUri,
  slackDevRedirectUri,
  slackSharedRedirectUri,
  slackError,
  slackChannels,
  isSlackScanning,
  onChangeSlackChannels,
  onConnectSlack,
  onDisconnectSlack,
  onScanSlack,
  whatsappGroups,
  isWhatsAppScanning,
  onChangeWhatsAppGroups,
  onScanWhatsApp,
  onOpenImportModal,
  targetCompanies,
  untitledJobCount,
  onAddTargetCompany,
  onToggleTargetCompany,
  onDeleteTargetCompany,
  onOpenTargetCompaniesImport,
  onMoveUntitledToTargetCompanies,
  onToggleAutoSchedule,
  onChangeAutoScheduleMinutes,
  onAddSource,
  onToggleSource,
  onUpdateCadence,
  onDeleteSource,
  onRunSingleSource,
}: SourcesViewProps) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [cadenceHours, setCadenceHours] = useState(4);

  // Target Company manual add form
  const [tcName, setTcName] = useState('');
  const [tcUrl, setTcUrl] = useState('');
  const [tcNotes, setTcNotes] = useState('');

  // Gmail sender management
  const [senderInput, setSenderInput] = useState('');
  const [showRawQuery, setShowRawQuery] = useState(false);

  // Slack management
  const [slackChannelInput, setSlackChannelInput] = useState('');
  const [showSlackSetup, setShowSlackSetup] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const copyText = (val: string) => {
    void navigator.clipboard?.writeText(val);
    setCopiedUrl(val);
    window.setTimeout(() => setCopiedUrl(null), 1800);
  };

  // WhatsApp management
  const [waGroupInput, setWaGroupInput] = useState('');
  const [waPasteOpen, setWaPasteOpen] = useState(false);
  const [waPasteText, setWaPasteText] = useState('');
  const [waPasteGroup, setWaPasteGroup] = useState(whatsappGroups[0] || 'WhatsApp Group');
  const [showWaWebhook, setShowWaWebhook] = useState(false);

  const detectedAts = url.trim() ? detectAtsType(url.trim()) : null;
  const existingUrls = new Set(sources.map((s) => s.url.toLowerCase()));
  const availablePresets = VERIFIED_LIVE_PRESETS.filter(
    (p) => !existingUrls.has(p.url.toLowerCase())
  );

  const compiledGmailQuery =
    gmailQueryOverride.trim() || buildGmailQueryFromSenders(gmailSenders);

  const handleAddGmailSender = () => {
    const parts = senderInput
      .split(/[,;\n]/)
      .map(normalizeSenderInput)
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...gmailSenders];
    for (const p of parts) {
      if (!next.includes(p) && next.length < 30) {
        next.push(p);
      }
    }
    onChangeGmailSenders(next);
    setSenderInput('');
  };

  const handleTogglePresetSender = (sender: string) => {
    if (gmailSenders.includes(sender)) {
      onChangeGmailSenders(gmailSenders.filter((s) => s !== sender));
    } else if (gmailSenders.length < 30) {
      onChangeGmailSenders([...gmailSenders, sender]);
    }
  };

  const handleAddSlackChannel = () => {
    const clean = slackChannelInput.trim().replace(/^#/, '').toLowerCase();
    if (!clean) return;
    if (!slackChannels.includes(clean) && slackChannels.length < 20) {
      onChangeSlackChannels([...slackChannels, clean]);
    }
    setSlackChannelInput('');
  };

  const handleAddWhatsAppGroup = () => {
    const clean = waGroupInput.trim();
    if (!clean) return;
    if (!whatsappGroups.includes(clean) && whatsappGroups.length < 20) {
      onChangeWhatsAppGroups([...whatsappGroups, clean]);
    }
    setWaGroupInput('');
  };

  const handleWhatsAppFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      if (!text.trim()) return;
      const derivedGroup = file.name
        .replace(/\.txt$/i, '')
        .replace(/^_chat/i, whatsappGroups[0] || 'WhatsApp Group');
      void onScanWhatsApp(text, derivedGroup);
    };
    reader.readAsText(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUrl = url.trim();
    if (!cleanUrl) return;
    const derivedName =
      name.trim() ||
      cleanUrl
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .split('/')[0];
    onAddSource(derivedName, cleanUrl, cadenceHours);
    setName('');
    setUrl('');
    setCadenceHours(4);
  };

  const handleAddTargetCompanySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = tcName.trim();
    if (!cleanName) return;
    onAddTargetCompany(cleanName, tcUrl.trim() || undefined, tcNotes.trim() || undefined);
    setTcName('');
    setTcUrl('');
    setTcNotes('');
  };

  const activeCount = sources.filter((s) => s.enabled).length;
  const activeTargetCompaniesCount = targetCompanies.filter((c) => c.enabled).length;
  const nextRunFormatted = formatNextRun(nextScheduledRunAt);
  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/whatsapp/webhook`
      : '/api/whatsapp/webhook';

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950">
            Sources, Channels &amp; Agent Runner
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Pull jobs from your chosen Gmail alert senders, Slack channels, WhatsApp groups, structured ATS feeds, or uploaded CSV/JSON trackers.
          </p>
        </div>
        <div className="text-xs text-zinc-500 tabular-nums shrink-0">
          <strong className="font-mono font-semibold text-zinc-900">{activeCount}</strong> of{' '}
          <strong className="font-mono font-semibold text-zinc-900">{sources.length}</strong> web sources active
        </div>
      </div>

      {/* 1. Dynamic Gmail Job Alert Senders Card */}
      <section className="bg-white border border-zinc-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-blue-600 shrink-0" />
              <h2 className="text-sm font-semibold text-zinc-950">
                Gmail Job Alerts
              </h2>
              <span className="text-[11px] font-medium text-blue-700">
                Recommended
              </span>
            </div>
            <p className="text-xs text-zinc-500 max-w-2xl leading-relaxed">
              Read-only scan of your inbox for job update emails from any sender address or domain you configure below. Add or remove addresses at any time.
            </p>
            {gmailConnected && gmailUserEmail && (
              <div className="text-xs text-zinc-500 flex flex-wrap items-center gap-x-2 gap-y-0.5 pt-0.5">
                <span className="text-emerald-700 font-medium">Connected as {gmailUserEmail}</span>
                {gmailLastScanLabel && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">Last scan: {gmailLastScanLabel}</span>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {gmailConnected ? (
              <>
                <button
                  type="button"
                  onClick={onScanGmail}
                  disabled={isGmailScanning}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-md transition-colors whitespace-nowrap cursor-pointer disabled:cursor-wait"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isGmailScanning ? 'animate-spin' : ''}`} />
                  <span>{isGmailScanning ? 'Scanning Gmail...' : 'Scan Gmail Now'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowRawQuery((v) => !v)}
                  className="px-3 py-2 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md transition-colors whitespace-nowrap cursor-pointer"
                >
                  {showRawQuery ? 'Hide Raw Filter' : 'Advanced Filter'}
                </button>
                <button
                  type="button"
                  onClick={onDisconnectGmail}
                  title="Sign out of Gmail"
                  aria-label="Sign out of Gmail"
                  className="inline-flex items-center gap-1 px-2.5 py-2 text-xs text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded-md transition-colors cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign out</span>
                </button>
              </>
            ) : (
              <GoogleSignInButton
                onClick={onConnectGmail}
                disabled={isGmailSigningIn}
                label={isGmailSigningIn ? 'Signing in...' : 'Sign in with Google'}
              />
            )}
          </div>
        </div>

        {gmailError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2 text-xs text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{gmailError}</span>
          </div>
        )}

        {/* Editable Gmail Senders Section (Always accessible!) */}
        <div className="pt-3.5 border-t border-zinc-100 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-zinc-800">
              Job Alert Email Addresses &amp; Domains ({gmailSenders.length})
            </span>
            <span className="text-[11px] text-zinc-400">
              Toggle presets or add any sender address / newsletter domain
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {GMAIL_SENDER_PRESETS.map((preset) => {
              const active = gmailSenders.includes(preset.sender);
              return (
                <button
                  key={preset.sender}
                  type="button"
                  title={`${preset.description} (${preset.sender})`}
                  onClick={() => handleTogglePresetSender(preset.sender)}
                  className={`px-2.5 py-1 text-xs rounded-md border transition-colors cursor-pointer ${
                    active
                      ? 'bg-zinc-900 text-white border-zinc-900 font-medium'
                      : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={senderInput}
              onChange={(e) => setSenderInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddGmailSender();
                }
              }}
              placeholder="Add email address or domain (e.g., alerts@levels.fyi, careers@school.edu, newsletter@jobs.com)..."
              className="flex-1 h-9 px-3 text-xs font-mono bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
            <button
              type="button"
              onClick={handleAddGmailSender}
              className="inline-flex items-center gap-1 h-9 px-3 text-xs font-medium text-zinc-800 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Sender</span>
            </button>
          </div>

          {gmailSenders.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-xs font-mono text-zinc-700 pt-0.5">
              {gmailSenders.map((sender) => (
                <span key={sender} className="inline-flex items-center gap-1">
                  <span>{sender}</span>
                  <button
                    type="button"
                    onClick={() =>
                      onChangeGmailSenders(gmailSenders.filter((s) => s !== sender))
                    }
                    aria-label={`Remove sender ${sender}`}
                    className="text-zinc-400 hover:text-red-600 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {showRawQuery && (
            <div className="pt-2.5 border-t border-zinc-100 space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="gmail-query" className="text-xs font-medium text-zinc-600">
                  Compiled / Custom Gmail Search Query
                </label>
                {gmailQueryOverride.trim() && (
                  <button
                    type="button"
                    onClick={() => onChangeGmailQueryOverride('')}
                    className="text-[11px] font-medium text-blue-600 hover:text-blue-700 cursor-pointer"
                  >
                    Reset to sender list
                  </button>
                )}
              </div>
              <input
                id="gmail-query"
                type="text"
                value={compiledGmailQuery}
                onChange={(e) => onChangeGmailQueryOverride(e.target.value)}
                className="w-full h-9 px-3 text-xs font-mono bg-zinc-50 border border-zinc-200 rounded-md text-zinc-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>
          )}
        </div>
      </section>

      {/* 2. Slack & WhatsApp Integrations (2-column grid) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Slack Job Channels */}
        <section className="bg-white border border-zinc-200 rounded-lg p-5 flex flex-col justify-between gap-4">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Hash className="w-4 h-4 text-zinc-800 shrink-0" />
                  <h2 className="text-sm font-semibold text-zinc-950">
                    Slack Job Channels
                  </h2>
                </div>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  Connect Slack via OAuth to scan job boards, alumni networks, and referral channels.
                </p>
              </div>
              {slackConnected && (
                <button
                  type="button"
                  onClick={onDisconnectSlack}
                  className="text-xs text-zinc-400 hover:text-zinc-900 cursor-pointer shrink-0"
                >
                  Disconnect
                </button>
              )}
            </div>

            {slackConnected && (
              <div className="text-xs text-emerald-700 font-medium">
                Connected to {slackTeamName || 'Slack Workspace'}
              </div>
            )}

            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={slackChannelInput}
                  onChange={(e) => setSlackChannelInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddSlackChannel();
                    }
                  }}
                  placeholder="Add channel (e.g., jobs, hiring, referrals)..."
                  className="flex-1 h-8 px-2.5 text-xs font-mono bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400"
                />
                <button
                  type="button"
                  onClick={handleAddSlackChannel}
                  className="px-2.5 h-8 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md cursor-pointer"
                >
                  Add
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono text-zinc-600">
                {slackChannels.map((ch) => (
                  <span key={ch} className="inline-flex items-center gap-1">
                    <span>#{ch}</span>
                    <button
                      type="button"
                      onClick={() =>
                        onChangeSlackChannels(slackChannels.filter((x) => x !== ch))
                      }
                      aria-label={`Remove #${ch}`}
                      className="text-zinc-400 hover:text-red-600 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {slackError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2 text-xs text-red-700">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{slackError}</span>
              </div>
            )}

            {showSlackSetup && (
              <div className="p-3.5 bg-zinc-50 border border-zinc-200 rounded-md text-[11.5px] text-zinc-600 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-zinc-900">How to Set Up Slack</span>
                  {slackHasClientId && slackHasClientSecret && (
                    <span className="text-[11px] font-medium text-emerald-700">
                      Credentials configured
                    </span>
                  )}
                </div>
                <ol className="list-decimal pl-4 space-y-1.5 leading-relaxed">
                  <li>
                    Create an app at{' '}
                    <a
                      href="https://api.slack.com/apps"
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline font-medium"
                    >
                      api.slack.com/apps
                    </a>{' '}
                    (<strong>From scratch</strong>) for your workspace.
                  </li>
                  <li>
                    Under <strong>OAuth &amp; Permissions</strong>, add User Token Scopes{' '}
                    <code className="font-mono text-zinc-800">channels:read, channels:history, groups:read, groups:history</code> and register this Redirect URL:
                    <div className="mt-1.5 space-y-1.5">
                      {[
                        {
                          label: 'Redirect URL',
                          value:
                            slackDevRedirectUri ||
                            slackRedirectUri ||
                            `${window.location.origin}/api/slack/callback`,
                        },
                        ...(slackSharedRedirectUri &&
                        slackSharedRedirectUri !== slackDevRedirectUri
                          ? [{ label: 'Alternate URL', value: slackSharedRedirectUri }]
                          : []),
                      ].map((item) => (
                        <div key={item.value} className="space-y-0.5">
                          <div className="text-[10.5px] text-zinc-500">{item.label}</div>
                          <div className="flex items-center gap-1.5">
                            <div className="flex-1 font-mono text-[11px] bg-white border border-zinc-200 rounded px-2 py-1 text-zinc-800 break-all select-all">
                              {item.value}
                            </div>
                            <button
                              type="button"
                              onClick={() => copyText(item.value)}
                              title="Copy callback URL"
                              className="p-1.5 bg-white border border-zinc-200 hover:bg-zinc-100 rounded text-zinc-600 cursor-pointer shrink-0"
                            >
                              {copiedUrl === item.value ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </li>
                  <li>
                    Copy your <strong>Client ID</strong> and <strong>Client Secret</strong> from <strong>Basic Information</strong> into your environment variables (<code className="font-mono text-zinc-800">SLACK_CLIENT_ID</code> &amp; <code className="font-mono text-zinc-800">SLACK_CLIENT_SECRET</code>), redeploy, then click <strong>Connect Slack</strong>.
                  </li>
                </ol>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-zinc-100">
            {slackConnected ? (
              <button
                type="button"
                disabled={isSlackScanning}
                onClick={onScanSlack}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-400 rounded-md cursor-pointer disabled:cursor-wait"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSlackScanning ? 'animate-spin' : ''}`} />
                <span>{isSlackScanning ? 'Scanning Slack...' : 'Scan Slack Channels'}</span>
              </button>
            ) : slackConfigured ? (
              <button
                type="button"
                onClick={onConnectSlack}
                className="px-3 py-1.5 text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-md cursor-pointer"
              >
                Connect Slack
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowSlackSetup((v) => !v)}
                className="px-3 py-1.5 text-xs font-medium text-zinc-800 bg-white border border-zinc-300 hover:bg-zinc-50 rounded-md cursor-pointer"
              >
                {showSlackSetup ? 'Hide Setup Steps' : 'How to Set Up Slack'}
              </button>
            )}
            {(slackConnected || slackConfigured) && (
              <button
                type="button"
                onClick={() => setShowSlackSetup((v) => !v)}
                className="text-xs text-zinc-500 hover:text-zinc-900 cursor-pointer"
              >
                {showSlackSetup ? 'Hide steps' : 'Setup guide'}
              </button>
            )}
          </div>
        </section>

        {/* WhatsApp Job Groups */}
        <section className="bg-white border border-zinc-200 rounded-lg p-5 flex flex-col justify-between gap-4">
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                <h2 className="text-sm font-semibold text-zinc-950">
                  WhatsApp Recruiting Groups
                </h2>
              </div>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Upload a WhatsApp exported chat (.txt), paste forwarded job messages, or wire a live WhatsApp Cloud API webhook.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={waGroupInput}
                  onChange={(e) => setWaGroupInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddWhatsAppGroup();
                    }
                  }}
                  placeholder="Add group name (e.g., MBA Tech Recruiting, Referrals)..."
                  className="flex-1 h-8 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400"
                />
                <button
                  type="button"
                  onClick={handleAddWhatsAppGroup}
                  className="px-2.5 h-8 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md cursor-pointer"
                >
                  Add
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600">
                {whatsappGroups.map((g) => (
                  <span key={g} className="inline-flex items-center gap-1">
                    <span>{g}</span>
                    <button
                      type="button"
                      onClick={() =>
                        onChangeWhatsAppGroups(whatsappGroups.filter((x) => x !== g))
                      }
                      aria-label={`Remove ${g}`}
                      className="text-zinc-400 hover:text-red-600 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {waPasteOpen && (
              <div className="space-y-2 pt-2 border-t border-zinc-100">
                <input
                  type="text"
                  value={waPasteGroup}
                  onChange={(e) => setWaPasteGroup(e.target.value)}
                  placeholder="Group / chat label"
                  className="w-full h-8 px-2.5 text-xs bg-zinc-50 border border-zinc-200 rounded-md text-zinc-900"
                />
                <textarea
                  rows={4}
                  value={waPasteText}
                  onChange={(e) => setWaPasteText(e.target.value)}
                  placeholder="Paste WhatsApp job posts or exported chat messages here..."
                  className="w-full p-2.5 text-xs bg-zinc-50 border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setWaPasteOpen(false)}
                    className="px-2.5 py-1 text-xs text-zinc-500 hover:text-zinc-900 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isWhatsAppScanning || !waPasteText.trim()}
                    onClick={async () => {
                      await onScanWhatsApp(waPasteText, waPasteGroup || 'WhatsApp Group');
                      setWaPasteText('');
                      setWaPasteOpen(false);
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 rounded-md cursor-pointer"
                  >
                    {isWhatsAppScanning ? 'Extracting...' : 'Extract Roles'}
                  </button>
                </div>
              </div>
            )}

            {showWaWebhook && (
              <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-md text-[11.5px] text-zinc-600 space-y-1.5">
                <div className="font-semibold text-zinc-900">WhatsApp Cloud API Webhook</div>
                <p>
                  Forward job posts to your WhatsApp Business number by pointing Meta&apos;s webhook to:
                </p>
                <div className="font-mono text-[11px] bg-white border border-zinc-200 rounded px-2 py-1 text-zinc-800 break-all select-all">
                  {webhookUrl}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-zinc-100">
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-800 bg-white border border-zinc-300 hover:bg-zinc-50 rounded-md cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>{isWhatsAppScanning ? 'Scanning...' : 'Upload .txt Export'}</span>
              <input
                type="file"
                accept=".txt"
                disabled={isWhatsAppScanning}
                onChange={handleWhatsAppFileUpload}
                className="sr-only"
              />
            </label>
            <button
              type="button"
              onClick={() => setWaPasteOpen((v) => !v)}
              className="px-3 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md cursor-pointer"
            >
              Paste Messages
            </button>
            <button
              type="button"
              onClick={() => setShowWaWebhook((v) => !v)}
              className="text-xs text-zinc-500 hover:text-zinc-900 cursor-pointer"
            >
              {showWaWebhook ? 'Hide webhook' : 'Webhook URL'}
            </button>
          </div>
        </section>
      </div>

      {/* 3. Upload & Map Existing Roles Card */}
      <section className="bg-white border border-zinc-200 rounded-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-blue-600 shrink-0" />
            <h2 className="text-sm font-semibold text-zinc-950">
              Upload &amp; Map Existing Role Lists (CSV / JSON)
            </h2>
          </div>
          <p className="text-xs text-zinc-500 max-w-2xl">
            Import roles you&apos;ve already pulled into Excel, Google Sheets, Notion, or Airtable. Gemini maps your columns to Meridian&apos;s normalized database schema with automatic duplicate detection.
          </p>
          {importHistory.length > 0 && (
            <div className="text-[11.5px] font-mono text-zinc-500 tabular-nums pt-0.5">
              Last import: {importHistory[0].fileName} (+{importHistory[0].importedCount} roles, {importHistory[0].createdAt})
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onOpenImportModal}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-zinc-900 bg-white border border-zinc-300 hover:bg-zinc-50 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Upload className="w-3.5 h-3.5" />
          <span>Upload &amp; Map CSV / JSON</span>
        </button>
      </section>

      {/* 3b. Target Companies Watchlist (CSV Upload + Manual Add) */}
      <section className="bg-white border border-zinc-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-blue-600 shrink-0" />
              <h2 className="text-sm font-semibold text-zinc-950">
                Target Companies Watchlist
              </h2>
              <span className="text-xs font-mono text-zinc-500 tabular-nums">
                {activeTargetCompaniesCount} active
              </span>
            </div>
            <p className="text-xs text-zinc-500 max-w-2xl leading-relaxed">
              List dream companies even when no specific role is open yet. On every agent pull, Meridian checks these companies&apos; careers pages and job boards for your desired role types.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {untitledJobCount > 0 && (
              <button
                type="button"
                onClick={onMoveUntitledToTargetCompanies}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-md whitespace-nowrap cursor-pointer"
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>Move {untitledJobCount} &ldquo;Untitled Role&rdquo; rows here</span>
              </button>
            )}
            <button
              type="button"
              onClick={onOpenTargetCompaniesImport}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-zinc-900 bg-white border border-zinc-300 hover:bg-zinc-50 rounded-md whitespace-nowrap cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload Companies CSV</span>
            </button>
          </div>
        </div>

        {/* Inline Add Target Company Form */}
        <form
          onSubmit={handleAddTargetCompanySubmit}
          className="grid grid-cols-1 md:grid-cols-12 gap-2.5 pt-1"
        >
          <input
            type="text"
            required
            value={tcName}
            onChange={(e) => setTcName(e.target.value)}
            placeholder="Company name (e.g., Anthropic, Stripe, Airbnb)"
            className="md:col-span-4 h-9 px-3 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
          />
          <input
            type="text"
            value={tcUrl}
            onChange={(e) => setTcUrl(e.target.value)}
            placeholder="Optional careers URL (auto-discovered if blank)"
            className="md:col-span-4 h-9 px-3 text-xs font-mono bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
          />
          <input
            type="text"
            value={tcNotes}
            onChange={(e) => setTcNotes(e.target.value)}
            placeholder="Optional notes (e.g., Target AI PM)"
            className="md:col-span-2 h-9 px-3 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
          />
          <button
            type="submit"
            className="md:col-span-2 inline-flex items-center justify-center gap-1.5 h-9 px-3 text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-md whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Company</span>
          </button>
        </form>

        {targetCompanies.length === 0 ? (
          <div className="py-6 px-4 text-center border border-dashed border-zinc-200 rounded-md text-xs text-zinc-500">
            No target companies added yet. Add one above or upload a CSV list of companies you want Meridian to monitor.
          </div>
        ) : (
          <div className="border border-zinc-200 rounded-md overflow-hidden">
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-zinc-50/80 border-b border-zinc-200 text-[11px] font-medium text-zinc-500">
                    <th className="py-2 pl-3.5 pr-2">Company</th>
                    <th className="py-2 px-2">Notes</th>
                    <th className="py-2 px-2 whitespace-nowrap">Last Checked</th>
                    <th className="py-2 px-2 text-right whitespace-nowrap">Roles Found</th>
                    <th className="py-2 pl-2 pr-3.5 text-right whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {targetCompanies.map((tc) => (
                    <tr key={tc.id} className="hover:bg-zinc-50/70">
                      <td className="py-2.5 pl-3.5 pr-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-medium ${
                              tc.enabled ? 'text-zinc-950' : 'text-zinc-400 line-through'
                            }`}
                          >
                            {tc.name}
                          </span>
                          {!tc.enabled && (
                            <span className="text-[10.5px] text-zinc-400">Paused</span>
                          )}
                        </div>
                        {tc.careersUrl ? (
                          <a
                            href={tc.careersUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-mono text-zinc-400 hover:text-blue-600 truncate max-w-[240px]"
                          >
                            <span className="truncate">{tc.careersUrl}</span>
                            <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                          </a>
                        ) : (
                          <div className="text-[11px] text-zinc-400">
                            Auto-discover careers &amp; job boards
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-zinc-500 max-w-[200px] truncate">
                        {tc.notes || '—'}
                      </td>
                      <td className="py-2.5 px-2 font-mono text-zinc-500 whitespace-nowrap tabular-nums">
                        {tc.lastCheckedAt || 'Pending pull'}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-zinc-700 tabular-nums">
                        {tc.lastFoundCount ?? 0}
                      </td>
                      <td className="py-2.5 pl-2 pr-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onToggleTargetCompany(tc.id)}
                            title={tc.enabled ? 'Pause watching' : 'Resume watching'}
                            aria-label={tc.enabled ? `Pause ${tc.name}` : `Resume ${tc.name}`}
                            className="p-1 text-zinc-400 hover:text-zinc-900 rounded cursor-pointer"
                          >
                            {tc.enabled ? (
                              <Pause className="w-3.5 h-3.5" />
                            ) : (
                              <Play className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteTargetCompany(tc.id)}
                            title="Remove target company"
                            aria-label={`Remove ${tc.name}`}
                            className="p-1 text-zinc-400 hover:text-red-600 rounded cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* 4. Add Career Source Form */}
      <form
        onSubmit={handleSubmit}
        className="bg-white border border-zinc-200 rounded-lg p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-950">Add a Career Source</h2>
          {detectedAts ? (
            <span className="text-xs text-zinc-500">
              Detected adapter:{' '}
              <strong className="font-medium text-blue-700">{detectedAts}</strong>
            </span>
          ) : (
            <span className="text-xs text-zinc-400">
              Supports Greenhouse, Ashby, Lever, RSS, or any public careers URL
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-4">
            <label htmlFor="source-name" className="block text-xs font-medium text-zinc-600 mb-1">
              Source Label
            </label>
            <input
              id="source-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Stripe Careers"
              className="w-full h-9 px-3 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          <div className="md:col-span-5">
            <label htmlFor="source-url" className="block text-xs font-medium text-zinc-600 mb-1">
              Career Page or ATS URL
            </label>
            <input
              id="source-url"
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://boards.greenhouse.io/company"
              className="w-full h-9 px-3 text-xs font-mono bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          <div className="md:col-span-3">
            <label htmlFor="source-cadence" className="block text-xs font-medium text-zinc-600 mb-1">
              Poll Cadence
            </label>
            <div className="flex items-center gap-2">
              <select
                id="source-cadence"
                value={cadenceHours}
                onChange={(e) => setCadenceHours(Number(e.target.value))}
                className="flex-1 h-9 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              >
                <option value={4}>Every 4h</option>
                <option value={6}>Every 6h</option>
                <option value={12}>Every 12h</option>
                <option value={24}>Daily</option>
              </select>

              <button
                type="submit"
                className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </div>
          </div>
        </div>

        {/* Quick-add verified live ATS presets */}
        {availablePresets.length > 0 && (
          <div className="pt-3 border-t border-zinc-100 flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-500 mr-1">Quick-add live boards:</span>
            {availablePresets.map((preset) => (
              <button
                key={preset.url}
                type="button"
                onClick={() => onAddSource(preset.name, preset.url, 4)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-zinc-700 bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 rounded-md transition-colors cursor-pointer"
              >
                <Plus className="w-3 h-3 text-zinc-400" />
                <span>{preset.name.replace(' Careers', '')}</span>
                <span className="text-zinc-400 font-normal">({preset.atsType})</span>
              </button>
            ))}
          </div>
        )}
      </form>

      {/* Server-Side Real-Time Auto-Schedule Bar */}
      <div className="bg-white border border-zinc-200 rounded-lg px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-zinc-950">
            Scheduled Server Runs &amp; Live Auto-Updates
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            Runs enabled ATS sources, monitors your Target Companies Watchlist, and enriches incomplete roles with missing fields in real time.
            {autoScheduleEnabled && nextRunFormatted && (
              <span className="ml-1.5 font-mono text-zinc-800 tabular-nums">
                Next run: {nextRunFormatted}
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <select
            aria-label="Scheduled run interval"
            value={autoScheduleMinutes}
            onChange={(e) => onChangeAutoScheduleMinutes(Number(e.target.value))}
            className="h-8 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-700 font-mono tabular-nums"
          >
            <option value={15}>Every 15 min</option>
            <option value={60}>Every 1 hr</option>
            <option value={240}>Every 4 hrs</option>
            <option value={360}>Every 6 hrs</option>
            <option value={720}>Twice daily (12h)</option>
            <option value={1440}>Daily (24h)</option>
          </select>

          <button
            type="button"
            role="switch"
            aria-checked={autoScheduleEnabled}
            onClick={onToggleAutoSchedule}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
              autoScheduleEnabled
                ? 'bg-zinc-900 text-white border-zinc-900'
                : 'bg-white text-zinc-600 border-zinc-200 hover:text-zinc-900'
            }`}
          >
            {autoScheduleEnabled ? 'Schedule On' : 'Schedule Off'}
          </button>
        </div>
      </div>

      {/* Configured Sources Table */}
      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50/70 text-[11px] font-medium text-zinc-500">
                <th className="py-2.5 pl-4 pr-3">Source</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Adapter</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Cadence</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Last Checked</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Indexed</th>
                <th className="py-2.5 pl-3 pr-4 text-right whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 text-[13px]">
              {sources.map((src) => {
                const isThisRunning =
                  runningSourceId === src.id || (isAgentRunning && !runningSourceId && src.enabled);
                return (
                  <tr key={src.id} className="hover:bg-zinc-50/70 transition-colors">
                    <td className="py-3 pl-4 pr-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-medium ${
                            src.enabled ? 'text-zinc-950' : 'text-zinc-400 line-through'
                          }`}
                        >
                          {src.name}
                        </span>
                        {!src.enabled && (
                          <span className="text-[11px] text-zinc-400">Paused</span>
                        )}
                      </div>
                      <a
                        href={src.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 inline-flex items-center gap-1 text-xs font-mono text-zinc-500 hover:text-blue-600 truncate max-w-[320px]"
                      >
                        <span className="truncate">{src.url}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    </td>

                    <td className="py-3 px-3 whitespace-nowrap text-xs text-zinc-700">
                      {src.atsType}
                    </td>

                    <td className="py-3 px-3 whitespace-nowrap">
                      <select
                        aria-label={`Cadence for ${src.name}`}
                        value={src.cadenceHours}
                        onChange={(e) => onUpdateCadence(src.id, Number(e.target.value))}
                        className="h-8 px-2 text-xs bg-white border border-zinc-200 rounded text-zinc-700 font-mono tabular-nums"
                      >
                        <option value={4}>Every 4h</option>
                        <option value={6}>Every 6h</option>
                        <option value={12}>Every 12h</option>
                        <option value={24}>Every 24h</option>
                      </select>
                    </td>

                    <td className="py-3 px-3 whitespace-nowrap text-xs text-zinc-500 font-mono tabular-nums">
                      {src.lastCheckedAt}
                    </td>

                    <td className="py-3 px-3 text-right whitespace-nowrap text-xs font-mono tabular-nums text-zinc-700">
                      {src.totalFound}
                      {src.lastNewCount > 0 && (
                        <span className="ml-1.5 text-blue-600">+{src.lastNewCount} new</span>
                      )}
                    </td>

                    <td className="py-3 pl-3 pr-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          disabled={isAgentRunning}
                          onClick={() => onRunSingleSource(src.id)}
                          title="Run agent on this source now"
                          aria-label={`Run ${src.name} now`}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:text-zinc-400 rounded-md cursor-pointer disabled:cursor-wait"
                        >
                          <RefreshCw
                            className={`w-3 h-3 ${isThisRunning ? 'animate-spin' : ''}`}
                          />
                          <span>Pull</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleSource(src.id)}
                          title={src.enabled ? 'Pause polling' : 'Resume polling'}
                          aria-label={src.enabled ? `Pause ${src.name}` : `Resume ${src.name}`}
                          className="p-1.5 text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100 rounded-md cursor-pointer"
                        >
                          {src.enabled ? (
                            <Pause className="w-3.5 h-3.5" />
                          ) : (
                            <Play className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteSource(src.id)}
                          title="Remove source"
                          aria-label={`Remove ${src.name}`}
                          className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-md cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Live Agent Run History */}
      <section className="bg-white border border-zinc-200 rounded-lg divide-y divide-zinc-200">
        <div className="px-5 py-3.5 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-950">Recent Agent Runs</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Audit trail of ATS pulls, Gmail/Slack/WhatsApp scans, URL-hash deduplication, and Gemini scoring.
            </p>
          </div>
          <span className="text-xs font-mono text-zinc-400 tabular-nums">
            {runHistory.length} {runHistory.length === 1 ? 'run' : 'runs'}
          </span>
        </div>

        {runHistory.length === 0 ? (
          <div className="p-6 text-center text-xs text-zinc-500">
            No live runs recorded yet. Click <strong>Run Agent Now</strong> in the top bar or scan a connected channel above.
          </div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {runHistory.map((run) => (
              <div key={run.id} className="px-5 py-4 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium text-zinc-900 tabular-nums">
                      {run.completedAt} · {run.completedTime}
                    </span>
                    <span className="text-zinc-400">
                      {run.trigger === 'scheduled' ? 'Scheduled' : 'Manual'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-zinc-500 font-mono tabular-nums">
                    <span>{run.totalFetched} scanned</span>
                    <span aria-hidden="true">·</span>
                    <span>{run.totalSkipped} deduped</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-blue-700">
                      +{run.totalAdded} added to Inbox
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {run.sourceResults.map((res) => (
                    <div
                      key={`${run.id}-${res.sourceId}`}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs pl-2.5"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {res.status === 'ok' ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        ) : (
                          <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                        )}
                        <span className="font-medium text-zinc-800 truncate">
                          {res.sourceName}
                        </span>
                        <span className="text-zinc-400 shrink-0">{res.atsType}</span>
                      </div>

                      {res.status === 'ok' ? (
                        <div className="text-[11.5px] font-mono text-zinc-500 tabular-nums shrink-0">
                          {res.rawFetched} raw · {res.duplicatesSkipped} skipped ·{' '}
                          <span className="text-zinc-900 font-medium">
                            {res.newlyScored} scored
                          </span>{' '}
                          · {(res.durationMs / 1000).toFixed(1)}s
                        </div>
                      ) : (
                        <div className="text-[11.5px] text-red-600 truncate">
                          {res.errorMessage}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
