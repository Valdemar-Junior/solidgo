import { type Page, expect } from '@playwright/test';

// Pedidos multi-item (2+ itens entregaveis) usados pra testar entrega parcial.
// "Municao": o teste tenta um por um e usa o 1o que ainda estiver na fila.
// Quando esvaziar, gere outra lista (ver docs/robos-de-teste.md).
export const MULTI_ITEM_CANDIDATES = [
  '140354', '140169', '139825', '139862', '64817', '64596', '140157', '64980',
  '140260', '139856', '140034', '139915', '64957', '64597', '140036', '140042',
  '140401', '140394', '139808', '64641', '64845', '64683', '139892', '64692',
  '64892', '140099', '64945', '140077', '140356', '140102', '139988', '64815',
  '64733', '139819', '64669', '64545', '140151', '140063', '64974', '139928',
];

// Seleciona um <select> do modal pela presenca de uma opcao unica (selects sem id).
function selectByOption(page: Page, optionText: RegExp | string) {
  return page.locator('select').filter({ has: page.locator('option', { hasText: optionText }) }).first();
}

// Abre a fila e deixa todos os pedidos visiveis.
async function abrirFila(page: Page) {
  await page.goto('/admin/routes');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);
  const carrier = page.locator('#fcarriertagged');
  if (await carrier.isChecked().catch(() => false)) { await carrier.uncheck(); await page.waitForTimeout(600); }
  const tudo = page.getByRole('button', { name: 'Tudo', exact: true });
  if (await tudo.count()) { await tudo.first().click(); await page.waitForTimeout(800); }
}

// Busca na fila o 1o pedido candidato que ainda existe. Retorna o numero achado.
async function acharPedidoDisponivel(page: Page): Promise<string> {
  const search = page.getByPlaceholder(/Pedido, cliente ou CPF/i);
  for (const num of MULTI_ITEM_CANDIDATES) {
    await search.fill(num);
    await page.waitForTimeout(900);
    const rows = page.locator('table tbody tr');
    // Precisa de 2+ linhas = 2+ itens entregaveis (a tabela e 1 linha por item).
    // (Alguns candidatos podem ter sido parcialmente consumidos em rodadas anteriores.)
    const aguardando = await rows.first().getByText(/Aguardando libera/i).count().catch(() => 0);
    if (await rows.count() >= 2 && aguardando === 0 && await rows.first().isVisible().catch(() => false)) {
      return num;
    }
  }
  throw new Error('Nenhum pedido multi-item da lista esta disponivel na fila. Gere nova lista.');
}

// Cria uma rota com o pedido informado, atribuida ao motorista. Retorna o numero do pedido.
export async function createRouteForOrder(page: Page, driverLabel = 'motorista'): Promise<string> {
  await abrirFila(page);
  const numero = await acharPedidoDisponivel(page);

  // Com a busca filtrando so esse pedido, clicar na 1a celula da 1a linha
  // seleciona o pedido inteiro (a selecao e por pedido, nao por item).
  await page.locator('table tbody tr').first().locator('td').first().click();
  await page.waitForTimeout(500);

  const criar = page.getByRole('button', { name: /Criar Rota \([1-9]/i });
  await expect(criar).toBeVisible();
  await criar.click();
  await page.waitForTimeout(1500);

  await selectByOption(page, 'ROTA TESTE').selectOption({ label: 'ROTA TESTE' });
  await selectByOption(page, 'Admin').selectOption({ label: driverLabel }); // dropdown Motorista (tem 'Admin')
  await selectByOption(page, /Veiculo -/).selectOption({ index: 1 });
  await selectByOption(page, 'conferente').selectOption({ label: 'conferente' });
  await page.waitForTimeout(300);

  const confirmar = page.getByRole('button', { name: /Confirmar Rota/i });
  await expect(confirmar).toBeEnabled();
  await confirmar.click();
  await expect(page.getByText(/Rota criada com sucesso/i)).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);

  return numero;
}

// Inicia (pending -> in_progress) a 1a rota PENDENTE ("Em Separação") e retorna o
// codigo dela (RE-DDMMYY-NNN), pra o motorista abrir exatamente essa rota depois.
export async function startFirstPendingRoute(page: Page): Promise<string> {
  await page.goto('/admin/routes');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /Ir para rotas/i }).click();
  await page.waitForTimeout(1200);

  // Card pendente = tem botao "Detalhes" e o badge "Em Separação".
  const card = page.locator('div', {
    has: page.getByRole('button', { name: 'Detalhes' }),
    hasText: 'Em Separação',
  }).last();
  await expect(card).toBeVisible({ timeout: 10000 });

  const code = (await card.getByText(/RE-\d{6}-\d{3}/).first().innerText()).trim();

  await card.getByRole('button', { name: /Detalhes/i }).click();
  await page.waitForTimeout(1200);
  const iniciar = page.getByRole('button', { name: /Iniciar Rota/i });
  await expect(iniciar.first()).toBeVisible();
  await iniciar.first().click();
  await page.waitForTimeout(1800);

  return code;
}

// No painel do motorista, abre a rota, marca o 1o item pra RETORNAR (entrega parcial:
// entrega os demais, retorna 1), escolhe motivo, confirma e finaliza a rota.
// Retorna quantos itens foram marcados pra retorno.
export async function deliverPartialAndFinalize(page: Page, routeCode: string, motivo = 'Próxima rota'): Promise<number> {
  // A finalizacao usa window.confirm() nativo; o Playwright descarta por padrao.
  // Aceitamos automaticamente (equivale a clicar "OK").
  page.on('dialog', (d) => { void d.accept().catch(() => {}); });

  // Abre EXATAMENTE a rota criada (pelo codigo do romaneio), ignorando rotas antigas.
  const card = page.getByText(routeCode).locator('xpath=ancestor::div[contains(@class,"shadow")][1]');
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.getByRole('button', { name: /Ver Rota/i }).click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  const retornarItem = page.getByRole('button', { name: /^Retornar$/ });
  const total = await retornarItem.count();
  if (total < 2) {
    throw new Error(`Pedido com ${total} item(ns); precisa de 2+ pra entrega parcial.`);
  }

  // Marca o 1o item pra retorno (os outros ficam como entrega).
  await retornarItem.first().click();
  await page.waitForTimeout(600);

  // Escolhe o motivo do retorno.
  const motivoSel = page.locator('select').filter({ has: page.locator('option', { hasText: /Selecione um motivo/i }) }).first();
  await motivoSel.selectOption({ label: motivo });
  await page.waitForTimeout(300);

  // Confirma a entrega (botao virou "Confirmar entrega" ao marcar um retorno).
  await page.getByRole('button', { name: /Confirmar entrega/i }).first().click();
  // O pedido passa a contar como tratado (entregue) apos a confirmacao parcial.
  await expect(page.getByRole('button', { name: /Entregues \(1\)/ })).toBeVisible({ timeout: 12000 });

  // Finaliza a rota (habilita quando todos os pedidos foram tratados).
  // O window.confirm nativo e aceito pelo handler acima.
  const finalizar = page.getByRole('button', { name: /Finalizar Rota/i });
  await expect(finalizar).toBeVisible({ timeout: 10000 });
  await finalizar.click();

  // Sinal de sucesso: a rota fica "Finalizada".
  await expect(page.getByText(/Rota finalizada com sucesso|Rota Finalizada/i).first()).toBeVisible({ timeout: 15000 });
  return 1;
}
