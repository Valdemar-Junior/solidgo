import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../supabase/client';
import { Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';

export default function FirstLogin() {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('As senhas não coincidem');
      return;
    }

    if (newPassword.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres');
      return;
    }

    setIsLoading(true);

    try {
      // Atualizar senha no Supabase Auth
      const { error: authError } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (authError) {
        const msg = String(authError.message || '').toLowerCase();
        let pt = 'Erro ao atualizar senha';
        if (msg.includes('new password should be different')) pt = 'A nova senha deve ser diferente da senha anterior';
        else if (msg.includes('at least') || msg.includes('6')) pt = 'A senha deve ter pelo menos 6 caracteres';
        else if (msg.includes('weak')) pt = 'A senha é muito fraca';
        else if (msg.includes('invalid')) pt = 'Senha inválida';
        throw new Error(pt);
      }

      // Atualizar flag no banco
      const { error: dbError } = await supabase
        .from('users')
        .update({ must_change_password: false })
        .eq('id', user?.id);

      if (dbError) throw new Error('Erro ao atualizar seu perfil');

      toast.success('Senha alterada com sucesso');
      let target = '/';
      const { data: refreshed } = await supabase
        .from('users')
        .select('*')
        .eq('id', user!.id)
        .single();
      if (refreshed) {
        useAuthStore.setState({
          user: {
            id: refreshed.id,
            email: refreshed.email,
            name: refreshed.name,
            role: refreshed.role,
            phone: refreshed.phone,
            must_change_password: refreshed.must_change_password,
            created_at: refreshed.created_at,
          }
        });
        const role = String(refreshed.role || '').toLowerCase();
        target = role === 'admin' ? '/admin'
          : role === 'driver' ? '/driver'
            : role === 'conferente' ? '/conferente'
              : role === 'montador' ? '/montador'
                : role === 'consultor' ? '/consultor'
                  : '/';
      } else {
        await useAuthStore.getState().checkAuth();
      }
      try {
        window.location.assign(target);
      } catch {
        navigate(target);
      }
    } catch (error: any) {
      setError(error.message || 'Erro ao atualizar senha');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <div className="bg-blue-600 p-3 rounded-full">
              <Lock className="h-8 w-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Primeiro Acesso
          </h1>
          <p className="text-gray-600">
            Por segurança, você precisa definir uma nova senha
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          <div>
            <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700 mb-2">
              Nova Senha
            </label>
            <input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
              placeholder="••••••••"
              required
              disabled={isLoading}
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
              Confirmar Nova Senha
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
              placeholder="••••••••"
              required
              disabled={isLoading}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center"
          >
            {isLoading ? (
              <>
                <Loader2 className="animate-spin h-5 w-5 mr-2" />
                Atualizando...
              </>
            ) : (
              'Definir Senha'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
