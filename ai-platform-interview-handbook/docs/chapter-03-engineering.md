# 第三章 工程化

> 第二章讲了"为什么做工程化"和优先级排序。本章深入每个工程化设施的设计细节——组件库、工具库、CLI、Monorepo、Storybook、统一 Logger/Request/Config、CI、规范。
>
> 工程化的核心不是"用了什么工具"，而是"每个工具解决什么问题、怎么和团队现状结合"。本章共 12 题。

---

## Q1. 为什么做组件库？

**🎤 面试官**

> 组件库听起来是标配，但很多公司做了组件库最后没人用，沦为"简历项目"。你们做组件库解决了什么真问题？

**🙋 候选人回答**

先说做组件库之前的真实痛点。

我们有三个前端项目——漫剧编辑器、视频编辑器、管理后台。每个项目都有自己的组件目录。有一次我发现一个 Bug：漫剧编辑器的"图片上传组件"在上传失败时不显示错误提示。我修了。过了一周，视频编辑器的 PM 反馈"上传失败没有错误提示"——同样的 Bug，因为视频编辑器有一份几乎相同但独立维护的代码。

这种事不是个例。我们统计过：三个项目里，有 15+ 个组件是重复的（按钮、表单、上传、表格、弹窗等），每个都各自维护一份。结果是：

1. **Bug 修 N 遍**：同一个 Bug 在不同项目各修一次，而且经常漏修。
2. **视觉不一致**：同样的按钮，三个项目颜色、间距微妙不同，因为各自调过。
3. **新人困惑**：新前端入职，每个项目的组件 API 不一样，要分别学。

组件库解决的核心问题不是"代码复用"——是**"一致性"和"可维护性"**。代码复用是手段，一致性和可维护性才是目的。

很多人做组件库是冲着"代码复用"去的，但如果你只是想复用代码，复制粘贴也能复用。组件库的真正价值是**建立单一事实来源（Single Source of Truth）**——所有项目用的按钮都来自同一个地方，改一处全部同步。

---

**🎤 面试官追问**

> 你说"单一事实来源"，但业务团队会担心：组件库改了一个组件，影响了所有项目，风险怎么控制？

**🙋 候选人回答**

这是组件库最大的挑战——**变更影响面大**。我们用三层机制控制：

**① 语义化版本（SemVer）**

组件库严格遵循 semver：

- `1.0.0 → 1.0.1`（patch）：修 Bug，不破坏行为。自动升级。
- `1.0.1 → 1.1.0`（minor）：新增功能，向后兼容。自动升级。
- `1.1.0 → 2.0.0`（major）：破坏性变更。**必须手动升级**，项目方主动改版本号。

关键设计：**minor 和 patch 自动升级（通过 `^1.0.0` 的版本范围），major 不自动升级**。这样"改了组件所有项目同步"只发生在非破坏性变更时。破坏性变更项目方有控制权——你选什么时候升级。

**② 变更日志（CHANGELOG）**

每次发版自动生成 CHANGELOG（基于 conventional commits）。项目方升级前看 CHANGELOG 就知道改了什么、有没有风险。

**③ 组件废弃流程（Deprecation）**

不直接删旧 API，而是标记 `@deprecated`，同时提供新 API。给项目方一个迁移周期。比如：

```typescript
/** @deprecated 使用 onClick 替代，v3.0 将移除 */
onConfirm?: () => void;

/** 新的点击回调 */
onClick?: () => void;
```

IDE 会显示删除线提示开发者迁移。等所有项目迁移完，下个大版本才真正删除。

**这三层机制的本质是：让变更可预测。** 非破坏性变更自动同步（省心），破坏性变更手动控制（安全），中间有 deprecation 缓冲（不突兀）。

---

**🎤 面试官继续追问**

> 你怎么决定一个组件该不该进组件库？有些组件可能只有一个项目用，进了组件库反而是负担。

**🙋 候选人回答**

用第二章的"三个实例法则"——一个组件被两个以上项目需要，才考虑进组件库。只一个项目用的，留在项目里。

但还有一种情况：**虽然现在只有一个项目用，但它代表了一个"模式"，未来其他项目大概率会用到。** 这种要不要提前进组件库？

我的判断标准是：**这个组件的"业务逻辑含量"有多高？**

- **低业务逻辑**（如 Button、Input、Modal）：纯 UI，和业务无关。即使只一个项目用也可以进——因为它本质是通用的，进库只是"提前归位"。
- **高业务逻辑**（如"漫剧分镜编辑器"）：深度绑定业务。即使两个项目用也不该进——因为它的"通用"是表面的，不同项目的业务细节迟早分化。

举例：我们有一个"图片裁剪组件"——两个项目用，但裁剪逻辑不同（漫剧裁 9:16，视频裁 16:9）。如果把它做成一个"通用裁剪组件"带一堆配置项，反而比两个项目各写一个更复杂。最终我们把裁剪组件拆成两层：

```
基础层（组件库）：CropperCanvas — 只负责画布交互，无业务逻辑
业务层（各项目）：DramaCropper / VideoCropper — 各自配置比例和逻辑
```

**组件库提供"积木"，不提供"成品"。** 积木是低业务逻辑的通用件，成品是业务方自己拼的。

### 🏗 架构分析

**组件库的价值模型**

| 不做组件库 | 做组件库 |
|-----------|----------|
| Bug 修 N 遍 | 修一次全同步 |
| 视觉不一致 | 单一事实来源 |
| 新人学 N 套 API | 学一套 |
| 灵活但混乱 | 一致但需控制变更 |

**变更控制三机制**：SemVer（major 不自动升级）+ CHANGELOG（变更可追溯）+ Deprecation（缓冲迁移）。

**入库标准**：三个实例法则 + 低业务逻辑。组件库提供积木不提供成品。

### 🎯 面试官真正考察什么

1. **动机真实性**：做组件库是解决一致性问题，不是"简历好看"。能不能说出具体的重复 Bug 场景？
2. **变更控制意识**：组件库最大的风险是"改一处影响全部"，有没有版本管理和 deprecation 机制？
3. **入库判断力**：什么该进组件库什么不该？高业务逻辑组件不该入库。

### ❌ 常见错误回答

- **"复用代码"**：复用是手段不是目的，目的是一致性和可维护性。
- **没有变更控制**："改了大家自动更新。"——破坏性变更自动更新是灾难。
- **什么都往里塞**：把业务组件也放组件库，变成大杂烩。

### ✅ 推荐回答

> 做组件库前三个项目有 15+ 重复组件，Bug 修 N 遍、视觉不一致、新人学 N 套 API。组件库的核心价值是建立单一事实来源——改一处全同步，不是单纯复用代码。变更风险用三层控制：SemVer（patch/minor 自动升级、major 手动）、CHANGELOG（自动生成变更日志）、Deprecation 流程（旧 API 标记 deprecated 给迁移周期不直接删）。入库标准：三个实例法则 + 低业务逻辑。组件库提供积木（CropperCanvas）不提供成品（DramaCropper）——高业务逻辑组件即使两个项目用也不入库。

### 📚 延伸知识

- **Single Source of Truth (SSOT)**：系统设计的基本原则——每个事实只在一个地方定义。组件库是前端 UI 的 SSOT。
- **Conventional Commits**：`feat:`, `fix:`, `BREAKING CHANGE:` 等规范化的 commit 格式，可自动生成 CHANGELOG 和计算版本号。工具：semantic-release、changesets。

---

## Q2. 组件库的技术选型和实现

**🎤 面试官**

> 你们的组件库用什么技术栈？React 组件库有好多方案——自己搭、用 Radix UI、用 Ant Design 二次封装，你们选了哪条路？

**🙋 候选人回答**

我们选的是 **Radix UI + Tailwind CSS 的组合**，而不是 Ant Design 二次封装，也不是从零自研。

先说为什么不选另外两条路：

**为什么不选 Ant Design 二次封装？**

Ant Design 是"成品组件库"——它有完整的设计语言和实现。二次封装意味着你要在它上面再包一层，问题是：

1. **样式覆盖痛苦**：Ant Design 的样式用 CSS-in-JS（antd v4）或 CSS 变量（v5），覆盖样式经常要 `!important` 或用 ConfigProvider hack。
2. **升级困难**：Ant Design 大版本升级（v4→v5）是破坏性的，你的二次封装层要跟着改。等于维护两层（AntD 本身 + 你的封装）。
3. **设计语言受限**：你的 UI 设计师想要一个 AntD 没有的交互，你要和 AntD 的设计体系对抗。

AntD 二次封装适合"设计语言和 AntD 高度一致、不想花精力做设计系统"的团队。但我们的设计师有自己的设计规范，AntD 的风格不匹配。

**为什么不从零自研？**

从零写一个 DatePicker、Combobox、Dialog——这些"无障碍 + 交互复杂"的组件，开发成本极高且容易出 Bug。轮子不是不能造，但要造在有价值的地方。

**我们选 Radix UI + Tailwind 的原因：**

**Radix UI 是"Headless UI"**——它只提供交互逻辑和可访问性（accessibility），不提供样式。你拿到的是"行为正确的组件骨架"，样式完全由你控制。

```tsx
// Radix 的 Dialog：行为正确（焦点管理、ESC 关闭、可访问性），样式自定义
import * as Dialog from '@radix-ui/react-dialog';

<Dialog.Root>
  <Dialog.Trigger className="px-4 py-2 bg-blue-500 text-white rounded">打开</Dialog.Trigger>
  <Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 bg-black/50" />
    <Dialog.Content className="fixed bg-white p-6 rounded-lg">
      <Dialog.Title>标题</Dialog.Title>
      {/* 内容 */}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
```

**Tailwind CSS 提供样式**——用工具类写样式，不用写 CSS 文件。和 Radix 配合天然：Radix 管行为，Tailwind 管外观。

这个组合的好处：

1. **设计自由度**：样式完全自定义，不受 AntD 设计体系限制。
2. **行为可靠**：Radix 处理了复杂的交互逻辑（焦点管理、键盘导航、ARIA 属性），不用自己写。
3. **包体积小**：Radix 是按需引入的，Tree-shaking 友好。Tailwind 只生成用到的样式。
4. **TypeScript 原生**：Radix 和 Tailwind 都有完善的 TS 支持。

---

**🎤 面试官追问**

> Radix UI 是 headless 的，意味着你们要自己写所有样式。这会不会让组件库的开发量很大？

**🙋 候选人回答**

开发量确实比"直接用 AntD"大，但比"从零自研"小很多。关键是**投入产出比**：

从零自研一个 Dialog：要处理焦点陷阱、ESC 关闭、点击外部关闭、Portal 渲染、滚动锁定、ARIA 属性——至少 2-3 天，且容易漏可访问性细节。

用 Radix 写一个 Dialog：行为部分零成本（Radix 处理了），只写样式和布局——半天。

**而且"自己写样式"不是浪费——它是设计系统的载体。** 我们的组件库不只是"可复用的代码"，还是"设计规范的代码化"。每个组件的样式（颜色、间距、圆角）都对应设计规范里的一个定义。自己写样式 = 把设计规范落地成代码。

为了让"写样式"高效，我们做了两件事：

**① 设计 Token 系统**

把设计规范抽象成 CSS 变量 / Tailwind 配置：

```js
// tailwind.config.js
export default {
  theme: {
    extend: {
      colors: {
        primary: { 500: '#3B82F6', 600: '#2563EB' },  // 品牌色
        danger: { 500: '#EF4444' },                    // 危险色
      },
      spacing: {
        'xs': '4px', 'sm': '8px', 'md': '16px',       // 间距规范
      },
      borderRadius: {
        'sm': '4px', 'md': '8px',                      // 圆角规范
      },
    },
  },
}
```

组件库的所有组件都用这些 token，不用硬编码颜色值。设计师改了主色，只改 token 配置，所有组件自动更新。

**② 组件模板化**

常见组件（Button、Input、Card）的样式模式是固定的——就是 Tailwind 类的组合。我们提取了常用类组合：

