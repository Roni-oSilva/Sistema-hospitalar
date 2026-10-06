import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { APP_CONFIG, AppConfig } from '../../config/env';
import { AppLogger } from '../logger/app-logger';

/** Cliente de banco OU transação — serviços aceitam ambos para compor operações atômicas. */
export type Db = PrismaService | Prisma.TransactionClient;
export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly logger: AppLogger,
  ) {
    super({
      datasourceUrl: config.databaseUrl,
      log: [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });
    // @ts-expect-error eventos tipados via log:emit=event
    this.$on('error', (e: { message: string }) => this.logger.error('Prisma error', { detail: e.message }));
    // @ts-expect-error eventos tipados via log:emit=event
    this.$on('warn', (e: { message: string }) => this.logger.warn('Prisma warn', { detail: e.message }));
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Transação com timeout explícito (evita transações penduradas bloqueando filas). */
  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.$transaction(fn, { maxWait: 5000, timeout: 15000 });
  }
}
