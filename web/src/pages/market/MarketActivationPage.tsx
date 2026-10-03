// 激活 /market/activation（v6.24.0 批次 C）：从海里拆出的独立页——可激活名单（模式切换 + 名字搜索）
// 与「激活 → 落首价」一条链走完。后端 v6.24.0：激活挂牌先进 5 分钟首价窗，激活方须在窗内出首价（=激活价）
// 才转公开竞价，所以激活成功后本页直接把首价表单摆出来（复用 MarketBidForm 的 activation-first 形态）。
// 证据制（v6.4.0）：激活须先上传 QQ 通知截图。需登录（路由守卫），端点是教练端点（club.squad.manage）。
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { apiPost, apiUpload, type ActivatablePlayer, type ActivationResult, type BidPlaceResult } from '../../lib/api.ts';
import { useActivatable, useMarketInvalidation, useMyClub, type ActivatableMode } from '../../lib/queries.ts';
import { useToast } from '../../lib/toast.tsx';
import { playerPath } from '../../lib/player-link.ts';
import { MarketBidForm } from '../../components/MarketBidForm.tsx';
import { MarketNav, deadlineText, money } from './shared.tsx';

/** 激活成功、待落首价的挂牌（v6.24.0：激活方须在首价窗内自己落首价） */
type PendingFirstBid = {
  playerName: string;
  listingId: number;
  askPrice: number;
  kind: 'trainee' | 'normal';
  firstBidDeadline: string;
};

export default function MarketActivationPage() {
  const { show, toastNode } = useToast();
  const { loading, isCoach, club } = useMyClub();
  const [pending, setPending] = useState<PendingFirstBid | null>(null);

  return (
    <div className="container">
      <h1>转会市场 · 激活</h1>
      {toastNode}
      <MarketNav />
      {loading ? (
        <p className="muted">正在确认你的俱乐部身份…</p>
      ) : !isCoach ? (
        <div className="card empty-state">
          <p className="muted">激活球员只对教练开放，观众视角看看就好。</p>
        </div>
      ) : club === null ? (
        <div className="card empty-state">
          <p className="muted">还没有绑定俱乐部。先到球队中心完成绑定，再来激活球员。</p>
        </div>
      ) : (
        <>
          {pending !== null && (
            <FirstBidSection
              pending={pending}
              onDone={(msg) => {
                show(msg);
                setPending(null);
              }}
              onError={(m) => show(m, true)}
            />
          )}
          <ActivateSection
            onActivated={(p) => {
              setPending(p);
              show(
                `已激活 ${p.playerName}：请在 ${deadlineText(p.firstBidDeadline, '')} 前落激活首价（表单已摆到页面上方），逾期激活作废（还占本窗激活额度）。`,
              );
            }}
            onError={(m) => show(m, true)}
          />
        </>
      )}
    </div>
  );
}

/* ---------- 落激活首价（v6.24.0：激活方一页走完「激活 → 首价」） ---------- */

