// @vitest-environment jsdom
// 顶栏右上角 ≡ 菜单（web/src/components/TopBar.tsx，v6.41.0）：
// v6.25.0 起平铺在顶栏的「显示时区三档」与「退出登录」并进同一个弹层；登出项只在已登录的 OIDC 态出现
// （兼容模式的会话真源在赛事系统，本站无从登出）。这里钉的是菜单对谁可见、里面有什么、点完怎么收——
// 真浏览器里的一条端到端路径在 scripts/e2e/smoke.mjs ⑰，文本形态锁在 tests/mobile-baseline.test.ts。
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeUser } from '../lib/api.ts';
import TopBar from './TopBar.tsx';

const { authState, unreadState, deskState } = vi.hoisted(() => ({
  authState: { user: null as unknown, authMode: 'oidc' as 'oidc' | 'shared' },
  unreadState: { n: 0 },
  deskState: { total: 0 },
}));
vi.mock('../lib/auth.tsx', () => ({
  useAuth: () => ({ user: authState.user, authMode: authState.authMode, authHome: null }),
}));
vi.mock('../lib/queries.ts', () => ({
  useUnreadCount: () => ({ data: unreadState.n }),
  // 与真实 hook 同语义：enabled=false（匿名/观众）时没有数据
  useDeskSummary: (enabled: boolean) => ({
    data: enabled && deskState.total > 0 ? { negotiations: 0, offers: 0, bids: 0, total: deskState.total } : undefined,
  }),
}));

const ADMIN: MeUser = { id: 1, name: '管理员', role: 'admin', locked: false, mustChangePw: false };
const COACH: MeUser = { id: 5, name: '教练甲', role: 'coach', locked: false, mustChangePw: false };

const renderBar = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <TopBar />
    </MemoryRouter>,
  );
const menuBtn = () => screen.getByRole('button', { name: '菜单' });
const openMenu = () => fireEvent.click(menuBtn());
const optionTexts = () => screen.getAllByRole('menuitemradio').map((b) => b.textContent?.trim());

beforeEach(() => {
  localStorage.clear();
  authState.user = null;
  authState.authMode = 'oidc';
  unreadState.n = 0;
  deskState.total = 0;
});
afterEach(cleanup);

describe('v6.41.0 顶栏 ≡ 菜单', () => {
  it('未登录（兼容模式）也渲染 ≡：菜单里只有时区三档，没有登出', () => {
    authState.authMode = 'shared';
    renderBar();
    expect(screen.getByText('去赛事系统登录')).toBeTruthy();
    expect(menuBtn().getAttribute('aria-expanded')).toBe('false');
    // 收起态不渲染弹层：顶栏上再也找不到平铺的登出按钮
    expect(screen.queryByText('退出登录')).toBeNull();

    openMenu();
    expect(menuBtn().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu', { name: '用户菜单' }).textContent).toContain('显示时区：北京时间');
    expect(optionTexts()).toEqual(['✓ 北京时间', 'UTC', '跟随浏览器']);
    expect(screen.getAllByRole('menuitemradio')[0].getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText('退出登录')).toBeNull();
  });

  it('已登录 OIDC：退出登录在菜单内（原生表单 POST /api/auth/logout）', () => {
    authState.user = ADMIN;
    renderBar();
    expect(screen.getByLabelText('站内信收件篮')).toBeTruthy();
    expect(screen.getByText('管理员')).toBeTruthy();
    expect(screen.queryByText('退出登录')).toBeNull();

    openMenu();
    const logout = screen.getByRole('menuitem', { name: '退出登录' });
    expect(logout.getAttribute('type')).toBe('submit');
    expect(logout.closest('form')?.getAttribute('action')).toBe('/api/auth/logout');
    expect(logout.closest('form')?.getAttribute('method')).toBe('post');
  });

  it('已登录但兼容模式：有用户名，没有登出项', () => {
    authState.user = COACH;
    authState.authMode = 'shared';
    renderBar();
    expect(screen.getByText('教练甲')).toBeTruthy();
    openMenu();
    expect(optionTexts()).toHaveLength(3);
    expect(screen.queryByRole('menuitem', { name: '退出登录' })).toBeNull();
  });

  it('点选 UTC：写偏好、收起菜单、重开时勾在 UTC 上且标题串跟着变', () => {
    authState.user = ADMIN;
    renderBar();
    expect(menuBtn().getAttribute('title')).toBe('菜单（显示时区：北京时间）');

    openMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'UTC' }));
    expect(localStorage.getItem('whl.tz')).toBe('utc');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(menuBtn().getAttribute('title')).toBe('菜单（显示时区：UTC）');

    openMenu();
    expect(screen.getByRole('menu').textContent).toContain('显示时区：UTC');
    expect(optionTexts()).toEqual(['北京时间', '✓ UTC', '跟随浏览器']);
  });

  it('Esc 与外点都收起菜单', () => {
    authState.user = ADMIN;
    renderBar();
    openMenu();
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    openMenu();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();

    // 收起后再按 Esc 不该报错（监听器只在展开时挂）
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('≡ 是 userbox 最右一格；未读红点仍带条数播报', () => {
    authState.user = ADMIN;
    unreadState.n = 3;
    renderBar();
    expect(screen.getByLabelText('3 条未读')).toBeTruthy();
    const userbox = document.querySelector('.userbox');
    expect(userbox?.lastElementChild?.className).toBe('user-menu-wrap');
  });

  it('v6.69.0：菜单里有 PlayStyles 图鉴入口，点完收起菜单', () => {
    renderBar();
    openMenu();
    const link = screen.getByRole('menuitem', { name: 'PlayStyles 图鉴' });
    expect(link.getAttribute('href')).toBe('/playstyles');
    fireEvent.click(link);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('v6.73.0 期 B 转会台入口与红点', () => {
  it('教练有待办：右上角入口带数字，转会中心出现红点', () => {
    authState.user = COACH;
    deskState.total = 5;
    renderBar();
    const shortcut = screen.getByRole('link', { name: '我的转会台，5 项待办' });
    expect(shortcut.getAttribute('href')).toBe('/market/desk');
    expect(shortcut.textContent).toContain('5');
    expect(document.querySelector('.nav-tab .nav-dot')).toBeTruthy();
  });

  it('total=0：入口只留文案、不显示 0，也没有红点', () => {
    authState.user = COACH;
    renderBar();
    const shortcut = screen.getByRole('link', { name: '我的转会台，0 项待办' });
    expect(shortcut.textContent).toBe('我的转会台');
    expect(document.querySelector('.nav-dot')).toBeNull();
  });

  it('>99 显示 99+（aria-label 仍报全量）', () => {
    authState.user = ADMIN;
    deskState.total = 150;
    renderBar();
    const shortcut = screen.getByRole('link', { name: '我的转会台，150 项待办' });
    expect(shortcut.textContent).toContain('99+');
  });

  it('观众不渲染入口、也没有红点', () => {
    authState.user = { id: 9, name: '观众乙', role: 'viewer', locked: false, mustChangePw: false };
    deskState.total = 5;
    renderBar();
    expect(screen.queryByRole('link', { name: /我的转会台/ })).toBeNull();
    expect(document.querySelector('.nav-dot')).toBeNull();
  });

  it('匿名不渲染入口', () => {
    deskState.total = 5;
    renderBar();
    expect(screen.queryByRole('link', { name: /我的转会台/ })).toBeNull();
  });
});
