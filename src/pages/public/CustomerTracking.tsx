import { useState, useMemo } from 'react';
import { Search, Package, Calendar, MapPin, Truck, CheckCircle2, Circle, Clock, Hammer, AlertTriangle } from 'lucide-react';
import { supabase } from '../../supabase/client';
import { toast } from 'sonner';

interface DeliveryTimeline {
    sale_date?: string;
    imported_date?: string;
    assigned_date?: string;
    route_status?: string;
    route_name?: string;
    current_status?: string; // pending, delivered, returned
    delivered_at?: string;
    forecast_date?: string;
}

interface AssemblyTimeline {
    product_name?: string;
    status?: string; // pending, assigned, in_progress, completed
    scheduled_date?: string;
    completion_date?: string;
    deadline?: string;
    route_name?: string;
    route_created_at?: string;
}

interface DeliveryEvent {
    route_name: string;
    dispatched_at: string; // Saiu para entrega
    status: 'pending' | 'delivered' | 'returned';
    delivered_at?: string;
    returned_at?: string;
    return_reason?: string;
    return_notes?: string;
}

interface TrackingResult {
    order_number: string;
    customer_name: string;
    city: string;
    neighborhood: string;
    delivery_timeline: {
        sale_date?: string;
        imported_date: string;
        forecast_date?: string;
    };
    delivery_history: DeliveryEvent[];
    has_assembly: boolean;
    assembly_timeline?: AssemblyTimeline;
}