```tsx
// 按钮的基础样式
const buttonBase = 'inline-flex items-center justify-center rounded-md font-medium transition-colors';
const buttonVariants = {
  primary: 'bg-primary-500 text-white hover:bg-primary-600',
  ghost: 'bg-transparent hover:bg-gray-100',
  danger: 'bg-danger-500 text-white hover:bg-red-600',
};
const buttonSizes = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-base',
  lg: 'h-12 px-6 text-lg',
};
```

写一个新组件时，大部分样式是复用已有的模式，不是从零写。

---

**🎤 面试官继续追问**

> 你们组件库怎么打包发布？用 webpack 还是 rollup？怎么处理样式？

**🙋 候选人回答**

用 **tsup（基于 esbuild）** 打包，不是 webpack 也不是 rollup 直接用。

选 tsup 的原因：

1. **零配置**：tsup 基于 esbuild，几乎不需要配置就能打包 TS 库。
2. **快**：esbuild 比 webpack/rollup 快 10-100 倍。
3. **多格式输出**：同时输出 ESM 和 CJS，适配不同消费方式。

打包配置：

```ts
// tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],        // 入口
  format: ['esm', 'cjs'],         // 双格式
  dts: true,                      // 生成类型声明
  treeshake: true,                // 支持摇树
  external: ['react', 'react-dom', '@radix-ui/*'],  // 不打包依赖
});
```

**样式处理**——这是组件库的一个关键决策点。我们选了 **Tailwind + CSS Variables** 而非 CSS-in-JS：

```css
/* 组件库的样式入口 */
:root {
  --color-primary-500: #3B82F6;
  --color-danger-500: #EF4444;
  /* ... */
}

/* 组件样式用 Tailwind 生成 */
.btn-primary {
  background-color: var(--color-primary-500);
}
```

**为什么不用 CSS-in-JS（styled-components/emotion）？**

1. **运行时开销**：CSS-in-JS 在运行时生成样式，有性能成本。Tailwind 是构建时生成，零运行时。
2. **包体积**：CSS-in-JS 库本身有体积（styled-components ~12KB gzipped）。Tailwind 的样式在构建时只生成用到的类。
3. **冲突风险**：消费组件库的项目如果也用 CSS-in-JS，可能和组件库的 CSS-in-JS 冲突（styled-components 的版本不一致是经典坑）。

**外部样式覆盖**——消费方如果要改组件样式，用 CSS 变量覆盖：

```css
/* 消费方覆盖品牌色 */
:root {
  --color-primary-500: #FF0000;  /* 改成红色 */
}
```

不用 `!important`，不用 hack ConfigProvider，改一个 CSS 变量全局生效。

### 🏗 架构分析

**组件库技术方案对比**

| 方案 | 开发速度 | 设计自由度 | 升级成本 | 包体积 |
|------|----------|-----------|----------|--------|
| AntD 二次封装 | 快 | 低 | 高（跟 AntD 升级） | 大 |
| 从零自研 | 慢 | 最高 | 低 | 小 |
| Radix + Tailwind | 中 | 高 | 低 | 小 |

**选 Radix + Tailwind 的原因**：设计自由度高（不和 AntD 设计体系对抗）+ 行为可靠（Radix 处理交互逻辑）+ 零运行时（Tailwind 构建时生成）。

**打包方案**：tsup（esbuild）双格式输出 + CSS 变量主题化。不用 CSS-in-JS 避免运行时开销和版本冲突。

### 🎯 面试官真正考察什么

1. **选型思考**：AntD/Radix/自研三条路，有没有分析过各自优劣？还是"大家用什么我用什么"？
2. **设计系统意识**：组件库不只是代码，还是设计规范的代码化。Token 系统体现这个意识。
3. **工程细节**：打包工具、样式方案、外部覆盖——这些细节体现真正的库开发经验。

### ❌ 常见错误回答

- **"用 AntD"**：不问设计需求就用 AntD，可能和设计体系冲突。
- **"从零写"**：不评估成本，重复造轮子。
- **CSS-in-JS 无脑选**：不考虑运行时开销和消费方冲突。

### ✅ 推荐回答

> 选 Radix UI + Tailwind CSS。不选 AntD 二次封装因为样式覆盖痛苦、升级困难、设计语言受限。不从零自研因为复杂组件（Dialog/Combobox）的交互逻辑和可访问性开发成本高。Radix 是 headless UI 提供行为逻辑不提供样式，Tailwind 提供样式，组合后设计自由度高 + 行为可靠 + 零运行时。开发效率靠设计 Token 系统（CSS 变量统一管理颜色间距圆角）+ 样式模式复用。打包用 tsup（esbuild）双格式 ESM+CJS 输出。样式不用 CSS-in-JS 避免运行时开销和版本冲突，用 Tailwind + CSS 变量，消费方覆盖样式只需改 CSS 变量不用 !important。

### 📚 延伸知识

- **Headless UI 趋势**：Radix UI、Headless UI（Tailwind Labs）、React Aria 是三大 headless 库。趋势是"行为和样式分离"——库管行为，开发者管样式。
- **Design Tokens**：W3C 正在标准化的设计令牌规范（Design Tokens Format Module）。把设计规范抽象为机器可读的 token，跨平台共享（Web/iOS/Android）。

---

## Q3. 为什么做工具库？

**🎤 面试官**

> 你说的组件库我理解，但工具库是什么？和组件库有什么区别？

**🙋 候选人回答**

**组件库管 UI，工具库管逻辑。** 组件库是"看得见的复用"（按钮、表单），工具库是"看不见的复用"（请求封装、 hooks、工具函数）。

我们的工具库分三块：

**① 请求库（@myorg/request）**

封装 fetch/axios，统一处理：错误处理、重试、超时、请求/响应拦截、Token 注入。

**② Hooks 库（@myorg/hooks）**

通用 React Hooks：useDebounce、useLocalStorage、usePagination、useWebSocket 等。

**③ Utils 库（@myorg/utils）**

纯函数工具：日期格式化、金额计算、深拷贝、树结构操作等。

**为什么要单独抽工具库而不是放组件库里？**

因为它们的**消费方式不同**：

- 组件库：前端项目用，依赖 React 运行时。
- Hooks 库：前端项目用，依赖 React 运行时。
- 请求库：前端和 Node（BFF）都能用，不依赖 React。
- Utils 库：前端和 Node 都能用，零依赖。

如果把它们塞进组件库，那 Node 项目为了用一个日期格式化函数要装整个组件库（含 React）——依赖污染。分开后，各取所需。

**这也是为什么我们用 Monorepo**——多个包统一管理但独立发布。请求库和 Utils 库可以被 Node 项目消费，不拉 React 依赖。

---

**🎤 面试官追问**

> 请求库具体封装了什么？直接用 axios 不行吗？

**🙋 候选人回答**

axios 好用，但在多项目环境下直接用有三个问题：

**① 每个 project 各自封装一遍**

axios 本身只是 HTTP 客户端，但业务需要：统一错误处理（401 跳登录、500 提示）、统一 loading、统一 Token 注入、统一日志。每个项目都做一遍这些封装，代码重复且行为不一致。

**② 错误处理散落**

有的项目把错误处理写在 axios interceptor 里，有的写在业务代码的 catch 里，有的写在全局 error boundary 里。同一个 401 错误，三个项目的处理方式不同。

**③ 升级困难**

axios 从 0.x 到 1.x 有 breaking changes。如果每个项目自己管 axios 依赖，升级时要改 N 个项目。

我们的 @myorg/request 封装了这些：

```typescript
import { createRequest } from '@myorg/request';

const request = createRequest({
  baseURL: '/api',
  timeout: 10000,
  retries: 3,                    // 自动重试
  retryDelay: 1000,
  interceptors: {
    request: (config) => {
      config.headers.Authorization = `Bearer ${getToken()}`;  // Token 注入
      return config;
    },
    response: (response) => {
      // 统一错误处理
      if (response.status === 401) {
        redirectToLogin();
      }
      return response.data;       // 直接返回 data
    },
    error: (error) => {
      // 网络错误重试
      if (error.code === 'NETWORK_ERROR') {
        return retry(error);
      }
      throw error;
    },
  },
});

// 业务代码直接用
const data = await request.get('/users');
```

**关键设计：createRequest 工厂函数**。不同项目可以传不同配置（不同的 baseURL、不同的 interceptor），但底层逻辑统一。这不是"强制一个配置"，而是"提供一套框架，各项目定制"。

---

**🎤 面试官继续追问**

> 你们的 Hooks 库里有没有什么比较值得说的 Hook？不只是 useDebounce 这种常规的。

**🙋 候选人回答**

说一个我们实际用得最多的——**useWebSocket**。

因为 Task Platform 用 WebSocket 推任务进度，前端需要管理 WebSocket 连接。但裸用 WebSocket 有很多问题：断线重连、消息队列、心跳检测、多组件共享连接。如果每个业务组件自己 `new WebSocket()`，会有多个连接、没有重连、消息丢失。

我们的 useWebSocket 封装了这些：

```typescript
function useWebSocket(url: string, options?: {
  onMessage?: (data: any) => void;
  reconnect?: boolean;      // 默认 true
  reconnectInterval?: number; // 默认 3000
  heartbeat?: boolean;      // 默认 true
}) {
  // 内部实现：
  // 1. 单例连接管理（同 URL 共享一个 WebSocket）
  // 2. 断线自动重连（指数退避）
  // 3. 心跳检测（30s 发一次 ping）
  // 4. 消息分发（多个组件订阅同一个连接的消息）
  // 5. 组件卸载时不关闭连接（引用计数，最后一个卸载才关）
  
  return { connected, send };
}
```

**最关键的设计是"单例 + 引用计数"**：

```typescript
// 多个组件用同一个 URL，共享一个连接
function TaskProgress({ taskId }) {
  const { connected, send } = useWebSocket(`ws://.../tasks/${taskId}`);
  // ...
}

function TaskList() {
  // 另一个组件也连同一个 URL
  const { connected } = useWebSocket(`ws://.../tasks/all`);
  // ...
}
```

如果不做单例，两个组件各建一个 WebSocket 连接——浪费资源且可能触发服务端连接数限制。单例保证一个 URL 只有一个连接，消息通过内部的事件分发机制给到所有订阅者。组件卸载时不直接关连接，而是减引用计数，归零才关。

**这个 Hook 的价值不在于"封装了 WebSocket API"，而在于"解决了多组件共享连接的生命周期管理问题"**——这是实际开发中真正的痛点。

### 🏗 架构分析

**工具库的分层**

```
@myorg/utils     ← 零依赖，前端+Node 通用
@myorg/request   ← 依赖 utils，前端+Node 通用
@myorg/hooks     ← 依赖 react，前端专用
@myorg/components ← 依赖 react + hooks + request
```

**分层原则**：依赖只能向下，不能向上。utils 不依赖任何 @myorg 包，request 依赖 utils，hooks 依赖 utils，components 依赖所有。这样 Node 项目可以只装 utils + request，不拉 React。

**Monorepo 的价值在这里体现**：多个包统一管理依赖关系，但独立发布。如果不用 Monorepo，跨包的依赖管理会非常痛苦。

### 🎯 面试官真正考察什么

1. **分层意识**：工具库和组件库的消费场景不同（Node vs 前端），能不能说清楚为什么分开？
2. **封装深度**：请求库不只是"包了一层 axios"，而是统一了错误处理、重试、拦截。useWebSocket 不只是"包了 WebSocket API"，而是解决了连接共享和重连。
3. **实际痛点驱动**：封装是基于真实痛点（每个项目各封一遍、多组件多连接），不是为了封装而封装。

### ❌ 常见错误回答

- **"工具库放通用函数"**：没有分层意识，混在一起导致依赖污染。
- **"axios 够用了"**：没考虑多项目的统一性和一致性。
- **useWebSocket 只说 API**：只讲 `new WebSocket()` 的封装，不解决重连和共享。

### ✅ 推荐回答

> 工具库管逻辑，组件库管 UI。分三块：@myorg/utils（零依赖纯函数，前端+Node 通用）、@myorg/request（封装 axios 统一错误处理/重试/Token/拦截，createRequest 工厂让各项目定制配置但底层统一）、@myorg/hooks（通用 Hooks）。分开是因为消费方式不同——Node 项目用 utils 和 request 不该拉 React 依赖。useWebSocket 是最有价值的 Hook：单例+引用计数实现多组件共享连接、断线指数退避重连、心跳检测、消息分发。解决的不是"封装 API"而是"多组件共享连接的生命周期管理"。分层原则：依赖只向下不向上，utils→request→hooks→components。

### 📚 延伸知识

- **Monorepo 包依赖管理**：pnpm workspace 用 `workspace:*` 协议引用内部包，构建时自动处理依赖关系，发布时自动替换为真实版本号。
- **WebSocket 连接管理**：参考 socket.io 的连接管理设计——命名空间、房间、多路复用。我们的单例方案是简化版。

---

## Q4. 为什么做脚手架 CLI？

**🎤 面试官**

> 创建项目手动跑个 `npm create vite` 不就行了，为什么要自己做脚手架 CLI？

**🙋 候选人回答**

`npm create vite` 创建的是一个**通用项目**——只有 Vite + React 的最基础配置。但我们的项目需要的不止这些：

- 组件库依赖（@myorg/components, @myorg/request, @myorg/hooks）
- ESLint + Prettier 配置（和团队一致）
- CI 配置（.github/workflows 或 .gitlab-ci.yml）
- 目录结构规范（src/components, src/hooks, src/services, src/utils）
- 环境变量模板（.env.example）
- 路由配置（React Router 初始化）
- 请求库初始化（createRequest 配好 baseURL）

如果用 `npm create vite`，开发者要手动做以上所有事——每次建新项目重复一遍，且容易漏配（比如忘了配 ESLint，或者配了但和团队不一致）。

我们的 CLI 做的事：

```bash
$ npx @myorg/create-app my-project

