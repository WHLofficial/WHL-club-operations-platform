// 管理端 · 转会页：审核队列（含市场干预）+ 强制拍卖（规则 4.4.5）+ 转会窗口状态机（TECH_DESIGN §11/§6.4-6）
// （原 Admin.tsx 三 section，增量 15 拆分；commit 3 数据层转 TanStack Query，暂停出价控件在后续 commit 加入）
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiPost, type AdminReviewRow, type AdminReviews, type CloseWindowResult, type ForcedAuctionResult, type MarketListings, type OpenWindowResult, type WindowsResponse } from '../../lib/api.ts';
import { useToast } from '../../lib/toast.tsx';
import ConfirmButton from '../../components/ConfirmButton.tsx';
import EmptyState from '../../components/EmptyState.tsx';
import { usePrompt } from '../../components/PromptDialog.tsx';

export default function MarketPage() {
  return (
    <div className="admin-page">
      <ReviewsSection />
      <ForcedAuctionSection />
      <WindowsSection />
    </div>
  );
}

/* ---------- 审核队列（增量 3 成交确认 + 增量 5 旁路单据） ---------- */

const TRANSFER_TYPE_LABEL: Record<string, string> = {
  transfer: '普通成交',
  activation: '激活成交',
  forced_auction: '强制拍卖',
  rc_change: '续约',
  termination: '解约',
  free_agent: '海捞签入',
  match: '匹配留队',
};

// 旁路单据的摘要行（payload 由 createBypassTransfer / submitMatch 冻结）
function bypassSummary(r: AdminReviewRow): string | null {
  const p = (r.payload ?? {}) as Record<string, unknown>;
  const num = (k: string) => (typeof p[k] === 'number' ? (p[k] as number).toFixed(2) : '—');
  switch (p.kind) {
    case 'rc_change':
      return `违约金 ${num('oldReleaseFee')} → ${num('newReleaseFee')} m${(p.changeFee as number) > 0 ? `，加价费 ${num('changeFee')} m` : '，降价免费'}`;
    case 'termination':
      return `解约费 ${(p.terminationFee as number) > 0 ? num('terminationFee') : '0.00'} m，本窗禁签`;
    case 'free_agent':
      return `新违约金 ${num('newReleaseFee')} m，签入费 ${num('signFee')} m（30%）`;
    case 'match':
      return `匹配留队：新违约金 ${num('newReleaseFee')} m > 出价 ${num('previousBid')} m，回收差额 ${num('diff')} m`;
    default:
      return null;
  }
}

function completedMessage(r: AdminReviewRow): string {
  switch (r.transfer.type) {
    case 'rc_change':
      return `已批准：${r.transfer.player.name} 的合同违约金已更新，保护期重新起算。`;
    case 'termination':
      return `已批准：${r.transfer.player.name} 合同解除，进入自由球员名单（本窗禁签）。`;
    case 'free_agent':
      return `已批准：${r.transfer.player.name} 签入 ${r.transfer.toClubName ?? '—'}，签入费已收。`;
    case 'match':
      return `已批准：${r.transfer.player.name} 留在 ${r.transfer.fromClubName ?? '—'}，匹配差额已回收。`;
    default:
      return `已批准：${r.transfer.player.name} → ${r.transfer.toClubName ?? '—'}，划款过户完成。`;
  }
}

