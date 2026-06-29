import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  FileDown,
  FileSearch,
  FileText,
  Loader2,
  RefreshCw,
  Route,
  Search,
  Truck,
  UserRound,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '../../supabase/client';

type MdfeManifest = {
  id: string;
  route_id: string | null;
  status: 'draft' | 'processing' | 'issued' | 'closed' | 'cancelled' | 'error';
  environment: 'homologation' | 'production';
  loading_city_name: string | null;
  loading_uf: string | null;
  unloading_city_name: string | null;
  unloading_uf: string | null;
  total_documents: number;
  total_value: number;
  total_gross_weight: number;
  mdfe_number: string | null;
  mdfe_key: string | null;
  protocol: string | null;
  pdf_url: string | null;
  xml_content: string | null;
  error_message: string | null;
  issued_at: string | null;
  closed_at: string | null;
  created_at: string;
  emitter?: {
    company_name: string;
  } | null;
  vehicle?: {
    display_name: string;
    plate: string;
  } | null;
  driver?: {
    name: string;
    cpf: string;
  } | null;
  route?: {
    name: string;
    route_code: string | null;
  } | null;
};

const STATUS_META: Record<
  MdfeManifest['status'],
  { label: string; className: string }
> = {
  draft: {
    label: 'Rascunho',
    className: 'bg-slate-100 text-slate-700',
  },
  processing: {
    label: 'Processando',
    className: 'bg-amber-100 text-amber-700',
  },
  issued: {
    label: 'Emitido',
    className: 'bg-emerald-100 text-emerald-700',
  },
  closed: {
    label: 'Encerrado',
    className: 'bg-blue-100 text-blue-700',
  },
  cancelled: {
    label: 'Cancelado',
    className: 'bg-slate-200 text-slate-700',
  },
  error: {
    label: 'Erro',
    className: 'bg-rose-100 text-rose-700',
  },
};

const MDFE_CANCELLATION_WINDOW_MS = 24 * 60 * 60 * 1000;

