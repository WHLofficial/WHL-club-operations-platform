-- 0097 · 关窗通知 outbox（window_close_notifications，v6.88.1 B3）
--
-- 背景：三类关窗通知（promotion_forced / home 段四模板 naming_* / squad_audit_failed）从
-- post_close 直发改为「段内落库 + post_close 统一投递」：
--   · 落库点 = 各段收口批（preflight / home / squad_audit 的 step done 批）追加 INSERT OR
--     IGNORE（src/worker/window-close-outbox.ts stageCloseNotificationStatements）——与段批
--     原子，崩在段 done 与 post_close 之间不丢通知（行已落库，投递按 run_id 捞）；
--   · 投递点 = post_close 的 deliverCloseNotifications 与管理端重试端点（retryCloseNotifications），
--     只认 pending/failed 行，已 sent 不重投；
--   · payload 落生成点 data 原文（JSON.stringify），渲染推迟到投递时 renderNotification——
--     notifications.payload 只落 {text,...} 查不到 season/windowSeq 的现状就此修复，
--     squad_audit_failed 原先恒不命中的 LIKE 查重由 (run_id, dedup_key) 唯一约束取代。
--
-- 状态枚举：
--   status  = pending（待投递）/ sent（已投递，含无收件人 count=0 的完成态）/ failed（投递失败，
--             last_error 记原因，可重投）
--   attempt = 已完成尝试次数（sent / failed 收口时 +1，语义同 window_close_steps.attempt）
--
-- 幂等与唯一性：
--   · PRIMARY KEY (run_id, dedup_key) 即 UNIQUE(run_id, dedup_key)：复合主键本身就是唯一约束，
--     INSERT OR IGNORE 撞键静默吞——段级重放（段失败重试 builder 重建、重复 close）不产生重复行，
--     不必再建代理 id + 次级 UNIQUE 索引（先例 = 0096 steps 的 PRIMARY KEY (run_id, step)）；
--   · dedup_key 不含 season/windowSeq：run 本身 UNIQUE(season, window_seq)（0096:47），run_id
--     已隐含窗位；键由生成点构造：promotion:{sessionId} / home:{clubId}:{template}:{序号} /
--     squad:{clubId}。
--
-- created_at / sent_at 不落 DDL DEFAULT：由语句构造器显式注入 strftime('%Y-%m-%dT%H:%M:%fZ','now')
-- 同款 UTC ISO（window-close-runs.ts NOW_SQL 口径，可与其他 ISO 串直接字符串比较），保证 INSERT
-- 重放可带值（与 0096 started_at 同风格）。
--
-- FK 裸 REFERENCES 无 ON DELETE：全仓迁移惯例（0096 steps 同款）；生产代码零 DELETE
-- window_close_runs 路径（window-close-runs.ts 只 INSERT/UPDATE/SELECT），默认 NO ACTION 即可。
-- outbox 不引入 TTL 清理（无先例的新决策，不做）。
--
-- 回滚：DROP TABLE window_close_notifications;（索引随表删除）

CREATE TABLE window_close_notifications (
  run_id INTEGER NOT NULL REFERENCES window_close_runs(id),
  club_id INTEGER NOT NULL,
  template TEXT NOT NULL,
  payload TEXT NOT NULL,              -- 生成点 data 原文（JSON.stringify）；投递时才渲染
  dedup_key TEXT NOT NULL,            -- promotion:{sessionId} / home:{clubId}:{template}:{序号} / squad:{clubId}
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')) DEFAULT 'pending',  -- 紧枚举
  attempt INTEGER NOT NULL DEFAULT 0, -- 已完成尝试次数（sent/failed 收口时 +1）
  last_error TEXT,                    -- 最近一次投递失败原因（标 sent 时清空）
  created_at TEXT NOT NULL,
  sent_at TEXT,                       -- 标 sent 时写入
  PRIMARY KEY (run_id, dedup_key)
);

-- 服务 deliverCloseNotifications 的 WHERE run_id = ? AND status IN ('pending','failed') 与状态端点
-- 的 GROUP BY status；每 run 行数 ≤ 数十（promotion ≤200 / home 四模板 / squad ≤16），成本一行
CREATE INDEX idx_window_close_notifications_run_status ON window_close_notifications(run_id, status);
