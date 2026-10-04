// 管理端 · CPU 接管向导（v6.27.0）：把电脑队转成真人可接管的俱乐部，五步一条线走完 ——
// ① 赛事系统对手方改名 ② 本仓改名并摘 CPU 标 ③ 运营基建一键建 ④ 发认证码 ⑤ 绑定确认。
// 入口：俱乐部管理里 CPU 行的「接管向导」；无 id（或 id 非法）先出 CPU 队选择器，有 id 才进向导。
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  apiPost,
  type CpuConvertState,
  type CpuRenameLocalResult,
  type CpuRenameTourResult,
  type CpuSeedOpsResult,
} from '../../lib/api.ts';
import { ADMIN_CLUBS_KEY, CPU_CONVERT_KEY, fetchAdminClubs, fetchCpuConvert } from '../../lib/adminQueries.ts';
import { LEAGUE_TIER_LABEL } from '../../lib/ref.ts';
import { useToast } from '../../lib/toast.tsx';
import { useTimeFmt } from '../../lib/datetime.ts';
import ConfirmButton from '../../components/ConfirmButton.tsx';
import EmptyState from '../../components/EmptyState.tsx';

type ShowToast = (text: string, err?: boolean) => void;

export default function CpuConvertPage() {
  const [params] = useSearchParams();
  const raw = params.get('id') ?? '';
  const id = /^\d+$/.test(raw) ? Number(raw) : 0;
  return <div className="admin-page">{id > 0 ? <ConvertWizard id={id} /> : <CpuPicker />}</div>;
}

