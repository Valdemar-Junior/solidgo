import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from '../supabase/client';
import { toLoginEmailFromName } from '../lib/utils';
import type { User } from '../types/database';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (identifier: string, password: string) => {
        console.log('Starting login process for:', identifier);
        set({ isLoading: true, error: null });

        try {
          console.log('Attempting Supabase auth signInWithPassword...');
          // Resolve email: se existir perfil com nome igual ao identificador, usar o email do perfil
          let loginEmail = identifier.includes('@') ? identifier : toLoginEmailFromName(identifier);
          if (!identifier.includes('@')) {
            const { data: byName } = await supabase.from('users').select('email').eq('name', identifier).maybeSingle();
            if (byName?.email) loginEmail = byName.email;
          }
          const { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });

          console.log('Supabase auth result:', { data, error });

          // Tratativa para e-mail nao confirmado
          if (error && error.message && error.message.toLowerCase().includes('email')) {
            throw new Error('E-mail nao confirmado. Verifique sua caixa de entrada.');
          }

          if (error) {
            const msg = String(error.message || '').toLowerCase();
            if (msg.includes('invalid') || msg.includes('credentials')) {
              throw new Error('Credenciais invalidas');
            }
            throw error;
          }

          if (data.user) {
            console.log('User authenticated, fetching profile...');
            const { data: profile, error: profileError } = await supabase
              .from('users')
              .select('*')
              .eq('id', data.user.id)
              .single();

            console.log('Profile fetch result:', { profile, profileError });

            if (!profile) {
              const fallbackName = identifier;
              const roleDefault = 'driver';
              const { error: insertErr } = await supabase.from('users').insert({
                id: data.user.id,
                email: data.user.email,
                name: fallbackName,
                role: roleDefault,
                must_change_password: true,
              });
              if (insertErr) throw new Error('Perfil de Usuario nao encontrado');
              const { data: newProfile } = await supabase
                .from('users')
                .select('*')
                .eq('id', data.user.id)
                .single();
              const user: User = {
                id: newProfile!.id,
                email: newProfile!.email,
                name: newProfile!.name,
                role: newProfile!.role,
                phone: newProfile!.phone,
                must_change_password: newProfile!.must_change_password,
                created_at: newProfile!.created_at,
              };
              set({ user, isAuthenticated: true, isLoading: false, error: null });
            } else {
              const user: User = {
                id: profile.id,
                email: profile.email,
                name: profile.name,
                role: profile.role,
                phone: profile.phone,
                must_change_password: profile.must_change_password,
                created_at: profile.created_at,
              };

              console.log('Setting user in store:', user);
              set({ user, isAuthenticated: true, isLoading: false, error: null });
              console.log('Login process completed successfully');
            }
          } else {
            throw new Error('Usuario nao autenticado');
          }
        } catch (error: any) {
          console.error('Login process error:', error);
          set({
            isLoading: false,
            error: error.message || 'Erro ao fazer login',
          });
          throw error;
        }
      },

      logout: async () => {
        set({ isLoading: true });
        try {
          try { localStorage.setItem('auth_lock', '1'); } catch { }
          await supabase.auth.signOut({ scope: 'local' });
        } catch (error: any) {
          console.warn('Logout warning:', error?.message || error);
        } finally {
          set({ user: null, isAuthenticated: false, isLoading: false, error: null });
          try { localStorage.removeItem('auth-storage'); } catch { }
          try { localStorage.removeItem('delivery-app-auth-token'); } catch { }
          try { localStorage.removeItem('sb-' + 'auth-token'); } catch { }
          try { localStorage.removeItem('auth_lock'); } catch { }
        }
      },

      checkAuth: async () => {
        console.log('Starting checkAuth...');
        const alreadyAuth = get().isAuthenticated;
        set({ isLoading: alreadyAuth ? false : true });
        const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
        const cachedUser = get().user;

        if (isOffline && cachedUser) {
          console.log('Offline, mantendo Usuario em cache');
          set({ isAuthenticated: true, isLoading: false, error: null });
          return;
        }

        try {
          const { data: { session }, error: sessionError } = await supabase.auth.getSession();
          console.log('Session check result:', session, sessionError);

          if (!session?.user && cachedUser && isOffline) {
            console.log('Sem session da API mas offline com cache: mantendo login');
            set({ isAuthenticated: true, isLoading: false, error: null });
            return;
          }

          if (session?.user) {
            console.log('User session found, fetching profile...');
            const { data: profile, error: profileError } = await supabase
              .from('users')
              .select('*')
              .eq('id', session.user.id)
              .single();

            console.log('Profile fetch result:', { profile, profileError });

            if (profile) {
              const user: User = {
                id: profile.id,
                email: profile.email,
                name: profile.name,
                role: profile.role,
                phone: profile.phone,
                must_change_password: profile.must_change_password,
                created_at: profile.created_at,
              };

              set({
                user,
                isAuthenticated: true,
                isLoading: false,
                error: null,
              });
              console.log('User authenticated successfully:', user);
            } else {
              const defaultName = (session.user.email || 'Usuario');
              const { error: insertErr } = await supabase.from('users').insert({
                id: session.user.id,
                email: session.user.email,
                name: defaultName,
                role: 'driver',
              });
              if (!insertErr) {
                const { data: created } = await supabase
                  .from('users')
                  .select('*')
                  .eq('id', session.user.id)
                  .single();
                if (created) {
                  set({
                    user: {
                      id: created.id,
                      email: created.email,
                      name: created.name,
                      role: created.role,
                      phone: created.phone,
                      must_change_password: created.must_change_password,
                      created_at: created.created_at,
                    },
                    isAuthenticated: true,
                    isLoading: false,
                    error: null,
                  });
                  return;
                }
              }
              set({ user: null, isAuthenticated: false, isLoading: false, error: null });
            }
          } else {
            console.log('No user session found');
            set({
              user: null,
              isAuthenticated: false,
              isLoading: false,
              error: null,
            });
          }
        } catch (error: any) {
          const isOfflineNow = typeof navigator !== 'undefined' && navigator.onLine === false;
          if (isOfflineNow && cachedUser) {
            console.warn('Erro em checkAuth offline, mantendo Usuario em cache');
            set({ isAuthenticated: true, isLoading: false, error: null });
            return;
          }
          console.error('CheckAuth error:', error);
          set({
            isLoading: false,
            error: error.message || 'Erro ao verificar autenticacao',
          });
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

import { toast } from 'sonner';

supabase.auth.onAuthStateChange(async (event) => {
  const suppress = typeof window !== 'undefined' && localStorage.getItem('auth_lock') === '1';
  if (suppress && (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED')) {
    return;
  }
  if (event === 'SIGNED_OUT') {
    // Mostrar mensagem de sessão expirada
    toast.warning('Sessão expirada. Faça login novamente.', { duration: 5000 });
    useAuthStore.getState().checkAuth();
  } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
    useAuthStore.getState().checkAuth();
  }
});





