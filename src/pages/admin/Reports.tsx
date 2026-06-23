import { ArrowRight, FileSpreadsheet, Goal, Hammer, Package, Truck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

type ReportCard = {
  id: string;
  title: string;
  description: string;
  href: string;
  icon: typeof Truck;
  accent: string;
  iconBg: string;
};

const REPORT_CARDS: ReportCard[] = [
  {
    id: 'delivery-operational',
    title: 'Relatorio Operacional de Entregas',
    description: 'Acompanhe entregas concluidas, aguardando rota, em separacao e em rota com filtros operacionais.',
    href: '/admin/reports/delivery-operational',
    icon: Truck,
    accent: 'from-blue-600 to-cyan-500',
    iconBg: 'bg-blue-50 text-blue-700',
  },
  {
    id: 'assembly-operational',
    title: 'Relatorio Operacional de Montagem',
    description: 'Analise montagens concluidas, pedidos aguardando rota e rotas de montagem em andamento.',
    href: '/admin/reports/assembly-operational',
    icon: Hammer,
    accent: 'from-orange-500 to-amber-500',
    iconBg: 'bg-orange-50 text-orange-700',
  },
  {
    id: 'delivery-goal',
    title: 'Relatorio de Meta de Entrega',
    description: 'Acompanhe metas semanais e mensais por motorista ou ajudante usando apenas rotas finalizadas.',
    href: '/admin/reports/delivery-goal',
    icon: Goal,
    accent: 'from-emerald-600 to-teal-500',
    iconBg: 'bg-emerald-50 text-emerald-700',
  },
  {
    id: 'withdrawals',
    title: 'Relatorio de Retiradas',
    description: 'Acompanhe retiradas por periodo com cliente, produtos, endereco, conferente e status da montagem.',
    href: '/admin/reports/withdrawals',
    icon: Package,
    accent: 'from-fuchsia-600 to-violet-500',
    iconBg: 'bg-fuchsia-50 text-fuchsia-700',
  },
];

export default function Reports() {
  const navigate = useNavigate();

  return (
    <div className="w-full pb-10">
      <main className="w-full space-y-6 p-4 sm:p-6 lg:p-8">
        <section className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-6 py-8 text-white sm:px-8">
            <span className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-100">
              Central de Relatorios
            </span>
            <h1 className="mt-4 text-3xl font-bold tracking-tight">Escolha um relatorio</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200">
              Cada bloco abre um relatorio dedicado. Assim a entrega permanece isolada e os proximos relatorios podem crescer sem misturar filtros ou regras de negocio.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 p-6 sm:p-8 xl:grid-cols-2">
            {REPORT_CARDS.map((report) => {
              const Icon = report.icon;
              return (
                <button
                  key={report.id}
                  type="button"
                  onClick={() => navigate(report.href)}
                  className="group relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-6 text-left transition-all hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-lg"
                >
                  <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${report.accent}`} />
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className={`mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl ${report.iconBg}`}>
                        <Icon className="h-6 w-6" />
                      </div>
                      <h2 className="text-xl font-bold text-gray-900">{report.title}</h2>
                      <p className="mt-2 max-w-xl text-sm leading-6 text-gray-500">{report.description}</p>
                    </div>
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 text-gray-400 transition-colors group-hover:border-gray-300 group-hover:bg-gray-100 group-hover:text-gray-700">
                      <ArrowRight className="h-5 w-5" />
                    </div>
                  </div>

                  <div className="mt-6 flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <FileSpreadsheet className="h-4 w-4 text-gray-400" />
                    Abrir relatorio
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
