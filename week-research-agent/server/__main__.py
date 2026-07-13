"""
Server 包入口：支持 python -m server 启动。

等价于 python server/main.py。
"""
import uvicorn

if __name__ == "__main__":
    from server.main import app
    print("=" * 60)
    print(" 🔬 Research Agent 服务启动中...")
    print("    访问 http://localhost:8000 使用网页界面")
    print("    访问 http://localhost:8000/docs 查看 API 文档")
    print("    按 Ctrl+C 停止")
    print("=" * 60)
    uvicorn.run(app, host="0.0.0.0", port=8000)
