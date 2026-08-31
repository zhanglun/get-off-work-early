import { Controller, Get, Inject } from '@nestjs/common';
import { RedisService } from './infrastructure/redis.service.js';
import { PrismaService } from './prisma.service.js';

@Controller('api/health')
export class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(RedisService) private readonly redis: RedisService) {}

  @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    await this.redis.ping();
    return { ok: true, service: 'short-drama-api', database: 'ok', redis: 'ok' };
  }
}
