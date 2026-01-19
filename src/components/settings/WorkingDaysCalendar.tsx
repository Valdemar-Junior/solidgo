import { useState, useEffect } from 'react';
import { supabase } from '../../supabase/client';
import {
    format,
    startOfMonth,
    endOfMonth,
    eachDayOfInterval,
    isWeekend,
    isSameMonth,
    addMonths,
    subMonths,
    isSameDay
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Holiday {
    date: string;
    description: string | null;
}

export function WorkingDaysCalendar() {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [holidays, setHolidays] = useState<Holiday[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        fetchHolidays();
    }, [currentDate]);

    const fetchHolidays = async () => {
        setLoading(true);
        const start = startOfMonth(currentDate);
        const end = endOfMonth(currentDate);

        // Fetch holidays for the current month range
        const { data, error } = await supabase
            .from('company_holidays')
            .select('*')
            .gte('date', format(start, 'yyyy-MM-dd'))
            .lte('date', format(end, 'yyyy-MM-dd'));

        if (error) {
            console.error('Error fetching holidays:', error);
            toast.error('Erro ao carregar feriados');
        } else {
            setHolidays(data || []);
        }
        setLoading(false);
    };

    const toggleDay = async (day: Date) => {
        if (isWeekend(day)) return; // Can't toggle weekends (always off/gray)

        const dateStr = format(day, 'yyyy-MM-dd');
        const isHoliday = holidays.find(h => h.date === dateStr);

        try {
            if (isHoliday) {
                // Remove from holidays (make it a working day)
                const { error } = await supabase
                    .from('company_holidays')
                    .delete()
                    .eq('date', dateStr);

                if (error) throw error;
                setHolidays(prev => prev.filter(h => h.date !== dateStr));
            } else {
                // Add to holidays (make it non-working)
                const { error } = await supabase
                    .from('company_holidays')
                    .insert({ date: dateStr, description: 'Feriado/Folga' });

                if (error) throw error;
                setHolidays(prev => [...prev, { date: dateStr, description: 'Feriado/Folga' }]);
            }
        } catch (error) {
            console.error('Error toggling day:', error);
            toast.error('Erro ao atualizar dia');
        }
    };

    const days = eachDayOfInterval({
        start: startOfMonth(currentDate),
        end: endOfMonth(currentDate)
    });

    // Fill empty slots for start of week assignment (if month starts on Wednesday, we need empty slots for Sun-Tue)
    const startDay = startOfMonth(currentDate).getDay(); // 0 (Sun) - 6 (Sat)
    const emptySlots = Array(startDay).fill(null);

    const weekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="border-b border-gray-100 bg-gray-50 px-6 py-4 flex items-center justify-between">
                <h2 className="font-bold text-gray-900">Calendário de Dias Úteis</h2>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setCurrentDate(prev => subMonths(prev, 1))}
                        className="p-1 hover:bg-white rounded border border-transparent hover:border-gray-200 transition-colors"
                    >
                        <ChevronLeft className="h-5 w-5 text-gray-600" />
                    </button>
                    <span className="text-sm font-medium w-32 text-center capitalize">
                        {format(currentDate, 'MMMM yyyy', { locale: ptBR })}
                    </span>
                    <button
                        onClick={() => setCurrentDate(prev => addMonths(prev, 1))}
                        className="p-1 hover:bg-white rounded border border-transparent hover:border-gray-200 transition-colors"
                    >
                        <ChevronRight className="h-5 w-5 text-gray-600" />
                    </button>
                </div>
            </div>

            <div className="p-6">
                <div className="mb-4 flex gap-4 text-sm">
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded bg-green-100 border border-green-200"></div>
                        <span className="text-gray-600">Dia Útil (Trabalho)</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded bg-gray-100 border border-gray-200"></div>
                        <span className="text-gray-600">Folga / Feriado</span>
                    </div>
                </div>

                <div className="grid grid-cols-7 gap-2">
                    {weekDays.map(day => (
                        <div key={day} className="text-center text-xs font-semibold text-gray-400 py-2">
                            {day}
                        </div>
                    ))}

                    {emptySlots.map((_, i) => (
                        <div key={`empty-${i}`} className="h-14 sm:h-20" />
                    ))}

                    {days.map(day => {
                        const isWeekendDay = isWeekend(day);
                        const dateStr = format(day, 'yyyy-MM-dd');
                        const isHoliday = holidays.some(h => h.date === dateStr);
                        const isWorkingDay = !isWeekendDay && !isHoliday;

                        return (
                            <button
                                key={day.toString()}
                                onClick={() => toggleDay(day)}
                                disabled={isWeekendDay} // Disable interaction for weekends
                                className={`
                  h-14 sm:h-20 rounded-lg border flex flex-col items-start justify-start p-2 transition-all relative
                  ${isWeekendDay
                                        ? 'bg-gray-50 border-gray-100 text-gray-400 cursor-not-allowed'
                                        : isWorkingDay
                                            ? 'bg-green-50 border-green-200 hover:border-green-300 text-green-700'
                                            : 'bg-gray-100 border-gray-200 hover:border-gray-300 text-gray-500'
                                    }
                `}
                            >
                                <span className={`text-sm font-medium ${isSameDay(day, new Date()) ? 'bg-blue-600 text-white w-6 h-6 rounded-full flex items-center justify-center -ml-1 -mt-1' : ''}`}>
                                    {format(day, 'd')}
                                </span>
                                {!isWeekendDay && !isWorkingDay && (
                                    <span className="text-[10px] mt-auto w-full text-center font-medium opacity-75">
                                        Feriado
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
