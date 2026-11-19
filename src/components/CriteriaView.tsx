import React, { useEffect, useState } from 'react';
import {
  Check,
  MessageSquare,
  Plus,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import {
  AiRuleSuggestion,
  FeedbackEntry,
  LearnedRule,
  PreferenceSynthesisResult,
  RuleSuggestion,
} from '../types/job';

interface CriteriaViewProps {
  searchPrompt: string;
  onSavePrompt: (nextPrompt: string) => void;
  rules: LearnedRule[];
  onAddRule: (text: string) => void;
  onToggleRule: (ruleId: string) => void;
  onDeleteRule: (ruleId: string) => void;
  suggestions: RuleSuggestion[];
  onAcceptSuggestion: (suggestion: RuleSuggestion) => void;
  onDismissSuggestion: (suggestionId: string) => void;
  aiSynthesis: PreferenceSynthesisResult | null;
  isSynthesizing: boolean;
  onRunSynthesis: () => void;
  onAcceptAiSuggestion: (suggestion: AiRuleSuggestion) => void;
  onDismissAiSuggestion: (suggestionId: string) => void;
  isRescoring: boolean;
  onRescoreActiveJobs: () => void;
  feedbackHistory: FeedbackEntry[];
  onOpenChat: () => void;
}

export function CriteriaView({
  searchPrompt,
  onSavePrompt,
  rules,
  onAddRule,
  onToggleRule,
  onDeleteRule,
  suggestions,
  onAcceptSuggestion,
  onDismissSuggestion,
  aiSynthesis,
  isSynthesizing,
  onRunSynthesis,
  onAcceptAiSuggestion,
  onDismissAiSuggestion,
  isRescoring,
  onRescoreActiveJobs,
  feedbackHistory,
  onOpenChat,
}: CriteriaViewProps) {
  const [draftPrompt, setDraftPrompt] = useState(searchPrompt);
  const [savedNotice, setSavedNotice] = useState(false);
  const [newRuleText, setNewRuleText] = useState('');

  useEffect(() => {
    setDraftPrompt(searchPrompt);
  }, [searchPrompt]);

  const activePatternSuggestions = suggestions.filter((s) => !s.dismissed);
  const activeAiSuggestions = (aiSynthesis?.suggestions ?? []).filter(
    (s) => !s.dismissed
  );
  const likes = feedbackHistory.filter((f) => f.vote === 'up');
  const dislikes = feedbackHistory.filter((f) => f.vote === 'down');

  const handleSavePrompt = (e: React.FormEvent) => {
    e.preventDefault();
    onSavePrompt(draftPrompt.trim());
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 2000);
  };

  const handleAddRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleText.trim()) return;
    onAddRule(newRuleText.trim());
    setNewRuleText('');
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950">
            Criteria &amp; Preference Memory
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Your recent thumbs-up and thumbs-down triage votes are injected into Gemini scoring and periodically synthesized into filter rule updates.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onRescoreActiveJobs}
            disabled={isRescoring}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 disabled:text-zinc-400 rounded-md transition-colors whitespace-nowrap cursor-pointer disabled:cursor-wait"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRescoring ? 'animate-spin' : ''}`} />
            <span>{isRescoring ? 'Re-scoring...' : 'Re-score Active Roles'}</span>
          </button>
          <button
            type="button"
            onClick={onOpenChat}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md transition-colors whitespace-nowrap cursor-pointer"
          >
            <MessageSquare className="w-3.5 h-3.5 text-blue-600" />
            <span>Refine with Assistant</span>
          </button>
        </div>
      </div>

      {/* Stage 2: Learned Preference Profile & AI Rule Synthesis */}
      <section className="bg-white border border-zinc-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-950">
              Learned Preference Synthesis
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Gemini analyzes your rolling likes and dislikes to summarize your taste and suggest explicit rules.
              {aiSynthesis?.synthesizedAt && (
                <span className="ml-1.5 font-mono text-zinc-400">
                  Updated {aiSynthesis.synthesizedAt}
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onRunSynthesis}
            disabled={isSynthesizing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-400 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-wait self-start sm:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSynthesizing ? 'animate-spin' : ''}`} />
            <span>{isSynthesizing ? 'Analyzing Feedback...' : 'Synthesize from Feedback'}</span>
          </button>
        </div>

        {aiSynthesis?.preferenceSummary && (
          <div className="text-sm leading-relaxed text-zinc-700 bg-zinc-50 border border-zinc-200/80 rounded-md px-4 py-3">
            {aiSynthesis.preferenceSummary}
          </div>
        )}

        {/* AI-synthesized rule proposals */}
        {activeAiSuggestions.length > 0 && (
          <div className="space-y-2.5 pt-1">
            {activeAiSuggestions.map((sug) => (
              <div
                key={sug.id}
                className="bg-amber-50/60 border border-amber-200 rounded-md p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="text-xs font-semibold text-amber-900">
                    Suggested Rule · {sug.evidenceCount}{' '}
                    {sug.evidenceCount === 1 ? 'signal' : 'signals'}
                  </div>
                  <div className="text-sm font-medium text-zinc-900">
                    {sug.proposedRule}
                  </div>
                  <p className="text-xs text-zinc-600">{sug.rationale}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onAcceptAiSuggestion(sug)}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-md transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Accept Rule
                  </button>
                  <button
                    type="button"
                    onClick={() => onDismissAiSuggestion(sug.id)}
                    className="px-3 py-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-950 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Deterministic pattern-based rule suggestions from repeated dislike reasons */}
        {activePatternSuggestions.length > 0 && (
          <div className="space-y-2.5 pt-1">
            {activePatternSuggestions.map((suggestion) => (
              <div
                key={suggestion.id}
                className="bg-amber-50/60 border border-amber-200 rounded-md p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="text-xs font-semibold text-amber-900">
                    Repeated Downvote Pattern · {suggestion.count} recent downvotes
                  </div>
                  <div className="text-sm font-medium text-zinc-900">
                    {suggestion.proposedRule}
                  </div>
                  <p className="text-xs text-zinc-600">{suggestion.summary}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onAcceptSuggestion(suggestion)}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-md transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Accept Rule
                  </button>
                  <button
                    type="button"
                    onClick={() => onDismissSuggestion(suggestion.id)}
                    className="px-3 py-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-950 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Explicit Criteria Prompt */}
      <form
        onSubmit={handleSavePrompt}
        className="bg-white border border-zinc-200 rounded-lg p-5 space-y-3"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-950">Target Role Prompt</h2>
            <p className="text-xs text-zinc-500">
              Plain-English criteria evaluated on every brand-new posting and whenever you re-score roles.
            </p>
          </div>
          {savedNotice && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
              <Check className="w-3.5 h-3.5" />
              Saved
            </span>
          )}
        </div>

        <textarea
          rows={3}
          value={draftPrompt}
          onChange={(e) => setDraftPrompt(e.target.value)}
          className="w-full p-3 text-sm leading-relaxed bg-white border border-zinc-200 rounded-md text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
        />

        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-zinc-400">
            Synced automatically with scheduled server agent runs.
          </span>
          <button
            type="submit"
            disabled={draftPrompt.trim() === searchPrompt.trim()}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-200 disabled:text-zinc-500 rounded-md transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            Save Criteria
          </button>
        </div>
      </form>

      {/* Active Rules + Feedback Memory split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Explicit & Synthesized Filter Rules */}
        <section className="lg:col-span-5 bg-white border border-zinc-200 rounded-lg divide-y divide-zinc-200">
          <div className="p-4">
            <h2 className="text-sm font-semibold text-zinc-950">Active Filter Rules</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Hard preferences combined with your main prompt.
            </p>
          </div>

          <ul className="divide-y divide-zinc-100">
            {rules.map((rule) => (
              <li key={rule.id} className="p-3.5 flex items-start justify-between gap-3">
                <label className="flex items-start gap-2.5 cursor-pointer flex-1 min-w-0">
                  <input
                    type="checkbox"
                    checked={rule.active}
                    onChange={() => onToggleRule(rule.id)}
                    className="mt-0.5 rounded border-zinc-300 text-blue-600 focus:ring-blue-600"
                  />
                  <span className="min-w-0">
                    <span
                      className={`block text-[13px] leading-snug ${
                        rule.active ? 'text-zinc-900' : 'text-zinc-400 line-through'
                      }`}
                    >
                      {rule.text}
                    </span>
                    <span className="text-[11px] text-zinc-400">
                      {rule.origin === 'synthesized' ? 'Learned from feedback' : 'Manual rule'}
                    </span>
                  </span>
                </label>

                <button
                  type="button"
                  onClick={() => onDeleteRule(rule.id)}
                  aria-label={`Delete rule: ${rule.text}`}
                  className="p-1 text-zinc-400 hover:text-red-600 rounded cursor-pointer shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>

          <form onSubmit={handleAddRule} className="p-3.5 bg-zinc-50/50 flex items-center gap-2">
            <input
              type="text"
              value={newRuleText}
              onChange={(e) => setNewRuleText(e.target.value)}
              placeholder="Add explicit rule (e.g., Exclude >10% travel)"
              className="flex-1 h-8 px-2.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1 h-8 px-3 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-100 rounded-md cursor-pointer shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </form>
        </section>

        {/* Rolling Few-Shot Feedback Memory */}
        <section className="lg:col-span-7 bg-white border border-zinc-200 rounded-lg divide-y divide-zinc-200">
          <div className="p-4 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-zinc-950">
                Rolling Feedback Memory
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                Last 15 likes and 15 dislikes injected as few-shot examples during Gemini scoring.
              </p>
            </div>
            <div className="text-xs font-mono tabular-nums text-zinc-500 shrink-0">
              <span className="text-emerald-700 font-medium">{likes.length} up</span>
              <span className="mx-1.5 text-zinc-300">·</span>
              <span className="text-red-700 font-medium">{dislikes.length} down</span>
            </div>
          </div>

          <div className="divide-y divide-zinc-100 max-h-[380px] overflow-y-auto">
            {feedbackHistory.length === 0 ? (
              <p className="p-6 text-xs text-zinc-500 text-center">
                No feedback logged yet. Use 👍 or 👎 on roles in Table or Kanban view to train the agent.
              </p>
            ) : (
              feedbackHistory.map((entry) => (
                <div
                  key={entry.id}
                  className="px-4 py-3 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    {entry.vote === 'up' ? (
                      <ThumbsUp className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                    ) : (
                      <ThumbsDown className="w-3.5 h-3.5 text-red-600 mt-0.5 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium text-zinc-900 truncate">
                        {entry.jobTitle}
                      </div>
                      <div className="mt-0.5 text-zinc-500 flex items-center gap-1.5">
                        <span>{entry.company}</span>
                        {entry.reason && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-red-600 font-medium">
                              Reason: {entry.reason}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <span className="font-mono text-[11px] text-zinc-400 tabular-nums shrink-0">
                    {entry.createdAt}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
