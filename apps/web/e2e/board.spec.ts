import { expect, test } from '@playwright/test';
import { login, run, shot, USERS } from './helpers';

test.describe('quadro Kanban', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, USERS.gestorTi);
  });

  test('menu leva direto ao quadro da T.I', async ({ page }) => {
    await shot(page, '01-inicio');
    await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'T.I' }).click();
    await expect(page).toHaveURL(/\/projetos\/TI$/);
    await expect(page.getByRole('heading', { name: 'Atividades de TI' })).toBeVisible();
    for (const col of ['A fazer', 'Em andamento', 'Em revisão', 'Concluído']) {
      await expect(page.getByRole('region', { name: col })).toBeVisible();
    }
    await shot(page, '02-quadro');
  });

  test('criação rápida na coluna e painel lateral', async ({ page }) => {
    await page.goto('/projetos/TI');
    const title = `E2E criação ${run}`;
    await page.getByRole('button', { name: 'Nova tarefa em A fazer' }).click();
    await page.getByLabel('Título da nova tarefa em A fazer').fill(title);
    await page.keyboard.press('Enter');
    const card = page.getByRole('button', { name: new RegExp(title) });
    await expect(card).toBeVisible();
    await card.click();
    const panel = page.getByRole('dialog', { name: 'Detalhes da tarefa' });
    await expect(panel.getByLabel('Título')).toHaveValue(title);
    await shot(page, '03-painel-tarefa');
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });

  test('edição rápida no cartão muda a prioridade', async ({ page }) => {
    await page.goto('/projetos/TI');
    const title = `E2E rápida ${run}`;
    await page.getByRole('button', { name: 'Nova tarefa em A fazer' }).click();
    await page.getByLabel('Título da nova tarefa em A fazer').fill(title);
    await page.keyboard.press('Enter');
    const card = page.getByRole('listitem').filter({ has: page.getByRole('button', { name: new RegExp(title) }) });
    await card.hover();
    await card.getByRole('button', { name: /Edição rápida/ }).click();
    const quick = page.getByRole('dialog', { name: /Edição rápida/ });
    await quick.getByLabel('Prioridade').selectOption('urgent');
    await shot(page, '04-edicao-rapida');
    await expect(page.getByRole('button', { name: new RegExp(title) }).getByText('Urgente', { exact: true })).toBeVisible();
  });

  test('atalho "c" abre nova tarefa e "?" mostra os atalhos', async ({ page }) => {
    await page.goto('/projetos/TI');
    await expect(page.getByRole('region', { name: 'A fazer' })).toBeVisible();
    await page.keyboard.press('c');
    await expect(page.getByRole('dialog', { name: 'Nova tarefa' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Atalhos de teclado' })).toBeVisible();
  });

  test('backlog: cria no backlog e envia ao quadro em massa', async ({ page }) => {
    await page.goto('/projetos/TI');
    await page.getByRole('button', { name: 'Backlog' }).click();
    const title = `E2E backlog ${run}`;
    await page.getByLabel('Nova tarefa no backlog').fill(title);
    await page.keyboard.press('Enter');
    const row = page.getByRole('row').filter({ hasText: title });
    await expect(row).toBeVisible();
    await row.getByRole('checkbox').check();
    await shot(page, '05-backlog');
    await page.getByRole('toolbar', { name: 'Ações em massa' }).getByLabel('Mover para a coluna').selectOption({ label: 'A fazer' });
    await expect(row).toBeHidden();
    await page.getByRole('button', { name: 'Quadro', exact: true }).click();
    await expect(page.getByRole('button', { name: new RegExp(title) })).toBeVisible();
  });

  test('raias por prioridade', async ({ page }) => {
    await page.goto('/projetos/TI');
    await page.getByLabel('Raias').selectOption('priority');
    await expect(page.getByRole('region', { name: /Raia (Urgente|Alta|Média|Baixa)/ }).first()).toBeVisible();
    await shot(page, '06-raias');
    await page.getByLabel('Raias').selectOption('none');
  });

  test('menção digitando @ mostra a lista de pessoas', async ({ page }) => {
    await page.goto('/projetos/TI');
    await page.getByRole('button', { name: /TI-1:/ }).click();
    const editor = page.getByRole('textbox', { name: 'Novo comentário' });
    await editor.click();
    await page.keyboard.type('Oi @Car');
    const option = page.locator('.mention-popup').getByRole('option', { name: /Carla Técnica/ });
    await expect(option).toBeVisible();
    await shot(page, '07-mencao');
    await page.keyboard.press('Enter');
    await expect(editor.locator('.mention')).toHaveText('@Carla Técnica');
  });

  test('configurar: épicos, modelos, recorrentes e automações', async ({ page }) => {
    await page.goto('/projetos/TI');
    await page.getByRole('button', { name: 'Configurar' }).click();
    const dlg = page.getByRole('dialog', { name: /Configurar/ });
    await dlg.getByRole('tab', { name: 'Épicos' }).click();
    await dlg.getByLabel('Novo épico').fill(`Migração ${run}`);
    await dlg.getByRole('button', { name: 'Adicionar' }).click();
    await expect(dlg.getByText(`Migração ${run}`, { exact: true })).toBeVisible();
    await dlg.getByRole('tab', { name: 'Automações' }).click();
    await shot(page, '08-automacoes');
    await dlg.getByRole('tab', { name: 'Recorrentes' }).click();
    await shot(page, '09-recorrentes');
  });
});
