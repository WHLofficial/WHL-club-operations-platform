// 运营时刻表甘特图（v6.49.0）：手绘静态 SVG，不引图表库（与 AttrRadar / PositionHeatmap 同范式）。
// 只读可视化：时间轴 + 每行区间条 + 窗口背景带 + 当前时刻线；悬停出 <title>（具体时间），点击行回调跳到编辑表单。
// 几何全在 lib/gantt.ts（纯函数、可单测）；刻度文案一律走 useTimeFmt()（切时区偏好即同步）。
import { useTimeFmt, zoneOffsetMs } from '../lib/datetime.ts';
import { ganttRange, minorStepOf, nowFrac, pickTickStep, rowBar, ticksIn, type GanttRange } from '../lib/gantt.ts';
import type { OpsStatusRow } from '../lib/api.ts';

const W = 1000; // viewBox 定宽：外层 .gantt-scroll 横滑（窄屏不挤压行名）
const LABEL_W = 172;
const PLOT_L = LABEL_W;
const PLOT_R = W - 6;
const PLOT_W = PLOT_R - PLOT_L;
const HEAD_H = 24;
const TOP = HEAD_H + 6;
const ROW_H = 30;
const GROUP_H = 18;
const BAR_H = 14;
const BOTTOM = 12;

export interface GanttChartProps {
  rows: readonly OpsStatusRow[];
  window: { openedAt: string; closedAt: string | null } | null;
  now: string;
  selectedKey?: string | null;
  onPick?: (key: string) => void;
}

/** 条上的状态类（沿用既有状态色：进行中=sky、未开始=gold、已结束=silver） */
function barClass(row: OpsStatusRow): string {
  if (row.state === 'open') return 'gantt-bar gantt-bar-open';
  if (row.state === 'not_started') return 'gantt-bar gantt-bar-pending';
  return 'gantt-bar gantt-bar-closed';
}

export default function GanttChart({ rows, window: win, now, selectedKey, onPick }: GanttChartProps) {
  const fmt = useTimeFmt();
  const nowMs = Date.parse(now);
  const nowAt = Number.isFinite(nowMs) ? nowMs : Date.now();
  const range: GanttRange = ganttRange({
    now: nowAt,
    windowOpenedAt: win?.openedAt ?? null,
    rows: rows.map((r) => ({ resolvedStartAt: r.resolvedStartAt, resolvedEndAt: r.resolvedEndAt })),
  });
  const offset = zoneOffsetMs(range.from);
  const step = pickTickStep(range.to - range.from);
  const majors = ticksIn(range.from, range.to, step.stepMs, offset);
  const minorStep = minorStepOf(step);
  const minors = minorStep ? ticksIn(range.from, range.to, minorStep, offset).filter((t) => !majors.includes(t)) : [];
  const x = (frac: number) => PLOT_L + frac * PLOT_W;
  const nowX = x(nowFrac(range, nowAt));

  // 行布局：组标题 + 行（组切换处插一条标题）
  const layout: Array<{ kind: 'group'; group: string; y: number } | { kind: 'row'; row: OpsStatusRow; y: number }> = [];
  let y = TOP;
  let prevGroup = '';
  for (const row of rows) {
    if (row.group !== prevGroup) {
      layout.push({ kind: 'group', group: row.group, y });
      y += GROUP_H;
      prevGroup = row.group;
    }
    layout.push({ kind: 'row', row, y });
    y += ROW_H;
  }
  const height = y + BOTTOM;

  return (
    <div className="gantt-scroll">
      <svg className="gantt-svg" viewBox={`0 0 ${W} ${height}`} role="img" aria-label="运营时刻表甘特图" style={{ height: `${height}px` }}>
        <defs>
          <pattern id="gantt-hatch-none" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" className="gantt-hatch-line" />
          </pattern>
          <pattern id="gantt-hatch-closed" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" className="gantt-hatch-line-closed" />
          </pattern>
        </defs>

        {/* 窗口背景带：openedAt → 右缘（关窗时刻未知，用右缘虚线表示「关窗即止」） */}
        {win ? (
          <g className="gantt-window">
            <rect x={x(nowFrac(range, Date.parse(win.openedAt)))} y={TOP - 4} width={PLOT_R - x(nowFrac(range, Date.parse(win.openedAt)))} height={height - TOP + 4 - BOTTOM + 4} className="gantt-window-band" />
            <line x1={PLOT_R} y1={TOP - 4} x2={PLOT_R} y2={height - BOTTOM + 4} className="gantt-window-edge" />
            <text x={PLOT_R - 4} y={TOP - 8} className="gantt-window-label" textAnchor="end">
              窗口进行中
            </text>
          </g>
        ) : (
          <text x={PLOT_L} y={TOP - 8} className="gantt-window-label">
            当前没有开放窗口
          </text>
        )}

        {/* 刻度：主刻度带文案（time 档带时:分，day/week 档带日期），次刻度只画细线 */}
        <g className="gantt-ticks">
          {minors.map((t) => (
            <line key={`m${t}`} x1={x((t - range.from) / (range.to - range.from))} y1={TOP - 2} x2={x((t - range.from) / (range.to - range.from))} y2={height - BOTTOM} className="gantt-tick-minor" />
          ))}
          {majors.map((t) => (
            <g key={`M${t}`}>
              <line x1={x((t - range.from) / (range.to - range.from))} y1={TOP - 4} x2={x((t - range.from) / (range.to - range.from))} y2={height - BOTTOM} className="gantt-tick" />
              <text x={x((t - range.from) / (range.to - range.from))} y={TOP - 8} className="gantt-tick-label" textAnchor="middle">
                {step.kind === 'time' ? fmt.time(new Date(t).toISOString()) : fmt.date(new Date(t).toISOString())}
              </text>
            </g>
          ))}
        </g>

        {/* 行 */}
        {layout.map((item, i) =>
          item.kind === 'group' ? (
            <text key={`g${i}`} x={8} y={item.y + 12} className="gantt-group">
              {item.group}
            </text>
          ) : (
            <RowItem key={item.row.key} row={item.row} y={item.y} range={range} selected={selectedKey === item.row.key} onPick={onPick} x={x} />
          ),
        )}

        {/* 当前时刻线 */}
        <g className="gantt-now">
          <line x1={nowX} y1={TOP - 4} x2={nowX} y2={height - BOTTOM} className="gantt-now-line" />
          <text x={nowX} y={height - 1} className="gantt-now-label" textAnchor="middle">
            现在
          </text>
        </g>
      </svg>
    </div>
  );
}

