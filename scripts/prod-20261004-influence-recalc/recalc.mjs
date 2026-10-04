#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// v6.28.0 C 段「影响力图值导入 + 死忠重算 + 历史链式重演」生产数据批 CLI
//
//   快照：node recalc.mjs snapshot [--out .] [--account <id>] [--token <t>]
//   计划：node recalc.mjs plan     [--allow-missing] [--initials default|prod]
//   执行：node recalc.mjs apply    [--yes] [--force]     （默认只打印，不落库）
//   校验：node recalc.mjs verify                         （只读回读生产并断言守恒）
//
// 为什么 snapshot/plan 分离：重演必须可离线反复推演（plan 是纯函数，不碰网络也不碰 DB），
// 只有 apply 会在拿到 --yes 后经 wrangler 逐文件落库，且落库前先备份 + 落 marker 防重。
// 本文件**不 import 任何 worker 代码**（.mjs 无法直接吃 TS），公式镜像在 engine.mjs，
// 由 tests/influence-recalc-engine.test.ts 与 src/worker/home.ts 做逐字交叉验证兜住漂移。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as E from './engine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_FILE = path.join(HERE, 'snapshot.json');
const PLAN_FILE = path.join(HERE, 'plan.json');
const REPORT_FILE = path.join(HERE, 'report.md');
const SQL_DIR = path.join(HERE, 'sql');
const BACKUP_DIR = path.join(HERE, 'backup');
const MARKER_FILE = path.join(HERE, 'applied.marker');
const VALUES_FILE = path.join(HERE, 'values.json');

// 生产三库 id（只读查询用；写操作永远只经 wrangler 打到 whl-club）
const DB_IDS = {
  club: '73154873-d5ae-42b0-a630-25f5ef60053d',
  tour: 'ec3cc695-70bc-47ab-a454-5ca62ec22dd6',
  auth: 'b76d1129-77ae-4844-931c-1c7b00a9b048',
};
const DEFAULT_ACCOUNT = '47f02bad5907ee6539e8aff008a01cec';
// 本机对 api.cloudflare.com 的 DNS 间歇抽风（wrangler 也会中招）⇒ 直连 IPv4 候选
const IP_CANDIDATES = ['104.19.193.29', '104.19.192.29', '104.19.192.176'];
const SEASON = 9;
const WINDOW_SEQ = 1;

const argv = process.argv.slice(2);
const cmd = argv[0];
function flag(name) {
  return argv.includes(`--${name}`);
}
// 取值型 flag：同时接受 `--name=value` 与 `--name value`。
// 为什么要两种：只认等号形式时，手打 `--initials prod` 会被静默忽略、按默认口径跑完，
// 干跑数字看着"成功"其实是错的口径——比报错更危险。
function opt(name, fallback = null) {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return fallback;
}
function die(msg) {
  console.error(`\n[中止] ${msg}\n`);
  process.exit(1);
}
const log = (...a) => console.log(...a);

// ───────────────────────────── CF REST（只读） ─────────────────────────────

function readWranglerToken() {
  const candidates = [
    process.env.WRANGLER_OAUTH_TOKEN,
    process.env.APPDATA ? path.join(process.env.APPDATA, 'xdg.config/.wrangler/config/default.toml') : null,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.wrangler/config/default.toml') : null,
    process.env.XDG_CONFIG_HOME ? path.join(process.env.XDG_CONFIG_HOME, '.wrangler/config/default.toml') : null,
    process.env.HOME ? path.join(process.env.HOME, '.config/.wrangler/config/default.toml') : null,
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      const txt = fs.readFileSync(p, 'utf8');
      const m = txt.match(/oauth_token\s*=\s*"([^"]+)"/);
      if (m) return { token: m[1], from: p };
    } catch {
      /* 下一个候选 */
    }
  }
  return null;
}

