import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { AdminController } from './admin.controller.js';

@Module({ providers: [PrismaService], controllers: [AdminController] })
export class AdminModule {}
