#!/usr/bin/env node
// 本地端到端冒烟（v2.8.1 建，v3.1.0 起兼顾 OIDC 模式 + 球员库三视口，v3.4.0 加球队页三视口，
// v6.19.0 球员库窄屏卡片化，v6.20.0 加全路由 375 零溢出扫描⑫ + 管理抽屉开合⑬，
// v6.21.0 加成长补录卡片流⑭ + 教练台粘性首列⑮；v6.22.0 加公开阅读几何⑯；
// v6.23.0 转会合并：/offers 与 /negotiations 换址到 /market/desk，加 ⑤b 换址 / ⑤c 转会台结构 / ⑤d 匿名）：
// playwright-core + 系统 Chrome，对 dev 8791 做黑盒验证。
//
// 球队页（⑨⑩）例外：本地 TOUR_DB（whl）的 team 表是旧 schema（没有 logo_key / club_id），
// GET /api/clubs 与 GET /api/clubs/:id 在本机必然 500 ⇒ 那两个端点用 page.route() 打桩回夹具
// （打完即撤）。/api/me/club 也打桩，但理由不是「取不到」——它只读 AUTH_DB team_binding/team
// 与 whl-club，本机其实是 200 带 club；打桩是为了造出「非教练观众」与「取不到」两种受控情形。
// 后端响应形状与读量由单测与 scripts/d1-read-audit/ 覆盖，这里量的是真浏览器里的渲染与几何。
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
// 本地 TOUR_DB（whl）的 team 表是旧 schema（无 logo_key / club_id，只有 4 行），读赛事库的
// 这几个端点必然 500：环境噪声，不是本仓库的回归，⑨ 不据此判失败；换成有数据的环境自然会通过
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

  // 同一行控件的对齐（v3.1.1 步骤 1 的诉求）：.control-row 是 align-items:flex-end，
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
  // 表格单元格不折行（v3.2.1）：12 列挤在约 980px 里时，「Baseline Utd」会按空格断行、
  // 「2金7银」会按 CJK 任意断行。本机夹具只有 9 名球员、名字也短，折行在这里复现不出来 ⇒
  // 这组断言锁的是口径（td 的 computed white-space 一律 nowrap、容器允许横向滚动），不是布局本身。
  // v6.26.1 B 块：顺带量吸底镜像横向滚动条（.sticky-xbar）——存在性 + 双向同步：把表格 scrollLeft
  // 设到中段，等两帧（scroll 事件在 rAF 回调之前派发），镜像轨要跟到同一位置（±1 容忍取整）；
  // 无溢出夹具下两侧都被钳到 0，同步断言同样成立，存在性才是硬断言。量完滚回 0，别让截图带着滚过的表格。
  const tableLayoutProbe = () =>
    page.evaluate(async () => {
      const wrap = document.querySelector('.library-main .table-wrap');
      const table = wrap ? wrap.querySelector('table') : null;
      const cells = [...document.querySelectorAll('.library-main tbody td')];
      const head = document.querySelector('.library-main thead th');
      const bar = document.querySelector('.sticky-xbar');
      let barSync = null;
      if (wrap && bar) {
        const target = Math.round(Math.max(50, (wrap.scrollWidth - wrap.clientWidth) / 2));
        wrap.scrollLeft = target;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        barSync = { target: wrap.scrollLeft, bar: Math.round(bar.scrollLeft) };
        wrap.scrollLeft = 0;
        await new Promise((r) => requestAnimationFrame(r));
        // 反向（bar→wrap）：拖镜像轨也要带表格走——两个方向各自真断言，缺一向的同步就不算双向
        const target2 = Math.round(Math.max(50, (bar.scrollWidth - bar.clientWidth) / 2));
        bar.scrollLeft = target2;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        barSync.barToWrap = { target: bar.scrollLeft, wrap: Math.round(wrap.scrollLeft) };
        bar.scrollLeft = 0;
        await new Promise((r) => requestAnimationFrame(r));
      }
      return {
        cells: cells.length,
        notNowrap: cells.filter((el) => getComputedStyle(el).whiteSpace !== 'nowrap').length,
        headNowrap: head ? getComputedStyle(head).whiteSpace === 'nowrap' : null,
        overflowX: wrap ? getComputedStyle(wrap).overflowX : null,
        // 不折行的代价：表格最小宽度超过容器就要横向滚动（口径是「宁可横滚，不要断行」）
        tableW: table ? Math.round(table.getBoundingClientRect().width) : 0,
        wrapW: wrap ? Math.round(wrap.getBoundingClientRect().width) : 0,
        barPresent: !!bar,
        barSync,
      };
    });

  const assertTableNoWrap = (label, t) => {
    console.log(
      `   ${label} 表格：${t.cells} 个单元格，非 nowrap ${t.notNowrap}，表头 nowrap ${t.headNowrap}，` +
        `容器 overflow-x ${t.overflowX}，宽 ${t.tableW}/${t.wrapW}，` +
        `吸底镜像轨 ${t.barPresent ? `在（同步 ${t.barSync?.bar}/${t.barSync?.target}）` : '缺失'}`,
    );
    // 空集静默通过 = 什么都没验（比如表格没渲染出来）
    assert(t.cells > 0, `${label}：没量到球员库表格单元格`);
    assert(t.notNowrap === 0, `${label}：有 ${t.notNowrap} 个单元格仍会折行`);
    assert(t.headNowrap === true, `${label}：表头也不是 nowrap（口径该统一到整表）`);
    assert(
      t.overflowX === 'auto' || t.overflowX === 'scroll',
      `${label}：表格容器不横向滚动（${t.overflowX}），单元格不折行会把内容压出容器`,
    );
    // v6.26.1 B 块：吸底镜像横向滚动条必须存在且与表格双向同步
    assert(t.barPresent, `${label}：桌面球员库没渲染吸底镜像横向滚动条 .sticky-xbar`);
    assert(t.barSync, `${label}：镜像滚动条同步探针没取到读数（.table-wrap 或 .sticky-xbar 缺失）`);
    assert(
      Math.abs(t.barSync.bar - t.barSync.target) <= 1,
      `${label}：镜像滚动条不同步（表格 scrollLeft ${t.barSync.target}，镜像 ${t.barSync.bar}）`,
    );
    // 反向：拖镜像轨必须带表格走（只覆盖 wrap→bar 的单向同步不算双向）
    assert(
      Math.abs(t.barSync.barToWrap.wrap - t.barSync.barToWrap.target) <= 1,
      `${label}：镜像滚动条反向不同步（镜像 scrollLeft ${t.barSync.barToWrap.target}，表格 ${t.barSync.barToWrap.wrap}）`,
    );
  };

  const pagerProbe = () =>
    page.evaluate(() => {
      const pager = document.querySelector('.library-pager');
      const span = pager?.querySelector('span');
      if (!pager || !span) return null;
      const before = span.textContent;
      // v3.2.0：翻页条改游标式文案；塞线上量级的极端值，量的是页面级横向溢出
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
      // v3.2.0：列表不再回 total（每条整表 COUNT = 18,763 行，占单页读量 99.7%），
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
      // 摘要条与翻页条同一行（v3.1.1 步骤 5）；没有筛选条件时摘要整块不渲染，只剩翻页
      assert(await page.locator('.lib-bar .library-pager').isVisible(), '翻页条不可见');
      assert((await page.locator('.lib-summary').count()) === 0, '未设筛选时不应有摘要条');
      // 排序入口自v3.1.0 起是表头（工具栏的排序下拉与方向段控件已删除）
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
      // URL 由 replaceState 同步生效，表头 aria-sort 随 React 重渲染提交（BUG-1：两者有一帧级窗口，
      // URL 命中就断言会踩进窗口假红）—— 先等状态落 DOM，再断言保留可读报错
      await page
        .locator('.library-main thead [aria-sort="descending"]')
        .first()
        .waitFor({ timeout: TIMEOUT })
        .catch(() => {});
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

    // ---- 转会中心（v6.23.0）：/offers 与 /negotiations 换址到 /market/desk，市场「我的」并入转会台 ----
    // 带 admin 会话进 desk，页面会拉 /api/me/club、两侧 /api/offers、/api/negotiations?mine=1、
    // /api/me/bids、/api/club/squad 六条：本地库未必都 200，不钉住就会把噪声带进 ⑪ 的判定
    // （⑫ 那种「放 ⑪ 之后」的办法在这里用不上——换址验的就是 URL，得真导航）。
    const DESK_ME_CLUB = {
      club: { id: 1, name: '阿森纳', leagueTier: 'premier', logoKey: null, status: 'normal' },
      balance: 100, squadCount: 3, window: { season: 9, windowSeq: 1 }, home: null,
    };
    const deskOffer = (over) => ({
      id: 1,
      player: { id: 5, fcId: 100005, name: '边锋戊', position: 'ST', ca: 70, pa: 80 },
      counterpart: { id: 73, name: '巴黎圣日耳曼' },
      role: 'seller', amount: 12.5, initAmount: 10, round: 2, note: null,
      status: 'pending', turn: 'seller', myTurn: false, listingId: 11,
      createdAt: '2026-09-20T10:00:00Z', updatedAt: '2026-09-20T10:00:00Z',
      ...over,
    });
    const DESK_OFFERS_IN = {
      club: { id: 1, name: '阿森纳' }, box: 'in', nextCursor: null, pendingMine: 1,
      items: [
        deskOffer({ id: 1, myTurn: true }),
        // 同侧第二条 pending 但不是我回合：待办计数若改成「按清单行数/去掉 myTurn 过滤」就会 1→2（V4 红点）
        deskOffer({ id: 2, myTurn: false, turn: 'buyer' }),
        // 报价被接受 ≠ 成交：这一行要出「已接受·挂牌竞价中」（V7 红点）
        deskOffer({ id: 3, status: 'accepted', turn: 'buyer' }),
      ],
    };
    const DESK_OFFERS_OUT = {
      club: { id: 1, name: '阿森纳' }, box: 'out', nextCursor: null, pendingMine: 0,
      items: [deskOffer({ id: 4, role: 'buyer', counterpart: { id: 241, name: '巴塞罗那' }, amount: 20, turn: 'seller' })],
    };
    const deskNego = (over) => ({
      id: 21, transferId: 31, status: 'active',
      transfer: { type: 'transfer', status: 'pending_review', fee: 12.5 },
      fromClubName: '阿森纳', toClubName: '巴塞罗那',
      player: { id: 7, fcId: 100007, name: '中场丙', position: 'CM', age: 24, ca: 74, pa: 82 },
      agentTier: 2, agentTierLabel: '二级经纪人',
      releaseFee: null, rcBounds: [4, 8], expectedWage: 5.5,
      attemptsUsed: 0, remaining: 3, lastSatisfaction: null, lastRisk: false, attempts: [], settled: null,
      ...over,
    });
    const DESK_NEGO = {
      sessions: [
        deskNego({}), // 违约金未定 ⇒ 阶段徽标「第一步 · 定违约金」
        deskNego({
          id: 22, transferId: 32, releaseFee: 9, rcBounds: [6, 12], remaining: 2, attemptsUsed: 1,
          attempts: [{ attemptNo: 1, offeredWage: 5, result: 'fail' }],
        }), // 违约金已定 ⇒ 「工资谈判 · 剩 2 轮」
        deskNego({
          id: 23, transferId: 33, status: 'settled', releaseFee: 9, remaining: 0, attemptsUsed: 1,
          settled: { wage: 6.25, source: 'negotiation', message: '谈妥签约' },
          player: { id: 8, fcId: 100008, name: '前锋丁', position: 'ST', age: 26, ca: 78, pa: 80 },
        }),
      ],
    };
    const DESK_BIDS = {
      bids: [
        { id: 51, listingId: 11, amount: 8, createdAt: '2026-09-20T09:00:00Z', status: 'active', holdStatus: 'held',
          listingStatus: 'bidding', askPrice: 7, sellerClubName: '巴黎圣日耳曼',
          player: { id: 5, fcId: 100005, name: '边锋戊', position: 'ST', ca: 70, pa: 80 } },
        // 赢了但挂牌还压在管理组审核 ⇒ 徽标改「待审核」（v6.23.0 新推导）
        { id: 52, listingId: 12, amount: 15, createdAt: '2026-09-19T09:00:00Z', status: 'won', holdStatus: 'held',
          listingStatus: 'pending_review', askPrice: 14, sellerClubName: '巴塞罗那',
          player: { id: 7, fcId: 100007, name: '中场丙', position: 'CM', ca: 74, pa: 82 } },
        { id: 53, listingId: 13, amount: 6, createdAt: '2026-09-18T09:00:00Z', status: 'won', holdStatus: 'settled',
          listingStatus: 'matched_pending', askPrice: 6, sellerClubName: 'AC米兰',
          player: { id: 9, fcId: 100009, name: '后卫己', position: 'CB', ca: 72, pa: 76 } },
      ],
    };
    const DESK_SQUAD = {
      club: { id: 1, name: '阿森纳', leagueTier: 'premier' }, season: 9, registeredInTournament: true,
      players: [
        { id: 5, fcId: 100005, name: '边锋戊', number: '7', position: 'ST', age: 22, ca: 70, pa: 80, growable: true,
          isFutureStar: false, chinaPlan: false, status: 'normal', marketValue: 20, wage: 3.5, releaseFee: 16,
          contractType: 'senior', hasContract: true, squad: 'first_team' },
        { id: 6, fcId: 100006, name: '小将庚', number: null, position: 'CM', age: 17, ca: 55, pa: 88, growable: true,
          isFutureStar: true, chinaPlan: false, status: 'trainee', marketValue: 5, wage: null, releaseFee: null,
          contractType: null, hasContract: false, squad: 'trainee' },
      ],
      registration: null, compliance: null, rules: null,
    };
    const DESK_STUBS = [
      [/\/api\/me\/club(\?|$)/, DESK_ME_CLUB],
      [/\/api\/offers\?box=in/, DESK_OFFERS_IN],
      [/\/api\/offers\?box=out/, DESK_OFFERS_OUT],
      [/\/api\/negotiations\?mine=1/, DESK_NEGO],
      [/\/api\/me\/bids/, DESK_BIDS],
      [/\/api\/club\/squad/, DESK_SQUAD],
    ];
    const deskOk = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const stubDesk = async () => {
      for (const [pattern, body] of DESK_STUBS) await page.route(pattern, (r) => r.fulfill(deskOk(body)));
    };
    const unstubDesk = async () => {
      for (const [pattern] of DESK_STUBS) await page.unroute(pattern);
    };

    await check('⑤b 旧报价/谈判路由换址到转会台（box 映射与默认值）', async () => {
      await stubDesk();
      try {
        await page.goto(`${BASE}/offers?box=out`, { waitUntil: 'networkidle' });
        const u1 = new URL(page.url());
        assert(u1.pathname === '/market/desk', `/offers 没换址到 /market/desk（落在 ${u1.pathname}）`);
        assert(u1.searchParams.get('tab') === 'offers' && u1.searchParams.get('box') === 'out',
          `/offers?box=out 换址丢了参数（${u1.search}）`);

        await page.goto(`${BASE}/offers`, { waitUntil: 'networkidle' });
        const u2 = new URL(page.url());
        assert(u2.pathname === '/market/desk' && u2.searchParams.get('box') === 'in',
          `/offers 不带 box 时该按 in（${u2.search}）`);

        await page.goto(`${BASE}/negotiations`, { waitUntil: 'networkidle' });
        const u3 = new URL(page.url());
        assert(u3.pathname === '/market/desk' && u3.searchParams.get('tab') === 'nego',
          `/negotiations 没换址到 tab=nego（${u3.search}）`);

        // 旧的「我的」退役：无路由 ⇒ 壳还在但没有挂牌表单（TC-RED-03 后半条）
        await page.goto(`${BASE}/market/mine`, { waitUntil: 'networkidle' });
        assert(!(await text()).includes('挂牌我的球员'), '/market/mine 仍渲染旧「我的」页内容');
      } finally {
        await unstubDesk();
      }
    });

    await check('⑤c 转会台结构（v6.32.0 页签化）：流水线一行 / 页签计数 / 条件挂载 / 阶段徽标 / 深链', async () => {
      await stubDesk();
      try {
        await page.goto(`${BASE}/market/desk`, { waitUntil: 'networkidle' });
        assert(await page.locator('h1', { hasText: '转会台' }).first().isVisible(), '转会台 h1 不可见');

        // 顶栏收敛：一条「转会中心」，旧的两个入口退役（V3 红点）
        const tabs = page.locator('nav.nav-links a.nav-tab');
        assert(JSON.stringify(await tabs.allInnerTexts()) !== '[]', '顶栏没有渲染导航空');
        assert((await tabs.filter({ hasText: '转会中心' }).count()) === 1, '顶栏没有「转会中心」入口');
        assert((await tabs.filter({ hasText: '转会报价' }).count()) === 0, '顶栏仍留着「转会报价」旧入口');
        assert((await tabs.filter({ hasText: '签约谈判' }).count()) === 0, '顶栏仍留着「签约谈判」旧入口');

        // MarketNav 六项（顺序与指向；v6.31.0 广告板第 2 项）：NavLink 指错就红（V5 红点）
        const nav = page.locator('nav[aria-label="市场分区"] a');
        assert(JSON.stringify(await nav.allInnerTexts()) === JSON.stringify(['在售市场', '广告板', '海捞', '激活', '我的转会台', '市场情报']),
          `MarketNav 文案/顺序不对：${(await nav.allInnerTexts()).join(' / ')}`);
        assert(JSON.stringify(await nav.evaluateAll((els) => els.map((e) => e.getAttribute('href')))) ===
          JSON.stringify(['/market', '/market/board', '/market/free', '/market/activation', '/market/desk', '/market/intel']),
          `MarketNav 指向不对：${(await nav.evaluateAll((els) => els.map((e) => e.getAttribute('href')))).join(' / ')}`);

        // 流水线一行（v6.32.0 精简）：徽标链在场；机制句唯一讲解点收进报价区块 hint
        const pipe = await page.locator('[aria-label="转会流水线"]').innerText();
        assert(pipe.includes('管理组审核') && pipe.includes('签约谈判') && pipe.includes('成约过户'),
          `流水线说明条文案不全：${pipe.replace(/\s+/g, ' ')}`);
        assert(!(await text()).includes('报价被接受 ≠ 成交'), '默认页签（谈判）不应出现机制句（已收进报价区块）');

        // 待办速览退役：页签自带计数（夹具：谈判 active 2 / 报价 pendingMine 1+0 / 出价 active 1）
        assert((await page.locator('[aria-label="待办速览"]').count()) === 0, '待办速览条未退役');
        const tabBtn = async (label) =>
          (await page.locator('[aria-label="转会台页签"] button', { hasText: label }).innerText()).replace(/\s+/g, '');
        assert((await tabBtn('签约谈判')) === '签约谈判2', `谈判页签计数不对（夹具 2 场 active）：${await tabBtn('签约谈判')}`);
        assert((await tabBtn('报价')) === '报价1', `报价页签计数不对（夹具 pendingMine 1+0）：${await tabBtn('报价')}`);
        assert((await tabBtn('我的出价')) === '我的出价1', `出价页签计数不对（夹具 1 条 active）：${await tabBtn('我的出价')}`);

        // 条件挂载：默认只挂谈判区块，另两个锚不在 DOM（v6.32.0 前是三锚同屏有序）
        const ids = await page.evaluate(() => [...document.querySelectorAll('[id^="desk-"]')].map((e) => e.id));
        assert(JSON.stringify(ids) === JSON.stringify(['desk-nego']), `默认应只挂谈判区块，实际：${ids.join(' / ')}`);
        const negoText = await page.locator('#desk-nego').innerText();
        assert((negoText.match(/第一步 · 定违约金/g) ?? []).length === 1, '违约金未定的谈判卡没出阶段徽标');
        assert(negoText.includes('工资谈判 · 剩 2 轮'), '违约金已定的谈判卡没出「工资谈判 · 剩 N 轮」');
        assert(!negoText.includes('已落定的谈判'), '已落定谈判表应已删除（历史归球队中心转会页签队史）');

        // 切「报价」页签：条件挂载换区，阶段徽标（V7：accepted 文案一改回「已挂牌」这条就红）
        await page.locator('[aria-label="转会台页签"] button', { hasText: '报价' }).click();
        await page.locator('#desk-offers').waitFor({ timeout: TIMEOUT });
        assert((await page.evaluate(() => document.getElementById('desk-nego'))) === null, '切走后谈判区块未卸载');
        const offerRows = page.locator('#desk-offers tbody tr');
        assert((await offerRows.filter({ hasText: '已接受·挂牌竞价中' }).count()) === 1, '报价行没出「已接受·挂牌竞价中」徽标');
        assert((await offerRows.filter({ hasText: '待你表态' }).count()) === 1, '轮到我的报价行没出「待你表态」');
        assert((await offerRows.filter({ hasText: '等对方' }).count()) === 1, '不该我表态的 pending 行没出「等对方」');
        assert((await text()).includes('报价被接受 ≠ 成交'), '报价区块缺机制句（v6.32.0 唯一讲解点）');

        // 深链：?tab=offers&box=out 直接落报价页签（页签化后 = 直接挂载，无需滚动几何判据）
        await page.goto(`${BASE}/market/desk?tab=offers&box=out`, { waitUntil: 'networkidle' });
        await page.locator('#desk-offers').waitFor({ timeout: TIMEOUT });
        assert((await page.evaluate(() => document.getElementById('desk-nego'))) === null, '深链 offers 仍挂着谈判区块（条件挂载失效）');
        assert((await text()).includes('巴塞罗那'), '?box=out 没生效（out 侧报价行未渲染）');
        assert((await page.locator('#desk-offers [aria-label="报价页签"] button.on').first().innerText()).includes('我送出的'),
          '?box=out 时「我送出的」页签未选中');

        // 旧链 ?tab=mine 是 alias（v6.24.0）：URL 不改写，仍落「我的出价」页签
        await page.goto(`${BASE}/market/desk?tab=mine`, { waitUntil: 'networkidle' });
        assert((await page.evaluate(() => location.search)).includes('tab=mine'), '?tab=mine 被改写（alias 应保留原 URL）');
        await page.locator('#desk-bids').waitFor({ timeout: TIMEOUT });
        assert((await page.evaluate(() => document.getElementById('desk-offers'))) === null, 'mine alias 落地时报价区块不应挂载');
        assert((await page.locator('#desk-bids tbody tr', { hasText: '待审核' }).count()) === 1, 'won+挂牌待审核的出价行没出「待审核」');
        assert((await page.locator('#desk-bids tbody tr', { hasText: '领先中' }).count()) === 1, 'active 出价行没出「领先中」');
        assert((await page.locator('#desk-bids select').count()) === 0, '出价区还带着挂牌表单的下拉（v6.24.0 已删）');
      } finally {
        await unstubDesk();
      }
    });

    await check('⑤d 转会台：匿名只给登录引导，不泄露区块内容', async () => {
      // 同 ⑩：本地 AUTH_MODE=oidc 时匿名会先被 syncProbe 整页跳 /api/auth/sync，钉住 /api/me 才落回守卫
      const anon = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      try {
        const ap = await anon.newPage();
        await ap.route(/\/api\/me(\?|$)/, (r) =>
          r.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ user: null, authMode: 'shared', authHome: null }),
          }),
        );
        await ap.goto(`${BASE}/market/desk`, { waitUntil: 'networkidle' });
        const t = await ap.locator('body').innerText();
        assert(t.includes('这个页面要登录后才能用'), `匿名进 /market/desk 没给登录引导：${t.slice(0, 120)}`);
        assert((await ap.locator('[id^="desk-"]').count()) === 0, '匿名竟然渲染出了转会台区块');
        assert((await ap.locator('[aria-label="待办速览"]').count()) === 0, '匿名竟然渲染出了待办速览');
        // 匿名从旧地址进来：换址本身不拦（重定向路由无 RequireUser），落到 desk 后由 desk 的软提示接住
        await ap.goto(`${BASE}/offers?box=out`, { waitUntil: 'networkidle' });
        assert(ap.url().includes('/market/desk') && ap.url().includes('tab=offers') && ap.url().includes('box=out'), `匿名 /offers 换址参数丢失：${ap.url()}`);
        assert((await ap.locator('body').innerText()).includes('这个页面要登录后才能用'), '匿名经 /offers 换址后没给登录引导');
      } finally {
        await anon.close();
      }
    });

    // ---- 广告板（v6.31.0）：/market/board 公开页 + 在售市场页顶部小卡片（teaser）----
    // 端点只收转会名单内球员、下发公开标价 listPrice（v6.33.0 起最低报价不出公开端点）与布尔位；
    // 着重度 0 普通 / 1 推荐 / 2 置顶（付费写路径本版未实现，夹具直给）
    const adbOk = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const adbRow = (over) => ({
      id: 1, uid: 'fc1', fcId: 100001, name: '哈兰德', positions: ['ST'], age: 24, ca: 94, pa: 95,
      clubId: 10, clubName: '曼城', listPrice: 180, releaseFee: 240,
      listedAt: '2026-10-03T00:00:00.000Z', emphasis: 0, emphasisUntil: null,
      status: 'normal', notForSale: false, transferPriced: true,
      ...over,
    });
    const ADB_BOARD = {
      players: [
        adbRow({ id: 1, name: '哈兰德', emphasis: 2, emphasisUntil: '2026-10-12T12:00:00.000Z' }),
        adbRow({ id: 2, name: '萨拉赫', fcId: 100002, emphasis: 1, ca: 89, pa: 90, listPrice: 60, releaseFee: null }),
        adbRow({ id: 3, name: '凯恩', fcId: 100003, emphasis: 0, ca: 90, pa: 90, listPrice: 75 }),
        adbRow({ id: 4, name: '姆巴佩', fcId: 100004, emphasis: 0, ca: 91, pa: 94, listPrice: 200 }),
      ],
      total: 12,
    };
    let adbBody = ADB_BOARD; // 同一条 route 处理器，两段断言之间切夹具（有数据 → 空数据）
    // 按 ?limit= 切片：板页请求 200（全量），小卡片请求 3（三张迷你卡）——照真实端点的语义
    await page.route(/\/api\/market\/transfer-board/, (r) => {
      const lim = Number(new URL(r.request().url()).searchParams.get('limit'));
      const players = Number.isInteger(lim) && lim > 0 ? adbBody.players.slice(0, lim) : adbBody.players;
      return r.fulfill(adbOk({ players, total: adbBody.total }));
    });

    await check('⑤e 广告板：置顶带 + 卡栅格 + 图例 + 截断提示 + 「换一批」换序；小卡片三张迷你卡、空数据整块不渲染', async () => {
      await page.goto(`${BASE}/market/board`, { waitUntil: 'networkidle' });
      assert(await page.locator('h1', { hasText: '广告板' }).first().isVisible(), '广告板 h1 不可见');
      // 导航：广告板是第 2 项且为当前项（顺序由 mobile-baseline 静态闸兜底，这里验落点与高亮）
      assert((await page.locator('nav[aria-label="市场分区"] a.on').first().innerText()).trim() === '广告板',
        `广告板导航项没高亮：${await page.locator('nav[aria-label="市场分区"] a.on').first().innerText()}`);
      // 置顶带：emphasis=2 通栏 1 条 + 标题带个数与付费位口径 + 到期日
      assert((await page.locator('.adb-fcard').count()) === 1, `置顶通栏卡应为 1 张，实测 ${await page.locator('.adb-fcard').count()}`);
      assert((await page.locator('.adb-band-note').innerText()).includes('1 个 · 付费位，按到期时间排'),
        `置顶带标题不对：${await page.locator('.adb-band-note').innerText()}`);
      assert((await page.locator('.adb-fcard').innerText()).includes('置顶到 2026-10-12'), '置顶卡没出「置顶到」到期日');
      // 卡栅格：0/1 三行进栅格，置顶行不得重复出现
      assert((await page.locator('.adb-grid .adb-card').count()) === 3, `栅格卡应为 3 张，实测 ${await page.locator('.adb-grid .adb-card').count()}`);
      assert((await page.locator('.adb-grid .emph-1').count()) === 1, '推荐档卡没挂 emph-1');
      assert(!(await page.locator('.adb-grid').innerText()).includes('哈兰德'), '置顶行又出现在栅格里（两区没分流）');
      assert((await page.locator('.transfer-status-legend').count()) === 1, '广告板底部缺转会状态图例');
      assert((await text()).includes('共 12 人在名单，这里展示前 4 人'), '截断提示缺失（total > 展示数时应提示）');

      // v6.33.0 报价按钮与弹层：每张卡脚一个圆形「报」钮；点开弹层预填标价；关闭收起
      assert((await page.locator('.adb-bid-btn').count()) === 4, `圆形报价按钮应为 4 个（每卡一个），实测 ${await page.locator('.adb-bid-btn').count()}`);
      await page.locator('.adb-fcard .adb-bid-btn').click();
      const bidDialog = page.locator('.modal-mask .modal-card');
      await bidDialog.waitFor({ timeout: TIMEOUT });
      assert((await bidDialog.locator('h3').innerText()).includes('给 哈兰德 报价'), '报价弹层标题不对');
      assert((await bidDialog.locator('input[aria-label="报价金额"]').inputValue()) === '180', '弹层金额没预填标价');
      assert((await bidDialog.innerText()).includes('低于标价视为砍价'), '弹层缺砍价提示文案');
      await bidDialog.locator('button', { hasText: '取消' }).click();
      assert((await page.locator('.modal-mask').count()) === 0, '弹层取消后没关闭');

      // 「换一批」：普通档 ≥2 才有按钮；点一次必换序（付费档仍在首、集合不变）
      assert((await page.locator('.adb-shuffle').count()) === 1, '普通档 ≥2 时应有「换一批」按钮');
      const gridNames = async () =>
        (await page.locator('.adb-grid .adb-card .adb-nm').allInnerTexts()).map((s) => s.trim());
      const orderBefore = await gridNames();
      assert(orderBefore[0] === '萨拉赫', `栅格第一张应为推荐档萨拉赫，实测 ${orderBefore[0]}`);
      await page.locator('.adb-shuffle').click();
      const orderAfter = await gridNames();
      assert(orderAfter.join(',') !== orderBefore.join(','), `点「换一批」后顺序没变：${orderAfter.join(',')}`);
      assert(orderAfter[0] === '萨拉赫', '「换一批」把付费档挪走了');
      assert([...orderAfter].sort().join(',') === [...orderBefore].sort().join(','), '「换一批」改变了球员集合');

      // 小卡片：在售市场页顶部，3 张迷你卡 + 「查看全部 N 人 →」链到 /market/board
      await page.goto(`${BASE}/market`, { waitUntil: 'networkidle' });
      const teaser = page.locator('.adb-teaser');
      await teaser.waitFor({ timeout: TIMEOUT });
      assert((await teaser.locator('h3').innerText()).trim() === '广告板', '小卡片标题不对');
      assert((await teaser.innerText()).includes('12 人在名单'), '小卡片没出「N 人在名单」');
      assert((await teaser.locator('.adb-mini').count()) === 3, `小卡片迷你卡应为 3 张，实测 ${await teaser.locator('.adb-mini').count()}`);
      assert((await teaser.locator('a', { hasText: '查看全部' }).getAttribute('href')) === '/market/board', '小卡片「查看全部」没指向 /market/board');
      // 小卡片必须排在转会区之上（用户裁决：在受市场的转会区之上加一个小卡片）
      const teaserBeforeSection = await page.evaluate(() => {
        const t = document.querySelector('.adb-teaser');
        const sec = [...document.querySelectorAll('section.card')].find((s) => s.querySelector('h3')?.textContent === '转会区');
        return !!(t && sec) && (t.compareDocumentPosition(sec) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      });
      assert(teaserBeforeSection, '小卡片没有排在「转会区」之上');

      // 空数据：页面空态（不出栅格/图例），小卡片整块连标题一起消失
      adbBody = { players: [], total: 0 };
      await page.goto(`${BASE}/market/board`, { waitUntil: 'networkidle' });
      assert((await text()).includes('现在没有球队挂出转会名单。'), '空态文案缺失');
      assert((await page.locator('.adb-grid').count()) === 0, '空数据仍渲染了卡栅格');
      assert((await page.locator('.adb-band-note').count()) === 0, '空数据仍渲染了置顶带');
      await page.goto(`${BASE}/market`, { waitUntil: 'networkidle' });
      await page.locator('h3', { hasText: '转会区' }).first().waitFor({ timeout: TIMEOUT });
      assert((await page.locator('.adb-teaser').count()) === 0, '空数据仍渲染了小卡片（应整块消失，不留空卡）');
      adbBody = ADB_BOARD;
    });

    // ---- 球员对比（v6.34.0 步骤 8）：详情页「⇄ 加入对比」→ 1/2/3 人态 → 非法/重复/超限降级 → 库内勾选收集栏 ----
    // 取样球员从 /api/players?limit=6 取前 6 行 fc_id（本地夹具 9001 起有值；fc_id 是对比页与球员 URL
    // 的统一寻址口径）。只验真浏览器里能验的：客户端跳转落点、1/2/3 人态的分支互斥（热区图占位只在
    // 2 人桌面态、三张小雷达只在 3 人态）、滚过雷达后吸顶条真出现、属性表行数/组头、收集栏勾选链路。
    // 错误口径照 ⑪：只认本场景新增的 pageErrors 与 /api/players 非 2xx，已知环境噪声不参与判定。
    await check('⑤f 球员对比：详情入口 / 1-2-3 人态 / 非法重复超限降级 / 库内勾选收集栏', async () => {
      const errBefore = pageErrors.length;
      const badBefore = badResponses.length;
      const sample = await page.evaluate(async () => {
        const r = await fetch('/api/players?limit=6');
        if (!r.ok) return null;
        const j = await r.json();
        return (j.players ?? []).map((p) => p.fcId ?? p.id).filter((v) => v != null);
      });
      assert(sample && sample.length >= 4, `本地夹具不足 4 名有 fc_id 的球员（拿到 ${sample ? sample.length : 'null'}）——⑤f 前置缺失`);
      const [A, B, C, D] = sample;

      // 1) 详情页入口：CA/PA 行下「⇄ 加入对比」带 fc_id 进 1 人态；点击真客户端跳转
      await page.goto(`${BASE}/players/${A}`, { waitUntil: 'networkidle' });
      const entry = page.locator('.player-card-compare a');
      await entry.waitFor({ timeout: TIMEOUT });
      const entryHref = await entry.getAttribute('href');
      assert(entryHref === `/players/compare?ids=${A}`, `详情页对比入口 href 不对（${entryHref}）`);
      await entry.click();
      await page.locator('.cmp-page').waitFor({ timeout: TIMEOUT });
      assert(await page.locator('h1', { hasText: '球员对比' }).first().isVisible(), '对比页 h1 不可见');
      assert((await page.locator('.cmp-urlchip').innerText()).includes(`/players/compare?ids=${A}`), 'URL chip 没回显名单');
      assert((await page.locator('.cmp-ids > .cmp-card').count()) === 1, '1 人态应有 1 张身份卡');
      const soloSlot = page.locator('.cmp-emptyslot');
      await soloSlot.waitFor({ timeout: TIMEOUT });
      assert((await soloSlot.locator('.cmp-emptyslot-title').innerText()).includes('还差 1 名球员'), '1 人态缺「还差 1 名球员」');
      const soloBorder = await soloSlot.evaluate((el) => getComputedStyle(el).borderTopStyle);
      assert(soloBorder === 'dashed', `1 人空槽应是虚线框（border-top-style=${soloBorder}）`);
      assert((await page.locator('.cmp-radar-solo .cmp-radar-big').count()) === 1, '1 人态缺单人雷达');
      assert((await page.locator('.cmp-table').count()) === 0, '1 人态不该渲染对照表');

      // 2) 2 人态：双色叠图（1 大雷达 / 2 条数据多边形）+ 两份热区图虚线占位 + 属性表 34 行属性 6 组头
      await page.goto(`${BASE}/players/compare?ids=${A},${B}`, { waitUntil: 'networkidle' });
      await page.locator('.cmp-table').waitFor({ timeout: TIMEOUT });
      assert((await page.locator('.cmp-ids > .cmp-card').count()) === 2, '2 人态应有 2 张身份卡');
      assert((await page.locator('.cmp-radarzone .cmp-radar-big').count()) === 1, '2 人态应有 1 张大雷达');
      assert((await page.locator('.cmp-radarzone polygon.cmp-radar-data').count()) === 2, '双色叠图应有 2 条数据多边形');
      assert((await page.locator('.cmp-radarzone .cmp-heat').count()) === 2, '2 人桌面态应有 2 个热区图占位');
      const heatNote = await page.locator('.cmp-heat-note').first().innerText();
      assert(heatNote.includes('位置热区图待热区图轮落地'), `热区图占位文案不对（${heatNote}）`);
      const heatBorder = await page.locator('.cmp-heat-box').first().evaluate((el) => getComputedStyle(el).borderTopStyle);
      assert(heatBorder === 'dashed', `热区图占位应是虚线框（border-top-style=${heatBorder}）`);
      const groupKeys = (await page.locator('.cmp-table .cmp-row.cmp-gh .cmp-row-label').allInnerTexts()).map((s) => s.trim());
      assert(groupKeys.join(',') === 'PAC,SHO,PAS,DRI,DEF,PHY', `属性表六个组头顺序不对（${groupKeys.join(',')}）`);
      const attrRows = await page.locator('.cmp-table .cmp-col .cmp-row:not(.cmp-gh)').count();
      assert(attrRows === 34, `属性表应有 34 行属性，实测 ${attrRows}`);
      const firstLabel = (await page.locator('.cmp-table .cmp-col .cmp-row:not(.cmp-gh) .cmp-row-label').first().innerText()).trim();
      assert(firstLabel === '冲刺速度', `属性表首行文案应为「冲刺速度」（实际「${firstLabel}」）`);

      // 吸顶雷达条：滚过雷达区后出现。临时把视口压到 1440×500 —— 1440×900 下雷达区到页尾的距离
      // 不足条子自身的 140px 「页尾保护区」，按设计根本不出现，几何上无法验证；压矮后窗口（雷达已
      // 出视口、又没到页尾）才存在。宽度不变 ⇒ 不触发窄屏分支。
      await page.setViewportSize({ width: 1440, height: 500 });
      const sticky = await page.evaluate(async () => {
        window.scrollTo(0, 0);
        await new Promise((r) => requestAnimationFrame(r));
        const zone = document.querySelector('.cmp-radarzone');
        const bar = document.querySelector('.cmp-stickybar');
        if (!zone || !bar) return null;
        const absBottom = Math.ceil(zone.getBoundingClientRect().bottom + window.scrollY);
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo(0, Math.min(absBottom + 30, maxScroll));
        await new Promise((r) => setTimeout(r, 250));
        return {
          absBottom,
          scrollY: window.scrollY,
          atEnd: window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 140,
          on: bar.classList.contains('cmp-stickybar-on'),
          visibility: getComputedStyle(bar).visibility,
        };
      });
      assert(sticky, '2 人态缺吸顶条或雷达区节点');
      assert(!sticky.atEnd, `吸顶条探针落到页尾保护区（scrollY=${sticky.scrollY}）——几何不具备，断言不可信`);
      assert(sticky.on && sticky.visibility === 'visible', `滚过雷达区后吸顶条未出现（${JSON.stringify(sticky)}）`);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.evaluate(() => window.scrollTo(0, 0));

      // 3) 3 人态：3 张身份卡 + 三张并排小雷达；热区图占位与大雷达都不该出现（分支互斥）
      await page.goto(`${BASE}/players/compare?ids=${A},${B},${C}`, { waitUntil: 'networkidle' });
      await page.locator('.cmp-radar3').waitFor({ timeout: TIMEOUT });
      assert((await page.locator('.cmp-ids > .cmp-card').count()) === 3, '3 人态应有 3 张身份卡');
      assert((await page.locator('.cmp-radar3 .cmp-radar-small').count()) === 3, '3 人态应有 3 张并排小雷达');
      assert((await page.locator('.cmp-radar3 polygon.cmp-radar-data').count()) === 3, '三张小雷达应各带 1 条数据多边形');
      assert((await page.locator('.cmp-heat').count()) === 0, '3 人态不该出热区图占位');
      assert((await page.locator('.cmp-radar-big').count()) === 0, '3 人态不该出大雷达');
      assert((await page.locator('.cmp-table').count()) === 1, '3 人态也应渲染属性对照表');

      // 4) 处理链降级：非法 / 重复 / 超限各自提示，页面照常渲染取前 3 位，被丢弃的第 4 人不发请求
      let dReqs = 0;
      const onReq = (r) => {
        try {
          if (new URL(r.url()).pathname === `/api/players/${D}`) dReqs += 1;
        } catch {
          /* 非 URL 形状的请求不计 */
        }
      };
      page.on('request', onReq);
      try {
        await page.goto(`${BASE}/players/compare?ids=abc,${A},${A},${B},${C},${D}`, { waitUntil: 'networkidle' });
        await page.locator('.cmp-table').waitFor({ timeout: TIMEOUT });
        const noticeText = await page.locator('.cmp-notices').innerText();
        for (const phrase of ['已忽略 1 个无效 id', '重复的球员已自动去重', '最多同时对比 3 人，已只取前 3 位']) {
          assert(noticeText.includes(phrase), `降级提示缺「${phrase}」（实际：${noticeText.replace(/\s+/g, ' ')}）`);
        }
        assert((await page.locator('.cmp-ids > .cmp-card').count()) === 3, '降级后仍应渲染 3 人');
        assert((await page.locator('.cmp-state.cmp-error, .cmp-state.cmp-empty').count()) === 0, '降级名单不该落空态/错误态');
      } finally {
        page.off('request', onReq);
      }
      assert(dReqs === 0, `被超限丢弃的 id ${D} 仍发起了 ${dReqs} 次请求（请求数应恒 ≤3）`);

      // 5) 库内勾选：?compare= 预勾选 1 人（按钮态）→ 再勾一人 → 「对比（2）」可点并真跳
      await page.goto(`${BASE}/players?compare=${A}`, { waitUntil: 'domcontentloaded' });
      await page.locator('.library-shell').first().waitFor({ timeout: TIMEOUT });
      await page.locator('.library-main tbody tr, .library-main .empty-state').first().waitFor({ timeout: TIMEOUT });
      const pickbar = page.locator('.lib-pickbar');
      await pickbar.waitFor({ timeout: TIMEOUT });
      const barCount = async () => (await pickbar.locator('.lib-pickbar-count').innerText()).replace(/\s+/g, '');
      assert((await barCount()) === '已选1/3', `收集栏预勾选计数不对（${await barCount()}）`);
      assert((await page.locator('.lib-pick-input:checked').count()) === 1, '?compare= 应预勾选 1 人');
      const go1 = pickbar.locator('.lib-pickbar-go');
      assert((await go1.evaluate((el) => el.tagName)) === 'BUTTON', '不足 2 人时对比控件应是按钮');
      assert(await go1.isDisabled(), '不足 2 人时「对比（1）」应禁用');
      await page.locator('.lib-pick-input:not(:checked)').first().click();
      await page.waitForFunction(
        () => document.querySelector('.lib-pickbar-count')?.textContent?.replace(/\s+/g, '') === '已选2/3',
        null,
        { timeout: TIMEOUT },
      );
      assert((await page.locator('.lib-pick-input:checked').count()) === 2, '勾第二个后应共 2 个勾选');
      const go2 = pickbar.locator('.lib-pickbar-go');
      assert((await go2.evaluate((el) => el.tagName)) === 'A', '满 2 人后对比控件应为链接');
      assert((await go2.innerText()).replace(/\s+/g, '') === '对比（2）', `对比按钮文案不对（${await go2.innerText()}）`);
      const goHref = await go2.getAttribute('href');
      assert(goHref && goHref.startsWith('/players/compare?ids='), `对比链接 href 不对（${goHref}）`);
      await go2.click();
      await page.locator('.cmp-page').waitFor({ timeout: TIMEOUT });
      await page.locator('.cmp-table').waitFor({ timeout: TIMEOUT });
      assert((await page.locator('.cmp-ids > .cmp-card').count()) === 2, '库内收集 2 人后进入对比页应为 2 人态');
      assert((await page.locator('.cmp-radarzone .cmp-heat').count()) === 2, '2 人态热区图占位缺失（库入口路径）');

      // 6) 本场景错误口径（照 ⑪）：无新增未捕获前端错误、/api/players 无非 2xx
      const newErrs = pageErrors.slice(errBefore);
      assert(newErrs.length === 0, `⑤f 期间捕获 ${newErrs.length} 条前端错误：\n  ${newErrs.slice(0, 5).join('\n  ')}`);
      const badPlayers = badResponses.slice(badBefore).filter((l) => l.includes('/api/players'));
      assert(badPlayers.length === 0, `⑤f 期间 /api/players 出现非预期失败：\n  ${badPlayers.slice(0, 5).join('\n  ')}`);
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

    await check('⑧ 球员库三视口：宽屏表格左栏 / 窄屏抽屉 + 铭牌卡（截图落 scratch/）', async () => {
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
        // 等名册落地再截：否则截到「正在翻名册…」的空表格（空库时等空态）。
        // v6.19.0：≤900px 整表换成铭牌卡网格（tbody 不存在），等待目标按断点分流。
        if (width <= 900) {
          await page.locator('.library-main .lib-cards .lib-card').first().waitFor({ timeout: TIMEOUT });
        } else {
          await page.locator('.library-main tbody tr, .library-main .empty-state').first().waitFor({ timeout: TIMEOUT });
        }
        const side = page.locator('.library-side');
        if (width <= 900) {
          // v6.19.0 卡片化：首卡要有姓名与 CA/PA（数值 + 小标），表格整块不在，排序行在、显示列不在
          const cards = page.locator('.library-main .lib-cards .lib-card');
          assert((await cards.count()) > 0, `${label}：窄屏没有渲染铭牌卡`);
          const firstCard = cards.first();
          assert((await firstCard.locator('.lib-card-name').innerText()).trim() !== '', `${label}：首卡姓名是空的`);
          assert((await firstCard.locator('.lib-card-ca').innerText()).trim() !== '', `${label}：首卡 CA 是空的`);
          assert((await firstCard.locator('.lib-card-pa').innerText()).trim() !== '', `${label}：首卡 PA 是空的`);
          assert((await firstCard.locator('.lib-card-lab').count()) >= 2, `${label}：首卡缺 CA/PA 小标`);
          assert((await page.locator('.library-main table').count()) === 0, `${label}：窄屏不应再有表格`);
          assert(await page.locator('.lib-sortrow').isVisible(), `${label}：窄屏排序行不可见`);
          // 「显示列」窄屏隐藏（列概念只属于桌面表格）；「位置」那一行仍要在（筛选抽屉里最主要的控件）
          assert(
            !(await page.locator('.library-side button.multiselect', { hasText: '显示列' }).isVisible()),
            `${label}：显示列多选在窄屏应隐藏`,
          );
          assert(
            await page.locator('.library-side button.multiselect', { hasText: '位置' }).first().isVisible(),
            `${label}：位置多选在窄屏不应被连坐隐藏`,
          );
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
          // v6.19.0 反向断言：卡片网格与窄屏排序行只在窄屏渲染，宽屏 DOM 零变化
          assert((await page.locator('.lib-cards').count()) === 0, `${label}：宽屏不应出现卡片网格`);
          assert((await page.locator('.lib-sortrow').count()) === 0, `${label}：宽屏不应出现窄屏排序行`);
          assert(
            await page.locator('.library-side button.multiselect', { hasText: '显示列' }).isVisible(),
            `${label}：宽屏显示列多选应可见`,
          );
        }
        // 多选下拉（v3.1.1 步骤 6）：左栏/抽屉里都要能打开、整块落在视口内、并且真的点得到
        await openPanel('位置');
        const pos = await panelProbe();
        assertPanel(label, '位置', pos);
        await closePanel();

        // 同行控件对齐（v3.1.1 步骤 1）：工具条一行、左栏一行，逐对量 top/bottom
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

        // 表格不折行的口径只在宽屏有表格可量（窄屏是卡片网格，探针会量到空集）
        if (width > 900) assertTableNoWrap(label, await tableLayoutProbe());

        const shot = join(SHOT_DIR, `e2e-players-${label}.png`);
        await page.screenshot({ path: shot, fullPage: false });
        shots.push(shot);

        // 窄屏排序行换键（放在截图之后，别让重取的中间态进截图）：URL 要带上 sort=，
        // 换完键卡片还要回来。selectOption('ca') 选固定键 CA：窄屏已豁免「排序列不可见就撤回
        // 默认」那条 effect，动态列键同样留得住，但固定列键最稳、探针量不到这层。
        if (width <= 900) {
          await page.locator('.lib-sortrow select').selectOption('ca');
          await page.waitForFunction(() => location.search.includes('sort='), null, { timeout: TIMEOUT });
          assert(page.url().includes('sort='), `${label}：窄屏换排序键后 URL 未带 sort=（${page.url()}）`);
          await page.locator('.library-main .lib-cards .lib-card').first().waitFor({ timeout: TIMEOUT });
        }
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      console.log(`   截图：${shots.map((s) => s.replace(/\\/g, '/')).join(' / ')}`);
    });

    // ---- 球队页（v3.4.0）----
    // 本地 TOUR_DB（whl）的 team 表是旧 schema（没有 logo_key / club_id）⇒ GET /api/clubs 与
    // GET /api/clubs/:id 在本机必然 500。后端响应形状与读量已由单测与 scripts/d1-read-audit/ 覆盖，
    // 这一组要验的是**真浏览器里的渲染与几何**——分段卡片、整卡可点、结构图不溢出、窄屏不出横向
    // 滚动——jsdom 量不到这些。所以只给球队页的读端点打桩回夹具，其余请求（会话、媒体、球员库）
    // 仍走真服务端。/api/me/club 一并打桩，造出「非教练观众」与「取不到」两种受控情形。
    const CLUB_ROUTES = [
      /\/api\/clubs(\?|$)/,
      /\/api\/clubs\/1\/standing/,
      /\/api\/clubs\/1(\?|$)/,
      /\/api\/players\?/,
      /\/api\/me\/club(\?|$)/,
    ];

    await check('⑨ 球队页三视口：列表分段 / 详情三页签逐一点开 / 结构图不溢出（截图落 scratch/）', async () => {
      const clubsFixture = {
        clubs: [
          { id: 1, name: '阿森纳', isCpu: false, tier: 'premier', logoKey: null, squad: { senior: 5, trainee: 1 }, avgCa: 78.4, totalValue: 412.5, totalWage: 33.4 },
          { id: 73, name: '巴黎圣日耳曼', isCpu: false, tier: 'premier', logoKey: null, squad: { senior: 4, trainee: 0 }, avgCa: 80.1, totalValue: 502.25, totalWage: 41.2 },
          { id: 241, name: '巴塞罗那', isCpu: true, tier: 'second', logoKey: null, squad: { senior: 3, trainee: 2 }, avgCa: null, totalValue: null, totalWage: 9.5 },
          { id: 131681, name: 'AC米兰', isCpu: true, tier: null, logoKey: null, squad: { senior: 2, trainee: 0 }, avgCa: 61.2, totalValue: 20.75, totalWage: 1.25 },
        ],
      };
      // 档位故意给不等的人数：柱高按「最高档」归一 ⇒ 最高档必然占满轨道，高度算错这条才量得出来。
      // CA 各档之和 = 阵容人数（6）⇒ 条长之和恰好 100%；最高档只占 33%，若有人改成「按最大档
      // 归一」宽度会变 100%，这条断言就会红。
      const detailFixture = {
        club: { id: 1, name: '阿森纳', isCpu: false, tier: 'premier', logoKey: null },
        squad: {
          size: 6, senior: 5, trainee: 1, avgCa: 78.4, maxCa: 88, avgPa: 85.2, avgGrowth: 6.8,
          totalValue: 412.5, totalWage: 33.4, avgWage: 6.68, badgesSilver: 9, badgesGold: 2,
          byPosition: [
            { key: 'GK', label: '门将', count: 1, detail: 'GK 1' },
            { key: 'DF', label: '后卫', count: 2, detail: 'CB 2' },
            { key: 'MF', label: '中场', count: 2, detail: 'CM 1 · CDM 1' },
            { key: 'FW', label: '前锋', count: 1, detail: 'ST 1' },
          ],
          byAge: [
            { key: 'u18', label: '≤18', count: 1 },
            { key: '19-21', label: '19–21', count: 1 },
            { key: '22-24', label: '22–24', count: 2 },
            { key: '25-27', label: '25–27', count: 1 },
            { key: '28-30', label: '28–30', count: 1 },
            { key: '31+', label: '≥31', count: 0 },
          ],
          byCa: [
            { key: '90+', label: '90+', count: 0 },
            { key: '85-89', label: '85–89', count: 1 },
            { key: '80-84', label: '80–84', count: 2 },
            { key: '70-79', label: '70–79', count: 2 },
            { key: 'u70', label: '<70', count: 1 },
          ],
        },
        contracts: {
          signed: 6, unprotected: 2, protectedCount: 4, avgYears: 2.5,
          byYears: [
            { key: 'le05', label: '0.5 赛季内', count: 1 },
            { key: '1-15', label: '1–1.5 赛季', count: 2 },
            { key: '2-25', label: '2–2.5 赛季', count: 3 },
            { key: '3+', label: '3 赛季及以上', count: 0 },
          ],
        },
        transfers: {
          incoming: [
            { id: 11, type: 'transfer', playerId: 5, playerName: '新援甲', fromClubId: 73, fromClubName: '巴黎圣日耳曼', toClubId: 1, toClubName: '阿森纳', fee: 12.5, extraFee: 1.5, season: 9, windowSeq: 1, completedAt: '2026-09-01T10:00:00Z' },
          ],
          // playerId 为 null 是真实情形（transfers.player_id 无 NOT NULL）⇒ 该格出纯文本，不能链 /players/null
          outgoing: [
            { id: 12, type: 'free_agent', playerId: null, playerName: '离队乙', fromClubId: 1, fromClubName: '阿森纳', toClubId: null, toClubName: null, fee: null, extraFee: null, season: 9, windowSeq: null, completedAt: null },
          ],
        },
        form: {
          recent: [
            { matchId: 101, season: 9, competitionType: '联赛', stageName: '常规赛', round: 7, homeTeam: '阿森纳', awayTeam: '利物浦', scoreHome: 2, scoreAway: 1, penHome: null, penAway: null, result: 'win', finishedAt: '2026-09-20T19:00:00Z' },
            // 点球大战不改 90 分钟判定 ⇒ 比分 1:1 记平，点球只做标注
            { matchId: 102, season: 9, competitionType: '联赛', stageName: '常规赛', round: 6, homeTeam: '曼城', awayTeam: '阿森纳', scoreHome: 1, scoreAway: 1, penHome: 4, penAway: 3, result: 'draw', finishedAt: '2026-09-17T19:00:00Z' },
            { matchId: 103, season: 9, competitionType: '联赛', stageName: '常规赛', round: 5, homeTeam: '阿森纳', awayTeam: '切尔西', scoreHome: 0, scoreAway: 2, penHome: null, penAway: null, result: 'loss', finishedAt: '2026-09-13T19:00:00Z' },
          ],
          wins: 1, draws: 1, losses: 1,
        },
      };
      // v6.30.0 C 段：阵容名单列集重定后，行里要读的字段补齐（号码/违约金/身价 + 转会状态三布尔），
      // 五个人恰好覆盖转会状态四态 + 空态：已标价 / 挂牌中 / 转会名单 / 非卖品 / —
      const rosterFixture = {
        players: [
          { id: 1, uid: 'fc100001', name: '门将甲', number: '1', positions: ['GK'], age: 27, ca: 80, pa: 84, status: 'normal', wage: 6.5, releaseFee: 12, marketValue: 30, transferListed: false, notForSale: false, transferPriced: false },
          { id: 2, uid: 'fc100002', name: '后卫乙', number: '4', positions: ['CB', 'LB'], age: 24, ca: 76, pa: 85, status: 'normal', wage: 5.25, releaseFee: 8, marketValue: 22, transferListed: false, notForSale: false, transferPriced: true },
          { id: 3, uid: 'fc100003', name: '中场丙', number: '8', positions: ['CM'], age: 31, ca: 74, pa: 74, status: 'listed', wage: 4.75, releaseFee: null, marketValue: 9.5, transferListed: false, notForSale: false, transferPriced: false },
          { id: 4, uid: 'fc100004', name: '前锋丁', number: null, positions: ['ST'], age: 19, ca: 65, pa: 88, status: 'trainee', wage: null, releaseFee: null, marketValue: 5, transferListed: true, notForSale: false, transferPriced: false },
          { id: 5, uid: 'fc100005', name: '边锋戊', number: '11', positions: [], age: null, ca: 61, pa: 70, status: 'normal', wage: 1.2, releaseFee: 3, marketValue: 4, transferListed: false, notForSale: true, transferPriced: false },
        ],
        nextCursor: null,
      };
      const standingFixture = {
        standing: { tournamentId: 1, stageName: '常规赛', groupName: null, position: 3, played: 7, won: 4, drawn: 1, lost: 2, goalsFor: 12, goalsAgainst: 8, pts: 13, pointsDeducted: null },
        note: null,
      };
      // 登录者是观众（club: null）⇒ 详情页不挂教练工作台；这一条不依赖本地能否读到真队
      const meClubFixture = { club: null, balance: null, squadCount: null, window: null, home: null };

      const ok = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      await page.route(CLUB_ROUTES[0], (r) => r.fulfill(ok(clubsFixture)));
      await page.route(CLUB_ROUTES[1], (r) => r.fulfill(ok(standingFixture)));
      await page.route(CLUB_ROUTES[2], (r) => r.fulfill(ok(detailFixture)));
      await page.route(CLUB_ROUTES[3], (r) => r.fulfill(ok(rosterFixture)));
      await page.route(CLUB_ROUTES[4], (r) => r.fulfill(ok(meClubFixture)));

      const docOverflow = () =>
        page.evaluate(() => {
          const d = document.documentElement;
          return { scrollW: d.scrollWidth, clientW: d.clientWidth };
        });

      const shots = [];
      const viewports = [
        [1280, 900, 'desktop'],
        [900, 800, 'tablet'],
        [375, 812, 'mobile'],
      ];
      try {
        for (const [width, height, label] of viewports) {
          await page.setViewportSize({ width, height });

          // ---- 列表页：三段分组 + CPU 标 + 整卡可点 ----
          await page.goto(`${BASE}/clubs`, { waitUntil: 'domcontentloaded' });
          await page.locator('.club-card').first().waitFor({ timeout: TIMEOUT });
          const segs = await page.locator('.club-segment').count();
          assert(segs === 3, `${label}：列表应出三段（顶级/次级/未定级），实际 ${segs} 段`);
          const cards = await page.locator('.club-card').count();
          assert(cards === clubsFixture.clubs.length, `${label}：卡片 ${cards} 张 ≠ 夹具 ${clubsFixture.clubs.length} 张`);
          const href = await page.locator('.club-card').first().getAttribute('href');
          assert(href === '/clubs/1', `${label}：整卡应链到 /clubs/1（不是卡里再放详情按钮），实际 ${href}`);
          const cpu = await page.locator('.club-card .badge', { hasText: 'CPU' }).count();
          assert(cpu === 2, `${label}：CPU 标应出 2 个，实际 ${cpu}`);
          // 没录过身价（生产现状：market_value 全 NULL）显示「—」，不能写成 0.00 m
          const barcaValue = (
            await page
              .locator('.club-card', { hasText: '巴塞罗那' })
              .locator('.club-metrics div:has(dt:text-is("总身价")) dd')
              .innerText()
          ).trim();
          assert(barcaValue === '—', `${label}：没录过身价的总身价应显示「—」，实际「${barcaValue}」`);
          const ovList = await docOverflow();
          assert(ovList.scrollW <= ovList.clientW + 1, `${label}：列表页被撑出横向滚动（${ovList.scrollW} > ${ovList.clientW}）`);
          const listShot = join(SHOT_DIR, `e2e-clubs-${label}.png`);
          await page.screenshot({ path: listShot, fullPage: false });
          shots.push(listShot);

          // ---- 详情页：页签壳 + 三组各自成页（v6.30.0 A 段）----
          // 详情页改页签式后三组不再同屏：登录者是观众（club: null）⇒ 只有三个公开页签、默认落「阵容」，
          // 三组的断言必须逐一点开再跑（覆盖不减，每条先落到它所在的页签）。
          await page.goto(`${BASE}/clubs/1`, { waitUntil: 'domcontentloaded' });
          await page.locator('.club-block').first().waitFor({ timeout: TIMEOUT });
          assert(await page.locator('h1', { hasText: '阿森纳' }).first().isVisible(), `${label}：详情页 h1 不是队名`);
          assert(
            (await page.locator('.club-block h3', { hasText: '注册工作台' }).count()) === 0,
            `${label}：登录者不是本队教练，不该看到工作台内容`,
          );
          const tabLabels = (await page.locator('.dossier-tabs button').allInnerTexts()).map((s) => s.trim());
          assert(
            tabLabels.join('/') === '阵容/转会/战绩',
            `${label}：观众只该看到三个公开页签（实际 ${tabLabels.join('/')}）——自家页签（工作台/主场）漏给访客了`,
          );
          assert(
            (await page.locator('.dossier-tabs button.on').innerText()).trim() === '阵容',
            `${label}：无 ?tab= 时应落默认页签「阵容」`,
          );
          const groups = await page.locator('.club-block h3').allInnerTexts();
          assert(groups.includes('阵容组'), `${label}：阵容页签缺「阵容组」（实际 ${groups.join('、')}）`);
          // 结构分析各出一种图，且各自在它所在的页签里：年龄 = 竖直直方图、CA = 100% 堆叠条（阵容页签）、
          // 效力 = 横向条形图（转会页签，未点开时不该渲染）
          assert((await page.locator('.club-histogram').count()) === 1, `${label}：年龄应出一张竖直直方图`);
          assert((await page.locator('.club-share-stack').count()) === 1, `${label}：CA 应出一根 100% 堆叠条`);
          assert(
            (await page.locator('.band-chart').count()) === 0,
            `${label}：效力条形图属转会页签，停在阵容页签时不该渲染（按需加载）`,
          );

          // 几何：三张图宽高都按百分比给，窄屏只该压轨道。要验的是「图不撑破卡片、图自己不出横向滚动」。
          // 别拿「条形右缘 ≤ 轨道右缘」当断言——全局 box-sizing:border-box 下那是盒模型保证的，永远为真。
          // 并排容器（.club-figures / .club-split）也一起量：网格轨道撑破卡片时图自己是不会滚的。
          // v6.30.0 A 段：.club-figures 在阵容页签、.club-split 在转会页签 ⇒ 分两次量再合并复核（总数仍 5）。
          const measureCharts = (selectors) =>
            page.evaluate((sels) => {
              const out = [];
              for (const sel of sels) {
                for (const el of document.querySelectorAll(sel)) {
                  const r = el.getBoundingClientRect();
                  const block = el.closest('.club-block');
                  const br = block ? block.getBoundingClientRect() : null;
                  out.push({
                    sel,
                    left: r.left,
                    right: r.right,
                    blockLeft: br ? br.left : null,
                    blockRight: br ? br.right : null,
                    scrollW: el.scrollWidth,
                    clientW: el.clientWidth,
                  });
                }
              }
              return out;
            }, selectors);
          const charts = await measureCharts(['.club-figures', '.club-histogram', '.club-share-plot']);
          assert(charts.length === 3, `${label}：阵容页签应量到 3 个结构分析容器，实际 ${charts.length}`);

          // 直方图柱高确实按「人数 / 最高档人数」算：最高档占满轨道、0 人档不出柱。
          // 轨道有 1px 下边框（box-sizing 下算进 128px 高度），故留 3% 容差。
          const hist = await page.evaluate(() => {
            const el = document.querySelector('.club-histogram');
            if (!el) return null;
            return [...el.querySelectorAll('.club-hist-col')].map((c) => {
              const track = c.querySelector('.club-hist-track').getBoundingClientRect();
              const bar = c.querySelector('.club-hist-bar').getBoundingClientRect();
              return { ratio: track.height > 0 ? bar.height / track.height : -1, count: Number(c.querySelector('.club-hist-count').textContent) };
            });
          });
          assert(hist !== null && hist.length === detailFixture.squad.byAge.length, `${label}：直方图列数 ≠ 夹具档数`);
          const histMax = Math.max(...detailFixture.squad.byAge.map((b) => b.count));
          for (let i = 0; i < hist.length; i += 1) {
            const want = detailFixture.squad.byAge[i].count / histMax;
            assert(Math.abs(hist[i].ratio - want) <= 0.03, `${label}：直方图第 ${i + 1} 档柱高 ${hist[i].ratio.toFixed(3)} ≠ 期望 ${want.toFixed(3)}`);
            assert(hist[i].count === detailFixture.squad.byAge[i].count, `${label}：直方图第 ${i + 1} 档柱顶人数不符`);
          }

          // CA 堆叠条：段宽分母是全队人数（不是「最大档」——夹具最高档只占 33%），
          // 0 人的档不画段（画 0 宽段没有意义），图例五档恒出并给人数与占比。
          const share = await page.evaluate(() => {
            const stack = document.querySelector('.club-share-stack');
            if (!stack) return null;
            const track = stack.getBoundingClientRect();
            const segs = [...stack.querySelectorAll('.club-share-seg')].map((s) => {
              const r = s.getBoundingClientRect();
              return track.width > 0 ? r.width / track.width : -1;
            });
            const legend = [...document.querySelectorAll('.club-share-legend-row')].map((row) => ({
              title: row.getAttribute('title'),
              value: row.querySelector('.club-share-legend-value').textContent,
            }));
            return { segs, legend };
          });
          assert(share !== null && share.legend.length === detailFixture.squad.byCa.length, `${label}：CA 图例行数 ≠ 夹具档数`);
          const caNonZero = detailFixture.squad.byCa.filter((b) => b.count > 0);
          assert(share.segs.length === caNonZero.length, `${label}：CA 段数 ${share.segs.length} ≠ 非零档数 ${caNonZero.length}`);
          for (let i = 0; i < share.segs.length; i += 1) {
            const b = caNonZero[i];
            const want = b.count / detailFixture.squad.size;
            assert(Math.abs(share.segs[i] - want) <= 0.02, `${label}：CA「${b.label}」段宽 ${(share.segs[i] * 100).toFixed(1)}% ≠ 期望 ${(want * 100).toFixed(1)}%`);
          }
          for (let i = 0; i < share.legend.length; i += 1) {
            const b = detailFixture.squad.byCa[i];
            const pct = Math.round((b.count / detailFixture.squad.size) * 100);
            assert(share.legend[i].title === `${b.label}：${b.count} 人 · 占全队 ${pct}%`, `${label}：CA「${b.label}」图例 title 不符（${share.legend[i].title}）`);
            assert(share.legend[i].value === `${b.count} 人 · ${pct}%`, `${label}：CA「${b.label}」图例人数不符（${share.legend[i].value}）`);
          }
          // 刻度轴末位「100%」是绝对定位 + translateX(-100%)，可能戳出图外（盒模型管不到）。
          // 窄屏（≤640px）中间三条刻度是 display:none，它们的 rect 是原点上的 0×0 —— 必须先跳过，
          // 否则「0 < 图左缘」会把隐藏元素判成溢出。
          const axisOut = await page.evaluate(() => {
            const el = document.querySelector('.club-share-plot');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return [...el.querySelectorAll('.club-share-tick')]
              .filter((t) => {
                const tr = t.getBoundingClientRect();
                if (tr.width === 0 && tr.height === 0) return false; // display:none
                return tr.left < r.left - 1 || tr.right > r.right + 1;
              })
              .map((t) => t.textContent);
          });
          assert(axisOut !== null && axisOut.length === 0, `${label}：占比刻度戳出图外：${JSON.stringify(axisOut)}`);

          // 位置分布：四档纯文字、一行收束（按裁决不用图示），四档恒出
          // v6.30.0 A 段：原来的三列 dl.club-position-list 改成一行 .club-position-line
          const pos = (await page.locator('.club-position-line').innerText()).replace(/\s+/g, ' ').trim();
          assert(
            pos === detailFixture.squad.byPosition.map((b) => `${b.label} ${b.count} 人`).join(' · '),
            `${label}：位置分布一行文字不符（实际「${pos}」）`,
          );
          assert(
            (await page.locator('.club-position-line .band-bar, .club-position-line .club-hist-bar, .club-position-line .club-share-seg').count()) === 0,
            `${label}：位置分布按裁决不用图示，不该出现条`,
          );
          // 阵容名单表（运营组那两张是 .transfer-table，要排除）
          const rows = await page.locator('.club-block .table-wrap table:not(.transfer-table) tbody tr').count();
          assert(rows === rosterFixture.players.length, `${label}：阵容名单 ${rows} 行 ≠ 夹具 ${rosterFixture.players.length} 行`);
          // v6.30.0 C 段：11 列固定列序 + 转会状态图标列（只出图标）+ 表下图例 + 「列」开关（写 ?cols=）
          const squadTable = '.club-block .table-wrap table:not(.transfer-table)';
          const heads = (await page.locator(`${squadTable} thead th`).allInnerTexts()).map((t) => t.trim());
          assert(
            heads.join('|') === ['标记', '号码', 'UID', '姓名', '年龄', '位置', 'CA', 'PA', '违约金', '工资', '转会状态'].join('|'),
            `${label}：阵容名单表头不符（${heads.join('|')}）`,
          );
          const gloss = await page.locator(`${squadTable} thead th`).last().getAttribute('title');
          assert(
            gloss === '拍卖锤 挂牌中 · 清单 转会名单 · 欧元 已标价 · 锁 非卖品',
            `${label}：转会状态表头缺整张词表（${gloss}）`,
          );
          const wantStatus = [null, '已标价', '挂牌中', '转会名单', '非卖品'];
          const statusCells = await page
            .locator(`${squadTable} tbody tr td:nth-child(11) .transfer-status`)
            .evaluateAll((els) =>
              els.map((e) => ({
                title: e.getAttribute('title'),
                text: (e.textContent ?? '').trim(),
                icons: e.querySelectorAll('svg').length,
              })),
            );
          assert(statusCells.length === wantStatus.length, `${label}：转会状态格 ${statusCells.length} 个 ≠ 夹具 ${wantStatus.length} 行`);
          statusCells.forEach((cell, i) => {
            const want = wantStatus[i];
            assert(cell.title === want, `${label}：第 ${i + 1} 行转会状态 title「${cell.title}」≠「${want}」`);
            assert(cell.icons === (want === null ? 0 : 1), `${label}：第 ${i + 1} 行转会状态图标 ${cell.icons} 枚（${want ?? '空态'}）`);
            assert(cell.text === (want === null ? '—' : ''), `${label}：第 ${i + 1} 行转会状态格多出文字「${cell.text}」（只该出图标）`);
          });
          const legend = (await page.locator('.transfer-status-legend .transfer-legend-item').allInnerTexts()).map((t) =>
            t.replace(/\s+/g, ' ').trim(),
          );
          assert(
            legend.join(' · ') === '拍卖锤 挂牌中 · 清单 转会名单 · 欧元 已标价 · 锁 非卖品',
            `${label}：转会状态图例不符（${legend.join(' · ')}）`,
          );
          // 「列」开关：勾选写进 ?cols= 且列立刻出现，再点一次收回去（别把下面的横向溢出断言带歪）
          await page.locator('.club-block .multiselect').first().click();
          const colItem = page.locator('.multiselect-panel .multiselect-item', { hasText: '身价' }).first();
          await colItem.click();
          await page.locator(`${squadTable} thead th`).nth(11).waitFor({ timeout: TIMEOUT });
          assert(page.url().includes('cols=marketValue'), `${label}：勾选可选列没写进 ?cols=（${page.url()}）`);
          await colItem.click();
          await page.locator(`${squadTable} thead th`).nth(11).waitFor({ state: 'detached', timeout: TIMEOUT });
          assert(!page.url().includes('cols='), `${label}：取消勾选后 ?cols= 没清掉（${page.url()}）`);
          assert((await page.locator(`${squadTable} thead th`).count()) === 11, `${label}：取消勾选后列数 ≠ 11`);
          const ovSquad = await docOverflow();
          assert(ovSquad.scrollW <= ovSquad.clientW + 1, `${label}：阵容页签被撑出横向滚动（${ovSquad.scrollW} > ${ovSquad.clientW}）`);

          // ---- 转会页签：运营组（含效力条形图）----
          await page.locator('.dossier-tabs button', { hasText: '转会' }).first().click();
          await page.locator('.transfer-table').first().waitFor({ timeout: TIMEOUT });
          assert(
            (await page.locator('.dossier-tabs button.on').innerText()).trim() === '转会',
            `${label}：点页签后没切到转会`,
          );
          const opGroups = await page.locator('.club-block h3').allInnerTexts();
          assert(opGroups.includes('运营组'), `${label}：转会页签缺「运营组」（实际 ${opGroups.join('、')}）`);
          assert(
            (await page.locator('.band-chart').count()) === 1,
            `${label}：转会页签应出一张效力横向条形图`,
          );
          charts.push(...(await measureCharts(['.club-split', '.band-chart'])));
          assert(
            charts.length === 5,
            `${label}：阵容 + 转会两个页签合计应量到 5 个结构分析容器，实际 ${charts.length}`,
          );
          const chartOut = charts.filter((c) => c.blockRight === null || c.right > c.blockRight + 1 || c.left < c.blockLeft - 1);
          assert(chartOut.length === 0, `${label}：有结构图超出所在卡片 ${JSON.stringify(chartOut)}`);
          const chartScroll = charts.filter((c) => c.scrollW > c.clientW + 1);
          assert(chartScroll.length === 0, `${label}：有结构图自身出了横向滚动 ${JSON.stringify(chartScroll)}`);
          assert((await page.locator('.transfer-table').count()) === 2, `${label}：转入/转出两张表都应渲染`);
          assert((await page.locator('a[href="/players/null"]').count()) === 0, `${label}：playerId 为空时链出了 /players/null`);
          const ovTransfers = await docOverflow();
          assert(
            ovTransfers.scrollW <= ovTransfers.clientW + 1,
            `${label}：转会页签被撑出横向滚动（${ovTransfers.scrollW} > ${ovTransfers.clientW}）`,
          );

          // ---- 战绩页签：排名 + 近期战绩 ----
          await page.locator('.dossier-tabs button', { hasText: '战绩' }).first().click();
          await page.locator('.form-list').first().waitFor({ timeout: TIMEOUT });
          const resGroups = await page.locator('.club-block h3').allInnerTexts();
          assert(resGroups.includes('战绩组'), `${label}：战绩页签缺「战绩组」（实际 ${resGroups.join('、')}）`);
          assert(
            (await page.locator('.form-list .form-row').count()) === detailFixture.form.recent.length,
            `${label}：近期战绩行数 ≠ 夹具`,
          );
          assert(await page.locator('.badge', { hasText: '联赛第 3 名' }).first().isVisible(), `${label}：排名徽章缺失`);
          const ovResults = await docOverflow();
          assert(
            ovResults.scrollW <= ovResults.clientW + 1,
            `${label}：战绩页签被撑出横向滚动（${ovResults.scrollW} > ${ovResults.clientW}）`,
          );
          const detailShot = join(SHOT_DIR, `e2e-clubs-detail-${label}.png`);
          await page.screenshot({ path: detailShot, fullPage: false });
          shots.push(detailShot);
        }
        await page.setViewportSize({ width: 1440, height: 900 });
        console.log(`   截图：${shots.map((s) => s.replace(/\\/g, '/')).join(' / ')}`);
      } finally {
        for (const pattern of CLUB_ROUTES) await page.unroute(pattern);
      }
    });

    await check('⑩ 球队页：匿名看详情给登录引导且不泄露；/club 取不到球队时不误跳 /bind', async () => {
      // 匿名这条要先把 /api/me 钉住：本地 AUTH_MODE=oidc 时匿名进站会先被「无感同步登录态」探针
      // （web/src/lib/auth.tsx:23 的 syncProbe）整页跳去 /api/auth/sync，本机认证中心不在接入名单
      // ⇒ 停在登录错误页，RequireUser 那条分支根本走不到。钉成 shared 模式的匿名响应（无 syncProbe）
      // 才落回真实的守卫分支。
      const anon = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      try {
        const ap = await anon.newPage();
        await ap.route(/\/api\/me(\?|$)/, (r) =>
          r.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ user: null, authMode: 'shared', authHome: null }),
          }),
        );
        await ap.goto(`${BASE}/clubs/1`, { waitUntil: 'networkidle' });
        const t = await ap.locator('body').innerText();
        assert(t.includes('这个页面要登录后才能用'), `匿名看 /clubs/1 没给登录引导：${t.slice(0, 120)}`);
        // 只数 .club-block 是弱断言（未打桩时真身 401 ⇒ ClubDetail 只渲染错误横幅，也是 0）。
        // 同时钉住「没有错误横幅」，才能把「被守卫挡下」与「加载失败」分开。
        assert((await ap.locator('.club-block').count()) === 0, '匿名看 /clubs/1 竟然渲染出了球队内容');
        assert((await ap.locator('.banner').count()) === 0, '匿名看 /clubs/1 出了错误横幅，不是被守卫挡下');
        // 列表页是公开的：不给球队端点设桩，接口 500 也要能看到页面壳 —— 证它不在守卫后面
        await ap.goto(`${BASE}/clubs`, { waitUntil: 'networkidle' });
        assert(await ap.locator('h1', { hasText: '球队' }).first().isVisible(), '匿名看 /clubs 被拦下了（列表本该公开）');
      } finally {
        await anon.close();
      }

      // 已登录但 /api/me/club 取不到：必须停在原地报错。跳 /bind 会把绑着队的教练送去写着
      // 「一账号只能绑一支队」的登记页 —— 这正是评审修掉的那个误判，只有真浏览器能端到端验。
      // 这里自己桩出 500，同时自己把这个噪声行收走（不留给 ⑪ 的白名单兜底），并断言桩真被请求到：
      // 否则「取不到」这条路径可能一次都没走到，而横幅断言靠别的原因也能绿。
      let meClubHits = 0;
      const onMeClub = (r) => {
        if (new URL(r.url()).pathname === '/api/me/club') meClubHits += 1;
      };
      page.on('request', onMeClub);
      const badBefore = badResponses.length;
      await page.route(CLUB_ROUTES[4], (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"取不到"}' }));
      try {
        await page.goto(`${BASE}/club`, { waitUntil: 'networkidle' });
        assert(
          new URL(page.url()).pathname === '/club',
          `/club 在取不到球队信息时不该跳走（实际落到 ${page.url()}）`,
        );
        assert((await text()).includes('球队信息暂时取不到'), '/club 取不到球队信息时没出报错横幅');
        assert(meClubHits >= 1, '/club 这次没真去请求 /api/me/club，失败分支没被走到');
      } finally {
        await page.unroute(CLUB_ROUTES[4]);
        page.off('request', onMeClub);
        // 自己桩的 500 自己认领，别依赖 ⑪ 的已知噪声白名单（那是隐式耦合）
        const mine = badResponses.slice(badBefore).filter((line) => line.includes('/api/me/club'));
        for (const line of mine) badResponses.splice(badResponses.indexOf(line), 1);
      }
    });

    await check('⑪ 无未捕获前端错误', async () => {
      // 本地 TOUR_DB（whl）的 team 表是旧 schema（无 logo_key / club_id）⇒ 读赛事库的这几个
      // 端点必然 500 —— 那是环境噪声，不是本仓库的回归；换成有数据的环境自然会通过。
      // 其余任何 4xx/5xx 仍然报错。（⑩ 自己桩的 500 已由 ⑩ 自己收走，不靠这里兜底。）
      const noise = new Set([...badResponses].filter(isKnownNoise));
      const unexpected = [...new Set(badResponses)].filter((line) => !noise.has(line));
      if (noise.size) console.log(`   已知环境噪声（本地 TOUR_DB 旧 schema）：${[...noise].join(' / ')}`);
      assert(
        pageErrors.length === 0,
        `捕获到 ${pageErrors.length} 条：\n  ${pageErrors.slice(0, 5).join('\n  ')}`,
      );
      assert(unexpected.length === 0, `出现非预期失败请求：\n  ${unexpected.slice(0, 5).join('\n  ')}`);
    });

    // ---- v6.20.0：全站保底 + 管理抽屉 ----
    // ⑫⑬ 放在 ⑪ 之后是有意的：扫描会踩过本地 TOUR_DB 旧 schema 的已知 500（EMPTY_TOUR_DB_PATHS
    // 之外还有一批 admin 读端点），若放在 ⑪ 之前就得逐条进白名单；放在 ⑪ 之后，⑪ 断言已定格，
    // 这些噪声自然不参与判定。

    await check('⑫ 全路由 375×812 零溢出扫描（公开 + 登录 + admin 11 子页）', async () => {
      await page.setViewportSize({ width: 375, height: 812 });
      // 路由清单 = App.tsx 全量注册（v6.20.0 spec §3 的保底口径）：/clubs/1、/players/1 是两个
      // 详情取样。本地读端点 500 的页面会落错误横幅——壳照样渲染，横滚照样要量，失败横幅不豁免。
      // 详情取样 id 从列表 API 首行取（评审 P2-3：不硬编码——硬编码 id 在种子数据缺行时会扫到空/错态假绿）
      const ids = await page.evaluate(async () => {
        const out = { player: '1', club: '1', notes: [] };
        try {
          const r = await fetch('/api/players?limit=1');
          if (r.ok) {
            const j = await r.json();
            if (j.players?.[0]?.fcId != null) out.player = String(j.players[0].fcId);
            else out.notes.push('players 列表空，/players/:id 用兜底 1');
          } else out.notes.push(`/api/players ${r.status}，/players/:id 用兜底 1`);
        } catch { out.notes.push('players 列表取首行失败，/players/:id 用兜底 1'); }
        try {
          const r = await fetch('/api/clubs');
          if (r.ok) {
            const j = await r.json();
            if (j.clubs?.[0]?.id != null) out.club = String(j.clubs[0].id);
            else out.notes.push('clubs 目录空，/clubs/:id 用兜底 1');
          } else out.notes.push(`/api/clubs ${r.status}，/clubs/:id 用兜底 1`);
        } catch { out.notes.push('clubs 目录取首行失败，/clubs/:id 用兜底 1'); }
        return out;
      });
      for (const note of ids.notes) console.log(`   ⑫ 备注：${note}`);
      const ROUTES = [
        '/', '/players', `/players/${ids.player}`, '/clubs', `/clubs/${ids.club}`, '/bind',
        '/market', '/market/board', '/market/free', '/market/activation', '/market/intel', '/market/desk',
        '/shop', '/club', '/ledger', '/notifications',
        '/admin', '/admin/seasons', '/admin/players', '/admin/growth', '/admin/imports',
        '/admin/market', '/admin/clubs', '/admin/clubs/cpu-convert', '/admin/brands', '/admin/events', '/admin/shop', '/admin/finance',
        '/admin/system',
      ];
      const bad = [];
      for (const route of ROUTES) {
        await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
        const ov = await page.evaluate(() => {
          const d = document.documentElement;
          return { scrollW: d.scrollWidth, clientW: d.clientWidth };
        });
        console.log(`   ${route}：${ov.scrollW}/${ov.clientW}`);
        if (ov.scrollW > ov.clientW + 1) bad.push(`${route}（${ov.scrollW} > ${ov.clientW}）`);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      assert(bad.length === 0, `${bad.length}/${ROUTES.length} 个路由在 375 宽下撑破文档：${bad.join('、')}`);
    });

    await check('⑬ 管理端窄屏抽屉：开合 / Esc / 路由自动关 / 遮罩关；宽屏零变化', async () => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`${BASE}/admin/clubs`, { waitUntil: 'networkidle' });
      // 关着的抽屉是 translateX(-105%)，仍有 boundingBox ⇒ 用 x 判在场，不能用 isVisible（⑧ 同款）
      const sideX = () =>
        page.evaluate(() => document.querySelector('.admin-sidebar')?.getBoundingClientRect().x ?? null);
      const sideOffscreen = () =>
        page.waitForFunction(
          () => {
            const el = document.querySelector('.admin-sidebar');
            return !!el && el.getBoundingClientRect().x < 0;
          },
          null,
          { timeout: TIMEOUT },
        );
      const toggle = page.locator('button.admin-nav-toggle');
      assert(await toggle.isVisible(), '窄屏没有渲染导航切换钮');
      assert(!(await page.locator('.admin-drawer-mask').isVisible().catch(() => false)), '抽屉关着时不应有遮罩');
      const closedX = await sideX();
      assert(closedX === null || closedX < 0, `抽屉关着时应移出视口（x=${closedX}）`);

      // 点钮开：滑入 + .open 类 + 锁滚 + 焦点落在关闭钮（与球员库抽屉同款契约）
      await toggle.click();
      await page.locator('.admin-drawer-mask').waitFor({ timeout: TIMEOUT });
      await page.waitForFunction(
        () => {
          const el = document.querySelector('.admin-sidebar');
          return !!el && el.getBoundingClientRect().x >= 0;
        },
        null,
        { timeout: TIMEOUT },
      );
      assert((await page.locator('.admin-sidebar.open').count()) === 1, '开态应有 .open 类');
      assert(
        (await page.evaluate(() => document.body.style.overflow)) === 'hidden',
        '抽屉开着时背景未锁滚',
      );
      const focused = await page.evaluate(() => document.activeElement?.className ?? 'null');
      assert(
        String(focused).includes('admin-drawer-close'),
        `打开抽屉后焦点应在关闭钮上（实际 ${focused}）`,
      );

      // 焦点循环（TC-DRW-08）：抽屉内可聚焦元素 12 链接 + 关闭钮 = 13 个（v6.28.0 起侧栏 12 项），
      // 连按 13 次 Tab / 4 次 Shift+Tab 后焦点都必须仍在抽屉里
      //（焦点陷阱把 Tab 挡在侧栏 + 入口钮之内）
      for (let i = 0; i < 13; i++) await page.keyboard.press('Tab');
      assert(
        await page.evaluate(() => !!document.querySelector('.admin-sidebar')?.contains(document.activeElement)),
        'Tab 连按 13 次后焦点应仍在抽屉内',
      );
      for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+Tab');
      assert(
        await page.evaluate(() => !!document.querySelector('.admin-sidebar')?.contains(document.activeElement)),
        'Shift+Tab 反向循环后焦点应仍在抽屉内',
      );

      // Esc 关：焦点回切换钮 + 锁滚复原（TC-DRW-05 为 P0）
      await page.keyboard.press('Escape');
      await sideOffscreen();
      const focusAfterEsc = await page.evaluate(() => document.activeElement?.className ?? 'null');
      assert(
        String(focusAfterEsc).includes('admin-nav-toggle'),
        `Esc 关闭后焦点应回切换钮（实际 ${focusAfterEsc}）`,
      );
      assert(
        (await page.evaluate(() => document.body.style.overflow)) !== 'hidden',
        'Esc 关闭后背景锁滚应复原',
      );

      // × 关闭（TC-DRW-07）：同样焦点回切换钮
      await toggle.click();
      await page.locator('.admin-drawer-mask').waitFor({ timeout: TIMEOUT });
      await page.locator('.admin-drawer-close').click();
      await sideOffscreen();
      const focusAfterX = await page.evaluate(() => document.activeElement?.className ?? 'null');
      assert(
        String(focusAfterX).includes('admin-nav-toggle'),
        `× 关闭后焦点应回切换钮（实际 ${focusAfterX}）`,
      );

      // 点链接导航 → 自动关（抽屉必须不挡路由跳转后的屏幕）
      await toggle.click();
      await page.locator('.admin-drawer-mask').waitFor({ timeout: TIMEOUT });
      await page.locator('.admin-sidebar a[href="/admin/players"]').first().click();
      await page.waitForFunction(() => location.pathname === '/admin/players', null, { timeout: TIMEOUT });
      await sideOffscreen();

      // 遮罩点击关（点遮罩右缘，别点到盖在上面的抽屉面板）
      await toggle.click();
      await page.locator('.admin-drawer-mask').waitFor({ timeout: TIMEOUT });
      await page.locator('.admin-drawer-mask').click({ position: { x: 340, y: 300 } });
      await sideOffscreen();
      assert(
        !(await page.locator('.admin-drawer-mask').isVisible().catch(() => false)),
        '关闭后遮罩应消失',
      );

      // 桌面零变化铁律：宽屏不渲染切换钮、无遮罩、侧栏常驻（DOM 口径，非样式抽查）
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`${BASE}/admin/clubs`, { waitUntil: 'networkidle' });
      assert((await page.locator('button.admin-nav-toggle').count()) === 0, '宽屏不应渲染切换钮');
      assert((await page.locator('.admin-drawer-mask').count()) === 0, '宽屏不应有遮罩');
      assert(await page.locator('.admin-sidebar').isVisible(), '宽屏侧栏应常驻可见');
      const t = await text();
      assert(t.includes('管理端'), '宽屏管理端壳渲染异常');
    });

    await check('⑭ 成长补录台：宽屏表格分支 / 窄屏卡片流（XP 实时复算 + 保存锁定 + 汇总条，截图落 scratch/）', async () => {
      // ---- 宽屏：表格分支（与卡片 DOM 互斥，桌面零变化契约） ----
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`${BASE}/admin/growth`, { waitUntil: 'networkidle' });
      const editBtns = page.getByRole('button', { name: '录数据' });
      assert((await editBtns.count()) > 0, '本地种子缺已确认比赛：/admin/growth 没有任何「录数据」行（⑭ 前置缺失）');
      await editBtns.first().click();
      await page.locator('.entry-table').waitFor({ timeout: TIMEOUT });
      assert((await page.locator('.entry-cards').count()) === 0, '宽屏不应渲染 entry-cards（DOM 互斥）');
      assert((await page.locator('.entry-sumbar').count()) === 0, '宽屏不应渲染 entry-sumbar（汇总条只属窄屏）');
      await page.locator('.entry-head').getByRole('button', { name: '收起' }).click();
      await page.locator('.entry-panel').waitFor({ state: 'detached', timeout: TIMEOUT });

      // ---- 窄屏：卡片流 ----
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`${BASE}/admin/growth`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: '录数据' }).first().click();
      await page.locator('.entry-cards').waitFor({ timeout: TIMEOUT });
      assert((await page.locator('.entry-table').count()) === 0, '窄屏不应渲染 entry-table（DOM 互斥）');
      const sumbar = page.locator('.entry-sumbar');
      assert(await sumbar.isVisible(), '窄屏应渲染 entry-sumbar 汇总条');
      assert(await sumbar.getByRole('button', { name: '全部保存' }).isVisible(), '汇总条里没有「全部保存」');
      await page.screenshot({ path: join(SHOT_DIR, 'e2e-growth-entry-375.png'), fullPage: false });

      // 设计意图：汇总条常驻视口底——卡片再长也不用滚到面板底才够得着「全部保存」。
      // entry-panel 挂在比赛表 td 里，外层 .table-wrap 是横向滚动容器 ⇒ sticky 只贴容器不贴视口，
      // 窄屏正解是 fixed（spec §0-2 实测裁决）。
      await page.evaluate(() => document.querySelector('.entry-cards')?.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(200);
      const pin = await page.evaluate(() => {
        const r = document.querySelector('.entry-sumbar')?.getBoundingClientRect();
        return r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: document.documentElement.clientHeight } : null;
      });
      assert(
        pin && Math.abs(pin.bottom - pin.vh) <= 2 && pin.top < pin.vh,
        `汇总条应常驻视口底部（bottom=${pin?.bottom} vs 视口高=${pin?.vh}）——sticky 陷阱或 fixed 被摘`,
      );

      // P1-1 闸门（评审）：面板活在主比赛表 <td colSpan=6> 里，td 宽随主表 min-content（nowrap 表头）
      // 走 ⇒ 旧缺陷下面板 ≈1.5× 视口、卡脚保存钮出屏；⑫ 只量 documentElement.scrollWidth 察觉不到
      // （横滚吃掉了溢出）。修法 = .entry-panel sticky left:0 + width:100cqw，这里量几何：
      // 面板左右缘都必须在视口内（放行 1px 描边容差）。
      const fit = await page.evaluate(() => {
        const r = document.querySelector('.entry-panel')?.getBoundingClientRect();
        return r ? { left: r.left, right: r.right, vw: document.documentElement.clientWidth } : null;
      });
      assert(
        fit && fit.left >= -1 && fit.right <= fit.vw + 1,
        `entry-panel 应完整落在视口内（left=${fit?.left} right=${fit?.right} vs 视口=${fit?.vw}）——P1-1 出宽修法（sticky+100cqw）失效`,
      );

      // 拦截保存响应拿 playerId/xp，跑完把写入退掉（烟测可重复：不消费掉球员的评分格）
      let savedPid = null;
      let savedXp = 0;
      const onSave = async (r) => {
        if (r.url().includes('/api/admin/growth/match-entry/') && r.request().method() === 'POST') {
          try {
            const j = await r.json();
            savedPid = j.perPlayer?.[0]?.playerId ?? null;
            savedXp = j.perPlayer?.[0]?.xp ?? 0;
          } catch { /* 响应体解析失败不影响断言 */ }
        }
      };
      page.on('response', onSave);

      // 挑一张评分格未锁的卡，改评分 → 卡脚 XP 徽标实时变（TC-ENT-05）
      const cardIndex = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.entry-card')];
        return cards.findIndex((c) => c.querySelector('input[inputmode="decimal"]:enabled'));
      });
      assert(cardIndex >= 0, '没有任何评分格可编辑（全锁/训练营？）——⑭ 前置缺失');
      const card = page.locator('.entry-card').nth(cardIndex);
      const head = (await card.locator('.entry-card-head').innerText()).trim();
      const foot = card.locator('.entry-card-foot');
      const footBefore = await foot.innerText();
      await card.locator('input[inputmode="decimal"]').first().fill('8');
      const footAfter = await foot.innerText();
      assert(footBefore !== footAfter, `填评分 8 后卡脚 XP 徽标没实时变（「${head.split('\n')[0]}」：前「${footBefore.replace(/\n/g, ' ')}」后「${footAfter.replace(/\n/g, ' ')}」）`);

      // 本行保存 → 该卡评分格进入锁定态（TC-ENT-06；已录值不可改是 v6.16.0 语义）
      await foot.getByRole('button').first().click();
      await page.waitForFunction(
        (idx) => {
          const c = document.querySelectorAll('.entry-card')[idx];
          if (!c) return false;
          const inputs = c.querySelectorAll('input[inputmode="decimal"]');
          return inputs.length === 0 || [...inputs].every((el) => el.disabled);
        },
        cardIndex,
        { timeout: TIMEOUT },
      );

      // 查看模式：全部控件只读（TC-ENT-04 的另一面）
      page.off('response', onSave);
      await page.locator('.entry-head').getByRole('button', { name: '收起' }).click();
      await page.locator('.entry-panel').waitFor({ state: 'detached', timeout: TIMEOUT });
      await page.getByRole('button', { name: '查看' }).first().click();
      await page.locator('.entry-cards').waitFor({ timeout: TIMEOUT });
      const editableInView = await page.evaluate(() =>
        [...document.querySelectorAll('.entry-panel input')].filter((el) => !el.disabled && !el.readOnly).length,
      );
      assert(editableInView === 0, `查看模式仍有 ${editableInView} 个可编辑控件`);

      // 退掉本次写入：删事件 + 退 XP，恢复「该球员评分格未录」的原状（烟测幂等）
      if (savedPid != null) {
        const startIso = new Date(Date.now() - 10 * 60_000).toISOString();
        const sql =
          `DELETE FROM growth_events WHERE player_id = ${Number(savedPid)} AND source = 'manual' AND created_at >= '${startIso}';\n` +
          `UPDATE players SET growth_xp = MAX(0, growth_xp - ${Number(savedXp) || 0}) WHERE id = ${Number(savedPid)};`;
        const f = join(SHOT_DIR, 'e2e-growth-rollback.sql');
        writeFileSync(f, sql, 'utf8');
        try {
          wrangler(['d1', 'execute', 'whl-club', '--local', '--file', f, '--json']);
        } catch (e) {
          console.warn(`（⑭ 回滚写入失败（不影响断言，只影响重复跑）：${String(e).slice(0, 120)}）`);
        }
      }
    });

    await check('⑮ 教练台粘性首列：≤640 sticky 几何 / 1280 static（本地无教练台则备注降级）', async () => {
      // 教练台（v6.30.0 起 = 详情页「工作台」页签）只挂给本队教练（本地观众登录 + TOUR_DB 旧 schema ⇒ 不渲染）。
      // 桩教练台全家桶（squad/stadium/bookings/events/naming…）成本失衡，故：表在场就跑几何，
      // 不在场则显式备注降级，确定性回归由 tests/mobile-baseline.test.ts TC-SWP-05 静态闸门兜住。
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`${BASE}/clubs/1`, { waitUntil: 'networkidle' });
      // P2-1（评审）：count() 不等待——渲染晚一步就会把「在场」误判成降级。先给 3s 窗口等它出现。
      let stickyTables = 0;
      // v6.30.0 A 段：教练台拆进「工作台」页签，本队教练的默认页签就是它（显式点一下防止深链/回落变化）
      const deskTabBtn = page.locator('.dossier-tabs button', { hasText: '工作台' }).first();
      if ((await deskTabBtn.count()) > 0) await deskTabBtn.click();
      try {
        await page.locator('table.coach-sticky').first().waitFor({ state: 'visible', timeout: 3000 });
        stickyTables = await page.locator('table.coach-sticky').count();
      } catch {
        stickyTables = 0;
      }
      if (stickyTables === 0) {
        console.warn('（⑮ 备注：本地教练工作台不渲染（观众登录/TOUR_DB 旧 schema），几何断言降级——静态闸门 = tests/mobile-baseline.test.ts TC-SWP-05）');
        return;
      }
      // v6.30.0 C 段：注册名单列集重定（分配开关最左），冻结点从「第 1+2 列」挪到「第 1 列 + 第 5 列（姓名）」，
      // 夹在中间的标记/号码/UID 横向滚动时从姓名下面滑过（不钉）—— 判据跟着平移，旧口径断第 2 列。
      const geom = await page.evaluate(() => {
        const table = document.querySelector('table.coach-sticky');
        const pos = (sel) => {
          const el = table?.querySelector(sel);
          return el ? getComputedStyle(el).position : null;
        };
        return {
          c1th: pos('thead tr th:nth-child(1)'),
          c1td: pos('tbody tr td:nth-child(1)'),
          c2th: pos('thead tr th:nth-child(2)'),
          c5th: pos('thead tr th:nth-child(5)'),
          c5td: pos('tbody tr td:nth-child(5)'),
        };
      });
      assert(
        geom.c1th === 'sticky' && geom.c1td === 'sticky',
        `≤640 分配列（第 1 列）应 th/td 均 sticky（th=${geom.c1th} td=${geom.c1td}）`,
      );
      assert(
        geom.c5th === 'sticky' && geom.c5td === 'sticky',
        `≤640 姓名列（第 5 列）应 th/td 均 sticky（th=${geom.c5th} td=${geom.c5td}）`,
      );
      assert(geom.c2th === 'static', `≤640 标记列（第 2 列）应让位成 static（computed=${geom.c2th}）——冻结块中间不该再钉一列`);
      // P2-1（评审）：先验外层 wrap 真可横滚——不可滚时下面的「滚后仍在视口」是平凡绿（根本没滚）
      const scrollable = await page.evaluate(() => {
        const wrap = document.querySelector('table.coach-sticky')?.closest('.table-wrap');
        return wrap ? { sw: wrap.scrollWidth, cw: wrap.clientWidth } : null;
      });
      assert(
        scrollable && scrollable.sw > scrollable.cw,
        `coach-sticky 表外层 .table-wrap 不可横滚（scrollWidth=${scrollable?.sw} ≤ clientWidth=${scrollable?.cw}）——粘性几何无从验证`,
      );
      // 横滚后姓名列（第 5 列，冻结点）仍应留在视口内（粘住 = 滚不走）；同时确认滚动真发生了
      await page.evaluate(() => {
        const wrap = document.querySelector('table.coach-sticky')?.closest('.table-wrap');
        if (wrap) wrap.scrollLeft = 400;
      });
      await page.waitForTimeout(300);
      const after = await page.evaluate(() => {
        const wrap = document.querySelector('table.coach-sticky')?.closest('.table-wrap');
        const td = document.querySelector('table.coach-sticky')?.querySelector('tbody tr td:nth-child(5)');
        const r = td?.getBoundingClientRect();
        return r ? { left: r.left, right: r.right, vw: document.documentElement.clientWidth, scrolled: wrap?.scrollLeft ?? 0 } : null;
      });
      assert(after && after.scrolled > 0, `设置 scrollLeft=400 后 wrap.scrollLeft=${after?.scrolled}——滚动没生效，后续断言不可信`);
      assert(after && after.left >= -1 && after.right <= after.vw + 1, `横滚 400px 后粘性姓名列被滚出视口（left=${after?.left} right=${after?.right}）`);
      // 宽屏取消粘性（computed static，不是只看媒体块存在）——断真正粘的那一列（第 1 列）
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.waitForTimeout(200);
      const wide = await page.evaluate(() => {
        const th = document.querySelector('table.coach-sticky')?.querySelector('thead tr th:nth-child(1)');
        return th ? getComputedStyle(th).position : null;
      });
      assert(wide === 'static', `1280 应取消粘性（computed=${wide}）`);
    });

    await check('⑯ 公开阅读几何：玩家页 dossier/事件卡 + intel 粘性首列（spec §4）', async () => {
      // 取样球员：/api/players?limit=1 首行（本地 = 9001 阿大，4 条 completed 转会 ⇒ 转会页签卡片非空）
      const pid = await page.evaluate(async () => {
        const r = await fetch('/api/players?limit=1');
        const j = await r.json();
        const p = j.players?.[0];
        return p ? (p.fcId ?? p.id) : null;
      });
      assert(pid, '取样球员失败（/api/players?limit=1 无数据）——⑯ 玩家页断言前提不成立');

      // —— 375：档案单列（900 档）+ 页签不撑破文档 + 转会事件卡互斥且 fit ——
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`${BASE}/players/${pid}`, { waitUntil: 'networkidle' });
      const d375 = await page.evaluate(() => {
        const d = document.querySelector('.dossier');
        return d ? getComputedStyle(d).gridTemplateColumns : null;
      });
      assert(d375 && !d375.includes(' '), `375 .dossier 应单列（grid-template-columns="${d375}"）`);
      const ovTabs = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert(ovTabs <= 1, `375 玩家页文档级横向溢出 ${ovTabs}px（页签行应横滑而非撑破文档）`);
      // 页签横滑红线（评审 P1-1）：折行/删块不产生文档级溢出，直接钉行为——② 块被删或挪出 ≤760 时
      // computed 立即变。注意不能用 scrollWidth>clientWidth：实测 375 下页签内容仅 ~245px 不溢出，
      // 几何断言只在更窄视口/更长标签下才成立；静态闸门（tests/mobile-baseline.test.ts 媒体块归属例）
      // 钉「规则在 ② 块内」，这里钉「375 下规则真生效」，两层互补。
      const tabsCss = await page.evaluate(() => {
        const t = document.querySelector('.dossier-tabs');
        if (!t) return null;
        const cs = getComputedStyle(t);
        return { ovx: cs.overflowX, wrap: cs.flexWrap };
      });
      assert(tabsCss && tabsCss.ovx === 'auto' && tabsCss.wrap === 'nowrap', `375 .dossier-tabs 应启用横滑（overflow-x:auto + flex-wrap:nowrap），实见 ${JSON.stringify(tabsCss)}——② 块被删/挪块时红`);
      await page.locator('.dossier-tabs button', { hasText: '转会' }).first().click();
      await page.locator('.event-card').first().waitFor({ state: 'visible', timeout: TIMEOUT });
      const excl375 = await page.evaluate(() => ({
        cards: document.querySelectorAll('.event-card').length,
        tables: document.querySelectorAll('.transfer-table').length,
      }));
      assert(excl375.cards > 0 && excl375.tables === 0, `375 转会页签应卡片化（cards=${excl375.cards} transfer-table=${excl375.tables}）`);
      const fit = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const bad = [];
        document.querySelectorAll('.event-card').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.left < -1 || r.right > vw + 1) bad.push(`${Math.round(r.left)}..${Math.round(r.right)}`);
        });
        return { vw, bad };
      });
      assert(fit.bad.length === 0, `375 事件卡超出视口 ±1px：${fit.bad.join(',')}（vw=${fit.vw}）`);
      // 成长页签（本地 9001 无成长事件种子 ⇒ 只断言不撑破；卡片在场与否依赖种子，静态闸门兜底）
      await page.locator('.dossier-tabs button', { hasText: '成长' }).first().click();
      await page.waitForTimeout(200);
      const ovGrow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert(ovGrow <= 1, `375 成长页签文档级横向溢出 ${ovGrow}px`);

      // —— 768：900 档单列保持 + 表格分支回归（>760）——
      await page.setViewportSize({ width: 768, height: 900 });
      await page.locator('.dossier-tabs button', { hasText: '转会' }).first().click();
      await page.waitForTimeout(200);
      const d768 = await page.evaluate(() => {
        const d = document.querySelector('.dossier');
        return {
          cols: d ? getComputedStyle(d).gridTemplateColumns : null,
          cards: document.querySelectorAll('.event-card').length,
          tbl: document.querySelectorAll('.transfer-table').length,
        };
      });
      assert(d768.cols && !d768.cols.includes(' '), `768 .dossier 应仍单列（900 档覆盖）（="${d768.cols}"）`);
      assert(d768.tbl > 0 && d768.cards === 0, `768 应回表格分支（transfer-table=${d768.tbl} event-cards=${d768.cards}）`);

      // —— 1280：桌面双栏 280px+1fr + 表格分支 ——
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.waitForTimeout(200);
      const d1280 = await page.evaluate(() => {
        const d = document.querySelector('.dossier');
        return {
          cols: d ? getComputedStyle(d).gridTemplateColumns : null,
          cards: document.querySelectorAll('.event-card').length,
          tbl: document.querySelectorAll('.transfer-table').length,
        };
      });
      assert(d1280.cols && d1280.cols.startsWith('280px'), `1280 .dossier 应双栏 280px+1fr（="${d1280.cols}"）`);
      assert(d1280.tbl > 0 && d1280.cards === 0, `1280 应表格分支（transfer-table=${d1280.tbl} event-cards=${d1280.cards}）`);

      // —— 375 /market/intel：成交表粘前两列（本地 4 条 completed ⇒ 表非空）——
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`${BASE}/market/intel`, { waitUntil: 'networkidle' });
      let sticky2 = 0;
      try {
        await page.locator('table.table-sticky-2').first().waitFor({ state: 'visible', timeout: 3000 });
        sticky2 = await page.locator('table.table-sticky-2').count();
      } catch {
        sticky2 = 0;
      }
      if (sticky2 === 0) {
        console.warn('（⑯ 备注：intel 成交表无数据/未挂 table-sticky-2，粘性几何降级——静态闸门兜底）');
      } else {
        const st = await page.evaluate(() => {
          const tbl = document.querySelector('table.table-sticky-2');
          const th1 = tbl?.querySelector('thead tr th:nth-child(1)');
          const th2 = tbl?.querySelector('thead tr th:nth-child(2)');
          const r1 = th1?.getBoundingClientRect();
          const r2 = th2?.getBoundingClientRect();
          return {
            th2: th2 ? getComputedStyle(th2).position : null,
            seam: r1 && r2 ? Math.abs(r1.right - r2.left) : null,
          };
        });
        assert(st.th2 === 'sticky', `375 intel 第二列应 sticky（computed=${st.th2}）`);
        // 粘列无缝（评审 P2-2）：|th1.right − th2.left| 应 ≤1px——:has 认表选择器与 --stky-c1
        // 列宽错位（如某表列结构变更后变量跳档）时此断言红，overflow:hidden 会开始裁字
        assert(st.seam !== null && st.seam <= 1, `intel 粘列无缝检查失败：|th1.right−th2.left|=${st.seam}px（首列定宽与第二列 left 错位）`);
        const scrollable = await page.evaluate(() => {
          const wrap = document.querySelector('table.table-sticky-2')?.closest('.table-wrap');
          return wrap ? { sw: wrap.scrollWidth, cw: wrap.clientWidth } : null;
        });
        assert(scrollable && scrollable.sw > scrollable.cw, `intel 表外层 .table-wrap 不可横滚（sw=${scrollable?.sw} cw=${scrollable?.cw}）——粘性几何无从验证`);
        await page.evaluate(() => {
          const wrap = document.querySelector('table.table-sticky-2')?.closest('.table-wrap');
          if (wrap) wrap.scrollLeft = 400;
        });
        await page.waitForTimeout(300);
        const after = await page.evaluate(() => {
          const wrap = document.querySelector('table.table-sticky-2')?.closest('.table-wrap');
          const th = document.querySelector('table.table-sticky-2')?.querySelector('thead tr th:nth-child(2)');
          const r = th?.getBoundingClientRect();
          return r ? { left: r.left, right: r.right, vw: document.documentElement.clientWidth, scrolled: wrap?.scrollLeft ?? 0 } : null;
        });
        assert(after && after.scrolled > 0, `intel wrap scrollLeft=${after?.scrolled}——滚动没生效，后续断言不可信`);
        assert(after && after.left >= -1 && after.right <= after.vw + 1, `intel 横滚后第二列被滚出视口（left=${after?.left} right=${after?.right}）`);
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.waitForTimeout(200);
        const wide2 = await page.evaluate(() => {
          const th = document.querySelector('table.table-sticky-2')?.querySelector('thead tr th:nth-child(2)');
          return th ? getComputedStyle(th).position : null;
        });
        assert(wide2 === 'static', `1280 intel 应取消粘性（computed=${wide2}）`);
      }
    });

    // v6.25.0：显示时区偏好化——顶栏时钟图标下拉即切即生效（重渲染链 whl:tz-change → useTzPref）、
    // 收件篮信封图标化。跑在 1280 宽屏（⑰ 前各场景已把视口拨回）。
    await check('⑰ 显示时区：时钟下拉切 UTC 时间串即变 + 收件篮图标化 + Esc 关闭', async () => {
      await page.goto(`${BASE}/ledger`, { waitUntil: 'networkidle' });
      const tzBtn = page.locator('button.tz-btn');
      assert(await tzBtn.isVisible(), '顶栏时钟图标（button.tz-btn）不可见');
      const inbox = page.locator('a.inbox-link[aria-label="站内信收件篮"]');
      assert(await inbox.isVisible(), '收件篮信封图标（a.inbox-link）不可见');

      // 未读红点：有无取决于会话未读数（>0 才渲染），在场时必须带条数播报
      if (await page.locator('.inbox-link .inbox-unread-dot').count() > 0) {
        const dotLabel = await page.locator('.inbox-unread-dot').first().getAttribute('aria-label');
        assert(dotLabel && /\d+ 条未读/.test(dotLabel), `红点缺 aria-label 条数播报（=${dotLabel}）`);
      } else {
        console.warn('（⑰ 备注：会话无未读，红点断言降级——静态与单测兜底）');
      }

      // 打开下拉：默认档必须是北京时间
      await tzBtn.click();
      const pop = page.locator('.tz-pop');
      assert(await pop.isVisible(), '时区下拉未弹出');
      const checked = await pop.locator('button[aria-checked="true"]').innerText();
      assert(checked.includes('北京时间'), `默认选中档应为北京时间（实际=${checked.trim()}）`);

      // 账本首行时间串：切 UTC 后必须变（同一条流水北京时间 21:xx vs UTC 13:xx）
      const cell = page.locator('td.mono.ledger-time').first();
      const hasRow = (await cell.count()) > 0;
      if (!hasRow) {
        console.warn('（⑰ 备注：账本无流水行，时间串变化断言降级——单测 datetime.test 已钉死口径）');
      } else {
        const before = (await cell.innerText()).trim();
        await pop.locator('button', { hasText: 'UTC' }).click();
        assert(
          (await page.evaluate(() => localStorage.getItem('whl.tz'))) === 'utc',
          '切 UTC 后 localStorage whl.tz 未写入 utc',
        );
        await page.waitForTimeout(300); // React 重渲染
        const after = (await cell.innerText()).trim();
        assert(after !== before, `切 UTC 后时间串未变化（前后都=${before}）——whl:tz-change 重渲染链失效`);
      }

      // 切回默认档 + Esc 关闭下拉
      await tzBtn.click();
      await page.locator('.tz-pop button', { hasText: '北京时间' }).click();
      assert(
        (await page.evaluate(() => localStorage.getItem('whl.tz'))) === 'asia/shanghai',
        '切回北京时间失败',
      );
      await tzBtn.click();
      await page.keyboard.press('Escape');
      assert((await page.locator('.tz-pop').count()) === 0, 'Esc 未关闭时区下拉');
    });

    await check('⑱ 消费中心：页结构 / 匿名引导 / 工作台与主场入口 / 管理端侧栏「消费」', async () => {
      // 教练视角（本地种子会话是管理员，含 coach 权限）：页签 + 右栏工单 + 球场三卡在位
      await page.goto(`${BASE}/shop`, { waitUntil: 'networkidle' });
      const t = await text();
      assert(t.includes('消费中心'), '没进消费中心');
      for (const tab of ['买 PA', '徽章', '角色（职责）', '位置热区', '队壳申请']) {
        assert(t.includes(tab), `消费中心缺页签：${tab}`);
      }
      assert(t.includes('我的工单'), '消费中心右栏缺工单列表');
      assert(t.includes('设施经营') && t.includes('冠名市场') && t.includes('球场档期'), '消费中心缺球场三卡');
      // ?tab= 深链落在对应页签
      await page.goto(`${BASE}/shop?tab=position`, { waitUntil: 'networkidle' });
      assert(await page.locator('.seg button.on', { hasText: '位置热区' }).first().isVisible(), '?tab=position 深链没落页签');
      // 工作台/主场页签的入口（只挂给本队教练；本地种子会话若无教练台则备注降级，同 ⑮ 口径）
      await page.goto(`${BASE}/clubs`, { waitUntil: 'networkidle' });
      const clubLink = page.locator('a[href^="/clubs/"]').first();
      await clubLink.click();
      await page.waitForLoadState('networkidle');
      let coachPanelVisible = false;
      try {
        await page.locator('text=注册工作台').first().waitFor({ state: 'visible', timeout: 3000 });
        coachPanelVisible = true;
      } catch {
        coachPanelVisible = false;
      }
      if (coachPanelVisible) {
        // v6.30.0 A 段：原 CoachPanel 的「消费中心」大卡换成「主场」页签里的一行入口链接
        await page.locator('.dossier-tabs button', { hasText: '主场' }).first().click();
        await page.locator('a[href="/shop"]').first().waitFor({ state: 'visible', timeout: 3000 });
        assert((await text()).includes('消费中心'), '主场页签缺「消费中心」入口链接');
      } else {
        console.warn('（⑱ 备注：本地教练工作台不渲染（会话非该队教练），工作台/主场入口断言降级——结构由 web/src/pages/ClubDetail.test.tsx 与 club/ 各 Tab 源码静态锁覆盖）');
      }
      // 匿名：登录引导，不泄露商品表单（同 ⑤d 的 /api/me 探针法）
      const anon = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      try {
        const ap = await anon.newPage();
        await ap.route(/\/api\/me(\?|$)/, (r) =>
          r.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ user: null, authMode: 'shared', authHome: null }),
          }),
        );
        await ap.goto(`${BASE}/shop`, { waitUntil: 'networkidle' });
        const anonText = await ap.locator('body').innerText();
        assert(anonText.includes('这个页面要登录后才能用'), `匿名进 /shop 没给登录引导：${anonText.slice(0, 120)}`);
        assert(!anonText.includes('队壳申请'), '匿名竟然看到了商品表单');
      } finally {
        await anon.close();
      }
      // 管理端侧栏「消费工单」项 + 页可达
      await page.goto(`${BASE}/admin/shop`, { waitUntil: 'networkidle' });
      const adminText = await text();
      assert(adminText.includes('工单队列'), '管理端消费页缺工单队列');
      assert(adminText.includes('外部录入'), '管理端消费页缺外部录入折叠卡');
      // v6.28.0：侧栏项从「消费」改名「消费工单」。这里必须用**精确文本**判——原先的
      // hasText('消费') 是子串匹配，「消费工单」照样命中，改名前后的断言都绿，等于没测。
      const navLabels = (await page.locator('.admin-nav-link').allInnerTexts()).map((s) => s.trim());
      assert(navLabels.includes('消费工单'), `管理端侧栏缺「消费工单」项（实际：${navLabels.join('/')}）`);
      // 四域分组标题（v6.28.0 D 段）：只验组标题在场，路由与链接顺序由单测管
      const groupTitles = (await page.locator('.admin-nav-group-title').allInnerTexts()).map((s) => s.trim());
      for (const t of ['赛事运营', '球队与名册', '转会与经营', '系统']) {
        assert(groupTitles.includes(t), `管理端侧栏缺分组标题「${t}」（实际：${groupTitles.join('/')}）`);
      }
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
