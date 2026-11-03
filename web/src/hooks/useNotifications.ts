import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery, unwrap, setQueryData } from '../lib/queryCache';
import { useToast } from '../contexts/ToastContext';
import type { Notification } from '../types';

const MAX_NOTIFICATIONS = 30;

export function useNotifications(userId?: string) {
  const key = userId ? `notifications:${userId}` : null;
  const { showToast } = useToast();

  const { data, loading, error, refresh } = useQuery<Notification[]>(key, async () =>
    unwrap(await supabase
      .from('notifications')
      .select('id, user_id, type, title, body, read, created_at')
      .eq('user_id', userId!)
      .order('created_at', { ascending: false })
      .limit(MAX_NOTIFICATIONS), []) as Notification[],
  { staleTime: 30_000 });

  // Live inserts go straight into the cache. The channel name is unique per
  // subscription: reusing a fixed name (StrictMode remount, two consumers)
  // makes supabase-js hand back the same, already-joined channel.
  useEffect(() => {
    if (!userId || !key) return;
    const channel = supabase
      .channel(`notifications-${userId}-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as Notification;
          setQueryData<Notification[]>(key, (prev = []) =>
            prev.some((p) => p.id === n.id) ? prev : [n, ...prev].slice(0, MAX_NOTIFICATIONS));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, key]);

  const notifications = data ?? [];
  const unreadCount = notifications.filter((n) => !n.read).length;

  /** Optimistically mark read; roll back (and tell the user) if the write fails. */
  async function applyRead(ids: Set<string>, write: () => PromiseLike<{ error: { message: string } | null }>) {
    if (!key || ids.size === 0) return;
    setQueryData<Notification[]>(key, (prev = []) => prev.map((n) => (ids.has(n.id) ? { ...n, read: true } : n)));
    const { error: err } = await write();
    if (err) {
      setQueryData<Notification[]>(key, (prev = []) => prev.map((n) => (ids.has(n.id) ? { ...n, read: false } : n)));
      showToast('error', `Couldn't mark as read: ${err.message}`);
    }
  }

  function markRead(id: string) {
    const n = notifications.find((x) => x.id === id);
    if (!n || n.read) return Promise.resolve();
    return applyRead(new Set([id]), () => supabase.from('notifications').update({ read: true }).eq('id', id));
  }

  function markAllRead() {
    if (!userId) return Promise.resolve();
    const ids = new Set(notifications.filter((n) => !n.read).map((n) => n.id));
    return applyRead(ids, () =>
      supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false));
  }

  return { notifications, unreadCount, loading, error, markRead, markAllRead, refresh };
}
