import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { setTokenProvider } from '../data/api';
import { config, hasAuthConfig } from '../lib/config';

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  signIn(email: string, password: string): Promise<string | null>;
  signUp(email: string, password: string): Promise<{ error: string | null; confirmationRequired: boolean }>;
  signOut(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

let supabasePromise: Promise<SupabaseClient | null> | null = null;

function getSupabase() {
  if (!supabasePromise) {
    supabasePromise = hasAuthConfig
      ? import('@supabase/supabase-js').then(({ createClient }) =>
          createClient(config.supabaseUrl, config.supabaseAnonKey, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
          }),
        )
      : Promise.resolve(null);
  }
  return supabasePromise;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(hasAuthConfig);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void getSupabase().then(async (client) => {
      if (!client) return;
      const { data } = await client.auth.getSession();
      if (!active) return;
      setSession(data.session);
      setLoading(false);
      const listener = client.auth.onAuthStateChange((_event, next) => setSession(next));
      unsubscribe = () => listener.data.subscription.unsubscribe();
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    setTokenProvider(async () => {
      const client = await getSupabase();
      if (!client) return null;
      const { data } = await client.auth.getSession();
      return data.session?.access_token ?? null;
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: hasAuthConfig,
      loading,
      session,
      async signIn(email, password) {
        const client = await getSupabase();
        if (!client) return '尚未配置 Supabase';
        const { error } = await client.auth.signInWithPassword({ email, password });
        return error?.message ?? null;
      },
      async signUp(email, password) {
        const client = await getSupabase();
        if (!client) return { error: '尚未配置 Supabase', confirmationRequired: false };
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        return {
          error: error?.message ?? null,
          confirmationRequired: !error && !data.session,
        };
      },
      async signOut() {
        const client = await getSupabase();
        await client?.auth.signOut();
      },
    }),
    [loading, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
