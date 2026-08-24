const trimSlash = (value: string) => value.replace(/\/+$/, '');

export const config = {
  apiUrl: trimSlash(import.meta.env.VITE_API_URL || '/v1'),
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
};

export const hasAuthConfig = Boolean(config.supabaseUrl && config.supabaseAnonKey);
