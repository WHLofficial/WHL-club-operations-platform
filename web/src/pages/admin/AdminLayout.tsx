// 管理端壳布局：左侧栏 8 项导航 + 子路由出口（v2.1.0 拆分）。
// 非 admin 看到的提示卡与旧 Admin.tsx 一致，不重定向。
import { NavLink, Outlet } from 'react-router';
import { TOUR_SITE_URL } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';

const NAV_ITEMS: { to: string; label: string; end?: boolean }[] = [
  { to: '/admin', label: '总览', end: true },
  { to: '/admin/seasons', label: '赛季' },
  { to: '/admin/players', label: '球员' },
  { to: '/admin/imports', label: '导入' },
  { to: '/admin/market', label: '转会' },
  { to: '/admin/clubs', label: '俱乐部' },
  { to: '/admin/finance', label: '财政' },
  { to: '/admin/system', label: '系统' },
];

export default function AdminLayout() {
  const { user } = useAuth();
  return (
    <div className="container">
      <h1>管理端</h1>
      {user?.role === 'admin' ? (
        <div className="admin-shell">
          <nav className="admin-sidebar" aria-label="管理端导航">
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
          <main className="admin-main">
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
