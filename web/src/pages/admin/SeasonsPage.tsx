// 管理端 · 赛季页：赛季与赛事绑定（§11，v0.7.1 层级）+ 赛果确认（附录 A〔6〕，确认钩子触发 XP/通知）
// （原 Admin.tsx 两 section，v2.1.0 拆分；commit 3 数据层转 TanStack Query）
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
  type WeatherForecastPreview,
  type WeatherForecastPreviewMatch,
  type WeatherForecastTriggerResult,
} from '../../lib/api.ts';
import { SEASON_CURRENT_KEY, fetchSeasonCurrent, fetchWeatherForecast, weatherForecastKey } from '../../lib/adminQueries.ts';
import { useToast } from '../../lib/toast.tsx';
import ConfirmButton from '../../components/ConfirmButton.tsx';
import { useTimeFmt } from '../../lib/datetime.ts';

export default function SeasonsPage() {
  return (
    <div className="admin-page">
      <SeasonsSection />
      <WeatherForecastSection />
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
  const [settleCheck, setSettleCheck] = useState<SettleCheckResult | null>(null);
  const [bindTournament, setBindTournament] = useState('');
  const [bindType, setBindType] = useState('league_premier');
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
    if (busy || !newSeasonValid) return;
    setBusy(true);
    try {
      const cap = newAgeCap.trim() === '' ? null : Number(newAgeCap);
      const res = await apiPost<{ ok: boolean; growable: number }>('/api/admin/seasons', { season: Number(newSeason), ageCap: cap });
      show(`赛季 ${Number(newSeason)} 已建档，进入备赛期${cap !== null ? `（可成长年龄上限 ${cap}，重判 growable ${res.growable} 人）` : ''}。`);
      setNewSeason('');
      setNewAgeCap('');
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
      show(`赛季 ${seasonNo} 已结算：growable 重判 ${res.growable} 人${res.warnings.length > 0 ? `；提示：${res.warnings.join('；')}` : ''}。（忠诚奖金自v3.0.0 起在赛季中期末关窗时发。）`);
      setSettleCheck(null);
      reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '结算失败';
      if (msg.includes('待确认提示') && !acknowledged) {
        if (window.confirm(`${msg}

忽略警示并继续结算？`)) await runSeasonSettle(true);
      } else {
        show(msg, true);
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
    if (busy || !seasonNo || bindTournament === '') return;
    setBusy(true);
    try {
      const res = await apiPost<BindTournamentResult>(`/api/admin/seasons/${seasonNo}/bind-tournament`, {
        tournamentId: Number(bindTournament),
        competitionType: bindType,
      });
      show(`已把「${res.tournament.name}」绑进 S${seasonNo}，完赛场次会进赛果确认队列。`);
      setBindTournament('');
      loadBindings();
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '绑定失败', true);
    } finally {
      setBusy(false);
    }
  }

  async function unbind(b: SeasonBinding) {
    if (busy || !seasonNo) return;
    setBusy(true);
    try {
      await apiPost<{ ok: boolean }>(`/api/admin/seasons/${seasonNo}/unbind-tournament`, { tournamentId: b.tournamentId });
      show(`已把「${tournamentName(b.tournamentId) ?? `#${b.tournamentId}`}」从 S${seasonNo} 解绑。`);
      loadBindings();
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '解绑失败', true);
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
            }}
            placeholder="25 / 24 / 23…"
            className="mono"
          />
        </label>
        <ConfirmButton
          label="建档"
          confirmLabel="确认建档（再点一次）"
          busy={busy}
          disabled={!newSeasonValid || !newAgeCapValid}
          disarmKey={`${newSeason}|${newAgeCap}`}
          onConfirm={createSeason}
        />
        <button className="btn btn-ghost" type="button" disabled={busy || !seasonNo} onClick={() => runSeasonSettleCheck()}>
          结算体检
        </button>
        <ConfirmButton
          label="结算赛季"
          confirmLabel="确认结算（再点一次）"
          busy={busy}
          disabled={!seasonNo}
          disarmKey={String(seasonNo)}
          onConfirm={() => runSeasonSettle(false)}
        />
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
            }}
          >
            {Object.entries(COMPETITION_TYPE_LABEL).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <ConfirmButton
          label="绑定赛事"
          confirmLabel="确认绑定（再点一次）"
          busy={busy}
          disabled={!seasonNo || bindTournament === ''}
          disarmKey={`${seasonNo}|${bindTournament}|${bindType}`}
          onConfirm={bind}
        />
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
              <ConfirmButton
                className="btn-sm"
                label="解绑"
                confirmLabel="确认解绑（再点一次）"
                busy={busy}
                disarmKey={seasonNo}
                onConfirm={() => unbind(b)}
              />
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
  const { dateTime } = useTimeFmt();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<number | null>(null);

  // 原失败时静默置空队列，queryFn 里保持一致
  const { data } = useQuery({
    queryKey: ['admin', 'results-queue'],
    queryFn: () => api<ResultsQueue>('/api/admin/results/queue').catch(() => ({ queue: [], confirmed: [] })),
  });

  const reload = () => queryClient.invalidateQueries({ queryKey: ['admin', 'results-queue'] });

  async function confirm(matchId: number) {
    if (busyId !== null) return;
    setBusyId(matchId);
    try {
      const r = await apiPost<ConfirmResultResult>(`/api/admin/results/${matchId}/confirm`, {});
      const unresolvedNote =
        r.xp.unresolved.length > 0
          ? `有 ${r.xp.unresolved.length} 个球员没匹配上（${r.xp.unresolved.join('、')}），请到「成长引擎」补录。`
          : '';
      show(`赛果已确认入档${r.xp.granted > 0 ? `，自动记了 ${r.xp.granted} 条 XP 事件` : ''}。${unresolvedNote}`);
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '确认失败', true);
    } finally {
      setBusyId(null);
    }
  }

  // 钩子重放（v2.7.0）：修完数据（补录球员等）后从这里补账，三钩子皆幂等
  async function replay(matchId: number) {
    if (busyId !== null) return;
    setBusyId(matchId);
    try {
      await apiPost<{ ok: true }>(`/api/admin/results/${matchId}/replay-hooks`, {});
      show(`已重放 #${matchId} 的确认钩子；标记已按最新结果重算。`);
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '重放失败', true);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card admin-section">
      <h2>赛果确认</h2>
      {toastNode}
      <p className="hint">
        从比赛系统同步的完赛场次在这里确认；cron 会每 5 分钟自动确认干净场次（钩子异常或球员没解析到的标「待复核」），确认只入档赛果，奖金到「手动记账」按模板发。
      </p>
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
                  <td className="mono">{dateTime(r.finishedAt)}</td>
                  <td>
                    <ConfirmButton
                      className="btn-sm"
                      label="确认"
                      confirmLabel="确认入档（再点一次）"
                      busyLabel="确认中…"
                      busy={busyId === r.matchId}
                      disabled={busyId !== null}
                      onConfirm={() => confirm(r.matchId)}
                    />
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
                  <th>复核</th>
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
                    <td className="mono">{dateTime(r.confirmedAt)}</td>
                    <td>
                      {r.needsReview ? (
                        <span className="badge" title={r.reviewNote ?? undefined}>
                          待复核
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                      {r.needsReview && (
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          disabled={busyId !== null}
                          style={{ marginLeft: 6 }}
                          title={r.reviewNote ?? '重放确认钩子（XP/奖金/上座，皆幂等）'}
                          onClick={() => void replay(r.matchId)}
                        >
                          重放钩子
                        </button>
                      )}
                    </td>
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

// ---- 场次天气预报（v6.15.0）：按 (赛事, 轮次) 预览 / 生成该轮主场比赛的预报天气 ----

/** 预报行四态：已确认（有实际天气）> 已预报 > 未预报；有跳过原因的算跳过态。
 *  判定序 skipped 在前与后端分类序（confirmed > existing > skipped）不同但互不冲突：
 *  confirmed 需 match_attendance 行，有该行必有球场 ⇒ skipped 与 confirmed 生产上互斥。 */
type WeatherRowState = 'confirmed' | 'forecast' | 'pending' | 'skipped';

function weatherRowState(m: WeatherForecastPreviewMatch): WeatherRowState {
  if (m.skippedReason !== null) return 'skipped';
  if (m.confirmedWeather !== null) return 'confirmed';
  if (m.weather !== null) return 'forecast';
  return 'pending';
}

const WEATHER_STATE: Record<WeatherRowState, { label: string; className: string }> = {
  confirmed: { label: '已确认', className: 'badge green' },
  forecast: { label: '已预报', className: 'badge sky' },
  pending: { label: '未预报', className: 'badge gray' },
  skipped: { label: '跳过', className: 'badge red' },
};

/** 对阵文案；主队无平台映射（CPU 队）或客队未定时用 — 占位（与赛果行的口径一致） */
function forecastPair(homeClubName: string | null, awayTeamName: string | null): string {
  return `${homeClubName ?? '—'} vs ${awayTeamName ?? '—'}`;
}

/** 天气系数是区间内的随机浮点，展示收三位小数避免长尾 */
function fmtCoef(coef: number): string {
  return String(Math.round(coef * 1000) / 1000);
}

function WeatherPreviewTable({ preview }: { preview: WeatherForecastPreview }) {
  if (preview.matches.length === 0) {
    return <p className="muted">该轮没有可展示的主场比赛（未排赛程，或全是无平台映射 / 无球场行的场次）。</p>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>主队 vs 客队</th>
            <th>状态</th>
            <th>天气</th>
            <th>上座</th>
          </tr>
        </thead>
        <tbody>
          {preview.matches.map((m) => {
            const state = weatherRowState(m);
            return (
              <tr key={m.matchId}>
                <td>
                  {forecastPair(m.homeClubName, m.awayTeamName)}
                  {m.stageName && <span className="muted"> · {m.stageName}</span>}
                </td>
                <td>
                  <span className={WEATHER_STATE[state].className}>{WEATHER_STATE[state].label}</span>
                  {state === 'skipped' && m.skippedReason && <span className="muted"> {m.skippedReason}</span>}
                  {m.finished && <span className="muted"> 已完赛</span>}
                </td>
                <td className="mono">
                  {state === 'confirmed' ? (
                    <>
                      {m.confirmedWeather} <span className="badge green">实际</span>
                    </>
                  ) : state === 'forecast' && m.weather !== null && m.wxCoef !== null ? (
                    <>
                      {m.weather}
                      <span className="muted"> ×{fmtCoef(m.wxCoef)}</span>
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="mono">{m.attendance ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WeatherForecastSection() {
  const { show, toastNode } = useToast();
  const queryClient = useQueryClient();
  const [tournamentId, setTournamentId] = useState('');
  const [round, setRound] = useState('0');
  const [busy, setBusy] = useState(false);
  // 预览跟着「点过查预览 / 生成预报」的参数走：边改输入边打接口反而费解，所见即上次所选
  const [previewParams, setPreviewParams] = useState<{ tournamentId: number; round: number } | null>(null);
  const [result, setResult] = useState<WeatherForecastTriggerResult | null>(null);

  const { data: tournaments = [] } = useQuery({
    queryKey: ['admin', 'tournaments'],
    queryFn: () => api<{ tournaments: TournamentRow[] }>('/api/admin/tournaments').then((d) => d.tournaments).catch(() => [] as TournamentRow[]),
  });

  const tournamentNo = Number(tournamentId);
  const roundNo = Number(round);
  // 空串会被 Number() 转成 0，而 0 是合法轮次，所以轮次要单独拦空串
  const paramsValid = Number.isInteger(tournamentNo) && tournamentNo > 0 && round.trim() !== '' && Number.isInteger(roundNo) && roundNo >= 0;

  const { data: preview, isFetching, error: previewError } = useQuery({
    queryKey: weatherForecastKey(previewParams?.tournamentId ?? 0, previewParams?.round ?? 0),
    queryFn: () => {
      if (!previewParams) throw new Error('还没有查询参数');
      return fetchWeatherForecast(previewParams.tournamentId, previewParams.round);
    },
    enabled: previewParams !== null,
  });

  function appliedParams(): { tournamentId: number; round: number } | null {
    return paramsValid ? { tournamentId: tournamentNo, round: roundNo } : null;
  }

  function runPreview() {
    const p = appliedParams();
    if (!p) return;
    setPreviewParams(p);
    setResult(null); // 换参数重查时清掉旧轮次的触发横幅，避免「输入第 7 轮、横幅还是第 5 轮结果」
    // 同参数再点一次也要重新拉（key 没变，靠 invalidate 触发）
    queryClient.invalidateQueries({ queryKey: weatherForecastKey(p.tournamentId, p.round) });
  }

  async function runForecast() {
    const p = appliedParams();
    if (!p || busy) return;
    setBusy(true);
    try {
      const res = await apiPost<WeatherForecastTriggerResult>('/api/admin/weather/forecast', {
        tournamentId: p.tournamentId,
        round: p.round,
      });
      setResult(res);
      setPreviewParams(p); // 触发后预览跟着刷新成最新状态
      show(`#${p.tournamentId} 第 ${p.round} 轮预报完成：新预报 ${res.forecast.length} 场、已存在 ${res.existing.length} 场。`);
      queryClient.invalidateQueries({ queryKey: weatherForecastKey(p.tournamentId, p.round) });
    } catch (err) {
      // 409「赛事还没绑定到赛季」等后端 message 原样展示
      show(err instanceof Error ? err.message : '预报失败', true);
    } finally {
      setBusy(false);
    }
  }

  // 触发结果四段：新预报 / 已存在 / 已确认跳过 / 跳过
  const groups = result
    ? [
        {
          title: `新预报 ${result.forecast.length} 场`,
          items: result.forecast.map((m) => ({ key: `f-${m.matchId}`, text: `${forecastPair(m.homeClubName, m.awayTeamName)} · ${m.weather}（系数 ${fmtCoef(m.wxCoef)}）` })),
        },
        {
          title: `已存在 ${result.existing.length} 场（保留原预报）`,
          items: result.existing.map((m) => ({ key: `e-${m.matchId}`, text: `${forecastPair(m.homeClubName, m.awayTeamName)} · ${m.weather}（系数 ${fmtCoef(m.wxCoef)}）` })),
        },
        {
          title: `已确认跳过 ${result.confirmed.length} 场`,
          items: result.confirmed.map((m) => ({ key: `c-${m.matchId}`, text: `${forecastPair(m.homeClubName, m.awayTeamName)} · 实际 ${m.weather ?? '—'}` })),
        },
        {
          title: `跳过 ${result.skipped.length} 场`,
          items: result.skipped.map((m) => ({ key: `s-${m.matchId}`, text: `${forecastPair(m.homeClubName, m.awayTeamName)} · ${m.reason}` })),
        },
      ]
    : [];

  return (
    <section className="card admin-section">
      <h2>天气预报</h2>
      {toastNode}
      <p className="hint">
        按「赛事 + 轮次」给该轮主场比赛提前抽定天气与系数；赛果确认时直接取用预报值（不再消费随机数），已确认的场次会跳过，重复触发保留原预报。
      </p>
      <div className="inline-form">
        <label className="field">
          赛事（比赛系统）
          <select
            value={tournamentId}
            onChange={(e) => {
              setTournamentId(e.target.value);
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
          轮次
          <input
            value={round}
            onChange={(e) => {
              setRound(e.target.value);
            }}
            placeholder="0"
            className="mono"
          />
        </label>
        <button className="btn" type="button" disabled={!paramsValid || isFetching} onClick={runPreview}>
          {isFetching ? '查询中…' : '查预览'}
        </button>
        <button className="btn btn-ghost" type="button" disabled={!paramsValid || busy} onClick={() => void runForecast()}>
          {busy ? '预报中…' : '生成预报'}
        </button>
      </div>

      {previewParams !== null && (
        <>
          <p className="hint">
            预览：#{previewParams.tournamentId} 第 {previewParams.round} 轮
          </p>
          {previewError ? (
            <p className="badge red">{previewError instanceof Error ? previewError.message : '预览失败'}</p>
          ) : preview === undefined ? (
            <p className="muted">读取中…</p>
          ) : (
            <WeatherPreviewTable preview={preview} />
          )}
        </>
      )}

      {result && (
        <div className="banner info">
          <b>
            #{result.tournamentId} 第 {result.round} 轮：新预报 {result.forecast.length} 场 · 已存在 {result.existing.length} 场 · 已确认跳过{' '}
            {result.confirmed.length} 场 · 跳过 {result.skipped.length} 场
          </b>
          {groups.map((g) => (
            <div key={g.title}>
              <p>
                {g.title}
                {g.items.length === 0 && <span className="muted">（无）</span>}
              </p>
              {g.items.length > 0 && (
                <ul>
                  {g.items.map((it) => (
                    <li key={it.key} className="mono">
                      {it.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="hint">
        赛事要先绑进赛季才能预报（没绑会直接报「赛事还没绑定到赛季」）；确认赛果时按「事件预置 &gt; 场次预报 &gt; 现掷」的顺序取天气。
      </p>
    </section>
  );
}
