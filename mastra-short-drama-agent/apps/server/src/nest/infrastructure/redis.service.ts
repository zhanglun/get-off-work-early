import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly client: RedisClientType;

  constructor() {
    const url = process.env.REDIS_URL?.trim();
    if (!url) throw new Error('Redis 未配置：请设置 REDIS_URL');
    this.client = createClient({ url });
    this.client.on('error', (error) => console.error('[redis] client error:', error));
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    await this.client.ping();
    console.log('[redis] connected');
  }

  async publish(channel: string, message: string): Promise<number> {
    return this.client.publish(channel, message);
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) await this.client.quit();
  }
}
