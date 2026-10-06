/**
 * Implantação inicial (TODOS os ambientes, inclusive produção):
 *   1. sincroniza dados de referência (permissões, perfis, setores, parâmetros);
 *   2. cria o primeiro administrador, se ainda não existir, com senha TEMPORÁRIA (troca obrigatória no 1º acesso).
 *
 * Uso: BOOTSTRAP_ADMIN_USERNAME=... BOOTSTRAP_ADMIN_PASSWORD=... BOOTSTRAP_ADMIN_NAME="..." npm run admin:bootstrap
 * A senha vem do ambiente (nunca do código) e deve ser apagada do ambiente após o uso.
 */
import 'dotenv/config';
import * as argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { passwordSchema } from '@hospital/shared';
import { parseConfig } from '../config/env';
import { syncReferenceData } from '../bootstrap/reference-data';

async function main(): Promise<void> {
  const config = parseConfig();
  const prisma = new PrismaClient({ datasourceUrl: config.databaseUrl });
  try {
    await syncReferenceData(prisma, (m) => console.log(`[bootstrap] ${m}`));
    console.log('[bootstrap] dados de referência sincronizados.');

    const username = process.env.BOOTSTRAP_ADMIN_USERNAME?.trim().toLowerCase();
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    const fullName = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Administrador do Sistema';
    if (!username || !password) {
      console.log('[bootstrap] BOOTSTRAP_ADMIN_USERNAME/PASSWORD não informados: nenhum administrador criado.');
      return;
    }
    const pw = passwordSchema.safeParse(password);
    if (!pw.success) throw new Error(`Senha do administrador inválida: ${pw.error.issues[0]?.message}`);

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      console.log(`[bootstrap] usuário "${username}" já existe — nada a fazer.`);
      return;
    }
    const role = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMINISTRADOR' } });
    const sector = await prisma.sector.findUnique({ where: { code: 'ADMINISTRACAO' } });
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: config.argon2.memoryCost, timeCost: config.argon2.timeCost, parallelism: 1 });
    const user = await prisma.user.create({
      data: { username, fullName, passwordHash, mustChangePassword: true, sectorId: sector?.id, roles: { create: { roleId: role.id } } },
    });
    await prisma.auditLog.create({ data: { action: 'USER_CREATED', entityType: 'User', entityId: user.id, username: 'system:bootstrap', metadata: { roles: ['ADMINISTRADOR'] } } });
    console.log(`[bootstrap] administrador "${username}" criado. A senha temporária deverá ser trocada no primeiro acesso.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: Error) => {
  console.error(`[bootstrap] falhou: ${e.message}`);
  process.exit(1);
});