? 选择项目类型：
  ❯ React 应用（SPA）
    React 组件库
    Node 服务（NestJS）

? 是否需要路由？ (Y/n)

? 是否需要 WebSocket？ (Y/n)

✅ 创建项目 my-project
✅ 安装依赖
✅ 初始化 Git
✅ 生成 CI 配置
✅ 生成 ESLint/Prettier 配置
✅ 生成目录结构
✅ 生成 README

$ cd my-project && npm run dev
```

**CLI 的核心价值是"把规范固化到工具里"**。规范写在文档里，人会忘、会偷懒；固化到 CLI 里，每次建项目自动遵守。这是"规范工具化"——把人的自觉变成工具的强制。

---

**🎤 面试官追问**

> 你说"固化规范"，但规范会变。CLI 更新了，老项目不会自动更新。这个怎么处理？

**🙋 候选人回答**

对，这是 CLI 的局限——**只管新项目，不管老项目**。CLI 更新后，之前创建的项目不会变。

我们的处理方式分两层：

**① 脚手架只管"初始状态"，不管"持续更新"**

脚手架生成的配置（ESLint、CI、目录结构）是"起点"。之后的更新通过**共享配置包**来分发：

```json
// 项目的 .eslintrc.js
module.exports = {
  extends: '@myorg/eslint-config',  // 引用共享包，不自己写规则
};
```

ESLint 规则不在脚手架里硬编码，而是放在 `@myorg/eslint-config` 包里。脚手架只是帮项目装上这个包。之后规则更新了，项目升级 `@myorg/eslint-config` 的版本就行——不用改脚手架、不用重新建项目。

**② 脚手架版本管理**

脚手架自身用 semver。大改动（比如 Vite 4→5）发 major 版本。项目方可以选择用旧版脚手架建项目（兼容性）还是新版。

**核心思路：脚手架负责"组装"，共享配置包负责"内容"。** 脚手架把各种 @myorg 包组装成一个项目骨架，但具体的规则和配置由各包自己维护和更新。这样脚手架不需要频繁更新——除非项目结构变了。

---

**🎤 面试官继续追问**

> CLI 怎么实现的？用什么技术？

**🙋 候选人回答**

用 **Node.js + 几个库** 实现：

- **commander**：CLI 参数解析（`create-app <name>`、`--template`）
- **inquirer**：交互式提示（选择项目类型、是否需要路由）
- **plop / handlebars**：模板引擎（根据用户选择渲染配置文件）
- **fs-extra**：文件操作（复制目录、写文件）

核心逻辑很简单：

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import inquirer from 'inquirer';
import { copyTemplate, renderTemplate } from './utils';

const program = new Command();

program
  .command('create <name>')
  .action(async (name: string) => {
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'type',
        message: '选择项目类型：',
        choices: ['React SPA', 'React 组件库', 'NestJS 服务'],
      },
      {
        type: 'confirm',
        name: 'router',
        message: '是否需要路由？',
      },
    ]);

    // 根据 type 选择模板目录
    const templateDir = path.join(__dirname, 'templates', answers.type);
    
    // 复制基础模板
    await copyTemplate(templateDir, `./${name}`);
    
    // 根据选择渲染条件模板（如路由配置）
    if (answers.router) {
      await renderTemplate('router.ts.hbs', `./${name}/src/router.ts`, { name });
    }
    
    // 安装依赖
    await installDeps(`./${name}`);
    
    // 初始化 Git
    await initGit(`./${name}`);
    
    console.log(`✅ 项目 ${name} 创建完成`);
  });

program.parse();
```

**模板组织方式**：

```
@myorg/create-app/
├── src/
│   └── index.ts
└── templates/
    ├── react-spa/          ← React SPA 模板
    │   ├── package.json
    │   ├── .eslintrc.js
    │   ├── src/
    │   └── ...
    ├── react-library/      ← 组件库模板
    └── nestjs-service/     ← NestJS 模板
```

模板就是真实的文件目录，CLI 做的事就是"复制目录 + 根据用户选择渲染条件文件"。不需要复杂的代码生成逻辑。

### 🏗 架构分析

**脚手架 vs 手动建项目**

| 方式 | 耗时 | 一致性 | 可维护性 |
|------|------|--------|----------|
| 手动 | 30-60 分钟 | 低（人决定） | 差 |
| 脚手架 | 1 分钟 | 高（工具决定） | 好 |

**脚手架的分层**：CLI 负责"组装"（把模板 + 共享包拼成项目），共享配置包负责"内容"（ESLint 规则等）。这样 CLI 不用频繁更新。

### 🎯 面试官真正考察什么

1. **规范工具化意识**：规范不靠文档靠工具——这是工程化的高级认知。
2. **更新策略**：CLI 只管新项目，老项目怎么办？共享配置包是关键。
3. **实现细节**：CLI 用什么技术？模板怎么组织？

### ❌ 常见错误回答

- **"用 create-react-app"**：CRA 已废弃且不灵活，且不包含团队定制。
- **没有更新策略**：CLI 更新了老项目不管——说明没想全。
- **过度复杂**：CLI 代码生成逻辑太复杂。好的 CLI 就是"复制模板 + 条件渲染"。

### ✅ 推荐回答

> npm create vite 只创建通用项目，我们的项目需要组件库依赖、ESLint 配置、CI、目录结构、环境变量模板——手动每次重复且容易漏配。CLI 把规范固化到工具里，人的自觉变工具强制。关键设计：脚手架只管"组装"（拼模板+共享包），共享配置包（@myorg/eslint-config）管"内容"（具体规则）——这样脚手架不用频繁更新，规则更新走包升级。CLI 更新后老项目通过升级共享配置包获得新规则，不用重建。技术栈：commander（参数）+ inquirer（交互）+ handlebars（模板渲染）+ fs-extra（文件）。模板就是真实文件目录，CLI 做复制+条件渲染。

### 📚 延伸知识

- **Plop.js**：专门做代码生成的工具，适合更复杂的模板场景（如生成组件文件+测试文件+Story 文件）。
- **Degit**：比 `git clone` 更轻量的拉取模板工具，不拉 Git 历史。很多脚手架底层用 degit 拉模板。

---

## Q5. 为什么 Monorepo？

**🎤 面试官**

> 组件库、工具库、CLI、业务项目——这些放在一个仓库里管理，就是 Monorepo。为什么选 Monorepo 而不是每个包一个仓库？

**🙋 候选人回答**

先说 Multirepo（多仓库）的痛点，再说 Monorepo 怎么解决。

**Multirepo 的痛点：**

我们最初是 Multirepo——组件库一个仓库，工具库一个仓库，每个业务项目一个仓库。问题是：

**① 改一个接口要跨 N 个仓库**

组件库改了 Button 的 API，要：改组件库代码 → 发版 → 业务项目升级依赖 → 测试 → 业务项目发版。一个简单的改动涉及 2-3 个仓库的协调，周期长。

**② 本地开发痛苦**

开发组件库时想联调业务项目，要么 link 到本地（npm link 各种坑），要么发一个 beta 版本装到业务项目。调试体验差。

**③ 依赖版本不一致**

组件库用 React 18，业务项目 A 用 React 17，业务项目 B 用 React 18。版本不一致导致 Bug 难复现。

**④ CI 分散**

每个仓库一套 CI 配置，维护成本高，且跨仓库的变更没有统一的 CI 验证（改了组件库，不知道是否 break 了业务项目）。

**Monorepo 怎么解决：**

**① 原子提交**

组件库改 API + 业务项目适配，在一个 PR 里完成。一次提交、一次 Review、一次 CI 验证。

```bash
git commit -m "feat: Button API 重构 + 业务项目适配"
# 包含：
# - packages/components: 改 Button API
# - apps/drama-editor: 适配新 API
# - apps/video-editor: 适配新 API
```

**② 本地联调零成本**

所有包在同一个仓库，import 直接引用源码，不用 link、不用发版：

```typescript
// 业务项目直接引用组件库源码
import { Button } from '@myorg/components';
// pnpm workspace 自动解析到 packages/components/src/index.ts
```

**③ 统一依赖版本**

所有包共享一份 React、TypeScript 等依赖的版本。用 pnpm 的 workspace 机制保证一致性。

**④ 统一 CI**

一次 CI 跑所有受影响的包的测试——改了组件库，自动跑组件库 + 所有依赖它的业务项目的测试。

---

**🎤 面试官追问**

> Monorepo 听起来全是优点，但大公司（Google、Meta）用 Monorepo 是因为他们有自研工具支持。你们用什么工具？Monorepo 的缺点是什么？

**🙋 候选人回答**

我们用 **pnpm workspace**，不是 Lerna，也不是 Nx/Turborepo。

**为什么选 pnpm workspace？**

1. **快**：pnpm 用硬链接 + 内容寻址存储，安装速度比 npm/yarn 快 2-3 倍。
2. **省磁盘**：同一个包只存一份（内容寻址），多个项目共享。
3. **严格**：pnpm 默认不允许"幽灵依赖"（phantom dependencies）——你没用到的包不会出现在 node_modules 里，避免意外引用。
4. **够用**：pnpm workspace 提供了包管理、依赖解析、过滤执行（`pnpm --filter`）等核心功能。对于我们的规模（10-15 个包），不需要 Nx/Turborepo 的任务编排和缓存。

**为什么不用 Lerna？**

Lerna 已基本停止维护（后被 Nx 接管），且 Lerna 基于 npm/yarn，没有 pnpm 的硬链接优势。

**为什么不用 Nx/Turborepo？**

Nx 和 Turborepo 提供任务缓存、依赖图分析、增量构建等高级功能。但我们的规模（10-15 个包）不需要——pnpm 的 `--filter` 就能做增量执行（只跑受影响包的测试）。引入 Nx/Turborepo 增加学习成本和配置复杂度，投入产出比不划算。

**如果规模增长到 50+ 包**，会考虑 Turborepo——它的远程缓存能大幅加速 CI（一个包的构建结果缓存后，其他 PR 不用重复构建）。但目前不需要。

**Monorepo 的缺点：**

| 缺点 | 影响 | 缓解 |
|------|------|------|
| 仓库体积大 | clone 慢 | 浅克隆 + sparse checkout |
| CI 变慢 | 全量构建慢 | 增量 CI（只构建受影响包）|
| 权限管理粗 | 所有人能看所有代码 | 团队规模小时不是问题 |
| 工具链复杂 | 需要 workspace 工具 | pnpm workspace 够简单 |

**最大的缺点其实是 CI**——如果不做增量，改一个工具函数要跑所有包的测试。我们用 `pnpm --filter` 做增量：

```bash
# 只跑受影响的包的测试
pnpm --filter=...[origin/main] test
```

