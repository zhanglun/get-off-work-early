import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { EventsModule } from '../events/events.module.js';
import { ChatService } from './chat.service.js';
import { ChatController } from './chat.controller.js';

@Module({
  imports: [EventsModule],
  providers: [PrismaService, ChatService],
  controllers: [ChatController],
  exports: [ChatService],
})
export class ChatModule {}
