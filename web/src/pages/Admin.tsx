// 管理端（增量 1+2+3+5+6）：建队与认证码、球员导入管线（两段式）、名单合同模板导入、期初余额、手动记账、
// 注册体检、审核队列（含旁路单据）、转会窗口状态机、赛季与赛事绑定、赛果确认、强制拍卖、config 查看
import { useCallback, useEffect, useState } from 'react';
import {
  api,
  apiPost,
  COMPETITION_TYPE_LABEL,
  ledgerKindLabel,
  MANUAL_GROWTH_TYPES,
  MANUAL_LEDGER_KINDS,
  TOUR_SITE_URL,
  TOUR_STATUS_LABEL,
  type AdminClubRow,
  type AdminRegistrations,
  type AdminReviewRow,
  type AdminReviews,
  type BindTournamentResult,
  type CloseWindowResult,
  type ComplianceReport,
  type ConfigRow,
  type ContractImportConfirm,
  type ContractImportPreview,
  type ConfirmResultResult,
  type ForcedAuctionResult,
  type GrowthSettlementResult,
  type ImportConfirm,
  type ImportPreview,
  type ManualLedgerResult,
  type M0Report,
  type MarketListings,
  type MeUser,
  type OpenWindowResult,
  type OpeningImportResult,
  type ResultsQueue,
  type SeasonBinding,
  type SeasonBindingsResponse,
  type SeasonCurrent,
  type SeasonRow,
  type SeasonsResponse,
  type TournamentRow,
  type WindowsResponse,
} from '../lib/api.ts';
import { LEAGUE_TIER_LABEL } from '../lib/ref.ts';
import { useToast } from '../lib/toast.tsx';

// 每个请求带的行数上限：Worker 侧校验 + 落库都按小批走，前端切片
const IMPORT_SLICE = 1000;
const REQUIRED_A = ['ID', 'Name', 'Age', 'CA', 'PA', 'naID', 'PosID1', 'FootID'];
const REQUIRED_B = ['playerid', 'overallrating', 'potential', 'Position', 'preferredfoot'];
const REQUIRED_C = ['uid', 'releaseFee', 'wage', 'effectiveFrom', 'contractType'];

// 通道 C 的 CSV 表头别名（文档口径：uid/RC/工资/效力起点/类型）→ 规范键
const C_HEADER_ALIASES: Record<string, string> = {
  uid: 'uid',
  id: 'uid',
  fc_id: 'uid',
  playerid: 'uid',
  rc: 'releaseFee',
  release_fee: 'releaseFee',
  releasefee: 'releaseFee',
  违约金: 'releaseFee',
  wage: 'wage',
  工资: 'wage',
  effective_from: 'effectiveFrom',
  effectivefrom: 'effectiveFrom',
  效力起点: 'effectiveFrom',
  contract_type: 'contractType',
  contracttype: 'contractType',
  合同类型: 'contractType',
  类型: 'contractType',
};

type Channel = 'A' | 'B' | 'C';

function toCanonicalContractRow(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = C_HEADER_ALIASES[k.trim().toLowerCase()];
    if (key) out[key] = v;
  }
  return out;
}

async function parseXlsx(file: File, channel: Channel): Promise<Record<string, unknown>[]> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', raw: false });
  const sheetName = channel === 'A' && wb.SheetNames.includes('Base') ? 'Base' : wb.SheetNames[0];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: null });
}

function requiredColumns(channel: Channel): string[] {
  return channel === 'A' ? REQUIRED_A : channel === 'B' ? REQUIRED_B : REQUIRED_C;
}

export default function Admin({ user }: { user: MeUser | null | undefined }) {
  return (
    <div className="container">
      <h1>管理端</h1>
      {user?.role === 'admin' ? (
        <>
          <SeasonsSection />
          <WindowsSection />
          <ClubsSection />
          <ImportSection />
          <ContractsSection />
          <RegistrationsSection />
          <ForcedAuctionSection />
          <ReviewsSection />
          <ResultsSection />
          <GrowthSection />
          <OpeningBalanceSection />
          <ManualLedgerSection />
          <M0Section />
          <ConfigSection />
        </>
      ) : (
        <div className="card empty-state">
          <p className="muted">
            这个页面只对管理组开放。不是管理组？回去看
            <a href={TOUR_SITE_URL} target="_blank" rel="noreferrer">
              赛事平台
            </a>
            就好。
          </p>
        </div>
      )}
    </div>
  );
}

/* ---------- 转会窗口状态机（TECH_DESIGN §11/§6.4-6） ---------- */

const WINDOW_STATUS_LABEL: Record<string, string> = { open: '进行中', closed: '已关闭' };

