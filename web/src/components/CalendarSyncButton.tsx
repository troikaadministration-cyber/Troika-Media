import { useEffect, useRef, useState } from 'react';
import { CalendarPlus, Copy, Check, X, RefreshCw, ShieldAlert } from 'lucide-react';
import { supabase } from '../lib/supabase';

/**
 * "Sync to calendar": shows the user's private iCalendar feed URL
 * (calendar-feed edge function + secret token) with one-tap subscribe links
 * for Apple / Google Calendar, a copy button and a reset (rotate) action.
 */

const FN_BASE = `${(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')}/functions/v1/calendar-feed`;

function feedUrl(token: string) {
  return `${FN_BASE}?token=${encodeURIComponent(token)}`;
}

function errMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return 'Something went wrong. Please try again.';
}

export function CalendarSyncButton({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium text-navy hover:bg-gray-50 transition-colors ${className}`}
      >
        <CalendarPlus size={16} className="text-teal" />
        Sync to calendar
      </button>
      {open && <CalendarSyncModal onClose={() => setOpen(false)} />}
    </>
  );
}

function CalendarSyncModal({ onClose }: { onClose: () => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: rpcError } = await supabase.rpc('get_calendar_token');
      if (cancelled) return;
      if (rpcError || typeof data !== 'string') setError(rpcError ? errMessage(rpcError) : 'Could not load your calendar link.');
      else setToken(data);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const url = token ? feedUrl(token) : '';
  const webcalUrl = url.replace(/^https?:\/\//, 'webcal://');
  const googleUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API unavailable (e.g. insecure context): select for manual copy.
      inputRef.current?.select();
      document.execCommand?.('copy');
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  async function reset() {
    setResetting(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('reset_calendar_token');
    setResetting(false);
    setConfirmReset(false);
    if (rpcError || typeof data !== 'string') {
      setError(rpcError ? errMessage(rpcError) : 'Could not reset your calendar link.');
      return;
    }
    setToken(data);
    setResetDone(true);
    setCopied(false);
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-sync-title"
        className="bg-white rounded-2xl border border-black/5 shadow-lg w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="calendar-sync-title" className="font-semibold text-navy text-lg">Sync to your calendar</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Subscribe once and your lessons show up in Google Calendar, Apple Calendar or Outlook — and stay up to date.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="h-10 rounded-lg bg-gray-100 animate-pulse" />
        ) : !token ? (
          <p className="text-sm text-coral bg-coral-light rounded-lg px-3 py-2">{error || 'Could not load your calendar link.'}</p>
        ) : (
          <>
            <div className="space-y-1.5">
              <label htmlFor="calendar-feed-url" className="text-xs font-medium text-gray-500">Your private calendar link</label>
              <div className="flex gap-2">
                <input
                  id="calendar-feed-url"
                  ref={inputRef}
                  readOnly
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-xs text-navy font-mono"
                />
                <button
                  type="button"
                  onClick={copy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-teal text-white text-sm font-medium hover:bg-teal/90 flex-shrink-0"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              {resetDone && (
                <p className="text-xs text-teal">New link created. Your old link no longer works — re-add this one to your calendar.</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <a
                href={webcalUrl}
                className="text-center px-3 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-navy hover:bg-gray-50"
              >
                Add to Apple Calendar / iPhone
              </a>
              <a
                href={googleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-center px-3 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-navy hover:bg-gray-50"
              >
                Add to Google Calendar
              </a>
            </div>

            <ul className="text-xs text-gray-500 space-y-1 list-disc pl-4">
              <li><strong className="text-gray-600">iPhone / Mac:</strong> tap “Add to Apple Calendar”, then Subscribe.</li>
              <li><strong className="text-gray-600">Google Calendar:</strong> tap “Add to Google Calendar” (or Settings → Add calendar → From URL and paste the link). Google can take a few hours to refresh.</li>
              <li><strong className="text-gray-600">Outlook:</strong> Add calendar → Subscribe from web, then paste the link.</li>
              <li>Shows lessons from the last 60 days and the next 6 months. Cancelled lessons are marked as cancelled.</li>
            </ul>

            <div className="flex gap-2 items-start text-xs text-yellow bg-yellow-light rounded-lg px-3 py-2">
              <ShieldAlert size={14} className="flex-shrink-0 mt-0.5" />
              <span>Anyone with this link can see your lesson times — don’t share it. If it gets out, reset it below.</span>
            </div>

            {error && <p className="text-sm text-coral">{error}</p>}

            <div className="pt-1 border-t border-black/5">
              {confirmReset ? (
                <div className="space-y-2 pt-3">
                  <p className="text-sm text-gray-600">
                    Reset your link? The current link will <strong>stop working</strong> in every calendar it was added to. You’ll need to add the new link again.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmReset(false)}
                      disabled={resetting}
                      className="flex-1 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={reset}
                      disabled={resetting}
                      className="flex-1 py-2 rounded-lg bg-coral text-white text-sm font-medium hover:bg-coral/90 disabled:opacity-60"
                    >
                      {resetting ? 'Resetting…' : 'Reset link'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmReset(true)}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-coral"
                >
                  <RefreshCw size={12} />
                  Reset link
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
