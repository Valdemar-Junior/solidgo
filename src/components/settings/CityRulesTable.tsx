import { useState, useEffect } from 'react';
import { supabase } from '../../supabase/client';
import { Loader2, Plus, Trash2, Save, X, Building, Tractor, Zap } from 'lucide-react';
import { toast } from 'sonner';

interface CityRule {
    id: string;
    city_name: string;
    delivery_days: number;
    assembly_days: number;
    rural_delivery_days: number;
    rural_assembly_days: number;
    full_delivery_days: number;
    full_assembly_days: number;
}

export function CityRulesTable() {
    const [rules, setRules] = useState<CityRule[]>([]);
    const [loading, setLoading] = useState(false);

    // New rule state
    const [isAdding, setIsAdding] = useState(false);
    const [newCity, setNewCity] = useState('');

    // Default values
    const [newDelivery, setNewDelivery] = useState(15);
    const [newAssembly, setNewAssembly] = useState(15);

    const [newRuralDelivery, setNewRuralDelivery] = useState(25);
    const [newRuralAssembly, setNewRuralAssembly] = useState(20);

    const [newFullDelivery, setNewFullDelivery] = useState(2);
    const [newFullAssembly, setNewFullAssembly] = useState(5);

    useEffect(() => {
        fetchRules();
    }, []);

    const fetchRules = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('delivery_city_rules')
            .select('*')
            .order('city_name');

        if (error) {
            console.error('Error fetching city rules:', error);
            toast.error('Erro ao carregar cidades');
        } else {
            setRules(data || []);
        }
        setLoading(false);
    };

    const addRule = async () => {
        if (!newCity.trim()) return toast.error('Nome da cidade é obrigatório');

        try {
            const { data, error } = await supabase
                .from('delivery_city_rules')
                .insert({
                    city_name: newCity.trim().toUpperCase(),
                    delivery_days: newDelivery,
                    assembly_days: newAssembly,
                    rural_delivery_days: newRuralDelivery,
                    rural_assembly_days: newRuralAssembly,
                    full_delivery_days: newFullDelivery,
                    full_assembly_days: newFullAssembly
                })
                .select()
                .single();

            if (error) {
                if (error.code === '23505') throw new Error('Cidade já cadastrada'); // Unique violation
                throw error;
            }

            setRules([...rules, data]);
            setIsAdding(false);
            setNewCity('');
            // Reset defaults
            setNewDelivery(15); setNewAssembly(15);
            setNewRuralDelivery(25); setNewRuralAssembly(20);
            setNewFullDelivery(2); setNewFullAssembly(5);

            toast.success('Cidade adicionada!');
        } catch (e: any) {
            toast.error(e.message || 'Erro ao adicionar cidade');
        }
    };

    const deleteRule = async (id: string) => {
        if (!confirm('Tem certeza que deseja remover esta configuração?')) return;

        try {
            const { error } = await supabase
                .from('delivery_city_rules')
                .delete()
                .eq('id', id);

            if (error) throw error;

            setRules(rules.filter(r => r.id !== id));
            toast.success('Regra removida!');
        } catch {
            toast.error('Erro ao remover regra');
        }
    };

    const updateRule = async (id: string, field: keyof CityRule, value: number) => {
        try {
            const { error } = await supabase
                .from('delivery_city_rules')
                .update({ [field]: value })
                .eq('id', id);

            if (error) throw error;

            setRules(rules.map(r => r.id === id ? { ...r, [field]: value } : r));
            toast.success('Atualizado!');
        } catch {
            toast.error('Erro ao atualizar');
        }
    };

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="border-b border-gray-100 bg-gray-50 px-6 py-4 flex items-center justify-between">
                <h2 className="font-bold text-gray-900">Prazos por Cidade</h2>
                <button
                    onClick={() => setIsAdding(true)}
                    disabled={isAdding}
                    className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-1 disabled:opacity-50"
                >
                    <Plus className="h-4 w-4" />
                    Nova Cidade
                </button>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100">
                        <tr>
                            <th className="px-6 py-3 font-medium text-gray-500 w-48">Cidade</th>

                            {/* Urbano */}
                            <th className="px-4 py-3 font-medium text-gray-500 text-center w-32 border-l border-gray-100">
                                <div className="flex items-center justify-center gap-1.5">
                                    <Building className="h-4 w-4 text-blue-500" />
                                    Urbano
                                </div>
                                <div className="text-[10px] text-gray-400 font-normal mt-0.5">Ent | Mont</div>
                            </th>

                            {/* Rural */}
                            <th className="px-4 py-3 font-medium text-gray-500 text-center w-32 border-l border-gray-100 bg-green-50/20">
                                <div className="flex items-center justify-center gap-1.5">
                                    <Tractor className="h-4 w-4 text-green-600" />
                                    Rural
                                </div>
                                <div className="text-[10px] text-gray-400 font-normal mt-0.5">Ent | Mont</div>
                            </th>

                            {/* Full */}
                            <th className="px-4 py-3 font-medium text-gray-500 text-center w-32 border-l border-gray-100 bg-yellow-50/20">
                                <div className="flex items-center justify-center gap-1.5">
                                    <Zap className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                                    Full
                                </div>
                                <div className="text-[10px] text-gray-400 font-normal mt-0.5">Ent | Mont</div>
                            </th>

                            <th className="px-6 py-3 text-right">Ações</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {isAdding && (
                            <tr className="bg-blue-50/50">
                                <td className="px-6 py-3">
                                    <input
                                        autoFocus
                                        type="text"
                                        value={newCity}
                                        onChange={e => setNewCity(e.target.value)}
                                        placeholder="Nome"
                                        className="w-full border-gray-300 rounded-md text-sm px-2 py-1"
                                    />
                                </td>
                                {/* Urbano Inputs */}
                                <td className="px-4 py-3 border-l border-gray-200">
                                    <div className="flex gap-1">
                                        <input type="number" value={newDelivery} onChange={e => setNewDelivery(parseInt(e.target.value) || 0)} className="w-1/2 border-gray-300 rounded text-center px-1 py-1" placeholder="E" />
                                        <input type="number" value={newAssembly} onChange={e => setNewAssembly(parseInt(e.target.value) || 0)} className="w-1/2 border-gray-300 rounded text-center px-1 py-1" placeholder="M" />
                                    </div>
                                </td>
                                {/* Rural Inputs */}
                                <td className="px-4 py-3 border-l border-gray-200 bg-green-50/30">
                                    <div className="flex gap-1">
                                        <input type="number" value={newRuralDelivery} onChange={e => setNewRuralDelivery(parseInt(e.target.value) || 0)} className="w-1/2 border-green-200 rounded text-center px-1 py-1" placeholder="E" />
                                        <input type="number" value={newRuralAssembly} onChange={e => setNewRuralAssembly(parseInt(e.target.value) || 0)} className="w-1/2 border-green-200 rounded text-center px-1 py-1" placeholder="M" />
                                    </div>
                                </td>
                                {/* Full Inputs */}
                                <td className="px-4 py-3 border-l border-gray-200 bg-yellow-50/30">
                                    <div className="flex gap-1">
                                        <input type="number" value={newFullDelivery} onChange={e => setNewFullDelivery(parseInt(e.target.value) || 0)} className="w-1/2 border-yellow-200 rounded text-center px-1 py-1" placeholder="E" />
                                        <input type="number" value={newFullAssembly} onChange={e => setNewFullAssembly(parseInt(e.target.value) || 0)} className="w-1/2 border-yellow-200 rounded text-center px-1 py-1" placeholder="M" />
                                    </div>
                                </td>

                                <td className="px-6 py-3 text-right">
                                    <div className="flex items-center justify-end gap-2">
                                        <button onClick={addRule} className="p-1 text-green-600 hover:bg-green-100 rounded"><Save className="h-4 w-4" /></button>
                                        <button onClick={() => setIsAdding(false)} className="p-1 text-gray-500 hover:bg-gray-100 rounded"><X className="h-4 w-4" /></button>
                                    </div>
                                </td>
                            </tr>
                        )}

                        {loading ? (
                            <tr><td colSpan={5} className="text-center py-8 text-gray-400"><Loader2 className="animate-spin h-6 w-6 mx-auto" />Carregando...</td></tr>
                        ) : rules.length === 0 && !isAdding ? (
                            <tr><td colSpan={5} className="text-center py-8 text-gray-400">Nenhuma cidade configurada.</td></tr>
                        ) : (
                            rules.map(rule => (
                                <tr key={rule.id} className="hover:bg-gray-50/50 transition-colors">
                                    <td className="px-6 py-3 font-medium text-gray-900">{rule.city_name}</td>

                                    {/* Urbano */}
                                    <td className="px-4 py-3 border-l border-gray-100">
                                        <div className="flex gap-1">
                                            <input
                                                type="number"
                                                defaultValue={rule.delivery_days}
                                                onBlur={(e) => { const v = parseInt(e.target.value); if (v !== rule.delivery_days) updateRule(rule.id, 'delivery_days', v) }}
                                                className="w-1/2 bg-transparent hover:bg-white border border-transparent hover:border-gray-200 rounded px-1 text-center text-sm"
                                            />
                                            <input
                                                type="number"
                                                defaultValue={rule.assembly_days}
                                                onBlur={(e) => { const v = parseInt(e.target.value); if (v !== rule.assembly_days) updateRule(rule.id, 'assembly_days', v) }}
                                                className="w-1/2 bg-transparent hover:bg-white border border-transparent hover:border-gray-200 rounded px-1 text-center text-sm"
                                            />
                                        </div>
                                    </td>

                                    {/* Rural */}
                                    <td className="px-4 py-3 border-l border-gray-100 bg-green-50/10">
                                        <div className="flex gap-1">
                                            <input
                                                type="number"
                                                defaultValue={rule.rural_delivery_days}
                                                onBlur={(e) => { const v = parseInt(e.target.value); if (v !== rule.rural_delivery_days) updateRule(rule.id, 'rural_delivery_days', v) }}
                                                className="w-1/2 bg-transparent hover:bg-white border border-transparent hover:border-green-200 rounded px-1 text-center text-sm text-green-700"
                                            />
                                            <input
                                                type="number"
                                                defaultValue={rule.rural_assembly_days}
                                                onBlur={(e) => { const v = parseInt(e.target.value); if (v !== rule.rural_assembly_days) updateRule(rule.id, 'rural_assembly_days', v) }}
                                                className="w-1/2 bg-transparent hover:bg-white border border-transparent hover:border-green-200 rounded px-1 text-center text-sm text-green-700"
                                            />
                                        </div>
                                    </td>

                                    {/* Full */}
                                    <td className="px-4 py-3 border-l border-gray-100 bg-yellow-50/10">
                                        <div className="flex gap-1">
                                            <input
                                                type="number"
                                                defaultValue={rule.full_delivery_days}
                                                onBlur={(e) => { const v = parseInt(e.target.value); if (v !== rule.full_delivery_days) updateRule(rule.id, 'full_delivery_days', v) }}
                                                className="w-1/2 bg-transparent hover:bg-white border border-transparent hover:border-yellow-200 rounded px-1 text-center text-sm text-yellow-700"
                                            />
                                            <input
                                                type="number"
                                                defaultValue={rule.full_assembly_days}
                                                onBlur={(e) => { const v = parseInt(e.target.value); if (v !== rule.full_assembly_days) updateRule(rule.id, 'full_assembly_days', v) }}
                                                className="w-1/2 bg-transparent hover:bg-white border border-transparent hover:border-yellow-200 rounded px-1 text-center text-sm text-yellow-700"
                                            />
                                        </div>
                                    </td>

                                    <td className="px-6 py-3 text-right">
                                        <button onClick={() => deleteRule(rule.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 className="h-4 w-4" /></button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
