// LLM 草稿工坊（v6.12.0，D3）端点测试：生成 → 草稿表审校 → 采纳/废弃。
// fetch 全程 mock：不联网、不断言模型质量，只断言钳制与入池路径。
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import { createTestD1, applyMigrations, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import type { Env } from '../src/worker/env.ts';

function freshEnv(llm?: { base?: string; key?: string; model?: string }): { env: Env; sqlite: DatabaseSync; kv: Map<string, string> } {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES (1, '教练甲', 'coach', 0, 0), (2, '管理组甲', 'admin', 0, 0);`,
  );
  const kv = new Map<string, string>();
  kv.set('sess:tok-admin', JSON.stringify({ userId: 2 }));
  kv.set('sess:tok-coach', JSON.stringify({ userId: 1 }));
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
  return { env, sqlite, kv };
}

const send = (method: string, path: string, env: Env, body?: unknown) =>
  app.request(
    path,
    { method, headers: { 'content-type': 'application/json', Cookie: 'whl_session=tok-admin' }, body: body === undefined ? undefined : JSON.stringify(body) },
    env,
  );

/** mock 一次 OpenAI 兼容回包 */
function mockChat(content: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })),
  );
}

beforeEach(() => resetConfigCache());
afterEach(() => vi.unstubAllGlobals());

describe('LLM 草稿工坊（管理端 only）', () => {
  it('llm-status：三变量齐才 configured；权限：匿名 401', async () => {
    const fx = freshEnv();
    expect(await (await send('GET', '/api/admin/events/llm-status', fx.env)).json()).toMatchObject({ configured: false });
    const fx2 = freshEnv({ base: 'https://llm.example/v1', key: 'k', model: 'm' });
    expect(await (await send('GET', '/api/admin/events/llm-status', fx2.env)).json()).toMatchObject({ configured: true });
    const anon = await app.request('/api/admin/events/llm-status', {}, freshEnv().env);
    expect(anon.status).toBe(401);
  });

  it('未配置 LLM：llm-draft 503 旁路（不写草稿）', async () => {
    const fx = freshEnv();
    const res = await send('POST', '/api/admin/events/llm-draft', fx.env, { kind: 'text', eventId: 'storm_buzz' });
    expect(res.status).toBe(503);
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM event_drafts`)!.n).toBe(0);
  });

  it('text 草稿：生成 → 采纳改写 template → 审计；重复采纳 409', async () => {
    const fx = freshEnv({ base: 'https://llm.example/v1', key: 'k', model: 'm' });
    mockChat('暴雨突袭，{stadium} 一片伞海，{team} 球迷湿身不减热情。');
    const gen = await send('POST', '/api/admin/events/llm-draft', fx.env, { kind: 'text', eventId: 'storm_buzz', hint: '更幽默一点' });
    expect(gen.status).toBe(201);
    const draftId = ((await gen.json()) as { id: number }).id;

    const adopt = await send('POST', `/api/admin/events/drafts/${draftId}/adopt`, fx.env);
    expect(adopt.status).toBe(200);
    const pool = sqlGet<{ template: string }>(fx.sqlite, `SELECT template FROM event_pool WHERE event_id = 'storm_buzz'`)!;
    expect(pool.template).toContain('伞海');
    expect(sqlGet<{ status: string }>(fx.sqlite, `SELECT status FROM event_drafts WHERE id = ${draftId}`)!.status).toBe('adopted');
    expect(sqlGet<{ action: string }>(fx.sqlite, `SELECT action FROM audit_log WHERE target_type = 'event_draft' AND target_id = ${draftId}`)!.action).toBe('event_draft_adopt');
    expect((await send('POST', `/api/admin/events/drafts/${draftId}/adopt`, fx.env)).status).toBe(409);
  });

  it('struct 草稿：LLM 的越界数值被钳（weight/效果钳幅/未登记键丢弃）→ 采纳入池 → 撞 event_id 409', async () => {
    const fx = freshEnv({ base: 'https://llm.example/v1', key: 'k', model: 'm' });
    mockChat(
      JSON.stringify({
        event_id: 'llm_event',
        name: 'LLM 事件',
        category: '测试',
        weight: 99,
        event_type: 'instant',
        conditions: { min_tier: 9, requires_naming: true, 神奇条件: 1 },
        effects: { money: 999, fans_pct: -0.9, satisfaction: 0.2, 神奇键: 1 },
        template: '测试模板',
      }),
    );
    const gen = await send('POST', '/api/admin/events/llm-draft', fx.env, { kind: 'struct', hint: '来点商业机会' });
    expect(gen.status).toBe(201);
    const body = (await gen.json()) as { id: number; payload: { weight: number; conditions: Record<string, unknown>; effects: Record<string, unknown> }; adjustments: string[] };
    expect(body.payload.weight).toBe(10); // 99 → 钳 10
    expect(body.payload.conditions.min_tier).toBe(4); // 越界钳上界
    expect(body.payload.conditions.requires_naming).toBe(true);
    expect(body.payload.conditions['神奇条件']).toBeUndefined();
    expect(body.payload.effects.money).toBe(8); // 999 → 钳 8
    expect(body.payload.effects.fans_pct).toBe(-0.05);
    expect(body.payload.effects['神奇键']).toBeUndefined();
    expect(body.adjustments.length).toBeGreaterThan(0);

    const draftId = body.id;
    const adopt = await send('POST', `/api/admin/events/drafts/${draftId}/adopt`, fx.env);
    expect(adopt.status).toBe(200);
    expect(sqlGet<{ source: string }>(fx.sqlite, `SELECT source FROM event_pool WHERE event_id = 'llm_event'`)!.source).toBe('custom');

    // 第二条同 event_id 的 struct 草稿：采纳 409
    mockChat(JSON.stringify({ event_id: 'llm_event', name: '撞车', event_type: 'instant', effects: { money: 1 } }));
    await send('POST', '/api/admin/events/llm-draft', fx.env, { kind: 'struct' });
    const drafts = (await (await send('GET', '/api/admin/events/drafts?status=draft', fx.env)).json()) as { drafts: { id: number }[] };
    expect((await send('POST', `/api/admin/events/drafts/${drafts.drafts[0]!.id}/adopt`, fx.env)).status).toBe(409);
  });

  it('struct 草稿最低要求：选择型 <2 个合法选项 / 即发型零合法效果 → 400，不落草稿', async () => {
    const fx = freshEnv({ base: 'https://llm.example/v1', key: 'k', model: 'm' });
    mockChat(JSON.stringify({ event_id: 'bad_choice', name: '坏草稿', event_type: 'choice', options: [{ no: 1, name: '只有一项', outcomes: [] }] }));
    const res = await send('POST', '/api/admin/events/llm-draft', fx.env, { kind: 'struct' });
    expect(res.status).toBe(400);
    mockChat(JSON.stringify({ event_id: 'bad_instant', name: '坏草稿', event_type: 'instant', effects: { 神奇键: 1 } }));
    expect((await send('POST', '/api/admin/events/llm-draft', fx.env, { kind: 'struct' })).status).toBe(400);
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM event_drafts`)!.n).toBe(0);
  });

  it('废弃草稿：status=discarded + 审计；已处理 409；权限：教练 403', async () => {
    const fx = freshEnv({ base: 'https://llm.example/v1', key: 'k', model: 'm' });
    fx.sqlite.exec(
      `INSERT INTO event_drafts (kind, payload_json, source_event_id, note, status, created_by, created_at, updated_at)
       VALUES ('text', '{"template":"x"}', 'storm_buzz', '', 'draft', 2, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    );
    const id = sqlGet<{ id: number }>(fx.sqlite, `SELECT id FROM event_drafts LIMIT 1`)!.id;
    expect((await send('POST', `/api/admin/events/drafts/${id}/discard`, fx.env)).status).toBe(200);
    expect(sqlGet<{ status: string }>(fx.sqlite, `SELECT status FROM event_drafts WHERE id = ${id}`)!.status).toBe('discarded');
    expect(sqlGet<{ action: string }>(fx.sqlite, `SELECT action FROM audit_log WHERE target_type = 'event_draft' AND target_id = ${id}`)!.action).toBe('event_draft_discard');
    expect((await send('POST', `/api/admin/events/drafts/${id}/discard`, fx.env)).status).toBe(409);

    const coach = await app.request(`/api/admin/events/drafts/${id}/discard`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: 'whl_session=tok-coach' },
    }, { ...fx.env, TOUR_DB: fx.env.TOUR_DB } as Env);
    expect(coach.status).toBe(403);
  });
});
