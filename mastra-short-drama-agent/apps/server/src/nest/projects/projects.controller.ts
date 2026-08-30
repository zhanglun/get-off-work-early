import { Controller, Get, Post, Param, Body, Res, HttpCode, Inject } from '@nestjs/common';
import type { Response } from 'express';
import { createProjectSchema } from '@short-drama/shared';
import { ProjectsService } from './projects.service.js';

@Controller('api/projects')
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Get()
  list() {
    return this.projects.list();
  }

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown) {
    const input = createProjectSchema.parse(body);
    return this.projects.create(input.name);
  }

  @Get(':id/snapshot')
  async snapshot(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const snapshot = await this.projects.snapshot(id);
    if (!snapshot) {
      res.status(404).json({ code: 'NOT_FOUND', message: '项目不存在' });
      return;
    }
    return snapshot;
  }
}
