// 球员/合同导入管线（TECH_DESIGN §5.4 + 增量 22 换版模式与加固）
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, sqlGet } from './d1.ts';
import { normalizeImportBatch } from '../src/core/import.ts';
import { cpuClubIds } from '../src/worker/growth.ts';
import { resetConfigCache } from '../src/core/config.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  kv: Map<string, string>;
}

function freshEnv(): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(`CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
    INSERT INTO user (id, name, role) VALUES (1, '管理组甲', 'admin');`);
  const kv = new Map<string, string>();
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
  kv.set('sess:tok-admin', JSON.stringify({ userId: 1 }));
  return { env, sqlite, kv };
}

function post(path: string, body: unknown, env: Env) {
  return app.request(
    path,
    { method: 'POST', headers: { 'content-type': 'application/json', Cookie: 'whl_session=tok-admin' }, body: JSON.stringify(body) },
    env,
  );
}

// 通道 A 一行最小合法数据
function rowA(id: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { ID: id, Name: `球员${id}`, Age: 24, CA: 70, PA: 90, naID: 155, PosID1: -1, FootID: 1, TeamID: '', ...over };
}

// 预置一名「成长中」球员：源 CA 75 → 现 CA 80（δ=5），经验 12、已用 2 级、银 7 金 2 徽章
function seedGrowingPlayer(sqlite: DatabaseSync, fcId = 100): void {
  sqlite.exec(`
    INSERT INTO players (id, uid, name, ca, base_ca, growth_xp, levels_applied, badges_silver, badges_gold, fc_id, age, position)
      VALUES (${fcId}, 'fc${fcId}', '成长甲', 80, 75, 12, 2, 7, 2, ${fcId}, 24, 'ST');
  `);
}

describe('导入归一化（增量 22 I4：naID 值域 + TeamID 脏值警告）', () => {
  it('naID 非整数或超 1-1000 值域挡行；TeamID 脏值出警告不挡行', () => {
    const bad = normalizeImportBatch('A', [rowA(1, { naID: 0 }), rowA(2, { naID: 1001 }), rowA(3, { naID: 1.5 })]);
    expect(bad.errors.map((e) => [e.row, e.field])).toEqual([
      [1, 'naID'],
      [2, 'naID'],
      [3, 'naID'],
    ]);
    expect(bad.players).toHaveLength(0);

    const warned = normalizeImportBatch('A', [rowA(4, { TeamID: 'abc' })]);
    expect(warned.errors).toHaveLength(0);
    expect(warned.warnings).toEqual([{ row: 1, field: 'TeamID', message: 'TeamID「abc」无法解析，按无队籍处理' }]);
    expect(warned.players[0]?.clubId).toBeNull();
  });

  it('通道 B nationality 超值域挡行；teamid 脏值出警告', () => {
    const base = { playerid: 9, commonname: '乙', overallrating: 70, potential: 85, Position: '', preferredfoot: 'Right', birthdate: '01/02/2004' };
    const bad = normalizeImportBatch('B', [{ ...base, nationality: 1001 }]);
    expect(bad.errors.map((e) => e.field)).toEqual(['nationality']);
    const warned = normalizeImportBatch('B', [{ ...base, teamid: 'xx' }]);
    expect(warned.errors).toHaveLength(0);
    expect(warned.warnings.map((w) => w.field)).toEqual(['teamid']);
  });
});

