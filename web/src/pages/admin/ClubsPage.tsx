// 管理端 · 俱乐部页：建队、绑定认证码、解绑、转会冻结、主场档案（原 Admin.tsx ClubsSection，增量 15 拆分）
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiDelete, apiPost, type AdminClubRow, type StadiumAdmin } from '../../lib/api.ts';
import { ADMIN_CLUBS_KEY, fetchAdminClubs } from '../../lib/adminQueries.ts';
import { LEAGUE_TIER_LABEL } from '../../lib/ref.ts';
import { useToast } from '../../lib/toast.tsx';
import ConfirmButton from '../../components/ConfirmButton.tsx';
import EmptyState from '../../components/EmptyState.tsx';
import { usePrompt } from '../../components/PromptDialog.tsx';

export default function ClubsPage() {
  return (
    <div className="admin-page">
      <ClubsSection />
    </div>
  );
}

function ClubsSection() {
  const { show, toastNode } = useToast();
  const { ask, promptNode } = usePrompt();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [gameTeamId, setGameTeamId] = useState('');
  const [prefilling, setPrefilling] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newCode, setNewCode] = useState<{ club: string; code: string; expiresAt: string } | null>(null);
  const [stadium, setStadium] = useState<{ club: string; clubId: number; form: StadiumForm; tierName: string | null; fans: number; influence: StadiumAdmin['influence'] } | null>(null);

  const { data: clubsData, error: clubsError } = useQuery({
    queryKey: ADMIN_CLUBS_KEY,
    queryFn: fetchAdminClubs,
  });
  const clubs = clubsData ?? null;

  useEffect(() => {
    if (clubsError) show(clubsError instanceof Error ? clubsError.message : '俱乐部列表加载失败', true);
  }, [clubsError, show]);

  const reload = () => queryClient.invalidateQueries({ queryKey: ADMIN_CLUBS_KEY });

  // 游戏球队 ID 失焦 → tour 查队名预填（名字已被手填过则不动）
  async function prefillName() {
    const id = gameTeamId.trim();
    if (!id || !/^\d+$/.test(id) || prefilling) return;
    setPrefilling(true);
    try {
      const res = await api<{ team: { id: number; name: string } }>(`/api/admin/clubs/tour-team?teamId=${id}`);
      if (!name.trim()) setName(res.team.name);
    } catch {
      // 查不到不打断：留到提交时后端统一校验（404 文案更完整）
    } finally {
      setPrefilling(false);
    }
  }

  async function createClub(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      const res = await apiPost<{ club: { name: string }; authLinked: boolean | null }>('/api/admin/clubs', {
        name: name.trim(),
        gameTeamId: gameTeamId.trim(),
      });
      setName('');
      setGameTeamId('');
      if (res.authLinked === false) {
        show(`${res.club.name} 已建，但认证中心目录登记失败——稍后点列表里的「重新登记」。`, true);
      } else {
        show('俱乐部建好了，登记册上多了一页。');
      }
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '建队失败', true);
    } finally {
      setCreating(false);
    }
  }

  async function registerAuth(club: AdminClubRow) {
    try {
      await apiPost(`/api/admin/clubs/${club.id}/register-auth`, {});
      show(`${club.name} 的认证中心目录已登记。`);
    } catch (err) {
      show(err instanceof Error ? err.message : '登记失败', true);
    }
  }

  async function issueCode(club: AdminClubRow) {
    try {
      const res = await apiPost<{ code: string; expiresAt: string }>(`/api/admin/clubs/${club.id}/bindcode`, {});
      setNewCode({ club: club.name, code: res.code, expiresAt: res.expiresAt });
    } catch (err) {
      show(err instanceof Error ? err.message : '发码失败', true);
    }
  }

  async function doUnbind(club: AdminClubRow, userId: number) {
    try {
      await apiPost('/api/admin/bindings/unbind', { userId });
      show(`${club.name} 已解绑（用户 #${userId}）。`);
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '解绑失败', true);
    }
  }

  interface StadiumForm {
    name: string;
    capacity: string;
    tier: string;
    shellInfluence: string;
    bonusPoints: string;
  }

  async function openStadium(club: AdminClubRow) {
    try {
      const res = await api<StadiumAdmin>(`/api/admin/clubs/${club.id}/stadium`);
      setStadium({
        club: club.name,
        clubId: club.id,
        form: {
          name: res.stadium.name ?? '',
          capacity: String(res.stadium.capacity),
          tier: String(res.stadium.tier),
          shellInfluence: String(res.stadium.shellInfluence),
          bonusPoints: String(res.stadium.bonusPoints),
        },
        tierName: res.tier?.name ?? null,
        fans: res.stadium.fans,
        influence: res.influence,
      });
    } catch (err) {
      show(err instanceof Error ? err.message : '主场档案加载失败', true);
    }
  }

  async function saveStadium() {
    if (!stadium) return;
    try {
      await apiPost(`/api/admin/clubs/${stadium.clubId}/stadium`, {
        name: stadium.form.name,
        capacity: Number(stadium.form.capacity),
        tier: Number(stadium.form.tier),
        shellInfluence: Number(stadium.form.shellInfluence),
        bonusPoints: Number(stadium.form.bonusPoints),
      });
      show(`${stadium.club} 的主场档案已更新。`);
      setStadium(null);
    } catch (err) {
      show(err instanceof Error ? err.message : '主场档案保存失败', true);
    }
  }

  async function toggleBan(club: AdminClubRow) {
    try {
      if (club.transferBanned) {
        await apiDelete(`/api/admin/clubs/${club.id}/transfer-ban`);
        show(`${club.name} 已解冻转会权限。`);
      } else {
        const reason = await ask(`冻结「${club.name}」转会权限——原因（至少两个字，会进审计）：`);
        if (!reason) return;
        await apiPost(`/api/admin/clubs/${club.id}/transfer-ban`, { reason });
        show(`${club.name} 转会权限已冻结，挂单/出价/海捞/议价全被拦下。`);
      }
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '操作失败', true);
    }
  }

  return (
    <section className="card admin-section">
      <h2>俱乐部管理</h2>
      {toastNode}
      {promptNode}
      <form className="inline-form" onSubmit={createClub}>
        <label className="field">
          游戏球队 ID
          <input
            className="mono"
            value={gameTeamId}
            onChange={(e) => setGameTeamId(e.target.value)}
            onBlur={prefillName}
            placeholder="必填，如 131681"
            inputMode="numeric"
          />
        </label>
        <label className="field grow">
          俱乐部名字
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="留空则取赛事系统队名" maxLength={40} />
        </label>
        <button className="btn" type="submit" disabled={creating || !gameTeamId.trim()}>
          {creating ? '建队中…' : '建俱乐部'}
        </button>
      </form>
      <p className="hint">
        联赛级别不再建队时定死：由各队在本赛季报名的定级赛事（顶级/次级联赛）自动派生。球队 ID 必须与游戏内一致（赛事系统先建队），
        俱乐部将以该 ID 建档并在认证中心自动登记；登记失败可稍后点「重新登记」。
      </p>

      {clubs === null ? (
        <p className="muted">正在翻登记册…</p>
      ) : clubs.length === 0 ? (
        <EmptyState>登记册还是空的。先建第一支俱乐部。</EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>俱乐部</th>
                <th>级别</th>
                <th>绑定教练</th>
                <th>最近认证码</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {clubs.map((club) => (
                <tr key={club.id}>
                  <td>
                    {club.name} <span className="muted">#{club.id}</span>
                    {club.transferBanned && <span className="badge red" title="挂单/出价/海捞/议价已被拦下">转会冻结</span>}
                  </td>
                  <td>{club.leagueTier ? (LEAGUE_TIER_LABEL[club.leagueTier] ?? club.leagueTier) : <span className="muted">未定级</span>}</td>
                  <td>
                    {club.bindings.length === 0 ? (
                      <span className="muted">未绑定</span>
                    ) : (
                      club.bindings.map((b) => (
                        <span key={b.userId}>
                          {b.userName ?? `用户 #${b.userId}`}
                          <ConfirmButton
                            className="btn-ghost btn-sm unbind-btn"
                            label="解绑"
                            confirmLabel="再点一次确认解绑"
                            disarmKey={`bound-${b.userId}`}
                            onConfirm={() => doUnbind(club, b.userId)}
                          />
                        </span>
                      ))
                    )}
                  </td>
                  <td className="hint">
                    {club.latestCode
                      ? club.latestCode.usedAt
                        ? `已用（${club.latestCode.usedAt.slice(0, 10)}）`
                        : `未用 · 至 ${club.latestCode.expiresAt?.slice(0, 16) ?? '长期'}`
                      : '—'}
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => issueCode(club)}>
                      发认证码
                    </button>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => registerAuth(club)} title="认证中心目录登记（建队时自动做过；失败后从这里重试，幂等）">
                      重新登记
                    </button>
                    <button
                      className={`btn btn-sm ${club.transferBanned ? 'btn' : 'btn-ghost btn-danger'}`}
                      type="button"
                      onClick={() => toggleBan(club)}
                    >
                      {club.transferBanned ? '解冻转会' : '冻结转会'}
                    </button>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => openStadium(club)}>
                      主场
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {stadium && (
        <div className="code-card">
          <p>
            <b>{stadium.club}</b> 的主场档案 —— 死忠 <span className="mono">{Math.round(stadium.fans).toLocaleString()}</span>，影响力{' '}
            <span className="mono">{stadium.influence.total.toFixed(1)}</span>（球员 {stadium.influence.players.toFixed(1)} + 队壳 {stadium.influence.shell.toFixed(1)} + 奖励分 {stadium.influence.bonus.toFixed(1)}，球员项按规则公式自动算）
          </p>
          <div className="import-grid">
            <label className="field">
              球场名
              <input value={stadium.form.name} onChange={(e) => setStadium({ ...stadium, form: { ...stadium.form, name: e.target.value } })} placeholder="未冠名可留空" />
            </label>
            <label className="field">
              容量（座）
              <input className="mono" value={stadium.form.capacity} onChange={(e) => setStadium({ ...stadium, form: { ...stadium.form, capacity: e.target.value } })} />
            </label>
            <label className="field">
              档位（0-4{stadium.tierName ? `，当前 ${stadium.tierName}` : ''}）
              <input className="mono" value={stadium.form.tier} onChange={(e) => setStadium({ ...stadium, form: { ...stadium.form, tier: e.target.value } })} />
            </label>
            <label className="field">
              队壳影响力
              <input className="mono" value={stadium.form.shellInfluence} onChange={(e) => setStadium({ ...stadium, form: { ...stadium.form, shellInfluence: e.target.value } })} />
            </label>
            <label className="field">
              奖励分
              <input className="mono" value={stadium.form.bonusPoints} onChange={(e) => setStadium({ ...stadium, form: { ...stadium.form, bonusPoints: e.target.value } })} />
            </label>
          </div>
          <div className="actions">
            <button className="btn" type="button" onClick={saveStadium}>
              保存主场档案
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setStadium(null)}>
              取消
            </button>
          </div>
        </div>
      )}

      {newCode && (
        <div className="code-card">
          <p>
            <b>{newCode.club}</b> 的绑定认证码（明码只显示这一次，过期时间 {newCode.expiresAt.slice(0, 16).replace('T', ' ')}）：
          </p>
          <div className="code-display mono">{newCode.code}</div>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(newCode.code);
              show('认证码已复制。');
            }}
          >
            复制认证码
          </button>
        </div>
      )}
    </section>
  );
}
