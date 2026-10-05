// 工作台页签（v6.30.0 A 段：自 pages/ClubDetail.tsx 教练台 CoachPanel 拆入，自家专属）。
// 转会禁令 banner + 注册工作台（含 SquadRow）+ 续约与解约（规则 4.4.3/4.4.4）+ 随机事件。
// 注册名单查询（qk.squad）住在本组件里：只有激活「工作台」才挂载、才发请求。
// v6.30.0 C 段：注册名单重定列集 —— 11 固定列（分配最左 + 标记/号码/UID/姓名/年龄/位置/CA/PA/违约金/工资）
//   + 可选列（?regcols=，默认全不显示）+「列」开关；「无合同」红徽章与违规旗标随姓名格走（分配列控件本身没动）。
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
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
  type SquadPlayerRow,
  type TerminationResult,
} from '../../lib/api.ts';
import { LEAGUE_TIER_LABEL } from '../../lib/ref.ts';
import { MARKER_EMOJI, MARKER_LABEL, money } from '../../lib/players-library.ts';
import { qk } from '../../lib/queries.ts';
import { useToast } from '../../lib/toast.tsx';
import { playerPath } from '../../lib/player-link.ts';
import { useTimeFmt } from '../../lib/datetime.ts';
import {
  CLUB_COL_ITEMS,
  REG_COLS_KEY,
  REG_FIXED_COLS,
  clubColDef,
  clubVisibleCols,
  renderClubCol,
  toggleClubCol,
} from '../../lib/club-columns.tsx';
import MultiSelect from '../../components/MultiSelect.tsx';

type SquadFilter = 'all' | 'first_team' | 'trainee';
type Assignment = 'none' | 'first_team' | 'trainee';

const SQUAD_FILTER_LABEL: Record<SquadFilter, string> = { all: '全部', first_team: '一线队', trainee: '训练营' };

