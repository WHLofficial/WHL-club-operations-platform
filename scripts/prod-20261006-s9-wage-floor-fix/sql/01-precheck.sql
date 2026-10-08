-- 01 预检（只读）：A–I 九段，逐段核对后再跑正向件
-- 抓取：node capture-snapshot.mjs（默认 --remote，只跑 SELECT）

-- A · 三条工资行现状：amount 应为 −49.23 / −37.62 / −33.37、memo 尾为「 人现行合同）」
SELECT club_id, id, ROUND(amount, 2) AS amount, balance_after, memo, created_at
FROM ledger_entries
WHERE kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND club_id IN (5, 280, 449)
ORDER BY club_id;

-- B · 三队账户余额与最新一条流水：invariant 必须全为 consistent（③ 对账语句的不变式前提）
SELECT a.club_id,
       ROUND(a.balance, 2) AS account_balance,
       a.updated_at,
       (SELECT e.id FROM ledger_entries e WHERE e.club_id = a.club_id ORDER BY e.id DESC LIMIT 1) AS tail_id,
       (SELECT ROUND(e.balance_after, 2) FROM ledger_entries e WHERE e.club_id = a.club_id ORDER BY e.id DESC LIMIT 1) AS tail_balance,
       CASE WHEN ROUND(a.balance, 2) = ROUND((SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = a.club_id ORDER BY e.id DESC LIMIT 1), 2) THEN 'consistent' ELSE 'DRIFT' END AS invariant
FROM ledger_accounts a
WHERE a.club_id IN (5, 280, 449)
ORDER BY a.club_id;

-- C · 工资行之后的流水（本批要顺移 balance_after 的行）：生产实况 7 行（club 5 一行 id 277、club 449 六行 id 245–254）——旧版以为 0 行
SELECT e.club_id, e.id, e.kind, ROUND(e.amount, 2) AS amount, e.balance_after, e.created_at
FROM ledger_entries e
WHERE e.club_id IN (5, 280, 449)
  AND e.id BETWEEN (SELECT w.id + 1 FROM ledger_entries w WHERE w.club_id = e.club_id AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = 901) AND 2147483647
ORDER BY e.club_id, e.id;

-- D · Σ 现行合同工资与人数（触底判据）：期望 5→49.23/31 人、280→37.62/30 人、449→33.37/25 人
SELECT ct.club_id, c.name, ROUND(SUM(ct.wage), 2) AS wage_sum, COUNT(*) AS n
FROM contracts ct JOIN clubs c ON c.id = ct.club_id
WHERE ct.is_active = 1 AND ct.club_id IS NOT NULL AND ct.wage IS NOT NULL AND ct.club_id IN (5, 280, 449)
GROUP BY ct.club_id, c.name
ORDER BY ct.club_id;

-- E · CPU 旗标：5 / 280 / 449 必须 is_cpu = 0；241 / 112172 现为 0 是**正确的**（2026-10-06 04:43 起被真人接队，见 H 段的「接队资金」行）
SELECT id, name, is_cpu FROM clubs WHERE id IN (5, 241, 280, 449, 112172) ORDER BY id;

-- F · 级别证据：S9 定级赛事（league_premier / league_second）——5/449 顶级、280 次级
SELECT id, season, tournament_id, competition_type
FROM season_tournaments
WHERE season = 9 AND competition_type IN ('league_premier', 'league_second')
ORDER BY competition_type;

-- G · 已修检测：三队期望 0 行（>0 说明触底件已跑过，先看 03-verify.sql 再决定）
SELECT club_id, ROUND(amount, 2) AS amount, memo
FROM ledger_entries
WHERE kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND club_id IN (5, 280, 449)
  AND instr(memo, '，按下限扣）') != 0
ORDER BY club_id;

-- H · CPU 期工资冲正目标（04 件）：241 / 112172 的工资行 + 之后全部流水（含「接队资金」「CPU 期补发」）+ 账户
SELECT e.club_id, e.id, e.kind, ROUND(e.amount, 2) AS amount, ROUND(e.balance_after, 2) AS bal, e.created_at, e.memo
FROM ledger_entries e
WHERE e.club_id IN (241, 112172)
ORDER BY e.club_id, e.id;

-- I · 链相连诊断（正向 ① 的守卫依据）：下一条本队流水是否与工资行首尾相接——linked / broken / no-downstream（工资行是末行）三态，跑前 5/280/449 应为 linked（生产事故后 5 与 449 曾为 broken），顺移后仍全 linked
SELECT c.id AS club_id, c.name,
  (SELECT w.id FROM ledger_entries w WHERE w.club_id = c.id AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = 901) AS wage_id,
  (SELECT MIN(m.id) FROM ledger_entries m WHERE m.club_id = c.id AND m.id BETWEEN (SELECT w.id + 1 FROM ledger_entries w WHERE w.club_id = c.id AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = 901) AND 2147483647) AS next_id,
  (SELECT x.balance_after FROM ledger_entries x WHERE x.club_id = c.id AND x.kind = 'wage' AND x.ref_type = 'window' AND x.ref_id = 901) AS wage_bal,
  (SELECT n.balance_after FROM ledger_entries n WHERE n.club_id = c.id AND n.id = (SELECT MIN(m.id) FROM ledger_entries m WHERE m.club_id = c.id AND m.id BETWEEN (SELECT w.id + 1 FROM ledger_entries w WHERE w.club_id = c.id AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = 901) AND 2147483647)) AS next_bal,
  CASE WHEN (SELECT MIN(m.id) FROM ledger_entries m WHERE m.club_id = c.id AND m.id BETWEEN (SELECT w.id + 1 FROM ledger_entries w WHERE w.club_id = c.id AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = 901) AND 2147483647) IS NULL THEN 'no-downstream' WHEN ROUND((SELECT n.balance_after FROM ledger_entries n WHERE n.club_id = c.id AND n.id = (SELECT MIN(m.id) FROM ledger_entries m WHERE m.club_id = c.id AND m.id BETWEEN (SELECT w.id + 1 FROM ledger_entries w WHERE w.club_id = c.id AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = 901) AND 2147483647)), 2) = ROUND((SELECT x.balance_after FROM ledger_entries x WHERE x.club_id = c.id AND x.kind = 'wage' AND x.ref_type = 'window' AND x.ref_id = 901) + (SELECT n.amount FROM ledger_entries n WHERE n.club_id = c.id AND n.id = (SELECT MIN(m.id) FROM ledger_entries m WHERE m.club_id = c.id AND m.id BETWEEN (SELECT w.id + 1 FROM ledger_entries w WHERE w.club_id = c.id AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = 901) AND 2147483647)), 2) THEN 'linked' ELSE 'broken' END AS chain
FROM clubs c WHERE c.id IN (5, 280, 449, 241, 112172) ORDER BY c.id;
