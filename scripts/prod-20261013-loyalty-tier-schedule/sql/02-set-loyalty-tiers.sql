-- 生产批 prod-20261013-loyalty-tier-schedule · 02 主件：忠诚奖金费率排程落库
-- 目标值：[[0.5,0.05],[1.5,0.10],[2.5,0.20],[3.5,0]]（用户 m01326 口径：分档到位、其余不收；扣款时点按 m01389 不变）
-- 语义：效力 0.5–1 → 5%、1.5–2 → 10%、2.5–3 → 20%、<0.5 与 ≥3.5 不收（取满足的最高档；收官 0% 被
--       src/worker/season-settle.ts:274 的 `rate <= 0 ⇒ continue` 干净跳过，不写 0 金额流水）。
-- 影响面：config 1 行 upsert + audit_log 1 行；不动账本、不动赛季/窗口、不动任何俱乐部数据。
-- 幂等：两条语句共用「当前值 ≠ 目标值」守卫，重放时 changes 均为 0。
-- 注意：本条只改**费率**。实现方向（源码是入俱乐部账 = faucet）与用户裁决（俱乐部支出）不一致，
--       该修正属代码改动（发版），不在本批范围 —— 见 README §5。

-- ① 审计镜像（before 取当前值；必须排在 ② 之前，否则读到的是写后值）
INSERT INTO audit_log (actor, action, target_type, target_id, origin, before, after, at)
SELECT NULL, 'config_set', 'config', NULL, 'machine',
       json_object('key', 'loyalty_tiers', 'value', (SELECT value FROM config WHERE key = 'loyalty_tiers')),
       json_object('key', 'loyalty_tiers', 'value', '[[0.5,0.05],[1.5,0.10],[2.5,0.20],[3.5,0]]'),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE COALESCE((SELECT value FROM config WHERE key = 'loyalty_tiers'), '') <> '[[0.5,0.05],[1.5,0.10],[2.5,0.20],[3.5,0]]';

-- ② config upsert（与 src/core/config.ts:383-390 的 set() 同形：ON CONFLICT 覆盖 value + updated_at）
INSERT INTO config (key, value, updated_at)
SELECT 'loyalty_tiers', '[[0.5,0.05],[1.5,0.10],[2.5,0.20],[3.5,0]]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE COALESCE((SELECT value FROM config WHERE key = 'loyalty_tiers'), '') <> '[[0.5,0.05],[1.5,0.10],[2.5,0.20],[3.5,0]]'
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
