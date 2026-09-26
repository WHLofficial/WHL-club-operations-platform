// 球员卡（UI_DESIGN §4.2 .dossier：左球员卡常驻 + 右页签区，v0.7.1 d9 改 E2 页内页签：
// 合同=合同卷宗；属性=FC 源数据（细分属性/位置/角色/花式逆足等）；成长=XP 记录与升级；转会记录=单据流水）
// 成长记录区（§10）：XP 进度条、升级方案二选一（本队教练/管理组）、徽章墙、事件时间线
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  apiPost,
  GROWTH_EVENT_LABEL,
  type ClubSummary,
  type GrowthDetail,
  type LevelUpResult,
  type MyClubOverview,
  type PlayerDetail,
  type PlayerTransfersResponse,
  type UpgradePlanDto,
} from '../lib/api.ts';
import {
  AGENT_TIER_LABEL,
  ATTR_GROUPS,
  ATTR_LABELS,
  CONTRACT_TYPE_LABEL,
  SOURCE_LABEL,
  TRANSFER_TYPE_LABEL,
  nationName,
  playstyleBadges,
  playstyleById,
  playstyleIconUrl,
  positionName,
  roleChs,
  teamName,
} from '../lib/ref.ts';
// 状态词统一用球员库那套（v6.2.0 两表合一：ref.ts 的旧表已删，normal=在队 / free=自由身）
import { MARKER_EMOJI, MARKER_LABEL, STATUS_LABEL } from '../lib/players-library.ts';
import { TeamLogo } from '../components/TeamLogo.tsx';
import {
  PS_GOLD_BASE,
  PS_GRANTABLE_BASE_IDS,
  mergePlaystyleSlots,
  playstyleIdOf,
  playstyleKindOf,
  type PlaystyleKind,
  type PlaystyleSlot,
} from '../../../src/core/fc26.ts';
import { useToast } from '../lib/toast.tsx';
import { qk, useOffersReceivedPending, useSeasonsCurrent } from '../lib/queries.ts';
import { useAuth } from '../lib/auth.tsx';
import { playerPath } from '../lib/player-link.ts';
import { SideOps } from './player/SideOps.tsx';

type PlayerTab = 'profile' | 'attrs' | 'growth' | 'transfers';