function WindowsSection() {
  const { show, toastNode } = useToast();
  const [data, setData] = useState<WindowsResponse | null>(null);
  const [season, setSeason] = useState('');
  const [seq, setSeq] = useState('');
  const [openBusy, setOpenBusy] = useState(false);
  const [closeArmed, setCloseArmed] = useState(false);
  const [forceArmed, setForceArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    api<WindowsResponse>('/api/admin/windows')
      .then(setData)
      .catch((err: unknown) => show(err instanceof Error ? err.message : '窗口列表加载失败', true));
  }, [show]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function openWindow() {
    if (openBusy) return;
    setOpenBusy(true);
    try {
      const res = await apiPost<OpenWindowResult>('/api/admin/windows/open', {
        ...(season.trim() === '' ? {} : { season: Number(season) }),
        ...(seq.trim() === '' ? {} : { windowSeq: Number(seq) }),
      });
      show(`窗口已开：第 ${res.season} 赛季 · 窗口 ${res.windowSeq}。全联盟经纪人档位重掷了 ${res.rerolled} 名球员。`);
      setSeason('');
      setSeq('');
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '开窗失败', true);
    } finally {
      setOpenBusy(false);
    }
  }

  async function closeWindow(force: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiPost<CloseWindowResult>('/api/admin/windows/close', force ? { force: true } : {});
      show(
        res.forceSettled > 0
          ? `第 ${res.season} 赛季窗口 ${res.windowSeq} 已关闭：${res.forceSettled} 场签约谈判按已定条款强制成约。`
          : `第 ${res.season} 赛季窗口 ${res.windowSeq} 已关闭，窗尾截止处理完成。`,
      );
      setCloseArmed(false);
      setForceArmed(false);
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '关窗失败', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card admin-section">
      <h2>转会窗口</h2>
      {toastNode}
      <p className="hint">
        同一时刻只有一个窗口开着。开窗会给全联盟球员重掷经纪人档位；关窗前先处理完市场截止单，
        并要求没有待审单、没有等待匹配的激活单、没有进行中的签约谈判——除非开了 window_force_settle 参数并用强制关窗，
        未谈完的谈判会按买方已提交的条款强制成约。
      </p>
      <div className="inline-form">
        <div className="field">
          <label htmlFor="win-season">赛季（留空顺延）</label>
          <input id="win-season" className="mono" type="number" min="1" value={season} onChange={(e) => setSeason(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="win-seq">窗口序号（留空顺延）</label>
          <input id="win-seq" className="mono" type="number" min="1" value={seq} onChange={(e) => setSeq(e.target.value)} />
        </div>
        <button className="btn" type="button" disabled={openBusy} onClick={openWindow}>
          {openBusy ? '开窗中…' : '开新窗'}
        </button>
      </div>
      <div className="inline-form">
        <button
          className={`btn${closeArmed ? ' btn-armed' : ''}`}
          type="button"
          disabled={busy}
          onClick={() => (closeArmed ? closeWindow(false) : setCloseArmed(true))}
          onBlur={() => setCloseArmed(false)}
        >
          {busy ? '处理中…' : closeArmed ? '再点一次确认关窗' : '关闭当前窗口'}
        </button>
        <button
          className={`btn btn-danger${forceArmed ? ' btn-armed' : ''}`}
          type="button"
          disabled={busy}
          onClick={() => (forceArmed ? closeWindow(true) : setForceArmed(true))}
          onBlur={() => setForceArmed(false)}
        >
          {forceArmed ? '再点一次确认强制关窗' : '强制关窗（强结谈判）'}
        </button>
      </div>

      {data === null ? (
        <p className="muted">正在翻窗口台账…</p>
      ) : data.windows.length === 0 ? (
        <div className="empty-state">
          <p className="muted">还没有开过窗。建好俱乐部、导完合同之后，从这里开第一扇窗。</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="num">赛季</th>
                <th className="num">窗口</th>
                <th>状态</th>
                <th>开窗时间</th>
                <th>关窗时间</th>
              </tr>
            </thead>
            <tbody>
              {data.windows.map((w) => (
                <tr key={`${w.season}-${w.windowSeq}`}>
                  <td className="num mono">{w.season}</td>
                  <td className="num mono">{w.windowSeq}</td>
                  <td>
                    <span className={`badge ${w.status === 'open' ? 'sky' : 'gray'}`}>{WINDOW_STATUS_LABEL[w.status] ?? w.status}</span>
                  </td>
                  <td className="mono">{w.openedAt?.slice(0, 16).replace('T', ' ') ?? '—'}</td>
                  <td className="mono">{w.closedAt?.slice(0, 16).replace('T', ' ') ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ---------- 强制拍卖（规则 4.4.5） ---------- */

const TRANSFER_TYPE_LABEL: Record<string, string> = {
  transfer: '普通成交',
  activation: '激活成交',
  forced_auction: '强制拍卖',
  rc_change: '续约',
  termination: '解约',
  free_agent: '海捞签入',
  match: '匹配留队',
};

function ForcedAuctionSection() {
  const { show, toastNode } = useToast();
  const [playerId, setPlayerId] = useState('');
  const [createArmed, setCreateArmed] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [open, setOpen] = useState<MarketListings | null>(null);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  const reload = useCallback(() => {
    api<MarketListings>('/api/market/listings?status=active')
      .then((d) => setOpen(d))
      .catch(() => setOpen(null));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const forced = (open?.listings ?? []).filter((l) => l.type === 'forced');

  async function create() {
    if (createBusy) return;
    setCreateBusy(true);
    try {
      const res = await apiPost<ForcedAuctionResult>('/api/admin/forced-auctions', { playerId: Number(playerId) });
      show(`强制拍卖已挂出：挂牌价 ${res.askPrice.toFixed(2)} m，1m 起拍，整单税 50%。`);
      setPlayerId('');
      setCreateArmed(false);
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '建强制拍卖失败', true);
    } finally {
      setCreateBusy(false);
    }
  }

  async function cancel(listingId: number) {
    if (cancelBusy) return;
    setCancelBusy(true);
    try {
      await apiPost(`/api/admin/forced-auctions/${listingId}/cancel`, {});
      show('强制拍卖已取消，挂牌下架。');
      setCancelId(null);
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '取消失败', true);
    } finally {
      setCancelBusy(false);
    }
  }

  return (
    <section className="card admin-section">
      <h2>强制拍卖</h2>
      {toastNode}
      <p className="hint">
        资格检查未过的处置手段：按 1m 挂牌强拍（只有本队 CA 前六、不含门将的球员可拍），成交整单税 50%。
        未成交前可以取消。
      </p>
      <div className="inline-form">
        <div className="field">
          <label htmlFor="forced-player">球员 ID</label>
          <input id="forced-player" className="mono" type="number" min="1" value={playerId} onChange={(e) => { setPlayerId(e.target.value); setCreateArmed(false); }} />
        </div>
        <button
          className={`btn${createArmed ? ' btn-armed' : ''}`}
          type="button"
          disabled={createBusy || playerId === '' || Number(playerId) < 1}
          onClick={() => (createArmed ? create() : setCreateArmed(true))}
          onBlur={() => setCreateArmed(false)}
        >
          {createBusy ? '挂出中…' : createArmed ? '再点一次确认挂出' : '挂出强制拍卖'}
        </button>
      </div>

      {forced.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>球员</th>
                <th className="num">起拍价（m）</th>
                <th className="num">当前最高（m）</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
                {forced.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.player.name}
                      <span className="muted">（所属 {l.sellerClub.name}）</span>
                    </td>
                  <td className="num mono">{l.askPrice.toFixed(2)}</td>
                  <td className="num mono">{l.highestBid?.toFixed(2) ?? '—'}</td>
                  <td>
                    <button
                      className={`btn btn-sm btn-danger${cancelId === l.id ? ' btn-armed' : ''}`}
                      type="button"
                      disabled={cancelBusy}
                      onClick={() => (cancelId === l.id ? cancel(l.id) : setCancelId(l.id))}
                      onBlur={() => setCancelId(null)}
                    >
                      {cancelBusy && cancelId === l.id ? '取消中…' : cancelId === l.id ? '再点一次确认取消' : '取消拍卖'}
                    </button>
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

/* ---------- 俱乐部管理 ---------- */

function ClubsSection() {
  const { show, toastNode } = useToast();
  const [clubs, setClubs] = useState<AdminClubRow[] | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newCode, setNewCode] = useState<{ club: string; code: string; expiresAt: string } | null>(null);
  const [unbinding, setUnbinding] = useState<number | null>(null);

  const reload = useCallback(() => {
    api<{ clubs: AdminClubRow[] }>('/api/admin/clubs')
      .then((d) => setClubs(d.clubs))
      .catch((err: unknown) => show(err instanceof Error ? err.message : '俱乐部列表加载失败', true));
  }, [show]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function createClub(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      await apiPost('/api/admin/clubs', { name: name.trim() });
      setName('');
      show('俱乐部建好了，登记册上多了一页。');
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '建队失败', true);
    } finally {
      setCreating(false);
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

  async function doUnbind(club: AdminClubRow) {
    if (!club.binding) return;
    try {
      await apiPost('/api/admin/bindings/unbind', { userId: club.binding.userId });
      show(`${club.name} 已解绑。`);
      setUnbinding(null);
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '解绑失败', true);
    }
  }

  return (
    <section className="card admin-section">
      <h2>俱乐部管理</h2>
      {toastNode}
      <form className="inline-form" onSubmit={createClub}>
        <label className="field grow">
          俱乐部名字
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="比如：阿森纳" maxLength={40} />
        </label>
        <button className="btn" type="submit" disabled={creating || !name.trim()}>
          {creating ? '建队中…' : '建俱乐部'}
        </button>
      </form>
      <p className="hint">联赛级别不再建队时定死：由各队在本赛季报名的定级赛事（顶级/次级联赛）自动派生。</p>

      {clubs === null ? (
        <p className="muted">正在翻登记册…</p>
      ) : clubs.length === 0 ? (
        <div className="empty-state">
          <p className="muted">登记册还是空的。先建第一支俱乐部。</p>
        </div>
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
                  </td>
                  <td>{club.leagueTier ? (LEAGUE_TIER_LABEL[club.leagueTier] ?? club.leagueTier) : <span className="muted">未定级</span>}</td>
                  <td>
                    {club.binding ? (
                      <>
                        {club.binding.userName ?? `用户 #${club.binding.userId}`}
                        <button
                          className="btn btn-ghost btn-sm unbind-btn"
                          type="button"
                          onClick={() => (unbinding === club.id ? doUnbind(club) : setUnbinding(club.id))}
                          onBlur={() => setUnbinding(null)}
                        >
                          {unbinding === club.id ? '再点一次确认解绑' : '解绑'}
                        </button>
                      </>
                    ) : (
                      <span className="muted">未绑定</span>
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

/* ---------- 球员导入 ---------- */

interface ImportState {
  channel: 'A' | 'B';
  rows: Record<string, unknown>[];
  fileName: string;
  preview: ImportPreview | null;
  previewBusy: boolean;
  armed: boolean;
  confirmBusy: boolean;
  result: ImportConfirm | null;
  progress: string;
}

function ImportSection() {
  const { show, toastNode } = useToast();
  const [state, setState] = useState<ImportState>({
    channel: 'A',
    rows: [],
    fileName: '',
    preview: null,
    previewBusy: false,
    armed: false,
    confirmBusy: false,
    result: null,
    progress: '',
  });
  const [starText, setStarText] = useState('');

  function patch(next: Partial<ImportState>) {
    setState((s) => ({ ...s, ...next }));
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    patch({ result: null, preview: null, armed: false });
    try {
      const rows = await parseXlsx(file, state.channel);
      if (rows.length === 0) {
        show('文件里没有数据行，检查一下是不是选错了工作表。', true);
        return;
      }
      const missing = requiredColumns(state.channel).filter((col) => !(col in rows[0]));
      if (missing.length > 0) {
        show(`缺少必需列：${missing.join('、')}`, true);
        return;
      }
      patch({ rows, fileName: file.name });
      show(`解析完成：${rows.length} 行。先跑预览看统计。`);
    } catch {
      show('文件解析失败，确认是 FC 源 xlsx 文件。', true);
    }
  }

  async function runPreview() {
    if (state.previewBusy || state.rows.length === 0) return;
    patch({ previewBusy: true, result: null, armed: false, preview: null });
    try {
      const futureStars = parseStarIds(starText);
      let preview: ImportPreview | null = null;
      let done = 0;
      for (let i = 0; i < state.rows.length; i += IMPORT_SLICE) {
        const slice = state.rows.slice(i, i + IMPORT_SLICE);
        const res = await apiPost<ImportPreview>('/api/admin/players/import/preview', {
          channel: state.channel,
          rows: slice,
          futureStarIds: futureStars,
        });
        if (preview === null) {
          preview = res;
        } else {
          preview.stats.total += res.stats.total;
          preview.stats.valid += res.stats.valid;
          preview.stats.error += res.stats.error;
          preview.stats.insertEstimate += res.stats.insertEstimate;
          preview.stats.updateEstimate += res.stats.updateEstimate;
          preview.errors.push(...res.errors);
          if (preview.samples.length < 5) preview.samples.push(...res.samples.slice(0, 5 - preview.samples.length));
        }
        done += slice.length;
        patch({ progress: `预览 ${done} / ${state.rows.length} 行` });
      }
      patch({ preview, previewBusy: false, progress: '' });
    } catch (err) {
      patch({ previewBusy: false, progress: '' });
      show(err instanceof Error ? err.message : '预览失败', true);
    }
  }

  async function runConfirm() {
    if (!state.armed || state.confirmBusy) return;
    patch({ confirmBusy: true });
    try {
      const futureStars = parseStarIds(starText);
      let result: ImportConfirm | null = null;
      let done = 0;
      for (let i = 0; i < state.rows.length; i += IMPORT_SLICE) {
        const slice = state.rows.slice(i, i + IMPORT_SLICE);
        const res = await apiPost<ImportConfirm>('/api/admin/players/import/confirm', {
          channel: state.channel,
          rows: slice,
          futureStarIds: futureStars,
        });
        if (result === null) result = res;
        else result.written += res.written;
        done += slice.length;
        patch({ progress: `落库 ${done} / ${state.rows.length} 行` });
      }
      patch({ result, armed: false, preview: null, rows: [], fileName: '', confirmBusy: false, progress: '' });
      show(`落库完成：${result?.written ?? 0} 行已写入。`);
    } catch (err) {
      patch({ armed: false, confirmBusy: false, progress: '' });
      show(err instanceof Error ? err.message : '落库失败', true);
    }
  }

  const preview = state.preview;
  const hasErrors = (preview?.stats.error ?? 0) > 0;

  return (
    <section className="card admin-section">
      <h2>球员导入</h2>
      {toastNode}
      <p className="hint">
        通道 A 收 FC26db 当季主源（选含 Base 工作表的整库文件）；通道 B 收 FC Editor 队壳文件（一队一个）。
        导入只写 FC 源列，身价、状态、徽章、成长这些运营数据不会被覆盖。
      </p>
      <div className="seg" role="radiogroup" aria-label="导入通道">
        <button
          type="button"
          className={state.channel === 'A' ? 'on' : ''}
          onClick={() => patch({ channel: 'A', rows: [], preview: null, result: null, armed: false, fileName: '' })}
        >
          通道 A · FC26db 当季主源
        </button>
        <button
          type="button"
          className={state.channel === 'B' ? 'on' : ''}
          onClick={() => patch({ channel: 'B', rows: [], preview: null, result: null, armed: false, fileName: '' })}
        >
          通道 B · FC Editor 队壳
        </button>
      </div>

      <label className="field">
        源文件（xlsx）
        <input type="file" accept=".xlsx,.xls" onChange={onFile} />
      </label>
      {state.fileName && (
        <p className="hint">
          已解析 <b>{state.fileName}</b>，共 {state.rows.length} 行。
        </p>
      )}
      {state.channel === 'A' && (
        <label className="field">
          未来之星 ID 列表（可选，从 Growth+ 表复制 ID，逗号或换行分隔；只作为预置建议，管理组核定后生效）
          <textarea value={starText} onChange={(e) => setStarText(e.target.value)} rows={2} placeholder="271421, 277643" />
        </label>
      )}

      <div className="btn-row">
        <button className="btn" type="button" disabled={state.rows.length === 0 || state.previewBusy} onClick={runPreview}>
          {state.previewBusy ? state.progress || '预览中…' : '第一步 · 预览'}
        </button>
        <button
          className={`btn${state.armed ? ' btn-armed' : ''}`}
          type="button"
          disabled={preview === null || hasErrors || state.confirmBusy || state.rows.length === 0}
          onClick={() => (state.armed ? runConfirm() : patch({ armed: true }))}
          onBlur={() => patch({ armed: false })}
        >
          {state.confirmBusy ? state.progress || '落库中…' : state.armed ? '再点一次确认落库' : '第二步 · 确认落库'}
        </button>
      </div>

      {state.result && (
        <div className="banner info">
          落库完成：写入 {state.result.written} 行（新增约 {state.result.insertedEstimate}、覆盖约 {state.result.updatedEstimate}），分{' '}
          {state.result.batches} 批。重复导入安全，运营数据不受影响。
        </div>
      )}

      {preview && (
        <>
          <div className="preview-stats">
            <div className="club-stat">
              <span className="stat-label">总行数</span>
              <span className="stat-value mono">{preview.stats.total}</span>
            </div>
            <div className="club-stat">
              <span className="stat-label">有效</span>
              <span className="stat-value mono">{preview.stats.valid}</span>
            </div>
            <div className="club-stat">
              <span className="stat-label">错误</span>
              <span className={`stat-value mono${hasErrors ? ' bad-text' : ''}`}>{preview.stats.error}</span>
            </div>
            <div className="club-stat">
              <span className="stat-label">新增预估</span>
              <span className="stat-value mono">{preview.stats.insertEstimate}</span>
            </div>
            <div className="club-stat">
              <span className="stat-label">覆盖预估</span>
              <span className="stat-value mono">{preview.stats.updateEstimate}</span>
            </div>
          </div>
          {hasErrors && <div className="banner bad">还有 {preview.stats.error} 行没通过校验，修正源文件后再来。</div>}
          {preview.errors.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="num">行号</th>
                    <th>字段</th>
                    <th>问题</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.errors.slice(0, 50).map((e, i) => (
                    <tr key={`${e.row}-${e.field}-${i}`}>
                      <td className="num mono">{e.row}</td>
                      <td className="mono">{e.field}</td>
                      <td>{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {preview.samples.length > 0 && (
            <>
              <h3>抽样</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="num">ID</th>
                      <th>姓名</th>
                      <th className="num">CA</th>
                      <th className="num">PA</th>
                      <th className="num">年龄</th>
                      <th>位置</th>
                      <th>惯用脚</th>
                      <th>中国计划</th>
                      <th>未来之星</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.samples.map((s) => (
                      <tr key={s.fcId}>
                        <td className="num mono">{s.fcId}</td>
                        <td>{s.name}</td>
                        <td className="num mono">{s.ca}</td>
                        <td className="num mono">{s.pa}</td>
                        <td className="num">{s.age ?? '—'}</td>
                        <td>{s.position ?? '—'}</td>
                        <td>{s.foot === 1 ? '右脚' : '左脚'}</td>
                        <td>{s.chinaPlan ? '是' : '—'}</td>
                        <td>{s.futureStar ? '是' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

function parseStarIds(text: string): number[] {
  return text
    .split(/[\s,，、]+/)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/* ---------- 名单合同模板导入（通道 C） ---------- */

const C_OUTCOME_LABEL: Record<ContractImportPreview['samples'][number]['outcome'], string> = {
  create: '新建',
  update: '覆盖',
  claim: '认领',
};

function ContractsSection() {
  const { show, toastNode } = useToast();
  const [clubs, setClubs] = useState<AdminClubRow[]>([]);
  const [clubId, setClubId] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ContractImportPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [result, setResult] = useState<ContractImportConfirm | null>(null);
  const [progress, setProgress] = useState('');

  useEffect(() => {
    api<{ clubs: AdminClubRow[] }>('/api/admin/clubs')
      .then((d) => setClubs(d.clubs))
      .catch(() => undefined);
  }, []);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null);
    setPreview(null);
    setArmed(false);
    try {
      const parsed = await parseXlsx(file, 'C');
      if (parsed.length === 0) {
        show('文件里没有数据行，检查一下内容。', true);
        return;
      }
      const canonical = parsed.map(toCanonicalContractRow);
      const missing = REQUIRED_C.filter((col) => !(col in canonical[0]));
      if (missing.length > 0) {
        show(`表头对不上，缺：${missing.join('、')}。可用列名：uid、RC（或违约金）、工资、效力起点、类型（或合同类型）。`, true);
        return;
      }
      setRows(canonical);
      setFileName(file.name);
      show(`解析完成：${canonical.length} 行。先跑预览看归属分类。`);
    } catch {
      show('文件解析失败，确认是 CSV 或 xlsx 文件。', true);
    }
  }

  async function runPreview() {
    if (previewBusy || rows.length === 0 || !clubId) return;
    setPreviewBusy(true);
    setResult(null);
    setArmed(false);
    setPreview(null);
    try {
      let agg: ContractImportPreview | null = null;
      for (let i = 0; i < rows.length; i += IMPORT_SLICE) {
        const slice = rows.slice(i, i + IMPORT_SLICE);
        const res = await apiPost<ContractImportPreview>('/api/admin/players/import/preview', {
          channel: 'C',
          clubId: Number(clubId),
          rows: slice,
        });
        if (agg === null) agg = res;
        else {
          agg.stats.total += res.stats.total;
          agg.stats.valid += res.stats.valid;
          agg.stats.error += res.stats.error;
          agg.stats.insertEstimate += res.stats.insertEstimate;
          agg.stats.updateEstimate += res.stats.updateEstimate;
          agg.errors.push(...res.errors);
          if (agg.samples.length < 5) agg.samples.push(...res.samples.slice(0, 5 - agg.samples.length));
        }
        setProgress(`预览 ${Math.min(i + IMPORT_SLICE, rows.length)} / ${rows.length} 行`);
      }
      setPreview(agg);
    } catch (err) {
      show(err instanceof Error ? err.message : '预览失败', true);
    } finally {
      setPreviewBusy(false);
      setProgress('');
    }
  }

  async function runConfirm() {
    if (!armed || confirmBusy || !clubId) return;
    setConfirmBusy(true);
    try {
      let agg: ContractImportConfirm | null = null;
      for (let i = 0; i < rows.length; i += IMPORT_SLICE) {
        const slice = rows.slice(i, i + IMPORT_SLICE);
        const res = await apiPost<ContractImportConfirm>('/api/admin/players/import/confirm', {
          channel: 'C',
          clubId: Number(clubId),
          rows: slice,
        });
        if (agg === null) agg = res;
        else agg.written += res.written;
        setProgress(`落库 ${Math.min(i + IMPORT_SLICE, rows.length)} / ${rows.length} 行`);
      }
      setResult(agg);
      setArmed(false);
      setPreview(null);
      setRows([]);
      setFileName('');
      show(`合同落库完成：${agg?.written ?? 0} 行已写入。`);
    } catch (err) {
      setArmed(false);
      show(err instanceof Error ? err.message : '落库失败', true);
    } finally {
      setConfirmBusy(false);
      setProgress('');
    }
  }

  const hasErrors = (preview?.stats.error ?? 0) > 0;

  return (
    <section className="card admin-section">
      <h2>名单合同模板导入（通道 C）</h2>
      {toastNode}
      <p className="hint">
        每队一份 CSV（列：uid、RC、工资、效力起点、类型）。合同落库的同时，无归属的球员会认领到所选俱乐部——
        队壳归属以平台合同为准。训练营合同工资固定 0.75 m/半赛季。
      </p>
      <label className="field">
        目标俱乐部
        <select value={clubId} onChange={(e) => { setClubId(e.target.value); setResult(null); setPreview(null); setArmed(false); }}>
          <option value="">选择俱乐部…</option>
          {clubs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}（{c.leagueTier ? (LEAGUE_TIER_LABEL[c.leagueTier] ?? c.leagueTier) : '未定级'}）
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        合同模板（CSV / xlsx）
        <input type="file" accept=".csv,.xlsx,.xls" onChange={onFile} />
      </label>
      {fileName && (
        <p className="hint">
          已解析 <b>{fileName}</b>，共 {rows.length} 行。
        </p>
      )}

      <div className="btn-row">
        <button className="btn" type="button" disabled={rows.length === 0 || !clubId || previewBusy} onClick={runPreview}>
          {previewBusy ? progress || '预览中…' : '第一步 · 预览'}
        </button>
        <button
          className={`btn${armed ? ' btn-armed' : ''}`}
          type="button"
          disabled={preview === null || hasErrors || confirmBusy || rows.length === 0 || !clubId}
          onClick={() => (armed ? runConfirm() : setArmed(true))}
          onBlur={() => setArmed(false)}
        >
          {confirmBusy ? progress || '落库中…' : armed ? '再点一次确认落库' : '第二步 · 确认落库'}
        </button>
      </div>

      {result && (
        <div className="banner info">
          落库完成：写入 {result.written} 行（新建/认领约 {result.insertedEstimate}、覆盖约 {result.updatedEstimate}），分 {result.batches} 批。
          重复导入安全，现行合同按球员唯一键覆盖。
        </div>
      )}

      {preview && (
        <>
          <div className="preview-stats">
            <div className="club-stat">
              <span className="stat-label">总行数</span>
              <span className="stat-value mono">{preview.stats.total}</span>
            </div>
            <div className="club-stat">
              <span className="stat-label">有效</span>
              <span className="stat-value mono">{preview.stats.valid}</span>
            </div>
            <div className="club-stat">
              <span className="stat-label">错误</span>
              <span className={`stat-value mono${hasErrors ? ' bad-text' : ''}`}>{preview.stats.error}</span>
            </div>
            <div className="club-stat">
              <span className="stat-label">新建/认领</span>
              <span className="stat-value mono">{preview.stats.insertEstimate}</span>
            </div>
            <div className="club-stat">
              <span className="stat-label">覆盖</span>
              <span className="stat-value mono">{preview.stats.updateEstimate}</span>
            </div>
          </div>
          {hasErrors && <div className="banner bad">还有 {preview.stats.error} 行没通过校验，修正源文件后再来。</div>}
          {preview.errors.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="num">行号</th>
                    <th>字段</th>
                    <th>问题</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.errors.slice(0, 50).map((e, i) => (
                    <tr key={`${e.row}-${e.field}-${i}`}>
                      <td className="num mono">{e.row}</td>
                      <td className="mono">{e.field}</td>
                      <td>{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {preview.samples.length > 0 && (
            <>
              <h3>抽样</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="num">uid</th>
                      <th>球员</th>
                      <th className="num">违约金</th>
                      <th className="num">工资</th>
                      <th>类型</th>
                      <th>效力起点</th>
                      <th>动作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.samples.map((s) => (
                      <tr key={s.uid}>
                        <td className="num mono">{s.uid}</td>
                        <td>{s.playerName ?? '—'}</td>
                        <td className="num mono">{s.releaseFee}</td>
                        <td className="num mono">{s.wage}</td>
                        <td>{s.contractType === 'trainee' ? '训练营' : '正式'}</td>
                        <td>{s.effectiveFrom}</td>
                        <td>{C_OUTCOME_LABEL[s.outcome]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

/* ---------- 注册快照与准入体检 ---------- */

function RegistrationsSection() {
  const { show, toastNode } = useToast();
  const [seasonInput, setSeasonInput] = useState('');
  const [snapshot, setSnapshot] = useState<AdminRegistrations | null>(null);
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkBusy, setCheckBusy] = useState(false);

  const seasonQuery = (season?: string) => (season ? `?season=${encodeURIComponent(season)}` : '');

  async function loadSnapshot(season?: string) {
    setBusy(true);
    try {
      setSnapshot(await api<AdminRegistrations>(`/api/admin/registrations${seasonQuery(season)}`));
      setReport(null);
    } catch (err) {
      show(err instanceof Error ? err.message : '注册名单加载失败', true);
    } finally {
      setBusy(false);
    }
  }

  async function runCheck(season?: string) {
    setCheckBusy(true);
    try {
      setReport(await api<ComplianceReport>(`/api/admin/compliance${seasonQuery(season)}`));
    } catch (err) {
      show(err instanceof Error ? err.message : '资格检查失败', true);
    } finally {
      setCheckBusy(false);
    }
  }

  useEffect(() => {
    loadSnapshot();
  }, []);

  const season = seasonInput.trim();

  return (
    <section className="card admin-section">
      <h2>注册与资格检查</h2>
      {toastNode}
      <p className="hint">
        注册名单按赛季存档，供资格检查对账。资格检查用当前属性对名单重跑合规引擎——注册后属性或合同漂移的违规会在赛前被抓出来。
        失败项触发强制拍卖的流程在转会增量落地，现在只报告。
      </p>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          loadSnapshot(season || undefined);
        }}
      >
        <label className="field">
          赛季
          <input
            type="number"
            min={1}
            value={seasonInput}
            onChange={(e) => setSeasonInput(e.target.value)}
            placeholder="留空=最新"
          />
        </label>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? '读取中…' : '查名单'}
        </button>
        <button className="btn" type="button" disabled={checkBusy} onClick={() => runCheck(season || undefined)}>
          {checkBusy ? '检查中…' : '跑一遍资格检查'}
        </button>
      </form>

      {snapshot === null ? null : snapshot.season === null ? (
        <div className="empty-state">
          <p className="muted">还没有任何注册名单。等教练在球队中心提交名单。</p>
        </div>
      ) : (
        <>
          <h3>
            第 {snapshot.season} 赛季注册名单（{snapshot.clubs.length} 支俱乐部）
          </h3>
          {snapshot.clubs.length === 0 ? (
            <div className="empty-state">
              <p className="muted">这个赛季还没有俱乐部提交注册。</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>俱乐部</th>
                    <th>级别</th>
                    <th className="num">一线队</th>
                    <th className="num">训练营</th>
                    <th className="num">工资</th>
                    <th>注册明细</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.clubs.map((club) => (
                    <tr key={club.clubId}>
                      <td>
                        {club.clubName} <span className="muted">#{club.clubId}</span>
                      </td>
                      <td>{club.leagueTier ? (LEAGUE_TIER_LABEL[club.leagueTier] ?? club.leagueTier) : <span className="muted">未定级</span>}</td>
                      <td className="num mono">{club.firstTeam}</td>
                      <td className="num mono">{club.trainee}</td>
                      <td className="num mono">{club.wageTotal.toFixed(2)} m</td>
                      <td>
                        <details>
                          <summary className="muted">{club.players.length} 人</summary>
                          <div className="detail-list">
                            {club.players.map((p) => (
                              <span key={p.playerId} className={p.squad === 'trainee' ? 'trainee-name' : undefined}>
                                {p.name}
                                {p.squad === 'trainee' ? '（训）' : ''}
                              </span>
                            ))}
                          </div>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {report && (
        <>
          <h3>
            资格检查报告{report.season !== null ? `（第 ${report.season} 赛季）` : ''}
          </h3>
          {report.clubs.length === 0 ? (
            <div className="empty-state">
              <p className="muted">没有可检查的俱乐部。</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>俱乐部</th>
                    <th>结果</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {report.clubs.map((club) => (
                    <tr key={club.clubId}>
                      <td>{club.clubName}</td>
                      <td>
                        <span className={`badge ${club.pass ? 'gold' : 'red'}`}>{club.pass ? '通过' : '未过'}</span>
                      </td>
                      <td>
                        {club.pass ? (
                          <span className="muted">
                            一线队 {club.stats?.firstTeam} 人 · 训练营 {club.stats?.trainee} 人 · 工资{' '}
                            {(club.stats?.wageTotal ?? 0).toFixed(2)} m
                          </span>
                        ) : (
                          <ul className="issue-list">
                            {club.issues.map((issue, i) => (
                              <li key={`${issue.rule}-${i}`}>{issue.message}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ---------- 期初余额 ---------- */

/* ---------- 审核队列（增量 3 成交确认 + 增量 5 旁路单据） ---------- */

// 旁路单据的摘要行（payload 由 createBypassTransfer / submitMatch 冻结）
function bypassSummary(r: AdminReviewRow): string | null {
  const p = (r.payload ?? {}) as Record<string, unknown>;
  const num = (k: string) => (typeof p[k] === 'number' ? (p[k] as number).toFixed(2) : '—');
  switch (p.kind) {
    case 'rc_change':
      return `违约金 ${num('oldReleaseFee')} → ${num('newReleaseFee')} m${(p.changeFee as number) > 0 ? `，加价费 ${num('changeFee')} m` : '，降价免费'}`;
    case 'termination':
      return `解约费 ${(p.terminationFee as number) > 0 ? num('terminationFee') : '0.00'} m，本窗禁签`;
    case 'free_agent':
      return `新违约金 ${num('newReleaseFee')} m，签入费 ${num('signFee')} m（30%）`;
    case 'match':
      return `匹配留队：新违约金 ${num('newReleaseFee')} m > 出价 ${num('previousBid')} m，回收差额 ${num('diff')} m`;
    default:
      return null;
  }
}

function completedMessage(r: AdminReviewRow): string {
  switch (r.transfer.type) {
    case 'rc_change':
      return `已批准：${r.transfer.player.name} 的合同违约金已更新，保护期重新起算。`;
    case 'termination':
      return `已批准：${r.transfer.player.name} 合同解除，进入自由球员名单（本窗禁签）。`;
    case 'free_agent':
      return `已批准：${r.transfer.player.name} 签入 ${r.transfer.toClubName ?? '—'}，签入费已收。`;
    case 'match':
      return `已批准：${r.transfer.player.name} 留在 ${r.transfer.fromClubName ?? '—'}，匹配差额已回收。`;
    default:
      return `已批准：${r.transfer.player.name} → ${r.transfer.toClubName ?? '—'}，划款过户完成。`;
  }
}

function ReviewsSection() {
  const { show, toastNode } = useToast();
  const [status, setStatus] = useState<'open' | 'approved' | 'rejected' | 'all'>('open');
  const [reviews, setReviews] = useState<AdminReviewRow[] | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async (s: 'open' | 'approved' | 'rejected' | 'all') => {
    try {
      const data = await api<AdminReviews>(`/api/admin/reviews?status=${s}`);
      setReviews(data.reviews);
    } catch (err) {
      show(err instanceof Error ? err.message : '审核队列加载失败', true);
    }
  }, [show]);

  useEffect(() => {
    load(status);
  }, [status, load]);

  async function decide(row: AdminReviewRow, action: 'approve' | 'reject') {
    if (busyId !== null) return;
    setBusyId(row.id);
    try {
      const res = await apiPost<{ ok: boolean; status: string }>(`/api/admin/reviews/${row.id}/${action}`, {
        note: notes[row.id] ?? undefined,
      });
      show(
        action === 'approve'
          ? res.status === 'signing'
            ? `已批准：${row.transfer.player.name} → ${row.transfer.toClubName ?? '—'}，签约谈判已开启，等买方谈妥合同后过户。`
            : res.status === 'already'
              ? '这单刚批过了。'
              : completedMessage(row)
          : `已驳回：${row.transfer.player.name} 的单子，资金已解冻。`,
      );
      await load(status);
    } catch (err) {
      show(err instanceof Error ? err.message : '操作失败', true);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card admin-section">
      <h2>审核队列</h2>
      {toastNode}
      <p className="hint">
        市场成交单与方式单据（续约、解约、海捞、匹配）都在这里盖章：转会成交批准后开启签约谈判，由买方谈妥合同后成约过户；
        方式单据批准即落合同、收附加费。驳回则解冻全部资金、挂牌下架（不收下架费）。
      </p>
      <div className="seg" role="radiogroup" aria-label="审核任务状态">
        {(['open', 'approved', 'rejected', 'all'] as const).map((s) => (
          <button key={s} type="button" className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
            {{ open: '待审', approved: '已批准', rejected: '已驳回', all: '全部' }[s]}
          </button>
        ))}
      </div>

      {reviews === null ? (
        <p className="muted">正在翻审核夹…</p>
      ) : reviews.length === 0 ? (
        <div className="empty-state">
          <p className="muted">{status === 'open' ? '没有待审的单子。市场很平静。' : '这一栏暂时没有记录。'}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>球员</th>
                <th>单据</th>
                <th>内容</th>
                <th className="num">金额（m）</th>
                <th>状态</th>
                <th>{status === 'open' ? '操作' : '结果'}</th>
              </tr>
            </thead>
            <tbody>
              {reviews.map((r) => {
                const summary = bypassSummary(r);
                return (
                  <tr key={r.id}>
                    <td>
                      {r.transfer.player.name}
                      <span className="muted">（CA {r.transfer.player.ca ?? '—'}）</span>
                    </td>
                    <td>
                      <span className={`badge ${r.transfer.type === 'forced_auction' ? 'red' : summary ? 'purple' : 'sky'}`}>
                        {TRANSFER_TYPE_LABEL[r.transfer.type] ?? r.transfer.type}
                      </span>
                    </td>
                    <td>
                      {summary ?? (
                        <>
                          {r.transfer.fromClubName ?? '—'} → <b>{r.transfer.toClubName ?? '—'}</b>
                        </>
                      )}
                    </td>
                    <td className="num mono">
                      {r.transfer.fee !== null ? r.transfer.fee.toFixed(2) : '—'}
                      {r.transfer.extraFee !== null && r.transfer.extraFee > 0 && (
                        <span className="muted">＋{r.transfer.extraFee.toFixed(2)}</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${r.transfer.status === 'completed' ? 'gold' : r.transfer.status === 'rejected' ? 'red' : r.transfer.status === 'signing' ? 'purple' : 'sky'}`}>
                        {r.transfer.status === 'completed'
                          ? '已过户'
                          : r.transfer.status === 'rejected'
                            ? '已驳回'
                            : r.transfer.status === 'signing'
                              ? '签约谈判中'
                              : '待审核'}
                      </span>
                    </td>
                    <td>
                      {r.status === 'open' ? (
                        <div className="inline-form">
                          <input
                            className="field"
                            type="text"
                            placeholder="备注（可空）"
                            value={notes[r.id] ?? ''}
                            onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                          />
                          <button className="btn btn-sm" type="button" disabled={busyId === r.id} onClick={() => decide(r, 'approve')}>
                            {busyId === r.id ? '处理中…' : '批准'}
                          </button>
                          <button className="btn btn-sm btn-danger" type="button" disabled={busyId === r.id} onClick={() => decide(r, 'reject')}>
                            驳回
                          </button>
                        </div>
                      ) : (
                        <span className="muted">{r.note ?? '—'}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function OpeningBalanceSection() {
  const { show, toastNode } = useToast();
  const [clubs, setClubs] = useState<AdminClubRow[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OpeningImportResult | null>(null);

  useEffect(() => {
    api<{ clubs: AdminClubRow[] }>('/api/admin/clubs')
      .then((d) => setClubs(d.clubs))
      .catch(() => undefined);
  }, []);

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

/* ---------- 赛季与赛事绑定（§11，增量 6.1 层级：赛事绑赛季，窗口只管转会准入） ---------- */

function SeasonsSection() {
  const { show, toastNode } = useToast();
  const [current, setCurrent] = useState<SeasonCurrent | null>(null);
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [tournaments, setTournaments] = useState<TournamentRow[]>([]);
  const [selectedSeason, setSelectedSeason] = useState('');
  const [bindings, setBindings] = useState<SeasonBinding[]>([]);
  const [newSeason, setNewSeason] = useState('');
  const [seasonArmed, setSeasonArmed] = useState(false);
  const [bindTournament, setBindTournament] = useState('');
  const [bindType, setBindType] = useState('league_premier');
  const [bindArmed, setBindArmed] = useState(false);
  const [unbindArmedId, setUnbindArmedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const seasonNo = Number(selectedSeason);

  const reload = useCallback(() => {
    api<SeasonCurrent>('/api/seasons/current').then(setCurrent).catch(() => undefined);
    api<SeasonsResponse>('/api/admin/seasons')
      .then((d) => setSeasons(d.seasons))
      .catch(() => undefined);
    api<{ tournaments: TournamentRow[] }>('/api/admin/tournaments')
      .then((d) => setTournaments(d.tournaments))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  // 默认选中当前赛季（还没建档时不选）
  useEffect(() => {
    if (!selectedSeason && seasons.length > 0) {
      setSelectedSeason(String(current?.season?.season ?? seasons[0]?.season ?? ''));
    }
  }, [seasons, current, selectedSeason]);

  const loadBindings = useCallback((season: number) => {
    api<SeasonBindingsResponse>(`/api/admin/seasons/${season}/tournaments`)
      .then((d) => setBindings(d.bindings))
      .catch(() => setBindings([]));
  }, []);
  useEffect(() => {
    setUnbindArmedId(null);
    setBindArmed(false);
    if (seasonNo) loadBindings(seasonNo);
    else setBindings([]);
  }, [seasonNo, loadBindings]);

  const newSeasonValid = Number.isInteger(Number(newSeason)) && Number(newSeason) > 0;
  const tournamentName = (id: number) => tournaments.find((t) => t.id === id)?.name;

  async function createSeason() {
    if (busy || !seasonArmed || !newSeasonValid) return;
    setBusy(true);
    try {
      await apiPost<{ ok: boolean }>('/api/admin/seasons', { season: Number(newSeason) });
      show(`赛季 ${Number(newSeason)} 已建档，进入备赛期。`);
      setNewSeason('');
      setSeasonArmed(false);
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '建档失败', true);
    } finally {
      setBusy(false);
    }
  }

  async function bind() {
    if (busy || !bindArmed || !seasonNo || bindTournament === '') return;
    setBusy(true);
    try {
      const res = await apiPost<BindTournamentResult>(`/api/admin/seasons/${seasonNo}/bind-tournament`, {
        tournamentId: Number(bindTournament),
        competitionType: bindType,
      });
      show(`已把「${res.tournament.name}」绑进 S${seasonNo}，完赛场次会进赛果确认队列。`);
      setBindTournament('');
      setBindArmed(false);
      loadBindings(seasonNo);
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '绑定失败', true);
    } finally {
      setBusy(false);
    }
  }

  async function unbind(b: SeasonBinding) {
    if (busy || !seasonNo || unbindArmedId !== b.id) return;
    setBusy(true);
    try {
      await apiPost<{ ok: boolean }>(`/api/admin/seasons/${seasonNo}/unbind-tournament`, { tournamentId: b.tournamentId });
      show(`已把「${tournamentName(b.tournamentId) ?? `#${b.tournamentId}`}」从 S${seasonNo} 解绑。`);
      setUnbindArmedId(null);
      loadBindings(seasonNo);
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '解绑失败', true);
      setUnbindArmedId(null);
    } finally {
      setBusy(false);
    }
  }

  const SEASON_STATUS: Record<string, string> = { preparing: '备赛期', running: '进行中', settled: '已结算' };
  const win = current?.window ?? null;

  return (
    <section className="card admin-section">
      <h2>赛季与赛事绑定</h2>
      {toastNode}
      <p className="hint">
        结构：赛季是上集，窗口（只管转会准入）和赛事（赛果来源）是并列的下级。一座赛事只进一个赛季，一个赛季可以绑多座赛事；绑定不依赖窗口。
      </p>
      {current && (
        <p className="hint">
          当前赛季：
          {current.season ? (
            <>
              S{current.season.season}（{SEASON_STATUS[current.season.status] ?? current.season.status}）
            </>
          ) : (
            '还没建赛季'
          )}
          ；最新窗口：
          {win ? <>S{win.season}·窗{win.windowSeq}（{win.status === 'open' ? '开放中' : '已关闭'}）</> : '还没开过窗'}。
        </p>
      )}
      <div className="inline-form">
        <label className="field">
          新建赛季（编号）
          <input
            value={newSeason}
            onChange={(e) => {
              setNewSeason(e.target.value);
              setSeasonArmed(false);
            }}
            placeholder="4"
          />
        </label>
        <button
          className={`btn${seasonArmed ? ' btn-armed' : ''}`}
          type="button"
          disabled={busy || !newSeasonValid}
          onClick={() => (seasonArmed ? createSeason() : setSeasonArmed(true))}
        >
          {seasonArmed ? '确认建档（再点一次）' : '建档'}
        </button>
      </div>
      <div className="inline-form">
        <label className="field">
          赛季
          <select
            value={selectedSeason}
            onChange={(e) => setSelectedSeason(e.target.value)}
          >
            {seasons.map((s) => (
              <option key={s.season} value={s.season}>
                S{s.season}（{SEASON_STATUS[s.status] ?? s.status}）
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          赛事（比赛系统）
          <select
            value={bindTournament}
            onChange={(e) => {
              setBindTournament(e.target.value);
              setBindArmed(false);
            }}
          >
            <option value="">选赛事…</option>
            {tournaments.map((t) => (
              <option key={t.id} value={t.id}>
                #{t.id} {t.name}（{TOUR_STATUS_LABEL[t.status] ?? t.status}）
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          竞赛类型
          <select
            value={bindType}
            onChange={(e) => {
              setBindType(e.target.value);
              setBindArmed(false);
            }}
          >
            {Object.entries(COMPETITION_TYPE_LABEL).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          className={`btn${bindArmed ? ' btn-armed' : ''}`}
          type="button"
          disabled={busy || !seasonNo || bindTournament === ''}
          onClick={() => (bindArmed ? bind() : setBindArmed(true))}
        >
          {bindArmed ? '确认绑定（再点一次）' : '绑定赛事'}
        </button>
      </div>
      <div>
        {!seasonNo ? (
          <p className="hint">先建档赛季，再往这里绑赛事。</p>
        ) : bindings.length === 0 ? (
          <p className="hint">S{seasonNo} 还没绑任何赛事；不绑赛事就没有赛果可确认。</p>
        ) : (
          bindings.map((b) => (
            <div key={b.id} className="bind-row">
              <span>
                #{b.tournamentId} {tournamentName(b.tournamentId) ?? '（比赛系统里找不到这座赛事）'} ·{' '}
                {COMPETITION_TYPE_LABEL[b.competitionType ?? ''] ?? b.competitionType ?? '类型未标'}
              </span>
              <button
                className={`btn btn-sm${unbindArmedId === b.id ? ' btn-armed' : ''}`}
                type="button"
                disabled={busy}
                onClick={() => (unbindArmedId === b.id ? unbind(b) : setUnbindArmedId(b.id))}
              >
                {unbindArmedId === b.id ? '确认解绑（再点一次）' : '解绑'}
              </button>
            </div>
          ))
        )}
      </div>
      <p className="hint">
        赛季已结算后不能再绑赛事；已经有确认入档赛果的赛事不能解绑。确认赛果时按当时比分定格快照，之后比赛系统改判不影响已入档记录。
      </p>
    </section>
  );
}

/* ---------- 赛果确认（附录 A〔6〕，确认钩子触发 XP/通知） ---------- */

function resultScoreLine(r: { homeTeam: string | null; awayTeam: string | null; scoreHome: number | null; scoreAway: number | null }): string {
  return `${r.homeTeam ?? '—'} ${r.scoreHome ?? '-'} : ${r.scoreAway ?? '-'} ${r.awayTeam ?? '—'}`;
}

function ResultsSection() {
  const { show, toastNode } = useToast();
  const [data, setData] = useState<ResultsQueue | null>(null);
  const [armedId, setArmedId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const reload = useCallback(() => {
    api<ResultsQueue>('/api/admin/results/queue')
      .then(setData)
      .catch(() => setData({ queue: [], confirmed: [] }));
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  async function confirm(matchId: number) {
    if (armedId !== matchId || busyId !== null) return;
    setBusyId(matchId);
    try {
      const r = await apiPost<ConfirmResultResult>(`/api/admin/results/${matchId}/confirm`, {});
      const unresolvedNote =
        r.xp.unresolved.length > 0
          ? `有 ${r.xp.unresolved.length} 个球员没匹配上（${r.xp.unresolved.join('、')}），请到「成长引擎」补录。`
          : '';
      show(`赛果已确认入档${r.xp.granted > 0 ? `，自动记了 ${r.xp.granted} 条 XP 事件` : ''}。${unresolvedNote}`);
      setArmedId(null);
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : '确认失败', true);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card admin-section">
      <h2>赛果确认</h2>
      {toastNode}
      <p className="hint">从比赛系统同步的完赛场次在这里确认；确认只入档赛果，奖金到「手动记账」按模板发。</p>
      {data === null ? (
        <p className="muted">读取中…</p>
      ) : data.queue.length === 0 ? (
        <p className="muted">没有待确认的赛果。绑好赛事之后，比完的场次会出现在这里。</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>赛事</th>
                <th>阶段</th>
                <th>对阵与比分</th>
                <th>完赛时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.queue.map((r) => (
                <tr key={r.matchId}>
                  <td>
                    {r.competitionType ? (COMPETITION_TYPE_LABEL[r.competitionType] ?? r.competitionType) : '—'}
                    <span className="muted"> S{r.season}·窗{r.windowSeq}</span>
                  </td>
                  <td>
                    {r.stageName ?? '—'}
                    {r.round !== null && <span className="muted"> 第{r.round}轮</span>}
                  </td>
                  <td className="mono">
                    {resultScoreLine(r)}
                    {r.penHome !== null && r.penAway !== null && <span className="muted">（点球 {r.penHome}:{r.penAway}）</span>}
                    {r.walkoverSide && r.walkoverSide !== '' && <span className="badge">弃权</span>}
                    {r.winnerTeam && <span className="muted">，胜者 {r.winnerTeam}</span>}
                  </td>
                  <td className="mono">{r.finishedAt?.slice(0, 16).replace('T', ' ') ?? '—'}</td>
                  <td>
                    <button
                      className={`btn btn-sm${armedId === r.matchId ? ' btn-armed' : ''}`}
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => (armedId === r.matchId ? confirm(r.matchId) : setArmedId(r.matchId))}
                    >
                      {busyId === r.matchId ? '确认中…' : armedId === r.matchId ? '确认入档（再点一次）' : '确认'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data !== null && data.confirmed.length > 0 && (
        <details>
          <summary>最近已确认（{data.confirmed.length}）</summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>赛事</th>
                  <th>对阵与比分</th>
                  <th>确认时间</th>
                </tr>
              </thead>
              <tbody>
                {data.confirmed.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.competitionType ? (COMPETITION_TYPE_LABEL[r.competitionType] ?? r.competitionType) : '—'}
                      <span className="muted"> S{r.season}·窗{r.windowSeq}</span>
                    </td>
                    <td className="mono">
                      {resultScoreLine(r)}
                      {r.winnerTeam && <span className="muted">，胜者 {r.winnerTeam}</span>}
                    </td>
                    <td className="mono">{r.confirmedAt.slice(0, 16).replace('T', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

/* ---------- 成长引擎管理（§10）：XP 补录 / 赛季结算 / 档位核定 ---------- */

function GrowthSection() {
  const { show, toastNode } = useToast();
  const [playerId, setPlayerId] = useState('');
  const [eventType, setEventType] = useState(MANUAL_GROWTH_TYPES[1]!.type);
  const [value, setValue] = useState('');
  const [matchRef, setMatchRef] = useState('');
  const [eventArmed, setEventArmed] = useState(false);
  const [settleSeason, setSettleSeason] = useState('');
  const [half, setHalf] = useState(false);
  const [runArmed, setRunArmed] = useState(false);
  const [summary, setSummary] = useState<GrowthSettlementResult | null>(null);
  const [tierPlayerId, setTierPlayerId] = useState('');
  const [tier, setTier] = useState('1');
  const [tierArmed, setTierArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<SeasonCurrent>('/api/seasons/current')
      .then((d) => {
        if (d.season) setSettleSeason(String(d.season.season));
      })
      .catch(() => undefined);
  }, []);

  const pid = Number(playerId);
  const eventValid = Number.isInteger(pid) && pid > 0;
  const selectedType = MANUAL_GROWTH_TYPES.find((t) => t.type === eventType);
  const settleValid = Number.isInteger(Number(settleSeason)) && Number(settleSeason) > 0;
  const tierValid = Number.isInteger(Number(tierPlayerId)) && Number(tierPlayerId) > 0;

  function resetArm() {
    setEventArmed(false);
    setRunArmed(false);
    setTierArmed(false);
  }

  async function recordEvent() {
    if (busy || !eventArmed || !eventValid) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { playerId: pid, eventType };
      if (selectedType?.needsValue) body.value = Number(value);
      if (matchRef.trim() !== '') body.matchRef = matchRef.trim();
      const r = await apiPost<{ ok: boolean; xp: number; duplicate: boolean }>('/api/admin/growth/events', body);
      show(
        r.duplicate
          ? '这笔之前记过（同一球员同一场次同一事件），没有重复入账。'
          : `已补录，+${r.xp} XP。`,
      );
      setEventArmed(false);
      setValue('');
      setMatchRef('');
    } catch (err) {
      show(err instanceof Error ? err.message : '补录失败', true);
      resetArm();
    } finally {
      setBusy(false);
    }
  }

  async function runSettlement() {
    if (busy || !runArmed || !settleValid) return;
    setBusy(true);
    try {
      const r = await apiPost<GrowthSettlementResult>('/api/admin/growth/settlement/run', {
        season: Number(settleSeason),
        half,
      });
      setSummary(r);
      show(
        `结算完成：训练营 ${r.traineeCount} 人 ×${r.traineeXp} XP，中国计划 ${r.chinaCount} 人，里程碑补发 ${r.milestonesGranted} 条。`,
      );
      setRunArmed(false);
    } catch (err) {
      show(err instanceof Error ? err.message : '结算失败', true);
      resetArm();
    } finally {
      setBusy(false);
    }
  }

  async function confirmTier() {
    if (busy || !tierArmed || !tierValid) return;
    setBusy(true);
    try {
      await apiPost<{ ok: boolean }>(`/api/admin/growth/${Number(tierPlayerId)}/tier`, { tier: Number(tier) });
      show(`档位已核定：球员 #${Number(tierPlayerId)} → 档 ${tier}。`);
      setTierArmed(false);
    } catch (err) {
      show(err instanceof Error ? err.message : '核定失败', true);
      resetArm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card admin-section">
      <h2>成长引擎（XP / 升级 / 档位）</h2>
      {toastNode}

      <h3>补录 XP 事件</h3>
      <p className="hint">比赛系统没有的数据（评分、扑救、夺回球权）或漏记的兜底；XP 按规则表自动折算。赛果确认时已自动入账的不用补。</p>
      <div className="inline-form">
        <label className="field">
          球员 ID
          <input
            value={playerId}
            onChange={(e) => {
              setPlayerId(e.target.value);
              resetArm();
            }}
            placeholder="如 12"
          />
        </label>
        <label className="field">
          事件类型
          <select
            value={eventType}
            onChange={(e) => {
              setEventType(e.target.value);
              resetArm();
            }}
          >
            {MANUAL_GROWTH_TYPES.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {selectedType?.needsValue && (
          <label className="field">
            数值
            <input
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                resetArm();
              }}
              placeholder={eventType === 'rating' ? '8.5' : '次数'}
            />
          </label>
        )}
        <label className="field">
          关联场次（可选）
          <input
            value={matchRef}
            onChange={(e) => {
              setMatchRef(e.target.value);
              resetArm();
            }}
            placeholder="比赛 ID，同场同事件靠它去重"
          />
        </label>
        <button
          className={`btn${eventArmed ? ' btn-armed' : ''}`}
          type="button"
          disabled={busy || !eventValid || (selectedType?.needsValue === true && value.trim() === '')}
          onClick={() => (eventArmed ? recordEvent() : setEventArmed(true))}
        >
          {eventArmed ? '确认补录（再点一次）' : '补录'}
        </button>
      </div>
      {selectedType && <p className="hint">折算口径：{selectedType.hint}。</p>}

      <h3>赛季结算</h3>
      <p className="hint">按 §10.1 结算：训练营球员固定经验、中国计划加成、进+攻里程碑补发；重放安全，重复运行不会重复入账。升级在球员档案页选方案。</p>
      <div className="inline-form">
        <label className="field">
          赛季编号
          <input
            value={settleSeason}
            onChange={(e) => {
              setSettleSeason(e.target.value);
              resetArm();
            }}
            placeholder="4"
          />
        </label>
        <label className="field field-check">
          <input
            type="checkbox"
            checked={half}
            onChange={(e) => {
              setHalf(e.target.checked);
              resetArm();
            }}
          />
          半赛季训练营（15 XP，整赛季 40）
        </label>
        <button
          className={`btn${runArmed ? ' btn-armed' : ''}`}
          type="button"
          disabled={busy || !settleValid}
          onClick={() => (runArmed ? runSettlement() : setRunArmed(true))}
        >
          {runArmed ? '确认结算（再点一次）' : '运行结算'}
        </button>
      </div>
      {summary && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>球员</th>
                <th>成长档位</th>
                <th>待升级次数</th>
              </tr>
            </thead>
            <tbody>
              {summary.pendingLevelUps.length === 0 ? (
                <tr>
                  <td colSpan={3} className="muted">
                    没有待升级的球员。
                  </td>
                </tr>
              ) : (
                summary.pendingLevelUps.map((p) => (
                  <tr key={p.playerId}>
                    <td>
                      {p.name} <span className="muted">#{p.playerId}</span>
                    </td>
                    <td>档 {p.growthTier}</td>
                    <td className="mono">{p.pending}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <h3>档位核定（§10.3）</h3>
      <p className="hint">条件叠加（效力 +1 / 国籍 +1 / 中国籍 +1 / 未来之星 +2 / ≤18 岁 +1）由管理组按现实资料判断，这里只落核定结果。</p>
      <div className="inline-form">
        <label className="field">
          球员 ID
          <input
            value={tierPlayerId}
            onChange={(e) => {
              setTierPlayerId(e.target.value);
              resetArm();
            }}
            placeholder="如 10"
          />
        </label>
        <label className="field">
          核定档位
          <select
            value={tier}
            onChange={(e) => {
              setTier(e.target.value);
              resetArm();
            }}
          >
            {[1, 2, 3, 4, 5].map((t) => (
              <option key={t} value={String(t)}>
                档 {t}
              </option>
            ))}
          </select>
        </label>
        <button
          className={`btn${tierArmed ? ' btn-armed' : ''}`}
          type="button"
          disabled={busy || !tierValid}
          onClick={() => (tierArmed ? confirmTier() : setTierArmed(true))}
        >
          {tierArmed ? '确认核定（再点一次）' : '核定'}
        </button>
      </div>
    </section>
  );
}

/* ---------- 手动记账兜底（§7.1 manual_adjust / prize_*，§9.1 奖金模板） ---------- */

function ManualLedgerSection() {
  const { show, toastNode } = useToast();
  const [clubs, setClubs] = useState<AdminClubRow[]>([]);
  const [clubId, setClubId] = useState('');
  const [kind, setKind] = useState(MANUAL_LEDGER_KINDS[0]!.value);
  const [amountText, setAmountText] = useState('');
  const [memo, setMemo] = useState('');
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ManualLedgerResult | null>(null);

  useEffect(() => {
    api<{ clubs: AdminClubRow[] }>('/api/admin/clubs')
      .then((d) => setClubs(d.clubs))
      .catch(() => undefined);
  }, []);

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

/* ---------- M0 货币监控（PRD：Σ俱乐部余额报表，观察通胀） ---------- */

function M0Section() {
  const [report, setReport] = useState<M0Report | null>(null);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    api<M0Report>('/api/admin/m0')
      .then(setReport)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '加载 M0 报表失败'));
  }, []);
  useEffect(reload, [reload]);

  if (error) {
    return (
      <section className="card admin-section">
        <h2>M0 货币监控</h2>
        <div className="banner bad">{error}</div>
      </section>
    );
  }
  if (!report) {
    return (
      <section className="card admin-section">
        <h2>M0 货币监控</h2>
        <p className="muted">正在算总账…</p>
      </section>
    );
  }
  const fmt = (v: number) =>
    `${v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
  return (
    <section className="card admin-section">
      <h2>M0 货币监控</h2>
      <p className="hint">M0 = Σ俱乐部余额（含冻结）。观察通胀：总量的增长应主要来自期初导入与奖金发放，回收项（税/费）会把钱抽走。</p>
      <div className="ledger-balance">
        <span className="ledger-balance-num mono">{fmt(report.m0)}</span>
        <span className="ledger-balance-sub">
          冻结中 {fmt(report.held)} · 可流动 {fmt(report.available)}
        </span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>记账类型</th>
              <th>笔数</th>
              <th>净额（收+ / 支−）</th>
            </tr>
          </thead>
          <tbody>
            {report.byKind.length === 0 ? (
              <tr>
                <td colSpan={3} className="muted">
                  还没有流水。
                </td>
              </tr>
            ) : (
              report.byKind.map((k) => (
                <tr key={k.kind}>
                  <td>
                    {ledgerKindLabel(k.kind)} <span className="muted mono">{k.kind}</span>
                  </td>
                  <td className="mono">{k.n}</td>
                  <td className={`num mono ${k.total >= 0 ? 'ledger-in' : 'ledger-out'}`}>{fmt(k.total)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <details>
        <summary>按俱乐部明细（{report.byClub.length} 家）</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>俱乐部</th>
                <th>余额</th>
              </tr>
            </thead>
            <tbody>
              {report.byClub.map((club) => (
                <tr key={club.id}>
                  <td>
                    {club.name} <span className="muted">#{club.id}</span>
                  </td>
                  <td className="num mono">{fmt(club.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

/* ---------- config 查看 ---------- */

function ConfigSection() {
  const [rows, setRows] = useState<ConfigRow[] | null>(null);
  useEffect(() => {
    api<{ config: ConfigRow[] }>('/api/admin/config')
      .then((d) => setRows(d.config))
      .catch(() => setRows([]));
  }, []);

  return (
    <section className="card admin-section">
      <h2>平台参数（config）</h2>
      {rows === null ? (
        <p className="muted">读取中…</p>
      ) : (
        <details>
          <summary>参数注册表（{rows.length} 键；涉密键只显示「（内部参数，已隐藏）」）</summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>键</th>
                  <th>当前值</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="mono">
                      {r.key} {r.secret && <span className="badge gray">涉密</span>}
                    </td>
                    <td className="mono">{r.value ?? '（默认）'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
