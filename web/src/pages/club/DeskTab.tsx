// 工作台页签（v6.30.0 A 段：自 pages/ClubDetail.tsx 教练台 CoachPanel 拆入，自家专属）。
// 转会禁令 banner + 注册工作台 + 续约与解约（规则 4.4.3/4.4.4）+ 随机事件。
// 注册名单查询（qk.squad）住在本组件里：只有激活「工作台」才挂载、才发请求。
// v6.30.0 C 段：注册名单重定列集 —— 分配列 + 标记/号码/UID/姓名/年龄/位置/CA/PA/违约金/工资 + 可选列（?regcols=）。
// v6.37.0 卡片化：注册名单表整表重构为「位置四组容器 + 行解剖卡」，与 SquadTab 同构（组件在 card-parts.tsx）——
//   行尾「分配 ▾」下拉取代最左分段按钮（三选全称，无合同禁一线/训练营）；违规旗标/无合同/退役徽章随姓名走；
//   桌面 = 全列合并 +「列…」自选长尾；窄屏（≤760px）= 四视图 chips 快切；非开窗期下拉整体禁用。
import { useMemo, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  apiPost,
  apiSend,
  type ClubEventChooseResult,
  type ClubEventRecent,
  type ClubEventsResponse,
  type MyClubOverview,
  type RcChangeResult,
  type SquadIssue,
  type SquadOverview,
  type SquadPlayerRow,
  type TerminationResult,
} from '../../lib/api.ts';
import { LEAGUE_TIER_LABEL } from '../../lib/ref.ts';
import { qk, useShortlist, useShortlistInvalidation } from '../../lib/queries.ts';
import { useToast } from '../../lib/toast.tsx';
import { useTimeFmt } from '../../lib/datetime.ts';
import { CARD_VIEW_CELLS, DESKTOP_CELLS_DESK, groupRowsByPosition, type CardViewKey } from '../../lib/club-cards.ts';
import { CARD_EXTRA_ITEMS, REG_COLS_KEY, parseCardExtras, toggleClubCol } from '../../lib/club-columns.tsx';
import MultiSelect from '../../components/MultiSelect.tsx';
import { useMediaQuery } from '../../lib/use-media.ts';
import { playerPath } from '../../lib/player-link.ts';
// 纯合规引擎直接复用（v6.54.0 步骤 7）：current/projected 双跑必须与提交校验同一份规则，
// 前端不许再抄一遍阈值（§10.5「projected 再跑一遍合规预检」）。
import { checkSquad, type SquadPlayer } from '../../../../src/core/squad-rules.ts';
import { terminationFeePreview } from '../../lib/bypass-fee-preview.ts';
import { PENDING_SOURCE_LABEL, delta2, fmt2, fmtShort, pendingFeeSmall, pendingWageSmall } from '../../lib/contract-view.ts';
import { CapBar } from './CapBar.tsx';
import {
  CardGroup,
  RegCard,
  VIEW_COL_WIDTH,
  VIEW_GRID_COLS,
  ViewChips,
  extraColDefs,
  type AssignValue,
} from './card-parts.tsx';

// v6.54.0：新增「仅看待生效」——筛选只改列表可见性，不改工资总额/排序口径（§10.5）
type SquadFilter = 'all' | 'first_team' | 'trainee' | 'pending';
type Assignment = AssignValue;

const SQUAD_FILTER_LABEL: Record<SquadFilter, string> = {
  all: '全部',
  first_team: '一线队',
  trainee: '训练营',
  pending: '仅看待生效',
};

export default function DeskTab({ overview }: { overview: MyClubOverview }) {
  const qc = useQueryClient();
  // 没绑俱乐部时不拉名单（与旧 useEffect 的 `data.club ? 拉名单` 门一致）
  const squadQuery = useQuery({
    queryKey: qk.squad,
    queryFn: () => api<SquadOverview>('/api/club/squad'),
    enabled: overview.club != null,
  });
  const squad = squadQuery.data ?? null;
  const refreshSquad = () => void qc.invalidateQueries({ queryKey: qk.squad });

  // 详情页已经确认过「本队 = 登录者的队」，正常走不到这里
  const club = overview.club;
  if (!club) return null;

  return (
    <div className="club-block">
      <ShortlistCard />
      {club.transferBanned && (
        <section className="card banner banner-bad" role="alert">
          ⛔ 本俱乐部的转会权限已被管理组冻结：挂牌、出价、海捞、激活、议价等新操作都会被拦下。请联系管理组处理相关事项。
        </section>
      )}

      {squad && <RegistrationSection squad={squad} />}

      {squad && <BypassSection squad={squad} onRefresh={refreshSquad} />}

      <EventsCard />
    </div>
  );
}

