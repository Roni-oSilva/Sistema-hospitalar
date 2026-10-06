import { Global, Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { AccessLogService } from './access-log.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

@Global()
@Module({
  imports: [SettingsModule],
  controllers: [AuthController],
  providers: [AuthService, SessionService, PasswordService, AccessLogService],
  exports: [AuthService, SessionService, PasswordService, AccessLogService],
})
export class AuthModule {}