// 标红 badge 的短标签（完整原因在 message，悬浮 title 兜底）
const ISSUE_RULE_LABEL: Record<string, string> = {
  squad_size: '人数',
  gk: '门将',
  trainee_size: '训练营人数',
  trainee_growth: '不可成长',
  ca_pa: '初始CA限额',
  contract: '无合同',
  wage_cap: '工资帽',
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

  // v6.30.0 C 段：可选列进 URL（?regcols=）—— 与阵容名单的 ?cols= 分开键，两张表在不同页签，防串味
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCols = clubVisibleCols(searchParams.get(REG_COLS_KEY));
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
          特例期：注册校验已隔离——提交只做归属/重复校验，人数、门将、训练营资格都不再拦，管理员已临时放行。
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
            工资帽以半赛季计{wageCap === null ? '（本季度未配置，暂不校验）' : `，上限 ${wageCap} m`}。
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
                {wageCap !== null ? `${stats.wageTotal.toFixed(2)}/${wageCap} m` : `${stats.wageTotal.toFixed(2)} m`}
              </span>
            </div>
          </div>
          {wageCap !== null && (
            <div className="cap-bar" title={`工资帽 ${wageCap} m`}>
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
            <MultiSelect
              label="列"
              items={CLUB_COL_ITEMS}
              selected={activeCols}
              onToggle={(key) => writeCols(toggleClubCol(activeCols, key))}
              onClear={() => writeCols([])}
            />
          </div>

          {rows.length === 0 ? (
            <div className="empty-state">
              <p className="muted">
                {squad.players.length === 0
                  ? '名单还是空的。等管理组导入球员、签下合同之后，这里就是你的更衣室。'
                  : '这个名单还没有人。点球员行最左的分段按钮，把人分进一线队或训练营。'}
              </p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="coach-sticky">
                <thead>
                  <tr>
                    {REG_FIXED_COLS.map((col) => (
                      <th key={col.key} className={col.num ? 'num' : undefined}>
                        {col.label}
                      </th>
                    ))}
                    {activeCols.map((key) => {
                      const def = clubColDef(key);
                      return (
                        <th key={key} className={def.num ? 'num' : undefined}>
                          {def.label}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <SquadRow
                      key={p.id}
                      player={p}
                      value={assign[p.id] ?? 'none'}
                      editable={editable}
                      flags={flagged.get(p.id)}
                      cols={activeCols}
                      onChange={setAssignment}
                    />
                  ))}
                </tbody>
              </table>
            </div>
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
              {wageCap !== null ? `${lastResult.wageTotal.toFixed(2)}/${wageCap}` : lastResult.wageTotal.toFixed(2)} m。
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

function SquadRow({
  player,
  value,
  editable,
  flags,
  cols,
  onChange,
}: {
  player: SquadPlayerRow;
  value: Assignment;
  editable: boolean;
  flags?: SquadIssue[];
  cols: string[];
  onChange: (playerId: number, next: Assignment) => void;
}) {
  const traineeBlocked = !player.growable || (player.pa !== null && player.ca !== null && player.pa - player.ca <= 0);
  return (
    <tr className={`${value === 'trainee' ? 'row-trainee' : ''}${flags !== undefined && flags.length > 0 ? ' row-flagged' : ''}`.trim() || undefined}>
      {/* 分配列最左（v6.30.0 C 段）：分段按钮就是这张表的主操作，贴着球员名一起看 */}
      <td>
        <div className="seg seg-mini" role="radiogroup" aria-label={`${player.name} 的注册分配`}>
          {(['none', 'first_team', 'trainee'] as Assignment[]).map((opt) => (
            <button
              key={opt}
              type="button"
              className={value === opt ? 'on' : ''}
              disabled={!editable || (opt !== 'none' && !player.hasContract)}
              title={opt !== 'none' && !player.hasContract ? '没有现行合同，先让管理组导入合同模板' : undefined}
              onClick={() => onChange(player.id, value === opt ? 'none' : opt)}
            >
              {opt === 'none' ? '—' : opt === 'first_team' ? '一线' : '训练营'}
            </button>
          ))}
        </div>
        {value === 'trainee' && traineeBlocked && <span className="error-msg">不可成长</span>}
      </td>
      <td className="marker-cell" title={player.marker ? MARKER_LABEL[player.marker] : undefined}>
        {player.marker ? MARKER_EMOJI[player.marker] : ''}
      </td>
      {/* 号码只读（v4.0.0）：定号/改号在球员卡的合同页签，那里才有归属校验的上下文 */}
      <td className="num mono">{player.number ?? '—'}</td>
      <td className="mono">{player.uid.replace(/^fc/, '')}</td>
      <td>
        <Link to={playerPath(player)}>{player.name}</Link>
        {flags !== undefined &&
          flags.length > 0 &&
          flags.map((issue, i) => (
            <span key={i} className="badge red" title={issue.message}>
              {ISSUE_RULE_LABEL[issue.rule] ?? issue.rule}
            </span>
          ))}
        {/* 「无合同」红徽章随姓名走（v6.30.0 C 段）：合同列撤了，但它是注册被拦的头号原因，不能跟着消失 */}
        {!player.hasContract && (
          <span className="badge red" title="等管理组导入合同模板后才能注册">
            无合同
          </span>
        )}
        {player.status === 'retired' && <span className="badge gray">退役</span>}
      </td>
      <td className="num">{player.age ?? '—'}</td>
      <td>{player.position ?? '—'}</td>
      <td className="num mono">{player.ca ?? '—'}</td>
      <td className="num mono">{player.pa ?? '—'}</td>
      <td className="num mono">{player.releaseFee === null ? '—' : money(player.releaseFee)}</td>
      <td className="num mono">{player.wage === null ? '—' : money(player.wage)}</td>
      {cols.map((key) => renderClubCol(key, player))}
    </tr>
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
      ? { lo: Math.max(0, rc - 10), hi: rc + 10, label: '±10 m' }
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
          ? `续约申请已提交：${rcPlayer.name} 违约金 ${res.oldReleaseFee.toFixed(2)} → ${res.newReleaseFee.toFixed(2)} m，加价部分 30% 共 ${res.changeFee.toFixed(2)} m 待审核时收。`
          : `续约申请已提交：${rcPlayer.name} 违约金 ${res.oldReleaseFee.toFixed(2)} → ${res.newReleaseFee.toFixed(2)} m，降价免费，保护期从审核通过那一刻重新起算。`,
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
          ? `解约申请已提交：${termPlayer.name}，解约费 ${res.terminationFee.toFixed(2)} m 待审核时回收。他本窗内全联盟禁签。`
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
        两种方式都直接开单送管理组审核：续约改违约金（违约金 ≤ 20 m 时幅度 ±10 m、超过 20 m 时幅度 ±50%；提高付差额的 30%，降低免费，
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
                    {p.name}（违约金 {(p.releaseFee ?? 0).toFixed(2)} m）
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
              {rcPlayer.name} 现违约金 {(rcPlayer.releaseFee ?? 0).toFixed(2)} m，允许幅度 {rcBounds.label}：
              {' '}{rcBounds.lo.toFixed(2)} – {rcBounds.hi.toFixed(2)} m。提高要付差额的 30%，降低免费。
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
