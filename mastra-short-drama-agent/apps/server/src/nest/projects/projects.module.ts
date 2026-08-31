import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { EventsModule } from '../events/events.module.js';
import { ProjectsService } from './projects.service.js';
import { ProjectsController } from './projects.controller.js';
import { EpisodesController } from './episodes.controller.js';
import { BoardController } from './board.controller.js';
import { TasksController } from './tasks.controller.js';

@Module({
  imports: [EventsModule],
  providers: [PrismaService, ProjectsService],
  controllers: [ProjectsController, EpisodesController, BoardController, TasksController],
  exports: [ProjectsService],
})
export class ProjectsModule {}
