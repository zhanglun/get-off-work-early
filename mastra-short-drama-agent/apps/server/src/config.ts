import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

export type RuntimeRole = 'api' | 'worker';

export function loadEnvironment(): void {
  const environment = process.env.APP_ENV ?? 'local';
  const candidates = [
    resolve(process.cwd(), 'config', `.env.${environment}`),
    resolve(process.cwd(), 'config', `.${environment}.env`),
    resolve(process.cwd(), '..', '..', 'config', `.env.${environment}`),
    resolve(process.cwd(), '..', '..', 'config', `.${environment}.env`),
  ];
  const file = candidates.find((candidate) => existsSync(candidate));
  if (file) loadDotenv({ path: file, override: false });
}

export function requireRuntimeConfig(role: RuntimeRole): void {
  const required = ['DATABASE_URL', 'REDIS_URL', 'MODEL_BASE_URL', 'MODEL_API_KEY', 'MODEL_NAME'];
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length) {
    const environment = process.env.APP_ENV ?? 'local';
    throw new Error(`[config] ${role} 启动失败：缺少 ${missing.join('、')}。请配置 config/.env.${environment}。真实模型模式不支持降级。`);
  }
}

