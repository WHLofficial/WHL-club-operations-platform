// 海捞情报台 /market/free（v6.17.0 重定位）：成交动态 + CPU 捞人榜 + 激活别队训练营球员（规则 4.4.2）。
// 旧的「海捞自由球员」大表已随 /api/market/free-agents 下线：可捞名单与球员库纯重复，海捞签入入口
// 收进球员档案左栏（SideOps E 态）。本页只留情报：别人的成交价是定价锚，海捞签入费 = 新违约金 × 30%。
// 需登录（路由守卫），两个情报端点都是教练端点（club.squad.manage）。
import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  apiPost,
  type ActivatableTrainee,
  type ActivationResult,
  type TraineesResponse,
} from '../../lib/api.ts';
import { qk, useCpuBoard, useMyClub, useSeaSigns, useSeasonsCurrent } from '../../lib/queries.ts';
import { useToast } from '../../lib/toast.tsx';
import { playerPath } from '../../lib/player-link.ts';
import { MarketNav, deadlineText, money } from './shared.tsx';

export default function MarketFreePage() {
  const { show, toastNode } = useToast();
  const { loading, isCoach, club } = useMyClub();
  return (
    <div className="container">
      <h1>转会市场 · 海捞情报台</h1>
      {toastNode}
      <MarketNav />
      {loading ? (
        <p className="muted">正在确认你的俱乐部身份…</p>
      ) : !isCoach ? (
        <div className="card empty-state">
          <p className="muted">海捞情报与激活训练营球员都只对教练开放，观众视角看看就好。</p>
        </div>
      ) : club === null ? (
        <div className="card empty-state">
          <p className="muted">还没有绑定俱乐部。先到球队中心完成绑定，再来看海捞情报。</p>
        </div>
      ) : (
        <>
          <SeaSignsSection />
          <CpuBoardSection />
          <ActivateSection onDone={(msg) => show(msg)} onError={(m) => show(m, true)} />
        </>
      )}
    </div>
  );
}

/* ---------- 成交动态（v6.17.0，GET /api/market/sea-signs） ---------- */

function SeaSignsSection() {
  const { data, isError, error } = useSeaSigns();
  // 当前开放窗：本窗成交的行高亮（公开端点，与球员页 windowOpen 同口径）
  const seasons = useSeasonsCurrent();
  const win = seasons.data?.window?.status === 'open' ? seasons.data.window : null;
  return (
    <section className="card admin-section">
      <h3>成交动态</h3>
      {isError ? (
        <div className="banner warn">{error instanceof Error ? error.message : '成交动态打不开了，稍后再试'}</div>
      ) : data === undefined ? (
        <p className="muted">成交动态还没加载出来…</p>
      ) : data.length === 0 ? (
        <p className="hint">
          还没有海捞成交记录。成交时定的新违约金就是别人的定价锚：海捞签入费 = 新违约金 × 30%，
          签入即付、不设上下限。
        </p>
      ) : (
        <>
          <p className="hint">
            最近 30 笔海捞成交，新的在前。高亮行是本窗刚成交的；新违约金 = 成交时定的合同违约金，
            海捞费 = 新违约金 × 30%。
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>球员</th>
                  <th>原东家 → 捞入队</th>
                  <th className="num">新违约金（m）</th>
                  <th className="num">海捞费（m）</th>
                  <th>窗口</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => {
                  const isNow = win !== null && r.season === win.season && r.windowSeq === win.windowSeq;
                  return (
                    <tr key={r.id} className={isNow ? 'win-now' : undefined}>
                      <td>
                        <Link to={playerPath({ id: r.playerId })}>{r.playerName}</Link>
                        <span className="muted mono"> CA {r.playerCa ?? '—'}</span>
                      </td>
                      <td>
                        <span className="muted">{r.fromClubName ?? '自由身'}</span> → {r.toClubName ?? '—'}
                      </td>
                      <td className="num mono">{money(r.newReleaseFee)}</td>
                      <td className="num mono">{money(r.signFee)}</td>
                      <td className="mono">
                        {r.season == null || r.windowSeq == null ? (
                          '—'
                        ) : (
                          <>
                            S{r.season} 第 {r.windowSeq} 窗{isNow && <span className="badge sky">本窗</span>}
                          </>
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

/* ---------- CPU 捞人榜（v6.17.0，GET /api/market/cpu-board） ---------- */

function CpuBoardSection() {
  const { data, isError, error } = useCpuBoard();
  // 试算输入：只做定金参考，不提交任何东西（真正的签入在球员档案左栏走审核）
  const [feeById, setFeeById] = useState<Record<number, string>>({});
  return (
    <section className="card admin-section">
      <h3>CPU 捞人榜</h3>
      {isError ? (
        <div className="banner warn">{error instanceof Error ? error.message : '捞人榜打不开了，稍后再试'}</div>
      ) : data === undefined ? (
        <p className="muted">捞人榜还没加载出来…</p>
      ) : data.length === 0 ? (
        <p className="hint">CPU 队现在没有可捞的球员（free / 正常状态的都会出现在这里）。</p>
      ) : (
        <>
          <p className="hint">
            CPU 队球员按 CA 降序。想捞谁点名字进档案，在左栏「海捞签入」填新违约金走审核；
            海捞签入费 = 新违约金 × 30%，不设上下限。下面这里只做试算。
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>球员</th>
                  <th>位置</th>
                  <th className="num">年龄</th>
                  <th className="num">CA</th>
                  <th className="num">PA</th>
                  <th>所属 CPU 队</th>
                  <th className="num">试算违约金（m）</th>
                  <th className="num">海捞费（m）</th>
                </tr>
              </thead>
              <tbody>
                {data.map((p) => {
                  const fee = Number(feeById[p.id] ?? '');
                  const valid = Number.isInteger(fee) && fee > 0;
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link to={playerPath(p)}>{p.name}</Link>
                      </td>
                      <td>{p.position ?? '—'}</td>
                      <td className="num mono">{p.age ?? '—'}</td>
                      <td className="num mono">{p.ca ?? '—'}</td>
                      <td className="num mono">{p.pa ?? '—'}</td>
                      <td>{p.clubName ?? '—'}</td>
                      <td className="num">
                        <input
                          className="mono"
                          type="number"
                          min="1"
                          step="1"
                          aria-label={`${p.name} 的试算违约金`}
                          placeholder="填违约金"
                          value={feeById[p.id] ?? ''}
                          onChange={(e) => setFeeById((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        />
                      </td>
                      <td className="num mono">{valid ? (fee * 0.3).toFixed(2) : '—'}</td>
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
