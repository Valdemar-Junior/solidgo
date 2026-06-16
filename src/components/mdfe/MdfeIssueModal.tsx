import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  MapPin,
  Route,
  Truck,
  UserRound,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../supabase/client';

type MdfeIssueModalProps = {
  isOpen: boolean;
  onClose: () => void;
  routeId?: string | null;
  routeCode?: string | null;
  routeName?: string | null;
  routeVehiclePlate?: string | null;
  routeDriverName?: string | null;
};

type MdfeSettings = {
  enabled: boolean;
  auto_close_on_route_complete: boolean;
  environment: 'homologation' | 'production';
  operation_type: string;
  emit_type: number;
  transport_type: number | null;
  default_emitter_id: string | null;
  loading_city_code: string | null;
  loading_city_name: string | null;
  loading_uf: string | null;
  observations: string | null;
};

type MdfeEmitter = {
  id: string;
  company_name: string;
  city_name: string;
  uf: string;
  cnpj: string;
};

type MdfeVehicle = {
  id: string;
  display_name: string;
  plate: string;
  body_type: string;
  rodado_type: string | null;
  licensing_uf: string;
  active: boolean;
};

type MdfeDriver = {
  id: string;
  name: string;
  cpf: string;
  active: boolean;
};

type RouteOrderForMdfe = {
  id: string;
  sequence: number;
  order: {
    id: string;
    order_id_erp: string;
    customer_name: string;
    xml_documento?: string | null;
    return_nfe_xml?: string | null;
  } | null;
};

type ParsedDocument = {
  routeOrderId: string;
  orderId: string;
  orderIdErp: string;
  customerName: string;
  nfeKey: string | null;
  totalValue: number;
  grossWeight: number;
  cityCode: string | null;
  cityName: string | null;
  uf: string | null;
  blockingIssues: string[];
  warnings: string[];
};

type LoadState = {
  settings: MdfeSettings | null;
  emitters: MdfeEmitter[];
  vehicles: MdfeVehicle[];
  drivers: MdfeDriver[];
  documents: ParsedDocument[];
  routeOrderCount: number;
  routeIssues: string[];
};

const INITIAL_STATE: LoadState = {
  settings: null,
  emitters: [],
  vehicles: [],
  drivers: [],
  documents: [],
  routeOrderCount: 0,
  routeIssues: [],
};

