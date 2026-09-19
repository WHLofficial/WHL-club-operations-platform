import { lazy, Suspense, useEffect, useState } from 'react';
import { Route, Routes } from 'react-router';
import TopBar from './components/TopBar.tsx';
import { api, type AuthMode, type MeUser } from './lib/api.ts';
import Home from './pages/Home.tsx';
import Club from './pages/Club.tsx';
import Player from './pages/Player.tsx';
import PlayersLibrary from './pages/PlayersLibrary.tsx';
import Bind from './pages/Bind.tsx';
import Market from './pages/Market.tsx';
import Negotiations from './pages/Negotiations.tsx';
import Ledger from './pages/Ledger.tsx';

// 管理端按页拆 chunk（增量 15）：壳 + 8 子页全部懒加载，不再全量进主包
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout.tsx'));
const AdminOverviewPage = lazy(() => import('./pages/admin/OverviewPage.tsx'));
const AdminSeasonsPage = lazy(() => import('./pages/admin/SeasonsPage.tsx'));
const AdminPlayersPage = lazy(() => import('./pages/admin/PlayersPage.tsx'));
const AdminImportsPage = lazy(() => import('./pages/admin/ImportsPage.tsx'));
const AdminMarketPage = lazy(() => import('./pages/admin/MarketPage.tsx'));
const AdminClubsPage = lazy(() => import('./pages/admin/ClubsPage.tsx'));
const AdminFinancePage = lazy(() => import('./pages/admin/FinancePage.tsx'));
const AdminSystemPage = lazy(() => import('./pages/admin/SystemPage.tsx'));

export default function App() {
  const [user, setUser] = useState<MeUser | null | undefined>(undefined);
  const [authMode, setAuthMode] = useState<AuthMode>('shared');
  const [authHome, setAuthHome] = useState<string | null>(null);

  useEffect(() => {
    api<{ user: MeUser | null; authMode?: AuthMode; authHome?: string | null; syncProbe?: boolean }>('/api/me')
      .then((d) => {
        setUser(d.user);
        // 旧后端（未发版）不回 authMode：维持 shared 旧行为，前端不因部署顺序而坏
        setAuthMode(d.authMode ?? 'shared');
        setAuthHome(d.authHome ?? null);
        // 进站即探测：匿名 + oidc 模式 + 不在冷却期（后端 syncProbe 判定）→ 无感同步登录态。
        // 回跳目标由 /api/auth/sync 的 back 参数记录；冷却中 syncProbe 为空，防循环
        if (d.syncProbe) {
          window.location.href = `/api/auth/sync?back=${encodeURIComponent(location.pathname + location.search)}`;
          return;
        }
      })
      .catch(() => setUser(null));
  }, []);

  // 登录态在途（me 未回来）：不渲染任何内容防「匿名→登录态」跳变闪屏；
  // me 带 syncProbe 时整页跳探测，看到的只是一瞬「加载中」
  if (user === undefined) {
    return (
      <div className="page-loading" role="status" aria-label="加载中">
        <p>加载中…</p>
      </div>
    );
  }

  return (
    <>
      <TopBar user={user} authMode={authMode} />
      {/* 只有管理端是懒加载 chunk，Suspense 实际只在进 /admin 时兜住首帧 */}
      <Suspense
        fallback={
          <div className="page-loading" role="status" aria-label="加载中">
            <p>加载中…</p>
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<Home user={user} authMode={authMode} authHome={authHome} />} />
          <Route path="/club" element={<Club />} />
          <Route path="/bind" element={<Bind />} />
          <Route path="/players" element={<PlayersLibrary />} />
          <Route path="/players/:id" element={<Player />} />
          <Route path="/market" element={<Market />} />
          <Route path="/negotiations" element={<Negotiations />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/admin" element={<AdminLayout user={user} />}>
            <Route index element={<AdminOverviewPage />} />
            <Route path="seasons" element={<AdminSeasonsPage />} />
            <Route path="players" element={<AdminPlayersPage />} />
            <Route path="imports" element={<AdminImportsPage />} />
            <Route path="market" element={<AdminMarketPage />} />
            <Route path="clubs" element={<AdminClubsPage />} />
            <Route path="finance" element={<AdminFinancePage />} />
            <Route path="system" element={<AdminSystemPage />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}
