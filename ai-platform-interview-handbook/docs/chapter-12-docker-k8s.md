# 第十二章 Docker & Kubernetes 基础

> 本章覆盖容器化和编排的基础知识。作者的多语言架构（Go 任务中心 / Python 音视频 / NestJS 业务）全部容器化部署，Worker 用 K8s HPA 自动扩缩容。
>
> 面试中 Docker/K8s 是后端必考的基础设施话题。重点不是背概念，而是讲清楚"为什么用、解决什么问题、怎么和架构结合"。本章共 10 题。

---

## Q1. Docker 的核心原理是什么？

**🎤 面试官**

> 我们这边所有服务都跑在容器里——Go 写的任务中心、Python 写的音视频处理、NestJS 写的业务后端。我想先聊聊，Docker 到底解决了什么问题？它内部是怎么把一个进程隔离开的？

**🙋 候选人回答**

先说 Docker 解决的真问题，再讲原理。

**痛点：环境不一致**

我们的架构是三套语言栈：Go 任务中心、Python 音视频处理、NestJS 业务后端。每套语言有自己的运行时、依赖（Python 的 ffmpeg、Node 的 node_modules、Go 的 glibc 版本）、系统库。在裸机上部署有三个经典痛点：

1. **"我机器上能跑"**：开发用 macOS，生产是 Linux。Python 服务依赖 ffmpeg，开发装在 `/usr/local/bin`，生产装在 `/usr/bin`——路径不同，代码里写死的路径在生产崩。
2. **依赖互相污染**：Python 服务要 Python 3.11，音视频处理脚本要 Python 3.9。装在同一台机器上，pyenv 切来切去，新人配置环境一天就过去了。
3. **部署不可复现**：运维手动在生产装依赖，今天装的版本和明天装的版本可能不同（pip 装的某个包升级了），导致"昨天能跑今天崩"。

Docker 把"应用 + 它的所有依赖 + 运行时"打成一个镜像（Image）。镜像是个不可变的快照——同一个镜像在任何机器上跑出来的环境都一样。这是**环境一致性**的核心。

**Docker 的核心三件：镜像、容器、引擎**

```
镜像（Image）：只读模板，包含应用代码 + 运行时 + 依赖 + 系统库
   ↓ docker run
容器（Container）：镜像的运行实例，隔离的进程
   ↑
引擎（Docker Engine）：daemon 进程，负责构建/运行/分发镜像
```

- **镜像**是"类"，**容器**是"实例"。一个镜像可以起多个容器。
- 镜像是**分层**的（Layered）——每条 Dockerfile 指令产生一层，层可以被多个镜像复用（比如都基于 `node:20`）。

**隔离机制：namespace + cgroups**

容器不是虚拟机。虚拟机是"完整的操作系统虚拟化"（每个 VM 有自己的内核），容器是"进程级隔离"——容器内的进程就是宿主机上的一个普通进程，只是它"看不见"外面的世界。靠两个 Linux 内核机制：

**① namespace：隔离"能看见什么"**

| namespace | 隔离的内容 | 效果 |
|-----------|-----------|------|
| PID | 进程 ID | 容器里看到自己的 PID 1，看不到宿主机进程 |
| NET | 网络栈 | 容器有自己的网卡、IP、端口 |
| MNT | 挂载点 | 容器有自己的文件系统视图 |
| UTS | hostname | 容器有自己的 hostname |
| IPC | 信号量/消息队列 | 进程间通信隔离 |
| USER | 用户 ID | 容器里的 root 可能是宿主机的普通用户 |
| Cgroup | cgroup 视图 | 容器只看到自己的资源限制 |

**② cgroups：限制"能用多少资源"**

cgroups（Control Groups）限制容器能用的 CPU、内存、磁盘 I/O、网络带宽。

```bash
# 限制容器最多用 2 核 CPU、4G 内存
docker run --cpus="2" --memory="4g" my-image
```

namespace 管"隔离"，cgroups 管"限制"。两者结合，容器里的进程既能独立运行（不互相干扰），又能被资源约束（不会吃光宿主机资源）。

**对比虚拟机**：

| 维度 | 虚拟机（VM） | 容器（Container） |
|------|-------------|------------------|
| 隔离级别 | 硬件级（hypervisor） | 操作系统级（namespace+cgroups） |
| 有无内核 | 每个 VM 有自己的内核 | 共享宿主机内核 |
| 启动时间 | 分钟级（启动整个 OS） | 秒级（启动进程） |
| 资源开销 | 大（每个 VM 要分配完整内存） | 小（共享内核，只占进程开销） |
| 隔离强度 | 强（逃逸极难） | 弱（内核漏洞可能逃逸） |

我们的服务都是内部业务，不跑不可信代码，容器的隔离强度足够。VM 留给需要强隔离的场景（比如多租户云平台跑用户代码）。

---

**🎤 面试官追问**

> 你说容器共享宿主机内核。那如果 Python 服务要 glibc 2.35 但宿主机是 glibc 2.31，容器里能跑吗？

**🙋 候选人回答**

能跑，因为容器**自带 glibc**。

容器镜像里有完整的用户态库——glibc、libssl、libffmpeg 都在镜像里。容器启动时，这些库是从镜像的文件系统加载的（通过 MNT namespace 挂载镜像的 rootfs），不是用宿主机的。

**但有一个边界：内核**。容器不自带内核，用的是宿主机的内核。所以：

- **用户态库**（glibc、libc、动态链接库）：镜像里自带，和宿主机无关。Python 服务要 glibc 2.35，镜像里打包了 2.35，在 glibc 2.31 的宿主机上也能跑。
- **内核特性**（系统调用、内核模块）：必须和宿主机内核兼容。比如容器里用了一个新内核才有的 syscall，宿主机内核版本太低就调不通。

实际遇到的坑：我们有个 Python 服务依赖 `io_uring`（Linux 5.1+ 的异步 I/O），镜像构建没问题，但跑在内核 4.19 的宿主机上直接报错——因为这是内核特性不是用户态库。后来把宿主机内核升级到 5.10 才解决。

**所以"共享内核"的真正含义是：用户态可以随便换，内核必须是宿主机的。** 这也是容器比 VM 轻的原因——不用带内核，但代价是内核绑死宿主机。

---

**🎤 面试官继续追问**

> 既然容器的隔离不如 VM 强，你们跑 Worker 的时候，如果一个 Worker 进程内存泄漏了，会不会影响同机器的其他容器？

**🙋 候选人回答**

会，如果不设内存限制。这正是 cgroups 的价值。

**内存泄漏的影响链**：

1. Worker 进程内存泄漏 → 占的内存越来越大。
2. 如果没设内存限制，Worker 会吃光宿主机内存。
3. 宿主机触发 OOM Killer（Linux 的 Out-Of-Memory 机制），内核杀掉某个进程释放内存。
4. OOM Killer 可能杀的不是泄漏的 Worker，而是同机器的其他容器（比如 NestJS 业务服务）——**雪崩**。

**我们的防护：每个容器都设内存限制 + OOM 优先级。**

```yaml
# K8s Pod 的资源限制
resources:
  limits:
    memory: "2Gi"        # 硬上限，超过被 OOMKill
  requests:
    memory: "1Gi"        # 调度时的保证值
```

- Worker 容器内存泄漏到 2Gi，cgroups 直接把它 OOMKill（杀的是泄漏的 Worker 自己，不是别的容器）。
- K8s 检测到 Pod 被 OOMKill，会重启它（Pod 的 restartPolicy 默认 Always）。
- 其他容器不受影响，因为 cgroups 的内存限制是隔离的。

**OOM 优先级（oom_score_adj）**：可以告诉内核"OOM 时优先杀谁"。我们不依赖这个，而是让每个容器都有内存上限——自己的锅自己背，不连累别人。

**这是容器化部署的标配**：不设资源限制的容器是定时炸弹。我们在 K8s 里强制要求每个 Pod 都有 resources.limits，没设置的 Deployment 会被 Admission Controller 拒绝（通过 OPA/Kyverno 策略）。

### 🏗 架构分析

**为什么选容器而不是 VM 或裸机**

| 方案 | 环境一致性 | 启动速度 | 资源利用率 | 隔离强度 |
|------|-----------|---------|-----------|---------|
| 裸机部署 | 差（手动配环境） | 慢 | 高 | - |
| 虚拟机（VM） | 好（镜像） | 分钟级 | 低（每个 VM 胖） | 强 |
| 容器 | 好（镜像） | 秒级 | 高（共享内核） | 中 |

**选容器的原因**：多语言架构（Go/Python/Node）需要环境隔离但又不需要强隔离，容器在"一致性 + 轻量"上最优。

**隔离的边界**：namespace（隔离视图）+ cgroups（限制资源）+ 共享内核（省内存但绑死内核版本）。

**演进路径**：单机 Docker → 多机 Docker Compose → K8s 集群编排。规模小时 Compose 够用，规模大或需要自动扩缩容时上 K8s。

### 🎯 面试官真正考察什么

1. **痛点的真实性**：能不能说出"多语言栈环境不一致"的具体场景？还是只会背"Docker 是轻量级虚拟化"？
2. **隔离机制的理解**：namespace 和 cgroups 各管什么？共享内核意味着什么？
3. **生产意识**：内存泄漏会不会影响其他容器？知道设内存限制 + OOMKill 隔离爆炸半径。

### ❌ 常见错误回答

- **"Docker 是轻量级虚拟机"**：错。容器没有自己的内核，不是虚拟机。
- **不知道 namespace/cgroups**：只会说"隔离"，说不清隔离机制。
- **不设资源限制**："容器自己管自己。"——内存泄漏直接拖垮整机。

### ✅ 推荐回答

> Docker 解决环境不一致——Go/Python/NestJS 三套语言栈各自打包运行时和依赖成镜像，同一镜像在任何机器环境一致。容器不是 VM，是进程级隔离：namespace 隔离"能看见什么"（PID/NET/MNT/UTS/IPC/USER，容器里 PID 1 看不到宿主进程），cgroups 限制"能用多少资源"（CPU/内存/IO）。容器共享宿主机内核（所以轻、启动秒级），用户态库自带（glibc 跟镜像走），但内核特性绑死宿主机（遇到 io_uring 这种新内核 syscall 老内核跑不了）。生产防护：每个容器必须设 resources.limits，内存泄漏被 cgroups OOMKill 只死自己不连累同机容器，K8s 自动重启被 Kill 的 Pod。

### 📚 延伸知识

- **OCI 标准**：Open Container Initiative。规定了镜像格式（image spec）和运行时（runtime spec，runc 是参考实现）。Docker、containerd、CRI-O 都遵循 OCI，所以镜像通用。
- **rootless container**：以非 root 用户运行容器（USER namespace 映射），提升安全性。Docker 和 Podman 都支持。
- **gVisor / Kata Containers**：容器和 VM 之间的中间态。gVisor 用用户态内核拦截 syscall，Kata 每个容器起一个轻量 VM。需要强隔离时用。

---

## Q2. Dockerfile 怎么写才好？

**🎤 面试官**

> 我们这边每个服务都有 Dockerfile，但质量参差不齐。有的镜像 2G，有的构建一次要 10 分钟。Dockerfile 怎么写才算"好"？

**🙋 候选人回答**

好的 Dockerfile 三个目标：**镜像小、构建快、安全**。分别讲怎么做到。

**① 镜像小：多阶段构建（Multi-stage Build）**

最典型的场景是 Go 服务。Go 编译后是一个静态二进制，但如果你直接用 `golang` 镜像跑，镜像里有整个 Go 工具链（几百 MB）——根本不需要。

**反面教材**：

```dockerfile
# 坏例子：镜像 800MB+
FROM golang:1.22
WORKDIR /app
COPY . .
RUN go build -o task-center ./cmd/server
CMD ["./task-center"]
```

最终镜像包含了整个 Go 工具链、源码、编译产物——但运行时只需要那个二进制。

**多阶段构建**：

```dockerfile
# 阶段一：构建（用大的 golang 镜像编译）
FROM golang:1.22 AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download          # 先下依赖
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o task-center ./cmd/server

# 阶段二：运行（用极小的 alpine 或 distroless）
FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
COPY --from=builder /app/task-center /usr/local/bin/
CMD ["task-center"]
```

- 构建阶段用 `golang:1.22`（带工具链，几百 MB）。
- 运行阶段只把编译出的二进制 COPY 过来，用 `alpine`（5MB）或 `gcr.io/distroless/static`（2MB）。
- 最终镜像从 800MB 降到 20MB。

**各语言的最佳实践**：

| 语言 | 多阶段做法 | 运行镜像 |
|------|-----------|---------|
| Go | 编译出静态二进制 | alpine / distroless |
| Python | 不需要编译阶段，但可以多阶段分离依赖安装 | python:slim |
| Node | 用多阶段把 devDependencies 排除掉 | node:alpine |

**Python 服务的例子**（我们的音视频处理）：

```dockerfile
FROM python:3.11-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

FROM base AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --user --no-cache-dir -r requirements.txt

FROM base AS runtime
WORKDIR /app
COPY --from=builder /root/.local /root/.local
COPY . .
ENV PATH=/root/.local/bin:$PATH
CMD ["python", "-m", "media_service"]
```

ffmpeg 装在 base 阶段，依赖装在 builder 阶段，最终镜像只有代码 + 依赖 + ffmpeg，没有 pip 缓存。

**② 构建快：缓存层优化**

Docker 构建是**逐层缓存**的——每条指令产生一层，如果某层的输入没变，就用缓存。**但缓存是顺序失效的**：一旦某层失效，它后面的所有层都重建。

所以原则是：**把"变化频率低的"放前面，"变化频率高的"放后面。**

