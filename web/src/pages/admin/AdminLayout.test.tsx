// @vitest-environment jsdom
// 管理端壳布局（web/src/pages/admin/AdminLayout.tsx，v6.28.0 四域分组）的组件测试：
// - TC-NAV-D1（P0）：分组后 12 项一项不差、文案与 to 与改造前逐字一致（防漏项、防顺手改路由）
// - TC-NAV-D2（P0）：组标题与归属固定（总览不套组标题且居首，其余归四域）
// - TC-NAV-D3（P0）：「消费」改「消费工单」（侧栏项 + 窄屏入口按钮上的当前页名），路由仍 /admin/shop
// - TC-NAV-D4（P1））：入口按钮的当前页名（navLabelOf）不受分组影响（走派生平铺表）
// 没打 CSS（jsdom 不跑样式表），分组标题的视觉表现靠 e2e ⑫ 的 375 宽扫描看。
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminLayout from './AdminLayout.tsx';

const { media, auth } = vi.hoisted(() => ({
  media: { narrow: false },
  // 只看 role：布局用 user?.role === 'admin' 分流
  auth: { user: { id: 1, role: 'admin' } as unknown },
}));
vi.mock('../../lib/auth.tsx', () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock('../../lib/use-media.ts', () => ({ useMediaQuery: () => media.narrow }));
// api.ts 只用到 TOUR_SITE_URL（非 admin 分支的外链），其余导出这层页面用不到
vi.mock('../../lib/api.ts', () => ({ TOUR_SITE_URL: 'https://tour.example' }));

afterEach(() => {
  cleanup();
  media.narrow = false;
});

// 改造前（v6.27.0）的 12 项原文：文案 + to 逐字抄下来，分组后必须一项不差
const NAV_BEFORE: { label: string; to: string }[] = [
  { label: '总览', to: '/admin' },
  { label: '赛季', to: '/admin/seasons' },
  { label: '球员', to: '/admin/players' },
  { label: '成长录入', to: '/admin/growth' },
  { label: '导入', to: '/admin/imports' },
  { label: '转会', to: '/admin/market' },
  { label: '俱乐部', to: '/admin/clubs' },
  { label: '品牌池', to: '/admin/brands' },
  { label: '事件', to: '/admin/events' },
  // v6.28.0：文案改「消费工单」，路径不动
  { label: '消费工单', to: '/admin/shop' },
  { label: '财政', to: '/admin/finance' },
  { label: '系统', to: '/admin/system' },
];

// 分组后的 DOM 形态：总览首项不套组标题，其余按域归组（顺序即侧栏自上而下的顺序）
const SHAPE_AFTER: { title: string | null; labels: string[] }[] = [
  { title: null, labels: ['总览'] },
  { title: '赛事运营', labels: ['赛季', '事件'] },
  { title: '球队与名册', labels: ['俱乐部', '球员', '成长录入', '导入'] },
  { title: '转会与经营', labels: ['转会', '品牌池', '消费工单', '财政'] },
  { title: '系统', labels: ['系统'] },
];

function renderLayout(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          {/* index 覆盖 /admin 本身，通配覆盖子页：两条都指向占位块，只验出口照旧渲染 */}
          <Route index element={<p>子页占位</p>} />
          <Route path="*" element={<p>子页占位</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function nav(): HTMLElement {
  return screen.getByRole('navigation', { name: '管理端导航' });
}

// 把侧栏拆成「组标题 → 组内链接」的形状，一条断言锁住归属与顺序
function navShape(el: HTMLElement): { title: string | null; labels: string[] }[] {
  const shape: { title: string | null; labels: string[] }[] = [];
  for (const child of Array.from(el.children) as HTMLElement[]) {
    if (child.classList.contains('admin-nav-group-title')) {
      shape.push({ title: child.textContent, labels: [] });
    } else if (child.classList.contains('admin-nav-link')) {
      if (shape.length === 0) shape.push({ title: null, labels: [] });
      shape[shape.length - 1].labels.push(child.textContent ?? '');
    }
  }
  return shape;
}

describe('管理端侧栏四域分组（v6.28.0）', () => {
  it('TC-NAV-D1/D2：12 项一项不差，to 与分组前逐字一致；组标题与归属固定', () => {
    renderLayout('/admin');
    const side = nav();
    const links = within(side).getAllByRole('link');
    expect(links).toHaveLength(NAV_BEFORE.length);

    // 文案|href 的集合与改造前逐字相同（排序后比较：分组会改 DOM 顺序，但集合不许变）
    const pairs = links.map((a) => `${a.textContent}|${a.getAttribute('href')}`);
    const before = NAV_BEFORE.map((n) => `${n.label}|${n.to}`);
    expect([...pairs].sort()).toEqual([...before].sort());

    // 组结构（标题顺序 + 组内顺序）逐字锁
    expect(navShape(side)).toEqual(SHAPE_AFTER);
    // 总览不套组标题：侧栏首个元素就是总览链接
    expect(side.children[0].classList.contains('admin-nav-link')).toBe(true);
    expect(side.children[0].textContent).toBe('总览');
    // 布局照旧渲染子路由
    expect(screen.getByText('子页占位')).toBeTruthy();
  });

  it('TC-NAV-D3：侧栏「消费」改「消费工单」，路径仍 /admin/shop', () => {
    renderLayout('/admin/shop');
    const side = nav();
    const shop = within(side).getByRole('link', { name: '消费工单' });
    expect(shop.getAttribute('href')).toBe('/admin/shop');
    // 残留旧文案就是回归：整串匹配下「消费」不该再命中任何链接
    expect(within(side).queryByText('消费')).toBeNull();
    // 当前页高亮照旧（NavLink 前缀匹配）
    expect(shop.classList.contains('on')).toBe(true);
  });

  it('TC-NAV-D4：窄屏入口按钮的当前页名不受分组影响（总览精确匹配、子路径前缀匹配）', () => {
    media.narrow = true;
    const { unmount } = renderLayout('/admin/players');
    expect(screen.getByRole('button', { name: '☰ 管理导航 · 球员' })).toBeTruthy();
    unmount();

    // 总览走 end 精确匹配：/admin/seasons 不该显示成「总览」
    const seasons = renderLayout('/admin/seasons');
    expect(screen.getByRole('button', { name: '☰ 管理导航 · 赛季' })).toBeTruthy();
    seasons.unmount();

    const home = renderLayout('/admin');
    expect(screen.getByRole('button', { name: '☰ 管理导航 · 总览' })).toBeTruthy();
    home.unmount();

    // 改名后入口按钮同步（标签单一真源）、深层路径按前缀命中
    const shop = renderLayout('/admin/shop');
    expect(screen.getByRole('button', { name: '☰ 管理导航 · 消费工单' })).toBeTruthy();
    shop.unmount();

    renderLayout('/admin/clubs/cpu-convert');
    expect(screen.getByRole('button', { name: '☰ 管理导航 · 俱乐部' })).toBeTruthy();
  });
});
