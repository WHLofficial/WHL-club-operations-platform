-- 0081 · 预期收入额度：三个资金触发器的「可用资金」式接入额度（设计 §1/§2.1，v6.57.0）
--
-- 缘起：窗口内在途的卖人收入（挂牌最高 active 出价 / 待审·签约中的成交单）已经落定、只差过户，
-- 让卖方先把这部分税后净额周转出来。额度是**实时公式**、不预入账：在途单落空（审核驳回 / 谈判作废）
-- 额度自动收缩；已按额度花出去的部分把可用余额压成负数（「负=欠款」沿用系统现状哲学）。
--
-- 公式（与 src/worker/ledger.ts 的 creditLineSql 逐字同源，改这里必须同步改那里；
-- 同源由 tests/expected-income.test.ts 的文本锁 + 行为锁兜住）：
--   expectedIncome = Σ_每球员 net（同一球员多源只取毛额最高一份）
--     源① listings  status IN ('listed','bidding') 且 type NOT IN ('activation') 且有 active 出价
--                    → 取最高 active 出价额；type='forced' 按 auction_tax_rate 整单税率
--     源② transfers status IN ('pending_review','signing') 且 from_club_id=本队
--                    且 type IN ('transfer','activation','forced_auction')（**只认成交类**——
--                    rc_change/match/free_agent/termination 的 from_club_id 也等于本队、fee 写的是
--                    新违约金/差额，但永不产生卖方收入，不筛类型就是凭空造额度）
--     其余按分段累进（tax_rates，现行 active 合同 RC），与 transfers.ts:222-224 过户实算同源
--   creditLine = expectedIncome × k，k = config expected_income_rate，钳制式 MIN(MAX(x,0),1)
--   available  = COALESCE(balance,0) − Σheld（+ 本单旧冻结）+ creditLine
--
-- 三条防御（不得改动，否则资金闸会静默 fail-open）：
--   ① k 读 config 用钳制式：缺行 → 1.0；写非法值（如 'abc'）→ CAST 得 0.0 ⇒ 额度归零（fail 严格方向）。
--   ② 分段税率不在触发器里另起解析逻辑，直接内嵌 ledger.ts 渲出的同一段文本；tax_rates 是逗号串，
--      用 instr/substr 三段提取（json_extract 遇非 JSON 会打断每次 INSERT）；缺逗号段解析为 NULL
--      ⇒ 该行净额 NULL、SUM 跳过（不计额度）。
--   ③ 顺手包死全部 NULL 可达闸位（第三轮终验收敛）：挂牌/批次/标不存在时原式比较得 NULL、
--      RAISE 不触发 ⇒ 放行；无账本行时余额子查询得 NULL ⇒ 放行。修法照 0063:71 的 IFNULL 先例。
--
-- 明确**只改资金式**：WHL_BID_REJECT_CLOSED / WHL_BID_REJECT_AMOUNT / WHL_OFFER_REJECT_CLOSED /
-- WHL_OFFER_REJECT_AMOUNT / WHL_SEA_REJECT_CLOSED / WHL_SEA_REJECT_AMOUNT 与各 deadline 闸逐字保留
-- （设计 A 的既有测试依赖这些错误码；CLOSED/AMOUNT 的 NULL 包死只发生在上面点名的三处）。
--
-- 部署核查：本迁移零数据写入、零表结构变更（只 DROP + CREATE 触发器），秒级完成。
-- 回滚：反向重建 0005 / 0063 / 0070 的原始定义（DROP TRIGGER + 原 CREATE），无数据副作用。
DROP TRIGGER IF EXISTS fund_holds_bid_guard;

