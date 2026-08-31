import { Controller, Post, Param, Res, HttpCode, Inject } from '@nestjs/common';
import type { Response } from 'express';
import { ExportService } from './export.service.js';

@Controller('api/exports')
export class ExportController {
  constructor(@Inject(ExportService) private readonly exports: ExportService) {}

  /** 一键整包下载。 */
  @Post(':projectId')
  @HttpCode(200)
  async export(@Param('projectId') projectId: string, @Res() res: Response) {
    const result = await this.exports.buildProjectZip(projectId);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`);
    res.send(result.buffer);
  }
}
