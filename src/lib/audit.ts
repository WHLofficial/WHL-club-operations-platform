// 敏感操作留痕（PRD §4.1）。涉密场景由调用方保证 before/after 只含掩码值（§6.10）。
export interface AuditEntry {
  actor: number | null;
  action: string;
  targetType: string;
  targetId?: number | null;
  before?: unknown;
  after?: unknown;
}

export function createAuditStatement(db: D1Database) {
  return (entry: AuditEntry): D1PreparedStatement =>
    db
      .prepare(
        `INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at)
         VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
      )
      .bind(
        entry.actor,
        entry.action,
        entry.targetType,
        entry.targetId ?? null,
        entry.before === undefined ? null : JSON.stringify(entry.before),
        entry.after === undefined ? null : JSON.stringify(entry.after),
      );
}

export async function writeAudit(db: D1Database, entry: AuditEntry): Promise<void> {
  await createAuditStatement(db)(entry).run();
}
