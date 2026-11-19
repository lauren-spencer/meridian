import React from 'react';
import {
  Calendar,
  Columns3,
  Database,
  FileText,
  Globe,
  LogIn,
  LogOut,
  MessageSquare,
  SlidersHorizontal,
  Table2,
  Upload,
  UserCheck,
  X,
} from 'lucide-react';
import { WorkspaceView } from '../types/job';

interface SidebarProps {
  activeView: WorkspaceView;
  onSelectView: (view: WorkspaceView) => void;
  newCount: number;
  activePipelineCount: number;
  sourceCount: number;
  resumeCount: number;
  pendingRuleSuggestions: number;
  lastRunLabel: string;
  chatOpen: boolean;
  chatMessageCount: number;
  onOpenChat: () => void;
  onOpenIntake: () => void;
  onOpenImport: () => void;
  userEmail: string | null;
  userDisplayName: string | null;
  onSignIn: () => void;
  onSignOut: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({
  activeView,
  onSelectView,
  newCount,
  activePipelineCount,
  sourceCount,
  resumeCount,
  pendingRuleSuggestions,
  lastRunLabel,
  chatOpen,
  chatMessageCount,
  onOpenChat,
  onOpenIntake,
  onOpenImport,
  userEmail,
  userDisplayName,
  onSignIn,
  onSignOut,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const workspaceNav: {
    id: WorkspaceView;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    meta?: string;
  }[] = [
    {
      id: 'table',
      label: 'Table',
      icon: Table2,
      meta: newCount > 0 ? `${newCount} new` : `${activePipelineCount}`,
    },
    {
      id: 'kanban',
      label: 'Kanban',
      icon: Columns3,
      meta: `${activePipelineCount}`,
    },
    {
      id: 'calendar',
      label: 'Calendar',
      icon: Calendar,
    },
  ];

  const configNav: {
    id: WorkspaceView;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    meta?: string;
  }[] = [
    {
      id: 'sources',
      label: 'Sources & Channels',
      icon: Globe,
      meta: `${sourceCount}`,
    },
    {
      id: 'resumes',
      label: 'Resumes & Context',
      icon: FileText,
      meta: resumeCount > 0 ? `${resumeCount}` : undefined,
    },
    {
      id: 'criteria',
      label: 'Criteria & Feedback',
      icon: SlidersHorizontal,
      meta: pendingRuleSuggestions > 0 ? `${pendingRuleSuggestions} tip` : undefined,
    },
    {
      id: 'schema',
      label: 'Database Schema',
      icon: Database,
    },
  ];

  const handleNavClick = (view: WorkspaceView) => {
    onSelectView(view);
    onCloseMobile();
  };

  const sidebarContent = (
    <div className="flex h-full flex-col bg-white border-r border-zinc-200 select-none">
      {/* Brand header: clean single-element wordmark */}
      <div className="flex items-center justify-between h-14 px-5 border-b border-zinc-200 shrink-0">
        <button
          type="button"
          onClick={() => handleNavClick('table')}
          className="text-[17px] font-bold tracking-tight text-zinc-950 font-[var(--font-display)] whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded-sm cursor-pointer"
        >
          Meridian
        </button>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation menu"
          className="lg:hidden p-1.5 text-zinc-500 hover:text-zinc-900 rounded-md cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Navigation sections */}
      <nav className="flex-1 overflow-y-auto px-3 py-5 space-y-6" aria-label="Workspace navigation">
        <div>
          <div className="px-2.5 mb-2 text-[11px] font-medium text-zinc-500">
            Views
          </div>
          <ul className="space-y-0.5">
            {workspaceNav.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => handleNavClick(item.id)}
                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-[13.5px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      isActive
                        ? 'bg-zinc-100 text-zinc-950'
                        : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          isActive ? 'text-blue-600' : 'text-zinc-400'
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {item.meta && (
                      <span
                        className={`text-xs font-mono tabular-nums shrink-0 ${
                          item.id === 'table' && newCount > 0
                            ? 'text-blue-600 font-medium'
                            : 'text-zinc-400'
                        }`}
                      >
                        {item.meta}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="border-t border-zinc-100 pt-5">
          <div className="px-2.5 mb-2 text-[11px] font-medium text-zinc-500">
            Agent Configuration
          </div>
          <ul className="space-y-0.5">
            {configNav.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => handleNavClick(item.id)}
                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-[13.5px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      isActive
                        ? 'bg-zinc-100 text-zinc-950'
                        : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          isActive ? 'text-blue-600' : 'text-zinc-400'
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {item.meta && (
                      <span
                        className={`text-xs font-mono tabular-nums shrink-0 ${
                          item.id === 'criteria' && pendingRuleSuggestions > 0
                            ? 'text-amber-600 font-medium'
                            : 'text-zinc-400'
                        }`}
                      >
                        {item.meta}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="border-t border-zinc-100 pt-5 space-y-0.5">
          <div className="px-2.5 mb-2 text-[11px] font-medium text-zinc-500">
            Workspace Tools
          </div>
          <button
            type="button"
            onClick={() => {
              onOpenChat();
              onCloseMobile();
            }}
            className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-[13.5px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
              chatOpen
                ? 'bg-blue-50 text-blue-700'
                : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
            }`}
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <MessageSquare
                className={`w-4 h-4 shrink-0 ${
                  chatOpen ? 'text-blue-600' : 'text-zinc-400'
                }`}
              />
              <span className="truncate">Search Assistant</span>
            </span>
            {chatMessageCount > 0 && (
              <span className="text-xs font-mono tabular-nums text-zinc-400 shrink-0">
                {chatMessageCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              onOpenImport();
              onCloseMobile();
            }}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13.5px] font-medium text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Upload className="w-4 h-4 shrink-0 text-zinc-400" />
            <span className="truncate">Import &amp; Map Roles</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onOpenIntake();
              onCloseMobile();
            }}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13.5px] font-medium text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-colors whitespace-nowrap cursor-pointer"
          >
            <UserCheck className="w-4 h-4 shrink-0 text-zinc-400" />
            <span className="truncate">Edit Intake Setup</span>
          </button>
        </div>
      </nav>

      {/* Account & schedule metadata footer */}
      <div className="px-4 py-3.5 border-t border-zinc-200 text-xs space-y-3">
        {userEmail ? (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium text-zinc-900 truncate">
                {userDisplayName || 'Signed in'}
              </div>
              <div className="text-[11px] font-mono text-zinc-500 truncate">
                {userEmail}
              </div>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              title="Sign out"
              aria-label="Sign out"
              className="p-1.5 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-md shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onSignIn}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-800 bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 rounded-md transition-colors cursor-pointer"
          >
            <LogIn className="w-3.5 h-3.5 text-zinc-500" />
            <span>Sign in with Google</span>
          </button>
        )}

        <div className="pt-2 border-t border-zinc-100 text-zinc-500 space-y-1">
          <div className="flex items-center justify-between">
            <span>Last pull</span>
            <span className="font-mono tabular-nums text-zinc-700">{lastRunLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop static sidebar */}
      <aside className="hidden lg:block w-[248px] shrink-0 h-screen sticky top-0">
        {sidebarContent}
      </aside>

      {/* Mobile slide-over sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-zinc-950/30 transition-opacity"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-50 w-[264px] max-w-[82vw] h-full">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
