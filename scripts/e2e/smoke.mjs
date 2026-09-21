#!/usr/bin/env node
// 本地端到端冒烟（增量 23 建，增量 26 起兼顾 OIDC 模式 + 球员库三视口）：playwright-core +
// 系统 Chrome，对 dev 8791 做黑盒验证。
//
// 前提：
//   - `npm run build`（前端改动不 build 看不到）+ `npm run dev`（8791）
//   - 登录按本地 dev 的 AUTH_MODE 走，两条通道都种（只写本地，绝不 --remote）：
//       · 兼容模式 = cookie whl_session → 共享 KV sess:{token} → TOUR_DB user 表
//       · OIDC 模式 = cookie __Host-club_session → whl-club 的 oidc_session 行（token 的 sha256）
//     两条都种、两个 cookie 都带上，脚本就不必关心 dev 起在哪套；本地没有 oidc_session 表时
//     那一半跳过（老库）。
//   - dev 若非默认持久化目录（`npm run dev` 用 .wrangler/state），要带上 E2E_PERSIST_TO
//     指到同一个目录，否则种下的会话跑在另一边、②⑥⑦ 会失败。
//
// 用法：node scripts/e2e/smoke.mjs [baseUrl]
//   E2E_BASE        默认 http://127.0.0.1:8791
//   E2E_CHROME      默认 C:/Program Files/Google/Chrome/Application/chrome.exe
//   E2E_PERSIST_TO  传给 wrangler 的 --persist-to（例如 .wrangler/rehearsal）
import { chromium } from 'playwright-core';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? process.env.E2E_BASE ?? 'http://127.0.0.1:8791';
const CHROME = process.env.E2E_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PERSIST_TO = process.env.E2E_PERSIST_TO ?? '';
const SESSION_COOKIE = 'whl_session'; // 兼容模式 cookie（OIDC 模式是 __Host-club_session）
const OIDC_COOKIE = '__Host-club_session';
const USER_ID = 1; // 本地 tour 库的基线管理员（role=admin），也是 OIDC 会话的 sub
// 本地 TOUR_DB（whl）是空库（只有 _cf_METADATA），读赛事库的这几个端点必然 500：
// 环境噪声，不是本仓库的回归，⑨ 不据此判失败；换成有数据的环境自然会通过
const EMPTY_TOUR_DB_PATHS = ['/api/me/club', '/api/me/bids', '/api/admin/clubs'];
const SHOT_DIR = 'scratch';
const TIMEOUT = 15_000;

if (!existsSync(CHROME)) {
  console.error(`找不到 Chrome：${CHROME}\n用 E2E_CHROME=<chrome.exe> 指定路径。`);
  process.exit(2);
}

// ---- 本地会话种子（只动本地 KV / 本地 D1） ----
const token = randomBytes(32).toString('hex');
const KV_KEY = `sess:${token}`;
const persistArgs = PERSIST_TO ? ['--persist-to', PERSIST_TO] : [];

