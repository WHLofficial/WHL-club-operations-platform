// 敏感操作留痕（PRD §4.1）。涉密场景由调用方保证 before/after 只含掩码值（§6.10）。
//
// 两个字段的语义（v6.3.2 起的契约，别再自行发明哨兵值）：
//   actor  —— 「谁做的」：人类行为人，取外部认证中心的用户 id；机器一律 null。
//             本仓没有 users 表（认证在 AUTH_DB / OIDC），actor 只是外部 id 的副本，
//             所以 0 在这里没有任何含义、更不是「系统」。历史行里的 0（自动确认赛果、
//             backchannel 登出）已由前端按「系统」兼容显示，新代码不许再写 0。
//   origin —— 「哪条入口触发的」：描述触发通道，不描述行为主体。必填，漏一个就编译不过。
//             它回答 actor 答不了的问题：机器产生的这行到底是定时兜底、业务请求顺带的
//             惰性结算，还是外部推来的。
export type AuditOrigin =
  | 'user' // 人类请求直接触发（管理端 / 教练自助端点）
  | 'cron_tick' // 定时或手动 tick 兜底（worker/index.ts）
  | 'lazy_settle' // 业务请求顺带触发的惰性结算（读市场/报价时结算过期项）
  | 'backchannel' // 认证中心推送（OIDC backchannel logout）
  | 'machine'; // 外部机器通道（赛事系统推来的建档）

export interface AuditEntry {
  actor: number | null;
  action: string;
  targetType: string;
  targetId?: number | null;
  origin: AuditOrigin;
  before?: unknown;
  after?: unknown;
}

export function createAuditStatement(db: D1Database) {
  return (entry: AuditEntry): D1PreparedStatement =>
    db
      .prepare(
        `INSERT INTO audit_log (actor, action, target_type, target_id, origin, before, after, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
      )
      .bind(
        entry.actor,
        entry.action,
        entry.targetType,
        entry.targetId ?? null,
        entry.origin,
        entry.before === undefined ? null : JSON.stringify(entry.before),
        entry.after === undefined ? null : JSON.stringify(entry.after),
      );
}

export async function writeAudit(db: D1Database, entry: AuditEntry): Promise<void> {
  await createAuditStatement(db)(entry).run();
}
