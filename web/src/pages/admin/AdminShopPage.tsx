// 管理端 · 消费工单 /admin/shop（v6.26.0；v6.28.0 页面名从「消费」改「消费工单」——
// 侧栏与页标题同口径，路由 /admin/shop 与文件名不动）：待审工单（通过=重校验后自动生效 / 拒绝=必填理由并自动退款）
// + 外部增益代录折叠卡（创建→确认两步，纯效果单不进账本）+ 历史工单筛选。
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiPost, type AdminShopOrderRow } from '../../lib/api.ts';
import { ADMIN_SHOP_KEY, fetchAdminShopOrders } from '../../lib/adminQueries.ts';
import { useToast } from '../../lib/toast.tsx';
import { useTimeFmt } from '../../lib/datetime.ts';
import { POSITION_BY_ID } from '../../../../src/core/fc26.ts';
import { playstyleById, roleById } from '../../lib/ref.ts';

const STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  pending: { cls: 'gold', label: '待审核' },
  approved: { cls: 'green', label: '已生效' },
  rejected: { cls: 'red', label: '已拒绝' },
};

type Category = 'pa' | 'badge' | 'badge_upgrade' | 'role' | 'position' | 'club_shell';

const CATEGORY_LABEL: Record<Category, string> = {
  pa: '买 PA',
  badge: '购徽章',
  badge_upgrade: '银徽升金',
  role: '角色（职责）',
  position: '位置热区',
  club_shell: '队壳申请',
};

const PS_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 16, 21, 22, 23, 24, 25, 26, 31, 32, 33, 34, 35, 41, 42, 43, 44, 45, 51, 52, 53, 54, 55, 56];

