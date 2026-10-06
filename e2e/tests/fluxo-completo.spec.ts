import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Fluxo completo do requisito (16 passos), com 4 pessoas ao mesmo tempo — recepção, triagem, médico e a TV do
 * painel — para provar que as filas se atualizam sozinhas (tempo real) e que o painel público não expõe dados.
 * Usa os usuários do seed de desenvolvimento (dados fictícios).
 */
const PASS = process.env.E2E_PASSWORD ?? 'Desenvolvimento2026';
const H = { 'X-Requested-With': 'hospital-web', 'Content-Type': 'application/json' };

async function open(browser: Browser, user?: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  if (user) {
    await page.goto('/login');
    await page.getByLabel('Usuário').fill(user);
    await page.getByLabel('Senha', { exact: true }).fill(PASS);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  }
  return page;
}

/** Deixa o médico de teste livre e remove artefatos de execuções anteriores deste teste. */
async function cleanup(doc: Page): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const q = await (await doc.request.get('/api/medical/queue')).json();
    if (q.mine) {
      const id = q.mine.attendanceId;
      if (q.mine.queueStatus === 'CALLED') await doc.request.post(`/api/medical/attendances/${id}/release`, { headers: H, data: { reason: 'limpeza do teste e2e' } });
      else await doc.request.post(`/api/medical/attendances/${id}/finish`, { headers: H, data: { outcome: 'OUTRO', finalNotes: 'Encerrado pelo teste e2e (dados fictícios).' } });
      continue;
    }
    for (const w of q.waiting.filter((x: { patient: { fullName: string } }) => x.patient.fullName.startsWith('E2E Paciente'))) {
      await doc.request.post(`/api/attendances/${w.attendanceId}/cancel`, { headers: H, data: { reason: 'Limpeza do teste e2e' } });
    }
    break;
  }
}

test('fluxo completo: recepção → triagem → médico → finalização, com tempo real e privacidade', async ({ browser }) => {
  const name = `E2E Paciente Fictícia ${Date.now().toString(36)}`;
  const panel = await open(browser);
  await panel.goto('/painel-chamada');
  const rec = await open(browser, 'recepcao');
  const tri = await open(browser, 'triagem');
  const doc = await open(browser, 'medico');
  await cleanup(doc);
  await doc.reload();

  let ticket = '';
  let code = '';

  await test.step('1-4. recepção busca, cadastra e cria o atendimento', async () => {
    await rec.getByLabel('Buscar paciente').fill(name);
    await expect(rec.getByText('Nenhum paciente encontrado')).toBeVisible();
    await rec.getByRole('button', { name: 'Cadastrar novo paciente' }).click();
    await rec.getByLabel('Nome completo').fill(name);
    await rec.getByLabel('Data de nascimento').fill('03031985');
    await rec.getByLabel('Sexo').selectOption('FEMININO');
    await rec.getByLabel('Gestante', { exact: true }).check();
    await rec.getByRole('button', { name: 'Salvar e iniciar atendimento' }).click();
    await rec.getByLabel('Motivo da procura').fill('Dor abdominal e febre');
    await rec.getByRole('button', { name: 'Criar atendimento' }).click();
    await expect(rec.getByRole('heading', { name: 'Atendimento criado e enviado para a triagem' })).toBeVisible();
    ticket = (await rec.locator('.print-ticket p.font-mono').first().innerText()).trim();
    code = (await rec.locator('.print-ticket p.font-mono').nth(1).innerText()).trim();
    expect(code).toMatch(/^ATD-\d{4}-\d{6}$/);
  });

  await test.step('5-9. aparece na triagem sozinho; sinais vitais; classificação; finaliza', async () => {
    const row = tri.locator('li', { hasText: name });
    await expect(row).toBeVisible(); // sem recarregar a página
    await row.getByRole('button', { name: /Iniciar triagem/ }).click();
    await expect(tri.getByLabel('Queixa principal')).toHaveValue('Dor abdominal e febre');
    await tri.getByLabel('Pressão sistólica').fill('150');
    await tri.getByLabel('Pressão diastólica').fill('95');
    await tri.getByLabel('Saturação O₂').fill('94');
    await tri.getByLabel('Temperatura').fill('38,4');
    await tri.getByLabel('Alergias conhecidas').fill('Dipirona');
    await tri.getByRole('radio', { name: /Muito urgente/ }).check({ force: true });
    await tri.getByRole('button', { name: /Finalizar triagem/ }).click();
    await tri.waitForURL('**/triagem');
  });

  await test.step('10-11. entra na fila médica sozinho; médico chama; painel mostra só senha/atendimento/consultório', async () => {
    await expect(doc.locator('li', { hasText: name })).toBeVisible();
    await doc.getByLabel('Estou atendendo no').selectOption({ index: 1 });
    await doc.getByRole('button', { name: /Chamar próximo/ }).click();
    await doc.waitForURL('**/medico/atendimento/**');
    await expect(panel.getByText(code)).toBeVisible();
    const text = (await panel.locator('main').innerText()).toLowerCase();
    expect(text).toContain(ticket);
    expect(text).not.toContain(name.toLowerCase());
    expect(text).not.toMatch(/dor|urgente|gestante|dipirona/);
  });

  await test.step('12-15. médico vê recepção + triagem, registra atendimento e medicação, finaliza', async () => {
    await doc.getByRole('button', { name: 'Paciente chegou — iniciar' }).click();
    const main = doc.locator('main');
    for (const t of ['Dipirona', '150/95', '38,4', 'Gestante']) await expect(main).toContainText(t);
    await doc.getByLabel('História / evolução').fill('Dor há 24 h.');
    await doc.getByLabel('Conduta', { exact: true }).fill('Analgesia e reavaliação.');
    await doc.getByLabel(/^Medicamento/).fill('Medicamento exemplo');
    await doc.getByLabel(/^Dose/).fill('1 comprimido');
    await doc.getByLabel(/^Via/).fill('Oral');
    await doc.getByLabel(/^Frequência/).fill('Dose única');
    await doc.getByLabel(/^Duração/).fill('1 dia');
    await doc.locator('fieldset', { hasText: 'Adicionar medicação' }).getByRole('button', { name: 'Adicionar' }).click();
    await expect(doc.locator('table', { hasText: 'Medicamento exemplo' })).toBeVisible();
    await doc.getByRole('radio', { name: 'Medicado' }).check({ force: true });
    await doc.getByRole('button', { name: /Finalizar atendimento/ }).click();
    await expect(doc.getByText('Atendimento finalizado', { exact: true }).first()).toBeVisible();
  });

  await test.step('16. linha do tempo completa; recepção sem detalhe clínico e sem acesso ao consultório', async () => {
    await rec.goto('/recepcao');
    await rec.getByRole('link', { name }).first().click();
    const tl = rec.locator('ol').last();
    for (const t of ['Entrada', 'Triagem iniciada', 'Triagem finalizada', 'Paciente chamado', 'Atendimento médico iniciado', 'Medicação/conduta registrada', 'Atendimento finalizado']) {
      await expect(tl).toContainText(t);
    }
    expect((await tl.innerText()).toLowerCase()).not.toMatch(/urgente|medicamento exemplo/);
    const id = doc.url().split('/').pop();
    expect((await rec.request.get(`/api/medical/attendances/${id}`)).status()).toBe(403);
  });
});
