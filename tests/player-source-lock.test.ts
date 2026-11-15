// players.status 写点源码锁（v6.87.0，镜像 tests/listing-source-lock.test.ts 形态）：
// 18 个收编 cause 的「UPDATE players SET status」只允许出现在 src/worker/player-ops.ts；
// 原 9 个写点文件一律 0 命中。判据不剥注释、不做语法分析 —— 注释里残留同一串也算违规
// （宁枉勿纵：命中只会让人来看一眼，放行才是「又冒出一个直写点」的事故）。
//
// 与语义卡/施工表用词的两处口径对齐（实际实现与点名名称的差异，按实现锁，已报备）：
// ① core 侧实际导出是 PLAYER_PURE_CAUSES（10）+ PLAYER_RESTORE_CAUSES（6）+ PLAYER_TRANSITIONS
//    （18 键）+ resolveTarget，没有名为 PLAYER_STATUSES / PLAYER_CAUSES 的导出——五值状态词汇表
//    落在 PlayerStatus 类型上（运行时被擦除，用源码文本锁）；
// ② 21 cause = 18 收编（PLAYER_TRANSITIONS 的键）+ 3 例外（revert_snapshot / admin_set / retire），
//    例外按设计不进转移表（src/core/player-state.ts 头注释、测试计划 L8），在本文件以例外登记面
//    锁定：revert_snapshot / admin_set 的 compound 写点原样在场，retire 无生命周期写点（由第一条
//    零匹配锁代为看住）。
// compound 多列写法（UPDATE players SET club_id = ?, status = ?，status 非首列）不在锁面：
// 字面判据天然 0 命中，例外文件 deal-revert.ts / routes/admin/players.ts 在本文件登记在场性
//（防「顺手拆成单列收编」）；transfers.ts 的两处 compound（transfer_complete / terminate）同在
// 锁面之外，作为原 9 文件之一由零字面锁覆盖。
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PLAYER_PURE_CAUSES,
  PLAYER_RESTORE_CAUSES,
  PLAYER_TRANSITIONS,
  resolveTarget,
} from '../src/core/player-state.ts';
import { advance, advanceStatement, restoreAfterListing, restoreAfterNegotiation } from '../src/worker/player-ops.ts';

const SRC_ROOT = 'src';
const ALLOWLIST = ['src/worker/player-ops.ts'];
// 收编前 18 处字面写点的原宿主（v6.87.0 测试计划开工前实测，2026-11-16 基线 grep）
const LEGACY_WRITE_FILES = [
  'src/worker/routes/market.ts',
  'src/worker/offers.ts',
  'src/worker/activations.ts',
  'src/worker/bypass.ts',
  'src/worker/market-settle.ts',
  'src/worker/negotiations.ts',
  'src/worker/promotion.ts',
  'src/worker/transfers.ts',
  'src/worker/contracts-import.ts',
];
// 精确到 SET status：compound 多列写法（status 非首列）与非 status 写点（growth_tier /
// game_attrs / badges…）都不命中。i 标志 + 整文件空白归一化：小写写法、跨行写法
//（UPDATE players\nSET status）同样算违规（计划 L10）。
const WRITE_PATTERN = /UPDATE\s+players\s+SET\s+status/i;
const WRITE_PATTERN_GLOBAL = /UPDATE\s+players\s+SET\s+status/gi;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.ts') ? [p.replace(/\\/g, '/')] : [];
  });
}

/** 整文件归一化空白后匹配：跨行写法也能抓到；失败信息给文件名 + 截断的命中片段 */
function hits(files: string[], pattern: RegExp): string[] {
  return files.flatMap((f) => {
    const text = readFileSync(f, 'utf8').replace(/\s+/g, ' ');
    const at = text.search(pattern);
    if (at < 0) return [];
    const snippet = text.slice(Math.max(0, at - 40), at + 80);
    return [`${f}: …${snippet}…`];
  });
}

