import type { Response } from 'express';
import { runAgentPipeline, type AgentRunInput, type AgentRunOutput } from './agentRunner.ts';
import { buildJobDedupeKeys } from './jobDedupe.ts';
import type { ServerScheduleState } from '../types/job.ts';

interface SseClient {
  id: string;
  res: Response;
}

class RealtimeAgentHub {
  private clients = new Map<string, SseClient>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private scheduleTimer: NodeJS.Timeout | null = null;

  private scheduleEnabled = false;
  private intervalMinutes = 240;
  private nextRunAt: string | null = null;
  private isRunning = false;

  // Authoritative latest workspace snapshot synced from connected clients for scheduled background runs
  private latestContext: AgentRunInput | null = null;

  constructor() {
    this.heartbeatTimer = setInterval(() => {
      for (const client of this.clients.values()) {
        try {
          client.res.write(': keep-alive\n\n');
        } catch {
          this.clients.delete(client.id);
        }
      }
    }, 25_000);
    this.heartbeatTimer.unref?.();
  }

  public addClient(res: Response): string {
    const id = `sse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.clients.set(id, { id, res });
    this.sendToClient(res, 'schedule:updated', this.getScheduleState());
    return id;
  }

  public removeClient(id: string): void {
    this.clients.delete(id);
  }

  private sendToClient(res: Response, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  public broadcast(event: string, data: unknown): void {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [id, client] of this.clients.entries()) {
      try {
        client.res.write(frame);
      } catch {
        this.clients.delete(id);
      }
    }
  }

  public getScheduleState(): ServerScheduleState {
    return {
      enabled: this.scheduleEnabled,
      intervalMinutes: this.intervalMinutes,
      nextRunAt: this.nextRunAt,
      isRunning: this.isRunning,
    };
  }

  public syncWorkspaceContext(context: AgentRunInput): void {
    this.latestContext = {
      ...context,
      existingHashes: Array.isArray(context.existingHashes) ? context.existingHashes : [],
    };
  }

  public updateSchedule(params: {
    enabled: boolean;
    intervalMinutes: number;
    context?: AgentRunInput;
  }): ServerScheduleState {
    if (params.context) {
      this.syncWorkspaceContext(params.context);
    }

    this.scheduleEnabled = Boolean(params.enabled);
    this.intervalMinutes = Math.min(Math.max(Math.round(params.intervalMinutes || 240), 1), 1440);

    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
    }

    if (this.scheduleEnabled) {
      const ms = this.intervalMinutes * 60 * 1000;
      this.nextRunAt = new Date(Date.now() + ms).toISOString();
      this.scheduleTimer = setInterval(() => {
        this.nextRunAt = new Date(Date.now() + ms).toISOString();
        void this.runScheduledTick();
      }, ms);
      this.scheduleTimer.unref?.();
    } else {
      this.nextRunAt = null;
    }

    const state = this.getScheduleState();
    this.broadcast('schedule:updated', state);
    return state;
  }

  private async runScheduledTick(): Promise<void> {
    if (!this.latestContext || this.isRunning) return;
    const enabledCount = this.latestContext.sources.filter((s) => s.enabled).length;
    const enabledCompanies = (this.latestContext.targetCompanies ?? []).filter((c) => c.enabled).length;
    const incompleteCount = (this.latestContext.incompleteJobs ?? []).length;
    if (enabledCount === 0 && enabledCompanies === 0 && incompleteCount === 0) return;

    try {
      await this.executeRun(this.latestContext, 'scheduled');
    } catch (err) {
      console.error('Scheduled agent run failed:', err);
      this.broadcast('agent:error', {
        trigger: 'scheduled',
        message: err instanceof Error ? err.message : 'Scheduled agent run failed.',
      });
    }
  }

  public async executeRun(
    input: AgentRunInput,
    trigger: 'manual' | 'scheduled'
  ): Promise<AgentRunOutput> {
    if (this.isRunning) {
      throw new Error('An agent run is already in progress. Please wait for it to finish.');
    }

    this.isRunning = true;
    this.broadcast('agent:started', {
      trigger,
      sourceCount:
        input.sources.filter((s) => s.enabled).length +
        (input.targetCompanies ?? []).filter((c) => c.enabled).length,
    });
    this.broadcast('schedule:updated', this.getScheduleState());

    try {
      const output = await runAgentPipeline(input);
      output.runReport.trigger = trigger;

      // Keep server-side dedup keys up to date immediately for subsequent scheduled runs
      if (this.latestContext) {
        const merged = new Set([
          ...this.latestContext.existingHashes,
          ...output.newJobs.flatMap((j) => buildJobDedupeKeys(j)),
        ]);
        this.latestContext.existingHashes = Array.from(merged);
      }

      this.broadcast('agent:completed', {
        trigger,
        newJobs: output.newJobs,
        enrichedJobs: output.enrichedJobs,
        checkedCompanyIds: output.checkedCompanyIds,
        runReport: output.runReport,
      });

      return output;
    } finally {
      this.isRunning = false;
      this.broadcast('schedule:updated', this.getScheduleState());
    }
  }
}

export const realtimeHub = new RealtimeAgentHub();
