import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { EventsModule } from '../events/events.module.js';
import { ProductionPipeline } from './production-pipeline.js';
import { TaskLeaseService } from './task-lease.service.js';
import { RedisModule } from '../infrastructure/redis.module.js';

@Module({
  imports: [EventsModule, RedisModule],
  providers: [PrismaService, ProductionPipeline, TaskLeaseService],
  exports: [ProductionPipeline, TaskLeaseService],
})
export class PipelineModule {}
