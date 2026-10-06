// S9 期初对齐离线 SQL 生成器（① 财政导入 / ② 扣一次工资 / ③ 效力 +0.5 / ④ 标记球员状态）
//
// 缘起：用户 2026-10-06 三条指令——
//   ①「导入生产库联赛真人队（除莱比锡和巴塞罗那外）的初始财政」（附图片 23 行财政表 + 队名映射令）
//   ②「导入完成后各队扣除一次工资」
//   ③「随后球员效力时长+0.5」
//   ④ 同日拍板：「CSV 状态列（已匹配/已续约1）在平台落成 —— 保护期收口 + 补录转会单」，
//      并纠正「匹配过的才不能再匹配，续约过的还能匹」（平台 match-once 只认 type='match'，天然满足）
//   执行节奏：用户拍板「出工件后按序执行」⇒ 本批出工件后按 ①②③④ 顺序落库。
//
// 为什么走离线 SQL 而不是端上通道：
//   ① 管理端 /api/admin/ledger/opening-import 是**覆盖**语义（balance = excluded.balance）且要求非负，
//      用户拍板是**累加**（在现有余额上加图上数值），端上表达不了；且本批要一次写 16 队 + 18 队工资，
//      端上要 34 次带鉴权的调用。
//   ② 窗末工资（src/worker/window-payroll.ts）只在**关窗**时跑，且连带收富人税；用户只令「扣一次工资」
//      ⇒ 本批只记 wage、不收税（差额见 report.md 的「未做的相邻项」）。
//   ③ 效力 +0.5 的端上等价物是「再关一个常规窗」（会影响开窗状态与全平台口径），用户令的是**球员**效力，
//      故按逐合同 service_ticks − 1 落库——与「当前刻度 +1」在所有消费者上逐项等价
//      （效力显示 src/worker/routes/players.ts:104、justSigned src/worker/routes/market.ts:722、
//       忠诚奖金 src/worker/window-machine.ts:310、签约基数 src/worker/transfers.ts:113）。
//
// 口径（逐条都有源码依据，见 README §2）：
//   ① kind='opening_import'（与端上同 kind、同 ref_type/ref_id = NULL ⇒ 端上后续调用会把这 16 队判为已导入而跳过），
//      账户 upsert 用 ledgerMovement（src/worker/ledger.ts:29-63）的「差额累加」形状。
//   ② kind='wage' / ref_type='window' / ref_id = season*100+windowSeq = 901，delta = −ROUND(Σ wage, 2)，
//      memo 与 src/worker/window-payroll.ts 同款。
//   ③ 逐行 `UPDATE contracts SET service_ticks = service_ticks - 1 WHERE id = ? AND service_ticks = <快照值>`
//      ——逐行守卫使重放 changes = 0（--retry 可开），且不会误改生成后新签的合同。
//   ④ protection_ticks 收口到当前刻度（1）＝ src/worker/transfers.ts:263 的续约/匹配写法；
//      transfers 补录 28 行（match 24 + rc_change 4），evidence 用 json_object 构造（语句里不出现双引号，
//      才能过 exec-shards 的 shell 元字符闸）。
//
// 通道纪律（scripts/README.md:66）：contracts / transfers / ledger_* 都含外键或需原子性 ⇒ 一律走 --command
//   （exec-shards.mjs），不走 --file。执行：
//     node exec-shards.mjs sql/02-finance-import.sql --remote --retry=3
//     node exec-shards.mjs sql/03-wages.sql          --remote --retry=3
//     node exec-shards.mjs sql/04-tenure.sql         --remote --retry=3
//     node exec-shards.mjs sql/05-status-records.sql --remote --retry=3
//
// 用法：
//   node gen-opening-align.ts [CSV 路径]   生成 sql/ + rollback/ + manifest.json（默认 CSV = E:/Downloads/一线队-S9.csv）
//   node gen-opening-align.ts --verify     只读复核：把库内现状与 manifest 的期望逐项比对，期望「差异 0」
//   node gen-opening-align.ts --local      只读复核走本地 D1（演练用；默认 --remote）

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const OUT_DIR = join(HERE, 'sql');
const RB_DIR = join(HERE, 'rollback');
const DB = 'whl-club';
const FLAGS = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const VERIFY = FLAGS.has('--verify');
const LOCAL = FLAGS.has('--local');
const POSITIONAL = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const CSV_PATH = POSITIONAL[0] ?? 'E:/Downloads/一线队-S9.csv';

