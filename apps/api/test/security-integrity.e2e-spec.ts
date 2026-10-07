/**
 * Segurança, integridade e concorrência: o que precisa continuar verdadeiro mesmo sob carga ou acesso direto ao banco.
 */
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { Client, TestContext, bringToMedicalQueue, createAttendance, createPatient, createTestApp, drainMedicalQueue } from './helpers';
import { TEST_PASSWORD, randomCpf, uniqueName } from './fixtures';

describe('Segurança e integridade', () => {
  let ctx: TestContext;
  let reception: Client;
  let triage: Client;

  beforeAll(async () => {
    ctx = await createTestApp();
    reception = await Client.login(ctx, 't.recepcao');
    triage = await Client.login(ctx, 't.triagem');
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('concorrência', () => {
    it('20 atendimentos criados em paralelo recebem números ATD e senhas distintos e consecutivos', async () => {
      const patients = await Promise.all(Array.from({ length: 20 }, () => createPatient(reception)));
      const results = await Promise.all(patients.map((p) => reception.post('/api/attendances', { patientId: p.id })));
      expect(results.every((r) => r.status === 201)).toBe(true);
      const seqs = results.map((r) => Number(r.body.code.slice(-6))).sort((a, b) => a - b);
      expect(new Set(seqs).size).toBe(20);
      expect(seqs[19] - seqs[0]).toBe(19); // sem buracos
      expect(new Set(results.map((r) => r.body.ticket)).size).toBe(20);
      // limpeza: cancela
      await Promise.all(results.map((r) => reception.post(`/api/attendances/${r.body.id}/cancel`, { reason: 'limpeza do teste' })));
    });

    it('duas recepções criando atendimento para o mesmo paciente ao mesmo tempo → apenas um é criado', async () => {
      const p = await createPatient(reception);
      const other = await Client.login(ctx, 't.recepcao');
      const [r1, r2] = await Promise.all([reception.post('/api/attendances', { patientId: p.id }), other.post('/api/attendances', { patientId: p.id })]);
      expect([r1.status, r2.status].sort()).toEqual([201, 409]);
      expect(await ctx.prisma.attendance.count({ where: { patientId: p.id } })).toBe(1);
    });

    it('cinco médicos chamando ao mesmo tempo com três pacientes na fila: três chamados distintos, ninguém em dobro', async () => {
      await drainMedicalQueue(ctx);
      for (let i = 0; i < 3; i++) await bringToMedicalQueue(reception, triage, 'URGENTE');
      const doctors = await Promise.all(['t.medico', 't.medico2', 't.medico3'].map((u) => Client.login(ctx, u)));
      const rooms = (await doctors[0].get('/api/rooms?active=true')).body as { id: string; name: string }[];
      // 3 médicos em 3 consultórios + 2 cliques repetidos (mesmo médico, outra aba)
      const calls = await Promise.all([
        doctors[0].post('/api/medical/queue/call-next', { roomId: rooms[0].id }),
        doctors[1].post('/api/medical/queue/call-next', { roomId: rooms[1].id }),
        doctors[2].post('/api/medical/queue/call-next', { roomId: rooms[2].id }),
        doctors[0].post('/api/medical/queue/call-next', { roomId: rooms[0].id }),
        doctors[1].post('/api/medical/queue/call-next', { roomId: rooms[1].id }),
      ]);
      const ok = calls.filter((c) => c.status === 200);
      expect(ok).toHaveLength(3);
      expect(new Set(ok.map((c) => c.body.attendanceId)).size).toBe(3);
      expect(calls.filter((c) => c.status === 409)).toHaveLength(2);
      // invariantes no banco: 1 paciente ativo por médico e por consultório
      const active = await ctx.prisma.queueEntry.findMany({ where: { kind: 'MEDICA', status: { in: ['CALLED', 'IN_SERVICE'] } } });
      expect(new Set(active.map((a) => a.assignedUserId)).size).toBe(active.length);
      expect(new Set(active.map((a) => a.roomId)).size).toBe(active.length);
      await drainMedicalQueue(ctx);
    });

    it('fila médica respeita a prioridade definida pelo profissional (emergência antes de quem chegou antes)', async () => {
      await drainMedicalQueue(ctx);
      const doctor = await Client.login(ctx, 't.medico');
      const room = (await doctor.get('/api/rooms?active=true')).body[0].id;
      const first = await bringToMedicalQueue(reception, triage, 'POUCO_URGENTE');
      const second = await bringToMedicalQueue(reception, triage, 'EMERGENCIA');
      const q = await doctor.get('/api/medical/queue');
      expect(q.body.waiting.map((w: { attendanceId: string }) => w.attendanceId).slice(0, 2)).toEqual([second.att.id, first.att.id]);
      const call = await doctor.post('/api/medical/queue/call-next', { roomId: room });
      expect(call.body.attendanceId).toBe(second.att.id);
      await drainMedicalQueue(ctx);
    });

    it('acessibilidade NÃO altera o nível de risco (sem desempate legal, a ordem é a de chegada)', async () => {
      await drainMedicalQueue(ctx);
      const doctor = await Client.login(ctx, 't.medico');
      const plain = await bringToMedicalQueue(reception, triage, 'URGENTE');
      const pcd = await bringToMedicalQueue(reception, triage, 'URGENTE', { accessibility: { flags: ['PCD'], disabilityType: 'FISICA', needs: [] } });
      const q = await doctor.get('/api/medical/queue');
      const ids = q.body.waiting.map((w: { attendanceId: string }) => w.attendanceId);
      expect(ids.indexOf(plain.att.id)).toBeLessThan(ids.indexOf(pcd.att.id));
      const pcdItem = q.body.waiting.find((w: { attendanceId: string }) => w.attendanceId === pcd.att.id);
      expect(pcdItem.riskLevel).toBe('URGENTE');
      await drainMedicalQueue(ctx);
    });

    it('edição concorrente do cadastro: a segunda gravação com versão antiga é recusada (sem atualização perdida)', async () => {
      const p = await createPatient(reception);
      const full = (await reception.get(`/api/patients/${p.id}`)).body;
      const payload = { fullName: full.fullName, birthDate: full.birthDate, sex: full.sex, expectedVersion: full.version, motherName: 'A' };
      const [u1, u2] = await Promise.all([
        reception.put(`/api/patients/${p.id}`, { ...payload, motherName: 'Primeira Fictícia' }),
        reception.put(`/api/patients/${p.id}`, { ...payload, motherName: 'Segunda Fictícia' }),
      ]);
      expect([u1.status, u2.status].sort()).toEqual([200, 409]);
      expect((u1.status === 409 ? u1 : u2).body.code).toBe('EDIT_CONFLICT');
    });
  });

  describe('rede instável', () => {
    it('reenvio da mesma gravação (mesma Idempotency-Key) devolve a resposta original e não duplica o registro', async () => {
      const att = await createAttendance(reception, (await createPatient(reception)).id);
      expect((await triage.post(`/api/triage/${att.id}/start`, {})).status).toBe(200);
      const url = `/api/triage/${att.id}/vitals`;
      const key = { 'Idempotency-Key': 'afericao-perdida-1' };

      // a resposta "se perde" e o navegador reenvia: o servidor devolve a mesma resposta, sem gravar de novo
      const first = await triage.post(url, { heartRate: 88 }, key);
      expect(first.status).toBe(201);
      const again = await triage.post(url, { heartRate: 88 }, key);
      expect(again.status).toBe(201);
      expect(again.headers['idempotent-replay']).toBe('true');
      expect(again.body).toEqual(first.body);

      // dois envios simultâneos com a mesma chave: um grava, o outro espera e recebe o mesmo resultado
      const key2 = { 'Idempotency-Key': 'afericao-simultanea-2' };
      const [a, b] = await Promise.all([triage.post(url, { respiratoryRate: 18 }, key2), triage.post(url, { respiratoryRate: 18 }, key2)]);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body).toEqual(b.body);
      expect(await ctx.prisma.triageVital.count({ where: { attendanceId: att.id } })).toBe(2);

      // a mesma chave com outro conteúdo é recusada (seria um erro do cliente)
      const reused = await triage.post(url, { heartRate: 120 }, key);
      expect(reused.status).toBe(422);
      expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      // sem chave, cada envio grava (comportamento normal)
      expect((await triage.post(url, { heartRate: 90 })).status).toBe(201);
      expect(await ctx.prisma.triageVital.count({ where: { attendanceId: att.id } })).toBe(3);

      // a chave é por usuário: outra profissional usando a mesma chave não recebe a resposta de ninguém
      const other = await Client.login(ctx, 't.triagem2');
      const att2 = await createAttendance(reception, (await createPatient(reception)).id);
      expect((await other.post(`/api/triage/${att2.id}/start`, {})).status).toBe(200);
      const own = await other.post(`/api/triage/${att2.id}/vitals`, { heartRate: 88 }, key);
      expect(own.status).toBe(201);
      expect(own.headers['idempotent-replay']).toBeUndefined();
      expect(await ctx.prisma.triageVital.count({ where: { attendanceId: att2.id } })).toBe(1);
    });

    it('gravação que falhou não é lembrada: o reenvio com a mesma chave executa de novo', async () => {
      const att = await createAttendance(reception, (await createPatient(reception)).id);
      expect((await triage.post(`/api/triage/${att.id}/start`, {})).status).toBe(200);
      const key = { 'Idempotency-Key': 'classificacao-falhou-3' };
      // finalizar sem classificação falha (regra de negócio) e nada é gravado
      const fail = await triage.post(`/api/triage/${att.id}/finish`, {}, key);
      expect(fail.status).toBe(422);
      expect(fail.body.code).toBe('CLASSIFICATION_REQUIRED');
      const failAgain = await triage.post(`/api/triage/${att.id}/finish`, {}, key);
      expect(failAgain.status).toBe(422);
      expect(failAgain.headers['idempotent-replay']).toBeUndefined();
      await triage.post(`/api/triage/${att.id}/release`, { reason: 'fim do teste' });
    });
  });

  describe('imutabilidade garantida pelo banco (mesmo fora da aplicação)', () => {
    it('linha do tempo, histórico de status e auditoria não podem ser alterados nem apagados', async () => {
      const p = await createPatient(reception);
      const a = await createAttendance(reception, p.id);
      await expect(ctx.prisma.$executeRawUnsafe(`UPDATE "attendance_events" SET "type" = 'ATENDIMENTO_FINALIZADO' WHERE "attendance_id" = '${a.id}'`)).rejects.toThrow(/imutável/);
      await expect(ctx.prisma.$executeRawUnsafe(`DELETE FROM "attendance_status_history" WHERE "attendance_id" = '${a.id}'`)).rejects.toThrow(/imutável/);
      await expect(ctx.prisma.$executeRawUnsafe(`DELETE FROM "audit_logs"`)).rejects.toThrow(/imutável/);
      await expect(ctx.prisma.$executeRawUnsafe(`TRUNCATE "access_logs"`)).rejects.toThrow(/imutável/);
    });

    it('atendimentos e pacientes não podem ser apagados; identificação do atendimento é imutável', async () => {
      const p = await createPatient(reception);
      const a = await createAttendance(reception, p.id);
      await expect(ctx.prisma.$executeRawUnsafe(`DELETE FROM "attendances" WHERE "id" = '${a.id}'`)).rejects.toThrow(/não podem ser apagados/);
      await expect(ctx.prisma.$executeRawUnsafe(`DELETE FROM "patients" WHERE "id" = '${p.id}'`)).rejects.toThrow(/não podem ser apagados/);
      await expect(ctx.prisma.$executeRawUnsafe(`UPDATE "attendances" SET "code" = 'ATD-2026-999999' WHERE "id" = '${a.id}'`)).rejects.toThrow(/imutáveis/);
    });

    it('o banco recusa pular etapas da máquina de estados e enviar ao médico sem classificação', async () => {
      const p = await createPatient(reception);
      const a = await createAttendance(reception, p.id);
      // AGUARDANDO_TRIAGEM → ATENDIMENTO_FINALIZADO: transição inválida
      await expect(ctx.prisma.$executeRawUnsafe(`UPDATE "attendances" SET "status" = 'ATENDIMENTO_FINALIZADO', "finished_at" = now() WHERE "id" = '${a.id}'`)).rejects.toThrow(/Transição de status inválida/);
      // EM_TRIAGEM → AGUARDANDO_MEDICO sem classificação de risco: CHECK
      await ctx.prisma.$executeRawUnsafe(`UPDATE "attendances" SET "status" = 'EM_TRIAGEM' WHERE "id" = '${a.id}'`);
      await expect(ctx.prisma.$executeRawUnsafe(`UPDATE "attendances" SET "status" = 'AGUARDANDO_MEDICO' WHERE "id" = '${a.id}'`)).rejects.toThrow(/ck_attendances_classified_before_medical/);
    });

    it('alteração de conteúdo clínico sem arquivar a versão anterior é recusada pelo banco', async () => {
      const p = await createPatient(reception);
      const a = await createAttendance(reception, p.id);
      await triage.post(`/api/triage/${a.id}/start`, {});
      await expect(ctx.prisma.$executeRawUnsafe(`UPDATE "triage" SET "chief_complaint" = 'adulterado', "version" = "version" + 1 WHERE "attendance_id" = '${a.id}'`)).rejects.toThrow(/versão anterior arquivada/);
      await triage.post(`/api/triage/${a.id}/release`, { reason: 'fim do teste' });
    });
  });

  describe('autenticação e sessão', () => {
    it('bloqueia o usuário após 5 senhas erradas, com a mesma mensagem genérica', async () => {
      const anon = new Client(ctx);
      for (let i = 0; i < 5; i++) {
        const r = await anon.post('/api/auth/login', { username: 't.bloqueio', password: 'errada-123456' });
        expect(r.status).toBe(401);
      }
      const r = await anon.post('/api/auth/login', { username: 't.bloqueio', password: TEST_PASSWORD });
      expect(r.status).toBe(401); // senha certa, mas conta bloqueada temporariamente
      const unknown = await anon.post('/api/auth/login', { username: 'nao.existe', password: 'qualquer' });
      expect(unknown.body.message).toBe(r.body.message); // não revela se o usuário existe
      const logs = await ctx.prisma.accessLog.count({ where: { usernameAttempted: 't.bloqueio', event: 'LOGIN_BLOCKED' } });
      expect(logs).toBeGreaterThanOrEqual(1);
    });

    it('sessão expira por inatividade', async () => {
      const c = await Client.login(ctx, 't.recepcao');
      expect((await c.get('/api/auth/me')).status).toBe(200);
      await ctx.prisma.session.updateMany({ where: { revokedAt: null, user: { username: 't.recepcao' } }, data: { lastActivityAt: new Date(Date.now() - 3 * 3_600_000) } });
      const r = await c.get('/api/auth/me');
      expect(r.status).toBe(401);
      expect(r.body.code).toBe('SESSION_IDLE');
      reception = await Client.login(ctx, 't.recepcao');
    });

    it('logout revoga a sessão no servidor (o cookie antigo deixa de valer)', async () => {
      const c = await Client.login(ctx, 't.triagem2');
      const old = c.cookie;
      expect((await c.post('/api/auth/logout')).status).toBe(204);
      const r = await request(ctx.app.getHttpServer()).get('/api/auth/me').set('Cookie', old);
      expect(r.status).toBe(401);
    });

    it('usuário criado pelo admin precisa trocar a senha temporária antes de usar o sistema', async () => {
      const admin = await Client.login(ctx, 't.admin');
      const username = `novo.${Date.now().toString(36)}`;
      const created = await admin.post('/api/admin/users', { username, fullName: 'Novo Usuário Teste', roleCodes: ['RECEPCAO'], temporaryPassword: 'Temporaria2026x' });
      expect(created.status).toBe(201);
      expect(created.body).not.toHaveProperty('passwordHash');
      const u = await Client.login(ctx, username, 'Temporaria2026x');
      const blocked = await u.get('/api/patients/search?q=silva');
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
      const weak = await u.post('/api/auth/change-password', { currentPassword: 'Temporaria2026x', newPassword: 'curta' });
      expect(weak.status).toBe(422);
      const changed = await u.post('/api/auth/change-password', { currentPassword: 'Temporaria2026x', newPassword: 'NovaSenhaForte2026' });
      expect(changed.status).toBe(204);
      expect((await u.get('/api/patients/search?q=silva')).status).toBe(200);
    });

    it('CSRF: requisição que altera estado sem o cabeçalho do cliente, ou de origem estranha, é bloqueada', async () => {
      const server = ctx.app.getHttpServer();
      const noHeader = await request(server).post('/api/attendances').set('Cookie', reception.cookie).send({ patientId: '00000000-0000-0000-0000-000000000000' });
      expect(noHeader.status).toBe(403);
      expect(noHeader.body.code).toBe('CSRF_BLOCKED');
      const evil = await request(server).post('/api/attendances').set('Cookie', reception.cookie).set('X-Requested-With', 'hospital-web').set('Origin', 'https://site-malicioso.example').send({});
      expect(evil.status).toBe(403);
    });

    it('erros nunca expõem detalhes técnicos', async () => {
      const r = await reception.get('/api/patients/nao-e-um-uuid');
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).not.toMatch(/Prisma|SELECT|stack|Validation failed \(uuid/i);
      const r2 = await reception.post('/api/attendances', { patientId: '00000000-0000-4000-8000-000000000000' });
      expect(r2.status).toBe(404);
      expect(r2.body.message).toBe('Paciente não encontrado.');
    });
  });

  describe('tempo real', () => {
    const connect = (url: string, path: string, cookie?: string, ns = ''): Promise<Socket> =>
      new Promise((resolve, reject) => {
        const s = io(`${url}${ns}`, { path, transports: ['websocket'], extraHeaders: cookie ? { Cookie: cookie } : {}, reconnection: false, forceNew: true });
        const timer = setTimeout(() => reject(new Error('timeout')), 5000);
        s.on('connect', () => {
          clearTimeout(timer);
          resolve(s);
        });
        s.on('connect_error', (e) => {
          clearTimeout(timer);
          reject(e);
        });
      });

    it('triagem recebe automaticamente o aviso de nova entrada; o painel público só recebe senha/atendimento/consultório', async () => {
      const triageSocket = await connect(ctx.url, '/socket.io', triage.cookie);
      const panelSocket = await connect(ctx.url, '/socket.io', undefined, '/painel');
      const queueEvent = new Promise<unknown>((resolve) => triageSocket.on('queue.changed', resolve));
      const p = await createPatient(reception);
      await createAttendance(reception, p.id);
      expect(await queueEvent).toEqual({ kind: 'TRIAGEM' });

      await drainMedicalQueue(ctx);
      const doctor = await Client.login(ctx, 't.medico');
      const room = (await doctor.get('/api/rooms?active=true')).body[0].id;
      const { att } = await bringToMedicalQueue(reception, triage, 'URGENTE');
      const panelEvent = new Promise<Record<string, unknown>>((resolve) => panelSocket.on('panel.call', resolve));
      await doctor.post('/api/medical/queue/call-next', { roomId: room });
      const ev = await panelEvent;
      expect(Object.keys(ev).sort()).toEqual(['calledAt', 'code', 'recall', 'room', 'ticket']);
      expect(ev.code).toBe(att.code);
      triageSocket.close();
      panelSocket.close();
      await drainMedicalQueue(ctx);
    });

    it('socket sem sessão válida é desconectado (não recebe eventos internos)', async () => {
      const s = io(ctx.url, { path: '/socket.io', transports: ['websocket'], reconnection: false, forceNew: true });
      const disconnected = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 3000);
        s.on('disconnect', () => {
          clearTimeout(timer);
          resolve(true);
        });
      });
      expect(disconnected).toBe(true);
      s.close();
    });
  });

  it('quem pode editar cadastro mas não pode ver documentos não consegue apagá-los (campos chegam mascarados/vazios)', async () => {
    const admin = await Client.login(ctx, 't.admin');
    const roles = (await admin.get('/api/admin/roles')).body.roles as { code: string; permissions: string[] }[];
    const original = roles.find((r) => r.code === 'RECEPCAO')!.permissions;
    const cpf = randomCpf();
    const p = await createPatient(reception, { cpf });
    try {
      // remove temporariamente a permissão de ver documentos do perfil Recepção
      const res = await admin.put('/api/admin/roles/RECEPCAO/permissions', { permissions: original.filter((x) => x !== 'patients:view-documents') });
      expect(res.status).toBe(200);
      const limited = await Client.login(ctx, 't.recepcao');
      const view = (await limited.get(`/api/patients/${p.id}`)).body;
      expect(view.documentsMasked).toBe(true);
      expect(view.cpf).toBe(`***.***.***-${cpf.slice(9)}`);
      const upd = await limited.put(`/api/patients/${p.id}`, { fullName: view.fullName, birthDate: view.birthDate, sex: view.sex, cpf: '', expectedVersion: view.version, motherName: 'Atualizada Fictícia' });
      expect(upd.status).toBe(200);
      const row = await ctx.prisma.patient.findUniqueOrThrow({ where: { id: p.id } });
      expect(row.cpf).toBe(cpf); // preservado
      expect(row.motherName).toBe('Atualizada Fictícia');
    } finally {
      await admin.put('/api/admin/roles/RECEPCAO/permissions', { permissions: original });
      reception = await Client.login(ctx, 't.recepcao');
    }
  });

  it('o perfil Administrador não pode perder a gestão de usuários/perfis (evita trancar todos fora)', async () => {
    const admin = await Client.login(ctx, 't.admin');
    const r = await admin.put('/api/admin/roles/ADMINISTRADOR/permissions', { permissions: ['audit:read'] });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('ADMIN_LOCKOUT');
  });

  it('cadastro de nome sem sobrenome e documentos inválidos retorna erros por campo em português', async () => {
    const r = await reception.post('/api/patients', { fullName: uniqueName().split(' ')[0], cpf: '123.456.789-00', cns: '123', birthDate: '2999-12-31' });
    expect(r.status).toBe(422);
    expect(r.body.fieldErrors).toMatchObject({ fullName: 'Informe nome e sobrenome.', cpf: 'CPF inválido.', cns: 'CNS inválido.', sex: 'Informe o sexo.' });
  });
});