CREATE TRIGGER fund_holds_bid_guard
BEFORE INSERT ON fund_holds
WHEN NEW.status = 'held' AND NEW.ref_type = 'listing'
BEGIN
  -- 挂牌必须处于 listed/bidding（待审、已下架、已成交的挂牌不再收新冻结）
  -- IFNULL 包死：挂牌不存在时原式 NOT IN 得 NULL、RAISE 不触发（旧版 fail-open）
  SELECT RAISE(ABORT, 'WHL_BID_REJECT_CLOSED')
  WHERE IFNULL((SELECT status FROM listings WHERE id = NEW.ref_id), '') NOT IN ('listed', 'bidding');

  -- 首笔出价 ≥ 挂牌价；抬价 ≥ 当前最高活跃出价 + 最小步长（config bid_step_min，缺省 1m）
  SELECT RAISE(ABORT, 'WHL_BID_REJECT_AMOUNT')
  WHERE NEW.amount < COALESCE(
          (SELECT MAX(amount) + CAST(COALESCE((SELECT value FROM config WHERE key = 'bid_step_min'), '1') AS REAL)
           FROM bids WHERE listing_id = NEW.ref_id AND status = 'active'),
          (SELECT ask_price FROM listings WHERE id = NEW.ref_id)
        );

  -- 可用资金 = COALESCE(账户余额, 0) − 全部现行冻结 + 本人在这单上的现行冻结（抬价顶替，净差额校验）
  --           + 预期收入额度 ≥ 本次出价
  SELECT RAISE(ABORT, 'WHL_BID_REJECT_FUNDS')
  WHERE COALESCE((SELECT balance FROM ledger_accounts WHERE club_id = NEW.club_id), 0)
          - (SELECT COALESCE(SUM(amount), 0) FROM fund_holds WHERE club_id = NEW.club_id AND status = 'held')
          + COALESCE(
              (SELECT amount FROM fund_holds
               WHERE club_id = NEW.club_id AND status = 'held' AND ref_type = 'listing' AND ref_id = NEW.ref_id),
              0
            )
          + COALESCE(ROUND((SELECT SUM(p.net) * MIN(MAX(CAST(COALESCE((SELECT value FROM config WHERE key = 'expected_income_rate'), '1.0') AS REAL), 0), 1) FROM (SELECT dd.player_id AS player_id,
                 MAX(dd.gross) AS gross,
                 dd.source AS source,
                 dd.ref_id AS ref_id,
                 dd.tax AS tax,
                 dd.net AS net
          FROM (SELECT d.source AS source,
             d.ref_id AS ref_id,
             d.player_id AS player_id,
             d.gross AS gross,
             d.tax AS tax,
             d.gross - d.tax AS net
      FROM (SELECT src.source AS source,
                   src.ref_id AS ref_id,
                   src.player_id AS player_id,
                   src.gross AS gross,
                   ROUND(CASE WHEN src.forced = 1
                              THEN src.gross * r.auction
                              ELSE MIN(src.gross, COALESCE(c.release_fee, 0)) * r.r1
                                   + MAX(0, MIN(src.gross, COALESCE(c.release_fee, 0) * 1.5) - COALESCE(c.release_fee, 0)) * r.r2
                                   + MAX(0, src.gross - COALESCE(c.release_fee, 0) * 1.5) * r.r3
                         END, 2) AS tax
            FROM (SELECT 'listing' AS source,
                         l.id AS ref_id,
                         l.player_id AS player_id,
                         (SELECT MAX(b.amount) FROM bids b WHERE b.listing_id = l.id AND b.status = 'active') AS gross,
                         CASE WHEN l.type = 'forced' THEN 1 ELSE 0 END AS forced
                  FROM listings l
                  WHERE l.seller_club_id = NEW.club_id
                    AND l.status IN ('listed', 'bidding')
                    AND l.type NOT IN ('activation')
                    AND EXISTS (SELECT 1 FROM bids b WHERE b.listing_id = l.id AND b.status = 'active')
                  UNION ALL
                  SELECT 'transfer' AS source,
                         t.id AS ref_id,
                         t.player_id AS player_id,
                         t.fee AS gross,
                         CASE WHEN t.type = 'forced_auction' THEN 1 ELSE 0 END AS forced
                  FROM transfers t
                  WHERE t.from_club_id = NEW.club_id
                    AND t.status IN ('pending_review', 'signing')
                    AND t.type IN ('transfer', 'activation', 'forced_auction')
                    AND t.fee IS NOT NULL) AS src
            LEFT JOIN contracts c ON c.player_id = src.player_id AND c.is_active = 1
            CROSS JOIN (SELECT CAST(NULLIF(substr(v, 1, instr(v, ',') - 1), '') AS REAL) AS r1,
              CAST(NULLIF(substr(v, instr(v, ',') + 1, instr(substr(v, instr(v, ',') + 1), ',') - 1), '') AS REAL) AS r2,
              CAST(NULLIF(substr(v, instr(v, ',') + instr(substr(v, instr(v, ',') + 1), ',') + 1), '') AS REAL) AS r3,
              COALESCE(CAST(NULLIF((SELECT value FROM config WHERE key = 'auction_tax_rate'), '') AS REAL), 0.5) AS auction
       FROM (SELECT COALESCE((SELECT value FROM config WHERE key = 'tax_rates'), '0.10,0.20,0.40') AS v)) AS r) AS d) AS dd
          GROUP BY dd.player_id) AS p), 2), 0)
          < NEW.amount;
