// /club 重定向壳（增量 31 步骤 8）：球队中心的正文已搬进 /clubs/:id 的教练区块。
// 老入口（顶栏「我的球队」、绑定成功页、首页卡片、球员页回链）继续可用，只是到这里就转走。
import { Navigate } from 'react-router';
import { useMyClub } from '../lib/queries.ts';

export default function Club() {
  const { loading, club, failed } = useMyClub();

  if (loading) {
    return (
      <div className="container">
        <div className="card empty-state">
          <p className="muted">正在确认你的球队…</p>
        </div>
      </div>
    );
  }

  // 「没绑队」和「没取到」必须分开：取不到时跳 /bind 会把绑着队的教练送去登记页，而登记页说一账号只能绑一队
  if (failed) {
    return (
      <div className="container">
        <div className="banner warn">
          <p>球队信息暂时取不到，稍后再试。</p>
        </div>
      </div>
    );
  }

  // 没绑俱乐部的人不该停在 /club：直接送登记页（原「去球队登记」按钮的去处）
  if (club === null) return <Navigate to="/bind" replace />;

  return <Navigate to={`/clubs/${club.id}`} replace />;
}
