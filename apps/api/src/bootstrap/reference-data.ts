import type { PrismaClient } from '@prisma/client';
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  ROLE_CODES,
  ROLE_DESCRIPTIONS,
  SETTINGS_DEFINITIONS,
  SETTING_KEYS,
} from '@hospital/shared';

export const SECTORS: { code: string; name: string }[] = [
  { code: 'RECEPCAO', name: 'Recepção' },
  { code: 'TRIAGEM', name: 'Triagem / Classificação de risco' },
  { code: 'CONSULTORIOS', name: 'Consultórios médicos' },
  { code: 'ADMINISTRACAO', name: 'Administração' },
];

/**
 * Dados de REFERÊNCIA (não são dados de teste): catálogo de permissões, perfis de sistema, setores e parâmetros padrão.
 * Idempotente — pode rodar a cada deploy. Regras:
 *  - permissões: o catálogo é sincronizado com o código;
 *  - perfis: criados com as permissões padrão APENAS se ainda não existem (não desfaz ajustes do administrador);
 *  - parâmetros: o padrão só é gravado se a chave não existir.
 */
export async function syncReferenceData(prisma: PrismaClient, log: (msg: string) => void = () => undefined): Promise<void> {
  for (const [code, meta] of Object.entries(PERMISSION_DESCRIPTIONS)) {
    await prisma.permission.upsert({
      where: { code },
      create: { code, module: meta.module, description: meta.description },
      update: { module: meta.module, description: meta.description },
    });
  }
  const permissions = await prisma.permission.findMany();
  const permId = new Map(permissions.map((p) => [p.code, p.id]));

  for (const code of ROLE_CODES) {
    const existing = await prisma.role.findUnique({ where: { code } });
    if (existing) continue;
    const meta = ROLE_DESCRIPTIONS[code];
    await prisma.role.create({
      data: {
        code,
        name: meta.name,
        description: meta.description,
        isSystem: true,
        permissions: { create: DEFAULT_ROLE_PERMISSIONS[code].map((p) => ({ permissionId: permId.get(p)! })) },
      },
    });
    log(`perfil criado: ${code}`);
  }

  for (const s of SECTORS) {
    await prisma.sector.upsert({ where: { code: s.code }, create: s, update: {} });
  }

  for (const key of SETTING_KEYS) {
    const exists = await prisma.systemSetting.findUnique({ where: { key } });
    if (!exists) await prisma.systemSetting.create({ data: { key, value: SETTINGS_DEFINITIONS[key].default as never } });
  }
}