export default function AdminShopPage() {
  const { show } = useToast();
  const { dateTime } = useTimeFmt();
  const qc = useQueryClient();
  const [status, setStatus] = useState('pending');
  const [source, setSource] = useState('');
  const listQuery = useQuery({
    queryKey: ADMIN_SHOP_KEY(status, source),
    queryFn: () => fetchAdminShopOrders(status, source),
  });

  function refresh() {
    void qc.invalidateQueries({ queryKey: ['admin', 'shop-orders'] });
  }

  async function approve(order: AdminShopOrderRow) {
    let note: string | null = null;
    if (order.category === 'club_shell') {
      // 队壳单线下建壳后交付绑定码：通过时把交付壳名写进备注（可空）
      note = window.prompt('队壳交付壳名（写入备注，可留空）：') ?? '';
      if (note === null) return;
      note = note.trim() || null;
    }
    const amountNote = order.amount !== null ? `，费用已在提交时扣取` : '（外部录入，不涉及平台资金）';
    if (!window.confirm(`确认通过并生效？\n\n${order.clubName ? `「${order.clubName}」· ` : ''}${order.summary}${amountNote}`)) return;
    try {
      const out = await apiPost<{ summary: string }>(`/api/admin/shop/orders/${order.id}/approve`, note ? { note } : {});
      refresh();
      show(`已通过：${out.summary}`);
    } catch (err) {
      show(err instanceof Error ? err.message : '操作失败', true);
    }
  }

  async function reject(order: AdminShopOrderRow) {
    const reason = window.prompt(`拒绝这张工单？\n${order.summary}\n\n拒绝理由（必填，会连同退款一起通知教练）：`);
    if (reason === null) return;
    if (!reason.trim()) {
      show('拒绝理由必填', true);
      return;
    }
    try {
      const out = await apiPost<{ summary: string }>(`/api/admin/shop/orders/${order.id}/reject`, { reason: reason.trim() });
      refresh();
      show(`已拒绝并退款：${out.summary}`);
    } catch (err) {
      show(err instanceof Error ? err.message : '操作失败', true);
    }
  }

  const orders = listQuery.data?.orders ?? [];

  return (
    <>
      <h1>消费工单</h1>
      <section className="card">
        <p className="hint" style={{ marginBottom: 0 }}>
          教练工单提交即扣费，通过才生效、拒绝自动退款；外部录入是纯效果单（积分兑换 / 奖励等），不进账本。审批时工单参数会按当前球员状态重校验，状态已变的单会拦下并给原因。
        </p>
      </section>

      <ExternalCreateCard onCreated={refresh} />

      <section className="card">
        <h3>工单队列</h3>
        <div className="seg" role="group" aria-label="状态筛选">
          {[
            { key: 'pending', label: '待审核' },
            { key: 'approved', label: '已生效' },
            { key: 'rejected', label: '已拒绝' },
            { key: '', label: '全部状态' },
          ].map((s) => (
            <button key={s.key} type="button" className={status === s.key ? 'on' : ''} onClick={() => setStatus(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="来源筛选">
          {[
            { key: '', label: '全部来源' },
            { key: 'club', label: '教练购买' },
            { key: 'external', label: '外部录入' },
          ].map((s) => (
            <button key={s.key} type="button" className={source === s.key ? 'on' : ''} onClick={() => setSource(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
        {listQuery.isPending ? (
          <p className="muted">正在读工单…</p>
        ) : listQuery.isError ? (
          <p className="muted">{listQuery.error instanceof Error ? listQuery.error.message : '工单读不出来'}</p>
        ) : orders.length === 0 ? (
          <p className="muted">这个筛选下没有工单。</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>单号</th>
                  <th>时间</th>
                  <th>俱乐部</th>
                  <th>类别</th>
                  <th>摘要</th>
                  <th className="num">金额</th>
                  <th>来源</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="mono muted">#{o.id}</td>
                    <td className="mono muted">{dateTime(o.createdAt)}</td>
                    <td>{o.clubName ?? '—'}</td>
                    <td>{o.categoryLabel}</td>
                    <td>
                      {o.summary}
                      {o.rejectReason && <span className="error-msg"> · {o.rejectReason}</span>}
                      {o.note && <span className="hint"> · 备注：{o.note}</span>}
                    </td>
                    <td className="num mono">{o.amount === null ? '—' : o.amount.toFixed(2)}</td>
                    <td>
                      {o.source === 'external' ? (
                        <span className="badge sky" title="管理组代录的外部增益">
                          外部
                        </span>
                      ) : (
                        <span className="badge gray">教练</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[o.status]?.cls ?? 'gray'}`}>{STATUS_BADGE[o.status]?.label ?? o.status}</span>
                    </td>
                    <td>
                      {o.status === 'pending' ? (
                        <>
                          <button className="btn btn-sm" type="button" onClick={() => void approve(o)}>
                            {o.source === 'external' ? '确认执行' : '通过'}
                          </button>
                          <button className="btn btn-ghost btn-sm" type="button" style={{ marginLeft: 6 }} onClick={() => void reject(o)}>
                            {o.source === 'external' ? '作废' : '拒绝'}
                          </button>
                        </>
                      ) : (
                        <span className="muted">{o.reviewedBy ? `操作人 #${o.reviewedBy}` : '—'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/* ---------- 外部增益代录（折叠卡） ---------- */

function ExternalCreateCard({ onCreated }: { onCreated: () => void }) {
  const { show } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [clubId, setClubId] = useState('');
  const [category, setCategory] = useState<Category>('pa');
  const [note, setNote] = useState('');
  // 各类别的动态参数（管理组手工录入，提交时服务端统一校验）
  const [playerId, setPlayerId] = useState('');
  const [points, setPoints] = useState('1');
  const [kind, setKind] = useState<'silver' | 'gold'>('silver');
  const [psid, setPsid] = useState('');
  const [action, setAction] = useState('add');
  const [roleId, setRoleId] = useState('');
  const [slot, setSlot] = useState('');
  const [posId, setPosId] = useState('');
  const [busy, setBusy] = useState(false);

  function buildPayload(): Record<string, unknown> | null {
    const pid = Number(playerId);
    switch (category) {
      case 'pa':
        return { playerId: pid, points: Number(points) };
      case 'badge':
        return { playerId: pid, kind, psid: Number(psid) };
      case 'badge_upgrade':
        return { playerId: pid, psid: Number(psid) };
      case 'role': {
        const p: Record<string, unknown> = { playerId: pid, action };
        if (action === 'add') p.roleId = Number(roleId);
        if (action !== 'add') p.slot = Number(slot);
        return p;
      }
      case 'position': {
        const p: Record<string, unknown> = { playerId: pid, action, slot: Number(slot || '2') };
        if (action !== 'remove') p.posId = Number(posId);
        return p;
      }
      case 'club_shell':
        return { note: note.trim() || undefined };
    }
  }

  async function submit() {
    const cid = Number(clubId);
    if (!Number.isInteger(cid) || cid <= 0) {
      show('目标俱乐部 id 必须是正整数', true);
      return;
    }
    const payload = buildPayload();
    if (!window.confirm(`为俱乐部 #${cid} 代录外部工单：${CATEGORY_LABEL[category]}？（创建后仍是待审，需再点「确认执行」才生效）`)) return;
    setBusy(true);
    try {
      const out = await apiPost<{ summary: string }>('/api/admin/shop/orders', { clubId: cid, category, payload, note: note.trim() || null });
      void qc.invalidateQueries({ queryKey: ['admin', 'shop-orders'] });
      onCreated();
      show(`已创建外部工单：${out.summary}。到工单队列点「确认执行」生效。`);
    } catch (err) {
      show(err instanceof Error ? err.message : '创建失败', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h3 style={{ cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        外部录入{open ? ' ▾' : ' ▸'}
        <span className="hint" style={{ marginLeft: 8, fontWeight: 400 }}>
          外部渠道来的增益（积分兑换 / 奖励等），代录成工单后确认执行
        </span>
      </h3>
      {open && (
        <>
          <div className="inline-form">
            <input className="mono" style={{ width: 'min(120px, 100%)' }} placeholder="俱乐部 id" value={clubId} onChange={(e) => setClubId(e.target.value.replace(/[^\d]/g, ''))} />
            <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
            {category !== 'club_shell' && (
              <input className="mono" style={{ width: 'min(110px, 100%)' }} placeholder="球员 id" value={playerId} onChange={(e) => setPlayerId(e.target.value.replace(/[^\d]/g, ''))} />
            )}
          </div>
          <div className="inline-form">
            {category === 'pa' && <input className="mono" style={{ width: 'min(90px, 100%)' }} placeholder="点数 1-10" value={points} onChange={(e) => setPoints(e.target.value.replace(/[^\d]/g, ''))} />}
            {category === 'badge' && (
              <>
                <select value={kind} onChange={(e) => setKind(e.target.value as 'silver' | 'gold')}>
                  <option value="silver">银徽章</option>
                  <option value="gold">金徽章</option>
                </select>
                <select value={psid} onChange={(e) => setPsid(e.target.value)}>
                  <option value="">选 PlayStyle…</option>
                  {PS_OPTIONS.map((id) => (
                    <option key={id} value={id}>
                      {playstyleById.get(id)?.chs ?? `#${id}`}
                    </option>
                  ))}
                </select>
              </>
            )}
            {category === 'badge_upgrade' && (
              <select value={psid} onChange={(e) => setPsid(e.target.value)}>
                <option value="">要升金的银徽章…</option>
                {PS_OPTIONS.map((id) => (
                  <option key={id} value={id}>
                    {playstyleById.get(id)?.chs ?? `#${id}`}
                  </option>
                ))}
              </select>
            )}
            {category === 'role' && (
              <>
                <select value={action} onChange={(e) => setAction(e.target.value)}>
                  <option value="add">新增</option>
                  <option value="upgrade">单升双</option>
                  <option value="remove">去除</option>
                </select>
                {action === 'add' && (
                  <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                    <option value="">选角色…</option>
                    {[1, 2, 3, 4, 5].flatMap((base) => [base, base + 100]).map((id) => {
                      const r = roleById.get(id);
                      return (
                        <option key={id} value={id}>
                          {r ? `${r.chs.replace(/ \+$/, '')}${id > 100 ? ' ++' : ' +'}` : `角色 #${id}`}
                        </option>
                      );
                    })}
                  </select>
                )}
                {action !== 'add' && <input className="mono" style={{ width: 'min(100px, 100%)' }} placeholder="槽位 1-5" value={slot} onChange={(e) => setSlot(e.target.value.replace(/[^\d]/g, ''))} />}
              </>
            )}
            {category === 'position' && (
              <>
                <select value={action} onChange={(e) => setAction(e.target.value)}>
                  <option value="add">新增</option>
                  <option value="remove">去除</option>
                  <option value="replace">替换</option>
                </select>
                <input className="mono" style={{ width: 'min(100px, 100%)' }} placeholder="槽位 2-4" value={slot} onChange={(e) => setSlot(e.target.value.replace(/[^\d]/g, ''))} />
                {action !== 'remove' && (
                  <select value={posId} onChange={(e) => setPosId(e.target.value)}>
                    <option value="">选位置…</option>
                    {Object.entries(POSITION_BY_ID)
                      .filter(([id]) => id !== '0')
                      .map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                  </select>
                )}
              </>
            )}
          </div>
          <div className="inline-form">
            <input className="grow" style={{ flex: 1 }} placeholder="外部来源说明（积分兑换 / 奖励 / 群内裁决 等，必填）" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
            <button className="btn btn-sm" type="button" disabled={busy} onClick={() => void submit()}>
              {busy ? '提交中…' : '创建工单'}
            </button>
          </div>
          <p className="hint" style={{ marginBottom: 0 }}>
            提交时只校验不生效；到上方工单队列里再点「确认执行」。金额列对 external 单恒为 —，不进账本。
          </p>
        </>
      )}
    </section>
  );
}
