import { Global, Module } from '@nestjs/common';
import { AppLogger } from '../logger/app-logger';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [AppLogger, PrismaService],
  exports: [AppLogger, PrismaService],
})
export class PrismaModule {}
