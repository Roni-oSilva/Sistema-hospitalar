import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppLogger } from './common/logger/app-logger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false });
  const config = configureApp(app);
  await app.listen(config.port);
  app.get(AppLogger).info(`API ouvindo na porta ${config.port}`, { env: config.appEnv, database: config.databaseName });
}

bootstrap().catch((err: Error) => {
  // erro de configuração: mensagem clara, sem stack de framework
  process.stderr.write(`Falha ao iniciar a API: ${err.message}\n`);
  process.exit(1);
});
