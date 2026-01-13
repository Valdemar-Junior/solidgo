import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const envOk = Boolean(supabaseUrl && supabaseAnonKey);
export const supabasePublicUrl = supabaseUrl;
export const supabaseAnonPublicKey = supabaseAnonKey;
export const supabaseConfig = { url: supabaseUrl, anon: supabaseAnonKey };
; (globalThis as any).__supabaseConfig = supabaseConfig;

const createDummyClient = () => {
  const dummy = {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      signInWithPassword: async () => { throw new Error('Configuração do Supabase ausente'); },
      signOut: async () => { },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => { } } } }),
    },
    from: () => ({ select: async () => ({ data: null, error: new Error('Configuração do Supabase ausente') }) }),
    channel: () => ({ on: () => ({ subscribe: () => ({ unsubscribe: () => { } }) }) }),
  } as any;
  return dummy;
};

export const supabase = envOk ? createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: localStorage,
    storageKey: 'delivery-app-auth-token',
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
  global: {
    headers: {
      'x-application-name': 'delivery-route-manager',
    },
  },
  db: {
    schema: 'public',
  },
}) : createDummyClient();

export default supabase;