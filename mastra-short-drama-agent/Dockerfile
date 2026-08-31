# ── 构建阶段：前端产物 ──
FROM node:22-alpine AS web-build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --no-frozen-lockfile --filter web --filter @short-drama/shared
COPY apps/web apps/web
COPY packages/shared packages/shared
RUN pnpm --filter web build

# ── 运行阶段：API + Worker 同镜像 ──
FROM node:22-alpine
WORKDIR /app
RUN corepack enable && apk add --no-cache libc6-compat openssl
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --no-frozen-lockfile --filter server --filter @short-drama/shared
# prisma client 生成（schema 先行，源码后拷）
COPY apps/server/prisma apps/server/prisma
RUN pnpm --filter server exec prisma generate --schema prisma/schema.prisma
COPY apps/server apps/server
COPY packages/shared packages/shared
COPY --from=web-build /app/apps/web/dist apps/web/dist
ENV NODE_ENV=production DATABASE_URL=postgresql://short_drama:short_drama@postgres:5432/short_drama
EXPOSE 4120
CMD ["pnpm", "--filter", "server", "exec", "tsx", "src/nest/main.ts"]
