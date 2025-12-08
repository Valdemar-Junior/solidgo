import { useEffect, useRef, useState } from 'react';
import { Package, RefreshCw, AlertCircle, Eye, Hammer, Truck, ArrowLeft, LayoutGrid, TruckIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '../../supabase/client';

export default function OrdersImport() {
  const [loading, setLoading] = useState(false);
  const [lastImport, setLastImport] = useState<Date | null>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [webhookStatus, setWebhookStatus] = useState<string | null>(null);
  const [dbOrders, setDbOrders] = useState<any[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [showModal, setShowModal] = useState(false);
  const selectedOrderIdRef = useRef<string | null>(null);
  const showModalRef = useRef<boolean>(false);
  const navigate = useNavigate();
  
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
    } catch {}
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
      setOrders(items);

      // Transformar e salvar no banco - SALVAR TODOS OS CAMPOS DO JSON
      const toDb = items.map((o: any) => {
        const produtos = Array.isArray(o.produtos) ? o.produtos : (Array.isArray(o.produtos_locais) ? o.produtos_locais : []);
        const totalPedido = produtos.reduce((sum:number, p:any)=> sum + Number(p.valor_total_real ?? p.valor_total_item ?? 0), 0);
        const xmlDanfe = o.xml_danfe_remessa || {};
        
        // Calcular total e volumes
        let total = 0;
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
            // volumes por unidade usados na conferência
            quantity: Number(p.quantidade_volumes ?? 1),
            volumes_per_unit: Number(p.quantidade_volumes ?? 1),
            // quantidade comprada (unidades)
            purchased_quantity: Number(p.quantidade_comprada ?? 1),
            // preços reais e fallback
            unit_price_real: Number(p.valor_unitario_real ?? p.valor_unitario ?? 0),
            total_price_real: Number(p.valor_total_real ?? p.valor_total_item ?? 0),
            unit_price: Number(p.valor_unitario_real ?? p.valor_unitario ?? 0),
            total_price: Number(p.valor_total_real ?? p.valor_total_item ?? 0),
            price: Number(p.valor_unitario_real ?? p.valor_unitario ?? 0),
            // demais campos
            location: String(p.local_estocagem ?? ''),
            has_assembly: String(p.tem_montagem ?? ''),
            labels: Array.isArray(p.etiquetas) ? p.etiquetas : [],
          })),
          status: 'pending' as const,
          raw_json: o,
          xml_documento: xmlDanfe.conteudo_xml || null,
        } as any;
      });

      // Verificar quais pedidos já existem para evitar duplicidade usando apenas numero_lancamento
      const numerosLancamento = toDb.map((o: any) => o.order_id_erp).filter(Boolean);

      // Remover duplicados dentro do próprio lote (mesmo order_id_erp)
      const seen = new Set<string>();
      const toDbUnique = toDb.filter((o: any) => {
        const k = String(o.order_id_erp || '').trim();
        if (!k) return false;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      let existentes: any[] = [];
      
      // Verificar por order_id_erp (campo principal)
      if (numerosLancamento.length > 0) {
        const { data: existentesPorLancamento } = await supabase
          .from('orders')
          .select('id, order_id_erp')
          .in('order_id_erp', numerosLancamento);
        existentes = existentesPorLancamento || [];
      }
      
      // Criar set com os números de lançamento existentes
      const existentesLancamentoSet = new Set<string>((existentes || []).map((e: any) => String(e.order_id_erp)).filter(Boolean));
      
      const paraInserir = toDbUnique.filter((o: any) => {
        // Verificar por order_id_erp (campo principal)
        if (o.order_id_erp && existentesLancamentoSet.has(String(o.order_id_erp))) {
          return false; // Já existe, não inserir
        }
        return true; // Não existe, pode inserir
      });
      const duplicados = toDb.length - toDbUnique.length + (toDbUnique.length - paraInserir.length);

      // Inserir apenas pedidos completamente novos, um por vez para evitar erros de constraint
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

      // Mensagem de sucesso com formato claro e direto
      const totalPedidos = toDb.length;
      const pedidosImportados = inseridos;
      const pedidosIgnorados = duplicados;
      const erros = errosInsercao;
      
      toast.success(`Importação finalizada: ${pedidosImportados} pedidos salvos! Iniciando busca de coordenadas em segundo plano...`, {
        duration: 5000,
        style: { background: '#10B981', color: 'white' }
      });

      await fetchImportedOrders();
      setLastImport(new Date());
      setLoading(false); // Libera a UI

      // FASE 2: GEOCODIFICAR (Lento - Background)
      if (savedOrdersInfo.length > 0) {
        let geoCount = 0;
        const totalGeo = savedOrdersInfo.length;
        
        // Notificação de progresso inicial
        const toastId = toast.loading(`Buscando GPS: 0/${totalGeo} concluídos`, { duration: Infinity });

        for (const order of savedOrdersInfo) {
           try {
              // Se já tem coordenadas, não precisa buscar
              const addr = order.address_json || {};
              const hasLat = addr.lat && !isNaN(Number(addr.lat));
              const hasLng = addr.lng && !isNaN(Number(addr.lng));
              
              if (hasLat && hasLng) {
                  // Já tem
              } else {
                // Delay para respeitar rate limit do Nominatim (aprox 1.2s)
                await new Promise(r => setTimeout(r, 1200));
                
                const gRes = await fetch('/api/geocode-order', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ orderId: order.id, debug: true })
                });
                
                if (gRes.ok) {
                  const gJson = await gRes.json();
                  if (gJson.ok) console.log(`Geocode OK [${order.order_id_erp}]`);
                  else console.warn(`Geocode falhou [${order.order_id_erp}]:`, gJson);
                }
              }
              
              geoCount++;
              // Atualiza o toast a cada 5 pedidos ou no final
              if (geoCount % 5 === 0 || geoCount === totalGeo) {
                toast.message(`Buscando GPS: ${geoCount}/${totalGeo} concluídos`, { id: toastId });
              }
           } catch (e) {
             console.error('Erro geocode background:', e);
           }
        }
        
        toast.success('Busca de coordenadas finalizada!', { id: toastId, duration: 3000 });
        await fetchImportedOrders(); // Atualiza a lista com as coords
      }
      
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
    try { for (const k of Object.keys(raw || {})) { if (k.toLowerCase().includes('vendedor')) { const s = String(raw[k] || '').trim(); if (s) return s; } } } catch {}
    return '';
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <button onClick={()=>navigate(-1)} className="inline-flex items-center px-3 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">
          <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
        </button>
        <div className="flex items-center space-x-2">
          <button onClick={()=>navigate('/admin')} className="inline-flex items-center px-3 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">
            <LayoutGrid className="h-4 w-4 mr-2" /> Dashboard
          </button>
          <button onClick={()=>navigate('/admin/routes')} className="inline-flex items-center px-3 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">
            <TruckIcon className="h-4 w-4 mr-2" /> Gestão de Entregas
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center">
            <Package className="h-6 w-6 mr-2" />
            Importar Pedidos
          </h2>
          <p className="text-gray-600 mt-1">
            Importe pedidos do sistema ERP via webhook
          </p>
        </div>
        
        {lastImport && (
          <div className="text-sm text-gray-500">
            Última importação: {lastImport.toLocaleString('pt-BR')}
          </div>
        )}
      </div>

      <div className="border rounded-xl bg-gray-50 p-10 text-center">
        <div className="mx-auto w-12 h-12 text-gray-400 mb-4">
          <Package className="h-12 w-12" />
        </div>
        
        

        

        <div className="flex items-center justify-center">
          <button
            onClick={importOrders}
            disabled={loading}
            className="inline-flex items-center px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <>
                <RefreshCw className="animate-spin h-5 w-5 mr-2" />
                Importando...
              </>
            ) : (
              <>
                <Package className="h-5 w-5 mr-2" />
                Importar Pedidos
              </>
            )}
          </button>
          
        </div>
      </div>

      {/* Tabela de pedidos salvos no banco */}
      {dbOrders.length > 0 && (
        <div className="mt-8">
          <h3 className="text-xl font-semibold text-gray-900 mb-4">Pedidos importados</h3>
          <div className="overflow-x-auto bg-white rounded-lg shadow">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nº Lançamento</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cliente</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Data Emissão</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Previsão Entrega</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cidade</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
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
                  return (
                    <tr key={o.id}>
                      <td className="px-4 py-3 text-sm text-gray-900">{docNum}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{o.customer_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{dataVenda}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{previsao}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{city}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex px-2 py-1 rounded-full text-xs font-semibold border border-gray-300 text-gray-700">{statusLabel}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => { setSelectedOrder(o); selectedOrderIdRef.current = String(o.id); localStorage.setItem('oi_selectedOrderId', String(o.id)); showModalRef.current = true; localStorage.setItem('oi_showModal','1'); setShowModal(true); }}
                          className="inline-flex items-center text-blue-600 hover:text-blue-800 text-sm font-medium"
                        >
                          <Eye className="h-4 w-4 mr-1" /> Ver
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {dbOrders.length === 0 && webhookStatus === '200' && (
        <div className="mt-8 text-sm text-gray-600">Nenhum pedido retornado pelo webhook.</div>
      )}

      {/* Modal de detalhes */}
      {showModal && selectedOrder && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[80vh] overflow-auto">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h4 className="text-lg font-semibold text-gray-900">Detalhes do Pedido</h4>
              <button className="text-gray-600 hover:text-gray-900" onClick={() => { showModalRef.current = false; localStorage.removeItem('oi_showModal'); localStorage.removeItem('oi_selectedOrderId'); setShowModal(false); }}>Fechar</button>
            </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div><span className="font-medium">Nº Lançamento:</span> {String(selectedOrder.order_id_erp ?? selectedOrder.raw_json?.lancamento_venda ?? '-')}</div>
                  <div><span className="font-medium">Operação:</span> {selectedOrder.raw_json?.operacoes ?? '-'}</div>
                  <div><span className="font-medium">Cliente:</span> {selectedOrder.customer_name}</div>
                  <div><span className="font-medium">CPF:</span> {selectedOrder.customer_cpf ?? selectedOrder.raw_json?.cpf_cliente ?? '-'}</div>
                  
                  <div>
                    <span className="font-medium">Telefone:</span> {selectedOrder.phone}
                    {(() => {
                      const toDigits = (s: string) => String(s || '').replace(/\D/g, '');
                      const d = toDigits(selectedOrder.phone);
                      const n = d ? (d.startsWith('55') ? d : '55' + d) : '';
                      const href = n ? `https://wa.me/${n}` : '';
                      return href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center text-green-600 hover:text-green-700" title="Abrir WhatsApp">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                            <path d="M20.52 3.48A11.84 11.84 0 0 0 12.04 0C5.48 0 .16 5.32.16 11.88c0 2.08.56 4.08 1.6 5.84L0 24l6.48-1.68a11.66 11.66 0 0 0 5.56 1.44h.04c6.56 0 11.88-5.32 11.88-11.88 0-3.2-1.24-6.2-3.52-8.4ZM12.08 21.2h-.04a9.7 9.7 0 0 1-4.96-1.36l-.36-.2-3.84 1L3.96 16l-.24-.4A9.86 9.86 0 0 1 2 11.88c0-5.52 4.52-10.04 10.08-10.04 2.68 0 5.2 1.04 7.08 2.92a9.9 9.9 0 0 1 2.96 7.12c0 5.56-4.52 10.32-10.04 10.32Zm5.76-7.44c-.32-.2-1.88-.92-2.16-1.04-.28-.12-.48-.2-.68.12-.2.32-.8 1.04-.98 1.24-.2.2-.36.24-.68.08-.32-.16-1.36-.5-2.6-1.6-.96-.84-1.6-1.88-1.8-2.2-.2-.32 0-.52.16-.68.16-.16.32-.4.48-.6.16-.2.2-.36.32-.6.12-.24.08-.44-.04-.64-.12-.2-.68-1.64-.92-2.2-.24-.56-.48-.48-.68-.48h-.56c-.2 0-.52.08-.8.4-.28.32-1.08 1.08-1.08 2.64s1.12 3.08 1.28 3.3c.16.2 2.24 3.42 5.4 4.72.76.32 1.36.52 1.82.66.76.24 1.44.2 1.98.12.6-.1 1.88-.76 2.14-1.5.26-.74.26-1.36.18-1.5-.08-.14-.28-.22-.6-.4Z" />
                          </svg>
                        </a>
                      ) : null;
                    })()}
                  </div>
                  {(() => {
                    const addr = selectedOrder.address_json || {};
                    const raw = selectedOrder.raw_json || {};
                    const zip = addr.zip || pickZip(raw) || '-';
                    const neighborhood = addr.neighborhood || raw.destinatario_bairro || '';
                    const city = addr.city || raw.destinatario_cidade || '';
                    const street = addr.street || raw.destinatario_endereco || '';
                    const combined = [street, neighborhood && `- ${neighborhood}`, city].filter(Boolean).join(', ').replace(', -', ' -');
                    return (
                      <>
                        <div><span className="font-medium">Cidade:</span> {city || '-'}</div>
                        <div><span className="font-medium">Endereço:</span> {combined || '-'}</div>
                        <div><span className="font-medium">CEP:</span> {zip || '-'}</div>
                      </>
                    );
                  })()}
                  {(() => {
                    const raw = selectedOrder.raw_json || {};
                    const seller = pickSeller(raw);
                    return <div><span className="font-medium">Vendedor:</span> {seller || '-'}</div>;
                  })()}
                  <div><span className="font-medium">Data venda:</span> {formatDateBR(selectedOrder.raw_json?.data_venda)}</div>
                  <div><span className="font-medium">Previsão entrega:</span> {formatDateBR(selectedOrder.raw_json?.previsao_entrega)}</div>
                  <div><span className="font-medium">Filial venda:</span> {selectedOrder.raw_json?.filial_venda ?? '-'}</div>
                  <div><span className="font-medium">Filial entrega:</span> {selectedOrder.raw_json?.filial_entrega ?? '-'}</div>
                </div>

              {Array.isArray(selectedOrder.items_json) && selectedOrder.items_json.length > 0 && (
                <div>
                  <div className="text-sm font-semibold text-gray-900 mb-1">Produtos</div>
                  <ul className="text-sm text-gray-800 space-y-1">
                    {selectedOrder.items_json.map((p: any, idx: number) => {
                      const hasAssembly = String(p?.has_assembly || '').toLowerCase().includes('sim');
                      const freteRaw = String(selectedOrder.tem_frete_full || selectedOrder.raw_json?.tem_frete_full || '').toLowerCase();
                      const isFreteFull = ['sim','true','1','y','yes'].some(v => freteRaw.includes(v));
                      return (
                        <li key={idx} className="flex items-center">
                          <span>{p.name} • Código: {p.sku} • Qtd: {p.purchased_quantity ?? 1}</span>
                          {hasAssembly && (
                            <span className="ml-2 inline-flex items-center text-orange-500" title="Montagem">
                              <Hammer className="h-4 w-4" />
                            </span>
                          )}
                          {isFreteFull && (
                            <span className="ml-2 inline-flex items-center text-emerald-600" title="Frete Full">
                              <Truck className="h-4 w-4" />
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {(() => {
                const pub = selectedOrder.observacoes_publicas || selectedOrder.raw_json?.observacoes_publicas || '';
                const priv = selectedOrder.observacoes_internas || selectedOrder.raw_json?.observacoes_internas || '';
                return (pub || priv) ? (
                  <div className="space-y-2">
                    {pub && (
                      <div className="text-sm text-gray-800 bg-yellow-50 p-2 rounded border border-yellow-200">
                        <span className="font-semibold">Observações públicas:</span> {pub}
                      </div>
                    )}
                    {priv && (
                      <div className="text-sm text-gray-800 bg-blue-50 p-2 rounded border border-blue-200">
                        <span className="font-semibold">Observações internas:</span> {priv}
                      </div>
                    )}
                  </div>
                ) : null;
              })()}

              {selectedOrder.raw_json?.observacoes && (
                <div className="text-sm text-gray-700">Obs.: {selectedOrder.raw_json.observacoes}</div>
              )}

              {/* Payload completo removido para simplificar a visualização do usuário admin */}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