```dockerfile
# 坏例子：COPY . . 在最前面，改一行代码依赖全重装
COPY . .
RUN pip install -r requirements.txt

# 好例子：先 COPY 依赖文件，再装依赖，最后 COPY 代码
COPY requirements.txt .       # 只有 requirements.txt 变了才重装依赖
RUN pip install -r requirements.txt
COPY . .                      # 改代码只重建这一层和后面
```

代码天天变，依赖列表（requirements.txt / package.json / go.mod）很少变。先 COPY 依赖文件 + 装依赖（缓存命中），再 COPY 代码（变化）。改代码时，依赖安装的缓存还在，构建快几倍。

**NestJS 服务的例子**：

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
CMD ["node", "dist/main.js"]
```

**③ 安全：最小权限 + 最小镜像**

- **非 root 运行**：镜像里建个普通用户，用 USER 指令切换。
- **最小镜像**：alpine 或 distroless，不带 shell，攻击面小。
- **不把密钥打进镜像**：API Key、DB 密码用运行时注入（K8s Secret / 环境变量），绝不写进 Dockerfile。

```dockerfile
# distroless 镜像没有 shell，没有包管理器，攻击面极小
FROM gcr.io/distroless/static-debian12
COPY --from=builder /app/task-center /
USER nonroot                  # 非 root 运行
CMD ["/task-center"]
```

---

**🎤 面试官追问**

> .dockerignore 你提了没？很多人忘了这个，结果 node_modules、.git 都打进镜像了。

**🙋 候选人回答**

**必须用 .dockerignore，它是 Dockerfile 的标配。**

没有 .dockerignore，`COPY . .` 会把当前目录所有文件都送进构建上下文（build context）。问题：

1. **镜像变大**：`node_modules`、`.git`、测试文件、IDE 配置全打进去。
2. **构建变慢**：构建上下文要全发给 daemon，几十 MB 的 `.git` 每次构建都传。
3. **缓存失效**：`.git` 里 commit hash 变了，`COPY . .` 这层缓存就失效。

我们的 .dockerignore：

```
# .dockerignore
node_modules
.git
.gitignore
*.md
.vscode
.idea
coverage
dist
build
.env
.env.local
*.log
.DS_Store
```

**关键点：`.env` 一定要忽略**。如果 `.env` 被打进镜像，密钥就泄露了（镜像可能推到 registry，任何能拉镜像的人都能看到）。

**还有一个容易忽略的：构建上下文的体积影响构建速度。** `docker build` 第一步是"sending build context to Docker daemon"——把当前目录打包发给 daemon。如果目录里有个 500MB 的日志文件，每次构建都先传 500MB。.dockerignore 砍掉这些，构建秒开。

---

**🎤 面试官继续追问**

> 你们 Go 服务用 distroless 还是 alpine？怎么选？

**🙋 候选人回答**

**Go 服务用 distroless/static，Python 服务用 debian-slim，NestJS 用 node:alpine。** 不是统一选一个，是按语言特性选。

**Go 服务用 distroless 的原因**：

Go 编译出的是**静态二进制**（CGO_ENABLED=0），不需要任何动态链接库。distroless/static 只有基础文件（ca-certificates、timezone 数据），没有 shell、没有包管理器——镜像 2MB，攻击面极小。

```dockerfile
FROM gcr.io/distroless/static-debian12
COPY --from=builder /app/task-center /
USER nonroot
CMD ["/task-center"]
```

**为什么 Go 不用 alpine**：alpine 用 musl libc 而不是 glibc。如果 Go 用 CGO（比如用了 cgo 依赖 sqlite），在 alpine 上可能跑不起来。我们 Go 服务都 CGO_ENABLED=0，distroless 更纯粹。

**Python 服务用 debian-slim 而不是 alpine**：

这是个反直觉的点。alpine 看着小（5MB），但 **Python 在 alpine 上反而更慢更大**：

1. Python 的很多包（numpy、pandas、opencv）在 alpine 上没有预编译 wheel，要从源码编译——构建慢。
2. 编译时需要装 build-base、gcc、musl-dev，构建阶段镜像反而大。
3. musl libc 和 glibc 的性能差异，某些场景 Python 在 alpine 上慢 20%。

debian-slim 虽然基础镜像大些（80MB），但 Python 包有预编译 wheel，装得快、跑得快。对 Python 来说 debian-slim 是更务实的选择。

**NestJS 用 node:alpine**：Node 的 npm 包大多是纯 JS，alpine 上没有编译问题。Node 服务镜像通常几百 MB（node_modules 大），基础镜像的 5MB vs 80MB 差异不显著，alpine 更省。

**选型原则**：不要无脑 alpine。看语言生态对 musl libc 的支持程度。Go 静态二进制 → distroless；Python/有 C 扩展 → debian-slim；纯 JS → alpine。

### 🏗 架构分析

**Dockerfile 优化三维度**

| 维度 | 手段 | 效果 |
|------|------|------|
| 镜像小 | 多阶段构建 + distroless/alpine/slim | Go 服务 800MB→20MB |
| 构建快 | 缓存层优化（依赖文件先 COPY）+ .dockerignore | 改代码不重装依赖 |
| 安全 | 非 root + 最小镜像 + 不打密钥 | 攻击面最小化 |

**多阶段构建是核心**：构建环境（带编译器、工具链）和运行环境（最小化）分离。构建阶段的"重"不污染运行阶段的"轻"。

**基础镜像选型**：不是统一选一个，是按语言特性选（Go→distroless，Python→debian-slim，Node→alpine）。

### 🎯 面试官真正考察什么

1. **多阶段构建**：知不知道编译型和解释型语言分别怎么做多阶段？能不能给出 Go 的具体例子？
2. **缓存层理解**：能不能解释"为什么依赖文件要先 COPY"？知不知道缓存是顺序失效的？
3. **务实选型**：Python 该用 alpine 还是 debian-slim？知不知道 alpine 在 Python 上的坑？

### ❌ 常见错误回答

- **"用 latest tag"**：`FROM node:latest`——不可复现，哪天 latest 升级了构建就崩。
- **不分阶段**：一个 FROM 到底，镜像巨大。
- **COPY . . 然后 RUN pip install**：缓存顺序错，改代码就重装依赖。
- **Python 用 alpine**：不评估 musl libc 的坑。

### ✅ 推荐回答

> Dockerfile 三个目标：小、快、安全。小靠多阶段构建——Go 服务用 golang 镜像编译出静态二进制（CGO_ENABLED=0），运行阶段 COPY 到 distroless/static（2MB），整体从 800MB 降到 20MB。Python 分 base（装 ffmpeg）+ builder（装依赖）+ runtime 三阶段，去掉 pip 缓存。快靠缓存层优化——把变化频率低的放前面（COPY requirements.txt + pip install），变化频率高的放后面（COPY 代码），改代码不重装依赖；配 .dockerignore 排除 node_modules/.git/.env（防密钥泄露）。安全靠非 root（USER nonroot）+ 最小镜像。基础镜像按语言选：Go→distroless（静态二进制不需要 libc）、Python→debian-slim（alpine 上 Python 包要源码编译且 musl 慢 20%）、Node→alpine（纯 JS 无编译问题）。

### 📚 延伸知识

- **BuildKit**：Docker 的新一代构建引擎。支持并行构建多阶段、`--mount=type=cache` 持久化缓存（pip/npm 缓存跨构建复用）。`DOCKER_BUILDKIT=1` 开启。
- **镜像扫描**：Trivy、Snyk、Grype 扫描镜像里的 CVE 漏洞。我们 CI 里每次构建都扫，有高危 CVE 拒绝部署。
- **distroless**：Google 维护的最小镜像系列。有 static（无 libc）、base（有 glibc 和几个核心库）、nodejs（带 Node 运行时）等变体。

---

## Q3. Docker 的网络模型

**🎤 面试官**

> 容器之间要通信——比如 Go 任务中心要调 Python 音视频服务。Docker 的网络模型是怎么设计的？

**🙋 候选人回答**

Docker 有四种网络驱动（driver），对应不同场景。

**① bridge（默认）：容器间的虚拟网桥**

最常用。Docker 装好后有个默认的 `docker0` 网桥（Linux bridge）。每个容器分一个虚拟网卡（veth pair），一头在容器的 network namespace 里，一头插在 docker0 上。

```
┌─────────────────────────────────────────────┐
│  宿主机                                       │
│                                              │
│  ┌─────────┐   ┌─────────┐                   │
│  │容器 A   │   │容器 B   │                   │
│  │Go 服务  │   │Python   │                   │
│  │172.17.0.2   │172.17.0.3               │   │
│  └────┬────┘   └────┬────┘                   │
│       │veth        │veth                     │
│       └─────┬──────┘                         │
│             │                                │
│       ┌─────▼─────┐                          │
│       │ docker0   │  172.17.0.1              │
│       │ (bridge)  │                          │
│       └─────┬─────┘                          │
│             │                                │
│       ┌─────▼─────┐                          │
│       │  eth0     │  宿主机网卡               │
│       │  外网 IP  │                          │
│       └───────────┘                          │
└─────────────────────────────────────────────┘
```

容器 A（172.17.0.2）访问容器 B（172.17.0.3），走 docker0 转发。容器要访问外网，docker0 做 NAT（SNAT），把容器 IP 换成宿主机 IP 出去。

**默认 bridge 的问题**：容器之间要用 IP 通信，没有 DNS。容器重建后 IP 变了，配置就失效。

**自定义 bridge 解决这个问题**：

```bash
docker network create my-net
docker run --network my-net --name go-service ...
docker run --network my-net --name python-service ...
```

自定义 bridge 自带 DNS——`go-service` 这个容器名可以直接当主机名解析。Go 服务里配置 `http://python-service:8000`，不用记 IP。

**② host：直接用宿主机网络**

容器不做网络隔离，直接用宿主机的网卡和端口。性能最好（没有 NAT 开销），但没有隔离——容器的端口和宿主机端口冲突。

```bash
docker run --network host nginx
# nginx 直接监听宿主机的 80 端口
```

我们基本不用 host 模式（除非对网络性能极致敏感，比如一些网络密集型服务）。隔离丧失了容器化的好处。

**③ none：无网络**

容器完全没有网络栈。用于不需要联网的计算任务（比如纯离线的数据处理）。

**④ overlay：跨主机的容器网络**

多台宿主机上的容器要通信，bridge 不够（bridge 只在一台机器内）。overlay 在多台机器的容器间建虚拟网络，用 VXLAN 隧道。

**但我们生产不用 overlay，用 K8s 的网络模型（CNI）**——overlay 是 Docker Swarm 的方案，K8s 有自己的网络插件（Calico/Flannel/Cilium），底层也是隧道或 BGP 路由，但管理是 K8s 统一的。

**端口映射（-p）**

bridge 网络下，容器有自己的端口空间（容器里的 8080 和宿主机的 8080 不冲突）。外部要访问容器，要映射端口：

```bash
docker run -p 8080:8080 go-service
# 宿主机 8080 → 容器 8080
```

```
外部请求 → 宿主机:8080 → (DNAT) → 容器:8080
```

---

**🎤 面试官追问**

> 你们本地开发用 docker compose 起 Go、Python、NestJS、Redis、Postgres。这些容器之间怎么通信？是不是就用你说的自定义 bridge？

**🙋 候选人回答**

对，docker compose 自动创建一个自定义 bridge 网络，所有服务都在这个网络里，服务名就是 DNS 名。

```yaml
# docker-compose.yml
services:
  go-task-center:
    build: ./go-task-center
    ports:
      - "8080:8080"
    environment:
      - PYTHON_SERVICE_URL=http://python-media:8000   # 用服务名
      - REDIS_URL=redis://redis:6379                  # 用服务名
      - DATABASE_URL=postgres://postgres:5432/db      # 用服务名
  
  python-media:
    build: ./python-media
    ports:
      - "8000:8000"
  
  nestjs-api:
    build: ./nestjs-api
    ports:
      - "3000:3000"
  
  redis:
    image: redis:7-alpine
  
  postgres:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

**compose 的网络魔法**：

1. compose 自动建一个网络（默认叫 `<项目名>_default`）。
2. 每个 service 自动加入这个网络，**服务名（service name）就是 DNS 名**。
3. Go 服务配 `http://python-media:8000`，compose 内置的 DNS 把 `python-media` 解析到 Python 容器的 IP。

**这比手动写 `--network` 方便太多**——一条 `docker compose up`，五个服务全起来，互相能用名字通信。本地开发的标配。

**depends_on 控制启动顺序**：

```yaml
go-task-center:
  depends_on:
    - redis
    - postgres
```

但这只控制"启动顺序"，不控制"就绪顺序"。redis 容器启动了但还没接受连接，Go 服务连上去会失败。要用 `healthcheck` + `depends_on.condition: service_healthy` 解决。

---

**🎤 面试官继续追问**

> 生产环境你们不用 docker compose，用 K8s。那容器间网络是 K8s 管的还是 Docker 的？

**🙋 候选人回答**

K8s 管。K8s 有自己的网络模型，不用 Docker 的 bridge。

**K8s 网络模型的核心原则**：

1. **每个 Pod 有自己的 IP**（不是每个容器）。
2. **Pod 之间直接通信，不用 NAT**（Pod IP 在集群内可达）。
3. **Pod 访问节点也不 NAT，节点访问 Pod 也不 NAT**。

这和 Docker 的 bridge 不一样——Docker 默认要 NAT，K8s 不要。

**实现这个模型靠 CNI 插件**（Container Network Interface）：

| CNI 插件 | 原理 | 特点 |
|---------|------|------|
| Flannel | VXLAN 隧道 | 简单，默认选择 |
| Calico | BGP 路由 | 性能好，支持网络策略 |
| Cilium | eBPF | 最新，高性能，可观测性好 |

