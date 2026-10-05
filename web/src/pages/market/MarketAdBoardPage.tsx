// 转会市场 · 广告板 /market/board（v6.31.0）：把各队挂出的「转会名单」公开铺开。
// 着重度（0 普通 / 1 推荐 / 2 置顶）是「列入转会名单时的有偿选项」的展示接口——本版只读，不写 player_promotions。
// 置顶区（emphasis = 2）通栏纵向堆叠，无置顶时整条带子连标题一起消失；其余（0/1）进卡栅格。
// 顺序：端点按时间桶（5 分钟一桶）轮换 emphasis = 0 那一段，付费档（1/2）恒按着重度 → 挂出时间；
// 「换一批」按钮是纯前端本地重排（不打端点，只动普通档）。
// 时间一律走 useTimeFmt（卡脚「挂出 …」），页面不自己算相对时间（守 tests/datetime-display.test.ts）。
import { useState } from 'react';
import { Link } from 'react-router';
import type { TransferBoardRow } from '../../lib/api.ts';
import { TeamLogo } from '../../components/TeamLogo.tsx';
import { ShuffleIcon, TransferStatusCell, TransferStatusLegend } from '../../components/StatusIcons.tsx';
import { transferStatusOf } from '../../lib/club-columns.tsx';
import { useTimeFmt } from '../../lib/datetime.ts';
import { playerPath } from '../../lib/player-link.ts';
import { attrClass } from '../../lib/players-library.ts';
import { useTransferBoard } from '../../lib/queries.ts';
import { MarketNav, money } from './shared.tsx';

// 金额统一「180.00 m」（单位字母照市场分区既有口径：在售市场卡 / 球员页都用小写 m）；无值回「—」，不拼出「— m」
function amount(v: number | null | undefined): string {
  return v == null ? '—' : `${money(v)} m`;
}

// 副标题：位置 · 年龄 · 球队（位置沿用球员库的「空格分隔」口径）
function subline(row: TransferBoardRow): string {
  const pos = row.positions.length > 0 ? row.positions.join(' ') : '—';
  return `${pos} · ${row.age ?? '—'} 岁 · ${row.clubName}`;
}

// 着重度角标：1 推荐（橙）/ 2 置顶（金）/ 0 普通（无角标）
function EmphasisBadge({ emphasis }: { emphasis: TransferBoardRow['emphasis'] }) {
  if (emphasis === 1) return <span className="badge orange">推荐</span>;
  if (emphasis === 2) return <span className="badge gold">置顶</span>;
  return null;
}

// 状态图标：行里没有 transferListed 字段（广告板只收名单内球员）⇒ 固定补 true
function statusOf(row: TransferBoardRow) {
  return transferStatusOf({ ...row, transferListed: true });
}

// CA / PA 大数字（沿用既有 .attr-* 色阶）
function Rail({ row }: { row: TransferBoardRow }) {
  return (
    <div className="adb-rail">
      <div className="adb-rail-cell">
        <span className="adb-rail-lab">CA</span>
        <span className={`adb-rail-num ${attrClass(row.ca)}`}>{row.ca}</span>
      </div>
      <div className="adb-rail-cell">
        <span className="adb-rail-lab">PA</span>
        <span className={`adb-rail-num ${attrClass(row.pa)}`}>{row.pa}</span>
      </div>
    </div>
  );
}

// 最低报价 / 违约金（右对齐；最低报价走金）
function Amounts({ row }: { row: TransferBoardRow }) {
  return (
    <div className="adb-rows">
      <div className="adb-row">
        <span className="adb-labr">最低报价</span>
        <span className="adb-val adb-hi">{amount(row.minOfferPrice)}</span>
      </div>
      <div className="adb-row">
        <span className="adb-labr">违约金</span>
        <span className="adb-val">{amount(row.releaseFee)}</span>
      </div>
    </div>
  );
}

// 卡头右端：着重度角标 + 转会状态图标（两种卡共用）
function HeadBadges({ row }: { row: TransferBoardRow }) {
  return (
    <span className="badge-stack">
      <EmphasisBadge emphasis={row.emphasis} />
      <TransferStatusCell status={statusOf(row)} />
    </span>
  );
}

// 普通 / 推荐卡（栅格单元）
function BoardCard({ row }: { row: TransferBoardRow }) {
  const t = useTimeFmt();
  return (
    <article className={`adb-card${row.emphasis === 1 ? ' emph-1' : ''}`}>
      <div className="adb-card-head">
        {/* v6.32.0：左上角队徽接 R2 实图（无徽回哈希色块） */}
        <TeamLogo name={row.clubName} logoKey={row.logoKey} size={22} />
        <Link className="adb-nm" to={playerPath(row)}>
          {row.name}
        </Link>
        <HeadBadges row={row} />
      </div>
      <div className="adb-sub">{subline(row)}</div>
      <div className="adb-body">
        <Rail row={row} />
        <Amounts row={row} />
      </div>
      <div className="adb-card-foot">
        <span>挂出 {t.ago(row.listedAt)}</span>
      </div>
    </article>
  );
}

// 置顶通栏卡（队徽 40px + 名字 21px，内部横排）
function FeaturedCard({ row }: { row: TransferBoardRow }) {
  const t = useTimeFmt();
  return (
    <article className="adb-fcard emph-2">
      <TeamLogo name={row.clubName} logoKey={row.logoKey} size={40} />
      <div className="adb-fcard-txt">
        <div className="adb-card-head">
          <Link className="adb-nm" to={playerPath(row)}>
            {row.name}
          </Link>
          <HeadBadges row={row} />
        </div>
        <div className="adb-sub">{subline(row)}</div>
      </div>
      <div className="adb-body">
        <Rail row={row} />
        <Amounts row={row} />
      </div>
      <div className="adb-card-foot">
        <span>挂出 {t.ago(row.listedAt)}</span>
        {row.emphasisUntil ? <span className="adb-until">置顶到 {t.date(row.emphasisUntil)}</span> : null}
      </div>
    </article>
  );
}

