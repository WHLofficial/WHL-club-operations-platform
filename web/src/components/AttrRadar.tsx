// 六维雷达（静态 SVG，无动画）：组值 = 组内平均，归一到 99（min(max(v,0),99)/99，与 lib/radar.ts axisValue 同口径）。
// v0.7.1 d11 出生 → v6.2.0 压进属性页签头部右格 → v6.34.0 提取共享件 → v6.35.0 泛化为四变体共享件：
//   head  232×156（渲染 178×120，与热区图 147×120 等高并排）：五档环带 + 轴名 + 数值套档色
//   big   170×176（2 人叠图，最多 3 条本命色序列）/ small 120×104（3 人并排）/ mini 120×104（吸顶条，无文字无点）
// 环带（spec §1.2）：五档边界 99/80/70/60/50 六边形内叠，tier = 档色、neutral = 中性纸灰（对比页叠色下不糊）；
// 数据多边形 = 虚线边 + 白点顶点；类名统一 radar-*（绘制类，布局宽度由调用方类名给）。
import { attrClass } from '../lib/players-library.ts';
import { bandFrac, groupAverage, RADAR_BAND_BOUNDS, tierColorOf, type RadarAxis } from '../lib/radar.ts';

export type RadarVariant = 'head' | 'big' | 'small' | 'mini';

export interface RadarSeries {
  // 本命色（对比页多序列）：给了就内联到多边形描边/填充与顶点描边，不给走 CSS 默认（详情页单序列）
  color?: string;
  // 二选一：attrs 走 groupAverage 现算组均值（详情页），values 直接给各轴原值 0..99（null = 无数据）
  attrs?: Record<string, unknown>;
  values?: readonly (number | null)[];
}

const RADAR_GEOM: Record<RadarVariant, { w: number; h: number; cx: number; cy: number; r: number; gap: number; dot: number }> = {
  head: { w: 232, h: 156, cx: 116, cy: 78, r: 48, gap: 11, dot: 3.2 },
  big: { w: 170, h: 176, cx: 85, cy: 88, r: 62, gap: 10, dot: 2.6 },
  small: { w: 120, h: 104, cx: 60, cy: 52, r: 40, gap: 10, dot: 2.2 },
  mini: { w: 120, h: 104, cx: 60, cy: 52, r: 40, gap: 10, dot: 0 },
};

export function AttrRadar({
  axes,
  series,
  variant,
  bands = 'tier',
  className,
  ariaLabel,
  ariaHidden,
}: {
  axes: readonly RadarAxis[];
  series: readonly RadarSeries[];
  variant: RadarVariant;
  bands?: 'tier' | 'neutral';
  className?: string;
  ariaLabel?: string;
  ariaHidden?: boolean;
}) {
  const g = RADAR_GEOM[variant];
  const n = axes.length;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt = (i: number, r: number) =>
    `${(g.cx + r * Math.cos(angle(i))).toFixed(2)},${(g.cy + r * Math.sin(angle(i))).toFixed(2)}`;
  const ringPoints = (frac: number) => axes.map((_, i) => pt(i, g.r * frac)).join(' ');
  const rawOf = (s: RadarSeries) => s.values ?? axes.map((a) => groupAverage(a.keys, s.attrs ?? {}));
  const norm = (v: number | null) => bandFrac(v ?? 0);
  const withData = series.map((s) => ({ s, raw: rawOf(s) })).filter(({ raw }) => raw.some((v) => (v ?? 0) > 0));
  const showKeys = variant !== 'mini';
  const showValues = variant === 'head';

  return (
    <svg
      className={[`radar-svg radar-svg-${variant}`, className].filter(Boolean).join(' ')}
      viewBox={`0 0 ${g.w} ${g.h}`}
      role={ariaHidden ? undefined : 'img'}
      aria-label={ariaHidden ? undefined : ariaLabel}
      aria-hidden={ariaHidden ? 'true' : undefined}
    >
      {RADAR_BAND_BOUNDS.map((b) => (
        <polygon
          key={b}
          className={bands === 'tier' ? 'radar-band' : 'radar-band radar-band-neutral'}
          points={ringPoints(bandFrac(b))}
          style={bands === 'tier' ? { fill: tierColorOf(b), stroke: tierColorOf(b) } : undefined}
        />
      ))}
      {axes.map((axis, i) => (
        <line
          key={axis.key}
          className="radar-axis"
          x1={g.cx}
          y1={g.cy}
          x2={g.cx + g.r * Math.cos(angle(i))}
          y2={g.cy + g.r * Math.sin(angle(i))}
        />
      ))}
      {withData.map(({ s, raw }, si) => (
        <g key={si}>
          <polygon
            className="radar-data"
            points={raw.map((v, i) => pt(i, g.r * norm(v))).join(' ')}
            style={s.color ? { stroke: s.color, fill: s.color } : undefined}
          />
          {g.dot > 0 &&
            raw.map((v, i) => (
              <circle
                key={i}
                className="radar-dot"
                cx={(g.cx + g.r * norm(v) * Math.cos(angle(i))).toFixed(2)}
                cy={(g.cy + g.r * norm(v) * Math.sin(angle(i))).toFixed(2)}
                r={g.dot}
                style={s.color ? { stroke: s.color } : undefined}
              />
            ))}
        </g>
      ))}
      {showKeys &&
        axes.map((axis, i) => {
          const x = (g.cx + (g.r + g.gap) * Math.cos(angle(i))).toFixed(2);
          const y = (g.cy + (g.r + g.gap) * Math.sin(angle(i))).toFixed(2);
          const anchor = Math.abs(Math.cos(angle(i))) < 0.3 ? 'middle' : Math.cos(angle(i)) > 0 ? 'start' : 'end';
          const raw = series[0] ? rawOf(series[0])[i] : null;
          return (
            <text key={axis.key} className="radar-label" x={x} y={y} textAnchor={anchor} dominantBaseline="middle">
              <tspan className="radar-axis-key">{axis.key}</tspan>
              {showValues && (
                <tspan className={`radar-axis-val${raw === null ? '' : ` ${attrClass(raw)}`}`} dx="3">
                  {raw ?? '—'}
                </tspan>
              )}
            </text>
          );
        })}
    </svg>
  );
}
