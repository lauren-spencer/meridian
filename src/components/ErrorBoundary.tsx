import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
  isQuotaError: boolean;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '', isQuotaError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let message = error.message || 'An unexpected application error occurred.';
    let isQuotaError = false;

    try {
      const parsed = JSON.parse(error.message) as {
        error?: string;
        operationType?: string;
        path?: string;
      };
      if (parsed?.error) {
        if (parsed.error.toLowerCase().includes('quota exceeded')) {
          isQuotaError = true;
          message =
            'Daily database quota has been reached. Quota resets tomorrow, or you can review your plan limits in the Firebase console.';
        } else if (parsed.error.toLowerCase().includes('permission')) {
          message =
            'Your session does not have permission for this workspace action. Try signing out and signing back in with a verified Google account.';
        } else {
          message = parsed.error;
        }
      }
    } catch {
      // Standard non-JSON Error
    }

    return { hasError: true, message, isQuotaError };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Meridian ErrorBoundary caught:', error, info);
  }

  handleReload = (): void => {
    this.setState({ hasError: false, message: '', isQuotaError: false });
    window.location.reload();
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-zinc-200 rounded-lg p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h1 className="text-base font-semibold text-zinc-950">
                  {this.state.isQuotaError
                    ? 'Workspace Storage Limit Reached'
                    : 'Something went wrong'}
                </h1>
                <p className="text-xs text-zinc-600 leading-relaxed">
                  {this.state.message}
                </p>
              </div>
            </div>
            <div className="pt-2 border-t border-zinc-100 flex justify-end">
              <button
                type="button"
                onClick={this.handleReload}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reload Workspace</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
