// 海捞 /market/free（增量 16 拆页）：海捞自由球员签入（规则 4.4.4）+ 激活别队训练营球员（规则 4.4.2）。
// 原 Market.tsx 的 FreeAgentSection 与 ActivateSection 原样搬迁；需登录（路由守卫），操作要教练账号。
import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  apiPost,
  type ActivatableTrainee,
  type ActivationResult,
  type FreeAgentResult,
  type FreeAgentRow,
  type FreeAgentsResponse,
  type TraineesResponse,
} from '../../lib/api.ts';
import { qk, useMyClub } from '../../lib/queries.ts';
import { useToast } from '../../lib/toast.tsx';
import { playerPath } from '../../lib/player-link.ts';
import { MarketNav, deadlineText } from './shared.tsx';

export default function MarketFreePage() {
  const { show, toastNode } = useToast();
  const { loading, isCoach, club } = useMyClub();
  return (
    <div className="container">
      <h1>转会市场 · 海捞</h1>
      {toastNode}
      <MarketNav />
      {loading ? (
        <p className="muted">正在确认你的俱乐部身份…</p>
      ) : !isCoach ? (
        <div className="card empty-state">
          <p className="muted">海捞签入与激活训练营球员都是教练操作，观众视角看看就好。</p>
        </div>
      ) : club === null ? (
        <div className="card empty-state">
          <p className="muted">还没有绑定俱乐部。先到球队中心完成绑定，再来海捞。</p>
        </div>
      ) : (
        <>
          <FreeAgentSection onDone={(msg) => show(msg)} onError={(m) => show(m, true)} />
          <ActivateSection onDone={(msg) => show(msg)} onError={(m) => show(m, true)} />
        </>
      )}
    </div>
  );
}

/* ---------- 海捞自由球员（规则 4.4.4） ---------- */

