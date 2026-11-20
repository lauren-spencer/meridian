import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import {
  extractJobFromUrl,
  fetchFullJobDescriptionFromUrl,
  type IncompleteJobCandidate,
} from './src/lib/agentRunner.ts';
import {
  buildCoverLetterDocxBuffer,
  generateCoverLetterForJob,
} from './src/lib/coverLetterGenerator.ts';
import {
  rescoreJobsWithFeedback,
  synthesizePreferencesWithGemini,
  type RichFeedbackItem,
} from './src/lib/feedbackEngine.ts';
import { runMeridianChat } from './src/lib/gemini.ts';
import { formatGeminiApiError } from './src/lib/geminiModels.ts';
import { scanGmailForJobs } from './src/lib/gmailScanner.ts';
import { suggestColumnMappingWithGemini } from './src/lib/importMapper.ts';
import { realtimeHub } from './src/lib/realtimeHub.ts';
import {
  buildCommentedResumeDocxBuffer,
  parseUploadedResume,
  reviewResumeForJob,
} from './src/lib/resumeTailor.ts';
import {
  buildSlackAuthUrl,
  exchangeSlackCode,
  scanSlackForJobs,
} from './src/lib/slackScanner.ts';
import { scanWhatsAppMessages } from './src/lib/whatsappScanner.ts';
import type { WorkspaceChatContext } from './src/types/chat.ts';
import type {
  CareerExperienceItem,
  CoverLetterSample,
  DislikeReason,
  JobRecord,
  JobSource,
  RoleResume,
  TargetCompany,
} from './src/types/job.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Load public Firebase Web API key so the server can cryptographically verify
// Firebase ID tokens via Google Identity Toolkit without exposing any secrets.
let firebaseWebApiKey = '';
try {
  const cfgPath = path.join(__dirname, 'firebase-applet-config.json');
  if (fs.existsSync(cfgPath)) {
    const parsedCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as {
      apiKey?: string;
    };
    firebaseWebApiKey = (parsedCfg.apiKey || '').trim();
  }
} catch {
  firebaseWebApiKey = '';
}

const DEFAULT_SLACK_OWNER_EMAIL = 'laurenashspencer@gmail.com';

function getAllowedSlackOwnerEmails(): Set<string> {
  const raw =
    process.env.SLACK_ALLOWED_EMAILS ||
    process.env.SLACK_OWNER_EMAIL ||
    DEFAULT_SLACK_OWNER_EMAIL;
  const emails = raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set(emails.length > 0 ? emails : [DEFAULT_SLACK_OWNER_EMAIL]);
}

interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
}

const verifiedIdTokenCache = new Map<
  string,
  { user: VerifiedFirebaseUser; expiresAt: number }
>();

async function verifyFirebaseIdToken(
  idToken: string
): Promise<VerifiedFirebaseUser | null> {
  const trimmed = idToken.trim();
  if (!trimmed || !firebaseWebApiKey) return null;

  const cacheKey = crypto.createHash('sha256').update(trimmed).digest('hex');
  const cached = verifiedIdTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseWebApiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: trimmed }),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      users?: {
        localId?: string;
        email?: string;
        emailVerified?: boolean;
      }[];
    };
    const u = data.users?.[0];
    if (!u?.localId || !u?.email) return null;
    const verified: VerifiedFirebaseUser = {
      uid: u.localId,
      email: u.email.toLowerCase(),
      emailVerified: Boolean(u.emailVerified),
    };
    verifiedIdTokenCache.set(cacheKey, {
      user: verified,
      expiresAt: Date.now() + 60_000,
    });
    if (verifiedIdTokenCache.size > 200) {
      const now = Date.now();
      for (const [k, v] of verifiedIdTokenCache.entries()) {
        if (v.expiresAt <= now) verifiedIdTokenCache.delete(k);
      }
    }
    return verified;
  } catch {
    return null;
  }
}

