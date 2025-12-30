import { useState, useCallback } from 'react';
import { supabase } from '../supabase/client';

export interface ReportsData {
    // KPIs
    totalOrdersMonth: number;
    deliveredOrdersMonth: number;
    successRate: number;
    assemblyQueue: number; // Pedidos com montagem pendente

    // Charts
    ordersByNeighborhood: { name: string; value: number }[];
    ordersByCity: { name: string; value: number }[];
    // Stacked Bar: City with breakdown by status
    ordersByCityAndStatus: {
        city: string;
        aguardando: number;
        emRota: number;
        entregue: number
    }[];
    importedByCity: { name: string; value: number }[]; // Keep for now, but might be deprecated

    // Funnel
    funnel: {
        imported: number;
        routing: number; // Pending in routes
        delivering: number; // In Progress
        completed: number;
        returned: number;
    };

    // Assembly Status
    assemblyStatus: {
        waitingDelivery: number; // Order pending/delivering
        readyToAssemble: number; // Order delivered, Assembly Pending
        assembled: number;
    };

    // Driver Ranking
    driverRanking: {
        name: string;
        deliveries: number;
        avgTimeMinutes: number; // Calculated average
        score: number; // Custom efficiency score
    }[];
}

export function useReportsData() {
    const [data, setData] = useState<ReportsData | null>(null);
    const [loading, setLoading] = useState(false);

    const fetchReports = useCallback(async () => {
        setLoading(true);
        try {
            const now = new Date();
            // Go back 90 days to ensure we have data for the competition
            const startDate = new Date();
            startDate.setDate(now.getDate() - 90);
            const startDateStr = startDate.toISOString();

            // 1. Fetch Orders (Last 90 days + Pending ones from before)
            const { data: orders } = await supabase
                .from('orders')
                .select('id, status, address_json, created_at')
                .gte('created_at', startDateStr);

            const { data: allPending } = await supabase
                .from('orders')
                .select('status, address_json')
                .in('status', ['imported', 'pending']); // Check both potential initial statuses

            console.log('DEBUG: Pending/Imported Orders:', allPending?.length);
            if (allPending && allPending.length > 0) {
                console.log('DEBUG: Status distribution:', allPending.map(o => o.status));
                console.log('DEBUG: Sample Address:', allPending[0].address_json);
            }

            // 2. Fetch Routes (Last 90 days)
            const { data: routes } = await supabase
                .from('routes')
                .select(`
                    id, 
                    driver:driver_id (name), 
                    status,
                    route_orders (delivered_at, status)
                `)
                .eq('status', 'completed')
                .gte('created_at', startDateStr);

            // 3. Fetch Assembly Products (All active)
            const { data: assemblyProds } = await supabase
                .from('assembly_products')
                .select(`
                    id, status,
                    order:order_id (status)
                 `);

            // --- Aggregations ---

            // A. Geography
            const neighborhoods: Record<string, number> = {};
            const cities: Record<string, number> = {};

            orders?.forEach((o: any) => {
                const n = o.address_json?.neighborhood || 'N/D';
                const c = o.address_json?.city || 'N/D';
                if (n !== 'N/D') neighborhoods[n] = (neighborhoods[n] || 0) + 1;
                if (c !== 'N/D') cities[c] = (cities[c] || 0) + 1;
            });

            const importedCities: Record<string, number> = {};
            allPending?.forEach((o: any) => {
                const c = o.address_json?.city || 'Cidade Determinada';
                importedCities[c] = (importedCities[c] || 0) + 1;
            });

            // A2. City by Status (For Stacked Bar Chart)
            // Use ALL orders from the last 90 days, group by city, then by status
            const cityStatusMap: Record<string, { aguardando: number; emRota: number; entregue: number }> = {};

            // First, add pending/imported
            allPending?.forEach((o: any) => {
                const c = o.address_json?.city || 'Desconhecida';
                if (!cityStatusMap[c]) cityStatusMap[c] = { aguardando: 0, emRota: 0, entregue: 0 };
                cityStatusMap[c].aguardando++;
            });

            // Then, add others from the 90-day window
            orders?.forEach((o: any) => {
                const c = o.address_json?.city || 'Desconhecida';
                if (!cityStatusMap[c]) cityStatusMap[c] = { aguardando: 0, emRota: 0, entregue: 0 };
                if (o.status === 'assigned') {
                    cityStatusMap[c].emRota++;
                } else if (o.status === 'delivered') {
                    cityStatusMap[c].entregue++;
                }
                // Note: 'imported' from 90-day window already counted if they were pending
            });

            const ordersByCityAndStatus = Object.entries(cityStatusMap)
                .map(([city, stats]) => ({ city, ...stats }))
                .sort((a, b) => (b.aguardando + b.emRota + b.entregue) - (a.aguardando + a.emRota + a.entregue))
                .slice(0, 10);

            // B. Funnel
            const funnel = {
                imported: allPending?.length || 0,
                routing: 0,
                delivering: 0,
                completed: 0,
                returned: 0
            };

            orders?.forEach((o: any) => {
                if (o.status === 'assigned') funnel.routing++;
                if (o.status === 'delivered') funnel.completed++;
                if (o.status === 'returned') funnel.returned++;
            });

            // C. Driver Stats (Time betweeen deliveries)
            const driverStats: Record<string, { totalTime: number; countDiffs: number; deliveries: number }> = {};

            routes?.forEach((r: any) => {
                const driverName = r.driver?.name || 'Desconhecido';
                if (!driverStats[driverName]) driverStats[driverName] = { totalTime: 0, countDiffs: 0, deliveries: 0 };

                const deliveries = r.route_orders
                    .filter((ro: any) => ro.status === 'delivered' && ro.delivered_at)
                    .sort((a: any, b: any) => new Date(a.delivered_at).getTime() - new Date(b.delivered_at).getTime());

                driverStats[driverName].deliveries += deliveries.length;

                for (let i = 0; i < deliveries.length - 1; i++) {
                    const t1 = new Date(deliveries[i].delivered_at).getTime();
                    const t2 = new Date(deliveries[i + 1].delivered_at).getTime();
                    const diffMinutes = (t2 - t1) / 60000;

                    // Filter outliers (e.g. > 4 hours might be a break)
                    if (diffMinutes > 0 && diffMinutes < 240) {
                        driverStats[driverName].totalTime += diffMinutes;
                        driverStats[driverName].countDiffs++;
                    }
                }
            });

            const driverRanking = Object.entries(driverStats).map(([name, stat]) => {
                const avg = stat.countDiffs > 0 ? Math.round(stat.totalTime / stat.countDiffs) : 0;
                return {
                    name,
                    deliveries: stat.deliveries,
                    avgTimeMinutes: avg,
                    score: stat.deliveries * 10 - avg
                };
            }).sort((a, b) => b.deliveries - a.deliveries);


            // D. Assembly Status
            const assemblyStatus = {
                waitingDelivery: 0,
                readyToAssemble: 0,
                assembled: 0
            };

            assemblyProds?.forEach((ap: any) => {
                if (ap.status === 'completed') {
                    assemblyStatus.assembled++;
                } else {
                    const orderStatus = ap.order?.status;
                    if (orderStatus === 'delivered') {
                        assemblyStatus.readyToAssemble++;
                    } else {
                        assemblyStatus.waitingDelivery++;
                    }
                }
            });


            setData({
                totalOrdersMonth: orders?.length || 0,
                deliveredOrdersMonth: funnel.completed,
                successRate: orders?.length ? Math.round((funnel.completed / orders.length) * 100) : 0,
                assemblyQueue: assemblyStatus.readyToAssemble,
                ordersByNeighborhood: Object.entries(neighborhoods)
                    .map(([name, value]) => ({ name, value }))
                    .sort((a, b) => b.value - a.value)
                    .slice(0, 10),
                ordersByCity: Object.entries(cities)
                    .map(([name, value]) => ({ name, value }))
                    .sort((a, b) => b.value - a.value),
                importedByCity: Object.entries(importedCities)
                    .map(([name, value]) => ({ name, value }))
                    .sort((a, b) => b.value - a.value),
                ordersByCityAndStatus,
                funnel,
                assemblyStatus,
                driverRanking
            });

        } catch (error) {
            console.error('Error fetching reports:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    return { data, loading, fetchReports };
}
