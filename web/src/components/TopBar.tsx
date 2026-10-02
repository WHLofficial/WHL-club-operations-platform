import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { isSuperAdmin, TOUR_SITE_URL, type MeUser } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useUnreadCount } from '../lib/queries.ts';

const ROLE_LABEL: Record<MeUser['role'], string> = { admin: '管理组', coach: '教练', viewer: '观众' };

export default function TopBar() {
  const { user, authMode } = useAuth();
  const unread = useUnreadCount().data ?? 0;
  const barRef = useRef<HTMLElement | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const { pathname } = useLocation();

  // v6.20.0：窄屏顶栏第二行是横滑页签，当前页签可能停在视口外（用户看不出自己在哪）。
  // 路由变化后把 .is-active 滚进视野并居中，只动横向：inline 居中，block 用 'nearest' ——
  // 元素纵向已经完整可见时不动纵向滚动（顶栏 sticky 常驻视口，所以不会把整页顶上去）。
  // 宽屏没有横向溢出，这次调用是无害 no-op；jsdom 没实现 scrollIntoView，先探测再调。
  useEffect(() => {
    const nav = navRef.current;
    const active = nav ? nav.querySelector<HTMLElement>('.nav-tab.is-active') : null;
    if (active && typeof active.scrollIntoView === 'function') {
      // 尊重 reduced-motion（与抽屉过渡同口径，评审 P3-1）：减弱动效时滚入改即时跳转
      const reduce =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      active.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    }
  }, [pathname]);

  // v6.20.0：窄屏页签行的两侧渐隐提示只在「那一侧确实还有没露出来的页签」时出现（样式表
  // v6.22.0 起提档到 ≤1024 块，用 .can-left / .can-right 挂 mask）。滚到头的提示得消失，
  // 否则一条永久渐隐会让首尾页签看起来是灰的。
  // 1px 容差：scrollLeft 是浮点数，整除到边界时可能留 0.5 的残量；宽屏没有横向溢出，两个类都不贴。
  const [navEdges, setNavEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const sync = () => {
      const left = nav.scrollLeft > 1;
      const right = nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1;
      setNavEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
    };
    sync();
    // smooth 滚入（上面那个 effect）与用户手滑都会派发 scroll，所以同一份逻辑挂两种监听
    nav.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    return () => {
      nav.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);

  // 把顶栏实测高度写进 --topbar-h：样式表里 54px（宽屏）/ 102px（窄屏折两行）只是 16px 默认字号
  // 量出来的常量，用户把浏览器默认字号调大后顶栏更高，写死的常量会让所有吸顶元素（球员库左栏、
  // 窄屏工具条）被顶栏压住。内联样式优先级高于 :root 与媒体块，所以这里回写的就是最终值。
  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const apply = () => {
      document.documentElement.style.setProperty('--topbar-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    };
    apply();
    // 观察 border-box：默认的 content-box 观察不到「只改 padding」引起的视觉高度变化
    const observer = new ResizeObserver(apply);
    observer.observe(el, { box: 'border-box' });
    return () => observer.disconnect();
  }, []);

  return (
    <header className="topbar" ref={barRef}>
      <div className="topbar-inner">
        <NavLink to="/" className="brand">
          <img className="brand-logo" src="/assets/brand/whl-badge-96.webp" alt="WHL 徽章" />
          <span>WHL 经理办公室</span>
        </NavLink>
        <nav className={`nav-links${navEdges.left ? ' can-left' : ''}${navEdges.right ? ' can-right' : ''}`} ref={navRef}>
          <NavLink to="/" end className={({ isActive }) => `nav-tab${isActive ? ' is-active' : ''}`}>
            首页
          </NavLink>
          <NavLink to="/club" className={({ isActive }) => `nav-tab${isActive ? ' is-active' : ''}`}>
            球队中心
          </NavLink>
          <NavLink to="/players" className={({ isActive }) => `nav-tab${isActive ? ' is-active' : ''}`}>
            球员库
          </NavLink>
          <NavLink to="/clubs" className={({ isActive }) => `nav-tab${isActive ? ' is-active' : ''}`}>
            球队
          </NavLink>
          <NavLink to="/market" className={({ isActive }) => `nav-tab${isActive ? ' is-active' : ''}`}>
            转会市场
          </NavLink>
          {/* 转会报价（v6.3.0）：教练在球员页与这里都能进；页面本身对非教练显示引导 */}
          <NavLink to="/offers" className={({ isActive }) => `nav-tab${isActive ? ' is-active' : ''}`}>
            转会报价
          </NavLink>
          <NavLink to="/negotiations" className={({ isActive }) => `nav-tab${isActive ? ' is-active' : ''}`}>
            签约谈判
          </NavLink>
          <NavLink to="/ledger" className={({ isActive }) => `nav-tab${isActive ? ' is-active' : ''}`}>
            财政账本
          </NavLink>
          {user?.role === 'admin' && (
            <NavLink to="/admin" className={({ isActive }) => `nav-tab${isActive ? ' is-active' : ''}`}>
              管理端
            </NavLink>
          )}
        </nav>
        <div className="userbox">
          {user === undefined ? null : user ? (
            <>
              <NavLink to="/notifications" className="inbox-link" title="站内信收件篮">
                收件篮
                {unread > 0 && <span className="inbox-unread-dot" aria-label={`${unread} 条未读`} />}
              </NavLink>
              <span className="userbox-name">{user.name}</span>
              {isSuperAdmin(user) && <span className="badge red">超管</span>}
              <span className={`role-badge role-${user.role}`}>{ROLE_LABEL[user.role]}</span>
              {/* 登出仅 OIDC 模式提供：兼容模式的会话真源在赛事系统，club 无从登出。
                  原生表单整页跳转：302 链（club→认证中心→回 club）由浏览器跟随，
                  后端顺带吊销本地会话并清 cookie */}
              {authMode === 'oidc' && (
                <form action="/api/auth/logout" method="post">
                  <button className="btn btn-sm btn-ghost" type="submit">
                    退出登录
                  </button>
                </form>
              )}
            </>
          ) : authMode === 'oidc' ? (
            // OIDC 模式：本站发起 authorize 跳认证中心，需同页导航（回跳状态存 cookie，新开窗口会丢）
            <a className="btn btn-sm" href="/api/auth/login">
              登录
            </a>
          ) : (
            <a className="btn btn-sm cross-tour" href={TOUR_SITE_URL} target="_blank" rel="noreferrer">
              去赛事系统登录
            </a>
          )}
        </div>
      </div>
    </header>
  );
}
