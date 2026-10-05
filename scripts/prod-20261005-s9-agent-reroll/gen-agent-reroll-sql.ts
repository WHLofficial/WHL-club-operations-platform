// 全库球员经纪人性格（players.agent_tier）一次性随机化 —— 离线 SQL 生成器
//
// 缘起：用户 2026-10-05 指令「对全库球员经纪人性格进行随机」。生产现状（当日只读探针）：
//   18,301 名球员 agent_tier 全为 2（普通，迁移 0001 起的列默认值），即从未铺过档位。
//
// 口径：每名球员独立均匀掷 1/2/3（1 温和 / 2 普通 / 3 苛刻；src/core/negotiation-rules.ts:9 的公开属性）。
//   与开窗期生产重掷同目标分布（src/worker/window-machine.ts:119-140：0.3 概率触发、三档等概率
//   `1 + floor(roll()*3)`）——本批是「一次性铺满」，故不设概率门槛：全库每人一掷，避免 70% 仍是默认值。
//
// 为什么生成显式值而不是让 SQL 掷：artifact 必须可核对、可回滚。随机数在本机生成（crypto.randomInt），
//   逐行 (id, old, new) 落 sql/manifest.json；--verify 按 manifest 与库内逐行比对。
//
// 工件：
//   sql/01-precheck.sql   前置断言（期望：players_total=18301、nulls=0、distinct_tiers=1）
//   sql/02-reroll.sql     62 条 UPDATE（按新档位分组，每条 300 个 id，单条 <4000 字节 ⇒ 过 --command 通道）
//   sql/03-verify.sql     验收（档位分布 / 越界 / NULL）
//   rollback/01-rollback.sql  前态为全库统一值 ⇒ 单条还原（生成器已断言统一，precheck 再验一遍）
//
// 执行后必须 bump KV 的 cache:epoch:public：/api/players* 走 cachedJson（src/worker/routes/players.ts:225/852/877），
//   不 bump 的话筛选项与 agent_tier 排序（src/core/players-sort.ts:34）最长沿用旧档位到 TTL 到期。
//
// 用法：
//   node gen-agent-reroll-sql.ts              生成工件（默认读远端只读核对现状分布）
//   node gen-agent-reroll-sql.ts --verify     只读复核：库内档位与 manifest 逐行比对，期望「残留差异 0」
//   node gen-agent-reroll-sql.ts --local      读本地 D1（本地演练用）

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomInt } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const FLAGS = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const VERIFY = FLAGS.has('--verify');
const LOCAL = FLAGS.has('--local');

const HERE = fileURLToPath(new URL('.', import.meta.url));
const OUT_DIR = join(HERE, 'sql');
const RB_DIR = join(HERE, 'rollback');
const DB = 'whl-club';
const TS = new Date().toISOString();
const IDS_PER_STATEMENT = 300; // 单条 UPDATE 的 id 数（300 × ~6 字节 + 头 ≈ 1.9KB，宽裕低于 4000 字节上限）
const TIER_LABEL: Record<number, string> = { 1: '温和', 2: '普通', 3: '苛刻' };

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function d1(sql: string): Record<string, unknown>[] {
  const scope = LOCAL ? '--local' : '--remote';
  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = spawnSync(`npx wrangler d1 execute ${DB} ${scope} --json --command "${sql}"`, {
      shell: true,
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
    });
    if (res.status === 0) {
      const m = /^\[/m.exec(res.stdout ?? '');
      if (m?.index != null) {
        const parsed = JSON.parse((res.stdout ?? '').slice(m.index));
        return parsed[0]?.results ?? [];
      }
      last = '输出里没有行首 [ 的 JSON';
    } else last = (res.stderr || res.stdout || '').slice(0, 300);
  }
  throw new Error(`D1 查询失败：${sql}\n${last}`);
}

type Player = { id: number; tier: number };

function loadPlayers(): Player[] {
  const out: Player[] = [];
  let lastId = 0;
  for (;;) {
    const rows = d1(`SELECT id, agent_tier FROM players WHERE id > ${lastId} ORDER BY id LIMIT 5000`);
    if (rows.length === 0) break;
    for (const r of rows) {
      const tier = r.agent_tier == null ? NaN : Number(r.agent_tier);
      out.push({ id: Number(r.id), tier });
    }
    lastId = Number(rows[rows.length - 1]!.id);
  }
  return out;
}

function distribution(players: Player[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const p of players) m.set(p.tier, (m.get(p.tier) ?? 0) + 1);
  return new Map([...m.entries()].sort((a, b) => a[0] - b[0]));
}

