// 停赛判定镜像（v6.45.0）：俱乐部平台只读赛事库（TOUR_DB）复算「某场某球员是否正在服停赛」。
// 规则与 SQL 顺序逐条镜像赛事仓（WHL-tournament-management-system）worker/lib/suspension.ts，
// 场景对拍赛事仓 tests/suspension.replay.test.ts——两处必须同步改，本文件就是那份清单。
//
// 口径（与赛事仓逐字一致）：
//   直红停 redBan 场、两黄变一红停 red2yBan 场、累积 yellowThreshold 张黄牌停 1 场并清零；
//   pending 场不消耗停赛；轮空场不进比赛序；弃权场弃权方不消耗（both 双方都不消耗）；
//   同场先消耗后触发；两黄变一红同场的黄牌不计累积；有清零锚点时分两段重放（锚点只重置黄牌）。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createTestD1 } from './d1.ts';
import {
  DEFAULT_SUSPENSION,
  parseSuspensionConfig,
  suspendedPlayersAtMatch,
  suspensionLabel,
  type MatchSuspension,
} from '../src/worker/tour-suspension.ts';

// 赛事库表（照 WHL-tournament-management-system 迁移裁剪）：停赛引擎只碰这几张
const TOUR_SCHEMA = `
  CREATE TABLE tournament (id INTEGER PRIMARY KEY, name TEXT, status TEXT, config_json TEXT DEFAULT '{}');
  CREATE TABLE stage (id INTEGER PRIMARY KEY, tournament_id INTEGER, kind TEXT, sort_order INTEGER, name TEXT);
  CREATE TABLE entry (id INTEGER PRIMARY KEY, tournament_id INTEGER, team_id INTEGER, seed INTEGER);
  CREATE TABLE team (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE player (id INTEGER PRIMARY KEY, team_id INTEGER, name TEXT, number INTEGER);
  CREATE TABLE match (
    id INTEGER PRIMARY KEY, stage_id INTEGER, round INTEGER, slot INTEGER, leg INTEGER DEFAULT 1,
    home_entry_id INTEGER, away_entry_id INTEGER, status TEXT, note TEXT, walkover_side TEXT DEFAULT ''
  );
  CREATE TABLE match_event (
    id INTEGER PRIMARY KEY, match_id INTEGER, entry_id INTEGER, player_id INTEGER,
    assist_player_id INTEGER, type TEXT, minute INTEGER, created_at TEXT
  );`;

const T = 1; // 赛事 id
const HOME = 1; // 主队报名 id（team 11）
const AWAY = 2; // 客队报名 id（team 12）

function freshTour(): DatabaseSync {
  const tour = new DatabaseSync(':memory:');
  tour.exec(`${TOUR_SCHEMA}
    INSERT INTO tournament (id, name, status, config_json) VALUES (${T}, '联赛', 'running', '{}');
    INSERT INTO stage (id, tournament_id, kind, sort_order, name) VALUES (1, ${T}, 'league', 1, '常规赛');
    INSERT INTO entry (id, tournament_id, team_id, seed) VALUES (${HOME}, ${T}, 11, 1), (${AWAY}, ${T}, 12, 2);
    INSERT INTO team (id, name) VALUES (11, '海港联'), (12, '北岸城');
    INSERT INTO player (id, team_id, name, number) VALUES (101, 11, '张三', 7), (102, 11, '李四', 9), (201, 12, '王五', 1);`);
  return tour;
}

interface MatchSeed {
  status?: string;
  note?: string;
  walkoverSide?: string;
}

function addMatch(tour: DatabaseSync, id: number, round: number, opts: MatchSeed = {}): void {
  tour
    .prepare(
      `INSERT INTO match (id, stage_id, round, slot, leg, home_entry_id, away_entry_id, status, note, walkover_side)
       VALUES (?, 1, ?, 1, 1, ?, ?, ?, ?, ?)`,
    )
    .run(id, round, HOME, AWAY, opts.status ?? 'finished', opts.note ?? null, opts.walkoverSide ?? '');
}

/** 连排 n 场（round 1..n），返回 id 列表 */
function addSeq(tour: DatabaseSync, n: number, opts: MatchSeed = {}): number[] {
  const ids: number[] = [];
  for (let i = 1; i <= n; i += 1) {
    addMatch(tour, i, i, opts);
    ids.push(i);
  }
  return ids;
}

