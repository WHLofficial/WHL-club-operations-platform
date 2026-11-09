// 挂单终态写点源码锁（v6.83.0 第二步）：
// 12 个收口 cause 的 listings 状态写入只允许出现在 src/worker/listing-ops.ts；
// 其余 src/**/*.ts 一律零匹配。判据不剥注释、不做语法分析 —— 注释里残留同一串也算违规
// （宁枉勿纵：命中只会让人来看一眼，放行才是「又冒出一个直写点」的事故）。
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = 'src';
const ALLOWLIST = ['src/worker/listing-ops.ts'];
// 精确到 SET status：只写 deadline_note / bid_paused 的两条（market-settle / admin market）不在收编范围
const WRITE_PATTERN = /UPDATE\s+listings\s+SET\s+status/;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.ts') ? [p.replace(/\\/g, '/')] : [];
  });
}

/** 逐行收集命中模式的 文件:行号 内容，失败时直接可读 */
function hits(files: string[], pattern: RegExp): string[] {
  return files.flatMap((f) =>
    readFileSync(f, 'utf8')
      .split('\n')
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => pattern.test(line))
      .map(([n, line]) => `${f}:${n} ${line.trim()}`),
  );
}

describe('挂单状态写点源码锁', () => {
  const files = walk(SRC_ROOT);

  it('src 下除 listing-ops.ts 外零匹配「UPDATE listings SET status」', () => {
    const scanned = files.filter((f) => !ALLOWLIST.includes(f));
    // 防「扫描路径写错 → 空集通过」的假绿
    expect(scanned.length).toBeGreaterThan(100);
    expect(hits(scanned, WRITE_PATTERN)).toEqual([]);
  });

  it('白名单文件本身确有 12 条写点（排除项不会把锁扫空）', () => {
    const sqlLines = readFileSync(ALLOWLIST[0], 'utf8')
      .split('\n')
      .filter((line) => /^\s*sql: `UPDATE listings SET status/.test(line));
    expect(sqlLines).toHaveLength(12);
  });

  it('判据自检：注释里残留的同一串同样算违规', () => {
    expect(WRITE_PATTERN.test(`// 旧实现：UPDATE listings SET status = 'delisted' WHERE id = ?`)).toBe(true);
    expect(WRITE_PATTERN.test(`UPDATE listings SET deadline_note = ? WHERE id = ?`)).toBe(false);
    expect(WRITE_PATTERN.test(`UPDATE listings SET bid_paused = ? WHERE id = ?`)).toBe(false);
  });
});
