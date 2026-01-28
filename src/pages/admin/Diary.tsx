import { useState, useEffect } from 'react';
import { supabase } from '../../supabase/client';
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
    ChevronLeft,
    ChevronRight,
    Pencil
} from 'lucide-react';
import { format, addDays, subDays, isToday, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';

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

export default function Diary() {
    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [entries, setEntries] = useState<DiaryEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState({
        type: 'Geral',
        order_ref: '',
        responsible_staff: '',
        content: ''
    });

    // Fetch data when date changes
    useEffect(() => {
        fetchEntries();
    }, [selectedDate]);

    const fetchEntries = async () => {
        try {
            setLoading(true);
            const formattedDate = format(selectedDate, 'yyyy-MM-dd');

            const { data, error } = await supabase
                .from('operational_diary')
                .select('*')
                .eq('date', formattedDate)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setEntries(data || []);
        } catch (error) {
            console.error('Erro ao buscar diário:', error);
            toast.error('Erro ao carregar anotações');
        } finally {
            setLoading(false);
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

    // Date Navigation
    const nextDay = () => setSelectedDate(curr => addDays(curr, 1));
    const prevDay = () => setSelectedDate(curr => subDays(curr, 1));
    const goToToday = () => setSelectedDate(new Date());

    return (
        <div className="min-h-screen bg-gray-50/50 p-6">
            <div className="max-w-5xl mx-auto space-y-6">

                {/* Header & Date Navigation */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                    <div className="flex items-center gap-4">
                        <div className="bg-gradient-to-br from-emerald-500 to-teal-600 p-3 rounded-xl shadow-sm">
                            <Calendar className="h-6 w-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Diário de Bordo</h1>
                            <p className="text-sm text-gray-500">Registro operacional diário</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 bg-gray-50 p-1 rounded-xl border border-gray-200">
                        <button onClick={prevDay} className="p-2 hover:bg-white hover:shadow-sm rounded-lg transition-all text-gray-600">
                            <ChevronLeft className="h-5 w-5" />
                        </button>
                        <div className="px-4 py-2 font-medium text-gray-700 min-w-[180px] text-center flex flex-col leading-tight">
                            <span className="text-sm uppercase tracking-wide text-gray-400 font-semibold">{format(selectedDate, 'EEEE', { locale: ptBR })}</span>
                            <span className="text-lg text-gray-900">{format(selectedDate, "d 'de' MMMM", { locale: ptBR })}</span>
                        </div>
                        <button onClick={nextDay} className="p-2 hover:bg-white hover:shadow-sm rounded-lg transition-all text-gray-600">
                            <ChevronRight className="h-5 w-5" />
                        </button>
                    </div>

                    <div className="flex gap-2">
                        {!isToday(selectedDate) && (
                            <button
                                onClick={goToToday}
                                className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                Ir para Hoje
                            </button>
                        )}
                        <button
                            onClick={openNewModal}
                            className="flex items-center gap-2 bg-gray-900 text-white px-5 py-2.5 rounded-xl hover:bg-gray-800 transition-colors shadow-lg shadow-gray-200"
                        >
                            <Plus className="h-5 w-5" />
                            Nova Anotação
                        </button>
                    </div>
                </div>

                {/* Content Area */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                    {/* Summary / Stats Column (Optional - kept simple for now) */}
                    <div className="lg:col-span-3">
                        <div className="space-y-4">
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
                                    <h3 className="text-lg font-medium text-gray-900">Nenhuma anotação para este dia</h3>
                                    <p className="text-gray-500">Clique em "Nova Anotação" para começar o registro.</p>
                                </div>
                            ) : (
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
