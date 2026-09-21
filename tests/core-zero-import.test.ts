// 守卫测试：进前端 bundle 的 core 数据模块必须保持零 import。
// 前端跨目录 import 了 src/core/fc26.ts 与 src/core/players-sort.ts（球员库的列/属性/排序键表），
// 一旦这些文件里出现 import，被引到的模块（env、hono、D1 绑定类型…）就会顺着进前端 bundle，
// 而这类错误在类型检查与组件测试里都不会报 —— 只在打包产物里变胖、或运行时才炸。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PURE_DATA_MODULES = ['src/core/fc26.ts', 'src/core/players-sort.ts'];

describe('前端共用的 core 数据模块', () => {
  for (const path of PURE_DATA_MODULES) {
    it(`${path} 零 import`, () => {
      const src = readFileSync(path, 'utf8');
      // 匹配行首的 import/export ... from 与 require(，注释里的字眼不算
      const offenders = src
        .split('\n')
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => /^\s*(import\b|export\s+.*\bfrom\b)/.test(line) || /\brequire\s*\(/.test(line));
      expect(
        offenders.map(([n, line]) => `${path}:${n} ${line.trim()}`),
        '这些模块会被打进前端 bundle，不能有依赖',
      ).toEqual([]);
    });
  }
});