END;

DROP TRIGGER IF EXISTS fund_holds_offer_guard;

CREATE TRIGGER fund_holds_offer_guard
BEFORE INSERT ON fund_holds
WHEN NEW.status = 'held' AND NEW.ref_type = 'offer'
BEGIN
  -- 报价必须仍处于 pending（同意/拒绝/撤回/过期后不再收新冻结；offer 不存在同样拦截）
  SELECT RAISE(ABORT, 'WHL_OFFER_REJECT_CLOSED')
  WHERE IFNULL((SELECT status FROM offers WHERE id = NEW.ref_id), '') != 'pending';

  -- 冻结额必须等于报价单当前有效报价额（防串账：还价后旧额的冻结落不进来）
  SELECT RAISE(ABORT, 'WHL_OFFER_REJECT_AMOUNT')
  WHERE NEW.amount != (SELECT amount FROM offers WHERE id = NEW.ref_id);

  -- 可用资金 = COALESCE(账户余额, 0) − 全部现行冻结 + 本人在这条报价上的现行冻结（还价顶替，净差额校验）
  --           + 预期收入额度 ≥ 冻结额
  SELECT RAISE(ABORT, 'WHL_OFFER_REJECT_FUNDS')
  WHERE COALESCE((SELECT balance FROM ledger_accounts WHERE club_id = NEW.club_id), 0)
          - (SELECT COALESCE(SUM(amount), 0) FROM fund_holds WHERE club_id = NEW.club_id AND status = 'held')
          + COALESCE(
              (SELECT amount FROM fund_holds
               WHERE club_id = NEW.club_id AND status = 'held' AND ref_type = 'offer' AND ref_id = NEW.ref_id),
              0
            )
          + COALESCE(ROUND((SELECT SUM(p.net) * MIN(MAX(CAST(COALESCE((SELECT value FROM config WHERE key = 'expected_income_rate'), '1.0') AS REAL), 0), 1) FROM (SELECT dd.player_id AS player_id,
                 MAX(dd.gross) AS gross,
                 dd.source AS source,
                 dd.ref_id AS ref_id,
                 dd.tax AS tax,
                 dd.net AS net
          FROM (SELECT d.source AS source,
             d.ref_id AS ref_id,
             d.player_id AS player_id,
             d.gross AS gross,
             d.tax AS tax,
             d.gross - d.tax AS net
      FROM (SELECT src.source AS source,
                   src.ref_id AS ref_id,
                   src.player_id AS player_id,
                   src.gross AS gross,
                   ROUND(CASE WHEN src.forced = 1
                              THEN src.gross * r.auction
                              ELSE MIN(src.gross, COALESCE(c.release_fee, 0)) * r.r1
                                   + MAX(0, MIN(src.gross, COALESCE(c.release_fee, 0) * 1.5) - COALESCE(c.release_fee, 0)) * r.r2
                                   + MAX(0, src.gross - COALESCE(c.release_fee, 0) * 1.5) * r.r3
                         END, 2) AS tax
            FROM (SELECT 'listing' AS source,
                         l.id AS ref_id,
                         l.player_id AS player_id,
                         (SELECT MAX(b.amount) FROM bids b WHERE b.listing_id = l.id AND b.status = 'active') AS gross,
                         CASE WHEN l.type = 'forced' THEN 1 ELSE 0 END AS forced
                  FROM listings l
                  WHERE l.seller_club_id = NEW.club_id
                    AND l.status IN ('listed', 'bidding')
                    AND l.type NOT IN ('activation')
                    AND EXISTS (SELECT 1 FROM bids b WHERE b.listing_id = l.id AND b.status = 'active')
                  UNION ALL
                  SELECT 'transfer' AS source,
                         t.id AS ref_id,
                         t.player_id AS player_id,
                         t.fee AS gross,
                         CASE WHEN t.type = 'forced_auction' THEN 1 ELSE 0 END AS forced
                  FROM transfers t
                  WHERE t.from_club_id = NEW.club_id
                    AND t.status IN ('pending_review', 'signing')
                    AND t.type IN ('transfer', 'activation', 'forced_auction')
                    AND t.fee IS NOT NULL) AS src
            LEFT JOIN contracts c ON c.player_id = src.player_id AND c.is_active = 1
            CROSS JOIN (SELECT CAST(NULLIF(substr(v, 1, instr(v, ',') - 1), '') AS REAL) AS r1,
              CAST(NULLIF(substr(v, instr(v, ',') + 1, instr(substr(v, instr(v, ',') + 1), ',') - 1), '') AS REAL) AS r2,
              CAST(NULLIF(substr(v, instr(v, ',') + instr(substr(v, instr(v, ',') + 1), ',') + 1), '') AS REAL) AS r3,
              COALESCE(CAST(NULLIF((SELECT value FROM config WHERE key = 'auction_tax_rate'), '') AS REAL), 0.5) AS auction
       FROM (SELECT COALESCE((SELECT value FROM config WHERE key = 'tax_rates'), '0.10,0.20,0.40') AS v)) AS r) AS d) AS dd
          GROUP BY dd.player_id) AS p), 2), 0)
          < NEW.amount;