`...[origin/main]` 表示"自从 main 分支以来有变更的包及其依赖者"。改了 utils，会跑 utils + 依赖 utils 的 request + 依赖 request 的 components 的测试，不会跑无关的包。

---

**🎤 面试官继续追问**

> 你说 Monorepo 里组件库改 API 可以和业务适配在同一个 PR 完成。但如果这个 PR 还没合并，其他 PR 也在改组件库，不会冲突吗？

**🙋 候选人回答**

会冲突，这是 Monorepo 的一个真实挑战——**所有人在同一个仓库改代码，冲突概率比 Multirepo 高**。

但我的经验是：Monorepo 的冲突**频率高但解决快**，Multirepo 的冲突**频率低但解决慢**。

- Monorepo：两人改了同一个文件，git merge 时立刻发现冲突，10 分钟解决。
- Multirepo：组件库发了新版，业务项目两周后升级才发现不兼容——这时候组件库的作者已经忘了改了什么，排查要半天。

**所以冲突不是"有没有"的问题，是"什么时候发现"的问题**。Monorepo 把冲突提前到开发阶段（合并时），Multirepo 把冲突推迟到集成阶段（升级时）。前者成本远低于后者。

**减少冲突的实践：**

1. **包的所有权划分**：组件库主要由工具组维护，业务项目由各团队维护。跨包改动时 PR 作者负责协调。
2. **小 PR**：一个 PR 不做太多事，减少冲突面。
3. **频繁同步 main**：每天 rebase main，冲突在小时级解决而非天级。

### 🏗 架构分析

**Monorepo vs Multirepo**

| 维度 | Monorepo | Multirepo |
|------|----------|-----------|
| 跨包改动 | 原子提交 | 跨仓库协调 |
| 本地联调 | 零成本 | npm link 痛苦 |
| 依赖一致性 | 统一 | 各自管理 |
| CI | 统一+增量 | 分散 |
| 冲突 | 频率高但解决快 | 频率低但解决慢 |
| 权限 | 粗 | 细 |

**选 Monorepo 的原因**：多个包跨包改动频繁（组件库、工具库、SDK、contracts 共享类型），Monorepo 的原子提交和零成本联调收益最大。

**工具选择**：pnpm workspace（简单够用）。规模增长到 50+ 包时考虑 Turborepo。

### 🎯 面试官真正考察什么

1. **Multirepo 痛点的真实性**：能不能说出跨仓库改动的具体痛苦？
2. **Monorepo 的缺点意识**：不回避缺点——CI 变慢、冲突、仓库体积。
3. **工具选型**：pnpm/Lerna/Nx/Turborepo，有没有根据规模选？

### ❌ 常见错误回答

- **"Monorepo 是最佳实践"**：不分析自己的规模和需求。
- **忽视缺点**：不提 CI 变慢和冲突问题。
- **工具跟风**：小规模就用 Nx/Turborepo，过度工程。

### ✅ 推荐回答

> 选 Monorepo 因为 Multirepo 四个痛点：跨 N 仓库改接口、本地联调要 npm link、依赖版本不一致、CI 分散。Monorepo 解决：原子提交（组件库改 API+业务适配一个 PR）、零成本联调（import 源码不用 link）、统一依赖版本、统一增量 CI。用 pnpm workspace 不用 Lerna（已停维）不用 Nx/Turborepo（规模不够 10-15 包）。缺点是 CI 慢——用 pnpm --filter 做增量只跑受影响包。冲突频率高但解决快（合并时发现 vs 升级时发现），前者成本低。减少冲突靠所有权划分+小 PR+频繁同步 main。

### 📚 延伸知识

- **pnpm 的内容寻址存储**：全局 store 存所有包，项目 node_modules 是硬链接。同样的包只存一份，省磁盘。
- **Turborepo 远程缓存**：构建结果缓存到远程（Vercel），多机器/多 PR 共享。大规模 Monorepo 的 CI 加速利器。

---

## Q6. Monorepo 的版本发布策略

**🎤 面试官**

> Monorepo 里有多个包，发布时怎么管理版本？是所有包统一版本，还是各自版本？发版流程是怎样的？

**🙋 候选人回答**

我们用 **Changesets** 管理版本发布，不是统一版本，是**独立版本**。

先说为什么不选统一版本（Fixed/Locked Versioning）：

统一版本意味着所有包版本号一起涨——改了 utils 发版，连没改的 components 也跟着升版本。问题：

1. **版本号膨胀**：components 频繁发版但实际没改，版本号虚高。
2. **升级困惑**：业务方看到 components 从 1.5.0 跳到 1.6.0，以为有新功能，实际只是 utils 改了。
3. **回滚困难**：components 的 1.6.0 要回滚，但 1.6.0 里 utils 也变了，回滚 components 会把 utils 也回滚。

**独立版本（Independent Versioning）**：每个包按自己的变更发版。改了 utils 只发 utils，components 不动。

**Changesets 的流程：**

```
① 开发时记录变更
   pnpm changeset
   → 选择受影响的包
   → 选择变更类型（patch/minor/major）
   → 写变更说明

② 生成 .changeset/ 记录文件
   .changeset/cute-cats-jump.md
   ---
   "@myorg/utils": minor
   "@myorg/request": patch
   ---
   utils 新增了 deepClone 函数，request 修复了超时 Bug

③ 发版时消费 changeset
   pnpm changeset version
   → 读取所有 .changeset 文件
   → 自动更新各包的 package.json 版本号
   → 自动更新 CHANGELOG.md
   → 删除已消费的 .changeset 文件

④ 发布
   pnpm changeset publish
   → 发布有变更的包到 npm
```

**Changesets 的核心价值**：

1. **变更记录在开发时就写**——不是发版时才凑 CHANGELOG。
2. **自动算版本号**——根据 changeset 里的 patch/minor/major 自动 bump。
3. **只发有变更的包**——没改的包不发版。
4. **自动更新内部依赖**——如果 utils 发了 minor，依赖 utils 的 request 的内部依赖版本也会自动更新。

---

**🎤 面试官追问**

> 发版前怎么确保不 break？改了 utils 可能影响 request 和 components，发版前有没有验证？

**🙋 候选人回答**

**通过 CI + Changesets 的 PR 流程验证。**

我们的发版不是直接在 main 上跑 `changeset publish`，而是走一个**"发版 PR"流程**：

```
① 日常开发：开发者写代码 + 写 changeset，提交 PR
② PR 的 CI：跑所有受影响包的测试 + 类型检查
③ 合并到 main：CI 再次验证
④ 发版 PR：Changesets 自动生成一个 "Version Packages" PR
   - 这个 PR 包含：版本号 bump、CHANGELOG 更新
   - CI 在这个 PR 上跑全量测试（因为要发版了，必须全量验证）
⑤ 合并发版 PR：触发 publish
   - pnpm changeset publish 发布到 npm
   - 自动打 Git tag
```

**关键设计：发版 PR 是一个独立的验证节点。** 日常 PR 的 CI 只跑受影响包（增量），发版 PR 的 CI 跑全量。这样日常开发快（增量 CI），发版时安全（全量 CI）。

**如果发版 PR 的 CI 挂了怎么办？** 说明某个包 break 了——不合并发版 PR，先修 Bug。发版 PR 可以反复更新（新的日常 PR 合入 main 后，发版 PR 自动更新版本和 CHANGELOG）。

**这个流程的本质是：把发版变成一个可验证、可回退的操作。** 不是某个人手动跑命令发版，而是通过 PR 流程让发版受 CI 保护、有 Review、有记录。

---

**🎤 面试官继续追问**

> 内部包之间的依赖版本怎么管？比如 components 依赖 hooks 1.2.0，hooks 发了 1.3.0，components 要自动升级吗？

**🙋 候选人回答**

**不需要自动升级，但要保持兼容。**

内部包之间用 `workspace:*` 协议引用：

```json
// packages/components/package.json
{
  "dependencies": {
    "@myorg/hooks": "workspace:*",
    "@myorg/request": "workspace:*"
  }
}
```

**开发时**：`workspace:*` 解析到本地源码，永远是最新的。开发联调没有版本问题。

**发布时**：Changesets 自动把 `workspace:*` 替换为真实版本号。如果 hooks 刚发了 1.3.0，components 发版时会自动写成 `"@myorg/hooks": "^1.3.0"`。

**关键点：`^` 范围版本**。components 不锁定 hooks 的精确版本，而是允许 minor/patch 自动升级。这样 hooks 发了 1.3.1（patch），components 不用重新发版——消费者安装 components 时自动拿到 hooks 1.3.1。

**但 major 版本不会自动升级**。hooks 发了 2.0.0（breaking change），components 的 `^1.3.0` 不会自动匹配 2.0.0。components 需要手动适配新 API，发自己的 major 版本。

**Changesets 会自动检测这个情况**：如果 hooks 发了 major，Changesets 会提示"components 依赖了 hooks，需要也发一个 major"——因为它知道 components 的依赖 breaking 了。

### 🏗 架构分析

**版本策略对比**

| 策略 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| 统一版本 | 所有包版本同步 | 简单 | 版本虚高、回滚困难 |
| 独立版本 | 各包各自版本 | 精确 | 管理复杂 |
| 独立 + Changesets | 工具管理独立版本 | 精确+自动化 | 学习成本 |

**选 Changesets 的原因**：独立版本的精确性 + 自动化的版本计算和 CHANGELOG 生成。发版 PR 流程保证 CI 验证。

### 🎯 面试官真正考察什么

1. **版本管理认知**：统一版本 vs 独立版本，知不知道各自的优劣？
2. **发版流程**：不是手动 npm publish，而是有 CI 保护的 PR 流程。
3. **内部依赖处理**：workspace:* 协议 + 发布时替换为真实版本号。

### ❌ 常见错误回答

- **统一版本**："所有包一起发版。"——版本虚高，没改的包也升版本。
- **手动发版**："改完代码 npm publish。"——没有 CI 验证，容易 break。
- **不关心内部依赖**：不知道 workspace:* 发布时怎么处理。

### ✅ 推荐回答

> 用 Changesets 管独立版本——每个包按自己的变更发版，改了 utils 只发 utils。不选统一版本因为版本虚高和回滚困难。流程：开发时 pnpm changeset 记录变更（选包+类型+说明）→ 发版 PR 自动 bump 版本和 CHANGELOG → CI 全量验证 → 合并触发 publish。日常 PR 用增量 CI（只跑受影响包），发版 PR 用全量 CI。内部包用 workspace:* 引用（开发时解析源码），发布时 Changesets 自动替换为真实版本号。用 ^ 范围版本允许 minor/patch 自动升级，major 不自动升级需手动适配——Changesets 会检测到依赖 breaking 并提示关联包也发 major。

### 📚 延伸知识

- **Changesets vs Lerna version**：Lerna 的 version 命令也做版本管理，但 Changesets 更灵活（支持独立版本）且更现代。Lerna 已被 Nx 接管。
- **Semantic Versioning 严格性**：很多团队说遵循 semver 但实际不严格。Changesets 通过开发时记录变更类型，强制执行 semver。

---

## Q7. 为什么 Storybook？

**🎤 面试官**

> Storybook 很重，配置也麻烦。你们为什么一定要用？不做 Storybook 行不行？

**🙋 候选人回答**

**不做 Storybook 也能活，但做了之后有几个质变。**

先说没有 Storybook 时的痛点：

**痛点一：组件没法独立查看**

要预览组件库的 Button，要么写个 demo 页面，要么在业务项目里看。前者维护成本高（每个组件写 demo 页），后者依赖业务项目（改组件库还要跑业务项目）。

**痛点二：组件文档靠手写**

组件有哪些 props、有哪些变体、怎么用——写 Markdown 文档，和代码分离，经常不同步。代码改了文档忘改。

**痛点三：设计师无法独立验收**

设计师要看组件做得对不对，得让前端跑项目、导航到组件页面。设计师不能自己点、自己看。

**Storybook 解决了这三个问题：**

**① 组件独立展示**

每个组件写 Story（一个独立的渲染状态），Storybook 自动生成可交互的组件展示页面。改组件代码，Storybook 热更新，立刻看到效果。

