import { expect, test } from '@playwright/test';
import { login, shot, USERS } from './helpers';

test('celular: menu recolhido, quadro com rolagem horizontal e login', async ({ page }) => {
  await page.goto('/entrar');
  await shot(page, 'm1-login');
  await login(page, USERS.gestorTi);
  await shot(page, 'm2-inicio');
  await page.getByRole('button', { name: 'Abrir menu' }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'T.I' }).click();
  await expect(page.getByRole('region', { name: 'A fazer' })).toBeVisible();
  await shot(page, 'm3-quadro');
  // Nada pode vazar para os lados além do quadro (que rola por dentro).
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
