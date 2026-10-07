import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Rede instável (Wi‑Fi oscilando, cabo solto, servidor reiniciando). O servidor fica no hospital, então "sem internet"
 * não afeta nada; o que este teste prova é o comportamento quando a REDE LOCAL falha por alguns instantes:
 *  1) resposta perdida depois de o servidor gravar → o navegador reenvia sozinho e nada é duplicado;
 *  2) servidor fora → faixa de aviso, o formulário continua na tela e, mesmo recarregando, o texto volta (rascunho);
 *  3) TV desconectada → a chamada feita nesse intervalo é anunciada quando ela reconecta.
 * Usa os usuários do seed de desenvolvimento (dados fictícios).
 */
const PASS = process.env.E2E_PASSWORD ?? 'Desenvolvimento2026';
const H = { 'X-Requested-With': 'hospital-web', 'Content-Type': 'application/json' };

async function open(browser: Browser, user?: string, init?: () => void): Promise<Page> {
  const ctx = await browser.newContext();
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  if (user) {
    await page.goto('/login');
    await page.getByLabel('Usuário').fill(user);
    await page.getByLabel('Senha', { exact: true }).fill(PASS);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  }
  return page;
}

/** Cria paciente + atendimento fictícios pela API da recepção e devolve o id do atendimento. */
async function newAttendance(rec: Page, label: string): Promise<{ id: string; ticket: string }> {
  const name = `E2E Rede ${label} ${Date.now().toString(36)}`;
  const p = await rec.request.post('/api/patients', { headers: H, data: { fullName: name, birthDate: '1979-05-04', sex: 'FEMININO' } });
  expect(p.status(), await p.text()).toBe(201);
  const a = await rec.request.post('/api/attendances', { headers: H, data: { patientId: (await p.json()).id, reason: 'Teste de rede instável' } });
  expect(a.status(), await a.text()).toBe(201);
  const body = await a.json();
  return { id: body.id, ticket: body.ticket };
}

test('resposta perdida depois de gravar: o navegador reenvia sozinho e o registro não é duplicado', async ({ browser }) => {
  const rec = await open(browser, 'recepcao');
  const tri = await open(browser, 'triagem');
  const { id } = await newAttendance(rec, 'Resposta');
  expect((await tri.request.post(`/api/triage/${id}/start`, { headers: H, data: {} })).status()).toBe(200);
  await tri.goto(`/triagem/${id}`);
  await tri.getByLabel('Queixa principal').waitFor();

  // a 1ª tentativa chega ao servidor (que grava), mas a resposta se perde no caminho
  let attempts = 0;
  await tri.route('**/api/triage/*/vitals', async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fetch();
      await route.abort('connectionreset');
    } else await route.continue();
  });
  await tri.getByLabel('Freq. cardíaca').fill('77');
  await tri.getByRole('button', { name: /^Salvar/ }).click();
  await expect(tri.getByText('Triagem salva')).toBeVisible({ timeout: 15_000 });
  expect(attempts).toBe(2);

  const view = await (await tri.request.get(`/api/triage/${id}`)).json();
  expect(view.vitals).toHaveLength(1);
  expect(view.vitals[0].heartRate).toBe(77);
  await tri.request.post(`/api/triage/${id}/release`, { headers: H, data: { reason: 'fim do teste e2e' } });
});

test('servidor fora do ar: aviso claro, formulário continua e o texto volta mesmo depois de recarregar', async ({ browser }) => {
  const rec = await open(browser, 'recepcao');
  const tri = await open(browser, 'triagem');
  const { id } = await newAttendance(rec, 'Queda');
  expect((await tri.request.post(`/api/triage/${id}/start`, { headers: H, data: {} })).status()).toBe(200);
  await tri.goto(`/triagem/${id}`);
  const symptoms = tri.getByLabel('Sintomas', { exact: true });
  await symptoms.waitFor();
  const typed = 'Dor lombar irradiando para a perna esquerda há 2 dias (texto digitado durante a queda)';
  await symptoms.fill(typed);

  // a rede local cai: nada chega ao servidor (API e tempo real)
  let networkUp = false;
  const block = (route: { abort: (e: string) => Promise<void> }) => route.abort('internetdisconnected');
  await tri.route('**/api/**', block);
  await tri.route('**/socket.io/**', block);
  await tri.routeWebSocket('**/socket.io/**', (ws) => (networkUp ? ws.connectToServer() : ws.close()));

  await tri.getByRole('button', { name: /^Salvar/ }).click();
  await expect(tri.getByText(/Sem conexão com o servidor desde/)).toBeVisible({ timeout: 15_000 });
  await expect(symptoms).toHaveValue(typed); // nada sumiu da tela

  // trocar de tela sem conexão é impedido (levaria à página de erro do navegador)
  await tri.getByRole('link', { name: 'Triagem', exact: true }).click();
  await expect(tri).toHaveURL(new RegExp(`/triagem/${id}$`));

  // mesmo recarregando no meio da queda, o texto não se perde
  tri.on('dialog', (d) => void d.accept()); // "sair do site? alterações não salvas" do navegador
  await tri.reload();
  await expect(tri.getByText('Não foi possível conectar ao servidor.')).toBeVisible();

  // a rede volta: a tela se recupera sozinha e devolve o rascunho
  networkUp = true;
  await tri.unroute('**/api/**');
  await tri.unroute('**/socket.io/**');
  await expect(tri.getByText('Recuperamos o que tinha sido digitado e não foi salvo')).toBeVisible({ timeout: 20_000 });
  await expect(tri.getByLabel('Sintomas', { exact: true })).toHaveValue(typed);

  await tri.getByRole('button', { name: /^Salvar/ }).click();
  await expect(tri.getByText('Triagem salva')).toBeVisible();
  const view = await (await tri.request.get(`/api/triage/${id}`)).json();
  expect(view.triage.symptoms).toBe(typed);
  await tri.request.post(`/api/triage/${id}/release`, { headers: H, data: { reason: 'fim do teste e2e' } });
});

