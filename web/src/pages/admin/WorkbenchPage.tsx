// 管理端 · 审核工作台（v6.68.2 期 C，设计文档 §6）
//
// 这一页取代「五个按钮 + 一个 ID 框」的干预方式：五张在途表一次拉全，每行只给它此刻能做的
// 动作，原因框照旧必填（写操作全部走现有 admin 端点与审计，本页不新增写接口）。
// 审核队列仍留在 /admin/market（Q3 裁决），本页只管在途单据与处置。
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  api,
  apiPost,
  type WorkbenchInFlight,
  type WorkbenchSearchHit,
  type WorkbenchSearchResult,
} from '../../lib/api.ts';
import { useToast } from '../../lib/toast.tsx';
import { usePrompt } from '../../components/PromptDialog.tsx';
import { IdTag } from '../../components/IdTag.tsx';
import { playerPath } from '../../lib/player-link.ts';
import EmptyState from '../../components/EmptyState.tsx';
import { useTimeFmt } from '../../lib/datetime.ts';

// 阶段/状态的中文标签：转账状态机与挂牌状态机是两套值域，混在一个字典里会撞名（如 both 有 listed）
const LISTING_STATUS: Record<string, string> = {
  listed: '待出价',
  bidding: '竞价中',
  matched_pending: '等待匹配',
  pending_review: '待审核',
};
const TRANSFER_STATUS: Record<string, string> = {
  pending_review: '待审核',
  signing: '签约谈判',
};
const TRANSFER_TYPE: Record<string, string> = {
  transfer: '转会',
  free_agent: '海捞',
  match: '匹配',
  forced_auction: '强制拍卖',
  rc_change: '续约',
  promotion: '青训提拔',
  termination: '解约',
};

