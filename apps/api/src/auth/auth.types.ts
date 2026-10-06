import type { PermissionCode } from '@hospital/shared';

/** Quem está agindo. Montado pelo guard de autenticação e passado explicitamente aos serviços (testável, rastreável). */
export interface Actor {
  userId: string;
  username: string;
  fullName: string;
  professionalRegister: string | null;
  sectorId: string | null;
  sectorCode: string | null;
  roles: string[];
  permissions: ReadonlySet<PermissionCode>;
  mustChangePassword: boolean;
  sessionId: string;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export const can = (actor: Actor, permission: PermissionCode): boolean => actor.permissions.has(permission);
export const canAny = (actor: Actor, ...permissions: PermissionCode[]): boolean => permissions.some((p) => actor.permissions.has(p));

/** Ações do sistema (ex.: script de bootstrap) sem usuário humano. */
export type AuditActor = Pick<Actor, 'userId' | 'username' | 'sectorCode' | 'ip' | 'userAgent' | 'requestId'>;
