#!/usr/bin/env node
// 本地端到端冒烟（增量 23）：playwright-core + 系统 Chrome，对 dev 8791 做黑盒验证。
//
// 前提：
//   - `npm run build`（前端改动不 build 看不到）+ `npm run dev`（8791）
//   - 本地 dev 当前跑的是**兼容模式**（旧进程，vars 早于 AUTH_MODE）：
//     会话 = cookie whl_session → 共享 KV sess:{token} → TOUR_DB user 表。
//     所以本脚本只往**本地** KV 种一行 sess:<token>（--local，绝不碰远端；该命名空间
//     与赛事/竞猜共用，远端写是生产写），跑完删掉。TOUR_DB 本地已有 user id=1（admin）。
//     若哪天 dev 换成 OIDC 模式，这里要改成种 oidc_session 行 + __Host-club_session cookie。
//
// 用法：node scripts/e2e/smoke.mjs [baseUrl]
//   E2E_BASE    默认 http://127.0.0.1:8791
//   E2E_CHROME  默认 C:/Program Files/Google/Chrome/Application/chrome.exe
import { chromium } from 'playwright-core';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? process.env.E2E_BASE ?? 'http://127.0.0.1:8791';
const CHROME = process.env.E2E_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SESSION_COOKIE = 'whl_session'; // 兼容模式 cookie（OIDC 模式是 __Host-club_session）
const USER_ID = 1; // 本地 tour 库的基线管理员（role=admin）
const SHOT_DIR = 'scratch';
const TIMEOUT = 15_000;

if (!existsSync(CHROME)) {
  console.error(`找不到 Chrome：${CHROME}\n用 E2E_CHROME=<chrome.exe> 指定路径。`);
  process.exit(2);
}

// ---- 本地会话种子（只动本地 KV） ----
const token = randomBytes(32).toString('hex');
const KV_KEY = `sess:${token}`;

function wrangler(args) {
  const r = spawnSync('npx', ['wrangler', ...args], {
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
  // 兼容模式 cookie 无 __Host- 前缀、非 Secure，http 下按 url 注入即可
  await context.addCookies([{ name: SESSION_COOKIE, value: token, url: BASE }]);
  const page = await context.newPage();
  globalThis.__page = page;
  page.setDefaultTimeout(TIMEOUT);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e?.message ?? e)));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`);
  });

  const text = () => page.locator('body').innerText();

  try {
    await check('① 首页渲染（顶栏 + 经理办公室）', async () => {
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
      assert((await text()).includes('WHL 经理办公室'), '顶栏品牌文案缺失');
      assert(await page.locator('h1', { hasText: '经理办公室' }).first().isVisible(), '首页 h1 不可见');
    });

    await check('② 会话生效：/api/me 返回管理员', async () => {
      const res = await page.request.get(`${BASE}/api/me`);
      assert(res.status() === 200, `状态码 ${res.status()}`);
      const body = await res.json();
      assert(body.user?.id === USER_ID, `会话没生效：${JSON.stringify(body.user)}`);
      assert(body.user.role === 'admin', `角色投影不是 admin：${body.user.role}`);
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

    await check('④ 球员库页：总数文案 + 排序切换', async () => {
      await page.goto(`${BASE}/players`, { waitUntil: 'networkidle' });
      await page.locator('text=共 ').first().waitFor({ timeout: TIMEOUT });
      assert(/共 \d+ 名球员 · 共 \d+ 页 · 第 \d+ 页/.test(await text()), '翻页信息文案不符合预期');
      // 排序下拉切到 CA，再点「高到低」（未选排序键时该按钮 disabled）
      await page.locator('label.field', { hasText: '排序' }).locator('select').selectOption('ca');
      const desc = page.locator('button', { hasText: '高到低' }).first();
      assert(await desc.isEnabled(), '选定排序键后「高到低」仍不可用');
      await desc.click();
      await page.waitForFunction(() => location.search.includes('sort=ca'), null, { timeout: TIMEOUT });
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

    await check('⑧ 无未捕获前端错误', async () => {
      assert(pageErrors.length === 0, `捕获到 ${pageErrors.length} 条：\n  ${pageErrors.slice(0, 5).join('\n  ')}`);
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