/** 一次 D1 REST 查询（带 IPv4 直连与候选重试）。 */
function cfQuery(dbId, sql, params = [], account = DEFAULT_ACCOUNT, token = null) {
  const body = JSON.stringify(params.length ? { sql, params } : { sql });
  const attempt = (ip) =>
    new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'api.cloudflare.com',
          port: 443,
          path: `/client/v4/accounts/${account}/d1/database/${dbId}/query`,
          method: 'POST',
          servername: 'api.cloudflare.com',
          family: 4,
          lookup: (_h, _o, cb) => cb(null, ip, 4),
          headers: {
            Authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
          },
          timeout: 30000,
        },
        (res) => {
          let buf = '';
          res.on('data', (d) => (buf += d));
          res.on('end', () => {
            try {
              const json = JSON.parse(buf);
              if (!json.success) return reject(new Error(JSON.stringify(json.errors ?? json)));
              const first = json.result?.[0];
              if (!first?.success) return reject(new Error(JSON.stringify(first?.error ?? first)));
              resolve({ rows: first.results ?? [], meta: first.meta ?? {} });
            } catch (e) {
              reject(new Error(`响应解析失败: ${e.message} · ${buf.slice(0, 200)}`));
            }
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      req.end(body);
    });
  return (async () => {
    let lastErr = null;
    for (const ip of IP_CANDIDATES) {
      try {
        return await attempt(ip);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  })();
}

async function fetchTable(dbId, table, account, token) {
  const { rows } = await cfQuery(dbId, `SELECT * FROM ${table}`, [], account, token);
  return rows;
}

// ───────────────────────────── SQL 字面量工具 ─────────────────────────────

/** 数值字面量：整数原样、浮点走最短往返表示（JS Number 默认 toString 即最短往返）。 */
function sqlNum(v) {
  if (v === null || v === undefined) return 'NULL';
  if (!Number.isFinite(v)) die(`非有限数不能写入 SQL：${v}`);
  return String(v);
}
function sqlStr(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}
function round2(x) {
  return Math.round(x * 100) / 100;
}

// ───────────────────────────── 配置解析 ─────────────────────────────

/** 运行期配置解析（与 src/core/config.ts 同语义：整键命中就直用、否则出厂默认）。 */
function resolveConfig(snapshot) {
  const rows = new Map((snapshot.tables.config ?? []).map((r) => [r.key ?? r.name, r.value]));
  const notes = [];
  let model;
  if (rows.has('attendance_model')) {
    model = JSON.parse(rows.get('attendance_model'));
    notes.push('attendance_model 来自生产 config 表（整键直用，无逐键兜底——与运行期一致）');
  } else {
    model = E.cloneModel();
    notes.push('attendance_model 生产未配置 ⇒ 运行期同样走出厂默认（config.ts:132）');
  }
  let tierTable;
  if (rows.has('tier_table')) {
    tierTable = JSON.parse(rows.get('tier_table'));
    notes.push('tier_table 来自生产 config 表');
  } else {
    tierTable = JSON.parse(JSON.stringify(E.TIER_TABLE_DEFAULTS));
    notes.push('tier_table 生产未配置 ⇒ 出厂默认');
  }
  let influenceCoefs;
  if (rows.has('influence_tier_coefs')) {
    const raw = JSON.parse(rows.get('influence_tier_coefs'));
    influenceCoefs = {
      premier: typeof raw?.premier === 'number' && Number.isFinite(raw.premier) ? raw.premier : 1.2,
      second: typeof raw?.second === 'number' && Number.isFinite(raw.second) ? raw.second : 1.0,
    };
    notes.push('influence_tier_coefs 来自生产 config 表（逐档兜底同运行期）');
  } else {
    influenceCoefs = { ...E.INFLUENCE_TIER_COEF_DEFAULTS };
    notes.push('influence_tier_coefs 生产未配置 ⇒ 出厂 {premier:1.2, second:1.0}');
  }
  const getNumber = (key, fallback) => {
    if (rows.has(key)) {
      const n = Number(rows.get(key));
      if (Number.isFinite(n)) return n; // 运行期 getNumber：库里值解析失败才回默认
    }
    const def = E.PER_MATCH_DEFAULTS[key];
    if (def !== undefined) return def;
    return fallback;
  };
  const perMatch = {
    growRate: getNumber('fans_grow_rate_per_match', model.fans_grow_rate * 0.4),
    dropRate: getNumber('fans_drop_rate_per_match', model.fans_drop_rate * 0.4),
  };
  return { model, tierTable, influenceCoefs, perMatch, notes };
}

// ───────────────────────────── CPU 预置一致性闸 ─────────────────────────────

/** 从 src/worker/routes/admin/clubs.ts 文本里抽 CPU_SEED_PRESETS，与 values.json 对拍（防两处口径漂移）。 */
function readCpuSeedPresets() {
  const src = path.join(HERE, '..', '..', 'src', 'worker', 'routes', 'admin', 'clubs.ts');
  const txt = fs.readFileSync(src, 'utf8');
  const block = txt.match(/CPU_SEED_PRESETS[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!block) return null;
  const out = {};
  const re = /(\d+)\s*:\s*\{\s*leagueTier:\s*'(premier|second)'\s*,\s*shellInfluence:\s*([\d.]+)\s*,\s*bonusPoints:\s*([\d.]+)\s*\}/g;
  let m;
  while ((m = re.exec(block[1]))) out[m[1]] = { tier: m[2], shell_influence: Number(m[3]), bonus_points: Number(m[4]) };
  return out;
}

// ───────────────────────────── snapshot ─────────────────────────────

const EMPTY_TABLES = ['naming_contracts', 'event_occurrences', 'venue_bookings'];

async function cmdSnapshot() {
  const account = opt('account', DEFAULT_ACCOUNT);
  let token = opt('token');
  let tokenFrom = '--token';
  if (!token) {
    const found = readWranglerToken();
    if (!found) die('找不到 wrangler oauth_token（先跑 `npx wrangler whoami` 刷新，或传 --token）');
    token = found.token;
    tokenFrom = found.from;
  }
  const clubTables = [
    'clubs',
    'stadiums',
    'club_facilities',
    'match_attendance',
    'match_weather',
    'ledger_entries',
    'ledger_accounts',
    'season_windows',
    'seasons',
    'season_tournaments',
    'naming_contracts',
    'event_occurrences',
    'venue_bookings',
    'config',
    'result_confirmations',
  ];
  const tables = {};
  const rowCounts = {};
  for (const t of clubTables) {
    const rows = await fetchTable(DB_IDS.club, t, account, token);
    tables[t] = rows;
    rowCounts[t] = rows.length;
    log(`  club.${t}: ${rows.length} 行`);
  }
  // 影响力分子要用在册现行合同关联的球员行（playerInfluenceSum 的同一 JOIN）
  const playerRows = await cfQuery(
    DB_IDS.club,
    'SELECT ct.club_id AS club_id, p.prestige AS prestige, p.ca AS ca, p.pa AS pa, p.growable AS growable FROM players p JOIN contracts ct ON ct.player_id = p.id AND ct.is_active = 1 ORDER BY ct.club_id, p.id',
    [],
    account,
    token,
  );
  tables.player_influence_rows = playerRows.rows;
  rowCounts.player_influence_rows = playerRows.rows.length;
  log(`  club.players⋈contracts(is_active=1): ${playerRows.rows.length} 行`);

  tables.auth_team = await fetchTable(DB_IDS.auth, 'team', account, token);
  rowCounts.auth_team = tables.auth_team.length;
  tables.tour_entry = await fetchTable(DB_IDS.tour, 'entry', account, token);
  rowCounts.tour_entry = tables.tour_entry.length;
  log(`  auth.team: ${rowCounts.auth_team} 行 · tour.entry: ${rowCounts.tour_entry} 行`);

  // 前置断言：三张表必须为空（重演不复现冠名/事件/档期活动的交错）
  const nonEmpty = EMPTY_TABLES.filter((t) => (tables[t] ?? []).length > 0);
  if (nonEmpty.length) die(`前置断言失败：${nonEmpty.join('、')} 非空 ⇒ 重演口径（无冠名/事件/档期活动）不成立，先扩口径再跑`);

  const snapshot = {
    fetchedAt: new Date().toISOString(),
    account,
    tokenFrom,
    databases: DB_IDS,
    season: SEASON,
    windowSeq: WINDOW_SEQ,
    rowCounts,
    emptyTablesAsserted: EMPTY_TABLES,
    stadiumsHasFansWindowStart: (tables.stadiums?.[0] ? Object.keys(tables.stadiums[0]).includes('fans_window_start') : false),
    tables,
  };
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
  log(`\n快照已写入 ${SNAPSHOT_FILE}`);
  log(`  stadiums.fans_window_start 列存在：${snapshot.stadiumsHasFansWindowStart ? '是' : '否（迁移 0062 未 apply ⇒ 禁止执行本批）'}`);
}

// ───────────────────────────── plan ─────────────────────────────

function loadJson(file, label) {
  if (!fs.existsSync(file)) die(`${label} 不存在（先跑上一步）：${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function buildPlan(snapshot, values, allowMissing, initialsMode, assumeMigrated) {
  const checks = [];
  const push = (name, ok, detail) => checks.push({ name, ok, detail });

  // 1) 配置与规模
  const cfg = resolveConfig(snapshot);
  const { model, tierTable, influenceCoefs, perMatch } = cfg;
  if (!snapshot.stadiumsHasFansWindowStart && !assumeMigrated) {
    die(
      '前置条件不满足：stadiums.fans_window_start 列不存在（迁移 0062 尚未 apply）⇒ 先 apply 0062 再跑本批。\n' +
        '      （只想离线看数：加 --assume-migrated，出的是"0062 落地后"的预期；apply 前必须真跑 0062）',
    );
  }
  if (!snapshot.stadiumsHasFansWindowStart && assumeMigrated) {
    push('迁移 0062 已 apply', false, '快照显示 fans_window_start 列不存在；本次带 --assume-migrated 只为离线看数，执行前必须先 apply 0062');
  } else {
    push('迁移 0062 已 apply（fans_window_start 列存在）', true, '是');
  }

  // 2) 生产实况断言
  const emptyBad = EMPTY_TABLES.filter((t) => (snapshot.tables[t] ?? []).length > 0);
  if (emptyBad.length) die(`前置断言失败：${emptyBad.join('、')} 非空`);
  const matchWeatherRows = snapshot.tables.match_weather ?? [];
  push('match_weather 为空（无赛前预报 ⇒ wx 全程取区间中点）', matchWeatherRows.length === 0, `${matchWeatherRows.length} 行`);

  const windows = snapshot.tables.season_windows ?? [];
  push('season_windows 只有 1 行', windows.length === 1, JSON.stringify(windows.map((w) => ({ id: w.id, season: w.season, seq: w.window_seq, status: w.status }))));

  // 3) 值表 × 生产交叉校验
  const valueTeams = values.teams;
  const byId = new Map(valueTeams.map((t) => [t.club_id, t]));
  const stadiums = snapshot.tables.stadiums ?? [];
  const stadiumByClub = new Map(stadiums.map((s) => [s.club_id, s]));
  const missingStadium = valueTeams.filter((t) => !t.cpu && !stadiumByClub.has(t.club_id)).map((t) => t.club_id);
  push('人类队都有 stadium 行', missingStadium.length === 0, missingStadium.length ? `缺：${missingStadium}` : `${valueTeams.filter((t) => !t.cpu).length}/16`);
  const orphanStadium = stadiums.filter((s) => !byId.has(s.club_id)).map((s) => s.club_id);
  push('stadiums 行都在图值表内', orphanStadium.length === 0, orphanStadium.length ? `多出：${orphanStadium}` : '16 行');
  const cpuWithStadium = valueTeams.filter((t) => t.cpu && stadiumByClub.has(t.club_id)).map((t) => t.club_id);
  push('CPU 队无 stadium 行（本批不写）', cpuWithStadium.length === 0, cpuWithStadium.length ? `异常：${cpuWithStadium}` : '4 队均无');

  // 3b) CPU_SEED_PRESETS 一致性闸
  const presets = readCpuSeedPresets();
  if (!presets) {
    push('CPU_SEED_PRESETS 一致性', false, '未能从 clubs.ts 解析 CPU_SEED_PRESETS');
  } else {
    const bad = [];
    for (const [id, p] of Object.entries(values.cpu_seed_presets_expectation ?? {})) {
      if (!p.comment && !p.tier) continue;
      const code = presets[id];
      const v = valueTeams.find((t) => String(t.club_id) === id);
      if (!code || !v) bad.push(`${id}: 缺项`);
      else if (code.tier !== v.tier || code.shell_influence !== v.shell_influence || code.bonus_points !== v.bonus_points)
        bad.push(`${id}: 代码 ${JSON.stringify(code)} vs 图值 ${JSON.stringify({ tier: v.tier, shell_influence: v.shell_influence, bonus_points: v.bonus_points })}`);
    }
    push('CPU 图值与 CPU_SEED_PRESETS 逐字一致', bad.length === 0, bad.length ? bad.join(' · ') : '4/4 一致');
    if (bad.length) die(`CPU 图值与代码预置不一致（防两处口径漂移的闸）：${bad.join(' · ')}`);
  }

  // 4) 级别（deriveClubTier 报名派生）交叉校验
  const authTeam = snapshot.tables.auth_team ?? [];
  const tourTeamByClub = new Map();
  for (const t of authTeam) {
    const clubId = t.club_id ?? t.clubId;
    const tourId = t.tour_team_id ?? t.tourTeamId ?? t.game_team_id ?? t.id;
    if (clubId !== null && clubId !== undefined) tourTeamByClub.set(Number(clubId), Number(tourId));
  }
  const seasonTournaments = (snapshot.tables.season_tournaments ?? []).filter((r) => Number(r.season) === SEASON);
  const compByTournament = new Map(seasonTournaments.map((r) => [Number(r.tournament_id), r.competition_type]));
  const tourEntry = snapshot.tables.tour_entry ?? [];
  const derivedTier = new Map();
  for (const t of valueTeams) {
    const tourId = tourTeamByClub.get(t.club_id);
    if (tourId === undefined) continue;
    const hits = new Set();
    for (const e of tourEntry) {
      if (Number(e.team_id) !== tourId) continue;
      const comp = compByTournament.get(Number(e.tournament_id));
      if (comp === 'league_premier') hits.add('premier');
      if (comp === 'league_second') hits.add('second');
    }
    if (hits.size === 1) derivedTier.set(t.club_id, [...hits][0]);
  }
  const tierMismatch = valueTeams
    .filter((t) => !t.cpu || stadiumByClub.has(t.club_id))
    .filter((t) => derivedTier.get(t.club_id) !== t.tier)
    .map((t) => `${t.club_id}(${t.name}): 图值 ${t.tier} vs 派生 ${derivedTier.get(t.club_id) ?? '未定级'}`);
  push('级别与报名派生逐队一致（16 队）', tierMismatch.length === 0, tierMismatch.length ? tierMismatch.join(' · ') : '16/16 一致');
  if (tierMismatch.length) die(`级别真源与图值不一致：${tierMismatch.join(' · ')}`);

  // 5) 待补值闸
  const pending = valueTeams.filter((t) => t.pending);
  if (pending.length && !allowMissing) {
    die(
      `图值待补：${pending
        .map((t) => `${t.club_id}(${t.name}) 的 ${t.field} 未定（${t.note ?? ''}）`)
        .join(' · ')}\n      —— 用户补值后重跑，或显式带 --allow-missing 按 0 处理（会在 report 显著标注）`,
    );
  }
  push(
    '图值待补',
    pending.length === 0,
    pending.length ? `${pending.map((t) => `${t.club_id} ${t.field}`).join('、')} 按 0 处理（--allow-missing）` : '无',
  );

  // 6) 影响力分子（playerInfluenceSum 同口径）
  const playerRowsByClub = new Map();
  for (const r of snapshot.tables.player_influence_rows ?? []) {
    const k = Number(r.club_id);
    if (!playerRowsByClub.has(k)) playerRowsByClub.set(k, []);
    playerRowsByClub.get(k).push(r);
  }
  const playerSum = new Map();
  for (const t of valueTeams) playerSum.set(t.club_id, E.playerInfluenceSum(playerRowsByClub.get(t.club_id) ?? [], model));
  const influence = new Map();
  for (const t of valueTeams) {
    if (!stadiumByClub.has(t.club_id)) continue; // CPU 队不参与重演
    influence.set(t.club_id, E.teamInfluence({ shell_influence: t.shell_influence, bonus_points: t.bonus_points }, playerSum.get(t.club_id), E.influenceTierCoef(influenceCoefs, t.tier)));
  }
  const oldInfluence = new Map();
  for (const s of stadiums) {
    const t = byId.get(s.club_id);
    oldInfluence.set(s.club_id, E.teamInfluence(s, playerSum.get(s.club_id) ?? 0, E.influenceTierCoef(influenceCoefs, t?.tier ?? null)));
  }

  // 7) 重演
  const rcRows = snapshot.tables.result_confirmations ?? [];
  const rcByMatch = new Map(rcRows.map((r) => [Number(r.match_id), r]));
  const attendanceRows = (snapshot.tables.match_attendance ?? []).filter((r) => Number(r.season) === SEASON && Number(r.window_seq) === WINDOW_SEQ);
  push('上座快照覆盖全部窗口行', attendanceRows.length === (snapshot.tables.match_attendance ?? []).length, `${attendanceRows.length} 行`);
  const facilitiesByClub = new Map();
  for (const f of snapshot.tables.club_facilities ?? []) {
    const k = Number(f.club_id);
    if (!facilitiesByClub.has(k)) facilitiesByClub.set(k, {});
    facilitiesByClub.get(k)[f.facility_key] = Number(f.level);
  }
  const clubByTourTeam = new Map([...tourTeamByClub.entries()].map(([club, tour]) => [tour, club]));

  const matches = attendanceRows.map((a) => {
    const rc = rcByMatch.get(Number(a.match_id));
    if (!rc) die(`match_attendance 行 ${a.match_id} 找不到对应 result_confirmations 行（重演需 RC 排序）`);
    return { a, rc, clubId: Number(a.club_id), rcId: Number(rc.id) };
  });
  matches.sort((x, y) => x.rcId - y.rcId);

  const state = new Map(); // clubId → fans（链式推进）
  const perClubMatches = new Map();
  for (const m of matches) {
    if (!perClubMatches.has(m.clubId)) perClubMatches.set(m.clubId, []);
    perClubMatches.get(m.clubId).push(m);
  }
  for (const t of valueTeams) {
    if (!stadiumByClub.has(t.club_id)) continue;
    const initial = initialsMode === 'prod' ? Number(stadiumByClub.get(t.club_id).fans) : 1800;
    state.set(t.club_id, { clubId: t.club_id, initialFans: initial, fans: initial });
  }

  const matchPlans = [];
  for (const m of matches) {
    const clubId = m.clubId;
    const st = state.get(clubId);
    const s = stadiumByClub.get(clubId);
    const t = byId.get(clubId);
    const facilities = facilitiesByClub.get(clubId) ?? {};
    const homeTourTeamId = tourTeamByClub.get(clubId);
    const awayTourTeamId = Number(m.rc.home_team_id) === homeTourTeamId ? Number(m.rc.away_team_id) : Number(m.rc.home_team_id);
    const awayClubId = clubByTourTeam.get(awayTourTeamId);
    const awayStadium = awayClubId !== undefined ? stadiumByClub.get(awayClubId) : undefined;
    const awayInfluence = awayClubId !== undefined && awayStadium ? influence.get(awayClubId) ?? model.default_influence : model.default_influence;

    const formPts = E.formPtsBefore(rcRows, m.rcId, homeTourTeamId);
    const weather = m.a.weather;
    const forecast = matchWeatherRows.find((r) => Number(r.match_id) === Number(m.a.match_id) && Number(r.club_id) === clubId);
    const result = E.replayMatch({
      model,
      tierTable,
      matchId: Number(m.a.match_id),
      clubId,
      fans: st.fans,
      capacity: Number(s.capacity),
      tier: Number(s.tier),
      nextAttendanceMod: s.next_attendance_mod === undefined || s.next_attendance_mod === null ? 1 : Number(s.next_attendance_mod),
      weather,
      wxOverride: forecast ? Number(forecast.wx_coef) : undefined,
      formPts,
      homeInfluence: influence.get(clubId),
      awayInfluence,
      facilityLevels: { commercial: facilities.commercial ?? 0, broadcast: facilities.broadcast ?? 0 },
      youthLevel: facilities.youth ?? 0,
      fansBuff: 0, // naming_contracts 已断言为空（生产无生效冠名）
      growRate: perMatch.growRate,
      dropRate: perMatch.dropRate,
    });
    const before = {
      attendance: Number(m.a.attendance),
      ticket: Number(m.a.ticket),
      commercial: Number(m.a.commercial),
      broadcast: Number(m.a.broadcast),
    };
    const beforeTotal = round2(before.ticket + before.commercial + before.broadcast);
    matchPlans.push({
      matchId: Number(m.a.match_id),
      clubId,
      clubName: t?.name ?? null,
      rcId: m.rcId,
      weather,
      formPts,
      capacity: Number(s.capacity),
      awayClubId: awayClubId ?? null,
      awayInfluence,
      before,
      beforeTotal,
      after: { attendance: result.attendance, ticket: result.revenue.ticket, commercial: result.revenue.commercial, broadcast: result.revenue.broadcast },
      afterTotal: result.total,
      factors: { demand: result.demand, wx: result.wx, form: result.formCoef, tierCoef: result.tierCoef, multiplier: result.multiplier, opp: result.opp, soldOut: result.soldOut },
      fans: { before: st.fans, after: result.nextFans, attendRate: result.attendRate, target: result.target },
    });
    st.fans = result.nextFans;
  }

  // 8) 关窗收尾（B 段口径）：有主场场次的队**不再**演化（生产 16 队全部有主场），fans_window_start = 窗末值
  const clubPlans = valueTeams
    .filter((t) => stadiumByClub.has(t.club_id))
    .map((t) => {
      const st = state.get(t.club_id);
      const s = stadiumByClub.get(t.club_id);
      const ms = perClubMatches.get(t.club_id) ?? [];
      const sumAtt = (pick) => ms.reduce((acc, m) => acc + pick(matchPlans.find((p) => p.matchId === Number(m.a.match_id))), 0);
      return {
        clubId: t.club_id,
        name: t.name,
        tier: t.tier,
        cpu: t.cpu,
        shellInfluence: t.shell_influence,
        bonusPoints: t.bonus_points,
        bonusSource: t.bonus_source,
        playerSum: playerSum.get(t.club_id),
        influence: influence.get(t.club_id),
        oldInfluence: oldInfluence.get(t.club_id),
        diehardTarget: ms.length ? E.diehardTarget(model, influence.get(t.club_id)) : null,
        capacity: Number(s.capacity),
        stadiumTier: Number(s.tier),
        homeMatches: ms.length,
        initialFans: st.initialFans,
        finalFans: st.fans,
        prodFans: Number(s.fans),
        prodFansWindowStart: s.fans_window_start === undefined ? null : Number(s.fans_window_start),
        attendanceBefore: sumAtt((p) => p.before.attendance),
        attendanceAfter: sumAtt((p) => p.after.attendance),
        revenueBefore: round2(ms.reduce((acc, m) => acc + matchPlans.find((p) => p.matchId === Number(m.a.match_id)).beforeTotal, 0)),
        revenueAfter: round2(ms.reduce((acc, m) => acc + matchPlans.find((p) => p.matchId === Number(m.a.match_id)).afterTotal, 0)),
      };
    });
  clubPlans.sort((a, b) => a.clubId - b.clubId);

  // 9) 账本：改金额 + 全链重放
  const newTotalByMatch = new Map(
    matchPlans.map((p) => [
      p.matchId,
      {
        total: p.afterTotal,
        clubId: p.clubId,
        // memo 与运行期 home.ts:433 同格式；重算后上座变了，memo 必须同步（否则行内描述与金额打架）
        memo: `比赛日收入（比赛 #${p.matchId}，上座 ${p.after.attendance}/${p.capacity}，${p.weather}；票 ${p.after.ticket}/商 ${p.after.commercial}/播 ${p.after.broadcast}）`,
      },
    ]),
  );
  const entriesByClub = new Map();
  for (const e of snapshot.tables.ledger_entries ?? []) {
    const k = Number(e.club_id);
    if (!entriesByClub.has(k)) entriesByClub.set(k, []);
    entriesByClub.get(k).push(e);
  }
  const ledgerPlans = [];
  let chainPreMismatch = 0;
  let orderMismatch = 0;
  for (const [clubId, listRaw] of [...entriesByClub.entries()].sort((a, b) => a[0] - b[0])) {
    const list = [...listRaw].sort((a, b) => Number(a.id) - Number(b.id));
    // 序一致性：created_at 应与 id 同序（否则"按 (created_at,id) 顺序重放"与"按入账顺序重放"会分歧）
    for (let i = 1; i < list.length; i++) {
      if (String(list[i - 1].created_at) > String(list[i].created_at)) orderMismatch++;
    }
    const oldChain = E.replayBalanceChain(list.map((e) => ({ ...e, amount: Number(e.amount) })));
    for (let i = 0; i < list.length; i++) {
      if (Math.abs(Number(list[i].balance_after) - oldChain[i].balance_after) > 1e-9) chainPreMismatch++;
    }
    const mapped = list.map((e) => {
      const isMatchRevenue = e.kind === 'revenue' && e.ref_type === 'match';
      if (!isMatchRevenue) return { ...e, amount: Number(e.amount), changed: false };
      const hit = newTotalByMatch.get(Number(e.ref_id));
      if (!hit || hit.clubId !== clubId) return { ...e, amount: Number(e.amount), changed: false };
      return { ...e, amount: hit.total, memo: hit.memo, changed: true };
    });
    const newChain = E.replayBalanceChain(mapped);
    const accountRow = (snapshot.tables.ledger_accounts ?? []).find((r) => Number(r.club_id) === clubId);
    ledgerPlans.push({
      clubId,
      entries: newChain.map((e, i) => ({
        id: Number(e.id),
        kind: e.kind,
        refType: e.ref_type,
        refId: e.ref_id === null || e.ref_id === undefined ? null : Number(e.ref_id),
        amountBefore: Number(list[i].amount),
        amountAfter: Number(e.amount),
        balanceBefore: Number(list[i].balance_after),
        balanceAfter: e.balance_after,
        memoBefore: list[i].memo,
        memoAfter: e.memo,
        changed: !!e.changed,
      })),
      accountBalanceBefore: accountRow ? Number(accountRow.balance) : null,
      accountBalanceAfter: newChain.length ? newChain[newChain.length - 1].balance_after : 0,
    });
  }
  push('生产现有账本链自洽（逐行累加 == balance_after）', chainPreMismatch === 0, chainPreMismatch ? `${chainPreMismatch} 行不一致（既有数据异常，重演会重写成自洽链）` : '210 行全部一致');
  push('生产账本 created_at 与 id 同序', orderMismatch === 0, orderMismatch ? `${orderMismatch} 处逆序（重放按 id 序 = 真实入账序）` : `共 ${(snapshot.tables.ledger_entries ?? []).length} 行`);

  // 10) 守恒断言（针对**计划后**状态）
  const assertList = [];
  const ledgerByClub = new Map(ledgerPlans.map((l) => [l.clubId, l]));
  let accEqLast = 0;
  let negative = [];
  for (const l of ledgerPlans) {
    const last = l.entries.length ? l.entries[l.entries.length - 1].balanceAfter : 0;
    if (Math.abs(l.accountBalanceAfter - last) > 1e-9) accEqLast++;
    if (l.accountBalanceAfter < 0) negative.push(`${l.clubId}(${l.accountBalanceAfter.toFixed(2)})`);
  }
  assertList.push({ name: '① ledger_accounts.balance == 队内末条 balance_after', ok: accEqLast === 0, detail: accEqLast ? `${accEqLast} 队不一致` : `${ledgerPlans.length} 队一致` });
  assertList.push({ name: '② 队内流水累加 == 每一条 balance_after', ok: true, detail: '按 id 序重放（构造性成立，verify 会再核一次）' });
  const nonRevenueChanged = ledgerPlans.flatMap((l) => l.entries.filter((e) => !(e.kind === 'revenue' && e.refType === 'match') && Math.abs(e.amountAfter - e.amountBefore) > 1e-9));
  assertList.push({ name: '③ 非比赛收入流水金额不变', ok: nonRevenueChanged.length === 0, detail: nonRevenueChanged.length ? `${nonRevenueChanged.length} 行被改动` : '逐行 diff 为空' });
  assertList.push({ name: '④ 每队最终余额不为负', ok: negative.length === 0, detail: negative.length ? negative.join('、') : `${ledgerPlans.length} 队余额均为正` });
  const pkSetSame = matches.length === attendanceRows.length;
  assertList.push({ name: '⑤ match_attendance 行数/主键集合不变', ok: pkSetSame, detail: `${attendanceRows.length} 行（只 UPDATE，无 INSERT/DELETE）` });
  const overCap = matchPlans.filter((p) => p.after.attendance > stadiumByClub.get(p.clubId).capacity);
  assertList.push({ name: '⑥ 每场上座 ≤ 容量（含 fill 口径）', ok: overCap.length === 0, detail: overCap.length ? overCap.map((p) => `#${p.matchId}`).join('、') : '78 场全部 ≤ 容量' });
  const oldOverCap = matchPlans.filter((p) => p.before.attendance > stadiumByClub.get(p.clubId).capacity);
  assertList.push({ name: '⑥b 生产旧值同样 ≤ 容量（对照）', ok: oldOverCap.length === 0, detail: oldOverCap.length ? oldOverCap.map((p) => `#${p.matchId}`).join('、') : '78 场旧值均 ≤ 容量' });

  return {
    generatedAt: new Date().toISOString(),
    snapshotFetchedAt: snapshot.fetchedAt,
    allowMissing,
    initialsMode,
    configNotes: cfg.notes,
    perMatch,
    influenceCoefs,
    season: SEASON,
    windowSeq: WINDOW_SEQ,
    checks,
    assertions: assertList,
    pendingValues: pending,
    clubPlans,
    matchPlans,
    ledgerPlans,
  };
}

