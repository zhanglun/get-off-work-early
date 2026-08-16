// 盲测契约 v1.1 e2e 验证（全降级模式：mem store + 进程内队列 + mock LLM）
// 用法：先 npm run dev 起服务，再 node scripts/e2e-blind.mjs
const BASE = process.env.BASE ?? 'http://localhost:3000';

const log = (ok, name, extra = '') =>
  console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ` —— ${extra}` : ''}`);
const fail = [];
const check = (ok, name, extra) => { log(ok, name, extra); if (!ok) fail.push(name); };

async function main() {
  // 1. 建任务（mock 链路：legacy mock 5 镜 → shot loop → done）
  const t = await fetch(`${BASE}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scriptText: `第1场 咖啡馆 内 日\n女人搅拌咖啡，抬眼看男人。\n男人放下杯子，欲言又止。\n第2场 街道 外 傍晚\n两人并肩走，女人先开口。\n男人停下脚步，回头看她。`,
      episodeNo: 1,
    }),
  }).then((r) => r.json());
  check(!!t.taskId, 'POST /tasks → 入队', `taskId=${t.taskId}`);

  // 2. 轮询到终态
  let task;
  for (let i = 0; i < 60; i++) {
    task = await fetch(`${BASE}/tasks/${t.taskId}`).then((r) => r.json());
    if (['done', 'failed', 'partial'].includes(task.status)) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  check(task.status === 'done', '轮询终态 done', `status=${task.status}`);

  // 3. pairs：拿 shotId + A/B 文本
  const pairs = await fetch(`${BASE}/tasks/${t.taskId}/pairs`).then((r) => r.json());
  check(pairs.length >= 5, `GET pairs ${pairs.length} 镜`);
  check(pairs.every((p) => p.sideA?.prompt && p.sideB?.prompt), '每镜两侧都有 prompt');
  // 同侧序稳定（第二次拉取 A/B 文本逐镜一致）
  const pairs2 = await fetch(`${BASE}/tasks/${t.taskId}/pairs`).then((r) => r.json());
  const stable = pairs.every((p, i) => p.sideA.prompt === pairs2[i].sideA.prompt);
  check(stable, '二次拉取侧序稳定');

  // 4. 打分：胜 + 平 + 重复 + 错 shotId
  const s1 = pairs[0], s2 = pairs[1], s3 = pairs[2];
  const post = (body) =>
    fetch(`${BASE}/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  let r = await post({ shotId: s1.shotId, rater: '客户甲', winner: 'A', scoreA: 5, scoreB: 3 });
  check(r.status === 200 || r.status === 201, '提交：客户甲 shot1 选 A（5:3）', `status=${r.status}`);

  r = await post({ shotId: s2.shotId, rater: '客户甲', winner: 'tie', scoreA: 4, scoreB: 4 });
  check(r.status === 200 || r.status === 201, '提交：客户甲 shot2 平局（4:4）', `status=${r.status}`);

  r = await post({ shotId: s3.shotId, rater: '客户甲', winner: 'B', scoreA: 2, scoreB: 5, sideOrder: 'left:new' });
  check(r.status === 200 || r.status === 201, '提交：多传 sideOrder 字段被忽略（服务端不信客户端）', `status=${r.status}`);

  r = await post({ shotId: s1.shotId, rater: '客户甲', winner: 'B', scoreA: 1, scoreB: 5 });
  check(r.status === 409, '重复提交 → 409', `status=${r.status}`);

  r = await post({ shotId: s1.shotId, rater: '客户乙', winner: 'B', scoreA: 3, scoreB: 4 });
  check(r.status === 200 || r.status === 201, '同镜不同人合法', `status=${r.status}`);

  r = await post({ shotId: 'nonexistent', rater: '客户甲', winner: 'A', scoreA: 4, scoreB: 4 });
  check(r.status === 404, '错 shotId → 404（不产生孤儿分）', `status=${r.status}`);

  r = await post({ shotId: s1.shotId, rater: '客户丙', winner: 'A', scoreA: 9, scoreB: 4 });
  check(r.status === 400, '分数越界 → 400', `status=${r.status}`);

  // 5. 报表：tieRate 存在、票数对
  const report = await fetch(`${BASE}/tasks/${t.taskId}/scores`).then((r) => r.json());
  const votes = report.perShot.reduce((a, r2) => a + r2.votes, 0);
  check(votes === 4, '报表总票数=4（含 1 平局）', `votes=${votes}`);
  check(report.overall && typeof report.overall.tieRate === 'number', 'overall.tieRate 存在', `tieRate=${report.overall?.tieRate}`);

  console.log(fail.length ? `\n${fail.length} 项失败` : '\n全部通过');
  process.exit(fail.length ? 1 : 0);
}
main().catch((e) => {
  console.error('e2e 挂了:', e.message);
  process.exit(1);
});
