import { FileText, Settings, Truck, Users, ArrowRight, ScrollText, Building2 } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Mdfe() {
  const cards = [
    {
      title: 'Configuracoes',
      description: 'Centralizar emitente, operacao, ambiente e demais variaveis fixas da emissao.',
      icon: Settings,
      href: '/admin/mdfe/settings',
    },
    {
      title: 'Emitentes MDF-e',
      description: 'Cadastrar empresa emitente, endereco fiscal e dados fixos do emissor.',
      icon: Building2,
      href: '/admin/mdfe/emitters',
    },
    {
      title: 'Veiculos MDF-e',
      description: 'Cadastrar os veiculos fiscais sem depender do cadastro operacional atual.',
      icon: Truck,
      href: '/admin/mdfe/vehicles',
    },
    {
      title: 'Condutores MDF-e',
      description: 'Cadastrar nome e CPF dos condutores usados nas emissoes.',
      icon: Users,
      href: '/admin/mdfe/drivers',
    },
    {
      title: 'Historico MDF-e',
      description: 'Consultar manifestos emitidos pela rota para acompanhar situacao, reimpressao e encerramento.',
      icon: ScrollText,
      href: '/admin/mdfe/manifests',
    },
  ];

  return (
    <div className="p-6 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-slate-50 p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-blue-600 p-3 text-white shadow-lg shadow-blue-200">
              <FileText className="h-6 w-6" />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">
                Modulo isolado
              </p>
              <h1 className="text-2xl font-bold text-slate-900">MDF-e</h1>
              <p className="max-w-3xl text-sm text-slate-600 sm:text-base">
                Area reservada para configuracao, cadastros e historico do Manifesto Eletronico.
                A emissao continua nascendo exclusivamente dentro da rota.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-700">
            Regra operacional
          </p>
          <p className="mt-2 text-sm text-amber-900">
            O MDF-e nao sera emitido por este menu. Este modulo existe para manter os dados
            fixos isolados e para consultar os manifestos que forem gerados a partir da rota.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {cards.map((card) => (
            <article key={card.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 inline-flex rounded-xl bg-slate-100 p-3 text-slate-700">
                <card.icon className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900">{card.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{card.description}</p>
              {card.href ? (
                <Link
                  to={card.href}
                  className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-800"
                >
                  Abrir
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ) : (
                <span className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-slate-400">
                  Em breve
                </span>
              )}
            </article>
          ))}
        </section>

        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Proxima etapa</h2>
          <p className="mt-2 text-sm text-slate-600">
            O menu e os cadastros basicos do modulo estao isolados. O proximo passo e plugar
            um modal de emissao na tela da rota sem criar fluxo paralelo fora dela.
          </p>
        </section>
      </div>
    </div>
  );
}
