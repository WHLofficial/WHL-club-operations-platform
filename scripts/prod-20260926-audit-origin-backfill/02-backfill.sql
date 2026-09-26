-- 02 · 审计来源回填（写生产）
--
-- 前置：必须先 `npm run db:migrate:remote` 把迁移 0039 的 origin 列加上，否则本文件报 no such column: origin。
-- 口径：只填「按旧代码能确凿认定触发通道」的行；认不出的留 NULL（NULL = 历史行 / 未知，不猜）。
-- 每条都带 `origin IS NULL` 守卫 ⇒ 重跑时 changes 全为 0。
-- 2026-09-26 预检快照（100 行）：① 0 条、② 74 条、③ 3 条、④ 23 条，合计 100 条，回填后无 NULL 残留。
-- 2026-09-26 已执行：Total queries executed = 4、Rows written = 200、changed_db true；验收 null_origin = 0、bad1–bad4 全 0（结果见 README §执行结果）。

-- ① 惰性结算：业务请求顺手结算过期项（读市场 / 报价 / 谈判列表时触发）。
--    旧代码这条路径的 actor 就是 NULL（settleOverdue 无 actor）；actor 非空的同类 action 是人类入口，走 ④。
UPDATE audit_log SET origin = 'lazy_settle'
WHERE origin IS NULL
  AND actor IS NULL
  AND action IN ('listing_settle', 'listing_delist', 'activation_void', 'bid_pattern_alert');

-- ② 自动确认赛果：autoConfirmResults，cron 与 POST /api/cron/tick 共用 runSettleTick ⇒ 定时兜底。
--    旧代码写 actor = 0（哨兵）；人工确认写的是管理员 id，不会被这条命中（走 ④）。
UPDATE audit_log SET origin = 'cron_tick'
WHERE origin IS NULL
  AND actor = 0
  AND action = 'result_confirm';

-- ③ 认证中心推送的全端登出（OIDC backchannel logout）。
UPDATE audit_log SET origin = 'backchannel'
WHERE origin IS NULL
  AND actor = 0
  AND action = 'auth_backchannel_logout';

-- ④ 人类入口的历史行：actor 非空 ⇒ 旧代码里必定是把某个人的 id 传下来了 ⇒ 人类请求直接触发。
--    生产实测命中的是 auth_login / auth_logout / club_bind / season_create / season_bind_tournament 五类，
--    都是人点出来的（登录回调、教练绑定球队、管理端建赛季/绑赛事）。
--    推理依据：旧代码只有机器路径写 actor = 0（②③ 两处），没有任何机器路径会传非空 actor。
UPDATE audit_log SET origin = 'user'
WHERE origin IS NULL
  AND actor IS NOT NULL;

-- 刻意不做：不把 actor = 0 改成 NULL。0 是历史哨兵，前端按「系统」兼容显示（SystemPage.tsx），
-- 改它会动到既有行的语义；通道已由 origin 说明，新代码不再写 0（tests/ledger-audit-lock.test.ts 钉住）。
