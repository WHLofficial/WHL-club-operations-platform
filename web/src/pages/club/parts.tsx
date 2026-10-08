// 球队详情页的展示小件（v6.30.0 A 段：自 pages/ClubDetail.tsx 原样搬出，供各页签组件复用）。
// 结构分析图全部 CSS 自绘（不引图表库）。三张图各用各的坐标语义（v3.4.0 步骤 11a，用户裁决）：
//   位置分布 → 不用图示，纯文字档位
//   年龄结构 → 等宽 3 岁箱 ⇒ 竖直直方图（柱相邻、面积=人数）
//   CA 结构  → 语义档不等宽（70–79 宽 10、80–84 宽 5）⇒ 一根水平柱按占比切段（100% 堆叠条）
//   效力年限 → 普通升序横向柱状图（BandChart）
// 三张图都只用百分比给尺寸，所以窄屏压容器不会把图形挤出去。
// 语义一律用 <ul>/<li> 而不是 role="img"：role="img" 会把整棵子树当装饰，档位标签与人数就读不到了；
// 图形本身纯装饰（aria-hidden），数据由「标签 + 人数」两段文字承载。
import { Link } from 'react-router';
import type { ClubBand, ClubFormRow, ClubTransferRow } from '../../lib/api.ts';
import { TRANSFER_TYPE_LABEL } from '../../lib/ref.ts';
import { playerPath } from '../../lib/player-link.ts';

// 金额口径与球员库一致（身价/工资都以「m」为单位存储）；null = 没录过，显示「—」
export function money(x: number | null): string {
  return x === null ? '—' : `${x.toFixed(2)}m`;
}

export function num1(x: number | null): string {
  return x === null ? '—' : x.toFixed(1);
}

// 效力是 0.5 赛季的整数倍，直接按 1 位小数写；0 是「本窗刚签」而非缺值
export function seasons(x: number | null): string {
  return x === null ? '—' : `${x.toFixed(1)} 赛季`;
}

const FORM_LABEL: Record<'win' | 'draw' | 'loss', string> = { win: '胜', draw: '平', loss: '负' };
const FORM_BADGE: Record<'win' | 'draw' | 'loss', string> = { win: 'green', draw: 'gray', loss: 'red' };

export function BandChart({ bands, ariaLabel }: { bands: ClubBand[]; ariaLabel: string }) {
  const max = Math.max(1, ...bands.map((b) => b.count));
  return (
    <ul className="band-chart" aria-label={ariaLabel}>
      {bands.map((b) => (
        <li className="band-row" key={b.key}>
          <span className="band-label">{b.label}</span>
          <span className="band-track" aria-hidden="true">
            {/* 0 人不出条：.band-bar 有 min-width 2px（小值也要看得见），给 0 画 2px 会读成「有一点」 */}
            {b.count > 0 && <span className="band-bar" style={{ width: `${(b.count / max) * 100}%` }} />}
          </span>
          <span className="band-count mono">{b.count}</span>
        </li>
      ))}
    </ul>
  );
}

// 竖直直方图（年龄）：柱高 = 人数 / 最高档人数，人数标在柱顶（所以不画 y 轴）。
// 柱与柱之间不留缝——直方图的柱是相邻的箱，留缝就变成柱状图了；六个轨道底色相连，读成一块底板。
// 0 人的档不出柱（不设 min-height：给 0 画 2px 会假装有 1 人），柱顶的「0」才是事实。
export function Histogram({ bins, ariaLabel }: { bins: ClubBand[]; ariaLabel: string }) {
  const max = Math.max(1, ...bins.map((b) => b.count));
  return (
    <ul className="club-histogram" aria-label={ariaLabel}>
      {bins.map((b) => (
        <li className="club-hist-col" key={b.key}>
          <span className="club-hist-count mono">{b.count}</span>
          <span className="club-hist-track" aria-hidden="true">
            <span className="club-hist-bar" style={{ height: `${(b.count / max) * 100}%` }} />
          </span>
          <span className="club-hist-label">{b.label}</span>
        </li>
      ))}
    </ul>
  );
}

// CA 结构：一根水平柱子按占比切段（100% 堆叠条），上方 0–100% 刻度轴，下方图例给档位与人数。
// 段序由高到低（后端 CA_BANDS 已是降序），段色是同一主色的深浅阶梯——越强的档越深，颜色只写在
// CSS 里，段本身只带一个透明度。分母用「全队人数」而不是「各档之和」：有人缺 CA 时柱子填不满
// 100%，这是实话（缺的人没进任何档），底板的米色把没填满的那截显出来。
const SHARE_TICKS = [0, 25, 50, 75, 100];
const SEG_ALPHA = [1, 0.82, 0.63, 0.44, 0.27];

