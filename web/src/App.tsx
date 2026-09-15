import { useEffect, useState } from 'react';
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
import Admin from './pages/Admin.tsx';

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

  return (
    <>
      <TopBar user={user} authMode={authMode} />
      <Routes>
        <Route path="/" element={<Home user={user} authMode={authMode} authHome={authHome} />} />
        <Route path="/club" element={<Club />} />
        <Route path="/bind" element={<Bind />} />
        <Route path="/players" element={<PlayersLibrary />} />
        <Route path="/players/:id" element={<Player />} />
        <Route path="/market" element={<Market />} />
        <Route path="/negotiations" element={<Negotiations />} />
        <Route path="/ledger" element={<Ledger />} />
        <Route path="/admin" element={<Admin user={user} />} />
      </Routes>
    </>
  );
}
