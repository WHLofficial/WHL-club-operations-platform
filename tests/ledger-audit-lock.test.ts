// 财政域留痕同源锁（v6.3.1）：把「谁动了钱、有没有留下操作人」钉成可自动检查的约束。
// 起因：生产普查发现球场扩建/升级与设施升级三条路径花钱却零 audit_log 留痕，
// 只能靠邻行 club_bind 反推操作人。此后新增一条财政写入路径若忘了配审计，本文件直接红。
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url).href);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

const sources = walk(SRC_DIR).map((path) => ({
  rel: relative(SRC_DIR, path).replace(/\\/g, '/'),
  source: readFileSync(path, 'utf8'),
}));

const LEDGER_CALL = 'ledgerMovement(';
// 审计能力标记：同批插入用 createAuditStatement，批外补记用 writeAudit
const AUDIT_MARKERS = ['createAuditStatement(', 'writeAudit('];

/** 允许「写账本但不自带审计」的文件，每个都要写清为什么 —— 白名单是清单，不是豁免区 */
const NO_OWN_AUDIT: Record<string, string> = {
  'worker/ledger.ts': '账本原语自身：只负责流水+余额两条语句，留痕一律由调用点负责',
  'worker/home.ts': '自动路径（比赛日收入/球场维护）：ref 锚回 match 或 window，可重建；无人类操作语义',
  'worker/prizes.ts': '自动路径（逐场奖金）：赛果确认触发，ref 锚回 match，可重建',
  'worker/window-payroll.ts': '工资/富人税：并入关窗批，逐类汇总写进 window_close 审计的 after',
};

describe('财政域留痕同源锁', () => {
  const writers = sources.filter((s) => s.source.includes(LEDGER_CALL));

  it('账本写入者都在这份清单的视野内（白名单不许腐烂）', () => {
    const names = writers.map((w) => w.rel).sort();
    for (const rel of Object.keys(NO_OWN_AUDIT)) {
      expect(names, `${rel} 已不在写账本，请从白名单删掉，别留着当万能豁免`).toContain(rel);
    }
    // 至少这几条已知的人类触发路径必须在场（防止扫描逻辑被改坏后测试静默通过）
    expect(names).toContain('worker/stadium-ops.ts');
    expect(names).toContain('worker/naming-ops.ts');
    expect(names).toContain('worker/bypass.ts');
  });

  it('除白名单外，写账本的文件必须同时具备审计能力', () => {
    const offenders = writers
      .filter((w) => !(w.rel in NO_OWN_AUDIT))
      .filter((w) => !AUDIT_MARKERS.some((m) => w.source.includes(m)))
      .map((w) => w.rel);
    expect(offenders, `这些文件写了账本却没有审计：${offenders.join('、')}`).toEqual([]);
  });

  it('audit_log 的写入只走 lib/audit.ts；bypass.ts 是唯一手写例外（需自带 WHERE 守卫）', () => {
    const inserters = sources.filter((s) => /INSERT\s+INTO\s+audit_log/i.test(s.source)).map((s) => s.rel).sort();
    expect(inserters).toEqual(['lib/audit.ts', 'worker/bypass.ts']);
  });

  it('教练自助的财政端点必须把操作人传下去', () => {
    const clubs = sources.find((s) => s.rel === 'worker/routes/clubs.ts');
    expect(clubs).toBeDefined();
    for (const call of [
      'expandStadium(c.env, club.id',
      'upgradeStadiumTier(c.env, club.id',
      'upgradeFacilityLevel(c.env, club.id',
      'terminateNaming(c.env, club.id',
    ]) {
      const at = clubs!.source.indexOf(call);
      expect(at, `clubs.ts 里找不到调用 ${call}`).toBeGreaterThan(-1);
      const stmt = clubs!.source.slice(at, clubs!.source.indexOf(');', at));
      expect(stmt, `${call}...) 没把 user.id 当作操作人传下去`).toContain('user.id');
    }
  });

  it('window_close 审计必须带同批扣款的逐类汇总', () => {
    const wm = sources.find((s) => s.rel === 'worker/window-machine.ts');
    expect(wm).toBeDefined();
    expect(wm!.source).toMatch(/action:\s*'window_close'[\s\S]{0,600}payroll:\s*payroll\.summary/);
    expect(wm!.source).toMatch(/action:\s*'window_close'[\s\S]{0,600}home:\s*home\.summary/);
  });
});

// v6.3.2：actor 只记人类行为人（机器一律 null，0 哨兵退役），另加 origin 记「哪条入口触发的」。
// 这两条契约靠类型系统管不全 —— 手写 SQL 与字符串常量都要在这里钉住。
describe('审计来源通道 origin（v6.3.2）', () => {
  it('源码里不再有 actor: 0 哨兵（机器行为一律 actor=null）', () => {
    // 前后都收紧：`factor: 0.85` 之类的配置项不算（前置字符必须是分隔符），`actor: 0.5` 也不算
    const SENTINEL = /(?<![\w.])actor:\s*0(?![.\d])/;
    const offenders = sources.filter((s) => SENTINEL.test(s.source)).map((s) => s.rel);
    expect(offenders, `这些文件还在写 actor: 0：${offenders.join('、')}`).toEqual([]);
  });

  it('两处手写 INSERT INTO audit_log 的列清单都含 origin（tsc 管不到手写 SQL）', () => {
    for (const rel of ['lib/audit.ts', 'worker/bypass.ts']) {
      const s = sources.find((x) => x.rel === rel);
      expect(s, `找不到 ${rel}`).toBeDefined();
      const at = s!.source.search(/INSERT\s+INTO\s+audit_log/i);
      expect(at, `${rel} 里找不到 INSERT INTO audit_log`).toBeGreaterThan(-1);
      const cols = s!.source.slice(at, s!.source.indexOf(')', at));
      expect(cols, `${rel} 的列清单缺 origin：${cols}`).toContain('origin');
    }
  });

  it('AuditOrigin 只认约定的五个取值', () => {
    const audit = sources.find((s) => s.rel === 'lib/audit.ts')!.source;
    const decl = audit.match(/export type AuditOrigin =[\s\S]*?;/)?.[0] ?? '';
    expect(decl, 'lib/audit.ts 里找不到 AuditOrigin 声明').not.toBe('');
    for (const v of ['user', 'cron_tick', 'lazy_settle', 'backchannel', 'machine']) {
      expect(decl, `AuditOrigin 里缺 '${v}'`).toContain(`'${v}'`);
    }
  });

  it('四个机器来源常量确实被用上（不是只写在类型里）', () => {
    const outside = sources
      .filter((s) => s.rel !== 'lib/audit.ts')
      .map((s) => s.source)
      .join('\n');
    for (const v of ['cron_tick', 'lazy_settle', 'backchannel', 'machine']) {
      expect(outside, `没有任何写入点用 origin '${v}'`).toContain(`'${v}'`);
    }
  });
});