export function ShareBar({ bands, total, ariaLabel }: { bands: ClubBand[]; total: number; ariaLabel: string }) {
  const denom = Math.max(1, total);
  const alphaOf = (i: number) => SEG_ALPHA[i] ?? 0.27;
  const pctOf = (count: number) => Math.round((count / denom) * 100);
  return (
    <div className="club-share">
      <div className="club-share-plot">
        <div className="club-share-axis" aria-hidden="true">
          {SHARE_TICKS.map((t) => (
            <span
              className={t === 0 || t === 100 ? 'club-share-tick' : 'club-share-tick club-share-tick-mid'}
              key={t}
              style={{ left: `${t}%` }}
            >
              {t}%
            </span>
          ))}
        </div>
        <div className="club-share-stack" aria-hidden="true">
          {bands.map((b, i) =>
            b.count === 0 ? null : (
              <span className="club-share-seg" key={b.key} style={{ width: `${(b.count / denom) * 100}%`, opacity: alphaOf(i) }} />
            ),
          )}
        </div>
      </div>
      <ul className="club-share-legend" aria-label={ariaLabel}>
        {bands.map((b, i) => (
          <li className="club-share-legend-row" key={b.key} title={`${b.label}：${b.count} 人 · 占全队 ${pctOf(b.count)}%`}>
            <span className="club-share-swatch" aria-hidden="true" style={{ opacity: alphaOf(i) }} />
            <span className="club-share-legend-label">{b.label}</span>
            <span className="club-share-legend-value mono">
              {b.count} 人 · {pctOf(b.count)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// 主指标：大号数字，三格铺满一行。
// 与下方明细同住一个 .club-summary（淡奶油底 + 左侧一道焦橙竖线），所以「大数字 + 小字」是一块东西，
// 不是两块（v3.4.0 步骤 11b 用户反馈：小字与上方过于割裂）。
export function HeroStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="club-hero-item">
      <dt>{label}</dt>
      <dd className="mono">
        {value}
        {hint !== undefined && <span className="club-hero-hint"> {hint}</span>}
      </dd>
    </div>
  );
}

// 明细行：按语义分组（能力/资产/荣誉…），组名 muted 加粗，组内用「·」分隔。
// 住在 .club-summary 里，与上面的大数字共用底色，所以不再画顶部分割线（那条线正是「割裂」的来源）。
export function DetailLine({ groups }: { groups: { label: string; text: string }[] }) {
  return (
    <p className="club-detail-line">
      {groups.map((g) => (
        <span key={g.label}>
          <b>{g.label}</b>
          {g.text}
        </span>
      ))}
    </p>
  );
}

export function TransferTable({ rows, empty, side }: { rows: ClubTransferRow[]; empty: string; side: 'in' | 'out' }) {
  if (rows.length === 0) {
    return <p className="muted club-sub-empty">{empty}</p>;
  }
  return (
    <div className="table-wrap">
      <table className="transfer-table">
        <thead>
          <tr>
            <th>完成时间</th>
            <th>类型</th>
            <th>球员</th>
            <th>{side === 'in' ? '来自' : '去向'}</th>
            <th>费用</th>
            <th>赛季</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td className="mono">{t.completedAt === null ? '—' : t.completedAt.slice(0, 10)}</td>
              <td>{TRANSFER_TYPE_LABEL[t.type] ?? t.type}</td>
              <td>
                {t.playerId === null ? (
                  t.playerName ?? '未知球员'
                ) : (
                  <Link to={playerPath({ id: t.playerId, fcId: t.playerFcId })}>{t.playerName ?? '未知球员'}</Link>
                )}
              </td>
              <td>
                {(() => {
                  const other = side === 'in' ? t.fromClubId : t.toClubId;
                  const name = side === 'in' ? t.fromClubName : t.toClubName;
                  if (other === null) return '自由身';
                  return <Link to={`/clubs/${other}`}>{name ?? '未知球队'}</Link>;
                })()}
              </td>
              <td className="num mono">
                {t.fee === null ? '—' : money(t.fee)}
                {t.extraFee !== null && t.extraFee > 0 ? ` +${t.extraFee.toFixed(2)}` : ''}
              </td>
              <td className="mono">
                {t.season === null ? '—' : `S${t.season}${t.windowSeq ? ` 第 ${t.windowSeq} 窗` : ''}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FormRow({ row }: { row: ClubFormRow }) {
  const result = row.result;
  return (
    <li className="form-row">
      <span className="mono form-date">{row.finishedAt === null ? '—' : row.finishedAt.slice(0, 10)}</span>
      <span className="form-stage muted">
        {row.competitionType ?? '赛事'} {row.stageName ?? ''} {row.round === null ? '' : `第 ${row.round} 轮`}
      </span>
      <span className="form-teams">
        {row.homeTeam ?? '—'} <span className="mono">{row.scoreHome ?? '-'}</span> :{' '}
        <span className="mono">{row.scoreAway ?? '-'}</span> {row.awayTeam ?? '—'}
      </span>
      <span className="form-tail">
        {row.penHome !== null && row.penAway !== null && (
          <span className="muted mono" title="点球大战比分（不改 90 分钟判定）">
            点球 {row.penHome}:{row.penAway}
          </span>
        )}
        {result === null ? (
          <span className="badge gray">未知</span>
        ) : (
          <span className={`badge ${FORM_BADGE[result]}`}>{FORM_LABEL[result]}</span>
        )}
      </span>
    </li>
  );
}
