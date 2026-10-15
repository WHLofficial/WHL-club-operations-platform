// 管理端 · 成长档位页（TECH_DESIGN §10.3，v6.48.0）：自动核定 + 人工覆盖
// 一键重算（预览 → 确认落库）+ 明细 + 未设国家的队 + 变更清单。
// 单人核定与解除锁定在球员页的「档位核定」区；公开球员页展示每人五条件依据。
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  api,
  apiPost,
  type TierChangeEntry,
  type TierClubWithoutCountry,
  type TierConditionMeta,
  type TierDiffRow,
  type TierRecomputeSummary,
} from '../../lib/api.ts';
import ConfirmButton from '../../components/ConfirmButton.tsx';
import EmptyState from '../../components/EmptyState.tsx';
import { CONDITION_SHORT } from '../../lib/tier.ts';
import { useToast } from '../../lib/toast.tsx';
import { useTimeFmt } from '../../lib/datetime.ts';

export default function TierPage() {
  return (
    <div className="admin-page">
      <RecomputeSection />
      <ClubsWithoutCountrySection />
      <ChangesSection />
    </div>
  );
}

const RECOMPUTE_KEY = ['admin', 'tier-recompute'];
const TIER_CLUBS_KEY = ['admin', 'tier-clubs-without-country'];
const TIER_CHANGES_KEY = ['admin', 'tier-changes'];

// 条件键顺序（与规则层 GROWTH_TIER_CONDITIONS 一致）：明细行的徽标按这个顺序排
const CONDITION_KEYS = ['c1', 'c2', 'c3', 'c4', 'c5'] as const;

function ConditionChips({ conditions }: { conditions: Record<string, boolean> }) {
  return (
    <span className="tier-chips">
      {CONDITION_KEYS.map((key) => (
        <span key={key} className={`badge${conditions[key] ? '' : ' muted'}`} title={conditions[key] ? '命中' : '未命中'}>
          {CONDITION_SHORT[key]}
        </span>
      ))}
    </span>
  );
}

/* ---------- 一键重算（§10.3） ---------- */

