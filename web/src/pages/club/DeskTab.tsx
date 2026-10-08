// 工作台页签（v6.30.0 A 段：自 pages/ClubDetail.tsx 教练台 CoachPanel 拆入，自家专属）。
// 转会禁令 banner + 注册工作台 + 续约与解约（规则 4.4.3/4.4.4）+ 随机事件。
// 注册名单查询（qk.squad）住在本组件里：只有激活「工作台」才挂载、才发请求。
// v6.30.0 C 段：注册名单重定列集 —— 分配列 + 标记/号码/UID/姓名/年龄/位置/CA/PA/违约金/工资 + 可选列（?regcols=）。
// v6.37.0 卡片化：注册名单表整表重构为「位置四组容器 + 行解剖卡」，与 SquadTab 同构（组件在 card-parts.tsx）——
//   行尾「分配 ▾」下拉取代最左分段按钮（三选全称，无合同禁一线/训练营）；违规旗标/无合同/退役徽章随姓名走；
//   桌面 = 全列合并 +「列…」自选长尾；窄屏（≤760px）= 四视图 chips 快切；非开窗期下拉整体禁用。
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  api,
  apiPost,
  type ClubEventChooseResult,
  type ClubEventRecent,
  type ClubEventsResponse,
  type MyClubOverview,
  type RcChangeResult,
  type RegistrationResult,
  type SquadIssue,
  type SquadOverview,
  type TerminationResult,
} from '../../lib/api.ts';
import { LEAGUE_TIER_LABEL } from '../../lib/ref.ts';
import { qk } from '../../lib/queries.ts';
import { useToast } from '../../lib/toast.tsx';
import { useTimeFmt } from '../../lib/datetime.ts';
import { CARD_VIEW_CELLS, DESKTOP_CELLS_DESK, groupRowsByPosition, type CardViewKey } from '../../lib/club-cards.ts';
import { CARD_EXTRA_ITEMS, REG_COLS_KEY, parseCardExtras, toggleClubCol } from '../../lib/club-columns.tsx';
import MultiSelect from '../../components/MultiSelect.tsx';
import { useMediaQuery } from '../../lib/use-media.ts';
import {
  CardGroup,
  RegCard,
  VIEW_COL_WIDTH,
  VIEW_GRID_COLS,
  ViewChips,
  extraColDefs,
  type AssignValue,
} from './card-parts.tsx';

type SquadFilter = 'all' | 'first_team' | 'trainee';
type Assignment = AssignValue;

const SQUAD_FILTER_LABEL: Record<SquadFilter, string> = { all: '全部', first_team: '一线队', trainee: '训练营' };

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
      {club.transferBanned && (
        <section className="card banner banner-bad" role="alert">
          ⛔ 本俱乐部的转会权限已被管理组冻结：挂牌、出价、海捞、激活、议价等新操作都会被拦下。请联系管理组处理相关事项。
        </section>
      )}

      {squad && <RegistrationSection squad={squad} onRefresh={refreshSquad} />}

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