export default function CustomerTracking() {
    const [orderNumber, setOrderNumber] = useState('');
    const [cpf, setCpf] = useState('');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<TrackingResult | null>(null);
    const [searched, setSearched] = useState(false);

    const handleSearch = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!orderNumber.trim() || !cpf.trim()) {
            toast.error('Preencha o número do pedido e o CPF');
            return;
        }

        // Validação básica de CPF (apenas tamanho)
        const cleanCpf = cpf.replace(/\D/g, '');
        if (cleanCpf.length < 11) {
            toast.error('CPF incompleto');
            return;
        }

        try {
            setLoading(true);
            setResult(null);
            setSearched(true);

            const { data, error } = await supabase.rpc('get_order_public', {
                p_order_number: orderNumber.trim(),
                p_cpf: cleanCpf
            });

            if (error) throw error;

            if (!data) {
                toast.error('Pedido não encontrado ou dados incorretos');
                return;
            }

            setResult(data as TrackingResult);
        } catch (err) {
            console.error(err);
            toast.error('Erro ao buscar pedido. Tente novamente.');
        } finally {
            setLoading(false);
        }
    };

    // Formatador de data simplificado
    const formatDate = (dateStr?: string) => {
        if (!dateStr) return '';
        try {
            const d = new Date(dateStr);
            // Ajuste básico de timezone se necessário, ou usar UTC direto. 
            // Como as datas do banco geralmente vem em ISO, new Date() converte pro local.
            return new Intl.DateTimeFormat('pt-BR', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }).format(d);
        } catch {
            return '';
        }
    };

    const formatDateSimple = (dateStr?: string) => {
        if (!dateStr) return '';
        try {
            const d = new Date(dateStr);
            return new Intl.DateTimeFormat('pt-BR', {
                day: '2-digit',
                month: 'short'
            }).format(d);
        } catch {
            return '';
        }
    };

    // Helper para renderizar item da timeline
    const TimelineItem = ({
        active,
        completed,
        icon: Icon,
        title,
        date,
        description,
        isLast = false
    }: {
        active?: boolean;
        completed?: boolean;
        icon: any;
        title: string;
        date?: string;
        description?: React.ReactNode;
        isLast?: boolean;
    }) => {
        let iconClass = "bg-gray-800 text-gray-500 border-gray-700";
        if (completed) iconClass = "bg-green-500 text-white border-green-500 shadow-[0_0_10px_rgba(34,197,94,0.4)]";
        else if (active) iconClass = "bg-blue-500 text-white border-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.4)]";

        return (
            <div className="relative flex gap-4 pb-8 last:pb-0">
                {!isLast && (
                    <div className={`absolute top-8 left-3.5 w-0.5 h-[calc(100%-2rem)] ${completed ? 'bg-green-900/50' : 'bg-gray-800'}`} />
                )}

                <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all duration-500 ${iconClass}`}>
                    {completed ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                </div>

                <div className={`flex-1 pt-1 transition-all duration-500 ${active || completed ? 'opacity-100' : 'opacity-40'}`}>
                    <div className="flex justify-between items-start">
                        <h4 className={`font-semibold text-sm ${completed ? 'text-green-400' : active ? 'text-blue-400' : 'text-gray-300'}`}>
                            {title}
                        </h4>
                        {date && <span className="text-xs text-gray-400 font-mono mt-0.5">{date}</span>}
                    </div>
                    {description && <p className="text-xs text-gray-500 mt-1">{description}</p>}
                </div>
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-blue-500/30">

            {/* Header Fixo */}
            <header className="fixed top-0 w-full z-50 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/60">
                <div className="max-w-md mx-auto px-6 h-16 flex items-center justify-center">
                    {/* Você pode colocar a Logo da Loja aqui */}
                    <h1 className="font-bold text-lg text-white tracking-tight flex items-center gap-2">
                        <Package className="h-5 w-5 text-blue-500" />
                        Rastreio de Pedido
                    </h1>
                </div>
            </header>

            <main className="max-w-md mx-auto px-6 pt-24 pb-10 space-y-6">

                {/* Formulário de Busca */}
                <div className={`transition-all duration-500 ${result ? 'scale-95 opacity-50 hover:opacity-100 hover:scale-100' : 'scale-100 opacity-100'}`}>
                    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
                        {!result && <p className="text-center text-slate-400 mb-6 text-sm">Digite os dados do pedido para acompanhar a entrega e montagem.</p>}

                        <form onSubmit={handleSearch} className="space-y-4">
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500 uppercase ml-1">Número do Pedido</label>
                                <input
                                    type="text"
                                    value={orderNumber}
                                    onChange={(e) => setOrderNumber(e.target.value)}
                                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none transition-all"
                                    placeholder="Ex: 98765"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500 uppercase ml-1">CPF</label>
                                <input
                                    type="text"
                                    value={cpf}
                                    onChange={(e) => {
                                        // Máscara simples de CPF
                                        let v = e.target.value.replace(/\D/g, '');
                                        if (v.length > 11) v = v.slice(0, 11);
                                        v = v.replace(/(\d{3})(\d)/, '$1.$2');
                                        v = v.replace(/(\d{3})(\d)/, '$1.$2');
                                        v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
                                        setCpf(v);
                                    }}
                                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none transition-all"
                                    placeholder="000.000.000-00"
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3.5 rounded-xl shadow-lg shadow-blue-900/20 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {loading ? <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Search className="w-5 h-5" />}
                                {loading ? 'Buscando...' : 'Rastrear Pedido'}
                            </button>
                        </form>
                    </div>
                </div>

                {/* Resultados */}
                {result && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 bg-slate-900/80 border border-slate-800/60 rounded-3xl p-6 shadow-2xl backdrop-blur-md relative overflow-hidden">

                        {/* Efeito de brilho de fundo */}
                        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl -mr-32 -mt-32 pointer-events-none" />

                        <div className="relative">
                            {/* Cabeçalho do Card */}
                            <div className="flex justify-between items-start mb-8">
                                <div>
                                    <h2 className="text-2xl font-bold text-white tracking-tight">Pedido #{result.order_number}</h2>
                                    <p className="text-slate-400 text-sm mt-1 flex items-center gap-1.5">
                                        <Package className="h-4 w-4" />
                                        {result.customer_name.split(' ')[0]} {/* Primeiro nome */}
                                    </p>
                                    {result.city && (
                                        <p className="text-slate-500 text-xs mt-1 flex items-center gap-1.5">
                                            <MapPin className="h-3 w-3" />
                                            {result.neighborhood ? `${result.neighborhood}, ` : ''}{result.city}
                                        </p>
                                    )}
                                </div>

                            </div>

                            {/* Timeline */}
                            <div className="pl-2">
                                {/* 1. Pedido Recebido */}
                                <TimelineItem
                                    completed={true}
                                    icon={Package}
                                    title="Pedido Confirmado"
                                    date={formatDateSimple(result.delivery_timeline.sale_date)}
                                    description="A loja recebeu seu pedido."
                                />

                                {/* 2. Chegou no CD */}
                                <TimelineItem
                                    completed={!!result.delivery_timeline.imported_date}
                                    icon={MapPin}
                                    title="Chegou no Centro Logístico"
                                    date={formatDateSimple(result.delivery_timeline.imported_date)}
                                    description={result.delivery_timeline.imported_date ? "Recebido em nosso CD de Assú/RN." : "Aguardando chegada no CD."}
                                />

                                {/* 3. Em Separação */}
                                <TimelineItem
                                    completed={!!result.delivery_timeline.imported_date && result.delivery_history.length > 0}
                                    active={!!result.delivery_timeline.imported_date && result.delivery_history.length === 0}
                                    icon={Package}
                                    title="Em Separação"
                                    date={formatDateSimple(result.delivery_timeline.imported_date)}
                                    description={result.delivery_history.length > 0 ? "Sendo preparado para envio." : "Aguardando separação."}
                                />

                                {/* DYNAMIC DELIVERY HISTORY RENDERING */}
                                {result.delivery_history && result.delivery_history.length > 0 ? (
                                    result.delivery_history.map((event, index) => {
                                        const isLastEvent = index === result.delivery_history.length - 1;

                                        // 1. EVENTO DE SAÍDA PARA ENTREGA (Sempre acontece primeiro na rota)
                                        const dispatchStep = (
                                            <TimelineItem
                                                key={`dispatch-${index}`}
                                                completed={true}
                                                icon={Truck}
                                                title="Saiu para Entrega"
                                                date={formatDateSimple(event.dispatched_at)}
                                                description="Seu pedido está a caminho."
                                            />
                                        );

                                        // 2. EVENTO DE CONCLUSÃO (Entrega ou Retorno)
                                        let finalStep = null;

                                        if (event.status === 'returned') {
                                            // Lógica para decidir o texto do motivo
                                            const reasonText = event.return_reason || event.return_notes || "Motivo não informado";
                                            const showNotes = event.return_reason && event.return_notes; // Só mostra obs separada se já tiver o motivo principal

                                            finalStep = (
                                                <TimelineItem
                                                    key={`returned-${index}`}
                                                    completed={true}
                                                    icon={AlertTriangle}
                                                    title="Retornado"
                                                    date={event.returned_at ? formatDate(event.returned_at) : undefined}
                                                    description={
                                                        <span className="text-red-400 block">
                                                            {reasonText}
                                                            {showNotes && (
                                                                <span className="block text-xs mt-1 opacity-75">
                                                                    Obs: {event.return_notes}
                                                                </span>
                                                            )}
                                                        </span>
                                                    }
                                                />
                                            );
                                        } else if (event.status === 'delivered') {
                                            finalStep = (
                                                <TimelineItem
                                                    key={`delivered-${index}`}
                                                    completed={true}
                                                    icon={CheckCircle2}
                                                    title="Entregue"
                                                    date={event.delivered_at ? formatDate(event.delivered_at) : undefined}
                                                    description={
                                                        <>
                                                            <span>Obrigado por comprar conosco!</span>
                                                            {!result.has_assembly && (
                                                                <span className="font-semibold text-blue-400 block mt-1">
                                                                    Previsão: {formatDateSimple(result.delivery_timeline.forecast_date)}
                                                                </span>
                                                            )}
                                                        </>
                                                    }
                                                    isLast={!result.has_assembly} // Se tiver montagem, não é o último da timeline geral
                                                />
                                            );
                                        } else {
                                            // Se estiver pendente (ainda na rota, não finalizado)
                                            // Apenas mostra que saiu, não tem passo final ainda
                                        }

                                        return (
                                            <>
                                                {dispatchStep}
                                                {finalStep}
                                            </>
                                        );
                                    })
                                ) : (
                                    // Fallback caso não tenha histórico ainda (ex: pedido novo, pré-rota)
                                    <TimelineItem
                                        completed={false}
                                        icon={CheckCircle2}
                                        title="Aguardando Envio"
                                        description="Seu pedido está sendo preparado."
                                    />
                                )}

                                {/* SEÇÃO DE MONTAGEM (SÓ SE TIVER) */}
                                {result.has_assembly && (
                                    <>
                                        {/* Conector Visual para Montagem */}
                                        <div className="py-6 flex items-center justify-center relative">
                                            <div className="absolute left-3.5 top-0 w-0.5 h-full bg-slate-800" />
                                            <div className="z-10 bg-slate-900 border border-slate-700 px-3 py-1 rounded-full text-[10px] font-bold tracking-widest text-slate-500 uppercase">
                                                Montagem
                                            </div>
                                        </div>

                                        {/* 6. Ordem de Montagem Gerada */}
                                        <TimelineItem
                                            completed={!!result.assembly_timeline?.product_name}
                                            icon={Calendar}
                                            title="Ordem de Montagem Gerada"
                                            date={
                                                (() => {
                                                    const deliveredEvent = result.delivery_history?.find(e => e.status === 'delivered');
                                                    return deliveredEvent?.delivered_at ? formatDateSimple(deliveredEvent.delivered_at) : undefined;
                                                })()
                                            }
                                            description={result.assembly_timeline?.product_name ? "Solicitação enviada para montagem." : "Aguardando solicitação."}
                                        />

                                        {/* 7. Em Andamento (Montador) */}
                                        <TimelineItem
                                            completed={result.assembly_timeline?.status === 'completed'}
                                            active={!!result.assembly_timeline?.route_created_at}
                                            icon={Hammer}
                                            title="Montador a Caminho"
                                            date={result.assembly_timeline?.route_created_at ? formatDateSimple(result.assembly_timeline.route_created_at) : undefined}
                                            description={result.assembly_timeline?.route_created_at ? "O montador recebeu sua rota. O prazo de conclusão da montagem pode levar até 5 dias úteis." : ""}
                                        />

                                        {/* 8. Montagem Concluída */}
                                        <TimelineItem
                                            completed={result.assembly_timeline?.status === 'completed'}
                                            icon={CheckCircle2}
                                            title="Montagem Concluída"
                                            date={result.assembly_timeline?.completion_date ? formatDate(result.assembly_timeline.completion_date) : undefined}
                                            description={
                                                <>
                                                    <span>
                                                        {result.assembly_timeline?.status === 'completed' ? "Produto montado e pronto para uso!" : "Aguardando finalização."}
                                                    </span>
                                                    <span className="font-semibold text-blue-400 block mt-1">
                                                        Previsão: {formatDateSimple(result.delivery_timeline.forecast_date)}
                                                    </span>
                                                </>
                                            }
                                            isLast={true}
                                        />
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </main>

            <footer className="fixed bottom-0 w-full py-4 text-center text-[10px] text-slate-600 bg-slate-950/80 backdrop-blur border-t border-slate-900">
                <p>Logística operada por parceiros oficiais.</p>
            </footer>
        </div>
    );
}