function FreeAgentSection({ onDone, onError }: { onDone: (msg: string) => void; onError: (msg: string) => void }) {
  const qc = useQueryClient();
  const [feeById, setFeeById] = useState<Record<number, string>>({});
  const [armedId, setArmedId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  // 拉失败按空名单展示（旧行为 .catch(() => setData(null)) 的静默口径由展示层 hint 承接）
  const { data } = useQuery({ queryKey: qk.freeAgents, queryFn: () => api<FreeAgentsResponse>('/api/market/free-agents'), retry: false });

  async function sign(p: FreeAgentRow) {
    if (busyId !== null) return;
    setBusyId(p.id);
    try {
      const newFee = Number(feeById[p.id]);
      const res = await apiPost<FreeAgentResult>('/api/transfers/free-agent', { playerId: p.id, newReleaseFee: newFee });
      onDone(
        `海捞申请已提交：${p.name} 以新违约金 ${res.newReleaseFee.toFixed(2)} m 签入，签入费 ${res.signFee.toFixed(2)} m（新违约金的 30%）待审核时收，等管理组批准。`,
      );
      setFeeById((prev) => ({ ...prev, [p.id]: '' }));
      setArmedId(null);
      // 申请挂上「在途」后名单状态可能变（本窗被解约/在途），别让 30s 的客户端缓存留住旧名单
      void qc.invalidateQueries({ queryKey: qk.freeAgents });
    } catch (err) {
      onError(err instanceof Error ? err.message : '海捞失败');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card admin-section">
      <h3>海捞自由球员</h3>
      {data === undefined ? (
        <p className="muted">自由球员名单还没加载出来…</p>
      ) : data.freeAgents.length === 0 ? (
        <p className="hint">
          现在没人待业。解约或合同到期的球员会出现在这里：给他一份新违约金（不设上下限），签入费按新违约金的 30% 在审核通过时收。
          本窗被解约的球员全联盟禁签。
        </p>
      ) : (
        <>
          <p className="hint">
            给自由球员一份新违约金（不设上下限，整数 m），签入费按新违约金的 30% 待审核时收。
            注意：本窗被解约的球员全联盟禁签。
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>球员</th>
                  <th>位置</th>
                  <th className="num">年龄</th>
                  <th className="num">CA / PA</th>
                  <th className="num">新违约金（m）</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.freeAgents.map((p) => {
                  const fee = Number(feeById[p.id] ?? 0);
                  const valid = Number.isInteger(fee) && fee > 0;
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link to={playerPath(p)}>{p.name}</Link>
                        {p.clubName && <span className="badge gray">{p.clubName}</span>}
                        {p.bannedThisWindow && <span className="badge red">本窗禁签</span>}
                      </td>
                      <td>{p.position ?? '—'}</td>
                      <td className="num mono">{p.age ?? '—'}</td>
                      <td className="num mono">
                        {p.ca ?? '—'} / {p.pa ?? '—'}
                      </td>
                      <td className="num">
                        <input
                          className="mono"
                          type="number"
                          min="1"
                          step="1"
                          aria-label={`${p.name} 的新违约金`}
                          value={feeById[p.id] ?? ''}
                          disabled={p.bannedThisWindow}
                          onChange={(e) => setFeeById((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        />
                        {valid && <span className="hint"> 签入费 {(fee * 0.3).toFixed(2)} m</span>}
                      </td>
                      <td>
                        {p.bannedThisWindow ? (
                          <span className="muted">他被解约后本窗谁都签不了</span>
                        ) : (
                          <button
                            className={`btn btn-sm${armedId === p.id ? ' btn-armed' : ''}`}
                            type="button"
                            disabled={busyId !== null || !valid}
                            onClick={() => (armedId === p.id ? sign(p) : setArmedId(p.id))}
                            onBlur={() => setArmedId(null)}
                          >
                            {busyId === p.id ? '提交中…' : armedId === p.id ? '再点一次确认签入' : '海捞签入'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

/* ---------- 激活别队训练营球员（规则 4.4.2） ---------- */

function ActivateSection({ onDone, onError }: { onDone: (msg: string) => void; onError: (msg: string) => void }) {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<number | null>(null);
  const { data } = useQuery({ queryKey: qk.trainees, queryFn: () => api<TraineesResponse>('/api/market/trainees'), retry: false });

  async function activate(t: ActivatableTrainee) {
    if (busyId !== null) return;
    setBusyId(t.id);
    try {
      const res = await apiPost<ActivationResult>('/api/market/activations', { playerId: t.id });
      onDone(
        res.kind === 'trainee'
          ? `已激活 ${t.name}：挂牌 ${res.askPrice.toFixed(2)} m。请在 ${deadlineText(res.firstBidDeadline, '')} 前落首价，落价即成交（训练营球员直进审核）。逾期激活作废（还占本窗激活额度）。`
          : `已激活 ${t.name}：挂牌 ${res.askPrice.toFixed(2)} m。请在 ${deadlineText(res.firstBidDeadline, '')} 前落首价；落价后进 24 小时匹配窗，等原属俱乐部决定是否匹配。逾期激活作废（还占本窗激活额度）。`,
      );
      // 激活生成新挂牌：训练营名单与市场板一并失效
      void qc.invalidateQueries({ queryKey: qk.trainees });
      void qc.invalidateQueries({ queryKey: ['market', 'board'] });
    } catch (err) {
      onError(err instanceof Error ? err.message : '激活失败');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card admin-section">
      <h3>激活训练营球员</h3>
      {data === undefined ? (
        <p className="muted">训练营名单还没加载出来…</p>
      ) : data.trainees.length === 0 ? (
        <p className="hint">
          别家训练营暂时没有可激活的小将。训练营球员不能自行挂牌，只能走激活转会：激活后按规则定价强制挂牌
          （训练营球员固定 <span className="mono">5.00</span> m），激活方须在 5 分钟内落首价（期间别队出价无效），首价即成交价。
        </p>
      ) : (
        <>
          <p className="hint">
            激活后按规则定价强制挂牌（训练营球员固定 <span className="mono">5.00</span> m，正式球员按保护期倍数）。
            激活方要在 5 分钟内落首价，期间别队出价无效；落价后训练营球员直进审核、正式球员进 24 小时匹配窗。
            逾期激活作废，且同一球员一个窗口只能被激活一次。
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>球员</th>
                  <th>所属俱乐部</th>
                  <th className="num">年龄</th>
                  <th className="num">CA / PA</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.trainees.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link to={playerPath(t)}>{t.name}</Link>
                    </td>
                    <td>{t.club.name}</td>
                    <td className="num mono">{t.age ?? '—'}</td>
                    <td className="num mono">
                      {t.ca ?? '—'} / {t.pa ?? '—'}
                    </td>
                    <td>
                      {t.activatedThisWindow ? (
                        <span className="stamp-inline">本窗已激活</span>
                      ) : (
                        <button className="btn btn-sm" type="button" disabled={busyId !== null} onClick={() => activate(t)}>
                          {busyId === t.id ? '激活中…' : '激活（5m）'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
