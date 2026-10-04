// 守卫测试：前端时间显示只走共享时区层 lib/datetime.ts（v6.25.0，docs/test-plans/v6.25.0-timezone-display.md D 组）。
//
// 背景：v6.25.0 之前 web/src 里有三种并存的时间写法——裸切片 `iso.slice(0, 16).replace('T', ' ')`
// （恒 UTC，换显示时区后就是错的）、浏览器本地 `d.getHours()`（随设备漂移）、原 club/CoachPanel 的硬编码
// UTC 切片 +「（UTC）」标注。全部收敛到 datetime.ts（偏好三档、默认北京）之后，这里锁两条不变量：
//   1. Intl.DateTimeFormat / timeZone: 只允许出现在 datetime.ts —— 时区口径单点化，别的文件
//      各写各的 Intl 就等于把三种写法换个地方复发；
//   2. 裸切片模式清零 —— `.slice(0, 16).replace(` 与 `.slice(5, 16)` 两个精确模式，
//      误伤面最小（正常代码不会恰好这么切）。注意 `.slice(0, 16)` 本身不禁：别的字段真要取
//      前缀属于合法用途，禁的是「把 ISO 时间戳当 UTC 字符串切」的完整形态。
// 判据按行扫描并报文件:行号，宁枉勿纵：命中只会让人来看一眼，放行才是事故。
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCAN_ROOTS = ['web/src'];
const SCAN_EXT = ['.ts', '.tsx'];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return SCAN_EXT.some((ext) => e.name.endsWith(ext)) ? [p] : [];
  });
}

/** 逐行收集命中模式的 文件:行号 内容，失败时直接可读 */
function offenders(files: string[], pattern: RegExp): string[] {
  return files.flatMap((f) =>
    readFileSync(f, 'utf8')
      .split('\n')
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => pattern.test(line))
      .map(([n, line]) => `${f}:${n} ${line.trim()}`),
  );
}

const allFiles = SCAN_ROOTS.flatMap(walk);
const nonDatetime = allFiles.filter((f) => !f.includes('datetime'));

describe('前端时间显示单点化（v6.25.0）', () => {
  it('Intl.DateTimeFormat / timeZone: 只出现在 lib/datetime.ts', () => {
    expect(offenders(nonDatetime, /Intl\.DateTimeFormat|timeZone\s*:/)).toEqual([]);
  });

  it('裸 UTC 切片清零：.slice(0, 16).replace 与 .slice(5, 16) 全仓（含测试）不再出现', () => {
    expect(offenders(allFiles, /\.slice\(0,\s*16\)\s*\.replace\(|\.slice\(5,\s*16\)/)).toEqual([]);
  });

  it('判据自检：模式确实能命中目标写法（防正则失效空转）', () => {
    expect(/Intl\.DateTimeFormat|timeZone\s*:/.test("new Intl.DateTimeFormat('zh-CN')")).toBe(true);
    expect(/Intl\.DateTimeFormat|timeZone\s*:/.test('timeZone: zoneOf(pref)')).toBe(true);
    expect(/Intl\.DateTimeFormat|timeZone\s*:/.test('const slice = arr.slice(0, 16);')).toBe(false);
    expect(/\.slice\(0,\s*16\)\s*\.replace\(|\.slice\(5,\s*16\)/.test("iso.slice(0, 16).replace('T', ' ')")).toBe(true);
    expect(/\.slice\(0,\s*16\)\s*\.replace\(|\.slice\(5,\s*16\)/.test("iso.slice(5, 16)")).toBe(true);
    expect(/\.slice\(0,\s*16\)\s*\.replace\(|\.slice\(5,\s*16\)/.test('iso.slice(0, 10)')).toBe(false);
  });
});
