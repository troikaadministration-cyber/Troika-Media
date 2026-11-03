import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * Tiny stale-while-revalidate cache for page data.
 *
 * - Revisiting a page renders the last result instantly, then refetches in the
 *   background (no skeleton flash on every navigation).
 * - Identical concurrent requests are de-duplicated.
 * - `refresh()` always fetches fresh data and only the newest response wins,
 *   so a refresh after a mutation can't be overwritten by an older request.
 * - `clearQueryCache()` wipes everything (called on sign-out so one user's data
 *   never shows for the next user on a shared device).
 */

interface Snapshot {
  data: unknown;
  error: string | null;
  /** True while any request for this key is in flight. */
  fetching: boolean;
}

interface Entry {
  snapshot: Snapshot;
  updatedAt: number; // 0 = never loaded / invalidated
  seq: number;
  inflight: Promise<void> | null;
  listeners: Set<() => void>;
  lastUsed: number;
  /** Most recent fetcher registered by a mounted hook (used by invalidation). */
  fetcher: (() => Promise<unknown>) | null;
}

const MAX_ENTRIES = 300;
const store = new Map<string, Entry>();
let generation = 0;

const EMPTY: Snapshot = { data: undefined, error: null, fetching: false };

function getEntry(key: string): Entry {
  let e = store.get(key);
  if (!e) {
    e = { snapshot: EMPTY, updatedAt: 0, seq: 0, inflight: null, listeners: new Set(), lastUsed: Date.now(), fetcher: null };
    store.set(key, e);
    evict();
  }
  e.lastUsed = Date.now();
  return e;
}

function evict() {
  if (store.size <= MAX_ENTRIES) return;
  const idle = [...store.entries()]
    .filter(([, e]) => e.listeners.size === 0 && !e.inflight)
    .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  for (const [k] of idle.slice(0, store.size - MAX_ENTRIES)) store.delete(k);
}

function update(e: Entry, patch: Partial<Snapshot>) {
  e.snapshot = { ...e.snapshot, ...patch };
  e.listeners.forEach((l) => l());
}

export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (!err) return fallback;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message || fallback;
  }
  return fallback;
}

/** Fetch (or join an in-flight fetch for) `key`. `force` always starts a new request. */
export function fetchQuery<T>(key: string, fetcher: () => Promise<T>, force = false): Promise<void> {
  const e = getEntry(key);
  if (e.inflight && !force) return e.inflight;

  const gen = generation;
  const mySeq = ++e.seq;
  if (!e.snapshot.fetching) update(e, { fetching: true });

  const p = (async () => {
    try {
      const data = await fetcher();
      if (gen !== generation || mySeq !== e.seq) return;
      e.updatedAt = Date.now();
      update(e, { data, error: null });
    } catch (err) {
      if (gen !== generation || mySeq !== e.seq) return;
      update(e, { error: errorMessage(err, 'Failed to load data') });
    } finally {
      if (gen === generation && mySeq === e.seq) {
        e.inflight = null;
        update(e, { fetching: false });
      }
    }
  })();
  e.inflight = p;
  return p;
}

/** Locally replace cached data for a key (optimistic updates). */
export function setQueryData<T>(key: string, updater: (prev: T | undefined) => T) {
  const e = getEntry(key);
  update(e, { data: updater(e.snapshot.data as T | undefined) });
}

/**
 * Mark every key starting with `prefix` stale; mounted ones refetch now.
 * Resolves when those refetches finish.
 */
export function invalidateQueries(prefix: string): Promise<void> {
  const pending: Promise<void>[] = [];
  for (const [key, e] of store) {
    if (!key.startsWith(prefix)) continue;
    e.updatedAt = 0;
    if (e.listeners.size > 0 && e.fetcher) pending.push(fetchQuery(key, e.fetcher, true));
  }
  return Promise.all(pending).then(() => undefined);
}

/** Wipe all cached data (sign-out). In-flight responses are discarded. */
export function clearQueryCache() {
  generation++;
  for (const e of store.values()) {
    e.updatedAt = 0;
    e.inflight = null;
    e.seq++;
    update(e, EMPTY);
  }
}

export interface QueryResult<T> {
  data: T | undefined;
  error: string | null;
  /** True only until the first result arrives (show skeletons). */
  loading: boolean;
  /** True whenever a request is in flight (including background refreshes). */
  fetching: boolean;
  /** Fetch fresh data; resolves when the newest data is in the cache. */
  refresh: () => Promise<void>;
}

/**
 * Subscribe to cached data for `key`. Pass `null` as the key to disable
 * (e.g. while a required id isn't known yet).
 */
export function useQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  { staleTime = 0 }: { staleTime?: number } = {},
): QueryResult<T> {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const stableFetcher = useCallback(() => fetcherRef.current(), []);

  const subscribe = useCallback(
    (cb: () => void) => {
      if (!key) return () => {};
      const e = getEntry(key);
      e.listeners.add(cb);
      e.fetcher = stableFetcher;
      return () => { e.listeners.delete(cb); };
    },
    [key, stableFetcher],
  );
  const getSnapshot = useCallback(() => (key ? getEntry(key).snapshot : EMPTY), [key]);
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Load on mount / key change (cached data, if any, is shown meanwhile).
  useEffect(() => {
    if (!key) return;
    const e = getEntry(key);
    if (e.updatedAt === 0 || Date.now() - e.updatedAt > staleTime) {
      fetchQuery(key, stableFetcher);
    }
  }, [key, staleTime, stableFetcher]);

  const refresh = useCallback(
    () => (key ? fetchQuery(key, stableFetcher, true) : Promise.resolve()),
    [key, stableFetcher],
  );

  return {
    data: snap.data as T | undefined,
    error: snap.error,
    loading: !!key && snap.data === undefined && !snap.error,
    fetching: snap.fetching,
    refresh,
  };
}

/** Throw on a Supabase `{ error }` result, otherwise return `data`. */
export function unwrap<T>(res: { data: T | null; error: { message: string } | null }, fallback?: T): T {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? fallback) as T;
}
