import React from "react";

type Props = { label?: string; children: React.ReactNode };
type State = { error: Error | null };

/**
 * Isolation boundary for a single dashboard widget. A render error inside one
 * tile shows a localized fallback and leaves the rest of the page intact.
 */
export class WidgetBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface in dev; production errors still report through the root reporter.
    console.error(`[widget:${this.props.label ?? "?"}]`, error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
          <div className="font-mono uppercase tracking-widest text-amber-600">
            widget offline{this.props.label ? ` · ${this.props.label}` : ""}
          </div>
          <div className="mt-1 text-muted-foreground">
            {this.state.error.message || "Rendering failed. Other tiles are unaffected."}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