我们用 Calico。它用 BGP（边界网关协议）让各节点交换 Pod IP 的路由信息，Pod 之间直接路由，没有隧道开销。还支持 NetworkPolicy（限制哪些 Pod 能访问哪些 Pod，比如只许 Go 服务访问 Python 服务）。

**从 Docker 到 K8s 的网络变化**：

| 维度 | Docker Compose | K8s |
|------|----------------|-----|
| 网络隔离 | 自定义 bridge | CNI 插件（Calico/Flannel） |
| 服务发现 | 服务名 DNS（compose 内置） | Service（ClusterIP + DNS） |
| 跨机通信 | 不支持（compose 单机） | CNI 跨节点路由 |
| 负载均衡 | 没有 | Service 自动负载均衡到多个 Pod |

**所以生产用 K8s 不是因为 Docker 网络不好，是因为生产需要多机、自动扩缩容、负载均衡——这些 Docker 本身没有。** Docker 网络解决单机容器通信，K8s 网络解决集群级容器通信。

### 🏗 架构分析

**Docker 网络驱动对比**

| 驱动 | 场景 | 隔离 | 跨机 | 性能 |
|------|------|------|------|------|
| bridge | 默认，容器间通信 | 有 | 否 | 中（NAT 开销） |
| host | 网络性能敏感 | 无 | 否 | 高（无 NAT） |
| none | 离线计算 | 完全 | 否 | - |
| overlay | Docker Swarm 跨机 | 有 | 是 | 中低（VXLAN） |

**选 bridge（自定义）的原因**：默认 bridge 没 DNS，自定义 bridge 有 DNS，服务名直接解析。docker compose 自动建自定义 bridge。

**生产为什么换 K8s 网络**：Docker 网络是单机的，生产要多机。K8s 的 CNI（Calico/Flannel）提供跨节点 Pod 通信 + Service 服务发现 + 负载均衡。

### 🎯 面试官真正考察什么

1. **四种网络驱动**：bridge/host/none/overlay 各是什么？默认是哪个？
2. **服务发现**：自定义 bridge 为什么比默认 bridge 好？（DNS）compose 怎么自动实现服务发现？
3. **Docker 和 K8s 网络的区别**：知道 Docker 是单机网络，K8s 用 CNI 解决跨机通信。

### ❌ 常见错误回答

- **"容器之间用 IP 通信"**：默认 bridge 才这样，自定义 bridge 有 DNS。
- **不知道 compose 自动建网络**：以为要手动配。
- **把 overlay 当生产方案**：overlay 是 Swarm 的，生产用 K8s CNI。

### ✅ 推荐回答

> Docker 四种网络：bridge（默认，容器间通过 docker0 网桥+NAT 通信）、host（直接用宿主机网络，无隔离性能好）、none（无网络）、overlay（跨机容器通信，Swarm 方案）。默认 bridge 没 DNS 要用 IP，自定义 bridge（docker network create）自带 DNS，服务名直接解析。本地 docker compose 自动建自定义 bridge——五个服务（Go/Python/NestJS/Redis/Postgres）起来后用服务名通信，Go 配 REDIS_URL=redis://redis:6379。生产不用 Docker 网络用 K8s CNI（Calico/Flannel/Cilium）——Docker 网络单机，K8s 要跨节点 Pod 通信+Service 服务发现+负载均衡。K8s 网络原则：每 Pod 一个 IP、Pod 间通信不 NAT。我们用 Calico（BGP 路由无隧道开销 + NetworkPolicy 限制 Pod 间访问）。

### 📚 延伸知识

- **veth pair**：虚拟以太网设备对。Docker 网络的底层——一头在容器 namespace，一头在宿主机，数据从一端进另一端出。
- **NetworkPolicy**：K8s 的网络策略，类似云平台的安全组。可以限制"只有带 label app=go-task 的 Pod 能访问 app=python-media 的 Pod"。
- **Service Mesh**：Istio/Linkerd。在 Pod 间加一层 sidecar 代理，实现精细的流量管理（金丝雀、熔断、可观测）。比 NetworkPolicy 更上层。

---

## Q4. Docker 的数据持久化

**🎤 面试官**

> 容器是"临时的"——删了重建，里面的数据就没了。但像 Redis、Postgres 这种服务，数据不能丢。你们怎么处理持久化？

**🙋 候选人回答**

容器默认的文件系统是临时的——基于镜像的只读层 + 一个可写层（container layer）。容器删除时，可写层一起没了。数据持久化要用 **Volume** 或 **Bind Mount**，把数据放容器外面。

**Docker 的三种挂载方式**：

```
┌────────────────────────────────────────────────────┐
│  容器                                              │
│  ┌────────────────────────────────┐                │
│  │  /app/data  ←── 挂载点          │                │
│  │  （容器内路径）                  │                │
│  └─────────────┬──────────────────┘                │
│                │                                    │
└────────────────┼───────────────────────────────────┘
                 │
    ┌────────────┼────────────┬─────────────┐
    │            │            │             │
┌───▼───┐  ┌────▼────┐  ┌────▼─────┐  ┌────▼─────┐
│ Volume │  │Bind Mount│  │  tmpfs   │  │镜像只读层 │
│(Docker │  │(宿主机目录)│ │(内存)    │  │          │
│ 管理)  │  │           │ │          │  │          │
└────────┘  └───────────┘ └──────────┘  └──────────┘
```

**① Volume（卷）：Docker 管理的持久化**

```bash
docker volume create pgdata
docker run -v pgdata:/var/lib/postgresql/data postgres
```

- Docker 创建一个卷（存在宿主机 `/var/lib/docker/volumes/`），挂载到容器里。
- **Docker 管理生命周期**——容器删了卷还在，新容器挂上卷数据就回来了。
- **跨平台一致**——Windows/Mac/Linux 上行为一致。
- **可以共享**——多个容器挂同一个卷。

**生产数据（数据库、Redis）用 Volume**。

**② Bind Mount（绑定挂载）：直接挂宿主机目录**

```bash
docker run -v /host/path:/container/path my-image
# 或 docker run --mount type=bind,source=/host/path,target=/container/path
```

- 直接把宿主机的某个目录挂到容器里。
- **宿主机目录的真实路径**——你在宿主机能看到和改这些文件。
- **依赖宿主机结构**——Windows 上挂 `/home/user` 这种路径没意义。

**用途**：开发时把代码目录挂进容器，改代码容器里立即生效（热重载）。

```yaml
# docker-compose.yml 开发用 bind mount
services:
  nestjs-api:
    volumes:
      - ./src:/app/src      # 改宿主机代码，容器里立即生效
      - /app/node_modules   # 注意：容器内的 node_modules 不被覆盖
```

**③ tmpfs：挂内存**

```bash
docker run --tmpfs /tmp my-image
```

- 挂载在内存里，不写磁盘。
- 用于临时敏感数据（不想写磁盘的 token、密钥），容器停了就没了。

**什么时候用哪个？**

| 场景 | 选择 | 理由 |
|------|------|------|
| 数据库数据 | Volume | Docker 管理，生产可靠 |
| 开发热重载 | Bind Mount | 改代码立即生效 |
| 日志（如果不上报） | Volume 或 bind | 要持久化 |
| 临时敏感数据 | tmpfs | 不落盘 |
| 配置文件 | Bind Mount 或 Volume | 看是否跨环境 |

---

**🎤 面试官追问**

> 你们 Redis 用 AOF 持久化，Postgres 存任务元数据。这两个的数据卷在生产是怎么管理的？是 K8s 的什么机制？

**🙋 候选人回答**

生产用 K8s 的 **PersistentVolume（PV）+ PersistentVolumeClaim（PVC）**，不是 Docker 的 volume。

**K8s 持久化体系**：

```
PersistentVolume (PV)        ← 集群里的存储资源（运维创建）
    ↑ 绑定
PersistentVolumeClaim (PVC)  ← 用户的存储申请（开发者创建）
    ↑ 挂载到
Pod                          ← 容器运行的地方
```

- **PV**：集群里的实际存储（可以是云盘、NFS、本地盘）。运维或 StorageClass 自动创建。
- **PVC**：开发者声明"我要 10Gi 的存储"，K8s 自动找个合适的 PV 绑定。
- **Pod**：通过 PVC 把存储挂进容器。

**Postgres 的例子**：

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
spec:
  serviceName: postgres
  replicas: 1
  template:
    spec:
      containers:
        - name: postgres
          image: postgres:16
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:        # StatefulSet 自动给每个 Pod 创建 PVC
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 50Gi
```

**关键点：有状态服务用 StatefulSet 而不是 Deployment**。

- **Deployment**：Pod 是无状态的、可互换的。Pod 挂了换一个，数据不保留。
- **StatefulSet**：每个 Pod 有稳定的身份（postgres-0、postgres-1）和稳定的存储（每个 Pod 绑定自己的 PVC）。Pod 重建后挂的还是同一个 PV，数据不丢。

**Redis 和 Postgres 都用 StatefulSet**。Worker（无状态）用 Deployment。

---

**🎤 面试官继续追问**

> 你说有状态用 StatefulSet 无状态用 Deployment。那 Worker 的日志呢？Worker 跑任务时输出的日志，是不是也算"状态"？要不要持久化？

**🙋 候选人回答**

**日志不通过卷持久化，通过 stdout/stderr + 日志采集系统。**

这是容器化部署的一个最佳实践：**容器里只输出日志到 stdout/stderr，不写文件**。

**为什么？**

1. **容器是临时的**：Pod 重建了，容器里的文件没了。日志写文件，要持久化得挂卷——每个 Pod 挂卷管理复杂。
2. **采集不方便**：日志在文件里，采集器（Fluentd/Filebeat）要进容器读文件——部署复杂。
3. **K8s 已收集 stdout/stderr**：K8s 自动把容器的 stdout/stderr 收集到节点的 `/var/log/containers/`，采集器在节点上读这些文件就行。

**我们的日志架构**：

```
容器（Worker）──stdout/stderr──→ 节点 /var/log/containers/
                                    │
                                    │ Fluentd（DaemonSet，每节点一个）
                                    ▼
                                  Kafka（缓冲，扛峰值）
                                    │
                                    ▼
                              Elasticsearch（存储+检索）
                                    │
                                    ▼
                                  Kibana（可视化）
