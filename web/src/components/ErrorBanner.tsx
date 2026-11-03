import { AlertCircle, RefreshCw } from 'lucide-react';

/** Inline "couldn't load" message with a retry button. */
export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 bg-coral-light border border-coral/20 text-sm rounded-xl px-4 py-3">
      <AlertCircle size={18} className="text-coral flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-navy">Couldn&rsquo;t load this data</p>
        <p className="text-gray-600 text-xs mt-0.5 break-words">{message}</p>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="flex items-center gap-1.5 text-xs font-semibold text-teal hover:underline flex-shrink-0">
          <RefreshCw size={13} /> Retry
        </button>
      )}
    </div>
  );
}
