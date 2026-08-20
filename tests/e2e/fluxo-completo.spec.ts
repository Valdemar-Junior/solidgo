import { test, expect } from '@playwright/test';
import { loginAdmin, loginDriver } from './auth';
import { createRouteForOrder, startFirstPendingRoute, deliverPartialAndFinalize } from './flow-helpers';

// FLUXO COMPLETO ponta a ponta pela tela (o "olho" do sistema):
// admin cria rota com um pedido multi-item -> inicia a rota ->
// motorista faz ENTREGA PARCIAL (entrega os itens, retorna 1 com motivo) -> finaliza ->
// confere que a rota terminou e o item retornado foi tratado.
//
// ATENCAO: este teste CRIA rota e entrega REAIS no banco de TESTE (consome 1 pedido
// multi-item por rodada). Nao aponte para producao. Ver docs/robos-de-teste.md.
test('admin cria rota, motorista faz entrega parcial e finaliza', async ({ page }) => {
  // 1) Admin cria a rota com um pedido multi-item e atribui ao motorista.
  await loginAdmin(page);
  const pedido = await createRouteForOrder(page, 'motorista');
  expect(pedido).toBeTruthy();

  // 2) Admin inicia a rota (pending -> in_progress); guarda o codigo do romaneio.
  const routeCode = await startFirstPendingRoute(page);
  expect(routeCode).toMatch(/RE-\d{6}-\d{3}/);

  // 3) Troca para o motorista.
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await loginDriver(page);
  await page.waitForTimeout(1000);

  // 4) Abre EXATAMENTE a rota criada, faz entrega parcial + finaliza.
  await deliverPartialAndFinalize(page, routeCode, 'Próxima rota');

  // 5) A rota aparece como Finalizada.
  await expect(page.getByText(/Finalizada/i).first()).toBeVisible();
});
