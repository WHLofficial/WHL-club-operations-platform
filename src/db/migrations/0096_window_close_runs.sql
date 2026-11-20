-- 0096 · 关窗持久化阶段机骨架（window_close_runs / window_close_steps）
--
-- 背景：关窗从「一次 db.batch 全有全无」改造成「持久化阶段机」——窗口状态 open → closing →
-- closed；失败停在 closing，重试只前进、不回滚已提交阶段。B1 只有一个 step：close_all
-- （把现有 closeWindow 的业务整段包进来）；B2 才拆 payroll/home/loyalty/squad_audit/finalize/
-- post_close。
--
-- season_windows.status 从此多一个中间态 closing（open/closed 含义不变，无需 ALTER）：
--   open    = 窗口开着，普通业务可写；
--   closing = 认领之后、closed 之前：window_closing 冻结闸生效（普通非 GET/HEAD 写一律 409）；
--   closed  = 关窗完成（与旧口径一致）。
--
-- 状态枚举：
--   window_close_runs.status    = running（认领/执行中）/ failed（close_all 批失败，可重试前进）
--                                 / completed（关窗完成，summary_json 存既有摘要）
--   window_close_steps.status   = pending（待执行）/ done（本步批成功）/ failed（本步批失败）
--   attempt                     = 已完成尝试次数（done / failed 收口时 +1；pending 时为 0）
--
-- 幂等与并发（关键陷阱：D1 batch 里某条 UPDATE meta.changes=0 不会中止后续语句）：
--   · runs 按 (season, window_seq) 唯一——一窗一条 run，claim 批 ON CONFLICT DO NOTHING；
--   · steps 按 (run_id, step) 唯一——B2 拆步后每步一行，ON CONFLICT DO NOTHING；
--   · claim 批只含「窗口 open→closing + INSERT run + INSERT steps」三条语句，业务语句全部
--     放在 close_all 批；并发互斥由 claim 的 status='open' 写闸（后到者 changes=0，读已有 run
--     不重建）+ close_all 前的租约（window-close-runs.ts acquireCloseLease）两级承担。
--   · 租约 lease_owner / lease_expires_at：close_all 开始前 acquire（条件 status IN running,failed
--     且租约空闲/过期），TTL 建议 5 分钟（CLOSE_LEASE_TTL_MS）；租约过期接管的全套故障矩阵归 B4。
--
-- 回滚：DROP TABLE window_close_steps; DROP TABLE window_close_runs;
--       DROP INDEX IF EXISTS idx_season_windows_closing;
--       残留的 season_windows.status='closing' 需手工回 'open'（closing 只在 claim 批产生，
--       claim 批与 run INSERT 同批原子，正常路径不会残留）。

CREATE TABLE window_close_runs (
  id INTEGER PRIMARY KEY,
  season INTEGER NOT NULL,
  window_seq INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'failed', 'completed')),  -- 紧枚举
  current_step TEXT NOT NULL DEFAULT '',  -- 当前推进到的步骤名（claim 写 'close_all'；B2 拆步后逐步前进）
  lease_owner TEXT,                   -- 持有租约的执行者标识（acquireCloseLease 写入；NULL = 无租约）
  lease_expires_at TEXT,              -- 租约到期时刻（UTC ISO，与 strftime('%Y-%m-%dT%H:%M:%fZ','now') 同格式可比）；NULL = 无租约
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,                  -- completed 时写入
  error TEXT,                         -- 最近一次失败原因（failed 时写入；completed 时清空）
  summary_json TEXT,                  -- completed 时的关窗摘要（B1 存 closeWindow 回执同形对象）；
                                      -- 批后 post actions 失败只往 warnings 键追加、不改回 failed（B1 过渡语义，B3 通知 outbox 收口）
  UNIQUE (season, window_seq)
);

CREATE TABLE window_close_steps (
  run_id INTEGER NOT NULL REFERENCES window_close_runs(id),
  step TEXT NOT NULL,                 -- B1 固定 'close_all'；B2 起拆 payroll/home/loyalty/squad_audit/finalize/post_close
  seq INTEGER NOT NULL,               -- 步骤序号（1 起），B2 拆步后按序推进
  status TEXT NOT NULL CHECK (status IN ('pending', 'done', 'failed')),  -- 紧枚举
  attempt INTEGER NOT NULL DEFAULT 0, -- 已完成尝试次数（done/failed 收口时 +1）
  started_at TEXT,                    -- B1 不写（close_all 无独立 start 标记，时序看 run.started_at）；B2 拆步后由各步开始时写入
  finished_at TEXT,
  summary_json TEXT,                  -- 各步自己的摘要（B2 起使用；B1 的 close_all 摘要落在 run.summary_json）
  error TEXT,
  PRIMARY KEY (run_id, step)
);

-- closing 冻结闸（window-guard.ts isWindowClosing）的点查索引：closing 至多一行
-- （open 本就有 UNIQUE 部分索引约束一次一窗），部分索引让每个非 GET/HEAD 请求的冻结检查
-- 保持常数级，也把「同时存在两个 closing」在库层面焊死。
CREATE UNIQUE INDEX IF NOT EXISTS idx_season_windows_closing
  ON season_windows(status) WHERE status = 'closing';
