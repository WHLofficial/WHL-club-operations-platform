import { describe, expect, it, beforeEach } from 'vitest';
import { createConfigService, resetConfigCache, CONFIG_MASK, CONFIG_KEYS } from '../src/core/config.ts';
import { createTestDb } from './d1.ts';

// 模块级缓存跨用例共享（与 isolate 行为一致），每个用例前清场
beforeEach(() => {
  resetConfigCache();
});

function setup() {
  const { db } = createTestDb();
  let t = 1_000_000;
  const service = createConfigService(db, { now: () => t });
  return {
    service,
    db,
    advanceMs(ms: number) {
      t += ms;
    },
  };
}

describe('config 服务（§13）', () => {
  it('缺键落默认', async () => {
    const { service } = setup();
    await expect(service.get('tax_rates')).resolves.toBe('0.10,0.20,0.40');
    await expect(service.getNumber('auction_tax_rate')).resolves.toBe(0.5);
  });

  it('json/待定键缺省为 null（ca_pa_limits 除外，规则 4.2.2 有原文默认）', async () => {
    const { service } = setup();
    await expect(service.get('wage_cap')).resolves.toBeNull();
    // v1.4.0：prize_table 有 §9.1 原文默认（JSON 可覆盖），不再是缺省 null
    await expect(service.getJson<object>('prize_table')).resolves.toHaveProperty('league_premier');
    await expect(service.getJson<object>('ca_pa_limits')).resolves.toEqual({
      premier: { ge90: 1, ge87: 4, growthPa87: 6 },
      second: { ge90: 1, ge87: 3, growthPa87: 6 },
    });
  });

  it('库里有的值优先于默认', async () => {
    const { service, db } = setup();
    await db
      .prepare("INSERT INTO config (key, value, updated_at) VALUES ('squad_max', '28', '2026-01-01T00:00:00Z')")
      .run();
    await expect(service.getNumber('squad_max')).resolves.toBe(28);
  });

  it('数值解析失败回退默认', async () => {
    const { service, db } = setup();
    await db
      .prepare("INSERT INTO config (key, value, updated_at) VALUES ('silence_hours', '三小时', '2026-01-01T00:00:00Z')")
      .run();
    await expect(service.getNumber('silence_hours')).resolves.toBe(3);
  });

  it('getNumberList 解析逗号分隔，坏值回退默认', async () => {
    const { service, db } = setup();
    await expect(service.getNumberList('deadline_hours')).resolves.toEqual([18, 23]);
    await db
      .prepare(
        "INSERT INTO config (key, value, updated_at) VALUES ('deadline_hours', '18, oops', '2026-01-01T00:00:00Z')",
      )
      .run();
    await expect(service.getNumberList('deadline_hours')).resolves.toEqual([18, 23]);
  });

  it('getJson 解析失败回退默认', async () => {
    const { service, db } = setup();
    await db
      .prepare("INSERT INTO config (key, value, updated_at) VALUES ('agent_tiers', 'not-json', '2026-01-01T00:00:00Z')")
      .run();
    await expect(service.getJson<unknown>('agent_tiers')).resolves.toEqual([
      [0.15, 0.3],
      [0.25, 0.5],
      [0.35, 0.7],
    ]);
  });

  it('isolate 缓存 TTL 60s：期内命中缓存，过期回库', async () => {
    const { service, db, advanceMs } = setup();
    await expect(service.get('tax_rates')).resolves.toBe('0.10,0.20,0.40');
    await db
      .prepare("INSERT INTO config (key, value, updated_at) VALUES ('tax_rates', '0.30,0.30,0.40', '2026-01-01T00:00:00Z')")
      .run();
    advanceMs(59_999);
    await expect(service.get('tax_rates')).resolves.toBe('0.10,0.20,0.40');
    advanceMs(2);
    await expect(service.get('tax_rates')).resolves.toBe('0.30,0.30,0.40');
  });

  it('set 后立刻读到新值（缓存失效）', async () => {
    const { service } = setup();
    await expect(service.getNumber('silence_hours')).resolves.toBe(3);
    await service.set('silence_hours', '4');
    await expect(service.getNumber('silence_hours')).resolves.toBe(4);
  });

  it('set 传 null 删覆盖、回到默认', async () => {
    const { service } = setup();
    await service.set('silence_hours', '9');
    await expect(service.getNumber('silence_hours')).resolves.toBe(9);
    await service.set('silence_hours', null);
    await expect(service.getNumber('silence_hours')).resolves.toBe(3);
  });

  it('未注册的键拒绝写入', async () => {
    const { service } = setup();
    await expect(service.set('not_a_key' as never, '1')).rejects.toThrow(RangeError);
  });

  it('涉密键管理端视图只出掩码（§6.10）', async () => {
    const { service } = setup();
    const rows = await service.listMasked();
    expect(rows.find((r) => r.key === 'sigmoid_slope')).toMatchObject({ secret: true, value: CONFIG_MASK });
    expect(rows.find((r) => r.key === 'tax_rates')).toMatchObject({ secret: false, value: '0.10,0.20,0.40' });
    // 即便库里写入了真实值，列表里也不得出现
    await service.set('wage_param_a', '0.03');
    const rows2 = await service.listMasked();
    expect(rows2.find((r) => r.key === 'wage_param_a')?.value).toBe(CONFIG_MASK);
  });

  it('注册表 61 键（§13 + v2.1.0/v2.5.0/v2.6.0/v2.7.0 各域参数）', () => {
    expect(CONFIG_KEYS.length).toBe(61);
  });
});
