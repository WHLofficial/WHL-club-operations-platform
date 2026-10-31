-- 0087 · 被激活挂牌的在途收入纳入预期收入（v6.64.0，grilling Q1-Q4 裁决定案）
--
-- 缘起：0081 的额度公式在 listings 侧用 `type NOT IN ('activation')` 把激活挂牌整体排除，
-- 于是「被激活挂牌」（规则 4.4.2：激活动作 INSERT 一条 type='activation' 挂牌，activated_by=激活方、
-- ask_price=激活费、5 分钟首价窗）从被激活到落价成 transfer 单之间的在途收入不计。
-- 注：0081 时代注释「激活是签入方掏钱不产生卖方收入」是错的——激活挂牌的 seller_club_id 是
-- 球员现属队、成交后收钱（源② transfers type='activation' 一直计卖方收入）。
--
-- 本迁移与 0081 的唯一公式差异 = listings 侧新增源③：
--     源③ 被激活挂牌 type='activation' 且 activated_by 非空（激活动作必带值）、仍在 listed/bidding
--          → gross = MAX(最高 active 出价, ask_price)。激活价是激活方已提交申请的保底收入
--          （作废占一窗一次额度、激活前查过资金门槛）；激活作废（窗内未落价 → delisted）或
--          落价进 matched_pending 后本源退出，transfers 源②接管，额度随实时公式收缩。
-- 源①（非 activation 挂牌 + active 出价）与源②（transfers 成交类）逐字不动；k / 分段税 /
-- 钳制式 / IFNULL 包死闸位全部与 0081 逐字同。同源由 tests/expected-income.test.ts 的
-- 文本锁（creditLineSql('NEW.club_id') 在本文件出现 3 次）+ 行为锁兜住。
--
-- 部署核查：零数据写入、零表结构变更（只 DROP + CREATE 触发器），秒级完成；先 apply 再 push。
-- 回滚：重放 0081_expected_income_credit_line.sql（DROP + 原 CREATE，无数据副作用）。
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
                  SELECT 'listing' AS source,
                         l.id AS ref_id,
                         l.player_id AS player_id,
                         MAX(COALESCE((SELECT MAX(b.amount) FROM bids b WHERE b.listing_id = l.id AND b.status = 'active'), 0), l.ask_price) AS gross,
                         0 AS forced
                  FROM listings l
                  WHERE l.seller_club_id = NEW.club_id
                    AND l.type = 'activation'
                    AND l.activated_by IS NOT NULL
                    AND l.status IN ('listed', 'bidding')
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
                  SELECT 'listing' AS source,
                         l.id AS ref_id,
                         l.player_id AS player_id,
                         MAX(COALESCE((SELECT MAX(b.amount) FROM bids b WHERE b.listing_id = l.id AND b.status = 'active'), 0), l.ask_price) AS gross,
                         0 AS forced
                  FROM listings l
                  WHERE l.seller_club_id = NEW.club_id
                    AND l.type = 'activation'
                    AND l.activated_by IS NOT NULL
                    AND l.status IN ('listed', 'bidding')
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
                  SELECT 'listing' AS source,
                         l.id AS ref_id,
                         l.player_id AS player_id,
                         MAX(COALESCE((SELECT MAX(b.amount) FROM bids b WHERE b.listing_id = l.id AND b.status = 'active'), 0), l.ask_price) AS gross,
                         0 AS forced
                  FROM listings l
                  WHERE l.seller_club_id = NEW.club_id
                    AND l.type = 'activation'
                    AND l.activated_by IS NOT NULL
                    AND l.status IN ('listed', 'bidding')
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
