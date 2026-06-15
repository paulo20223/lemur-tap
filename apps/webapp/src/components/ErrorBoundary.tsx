/**
 * Route-level error boundary. A crash inside any screen (e.g. a WebGL/render
 * failure) is contained here and shown as a recoverable card instead of
 * white-screening the whole app. The bottom navigation stays mounted, so the
 * user can switch to another screen; "Try again" remounts the failed subtree.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useT } from '../i18n';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Functional fallback so it can read the i18n context — the boundary itself must
 * stay a class (getDerivedStateFromError), and lives below <I18nProvider>.
 */
function CrashFallback({ message, onReset }: { message: string; onReset: () => void }) {
  const t = useT();
  return (
    <div className="boot boot--error">
      <div className="boot__title">{t('errorBoundary.title')}</div>
      <div className="boot__msg">{message}</div>
      <button className="btn" onClick={onReset}>
        {t('errorBoundary.tryAgain')}
      </button>
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] screen crashed', error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <CrashFallback message={this.state.error.message} onReset={this.reset} />
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