/* ---------- 随机事件（v6.11.0）：需要拿主意的待选事件 + 近期结算 ---------- */

function eventResultText(r: ClubEventRecent): string {
  if (r.skipped) return '无效果结算';
  if (r.auto) return r.optionName === '' ? '超时兜底' : `超时兜底：${r.optionName}`;
  if (r.choiceNo === null) return '已结算';
  return `${r.choiceNo}. ${r.optionName}`;
}

function EventsCard() {
  const qc = useQueryClient();
  const { show, toastNode } = useToast();
  const { time, label } = useTimeFmt();
  const listQuery = useQuery({
    queryKey: qk.clubEvents,
    queryFn: () => api<ClubEventsResponse>('/api/club/events'),
    retry: false,
  });
  const [busyId, setBusyId] = useState<number | null>(null);
  const data = listQuery.data ?? null;

  async function choose(id: number, choiceNo: number, label: string) {
    setBusyId(id);
    try {
      const out = await apiPost<ClubEventChooseResult>(`/api/club/events/${id}/choose`, { choiceNo });
      void qc.invalidateQueries({ queryKey: qk.clubEvents });
      void qc.invalidateQueries({ queryKey: ['club', 'finance-summary'] });
      // 事件效果会改死忠/影响力（主场页签「主场档案」卡直接渲染它们）与余额，跟设施升级/冠名同口径
      void qc.invalidateQueries({ queryKey: qk.myClub });
      void qc.invalidateQueries({ queryKey: ['club', 'balance'] });
      const notes = out.event.notes.length > 0 ? `（${out.event.notes.join('；')}）` : '';
      show(`已选「${label}」：${out.event.text}${notes}`);
    } catch (err) {
      show(err instanceof Error ? err.message : '选项提交失败', true);
    } finally {
      setBusyId(null);
    }
  }

  if (listQuery.isPending) return null;
  if (listQuery.isError || !data) {
    return (
      <section className="card">
        <h3>随机事件</h3>
        <p className="muted">{listQuery.error instanceof Error ? listQuery.error.message : '事件读不出来'}</p>
      </section>
    );
  }
  if (data.pending.length === 0 && data.recent.length === 0) return null;

  return (
    <section className="card">
      <h3>随机事件</h3>
      {toastNode}
      <p className="hint">
        赛季进行中会随机撞上事件。需要你拿主意的会列在下面：选定后立刻结算，到期没选就按资金最差结果自动结算。
      </p>
      {data.pending.map((ev) => (
        <div key={ev.id} className="banner warn" style={{ marginBottom: 8 }}>
          <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
            {ev.text}
          </pre>
          <div className="inline-form" style={{ marginTop: 8 }}>
            {ev.options.map((o) => (
              <button
                key={o.no}
                className="btn btn-sm"
                type="button"
                disabled={busyId !== null}
                title={o.desc}
                onClick={() => void choose(ev.id, o.no, o.name)}
              >
                {busyId === ev.id ? '提交中…' : `${o.no}. ${o.name}`}
              </button>
            ))}
          </div>
          <p className="hint" style={{ marginBottom: 0 }}>
            {ev.deadlineAt === null
              ? '这条没设选定时限，不会自动结算。'
              : `截止 ${time(ev.deadlineAt)}（${label}），超时按资金最差结果自动结算。`}
          </p>
        </div>
      ))}
      {data.pending.length === 0 && <p className="muted">现在没有待你选择的事件。</p>}
      {/* v6.30.0 删减项⑦：近期结算表默认折叠，先例 pages/admin/OverviewPage.tsx 的 <details> */}
      {data.recent.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary>近期事件（{data.recent.length} 条）</summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>事件</th>
                  <th>结果</th>
                  <th>变化</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r) => (
                  <tr key={r.id}>
                    <td className="mono muted">{time(r.createdAt)}</td>
                    <td>{r.eventName}</td>
                    <td>{eventResultText(r)}</td>
                    <td>{r.notes.length > 0 ? r.notes.join('；') : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

/* ---------- 注册工作台 ---------- */

function RegistrationSection({ squad }: { squad: SquadOverview }) {
  const { toastNode } = useToast();
  // v6.67.0 期一（D1）：名单由合同推导，教练不再手动分配——assign 只做展示映射
  const assign = useMemo<Record<number, Assignment>>(() => {
    const map: Record<number, Assignment> = {};
    for (const p of squad.players) if (p.squad) map[p.id] = p.squad;
    return map;
  }, [squad.players]);
  const [filter, setFilter] = useState<SquadFilter>('all');
  // 红字直接来自服务端体检（v6.67.0 起没有"放行档"这个开关）
  const issues: SquadIssue[] | null = squad.compliance && !squad.compliance.pass ? squad.compliance.issues : null;

  // v6.30.0 C 段：可选列进 URL（?regcols=）—— 与阵容名单的 ?cols= 分开键，两张表在不同页签，防串味。
  // v6.37.0 卡片化：解析收敛到长尾池（旧 URL 里表格时代的内置键不算数），卡片内置 8 列恒显。
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCols = parseCardExtras(searchParams.get(REG_COLS_KEY));
  function writeCols(next: string[]) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next.length === 0) params.delete(REG_COLS_KEY);
      else params.set(REG_COLS_KEY, next.join(','));
      return params;
    });
  }

  const rules = squad.rules;

  // 窄屏四视图 chips 的当前视图；桌面无 chips（全列合并），这个状态闲置
  const narrow = useMediaQuery('(max-width: 760px)');
  const [view, setView] = useState<CardViewKey>('basic');
  const cells = narrow ? CARD_VIEW_CELLS[view] : DESKTOP_CELLS_DESK;
  const extras = extraColDefs(activeCols);

  const stats = useMemo(() => {
    const first = squad.players.filter((p) => assign[p.id] === 'first_team');
    const trainee = squad.players.filter((p) => assign[p.id] === 'trainee');
    const all = [...first, ...trainee];
    // 待生效投影只算「已分配进名单」的人：cap bar 是注册口径，未分配的球员不进工资总额
    let pendingDelta = 0;
    let pendingCount = 0;
    for (const p of all) {
      if (!p.hasPending) continue;
      pendingCount++;
      pendingDelta += (p.pendingWage ?? p.wage ?? 0) - (p.wage ?? 0);
    }
    const wageTotal = all.reduce((sum, p) => sum + (p.wage ?? 0), 0);
    return {
      firstTeam: first.length,
      goalkeepers: first.filter((p) => p.position === 'GK').length,
      trainee: trainee.length,
      wageTotal,
      wageProjected: wageTotal + pendingDelta,
      pendingDelta: Math.round(pendingDelta * 100) / 100,
      pendingCount,
      // 行数组单独命名：字段 `trainee` 是人数，不能与数组同名（对象字面量重复键）
      firstRows: first,
      traineeRows: trainee,
    };
  }, [squad.players, assign]);

  // 全队待生效明细（明细/投影段/筛选三处同源；不含未分配球员——见 stats 注释）
  const pendingPlayers = useMemo(() => squad.players.filter((p) => p.hasPending), [squad.players]);
  // 折叠条数（§10.5）：桌面 3 条、窄屏 2 条；超出挂「查看全部」（合规必须可查，不许藏）
  const pendingVisible = narrow ? 2 : 3;
  const [showAllPending, setShowAllPending] = useState(false);

  const rows = useMemo(() => {
    return squad.players.filter((p) => {
      if (filter === 'all') return true;
      // 仅看待生效：与分配无关，只按 hasPending（§10.5 表头筛选）
      if (filter === 'pending') return p.hasPending;
      return (assign[p.id] ?? 'none') === filter;
    });
  }, [squad.players, assign, filter]);

  // 逐人标红（v2.2.0）：issues 里带 playerIds 的规则按球员展开；
  // 规则级问题（人数/门将/工资帽）playerIds 为空，行上自然不命中，banner 兜底
  const flagged = useMemo(() => {
    const map = new Map<number, SquadIssue[]>();
    for (const issue of issues ?? []) {
      for (const pid of issue.playerIds) {
        const list = map.get(pid) ?? [];
        list.push(issue);
        map.set(pid, list);
      }
    }
    return map;
  }, [issues]);

  // current / projected 双跑合规预检（v6.54.0 §10.5）：与提交校验同一个 checkSquad 纯函数。
  // 待生效只改工资 ⇒ projected 新增的失败项实际上只会是 wage_cap；其余硬规则两遍一致。
  // off 档（特例期隔离）不显示，与现有红字口径相同。
  const squadChecks = useMemo(() => {
    if (!rules) return null;
    const toSquadPlayer = (p: SquadPlayerRow, projected: boolean): SquadPlayer => ({
      playerId: p.id,
      name: p.name,
      position: p.position,
      ca: p.ca,
      pa: p.pa,
      initialCa: p.baseCa ?? p.ca,
      growable: p.growable,
      hasContract: p.hasContract,
      // API 侧是宽 string，core 判定只认两值；未知值归 null（走 hasContract 判定，不参与双向挂钩）
      contractType: p.contractType === 'trainee' ? 'trainee' : p.contractType === 'formal' ? 'formal' : null,
      wage: projected && p.hasPending ? (p.pendingWage ?? p.wage) : p.wage,
    });
    return {
      current: checkSquad(
        stats.firstRows.map((p) => toSquadPlayer(p, false)),
        stats.traineeRows.map((p) => toSquadPlayer(p, false)),
        rules,
      ),
      projected: checkSquad(
        stats.firstRows.map((p) => toSquadPlayer(p, true)),
        stats.traineeRows.map((p) => toSquadPlayer(p, true)),
        rules,
      ),
    };
  }, [rules, stats]);

  // 未签约区（D2）：不占人数、不计工资，但挂了红字要点名
  const unsignedRows = useMemo(() => squad.players.filter((p) => !p.hasContract), [squad.players]);

  const wageCap = rules?.wageCap ?? null;
  const capLeft = wageCap !== null ? wageCap - stats.wageTotal : null;

  return (
    <section className="card">
      <div className="tier-head">
        <h3>阵容与注册{squad.season !== null ? ` · 第 ${squad.season} 赛季` : ''}</h3>
        <span className="muted">名单随合同自动更新</span>
      </div>
      {toastNode}
      {!squad.registeredInTournament ? (
        <div className="banner bad">
          尚未在赛事平台报名，请等待赛事平台管理员确认报名。下面按合同显示的阵容暂时不做合规体检。
        </div>
      ) : squad.rules?.tier && (
        <div className="banner ok">
          报名状态：<span className={`badge ${squad.rules.tier === 'premier' ? 'gold' : 'gray'}`}>
            {LEAGUE_TIER_LABEL[squad.rules.tier] ?? squad.rules.tier}
          </span>{' '}
          已由赛事报名派生，按合同自动生成的阵容会照此体检。
        </div>
      )}
      {!rules ? (
        <p className="muted">{squad.registeredInTournament ? '正在加载注册规则…' : '报名完成后这里会挂出注册规则。'}</p>
      ) : (
        <>
          <p className="hint">
            一线队 {rules.squadMin}-{rules.squadMax} 人、至少 {rules.gkMin} 名门将；训练营 ≤{rules.traineeMax} 人且须可成长（PA−CA＞0）。
            {rules.tier && <>初始CA 限额：≥90 最多 {rules.limits.ge90} 名、≥87 最多 {rules.limits.ge87} 名、＜87 且 PA≥87 且未练满可成长最多 {rules.limits.growthPa87} 名。</>}
            工资帽按级别以半赛季计
            {wageCap === null
              ? '（本季度未配置，暂不校验）'
              : `（${rules.tier ? (LEAGUE_TIER_LABEL[rules.tier] ?? rules.tier) : '本级'} ${wageCap}m）；窗末按现行合同工资实扣，未达下限 ${wageCap - 15}m 按下限扣`}。
          </p>

          <div className="preview-stats">
            <div className="club-stat">
              <span className="stat-label">一线队</span>
              <span className={`stat-value mono${stats.firstTeam > rules.squadMax ? ' bad-text' : stats.firstTeam < rules.squadMin ? ' low-text' : ''}`}>
                {stats.firstTeam}/{rules.squadMax}
              </span>
            </div>
            <div className="club-stat">
              <span className="stat-label">门将</span>
              <span className={`stat-value mono${stats.goalkeepers < rules.gkMin ? ' low-text' : ''}`}>{stats.goalkeepers}</span>
            </div>
            <div className="club-stat">
              <span className="stat-label">训练营</span>
              <span className={`stat-value mono${stats.trainee > rules.traineeMax ? ' bad-text' : ''}`}>
                {stats.trainee}/{rules.traineeMax}
              </span>
            </div>
            <div className="club-stat club-stat-wage">
              <span className="stat-label">工资</span>
              <span className={`stat-value mono${capLeft !== null && capLeft < 0 ? ' bad-text' : ' gold-text'}`}>
                {wageCap !== null ? `${fmt2(stats.wageTotal)}/${wageCap}m` : `${fmt2(stats.wageTotal)}m`}
              </span>
              {/* 双口径副值（§10.5）：主值永远是 current，投影只作提示，不改本窗校验/扣款 */}
              {stats.pendingCount > 0 && (
                <span className="stat-sub">
                  待生效 {fmt2(stats.wageProjected)}m（{delta2(stats.pendingDelta)}）· {stats.pendingCount} 份
                </span>
              )}
            </div>
            <div className="club-stat">
              <span className="stat-label">忠诚支出</span>
              <span className="stat-value mono gold-text">{fmt2(squad.loyalty.total)}m</span>
              <span className="stat-sub">中期窗按现行合同预扣 · {squad.loyalty.count} 份</span>
            </div>
          </div>
          {wageCap !== null && (
            <CapBar
              current={stats.wageTotal}
              projected={stats.wageProjected}
              cap={wageCap}
              title={`${rules.tier ? `${LEAGUE_TIER_LABEL[rules.tier] ?? rules.tier} ` : ''}工资帽 ${fmt2(wageCap)}m`}
            />
          )}

          {/* 逐人待生效明细（§10.5）：不能只藏在球员页合同卡里，提交前必须能看到谁待生效、涨多少 */}
          {pendingPlayers.length > 0 && (
            <div className="reg-pending">
              <div className="reg-pending-head">
                待生效工资（{pendingPlayers.length}）
                <span className="muted"> · 本窗关闭时生效</span>
              </div>
              {(showAllPending ? pendingPlayers : pendingPlayers.slice(0, pendingVisible)).map((p) => (
                <div className="reg-pending-row" key={p.id}>
                  <Link className="reg-pending-name" to={playerPath(p)}>
                    {p.name}
                  </Link>
                  <span className="mono">
                    {p.pendingWage != null && p.wage != null && Math.abs(p.pendingWage - p.wage) >= 0.005
                      ? `${fmt2(p.wage)} → ${pendingWageSmall(p.wage, p.pendingWage)}`
                      : p.pendingSource === 'rejection'
                        ? '保护期结束'
                        : '工资不变'}
                  </span>
                  {p.pendingReleaseFee != null && (
                    <span className="mono reg-pending-fee">
                      违约金 {fmtShort(p.releaseFee ?? 0)} → {pendingFeeSmall(p.releaseFee, p.pendingReleaseFee)}
                    </span>
                  )}
                  <span className="reg-pending-src">{p.pendingSource ? PENDING_SOURCE_LABEL[p.pendingSource] : '合同变更'}</span>
                  <span className="muted reg-pending-when">本窗关闭时生效</span>
                  <Link className="reg-pending-link" to={playerPath(p)}>
                    查看
                  </Link>
                </div>
              ))}
              {pendingPlayers.length > pendingVisible && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowAllPending((v) => !v)}>
                  {showAllPending ? '收起' : `查看全部 ${pendingPlayers.length} 条`}
                </button>
              )}
            </div>
          )}

          {/* current / projected 双预检（§10.5）：current 按现行工资、projected 按关窗后工资各跑一遍。
              待生效只会新增工资帽失败；硬规则（人数/门将/CA）两遍一致时直接显示「通过」。 */}
          {squadChecks !== null && stats.pendingCount > 0 && (
            <div className={`reg-precheck${squadChecks.projected.pass ? '' : ' warn'}`}>
              <div className="reg-precheck-head">合规预检</div>
              <div className="reg-precheck-line">
                当前窗：{squadChecks.current.pass ? '通过' : `未通过（${squadChecks.current.issues.length} 项）`}
              </div>
              <div className={`reg-precheck-line${squadChecks.projected.pass ? '' : ' bad-text'}`}>
                关窗时：
                {squadChecks.projected.pass
                  ? '通过'
                  : (() => {
                      // 硬规则（人数/门将/CA 等）与工资帽分开说：前者直接阻止提交，后者要显式确认
                      const hard = squadChecks.projected.issues.filter((i) => i.rule !== 'wage_cap');
                      if (hard.length > 0) return `不通过 —— ${hard.map((i) => i.message).join('；')}。`;
                      const wageIssue = squadChecks.projected.issues.find((i) => i.rule === 'wage_cap');
                      return `需确认 —— ${wageIssue?.message ?? '工资将超出工资帽'}；关窗时必须强制拍卖球员降到帽下。`;
                    })()}
              </div>
            </div>
          )}

          <div className="tier-head">
            {/* v6.54.0 步骤 8：≤640 换成可换行 chip 组（4 个按钮在 360px 一行装不下，原 inline-flex 会顶出横滑） */}
            <div className="seg reg-filter" role="radiogroup" aria-label="按名单筛选">
              {(Object.keys(SQUAD_FILTER_LABEL) as SquadFilter[]).map((key) => (
                <button key={key} type="button" className={filter === key ? 'on' : ''} onClick={() => setFilter(key)}>
                  {SQUAD_FILTER_LABEL[key]}
                  {key === 'pending'
                    ? `（${pendingPlayers.length}）`
                    : key !== 'all' && `（${squad.players.filter((p) => (assign[p.id] ?? 'none') === key).length}）`}
                </button>
              ))}
            </div>
            {!narrow && (
              <MultiSelect
                label="列…"
                items={CARD_EXTRA_ITEMS}
                selected={activeCols}
                onToggle={(key) => writeCols(toggleClubCol(activeCols, key))}
                onClear={() => writeCols([])}
              />
            )}
          </div>

          {rows.length === 0 ? (
            <div className="empty-state">
              <p className="muted">
                {squad.players.length === 0
                  ? '名单还是空的。等管理组导入球员、签下合同之后，这里就是你的更衣室。'
                  : filter === 'pending'
                    ? '当前没有待生效的合同变更。'
                    : '这个名单还没有人。用行尾的「分配」下拉，把人分进一线队或训练营。'}
              </p>
            </div>
          ) : (
            <>
              {narrow && (
                <ViewChips
                  value={view}
                  onChange={setView}
                  extra={
                    <MultiSelect
                      label="列…"
                      items={CARD_EXTRA_ITEMS}
                      selected={activeCols}
                      onToggle={(key) => writeCols(toggleClubCol(activeCols, key))}
                      onClear={() => writeCols([])}
                    />
                  }
                />
              )}
              <div
                className="sqc-wrap"
                style={
                  {
                    '--sqc-cw': narrow ? VIEW_COL_WIDTH[view] : undefined,
                    '--sqc-mcols': narrow ? VIEW_GRID_COLS[view] : undefined,
                  } as CSSProperties
                }
              >
                {groupRowsByPosition(rows).map((g) => (
                  <CardGroup
                    key={g.key}
                    groupKey={g.key}
                    label={g.label}
                    count={g.rows.length}
                    cells={cells}
                    extras={extras}
                    wide={!narrow}
                  >
                    {g.rows.map((p) => (
                      <RegCard
                        key={p.id}
                        row={p}
                        view={view}
                        flags={flagged.get(p.id) ?? []}
                        extras={extras}
                        wide={!narrow}
                      />
                    ))}
                  </CardGroup>
                ))}
              </div>
            </>
          )}

          {issues !== null && issues.length > 0 && (
            <div className="banner bad">
              <b>名单没过注册校验：</b>
              <ul className="issue-list">
                {issues.map((issue, i) => (
                  <li key={`${issue.rule}-${i}`}>{issue.message}</li>
                ))}
              </ul>
            </div>
          )}
          {/* 绿「通过」条在 off 档不出现（v6.33.1）：隔离期里它会被误读成管理员真做了体检 */}
          {issues === null && squad.compliance?.pass && (
            <div className="banner ok">资格检查通过，可以安心开赛。</div>
          )}
          {unsignedRows.length > 0 && (
            <div className="banner warn">
              <b>未签约（{unsignedRows.length} 人）：</b>
              不占人数、不计工资，但上不了场。{unsignedRows.map((p) => p.name).join('、')}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ---------- 工资帽投影条：v6.54.0 步骤 8 起住 pages/club/CapBar.tsx（工作台与超帽弹窗共用） ---------- */

/* ---------- 续约与解约（v0.6.0 旁路，规则 4.4.3 / 4.4.4） ---------- */

function BypassSection({ squad, onRefresh }: { squad: SquadOverview; onRefresh: () => void }) {
  const { show, toastNode } = useToast();
  const [rcPlayerId, setRcPlayerId] = useState('');
  const [newFee, setNewFee] = useState('');
  const [rcBusy, setRcBusy] = useState(false);
  const [termPlayerId, setTermPlayerId] = useState('');
  const [termArmed, setTermArmed] = useState(false);
  const [termBusy, setTermBusy] = useState(false);

  const formal = useMemo(
    () => squad.players.filter((p) => p.hasContract && p.contractType === 'formal' && p.status === 'normal'),
    [squad.players],
  );
  const rcPlayer = formal.find((p) => String(p.id) === rcPlayerId) ?? null;
  const termPlayer = formal.find((p) => String(p.id) === termPlayerId) ?? null;
  // 解约费预览（v6.63.3，core terminationFee 单一出处；违约金 / 效力缺失回 null → hint 退回原文案）
  const termFee = termPlayer === null ? null : terminationFeePreview(termPlayer.releaseFee, termPlayer.serviceSeasons);

  const rcBounds = useMemo(() => {
    if (!rcPlayer) return null;
    const rc = rcPlayer.releaseFee ?? 0;
    return rc <= 20
      ? { lo: Math.max(0, rc - 10), hi: rc + 10, label: '±10m' }
      : { lo: rc * 0.5, hi: rc * 1.5, label: '±50%' };
  }, [rcPlayer]);

  async function submitRcChange() {
    if (rcBusy || !rcPlayer) return;
    setRcBusy(true);
    try {
      const res = await apiPost<RcChangeResult>('/api/transfers/rc-change', {
        playerId: rcPlayer.id,
        newReleaseFee: Number(newFee),
      });
      show(
        res.freeRcChange === true
          ? res.newReleaseFee > res.oldReleaseFee
            ? `续约申请已提交：${rcPlayer.name} 违约金 ${res.oldReleaseFee.toFixed(2)} → ${res.newReleaseFee.toFixed(2)}m，本次免费：提价不收差额，保护期不变。`
            : `续约申请已提交：${rcPlayer.name} 违约金 ${res.oldReleaseFee.toFixed(2)} → ${res.newReleaseFee.toFixed(2)}m，本次免费：降价不收费，保护期不变。`
          : res.changeFee > 0
            ? `续约申请已提交：${rcPlayer.name} 违约金 ${res.oldReleaseFee.toFixed(2)} → ${res.newReleaseFee.toFixed(2)}m，加价部分 30% 共 ${res.changeFee.toFixed(2)}m 待审核时收，保护期在本窗关闭时结束。`
            : `续约申请已提交：${rcPlayer.name} 违约金 ${res.oldReleaseFee.toFixed(2)} → ${res.newReleaseFee.toFixed(2)}m，降价免费，保护期在本窗关闭时结束。`,
      );
      setRcPlayerId('');
      setNewFee('');
      onRefresh();
    } catch (err) {
      show(err instanceof Error ? err.message : '续约提交失败', true);
    } finally {
      setRcBusy(false);
    }
  }

  async function submitTermination() {
    if (termBusy || !termPlayer) return;
    setTermBusy(true);
    try {
      const res = await apiPost<TerminationResult>('/api/transfers/termination', { playerId: termPlayer.id });
      show(
        res.terminationFee > 0
          ? `解约申请已提交：${termPlayer.name}，解约费 ${res.terminationFee.toFixed(2)}m 待审核时回收。他本窗内全联盟禁签。`
          : `解约申请已提交：${termPlayer.name}，效力满 3 赛季免费解约。他本窗内全联盟禁签。`,
      );
      setTermPlayerId('');
      setTermArmed(false);
      onRefresh();
    } catch (err) {
      show(err instanceof Error ? err.message : '解约提交失败', true);
    } finally {
      setTermBusy(false);
    }
  }

  return (
    <section className="card">
      <h3>续约与解约</h3>
      {toastNode}
      <p className="hint">
        两种方式都直接开单送管理组审核：续约改违约金（违约金 ≤ 20m 时幅度 ±10m、超过 20m 时幅度 ±50%）。每份合同有一次免费续约机会——
        提价不收差额、保护期不变，用完后提高付差额的 30%、降低免费，保护期在本窗关闭时结束。解约效力满 3 赛季免费，
        不足 3 赛季按违约金 ×（3 − 效力赛季数）× 10% 回收解约费，被解约球员本窗全联盟禁签。
      </p>
      {formal.length === 0 ? (
        <p className="muted">队里还没有带正式合同的球员，这两条操作都做不了。</p>
      ) : (
        <>
          <div className="inline-form">
            <div className="field grow">
              <label htmlFor="rc-player">续约球员</label>
              <select id="rc-player" value={rcPlayerId} onChange={(e) => { setRcPlayerId(e.target.value); setNewFee(''); }}>
                <option value="">选一名球员…</option>
                {formal.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}（违约金 {(p.releaseFee ?? 0).toFixed(2)}m）
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="rc-new">新违约金（m）</label>
              <input
                id="rc-new"
                className="mono"
                type="number"
                min="0"
                step="0.5"
                value={newFee}
                onChange={(e) => setNewFee(e.target.value)}
                placeholder={rcBounds ? rcBounds.lo.toFixed(2) : ''}
                disabled={!rcPlayer}
              />
            </div>
            <button
              className="btn"
              type="button"
              disabled={rcBusy || !rcPlayer || newFee === ''}
              onClick={submitRcChange}
            >
              {rcBusy ? '提交中…' : '提交续约'}
            </button>
          </div>
          {rcPlayer && rcBounds && (
            <p className="hint">
              {rcPlayer.name} 现违约金 {(rcPlayer.releaseFee ?? 0).toFixed(2)}m，允许幅度 {rcBounds.label}：
              {' '}{rcBounds.lo.toFixed(2)} – {rcBounds.hi.toFixed(2)}m。
              {rcPlayer.freeRcAvailable
                ? '本次免费：提价不收差额、保护期不变（每份合同一次）。'
                : '提高要付差额的 30%，降低免费；保护期在本窗关闭时结束。'}
            </p>
          )}

          <div className="inline-form">
            <div className="field grow">
              <label htmlFor="term-player">解约球员</label>
              <select id="term-player" value={termPlayerId} onChange={(e) => { setTermPlayerId(e.target.value); setTermArmed(false); }}>
                <option value="">选一名球员…</option>
                {formal.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              className={`btn btn-danger${termArmed ? ' btn-armed' : ''}`}
              type="button"
              disabled={termBusy || !termPlayer}
              onClick={() => (termArmed ? submitTermination() : setTermArmed(true))}
              onBlur={() => setTermArmed(false)}
            >
              {termBusy ? '提交中…' : termArmed ? '再点一次确认解约' : '提交解约'}
            </button>
          </div>
          {termPlayer && (
            <p className="hint">
              {termFee !== null &&
                (termFee > 0
                  ? `解约费 ${termFee.toFixed(2)}m（效力 ${termPlayer.serviceSeasons} 赛季，审核时收取）。`
                  : `效力 ${termPlayer.serviceSeasons} 赛季已满 3 赛季，本次解约免费。`)}
              解约 {termPlayer.name} 后他将进入自由球员名单，本窗内全联盟（包括你家）都不能再签他。
            </p>
          )}
        </>
      )}
    </section>
  );
}

/* ---------- 候选名单卡（v6.58.0） ---------- */

/** 我的球队 · 候选名单：FM shortlist 的查看/移出入口；加入走球员库星标或球员页 SideOps。 */
function ShortlistCard() {
  const query = useShortlist();
  const invalidate = useShortlistInvalidation();
  const { show, toastNode } = useToast();
  const [busyId, setBusyId] = useState<number | null>(null);
  const items = query.data?.items ?? [];
  const cap = query.data?.cap ?? 30;

  async function remove(id: number): Promise<void> {
    if (busyId !== null) return;
    setBusyId(id);
    try {
      await apiSend('DELETE', `/api/club/shortlist/${id}`);
      invalidate();
    } catch (err) {
      show(err instanceof Error ? err.message : '移出候选名单失败', true);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card">
      {toastNode}
      <h3>
        候选名单 <span className="muted">（{items.length} / {cap}）</span>
      </h3>
      {query.isError ? (
        <p className="muted">{query.error instanceof Error ? query.error.message : '候选名单读不出来'}</p>
      ) : query.isPending ? (
        <p className="muted">正在读候选名单…</p>
      ) : items.length === 0 ? (
        <p className="muted">还没有候选球员。到球员库点「候选」列的星标，或在球员页操作区加入。</p>
      ) : (
        <div className="table-wrap">
          <table className="dossier-table">
            <thead>
              <tr>
                <th>球员</th>
                <th>所属</th>
                <th>位置</th>
                <th className="num">年龄</th>
                <th className="num">CA</th>
                <th className="num">PA</th>
                <th>备注</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.player.fcId !== null ? (
                      <Link to={playerPath({ id: item.playerId, fcId: item.player.fcId })}>{item.player.name}</Link>
                    ) : (
                      item.player.name
                    )}
                  </td>
                  <td>{item.player.clubName ?? '自由身'}</td>
                  <td>{item.player.position ?? '—'}</td>
                  <td className="num mono">{item.player.age ?? '—'}</td>
                  <td className="num mono">{item.player.ca ?? '—'}</td>
                  <td className="num mono">{item.player.pa ?? '—'}</td>
                  <td>{item.note ?? '—'}</td>
                  <td>
                    <button type="button" className="btn btn-sm btn-ghost" disabled={busyId === item.id} onClick={() => void remove(item.id)}>
                      移出
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
