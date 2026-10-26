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
}: {
  current: number;
  projected: number;
  cap: number;
  title: string;
}) {
  const axisMin = Math.max(0, Math.min(current, projected) - 2);
  const axisMax = Math.max(cap, current, projected) + 2;
  const span = Math.max(0.01, axisMax - axisMin);
  const pct = (v: number) => Math.min(100, Math.max(0, ((v - axisMin) / span) * 100));
  const cur = pct(current);
  const proj = pct(projected);
  const capPos = pct(cap);
  const over = projected > cap;
  return (
    <div
      className="cap-bar cap-bar-proj"
      role="img"
      aria-label={`当前工资 ${fmt2(current)}，待生效 ${fmt2(projected)}，工资帽 ${fmt2(cap)}`}
      title={title}
    >
      <span className="cap-seg cap-seg-current" style={{ left: 0, width: `${cur}%` }} />
      {proj > cur && <span className="cap-seg cap-seg-proj" style={{ left: `${cur}%`, width: `${proj - cur}%` }} />}
      {over && (
        <span className="cap-seg cap-seg-over" style={{ left: `${capPos}%`, width: `${Math.max(0, proj - capPos)}%` }} />
      )}
      <span className="cap-marker" style={{ left: `${capPos}%` }} aria-hidden="true" />
      <span className="cap-flag" style={{ left: `${capPos}%` }}>
        帽 {fmt2(cap)}
      </span>
    </div>
  );
}
