// §10.3 成长档位：管理端端点 + 公开球员页 + 触发点挂钩（v6.48.0）。
// 这一层是「口径落地」的地方：端点参数校验、审计留痕、以及每条会改 players.club_id / 未来之星 /
// 队壳国家的路径是否真的把重算挂上了——漏一处就是静默的错档位（页面上看不出来）。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, sqlAll, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { confirmImport } from '../src/worker/players-import.ts';
import { confirmContractsImport } from '../src/worker/contracts-import.ts';
import { completeTermination, completeTransfer } from '../src/worker/transfers.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
}

/** 队壳：1 = 英格兰(14)（队内球员 1、2），2 = 意大利(27)（球员 3），3 = 未设国家（球员 4）
 *  自动档位：p1 = 3（c1+c2）、p2 = 2（c1）、p3 = 3（c2+c5 17 岁）、p4 = 2（c1）——四条都比现值 1 高 */
function freshEnv(): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  sqlite.exec(`
    INSERT INTO clubs (id, name, country, status) VALUES
      (1, '阿森纳', 14, 'active'),
      (2, '尤文图斯', 27, 'active'),
      (3, '没设国家的队', NULL, 'active'),
      (10, '曼城 (CPU)', 14, 'active');
    INSERT INTO players (id, uid, name, club_id, fc_id, age, china_plan, is_future_star, growth_tier, game_attrs) VALUES
      (1, 'fc1', '球员一', 1, 101, 24, 0, 0, 1, '{"TeamID": 1, "naID": 14}'),
      (2, 'fc2', '球员二', 1, 102, 24, 0, 0, 1, '{"TeamID": 1, "naID": 155}'),
      (3, 'fc3', '球员三', 2, 103, 17, 0, 0, 1, '{"TeamID": 3, "naID": 27}'),
      (4, 'fc4', '球员四', 3, 104, 24, 0, 0, 1, '{"TeamID": 3, "naID": 14}');
  `);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES (1, '管理组甲', 'admin', 0, 0);
     CREATE TABLE team (id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z');
     INSERT INTO team (id, org_id, name) VALUES (500, 1, '游戏里的队');`,
  );
  const kv = new Map<string, string>();
  kv.set('sess:tok-admin', JSON.stringify({ userId: 1 }));
  const env: Env = {
    DB: createTestD1(sqlite),
    TOUR_DB: createTestD1(tour),
    SESSION_KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    } as unknown as KVNamespace,
    MEDIA: {} as never,
    ASSETS: {} as never,
  };
  return { env, sqlite };
}

function req(method: 'GET' | 'POST', path: string, env: Env, body?: unknown) {
  return app.request(
    path,
    { method, headers: { 'content-type': 'application/json', Cookie: 'whl_session=tok-admin' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
    env,
  );
}

const post = (path: string, body: unknown, env: Env) => req('POST', path, env, body);
const get = (path: string, env: Env) => req('GET', path, env);

const tierOf = (sqlite: DatabaseSync, id: number) =>
  sqlGet<{ growth_tier: number; growth_tier_locked: number }>(sqlite, `SELECT growth_tier, growth_tier_locked FROM players WHERE id = ${id}`);

const auditOf = (sqlite: DatabaseSync, action: string) =>
  sqlAll<{ target_type: string; target_id: number | null; origin: string; actor: number | null; before: string | null; after: string | null }>(
    sqlite,
    `SELECT target_type, target_id, origin, actor, before, after FROM audit_log WHERE action = '${action}' ORDER BY id`,
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('§10.3 建队：队壳国家必填（v6.48.0）', () => {
  it('缺国家 / 非法编号 → 400，且不建档', async () => {
    const fx = freshEnv();
    for (const body of [{ gameTeamId: 500 }, { gameTeamId: 500, country: 0 }, { gameTeamId: 500, country: 'abc' }, { gameTeamId: 500, country: 999999 }]) {
      const res = await post('/api/admin/clubs', body, fx.env);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain('必须选择队壳国家');
    }
    expect(sqlGet(fx.sqlite, 'SELECT id FROM clubs WHERE id = 500')).toBeUndefined();
  });

  it('带国家 → 201，落库 + 审计 after.country', async () => {
    const fx = freshEnv();
    const res = await post('/api/admin/clubs', { gameTeamId: 500, country: 14 }, fx.env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { club: { id: number; country: number | null } };
    expect(body.club).toMatchObject({ id: 500, country: 14 });
    expect(sqlGet<{ country: number }>(fx.sqlite, 'SELECT country FROM clubs WHERE id = 500')).toEqual({ country: 14 });
    const audit = auditOf(fx.sqlite, 'club_create')[0];
    expect(audit).toMatchObject({ target_type: 'club', target_id: 500, origin: 'user', actor: 1 });
    expect(JSON.parse(audit.after!)).toMatchObject({ gameTeamId: 500, country: 14 });
  });

  it('GET /clubs 下发 country 与 countryName（null = 未设，前端标出来）', async () => {
    const fx = freshEnv();
    const res = await get('/api/admin/clubs', fx.env);
    const body = (await res.json()) as { clubs: { id: number; country: number | null; countryName: string | null }[] };
    const byId = new Map(body.clubs.map((c) => [c.id, c]));
    expect(byId.get(1)).toMatchObject({ country: 14, countryName: 'England' });
    expect(byId.get(3)).toMatchObject({ country: null, countryName: null });
  });
});

describe('§10.3 改队壳国家：写库 + 审计 + 该队重算（v6.48.0）', () => {
  it('POST /clubs/:id/country：落值、留痕、该队球员档位随之重算', async () => {
    const fx = freshEnv();
    // 3 号队原无国家：球员四的 c2 判不出来（档 2：c1 命中 +1）
    expect(tierOf(fx.sqlite, 4)?.growth_tier).toBe(1);
    const res = await post('/api/admin/clubs/3/country', { country: 14 }, fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; country: number; countryName: string; tier: { up: number; down: number } };
    expect(body).toMatchObject({ ok: true, country: 14, countryName: 'England' });
    // 球员四：TeamID 3 = club_id 3 ✓、naID 14 = country 14 ✓ → 档 3
    expect(body.tier).toEqual({ up: 1, down: 0 });
    expect(tierOf(fx.sqlite, 4)?.growth_tier).toBe(3);
    const audit = auditOf(fx.sqlite, 'club_country_set')[0];
    expect(JSON.parse(audit.before!)).toEqual({ country: null });
    expect(JSON.parse(audit.after!)).toEqual({ country: 14, countryName: 'England' });
    // 重算自己也留了一条审计（action growth_tier_set，auto=true）
    expect(auditOf(fx.sqlite, 'growth_tier_set').map((a) => a.target_id)).toEqual([4]);
  });

  it('非法国家 400 / 队不存在 404', async () => {
    const fx = freshEnv();
    expect((await post('/api/admin/clubs/1/country', { country: 999999 }, fx.env)).status).toBe(400);
    expect((await post('/api/admin/clubs/999/country', { country: 14 }, fx.env)).status).toBe(404);
  });
});

describe('§10.3 管理端档位页端点（v6.48.0）', () => {
  it('GET /growth/tier-recompute：预览（不写库）+ 五条件说明', async () => {
    const fx = freshEnv();
    const res = await get('/api/admin/growth/tier-recompute', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      scope: string;
      scanned: number;
      up: number;
      down: number;
      applied: boolean;
      batches: number;
      rows: { playerId: number; nextTier: number; conditions: Record<string, boolean> }[];
      conditions: { key: string; label: string; points: number; hint: string }[];
    };
    expect(body).toMatchObject({ ok: true, scope: 'all', scanned: 4, up: 4, down: 0, applied: false, batches: 0 });
    expect(body.conditions.map((c) => c.key)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    expect(body.conditions.map((c) => c.points)).toEqual([1, 1, 1, 2, 1]);
    expect(body.rows.map((r) => r.playerId)).toEqual([1, 2, 3, 4]);
    expect(tierOf(fx.sqlite, 1)?.growth_tier).toBe(1);
  });

  it('POST /growth/tier-recompute：全量执行（applied=true，写差异 + 批次审计）', async () => {
    const fx = freshEnv();
    const res = await post('/api/admin/growth/tier-recompute', {}, fx.env);
    const body = (await res.json()) as { applied: boolean; up: number; down: number; locked: number; batches: number };
    expect(body).toMatchObject({ applied: true, up: 4, down: 0, locked: 0, batches: 1 });
    expect(tierOf(fx.sqlite, 1)?.growth_tier).toBe(3);
    expect(tierOf(fx.sqlite, 2)?.growth_tier).toBe(2);
    expect(tierOf(fx.sqlite, 3)?.growth_tier).toBe(3);
    expect(tierOf(fx.sqlite, 4)?.growth_tier).toBe(2);
    expect(auditOf(fx.sqlite, 'growth_tier_recompute')).toHaveLength(1);
  });

  it('POST /growth/tier-recompute {clubId}：只重算该队；非法 clubId 400', async () => {
    const fx = freshEnv();
    const res = await post('/api/admin/growth/tier-recompute', { clubId: 2 }, fx.env);
    const body = (await res.json()) as { scope: string; up: number; scanned: number };
    expect(body).toMatchObject({ scope: 'clubs', scanned: 1, up: 1 });
    expect(tierOf(fx.sqlite, 3)?.growth_tier).toBe(3);
    expect(tierOf(fx.sqlite, 1)?.growth_tier).toBe(1); // 别的队没动
    expect((await post('/api/admin/growth/tier-recompute', { clubId: 0 }, fx.env)).status).toBe(400);
    expect((await post('/api/admin/growth/tier-recompute', { clubId: 'x' }, fx.env)).status).toBe(400);
  });

  it('GET /growth/tier-changes：变更清单（before/after 已解析，带 origin 与 actor）', async () => {
    const fx = freshEnv();
    await post('/api/admin/growth/tier-recompute', {}, fx.env);
    const res = await get('/api/admin/growth/tier-changes?limit=10', fx.env);
    const body = (await res.json()) as { entries: { action: string; targetId: number | null; origin: string; actor: number | null; before: unknown; after: unknown }[] };
    const sets = body.entries.filter((e) => e.action === 'growth_tier_set');
    expect(sets.map((e) => e.targetId).sort()).toEqual([1, 2, 3, 4]);
    expect(sets[0]).toMatchObject({ origin: 'user', actor: 1 });
    // 清单按 id 倒序（最新在前），快照核对按球员号找 1 号那条
    const p1 = sets.find((e) => e.targetId === 1)!;
    expect(p1.before).toEqual({ tier: 1 });
    expect(p1.after).toMatchObject({ tier: 3, auto: true });
    expect(body.entries.some((e) => e.action === 'growth_tier_recompute')).toBe(true);
  });

  it('GET /growth/tier-clubs-without-country：列出未设国家的队与队内人数', async () => {
    const fx = freshEnv();
    const res = await get('/api/admin/growth/tier-clubs-without-country', fx.env);
    const body = (await res.json()) as { clubs: { id: number; name: string; players: number; countryName: null }[] };
    expect(body.clubs).toEqual([{ id: 3, name: '没设国家的队', players: 1, countryName: null }]);
  });

  it('GET /growth/:playerId/tier：依据明细（自动档 / 锁定 / 队壳国家 / 三态条件）', async () => {
    const fx = freshEnv();
    const res = await get('/api/admin/growth/4/tier', fx.env);
    const body = (await res.json()) as {
      playerId: number;
      currentTier: number;
      locked: boolean;
      autoTier: number;
      clubCountry: number | null;
      clubCountryName: string | null;
      conditions: { key: string; hit: boolean; missing: boolean }[];
    };
    expect(body).toMatchObject({ playerId: 4, currentTier: 1, locked: false, autoTier: 2, clubCountry: null, clubCountryName: null });
    const c2 = body.conditions.find((c) => c.key === 'c2')!;
    expect(c2).toMatchObject({ hit: false, missing: true }); // 队壳没国家 → 数据缺失（不是普通未命中）
    expect(body.conditions.find((c) => c.key === 'c1')).toMatchObject({ hit: true, missing: false });
    // 404 / 400
    expect((await get('/api/admin/growth/999/tier', fx.env)).status).toBe(404);
    expect((await get('/api/admin/growth/0/tier', fx.env)).status).toBe(400);
  });

  it('人工核定 = 写值 + 置锁（审计 auto=false），后续重算跳过它；解除锁定即回到自动值', async () => {
    const fx = freshEnv();
    const res = await post('/api/admin/growth/1/tier', { tier: 5 }, fx.env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, tier: 5, locked: true });
    expect(tierOf(fx.sqlite, 1)).toEqual({ growth_tier: 5, growth_tier_locked: 1 });
    const manual = auditOf(fx.sqlite, 'growth_tier_set')[0];
    expect(manual).toMatchObject({ target_type: 'player', target_id: 1, origin: 'user', actor: 1 });
    expect(JSON.parse(manual.after!)).toMatchObject({ tier: 5, auto: false, locked: true });

    // 全量重算：1 号被跳过（自动值 3 不覆盖人工的 5），其余照算
    const recompute = (await (await post('/api/admin/growth/tier-recompute', {}, fx.env)).json()) as { up: number; locked: number };
    expect(recompute).toMatchObject({ locked: 1, up: 3 });
    expect(tierOf(fx.sqlite, 1)).toEqual({ growth_tier: 5, growth_tier_locked: 1 });

    // 解除锁定 → 立即重算回自动值 3，并留 unlock 审计
    const unlock = (await (await post('/api/admin/growth/1/tier/unlock', {}, fx.env)).json()) as { ok: boolean; tier: number; changed: boolean };
    expect(unlock).toMatchObject({ ok: true, tier: 3, changed: true });
    expect(tierOf(fx.sqlite, 1)).toEqual({ growth_tier: 3, growth_tier_locked: 0 });
    const unlockAudit = auditOf(fx.sqlite, 'growth_tier_unlock')[0];
    expect(JSON.parse(unlockAudit.before!)).toEqual({ tier: 5, locked: true });
    expect(JSON.parse(unlockAudit.after!)).toMatchObject({ tier: 3, locked: false, auto: true });
    // 再解除一次 → 400（没锁定）
    expect((await post('/api/admin/growth/1/tier/unlock', {}, fx.env)).status).toBe(400);
  });

  it('档位越界 400 / 球员不存在 404', async () => {
    const fx = freshEnv();
    expect((await post('/api/admin/growth/1/tier', { tier: 0 }, fx.env)).status).toBe(400);
    expect((await post('/api/admin/growth/1/tier', { tier: 6 }, fx.env)).status).toBe(400);
    expect((await post('/api/admin/growth/999/tier', { tier: 3 }, fx.env)).status).toBe(404);
  });
});

describe('§10.3 公开球员页：档位依据（v6.48.0）', () => {
  it('GET /players/:fcId/growth 带 tierBasis（自动值 + 五条件三态 + 队壳国家）', async () => {
    const fx = freshEnv();
    const res = await get('/api/players/104/growth', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      player: {
        growthTier: number;
        tierBasis: { autoTier: number; locked: boolean; clubCountry: number | null; clubCountryName: string | null; conditions: { key: string; hit: boolean; missing: boolean; points: number }[] };
      };
    };
    expect(body.player.growthTier).toBe(1);
    expect(body.player.tierBasis).toMatchObject({ autoTier: 2, locked: false, clubCountry: null, clubCountryName: null });
    expect(body.player.tierBasis.conditions).toHaveLength(5);
    expect(body.player.tierBasis.conditions.find((c) => c.key === 'c2')).toMatchObject({ missing: true, hit: false });
    expect((await get('/api/players/999999/growth', fx.env)).status).toBe(404);
  });

  it('人工锁定在公开页也看得见（locked=true，自动值单独给出）', async () => {
    const fx = freshEnv();
    await post('/api/admin/growth/1/tier', { tier: 5 }, fx.env);
    const body = (await (await get('/api/players/101/growth', fx.env)).json()) as { player: { tierBasis: { autoTier: number; locked: boolean } } };
    expect(body.player.tierBasis).toMatchObject({ autoTier: 3, locked: true });
  });
});

describe('§10.3 触发点：改未来之星 / 导入 / 合同认领（v6.48.0）', () => {
  it('批量改未来之星（+2）→ 该批球员档位立刻重算', async () => {
    const fx = freshEnv();
    const res = await post('/api/admin/players/batch', { items: [{ id: 1, isFutureStar: true }] }, fx.env);
    expect(res.status).toBe(200);
    // 球员一：c1+c2 = 3，未来之星 +2 → 5
    expect(tierOf(fx.sqlite, 1)?.growth_tier).toBe(5);
    expect(tierOf(fx.sqlite, 2)?.growth_tier).toBe(1); // 没在批里的不动
  });

  it('球员导入（TeamID 命中队壳）→ 导入收尾重算', async () => {
    const fx = freshEnv();
    const out = (await confirmImport(fx.env, 1, {
      channel: 'A',
      mode: 'minor',
      // TeamID 用 CPU 队号（导入只给 4 支 CPU 队球员写队籍，见 core/import.ts clubIdForTeam）
      rows: [{ ID: 9001, Name: '新人甲', Age: 24, CA: 70, PA: 90, naID: 14, PosID1: -1, FootID: 1, TeamID: 10 }],
    })) as { written: number };
    expect(out.written).toBe(1);
    const row = sqlGet<{ growth_tier: number; club_id: number }>(fx.sqlite, `SELECT growth_tier, club_id FROM players WHERE fc_id = 9001`);
    expect(row).toMatchObject({ club_id: 10 });
    expect(row?.growth_tier).toBe(3); // TeamID 10 = club 10 ✓、naID 14 = 曼城队壳国家 England ✓
  });

  it('合同导入认领（无归属 → 该队）→ 认领后重算（c1/c2 都锚在 club_id 上）', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`INSERT INTO players (id, uid, name, club_id, fc_id, age, game_attrs) VALUES (9, 'fc9', '海捞甲', NULL, 109, 24, '{"TeamID": 1, "naID": 14}')`);
    const out = (await confirmContractsImport(fx.env, 1, {
      clubId: 1,
      rows: [{ uid: 109, releaseFee: 20, wage: 2, contractType: 'formal', effectiveFrom: '2026-01-01' }],
    })) as { written: number };
    expect(out.written).toBe(1);
    const row = sqlGet<{ club_id: number; growth_tier: number }>(fx.sqlite, 'SELECT club_id, growth_tier FROM players WHERE id = 9');
    expect(row).toMatchObject({ club_id: 1, growth_tier: 3 });
  });
});

describe('§10.3 挂钩清单（源码扫描，v6.48.0）', () => {
  // 写 players.club_id 的地方必须挂重算，否则 c1/c2 会停在旧归属上——而这种错档位在页面上看不出来。
  // 新开一条写归属的路径时，这个测试会红：把文件加进 HOOKED 并在该处调用 hookTierRecompute。
  const HOOKED = ['transfers.ts', 'contracts-import.ts', 'players-import.ts'];

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
    }
    return out;
  }

  it('每条改球员归属的语句都在挂钩清单里（且真的调了 hookTierRecompute）', () => {
    const files = walk('src/worker');
    // 只看 SET 子句（WHERE 里的 club_id 是读，不是写）与 INSERT 的列清单
    const writers = files.filter((f) => {
      const text = readFileSync(f, 'utf8');
      const updates = [...text.matchAll(/UPDATE\s+players\s+SET\s+([\s\S]*?)\s+WHERE/gi)];
      if (updates.some((m) => /club_id\s*=\s*(\?|NULL)/i.test(m[1]))) return true;
      const inserts = [...text.matchAll(/INSERT INTO players\s*\(([\s\S]*?)\)/gi)];
      return inserts.some((m) => /club_id/i.test(m[1]));
    });
    const names = writers.map((f) => f.replace(/\\/g, '/').split('/').pop()!);
    expect(names.sort()).toEqual([...HOOKED].sort());
    for (const f of writers) {
      expect(readFileSync(f, 'utf8'), f).toContain('hookTierRecompute');
    }
  });
});

describe('§10.3 触发点：转会 / 解约（v6.48.0）', () => {
  // 直接调过户单点（HTTP 入口在 bypass/negotiation 流程里，夹具成本高；挂钩就挂在 completeTransfer /
  // completeTermination 的 batch 之后，直接调这两个函数验的就是同一处代码）
  it('转会过户：归属变了 → 该球员重算（c1/c2 都跟着新队壳走）；重放不再算', async () => {
    const fx = freshEnv();
    // 球员一：TeamID 2（现实在尤文）、naID 27、当前在阿森纳(14) → 过户前 c1/c2 都不命中
    fx.sqlite.exec(`UPDATE players SET club_id = 1, game_attrs = '{"TeamID": 2, "naID": 27}', growth_tier = 1 WHERE id = 1`);
    fx.sqlite.exec(`INSERT INTO transfers (id, type, player_id, from_club_id, to_club_id, fee, status, season, window_seq) VALUES (1, 'transfer', 1, 1, 2, 10, 'pending_review', 1, 1)`);

    const out = await completeTransfer(fx.env, 1, 1, 'user');
    expect(out.status).toBe('completed');
    expect(sqlGet<{ club_id: number }>(fx.sqlite, 'SELECT club_id FROM players WHERE id = 1')).toEqual({ club_id: 2 });
    // 到尤文(27)后：TeamID 2 = club 2 ✓、naID 27 = country 27 ✓ → 档 3
    expect(tierOf(fx.sqlite, 1)?.growth_tier).toBe(3);
    const set = auditOf(fx.sqlite, 'growth_tier_set').find((a) => a.target_id === 1)!;
    expect(JSON.parse(set.after!)).toMatchObject({ tier: 3, auto: true });

    // 重放（同一单再调一次）：statusChange=0 ⇒ 不重算、不重复留痕
    const again = await completeTransfer(fx.env, 1, 1, 'user');
    expect(again.status).toBe('already');
    expect(auditOf(fx.sqlite, 'growth_tier_set').filter((a) => a.target_id === 1)).toHaveLength(1);
  });

  it('续约/匹配（amendment）不动归属 → 不重算', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`UPDATE players SET growth_tier = 1 WHERE id = 1`); // 自动值 3，故意压到 1
    fx.sqlite.exec(`INSERT INTO transfers (id, type, player_id, from_club_id, to_club_id, fee, status, season, window_seq) VALUES (2, 'rc_change', 1, 1, 1, NULL, 'pending_review', 1, 1)`);
    const out = await completeTransfer(fx.env, 2, 1, 'user');
    expect(out.status).toBe('completed');
    expect(tierOf(fx.sqlite, 1)?.growth_tier).toBe(1);
    expect(auditOf(fx.sqlite, 'growth_tier_set')).toEqual([]);
  });

  it('解约去归属：club_id 归 NULL ⇒ c1/c2 记假，档位落到 1 + c3/c4/c5', async () => {
    const fx = freshEnv();
    // 球员一：在阿森纳、TeamID 1、naID 14（自动 3），另给中国计划 +1
    fx.sqlite.exec(`UPDATE players SET growth_tier = 3, china_plan = 1 WHERE id = 1`);
    fx.sqlite.exec(`INSERT INTO transfers (id, type, player_id, from_club_id, to_club_id, extra_fee, status, season, window_seq) VALUES (3, 'termination', 1, 1, NULL, 5, 'pending_review', 1, 1)`);

    const out = await completeTermination(fx.env, 3, 1, 'user');
    expect(out.status).toBe('completed');
    expect(sqlGet<{ club_id: number | null; status: string }>(fx.sqlite, 'SELECT club_id, status FROM players WHERE id = 1')).toEqual({ club_id: null, status: 'free' });
    // 自由身：只剩中国籍 +1 → 档 2（c1/c2 不再命中，也不算数据缺失）
    expect(tierOf(fx.sqlite, 1)?.growth_tier).toBe(2);
    const set = auditOf(fx.sqlite, 'growth_tier_set').find((a) => a.target_id === 1)!;
    expect(JSON.parse(set.after!)).toMatchObject({ tier: 2, auto: true });
    expect(JSON.parse(set.after!).conditions).toEqual({ c1: false, c2: false, c3: true, c4: false, c5: false });
  });
});
