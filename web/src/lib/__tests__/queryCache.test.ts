import { describe, it, expect } from 'vitest';
import { fetchQuery, invalidateQueries, clearQueryCache, setQueryData, unwrap, errorMessage } from '../queryCache';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('queryCache', () => {
  it('de-duplicates concurrent requests for the same key', async () => {
    let calls = 0;
    const f = async () => { calls++; await sleep(10); return 1; };
    await Promise.all([fetchQuery('dedupe', f), fetchQuery('dedupe', f), fetchQuery('dedupe', f)]);
    expect(calls).toBe(1);
  });

  it('a forced refresh wins over an older in-flight response', async () => {
    const seen: number[] = [];
    let v = 0;
    const slow = async () => { const mine = ++v; await sleep(mine === 1 ? 40 : 5); return mine; };
    const p1 = fetchQuery('race', slow);
    const p2 = fetchQuery('race', slow, true);
    await Promise.all([p1, p2]);
    // read the cached value through setQueryData's updater
    setQueryData<number>('race', (prev) => { seen.push(prev as number); return prev as number; });
    expect(seen[0]).toBe(2);
  });

  it('invalidateQueries resolves (no mounted listeners -> nothing to refetch)', async () => {
    await expect(invalidateQueries('nothing-mounted:')).resolves.toBeUndefined();
  });

  it('clearQueryCache drops data and discards in-flight results', async () => {
    const p = fetchQuery('user-data', async () => { await sleep(10); return 'secret'; });
    clearQueryCache();
    await p;
    let after: unknown = 'unset';
    setQueryData('user-data', (prev) => { after = prev; return prev; });
    expect(after).toBeUndefined();
  });

  it('unwrap throws on Supabase errors and applies fallbacks', () => {
    expect(() => unwrap({ data: null, error: { message: 'boom' } })).toThrow('boom');
    expect(unwrap({ data: null, error: null }, [])).toEqual([]);
    expect(errorMessage({ message: 'x' })).toBe('x');
    expect(errorMessage(null, 'fallback')).toBe('fallback');
  });
});
