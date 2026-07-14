import { useMemo, useState } from 'react';
import { AlertTriangle, FlaskConical, PackageSearch, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../supabase/client';

type LoadedOrder = {
  id: string;
  order_id_erp: string;
  customer_name: string | null;
  status: string | null;
  blocked_reason: string | null;
  return_flag: boolean | null;
};

type LoadedBalance = {
  order_item_id: string;
  source_line_key: string;
  sku: string | null;
  product_name: string;
  purchased_quantity: number;
  returned_quantity: number;
  shadow_deliverable_quantity: number;
  source_present: boolean;
};

type LoadedReturn = {
  id: string;
  return_nfe_number: string | null;
  return_date: string | null;
  return_type: string | null;
  processing_status: string;
  reason: string | null;
};

type QuantityMap = Record<string, string>;

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pt-BR');
};

export default function TemporaryReturnSimulator() {
  const [orderErp, setOrderErp] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadedOrder, setLoadedOrder] = useState<LoadedOrder | null>(null);
  const [balances, setBalances] = useState<LoadedBalance[]>([]);
  const [returnsHistory, setReturnsHistory] = useState<LoadedReturn[]>([]);
  const [quantities, setQuantities] = useState<QuantityMap>({});
  const [returnNfeNumber, setReturnNfeNumber] = useState('');
  const [reason, setReason] = useState('Devolução manual para teste');

  const availableItems = useMemo(
    () => balances.filter((item) => item.source_present),
    [balances]
  );

  const resetLoadedData = () => {
    setLoadedOrder(null);
    setBalances([]);
    setReturnsHistory([]);
    setQuantities({});
    setReturnNfeNumber('');
  };

  const loadOrder = async () => {
    const normalizedOrderErp = orderErp.trim();
    if (!normalizedOrderErp) {
      toast.error('Informe o número do pedido.');
      return;
    }

    setLoading(true);
    try {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('id, order_id_erp, customer_name, status, blocked_reason, return_flag')
        .eq('order_id_erp', normalizedOrderErp)
        .single();

      if (orderError || !order) {
        resetLoadedData();
        throw new Error(`Pedido ${normalizedOrderErp} não encontrado.`);
      }

      const { data: balanceRows, error: balanceError } = await supabase
        .from('order_item_shadow_balances')
        .select('order_item_id, source_line_key, sku, product_name, purchased_quantity, returned_quantity, shadow_deliverable_quantity, source_present')
        .eq('order_id', order.id)
        .order('source_line_key', { ascending: true });

      if (balanceError) {
        throw balanceError;
      }

      const { data: returnRows, error: returnsError } = await supabase
        .from('order_returns')
        .select('id, return_nfe_number, return_date, return_type, processing_status, reason')
        .eq('order_id', order.id)
        .order('created_at', { ascending: false });

      if (returnsError) {
        throw returnsError;
      }

      setLoadedOrder(order);
      setBalances((balanceRows || []) as LoadedBalance[]);
      setReturnsHistory((returnRows || []) as LoadedReturn[]);
      setQuantities(
        Object.fromEntries(
          ((balanceRows || []) as LoadedBalance[]).map((item) => [item.order_item_id, '0'])
        )
      );
      setReturnNfeNumber(`SIM-${normalizedOrderErp}-${String((returnRows || []).length + 1).padStart(2, '0')}`);

      toast.success(`Pedido ${normalizedOrderErp} carregado.`);
    } catch (error: any) {
      console.error('[TemporaryReturnSimulator] Erro ao carregar pedido:', error);
      toast.error(error?.message || 'Não foi possível carregar o pedido.');
    } finally {
      setLoading(false);
    }
  };

  const setItemQuantity = (orderItemId: string, value: string) => {
    setQuantities((prev) => ({ ...prev, [orderItemId]: value }));
  };

  const clearForm = () => {
    setQuantities(
      Object.fromEntries(
        availableItems.map((item) => [item.order_item_id, '0'])
      )
    );
    setReason('Devolução manual para teste');
  };

  const submitReturn = async () => {
    if (!loadedOrder) {
      toast.error('Carregue um pedido antes de simular a devolução.');
      return;
    }

    const selectedItems = availableItems
      .map((item) => {
        const rawValue = String(quantities[item.order_item_id] || '0').replace(',', '.').trim();
        const quantity = Number(rawValue);
        return { item, quantity };
      })
      .filter((entry) => entry.quantity > 0);

    if (selectedItems.length === 0) {
      toast.error('Informe ao menos um item com quantidade maior que zero.');
      return;
    }

    const invalidEntry = selectedItems.find(({ item, quantity }) => {
      const maxAllowed = Number(item.purchased_quantity) - Number(item.returned_quantity);
      return !Number.isFinite(quantity) || quantity <= 0 || quantity > maxAllowed;
    });

    if (invalidEntry) {
      const maxAllowed = Number(invalidEntry.item.purchased_quantity) - Number(invalidEntry.item.returned_quantity);
      toast.error(`Quantidade inválida para ${invalidEntry.item.product_name}. Máximo permitido agora: ${maxAllowed}.`);
      return;
    }

    const resultingDeliveredBalance = availableItems.reduce((acc, item) => {
      const selected = selectedItems.find((entry) => entry.item.order_item_id === item.order_item_id);
      const nextReturned = Number(item.returned_quantity) + Number(selected?.quantity || 0);
      const remaining = Number(item.purchased_quantity) - nextReturned;
      return acc + Math.max(remaining, 0);
    }, 0);

    const computedReturnType = resultingDeliveredBalance <= 0 ? 'total' : 'partial';
    const nfeNumber = returnNfeNumber.trim() || `SIM-${loadedOrder.order_id_erp}-${Date.now()}`;

    setSubmitting(true);
    try {
      const { error: simulateError } = await supabase.rpc('simulate_order_return_for_testing', {
        p_order_id: loadedOrder.id,
        p_return_nfe_number: nfeNumber,
        p_reason: reason.trim() || 'Devolução manual para teste',
        p_items: selectedItems.map(({ item, quantity }) => ({
          order_item_id: item.order_item_id,
          returned_quantity: quantity,
        })),
        p_return_date: new Date().toISOString(),
      });

      if (simulateError) throw simulateError;

      toast.success(`Devolução de teste ${computedReturnType === 'total' ? 'total' : 'parcial'} criada para o pedido ${loadedOrder.order_id_erp}.`);
      clearForm();
      await loadOrder();
    } catch (error: any) {
      console.error('[TemporaryReturnSimulator] Erro ao criar devolução:', error);
      toast.error(error?.message || 'Não foi possível criar a devolução de teste.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <div className="flex items-start gap-3">
          <FlaskConical className="mt-0.5 h-5 w-5 text-amber-700" />
          <div>
            <h1 className="text-xl font-bold text-amber-900">Simulador temporário de devolução</h1>
            <p className="mt-1 text-sm text-amber-800">
              Tela de apoio para testes. Não entra no menu principal e pode ser apagada depois sem impacto no fluxo oficial.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <div className="flex-1">
            <label className="mb-2 block text-sm font-medium text-gray-700">Pedido ERP</label>
            <input
              value={orderErp}
              onChange={(event) => setOrderErp(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void loadOrder();
                }
              }}
              placeholder="Ex.: 140329"
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <button
            type="button"
            onClick={() => void loadOrder()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <PackageSearch className="h-4 w-4" />
            {loading ? 'Carregando...' : 'Carregar pedido'}
          </button>

          <button
            type="button"
            onClick={resetLoadedData}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 px-5 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            <Trash2 className="h-4 w-4" />
            Limpar
          </button>
        </div>
      </div>

      {loadedOrder && (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2">
              <h2 className="text-lg font-semibold text-gray-900">Pedido carregado</h2>
              <div className="mt-3 grid gap-3 text-sm text-gray-700 md:grid-cols-2">
                <div><span className="font-semibold">Pedido:</span> {loadedOrder.order_id_erp}</div>
                <div><span className="font-semibold">Cliente:</span> {loadedOrder.customer_name || '-'}</div>
                <div><span className="font-semibold">Status:</span> {loadedOrder.status || '-'}</div>
                <div><span className="font-semibold">Motivo bloqueio:</span> {loadedOrder.blocked_reason || '-'}</div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">Histórico</h2>
              <div className="mt-3 space-y-2 text-sm text-gray-700">
                <div><span className="font-semibold">Eventos de devolução:</span> {returnsHistory.length}</div>
                <div><span className="font-semibold">Flag de devolução:</span> {loadedOrder.return_flag ? 'Sim' : 'Não'}</div>
                <div><span className="font-semibold">Itens estruturados:</span> {availableItems.length}</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
              <div>
                Esta tela respeita o fluxo real: cria registro em <code>order_returns</code>, cria itens em <code>order_return_items</code> e depois roda a reconciliação operacional do pedido.
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">NF de devolução</label>
                <input
                  value={returnNfeNumber}
                  onChange={(event) => setReturnNfeNumber(event.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Motivo</label>
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </div>

            <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3">Produto</th>
                    <th className="px-4 py-3">SKU</th>
                    <th className="px-4 py-3">Comprado</th>
                    <th className="px-4 py-3">Já devolvido</th>
                    <th className="px-4 py-3">Saldo atual</th>
                    <th className="px-4 py-3">Devolver agora</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {availableItems.map((item) => {
                    const maxAllowed = Number(item.purchased_quantity) - Number(item.returned_quantity);
                    return (
                      <tr key={item.order_item_id}>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{item.product_name}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{item.sku || '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{item.purchased_quantity}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{item.returned_quantity}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{item.shadow_deliverable_quantity}</td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            min="0"
                            max={maxAllowed}
                            step="1"
                            value={quantities[item.order_item_id] || '0'}
                            onChange={(event) => setItemQuantity(item.order_item_id, event.target.value)}
                            className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                          />
                          <div className="mt-1 text-xs text-gray-500">Máximo agora: {maxAllowed}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void submitReturn()}
                disabled={submitting}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RotateCcw className="h-4 w-4" />
                {submitting ? 'Gravando devolução...' : 'Simular devolução'}
              </button>

              <button
                type="button"
                onClick={clearForm}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 px-5 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                Limpar quantidades
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Devoluções já registradas</h2>
            {returnsHistory.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">Nenhum evento de devolução encontrado para este pedido.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {returnsHistory.map((returnEvent) => (
                  <div key={returnEvent.id} className="rounded-xl border border-gray-200 p-4 text-sm">
                    <div className="grid gap-2 md:grid-cols-3">
                      <div><span className="font-semibold">NF:</span> {returnEvent.return_nfe_number || '-'}</div>
                      <div><span className="font-semibold">Tipo:</span> {returnEvent.return_type || '-'}</div>
                      <div><span className="font-semibold">Status:</span> {returnEvent.processing_status}</div>
                      <div><span className="font-semibold">Data:</span> {formatDateTime(returnEvent.return_date)}</div>
                      <div className="md:col-span-2"><span className="font-semibold">Motivo:</span> {returnEvent.reason || '-'}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
