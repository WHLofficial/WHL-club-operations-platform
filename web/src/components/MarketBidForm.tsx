// 出价表单（v6.4.0 改动 6：从 MarketBoardPage 的 DetailSection 抽出共享）——
// 普通竞价（≥ nextMinBid、步长 0.5）与激活首价（金额固定为挂牌价）两形态；
// 转会区详情与球员页左栏「别队挂牌」出价途径共用，提交统一走 onBid 回调。
import { useState } from 'react';
import { money } from '../pages/market/shared.tsx';

export function MarketBidForm({
  mode,
  askPrice,
  nextMinBid,
  available,
  onBid,
}: {
  mode: 'normal' | 'activation-first';
  askPrice: number;
  nextMinBid: number;
  /** 可支配资金（可用时展示提示；左栏场景没有现成余额就传 null） */
  available: number | null;
  onBid: (amount: number) => Promise<void>;
}) {
  const [amount, setAmount] = useState(String(nextMinBid));
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      await onBid(mode === 'activation-first' ? askPrice : Number(amount));
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'activation-first') {
    return (
      <div className="inline-form">
        <button className="btn" type="button" disabled={busy} onClick={submit}>
          {busy ? '出价中…' : `落激活首价（${money(askPrice)} m）`}
        </button>
        <span className="hint">激活金额固定，出价即冻结。</span>
      </div>
    );
  }

  return (
    <div className="inline-form">
      <div className="field">
        <label htmlFor="bid-amount">出价（m）</label>
        <input
          id="bid-amount"
          className="mono"
          type="number"
          min={nextMinBid}
          step="0.5"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <button className="btn" type="button" disabled={busy || Number(amount) < nextMinBid} onClick={submit}>
        {busy ? '出价中…' : `出价（至少 ${nextMinBid.toFixed(2)} m）`}
      </button>
      <span className="hint">出价即冻结资金{available !== null ? <>，当前可支配 {money(available)} m</> : null}。</span>
    </div>
  );
}
