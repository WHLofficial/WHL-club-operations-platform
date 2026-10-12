// 球员页右栏第 5 页签「比赛」（v6.46.0）：分赛季 · 分赛事汇总表 + 逐场流水。
// 数据口径在后端 src/core/player-matches.ts（出场四源并集、黄牌剔除两黄变一红等），
// 这里只负责排版：11 列（门将变体换三列）、斑马纹、六档均分徽章、窄屏裁列 + 副行小字。
import type { UseQueryResult } from '@tanstack/react-query';
import { Fragment } from 'react';
import type { PlayerMatchesCompStat, PlayerMatchesResponse, PlayerMatchesSeason } from '../../lib/api.ts';
import {
  NARROW_STAT_COLUMNS,
  flowEvents,
  flowTitle,
  narrowSubline,
  ratingText,
  ratingTier,
  scoreText,
  statColumns,
} from '../../lib/player-matches-view.ts';

const FOOTNOTES = [
  '出场* = 该场留下成长记录 / 赛事事件 / 赛前真实提交的首发名单，三者任一即计（伤病缺阵另计一列；弃权场不计）。',
  '均分 = 该赛事已录评分场次的平均（合计行是全部评分场次的加权平均）；评分自 v6.46.0 起录 0–10，历史场次不回溯，7.0 以下不给 XP。',
  '黄牌不含同场两黄变一红的那张；乌龙不计个人进球。',
];

/** 均分徽章（定稿六档：白字 + 分档底色）；没有评分给灰字「—」 */
function RatingBadge({ rating, digits = 2 }: { rating: number | null; digits?: 1 | 2 }) {
  if (rating === null) return <span className="rating-none">—</span>;
  return <span className={`rating-badge t${ratingTier(rating)}`}>{ratingText(rating, digits)}</span>;
}

function SummaryTable({ seasons, isGk, narrow }: { seasons: PlayerMatchesSeason[]; isGk: boolean; narrow: boolean }) {
  // 窄屏只留前四项计数列，其余并进赛事行下方的整行小字（点失/扑救 不丢）
  const cols = statColumns(isGk).slice(0, narrow ? NARROW_STAT_COLUMNS : undefined);
  const cellSpan = 3 + cols.length;
  return (
    // 窄屏每个赛事占两行，nth-child 斑马纹会错位 ⇒ 窄屏改用 .matches-alt 按赛事序号成对染色；
    // 再挂 -narrow 把字号与内边距收紧一档，7 列才挤得进 375px 视口的右栏（约 292px）
    <div className="table-wrap">
      <table className={narrow ? 'matches-table matches-table-narrow' : 'matches-table zebra'}>
        <thead>
          <tr>
            <th>赛事</th>
            <th className="num">出场*</th>
            <th className="num">均分</th>
            {cols.map((c) => (
              <th key={c.key} className="num">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {seasons.map((s) => (
            // 多赛季：每个赛季先出一行分组头（定稿稿只有单赛季，没画这一行；赛季倒序由后端给）
            <SeasonRows key={s.season} season={s} cols={cols} cellSpan={cellSpan} isGk={isGk} narrow={narrow} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SeasonRows({
  season,
  cols,
  cellSpan,
  isGk,
  narrow,
}: {
  season: PlayerMatchesSeason;
  cols: { label: string; key: keyof PlayerMatchesCompStat }[];
  cellSpan: number;
  isGk: boolean;
  narrow: boolean;
}) {
  const row = (c: PlayerMatchesCompStat, sum: boolean, alt = false) => {
    const key = sum ? 'sum' : `${c.competitionType}|${c.tournamentId ?? ''}`;
    // 窄屏同一赛事的第二行（副行小字）要跟着数据行一起染色，所以用 Fragment 包住两行。
    // 副行整行铺开（colSpan）而不是塞进「赛事」格：不然 9px 小字会把首列撑到 144px，
    // 375px 视口下 7 列表格要横向滚 132px 才看得全。
    return (
      <Fragment key={key}>
        <tr className={[sum ? 'matches-sum' : '', alt ? 'matches-alt' : ''].filter(Boolean).join(' ') || undefined}>
          <td title={c.tournamentName ?? undefined}>{c.competitionName}</td>
          <td className="num">{c.appearances}</td>
          <td className="num">
            <RatingBadge rating={c.avgRating} />
          </td>
          {cols.map((col) => (
            <td key={col.key} className="num">
              {c[col.key]}
            </td>
          ))}
        </tr>
        {narrow && !sum && (
          <tr className={['matches-subrow', alt ? 'matches-alt' : ''].filter(Boolean).join(' ')}>
            <td colSpan={cellSpan}>
              <span className="matches-sub">{narrowSubline(c, isGk)}</span>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };
  return (
    <>
      <tr className="matches-season">
        <td colSpan={cellSpan}>S{season.season}</td>
      </tr>
      {season.comps.map((c, i) => row(c, false, i % 2 === 1))}
      {row(season.total, true)}
    </>
  );
}

function MatchList({ matches }: { matches: PlayerMatchesResponse['matches'] }) {
  return (
    <div className="matches-flow">
      {matches.map((m) => (
        <div className="matches-row" key={m.matchId}>
          <span className="matches-row-title">{flowTitle(m)}</span>
          <span className="matches-row-score">{scoreText(m)}</span>
          <span className="matches-row-events">{flowEvents(m)}</span>
          <span className="matches-row-rating">
            <RatingBadge rating={m.rating} digits={1} />
          </span>
        </div>
      ))}
    </div>
  );
}

export function MatchesTab({
  query,
  isGk,
  narrow,
}: {
  query: UseQueryResult<PlayerMatchesResponse, Error>;
  isGk: boolean;
  narrow: boolean;
}) {
  const seasons = query.data?.seasons ?? [];
  const matches = query.data?.matches ?? [];
  return (
    <>
      <h3>比赛记录</h3>
      {query.isError ? (
        <div className="banner bad">{query.error?.message ?? '比赛记录拉取失败'}</div>
      ) : query.isPending ? (
        <p className="muted">正在翻查比赛记录…</p>
      ) : matches.length === 0 ? (
        <div className="empty-state">
          <p className="muted">还没有比赛记录。确认赛果、或在成长录入台录出场与评分之后，这里会有记录。</p>
        </div>
      ) : (
        <>
          {seasons.length > 0 && <SummaryTable seasons={seasons} isGk={isGk} narrow={narrow} />}
          <h4 className="matches-h4">逐场流水</h4>
          <MatchList matches={matches} />
          <div className="matches-foot">
            {FOOTNOTES.map((t) => (
              <p key={t} className="muted">
                {t}
              </p>
            ))}
          </div>
        </>
      )}
    </>
  );
}
