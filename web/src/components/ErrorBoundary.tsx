import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; fallbackRoute?: boolean }
interface State { hasError: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
    // Auto-reload once on chunk load failure (stale deployment cache)
    if (error.message?.includes('Failed to fetch dynamically imported module')) {
      const reloaded = sessionStorage.getItem('chunk_reload');
      if (!reloaded) {
        sessionStorage.setItem('chunk_reload', '1');
        window.location.reload();
      }
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="text-center max-w-md">
          <h1 className="font-logo text-5xl text-navy mb-2">troika</h1>
          <p className="text-teal text-lg mb-6">music lessons</p>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <p className="text-coral text-lg font-semibold mb-2">Something went wrong</p>
            <p className="text-gray-500 text-sm mb-4">
              An unexpected error occurred. Please try again.
            </p>
            <button
              onClick={() => { this.setState({ hasError: false }); window.location.href = '/'; }}
              className="bg-coral text-white px-6 py-2.5 rounded-xl font-medium hover:bg-coral/90 transition-colors text-sm"
            >
              Return Home
            </button>
          </div>
        </div>
      </div>
    );
  }
}