```

- Worker 日志用统一 Logger（第十章讲过）输出 JSON 到 stdout。
- Fluentd 作为 DaemonSet（每个节点一个 Pod）采集节点上的容器日志。
- 日志进 Kafka 缓冲，再进 ES，Kibana 查。

**Worker 不需要挂卷存日志**——日志的"持久化"由日志系统（ES）负责，不是容器的职责。

**这是关注点分离**：容器负责"产生日志"，日志系统负责"持久化和检索"。容器不该关心日志存哪、怎么检索。

**特殊情况**：有些服务必须写文件（比如音视频处理服务输出 mp4 文件）。这种"产物"用临时卷或对象存储（S3/MinIO），不挂持久卷——处理完上传到 S3，本地文件就删了。

### 🏗 架构分析

**Docker 持久化方案对比**

| 方案 | 管理 | 跨平台 | 共享 | 场景 |
|------|------|--------|------|------|
| Volume | Docker | 一致 | 可共享 | 生产数据 |
| Bind Mount | 宿主机 | 依赖宿主机 | 可共享 | 开发热重载 |
| tmpfs | 内存 | - | 不可共享 | 临时敏感数据 |

**K8s 持久化体系**：PV（存储资源）+ PVC（申请）+ StorageClass（动态创建 PV）。有状态服务用 StatefulSet（每 Pod 独立 PVC），无状态用 Deployment（不要持久存储）。

**日志的特殊处理**：容器不写文件，输出 stdout/stderr，由 Fluentd/Filebeat（DaemonSet）采集到 ES。容器和日志系统关注点分离。

### 🎯 面试官真正考察什么

1. **三种挂载的区别**：Volume/Bind Mount/tmpfs 各是什么？什么时候用哪个？
2. **K8s 持久化体系**：PV/PVC/StatefulSet 的关系？有状态和无状态服务的区别？
3. **日志最佳实践**：知道容器日志走 stdout + 采集，不写文件——这是云原生的核心理念。

### ❌ 常见错误回答

- **"数据库数据存容器里"**：容器删了数据没了。
- **有状态服务用 Deployment**：Pod 重建数据丢失。
- **日志写文件挂卷**：云原生的反模式，采集复杂。

### ✅ 推荐回答

> 容器文件系统是临时的（只读层+可写层，删容器可写层没），持久化三种：Volume（Docker 管理，/var/lib/docker/volumes，跨平台一致，生产数据用）、Bind Mount（挂宿主机目录，开发热重载用——改代码容器立即生效）、tmpfs（内存，临时敏感数据）。生产用 K8s 的 PV+PVC——PV 是存储资源，PVC 是申请（"我要 50Gi"），K8s 自动绑定。有状态服务（Postgres/Redis）用 StatefulSet（每 Pod 稳定身份+独立 PVC，重建挂同一 PV 数据不丢），无状态（Worker）用 Deployment。日志不挂卷——容器输出 stdout/stderr，K8s 收集到节点 /var/log/containers，Fluentd DaemonSet 采集到 ES+Kibana。关注点分离：容器产生日志，日志系统持久化检索。音视频产物用临时卷+上传 S3，不留本地。

### 📚 延伸知识

- **StorageClass**：K8s 的动态存储创建。开发者只声明 PVC（"我要 50Gi SSD"），StorageClass 自动从云厂商（AWS EBS、阿里云云盘）创建 PV。不用运维手动建 PV。
- **CSI（Container Storage Interface）**：容器存储的标准接口。各云厂商和存储厂商实现 CSI 驱动（如 AWS EBS CSI、Ceph CSI）。
- **EFK 栈**：Elasticsearch + Fluentd + Kibana，容器日志的经典方案。也有用 Loki（Grafana 出品，比 ES 轻量）替代 ES 的趋势。

---

## Q5. Docker Compose 和生产部署

**🎤 面试官**

> docker compose 这么方便，一个命令起五个服务。为什么不能直接用 compose 上生产？

**🙋 候选人回答**

compose 解决的是"本地开发和单机部署"，生产的需求它满足不了。逐条对比。

**docker compose 做不到的生产能力**：

**① 没有自动扩缩容**

compose 是静态的——docker-compose.yml 里写了 3 个 Worker，就固定 3 个。流量来了想加到 10 个？手动改配置 + 重启。

我们 Worker 按 Redis 队列长度自动扩缩容（HPA），队列堆积时自动从 3 个扩到 20 个。compose 完全做不到。

**② 没有自愈**

一个 Worker 容器挂了，compose 不会自动重启（除非配 restart policy，且 compose 自己挂了就全没了）。生产要求"Pod 挂了 30 秒内自动拉起"，K8s 的 Deployment 原生支持，compose 要靠外部监控脚本。

**③ 没有滚动更新**

更新镜像版本，compose 是 `docker compose up -d`——停旧的起新的，**有停机**。生产要求零停机（旧的处理完连接再退、新的起来接流量），K8s 的 RollingUpdate 原生支持。

**④ 没有服务发现和负载均衡**

compose 的服务发现靠服务名 DNS（自定义 bridge），但**单机内**。多机部署，机器 A 上的容器怎么访问机器 B 上的容器？compose 单机模型解决不了。

K8s 的 Service 是集群级服务发现 + 负载均衡——一个 Service 后面挂多个 Pod，自动负载均衡。

**⑤ 没有配置管理**

不同环境（staging/prod）的配置不同（数据库地址、API Key）。compose 要准备多个 docker-compose.yml，手动维护。K8s 的 ConfigMap + Secret + Helm/Kustomize 管理配置，原生支持多环境。

**⑥ 没有声明式状态**

compose 是命令式的——`docker compose up` 执行一次。有人手动改了容器配置，compose 不知道，状态会漂移。

K8s 是声明式的——你声明"我要 3 个 Worker"，K8s 的 controller 持续确保实际状态等于声明状态（有人手动删了一个 Pod，K8s 自动补一个）。

**总结对比**：

| 能力 | Docker Compose | K8s |
|------|----------------|-----|
| 部署规模 | 单机 | 多机集群 |
| 自动扩缩容 | 无 | HPA/VPA |
| 自愈 | 弱（restart policy） | 强（controller 持续 reconcile） |
| 滚动更新 | 停机更新 | 零停机 RollingUpdate |
| 服务发现 | 单机 DNS | 集群级 Service + DNS |
| 负载均衡 | 无 | Service 自动 LB |
| 配置管理 | 多份 yml | ConfigMap/Secret/Helm |
| 状态管理 | 命令式 | 声明式（reconcile） |

**compose 的定位**：本地开发、单机 demo、CI 里的集成测试环境。生产用 K8s。

---

**🎤 面试官追问**

> 那 compose 在你们的工作流里是什么角色？完全不用了吗？

**🙋 候选人回答**

**还在用，但是限定在"本地开发"场景。**

compose 在本地开发的不可替代性：

**① 一键起完整依赖**

新人 clone 仓库，`docker compose up -d`，本地就有了 Go 服务、Python 服务、NestJS 服务、Redis、Postgres——不用手动装 Redis/Postgres，不用配环境。十分钟就能开发。

**② 统一的本地环境**

张三的 Mac 装了 Redis 7，李四的装了 Redis 6，行为可能不同。compose 用 `redis:7-alpine` 镜像，所有人的本地 Redis 版本一致。

**③ 真实依赖模拟**

本地跑 Go 服务时，它能连到真实的 Postgres（容器化的）而不是 mock。联调更接近生产。

**我们的开发工作流**：

```
本地开发：docker compose up（起所有依赖）+ 本地直接跑 Go/Python/NestJS（热重载）
   ↓
联调环境：CI 部署到 K8s 的 staging namespace
   ↓
生产环境：K8s 的 prod namespace
```

注意一个细节：**本地开发时不把应用本身放容器，只把依赖放容器**。

```yaml
# docker-compose.dev.yml
services:
  # 依赖用容器
  redis:
    image: redis:7-alpine
  postgres:
    image: postgres:16
  
  # 应用不在 compose 里，本地直接跑（热重载快）
  # go run ./cmd/server
  # python -m media_service
  # pnpm dev
```

为什么？因为应用放容器里，改代码要重新 build 镜像，热重载慢（即使挂 bind mount 也有坑）。本地直接跑，热重载秒级（go run / nodemon / uvicorn --reload）。依赖放容器（Redis/Postgres 不需要热重载）。

**生产环境的"compose"——Kustomize/Helm**

生产部署的"compose"是 Helm Chart 或 Kustomize——把 K8s 的 YAML 模板化，一键部署到集群。但底层是 K8s 不是 Docker Compose。

---

**🎤 面试官继续追问**

> 你们从 compose 迁移到 K8s，有没有迁移成本？新人进团队要学 K8s，门槛是不是很高？

**🙋 候选人回答**

有成本，但**分角色降低门槛**。

**迁移成本**：

1. **学习曲线**：K8s 概念多（Pod/Deployment/Service/Ingress/ConfigMap/PV...），新人要一两周上手。
2. **运维复杂度**：K8s 集群本身的维护（升级、监控、故障排查）比单机 Docker 重。
3. **YAML 地狱**：一个服务要写 Deployment + Service + ConfigMap + Secret + HPA + Ingress，一堆 YAML。

**降低门槛的做法**：

**① 开发者不需要碰 K8s YAML——用 Helm Chart 模板**

我们维护了一套通用 Helm Chart（叫 `service-template`）。开发者部署新服务只填一个 values.yaml：

```yaml
# values.yaml（开发者只写这个）
image: registry/go-task-center:v1.2.3
replicas: 3
service:
  port: 8080
resources:
  limits:
    cpu: 1
    memory: 512Mi
```

`helm install go-task-center service-template -f values.yaml`——Deployment/Service/ConfigMap 全部自动生成。开发者不用写 K8s YAML。

**② 平台团队维护 K8s 集群**

开发者只需要 `kubectl logs`、`kubectl exec` 这种基础命令，集群运维（升级、节点管理、网络策略）由平台团队负责。

**③ 开发用 compose，生产用 K8s**

开发阶段开发者完全不碰 K8s——本地用 docker compose。只有部署到 staging/prod 时才和 K8s 打交道，而且通过 CI/CD 自动化（开发者 push 代码，CI 自动构建镜像 + helm deploy）。

**这是分工**：开发者关心业务代码（Go/Python/Node），平台团队关心基础设施（K8s/监控/网络）。开发者不需要是 K8s 专家，但平台团队必须是。

**为什么不干脆全用 compose（避免学 K8s）**？因为 compose 满足不了生产的扩缩容和可靠性需求（前面讲过）。K8s 的学习成本是"为生产可靠性付的税"。

### 🏗 架构分析

**Docker Compose vs K8s**

| 维度 | Docker Compose | K8s |
|------|----------------|-----|
| 定位 | 本地开发/单机 | 生产集群 |
| 扩缩容 | 无 | HPA |
| 自愈 | 弱 | 强（reconcile） |
| 滚动更新 | 停机 | 零停机 |
| 服务发现 | 单机 | 集群级 |
| 学习成本 | 低 | 高 |

**分工策略**：开发用 compose（低门槛），生产用 K8s（高能力）。平台团队维护 K8s，开发者用 Helm Chart 部署，不直接写 YAML。

**演进路径**：单机 compose → 多机 K8s。规模小（单机够用）时 compose 省事，规模大或需要可靠性时上 K8s。

### 🎯 面试官真正考察什么

1. **compose 的局限**：能不能说出 compose 在生产缺的能力（扩缩容/自愈/滚动更新/服务发现）？
2. **分工意识**：开发用 compose 生产用 K8s，平台团队维护 K8s，开发者用 Helm——知道怎么降低门槛。
3. **不过度工程**：小项目用 compose 够了，不无脑上 K8s。

### ❌ 常见错误回答

- **"生产也用 compose"**：缺扩缩容和自愈，撑不住生产。
- **"开发者都要学 K8s"**：没有分工意识，门槛拉满。
- **不知道 compose 的定位**：以为 compose 是生产方案。

### ✅ 推荐回答

> compose 是单机部署工具，生产用它缺六个能力：无自动扩缩容（Worker 不能按队列长度 HPA）、无自愈（容器挂了不会自动补）、无滚动更新（更新有停机）、单机服务发现（跨机访问不了）、配置管理弱（多份 yml）、命令式不声明式。生产用 K8s。但 compose 在本地开发不可替代——一键起 Redis/Postgres 依赖、统一版本、真实依赖模拟。开发工作流：依赖放容器（redis/postgres），应用本地直接跑（热重载快，应用放容器 build 慢）。降低 K8s 门槛：平台团队维护集群，开发者用通用 Helm Chart 只填 values.yaml（image/replicas/resources），CI 自动 helm deploy。分工：开发者管业务代码，平台团队管基础设施。

### 📚 延伸知识

- **Helm**：K8s 的包管理器。Chart 是模板（Deployment/Service 等 YAML 模板化），values.yaml 是配置。`helm install` 渲染出真实 YAML 部署。类似 apt/yum 之于 Linux。
- **Kustomize**：K8s 原生的配置管理（不引入模板语法，用 overlay 机制）。适合简单场景，复杂场景 Helm 更强。
- **Docker Swarm**：Docker 官方的集群方案（compose 的集群版）。基本被 K8s 淘汰了，很少有人用。

---

## Q6. K8s 的核心概念

**🎤 面试官**

> 切到 K8s。你给我讲讲 K8s 的核心概念——Pod、Deployment、Service、Ingress，它们之间是什么关系？

**🙋 候选人回答**

K8s 的概念很多，但有主干。**Pod、Deployment、Service、Ingress 是四层，从下到上一层层抽象。**

先用一张图看整体：

```
外部用户
   │
   │ HTTP 请求（api.example.com）
   ▼
┌──────────────────────────────────────────┐
│  Ingress（L7 入口）                        │
│  规则：api.example.com → api-service      │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Service: api-service（稳定 IP + LB）      │
│  ClusterIP: 10.96.0.10                    │
│  selector: app=nestjs-api                 │
└──────────────────┬───────────────────────┘
                   │ 负载均衡到匹配的 Pod
                   ▼
┌──────────────────────────────────────────┐
│  Deployment: nestjs-api                   │
│  replicas: 3                              │
│  ┌────────┐ ┌────────┐ ┌────────┐         │
│  │Pod 1   │ │Pod 2   │ │Pod 3   │         │
│  │nestjs  │ │nestjs  │ │nestjs  │         │
│  │10.244. │ │10.244. │ │10.244. │         │
│  │1.1     │ │1.2     │ │1.3     │         │
│  └────────┘ └────────┘ └────────┘         │
└──────────────────────────────────────────┘
```

**① Pod：最小调度单位**

Pod 是 K8s 里最小的可部署单元，**不是容器**。一个 Pod 里跑一个或多个容器。

- 为什么不直接调度容器？因为有些容器要**紧密共享**——共享网络（同 Pod 的容器共享 IP 和端口空间，互相 localhost 访问）、共享存储卷、共享生命周期。
- 我们的设计：**一个 Pod 一个容器**（主流做法）。多容器 Pod 用于 sidecar 模式（比如主容器 + 日志收集 sidecar）。

Pod 的 IP 是临时的——Pod 重建后 IP 变。所以不能直接用 Pod IP 通信（要靠 Service）。

**② Deployment：管理 Pod 的副本和生命周期**

Deployment 声明"我要 3 个这样的 Pod"，K8s 持续保证实际状态等于声明状态（reconcile）。

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: go-task-center
spec:
  replicas: 3                    # 要 3 个副本
  selector:
    matchLabels:
      app: go-task-center
  template:                      # Pod 的模板
    metadata:
      labels:
        app: go-task-center
    spec:
      containers:
        - name: go-task-center
          image: registry/go-task-center:v1.2.3
          ports:
            - containerPort: 8080
```

- Pod 挂了，Deployment 自动拉起一个新的（自愈）。
- 更新镜像版本，Deployment 滚动更新（逐个替换 Pod）。
- 回滚，Deployment 知道历史版本，一条命令回滚。

**③ Service：Pod 的稳定访问入口**

Pod IP 是临时的，但调用方需要一个稳定的地址。Service 提供这个——一个稳定的 ClusterIP + DNS 名 + 负载均衡。

```yaml
apiVersion: v1
kind: Service
metadata:
  name: go-task-center
spec:
  selector:                      # 找带这个 label 的 Pod
    app: go-task-center
  ports:
    - port: 8080
      targetPort: 8080
```

- Service 有个稳定的 ClusterIP（集群内部可达）和 DNS 名（`go-task-center.default.svc.cluster.local`）。
- Service 用 selector 找到匹配的 Pod（label `app=go-task-center`），把流量负载均衡到这些 Pod。
- Pod IP 变了没关系——Service 持续监听 Pod 变化，动态更新后端列表。

**Go 任务中心调 Python 服务**：配 `http://python-media:8000`（用 Service 名），不用关心 Python Pod 的 IP 是什么、有几个、在哪个节点。

**④ Ingress：集群的 HTTP 入口**

