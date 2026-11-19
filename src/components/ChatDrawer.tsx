import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  MessageSquare,
  RotateCcw,
  X,
} from 'lucide-react';
import type { ChatMessage } from '../types/chat';

interface ChatDrawerProps {
  open: boolean;
  messages: ChatMessage[];
  isSending: boolean;
  error: string | null;
  onClose: () => void;
  onSendMessage: (text: string) => void;
  onResetChat: () => void;
}

const STARTER_PROMPTS = [
  'Raise my minimum salary to $200k and require fully remote roles.',
  'Hide the Solutions Architect role at Veridian — wrong role type.',
  'Review my recent likes and dislikes and suggest a sharper filter rule.',
  'Move Staff Distributed Systems Engineer at Veridian to Saved.',
];

export function ChatDrawer({
  open,
  messages,
  isSending,
  error,
  onClose,
  onSendMessage,
  onResetChat,
}: ChatDrawerProps) {
  const [input, setInput] = useState('');
  const threadEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      window.setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [open, messages.length, isSending]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isSending) return;
    setInput('');
    onSendMessage(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end pointer-events-none">
      {/* Backdrop on mobile/tablet; light click-through close on desktop */}
      <div
        className="fixed inset-0 bg-zinc-950/20 lg:bg-zinc-950/10 pointer-events-auto transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Search Assistant"
        className="relative z-50 pointer-events-auto w-full max-w-[440px] bg-white h-full border-l border-zinc-200 flex flex-col shadow-xl"
      >
        {/* Header */}
        <div className="px-5 h-14 border-b border-zinc-200 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <MessageSquare className="w-4 h-4 text-blue-600 shrink-0" />
            <h2 className="text-sm font-semibold text-zinc-950 truncate">
              Search Assistant
            </h2>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={onResetChat}
                title="Start a new conversation"
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded-md transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close search assistant"
              className="p-1.5 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-md transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Conversation Thread */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {messages.length === 0 ? (
            <div className="space-y-5 pt-2">
              <div className="space-y-1.5">
                <h3 className="text-sm font-semibold text-zinc-950">
                  Tune your job search in plain language
                </h3>
                <p className="text-xs leading-relaxed text-zinc-500">
                  Tell me what to change in your target criteria, add or pause filter rules, or give feedback on specific roles in your Inbox. Changes apply immediately to your workspace.
                </p>
              </div>

              <div className="space-y-2">
                <div className="text-[11px] font-medium text-zinc-400">
                  Try asking
                </div>
                <div className="space-y-1.5">
                  {STARTER_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => onSendMessage(prompt)}
                      disabled={isSending}
                      className="w-full text-left px-3 py-2.5 text-xs text-zinc-700 bg-zinc-50 hover:bg-zinc-100 border border-zinc-200/80 rounded-md transition-colors cursor-pointer leading-snug"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  msg.role === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1 text-[11px] text-zinc-400">
                  <span className="font-medium text-zinc-500">
                    {msg.role === 'user' ? 'You' : 'Meridian Assistant'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">{msg.timestamp}</span>
                </div>

                <div
                  className={`max-w-[90%] rounded-lg px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-zinc-900 text-white'
                      : 'bg-zinc-50 border border-zinc-200/90 text-zinc-800'
                  }`}
                >
                  {msg.text}
                </div>

                {msg.appliedSummaries && msg.appliedSummaries.length > 0 && (
                  <ul className="mt-2 max-w-[90%] space-y-1 text-[11.5px] text-emerald-700">
                    {msg.appliedSummaries.map((summary, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>{summary}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}

          {isSending && (
            <div className="flex flex-col items-start">
              <div className="mb-1 text-[11px] font-medium text-zinc-500">
                Meridian Assistant
              </div>
              <div className="bg-zinc-50 border border-zinc-200/90 rounded-lg px-3.5 py-2.5 text-xs text-zinc-500">
                Reviewing your workspace and drafting response...
              </div>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-md bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs text-red-700 leading-relaxed"
            >
              {error}
            </div>
          )}

          <div ref={threadEndRef} />
        </div>

        {/* Composer */}
        <form
          onSubmit={handleSubmit}
          className="p-4 border-t border-zinc-200 bg-white shrink-0"
        >
          <div className="flex items-end gap-2 bg-zinc-50 border border-zinc-200 rounded-lg p-2 focus-within:bg-white focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-600/15 transition-all">
            <textarea
              ref={textareaRef}
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Update criteria, give role feedback, or ask about your pipeline..."
              aria-label="Message Meridian Assistant"
              className="flex-1 resize-none bg-transparent text-xs leading-relaxed text-zinc-900 placeholder:text-zinc-400 focus:outline-none px-1 py-0.5 max-h-32"
            />
            <button
              type="submit"
              disabled={!input.trim() || isSending}
              aria-label="Send message"
              className="h-8 w-8 inline-flex items-center justify-center rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-200 disabled:text-zinc-400 text-white transition-colors shrink-0 cursor-pointer disabled:cursor-not-allowed"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-zinc-400 px-1">
            <span>Enter to send · Shift+Enter for new line</span>
          </div>
        </form>
      </aside>
    </div>
  );
}
