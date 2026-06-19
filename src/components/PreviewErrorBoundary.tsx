"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface PreviewErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
}

interface PreviewErrorBoundaryState {
  hasError: boolean;
}

export class PreviewErrorBoundary extends Component<
  PreviewErrorBoundaryProps,
  PreviewErrorBoundaryState
> {
  state: PreviewErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): PreviewErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Preview panel error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-[var(--muted)]">
            Preview panel encountered an error. This can happen when loading incomplete game
            files during generation.
          </p>
          <button
            type="button"
            className="btn-ghost text-xs px-3 py-1.5"
            onClick={() => {
              this.setState({ hasError: false });
              this.props.onReset?.();
            }}
          >
            Retry preview
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
