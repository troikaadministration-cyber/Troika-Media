import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { Toast, type ToastData } from '../components/Toast';

interface ToastContextValue {
  showToast: (type: 'success' | 'error', message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 0;

function friendlyMessage(reason: unknown): string | null {
  const msg = typeof reason === 'string' ? reason
    : reason && typeof reason === 'object' && 'message' in reason ? String((reason as { message: unknown }).message)
    : '';
  if (!msg) return 'Something went wrong. Please try again.';
  // Stale-deploy chunk errors are handled by a reload elsewhere; aborted requests are expected.
  if (/dynamically imported module|Importing a module script failed|AbortError|aborted/i.test(msg)) return null;
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Network error — check your connection and try again.';
  return msg;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    const id = `t${++nextId}`;
    setToasts((prev) => {
      // Don't stack identical messages (e.g. the same failure firing twice).
      if (prev.some((t) => t.type === type && t.message === message)) return prev;
      return [...prev.slice(-3), { id, type, message }];
    });
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Safety net: an action that fails without its own error handling still
  // tells the user, instead of silently doing nothing.
  useEffect(() => {
    function onRejection(e: PromiseRejectionEvent) {
      const msg = friendlyMessage(e.reason);
      if (msg) showToast('error', msg);
    }
    window.addEventListener('unhandledrejection', onRejection);
    return () => window.removeEventListener('unhandledrejection', onRejection);
  }, [showToast]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[100] space-y-2 sm:max-w-sm" aria-live="polite">
        {toasts.map((t) => (
          <Toast key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
