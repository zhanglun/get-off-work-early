import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { AuthService, AuthGuard } from './auth.service.js';
import { AuthController } from './auth.controller.js';

@Module({
  providers: [PrismaService, AuthService, AuthGuard],
  controllers: [AuthController],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
