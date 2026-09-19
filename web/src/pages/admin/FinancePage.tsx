// 管理端 · 财政页：期初余额导入（幂等）+ 手动记账（§7.1 / §9.1 奖金模板）
// （原 Admin.tsx 两 section，增量 15 拆分；commit 3 数据层转 TanStack Query）
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiPost, MANUAL_LEDGER_KINDS, type ManualLedgerResult, type OpeningImportResult } from '../../lib/api.ts';
import { ADMIN_CLUBS_KEY, fetchAdminClubs } from '../../lib/adminQueries.ts';
import { useToast } from '../../lib/toast.tsx';

export default function FinancePage() {
  return (
    <div className="admin-page">
      <OpeningBalanceSection />
      <ManualLedgerSection />
    </div>
  );
}

function OpeningBalanceSection() {
  const { show, toastNode } = useToast();
  const { data: clubs = [] } = useQuery({ queryKey: ADMIN_CLUBS_KEY, queryFn: fetchAdminClubs });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OpeningImportResult | null>(null);

  const parsed = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const [idPart, balancePart] = line.split(/[,，]/);
      return { clubId: Number(idPart?.trim()), balance: Number(balancePart?.trim()) };
    });
  const valid = parsed.every((r) => Number.isInteger(r.clubId) && r.clubId > 0 && Number.isFinite(r.balance) && r.balance >= 0);
  const clubName = (id: number) => clubs.find((c) => c.id === id)?.name ?? `#${id}`;

  async function runImport() {
    if (busy || !valid) return;
    setBusy(true);
    try {
      const res = await apiPost<OpeningImportResult>('/api/admin/ledger/opening-import', { rows: parsed });
      setResult(res);
      show(res.written > 0 ? '期初余额已入账。' : '这批都已经导入过了，全部跳过。');
    } catch (err) {
      show(err instanceof Error ? err.message : '导入失败', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card admin-section">
      <h2>期初余额导入</h2>
      {toastNode}
      <p className="hint">
        一行一支俱乐部，写「俱乐部ID, 余额（m）」。已有的期初记录不会被重复导入。
        {clubs.length > 0 && <> 现在登记在册：{clubs.map((c) => `${c.name} #${c.id}`).join('、')}。</>}
      </p>
      <label className="field">
        余额清单
        <textarea
          rows={4}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResult(null);
          }}
          placeholder={'1, 120.5\n2, 80'}
        />
      </label>
      {text.trim() !== '' && valid && parsed.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>俱乐部</th>
                <th className="num">期初余额</th>
              </tr>
            </thead>
            <tbody>
              {parsed.map((r, i) => (
                <tr key={`${r.clubId}-${i}`}>
                  <td>{clubName(r.clubId)}</td>
                  <td className="num mono">{r.balance.toFixed(2)} m</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {text.trim() !== '' && !valid && <p className="error-msg">格式不对：每行「俱乐部ID, 余额」，余额是非负数字。</p>}
      {result && (
        <div className="banner info">
          入账 {result.written} 支俱乐部，跳过 {result.skipped} 支（此前已导入）。
        </div>
      )}
      <button className="btn" type="button" disabled={busy || !valid || parsed.length === 0 || text.trim() === ''} onClick={runImport}>
        {busy ? '入账中…' : '导入期初余额'}
      </button>
    </section>
  );
}

/* ---------- 手动记账兜底（§7.1 manual_adjust / prize_*，§9.1 奖金模板） ---------- */

function ManualLedgerSection() {
  const { show, toastNode } = useToast();
  const { data: clubs = [] } = useQuery({ queryKey: ADMIN_CLUBS_KEY, queryFn: fetchAdminClubs });
  const [clubId, setClubId] = useState('');
  const [kind, setKind] = useState(MANUAL_LEDGER_KINDS[0]!.value);
  const [amountText, setAmountText] = useState('');
  const [memo, setMemo] = useState('');
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ManualLedgerResult | null>(null);

  const kindDef = MANUAL_LEDGER_KINDS.find((k) => k.value === kind);
  const amount = Number(amountText);
  const amountValid = Number.isFinite(amount) && amount !== 0 && (kind === 'manual_adjust' || amount > 0);
  const valid = amountValid && memo.trim() !== '' && clubId !== '';

  function pickKind(v: string) {
    setKind(v);
    setArmed(false);
    setResult(null);
    // 奖金模板选赛事类型自动带参考值（§9.1），可改
    const def = MANUAL_LEDGER_KINDS.find((k) => k.value === v);
    if (def?.reference !== undefined) setAmountText(String(def.reference));
  }

  async function submit() {
    if (busy || !armed || !valid) return;
    setBusy(true);
    try {
      const res = await apiPost<ManualLedgerResult>('/api/admin/ledger/manual', {
        clubId: Number(clubId),
        kind,
        amount,
        memo: memo.trim(),
      });
      setResult(res);
      show('已入账，流水账里能查到。');
      setArmed(false);
      setAmountText('');
      setMemo('');
    } catch (err) {
      show(err instanceof Error ? err.message : '记账失败', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card admin-section">
      <h2>手动记账</h2>
      {toastNode}
      <p className="hint">
        奖金兜底：P0 阶段比赛奖金在这里按模板手动入账（金额已按 §9.1 预填，可改）；冲账纠错选「手动调整」用负数。
      </p>
      <div className="inline-form">
        <label className="field">
          俱乐部
          <select
            value={clubId}
            onChange={(e) => {
              setClubId(e.target.value);
              setArmed(false);
              setResult(null);
            }}
          >
            <option value="">选俱乐部…</option>
            {clubs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} #{c.id}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          类型
          <select value={kind} onChange={(e) => pickKind(e.target.value)}>
            {MANUAL_LEDGER_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          金额（m，正入账负出账）
          <input
            value={amountText}
            onChange={(e) => {
              setAmountText(e.target.value);
              setArmed(false);
              setResult(null);
            }}
            placeholder={kind === 'manual_adjust' ? '-5 或 3.5' : '8.5'}
          />
        </label>
      </div>
      {kindDef?.reference !== undefined && <p className="hint">金额已按 §9.1 模板预填 {kindDef.reference} m，可改。</p>}
      <label className="field">
        备注（写清来由，方便对账）
        <textarea
          rows={2}
          value={memo}
          onChange={(e) => {
            setMemo(e.target.value);
            setArmed(false);
            setResult(null);
          }}
          placeholder={kind === 'manual_adjust' ? '例：冲正 #123 重复记的一笔转会税' : '例：2027 赛季顶级联赛第 5 轮胜场奖金'}
        />
      </label>
      {amountText !== '' && !amountValid && (
        <p className="error-msg">{kind === 'manual_adjust' ? '金额要是不为 0 的数字。' : '奖金只能入账，要冲账请选「手动调整」用负数。'}</p>
      )}
      {result && (
        <div className="banner info">已入账。该俱乐部当前余额 {result.balance.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} m。</div>
      )}
      <button
        className={`btn${armed ? ' btn-armed' : ''}`}
        type="button"
        disabled={busy || !valid}
        onClick={() => (armed ? submit() : setArmed(true))}
      >
        {busy ? '记账中…' : armed ? '确认入账（再点一次）' : '记这笔账'}
      </button>
    </section>
  );
}
