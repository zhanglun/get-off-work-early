import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { EventsModule } from '../events/events.module.js';
import { ProjectsService } from './projects.service.js';
import { ProjectsController } from './projects.controller.js';
import { EpisodesController } from './episodes.controller.js';
import { BoardController } from './board.controller.js';
import { TasksController } from './tasks.controller.js';
import { IssuesController } from './issues.controller.js';
import { RetryController } from './retry.controller.js';
import { ImpactController } from './impact.controller.js';
import { ImpactService } from './impact.service.js';

@Module({
  imports: [EventsModule],
  providers: [PrismaService, ProjectsService, ImpactService],
  controllers: [ProjectsController, EpisodesController, BoardController, TasksController, IssuesController, RetryController, ImpactController],
  exports: [ProjectsService, ImpactService],
})
export class ProjectsModule {}