test('TV desconectada: a chamada feita durante a queda é anunciada quando ela reconecta', async ({ browser }) => {
  const rec = await open(browser, 'recepcao');
  const tri = await open(browser, 'triagem');
  const doc = await open(browser, 'medico2');
  // TV com som ligado. Simula o navegador de uma TV de verdade: depois de abrir/reiniciar, áudio e voz ficam
  // bloqueados até alguém tocar na tela. A voz é registrada em vez de falada (o teste não tem caixa de som).
  const panel = await open(browser, undefined, () => {
    localStorage.setItem('hosp.panelSound', '1');
    const w = window as unknown as { __falas: string[] };
    w.__falas = [];
    let activated = false;
    window.addEventListener('pointerdown', () => (activated = true), true);
    window.addEventListener('keydown', () => (activated = true), true);
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      override get state(): AudioContextState {
        return activated ? super.state : 'suspended';
      }
      override resume(): Promise<void> {
        return activated ? super.resume() : Promise.resolve();
      }
    };
    window.speechSynthesis.speak = (u: SpeechSynthesisUtterance) => {
      setTimeout(() => {
        if (!activated) return u.onerror?.({ error: 'not-allowed' } as SpeechSynthesisErrorEvent);
        w.__falas.push(u.text);
        u.onend?.(new Event('end') as SpeechSynthesisEvent);
      }, 10);
    };
  });
  const falas = () => panel.evaluate(() => (window as unknown as { __falas: string[] }).__falas);

  // médico livre (execuções anteriores podem ter deixado alguém chamado)
  const mine = (await (await doc.request.get('/api/medical/queue')).json()).mine;
  if (mine?.queueStatus === 'CALLED') await doc.request.post(`/api/medical/attendances/${mine.attendanceId}/release`, { headers: H, data: { reason: 'limpeza do teste e2e' } });
  else if (mine) await doc.request.post(`/api/medical/attendances/${mine.attendanceId}/finish`, { headers: H, data: { outcome: 'OUTRO', finalNotes: 'Encerrado pelo teste e2e.' } });

  // TV abre já sem tempo real (Wi‑Fi instável)
  let tvNetworkUp = false;
  await panel.route('**/socket.io/**', (r) => (tvNetworkUp ? r.continue() : r.abort('internetdisconnected')));
  await panel.routeWebSocket('**/socket.io/**', (ws) => (tvNetworkUp ? ws.connectToServer() : ws.close()));
  await panel.goto('/painel-chamada');
  // depois de abrir/reiniciar, o navegador só libera som com um toque: o painel pede
  const unlock = panel.getByRole('button', { name: 'Toque aqui para ligar o som e a voz das chamadas' });
  await expect(unlock).toBeVisible();
  await unlock.click();
  await expect(unlock).toBeHidden();
  await expect.poll(falas).toContain('Som ativado.');

  // enquanto a TV está desconectada, o médico chama um paciente
  const { id, ticket } = await newAttendance(rec, 'Painel');
  for (const [path, data] of [
    [`/api/triage/${id}/start`, {}],
    [`/api/triage/${id}/classify`, { level: 'POUCO_URGENTE' }],
    [`/api/triage/${id}/finish`, {}],
  ] as const) {
    const r = await tri.request.post(path, { headers: H, data });
    expect(r.status(), await r.text()).toBe(200);
  }
  const rooms = (await (await doc.request.get('/api/rooms?active=true')).json()) as { id: string; name: string; occupiedBy: string | null }[];
  const room = rooms.find((r) => !r.occupiedBy) ?? rooms[0];
  const call = await doc.request.post(`/api/medical/attendances/${id}/call`, { headers: H, data: { roomId: room.id } });
  expect(call.status(), await call.text()).toBe(200);
  await panel.waitForTimeout(1_500);
  expect((await falas()).some((t) => t.includes(room.name))).toBe(false); // ainda desconectada: nada anunciado

  // a rede volta: a TV reconecta e anuncia a chamada perdida (senha + consultório), uma única vez
  tvNetworkUp = true;
  await expect(panel.getByText(room.name).first()).toBeVisible({ timeout: 20_000 });
  const expected = `Senha ${ticket.split('').join(' ')}. ${room.name}.`;
  await expect.poll(falas, { timeout: 20_000 }).toContain(expected);
  await panel.waitForTimeout(2_000);
  expect((await falas()).filter((t) => t === expected)).toHaveLength(1);

  await doc.request.post(`/api/medical/attendances/${id}/release`, { headers: H, data: { reason: 'fim do teste e2e' } });
  await doc.request.post(`/api/attendances/${id}/cancel`, { headers: H, data: { reason: 'Fim do teste e2e' } });
});
