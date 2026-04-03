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

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus>(null);

  const fetchProfile = useCallback(async (userId: string) => {
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
      } else if (data) {
        const p = data as Profile;

        // Coordinator always gets through
        if (p.role === 'coordinator') {
          setProfile(p);
          setApprovalStatus('approved');
        } else if (p.role === 'teacher' || p.role === 'student') {
          // Need full_name set via RoleSetup first
          if (!p.full_name || p.full_name.trim() === '') {
            setProfile(null);
            setApprovalStatus(null);
          } else if (p.approved === true) {
            setProfile(p);
            setApprovalStatus('approved');
          } else if (p.approved === false) {
            setProfile(null);
            setApprovalStatus('denied');
          } else {
            // approved is null → pending
            setProfile(null);
            setApprovalStatus('pending');
          }
        } else {
          setProfile(null);
          setApprovalStatus(null);
        }
      } else {
        setProfile(null);
        setApprovalStatus(null);
      }
    } catch (err) {
      console.error('Error fetching profile:', err);
      setProfile(null);
      setApprovalStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session?.user) {
      await fetchProfile(session.user.id);
    }
  }, [session, fetchProfile]);

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session: existing } }) => {
      setSession(existing);
      if (existing?.user) {
        await fetchProfile(existing.user.id);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        if (event === 'SIGNED_OUT') {
          setSession(null);
          setProfile(null);
          setApprovalStatus(null);
          setLoading(false);
          return;
        }

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          setSession(newSession);
          if (newSession?.user) {
            await fetchProfile(newSession.user.id);
          }
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

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
