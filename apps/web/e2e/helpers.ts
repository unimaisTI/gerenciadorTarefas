import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'Unimais2026';

export const USERS = {
  admin: 'admin@unimais.edu.br',
  gestorTi: 'gestor.ti@unimais.edu.br',
  colabTi: 'colaborador.ti@unimais.edu.br',
  colabCtrl: 'colaborador.controladoria@unimais.edu.br',
  observador: 'observador@unimais.edu.br',
} as const;

export async function login(page: Page, email: string) {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/entrar/);
  await expect(page.getByRole('button', { name: 'Menu do usuário' })).toBeVisible();
}

export async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e/screens/${name}.png`, fullPage: true });
}

/** Sufixo único para não colidir com execuções anteriores no mesmo banco. */
export const run = Date.now().toString(36).slice(-5);
