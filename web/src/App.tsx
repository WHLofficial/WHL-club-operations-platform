import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useSearchParams } from 'react-router';
import TopBar from './components/TopBar.tsx';
import RequireUser from './components/RequireUser.tsx';
import { useAuth } from './lib/auth.tsx';
import Home from './pages/Home.tsx';
import Club from './pages/Club.tsx';
import Player from './pages/Player.tsx';
import PlayersLibrary from './pages/PlayersLibrary.tsx';
import Clubs from './pages/Clubs.tsx';
import ClubDetail from './pages/ClubDetail.tsx';
import Bind from './pages/Bind.tsx';
import Ledger from './pages/Ledger.tsx';
import Notifications from './pages/Notifications.tsx';
import { APP_VERSION } from './lib/version.ts';

// 市场五页按页拆 chunk（v2.2.0 起三页，v6.18.0 加市场情报，v6.24.0 加激活页）：在售市场/市场情报公开，海捞/激活/转会台要登录
const MarketBoardPage = lazy(() => import('./pages/market/MarketBoardPage.tsx'));
const MarketFreePage = lazy(() => import('./pages/market/MarketFreePage.tsx'));
// 激活（v6.24.0）：从海捞页拆出，激活挂牌 + 首价落定一页走完
const MarketActivationPage = lazy(() => import('./pages/market/MarketActivationPage.tsx'));
const MarketIntelPage = lazy(() => import('./pages/market/MarketIntelPage.tsx'));
// 转会台（v6.23.0）：市场「我的」+ 转会报价 + 签约谈判三域合并成一页
const MarketDeskPage = lazy(() => import('./pages/market/desk/MarketDeskPage.tsx'));

// 旧路由退役（v6.23.0）：/offers 与 /negotiations 换址到转会台，保留 box 参数、replace 不留历史栈；
// 登录拦截交给 desk 路由自己（RequireUser）。/market/mine 一并退役，不再保留路由。
function OffersRedirect() {
  const [params] = useSearchParams();
  const box = params.get('box') === 'out' ? 'out' : 'in';
  return <Navigate replace to={`/market/desk?tab=offers&box=${box}`} />;
}

function NegotiationsRedirect() {
  return <Navigate replace to="/market/desk?tab=nego" />;
}

// 管理端按页拆 chunk（v2.1.0）：壳 + 8 子页全部懒加载，不再全量进主包
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout.tsx'));
const AdminOverviewPage = lazy(() => import('./pages/admin/OverviewPage.tsx'));
const AdminSeasonsPage = lazy(() => import('./pages/admin/SeasonsPage.tsx'));
const AdminPlayersPage = lazy(() => import('./pages/admin/PlayersPage.tsx'));
const AdminGrowthPage = lazy(() => import('./pages/admin/GrowthEntryPage.tsx'));
const AdminImportsPage = lazy(() => import('./pages/admin/ImportsPage.tsx'));
const AdminMarketPage = lazy(() => import('./pages/admin/MarketPage.tsx'));
const AdminClubsPage = lazy(() => import('./pages/admin/ClubsPage.tsx'));
// CPU 接管向导（v6.27.0）：从俱乐部管理 CPU 行的入口进，侧栏不加项
const AdminCpuConvertPage = lazy(() => import('./pages/admin/CpuConvertPage.tsx'));
const AdminBrandsPage = lazy(() => import('./pages/admin/BrandsPage.tsx'));
const AdminEventsPage = lazy(() => import('./pages/admin/EventsPage.tsx'));
const AdminShopPage = lazy(() => import('./pages/admin/AdminShopPage.tsx'));
const ShopPage = lazy(() => import('./pages/shop/ShopPage.tsx'));
const AdminFinancePage = lazy(() => import('./pages/admin/FinancePage.tsx'));
const AdminSystemPage = lazy(() => import('./pages/admin/SystemPage.tsx'));

export default function App() {
  const { user } = useAuth();

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
      <TopBar />
      {/* 只有管理端是懒加载 chunk，Suspense 实际只在进 /admin 时兜住首帧 */}
      <Suspense
        fallback={
          <div className="page-loading" role="status" aria-label="加载中">
            <p>加载中…</p>
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<Home />} />
          <Route
            path="/club"
            element={
              <RequireUser>
                <Club />
              </RequireUser>
            }
          />
          <Route
            path="/bind"
            element={
              <RequireUser>
                <Bind />
              </RequireUser>
            }
          />
          <Route path="/players" element={<PlayersLibrary />} />
          <Route path="/players/:id" element={<Player />} />
          <Route path="/clubs" element={<Clubs />} />
          <Route
            path="/clubs/:id"
            element={
              <RequireUser>
                <ClubDetail />
              </RequireUser>
            }
          />
          <Route path="/market" element={<MarketBoardPage />} />
          <Route
            path="/market/free"
            element={
              <RequireUser>
                <MarketFreePage />
              </RequireUser>
            }
          />
          {/* 激活（v6.24.0）：从海捞页拆出，须登录 */}
          <Route
            path="/market/activation"
            element={
              <RequireUser>
                <MarketActivationPage />
              </RequireUser>
            }
          />
          <Route path="/market/intel" element={<MarketIntelPage />} />
          {/* 转会台（v6.23.0）：原「我的」(/market/mine) + /offers + /negotiations 三处入口合并到这里 */}
          <Route
            path="/market/desk"
            element={
              <RequireUser>
                <MarketDeskPage />
              </RequireUser>
            }
          />
          {/* 消费中心（v6.26.0）：五类商品 + 球场消费三卡；须登录（页内按教练身份收表单） */}
          <Route
            path="/shop"
            element={
              <RequireUser>
                <ShopPage />
              </RequireUser>
            }
          />
          {/* 旧地址换址：不需要登录拦截，desk 路由自己会拦；replace 不留历史栈 */}
          <Route path="/offers" element={<OffersRedirect />} />
          <Route path="/negotiations" element={<NegotiationsRedirect />} />
          <Route
            path="/ledger"
            element={
              <RequireUser>
                <Ledger />
              </RequireUser>
            }
          />
          <Route
            path="/notifications"
            element={
              <RequireUser>
                <Notifications />
              </RequireUser>
            }
          />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminOverviewPage />} />
            <Route path="seasons" element={<AdminSeasonsPage />} />
            <Route path="players" element={<AdminPlayersPage />} />
            <Route path="growth" element={<AdminGrowthPage />} />
            <Route path="imports" element={<AdminImportsPage />} />
            <Route path="market" element={<AdminMarketPage />} />
            <Route path="clubs" element={<AdminClubsPage />} />
            <Route path="clubs/cpu-convert" element={<AdminCpuConvertPage />} />
            <Route path="brands" element={<AdminBrandsPage />} />
            <Route path="events" element={<AdminEventsPage />} />
            <Route path="shop" element={<AdminShopPage />} />
            <Route path="finance" element={<AdminFinancePage />} />
            <Route path="system" element={<AdminSystemPage />} />
          </Route>
        </Routes>
      </Suspense>
      <footer className="app-footer">WHL 俱乐部运营平台 · v{APP_VERSION}</footer>
    </>
  );
}
