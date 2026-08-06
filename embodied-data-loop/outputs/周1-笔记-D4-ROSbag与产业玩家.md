# 周 1 笔记：D4 ROS bag + 产业玩家官网

> 完成标准：能说出"bag 里有什么"。日期：2026-08-06

## 一、ROS bag：话题数据的"录音文件"

**bag = 用 `rosbag record` 录下的话题数据流**，回放用 `rosbag play`。

**两种格式（ROS 2 是重点）：**

| | ROS 1 | ROS 2 |
| --- | --- | --- |
| 形态 | 单个 `.bag` 文件 | **一个目录**：`metadata.yaml` + `.db3` 文件 |
| 元数据 | 内嵌 | `metadata.yaml`（YAML） |
| 数据 | 内嵌 | `.db3`（**SQLite 数据库**） |

**bag 里有什么（验收标准）：**

1. **话题列表**：录了哪些话题（`/camera/image`、`/lidar/points`、`/joint_states`、`/tf`…）
2. **每个话题的消息类型**（sensor_msgs/Image、sensor_msgs/PointCloud2…）
3. **按时间戳排列的消息数据**：每帧图像、每帧点云、每个关节角读数——**多模态时序数据流**

**怎么看：**

- 装了 ROS：`ros2 bag info <bag>`（元数据）/ `ros2 bag play <bag>`（回放）
- 不装 ROS 也行：`.db3` 本质是 SQLite、`metadata.yaml` 是 YAML，直接读

**公开 bag 下载源（已验证）：**

- ⭐ [Autoware sample_moriyama](https://github.com/Autoware-AI/utilities/blob/master/autoware_launcher/documents/demos/rosbag.md) —— 经典自动驾驶教学 bag，多话题（点云/图像/TF）
- ⭐ [DearBagPlayerDemoData](https://github.com/Magic-wei/DearBagPlayerDemoData) —— 小车演示 bag，小、简单
- [ROBOMASTER 2025 LiDAR bag](https://huggingface.co/datasets/BreCaspian/ROBOMASTER-2025-LiDAR-ROSBAG) —— 机器人竞赛数据，HF 下载
- ⚠️ 原 `rosbag2_examples` 仓库已 404 失效

**对平台的意义**：bag 就是数据平台要接收的**原始数据格式之一**（多模态、时序、带时间戳）——和第 2 周 RLDS 数据集、D1 的"轨迹数据"是同一层的东西，只是来源格式不同。

## 二、产业玩家官网（全部验证 ✅，2026-08-06）

| 公司 | 官网 | 一句话 |
| --- | --- | --- |
| 宇树 | <https://www.unitree.com/> | 硬件+数据采集方案，IPO 已过会 |
| 智元 | [中文官网](https://www.agibot.com.cn/) / [英文官网](https://www.agibot.com/) | 出货全球第一，开放数据集 |
| Figure | <https://www.figure.ai/> | 弃 OpenAI，自研 Helix VLA |
| 特斯拉 Optimus | <https://www.tesla.com/optimus> | 复用 FSD 视觉，量产临近 |
| 银河通用 | <https://www.galaxybot.com/> | 合成仿真为主，真机采集为辅 |
| 纽鼐 | <https://www.neura-robotics.com/> | 机器人安卓平台，英伟达领投 |

💡 新发现：智元官网有「**AgiBot DaaS 数据服务 + 全栈数采方案**」业务线——大厂已在卖数据服务，验证数据平台方向。

## 关联

- 资源：`../exec/02-机器人软件栈与ROS.md`
- 下一步 D5：画传感器→执行图（`outputs/周2-图-传感器到执行.md`）
