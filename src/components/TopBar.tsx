import React from 'react';
import { Menu, MessageSquare, RefreshCw, Upload } from 'lucide-react';
import { WorkspaceView } from '../types/job';

interface TopBarProps {
  activeView: WorkspaceView;
  isAgentRunning: boolean;
  chatOpen: boolean;
  chatMessageCount: number;
  onToggleChat: () => void;
  onOpenImport: () => void;
  onRunAgent: () => void;
  onOpenMobileMenu: () => void;
}

const VIEW_BREADCRUMB: Record<WorkspaceView, { section: string; page: string }> = {
  table: { section: 'Roles', page: 'Table' },
  kanban: { section: 'Roles', page: 'Kanban Board' },
  calendar: { section: 'Roles', page: 'Calendar' },
  sources: { section: 'Agent', page: 'Sources & Channels' },
  resumes: { section: 'Agent', page: 'Resumes & Cover Letters' },
  criteria: { section: 'Agent', page: 'Criteria & Feedback' },
  schema: { section: 'Architecture', page: 'Database Schema' },
};

export function TopBar({
  activeView,
  isAgentRunning,
  chatOpen,
  chatMessageCount,
  onToggleChat,
  onOpenImport,
  onRunAgent,
  onOpenMobileMenu,
}: TopBarProps) {
  const crumb = VIEW_BREADCRUMB[activeView];

  return (
    <header className="sticky top-0 z-20 h-14 bg-white/95 backdrop-blur-xs border-b border-zinc-200 px-4 sm:px-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Open navigation menu"
          className="lg:hidden p-2 -ml-2 text-zinc-600 hover:text-zinc-950 rounded-md cursor-pointer"
        >
          <Menu className="w-5 h-5" />
        </button>

        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm min-w-0">
          <span className="text-zinc-400 whitespace-nowrap shrink-0">Workspace</span>
          <span className="text-zinc-300" aria-hidden="true">
            /
          </span>
          <span className="text-zinc-500 whitespace-nowrap shrink-0 hidden sm:inline">
            {crumb.section}
          </span>
          <span className="text-zinc-300 hidden sm:inline" aria-hidden="true">
            /
          </span>
          <span className="font-medium text-zinc-950 truncate">{crumb.page}</span>
        </nav>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onOpenImport}
          className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 hover:border-zinc-300 rounded-md transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 cursor-pointer"
        >
          <Upload className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
          <span>Import</span>
        </button>

        <button
          type="button"
          onClick={onToggleChat}
          aria-expanded={chatOpen}
          className={`inline-flex items-center gap-2 px-3 py-2 text-[13px] font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 cursor-pointer ${
            chatOpen
              ? 'bg-zinc-900 text-white border-zinc-900'
              : 'bg-white text-zinc-800 border-zinc-200 hover:bg-zinc-50 hover:border-zinc-300'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5 shrink-0" />
          <span>Assistant</span>
          {chatMessageCount > 0 && (
            <span
              className={`font-mono text-[11px] tabular-nums ${
                chatOpen ? 'text-zinc-300' : 'text-zinc-400'
              }`}
            >
              {chatMessageCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={onRunAgent}
          disabled={isAgentRunning}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-[13px] font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-md transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 cursor-pointer disabled:cursor-wait"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isAgentRunning ? 'animate-spin' : ''}`} />
          <span>{isAgentRunning ? 'Running Agent...' : 'Run Agent Now'}</span>
        </button>
      </div>
    </header>
  );
}