function money(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${v.toFixed(2)}m`;
}

export default function WorkbenchPage() {
  const [includeCpu, setIncludeCpu] = useState(false);
  const qc = useQueryClient();
  const { show, toastNode } = useToast();
  const { ask, promptNode } = usePrompt();
  const fmt = useTimeFmt();

  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');

  // 搜索停顿 300ms 触发（§6.2）：输入过程中不打后端
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(timer);
  }, [q]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-workbench', includeCpu],
    queryFn: () => api<WorkbenchInFlight>(`/api/admin/workbench/in-flight?cpu=${includeCpu ? 1 : 0}`),
  });

  const search = useQuery({
    queryKey: ['admin-workbench-search', debounced],
    enabled: debounced !== '',
    queryFn: () => api<WorkbenchSearchResult>(`/api/admin/workbench/search?q=${encodeURIComponent(debounced)}`),
  });

  const reload = () => qc.invalidateQueries({ queryKey: ['admin-workbench'] });

  async function run(path: string, label: string, needReason: boolean): Promise<void> {
    let body: Record<string, unknown> = {};
    if (needReason) {
      const reason = await ask(`${label}的原因（会进审计）：`);
      if (!reason) return;
      body = { reason };
    }
    try {
      await apiPost(path, body);
      show(`${label}：已执行`);
      await reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '处置失败', true);
    }
  }

  async function openProof(listingId: number): Promise<void> {
    // 先同步开一个空窗：await 之后再 window.open 会被浏览器的弹窗拦截器拦掉（点击手势已经用掉了）。
    // 不用 window.open(url, '_blank', 'noopener') —— 带 noopener 时返回值是 null，后面的 catch 就关不掉空窗了。
    const win = window.open('', '_blank');
    if (win) win.opener = null;
    try {
      const r = await api<{ url: string }>(`/api/admin/workbench/proof/${listingId}`);
      if (win) win.location.href = r.url;
      else window.open(r.url, '_blank', 'noopener');
    } catch (err) {
      win?.close();
      show(err instanceof Error ? err.message : '取凭证失败', true);
    }
  }

  // 搜索命中后跳到对应表并展开该行：工作台没有详情页，定位+高亮就是「展开」
  const [hit, setHit] = useState<{ kind: string; id: number } | null>(null);
  const hitClass = (kind: string, id: number) => (hit?.kind === kind && hit.id === id ? 'row-hit' : undefined);

  const counts = data?.counts;
  const hiddenTotal = data ? data.hidden.listings + data.hidden.bids + data.hidden.sessions + data.hidden.transfers : 0;
  const cpuNote = includeCpu ? '含 CPU 参与方' : `已隐藏 CPU 参与方 ${hiddenTotal} 条（勾选可显示）`;
  const capped = useMemo(() => Object.entries(counts ?? {}).some(([, n]) => n >= 50), [counts]);

  return (
    <div className="admin-page">
      <section className="card">
        <h2>审核工作台</h2>
        <p className="hint">
          全联盟在途单据：挂牌、活跃出价、进行中谈判、待审/签约中的转会、强拍活动。每行只给此刻能做的动作，
          全部要填原因并进审计。要批准/驳回转会请去 <Link to="/admin/market">转会页的审核队列</Link>（支持批选与键盘）。
        </p>

        <div className="inline-form">
          <label className="field grow">
            搜索
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="球员名 / 俱乐部名 / 任意单据 ID（挂牌、出价、谈判、转会、球员、俱乐部）"
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={includeCpu} onChange={(e) => setIncludeCpu(e.target.checked)} /> 含 CPU 参与方
          </label>
          <button className="btn btn-sm" type="button" onClick={() => void reload()}>
            刷新
          </button>
        </div>
        <p className="hint muted">
          {cpuNote}；每表最多 50 条，按最急的排在前{capped ? '（有表已到上限，先处理再看）' : ''}。
        </p>

        {debounced !== '' && (
          <div className="workbench-search">
            {search.isLoading && <p className="hint muted">搜索中…</p>}
            {search.error && <p className="form-error">{(search.error as Error).message}</p>}
            {search.data?.results.length === 0 && !search.isLoading && <p className="hint muted">没有匹配的球员、俱乐部或单据。</p>}
            {search.data && search.data.results.length > 0 && (
              <ul className="workbench-hits">
                {search.data.results.map((h: WorkbenchSearchHit) => (
                  <li key={`${h.kind}-${h.id}`}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        setHit({ kind: h.kind, id: h.id });
                        // 命中俱乐部/球员这类没有在途表的对象：只提示，不假装能展开
                        if (h.kind === 'player') window.open(playerPath({ id: h.id }), '_blank', 'noopener');
                      }}
                    >
                      {h.label}
                    </button>
                    <span className="muted">
                      {h.kind === 'negotiation' ? '谈判' : h.kind === 'transfer' ? '转会' : h.kind === 'listing' ? '挂牌' : h.kind === 'bid' ? '出价' : h.kind === 'player' ? '球员' : '俱乐部'} #{h.id}
                      {h.sublabel ? ` · ${h.sublabel}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {isLoading && <p className="hint">加载中…</p>}
      {error && <p className="form-error">{(error as Error).message}</p>}

      {data && (
        <>
          <section className="card">
            <h3>在途挂牌 · {counts?.listings ?? 0} 条</h3>
            {data.listings.length === 0 ? (
              <EmptyState>没有在途挂牌——成交或撤下后会从这里消失。</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>编号</th>
                      <th>球员</th>
                      <th>卖方</th>
                      <th>类型 / 阶段</th>
                      <th className="num">挂单价</th>
                      <th className="num">最高价</th>
                      <th>截止</th>
                      <th>凭证</th>
                      <th>动作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.listings.map((l) => (
                      <tr key={l.id} className={hitClass('listing', l.id)}>
                        <td>
                          <IdTag kind="挂牌" value={l.id} />
                        </td>
                        <td>
                          {l.playerFcId !== null ? <Link to={playerPath({ id: l.playerId, fcId: l.playerFcId })}>{l.playerName}</Link> : l.playerName}
                        </td>
                        <td>
                          {l.sellerClubId !== null ? `${l.sellerClubName} #${l.sellerClubId}` : l.sellerClubName}
                        </td>
                        <td>
                          {l.type === 'activation' ? '激活' : l.type === 'forced' ? '强拍' : '挂牌'} ·{' '}
                          {LISTING_STATUS[l.status] ?? l.status}
                          {l.bidPaused ? <span className="badge warn">已暂停出价</span> : null}
                        </td>
                        <td className="num mono">{money(l.askPrice)}</td>
                        <td className="num mono">
                          {money(l.highestBid)}
                          <span className="muted"> ({l.bidCount})</span>
                        </td>
                        <td className="mono">{l.deadlineAt ? fmt.dateTime(l.deadlineAt) : '—'}</td>
                        <td>{l.hasProof ? <button className="btn btn-sm" type="button" onClick={() => void openProof(l.id)}>凭证</button> : '—'}</td>
                        <td className="actions-cell">
                          <button
                            className="btn btn-sm"
                            type="button"
                            onClick={() =>
                              void run(
                                `/api/admin/market/listings/${l.id}/${l.bidPaused ? 'resume-bid' : 'pause-bid'}`,
                                l.bidPaused ? '恢复出价' : '暂停出价',
                                false,
                              )
                            }
                          >
                            {l.bidPaused ? '恢复出价' : '暂停出价'}
                          </button>
                          <button className="btn btn-sm" type="button" onClick={() => void run(`/api/admin/market/listings/${l.id}/force-settle`, '强制送审', true)}>
                            强制送审
                          </button>
                          <button className="btn btn-sm danger" type="button" onClick={() => void run(`/api/admin/market/listings/${l.id}/force-void`, '强制作废', true)}>
                            强制作废
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h3>活跃出价 · {counts?.bids ?? 0} 条</h3>
            {data.bids.length === 0 ? (
              <EmptyState>没有活跃出价——被超出、撤回或结算后就不再是活跃状态。</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>编号</th>
                      <th>球员</th>
                      <th>出价方</th>
                      <th className="num">金额</th>
                      <th>挂牌</th>
                      <th>时间</th>
                      <th>动作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.bids.map((b) => (
                      <tr key={b.id} className={hitClass('bid', b.id)}>
                        <td>
                          <IdTag kind="出价" value={b.id} />
                        </td>
                        <td>
                          {b.playerFcId !== null ? <Link to={playerPath({ id: b.playerId, fcId: b.playerFcId })}>{b.playerName}</Link> : b.playerName}
                        </td>
                        <td>
                          {b.clubName} #{b.clubId}
                        </td>
                        <td className="num mono">{money(b.amount)}</td>
                        <td>
                          <IdTag kind="挂牌" value={b.listingId} />
                        </td>
                        <td className="mono">{fmt.dateTime(b.createdAt)}</td>
                        <td className="actions-cell">
                          <button className="btn btn-sm danger" type="button" onClick={() => void run(`/api/admin/market/bids/${b.id}/void`, '撤销出价', true)}>
                            撤销出价
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h3>进行中谈判 · {counts?.sessions ?? 0} 条</h3>
            {data.sessions.length === 0 ? (
              <EmptyState>没有进行中的谈判——成约、作废或静默超时后会从这里消失。</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>编号</th>
                      <th>球员</th>
                      <th>买方</th>
                      <th>转会</th>
                      <th className="num">违约金</th>
                      <th className="num">预期工资</th>
                      <th className="num">轮次</th>
                      <th>静默作废</th>
                      <th>动作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sessions.map((s) => (
                      <tr key={s.id} className={hitClass('negotiation', s.id)}>
                        <td>
                          <IdTag kind="谈判" value={s.id} />
                        </td>
                        <td>
                          {s.playerFcId !== null ? <Link to={playerPath({ id: s.playerId, fcId: s.playerFcId })}>{s.playerName}</Link> : s.playerName}
                        </td>
                        <td>
                          {s.clubName} #{s.clubId}
                        </td>
                        <td>
                          <IdTag kind="转会" value={s.transferId} />
                        </td>
                        <td className="num mono">{s.releaseFee === null ? <span className="muted">未定</span> : money(s.releaseFee)}</td>
                        <td className="num mono">{money(s.expectedWage)}</td>
                        <td className="num">{s.attemptCount}</td>
                        <td className="mono">{s.expiryAnchorAt ? fmt.dateTime(s.expiryAnchorAt) : '—'}</td>
                        <td className="actions-cell">
                          <button className="btn btn-sm" type="button" onClick={() => void run(`/api/admin/negotiations/${s.id}/force-sign`, '强制成交', true)}>
                            强制成交
                          </button>
                          <button className="btn btn-sm danger" type="button" onClick={() => void run(`/api/admin/negotiations/${s.id}/void`, '作废谈判', true)}>
                            作废谈判
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h3>待审 / 签约中转会 · {counts?.transfers ?? 0} 条</h3>
            {data.transfers.length === 0 ? (
              <EmptyState>没有待处理的转会——审核通过、被驳回或成约后会从这里消失。</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>编号</th>
                      <th>球员</th>
                      <th>双方</th>
                      <th>类型 / 阶段</th>
                      <th className="num">金额</th>
                      <th>提交</th>
                      <th>动作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.transfers.map((t) => (
                      <tr key={t.id} className={hitClass('transfer', t.id)}>
                        <td>
                          <IdTag kind="转会" value={t.id} />
                        </td>
                        <td>
                          {t.playerFcId !== null ? <Link to={playerPath({ id: t.playerId, fcId: t.playerFcId })}>{t.playerName}</Link> : t.playerName}
                        </td>
                        <td>
                          {t.fromClubId !== null ? `${t.fromName} #${t.fromClubId}` : t.fromName} → {t.toClubId !== null ? `${t.toName} #${t.toClubId}` : t.toName}
                        </td>
                        <td>
                          {TRANSFER_TYPE[t.type] ?? t.type} · {TRANSFER_STATUS[t.status] ?? t.status}
                        </td>
                        <td className="num mono">{money(t.fee)}</td>
                        <td className="mono">{fmt.dateTime(t.createdAt)}</td>
                        <td className="actions-cell">
                          <Link className="btn btn-sm" to={`/admin/market?entity=transfer&id=${t.id}`}>
                            去审核
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h3>强拍活动 · {counts?.forced ?? 0} 条</h3>
            {data.forced.length === 0 ? (
              <EmptyState>没有进行中的强制拍卖——强拍在转会页的「强制拍卖」区发起。</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>编号</th>
                      <th>球员</th>
                      <th>原属</th>
                      <th>阶段</th>
                      <th className="num">起拍价</th>
                      <th className="num">最高价</th>
                      <th>截止</th>
                      <th>动作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.forced.map((f) => (
                      <tr key={f.listingId} className={hitClass('listing', f.listingId)}>
                        <td>
                          <IdTag kind="挂牌" value={f.listingId} />
                        </td>
                        <td>
                          {f.playerFcId !== null ? <Link to={playerPath({ id: f.playerId, fcId: f.playerFcId })}>{f.playerName}</Link> : f.playerName}
                        </td>
                        <td>{f.sellerClubId !== null ? `${f.sellerClubName} #${f.sellerClubId}` : f.sellerClubName}</td>
                        <td>
                          {LISTING_STATUS[f.status] ?? f.status}
                          {f.bidPaused ? <span className="badge warn">已暂停出价</span> : null}
                        </td>
                        <td className="num mono">{money(f.askPrice)}</td>
                        <td className="num mono">{money(f.highestBid)}</td>
                        <td className="mono">{f.deadlineAt ? fmt.dateTime(f.deadlineAt) : '—'}</td>
                        <td className="actions-cell">
                          <button
                            className="btn btn-sm"
                            type="button"
                            onClick={() =>
                              void run(
                                `/api/admin/market/listings/${f.listingId}/${f.bidPaused ? 'resume-bid' : 'pause-bid'}`,
                                f.bidPaused ? '恢复出价' : '暂停出价',
                                false,
                              )
                            }
                          >
                            {f.bidPaused ? '恢复出价' : '暂停出价'}
                          </button>
                          <button className="btn btn-sm" type="button" onClick={() => void run(`/api/admin/market/listings/${f.listingId}/force-settle`, '强制送审', true)}>
                            强制送审
                          </button>
                          <button className="btn btn-sm" type="button" onClick={() => void run(`/api/admin/forced-auctions/${f.listingId}/cancel`, '取消强拍', true)}>
                            取消强拍
                          </button>
                          <button className="btn btn-sm danger" type="button" onClick={() => void run(`/api/admin/market/listings/${f.listingId}/force-void`, '强制作废', true)}>
                            强制作废
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {toastNode}
      {promptNode}
    </div>
  );
}
