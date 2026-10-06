import { Injectable } from '@nestjs/common';
import { SETTINGS_DEFINITIONS, SETTING_KEYS, SettingKey, SettingValue, isSettingKey } from '@hospital/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/auth.types';
import { badRequest, notFound } from '../common/errors/app-error';
import { ValidationFailed, zodIssuesToFieldErrors } from '../common/http/zod-validation.pipe';

const CACHE_MS = 15_000;

@Injectable()
export class SettingsService {
  private cache: { at: number; values: Map<string, unknown> } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async load(): Promise<Map<string, unknown>> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < CACHE_MS) return this.cache.values;
    const rows = await this.prisma.systemSetting.findMany();
    const values = new Map<string, unknown>(rows.map((r) => [r.key, r.value]));
    this.cache = { at: now, values };
    return values;
  }

  invalidate(): void {
    this.cache = null;
  }

  /** Valor configurado (validado) ou o padrão do catálogo. Valor corrompido no banco cai no padrão — nunca derruba o atendimento. */
  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const values = await this.load();
    const raw = values.get(key);
    if (raw === undefined) return SETTINGS_DEFINITIONS[key].default as SettingValue<K>;
    const parsed = SETTINGS_DEFINITIONS[key].schema.safeParse(raw);
    return (parsed.success ? parsed.data : SETTINGS_DEFINITIONS[key].default) as SettingValue<K>;
  }

  async list() {
    const rows = await this.prisma.systemSetting.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return SETTING_KEYS.map((key) => {
      const row = byKey.get(key);
      const def = SETTINGS_DEFINITIONS[key];
      const parsed = row ? def.schema.safeParse(row.value) : null;
      return {
        key,
        description: def.description,
        value: parsed?.success ? parsed.data : def.default,
        defaultValue: def.default,
        updatedAt: row?.updatedAt ?? null,
      };
    });
  }

  async set(actor: Actor, key: string, value: unknown) {
    if (!isSettingKey(key)) throw notFound('Parâmetro não encontrado.');
    const parsed = SETTINGS_DEFINITIONS[key].schema.safeParse(value);
    if (!parsed.success) throw new ValidationFailed(zodIssuesToFieldErrors(parsed.error.issues));
    if (parsed.data === undefined) throw badRequest('Valor inválido.');
    const before = await this.get(key);
    await this.prisma.run(async (tx) => {
      await tx.systemSetting.upsert({
        where: { key },
        create: { key, value: parsed.data as never, updatedById: actor.userId },
        update: { value: parsed.data as never, updatedById: actor.userId },
      });
      await this.audit.record(tx, actor, {
        action: 'SETTING_UPDATED',
        entityType: 'SystemSetting',
        entityId: key,
        changes: { fields: [key], diff: { [key]: { from: before, to: parsed.data } } },
      });
    });
    this.invalidate();
    return { key, value: parsed.data };
  }
}