async function verifySlackOwnerRequest(
  req: express.Request
): Promise<{
  allowed: boolean;
  user?: VerifiedFirebaseUser;
  reason?: string;
}> {
  const headerToken = req.headers['x-firebase-id-token'];
  const idToken =
    typeof headerToken === 'string'
      ? headerToken.trim()
      : Array.isArray(headerToken)
      ? (headerToken[0] || '').trim()
      : '';

  if (!idToken) {
    return {
      allowed: false,
      reason:
        'Slack integration is restricted to the workspace owner. Sign in with the owner Google account first.',
    };
  }

  const user = await verifyFirebaseIdToken(idToken);
  if (!user || !user.emailVerified) {
    return {
      allowed: false,
      reason: 'Could not verify your Google account session. Please sign in again.',
    };
  }

  const allowedEmails = getAllowedSlackOwnerEmails();
  if (!allowedEmails.has(user.email)) {
    return {
      allowed: false,
      reason:
        'Slack API credentials on this deployment are private and restricted to the workspace owner.',
    };
  }

  return { allowed: true, user };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '12mb' }));

  // Real-time Server-Sent Events stream for live agent & re-score broadcasts
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const clientId = realtimeHub.addClient(res);
    req.on('close', () => {
      realtimeHub.removeClient(clientId);
    });
  });

  // Sync latest workspace criteria/sources/hashes to server-side background scheduler
  app.post('/api/workspace/sync', (req, res) => {
    const {
      sources,
      targetCompanies,
      incompleteJobs,
      existingHashes,
      searchPrompt,
      rules,
      recentFeedback,
      timeZone,
    } = req.body as {
      sources?: JobSource[];
      targetCompanies?: TargetCompany[];
      incompleteJobs?: IncompleteJobCandidate[];
      existingHashes?: string[];
      searchPrompt?: string;
      rules?: { text: string; active: boolean }[];
      recentFeedback?: {
        jobTitle: string;
        company: string;
        vote: 'up' | 'down';
        reason?: DislikeReason;
      }[];
      timeZone?: string;
    };

    const resolvedTz =
      typeof timeZone === 'string' && timeZone.trim()
        ? timeZone.trim()
        : typeof req.headers['x-timezone'] === 'string'
        ? req.headers['x-timezone'].trim()
        : undefined;

    if (Array.isArray(sources) || Array.isArray(targetCompanies)) {
      realtimeHub.syncWorkspaceContext({
        sources: Array.isArray(sources) ? sources : [],
        targetCompanies: Array.isArray(targetCompanies) ? targetCompanies : [],
        incompleteJobs: Array.isArray(incompleteJobs) ? incompleteJobs : [],
        existingHashes: Array.isArray(existingHashes) ? existingHashes : [],
        searchPrompt: typeof searchPrompt === 'string' ? searchPrompt : '',
        rules: Array.isArray(rules) ? rules : [],
        recentFeedback: Array.isArray(recentFeedback) ? recentFeedback : [],
        maxNewPerRun: 8,
        timeZone: resolvedTz,
      });
    }

    res.json({ ok: true, schedule: realtimeHub.getScheduleState() });
  });

  // Configure server-authoritative scheduled background agent runs
  app.post('/api/schedule', (req, res) => {
    const { enabled, intervalMinutes, context } = req.body as {
      enabled?: boolean;
      intervalMinutes?: number;
      context?: {
        sources: JobSource[];
        targetCompanies?: TargetCompany[];
        incompleteJobs?: IncompleteJobCandidate[];
        existingHashes: string[];
        searchPrompt: string;
        rules: { text: string; active: boolean }[];
        recentFeedback: {
          jobTitle: string;
          company: string;
          vote: 'up' | 'down';
          reason?: DislikeReason;
        }[];
        timeZone?: string;
      };
    };

    const state = realtimeHub.updateSchedule({
      enabled: Boolean(enabled),
      intervalMinutes: typeof intervalMinutes === 'number' ? intervalMinutes : 240,
      context: context
        ? {
            sources: Array.isArray(context.sources) ? context.sources : [],
            targetCompanies: Array.isArray(context.targetCompanies)
              ? context.targetCompanies
              : [],
            incompleteJobs: Array.isArray(context.incompleteJobs)
              ? context.incompleteJobs
              : [],
            existingHashes: Array.isArray(context.existingHashes)
              ? context.existingHashes
              : [],
            searchPrompt: context.searchPrompt ?? '',
            rules: Array.isArray(context.rules) ? context.rules : [],
            recentFeedback: Array.isArray(context.recentFeedback)
              ? context.recentFeedback
              : [],
            maxNewPerRun: 8,
            timeZone:
              typeof context.timeZone === 'string' && context.timeZone.trim()
                ? context.timeZone.trim()
                : undefined,
          }
        : undefined,
    });

    res.json(state);
  });

  // Multi-turn Gemini Search & Feedback Assistant
  app.post('/api/chat', async (req, res) => {
    try {
      const { message, history, workspaceContext } = req.body as {
        message?: string;
        history?: { role: 'user' | 'model'; text: string }[];
        workspaceContext?: WorkspaceChatContext;
      };

      if (!message || typeof message !== 'string' || !message.trim()) {
        res.status(400).json({ error: 'Message is required.' });
        return;
      }

      if (!workspaceContext || typeof workspaceContext !== 'object') {
        res.status(400).json({ error: 'Workspace context is required.' });
        return;
      }

      const result = await runMeridianChat({
        message: message.trim(),
        history: Array.isArray(history) ? history : [],
        workspaceContext,
      });

      res.json(result);
    } catch (error: unknown) {
      console.error('Error in POST /api/chat:', error);
      const { statusCode, message } = formatGeminiApiError(
        error,
        'Failed to reach the assistant. Please try again in a moment.'
      );
      res.status(statusCode).json({ error: message });
    }
  });

  // Live ATS / Markdown / Target Company Agent Runner + Incomplete Role Enrichment
  app.post('/api/agent/run', async (req, res) => {
    try {
      const {
        sources,
        targetCompanies,
        incompleteJobs,
        existingHashes,
        searchPrompt,
        rules,
        recentFeedback,
        maxNewPerRun,
        timeZone,
      } = req.body as {
        sources?: JobSource[];
        targetCompanies?: TargetCompany[];
        incompleteJobs?: IncompleteJobCandidate[];
        existingHashes?: string[];
        searchPrompt?: string;
        rules?: { text: string; active: boolean }[];
        recentFeedback?: {
          jobTitle: string;
          company: string;
          vote: 'up' | 'down';
          reason?: DislikeReason;
        }[];
        maxNewPerRun?: number;
        timeZone?: string;
      };

      const hasSources = Array.isArray(sources) && sources.length > 0;
      const hasCompanies = Array.isArray(targetCompanies) && targetCompanies.some((c) => c.enabled);
      const hasIncomplete = Array.isArray(incompleteJobs) && incompleteJobs.length > 0;

      if (!hasSources && !hasCompanies && !hasIncomplete) {
        res.status(400).json({
          error: 'At least one enabled source, target company, or incomplete role to enrich is required.',
        });
        return;
      }

      const output = await realtimeHub.executeRun(
        {
          sources: Array.isArray(sources) ? sources : [],
          targetCompanies: Array.isArray(targetCompanies) ? targetCompanies : [],
          incompleteJobs: Array.isArray(incompleteJobs) ? incompleteJobs : [],
          existingHashes: Array.isArray(existingHashes) ? existingHashes : [],
          searchPrompt: typeof searchPrompt === 'string' ? searchPrompt : '',
          rules: Array.isArray(rules) ? rules : [],
          recentFeedback: Array.isArray(recentFeedback) ? recentFeedback : [],
          maxNewPerRun: typeof maxNewPerRun === 'number' ? maxNewPerRun : 8,
          timeZone: typeof timeZone === 'string' ? timeZone : undefined,
        },
        'manual'
      );

      res.json(output);
    } catch (error: unknown) {
      console.error('Error in POST /api/agent/run:', error);
      const { statusCode, message } = formatGeminiApiError(
        error,
        'Agent run failed while scoring or fetching sources.'
      );
      res.status(statusCode).json({ error: message });
    }
  });

  // Week 3 Stage 1: Re-score existing Inbox/Saved roles using updated criteria + few-shot feedback
  app.post('/api/agent/rescore', async (req, res) => {
    try {
      const { jobs, searchPrompt, rules, recentFeedback } = req.body as {
        jobs?: Pick<
          JobRecord,
          'id' | 'title' | 'company' | 'salaryLabel' | 'location' | 'locationType' | 'skills' | 'summary'
        >[];
        searchPrompt?: string;
        rules?: { text: string; active: boolean }[];
        recentFeedback?: RichFeedbackItem[];
      };

      if (!Array.isArray(jobs) || jobs.length === 0) {
        res.status(400).json({ error: 'At least one job is required to re-score.' });
        return;
      }

      const patches = await rescoreJobsWithFeedback({
        jobs,
        searchPrompt: typeof searchPrompt === 'string' ? searchPrompt : '',
        rules: Array.isArray(rules) ? rules : [],
        recentFeedback: Array.isArray(recentFeedback) ? recentFeedback : [],
      });

      realtimeHub.broadcast('jobs:rescored', { patches });
      res.json({ patches });
    } catch (error: unknown) {
      console.error('Error in POST /api/agent/rescore:', error);
      const { statusCode, message } = formatGeminiApiError(
        error,
        'Failed to re-score roles.'
      );
      res.status(statusCode).json({ error: message });
    }
  });

  // Week 3 Stage 2: AI Preference Synthesis from rolling likes/dislikes
  app.post('/api/feedback/synthesize', async (req, res) => {
    try {
      const { searchPrompt, rules, recentFeedback, timeZone } = req.body as {
        searchPrompt?: string;
        rules?: { text: string; active: boolean }[];
        recentFeedback?: RichFeedbackItem[];
        timeZone?: string;
      };

      const result = await synthesizePreferencesWithGemini({
        searchPrompt: typeof searchPrompt === 'string' ? searchPrompt : '',
        rules: Array.isArray(rules) ? rules : [],
        recentFeedback: Array.isArray(recentFeedback) ? recentFeedback : [],
        timeZone: typeof timeZone === 'string' ? timeZone : undefined,
      });

      res.json(result);
    } catch (error: unknown) {
      console.error('Error in POST /api/feedback/synthesize:', error);
      const { statusCode, message } = formatGeminiApiError(
        error,
        'Failed to synthesize preference rules.'
      );
      res.status(statusCode).json({ error: message });
    }
  });

  // Gmail Read-Only Job Scanner (LinkedIn & configured job alert senders)
  app.post('/api/gmail/scan', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
          error: 'Missing Google access token. Please sign in with Google to scan Gmail.',
        });
        return;
      }

      const accessToken = authHeader.slice('Bearer '.length).trim();
      const {
        query,
        maxMessages,
        existingHashes,
        searchPrompt,
        rules,
        recentFeedback,
        timeZone,
      } = req.body as {
        query?: string;
        maxMessages?: number;
        existingHashes?: string[];
        searchPrompt?: string;
        rules?: { text: string; active: boolean }[];
        recentFeedback?: {
          jobTitle: string;
          company: string;
          vote: 'up' | 'down';
          reason?: DislikeReason;
        }[];
        timeZone?: string;
      };

      const output = await scanGmailForJobs({
        accessToken,
        query,
        maxMessages,
        existingHashes: Array.isArray(existingHashes) ? existingHashes : [],
        searchPrompt: typeof searchPrompt === 'string' ? searchPrompt : '',
        rules: Array.isArray(rules) ? rules : [],
        recentFeedback: Array.isArray(recentFeedback) ? recentFeedback : [],
        timeZone: typeof timeZone === 'string' ? timeZone : undefined,
      });

      res.json(output);
    } catch (error: unknown) {
      console.error('Error in POST /api/gmail/scan:', error);
      const { statusCode, message } = formatGeminiApiError(
        error,
        'Failed to scan Gmail messages.'
      );
      res.status(statusCode).json({ error: message });
    }
  });

  // Short-lived in-memory Slack OAuth state & one-time session delivery (strictly owner-bound)
  const pendingSlackOAuth = new Map<
    string,
    { redirectUri: string; ownerUid: string; ownerEmail: string; createdAt: number }
  >();
  const completedSlackOAuth = new Map<
    string,
    {
      ok: boolean;
      ownerUid: string;
      accessToken?: string;
      teamName?: string;
      authedUserId?: string;
      error?: string;
      createdAt: number;
    }
  >();

  const pruneSlackOAuthMaps = () => {
    const now = Date.now();
    for (const [k, v] of pendingSlackOAuth.entries()) {
      if (now - v.createdAt > 10 * 60 * 1000) pendingSlackOAuth.delete(k);
    }
    for (const [k, v] of completedSlackOAuth.entries()) {
      if (now - v.createdAt > 2 * 60 * 1000) completedSlackOAuth.delete(k);
    }
  };

  const getSlackCallbackUris = (
    requestedOrigin?: string,
    req?: express.Request
  ) => {
    const envBase = (process.env.APP_URL || '').trim().replace(/\/$/, '');
    const forwardedProto =
      typeof req?.headers['x-forwarded-proto'] === 'string'
        ? req.headers['x-forwarded-proto'].split(',')[0].trim()
        : req?.protocol || 'https';
    const reqHost = req?.get('host')?.trim() || '';
    const inferredRequestBase =
      reqHost && !/^localhost(?::\d+)?$/i.test(reqHost) && !/^127\.0\.0\.1(?::\d+)?$/i.test(reqHost)
        ? `${forwardedProto}://${reqHost}`.replace(/\/$/, '')
        : '';

    const devBase = envBase || inferredRequestBase || 'http://localhost:3000';
    const sharedBase = envBase.includes('ais-dev-')
      ? envBase.replace('ais-dev-', 'ais-pre-')
      : envBase;

    let activeBase = devBase;
    if (requestedOrigin) {
      try {
        const u = new URL(requestedOrigin);
        const normalized = u.origin.replace(/\/$/, '');
        if (
          u.protocol === 'https:' ||
          normalized === envBase ||
          normalized === sharedBase ||
          u.hostname === 'localhost' ||
          u.hostname === '127.0.0.1'
        ) {
          activeBase = normalized;
        }
      } catch {
        // Ignore invalid origin query param and keep devBase
      }
    }

    return {
      redirectUri: `${activeBase}/api/slack/callback`,
      devRedirectUri: `${devBase}/api/slack/callback`,
      sharedRedirectUri:
        sharedBase && sharedBase !== activeBase
          ? `${sharedBase}/api/slack/callback`
          : null,
    };
  };

  // Slack 3P OAuth URL builder (strictly owner-only — never exposes Slack config/credentials to other users)
  app.get('/api/slack/auth/url', async (req, res) => {
    pruneSlackOAuthMaps();
    const ownerCheck = await verifySlackOwnerRequest(req);
    if (!ownerCheck.allowed || !ownerCheck.user) {
      res.json({
        configured: false,
        ownerRestricted: true,
        hasClientId: false,
        hasClientSecret: false,
        url: null,
        state: null,
        redirectUri: null,
        devRedirectUri: null,
        sharedRedirectUri: null,
      });
      return;
    }

    const requestedOrigin =
      typeof req.query.origin === 'string' ? req.query.origin : undefined;
    const { redirectUri, devRedirectUri, sharedRedirectUri } =
      getSlackCallbackUris(requestedOrigin, req);
    const state = crypto.randomBytes(20).toString('hex');
    const result = buildSlackAuthUrl(redirectUri, state);

    if (result.configured) {
      pendingSlackOAuth.set(state, {
        redirectUri,
        ownerUid: ownerCheck.user.uid,
        ownerEmail: ownerCheck.user.email,
        createdAt: Date.now(),
      });
    }

    res.json({
      configured: result.configured,
      ownerRestricted: false,
      hasClientId: result.hasClientId,
      hasClientSecret: result.hasClientSecret,
      url: result.url ?? null,
      state: result.configured ? state : null,
      redirectUri,
      devRedirectUri,
      sharedRedirectUri,
    });
  });

  // One-time poll fallback for Slack OAuth (verified against the exact owner UID that initiated state)
  app.get('/api/slack/session', async (req, res) => {
    pruneSlackOAuthMaps();
    const ownerCheck = await verifySlackOwnerRequest(req);
    if (!ownerCheck.allowed || !ownerCheck.user) {
      res.status(403).json({
        error: ownerCheck.reason || 'Slack session access is restricted to the workspace owner.',
      });
      return;
    }

    const state = typeof req.query.state === 'string' ? req.query.state.trim() : '';
    if (!state) {
      res.status(400).json({ error: 'Missing OAuth state parameter.' });
      return;
    }
    const completed = completedSlackOAuth.get(state);
    if (!completed) {
      res.json({ pending: true });
      return;
    }
    if (completed.ownerUid !== ownerCheck.user.uid) {
      res.status(403).json({ error: 'Unauthorized Slack OAuth session.' });
      return;
    }
    completedSlackOAuth.delete(state);
    res.json({
      pending: false,
      ok: completed.ok,
      accessToken: completed.accessToken,
      teamName: completed.teamName,
      authedUserId: completed.authedUserId,
      error: completed.error,
    });
  });

  const renderSlackCallbackHtml = (payload: {
    ok: boolean;
    state: string;
    accessToken?: string;
    teamName?: string;
    authedUserId?: string;
    error?: string;
  }) => {
    const postPayload = payload.ok
      ? {
          type: 'SLACK_OAUTH_SUCCESS',
          state: payload.state,
          accessToken: payload.accessToken,
          teamName: payload.teamName,
          authedUserId: payload.authedUserId,
        }
      : {
          type: 'SLACK_OAUTH_ERROR',
          state: payload.state,
          error: payload.error || 'Slack authorization failed.',
        };

    const heading = payload.ok
      ? `Connected to ${payload.teamName || 'Slack'}`
      : 'Slack Connection Issue';
    const detail = payload.ok
      ? 'Your Slack workspace is connected to Meridian. This window will close automatically.'
      : payload.error || 'Slack authorization was cancelled or failed.';

    const escapeHtml = (str: string) =>
      str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(heading)} — Meridian</title>
  </head>
  <body style="font-family:Inter,system-ui,-apple-system,sans-serif;background:#fafafa;color:#18181b;padding:32px;max-width:480px;margin:0 auto;">
    <div style="background:#fff;border:1px solid #e4e4e7;border-radius:10px;padding:24px;">
      <div style="font-size:15px;font-weight:600;margin-bottom:8px;color:${payload.ok ? '#047857' : '#b91c1c'};">
        ${escapeHtml(heading)}
      </div>
      <p style="font-size:13px;line-height:1.5;color:#52525b;margin:0 0 16px;">
        ${escapeHtml(detail)}
      </p>
      <button onclick="window.close()" style="font-size:12px;font-weight:500;padding:8px 14px;border-radius:6px;border:1px solid #d4d4d8;background:#fff;color:#18181b;cursor:pointer;">
        Close Window
      </button>
    </div>
    <script>
      (function () {
        var data = ${JSON.stringify(postPayload)};
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(data, '*');
          }
        } catch (e) {}
        try {
          if (typeof BroadcastChannel !== 'undefined') {
            var bc = new BroadcastChannel('meridian_slack_oauth');
            bc.postMessage(data);
            bc.close();
          }
        } catch (e) {}
        ${payload.ok ? 'setTimeout(function () { window.close(); }, 350);' : ''}
      })();
    </script>
  </body>
