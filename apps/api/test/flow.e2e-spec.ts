/**
 * Fluxo crítico de ponta a ponta (seção 40 do requisito): os 13 testes, na ordem do atendimento real.
 * Banco PostgreSQL real (hospital_test), app Nest completo (guards, filtros, triggers do banco).
 */
import { RISK_LEVELS, localDateString } from '@hospital/shared';
import { Client, TestContext, createTestApp, drainMedicalQueue } from './helpers';
import { randomCpf, uniqueName } from './fixtures';

describe('Fluxo inicial do atendimento (recepção → triagem → médico → finalização)', () => {
  let ctx: TestContext;
  let reception: Client;
  let triage: Client;
  let doctor: Client;
  let roomId: string;

  // estado compartilhado pelos passos
  let patientId: string;
  let attendanceId: string;
  let attendanceCode: string;
  const cpf = randomCpf();
  const fullName = uniqueName('João Fluxo');

  beforeAll(async () => {
    ctx = await createTestApp();
    reception = await Client.login(ctx, 't.recepcao');
    triage = await Client.login(ctx, 't.triagem');
    doctor = await Client.login(ctx, 't.medico');
    await drainMedicalQueue(ctx);
    const rooms = await doctor.get('/api/rooms?active=true');
    roomId = rooms.body.find((r: { name: string }) => r.name === 'Consultório A').id;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('TESTE 1 — recepção cria paciente (e a busca o encontra sem duplicar)', async () => {
    const res = await reception.post('/api/patients', {
      fullName,
      cpf: `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`,
      birthDate: '1974-04-12',
      sex: 'MASCULINO',
      motherName: 'Maria Fictícia',
      phones: [{ type: 'CELULAR', number: '94991234567' }],
      address: { street: 'Rua de Teste', number: '10', neighborhood: 'Centro', city: 'Ulianópolis', state: 'PA' },
      accessibility: { flags: ['PCD'], disabilityType: 'FISICA', needs: ['CADEIRA_DE_RODAS'] },
    });
    expect(res.status).toBe(201);
    expect(res.body.cpf).toBe(cpf); // recepção tem permissão para ver o documento completo
    expect(res.body.recordNumber).toMatch(/^\d{6}$/);
    expect(res.body.accessibility.effectiveFlags).toEqual(['PCD']);
    patientId = res.body.id;

    // busca por CPF (com máscara) encontra; resultado mostra CPF MASCARADO
    const byCpf = await reception.get(`/api/patients/search?q=${encodeURIComponent(res.body.cpf)}`);
    expect(byCpf.status).toBe(200);
    expect(byCpf.body).toHaveLength(1);
    expect(byCpf.body[0].cpfMasked).toBe(`***.***.***-${cpf.slice(9)}`);
    expect(byCpf.body[0]).not.toHaveProperty('cpf');

    // busca por nome sem acento/caixa
    const byName = await reception.get(`/api/patients/search?name=${encodeURIComponent(fullName.toLowerCase().replace('ã', 'a'))}`);
    expect(byName.body.map((p: { id: string }) => p.id)).toContain(patientId);

    // não duplica: mesmo CPF → 409 com referência ao existente
    const dup = await reception.post('/api/patients', { fullName: uniqueName(), cpf, birthDate: '1980-01-01', sex: 'MASCULINO' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DUPLICATE_DOCUMENT');
    expect(dup.body.details.patientId).toBe(patientId);

    // mesmo nome + nascimento sem documento → alerta de possível duplicidade
    const likely = await reception.post('/api/patients', { fullName, birthDate: '1974-04-12', sex: 'MASCULINO' });
    expect(likely.status).toBe(409);
    expect(likely.body.code).toBe('POSSIBLE_DUPLICATE');
  });

  it('TESTE 2 — recepção cria atendimento com identificador único ATD-AAAA-NNNNNN', async () => {
    const res = await reception.post('/api/attendances', { patientId, reason: 'Dor no peito', deviceLabel: 'RECEPCAO-PC01' });
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^ATD-\d{4}-\d{6}$/);
    expect(res.body.status).toBe('AGUARDANDO_TRIAGEM');
    expect(res.body.ticket).toMatch(/^\d{3,}$/);
    attendanceId = res.body.id;
    attendanceCode = res.body.code;

    // não é possível abrir um segundo atendimento enquanto este estiver em andamento
    const again = await reception.post('/api/attendances', { patientId, reason: 'Outro' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ACTIVE_ATTENDANCE_EXISTS');

    // registro automático de usuário, setor e dispositivo
    const row = await ctx.prisma.attendance.findUniqueOrThrow({ where: { id: attendanceId } });
    expect(row.createdSectorCode).toBe('RECEPCAO');
    expect(row.deviceLabel).toBe('RECEPCAO-PC01');
    expect(row.clientIp).toBeTruthy();
  });

  it('TESTE 3 — atendimento aparece na fila de triagem (com acessibilidade, sem cor antes da classificação)', async () => {
    const res = await triage.get('/api/triage/queue');
    expect(res.status).toBe(200);
    const item = res.body.waiting.find((i: { attendanceId: string }) => i.attendanceId === attendanceId);
    expect(item).toBeDefined();
    expect(item.code).toBe(attendanceCode);
    expect(item.patient.fullName).toBe(fullName);
    expect(item.patient.ageYears).toBeGreaterThanOrEqual(52);
    expect(item.accessibility.badges.map((b: { code: string }) => b.code)).toContain('PCD');
    expect(item.riskLevel).toBeNull();
  });

  it('TESTE 4 — triagem inicia e registra sinais vitais (campos opcionais, vírgula decimal)', async () => {
    const start = await triage.post(`/api/triage/${attendanceId}/start`, {});
    expect(start.status).toBe(200);
    expect(start.body.attendance.status).toBe('EM_TRIAGEM');
    expect(start.body.suggestedChiefComplaint).toBe('Dor no peito');

    const save = await triage.put(`/api/triage/${attendanceId}`, {
      chiefComplaint: 'Dor no peito',
      symptoms: 'Dor em aperto irradiando para braço esquerdo',
      symptomOnset: 'Há 2 horas',
      allergies: 'Dipirona',
      expectedVersion: start.body.triage.version,
    });
    expect(save.status).toBe(200);
    expect(save.body.triage.version).toBe(start.body.triage.version + 1);

    const vitals = await triage.post(`/api/triage/${attendanceId}/vitals`, {
      systolic: 150, diastolic: 95, heartRate: 102, spo2: 94, temperatureC: '36,8', painScale: 8,
    });
    expect(vitals.status).toBe(201);
    expect(vitals.body.vitals[0]).toMatchObject({ bloodPressure: '150/95', heartRate: 102, spo2: 94, temperatureC: 36.8, painScale: 8 });

    // valor implausível é recusado com mensagem amigável
    const bad = await triage.post(`/api/triage/${attendanceId}/vitals`, { spo2: 140 });
    expect(bad.status).toBe(422);
    expect(bad.body.fieldErrors.spo2).toMatch(/máximo/);
  });

  it('TESTE 5 — triagem classifica o risco (decisão humana registrada) e finaliza', async () => {
    const noClass = await triage.post(`/api/triage/${attendanceId}/finish`, {});
    expect(noClass.status).toBe(422);
    expect(noClass.body.code).toBe('CLASSIFICATION_REQUIRED');

    const cls = await triage.post(`/api/triage/${attendanceId}/classify`, { level: 'URGENTE', observation: 'Dor torácica com PA elevada' });
    expect(cls.status).toBe(200);
    expect(cls.body.currentRiskLevel).toBe('URGENTE');
    expect(cls.body.classifications[0]).toMatchObject({ level: 'URGENTE', classifiedBy: 'Triagem Teste' });
    expect(cls.body.classifications[0].protocol).toBeTruthy();

    const fin = await triage.post(`/api/triage/${attendanceId}/finish`, {});
    expect(fin.status).toBe(200);
    expect(fin.body.status).toBe('AGUARDANDO_MEDICO');

    const history = await ctx.prisma.attendanceStatusHistory.findMany({ where: { attendanceId }, orderBy: { createdAt: 'asc' } });
    expect(history.map((h) => h.toStatus)).toEqual(['AGUARDANDO_TRIAGEM', 'EM_TRIAGEM', 'AGUARDANDO_MEDICO']);
  });

  it('TESTE 6 — paciente aparece na fila médica com prioridade e tempo de espera', async () => {
    const res = await doctor.get('/api/medical/queue');
    expect(res.status).toBe(200);
    const item = res.body.waiting.find((i: { attendanceId: string }) => i.attendanceId === attendanceId);
    expect(item).toMatchObject({ code: attendanceCode, riskLevel: 'URGENTE', chiefComplaint: 'Dor no peito' });
    expect(typeof item.waitingMinutes).toBe('number');
    expect(item.maxWaitMinutes).toBe(60);
  });

  it('TESTE 7 — médico chama o paciente; o painel público recebe só senha/atendimento/consultório', async () => {
    const res = await doctor.post('/api/medical/queue/call-next', { roomId });
    expect(res.status).toBe(200);
    expect(res.body.attendanceId).toBe(attendanceId);
    expect(res.body.room).toBe('Consultório A');

    const panel = await new Client(ctx).get('/api/public/panel');
    expect(panel.status).toBe(200);
    const call = panel.body.calls[0];
    expect(call).toEqual({ ticket: expect.any(String), code: attendanceCode, room: 'Consultório A', calledAt: expect.any(String), recall: false });
    // nenhum dado pessoal ou clínico no painel público
    const text = JSON.stringify(panel.body);
    expect(text).not.toContain(fullName);
    expect(text).not.toContain(cpf);
    expect(text).not.toMatch(/URGENTE|Dor|PCD/);
  });

  it('TESTE 8 — médico visualiza os dados da recepção + triagem sem redigitar, e inicia o atendimento', async () => {
    const res = await doctor.get(`/api/medical/attendances/${attendanceId}`);
    expect(res.status).toBe(200);
    expect(res.body.patient.fullName).toBe(fullName);
    expect(res.body.patient.cpf).toBe(`***.***.***-${cpf.slice(9)}`); // médico vê documento mascarado
    expect(res.body.accessibility.badges.map((b: { code: string }) => b.code)).toContain('PCD');
    expect(res.body.triage).toMatchObject({ chiefComplaint: 'Dor no peito', allergies: 'Dipirona' });
    expect(res.body.latestVitals).toMatchObject({ bloodPressure: '150/95', heartRate: 102, spo2: 94, temperatureC: 36.8, painScale: 8 });
    expect(res.body.risk).toMatchObject({ level: 'URGENTE', classifiedBy: 'Triagem Teste' });
    expect(res.body.permissions.canStart).toBe(true);

    const start = await doctor.post(`/api/medical/attendances/${attendanceId}/start`, {});
    expect(start.status).toBe(200);
    expect(start.body.attendance.status).toBe('EM_ATENDIMENTO');
    expect(start.body.consultation.chiefComplaint).toBe('Dor no peito'); // pré-preenchido da triagem

    // leitura de dado clínico fica auditada
    const audit = await ctx.prisma.auditLog.findFirst({ where: { attendanceId, action: 'CLINICAL_RECORD_VIEWED' } });
    expect(audit?.username).toBe('t.medico');
  });

  it('TESTE 9 — médico registra avaliação, diagnóstico e medicação (status MEDICACAO_REGISTRADA)', async () => {
    const before = await doctor.get(`/api/medical/attendances/${attendanceId}`);
    const save = await doctor.put(`/api/medical/attendances/${attendanceId}/consultation`, {
      chiefComplaint: 'Dor no peito',
      history: 'Dor retroesternal há 2h, sem dispneia.',
      examination: 'BEG, corado, ACV RCR 2T BNF.',
      expectedVersion: before.body.consultation.version,
    });
    expect(save.status).toBe(200);
    expect(save.body.attendance.status).toBe('EM_ATENDIMENTO');

    // edição concorrente com versão desatualizada → conflito (sem atualização perdida)
    const stale = await doctor.put(`/api/medical/attendances/${attendanceId}/consultation`, { history: 'x', expectedVersion: before.body.consultation.version });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('EDIT_CONFLICT');

    const dx = await doctor.post(`/api/medical/attendances/${attendanceId}/diagnoses`, { code: 'r07.4', description: 'Dor torácica não especificada', isPrimary: true });
    expect(dx.status).toBe(201);
    expect(dx.body.diagnoses[0]).toMatchObject({ code: 'R07.4', isPrimary: true });

    const med = await doctor.post(`/api/medical/attendances/${attendanceId}/prescription/items`, {
      medication: 'Medicamento Exemplo', dose: '1 comprimido', route: 'Oral', frequency: 'Dose única', duration: '1 dia', notes: 'Observar 30 min',
    });
    expect(med.status).toBe(201);
    expect(med.body.attendance.status).toBe('MEDICACAO_REGISTRADA');
    expect(med.body.prescriptionItems).toHaveLength(1);
    expect(med.body.prescriptionItems[0]).toMatchObject({ medication: 'Medicamento Exemplo', route: 'Oral', canceled: false });

    // versão anterior da consulta foi arquivada (VERSÃO ANTERIOR → CORREÇÃO → NOVO REGISTRO)
    const versions = await ctx.prisma.clinicalRecordVersion.count({ where: { attendanceId, recordType: 'CONSULTA' } });
    expect(versions).toBeGreaterThanOrEqual(1);
  });

  it('TESTE 10 — médico finaliza o atendimento com desfecho', async () => {
    const after = await doctor.get(`/api/medical/attendances/${attendanceId}`);
    await doctor.put(`/api/medical/attendances/${attendanceId}/consultation`, {
      chiefComplaint: 'Dor no peito', history: after.body.consultation.history, examination: after.body.consultation.examination,
      conduct: 'Medicado e orientado. Retorno se piora.', expectedVersion: after.body.consultation.version,
    });
    const res = await doctor.post(`/api/medical/attendances/${attendanceId}/finish`, { outcome: 'MEDICADO', finalNotes: 'Paciente estável.' });
    expect(res.status).toBe(200);
    expect(res.body.attendance.status).toBe('ATENDIMENTO_FINALIZADO');
    expect(res.body.consultation).toMatchObject({ status: 'FINISHED', outcome: 'MEDICADO', doctor: { name: 'Médica Teste' } });
    expect(res.body.attendance.finishedAt).toBeTruthy();

    // depois de finalizado, alterar sem justificativa é recusado
    const noReason = await doctor.put(`/api/medical/attendances/${attendanceId}/consultation`, { conduct: 'mudou', expectedVersion: res.body.consultation.version });
    expect(noReason.status).toBe(422);
    // correção com motivo gera nova versão e nota de correção
    const fix = await doctor.put(`/api/medical/attendances/${attendanceId}/consultation`, {
      chiefComplaint: 'Dor no peito', history: res.body.consultation.history, examination: res.body.consultation.examination,
      conduct: 'Medicado e orientado. Retorno em 48h ou se piora.', expectedVersion: res.body.consultation.version,
      correctionReason: 'Inclusão do prazo de retorno',
    });
    expect(fix.status).toBe(200);
    expect(fix.body.notes.some((n: { type: string }) => n.type === 'CORRECAO')).toBe(true);
    // o paciente pode receber um novo atendimento agora
    const newOne = await reception.post('/api/attendances', { patientId, reason: 'Retorno' });
    expect(newOne.status).toBe(201);
    await reception.post(`/api/attendances/${newOne.body.id}/cancel`, { reason: 'Teste: cancelado pela recepção' });
  });

  it('TESTE 11 — a linha do tempo registra todas as etapas, em ordem', async () => {
    const res = await doctor.get(`/api/attendances/${attendanceId}/timeline`);
    expect(res.status).toBe(200);
    const types = res.body.map((e: { type: string }) => e.type);
    const expected = ['ENTRADA', 'TRIAGEM_INICIADA', 'TRIAGEM_FINALIZADA', 'CHAMADO', 'ATENDIMENTO_INICIADO', 'MEDICACAO_REGISTRADA', 'ATENDIMENTO_FINALIZADO'];
    // as etapas aparecem nesta ordem (outros eventos — diagnóstico, correção — podem estar entre elas)
    let cursor = -1;
    for (const t of expected) {
      const idx = types.indexOf(t, cursor + 1);
      expect(idx).toBeGreaterThan(cursor);
      cursor = idx;
    }
    const triageEnd = res.body.find((e: { type: string }) => e.type === 'TRIAGEM_FINALIZADA');
    expect(triageEnd.summary).toBe('Classificação: Urgente');
    expect(triageEnd.actor.name).toBe('Triagem Teste');
    expect(types).toContain('REGISTRO_CORRIGIDO');

    // status nunca sobrescrito: histórico completo de transições
    const history = await ctx.prisma.attendanceStatusHistory.findMany({ where: { attendanceId }, orderBy: { createdAt: 'asc' } });
    expect(history.map((h) => h.toStatus)).toEqual([
      'AGUARDANDO_TRIAGEM', 'EM_TRIAGEM', 'AGUARDANDO_MEDICO', 'EM_ATENDIMENTO', 'MEDICACAO_REGISTRADA', 'ATENDIMENTO_FINALIZADO',
    ]);
  });

  it('TESTE 12 — usuário sem permissão não acessa dados restritos', async () => {
    // recepção: sem acesso a triagem/consulta
    const r1 = await reception.get(`/api/triage/${attendanceId}`);
    expect(r1.status).toBe(403);
    expect(r1.body).toEqual({ code: 'FORBIDDEN', message: 'Você não tem permissão para realizar esta ação.', requestId: expect.any(String) });
    expect((await reception.get(`/api/medical/attendances/${attendanceId}`)).status).toBe(403);
    expect((await reception.get(`/api/medical/attendances/${attendanceId}/history`)).status).toBe(403);
    // recepção vê a linha do tempo GERAL, sem eventos/detalhes clínicos
    const tl = await reception.get(`/api/attendances/${attendanceId}/timeline`);
    expect(tl.status).toBe(200);
    expect(tl.body.every((e: { category: string; detail: unknown }) => e.category === 'GENERAL' && e.detail === null)).toBe(true);
    expect(JSON.stringify(tl.body)).not.toMatch(/Urgente|R07|Dor torácica/);
    // e a lista de atendimentos não expõe a classificação de risco
    const list = await reception.get('/api/attendances');
    const mine = list.body.items.find((i: { id: string }) => i.id === attendanceId);
    expect(mine.riskLevel).toBeNull();

    // administrador: gestão sim, dado clínico não (menor privilégio)
    const admin = await Client.login(ctx, 't.admin');
    expect((await admin.get(`/api/medical/attendances/${attendanceId}`)).status).toBe(403);
    expect((await admin.get(`/api/triage/${attendanceId}`)).status).toBe(403);
    expect((await admin.get('/api/patients/search?q=joao')).status).toBe(403);
    expect((await admin.get('/api/admin/audit-logs')).status).toBe(200);
    // relatório agregado: risco da mais grave à menos grave (não classificado por último) e setores pelo nome
    const today = localDateString(new Date(), 'America/Belem');
    const rep = await admin.get(`/api/reports/overview?from=${today}&to=${today}`);
    expect(rep.status).toBe(200);
    const ranks = rep.body.byRisk.map((r: { level: (typeof RISK_LEVELS)[number] | null }) => (r.level === null ? RISK_LEVELS.length : RISK_LEVELS.indexOf(r.level)));
    expect(ranks.length).toBeGreaterThan(1);
    expect(ranks).toEqual([...ranks].sort((a: number, b: number) => a - b));
    const sectors = rep.body.eventsBySector as { code: string; sector: string }[];
    const triageSector = await ctx.prisma.sector.findUniqueOrThrow({ where: { code: 'TRIAGEM' } });
    expect(sectors.find((x) => x.code === 'TRIAGEM')?.sector).toBe(triageSector.name);

    // triagem: não prescreve, não chama paciente
    expect((await triage.post(`/api/medical/attendances/${attendanceId}/prescription/items`, { medication: 'x', dose: '1', route: 'oral', frequency: '1x', duration: '1d' })).status).toBe(403);
    expect((await triage.post('/api/medical/queue/call-next', { roomId })).status).toBe(403);
    // triagem não reabre triagem já encerrada (sem permissão de consulta)
    expect((await triage.get(`/api/triage/${attendanceId}`)).status).toBe(403);

    // anônimo
    const anon = new Client(ctx);
    expect((await anon.get(`/api/attendances/${attendanceId}`)).status).toBe(401);
    expect((await anon.get('/api/patients/search?q=joao')).status).toBe(401);

    // tentativas negadas ficam na auditoria
    const denied = await ctx.prisma.auditLog.count({ where: { action: 'ACCESS_DENIED', username: 't.recepcao' } });
    expect(denied).toBeGreaterThan(0);
  });

  it('TESTE 13 — dois usuários não conseguem assumir o mesmo paciente simultaneamente', async () => {
    const triage2 = await Client.login(ctx, 't.triagem2');
    const doctor2 = await Client.login(ctx, 't.medico2');
    const roomB = (await doctor2.get('/api/rooms?active=true')).body.find((r: { name: string }) => r.name === 'Consultório B').id;

    // (a) triagem: dois profissionais clicam "INICIAR TRIAGEM" no mesmo instante
    const p = await reception.post('/api/patients', { fullName: uniqueName('Maria Concorrência'), birthDate: '1990-02-02', sex: 'FEMININO' });
    const a = await reception.post('/api/attendances', { patientId: p.body.id, reason: 'Febre' });
    const [s1, s2] = await Promise.all([triage.post(`/api/triage/${a.body.id}/start`, {}), triage2.post(`/api/triage/${a.body.id}/start`, {})]);
    expect([s1.status, s2.status].sort()).toEqual([200, 409]);
    const loser = s1.status === 409 ? s1 : s2;
    expect(loser.body.code).toBe('ALREADY_TAKEN');
    expect(loser.body.message).toMatch(/já está em triagem com/);

    // (b) fila médica com UM paciente: dois médicos clicam "CHAMAR PRÓXIMO" juntos
    const winnerTriage = s1.status === 200 ? triage : triage2;
    await winnerTriage.post(`/api/triage/${a.body.id}/classify`, { level: 'POUCO_URGENTE' });
    await winnerTriage.post(`/api/triage/${a.body.id}/finish`, {});
    const [c1, c2] = await Promise.all([doctor.post('/api/medical/queue/call-next', { roomId }), doctor2.post('/api/medical/queue/call-next', { roomId: roomB })]);
    expect([c1.status, c2.status].sort()).toEqual([200, 409]);
    const calledBy = c1.status === 200 ? doctor : doctor2;
    expect((c1.status === 409 ? c1 : c2).body.code).toBe('QUEUE_EMPTY');

    // (c) o mesmo paciente chamado especificamente por outro médico → recusado
    const other = calledBy === doctor ? doctor2 : doctor;
    const otherRoom = calledBy === doctor ? roomB : roomId;
    const steal = await other.post(`/api/medical/attendances/${a.body.id}/call`, { roomId: otherRoom });
    expect(steal.status).toBe(409);
    expect(steal.body.code).toBe('ALREADY_TAKEN');

    // (d) um médico não chama outro paciente enquanto está com um
    const busy = await calledBy.post('/api/medical/queue/call-next', { roomId: calledBy === doctor ? roomId : roomB });
    expect(busy.status).toBe(409);
    expect(busy.body.code).toBe('DOCTOR_BUSY');

    // o banco confirma: exatamente uma chamada registrada para este paciente
    expect(await ctx.prisma.queueCall.count({ where: { attendanceId: a.body.id } })).toBe(1);
    await calledBy.post(`/api/medical/attendances/${a.body.id}/release`, { reason: 'fim do teste' });
  });
});
