import { useEffect, useRef, useState } from 'react';
import { Package, RefreshCw, AlertCircle, Eye } from 'lucide-react';
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

      // Transformar e salvar no banco
      const toDb = items.map((o: any) => {
        const produtos = Array.isArray(o.produtos_locais) ? o.produtos_locais : [];
        const xmls = Array.isArray(o.xmls_documentos) ? o.xmls_documentos : (Array.isArray(o.xmls) ? o.xmls : []);
        const firstXml = Array.isArray(xmls) && xmls.length > 0
          ? (typeof xmls[0] === 'string' ? xmls[0] : (xmls[0]?.xml || xmls[0]?.base64 || ''))
          : '';
        return {
          order_id_erp: String(o.lancamento_venda ?? o.codigo_cliente ?? Math.random().toString(36).slice(2)),
          customer_name: String(o.nome_cliente ?? ''),
          phone: String(o.cliente_celular ?? ''),
          address_json: {
            street: String(o.destinatario_endereco ?? ''),
            neighborhood: String(o.destinatario_bairro ?? ''),
            city: String(o.destinatario_cidade ?? ''),
            state: '',
            zip: String(o.destinatario_cep ?? ''),
            complement: o.destinatario_complemento ?? ''
          },
          items_json: produtos.map((p: any) => ({
            sku: String(p.codigo_produto ?? ''),
            name: String(p.nome_produto ?? ''),
            quantity: 1,
            price: 0,
            location: String(p.local_estocagem ?? ''),
          })),
          total: 0,
          observations: o.observacoes ?? null,
          status: 'pending' as const,
          raw_json: o,
          xml_documento: firstXml || null,
        } as any;
      });

      // Evitar reimportar pedidos já em rota (status != 'pending')
      const numeros = toDb.map((o: any) => o.order_id_erp);
      const { data: existentes } = await supabase
        .from('orders')
        .select('id, order_id_erp, status')
        .in('order_id_erp', numeros);
      const bloqueados = new Set<string>((existentes || []).filter((e: any) => e.status && e.status !== 'pending').map((e: any) => String(e.order_id_erp)));
      const paraUpsert = toDb.filter((o: any) => !bloqueados.has(String(o.order_id_erp)));
      const ignorados = toDb.length - paraUpsert.length;

      // Upsert por order_id_erp somente dos permitidos (tenta com raw_json; se a coluna não existir, faz fallback sem raw_json)
      const { data: upsertData, error: upsertError } = await supabase
        .from('orders')
        .upsert(paraUpsert, { onConflict: 'order_id_erp' })
        .select();
      if (upsertError) {
        const msg = String((upsertError as any)?.message || '').toLowerCase();
        const missingRaw = msg.includes("could not find the 'raw_json' column") || msg.includes('column raw_json') || msg.includes('raw_json');
        if (missingRaw) {
          const toDbWithoutRaw = paraUpsert.map((o: any) => {
            const { raw_json, ...rest } = o;
            return rest;
          });
          const { error: retryError } = await supabase
            .from('orders')
            .upsert(toDbWithoutRaw, { onConflict: 'order_id_erp' });
          if (retryError) {
            console.error('Erro ao salvar pedidos (fallback):', retryError);
            toast.error('Erro ao salvar pedidos no banco (fallback)');
            return;
          }
        } else {
          console.error('Erro ao salvar pedidos:', upsertError);
          const code = (upsertError as any)?.code || '';
          if (code === '42501' || msg.includes('row-level security')) {
            toast.error('Permissão negada: verifique policies RLS para INSERT/UPDATE em orders (admin).');
            return;
          }
          if (msg.includes('unique')) {
            toast.error('Conflito de duplicidade: alguns pedidos já existem.');
            return;
          }
          toast.error((upsertError as any)?.message || 'Erro ao salvar pedidos no banco');
          return;
        }
      }
      // Nenhuma persistência de XML extra necessária: cada pedido tem um único XML

      if (ignorados > 0) {
        toast.info(`${ignorados} pedido(s) ignorado(s) por já estarem em rota`);
      }
      toast.success('Pedidos salvos no banco');

      await fetchImportedOrders();
      setLastImport(new Date());
      
    } catch (error) {
      console.error('Error importing orders:', error);
      toast.error('Erro ao importar pedidos. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const formatDateBR = (value: any) => {
    if (!value) return '-';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('pt-BR');
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
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
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nº Documento</th>
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
                  const statusLabel = o.status === 'pending' ? 'Pendente' : o.status;
                  const raw = o.raw_json || {};
                  const docNum = String(raw.lancamento_venda ?? o.order_id_erp ?? '-');
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
                  <div><span className="font-medium">Nº Documento:</span> {String(selectedOrder.raw_json?.lancamento_venda ?? selectedOrder.order_id_erp)}</div>
                  <div><span className="font-medium">Operação:</span> {selectedOrder.raw_json?.operacoes ?? '-'}</div>
                  <div><span className="font-medium">Cliente:</span> {selectedOrder.customer_name}</div>
                  <div><span className="font-medium">Documento:</span> {selectedOrder.raw_json?.documento_cliente ?? '-'}</div>
                  <div><span className="font-medium">Telefone:</span> {selectedOrder.phone}</div>
                  <div><span className="font-medium">Cidade:</span> {selectedOrder.address_json?.city ?? '-'}</div>
                  <div><span className="font-medium">Bairro:</span> {selectedOrder.address_json?.neighborhood ?? '-'}</div>
                  <div><span className="font-medium">Endereço:</span> {selectedOrder.address_json?.street ?? '-'}</div>
                  <div><span className="font-medium">CEP:</span> {selectedOrder.address_json?.zip ?? '-'}</div>
                  <div><span className="font-medium">Data venda:</span> {formatDateBR(selectedOrder.raw_json?.data_venda)}</div>
                  <div><span className="font-medium">Previsão entrega:</span> {formatDateBR(selectedOrder.raw_json?.previsao_entrega)}</div>
                  <div><span className="font-medium">Filial venda:</span> {selectedOrder.raw_json?.filial_venda ?? '-'}</div>
                  <div><span className="font-medium">Filial entrega:</span> {selectedOrder.raw_json?.filial_entrega ?? '-'}</div>
                </div>

              {Array.isArray(selectedOrder.items_json) && selectedOrder.items_json.length > 0 && (
                <div>
                  <div className="text-sm font-semibold text-gray-900 mb-1">Produtos</div>
                  <ul className="text-sm text-gray-800 list-disc list-inside">
                    {selectedOrder.items_json.map((p: any, idx: number) => (
                      <li key={idx}>{p.name} • Código: {p.sku} • Qtd: {p.quantity}</li>
                    ))}
                  </ul>
                </div>
              )}

              {selectedOrder.raw_json?.observacoes && (
                <div className="text-sm text-gray-700">Obs.: {selectedOrder.raw_json.observacoes}</div>
              )}

              <div className="mt-4">
                <div className="text-sm font-semibold text-gray-900 mb-2">Payload completo</div>
                <pre className="bg-gray-100 rounded p-3 text-xs overflow-auto max-h-64">{JSON.stringify(selectedOrder.raw_json ?? {}, null, 2)}</pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
