import { NavLink } from 'react-router';
import { TOUR_SITE_URL, type AuthMode, type MeUser } from '../lib/api.ts';

const ROLE_LABEL: Record<MeUser['role'], string> = { admin: '管理组', coach: '教练', viewer: '观众' };

export default function TopBar({ user, authMode }: { user: MeUser | null | undefined; authMode: AuthMode }) {
  return (
    <header className="topbar">
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
              <span className="userbox-name">{user.name}</span>
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
