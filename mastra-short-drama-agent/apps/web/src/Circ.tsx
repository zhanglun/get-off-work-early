/** 圈码：签名元素——手绘椭圆圈住编号；cur 为进行中（金圈描线动画）。 */
export function Circ({ n, cur }: { n: string; cur?: boolean }): JSX.Element {
  return (
    <span className={cur ? 'circ cur' : 'circ'}>
      <svg viewBox="0 0 30 30" aria-hidden="true"><ellipse cx="15" cy="15" rx="13" ry="11" /></svg>
      <span>{n}</span>
    </span>
  );
}
