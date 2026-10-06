import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { PermissionCode } from '@hospital/shared';
import type { Actor } from './auth.types';

export const IS_PUBLIC = 'auth:public';
export const PERMISSIONS_META = 'auth:permissions';
export const AUTH_ONLY = 'auth:authenticated-only';
export const ALLOW_PENDING_PASSWORD = 'auth:allow-pending-password';
export const NO_TOUCH = 'auth:no-touch';

/** Endpoint sem autenticação (login, health, painel público). Use com parcimônia. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Exige TODAS as permissões listadas. */
export const RequirePermissions = (...permissions: PermissionCode[]) => SetMetadata(PERMISSIONS_META, { all: permissions });

/** Exige PELO MENOS UMA das permissões listadas. */
export const RequireAnyPermission = (...permissions: PermissionCode[]) => SetMetadata(PERMISSIONS_META, { any: permissions });

/** Qualquer usuário autenticado (ex.: /auth/me, notificações). Negar-por-padrão: sem uma destas marcas, o endpoint é recusado. */
export const AuthenticatedOnly = () => SetMetadata(AUTH_ONLY, true);

/** Permite acesso mesmo com troca de senha pendente (apenas as rotas de senha/logout/me). */
export const AllowPendingPasswordChange = () => SetMetadata(ALLOW_PENDING_PASSWORD, true);

/** Não renova a atividade da sessão (consulta de status de sessão para o contador de inatividade). */
export const NoTouch = () => SetMetadata(NO_TOUCH, true);

export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  return ctx.switchToHttp().getRequest().actor as Actor;
});
