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
// 噪声判据必须同时钉住状态码与路径名：只按 URL 后缀匹配的话，这三个端点上的 401/403/404
// 也会被静默吞掉（那才是真回归），带查询串时后缀还会失配
const NOISE_STATUS = 500;
function isKnownNoise(line) {
  const m = /^(\d{3}) \S+ (\S+)$/.exec(line);
  if (!m || Number(m[1]) !== NOISE_STATUS) return false;
  try {
    return EMPTY_TOUR_DB_PATHS.includes(new URL(m[2]).pathname);
  } catch {
    return false;
  }
}
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
  // 种下的 oidc_session 行也要撤：只删 KV 的话每跑一次就留一行 auth_sid='e2e-smoke' 的孤儿会话
  const sqlFile = join(SHOT_DIR, 'e2e-oidc-cleanup.sql');
  writeFileSync(sqlFile, `DELETE FROM oidc_session WHERE auth_sid = 'e2e-smoke';`, 'utf8');
  try {
    wrangler(['d1', 'execute', 'whl-club', '--local', '--file', sqlFile, '--json']);
  } catch (e) {
    console.warn(`（跳过 OIDC 会话清理：${String(e?.message ?? e).slice(0, 120)}）`);
  }
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

  // 多选下拉面板（原生 Popover）的几何 + 命中测试。这两条只有真浏览器能验：jsdom 里没有
  // Popover，面板会退化成普通 fixed 元素、照样点得到；真浏览器里如果它被判成「看得见却点不到」
  // （[popover]:not(:popover-open) 那条 UA 规则一旦不匹配就永不显示），只有 elementFromPoint 抓得住。
  const panelProbe = () =>
    page.evaluate(() => {
      const panel = document.querySelector('.multiselect-panel');
      if (!panel) return null;
      const trigger = document.querySelector('button.multiselect[aria-expanded="true"]');
      const r = panel.getBoundingClientRect();
      const hit = document.elementFromPoint(
        Math.round(r.left + Math.min(r.width, 40) / 2),
        Math.round(r.top + Math.min(r.height, 40) / 2),
      );
      return {
        left: Math.round(r.left),
        top: Math.round(r.top),
        right: Math.round(r.right),
        bottom: Math.round(r.bottom),
        height: Math.round(r.height),
        viewportH: window.innerHeight,
        inViewport: r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
        hitInside: !!hit && !!hit.closest('.multiselect-panel'),
        hitClass: hit ? String(hit.className) : 'null',
        triggerBottom: trigger ? Math.round(trigger.getBoundingClientRect().bottom) : null,
      };
    });

  const openPanel = async (label) => {
    await page.locator('.library-side button.multiselect', { hasText: label }).first().click();
    await page.waitForSelector('.multiselect-panel', { timeout: TIMEOUT });
    await page.waitForTimeout(150); // 等 place() 落位（面板位置是按触发器现算的）
  };
  const closePanel = async () => {
    if (await page.locator('.multiselect-panel').count()) await page.keyboard.press('Escape');
  };

  // 同一行控件的对齐（增量 27 步骤 1 的诉求）：.control-row 是 align-items:flex-end，
  // 所以「同一行」= 纵向范围相交、对齐判据 = 底边齐平（顶边可以不同：label 在上的 .field 比按钮高）。
  // .seg 曾经的 margin-bottom:8px 正是这样抬高了底边、被这条抓出来的。
  const controlRowAlign = (sel) =>
    page.evaluate((s) => {
      const out = [];
      for (const row of document.querySelectorAll(s)) {
        const kids = [...row.children]
          .map((el) => ({ name: el.className || el.tagName, b: el.getBoundingClientRect() }))
          .filter((k) => k.b.height > 1 && k.b.width > 1);
        for (let i = 0; i < kids.length; i++) {
          for (let j = i + 1; j < kids.length; j++) {
            const a = kids[i].b;
            const c = kids[j].b;
            // 纵向不相交 = 换过行（行间距 10px，不会相交）
            if (Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top) <= 0) continue;
            out.push({
              pair: `${kids[i].name} ↔ ${kids[j].name}`,
              bottom: Math.round(a.bottom - c.bottom),
            });
          }
        }
      }
      return out;
    }, sel);

  const assertRowAligned = async (label, sel) => {
    const pairs = await controlRowAlign(sel);
    const bad = pairs.filter((p) => Math.abs(p.bottom) > 2);
    console.log(`   ${label}：同行控件 ${pairs.length} 对，底边偏差 ${JSON.stringify(bad)}`);
    // 空集静默通过 = 什么都没验（比如换了类名、控件各自换了行）
    assert(pairs.length > 0, `${label}：没量到任何同行控件（${sel}）`);
    assert(bad.length === 0, `${label}：同行控件底边没对齐 ${JSON.stringify(bad)}`);
  };

  const assertPanel = (label, what, p) => {
    assert(p, `${label}：点「${what}」没有出现多选面板`);
    assert(
      p.inViewport,
      `${label}：${what} 面板出视口（${p.left},${p.top}–${p.right},${p.bottom}，视口高 ${p.viewportH}）`,
    );
    assert(p.hitInside, `${label}：${what} 面板点不到，命中的是 ${p.hitClass}`);
    // 面板要么整块在触发器下方，要么整块翻到上方（触发器贴视口底部时）——骑在两侧说明定位算错了
    assert(
      p.triggerBottom === null || p.top >= p.triggerBottom || p.bottom <= p.triggerBottom,
      `${label}：${what} 面板与触发器重叠（面板 ${p.top}–${p.bottom} / 触发器底 ${p.triggerBottom}）`,
    );
    // 贴底兜底高度是 160：再矮就不是能用的大小了（翻转若算错，常表现为被压成一条）
    assert(
      p.height >= 160,
      `${label}：${what} 面板被压得过矮（${p.height}px，视口高 ${p.viewportH}）`,
    );
  };

  // 翻页条：本地夹具只有几百人，文案比线上（三万多人、上千页）短得多，直接量会漏 ⇒ 临时换成
  // 线上量级的文案再量（与数据无关），量完立刻还原。
  // 判据是「页面不出横向滚动条」：翻页条自己不会横向溢出（文案是 CJK，会换行），
  // 真正要防的是有人给它加 nowrap 或塞进一个撑宽的元素。
  const pagerProbe = () =>
    page.evaluate(() => {
      const pager = document.querySelector('.library-pager');
      const span = pager?.querySelector('span');
      if (!pager || !span) return null;
      const before = span.textContent;
      // 增量 28：翻页条改游标式文案；塞线上量级的极端值，量的是页面级横向溢出
      span.textContent = '第 1742 页 · 已加载 34835 名 · 还有更多';
      const doc = document.documentElement;
      const out = {
        pagerHeight: Math.round(pager.getBoundingClientRect().height),
        docScrollW: doc.scrollWidth,
        docClientW: doc.clientWidth,
        pageOverflow: doc.scrollWidth > doc.clientWidth + 1,
      };
      span.textContent = before;
      return out;
    });

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
      // 增量 28：列表不再回 total（每条整表 COUNT = 18,763 行，占单页读量 99.7%），
      // 「还有更多」改由 nextCursor 判定 —— 所以这里断的是「没有 total、有 nextCursor」
      assert(
        Array.isArray(pj.players) && !('total' in pj) && 'nextCursor' in pj,
        '球员库响应形状不对（应为 players + nextCursor，无 total）',
      );
    });

    await check('④ 球员库页：左栏 + 翻页条 + 表头点排序', async () => {
      await page.goto(`${BASE}/players`, { waitUntil: 'domcontentloaded' });
      await page.locator('.library-shell').first().waitFor({ timeout: TIMEOUT });
      // 等名册落地：加载中只有「正在翻名册…」，此时既没有表头也没有空态
      await page.locator('.library-main tbody tr, .library-main .empty-state').first().waitFor({ timeout: TIMEOUT });
      assert(await page.locator('.library-side').isVisible(), '宽屏下左栏不可见');
      // 摘要条与翻页条同一行（增量 27 步骤 5）；没有筛选条件时摘要整块不渲染，只剩翻页
      assert(await page.locator('.lib-bar .library-pager').isVisible(), '翻页条不可见');
      assert((await page.locator('.lib-summary').count()) === 0, '未设筛选时不应有摘要条');
      // 排序入口自增量 26 起是表头（工具栏的排序下拉与方向段控件已删除）
      const headers = page.locator('.library-main thead button.th-sort');
      if ((await headers.count()) === 0) {
        // 本地库为空 ⇒ 没有球员就没有表头，排序这条留给有夹具的环境
        assert(
          (await page.locator('.library-main .empty-state').count()) > 0,
          '既没有表头也没有空态，球员库渲染异常',
        );
        console.log('   （跳过表头排序：本地球员库为空，没有表头可点）');
        return;
      }
      assert(/第 \d+ 页 · 已加载 \d+ 名 · (还有更多|已到末页)/.test(await text()), '翻页信息文案不符合预期');
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
          // 焦点断言只有真浏览器有意义：jsdom 不实现 inert 的焦点拦截，组件测试测不到这条。
          // 打开即把焦点移进抽屉，是「inert 移出 Tab 序 + 主动 focus」两件事合起来才成立的
          const focused = await page.evaluate(() => document.activeElement?.className ?? 'null');
          assert(
            focused.includes('lib-drawer-close'),
            `${label}：打开抽屉后焦点应在关闭按钮上（实际 ${focused}）`,
          );
          // 焦点循环：顶栏渲染在 <Routes> 之外、不属于任何 inert 区，只有循环能挡住 Shift+Tab
          await page.keyboard.press('Shift+Tab');
          assert(
            await page.evaluate(() => !!document.activeElement?.closest('.library-side')),
            `${label}：Shift+Tab 逃出了抽屉（焦点落到了 ${await page.evaluate(() => document.activeElement?.className)}）`,
          );
          await page.keyboard.press('Escape');
          await page.waitForFunction(
            () => {
              const el = document.querySelector('.library-side');
              return !!el && el.getBoundingClientRect().x < 0;
            },
            null,
            { timeout: TIMEOUT },
          );
          // 焦点归位要在抽屉退场之后才生效（入口按钮在工具条里，打开时它是 inert 的，
          // 同帧 focus() 会被浏览器静默忽略、activeElement 掉到 body）
          const restored = await page.evaluate(() => document.activeElement?.className ?? 'null');
          assert(
            restored.includes('lib-side-toggle'),
            `${label}：Esc 关闭后焦点未交还入口按钮（实际 ${restored}）`,
          );
          // 上面把抽屉关了，截图要的是打开态 ⇒ 再开一次（这条也顺带证明开关是可重复的）
          await page.locator('button.lib-side-toggle').click();
          await page.waitForFunction(
            () => {
              const el = document.querySelector('.library-side');
              return !!el && el.getBoundingClientRect().x >= 0;
            },
            null,
            { timeout: TIMEOUT },
          );
        } else {
          assert(await side.isVisible(), `${label}：宽屏左栏应常驻可见`);
          assert((await page.locator('.lib-drawer-mask').count()) === 0, `${label}：宽屏不应出现遮罩`);
        }
        // 多选下拉（增量 27 步骤 6）：左栏/抽屉里都要能打开、整块落在视口内、并且真的点得到
        await openPanel('位置');
        const pos = await panelProbe();
        assertPanel(label, '位置', pos);
        await closePanel();

        // 同行控件对齐（增量 27 步骤 1）：工具条一行、左栏一行，逐对量 top/bottom
        await assertRowAligned(`${label} 工具条`, '.lib-toolbar.control-row');
        await assertRowAligned(`${label} 左栏`, '.library-side .control-row');

        // 再开一次留给截图（顺带证明开关可重复）
        await openPanel('位置');
        const posShot = join(SHOT_DIR, `e2e-players-${label}-multiselect.png`);
        await page.screenshot({ path: posShot, fullPage: false });
        shots.push(posShot);
        await closePanel();

        // 抽屉往下滚，把 PlayStyle 触发器顶到抽屉下沿：触发器下方空间最小时，面板最容易被顶出视口
        if (width <= 900) {
          const adv = page.locator('.library-side details.lib-adv');
          if (!(await adv.evaluate((el) => el.open))) await adv.locator('> summary').click();
          await page
            .locator('.library-side button.multiselect', { hasText: 'PlayStyle' })
            .first()
            .evaluate((el) => el.scrollIntoView({ block: 'end' }));
          await page.waitForTimeout(200);
          await openPanel('PlayStyle');
          const ps = await panelProbe();
          console.log(
            `   面板几何：位置 触发器底 ${pos.triggerBottom} 面板 ${pos.top}–${pos.bottom}（视口高 ${pos.viewportH}）` +
              ` / PlayStyle 触发器底 ${ps?.triggerBottom} 面板 ${ps?.top}–${ps?.bottom}`,
          );
          assertPanel(label, '（贴底）PlayStyle', ps);
          const psShot = join(SHOT_DIR, `e2e-players-${label}-multiselect-ps.png`);
          await page.screenshot({ path: psShot, fullPage: false });
          shots.push(psShot);
          await closePanel();
        } else {
          console.log(
            `   面板几何：位置 触发器底 ${pos.triggerBottom} 面板 ${pos.top}–${pos.bottom}（视口高 ${pos.viewportH}）`,
          );
        }

        // 翻页条：按线上量级的文案量一次页面横向溢出（本地夹具文案短得多，直接量会漏）
        const pager = await pagerProbe();
        assert(pager, `${label}：找不到翻页条文案节点`);
        console.log(
          `   翻页条：高度 ${pager.pagerHeight}，页面 ${pager.docScrollW}/${pager.docClientW}`,
        );
        assert(
          !pager.pageOverflow,
          `${label}：翻页条把页面撑出横向滚动（${pager.docScrollW} > ${pager.docClientW}）`,
        );

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
      const noise = new Set([...badResponses].filter(isKnownNoise));
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
