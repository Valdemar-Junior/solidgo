import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

// Credenciais NUNCA no git. Le de tests/e2e/credentials.local.json (gitignored)
// ou de variaveis de ambiente E2E_ADMIN_USER / E2E_ADMIN_PASS / E2E_DRIVER_USER / E2E_DRIVER_PASS.
type Creds = { user: string; pass: string };
type CredFile = { admin?: Partial<Creds>; driver?: Partial<Creds> };

function loadFile(): CredFile {
  // Projeto e ESM ("type":"module"), entao __dirname nao existe aqui.
  // Playwright roda a partir da raiz do projeto -> caminho relativo ao cwd.
  try {
    const p = resolve(process.cwd(), 'tests/e2e/credentials.local.json');
    return JSON.parse(readFileSync(p, 'utf8')) as CredFile;
  } catch {
    return {};
  }
}

const file = loadFile();

export const ADMIN: Creds = {
  user: process.env.E2E_ADMIN_USER || file.admin?.user || 'admin',
  pass: process.env.E2E_ADMIN_PASS || file.admin?.pass || '',
};

export const DRIVER: Creds = {
  user: process.env.E2E_DRIVER_USER || file.driver?.user || 'motorista',
  pass: process.env.E2E_DRIVER_PASS || file.driver?.pass || '',
};

export function requireCreds(c: Creds, label: string) {
  if (!c.pass) {
    throw new Error(
      `Faltou a senha do ${label}. Preencha tests/e2e/credentials.local.json ` +
      `(veja tests/e2e/credentials.example.json) ou defina a variavel de ambiente.`,
    );
  }
}

// Faz login pela tela real (nome + senha) e espera cair no destino do papel.
export async function login(page: Page, creds: Creds, expectedPath: RegExp) {
  await page.goto('/login');
  await page.fill('#name', creds.user);
  await page.fill('#password', creds.pass);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(expectedPath, { timeout: 20_000 });
}

export async function loginAdmin(page: Page) {
  requireCreds(ADMIN, 'admin');
  await login(page, ADMIN, /\/admin/);
}

export async function loginDriver(page: Page) {
  requireCreds(DRIVER, 'motorista');
  await login(page, DRIVER, /\/driver/);
}
