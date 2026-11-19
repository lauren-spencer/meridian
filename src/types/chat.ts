import { DislikeReason, PipelineStage } from './job';

export type ChatActionType =
  | 'update_criteria_prompt'
  | 'add_rule'
  | 'remove_rule'
  | 'toggle_rule'
  | 'log_feedback'
  | 'move_job_stage';

export interface ChatAction {
  type: ChatActionType;
  prompt?: string;
  ruleText?: string;
  ruleId?: string;
  active?: boolean;
  jobId?: string;
  vote?: 'up' | 'down';
  reason?: DislikeReason;
  stage?: PipelineStage;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
  appliedSummaries?: string[];
}

export interface WorkspaceChatContext {
  searchPrompt: string;
  rules: {
    id: string;
    text: string;
    origin: 'manual' | 'synthesized';
    active: boolean;
  }[];
  jobs: {
    id: string;
    title: string;
    company: string;
    stage: PipelineStage;
    isNew: boolean;
    matchScore: number;
    salaryLabel: string;
    locationType: string;
    location: string;
  }[];
  recentFeedback: {
    jobTitle: string;
    company: string;
    vote: 'up' | 'down';
    reason?: DislikeReason;
  }[];
}

export interface ChatApiResponse {
  reply: string;
  actions: ChatAction[];
}