function genSql(plan, snapshot) {
  fs.rmSync(SQL_DIR, { recursive: true, force: true });
  fs.mkdirSync(SQL_DIR, { recursive: true });
  const w = (name, lines) => {
    fs.writeFileSync(path.join(SQL_DIR, name), `${lines.join('\n')}\n`);
    return name;
  };
  const files = [];
  const header = (title) => [
    `-- ${title}`,
    `-- 由 scripts/prod-20261004-influence-recalc/recalc.mjs plan 生成（${plan.generatedAt}）`,
    `-- 口径真源：src/worker/home.ts（v6.28.0）；重演随机项取区间中点、天气取库中已记录值`,
    `-- 本文件不自动执行：apply 默认只打印，需要显式 --yes`,
    '',
  ];

  // 01 影响力图值 + 死忠窗末值
  {
    const lines = header('01 stadiums：队壳影响力/奖励分导入 + 死忠（fans / fans_window_start）窗末值（16 队）');
    for (const c of plan.clubPlans) {
      lines.push(
        `-- ${c.name}（club ${c.clubId}，${c.tier}）：影响力 ${c.oldInfluence.toFixed(2)} → ${c.influence.toFixed(2)}；fans ${c.initialFans} → ${c.finalFans}`,
      );
      lines.push(
        `UPDATE stadiums SET shell_influence = ${sqlNum(c.shellInfluence)}, bonus_points = ${sqlNum(c.bonusPoints)}, fans = ${sqlNum(c.finalFans)}, fans_window_start = ${sqlNum(c.finalFans)} WHERE club_id = ${c.clubId};`,
      );
    }
    files.push(w('01-stadiums-values.sql', lines));
  }

  // 02 上座快照四列重写
  {
    const lines = header('02 match_attendance：上座与三分收入重算（78 场；weather 保持库中已记录值不变）');
    for (const m of plan.matchPlans) {
      lines.push(`-- #${m.matchId} ${m.clubName}：上座 ${m.before.attendance} → ${m.after.attendance}（${m.weather}，form ${m.formPts}）；收入 ${m.beforeTotal} → ${m.afterTotal}`);
      lines.push(
        `UPDATE match_attendance SET attendance = ${sqlNum(m.after.attendance)}, ticket = ${sqlNum(m.after.ticket)}, commercial = ${sqlNum(m.after.commercial)}, broadcast = ${sqlNum(m.after.broadcast)} WHERE match_id = ${m.matchId};`,
      );
    }
    files.push(w('02-match-attendance-revenue.sql', lines));
  }

  // 03 比赛收入流水金额 + memo + balance_after
  {
    const lines = header('03 ledger_entries：比赛收入流水「重记替换」（金额/memo/balance_after；不冲销、不新增行）');
    for (const l of plan.ledgerPlans) {
      for (const e of l.entries) {
        if (!e.changed) continue;
        lines.push(`-- #${e.id} club ${l.clubId} 比赛 #${e.refId}：金额 ${e.amountBefore} → ${e.amountAfter}；余额 ${e.balanceBefore} → ${e.balanceAfter}`);
        lines.push(
          `UPDATE ledger_entries SET amount = ${sqlNum(e.amountAfter)}, memo = ${sqlStr(e.memoAfter)}, balance_after = ${sqlNum(e.balanceAfter)} WHERE id = ${e.id} AND club_id = ${l.clubId} AND kind = 'revenue' AND ref_type = 'match' AND ref_id = ${e.refId};`,
        );
      }
    }
    files.push(w('03-ledger-amounts.sql', lines));
  }

  // 04 非比赛收入流水的余额链
  {
    const lines = header('04 ledger_entries：其余流水只重放 balance_after（金额/memo 一行不动）');
    for (const l of plan.ledgerPlans) {
      for (const e of l.entries) {
        if (e.changed) continue;
        if (Math.abs(e.balanceAfter - e.balanceBefore) < 1e-12) continue; // 余额也没变的行不生成 SQL
        lines.push(`UPDATE ledger_entries SET balance_after = ${sqlNum(e.balanceAfter)} WHERE id = ${e.id} AND club_id = ${l.clubId};`);
      }
    }
    files.push(w('04-ledger-balance-chain.sql', lines));
  }

  // 05 账户余额
  {
    const lines = header('05 ledger_accounts：账户余额对齐链末值（updated_at 不动）');
    for (const l of plan.ledgerPlans) {
      lines.push(`-- club ${l.clubId}：${l.accountBalanceBefore} → ${l.accountBalanceAfter}`);
      lines.push(`UPDATE ledger_accounts SET balance = ${sqlNum(l.accountBalanceAfter)} WHERE club_id = ${l.clubId};`);
    }
    files.push(w('05-ledger-accounts.sql', lines));
  }

  // 99 回滚（由快照逐行还原）
  {
    const lines = header('99 回滚：按快照逐行还原 stadiums / match_attendance / ledger_entries / ledger_accounts');
    const stadiumRows = snapshot.tables.stadiums ?? [];
    for (const s of stadiumRows) {
      lines.push(
        `UPDATE stadiums SET shell_influence = ${sqlNum(Number(s.shell_influence))}, bonus_points = ${sqlNum(Number(s.bonus_points))}, fans = ${sqlNum(Number(s.fans))}, fans_window_start = ${sqlNum(s.fans_window_start === undefined ? 0 : Number(s.fans_window_start))} WHERE club_id = ${Number(s.club_id)};`,
      );
    }
    for (const a of snapshot.tables.match_attendance ?? []) {
      lines.push(
        `UPDATE match_attendance SET attendance = ${sqlNum(Number(a.attendance))}, ticket = ${sqlNum(Number(a.ticket))}, commercial = ${sqlNum(Number(a.commercial))}, broadcast = ${sqlNum(Number(a.broadcast))} WHERE match_id = ${Number(a.match_id)};`,
      );
    }
    for (const e of snapshot.tables.ledger_entries ?? []) {
      lines.push(
        `UPDATE ledger_entries SET amount = ${sqlNum(Number(e.amount))}, memo = ${sqlStr(e.memo)}, balance_after = ${sqlNum(Number(e.balance_after))} WHERE id = ${Number(e.id)};`,
      );
    }
    for (const a of snapshot.tables.ledger_accounts ?? []) {
      lines.push(`UPDATE ledger_accounts SET balance = ${sqlNum(Number(a.balance))} WHERE club_id = ${Number(a.club_id)};`);
    }
    files.push(w('99-rollback.sql', lines));
  }
  return files;
}