function FirstBidSection({
  pending,
  onDone,
  onError,
}: {
  pending: PendingFirstBid;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const invalidateMarket = useMarketInvalidation();
  const ref = useRef<HTMLElement | null>(null);

  // 激活按钮在长表格下方，表单出现在页面上方：摆出后滚进视野（jsdom 没实现 scrollIntoView，先探测再调）
  useEffect(() => {
    const el = ref.current;
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
  }, []);

  async function placeFirstBid(amount: number) {
    try {
      const res = await apiPost<BidPlaceResult>(`/api/market/listings/${pending.listingId}/bids`, { amount });
      // v6.24.0 评审修复（P1-3）：激活首价落定只转入公开竞价，成交/匹配由截止后的结算分流决定
      onDone(
        res.matchPhase === 'bidding'
          ? `首价 ${money(amount)} m 已落定，转入公开竞价。`
          : `✓ 出价成功（${money(amount)} m），截止时刻已刷新。`,
      );
      // 挂牌转入公开竞价：在售板与我的出价一并刷新
      invalidateMarket(pending.listingId);
    } catch (err) {
      onError(err instanceof Error ? err.message : '落首价失败');
    }
  }

  return (
    <section ref={ref} className="card admin-section" aria-label="落激活首价">
      <h3>落激活首价</h3>
      <p className="hint">
        已激活 {pending.playerName}，挂牌 {money(pending.askPrice)} m：请在 {deadlineText(pending.firstBidDeadline, '')} 前落首价，
        {pending.kind === 'trainee'
          ? '落价后转入公开竞价；竞价截止后训练营合同直进管理组审核。'
          : '落价后转入公开竞价；竞价截止后进 24 小时匹配窗，等原属俱乐部决定是否匹配（基准=竞价最高价）。'}
        逾期激活作废（还占本窗激活额度）。
      </p>
      <MarketBidForm
        mode="activation-first"
        askPrice={pending.askPrice}
        nextMinBid={pending.askPrice}
        available={null}
        onBid={placeFirstBid}
      />
    </section>
  );
}

/* ---------- 激活别队球员（规则 4.4.2，GET /api/market/activatable） ---------- */

function ActivateSection({
  onActivated,
  onError,
}: {
  onActivated: (p: PendingFirstBid) => void;
  onError: (msg: string) => void;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<ActivatableMode>('all');
  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [proofTarget, setProofTarget] = useState<number | null>(null);
  const proofInputRef = useRef<HTMLInputElement | null>(null);
  const { data, isError, error } = useActivatable(mode, submitted);

  // 激活是证据制（v6.4.0）：先让教练选 QQ 通知截图 → 上传拿 key → 带 proofMediaKey 建挂牌。
  // 评审 P1-1：此前按钮只发 playerId，后端 400「要先上传 QQ 通知截图」必现，链路是断的。
  function requestActivate(p: ActivatablePlayer) {
    if (busyId !== null || p.activationFee === null) return;
    setProofTarget(p.id);
    proofInputRef.current?.click();
  }

  async function onProofChosen(file: File | null) {
    const playerId = proofTarget;
    setProofTarget(null);
    if (!file || playerId === null || busyId !== null) return;
    setBusyId(playerId);
    try {
      const up = await apiUpload<{ key: string }>('/api/media/activation', file.type, file);
      const res = await apiPost<ActivationResult>('/api/market/activations', { playerId, proofMediaKey: up.key });
      const target = data?.players.find((x) => x.id === playerId);
      // 激活生成挂牌，且首价窗已开启：把待落首价交给页面（v6.24.0，激活方须自己落首价）
      onActivated({
        playerName: target?.name ?? '球员',
        listingId: res.listingId,
        askPrice: res.askPrice,
        kind: res.kind,
        firstBidDeadline: res.firstBidDeadline,
      });
      // 激活生成新挂牌：可激活名单（两种模式）与在售市场板一并失效
      void qc.invalidateQueries({ queryKey: ['market', 'activatable'] });
      void qc.invalidateQueries({ queryKey: ['market', 'board'] });
    } catch (err) {
      onError(err instanceof Error ? err.message : '激活失败');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card admin-section">
      <h3>激活球员</h3>
      <div className="seg" role="radiogroup" aria-label="激活球员范围">
        <button type="button" className={mode === 'all' ? 'on' : ''} onClick={() => setMode('all')}>
          全部可激活
        </button>
        <button type="button" className={mode === 'trainee' ? 'on' : ''} onClick={() => setMode('trainee')}>
          仅训练营
        </button>
      </div>
      <div className="inline-form">
        <div className="field grow">
          <label htmlFor="activatable-q">按名字筛选</label>
          <input
            id="activatable-q"
            value={input}
            placeholder="输入球员名字"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setSubmitted(input.trim());
              }
            }}
          />
        </div>
        <button className="btn" type="button" onClick={() => setSubmitted(input.trim())}>
          搜索
        </button>
      </div>
      {isError ? (
        <div className="banner warn">{error instanceof Error ? error.message : '可激活名单打不开了，稍后再试'}</div>
      ) : data === undefined ? (
        <p className="muted">可激活名单还没加载出来…</p>
      ) : data.players.length === 0 ? (
        <p className="hint">没有符合条件的可激活球员。</p>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>球员</th>
                  <th>所属队</th>
                  <th>位置</th>
                  <th className="num">年龄</th>
                  <th className="num">CA</th>
                  <th className="num">PA</th>
                  <th>合同类型</th>
                  <th className="num">激活费（m）</th>
                  <th>本窗状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.players.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={playerPath(p)}>{p.name}</Link>
                    </td>
                    <td>{p.club.name}</td>
                    <td>{p.position ?? '—'}</td>
                    <td className="num mono">{p.age ?? '—'}</td>
                    <td className="num mono">{p.ca ?? '—'}</td>
                    <td className="num mono">{p.pa ?? '—'}</td>
                    <td>{p.contractType === 'trainee' ? '训练营' : '正式'}</td>
                    <td className="num mono">{money(p.activationFee)}</td>
                    <td>
                      {p.activatedThisWindow ? <span className="stamp-inline">本窗已激活</span> : p.activationFee === null ? <span className="stamp-inline">缺违约金合同</span> : <span className="muted">—</span>}
                    </td>
                    <td>
                      <button
                        className="btn btn-sm"
                        type="button"
                        disabled={busyId !== null || p.justSigned || p.activatedThisWindow || p.activationFee === null}
                        title={p.activationFee === null ? '正式合同缺违约金，先让管理组补合同' : undefined}
                        onClick={() => requestActivate(p)}
                      >
                        {busyId === p.id ? '激活中…' : '激活'}
                      </button>
                      {p.justSigned && <span className="badge sky">刚签约</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* 证据制（v6.4.0）：激活必须附 QQ 通知截图，选中文件即上传并提交 */}
          <input
            ref={proofInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: 'none' }}
            aria-label="QQ 通知截图"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              e.target.value = '';
              void onProofChosen(file);
            }}
          />
          <p className="hint">
            训练营球员激活费固定 5.00 m；正式球员按违约金与保护期计。点「激活」后先选你在 QQ 里通知对方俱乐部的截图（证据制，png / jpg / webp ≤ 5MB），上传即提交；对方如未收到通知可以举报。
            激活成功后本页会摆出首价表单：5 分钟内落首价（=激活价）才转公开竞价。
          </p>
        </>
      )}
    </section>
  );
}