export default function MdfeIssueModal({
  isOpen,
  onClose,
  routeId,
  routeCode,
  routeName,
  routeVehiclePlate,
  routeDriverName,
}: MdfeIssueModalProps) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState<LoadState>(INITIAL_STATE);
  const [selectedEmitterId, setSelectedEmitterId] = useState('');
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [selectedRouteOrderIds, setSelectedRouteOrderIds] = useState<Set<string>>(new Set());
  const [manualGrossWeight, setManualGrossWeight] = useState('');

  useEffect(() => {
    if (!isOpen || !routeId) return;

    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setLoadError(null);

        const [settingsResponse, emittersResponse, vehiclesResponse, driversResponse, routeResponse] =
          await Promise.all([
            supabase.from('mdfe_settings').select('*').limit(1).maybeSingle(),
            supabase
              .from('mdfe_emitters')
              .select('id, company_name, city_name, uf, cnpj')
              .eq('active', true)
              .order('company_name', { ascending: true }),
            supabase
              .from('mdfe_vehicles')
              .select('id, display_name, plate, body_type, rodado_type, licensing_uf, active')
              .eq('active', true)
              .order('display_name', { ascending: true }),
            supabase
              .from('mdfe_drivers')
              .select('id, name, cpf, active')
              .eq('active', true)
              .order('name', { ascending: true }),
            supabase
              .from('routes')
              .select(`
                id,
                name,
                route_code,
                route_orders(
                  id,
                  sequence,
                  order:orders!order_id(
                    id,
                    order_id_erp,
                    customer_name,
                    xml_documento,
                    return_nfe_xml
                  )
                )
              `)
              .eq('id', routeId)
              .single(),
          ]);

        if (settingsResponse.error) throw settingsResponse.error;
        if (emittersResponse.error) throw emittersResponse.error;
        if (vehiclesResponse.error) throw vehiclesResponse.error;
        if (driversResponse.error) throw driversResponse.error;
        if (routeResponse.error) throw routeResponse.error;

        const settings = (settingsResponse.data || null) as MdfeSettings | null;
        const emitters = (emittersResponse.data || []) as MdfeEmitter[];
        const vehicles = (vehiclesResponse.data || []) as MdfeVehicle[];
        const drivers = (driversResponse.data || []) as MdfeDriver[];
        const routeData = routeResponse.data as any;
        const routeOrders = ((routeData?.route_orders || []) as RouteOrderForMdfe[]).sort(
          (left, right) => Number(left.sequence || 0) - Number(right.sequence || 0)
        );

        const routeIssues: string[] = [];
        const documents = routeOrders.map((routeOrder) => {
          const order = routeOrder.order;
          if (!order) {
            routeIssues.push(`Pedido da sequencia ${routeOrder.sequence || '-'} sem vinculo carregado.`);
            return {
              routeOrderId: routeOrder.id,
              orderId: '',
              orderIdErp: '',
              customerName: '',
              nfeKey: null,
              totalValue: 0,
              grossWeight: 0,
              cityCode: null,
              cityName: null,
              uf: null,
              issues: ['Pedido nao encontrado na rota.'],
              blockingIssues: ['Pedido nao encontrado na rota.'],
              warnings: [],
            } satisfies ParsedDocument;
          }

          const xml = String(order.xml_documento || order.return_nfe_xml || '').trim();
          return parseNfeDocument({
            routeOrderId: routeOrder.id,
            orderId: order.id,
            orderIdErp: String(order.order_id_erp || ''),
            customerName: String(order.customer_name || ''),
            xml,
          });
        });

        const defaultEmitterId =
          settings?.default_emitter_id && emitters.some((item) => item.id === settings.default_emitter_id)
            ? settings.default_emitter_id
            : emitters[0]?.id || '';

        const matchedVehicle =
          vehicles.find((item) => normalize(item.plate) === normalize(routeVehiclePlate)) ||
          vehicles[0] ||
          null;

        const matchedDriver =
          drivers.find((item) => normalize(item.name) === normalize(routeDriverName)) ||
          drivers.find((item) => normalize(routeDriverName).includes(normalize(item.name))) ||
          drivers[0] ||
          null;

        if (!cancelled) {
          setState({
            settings,
            emitters,
            vehicles,
            drivers,
            documents,
            routeOrderCount: routeOrders.length,
            routeIssues,
          });
          setSelectedRouteOrderIds(
            new Set(documents.map((item) => item.routeOrderId).filter(Boolean))
          );
          setSelectedEmitterId(defaultEmitterId || '');
          setSelectedVehicleId(matchedVehicle?.id || '');
          setSelectedDriverId(matchedDriver?.id || '');
          setManualGrossWeight(formatWeightInput(documents.reduce((acc, item) => acc + Number(item.grossWeight || 0), 0)));
        }
      } catch (error: any) {
        console.error(error);
        if (!cancelled) {
          setLoadError(error?.message || 'Erro ao montar a pre-visualizacao do MDF-e');
          setState(INITIAL_STATE);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [isOpen, routeId, routeDriverName, routeVehiclePlate]);

  const selectedEmitter = useMemo(
    () => state.emitters.find((item) => item.id === selectedEmitterId) || null,
    [state.emitters, selectedEmitterId]
  );
  const selectedVehicle = useMemo(
    () => state.vehicles.find((item) => item.id === selectedVehicleId) || null,
    [state.vehicles, selectedVehicleId]
  );
  const selectedDriver = useMemo(
    () => state.drivers.find((item) => item.id === selectedDriverId) || null,
    [state.drivers, selectedDriverId]
  );

  const includedDocuments = useMemo(() => {
    return state.documents.filter((document) => selectedRouteOrderIds.has(document.routeOrderId));
  }, [state.documents, selectedRouteOrderIds]);

  const totals = useMemo(() => {
    return includedDocuments.reduce(
      (acc, document) => {
        acc.totalValue += Number(document.totalValue || 0);
        acc.totalWeight += Number(document.grossWeight || 0);
        if (document.nfeKey) acc.validKeys += 1;
        if (document.blockingIssues.length > 0) acc.documentsWithIssues += 1;
        acc.documentsWithWarnings += document.warnings.length > 0 ? 1 : 0;
        return acc;
      },
      { totalValue: 0, totalWeight: 0, validKeys: 0, documentsWithIssues: 0, documentsWithWarnings: 0 }
    );
  }, [includedDocuments]);

  const effectiveGrossWeight = useMemo(() => {
    return parseManualWeight(manualGrossWeight);
  }, [manualGrossWeight]);

  const unloadingCities = useMemo(() => {
    return Array.from(
      new Set(
        includedDocuments
          .filter((item) => item.cityName || item.uf)
          .map((item) => formatCity(item.cityName, item.uf))
      )
    );
  }, [includedDocuments]);

  const validationItems = useMemo(() => {
    return [
      {
        label: 'Emitente selecionado',
        ok: Boolean(selectedEmitter),
      },
      {
        label: 'Veiculo MDF-e selecionado',
        ok: Boolean(selectedVehicle),
      },
      {
        label: 'Veiculo MDF-e com tipo de rodado',
        ok: Boolean(selectedVehicle?.rodado_type),
      },
      {
        label: 'Veiculo MDF-e com carroceria e UF',
        ok: Boolean(selectedVehicle?.body_type) && Boolean(selectedVehicle?.licensing_uf),
      },
      {
        label: 'Condutor MDF-e selecionado',
        ok: Boolean(selectedDriver),
      },
      {
        label: 'Todos os pedidos possuem XML',
        ok: includedDocuments.length > 0 && includedDocuments.every((item) => !item.blockingIssues.includes('XML nao encontrado no pedido.')),
      },
      {
        label: 'Todas as NF-es possuem chave',
        ok: includedDocuments.length > 0 && includedDocuments.every((item) => Boolean(item.nfeKey)),
      },
      {
        label: effectiveGrossWeight > 0 ? 'Peso total pronto para envio' : 'Peso zerado sera enviado ao MDF-e',
        ok: true,
      },
    ];
  }, [effectiveGrossWeight, includedDocuments, selectedDriver, selectedEmitter, selectedVehicle]);

  const hasBlockingIssues = useMemo(() => {
    return includedDocuments.some((item) => item.blockingIssues.length > 0);
  }, [includedDocuments]);

  const canEmit =
    Boolean(routeId) &&
    Boolean(selectedEmitterId) &&
    Boolean(selectedVehicleId) &&
    Boolean(selectedDriverId) &&
    includedDocuments.length > 0 &&
    !hasBlockingIssues &&
    Boolean(selectedVehicle?.rodado_type) &&
    Boolean(selectedVehicle?.body_type) &&
    Boolean(selectedVehicle?.licensing_uf) &&
    !submitting;

  const handleEmit = async () => {
    if (!canEmit || !routeId) return;

    try {
      setSubmitting(true);
      const { data, error } = await supabase.functions.invoke('emit-mdfe', {
        body: {
          routeId,
          emitterId: selectedEmitterId,
          vehicleId: selectedVehicleId,
          driverId: selectedDriverId,
          routeOrderIds: Array.from(selectedRouteOrderIds),
          manualGrossWeight: manualGrossWeight.trim() === '' ? 0 : effectiveGrossWeight,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const warningLines = Array.isArray(data?.warnings) ? data.warnings : [];
      toast.success('MDF-e enviado para processamento na Focus.');
      if (warningLines.length > 0) {
        toast.warning(`Emissao enviada com ${warningLines.length} aviso(s) nao impeditivo(s).`);
      }
      onClose();
    } catch (error: any) {
      console.error(error);
      let resolvedMessage = error?.message || 'Erro ao enviar MDF-e para a Focus';

      try {
        const response = error?.context;
        if (response instanceof Response) {
          const payload = await response.clone().json().catch(async () => {
            const text = await response.clone().text();
            return { error: text };
          });

          resolvedMessage =
            payload?.user_message ||
            payload?.error ||
            payload?.message ||
            payload?.focus_response?.mensagem ||
            payload?.focus_response?.message ||
            resolvedMessage;

          if (Array.isArray(payload?.blocking_issues) && payload.blocking_issues.length > 0) {
            resolvedMessage = `${resolvedMessage}\n${payload.blocking_issues.join('\n')}`;
          }
        }
      } catch (parseError) {
        console.warn('Falha ao interpretar erro da Edge Function:', parseError);
      }

      toast.error(resolvedMessage);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const toggleDocumentSelection = (routeOrderId: string) => {
    setSelectedRouteOrderIds((previous) => {
      const next = new Set(previous);
      if (next.has(routeOrderId)) {
        next.delete(routeOrderId);
      } else {
        next.add(routeOrderId);
      }
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">
              Emissao pela rota
            </p>
            <h2 className="mt-2 text-2xl font-bold text-slate-900">Gerar MDF-e</h2>
            <p className="mt-2 text-sm text-slate-600">
              Pre-visualizacao real dos dados da rota antes da integracao com a Focus.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex min-h-[320px] items-center justify-center">
              <div className="flex items-center gap-3 text-sm text-slate-600">
                <Loader2 className="h-5 w-5 animate-spin" />
                Carregando XMLs, cadastros e configuracoes do MDF-e...
              </div>
            </div>
          ) : loadError ? (
            <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
              <p className="font-semibold">Falha ao montar a pre-visualizacao do MDF-e.</p>
              <p className="mt-1">{loadError}</p>
            </section>
          ) : (
            <div className="space-y-6">
              <section className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-5 w-5 text-blue-700" />
                  <div className="text-sm text-blue-900">
                    <p className="font-semibold">Fluxo isolado da emissao.</p>
                    <p className="mt-1">
                      O modal ja esta consolidando os dados reais da rota, mas o envio para a
                      Focus continua desabilitado nesta etapa.
                    </p>
                  </div>
                </div>
              </section>

              <section className="grid gap-4 lg:grid-cols-4">
                <SummaryCard
                  icon={Route}
                  title="Rota"
                  description={routeCode || routeName || 'Nao informada'}
                  detail={`${includedDocuments.length} de ${state.routeOrderCount} pedido(s) no manifesto`}
                />
                <SummaryCard
                  icon={FileText}
                  title="NF-es validas"
                  description={`${totals.validKeys} de ${includedDocuments.length}`}
                  detail={
                    totals.documentsWithIssues > 0
                      ? `${totals.documentsWithIssues} documento(s) com bloqueio`
                      : `${totals.documentsWithWarnings} documento(s) com aviso`
                  }
                />
                <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 inline-flex rounded-xl bg-slate-100 p-3 text-slate-700">
                    <Truck className="h-5 w-5" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900">Peso bruto</h3>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={manualGrossWeight}
                      onChange={(event) => setManualGrossWeight(event.target.value)}
                      onBlur={() => setManualGrossWeight(formatManualWeightInput(manualGrossWeight))}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-lg font-semibold text-slate-900 outline-none focus:border-blue-500"
                    />
                    <span className="text-sm font-medium text-slate-500">KG</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    Digite o peso em KG. Ex.: 2820,30
                  </p>
                </article>
                <SummaryCard
                  icon={MapPin}
                  title="Valor total"
                  description={formatCurrency(totals.totalValue)}
                  detail="Consolidado pelos XMLs"
                />
              </section>

              <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
                <div className="space-y-6">
                  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="text-lg font-semibold text-slate-900">Dados fiscais</h3>
                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <SelectField
                        label="Emitente"
                        value={selectedEmitterId}
                        onChange={setSelectedEmitterId}
                        options={state.emitters.map((item) => ({
                          value: item.id,
                          label: `${item.company_name} - ${item.cnpj}`,
                        }))}
                      />
                      <SelectField
                        label="Veiculo MDF-e"
                        value={selectedVehicleId}
                        onChange={setSelectedVehicleId}
                        options={state.vehicles.map((item) => ({
                          value: item.id,
                          label: `${item.display_name} - ${item.plate}`,
                        }))}
                      />
                      <SelectField
                        label="Condutor MDF-e"
                        value={selectedDriverId}
                        onChange={setSelectedDriverId}
                        options={state.drivers.map((item) => ({
                          value: item.id,
                          label: `${item.name} - ${item.cpf}`,
                        }))}
                      />
                    </div>

                    <div className="mt-5 grid gap-3 md:grid-cols-2">
                      <InfoLine
                        label="Ambiente"
                        value={state.settings?.environment === 'production' ? 'Producao' : 'Homologacao'}
                      />
                      <InfoLine
                        label="Tipo de emitente"
                        value={state.settings?.emit_type === 2 ? 'Carga propria' : String(state.settings?.emit_type || '-')}
                      />
                      <InfoLine
                        label="Carregamento padrao"
                        value={formatCity(state.settings?.loading_city_name || null, state.settings?.loading_uf || null)}
                      />
                      <InfoLine
                        label="Cidades de descarregamento"
                        value={unloadingCities.length > 0 ? unloadingCities.join(', ') : 'Nao encontradas nos XMLs'}
                      />
                    </div>

                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="text-lg font-semibold text-slate-900">Documentos da rota</h3>
                    <div className="mt-4 overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-slate-50">
                          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                            <th className="px-3 py-2">Pedido</th>
                            <th className="px-3 py-2">Chave NF-e</th>
                            <th className="px-3 py-2">Destino</th>
                            <th className="px-3 py-2">Peso</th>
                            <th className="px-3 py-2">Valor</th>
                            <th className="px-3 py-2 text-right">Manifesto</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {state.documents.map((document) => (
                            <tr
                              key={document.routeOrderId}
                              className={`align-top text-sm text-slate-700 ${
                                selectedRouteOrderIds.has(document.routeOrderId) ? '' : 'bg-slate-50 opacity-70'
                              }`}
                            >
                              <td className="px-3 py-3">
                                <p className="font-medium text-slate-900">{document.orderIdErp || '-'}</p>
                                <p className="text-xs text-slate-500">{document.customerName || '-'}</p>
                                {document.blockingIssues.length > 0 && (
                                  <div className="mt-2 space-y-1">
                                    {document.blockingIssues.map((issue) => (
                                      <p key={issue} className="text-xs text-rose-600">{issue}</p>
                                    ))}
                                  </div>
                                )}
                                {document.warnings.length > 0 && (
                                  <div className="mt-2 space-y-1">
                                    {document.warnings.map((warning) => (
                                      <p key={warning} className="text-xs text-amber-600">{warning}</p>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-3 text-xs text-slate-600">
                                <div className="max-w-[220px] break-all">{document.nfeKey || '-'}</div>
                              </td>
                              <td className="px-3 py-3 text-xs text-slate-600">
                                {formatCity(document.cityName, document.uf)}
                              </td>
                              <td className="px-3 py-3 text-xs text-slate-600">
                                {formatWeight(document.grossWeight)}
                              </td>
                              <td className="px-3 py-3 text-xs text-slate-600">
                                {formatCurrency(document.totalValue)}
                              </td>
                              <td className="px-3 py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => toggleDocumentSelection(document.routeOrderId)}
                                  className={`inline-flex items-center rounded-xl px-3 py-2 text-xs font-semibold ${
                                    selectedRouteOrderIds.has(document.routeOrderId)
                                      ? 'border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                                      : 'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                  }`}
                                >
                                  {selectedRouteOrderIds.has(document.routeOrderId)
                                    ? 'Retirar do MDF-e'
                                    : 'Incluir no MDF-e'}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>

                <div className="space-y-6">
                  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="text-lg font-semibold text-slate-900">Validacoes</h3>
                    <div className="mt-4 space-y-3">
                      {validationItems.map((item) => (
                        <ValidationLine key={item.label} label={item.label} ok={item.ok} />
                      ))}
                    </div>
                  </section>

                  {state.routeIssues.length > 0 && (
                    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
                      <h3 className="text-lg font-semibold text-amber-900">Pendencias da rota</h3>
                      <div className="mt-3 space-y-2 text-sm text-amber-900">
                        {state.routeIssues.map((issue) => (
                          <p key={issue}>{issue}</p>
                        ))}
                      </div>
                    </section>
                  )}

                  <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5">
                    <h3 className="text-lg font-semibold text-slate-900">Proximo encaixe</h3>
                    <p className="mt-2 text-sm text-slate-600">
                      Revise os pedidos incluidos no manifesto. Se algum pedido da rota estiver com XML ausente
                      ou nao deve seguir nesta viagem, retire-o apenas do MDF-e sem mexer na rota.
                    </p>
                    <button
                      type="button"
                      onClick={handleEmit}
                      disabled={!canEmit}
                      className="mt-4 inline-flex items-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Emitindo MDF-e...
                        </>
                      ) : (
                        'Emitir MDF-e'
                      )}
                    </button>
                  </section>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  title,
  description,
  detail,
}: {
  icon: typeof Route;
  title: string;
  description: string;
  detail?: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 inline-flex rounded-xl bg-slate-100 p-3 text-slate-700">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-lg font-semibold text-slate-900">{description}</p>
      {detail && <p className="mt-1 text-sm text-slate-500">{detail}</p>}
    </article>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
      >
        <option value="">Selecione...</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-900">{value}</p>
    </div>
  );
}

function ValidationLine({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${
        ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-rose-200 bg-rose-50 text-rose-900'
      }`}
    >
      {ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
      <span>{label}</span>
    </div>
  );
}

function parseNfeDocument({
  routeOrderId,
  orderId,
  orderIdErp,
  customerName,
  xml,
}: {
  routeOrderId: string;
  orderId: string;
  orderIdErp: string;
  customerName: string;
  xml: string;
}): ParsedDocument {
  if (!xml || !xml.includes('<')) {
    return {
      routeOrderId,
      orderId,
      orderIdErp,
      customerName,
      nfeKey: null,
      totalValue: 0,
      grossWeight: 0,
      cityCode: null,
      cityName: null,
      uf: null,
      blockingIssues: ['XML nao encontrado no pedido.'],
      warnings: [],
    };
  }

  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xml, 'application/xml');
    if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
      return {
        routeOrderId,
        orderId,
        orderIdErp,
        customerName,
        nfeKey: null,
        totalValue: 0,
        grossWeight: 0,
        cityCode: null,
        cityName: null,
        uf: null,
        blockingIssues: ['XML invalido ou mal formatado.'],
        warnings: [],
      };
    }

    const nfeKey = getXmlNodeText(xmlDoc, 'chNFe') || null;
    const totalValue = parseDecimal(getXmlNodeText(xmlDoc, 'vNF'));
    const unloadingLocation = resolveUnloadingLocation(xmlDoc);
    const cityCode = unloadingLocation.cityCode;
    const cityName = unloadingLocation.cityName;
    const uf = unloadingLocation.uf;
    const grossWeight = resolveGrossWeight(xmlDoc);

    const blockingIssues: string[] = [];
    const warnings: string[] = [];
    if (!nfeKey) blockingIssues.push('Chave NF-e nao encontrada no XML.');
    if (grossWeight <= 0) warnings.push('Peso bruto nao encontrado no XML.');
    if (!cityName || !uf) blockingIssues.push('Cidade de descarregamento nao encontrada no XML.');

    return {
      routeOrderId,
      orderId,
      orderIdErp,
      customerName,
      nfeKey,
      totalValue,
      grossWeight,
      cityCode,
      cityName,
      uf,
      blockingIssues,
      warnings,
    };
  } catch (error) {
    console.warn('Falha ao interpretar XML da NF-e para MDF-e:', error);
    return {
      routeOrderId,
      orderId,
      orderIdErp,
      customerName,
      nfeKey: null,
      totalValue: 0,
      grossWeight: 0,
      cityCode: null,
      cityName: null,
      uf: null,
      blockingIssues: ['Falha ao interpretar o XML da NF-e.'],
      warnings: [],
    };
  }
}

function resolveGrossWeight(root: Document) {
  const volumeNodes = findXmlElementsByLocalName(root, 'vol');
  const totalFromVolumes = volumeNodes.reduce((acc, volumeNode) => {
    return acc + parseDecimal(getXmlNodeText(volumeNode, 'pesoB'));
  }, 0);

  if (totalFromVolumes > 0) return totalFromVolumes;

  const totalWeightTag =
    parseDecimal(getXmlNodeText(root, 'pesoB')) ||
    parseDecimal(getXmlNodeText(root, 'pesoL'));

  return totalWeightTag;
}

function resolveUnloadingLocation(root: Document) {
  const containers = [
    findFirstXmlElementByLocalName(root, 'entrega'),
    findFirstXmlElementByLocalName(root, 'enderEntrega'),
    findFirstXmlElementByLocalName(root, 'enderDest'),
    findFirstXmlElementByLocalName(root, 'dest'),
    root.documentElement,
  ].filter(Boolean) as Element[];

  for (const container of containers) {
    const cityCode = getXmlNodeText(container, 'cMun') || null;
    const cityName = getXmlNodeText(container, 'xMun') || null;
    const uf = getXmlNodeText(container, 'UF') || null;

    if (cityCode || cityName || uf) {
      return { cityCode, cityName, uf };
    }
  }

  return { cityCode: null, cityName: null, uf: null };
}

function findXmlElementsByLocalName(root: any, localName: string): Element[] {
  if (!root?.getElementsByTagName) return [];
  return Array.from(root.getElementsByTagName('*') as HTMLCollectionOf<Element>).filter(
    (node) => node.localName === localName
  );
}

function findFirstXmlElementByLocalName(root: any, localName: string): Element | null {
  return findXmlElementsByLocalName(root, localName)[0] || null;
}

function getXmlNodeText(root: any, localName: string) {
  const node = findFirstXmlElementByLocalName(root, localName);
  return String(node?.textContent || '').trim();
}

function parseDecimal(value: string) {
  const parsed = Number(String(value || '0').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatWeightInput(value: number) {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(value);
}

function parseManualWeight(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return 0;

  const sanitized = raw.replace(/\s/g, '');
  const lastComma = sanitized.lastIndexOf(',');
  const lastDot = sanitized.lastIndexOf('.');
  const lastSeparatorIndex = Math.max(lastComma, lastDot);

  if (lastSeparatorIndex === -1) {
    const digitsOnly = sanitized.replace(/\D/g, '');
    const parsedInteger = Number(digitsOnly);
    return Number.isFinite(parsedInteger) ? parsedInteger : 0;
  }

  const separator = sanitized[lastSeparatorIndex];
  const integerPartRaw = sanitized.slice(0, lastSeparatorIndex);
  const decimalPartRaw = sanitized.slice(lastSeparatorIndex + 1);
  const integerDigits = integerPartRaw.replace(/\D/g, '');
  const decimalDigits = decimalPartRaw.replace(/\D/g, '');

  const looksLikeThousandsSeparatorOnly =
    decimalDigits.length === 3 &&
    integerDigits.length >= 1 &&
    sanitized.indexOf(separator) === lastSeparatorIndex;

  if (looksLikeThousandsSeparatorOnly) {
    const parsedThousands = Number(`${integerDigits}${decimalDigits}`);
    return Number.isFinite(parsedThousands) ? parsedThousands : 0;
  }

  const normalized = `${integerDigits || '0'}.${decimalDigits}`;
  const parsedDecimal = Number(normalized);
  return Number.isFinite(parsedDecimal) ? parsedDecimal : 0;
}

function formatManualWeightInput(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return formatWeightInput(parseManualWeight(raw));
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

function formatCity(city: string | null, uf: string | null) {
  if (!city && !uf) return 'Nao encontrada';
  if (!city) return uf || 'Nao encontrada';
  if (!uf) return city;
  return `${city}/${uf}`;
}

function normalize(value: string | null | undefined) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}
