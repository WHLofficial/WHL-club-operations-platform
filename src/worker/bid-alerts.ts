// 异常出价告警检测（增量 10，PRD 4.8「异常告警」）。
// 成交前人工审是既有流程（每单必审），这里只负责打标：结算时对出价历史跑三判据，
// 命中即把告警写进审核单 payload.alerts 并留 bid_pattern_alert 审计，成交照旧等管理组批。
// 判据刻意从宽（宁误报不漏报）：误报的成本是管理组在审核页多看一眼。
import { createConfigService } from '../core/config.ts';
import type { D1Database } from '@cloudflare/workers-types';

export interface BidAlert {
  kind: 'large_amount' | 'rapid_raise' | 'minimal_raise_pattern';
  text: string;
}

interface PatternConfig {
  windowMinutes: number;
  maxRaises: number;
  colludeRounds: number;
}

const PATTERN_DEFAULTS: PatternConfig = { windowMinutes: 30, maxRaises: 3, colludeRounds: 6 };

export async function detectBidAlerts(db: D1Database, listingId: number): Promise<BidAlert[]> {
  try {
    const config = createConfigService(db);
    const threshold = await config.getNumber('review_amount_threshold');
    const patternRaw = await config.get('bid_pattern_alert');
    const pattern = parsePattern(patternRaw);

    const { results: bids } = await db
      .prepare('SELECT club_id, amount, created_at FROM bids WHERE listing_id = ? ORDER BY id')
      .bind(listingId)
      .all<{ club_id: number; amount: number; created_at: string }>();
    if (bids.length === 0) return [];

    const alerts: BidAlert[] = [];
    const winnerAmount = Math.max(...bids.map((b) => b.amount));

    // 判据一：大额成交（阈值可配；未配置不判）
    if (threshold !== null && threshold > 0 && winnerAmount > threshold) {
      alerts.push({ kind: 'large_amount', text: `成交 ${winnerAmount}m 超过大额阈值 ${threshold}m` });
    }

    // 判据二：同队短窗连续抬价（窗内出价次数−1 ≥ maxRaises）
    const latest = bids[bids.length - 1]!.created_at;
    const windowStart = new Date(new Date(latest).getTime() - pattern.windowMinutes * 60_000);
    const raiseCount = new Map<number, number>();
    for (const b of bids) {
      if (new Date(b.created_at).getTime() >= windowStart.getTime()) {
        raiseCount.set(b.club_id, (raiseCount.get(b.club_id) ?? 0) + 1);
      }
    }
    for (const [clubId, count] of raiseCount) {
      const raises = count - 1;
      if (raises >= pattern.maxRaises) {
        alerts.push({ kind: 'rapid_raise', text: `俱乐部 #${clubId} 在 ${pattern.windowMinutes} 分钟内连续抬价 ${raises} 次` });
      }
    }

    // 判据三（从宽）：相邻两价之差恒等于最小抬价步长，且连续 ≥ colludeRounds 轮——
    // 正常激烈竞价也常带大额跳价或迟疑停顿，纯最小步长高频拉锯才标出来，仍由人工秒批
    const step = await config.getNumber('bid_step_min');
    if (step !== null && step > 0) {
      let run = 0;
      let maxRun = 0;
      for (let i = 1; i < bids.length; i++) {
        if (bids[i]!.amount - bids[i - 1]!.amount <= step + 1e-9) run++;
        else run = 0;
        maxRun = Math.max(maxRun, run);
      }
      if (maxRun + 1 >= pattern.colludeRounds) {
        alerts.push({ kind: 'minimal_raise_pattern', text: `出价拉锯 ${maxRun + 1} 轮且每轮只抬最小步长（疑似抬价串标，人工核实）` });
      }
    }
    return alerts;
  } catch {
    return []; // 告警检测故障不阻塞成交结算
  }
}

function parsePattern(raw: string | null): PatternConfig {
  if (!raw) return PATTERN_DEFAULTS;
  try {
    const parsed = JSON.parse(raw) as Partial<PatternConfig>;
    return {
      windowMinutes: Number.isFinite(parsed.windowMinutes) ? (parsed.windowMinutes as number) : PATTERN_DEFAULTS.windowMinutes,
      maxRaises: Number.isFinite(parsed.maxRaises) ? (parsed.maxRaises as number) : PATTERN_DEFAULTS.maxRaises,
      colludeRounds: Number.isFinite(parsed.colludeRounds) ? (parsed.colludeRounds as number) : PATTERN_DEFAULTS.colludeRounds,
    };
  } catch {
    return PATTERN_DEFAULTS;
  }
}