function RowItem({
  row,
  y,
  range,
  selected,
  onPick,
  x,
}: {
  row: OpsStatusRow;
  y: number;
  range: GanttRange;
  selected: boolean;
  onPick?: (key: string) => void;
  x: (frac: number) => number;
}) {
  const fmt = useTimeFmt();
  const bar = rowBar(row, range);
  const cls = barClass(row);
  const span = `${row.resolvedStartAt ? fmt.dateTime(row.resolvedStartAt) : '不限起点'} → ${
    row.resolvedEndAt ? fmt.dateTime(row.resolvedEndAt) : row.endIsWindowClose ? '关窗即止' : row.endAnchor === 'none' ? '不限制' : '—'
  }`;
  const title = `${row.label}｜${row.stateLabel}｜${span}${row.note ? `｜备注：${row.note}` : ''}｜${row.desc}`;
  const barY = y + (ROW_H - BAR_H) / 2;
  const clickable = Boolean(onPick);
  return (
    <g
      className={`gantt-row${selected ? ' gantt-row-selected' : ''}${clickable ? ' gantt-row-clickable' : ''}`}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={title}
      onClick={clickable ? () => onPick?.(row.key) : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onPick?.(row.key);
              }
            }
          : undefined
      }
    >
      <title>{title}</title>
      <rect x={0} y={y} width={W} height={ROW_H} className="gantt-row-bg" />
      <text x={8} y={y + 19} className="gantt-row-label">
        {row.label}
      </text>
      <text x={LABEL_W - 10} y={y + 19} className="gantt-row-state" textAnchor="end">
        {row.stateLabel}
      </text>
      {bar.kind === 'bar' ? (
        <>
          <rect x={x(bar.left)} y={barY} width={Math.max(x(bar.right) - x(bar.left), 2)} height={BAR_H} rx={3} className={cls} />
          {bar.openEnded ? (
            <>
              <line x1={x(bar.right)} y1={y + ROW_H / 2} x2={PLOT_R - 2} y2={y + ROW_H / 2} className="gantt-open-end" />
              <text x={PLOT_R - 4} y={y + 12} className="gantt-open-label" textAnchor="end">
                {row.endIsWindowClose ? '关窗即止' : '不限制'}
              </text>
            </>
          ) : null}
        </>
      ) : (
        <>
          <rect
            x={PLOT_L}
            y={barY}
            width={PLOT_W}
            height={BAR_H}
            rx={3}
            className="gantt-band"
            fill={bar.kind === 'none' ? 'url(#gantt-hatch-none)' : 'url(#gantt-hatch-closed)'}
          />
          <text x={PLOT_L + 6} y={y + 19} className="gantt-band-label">
            {bar.kind === 'none' ? '不限制（始终可用）' : '随窗锚：当前没有开放窗口'}
          </text>
        </>
      )}
    </g>
  );
}
