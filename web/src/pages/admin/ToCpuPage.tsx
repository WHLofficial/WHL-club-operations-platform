// 管理端 · 转 CPU 向导（v6.84.0）：玩家队 → CPU 队的反向转换，五步一条线走完 ——
// ① 预检 ② 赛事系统对手方改名 ③ 本仓改名 + 置 CPU（回收余额/券）④ 批量解绑 ⑤ 复核。
// 入口：俱乐部管理里人类队的「转 CPU」；无 id（或 id 非法）先出人类队选择器，有 id 才进向导。
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  apiPost,
  type CpuDetachRenameLocalResult,
  type CpuDetachRenameTourResult,
  type CpuDetachState,
  type CpuDetachUnbindResult,
  type MeUser,
} from '../../lib/api.ts';
import { ADMIN_CLUBS_KEY, CPU_DETACH_KEY, fetchAdminClubs, fetchCpuDetach } from '../../lib/adminQueries.ts';
import { useAuth } from '../../lib/auth.tsx';
import { LEAGUE_TIER_LABEL } from '../../lib/ref.ts';
import { useToast } from '../../lib/toast.tsx';
import { useTimeFmt } from '../../lib/datetime.ts';
import ConfirmButton from '../../components/ConfirmButton.tsx';
import EmptyState from '../../components/EmptyState.tsx';

type ShowToast = (text: string, err?: boolean) => void;

export default function ToCpuPage() {
  const [params] = useSearchParams();
  const raw = params.get('id') ?? '';
  const id = /^\d+$/.test(raw) ? Number(raw) : 0;
  return <div className="admin-page">{id > 0 ? <DetachWizard id={id} /> : <HumanPicker />}</div>;
}

/** leagueTier 中文标签；空/未知分别回落「未定级」与原文 */
function tierText(tier: string | null | undefined): string {
  if (!tier) return '未定级';
  return LEAGUE_TIER_LABEL[tier] ?? tier;
}

/** 批量解绑权限：与 src/lib/session.ts:259-268 requireAdmin 同口径——OIDC 看权限点，
 *  兼容模式权限点恒空、回落 admin 角色。判不准时后端仍会 403，前端只负责提前禁用并说明。 */
function canUnbindClubs(user: MeUser | null | undefined, authMode: 'oidc' | 'shared'): boolean {
  if (!user) return false;
  if (authMode === 'oidc') return Boolean(user.permissions?.includes('club.bindings.unbind'));
  return user.role === 'admin';
}

/** 步骤卡壳：序号 + 标题 + 当前完成态徽标 */
function StepCard({ no, title, status, children }: { no: number; title: string; status: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card admin-section">
      <h3>
        步骤 {no} · {title} {status}
      </h3>
      {children}
    </section>
  );
}

/* ---------- 无 id / id 非法：人类队选择器 ---------- */

