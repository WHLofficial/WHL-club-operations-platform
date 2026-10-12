// capture-authoritative.mjs —— 抓「插件推送后的权威天气输入」（S9 天气订正批）
//
// 时点要求：**必须在插件 `/主场天气推送` 之后抓**。推送会把插件的权威 (weather, coef) 写进
// 平台 match_weather（forecast_by='revenue-plugin'）；这份就是订正批要收敛到的输入真源。
//
// 用法：node capture-authoritative.mjs [--local]
//   --local 抓本地夹具（演练用）；默认 --remote（生产只读）。
// 安全：只执行 SELECT，不写任何数据。
//
// 输出：authoritative.json（{ capturedAt, rows }），供 gen-recalc-sql.ts 读取。
// 只收 forecast_by='revenue-plugin' 的行：平台管理端自掷的预报行（forecast_by=1）不是权威输入，
// 混进来会把「用平台的掷替换平台的掷」当成订正。

import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const remote = !process.argv.includes('--local');
const scope = remote ? '--remote' : '--local';
const DIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const DB = 'whl-club';
const SQL =
  "SELECT match_id, club_id, season, tournament_id, round, weather, wx_coef, forecast_by, created_at " +
  "FROM match_weather WHERE forecast_by = 'revenue-plugin' ORDER BY tournament_id, round, match_id";

const cmd = `npx wrangler d1 execute ${DB} ${scope} --json --command "${SQL}"`;
const res = spawnSync(cmd, { shell: true, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
if (res.status !== 0) {
  console.error(`抓取失败（exit ${res.status}）：`);
  console.error((res.stderr || res.stdout || '').slice(0, 2000));
  process.exit(1);
}
const m = res.stdout.match(/^\[/m);
if (!m || m.index == null) throw new Error('输出里没有以行首 [ 开始的 JSON');
const rows = JSON.parse(res.stdout.slice(m.index))[0]?.results ?? [];
if (rows.length === 0) {
  console.error('match_weather 里没有 forecast_by=revenue-plugin 的行——插件还没推送，或推送全部 unmatched。');
  console.error('先跑插件 `/主场天气推送`，确认回执里「平台落库 N/M 场」N>0 再抓。');
  process.exit(2);
}
writeFileSync(`${DIR}authoritative.json`, `${JSON.stringify({ capturedAt: new Date().toISOString(), scope, db: DB, rows }, null, 2)}\n`);
console.log(`已写出 ${DIR}authoritative.json：${rows.length} 行（${scope}）`);