/** 批标记时间：所有新建行的 created_at/completed_at/updated_at 都用它（离线批无真实事件时间）。 */
const BATCH_TS = new Date().toISOString();
/** 回滚批的账本标记（ref_type 必须与正向批区分，否则同一 (club, kind, ref) 会被幂等闸挡住）。 */
const RB_FINANCE = 'batch_rollback_finance';
const RB_WAGE = 'batch_rollback_wage';
const RB_REF_ID = 20261006;

// ------------------------------------------------------------------ 工具

/** SQL 字符串字面量：单引号包裹、内部单引号翻倍。生成器只用它拼字面量，保证语句里没有双引号。 */
function lit(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

/** 金额保留 2 位（与 window-payroll 的 Math.round(total*100)/100 同口径）。 */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** 定点小数字面量（避免 1e-7 之类的科学计数法混进 SQL）。 */
function num(v: number): string {
  return String(round2(v));
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

interface SnapStatement {
  label: string;
  sql: string;
  rows: number;
  results: Record<string, unknown>[];
}
interface Snapshot {
  capturedAt: string;
  scope: string;
  statements: SnapStatement[];
}

function loadSnapshot(): Record<string, Record<string, unknown>[]> {
  const snap = JSON.parse(readFileSync(join(HERE, 'snapshot.json'), 'utf8')) as Snapshot;
  const by: Record<string, Record<string, unknown>[]> = {};
  for (const st of snap.statements) by[st.label] = st.results;
  return by;
}

interface FinanceRow {
  imgName: string;
  div: number;
  finance: number;
  coupons: number | null;
  clubId: number | null;
  clubName: string | null;
  decision: string;
  skipReason?: string;
  mapped?: string;
}

function loadFinance(): FinanceRow[] {
  const doc = JSON.parse(readFileSync(join(HERE, 'opening-finance.json'), 'utf8')) as { rows: FinanceRow[] };
  return doc.rows;
}

/** 极简 CSV 解析（引号感知：字段可能带逗号）。 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

interface MarkedRow {
  fcId: number;
  team: string;
  name: string;
  rc: number;
  status: '已匹配' | '已续约1';
}

/** CSV 状态列（col28）非空的行：已匹配 / 已续约1。 */
function loadMarked(): MarkedRow[] {
  const raw = readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, '');
  const rows = parseCsv(raw);
  const header = rows[0];
  const col = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`CSV 表头里找不到列「${name}」——CSV 换版了？`);
    return i;
  };
  const iTeam = col('球队名');
  const iId = col('ID');
  const iName = col('球员名-中');
  const iRc = col('违约金');
  const iStatus = col('状态');
  const out: MarkedRow[] = [];
  for (let r = 2; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length < header.length - 5) continue;
    const status = (row[iStatus] ?? '').trim();
    if (status !== '已匹配' && status !== '已续约1') continue;
    const fcId = Number(row[iId]);
    if (!Number.isInteger(fcId) || fcId <= 0) continue;
    out.push({ fcId, team: row[iTeam].trim(), name: row[iName].trim(), rc: Number(row[iRc]), status });
  }
  return out;
}

// ------------------------------------------------------------------ 生成

interface Artifact {
  file: string;
  title: string;
  statements: string[];
  expectedChanges: number;
  note: string;
}

function writeArtifact(dir: string, art: Artifact): { path: string; bytes: number; sha256: string } {
  const body = [`-- ${art.title}`, `-- 期望 changes = ${art.expectedChanges}（${art.note}）`, ''].join('\n');
  const text = `${body}${art.statements.join(';\n\n')};\n`;
  const path = join(dir, art.file);
  writeFileSync(path, text);
  return { path: art.file, bytes: Buffer.byteLength(text, 'utf8'), sha256: sha256(text) };
}

/** 把注释挂在语句前面（同一元素 = 一条语句；exec-shards 会跳过行首 -- 行，语句数才与 manifest 对得上）。 */
function withComment(comment: string, statement: string): string {
  return `${comment}\n${statement}`;
}