function wrangler(args) {
  const r = spawnSync('npx', ['wrangler', ...args, ...persistArgs], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status !== 0) throw new Error(`wrangler ${args[0]} ${args[1]} 失败：${out}`);
  return out;
}
function seedSession() {
  mkdirSync(SHOT_DIR, { recursive: true });
  // --path 读值：shell 拼接不转义 args，内联 JSON 会被拆成多参数
  const valueFile = join(SHOT_DIR, 'e2e-kv-value.json');
  writeFileSync(valueFile, JSON.stringify({ userId: USER_ID }), 'utf8');
  wrangler(['kv', 'key', 'put', '--binding', 'SESSION_KV', '--local', '--path', valueFile, KV_KEY]);

  // OIDC 通道：oidc_session 行的 token_hash = sha256(cookie 值)；claims 决定角色投影
  const now = new Date();
  const claims = JSON.stringify({
    name: 'E2E 冒烟',
    locked: false,
    must_change_pw: false,
    roles: ['club.admin'],
    permissions: [
      'club.clubs.manage',
      'club.bindings.unbind',
      'club.players.import',
      'club.ledger.manage',
      'club.registrations.manage',
      'club.compliance.view',
    ],
  }).replace(/'/g, "''");
  const sql =
    `INSERT OR REPLACE INTO oidc_session (token_hash, sub, auth_sid, created_at, expires_at, revoked_at, claims) VALUES ` +
    `('${createHash('sha256').update(token).digest('hex')}', '${USER_ID}', 'e2e-smoke', '${now.toISOString()}', ` +
    `'${new Date(now.getTime() + 3600_000).toISOString()}', NULL, '${claims}');`;
  const sqlFile = join(SHOT_DIR, 'e2e-oidc-session.sql');
  writeFileSync(sqlFile, sql, 'utf8');
  try {
    wrangler(['d1', 'execute', 'whl-club', '--local', '--file', sqlFile, '--json']);
  } catch (e) {
    console.warn(`（跳过 OIDC 会话种子：${String(e?.message ?? e).slice(0, 120)}）`);
  }
}
function clearSession() {
  wrangler(['kv', 'key', 'delete', '--binding', 'SESSION_KV', '--local', KV_KEY]);
}

// ---- 结果收集 ----
const results = [];
async function check(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`✓ ${name}（${Date.now() - started}ms）`);
  } catch (e) {
    const msg = String(e?.message ?? e);
    results.push({ name, ok: false, ms: Date.now() - started, error: msg });
    console.log(`✗ ${name} — ${msg}`);
    if (globalThis.__page) {
      mkdirSync(SHOT_DIR, { recursive: true });
      const shot = join(SHOT_DIR, `e2e-fail-${name.replace(/[^\w\u4e00-\u9fa5]+/g, '_')}.png`);
      await globalThis.__page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      console.log(`  截图：${shot}`);
    }
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  seedSession();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // 兼容模式 cookie 无 __Host- 前缀、非 Secure，http 下按 url 注入即可；
  // OIDC 模式的 __Host- cookie 必须 Secure + path=/ + 不带 domain，本地 127.0.0.1 是可信来源
  await context.addCookies([
    { name: SESSION_COOKIE, value: token, url: BASE },
    {
      name: OIDC_COOKIE,
      value: token,
      domain: new URL(BASE).hostname,
      path: '/',
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  const page = await context.newPage();
  globalThis.__page = page;
  page.setDefaultTimeout(TIMEOUT);
  const pageErrors = [];
  const badResponses = []; // 4xx/5xx 的 URL，⑨ 失败时一并打出来便于定位
  page.on('pageerror', (e) => pageErrors.push(String(e?.message ?? e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // 「Failed to load resource」这类网络错误文本里没有 URL，判定交给下面按 URL 收的 badResponses
    if (/Failed to load resource: the server responded with a status of \d{3}/.test(t)) return;
    pageErrors.push(`console: ${t}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) badResponses.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });

  const text = () => page.locator('body').innerText();

  try {
    await check('① 首页渲染（顶栏 + 经理办公室）', async () => {
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
      assert((await text()).includes('WHL 经理办公室'), '顶栏品牌文案缺失');
      assert(await page.locator('h1', { hasText: '经理办公室' }).first().isVisible(), '首页 h1 不可见');
    });

    await check('② 会话生效：/api/me 返回管理员', async () => {
      // 用页内 fetch 而不是 page.request：Playwright 的 APIRequestContext 不把 127.0.0.1 当可信源，
      // 不会带上 __Host- 前缀的 Secure cookie（浏览器会带，因为 127.0.0.1 是可信来源），那样这条会假红
      if (!page.url().startsWith(BASE)) await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      const res = await page.evaluate(async () => {
        const r = await fetch('/api/me', { credentials: 'same-origin' });
        return { status: r.status, body: await r.json() };
      });
      assert(res.status === 200, `状态码 ${res.status}`);
      assert(res.body.user?.id === USER_ID, `会话没生效：${JSON.stringify(res.body.user)}`);
      assert(res.body.user.role === 'admin', `角色投影不是 admin：${res.body.user.role}`);
    });

    await check('③ 公开接口：俱乐部目录 / 球员库', async () => {
      const dir = await page.request.get(`${BASE}/api/clubs/directory`);
      assert(dir.status() === 200, `目录状态码 ${dir.status()}`);
      assert(Array.isArray((await dir.json()).clubs), '目录没有 clubs 数组');
      const players = await page.request.get(`${BASE}/api/players?limit=5`);
      assert(players.status() === 200, `球员库状态码 ${players.status()}`);
      const pj = await players.json();
      assert(Array.isArray(pj.players) && typeof pj.total === 'number', '球员库响应缺 players/total');
    });

    await check('④ 球员库页：左栏 + 摘要条 + 表头点排序', async () => {
      await page.goto(`${BASE}/players`, { waitUntil: 'domcontentloaded' });
      await page.locator('.library-shell').first().waitFor({ timeout: TIMEOUT });
      // 等名册落地：加载中只有「正在翻名册…」，此时既没有表头也没有空态
      await page.locator('.library-main tbody tr, .library-main .empty-state').first().waitFor({ timeout: TIMEOUT });
      assert(await page.locator('.library-side').isVisible(), '宽屏下左栏不可见');
      assert(await page.locator('.lib-summary').isVisible(), '摘要条不可见');
      // 排序入口自增量 26 起是表头（工具栏的排序下拉与方向段控件已删除）
      const headers = page.locator('.library-main thead button.th-sort');
      if ((await headers.count()) === 0) {
        // 本地库为空 ⇒ 没有球员就没有表头，排序这条留给有夹具的环境
        assert(
          (await page.locator('.library-main .empty-state').count()) > 0,
          '既没有表头也没有空态，球员库渲染异常',
        );
        return;
      }
      assert(/共 \d+ 名球员 · 共 \d+ 页 · 第 \d+ 页/.test(await text()), '翻页信息文案不符合预期');
      await headers.filter({ hasText: /^CA/ }).first().click();
      await page.waitForFunction(() => location.search.includes('sort=ca'), null, { timeout: TIMEOUT });
      assert(
        (await page.locator('.library-main thead [aria-sort="descending"]').count()) > 0,
        '点 CA 表头后没有列标为降序',
      );
      assert(!(await text()).includes('出错了'), '球员库出现错误态文案');
    });

    await check('⑤ 市场页渲染', async () => {
      await page.goto(`${BASE}/market`, { waitUntil: 'networkidle' });
      assert(await page.locator('h1', { hasText: '转会市场' }).first().isVisible(), '市场 h1 不可见');
    });

    await check('⑥ 管理端可达（带会话）', async () => {
      await page.goto(`${BASE}/admin/clubs`, { waitUntil: 'networkidle' });
      const t = await text();
      assert(t.includes('管理端'), '没进管理端（会话或权限没生效）');
      assert(!t.includes('没有权限') && !t.includes('请先登录'), '管理端被守卫拦下');
    });

    await check('⑦ 收件篮渲染（带会话）', async () => {
      await page.goto(`${BASE}/notifications`, { waitUntil: 'networkidle' });
      assert(await page.locator('h1', { hasText: '收件篮' }).first().isVisible(), '收件篮 h1 不可见');
    });

    await check('⑧ 球员库三视口：宽屏左栏 / 窄屏抽屉（截图落 scratch/）', async () => {
      const shots = [];
      const viewports = [
        [1280, 900, 'desktop'],
        [900, 800, 'tablet'],
        [375, 812, 'mobile'],
      ];
      for (const [width, height, label] of viewports) {
        await page.setViewportSize({ width, height });
        await page.goto(`${BASE}/players`, { waitUntil: 'domcontentloaded' });
        await page.locator('.library-shell').first().waitFor({ timeout: TIMEOUT });
        // 等名册落地再截：否则截到「正在翻名册…」的空表格（空库时等空态）
        await page.locator('.library-main tbody tr, .library-main .empty-state').first().waitFor({ timeout: TIMEOUT });
        const side = page.locator('.library-side');
        if (width <= 900) {
          // 关着的抽屉是 translateX(-100%)，仍有 boundingBox ⇒ 不能用 isVisible 判在场
          const closed = await side.boundingBox();
          assert(!closed || closed.x < 0, `${label}：抽屉关着时应移出视口（x=${closed?.x}）`);
          await page.locator('button.lib-side-toggle').click();
          await page.locator('.lib-drawer-mask').waitFor({ timeout: TIMEOUT });
          // 抽屉有 0.2s 位移动画，读完遮罩立刻量会读到半途的 x
          await page.waitForFunction(
            () => {
              const el = document.querySelector('.library-side');
              return !!el && el.getBoundingClientRect().x >= 0;
            },
            null,
            { timeout: TIMEOUT },
          );
          const open = await side.boundingBox();
          assert(open && open.x >= 0, `${label}：点筛选后抽屉未滑入（x=${open?.x}）`);
          assert(
            (await page.evaluate(() => document.body.style.overflow)) === 'hidden',
            `${label}：抽屉开着时背景未锁滚`,
          );
        } else {
          assert(await side.isVisible(), `${label}：宽屏左栏应常驻可见`);
          assert((await page.locator('.lib-drawer-mask').count()) === 0, `${label}：宽屏不应出现遮罩`);
        }
        const shot = join(SHOT_DIR, `e2e-players-${label}.png`);
        await page.screenshot({ path: shot, fullPage: false });
        shots.push(shot);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      console.log(`   截图：${shots.map((s) => s.replace(/\\/g, '/')).join(' / ')}`);
    });

    await check('⑨ 无未捕获前端错误', async () => {
      // 本地 TOUR_DB（whl）是空库（只有 _cf_METADATA），读赛事库的这几个端点必然 500 —— 那是
      // 环境噪声，不是本仓库的回归；换成有数据的环境自然会通过。其余任何 4xx/5xx 仍然报错。
      const noise = new Set(
        [...badResponses].filter((line) => EMPTY_TOUR_DB_PATHS.some((p) => line.endsWith(p))),
      );
      const unexpected = [...new Set(badResponses)].filter((line) => !noise.has(line));
      if (noise.size) console.log(`   已知环境噪声（本地 TOUR_DB 空库）：${[...noise].join(' / ')}`);
      assert(
        pageErrors.length === 0,
        `捕获到 ${pageErrors.length} 条：\n  ${pageErrors.slice(0, 5).join('\n  ')}`,
      );
      assert(unexpected.length === 0, `出现非预期失败请求：\n  ${unexpected.slice(0, 5).join('\n  ')}`);
    });
  } finally {
    await browser.close();
    clearSession();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} 场景通过${failed.length ? `，失败：${failed.map((f) => f.name).join('、')}` : ''}`,
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('冒烟脚本自身失败：', e);
  process.exit(3);
});
