import './setup-env'; // PRIMEIRO: garante o banco de teste antes de qualquer import do Prisma
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import * as argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { syncReferenceData } from '../src/bootstrap/reference-data';
import { TEST_PASSWORD, TEST_ROOMS, TEST_USERS } from './fixtures';

/**
 * Prepara o banco de TESTE do zero (schema recriado + migrations + dados de referência + usuários de teste).
 * Trava de segurança: só roda com APP_ENV=test e banco cujo nome termina em "_test".
 */
export default async function globalSetup(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL de teste não definida (crie apps/api/.env.test a partir de .env.test.example).');
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (process.env.APP_ENV !== 'test' || !/_test$/.test(dbName)) {
    throw new Error(`Recusado: a suíte só recria bancos "*_test" (recebido "${dbName}").`);
  }

  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await prisma.$executeRawUnsafe('CREATE SCHEMA public');
  } finally {
    await prisma.$disconnect();
  }
  execSync('npx prisma migrate deploy', { cwd: resolve(__dirname, '..'), env: process.env, stdio: 'pipe' });

  const db = new PrismaClient({ datasourceUrl: url });
  try {
    await syncReferenceData(db);
    const hash = await argon2.hash(TEST_PASSWORD, { type: argon2.argon2id, memoryCost: 1024, timeCost: 1, parallelism: 1 });
    const roles = new Map((await db.role.findMany()).map((r) => [r.code, r.id]));
    const sectors = new Map((await db.sector.findMany()).map((s) => [s.code, s.id]));
    for (const u of TEST_USERS) {
      await db.user.create({
        data: {
          username: u.username,
          fullName: u.fullName,
          passwordHash: hash,
          sectorId: sectors.get(u.sector),
          professionalRegister: u.register ?? null,
          roles: { create: { roleId: roles.get(u.role)! } },
        },
      });
    }
    for (const name of TEST_ROOMS) await db.room.create({ data: { name, sectorId: sectors.get('CONSULTORIOS')! } });
  } finally {
    await db.$disconnect();
  }
}