Service 的 ClusterIP 只在集群内可达。外部用户要访问，要么用 NodePort/LoadBalancer（L4，TCP 层），要么用 Ingress（L7，HTTP 层）。

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-ingress
spec:
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            backend:
              service:
                name: nestjs-api
                port:
                  number: 3000
```

Ingress 根据 HTTP 的 host 和 path 把流量路由到不同 Service。一个 Ingress 可以路由多个域名/路径到不同 Service——`api.example.com` 到 NestJS、`task.example.com` 到 Go 服务。

**四层关系总结**：

```
Ingress（外部 HTTP 入口，域名/path 路由）
   → Service（稳定 IP + DNS + 负载均衡）
      → Deployment（管理 Pod 副本数、滚动更新）
         → Pod（实际跑容器）
            → Container（应用进程）
```

---

**🎤 面试官追问**

> 你说 Pod IP 是临时的，重建就变。那如果 Go 服务要连 Python 服务，连的是 Service 的 IP。但 Service 后面有多个 Python Pod，流量怎么分配？

**🙋 候选人回答**

Service 用 **kube-proxy + iptables/IPVS** 做负载均衡。

**机制**：

1. Service 创建时，K8s 分配一个 ClusterIP（虚拟 IP，不在任何网卡上）。
2. kube-proxy（每个节点上跑的组件）监听 Service 和 Endpoint 的变化，在节点的 iptables/IPVS 规则里写入：**"访问 ClusterIP 的流量，随机转发到某个后端 Pod IP"**。
3. Go 服务访问 `http://python-media:8000`：
   - DNS 解析 `python-media` 到 Service 的 ClusterIP。
   - 流量到 ClusterIP，被 iptables 规则拦截。
   - iptables 随机（或轮询）选一个 Python Pod IP，DNAT 转发。
   - 流量直接到某个 Python Pod。

**负载均衡算法**：

- **iptables 模式**（默认）：随机选（按权重）。
- **IPVS 模式**：支持更多算法（轮询、最少连接、源地址哈希）。大规模集群用 IPVS 性能更好。

**注意：Service 的负载均衡是 L4（传输层）的**，不感知应用层（HTTP）。如果要 L7 负载均衡（按 URL、header 路由），用 Ingress 或 Service Mesh（Istio）。

**Endpoint / EndpointSlice**：

Service 怎么知道后端有哪些 Pod？靠 Endpoint。Service 的 selector 选中的 Pod 会被记录到 Endpoint 对象里——Service 实际转发到的是 Endpoint 里的 IP。

**健康检查的关键作用**：如果某个 Python Pod 还在但 readinessProbe 没通过（没准备好），它会被从 Endpoint 里移除——Service 不会把流量发给不健康的 Pod。这就是 readinessProbe 的价值。

---

**🎤 面试官继续追问**

> 你提到 readinessProbe。还有 livenessProbe。这两个有什么区别？生产怎么配？

**🙋 候选人回答**

两个 probe 都是健康检查，但**用途和触发动作不同**。

**① livenessProbe（存活探针）**：判断容器"死没死"

- 失败的动作：**重启容器**（restartPolicy 默认 Always）。
- 用途：应用死锁、卡死（进程还在但不响应），自动重启恢复。

**② readinessProbe（就绪探针）**：判断容器"准没准备好接流量"

- 失败的动作：**从 Service 的 Endpoint 移除**（不重启）。
- 用途：应用启动慢（比如要预热缓存）、临时过载，暂时不接流量但不重启。

**③ startupProbe（启动探针）**：1.16+ 新增

- 判断容器"启没启动完"。
- 启动期间禁用 liveness/readiness（避免启动慢被误杀）。
- 用途：慢启动应用（Java 应用启动要 1 分钟）。

**生产配置**：

```yaml
containers:
  - name: go-task-center
    livenessProbe:
      httpGet:
        path: /healthz
        port: 8080
      initialDelaySeconds: 10      # 启动后 10 秒开始检查
      periodSeconds: 10            # 每 10 秒检查一次
      failureThreshold: 3          # 连续失败 3 次才判定失败
    readinessProbe:
      httpGet:
        path: /readyz
        port: 8080
      initialDelaySeconds: 5
      periodSeconds: 5
      failureThreshold: 3
```

**关键区别**：

- liveness 失败 → 重启容器（进程级别的恢复）。
- readiness 失败 → 摘除流量（只是不接新请求，容器继续跑）。

**/healthz 和 /readyz 要分开实现**：

- `/healthz`：进程死活。简单返回 200（能响应说明进程没卡死）。
- `/readyz`：能不能服务。检查依赖（数据库连得上吗、Redis 连得上吗、缓存预热了吗）。

**坑**：很多团队把 livenessProbe 和 readinessProbe 配成同一个 endpoint。问题：如果数据库临时抖动，`/readyz` 返回失败——本来应该只是摘除流量（readiness），但如果 liveness 也用这个 endpoint，会把容器重启。重启反而加剧问题（重启雪崩）。

**我们的实践**：liveness 用简单的 `/healthz`（只要进程活着就 200），readiness 用 `/readyz`（检查依赖）。数据库抖动时 readiness 失败摘流量，但 liveness 通过不重启——等数据库恢复，readiness 自动恢复。

### 🏗 架构分析

**K8s 核心对象关系**

| 对象 | 职责 | 对应"什么" |
|------|------|-----------|
| Pod | 跑容器 | 一个应用实例 |
| Deployment | 管理 Pod 副本 | 应用集群（3 个实例） |
| Service | 稳定访问入口 | 服务的 DNS/IP |
| Ingress | HTTP 入口 | 域名路由 |

**分层**：Ingress（外部入口）→ Service（稳定 IP + LB）→ Deployment（副本管理 + 自愈 + 滚动更新）→ Pod（跑容器）。

**probe 区别**：liveness（重启容器）、readiness（摘除流量）、startup（启动保护）。生产 liveness 用简单健康检查，readiness 检查依赖，分开避免重启雪崩。

### 🎯 面试官真正考察什么

1. **四层概念的关系**：能不能画出 Ingress→Service→Deployment→Pod 的数据流？
2. **Service 的负载均衡**：知道是 kube-proxy + iptables/IPVS 实现，L4 负载均衡。
3. **probe 的区别**：liveness 和 readiness 失败动作不同，生产为什么不能配成同一个 endpoint？

### ❌ 常见错误回答

- **"Pod 就是容器"**：Pod 可以有多个容器，是最小调度单位。
- **liveness 和 readiness 配同一个**：依赖抖动导致重启雪崩。
- **不知道 Ingress 是 L7**：以为 Ingress 是 L4。

### ✅ 推荐回答

> K8s 四层概念：Pod（最小调度单位，跑容器，IP 临时）、Deployment（管理 Pod 副本+自愈+滚动更新，声明 replicas:3 持续 reconcile）、Service（稳定 ClusterIP+DNS+负载均衡，用 selector 找 Pod，Pod IP 变了 Service 动态更新）、Ingress（L7 HTTP 入口，按域名/path 路由到 Service）。数据流：外部→Ingress→Service→Deployment 的 Pod。Service 的 LB 是 kube-proxy+iptables/IPVS 在节点上写转发规则，L4 不感知 HTTP。livenessProbe（存活探针）失败重启容器、readinessProbe（就绪探针）失败从 Endpoint 摘流量不重启、startupProbe（启动探针）保护慢启动。生产 liveness 用简单 /healthz（进程活着就 200），readiness 用 /readyz（检查依赖连得上吗）——分开避免数据库抖动时 liveness 误判导致重启雪崩。

### 📚 延伸知识

- **kube-proxy 三种模式**：userspace（早期，性能差）、iptables（默认）、IPVS（大规模性能好）。
- **EndpointSlice**：Endpoint 的升级版。一个 Service 后端 Pod 多时，Endpoint 对象很大，EndpointSlice 把它切片，减少 Watch 的数据量。
- **Sidecar 模式**：一个 Pod 里主容器 + 辅助容器（如日志收集、网络代理）。Istio 的 Envoy 就是注入 Pod 的 sidecar。

---

## Q7. K8s 的 Service 模式

**🎤 面试官**

> 你刚才提到 Service 有 ClusterIP。我印象里 Service 还有 NodePort、LoadBalancer。这几种模式什么区别？什么场景用哪个？

**🙋 候选人回答**

Service 有四种类型（type），从"内部可达"到"外部可达"递进。

**① ClusterIP（默认）：集群内部访问**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: python-media
spec:
  type: ClusterIP          # 默认，可以不写
  selector:
    app: python-media
  ports:
    - port: 8000
```

- 分配一个 ClusterIP（如 10.96.0.10），**只在集群内部可达**。
- 集群内的 Pod 访问 `http://python-media:8000` 或 `http://10.96.0.10:8000`。
- **外部访问不了**。

**用途**：内部服务间通信。Go 任务中心调 Python 服务、Worker 调 Redis——都是 ClusterIP。

**我们 80% 的 Service 是 ClusterIP**——内部服务不需要对外暴露。

**② NodePort：在每个节点开一个端口**

```yaml
spec:
  type: NodePort
  ports:
    - port: 8080            # Service 的端口（集群内访问）
      targetPort: 8080      # Pod 的端口
      nodePort: 30080       # 节点上开的端口（30000-32767）
```

- 在**每个节点**上开一个端口（nodePort，范围 30000-32767）。
- 外部访问 `<任意节点IP>:30080` → 转发到 Service → 负载均衡到 Pod。

**用途**：测试、临时调试。或者作为 LoadBalancer 的底层（云厂商的 LoadBalancer 底层就是 NodePort + 云 LB）。

**缺点**：端口范围受限（30000-32767）、节点 IP 变了要改配置、没有 TLS 终止。生产很少直接用 NodePort 对外。

**③ LoadBalancer：云厂商的负载均衡器**

```yaml
spec:
  type: LoadBalancer
```

- K8s 调用云厂商的 API，自动创建一个外部负载均衡器（AWS ELB、阿里云 SLB、GCP LB）。
- 云 LB 有个外部 IP，外部访问这个 IP → 云 LB → 节点的 NodePort → Service → Pod。

**用途**：对外暴露的 L4 服务（比如数据库直连、TCP 服务）。每个 LoadBalancer Service 会产生云 LB 费用。

**④ Ingress：L7 HTTP 入口**（严格说不是 Service type，但常一起讨论）

```yaml
spec:
  type: ClusterIP           # Ingress 背后的 Service 还是 ClusterIP
```

Ingress 是独立的资源，背后是 Ingress Controller（如 Nginx Ingress、Traefik）。它本身通过一个 LoadBalancer 或 NodePort 对外暴露，然后根据 HTTP host/path 路由到不同 Service。

**对比**：

| 类型 | 访问范围 | 典型用途 | 成本 |
|------|---------|---------|------|
| ClusterIP | 集群内 | 内部服务通信（80%场景） | 无 |
| NodePort | 集群外（节点IP:端口） | 调试 | 无 |
| LoadBalancer | 集群外（云LB IP） | 对外 L4 服务 | 云LB费用 |
| Ingress | 集群外（域名） | 对外 HTTP 服务（多服务复用） | 一个LB |

**我们的对外服务架构**：

```
外部用户 → 云LB（LoadBalancer，一个）→ Ingress Controller → 按 host/path 路由
   → api.example.com → Service(nestjs-api) → Pod
   → task.example.com → Service(go-task-center) → Pod
   → media.example.com → Service(python-media) → Pod
```

**关键设计：一个 LoadBalancer + 一个 Ingress Controller 暴露所有 HTTP 服务**。不是每个服务一个 LoadBalancer（太贵）。Ingress 在 L7 路由，多个域名/路径复用一个入口。

---

**🎤 面试官追问**

> 你说内部服务用 ClusterIP。那如果 Python 服务有 3 个 Pod，Go 服务要调，负载均衡到哪个 Pod 是随机的？还是能指定？

**🙋 候选人回答**

**默认是随机的（iptables）或轮询（IPVS），不能指定。**

Service 的负载均衡是**无状态的**——不记住请求来自谁、上次发给哪个 Pod。Go 服务发 3 个请求，可能都打到同一个 Python Pod（iptables 随机）。

**如果需要"会话亲和"（同一客户端固定到同一 Pod）**：

```yaml
spec:
  type: ClusterIP
  sessionAffinity: ClientIP        # 基于客户端 IP 的会话亲和
  sessionAffinityConfig:
    clientIP:
      timeoutSeconds: 10800        # 3 小时
```

`sessionAffinity: ClientIP` 让同一个客户端 IP 的请求固定到同一个 Pod（类似 Nginx 的 ip_hash）。但我们基本不用——无状态服务不需要亲和，有状态服务该用 StatefulSet。

**实际中的负载均衡问题**：

Service 的 L4 负载均衡**可能不均匀**。比如：

- Go 服务用 HTTP keep-alive，建一条 TCP 连接复用——所有请求走同一条连接，iptables 的 per-connection 负载均衡导致都打到一个 Pod。
- 解决：客户端禁用 keep-alive，或用 L7 负载均衡（Ingress/Istio，按请求而不是按连接负载均衡）。

**为什么我们不用 sessionAffinity**：

1. 服务都设计成无状态的——任何 Pod 都能处理任何请求。
2. 亲和性会导致负载不均（某 Pod 挂了，它的客户端要重新分配）。
3. 如果真需要"固定到某个 Pod"，说明服务设计有问题（状态没抽离）。

**例外**：WebSocket 长连接。一旦建立，连接固定在一个 Pod 上（TCP 连接不能中途换 Pod）。这不靠 sessionAffinity，靠"连接建立后不变"——Service 只在新建连接时负载均衡，已建立的连接一直打到原来的 Pod。

---

**🎤 面试官继续追问**

> 你提到 Ingress 暴露 HTTP 服务。那 gRPC 呢？Go 任务中心和 Python 服务之间用 gRPC 通信，gRPC 能走 Ingress 吗？