/** leagueTier 中文标签；空/未知分别回落「未定级」与原文 */
function tierText(tier: string | null | undefined): string {
  if (!tier) return '未定级';
  return LEAGUE_TIER_LABEL[tier] ?? tier;
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

/* ---------- 无 id / id 非法：CPU 队选择器 ---------- */

function CpuPicker() {
  const { show, toastNode } = useToast();
  const { data: clubs, error } = useQuery({ queryKey: ADMIN_CLUBS_KEY, queryFn: fetchAdminClubs });

  useEffect(() => {
    if (error) show(error instanceof Error ? error.message : '俱乐部列表加载失败', true);
  }, [error, show]);

  const cpus = clubs?.filter((c) => c.isCpu) ?? [];

  return (
    <section className="card admin-section">
      <h2>CPU 接管向导</h2>
      {toastNode}
      <p className="hint">
        把电脑队转成真人可接管的俱乐部，五步一条线：赛事系统改名 → 本仓改名摘 CPU 标 → 建运营基建 → 发认证码 → 绑定确认。
        下面只列带 CPU 标的队；摘标之后它会自动从这里消失（本页直链仍能回来看）。
      </p>
      {clubs === undefined ? (
        <p className="muted">正在翻登记册…</p>
      ) : cpus.length === 0 ? (
        <EmptyState>没有待接管的 CPU 队</EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>俱乐部</th>
                <th>级别</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {cpus.map((club) => (
                <tr key={club.id}>
                  <td>
                    {club.name} <span className="muted">#{club.id}</span>
                  </td>
                  <td>{tierText(club.leagueTier)}</td>
                  <td>
                    <Link className="btn btn-ghost btn-sm" to={`/admin/clubs/cpu-convert?id=${club.id}`}>
                      进入接管向导
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

function ConvertWizard({ id }: { id: number }) {
  const { show, toastNode } = useToast();
  const queryClient = useQueryClient();
  const { data: state, error, isFetching } = useQuery({ queryKey: CPU_CONVERT_KEY(id), queryFn: () => fetchCpuConvert(id) });

  useEffect(() => {
    if (error) show(error instanceof Error ? error.message : '接管状态加载失败', true);
  }, [error, show]);

  // 五步动作后的统一刷新：重拉接管状态；登记册/总览各自精确 invalidate（改名摘标动列表，绑定动教练列）
  const refresh = () => void queryClient.invalidateQueries({ queryKey: CPU_CONVERT_KEY(id) });

  if (!state) {
    return (
      <section className="card admin-section">
        <h2>CPU 接管向导</h2>
        {toastNode}
        <p className="muted">{error ? '接管状态读不出来——回列表重试，或核对这支队的编号。' : '正在读接管状态…'}</p>
        <p>
          <Link to="/admin/clubs/cpu-convert">← 返回 CPU 队列表</Link>
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
          <span className={`badge ${state.club.isCpu ? 'gold' : 'green'}`}>{state.club.isCpu ? 'CPU 队' : '已摘 CPU 标'}</span>{' '}
          级别 {tierText(state.club.leagueTier)} · 状态 {state.club.status}
          {isFetching ? ' · 刷新中…' : ''} · <Link to="/admin/clubs/cpu-convert">返回 CPU 队列表</Link>
        </p>
      </section>
      <StepTour id={id} state={state} show={show} onMutated={refresh} />
      <StepLocal id={id} state={state} show={show} onMutated={refresh} />
      <StepOps id={id} state={state} show={show} onMutated={refresh} />
      <StepCode id={id} clubName={state.club.name} bound={state.binding.bound} show={show} onMutated={refresh} />
      <StepBinding state={state} show={show} onMutated={refresh} refreshing={isFetching} />
    </>
  );
}

/** 步骤 1：赛事系统对手方改名（tour 查无此队时只提示，可跳过） */
function StepTour({ id, state, show, onMutated }: { id: number; state: CpuConvertState; show: ShowToast; onMutated: () => void }) {
  const [name, setName] = useState(state.suggest.newName);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [doneFlag, setDoneFlag] = useState(false);

  const tour = state.tour;
  const done = doneFlag || (tour !== null && tour.name === state.suggest.newName);

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
      const res = await apiPost<CpuRenameTourResult>(`/api/admin/clubs/${id}/rename-tour`, { name: target });
      setDoneFlag(true);
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
      no={1}
      title="对手方（赛事系统）改名"
      status={tour === null ? <span className="badge gray">对手方查无此队</span> : done ? <span className="badge green">已完成</span> : <span className="badge gray">待处理</span>}
    >
      {tour === null ? (
        <p className="hint">赛事系统里查不到 #{id} 号球队——这一步可以跳过，继续往下走；等球队补建出来再回来改也可以。</p>
      ) : (
        <p className="hint">
          对手方在赛事系统里现在叫「{tour.name}」，建议改成「{state.suggest.newName}」。改名会直接推给赛事系统，失败会给出原因，稍后重试即可。
        </p>
      )}
      <form className="inline-form" onSubmit={submit}>
        <label className="field grow">
          新队名
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} disabled={tour === null} placeholder="新队名" />
        </label>
        <button className="btn" type="submit" disabled={busy || tour === null || !name.trim()}>
          {busy ? '推送中…' : '改名并推送'}
        </button>
      </form>
      {feedback && <p className="hint">{feedback}</p>}
    </StepCard>
  );
}

/** 步骤 2：本仓改名并摘 CPU 标（changed=false 即此前已转换，幂等提示） */
function StepLocal({ id, state, show, onMutated }: { id: number; state: CpuConvertState; show: ShowToast; onMutated: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(state.suggest.newName);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const done = !state.club.isCpu;

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
      const res = await apiPost<CpuRenameLocalResult>(`/api/admin/clubs/${id}/rename-local`, { name: target });
      setFeedback(
        res.changed
          ? `已转换为「${res.name ?? target}」，CPU 标已摘掉。`
          : '此前已摘 CPU 标（幂等）：这支队早就是真人俱乐部了，本次什么都没动。',
      );
      onMutated();
      void queryClient.invalidateQueries({ queryKey: ADMIN_CLUBS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] });
    } catch (err) {
      show(err instanceof Error ? err.message : '改名失败', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepCard no={2} title="本仓改名并摘 CPU 标" status={done ? <span className="badge green">已完成</span> : <span className="badge gray">待处理</span>}>
      <p className="hint">
        把登记册里的队名改成接管后的真人队名，同时摘掉 CPU 标。撞名会被拦下并给原因（换个名字再试）；摘标后此队从 CPU 列表消失，本页直链仍能回来看。
      </p>
      <form className="inline-form" onSubmit={submit}>
        <label className="field grow">
          新队名
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="新队名" />
        </label>
        <button className="btn" type="submit" disabled={busy || !name.trim()}>
          {busy ? '转换中…' : '改名并摘 CPU 标'}
        </button>
      </form>
      {feedback && <p className="hint">{feedback}</p>}
    </StepCard>
  );
}

/** 步骤 3：运营基建一键建（只建不改，重复执行幂等） */
function StepOps({ id, state, show, onMutated }: { id: number; state: CpuConvertState; show: ShowToast; onMutated: () => void }) {
  const [stadiumName, setStadiumName] = useState(`${state.suggest.newName}主场`);
  const [shellInfluence, setShellInfluence] = useState(String(state.suggest.shellInfluence));
  const [bonusPoints, setBonusPoints] = useState(String(state.suggest.bonusPoints));
  const [leagueTier, setLeagueTier] = useState(state.suggest.leagueTier ?? '');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const done = state.infra.stadium && state.infra.ledger && state.infra.facilities > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const shell = Number(shellInfluence);
    const bonus = Number(bonusPoints);
    if (!stadiumName.trim()) {
      show('球场名不能为空', true);
      return;
    }
    if (!Number.isFinite(shell) || !Number.isFinite(bonus)) {
      show('队壳影响力与奖励分要填数字', true);
      return;
    }
    if (!leagueTier) {
      show('先选联赛级别', true);
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiPost<CpuSeedOpsResult>(`/api/admin/clubs/${id}/seed-ops`, {
        stadiumName: stadiumName.trim(),
        shellInfluence: shell,
        bonusPoints: bonus,
        leagueTier,
      });
      const parts = [
        `球场${res.created.stadium ? '已新建' : '已存在'}`,
        `账本${res.created.ledger ? '已新建' : '已存在'}`,
        `设施${res.created.facilities > 0 ? `已新建 ${res.created.facilities} 项` : '已存在'}`,
      ];
      setFeedback(`基建就位（${parts.join(' · ')}），定级 ${tierText(res.leagueTier)}；这支队的目标死忠数是 ${state.suggest.diehardTarget} 人。`);
      onMutated();
    } catch (err) {
      show(err instanceof Error ? err.message : '运营基建创建失败', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepCard no={3} title="运营基建一键建" status={done ? <span className="badge green">已完成</span> : <span className="badge gray">待处理</span>}>
      <p className="hint">
        只建不改：一键铺好主场球场、俱乐部账本与设施，重复执行是幂等的（已有的不动）；要改具体值，走「俱乐部管理」的主场档案与设施入口。
        当前基建：球场{state.infra.stadium ? '有' : '无'} · 账本{state.infra.ledger ? '有' : '无'} · 设施 {state.infra.facilities} 项；初始球迷目标 {state.suggest.diehardTarget} 人。
      </p>
      <form className="inline-form" onSubmit={submit}>
        <label className="field grow">
          球场名
          <input value={stadiumName} onChange={(e) => setStadiumName(e.target.value)} maxLength={60} placeholder="如 XX 体育场" />
        </label>
        <label className="field">
          队壳影响力
          <input className="mono" value={shellInfluence} onChange={(e) => setShellInfluence(e.target.value)} placeholder="如 5.5" />
        </label>
        <label className="field">
          奖励分
          <input className="mono" value={bonusPoints} onChange={(e) => setBonusPoints(e.target.value)} placeholder="如 0" />
        </label>
        <label className="field">
          联赛级别
          <select value={leagueTier} onChange={(e) => setLeagueTier(e.target.value)}>
            {!leagueTier && <option value="">选级别…</option>}
            <option value="premier">顶级联赛</option>
            <option value="second">次级联赛</option>
          </select>
        </label>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? '铺设中…' : '一键建基建'}
        </button>
      </form>
      {feedback && <p className="hint">{feedback}</p>}
    </StepCard>
  );
}

/** 步骤 4：发认证码（明码只显示一次，照俱乐部管理的 code-card 做法） */
function StepCode({ id, clubName, bound, show, onMutated }: { id: number; clubName: string; bound: boolean; show: ShowToast; onMutated: () => void }) {
  const { dateTime } = useTimeFmt();
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);

  async function issue() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiPost<{ code: string; expiresAt: string }>(`/api/admin/clubs/${id}/bindcode`, {});
      setCode(res);
      onMutated();
    } catch (err) {
      show(err instanceof Error ? err.message : '发码失败', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepCard no={4} title="发认证码" status={bound ? <span className="badge green">已完成</span> : <span className="badge gray">待处理</span>}>
      <p className="hint">
        发一张绑定认证码，交给接手的教练在登录后输入完成绑定。明码只显示这一次；没收到或过期了再发一张即可（旧的自动作废）。
      </p>
      <button className="btn" type="button" disabled={busy} onClick={() => void issue()}>
        {busy ? '发码中…' : '发认证码'}
      </button>
      {code && (
        <div className="code-card">
          <p>
            <b>{clubName}</b> 的绑定认证码（明码只显示这一次，过期时间 {dateTime(code.expiresAt)}）：
          </p>
          <div className="code-display mono">{code.code}</div>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(code.code);
              show('认证码已复制。');
            }}
          >
            复制认证码
          </button>
        </div>
      )}
    </StepCard>
  );
}

/** 步骤 5：绑定确认 + 异常解绑兜底（解绑照俱乐部管理的同一端点） */
function StepBinding({ state, show, onMutated, refreshing }: { state: CpuConvertState; show: ShowToast; onMutated: () => void; refreshing: boolean }) {
  const queryClient = useQueryClient();
  const { dateTime } = useTimeFmt();
  const b = state.binding;

  async function unbind() {
    if (b.userId === null) return;
    try {
      await apiPost('/api/admin/bindings/unbind', { userId: b.userId });
      show(`已解绑（用户 #${b.userId}）。`);
      onMutated();
      void queryClient.invalidateQueries({ queryKey: ADMIN_CLUBS_KEY });
    } catch (err) {
      show(err instanceof Error ? err.message : '解绑失败', true);
    }
  }

  return (
    <StepCard no={5} title="绑定确认" status={b.bound ? <span className="badge green">已完成</span> : <span className="badge gray">待处理</span>}>
      {b.bound ? (
        <p className="hint">
          已绑定：<b>{b.userName ?? `用户 #${b.userId}`}</b>
          {b.boundAt ? ` · 绑定于 ${dateTime(b.boundAt)}` : ''}。接管完成，此后的经营由这位教练负责。
        </p>
      ) : (
        <p className="hint">还没绑定。先到步骤 4 发一张认证码交给接手的教练；对方输入成功后，这里会显示教练与绑定时间。</p>
      )}
      <div className="btn-row">
        {b.bound && (
          <ConfirmButton
            className="btn-ghost btn-sm"
            label="异常解绑兜底"
            confirmLabel="再点一次确认解绑"
            disarmKey={`cpu-bound-${b.userId ?? 0}`}
            onConfirm={() => void unbind()}
          />
        )}
        <button className="btn btn-ghost btn-sm" type="button" disabled={refreshing} onClick={onMutated}>
          {refreshing ? '刷新中…' : '刷新绑定状态'}
        </button>
      </div>
    </StepCard>
  );
}
