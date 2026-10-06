import { Controller, Get, HttpCode, Post, Req, Res, Body } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { Response } from 'express';
import { changePasswordSchema, loginSchema } from '@hospital/shared';
import { APP_CONFIG, AppConfig } from '../config/env';
import { zbody } from '../common/http/zod-validation.pipe';
import { AllowPendingPasswordChange, AuthenticatedOnly, CurrentActor, NoTouch, Public } from './auth.decorators';
import type { AuthedRequest } from './auth.guard';
import { AuthService } from './auth.service';
import type { Actor } from './auth.types';
import type { z } from 'zod';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(zbody(loginSchema)) body: z.infer<typeof loginSchema>, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(body.username, body.password, {
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
      requestId: req.id,
    });
    res.cookie(this.config.cookieName, result.token, {
      httpOnly: true, // JavaScript da página não lê o cookie (mitiga roubo por XSS)
      secure: this.config.cookieSecure,
      sameSite: 'lax',
      path: '/',
      // sem maxAge: cookie de sessão; a expiração real é imposta pelo servidor
    });
    return { mustChangePassword: result.mustChangePassword };
  }

  @AuthenticatedOnly()
  @AllowPendingPasswordChange()
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentActor() actor: Actor, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(actor);
    res.clearCookie(this.config.cookieName, { httpOnly: true, secure: this.config.cookieSecure, sameSite: 'lax', path: '/' });
  }

  @AuthenticatedOnly()
  @AllowPendingPasswordChange()
  @Get('me')
  me(@CurrentActor() actor: Actor, @Req() req: AuthedRequest) {
    return this.auth.sessionInfo(actor, req.sessionMeta.idleExpiresAt, req.sessionMeta.absoluteExpiresAt);
  }

  /** Estado da sessão SEM renová-la (alimenta o aviso de inatividade no frontend). */
  @AuthenticatedOnly()
  @AllowPendingPasswordChange()
  @NoTouch()
  @Get('session')
  session(@CurrentActor() actor: Actor, @Req() req: AuthedRequest) {
    return {
      idleExpiresAt: req.sessionMeta.idleExpiresAt.toISOString(),
      absoluteExpiresAt: req.sessionMeta.absoluteExpiresAt.toISOString(),
      userId: actor.userId,
    };
  }

  @AuthenticatedOnly()
  @AllowPendingPasswordChange()
  @Post('change-password')
  @HttpCode(204)
  async changePassword(@CurrentActor() actor: Actor, @Body(zbody(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>): Promise<void> {
    await this.auth.changePassword(actor, body.currentPassword, body.newPassword);
  }
}