**🙋 候选人回答**

能，但要配置。gRPC 基于 HTTP/2，Ingress Controller 要支持 HTTP/2。

**gRPC 走 Ingress 的坑**：

**① HTTP/2 支持**

Nginx Ingress 默认对 HTTPS 后端用 HTTP/1.1。要开后端 HTTP/2，要配 annotation：

```yaml
metadata:
  annotations:
    nginx.ingress.kubernetes.io/backend-protocol: GRPC
```

**② 长连接负载均衡**

gRPC 用 HTTP/2 长连接，一条连接复用多个请求。和前面 keep-alive 问题类似——一条连接固定在一个 Pod，负载不均。

解决：

- **gRPC 客户端负载均衡**：gRPC 原生支持客户端侧负载均衡（用 service mesh 或 DNS resolver）。客户端知道所有 Pod IP，自己轮询。
- **Istio/Linkerd**：Service Mesh 的 sidecar 在客户端和服务端都注入代理，按请求负载均衡（L7）。

**我们内部 gRPC 不走 Ingress**：

```
Go 任务中心 ──gRPC──→ Service(ClusterIP) ──→ Python Pod
```

内部 gRPC 用 ClusterIP + gRPC 客户端负载均衡。不经过 Ingress（Ingress 是给外部 HTTP 入口用的，内部服务直接走 Service）。

**只有对外暴露的 gRPC 才走 Ingress**（比如给客户端 SDK 用的 gRPC API），配 backend-protocol: GRPC。

**总结 Service 模式的选型逻辑**：

- 内部服务（Go 调 Python、Worker 调 Redis）：ClusterIP。
- 对外 HTTP（多服务复用）：Ingress（背后 ClusterIP）。
- 对外 L4（数据库直连、TCP）：LoadBalancer。
- 调试临时访问：NodePort。

### 🏗 架构分析

**Service 类型对比**

| 类型 | 访问范围 | LB 层级 | 成本 | 场景 |
|------|---------|---------|------|------|
| ClusterIP | 集群内 | L4（kube-proxy） | 无 | 内部服务（80%） |
| NodePort | 节点:端口 | L4 | 无 | 调试 |
| LoadBalancer | 云LB IP | L4（云LB） | 云LB费用 | 对外 L4 |
| Ingress | 域名 | L7（HTTP） | 一个LB | 对外 HTTP |

**关键设计**：一个 LoadBalancer + 一个 Ingress Controller 对外暴露所有 HTTP 服务（多域名/path 复用），不每个服务一个 LB（省钱）。

**负载均衡的坑**：L4 按连接负载均衡，HTTP keep-alive/gRPC 长连接会导致负载不均。需要 L7（Ingress/Istio）或客户端负载均衡。

### 🎯 面试官真正考察什么

1. **四种 Service 类型**：知道各自访问范围和场景，选型有逻辑。
2. **负载均衡原理**：L4 按连接负载均衡，知道 keep-alive/gRPC 的坑。
3. **生产架构**：一个 LB + Ingress 复用，不每个服务一个 LB——成本意识。

### ❌ 常见错误回答

- **每个对外服务都用 LoadBalancer**：成本爆炸。
- **不知道 ClusterIP 是默认**：以为必须指定 type。
- **L4 负载均衡以为均匀**：keep-alive 导致不均。

### ✅ 推荐回答

> Service 四种类型：ClusterIP（默认，集群内可达，内部服务 80% 场景如 Go 调 Python）、NodePort（每节点开 30000-32767 端口，调试用）、LoadBalancer（云厂商自动创建 LB，对外 L4 服务如数据库直连，有云 LB 费用）、Ingress（L7 HTTP 入口，不是 Service type 是独立资源）。对外架构：一个 LoadBalancer 暴露 Ingress Controller，Ingress 按域名/path 路由到多个 ClusterIP Service——不每个服务一个 LB（省钱）。负载均衡是 kube-proxy 的 L4 按连接负载均衡，HTTP keep-alive 或 gRPC HTTP/2 长连接会导致请求都打到一个 Pod，解决用 L7（Ingress/Istio）或客户端负载均衡。内部 gRPC 走 ClusterIP 不走 Ingress（Ingress 是外部入口）。需要会话亲和配 sessionAffinity: ClientIP 但我们不用——服务都无状态。

### 📚 延伸知识

- **Headless Service**：`clusterIP: None`。不给 Service 分配 ClusterIP，DNS 直接返回 Pod IP。用于 StatefulSet（每个 Pod 有独立 DNS 名）或客户端自己做负载均衡。
- **ExternalName**：Service 的 CNAME 别名，把集群内的服务名指向外部域名（如 `my-db → rds.example.com`）。用于把外部服务包装成 Service。
- **Gateway API**：K8s 新一代的 L7 入口 API（替代 Ingress）。更灵活，支持 TCP/UDP/高级路由。Istio、GKE 已支持。

---

## Q8. K8s 的 ConfigMap 和 Secret

**🎤 面试官**

> 不同环境的配置（数据库地址、Redis URL、API Key）怎么管理？不能把配置硬编码进镜像吧？

**🙋 候选人回答**

**配置和镜像分离**——镜像是同一个（不分环境），配置通过 ConfigMap/Secret 注入。

**核心原则：一个镜像跑遍所有环境。** 不是 staging 一个镜像、prod 一个镜像，而是同一个镜像用不同配置。

**ConfigMap：非敏感配置**

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: go-task-center-config
data:
  REDIS_URL: "redis://redis:6379"
  DATABASE_URL: "postgres://postgres:5432/taskcenter"
  LOG_LEVEL: "info"
  config.yaml: |
    worker:
      concurrency: 10
      retry:
        max: 3
```

**Secret：敏感配置**

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: ai-provider-secret
type: Opaque
stringData:
  OPENAI_API_KEY: "sk-xxx"
  ANTHROPIC_API_KEY: "sk-yyy"
  DATABASE_PASSWORD: "p@ssw0rd"
```

**ConfigMap 和 Secret 的区别**：

| 维度 | ConfigMap | Secret |
|------|-----------|--------|
| 用途 | 非敏感配置 | 敏感配置（密钥、密码、证书） |
| 存储 | 明文 | base64 编码（不是加密！） |
| etcd | 明文存 | base64 存（默认不加密） |
| 使用方式 | 环境变量/文件 | 环境变量/文件 |

**注意：Secret 的 base64 不是加密，是编码**。任何人 `kubectl get secret -o yaml` 就能 decode 出来。要真正加密要用 K8s 的 EncryptionConfiguration（加密 etcd 里的 Secret）或外部密钥管理（Vault、云 KMS）。

**配置注入的两种方式**：

**① 环境变量**

```yaml
spec:
  containers:
    - name: go-task-center
      envFrom:
        - configMapRef:
            name: go-task-center-config
        - secretRef:
            name: ai-provider-secret
```

ConfigMap 和 Secret 里的所有 key 都变成环境变量。应用读 `os.Getenv("REDIS_URL")`。

**② 文件挂载**

```yaml
spec:
  containers:
    - name: go-task-center
      volumeMounts:
        - name: config
          mountPath: /etc/config
  volumes:
    - name: config
      configMap:
        name: go-task-center-config
```

ConfigMap 里的每个 key 变成 `/etc/config/` 下的文件（`config.yaml` → `/etc/config/config.yaml`）。适合多行配置文件（YAML/TOML）。

**两种方式的选择**：

- 简单 key-value → 环境变量。
- 复杂配置文件（config.yaml）→ 文件挂载。
- 12-Factor App 倾向环境变量。

---

**🎤 面试官追问**

> ConfigMap 更新了，Pod 里的配置会自动更新吗？

**🙋 候选人回答**

**环境变量方式：不会自动更新。** 环境变量在容器启动时注入，之后不变。ConfigMap 改了，已运行的 Pod 读到的还是旧值——要重启 Pod 才生效。

**文件挂载方式：会自动更新（有延迟）。** K8s 会定期（默认 60-120 秒）把 ConfigMap 的新内容同步到挂载的文件。但应用是否感知到文件变化，取决于应用有没有 watch 文件。

**我们的实践：配置变更触发滚动更新。**

不依赖 ConfigMap 的自动同步（慢且应用可能不感知），而是用 **Reloader** 或在 Deployment 的 annotation 里引用 ConfigMap 的哈希：

```yaml
spec:
  template:
    metadata:
      annotations:
        # 这个 hash 随 ConfigMap 内容变化
        checksum/config: "{{ .Values.configMapChecksum }}"
    spec:
      containers:
        - ...
```

ConfigMap 改了，checksum 变，Deployment 的 Pod template 变，触发滚动更新——重启所有 Pod 加载新配置。确定、可靠。

**或者用 Reloader**（开源工具）：

```yaml
metadata:
  annotations:
    reloader.stakater.com/auto: "true"    # 关联的 ConfigMap/Secret 变化时自动重启
```

Reloader watch ConfigMap/Secret 变化，自动触发 Deployment 滚动更新。

**关键设计：配置变更要"显式"生效，不要"隐式"同步。** 隐式同步时间不确定（60-120 秒延迟），应用可能不感知（读到一半新一半旧）。显式触发滚动更新——旧 Pod 全部用旧配置，新 Pod 全部用新配置，边界清晰。

---

**🎤 面试官继续追问**

> 你说 Secret 的 base64 不是加密。那 API Key 怎么真正安全地管理？不可能 base64 放 etcd 里吧？

**🙋 候选人回答**

对，base64 在 etcd 里是裸的——有 etcd 读权限的人能看到所有 Secret。生产要真正加密。

**三种方案**：

**① K8s 原生加密（EncryptionConfiguration）**

配置 K8s API Server，让 etcd 里的 Secret 用 KMS 加密。读 Secret 时自动解密。

```yaml
# EncryptionConfiguration
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources: ["secrets"]
    providers:
      - aescbc:
          keys:
            - name: key1
              secret: <base64-encoded-key>
```

- 优点：K8s 原生，无需额外组件。
- 缺点：密钥管理麻烦（密钥怎么安全分发）、配置复杂。

**② 外部密钥管理（Vault / 云 KMS）**

不在 K8s 存 Secret，用外部密钥管理系统（HashiCorp Vault、AWS Secrets Manager、阿里云 KMS）。

应用启动时从 Vault 拉密钥，或用 CSI Driver 把 Secret 从 Vault 投影到 Pod。

```yaml
# 用 ExternalSecret（External Secrets Operator）
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: ai-provider-secret
spec:
  secretStoreRef:
    name: vault-backend
  target:
    name: ai-provider-secret      # 自动创建 K8s Secret
  data:
    - secretKey: OPENAI_API_KEY
      remoteRef:
        key: secret/ai-providers   # Vault 里的路径
        property: openai_key
```

- 优点：密钥集中管理、审计、轮转、权限细。
- 缺点：引入额外组件（Vault 集群）。

**③ Sealed Secrets（GitOps 友好）**

把 Secret 加密成 SealedSecret（只有目标集群能解密），可以安全地存进 Git。

```yaml
# 加密的 SealedSecret，可以进 Git
apiVersion: bitnami.com/v1
kind: SealedSecret
spec:
  encryptedData:
    OPENAI_API_KEY: "AgBh...加密内容..."
```

- 优点：GitOps 友好（Secret 能像代码一样进 Git）。
- 缺点：密钥轮转麻烦（解密密钥泄露所有 SealedSecret 都暴露）。

**我们的选择**：

- **简单项目**：K8s 原生 Secret + etcd 加密（EncryptionConfiguration）。够用。
- **复杂项目/多团队**：External Secrets + Vault。密钥集中管理，轮转方便，审计完整。

**密钥轮转的考量**：API Key 应该定期轮转（比如 90 天）。Vault 支持自动轮转，K8s 原生 Secret 要手动改。这是大团队选 Vault 的主因。

**还有一点：密钥不能进镜像、不能进 Git（明文）、不能进日志。** 这是底线。

- 进镜像：任何能拉镜像的人能 extract 出来。
- 进 Git（明文）：Git 历史删不掉。
- 进日志：logger 打印密钥是低级错误。

我们 CI 里有扫描（git-secrets、TruffleHog），防止密钥进 Git。

### 🏗 架构分析

**配置注入方案对比**

| 方案 | 场景 | 敏感性 | 更新方式 |
|------|------|--------|---------|
| ConfigMap（env） | 简单 key-value | 非敏感 | 重启 Pod |
| ConfigMap（文件） | 复杂配置文件 | 非敏感 | 自动同步/重启 |
| Secret | 密钥密码 | 敏感（base64） | 重启 Pod |
| Vault + ExternalSecret | 企业级密钥 | 敏感（加密） | 自动轮转 |

**核心原则**：一个镜像跑所有环境，配置通过 ConfigMap/Secret 注入。

**Secret 安全**：base64 不是加密。生产用 etcd 加密（EncryptionConfiguration）或 Vault（ExternalSecret）。密钥不进镜像/Git/日志。

### 🎯 面试官真正考察什么

1. **ConfigMap vs Secret**：知道用途和存储差异（base64 不是加密）。
2. **配置注入方式**：环境变量 vs 文件挂载，应用场景。
3. **密钥安全**：Secret 的 base64 不是加密，知道 Vault/etcd 加密等真正安全的方案。

### ❌ 常见错误回答

- **"Secret 是加密的"**：base64 是编码不是加密。
- **配置进镜像**：一镜像一环境，违反不可变原则。
- **密钥进 Git**：Git 历史删不掉，安全事故。

### ✅ 推荐回答

