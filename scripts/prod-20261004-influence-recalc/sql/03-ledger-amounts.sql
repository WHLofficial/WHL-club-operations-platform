-- 03 ledger_entries：比赛收入流水「重记替换」（金额/memo/balance_after；不冲销、不新增行）
-- 由 scripts/prod-20261004-influence-recalc/recalc.mjs plan 生成（2026-10-04T11:24:12.425Z）
-- 口径真源：src/worker/home.ts（v6.28.0）；重演随机项取区间中点、天气取库中已记录值
-- 本文件不自动执行：apply 默认只打印，需要显式 --yes

-- #70 club 1 比赛 #167：金额 1.25 → 1.31；余额 7.05 → 7.109999999999999
UPDATE ledger_entries SET amount = 1.31, memo = '比赛日收入（比赛 #167，上座 8727/12000，晴；票 1.31/商 0/播 0）', balance_after = 7.109999999999999 WHERE id = 70 AND club_id = 1 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 167;
-- #103 club 1 比赛 #178：金额 0.67 → 0.78；余额 17.32 → 17.490000000000002
UPDATE ledger_entries SET amount = 0.78, memo = '比赛日收入（比赛 #178，上座 5205/12000，雨；票 0.78/商 0/播 0）', balance_after = 17.490000000000002 WHERE id = 103 AND club_id = 1 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 178;
-- #143 club 1 比赛 #15：金额 0.73 → 0.79；余额 20.95 → 21.18
UPDATE ledger_entries SET amount = 0.79, memo = '比赛日收入（比赛 #15，上座 5299/12000，雨；票 0.79/商 0/播 0）', balance_after = 21.18 WHERE id = 143 AND club_id = 1 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 15;
-- #172 club 1 比赛 #186：金额 0.91 → 1.06；余额 24.759999999999998 → 25.139999999999997
UPDATE ledger_entries SET amount = 1.06, memo = '比赛日收入（比赛 #186，上座 7037/12000，晴；票 1.06/商 0/播 0）', balance_after = 25.139999999999997 WHERE id = 172 AND club_id = 1 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 186;
-- #30 club 2 比赛 #164：金额 0.92 → 0.95；余额 7.62 → 7.65
UPDATE ledger_entries SET amount = 0.95, memo = '比赛日收入（比赛 #164，上座 6303/12000，雨；票 0.95/商 0/播 0）', balance_after = 7.65 WHERE id = 30 AND club_id = 2 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 164;
-- #63 club 2 比赛 #172：金额 0.99 → 1.29；余额 14.41 → 14.740000000000002
UPDATE ledger_entries SET amount = 1.29, memo = '比赛日收入（比赛 #172，上座 8575/12000，多云；票 1.29/商 0/播 0）', balance_after = 14.740000000000002 WHERE id = 63 AND club_id = 2 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 172;
-- #136 club 2 比赛 #179：金额 0.72 → 1.04；余额 24.729999999999997 → 25.38
UPDATE ledger_entries SET amount = 1.04, memo = '比赛日收入（比赛 #179，上座 6921/12000，多云；票 1.04/商 0/播 0）', balance_after = 25.38 WHERE id = 136 AND club_id = 2 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 179;
-- #203 club 2 比赛 #22：金额 1.52 → 1.79；余额 32.949999999999996 → 33.87
UPDATE ledger_entries SET amount = 1.79, memo = '比赛日收入（比赛 #22，上座 11904/12000，晴；票 1.79/商 0/播 0）', balance_after = 33.87 WHERE id = 203 AND club_id = 2 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 22;
-- #3 club 5 比赛 #33：金额 1.33 → 1.43；余额 9.83 → 9.93
UPDATE ledger_entries SET amount = 1.43, memo = '比赛日收入（比赛 #33，上座 9554/22000，雨；票 1.43/商 0/播 0）', balance_after = 9.93 WHERE id = 3 AND club_id = 5 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 33;
-- #12 club 5 比赛 #52：金额 1.75 → 2.35；余额 18.18 → 18.880000000000003
UPDATE ledger_entries SET amount = 2.35, memo = '比赛日收入（比赛 #52，上座 15668/22000，晴；票 2.35/商 0/播 0）', balance_after = 18.880000000000003 WHERE id = 12 AND club_id = 5 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 52;
-- #21 club 5 比赛 #41：金额 1.32 → 1.96；余额 28 → 29.340000000000003
UPDATE ledger_entries SET amount = 1.96, memo = '比赛日收入（比赛 #41，上座 13068/22000，雨；票 1.96/商 0/播 0）', balance_after = 29.340000000000003 WHERE id = 21 AND club_id = 5 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 41;
-- #157 club 5 比赛 #62：金额 1.56 → 2.46；余额 51.260000000000005 → 53.50000000000001
UPDATE ledger_entries SET amount = 2.46, memo = '比赛日收入（比赛 #62，上座 16374/22000，多云；票 2.46/商 0/播 0）', balance_after = 53.50000000000001 WHERE id = 157 AND club_id = 5 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 62;
-- #202 club 5 比赛 #30：金额 1.43 → 2.57；余额 64.39000000000001 → 67.77000000000001
UPDATE ledger_entries SET amount = 2.57, memo = '比赛日收入（比赛 #30，上座 17112/22000，多云；票 2.57/商 0/播 0）', balance_after = 67.77000000000001 WHERE id = 202 AND club_id = 5 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 30;
-- #6 club 9 比赛 #36：金额 1.61 → 1.63；余额 8.209999999999999 → 8.23
UPDATE ledger_entries SET amount = 1.63, memo = '比赛日收入（比赛 #36，上座 10834/35000，多云；票 1.63/商 0/播 0）', balance_after = 8.23 WHERE id = 6 AND club_id = 9 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 36;
-- #56 club 9 比赛 #43：金额 1.68 → 2.09；余额 23.09 → 23.52
UPDATE ledger_entries SET amount = 2.09, memo = '比赛日收入（比赛 #43，上座 13938/35000，多云；票 2.09/商 0/播 0）', balance_after = 23.52 WHERE id = 56 AND club_id = 9 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 43;
-- #96 club 9 比赛 #3：金额 2.01 → 2.95；余额 32.1 → 33.47
UPDATE ledger_entries SET amount = 2.95, memo = '比赛日收入（比赛 #3，上座 19682/35000，晴；票 2.95/商 0/播 0）', balance_after = 33.47 WHERE id = 96 AND club_id = 9 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 3;
-- #133 club 9 比赛 #56：金额 2.02 → 3.66；余额 51.120000000000005 → 54.129999999999995
UPDATE ledger_entries SET amount = 3.66, memo = '比赛日收入（比赛 #56，上座 24419/35000，多云；票 3.66/商 0/播 0）', balance_after = 54.129999999999995 WHERE id = 133 AND club_id = 9 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 56;
-- #191 club 9 比赛 #71：金额 1.74 → 3.86；余额 62.26000000000001 → 67.39
UPDATE ledger_entries SET amount = 3.86, memo = '比赛日收入（比赛 #71，上座 25762/35000，晴；票 3.86/商 0/播 0）', balance_after = 67.39 WHERE id = 191 AND club_id = 9 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 71;
-- #210 club 9 比赛 #23：金额 1.06 → 2.61；余额 63.320000000000014 → 70
UPDATE ledger_entries SET amount = 2.61, memo = '比赛日收入（比赛 #23，上座 17377/35000，多云；票 2.61/商 0/播 0）', balance_after = 70 WHERE id = 210 AND club_id = 9 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 23;
-- #15 club 11 比赛 #49：金额 1.21 → 1.3；余额 16.31 → 16.4
UPDATE ledger_entries SET amount = 1.3, memo = '比赛日收入（比赛 #49，上座 8658/22000，雪；票 1.3/商 0/播 0）', balance_after = 16.4 WHERE id = 15 AND club_id = 11 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 49;
-- #39 club 11 比赛 #39：金额 1.44 → 2.08；余额 26.25 → 26.979999999999997
UPDATE ledger_entries SET amount = 2.08, memo = '比赛日收入（比赛 #39，上座 13855/22000，多云；票 2.08/商 0/播 0）', balance_after = 26.979999999999997 WHERE id = 39 AND club_id = 11 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 39;
-- #84 club 11 比赛 #10：金额 2.3 → 3.27；余额 37.05 → 38.75
UPDATE ledger_entries SET amount = 3.27, memo = '比赛日收入（比赛 #10，上座 21824/22000，晴；票 3.27/商 0/播 0）', balance_after = 38.75 WHERE id = 84 AND club_id = 11 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 10;
-- #124 club 11 比赛 #58：金额 1.88 → 3.27；余额 45.53 → 48.620000000000005
UPDATE ledger_entries SET amount = 3.27, memo = '比赛日收入（比赛 #58，上座 21824/22000，多云；票 3.27/商 0/播 0）', balance_after = 48.620000000000005 WHERE id = 124 AND club_id = 11 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 58;
-- #140 club 11 比赛 #20：金额 1.61 → 3.27；余额 54.14 → 58.89000000000001
UPDATE ledger_entries SET amount = 3.27, memo = '比赛日收入（比赛 #20，上座 21824/22000，多云；票 3.27/商 0/播 0）', balance_after = 58.89000000000001 WHERE id = 140 AND club_id = 11 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 20;
-- #185 club 11 比赛 #68：金额 1.19 → 2.99；余额 68.53 → 75.08
UPDATE ledger_entries SET amount = 2.99, memo = '比赛日收入（比赛 #68，上座 19934/22000，雪；票 2.99/商 0/播 0）', balance_after = 75.08 WHERE id = 185 AND club_id = 11 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 68;
-- #59 club 13 比赛 #47：金额 0.86 → 0.88；余额 22.56 → 22.58
UPDATE ledger_entries SET amount = 0.88, memo = '比赛日收入（比赛 #47，上座 5860/12000，雪；票 0.88/商 0/播 0）', balance_after = 22.58 WHERE id = 59 AND club_id = 13 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 47;
-- #92 club 13 比赛 #4：金额 1.43 → 1.71；余额 23.99 → 24.29
UPDATE ledger_entries SET amount = 1.71, memo = '比赛日收入（比赛 #4，上座 11423/12000，晴；票 1.71/商 0/播 0）', balance_after = 24.29 WHERE id = 92 AND club_id = 13 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 4;
-- #112 club 13 比赛 #54：金额 1.07 → 1.45；余额 33.559999999999995 → 34.24
UPDATE ledger_entries SET amount = 1.45, memo = '比赛日收入（比赛 #54，上座 9699/12000，多云；票 1.45/商 0/播 0）', balance_after = 34.24 WHERE id = 112 AND club_id = 13 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 54;
-- #159 club 13 比赛 #14：金额 1.05 → 1.63；余额 46.309999999999995 → 47.57000000000001
UPDATE ledger_entries SET amount = 1.63, memo = '比赛日收入（比赛 #14，上座 10843/12000，多云；票 1.63/商 0/播 0）', balance_after = 47.57000000000001 WHERE id = 159 AND club_id = 13 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 14;
-- #162 club 13 比赛 #66：金额 1.47 → 1.79；余额 54.379999999999995 → 55.96000000000001
UPDATE ledger_entries SET amount = 1.79, memo = '比赛日收入（比赛 #66，上座 11904/12000，晴；票 1.79/商 0/播 0）', balance_after = 55.96000000000001 WHERE id = 162 AND club_id = 13 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 66;
-- #67 club 14 比赛 #170：金额 1.14 → 1.3；余额 6.9399999999999995 → 7.1
UPDATE ledger_entries SET amount = 1.3, memo = '比赛日收入（比赛 #170，上座 8636/12000，晴；票 1.3/商 0/播 0）', balance_after = 7.1 WHERE id = 67 AND club_id = 14 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 170;
-- #75 club 14 比赛 #173：金额 1.04 → 1.21；余额 14.68 → 15.010000000000002
UPDATE ledger_entries SET amount = 1.21, memo = '比赛日收入（比赛 #173，上座 8091/12000，多云；票 1.21/商 0/播 0）', balance_after = 15.010000000000002 WHERE id = 75 AND club_id = 14 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 173;
-- #115 club 14 比赛 #181：金额 0.98 → 1.27；余额 30.36 → 30.98
UPDATE ledger_entries SET amount = 1.27, memo = '比赛日收入（比赛 #181，上座 8465/12000，雨；票 1.27/商 0/播 0）', balance_after = 30.98 WHERE id = 115 AND club_id = 14 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 181;
-- #146 club 14 比赛 #17：金额 1.07 → 1.46；余额 38.43 → 39.440000000000005
UPDATE ledger_entries SET amount = 1.46, memo = '比赛日收入（比赛 #17，上座 9760/12000，多云；票 1.46/商 0/播 0）', balance_after = 39.440000000000005 WHERE id = 146 AND club_id = 14 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 17;
-- #32 club 21 比赛 #165：金额 1.83 → 1.9；余额 8.530000000000001 → 8.6
UPDATE ledger_entries SET amount = 1.9, memo = '比赛日收入（比赛 #165，上座 12699/35000，晴；票 1.9/商 0/播 0）', balance_after = 8.6 WHERE id = 32 AND club_id = 21 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 165;
-- #130 club 21 比赛 #180：金额 1.38 → 1.56；余额 27.21 → 27.46
UPDATE ledger_entries SET amount = 1.56, memo = '比赛日收入（比赛 #180，上座 10410/35000，多云；票 1.56/商 0/播 0）', balance_after = 27.46 WHERE id = 130 AND club_id = 21 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 180;
-- #188 club 21 比赛 #184：金额 1.3 → 1.69；余额 31.41 → 32.05
UPDATE ledger_entries SET amount = 1.69, memo = '比赛日收入（比赛 #184，上座 11274/35000，雨；票 1.69/商 0/播 0）', balance_after = 32.05 WHERE id = 188 AND club_id = 21 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 184;
-- #205 club 21 比赛 #26：金额 1.52 → 2.2；余额 32.93 → 34.25
UPDATE ledger_entries SET amount = 2.2, memo = '比赛日收入（比赛 #26，上座 14687/35000，晴；票 2.2/商 0/播 0）', balance_after = 34.25 WHERE id = 205 AND club_id = 21 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 26;
-- #36 club 33 比赛 #40：金额 1.06 → 1.17；余额 18.06 → 18.17
UPDATE ledger_entries SET amount = 1.17, memo = '比赛日收入（比赛 #40，上座 7789/12000，多���；票 1.17/商 0/播 0）', balance_after = 18.17 WHERE id = 36 AND club_id = 33 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 40;
-- #88 club 33 比赛 #5：金额 1.23 → 1.59；余额 32.88999999999999 → 33.36000000000001
UPDATE ledger_entries SET amount = 1.59, memo = '比赛日收入（比赛 #5，上座 10600/12000，多云；票 1.59/商 0/播 0）', balance_after = 33.36000000000001 WHERE id = 88 AND club_id = 33 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 5;
-- #100 club 33 比赛 #53：金额 1.52 → 1.79；余额 42.91 → 43.650000000000006
UPDATE ledger_entries SET amount = 1.79, memo = '比赛日收入（比赛 #53，上座 11904/12000，晴；票 1.79/商 0/播 0）', balance_after = 43.650000000000006 WHERE id = 100 AND club_id = 33 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 53;
-- #166 club 33 比赛 #64：金额 1.25 → 1.79；余额 62.46 → 63.74000000000001
UPDATE ledger_entries SET amount = 1.79, memo = '比赛日收入（比赛 #64，上座 11904/12000，多云；票 1.79/商 0/播 0）', balance_after = 63.74000000000001 WHERE id = 166 AND club_id = 33 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 64;
-- #182 club 33 比赛 #69：金额 0.99 → 1.79；余额 71.95 → 74.03000000000002
UPDATE ledger_entries SET amount = 1.79, memo = '比赛日收入（比赛 #69，上座 11904/12000，雨；票 1.79/商 0/播 0）', balance_after = 74.03000000000002 WHERE id = 182 AND club_id = 33 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 69;
-- #200 club 33 比赛 #25：金额 1.04 → 1.79；余额 79.99000000000001 → 82.82000000000002
UPDATE ledger_entries SET amount = 1.79, memo = '比赛日收入（比赛 #25，上座 11904/12000，雨；票 1.79/商 0/播 0）', balance_after = 82.82000000000002 WHERE id = 200 AND club_id = 33 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 25;
-- #9 club 45 比赛 #32：金额 1.98 → 1.97；余额 10.48 → 10.47
UPDATE ledger_entries SET amount = 1.97, memo = '比赛日收入（比赛 #32，上座 13157/35000，晴；票 1.97/商 0/播 0）', balance_after = 10.47 WHERE id = 9 AND club_id = 45 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 32;
-- #53 club 45 比赛 #46：金额 1.4 → 1.73；余额 29.779999999999994 → 30.099999999999998
UPDATE ledger_entries SET amount = 1.73, memo = '比赛日收入（比赛 #46，上座 11532/35000，雨；票 1.73/商 0/播 0）', balance_after = 30.099999999999998 WHERE id = 53 AND club_id = 45 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 46;
-- #127 club 45 比赛 #55：金额 1.61 → 2.27；余额 46.88999999999999 → 47.87
UPDATE ledger_entries SET amount = 2.27, memo = '比赛日收入（比赛 #55，上座 15123/35000，多云；票 2.27/商 0/播 0）', balance_after = 47.87 WHERE id = 127 AND club_id = 45 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 55;
-- #174 club 45 比赛 #70：金额 1.85 → 2.6；余额 61.94 → 63.67
UPDATE ledger_entries SET amount = 2.6, memo = '比赛日收入（比赛 #70，上座 17341/35000，多云；票 2.6/商 0/播 0）', balance_after = 63.67 WHERE id = 174 AND club_id = 45 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 70;
-- #198 club 45 比赛 #28：金额 1.45 → 2.58；余额 63.39 → 66.25
UPDATE ledger_entries SET amount = 2.58, memo = '比赛日收入（比赛 #28，上座 17221/35000，多云；票 2.58/商 0/播 0）', balance_after = 66.25 WHERE id = 198 AND club_id = 45 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 28;
-- #45 club 66 比赛 #42：金额 1.19 → 1.3；余额 14.389999999999999 → 14.5
UPDATE ledger_entries SET amount = 1.3, memo = '比赛日收入（比赛 #42，上座 8682/12000，晴；票 1.3/商 0/播 0）', balance_after = 14.5 WHERE id = 45 AND club_id = 66 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 42;
-- #50 club 66 比赛 #45：金额 0.97 → 1.49；余额 20.06 → 20.689999999999998
UPDATE ledger_entries SET amount = 1.49, memo = '比赛日收入（比赛 #45，上座 9916/12000，多云；票 1.49/商 0/播 0）', balance_after = 20.689999999999998 WHERE id = 50 AND club_id = 66 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 45;
-- #94 club 66 比赛 #1：金额 0.87 → 1.47；余额 27.93 → 29.159999999999997
UPDATE ledger_entries SET amount = 1.47, memo = '比赛日收入（比赛 #1，上座 9788/12000，雨；票 1.47/商 0/播 0）', balance_after = 29.159999999999997 WHERE id = 94 AND club_id = 66 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 1;
-- #118 club 66 比赛 #59：金额 0.77 → 1.54；余额 38.10000000000001 → 40.1
UPDATE ledger_entries SET amount = 1.54, memo = '比赛日收入（比赛 #59，上座 10283/12000，雪；票 1.54/商 0/播 0）', balance_after = 40.1 WHERE id = 118 AND club_id = 66 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 59;
-- #169 club 66 比赛 #67：金额 1.4 → 1.79；余额 63.50000000000001 → 65.89
UPDATE ledger_entries SET amount = 1.79, memo = '比赛日收入（比赛 #67，上座 11904/12000，晴；票 1.79/商 0/播 0）', balance_after = 65.89 WHERE id = 169 AND club_id = 66 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 67;
-- #207 club 66 比赛 #21：金额 1.42 → 1.79；余额 71.92 → 74.68
UPDATE ledger_entries SET amount = 1.79, memo = '比赛日收入（比赛 #21，上座 11904/12000，多云；票 1.79/商 0/播 0）', balance_after = 74.68 WHERE id = 207 AND club_id = 66 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 21;
-- #18 club 73 比赛 #34：金额 1.52 → 1.61；余额 10.92 → 11.01
UPDATE ledger_entries SET amount = 1.61, memo = '比赛日收入（比赛 #34，上座 10724/35000，多云；票 1.61/商 0/播 0）', balance_after = 11.01 WHERE id = 18 AND club_id = 73 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 34;
-- #47 club 73 比赛 #44：金额 1.33 → 1.68；余额 25.450000000000003 → 25.89
UPDATE ledger_entries SET amount = 1.68, memo = '比赛日收入（比赛 #44，上座 11225/35000，晴；票 1.68/商 0/播 0）', balance_after = 25.89 WHERE id = 47 AND club_id = 73 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 44;
-- #86 club 73 比赛 #9：金额 1.3 → 1.91；余额 33.75 → 34.8
UPDATE ledger_entries SET amount = 1.91, memo = '比赛日收入（比赛 #9，上座 12719/35000，雨；票 1.91/商 0/播 0）', balance_after = 34.8 WHERE id = 86 AND club_id = 73 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 9;
-- #121 club 73 比赛 #60：金额 1.52 → 2.59；余额 39.970000000000006 → 42.09
UPDATE ledger_entries SET amount = 2.59, memo = '比赛日收入（比赛 #60，上座 17269/35000，雨；票 2.59/商 0/播 0）', balance_after = 42.09 WHERE id = 121 AND club_id = 73 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 60;
-- #196 club 73 比赛 #29：金额 2.41 → 4.32；余额 71.48 → 75.50999999999999
UPDATE ledger_entries SET amount = 4.32, memo = '比赛日收入（比赛 #29，上座 28786/35000，晴；票 4.32/商 0/播 0）', balance_after = 75.50999999999999 WHERE id = 196 AND club_id = 73 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 29;
-- #78 club 243 比赛 #174：金额 1.07 → 1.11；余额 19.27 → 19.31
UPDATE ledger_entries SET amount = 1.11, memo = '比赛日收入（比赛 #174，上座 7419/12000，多云；票 1.11/商 0/播 0）', balance_after = 19.31 WHERE id = 78 AND club_id = 243 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 174;
-- #81 club 243 比赛 #175：金额 1.4 → 1.74；余额 27.369999999999997 → 27.749999999999996
UPDATE ledger_entries SET amount = 1.74, memo = '比赛日收入（比赛 #175，上座 11610/12000，晴；票 1.74/商 0/播 0）', balance_after = 27.749999999999996 WHERE id = 81 AND club_id = 243 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 175;
-- #138 club 243 比赛 #13：金额 1.62 → 1.79；余额 47.78999999999999 → 48.339999999999996
UPDATE ledger_entries SET amount = 1.79, memo = '比赛日收入（比赛 #13，上座 11904/12000，晴；票 1.79/商 0/播 0）', balance_after = 48.339999999999996 WHERE id = 138 AND club_id = 243 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 13;
-- #176 club 243 比赛 #185：金额 1.16 → 1.57；余额 55.64999999999999 → 56.61
UPDATE ledger_entries SET amount = 1.57, memo = '比赛日收入（比赛 #185，上座 10453/12000，雨；票 1.57/商 0/播 0）', balance_after = 56.61 WHERE id = 176 AND club_id = 243 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 185;
-- #27 club 280 比赛 #163：金额 1.05 → 1.11；余额 3.95 → 4.01
UPDATE ledger_entries SET amount = 1.11, memo = '比赛日收入（比赛 #163，上座 7374/12000，多云；票 1.11/商 0/播 0）', balance_after = 4.01 WHERE id = 27 AND club_id = 280 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 163;
-- #73 club 280 比赛 #171：金额 1.06 → 1.18；余额 16.509999999999998 → 16.69
UPDATE ledger_entries SET amount = 1.18, memo = '比赛日收入（比赛 #171，上座 7863/12000，多云；票 1.18/商 0/播 0）', balance_after = 16.69 WHERE id = 73 AND club_id = 280 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 171;
-- #150 club 280 比赛 #19：金额 0.92 → 1.1；余额 34.03 → 34.39
UPDATE ledger_entries SET amount = 1.1, memo = '比赛日收入（比赛 #19，上座 7317/12000，雨；票 1.1/商 0/播 0）', balance_after = 34.39 WHERE id = 150 AND club_id = 280 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 19;
-- #193 club 280 比赛 #183：金额 0.93 → 1.1；余额 39.76 → 40.29
UPDATE ledger_entries SET amount = 1.1, memo = '比赛日收入（比赛 #183，上座 7316/12000，多云；票 1.1/商 0/播 0）', balance_after = 40.29 WHERE id = 193 AND club_id = 280 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 183;
-- #24 club 449 比赛 #31：金额 1.04 → 1.08；余额 9.54 → 9.58
UPDATE ledger_entries SET amount = 1.08, memo = '比赛日收入（比赛 #31，上座 7202/17000，多云；票 1.08/商 0/播 0）', balance_after = 9.58 WHERE id = 24 AND club_id = 449 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 31;
-- #97 club 449 比赛 #2：金额 1.12 → 1.36；余额 27.66 → 27.939999999999998
UPDATE ledger_entries SET amount = 1.36, memo = '比赛日收入（比赛 #2，上座 9081/17000，雨；票 1.36/商 0/播 0）', balance_after = 27.939999999999998 WHERE id = 97 AND club_id = 449 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 2;
-- #107 club 449 比赛 #50：金额 1.23 → 1.73；余额 33.589999999999996 → 34.37
UPDATE ledger_entries SET amount = 1.73, memo = '比赛日收入（比赛 #50，上座 11502/17000，多云；票 1.73/商 0/播 0）', balance_after = 34.37 WHERE id = 107 AND club_id = 449 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 50;
-- #148 club 449 比赛 #11：金额 0.8 → 1.14；余额 46.089999999999996 → 47.21
UPDATE ledger_entries SET amount = 1.14, memo = '比赛日收入（比赛 #11，上座 7629/17000，多云；票 1.14/商 0/播 0）', balance_after = 47.21 WHERE id = 148 AND club_id = 449 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 11;
-- #154 club 449 比赛 #65：金额 1.33 → 1.9；余额 52.12 → 53.81
UPDATE ledger_entries SET amount = 1.9, memo = '比赛日收入（比赛 #65，上座 12641/17000，晴；票 1.9/商 0/播 0）', balance_after = 53.81 WHERE id = 154 AND club_id = 449 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 65;
-- #42 club 110374 比赛 #38：金额 1.94 → 1.91；余额 11.34 → 11.31
UPDATE ledger_entries SET amount = 1.91, memo = '比赛日收入（比赛 #38，上座 12735/22000，晴；票 1.91/商 0/播 0）', balance_after = 11.31 WHERE id = 42 AND club_id = 110374 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 38;
-- #90 club 110374 比赛 #7：金额 1.79 → 2.29；余额 21.63 → 22.1
UPDATE ledger_entries SET amount = 2.29, memo = '比赛日收入（比赛 #7，上座 15254/22000，晴；票 2.29/商 0/播 0）', balance_after = 22.1 WHERE id = 90 AND club_id = 110374 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 7;
-- #110 club 110374 比赛 #51：金额 1.3 → 1.94；余额 31.43 → 32.54
UPDATE ledger_entries SET amount = 1.94, memo = '比赛日收入（比赛 #51，上座 12929/22000，雨；票 1.94/商 0/播 0）', balance_after = 32.54 WHERE id = 110 AND club_id = 110374 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 51;
-- #178 club 110374 比赛 #63：金额 2.05 → 3.27；余额 50.48 → 52.81
UPDATE ledger_entries SET amount = 3.27, memo = '比赛日收入（比赛 #63，上座 21824/22000，晴；票 3.27/商 0/播 0）', balance_after = 52.81 WHERE id = 178 AND club_id = 110374 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 63;
-- #208 club 110374 比赛 #27：金额 2.08 → 3.27；余额 61.059999999999995 → 64.58
UPDATE ledger_entries SET amount = 3.27, memo = '比赛日收入（比赛 #27，上座 21824/22000，晴；票 3.27/商 0/播 0）', balance_after = 64.58 WHERE id = 208 AND club_id = 110374 AND kind = 'revenue' AND ref_type = 'match' AND ref_id = 27;
