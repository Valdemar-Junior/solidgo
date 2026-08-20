import { test, expect } from '@playwright/test';
import { loginAdmin, loginDriver } from './auth';

// Fumaca: garante que os dois papeis conseguem entrar e ver o painel.
// Se isto falhar, ou a senha esta errada, ou o app/login quebrou.
test.describe('Login (fumaca)', () => {
  test('admin entra e chega no painel', async ({ page }) => {
    await loginAdmin(page);
    await expect(page).toHaveURL(/\/admin/);
    // O painel admin tem navegacao/algum conteudo carregado.
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('motorista entra e chega na area de entregas', async ({ page }) => {
    await loginDriver(page);
    await expect(page).toHaveURL(/\/driver/);
    await expect(page.locator('body')).not.toBeEmpty();
  });
});