/** 账本两条语句（账户差额 upsert + 流水），形状照 src/worker/ledger.ts:29-63；流水闸用与账户同一条幂等条件。 */
function ledgerPair(opts: {
  clubId: number;
  delta: number;
  kind: string;
  refType: string | null;
  refId: number | null;
  memo: string;
  guard: string;
}): string[] {
  const { clubId, delta, kind, refType, refId, memo, guard } = opts;
  const refT = refType === null ? 'NULL' : lit(refType);
  const refI = refId === null ? 'NULL' : String(refId);
  return [
    `INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT ${clubId}, ${num(delta)}, ${lit(BATCH_TS)} WHERE ${guard}
ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
WHERE ${guard}`,
    `INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT ${clubId}, ${lit(kind)}, ${num(delta)}, (SELECT balance FROM ledger_accounts WHERE club_id = ${clubId}), ${refT}, ${refI}, ${lit(memo)}, ${lit(BATCH_TS)}
WHERE ${guard}`,
  ];
}

function buildFinance(finance: FinanceRow[], snap: Record<string, Record<string, unknown>[]>): Artifact {
  const importRows = finance.filter((r) => r.decision === 'import');
  const balances = new Map<number, number>();
  for (const r of snap.A) balances.set(Number(r.id), Number(r.balance));
  const statements: string[] = [];
  const lines: string[] = [];
  for (const r of importRows) {
    const clubId = r.clubId as number;
    if (!balances.has(clubId)) throw new Error(`俱乐部 ${clubId} 在预检快照 A 里没有账户行，先补预检`);
    const guard = `NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'opening_import' AND club_id = ${clubId})`;
    const memo = `期初余额导入（S9 期初对齐，累加 ${num(r.finance)} m，图列「${r.imgName}」）`;
    const [acct, entry] = ledgerPair({ clubId, delta: r.finance, kind: 'opening_import', refType: null, refId: null, memo, guard });
    statements.push(withComment(`-- club ${clubId} ${r.clubName}：${r.imgName} → 累加 ${num(r.finance)} m${r.coupons === null ? '' : `（消费券 ${r.coupons} 只留痕）`}`, acct), entry);
    lines.push(`club ${String(clubId).padStart(6)} ${String(r.clubName).padEnd(6)} 余额 ${num(balances.get(clubId) as number)} → ${num((balances.get(clubId) as number) + r.finance)}`);
  }
  return {
    file: '02-finance-import.sql',
    title: '② 期初财政导入（16 支真人队，累加；kind=opening_import）',
    statements,
    expectedChanges: importRows.length * 2,
    note: `${importRows.length} 队 × （账户 1 + 流水 1）`,
  };
}

function buildWages(snap: Record<string, Record<string, unknown>[]>): Artifact {
  const statements: string[] = [];
  for (const row of snap.B) {
    const clubId = Number(row.club_id);
    const total = Number(row.wage_sum);
    const n = Number(row.n);
    const delta = -round2(total);
    const guard = `NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND club_id = ${clubId})`;
    const memo = `球员工资（S9 第 1 窗，${n} 人现行合同）`;
    const [acct, entry] = ledgerPair({ clubId, delta, kind: 'wage', refType: 'window', refId: 901, memo, guard });
    statements.push(withComment(`-- club ${clubId}：Σwage ${num(total)} m（${n} 人）→ 扣 ${num(delta)} m`, acct), entry);
  }
  return {
    file: '03-wages.sql',
    title: '③ 各队扣一次工资（18 支真人队；kind=wage / window / 901，不含富人税）',
    statements,
    expectedChanges: snap.B.length * 2,
    note: `${snap.B.length} 队 × （账户 1 + 流水 1）`,
  };
}

function buildTenure(snap: Record<string, Record<string, unknown>[]>): Artifact {
  const statements: string[] = [];
  let club = -1;
  let pending = '';
  for (const row of snap.C) {
    const id = Number(row.id);
    const clubId = Number(row.club_id);
    const stk = Number(row.service_ticks);
    if (clubId !== club) {
      club = clubId;
      pending = `-- club ${clubId} 的现行合同`;
    }
    const stmt = `UPDATE contracts SET service_ticks = service_ticks - 1 WHERE id = ${id} AND is_active = 1 AND service_ticks = ${stk}`;
    statements.push(pending === '' ? stmt : withComment(pending, stmt));
    pending = '';
  }
  return {
    file: '04-tenure.sql',
    title: '④ 球员效力 +0.5（逐合同 service_ticks − 1；逐行守卫 = id + 快照 service_ticks）',
    statements,
    expectedChanges: snap.C.length,
    note: `${snap.C.length} 份现行合同各 1 行`,
  };
}

