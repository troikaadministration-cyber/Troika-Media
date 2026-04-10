import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { supabase, isConfigured } from '../lib/supabase';
import type { Profile } from '../types';
import type { Session } from '@supabase/supabase-js';

type ApprovalStatus = 'approved' | 'pending' | 'denied' | null;

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  approvalStatus: ApprovalStatus;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  createProfile: (role: 'teacher' | 'student', fullName: string) => Promise<any>;
  refreshProfile: () => Promise<void>;
}

const PROFILE_CACHE_KEY = 'troika_profile_cache';

function loadCachedProfile(): { profile: Profile | null; approvalStatus: ApprovalStatus } {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { profile: null, approvalStatus: null };
}

function saveProfileCache(profile: Profile | null, approvalStatus: ApprovalStatus) {
  try {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ profile, approvalStatus }));
  } catch {}
}

function clearProfileCache() {
  try {
    localStorage.removeItem(PROFILE_CACHE_KEY);
  } catch {}
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
  const cached = loadCachedProfile();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(cached.profile);
  const [loading, setLoading] = useState(!cached.profile);
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus>(cached.approvalStatus);

  // Prevent double profile fetch (getSession + onAuthStateChange both fire on OAuth callback)
  const fetchingRef = { current: false };

  const fetchProfile = useCallback(async (userId: string) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        console.error('Profile fetch error:', error);
        setProfile(null);
        setApprovalStatus(null);
        clearProfileCache();
      } else if (data) {
        const { profile: p, approvalStatus: s } = resolveProfile(data as Profile);
        setProfile(p);
        setApprovalStatus(s);
        saveProfileCache(p, s);
      } else {
        setProfile(null);
        setApprovalStatus(null);
        clearProfileCache();
      }
    } catch (err) {
      console.error('Error fetching profile:', err);
      setProfile(null);
      setApprovalStatus(null);
      clearProfileCache();
    } finally {
      fetchingRef.current = false;
      setLoading(false);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session?.user) {
      fetchingRef.current = false; // allow explicit refresh
      await fetchProfile(session.user.id);
    }
  }, [session, fetchProfile]);

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }

    // Listen for auth changes — single source of truth for profile fetch
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        if (event === 'SIGNED_OUT') {
          setSession(null);
          setProfile(null);
          setApprovalStatus(null);
          clearProfileCache();
          setLoading(false);
          return;
        }

        setSession(newSession);
        if (newSession?.user) {
          if (cached.profile) {
            // Render immediately with cache, refresh in background
            fetchProfile(newSession.user.id);
          } else {
            await fetchProfile(newSession.user.id);
          }
        } else {
          clearProfileCache();
          setProfile(null);
          setApprovalStatus(null);
          setLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signUp(email: string, password: string, fullName: string) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) throw error;
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
  }

  async function signOut() {
    setProfile(null);
    setSession(null);
    setApprovalStatus(null);
    clearProfileCache();
    await supabase.auth.signOut();
  }

  async function createProfile(role: 'teacher' | 'student', fullName: string) {
    if (!session?.user) throw new Error('Not authenticated');
    const { data, error } = await supabase
      .from('profiles')
      .upsert({
        id: session.user.id,
        role,
        full_name: fullName,
        email: session.user.email || '',
        approved: null, // pending approval
      })
      .select()
      .single();
    if (error) throw error;
    // Don't set profile yet — they need approval
    setApprovalStatus('pending');
    return data;
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, approvalStatus, signIn, signUp, signInWithGoogle, signOut, createProfile, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
/** Strip characters that could be used for PostgREST filter injection */
export function sanitizeForPostgrest(input: string): string {
  return input.replace(/[,.()"'\\]/g, '');
}
