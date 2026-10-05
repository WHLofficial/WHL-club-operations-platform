// 六维雷达（静态 SVG，无动画）：组值=组内平均，归一到 99。
// v6.2.0 起压进属性页签头部右格：232×156 光图（无卡框、无文字 legend），轴标签 = 三字母简称 + 数值
// v6.34.0 球员对比：自 pages/Player.tsx 提取为共享件（详情页与后续对比页共用）。
// props / 尺寸 / 颜色 / 轴标 / 网格 / 多边形规则逐字保持，行为零变化；
// 内部 99 归一（min(max(value,0),99)/99）与 lib/radar.ts 的 axisValue 同一口径。
import { attrClass } from '../lib/players-library.ts';

export function AttrRadar({ values }: { values: { key: string; value: number | null }[] }) {
  const cx = 116;
  const cy = 78;
  const R = 48;
  const n = values.length;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt = (i: number, r: number) => `${(cx + r * Math.cos(angle(i))).toFixed(2)},${(cy + r * Math.sin(angle(i))).toFixed(2)}`;
  const dataPts = values
    .map((v, i) => pt(i, (R * Math.min(Math.max(v.value ?? 0, 0), 99)) / 99))
    .join(' ');
  return (
    <svg className="attr-radar-svg" viewBox="0 0 232 156" role="img" aria-label="六维雷达">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} className="radar-grid" points={values.map((_, i) => pt(i, R * f)).join(' ')} />
      ))}
      {values.map((v, i) => {
        const x = cx + (R + 11) * Math.cos(angle(i));
        const y = cy + (R + 11) * Math.sin(angle(i));
        const anchor = Math.abs(Math.cos(angle(i))) < 0.3 ? 'middle' : Math.cos(angle(i)) > 0 ? 'start' : 'end';
        return (
          <g key={v.key}>
            <line className="radar-axis" x1={cx} y1={cy} x2={cx + R * Math.cos(angle(i))} y2={cy + R * Math.sin(angle(i))} />
            <text className="radar-label" x={x} y={y} textAnchor={anchor} dominantBaseline="middle">
              <tspan className="radar-axis-key">{v.key}</tspan>
              <tspan className={`radar-axis-val${v.value === null ? '' : ` ${attrClass(v.value)}`}`} dx="3">
                {v.value ?? '—'}
              </tspan>
            </text>
          </g>
        );
      })}
      {values.some((v) => (v.value ?? 0) > 0) && <polygon className="radar-data" points={dataPts} />}
    </svg>
  );
}
