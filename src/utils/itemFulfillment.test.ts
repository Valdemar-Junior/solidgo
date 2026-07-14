import { describe, it, expect } from 'vitest';
import {
  hasDeliverableBalance,
  isFullyReturnedBalance,
  normalizeOrderItemShadowBalance,
  shouldCreateRouteOrderItemSnapshots,
  shouldEnforceRouteOrderItemSnapshots,
  DEFAULT_ITEM_FULFILLMENT_CONTROL,
} from './itemFulfillment';

// Helper: monta um saldo por item minimo pros testes.
const bal = (over: Record<string, any> = {}) => ({
  order_item_id: 'x', order_id: 'o', source_line_key: 'k', sku: 'S', product_name: 'P',
  source_present: true, purchased_quantity: 1, returned_quantity: 0,
  shadow_deliverable_quantity: 1, has_over_return: false,
  delivered_quantity: 0, remaining_deliverable_quantity: 1,
  ...over,
});

describe('hasDeliverableBalance — decide se o item ainda entra na fila de roteirizacao', () => {
  it('mostra na fila quando ainda FALTA entregar (restante > 0)', () => {
    expect(hasDeliverableBalance(bal({ remaining_deliverable_quantity: 1 }))).toBe(true);
  });

  // ESTE e o teste que protege contra o BUG DE ENTREGA DUPLA:
  it('NAO mostra na fila o item ja ENTREGUE (restante 0, mesmo com saldo cheio > 0)', () => {
    expect(hasDeliverableBalance(bal({ shadow_deliverable_quantity: 1, remaining_deliverable_quantity: 0 }))).toBe(false);
  });

  it('NAO mostra item de pedido que nao esta na camada por item (source_present false)', () => {
    expect(hasDeliverableBalance(bal({ source_present: false }))).toBe(false);
  });

  it('cai no saldo cheio quando a coluna restante nao vem (compatibilidade)', () => {
    const semRestante: any = bal();
    delete semRestante.remaining_deliverable_quantity;
    expect(hasDeliverableBalance({ ...semRestante, shadow_deliverable_quantity: 2 })).toBe(true);
    expect(hasDeliverableBalance({ ...semRestante, shadow_deliverable_quantity: 0 })).toBe(false);
  });
});

describe('isFullyReturnedBalance — item totalmente devolvido no ERP', () => {
  it('verdadeiro quando devolvido > 0 e nada entregavel', () => {
    expect(isFullyReturnedBalance(bal({ returned_quantity: 1, shadow_deliverable_quantity: 0 }))).toBe(true);
  });
  it('falso quando ainda ha saldo entregavel', () => {
    expect(isFullyReturnedBalance(bal({ returned_quantity: 1, shadow_deliverable_quantity: 1 }))).toBe(false);
  });
  it('falso quando nao houve devolucao', () => {
    expect(isFullyReturnedBalance(bal({ returned_quantity: 0, shadow_deliverable_quantity: 1 }))).toBe(false);
  });
});

describe('normalizeOrderItemShadowBalance — leitura segura do saldo (com fallback)', () => {
  it('quando NAO vem "restante", usa o saldo cheio (nao quebra dados antigos)', () => {
    const n = normalizeOrderItemShadowBalance({ shadow_deliverable_quantity: 3 });
    expect(n.remaining_deliverable_quantity).toBe(3);
    expect(n.delivered_quantity).toBe(0);
  });
  it('quando vem "restante", usa ele', () => {
    const n = normalizeOrderItemShadowBalance({ shadow_deliverable_quantity: 3, remaining_deliverable_quantity: 1, delivered_quantity: 2 });
    expect(n.remaining_deliverable_quantity).toBe(1);
    expect(n.delivered_quantity).toBe(2);
  });
});

describe('flags de criacao de snapshot por item', () => {
  it('nao cria snapshot quando o modo esta off', () => {
    expect(shouldCreateRouteOrderItemSnapshots({ ...DEFAULT_ITEM_FULFILLMENT_CONTROL, mode: 'off', item_route_allocation_enabled: true })).toBe(false);
  });
  it('cria snapshot quando modo != off e alocacao por item ligada', () => {
    expect(shouldCreateRouteOrderItemSnapshots({ ...DEFAULT_ITEM_FULFILLMENT_CONTROL, mode: 'shadow', item_route_allocation_enabled: true })).toBe(true);
  });
  it('so ENFORCE (propaga erro) quando modo enabled', () => {
    expect(shouldEnforceRouteOrderItemSnapshots({ ...DEFAULT_ITEM_FULFILLMENT_CONTROL, mode: 'shadow', item_route_allocation_enabled: true })).toBe(false);
    expect(shouldEnforceRouteOrderItemSnapshots({ ...DEFAULT_ITEM_FULFILLMENT_CONTROL, mode: 'enabled', item_route_allocation_enabled: true })).toBe(true);
  });
});
