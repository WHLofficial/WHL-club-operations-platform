// 球员档案卡（UI_DESIGN §4.2 .dossier：左球员卡 + 右合同卷宗；FC 细分属性收进折叠 details）
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, type PlayerDetail } from '../lib/api.ts';
import {
  AGENT_TIER_LABEL,
  CONTRACT_TYPE_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  nationName,
  playstyleById,
  playstyleIconUrl,
  playstyleIsGold,
  positionName,
  roleChs,
  teamName,
} from '../lib/ref.ts';

const ATTR_LABELS: Record<string, string> = {
  sprintspeed: '冲刺速度',
  acceleration: '加速',
  finishing: '终结',
  positioning: '跑位',
  shotpower: '射门力量',
  longshots: '远射',
  penalties: '点球',
  volleys: '凌空',
  vision: '视野',
  crossing: '传中',
  freekickaccuracy: '任意球',
  longpassing: '长传',
  shortpassing: '短传',
  curve: '弧线',
  agility: '敏捷',
  balance: '平衡',
  reactions: '反应',
  composure: '沉着',
  ballcontrol: '控球',
  dribbling: '盘带',
  interceptions: '拦截',
  headingaccuracy: '头球精度',
  defensiveawareness: '防守意识',
  standingtackle: '站立抢断',
  slidingtackle: '铲断',
  jumping: '弹跳',
  stamina: '体力',
  strength: '力量',
  aggression: '侵略性',
  gkdiving: '扑救',
  gkhandling: '手型',
  gkkicking: '开球',
  gkpositioning: '站位',
  gkreflexes: '反应扑救',
};

const ATTR_ORDER = [
  'sprintspeed',
  'acceleration',
  'finishing',
  'positioning',
  'shotpower',
  'longshots',
  'penalties',
  'volleys',
  'vision',
  'crossing',
  'freekickaccuracy',
  'longpassing',
  'shortpassing',
  'curve',
  'agility',
  'balance',
  'reactions',
  'composure',
  'ballcontrol',
  'dribbling',
  'interceptions',
  'headingaccuracy',
  'defensiveawareness',
  'standingtackle',
  'slidingtackle',
  'jumping',
  'stamina',
  'strength',
  'aggression',
  'gkdiving',
  'gkhandling',
  'gkkicking',
  'gkpositioning',
  'gkreflexes',
];

function PlaystyleBadge({ psid, slot }: { psid: number; slot: number }) {
  const gold = playstyleIsGold(psid, slot);
  const row = playstyleById.get(psid);
  const label = row?.chs ?? row?.en ?? `PS ${psid}`;
  return (
    <span className={`ps-badge${gold ? ' ps-gold' : ''}`} title={gold ? `${label}（金）` : label}>
      <img
        className="ps-icon"
        src={playstyleIconUrl(psid)}
        alt=""
        loading="lazy"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
      <span aria-hidden="true">{gold ? '🥇' : '🥈'}</span>
      <span>{label}</span>
    </span>
  );
}

