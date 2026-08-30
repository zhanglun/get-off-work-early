import { PostgresStore } from '@mastra/pg';

export const mastraStorage = process.env.STORAGE_MODE === 'postgres'
  ? new PostgresStore({
      id: 'short-drama-mastra-storage',
      connectionString: process.env.DATABASE_URL ?? (() => { throw new Error('STORAGE_MODE=postgres 时必须配置 DATABASE_URL'); })(),
      schemaName: 'mastra_runtime',
    })
  : undefined;
