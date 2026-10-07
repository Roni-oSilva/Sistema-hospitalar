import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { TEST_PASSWORD, uniqueName } from './fixtures';

export interface TestContext {
  app: NestExpressApplication;
  prisma: PrismaService;
  url: string;
}

export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app);
  await app.listen(0); // porta aleatória: necessária para os testes de WebSocket
  const address = app.getHttpServer().address() as { port: number };
  return { app, prisma: app.get(PrismaService), url: `http://127.0.0.1:${address.port}` };
}

/** Cliente HTTP autenticado (cookie de sessão + cabeçalho anti-CSRF exigido pela API). */
export class Client {
  cookie = '';
  constructor(private readonly ctx: TestContext) {}

  static async login(ctx: TestContext, username: string, password = TEST_PASSWORD): Promise<Client> {
    const c = new Client(ctx);
    const res = await c.post('/api/auth/login', { username, password });
    if (res.status !== 200) throw new Error(`login ${username} falhou: ${res.status} ${JSON.stringify(res.body)}`);
    return c;
  }

  private capture(res: request.Response): request.Response {
    const set = res.headers['set-cookie'] as unknown as string[] | undefined;
    const session = set?.find((s) => s.startsWith('hosp_session='));
    if (session) this.cookie = session.split(';')[0];
    return res;
  }

  get(path: string) {
    return request(this.ctx.app.getHttpServer()).get(path).set('Cookie', this.cookie).then((r) => this.capture(r));
  }
  post(path: string, body: unknown = {}, headers: Record<string, string> = {}) {
    return request(this.ctx.app.getHttpServer()).post(path).set('Cookie', this.cookie).set('X-Requested-With', 'hospital-web').set(headers).send(body as object).then((r) => this.capture(r));
  }
  put(path: string, body: unknown = {}) {
    return request(this.ctx.app.getHttpServer()).put(path).set('Cookie', this.cookie).set('X-Requested-With', 'hospital-web').send(body as object).then((r) => this.capture(r));
  }
}

export async function createPatient(reception: Client, overrides: Record<string, unknown> = {}) {
  const res = await reception.post('/api/patients', {
    fullName: uniqueName(),
    birthDate: '1970-01-15',
    sex: 'FEMININO',
    motherName: 'Mãe Fictícia de Teste',
    phones: [{ type: 'CELULAR', number: '(94) 90000-0000' }],
    address: { city: 'Ulianópolis', state: 'PA', neighborhood: 'Centro' },
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`criar paciente: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; fullName: string; version: number };
}

export async function createAttendance(reception: Client, patientId: string, reason = 'Dor no peito') {
  const res = await reception.post('/api/attendances', { patientId, reason });
  if (res.status !== 201) throw new Error(`criar atendimento: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; code: string; ticket: string };
}

/** Leva um atendimento da chegada até a fila médica (usado como preparação em testes do médico). */
export async function bringToMedicalQueue(reception: Client, triage: Client, level = 'URGENTE', patientOverrides: Record<string, unknown> = {}) {
  const patient = await createPatient(reception, patientOverrides);
  const att = await createAttendance(reception, patient.id);
  const s = await triage.post(`/api/triage/${att.id}/start`, {});
  if (s.status !== 200) throw new Error(`start triagem: ${s.status} ${JSON.stringify(s.body)}`);
  const c = await triage.post(`/api/triage/${att.id}/classify`, { level });
  if (c.status !== 200) throw new Error(`classify: ${c.status} ${JSON.stringify(c.body)}`);
  const f = await triage.post(`/api/triage/${att.id}/finish`, {});
  if (f.status !== 200) throw new Error(`finish: ${f.status} ${JSON.stringify(f.body)}`);
  return { patient, att };
}

/** Esvazia a fila médica entre testes de concorrência (devolve chamados e finaliza pendências via SQL de teste). */
export async function drainMedicalQueue(ctx: TestContext): Promise<void> {
  // cancela atendimentos ainda aguardando médico (transição válida AGUARDANDO_MEDICO → CANCELADO)
  await ctx.prisma.$executeRawUnsafe(`
    UPDATE "queue" SET "status" = 'CANCELLED', "finished_at" = now() WHERE "kind" = 'MEDICA' AND "status" IN ('WAITING', 'CALLED');
  `);
  await ctx.prisma.$executeRawUnsafe(`
    UPDATE "attendances" SET "status" = 'CANCELADO', "cancelled_at" = now(), "cancel_reason" = 'limpeza de teste'
    WHERE "status" = 'AGUARDANDO_MEDICO';
  `);
}