```tsx
// Button.stories.tsx
import { Button } from './Button';

export default {
  title: 'Button',
  component: Button,
};

export const Primary = () => <Button variant="primary">主要按钮</Button>;
export const Danger = () => <Button variant="danger">危险按钮</Button>;
export const Disabled = () => <Button disabled>禁用按钮</Button>;
export const Loading = () => <Button loading>加载中</Button>;
```

Storybook 自动生成一个页面，左侧列出所有 Story，右侧渲染组件。点不同的 Story 看不同状态。

**② 文档自动生成**

Storybook 结合 TypeScript 类型 + JSDoc 注释，自动生成组件文档——props 列表、类型、默认值、使用示例。代码即文档，不会不同步。

**③ 设计师自服务**

Storybook 可以部署成一个网站（静态站点）。设计师打开浏览器，自己点所有组件、调参数、看效果。不用求前端跑项目。

---

**🎤 面试官追问**

> Storybook 配置确实烦——Vite/Webpack 配置、addon 配置、TS 配置。你们怎么解决配置负担的？

**🙋 候选人回答**

**用 Storybook 官方的 Vite 方案，最小化配置。**

早期 Storybook 基于 Webpack，配置极其复杂——要配 babel-loader、css-loader、各种 addon 的 Webpack 规则。后来 Storybook 官方支持了 Vite builder，配置大幅简化：

```js
// .storybook/main.ts
export default {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-essentials'],
  framework: '@storybook/react-vite',
};
```

就这几行。`addon-essentials` 包含了文档、控件、视口、工具栏等常用功能，不用单独配。

**我们没有用很多 addon**——只用了 essentials（官方打包）和 addon-interactions（测试交互）。每加一个 addon 都是维护成本，我们克制。

**Story 的编写成本怎么降低？**

Storybook 支持 CSF 3.0（Component Story Format 3），可以用更简洁的方式写 Story：

```tsx
// CSF 3.0 — 更简洁
export default {
  component: Button,
  args: {
    children: '按钮',
    variant: 'primary',
  },
};

// 每个 export 是一个 Story，只写和默认值不同的部分
export const Danger = { args: { variant: 'danger' } };
export const Large = { args: { size: 'lg' } };
```

比写函数组件简洁很多。大部分 Story 就是一行对象。

**但我要承认 Storybook 有成本**：

1. **学习成本**：团队要学 Story 的写法和 CSF 格式。
2. **维护成本**：组件改了 Story 可能要跟着改。
3. **构建时间**：CI 要构建 Storybook，增加时间。

所以我们的策略是：**核心组件必须写 Story，边缘组件可选**。Button、Input、Modal、Table 这些高频组件有完整 Story；某个只在一个项目用的特殊组件不强求 Story。

---

**🎤 面试官继续追问**

> Storybook 除了展示组件，还能做测试吗？你们有没有用 Storybook 做自动化测试？

**🙋 候选人回答**

**用了，这是 Storybook 的隐藏价值。**

Storybook 的 `@storybook/addon-interactions` + `@storybook/test` 可以对 Story 做交互测试：

```tsx
import { expect, userEvent, within } from '@storybook/test';

export const FormSubmission = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    
    // 模拟用户操作
    await userEvent.type(canvas.getByPlaceholderText('邮箱'), 'test@example.com');
    await userEvent.click(canvas.getByText('提交'));
    
    // 断言
    await expect(canvas.getByText('提交成功')).toBeInTheDocument();
  },
};
```

**这比单独写 Jest + React Testing Library 的好处是：Story 既是文档又是测试。** 你不用维护两套——Story 展示组件状态，play 函数测试交互行为，一个文件搞定。

**视觉回归测试（Visual Regression）**：

Storybook 配合 Chromatic（Storybook 官方的可视化测试服务）可以做视觉回归——每次提交截图对比，如果组件外观变了自动告警。这个我们没有用（Chromatic 是付费服务），但如果有严格的视觉一致性需求，这是很好的方案。

**组件库的测试策略分层：**

| 层 | 工具 | 测什么 |
|----|------|--------|
| 单元测试 | Vitest | 纯函数逻辑（utils） |
| 组件测试 | Storybook play | 组件交互行为 |
| 视觉测试 | Chromatic（可选） | 组件外观回归 |
| 集成测试 | Vitest + Testing Library | 多组件组合 |

### 🏗 架构分析

**Storybook 的价值层**

| 价值 | 没有 Storybook | 有 Storybook |
|------|---------------|-------------|
| 组件预览 | 写 demo 页或跑业务项目 | 独立展示，热更新 |
| 文档 | 手写 Markdown，易不同步 | TS 类型自动生成 |
| 设计验收 | 求前端跑项目 | 设计师自服务 |
| 测试 | 单独写 Jest | Story 即测试 |

**成本控制**：最小化 addon（只 essentials + interactions）、CSF 3.0 简化 Story 写法、核心组件必须写边缘组件可选。

### 🎯 面试官真正考察什么

1. **痛点驱动**：Storybook 解决展示、文档、验收三个真痛点，不是为了"看起来专业"。
2. **成本意识**：Storybook 有配置和维护成本，有没有说怎么控制？
3. **测试价值**：Storybook 不只是展示，还能做交互测试——这是进阶认知。

### ❌ 常见错误回答

- **"Storybook 是标配"**：不问痛点就上，可能团队根本不用。
- **配置过度**：装一堆 addon，维护成本爆炸。
- **只做展示不做测试**：不知道 Storybook 的 play 函数能做交互测试。

### ✅ 推荐回答

> 没有 Storybook 三个痛点：组件没法独立查看（要写 demo 或跑业务项目）、文档手写易不同步、设计师验收要求前端。Storybook 解决：组件独立展示+热更新、TS 类型自动生成文档、部署成网站设计师自服务。配置用官方 Vite 方案最小化——只 essentials+interactions 两个 addon。Story 用 CSF 3.0 简化写法（对象而非函数）。核心组件必须写 Story 边缘可选。隐藏价值是交互测试——play 函数模拟用户操作+断言，Story 既是文档又是测试。视觉回归用 Chromatic（可选付费）。测试分层：单元 Vitest、组件 Storybook play、视觉 Chromatic、集成 RTL。

### 📚 延伸知识

- **CSF (Component Story Format)**：Storybook 的标准格式，可被工具消费。不止 Storybook，其他工具（如 Storyly、UXPin）也能读 CSF。
- **Chromatic**：Storybook 团队做的可视化测试 + 发布平台。免费额度有限，适合开源项目或小团队。

---

## Q8. 为什么统一 Logger？

**🎤 面试官**

> Logger 不就是 console.log 吗？为什么需要统一？

**🙋 候选人回答**

`console.log` 在开发时够用，但在生产环境有三个致命问题：

**① 结构不统一**

张三写 `console.log('用户登录', userId)`，李四写 `console.log({ event: 'login', uid: userId })`。日志格式各异，无法统一检索。

**② 级别混乱**

有人用 `console.log` 记错误信息，有人用 `console.error` 记调试信息。级别和含义不对应，过滤日志时一团乱。

**③ 无法集中收集**

console 输出到 stdout/stderr，如果不上报就只在本地。生产环境要集中查日志（ELK/Datadog），需要结构化输出 + 采集。

我们的统一 Logger 解决这些问题：

```typescript
import { logger } from '@myorg/logger';

// 结构化日志
logger.info('user.login', { userId: '123', ip: '1.2.3.4' });
logger.error('task.failed', { taskId: '456', reason: 'timeout' });
logger.warn('rate_limit.warning', { provider: 'openai', remaining: 10 });

// 输出格式（JSON）：
// {"level":"info","event":"user.login","userId":"123","ip":"1.2.3.4","timestamp":"2026-07-11T..."}
```

**核心设计：**

1. **统一事件名**：`scope.action` 格式（如 `user.login`、`task.failed`），可按 scope 过滤。
2. **结构化字段**：不是字符串拼接，是 JSON 对象。可按字段检索（`userId=123`）。
3. **级别规范**：debug/info/warn/error 四级，含义明确。
4. **环境适配**：开发环境输出彩色可读格式，生产环境输出 JSON。
5. **上下文注入**：可注入 requestId、userId 等上下文，自动附加到每条日志。

---

**🎤 面试官追问**

> 你说"上下文注入"，比如 requestId 怎么自动附加到每条日志？在 Node 里这涉及异步上下文追踪。

**🙋 候选人回答**

这是统一 Logger 最技术性的部分。用 Node.js 的 **AsyncLocalStorage**（异步上下文追踪）。

问题场景：一个 HTTP 请求进来，生成 requestId。这个请求的处理链路里可能有多个异步操作（调数据库、调 AI、写日志），每个日志都要带上这个 requestId。但不想每次调 logger 都手动传 requestId。

**AsyncLocalStorage 可以在异步调用链中自动传递上下文：**

```typescript
import { AsyncLocalStorage } from 'async_hooks';

// 创建异步上下文存储
const als = new AsyncLocalStorage<Map<string, any>>();

// 请求中间件：设置上下文
app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  
  als.run(new Map(), () => {
    als.getStore()!.set('requestId', requestId);
    als.getStore()!.set('userId', req.user?.id);
    next();
  });
});

// Logger 从上下文读取
function log(level: string, event: string, data: object) {
  const store = als.getStore();
  const context = store ? Object.fromEntries(store) : {};
  
  console.log(JSON.stringify({
    level,
    event,
    ...data,
    ...context,  // 自动附加 requestId, userId
    timestamp: new Date().toISOString(),
  }));
}
```

**效果**：同一个请求链路里的所有日志自动带 requestId，不需要手动传。不同请求的上下文隔离（AsyncLocalStorage 保证）。

```typescript
// 业务代码里直接调 logger，requestId 自动附加
async function createTask(params) {
  logger.info('task.create', { type: params.type });  
  // 输出: {"level":"info","event":"task.create","type":"drama",...,"requestId":"abc-123","userId":"u456"}
  
  await aiPlatform.chat(...);
  logger.info('task.ai_called', { model: 'gpt-4' });
  // 同样自动带 requestId
}
```

**为什么不用 cls-hooked 或 continuation-local-storage？** 这些是旧方案，Node.js 12+ 原生支持 AsyncLocalStorage，不需要第三方库，且性能更好。

**AsyncLocalStorage 的坑**：有些库会"打断"异步上下文（比如某些回调方式的库）。但 NestJS 的 DI + async/await 模式和 AsyncLocalStorage 兼容良好。

---

**🎤 面试官继续追问**

> 前端的 Logger 和后端的 Logger 一样吗？前端日志怎么收集？

**🙋 候选人回答**

**不一样。前端和后端的 Logger 接口统一，但实现不同。**

接口统一：`logger.info(event, data)` 的 API 在前端和后端一样。业务代码不用关心在哪端。

实现不同：

**后端 Logger**：
- 输出到 stdout（JSON 格式）
- 由 ELK/Datadog 采集
- AsyncLocalStorage 注入上下文

**前端 Logger**：
- 开发环境：console.log（彩色可读）
- 生产环境：批量上报到后端日志接口

```typescript
// 前端 Logger 的生产环境实现
class FrontendLogger {
  private buffer: LogEntry[] = [];
  private flushTimer?: number;

  log(level: string, event: string, data: object) {
    if (process.env.NODE_ENV === 'development') {
      console.log(`%c[${level}] ${event}`, 'color:blue', data);
      return;
    }
    
    // 生产环境：加入缓冲区
    this.buffer.push({ level, event, data, timestamp: Date.now(), url: location.href });
    
    // 批量上报（每 5 秒或满 20 条）
    if (this.buffer.length >= 20) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = window.setTimeout(() => this.flush(), 5000);
    }
  }

  private async flush() {
    const logs = this.buffer.splice(0);
    this.flushTimer = undefined;
    
    try {
      await fetch('/api/logs', {
        method: 'POST',
        body: JSON.stringify({ logs }),
      });
    } catch {
      // 上报失败丢弃，不阻塞业务
    }
  }
}
```

**前端日志的关键设计**：

1. **批量上报**：不是每条日志一个请求，攒一批再发（减少请求数）。
2. **失败丢弃**：上报失败不重试、不阻塞业务（日志不能影响用户体验）。
3. **采样**：高频日志（如鼠标移动）采样后再上报，否则量太大。
4. **错误优先**：error 级别立即上报，不等批量。

