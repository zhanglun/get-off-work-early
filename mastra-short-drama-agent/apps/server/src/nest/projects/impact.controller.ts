import { Controller, Post, Param, Body, HttpCode, Get, Inject } from '@nestjs/common';
import { z } from 'zod';
import { ImpactService } from './impact.service.js';

const confirmSchema = z.object({
  messageId: z.string().min(1),
  mode: z.enum(['regenerate', 'setting_only']),
});

@Controller('api/projects/:projectId/asset-changes')
export class ImpactController {
  constructor(@Inject(ImpactService) private readonly impact: ImpactService) {}

  @Post('confirm')
  @HttpCode(200)
  confirm(@Param('projectId') projectId: string, @Body() body: unknown) {
    const input = confirmSchema.parse(body);
    return this.impact.confirm(projectId, input.messageId, input.mode);
  }

  @Get(':assetId/versions')
  versions(@Param('assetId') assetId: string) {
    return this.impact.versions(assetId);
  }

  @Post(':assetId/rollback/:version')
  @HttpCode(200)
  rollback(@Param('projectId') projectId: string, @Param('assetId') assetId: string, @Param('version') version: string) {
    return this.impact.rollback(projectId, assetId, Number(version));
  }
}
