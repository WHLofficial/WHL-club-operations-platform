// 球员姓名口径（增量 32）
//
//   players.name          FC26db 官方缩写名（`E. Haaland`），导入对齐键 fc_id 的伴生列，语义永不变
//   players.display_name  FC26 存档派生的人名（`Erling Haaland`），来源与规则见 scripts/player-names/
//   players.common_name   FC26 的常用名（`Cristiano Ronaldo`）；first_name / last_name 是字典里的名与姓
//
// 面向前端的输出一律取显示名：派生到了用派生的，没派生到（长尾球员）回落缩写名 —— 所以是
// COALESCE 而不是直接取 display_name。**不要在别处手写这个 COALESCE**：派生口径要变时
// （比如换一份更全的姓名字典），改动点必须只有这一处。
//
// 搜索是例外，要同时匹配两列（见 src/worker/routes/players.ts 的 name 筛选）：几百人的显示名是
// FC26 的单词常用名（`Ederson`、`Isaac`），只看显示名就按姓搜不到他们；反过来只看 name，
// 则按派生全名（`Erling Haaland`）搜不到。

/** 库侧显示名表达式：派生到用派生的（`display_name`），没派生到回落 FC26db 缩写名（`name`）。 */
export function sqlDisplayName(table = 'players'): string {
  return `COALESCE(${table}.display_name, ${table}.name)`;
}

/** 行侧同口径：SQL 已带出 `display_name` 时用它（`name` 仍是库里的缩写名）。 */
export function rowDisplayName(row: { display_name?: string | null; name: string }): string {
  return row.display_name ?? row.name;
}
