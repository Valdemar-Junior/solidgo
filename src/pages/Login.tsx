import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { Loader2, Truck } from 'lucide-react';

export default function Login() {
  const navigate = useNavigate();
  const { login, isLoading, error, clearError, user, isAuthenticated } = useAuthStore();
  
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');

  // Monitorar quando o login for bem sucedido e redirecionar automaticamente
  useEffect(() => {
    if (isAuthenticated && user) {
      console.log('User authenticated, redirecting...', user);
      const path = user.role === 'admin' ? '/admin'
        : user.role === 'driver' ? '/driver'
        : user.role === 'conferente' ? '/conferente'
        : user.role === 'montador' ? '/montador'
        : '/driver';
      navigate(path);
      // força refresh de rota quando mudamos de usuário para evitar estados antigos
      setTimeout(()=>{ try { window.location.replace(path); } catch {} }, 100);
    }
  }, [isAuthenticated, user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Login form submitted with:', name);
    clearError();
    
    try {
      console.log('Calling login function...');
      await login(name, password);
      console.log('Login successful - redirecionamento será feito pelo useEffect');
    } catch (error) {
      console.error('Login failed:', error);
      // Error is already handled in store
    }
  };

  const goToRegister = () => {
    navigate('/register');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <div className="bg-blue-600 p-3 rounded-full">
              <Truck className="h-8 w-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Delivery Route Manager
          </h1>
          <p className="text-gray-600">
            Acesse sua conta para gerenciar rotas e entregas
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">Nome</label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
              placeholder="Seu nome"
              required
              disabled={isLoading}
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
              Senha
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
                Entrando...
              </>
            ) : (
              'Entrar'
            )}
          </button>

          
        </form>

        
      </div>
    </div>
  );
}
