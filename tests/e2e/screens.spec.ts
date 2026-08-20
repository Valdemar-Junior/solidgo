import { test, expect, type Page } from '@playwright/test';
import { loginAdmin, loginDriver } from './auth';

// Suite enxuta: garante que as telas do fluxo de entrega/montagem ABREM sem quebrar.
// NAO cria dados nem altera o banco. Pega a classe de bug "a tela quebrou / nao carrega".

// O app tem um "error boundary" que mostra "Ops! Algo deu errado" quando a tela quebra.
async function assertSemTelaQuebrada(page: Page) {
  await expect(page.getByText(/Algo deu errado|Ops!|Application error/i)).toHaveCount(0);
  await expect(page.locator('body')).not.toBeEmpty();
}

test.describe('Telas de admin abrem (fluxo de entrega e montagem)', () => {
  test('criacao de rota carrega com a fila e o botao Criar Rota', async ({ page }) => {
    await loginAdmin(page);
    await page.goto('/admin/routes');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/Gest[aã]o de Entregas/i).first()).toBeVisible();
    await expect(page.getByText(/Pedidos aguardando rota/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Criar Rota \(/i })).toBeVisible();
    await assertSemTelaQuebrada(page);
  });

  test('gestao de montagem carrega', async ({ page }) => {
    await loginAdmin(page);
    await page.goto('/admin/assembly');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await assertSemTelaQuebrada(page);
  });

  test('consulta de pedido carrega', async ({ page }) => {
    await loginAdmin(page);
    await page.goto('/admin/order-lookup');
    await page.waitForLoadState('networkidle');
    await assertSemTelaQuebrada(page);
  });
});

test.describe('Tela do motorista abre', () => {
  test('painel do motorista carrega com "Minhas Rotas"', async ({ page }) => {
    await loginDriver(page);
    await expect(page).toHaveURL(/\/driver/);
    await expect(page.getByText(/Minhas Rotas/i)).toBeVisible();
    await assertSemTelaQuebrada(page);
  });
});