function RecomputeSection() {
  const { show, toastNode } = useToast();
  const queryClient = useQueryClient();
  const [clubId, setClubId] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: preview, error, isFetching } = useQuery({
    queryKey: RECOMPUTE_KEY,
    queryFn: () => api<TierRecomputeSummary>('/api/admin/growth/tier-recompute'),
  });

  useEffect(() => {
    if (error) show(error instanceof Error ? error.message : '档位预览失败', true);
  }, [error, show]);

  const conditions: TierConditionMeta[] = preview?.conditions ?? [];

  // 预览是按「当前状态」算的：落库前先重新预览一次，避免对着陈旧计数按确认
  async function run(clubIdRaw?: number) {
    if (busy) return;
    setBusy(true);
    try {
      const body = clubIdRaw === undefined ? {} : { clubId: clubIdRaw };
      const r = await apiPost<TierRecomputeSummary>('/api/admin/growth/tier-recompute', body);
      show(
        clubIdRaw === undefined
          ? `全量重算完成：${r.up} 人升档、${r.down} 人降档，锁定跳过 ${r.locked} 人，写 ${r.batches} 批。`
          : `俱乐部 #${clubIdRaw} 重算完成：${r.up} 人升档、${r.down} 人降档（锁定跳过 ${r.locked} 人）。`,
      );
      await queryClient.invalidateQueries({ queryKey: RECOMPUTE_KEY });
      await queryClient.invalidateQueries({ queryKey: TIER_CHANGES_KEY });
    } catch (err) {
      show(err instanceof Error ? err.message : '重算失败', true);
    } finally {
      setBusy(false);
    }
  }

  const clubIdNum = Number(clubId);
  const clubIdValid = /^\d+$/.test(clubId.trim()) && clubIdNum > 0;

  return (
    <section className="card admin-section">
      <h2>成长档位（§10.3）</h2>
      {toastNode}
      <p className="hint">
        档位 = 基础 1 档 + 五条件叠加（上限 5 档）。自动核定按下面五条判：条件命中即 +，缺数据不猜（记未命中）。
        人工核定（球员页「档位核定」区）会锁定该球员，自动重算跳过它，可随时解除锁定回到自动值。
        转会、换壳、年满 19、摘掉未来之星都按当前状态如实升降，不回溯已经发过的升级。
      </p>
      {conditions.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>条件</th>
                <th>档位加成</th>
                <th>判定口径</th>
              </tr>
            </thead>
            <tbody>
              {conditions.map((cond) => (
                <tr key={cond.key}>
                  <td>
                    {cond.label} <span className="muted">{CONDITION_SHORT[cond.key]}</span>
                  </td>
                  <td className="mono">+{cond.points}</td>
                  <td className="hint">{cond.hint}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!preview ? (
        <p className="muted">正在按当前状态试算…</p>
      ) : (
        <>
          <p>
            全库 <span className="mono">{preview.scanned.toLocaleString()}</span> 名球员：
            <span className="badge">将升 {preview.up}</span> <span className="badge">将降 {preview.down}</span>{' '}
            <span className="badge muted">不变 {preview.unchanged}</span>{' '}
            <span className="badge muted" title="人工核定过的球员，自动重算不动它">
              锁定跳过 {preview.locked}
            </span>
          </p>
          <div className="actions">
            <button className="btn btn-ghost" type="button" disabled={isFetching} onClick={() => queryClient.invalidateQueries({ queryKey: RECOMPUTE_KEY })}>
              {isFetching ? '试算中…' : '重新试算'}
            </button>
            <ConfirmButton
              label={preview.up + preview.down === 0 ? '执行重算（无差异）' : `执行重算（${preview.up + preview.down} 人）`}
              confirmLabel="确认写入（再点一次）"
              busy={busy}
              busyLabel="重算中…"
              disarmKey={`${preview.scanned}|${preview.up}|${preview.down}|${preview.locked}`}
              onConfirm={() => run()}
            />
            <label className="field">
              只重算某队（可选，俱乐部 ID）
              <input className="mono" value={clubId} onChange={(e) => setClubId(e.target.value)} placeholder="如 14" inputMode="numeric" />
            </label>
            <ConfirmButton
              label="重算该队"
              confirmLabel="确认写入该队（再点一次）"
              className="btn-ghost"
              busy={busy}
              busyLabel="重算中…"
              disabled={!clubIdValid}
              disarmKey={`${clubId}`}
              onConfirm={() => run(clubIdNum)}
            />
          </div>
          {preview.rows.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>球员</th>
                    <th>现队</th>
                    <th>现档</th>
                    <th>重算后</th>
                    <th>命中条件</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row: TierDiffRow) => (
                    <tr key={row.playerId}>
                      <td>
                        <Link to={`/players/${row.playerId}`}>{row.name}</Link> <span className="muted">#{row.playerId}</span>
                      </td>
                      <td>{row.clubName ?? <span className="muted">自由身</span>}</td>
                      <td className="mono">档 {row.currentTier}</td>
                      <td className="mono">
                        档 {row.nextTier} <span className={row.nextTier > row.currentTier ? 'up-mark' : 'down-mark'}>{row.nextTier > row.currentTier ? '↑' : '↓'}</span>
                      </td>
                      <td>
                        <ConditionChips conditions={row.conditions} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {preview.truncated && <p className="hint">明细只列前 200 行，其余差异执行时一并写入。</p>}
        </>
      )}
    </section>
  );
}

/* ---------- 未设国家的队（c2 的兜底提示） ---------- */

function ClubsWithoutCountrySection() {
  const { show, toastNode } = useToast();
  const { data, error } = useQuery({
    queryKey: TIER_CLUBS_KEY,
    queryFn: () => api<{ clubs: TierClubWithoutCountry[] }>('/api/admin/growth/tier-clubs-without-country'),
  });

  useEffect(() => {
    if (error) show(error instanceof Error ? error.message : '未设国家的队加载失败', true);
  }, [error, show]);

  const clubs = data?.clubs ?? null;
  if (clubs !== null && clubs.length === 0) return null;

  return (
    <section className="card admin-section">
      <h2>未设国家的队</h2>
      {toastNode}
      <p className="hint">
        队壳国家是「会籍与队壳国家一致」这条档位条件的比对基准。这些队还没设国家，队内所有球员的这一条一律记未命中
        （缺数据不猜），档位可能偏低。到俱乐部页的「国家」按钮补录，补完该队球员会立刻按当前状态重算。
      </p>
      {clubs === null ? (
        <p className="muted">正在核对…</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>俱乐部</th>
                <th>队内球员</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {clubs.map((club) => (
                <tr key={club.id}>
                  <td>
                    {club.name} <span className="muted">#{club.id}</span>
                  </td>
                  <td className="mono">{club.players}</td>
                  <td>
                    <Link className="btn btn-ghost btn-sm" to="/admin/clubs">
                      去补录
                    </Link>
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

/* ---------- 变更清单（读审计） ---------- */

const ACTION_LABEL: Record<string, string> = {
  growth_tier_set: '档位写入',
  growth_tier_recompute: '批次重算',
  growth_tier_unlock: '解除锁定',
};

function changeText(entry: TierChangeEntry): string {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  if (entry.action === 'growth_tier_recompute') {
    return `扫描 ${String(after.scanned ?? '—')} · 升 ${String(after.up ?? 0)} / 降 ${String(after.down ?? 0)} · 锁定跳过 ${String(after.locked ?? 0)}`;
  }
  const from = before.tier;
  const to = after.tier;
  const auto = entry.action === 'growth_tier_unlock' ? true : after.auto === true;
  return `档 ${String(from ?? '—')} → 档 ${String(to ?? '—')}（${auto ? '自动' : '人工'}）`;
}

function ChangesSection() {
  const { show, toastNode } = useToast();
  const { dateTime } = useTimeFmt();
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: TIER_CHANGES_KEY,
    queryFn: () => api<{ entries: TierChangeEntry[] }>('/api/admin/growth/tier-changes?limit=50'),
  });

  useEffect(() => {
    if (error) show(error instanceof Error ? error.message : '变更清单加载失败', true);
  }, [error, show]);

  const entries = data?.entries ?? [];

  return (
    <section className="card admin-section">
      <h2>档位变更清单</h2>
      {toastNode}
      <p className="hint">最近的档位写入（含自动核定、人工核定、批次重算与解除锁定），读的是审计表，只列不改。</p>
      <div className="actions">
        <button className="btn btn-ghost" type="button" disabled={isFetching} onClick={() => refetch()}>
          {isFetching ? '读取中…' : '刷新'}
        </button>
      </div>
      {entries.length === 0 ? (
        <EmptyState>还没有档位变更记录。</EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>动作</th>
                <th>对象</th>
                <th>变化</th>
                <th>操作者</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="mono muted">{dateTime(entry.at)}</td>
                  <td>{ACTION_LABEL[entry.action] ?? entry.action}</td>
                  <td>
                    {entry.targetType === 'player' ? (
                      <>
                        球员 <Link to={`/players/${entry.targetId}`}>#{entry.targetId}</Link>
                      </>
                    ) : (
                      <>
                        {entry.targetType} <span className="mono">#{entry.targetId ?? '—'}</span>
                      </>
                    )}
                  </td>
                  <td className="hint">{changeText(entry)}</td>
                  <td className="muted">{entry.actor === null ? '系统' : `用户 #${entry.actor}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
