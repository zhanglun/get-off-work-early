---
version: 1
slug: "apps-web-src-pages-workspace-tsx"
primary_target: "apps/web/src/pages/Workspace.tsx"
related_targets: ["apps/web/src/pages/WorkspaceBoard.tsx","apps/web/src/pages/Login.tsx","apps/web/src/pages/Projects.tsx","apps/web/src/index.css"]
---

## Surface brief — 工作区（apps/web/src/pages/Workspace.tsx 及全站）

- **Scope & mode**: 全站四页（Login/Projects/Workspace/WorkspaceBoard），Operate 模式；访客为短剧前期制作者，任务是登记剧本→拆集确认→逐集盯制作→核对分镜→导出。
- **Direction**: 掷骰指派并经决策页锁定「分镜连载页（漫画分格）」，seed dcb9b164，code-led 构建。方向契约见 apps/web/index.html 顶部注释。
- **结构论点**: 双主轴——页顶「连载进度条」每集一格（状态即上墨：空心=已登记、青网点=制作中、实心墨=完成、红套印=失败）；下方左对话气泡流（用户右泡、助手旁白框、剧本登记格），右分格画廊 44%（镜号黑角标、速度线、套印偏移错误章）。
- **Memorable moment**: 拆集确认卡「分集预告页」——确认后各集逐格上墨，进度条随之填墨。
- **States**: 登录/空目录/空工作区/制作中/部分失败/穿帮待处理均已实现；<980px 隐藏图版列。
- **Unresolved**: 展示字体待引入（网络受限无法自托管中文展示字体，暂以系统黑体 900 权重承担，已披露）。