/** 标记球员的落点：④ 保护期收口（24 人）+ 转会单补录（28 行）。 */
function buildStatusRecords(
  marked: MarkedRow[],
  snap: Record<string, Record<string, unknown>[]>,
): { artifact: Artifact; plan: { ptk: number[]; match: MarkedRow[]; rc: MarkedRow[]; skipped: { row: MarkedRow; why: string }[] } } {
  const byFc = new Map<number, Record<string, unknown>>();
  for (const r of snap.F) byFc.set(Number(r.fc_id), r);
  const statements: string[] = [];
  const ptkIds: number[] = [];
  let ptkChanges = 0;
  const match: MarkedRow[] = [];
  const rc: MarkedRow[] = [];
  const skipped: { row: MarkedRow; why: string }[] = [];

  for (const row of marked) {
    const f = byFc.get(row.fcId);
    if (!f) throw new Error(`标记球员 fc_id ${row.fcId} 不在预检快照 F 里`);
    const playerId = Number(f.player_id);
    const clubId = f.club_id === null ? null : Number(f.club_id);
    const hasContract = f.contract_id !== null && Number(f.is_active) === 1;
    if (!hasContract && row.status === '已续约1') {
      skipped.push({ row, why: '自由身/无队籍（在解约）——4.4.10 窗内解约会令续约无效，补录会造假记录' });
      continue;
    }
    if (!hasContract && clubId === null) {
      skipped.push({ row, why: '自由身无队籍，transfers 的 from/to 都是 NULL 无从落款' });
      continue;
    }
    if (hasContract) {
      ptkIds.push(playerId);
      const ptk = f.protection_ticks === null ? null : Number(f.protection_ticks);
      if (ptk !== null && ptk !== 1) ptkChanges++;
      statements.push(
        // 用 `!=` 而非 `<>`：exec-shards 的 shell 元字符闸会拒 `<>`（--command 通道里是重定向符）
        `UPDATE contracts SET protection_ticks = 1 WHERE player_id = ${playerId} AND is_active = 1 AND protection_ticks IS NOT NULL AND protection_ticks != 1`,
      );
    }
    const fee = row.rc;
    const key = row.status === '已匹配' ? `s9-league-match:${playerId}` : `s9-league-rc_change:${playerId}`;
    const type = row.status === '已匹配' ? 'match' : 'rc_change';
    const matched = row.status === '已匹配' ? 1 : 0;
    const evidence =
      row.status === '已匹配'
        ? `json_object('oldReleaseFee', ${num(fee)}, 'previousBid', NULL, 'listingId', NULL, 'leagueMark', ${lit('已匹配')})`
        : `json_object('oldReleaseFee', ${num(fee)}, 'oldProtectionTicks', ${f.protection_ticks === null ? 'NULL' : Number(f.protection_ticks)}, 'leagueMark', ${lit('已续约1')})`;
    const insert = `INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, tax, extra_fee, matched, status, season, window_seq, idempotency_key, evidence, created_at, completed_at)
SELECT ${lit(type)}, ${playerId}, ${clubId === null ? 'NULL' : clubId}, ${clubId === null ? 'NULL' : clubId}, ${num(fee)}, NULL, 0, ${matched}, 'completed', 9, 1, ${lit(key)}, ${evidence}, ${lit(BATCH_TS)}, ${lit(BATCH_TS)}
WHERE NOT EXISTS (SELECT 1 FROM transfers WHERE idempotency_key = ${lit(key)})`;
    statements.push(withComment(`-- fc ${row.fcId} ${row.name}（${row.team}）：${row.status} → ${type} 单，违约金 ${num(fee)} m`, insert));
    if (row.status === '已匹配') match.push(row);
    else rc.push(row);
  }

  return {
    artifact: {
      file: '05-status-records.sql',
      title: '⑤ 标记球员落点（保护期收口 + 转会单补录；type=match/rc_change，status=completed，S9 第 1 窗）',
      statements,
      expectedChanges: ptkChanges + match.length + rc.length,
      note: `保护期收口 ${ptkIds.length} 条语句（其中 ${ptkChanges} 条真改值）+ 补录 ${match.length + rc.length} 行`,
    },
    plan: { ptk: ptkIds, match, rc, skipped },
  };
}