function distText(m: Map<number, number>): string {
  return [...m.entries()].map(([t, n]) => `${t} ${TIER_LABEL[t] ?? '(越界)'} ${n}`).join(' / ');
}

function main(): void {
  const before = loadPlayers();
  if (before.length === 0) throw new Error('库里没有球员行');
  const beforeDist = distribution(before);
  const nulls = before.filter((p) => !Number.isFinite(p.tier)).length;
  const uniform = beforeDist.size === 1 ? [...beforeDist.keys()][0]! : null;

  if (VERIFY) {
    const manifestPath = join(OUT_DIR, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { rows: [number, number, number][] };
    const plan = new Map(manifest.rows.map(([id, , next]) => [id, next]));
    const diffs: { id: number; want: number; got: number }[] = [];
    const seen = new Set<number>();
    for (const p of before) {
      seen.add(p.id);
      const want = plan.get(p.id);
      if (want === undefined) diffs.push({ id: p.id, want: -1, got: p.tier });
      else if (want !== p.tier) diffs.push({ id: p.id, want, got: p.tier });
    }
    for (const [id] of plan) if (!seen.has(id)) diffs.push({ id, want: 0, got: NaN });
    console.log(`--verify（${LOCAL ? '本地' : '生产'} D1）：manifest ${manifest.rows.length} 行，库内 ${before.length} 行，残留差异 ${diffs.length}`);
    for (const d of diffs.slice(0, 20)) console.log(`  id ${d.id}：库内 ${d.got} ≠ 期望 ${d.want}`);
    console.log(`库内分布：${distText(beforeDist)}`);
    process.exit(diffs.length ? 1 : 0);
  }

  if (nulls > 0) {
    console.error(`有 ${nulls} 名球员 agent_tier 为 NULL（本批要求显式档位，先人工处理）`);
    process.exit(4);
  }
  const outOfRange = before.filter((p) => ![1, 2, 3].includes(p.tier));
  if (outOfRange.length > 0) {
    console.error(`有 ${outOfRange.length} 名球员 agent_tier 越界（不在 1/2/3），先人工处理：${outOfRange.slice(0, 5).map((p) => p.id).join(',')}`);
    process.exit(4);
  }

  const assigned = before.map((p) => ({ id: p.id, old: p.tier, next: randomInt(1, 4) }));
  const afterDist = distribution(assigned.map((a) => ({ id: a.id, tier: a.next })));
  const changed = assigned.filter((a) => a.old !== a.next).length;

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(RB_DIR, { recursive: true });

  const stmts: string[] = [];
  for (const tier of [1, 2, 3]) {
    const ids = assigned.filter((a) => a.next === tier).map((a) => a.id);
    for (let i = 0; i < ids.length; i += IDS_PER_STATEMENT) {
      const slice = ids.slice(i, i + IDS_PER_STATEMENT);
      stmts.push(`UPDATE players SET agent_tier = ${tier}, updated_at = '${TS}' WHERE id IN (${slice.join(',')});`);
    }
  }

  const precheckSql =
    [
      '-- 预检（只读）：期望 players_total=18301 / nulls=0 / out_of_range=0，且（本批前提）distinct_tiers=1',
      'SELECT COUNT(*) AS players_total, COUNT(DISTINCT agent_tier) AS distinct_tiers, SUM(CASE WHEN agent_tier IS NULL THEN 1 ELSE 0 END) AS nulls, SUM(CASE WHEN agent_tier NOT IN (1, 2, 3) THEN 1 ELSE 0 END) AS out_of_range FROM players;',
      'SELECT agent_tier, COUNT(*) AS n FROM players GROUP BY agent_tier ORDER BY agent_tier;',
    ].join('\n') + '\n';
  const verifySql =
    [
      '-- 验收（只读）：分布须与 agent-reroll-report.md 的「随机化后」逐档一致；nulls/out_of_range 须为 0',
      'SELECT COUNT(*) AS players_total, SUM(CASE WHEN agent_tier IS NULL THEN 1 ELSE 0 END) AS nulls, SUM(CASE WHEN agent_tier NOT IN (1, 2, 3) THEN 1 ELSE 0 END) AS out_of_range FROM players;',
      'SELECT agent_tier, COUNT(*) AS n FROM players GROUP BY agent_tier ORDER BY agent_tier;',
    ].join('\n') + '\n';
  const rerollSql =
    `-- 落库：${stmts.length} 条 UPDATE（每名球员一条内联值，按新档位分组、每条 ≤${IDS_PER_STATEMENT} 个 id）。\n` +
    `-- 重放幂等（写的是同一批显式值），updated_at 落批次标记 ${TS}。\n` +
    stmts.join('\n') +
    '\n';
  const rollbackSql =
    uniform === null
      ? `-- 回滚：前态不是全库统一值，无法用单条还原。请按 sql/manifest.json 的 old 列生成逐行还原语句。\n`
      : `-- 回滚：前态为全库统一值 agent_tier=${uniform}（生成器与预检双重断言）⇒ 单条还原本批写过的两档。\n` +
        `-- 注意：只在「无人改动档位」的前提下有效；改动后请按 sql/manifest.json 的 old 列重建逐行还原。\n` +
        `UPDATE players SET agent_tier = ${uniform}, updated_at = '${TS}' WHERE agent_tier IN (${[1, 2, 3].filter((t) => t !== uniform).join(', ')});\n`;

  writeFileSync(join(OUT_DIR, '01-precheck.sql'), precheckSql);
  writeFileSync(join(OUT_DIR, '02-reroll.sql'), rerollSql);
  writeFileSync(join(OUT_DIR, '03-verify.sql'), verifySql);
  writeFileSync(join(RB_DIR, '01-rollback.sql'), rollbackSql);

  const manifest = {
    ts: TS,
    idsPerStatement: IDS_PER_STATEMENT,
    statements: stmts.length,
    before: [...beforeDist.entries()],
    after: [...afterDist.entries()],
    changed,
    files: {
      'sql/01-precheck.sql': sha256(precheckSql),
      'sql/02-reroll.sql': sha256(rerollSql),
      'sql/03-verify.sql': sha256(verifySql),
      'rollback/01-rollback.sql': sha256(rollbackSql),
    },
    rows: assigned.map((a) => [a.id, a.old, a.next]),
  };
  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest));

  const report =
    `# 全库经纪人性格随机化报告（players.agent_tier）\n\n` +
    `生成时点：${TS}（updated_at 批次标记；回滚按它写明）\n` +
    `口径：每名球员独立均匀掷 1/2/3（温和/普通/苛刻），一次性铺满全库 ${assigned.length} 行；\n` +
    `  与开窗期生产重掷同目标分布（src/worker/window-machine.ts:119-140，0.3 概率、三档等概率）。\n\n` +
    `## 分布\n\n` +
    `| 档位 | 随机化前 | 随机化后 |\n| --- | --- | --- |\n` +
    `| 1 温和 | ${beforeDist.get(1) ?? 0} | ${afterDist.get(1) ?? 0} |\n` +
    `| 2 普通 | ${beforeDist.get(2) ?? 0} | ${afterDist.get(2) ?? 0} |\n` +
    `| 3 苛刻 | ${beforeDist.get(3) ?? 0} | ${afterDist.get(3) ?? 0} |\n\n` +
    `实际改动 ${changed} 行（其余 ${assigned.length - changed} 行掷回原值）。\n\n` +
    `## 执行\n\n` +
    '```\n' +
    `node exec-shards.mjs sql/01-precheck.sql --remote            # 期望 18301 / 1 / 0 / 0\n` +
    `node exec-shards.mjs sql/02-reroll.sql --remote --retry=3    # ${stmts.length} 条 → changes 合计 ${assigned.length}\n` +
    `node exec-shards.mjs sql/03-verify.sql --remote              # 分布须与上表「随机化后」一致\n` +
    `node gen-agent-reroll-sql.ts --verify                        # 逐行核对 manifest，期望「残留差异 0」\n` +
    '```\n\n' +
    `执行后必须 bump KV \`cache:epoch:public\`（/api/players* 走 cachedJson，见生成器头注释）。\n` +
    `回滚：\`node exec-shards.mjs rollback/01-rollback.sql --remote\`（前态统一值 ${uniform ?? '非统一（见 rollback 文件说明）'}）\n\n` +
    `## 工件摘要\n\n` +
    Object.entries(manifest.files)
      .map(([f, h]) => `- \`${f}\` sha256 \`${h}\``)
      .join('\n') +
    `\n- \`sql/manifest.json\` 逐行 (id, old, new) ${assigned.length} 条（审计凭据；不可复现，故随 sql/ 不入库）\n`;
  writeFileSync(join(HERE, 'agent-reroll-report.md'), report);

  console.log(`生成完毕：${stmts.length} 条 UPDATE、${assigned.length} 行、改动 ${changed} 行`);
  console.log(`随机化前：${distText(beforeDist)}`);
  console.log(`随机化后：${distText(afterDist)}`);
  console.log(`若前态非统一，回滚需按 manifest 重建：${uniform === null ? '是（非统一）' : `否（统一 ${uniform}）`}`);
}

main();
