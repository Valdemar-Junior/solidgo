import { useEffect } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    PieChart, Pie, Cell, FunnelChart, Funnel, LabelList
} from 'recharts';
import {
    Trophy,
    MapPin,
    Package,
    Clock,
    Truck,
    Hammer,
    CheckCircle2,
    TrendingUp,
    AlertOctagon
} from 'lucide-react';
import { useReportsData } from '../../hooks/useReportsData';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];
const STATUS_COLORS = {
    waiting: '#F59E0B', // Amber
    ready: '#3B82F6', // Blue
    done: '#10B981' // Green
};

export default function Reports() {
    const { data, loading, fetchReports } = useReportsData();

    useEffect(() => {
        fetchReports();
    }, [fetchReports]);

    if (loading || !data) {
        return (
            <div className="flex h-screen items-center justify-center bg-gray-50">
                <div className="text-center">
                    <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-gray-500">Calculando métricas em tempo real...</p>
                </div>
            </div>
        );
    }

    // Transform Data for Charts
    const funnelData = [
        { value: data.funnel.imported, name: 'Importados', fill: '#8884d8' },
        { value: data.funnel.routing, name: 'Em Rota', fill: '#82ca9d' },
        { value: data.funnel.completed, name: 'Entregues', fill: '#10B981' }
    ];

    const assemblyData = [
        { name: 'Aguard. Entrega', value: data.assemblyStatus.waitingDelivery, color: STATUS_COLORS.waiting },
        { name: 'Pronto p/ Montar', value: data.assemblyStatus.readyToAssemble, color: STATUS_COLORS.ready },
        { name: 'Montado', value: data.assemblyStatus.assembled, color: STATUS_COLORS.done },
    ];

    return (
        <div className="min-h-screen bg-gray-50/50 pb-10">
            {/* Header */}
            <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center h-20">
                        <div className="flex items-center gap-4">
                            <div className="bg-gradient-to-br from-orange-500 to-orange-600 p-2 rounded-lg">
                                <TrendingUp className="h-6 w-6 text-white" />
                            </div>
                            <div>
                                <h1 className="text-xl font-bold text-gray-900 leading-tight">Relatórios & Inteligência</h1>
                                <p className="text-sm text-gray-500">Visão geral do mês</p>
                            </div>
                        </div>
                        <button
                            onClick={fetchReports}
                            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Atualizar dados"
                        >
                            <Clock className="h-5 w-5" />
                        </button>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">

                {/* KPI Row */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <KPICard
                        title="Total Pedidos (Mês)"
                        value={data.totalOrdersMonth}
                        icon={Package}
                        color="blue"
                    />
                    <KPICard
                        title="Entregas Concluídas"
                        value={data.deliveredOrdersMonth}
                        icon={CheckCircle2}
                        color="green"
                    />
                    <KPICard
                        title="Fila de Montagem"
                        value={data.assemblyQueue}
                        subtext="Entregues, aguardando montador"
                        icon={Hammer}
                        color="purple"
                    />
                    <KPICard
                        title="Alertas / Retornos"
                        value={data.funnel.returned}
                        icon={AlertOctagon}
                        color="red"
                    />
                </div>

                {/* Charts Row 1: Geography & Funnel */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Neighborhoods Bar Chart */}
                    <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
                        <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
                            <MapPin className="h-5 w-5 text-gray-400" />
                            Top 10 Bairros (Entregas)
                        </h3>
                        <div className="h-80 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={data.ordersByNeighborhood} layout="vertical" margin={{ left: 40 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                                    <XAxis type="number" hide />
                                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                                    <Tooltip cursor={{ fill: '#f3f4f6' }} />
                                    <Bar dataKey="value" fill="#3B82F6" radius={[0, 4, 4, 0]} barSize={20} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Assembly Pie Chart */}
                    <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex flex-col">
                        <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
                            <Hammer className="h-5 w-5 text-gray-400" />
                            Status da Montagem (Visão Geral)
                        </h3>
                        <div className="h-80 w-full flex-1 relative">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={assemblyData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={100}
                                        paddingAngle={5}
                                        dataKey="value"
                                    >
                                        {assemblyData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                        ))}
                                    </Pie>
                                    <Tooltip />
                                    <Legend verticalAlign="bottom" height={36} />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
                                <span className="text-3xl font-bold text-gray-700">{data.assemblyQueue}</span>
                                <p className="text-xs text-gray-400 font-semibold uppercase">Na Fila</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Charts Row 2: Orders by City AND Status (Stacked) */}
                <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
                    <h3 className="text-lg font-bold text-gray-900 mb-2 flex items-center gap-2">
                        <Truck className="h-5 w-5 text-gray-400" />
                        Pedidos por Cidade (Top 10)
                    </h3>
                    <p className="text-sm text-gray-500 mb-6">Distribuição por status de entrega</p>
                    <div className="h-80 w-full">
                        {data.ordersByCityAndStatus.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={data.ordersByCityAndStatus} layout="vertical" margin={{ left: 60 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                                    <XAxis type="number" />
                                    <YAxis type="category" dataKey="city" width={100} tick={{ fontSize: 11 }} />
                                    <Tooltip />
                                    <Legend verticalAlign="bottom" height={36} />
                                    <Bar dataKey="aguardando" stackId="a" name="Aguardando Rota" fill="#F59E0B" radius={[0, 0, 0, 0]} />
                                    <Bar dataKey="emRota" stackId="a" name="Em Rota" fill="#3B82F6" radius={[0, 0, 0, 0]} />
                                    <Bar dataKey="entregue" stackId="a" name="Entregue" fill="#10B981" radius={[0, 4, 4, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-gray-400">
                                Nenhum dado de cidade disponível.
                            </div>
                        )}
                    </div>
                </div>

                {/* Charts Row 3: Driver Competition */}
                <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                            <Trophy className="h-5 w-5 text-yellow-500" />
                            Competição de Velocidade (Motoristas)
                        </h3>
                        <span className="bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded-full font-medium">Últimos 90 dias</span>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                    <th className="pb-3 pl-4">Posição</th>
                                    <th className="pb-3">Motorista</th>
                                    <th className="pb-3 text-center">Entregas Realizadas</th>
                                    <th className="pb-3 text-center">Tempo Médio (Entrega)</th>
                                    <th className="pb-3 text-right pr-4">Score</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50 text-sm">
                                {data.driverRanking.map((driver, idx) => (
                                    <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                        <td className="py-4 pl-4 font-medium text-gray-500 w-16">
                                            {idx === 0 ? <span className="text-2xl">🥇</span> :
                                                idx === 1 ? <span className="text-2xl">🥈</span> :
                                                    idx === 2 ? <span className="text-2xl">🥉</span> :
                                                        `#${idx + 1}`}
                                        </td>
                                        <td className="py-4 font-medium text-gray-900">
                                            {driver.name}
                                        </td>
                                        <td className="py-4 text-center text-gray-600">
                                            <span className="bg-gray-100 px-2 py-1 rounded-md font-bold">{driver.deliveries}</span>
                                        </td>
                                        <td className="py-4 text-center">
                                            <div className="flex items-center justify-center gap-1 text-blue-600 font-medium">
                                                <Clock className="h-4 w-4" />
                                                {driver.avgTimeMinutes > 0 ? `${driver.avgTimeMinutes} min` : '-'}
                                            </div>
                                        </td>
                                        <td className="py-4 text-right pr-4 font-mono text-gray-400">
                                            {Math.round(driver.score)} pts
                                        </td>
                                    </tr>
                                ))}
                                {data.driverRanking.length === 0 && (
                                    <tr><td colSpan={5} className="py-8 text-center text-gray-400">
                                        Nenhuma rota concluída nos últimos 90 dias para gerar ranking.
                                    </td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

            </main>
        </div>
    );
}

function KPICard({ title, value, icon: Icon, color, subtext }: any) {
    const colorClasses: any = {
        blue: 'bg-blue-50 text-blue-600',
        green: 'bg-green-50 text-green-600',
        purple: 'bg-purple-50 text-purple-600',
        red: 'bg-red-50 text-red-600'
    };

    return (
        <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start">
                <div>
                    <p className="text-sm font-medium text-gray-500">{title}</p>
                    <h3 className="text-3xl font-bold text-gray-900 mt-2">{value}</h3>
                    {subtext && <p className="text-xs text-gray-400 mt-1">{subtext}</p>}
                </div>
                <div className={`p-3 rounded-xl ${colorClasses[color] || 'bg-gray-50 text-gray-600'}`}>
                    <Icon className="h-6 w-6" />
                </div>
            </div>
        </div>
    );
}
