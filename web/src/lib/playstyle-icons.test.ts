// @vitest-environment node
// v6.69.0：图标资产完整性。playstyle-icons.json 是 72 枚 WebP 的清单（36 银 + 36 金），
// 测试直接读 public 目录校验「清单有、文件在、字节数与尺寸对、magic 是 WebP」，
// 顺带挡住「清单更新了但漏拷文件」这类只在线上才 404 的错。
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import playstyleRef from '../../assets/ref/playstyle.json';
import manifest from '../../assets/ref/playstyle-icons.json';

interface Entry {
  id: number;
  file: string;
  bytes: number;
  w: number;
  h: number;
}

const ENTRIES = manifest as Entry[];
const ICON_DIR = join(process.cwd(), 'web', 'public', 'assets', 'icons', 'playstyles');
const BASES = (playstyleRef as { id: number }[]).filter((r) => r.id > 0 && r.id < 100).map((r) => r.id);

describe('playstyle-icons.json（v6.69.0）', () => {
  it('72 枚：36 基础 + 36 金徽，id 与 ref 表对齐', () => {
    expect(ENTRIES.length).toBe(72);
    expect(ENTRIES.map((e) => e.id).sort((a, b) => a - b)).toEqual(
      [...BASES, ...BASES.map((id) => id + 100)].sort((a, b) => a - b),
    );
  });

  it('每枚文件都在，字节数与清单一致，且是 64×64 的 WebP', () => {
    for (const e of ENTRIES) {
      const path = join(ICON_DIR, e.file);
      expect(e.file, `id ${e.id}`).toBe(`${e.id}.webp`);
      expect(statSync(path).size, `id ${e.id} 字节数`).toBe(e.bytes);
      const head = readFileSync(path).subarray(0, 32);
      expect(head.subarray(0, 4).toString('ascii'), `id ${e.id} RIFF`).toBe('RIFF');
      expect(head.subarray(8, 12).toString('ascii'), `id ${e.id} WEBP`).toBe('WEBP');
      expect([e.w, e.h], `id ${e.id} 尺寸`).toEqual([64, 64]);
    }
  });

  it('总量可控：全部图标合计 < 160 KB（避免把首页资产拖大）', () => {
    const total = ENTRIES.reduce((sum, e) => sum + e.bytes, 0);
    expect(total).toBeLessThan(160 * 1024);
  });
});
