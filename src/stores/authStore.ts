import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from '../supabase/client';
import type { User } from '../types/database';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
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

      login: async (email: string, password: string) => {
        console.log('Starting login process for:', email);
        set({ isLoading: true, error: null });
        
        try {
          console.log('Attempting Supabase auth signInWithPassword...');
          const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
          });

          console.log('Supabase auth result:', { data, error });

          // Tratativa para e-mail não confirmado
          if (error && error.message && error.message.toLowerCase().includes('email')) {
            throw new Error('E-mail não confirmado. Verifique sua caixa de entrada.');
          }

          if (error) {
            console.error('Supabase auth error:', error);
            throw error;
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
              console.log('Profile missing, attempting to create...');
              const meta = (data.user as any).user_metadata || {};
              const { error: insertError } = await supabase
                .from('users')
                .insert({
                  id: data.user.id,
                  email: data.user.email,
                  name: meta.name || data.user.email,
                  role: meta.role || 'admin',
                  phone: meta.phone || null,
                });

              if (insertError) {
                console.error('Profile create error:', insertError);
                throw new Error('Perfil de usuário não encontrado');
              }

              const { data: newProfile } = await supabase
                .from('users')
                .select('*')
                .eq('id', data.user.id)
                .single();

              if (!newProfile) {
                throw new Error('Perfil de usuário não encontrado');
              }

              const user: User = {
                id: newProfile.id,
                email: newProfile.email,
                name: newProfile.name,
                role: newProfile.role,
                phone: newProfile.phone,
                created_at: newProfile.created_at,
              };

              console.log('Setting user in store:', user);
              set({
                user,
                isAuthenticated: true,
                isLoading: false,
                error: null,
              });
              console.log('Login process completed successfully');
            } else {
              const user: User = {
                id: profile.id,
                email: profile.email,
                name: profile.name,
                role: profile.role,
                phone: profile.phone,
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
                created_at: profile.created_at,
              };

              set({
                user,
                isAuthenticated: true,
                isLoading: false,
              });
              console.log('User authenticated successfully:', user);
            } else {
              console.log('No profile found, attempting to create...');
              const meta = (session.user as any).user_metadata || {};
              const { error: insertError } = await supabase
                .from('users')
                .insert({
                  id: session.user.id,
                  email: session.user.email,
                  name: meta.name || session.user.email,
                  role: meta.role || 'admin',
                  phone: meta.phone || null,
                });

              if (insertError) {
                console.error('Profile create error:', insertError);
                set({
                  user: null,
                  isAuthenticated: false,
                  isLoading: false,
                });
                return;
              }

              const { data: newProfile } = await supabase
                .from('users')
                .select('*')
                .eq('id', session.user.id)
                .single();

              if (!newProfile) {
                set({
                  user: null,
                  isAuthenticated: false,
                  isLoading: false,
                });
                return;
              }

              const user: User = {
                id: newProfile.id,
                email: newProfile.email,
                name: newProfile.name,
                role: newProfile.role,
                phone: newProfile.phone,
                created_at: newProfile.created_at,
              };

              set({
                user,
                isAuthenticated: true,
                isLoading: false,
              });
              console.log('User profile created and authenticated:', user);
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
  if (event === 'SIGNED_OUT') {
    useAuthStore.getState().checkAuth();
  } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
    useAuthStore.getState().checkAuth();
  }
});
