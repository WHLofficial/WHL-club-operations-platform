// 管理端 · 转会页：审核队列（含市场干预）+ 暂停出价 + 强制拍卖（规则 4.4.5；v6.51.0 起人选不限、前六为参考）+ 海捞暗标段（v6.50.0）+ 转会窗口状态机（TECH_DESIGN §11/§6.4-6）
// （原 Admin.tsx 三 section，v2.1.0 拆分；暂停出价为v2.1.0 commit 5 新增）
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiPost, type AdminReviewRow, type AdminReviews, type CloseWindowResult, type ForcedAuctionPreview, type ForcedAuctionResult, type MarketListings, type OpenWindowResult, type SeaAdminView, type SeaCancelResult, type SeaExtendResult, type SeaOpenSummary, type WindowRow, type WindowsResponse } from '../../lib/api.ts';
import { TRANSFER_TYPE_LABEL } from '../../lib/ref.ts';
import { useToast } from '../../lib/toast.tsx';
import ConfirmButton from '../../components/ConfirmButton.tsx';
import EmptyState from '../../components/EmptyState.tsx';
import { usePrompt } from '../../components/PromptDialog.tsx';
import { useTimeFmt, utcIsoToZhWall, zhWallToUtcIso } from '../../lib/datetime.ts';

export default function MarketPage() {
  return (
    <div className="admin-page">
      <ReviewsSection />
      <ForcedAuctionSection />
      <SeaSealedSection />
      <WindowsSection />
    </div>
  );
}

/* ---------- 审核队列（v0.4.0 成交确认 + v0.6.0 旁路单据） ---------- */

