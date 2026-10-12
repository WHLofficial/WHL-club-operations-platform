// 球员页「比赛」页签的展示口径（v6.46.0）：均分六档、逐场流水两行文案、窄屏副行小字。
// 纯函数只做格式化 —— 数据口径（出场四源并集、黄牌剔除两黄变一红等）在 src/core/player-matches.ts。
import type { PlayerMatchesCompStat, PlayerMatchesItem } from './api.ts';

export type RatingTier = 1 | 2 | 3 | 4 | 5 | 6;

/** 均分档位（定稿六档，白字 + 分档底色）：≥8.50 / 8.00–8.49 / 7.50–7.99 / 7.00–7.49 / 6.00–6.99 / <6.00 */
export function ratingTier(rating: number): RatingTier {
  if (rating >= 8.5) return 1;
  if (rating >= 8) return 2;
  if (rating >= 7.5) return 3;
  if (rating >= 7) return 4;
  if (rating >= 6) return 5;
  return 6;
}

/** 均分文本：汇总表两位小数（定稿口径）、逐场流水一位小数；无评分一律「—」 */
export function ratingText(rating: number | null, digits: 1 | 2 = 2): string {
  return rating === null ? '—' : rating.toFixed(digits);
}

/** 流水第一行：MM-DD · 赛事 · 阶段 · 第 N 轮 · 主/客 vs 对手（缺哪段就少哪段） */
export function flowTitle(item: PlayerMatchesItem): string {
  const parts: string[] = [];
  if (item.date !== null) parts.push(item.date.slice(5));
  parts.push(item.stageLabel);
  if (item.side !== null && item.opponent !== null) {
    parts.push(`${item.side === 'home' ? '主' : '客'} vs ${item.opponent}`);
  }
  return parts.join(' · ');
}

/** 流水第二行：事件串；没有事件但属于缺阵的场次回落成「缺阵（伤病停赛名单）」 */
export function flowEvents(item: PlayerMatchesItem): string {
  if (item.events.length > 0) return item.events.join(' · ');
  return item.missed ? '缺阵（伤病停赛名单）' : '—';
}

/** 流水右侧比分；未确认比分给「—」 */
export function scoreText(item: PlayerMatchesItem): string {
  return item.scoreHome === null || item.scoreAway === null ? '—' : `${item.scoreHome} : ${item.scoreAway}`;
}

/** 窄屏被裁掉的那几列（9px 小字副行）挂在赛事名下：场上球员点失在前，门将扑救在前 */
export function narrowSubline(c: PlayerMatchesCompStat, isGk: boolean): string {
  const head = isGk ? `扑救 ${c.saves}` : `点失 ${c.penMiss}`;
  return [head, `乌龙 ${c.ownGoal}`, `伤退 ${c.injuryOut}`, `缺阵 ${c.missed}`].join(' · ');
}

/** 汇总表列（去掉前三列固定列后的计数列）；窄屏只保留前四项，被裁的交给 narrowSubline */
export function statColumns(isGk: boolean): { label: string; key: keyof PlayerMatchesCompStat }[] {
  return isGk
    ? [
        { label: '零封', key: 'cleanSheets' },
        { label: '失球', key: 'conceded' },
        { label: '黄牌', key: 'yellow' },
        { label: '红牌', key: 'red' },
        { label: '扑救', key: 'saves' },
        { label: '乌龙', key: 'ownGoal' },
        { label: '伤退', key: 'injuryOut' },
        { label: '缺阵', key: 'missed' },
      ]
    : [
        { label: '进球', key: 'goals' },
        { label: '助攻', key: 'assists' },
        { label: '黄牌', key: 'yellow' },
        { label: '红牌', key: 'red' },
        { label: '点球未进', key: 'penMiss' },
        { label: '乌龙', key: 'ownGoal' },
        { label: '伤退', key: 'injuryOut' },
        { label: '缺阵', key: 'missed' },
      ];
}

/** 窄屏保留的计数列数（点球未进/乌龙/伤退/缺阵 与门将的 扑救/乌龙/伤退/缺阵 都并进副行） */
export const NARROW_STAT_COLUMNS = 4;
