// 转会报价页（v6.3.0）：两个页签（我收到的 / 我送出的）+ 状态筛选 + 清单表格，
// 点开单条出谈判桌（事件时间线）与操作（同意 / 还价 / 拒绝 / 撤回）。
// 入口：顶栏「转会报价」+ 球员页左栏「我收到的报价」徽标（/offers?box=in）。
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { apiPost, type OfferDetailResponse, type OfferListItem, type OfferStatus } from '../lib/api.ts';
import { playerPath } from '../lib/player-link.ts';
import { useMyClub, useOfferDetail, useOffers, useOffersInvalidation } from '../lib/queries.ts';
import { useToast } from '../lib/toast.tsx';

const STATUS_BADGE: Record<OfferStatus, { label: string; cls: string }> = {
  pending: { label: '待回复', cls: 'sky' },
  accepted: { label: '已挂牌', cls: 'green' },
  rejected: { label: '被拒绝', cls: 'red' },
  withdrawn: { label: '已撤回', cls: 'gray' },
  expired: { label: '已过期', cls: 'gray' },
};

const EVENT_LABEL: Record<string, string> = {
  open: '送出报价',
  counter: '还价',
  accept: '同意挂牌',
  reject: '拒绝',
  withdraw: '撤回',
  expire: '过期',
  auto_accept: '名单自动同意',
  auto_reject: '名单自动拒',
};

function money(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : v.toFixed(2);
}

function shortTime(iso: string): string {
  return iso.slice(5, 16).replace('T', ' ');
}

