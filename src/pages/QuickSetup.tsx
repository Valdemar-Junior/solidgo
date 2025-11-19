import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase/client';
import { useAuthStore } from '../stores/authStore';
import { Loader2, UserPlus, AlertCircle, CheckCircle } from 'lucide-react';

export default function QuickSetup() {
  const navigate = useNavigate();
  const { checkAuth } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [status, setStatus] = useState<string>('');

  const createTestUsers = async () => {
    setIsLoading(true);
    setError(null);
    setStatus('Criando usuários de teste...');
    
    try {
      // Create admin user directly through auth
      console.log('Creating admin user...');
      const { data: adminAuth, error: adminError } = await supabase.auth.signUp({
        email: 'admin@deliveryapp.com',
        password: 'admin123',
        options: {
          data: {
            name: 'Admin Delivery',
            role: 'admin'
          }
        }
      });

      if (adminError && !adminError.message.includes('already registered')) {
        throw new Error(`Admin error: ${adminError.message}`);
      }

      console.log('Admin result:', adminAuth);
      setStatus('Admin criado, criando motorista...');

      // Create driver user
      console.log('Creating driver user...');
      const { data: driverAuth, error: driverError } = await supabase.auth.signUp({
        email: 'driver@deliveryapp.com',
        password: 'driver123',
        options: {
          data: {
            name: 'Driver Delivery',
            role: 'driver'
          }
        }
      });

      if (driverError && !driverError.message.includes('already registered')) {
        throw new Error(`Driver error: ${driverError.message}`);
      }

      console.log('Driver result:', driverAuth);

      // Create driver profile if driver was created
      if (driverAuth?.user) {
        setStatus('Criando perfil de motorista...');
        const { error: driverProfileError } = await supabase
          .from('drivers')
          .insert({
            user_id: driverAuth.user.id,
            license_number: '12345678900',
            vehicle_type: 'van',
            status: 'active'
          });

        if (driverProfileError) {
          console.warn('Driver profile error:', driverProfileError);
        }
      }

      setSuccess(true);
      setStatus('Usuários criados com sucesso!');
      
      // Wait a moment then redirect to login
      setTimeout(() => {
        navigate('/login');
      }, 2000);
      
    } catch (error: any) {
      console.error('Setup error:', error);
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const testAdminLogin = async () => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: 'admin@deliveryapp.com',
        password: 'admin123'
      });

      if (error) {
        setError(`Login test failed: ${error.message}`);
      } else {
        setSuccess(true);
        setStatus('Login test successful!');
        
        // Refresh auth state
        await checkAuth();
        
        // Redirect to dashboard
        setTimeout(() => {
          navigate('/');
        }, 1000);
      }
    } catch (error: any) {
      setError(error.message);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <div className="bg-green-600 p-3 rounded-full">
              <UserPlus className="h-8 w-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Configuração Rápida
          </h1>
          <p className="text-gray-600">
            Criar usuários de teste para login imediato
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-6 flex items-center">
            <AlertCircle className="h-5 w-5 text-red-600 mr-2" />
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        {status && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6">
            <p className="text-blue-600 text-sm">{status}</p>
          </div>
        )}

        {success && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-6 flex items-center">
            <CheckCircle className="h-5 w-5 text-green-600 mr-2" />
            <p className="text-green-600 text-sm">Sucesso! Redirecionando...</p>
          </div>
        )}

        <div className="space-y-4 mb-6">
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="font-semibold text-gray-900 mb-2">Admin:</h3>
            <p className="text-sm text-gray-600">admin@deliveryapp.com</p>
            <p className="text-sm text-gray-600">Senha: admin123</p>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="font-semibold text-gray-900 mb-2">Motorista:</h3>
            <p className="text-sm text-gray-600">driver@deliveryapp.com</p>
            <p className="text-sm text-gray-600">Senha: driver123</p>
          </div>
        </div>

        <div className="space-y-3">
          <button
            onClick={createTestUsers}
            disabled={isLoading}
            className="w-full bg-green-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-green-700 focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center"
          >
            {isLoading ? (
              <>
                <Loader2 className="animate-spin h-5 w-5 mr-2" />
                Criando...
              </>
            ) : (
              'Criar Usuários de Teste'
            )}
          </button>

          <button
            onClick={testAdminLogin}
            disabled={isLoading}
            className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            Testar Login Admin
          </button>
        </div>

        <div className="mt-6 text-center">
          <button
            onClick={() => navigate('/login')}
            className="text-blue-600 hover:text-blue-800 text-sm"
          >
            Ir para Login
          </button>
        </div>
      </div>
    </div>
  );
}