// 迷你卡（在售市场页顶部小卡片用）：整张是球员链接，右上角图标只作状态标记
function MiniCard({ row }: { row: TransferBoardRow }) {
  const cls = `adb-mini${row.emphasis === 1 ? ' emph-1' : ''}${row.emphasis === 2 ? ' emph-2' : ''}`;
  return (
    <Link className={cls} to={playerPath(row)}>
      <span className="adb-mini-head">
        <span className="adb-mini-nm">{row.name}</span>
        <EmphasisBadge emphasis={row.emphasis} />
        <span className="adb-mini-st">
          <TransferStatusCell status={statusOf(row)} />
        </span>
      </span>
      <span className="adb-mini-sub">{subline(row)}</span>
      <span className="adb-mini-foot">
        <span className="adb-mini-nums">
          CA <b className={attrClass(row.ca)}>{row.ca}</b> PA <b className={attrClass(row.pa)}>{row.pa}</b>
        </span>
        <span className="adb-mini-price">{amount(row.minOfferPrice)}</span>
      </span>
    </Link>
  );
}

// 在售市场页顶部的广告板小卡片（v6.31.0）：无数据整块不渲染，不留空卡
export function AdBoardTeaser() {
  const { data } = useTransferBoard(3);
  const players = data?.players ?? [];
  if (players.length === 0) return null;
  const total = data?.total ?? players.length;
  return (
    <section className="card adb-teaser">
      <div className="adb-teaser-head">
        <h3>广告板</h3>
        <span className="badge gray">{total} 人在名单</span>
        <Link className="adb-teaser-more" to="/market/board">
          查看全部 {total} 人 →
        </Link>
      </div>
      <p className="adb-teaser-note">各队公开挂出的转会名单。</p>
      <div className="adb-teaser-cards">
        {players.map((row) => (
          <MiniCard key={row.id} row={row} />
        ))}
      </div>
    </section>
  );
}

// 手动「换一批」：本地重排 emphasis = 0 的行（付费档不动），并保证至少换出一个不同的顺序
// （连按两次不会出现「点了没反应」——洗回原序就再洗，兜底反转必定不同）
function reshuffle(rows: TransferBoardRow[]): TransferBoardRow[] {
  if (rows.length < 2) return rows;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const out = rows.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    if (out.some((row, i) => row.id !== rows[i].id)) return out;
  }
  return rows.slice().reverse();
}

export default function MarketAdBoardPage() {
  const { data, isLoading, error } = useTransferBoard(200);
  const players = data?.players ?? [];
  const total = data?.total ?? players.length;
  // 分流：emphasis = 2 进置顶带，1（推荐）与 0（普通）进栅格
  const featured = players.filter((row) => row.emphasis === 2);
  const paid = players.filter((row) => row.emphasis === 1);
  const unpinned = players.filter((row) => row.emphasis === 0);
  // 「换一批」的本地顺序只存 id 序列：名单一变（进出名单 / 重新拉取）就自动回落端点给的桶序
  const [manualIds, setManualIds] = useState<number[] | null>(null);
  const byId = new Map(unpinned.map((row) => [row.id, row]));
  const shownUnpinned =
    manualIds !== null && manualIds.length === unpinned.length && manualIds.every((id) => byId.has(id))
      ? manualIds.map((id) => byId.get(id)!)
      : unpinned;
  const rest = [...paid, ...shownUnpinned];
  return (
    <div className="container">
      <h1>转会市场 · 广告板</h1>
      <MarketNav />
      <div className="adb-note">
        <p>各队公开挂出的转会名单：标价公开，出价达线自动挂牌，低于自动拒。</p>
        {unpinned.length >= 2 && (
          <button
            type="button"
            className="adb-shuffle"
            onClick={() => setManualIds(reshuffle(shownUnpinned).map((row) => row.id))}
            title="打乱没有付费加权的球员顺序（推荐 / 置顶不动）"
          >
            <ShuffleIcon />
            换一批
          </button>
        )}
      </div>
      {error ? (
        <div className="banner warn">{error instanceof Error ? error.message : '广告板打不开了，稍后再试'}</div>
      ) : (
        <section className="card adb-panel">
          {isLoading ? (
            <p className="muted">正在翻广告板…</p>
          ) : players.length === 0 ? (
            <>
              <p className="adb-empty-t">现在没有球队挂出转会名单。</p>
              <p className="muted">球员被列入转会名单后就会出现在这里。</p>
            </>
          ) : (
            <>
              {featured.length > 0 && (
                <>
                  <p className="adb-band">
                    <span className="adb-band-lab">置顶</span>
                    <span className="adb-band-note">{featured.length} 个 · 付费位，按到期时间排</span>
                  </p>
                  <div className="adb-feature">
                    {featured.map((row) => (
                      <FeaturedCard key={row.id} row={row} />
                    ))}
                  </div>
                </>
              )}
              <div className="adb-grid">
                {rest.map((row) => (
                  <BoardCard key={row.id} row={row} />
                ))}
              </div>
              {total > players.length && (
                <p className="adb-trunc">
                  共 {total} 人在名单，这里展示前 {players.length} 人
                </p>
              )}
              <TransferStatusLegend />
            </>
          )}
        </section>
      )}
    </div>
  );
}
