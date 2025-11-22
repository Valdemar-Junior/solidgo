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
          const loginEmail = identifier.includes('@') ? identifier : toLoginEmailFromName(identifier);
          let { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });

          console.log('Supabase auth result:', { data, error });

          // Tratativa para e-mail não confirmado
          if (error && error.message && error.message.toLowerCase().includes('email')) {
            throw new Error('E-mail não confirmado. Verifique sua caixa de entrada.');
          }

          if (error) {
            const msg = String(error.message || '').toLowerCase();
            if (msg.includes('invalid') || msg.includes('credentials')) {
              const signup = await supabase.auth.signUp({ email: loginEmail, password });
              if (signup.error) throw signup.error;
              // tentar login novamente
              const retry = await supabase.auth.signInWithPassword({ email: loginEmail, password });
              data = retry.data; error = retry.error as any;
              if (retry.error) throw retry.error;
            } else {
              throw error;
            }
          }

          if (data.user) {
            console.log('User authenticated, fetching profile...');
            // Fetch user profile with role
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
              });
              if (insertErr) throw new Error('Perfil de usuário não encontrado');
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
              set({
                user,
                isAuthenticated: true,
                isLoading: false,
                error: null,
              });
              console.log('Login process completed successfully');
            }
          } else {
            throw new Error('Usuário não autenticado');
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
          await supabase.auth.signOut();
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: null,
          });
        } catch (error: any) {
          set({
            isLoading: false,
            error: error.message || 'Erro ao fazer logout',
          });
          throw error;
        }
      },

      checkAuth: async () => {
        console.log('Starting checkAuth...');
        set({ isLoading: true });
        
        try {
          const { data: { session } } = await supabase.auth.getSession();
          console.log('Session check result:', session);
          
          if (session?.user) {
            console.log('User session found, fetching profile...');
            // Fetch user profile with role
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
              });
              console.log('User authenticated successfully:', user);
            } else {
              // criar perfil mínimo para o próprio usuário
              const defaultName = (session.user.email || 'Usuário');
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
                  });
                  return;
                }
              }
              set({ user: null, isAuthenticated: false, isLoading: false });
            }
          } else {
            console.log('No user session found');
            set({
              user: null,
              isAuthenticated: false,
              isLoading: false,
            });
          }
        } catch (error: any) {
          console.error('CheckAuth error:', error);
          set({
            isLoading: false,
            error: error.message || 'Erro ao verificar autenticação',
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

// Subscribe to auth changes
supabase.auth.onAuthStateChange(async (event, session) => {
  const suppress = typeof window !== 'undefined' && localStorage.getItem('auth_lock') === '1';
  if (suppress && (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED')) {
    return;
  }
  if (event === 'SIGNED_OUT') {
    useAuthStore.getState().checkAuth();
  } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
    useAuthStore.getState().checkAuth();
  }
});
