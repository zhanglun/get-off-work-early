import { Controller, Post, Get, Body, Req, Res, HttpCode, Inject } from '@nestjs/common';
import type { Request, Response } from 'express';
import { loginRequestSchema } from '@short-drama/shared';
import { AuthService, SESSION_COOKIE, type AuthedRequest } from './auth.service.js';

@Controller('api/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const input = loginRequestSchema.parse(body);
    const cookie = await this.auth.login(input.username, input.password);
    if (!cookie) {
      res.status(401).json({ code: 'BAD_CREDENTIALS', message: '账号或密码不正确' });
      return;
    }
    this.auth.setCookie(res, cookie);
    return { ok: true, username: input.username, expiresInDays: 7 };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout((req as { cookies?: Record<string, string> }).cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  me(@Req() req: AuthedRequest) {
    return { username: req.user?.username ?? null };
  }
}
