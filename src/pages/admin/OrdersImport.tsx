import { useEffect, useRef, useState } from 'react';
import {
  Package,
  RefreshCw,
  Eye,
  Hammer,
  Truck,
  ArrowLeft,
  LayoutGrid,
  TruckIcon,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  Clock
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '../../supabase/client';

export default function OrdersImport() {
  const [loading, setLoading] = useState(false);
  const [lastImport, setLastImport] = useState<Date | null>(null);
  const [webhookStatus, setWebhookStatus] = useState<string | null>(null);
  const [dbOrders, setDbOrders] = useState<any[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [showModal, setShowModal] = useState(false);
  const selectedOrderIdRef = useRef<string | null>(null);
  const showModalRef = useRef<boolean>(false);
  const navigate = useNavigate();

  // Stats
  const [stats, setStats] = useState({ total: 0, pending: 0, today: 0 });

  useEffect(() => {
    if (!showModal) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        showModalRef.current = false;
        localStorage.removeItem('oi_showModal');
        localStorage.removeItem('oi_selectedOrderId');
        setShowModal(false);
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [showModal]);

  const fetchImportedOrders = async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      console.error('Erro ao carregar pedidos do banco:', error);
    } else {
      setDbOrders(data || []);

      // Calc stats
      const today = new Date().toISOString().split('T')[0];
      const todayCount = (data || []).filter((o: any) => o.created_at.startsWith(today)).length;
      const pending = (data || []).filter((o: any) => o.status === 'pending').length;
      setStats({ total: data?.length || 0, pending, today: todayCount });
    }
  };

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') fetchImportedOrders();
    };
    fetchImportedOrders();
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  useEffect(() => {
    if (showModalRef.current && selectedOrderIdRef.current) {
      const found = dbOrders.find((o: any) => String(o.id) === String(selectedOrderIdRef.current));
      if (found) {
        setSelectedOrder(found);
        setShowModal(true);
      }
    }
  }, [dbOrders]);

  useEffect(() => {
    try {
      const s = localStorage.getItem('oi_showModal');
      const id = localStorage.getItem('oi_selectedOrderId');
      if (s === '1' && id) { showModalRef.current = true; selectedOrderIdRef.current = id; }
    } catch { }
  }, []);

  const importOrders = async () => {
    setLoading(true);

    try {
      let webhookUrl = import.meta.env.VITE_WEBHOOK_URL as string | undefined;
      if (!webhookUrl) {
        const { data } = await supabase.from('webhook_settings').select('url').eq('key', 'envia_pedidos').eq('active', true).single();
        webhookUrl = data?.url || 'https://n8n.lojaodosmoveis.shop/webhook-test/envia_pedidos';
      }

      const response = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timestamp: new Date().toISOString() }) });

      setWebhookStatus(`${response.status}`);

      const text = await response.text();
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }

      if (!response.ok) {
        if (typeof data === 'object' && data?.message?.includes('webhook')) {
          toast.error('Webhook de teste não está ativo. Clique em "Execute workflow" no n8n e tente novamente.');
        } else {
          toast.error('Erro ao consultar webhook.');
        }
        return;
      }

      const items = Array.isArray(data) ? data : [data];
      // setOrders(items); // Not used anymore

      // Transformar e salvar no banco - SALVAR TODOS OS CAMPOS DO JSON
      const toDb = items.map((o: any) => {
        const produtos = Array.isArray(o.produtos) ? o.produtos : (Array.isArray(o.produtos_locais) ? o.produtos_locais : []);
        const xmlDanfe = o.xml_danfe_remessa || {};

        let quantidade_volumes = 0;
        let etiquetas: string[] = [];

        if (produtos.length > 0) {
          produtos.forEach((p: any) => {
            if (p.quantidade_volumes) quantidade_volumes += p.quantidade_volumes;
            if (p.etiquetas && Array.isArray(p.etiquetas)) {
              etiquetas = etiquetas.concat(p.etiquetas);
            }
          });
        }

        return {
          order_id_erp: String(o.numero_lancamento ?? o.lancamento_venda ?? o.codigo_cliente ?? Math.random().toString(36).slice(2)),
          customer_name: String(o.nome_cliente ?? ''),
          phone: String(o.cliente_celular ?? ''),
          customer_cpf: String(o.cpf_cliente ?? ''),
          filial_venda: String(o.filial_venda ?? ''),
          vendedor_nome: String(o.nome_vendedor ?? o.vendedor ?? o.vendedor_nome ?? ''),
          data_venda: o.data_venda ? new Date(o.data_venda).toISOString() : null,
          previsao_entrega: o.previsao_entrega ? new Date(o.previsao_entrega).toISOString() : null,
          observacoes_publicas: String(o.observacoes_publicas ?? ''),
          observacoes_internas: String(o.observacoes_internas ?? ''),
          tem_frete_full: String(o.tem_frete_full ?? ''),
          address_json: {
            street: String(o.destinatario_endereco ?? ''),
            neighborhood: String(o.destinatario_bairro ?? ''),
            city: String(o.destinatario_cidade ?? ''),
            state: '',
            zip: pickZip(o),
            complement: String(o.destinatario_complemento ?? ''),
            lat: o.lat ?? o.latitude ?? null,
            lng: o.lng ?? o.longitude ?? o.long ?? null
          },
          items_json: produtos.map((p: any) => ({
            sku: String(p.codigo_produto ?? ''),
            name: String(p.nome_produto ?? ''),
            quantity: Number(p.quantidade_volumes ?? 1),
            volumes_per_unit: Number(p.quantidade_volumes ?? 1),
            purchased_quantity: Number(p.quantidade_comprada ?? 1),
            unit_price_real: Number(p.valor_unitario_real ?? p.valor_unitario ?? 0),
            total_price_real: Number(p.valor_total_real ?? p.valor_total_item ?? 0),
            unit_price: Number(p.valor_unitario_real ?? p.valor_unitario ?? 0),
            total_price: Number(p.valor_total_real ?? p.valor_total_item ?? 0),
            price: Number(p.valor_unitario_real ?? p.valor_unitario ?? 0),
            location: String(p.local_estocagem ?? ''),
            has_assembly: String(p.tem_montagem ?? ''),
            labels: Array.isArray(p.etiquetas) ? p.etiquetas : [],
          })),
          status: 'pending' as const,
          raw_json: o,
          xml_documento: xmlDanfe.conteudo_xml || null,
        } as any;
      });

      // Verificar quais pedidos já existem para evitar duplicidade
      const numerosLancamento = toDb.map((o: any) => o.order_id_erp).filter(Boolean);
      const seen = new Set<string>();
      const toDbUnique = toDb.filter((o: any) => {
        const k = String(o.order_id_erp || '').trim();
        if (!k) return false;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      let existentes: any[] = [];

      if (numerosLancamento.length > 0) {
        const { data: existentesPorLancamento } = await supabase
          .from('orders')
          .select('id, order_id_erp')
          .in('order_id_erp', numerosLancamento);
        existentes = existentesPorLancamento || [];
      }

      const existentesLancamentoSet = new Set<string>((existentes || []).map((e: any) => String(e.order_id_erp)).filter(Boolean));

      const paraInserir = toDbUnique.filter((o: any) => {
        if (o.order_id_erp && existentesLancamentoSet.has(String(o.order_id_erp))) {
          return false;
        }
        return true;
      });
      const duplicados = toDb.length - toDbUnique.length + (toDbUnique.length - paraInserir.length);

      // Inserir apenas pedidos completamente novos
      let inseridos = 0;
      let errosInsercao = 0;

      const savedOrderIds: string[] = [];
      const savedOrdersInfo: any[] = [];

      // FASE 1: SALVAR PEDIDOS (Rápido)
      for (const pedido of paraInserir) {
        try {
          const { data: inserted, error: insertError } = await supabase
            .from('orders')
            .insert(pedido)
            .select('id, order_id_erp, address_json')
            .single();

          if (!insertError) {
            inseridos++;
            if (inserted?.id) {
              savedOrderIds.push(inserted.id);
              savedOrdersInfo.push(inserted);
            }
          } else {
            errosInsercao++;
            console.warn('Erro ao inserir pedido:', pedido.order_id_erp, insertError);
          }
        } catch (e: any) {
          errosInsercao++;
          console.error('Erro crítico ao inserir pedido:', pedido.order_id_erp, e);
        }
      }

      const pedidosImportados = inseridos;

      toast.success(`Importação finalizada: ${pedidosImportados} pedidos salvos! Iniciando busca de coordenadas em segundo plano...`, {
        duration: 5000,
        style: { background: '#10B981', color: 'white' }
      });

      await fetchImportedOrders();
      setLastImport(new Date());
      setLoading(false); // Libera a UI

      // FASE 2: GEOCODIFICAR (Removido - GPS via App Motorista)
      // O código de busca background foi removido conforme solicitação para otimizar o fluxo.


    } catch (error) {
      console.error('Error importing orders:', error);
      toast.error('Erro ao importar pedidos. Tente novamente.');
      setLoading(false);
    }
  };

  const formatDateBR = (value: any) => {
    if (!value) return '-';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('pt-BR');
  };

  const statusPT = (s: string | null | undefined) => {
    switch (String(s || '').toLowerCase()) {
      case 'pending': return 'Pendente';
      case 'imported': return 'Importado';
      case 'assigned': return 'Atribuído';
      case 'delivered': return 'Entregue';
      case 'returned': return 'Retornado';
      default: return s || '-';
    }
  };
  const pickZip = (raw: any) => {
    const candidates = [raw?.destinatario_cep, raw?.cep, raw?.endereco_cep, raw?.codigo_postal, raw?.zip];
    for (const c of candidates) { const s = String(c || '').trim(); if (s) return s; }
    return '';
  };
  const pickSeller = (raw: any) => {
    const direct = [raw?.vendedor_nome, raw?.vendedor, raw?.nome_vendedor, raw?.seller, raw?.atendente, raw?.responsavel_venda, raw?.operador];
    for (const c of direct) { const s = String(c || '').trim(); if (s) return s; }
    const arrs = [raw?.produtos, raw?.produtos_locais];
    for (const arr of arrs) { if (Array.isArray(arr)) { for (const p of arr) { const s = String(p?.vendedor_nome || p?.vendedor || '').trim(); if (s) return s; } } }
    try { for (const k of Object.keys(raw || {})) { if (k.toLowerCase().includes('vendedor')) { const s = String(raw[k] || '').trim(); if (s) return s; } } } catch { }
    return '';
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigate(-1)}
                className="p-2 -ml-2 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors"
                title="Voltar"
              >
                <ArrowLeft className="h-6 w-6" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                  <UploadCloud className="h-6 w-6 text-blue-600" />
                  Importar Pedidos
                </h1>
                <p className="text-sm text-gray-500">
                  Sincronize pedidos do ERP via Webhook
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <button onClick={() => navigate('/admin')} className="inline-flex items-center px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium transition-colors">
                <LayoutGrid className="h-4 w-4 mr-2" /> Dashboard
              </button>
              <button onClick={() => navigate('/admin/routes')} className="inline-flex items-center px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium transition-colors">
                <TruckIcon className="h-4 w-4 mr-2" /> Entregas
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">Importados Hoje</p>
              <p className="text-2xl font-bold text-gray-900">{stats.today}</p>
            </div>
            <div className="p-3 bg-blue-50 rounded-lg">
              <Clock className="h-6 w-6 text-blue-600" />
            </div>
          </div>
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">Pendentes de Entrega</p>
              <p className="text-2xl font-bold text-gray-900">{stats.pending}</p>
            </div>
            <div className="p-3 bg-orange-50 rounded-lg">
              <AlertTriangle className="h-6 w-6 text-orange-600" />
            </div>
          </div>
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">Total no Banco</p>
              <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
            </div>
            <div className="p-3 bg-green-50 rounded-lg">
              <Package className="h-6 w-6 text-green-600" />
            </div>
          </div>
        </div>

        {/* Import Action Area */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 mb-8 text-center relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-purple-500"></div>

          <div className="max-w-xl mx-auto relative z-10">
            <div className="mx-auto w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
              <UploadCloud className="h-10 w-10 text-blue-600" />
            </div>

            <h2 className="text-2xl font-bold text-gray-900 mb-3">Sincronizar Pedidos</h2>
            <p className="text-gray-500 mb-8">
              Clique no botão abaixo para buscar novos pedidos do sistema ERP. O processo roda em segundo plano para não travar seu trabalho.
            </p>

            <button
              onClick={importOrders}
              disabled={loading}
              className="inline-flex items-center px-8 py-4 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:-translate-y-1 shadow-lg hover:shadow-blue-200"
            >
              {loading ? (
                <>
                  <RefreshCw className="animate-spin h-5 w-5 mr-3" />
                  Sincronizando...
                </>
              ) : (
                <>
                  <RefreshCw className="h-5 w-5 mr-3" />
                  Iniciar Importação
                </>
              )}
            </button>

            {lastImport && (
              <p className="text-xs text-gray-400 mt-4">
                Última sincronização: {lastImport.toLocaleString('pt-BR')}
              </p>
            )}
          </div>
        </div>

        {/* Orders Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <Package className="h-5 w-5 text-gray-500" />
              Histórico de Importação
            </h3>
            <span className="text-xs font-medium text-gray-500 bg-white px-2 py-1 rounded border border-gray-200">
              Últimos 200
            </span>
          </div>

          {dbOrders.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Pedido / Cliente</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Datas</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Localização</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Ações</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {dbOrders.map((o) => {
                    const city = o.address_json?.city ?? '-';
                    const statusLabel = statusPT(o.status);
                    const raw = o.raw_json || {};
                    const docNum = String(o.order_id_erp ?? raw.lancamento_venda ?? '-');
                    const dataVenda = formatDateBR(raw.data_venda);
                    const previsao = formatDateBR(raw.previsao_entrega);

                    const statusColor = o.status === 'delivered' ? 'bg-green-100 text-green-800' :
                      o.status === 'returned' ? 'bg-red-100 text-red-800' :
                        o.status === 'assigned' ? 'bg-blue-100 text-blue-800' :
                          'bg-gray-100 text-gray-800';

                    return (
                      <tr key={o.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-gray-900">#{docNum}</span>
                            <span className="text-sm text-gray-500">{o.customer_name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          <div className="flex flex-col">
                            <span>Venda: {dataVenda}</span>
                            <span className="text-xs text-gray-400">Prev: {previsao}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-700">
                          <div className="flex items-center gap-1">
                            <TruckIcon className="h-3 w-3 text-gray-400" />
                            {city}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColor}`}>
                            {statusLabel}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => { setSelectedOrder(o); selectedOrderIdRef.current = String(o.id); localStorage.setItem('oi_selectedOrderId', String(o.id)); showModalRef.current = true; localStorage.setItem('oi_showModal', '1'); setShowModal(true); }}
                            className="text-blue-600 hover:text-blue-900 font-medium text-sm inline-flex items-center transition-colors p-2 hover:bg-blue-50 rounded-lg"
                          >
                            <Eye className="h-4 w-4 mr-1" /> Detalhes
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-12 text-center">
              <Package className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900">Nenhum pedido encontrado</h3>
              <p className="text-gray-500">Clique em importar para sincronizar os dados.</p>
            </div>
          )}
        </div>
      </div>

      {/* Modal de detalhes */}
      {showModal && selectedOrder && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
              <h4 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Package className="h-5 w-5 text-blue-600" />
                Detalhes do Pedido
              </h4>
              <button
                className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-500"
                onClick={() => { showModalRef.current = false; localStorage.removeItem('oi_showModal'); localStorage.removeItem('oi_selectedOrderId'); setShowModal(false); }}
              >
                ✕
              </button>
            </div>

            <div className="p-6 overflow-y-auto custom-scrollbar">
              {/* Info Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm mb-8">
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Cliente</label>
                    <p className="text-base font-medium text-gray-900">{selectedOrder.customer_name}</p>
                    <p className="text-gray-500">CPF: {selectedOrder.customer_cpf ?? '-'}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Contato</label>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-900">{selectedOrder.phone}</span>
                      {/* WhatsApp Link logic reused */}
                      {(() => {
                        const d = String(selectedOrder.phone || '').replace(/\D/g, '');
                        const n = d ? (d.startsWith('55') ? d : '55' + d) : '';
                        return n ? (
                          <a href={`https://wa.me/${n}`} target="_blank" rel="noreferrer" className="text-green-600 hover:bg-green-50 p-1 rounded">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M20.52 3.48A11.84 11.84 0 0 0 12.04 0C5.48 0 .16 5.32.16 11.88c0 2.08.56 4.08 1.6 5.84L0 24l6.48-1.68a11.66 11.66 0 0 0 5.56 1.44h.04c6.56 0 11.88-5.32 11.88-11.88 0-3.2-1.24-6.2-3.52-8.4ZM12.08 21.2h-.04a9.7 9.7 0 0 1-4.96-1.36l-.36-.2-3.84 1L3.96 16l-.24-.4A9.86 9.86 0 0 1 2 11.88c0-5.52 4.52-10.04 10.08-10.04 2.68 0 5.2 1.04 7.08 2.92a9.9 9.9 0 0 1 2.96 7.12c0 5.56-4.52 10.32-10.04 10.32Zm5.76-7.44c-.32-.2-1.88-.92-2.16-1.04-.28-.12-.48-.2-.68.12-.2.32-.8 1.04-.98 1.24-.2.2-.36.24-.68.08-.32-.16-1.36-.5-2.6-1.6-.96-.84-1.6-1.88-1.8-2.2-.2-.32 0-.52.16-.68.16-.16.32-.4.48-.6.16-.2.2-.36.32-.6.12-.24.08-.44-.04-.64-.12-.2-.68-1.64-.92-2.2-.24-.56-.48-.48-.68-.48h-.56c-.2 0-.52.08-.8.4-.28.32-1.08 1.08-1.08 2.64s1.12 3.08 1.28 3.3c.16.2 2.24 3.42 5.4 4.72.76.32 1.36.52 1.82.66.76.24 1.44.2 1.98.12.6-.1 1.88-.76 2.14-1.5.26-.74.26-1.36.18-1.5-.08-.14-.28-.22-.6-.4Z" /></svg>
                          </a>
                        ) : null;
                      })()}
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Endereço de Entrega</label>
                    {(() => {
                      const addr = selectedOrder.address_json || {};
                      const raw = selectedOrder.raw_json || {};
                      const zip = addr.zip || pickZip(raw) || '-';
                      const street = addr.street || raw.destinatario_endereco || '';
                      const number = addr.number || '';
                      const city = addr.city || raw.destinatario_cidade || '';
                      return (
                        <>
                          <p className="text-base font-medium text-gray-900">{street}, {number}</p>
                          <p className="text-gray-600">{addr.neighborhood} - {city}</p>
                          <p className="text-gray-500 text-xs mt-1">CEP: {zip}</p>
                        </>
                      );
                    })()}
                  </div>
                  <div className="flex gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Data Venda</label>
                      <p className="font-medium">{formatDateBR(selectedOrder.raw_json?.data_venda)}</p>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Previsão</label>
                      <p className="font-medium text-blue-600">{formatDateBR(selectedOrder.raw_json?.previsao_entrega)}</p>
                    </div>
                  </div>
                </div>
              </div>

              {Array.isArray(selectedOrder.items_json) && selectedOrder.items_json.length > 0 && (
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                  <h5 className="text-sm font-bold text-gray-900 mb-3 uppercase tracking-wider">Itens do Pedido</h5>
                  <ul className="space-y-3">
                    {selectedOrder.items_json.map((p: any, idx: number) => {
                      const hasAssembly = String(p?.has_assembly || '').toLowerCase().includes('sim');
                      const freteRaw = String(selectedOrder.tem_frete_full || selectedOrder.raw_json?.tem_frete_full || '').toLowerCase();
                      const isFreteFull = ['sim', 'true', '1', 'y', 'yes'].some(v => freteRaw.includes(v));
                      return (
                        <li key={idx} className="flex items-start justify-between bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
                          <div>
                            <span className="font-medium text-gray-900 block">{p.name}</span>
                            <span className="text-xs text-gray-500">SKU: {p.sku} • Qtd: {p.purchased_quantity ?? 1}</span>
                          </div>
                          <div className="flex gap-2">
                            {hasAssembly && (
                              <span className="inline-flex items-center px-2 py-1 rounded bg-orange-100 text-orange-700 text-xs font-medium" title="Requer Montagem">
                                <Hammer className="h-3 w-3 mr-1" /> Montagem
                              </span>
                            )}
                            {isFreteFull && (
                              <span className="inline-flex items-center px-2 py-1 rounded bg-emerald-100 text-emerald-700 text-xs font-medium" title="Frete Full">
                                <Truck className="h-3 w-3 mr-1" /> Full
                              </span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Observations */}
              {(() => {
                const pub = selectedOrder.observacoes_publicas || selectedOrder.raw_json?.observacoes_publicas || '';
                const priv = selectedOrder.observacoes_internas || selectedOrder.raw_json?.observacoes_internas || '';
                return (pub || priv) ? (
                  <div className="mt-6 space-y-3">
                    {pub && (
                      <div className="p-3 bg-yellow-50 border border-yellow-100 rounded-lg text-sm text-yellow-800">
                        <span className="font-bold block mb-1">Observações Públicas:</span>
                        {pub}
                      </div>
                    )}
                    {priv && (
                      <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-800">
                        <span className="font-bold block mb-1">Observações Internas:</span>
                        {priv}
                      </div>
                    )}
                  </div>
                ) : null;
              })()}
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end">
              <button
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
                onClick={() => { showModalRef.current = false; localStorage.removeItem('oi_showModal'); localStorage.removeItem('oi_selectedOrderId'); setShowModal(false); }}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
