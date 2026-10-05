// 位置热区图（v6.35.0，spec docs/superpowers/specs/2026-10-05-player-heatmap-radar-ticks-design.md §1.1）：
// 12 块位置拓扑 + 主位/副位/未踢三态着色，纯展示（几何、清洗与三态映射都在 lib/heatmap.ts）。
// 语义 = 可踢位置分布（不是比赛跑动热图）；尺寸照视觉终稿屏：viewBox 245×200、渲染 147×120（与雷达等高）。
import { HEAT_GK_BAND, HEAT_SLOTS, HEAT_VIEW, heatPositionsOf, heatStateOf, heatToneClass } from '../lib/heatmap.ts';

export function PositionHeatmap({
  posCodes,
  isGk,
  className,
}: {
  posCodes: readonly string[];
  isGk: boolean;
  className?: string;
}) {
  const state = heatStateOf(posCodes, isGk);
  const positions = heatPositionsOf(posCodes);
  const [main, ...subs] = positions;
  const label = main
    ? `位置热区图（主位 ${main}${subs.length > 0 ? `，副位 ${subs.join('、')}` : ''}）`
    : '位置热区图（无位置数据）';

  return (
    <svg
      className={className ? `heat-svg ${className}` : 'heat-svg'}
      viewBox={`0 0 ${HEAT_VIEW.w} ${HEAT_VIEW.h}`}
      role="img"
      aria-label={label}
    >
      <rect className="heat-pitch" x="0" y="0" width={HEAT_VIEW.w} height={HEAT_VIEW.h} rx="8" />
      <polygon className="heat-band" points={HEAT_GK_BAND} />
      {HEAT_SLOTS.map((slot) => {
        const tone = heatToneClass(state[slot.code]);
        return (
          <g key={slot.code}>
            <rect
              className={`heat-block ${tone}`}
              x={slot.x}
              y={slot.y}
              width={slot.w}
              height={slot.h}
              rx="7"
            />
            <text className={`heat-code ${tone}`} x={slot.labelX} y={slot.labelY} textAnchor="middle">
              {slot.code}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
