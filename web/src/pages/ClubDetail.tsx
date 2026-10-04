// 球队详情页（v3.4.0 步骤 7–8；v6.30.0 A 段从平铺长页改成「页头 + 页签」）：
// 页头常驻（队徽/队名/分级徽章/排名徽章/返回），自家（登录者正是本队教练）再加一行账目状态；
// 页签：自家 5 个（工作台/阵容/转会/战绩/主场），访客 3 个（阵容/转会/战绩）。
// URL 口径：/clubs/:id 的 :id 就是平台库 clubs.id（AGENTS.md「代码与提交」节，长期有效）；
// 页签写进 URL 的 ?tab=（不改路径，照 pages/market/desk/MarketDeskPage.tsx 的写法），
// 无参 / 非法值 / 无权页签（访客传 desk|venue）一律回落第一个可见页签，不改写 URL。
// 读量：常驻查询只有 detail + standing + myClub 三个；其余查询挂进对应页签组件，只有激活页签才挂载，
// 自家首屏请求从恒定 7 个降到 4–5 个。结构统计由 GET /api/clubs/:id 一次算完（生产实测 12 条语句 /
// 151–165 行，clubs scope 缓存 24h）；队徽走 /api/media/*（零 D1）。
// 排名由后端代理比赛系统公开积分榜，取不到时后端回 200 + note，这里只负责把 note 传给战绩页签。
import { Link, useParams, useSearchParams } from 'react-router';
import { useClubDetail, useClubStanding, useMyClubOverview } from '../lib/queries.ts';
import { TeamLogo } from '../components/TeamLogo.tsx';
import DeskTab from './club/DeskTab.tsx';
import SquadTab from './club/SquadTab.tsx';
import TransfersTab from './club/TransfersTab.tsx';
import ResultsTab from './club/ResultsTab.tsx';
import VenueTab from './club/VenueTab.tsx';

const TIER_LABEL: Record<'premier' | 'second', string> = {
  premier: '顶级联赛',
  second: '次级联赛',
};

type ClubTab = 'desk' | 'squad' | 'transfers' | 'results' | 'venue';

const TAB_LABEL: Record<ClubTab, string> = {
  desk: '工作台',
  squad: '阵容',
  transfers: '转会',
  results: '战绩',
  venue: '主场',
};

/** 自家页签顺序固定：工作台 → 阵容 → 转会 → 战绩 → 主场；访客只给后三个公开页签 */
const OWN_TABS: ClubTab[] = ['desk', 'squad', 'transfers', 'results', 'venue'];
const GUEST_TABS: ClubTab[] = ['squad', 'transfers', 'results'];

export default function ClubDetail() {
  const params = useParams();
  const id = Number(params.id);
  const valid = Number.isInteger(id) && id > 0;
  const [searchParams, setSearchParams] = useSearchParams();

  const detailQuery = useClubDetail(valid ? id : 0);
  const standingQuery = useClubStanding(valid ? id : 0);
  // 这几个 hook 都必须在任何 early return 之前无条件调用
  const myClubQuery = useMyClubOverview();

  if (!valid) {
    return (
      <div className="container">
        <div className="banner bad">球队 ID 不对。</div>
        <p>
          <Link to="/clubs">回球队列表</Link>
        </p>
      </div>
    );
  }

  const detail = detailQuery.data ?? null;

  if (detailQuery.isError) {
    return (
      <div className="container">
        <div className="banner bad">
          {detailQuery.error instanceof Error ? detailQuery.error.message : '球队档案打不开了，稍后再试'}
        </div>
        <p>
          <Link to="/clubs">回球队列表</Link>
        </p>
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className="container">
        <p className="muted">正在翻查球队档案…</p>
      </div>
    );
  }

  const { club, squad, contracts, transfers, form } = detail;
  const standing = standingQuery.data?.standing ?? null;
  const standingNote = standingQuery.data?.note ?? null;

  // 自家 = 登录者的队就是这支：页签多工作台/主场两个，页头多一行账目状态
  const myOverview = myClubQuery.data ?? null;
  const own = myOverview?.club != null && myOverview.club.id === club.id;
  const visibleTabs = own ? OWN_TABS : GUEST_TABS;
  const tabRaw = searchParams.get('tab');
  const tab: ClubTab = (visibleTabs as string[]).includes(tabRaw ?? '') ? (tabRaw as ClubTab) : visibleTabs[0];

  function goTab(next: ClubTab) {
    if (next === tab) return; // 已在当前页签就别再写一次 URL（避免多一条同址历史记录）
    setSearchParams((p) => {
      const np = new URLSearchParams(p);
      np.set('tab', next);
      return np;
    });
  }

  return (
    <div className="container">
      <div className="club-detail-head">
        <TeamLogo name={club.name} logoKey={club.logoKey} size={48} circle={false} />
        <div className="club-detail-title">
          <h1>{club.name}</h1>
          <div className="club-detail-meta">
            {club.tier === null ? <span className="badge gray">未定级</span> : <span className="badge sky">{TIER_LABEL[club.tier]}</span>}
            {club.isCpu && <span className="badge gray">CPU</span>}
            {standing !== null && <span className="badge blue">联赛第 {standing.position} 名</span>}
          </div>
        </div>
        <Link className="muted club-detail-back" to="/clubs">
          回球队列表
        </Link>
      </div>

      {/* 自家账目状态（v6.30.0：取代原 CoachPanel 的 .card.club-head 三格卡） */}
      {own && myOverview && (
        <div className="club-head-numbers">
          <div className="club-stat">
            <span className="stat-label">资金余额</span>
            <span className="stat-value mono gold-text">{myOverview.balance === null ? '—' : `${myOverview.balance.toFixed(2)} m`}</span>
          </div>
          <div className="club-stat">
            <span className="stat-label">一线队人数</span>
            <span className="stat-value mono">{myOverview.squadCount ?? '—'} 人</span>
          </div>
          <div className="club-stat">
            <span className="stat-label">当前窗口</span>
            <span className="stat-value stat-value-small">
              {myOverview.window ? `第 ${myOverview.window.season} 赛季 · 窗口 ${myOverview.window.windowSeq}` : '还没开'}
            </span>
          </div>
        </div>
      )}

      <div className="seg dossier-tabs" role="radiogroup" aria-label="球队页签">
        {visibleTabs.map((t) => (
          <button key={t} type="button" className={tab === t ? 'on' : ''} onClick={() => goTab(t)}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === 'desk' && myOverview && <DeskTab overview={myOverview} />}
      {tab === 'squad' && <SquadTab clubId={club.id} squad={squad} />}
      {tab === 'transfers' && <TransfersTab contracts={contracts} transfers={transfers} />}
      {tab === 'results' && <ResultsTab standing={standing} standingNote={standingNote} form={form} />}
      {tab === 'venue' && myOverview && <VenueTab home={myOverview.home} />}
    </div>
  );
}
