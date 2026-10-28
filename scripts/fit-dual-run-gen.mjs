// TC-C-005 快照生成器（docs/test-plans/v6.56.0-attr-head-relayout.md）：
// 用 tour 仓的 fit 引擎对固定夹具算出 fitProfileAll 全 49 槽输出，落
// web/src/lib/fit/fit-dual-run.fixture.json；web/src/lib/fit/fit-parity.test.ts 用本仓引擎
// 对同一夹具现算并逐槽逐字段对拍（0 diff = 移植零漂移）。
//
// 运行：node scripts/fit-dual-run-gen.mjs
//   前提：姊妹仓 WHL-tournament-management-system 在场（可用 TOUR_REPO 环境变量指路）。
//   源解析：优先工作树 shared/fitScore.ts；不在场则 git show tactics-v5.10-v5.11:shared/fitScore.ts
//   （v5.10.0 FIT 引擎提交撤出 main 后该分支是唯一真源，ff8e975 起）。
//
// 为什么是快照不是活体双跑：活体双跑要 vitest 运行时跨仓解析模块（extensionless import、
// 绝对路径、跨 fs 根），任何一环缺位整组 skip——v6.56.0 实测恒跳过、parity 从无执行证据。
// 快照把 tour 侧输出冻结进仓，闸门在任何机器常开；tour 引擎升级时重跑本脚本再对拍。
//
// 夹具与 web/src/lib/fit/fitScore.test.ts 的 GK_META / ST_META 同源（逐字段同构），
// 另加「30 键全铺场上球员」与两个空数据边界（计划 TC-C-005 的三夹具口径）。

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOUR_REPO = process.env.TOUR_REPO ?? path.resolve(REPO_ROOT, '..', 'WHL-tournament-management-system');
const TOUR_BRANCH = 'tactics-v5.10-v5.11';
const OUT_FILE = path.join(REPO_ROOT, 'web', 'src', 'lib', 'fit', 'fit-dual-run.fixture.json');

if (!existsSync(TOUR_REPO)) {
  console.error(`[fit-dual-run-gen] tour 仓不在场：${TOUR_REPO}（可用 TOUR_REPO=... 指路）`);
  process.exit(1);
}

/** 读 tour 仓文件：先工作树，退回 git show 分支（记录来源与 commit）。
 *  git 的 pathspec 永远用正斜杠——Windows 下 path.join 产反斜杠会被 git 当字面量拒掉。 */
function readTourFile(rel) {
  const wt = path.join(TOUR_REPO, rel);
  if (existsSync(wt)) return { text: readFileSync(wt, 'utf8'), via: 'worktree' };
  const spec = rel.split(path.sep).join('/');
  const text = execFileSync('git', ['-C', TOUR_REPO, 'show', `${TOUR_BRANCH}:${spec}`], { encoding: 'utf8' });
  return { text, via: `git show ${TOUR_BRANCH}` };
}

const fitScore = readTourFile(path.join('shared', 'fitScore.ts'));
const roleFit = readTourFile(path.join('shared', 'roleFit.ts'));
const types = readTourFile(path.join('shared', 'types.ts'));
const commit = execFileSync('git', ['-C', TOUR_REPO, 'rev-parse', TOUR_BRANCH], { encoding: 'utf8' }).trim();

