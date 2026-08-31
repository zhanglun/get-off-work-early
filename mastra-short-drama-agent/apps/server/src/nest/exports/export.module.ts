import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { EventsModule } from '../events/events.module.js';
import { ExportService } from './export.service.js';
import { ExportController } from './export.controller.js';

@Module({
  imports: [EventsModule],
  providers: [PrismaService, ExportService],
  controllers: [ExportController],
})
export class ExportModule {}
