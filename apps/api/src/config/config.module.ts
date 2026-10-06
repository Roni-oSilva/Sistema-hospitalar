import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, parseConfig } from './env';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => parseConfig() }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
