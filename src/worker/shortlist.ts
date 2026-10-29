// 候选名单跟踪提醒（v6.58.0，设计 §B）：球员被挂牌 / 被签走 / 解约变自由身时，
// 给把他挂进候选名单的**其他**俱乐部各发一条站内信。
//
// 「被签走」的写点清单（全仓查证，2026-10-29）：
//   ① 市场竞价成交（market-settle 惰性结算 → transfers.completeTransfer）
//   ② 报价同意 acceptOffer（offers → 挂牌成交 → completeTransfer）
//   ③ 直接转会 / 签约谈判（negotiations → completeTransfer）
//   ④ 海捞（sea_sealed_bids → 过户 → completeTransfer）
//   ⑤ 管理旁路 bypass（→ completeTransfer）
//   —— 以上五条全部收敛在 transfers.ts 的 completeTransfer（players.club_id 唯一变更点）；
//   解约变自由身在 completeTermination。批量导入 contracts-import 也改 club_id，但那是
//   数据导入不是交易，刻意不发通知。
//
// 排除规则（拍板 9）：事件操作方俱乐部 = 收藏者俱乐部时不发（自己挂牌 / 自己解约 / 自己买下）。
// 通知尽力而为：任何一步失败只返回 0，绝不阻塞交易主流程（§12-2）。
import type { Env } from './env.ts';
import { queueClubNotification } from './notify.ts';
import { rowDisplayName } from '../core/player-name.ts';
import { fmtBeijingMinute } from '../core/ops-schedule.ts';

export type ShortlistEvent =
  | {
      type: 'listed';
      /** 操作方 = 挂牌俱乐部（收藏者就是它时不发） */
      operatorClubId: number;
      /** 挂牌价（m） */
      price: number;
      /** 预计竞价截止（UTC ISO；调用方按 deadline_at ?? activation_deadline 取） */
      deadline: string | null;
    }
  | {
      type: 'sold';
      /** 操作方 = 买方俱乐部（收藏者就是买方时不发） */
      operatorClubId: number;
      /** 实际成交价（m；自由身签入可能为空） */
      fee: number | null;
    }
  | {
      type: 'released';
      /** 操作方 = 原俱乐部（收藏者就是它时不发） */
      operatorClubId: number;
    };

const TEMPLATE_OF: Record<ShortlistEvent['type'], string> = {
  listed: 'shortlist_listed',
  sold: 'shortlist_sold',
  released: 'shortlist_released',
};

export async function notifyShortlistWatchers(env: Env, playerId: number, event: ShortlistEvent): Promise<number> {
  try {
    const watchers = await env.DB
      .prepare('SELECT club_id FROM player_shortlist WHERE player_id = ? AND club_id != ? ORDER BY club_id')
      .bind(playerId, event.operatorClubId)
      .all<{ club_id: number }>();
    if (watchers.results.length === 0) return 0;
    const player = await env.DB
      .prepare('SELECT name, display_name FROM players WHERE id = ?')
      .bind(playerId)
      .first<{ name: string; display_name: string | null }>();
    if (!player) return 0;
    const playerName = rowDisplayName(player);
    const template = TEMPLATE_OF[event.type];
    const operator = await env.DB
      .prepare('SELECT name FROM clubs WHERE id = ?')
      .bind(event.operatorClubId)
      .first<{ name: string }>();
    const clubName = operator?.name ?? `俱乐部${event.operatorClubId}`;
    const data: Record<string, unknown> = { player: playerName, playerId, club: clubName };
    if (event.type === 'listed') {
      data.price = event.price;
      data.deadline = event.deadline ? fmtBeijingMinute(event.deadline) : '待定';
    } else if (event.type === 'sold') {
      data.buyer = clubName;
      data.fee = event.fee;
    }
    let queued = 0;
    for (const w of watchers.results) {
      queued += await queueClubNotification(env, w.club_id, template, data);
    }
    return queued;
  } catch {
    return 0;
  }
}
