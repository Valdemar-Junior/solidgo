import { useState } from 'react';
import { supabase } from '../supabase/client';
import { useNavigate } from 'react-router-dom';
import { Loader2, UserPlus, AlertCircle, ArrowLeft } from 'lucide-react';

export default function Setup() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [status, setStatus] = useState<string>('');

  const createAdminUser = async () => {
    setIsLoading(true);
    setError(null);
    setStatus('Criando usuário admin...');
    
    try {
      // First, try to sign up the admin user
      const { data: adminAuthData, error: adminAuthError } = await supabase.auth.signUp({
        email: 'admin@deliveryapp.com',
        password: 'admin123',
        options: {
          data: {
            name: 'Admin User',
            role: 'admin',
            phone: '(11) 98765-4321'
          }
        }
      });

      if (adminAuthError) {
        console.error('Admin auth error:', adminAuthError);
        // If user already exists, try to sign in to verify
        if (adminAuthError.message.includes('already registered')) {
          setStatus('Usuário admin já existe, verificando...');
        } else {
          throw adminAuthError;
        }
      }

      setStatus('Criando usuário motorista...');

      // Create driver user through Supabase auth
      const { data: driverAuthData, error: driverAuthError } = await supabase.auth.signUp({
        email: 'driver@deliveryapp.com',
        password: 'driver123',
        options: {
          data: {
            name: 'Driver User',
            role: 'driver',
            phone: '(11) 91234-5678',
            cpf: '12345678901'
          }
        }
      });

      if (driverAuthError) {
        console.error('Driver auth error:', driverAuthError);
        if (!driverAuthError.message.includes('already registered')) {
          throw driverAuthError;
        }
      }

      setStatus('Configurando motorista...');

      // Check if driver profile exists
      if (driverAuthData?.user) {
        const { data: existingDriver } = await supabase
          .from('drivers')
          .select('id')
          .eq('user_id', driverAuthData.user.id)
          .single();

        if (!existingDriver) {
          // Assign vehicle to driver
          const { data: vehicles } = await supabase.from('vehicles').select('id').limit(1);
          const vehicleId = vehicles?.[0]?.id;

          if (vehicleId) {
            const { error: driverError } = await supabase
              .from('drivers')
              .insert({
                user_id: driverAuthData.user.id,
                vehicle_id: vehicleId,
                active: true
              });

            if (driverError) {
              console.warn('Could not create driver profile:', driverError);
            }
          }
        }
      }

      setSuccess(true);
      setStatus('Usuários criados com sucesso!');
      
      setTimeout(() => {
        navigate('/login');
      }, 3000);
      
    } catch (error: any) {
      console.error('Setup error:', error);
      setError(`Erro ao criar usuários: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100 flex items-center justify-center p-4 relative">
      <button
        onClick={() => navigate(-1)}
        className="absolute top-4 left-4 p-2 bg-white/80 rounded-full shadow-sm hover:bg-white transition-colors text-gray-600"
        title="Voltar"
      >
        <ArrowLeft className="h-6 w-6" />
      </button>
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <div className="bg-green-600 p-3 rounded-full">
              <UserPlus className="h-8 w-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Configuração Inicial
          </h1>
          <p className="text-gray-600">
            Criar usuários de teste para o sistema
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
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-6">
            <p className="text-green-600 text-sm">
              Usuários criados com sucesso! Redirecionando para login...
            </p>
          </div>
        )}

        <div className="space-y-4 mb-6">
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="font-semibold text-gray-900 mb-2">Admin:</h3>
            <p className="text-sm text-gray-600">admin@deliveryapp.com / admin123</p>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="font-semibold text-gray-900 mb-2">Motorista:</h3>
            <p className="text-sm text-gray-600">driver@deliveryapp.com / driver123</p>
          </div>
        </div>

        <button
          onClick={createAdminUser}
          disabled={isLoading || success}
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

        <div className="mt-6 text-center">
          <button
            onClick={() => navigate('/login')}
            className="text-blue-600 hover:text-blue-800 text-sm"
          >
            Já tem usuários? Ir para login
          </button>
        </div>
      </div>
    </div>
  );
}
