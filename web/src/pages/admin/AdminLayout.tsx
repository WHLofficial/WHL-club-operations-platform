// 管理端壳布局：左侧栏 10 项导航 + 子路由出口（v2.1.0 拆分；v6.8.0 加「品牌池」；v6.10.0 加「事件」；
// v6.20.0 窄屏（≤760px）侧栏改左侧滑出抽屉，桌面 DOM 与样式保持 v6.19.0 不动）。
// 非 admin 看到的提示卡与旧 Admin.tsx 一致，不重定向。
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { TOUR_SITE_URL } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { useMediaQuery } from '../../lib/use-media.ts';

const NAV_ITEMS: { to: string; label: string; end?: boolean }[] = [
  { to: '/admin', label: '总览', end: true },
  { to: '/admin/seasons', label: '赛季' },
  { to: '/admin/players', label: '球员' },
  { to: '/admin/growth', label: '成长录入' },
  { to: '/admin/imports', label: '导入' },
  { to: '/admin/market', label: '转会' },
  { to: '/admin/clubs', label: '俱乐部' },
  { to: '/admin/brands', label: '品牌池' },
  { to: '/admin/events', label: '事件' },
  { to: '/admin/finance', label: '财政' },
  { to: '/admin/system', label: '系统' },
];

// 抽屉断点与 styles.css 的管理端媒体块（≤760px）一一对应
const DRAWER_QUERY = '(max-width: 760px)';

// 与 PlayersLibrary 抽屉同一份选择器：抽屉内可聚焦元素的集合
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

// 入口按钮上的当前页名：按 NAV_ITEMS 的 to 做前缀匹配。总览（/admin）必须精确匹配，
// 否则 /admin/seasons 也会命中第一条、永远显示「总览」；都没命中时退回第一项。
function navLabelOf(pathname: string): string {
  const hit = NAV_ITEMS.find((item) => (item.end ? pathname === item.to : pathname.startsWith(item.to)));
  return hit ? hit.label : NAV_ITEMS[0].label;
}