export default function Player() {
  const { id } = useParams();
  const [data, setData] = useState<PlayerDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    api<PlayerDetail>(`/api/players/${id}`)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '加载球员档案失败'));
  }, [id]);

  if (error) {
    return (
      <div className="container">
        <div className="banner bad">{error}</div>
        <Link className="btn btn-ghost" to="/club">
          回球队中心
        </Link>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="container">
        <div className="card empty-state">
          <p className="muted">正在抽档案…</p>
        </div>
      </div>
    );
  }

  const { player, club, contract } = data;
  const attrs = player.gameAttrs ?? {};
  const nation = nationName(attrs['naID']);
  const team = teamName(attrs['TeamID']);
  const posList = ['PosID1', 'PosID2', 'PosID3', 'PosID4']
    .map((k) => positionName(attrs[k]))
    .filter((v): v is string => v !== null);
  const roles = ['RoleID1', 'RoleID2', 'RoleID3', 'RoleID4', 'RoleID5']
    .map((k) => roleChs(attrs[k]))
    .filter((v): v is string => v !== null);
  const playstyles = (['PSID1', 'PSID2', 'PSID3', 'PSID4', 'PSID5', 'PSID6', 'PSID7', 'PSID13', 'PSID14', 'PSID15'] as const)
    .map((key, i) => {
      const slot = i < 7 ? i + 1 : 13 + (i - 7);
      const psid = Number(attrs[key]);
      return Number.isFinite(psid) && psid !== null && psid > 0 ? { psid, slot } : null;
    })
    .filter((v): v is { psid: number; slot: number } => v !== null);
  const weakfoot = Number(attrs['weakfoot']);
  const skillmoves = Number(attrs['skillmoves']);

  return (
    <div className="container">
      <p className="crumb">
        {club ? (
          <>
            <Link to="/club">{club.name}</Link> 的球员档案
          </>
        ) : (
          '球员档案'
        )}
      </p>
      <div className="dossier">
        <section className="player-card">
          <div className="player-card-head">
            <h2>{player.name}</h2>
            <span className="player-card-badges">
              {player.badgesGold > 0 && <span title="金徽章">🥇×{player.badgesGold}</span>}
              {player.badgesSilver > 0 && <span title="银徽章">🥈×{player.badgesSilver}</span>}
            </span>
          </div>
          <p className="player-card-sub">
            {player.position ?? '位置待定'} · {nation ?? '国籍未知'} · {player.age ?? '—'} 岁 ·{' '}
            {player.foot === 1 ? '右脚' : '左脚'}
          </p>
          <div className="player-card-numbers">
            <div>
              <span className="stat-label">CA</span>
              <span className="mono ca-pa">{player.ca}</span>
            </div>
            <div>
              <span className="stat-label">PA</span>
              <span className="mono ca-pa">{player.pa}</span>
            </div>
            <div>
              <span className="stat-label">身价</span>
              <span className="mono market-value">
                {player.marketValue === null ? '未定价' : `${player.marketValue.toFixed(2)} m`}
              </span>
            </div>
          </div>
          <div className="player-card-foot">
            <span className={`badge ${player.status === 'listed' ? 'sky' : player.status === 'trainee' ? 'purple' : 'gray'}`}>
              {STATUS_LABEL[player.status] ?? player.status}
            </span>
            {player.isFutureStar && <span className="badge gold">未来之星</span>}
            {player.chinaPlan && <span className="badge red">中国计划</span>}
            {player.growthTier > 1 && <span className="badge gray">成长档位 {player.growthTier}</span>}
          </div>
          <p className="player-card-agent">经纪人档位 🕴 {AGENT_TIER_LABEL[player.agentTier] ?? player.agentTier}</p>
        </section>

        <section className="dossier-file">
          <h3>合同卷宗</h3>
          {contract ? (
            <div className="table-wrap">
              <table>
                <tbody>
                  <tr>
                    <th>违约金</th>
                    <td className="num mono">{contract.releaseFee === null ? '—' : `${contract.releaseFee.toFixed(2)} m`}</td>
                  </tr>
                  <tr>
                    <th>工资</th>
                    <td className="num mono">{contract.wage === null ? '—' : `${contract.wage.toFixed(2)} m / 半赛季`}</td>
                  </tr>
                  <tr>
                    <th>效力起点</th>
                    <td className="mono">{contract.effectiveFrom ?? '—'}</td>
                  </tr>
                  <tr>
                    <th>保护期至</th>
                    <td className="mono">{contract.protectedUntil ?? '—'}</td>
                  </tr>
                  <tr>
                    <th>合同类型</th>
                    <td>{CONTRACT_TYPE_LABEL[contract.contractType] ?? contract.contractType}</td>
                  </tr>
                  <tr>
                    <th>成约方式</th>
                    <td>
                      {contract.source ? (
                        <span className={`stamp-inline ${contract.source === 'forced' || contract.source === 'direct' ? 'stamp-inline-force' : 'stamp-inline-ok'}`}>
                          {SOURCE_LABEL[contract.source] ?? contract.source}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <p className="muted">卷宗里还没有合同。签约、续约之后，条款都会收录在这里。</p>
            </div>
          )}

          {player.gameAttrs && (
            <details className="fc-archive">
              <summary>FC 存档（当季源数据）</summary>
              {playstyles.length > 0 && (
                <>
                  <h4>PlayStyles</h4>
                  <div className="ps-list">
                    {playstyles.map(({ psid, slot }) => (
                      <PlaystyleBadge key={`${slot}-${psid}`} psid={psid} slot={slot} />
                    ))}
                  </div>
                </>
              )}
              {roles.length > 0 && (
                <>
                  <h4>场上角色</h4>
                  <p>{roles.join(' · ')}</p>
                </>
              )}
              <div className="attr-grid">
                {ATTR_ORDER.map((key) => {
                  const v = Number(attrs[key]);
                  if (!Number.isFinite(v)) return null;
                  return (
                    <div key={key} className="attr-cell">
                      <span className="attr-name">{ATTR_LABELS[key] ?? key}</span>
                      <span className="mono attr-value">{v}</span>
                    </div>
                  );
                })}
              </div>
              <div className="table-wrap">
                <table>
                  <tbody>
                    <tr>
                      <th>场上位置</th>
                      <td>{posList.length > 0 ? posList.join(' / ') : '—'}</td>
                    </tr>
                    <tr>
                      <th>效力球队（FC 源）</th>
                      <td>{team ?? '—'}</td>
                    </tr>
                    <tr>
                      <th>逆足 / 花式</th>
                      <td>
                        {Number.isFinite(weakfoot) ? weakfoot : '—'} 星 / {Number.isFinite(skillmoves) ? skillmoves : '—'} 星
                      </td>
                    </tr>
                    <tr>
                      <th>身高 / 体重</th>
                      <td>
                        {String(attrs['height'] ?? '—')} cm / {String(attrs['weight'] ?? '—')} kg
                      </td>
                    </tr>
                    <tr>
                      <th>国际声望</th>
                      <td>{player.prestige ?? '—'} / 5</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </section>
      </div>
    </div>
  );
}