function buildVerify(
  snap: Record<string, Record<string, unknown>[]>,
  finance: FinanceRow[],
  plan: { ptk: number[]; match: MarkedRow[]; rc: MarkedRow[] },
): Artifact {
  const importRows = finance.filter((r) => r.decision === 'import');
  const finSum = round2(importRows.reduce((s, r) => s + r.finance, 0));
  const wageSum = round2(snap.B.reduce((s, r) => s + Number(r.wage_sum), 0));
  const balBefore = round2(snap.A.reduce((s, r) => s + Number(r.balance), 0));
  const stkBefore = snap.C.reduce((s, r) => s + Number(r.service_ticks), 0);
  const playerIds = snap.F.filter((r) => r.contract_id !== null && Number(r.is_active) === 1).map((r) => Number(r.player_id));
  const stmt = `SELECT
  (SELECT ROUND(SUM(balance), 2) FROM ledger_accounts) AS sum_balances,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'opening_import') AS oi_n,
  (SELECT ROUND(SUM(amount), 2) FROM ledger_entries WHERE kind = 'opening_import') AS oi_sum,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'wage' AND ref_type = 'window' AND ref_id = 901) AS wage_n,
  (SELECT ROUND(SUM(amount), 2) FROM ledger_entries WHERE kind = 'wage' AND ref_type = 'window' AND ref_id = 901) AS wage_sum,
  (SELECT ROUND(SUM(service_ticks), 2) FROM contracts WHERE is_active = 1) AS stk_sum,
  (SELECT COUNT(*) FROM contracts WHERE is_active = 1 AND player_id IN (${playerIds.join(', ')}) AND protection_ticks = 1) AS ptk1_n,
  (SELECT COUNT(*) FROM transfers WHERE type = 'match' AND status = 'completed' AND substr(idempotency_key, 1, 15) = 's9-league-match') AS rec_match,
  (SELECT COUNT(*) FROM transfers WHERE type = 'rc_change' AND status = 'completed' AND substr(idempotency_key, 1, 19) = 's9-league-rc_change') AS rec_rc,
  (SELECT COUNT(*) FROM transfers WHERE status = 'completed') AS rec_all`;
  return {
    file: '06-verify.sql',
    title: `⑥ 落库后复查（只读；期望：余额合计 ${num(balBefore + finSum - wageSum)}、期初流水 ${importRows.length} 笔合计 ${num(finSum)}、工资 ${snap.B.length} 笔合计 ${num(-wageSum)}、效力合计 ${num(stkBefore - snap.C.length)}、保护期收口 ${playerIds.length} 人、match ${plan.match.length} 行、rc_change ${plan.rc.length} 行）`,
    statements: [stmt],
    expectedChanges: 0,
    note: '只读，不改任何数据',
  };
}