### 🏗 架构分析

**Logger 的分层设计**

```
@myorg/logger（接口层）
├── Node 实现：stdout JSON + AsyncLocalStorage + ELK 采集
└── Browser 实现：console + 批量上报 + 后端日志接口
```

**核心原则**：接口统一、实现分化。业务代码调 `logger.info()` 不管在哪端，底层适配。

**AsyncLocalStorage**：Node 异步上下文追踪的官方方案，自动注入 requestId 到日志。

### 🎯 面试官真正考察什么

1. **结构化日志意识**：console.log 不够，要结构化 JSON 才能检索。
2. **AsyncLocalStorage 理解**：这是 Node 异步上下文的核心 API，能不能说清楚原理？
3. **前后端差异**：接口统一但实现分化——前端批量上报、后端 stdout 采集。

### ❌ 常见错误回答

- **"console.log 够了"**：不考虑生产环境结构化和集中收集。
- **不知道 AsyncLocalStorage**：手动传 requestId 到处传，或者用已过时的 cls-hooked。
- **前端日志不考虑性能**：每条日志一个请求，或失败重试阻塞业务。

### ✅ 推荐回答

> console.log 三个问题：格式不统一（每人写法不同）、级别混乱（log/error 乱用）、无法集中收集。统一 Logger：事件名 scope.action 格式、结构化 JSON 输出、四级 debug/info/warn/error、环境适配（开发彩色生产 JSON）。上下文注入用 Node 的 AsyncLocalStorage——请求中间件设 requestId 到 ALS，logger 从 ALS 读取自动附加，异步调用链自动传递不用手动传。前端 Logger 接口统一但实现不同：开发用 console、生产批量上报（每 5 秒或满 20 条 flush）、失败丢弃不阻塞业务、error 立即上报。核心原则：接口统一实现分化。

### 📚 延伸知识

- **AsyncLocalStorage**：Node.js 12+ 原生 API，替代 cls-hooked。NestJS 的 ClsService 底层就是 ALS。
- **结构化日志标准**：参考 JSON Logging 最佳实践——字段名用 snake_case 或 camelCase 统一、timestamp 用 ISO 8601、level 用枚举值。

---

## Q9. 为什么统一 Request？

**🎤 面试官**

> 你在工具库那题（Q3）提过 @myorg/request，这里想深入聊。前端和 Node 的请求库统一吗？还是各用各的？

**🙋 候选人回答**

**接口统一，实现不同。** 和 Logger 一样的设计理念。

前端和 Node 都需要发 HTTP 请求，但场景不同：

| 场景 | 前端 | Node |
|------|------|------|
| 目标 | 调后端 API | 调外部 API（AI Provider 等） |
| 认证 | Token 注入（Cookie/Header） | API Key 注入 |
| 错误处理 | 401 跳登录、toast 提示 | 记录日志、重试、降级 |
| 超时 | 10-30 秒 | 可达 5 分钟（AI 调用慢） |
| 重试 | 少（避免重复提交） | 多（网络波动大） |

如果用一个实现，要么前端多了不需要的重试逻辑，要么 Node 少了需要的超时控制。

**我们的方案：@myorg/request 提供 createRequest 工厂，前端和 Node 各自配置：**

```typescript
// 前端
import { createRequest } from '@myorg/request';

const api = createRequest({
  baseURL: '/api',
  timeout: 10000,
  interceptors: {
    request: (config) => {
      config.headers.Authorization = `Bearer ${getToken()}`;
      return config;
    },
    error: (error) => {
      if (error.response?.status === 401) redirectToLogin();
      showErrorToast(error.message);
      throw error;
    },
  },
});
```

```typescript
// Node（AI Platform 调 Provider）
import { createRequest } from '@myorg/request';

const openaiClient = createRequest({
  baseURL: 'https://api.openai.com',
  timeout: 300000,  // 5 分钟
  retries: 3,
  retryDelay: (attempt) => Math.pow(2, attempt) * 1000,  // 指数退避
  interceptors: {
    request: (config) => {
      config.headers.Authorization = `Bearer ${getApiKey('openai')}`;
      return config;
    },
    error: (error) => {
      logger.error('openai.request_failed', { 
        url: error.config?.url, 
        status: error.response?.status 
      });
      throw error;
    },
  },
});
```

**统一的底层能力 + 各自的配置 = 既一致又灵活。**

---

**🎤 面试官追问**

> 底层用什么？fetch 还是 axios？为什么？

**🙋 候选人回答**

**底层用 fetch，不是 axios。**

选 fetch 的原因：

**① Node 18+ 原生支持 fetch**

Node 18 之前没有原生 fetch，只能用 axios/node-fetch。Node 18+ 内置了 fetch（基于 undici），前后端都可以用原生 fetch，不需要额外依赖。

**② fetch 是标准**

fetch 是 Web 标准 API，长期维护有保障。axios 是第三方库，有维护风险（虽然 axios 1.x 很稳定）。

**③ 更轻量**

axios 的包体积（~12KB gzipped）虽然不大，但 fetch 是零体积（原生内置）。

**但 fetch 有缺点，需要自己补：**

| fetch 的不足 | 我们的补法 |
|-------------|-----------|
| 没有自动 JSON 解析 | interceptor 里 `response.json()` |
| 没有超时 | 用 AbortController |
| 没有重试 | 自己实现 retry 逻辑 |
| 错误处理不友好（4xx/5xx 不 throw） | 检查 `!response.ok` 后 throw |
| 没有拦截器 | 自己实现 interceptor 链 |

这些"不足"正是 @myorg/request 封装的价值——补上 fetch 缺失的能力，给业务方一个好用的 API。

**关键：超时用 AbortController**

```typescript
async function fetchWithTimeout(url: string, options: RequestInit, timeout: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new HttpError(response.status, await response.text());
    }
    
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new TimeoutError(url, timeout);
    }
    throw error;
  }
}
```

**为什么不用 axios？** axios 1.x 确实解决了早期很多问题，但它的 interceptor 模型、transformRequest/transformResponse 等概念增加了理解成本。fetch + 自己封装更透明——你清楚每一步在做什么，没有"框架魔法"。

---

**🎤 面试官继续追问**

> 你提到重试和指数退避，具体怎么实现？重试时怎么避免对已经失败到一半的请求造成副作用？

**🙋 候选人回答**

重试是请求库最微妙的部分——**不是所有失败都应该重试**。

**应该重试的：**
- 网络错误（连不上服务器）
- 5xx 服务端错误（临时故障）
- 429 限流（等待后重试）

**不应该重试的：**
- 4xx 客户端错误（400 参数错误、401 未授权、403 禁止）——重试还是同样的错
- 已经到达服务端的 POST 请求——可能已经创建了资源，重试会重复创建

**我们的重试逻辑：**

```typescript
async function fetchWithRetry(
  url: string, 
  options: RequestInit, 
  config: { retries: number; retryDelay: (attempt: number) => number }
) {
  let lastError: Error;
  
  for (let attempt = 0; attempt <= config.retries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options, ...);
      
      // 429: 读 Retry-After header，等待后重试
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '1');
        await sleep(retryAfter * 1000);
        continue;
      }
      
      // 5xx: 可重试
      if (response.status >= 500 && attempt < config.retries) {
        await sleep(config.retryDelay(attempt));
        continue;
      }
      
      return response;
    } catch (error) {
      lastError = error;
      // 网络错误: 可重试
      if (error instanceof NetworkError && attempt < config.retries) {
        await sleep(config.retryDelay(attempt));
        continue;
      }
      throw error;  // 其他错误不重试
    }
  }
  
  throw lastError;
}
```

**避免重复副作用的策略：**

**① 幂等性检查**

对于非幂等请求（POST），重试前检查响应——如果超时但不确定是否到达服务端，不自动重试，而是返回"超时，请手动确认"的错误。

**② 幂等键**

对于重要的 POST 请求（如创建任务），在请求头加 `Idempotency-Key`：

```typescript
const response = await request.post('/tasks', {
  headers: { 'Idempotency-Key': crypto.randomUUID() },
  body: taskData,
});
```

服务端收到相同 Idempotency-Key 的请求时，返回之前的结果而非重复创建。这样即使重试也不会有副作用。

**③ 指数退避 + 抖动**

```typescript
retryDelay: (attempt) => {
  const base = Math.pow(2, attempt) * 1000;  // 1s, 2s, 4s
  const jitter = Math.random() * 500;         // 0-500ms 随机抖动
  return base + jitter;
}
```

抖动（jitter）防止"惊群效应"——如果多个客户端同时失败，没有抖动会在同一时刻重试，打爆服务器。抖动让重试分散。

### 🏗 架构分析

**Request 库的分层**

```
@myorg/request（接口 + 默认实现）
├── fetchWithTimeout（AbortController 超时）
├── fetchWithRetry（智能重试 + 指数退避 + 抖动）
├── interceptor 链（请求/响应/错误拦截）
└── createRequest 工厂（前端和 Node 各自配置）
```

**选 fetch 不选 axios**：原生标准、零依赖、Node 18+ 内置。缺点（无超时/重试/拦截器）由封装层补。

**重试安全性**：4xx 不重试、429 读 Retry-After、POST 用幂等键、指数退避+抖动防惊群。

### 🎯 面试官真正考察什么

1. **前后端统一的设计**：接口统一实现分化——这是平台设计的一贯原则。
2. **fetch vs axios 的判断**：不跟风，基于 Node 18+ 原生 fetch 选型。
3. **重试的深度**：不是"失败就重试"，而是区分可重试/不可重试、幂等性、退避+抖动。这是分布式系统的核心知识。

### ❌ 常见错误回答

- **"用 axios"**：不评估 fetch 的可行性。
- **"失败重试 3 次"**：不区分错误类型，4xx 也重试是浪费。
- **无幂等意识**：POST 重试不考虑重复创建。

### ✅ 推荐回答

> 接口统一（createRequest 工厂）实现分化（前端 10s 超时+401 跳登录，Node 5min 超时+3 次重试+日志）。底层用 fetch 不用 axios——Node 18+ 原生内置、Web 标准、零依赖。fetch 缺的超时/重试/拦截器由封装层补：超时用 AbortController、4xx 不重试 5xx 和网络错误重试、429 读 Retry-After。POST 请求的重复副作用用幂等键（Idempotency-Key header，服务端相同 key 返回已有结果）。指数退避+随机抖动防惊群效应（多客户端同时重试打爆服务器）。

### 📚 延伸知识

- **AbortController**：Web 标准 API，用于取消异步操作。不只是 fetch，也是 Node 异步取消的基础。
- **Idempotency-Key**：Stripe 推广的标准，用请求头传递幂等键。服务端缓存 key→response 的映射，重复请求返回缓存结果。

---

## Q10. 为什么统一 Config？

**🎤 面试官**

> 配置不就是环境变量吗？为什么需要统一 Config？

**🙋 候选人回答**

环境变量是配置的**载体**，但不是**管理方案**。直接用 `process.env` 有三个问题：

**① 类型不安全**

```typescript
// process.env 里所有值都是 string | undefined
const port = process.env.PORT;        // "3000"（string）
const debug = process.env.DEBUG;      // "true"（string，不是 boolean）
const maxRetries = process.env.MAX_RETRIES; // "3"（string，不是 number）
```

每次用都要手动转换类型，容易出错（忘转、转错）。

**② 无默认值管理**

```typescript
const port = process.env.PORT || 3000;        // 散落各处
const dbUrl = process.env.DATABASE_URL || '';  // 空字符串可能后面崩
```

默认值散落在代码各处，不知道某个配置的默认值是什么。

**③ 无校验**

部署时漏配了 `REDIS_URL`，代码不会报错——直到运行到需要 Redis 的地方才崩。这个错误发现得太晚。

**我们的统一 Config 方案：**

