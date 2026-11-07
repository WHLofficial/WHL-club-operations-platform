# prod-20261108-cpu-squad-fill · 曼城(10)/ AC米兰(131681)自由身补强批

来源:2026-11-07/08 会话「两队球员补充计划」定稿。签 24 人、解约 5 人,终态米兰 25 人(5-3-2)、曼城 26 人(4-3-3)。

## 影响面(执行前必读)

| 动作 | 行数 | 说明 |
|---|---|---|
| `players` UPDATE | 29 行(签 24 + 释 5) | 每行带守卫,重跑零改行 |
| `contracts` INSERT | 24 行 | source='import',幂等守卫 |
| `growth_events` INSERT | ≤5 行 | 解约 reset 划断事件,OR IGNORE |
| `audit_log` INSERT | 29 行 | origin='backchannel',actor NULL |
| **钱路** | **零** | 不写 `ledger_*`,不建账本行 |
| 迁移 | 零 | 纯 DML |

写配额占用约 60–90 行,对当日额度可忽略。**必须先跑 00-precheck 并逐项核对预期,再执行 01→03。**

## 口径声明(与平台路径的差异,均为有意为之)

1. **不收海捞签入费/签字费**:平台路径按「新违约金 × 30%」收费且校验可用资金,但两队无 `ledger_accounts` 行(余额口径不成立)。本批为 CPU 队直写豁免;若要补收,需先建账本注资,另行授权。
2. **工资/违约金为拟议值**(基准:全联盟现行合同 CA85+ 均 3.19 m、CA80+ 均 1.69 m/半赛季):米兰 14 人合计 **31.5 m**(帽 68,占 46%),曼城 10 人合计 **22.9 m**(帽 58,占 39%)。执行前可改 `02/03` 文件里的数值,改后同步 `04-verify` 的预期。
3. **解约按规则 4.4.4 全口径**(`src/worker/transfers.ts:1236`):CA 回 `COALESCE(base_ca,ca)`、成长清零、挂牌设置清空、`player_playstyles` 删明细、补 reset 划断事件。5 人 `growth_xp=0 / levels_applied=0 / playstyles=0 / growth_events=0 / 合同=0`(已实测),故实际只有 players 主行变化;其中 4 人 `ca > base_ca`(Hu Hetao 68→62、Liberali 69→65,为 FC 源口径差),回滚是平台解约语义,明细见 00-precheck 输出。
4. **不写 `transfers` 行**:导入类直写批先例(source='import' 无 transfers 行);transfers 挂审核状态机,半写会污染在途单检查。
5. **审计**:`audit_log` 每动作一行,`action = cpu_squad_fill_release / cpu_squad_fill_sign`,`origin='backchannel'`、`actor=NULL`(v6.3.2 契约:机器行为人留空)。
6. **号码留 NULL**:后续用 `POST /api/club/players/:id/number` 或管理端分配。
7. 球员 231747(fc_id,内部 id 2)按计划排除,不在任何清单。

## 执行步骤

```bash
# 0. 预检(只读)——逐项核对 README 内标注的预期
npx wrangler d1 execute whl-club --remote --file scripts/prod-20261108-cpu-squad-fill/00-precheck.sql

# 1. 解约 5 人(米兰 2 + 曼城 3)
npx wrangler d1 execute whl-club --remote --file scripts/prod-20261108-cpu-squad-fill/01-release.sql

# 2. 米兰签 14 人
npx wrangler d1 execute whl-club --remote --file scripts/prod-20261108-cpu-squad-fill/02-sign-milan.sql

# 3. 曼城签 10 人
npx wrangler d1 execute whl-club --remote --file scripts/prod-20261108-cpu-squad-fill/03-sign-city.sql

# 4. 只读复核
npx wrangler d1 execute whl-club --remote --file scripts/prod-20261108-cpu-squad-fill/04-verify.sql

# 5. 缓存代际 bump(必须!直写不走 HTTP purge,不 bump 公开读最长陈旧 24h)
npx wrangler kv key get "cache:epoch:public" --namespace-id 87e2d78308bc47e9b36dc6de53be0458 --remote
# 读出的值 +1 后:
npx wrangler kv key put "cache:epoch:public" "<+1后的值>" --namespace-id 87e2d78308bc47e9b36dc6de53be0458 --remote
```

⚠️ `--file` 对合法 SQL 有间歇假错(`D1_RESET_DO`/「did not contain a statement」等,v6.0.0 实测),隔 30 秒重跑同文件即可;所有语句幂等,重跑无副作用。

## 幂等性

- 签约 `UPDATE … WHERE id=? AND club_id IS NULL AND status='free'`、解约 `UPDATE … WHERE id=? AND club_id=? AND status IN ('normal','listed')`:重跑 changes=0。
- `contracts` 用 `INSERT … SELECT … WHERE NOT EXISTS(is_active=1 同球员)`。
- `growth_events` 用 `INSERT OR IGNORE`(表有 `UNIQUE(player_id, match_ref, event_type)`)。
- `audit_log` 用 `INSERT … SELECT … WHERE NOT EXISTS(同 action+target_id)`。
- 整批重跑 = 零改行、零重复行。

## 回滚(须另行授权,不随本批执行)

- 签 24 人:`UPDATE players SET club_id=NULL, status='free' WHERE id IN (24 ids)` + `UPDATE contracts SET is_active=0 WHERE player_id IN (24 ids) AND source='import' AND club_id IN (10,131681)`。
- 释 5 人:恢复原 club_id/status/number/CA,SQL 需按 00-precheck 的 before 快照手写。
- 审计行保留不删(账本只增铁律)。

## 清单速览

- 米兰签 14:Schick 70 / ter Stegen 95 / Retegui 144 / Rrahmani 183 / Lobotka 166 / 佩贡 154 / Muñoz 272 / de Ligt 256 / Højbjerg 240 / Augusto 341 / Vlahović 291 / Mazraoui 494 / Bennacer 452 / Gosens 579
- 曼城签 10:bruno Fernandes 38 / Svilar 137 / Palacios 110 / Kulusevski 161 / Sørloth 149 / Mateta 206 / Carrasco 284 / De Cuyper 465 / Carlos Romero 756 / Ordoñez 1335
- 解约 5:Hu Hetao 13232(131681)/ Liberali 9443(131681)/ Müller 1791(10)/ Alleyne 9390(10)/ Skov Olsen 1238(10)
- 重名防呆:19 岁 CAM「Bruno Fernandes」(id 17489, CA53)不在名单;231747(fc_id)已排除。
