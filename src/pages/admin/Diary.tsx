import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../../supabase/client';
import { useNavigate } from 'react-router-dom';
import {
    Calendar,
    Plus,
    Search,
    Truck,
    Hammer,
    StickyNote,
    User,
    Hash,
    X,
    Save,
    Clock,
    Pencil,
    ArrowLeft
} from 'lucide-react';
import { format, subDays, parseISO, startOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import DatePicker, { registerLocale } from 'react-datepicker';

registerLocale('pt-BR', ptBR);

type DiaryEntry = {
    id: string;
    created_at: string;
    date: string;
    type: 'Entrega' | 'Montagem' | 'Geral';
    order_ref: string;
    responsible_staff: string;
    content: string;
    tags: string[];
};

const PAGE_SIZE = 20;

export default function Diary() {
    const navigate = useNavigate();
    const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
    const [dateRange, setDateRange] = useState<[Date | null, Date | null]>(() => {
        const today = new Date();
        return [today, today];
    });
    const [entries, setEntries] = useState<DiaryEntry[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const [loading, setLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [filterType, setFilterType] = useState<'all' | DiaryEntry['type']>('all');
    const [responsibleInput, setResponsibleInput] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [debouncedResponsible, setDebouncedResponsible] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [formData, setFormData] = useState({
        type: 'Geral',
        order_ref: '',
        responsible_staff: '',
        content: ''
    });
    const requestIdRef = useRef(0);
    const [rangeStart, rangeEnd] = dateRange;
    const isRangeMode = Boolean(rangeStart && rangeEnd);
    const hasDateFilter = Boolean(rangeStart || rangeEnd);
    const isSingleDayRange = Boolean(
        rangeStart &&
        rangeEnd &&
        format(rangeStart, 'yyyy-MM-dd') === format(rangeEnd, 'yyyy-MM-dd')
    );
    const hasMoreEntries = entries.length < totalCount;
    const responsibleSuggestions = useMemo(
        () => [...new Set(entries.map(entry => entry.responsible_staff?.trim()).filter(Boolean))],
        [entries]
    );

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            setDebouncedResponsible(responsibleInput.trim());
        }, 300);

        return () => clearTimeout(timeoutId);
    }, [responsibleInput]);

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            setDebouncedSearch(searchInput.trim());
        }, 300);

        return () => clearTimeout(timeoutId);
    }, [searchInput]);

    // Fetch data when filters change
    useEffect(() => {
        fetchEntries();
    }, [selectedDate, rangeStart, rangeEnd, filterType, debouncedResponsible, debouncedSearch, visibleCount]);

    const fetchEntries = async () => {
        const requestId = ++requestIdRef.current;

        try {
            setLoading(true);
            const selectedDateIso = format(selectedDate, 'yyyy-MM-dd');
            const rangeStartIso = rangeStart ? format(rangeStart, 'yyyy-MM-dd') : null;
            const rangeEndIso = rangeEnd ? format(rangeEnd, 'yyyy-MM-dd') : null;

            let query = supabase
                .from('operational_diary')
                .select('*', { count: 'exact' });

            if (rangeStartIso && rangeEndIso) {
                query = query
                    .gte('date', rangeStartIso)
                    .lte('date', rangeEndIso);
            } else if (rangeStartIso) {
                query = query
                    .eq('date', rangeStartIso);
            } else {
                query = query
                    .eq('date', selectedDateIso);
            }

            if (filterType !== 'all') {
                query = query.eq('type', filterType);
            }

            if (debouncedResponsible) {
                query = query.ilike('responsible_staff', `%${debouncedResponsible}%`);
            }

            if (debouncedSearch) {
                query = query.ilike('content', `%${debouncedSearch}%`);
            }

            const { data, error, count } = await query
                .order('date', { ascending: false })
                .order('created_at', { ascending: false })
                .range(0, Math.max(visibleCount - 1, 0));

            if (requestId !== requestIdRef.current) {
                return;
            }

            if (error) throw error;
            setEntries(data || []);
            setTotalCount(count || 0);
        } catch (error) {
            console.error('Erro ao buscar diário:', error);
            toast.error('Erro ao carregar anotações');
        } finally {
            if (requestId === requestIdRef.current) {
                setLoading(false);
            }
        }
    };

    const handleEdit = (entry: DiaryEntry) => {
        setEditingId(entry.id);
        setFormData({
            type: entry.type,
            order_ref: entry.order_ref || '',
            responsible_staff: entry.responsible_staff || '',
            content: entry.content
        });
        setIsModalOpen(true);
    };

    const openNewModal = () => {
        setEditingId(null);
        setFormData({
            type: 'Geral',
            order_ref: '',
            responsible_staff: '',
            content: ''
        });
        setIsModalOpen(true);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (editingId) {
                // Update existing entry
                const { error } = await supabase
                    .from('operational_diary')
                    .update({
                        ...formData,
                        // Don't update date, or update it if you wish. Keeping same date for now or could add date field to form.
                        // Assuming date stays same for simplicity, or user would delete and re-create.
                        // Ideally could allow changing date but kept it simple.
                    })
                    .eq('id', editingId);

                if (error) throw error;
                toast.success('Anotação atualizada!');
            } else {
                // Create new entry
                const { error } = await supabase
                    .from('operational_diary')
                    .insert([{
                        date: format(selectedDate, 'yyyy-MM-dd'),
                        ...formData,
                        tags: []
                    }]);

                if (error) throw error;
                toast.success('Anotação salva!');
            }

            setIsModalOpen(false);
            setEditingId(null);
            setFormData({ type: 'Geral', order_ref: '', responsible_staff: '', content: '' });
            fetchEntries();
        } catch (error) {
            console.error('Erro ao salvar:', error);
            toast.error('Erro ao salvar anotação');
        }
    };

    const getTypeIcon = (type: string) => {
        switch (type) {
            case 'Entrega': return <Truck className="h-5 w-5 text-blue-500" />;
            case 'Montagem': return <Hammer className="h-5 w-5 text-purple-500" />;
            default: return <StickyNote className="h-5 w-5 text-yellow-500" />;
        }
    };

    const getTypeColor = (type: string) => {
        switch (type) {
            case 'Entrega': return 'bg-blue-50 text-blue-700 border-blue-100';
            case 'Montagem': return 'bg-purple-50 text-purple-700 border-purple-100';
            default: return 'bg-yellow-50 text-yellow-700 border-yellow-100';
        }
    };

    const setTodayPeriod = () => {
        const today = new Date();
        setDateRange([today, today]);
        setSelectedDate(today);
        setVisibleCount(PAGE_SIZE);
    };

    const applyLastDays = (days: number) => {
        const endDate = new Date();
        const startDate = subDays(endDate, days - 1);
        setDateRange([startDate, endDate]);
        setSelectedDate(endDate);
        setVisibleCount(PAGE_SIZE);
    };

    const applyCurrentMonth = () => {
        const today = new Date();
        setDateRange([startOfMonth(today), today]);
        setSelectedDate(today);
        setVisibleCount(PAGE_SIZE);
    };

    return (
        <div className="min-h-screen bg-gray-50/50 p-6">
            <div className="max-w-5xl mx-auto space-y-6">

                {/* Header & Date Navigation */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => navigate(-1)}
                            className="p-2 -ml-2 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors"
                            title="Voltar"
                        >
                            <ArrowLeft className="h-6 w-6" />
                        </button>
                        <div className="bg-gradient-to-br from-emerald-500 to-teal-600 p-3 rounded-xl shadow-sm">
                            <Calendar className="h-6 w-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Diário de Bordo</h1>
                            <p className="text-sm text-gray-500">Registro operacional diário</p>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={openNewModal}
                            className="flex items-center gap-2 bg-gray-900 text-white px-5 py-2.5 rounded-xl hover:bg-gray-800 transition-colors shadow-lg shadow-gray-200"
                        >
                            <Plus className="h-5 w-5" />
                            Nova Anotação
                        </button>
                    </div>
                </div>

                <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-gray-500 uppercase">Período (opcional)</label>
                            <DatePicker
                                selectsRange
                                startDate={rangeStart}
                                endDate={rangeEnd}
                                onChange={(update: [Date | null, Date | null]) => {
                                    if (!update[0] && !update[1]) {
                                        setTodayPeriod();
                                        return;
                                    }

                                    setDateRange(update);
                                    setSelectedDate(update[1] ?? update[0] ?? new Date());
                                    setVisibleCount(PAGE_SIZE);
                                }}
                                isClearable
                                locale="pt-BR"
                                dateFormat="dd/MM/yyyy"
                                placeholderText="Selecione o período"
                                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-gray-700 text-sm"
                                wrapperClassName="w-full"
                            />
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-gray-500 uppercase">Tipo</label>
                            <select
                                value={filterType}
                                onChange={(e) => {
                                    setFilterType(e.target.value as 'all' | DiaryEntry['type']);
                                    setVisibleCount(PAGE_SIZE);
                                }}
                                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-gray-700 text-sm"
                            >
                                <option value="all">Todos</option>
                                <option value="Geral">Geral</option>
                                <option value="Entrega">Entrega</option>
                                <option value="Montagem">Montagem</option>
                            </select>
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-gray-500 uppercase">Responsável</label>
                            <input
                                type="text"
                                list="diary-responsible-suggestions"
                                placeholder="Filtrar por responsável"
                                value={responsibleInput}
                                onChange={(e) => {
                                    setResponsibleInput(e.target.value);
                                    setVisibleCount(PAGE_SIZE);
                                }}
                                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-gray-700 text-sm"
                            />
                            <datalist id="diary-responsible-suggestions">
                                {responsibleSuggestions.map(name => (
                                    <option key={name} value={name} />
                                ))}
                            </datalist>
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-gray-500 uppercase">Texto da Anotação</label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <input
                                    type="text"
                                    placeholder="Buscar no texto"
                                    value={searchInput}
                                    onChange={(e) => {
                                        setSearchInput(e.target.value);
                                        setVisibleCount(PAGE_SIZE);
                                    }}
                                    className="w-full pl-9 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-gray-700 text-sm"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2 md:justify-end">
                            <button
                                type="button"
                                onClick={() => applyLastDays(7)}
                                className="px-3 py-2 text-sm font-medium rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                            >
                                Últimos 7 dias
                            </button>
                            <button
                                type="button"
                                onClick={() => applyLastDays(30)}
                                className="px-3 py-2 text-sm font-medium rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                            >
                                Últimos 30 dias
                            </button>
                            <button
                                type="button"
                                onClick={applyCurrentMonth}
                                className="px-3 py-2 text-sm font-medium rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                            >
                                Este mês
                            </button>
                            <button
                                type="button"
                                onClick={setTodayPeriod}
                                className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 transition-colors"
                            >
                                Hoje
                            </button>
                    </div>

                    <div className="text-sm text-gray-500">
                        {isRangeMode && !isSingleDayRange ? (
                            <span>
                                Exibindo anotações de <strong>{format(rangeStart!, 'dd/MM/yyyy')}</strong> até <strong>{format(rangeEnd!, 'dd/MM/yyyy')}</strong>.
                            </span>
                        ) : hasDateFilter && rangeStart ? (
                            <span>
                                Exibindo anotações de <strong>{format(rangeStart, 'dd/MM/yyyy')}</strong>.
                            </span>
                        ) : (
                            <span>
                                Exibindo anotações de <strong>{format(selectedDate, 'dd/MM/yyyy')}</strong>.
                            </span>
                        )}
                    </div>
                </div>

                {/* Content Area */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                    {/* Summary / Stats Column (Optional - kept simple for now) */}
                    <div className="lg:col-span-3">
                        <div className="space-y-4">
                            <div className="text-sm text-gray-500">
                                {loading
                                    ? 'Carregando anotações...'
                                    : `${entries.length} de ${totalCount} ${totalCount === 1 ? 'anotação encontrada' : 'anotações encontradas'}`}
                            </div>

                            {loading ? (
                                <div className="text-center py-12">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500 mx-auto"></div>
                                    <p className="mt-2 text-gray-500">Carregando anotações...</p>
                                </div>
                            ) : entries.length === 0 ? (
                                <div className="text-center py-16 bg-white rounded-3xl border border-dashed border-gray-200">
                                    <div className="mx-auto w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                                        <StickyNote className="h-8 w-8 text-gray-300" />
                                    </div>
                                    <h3 className="text-lg font-medium text-gray-900">
                                        {isRangeMode || hasDateFilter ? 'Nenhuma anotação no período selecionado' : 'Nenhuma anotação para este dia'}
                                    </h3>
                                    <p className="text-gray-500">Clique em "Nova Anotação" para começar o registro.</p>
                                </div>
                            ) : (
                                <div className="space-y-6">
                                    <div className="relative pl-8 space-y-8 before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-gray-200/60">
                                        {/* Timeline entries */}
                                        {entries.map((entry) => (
                                            <div key={entry.id} className="relative group">
                                                {/* Timeline Dot */}
                                                <div className="absolute -left-[29px] top-1 h-5 w-5 rounded-full border-4 border-white shadow-sm bg-gray-200 group-hover:bg-emerald-500 transition-colors"></div>

                                                {/* Card */}
                                                <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 group-hover:shadow-md transition-all relative">

                                                    {/* Edit Button */}
                                                    <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <button
                                                            onClick={() => handleEdit(entry)}
                                                            className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-full transition-colors"
                                                            title="Editar"
                                                        >
                                                            <Pencil className="h-4 w-4" />
                                                        </button>
                                                    </div>

                                                    <div className="flex items-start justify-between mb-3 pr-8">
                                                        <div className="flex items-center gap-3">
                                                            <span className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 border ${getTypeColor(entry.type)}`}>
                                                                {getTypeIcon(entry.type)}
                                                                {entry.type.toUpperCase()}
                                                            </span>
                                                            <span className="text-xs text-gray-400 flex items-center gap-1">
                                                                <Clock className="h-3 w-3" />
                                                                {format(parseISO(entry.created_at), 'HH:mm')}
                                                            </span>
                                                            {!isSingleDayRange && hasDateFilter && (
                                                                <span className="text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded-md">
                                                                    {format(parseISO(entry.date), 'dd/MM/yyyy')}
                                                                </span>
                                                            )}
                                                        </div>
                                                        {entry.order_ref && (
                                                            <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-50 rounded-md text-xs font-medium text-gray-600">
                                                                <Hash className="h-3 w-3" />
                                                                Pedido #{entry.order_ref}
                                                            </div>
                                                        )}
                                                    </div>

                                                    <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">
                                                        {entry.content}
                                                    </p>

                                                    {entry.responsible_staff && (
                                                        <div className="mt-4 pt-3 border-t border-gray-50 flex items-center gap-2">
                                                            <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center">
                                                                <User className="h-3 w-3 text-gray-500" />
                                                            </div>
                                                            <span className="text-sm text-gray-600">
                                                                <span className="text-gray-400 mr-1">Responsável:</span>
                                                                {entry.responsible_staff}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {hasMoreEntries && (
                                        <div className="flex justify-center">
                                            <button
                                                type="button"
                                                onClick={() => setVisibleCount((current) => current + PAGE_SIZE)}
                                                className="px-4 py-2.5 text-sm font-medium rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-700 transition-colors"
                                            >
                                                Carregar mais
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Modal */}
                {isModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                                <h3 className="text-lg font-bold text-gray-900">
                                    {editingId ? 'Editar Anotação' : 'Nova Ocorrência'}
                                </h3>
                                <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-100 rounded-full transition-all">
                                    <X className="h-5 w-5" />
                                </button>
                            </div>

                            <form onSubmit={handleSave} className="p-6 space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
                                        <div className="relative">
                                            <select
                                                value={formData.type}
                                                onChange={e => setFormData({ ...formData, type: e.target.value })}
                                                className="w-full pl-3 pr-10 py-2.5 rounded-xl border-gray-200 focus:border-emerald-500 focus:ring-emerald-500 bg-gray-50/50"
                                            >
                                                <option value="Geral">Geral</option>
                                                <option value="Entrega">Entrega</option>
                                                <option value="Montagem">Montagem</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Pedido (Opcional)</label>
                                        <input
                                            type="text"
                                            placeholder="Ex: 12345"
                                            value={formData.order_ref}
                                            onChange={e => setFormData({ ...formData, order_ref: e.target.value })}
                                            className="w-full px-3 py-2.5 rounded-xl border-gray-200 focus:border-emerald-500 focus:ring-emerald-500 bg-gray-50/50"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Responsáveis</label>
                                    <div className="relative">
                                        <User className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
                                        <input
                                            type="text"
                                            placeholder="Ex: Motorista João, Montador Pedro..."
                                            value={formData.responsible_staff}
                                            onChange={e => setFormData({ ...formData, responsible_staff: e.target.value })}
                                            className="w-full pl-10 pr-3 py-2.5 rounded-xl border-gray-200 focus:border-emerald-500 focus:ring-emerald-500 bg-gray-50/50"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Observação</label>
                                    <textarea
                                        required
                                        rows={4}
                                        placeholder="Descreva o que aconteceu..."
                                        value={formData.content}
                                        onChange={e => setFormData({ ...formData, content: e.target.value })}
                                        className="w-full px-3 py-2.5 rounded-xl border-gray-200 focus:border-emerald-500 focus:ring-emerald-500 bg-gray-50/50 resize-none"
                                    />
                                </div>

                                <div className="pt-4 flex justify-end gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setIsModalOpen(false)}
                                        className="px-5 py-2.5 text-gray-700 hover:bg-gray-100 rounded-xl font-medium transition-colors"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="submit"
                                        className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium shadow-lg shadow-emerald-200 transition-all flex items-center gap-2"
                                    >
                                        <Save className="h-4 w-4" />
                                        {editingId ? 'Atualizar' : 'Salvar Registro'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
