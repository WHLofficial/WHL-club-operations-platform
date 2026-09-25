// 守卫测试：赛事系统入口一律走 tour 子域，不许再出现 apex whleague.win（v5.0.1）。
//
// 背景：whleague.win 是 zone 的 apex，但它不部署任何服务、DNS 也无 A 记录
// （nslookup -type=A whleague.win 对 8.8.8.8 / 223.5.5.5 / 1.1.1.1 均无答案，curl 返回 000）。
// 指向它的引用都是 bug，后果按位置差别很大：
//   - wrangler.jsonc 的 TOUR_API_BASE 是**线上 5xx 的来源**：球队详情页拿它拼
//     `${base}/api/public/tournaments/${id}/standings`，于是每次渲染都发一个必然 530 的请求，
//     排名区块永久显示「排名暂不可用」（src/worker/routes/clubs.ts:574 附近）。
//     注意这与「变量没配」不是一回事——没配会走 clubs.ts:604 的优雅降级，
//     配了死地址才是「真发请求、每次都失败」，且只在 CF 分析里看得见。
//   - web/src/lib/api.ts 的 TOUR_SITE_URL 是**用户可见死链**（TopBar / RequireUser / Home /
//     admin/AdminLayout 五处外链都读它）。
//   - src/worker/routes/auth.ts 的 TOUR_HOME 只在兼容模式跳转里用（生产 AUTH_MODE=oidc 走不到），
//     属潜伏 bug。
// 三处散在配置、后端、前端三地，改回去不会有任何编译或运行时信号，所以在这里锁死。
//
// 判据是「生效的 apex URL」：字符串里出现 https:// + apex，且后面不接域名续字符（`whleague.win.example`
// 这类不算）。注释里可以留历史说明，但请照v5.0.1 的写法只写 `apex whleague.win`（不带 scheme），
// 否则会命中下面的全仓扫描——宁枉勿纵，命中只会让人来看一眼。
// 本文件自己也不写那个完整字符串（用 APEX_URL 拼），这样全仓扫描不需要任何排除项。
//
// 例外且必须保持 apex 的是 src/lib/oidc.ts:6 提到的 cookie Domain：那是 zone 的域属性，
// 不是「服务入口」。而且本项目两个会话 cookie 都用 __Host- 前缀，恰恰不许设 Domain——
// 所以那里只该出现在注释里，见最后一条测试。
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APEX = 'whleague.win';
const APEX_URL = `https://${APEX}`;

/** 生效的 apex URL：后面不接 [a-z0-9.-]，所以子域（auth./club./tour./guess.）与裸 apex 提及都不会命中 */
const EFFECTIVE_APEX = /https:\/\/whleague\.win(?![a-z0-9.-])/;

function hostOf(url: string): string {
  return new URL(url).host;
}

/** apex 与 www 都算「没有部署服务的那一层」 */
function isApexHost(host: string): boolean {
  return host === APEX || host === `www.${APEX}`;
}

/** 取 `"KEY": "值"` 形态的配置项（wrangler.jsonc 用；不引 JSONC 解析器，避免注释导致夹具脆化） */
function jsoncString(src: string, key: string): string {
  const m = src.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`));
  if (!m) throw new Error(`wrangler.jsonc 里没有 ${key}`);
  return m[1]!;
}

/** 取 `const NAME = '值';` / `export const NAME = '值';` 形态的常量 */
function tsString(src: string, name: string): string {
  const m = src.match(new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*['"\`]([^'"\`]*)['"\`]`));
  if (!m) throw new Error(`没有找到常量 ${name}`);
  return m[1]!;
}

const SCAN_ROOTS = ['src', 'web/src', 'tests'];
const SCAN_EXT = ['.ts', '.tsx', '.jsonc', '.json', '.html'];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return SCAN_EXT.some((ext) => e.name.endsWith(ext)) ? [p] : [];
  });
}

describe('赛事系统入口域名（v5.0.1）', () => {
  it('判据：只认生效的 apex URL，子域与注释里的裸 apex 不误伤', () => {
    expect(EFFECTIVE_APEX.test(`"TOUR_API_BASE": "${APEX_URL}"`)).toBe(true);
    expect(EFFECTIVE_APEX.test(`const TOUR_HOME = '${APEX_URL}/';`)).toBe(true);
    expect(EFFECTIVE_APEX.test(`"OIDC_ISSUER": "https://auth.${APEX}"`)).toBe(false);
    expect(EFFECTIVE_APEX.test(`const GUESS_URL = 'https://guess.${APEX}';`)).toBe(false);
    expect(EFFECTIVE_APEX.test(`// Domain=${APEX} 是 zone 的域属性`)).toBe(false);
    expect(EFFECTIVE_APEX.test(`// v5.0.1：apex ${APEX} 没有部署服务`)).toBe(false);
    expect(EFFECTIVE_APEX.test(`${APEX_URL}.example.com`)).toBe(false);

    expect(isApexHost(hostOf(`${APEX_URL}/`))).toBe(true);
    expect(isApexHost(hostOf(`https://www.${APEX}`))).toBe(true);
    expect(isApexHost(hostOf(`https://tour.${APEX}/`))).toBe(false);
    expect(isApexHost(hostOf(`https://club.${APEX}`))).toBe(false);
  });

  it('生产配置 TOUR_API_BASE 指向 tour 子域（配 apex = 排名区块每次必然 530）', () => {
    const base = jsoncString(readFileSync('wrangler.jsonc', 'utf8'), 'TOUR_API_BASE');
    expect(isApexHost(hostOf(base))).toBe(false);
    expect(hostOf(base).endsWith(`.${APEX}`)).toBe(true);
  });

  it('前端 TOUR_SITE_URL 指向 tour 子域（五处外链按钮的落点）', () => {
    const url = tsString(readFileSync('web/src/lib/api.ts', 'utf8'), 'TOUR_SITE_URL');
    expect(isApexHost(hostOf(url))).toBe(false);
    expect(hostOf(url).endsWith(`.${APEX}`)).toBe(true);
  });

  it('兼容模式跳转 TOUR_HOME 指向 tour 子域', () => {
    const url = tsString(readFileSync('src/worker/routes/auth.ts', 'utf8'), 'TOUR_HOME');
    expect(isApexHost(hostOf(url))).toBe(false);
    expect(hostOf(url).endsWith(`.${APEX}`)).toBe(true);
  });

  it('仓内没有生效的 apex 引用（配置 / 后端 / 前端 / 测试）', () => {
    const files = ['wrangler.jsonc', 'web/index.html', ...SCAN_ROOTS.flatMap(walk)];
    const offenders = files.flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => EFFECTIVE_APEX.test(line))
        .map(([n, line]) => `${f}:${n} ${line.trim()}`),
    );
    expect(offenders, 'apex 不部署服务，这些引用是死链或必然 5xx').toEqual([]);
  });

  it('会话 cookie 保持 __Host- 前缀，oidc.ts 里不出现真正的 Domain= 赋值', () => {
    const src = readFileSync('src/lib/oidc.ts', 'utf8');
    expect(src).not.toMatch(/Domain\s*=\s*['"]/);
    const names = [...src.matchAll(/export const (OIDC_\w*COOKIE)\s*=\s*'([^']+)'/g)].map((m) => m[2]!);
    expect(names.length).toBeGreaterThanOrEqual(2);
    for (const n of names) expect(n.startsWith('__Host-')).toBe(true);
  });
});