const TAB_LABEL: Record<PlayerTab, string> = {
  profile: '合同',
  attrs: '属性',
  growth: '成长',
  transfers: '转会记录',
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

// 雷达轴（v0.7.1 d11，四裁决：外场 PAC/SHO/PAS/DRI/DEF/PHY；门将换轴 DIV/HAN/KIC/REF/POS/SPD，SPD=均(冲刺,加速)）
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

// 六维雷达（静态 SVG，无动画）：组值=组内平均，归一到 99。
// v6.2.0 起压进属性页签头部右格：232×156 光图（无卡框、无文字 legend），轴标签 = 三字母简称 + 数值
function AttrRadar({ values }: { values: { key: string; value: number | null }[] }) {
  const cx = 116;
  const cy = 78;
  const R = 48;
  const n = values.length;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt = (i: number, r: number) => `${(cx + r * Math.cos(angle(i))).toFixed(2)},${(cy + r * Math.sin(angle(i))).toFixed(2)}`;
  const dataPts = values
    .map((v, i) => pt(i, (R * Math.min(Math.max(v.value ?? 0, 0), 99)) / 99))
    .join(' ');
  return (
    <svg className="attr-radar-svg" viewBox="0 0 232 156" role="img" aria-label="六维雷达">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} className="radar-grid" points={values.map((_, i) => pt(i, R * f)).join(' ')} />
      ))}
      {values.map((v, i) => {
        const x = cx + (R + 11) * Math.cos(angle(i));
        const y = cy + (R + 11) * Math.sin(angle(i));
        const anchor = Math.abs(Math.cos(angle(i))) < 0.3 ? 'middle' : Math.cos(angle(i)) > 0 ? 'start' : 'end';
        return (
          <g key={v.key}>
            <line className="radar-axis" x1={cx} y1={cy} x2={cx + R * Math.cos(angle(i))} y2={cy + R * Math.sin(angle(i))} />
            <text className="radar-label" x={x} y={y} textAnchor={anchor} dominantBaseline="middle">
              <tspan className="radar-axis-key">{v.key}</tspan>
              <tspan className="radar-axis-val" dx="3">
                {v.value ?? '—'}
              </tspan>
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

// PlayStyle 发放选择器（v3.3.0）：升级方案带徽章、中国计划自选徽章两处共用。
// 只列「可发放白名单 − 已拥有」，本段选满后其余项禁用 —— 发放数量必须与方案/名额严格相等，
// 少选多选后端都会拒（400），所以在点确认之前就把可选范围收干净。
function PlaystylePickGrid({
  kind,
  options,
  selected,
  limit,
  disabled,
  onToggle,
}: {
  kind: PlaystyleKind;
  options: readonly number[];
  selected: readonly number[];
  limit: number;
  disabled: boolean;
  onToggle: (psid: number) => void;
}) {
  if (options.length === 0) {
    return <p className="muted">没有可选的 {kind === 'gold' ? '金' : '银'} PlayStyle：白名单里的都已在身上。</p>;
  }
  const chosen = selected.filter((p) => playstyleKindOf(p) === kind);
  const full = chosen.length >= limit;
  return (
    <div className="ps-pick-grid">
      {options.map((psid) => {
        const on = selected.includes(psid);
        return (
          <button
            key={psid}
            type="button"
            className={`ps-pick${on ? ' on' : ''}`}
            aria-pressed={on}
            disabled={disabled || (!on && full)}
            onClick={() => onToggle(psid)}
          >
            <PlaystyleBadge psid={psid} gold={kind === 'gold'} />
          </button>
        );
      })}
    </div>
  );
}

export default function Player() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  // 右栏默认展示属性页签（v6.4.0 改动 7，用户裁决：属性才是高频内容）
  const [tab, setTab] = useState<PlayerTab>('attrs');
  const { show, toastNode } = useToast();
  const [armedPlan, setArmedPlan] = useState<number | null>(null);
  const [picks, setPicks] = useState<number[]>([]);
  const [chinaPicks, setChinaPicks] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  // 球衣号草稿（v4.0.0）：null = 还没动过，显示服务端的值；改过之后是本地输入
  const [numberDraft, setNumberDraft] = useState<string | null>(null);
  const [numberBusy, setNumberBusy] = useState(false);

  const dataQuery = useQuery({
    queryKey: ['player', id ?? ''],
    queryFn: () => api<PlayerDetail>(`/api/players/${id}`),
    enabled: id !== undefined,
  });
  // 我的俱乐部（只为球衣号编辑权）：与俱乐部页共用 queryKey，教练在别处拉过就不重复请求；
  // 非教练不拉（enabled: false）——球员页是公开页，别让每个登录用户都多打一次 /api/me/club。
  const { user } = useAuth();
  const isCoach = user?.role === 'coach' || user?.role === 'admin';
  const myClubQuery = useQuery({
    queryKey: qk.myClub,
    queryFn: () => api<MyClubOverview>('/api/me/club'),
    enabled: isCoach,
  });
  const myClubId = myClubQuery.data?.club?.id ?? null;
  // 我收到的报价（v6.3.0）：只为左栏入口徽标的待处理条数，登录教练才拉
  const receivedPendingQuery = useOffersReceivedPending(isCoach);
  // 成长记录拉失败按 null 展示（旧行为 .catch(() => setGrowth(null))）
  const growthQuery = useQuery({
    queryKey: ['player', id ?? '', 'growth'],
    queryFn: () => api<GrowthDetail>(`/api/players/${id}/growth`),
    enabled: id !== undefined,
  });
  // 转会记录只在切到该页签时拉（球员卡最常看的是合同与成长，别让每条详情都多打一次）
  const transfersQuery = useQuery({
    queryKey: ['player', id ?? '', 'transfers'],
    queryFn: () => api<PlayerTransfersResponse>(`/api/players/${id}/transfers`),
    enabled: id !== undefined && tab === 'transfers',
  });
  // 球队列表（v6.2.0）：只为属性页签的队徽 logoKey 与左栏五态的 CPU 判据；
  // 公开端点、服务端 24h scope 缓存 + 两级缓存，与球队页共用 queryKey，只有有归属球员的详情才拉
  const clubsListQuery = useQuery({
    queryKey: qk.clubsList,
    queryFn: () => api<{ clubs: ClubSummary[] }>('/api/clubs'),
    enabled: dataQuery.data?.club != null,
  });
  // 转会窗状态（v6.2.0）：公开 /api/seasons/current 的 window.status；真正的开关在管理端市场页
  const seasonsQuery = useSeasonsCurrent();
  const data = dataQuery.data ?? null;
  const growth = growthQuery.data ?? null;
  const refreshAll = () => void qc.invalidateQueries({ queryKey: ['player', id ?? ''] });

  // 规范 URL（v4.0.0）：地址栏里是内部 id（老分享链接、老缓存）时，换成 fc_id 的那条。
  // 换完 queryKey 也跟着变（['player', id]），所以这一跳会多打一次详情请求——只发生在旧链接上，
  // 换来的是分享出去的地址稳定（内部 id 会随重导入变化）。
  const canonicalPath = data === null ? null : playerPath(data.player);
  useEffect(() => {
    if (canonicalPath !== null && id !== undefined && `/players/${id}` !== canonicalPath) {
      navigate(canonicalPath, { replace: true });
    }
  }, [canonicalPath, id, navigate]);

  async function choosePlan(planIndex: number) {
    if (busy || !growth) return;
    const plan = growth.player.upgradePlans[planIndex];
    const need = (plan?.silver ?? 0) + (plan?.gold ?? 0);
    if (armedPlan !== planIndex) {
      setArmedPlan(planIndex);
      setPicks([]);
      return;
    }
    if (picks.length !== need) {
      show(`这个方案要发 ${need} 个 PlayStyle，先选满再确认。`, true);
      return;
    }
    setBusy(true);
    try {
      const r = await apiPost<LevelUpResult>(`/api/growth/levelup/${growth.player.id}`, { planIndex, picks });
      const parts = [`+${r.plan.ca} CA`];
      if (r.plan.silver > 0) parts.push(`银徽章 +${r.plan.silver}`);
      if (r.plan.gold > 0) parts.push(`金徽章 +${r.plan.gold}`);
      show(`升级完成：${parts.join('，')}。还剩 ${r.pendingLeft} 次待升级。`);
      setArmedPlan(null);
      setPicks([]);
      refreshAll();
    } catch (err) {
      show(err instanceof Error ? err.message : '升级失败', true);
      setArmedPlan(null);
      setPicks([]);
    } finally {
      setBusy(false);
    }
  }

  // 选中的项按段各记一份额度（方案可能同时要银和要金，两段互不挤占）
  function togglePick(psid: number, silverLimit: number, goldLimit: number) {
    setPicks((prev) => {
      if (prev.includes(psid)) return prev.filter((p) => p !== psid);
      const kind = playstyleKindOf(psid);
      const limit = kind === 'gold' ? goldLimit : silverLimit;
      const chosen = prev.filter((p) => playstyleKindOf(p) === kind).length;
      return chosen >= limit ? prev : [...prev, psid];
    });
  }

  function toggleChinaPick(psid: number, limit: number) {
    setChinaPicks((prev) => {
      if (prev.includes(psid)) return prev.filter((p) => p !== psid);
      return prev.length >= limit ? prev : [...prev, psid];
    });
  }

  async function grantChina(left: number) {
    if (busy || !growth) return;
    if (chinaPicks.length !== left) {
      show(`还剩 ${left} 个名额，先选满再发放。`, true);
      return;
    }
    setBusy(true);
    try {
      const r = await apiPost<{ playstyles: PlaystyleSlot[]; granted: number; left: number }>(
        `/api/growth/china-playstyles/${growth.player.id}`,
        { picks: chinaPicks },
      );
      show(`中国计划徽章已发 ${r.granted} 个${r.left > 0 ? `，还剩 ${r.left} 个名额` : '，名额已发完'}。`);
      setChinaPicks([]);
      refreshAll();
    } catch (err) {
      show(err instanceof Error ? err.message : '发放失败', true);
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
  // 转会窗开着吗（公开 /api/seasons/current；后端对改号与全部转会操作在关窗时一律 409 no_window）
  const windowOpen = seasonsQuery.data?.window?.status === 'open';
  // 球衣号（v4.0.0）：号码属于俱乐部，只有球员现属俱乐部的教练能改；
  // v6.2.0 起改号归转会窗管（用户裁决），关窗时编辑入口一并收起、只读展示；
  // 后端同样按「球员现在就在我的队里」+ 开窗把关，这里只是别把按钮露给外人
  const canEditNumber = isCoach && club !== null && myClubId === club.id && windowOpen;

  async function saveNumber(raw: string) {
    if (numberBusy) return;
    setNumberBusy(true);
    try {
      const res = await apiPost<{ ok: boolean; number: string | null }>(`/api/club/players/${player.id}/number`, {
        number: raw === '' ? null : Number(raw),
      });
      show(res.number === null ? '球衣号已清空。' : `球衣号定为 ${res.number} 号。`);
      setNumberDraft(null);
      refreshAll();
      // 阵容表的号码列吃 /api/club/squad，改完一起失效
      void qc.invalidateQueries({ queryKey: qk.squad });
    } catch (err) {
      show(err instanceof Error ? err.message : '改号失败', true);
    } finally {
      setNumberBusy(false);
    }
  }
  const attrs = player.gameAttrs ?? {};
  const nation = nationName(attrs['naID']);
  // 队徽与 CPU 判据（v6.2.0）：公开球队列表里查现属俱乐部；列表没回（缓存未落）时按真人队兜底
  const clubInfo = club ? (clubsListQuery.data?.clubs.find((s) => s.id === club.id) ?? null) : null;
  // 左栏五态判据：本队 = 登录教练且现属俱乐部就是我的队；「非卖品」字段后端还没有（v6.3.0 报价子系统），运行时暂不可达
  const isMine = club !== null && myClubId === club.id;
  const isCpu = clubInfo?.isCpu ?? false;
  // PlayStyle 清单 = FC 源槽 + 发放明细（v3.3.0）：明细存基础 ID，合并时换算成存库 ID 并去重
  const playstyles = mergePlaystyleSlots(
    playstyleBadges(attrs),
    (growth?.playstyleDetails ?? []).map((d) => ({ slot: d.slot, kind: d.kind, psid: d.psid })),
  );
  const ownedPsids = playstyles.map((s) => s.psid);
  const silverOptions = PS_GRANTABLE_BASE_IDS.filter((id) => !ownedPsids.includes(id));
  const goldOptions = PS_GRANTABLE_BASE_IDS.map((id) => id + PS_GOLD_BASE).filter((id) => !ownedPsids.includes(id));
  const armedPlanDef = armedPlan === null ? null : growth?.player.upgradePlans[armedPlan] ?? null;
  const transfers = transfersQuery.data?.transfers ?? [];

  return (
    <div className="container">
      {toastNode}
      <p className="crumb">
        {club ? (
          <>
            <Link to={`/clubs/${club.id}`}>{club.name}</Link> 的球员合同
          </>
        ) : (
          '球员合同'
        )}
      </p>
      <div className="dossier">
        <div className="dossier-side">
          <section className="player-card">
            <div className="player-card-head">
              <h2>
                {player.name}
                {/* 官方缩写名（v4.0.0）：显示名派生自 FC26 存档，与 FC26db 的官方缩写名不同时
                    在下面列一行小字——库里认人仍按官方名（`E. Haaland`），只是不再当标题 */}
                {player.officialName !== undefined && player.officialName !== player.name && (
                  <span className="official-name">{player.officialName}</span>
                )}
              </h2>
              <span className="player-card-badges">
                {/* 标记（v6.5.0）：规则 4.2.2 三档互斥切分，悬停出全称；不落档不显示 */}
                {player.marker && (
                  <span className="player-marker" title={`标记：${MARKER_LABEL[player.marker]}`}>
                    {MARKER_EMOJI[player.marker]}
                  </span>
                )}
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

          <SideOps
            player={{
              id: player.id,
              status: player.status,
              transferListed: player.transferListed,
              minOfferPrice: player.minOfferPrice,
              offerAuto: player.offerAuto,
              notForSale: player.notForSale,
            }}
            contract={contract}
            isMine={isMine}
            isFree={club === null}
            isCpu={isCpu}
            isCoach={isCoach}
            myClubId={myClubId}
            windowOpen={windowOpen}
            pendingMine={receivedPendingQuery.data?.pendingMine ?? 0}
            show={show}
            refreshAll={refreshAll}
          />
        </div>

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
              <div className="table-wrap">
                <table className="dossier-table">
                  <tbody>
                    {/* 球衣号（v4.0.0）：号码是俱乐部的东西，本队教练在这里填/改/清；
                        别人只读，没定号显示 —（换队/解约后后端会把它清空） */}
                    <tr>
                      <th>球衣号</th>
                      <td className="mono">
                        {canEditNumber ? (
                          <span className="number-edit">
                            <input
                              aria-label="球衣号"
                              inputMode="numeric"
                              placeholder="1–99"
                              value={numberDraft ?? player.number ?? ''}
                              onChange={(e) => setNumberDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
                            />
                            <button
                              type="button"
                              className="btn btn-sm"
                              disabled={numberBusy || (numberDraft ?? player.number ?? '') === (player.number ?? '')}
                              onClick={() => void saveNumber(numberDraft ?? player.number ?? '')}
                            >
                              {numberBusy ? '保存中…' : '保存'}
                            </button>
                            {player.number !== null && (
                              <button type="button" className="btn btn-sm btn-ghost" disabled={numberBusy} onClick={() => void saveNumber('')}>
                                清号
                              </button>
                            )}
                          </span>
                        ) : (
                          (player.number ?? '—')
                        )}
                        {isCoach && club !== null && myClubId === club.id && !windowOpen && (
                          <span className="muted number-window-note">转会窗未开放，改号要等开窗</span>
                        )}
                      </td>
                    </tr>
                    {contract && (
                      <>
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
                      </>
                    )}
                  </tbody>
                </table>
              </div>
              {!contract && (
                <div className="empty-state">
                  <p className="muted">卷宗里还没有合同。签约、续约之后，条款都会收录在这里。</p>
                </div>
              )}
            </>
          )}

          {tab === 'attrs' && player.gameAttrs && (
            <AttrSheet
              attrs={attrs}
              position={player.position}
              prestige={player.prestige}
              playstyles={playstyles}
              club={club}
              crestLogoKey={clubInfo?.logoKey ?? null}
            />
          )}

          {tab === 'growth' && growth && (
            <GrowthBlock
              growth={growth}
              armedPlan={armedPlan}
              armedPlanDef={armedPlanDef}
              picks={picks}
              chinaPicks={chinaPicks}
              silverOptions={silverOptions}
              goldOptions={goldOptions}
              chinaPlan={player.chinaPlan}
              busy={busy}
              onChoosePlan={choosePlan}
              onTogglePick={togglePick}
              onToggleChinaPick={toggleChinaPick}
              onGrantChina={grantChina}
            />
          )}
          {tab === 'growth' && !growth && (
            <div className="empty-state">
              <p className="muted">成长记录还没就绪。</p>
            </div>
          )}

          {tab === 'transfers' && (
            <>
              <h3>转会记录</h3>
              {transfersQuery.isError ? (
                <div className="banner bad">
                  {transfersQuery.error instanceof Error ? transfersQuery.error.message : '转会记录拉取失败'}
                </div>
              ) : transfersQuery.isPending ? (
                <p className="muted">正在翻查转会记录…</p>
              ) : transfers.length === 0 ? (
                <div className="empty-state">
                  <p className="muted">卷宗里还没有转会记录。成交、解约、海捞签入之后，单据都会收录在这里。</p>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="transfer-table">
                    <thead>
                      <tr>
                        <th>完成时间</th>
                        <th>类型</th>
                        <th>转出</th>
                        <th>转入</th>
                        <th>费用</th>
                        <th>赛季</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transfers.map((t) => (
                        <tr key={t.id}>
                          <td className="mono">{t.completedAt === null ? '—' : t.completedAt.slice(0, 10)}</td>
                          <td>{TRANSFER_TYPE_LABEL[t.type] ?? t.type}</td>
                          <td>{t.fromClubName ?? '自由身'}</td>
                          <td>{t.toClubName ?? '自由身'}</td>
                          <td className="num mono">
                            {t.fee === null ? '—' : `${t.fee.toFixed(2)} m`}
                            {t.extraFee !== null && t.extraFee > 0 ? ` +${t.extraFee.toFixed(2)}` : ''}
                          </td>
                          <td className="mono">
                            {t.season === null ? '—' : `S${t.season}${t.windowSeq ? ` 第 ${t.windowSeq} 窗` : ''}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

// 左栏五态操作区（v6.2.0 骨架 → v6.3.0 接真实端点）：实现独立成 web/src/pages/player/SideOps.tsx，
// 数据（报价设置三字段 / 合同 / 窗状态 / 待处理徽标）由本页传下去，动作后的刷新回调 refreshAll。

// 属性页签（v0.7.1 d10）：头部两栏（左=标题/位置/角色，右=队徽 96px + 光图六维雷达，v6.2.0）
// + 星级行 + 六组细分卡（门将七组）；雷达不再套卡框，属性卡网格保持整宽
function AttrSheet({
  attrs,
  position,
  prestige,
  playstyles,
  club,
  crestLogoKey,
}: {
  attrs: Record<string, unknown>;
  position: string | null;
  prestige: number | null;
  /** FC 源槽 + 发放明细合并后的清单（页面级算一次，成长页签的候选也要用同一份） */
  playstyles: PlaystyleSlot[];
  /** 现属俱乐部（自由身为 null ⇒ 头部不出队徽，雷达贴右） */
  club: { id: number; name: string } | null;
  /** 队徽图 key（公开球队列表带回；没拿到时 TeamLogo 自动回落队名哈希色块，与列表/详情同色） */
  crestLogoKey: string | null;
}) {
  const team = teamName(attrs['TeamID']);
  const posChips = ['PosID1', 'PosID2', 'PosID3', 'PosID4']
    .map((k) => positionName(attrs[k]))
    .filter((v): v is string => v !== null);
  const roles = ['RoleID1', 'RoleID2', 'RoleID3', 'RoleID4', 'RoleID5']
    .map((k) => roleChs(attrs[k]))
    .filter((v): v is string => v !== null);
  const weakfoot = Number(attrs['weakfoot']);
  const skillmoves = Number(attrs['skillmoves']);
  const isGk = position === 'GK';
  const groups = ATTR_GROUPS.filter((g) => isGk || g.key !== 'GKP');
  // 六维雷达（v6.2.0 移回属性页签头部）：轴与组值沿用同一段口径
  const radarAxes = isGk ? GK_RADAR : ATTR_GROUPS.slice(0, 6);
  const radarValues = radarAxes.map((g) => ({ key: g.key, value: groupAverage(g.keys, attrs) }));
  return (
    <>
      <div className="attr-head">
        <div>
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
        </div>
        <div className="attr-head-side">
          {club && <TeamLogo name={club.name} logoKey={crestLogoKey} size={96} circle={false} />}
          <AttrRadar values={radarValues} />
        </div>
      </div>
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
        {playstyles.length > 0 && (
          <div className="attr-group-card ps-card">
            <div className="attr-group-head">
              <span className="attr-group-key">PS</span>
              <span className="attr-name">PlayStyles</span>
            </div>
            <div className="ps-list">
              {playstyles.map((b) => (
                <PlaystyleBadge key={`${b.slot}-${b.psid}`} psid={b.psid} gold={b.gold} />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// 成长记录块（§10）：XP 进度、升级方案二选一（带徽章的方案要先选 PlayStyle）、
// 中国计划自选徽章、徽章墙、事件时间线
function GrowthBlock({
  growth,
  armedPlan,
  armedPlanDef,
  picks,
  chinaPicks,
  silverOptions,
  goldOptions,
  chinaPlan,
  busy,
  onChoosePlan,
  onTogglePick,
  onToggleChinaPick,
  onGrantChina,
}: {
  growth: GrowthDetail;
  armedPlan: number | null;
  /** 已点开的方案定义（null = 没在确认流程里） */
  armedPlanDef: UpgradePlanDto | null;
  picks: number[];
  chinaPicks: number[];
  silverOptions: readonly number[];
  goldOptions: readonly number[];
  chinaPlan: boolean;
  busy: boolean;
  onChoosePlan: (planIndex: number) => void;
  onTogglePick: (psid: number, silverLimit: number, goldLimit: number) => void;
  onToggleChinaPick: (psid: number, limit: number) => void;
  onGrantChina: (left: number) => void;
}) {
  const p = growth.player;
  const xpInLevel = Math.floor(p.growthXp) % p.xpPerLevel;
  const pct = Math.min(100, Math.round((xpInLevel / p.xpPerLevel) * 100));
  const toNext = p.xpPerLevel - xpInLevel;
  const need = (armedPlanDef?.silver ?? 0) + (armedPlanDef?.gold ?? 0);
  const picksReady = picks.length === need;
  const china = p.chinaPlaystyles;
  const chinaGranted = growth.playstyleDetails.filter((d) => d.source === 'china');
  const chinaReady = chinaPicks.length === china.left;
  const planBadgeText = (silver: number, gold: number) => {
    if (silver === 0 && gold === 0) return '不加徽章';
    return [silver > 0 ? `🥈 ×${silver}` : '', gold > 0 ? `🥇 ×${gold}` : ''].filter(Boolean).join(' ');
  };
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
        <>
          <div className="upgrade-plans">
            {p.upgradePlans.map((plan, i) => (
              <button
                key={i}
                type="button"
                className={`upgrade-plan-card${armedPlan === i ? ' armed' : ''}`}
                disabled={busy || (armedPlan === i && !picksReady)}
                onClick={() => onChoosePlan(i)}
              >
                <b>
                  方案 {i + 1}
                  {armedPlan === i ? (picksReady ? '（再点一次确认）' : '（先选 PlayStyle）') : ''}
                </b>
                <span className="mono upgrade-plan-ca">+{plan.ca} CA</span>
                <span className="upgrade-plan-badges">
                  {plan.silver === 0 && plan.gold === 0 ? (
                    <span className="muted">不加徽章</span>
                  ) : (
                    <span>{planBadgeText(plan.silver, plan.gold)}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
          {armedPlanDef && need > 0 && (
            <div className="pick-panel">
              <p className="hint">
                方案 {(armedPlan ?? 0) + 1} 要发 {planBadgeText(armedPlanDef.silver, armedPlanDef.gold)}，已选 {picks.length}/{need}
                {picksReady ? '：选满了，再点一次方案确认。' : '：选满之后才能确认。'}
              </p>
              {armedPlanDef.silver > 0 && (
                <PlaystylePickGrid
                  kind="silver"
                  options={silverOptions}
                  selected={picks}
                  limit={armedPlanDef.silver}
                  disabled={busy}
                  onToggle={(psid) => onTogglePick(psid, armedPlanDef.silver, armedPlanDef.gold)}
                />
              )}
              {armedPlanDef.gold > 0 && (
                <PlaystylePickGrid
                  kind="gold"
                  options={goldOptions}
                  selected={picks}
                  limit={armedPlanDef.gold}
                  disabled={busy}
                  onToggle={(psid) => onTogglePick(psid, armedPlanDef.silver, armedPlanDef.gold)}
                />
              )}
            </div>
          )}
        </>
      )}
      <p className="hint">
        徽章墙：🥇 {p.badgesGold}/3 · 🥈 {p.badgesSilver}/12（金槽 3 个 + 银槽 12 个；台账到帽后选带徽章的方案也不再涨）
      </p>
      {chinaPlan && (
        <div className="china-ps">
          <h4>中国计划徽章</h4>
          {china.left > 0 ? (
            <>
              <p className="hint">
                自选 {china.left} 个银 PlayStyle（名额 {china.quota} 个，已发 {china.granted} 个）。这些徽章随离队失效，
                升级得来的徽章不受影响。
              </p>
              <PlaystylePickGrid
                kind="silver"
                options={silverOptions}
                selected={chinaPicks}
                limit={china.left}
                disabled={busy}
                onToggle={(psid) => onToggleChinaPick(psid, china.left)}
              />
              <button type="button" className="btn" disabled={busy || !chinaReady} onClick={() => onGrantChina(china.left)}>
                发放中国计划徽章{chinaReady ? '' : `（还差 ${china.left - chinaPicks.length} 个）`}
              </button>
            </>
          ) : (
            <p className="muted">
              名额已发完（{china.granted}/{china.quota}）。
            </p>
          )}
          {chinaGranted.length > 0 && (
            <div className="ps-list">
              {chinaGranted.map((d) => (
                <PlaystyleBadge key={`${d.slot}-${d.psid}`} psid={playstyleIdOf(d.psid, d.kind)} gold={d.kind === 'gold'} />
              ))}
            </div>
          )}
        </div>
      )}
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