// tour 侧 import 无 .ts 后缀（Node 直跑 ERR_MODULE_NOT_FOUND，TC-C-004 实证）——
// 物化到临时目录时补后缀；roleFit.ts / types.ts 无 import，逐字落盘。
const tmp = mkdtempSync(path.join(tmpdir(), 'fit-dual-run-'));
try {
  const patched = fitScore.text
    .replace(/from "\.\/roleFit"/g, 'from "./roleFit.ts"')
    .replace(/from "\.\/types"/g, 'from "./types.ts"');
  writeFileSync(path.join(tmp, 'fitScore.ts'), patched);
  writeFileSync(path.join(tmp, 'roleFit.ts'), roleFit.text);
  writeFileSync(path.join(tmp, 'types.ts'), types.text);

  const engine = await import(pathToFileURL(path.join(tmp, 'fitScore.ts')).href);
  // 夹具键集来自本仓冻结表（与 fitScore.test.ts 的 GK_META 同一构造），两引擎吃同一份输入
  const { FIT_ATTR_KEYS } = await import(pathToFileURL(path.join(REPO_ROOT, 'web', 'src', 'lib', 'fit', 'roleFit.ts')).href);

  // GK_META（fitScore.test.ts:33 同构）：非 gk 键确定性铺开 + gk 五维手挑，PosID1=0 钉 posHit 方向
  const GK_META = {
    attrs: {
      ...Object.fromEntries(FIT_ATTR_KEYS.filter((k) => !k.startsWith('gk')).map((k, i) => [k, 40 + ((i * 7) % 55)])),
      gkreflexes: 90,
      gkdiving: 84,
      gkpositioning: 81,
      gkhandling: 78,
      gkkicking: 66,
      reactions: 72,
      shortpassing: 60,
      longpassing: 57,
      PosID1: 0,
    },
  };
  // ST_META（fitScore.test.ts:57 同构）：ST 画像 + 同槽两档 RoleID + 银徽 7 / 金徽 101
  const ST_META = {
    attrs: {
      finishing: 90,
      positioning: 84,
      reactions: 72,
      shotpower: 72,
      composure: 60,
      sprintspeed: 60,
      PosID1: 25,
      RoleID1: 42,
      RoleID2: 142,
    },
    playstyles: [7, 101],
  };
  // 30 键全铺场上球员（计划 TC-C-005 第三夹具）：全引擎键在场 + PosID1=25
  const OUT_FULL = {
    attrs: {
      ...Object.fromEntries(FIT_ATTR_KEYS.map((k, i) => [k, 40 + ((i * 7) % 55)])),
      PosID1: 25,
      RoleID1: 42,
      RoleID2: 142,
    },
    playstyles: [7, 101],
  };
  // 空数据边界：无 meta 内容 / 只有引擎外键（CA/PA 不进公式）——两侧都必须回 null
  const EMPTY = {};
  const OUTSIDE_ONLY = {
    attrs: { CA: 88, PA: 95, freekickaccuracy: 80, penalties: 70, RoleID1: 142, PosID1: 25 },
  };

  const fixtures = [
    { name: 'GK_META', meta: GK_META },
    { name: 'ST_META', meta: ST_META },
    { name: 'OUT_FULL', meta: OUT_FULL },
    { name: 'EMPTY', meta: EMPTY },
    { name: 'OUTSIDE_ONLY', meta: OUTSIDE_ONLY },
  ];

  /** 单槽位归一：只留语义字段并固定键序（与 fit-parity.test.ts 的对拍结构一致） */
  function slotView(score) {
    return {
      base: score.base,
      badge: score.badge,
      score: score.score,
      rankRaw: score.rankRaw,
      rankShown: score.rankShown,
      attr: score.breakdown.attr.map(([k, v, c]) => [k, v, c]),
      badgeHits: [...score.breakdown.badgeHits],
      posHit: score.breakdown.posHit,
      roleHit: score.breakdown.roleHit,
    };
  }

  const expected = {};
  for (const { name, meta } of fixtures) {
    const profile = engine.fitProfileAll(meta);
    const group = engine.fitPosGroup(meta);
    if (profile === null) {
      expected[name] = { group, profile: null };
      continue;
    }
    const slots = {};
    for (const slot of [...profile.keys()].sort()) {
      const score = profile.get(slot) ?? null;
      slots[slot] = score === null ? null : { ...slotView(score), tile: engine.fitTile(profile, slot, group) };
    }
    expected[name] = { group, profile: slots };
  }

  const out = {
    _meta: {
      generatedAt: new Date().toISOString().slice(0, 10),
      command: 'node scripts/fit-dual-run-gen.mjs',
      tourRepo: path.basename(TOUR_REPO),
      tourSource: `${fitScore.via}`,
      tourRef: `${TOUR_BRANCH}@${commit}`,
      note: 'tour 仓 fitScore.ts + roleFit.ts 对固定夹具的 fitProfileAll/fitPosGroup/fitTile 全 49 槽输出；重生成后须人工 diff 确认变化只来自上游引擎升级',
    },
    fixtures: fixtures.map(({ name, meta }) => ({ name, meta })),
    expected,
  };
  writeFileSync(OUT_FILE, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  const kb = (readFileSync(OUT_FILE, 'utf8').length / 1024).toFixed(1);
  console.log(`[fit-dual-run-gen] OK ${OUT_FILE}（${kb} KB，tour 源 = ${fitScore.via}，ref = ${TOUR_BRANCH}@${commit.slice(0, 12)}）`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
