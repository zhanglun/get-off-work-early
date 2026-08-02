# 周 2 资源：机器人软件栈 + ROS 概念

> 用途：第 2 周 D1-D6。目标：能对话，不是会写代码。**只看概念，不写 ROS 代码。**

## ROS 2 概念（D1-D2）

- ⭐ [ROS 2 Documentation / Tutorials](https://docs.ros.org/en/rolling/Tutorials.html) —— 只读概念部分：Nodes（节点）、Topics（话题）、Messages（消息）、Bags。**看前 4-5 节即可**，不碰后面的代码 tutorial。
- ⭐ ROS bag 是什么：[ROS 2 bag 官方文档](https://docs.ros.org/en/rolling/Tutorials/Intermediate/Rosbag/Recording-and-Playing-Back-Data.html) —— 先读概念；想动手可以装 ROS 2（Linux 下 `sudo apt install ros-*-ros2bag`）或先找现成 bag 看格式。
- ○ 公开 ROS bag 示例：搜 "ROS bag download sample"，GitHub 上有大量真实 bag（如 `rosbag2_examples`）；也可以找自动驾驶数据集（如 nuScenes 有 ROS bag 版）。D2 目标是"看到一个真实 bag 里面长什么样"。

## 感知-规划-控制（D3）

- ⭐ [机器人算法四大模块技术科普：定位、感知、规划、调度 — CSDN](https://blog.csdn.net/qq_52293640/article/details/162791603) —— 最对口：四个模块一张图 + 通俗类比，面向软件/测试工程师（就是你的视角）。
- [机器人导航算法并不神秘 — 人人都是产品经理](https://www.woshipm.com/share/6237874.html) —— 用讲故事的方式讲导航/规划/感知，零基础友好。
- ○ [从感知到自主决策：机器人技术的演进与核心架构 — CSDN](https://blog.csdn.net/beautifulmemory/article/details/162686266) —— 更全面，含 LLM/VLM 如何重塑机器人认知（和具身智能现状直接相关）。
- 平台视角要点：感知（感知世界→输出状态）→ 规划（决定下一步做什么）→ 控制（把意图变成电机指令）。**你的平台工作在它们之上的数据/训练/可视化层。**

## 传感器速查（D4，平台视角）

| 传感器 | 输出数据 | 典型频率 | 平台要处理的点 |
|---|---|---|---|
| RGB 相机 | 图像帧（RGB） | 10-60 Hz | 大文件、时间戳对齐 |
| 深度相机（RGB-D） | 深度图/点云 | 10-30 Hz | 数据量大，压缩格式 |
| 激光雷达（LiDAR） | 点云 | 10-20 Hz | 稀疏、量级百万点/帧 |
| IMU | 加速度/角速度 | 100-1000 Hz | 高频、时序敏感 |
| 关节编码器 | 关节角度/速度 | 100-1000 Hz | 动作轨迹的核心来源 |
| 触觉/力传感器 | 力/力矩/压感 | 100-1000 Hz | 灵巧手任务关键 |

> 这周不用记死数字（各机器人差异大），记**量级和"平台要处理什么"**即可——面试时说"我了解多传感器数据的时间戳对齐问题"比说"IMU 是 500Hz"值钱。

## 产出物入口（第 1 周 D5-D6 用）

- 数据流图模板：`../outputs/周2-图-传感器到执行.md`
