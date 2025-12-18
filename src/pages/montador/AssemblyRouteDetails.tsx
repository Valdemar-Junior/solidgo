import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase/client';
import { backgroundSync } from '../../utils/offline/backgroundSync';
import AssemblyMarking from '../../components/AssemblyMarking';
import { OfflineStorage, NetworkStatus } from '../../utils/offline/storage';
import { Package, MapPin, RefreshCw, LogOut, ArrowLeft, PenTool } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { toast } from 'sonner';

export default function AssemblyRouteDetails() {
    const navigate = useNavigate();
    const { user, logout } = useAuthStore();
    const { routeId } = useParams<{ routeId: string }>();
    const [route, setRoute] = useState<any | null>(null);
    const [items, setItems] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [isOnline, setIsOnline] = useState(navigator.onLine);

    useEffect(() => {
        if (routeId) {
            loadRouteDetails();
        }

        const handleOnline = () => {
            setIsOnline(true);
            backgroundSync.forceSync();
        };
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [routeId]);

    const loadRouteDetails = async () => {
        if (!routeId) return;

        try {
            setLoading(true);

            if (NetworkStatus.isOnline()) {
                // Obter detalhes da rota de montagem
                // Assumindo que usamos a mesma tabela 'routes' ou se for 'assembly_routes' ajustaremos.
                // Pelo contexto anterior, parece que montagem usa 'routes' também ou 'assembly_products' linkados a uma rota.
                // Vamos buscar da tabela 'routes' (assumindo que seja generalizada)
                const { data: routeData, error: routeError } = await supabase
                    .from('routes')
                    .select('*, vehicle:vehicles!vehicle_id(*)')
                    .eq('id', routeId)
                    .single();

                if (routeError) {
                    console.warn('Erro buscando rota na tabela routes, tentando lógica standalone se necessário', routeError);
                    // Se falhar, tenta buscar info basica dos itens
                }

                if (routeData) {
                    setRoute(routeData);
                }

                const { data: itemsData, error: itemsError } = await supabase
                    .from('assembly_products')
                    .select('*')
                    .eq('assembly_route_id', routeId);

                if (itemsError) throw itemsError;
                if (itemsData) {
                    setItems(itemsData);
                    await OfflineStorage.setItem(`assembly_items_${routeId}`, itemsData);
                }
            } else {
                // Offline
                // Tenta recuperar info da rota (pode não ter cachê isolado de rota, mas tentamos)
                // O mais importante são os itens
                const cachedItems = await OfflineStorage.getItem(`assembly_items_${routeId}`);
                if (cachedItems) setItems(cachedItems);
            }

        } catch (error) {
            console.error('Error loading assembly route details:', error);
            toast.error('Erro ao carregar rota de montagem');
        } finally {
            setLoading(false);
        }
    };

    const handleForceSync = async () => {
        await backgroundSync.forceSync();
        await loadRouteDetails();
    };

    const getProgress = () => {
        if (items.length === 0) return 0;
        const completed = items.filter(i => i.status === 'completed' || i.status === 'cancelled').length;
        return Math.round((completed / items.length) * 100);
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
                    <p className="text-gray-600">Carregando montagem...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <div className="bg-white shadow sticky top-0 z-10">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="py-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center">
                                <button
                                    onClick={() => navigate('/montador')}
                                    className="p-2 mr-2 hover:bg-gray-100 rounded-full text-gray-600 transition-colors"
                                    title="Voltar"
                                >
                                    <ArrowLeft className="h-6 w-6" />
                                </button>
                                <div className="p-2 bg-indigo-50 rounded-full mr-3">
                                    <PenTool className="h-6 w-6 text-indigo-600" />
                                </div>
                                <div>
                                    <h1 className="text-xl font-bold text-gray-900 leading-tight">
                                        {route?.name || 'Rota de Montagem'}
                                    </h1>
                                    <p className="text-xs text-gray-500">
                                        {user?.name || user?.email}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <div className={`w-3 h-3 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'}`} title={isOnline ? 'Online' : 'Offline'}></div>

                                <button
                                    onClick={handleForceSync}
                                    className="p-2 text-indigo-600 bg-indigo-50 rounded-full hover:bg-indigo-100"
                                    title="Sincronizar"
                                >
                                    <RefreshCw className="h-5 w-5" />
                                </button>
                            </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="mt-4">
                            <div className="flex justify-between text-xs text-gray-500 mb-1">
                                <span>Progresso da Montagem</span>
                                <span className="font-bold">{getProgress()}%</span>
                            </div>
                            <div className="bg-gray-200 rounded-full h-2 overflow-hidden">
                                <div
                                    className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                                    style={{ width: `${getProgress()}%` }}
                                ></div>
                            </div>
                            <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                                <span>{items.filter(i => i.status === 'completed').length} montados</span>
                                <span>{items.filter(i => i.status === 'pending').length} pendentes</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                {/* Route Summary */}
                <div className="bg-white rounded-lg shadow p-4 mb-4">
                    <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center uppercase tracking-wide">
                        <MapPin className="h-4 w-4 mr-1 text-gray-400" />
                        Resumo
                    </h2>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="text-center p-2 bg-indigo-50 rounded-lg">
                            <div className="text-xl font-bold text-indigo-600">{items.length}</div>
                            <div className="text-xs text-indigo-800">Total Serviços</div>
                        </div>
                        <div className="text-center p-2 bg-green-50 rounded-lg">
                            <div className="text-xl font-bold text-green-600">
                                {items.filter(i => i.status === 'completed').length}
                            </div>
                            <div className="text-xs text-green-800">Concluídos</div>
                        </div>
                    </div>

                    {route?.observations && (
                        <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs">
                            <p className="text-yellow-800">
                                <strong>Obs:</strong> {route.observations}
                            </p>
                        </div>
                    )}
                </div>

                {/* Assembly Marking Component */}
                <AssemblyMarking routeId={routeId || ''} onUpdated={() => { loadRouteDetails(); }} />

                <div className="mt-8 text-center pb-8">
                    <button
                        onClick={async () => { await logout(); window.location.href = '/login'; }}
                        className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none"
                    >
                        <LogOut className="h-4 w-4 mr-2" />
                        Sair do Sistema
                    </button>
                </div>
            </div>
        </div>
    );
}
