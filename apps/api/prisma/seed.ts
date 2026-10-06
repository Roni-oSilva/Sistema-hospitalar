/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  SEED DE DESENVOLVIMENTO — DADOS 100% FICTÍCIOS                          ║
 * ║  Recusa-se a rodar fora de APP_ENV=development|test.                     ║
 * ║  Pacientes NÃO recebem CPF/CNS (nem números "inventados" que poderiam    ║
 * ║  coincidir com documentos de pessoas reais).                             ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import 'dotenv/config';
import * as argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { normalizeText } from '@hospital/shared';
import { parseConfig } from '../src/config/env';
import { syncReferenceData } from '../src/bootstrap/reference-data';

const DEV_PASSWORD = process.env.SEED_DEV_PASSWORD ?? 'Desenvolvimento2026';

const USERS = [
  { username: 'admin', fullName: 'Administrador (DEV)', role: 'ADMINISTRADOR', sector: 'ADMINISTRACAO', register: null },
  { username: 'recepcao', fullName: 'Ana Recepcionista (DEV)', role: 'RECEPCAO', sector: 'RECEPCAO', register: null },
  { username: 'triagem', fullName: 'Enf. Bruno Triagem (DEV)', role: 'TRIAGEM', sector: 'TRIAGEM', register: 'COREN-PA 000000 (DEV)' },
  { username: 'medico', fullName: 'Dra. Carla Médica (DEV)', role: 'MEDICO', sector: 'CONSULTORIOS', register: 'CRM-PA 00000 (DEV)' },
  { username: 'medico2', fullName: 'Dr. Daniel Médico (DEV)', role: 'MEDICO', sector: 'CONSULTORIOS', register: 'CRM-PA 00001 (DEV)' },
] as const;

const PATIENTS: {
  fullName: string;
  socialName?: string;
  birthDate: string;
  sex: 'MASCULINO' | 'FEMININO';
  motherName: string;
  phone?: string;
  flags?: ('PCD' | 'MOBILIDADE_REDUZIDA' | 'GESTANTE' | 'NECESSITA_LIBRAS' | 'NECESSITA_ACOMPANHANTE')[];
  disabilityType?: 'FISICA' | 'AUDITIVA' | 'VISUAL';
  needs?: ('CADEIRA_DE_RODAS' | 'INTERPRETE_LIBRAS' | 'BENGALA' | 'ACOMPANHANTE')[];
}[] = [
  { fullName: 'João da Silva Ficticio', birthDate: '1974-04-12', sex: 'MASCULINO', motherName: 'Maria da Silva Ficticia', phone: '94900000001', flags: ['PCD'], disabilityType: 'FISICA', needs: ['CADEIRA_DE_RODAS'] },
  { fullName: 'Maria Santos Ficticia', birthDate: '1952-09-03', sex: 'FEMININO', motherName: 'Joana Santos Ficticia', phone: '94900000002' },
  { fullName: 'Ana Souza Ficticia', birthDate: '1996-01-20', sex: 'FEMININO', motherName: 'Rita Souza Ficticia', flags: ['GESTANTE'] },
  { fullName: 'Pedro Lima Ficticio', birthDate: '1980-07-15', sex: 'MASCULINO', motherName: 'Lucia Lima Ficticia', flags: ['PCD', 'MOBILIDADE_REDUZIDA'], disabilityType: 'VISUAL', needs: ['BENGALA'] },
  { fullName: 'Lucas Oliveira Ficticio', birthDate: '2019-03-08', sex: 'MASCULINO', motherName: 'Paula Oliveira Ficticia', flags: ['NECESSITA_ACOMPANHANTE'], needs: ['ACOMPANHANTE'] },
  { fullName: 'Francisca Pereira Ficticia', socialName: 'Chica Pereira', birthDate: '1988-11-30', sex: 'FEMININO', motherName: 'Antonia Pereira Ficticia', flags: ['PCD', 'NECESSITA_LIBRAS'], disabilityType: 'AUDITIVA', needs: ['INTERPRETE_LIBRAS'] },
  { fullName: 'Raimundo Costa Ficticio', birthDate: '1940-05-02', sex: 'MASCULINO', motherName: 'Benedita Costa Ficticia', phone: '94900000007' },
  { fullName: 'Carlos Alberto Ficticio', birthDate: '2001-12-24', sex: 'MASCULINO', motherName: 'Sonia Alberto Ficticia' },
];

async function main(): Promise<void> {
  const config = parseConfig();
  if (config.appEnv !== 'development' && config.appEnv !== 'test') {
    throw new Error(`Seed de desenvolvimento recusado: APP_ENV=${config.appEnv}. Em outros ambientes use "npm run admin:bootstrap".`);
  }
  const prisma = new PrismaClient({ datasourceUrl: config.databaseUrl });
  try {
    console.log(`[seed] ⚠️  DADOS FICTÍCIOS DE DESENVOLVIMENTO → banco "${config.databaseName}"`);
    await syncReferenceData(prisma, (m) => console.log(`[seed] ${m}`));

    const passwordHash = await argon2.hash(DEV_PASSWORD, { type: argon2.argon2id, memoryCost: config.argon2.memoryCost, timeCost: config.argon2.timeCost, parallelism: 1 });
    const roles = new Map((await prisma.role.findMany()).map((r) => [r.code, r.id]));
    const sectors = new Map((await prisma.sector.findMany()).map((s) => [s.code, s.id]));

    for (const u of USERS) {
      const exists = await prisma.user.findUnique({ where: { username: u.username } });
      if (exists) continue;
      await prisma.user.create({
        data: {
          username: u.username,
          fullName: u.fullName,
          professionalRegister: u.register,
          passwordHash,
          sectorId: sectors.get(u.sector),
          roles: { create: { roleId: roles.get(u.role)! } },
        },
      });
      console.log(`[seed] usuário ${u.username} (${u.role})`);
    }

    const consultorios = sectors.get('CONSULTORIOS')!;
    for (const name of ['Consultório 01', 'Consultório 02', 'Consultório 03']) {
      await prisma.room.upsert({ where: { name }, create: { name, sectorId: consultorios }, update: {} });
    }

    const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'recepcao' } });
    for (const p of PATIENTS) {
      const normalizedName = [normalizeText(p.fullName), p.socialName ? normalizeText(p.socialName) : ''].filter(Boolean).join(' ');
      const exists = await prisma.patient.findFirst({ where: { normalizedName, birthDate: new Date(`${p.birthDate}T00:00:00Z`) } });
      if (exists) continue;
      await prisma.patient.create({
        data: {
          fullName: p.fullName,
          socialName: p.socialName,
          normalizedName,
          birthDate: new Date(`${p.birthDate}T00:00:00Z`),
          sex: p.sex,
          motherName: p.motherName,
          birthplace: 'Ulianópolis/PA',
          createdById: admin.id,
          contacts: p.phone ? { create: { type: 'CELULAR', number: p.phone, isPrimary: true } } : undefined,
          addresses: { create: { street: 'Rua Fictícia', number: 's/n', neighborhood: 'Centro', city: 'Ulianópolis', state: 'PA', isCurrent: true } },
          accessibility: { create: { flags: p.flags ?? [], disabilityType: p.disabilityType ?? null, needs: p.needs ?? [] } },
        },
      });
      console.log(`[seed] paciente fictício: ${p.fullName}`);
    }
    console.log(`[seed] concluído. Usuários: ${USERS.map((u) => u.username).join(', ')} — senha de desenvolvimento: ${DEV_PASSWORD}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: Error) => {
  console.error(`[seed] falhou: ${e.message}`);
  process.exit(1);
});
