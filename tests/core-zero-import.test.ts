// 守卫测试：进前端 bundle 的 core 数据模块必须保持零 import。
// 前端跨目录 import 了 src/core/fc26.ts 与 src/core/players-sort.ts（球员库的列/属性/排序键表），
// 一旦这些文件里出现 import，被引到的模块（env、hono、D1 绑定类型…）就会顺着进前端 bundle，
// 而这类错误在类型检查与组件测试里都不会报 —— 只在打包产物里变胖、或运行时才炸。
//
// 判据必须认「模块说明符」（from 后面跟引号）。原先只写 `export\s+.*\bfrom\b`，把纯表达式也算成了
// 依赖：v3.2.1 往 fc26.ts 加了个由 PS_SLOT_COUNT 派生的数组常量（`= Array.from(...)`），守卫当场误报。
// 动态 import（`await import('./x')`）不在行首，所以另加一条不锚行首的 `\bimport\s*\(`；代价是
// 注释/字符串里出现 `import(` 也会命中 —— 对守卫来说宁枉勿纵（命中只会让人来看一眼）。
// 已知边界：多行 `export {\n …\n} from '…'` 抓不到（`from` 与 `export` 不在同一行），沿用原判据。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PURE_DATA_MODULES = ['src/core/fc26.ts', 'src/core/players-sort.ts'];

function hasStaticDependency(line: string): boolean {
  return (
    /^\s*import\b/.test(line) ||
    /^\s*export\b[^'"]*\bfrom\s+['"]/.test(line) ||
    /\b(?:import|require)\s*\(/.test(line)
  );
}

describe('前端共用的 core 数据模块', () => {
  it('判据只认模块说明符（`Array.from(` 这类纯表达式不算依赖）', () => {
    expect(hasStaticDependency('export const PS_SLOT_KEYS: readonly string[] = Array.from(')).toBe(false);
    expect(hasStaticDependency("const t = Array.from('ab');")).toBe(false);
    expect(hasStaticDependency("import { readFileSync } from 'node:fs';")).toBe(true);
    expect(hasStaticDependency("import type { Env } from './env.ts';")).toBe(true);
    expect(hasStaticDependency("export * from './a.ts';")).toBe(true);
    expect(hasStaticDependency("export { a } from './a.ts';")).toBe(true);
    expect(hasStaticDependency("export type { A } from './a.ts';")).toBe(true);
    expect(hasStaticDependency("const x = require('node:fs');")).toBe(true);
    // 动态 import 不在行首：行首判据抓不到，靠这条不锚行首的分支
    expect(hasStaticDependency("const env = await import('./env.ts');")).toBe(true);
    expect(hasStaticDependency("  const lazy = () => import('./env.ts');")).toBe(true);
  });

  for (const path of PURE_DATA_MODULES) {
    it(`${path} 零 import`, () => {
      const src = readFileSync(path, 'utf8');
      const offenders = src
        .split('\n')
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => hasStaticDependency(line));
      expect(
        offenders.map(([n, line]) => `${path}:${n} ${line.trim()}`),
        '这些模块会被打进前端 bundle，不能有依赖',
      ).toEqual([]);
    });
  }
});
