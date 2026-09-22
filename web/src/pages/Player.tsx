// 球员卡（UI_DESIGN §4.2 .dossier：左球员卡常驻 + 右页签区，增量 6.1 d9 改 E2 页内页签：
// 合同=合同卷宗；属性=FC 源数据（细分属性/位置/角色/花式逆足等）；成长=XP 记录与升级）
// 成长记录区（§10）：XP 进度条、升级方案二选一（本队教练/管理组）、徽章墙、事件时间线
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiPost, GROWTH_EVENT_LABEL, type GrowthDetail, type LevelUpResult, type PlayerDetail } from '../lib/api.ts';
import {
  AGENT_TIER_LABEL,
  ATTR_GROUPS,
  ATTR_LABELS,
  CONTRACT_TYPE_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  nationName,
  playstyleBadges,
  playstyleById,
  playstyleIconUrl,
  positionName,
  roleChs,
  teamName,
} from '../lib/ref.ts';
import { useToast } from '../lib/toast.tsx';

type PlayerTab = 'profile' | 'attrs' | 'growth';

const TAB_LABEL: Record<PlayerTab, string> = {
  profile: '合同',
  attrs: '属性',
  growth: '成长',
};

// 细分色阶（四裁决：绿>=70 / 橙 50-69 / 红<50）
function attrClass(v: number): string {
  if (v >= 70) return 'attr-good';
  if (v >= 50) return 'attr-mid';
  return 'attr-low';
}

function starText(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  return '★'.repeat(Math.min(n, 5)) + '☆'.repeat(Math.max(0, 5 - n));
}

// 雷达轴（增量 6.1 d11，四裁决：外场 PAC/SHO/PAS/DRI/DEF/PHY；门将换轴 DIV/HAN/KIC/REF/POS/SPD，SPD=均(冲刺,加速)）
const GK_RADAR = [
  { key: 'DIV', label: '扑救', keys: ['gkdiving'] },
  { key: 'HAN', label: '手型', keys: ['gkhandling'] },
  { key: 'KIC', label: '开球', keys: ['gkkicking'] },
  { key: 'REF', label: '反应', keys: ['gkreflexes'] },
  { key: 'POS', label: '站位', keys: ['gkpositioning'] },
  { key: 'SPD', label: '速度', keys: ['sprintspeed', 'acceleration'] },
] as const;

function groupAverage(keys: readonly string[], attrs: Record<string, unknown>): number | null {
  const vals = keys.map((k) => Number(attrs[k])).filter((v) => Number.isFinite(v));
  return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}

// 六维雷达（静态 SVG，无动画）：组值=组内平均，归一到 99
function AttrRadar({ values }: { values: { key: string; label: string; value: number | null }[] }) {
  const cx = 100;
  const cy = 100;
  const R = 70;
  const n = values.length;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt = (i: number, r: number) => `${(cx + r * Math.cos(angle(i))).toFixed(2)},${(cy + r * Math.sin(angle(i))).toFixed(2)}`;
  const dataPts = values
    .map((v, i) => pt(i, (R * Math.min(Math.max(v.value ?? 0, 0), 99)) / 99))
    .join(' ');
  return (
    <svg className="attr-radar-svg" viewBox="0 0 200 200" role="img" aria-label="六维雷达">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} className="radar-grid" points={values.map((_, i) => pt(i, R * f)).join(' ')} />
      ))}
      {values.map((v, i) => {
        const x = cx + (R + 13) * Math.cos(angle(i));
        const y = cy + (R + 13) * Math.sin(angle(i));
        const anchor = Math.abs(Math.cos(angle(i))) < 0.3 ? 'middle' : Math.cos(angle(i)) > 0 ? 'start' : 'end';
        return (
          <g key={v.key}>
            <line className="radar-axis" x1={cx} y1={cy} x2={cx + R * Math.cos(angle(i))} y2={cy + R * Math.sin(angle(i))} />
            <text className="radar-label" x={x} y={y} textAnchor={anchor} dominantBaseline="middle">
              {v.key}
            </text>
          </g>
        );
      })}
      {values.some((v) => (v.value ?? 0) > 0) && <polygon className="radar-data" points={dataPts} />}
    </svg>
  );
}

