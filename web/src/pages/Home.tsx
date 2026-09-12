import { NavLink } from 'react-router';
import { TOUR_SITE_URL, type MeUser } from '../lib/api.ts';

export default function Home({ user }: { user: MeUser | null | undefined }) {
  return (
    <div className="container">
      <section className="card home-hero">
        <h1>经理办公室</h1>
        {user === undefined ? null : user ? (
          <p>
            欢迎回来，<b>{user.name}</b>。今天也是经营俱乐部的一天。
          </p>
        ) : (
          <p>
            这里是 WHL 俱乐部运营平台。先用赛事系统账号
            <a href={TOUR_SITE_URL} target="_blank" rel="noreferrer">
              登录
            </a>
            ，再回来打理你的球队。
          </p>
        )}
        {user?.mustChangePw && (
          <div className="banner warn">
            密码刚被赛事系统重置，请先到
            <a href={TOUR_SITE_URL} target="_blank" rel="noreferrer">
              赛事系统
            </a>
            设置新密码，再回来继续。
          </div>
        )}
        {user?.role === 'viewer' && (
          <div className="banner info">观众视角：市场与球员资料都能看，转会操作要等绑定俱乐部之后。</div>
        )}
      </section>

      <div className="nav-cards">
        <NavLink to="/club" className="card nav-card">
          <h3>球队中心</h3>
          <p className="muted">阵容名单、注册合规与球队资金，以后都在这一页打理。</p>
        </NavLink>
        <NavLink to="/market" className="card nav-card">
          <h3>转会市场</h3>
          <p className="muted">还没有挂牌。窗口开了之后，这里就是市场。</p>
        </NavLink>
        <NavLink to="/ledger" className="card nav-card">
          <h3>财政账本</h3>
          <p className="muted">期初余额导入之后，每一笔收支都会记进这本流水账。</p>
        </NavLink>
        {user?.role === 'admin' && (
          <NavLink to="/admin" className="card nav-card">
            <h3>管理端</h3>
            <p className="muted">建队、导入球员、审核转会——管理组的工具台。</p>
          </NavLink>
        )}
      </div>

      <footer className="home-footer">
        <a className="btn cross-tour" href={TOUR_SITE_URL} target="_blank" rel="noreferrer">
          去赛事平台
        </a>
        <a className="btn cross-guess" href="https://guess.whleague.win/" target="_blank" rel="noreferrer">
          去竞猜系统
        </a>
      </footer>
    </div>
  );
}
