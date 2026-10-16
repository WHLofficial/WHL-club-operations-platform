// 生成 src/core/fc26-team-names.ts（FC26 队名表的 Worker 侧镜像）。
// 源表：web/assets/ref/team.json —— 由 scripts/gen_ref_json.py 从 FC26db 抽取（含 4 支假名队改回真名的覆盖）。
// 用法：node scripts/gen-fc26-team-names.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = new URL('../web/assets/ref/team.json', import.meta.url);
const OUT = new URL('../src/core/fc26-team-names.ts', import.meta.url);

const ref = JSON.parse(readFileSync(SRC, 'utf8'));
const rows = [...ref]
  .sort((a, b) => a.id - b.id)
  .map((t) => `  ${t.id}: ${JSON.stringify(t.name)},`);

const out = `// FC26 队名表（TeamID 空间）：web/assets/ref/team.json 的 Worker 侧镜像。
// 两侧同源（scripts/gen_ref_json.py 从 FC26db 抽取，含 4 支假名队改回游戏真名的覆盖），
// 一致性由 tests/fc26-teams.test.ts 逐条断言；换赛季重跑：node scripts/gen-fc26-team-names.mjs
// 用途：截图识别的英文队名兜底分侧（v6.51.8）——模型把队名写成截图上的英文原文（如 OLYMPIACOS FC）时，
// 用这张表把英文名还原成 FC26 队号，再与本场两侧的 clubId（= FC26 队号）对齐，不必让用户点按钮选边。

export const FC26_TEAM_NAMES: Record<number, string> = {
${rows.join('\n')}
};

/** 按 FC26 队号取队名（未收录回 null）。 */
export function fc26TeamName(id: number): string | null {
  return FC26_TEAM_NAMES[id] ?? null;
}
`;

writeFileSync(OUT, out);
console.log(`已生成 src/core/fc26-team-names.ts（${ref.length} 条）`);