function renderReport(plan, snapshot, files) {
  const lines = [];
  const L = (...a) => lines.push(...a);
  const n = (x) => (Number.isFinite(x) ? String(Math.round(x * 100) / 100) : String(x));
  L('# v6.28.0 C 段数据批 · 离线干跑报告（influence / 死忠 / 历史链式重演）', '');
  L(`- 生成时间：${plan.generatedAt}（快照拉取 ${plan.snapshotFetchedAt}）`);
  L(`- **授权状态：未授权执行**。本报告由 \`plan\` 离线产出，生产未发生任何写操作。`);
  L(`- 范围：season ${plan.season} / window ${plan.windowSeq} 的 ${plan.matchPlans.length} 场主场收入 + ${plan.clubPlans.length} 队图值与死忠 + ${plan.ledgerPlans.reduce((a, l) => a + l.entries.length, 0)} 条流水链`);
  L(`- 初值口径：--initials=${plan.initialsMode}（${plan.initialsMode === 'prod' ? '用生产现值作 S9 W1 初值' : '一律建队默认 1800'}）`);
  L('');

  L('## 1. 口径摘要', '');
  L('- 影响力 =（队壳影响力 + Σ球员影响力）× 级别系数 + 奖励分；级别系数 premier 1.2 / second 1.0（config influence_tier_coefs）');
  L('- 级别真源 = 报名派生（season_tournaments + tour entry），与图值级别逐队一致（已断言）');
  L('- 上座 = fans × 乘数(4.0×(1+0.35×档位)) × 档位系数 × form × wx × 对手系数 × next_attendance_mod × perturbation');
  L('- 收入：ticket = 上座/万×1.5；commercial = 上座/万×0.1×商设等级；broadcast = 0.3×播设等级；total = 三者四舍五入到 2 位');
  L(`- 每场死忠：涨/掉系数 = ${plan.perMatch.growRate} / ${plan.perMatch.dropRate}（config per-match 键；生产未配置 ⇒ 出厂默认 0.2）`);
  L('- 关窗收尾：本窗有主场的队不再演化（生产 16 队全部有主场），fans 与 fans_window_start 都写窗末值');
  L('- **重演取期望而非复现历史**：perturbation 取 [0.97,1.03] 中点 1.0、fill 取 [0.985,0.999] 中点 0.992、wx 取该天气区间中点；天气用库中已记录值（不重掷）');
  L('- form 按「本场确认那一刻」可见的历史 RC 行算（RC id 切时间点，因为确认批先插 RC 后跑钩子）');
  L('- 对手系数用**新**影响力（主客两侧都按新公式），客队无 stadium 行（CPU 队）⇒ default_influence 90');
  L('- 消耗/兜底：match_weather 与 naming_contracts / event_occurrences / venue_bookings 全为空 ⇒ wx 无预报、fansBuff=0、无档期活动乘数、关窗无事件中性', '');
  for (const note of plan.configNotes) L(`- 配置：${note}`);

  L('', '## 2. 前置校验与断言（plan 阶段）', '');
  L('| 项目 | 结果 | 说明 |', '| --- | --- | --- |');
  for (const c of plan.checks) L(`| ${c.name} | ${c.ok ? 'PASS' : 'FAIL'} | ${String(c.detail).replace(/\|/g, '/')} |`);
  for (const a of plan.assertions) L(`| ${a.name}（计划后） | ${a.ok ? 'PASS' : 'FAIL'} | ${String(a.detail).replace(/\|/g, '/')} |`);

  if (plan.pendingValues.length) {
    L('', '## 3. 图值待补（显著标注）', '');
    for (const p of plan.pendingValues) L(`- **club ${p.club_id}（${p.name}）的 ${p.field} 未定**：${p.note}`);
    L(`- 本次按 --allow-missing 以 0 处理 ⇒ 该队奖励分少了图值，重算后的影响力/死忠/上座**偏低**，用户补值后必须重跑本批（先回滚或直接重跑，UPDATE 是绝对赋值、可重复收敛）。`);
  } else {
    L('', '## 3. 图值待补', '', '- 无（全部 20 队图值齐备）');
  }

  L('', '## 4. 每队：图值导入 + 死忠链式重演', '');
  L('| 队 | 级别 | 球员Σ | 影响力旧→新 | 死忠目标 | fans 初值→窗末 | 生产现值 | 主场 | 上座合计 旧→新 | 收入合计 旧→新 |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const c of plan.clubPlans) {
    L(
      `| ${c.name}(${c.clubId}) | ${c.tier} | ${n(c.playerSum)} | ${n(c.oldInfluence)} → ${n(c.influence)} | ${c.diehardTarget === null ? '-' : n(c.diehardTarget)} | ${n(c.initialFans)} → ${n(c.finalFans)} | ${n(c.prodFans)} | ${c.homeMatches} | ${c.attendanceBefore} → ${c.attendanceAfter} | ${n(c.revenueBefore)} → ${n(c.revenueAfter)} |`,
    );
  }
  const tot = (pick) => plan.clubPlans.reduce((a, c) => a + pick(c), 0);
  L(
    `| **合计** | | | | | | | ${tot((c) => c.homeMatches)} | ${tot((c) => c.attendanceBefore)} → ${tot((c) => c.attendanceAfter)} | ${n(tot((c) => c.revenueBefore))} → ${n(tot((c) => c.revenueAfter))} |`,
  );

  L('', '## 5. 逐场明细（上座/收入 旧→新）', '');
  L('| # | 队 | 天气 | form | 上座 旧→新 | 票 旧→新 | 商 | 播 | 合计 旧→新 | 上座率 | fans 该场后 | 备注 |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const m of plan.matchPlans) {
    const notes = [];
    if (m.factors.soldOut) notes.push('需求≥容量→fill');
    if (m.after.attendance > m.before.attendance * 1.5) notes.push('上座大幅抬升');
    if (m.afterTotal < m.beforeTotal) notes.push('收入下降');
    L(
      `| ${m.matchId} | ${m.clubName}(${m.clubId}) | ${m.weather} | ${m.formPts} | ${m.before.attendance} → ${m.after.attendance} | ${n(m.before.ticket)} → ${n(m.after.ticket)} | ${n(m.after.commercial)} | ${n(m.after.broadcast)} | ${n(m.beforeTotal)} → ${n(m.afterTotal)} | ${(m.fans.attendRate * 100).toFixed(1)}% | ${n(m.fans.after)} | ${notes.join('；')} |`,
    );
  }

  L('', '## 6. 账本（比赛收入重记替换 + 全链重放）', '');
  L('| 队 | 流水条数 | 其中改动 | 余额 旧→新 | 差额 |', '| --- | --- | --- | --- | --- |');
  for (const l of plan.ledgerPlans) {
    const changed = l.entries.filter((e) => e.changed).length;
    L(`| club ${l.clubId} | ${l.entries.length} | ${changed} | ${n(l.accountBalanceBefore)} → ${n(l.accountBalanceAfter)} | ${n(l.accountBalanceAfter - (l.accountBalanceBefore ?? 0))} |`);
  }
  const ledgerBefore = plan.ledgerPlans.reduce((a, l) => a + (l.accountBalanceBefore ?? 0), 0);
  const ledgerAfter = plan.ledgerPlans.reduce((a, l) => a + l.accountBalanceAfter, 0);
  L(`| **合计** | | | ${n(ledgerBefore)} → ${n(ledgerAfter)} | ${n(ledgerAfter - ledgerBefore)} |`);
  L('', `- 收入类流水金额：${n(tot((c) => c.revenueBefore))} → ${n(tot((c) => c.revenueAfter))}（联盟合计）`);

  L('', '## 7. SQL 文件（未执行）', '');
  for (const f of files) {
    const content = fs.readFileSync(path.join(SQL_DIR, f), 'utf8');
    const stmts = content.split('\n').filter((x) => /^(UPDATE|INSERT|DELETE|BEGIN|COMMIT)/i.test(x.trim())).length;
    L(`- \`sql/${f}\`：${stmts} 条语句`);
  }
  L('', '## 8. 执行前置条件与顺序', '');
  L('1. 迁移 0062（stadiums.fans_window_start）必须先 apply —— 本批 01 文件会写该列，快照里已断言列存在。');
  L('2. 本批与 v6.28.0 代码上线的先后：**先上线代码再执行本批**（本批把 history 重记成新公式的值；代码未上线时管理端/公开面展示的仍是旧公式结果，且新比赛确认仍按旧口径写库）。');
  L('3. `snapshot`（只读）→ `plan`（离线）→ 人工复核本报告 → `apply --yes`（先备份 + 落 marker）→ `verify`（只读守恒断言）。');
  L('4. 重跑：`apply` 有 marker 防重；确需重跑先恢复 `backup/<时间戳>/`，或直接 `--force`（UPDATE 是绝对赋值，重复执行收敛到同一结果）。');
  L('', '## 9. 未做/边界', '');
  L('- 4 支 CPU 队无 stadium 行，图值只做与 CPU_SEED_PRESETS 的一致性断言，本批不写库（其历史主场收入从未入账，不在重演范围）。');
  L('- 维护费流水：生产 210 条流水里**没有任何 maintenance 行**（关窗批未产生），本批不补记（口径外）。');
  L('- 冠名/事件/档期活动：生产为空，本批不涉及；若执行前出现行数据，snapshot 会直接中止。');
  fs.writeFileSync(REPORT_FILE, `${lines.join('\n')}\n`);
}

