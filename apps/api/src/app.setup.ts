import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { APP_CONFIG, AppConfig } from './config/env';
import { AppLogger } from './common/logger/app-logger';
import { RequestContextMiddleware } from './common/http/request-context.middleware';

/** Configuração HTTP única — usada pelo servidor (main.ts) e pelos testes, para testar exatamente o que roda. */
export function configureApp(app: NestExpressApplication): AppConfig {
  const config = app.get<AppConfig>(APP_CONFIG);
  app.useLogger(app.get(AppLogger));
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(
    helmet({
      // a API só devolve JSON: CSP restritiva
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: config.cookieSecure ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '200kb' });
  app.enableCors({
    origin: config.webOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-Requested-With', 'X-Request-Id'],
  });
  const ctx = app.get(RequestContextMiddleware);
  app.use(ctx.use.bind(ctx));
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  return config;
}
