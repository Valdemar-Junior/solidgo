import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CalendarRange, CarFront, ChevronRight, ClipboardList, Loader2, LogOut, UserCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../supabase/client';
import type { FleetInspection, FleetInspectionWorkflowStatus } from '../../types/database';
import { useFleetPwaMeta } from './useFleetPwaMeta';

const STATUS_LABELS: Record<FleetInspectionWorkflowStatus, string> = {
  pending: 'Pendente',
  in_progress: 'Em andamento',
  completed: 'Finalizada',
  cancelled: 'Cancelada',
};

const STATUS_CLASSES: Record<FleetInspectionWorkflowStatus, string> = {
  pending: 'bg-sky-100 text-sky-700',
  in_progress: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-gray-100 text-gray-600',
};

function formatDateTime(value?: string | null) {
  if (!value) return 'Sem horário definido';
  return new Date(value).toLocaleString('pt-BR');
}

export default function DriverFleetInspections() {
  useFleetPwaMeta();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [inspections, setInspections] = useState<FleetInspection[]>([]);

  useEffect(() => {
    void loadInspections();
  }, [user?.id]);

  const loadInspections = async () => {
    if (!user?.id) return;

    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('fleet_inspections')
        .select(`
          *,
          vehicle:fleet_vehicles(*),
          assigned_driver:users!assigned_driver_user_id(id,email,name,role,phone,must_change_password,created_at)
        `)
        .eq('assigned_driver_user_id', user.id)
        .in('status', ['pending', 'in_progress'])
        .order('scheduled_at', { ascending: true })
        .order('created_at', { ascending: true });

      if (error) throw error;
      setInspections((data || []) as FleetInspection[]);
    } catch (error) {
      console.error(error);
      toast.error('Falha ao carregar inspeções');
    } finally {
      setLoading(false);
    }
  };

  const summary = useMemo(() => ({
    pending: inspections.filter((inspection) => inspection.status === 'pending').length,
    inProgress: inspections.filter((inspection) => inspection.status === 'in_progress').length,
  }), [inspections]);

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center justify-between px-4 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Frota</p>
            <h1 className="text-xl font-bold text-slate-900">Minhas inspeções</h1>
          </div>
          <button
            onClick={async () => {
              await logout();
              window.location.href = '/login?redirect=%2Ffleet%2Fdriver';
            }}
            className="inline-flex items-center rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sair
          </button>
        </div>
      </header>

      <main className="mx-auto flex min-h-[calc(100vh-73px)] max-w-md flex-col gap-4 px-4 py-5">
        <section className="rounded-3xl bg-slate-900 p-5 text-white shadow-lg shadow-slate-300/40">
          <p className="text-sm text-slate-300">Motorista responsável</p>
          <div className="mt-3 flex items-center gap-3">
            <div className="rounded-2xl bg-white/10 p-3">
              <UserCircle2 className="h-6 w-6" />
            </div>
            <div>
              <p className="font-semibold">{user?.name || user?.email}</p>
              <p className="text-sm text-slate-300">{summary.pending} pendente(s) • {summary.inProgress} em andamento</p>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="rounded-3xl bg-white p-8 text-center shadow-sm">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
            <p className="mt-3 text-sm text-slate-500">Carregando inspeções...</p>
          </div>
        ) : inspections.length === 0 ? (
          <div className="rounded-3xl bg-white p-8 text-center shadow-sm">
            <ClipboardList className="mx-auto h-12 w-12 text-slate-300" />
            <h2 className="mt-4 text-lg font-semibold text-slate-900">Nenhuma inspeção aberta</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Quando o admin atribuir uma inspeção para você, ela aparecerá aqui.
            </p>
          </div>
        ) : (
          inspections.map((inspection) => (
            <button
              key={inspection.id}
              onClick={() => navigate(`/fleet/driver/inspection/${inspection.id}`)}
              className="rounded-3xl bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold text-slate-700">
                    <span className={`${STATUS_CLASSES[inspection.status]} rounded-full px-2.5 py-1`}>
                      {STATUS_LABELS[inspection.status]}
                    </span>
                  </div>
                  <h2 className="mt-3 text-lg font-bold text-slate-900">{inspection.vehicle?.display_name || 'Veículo'}</h2>
                  <p className="mt-1 text-sm font-medium text-slate-500">{inspection.vehicle?.plate || '-'}</p>
                </div>
                <ChevronRight className="mt-1 h-5 w-5 text-slate-400" />
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 text-sm text-slate-600">
                <div className="flex items-center gap-2">
                  <CalendarRange className="h-4 w-4 text-slate-400" />
                  {formatDateTime(inspection.scheduled_at || inspection.created_at)}
                </div>
                <div className="flex items-center gap-2">
                  <CarFront className="h-4 w-4 text-slate-400" />
                  {inspection.vehicle?.brand} {inspection.vehicle?.model}
                </div>
              </div>

              {inspection.general_notes && (
                <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  {inspection.general_notes}
                </div>
              )}

              <div className="mt-4 inline-flex items-center text-sm font-semibold text-blue-600">
                {inspection.status === 'pending' ? 'Iniciar inspeção' : 'Continuar inspeção'}
                <ChevronRight className="ml-1 h-4 w-4" />
              </div>
            </button>
          ))
        )}

        <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            A inspeção só é enviada quando checklist, hodômetro e ao menos uma foto forem confirmados.
          </div>
        </div>
      </main>
    </div>
  );
}
