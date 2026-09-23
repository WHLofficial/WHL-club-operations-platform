// 赛事系统机器通道出站（增量 37）：把本仓的球队推给赛事系统建队。
// 基地址复用 TOUR_API_BASE（增量 31 排名代理用的同一个变量）；密钥 TEAM_SYNC_SECRET 与赛事仓同值。
//
// 为什么 club 也开始「推」了：赛事仓 clubRoster.ts 的注释明写「俱乐部平台完全不需要知道赛事系统的
// 存在，也就不必在俱乐部平台里放第二个系统的写入凭据」——那条边界针对的是**名册**（单向拉取足够，
// 拉的一方负责对账）。球队建档不是同一类事：两侧都可能先发起（在 club 建俱乐部 / 在 tour 建队），
// 纯拉取只能等对账兜底，而且 club 能读 tour 库、tour 读不到 club 库，反向拉不出「club 有 tour 无」。
// 所以只为**建档这一个写动作**开一条对称签名通道；名册仍然严格只拉（tour → club）。
import type { Env } from './env.ts';
import { hmacHex } from '../lib/hmac.ts';

export const TEAM_UPSERT_PATH = '/api/internal/team-upsert';
const TIMEOUT_MS = 10_000;

export type PushResult = { ok: true } | { ok: false; message: string };

/** 出站失败一律只回报文案，不抛：本地建俱乐部优先，失败可重试、对账页兜底。 */
export function pushError(r: PushResult): string | null {
  return r.ok ? null : r.message;
}

export async function pushTeamToTour(env: Env, { id, name }: { id: number; name: string }): Promise<PushResult> {
  const base = (env.TOUR_API_BASE ?? '').replace(/\/+$/, '');
  if (!base) return { ok: false, message: '未配置 TOUR_API_BASE，无法同步到赛事系统' };
  const secret = env.TEAM_SYNC_SECRET ?? '';
  if (!secret) return { ok: false, message: '未配置 TEAM_SYNC_SECRET，无法同步到赛事系统' };
  const raw = JSON.stringify({ id, name });
  const ts = Math.floor(Date.now() / 1000).toString();
  const sign = await hmacHex(secret, `POST|${TEAM_UPSERT_PATH}|${ts}|${raw}`);
  let res: Response;
  try {
    res = await fetch(`${base}${TEAM_UPSERT_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-timestamp': ts, 'x-sign': sign },
      body: raw,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, message: '赛事系统不可达' };
  }
  if (!res.ok) {
    let message = `赛事系统拒绝同步（HTTP ${res.status}）`;
    try {
      const parsed = (await res.json()) as { message?: unknown };
      if (typeof parsed.message === 'string' && parsed.message) message = parsed.message;
    } catch {
      // 非 JSON 响应就用手上的兜底文案
    }
    return { ok: false, message };
  }
  return { ok: true };
}