describe('球员导入换版模式（增量 22 I1，规则 §5.4）', () => {
  it('小换版：CA 增量平移、成长字段全保留；新插入球员两模式等价', async () => {
    const fx = freshEnv();
    seedGrowingPlayer(fx.sqlite);
    // 新球员 101：CA 66；老球员 102：δ=0（ca=base_ca=80），源值降到 78 也不加值
    fx.sqlite.exec(`INSERT INTO players (id, uid, name, ca, base_ca, growth_xp, fc_id) VALUES (102, 'fc102', '平甲', 80, 80, 5, 102);`);

    const preview = await post(
      '/api/admin/players/import/preview',
      { channel: 'A', mode: 'minor', rows: [rowA(100), rowA(101, { CA: 66, Name: '新乙' }), rowA(102, { CA: 78 })] },
      fx.env,
    );
    expect(preview.status).toBe(200);
    const pv = (await preview.json()) as { stats: Record<string, number> };
    expect(pv.stats).toMatchObject({ total: 3, valid: 3, error: 0, warning: 0, insertEstimate: 1, updateEstimate: 2, growthPlayers: 1, xpToWipe: 0 });

    const confirm = await post(
      '/api/admin/players/import/confirm',
      { channel: 'A', mode: 'minor', rows: [rowA(100), rowA(101, { CA: 66, Name: '新乙' }), rowA(102, { CA: 78 })] },
      fx.env,
    );
    expect(confirm.status).toBe(200);
    // 成长甲：源 70 + δ5 = 75；经验/级别/徽章原样
    expect(sqlGet(fx.sqlite, 'SELECT ca, base_ca, growth_xp, levels_applied, badges_silver, badges_gold FROM players WHERE fc_id = 100')).toEqual({
      ca: 75,
      base_ca: 70,
      growth_xp: 12,
      levels_applied: 2,
      badges_silver: 7,
      badges_gold: 2,
    });
    // 新球员按源值落库（两模式同路径）；δ=0 行不加值
    expect(sqlGet(fx.sqlite, 'SELECT ca, base_ca, growth_xp FROM players WHERE fc_id = 101')).toEqual({ ca: 66, base_ca: 66, growth_xp: 0 });
    expect(sqlGet(fx.sqlite, 'SELECT ca, base_ca, growth_xp FROM players WHERE fc_id = 102')).toEqual({ ca: 78, base_ca: 78, growth_xp: 5 });
  });

  it('大换版：ceil(δ/3)、XP 清零、levels 归零、徽章银金各自折算；预览给出将清零经验总量', async () => {
    const fx = freshEnv();
    seedGrowingPlayer(fx.sqlite);

    const preview = await post(
      '/api/admin/players/import/preview',
      { channel: 'A', mode: 'major', rows: [rowA(100)] },
      fx.env,
    );
    expect(preview.status).toBe(200);
    expect(((await preview.json()) as { stats: Record<string, number> }).stats).toMatchObject({ growthPlayers: 1, xpToWipe: 12 });

    const confirm = await post('/api/admin/players/import/confirm', { channel: 'A', mode: 'major', rows: [rowA(100)] }, fx.env);
    expect(confirm.status).toBe(200);
    // CA = 源 70 + ceil(5/3)=2 → 72；银 7→ceil(7/3)=3，金 2→ceil(2/3)=1
    expect(sqlGet(fx.sqlite, 'SELECT ca, base_ca, growth_xp, levels_applied, badges_silver, badges_gold FROM players WHERE fc_id = 100')).toEqual({
      ca: 72,
      base_ca: 70,
      growth_xp: 0,
      levels_applied: 0,
      badges_silver: 3,
      badges_gold: 1,
    });
    // 审计批次带 mode
    expect(sqlGet(fx.sqlite, "SELECT after FROM audit_log WHERE action = 'players_import' ORDER BY id DESC LIMIT 1")).toMatchObject({
      after: expect.stringContaining('"mode":"major"'),
    });
  });

  it('mode 非法值 400', async () => {
    const fx = freshEnv();
    const res = await post('/api/admin/players/import/preview', { channel: 'A', mode: 'reset', rows: [rowA(1)] }, fx.env);
    expect(res.status).toBe(400);
  });
});

describe('合同导入目标俱乐部校验（增量 22 I3）', () => {
  it('clubId 不存在：预览与确认都 404，不再静默放行到落库炸 FK', async () => {
    const fx = freshEnv();
    const rows = [{ uid: 'fc100', releaseFee: 10, wage: 2, effectiveFrom: '2026-09-01', contractType: 'formal' }];
    const preview = await post('/api/admin/players/import/preview', { channel: 'C', clubId: 999, rows }, fx.env);
    expect(preview.status).toBe(404);
    const confirm = await post('/api/admin/players/import/confirm', { channel: 'C', clubId: 999, rows }, fx.env);
    expect(confirm.status).toBe(404);
  });
});

describe('CPU 判定列化（增量 22，0026）', () => {
  it('cpuClubIds 只认 is_cpu=1，不再扫队名后缀', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`
      INSERT INTO clubs (id, name, is_cpu) VALUES (10, '曼城 CPU', 1), (2, '冒烟 FC (CPU)', 0);
    `);
    const ids = await cpuClubIds(fx.env.DB);
    expect(ids.has(10)).toBe(true);
    expect(ids.has(2)).toBe(false);
  });
});
