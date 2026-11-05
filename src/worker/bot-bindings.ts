// v6.77.0：AstrBot 联赛顾问的只读身份通道（QQ → 俱乐部绑定）。
//
// 顾问要回答“我们队/琛止的队”，需要知道群成员是谁执教哪队。绑定在群内是公开信息
// （谁执教哪队大家都清楚），但端点严格限定为**只回请求里出现的 QQ**：不提供列表、
// 模糊搜索或按俱乐部反查 QQ 的入口，避免变成任意外部调用者的 QQ 枚举器。
//
// QQ → account_id 的主源是 AUTH_DB.identity（provider='qq'，provider_uid 存 QQ），只在
// AUTH_DB 已配置时查；identity 没命中的 QQ 才用本地 qq_links.qq → user_id 兜底（user_id
// 当 account_id 用）。两源都命中且账号不同时 identity 优先：不做多候选合并，也不拿兜底
// 账号再试一次。account_id → 绑定走 AUTH_DB.team_binding LEFT JOIN team——LEFT JOIN 刻意
// 保住「绑了但 team 行未关联俱乐部」= bound:true / clubId:null 的语义（与 binding.ts 单账号
// 版同构）；本地 clubs 按 club_id 补中文名与 is_cpu。AUTH_DB 未配置时走回滚通道：qq_links +
// 本地 club_bindings（teamName 恒 null）。2026-11-05 生产只读实测：本地 qq_links 与
// club_bindings 均 0 行，AUTH_DB.identity provider='qq' 11 行、其中 10 行有 team_binding——
// identity 是唯一有数据的源。每段 IN 查询都按 50 个参数切块：D1 的绑定参数上限比 SQLite
// 的 999 更紧，且 IN 列表过大时查询计划会退化。
import type { Env } from './env.ts';

export const BOT_BINDINGS_PATH = '/api/internal/bot/bindings';
export const BOT_BINDINGS_MAX_QQS = 200;
const QUERY_CHUNK = 50;

// 未绑定项只有 qq/bound 两个键，不塞 null 字段；绑定项六个键齐全，值可为 null。
export type BotBinding =
  | { qq: string; bound: false }
  | {
      qq: string;
      bound: true;
      /** 绑了但 team 行未关联俱乐部时为 null */
      clubId: number | null;
      /** 本地 clubs 的中文队名；club_id 为 null 或本地无此队时为 null（不拿 teamName 冒充） */
      clubName: string | null;
      /** AUTH_DB team.name；回滚通道（无 AUTH_DB）恒 null */
      teamName: string | null;
      /** 跟随 clubs.is_cpu；club 未知时为 null——false 会被读成「真人队」 */
      isCpu: boolean | null;
    };

export interface BotBindingsPayload {
  groupId: string;
  qqs: string[];
}

export type ParseBotBindingsResult =
  | { ok: true; payload: BotBindingsPayload }
  | { ok: false; message: string };

/**
 * 校验请求体。groupId 只做日志审计，不校验群成员关系（成员列表由机器人提供，
 * HMAC 已保证调用方是可信机器人）；qqs 只接受数字字符串，去重后保持原顺序。
 */
export function parseBotBindingsBody(body: unknown): ParseBotBindingsResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, message: '请求体应为对象' };
  }
  const record = body as { groupId?: unknown; qqs?: unknown };
  const groupId = typeof record.groupId === 'string' ? record.groupId.trim() : '';
  if (!groupId || groupId.length > 64) {
    return { ok: false, message: 'groupId 应为 1–64 个字符的字符串' };
  }
  if (!Array.isArray(record.qqs)) {
    return { ok: false, message: 'qqs 应为数组' };
  }
  if (record.qqs.length > BOT_BINDINGS_MAX_QQS) {
    return { ok: false, message: `qqs 最多 ${BOT_BINDINGS_MAX_QQS} 个` };
  }
  const seen = new Set<string>();
  const qqs: string[] = [];
  for (const raw of record.qqs) {
    if (typeof raw !== 'string' || !/^\d{1,20}$/.test(raw)) {
      return { ok: false, message: 'qqs 的每一项都应为数字 QQ 字符串' };
    }
    if (seen.has(raw)) continue;
    seen.add(raw);
    qqs.push(raw);
  }
  return { ok: true, payload: { groupId, qqs } };
}

interface IdentityRow {
  provider_uid: string;
  account_id: number | null;
}

interface QqLinkRow {
  qq: string;
  user_id: number;
}

interface ResolvedBinding {
  account_id: number;
  club_id: number | null;
  team_name: string | null;
}

interface ClubRow {
  id: number;
  name: string;
  is_cpu: number | null;
}

async function selectInChunks<T>(
  db: Env['DB'] | NonNullable<Env['AUTH_DB']>,
  sql: (placeholders: string) => string,
  values: readonly (string | number)[],
  map: (row: Record<string, unknown>) => T,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < values.length; i += QUERY_CHUNK) {
    const chunk = values.slice(i, i + QUERY_CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const result = await db
      .prepare(sql(placeholders))
      .bind(...chunk)
      .all<Record<string, unknown>>();
    for (const row of result.results ?? []) out.push(map(row));
  }
  return out;
}

/**
 * 批量查绑定。只回 qqs 里出现的 QQ，顺序与入参一致；查不到就是 bound:false。
 * 不返回 account_id、财务、合同、报价。
 */
