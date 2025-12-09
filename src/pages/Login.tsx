import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { Loader2, Truck, CheckCircle2, ShieldCheck, MessageSquare, MapPin } from 'lucide-react';

const features = [
  {
    icon: Truck,
    title: "Gestão Inteligente de Logística",
    desc: "Roteirização automática e otimizada para entregas e montagens em um só lugar."
  },
  {
    icon: MessageSquare,
    title: "Comunicação Automatizada",
    desc: "Notificações automáticas via WhatsApp para clientes e grupos da empresa."
  },
  {
    icon: MapPin,
    title: "Roteirização e GPS Preciso",
    desc: "Geocodificação inteligente integrada ao Waze e Google Maps para rotas perfeitas."
  },
  {
    icon: ShieldCheck,
    title: "Controle em Tempo Real",
    desc: "Visibilidade total da operação, auditoria de ações e performance da equipe."
  }
];

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isLoading, error, clearError, user, isAuthenticated } = useAuthStore();
  
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [activeFeature, setActiveFeature] = useState(0);

  // Carrossel automático de features
  useEffect(() => {
    const timer = setInterval(() => {
      setActiveFeature((prev) => (prev + 1) % features.length);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  // Monitorar quando o login for bem sucedido
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const stay = params.has('stay') || params.has('forceLogin');
    if (stay) return;

    if (isAuthenticated && user) {
      if (user.must_change_password) {
        navigate('/first-login');
        return;
      }
      const path = user.role === 'admin' ? '/admin'
        : user.role === 'driver' ? '/driver'
        : user.role === 'conferente' ? '/conferente'
        : user.role === 'montador' ? '/montador'
        : '/driver';
      navigate(path);
      setTimeout(()=>{ try { window.location.replace(path); } catch {} }, 100);
    }
  }, [isAuthenticated, user, navigate, location.search]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    try {
      await login(name, password);
    } catch (error) {
      // Error is handled in store
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Lado Esquerdo - Apresentação (Escondido em Mobile) */}
      <div className="hidden lg:flex lg:w-1/2 bg-blue-600 relative overflow-hidden flex-col justify-between p-12 text-white">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-600 to-indigo-900 opacity-90"></div>
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?ixlib=rb-4.0.3&auto=format&fit=crop&w=2070&q=80')] bg-cover bg-center mix-blend-overlay opacity-20"></div>
        
        <div className="relative z-10">
          <div className="flex items-center space-x-3 mb-8">
            <div className="bg-white/20 p-2 rounded-lg backdrop-blur-sm">
              <Truck className="h-8 w-8 text-white" />
            </div>
            <span className="text-2xl font-bold tracking-wide">SOLIDGO</span>
          </div>
        </div>

        <div className="relative z-10 flex-1 flex flex-col justify-center max-w-lg">
          {features.map((feature, idx) => (
            <div 
              key={idx}
              className={`transition-all duration-700 absolute inset-x-0 top-1/2 -translate-y-1/2 transform ${
                idx === activeFeature ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8 pointer-events-none'
              }`}
            >
              <div className="mb-6 inline-block p-4 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20">
                <feature.icon className="h-10 w-10 text-blue-200" />
              </div>
              <h2 className="text-4xl font-bold mb-4 leading-tight">{feature.title}</h2>
              <p className="text-lg text-blue-100 leading-relaxed">{feature.desc}</p>
            </div>
          ))}
        </div>

        <div className="relative z-10 flex space-x-2">
          {features.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setActiveFeature(idx)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                idx === activeFeature ? 'w-8 bg-white' : 'w-2 bg-white/40 hover:bg-white/60'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Lado Direito - Login Form */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-12 lg:p-24 bg-white">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center lg:text-left">
            <div className="lg:hidden flex justify-center mb-6">
              <div className="bg-blue-600 p-3 rounded-full">
                <Truck className="h-8 w-8 text-white" />
              </div>
            </div>
            <h2 className="text-3xl font-bold text-gray-900 tracking-tight">Bem-vindo de volta</h2>
            <p className="mt-2 text-gray-500">
              Acesse sua conta para gerenciar sua operação
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-8 space-y-6">
            {error && (
              <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-md animate-fade-in">
                <div className="flex">
                  <div className="ml-3">
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-5">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                  Nome de Usuário
                </label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <input
                    id="name"
                    name="name"
                    type="text"
                    required
                    disabled={isLoading}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition-colors sm:text-sm"
                    placeholder="Digite seu usuário"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  Senha
                </label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required
                    disabled={isLoading}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition-colors sm:text-sm"
                    placeholder="••••••••"
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-[1.01]"
            >
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin h-5 w-5 mr-2" />
                  Entrando...
                </>
              ) : (
                'Acessar Sistema'
              )}
            </button>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">
                  Sistema seguro e monitorado
                </span>
              </div>
            </div>
            <div className="mt-6 flex justify-center space-x-6 text-gray-400">
               <ShieldCheck className="h-5 w-5" />
               <CheckCircle2 className="h-5 w-5" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
