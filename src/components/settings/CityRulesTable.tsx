import { useState, useEffect } from 'react';
import { supabase } from '../../supabase/client';
import { Loader2, Plus, Trash2, Save, X } from 'lucide-react';
import { toast } from 'sonner';

interface CityRule {
    id: string;
    city_name: string;
    delivery_days: number;
    assembly_days: number;
}

export function CityRulesTable() {
    const [rules, setRules] = useState<CityRule[]>([]);
    const [loading, setLoading] = useState(false);

    // New rule state
    const [isAdding, setIsAdding] = useState(false);
    const [newCity, setNewCity] = useState('');
    const [newDelivery, setNewDelivery] = useState(15);
    const [newAssembly, setNewAssembly] = useState(15);

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
                    assembly_days: newAssembly
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
            setNewDelivery(15);
            setNewAssembly(15);
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

    const updateRule = async (id: string, field: 'delivery_days' | 'assembly_days', value: number) => {
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
                            <th className="px-6 py-3 font-medium text-gray-500">Cidade</th>
                            <th className="px-6 py-3 font-medium text-gray-500 w-32">Entrega (dias)</th>
                            <th className="px-6 py-3 font-medium text-gray-500 w-32">Montagem (dias)</th>
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
                                        placeholder="Nome da Cidade"
                                        className="w-full border-gray-300 rounded-md text-sm px-2 py-1"
                                    />
                                </td>
                                <td className="px-6 py-3">
                                    <input
                                        type="number"
                                        value={newDelivery}
                                        onChange={e => setNewDelivery(parseInt(e.target.value) || 0)}
                                        className="w-20 border-gray-300 rounded-md text-sm px-2 py-1"
                                    />
                                </td>
                                <td className="px-6 py-3">
                                    <input
                                        type="number"
                                        value={newAssembly}
                                        onChange={e => setNewAssembly(parseInt(e.target.value) || 0)}
                                        className="w-20 border-gray-300 rounded-md text-sm px-2 py-1"
                                    />
                                </td>
                                <td className="px-6 py-3 text-right">
                                    <div className="flex items-center justify-end gap-2">
                                        <button onClick={addRule} className="p-1 text-green-600 hover:bg-green-100 rounded">
                                            <Save className="h-4 w-4" />
                                        </button>
                                        <button onClick={() => setIsAdding(false)} className="p-1 text-gray-500 hover:bg-gray-100 rounded">
                                            <X className="h-4 w-4" />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        )}

                        {loading ? (
                            <tr>
                                <td colSpan={4} className="px-6 py-8 text-center text-gray-400">
                                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                                    Carregando...
                                </td>
                            </tr>
                        ) : rules.length === 0 && !isAdding ? (
                            <tr>
                                <td colSpan={4} className="px-6 py-8 text-center text-gray-400">
                                    Nenhuma cidade configurada ainda.
                                </td>
                            </tr>
                        ) : (
                            rules.map(rule => (
                                <tr key={rule.id} className="hover:bg-gray-50/50 transition-colors">
                                    <td className="px-6 py-3 font-medium text-gray-900">{rule.city_name}</td>
                                    <td className="px-6 py-3">
                                        <input
                                            type="number"
                                            defaultValue={rule.delivery_days}
                                            onBlur={(e) => {
                                                const val = parseInt(e.target.value);
                                                if (val !== rule.delivery_days) updateRule(rule.id, 'delivery_days', val);
                                            }}
                                            className="w-20 bg-transparent border-transparent hover:border-gray-200 focus:border-blue-500 rounded px-2 py-1 text-sm transition-all"
                                        />
                                    </td>
                                    <td className="px-6 py-3">
                                        <input
                                            type="number"
                                            defaultValue={rule.assembly_days}
                                            onBlur={(e) => {
                                                const val = parseInt(e.target.value);
                                                if (val !== rule.assembly_days) updateRule(rule.id, 'assembly_days', val);
                                            }}
                                            className="w-20 bg-transparent border-transparent hover:border-gray-200 focus:border-blue-500 rounded px-2 py-1 text-sm transition-all"
                                        />
                                    </td>
                                    <td className="px-6 py-3 text-right">
                                        <button
                                            onClick={() => deleteRule(rule.id)}
                                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                            title="Remover"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
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
