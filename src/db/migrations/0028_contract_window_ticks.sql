-- v3.0.0：合同期与财政节点从自然日口径改为转会窗刻度（规则 4.3.1/4.3.2/4.4.4 以赛季为主刻度，
-- 原实现按 365.25 天折算年、保护期按 signed_at+548 天推算，与规则不符）。
-- 刻度定义：1 个常规窗关窗 = 0.5 赛季；效力（赛季）= 0.5 × (当前已关常规窗数 − service_ticks)。
-- 常规窗 = is_temporary=0 的窗，季初/中期按同赛季非临时窗顺序派生（第 1 个季初、第 2 个中期），不入库。
-- contracts 新增列（旧列 signed_at / effective_from / protected_until 保留留档，判定不再读 protected_until）：
--   service_ticks     签约时已关常规窗数（效力基数；效力 0 = 刚签约）
--   protection_ticks  保护期结束的绝对窗数（= service_ticks + 3 即 1.5 赛季）；NULL = 无保护期（训练营 4.3.4）
--   signed_season / signed_window_seq  签约时所在窗（展示与审计留档）
-- season_windows 新增列：
--   is_temporary      1 = 临时窗（关窗不推进效力、不扣工资、不收冠名租金；维护费与富人税照收）
ALTER TABLE contracts ADD COLUMN service_ticks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contracts ADD COLUMN protection_ticks INTEGER;
ALTER TABLE contracts ADD COLUMN signed_season INTEGER;
ALTER TABLE contracts ADD COLUMN signed_window_seq INTEGER;
ALTER TABLE season_windows ADD COLUMN is_temporary INTEGER NOT NULL DEFAULT 0;

-- 回滚（生产 contracts / season_windows 均 0 行，无需数据迁移）：
-- ALTER TABLE contracts DROP COLUMN service_ticks;
-- ALTER TABLE contracts DROP COLUMN protection_ticks;
-- ALTER TABLE contracts DROP COLUMN signed_season;
-- ALTER TABLE contracts DROP COLUMN signed_window_seq;
-- ALTER TABLE season_windows DROP COLUMN is_temporary;
