import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { PrismaService } from './prisma.service.js';
import { AuthService } from './auth/auth.service.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors({ origin: true, credentials: true });
  app.use(cookieParser());
  app.enableShutdownHooks();

  const prisma = app.get(PrismaService);
  await prisma.$connect();
  const auth = app.get(AuthService);
  await auth.ensureDemoUser();

  // 生产：服务 apps/web 构建产物
  const webDist = join(import.meta.dirname, '../../../web/dist');
  if (existsSync(webDist)) {
    app.useStaticAssets(webDist);
    const handler: import('express').RequestHandler = (req, res, next) => {
      if (req.originalUrl.startsWith('/api')) next();
      else res.sendFile(join(webDist, 'index.html'));
    };
    app.use(handler);
  }

  const port = Number(process.env.PORT ?? 4120);
  await app.listen(port);
  console.log(`[api] listening on :${port}`);
}

void bootstrap();
