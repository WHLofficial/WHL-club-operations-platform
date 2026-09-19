// 管理端 · 导入页：球员导入（通道 A/B 两段式）+ 名单合同模板导入（通道 C）
// （原 Admin.tsx 两 section，增量 15 拆分，行为零变化；解析件在 lib/imports.ts）
import { useEffect, useState } from 'react';
import { api, apiPost, type AdminClubRow, type ContractImportConfirm, type ContractImportPreview, type ImportConfirm, type ImportPreview } from '../../lib/api.ts';
import { LEAGUE_TIER_LABEL } from '../../lib/ref.ts';
import { useToast } from '../../lib/toast.tsx';
import { IMPORT_SLICE, parseXlsx, REQUIRED_C, requiredColumns, toCanonicalContractRow } from '../../lib/imports.ts';

export default function ImportsPage() {
  return (
    <div className="admin-page">
      <ImportSection />
      <ContractsSection />
    </div>
  );
}

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
