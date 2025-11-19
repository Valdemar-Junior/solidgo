import { useState, useEffect } from 'react';
import { supabase } from '../supabase/client';
import { User, AlertCircle, CheckCircle, UserCheck } from 'lucide-react';

export default function CheckUsers() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkExistingUsers();
  }, []);

  const checkExistingUsers = async () => {
    try {
      setLoading(true);
      
      // Verificar usuários no auth
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      
      // Verificar usuários no banco public.users
      const { data: publicUsers, error: usersError } = await supabase
        .from('users')
        .select('*');

      if (usersError) {
        console.error('Error fetching users:', usersError);
        setError(usersError.message);
        return;
      }

      console.log('Current user:', currentUser);
      console.log('Public users:', publicUsers);

      setUsers(publicUsers || []);
      
      // Testar login com credenciais padrão
      if (publicUsers && publicUsers.length === 0) {
        console.log('No users found, need to create test users');
      }
      
    } catch (err: any) {
      console.error('Check users error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const testLogin = async (email: string, password: string) => {
    try {
      console.log(`Testing login for: ${email}`);
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error(`Login error for ${email}:`, error);
        alert(`Erro ao fazer login: ${error.message}`);
      } else {
        console.log(`Login successful for ${email}:`, data);
        alert(`Login bem-sucedido para ${email}!`);
      }
    } catch (err: any) {
      console.error(`Test login error for ${email}:`, err);
      alert(`Erro: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Verificando usuários...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <div className="bg-blue-600 p-3 rounded-full">
              <UserCheck className="h-8 w-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Verificar Usuários
          </h1>
          <p className="text-gray-600">
            Status dos usuários no sistema
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-6 flex items-center">
            <AlertCircle className="h-5 w-5 text-red-600 mr-2" />
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        <div className="space-y-4 mb-6">
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="font-semibold text-gray-900 mb-2">Usuários no Banco:</h3>
            {users.length === 0 ? (
              <p className="text-sm text-gray-600">Nenhum usuário encontrado</p>
            ) : (
              <div className="space-y-2">
                {users.map((user: any) => (
                  <div key={user.id} className="flex justify-between items-center p-2 bg-white rounded border">
                    <div>
                      <p className="text-sm font-medium">{user.email}</p>
                      <p className="text-xs text-gray-500">{user.role}</p>
                    </div>
                    <span className={`px-2 py-1 text-xs rounded ${
                      user.role === 'admin' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'
                    }`}>
                      {user.role}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-green-50 p-4 rounded-lg">
            <h3 className="font-semibold text-gray-900 mb-2">Testar Login:</h3>
            <div className="space-y-2">
              <button
                onClick={() => testLogin('admin@deliveryapp.com', 'admin123')}
                className="w-full bg-red-600 text-white py-2 px-4 rounded text-sm hover:bg-red-700 transition"
              >
                Testar Admin: admin@deliveryapp.com
              </button>
              <button
                onClick={() => testLogin('driver@deliveryapp.com', 'driver123')}
                className="w-full bg-blue-600 text-white py-2 px-4 rounded text-sm hover:bg-blue-700 transition"
              >
                Testar Motorista: driver@deliveryapp.com
              </button>
            </div>
          </div>
        </div>

        <div className="text-center">
          <button
            onClick={checkExistingUsers}
            className="text-blue-600 hover:text-blue-800 text-sm"
          >
            Recarregar
          </button>
        </div>
      </div>
    </div>
  );
}