"""
HTTP 请求/响应的 Schema（用 Pydantic 定义）。

【和之前 schema 的区别】
- common/schemas.py 的 TOOLS_SCHEMA：给 LLM 看的（工具定义）
- 这里的是 HTTP 接口的：给客户端/前端看（API 契约）

Pydantic 的作用：
- 自动校验请求（topic 不能为空、类型要对）
- 自动生成响应文档（Swagger /docs）
- 自动序列化（dict ↔ JSON）
"""
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional


class ResearchRequest(BaseModel):
    """研究请求：客户端 POST 过来的内容。"""
    topic: str = Field(..., min_length=1, max_length=200, description="研究课题")
    session_id: Optional[str] = Field(
        None, description="会话 ID（Day 8 Session Memory）。传入则 Agent 带历史记忆研究"
    )


class ResearchMetadata(BaseModel):
    """运行元信息（让用户看到 Agent 干了什么）。"""
    steps: int = Field(..., description="执行步数")
    elapsed: float = Field(..., description="总耗时（秒）")
    status: str = Field(..., description="运行状态")
    tool_calls: List[Dict[str, Any]] = Field(
        default_factory=list, description="工具调用明细"
    )
    tokens: Optional[Dict[str, int]] = Field(
        None, description="Token 用量（Day 10）：prompt/completion/total"
    )


class ResearchResponse(BaseModel):
    """研究响应：返回给客户端的内容。"""
    topic: str = Field(..., description="研究课题")
    report: Dict[str, Any] = Field(default_factory=dict, description="结构化研究报告")
    metadata: ResearchMetadata = Field(..., description="运行元信息")
    session_id: Optional[str] = Field(None, description="会话 ID（前端下次请求带上它）")


class HealthResponse(BaseModel):
    """健康检查响应。"""
    status: str = "ok"
    service: str = "research-agent"