function addCard(tour: DatabaseSync, id: number, matchId: number, entryId: number, playerId: number, type: string, createdAt = '2026-01-01T00:00:00Z'): void {
  tour
    .prepare('INSERT INTO match_event (id, match_id, entry_id, player_id, type, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, matchId, entryId, playerId, type, createdAt);
}

function setConfig(tour: DatabaseSync, suspension: Record<string, unknown>): void {
  tour.prepare('UPDATE tournament SET config_json = ? WHERE id = ?').run(JSON.stringify({ suspension }), T);
}

async function susp(tour: DatabaseSync, matchId: number): Promise<Map<number, MatchSuspension>> {
  return suspendedPlayersAtMatch(createTestD1(tour), matchId);
}

/** 这一场某球员的停赛态（无 → null） */
async function at(tour: DatabaseSync, matchId: number, playerId: number): Promise<MatchSuspension | null> {
  return (await susp(tour, matchId)).get(playerId) ?? null;
}

describe('TC-SUS 停赛判定（只读 TOUR_DB 复算）', () => {
  it('TC-SUS-01 直红默认停 2 场：触发场本身不算，逐场消耗到刑满', async () => {
    const tour = freshTour();
    addSeq(tour, 4);
    addCard(tour, 1, 1, HOME, 101, 'red');

    expect(await at(tour, 1, 101)).toBeNull(); // 触发场还没进刑期
    expect(await at(tour, 2, 101)).toEqual({ reason: 'red', total: 2, serving: 1 });
    expect(await at(tour, 3, 101)).toEqual({ reason: 'red', total: 2, serving: 2 });
    expect(await at(tour, 4, 101)).toBeNull(); // 刑满
    expect(await at(tour, 2, 102)).toBeNull(); // 队友不受影响
  });

  it('TC-SUS-02 pending 场既不消耗停赛、也不算服刑场（赛事仓同口径）', async () => {
    const tour = freshTour();
    addMatch(tour, 1, 1);
    addMatch(tour, 2, 2, { status: 'pending' });
    addMatch(tour, 3, 3);
    addMatch(tour, 4, 4);
    addCard(tour, 1, 1, HOME, 101, 'red');

    expect(await at(tour, 2, 101)).toBeNull(); // 未开打的场次不消耗，也不算刑期
    expect(await at(tour, 3, 101)).toEqual({ reason: 'red', total: 2, serving: 1 });
    expect(await at(tour, 4, 101)).toEqual({ reason: 'red', total: 2, serving: 2 });
  });

  it('TC-SUS-03 配置生效：redBan=0 直红不停、red2yBan=2 两黄变一红停 2 场', async () => {
    const tour = freshTour();
    addSeq(tour, 6);
    setConfig(tour, { redBan: 0 });
    addCard(tour, 1, 1, HOME, 101, 'red');
    expect(await at(tour, 2, 101)).toBeNull(); // 配置 0 = 不停赛

    setConfig(tour, { red2yBan: 2 });
    addCard(tour, 2, 3, HOME, 101, 'red_2y');
    expect(await at(tour, 4, 101)).toEqual({ reason: 'red_2y', total: 2, serving: 1 });
    expect(await at(tour, 5, 101)).toEqual({ reason: 'red_2y', total: 2, serving: 2 });
    expect(await at(tour, 6, 101)).toBeNull();
  });

  it('TC-SUS-04 两黄变一红停 red2yBan 场，同场的黄牌不计入累积', async () => {
    const tour = freshTour();
    addSeq(tour, 6);
    // 同一场既吃黄也吃「两黄变一红」（第 2 黄自动转 red_2y 的形态）：那张黄不算累积
    addCard(tour, 1, 1, HOME, 101, 'yellow');
    addCard(tour, 2, 1, HOME, 101, 'red_2y');

    expect(await at(tour, 2, 101)).toEqual({ reason: 'red_2y', total: 1, serving: 1 });
    expect(await at(tour, 3, 101)).toBeNull(); // 只停 1 场
    expect(await at(tour, 4, 101)).toBeNull();
    // 若同场黄牌被计入累积，下面第 3 张黄（m4）就会触发停赛——本断言就是这个分界
    addCard(tour, 3, 3, HOME, 101, 'yellow');
    addCard(tour, 4, 4, HOME, 101, 'yellow');
    expect(await at(tour, 5, 101)).toBeNull();
    addCard(tour, 5, 5, HOME, 101, 'yellow'); // 累积第 3 张（m3/m4/m5）→ 停 m6
    expect(await at(tour, 6, 101)).toEqual({ reason: 'yellow', total: 1, serving: 1 });
  });

  it('TC-SUS-05 累积黄牌满阈值停 1 场并清零，跨场累积', async () => {
    const tour = freshTour();
    addSeq(tour, 8);
    addCard(tour, 1, 1, HOME, 101, 'yellow');
    addCard(tour, 2, 2, HOME, 101, 'yellow');
    addCard(tour, 3, 3, HOME, 101, 'yellow'); // 第 3 张 → 停 m4

    expect(await at(tour, 4, 101)).toEqual({ reason: 'yellow', total: 1, serving: 1 });
    expect(await at(tour, 5, 101)).toBeNull(); // 停完清零，不是继续累积

    addCard(tour, 4, 5, HOME, 101, 'yellow');
    addCard(tour, 5, 6, HOME, 101, 'yellow');
    addCard(tour, 6, 7, HOME, 101, 'yellow'); // 又从零攒满 3 张 → 停 m8
    expect(await at(tour, 8, 101)).toEqual({ reason: 'yellow', total: 1, serving: 1 });
  });

  it('TC-SUS-06 红牌与黄牌并行叠加：同一场先消耗旧刑期，再触发新刑期', async () => {
    const tour = freshTour();
    addSeq(tour, 6);
    addCard(tour, 1, 1, HOME, 101, 'red'); // 停 m2、m3
    addCard(tour, 2, 2, HOME, 101, 'yellow');
    addCard(tour, 3, 3, HOME, 101, 'yellow');
    addCard(tour, 4, 4, HOME, 101, 'yellow'); // 第 3 张 → 停 m5

    expect(await at(tour, 2, 101)).toEqual({ reason: 'red', total: 2, serving: 1 });
    expect(await at(tour, 3, 101)).toEqual({ reason: 'red', total: 2, serving: 2 });
    expect(await at(tour, 4, 101)).toBeNull(); // 红牌刑满，本场是黄牌触发场
    expect(await at(tour, 5, 101)).toEqual({ reason: 'yellow', total: 1, serving: 1 });
  });

  it('TC-SUS-07 弃权场：弃权方不消耗停赛，对手照常；双弃权双方都不消耗', async () => {
    const tour = freshTour();
    addMatch(tour, 1, 1);
    addMatch(tour, 2, 2, { walkoverSide: 'home' });
    addMatch(tour, 3, 3);
    addMatch(tour, 4, 4);
    addCard(tour, 1, 1, HOME, 101, 'red'); // 主队球员

    expect(await at(tour, 2, 101)).toBeNull(); // 本方弃权 → 不消耗也不算刑期
    expect(await at(tour, 3, 101)).toEqual({ reason: 'red', total: 2, serving: 1 });
    expect(await at(tour, 4, 101)).toEqual({ reason: 'red', total: 2, serving: 2 });
    // 客队球员不受对手弃权影响：主队弃权对客队是「非弃权方」，主队弃权的 m2 照常消耗客队的刑期
    addCard(tour, 2, 1, AWAY, 201, 'red');
    expect(await at(tour, 2, 201)).toEqual({ reason: 'red', total: 2, serving: 1 });

    // 双弃权：双方都不消耗
    const both = freshTour();
    addMatch(both, 1, 1);
    addMatch(both, 2, 2, { walkoverSide: 'both' });
    addMatch(both, 3, 3);
    addCard(both, 1, 1, HOME, 101, 'red');
    expect(await at(both, 2, 101)).toBeNull();
    expect(await at(both, 3, 101)).toEqual({ reason: 'red', total: 2, serving: 1 });
  });

  it('TC-SUS-08 轮空场不进比赛序列：不消耗停赛、本身也判不出服刑', async () => {
    const tour = freshTour();
    addMatch(tour, 1, 1);
    addMatch(tour, 2, 2, { note: '轮空' });
    addMatch(tour, 3, 3);
    addMatch(tour, 4, 4);
    addCard(tour, 1, 1, HOME, 101, 'red');

    expect(await susp(tour, 2)).toEqual(new Map()); // 轮空场不在序列里 → 谁也判不出来
    expect(await at(tour, 3, 101)).toEqual({ reason: 'red', total: 2, serving: 1 }); // 刑期没被轮空吃掉
    expect(await at(tour, 4, 101)).toEqual({ reason: 'red', total: 2, serving: 2 });
  });

  it('TC-SUS-09 黄牌清零锚点：分两段重放，锚点只重置黄牌，边界时刻归前段', async () => {
    const tour = freshTour();
    addSeq(tour, 8);
    setConfig(tour, { yellowThreshold: 3, yellowResetAt: '2026-02-01T00:00:00Z' });
    // 锚点前：3 张黄（第 3 张的 created_at 恰好等于锚点 → 归前段）→ 停 m4
    addCard(tour, 1, 1, HOME, 101, 'yellow', '2026-01-10T00:00:00Z');
    addCard(tour, 2, 2, HOME, 101, 'yellow', '2026-01-20T00:00:00Z');
    addCard(tour, 3, 3, HOME, 101, 'yellow', '2026-02-01T00:00:00Z');

    expect(await at(tour, 4, 101)).toEqual({ reason: 'yellow', total: 1, serving: 1 }); // 锚点前的停赛跨锚点照常执行

    // 锚点后黄牌从零重计：m5 是第 1 张、m6 第 2 张都不触发，m7 第 3 张 → 停 m8
    addCard(tour, 4, 5, HOME, 101, 'yellow', '2026-02-05T00:00:00Z');
    expect(await at(tour, 5, 101)).toBeNull();
    expect(await at(tour, 6, 101)).toBeNull();
    addCard(tour, 5, 6, HOME, 101, 'yellow', '2026-02-10T00:00:00Z');
    addCard(tour, 6, 7, HOME, 101, 'yellow', '2026-02-15T00:00:00Z');
    expect(await at(tour, 8, 101)).toEqual({ reason: 'yellow', total: 1, serving: 1 });

    // 锚点只重置黄牌：锚点前触发的红牌停赛在锚点后照常消耗
    addCard(tour, 7, 3, HOME, 102, 'red', '2026-01-25T00:00:00Z');
    expect(await at(tour, 4, 102)).toEqual({ reason: 'red', total: 2, serving: 1 });
    expect(await at(tour, 5, 102)).toEqual({ reason: 'red', total: 2, serving: 2 });
  });

  it('TC-SUS-10 纯派生：删掉红黄牌事件后停赛立即消失；判不出的场次返回空表', async () => {
    const tour = freshTour();
    addSeq(tour, 3);
    addCard(tour, 1, 1, HOME, 101, 'red');
    expect(await at(tour, 2, 101)).not.toBeNull();

    tour.exec('DELETE FROM match_event');
    expect(await at(tour, 2, 101)).toBeNull();

    expect(await susp(tour, 999)).toEqual(new Map()); // 比赛不存在
    addCard(tour, 2, 1, HOME, 102, 'red'); // 队友吃牌 → 只判出队友
    const only = await susp(tour, 2);
    expect(only.has(101)).toBe(false);
    expect(only.get(102)).toEqual({ reason: 'red', total: 2, serving: 1 });
  });

  it('TC-SUS-11 配置解析：缺省/坏 JSON/越界一律回退默认，字符串数字照收', async () => {
    expect(parseSuspensionConfig(null)).toEqual({ ...DEFAULT_SUSPENSION });
    expect(parseSuspensionConfig('')).toEqual({ ...DEFAULT_SUSPENSION });
    expect(parseSuspensionConfig('{ 坏 json')).toEqual({ ...DEFAULT_SUSPENSION });
    expect(parseSuspensionConfig('{}')).toEqual({ ...DEFAULT_SUSPENSION });
    expect(parseSuspensionConfig('{"other":1}')).toEqual({ ...DEFAULT_SUSPENSION });
    expect(parseSuspensionConfig('{"suspension":{"redBan":"3","red2yBan":-1,"yellowThreshold":99,"yellowResetAt":123}}')).toEqual({
      redBan: 3,
      red2yBan: DEFAULT_SUSPENSION.red2yBan, // 负数回退
      yellowThreshold: DEFAULT_SUSPENSION.yellowThreshold, // 越界回退
      yellowResetAt: null, // 非字符串回退
    });
    expect(parseSuspensionConfig('{"suspension":{"yellowThreshold":2,"yellowResetAt":"2026-02-01T00:00:00Z"}}')).toMatchObject({
      yellowThreshold: 2,
      yellowResetAt: '2026-02-01T00:00:00Z',
    });
    expect(suspensionLabel({ reason: 'red', total: 2, serving: 1 })).toBe('直红 · 停 2 场');
    expect(suspensionLabel({ reason: 'red_2y', total: 1, serving: 1 })).toBe('两黄变一红 · 停 1 场');
    expect(suspensionLabel({ reason: 'yellow', total: 1, serving: 1 })).toBe('累积黄牌 · 停 1 场');
  });

  it('TC-SUS-12 阈值可配为 2：第 2 张黄即停一场', async () => {
    const tour = freshTour();
    addSeq(tour, 4);
    setConfig(tour, { yellowThreshold: 2 });
    addCard(tour, 1, 1, HOME, 101, 'yellow');
    addCard(tour, 2, 2, HOME, 101, 'yellow');
    expect(await at(tour, 3, 101)).toEqual({ reason: 'yellow', total: 1, serving: 1 });
    expect(await at(tour, 4, 101)).toBeNull();
  });

  it('TC-SUS-13 多人各自判定：不同原因、不同刑期互不干扰', async () => {
    const tour = freshTour();
    addSeq(tour, 4);
    addCard(tour, 1, 1, HOME, 101, 'red'); // 停 m2、m3
    addCard(tour, 2, 1, AWAY, 201, 'red_2y'); // 停 m2

    const m2 = await susp(tour, 2);
    expect(m2.get(101)).toEqual({ reason: 'red', total: 2, serving: 1 });
    expect(m2.get(201)).toEqual({ reason: 'red_2y', total: 1, serving: 1 });
    const m3 = await susp(tour, 3);
    expect(m3.get(101)).toEqual({ reason: 'red', total: 2, serving: 2 });
    expect(m3.has(201)).toBe(false);
    expect(await susp(tour, 4)).toEqual(new Map());
  });

  it('TC-SUS-14 v6.51.9 取数趟数固定 7 条且不再重复查本队 entry（原 9 条串行）', async () => {
    const tour = freshTour();
    addSeq(tour, 3);
    addCard(tour, 1, 1, HOME, 101, 'red');

    const sql: string[] = [];
    const db = createTestD1(tour);
    const counted = new Proxy(db as unknown as Record<string, unknown>, {
      get(t, prop, receiver) {
        const v = Reflect.get(t, prop, receiver);
        if (typeof v !== 'function') return v;
        if (prop === 'prepare') {
          return (text: string) => {
            sql.push(text);
            return (v as (text: string) => unknown).call(t, text);
          };
        }
        return (v as (...a: unknown[]) => unknown).bind(t);
      },
    }) as unknown as D1Database;

    const hit = await suspendedPlayersAtMatch(counted, 2);
    expect(hit.get(101)).toEqual({ reason: 'red', total: 2, serving: 1 });
    // 本场 1 + 配置 1 + 两侧 entry 1 + 每侧「比赛序 + 红黄牌」2×2
    expect(sql).toHaveLength(7);
    // 调用方已持有本场两侧 entry，不再自己查一次「本队有哪些 entry」
    expect(sql.some((text) => /FROM entry\s+WHERE team_id/.test(text))).toBe(false);
  });

  it('TC-SUS-15 同赛事里本队另一支 entry（多报名形态）：记在别支上的红牌不影响本场判定', async () => {
    const tour = freshTour();
    addSeq(tour, 3);
    // 本队第二支 entry（id 3，team 11）另有自己的场次 90：事件按 p.team_id 收窄会把它读进来
    tour.exec(`INSERT INTO entry (id, tournament_id, team_id, seed) VALUES (3, ${T}, 11, 3);
      INSERT INTO match (id, stage_id, round, slot, leg, home_entry_id, away_entry_id, status, note, walkover_side)
        VALUES (90, 1, 9, 1, 1, 3, ${AWAY}, 'finished', NULL, '');`);
    addCard(tour, 1, 90, 3, 101, 'red');

    // 这张牌记在别支上、也不在本场序列里 ⇒ 本场不判停赛（收窄 entry 集合前后结论一致）
    expect((await susp(tour, 2)).get(101) ?? null).toBeNull();
  });
});
