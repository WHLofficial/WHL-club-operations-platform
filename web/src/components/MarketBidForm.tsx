// 出价表单（v6.4.0 改动 6：从 MarketBoardPage 的 DetailSection 抽出共享）——
// 普通竞价（≥ nextMinBid 的整数 m，v6.24.0 起）与激活首价（金额固定为挂牌价）两形态；
// 转会区详情与球员页左栏「别队挂牌」出价途径共用，提交统一走 onBid 回调。
import { useEffect, useRef, useState } from 'react';
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
  // 预填跟随（v6.24.0）：服务端的 nextMinBid 变化（有人出了更高的价）时同步输入框；
  // 用户手改过就不再覆盖（touchedRef，TC-B06）
  const touchedRef = useRef(false);
  useEffect(() => {
    if (!touchedRef.current) setAmount(String(nextMinBid));
  }, [nextMinBid]);

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
          {busy ? '出价中…' : `落激活首价（${money(askPrice)}m）`}
        </button>
        <span className="hint">激活金额固定，出价即冻结。</span>
      </div>
    );
  }

  // 整数校验（v6.24.0）：120.5 这类非整数出价前端直接拦下，不发请求（TC-B05）
  const integerOk = /^[1-9]\d*$/.test(amount);

  return (
    <div className="inline-form">
      <div className="field">
        <label htmlFor="bid-amount">出价（m）</label>
        <input
          id="bid-amount"
          className="mono"
          type="number"
          min={nextMinBid}
          step="1"
          value={amount}
          onChange={(e) => {
            touchedRef.current = true;
            setAmount(e.target.value);
          }}
        />
      </div>
      <button className="btn" type="button" disabled={busy || !integerOk || Number(amount) < nextMinBid} onClick={submit}>
        {busy ? '出价中…' : `出价（至少 ${money(nextMinBid)}m）`}
      </button>
      <span className="hint">出价即冻结资金{available !== null ? <>，当前可支配 {money(available)}m</> : null}。</span>
    </div>
  );
}
