-- 生产批 prod-20261017-s9-pool-and-entry-topup · 02 主件：冠军杯小组赛池 200 → 192.5（2 条语句，期望 changes 2）
--
-- 用户令（2026-10-17）：「降低奖金池到192.5」+「即本赛季不再留冠军杯小组赛奖池里的剩余部分进行分配」。
-- 语义：season-settle.ts:148 remaining = round(pool − paid, 2)；S9 小组赛 paid = 192.5（25 胜 × 7.0 + 7 平 × 2.5，
--       CPU 侧不计）⇒ remaining = 0 ⇒ 本赛季小组赛不再按胜场占比分配剩余池（池成为精确上限）。
-- 现值：生产 config 无 prize_table 行 ⇒ 生效值 = 代码默认（src/core/config.ts:141，pool 200）。
-- 生效时点：S9 冠军杯小组赛结算（season_tournaments.stage_settled_at 目前全 null，尚未结算）。
-- 无代码依赖：prize_table 由既有代码读取，本批不要求先发版（与 T0 批的「先发版再落库」不同）。
-- 幂等：两条语句共用「现值 ≠ 目标值」守卫（写成 NOT(... = ...)，避免 <> 撞 --command 的 shell 重定向符），重放 changes 均为 0。
-- 通道：JSON 用 json_object() 构造（避免字面双引号撞 --command 的 shell 解释），时间戳内联为字面量。
-- 回滚：rollback/02-undo-config-pool.sql（删行 ⇒ 回代码默认 200）。

INSERT INTO audit_log (actor, action, target_type, target_id, origin, before, after, at)
SELECT NULL, 'config_set', 'config', NULL, 'machine',
       json_object('key', 'prize_table', 'value', (SELECT value FROM config WHERE key = 'prize_table')),
       json_object('key', 'prize_table', 'value', json_object('league_premier', json_object('entry', 20, 'win', 8.5, 'draw', 6.6, 'loss', 4.7), 'league_second', json_object('entry', 7.5, 'win', 6.7, 'draw', 4.8, 'loss', 2.9), 'qualifying', json_object('fallback', 7.5), 'champions_group', json_object('entry', 15, 'pool', 192.5, 'win', 7, 'draw', 2.5), 'champions_ko', json_object('quarterfinal', 7.5, 'semifinal', 10, 'final', 12.5, 'champion', 5), 'super_cup', json_object('win', 4, 'loss', 2))),
       '2026-10-17T13:41:41Z'
 WHERE NOT (COALESCE((SELECT value FROM config WHERE key = 'prize_table'), '') = json_object('league_premier', json_object('entry', 20, 'win', 8.5, 'draw', 6.6, 'loss', 4.7), 'league_second', json_object('entry', 7.5, 'win', 6.7, 'draw', 4.8, 'loss', 2.9), 'qualifying', json_object('fallback', 7.5), 'champions_group', json_object('entry', 15, 'pool', 192.5, 'win', 7, 'draw', 2.5), 'champions_ko', json_object('quarterfinal', 7.5, 'semifinal', 10, 'final', 12.5, 'champion', 5), 'super_cup', json_object('win', 4, 'loss', 2)));

INSERT INTO config (key, value, updated_at)
SELECT 'prize_table', json_object('league_premier', json_object('entry', 20, 'win', 8.5, 'draw', 6.6, 'loss', 4.7), 'league_second', json_object('entry', 7.5, 'win', 6.7, 'draw', 4.8, 'loss', 2.9), 'qualifying', json_object('fallback', 7.5), 'champions_group', json_object('entry', 15, 'pool', 192.5, 'win', 7, 'draw', 2.5), 'champions_ko', json_object('quarterfinal', 7.5, 'semifinal', 10, 'final', 12.5, 'champion', 5), 'super_cup', json_object('win', 4, 'loss', 2)), '2026-10-17T13:41:41Z'
 WHERE NOT (COALESCE((SELECT value FROM config WHERE key = 'prize_table'), '') = json_object('league_premier', json_object('entry', 20, 'win', 8.5, 'draw', 6.6, 'loss', 4.7), 'league_second', json_object('entry', 7.5, 'win', 6.7, 'draw', 4.8, 'loss', 2.9), 'qualifying', json_object('fallback', 7.5), 'champions_group', json_object('entry', 15, 'pool', 192.5, 'win', 7, 'draw', 2.5), 'champions_ko', json_object('quarterfinal', 7.5, 'semifinal', 10, 'final', 12.5, 'champion', 5), 'super_cup', json_object('win', 4, 'loss', 2)))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
