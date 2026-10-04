// 阵容组页签（v6.30.0 A 段：自 pages/ClubDetail.tsx 阵容组搬入，访客与自家都可见）。
// 名单查询（useClubRoster）住在本组件里：只有激活「阵容」页签才挂载、才发请求。
// v6.30.0 删减项③：位置分布不再逐个档位列「档内细位」明细，四档收成一行文字；「总身价」格保留（用户明令）。
// v6.30.0 C 段：阵容名单重定列集 —— 11 固定列（标记/号码/UID/姓名/年龄/位置/CA/PA/违约金/工资/转会状态）
//   + 可选列（?cols=，默认全不显示）+ 转会状态手绘图标列（下方一行图例）+「列」开关。
//   旧表里的「状态」徽章列撤掉：转会状态图标把「挂牌中」这类信息收得更细（图例在表下解释）。
import { Link, useSearchParams } from 'react-router';
import { useClubRoster } from '../../lib/queries.ts';
import { MARKER_EMOJI, MARKER_LABEL } from '../../lib/players-library.ts';
import {
  CLUB_COL_ITEMS,
  SQUAD_COLS_KEY,
  SQUAD_FIXED_COLS,
  clubColDef,
  clubVisibleCols,
  renderClubCol,
  toggleClubCol,
  transferStatusOf,
} from '../../lib/club-columns.tsx';
import { TRANSFER_STATUS_GLOSSARY, TransferStatusCell, TransferStatusLegend } from '../../components/StatusIcons.tsx';
import MultiSelect from '../../components/MultiSelect.tsx';
import { playerPath } from '../../lib/player-link.ts';
import type { ClubSquadStructure } from '../../lib/api.ts';
import { DetailLine, HeroStat, Histogram, ShareBar, money, num1 } from './parts.tsx';

export default function SquadTab({ clubId, squad }: { clubId: number; squad: ClubSquadStructure }) {
  const rosterQuery = useClubRoster(clubId);
  const roster = rosterQuery.data ?? null;
  const rosterRows = roster?.players ?? null;
  const rosterOverflow = roster !== null && roster.nextCursor !== null;

  // 可选列进 URL（?cols=），链接可分享、刷新不丢；与本页其它参数（tab=）互不干扰
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCols = clubVisibleCols(searchParams.get(SQUAD_COLS_KEY));
  function writeCols(next: string[]) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next.length === 0) params.delete(SQUAD_COLS_KEY);
      else params.set(SQUAD_COLS_KEY, next.join(','));
      return params;
    });
  }

  return (
    <section className="card club-block">
      <div className="tier-head">
        <h3>阵容组</h3>
        <span className="muted">在册球员与结构分析</span>
      </div>
      <div className="club-summary">
        <dl className="club-hero">
          <HeroStat
            label="阵容人数"
            value={`${squad.senior} 人`}
            hint={squad.trainee > 0 ? `+ ${squad.trainee} 青训` : undefined}
          />
          <HeroStat label="平均 CA" value={num1(squad.avgCa)} />
          <HeroStat label="总身价" value={money(squad.totalValue)} />
        </dl>
        <DetailLine
          groups={[
            {
              label: '能力',
              text: `最高 CA ${num1(squad.maxCa)} · 平均 PA ${num1(squad.avgPa)} · 成长空间 ${num1(squad.avgGrowth)}`,
            },
            {
              label: '资产',
              text: `工资总额 ${money(squad.totalWage)} · 平均工资 ${squad.avgWage === null ? '—' : money(squad.avgWage)}`,
            },
            { label: '荣誉', text: `金徽章 ${squad.badgesGold} 枚 · 银徽章 ${squad.badgesSilver} 枚` },
          ]}
        />
      </div>

      {/* 三张图并排铺满卡片宽度（auto-fit：窄屏自己折行），不留右侧一大片空白 */}
      <div className="club-figures">
        <div className="club-sub">
          <h4>位置分布</h4>
          {squad.size === 0 ? (
            <p className="muted club-sub-empty">队里还没有人。</p>
          ) : (
            // 四档恒出（含 0 人档）：「0 门将」本身就是要看见的信号。四档收成一行文字（不列档内细位）。
            <p className="club-position-line">
              {squad.byPosition.map((g) => `${g.label} ${g.count} 人`).join(' · ')}
            </p>
          )}
        </div>

        <div className="club-sub">
          <h4>年龄结构</h4>
          <Histogram bins={squad.byAge} ariaLabel="年龄分布（等宽 3 岁分箱，柱高为该档人数）" />
        </div>

        <div className="club-sub">
          <h4>CA 结构</h4>
          <ShareBar bands={squad.byCa} total={squad.size} ariaLabel="CA 分档占全队比例" />
        </div>
      </div>

      <div className="club-sub">
        <div className="tier-head">
          <h4>阵容名单</h4>
          {rosterRows !== null && (
            <MultiSelect
              label="列"
              items={CLUB_COL_ITEMS}
              selected={activeCols}
              onToggle={(key) => writeCols(toggleClubCol(activeCols, key))}
              onClear={() => writeCols([])}
            />
          )}
        </div>
        {rosterRows === null ? (
          rosterQuery.isError ? (
            <p className="muted club-sub-empty">
              名单没拉下来（{rosterQuery.error instanceof Error ? rosterQuery.error.message : '未知错误'}），
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void rosterQuery.refetch()}>
                重试
              </button>
            </p>
          ) : (
            <p className="muted club-sub-empty">正在点名…</p>
          )
        ) : rosterRows.length === 0 ? (
          <p className="muted club-sub-empty">队里还没有人。</p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table-sticky-2">
                <thead>
                  <tr>
                    {SQUAD_FIXED_COLS.map((col) => (
                      <th
                        key={col.key}
                        className={col.num ? 'num' : undefined}
                        title={col.key === 'transferStatus' ? TRANSFER_STATUS_GLOSSARY : undefined}
                      >
                        {col.label}
                      </th>
                    ))}
                    {activeCols.map((key) => {
                      const def = clubColDef(key);
                      return (
                        <th key={key} className={def.num ? 'num' : undefined}>
                          {def.label}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rosterRows.map((p) => (
                    <tr key={p.id}>
                      <td className="marker-cell" title={p.marker ? MARKER_LABEL[p.marker] : undefined}>
                        {p.marker ? MARKER_EMOJI[p.marker] : ''}
                      </td>
                      <td className="mono">{p.number ?? '—'}</td>
                      <td className="mono">{p.uid.replace(/^fc/, '')}</td>
                      <td>
                        <Link to={playerPath(p)}>{p.name}</Link>
                      </td>
                      <td className="num mono">{p.age ?? '—'}</td>
                      <td className="mono">{p.positions.length > 0 ? p.positions.join(' ') : '—'}</td>
                      <td className="num mono">{p.ca}</td>
                      <td className="num mono">{p.pa}</td>
                      <td className="num mono">{p.releaseFee === null ? '—' : money(p.releaseFee)}</td>
                      <td className="num mono">{p.wage === null ? '—' : money(p.wage)}</td>
                      <td>
                        <TransferStatusCell status={transferStatusOf(p)} />
                      </td>
                      {activeCols.map((key) => renderClubCol(key, p))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TransferStatusLegend />
            {rosterOverflow && (
              <p className="muted club-sub-empty">
                名单过长，这里只显示前 {rosterRows.length} 人 ——{' '}
                <Link to={`/players?club_id=${clubId}`}>去球员库看全部</Link>
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
