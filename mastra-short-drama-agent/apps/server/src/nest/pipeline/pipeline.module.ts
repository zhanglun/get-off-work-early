import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { EventsModule } from '../events/events.module.js';
import { ProductionPipeline } from './production-pipeline.js';
import { TaskLeaseService } from './task-lease.service.js';

@Module({
  imports: [EventsModule],
  providers: [PrismaService, ProductionPipeline, TaskLeaseService],
  exports: [ProductionPipeline, TaskLeaseService],
})
export class PipelineModule {}
