import { useEffect, useRef } from 'react';
import { NavLink } from 'react-router';
import { isSuperAdmin, TOUR_SITE_URL, type MeUser } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useUnreadCount } from '../lib/queries.ts';

const ROLE_LABEL: Record<MeUser['role'], string> = { admin: '管理组', coach: '教练', viewer: '观众' };

export default function TopBar() {
  const { user, authMode } = useAuth();
  const unread = useUnreadCount().data ?? 0;
  const barRef = useRef<HTMLElement | null>(null);

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
        <nav className="nav-links">
          <NavLink to="/" end className={({ isActive }) => `nav-tab${isActive ? ' is-active' : ''}`}>
            首页
          </NavLink>
          <NavLink to="/club" className={({ isActive }) => `nav-tab${isActive ? ' is-active' : ''}`}>
            球队中心
          </NavLink>
          <NavLink to="/players" className={({ isActive }) => `nav-tab${isActive ? ' is-active' : ''}`}>
            球员库
          </NavLink>
          <NavLink to="/market" className={({ isActive }) => `nav-tab${isActive ? ' is-active' : ''}`}>
            转会市场
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
