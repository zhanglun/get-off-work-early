import type { SideOrder, WinnerResolved } from './types';

// 盲测归因（纯函数，独立可测）：
// 打分页只提交位置语义（A/B/tie + 双分），新旧归属由服务端按落库侧序换算。
// sideOrder === 'left:new' 表示 A 位是新提示词；'left:old' 表示 A 位是旧提示词。
export function resolveBlindScores(input: {
  winner: 'A' | 'B' | 'tie';
  scoreA: number;
  scoreB: number;
  sideOrder: SideOrder;
}): { winner: WinnerResolved; scoreNew: number; scoreOld: number } {
  const newIsA = input.sideOrder === 'left:new';
  return {
    winner:
      input.winner === 'tie' ? 'tie' : (input.winner === 'A') === newIsA ? 'new' : 'old',
    scoreNew: newIsA ? input.scoreA : input.scoreB,
    scoreOld: newIsA ? input.scoreB : input.scoreA,
  };
}