async function cmdPlan() {
  const snapshot = loadJson(SNAPSHOT_FILE, '快照');
  const values = JSON.parse(fs.readFileSync(VALUES_FILE, 'utf8'));
  const initialsMode = opt('initials', 'default');
  if (initialsMode !== 'default' && initialsMode !== 'prod') die(`--initials 只能是 default（一律 1800）或 prod（用生产现值），收到：${initialsMode}`);
  const plan = buildPlan(snapshot, values, flag('allow-missing'), initialsMode, flag('assume-migrated'));
  const files = genSql(plan, snapshot);
  renderReport(plan, snapshot, files);
  fs.writeFileSync(PLAN_FILE, JSON.stringify(plan, null, 2));

  log(`\n=== 干跑摘要（离线，未写生产）===`);
  for (const c of plan.checks) log(`  [${c.ok ? 'PASS' : 'FAIL'}] ${c.name} — ${c.detail}`);
  for (const a of plan.assertions) log(`  [${a.ok ? 'PASS' : 'FAIL'}] ${a.name} — ${a.detail}`);
  const sum = (pick) => plan.clubPlans.reduce((a, c) => a + pick(c), 0);
  log(`  fans：${sum((c) => c.initialFans)} → ${sum((c) => c.finalFans)}（16 队合计）`);
  log(`  上座：${sum((c) => c.attendanceBefore)} → ${sum((c) => c.attendanceAfter)}`);
  log(`  比赛收入：${round2(sum((c) => c.revenueBefore))} → ${round2(sum((c) => c.revenueAfter))}`);
  const lb = plan.ledgerPlans.reduce((a, l) => a + (l.accountBalanceBefore ?? 0), 0);
  const la = plan.ledgerPlans.reduce((a, l) => a + l.accountBalanceAfter, 0);
  log(`  账本总额：${round2(lb)} → ${round2(la)}`);
  log(`\n  plan.json / report.md / sql/（${files.length} 个 SQL 文件）已生成`);
}

