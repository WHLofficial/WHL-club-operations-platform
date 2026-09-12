import { TOUR_SITE_URL, type MeUser } from '../lib/api.ts';

export default function Admin({ user }: { user: MeUser | null | undefined }) {
  return (
    <div className="container">
      <h1>管理端</h1>
      {user?.role === 'admin' ? (
        <div className="card empty-state">
          <p className="muted">管理组工具还没搬进来。建队、导入球员、审核转会都在路上。</p>
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