function HumanPicker() {
  const { show, toastNode } = useToast();
  const { data: clubs, error } = useQuery({ queryKey: ADMIN_CLUBS_KEY, queryFn: fetchAdminClubs });

  useEffect(() => {
    if (error) show(error instanceof Error ? error.message : '俱乐部列表加载失败', true);
  }, [error, show]);

  const humans = clubs?.filter((c) => !c.isCpu) ?? [];

  return (
    <section className="card admin-section">
      <h2>转 CPU 向导</h2>
      {toastNode}
      <p className="hint">
        把玩家队转成 CPU 队，五步一条线：预检 → 赛事系统改名 → 本仓改名并置 CPU → 批量解绑 → 复核。
        下面只列没有 CPU 标的人类队；已转换的队会从这里消失（本页直链仍能回来看）。
      </p>
      {clubs === undefined ? (
        <p className="muted">正在翻登记册…</p>
      ) : humans.length === 0 ? (
        <EmptyState>没有可转为 CPU 队的人类俱乐部</EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>俱乐部</th>
                <th>级别</th>
                <th>绑定账号</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {humans.map((club) => (
                <tr key={club.id}>
                  <td>
                    {club.name} <span className="muted">#{club.id}</span>
                  </td>
                  <td>{tierText(club.leagueTier)}</td>
                  <td>{club.bindings.length > 0 ? `${club.bindings.length} 个` : '—'}</td>
                  <td>
                    <Link className="btn btn-ghost btn-sm" to={`/admin/clubs/to-cpu?id=${club.id}`}>
                      进入转换向导
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

/* ---------- 有 id：五步向导 ---------- */

function DetachWizard({ id }: { id: number }) {
  const { show, toastNode } = useToast();
  const queryClient = useQueryClient();
  const { user, authMode } = useAuth();
  const { data: state, error, isFetching } = useQuery({ queryKey: CPU_DETACH_KEY(id), queryFn: () => fetchCpuDetach(id) });

  useEffect(() => {
    if (error) show(error instanceof Error ? error.message : '转换状态加载失败', true);
  }, [error, show]);

  // 三个动作后的统一刷新：重拉转换状态；登记册/总览各自精确 invalidate（置 CPU 改列表与总览）
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: CPU_DETACH_KEY(id) });
    void queryClient.invalidateQueries({ queryKey: ADMIN_CLUBS_KEY });
  };
  const refreshOverview = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] });

  if (!state) {
    return (
      <section className="card admin-section">
        <h2>转 CPU 向导</h2>
        {toastNode}
        <p className="muted">{error ? '转换状态读不出来——回列表重试，或核对这支队的编号。' : '正在读转换状态…'}</p>
        <p>
          <Link to="/admin/clubs/to-cpu">← 返回人类队列表</Link>
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="card admin-section">
        <h2>
          {state.club.name} <span className="muted">#{state.club.id}</span>
        </h2>
        {toastNode}
        <p className="hint">
          <span className={`badge ${state.club.isCpu ? 'gold' : 'green'}`}>{state.club.isCpu ? 'CPU 队' : '人类队'}</span>{' '}
          级别 {tierText(state.club.leagueTier)} · 状态 {state.club.status} · 余额 {state.balance.toFixed(2)}m · 消费券{' '}
          {state.vouchers.toFixed(2)}
          {isFetching ? ' · 刷新中…' : ''} · <Link to="/admin/clubs/to-cpu">返回人类队列表</Link>
        </p>
      </section>
      <StepPrecheck state={state} />
      <StepTour id={id} state={state} show={show} onMutated={refresh} />
      <StepLocal id={id} state={state} show={show} onMutated={refresh} onOverhead={refreshOverview} />
      <StepUnbind id={id} state={state} show={show} onMutated={refresh} canUnbind={canUnbindClubs(user, authMode)} />
      <StepReview state={state} onMutated={refresh} refreshing={isFetching} />
    </>
  );
}

/** 步骤 1：预检（只读）——阻断项非空时后续动作一律禁用 */
function StepPrecheck({ state }: { state: CpuDetachState }) {
  const { dateTime } = useTimeFmt();
  const blocked = state.blockers.length > 0;
  return (
    <StepCard
      no={1}
      title="预检"
      status={blocked ? <span className="badge red">存在阻断</span> : <span className="badge green">预检通过</span>}
    >
      <p className="hint">
        赛事系统：{state.tour ? `「${state.tour.name}」` : '查无此队（可跳过改名）'} · 合同 {state.contracts.active}/{state.contracts.total} 份有效/总数 ·
        球员 {state.players} 人 ·{' '}
        <span className={blocked ? '' : 'muted'}>{blocked ? '先清掉下列阻断项，再往下走。' : '未发现阻断项，可以开始转换。'}</span>
      </p>
      <div className="hint">
        <p>全部绑定账号（{state.bindings.length} 个）：</p>
        {state.bindings.length === 0 ? (
          <p className="muted">没有绑定账号。</p>
        ) : (
          <ul>
            {state.bindings.map((b) => (
              <li key={b.userId}>
                {b.userName ?? `用户 #${b.userId}`}（#{b.userId}） · 绑定于 {dateTime(b.boundAt)}
              </li>
            ))}
          </ul>
        )}
        {state.unusedCodes.length > 0 && (
          <p>
            未使用绑定码 {state.unusedCodes.length} 张（转换后作废，不影响预检通过）。
          </p>
        )}
      </div>
      {state.blockers.length > 0 && (
        <div className="hint">
          <p>
            <b>阻断项</b>
          </p>
          <ul>
            {state.blockers.map((b) => (
              <li key={b.key}>
                <span className="badge red">{b.label}</span> {b.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
      {state.warnings.length > 0 && (
        <div className="hint">
          <p>
            <b>提示项</b>（不阻断转换）
          </p>
          <ul>
            {state.warnings.map((w) => (
              <li key={w.key}>
                <span className="badge orange">{w.label}</span> {w.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
    </StepCard>
  );
}

/** 步骤 2：赛事系统对手方改名（tour 查无此队时只提示，可跳过） */
function StepTour({ id, state, show, onMutated }: { id: number; state: CpuDetachState; show: ShowToast; onMutated: () => void }) {
  const [name, setName] = useState(state.suggest.newName);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const tour = state.tour;
  const blocked = state.blockers.length > 0;
  const done = tour !== null && (state.checks.tourName || tour.name === state.suggest.newName);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const target = name.trim();
    if (!target) {
      show('队名不能为空', true);
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiPost<CpuDetachRenameTourResult>(`/api/admin/clubs/${id}/to-cpu/rename-tour`, { name: target });
      setFeedback(res.renamed ? `对手方已改名为「${res.name}」。` : `对手方队名本来就是「${res.name}」，没有改动（幂等）。`);
      onMutated();
    } catch (err) {
      show(err instanceof Error ? err.message : '对手方改名失败', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepCard
      no={2}
      title="对手方（赛事系统）改名"
      status={
        tour === null ? (
          <span className="badge gray">对手方查无此队</span>
        ) : done ? (
          <span className="badge green">已完成</span>
        ) : (
          <span className="badge gray">待处理</span>
        )
      }
    >
      {tour === null ? (
        <p className="hint">赛事系统里查不到 #{id} 号球队——这一步可以跳过，继续往下走。</p>
      ) : (
        <p className="hint">
          对手方在赛事系统里现在叫「{tour.name}」，建议改成「{state.suggest.newName}」。服务端会强制补上「(CPU)」后缀；失败会给出原因，稍后重试即可。
        </p>
      )}
      <form className="inline-form" onSubmit={submit}>
        <label className="field grow">
          新队名
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} disabled={tour === null || blocked} placeholder="新队名" />
        </label>
        <button className="btn" type="submit" disabled={busy || tour === null || blocked || !name.trim()}>
          {busy ? '推送中…' : '改名并推送'}
        </button>
      </form>
      {blocked && <p className="hint">预检有阻断项，改名按钮已禁用。</p>}
      {state.suggest.nameError && <p className="hint">{state.suggest.nameError}</p>}
      {feedback && <p className="hint">{feedback}</p>}
    </StepCard>
  );
}

/** 步骤 3：本仓改名并置 CPU 标（余额/券在批内回收，确认框写明不可退回） */
function StepLocal({
  id,
  state,
  show,
  onMutated,
  onOverhead,
}: {
  id: number;
  state: CpuDetachState;
  show: ShowToast;
  onMutated: () => void;
  onOverhead: () => void;
}) {
  const [name, setName] = useState(state.suggest.newName);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const blocked = state.blockers.length > 0;
  const done = state.club.isCpu && state.checks.localName;
  const repair = state.club.isCpu && !state.checks.localName;

  async function submit() {
    const target = name.trim();
    if (!target) {
      show('队名不能为空', true);
      return;
    }
    if (busy || blocked) return;
    setBusy(true);
    try {
      const res = await apiPost<CpuDetachRenameLocalResult>(`/api/admin/clubs/${id}/to-cpu/rename-local`, { name: target });
      setFeedback(
        res.changed
          ? res.flipped
            ? `已改为「${res.name ?? target}」并置为 CPU 队，余额与消费券已按当刻余额回收。`
            : `已改为「${res.name ?? target}」（该队此前已是 CPU，本次只修队名，未重复回收）。`
          : '此前已是 CPU 队且同名（幂等）：本次什么都没动。',
      );
      onMutated();
      onOverhead();
    } catch (err) {
      show(err instanceof Error ? err.message : '转换失败', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepCard
      no={3}
      title="本仓改名并置为 CPU 队"
      status={
        done ? (
          <span className="badge green">已完成</span>
        ) : repair ? (
          <span className="badge orange">队名待修复</span>
        ) : (
          <span className="badge gray">待处理</span>
        )
      }
    >
      <p className="hint">
        把登记册里的队名改成带「(CPU)」后缀的名字，同时置 CPU 标并解冻转会。撞名会被拦下并给原因；此队随后从人类队列表消失，本页直链仍能回来看。
      </p>
      <ul className="hint">
        <li>保留现有阵容与合同：转换不动球员归属与合同状态。</li>
        <li>转 CPU 后球员可被其他球队海捞；现有合同不构成归属障碍。</li>
        <li>CPU 队不收转会费，卖出球员不会产生收入。</li>
        <li>
          本队余额 {state.balance.toFixed(2)}m、消费券 {state.vouchers.toFixed(2)} 将被回收，重新接管时不退回。
        </li>
      </ul>
      {done ? (
        <p className="hint">已是「{state.club.name}」，CPU 标与队名后缀都就位。</p>
      ) : (
        <>
          <form className="inline-form" onSubmit={(e) => e.preventDefault()}>
            <label className="field grow">
              新队名
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} disabled={blocked} placeholder="新队名" />
            </label>
          </form>
          {state.suggest.nameError && <p className="hint">{state.suggest.nameError}</p>}
          <div className="btn-row">
            <ConfirmButton
              label={repair ? '只改队名（已是 CPU）' : '改名并转 CPU'}
              confirmLabel="再点一次确认（余额与券回收不退回）"
              busyLabel="转换中…"
              disabled={blocked || !name.trim()}
              busy={busy}
              disarmKey={`to-cpu-local-${id}-${name}`}
              onConfirm={() => void submit()}
            />
          </div>
          {blocked && <p className="hint">预检有阻断项，转换按钮已禁用。</p>}
        </>
      )}
      {feedback && <p className="hint">{feedback}</p>}
    </StepCard>
  );
}

/** 步骤 4：批量解绑（缺 club.bindings.unbind 权限时禁用并说明；部分失败逐行展示、可原样重试） */
function StepUnbind({
  id,
  state,
  show,
  onMutated,
  canUnbind,
}: {
  id: number;
  state: CpuDetachState;
  show: ShowToast;
  onMutated: () => void;
  canUnbind: boolean;
}) {
  const { dateTime } = useTimeFmt();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CpuDetachUnbindResult | null>(null);

  const pending = state.bindings.length;
  const notCpu = !state.club.isCpu;

  async function unbindAll() {
    if (busy || !canUnbind) return;
    setBusy(true);
    try {
      const res = await apiPost<CpuDetachUnbindResult>(`/api/admin/clubs/${id}/to-cpu/unbind-all`, {});
      setResult(res);
      if (res.ok) show(`已解绑全部 ${res.unbound.length} 个账号。`);
      else show(`有 ${res.failed.length} 个账号解绑失败，可逐行重试。`, true);
      onMutated();
    } catch (err) {
      show(err instanceof Error ? err.message : '批量解绑失败', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepCard no={4} title="批量解绑" status={pending === 0 ? <span className="badge green">已完成</span> : <span className="badge gray">待处理</span>}>
      {pending === 0 ? (
        <p className="hint">没有待解绑的账号。</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>账号</th>
                <th>绑定时间</th>
              </tr>
            </thead>
            <tbody>
              {state.bindings.map((b) => (
                <tr key={b.userId}>
                  <td>
                    {b.userName ?? '—'} <span className="muted">#{b.userId}</span>
                  </td>
                  <td>{dateTime(b.boundAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!canUnbind && (
        <p className="hint">
          <span className="badge red">缺少权限</span> 当前账号没有 club.bindings.unbind 权限，无法批量解绑；请让有权限的管理员执行，或到俱乐部管理逐个解绑。
        </p>
      )}
      {notCpu && <p className="hint">先完成步骤 3 把队伍置为 CPU 队，再回来解绑。</p>}
      {pending > 0 && (
        <div className="btn-row">
          <ConfirmButton
            label={`一键解绑全部（${pending}）`}
            confirmLabel="再点一次确认解绑"
            busyLabel="解绑中…"
            disabled={!canUnbind || notCpu}
            busy={busy}
            disarmKey={`to-cpu-unbind-${pending}`}
            onConfirm={() => void unbindAll()}
          />
        </div>
      )}
      {result && (
        <div className="hint">
          <p>
            本次解绑 {result.unbound.length} 个，另有 {result.alreadyUnbound.length} 个本就未绑定
            {result.failed.length > 0 ? `，失败 ${result.failed.length} 个（见下表，可重试）` : '。'}
          </p>
          {result.failed.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>账号</th>
                    <th>错误码</th>
                    <th>原因</th>
                  </tr>
                </thead>
                <tbody>
                  {result.failed.map((f) => (
                    <tr key={f.userId}>
                      <td>#{f.userId}</td>
                      <td className="mono">{f.code}</td>
                      <td>{f.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.failed.length > 0 && (
            <button className="btn btn-ghost btn-sm" type="button" disabled={busy || !canUnbind} onClick={() => void unbindAll()}>
              {busy ? '重试中…' : '重试失败的账号'}
            </button>
          )}
        </div>
      )}
    </StepCard>
  );
}

/** 步骤 5：复核六项（GET 复用预检端点，一项不过就还没收口） */
function StepReview({ state, onMutated, refreshing }: { state: CpuDetachState; onMutated: () => void; refreshing: boolean }) {
  const rows: { key: keyof CpuDetachState['checks']; label: string; detail: string }[] = [
    { key: 'isCpu', label: '已置 CPU 标', detail: '登记册 clubs.is_cpu=1' },
    { key: 'tourName', label: '赛事系统队名带 (CPU) 后缀', detail: state.tour ? `当前「${state.tour.name}」` : '对手方查无此队，按通过处理' },
    { key: 'localName', label: '本仓队名带 (CPU) 后缀', detail: `当前「${state.club.name}」` },
    { key: 'bindings', label: '绑定账号已清零', detail: state.bindings.length > 0 ? `还剩 ${state.bindings.length} 个` : '0 个' },
    { key: 'codes', label: '没有未使用的绑定码', detail: state.unusedCodes.length > 0 ? `还剩 ${state.unusedCodes.length} 张` : '0 张' },
    {
      key: 'funds',
      label: '余额与消费券已清零',
      detail: `余额 ${state.balance.toFixed(2)}m · 消费券 ${state.vouchers.toFixed(2)}`,
    },
  ];
  return (
    <StepCard
      no={5}
      title="复核"
      status={state.ready ? <span className="badge green">已完成</span> : <span className="badge gray">待处理</span>}
    >
      <p className="hint">
        <span className={`badge ${state.ready ? 'green' : 'gold'}`}>{state.ready ? '六项全部通过，转换完成' : '还有未通过项'}</span>{' '}
        复核六项逐项对照；置 CPU 后余额与券必须为 0，重新接管时不会退回。
      </p>
      <ul className="hint">
        {rows.map((row) => (
          <li key={row.key}>
            <span className={`badge ${state.checks[row.key] ? 'green' : 'red'}`}>{state.checks[row.key] ? '通过' : '未通过'}</span> {row.label}
            <span className="muted"> · {row.detail}</span>
          </li>
        ))}
      </ul>
      <div className="btn-row">
        <button className="btn btn-ghost btn-sm" type="button" disabled={refreshing} onClick={onMutated}>
          {refreshing ? '刷新中…' : '重新复核'}
        </button>
      </div>
    </StepCard>
  );
}