describe('players.status 写点源码锁', () => {
  const files = walk(SRC_ROOT);

  it('src 下除 player-ops.ts 外零匹配「UPDATE players SET status」', () => {
    // 防「扫描路径写错 → 空集通过」的假绿（src 当前 152 个 .ts，2026-11-16 实测）
    expect(files.length).toBeGreaterThan(100);
    const scanned = files.filter((f) => !ALLOWLIST.includes(f));
    expect(scanned.length).toBeGreaterThan(100);
    expect(hits(scanned, WRITE_PATTERN)).toEqual([]);
  });

  it('原 9 个写点文件各自 0 处——含被注释掉的旧 SQL', () => {
    expect(LEGACY_WRITE_FILES).toHaveLength(9);
    // 我的清单路径必须与 walk 产出同形（防分隔符/相对前缀写错让下面的 0 命中变成空转）
    expect(files).toEqual(expect.arrayContaining(LEGACY_WRITE_FILES));
    for (const f of LEGACY_WRITE_FILES) {
      expect(hits([f], WRITE_PATTERN)).toEqual([]);
    }
  });

  it('唯一写点 player-ops.ts 自身命中数 = 14（排除项不会把锁扫空）', () => {
    // 13 条 SQL 写点（10 个 pure cause 构造器，其中 forced_auction_list / forced_auction_cancel
    // 各两分支 + restoreAfterListing 共享模板）+ 1 处文件头注释里的同串（白名单文件内注释不算违规）。
    // 计数锁死的用意与 listing-source-lock 的 12 条同款：后续批新增 cause 必须有意识更新本锁。
    const normalized = readFileSync(ALLOWLIST[0], 'utf8').replace(/\s+/g, ' ');
    const all = normalized.match(WRITE_PATTERN_GLOBAL) ?? [];
    expect(all).toHaveLength(14);
  });

  it('src/core/player-state.ts 导出语义真源：转移表 + 两类 cause 集 + resolveTarget', () => {
    expect(typeof resolveTarget).toBe('function');
    expect(typeof PLAYER_TRANSITIONS).toBe('object');
    expect(Array.isArray(PLAYER_PURE_CAUSES)).toBe(true);
    expect(Array.isArray(PLAYER_RESTORE_CAUSES)).toBe(true);
    // 五值状态词汇表（PLAYER_STATUSES 语义）落在 PlayerStatus 类型上，运行时被擦除 ⇒ 源码文本锁
    const stateSrc = readFileSync('src/core/player-state.ts', 'utf8').replace(/\s+/g, ' ');
    expect(stateSrc).toContain("export type PlayerStatus = 'normal' | 'listed' | 'trainee' | 'free' | 'retired';");
  });

  it('src/worker/player-ops.ts 导出四个收编入口', () => {
    expect(typeof advanceStatement).toBe('function');
    expect(typeof advance).toBe('function');
    expect(typeof restoreAfterListing).toBe('function');
    expect(typeof restoreAfterNegotiation).toBe('function');
  });

  it('21 cause 台账：18 收编 cause 全在转移表且 kind 各归其位，3 例外 cause 登记不进表', () => {
    expect(PLAYER_PURE_CAUSES).toHaveLength(10);
    expect(PLAYER_RESTORE_CAUSES).toHaveLength(6);
    for (const cause of PLAYER_PURE_CAUSES) expect(PLAYER_TRANSITIONS[cause].kind).toBe('pure');
    for (const cause of PLAYER_RESTORE_CAUSES) expect(PLAYER_TRANSITIONS[cause].kind).toBe('restore');
    expect(PLAYER_TRANSITIONS.transfer_complete.kind).toBe('compound');
    expect(PLAYER_TRANSITIONS.terminate.kind).toBe('compound');
    const keys = Object.keys(PLAYER_TRANSITIONS);
    expect(keys).toHaveLength(18);
    // 转移表键与收编 cause 集精确相等：多出的键 = 未登记就收编的直写点；少一个 = 收编丢了
    expect(new Set(keys)).toEqual(
      new Set([...PLAYER_PURE_CAUSES, ...PLAYER_RESTORE_CAUSES, 'transfer_complete', 'terminate']),
    );
    // 例外 3 cause 有意不进表（src/core/player-state.ts 头注释、计划 L8）：进表 = 绕过例外登记
    const exceptions = ['revert_snapshot', 'admin_set', 'retire'];
    for (const cause of exceptions) expect(PLAYER_TRANSITIONS).not.toHaveProperty(cause);
    // 21 = 18 收编 + 3 例外，一个不少
    expect(keys.length + exceptions.length).toBe(21);
  });

  it('compound 例外写点原样在场：deal-revert 快照两列 / admin 动态白名单列不被收编', () => {
    // deal-revert.ts:114 快照驱动、零守卫、两列形态（登记原文，见测试计划 TC-CMP-03）
    const deal = readFileSync('src/worker/deal-revert.ts', 'utf8').replace(/\s+/g, ' ');
    expect(deal).toContain('UPDATE players SET club_id = ?, status = ? WHERE id = ?');
    // routes/admin/players.ts 两处（PATCH 单个 :135 / batch 分片 :220）同款动态列拼接（TC-CMP-04）
    const admin = readFileSync('src/worker/routes/admin/players.ts', 'utf8').replace(/\s+/g, ' ');
    expect(admin.split('UPDATE players SET ${cols.map').length - 1).toBe(2);
  });

  it('判据自检：注释残留 / 小写 / 跨行同样算违规；compound 与非 status 写不命中', () => {
    expect(WRITE_PATTERN.test(`// 旧实现：UPDATE players SET status = 'listed' WHERE id = ?`)).toBe(true);
    expect(WRITE_PATTERN.test(`update players set status = 'free' WHERE id = ?`)).toBe(true);
    expect(WRITE_PATTERN.test(`UPDATE players\n  SET status = 'normal' WHERE id = ?`)).toBe(true);
    // compound 多列写法（status 非首列）不在锁面——例外登记见上一条 it
    expect(WRITE_PATTERN.test(`UPDATE players SET club_id = ?, status = ? WHERE id = ?`)).toBe(false);
    expect(WRITE_PATTERN.test(`UPDATE players SET club_id = NULL, status = 'free' WHERE id = ?`)).toBe(false);
    // 非 status 写点代表例不误伤（31 处反向锁的抽样，见计划 TC-SRC-04）
    expect(WRITE_PATTERN.test(`UPDATE players SET game_attrs = json_set(game_attrs, '$.RoleID1', ?)`)).toBe(false);
    expect(WRITE_PATTERN.test(`UPDATE players SET growth_tier = ?, updated_at = ... WHERE id = ?`)).toBe(false);
    // 错表不命中（listings 侧另有 listing-source-lock 看守）
    expect(WRITE_PATTERN.test(`UPDATE listings SET status = 'delisted' WHERE id = ?`)).toBe(false);
  });

  it('期望串错一字必须不匹配：三处文本锁对逐位变异零命中', () => {
    const stateSrc = readFileSync('src/core/player-state.ts', 'utf8').replace(/\s+/g, ' ');
    const deal = readFileSync('src/worker/deal-revert.ts', 'utf8').replace(/\s+/g, ' ');
    const admin = readFileSync('src/worker/routes/admin/players.ts', 'utf8').replace(/\s+/g, ' ');
    const locks: Array<{ label: string; text: string; expected: string }> = [
      {
        label: 'player-state PlayerStatus 五值词汇表',
        text: stateSrc,
        expected: "export type PlayerStatus = 'normal' | 'listed' | 'trainee' | 'free' | 'retired';",
      },
      {
        label: 'deal-revert 快照两列写法',
        text: deal,
        expected: 'UPDATE players SET club_id = ?, status = ? WHERE id = ?',
      },
      {
        label: 'admin 动态白名单列写法',
        text: admin,
        expected: 'UPDATE players SET ${cols.map',
      },
    ];
    const stillMatching: string[] = [];
    for (const { label, text, expected } of locks) {
      expect(text).toContain(expected);
      for (let i = 0; i < expected.length; i++) {
        const alt = expected[i] === 'x' ? 'q' : 'x';
        const mutated = expected.slice(0, i) + alt + expected.slice(i + 1);
        if (text.includes(mutated)) {
          stillMatching.push(`${label} 第 ${i} 位（原字符 ${JSON.stringify(expected[i])}）错一字后仍命中`);
        }
      }
    }
    expect(stillMatching).toEqual([]);
  });
});