```typescript
import { defineConfig } from '@myorg/config';

const config = defineConfig({
  // 定义 schema：类型 + 默认值 + 校验
  port: {
    type: 'number',
    default: 3000,
    env: 'PORT',
  },
  debug: {
    type: 'boolean',
    default: false,
    env: 'DEBUG',
  },
  databaseUrl: {
    type: 'string',
    required: true,              // 必填，缺失则启动报错
    env: 'DATABASE_URL',
  },
  redisUrl: {
    type: 'string',
    required: true,
    env: 'REDIS_URL',
  },
  aiProviders: {
    type: 'json',                // JSON 类型（支持复杂配置）
    default: {},
    env: 'AI_PROVIDERS',
  },
});

// 使用时：类型安全
config.port        // number
config.debug       // boolean
config.databaseUrl // string
config.aiProviders // object
```

**核心能力：**

1. **类型转换**：自动把 string 转成 number/boolean/json。
2. **默认值**：集中管理，不在代码里散落。
3. **启动校验**：required 配置缺失，应用启动就报错，而不是运行到一半才崩。
4. **类型安全**：TS 推导出正确类型，`config.port` 是 `number` 不是 `string`。

---

**🎤 面试官追问**

> 你这个方案和 zod 很像——用 schema 定义 + 校验。为什么不用 zod 直接做？

**🙋 候选人回答**

**其实底层就是用 zod。** @myorg/config 是对 zod 的封装，加了配置管理特有的能力。

直接用 zod 的问题：

```typescript
import { z } from 'zod';

const schema = z.object({
  port: z.coerce.number().default(3000),
  databaseUrl: z.string(),
});

const config = schema.parse(process.env);
// 问题：process.env 里的 key 是 PORT 不是 port
// 要手动映射 env 变量名 → 配置名
```

zod 不知道"PORT 环境变量对应 port 配置项"，要自己写映射。@myorg/config 封装了这个：

```typescript
// @myorg/config 内部实现（简化）
import { z } from 'zod';

export function defineConfig(schema: ConfigSchema) {
  // 从 env 读取值
  const envValues: Record<string, any> = {};
  for (const [key, def] of Object.entries(schema)) {
    envValues[key] = process.env[def.env];
  }
  
  // 构建 zod schema
  const zodSchema: Record<string, z.ZodType> = {};
  for (const [key, def] of Object.entries(schema)) {
    let zodType;
    switch (def.type) {
      case 'number': zodType = z.coerce.number(); break;
      case 'boolean': zodType = z.coerce.boolean(); break;
      case 'json': zodType = z.string().transform(s => JSON.parse(s)); break;
      default: zodType = z.string();
    }
    if (def.required) {
      zodSchema[key] = zodType;
    } else {
      zodSchema[key] = zodType.default(def.default);
    }
  }
  
  // 校验 + 解析
  return z.object(zodSchema).parse(envValues);
}
```

**所以 @myorg/config = zod + env 映射 + 配置约定。** 不是重新造轮子，是在 zod 上包一层配置管理语义。

---

**🎤 面试官继续追问**

> 配置除了环境变量，还有动态配置——运行时要变的配置（比如限流阈值）。你们怎么处理？

**🙋 候选人回答**

**分两类：静态配置和动态配置，用不同方案。**

**静态配置**（@myorg/config）：启动时确定，运行时不变。如数据库连接、端口号。用环境变量 + zod 校验。

**动态配置**：运行时要变的配置。如：

- 限流阈值（高峰期调低、低峰期调高）
- Feature Flag（灰度发布开关）
- AI 模型路由（临时切到备用 Provider）

动态配置不能放环境变量——改了要重启服务。我们的方案是**存数据库 + 内存缓存 + 变更通知**：

```typescript
// 动态配置服务
class DynamicConfig {
  private cache: Map<string, any> = new Map();
  
  async load() {
    // 启动时从 PG 加载
    const configs = await prisma.dynamicConfig.findMany();
    configs.forEach(c => this.cache.set(c.key, c.value));
  }
  
  get(key: string) {
    // 读取走内存缓存，不走数据库
    return this.cache.get(key);
  }
  
  async set(key: string, value: any) {
    // 更新数据库
    await prisma.dynamicConfig.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    // 更新缓存
    this.cache.set(key, value);
    // 通知其他实例（通过 Redis Pub/Sub）
    redis.publish('config_changed', JSON.stringify({ key, value }));
  }
  
  // 监听配置变更（多实例同步）
  subscribe() {
    redis.subscribe('config_changed', (msg) => {
      const { key, value } = JSON.parse(msg);
      this.cache.set(key, value);
    });
  }
}
```

**关键设计：**

1. **内存缓存**：读取不走数据库，O(1)。
2. **数据库持久化**：配置变更存 PG，重启不丢。
3. **Redis Pub/Sub 通知**：多实例部署时，一个实例改了配置，其他实例通过 Pub/Sub 同步缓存。

**为什么不用 etcd/Consul/Apollo 等专业配置中心？** 因为我们的动态配置项不多（十几个），用 PG + Redis 就够了。配置中心的运维成本（独立集群、高可用）对我们来说不值得。如果动态配置项增长到上百个，或者需要配置审计、版本回滚等高级功能，再考虑配置中心。

### 🏗 架构分析

**配置管理分层**

| 类型 | 方案 | 特点 | 变更方式 |
|------|------|------|----------|
| 静态配置 | @myorg/config（zod + env） | 启动时确定 | 改环境变量+重启 |
| 动态配置 | PG + Redis 缓存 + Pub/Sub | 运行时可变 | API 修改+实时生效 |

**统一 Config 的价值**：类型安全（zod 转换）、集中默认值、启动校验（required 缺失即报错）。

**动态配置的设计**：内存缓存（快读）+ DB 持久化（不丢）+ Pub/Sub（多实例同步）。

### 🎯 面试官真正考察什么

1. **process.env 的不足**：类型不安全、无默认值、无校验——能不能说清楚？
2. **不重复造轮子**：底层用 zod，@myorg/config 只是封装——体现"站在巨人肩上"。
3. **动态配置意识**：知道有些配置运行时要变，且有缓存+通知的方案。

### ❌ 常见错误回答

- **"直接用 dotenv"**：dotenv 只读 .env 文件，无类型、无校验。
- **"用 Apollo 配置中心"**：不评估规模，小团队上配置中心过重。
- **动态配置每次读数据库**：没有缓存，性能差。

### ✅ 推荐回答

> process.env 三个问题：类型不安全（全是 string）、默认值散落、无启动校验（漏配运行时才崩）。@myorg/config 用 zod 封装：schema 定义类型+默认值+required，启动时 zod.parse 校验，缺失 required 直接报错不启动。底层就是 zod，我们加了 env 变量名→配置名的映射和类型约定。动态配置（限流阈值/Feature Flag/模型路由）用 PG+内存缓存+Redis Pub/Sub：读取走缓存 O(1)、变更存 PG 不丢、Pub/Sub 通知多实例同步缓存。不用 etcd/Apollo 因为配置项少（十几个）不值得独立集群。

### 📚 延伸知识

- **zod**：TypeScript 优先的 schema 校验库。`z.coerce.number()` 自动把 string 转 number。和 zod 类似的有 valibot（更轻量）、joi（Node 老牌）。
- **Feature Flag**：动态配置的典型场景。参考 LaunchDarkly、Unleash 等产品的设计——灰度发布、A/B 测试、紧急开关。

---

## Q11. 为什么 CI/CD？怎么做的？

**🎤 面试官**

> CI/CD 也是标配了。你们的 CI 流程是什么样的？和 Monorepo 怎么配合？

**🙋 候选人回答**

我们的 CI 分三个阶段，和 Monorepo 的增量能力配合：

**阶段一：PR 检查（每次提交 PR 触发）**

```yaml
# .github/workflows/ci.yml（简化）
name: CI
on: [pull_request]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # 需要完整历史用于增量检测
      
      - uses: pnpm/action-setup@v2
      
      # 只安装依赖（利用缓存）
      - run: pnpm install --frozen-lockfile
      
      # 增量检测：找出受影响的包
      - run: pnpm --filter=...[origin/main] lint
      - run: pnpm --filter=...[origin/main] typecheck
      - run: pnpm --filter=...[origin/main] test
      - run: pnpm --filter=...[origin/main] build
```

**关键：`pnpm --filter=...[origin/main]`**。这个过滤器表示"自 main 分支以来有变更的包，以及依赖这些包的其他包"。改了 utils，只会跑 utils + request + hooks + components 的检查，不会跑无关业务项目的检查。

**阶段二：合并到 main（自动触发）**

合并到 main 后：
1. 重新跑全量检查（保险）
2. 如果是 Monorepo 内部包，不自动发版（发版走 Changesets PR）
3. 如果是业务项目，自动部署到 staging 环境

**阶段三：发版（Changesets PR 合并触发）**

```
① 日常 PR 合并 → CI 检查通过
② Changesets bot 自动创建 "Version Packages" PR
   - 包含版本号 bump + CHANGELOG
③ 发版 PR 的 CI：全量测试
④ 合并发版 PR → 自动 publish 到 npm + 打 tag
⑤ 业务项目：部署到 production
```

---

**🎤 面试官追问**

> 你说增量 CI 只跑受影响包，但怎么判断"受影响"？如果改了 utils 的类型定义，components 可能类型 break 了，怎么检测到？

**🙋 候选人回答**

**pnpm 的 `--filter=...[origin/main]` 已经处理了这个。**

`...[origin/main]` 的语义是：**自 main 分支以来有文件变更的包，以及它们的依赖者（dependents）**。

```
改了 utils 的源码
  → utils 被标记为"有变更"
  → request 依赖 utils → request 被标记为"受影响"
  → hooks 依赖 request → hooks 被标记为"受影响"
  → components 依赖 hooks → components 被标记为"受影响"
  → 依赖 components 的业务项目 → 也被标记
```

**这是依赖图的正向传播**——改了底层包，所有依赖它的上层包都会被检测到。

**但有一个盲区**：pnpm 的 filter 基于包的依赖关系，不是基于代码分析。如果 components 的代码里用了 utils 的某个函数，但 package.json 里没声明依赖（幽灵依赖），pnpm 不知道 components 依赖 utils，就不会把 components 标记为受影响。

**解决方案：pnpm 的严格模式**。pnpm 默认不允许幽灵依赖——如果 components 用了 utils 但没声明依赖，安装时会报错。这强制了依赖声明的完整性，保证 filter 的准确性。

**类型 break 怎么检测？** typecheck。`pnpm --filter=...[origin/main] typecheck` 会对受影响的包跑 `tsc --noEmit`。如果 utils 改了类型导致 components 类型错误，components 的 typecheck 会失败。

**所以增量 CI 的准确性依赖于两点**：
1. pnpm 严格模式保证依赖声明完整
2. typecheck 检测类型层面的 break

---

**🎤 面试官继续追问**

> CD（持续部署）呢？业务项目怎么从 CI 到部署？是自动部署还是手动？

**🙋 候选人回答**

**分环境，策略不同：**

| 环境 | 触发方式 | 自动化程度 |
|------|----------|-----------|
| Staging | 合并到 main | 全自动 |
| Production | 手动审批 | 半自动（审批后自动部署） |

**Staging 全自动**：

```yaml
deploy-staging:
  if: github.ref == 'refs/heads/main'
  needs: check  # 依赖 CI 检查通过
  steps:
    - run: pnpm --filter=drama-editor build
    - run: docker build -t drama-editor:staging .
    - run: docker push registry/drama-editor:staging
    - run: kubectl set image deployment/drama-editor drama-editor=registry/drama-editor:staging
```

合并到 main → CI 通过 → 自动构建 Docker 镜像 → 推送 → 更新 K8s 部署。全程无人值守。

**Production 半自动**：

```yaml
deploy-production:
  if: startsWith(github.ref, 'refs/tags/v')  # 标签触发
  environment: production  # 需要审批
  steps:
    - run: docker push registry/drama-editor:${{ github.ref_name }}
    - run: kubectl set image deployment/drama-editor drama-editor=registry/drama-editor:${{ github.ref_name }}
```

生产部署需要**打 tag（v1.2.3）+ 审批**。打 tag 是手动操作（有意识地发版），environment: production 会触发 GitHub 的审批流程（指定人审批后才执行）。

**为什么不全自动到生产？** 因为生产部署有风险——虽然 CI 通过了，但可能有环境差异、数据迁移等 CI 检测不到的问题。手动审批是一个"checkpoint"，让人有机会做最后的确认。