function ReviewsSection() {
  const { show, toastNode } = useToast();
  const { ask, promptNode } = usePrompt();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'open' | 'approved' | 'rejected' | 'all'>('open');
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [feeDrafts, setFeeDrafts] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [interveneId, setInterveneId] = useState('');

  const { data: reviews, error: reviewsError } = useQuery({
    queryKey: ['admin', 'reviews', status],
    queryFn: () => api<AdminReviews>(`/api/admin/reviews?status=${status}`).then((d) => d.reviews),
  });

  useEffect(() => {
    if (reviewsError) show(reviewsError instanceof Error ? reviewsError.message : '审核队列加载失败', true);
  }, [reviewsError, show]);

  const reload = () => queryClient.invalidateQueries({ queryKey: ['admin', 'reviews'] });

  async function decide(row: AdminReviewRow, action: 'approve' | 'reject') {
    if (busyId !== null) return;
    setBusyId(row.id);
    try {
      const feeRaw = feeDrafts[row.id];
      const fee = action === 'approve' && feeRaw && Number(feeRaw) > 0 ? Number(feeRaw) : undefined;
      const res = await apiPost<{ ok: boolean; status: string }>(`/api/admin/reviews/${row.id}/${action}`, {
        note: notes[row.id] ?? undefined,
        ...(fee !== undefined ? { fee } : {}),
      });
      show(
        action === 'approve'
          ? fee !== undefined
            ? `已按裁定价 ${fee} m 批准：${row.transfer.player.name}（原价 ${row.transfer.fee ?? '—'} m）。`
            : res.status === 'signing'
              ? `已批准：${row.transfer.player.name} → ${row.transfer.toClubName ?? '—'}，签约谈判已开启，等买方谈妥合同后过户。`
              : res.status === 'already'
                ? '这单刚批过了。'
                : completedMessage(row)
          : `已驳回：${row.transfer.player.name} 的单子，资金已解冻。`,
      );
      setFeeDrafts((prev) => ({ ...prev, [row.id]: '' }));
      await reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '操作失败', true);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card admin-section">
      <h2>审核队列</h2>
      {toastNode}
      {promptNode}
      <p className="hint">
        市场成交单与方式单据（续约、解约、海捞、匹配）都在这里盖章：转会成交批准后开启签约谈判，由买方谈妥合同后成约过户；
        方式单据批准即落合同、收附加费。驳回则解冻全部资金、挂牌下架（不收下架费）。
      </p>
      <div className="seg" role="radiogroup" aria-label="审核任务状态">
        {(['open', 'approved', 'rejected', 'all'] as const).map((s) => (
          <button key={s} type="button" className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
            {{ open: '待审', approved: '已批准', rejected: '已驳回', all: '全部' }[s]}
          </button>
        ))}
      </div>

      {reviews === undefined ? (
        <p className="muted">正在翻审核夹…</p>
      ) : reviews.length === 0 ? (
        <EmptyState>{status === 'open' ? '没有待审的单子。市场很平静。' : '这一栏暂时没有记录。'}</EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>球员</th>
                <th>单据</th>
                <th>内容</th>
                <th className="num">金额（m）</th>
                <th>状态</th>
                <th>{status === 'open' ? '操作' : '结果'}</th>
              </tr>
            </thead>
            <tbody>
              {reviews.map((r) => {
                const summary = bypassSummary(r);
                const alerts = Array.isArray(r.payload?.alerts) ? ((r.payload!.alerts) as { kind: string; text: string }[]) : [];
                return (
                  <tr key={r.id}>
                    <td>
                      {r.transfer.player.name}
                      <span className="muted">（CA {r.transfer.player.ca ?? '—'}）</span>
                    </td>
                    <td>
                      <span className={`badge ${r.transfer.type === 'forced_auction' ? 'red' : summary ? 'purple' : 'sky'}`}>
                        {TRANSFER_TYPE_LABEL[r.transfer.type] ?? r.transfer.type}
                      </span>
                      {alerts.length > 0 && (
                        <span className="badge red" title={alerts.map((a) => a.text).join('；')}>
                          ⚠️ 异常出价 ×{alerts.length}
                        </span>
                      )}
                    </td>
                    <td>
                      {summary ?? (
                        <>
                          {r.transfer.fromClubName ?? '—'} → <b>{r.transfer.toClubName ?? '—'}</b>
                        </>
                      )}
                    </td>
                    <td className="num mono">
                      {r.transfer.fee !== null ? r.transfer.fee.toFixed(2) : '—'}
                      {r.transfer.extraFee !== null && r.transfer.extraFee > 0 && (
                        <span className="muted">＋{r.transfer.extraFee.toFixed(2)}</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${r.transfer.status === 'completed' ? 'gold' : r.transfer.status === 'rejected' ? 'red' : r.transfer.status === 'signing' ? 'purple' : 'sky'}`}>
                        {r.transfer.status === 'completed'
                          ? '已过户'
                          : r.transfer.status === 'rejected'
                            ? '已驳回'
                            : r.transfer.status === 'signing'
                              ? '签约谈判中'
                              : '待审核'}
                      </span>
                    </td>
                    <td>
                      {r.status === 'open' ? (
                        <div className="inline-form">
                          <input
                            className="field"
                            type="text"
                            placeholder="备注（可空）"
                            value={notes[r.id] ?? ''}
                            onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                          />
                          {(r.transfer.type === 'transfer' || r.transfer.type === 'activation') && (
                            <input
                              className="field mono"
                              type="number"
                              step="0.01"
                              style={{ width: '7rem' }}
                              placeholder={`裁定价 ${r.transfer.fee ?? '—'}`}
                              value={feeDrafts[r.id] ?? ''}
                              onChange={(e) => setFeeDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                            />
                          )}
                          <button className="btn btn-sm" type="button" disabled={busyId === r.id} onClick={() => decide(r, 'approve')}>
                            {busyId === r.id ? '处理中…' : feeDrafts[r.id] ? '按裁定价批准' : '批准'}
                          </button>
                          <button className="btn btn-sm btn-danger" type="button" disabled={busyId === r.id} onClick={() => decide(r, 'reject')}>
                            驳回
                          </button>
                        </div>
                      ) : (
                        <span className="muted">{r.note ?? '—'}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="market-intervene">
        <h3>市场干预</h3>
        <p className="hint">
          对卡在竞价/匹配窗或签约谈判的单据直接处置：撤出价、强制送审、强制作废（解冻资金、球员还原）、
          谈判强制按预期工资成交或作废谈判。所有动作都要求填原因并进审计。
        </p>
        <div className="inline-form">
          <label className="field">
            ID
            <input className="mono" type="number" value={interveneId} onChange={(e) => setInterveneId(e.target.value)} placeholder="出价/挂牌/谈判 ID" />
          </label>
          {[
            ['撤销出价', '/api/admin/market/bids/', '/void', '出价'],
            ['强制送审', '/api/admin/market/listings/', '/force-settle', '挂牌'],
            ['强制作废', '/api/admin/market/listings/', '/force-void', '挂牌'],
            ['谈判强制成交', '/api/admin/negotiations/', '/force-sign', '谈判会话'],
            ['作废谈判', '/api/admin/negotiations/', '/void', '谈判会话'],
          ].map(([label, base, suffix, kind]) => (
            <button
              key={label}
              className="btn btn-sm"
              type="button"
              disabled={!Number.isInteger(Number(interveneId)) || Number(interveneId) <= 0}
              onClick={async () => {
                const id = Number(interveneId);
                const reason = await ask(`处置原因（${kind} #${id}，会进审计）：`);
                if (!reason) return;
                try {
                  const res = await apiPost<{ ok: boolean; status: string }>(`${base}${id}${suffix}`, { reason });
                  show(`${label}：${kind} #${id} → ${res.status === 'done' || res.status === 'settled' ? '已执行' : '状态没变（已是目标状态）'}。`);
                  await reload();
                } catch (err) {
                  show(err instanceof Error ? err.message : '处置失败', true);
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- 强制拍卖（规则 4.4.5） ---------- */

function ForcedAuctionSection() {
  const { show, toastNode } = useToast();
  const queryClient = useQueryClient();
  const [playerId, setPlayerId] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  // 原 catch → setOpen(null)：失败时强制拍卖列表静默置空，queryFn 里保持一致
  const { data: open } = useQuery({
    queryKey: ['admin', 'forced-auctions'],
    queryFn: () => api<MarketListings>('/api/market/listings?status=active').catch(() => null),
  });

  const reload = () => queryClient.invalidateQueries({ queryKey: ['admin', 'forced-auctions'] });

  const forced = (open?.listings ?? []).filter((l) => l.type === 'forced');

  async function create() {
    if (createBusy) return;
    setCreateBusy(true);
    try {
      const res = await apiPost<ForcedAuctionResult>('/api/admin/forced-auctions', { playerId: Number(playerId) });
      show(`强制拍卖已挂出：挂牌价 ${res.askPrice.toFixed(2)} m，1m 起拍，整单税 50%。`);
      setPlayerId('');
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '建强制拍卖失败', true);
    } finally {
      setCreateBusy(false);
    }
  }

  async function cancel(listingId: number) {
    if (cancelBusy) return;
    setCancelBusy(true);
    try {
      await apiPost(`/api/admin/forced-auctions/${listingId}/cancel`, {});
      show('强制拍卖已取消，挂牌下架。');
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '取消失败', true);
    } finally {
      setCancelBusy(false);
    }
  }

  return (
    <section className="card admin-section">
      <h2>强制拍卖</h2>
      {toastNode}
      <p className="hint">
        资格检查未过的处置手段：按 1m 挂牌强拍（只有本队 CA 前六、不含门将的球员可拍），成交整单税 50%。
        未成交前可以取消。
      </p>
      <div className="inline-form">
        <div className="field">
          <label htmlFor="forced-player">球员 ID</label>
          <input id="forced-player" className="mono" type="number" min="1" value={playerId} onChange={(e) => setPlayerId(e.target.value)} />
        </div>
        <ConfirmButton
          label="挂出强制拍卖"
          confirmLabel="再点一次确认挂出"
          busyLabel="挂出中…"
          busy={createBusy}
          disabled={playerId === '' || Number(playerId) < 1}
          disarmKey={playerId}
          onConfirm={create}
        />
      </div>

      {forced.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>球员</th>
                <th className="num">起拍价（m）</th>
                <th className="num">当前最高（m）</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
                {forced.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.player.name}
                      <span className="muted">（所属 {l.sellerClub.name}）</span>
                    </td>
                  <td className="num mono">{l.askPrice.toFixed(2)}</td>
                  <td className="num mono">{l.highestBid?.toFixed(2) ?? '—'}</td>
                  <td>
                    <ConfirmButton
                      className="btn-danger btn-sm"
                      label="取消拍卖"
                      confirmLabel="再点一次确认取消"
                      busyLabel="取消中…"
                      busy={cancelBusy && cancelId === l.id}
                      disabled={cancelBusy}
                      onConfirm={() => {
                        setCancelId(l.id);
                        return cancel(l.id);
                      }}
                    />
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

/* ---------- 转会窗口状态机（TECH_DESIGN §11/§6.4-6） ---------- */

const WINDOW_STATUS_LABEL: Record<string, string> = { open: '进行中', closed: '已关闭' };

function WindowsSection() {
  const { show, toastNode } = useToast();
  const queryClient = useQueryClient();
  const [season, setSeason] = useState('');
  const [seq, setSeq] = useState('');
  const [openBusy, setOpenBusy] = useState(false);
  const [declarePeriod, setDeclarePeriod] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data, error: windowsError } = useQuery({
    queryKey: ['admin', 'windows'],
    queryFn: () => api<WindowsResponse>('/api/admin/windows'),
  });

  useEffect(() => {
    if (windowsError) show(windowsError instanceof Error ? windowsError.message : '窗口列表加载失败', true);
  }, [windowsError, show]);

  const reload = () => queryClient.invalidateQueries({ queryKey: ['admin', 'windows'] });

  async function openWindow() {
    if (openBusy) return;
    setOpenBusy(true);
    try {
      const res = await apiPost<OpenWindowResult>('/api/admin/windows/open', {
        ...(season.trim() === '' ? {} : { season: Number(season) }),
        ...(seq.trim() === '' ? {} : { windowSeq: Number(seq) }),
        ...(declarePeriod ? { declareGrowthPeriod: true } : {}),
      });
      show(
        `窗口已开：第 ${res.season} 赛季 · 窗口 ${res.windowSeq}。全联盟经纪人档位重掷了 ${res.rerolled} 名球员。` +
          (res.growthPeriodDeclared ? ' 已同时宣告新成长期，里程碑重新起算。' : ''),
      );
      setSeason('');
      setSeq('');
      setDeclarePeriod(false);
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '开窗失败', true);
    } finally {
      setOpenBusy(false);
    }
  }

  async function closeWindow(force: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiPost<CloseWindowResult>('/api/admin/windows/close', force ? { force: true } : {});
      show(
        res.forceSettled > 0
          ? `第 ${res.season} 赛季窗口 ${res.windowSeq} 已关闭：${res.forceSettled} 场签约谈判按已定条款强制成约。`
          : `第 ${res.season} 赛季窗口 ${res.windowSeq} 已关闭，窗尾截止处理完成。`,
      );
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '关窗失败', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card admin-section">
      <h2>转会窗口</h2>
      {toastNode}
      <p className="hint">
        同一时刻只有一个窗口开着。开窗会给全联盟球员重掷经纪人档位；关窗前先处理完市场截止单，
        并要求没有待审单、没有等待匹配的激活单、没有进行中的签约谈判——除非开了 window_force_settle 参数并用强制关窗，
        未谈完的谈判会按买方已提交的条款强制成约。勾选「同时宣告新成长期」会在开窗同一批里画一条里程碑起算线。
      </p>
      <div className="inline-form">
        <div className="field">
          <label htmlFor="win-season">赛季（留空顺延）</label>
          <input id="win-season" className="mono" type="number" min="1" value={season} onChange={(e) => setSeason(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="win-seq">窗口序号（留空顺延）</label>
          <input id="win-seq" className="mono" type="number" min="1" value={seq} onChange={(e) => setSeq(e.target.value)} />
        </div>
        <button className="btn" type="button" disabled={openBusy} onClick={openWindow}>
          {openBusy ? '开窗中…' : '开新窗'}
        </button>
      </div>
      <label className="field field-check">
        <input type="checkbox" checked={declarePeriod} onChange={(e) => setDeclarePeriod(e.target.checked)} />
        同时宣告新成长期（里程碑从开窗时点重新累计；成长期不绑窗口，之后也可以手动宣告）
      </label>
      <div className="inline-form">
        <ConfirmButton
          label="关闭当前窗口"
          confirmLabel="再点一次确认关窗"
          busyLabel="处理中…"
          busy={busy}
          onConfirm={() => closeWindow(false)}
        />
        <ConfirmButton
          className="btn-danger"
          label="强制关窗（强结谈判）"
          confirmLabel="再点一次确认强制关窗"
          busyLabel="处理中…"
          busy={busy}
          onConfirm={() => closeWindow(true)}
        />
      </div>

      {data === undefined ? (
        <p className="muted">正在翻窗口台账…</p>
      ) : data.windows.length === 0 ? (
        <EmptyState>还没有开过窗。建好俱乐部、导完合同之后，从这里开第一扇窗。</EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="num">赛季</th>
                <th className="num">窗口</th>
                <th>状态</th>
                <th>开窗时间</th>
                <th>关窗时间</th>
              </tr>
            </thead>
            <tbody>
              {data.windows.map((w) => (
                <tr key={`${w.season}-${w.windowSeq}`}>
                  <td className="num mono">{w.season}</td>
                  <td className="num mono">{w.windowSeq}</td>
                  <td>
                    <span className={`badge ${w.status === 'open' ? 'sky' : 'gray'}`}>{WINDOW_STATUS_LABEL[w.status] ?? w.status}</span>
                  </td>
                  <td className="mono">{w.openedAt?.slice(0, 16).replace('T', ' ') ?? '—'}</td>
                  <td className="mono">{w.closedAt?.slice(0, 16).replace('T', ' ') ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