export default function MdfeManifests() {
  const [loading, setLoading] = useState(true);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [openingXmlId, setOpeningXmlId] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [manifests, setManifests] = useState<MdfeManifest[]>([]);

  useEffect(() => {
    void load();
  }, []);

  const filteredManifests = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return manifests;

    return manifests.filter((manifest) =>
      [
        manifest.mdfe_number,
        manifest.mdfe_key,
        manifest.protocol,
        manifest.route?.route_code,
        manifest.route?.name,
        manifest.emitter?.company_name,
        manifest.vehicle?.display_name,
        manifest.vehicle?.plate,
        manifest.driver?.name,
        manifest.loading_city_name,
        manifest.unloading_city_name,
      ].some((value) => String(value || '').toLowerCase().includes(term))
    );
  }, [manifests, search]);

  const counters = useMemo(() => {
    return filteredManifests.reduce(
      (acc, manifest) => {
        acc.total += 1;
        if (manifest.status === 'issued') acc.issued += 1;
        if (manifest.status === 'closed') acc.closed += 1;
        if (manifest.status === 'error') acc.error += 1;
        return acc;
      },
      { total: 0, issued: 0, closed: 0, error: 0 }
    );
  }, [filteredManifests]);

  const processingManifestIds = useMemo(() => {
    return manifests.filter((manifest) => manifest.status === 'processing').map((manifest) => manifest.id);
  }, [manifests]);

  const load = async (background = false) => {
    try {
      if (!background) setLoading(true);
      const { data, error } = await supabase
        .from('mdfe_manifests')
        .select(`
          id,
          route_id,
          status,
          environment,
          loading_city_name,
          loading_uf,
          unloading_city_name,
          unloading_uf,
          total_documents,
          total_value,
          total_gross_weight,
          mdfe_number,
          mdfe_key,
          protocol,
          pdf_url,
          xml_content,
          error_message,
          issued_at,
          closed_at,
          created_at,
          emitter:mdfe_emitters!mdfe_manifests_emitter_id_fkey(company_name),
          vehicle:mdfe_vehicles!mdfe_manifests_vehicle_id_fkey(display_name, plate),
          driver:mdfe_drivers!mdfe_manifests_driver_id_fkey(name, cpf),
          route:routes!mdfe_manifests_route_id_fkey(name, route_code)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setManifests((data || []) as MdfeManifest[]);
    } catch (error: any) {
      console.error(error);
      if (!background) {
        toast.error(error?.message || 'Erro ao carregar manifestos MDF-e');
      }
    } finally {
      if (!background) setLoading(false);
    }
  };

  useEffect(() => {
    if (processingManifestIds.length === 0) return;

    let cancelled = false;
    let running = false;

    const syncProcessingManifests = async () => {
      if (cancelled || running) return;
      running = true;

      try {
        await Promise.all(
          processingManifestIds.map(async (manifestId) => {
            const { data, error } = await supabase.functions.invoke('refresh-mdfe', {
              body: { manifestId },
            });

            if (error || data?.error) {
              console.warn('Falha ao atualizar MDF-e em processamento:', manifestId, error || data?.error);
            }
          })
        );

        if (!cancelled) {
          await load(true);
        }
      } finally {
        running = false;
      }
    };

    void syncProcessingManifests();
    const intervalId = window.setInterval(() => {
      void syncProcessingManifests();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [processingManifestIds]);

  const refreshManifest = async (manifestId: string, silent = false) => {
    try {
      if (!silent) setSyncingId(manifestId);
      const { data, error } = await supabase.functions.invoke('refresh-mdfe', {
        body: { manifestId },
      });

      if (error) throw normalizeFunctionError(error, data);
      if (data?.error) throw new Error(data.error);

      if (!silent) toast.success('Status do MDF-e atualizado.');
      await load(silent);
    } catch (error: any) {
      console.error(error);
      if (!silent) {
        toast.error(error?.message || 'Erro ao atualizar status do MDF-e');
      }
    } finally {
      if (!silent) setSyncingId(null);
    }
  };

  const openPdf = (manifest: MdfeManifest) => {
    if (!manifest.pdf_url) {
      toast.error('PDF do DAMDFE ainda nao disponivel. Atualize o status primeiro.');
      return;
    }

    window.open(manifest.pdf_url, '_blank', 'noopener,noreferrer');
  };

  const openXml = (manifest: MdfeManifest) => {
    if (!manifest.xml_content) {
      toast.error('XML ainda nao disponivel. Atualize o status primeiro.');
      return;
    }

    try {
      setOpeningXmlId(manifest.id);
      const blob = new Blob([manifest.xml_content], { type: 'application/xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } finally {
      setOpeningXmlId(null);
    }
  };

  const closeManifest = async (manifest: MdfeManifest) => {
    const closeUf = String(manifest.unloading_uf || '').trim().toUpperCase();
    const closeCity = String(manifest.unloading_city_name || '').trim();

    if (!closeUf || !closeCity) {
      toast.error('Manifesto sem cidade/UF de descarregamento para encerramento automatico.');
      return;
    }

    const shouldContinue = window.confirm(
      `Encerrar o MDF-e ${manifest.mdfe_number || manifest.mdfe_key || ''} em ${closeCity}/${closeUf}?`
    );

    if (!shouldContinue) return;

    try {
      setActioningId(manifest.id);
      const { data, error } = await supabase.functions.invoke('close-mdfe', {
        body: {
          manifestId: manifest.id,
          uf: closeUf,
          cityName: closeCity,
        },
      });

      if (error) throw normalizeFunctionError(error, data);
      if (data?.error) throw new Error(data.error);

      toast.success('MDF-e encerrado com sucesso.');
      await load();
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || 'Erro ao encerrar MDF-e');
    } finally {
      setActioningId(null);
    }
  };

  const cancelManifest = async (manifest: MdfeManifest) => {
    if (!isWithinCancellationWindow(manifest.issued_at)) {
      toast.error('O prazo de 24 horas para cancelar este MDF-e ja expirou.');
      return;
    }

    const justification = window.prompt(
      'Informe a justificativa do cancelamento do MDF-e (minimo 15 caracteres):',
      'Cancelamento antes do inicio do transporte.'
    );

    if (justification === null) return;

    if (justification.trim().length < 15) {
      toast.error('A justificativa precisa ter pelo menos 15 caracteres.');
      return;
    }

    const shouldContinue = window.confirm(
      `Cancelar o MDF-e ${manifest.mdfe_number || manifest.mdfe_key || ''}? Esta acao e definitiva.`
    );

    if (!shouldContinue) return;

    try {
      setActioningId(manifest.id);
      const { data, error } = await supabase.functions.invoke('cancel-mdfe', {
        body: {
          manifestId: manifest.id,
          justification: justification.trim(),
        },
      });

      if (error) throw normalizeFunctionError(error, data);
      if (data?.error) throw new Error(data.error);

      toast.success('MDF-e cancelado com sucesso.');
      await load();
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || 'Erro ao cancelar MDF-e');
    } finally {
      setActioningId(null);
    }
  };

  return (
    <div className="p-6 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Link
              to="/admin/mdfe"
              className="inline-flex items-center gap-2 text-sm font-medium text-blue-700 hover:text-blue-800"
            >
              <ArrowLeft className="h-4 w-4" />
              Voltar para MDF-e
            </Link>
            <h1 className="mt-3 text-2xl font-bold text-slate-900">Historico MDF-e</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Consulta isolada dos MDF-es emitidos pela rota para acompanhar status,
              reimpressao, protocolo, erro e encerramento.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
        </div>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Total" value={counters.total} />
          <MetricCard label="Emitidos" value={counters.issued} tone="emerald" />
          <MetricCard label="Encerrados" value={counters.closed} tone="blue" />
          <MetricCard label="Com erro" value={counters.error} tone="rose" />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por numero, chave, romaneio, emitente, veiculo ou cidade..."
              className="w-full rounded-xl border border-slate-300 py-2 pl-10 pr-4 text-sm text-slate-900 outline-none focus:border-blue-500"
            />
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Lista de manifestos</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[1280px] w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3">Manifesto</th>
                  <th className="px-5 py-3">Rota</th>
                  <th className="px-5 py-3">Emitente</th>
                  <th className="px-5 py-3">Condutor / Veiculo</th>
                  <th className="px-5 py-3">Carga</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="sticky right-0 z-20 w-44 min-w-44 bg-slate-50 px-5 py-3 text-right shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.35)]">
                    Acoes
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-500">
                      Carregando manifestos...
                    </td>
                  </tr>
                ) : filteredManifests.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-10">
                      <div className="flex flex-col items-center justify-center gap-3 text-center text-sm text-slate-500">
                        <div className="rounded-2xl bg-slate-100 p-3 text-slate-500">
                          <FileSearch className="h-6 w-6" />
                        </div>
                        <div>
                          <p className="font-medium text-slate-700">Nenhum MDF-e encontrado no historico.</p>
                          <p>
                            Quando a emissao for ligada na rota, os manifestos gerados aparecerao aqui automaticamente.
                          </p>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredManifests.map((manifest) => {
                    const statusMeta = STATUS_META[manifest.status];
                    const canClose = manifest.status === 'issued';
                    const showCancel = manifest.status === 'issued';
                    const canCancel = showCancel && isWithinCancellationWindow(manifest.issued_at);
                    const isActing = actioningId === manifest.id;

                    return (
                      <tr key={manifest.id} className="align-top text-sm text-slate-700">
                        <td className="px-5 py-4">
                          <div className="space-y-1">
                            <p className="font-semibold text-slate-900">
                              {manifest.mdfe_number ? `MDF-e ${manifest.mdfe_number}` : 'Sem numero definido'}
                            </p>
                            <p className="text-xs text-slate-500">
                              Ambiente: {manifest.environment === 'production' ? 'Producao' : 'Homologacao'}
                            </p>
                            {manifest.mdfe_key && (
                              <p className="max-w-xs break-all text-xs text-slate-500">
                                Chave: {manifest.mdfe_key}
                              </p>
                            )}
                            {!manifest.mdfe_key && manifest.protocol && (
                              <p className="text-xs text-slate-500">Protocolo: {manifest.protocol}</p>
                            )}
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          <div className="space-y-2">
                            <div className="flex items-start gap-2">
                              <Route className="mt-0.5 h-4 w-4 text-slate-400" />
                              <div>
                                <p className="font-medium text-slate-900">
                                  {manifest.route?.route_code || manifest.route?.name || 'Sem rota vinculada'}
                                </p>
                                {manifest.route?.route_code && manifest.route?.name && (
                                  <p className="text-xs text-slate-500">{manifest.route.name}</p>
                                )}
                              </div>
                            </div>
                            <p className="text-xs text-slate-500">
                              {formatCity(manifest.loading_city_name, manifest.loading_uf)}{' '}
                              {manifest.unloading_city_name ? `-> ${formatCity(manifest.unloading_city_name, manifest.unloading_uf)}` : ''}
                            </p>
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          <div className="space-y-1">
                            <div className="flex items-start gap-2">
                              <FileText className="mt-0.5 h-4 w-4 text-slate-400" />
                              <div>
                                <p className="font-medium text-slate-900">
                                  {manifest.emitter?.company_name || '-'}
                                </p>
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          <div className="space-y-3">
                            <div className="flex items-start gap-2">
                              <UserRound className="mt-0.5 h-4 w-4 text-slate-400" />
                              <div>
                                <p className="font-medium text-slate-900">
                                  {manifest.driver?.name || '-'}
                                </p>
                                {manifest.driver?.cpf && (
                                  <p className="text-xs text-slate-500">CPF: {manifest.driver.cpf}</p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-start gap-2">
                              <Truck className="mt-0.5 h-4 w-4 text-slate-400" />
                              <div>
                                <p className="font-medium text-slate-900">
                                  {manifest.vehicle?.display_name || '-'}
                                </p>
                                {manifest.vehicle?.plate && (
                                  <p className="text-xs text-slate-500">Placa: {manifest.vehicle.plate}</p>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          <div className="space-y-1">
                            <p className="font-medium text-slate-900">
                              {manifest.total_documents} documento(s)
                            </p>
                            <p className="text-xs text-slate-500">
                              Valor total: {formatCurrency(manifest.total_value)}
                            </p>
                            <p className="text-xs text-slate-500">
                              Peso bruto: {formatWeight(manifest.total_gross_weight)}
                            </p>
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          <div className="space-y-2">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusMeta.className}`}
                            >
                              {statusMeta.label}
                            </span>
                            <div className="space-y-1 text-xs text-slate-500">
                              <p>Criado em: {formatDateTime(manifest.created_at)}</p>
                              {manifest.issued_at && <p>Emitido em: {formatDateTime(manifest.issued_at)}</p>}
                              {manifest.closed_at && <p>Encerrado em: {formatDateTime(manifest.closed_at)}</p>}
                              {manifest.status === 'error' && manifest.error_message && (
                                <p className="max-w-xs break-all text-rose-600">{manifest.error_message}</p>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="sticky right-0 z-10 w-44 min-w-44 bg-white px-5 py-4 shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.35)]">
                          <div className="flex flex-wrap justify-end gap-2 [&>button]:whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => void refreshManifest(manifest.id)}
                              disabled={syncingId === manifest.id || isActing}
                              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                            >
                              {syncingId === manifest.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw className="h-4 w-4" />
                              )}
                              Atualizar
                            </button>
                            <button
                              type="button"
                              onClick={() => openXml(manifest)}
                              disabled={openingXmlId === manifest.id || isActing}
                              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                            >
                              {openingXmlId === manifest.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <FileText className="h-4 w-4" />
                              )}
                              XML
                            </button>
                            <button
                              type="button"
                              onClick={() => openPdf(manifest)}
                              disabled={!manifest.pdf_url || isActing}
                              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                            >
                              <FileDown className="h-4 w-4" />
                              Imprimir
                            </button>
                            {canClose && (
                              <button
                                type="button"
                                onClick={() => void closeManifest(manifest)}
                                disabled={isActing}
                                className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                              >
                                {isActing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                Encerrar
                              </button>
                            )}
                            {showCancel && (
                              <button
                                type="button"
                                onClick={() => void cancelManifest(manifest)}
                                disabled={isActing || !canCancel}
                                title={!canCancel ? 'Prazo de 24 horas para cancelamento expirado' : undefined}
                                className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                              >
                                {isActing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                                {canCancel ? 'Cancelar' : 'Prazo expirado'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function normalizeFunctionError(error: any, data: any) {
  const focusResponse = data?.focus_response;

  if (typeof focusResponse === 'string' && focusResponse.trim()) {
    return new Error(focusResponse);
  }

  if (focusResponse?.mensagem) {
    return new Error(String(focusResponse.mensagem));
  }

  if (focusResponse?.message) {
    return new Error(String(focusResponse.message));
  }

  if (focusResponse?.errors) {
    return new Error(JSON.stringify(focusResponse.errors));
  }

  if (data?.error) {
    return new Error(String(data.error));
  }

  if (error?.message) {
    return new Error(String(error.message));
  }

  return new Error('A operacao retornou erro sem detalhe.');
}

function isWithinCancellationWindow(issuedAt: string | null) {
  if (!issuedAt) return false;

  const issuedAtMs = new Date(issuedAt).getTime();
  return Number.isFinite(issuedAtMs) && Date.now() < issuedAtMs + MDFE_CANCELLATION_WINDOW_MS;
}

function MetricCard({
  label,
  value,
  tone = 'slate',
}: {
  label: string;
  value: number;
  tone?: 'slate' | 'emerald' | 'blue' | 'rose';
}) {
  const tones = {
    slate: 'border-slate-200 bg-white text-slate-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    blue: 'border-blue-200 bg-blue-50 text-blue-900',
    rose: 'border-rose-200 bg-rose-50 text-rose-900',
  };

  return (
    <article className={`rounded-2xl border p-5 shadow-sm ${tones[tone]}`}>
      <p className="text-sm font-medium">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
    </article>
  );
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value || 0));
}

function formatWeight(value: number) {
  return `${Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  })} KG`;
}

function formatDateTime(value: string | null) {
  if (!value) return '-';

  try {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatCity(city: string | null, uf: string | null) {
  if (!city && !uf) return 'Cidade nao informada';
  if (!city) return uf || 'Cidade nao informada';
  if (!uf) return city;
  return `${city}/${uf}`;
}
