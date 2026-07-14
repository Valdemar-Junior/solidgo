// Gera o PDF do comprovante de retirada de forma auto-contida (sem depender da
// tela de roteirização), pra poder ser usado também na tela do gerente.
import { DeliverySheetGenerator } from '../pdf/deliverySheetGenerator';

export interface PickupReceiptEntry {
  order: any;
  /** Itens efetivamente retirados (o comprovante sai só com eles). */
  items: any[];
  withdrawal: {
    id?: string | null;
    withdrawn_at?: string | null;
    responsible_name?: string | null;
    registered_by_name?: string | null;
    notes?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
  };
}

function mapOrderForReceipt(order: any, items: any[]) {
  const address = order?.address_json || {};
  return {
    id: order?.id,
    order_id_erp: String(order?.order_id_erp || ''),
    customer_name: String(order?.customer_name || (order?.raw_json?.nome_cliente ?? '')),
    phone: String(order?.phone || (order?.raw_json?.cliente_celular ?? '')),
    address_json: {
      street: String(address.street || order?.raw_json?.destinatario_endereco || ''),
      neighborhood: String(address.neighborhood || order?.raw_json?.destinatario_bairro || ''),
      city: String(address.city || order?.raw_json?.destinatario_cidade || ''),
      state: String(address.state || ''),
      zip: String(address.zip || order?.raw_json?.destinatario_cep || ''),
      complement: address.complement || order?.raw_json?.destinatario_complemento || '',
    },
    items_json: Array.isArray(items) ? items : [],
    raw_json: order?.raw_json || null,
    data_venda: order?.data_venda || order?.raw_json?.data_venda || '',
    previsao_entrega: order?.previsao_entrega || order?.raw_json?.previsao_entrega || null,
    observacoes_publicas: order?.observacoes_publicas ?? order?.raw_json?.observacoes ?? '',
    observacoes_internas: order?.observacoes_internas ?? order?.raw_json?.observacoes_internas ?? '',
    total: Number(order?.total || 0),
    status: 'delivered',
    created_at: order?.created_at || new Date().toISOString(),
    updated_at: order?.updated_at || new Date().toISOString(),
  } as any;
}

export async function buildPickupReceiptPdf(
  entries: PickupReceiptEntry[],
  opts: { conferenteName?: string } = {}
): Promise<Uint8Array> {
  if (!entries.length) {
    throw new Error('Nenhum pedido disponível para imprimir o comprovante de retirada.');
  }

  const first = entries[0].withdrawal;
  const nowIso = new Date().toISOString();
  const routeId = `withdrawal-${first.id || 'retirada'}`;
  const routeName = `RETIRADA - ${new Date(first.withdrawn_at || nowIso).toLocaleDateString('pt-BR')}`;

  const routeOrders = entries.map((entry, index) => ({
    id: entry.withdrawal.id || `${routeId}-${index + 1}`,
    route_id: routeId,
    order_id: String(entry.order.id),
    sequence: index + 1,
    status: 'delivered',
    delivered_at: entry.withdrawal.withdrawn_at || nowIso,
    delivery_observations: entry.withdrawal.notes || `Conferente: ${entry.withdrawal.responsible_name || '-'}`,
  })) as any[];

  const mappedOrders = entries.map((entry) => mapOrderForReceipt(entry.order, entry.items));

  return DeliverySheetGenerator.generateDeliverySheet({
    route: {
      id: routeId,
      name: routeName,
      route_code: `RET-${String(first.id || 'retirada').slice(0, 8).toUpperCase()}`,
      driver_id: '',
      vehicle_id: '',
      conferente: opts.conferenteName || first.registered_by_name || 'Não informado',
      observations: `Conferente: ${first.responsible_name || '-'}${first.notes ? `\nObs: ${first.notes}` : ''}`,
      status: 'completed',
      created_at: first.created_at || nowIso,
      updated_at: first.updated_at || nowIso,
      completed_at: first.withdrawn_at || nowIso,
    } as any,
    routeOrders,
    driver: {
      id: 'withdrawal',
      user_id: '',
      cpf: '',
      active: true,
      user: {
        id: '', email: '', name: 'Retirada pelo cliente', role: 'driver', active: true,
        created_at: first.created_at || nowIso,
      },
    } as any,
    orders: mappedOrders,
    generatedAt: nowIso,
    teamName: 'Retirada pelo cliente',
    helperName: first.responsible_name || '',
    pickupResponsibleName: first.responsible_name || '',
    pickupRegisteredByName: first.registered_by_name || opts.conferenteName || '-',
    pickupWithdrawnAt: first.withdrawn_at || nowIso,
    pickupObservations: first.notes || '',
  }, 'Comprovante de Retirada');
}
