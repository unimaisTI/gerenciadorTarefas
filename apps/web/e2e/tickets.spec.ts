import { expect, test } from '@playwright/test';
import { login, run, shot, USERS } from './helpers';

test('chamado: Controladoria abre, T.I vê no quadro de chamados', async ({ page }) => {
  const title = `E2E chamado ${run}`;
  await login(page, USERS.colabCtrl);
  await page.getByRole('link', { name: 'Abrir chamado' }).click();
  await page.getByLabel('Departamento de destino').selectOption({ label: 'T.I (TI)' });
  await page.getByLabel('Título').fill(title);
  await shot(page, '10-abrir-chamado');
  await page.getByRole('button', { name: 'Abrir chamado' }).click();
  await expect(page.getByText(/Chamado CH-\d+/).first()).toBeVisible();
  await shot(page, '11-chamado-aberto');

  await page.getByRole('button', { name: 'Menu do usuário' }).click();
  await page.getByRole('button', { name: 'Sair' }).click();

  await login(page, USERS.gestorTi);
  await page.goto('/projetos/TI-CH');
  await expect(page.getByRole('region', { name: 'Novos' }).getByRole('button', { name: new RegExp(title) })).toBeVisible();
  await shot(page, '12-chamados-recebidos');
});

test('painéis: aba Fluxo e modo apresentação', async ({ page }) => {
  await login(page, USERS.admin);
  await page.goto('/dashboards');
  await page.getByRole('tab', { name: 'Fluxo' }).click();
  await expect(page.getByText('Lead time médio')).toBeVisible();
  await shot(page, '13-fluxo');
  await page.getByRole('tab', { name: 'Geral' }).click();
  await expect(page.getByText('Chamados abertos').first()).toBeVisible();
  await shot(page, '14-dashboards');
});

test('calendário geral', async ({ page }) => {
  await login(page, USERS.gestorTi);
  await page.getByRole('link', { name: 'Calendário' }).click();
  await expect(page.getByRole('heading', { name: 'Calendário geral' })).toBeVisible();
  await shot(page, '15-calendario');
});
