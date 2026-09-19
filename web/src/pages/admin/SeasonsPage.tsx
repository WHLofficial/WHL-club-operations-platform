// 管理端 · 赛季页：赛季与赛事绑定（§11，增量 6.1 层级）+ 赛果确认（附录 A〔6〕，确认钩子触发 XP/通知）
// （原 Admin.tsx 两 section，增量 15 拆分；commit 3 数据层转 TanStack Query）
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  apiPost,
  COMPETITION_TYPE_LABEL,
  TOUR_STATUS_LABEL,
  type BindTournamentResult,
  type ConfirmResultResult,
  type ResultsQueue,
  type SeasonBinding,
  type SeasonBindingsResponse,
  type SeasonRow,
  type SeasonsResponse,
  type SeasonSettleResult,
  type SettleCheckResult,
  type StageSettleResult,
  type TournamentRow,
} from '../../lib/api.ts';
import { SEASON_CURRENT_KEY, fetchSeasonCurrent } from '../../lib/adminQueries.ts';
import { useToast } from '../../lib/toast.tsx';

export default function SeasonsPage() {
  return (
    <div className="admin-page">
      <SeasonsSection />
      <ResultsSection />
    </div>
  );
}

function SeasonsSection() {
  const { show, toastNode } = useToast();
  const queryClient = useQueryClient();
  const [selectedSeason, setSelectedSeason] = useState('');
  const [newSeason, setNewSeason] = useState('');
  const [newAgeCap, setNewAgeCap] = useState('');
  const [settleArmed, setSettleArmed] = useState(false);
  const [settleCheck, setSettleCheck] = useState<SettleCheckResult | null>(null);
  const [seasonArmed, setSeasonArmed] = useState(false);
  const [bindTournament, setBindTournament] = useState('');
  const [bindType, setBindType] = useState('league_premier');
  const [bindArmed, setBindArmed] = useState(false);
  const [unbindArmedId, setUnbindArmedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // 原三个静默拉取（current/seasons/tournaments）转 query；失败静默置空保持原行为
  const { data: current } = useQuery({ queryKey: SEASON_CURRENT_KEY, queryFn: fetchSeasonCurrent });
  const { data: seasonsData } = useQuery({
    queryKey: ['admin', 'seasons'],
    queryFn: () => api<SeasonsResponse>('/api/admin/seasons').then((d) => d.seasons).catch(() => [] as SeasonRow[]),
  });
  const seasons = seasonsData ?? [];
  const { data: tournaments = [] } = useQuery({
    queryKey: ['admin', 'tournaments'],
    queryFn: () => api<{ tournaments: TournamentRow[] }>('/api/admin/tournaments').then((d) => d.tournaments).catch(() => [] as TournamentRow[]),
  });

  const seasonNo = Number(selectedSeason);

  // 绑定列表跟着所选赛季走：切赛季 = 切 key 自动重拉；失败静默置空保持原行为
  const { data: bindingsData } = useQuery({
    queryKey: ['admin', 'season-bindings', seasonNo],
    queryFn: () =>
      api<SeasonBindingsResponse>(`/api/admin/seasons/${seasonNo}/tournaments`).then((d) => d.bindings).catch(() => [] as SeasonBinding[]),
    enabled: !!seasonNo,
  });
  const bindings = seasonNo ? (bindingsData ?? []) : [];

  useEffect(() => {
    setUnbindArmedId(null);
    setBindArmed(false);
  }, [seasonNo]);

  // 默认选中当前赛季（还没建档时不选）
  useEffect(() => {
    if (!selectedSeason && seasons.length > 0) {
      setSelectedSeason(String(current?.season?.season ?? seasons[0]?.season ?? ''));
    }
  }, [seasons, current, selectedSeason]);

  const reload = () => {
    queryClient.invalidateQueries({ queryKey: SEASON_CURRENT_KEY });
    queryClient.invalidateQueries({ queryKey: ['admin', 'seasons'] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'tournaments'] });
  };
  const loadBindings = () => queryClient.invalidateQueries({ queryKey: ['admin', 'season-bindings'] });

  const newSeasonValid = Number.isInteger(Number(newSeason)) && Number(newSeason) > 0;
  const newAgeCapValid = newAgeCap.trim() === '' || (Number.isInteger(Number(newAgeCap)) && Number(newAgeCap) >= 15 && Number(newAgeCap) <= 40);
  const tournamentName = (id: number) => tournaments.find((t) => t.id === id)?.name;

  async function createSeason() {
    if (busy || !seasonArmed || !newSeasonValid) return;
    setBusy(true);
    try {
      const cap = newAgeCap.trim() === '' ? null : Number(newAgeCap);
      const res = await apiPost<{ ok: boolean; growable: number }>('/api/admin/seasons', { season: Number(newSeason), ageCap: cap });
      show(`赛季 ${Number(newSeason)} 已建档，进入备赛期${cap !== null ? `（可成长年龄上限 ${cap}，重判 growable ${res.growable} 人）` : ''}。`);
      setNewSeason('');
      setNewAgeCap('');
      setSeasonArmed(false);
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '建档失败', true);
    } finally {
      setBusy(false);
    }
  }

  async function runSeasonSettleCheck() {
    if (busy || !seasonNo) return;
    setBusy(true);
    try {
      const res = await api<SettleCheckResult>(`/api/admin/seasons/${seasonNo}/settle-check`);
      setSettleCheck(res);
      show(res.blockers.length > 0 ? `结算前置不满足：${res.blockers.join('；')}` : '硬前置全部满足，可结算。');
    } catch (err) {
      show(err instanceof Error ? err.message : '体检失败', true);
    } finally {
      setBusy(false);
    }
  }

  async function runSeasonSettle(acknowledged: boolean) {
    if (busy || !seasonNo) return;
    setBusy(true);
    try {
      const res = await apiPost<SeasonSettleResult>(`/api/admin/seasons/${seasonNo}/settle-season`, { acknowledged });
      show(`赛季 ${seasonNo} 已结算：忠诚奖金 ${res.loyalty} 份、growable 重判 ${res.growable} 人${res.warnings.length > 0 ? `；提示：${res.warnings.join('；')}` : ''}。`);
      setSettleArmed(false);
      setSettleCheck(null);
      reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '结算失败';
      if (msg.includes('待确认提示') && !acknowledged) {
        if (window.confirm(`${msg}

忽略警示并继续结算？`)) await runSeasonSettle(true);
        else setSettleArmed(false);
      } else {
        show(msg, true);
        setSettleArmed(false);
      }
    } finally {
      setBusy(false);
    }
  }

  async function runStageSettle(b: SeasonBinding) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiPost<StageSettleResult>(`/api/admin/season-bindings/${b.id}/stage-settle`, {});
      show(`赛事完结结算完成：${res.items} 笔入账。`);
      loadBindings();
    } catch (err) {
      show(err instanceof Error ? err.message : '完结结算失败', true);
    } finally {
      setBusy(false);
    }
  }

  async function bind() {
    if (busy || !bindArmed || !seasonNo || bindTournament === '') return;
    setBusy(true);
    try {
      const res = await apiPost<BindTournamentResult>(`/api/admin/seasons/${seasonNo}/bind-tournament`, {
        tournamentId: Number(bindTournament),
        competitionType: bindType,
      });
      show(`已把「${res.tournament.name}」绑进 S${seasonNo}，完赛场次会进赛果确认队列。`);
      setBindTournament('');
      setBindArmed(false);
      loadBindings();
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '绑定失败', true);
    } finally {
      setBusy(false);
    }
  }

  async function unbind(b: SeasonBinding) {
    if (busy || !seasonNo || unbindArmedId !== b.id) return;
    setBusy(true);
    try {
      await apiPost<{ ok: boolean }>(`/api/admin/seasons/${seasonNo}/unbind-tournament`, { tournamentId: b.tournamentId });
      show(`已把「${tournamentName(b.tournamentId) ?? `#${b.tournamentId}`}」从 S${seasonNo} 解绑。`);
      setUnbindArmedId(null);
      loadBindings();
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '解绑失败', true);
      setUnbindArmedId(null);
    } finally {
      setBusy(false);
    }
  }

  const SEASON_STATUS: Record<string, string> = { preparing: '备赛期', running: '进行中', settled: '已结算' };
  const win = current?.window ?? null;

  return (
    <section className="card admin-section">
      <h2>赛季与赛事绑定</h2>
      {toastNode}
      <p className="hint">
        结构：赛季是上集，窗口（只管转会准入）和赛事（赛果来源）是并列的下级。一座赛事只进一个赛季，一个赛季可以绑多座赛事；绑定不依赖窗口。
      </p>
      {current && (
        <p className="hint">
          当前赛季：
          {current.season ? (
            <>
              S{current.season.season}（{SEASON_STATUS[current.season.status] ?? current.season.status}）
            </>
          ) : (
            '还没建赛季'
          )}
          ；最新窗口：
          {win ? <>S{win.season}·窗{win.windowSeq}（{win.status === 'open' ? '开放中' : '已关闭'}）</> : '还没开过窗'}。
        </p>
      )}
      <div className="inline-form">
        <label className="field">
          新建赛季（编号）
          <input
            value={newSeason}
            onChange={(e) => {
              setNewSeason(e.target.value);
              setSeasonArmed(false);
            }}
            placeholder="4"
          />
        </label>
        <label className="field">
          可成长年龄上限（规则 4.1.1，可选）
          <input
            value={newAgeCap}
            onChange={(e) => {
              setNewAgeCap(e.target.value);
              setSeasonArmed(false);
            }}
            placeholder="25 / 24 / 23…"
            className="mono"
          />
        </label>
        <button
          className={`btn${seasonArmed ? ' btn-armed' : ''}`}
          type="button"
          disabled={busy || !newSeasonValid || !newAgeCapValid}
          onClick={() => (seasonArmed ? createSeason() : setSeasonArmed(true))}
        >
          {seasonArmed ? '确认建档（再点一次）' : '建档'}
        </button>
        <button className="btn btn-ghost" type="button" disabled={busy || !seasonNo} onClick={() => runSeasonSettleCheck()}>
          结算体检
        </button>
        <button
          className={`btn${settleArmed ? ' btn-armed' : ''}`}
          type="button"
          disabled={busy || !seasonNo}
          onClick={() => (settleArmed ? runSeasonSettle(false) : setSettleArmed(true))}
        >
          {settleArmed ? '确认结算（再点一次）' : '结算赛季'}
        </button>
      </div>
      {settleCheck && (
        <div className="hint">
          {settleCheck.blockers.length > 0 ? (
            <p className="badge red">硬阻断：{settleCheck.blockers.join('；')}</p>
          ) : (
            <p className="badge ok">硬前置全部满足</p>
          )}
          {settleCheck.warnings.length > 0 && <p>⚠️ {settleCheck.warnings.join('；')}</p>}
        </div>
      )}
      <div className="inline-form">
        <label className="field">
          赛季
          <select
            value={selectedSeason}
            onChange={(e) => setSelectedSeason(e.target.value)}
          >
            {seasons.map((s) => (
              <option key={s.season} value={s.season}>
                S{s.season}（{SEASON_STATUS[s.status] ?? s.status}）
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          赛事（比赛系统）
          <select
            value={bindTournament}
            onChange={(e) => {
              setBindTournament(e.target.value);
              setBindArmed(false);
            }}
          >
            <option value="">选赛事…</option>
            {tournaments.map((t) => (
              <option key={t.id} value={t.id}>
                #{t.id} {t.name}（{TOUR_STATUS_LABEL[t.status] ?? t.status}）
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          竞赛类型
          <select
            value={bindType}
            onChange={(e) => {
              setBindType(e.target.value);
              setBindArmed(false);
            }}
          >
            {Object.entries(COMPETITION_TYPE_LABEL).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          className={`btn${bindArmed ? ' btn-armed' : ''}`}
          type="button"
          disabled={busy || !seasonNo || bindTournament === ''}
          onClick={() => (bindArmed ? bind() : setBindArmed(true))}
        >
          {bindArmed ? '确认绑定（再点一次）' : '绑定赛事'}
        </button>
      </div>
      <div>
        {!seasonNo ? (
          <p className="hint">先建档赛季，再往这里绑赛事。</p>
        ) : bindings.length === 0 ? (
          <p className="hint">S{seasonNo} 还没绑任何赛事；不绑赛事就没有赛果可确认。</p>
        ) : (
          bindings.map((b) => (
            <div key={b.id} className="bind-row">
              <span>
                #{b.tournamentId} {tournamentName(b.tournamentId) ?? '（比赛系统里找不到这座赛事）'} ·{' '}
                {COMPETITION_TYPE_LABEL[b.competitionType ?? ''] ?? b.competitionType ?? '类型未标'}
              </span>
              <button
                className={`btn btn-sm${unbindArmedId === b.id ? ' btn-armed' : ''}`}
                type="button"
                disabled={busy}
                onClick={() => (unbindArmedId === b.id ? unbind(b) : setUnbindArmedId(b.id))}
              >
                {unbindArmedId === b.id ? '确认解绑（再点一次）' : '解绑'}
              </button>
              {b.stageSettledAt ? (
                <span className="badge" title="入场/保底/剩余池已一次性发放">
                  已完结结算 {b.stageSettledAt.slice(0, 10)}
                </span>
              ) : (
                <button className="btn btn-sm" type="button" disabled={busy} onClick={() => runStageSettle(b)}>
                  完结结算
                </button>
              )}
            </div>
          ))
        )}
      </div>
      <p className="hint">
        赛季已结算后不能再绑赛事；已经有确认入档赛果的赛事不能解绑。确认赛果时按当时比分定格快照，之后比赛系统改判不影响已入档记录。
      </p>
    </section>
  );
}

function resultScoreLine(r: { homeTeam: string | null; awayTeam: string | null; scoreHome: number | null; scoreAway: number | null }): string {
  return `${r.homeTeam ?? '—'} ${r.scoreHome ?? '-'} : ${r.scoreAway ?? '-'} ${r.awayTeam ?? '—'}`;
}

function ResultsSection() {
  const { show, toastNode } = useToast();
  const queryClient = useQueryClient();
  const [armedId, setArmedId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  // 原失败时静默置空队列，queryFn 里保持一致
  const { data } = useQuery({
    queryKey: ['admin', 'results-queue'],
    queryFn: () => api<ResultsQueue>('/api/admin/results/queue').catch(() => ({ queue: [], confirmed: [] })),
  });

  const reload = () => queryClient.invalidateQueries({ queryKey: ['admin', 'results-queue'] });

  async function confirm(matchId: number) {
    if (armedId !== matchId || busyId !== null) return;
    setBusyId(matchId);
    try {
      const r = await apiPost<ConfirmResultResult>(`/api/admin/results/${matchId}/confirm`, {});
      const unresolvedNote =
        r.xp.unresolved.length > 0
          ? `有 ${r.xp.unresolved.length} 个球员没匹配上（${r.xp.unresolved.join('、')}），请到「成长引擎」补录。`
          : '';
      show(`赛果已确认入档${r.xp.granted > 0 ? `，自动记了 ${r.xp.granted} 条 XP 事件` : ''}。${unresolvedNote}`);
      setArmedId(null);
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '确认失败', true);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card admin-section">
      <h2>赛果确认</h2>
      {toastNode}
      <p className="hint">从比赛系统同步的完赛场次在这里确认；确认只入档赛果，奖金到「手动记账」按模板发。</p>
      {data === undefined ? (
        <p className="muted">读取中…</p>
      ) : data.queue.length === 0 ? (
        <p className="muted">没有待确认的赛果。绑好赛事之后，比完的场次会出现在这里。</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>赛事</th>
                <th>阶段</th>
                <th>对阵与比分</th>
                <th>完赛时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.queue.map((r) => (
                <tr key={r.matchId}>
                  <td>
                    {r.competitionType ? (COMPETITION_TYPE_LABEL[r.competitionType] ?? r.competitionType) : '—'}
                    <span className="muted"> S{r.season}·窗{r.windowSeq}</span>
                  </td>
                  <td>
                    {r.stageName ?? '—'}
                    {r.round !== null && <span className="muted"> 第{r.round}轮</span>}
                  </td>
                  <td className="mono">
                    {resultScoreLine(r)}
                    {r.penHome !== null && r.penAway !== null && <span className="muted">（点球 {r.penHome}:{r.penAway}）</span>}
                    {r.walkoverSide && r.walkoverSide !== '' && <span className="badge">弃权</span>}
                    {r.winnerTeam && <span className="muted">，胜者 {r.winnerTeam}</span>}
                  </td>
                  <td className="mono">{r.finishedAt?.slice(0, 16).replace('T', ' ') ?? '—'}</td>
                  <td>
                    <button
                      className={`btn btn-sm${armedId === r.matchId ? ' btn-armed' : ''}`}
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => (armedId === r.matchId ? confirm(r.matchId) : setArmedId(r.matchId))}
                    >
                      {busyId === r.matchId ? '确认中…' : armedId === r.matchId ? '确认入档（再点一次）' : '确认'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data !== undefined && data.confirmed.length > 0 && (
        <details>
          <summary>最近已确认（{data.confirmed.length}）</summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>赛事</th>
                  <th>对阵与比分</th>
                  <th>确认时间</th>
                </tr>
              </thead>
              <tbody>
                {data.confirmed.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.competitionType ? (COMPETITION_TYPE_LABEL[r.competitionType] ?? r.competitionType) : '—'}
                      <span className="muted"> S{r.season}·窗{r.windowSeq}</span>
                    </td>
                    <td className="mono">
                      {resultScoreLine(r)}
                      {r.winnerTeam && <span className="muted">，胜者 {r.winnerTeam}</span>}
                    </td>
                    <td className="mono">{r.confirmedAt.slice(0, 16).replace('T', ' ')}</td>
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
