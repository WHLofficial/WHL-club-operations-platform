// 球队页（增量 31 步骤 4）：全联盟球队总览，按分级分段展示。
// 公开页、无筛选无分页 —— 生产只有 20 支球队，一屏放得下（分级分段卡片）。
// 数据一次取完（服务端 clubs scope 缓存 24h + 前端全局 staleTime 30s），队徽走 /api/media/*（零 D1 读）。
// URL 口径：本页链接一律 /clubs/:id，:id 就是平台库 clubs.id（AGENTS.md「代码与提交」节，长期有效）。
import { Link } from 'react-router';
import { useClubsList } from '../lib/queries.ts';
import type { ClubSummary } from '../lib/api.ts';
import { TeamLogo } from '../components/TeamLogo.tsx';

// 金额口径与球员库一致（身价/工资都以「m」为单位存储）
function money(x: number): string {
  return `${x.toFixed(2)} m`;
}

const SEGMENTS: { key: 'premier' | 'second' | 'none'; title: string; hint: string }[] = [
  { key: 'premier', title: '顶级联赛', hint: '本赛季定级在顶级联赛' },
  { key: 'second', title: '次级联赛', hint: '本赛季定级在次级联赛' },
  { key: 'none', title: '未定级', hint: '本赛季还没有报名定级赛事' },
];

function segmentOf(c: ClubSummary): 'premier' | 'second' | 'none' {
  return c.tier ?? 'none';
}

function ClubCard({ club }: { club: ClubSummary }) {
  const { senior, trainee } = club.squad;
  return (
    <Link to={`/clubs/${club.id}`} className="card club-card">
      <div className="club-card-head">
        <TeamLogo name={club.name} logoKey={club.logoKey} size={32} />
        <span className="club-name">{club.name}</span>
        {club.isCpu && <span className="badge gray">CPU</span>}
      </div>
      <dl className="club-metrics">
        <div>
          <dt>阵容</dt>
          <dd>
            {senior} 人
            {trainee > 0 && <span className="muted"> + {trainee} 青训</span>}
          </dd>
        </div>
        <div>
          <dt>平均 CA</dt>
          <dd>{club.avgCa === null ? '—' : club.avgCa.toFixed(1)}</dd>
        </div>
        <div>
          <dt>总身价</dt>
          <dd>{money(club.totalValue)}</dd>
        </div>
        <div>
          <dt>工资总额</dt>
          <dd>{money(club.totalWage)}</dd>
        </div>
      </dl>
    </Link>
  );
}

export default function Clubs() {
  const { data, isError, error } = useClubsList();
  const clubs = data?.clubs ?? null;

  return (
    <div className="container">
      <h1>球队</h1>
      {isError && <div className="banner warn">{error instanceof Error ? error.message : '球队名单打不开了，稍后再试'}</div>}

      {clubs === null ? (
        isError ? null : (
          <p className="muted">正在点名…</p>
        )
      ) : clubs.length === 0 ? (
        <div className="empty-state">
          <p className="muted">还没有球队入驻。</p>
        </div>
      ) : (
        SEGMENTS.map((seg) => {
          const rows = clubs.filter((c) => segmentOf(c) === seg.key);
          if (rows.length === 0) return null;
          return (
            <section className="club-segment" key={seg.key}>
              <div className="tier-head">
                <h3>{seg.title}</h3>
                <span className="muted">
                  {rows.length} 支 · {seg.hint}
                </span>
              </div>
              <div className="club-grid">
                {rows.map((c) => (
                  <ClubCard key={c.id} club={c} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
