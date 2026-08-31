import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { AuthGuard } from './auth/auth.service.js';
import { EventsModule } from './events/events.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { AdminModule } from './admin/admin.module.js';
import { ChatModule } from './chat/chat.module.js';
import { ExportModule } from './exports/export.module.js';
import { HealthController } from './health.controller.js';
import { RedisModule } from './infrastructure/redis.module.js';
import { PrismaService } from './prisma.service.js';

@Module({
  imports: [RedisModule, AuthModule, EventsModule, ProjectsModule, ChatModule, ExportModule, AdminModule],
  controllers: [HealthController],
  providers: [PrismaService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