> 配置和镜像分离——一个镜像跑所有环境，配置通过 ConfigMap（非敏感，如 REDIS_URL/LOG_LEVEL）和 Secret（敏感，如 API Key/密码）注入。注入两种方式：环境变量（envFrom，简单 key-value）和文件挂载（ConfigMap 的 key 变成文件，适合 config.yaml）。ConfigMap 改了环境变量方式不会自动更新（要重启 Pod），文件挂载会自动同步但有延迟——我们的实践用 checksum annotation 或 Reloader 让 ConfigMap 变化触发滚动更新，显式生效边界清晰。Secret 的 base64 不是加密是编码，kubectl get secret 能 decode 出来。生产真正加密：K8s 原生 EncryptionConfiguration（etcd 加密，简单项目）或 Vault+ExternalSecret（企业级，密钥集中管理+自动轮转+审计）。底线：密钥不进镜像、不进 Git（CI 用 git-secrets 扫描）、不进日志。

### 📚 延伸知识

- **12-Factor App**：方法论提出"配置存环境变量"。但复杂配置（多层级 YAML）环境变量表达不了，还是用文件。
- **External Secrets Operator**：K8s 里连接外部密钥管理（Vault/AWS Secrets Manager/阿里云 KMS）的事实标准。
- **SOPS**：Mozilla 的加密文件工具（Encrypt at rest）。可以加密 YAML/JSON 的某些字段，配合 age/PGP。GitOps 友好。

---

## Q9. K8s 的 HPA 怎么配置？

**🎤 面试官**

> 你们 Worker 用 HPA 自动扩缩容。具体怎么配的？按什么指标扩缩？

**🙋 候选人回答**

先说标准 HPA，再说我们的特殊做法。

**HPA（Horizontal Pod Autoscaler）**：根据指标自动调整 Deployment 的 replicas 数量。

**① 标准 HPA：按 CPU 扩缩**

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: go-task-center
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: go-task-center
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70    # CPU 平均使用率超过 70% 扩容
```

- 当所有 Pod 的平均 CPU 超过 70%，HPA 增加 replicas（不超过 maxReplicas）。
- 平均 CPU 降下来，HPA 减少 replicas（不少于 minReplicas）。
- K8s 的 controller 每 15 秒（默认）检查一次指标。

**但 CPU 对我们 Worker 不合适——Worker 是 I/O 密集型，不是 CPU 密集型。**

**② 我们的做法：按 Redis 队列长度扩缩（自定义指标）**

我们的架构：Go 任务中心用 BullMQ（基于 Redis）管理任务队列，Worker 从队列拉任务执行。

```
任务进队列 → Redis 队列 → Worker 拉取执行
            ↑
        队列长度 = 待处理的任务数
```

**为什么不用 CPU？**

Worker 的工作主要是：
- 从 Redis 拉任务（I/O）
- 调 AI API（网络 I/O，等几秒到几十秒）
- 写结果到数据库（I/O）

整个过程中 CPU 几乎闲置（都在等 I/O）。10 个任务在处理和 1 个任务在处理，CPU 使用率都接近 0。

**如果按 CPU 扩缩**：队列堆积 1000 个任务，Worker 都在等 AI API 响应，CPU 是 0——HPA 不扩容，任务越积越多，用户等几十分钟。

**按队列长度扩缩**：队列长度直接反映"有多少活要干"，是最准确的扩缩信号。

**实现：K8s 自定义指标（Custom Metrics）**

HPA 默认只认 CPU/内存（Resource Metrics）。要用队列长度扩缩，要接入自定义指标。我们用 **Prometheus Adapter**：

```
Redis Exporter → Prometheus（采集队列长度指标）→ Prometheus Adapter（转成 K8s 自定义指标）→ HPA 消费
```

**步骤**：

1. **Redis Exporter** 采集 Redis 队列长度，暴露成 Prometheus 指标：
   ```
   bullmq_waiting{queue="media-processing"} 150
   ```

2. **Prometheus** 存储这个指标。

3. **Prometheus Adapter** 把 Prometheus 指标转成 K8s 的自定义指标 API：
   ```yaml
   # Adapter 配置：把 bullmq_waiting 映射成 K8s 自定义指标
   - seriesQuery: 'bullmq_waiting{queue!="",namespace!=""}'
     resources:
       overrides:
         namespace: {resource: "namespace"}
     name:
       matches: "^(.*)_waiting"
       as: "queue_length"
     metricsQuery: 'avg(bullmq_waiting{queue="media-processing",namespace="<<ResourceNamespace>>"})'
   ```

4. **HPA 消费自定义指标**：
   ```yaml
   metrics:
     - type: Pods
       pods:
         metric:
           name: queue_length          # 自定义指标名
         target:
           type: AverageValue
           averageValue: 10            # 每个 Pod 平均处理 10 个任务
   ```

**扩缩逻辑**：队列有 100 个任务，每 Pod 平均处理 10 个 → HPA 扩到 10 个 Pod。队列降到 20 → HPA 缩到 2 个（minReplicas 保证至少 3 个）。

---

**🎤 面试官追问**

> 这个扩缩过程有延迟吗？队列突然堆积 1000 个任务，Worker 多久能扩起来？

**🙋 候选人回答**

有延迟，几个环节叠加：

**延迟链路**：

```
任务入队（Redis）
   ↓ BullMQ/Redis Exporter 采集（每 15-30 秒一次）
   ↓ Prometheus scrape（默认 15 秒）
   ↓ Prometheus Adapter 暴露（几秒）
   ↓ HPA controller 检查（默认 15 秒）
   ↓ Pod 调度 + 镜像拉取 + 容器启动（30-60 秒）
   ↓ Worker 连上 Redis 开始消费（几秒）
```

**总延迟：1-2 分钟。**

从任务入队到新 Worker 开始消费，最快也要 1 分钟。如果是突发流量（突然来 1000 个任务），这 1 分钟里任务在排队。

**怎么降低延迟**：

**① 预热指标采集**

Prometheus scrape interval 从 15 秒降到 5 秒，Redis Exporter 采集频率提高。指标更新更快。

**② HPA 预测（Predictive）**

一些高级 HPA（KEDA）支持预测——根据历史规律提前扩容。比如每天 10 点是高峰，9:50 就开始扩容。

**③ minReplicas 保持基线**

`minReplicas: 3` 保证平时有 3 个 Worker 待命。突发时从 3 扩到 20，比从 0 扩到 20 快（冷启动慢）。

**④ 缩容冷却（scale-down stabilization）**

```yaml
behavior:
  scaleDown:
    stabilizationWindowSeconds: 300    # 5 分钟内不缩容
    policies:
      - type: Percent
        value: 50                        # 每次最多缩 50%
        periodSeconds: 60
```

防止"扩容后又缩容"的震荡（队列临时降下来就缩，又上来再扩）。

**⑤ 冷启动优化**

镜像预拉（image preload）——在节点上预拉 Worker 镜像，新 Pod 调度到节点不用拉镜像，直接启动。省掉镜像拉取的 30-60 秒。

**实际效果**：

- 慢速增长（队列从 50 涨到 200）：1-2 分钟扩容，用户无感。
- 突发流量（队列从 0 飙到 1000）：前 1 分钟有积压，但 2 分钟内扩到 20 个 Worker，积压快速消化。

**无法完全消除的延迟**：Pod 启动有固有延迟（调度 + 拉镜像 + 应用启动）。所以 minReplicas 要够——保证基线处理能力，扩容只应对"超出基线"的部分。

---

**🎤 面试官继续追问**

> 如果按队列长度扩缩，缩容的时候有没有问题？比如队列空了，Worker 从 20 缩到 3，正在处理的任务怎么办？

**🙋 候选人回答**

这是关键问题——**缩容不能杀正在处理任务的 Worker**。

**naive 做法的坑**：

HPA 减 replicas，K8s 随机选 Pod 删除。如果删的是正在处理任务的 Worker——任务中断，用户报错。

**我们的处理：优雅停机（Graceful Shutdown）+ Pod Disruption Budget。**

**① 优雅停机**

Worker 进程捕获 SIGTERM 信号（K8s 删 Pod 前先发 SIGTERM），停止拉新任务，等当前任务处理完再退出。

```yaml
spec:
  terminationGracePeriodSeconds: 300    # 给 5 分钟处理完任务
  containers:
    - name: worker
      lifecycle:
        preStop:
          exec:
            command: ["sh", "-c", "sleep 10 && /app/shutdown.sh"]
```

Worker 的 shutdown 逻辑（Go 伪代码）：

```go
sigChan := make(chan os.Signal, 1)
signal.Notify(sigChan, syscall.SIGTERM)

<-sigChan                          // 收到 SIGTERM
worker.StopAcceptingNewJobs()      // 停止从队列拉新任务
worker.WaitCurrentJobs(time.Minute * 4)  // 等当前任务处理完（最多 4 分钟）
os.Exit(0)                         // 正常退出
```

**关键**：
- 收到 SIGTERM 后不拉新任务（队列里的任务留给其他 Worker）。
- 当前正在处理的任务处理完才退出。
- BullMQ 配合：任务如果在 Worker 停机时未完成，BullMQ 自动把它重新入队，其他 Worker 接着处理。

**② preStop hook**

```yaml
preStop:
  exec:
    command: ["sh", "-c", "sleep 10"]
```

发 SIGTERM 前先 sleep 10 秒——让 Service 把这个 Pod 从 Endpoint 摘除（防止还有新流量进来）。虽然 Worker 不接 HTTP 流量，但这个习惯对 HTTP 服务重要。

**③ Pod Disruption Budget（PDB）**

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: worker-pdb
spec:
  minAvailable: 2              # 至少保持 2 个 Pod 可用
  selector:
    matchLabels:
      app: worker
```

防止一次性删太多 Pod——比如节点维护时 K8s 驱散 Pod，PDB 保证至少 2 个 Worker 在跑。

**④ 缩容冷却**

前面说的 `stabilizationWindowSeconds: 300`——队列临时降低不立刻缩，等 5 分钟确认是持续下降才缩。避免震荡式扩缩。

**完整的 Worker 缩容安全链**：

```
HPA 决定缩容（队列长度下降）
   ↓
stabilizationWindow 5 分钟确认
   ↓
K8s 选 Pod 删除，发 SIGTERM
   ↓
preStop hook（sleep 10，让 Service 摘流量）
   ↓
Worker 收到 SIGTERM，停止拉新任务
   ↓
当前任务处理完（最多 4 分钟，BullMQ 未完成的重新入队）
   ↓
Worker 退出，Pod 删除
```

**这是 Worker 设计的关键部分**——扩容简单（加 Pod 就行），缩容难（不能影响在途任务）。

### 🏗 架构分析

**HPA 扩缩指标对比**

| 指标 | 采集方式 | 适用场景 | 我们的选择 |
|------|---------|---------|-----------|
| CPU/内存 | Resource Metrics（内置） | CPU 密集型 | 不用 |
| 队列长度 | Prometheus + 自定义指标 | I/O 密集型 Worker | ✅ |
| QPS | 自定义指标 | Web 服务 | API 服务可用 |
| 自定义业务指标 | 自定义 | 特定业务 | - |

**选队列长度的原因**：Worker 是 I/O 密集（等 AI API/数据库），CPU 不能反映负载。队列长度直接反映"待处理的活"。

**缩容安全链**：优雅停机（SIGTERM + 停拉新任务 + 等当前任务完）+ preStop hook + PDB + 缩容冷却。

### 🎯 面试官真正考察什么

1. **自定义指标**：知道 HPA 不止 CPU/内存，还能用 Prometheus 自定义指标。
2. **指标选择**：I/O 密集 Worker 为什么不用 CPU——业务理解。
3. **缩容安全**：优雅停机、preStop、PDB——保证不杀正在处理任务的 Worker。

### ❌ 常见错误回答

- **Worker 用 CPU 扩缩**：I/O 密集型 CPU 不反映负载。
- **缩容直接杀 Pod**：在途任务中断。
- **不知道自定义指标**：以为 HPA 只能按 CPU。

### ✅ 推荐回答

> HPA 按指标自动调 replicas。标准是 CPU（averageUtilization: 70%），但我们的 Worker 是 I/O 密集（拉 Redis 任务+调 AI API+写数据库，CPU 一直接近 0），按 CPU 扩缩队列堆积 1000 个任务都不扩。改用自定义指标：Redis 队列长度。链路是 Redis Exporter→Prometheus 采集 bullmq_waiting 指标→Prometheus Adapter 转成 K8s 自定义指标→HPA 消费（每 Pod 平均处理 10 个任务，队列 100 个扩到 10 个 Pod）。扩缩延迟 1-2 分钟（采集+scrape+HPA 检查+Pod 启动），降延迟靠预热采集（5秒 scrape）+ minReplicas 保持基线 + 镜像预拉。缩容安全链：优雅停机（SIGTERM 后停拉新任务等当前任务处理完，BullMQ 未完成的重新入队）+ preStop hook（sleep 10 让 Service 摘流量）+ PDB（minAvailable 保证至少 N 个）+ stabilizationWindow 5 分钟防震荡。

### 📚 延伸知识

- **KEDA**：K8s 事件驱动自动扩缩。比 HPA 更强——支持缩到 0（scale to zero）、支持多种数据源（Kafka/Redis/AWS SQS 等）。我们 Worker 的队列扩缩其实 KEDA 更合适。
- **VPA（Vertical Pod Autoscaler）**：调整 Pod 的资源请求（CPU/内存 limits），不是副本数。适合状态型服务（不能水平扩的服务）。
- **Cluster Autoscaler**：HPA 扩 Pod 但节点不够时，Cluster Autoscaler 自动加节点。和 HPA 配合实现"Pod 扩缩 + 节点扩缩"。

---

## Q10. K8s 的滚动更新和回滚

**🎤 面试官**

