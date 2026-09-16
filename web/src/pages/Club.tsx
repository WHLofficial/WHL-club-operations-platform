// 球队中心（增量 2 + 增量 5 旁路）：球队头 + 注册工作台 + 续约/解约（规则 4.4.3/4.4.4）
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  ApiError,
  api,
  apiPost,
  type MyClubOverview,
  type RcChangeResult,
  type RegistrationResult,
  type SquadIssue,
  type SquadOverview,
  type StadiumInfo,
  type SquadPlayerRow,
  type TerminationResult,
} from '../lib/api.ts';
import { CONTRACT_TYPE_LABEL, LEAGUE_TIER_LABEL } from '../lib/ref.ts';
import { useToast } from '../lib/toast.tsx';

type SquadFilter = 'all' | 'first_team' | 'trainee';
type Assignment = 'none' | 'first_team' | 'trainee';

const SQUAD_FILTER_LABEL: Record<SquadFilter, string> = { all: '全部', first_team: '一线队', trainee: '训练营' };

export default function Club() {
  const [overview, setOverview] = useState<MyClubOverview | null>(null);
  const [squad, setSquad] = useState<SquadOverview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<MyClubOverview>('/api/me/club')
      .then((data) => {
        setOverview(data);
        if (data.club) return api<SquadOverview>('/api/club/squad');
        return null;
      })
      .then((data) => {
        if (data) setSquad(data);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '加载球队信息失败');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="container">
        <h1>球队中心</h1>
        <div className="card empty-state">
          <p className="muted">正在翻档案…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <h1>球队中心</h1>
        <div className="banner warn">{error}</div>
        <div className="card empty-state">
          <p className="muted">观众视角看不到球队内部。转会操作需要教练账号。</p>
        </div>
      </div>
    );
  }

  if (!overview?.club) {
    return (
      <div className="container">
        <h1>球队中心</h1>
        <div className="card empty-state">
          <p className="muted">你的账号还没有绑定俱乐部。拿到管理组发的 8 位认证码，一表定归属。</p>
          <Link className="btn" to="/bind">
            去球队登记
          </Link>
        </div>
      </div>
    );
  }

  const { club, balance, squadCount, window: win, home } = overview;

  return (
    <div className="container">
      <h1>球队中心</h1>
      {club.transferBanned && (
        <section className="card banner banner-bad" role="alert">
          ⛔ 本俱乐部的转会权限已被管理组冻结：挂牌、出价、海捞、激活、议价等新操作都会被拦下。请联系管理组处理相关事项。
        </section>
      )}
      <section className="card club-head">
        <div className="club-head-main">
          <h2>{club.name}</h2>
          <div className="club-head-badges">
            <span className={`badge ${club.leagueTier === 'premier' ? 'gold' : 'gray'}`}>
              {club.leagueTier ? (LEAGUE_TIER_LABEL[club.leagueTier] ?? club.leagueTier) : '未定级'}
            </span>
            {win && (
              <span className="badge sky">
                第 {win.season} 赛季 · 窗口 {win.windowSeq}
              </span>
            )}
          </div>
        </div>
        <div className="club-head-numbers">
          <div className="club-stat">
            <span className="stat-label">资金余额</span>
            <span className="stat-value mono gold-text">{balance === null ? '—' : `${balance.toFixed(2)} m`}</span>
          </div>
          <div className="club-stat">
            <span className="stat-label">一线队名单</span>
            <span className="stat-value mono">{squadCount ?? '—'} 人</span>
          </div>
          <div className="club-stat">
            <span className="stat-label">当前窗口</span>
            <span className="stat-value stat-value-small">{win ? '进行中' : '还没开'}</span>
          </div>
        </div>
        {!win && <p className="hint">转会窗口还没开。窗口开了之后，这里会挂出市场与注册入口。</p>}
      </section>

      {home && <StadiumCard home={home} />}

      {squad && <RegistrationSection squad={squad} onRefresh={() => api<SquadOverview>('/api/club/squad').then(setSquad)} />}

      {squad && (
        <BypassSection
          squad={squad}
          onRefresh={() => api<SquadOverview>('/api/club/squad').then(setSquad)}
        />
      )}
    </div>
  );
}

/* ---------- 主场档案（增量 12，只读） ---------- */

const FACILITY_LABEL: Record<string, string> = {
  commercial: '商业区',
  broadcast: '灯光转播',
  pitch: '草皮',
  youth: '青训中心',
  medical: '医疗中心',
};

