import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from './config/config.module';
import { APP_CONFIG, AppConfig } from './config/env';
import { PrismaModule } from './common/prisma/prisma.module';
import { CoreModule } from './common/core.module';
import { AllExceptionsFilter } from './common/http/all-exceptions.filter';
import { IdempotencyInterceptor } from './common/http/idempotency.interceptor';
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
import { TriageModule } from './triage/triage.module';
import { MedicalModule } from './medical/medical.module';
import { PublicModule } from './public/public.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ReportsModule } from './reports/reports.module';
import { AdminModule } from './admin/admin.module';
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
    TriageModule,
    MedicalModule,
    PublicModule,
    DashboardModule,
    ReportsModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    RequestContextMiddleware,
    // ordem importa: primeiro rate limit, depois autenticação/autorização
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // depois dos guards (precisa do usuário autenticado): reenvio da mesma gravação não duplica registros
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule {}