export default function Offers() {
  const [params, setParams] = useSearchParams();
  const box = params.get('box') === 'out' ? 'out' : 'in';
  const status = params.get('status') === 'all' ? 'all' : 'pending';
  // isCoach 从 useAuth 角色同步取（club?.isCoach 要等 /me/club 回来，加载帧会误显「只对教练开放」）
  const { isCoach } = useMyClub();
  const { show } = useToast();
  const qc = useQueryClient();
  const invalidateOffers = useOffersInvalidation();

  const list = useOffers(box, status, isCoach);
  const [openId, setOpenId] = useState<number | null>(null);
  const detail = useOfferDetail(openId, isCoach);
  const [counterDraft, setCounterDraft] = useState('');
  const [busy, setBusy] = useState(false);

  if (!isCoach) {
    return (
      <div className="container">
        <h1>转会报价</h1>
        <div className="card empty-state">
          <p className="muted">这里只对教练开放。先绑定俱乐部，再来谈报价。</p>
        </div>
      </div>
    );
  }

  const items = list.data?.items ?? null;
  const pendingMine = list.data?.pendingMine ?? 0;

  function switchBox(next: 'in' | 'out') {
    setParams((p) => {
      const np = new URLSearchParams(p);
      np.set('box', next);
      return np;
    });
    setOpenId(null);
  }

  function switchStatus(next: 'pending' | 'all') {
    setParams((p) => {
      const np = new URLSearchParams(p);
      np.set('status', next);
      return np;
    });
    setOpenId(null);
  }

  async function act(offer: OfferListItem, action: 'accept' | 'reject' | 'withdraw' | 'counter', amount?: number) {
    if (busy) return;
    setBusy(true);
    try {
      if (action === 'counter') {
        const r = await apiPost<{ ok: boolean; amount: number }>(`/api/offers/${offer.id}/counter`, { amount });
        show(`还价已送出：${r.amount.toFixed(2)} m，等对方表态。`);
        setCounterDraft('');
      } else {
        await apiPost(`/api/offers/${offer.id}/${action}`, {});
        show(
          action === 'accept'
            ? '已同意，球员自动挂牌，你的价锁成领先出价。'
            : action === 'reject'
              ? '已拒绝，冻结已退回对方。'
              : '已撤回，冻结资金已退回。',
        );
      }
      invalidateOffers();
      void qc.invalidateQueries({ queryKey: ['offers', 'detail'] });
    } catch (err) {
      show(err instanceof Error ? err.message : '操作失败', true);
    } finally {
      setBusy(false);
    }
  }

  const detailData = detail.data ?? null;

  return (
    <div className="container">
      <h1>转会报价</h1>
      <p className="hint">
        私下议价：对别队真人球员送报价，双方轮流出价，<span className="mono">同意</span>即自动挂牌并把报价方锁成领先出价；
        报价即冻结资金，了结（成交 / 拒绝 / 撤回 / 过期）后自动退回。进转会名单的球员达线自动同意、低于自动拒。
      </p>

      <div className="seg" role="radiogroup" aria-label="报价页签">
        <button type="button" className={box === 'in' ? 'on' : ''} onClick={() => switchBox('in')}>
          我收到的{pendingMine > 0 && box === 'in' ? `（${pendingMine} 待处理）` : ''}
        </button>
        <button type="button" className={box === 'out' ? 'on' : ''} onClick={() => switchBox('out')}>
          我送出的
        </button>
        <span style={{ width: 12 }} aria-hidden="true" />
        <button type="button" className={status === 'pending' ? 'on' : ''} onClick={() => switchStatus('pending')}>
          待处理
        </button>
        <button type="button" className={status === 'all' ? 'on' : ''} onClick={() => switchStatus('all')}>
          全部
        </button>
      </div>

      {list.isError && <div className="banner bad">{list.error instanceof Error ? list.error.message : '清单拉取失败'}</div>}
      {items === null && list.isPending && <p className="muted">正在翻报价夹…</p>}
      {items !== null && items.length === 0 && (
        <div className="card empty-state">
          <p className="muted">
            {box === 'in' ? '还没有收到的报价。挂到转会区、或把球员放进转会名单会更容易被盯上。' : '还没有送出的报价。去球员页对别队的球员点「报价」。'}
          </p>
        </div>
      )}

      {items !== null && items.length > 0 && (
        <section className="card admin-section">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>球员</th>
                  <th>{box === 'in' ? '买方' : '卖家'}</th>
                  <th className="num">当前价（m）</th>
                  <th className="num">轮次</th>
                  <th>轮到谁</th>
                  <th>状态</th>
                  <th>最近动作</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {items.map((o) => {
                  const badge = STATUS_BADGE[o.status];
                  return (
                    <tr key={o.id} className={openId === o.id ? 'row-open' : undefined}>
                      <td>
                        <Link to={playerPath(o.player)}>{o.player.name}</Link>
                      </td>
                      <td>{o.counterpart.name}</td>
                      <td className="num mono">{money(o.amount)}</td>
                      <td className="num mono">R{o.round}</td>
                      <td>
                        {o.status === 'pending' ? (
                          o.myTurn ? (
                            <span className="badge gold">轮到你</span>
                          ) : (
                            <span className="muted">等对方</span>
                          )
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <span className={`badge ${badge.cls}`}>{badge.label}</span>
                      </td>
                      <td className="muted">{shortTime(o.updatedAt)}</td>
                      <td>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpenId(openId === o.id ? null : o.id)}>
                          {openId === o.id ? '收起' : '谈判桌'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {list.data?.nextCursor && (
            <p className="muted">还有更早的单子没列出来（清单按最近动作排，只列 50 条；更早的用「全部」筛选往后翻）。</p>
          )}
        </section>
      )}

      {openId !== null && (
        <OfferDesk
          detail={detailData}
          loading={detail.isPending}
          error={detail.error instanceof Error ? detail.error.message : null}
          busy={busy}
          counterDraft={counterDraft}
          onCounterDraft={setCounterDraft}
          onAct={act}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

// 谈判桌：单据信息 + 事件时间线 + 操作按钮（轮到我：同意/还价；卖方可拒；买方可撤）
function OfferDesk({
  detail,
  loading,
  error,
  busy,
  counterDraft,
  onCounterDraft,
  onAct,
  onClose,
}: {
  detail: OfferDetailResponse | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  counterDraft: string;
  onCounterDraft: (v: string) => void;
  onAct: (offer: OfferListItem, action: 'accept' | 'reject' | 'withdraw' | 'counter', amount?: number) => Promise<void>;
  onClose: () => void;
}) {
  if (loading) {
    return (
      <section className="card">
        <p className="muted">正在摊开谈判桌…</p>
      </section>
    );
  }
  if (error || !detail) {
    return (
      <section className="card">
        <div className="banner bad">{error ?? '这条报价看不到了'}</div>
      </section>
    );
  }
  const { offer, events } = detail;
  const pending = offer.status === 'pending';
  const canAccept = pending && offer.myTurn;
  const canReject = pending && offer.role === 'seller';
  const canWithdraw = pending && offer.role === 'buyer';
  const counterValue = Number(counterDraft);
  return (
    <section className="card admin-section">
      <h3>
        谈判桌 · {offer.player.name}
        {offer.listingId !== null && (
          <span className="badge green">已挂牌 #{offer.listingId}</span>
        )}
      </h3>
      <div className="side-row">
        <span className="attr-name">买方</span>
        <span>{offer.buyerClub.name}</span>
      </div>
      <div className="side-row">
        <span className="attr-name">卖家</span>
        <span>{offer.sellerClub.name}</span>
      </div>
      <div className="side-row">
        <span className="attr-name">当前有效价</span>
        <span className="mono">{money(offer.amount)} m（首报 {money(offer.initAmount)} m · R{offer.round}）</span>
      </div>
      {offer.note && (
        <div className="side-row">
          <span className="attr-name">最近附言</span>
          <span>{offer.note}</span>
        </div>
      )}

      {events.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>动作</th>
                <th>谁</th>
                <th className="num">金额（m）</th>
                <th>附言</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={i}>
                  <td className="mono">{shortTime(e.at)}</td>
                  <td>{EVENT_LABEL[e.kind] ?? e.kind}</td>
                  <td>{e.actor ? e.actor.name : '系统'}</td>
                  <td className="num mono">{money(e.amount)}</td>
                  <td className="muted">{e.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pending && (
        <div className="inline-form">
          {canAccept && (
            <label className="field">
              <span>还价（m，须严格高于当前价）</span>
              <input
                className="mono"
                inputMode="decimal"
                placeholder={(offer.amount + 1).toFixed(2)}
                value={counterDraft}
                onChange={(e) => onCounterDraft(e.target.value.replace(/[^0-9.]/g, ''))}
              />
            </label>
          )}
          {canAccept && (
            <button
              type="button"
              className="btn"
              disabled={busy || !Number.isFinite(counterValue) || counterValue <= offer.amount}
              onClick={() => void onAct(offer, 'counter', counterValue)}
            >
              还价
            </button>
          )}
          {canAccept && (
            <button type="button" className="btn" disabled={busy} onClick={() => void onAct(offer, 'accept')}>
              同意（{money(offer.amount)} m，同意即挂牌）
            </button>
          )}
          {canReject && (
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void onAct(offer, 'reject')}>
              拒绝
            </button>
          )}
          {canWithdraw && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void onAct(offer, 'withdraw')}>
              撤回报价
            </button>
          )}
          {!canAccept && !canReject && !canWithdraw && <p className="muted">还没轮到你，等对方表态。</p>}
        </div>
      )}

      <button type="button" className="btn btn-ghost" onClick={onClose}>
        收起谈判桌
      </button>
    </section>
  );
}