function RegistrationSection({ squad, onRefresh }: { squad: SquadOverview; onRefresh: () => void }) {
  const { show, toastNode } = useToast();
  // 分配表：未提交过 → 以空表起步；已提交过 → 以快照起步
  const [assign, setAssign] = useState<Record<number, Assignment>>(() => {
    const init: Record<number, Assignment> = {};
    if (squad.registration) {
      for (const id of squad.registration.firstTeam) init[id] = 'first_team';
      for (const id of squad.registration.trainee) init[id] = 'trainee';
    }
    return init;
  });
  const [filter, setFilter] = useState<SquadFilter>('all');
  const [busy, setBusy] = useState(false);
  // 特例期 off 档不挂红字（v6.33.1）：compliance 即使不通过也保持空白
  const [issues, setIssues] = useState<SquadIssue[] | null>(
    squad.checkMode !== 'off' && squad.compliance && !squad.compliance.pass ? squad.compliance.issues : null,
  );
  const [lastResult, setLastResult] = useState<RegistrationResult | null>(null);

  // issues 跟随 squad 更新（v6.33.1 复查修复）：父组件不给 key，换档位 / 换名单 / 提交后 refreshSquad
  // 刷新 squad 时，红字必须收敛到最新体检结果，不能停在首挂算出的那一版。
  // 依赖整份 squad（checkMode 与 compliance 都是它的字段），不放 issues 免得自触发。
  useEffect(() => {
    setIssues(squad.checkMode !== 'off' && squad.compliance && !squad.compliance.pass ? squad.compliance.issues : null);
  }, [squad]);

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
  const editable = squad.season !== null;

  // 窄屏四视图 chips 的当前视图；桌面无 chips（全列合并），这个状态闲置
  const narrow = useMediaQuery('(max-width: 760px)');
  const [view, setView] = useState<CardViewKey>('basic');
  const cells = narrow ? CARD_VIEW_CELLS[view] : DESKTOP_CELLS_DESK;
  const extras = extraColDefs(activeCols);

  const stats = useMemo(() => {
    const first = squad.players.filter((p) => assign[p.id] === 'first_team');
    const trainee = squad.players.filter((p) => assign[p.id] === 'trainee');
    const all = [...first, ...trainee];
    return {
      firstTeam: first.length,
      goalkeepers: first.filter((p) => p.position === 'GK').length,
      trainee: trainee.length,
      wageTotal: all.reduce((sum, p) => sum + (p.wage ?? 0), 0),
    };
  }, [squad.players, assign]);

  const rows = useMemo(() => {
    return squad.players.filter((p) => {
      if (filter === 'all') return true;
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

  function setAssignment(playerId: number, next: Assignment) {
    setAssign((prev) => ({ ...prev, [playerId]: next }));
    setLastResult(null);
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    setIssues(null);
    try {
      const firstTeam = squad.players.filter((p) => assign[p.id] === 'first_team').map((p) => p.id);
      const trainee = squad.players.filter((p) => assign[p.id] === 'trainee').map((p) => p.id);
      const res = await apiPost<RegistrationResult>('/api/club/registrations', { firstTeam, trainee });
      setLastResult(res);
      // warn 档放行后要把真实体检结果继续挂成红字；off 档隐藏；enforce 通过时 issues 恒为 []（清空）
      setIssues(res.checkMode !== 'off' && res.issues.length > 0 ? res.issues : null);
      show(`注册名单已提交：一线队 ${res.firstTeam} 人、训练营 ${res.trainee} 人。`);
      onRefresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && Array.isArray(err.issues)) {
        setIssues(err.issues);
      }
      show(err instanceof Error ? err.message : '提交失败', true);
    } finally {
      setBusy(false);
    }
  }

  const wageCap = rules?.wageCap ?? null;
  const capLeft = wageCap !== null ? wageCap - stats.wageTotal : null;

  return (
    <section className="card">
      <div className="tier-head">
        <h3>注册工作台{squad.season !== null ? ` · 第 ${squad.season} 赛季` : ''}</h3>
        <span className="muted">注册名单与名额校验</span>
      </div>
      {toastNode}
      {!squad.registeredInTournament ? (
        <div className="banner bad">
          尚未在赛事平台报名，请等待赛事平台管理员确认报名。名单可以在下面先排，但报名完成前提交不了注册。
        </div>
      ) : squad.rules?.tier && (
        <div className="banner ok">
          报名状态：<span className={`badge ${squad.rules.tier === 'premier' ? 'gold' : 'gray'}`}>
            {LEAGUE_TIER_LABEL[squad.rules.tier] ?? squad.rules.tier}
          </span>{' '}
          已由赛事报名派生，可正常提交注册。
        </div>
      )}
      {/* v6.33.1 特例期放行档：off 隔离 / warn 提示；enforce（正常档）不挂提示条 */}
      {squad.checkMode === 'off' && (
        <div className="banner warn">
          特例期：注册校验已隔离——提交只做归属/重复校验；一线队人数、门将、训练营人数与资格、CA/PA 梯度、现行合同、工资帽都不再拦，管理员已临时放行。
        </div>
      )}
      {squad.checkMode === 'warn' && (
        <div className="banner info">
          特例期：注册校验为提示模式——红字是真实体检结果，不通过也可以提交。
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
            <div className="club-stat">
              <span className="stat-label">工资</span>
              <span className={`stat-value mono${capLeft !== null && capLeft < 0 ? ' bad-text' : ' gold-text'}`}>
                {wageCap !== null ? `${stats.wageTotal.toFixed(2)}/${wageCap}m` : `${stats.wageTotal.toFixed(2)}m`}
              </span>
            </div>
          </div>
          {wageCap !== null && (
            <div className="cap-bar" title={`${rules.tier ? `${LEAGUE_TIER_LABEL[rules.tier] ?? rules.tier} ` : ''}工资帽 ${wageCap}m（扣款下限 ${wageCap - 15}m）`}>
              <div
                className={`cap-bar-fill${capLeft !== null && capLeft < 0 ? ' over' : ''}`}
                style={{ width: `${Math.min(100, (stats.wageTotal / wageCap) * 100)}%` }}
              />
            </div>
          )}

          {!editable && (
            <div className="banner warn">当前没有开放注册的赛季（只有备赛期能提交名单）。名单暂时只读。</div>
          )}

          <div className="tier-head">
            <div className="seg" role="radiogroup" aria-label="按名单筛选">
              {(Object.keys(SQUAD_FILTER_LABEL) as SquadFilter[]).map((key) => (
                <button key={key} type="button" className={filter === key ? 'on' : ''} onClick={() => setFilter(key)}>
                  {SQUAD_FILTER_LABEL[key]}
                  {key !== 'all' && `（${squad.players.filter((p) => (assign[p.id] ?? 'none') === key).length}）`}
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
                    // 行尾恒有「分配 ▾」列 ⇒ 组头列头右侧让出同宽（--sqc-assignw），列头才与值区对齐
                    assign
                  >
                    {g.rows.map((p) => (
                      <RegCard
                        key={p.id}
                        row={p}
                        view={view}
                        assign={assign[p.id] ?? 'none'}
                        flags={flagged.get(p.id) ?? []}
                        extras={extras}
                        wide={!narrow}
                        editable={editable}
                        onAssign={(next) => setAssignment(p.id, next)}
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
          {issues === null && squad.checkMode !== 'off' && squad.compliance?.pass && lastResult === null && (
            <div className="banner ok">资格检查通过，可以安心开赛。</div>
          )}
          {lastResult !== null && (
            <div className="banner ok">
              第 {lastResult.season} 赛季注册完成：一线队 {lastResult.firstTeam} 人、训练营 {lastResult.trainee} 人，工资{' '}
              {wageCap !== null ? `${lastResult.wageTotal.toFixed(2)}/${wageCap}` : lastResult.wageTotal.toFixed(2)}m。
              <span className="stamp stamp-ok stamp-inline">注册完成</span>
            </div>
          )}

          <div className="btn-row">
            <button className="btn" type="button" disabled={!editable || busy || !squad.registeredInTournament} onClick={submit}>
              {busy ? '提交中…' : squad.registration ? '重新提交注册名单' : '提交注册名单'}
            </button>
            {squad.registration && <span className="hint">重复提交会整体替换本赛季注册名单，放心改。</span>}
          </div>
        </>
      )}
    </section>
  );
}

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
        res.changeFee > 0
          ? `续约申请已提交：${rcPlayer.name} 违约金 ${res.oldReleaseFee.toFixed(2)} → ${res.newReleaseFee.toFixed(2)}m，加价部分 30% 共 ${res.changeFee.toFixed(2)}m 待审核时收。`
          : `续约申请已提交：${rcPlayer.name} 违约金 ${res.oldReleaseFee.toFixed(2)} → ${res.newReleaseFee.toFixed(2)}m，降价免费，保护期从审核通过那一刻重新起算。`,
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
        两种方式都直接开单送管理组审核：续约改违约金（违约金 ≤ 20m 时幅度 ±10m、超过 20m 时幅度 ±50%；提高付差额的 30%，降低免费，
        原保护期自审核通过起结束）；解约效力满 3 赛季免费，不足 3 赛季按违约金 ×（3 − 效力赛季数）× 10% 回收解约费，被解约球员本窗全联盟禁签。
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
              {' '}{rcBounds.lo.toFixed(2)} – {rcBounds.hi.toFixed(2)}m。提高要付差额的 30%，降低免费。
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
              解约 {termPlayer.name} 后他将进入自由球员名单，本窗内全联盟（包括你家）都不能再签他。
            </p>
          )}
        </>
      )}
    </section>
  );
}
