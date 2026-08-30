import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { EventsService } from './events.service.js';
import { EventsController } from './events.controller.js';

@Module({
  providers: [PrismaService, EventsService],
  controllers: [EventsController],
  exports: [EventsService],
})
export class EventsModule {}
