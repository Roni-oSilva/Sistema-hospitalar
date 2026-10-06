import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from './config/config.module';
import { APP_CONFIG, AppConfig } from './config/env';
import { PrismaModule } from './common/prisma/prisma.module';
import { CoreModule } from './common/core.module';
import { AllExceptionsFilter } from './common/http/all-exceptions.filter';
import { RequestContextMiddleware } from './common/http/request-context.middleware';
import { AuditModule } from './audit/audit.module';
import { SettingsModule } from './settings/settings.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { AppThrottlerGuard } from './auth/app-throttler.guard';
import { RealtimeModule } from './realtime/realtime.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PatientsModule } from './patients/patients.module';
import { AttendancesModule } from './attendances/attendances.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) => ({
        throttlers: [
          { name: 'default', ttl: 60_000, limit: c.rateLimit.perMinute },
          {
            // limite próprio e mais rígido para o login (por IP), além do bloqueio por usuário
            name: 'login',
            ttl: 60_000,
            limit: c.rateLimit.loginPerMinute,
            skipIf: (ctx) => !/\/auth\/login$/.test(ctx.switchToHttp().getRequest<{ path: string }>().path),
          },
        ],
      }),
    }),
    AuditModule,
    SettingsModule,
    AuthModule,
    RealtimeModule,
    NotificationsModule,
    CoreModule,
    PatientsModule,
    AttendancesModule,
  ],
  controllers: [HealthController],
  providers: [
    RequestContextMiddleware,
    // ordem importa: primeiro rate limit, depois autenticação/autorização
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
