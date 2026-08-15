import { Module } from '@nestjs/common';
import { TasksController } from './tasks/tasks.controller';
import { LlmModule } from './llm/llm.module';
import { TaskCenterModule } from './task-center/task-center.module';
import { PrismaModule } from './prisma/prisma.module';
import { CoreModule } from './core/core.module';
import { ShotLoopModule } from './core/shot-loop';
import { EpisodeProcessor } from './processor/episode.processor';

@Module({
  // ProcessorModule 动态组装：依赖模块注入后再注册（NestJS DynamicModule.module 用法）
  imports: [LlmModule, TaskCenterModule, PrismaModule, CoreModule, ShotLoopModule],
  controllers: [TasksController],
  providers: [EpisodeProcessor],
})
export class AppModule {
  constructor(private readonly processor: EpisodeProcessor) {}
  async onApplicationBootstrap() {
    await this.processor.start();
  }
}
