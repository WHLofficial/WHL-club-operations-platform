-- 修正巴萨主场名：占位「巴塞罗那主场」→「诺坎普球场」（用户令 2026-10-05）
-- 守卫：仅当现值仍是占位名时才写（重放 changes=0 ⇒ --retry 安全；也不会覆盖任何已被人工/向导改过的名字）
-- 注：时间戳用字面量而非 strftime('%…')，因为执行通道（--command 经 shell）拒绝含 % 的语句
UPDATE stadiums SET name = '诺坎普球场', updated_at = '2026-10-05T08:25:47.000Z' WHERE club_id = 241 AND name = '巴塞罗那主场';