END;

DROP TRIGGER IF EXISTS fund_holds_sea_sealed_guard;

CREATE TRIGGER fund_holds_sea_sealed_guard
BEFORE INSERT ON fund_holds
WHEN NEW.status = 'held' AND NEW.ref_type = 'sea_sealed'
BEGIN
  -- 只有还收着标的批次能冻结（开标/作废后一律拒绝）；批次或标不存在同样拦截（IFNULL 包死 NULL 放行）
  SELECT RAISE(ABORT, 'WHL_SEA_REJECT_CLOSED')
  WHERE IFNULL(
          (SELECT b.status FROM sea_batches b JOIN sea_sealed_bids s ON s.batch_id = b.id WHERE s.id = NEW.ref_id),
          ''
        ) != 'sealed';

  -- 冻结额必须 = 新违约金 × 30%（= 签入费，与 core/bypass-rules.ts 的 freeAgentFee 同口径）
  -- 标不存在时原式比较得 NULL 会放行（旧版 fail-open），IFNULL 兜到 -1 恒不相等
  SELECT RAISE(ABORT, 'WHL_SEA_REJECT_AMOUNT')
  WHERE NEW.amount != IFNULL(ROUND((SELECT new_release_fee FROM sea_sealed_bids WHERE id = NEW.ref_id) * 0.3, 2), -1);

  -- 可用资金 = COALESCE(账户余额, 0) − 全部现行冻结 + 本标已有冻结的加回 + 预期收入额度 ≥ 本次冻结额
  SELECT RAISE(ABORT, 'WHL_SEA_REJECT_FUNDS')
  WHERE COALESCE((SELECT balance FROM ledger_accounts WHERE club_id = NEW.club_id), 0)
          - (SELECT COALESCE(SUM(amount), 0) FROM fund_holds WHERE club_id = NEW.club_id AND status = 'held')
          + COALESCE(
              (SELECT amount FROM fund_holds
               WHERE club_id = NEW.club_id AND status = 'held' AND ref_type = 'sea_sealed' AND ref_id = NEW.ref_id),
              0
            )
          + COALESCE(ROUND((SELECT SUM(p.net) * MIN(MAX(CAST(COALESCE((SELECT value FROM config WHERE key = 'expected_income_rate'), '1.0') AS REAL), 0), 1) FROM (SELECT dd.player_id AS player_id,
                 MAX(dd.gross) AS gross,
                 dd.source AS source,
                 dd.ref_id AS ref_id,
                 dd.tax AS tax,
                 dd.net AS net
          FROM (SELECT d.source AS source,
             d.ref_id AS ref_id,
             d.player_id AS player_id,
             d.gross AS gross,
             d.tax AS tax,
             d.gross - d.tax AS net
      FROM (SELECT src.source AS source,
                   src.ref_id AS ref_id,
                   src.player_id AS player_id,
                   src.gross AS gross,
                   ROUND(CASE WHEN src.forced = 1
                              THEN src.gross * r.auction
                              ELSE MIN(src.gross, COALESCE(c.release_fee, 0)) * r.r1
                                   + MAX(0, MIN(src.gross, COALESCE(c.release_fee, 0) * 1.5) - COALESCE(c.release_fee, 0)) * r.r2
                                   + MAX(0, src.gross - COALESCE(c.release_fee, 0) * 1.5) * r.r3
                         END, 2) AS tax
            FROM (SELECT 'listing' AS source,
                         l.id AS ref_id,
                         l.player_id AS player_id,
                         (SELECT MAX(b.amount) FROM bids b WHERE b.listing_id = l.id AND b.status = 'active') AS gross,
                         CASE WHEN l.type = 'forced' THEN 1 ELSE 0 END AS forced
                  FROM listings l
                  WHERE l.seller_club_id = NEW.club_id
                    AND l.status IN ('listed', 'bidding')
                    AND l.type NOT IN ('activation')
                    AND EXISTS (SELECT 1 FROM bids b WHERE b.listing_id = l.id AND b.status = 'active')
                  UNION ALL
                  SELECT 'transfer' AS source,
                         t.id AS ref_id,
                         t.player_id AS player_id,
                         t.fee AS gross,
                         CASE WHEN t.type = 'forced_auction' THEN 1 ELSE 0 END AS forced
                  FROM transfers t
                  WHERE t.from_club_id = NEW.club_id
                    AND t.status IN ('pending_review', 'signing')
                    AND t.type IN ('transfer', 'activation', 'forced_auction')
                    AND t.fee IS NOT NULL) AS src
            LEFT JOIN contracts c ON c.player_id = src.player_id AND c.is_active = 1
            CROSS JOIN (SELECT CAST(NULLIF(substr(v, 1, instr(v, ',') - 1), '') AS REAL) AS r1,
              CAST(NULLIF(substr(v, instr(v, ',') + 1, instr(substr(v, instr(v, ',') + 1), ',') - 1), '') AS REAL) AS r2,
              CAST(NULLIF(substr(v, instr(v, ',') + instr(substr(v, instr(v, ',') + 1), ',') + 1), '') AS REAL) AS r3,
              COALESCE(CAST(NULLIF((SELECT value FROM config WHERE key = 'auction_tax_rate'), '') AS REAL), 0.5) AS auction
       FROM (SELECT COALESCE((SELECT value FROM config WHERE key = 'tax_rates'), '0.10,0.20,0.40') AS v)) AS r) AS d) AS dd
          GROUP BY dd.player_id) AS p), 2), 0)
          < NEW.amount;
END;
