import { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router';
import TopBar from './components/TopBar.tsx';
import { api, type MeUser } from './lib/api.ts';
import Home from './pages/Home.tsx';
import Club from './pages/Club.tsx';
import Player from './pages/Player.tsx';
import Bind from './pages/Bind.tsx';
import Market from './pages/Market.tsx';
import Ledger from './pages/Ledger.tsx';
import Admin from './pages/Admin.tsx';

export default function App() {
  const [user, setUser] = useState<MeUser | null | undefined>(undefined);

  useEffect(() => {
    api<{ user: MeUser | null }>('/api/me')
      .then((d) => setUser(d.user))
      .catch(() => setUser(null));
  }, []);

  return (
    <>
      <TopBar user={user} />
      <Routes>
        <Route path="/" element={<Home user={user} />} />
        <Route path="/club" element={<Club />} />
        <Route path="/bind" element={<Bind />} />
        <Route path="/players/:id" element={<Player />} />
        <Route path="/market" element={<Market />} />
        <Route path="/ledger" element={<Ledger />} />
        <Route path="/admin" element={<Admin user={user} />} />
      </Routes>
    </>
  );
}