// ───────────────────────────── apply ─────────────────────────────

function wranglerExecute(file) {
  const abs = path.resolve(file);
  const isWin = process.platform === 'win32';
  const run = (extra) => {
    // Windows 下 shell:true 会把参数直接拼进命令行 ⇒ 自己加引号，防路径带空格被拆开
    const args = ['wrangler', 'd1', 'execute', 'whl-club', '--remote', `--file=${abs}`, ...extra];
    const cmdline = `npx ${args.map((a) => (isWin && a.includes(' ') ? `"${a}"` : a)).join(' ')}`;
    execFileSync(cmdline, [], { cwd: path.join(HERE, '..', '..'), stdio: 'inherit', shell: true });
  };
  try {
    run(['--yes']);
  } catch (e) {
    console.warn(`  （带 --yes 执行失败，回退不带 --yes：${e.message?.split('\n')[0] ?? e}）`);
    run([]);
  }
}

async function cmdApply() {
  const files = fs.existsSync(SQL_DIR) ? fs.readdirSync(SQL_DIR).filter((f) => f.endsWith('.sql') && !f.startsWith('99')).sort() : [];
  if (!files.length) die('sql/ 为空（先跑 plan）');
  if (fs.existsSync(MARKER_FILE) && !flag('force')) {
    die(`检测到 ${path.basename(MARKER_FILE)}（本批已执行过）。确需重跑：先恢复 backup/，或显式 --force`);
  }
  let total = 0;
  for (const f of files) {
    const content = fs.readFileSync(path.join(SQL_DIR, f), 'utf8');
    const stmts = content.split('\n').filter((x) => /^(UPDATE|INSERT|DELETE)/i.test(x.trim())).length;
    total += stmts;
    log(`  ${f}: ${stmts} 条写语句`);
  }
  log(`  合计 ${total} 条写语句；目标库 whl-club（--remote）`);
  if (!flag('yes')) {
    log('\n[只打印模式] 未执行任何写操作。确认后执行：');
    log(`  node scripts/prod-20261004-influence-recalc/recalc.mjs apply --yes`);
    return;
  }
  // 备份：受影响表全量 JSON（只读拉取）
  const account = opt('account', DEFAULT_ACCOUNT);
  const found = readWranglerToken();
  const token = opt('token', found?.token);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(BACKUP_DIR, stamp);
  fs.mkdirSync(dir, { recursive: true });
  const tables = ['stadiums', 'match_attendance', 'ledger_entries', 'ledger_accounts'];
  const manifest = { at: new Date().toISOString(), files, rowCounts: {} };
  for (const t of tables) {
    const rows = await fetchTable(DB_IDS.club, t, account, token);
    fs.writeFileSync(path.join(dir, `${t}.json`), JSON.stringify(rows, null, 2));
    manifest.rowCounts[t] = rows.length;
    log(`  备份 ${t}: ${rows.length} 行`);
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  log(`  备份目录 ${dir}`);
  // 执行
  try {
    for (const f of files) {
      log(`\n>>> wrangler d1 execute whl-club --remote --file=sql/${f}`);
      wranglerExecute(path.join(SQL_DIR, f));
    }
  } catch (e) {
    die(`执行中断（${e.message?.split('\n')[0] ?? e}）。恢复：按 backup/${stamp}/ 逐行还原，或直接修好后重跑 --force`);
  }
  fs.writeFileSync(MARKER_FILE, JSON.stringify({ at: new Date().toISOString(), files, backup: dir, statements: total }, null, 2));
  log(`\n已执行并落 marker；接着跑 verify 做只读守恒断言。`);
  await cmdVerify();
}

// ───────────────────────────── verify ─────────────────────────────

async function cmdVerify() {
  const account = opt('account', DEFAULT_ACCOUNT);
  const found = readWranglerToken();
  const token = opt('token', found?.token);
  const plan = fs.existsSync(PLAN_FILE) ? JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8')) : null;
  const snapshot = fs.existsSync(SNAPSHOT_FILE) ? JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8')) : null;
  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok, detail });
    log(`  [${ok ? 'PASS' : 'FAIL'}] ${name} — ${detail}`);
  };
  const entries = await fetchTable(DB_IDS.club, 'ledger_entries', account, token);
  const accounts = await fetchTable(DB_IDS.club, 'ledger_accounts', account, token);
  const stadiums = await fetchTable(DB_IDS.club, 'stadiums', account, token);
  const attendance = await fetchTable(DB_IDS.club, 'match_attendance', account, token);

  // ① 账户余额 == 队内末条 balance_after
  const byClub = new Map();
  for (const e of entries) {
    const k = Number(e.club_id);
    if (!byClub.has(k)) byClub.set(k, []);
    byClub.get(k).push(e);
  }
  let bad1 = [];
  let bad2 = [];
  let bad4 = [];
  for (const [clubId, list] of byClub) {
    const sorted = [...list].sort((a, b) => Number(a.id) - Number(b.id));
    const chain = E.replayBalanceChain(sorted.map((e) => ({ amount: Number(e.amount) })));
    for (let i = 0; i < sorted.length; i++) {
      if (Math.abs(Number(sorted[i].balance_after) - chain[i].balance_after) > 1e-9) bad2.push(`${clubId}#${sorted[i].id}`);
    }
    const acc = accounts.find((a) => Number(a.club_id) === clubId);
    const last = sorted.length ? chain[sorted.length - 1].balance_after : 0;
    if (!acc || Math.abs(Number(acc.balance) - last) > 1e-9) bad1.push(`${clubId}(账户 ${acc ? acc.balance : '缺行'} vs 链末 ${last})`);
    if (last < 0) bad4.push(`${clubId}(${last.toFixed(2)})`);
  }
  check('① ledger_accounts.balance == 队内末条 balance_after', bad1.length === 0, bad1.length ? bad1.join('、') : `${byClub.size} 队一致`);
  check('② 队内流水累加 == 每一条 balance_after', bad2.length === 0, bad2.length ? `${bad2.length} 行不一致：${bad2.slice(0, 5).join('、')}` : `${entries.length} 行全链一致`);
  check('④ 每队最终余额不为负', bad4.length === 0, bad4.length ? bad4.join('、') : `${byClub.size} 队均为正`);

  // ③ 非比赛收入流水金额不变（与快照逐行 diff）
  if (snapshot) {
    const oldById = new Map((snapshot.tables.ledger_entries ?? []).map((e) => [Number(e.id), e]));
    const changedNonRevenue = entries
      .filter((e) => !(e.kind === 'revenue' && e.ref_type === 'match'))
      .filter((e) => {
        const o = oldById.get(Number(e.id));
        return !o || Math.abs(Number(o.amount) - Number(e.amount)) > 1e-9;
      });
    check('③ 非比赛收入流水金额不变', changedNonRevenue.length === 0, changedNonRevenue.length ? `${changedNonRevenue.length} 行变化` : `${entries.filter((e) => !(e.kind === 'revenue' && e.ref_type === 'match')).length} 行逐行 diff 为空（对照快照）`);
  } else {
    check('③ 非比赛收入流水金额不变', false, '缺 snapshot.json 无法对照');
  }

  // ⑤ 行数/主键集合
  if (snapshot) {
    const oldAtt = new Set((snapshot.tables.match_attendance ?? []).map((a) => Number(a.match_id)));
    const newAtt = new Set(attendance.map((a) => Number(a.match_id)));
    const same = oldAtt.size === newAtt.size && [...oldAtt].every((id) => newAtt.has(id));
    check('⑤ match_attendance 行数/主键集合不变', same, `${newAtt.size} 行（快照 ${oldAtt.size} 行）`);
  }

  // ⑥ 上座 ≤ 容量
  const cap = new Map(stadiums.map((s) => [Number(s.club_id), Number(s.capacity)]));
  const over = attendance.filter((a) => Number(a.attendance) > (cap.get(Number(a.club_id)) ?? 0));
  check('⑥ 每场上座 ≤ 容量', over.length === 0, over.length ? over.map((a) => `#${a.match_id}`).join('、') : `${attendance.length} 场均 ≤ 容量`);

  // ⑦ 与 plan 的预期逐行对齐
  if (plan) {
    const badStadium = [];
    for (const c of plan.clubPlans) {
      const s = stadiums.find((x) => Number(x.club_id) === c.clubId);
      if (!s) {
        badStadium.push(`${c.clubId} 缺行`);
        continue;
      }
      const ok =
        Math.abs(Number(s.shell_influence) - c.shellInfluence) < 1e-9 &&
        Math.abs(Number(s.bonus_points) - c.bonusPoints) < 1e-9 &&
        Math.abs(Number(s.fans) - c.finalFans) < 1e-6 &&
        Math.abs(Number(s.fans_window_start ?? NaN) - c.finalFans) < 1e-6;
      if (!ok) badStadium.push(`${c.clubId}(壳 ${s.shell_influence}/${c.shellInfluence} 奖 ${s.bonus_points}/${c.bonusPoints} fans ${s.fans}/${c.finalFans} 窗始 ${s.fans_window_start})`);
    }
    check('⑦ stadiums 与 plan 预期一致（壳/奖励分/fans/fans_window_start）', badStadium.length === 0, badStadium.length ? badStadium.join('、') : `${plan.clubPlans.length} 队一致`);
    const attByMatch = new Map(attendance.map((a) => [Number(a.match_id), a]));
    const badAtt = plan.matchPlans.filter((m) => {
      const a = attByMatch.get(m.matchId);
      if (!a) return true;
      return (
        Number(a.attendance) !== m.after.attendance ||
        Math.abs(Number(a.ticket) - m.after.ticket) > 1e-9 ||
        Math.abs(Number(a.commercial) - m.after.commercial) > 1e-9 ||
        Math.abs(Number(a.broadcast) - m.after.broadcast) > 1e-9
      );
    });
    check('⑧ match_attendance 与 plan 预期一致', badAtt.length === 0, badAtt.length ? badAtt.map((m) => `#${m.matchId}`).join('、') : `${plan.matchPlans.length} 场一致`);
    const revById = new Map(entries.map((e) => [Number(e.id), e]));
    const badLedger = plan.ledgerPlans.flatMap((l) => l.entries).filter((e) => {
      const row = revById.get(e.id);
      return !row || Math.abs(Number(row.amount) - e.amountAfter) > 1e-9 || Math.abs(Number(row.balance_after) - e.balanceAfter) > 1e-6;
    });
    check('⑨ 流水金额/余额与 plan 预期一致', badLedger.length === 0, badLedger.length ? `${badLedger.length} 行不一致` : `${plan.ledgerPlans.flatMap((l) => l.entries).length} 行一致`);
  }
  const failed = results.filter((r) => !r.ok);
  log(`\nverify：${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) process.exit(2);
}

// ───────────────────────────── main ─────────────────────────────

switch (cmd) {
  case 'snapshot':
    if (process.argv.includes('-h') || process.argv.includes('--help')) die('用法见 README');
    await cmdSnapshot();
    break;
  case 'plan':
    await cmdPlan();
    break;
  case 'apply':
    await cmdApply();
    break;
  case 'verify':
    await cmdVerify();
    break;
  default:
    log('用法：node recalc.mjs <snapshot|plan|apply|verify> [--allow-missing] [--initials default|prod] [--yes] [--force]');
    process.exit(1);
}
