// v6.43.0 成长录入截图识别 · 端点测试（mock 视觉网关 + 本地 D1 夹具）。
// 识别路径零 DB 写：成功后 growth_events / audit_log / growth_xp 必须原样不动（TC-EP-06）。
// v6.51.2：出站 max_tokens 缺省 1024（glm-4v-flash 上限）+ LLM_VISION_MAX_TOKENS 可配 + 截断明确报错。
// v6.51.3：提示词要求中文队名（锁出站文本）；队名对侧容忍译名/前后缀漂移，英文队名仍 400。
// 测试计划：docs/test-plans/v6.43.0-growth-ocr.md、docs/test-plans/v6.51.2-ocr-vision-maxtokens.md、
// docs/test-plans/v6.51.3-ocr-team-name-chinese.md。
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

/** 与 mockVision 同款桩，另把出站请求体记下来（v6.51.2 的 max_tokens 断言用） */
function captureVision(content: string, finishReason?: string): () => { url: string; body: Record<string, unknown> } {
  let last: { url: string; body: Record<string, unknown> } | null = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      last = { url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> };
      const choice = { message: { content }, ...(finishReason ? { finish_reason: finishReason } : {}) };
      return new Response(JSON.stringify({ choices: [choice] }), { status: 200 });
    }),
  );
  return () => last as { url: string; body: Record<string, unknown> };
}

function seeded(): Fixture {
  const fx = freshEnv(LLM);
  seedBase(fx);
  seedMatch(fx, MATCH_ID, '海港联', '北岸城');
  return fx;
}

