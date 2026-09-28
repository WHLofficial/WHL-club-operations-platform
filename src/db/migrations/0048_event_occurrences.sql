-- 0048_event_occurrences.sql · v6.10.0 随机事件（D 块）
-- 事件发生记录：一次触发一行。这张表同时是**效果落账的幂等闸**——本仓事件无关窗批可依附，
-- 所以非账本效果（死忠/上座修正/天气/设施/品牌热度/档期）的语句都带
-- `AND (SELECT status FROM event_occurrences WHERE id = ?) = 'pending'` 守卫，
-- 同批末句再把该行置 resolved；账本效果则复用 ledgerMovement 自带的 NOT EXISTS 闸。整批重放安全。
-- 选择型的字段（choice_no / outcome_json / deadline_at）**一次建全**，v6.11.0 开放选项型时零迁移。
-- 回滚：DROP TABLE event_occurrences;
CREATE TABLE IF NOT EXISTS event_occurrences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id INTEGER NOT NULL,
  season INTEGER NOT NULL,
  window_seq INTEGER NOT NULL,                 -- 触发时所处窗口（赛季进行中事件不绑窗口，仅作归档）
  event_id TEXT NOT NULL,
  event_name TEXT NOT NULL,                    -- 快照（池里改名/停用后流水仍可读）
  event_type TEXT NOT NULL DEFAULT 'instant',
  status TEXT NOT NULL DEFAULT 'pending',      -- pending=待结算（选择型）/ resolved=已结算 / expired=超时兜底
  effects_json TEXT NOT NULL DEFAULT '{}',     -- 实际生效的效果（选择型为选中分支的效果）
  notes_json TEXT NOT NULL DEFAULT '[]',       -- 中文备注行（供流水/通知展示）
  choice_no INTEGER,                           -- 选择型：玩家所选选项号
  outcome_json TEXT NOT NULL DEFAULT '{}',     -- 选择型：命中的概率分支
  deadline_at TEXT,                            -- 选择型：选择时限（超时由 cron 兜底）
  resolved_by TEXT NOT NULL DEFAULT '',        -- 结算者（actor id / 'auto'）
  resolved_at TEXT,
  text TEXT NOT NULL DEFAULT '',               -- 播报文案（模板渲染；v6.12.0 起可 LLM 生成后落库审校）
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_occ_club ON event_occurrences(club_id, season);
CREATE INDEX IF NOT EXISTS idx_event_occ_status ON event_occurrences(status, deadline_at);
