"""
公共模块：所有 Day 共用的代码资产。

【为什么有这个目录】
Day 1-4 每天都自己写一份 tools.py / schemas.py，导致：
- 代码重复（add / read_file 在 day1/2/3/4 各有一份）
- Day 4 想复用 Day 3 的 state.py，只能用 importlib 绝对路径加载，很别扭

Day 5 把"所有 Day 都会用"的代码抽到这里，从此：
- tools / schemas / logger / state 全局唯一一份
- 任何 Day（包括未来的 day5+）都 from common import xxx
- 这就是"代码资产积累"的真正落地
"""
