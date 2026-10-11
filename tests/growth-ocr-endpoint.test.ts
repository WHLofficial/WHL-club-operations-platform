// v6.43.0 成长录入截图识别 · 端点测试（mock 视觉网关 + 本地 D1 夹具）。
// 识别路径零 DB 写：成功后 growth_events / audit_log / growth_xp 必须原样不动（TC-EP-06）。
// 测试计划：docs/test-plans/v6.43.0-growth-ocr.md。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { applyMigrations, createTestD1, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  kv: Map<string, string>;
}

function freshEnv(llm?: { base?: string; key?: string; model?: string }): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES
       (1, '管理组甲', 'admin', 0, 0),
       (2, '教练乙', 'coach', 0, 0);
     CREATE TABLE match (id INTEGER PRIMARY KEY, status TEXT);`,
  );
  const kv = new Map<string, string>();
  const env = {
    DB: createTestD1(sqlite),
    TOUR_DB: createTestD1(tour),
    SESSION_KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    } as unknown as KVNamespace,
    MEDIA: {} as never,
    ASSETS: {} as never,
    LLM_API_BASE: llm?.base,
    LLM_API_KEY: llm?.key,
    LLM_MODEL: llm?.model,
  } as unknown as Env;
  kv.set('sess:tok-admin', JSON.stringify({ userId: 1 }));
  kv.set('sess:tok-coach', JSON.stringify({ userId: 2 }));
  sqlite.exec(
    `INSERT INTO seasons (season, status, created_at) VALUES (7, 'running', '2026-01-01T00:00:00Z');`,
  );
  return { env, sqlite, kv };
}

// 平台种子：1 海港联、2 北岸城；球员与 tests/growth-match-entry.test.ts 同族
//（10 门将带显示名 / 11 前锋无显示名 / 12 挂牌中场 / 13 训练营 / 14 自由身不进花名册 / 20 北岸城门将）
function seedBase(fx: Fixture): void {
  fx.sqlite.exec(`
    INSERT INTO clubs (id, name, league_tier, status) VALUES
      (1, '海港联', 'premier', 'active'), (2, '北岸城', 'premier', 'active');
    INSERT INTO players (id, uid, name, display_name, club_id, position, status, growth_xp, ca) VALUES
      (10, 'p10', 'K. Zhang', '张三', 1, 'GK', 'normal', 0, 70),
      (11, 'p11', 'L. Li', NULL, 1, 'ST', 'normal', 0, 70),
      (12, 'p12', 'M. Wang', NULL, 1, 'CM', 'listed', 0, 70),
      (13, 'p13', 'N. Zhao', '赵十三', 1, 'CM', 'trainee', 0, 60),
      (14, 'p14', 'O. Sun', NULL, 1, 'ST', 'free', 0, 60),
      (20, 'p20', 'Q. Qian', NULL, 2, 'GK', 'normal', 0, 70);
  `);
}

function seedMatch(fx: Fixture, matchId: number, homeTeam: string, awayTeam: string, scoreHome = 2, scoreAway = 4): void {
  fx.sqlite
    .prepare(
      `INSERT INTO result_confirmations
         (season, window_seq, tournament_id, match_id, competition_type, stage_name, stage_kind, round,
          home_team_id, away_team_id, home_team, away_team, score_home, score_away, walkover_side,
          finished_at, confirmed_by, confirmed_at)
       VALUES (7, 2, 5, ?, 'league_premier', '常规赛', 'league', 1, 501, 502, ?, ?, ?, ?, '', '2026-07-01T21:00:00Z', 1, '2026-07-01T21:30:00Z')`,
    )
    .run(matchId, homeTeam, awayTeam, scoreHome, scoreAway);
}

const LLM = { base: 'https://llm.example/v1', key: 'k', model: 'glm-4v-flash' };
const PNG_B64 = 'iVBORw0KGgo='; // 89 50 4E 47 0D 0A 1A 0A —— 只需要魔数，视觉调用本身是 mock
const MATCH_ID = 2001;
const ocrPath = (matchId: number | string) => `/api/admin/growth/match-entry/${matchId}/ocr`;

const summaryPayload = {
  team: '海港联',
  tab: 'Summary',
  rows: [
    { pos: 'GK', name: 'K. Zhang', rating: '5.1', goals: 0, assists: 0 },
    { pos: 'ST', name: 'L. Li', rating: '9.2', goals: 2, assists: 1 },
    { pos: 'SUB', name: 'X. Bench', rating: 'N/A', goals: 0, assists: 0 },
  ],
  selected: { name: 'L. Li', rating: '9.2', goals: 2, assists: 1, possessionWon: 3, minutes: 94 },
  gk: null,
  notes: '',
};

const gkPayload = {
  team: '海港联',
  tab: 'Goalkeeping',
  rows: [
    { pos: 'GK', name: 'K. Zhang', rating: '5.1', goals: 0, assists: 0 },
    { pos: 'CM', name: 'M. Wang', rating: '7.5', goals: 0, assists: 0 },
    { pos: 'SUB', name: 'X. Bench', rating: 'N/A', goals: 0, assists: 0 },
  ],
  selected: null,
  gk: { name: 'K. Zhang', gkRating: '4.0', shotsAgainst: 10, shotsOnTarget: 7, saves: 3, goalsConceded: 4 },
};

function mockVision(content: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })),
  );
}

function seeded(): Fixture {
  const fx = freshEnv(LLM);
  seedBase(fx);
  seedMatch(fx, MATCH_ID, '海港联', '北岸城');
  return fx;
}

async function sendOcr(fx: Fixture, body: unknown, token = 'tok-admin', matchId: number | string = MATCH_ID): Promise<Response> {
  return app.request(
    ocrPath(matchId),
    { method: 'POST', headers: { 'content-type': 'application/json', Cookie: `whl_session=${token}` }, body: JSON.stringify(body) },
    fx.env,
  );
}

interface OcrResponse {
  team: string | null;
  side: 'home' | 'away';
  kind: 'summary' | 'goalkeeping';
  entries: { playerId: number; name: string; draft: Record<string, unknown>; matched: string }[];
  unmatched: { name: string; pos: string }[];
  warnings: string[];
}

beforeEach(() => resetConfigCache());
afterEach(() => vi.unstubAllGlobals());

describe('TC-EP 截图识别端点', () => {
  it('TC-EP-01 权限：匿名 401、教练 403；不可补录比赛 404', async () => {
    const fx = seeded();
    const anon = await app.request(ocrPath(MATCH_ID), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, fx.env);
    expect(anon.status).toBe(401);
    const coach = await sendOcr(fx, { image: PNG_B64 }, 'tok-coach');
    expect(coach.status).toBe(403);
    const missing = await sendOcr(fx, { image: PNG_B64 }, 'tok-admin', 99999);
    expect(missing.status).toBe(404);
  });

  it('TC-EP-02 入参校验：缺 image、base64 坏、魔数不是 PNG/JPEG、超 5MB 各回 400', async () => {
    const fx = seeded();
    expect((await sendOcr(fx, {})).status).toBe(400); // image 缺失
    expect((await sendOcr(fx, { image: '!!!not-base64!!!' })).status).toBe(400);
    expect((await sendOcr(fx, { image: 'aGVsbG8gd29ybGQ=' })).status).toBe(400); // 'hello world' 无图片魔数
    expect((await sendOcr(fx, { image: 'A'.repeat(7_000_000) })).status).toBe(400); // ≈5.25MB
  });

  it('TC-EP-03 未配置 LLM → 503；网关回非 JSON → 502；两者都不写库', async () => {
    const unconfigured = seeded();
    unconfigured.env.LLM_API_BASE = undefined as unknown as string;
    const res503 = await sendOcr(unconfigured, { image: PNG_B64 });
    expect(res503.status).toBe(503);

    const fx = seeded();
    mockVision('抱歉，我无法输出结构化数据');
    const res502 = await sendOcr(fx, { image: PNG_B64 });
    expect(res502.status).toBe(502);
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM growth_events')!.n).toBe(0);
  });

  it('TC-EP-04 合法 summary：队名对上主队、花名册认人、警告与模型备注贯通', async () => {
    const fx = seeded();
    mockVision(JSON.stringify({ ...summaryPayload, notes: '底部一行被遮挡' }));
    const res = await sendOcr(fx, { image: PNG_B64 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as OcrResponse;
    expect(body.side).toBe('home');
    expect(body.kind).toBe('summary');
    expect(body.team).toBe('海港联');
    // 认人：K. Zhang→10（5.1 只出场）、L. Li→11（出场+评分）；自由身 14 / 训练营 13 不在花名册
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0]).toMatchObject({ playerId: 10, name: 'K. Zhang', matched: 'official', draft: { appearance: true } });
    expect(body.entries[1]).toMatchObject({ playerId: 11, name: 'L. Li', draft: { appearance: true, rating: 9.2 } });
    expect(body.unmatched).toEqual([]);
    expect(body.warnings).toContain('「K. Zhang」评分 5.1 低于 7.0，只预填出场（7.0 以下不给 XP）');
    expect(body.warnings).toContain('模型备注：底部一行被遮挡');
  });

  it('TC-EP-05 页签不是两张业务页签 → 502 点名；队名对不上两侧 → 400 点名截图队名', async () => {
    const fx = seeded();
    mockVision(JSON.stringify({ ...summaryPayload, tab: 'Shooting' }));
    const mismatch = await sendOcr(fx, { image: PNG_B64 });
    expect(mismatch.status).toBe(502);
    // parseOcrVision 层就拦未知页签：错误信息点名「页签「Shooting」不是 Summary 或 Goalkeeping」
    expect(((await mismatch.json()) as { error: string }).error).toContain('页签「Shooting」');

    mockVision(JSON.stringify({ ...summaryPayload, team: '巴黎圣日耳曼' }));
    const wrongTeam = await sendOcr(fx, { image: PNG_B64 });
    expect(wrongTeam.status).toBe(400);
    expect(((await wrongTeam.json()) as { error: string }).error).toContain('巴黎圣日耳曼');
  });

  it('TC-EP-06 零 DB 写：成功路径后 growth_events / audit_log / growth_xp 原样不动', async () => {
    const fx = seeded();
    mockVision(JSON.stringify(summaryPayload));
    await sendOcr(fx, { image: PNG_B64 });
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM growth_events')!.n).toBe(0);
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM audit_log')!.n).toBe(0);
    expect(sqlGet<{ xp: number }>(fx.sqlite, 'SELECT growth_xp AS xp FROM players WHERE id = 11')!.xp).toBe(0);
  });

  it('TC-EP-07 合法 goalkeeping：左表行照常并出 + 门将块并进门将同一条（页签由模型定）', async () => {
    const fx = seeded();
    mockVision(JSON.stringify(gkPayload));
    const res = await sendOcr(fx, { image: PNG_B64 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as OcrResponse;
    expect(body.side).toBe('home');
    expect(body.kind).toBe('goalkeeping'); // 请求没带 kind，页签来自识别结果
    // 门将 5.1（<7 只出场）+ gk 块并入 saves；M. Wang 7.5 出场+评分；SUB N/A 跳过
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0]).toMatchObject({ playerId: 10, draft: { appearance: true, saves: 3 } });
    expect(body.entries[1]).toMatchObject({ playerId: 12, draft: { appearance: true, rating: 7.5 } });
    expect(body.unmatched).toEqual([]);
    expect(body.warnings).toContain('「K. Zhang」评分 5.1 低于 7.0，只预填出场（7.0 以下不给 XP）');
  });
});