</html>`;
  };

  // Slack 3P OAuth callback (handles both with and without trailing slash)
  const handleSlackCallback = async (
    req: express.Request,
    res: express.Response
  ) => {
    pruneSlackOAuthMaps();
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const oauthErr = typeof req.query.error === 'string' ? req.query.error : '';
    const state = typeof req.query.state === 'string' ? req.query.state.trim() : '';

    const pending = state ? pendingSlackOAuth.get(state) : undefined;
    if (state) pendingSlackOAuth.delete(state);

    // Reject forged or expired callbacks that were not initiated by the verified owner
    if (!pending) {
      const errorMsg =
        'Invalid or expired Slack authorization session. Please reconnect from the owner account.';
      res.status(403).send(renderSlackCallbackHtml({ ok: false, state, error: errorMsg }));
      return;
    }

    if (oauthErr || !code) {
      const errorMsg =
        oauthErr === 'access_denied'
          ? 'Slack access was cancelled or requires Workspace Admin approval for this Slack app.'
          : oauthErr || 'Missing Slack authorization code.';
      completedSlackOAuth.set(state, {
        ok: false,
        ownerUid: pending.ownerUid,
        error: errorMsg,
        createdAt: Date.now(),
      });
      res.status(400).send(renderSlackCallbackHtml({ ok: false, state, error: errorMsg }));
      return;
    }

    try {
      const redirectUri = pending.redirectUri;
      const exchanged = await exchangeSlackCode(code, redirectUri);

      completedSlackOAuth.set(state, {
        ok: true,
        ownerUid: pending.ownerUid,
        accessToken: exchanged.accessToken,
        teamName: exchanged.teamName,
        authedUserId: exchanged.authedUserId,
        createdAt: Date.now(),
      });

      res.send(
        renderSlackCallbackHtml({
          ok: true,
          state,
          accessToken: exchanged.accessToken,
          teamName: exchanged.teamName,
          authedUserId: exchanged.authedUserId,
        })
      );
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Slack token exchange failed.';
      console.error('Slack OAuth callback error:', msg);
      completedSlackOAuth.set(state, {
        ok: false,
        ownerUid: pending.ownerUid,
        error: msg,
        createdAt: Date.now(),
      });
      res.status(500).send(renderSlackCallbackHtml({ ok: false, state, error: msg }));
    }
  };
  app.get(['/api/slack/callback', '/api/slack/callback/'], handleSlackCallback);

  // Slack Job Channel Scanner (owner-only)
  app.post('/api/slack/scan', async (req, res) => {
    try {
      const ownerCheck = await verifySlackOwnerRequest(req);
      if (!ownerCheck.allowed) {
        res.status(403).json({
          error:
            ownerCheck.reason ||
            'Slack scanning is restricted to the workspace owner.',
        });
        return;
      }

      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
          error: 'Missing Slack access token. Connect Slack first to scan channels.',
        });
        return;
      }

      const accessToken = authHeader.slice('Bearer '.length).trim();
      const { channels, existingHashes, searchPrompt, rules, recentFeedback, timeZone } =
        req.body as {
          channels?: string[];
          existingHashes?: string[];
          searchPrompt?: string;
          rules?: { text: string; active: boolean }[];
          recentFeedback?: {
            jobTitle: string;
            company: string;
            vote: 'up' | 'down';
            reason?: DislikeReason;
          }[];
          timeZone?: string;
        };

      const output = await scanSlackForJobs({
        accessToken,
        channels: Array.isArray(channels) ? channels : undefined,
        existingHashes: Array.isArray(existingHashes) ? existingHashes : [],
        searchPrompt: typeof searchPrompt === 'string' ? searchPrompt : '',
        rules: Array.isArray(rules) ? rules : [],
        recentFeedback: Array.isArray(recentFeedback) ? recentFeedback : [],
        timeZone: typeof timeZone === 'string' ? timeZone : undefined,
      });

      res.json(output);
    } catch (error: unknown) {
      console.error('Error in POST /api/slack/scan:', error);
      const { statusCode, message } = formatGeminiApiError(
        error,
        'Failed to scan Slack channels.'
      );
      res.status(statusCode).json({ error: message });
    }
  });

  // WhatsApp Chat Export / Forwarded Messages Scanner
  app.post('/api/whatsapp/scan', async (req, res) => {
    try {
      const { rawText, groupName, existingHashes, searchPrompt, rules, recentFeedback, timeZone } =
        req.body as {
          rawText?: string;
          groupName?: string;
          existingHashes?: string[];
          searchPrompt?: string;
          rules?: { text: string; active: boolean }[];
          recentFeedback?: {
            jobTitle: string;
            company: string;
            vote: 'up' | 'down';
            reason?: DislikeReason;
          }[];
          timeZone?: string;
        };

      if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
        res.status(400).json({ error: 'WhatsApp chat text or export file is required.' });
        return;
      }

      const output = await scanWhatsAppMessages({
        rawText,
        groupName,
        existingHashes: Array.isArray(existingHashes) ? existingHashes : [],
        searchPrompt: typeof searchPrompt === 'string' ? searchPrompt : '',
        rules: Array.isArray(rules) ? rules : [],
        recentFeedback: Array.isArray(recentFeedback) ? recentFeedback : [],
        timeZone: typeof timeZone === 'string' ? timeZone : undefined,
      });

      realtimeHub.broadcast('agent:completed', {
        trigger: 'manual',
        newJobs: output.newJobs,
        runReport: output.runReport,
      });

      res.json(output);
    } catch (error: unknown) {
      console.error('Error in POST /api/whatsapp/scan:', error);
      const { statusCode, message } = formatGeminiApiError(
        error,
        'Failed to extract jobs from WhatsApp messages.'
      );
      res.status(statusCode).json({ error: message });
    }
  });

  // Meta WhatsApp Cloud API Webhook Verification & Forwarded Job Ingestion
  app.get('/api/whatsapp/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN || 'meridian-whatsapp-verify';

    if (mode === 'subscribe' && token === expectedToken && typeof challenge === 'string') {
      res.status(200).send(challenge);
      return;
    }
    res.sendStatus(403);
  });

  app.post('/api/whatsapp/webhook', async (req, res) => {
    // Acknowledge immediately per Meta webhook SLA, then extract & broadcast if text present
    res.sendStatus(200);
    try {
      const entries = (req.body?.entry ?? []) as {
        changes?: {
          value?: {
            messages?: { text?: { body?: string }; from?: string }[];
          };
        }[];
      }[];
      const texts: string[] = [];
      for (const entry of entries) {
        for (const change of entry.changes ?? []) {
          for (const msg of change.value?.messages ?? []) {
            if (msg.text?.body) {
              texts.push(`WhatsApp (${msg.from || 'Forwarded'}): ${msg.text.body}`);
            }
          }
        }
      }
      if (texts.length === 0) return;

      const output = await scanWhatsAppMessages({
        rawText: texts.join('\n'),
        groupName: 'WhatsApp Live Forward',
        existingHashes: [],
        searchPrompt: '',
        rules: [],
        recentFeedback: [],
      });

      if (output.newJobs.length > 0) {
        realtimeHub.broadcast('agent:completed', {
          trigger: 'scheduled',
          newJobs: output.newJobs,
          runReport: output.runReport,
        });
      }
    } catch (error) {
      console.error('WhatsApp webhook processing error:', error);
    }
  });

  // AI Column Mapping for Uploaded CSV/JSON Job Spreadsheets
  app.post('/api/import/map', async (req, res) => {
    try {
      const { headers, sampleRows } = req.body as {
        headers?: string[];
        sampleRows?: Record<string, string>[];
      };

      if (!Array.isArray(headers) || headers.length === 0) {
        res.status(400).json({ error: 'Column headers are required for mapping.' });
        return;
      }

      const mappings = await suggestColumnMappingWithGemini({
        headers,
        sampleRows: Array.isArray(sampleRows) ? sampleRows : [],
      });

      res.json({ mappings });
    } catch (error: unknown) {
      console.error('Error in POST /api/import/map:', error);
      const { statusCode, message } = formatGeminiApiError(
        error,
        'Failed to map uploaded columns.'
      );
      res.status(statusCode).json({ error: message });
    }
  });

  // On-demand Full Job Description fetcher for public job posting URLs (with live web search fallback)
  app.post('/api/jobs/fetch-description', async (req, res) => {
    try {
      const { jobUrl, title, company, location } = req.body as {
        jobUrl?: string;
        title?: string;
        company?: string;
        location?: string;
      };
      if (
        (!jobUrl || !jobUrl.trim()) &&
        (!title || !title.trim()) &&
        (!company || !company.trim())
      ) {
        res
          .status(400)
          .json({ error: 'A job posting URL or role title and company is required.' });
        return;
      }
      const result = await fetchFullJobDescriptionFromUrl(jobUrl?.trim(), {
        title: title?.trim(),
        company: company?.trim(),
        location: location?.trim(),
      });
      res.json(result);
    } catch (error: unknown) {
      console.error('Error in POST /api/jobs/fetch-description:', error);
      const { statusCode, message } = formatGeminiApiError(
        error,
        'Could not fetch full job description from the web.'
      );
      res.status(statusCode).json({ error: message });
    }
  });

  // Manually add a single role by entering its job posting URL
  app.post('/api/jobs/from-url', async (req, res) => {
    try {
      const { jobUrl, searchPrompt, rules, recentFeedback, stage, timeZone } = req.body as {
        jobUrl?: string;
        searchPrompt?: string;
        rules?: { text: string; active: boolean }[];
        recentFeedback?: {
          jobTitle: string;
          company: string;
          vote: 'up' | 'down';
          reason?: DislikeReason;
        }[];
        stage?: JobRecord['stage'];
        timeZone?: string;
      };

      if (!jobUrl || !jobUrl.trim()) {
        res.status(400).json({ error: 'A job posting URL is required.' });
        return;
      }

      const job = await extractJobFromUrl({
        jobUrl: jobUrl.trim(),
        searchPrompt: typeof searchPrompt === 'string' ? searchPrompt : '',
        rules: Array.isArray(rules) ? rules : [],
        recentFeedback: Array.isArray(recentFeedback) ? recentFeedback : [],
        stage,
        timeZone: typeof timeZone === 'string' ? timeZone : undefined,
      });

      res.json({ job });
    } catch (error: unknown) {
      console.error('Error in POST /api/jobs/from-url:', error);
      const { statusCode, message } = formatGeminiApiError(
        error,
        'Could not extract job details from that URL. Verify it is a public posting link.'
      );
      res.status(statusCode).json({ error: message });
    }
  });

  // Generate tailored cover letter matching the user's uploaded role-specific sample + .docx export
  app.post('/api/cover-letters/generate', async (req, res) => {
    try {
      const {
        job,
        sample,
        baseResume,
        careerExperiences,
        careerContextNotes,
        customInstructions,
        timeZone,
      } = req.body as {
        job?: Pick<
          JobRecord,
          | 'title'
          | 'company'
          | 'location'
          | 'locationType'
          | 'employmentType'
          | 'isMbaRole'
          | 'skills'
          | 'summary'
          | 'fullDescription'
          | 'notes'
        >;
        sample?: CoverLetterSample;
        baseResume?: RoleResume | null;
        careerExperiences?: CareerExperienceItem[];
        careerContextNotes?: string;
        customInstructions?: string;
        timeZone?: string;
      };

      if (!job || !sample || !sample.rawText?.trim()) {
        res.status(400).json({
          error: 'Both a target job and an uploaded cover letter sample are required.',
        });
        return;
      }

      const coverLetter = await generateCoverLetterForJob({
        job,
        sample,
        baseResume: baseResume ?? null,
        careerExperiences: Array.isArray(careerExperiences) ? careerExperiences : [],
        careerContextNotes:
          typeof careerContextNotes === 'string' ? careerContextNotes : '',
        customInstructions:
          typeof customInstructions === 'string' ? customInstructions : undefined,
        timeZone: typeof timeZone === 'string' ? timeZone : undefined,
      });

      const docxBuffer = await buildCoverLetterDocxBuffer(coverLetter);
      const safeName = coverLetter.candidateName
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
      const safeCompany = job.company
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
      const safeRole = job.title
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 32);
      const fileName = `${safeName || 'Candidate'}_${safeCompany}_${safeRole}_Cover_Letter.docx`;

      res.json({
        coverLetter,
        docxBase64: docxBuffer.toString('base64'),
        fileName,
      });
    } catch (error: unknown) {
      console.error('Error in POST /api/cover-letters/generate:', error);
      const { statusCode, message } = formatGeminiApiError(
        error,
        'Could not generate cover letter for this job.'
      );
      res.status(statusCode).json({ error: message });
    }
  });

  // Parse uploaded .docx / .pdf / .txt resume into clean text
  app.post('/api/resumes/parse', async (req, res) => {
    try {
      const { fileName, mimeType, base64Data } = req.body as {
        fileName?: string;
        mimeType?: string;
        base64Data?: string;
      };
      if (!fileName || !base64Data) {
        res.status(400).json({ error: 'fileName and base64Data are required.' });
        return;
      }
      const parsed = await parseUploadedResume({ fileName, mimeType, base64Data });
      res.json(parsed);
    } catch (error: unknown) {
      console.error('Error in POST /api/resumes/parse:', error);
      const { statusCode, message } = formatGeminiApiError(
        error,
        'Could not parse uploaded resume file.'
      );
      res.status(statusCode).json({ error: message });
    }
  });

  // Review a base resume against a job description and leave anchored comments (Move / Add / Remove / Missing)
  app.post('/api/resumes/review', async (req, res) => {
    try {
      const {
        job,
        baseResume,
        careerExperiences,
        careerContextNotes,
        customInstructions,
        timeZone,
      } = req.body as {
        job?: Pick<
          JobRecord,
          'title' | 'company' | 'location' | 'locationType' | 'skills' | 'summary' | 'fullDescription'
        >;
        baseResume?: RoleResume;
        careerExperiences?: CareerExperienceItem[];
        careerContextNotes?: string;
        customInstructions?: string;
        timeZone?: string;
      };

      if (!job || !baseResume || !baseResume.rawText?.trim()) {
        res.status(400).json({
          error: 'Both a target job and an uploaded base resume are required.',
        });
        return;
      }

      const review = await reviewResumeForJob({
        job,
        baseResume,
        careerExperiences: Array.isArray(careerExperiences) ? careerExperiences : [],
        careerContextNotes:
          typeof careerContextNotes === 'string' ? careerContextNotes : '',
        customInstructions:
          typeof customInstructions === 'string' ? customInstructions : undefined,
        timeZone: typeof timeZone === 'string' ? timeZone : undefined,
      });

      const commentedBuffer = await buildCommentedResumeDocxBuffer(review, {
        title: job.title,
        company: job.company,
      });
      const safeBase = baseResume.fileName
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 32);
      const safeCompany = job.company.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
      const safeRole = job.title
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 32);
      const fileName = `${safeBase || 'Resume'}_${safeCompany}_${safeRole}_Comments.docx`;

      res.json({
        review,
        docxBase64: commentedBuffer.toString('base64'),
        fileName,
      });
    } catch (error: unknown) {
      console.error('Error in POST /api/resumes/review:', error);
      const { statusCode, message } = formatGeminiApiError(
        error,
        'Could not generate resume review comments for this job.'
      );
      res.status(statusCode).json({ error: message });
    }
  });

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Meridian server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Meridian server:', err);
  process.exit(1);
});
