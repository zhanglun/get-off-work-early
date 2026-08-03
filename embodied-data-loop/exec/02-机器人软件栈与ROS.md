# 第 1 周资源（D3-D4）：机器人软件栈 + ROS 概念

> 用途：加速版第 1 周 D3-D4。目标：能对话，不是会写代码。**只看概念，不写 ROS 代码。**
> ⚠️ 2026-08-03 更新：移除过时/失效资源——ROS 文档从 rolling（开发版）换成 **Jazzy（当前 LTS，支持到 2029-05）**；删除两篇 CSDN 文章，替换为已验证的非 CSDN 资源。

## ROS 2 概念（D3，中文优先）

> ⚠️ 2026-08-03 更新：ROS 概念部分从英文官方文档换成**中文资源**（此前全是 docs.ros.org 英文链接，对"只看概念"不友好）。
> 版本说明：中文资源为 Humble 版翻译，概念部分与当前 LTS 的 Jazzy **内容一致**（节点/话题/服务/消息不涉及版本特性），放心看。

- ⭐✅ [【ROS2】Concept（Basic）详解（博客园）](https://www.cnblogs.com/yjbjingcha/p/19096147) —— 官方 Concepts 文档的中文翻译整理，一篇通读：节点 / 发现 / 接口（话题·服务·动作）/ 消息。**D3 主资源，读这一篇即可**。
- ⭐✅ [ROS 2 官方文档中文翻译（robook，人工校对）](https://ros2docs.robook.org/humble/Concepts/Basic/About-Nodes.html) —— 官方文档的**人工校对中文版**（非机翻），权威对照：节点、话题、服务、接口四个概念页各读一遍即可。
- ○ [鱼香 ROS《概念》页](http://dev.ros2.fishros.com/doc/Concepts.html) —— 官方概念的中文版，但有机翻痕迹（页面有"待校准"标记），备选。
- ○ [古月居 B站《ROS2入门21讲》7-9 讲](https://www.bilibili.com/video/BV16B4y1Q7jQ/) —— 视频：第 7 讲节点、第 8 讲话题、第 9 讲服务。不想读文字就看视频（未逐一验证，打开确认）。
- （可选对照）[ROS 2 官方英文文档（Jazzy）](https://docs.ros.org/en/jazzy/Tutorials.html) —— 英文 OK 时对照用，不强制。

### ROS bag（D4 用）

- ⭐✅ [ROS 2 bag 官方文档（Jazzy）](https://docs.ros.org/en/jazzy/Tutorials/Intermediate/Rosbag/Recording-and-Playing-Back-Data.html) —— 先读概念；想动手可以装 ROS 2（Linux 下 `sudo apt install ros-jazzy-ros2bag`）或先找现成 bag 看格式。
- ○ 公开 ROS bag 示例：搜 "ROS bag download sample"，GitHub 上有大量真实 bag（如 `rosbag2_examples`）；也可以找自动驾驶数据集（如 nuScenes 有 ROS bag 版）。D4 目标是"看到一个真实 bag 里面长什么样"。

## 感知-规划-控制（D3）

- ⭐✅ [从智能硬件到机器人：一张全景导览 — 器赋开物](https://qifudev.com/guide/l4-robot-intro/) —— 最通俗的入口：讲清"感知→决策→执行→再感知"的闭环回路，以及机器人 vs 普通智能硬件的区别（开环 vs 闭环）。已验证可用。
- ⭐✅ [机器人控制简明教程 — 汇智网](https://www.hubwiz.com/blog/robotics-control-concise-tutorial/) —— 控制层次拆解：任务规划 → 轨迹规划 → 控制 → 执行器控制，讲清"规划决定去哪、控制决定怎么走"。已验证可用。
- ⭐✅ [从零开始，构建完整的机器人项目 — Robotics Course Docs](https://www.fromzerotohero.cn/zh/) —— 面向实践的中文课程站：以 ROS 为骨架，串联感知、规划、仿真、部署，按需翻对应章节即可。已验证可用。
- ○ [机器人导航算法并不神秘 — 人人都是产品经理](https://www.woshipm.com/share/6237874.html) —— 用讲故事的方式讲导航/规划/感知，零基础友好（未验证，备用）。

- 平台视角要点：感知（感知世界→输出状态）→ 规划（决定下一步做什么）→ 控制（把意图变成电机指令）。**你的平台工作在它们之上的数据/训练/可视化层。**

## 传感器速查（D4，平台视角）

| 传感器 | 输出数据 | 典型频率 | 平台要处理的点 |
| --- | --- | --- | --- |
| RGB 相机 | 图像帧（RGB） | 10-60 Hz | 大文件、时间戳对齐 |
| 深度相机（RGB-D） | 深度图/点云 | 10-30 Hz | 数据量大，压缩格式 |
| 激光雷达（LiDAR） | 点云 | 10-20 Hz | 稀疏、量级百万点/帧 |
| IMU | 加速度/角速度 | 100-1000 Hz | 高频、时序敏感 |
| 关节编码器 | 关节角度/速度 | 100-1000 Hz | 动作轨迹的核心来源 |
| 触觉/力传感器 | 力/力矩/压感 | 100-1000 Hz | 灵巧手任务关键 |

> 这周不用记死数字（各机器人差异大），记**量级和"平台要处理什么"**即可——面试时说"我了解多传感器数据的时间戳对齐问题"比说"IMU 是 500Hz"值钱。

## 产出物入口（第 1 周 D5-D6 用）

- 数据流图模板：`../outputs/周2-图-传感器到执行.md`
