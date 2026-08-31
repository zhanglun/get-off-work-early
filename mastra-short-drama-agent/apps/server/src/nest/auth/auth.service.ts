import { Injectable, Inject, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma.service.js';

export const SESSION_COOKIE = 'sd_session';
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
function sessionSecret(): string {
  return process.env.SESSION_SECRET ?? 'dev-only-session-secret';
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function sign(value: string): string {
  return createHmac('sha256', sessionSecret()).update(value).digest('hex').slice(0, 32);
}

@Injectable()
export class AuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 确保 demo 用户存在（种子）。 */
  async ensureDemoUser(): Promise<void> {
    const username = process.env.DEMO_USERNAME ?? 'demo';
    const exists = await this.prisma.user.findUnique({ where: { username } });
    if (!exists) {
      await this.prisma.user.create({
        data: { username, passwordHash: hashPassword(process.env.DEMO_PASSWORD ?? 'demo123') },
      });
    }
  }

  async login(username: string, password: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user || !verifyPassword(password, user.passwordHash)) return null;
    const session = await this.prisma.session.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });
    return `${session.id}.${sign(session.id)}`;
  }

  async resolveSession(cookie: string | undefined): Promise<{ userId: string; username: string } | null> {
    if (!cookie) return null;
    const [sessionId, mac] = cookie.split('.');
    if (!sessionId || !mac || sign(sessionId) !== mac) return null;
    const session = await this.prisma.session.findUnique({ where: { id: sessionId }, include: { user: true } });
    if (!session || session.expiresAt.getTime() < Date.now()) return null;
    return { userId: session.user.id, username: session.user.username };
  }

  async logout(cookie: string | undefined): Promise<void> {
    if (!cookie) return;
    const [sessionId] = cookie.split('.');
    if (sessionId) await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  setCookie(res: Response, value: string): void {
    res.cookie(SESSION_COOKIE, value, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_MS,
    });
  }
}

export interface AuthedRequest extends Request {
  user?: { userId: string; username: string };
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    const path = req.path;
    if (path === '/api/auth/login' || path === '/api/health') return true;
    const user = await this.auth.resolveSession(req.cookies?.[SESSION_COOKIE]);
    if (!user) {
      res.status(401).json({ code: 'UNAUTHORIZED', message: '请先登录 Demo 账号' });
      return false;
    }
    req.user = user;
    return true;
  }
}