**这是"自动化的边界"原则**：越是不可逆的操作（生产部署），自动化应该停在"准备就绪"的状态，最终触发由人决定。可逆的操作（staging 部署、测试）可以全自动。

### 🏗 架构分析

**CI/CD 流程**

```
PR 提交 → 增量 CI（lint+typecheck+test+build）
    ↓
合并 main → 全量 CI + 自动部署 Staging
    ↓
Changesets PR → 全量 CI → 合并 → 发布 npm
    ↓
打 tag v1.2.3 → 审批 → 自动部署 Production
```

**增量 CI 的关键**：pnpm `--filter=...[origin/main]` + 严格模式（无幽灵依赖）+ typecheck 检测类型 break。

**CD 策略**：staging 全自动（可逆）、production 半自动（审批 checkpoint）。

### 🎯 面试官真正考察什么

1. **Monorepo CI**：增量 CI 怎么做？pnpm filter 的原理是什么？
2. **CI 和 CD 的区别**：CI 是验证，CD 是部署。两者的自动化程度不同。
3. **自动化边界**：生产不全自动——知道什么时候该停让人介入。

### ❌ 常见错误回答

- **全量 CI**："每次跑所有包的测试。"——Monorepo 下太慢。
- **生产全自动**："合并 main 直接上生产。"——太危险，没有 checkpoint。
- **不知道幽灵依赖**：增量 CI 漏检还不知道为什么。

### ✅ 推荐回答

> CI 三阶段：PR 检查（增量，pnpm --filter=...[origin/main] 只跑受影响包）、合并 main（全量+部署 staging）、发版 PR（Changesets+全量+publish npm）。增量 CI 的 filter 基于依赖图正向传播——改 utils 自动检测到 request/hooks/components 受影响。准确性靠 pnpm 严格模式（无幽灵依赖保证依赖声明完整）+ typecheck（检测类型 break）。CD 分环境：staging 全自动（合并 main 即部署）、production 半自动（打 tag+审批后部署）。自动化边界原则：可逆操作全自动、不可逆操作（生产部署）停在"准备就绪"由人触发。

### 📚 延伸知识

- **pnpm filter 语法**：`--filter=<pkg>` 指定包、`--filter=...[origin/main]` 变更包+依赖者、`--filter=^<pkg>` 依赖者、`--filter=./apps/*` 路径匹配。
- **GitHub Environments**：GitHub Actions 的环境保护规则——required reviewers、deployment branches、wait timer。用于生产部署审批。

---

## Q12. 开发规范怎么定和落地？

**🎤 面试官**

> 规范谁都会写文档，但落地很难。你们怎么让规范真的被执行，而不是一纸空文？

**🙋 候选人回答**

**规范落地的核心原则：能自动化的不靠人，不能自动化的靠流程。**

我们的规范分三类，落地方式不同：

**① 代码风格规范 → 工具自动化**

ESLint + Prettier + Husky + lint-staged：

```json
// package.json
{
  "husky": {
    "hooks": {
      "pre-commit": "lint-staged"
    }
  },
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md}": ["prettier --write"]
  }
}
```

**git commit 时自动格式化**。开发者不需要"记住规范"——工具帮你遵守。这一层完全自动化，零人工干预。

**② 提交规范 → 工具 + CI**

用 Conventional Commits（`feat:`, `fix:`, `chore:` 等）：

```bash
# commitlint 检查 commit message 格式
# .commitlintrc.js
module.exports = {
  extends: ['@commitlint/config-conventional'],
};
```

Husky 的 commit-msg hook 检查格式，不符合拒绝提交。CI 里也跑一次（防止绕过 hook）。

**为什么管 commit message？** 因为 Changesets 和自动 CHANGELOG 依赖规范的 commit message。如果不规范，自动化链路断掉。

**③ 架构规范 → Code Review**

这一层不能自动化——"Task 模块不应该直接 import 业务模块"这种架构约束，工具检测不了（或者说检测成本太高）。

靠 Code Review 落地。但 Code Review 要有效，有几个前提：

1. **规范文档化**：架构规范写成文档，Review 时有据可依。
2. **Review Checklist**：给 Reviewer 一个检查清单，不靠记忆。

```markdown
## Code Review Checklist

### 架构
- [ ] 业务模块不直接 import 平台模块的实现（只通过接口）
- [ ] 新增依赖是否合理（是否真的需要这个依赖）
- [ ] 是否有循环依赖

### 安全
- [ ] 不硬编码 API Key / 密码
- [ ] 用户输入是否校验
- [ ] SQL 是否参数化（防注入）

### 性能
- [ ] 循环内是否有不必要的数据库查询
- [ ] 大列表是否分页
- [ ] 是否有内存泄漏风险（事件监听器是否清理）
```

3. **多人 Review**：核心代码至少 2 人 Review。一个人可能漏看。

---

**🎤 面试官追问**

> 你说 Code Review 落地架构规范，但实际中 Review 经常流于形式——"LGTM"就过了。怎么让 Review 真的有效？

**🙋 候选人回答**

**这是真问题。Review 流于形式是最常见的失败。我们的做法：**

**① Lead 以身作则**

如果 Tech Lead 的 Review 也是"LGTM"，团队就会效仿。我 Review 代码时会逐行看，留下具体评论（不是泛泛的"改改"）。这树立了标准——团队看到 Lead 认真 Review，自己也会认真。

**② 小 PR 强制**

PR 超过 400 行，Review 质量必然下降——没人有耐心看 1000 行代码。我们约定：PR 尽量控制在 400 行以内，大功能拆成多个小 PR。

```markdown
# PR 模板
## 变更说明
简述改了什么、为什么改

## 测试
- [ ] 单元测试通过
- [ ] 手动测试了 [具体场景]

## Review 要点
指出希望 Reviewer 重点看的地方（不是让 Reviewer 从头看到尾）
```

**"Review 要点"这个字段很关键**——它引导 Reviewer 聚焦，而不是无目的地看。作者最清楚哪里有风险，主动指出让 Review 更高效。

**③ 自动化分担 Review 负担**

能自动检查的不让人 Review。ESLint 管代码风格、TypeScript 管类型、测试管逻辑正确性。Code Review 只看**自动化检测不了的**：架构合理性、命名语义、边界条件、安全风险。

如果 Reviewer 在 Review 代码风格，说明自动化没做好——应该加 ESLint 规则，而不是靠人眼。

**④ 定期 Review 复盘**

每月抽一个 PR，团队一起 Review（公开讨论）。这不是批评作者，而是校准 Review 标准——让大家对"什么是好的代码"达成共识。

---

**🎤 面试官继续追问**

> 规范定下来后，怎么处理"例外"情况？有时候业务紧急，规范挡路了怎么办？

**🙋 候选人回答**

**规范必须有"逃生通道"，否则会被绕过。**

我们的逃生通道是 **Tech Debt ticket + 显式标注**：

```typescript
// 代码里显式标注技术债
// @tech-debt: 这里直接 import 了 TaskService 的实现而非接口，
// 因为紧急修复线上 Bug，来不及走接口抽象。
// Ticket: TD-123，预计 v2.1 修复
// Owner: @zhanglun
import { TaskService } from '@myorg/task-platform';
```

**关键设计：**

1. **显式标注**：不是偷偷绕过规范，而是明确标记"这是技术债"。
2. **关联 Ticket**：每个技术债有对应的修复 Ticket，进 Backlog。
3. **有 Owner 和时间线**：谁欠的债、什么时候还。

**这个机制的好处：**

- **规范不被破坏**：绕过规范是"例外"，不是"常态"。例外有记录、有追踪。
- **团队不内耗**：紧急情况下不用争论"要不要遵守规范"——可以破例，但要标记。
- **债务不遗忘**：Ticket 进 Backlog，定期清理。

**如果没有这个逃生通道**，会出现两种坏情况：

1. **规范被无视**：紧急情况绕过了，之后大家觉得"规范可以不遵守"，规范形同虚设。
2. **规范挡业务**：严格不破例，紧急修复被规范卡住，业务受损。

**逃生通道是"规范的弹性"**——不刚性到挡业务，不柔性到被无视。标记 + 追踪 = 既允许例外，又保证例外被偿还。

### 🏗 架构分析

**规范落地的三层**

| 层 | 规范类型 | 落地方式 | 自动化程度 |
|----|---------|----------|-----------|
| L1 | 代码风格 | ESLint+Prettier+Husky | 全自动 |
| L2 | 提交规范 | commitlint+CI | 全自动 |
| L3 | 架构规范 | Code Review+Checklist | 人工 |

**核心原则**：能自动化的不靠人（L1/L2），不能自动化的靠流程（L3）。Reviewer 只看自动化检测不了的。

**技术债管理**：@tech-debt 标注 + Ticket 追踪 + Owner/时间线。允许例外但例外有记录。

### 🎯 面试官真正考察什么

1. **分层意识**：不是所有规范都用一种方式落地。代码风格自动化、架构靠 Review——区分清楚。
2. **Review 有效性**：不只说"我们做 Code Review"，还说怎么让 Review 不流于形式（小 PR、Review 要点、Lead 示范）。
3. **规范的弹性**：技术债逃生通道——允许破例但要标记追踪。这是成熟团队的标志。

### ❌ 常见错误回答

- **"写规范文档"**：文档不等于落地。
- **全靠 Code Review**：代码风格也靠人 Review，浪费人力且不可靠。
- **没有逃生通道**：规范太刚性，要么被无视要么挡业务。

### ✅ 推荐回答

> 三层落地：代码风格（ESLint+Prettier+Husky pre-commit 自动格式化，零人工）、提交规范（commitlint+CI 检查 conventional commits）、架构规范（Code Review+Checklist，因为架构约束工具检测不了）。Review 有效性四个做法：Lead 以身作则逐行 Review、小 PR（<400 行）+ PR 模板含"Review 要点"引导聚焦、自动化分担（能自动检查的不让人看）、定期 Review 复盘校准标准。规范弹性用 @tech-debt 标注+Ticket 追踪+Owner/时间线——允许紧急破例但必须标记和偿还。没有逃生通道规范要么被无视要么挡业务。

### 📚 延伸知识

- **Husky v9**：Git hooks 管理工具。v9 简化了配置，不再需要 package.json 里的 husky 字段。
- **lint-staged**：只检查 staged 文件（git add 的文件），不是全量检查。配合 Husky 在 pre-commit 时跑，快且精准。

---

## 本章总结

第三章用 12 道题覆盖了前端工程化的核心设施。回顾关键决策：

| 设施 | 核心决策 | 理由 |
|------|----------|------|
| 组件库 | Radix UI + Tailwind | 设计自由 + 行为可靠 + 零运行时 |
| 工具库 | 分层（utils→request→hooks→components） | 依赖只向下，避免污染 |
| CLI | 脚手架组装 + 共享包管内容 | CLI 不频繁更新，规则走包升级 |
| Monorepo | pnpm workspace + Changesets | 原子提交 + 独立版本 + 增量 CI |
| Storybook | Vite + CSF 3.0 + 最少 addon | 展示 + 文档 + 交互测试 |
| Logger | AsyncLocalStorage + 接口统一实现分化 | 结构化 + 自动上下文 |
| Request | fetch + 智能重试 + 幂等键 | 原生标准 + 安全重试 |
| Config | zod + 静态/动态分离 | 类型安全 + 启动校验 |
| CI/CD | 增量 CI + staging 全自动/prod 审批 | 快速反馈 + 安全部署 |
| 规范 | 三层（自动化/CI/Review）+ 技术债通道 | 能自动不靠人 + 允许例外 |

**贯穿本章的核心原则**：

1. **统一接口，分化实现**（Logger/Request 前后端不同实现但 API 一致）
2. **能自动化的不靠人**（ESLint/Husky/commitlint 代替人工检查）
3. **延迟不可逆决策**（组件库 deprecation 缓冲、生产部署审批 checkpoint）
4. **工具驱动规范**（规范固化到 CLI/ESLint/CI，而非文档）

下一章进入[第四章：Task Platform](chapter-04-task-platform.md)——全书重点，深入任务生命周期、状态机、WebSocket、Worker 设计、取消重试幂等、可靠性、日志 Trace。