function buildRollbacks(
  finance: FinanceRow[],
  snap: Record<string, Record<string, unknown>[]>,
  statusPlan: { ptk: number[]; match: MarkedRow[]; rc: MarkedRow[] },
): Artifact[] {
  const importRows = finance.filter((r) => r.decision === 'import');
  const fin: string[] = [];
  for (const r of importRows) {
    const clubId = r.clubId as number;
    const guard = `NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = ${lit(RB_FINANCE)} AND ref_id = ${RB_REF_ID} AND club_id = ${clubId})`;
    fin.push(withComment(`-- club ${clubId} ${r.clubName}：撤回 ${num(r.finance)} m`, `UPDATE ledger_accounts SET balance = balance - ${num(r.finance)}, updated_at = ${lit(BATCH_TS)} WHERE club_id = ${clubId} AND ${guard}`));
    fin.push(`INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT ${clubId}, 'manual_adjust', ${num(-r.finance)}, (SELECT balance FROM ledger_accounts WHERE club_id = ${clubId}), ${lit(RB_FINANCE)}, ${RB_REF_ID}, ${lit(`回滚期初余额导入（S9 期初对齐批，club ${clubId}）`)}, ${lit(BATCH_TS)}
WHERE ${guard}`);
  }
  const wage: string[] = [];
  for (const row of snap.B) {
    const clubId = Number(row.club_id);
    const total = round2(Number(row.wage_sum));
    const guard = `NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = ${lit(RB_WAGE)} AND ref_id = ${RB_REF_ID} AND club_id = ${clubId})`;
    wage.push(withComment(`-- club ${clubId}：退回 ${num(total)} m`, `UPDATE ledger_accounts SET balance = balance + ${num(total)}, updated_at = ${lit(BATCH_TS)} WHERE club_id = ${clubId} AND ${guard}`));
    wage.push(`INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT ${clubId}, 'manual_adjust', ${num(total)}, (SELECT balance FROM ledger_accounts WHERE club_id = ${clubId}), ${lit(RB_WAGE)}, ${RB_REF_ID}, ${lit(`回滚 S9 第 1 窗工资扣减（club ${clubId}）`)}, ${lit(BATCH_TS)}
WHERE ${guard}`);
  }
  const tenure: string[] = [];
  for (const row of snap.C) {
    const id = Number(row.id);
    const stk = Number(row.service_ticks);
    tenure.push(`UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = ${id} AND is_active = 1 AND service_ticks = ${stk - 1}`);
  }
  const keys = [...statusPlan.match, ...statusPlan.rc].map((m) => {
    const f = snap.F.find((r) => Number(r.fc_id) === m.fcId) as Record<string, unknown>;
    const playerId = Number(f.player_id);
    return m.status === '已匹配' ? `s9-league-match:${playerId}` : `s9-league-rc_change:${playerId}`;
  });
  const status: string[] = [
    `DELETE FROM transfers WHERE idempotency_key IN (${keys.map((k) => lit(k)).join(', ')})`,
  ];
  for (const pid of statusPlan.ptk) {
    const f = snap.F.find((r) => Number(r.player_id) === pid) as Record<string, unknown>;
    const ptk = f.protection_ticks === null ? 'NULL' : Number(f.protection_ticks);
    status.push(`UPDATE contracts SET protection_ticks = ${ptk} WHERE player_id = ${pid} AND is_active = 1 AND protection_ticks = 1`);
  }
  return [
    {
      file: '01-finance-import.sql',
      title: '回滚 ② 期初财政导入（补偿分录：kind=manual_adjust 反向冲回，保留原流水）',
      statements: fin,
      expectedChanges: importRows.length * 2,
      note: `${importRows.length} 队 × （账户 −、补偿流水 +）`,
    },
    {
      file: '02-wages.sql',
      title: '回滚 ③ 扣工资（补偿分录：kind=manual_adjust 反向退回）',
      statements: wage,
      expectedChanges: snap.B.length * 2,
      note: `${snap.B.length} 队 × （账户 +、补偿流水 +）`,
    },
    {
      file: '03-tenure.sql',
      title: '回滚 ④ 效力 +0.5（逐行 +1，守卫 = 已减过的值）',
      statements: tenure,
      expectedChanges: snap.C.length,
      note: `${snap.C.length} 份合同各 1 行`,
    },
    {
      file: '04-status-records.sql',
      title: '回滚 ⑤ 标记球员落点（删 28 行补录单 + 保护期还原到快照值）',
      statements: status,
      expectedChanges: keys.length + statusPlan.ptk.length,
      note: `删 ${keys.length} 行 + 还原 ${statusPlan.ptk.length} 条`,
    },
  ];
}

// ------------------------------------------------------------------ 只读复核

