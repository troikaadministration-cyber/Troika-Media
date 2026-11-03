import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import { supabase, isConfigured } from '../lib/supabase';
import { clearQueryCache } from '../lib/queryCache';
import type { Profile } from '../types';
import type { Session } from '@supabase/supabase-js';

type ApprovalStatus = 'approved' | 'pending' | 'denied' | null;

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  approvalStatus: ApprovalStatus;
  /** Set when the profile couldn't be loaded (network/server error) — not the same as "no profile yet". */
  profileError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ needsConfirmation: boolean }>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  createProfile: (role: 'teacher' | 'student', fullName: string) => Promise<Profile>;
  refreshProfile: () => Promise<void>;
}

const PROFILE_CACHE_KEY = 'troika_profile_cache';

interface CachedProfile {
  userId: string;
  profile: Profile | null;
  approvalStatus: ApprovalStatus;
}

function loadCachedProfile(): CachedProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedProfile>;
    // Older cache format had no userId — ignore it rather than risk showing the wrong account.
    if (!parsed || typeof parsed.userId !== 'string') return null;
    return parsed as CachedProfile;
  } catch {
    return null;
  }
}

function saveProfileCache(entry: CachedProfile) {
  try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(entry)); } catch { /* storage full/blocked */ }
}

function clearProfileCache() {
  try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch { /* ignore */ }
}

function resolveProfile(p: Profile): { profile: Profile | null; approvalStatus: ApprovalStatus } {
  if (p.role === 'coordinator') {
    return { profile: p, approvalStatus: 'approved' };
  }
  if (p.role === 'teacher' || p.role === 'student') {
    if (!p.full_name || p.full_name.trim() === '') {
      return { profile: null, approvalStatus: null };
    }
    if (p.approved === true) return { profile: p, approvalStatus: 'approved' };
    if (p.approved === false) return { profile: null, approvalStatus: 'denied' };
    return { profile: null, approvalStatus: 'pending' };
  }
  return { profile: null, approvalStatus: null };
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loading, setLoading] = useState(isConfigured);

  // Which user the current profile state belongs to, and a counter so a slow
  // response for a previous user/request can never overwrite newer state.
  const userIdRef = useRef<string | null>(null);
  const fetchSeq = useRef(0);

  const applyProfile = useCallback((userId: string, p: Profile | null) => {
    const resolved = p ? resolveProfile(p) : { profile: null, approvalStatus: null as ApprovalStatus };
    setProfile(resolved.profile);
    setApprovalStatus(resolved.approvalStatus);
    setProfileError(null);
    if (p) saveProfileCache({ userId, ...resolved });
    else clearProfileCache();
  }, []);

  const fetchProfile = useCallback(async (userId: string, { background }: { background: boolean }) => {
    const seq = ++fetchSeq.current;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
      if (seq !== fetchSeq.current || userIdRef.current !== userId) return;
      if (error) throw error;
      applyProfile(userId, (data as Profile | null) ?? null);
    } catch (err) {
      if (seq !== fetchSeq.current || userIdRef.current !== userId) return;
      console.error('Profile fetch error:', err);
      // A background refresh failing (e.g. offline) keeps the cached profile.
      // A foreground failure must NOT look like "no profile" — that would send
      // an existing user to role setup. Surface it so the UI can offer a retry.
      if (!background) setProfileError((err as Error)?.message || 'Could not load your account');
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
  }, [applyProfile]);

  const handleSession = useCallback((newSession: Session | null) => {
    setSession(newSession);
    const uid = newSession?.user?.id ?? null;

    if (!uid) {
      userIdRef.current = null;
      fetchSeq.current++;
      setProfile(null);
      setApprovalStatus(null);
      setProfileError(null);
      clearProfileCache();
      setLoading(false);
      return;
    }

    // Same user as before (token refresh, tab refocus): nothing to do.
    if (userIdRef.current === uid) return;
    userIdRef.current = uid;

    const cached = loadCachedProfile();
    if (cached && cached.userId === uid && (cached.profile || cached.approvalStatus)) {
      // Render immediately from cache; refresh quietly in the background.
      setProfile(cached.profile);
      setApprovalStatus(cached.approvalStatus);
      setProfileError(null);
      setLoading(false);
      void fetchProfile(uid, { background: true });
    } else {
      // A different user signed in on this device — drop anything cached.
      clearQueryCache();
      setProfile(null);
      setApprovalStatus(null);
      setLoading(true);
      void fetchProfile(uid, { background: false });
    }
  }, [fetchProfile]);

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      // Never await Supabase calls inside this callback (it runs while the auth
      // client holds its internal lock and can deadlock). Defer instead.
      setTimeout(() => {
        if (event === 'SIGNED_OUT') handleSession(null);
        else handleSession(newSession);
      }, 0);
    });
    return () => subscription.unsubscribe();
  }, [handleSession]);

  const refreshProfile = useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid) return;
    setProfileError(null);
    await fetchProfile(uid, { background: false });
  }, [fetchProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (email: string, password: string, fullName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim() }, emailRedirectTo: window.location.origin },
    });
    if (error) throw error;
    // When email confirmation is enabled, no session is returned.
    return { needsConfirmation: !data.session };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    userIdRef.current = null;
    fetchSeq.current++;
    setProfile(null);
    setSession(null);
    setApprovalStatus(null);
    setProfileError(null);
    clearProfileCache();
    clearQueryCache();
    try {
      await supabase.auth.signOut();
    } catch (err) {
      // Even if the server call fails (offline), local state is already cleared.
      console.error('Sign out error:', err);
    }
  }, []);

  const createProfile = useCallback(async (role: 'teacher' | 'student', fullName: string) => {
    const user = session?.user;
    if (!user) throw new Error('Not authenticated');
    // Server-side function: only allows teacher/student, only for a profile that
    // hasn't been set up yet, and always leaves it pending approval. (A plain
    // upsert from the browser could overwrite an existing account's role.)
    const { data, error } = await supabase.rpc('complete_profile_setup', {
      p_role: role,
      p_full_name: fullName.trim(),
    });
    if (error) {
      if (/already set up/i.test(error.message)) {
        await fetchProfile(user.id, { background: false });
      }
      throw error;
    }
    const p = (Array.isArray(data) ? data[0] : data) as Profile;
    applyProfile(user.id, p);
    return p;
  }, [session, fetchProfile, applyProfile]);

  const value = useMemo<AuthContextValue>(() => ({
    session, profile, loading, approvalStatus, profileError,
    signIn, signUp, signInWithGoogle, signOut, createProfile, refreshProfile,
  }), [session, profile, loading, approvalStatus, profileError, signIn, signUp, signInWithGoogle, signOut, createProfile, refreshProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
