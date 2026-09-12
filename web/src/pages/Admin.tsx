// 管理端（增量 1+2+3）：建队与认证码、球员导入管线（两段式）、名单合同模板导入、期初余额、注册体检、审核队列、config 查看
import { useCallback, useEffect, useState } from 'react';
import {
  api,
  apiPost,
  TOUR_SITE_URL,
  type AdminClubRow,
  type AdminRegistrations,
  type AdminReviewRow,
  type AdminReviews,
  type ComplianceReport,
  type ConfigRow,
  type ContractImportConfirm,
  type ContractImportPreview,
  type ImportConfirm,
  type ImportPreview,
  type OpeningImportResult,
  type MeUser,
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
          <ClubsSection />
          <ImportSection />
          <ContractsSection />
          <RegistrationsSection />
          <ReviewsSection />
          <OpeningBalanceSection />
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

/* ---------- 俱乐部管理 ---------- */

function ClubsSection() {
  const { show, toastNode } = useToast();
  const [clubs, setClubs] = useState<AdminClubRow[] | null>(null);
  const [name, setName] = useState('');
  const [tier, setTier] = useState<'premier' | 'second'>('premier');
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
      await apiPost('/api/admin/clubs', { name: name.trim(), leagueTier: tier });
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
        <div className="seg" role="radiogroup" aria-label="联赛级别">
          <button type="button" className={tier === 'premier' ? 'on' : ''} onClick={() => setTier('premier')}>
            顶级
          </button>
          <button type="button" className={tier === 'second' ? 'on' : ''} onClick={() => setTier('second')}>
            次级
          </button>
        </div>
        <button className="btn" type="submit" disabled={creating || !name.trim()}>
          {creating ? '建队中…' : '建俱乐部'}
        </button>
      </form>

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
                  <td>{LEAGUE_TIER_LABEL[club.leagueTier] ?? club.leagueTier}</td>
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
              {c.name}（{LEAGUE_TIER_LABEL[c.leagueTier] ?? c.leagueTier}）
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
      show(err instanceof Error ? err.message : '注册快照加载失败', true);
    } finally {
      setBusy(false);
    }
  }

  async function runCheck(season?: string) {
    setCheckBusy(true);
    try {
      setReport(await api<ComplianceReport>(`/api/admin/compliance${seasonQuery(season)}`));
    } catch (err) {
      show(err instanceof Error ? err.message : '体检失败', true);
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
      <h2>注册与体检</h2>
      {toastNode}
      <p className="hint">
        注册快照按赛季存档，供准入体检对账。体检用当前属性对快照重跑合规引擎——注册后属性或合同漂移的违规会在赛前被抓出来。
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
          {busy ? '读取中…' : '查快照'}
        </button>
        <button className="btn" type="button" disabled={checkBusy} onClick={() => runCheck(season || undefined)}>
          {checkBusy ? '体检中…' : '跑一遍体检'}
        </button>
      </form>

      {snapshot === null ? null : snapshot.season === null ? (
        <div className="empty-state">
          <p className="muted">还没有任何注册快照。等教练在球队中心提交名单。</p>
        </div>
      ) : (
        <>
          <h3>
            第 {snapshot.season} 赛季注册快照（{snapshot.clubs.length} 支俱乐部）
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
                    <th className="num">工资合计</th>
                    <th>注册明细</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.clubs.map((club) => (
                    <tr key={club.clubId}>
                      <td>
                        {club.clubName} <span className="muted">#{club.clubId}</span>
                      </td>
                      <td>{club.leagueTier ? LEAGUE_TIER_LABEL[club.leagueTier] ?? club.leagueTier : '—'}</td>
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
            准入体检报告{report.season !== null ? `（第 ${report.season} 赛季）` : ''}
          </h3>
          {report.clubs.length === 0 ? (
            <div className="empty-state">
              <p className="muted">没有可体检的俱乐部。</p>
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

/* ---------- 审核队列（增量 3：转会成交确认） ---------- */

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
          ? `已批准：${row.transfer.player.name} → ${row.transfer.toClubName}，划款过户完成（${res.status === 'already' ? '此前已完成' : 'completed'}）。`
          : `已驳回：${row.transfer.player.name} 的转会，资金已解冻。`,
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
        转会截止后最高价成交单在这里人工确认：批准即划款、收交易税、球员过户一步到位；驳回则解冻全部资金、挂牌下架（不收下架费）。
        签约工资谈判（增量 4）上线后，批准会先开启谈判会话，成约才过户。
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
          <p className="muted">{status === 'open' ? '没有待审的成交单。市场很平静。' : '这一栏暂时没有记录。'}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>球员</th>
                <th>流向</th>
                <th className="num">成交价（m）</th>
                <th>单据</th>
                <th>{status === 'open' ? '操作' : '结果'}</th>
              </tr>
            </thead>
            <tbody>
              {reviews.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.transfer.player.name}
                    <span className="muted">（CA {r.transfer.player.ca ?? '—'}）</span>
                  </td>
                  <td>
                    {r.transfer.fromClubName ?? '—'} → <b>{r.transfer.toClubName ?? '—'}</b>
                  </td>
                  <td className="num mono">{r.transfer.fee?.toFixed(2) ?? '—'}</td>
                  <td>
                    <span className={`badge ${r.transfer.status === 'completed' ? 'gold' : r.transfer.status === 'rejected' ? 'red' : 'sky'}`}>
                      {r.transfer.status}
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
                          {busyId === r.id ? '处理中…' : '批准成约'}
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
              ))}
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
