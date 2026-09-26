-- 财政域留痕覆盖：只读复跑脚本（2026-09-26 随 v6.3.1 建）
-- 性质：只读。用于任何时点复核「钱动了多少、谁认领了、账本守恒不守恒」。
--
-- 执行通道（Windows 实测）：这些是**读**查询，`--file` 通道只回汇总不回结果集，
-- 必须走 --command --json 逐条跑（多行会被 cmd.exe 拒），例如：
--   npx wrangler d1 execute whl-club --remote --json --command "<把某一条压成单行>"
-- 取 JSON 的工具见 scratch/q.mjs（读文件 → 压单行 → 剥 banner 取第一个 JSON 对象）。
--
-- 三条已知约束（踩过坑，别再踩）：
--   1. audit_log 的时间列叫 `at`，不是 created_at；
--   2. compound SELECT（UNION ALL）项数上限很小（6 个即报 too many terms），故下面一律用
--      「一条 SELECT + 多个标量子查询」；
--   3. 每个 SELECT 单独执行，不要整文件丢给 --command。

-- S1 账本 kind 分布与净额：钱都从哪些口径动过
SELECT kind, COUNT(*) AS n, ROUND(SUM(amount), 2) AS net, MIN(created_at) AS first_at, MAX(created_at) AS last_at
  FROM ledger_entries GROUP BY kind ORDER BY n DESC;

-- S2 非自动流水明细：排除自动奖金(prize)与自动主场收入(revenue)后，还需要人工解释的每一笔
SELECT id, club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at
  FROM ledger_entries WHERE kind NOT IN ('prize', 'revenue') ORDER BY id;

-- S3 账本守恒断言：Σbalance − Σamount 必须恒为 0（与流水笔数无关的硬断言）；drift≠0 立即报警
SELECT (SELECT ROUND(SUM(balance), 2) FROM ledger_accounts) AS accounts_total,
       (SELECT ROUND(SUM(amount), 2) FROM ledger_entries) AS entries_total,
       (SELECT COUNT(*) FROM ledger_accounts) AS accounts,
       (SELECT COUNT(*) FROM ledger_entries) AS entries,
       (SELECT ROUND(SUM(balance), 2) FROM ledger_accounts)
         - (SELECT ROUND(SUM(amount), 2) FROM ledger_entries) AS drift;

-- S4 财政类审计的覆盖计数：每个 action 实际留了多少条痕。
-- 对照 S1：人类触发的 kind 都应在此出现（stadium_*/facility_*/naming_terminate/bypass_fee/
-- window_close/ledger_manual/ledger_opening_import/transfer_complete/listing_delist/
-- loyalty_bonus/tournament_stage_settle/rc_change_rollback）
SELECT action, COUNT(*) AS n, MIN(at) AS first_at, MAX(at) AS last_at
  FROM audit_log
 WHERE action IN ('stadium_expand', 'stadium_upgrade', 'facility_upgrade', 'stadium_update',
                  'naming_terminate', 'bypass_fee', 'window_close', 'ledger_manual',
                  'ledger_opening_import', 'transfer_complete', 'listing_delist',
                  'loyalty_bonus', 'tournament_stage_settle', 'rc_change_rollback')
 GROUP BY action ORDER BY n DESC;

-- S5 审计 actor 的可用性：actor 为 NULL 或 0 的行 = 无人类行为人（v6.3.2 起 0 哨兵退役、新行一律 NULL）。
--    判「谁做的」看 actor，判「哪条入口触发的」看 origin（S11）。
SELECT action, COUNT(*) AS n, SUM(CASE WHEN actor IS NULL THEN 1 ELSE 0 END) AS actor_null,
       SUM(CASE WHEN actor = 0 THEN 1 ELSE 0 END) AS actor_zero
  FROM audit_log GROUP BY action ORDER BY actor_null + actor_zero DESC, n DESC;

-- S6 全表审计 action 分布（含非财政域）：判断「有没有人生成过留痕」的基线
SELECT action, COUNT(*) AS n FROM audit_log GROUP BY action ORDER BY n DESC;

-- S7 球场状态快照：capacity 与 build_credit 是全站唯一被「花钱」改动的球场列
SELECT club_id, name, capacity, tier, build_credit, fans, updated_at FROM stadiums ORDER BY club_id;

-- S8 单队对账（把 33 换成任意 club_id）：该队流水 + 最新余额 + 该队球场状态，三处互相印证
SELECT (SELECT balance FROM ledger_accounts WHERE club_id = 33) AS balance,
       (SELECT SUM(amount) FROM ledger_entries WHERE club_id = 33) AS sum_amount,
       (SELECT COUNT(*) FROM ledger_entries WHERE club_id = 33) AS entries,
       (SELECT capacity FROM stadiums WHERE club_id = 33) AS capacity,
       (SELECT build_credit FROM stadiums WHERE club_id = 33) AS build_credit;

-- S9 单队流水明细（同上，替换 club_id）
SELECT id, kind, amount, balance_after, ref_type, ref_id, memo, created_at
  FROM ledger_entries WHERE club_id = 33 ORDER BY id;

-- S10 关窗与赛季状态：关过几个窗（关窗批才会有 wage/luxury_tax/maintenance/naming_fee/loyalty 流水）
SELECT (SELECT COUNT(*) FROM season_windows WHERE status = 'closed') AS closed_windows,
       (SELECT COUNT(*) FROM season_windows WHERE status = 'open') AS open_windows,
       (SELECT COUNT(*) FROM seasons WHERE status = 'preparing') AS preparing,
       (SELECT COUNT(*) FROM seasons WHERE status = 'active') AS active;

-- S11 审计来源通道分布（v6.3.2）：五个 origin 取值 + 历史行 NULL。
--     期望：迁移 0039 + 回填（scripts/prod-20260926-audit-origin-backfill/）之后 NULL 应为 0。
SELECT COALESCE(origin, '（NULL 历史行）') AS origin, COUNT(*) AS n,
       SUM(CASE WHEN actor IS NULL THEN 1 ELSE 0 END) AS actor_null
  FROM audit_log GROUP BY origin ORDER BY n DESC;

-- S12 财政类审计的来源通道（v6.3.2）：与 S4 同一 action 集合，按 origin 拆开看。
--     期望：§3 覆盖表里留痕的人类入口一律 'user'；自动路径（白名单）本就不在 audit_log 里。
SELECT action, COALESCE(origin, '（NULL 历史行）') AS origin, COUNT(*) AS n
  FROM audit_log
 WHERE action IN ('stadium_expand', 'stadium_upgrade', 'facility_upgrade', 'naming_terminate',
                  'bypass_fee', 'window_close', 'ledger_manual', 'ledger_opening_import',
                  'transfer_complete', 'listing_delist', 'loyalty_bonus',
                  'tournament_stage_settle', 'rc_change_rollback')
 GROUP BY action, origin ORDER BY action, n DESC;
