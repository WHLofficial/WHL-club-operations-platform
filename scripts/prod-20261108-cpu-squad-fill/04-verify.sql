-- 04-verify.sql · 只读复核(01–03 执行后跑)
-- 预期:V1 米兰 25 人/GK 3、曼城 26 人/GK 2;V2 签入 24 人全 normal 且归属正确;
--       V3 解约 5 人全 free、club NULL、CA=base_ca;V4 两队现行合同仍 0 行(CPU 队无合同口径);
--       V5 标记档:米兰 ge87=1/growth=1、曼城 ge87=1/growth=2;V6 审计 release 5 + sign 24。

-- V1 两队注册规模与门将数(限 20–30、GK≥2)
SELECT c.name, COUNT(*) n, SUM(CASE WHEN p.position='GK' THEN 1 ELSE 0 END) gk
FROM players p JOIN clubs c ON c.id = p.club_id
WHERE p.club_id IN (10, 131681) AND p.status IN ('normal','listed')
GROUP BY p.club_id;

-- V2 签入 24 人核对(预期:131681=14、10=10,全 status='normal')
SELECT club_id, status, COUNT(*) n FROM players
WHERE id IN (70,95,144,154,166,183,240,256,272,291,341,452,494,579,
             38,110,137,149,161,206,284,465,756,1335)
GROUP BY club_id, status;

-- V3 解约 5 人核对(预期:全 free、club_id NULL、ca=base_ca)
SELECT id, display_name, status, club_id, ca, base_ca
FROM players WHERE id IN (13232, 9443, 1791, 9390, 1238) ORDER BY id;

-- V4 CPU 队无合同口径核对(预期 0 行:两支 CPU 队任何 is_active=1 的合同)
SELECT club_id, COUNT(*) contracts FROM contracts
WHERE club_id IN (10, 131681) AND is_active = 1 GROUP BY club_id;

-- V5 标记档终态(预期:米兰 ge87=1(Maignan)/growth=1(Vermeeren);曼城 ge87=1(Bruno)/growth=2(Svilar+Ordoñez))
SELECT club_id,
  SUM(CASE WHEN base_ca >= 87 THEN 1 ELSE 0 END) ge87,
  SUM(CASE WHEN ca < 87 AND pa >= 87 AND growable = 1 THEN 1 ELSE 0 END) growth_pa87
FROM players WHERE club_id IN (10, 131681) AND status IN ('normal','listed')
GROUP BY club_id;

-- V6 审计行数(预期:release 5、sign 24)
SELECT action, COUNT(*) n FROM audit_log
WHERE action LIKE 'cpu_squad_fill%' GROUP BY action;

-- V7 无越权落点(预期 0 行:任何一名签入球员落在 10/131681 之外,或解约者仍有归属)
SELECT id, club_id, status FROM players
WHERE (id IN (70,95,144,154,166,183,240,256,272,291,341,452,494,579,
              38,110,137,149,161,206,284,465,756,1335)
        AND (status <> 'normal' OR club_id NOT IN (10,131681)))
   OR (id IN (13232,9443,1791,9390,1238)
        AND (status <> 'free' OR club_id IS NOT NULL));
