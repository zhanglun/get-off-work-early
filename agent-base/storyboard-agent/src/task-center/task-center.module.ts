import { Module } from '@nestjs/common';
import { TaskCenterService } from './task-center.service';

@Module({
  providers: [TaskCenterService],
  exports: [TaskCenterService],
})
export class TaskCenterModule {}