export default function AdminLayout() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const narrow = useMediaQuery(DRAWER_QUERY);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  // 关抽屉时是否要把焦点交还入口按钮（见下面 closeDrawer 的注释）
  const restoreFocus = useRef(false);
  // 上一次焦点是否落在侧栏/抽屉里。宽度变化时用它决定要不要把焦点接回来——
  // 不能在 effect 里嗅探 activeElement：那时 inert 已生效、焦点已被踢走
  const focusInSide = useRef(false);

  // 抽屉关闭：× / 遮罩 / Esc / 换路由四条路都走这里，焦点交还给入口按钮（键盘用户不至于掉到文档开头）
  const closeDrawer = () => {
    restoreFocus.current = true;
    setDrawerOpen(false);
  };

  // 路由变化自动收抽屉：点完导航链接还留一个盖住新页面的抽屉不像话。
  // 依赖里只放 pathname：drawerOpen 每次变化都伴随重渲染，effect 闭包读到的就是最新值；
  // 把它也放进依赖会把「刚点开抽屉」误判成路由变化，开了就关。
  useEffect(() => {
    if (!drawerOpen) return;
    closeDrawer();
  }, [pathname]);

  // 记录焦点是否在侧栏里（一个委托监听，别在每个链接上挂 onFocus）
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      focusInSide.current = !!sidebarRef.current?.contains(e.target as Node);
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  // 焦点归位必须等这次提交落地再 focus：关闭当帧入口按钮还带着 inert，focus() 会被浏览器静默忽略
  // （实测 activeElement 掉到 body）。jsdom 不实现 inert 的焦点拦截，所以这条只有真浏览器能抓到。
  // 宽屏（>760）没有入口按钮，不适用。
  useEffect(() => {
    if (!narrow || drawerOpen) return;
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    toggleRef.current?.focus();
  }, [narrow, drawerOpen]);

  // 宽度跨断点（与 PlayersLibrary 同一套判据）：变窄时侧栏从常驻变成 inert 子树，
  // 浏览器会把焦点踢到 body —— 抽屉没开时交给入口按钮；变宽时放掉抽屉状态（它是窄屏专属形态）。
  // 不在 effect 里嗅探「此刻 activeElement 是否在侧栏里」：这个 effect 在 paint 之后才跑，
  // 那时 inert 已生效、焦点元素已被浏览器踢出，嗅探必然判否。
  useEffect(() => {
    if (narrow) {
      if (!drawerOpen && focusInSide.current) toggleRef.current?.focus();
      return;
    }
    restoreFocus.current = false;
    setDrawerOpen(false);
    // 变宽时入口按钮随窄屏分支一起卸载；焦点若真在抽屉里，inert 翻转的当帧会被浏览器踢到 body
    // （评审 P2-1 实测 activeElement=BODY），这里接回侧栏当前活动链接——宽屏该节点常驻。
    // 顺带清掉标记（评审 P2-2）：若不接回任何元素，陈旧的 true 会让之后任意一次「变窄」
    // 在用户毫无交互的情况下把焦点抢到 toggle 上。
    if (focusInSide.current) {
      focusInSide.current = false;
      sidebarRef.current?.querySelector<HTMLElement>('.admin-nav-link.on')?.focus();
    }
  }, [narrow]);

  // 抽屉开着时：锁背景滚动（不然滑抽屉会带着页面一起滚；iOS 上光靠 body 的 overflow: hidden
  // 挡不住）、焦点移进抽屉、接管 Esc（关）与 Tab（循环留在抽屉内）
  useEffect(() => {
    if (!narrow || !drawerOpen) return;
    const prevOverflow = document.body.style.overflow;
    const prevOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'contain';
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // 内层组件已经消化过的 Esc 不再二次响应
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') {
        closeDrawer();
        return;
      }
      if (e.key !== 'Tab') return;
      // 顶栏在 <Routes> 之外，不属于 inert 区，光靠 inert 挡不住 Tab 走到抽屉外，
      // 这里补最小焦点循环，让 role=dialog + aria-modal 名副其实
      const side = sidebarRef.current;
      if (!side) return;
      // 只看真正能 Tab 到的：offsetParent 为 null（display:none 之类）的不算。
      // 管理端导航里没有收起的 <details>，PlayersLibrary 那一层过滤这里不需要。
      const items = [...side.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((el) => el.offsetParent !== null);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      const inside = !!active && side.contains(active);
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.overscrollBehavior = prevOverscroll;
      window.removeEventListener('keydown', onKey);
    };
  }, [narrow, drawerOpen]);

  return (
    <div className="container">
      <h1>管理端</h1>
      {user?.role === 'admin' ? (
        <div className="admin-shell">
          {/* 窄屏抽屉入口：桌面不渲染（宽屏 DOM 与 v6.19.0 一致），文案带当前页名，用户在收起态也知道自己在哪 */}
          {narrow && (
            <button
              ref={toggleRef}
              type="button"
              className="btn btn-sm admin-nav-toggle"
              aria-expanded={drawerOpen}
              aria-controls="admin-sidebar"
              inert={narrow && drawerOpen}
              onClick={() => setDrawerOpen(true)}
            >
              ☰ 管理导航 · {navLabelOf(pathname)}
            </button>
          )}
          {narrow && drawerOpen ? <div className="admin-drawer-mask" aria-hidden="true" onClick={closeDrawer} /> : null}
          <nav
            id={narrow ? 'admin-sidebar' : undefined}
            ref={sidebarRef}
            className={`admin-sidebar${narrow && drawerOpen ? ' open' : ''}`}
            aria-label="管理端导航"
            // 窄屏开着的抽屉按对话框语义暴露（role/aria-modal 只在开态加）；关着时靠 inert 不可点不可 Tab
            role={narrow && drawerOpen ? 'dialog' : undefined}
            aria-modal={narrow && drawerOpen ? true : undefined}
            inert={narrow && !drawerOpen}
          >
            {/* 抬头（含唯一的 ×）在抽屉里吸顶：抽屉内容一长就滚，关闭入口不能跟着滚走 */}
            {narrow && (
              <div className="admin-drawer-head">
                <span>管理导航</span>
                <button
                  ref={closeRef}
                  type="button"
                  className="admin-drawer-close"
                  aria-label="关闭管理导航"
                  onClick={closeDrawer}
                >
                  ×
                </button>
              </div>
            )}
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `admin-nav-link${isActive ? ' on' : ''}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <main className="admin-main" inert={narrow && drawerOpen}>
            <Outlet context={user} />
          </main>
        </div>
      ) : (
        <div className="card empty-state">
          <p className="muted">
            这个页面只对管理组开放。不是管理组？回去看
            <a href={TOUR_SITE_URL} target="_blank" rel="noreferrer">
              赛事平台
            </a>
            就好。
          </p>
        </div>
      )}
    </div>
  );
}
