// 轻量名册的解析与本地推荐（增量 26 步骤 7）。
//
// 数据源是 GET /api/players/roster（步骤 2 加的）：一条 SQL 把全库姓名/归属拼成多行文本，
// 每行「姓名|俱乐部ID|球员ID」，俱乐部为空时省略中间那段（姓名在前、数字在后，从行尾反向切分，
// 姓名里出现分隔符也不会串字段）。意图是「聚焦搜索框时预载一次，之后打字全在本地过滤」——
// 打字即请求会把公开 GET 的 60 请求/60 秒限流打爆（src/lib/guard.ts），也会把进程内缓存
// （MAX_CACHE_ENTRIES = 64）逐键击占满。
//
// 折叠用 src/core/name-fold.ts 的 foldName，与后端 sqlFold 同一张表 —— 本地推荐命中的名字，
// 提交给服务端搜索也一定命中（反过来也一样）。
import { foldName } from '../../../src/core/name-fold.ts';

export interface RosterEntry {
  id: number;
  name: string;
  clubId: number | null;
  /** 折叠后的姓名，用于比较（大写、变音、软连字符都已在 foldName 里处理） */
  folded: string;
}

export interface RosterBody {
  roster: string;
  count: number;
}

export function parseRoster(roster: string): RosterEntry[] {
  const out: RosterEntry[] = [];
  for (const line of roster.split('\n')) {
    if (line === '') continue;
    const last = line.lastIndexOf('|');
    if (last <= 0) continue;
    const id = Number(line.slice(last + 1));
    if (!Number.isInteger(id) || id <= 0) continue;
    const head = line.slice(0, last);
    const sep = head.lastIndexOf('|');
    // 空段（`名字||90003`）也当没有俱乐部：Number('') 是 0，不拦就会变成「第 0 号俱乐部」
    const clubField = sep < 0 ? '' : head.slice(sep + 1);
    const name = sep < 0 ? head : head.slice(0, sep);
    if (name === '') continue;
    const clubNum = clubField === '' ? Number.NaN : Number(clubField);
    out.push({ id, name, clubId: Number.isInteger(clubNum) ? clubNum : null, folded: foldName(name) });
  }
  return out;
}

/** 下拉最多显示几条（决策 12 的「若干项推荐」） */
export const ROSTER_SUGGEST_LIMIT = 8;

/**
 * 本地推荐：前缀命中优先于中间命中，各自按姓名序（同分按 id）。
 * 只按姓名匹配 —— 搜索框的语义就是姓名（与 /api/players?name= 一致）。
 */
export function suggestPlayers(entries: readonly RosterEntry[], query: string, limit = ROSTER_SUGGEST_LIMIT): RosterEntry[] {
  const q = foldName(query.trim());
  if (q === '') return [];
  const prefix: RosterEntry[] = [];
  const inner: RosterEntry[] = [];
  for (const e of entries) {
    const at = e.folded.indexOf(q);
    if (at === 0) prefix.push(e);
    else if (at > 0) inner.push(e);
  }
  const byName = (a: RosterEntry, b: RosterEntry) => (a.folded < b.folded ? -1 : a.folded > b.folded ? 1 : a.id - b.id);
  prefix.sort(byName);
  inner.sort(byName);
  return [...prefix, ...inner].slice(0, limit);
}