function PlaystyleBadge({ psid, gold }: { psid: number; gold: boolean }) {
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
  const qc = useQueryClient();
  const [tab, setTab] = useState<PlayerTab>('profile');
  const { show, toastNode } = useToast();
  const [armedPlan, setArmedPlan] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const dataQuery = useQuery({
    queryKey: ['player', id ?? ''],
    queryFn: () => api<PlayerDetail>(`/api/players/${id}`),
    enabled: id !== undefined,
  });
  // 成长记录拉失败按 null 展示（旧行为 .catch(() => setGrowth(null))）
  const growthQuery = useQuery({
    queryKey: ['player', id ?? '', 'growth'],
    queryFn: () => api<GrowthDetail>(`/api/players/${id}/growth`),
    enabled: id !== undefined,
  });
  const data = dataQuery.data ?? null;
  const growth = growthQuery.data ?? null;
  const refreshAll = () => void qc.invalidateQueries({ queryKey: ['player', id ?? ''] });

  async function choosePlan(planIndex: number) {
    if (busy || !growth) return;
    if (armedPlan !== planIndex) {
      setArmedPlan(planIndex);
      return;
    }
    setBusy(true);
    try {
      const r = await apiPost<LevelUpResult>(`/api/growth/levelup/${growth.player.id}`, { planIndex });
      const parts = [`+${r.plan.ca} CA`];
      if (r.plan.silver > 0) parts.push(`银徽章 +${r.plan.silver}`);
      if (r.plan.gold > 0) parts.push(`金徽章 +${r.plan.gold}`);
      show(`升级完成：${parts.join('，')}。还剩 ${r.pendingLeft} 次待升级。`);
      setArmedPlan(null);
      refreshAll();
    } catch (err) {
      show(err instanceof Error ? err.message : '升级失败', true);
      setArmedPlan(null);
    } finally {
      setBusy(false);
    }
  }

  if (dataQuery.isError) {
    return (
      <div className="container">
        <div className="banner bad">{dataQuery.error instanceof Error ? dataQuery.error.message : '加载球员合同失败'}</div>
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
          <p className="muted">正在调阅合同卷宗…</p>
        </div>
      </div>
    );
  }

  const { player, club, contract } = data;
  const attrs = player.gameAttrs ?? {};
  const nation = nationName(attrs['naID']);

  return (
    <div className="container">
      {toastNode}
      <p className="crumb">
        {club ? (
          <>
            <Link to="/club">{club.name}</Link> 的球员合同
          </>
        ) : (
          '球员合同'
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
            {player.growable ? <span className="badge sky">可成长</span> : <span className="badge gray">非成长</span>}
            {player.isFutureStar && <span className="badge gold">未来之星</span>}
            {player.chinaPlan && <span className="badge red">中国计划</span>}
            {player.growthTier > 1 && <span className="badge gray">成长档位 {player.growthTier}</span>}
          </div>
          <p className="player-card-agent">经纪人性格 🕴 {AGENT_TIER_LABEL[player.agentTier] ?? player.agentTier}</p>
        </section>

        <section className="dossier-file">
          <div className="seg dossier-tabs" role="radiogroup" aria-label="球员页签">
            {(Object.keys(TAB_LABEL) as PlayerTab[]).map((t) => (
              <button key={t} type="button" className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>

          {tab === 'profile' && (
            <>
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
                        <th>签约赛季</th>
                        <td className="mono">
                          {contract.signedSeason === null ? '—' : `S${contract.signedSeason}${contract.signedWindowSeq ? ` 第 ${contract.signedWindowSeq} 窗` : ''}`}
                        </td>
                      </tr>
                      <tr>
                        <th>效力时长</th>
                        <td className="mono">{contract.serviceSeasons.toFixed(1)} 赛季</td>
                      </tr>
                      <tr>
                        <th>保护期</th>
                        <td className="mono">{contract.protected ? '保护中' : '非保护'}</td>
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
            </>
          )}

          {tab === 'attrs' && player.gameAttrs && (
            <AttrSheet attrs={attrs} position={player.position} prestige={player.prestige} />
          )}

          {tab === 'growth' && growth && <GrowthBlock growth={growth} armedPlan={armedPlan} busy={busy} onChoosePlan={choosePlan} />}
          {tab === 'growth' && !growth && (
            <div className="empty-state">
              <p className="muted">成长记录还没就绪。</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// 属性页签（增量 6.1 d10）：位置矩阵 + 角色带 + 星级行 + 六组细分卡（门将七组）；d11 加六维雷达
function AttrSheet({
  attrs,
  position,
  prestige,
}: {
  attrs: Record<string, unknown>;
  position: string | null;
  prestige: number | null;
}) {
  const team = teamName(attrs['TeamID']);
  const posChips = ['PosID1', 'PosID2', 'PosID3', 'PosID4']
    .map((k) => positionName(attrs[k]))
    .filter((v): v is string => v !== null);
  const roles = ['RoleID1', 'RoleID2', 'RoleID3', 'RoleID4', 'RoleID5']
    .map((k) => roleChs(attrs[k]))
    .filter((v): v is string => v !== null);
  // 15 槽全扫（银 1-12 + 金 13-15），只有有值的槽进清单；槽位键与金/银判定都来自 core 与 ref，
  // 页面里不再手抄槽号（手抄的那版只列了 PSID1-7 + PSID13-15，PSID8-12 的银徽章看不见）
  const playstyles = playstyleBadges(attrs);
  const weakfoot = Number(attrs['weakfoot']);
  const skillmoves = Number(attrs['skillmoves']);
  const isGk = position === 'GK';
  const groups = ATTR_GROUPS.filter((g) => isGk || g.key !== 'GKP');
  const radarAxes = isGk ? GK_RADAR : ATTR_GROUPS.slice(0, 6);
  const radarValues = radarAxes.map((g) => ({ key: g.key, label: g.label, value: groupAverage(g.keys, attrs) }));
  return (
    <>
      <h3>FC 属性（当季源数据）</h3>
      <div className="pos-row">
        <div className="pos-chips">
          {posChips.length > 0 ? (
            posChips.map((p, i) => (
              <span key={p} className={i === 0 ? 'pos-chip pos-chip-main' : 'pos-chip'}>
                {p}
              </span>
            ))
          ) : (
            <span className="pos-chip">—</span>
          )}
        </div>
        {team && <span className="pos-team">来源球队 {team}</span>}
      </div>
      {roles.length > 0 && (
        <div className="role-chips">
          {roles.map((r, i) => (
            <span
              key={`${r}-${i}`}
              className={r.includes('++') ? 'role-chip role-plusplus' : /\+\s*$/.test(r) ? 'role-chip role-plus' : 'role-chip'}
            >
              {r}
            </span>
          ))}
        </div>
      )}
      <div className="star-line">
        <div className="star-cell">
          <span className="attr-name">花式</span>
          <span className="mono">{starText(skillmoves)}</span>
        </div>
        <div className="star-cell">
          <span className="attr-name">逆足</span>
          <span className="mono">{starText(weakfoot)}</span>
        </div>
        <div className="star-cell">
          <span className="attr-name">国际声望</span>
          <span className="mono">{starText(prestige ?? NaN)}</span>
        </div>
        <div className="star-cell">
          <span className="attr-name">身高 / 体重</span>
          <span className="mono">
            {String(attrs['height'] ?? '—')} cm / {String(attrs['weight'] ?? '—')} kg
          </span>
        </div>
      </div>
      <div className="attr-group-grid">
        {groups.map((g) => {
          const avg = groupAverage(g.keys, attrs);
          return (
            <div key={g.key} className="attr-group-card">
              <div className="attr-group-head">
                <span className="attr-group-key">{g.key}</span>
                <span className="attr-name">{g.label}</span>
                <span className={`mono attr-group-avg ${avg !== null ? attrClass(avg) : ''}`}>{avg ?? '—'}</span>
              </div>
              <div className="attr-group-detail">
                {g.keys.map((k) => {
                  const v = Number(attrs[k]);
                  if (!Number.isFinite(v)) return null;
                  return (
                    <div key={k} className="attr-cell">
                      <span className="attr-name">{ATTR_LABELS[k] ?? k}</span>
                      <span className={`mono attr-value ${attrClass(v)}`}>{v}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="attr-radar">
        <AttrRadar values={radarValues} />
        <div className="radar-legend">
          <h4>{isGk ? '门将六维' : '外场六维'}</h4>
          {radarValues.map((v) => (
            <div key={v.key} className="radar-legend-row">
              <span className="mono radar-legend-key">{v.key}</span>
              <span className="attr-name">{v.label}</span>
              <span className={`mono ${v.value !== null ? attrClass(v.value) : ''}`}>{v.value ?? '—'}</span>
            </div>
          ))}
        </div>
      </div>
      {playstyles.length > 0 && (
        <>
          <h4>PlayStyles</h4>
          <div className="ps-list">
            {playstyles.map((b) => (
              <PlaystyleBadge key={`${b.slot}-${b.psid}`} psid={b.psid} gold={b.gold} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

// 成长记录块（§10）：放合同卷宗下方，FC 存档之前
function GrowthBlock({
  growth,
  armedPlan,
  busy,
  onChoosePlan,
}: {
  growth: GrowthDetail;
  armedPlan: number | null;
  busy: boolean;
  onChoosePlan: (planIndex: number) => void;
}) {
  const p = growth.player;
  const xpInLevel = Math.floor(p.growthXp) % p.xpPerLevel;
  const pct = Math.min(100, Math.round((xpInLevel / p.xpPerLevel) * 100));
  const toNext = p.xpPerLevel - xpInLevel;
  return (
    <div className="growth-block">
      <h3>成长记录</h3>
      <p className="growth-xp-row">
        <span className="mono growth-xp-num">{Math.floor(p.growthXp)} XP</span>
        <span className="growth-bar" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
        <span className="muted">{toNext} XP 升一级</span>
        {p.pendingLevelUps > 0 && <span className="badge orange">{p.pendingLevelUps} 次待升级</span>}
      </p>
      {p.status === 'trainee' && (
        <p className="hint">训练营球员按赛季固定经验结算（训练营赛季那行），不按场次累计。</p>
      )}
      {p.pendingLevelUps > 0 && p.upgradePlans.length > 0 && (
        <div className="upgrade-plans">
          {p.upgradePlans.map((plan, i) => (
            <button
              key={i}
              type="button"
              className={`upgrade-plan-card${armedPlan === i ? ' armed' : ''}`}
              disabled={busy}
              onClick={() => onChoosePlan(i)}
            >
              <b>方案 {i + 1}{armedPlan === i ? '（再点一次确认）' : ''}</b>
              <span className="mono upgrade-plan-ca">+{plan.ca} CA</span>
              <span className="upgrade-plan-badges">
                {plan.silver > 0 && <span>🥈 ×{plan.silver}</span>}
                {plan.gold > 0 && <span>🥇 ×{plan.gold}</span>}
                {plan.silver === 0 && plan.gold === 0 && <span className="muted">不加徽章</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      <p className="hint">
        徽章墙：🥇 {p.badgesGold}/3 · 🥈 {p.badgesSilver}/15（徽章到帽后选带徽章的方案也不再涨）
      </p>
      {growth.events.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>事件</th>
                <th>数值</th>
                <th>XP</th>
                <th>来源</th>
              </tr>
            </thead>
            <tbody>
              {growth.events.map((e) => (
                <tr key={e.id}>
                  <td className="mono">{e.createdAt.slice(0, 10)}</td>
                  <td>
                    {GROWTH_EVENT_LABEL[e.eventType] ?? e.eventType}
                    {e.eventType === 'milestone' ? `（进+攻 ${e.value}）` : ''}
                  </td>
                  <td className="mono">{e.value}</td>
                  <td className="mono">+{e.xp}</td>
                  <td>{e.source === 'manual' ? '管理组补录' : '赛果同步'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">还没有成长记录。出场比赛、赛果确认之后会自动入账。</p>
      )}
    </div>
  );
}
