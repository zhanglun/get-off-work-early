"""
全局配置：所有天数共用这一份配置。
作用：把「会变的参数」(模型名、key、上限步数) 和「代码逻辑」分开。
"""
import os
from dotenv import load_dotenv

# 自动读取项目根目录下的 .env 文件
load_dotenv()


class Config:
    # ---- LLM 配置 ----
    # glm-4-flash-250414：智谱免费档，支持 function calling
    MODEL = "glm-4-flash-250414"

    # 从环境变量读取 API Key（不要把 key 写死在代码里！）
    API_KEY = os.getenv("ZHIPUAI_API_KEY", "")

    # 采样温度：0 = 稳定，1 = 随机。Agent 场景偏低温度，保证工具调用稳定
    TEMPERATURE = 0.3

    # ---- Agent 行为 ----
    # 最大循环步数：防止 Agent 陷入死循环
    MAX_STEPS = 10

    @classmethod
    def check(cls):
        """检查配置是否就绪，每天 Day 的 agent.py 启动时都会调用。"""
        if not cls.API_KEY:
            raise RuntimeError(
                "缺少 ZHIPUAI_API_KEY！\n"
                "请：\n"
                "1. 把 .env.example 复制成 .env\n"
                "2. 填入你的智谱 API Key（申请：https://open.bigmodel.cn/usercenter/apikeys）"
            )


if __name__ == "__main__":
    Config.check()
    print(f"✓ 配置就绪")
    print(f"  模型: {Config.MODEL}")
    print(f"  API Key: {Config.API_KEY[:8]}...{Config.API_KEY[-4:]}")