> 我们每周都发版。K8s 怎么保证发版时不中断服务？万一新版本有 Bug，怎么回滚？

**🙋 候选人回答**

**滚动更新（RollingUpdate）** 是 K8s Deployment 的默认更新策略——逐步用新 Pod 替换旧 Pod，整个过程零停机。

**RollingUpdate 的两个关键参数**：

```yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1              # 最多比 replicas 多出 1 个 Pod
      maxUnavailable: 0        # 最多比 replicas 少 0 个 Pod（不允许减少可用）
```

- **maxSurge**：更新过程中，最多能"超出" replicas 多少。比如 replicas=3, maxSurge=1，最多同时有 4 个 Pod。
- **maxUnavailable**：更新过程中，最多能"少于" replicas 多少。maxUnavailable=0 意味着始终保持 3 个可用，不减少。

**更新过程（replicas=3, maxSurge=1, maxUnavailable=0）**：

```
初始：     [v1] [v1] [v1]                  （3 个 v1）

步骤一：   [v1] [v1] [v1] [v2]             （新建 1 个 v2，现在 4 个）
           → 等 v2 的 readinessProbe 通过

步骤二：   [v1] [v1] [v2]                  （删 1 个 v1，回到 3 个）

步骤三：   [v1] [v1] [v2] [v2]             （再建 1 个 v2）

步骤四：   [v1] [v2] [v2]                  （删 1 个 v1）

步骤五：   [v1] [v2] [v2] [v2]             （再建 1 个 v2）

步骤六：   [v2] [v2] [v2]                  （删最后 1 个 v1，完成）
```

**maxUnavailable: 0 的意义**：整个更新过程中，始终有 3 个可用 Pod（不超过 replicas）。对外服务不中断——旧 Pod 还在处理请求时新 Pod 已经 ready，旧 Pod 退出前连接被 drain。

**maxSurge: 1 的意义**：同时多出 1 个 Pod，给"先建新的再删旧的"留空间。如果 maxSurge=0 且 maxUnavailable=0，更新永远不进行（不能加也不能减）。

---

**🎤 面试官追问**

> 你说"旧 Pod 退出前连接被 drain"。具体怎么 drain？如果旧 Pod 正在处理一个长请求（比如 AI 生成要 30 秒），直接杀会中断吗？

**🙋 候选人回答**

会中断，如果没有正确配优雅停机。这是滚动更新的关键细节。

**K8s 删 Pod 的流程**：

```
1. K8s 把 Pod 标记为 Terminating
2. Pod 从 Service 的 Endpoint 摘除（不再接新流量）  ← 这步有延迟
3. 同时发 SIGTERM 给容器主进程
4. 等待 terminationGracePeriodSeconds（默认 30 秒）
5. 如果还没退出，发 SIGKILL 强制杀
```

**坑：步骤 2 和 3 是同时的，但 Endpoint 摘除有传播延迟（kube-proxy 更新 iptables 规则）。**

可能出现：SIGTERM 已经发了，但某些客户端的 iptables 规则还没更新——还在往这个 Pod 发新请求。如果应用收到 SIGTERM 立刻退出，这些请求就失败了。

**解决：preStop hook 延迟退出。**

```yaml
spec:
  terminationGracePeriodSeconds: 60
  containers:
    - name: api
      lifecycle:
        preStop:
          exec:
            command: ["sh", "-c", "sleep 15 && curl -X POST http://localhost:8080/shutdown"]
```

**preStop hook 在 SIGTERM 之前执行**。`sleep 15` 给 K8s 15 秒时间把 Pod 从所有节点的 Endpoint 摘除——15 秒后，没有任何新请求进来，此时再处理优雅停机。

**HTTP 服务的优雅停机**（NestJS 伪代码）：

```typescript
process.on('SIGTERM', async () => {
  logger.info('received SIGTERM, shutting down gracefully');
  
  server.close();           // 1. 停止接受新连接
  await closeDatabase();     // 2. 等待进行中的请求处理完（server.close 会等）
  await redis.quit();        // 3. 关闭 Redis 连接
  process.exit(0);           // 4. 退出
});
```

- `server.close()`：停止接受新连接，但**等已建立的连接处理完**。
- 等所有请求处理完，关闭资源，退出。

**AI 生成长请求的处理**：

问题：AI 生成可能要 30 秒。如果 grace period 是 30 秒，正好卡边界——可能没处理完就被 SIGKILL。

解决：

1. **加大 grace period**：`terminationGracePeriodSeconds: 120`（2 分钟），给长请求足够时间。
2. **请求方做重试**：如果真的被杀（极端情况），请求方重试到新 Pod。
3. **异步化**：长任务不阻塞 HTTP 请求，改成任务队列（Worker 异步处理，HTTP 立即返回任务 ID）。这是我们的做法——AI 生成是异步任务，HTTP 只创建任务，Worker 处理。滚动更新杀的是 Worker（前面讲了 Worker 的优雅停机）或 API（短请求，秒级完）。

---

**🎤 面试官继续追问**

> 如果新版本有 Bug，发出去发现线上炸了，怎么回滚？

**🙋 候选人回答**

K8s 的 Deployment 原生支持回滚——它保留了历史版本（Revision）。

**回滚命令**：

```bash
# 查看发布历史
kubectl rollout history deployment/go-task-center
# 输出：
# deployment.apps/go-task-center
# REVISION  CHANGE-CAUSE
# 1         kubectl create --image=v1.2.2
# 2         kubectl create --image=v1.2.3
# 3         kubectl create --image=v1.2.4   ← 当前

# 回滚到上一个版本
kubectl rollout undo deployment/go-task-center

# 回滚到指定版本
kubectl rollout undo deployment/go-task-center --to-revision=1

# 监控滚动更新状态
kubectl rollout status deployment/go-task-center
```

**revisionHistoryLimit**：保留多少个历史版本（默认 10）。我们配 5 个够用。

**但生产回滚不能靠手动 kubectl——要靠 CI/CD 自动化。**

**我们的发布和回滚流程**：

```
① CI 构建镜像 v1.2.4，推到 registry
② CI 执行 kubectl set image deployment/go-task-center go-task-center=v1.2.4
   （或 helm upgrade）
③ K8s 滚动更新
④ 监控报警系统观察 5-10 分钟：
   - 错误率有没有升
   - 延迟有没有升
   - 业务指标有没有异常
⑤ 如果异常 → 自动触发回滚（Argo Rollouts 或自研脚本）
   kubectl rollout undo deployment/go-task-center
⑥ 如果正常 → 发布完成
```

**关键设计：自动监控 + 自动回滚。**

人肉盯着发布不现实（半夜发版呢）。我们用 **Argo Rollouts**：

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
spec:
  strategy:
    canary:                    # 金丝雀发布
      steps:
        - setWeight: 10         # 先 10% 流量到新版本
        - pause: { duration: 5m }  # 观察 5 分钟
        - analysis:             # 自动分析指标
            templates:
              - templateName: error-rate-check
        - setWeight: 50         # 没问题，扩到 50%
        - pause: { duration: 5m }
        - setWeight: 100        # 全量
```

Argo Rollouts 在每个阶段检查指标（Prometheus）——错误率超阈值自动回滚，不用人干预。

**金丝雀 vs 滚动更新的区别**：

- **滚动更新**：按 Pod 逐步替换（先 1 个新 Pod，再 2 个...）。
- **金丝雀**：按流量比例逐步切换（先 10% 流量到新版本，再 50%，再 100%）。

金丝雀更精细——可以"只让 10% 用户用新版本"，发现问题影响小。滚动更新是"Pod 数量比例"，不好控制流量比例。

**我们的实践**：

- 普通发布：滚动更新（maxUnavailable: 0, maxSurge: 1）。
- 大版本发布：金丝雀（Argo Rollouts，10% → 50% → 100%）。
- 紧急修复：滚动更新 + 密切监控。

**回滚不是失败——是正常的发布工具。** 设计好的系统应该"随时能回滚"，而不是"祈祷新版没问题"。

### 🏗 架构分析

**滚动更新参数对比**

| 参数 | 含义 | 我们的配置 |
|------|------|-----------|
| maxSurge | 最多超出 replicas 数 | 1（先建新再删旧） |
| maxUnavailable | 最多少于 replicas 数 | 0（始终保持可用数） |
| terminationGracePeriodSeconds | 优雅停机等待时间 | 60-120（按最长请求定） |

**零停机关键**：maxUnavailable: 0 + readinessProbe + preStop hook + 优雅停机。

**回滚策略**：

| 场景 | 策略 | 工具 |
|------|------|------|
| 普通发布 | 滚动更新 | Deployment |
| 大版本 | 金丝雀 | Argo Rollouts |
| 紧急回滚 | rollout undo | kubectl/CI |

**核心原则**：发布是可逆的（随时能回滚），回滚自动化（监控触发，不靠人）。

### 🎯 面试官真正考察什么

1. **maxSurge/maxUnavailable**：知不知道怎么配零停机（maxUnavailable: 0）？
2. **优雅停机**：preStop hook + SIGTERM + server.close 的完整链路。为什么不能直接杀？
3. **回滚策略**：不只是 kubectl undo，还有金丝雀 + 自动回滚（Argo Rollouts）。

### ❌ 常见错误回答

- **maxUnavailable: 1**：更新时少一个 Pod，如果 replicas 少可能中断服务。
- **没有 preStop hook**：SIGTERM 时还有新请求进来，导致 5xx。
- **回滚靠人肉**：半夜发版盯不住。

### ✅ 推荐回答

> K8s 滚动更新（RollingUpdate）逐步用新 Pod 替换旧 Pod。关键参数 maxSurge（最多超出 replicas 数）和 maxUnavailable（最多少于 replicas 数）。零停机配置 maxUnavailable: 0 + maxSurge: 1——始终保持 replicas 个可用 Pod，先建新 Pod 等 readinessProbe 通过再删旧 Pod。优雅停机链路：K8s 标记 Pod Terminating + 从 Endpoint 摘除（有延迟）+ 发 SIGTERM。坑是 Endpoint 摘除有传播延迟，SIGTERM 后可能还有新请求进来——用 preStop hook sleep 15 秒等 Endpoint 全部更新。应用收到 SIGTERM 调 server.close()（停止接受新连接但等已建立连接处理完）+ 关资源 + 退出。AI 长任务不阻塞 HTTP 改异步队列（Worker 处理），terminationGracePeriodSeconds 按最长请求配 60-120 秒。回滚：kubectl rollout undo（Deployment 保留 revisionHistoryLimit 个历史版本）。生产用 Argo Rollouts 金丝雀发布——10% 流量观察 5 分钟+自动分析错误率，超阈值自动回滚。核心：发布可逆、回滚自动化不靠人肉盯。

### 📚 延伸知识

- **Argo Rollouts**：K8s 的高级发布工具。支持金丝雀、蓝绿部署、自动分析（Prometheus/Datadog 指标）、自动回滚。比原生 Deployment 的滚动更新强。
- **蓝绿部署**：准备两套环境（蓝/绿），切换流量。比金丝雀简单但资源占用翻倍。适合数据库 schema 变更等需要"瞬间切换"的场景。
- **Feature Flag**：发布和功能上线解耦。代码先发布（功能用 flag 关着），再通过打开 flag 灰度上线。出问题关 flag 即"回滚"，不用重新发布。

---

## 本章总结

第十二章用 10 道题覆盖了 Docker 和 Kubernetes 的核心知识。回顾关键决策：

| 主题 | 核心决策 | 理由 |
|------|----------|------|
| Docker 原理 | namespace（隔离）+ cgroups（限制）+ 共享内核 | 进程级隔离，轻量但需设资源限制 |
| Dockerfile | 多阶段构建 + 缓存层优化 + 最小镜像 | Go 服务 800MB→20MB，构建快 |
| 基础镜像 | Go→distroless、Python→debian-slim、Node→alpine | 按语言特性选，不无脑 alpine |
| Docker 网络 | 开发自定义 bridge，生产用 K8s CNI | 自定义 bridge 有 DNS，CNI 跨机 |
| 数据持久化 | Docker Volume / K8s PV+PVC | 有状态用 StatefulSet，日志走 stdout+采集 |
| compose vs K8s | 开发用 compose，生产用 K8s | compose 缺扩缩容/自愈/滚动更新 |
| K8s 概念 | Ingress→Service→Deployment→Pod | 四层抽象，关注点分离 |
| probe | liveness（重启）/readiness（摘流量）分开 | 避免依赖抖动重启雪崩 |
| Service 类型 | 内部 ClusterIP，对外 Ingress | 一个 LB+Ingress 复用，省成本 |
| 配置管理 | ConfigMap（非敏感）+ Secret（敏感） | 一镜像跑所有环境 |
| Secret 安全 | base64 非加密，用 Vault/etcd 加密 | 密钥不进镜像/Git/日志 |
| HPA | 自定义指标（Redis 队列长度） | Worker I/O 密集，CPU 不反映负载 |
| 滚动更新 | maxUnavailable: 0 + 优雅停机 | 零停机 + preStop 防 5xx |
| 回滚 | Argo Rollouts 金丝雀 + 自动回滚 | 发布可逆、回滚自动化 |

**贯穿本章的核心原则**：

1. **一个镜像跑所有环境**：配置通过 ConfigMap/Secret 注入，不把配置打进镜像。
2. **不可变 + 声明式**：镜像不可变，K8s 声明式 reconcile 持续保证状态。
3. **无状态优先**：服务设计成无状态（状态放 Redis/DB），才能水平扩缩和滚动更新。
4. **优雅停机是标配**：扩容容易缩容难，杀 Pod 前要 drain 流量、等任务处理完。
5. **发布可逆**：随时能回滚，回滚自动化（监控触发），不靠人肉盯。