function queryRemote(sql: string): Record<string, unknown>[] {
  const scope = LOCAL ? '--local' : '--remote';
  // 折成单行：Windows 的 shell:true 走 cmd.exe，多行参数会被截断（wrangler 报 exit 1、stderr 为空）
  const oneLine = sql.replace(/\s+/g, ' ').trim();
  const cmd = `npx wrangler d1 execute ${DB} ${scope} --json --command "${oneLine}"`;
  const res = spawnSync(cmd, { shell: true, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`查询失败（exit ${res.status}）：${(res.stderr || '').slice(0, 500)}`);
  const m = res.stdout.match(/^\[/m);
  if (!m || m.index == null) throw new Error('输出里没有以行首 [ 开始的 JSON');
  const parsed = JSON.parse(res.stdout.slice(m.index)) as { results?: Record<string, unknown>[] }[];
  return parsed[0]?.results ?? [];
}

function runVerify(snap: Record<string, Record<string, unknown>[]>, finance: FinanceRow[], marked: MarkedRow[]): void {
  const importRows = finance.filter((r) => r.decision === 'import');
  const finBy = new Map<number, number>();
  for (const r of importRows) finBy.set(r.clubId as number, r.finance);
  const wageBy = new Map<number, number>();
  for (const row of snap.B) wageBy.set(Number(row.club_id), round2(Number(row.wage_sum)));
  const balBefore = new Map<number, number>();
  for (const r of snap.A) balBefore.set(Number(r.id), Number(r.balance));

  const diffs: string[] = [];
  const agg = queryRemote(`SELECT
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'opening_import') AS oi_n,
  (SELECT ROUND(SUM(amount), 2) FROM ledger_entries WHERE kind = 'opening_import') AS oi_sum,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'wage' AND ref_type = 'window' AND ref_id = 901) AS wage_n,
  (SELECT ROUND(SUM(amount), 2) FROM ledger_entries WHERE kind = 'wage' AND ref_type = 'window' AND ref_id = 901) AS wage_sum,
  (SELECT COUNT(*) FROM transfers WHERE type = 'match' AND status = 'completed' AND substr(idempotency_key, 1, 15) = 's9-league-match') AS rec_match,
  (SELECT COUNT(*) FROM transfers WHERE type = 'rc_change' AND status = 'completed' AND substr(idempotency_key, 1, 19) = 's9-league-rc_change') AS rec_rc,
  (SELECT COUNT(*) FROM contracts WHERE is_active = 1 AND protection_ticks = 1) AS ptk1_all`)[0];
  const expect = {
    oi_n: importRows.length,
    oi_sum: round2(importRows.reduce((s, r) => s + r.finance, 0)),
    wage_n: snap.B.length,
    wage_sum: round2(-snap.B.reduce((s, r) => s + Number(r.wage_sum), 0)),
    rec_match: 24,
    rec_rc: 4,
  };
  for (const [k, v] of Object.entries(expect)) {
    const got = Number(agg[k]);
    if (Math.abs(got - v) > 0.001) diffs.push(`${k}：期望 ${v}，实得 ${got}`);
  }
  console.log(`账本/补录聚合：${JSON.stringify(agg)}`);

  const balRows = queryRemote('SELECT club_id, ROUND(balance, 2) AS balance FROM ledger_accounts ORDER BY club_id');
  for (const r of balRows) {
    const clubId = Number(r.club_id);
    const want = round2((balBefore.get(clubId) ?? 0) + (finBy.get(clubId) ?? 0) - (wageBy.get(clubId) ?? 0));
    const got = Number(r.balance);
    if (Math.abs(got - want) > 0.011) diffs.push(`club ${clubId} 余额：期望 ${want}，实得 ${got}`);
  }

  const stkRows = queryRemote('SELECT id, service_ticks FROM contracts WHERE is_active = 1 ORDER BY id');
  const stkBy = new Map<number, number>();
  for (const r of stkRows) stkBy.set(Number(r.id), Number(r.service_ticks));
  let stkBad = 0;
  for (const row of snap.C) {
    const id = Number(row.id);
    const want = Number(row.service_ticks) - 1;
    if (stkBy.get(id) !== want) {
      stkBad++;
      if (stkBad <= 5) diffs.push(`contract ${id} 效力刻度：期望 ${want}，实得 ${stkBy.get(id)}`);
    }
  }
  if (stkBad > 0) diffs.push(`效力刻度不符共 ${stkBad} 条（合同数 ${snap.C.length} vs 现行 ${stkRows.length}）`);

  const ptkRows = queryRemote(
    `SELECT COUNT(*) AS bad FROM contracts WHERE is_active = 1 AND player_id IN (${snap.F.filter((r) => r.contract_id !== null && Number(r.is_active) === 1).map((r) => Number(r.player_id)).join(', ')}) AND (protection_ticks IS NULL OR protection_ticks <> 1)`,
  );
  if (Number(ptkRows[0].bad) !== 0) diffs.push(`标记球员保护期未收口 ${ptkRows[0].bad} 条`);

  const matchOnce = queryRemote(`SELECT COUNT(*) AS n FROM transfers WHERE type = 'match' AND status = 'completed'`);
  console.log(`match-once 名额占用（type=match AND status=completed）：${matchOnce[0].n} 名`);
  void marked;

  if (diffs.length === 0) {
    console.log('只读复核：差异 0 ✓');
  } else {
    console.log(`只读复核：差异 ${diffs.length} 项 ——`);
    for (const d of diffs.slice(0, 40)) console.log(`  · ${d}`);
  }
}

// ------------------------------------------------------------------ 主流程

function main(): void {
  const snap = loadSnapshot();
  const finance = loadFinance();
  const marked = loadMarked();
  const nMatch = marked.filter((m) => m.status === '已匹配').length;
  const nRc = marked.filter((m) => m.status === '已续约1').length;
  console.log(`预检快照：${snap.C.length} 份现行合同 / ${snap.B.length} 队有工资 / 标记球员 ${marked.length} 行（已匹配 ${nMatch} + 已续约1 ${nRc}）`);
  if (nMatch !== 25 || nRc !== 5) throw new Error(`标记行数与预期不符（期望 25 + 5 = 30，实得 ${nMatch} + ${nRc}）——CSV 换版了？`);

  if (VERIFY) {
    runVerify(snap, finance, marked);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(RB_DIR, { recursive: true });
  const status = buildStatusRecords(marked, snap);
  const artifacts: Artifact[] = [
    buildFinance(finance, snap),
    buildWages(snap),
    buildTenure(snap),
    status.artifact,
    buildVerify(snap, finance, status.plan),
  ];
  const rollbacks = buildRollbacks(finance, snap, status.plan);

  const manifest = {
    batch: 'prod-20261006-s9-opening-align',
    generatedAt: BATCH_TS,
    csv: CSV_PATH,
    snapshotCapturedAt: (JSON.parse(readFileSync(join(HERE, 'snapshot.json'), 'utf8')) as Snapshot).capturedAt,
    finance: {
      imported: finance.filter((r) => r.decision === 'import').map((r) => ({ clubId: r.clubId, clubName: r.clubName, imgName: r.imgName, amount: r.finance, coupons: r.coupons })),
      skipped: finance.filter((r) => r.decision !== 'import').map((r) => ({ imgName: r.imgName, finance: r.finance, coupons: r.coupons, why: r.skipReason })),
      sum: round2(finance.filter((r) => r.decision === 'import').reduce((s, r) => s + r.finance, 0)),
    },
    wages: snap.B.map((r) => ({ clubId: Number(r.club_id), n: Number(r.n), total: round2(Number(r.wage_sum)) })),
    tenure: { contracts: snap.C.length },
    records: {
      ptk: status.plan.ptk.length,
      match: status.plan.match.map((m) => ({ fcId: m.fcId, name: m.name, team: m.team, rc: m.rc })),
      rcChange: status.plan.rc.map((m) => ({ fcId: m.fcId, name: m.name, team: m.team, rc: m.rc })),
      skipped: status.plan.skipped.map((s) => ({ fcId: s.row.fcId, name: s.row.name, status: s.row.status, why: s.why })),
    },
    files: artifacts.map((a) => ({ ...writeArtifact(OUT_DIR, a), statements: a.statements.length, expectedChanges: a.expectedChanges, note: a.note })),
    rollbackFiles: rollbacks.map((a) => ({ ...writeArtifact(RB_DIR, a), statements: a.statements.length, expectedChanges: a.expectedChanges, note: a.note })),
  };
  writeFileSync(join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log('\n正向工件（按序执行）：');
  for (const f of manifest.files) {
    console.log(`  ${f.path.padEnd(24)} ${String(f.statements).padStart(4)} 条语句，期望 changes ${String(f.expectedChanges).padStart(4)}（${f.note}）`);
  }
  console.log('回滚工件（仅在需要撤销时按序执行）：');
  for (const f of manifest.rollbackFiles) {
    console.log(`  ${f.path.padEnd(24)} ${String(f.statements).padStart(4)} 条语句，期望 changes ${String(f.expectedChanges).padStart(4)}（${f.note}）`);
  }
  console.log('\n④ 计划：');
  console.log(`  保护期收口 ${status.plan.ptk.length} 人；补录 match ${status.plan.match.length} 行、rc_change ${status.plan.rc.length} 行；跳过 ${status.plan.skipped.length} 行`);
  for (const s of status.plan.skipped) console.log(`  · 跳过 fc ${s.row.fcId} ${s.row.name}（${s.row.status}）：${s.why}`);
  console.log(`  财政导入 ${manifest.finance.imported.length} 队，合计 +${num(manifest.finance.sum)} m；跳过 ${manifest.finance.skipped.length} 行`);
  console.log(`  工资扣减 ${manifest.wages.length} 队，合计 −${num(manifest.wages.reduce((s, w) => s + w.total, 0))} m；效力 +0.5 ${manifest.tenure.contracts} 份合同`);
}

main();