// 旁路单据的摘要行（payload 由 createBypassTransfer / submitMatch 冻结）
function bypassSummary(r: AdminReviewRow): string | null {
  const p = (r.payload ?? {}) as Record<string, unknown>;
  const num = (k: string) => (typeof p[k] === 'number' ? (p[k] as number).toFixed(2) : '—');
  switch (p.kind) {
    case 'rc_change':
      return `违约金 ${num('oldReleaseFee')} → ${num('newReleaseFee')}m${(p.changeFee as number) > 0 ? `，加价费 ${num('changeFee')}m` : '，降价免费'}`;
    case 'termination':
      return `解约费 ${(p.terminationFee as number) > 0 ? num('terminationFee') : '0.00'}m，本窗禁签`;
    case 'free_agent':
      return `新违约金 ${num('newReleaseFee')}m，签入费 ${num('signFee')}m（30%）`;
    case 'match':
      return `匹配留队：新违约金 ${num('newReleaseFee')}m > 出价 ${num('previousBid')}m，回收差额 ${num('diff')}m`;
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
            ? `已按裁定价 ${fee}m 批准：${row.transfer.player.name}（原价 ${row.transfer.fee ?? '—'}m）。`
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

  // 激活举报核查收口（v6.4.0 改动 4）：只关任务不自动改数据，裁定写进备注
  async function resolveReport(row: AdminReviewRow) {
    if (busyId !== null) return;
    setBusyId(row.id);
    try {
      await apiPost<{ ok: boolean }>(`/api/admin/reviews/${row.id}/resolve`, { note: notes[row.id] ?? undefined });
      show(`举报核查已收口：${row.transfer.player.name} 的激活单。`);
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
                // 激活举报核查行（v6.4.0 改动 4）：与成交单共用表格，按 kind 分流
                if (r.report !== null) {
                  return (
                    <tr key={r.id}>
                      <td>
                        {r.transfer.player.name}
                        <span className="muted">（CA {r.transfer.player.ca ?? '—'}）</span>
                      </td>
                      <td>
                        <span className="badge purple">激活举报</span>
                      </td>
                      <td>
                        被激活方举报未收到 QQ 通知；激活方 <b>{r.report.activatorClubName ?? '—'}</b>
                        {r.report.proofKey ? (
                          <>
                            {' · '}
                            <a href={`/api/media/${r.report.proofKey}`} target="_blank" rel="noreferrer">
                              查看截图
                            </a>
                          </>
                        ) : (
                          ' · 无截图记录'
                        )}
                        <span className="muted">（激活单状态 {r.report.listingStatus ?? '—'}）</span>
                      </td>
                      <td className="num mono">{r.report.askPrice?.toFixed(2) ?? '—'}</td>
                      <td>
                        <span className={`badge ${r.status === 'open' ? 'sky' : 'gold'}`}>{r.status === 'open' ? '待核查' : '已处理'}</span>
                      </td>
                      <td>
                        {r.status === 'open' ? (
                          <div className="inline-form">
                            <input
                              className="field"
                              type="text"
                              placeholder="核查结论（建议填写）"
                              value={notes[r.id] ?? ''}
                              onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                            />
                            <button className="btn btn-sm" type="button" disabled={busyId === r.id} onClick={() => resolveReport(r)}>
                              {busyId === r.id ? '处理中…' : '处理完毕'}
                            </button>
                          </div>
                        ) : (
                          <span className="muted">{r.note ?? '—'}</span>
                        )}
                      </td>
                    </tr>
                  );
                }
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
                            // v6.20.0 窄屏：裁定价输入最宽 7rem，窄屏按容器收缩，不撑破 .inline-form
                            <input
                              className="field mono"
                              type="number"
                              step="0.01"
                              style={{ width: 'min(7rem, 100%)' }}
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
        <BidPauseSwitch />
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

/* ---------- 暂停出价（全局开关，单挂牌按钮在强制拍卖行内） ---------- */

function BidPauseSwitch() {
  const { show, toastNode } = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data } = useQuery({
    queryKey: ['admin', 'pause-bids'],
    queryFn: () => api<{ paused: boolean }>('/api/admin/market/pause-bids'),
  });

  async function toggle(paused: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await apiPost('/api/admin/market/pause-bids', { paused });
      show(
        paused
          ? '全市场出价已暂停：不能再对新挂牌出价，已出的价与到期结算不受影响。'
          : '全市场出价已恢复。',
      );
      queryClient.invalidateQueries({ queryKey: ['admin', 'pause-bids'] });
    } catch (err) {
      show(err instanceof Error ? err.message : '操作失败', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-form">
      {toastNode}
      <span className="hint">
        全局暂停出价：
        {data === undefined ? '…' : data.paused ? '已暂停（全市场不能出新价，结算照常）' : '未暂停'}
      </span>
      {data?.paused ? (
        <ConfirmButton
          label="恢复全市场出价"
          confirmLabel="再点一次确认恢复"
          busyLabel="处理中…"
          busy={busy}
          onConfirm={() => toggle(false)}
        />
      ) : (
        <ConfirmButton
          className="btn-danger"
          label="暂停全市场出价"
          confirmLabel="再点一次确认暂停"
          busyLabel="处理中…"
          busy={busy}
          onConfirm={() => toggle(true)}
        />
      )}
    </div>
  );
}

/* ---------- 强制拍卖（规则 4.4.5） ---------- */

// 参考值一句话（v6.51.0：门将 / 前六只是参考提示，不再拦截；blockers[0] 才是真会拒的闸）
function referenceLine(p: ForcedAuctionPreview): string {
  const r = p.reference;
  const rank = r.isGk
    ? '门将（前六参考口径不含门将）'
    : r.caRank === null
      ? '缺 CA 数据，参考不可算'
      : `非门将 CA 队内第 ${r.caRank} 位${r.topSixLine !== null ? `（前六线 CA ${r.topSixLine}）` : ''}`;
  const verdict = r.inTopSix === true ? '落在前六' : r.inTopSix === false ? '不在前六（同样可挂）' : null;
  const head = `${r.playerName}${r.clubName ? `（${r.clubName}）` : ''}｜参考：${rank}${verdict ? `，${verdict}` : ''}`;
  return p.blockers.length > 0 ? `${head}｜⚠ 现在挂出会被拒：${p.blockers[0].message}` : `${head}｜可挂出`;
}

function ForcedAuctionSection() {
  const { show, toastNode } = useToast();
  const queryClient = useQueryClient();
  const [playerId, setPlayerId] = useState('');
  const [askPrice, setAskPrice] = useState('1');
  const [createBusy, setCreateBusy] = useState(false);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [pauseBusyId, setPauseBusyId] = useState<number | null>(null);

  // 原 catch → setOpen(null)：失败时强制拍卖列表静默置空，queryFn 里保持一致
  const { data: open } = useQuery({
    queryKey: ['admin', 'forced-auctions'],
    queryFn: () => api<MarketListings>('/api/market/listings?status=active').catch(() => null),
  });

  const playerIdNum = Number(playerId);
  const previewReady = playerId !== '' && Number.isInteger(playerIdNum) && playerIdNum > 0;
  const askPriceNum = Number(askPrice);
  const askPriceReady = askPrice !== '' && Number.isFinite(askPriceNum) && askPriceNum > 0;
  const { data: preview } = useQuery({
    queryKey: ['admin', 'forced-auction-preview', playerId],
    queryFn: () =>
      api<ForcedAuctionPreview>(`/api/admin/forced-auctions/preview?playerId=${playerIdNum}`).catch(() => null),
    enabled: previewReady,
  });

  const reload = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'forced-auctions'] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'forced-auction-preview'] });
  };

  const forced = (open?.listings ?? []).filter((l) => l.type === 'forced');

  async function create() {
    if (createBusy) return;
    setCreateBusy(true);
    try {
      const res = await apiPost<ForcedAuctionResult>('/api/admin/forced-auctions', {
        playerId: Number(playerId),
        askPrice: askPriceNum,
      });
      const r = res.reference;
      const ref = r.isGk
        ? '门将，前六参考不适用'
        : r.caRank === null
          ? '缺 CA，参考不可算'
          : `非门将 CA 队内第 ${r.caRank}${r.topSixLine !== null ? `（前六线 ${r.topSixLine}）` : ''}`;
      show(`强制拍卖已挂出：${r.playerName}｜参考 ${ref}（不强制）｜挂牌价 ${res.askPrice.toFixed(2)}m 起拍，整单税 50%。`);
      setPlayerId('');
      setAskPrice('1');
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

  async function setBidPause(listingId: number, paused: boolean) {
    if (pauseBusyId !== null) return;
    setPauseBusyId(listingId);
    try {
      await apiPost(`/api/admin/market/listings/${listingId}/${paused ? 'pause-bid' : 'resume-bid'}`, {});
      show(paused ? `挂牌 #${listingId} 已暂停出价，其余市场照常。` : `挂牌 #${listingId} 已恢复出价。`);
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '操作失败', true);
    } finally {
      setPauseBusyId(null);
    }
  }

  return (
    <section className="card admin-section">
      <h2>强制拍卖</h2>
      {toastNode}
      <p className="hint">
        准入失败时的处置手段：按给定挂牌价强拍（默认 1m，起拍价即挂牌价，之后每次加价 ≥ 1m；窗尾无人出价按下架费 10% 挂牌价收）。
        人选不限——本队任何正式球员都可挂，门将、CA 前六之外的也能挂；
        「非门将 CA 前六」只是填了球员 ID 后给出的参考值（并标出前六线），不拦截挂出。
        成交整单税 50%。未成交前可以取消；行内可单独暂停/恢复这一件的出价（其余市场照常）。
      </p>
      <div className="inline-form">
        <div className="field">
          <label htmlFor="forced-player">球员 ID</label>
          <input id="forced-player" className="mono" type="number" min="1" value={playerId} onChange={(e) => setPlayerId(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="forced-price">挂牌价（m）</label>
          <input id="forced-price" className="mono" type="number" min="0.01" step="0.5" value={askPrice} onChange={(e) => setAskPrice(e.target.value)} />
        </div>
        <ConfirmButton
          label="挂出强制拍卖"
          confirmLabel="再点一次确认挂出"
          busyLabel="挂出中…"
          busy={createBusy}
          disabled={playerId === '' || Number(playerId) < 1 || !askPriceReady}
          disarmKey={playerId}
          onConfirm={create}
        />
      </div>
      {previewReady && preview && <p className="hint">{referenceLine(preview)}</p>}

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
                    <div className="inline-form">
                      <ConfirmButton
                        className="btn-sm"
                        label={l.bidPaused ? '恢复出价' : '暂停出价'}
                        confirmLabel={l.bidPaused ? '再点一次确认恢复' : '再点一次确认暂停'}
                        busyLabel={l.bidPaused ? '恢复中…' : '暂停中…'}
                        busy={pauseBusyId === l.id}
                        disabled={pauseBusyId !== null && pauseBusyId !== l.id}
                        onConfirm={() => setBidPause(l.id, !l.bidPaused)}
                      />
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
                    </div>
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

// 窗类型（v3.0.0）：只有「临时」落库；季初 / 中期按同赛季非临时窗的 window_seq 升序派生
function windowKindLabel(w: WindowRow, all: WindowRow[]): string {
  if (w.isTemporary) return '临时窗';
  const regular = all
    .filter((x) => x.season === w.season && !x.isTemporary)
    .sort((a, b) => a.windowSeq - b.windowSeq);
  const idx = regular.findIndex((x) => x.windowSeq === w.windowSeq);
  return idx === 0 ? '赛季初' : idx === 1 ? '中期' : '常规窗';
}

function WindowsSection() {
  const { show, toastNode } = useToast();
  const { dateTime } = useTimeFmt();
  const queryClient = useQueryClient();
  const [season, setSeason] = useState('');
  const [seq, setSeq] = useState('');
  const [openBusy, setOpenBusy] = useState(false);
  const [declarePeriod, setDeclarePeriod] = useState(false);
  const [temporary, setTemporary] = useState(false);
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
        ...(temporary ? { temporary: true } : {}),
      });
      show(
        `窗口已开：第 ${res.season} 赛季 · 窗口 ${res.windowSeq}${res.isTemporary ? '（临时窗）' : ''}。全联盟经纪人性格重掷了 ${res.rerolled} 名球员。` +
          (res.growthPeriodDeclared ? ' 已同时宣告新成长期，里程碑重新起算。' : ''),
      );
      setSeason('');
      setSeq('');
      setDeclarePeriod(false);
      setTemporary(false);
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
      const tail = res.isTemporary ? '（临时窗）' : '';
      show(
        (res.forceSettled > 0
          ? `第 ${res.season} 赛季窗口 ${res.windowSeq}${tail} 已关闭：${res.forceSettled} 场签约谈判按已定条款强制成约。`
          : `第 ${res.season} 赛季窗口 ${res.windowSeq}${tail} 已关闭，窗尾截止处理完成。`) +
          (res.loyalty && res.loyalty.count > 0
            ? `中期窗忠诚支出扣款 ${res.loyalty.count} 队 / 合计 ${res.loyalty.total.toFixed(2)}m。`
            : ''),
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
        同一时刻只有一个窗口开着。开窗会给全联盟球员重掷经纪人性格；关窗前先处理完市场截止单，
        并要求没有待审单、没有等待匹配的激活单、没有进行中的签约谈判——除非开了 window_force_settle 参数并用强制关窗，
        未谈完的谈判会按买方已提交的条款强制成约。勾选「同时宣告新成长期」会在开窗同一批里画一条里程碑起算线。
        一个赛季最多 2 个常规窗（第 1 个是季初、第 2 个是中期）：季初与中期关窗推进效力 0.5 赛季、按合同扣工资与冠名费，中期关窗另扣忠诚支出；
        临时窗只扣富人税与维护费（维护费按本窗主场数照收），不推进效力、不扣工资、不收冠名费。
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
        <input type="checkbox" checked={temporary} onChange={(e) => setTemporary(e.target.checked)} />
        临时窗（不推进效力、不扣工资、不收冠名费；仅富人税与维护费）
      </label>
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
                <th>类型</th>
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
                  <td>{windowKindLabel(w, data.windows)}</td>
                  <td>
                    <span className={`badge ${w.status === 'open' ? 'sky' : 'gray'}`}>{WINDOW_STATUS_LABEL[w.status] ?? w.status}</span>
                  </td>
                  <td className="mono">{dateTime(w.openedAt)}</td>
                  <td className="mono">{dateTime(w.closedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ---------- 海捞暗标段（v6.50.0） ---------- */

const SEA_BATCH_LABEL: Record<string, string> = {
  sealed: '收标中',
  settling: '开标中',
  opened: '已开标',
  cancelled: '已取消',
};

const SEA_ADMIN_BID_LABEL: Record<string, string> = {
  sealed: '收标中',
  won: '胜出',
  lost: '未胜出',
  void: '已作废',
  withdrawn: '已撤回',
};

const SEA_ADMIN_HOLD_LABEL: Record<string, string> = {
  held: '冻结中',
  released: '已解冻',
  settled: '已收签入费',
};

function SeaSealedSection() {
  const { show, toastNode } = useToast();
  const { ask, promptNode } = usePrompt();
  const { dateTime } = useTimeFmt();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [wall, setWall] = useState('');

  const { data, error } = useQuery({ queryKey: ['admin', 'sea-sealed'], queryFn: () => api<SeaAdminView>('/api/admin/sea-sealed') });

  useEffect(() => {
    if (error) show(error instanceof Error ? error.message : '暗标段台账加载失败', true);
  }, [error, show]);

  // 截止输入框跟着批次回填；只在空着时填，免得每次刷新吞掉管理组正在敲的值
  const batchDeadline = data?.batch?.deadlineAt ?? null;
  useEffect(() => {
    if (batchDeadline !== null && wall === '') setWall(utcIsoToZhWall(batchDeadline));
  }, [batchDeadline, wall]);

  const reload = () => queryClient.invalidateQueries({ queryKey: ['admin', 'sea-sealed'] });
  const batch = data?.batch ?? null;
  const batchId = batch?.id;
  const settled = batch !== null && (batch.status === 'opened' || batch.status === 'cancelled');

  async function run(work: () => Promise<string>) {
    if (busy) return;
    setBusy(true);
    try {
      show(await work());
      await reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '操作失败', true);
    } finally {
      setBusy(false);
    }
  }

  const openNow = () =>
    run(async () => {
      const r = await apiPost<SeaOpenSummary>('/api/admin/sea-sealed/open', batchId === undefined ? {} : { batchId });
      return r.already
        ? '这批标已经开过了，没有重复结算。'
        : `开标完成：胜出 ${r.won} 名（已进审核队列，等审核 → 工资谈判 → 过户），未胜出 ${r.lost} 名、作废 ${r.voided} 名，冻结按结果解冻。`;
    });

  const extend = () =>
    run(async () => {
      const iso = zhWallToUtcIso(wall);
      if (iso === null) throw new Error('新截止时间填完整（北京时间，形如 2026-10-20T20:00）。');
      const r = await apiPost<SeaExtendResult>(
        '/api/admin/sea-sealed/extend',
        batchId === undefined ? { deadlineAt: iso } : { deadlineAt: iso, batchId },
      );
      setWall(utcIsoToZhWall(r.batch.deadlineAt));
      return `暗标段截止已延长到 ${dateTime(r.batch.deadlineAt)}；时刻表「海捞·暗标段」的终点同步改了，两把尺子一致。`;
    });

  const cancel = async () => {
    const note = await ask('取消本窗暗标批次的说明（会发给出标俱乐部，并进审计）：');
    if (!note) return;
    await run(async () => {
      const r = await apiPost<SeaCancelResult>(
        '/api/admin/sea-sealed/cancel',
        batchId === undefined ? { note } : { note, batchId },
      );
      return `批次已取消：${r.voided} 份密封标作废、冻结全部解冻，本窗自由身池回到常规海捞。`;
    });
  };

  return (
    <section className="card admin-section">
      <h2>海捞暗标段</h2>
      {toastNode}
      {promptNode}
      <p className="hint">
        海捞两阶段的开标口：开窗后自由身池整体进暗标批次，统一截止、价高者得（同额先出的胜出），金额与出标方在收标期内保密；
        教练侧入口在球员档案左栏。到点由到期引擎自动开标，关窗时批次仍收标也会立即开标收口（不挡关窗）。
        开标只生成待审单——签入费在审核通过时才收；胜出的进审核队列，其余冻结当场解冻。
        这里可以手动立即开标、延长暗标段（批次与时刻表终点同改）、或取消本窗批次（全部标作废并解冻）。
      </p>

      {data !== undefined && !data.enabled && (
        <p className="banner warn">
          海捞两阶段未启用（参数 sea_enabled = false）：自由身池走原来的即时海捞，暗标入口关闭，收标中的批次会被自动作废并解冻。
        </p>
      )}

      {data === undefined ? (
        <p className="muted">正在翻暗标台账…</p>
      ) : batch === null ? (
        <EmptyState>
          {data.enabled
            ? '当前窗口还没有暗标批次：到时刻表里给「海捞·暗标段」填上具体起点与终点，进段后会自动建批次。'
            : '海捞两阶段没启用，暂时不会有暗标批次。'}
        </EmptyState>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">批次</th>
                  <th>赛季 / 窗口</th>
                  <th>状态</th>
                  <th>截止（北京时间）</th>
                  <th>开标时间</th>
                  <th className="num">出标</th>
                  <th className="num">参与球员</th>
                  <th className="num">参与球队</th>
                  <th className="num">最高标（m）</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="num mono">#{batch.id}</td>
                  <td className="mono">
                    S{batch.season} 第 {batch.windowSeq} 窗
                  </td>
                  <td>
                    <span className={`badge ${batch.status === 'sealed' ? 'sky' : batch.status === 'opened' ? 'green' : 'gray'}`}>
                      {SEA_BATCH_LABEL[batch.status] ?? batch.status}
                    </span>
                  </td>
                  <td className="mono">{dateTime(batch.deadlineAt)}</td>
                  <td className="mono">{batch.openedAt === null ? '—' : dateTime(batch.openedAt)}</td>
                  <td className="num mono">{data.summary.bids}</td>
                  <td className="num mono">{data.summary.players}</td>
                  <td className="num mono">{data.summary.clubs}</td>
                  <td className="num mono">{data.summary.top.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {batch.note !== '' && <p className="muted">批次说明：{batch.note}</p>}

          <div className="inline-form">
            <ConfirmButton
              label={settled ? '重新开标（已结算）' : '立即开标'}
              confirmLabel="再点一次确认开标"
              busyLabel="开标中…"
              busy={busy}
              onConfirm={openNow}
            />
            <div className="field">
              <label htmlFor="sea-deadline">新截止时间（北京时间）</label>
              <input
                id="sea-deadline"
                className="mono"
                type="datetime-local"
                value={wall}
                disabled={settled}
                onChange={(e) => setWall(e.target.value)}
              />
            </div>
            <button className="btn" type="button" disabled={busy || settled || wall === ''} onClick={() => void extend()}>
              延长暗标段
            </button>
            <button className="btn btn-danger" type="button" disabled={busy || settled} onClick={() => void cancel()}>
              取消本窗批次
            </button>
          </div>
          {settled && <p className="muted">这一窗的批次已经结算完（{SEA_BATCH_LABEL[batch.status]}），逐标明账保留作核对。</p>}
        </>
      )}

      {data !== undefined && data.bids.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>球员</th>
                <th>出标球队</th>
                <th className="num">新违约金（m）</th>
                <th className="num">冻结（m）</th>
                <th>标状态</th>
                <th>冻结状态</th>
                <th>出标时间</th>
                <th>改标时间</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {data.bids.map((b) => (
                <tr key={b.bidId}>
                  <td>{b.playerName}</td>
                  <td>{b.clubName}</td>
                  <td className="num mono">{b.newReleaseFee.toFixed(2)}</td>
                  <td className="num mono">{(b.newReleaseFee * 0.3).toFixed(2)}</td>
                  <td>
                    <span className={`badge ${b.status === 'won' ? 'green' : b.status === 'sealed' ? 'sky' : 'gray'}`}>
                      {SEA_ADMIN_BID_LABEL[b.status] ?? b.status}
                    </span>
                  </td>
                  <td>
                    {b.holdStatus === null ? '—' : (SEA_ADMIN_HOLD_LABEL[b.holdStatus] ?? b.holdStatus)}
                  </td>
                  <td className="mono">{b.submittedAt === null ? '—' : dateTime(b.submittedAt)}</td>
                  <td className="mono">{b.updatedAt === null ? '—' : dateTime(b.updatedAt)}</td>
                  <td>{b.voidReason === '' ? '—' : b.voidReason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