/** 与 seeded 同款，但换成本场两队名（v6.51.3 队名对侧用例用） */
function seededTeams(homeTeam: string, awayTeam: string): Fixture {
  const fx = freshEnv(LLM);
  seedBase(fx);
  seedMatch(fx, MATCH_ID, homeTeam, awayTeam);
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
    // 认人：K. Zhang→10（5.1 差评照录）、L. Li→11（出场+评分）；自由身 14 / 训练营 13 不在花名册
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0]).toMatchObject({ playerId: 10, name: 'K. Zhang', matched: 'official', draft: { appearance: true, rating: 5.1 } });
    expect(body.entries[1]).toMatchObject({ playerId: 11, name: 'L. Li', draft: { appearance: true, rating: 9.2 } });
    expect(body.unmatched).toEqual([]);
    expect(body.warnings).toContain('模型备注：底部一行被遮挡');
    expect(body.warnings.some((w) => w.includes('低于 7.0'))).toBe(false); // v6.46.0：低评分不再是警告
  });

  it('TC-EP-04b 截图只给姓（v6.51.4 形态层）：Zhang → K. Zhang，matched 标 surname-initial', async () => {
    const fx = seeded();
    mockVision(
      JSON.stringify({
        ...summaryPayload,
        rows: [{ pos: 'GK', name: 'Zhang', rating: '5.1', goals: 0, assists: 0 }],
        selected: null,
      }),
    );
    const res = await sendOcr(fx, { image: PNG_B64 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as OcrResponse;
    expect(body.entries).toEqual([
      { playerId: 10, name: 'K. Zhang', position: 'GK', matched: 'surname-initial', draft: { appearance: true, rating: 5.1 } },
    ]);
    expect(body.unmatched).toEqual([]);
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
    // 门将 5.1（差评照录）+ gk 块并入 saves；M. Wang 7.5 出场+评分；SUB N/A 跳过
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0]).toMatchObject({ playerId: 10, draft: { appearance: true, rating: 5.1, saves: 3 } });
    expect(body.entries[1]).toMatchObject({ playerId: 12, draft: { appearance: true, rating: 7.5 } });
    expect(body.unmatched).toEqual([]);
  });

  it('TC-EP-08 出站 max_tokens 缺省 1024（glm-4v-flash 上限），env 非法值也回落 1024', async () => {
    const fx = seeded();
    const call = captureVision(JSON.stringify(summaryPayload));
    expect((await sendOcr(fx, { image: PNG_B64 })).status).toBe(200);
    expect(call().body.max_tokens).toBe(1024);
    expect(call().body.model).toBe('glm-4v-flash');

    const bad = seeded();
    bad.env.LLM_VISION_MAX_TOKENS = '4096.5'; // 非整数 = 非法，回落缺省而不是照发
    const badCall = captureVision(JSON.stringify(summaryPayload));
    expect((await sendOcr(bad, { image: PNG_B64 })).status).toBe(200);
    expect(badCall().body.max_tokens).toBe(1024);
  });

  it('TC-EP-09 LLM_VISION_MAX_TOKENS 可配：换付费视觉模型时抬高，不动代码', async () => {
    const fx = seeded();
    fx.env.LLM_VISION_MAX_TOKENS = '4096';
    const call = captureVision(JSON.stringify(summaryPayload));
    expect((await sendOcr(fx, { image: PNG_B64 })).status).toBe(200);
    expect(call().body.max_tokens).toBe(4096);
  });

  it('TC-EP-10 finish_reason=length：点名「输出被截断」，不再误报「不是合法 JSON」', async () => {
    const fx = seeded();
    captureVision('{"team":"海港联","tab":"Summary","rows":[{"pos":"GK"', 'length');
    const res = await sendOcr(fx, { image: PNG_B64 });
    expect(res.status).toBe(502);
    const err = ((await res.json()) as { error: string }).error;
    expect(err).toContain('截断');
    expect(err).toContain('LLM_VISION_MAX_TOKENS');

    // 截断后恰好还能解析出 JSON 也不放行（漏记球员比要求重试更贵）
    const fx2 = seeded();
    captureVision(JSON.stringify(summaryPayload), 'length');
    const res2 = await sendOcr(fx2, { image: PNG_B64 });
    expect(res2.status).toBe(502);
    expect(((await res2.json()) as { error: string }).error).toContain('截断');
  });

  it('TC-EP-11 提示词锁：出站文本要求中文队名，示例值也是中文（v6.51.3）', async () => {
    const fx = seeded();
    const call = captureVision(JSON.stringify(summaryPayload));
    expect((await sendOcr(fx, { image: PNG_B64 })).status).toBe(200);
    const body = call().body as { messages: { content: { type: string; text?: string }[] }[] };
    const text = body.messages[0].content.find((p) => p.type === 'text')?.text ?? '';
    expect(text).toContain('team 字段写该队的中文名');
    expect(text).toContain('CHELSEA → 切尔西');
    expect(text).toContain('"team": "切尔西"');
    // v6.51.3：歧义提示要显示截图上的英文原文 ⇒ 提示词得有 teamRaw
    expect(text).toContain('"teamRaw": "CHELSEA"');
    expect(text).toContain('teamRaw 字段照抄截图上该队队名的原文');
  });

  it('TC-EP-12 队名漂移容忍：译名差异/CPU 尾标不再误报「对不上这场比赛」', async () => {
    const drift = seededTeams('RB莱比锡', 'AC米兰(CPU)');
    captureVision(JSON.stringify({ ...summaryPayload, team: '莱比锡红牛' }));
    const res = await sendOcr(drift, { image: PNG_B64 });
    expect(res.status).toBe(200);
    expect(((await res.json()) as OcrResponse).side).toBe('home');

    const drift2 = seededTeams('RB莱比锡', 'AC米兰(CPU)');
    captureVision(JSON.stringify({ ...summaryPayload, team: '米兰' }));
    const res2 = await sendOcr(drift2, { image: PNG_B64 });
    expect(res2.status).toBe(200);
    expect(((await res2.json()) as OcrResponse).side).toBe('away');
  });

  it('TC-EP-13 模型没听话给英文队名时：400 点名截图队名与本场对阵，且回可选 side 的 code（v6.51.8）', async () => {
    const fx = seeded();
    mockVision(JSON.stringify({ ...summaryPayload, team: 'CHELSEA' }));
    const res = await sendOcr(fx, { image: PNG_B64 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.error).toContain('CHELSEA');
    expect(body.error).toContain('海港联');
    expect(body.error).toContain('对不上这场比赛');
    // 对不上不等于这张图作废：前端拿这个 code 渲染提示 + 主队/客队/取消，点完带 side 续跑
    expect(body.code).toBe('ocr_team_unmatched');
    expect(body.error).toContain('点按钮选边');
  });

  it('TC-EP-14 同城同前缀：写全了判给对的一侧，只写片段才 400 报「分不清主客」', async () => {
    // 未来的国际米兰 / AC米兰：写全「国际米兰」或「AC米兰」都能判对
    const full = seededTeams('国际米兰', 'AC米兰');
    captureVision(JSON.stringify({ ...summaryPayload, team: '国际米兰' }));
    const res = await sendOcr(full, { image: PNG_B64 });
    expect(res.status).toBe(200);
    expect(((await res.json()) as OcrResponse).side).toBe('home');

    const swap = seededTeams('国际米兰', 'AC米兰');
    captureVision(JSON.stringify({ ...summaryPayload, team: 'AC米兰' }));
    const res2 = await sendOcr(swap, { image: PNG_B64 });
    expect(res2.status).toBe(200);
    expect(((await res2.json()) as OcrResponse).side).toBe('away');

    // 现实里就有的对：只写「慕尼黑」两侧都像 ⇒ 不猜、不默认主队，文案点名两队并教怎么走
    const amb = seededTeams('拜仁慕尼黑', '慕尼黑1860');
    captureVision(JSON.stringify({ ...summaryPayload, team: '慕尼黑' }));
    const res3 = await sendOcr(amb, { image: PNG_B64 });
    expect(res3.status).toBe(400);
    const body3 = (await res3.json()) as { error: string; code?: string };
    expect(body3.code).toBe('ocr_team_ambiguous');
    expect(body3.error).toContain('慕尼黑');
    expect(body3.error).toContain('拜仁慕尼黑');
    expect(body3.error).toContain('慕尼黑1860');
    expect(body3.error).toContain('分不清主客');
  });

  it('TC-EP-15 歧义可带 side 直通：同一张图指定主客即跳过队名匹配；非法 side 400', async () => {
    // 点「客队 慕尼黑1860」＝原图带 side 重发：模型给的是片段「慕尼黑」也照走，不再比队名
    const amb = seededTeams('拜仁慕尼黑', '慕尼黑1860');
    captureVision(JSON.stringify({ ...summaryPayload, team: '慕尼黑', teamRaw: 'FC BAYERN MÜNCHEN' }));
    const res = await sendOcr(amb, { image: PNG_B64, side: 'away' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as OcrResponse).side).toBe('away');

    // 模型没听话给英文队名（本来会 400 对不上）也能靠 side 救回
    const fx = seeded();
    captureVision(JSON.stringify({ ...summaryPayload, team: 'CHELSEA' }));
    const res2 = await sendOcr(fx, { image: PNG_B64, side: 'home' });
    expect(res2.status).toBe(200);
    expect(((await res2.json()) as OcrResponse).side).toBe('home');

    mockVision(JSON.stringify(summaryPayload));
    const bad = await sendOcr(seeded(), { image: PNG_B64, side: 'Home' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain('side 只能是 home 或 away');
  });

  it('TC-EP-16 歧义文案带英文原文（teamRaw）：提示里显示截图上那个队名', async () => {
    mockVision(JSON.stringify({ ...summaryPayload, team: '慕尼黑', teamRaw: 'FC BAYERN MÜNCHEN' }));
    const res = await sendOcr(seededTeams('拜仁慕尼黑', '慕尼黑1860'), { image: PNG_B64 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.code).toBe('ocr_team_ambiguous');
    expect(body.error).toContain('FC BAYERN MÜNCHEN');
    expect(body.error).toContain('识别为「慕尼黑」');
    expect(body.error).toContain('分不清主客');
  });

  it('TC-EP-17 智谱端点默认关思考；非智谱端点不带该字段；LLM_VISION_THINKING=on 时保留思考（v6.51.4）', async () => {
    // 生产实际形态：LLM_API_BASE 是智谱 bigmodel.cn —— 抽字段用不上推理，默认 thinking.disabled
    const fx = freshEnv({ base: 'https://open.bigmodel.cn/api/paas/v4', key: 'k', model: 'glm-4.6v-flashx' });
    seedBase(fx);
    seedMatch(fx, MATCH_ID, '海港联', '北岸城');
    const call = captureVision(JSON.stringify(summaryPayload));
    expect((await sendOcr(fx, { image: PNG_B64 })).status).toBe(200);
    expect(call().body.thinking).toEqual({ type: 'disabled' });

    // 想留着思考（换模型后对比精度）：LLM_VISION_THINKING=on ⇒ 不带这个字段（模型回到自己的缺省）
    const on = freshEnv({ base: 'https://open.bigmodel.cn/api/paas/v4', key: 'k', model: 'glm-4.6v-flashx' });
    seedBase(on);
    seedMatch(on, MATCH_ID, '海港联', '北岸城');
    on.env.LLM_VISION_THINKING = 'on';
    const onCall = captureVision(JSON.stringify(summaryPayload));
    expect((await sendOcr(on, { image: PNG_B64 })).status).toBe(200);
    expect(onCall().body.thinking).toBeUndefined();

    // 换成别的 OpenAI 兼容厂商/中转：不要多带智谱私有字段（不认识会 4xx）
    const other = seeded();
    const otherCall = captureVision(JSON.stringify(summaryPayload));
    expect((await sendOcr(other, { image: PNG_B64 })).status).toBe(200);
    expect(otherCall().body.thinking).toBeUndefined();
  });
});
