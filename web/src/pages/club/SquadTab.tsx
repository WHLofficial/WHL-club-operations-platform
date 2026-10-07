// 阵容组页签（v6.30.0 A 段：自 pages/ClubDetail.tsx 阵容组搬入，访客与自家都可见）。
// 名单查询（useClubRoster）住在本组件里：只有激活「阵容」页签才挂载、才发请求。
// v6.30.0 删减项③：位置分布不再逐个档位列「档内细位」明细，四档收成一行文字；「总身价」格保留（用户明令）。
// v6.30.0 C 段：名单重定列集（11 固定列 + 可选列 +「列」开关）。
// v6.37.0 卡片化：名单表整表重构为「位置四组容器 + 行解剖卡」（桌面与窄屏同构、DOM 互斥）——
//   桌面 = 无 chips、四视图全列合并（13 指标）+「列…」自选长尾；窄屏（≤760px）= 四视图 chips 快切；
//   行 = 号码 + 姓名 + 徽章（1+N 折叠）+ 副行（标记行首 + 主位置 +N 点展开 · UID），组件在 card-parts.tsx。
import { useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useClubRoster } from '../../lib/queries.ts';
import { CARD_VIEW_CELLS, DESKTOP_CELLS, groupRowsByPosition, type CardViewKey } from '../../lib/club-cards.ts';
import { CARD_EXTRA_ITEMS, SQUAD_COLS_KEY, parseCardExtras, toggleClubCol } from '../../lib/club-columns.tsx';
import MultiSelect from '../../components/MultiSelect.tsx';
import { useMediaQuery } from '../../lib/use-media.ts';
import type { ClubSquadStructure } from '../../lib/api.ts';
import { DetailLine, HeroStat, Histogram, ShareBar, money, num1 } from './parts.tsx';
import { CardGroup, SquadCard, VIEW_COL_WIDTH, VIEW_GRID_COLS, ViewChips, extraColDefs } from './card-parts.tsx';

export default function SquadTab({ clubId, squad }: { clubId: number; squad: ClubSquadStructure }) {
  const rosterQuery = useClubRoster(clubId);
  const roster = rosterQuery.data ?? null;
  const rosterRows = roster?.players ?? null;
  const rosterOverflow = roster !== null && roster.nextCursor !== null;

  // 长尾自选列进 URL（?cols=），链接可分享、刷新不丢；卡片内置的 8 列不在池子里（恒显）
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCols = parseCardExtras(searchParams.get(SQUAD_COLS_KEY));
  function writeCols(next: string[]) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next.length === 0) params.delete(SQUAD_COLS_KEY);
      else params.set(SQUAD_COLS_KEY, next.join(','));
      return params;
    });
  }
  const extraItems = CARD_EXTRA_ITEMS;
  const extras = extraColDefs(activeCols);

  // 窄屏四视图 chips 的当前视图；桌面无 chips（全列合并），这个状态闲置
  const narrow = useMediaQuery('(max-width: 760px)');
  const [view, setView] = useState<CardViewKey>('basic');
  const cells = narrow ? CARD_VIEW_CELLS[view] : DESKTOP_CELLS;

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
            <p className="club-position-line">{squad.byPosition.map((g) => `${g.label} ${g.count} 人`).join(' · ')}</p>
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
          {!narrow && rosterRows !== null && (
            <MultiSelect
              label="列…"
              items={extraItems}
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
            {narrow && (
              <ViewChips
                value={view}
                onChange={setView}
                extra={
                  <MultiSelect
                    label="列…"
                    items={extraItems}
                    selected={activeCols}
                    onToggle={(key) => writeCols(toggleClubCol(activeCols, key))}
                    onClear={() => writeCols([])}
                  />
                }
              />
            )}
            <div
              className="sqc-wrap"
              style={
                {
                  '--sqc-cw': narrow ? VIEW_COL_WIDTH[view] : undefined,
                  '--sqc-mcols': narrow ? VIEW_GRID_COLS[view] : undefined,
                } as CSSProperties
              }
            >
              {groupRowsByPosition(rosterRows).map((g) => (
                <CardGroup
                  key={g.key}
                  groupKey={g.key}
                  label={g.label}
                  count={g.rows.length}
                  cells={cells}
                  extras={extras}
                  wide={!narrow}
                >
                  {g.rows.map((p) => (
                    <SquadCard key={p.id} row={p} view={view} extras={extras} wide={!narrow} />
                  ))}
                </CardGroup>
              ))}
            </div>
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
