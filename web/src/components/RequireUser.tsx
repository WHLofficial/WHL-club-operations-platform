// 用户端登录守卫（v2.2.0）：匿名看软提示卡，不重定向（与 AdminLayout 的管理端软卡同一风格）。
// viewer（登录但无俱乐部）不挡——页面自己处理 club=null 的空态。
import type { ReactNode } from 'react';
import { TOUR_SITE_URL } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';

export default function RequireUser({ children }: { children: ReactNode }) {
  const { user, authMode } = useAuth();
  if (user === undefined) {
    return (
      <div className="container">
        <div className="card empty-state">
          <p className="muted">加载中…</p>
        </div>
      </div>
    );
  }
  if (user === null) {
    return (
      <div className="container">
        <div className="card empty-state">
          <p className="muted">
            这个页面要登录后才能用。{' '}
            {authMode === 'oidc' ? (
              <a href="/api/auth/login">统一登录</a>
            ) : (
              <a href={TOUR_SITE_URL} target="_blank" rel="noreferrer">
                去赛事系统登录
              </a>
            )}
            ，再回来继续。
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
