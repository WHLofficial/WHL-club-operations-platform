// 工资帽投影条（v6.54.0 步骤 7 自 DeskTab 提出，步骤 8 起超帽确认弹窗共用同一份）。
// 口径见设计 §10.5「cap bar 横轴（动态放大）」：
//   axisMin = max(0, min(current, projected) − 2)、axisMax = max(帽, current, projected) + 2；
//   不固定从 0 起（否则 66 vs 68 的差值在整条上几乎看不见），也不在 UI 标起点。
// 实线=current（金）、斜纹=待生效段（到 projected）、超帽段=红、帽线=4px 红 + 线左侧标签。
// 组件自带 aria-label，所以两处（工作台 / 弹窗）都不需要再包一层说明。
import { fmt2 } from '../../lib/contract-view.ts';

export function CapBar({
  current,
  projected,
  cap,
  title,
  baseline = null,
}: {
  current: number;
  projected: number;
  cap: number;
  title: string;
  /** 窗开瞬间的工资（v6.69.0 期二）。null = 本窗没有基线行，退成两段，不拿 0 冒充窗初。 */
  baseline?: number | null;
}) {
  const known = baseline === null ? [current, projected] : [baseline, current, projected];
  const axisMin = Math.max(0, Math.min(...known) - 2);
  const axisMax = Math.max(cap, ...known) + 2;
  const span = Math.max(0.01, axisMax - axisMin);
  const pct = (v: number) => Math.min(100, Math.max(0, ((v - axisMin) / span) * 100));
  const cur = pct(current);
  const proj = pct(projected);
  const capPos = pct(cap);
  const basePos = baseline === null ? null : pct(baseline);
  const over = projected > cap;
  const overspend = Math.max(0, Math.round((current - cap) * 100) / 100);
  const aria =
    baseline === null
      ? `当前工资 ${fmt2(current)}，待生效 ${fmt2(projected)}，工资帽 ${fmt2(cap)}`
      : `窗初 ${fmt2(baseline)}，当前 ${fmt2(current)}，待生效 ${fmt2(projected)}，工资帽 ${fmt2(cap)}`;
  return (
    <div
      className="cap-bar cap-bar-proj"
      role="img"
      aria-label={aria}
      title={title}
    >
      {basePos !== null && (
        <>
          {/* 窗初 → 现在：本窗的实际增量，深一档的金色；缩水时与现在段重叠也不出错 */}
          <span className="cap-seg cap-seg-delta" style={{ left: `${Math.min(basePos, cur)}%`, width: `${Math.abs(cur - basePos)}%` }} />
          <span className="cap-marker cap-marker-base" style={{ left: `${basePos}%` }} aria-hidden="true" />
          <span className="cap-flag cap-flag-base" style={{ left: `${basePos}%` }}>
            窗初 {fmt2(baseline as number)}
          </span>
        </>
      )}
      <span className="cap-seg cap-seg-current" style={{ left: 0, width: `${cur}%` }} />
      {proj > cur && <span className="cap-seg cap-seg-proj" style={{ left: `${cur}%`, width: `${proj - cur}%` }} />}
      {over && (
        <span className="cap-seg cap-seg-over" style={{ left: `${capPos}%`, width: `${Math.max(0, proj - capPos)}%` }} />
      )}
      <span className="cap-marker" style={{ left: `${capPos}%` }} aria-hidden="true" />
      <span className="cap-flag" style={{ left: `${capPos}%` }}>
        帽 {fmt2(cap)}
      </span>
      {overspend > 0 && <span className="cap-over-note">超 {fmt2(overspend)}m</span>}
    </div>
  );
}
