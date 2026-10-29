-- 0083 · 消费券存量搬运：stadiums.build_credit → ledger_accounts.vouchers（v6.58.0）
--
-- 幂等设计（可整文件重放，也扛「中途崩」的半完成态）：
--   ① 先给有券的俱乐部补账户行（vouchers 从 0 起）；
--   ② 插 kind='migrate' 流水，闸 = 同 (club, kind, ref_type='stadium', ref_id=club) 无既有行；
--   ③ 账户券余额**按流水重算**（不是增量加），所以 ②③ 之间崩溃后重放也不会重复入账；
--   ④ 清零 build_credit 存量（列保留弃用）。
-- 重放安全：第二次执行时 stadium 存量已是 0、migrate 行已存在，全部空转；
--   ③ 的重算在同一不变量下得同值（vouchers == SUM(voucher_entries.amount)）。
INSERT OR IGNORE INTO ledger_accounts (club_id, balance, vouchers, updated_at)
  SELECT s.club_id, 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM stadiums s
  WHERE ROUND(s.build_credit, 2) != 0;

-- 金额统一 ROUND 到分：build_credit 是 REAL，历史累加可能带尾差（如 0.30000000000000004），
-- 搬进券账后余额必须与流水两位小数一致，否则之后任何等值/展示校验都对不上。
INSERT INTO voucher_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
  SELECT s.club_id,
         'migrate',
         ROUND(s.build_credit, 2),
         ROUND(COALESCE((SELECT a.vouchers FROM ledger_accounts a WHERE a.club_id = s.club_id), 0), 2) + ROUND(s.build_credit, 2),
         'stadium',
         s.club_id,
         '建设券存量迁移为消费券',
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM stadiums s
  WHERE ROUND(s.build_credit, 2) != 0
    AND NOT EXISTS (
      SELECT 1 FROM voucher_entries v
      WHERE v.club_id = s.club_id AND v.kind = 'migrate' AND v.ref_type = 'stadium' AND v.ref_id = s.club_id
    );

UPDATE ledger_accounts
  SET vouchers = ROUND(COALESCE((SELECT SUM(v.amount) FROM voucher_entries v WHERE v.club_id = ledger_accounts.club_id), 0), 2),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE EXISTS (
    SELECT 1 FROM voucher_entries v
    WHERE v.club_id = ledger_accounts.club_id AND v.kind = 'migrate' AND v.ref_type = 'stadium' AND v.ref_id = ledger_accounts.club_id
  );

UPDATE stadiums SET build_credit = 0 WHERE build_credit != 0;
