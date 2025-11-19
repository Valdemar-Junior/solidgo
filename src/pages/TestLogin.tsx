import { useState } from 'react';
import { supabase } from '../supabase/client';
import { AlertCircle, CheckCircle, User, Key } from 'lucide-react';

export default function TestLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const testLogin = async () => {
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      console.log('Testing login with:', email);
      
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      console.log('Login result:', { data, error });

      if (error) {
        setError(error.message);
      } else {
        setResult({
          user: data.user,
          session: data.session ? 'Session created' : 'No session'
        });

        // Test fetching user profile
        if (data.user) {
          const { data: profile, error: profileError } = await supabase
            .from('users')
            .select('*')
            .eq('id', data.user.id)
            .single();

          console.log('Profile result:', { profile, profileError });
          
          setResult(prev => ({
            ...prev,
            profile: profile || 'No profile found',
            profileError: profileError?.message
          }));
        }
      }
    } catch (err: any) {
      console.error('Test login error:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const testCurrentUser = async () => {
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      console.log('Current user:', { user, error });
      
      if (user) {
        const { data: profile } = await supabase
          .from('users')
          .select('*')
          .eq('id', user.id)
          .single();
        
        console.log('Current profile:', profile);
      }
    } catch (err) {
      console.error('Error getting current user:', err);
    }
  };

  const createTestUsers = async () => {
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      console.log('Creating test users...');
      
      // Create admin user
      const { data: adminData, error: adminError } = await supabase.auth.signUp({
        email: 'admin@deliveryapp.com',
        password: 'admin123',
        options: {
          data: {
            name: 'Admin Delivery',
            role: 'admin',
            phone: '11999999999'
          }
        }
      });

      console.log('Admin user creation:', { adminData, adminError });

      // Create driver user
      const { data: driverData, error: driverError } = await supabase.auth.signUp({
        email: 'driver@deliveryapp.com',
        password: 'driver123',
        options: {
          data: {
            name: 'Driver Delivery',
            role: 'driver',
            phone: '11888888888'
          }
        }
      });

      console.log('Driver user creation:', { driverData, driverError });

      setResult({
        message: 'Test users created!',
        admin: adminData ? 'Admin created' : adminError?.message,
        driver: driverData ? 'Driver created' : driverError?.message
      });

    } catch (err: any) {
      console.error('Create users error:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Teste de Login
          </h1>
          <p className="text-gray-600">
            Testar autenticação com Supabase
          </p>
        </div>

        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <User className="inline h-4 w-4 mr-1" />
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition"
              placeholder="admin@deliveryapp.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Key className="inline h-4 w-4 mr-1" />
              Senha
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition"
              placeholder="admin123"
            />
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-center">
            <AlertCircle className="h-5 w-5 text-red-600 mr-2" />
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        {result && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
            <div className="flex items-center mb-2">
              <CheckCircle className="h-5 w-5 text-green-600 mr-2" />
              <p className="text-green-600 text-sm font-medium">Teste concluído</p>
            </div>
            <pre className="text-xs text-green-700 overflow-auto max-h-32">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={testLogin}
            disabled={isLoading}
            className="w-full bg-purple-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-purple-700 focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {isLoading ? 'Testando...' : 'Testar Login'}
          </button>

          <button
            onClick={createTestUsers}
            disabled={isLoading}
            className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {isLoading ? 'Criando...' : 'Criar Usuários de Teste'}
          </button>

          <button
            onClick={testCurrentUser}
            className="w-full bg-gray-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-gray-700 focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition text-sm"
          >
            Verificar Usuário Atual
          </button>
        </div>

        <div className="mt-6 text-center text-sm text-gray-500">
          <p>Contas de teste:</p>
          <p>admin@deliveryapp.com / admin123</p>
          <p>driver@deliveryapp.com / driver123</p>
        </div>
      </div>
    </div>
  );
}