import { NavLink } from 'react-router';
import type { MeUser } from '../lib/api.ts';

const ROLE_LABEL: Record<MeUser['role'], string> = { admin: '管理组', coach: '教练', viewer: '观众' };

export default function TopBar({ user }: { user: MeUser | null | undefined }) {
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
            </>
          ) : (
            <a
              className="btn btn-sm cross-tour"
              href="https://whleague.win/"
              target="_blank"
              rel="noreferrer"
            >
              去赛事系统登录
            </a>
          )}
        </div>
      </div>
    </header>
  );
}
