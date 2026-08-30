import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { EventsModule } from '../events/events.module.js';
import { ProjectsService } from './projects.service.js';
import { ProjectsController } from './projects.controller.js';

@Module({
  imports: [EventsModule],
  providers: [PrismaService, ProjectsService],
  controllers: [ProjectsController],
  exports: [ProjectsService],
})
export class ProjectsModule {}
