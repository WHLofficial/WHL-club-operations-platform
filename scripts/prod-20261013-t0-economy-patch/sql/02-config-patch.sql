-- 生产批 prod-20261013-t0-economy-patch · 02 主件：T0 三个 config 键落库（6 条语句，期望 changes 6）
-- 前置：**发版批 0 必须先上线**（push 触发的 CF 构建完成）。原因见 README §0：
--   ① loyalty_tiers 若在旧代码（忠诚为入账）下生效，S9 中期窗会「发钱 +591.65」而不是扣款，方向反了；
--   ② wage_floor_gap 旧代码不读（读的是常量 15）⇒ 单独落库无副作用，但要让取消生效仍需新代码；
--   ③ stadium_max_open_tier 是立即生效的运营阀（开 2 档），与代码方向无关。
-- 影响面：config 3 行 upsert + audit_log 3 行；不动账本、不动赛季/窗口、不动任何俱乐部数据、无不可逆点。
-- 幂等：每个键的两条语句共用「当前值 ≠ 目标值」守卫，重放 changes 均为 0。
-- 生效时点：① 下一次「赛季第 2 个常规窗」关窗批（S9 中期窗）取新排程；② 下一次关窗批工资段；
--           ③ 立即（管理端再开窗后即可升到 2 档）。

-- ============ 键 ① loyalty_tiers = 忠诚支出费率排程 ============
-- 目标：[[0.5,0.05],[1.5,0.10],[2.5,0.20],[3.5,0]]（用户 m01326：分档到位、其余不收；扣款时点 m01389 不变）
-- 语义：效力 0.5–1 → 5%、1.5–2 → 10%、2.5–3 → 20%、<0.5 与 ≥3.5 不收（取满足的最高档；收官 0% 档被
--       src/worker/season-settle.ts 的 `rate <= 0 ⇒ continue` 干净跳过，不写 0 金额流水）。
-- 与代码默认一致（v6.47.0 已把默认改成同串）⇒ 本行是「固化防漂移」，让生产值可见、可审计、可单独回滚。
INSERT INTO audit_log (actor, action, target_type, target_id, origin, before, after, at)
SELECT NULL, 'config_set', 'config', NULL, 'machine',
       json_object('key', 'loyalty_tiers', 'value', (SELECT value FROM config WHERE key = 'loyalty_tiers')),
       json_object('key', 'loyalty_tiers', 'value', '[[0.5,0.05],[1.5,0.10],[2.5,0.20],[3.5,0]]'),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE COALESCE((SELECT value FROM config WHERE key = 'loyalty_tiers'), '') <> '[[0.5,0.05],[1.5,0.10],[2.5,0.20],[3.5,0]]';

INSERT INTO config (key, value, updated_at)
SELECT 'loyalty_tiers', '[[0.5,0.05],[1.5,0.10],[2.5,0.20],[3.5,0]]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE COALESCE((SELECT value FROM config WHERE key = 'loyalty_tiers'), '') <> '[[0.5,0.05],[1.5,0.10],[2.5,0.20],[3.5,0]]'
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;

-- ============ 键 ② wage_floor_gap = 取消穷鬼线（用户令 2026-10-13） ============
-- 语义：实扣 = max(Σ现行合同工资, 级别帽值 − gap)；gap = 0 ⇒ 不设下限，按现行合同实扣（下限由
--       src/worker/window-payroll.ts 读取，未定级队本就不适用）。设 '15' 即恢复旧口径（顶级 53 / 次级 43）。
INSERT INTO audit_log (actor, action, target_type, target_id, origin, before, after, at)
SELECT NULL, 'config_set', 'config', NULL, 'machine',
       json_object('key', 'wage_floor_gap', 'value', (SELECT value FROM config WHERE key = 'wage_floor_gap')),
       json_object('key', 'wage_floor_gap', 'value', '0'),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE COALESCE((SELECT value FROM config WHERE key = 'wage_floor_gap'), '') <> '0';

INSERT INTO config (key, value, updated_at)
SELECT 'wage_floor_gap', '0', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE COALESCE((SELECT value FROM config WHERE key = 'wage_floor_gap'), '') <> '0'
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;

-- ============ 键 ③ stadium_max_open_tier = 开放 2 档球场（运营阀） ============
-- 语义：允许升入的最高档位（src/worker/stadium-ops.ts `stadium.tier + 1 > maxOpenTier ⇒ 400`）。
-- 现值 1 ⇒ tier=1 的 7 支球队（PSG/利物浦/尤文/拜仁/曼联/佛罗伦萨/切尔西）升不了 2 档、且 tier1
-- max_seats 35000 已顶格 ⇒ 出现「有钱花不出」。设 '2' 后：2 档 max_seats 45000、attend_coef 1.2。
INSERT INTO audit_log (actor, action, target_type, target_id, origin, before, after, at)
SELECT NULL, 'config_set', 'config', NULL, 'machine',
       json_object('key', 'stadium_max_open_tier', 'value', (SELECT value FROM config WHERE key = 'stadium_max_open_tier')),
       json_object('key', 'stadium_max_open_tier', 'value', '2'),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE COALESCE((SELECT value FROM config WHERE key = 'stadium_max_open_tier'), '') <> '2';

INSERT INTO config (key, value, updated_at)
SELECT 'stadium_max_open_tier', '2', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE COALESCE((SELECT value FROM config WHERE key = 'stadium_max_open_tier'), '') <> '2'
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
