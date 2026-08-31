# 短剧分镜制作助手

NestJS + React/Vite + PostgreSQL/Prisma + Redis 的真实模型开发 Demo。

当前代码只有真实模型生成路径：

- 未配置完整的 `MODEL_BASE_URL`、`MODEL_API_KEY`、`MODEL_NAME` 时，API/Worker 启动失败；
- 模型请求失败、超时或 Zod 结构化校验失败时，任务显式失败并记录错误；
- 单镜失败不会污染其它镜头，可单独重试；
- 没有伪造模型资产；分镜中的“预览占位帧”只是尚未接入图片/视频生成服务的 UI 占位，不是模型输出。

## 快速开始

要求：Node.js >= 22.13、pnpm 11+、Docker Desktop、可用的 OpenAI 兼容模型接口。

```bash
pnpm install
cp config/.env.local.example config/.env.local
```

编辑 `config/.env.local`：

```env
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_API_KEY=你的Key
MODEL_NAME=你的模型名
```

启动本地 PostgreSQL 和 Redis：

```bash
pnpm infra:up
pnpm db:deploy
```

分别启动三个进程：

```bash
pnpm dev:server   # API http://localhost:4120
pnpm dev:worker   # 异步真实模型任务
pnpm dev:web      # Vite http://localhost:5173
```

浏览器打开 `http://localhost:5173`：

```text
账号：demo
密码：demo123
```

健康检查：

```bash
curl http://localhost:4120/api/health
```

需要完整步骤、环境模板、清库、真实模型冒烟测试和故障排查时，阅读：

```text
docs/本地开发.md
```

## 环境模板

```text
config/.env.local.example       本地开发
config/.env.test.example        测试环境
config/.env.production.example  生产环境
```

真实环境文件不会提交到 Git：

```text
config/.env.local
config/.env.test
config/.env.production
```

测试环境真实模型冒烟：

```bash
APP_ENV=test pnpm --filter server test:real
```

该命令验证 1 集 / 4 镜：

```text
真实 StoryBible → Scene → Shot → Reviewer
```

## 数据库和 Redis

本地端口：

```text
PostgreSQL：localhost:5434
Redis：localhost:6380
```

启动和停止：

```bash
pnpm infra:up
pnpm infra:down
```

清空本地数据库：

```bash
pnpm db:reset-local
pnpm db:deploy
```

清库会删除本地业务数据。不要执行 `docker compose down -v`，除非要删除数据库和 Redis 数据卷。

## 质量检查

```bash
pnpm check
pnpm test
```

Docker 部署仍可用于集成验证，但本地开发推荐使用上面的 API、Worker、Web 三进程模式：

```bash
docker compose up -d postgres redis
```

## 目录

```text
apps/server/                  Nest API、真实模型 Provider、Worker、Prisma
apps/web/                     React/Vite 前端
packages/shared/              跨端 Zod 契约和 DTO
config/                       local/test/production 环境模板
docs/本地开发.md               本地开发与调试说明
docs/architecture.md          技术基线
docs/product-design.md        产品基线
DESIGN.md                     视觉基线
```
