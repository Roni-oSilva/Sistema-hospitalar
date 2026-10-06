import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  PERMISSIONS,
  accessLogQuerySchema,
  auditQuerySchema,
  createRoomSchema,
  createUserSchema,
  resetPasswordSchema,
  updateRolePermissionsSchema,
  updateRoomSchema,
  updateSectorSchema,
  updateUserSchema,
} from '@hospital/shared';
import type { z } from 'zod';
import { CurrentActor, RequireAnyPermission, RequirePermissions } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';
import { zbody } from '../common/http/zod-validation.pipe';
import { AdminService } from './admin.service';
import { UsersService } from './users.service';

@Controller()
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly users: UsersService,
  ) {}

  // ── usuários
  @RequirePermissions(PERMISSIONS.USERS_READ)
  @Get('admin/users')
  listUsers() {
    return this.users.list();
  }

  @RequirePermissions(PERMISSIONS.USERS_WRITE)
  @Post('admin/users')
  createUser(@CurrentActor() actor: Actor, @Body(zbody(createUserSchema)) body: z.infer<typeof createUserSchema>) {
    return this.users.create(actor, body);
  }

  @RequirePermissions(PERMISSIONS.USERS_WRITE)
  @Put('admin/users/:id')
  updateUser(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(zbody(updateUserSchema)) body: z.infer<typeof updateUserSchema>) {
    return this.users.update(actor, id, body);
  }

  @RequirePermissions(PERMISSIONS.USERS_WRITE)
  @Post('admin/users/:id/reset-password')
  @HttpCode(204)
  async resetPassword(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(zbody(resetPasswordSchema)) body: z.infer<typeof resetPasswordSchema>) {
    await this.users.resetPassword(actor, id, body.temporaryPassword);
  }

  @RequirePermissions(PERMISSIONS.USERS_WRITE)
  @Post('admin/users/:id/revoke-sessions')
  @HttpCode(200)
  revokeSessions(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.revokeSessions(actor, id);
  }

  // ── perfis/permissões
  @RequirePermissions(PERMISSIONS.ROLES_READ)
  @Get('admin/roles')
  roles() {
    return this.admin.roles();
  }

  @RequirePermissions(PERMISSIONS.ROLES_WRITE)
  @Put('admin/roles/:code/permissions')
  updateRole(@CurrentActor() actor: Actor, @Param('code') code: string, @Body(zbody(updateRolePermissionsSchema)) body: z.infer<typeof updateRolePermissionsSchema>) {
    return this.admin.updateRolePermissions(actor, code, body.permissions);
  }

  // ── setores e consultórios
  @RequirePermissions(PERMISSIONS.FACILITIES_READ)
  @Get('admin/sectors')
  sectors() {
    return this.admin.sectors();
  }

  @RequirePermissions(PERMISSIONS.FACILITIES_WRITE)
  @Put('admin/sectors/:id')
  updateSector(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(zbody(updateSectorSchema)) body: z.infer<typeof updateSectorSchema>) {
    return this.admin.updateSector(actor, id, body);
  }

  /** Lista de consultórios: também usada pelo médico para escolher onde atender. */
  @RequireAnyPermission(PERMISSIONS.FACILITIES_READ, PERMISSIONS.MEDICAL_CALL)
  @Get('rooms')
  rooms(@Query('active') active?: string) {
    return this.admin.rooms(active === 'true');
  }

  @RequirePermissions(PERMISSIONS.FACILITIES_WRITE)
  @Post('admin/rooms')
  createRoom(@CurrentActor() actor: Actor, @Body(zbody(createRoomSchema)) body: z.infer<typeof createRoomSchema>) {
    return this.admin.createRoom(actor, body);
  }

  @RequirePermissions(PERMISSIONS.FACILITIES_WRITE)
  @Put('admin/rooms/:id')
  updateRoom(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(zbody(updateRoomSchema)) body: z.infer<typeof updateRoomSchema>) {
    return this.admin.updateRoom(actor, id, body);
  }

  // ── auditoria
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  @Get('admin/audit-logs')
  auditLogs(@CurrentActor() actor: Actor, @Query(zbody(auditQuerySchema)) q: z.infer<typeof auditQuerySchema>) {
    return this.admin.auditLogs(actor, q);
  }

  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  @Get('admin/access-logs')
  accessLogs(@Query(zbody(accessLogQuerySchema)) q: z.infer<typeof accessLogQuerySchema>) {
    return this.admin.accessLogs(q);
  }
}
