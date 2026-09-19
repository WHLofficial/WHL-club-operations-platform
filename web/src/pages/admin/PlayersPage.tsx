// 管理端 · 球员页：注册快照与准入体检 + 球员批量维护（增量 10）+ 成长引擎（§10）
// （原 Admin.tsx 三 section，增量 15 拆分；commit 3 数据层转 TanStack Query）
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiPost, MANUAL_GROWTH_TYPES, type AdminRegistrations, type ComplianceReport, type GrowthPeriodsResponse, type GrowthSettlementResult } from '../../lib/api.ts';
import { SEASON_CURRENT_KEY, fetchSeasonCurrent } from '../../lib/adminQueries.ts';
import { LEAGUE_TIER_LABEL } from '../../lib/ref.ts';
import { useToast } from '../../lib/toast.tsx';

export default function PlayersPage() {
  return (
    <div className="admin-page">
      <RegistrationsSection />
      <PlayerBatchSection />
      <GrowthSection />
    </div>
  );
}

/* ---------- 注册快照与准入体检 ---------- */

function RegistrationsSection() {
  const { show, toastNode } = useToast();
  const [seasonInput, setSeasonInput] = useState('');
  const [activeSeason, setActiveSeason] = useState<string | null>(null);
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [checkBusy, setCheckBusy] = useState(false);

  // 提交查询 = 切 query key，快照随之自动重拉；赛季筛选进 key，留空=最新
  const { data: snapshot, isFetching: busy, error: snapshotError } = useQuery({
    queryKey: ['admin', 'registrations', activeSeason ?? ''],
    queryFn: () => {
      const q = activeSeason ? `?season=${encodeURIComponent(activeSeason)}` : '';
      return api<AdminRegistrations>(`/api/admin/registrations${q}`);
    },
  });

  useEffect(() => {
    if (snapshotError) show(snapshotError instanceof Error ? snapshotError.message : '注册名单加载失败', true);
  }, [snapshotError, show]);

  // 快照刷新后清上一份资格检查报告（原 loadSnapshot 成功路径里的 setReport(null)）
  useEffect(() => {
    setReport(null);
  }, [snapshot]);

  async function runCheck(season?: string) {
    setCheckBusy(true);
    try {
      setReport(await api<ComplianceReport>(`/api/admin/compliance${season ? `?season=${encodeURIComponent(season)}` : ''}`));
    } catch (err) {
      show(err instanceof Error ? err.message : '资格检查失败', true);
    } finally {
      setCheckBusy(false);
    }
  }

  const season = seasonInput.trim();

  return (
    <section className="card admin-section">
      <h2>注册与资格检查</h2>
      {toastNode}
      <p className="hint">
        注册名单按赛季存档，供资格检查对账。资格检查用当前属性对名单重跑合规引擎——注册后属性或合同漂移的违规会在赛前被抓出来。
        失败项触发强制拍卖的流程在转会增量落地，现在只报告。
      </p>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          setActiveSeason(season || null);
        }}
      >
        <label className="field">
          赛季
          <input
            type="number"
            min={1}
            value={seasonInput}
            onChange={(e) => setSeasonInput(e.target.value)}
            placeholder="留空=最新"
          />
        </label>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? '读取中…' : '查名单'}
        </button>
        <button className="btn" type="button" disabled={checkBusy} onClick={() => runCheck(season || undefined)}>
          {checkBusy ? '检查中…' : '跑一遍资格检查'}
        </button>
      </form>

      {snapshot === undefined ? null : snapshot.season === null ? (
        <div className="empty-state">
          <p className="muted">还没有任何注册名单。等教练在球队中心提交名单。</p>
        </div>
      ) : (
        <>
          <h3>
            第 {snapshot.season} 赛季注册名单（{snapshot.clubs.length} 支俱乐部）
          </h3>
          {snapshot.clubs.length === 0 ? (
            <div className="empty-state">
              <p className="muted">这个赛季还没有俱乐部提交注册。</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>俱乐部</th>
                    <th>级别</th>
                    <th className="num">一线队</th>
                    <th className="num">训练营</th>
                    <th className="num">工资</th>
                    <th>注册明细</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.clubs.map((club) => (
                    <tr key={club.clubId}>
                      <td>
                        {club.clubName} <span className="muted">#{club.clubId}</span>
                      </td>
                      <td>{club.leagueTier ? (LEAGUE_TIER_LABEL[club.leagueTier] ?? club.leagueTier) : <span className="muted">未定级</span>}</td>
                      <td className="num mono">{club.firstTeam}</td>
                      <td className="num mono">{club.trainee}</td>
                      <td className="num mono">{club.wageTotal.toFixed(2)} m</td>
                      <td>
                        <details>
                          <summary className="muted">{club.players.length} 人</summary>
                          <div className="detail-list">
                            {club.players.map((p) => (
                              <span key={p.playerId} className={p.squad === 'trainee' ? 'trainee-name' : undefined}>
                                {p.name}
                                {p.squad === 'trainee' ? '（训）' : ''}
                              </span>
                            ))}
                          </div>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {report && (
        <>
          <h3>
            资格检查报告{report.season !== null ? `（第 ${report.season} 赛季）` : ''}
          </h3>
          {report.clubs.length === 0 ? (
            <div className="empty-state">
              <p className="muted">没有可检查的俱乐部。</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>俱乐部</th>
                    <th>结果</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {report.clubs.map((club) => (
                    <tr key={club.clubId}>
                      <td>{club.clubName}</td>
                      <td>
                        <span className={`badge ${club.pass ? 'gold' : 'red'}`}>{club.pass ? '通过' : '未过'}</span>
                      </td>
                      <td>
                        {club.pass ? (
                          <span className="muted">
                            一线队 {club.stats?.firstTeam} 人 · 训练营 {club.stats?.trainee} 人 · 工资{' '}
                            {(club.stats?.wageTotal ?? 0).toFixed(2)} m
                          </span>
                        ) : (
                          <ul className="issue-list">
                            {club.issues.map((issue, i) => (
                              <li key={`${issue.rule}-${i}`}>{issue.message}</li>
                            ))}
                          </ul>
                        )}
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
  );
}

/* ---------- 球员批量维护（增量 10） ---------- */

// 每行一名球员：`id key=value ...`，key 与单改接口一致；marketValue/ca/baseCa/pa/prestige 可填 null
const PLAYER_BATCH_KEYS = ['marketValue', 'status', 'growthTier', 'isFutureStar', 'growable', 'prestige', 'badgesSilver', 'badgesGold', 'ca', 'baseCa', 'pa'];

interface PlayerBatchRow {
  id: number;
  fields: Record<string, unknown>;
  error?: string;
}

function parsePlayerBatchText(text: string): PlayerBatchRow[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line.split(/\s+/);
      const id = Number(parts[0]);
      if (!Number.isInteger(id) || id <= 0) return { id: NaN, fields: {}, error: 'ID 不对' };
      const fields: Record<string, unknown> = {};
      let error: string | undefined;
      for (const part of parts.slice(1)) {
        const eq = part.indexOf('=');
        const key = eq > 0 ? part.slice(0, eq) : part;
        const raw = eq > 0 ? part.slice(eq + 1) : '';
        if (!PLAYER_BATCH_KEYS.includes(key)) {
          error = `不支持的字段 ${key}`;
          break;
        }
        if (raw === '' && eq < 0) {
          error = `${key} 缺值`;
          break;
        }
        if (raw === 'null') {
          fields[key] = null;
        } else if (key === 'status') {
          fields[key] = raw;
        } else {
          const v = Number(raw);
          if (raw === '' || !Number.isFinite(v)) {
            error = `${key} 值不对`;
            break;
          }
          fields[key] = v;
        }
      }
      return { id, fields, error };
    });
}

function PlayerBatchSection() {
  const { show, toastNode } = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = parsePlayerBatchText(text);
  const badCount = rows.filter((r) => r.error).length;
  const goodCount = rows.length - badCount;

  async function runBatch() {
    const good = parsePlayerBatchText(text).filter((r) => !r.error);
    if (busy || good.length === 0) return;
    setBusy(true);
    try {
      let done = 0;
      for (let i = 0; i < good.length; i += 200) {
        const slice = good.slice(i, i + 200);
        const res = await apiPost<{ ok: boolean; updated: number }>('/api/admin/players/batch', {
          items: slice.map((r) => ({ id: r.id, ...r.fields })),
        });
        done += res.updated;
      }
      show(`批量维护完成：${done} 名球员已更新（审计留痕）。`);
      setText('');
    } catch (err) {
      show(err instanceof Error ? err.message : '批量维护失败', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card admin-section">
      <h2>球员批量维护</h2>
      {toastNode}
      <p className="hint">
        每行一名球员：<code className="mono">球员ID 字段=值 字段=值…</code>。字段与单改接口一致（marketValue / status /
        growthTier / isFutureStar / growable / prestige / badgesSilver / badgesGold / ca / baseCa / pa）；
        marketValue、ca、baseCa、pa、prestige 可填 null 表示清空。任一行有错则整批不落库，一次最多 200 行。
      </p>
      <textarea
        className="mono"
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'1 marketValue=30.5 ca=82\n2 status=trainee badgesGold=1\n3 ca=null'}
      />
      <div className="row-gap" style={{ marginTop: '0.5rem' }}>
        <span className="hint">
          解析 {goodCount} 行可提交{badCount > 0 ? `，${badCount} 行有错（不拦截提交，服务端整批校验）` : ''}
        </span>
        <button className="primary" disabled={busy || goodCount === 0} onClick={runBatch}>
          {busy ? '提交中…' : `批量更新 ${goodCount} 名球员`}
        </button>
      </div>
    </section>
  );
}

/* ---------- 成长引擎管理（§10）：XP 补录 / 赛季结算 / 档位核定 ---------- */

function GrowthSection() {
  const { show, toastNode } = useToast();
  const queryClient = useQueryClient();
  const [playerId, setPlayerId] = useState('');
  const [eventType, setEventType] = useState(MANUAL_GROWTH_TYPES[1]!.type);
  const [value, setValue] = useState('');
  const [matchRef, setMatchRef] = useState('');
  const [eventArmed, setEventArmed] = useState(false);
  const [settleSeason, setSettleSeason] = useState('');
  const [half, setHalf] = useState(false);
  const [runArmed, setRunArmed] = useState(false);
  const [summary, setSummary] = useState<GrowthSettlementResult | null>(null);
  const [tierPlayerId, setTierPlayerId] = useState('');
  const [tier, setTier] = useState('1');
  const [tierArmed, setTierArmed] = useState(false);
  const [periodNote, setPeriodNote] = useState('');
  const [periodArmed, setPeriodArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: periods, error: periodsError } = useQuery({
    queryKey: ['admin', 'growth-periods'],
    queryFn: () => api<GrowthPeriodsResponse>('/api/admin/growth/periods'),
  });

  useEffect(() => {
    if (periodsError) show(periodsError instanceof Error ? periodsError.message : '成长期加载失败', true);
  }, [periodsError, show]);

  const reloadPeriods = () => queryClient.invalidateQueries({ queryKey: ['admin', 'growth-periods'] });

  // 与赛季页共享同一份 /api/seasons/current（key 去重），只用来预填结算赛季
  const { data: current } = useQuery({ queryKey: SEASON_CURRENT_KEY, queryFn: fetchSeasonCurrent });

  useEffect(() => {
    if (current?.season) setSettleSeason(String(current.season.season));
  }, [current]);

  const pid = Number(playerId);
  const eventValid = Number.isInteger(pid) && pid > 0;
  const selectedType = MANUAL_GROWTH_TYPES.find((t) => t.type === eventType);
  const settleValid = Number.isInteger(Number(settleSeason)) && Number(settleSeason) > 0;
  const tierValid = Number.isInteger(Number(tierPlayerId)) && Number(tierPlayerId) > 0;

  function resetArm() {
    setEventArmed(false);
    setRunArmed(false);
    setTierArmed(false);
    setPeriodArmed(false);
  }

  async function declarePeriod() {
    if (busy || !periodArmed) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {};
      if (periodNote.trim() !== '') body.note = periodNote.trim();
      const r = await apiPost<{ ok: boolean; id: number; startEventId: number }>('/api/admin/growth/periods', body);
      show(`新成长期已宣告（第 ${r.id} 期）：里程碑从这个时点之后的进+攻重新累计。`);
      setPeriodNote('');
      setPeriodArmed(false);
      reloadPeriods();
    } catch (err) {
      show(err instanceof Error ? err.message : '宣告失败', true);
      resetArm();
    } finally {
      setBusy(false);
    }
  }

  async function recordEvent() {
    if (busy || !eventArmed || !eventValid) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { playerId: pid, eventType };
      if (selectedType?.needsValue) body.value = Number(value);
      if (matchRef.trim() !== '') body.matchRef = matchRef.trim();
      const r = await apiPost<{ ok: boolean; xp: number; duplicate: boolean }>('/api/admin/growth/events', body);
      show(
        r.duplicate
          ? '这笔之前记过（同一球员同一场次同一事件），没有重复入账。'
          : `已补录，+${r.xp} XP。`,
      );
      setEventArmed(false);
      setValue('');
      setMatchRef('');
    } catch (err) {
      show(err instanceof Error ? err.message : '补录失败', true);
      resetArm();
    } finally {
      setBusy(false);
    }
  }

  async function runSettlement() {
    if (busy || !runArmed || !settleValid) return;
    setBusy(true);
    try {
      const r = await apiPost<GrowthSettlementResult>('/api/admin/growth/settlement/run', {
        season: Number(settleSeason),
        half,
      });
      setSummary(r);
      show(
        `结算完成（成长期 ${r.growthPeriodId === 0 ? '未宣告' : `第 ${r.growthPeriodId} 期`}）：训练营 ${r.traineeCount} 人 ×${r.traineeXp} XP，中国计划 ${r.chinaCount} 人，里程碑补发 ${r.milestonesGranted} 条。`,
      );
      setRunArmed(false);
    } catch (err) {
      show(err instanceof Error ? err.message : '结算失败', true);
      resetArm();
    } finally {
      setBusy(false);
    }
  }

  async function confirmTier() {
    if (busy || !tierArmed || !tierValid) return;
    setBusy(true);
    try {
      await apiPost<{ ok: boolean }>(`/api/admin/growth/${Number(tierPlayerId)}/tier`, { tier: Number(tier) });
      show(`档位已核定：球员 #${Number(tierPlayerId)} → 档 ${tier}。`);
      setTierArmed(false);
    } catch (err) {
      show(err instanceof Error ? err.message : '核定失败', true);
      resetArm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card admin-section">
      <h2>成长引擎（XP / 升级 / 档位）</h2>
      {toastNode}

      <h3>补录 XP 事件</h3>
      <p className="hint">比赛系统没有的数据（评分、扑救、夺回球权）或漏记的兜底；XP 按规则表自动折算。赛果确认时已自动入账的不用补。</p>
      <div className="inline-form">
        <label className="field">
          球员 ID
          <input
            value={playerId}
            onChange={(e) => {
              setPlayerId(e.target.value);
              resetArm();
            }}
            placeholder="如 12"
          />
        </label>
        <label className="field">
          事件类型
          <select
            value={eventType}
            onChange={(e) => {
              setEventType(e.target.value);
              resetArm();
            }}
          >
            {MANUAL_GROWTH_TYPES.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {selectedType?.needsValue && (
          <label className="field">
            数值
            <input
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                resetArm();
              }}
              placeholder={eventType === 'rating' ? '8.5' : '次数'}
            />
          </label>
        )}
        <label className="field">
          关联场次（可选）
          <input
            value={matchRef}
            onChange={(e) => {
              setMatchRef(e.target.value);
              resetArm();
            }}
            placeholder="比赛 ID，同场同事件靠它去重"
          />
        </label>
        <button
          className={`btn${eventArmed ? ' btn-armed' : ''}`}
          type="button"
          disabled={busy || !eventValid || (selectedType?.needsValue === true && value.trim() === '')}
          onClick={() => (eventArmed ? recordEvent() : setEventArmed(true))}
        >
          {eventArmed ? '确认补录（再点一次）' : '补录'}
        </button>
      </div>
      {selectedType && <p className="hint">折算口径：{selectedType.hint}。</p>}

      <h3>成长期</h3>
      <p className="hint">
        一个赛季可以有多个成长期（通常夹在两个窗口之间 = 半赛季，也可能临时改变，所以不绑窗口）。里程碑（进+攻 5/10/15/20…）
        只累计当前成长期内的进球与助攻；球员被解约时还会单独划断一条线。宣告只是画一条线，不改任何球员数据，可以随时宣告。
      </p>
      <p className="hint">
        当前成长期：
        {periods?.current ? (
          <>
            <strong className="mono"> 第 {periods.current.id} 期</strong>
            <span className="muted">
              （{periods.current.source === 'window_open' ? '开窗自动宣告' : '手动宣告'}
              {periods.current.declaredAt ? ` · ${periods.current.declaredAt.slice(0, 10)}` : ''}
              {periods.current.note ? ` · ${periods.current.note}` : ''}）
            </span>
          </>
        ) : (
          <span className="muted"> 还没宣告过（里程碑按全生涯累计；宣告第一期后只算当期）</span>
        )}
      </p>
      <div className="inline-form">
        <label className="field">
          备注（可选）
          <input
            value={periodNote}
            onChange={(e) => {
              setPeriodNote(e.target.value);
              resetArm();
            }}
            placeholder="如：半赛季换血期"
          />
        </label>
        <button
          className={`btn${periodArmed ? ' btn-armed' : ''}`}
          type="button"
          disabled={busy}
          onClick={() => (periodArmed ? declarePeriod() : setPeriodArmed(true))}
        >
          {periodArmed ? '确认宣告（再点一次）' : '宣告新成长期'}
        </button>
      </div>
      {periods && periods.periods.length > 1 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>期号</th>
                <th>赛季</th>
                <th>来源</th>
                <th>备注</th>
                <th>宣告时间</th>
              </tr>
            </thead>
            <tbody>
              {periods.periods.map((p) => (
                <tr key={p.id}>
                  <td className="num mono">#{p.id}</td>
                  <td className="mono">{p.season ?? '—'}</td>
                  <td>{p.source === 'window_open' ? '开窗自动' : '手动'}</td>
                  <td>{p.note ?? <span className="muted">—</span>}</td>
                  <td className="mono muted">{p.declaredAt?.slice(0, 16).replace('T', ' ') ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>赛季结算</h3>
      <p className="hint">按 §10.1 结算：训练营球员固定经验、中国计划加成、进+攻里程碑补发（只算当前成长期内）；重放安全，重复运行不会重复入账。升级在球员档案页选方案。</p>
      <div className="inline-form">
        <label className="field">
          赛季编号
          <input
            value={settleSeason}
            onChange={(e) => {
              setSettleSeason(e.target.value);
              resetArm();
            }}
            placeholder="4"
          />
        </label>
        <label className="field field-check">
          <input
            type="checkbox"
            checked={half}
            onChange={(e) => {
              setHalf(e.target.checked);
              resetArm();
            }}
          />
          半赛季训练营（15 XP，整赛季 40）
        </label>
        <button
          className={`btn${runArmed ? ' btn-armed' : ''}`}
          type="button"
          disabled={busy || !settleValid}
          onClick={() => (runArmed ? runSettlement() : setRunArmed(true))}
        >
          {runArmed ? '确认结算（再点一次）' : '运行结算'}
        </button>
      </div>
      {summary && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>球员</th>
                <th>成长档位</th>
                <th>待升级次数</th>
              </tr>
            </thead>
            <tbody>
              {summary.pendingLevelUps.length === 0 ? (
                <tr>
                  <td colSpan={3} className="muted">
                    没有待升级的球员。
                  </td>
                </tr>
              ) : (
                summary.pendingLevelUps.map((p) => (
                  <tr key={p.playerId}>
                    <td>
                      {p.name} <span className="muted">#{p.playerId}</span>
                    </td>
                    <td>档 {p.growthTier}</td>
                    <td className="mono">{p.pending}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <h3>档位核定（§10.3）</h3>
      <p className="hint">条件叠加（效力 +1 / 国籍 +1 / 中国籍 +1 / 未来之星 +2 / ≤18 岁 +1）由管理组按现实资料判断，这里只落核定结果。</p>
      <div className="inline-form">
        <label className="field">
          球员 ID
          <input
            value={tierPlayerId}
            onChange={(e) => {
              setTierPlayerId(e.target.value);
              resetArm();
            }}
            placeholder="如 10"
          />
        </label>
        <label className="field">
          核定档位
          <select
            value={tier}
            onChange={(e) => {
              setTier(e.target.value);
              resetArm();
            }}
          >
            {[1, 2, 3, 4, 5].map((t) => (
              <option key={t} value={String(t)}>
                档 {t}
              </option>
            ))}
          </select>
        </label>
        <button
          className={`btn${tierArmed ? ' btn-armed' : ''}`}
          type="button"
          disabled={busy || !tierValid}
          onClick={() => (tierArmed ? confirmTier() : setTierArmed(true))}
        >
          {tierArmed ? '确认核定（再点一次）' : '核定'}
        </button>
      </div>
    </section>
  );
}