function StadiumCard({ home }: { home: StadiumInfo }) {
  return (
    <section className="card">
      <h3>主场档案</h3>
      <p>
        <b>{home.name || '未冠名'}</b> · {home.tierName ?? `档位 ${home.tier}`}（{home.tier} 级） · 容量{' '}
        <span className="mono">{home.capacity.toLocaleString()}</span> 座 · 死忠球迷{' '}
        <span className="mono">{Math.round(home.fans).toLocaleString()}</span>
      </p>
      <p className="hint">
        球队影响力 <span className="mono">{home.influence.total.toFixed(1)}</span>（球员{' '}
        <span className="mono">{home.influence.players.toFixed(1)}</span> + 队壳{' '}
        <span className="mono">{home.influence.shell.toFixed(1)}</span> + 奖励分{' '}
        <span className="mono">{home.influence.bonus.toFixed(1)}</span>）——影响上座率与比赛日收入
      </p>
      {home.facilities.length > 0 && (
        <p className="hint">
          设施：
          {home.facilities.map((f) => (
            <span key={f.key} className="badge gray" style={{ marginLeft: 6 }}>
              {FACILITY_LABEL[f.key] ?? f.key} {f.level} 级
            </span>
          ))}
        </p>
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
  const [issues, setIssues] = useState<SquadIssue[] | null>(squad.compliance && !squad.compliance.pass ? squad.compliance.issues : null);
  const [lastResult, setLastResult] = useState<RegistrationResult | null>(null);

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
      setIssues(null);
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
      <h3>注册名单{squad.season !== null ? ` · 第 ${squad.season} 赛季` : ''}</h3>
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
      {!rules ? (
        <p className="muted">{squad.registeredInTournament ? '正在加载注册规则…' : '报名完成后这里会挂出注册规则。'}</p>
      ) : (
        <>
          <p className="hint">
            一线队 {rules.squadMin}-{rules.squadMax} 人、至少 {rules.gkMin} 名门将；训练营 ≤{rules.traineeMax} 人且须可成长（PA−CA＞0）。
            {rules.tier && <>初始CA 限额：≥90 最多 {rules.limits.ge90} 名、≥87 最多 {rules.limits.ge87} 名、＜87 且 PA≥87 可成长最多 {rules.limits.growthPa87} 名。</>}
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

          <div className="seg" role="radiogroup" aria-label="按名单筛选">
            {(Object.keys(SQUAD_FILTER_LABEL) as SquadFilter[]).map((key) => (
              <button key={key} type="button" className={filter === key ? 'on' : ''} onClick={() => setFilter(key)}>
                {SQUAD_FILTER_LABEL[key]}
                {key !== 'all' && `（${squad.players.filter((p) => (assign[p.id] ?? 'none') === key).length}）`}
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <div className="empty-state">
              <p className="muted">
                {squad.players.length === 0
                  ? '名单还是空的。等管理组导入球员、签下合同之后，这里就是你的更衣室。'
                  : '这个名单还没有人。点球员行右侧的分段按钮，把人分进一线队或训练营。'}
              </p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>球员</th>
                    <th>位置</th>
                    <th className="num">年龄</th>
                    <th className="num">CA</th>
                    <th className="num">PA</th>
                    <th className="num">工资</th>
                    <th>合同</th>
                    <th>分配</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <SquadRow key={p.id} player={p} value={assign[p.id] ?? 'none'} editable={editable} onChange={setAssignment} />
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
          {issues === null && squad.compliance?.pass && lastResult === null && (
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
  onChange,
}: {
  player: SquadPlayerRow;
  value: Assignment;
  editable: boolean;
  onChange: (playerId: number, next: Assignment) => void;
}) {
  const traineeBlocked = !player.growable || (player.pa !== null && player.ca !== null && player.pa - player.ca <= 0);
  return (
    <tr className={value === 'trainee' ? 'row-trainee' : undefined}>
      <td>
        <Link to={`/players/${player.id}`}>{player.name}</Link>
        {player.status === 'retired' && <span className="badge gray">退役</span>}
      </td>
      <td>{player.position ?? '—'}</td>
      <td className="num">{player.age ?? '—'}</td>
      <td className="num mono">{player.ca ?? '—'}</td>
      <td className="num mono">{player.pa ?? '—'}</td>
      <td className="num mono">{player.wage === null ? '—' : player.wage.toFixed(2)}</td>
      <td>
        {player.hasContract ? (
          <span className="badge gray">{CONTRACT_TYPE_LABEL[player.contractType ?? 'formal'] ?? '正式合同'}</span>
        ) : (
          <span className="badge red" title="等管理组导入合同模板后才能注册">
            无合同
          </span>
        )}
      </td>
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
    </tr>
  );
}

/* ---------- 续约与解约（增量 5 旁路，规则 4.4.3 / 4.4.4） ---------- */

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
          : `解约申请已提交：${termPlayer.name}，效力满三年免费解约。他本窗内全联盟禁签。`,
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
        保护期从审核通过重新起算）；解约效力满三年免费，不足三年按违约金 ×（3 − 效力年数）× 10% 回收解约费，被解约球员本窗全联盟禁签。
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
