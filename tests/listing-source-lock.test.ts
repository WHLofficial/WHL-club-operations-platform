// 挂单终态写点源码锁（v6.83.0 第二步）：
// 12 个收口 cause 的 listings 状态写入只允许出现在 src/worker/listing-ops.ts；
// 其余 src/**/*.ts 一律零匹配。判据不剥注释、不做语法分析 —— 注释里残留同一串也算违规
// （宁枉勿纵：命中只会让人来看一眼，放行才是「又冒出一个直写点」的事故）。
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = 'src';
const ALLOWLIST = ['src/worker/listing-ops.ts'];
// 精确到 SET status：只写 deadline_note / bid_paused 的两条（market-settle / admin market）不在收编范围。
// i 标志与空白归一化：小写写法、跨行写法（UPDATE listings\nSET status）同样算违规（计划 L11）。
const WRITE_PATTERN = /UPDATE\s+listings\s+SET\s+status/i;

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

describe('挂单状态写点源码锁', () => {
  const files = walk(SRC_ROOT);

  it('src 下除 listing-ops.ts 外零匹配「UPDATE listings SET status」', () => {
    const scanned = files.filter((f) => !ALLOWLIST.includes(f));
    // 防「扫描路径写错 → 空集通过」的假绿
    expect(scanned.length).toBeGreaterThan(100);
    expect(hits(scanned, WRITE_PATTERN)).toEqual([]);
  });

  it('白名单文件本身确有 12 条写点（排除项不会把锁扫空）', () => {
    // 与 hits 同口径：空白归一化后按全文计数（跨行写法不能改变条数）
    const normalized = readFileSync(ALLOWLIST[0], 'utf8').replace(/\s+/g, ' ');
    const sqlSites = normalized.match(/sql: `UPDATE listings SET status/gi) ?? [];
    expect(sqlSites).toHaveLength(12);
  });

  it('判据自检：注释里残留的同一串、小写与跨行写法同样算违规', () => {
    expect(WRITE_PATTERN.test(`// 旧实现：UPDATE listings SET status = 'delisted' WHERE id = ?`)).toBe(true);
    expect(WRITE_PATTERN.test(`update listings set status = 'delisted' WHERE id = ?`)).toBe(true);
    expect(WRITE_PATTERN.test(`UPDATE listings\n  SET status = 'delisted' WHERE id = ?`)).toBe(true);
    expect(WRITE_PATTERN.test(`UPDATE listings SET deadline_note = ? WHERE id = ?`)).toBe(false);
    expect(WRITE_PATTERN.test(`UPDATE listings SET bid_paused = ? WHERE id = ?`)).toBe(false);
  });

  it('TC-TRG-05 0059 过线闸门与 first_bid 双窗守卫三条件成对（文本锁）', () => {
    const trigger = readFileSync('src/db/migrations/0059_bid_guard_activation.sql', 'utf8').replace(/\s+/g, ' ');
    const ops = readFileSync('src/worker/listing-ops.ts', 'utf8').replace(/\s+/g, ' ');

    // 条件①：deadline_at 非空且已过线 → ABORT
    expect(trigger).toContain(
      "(SELECT deadline_at FROM listings WHERE id = NEW.ref_id) IS NOT NULL AND (SELECT deadline_at FROM listings WHERE id = NEW.ref_id) <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
    );
    // 条件②③：activation_deadline 非空 + activated_by 非空且已过线 → ABORT
    expect(trigger).toContain(
      '(SELECT activation_deadline FROM listings WHERE id = NEW.ref_id) IS NOT NULL AND (SELECT activated_by FROM listings WHERE id = NEW.ref_id) IS NOT NULL',
    );
    expect(trigger).toContain(
      "(SELECT activation_deadline FROM listings WHERE id = NEW.ref_id) <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
    );

    // first_bid 语句必须与闸门同口径：两窗都是「NULL 或未来」才放行
    const firstBid = ops.slice(ops.indexOf("case 'first_bid'"), ops.indexOf("case 'activation_match_start'"));
    expect(firstBid).toContain('(deadline_at IS NULL OR deadline_at > ${nowSql()})');
    expect(firstBid).toContain('(activation_deadline IS NULL OR activation_deadline > ${nowSql()})');
  });
});