export async function lookupBotBindings(env: Env, qqs: readonly string[]): Promise<BotBinding[]> {
  if (qqs.length === 0) return [];

  // 第一步：QQ → account_id。identity 主源（account_id 为 NULL 的行当没命中，落兜底）；
  // 只对 identity 未命中的 QQ 查 qq_links——两源冲突时 identity 优先的机制就在这里：
  // 命中的 QQ 根本不进兜底查询，自然不存在「拿兜底账号再试一次」。
  const accountByQq = new Map<string, number>();
  if (env.AUTH_DB) {
    const identityRows = await selectInChunks<IdentityRow>(
      env.AUTH_DB,
      (ph) => `SELECT provider_uid, account_id FROM identity WHERE provider = 'qq' AND provider_uid IN (${ph})`,
      qqs,
      (row) => ({
        provider_uid: String(row.provider_uid),
        account_id: row.account_id == null ? null : Number(row.account_id),
      }),
    );
    for (const row of identityRows) {
      if (row.account_id !== null) accountByQq.set(row.provider_uid, row.account_id);
    }
    const missed = qqs.filter((qq) => !accountByQq.has(qq));
    if (missed.length > 0) {
      const links = await selectInChunks<QqLinkRow>(
        env.DB,
        (ph) => `SELECT qq, user_id FROM qq_links WHERE qq IN (${ph})`,
        missed,
        (row) => ({ qq: String(row.qq), user_id: Number(row.user_id) }),
      );
      for (const row of links) accountByQq.set(row.qq, row.user_id);
    }
  } else {
    // 回滚通道：没有 AUTH_DB 就把本地 qq_links.user_id 当 account_id 用
    const links = await selectInChunks<QqLinkRow>(
      env.DB,
      (ph) => `SELECT qq, user_id FROM qq_links WHERE qq IN (${ph})`,
      qqs,
      (row) => ({ qq: String(row.qq), user_id: Number(row.user_id) }),
    );
    for (const row of links) accountByQq.set(row.qq, row.user_id);
  }

  // 第二步：account_id → 绑定。AUTH_DB 在场走 team_binding LEFT JOIN team（team 行缺失或
  // 未关联俱乐部都算 bound，club_id 出 null）；回滚通道走本地 club_bindings，teamName 恒 null。
  // 生产 team_binding 每个 account 至多一行（2026-11-05 只读探针 GROUP BY HAVING n>1 = 0 行），
  // 但表上只有 (account_id, team_id) 主键、没有 account_id 唯一约束，所以下面按 team_id 升序
  // 取第一条：真出现多行时结果也是稳定的，不随索引返回顺序漂移。club_bindings.user_id 是
  // UNIQUE，回滚通道不存在这个歧义。
  const accountIds = [...new Set(accountByQq.values())];
  const bindings: ResolvedBinding[] = [];
  if (accountIds.length > 0) {
    if (env.AUTH_DB) {
      bindings.push(
        ...(await selectInChunks<ResolvedBinding>(
          env.AUTH_DB,
          (ph) =>
            `SELECT b.account_id AS account_id, t.club_id AS club_id, t.name AS team_name
               FROM team_binding b LEFT JOIN team t ON t.id = b.team_id
              WHERE b.account_id IN (${ph})
              ORDER BY b.account_id, b.team_id`,
          accountIds,
          (row) => ({
            account_id: Number(row.account_id),
            club_id: row.club_id == null ? null : Number(row.club_id),
            team_name: row.team_name == null ? null : String(row.team_name),
          }),
        )),
      );
    } else {
      bindings.push(
        ...(await selectInChunks<ResolvedBinding>(
          env.DB,
          (ph) => `SELECT user_id AS account_id, club_id FROM club_bindings WHERE user_id IN (${ph})`,
          accountIds,
          (row) => ({
            account_id: Number(row.account_id),
            club_id: row.club_id == null ? null : Number(row.club_id),
            team_name: null,
          }),
        )),
      );
    }
  }
  const bindingByAccount = new Map<number, ResolvedBinding>();
  for (const row of bindings) {
    if (!bindingByAccount.has(row.account_id)) bindingByAccount.set(row.account_id, row);
  }

  // 第三步：club_id → 本地 clubs（中文队名 + is_cpu）。查不到的 club 就让 clubName/isCpu
  // 落 null，不拿 teamName 冒充 clubName——两个名字来源不同，混写会让调用方分不清。
  const clubIds = [...new Set(bindings.map((row) => row.club_id).filter((id): id is number => id !== null))];
  const clubById = new Map<number, ClubRow>();
  if (clubIds.length > 0) {
    const clubs = await selectInChunks<ClubRow>(
      env.DB,
      (ph) => `SELECT id, name, is_cpu FROM clubs WHERE id IN (${ph})`,
      clubIds,
      (row) => ({
        id: Number(row.id),
        name: String(row.name),
        is_cpu: row.is_cpu == null ? null : Number(row.is_cpu),
      }),
    );
    for (const row of clubs) clubById.set(row.id, row);
  }

  return qqs.map((qq): BotBinding => {
    const accountId = accountByQq.get(qq);
    const binding = accountId === undefined ? undefined : bindingByAccount.get(accountId);
    if (!binding) return { qq, bound: false };
    const club = binding.club_id === null ? undefined : clubById.get(binding.club_id);
    return {
      qq,
      bound: true,
      clubId: binding.club_id,
      clubName: club?.name ?? null,
      teamName: binding.team_name,
      isCpu: club ? Boolean(club.is_cpu) : null,
    };
  });
}
