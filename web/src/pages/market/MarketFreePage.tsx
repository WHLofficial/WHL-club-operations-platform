// 海捞 /market/free（v6.18.0 改版）：海捞资格查询（信息条）+ 激活别队球员（模式切换 + 名字搜索）。
// v6.17.0 的成交动态（sea-signs）与 CPU 捞人榜（cpu-board）端点已退役：成交情报迁到 /market/intel，
// 可激活名单换成 /api/market/activatable。需登录（路由守卫），两个端点都是教练端点（club.squad.manage）。
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { apiPost, apiUpload, type ActivatablePlayer, type ActivationResult } from '../../lib/api.ts';
import { useActivatable, useMyClub, useSeaLookup, type ActivatableMode } from '../../lib/queries.ts';
import { useToast } from '../../lib/toast.tsx';
import { playerPath } from '../../lib/player-link.ts';
import { MarketNav, deadlineText, money } from './shared.tsx';

export default function MarketFreePage() {
  const { show, toastNode } = useToast();
  const { loading, isCoach, club } = useMyClub();
  return (
    <div className="container">
      <h1>转会市场 · 海捞</h1>
      {toastNode}
      <MarketNav />
      {loading ? (
        <p className="muted">正在确认你的俱乐部身份…</p>
      ) : !isCoach ? (
        <div className="card empty-state">
          <p className="muted">海捞资格查询与激活球员都只对教练开放，观众视角看看就好。</p>
        </div>
      ) : club === null ? (
        <div className="card empty-state">
          <p className="muted">还没有绑定俱乐部。先到球队中心完成绑定，再来海捞。</p>
        </div>
      ) : (
        <>
          <SeaLookupSection />
          <ActivateSection onDone={(msg) => show(msg)} onError={(m) => show(m, true)} />
        </>
      )}
    </div>
  );
}

/* ---------- 海捞资格查询（v6.18.0，GET /api/market/sea-lookup） ---------- */

function SeaLookupSection() {
  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState('');
  const { data, isFetching, isError, error } = useSeaLookup(submitted);

  const search = () => setSubmitted(input.trim());

  return (
    <section className="card admin-section">
      <h3>海捞资格查询</h3>
      <p className="hint">
        输入球员 ID 或名字，查他能不能被海捞。海捞签入费 = 新违约金 × 30%，签入入口在球员档案左栏（E 态）。
      </p>
      <div className="inline-form">
        <div className="field grow">
          <label htmlFor="sea-lookup-q">球员 ID 或名字</label>
          <input
            id="sea-lookup-q"
            value={input}
            placeholder="输入球员 ID 或名字"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                search();
              }
            }}
          />
        </div>
        <button className="btn" type="button" disabled={input.trim() === '' || isFetching} onClick={search}>
          {isFetching ? '查询中…' : '查询'}
        </button>
      </div>
      {isError ? (
        <div className="banner warn">{error instanceof Error ? error.message : '查询打不开了，稍后再试'}</div>
      ) : submitted === '' ? (
        <p className="muted">输入球员 ID 或名字，查他能不能被海捞。</p>
      ) : data === undefined ? (
        <p className="muted">正在查…</p>
      ) : data.length === 0 ? (
        <p className="hint">没有找到这名球员。</p>
      ) : (
        <ul className="form-list">
          {data.map((r) => (
            <li key={r.id}>
              <div className="form-row">
                <span className="form-teams">
                  <Link to={playerPath(r)}>{r.name}</Link>
                  <span className="muted">
                    {' '}
                    {r.position ?? '—'} · {r.age ?? '—'} 岁 · CA <span className="mono">{r.ca ?? '—'}</span> · PA{' '}
                    <span className="mono">{r.pa ?? '—'}</span> · {r.clubName ?? '自由身'}
                  </span>
                </span>
                <span className="form-tail">
                  <span className={`badge ${r.seaSign.eligible ? 'green' : 'gray'}`}>
                    {r.seaSign.eligible ? '可捞' : '不可捞'}
                  </span>
                </span>
              </div>
              {r.seaSign.reason && <p className="hint">{r.seaSign.reason}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------- 激活别队球员（规则 4.4.2，GET /api/market/activatable） ---------- */

function ActivateSection({ onDone, onError }: { onDone: (msg: string) => void; onError: (msg: string) => void }) {
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
      onDone(
        res.kind === 'trainee'
          ? `已激活 ${target?.name ?? '球员'}：挂牌 ${res.askPrice.toFixed(2)} m。请在 ${deadlineText(res.firstBidDeadline, '')} 前落首价，落价即成交（训练营球员直进审核）。逾期激活作废（还占本窗激活额度）。`
          : `已激活 ${target?.name ?? '球员'}：挂牌 ${res.askPrice.toFixed(2)} m。请在 ${deadlineText(res.firstBidDeadline, '')} 前落首价；落价后进 24 小时匹配窗，等原属俱乐部决定是否匹配。逾期激活作废（还占本窗激活额度）。`,
      );
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
          </p>
        </>
      )}
    </section>
  );
}
