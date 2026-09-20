// 管理端 · 导入页：球员导入（通道 A/B 两段式）+ 名单合同模板导入（通道 C）
// （原 Admin.tsx 两 section，增量 15 拆分；commit 3 数据层接 TanStack Query，commit 4 换共享预览块/切片助手）
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type ContractImportConfirm, type ContractImportPreview, type ImportConfirm, type ImportPreview } from '../../lib/api.ts';
import { ADMIN_CLUBS_KEY, fetchAdminClubs } from '../../lib/adminQueries.ts';
import { LEAGUE_TIER_LABEL } from '../../lib/ref.ts';
import { useToast } from '../../lib/toast.tsx';
import { confirmInSlices, parseXlsx, previewInSlices, REQUIRED_C, requiredColumns, toCanonicalContractRow } from '../../lib/imports.ts';
import ConfirmButton from '../../components/ConfirmButton.tsx';
import ImportPreviewBlock from '../../components/ImportPreviewBlock.tsx';

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
  mode: 'minor' | 'major';
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
    mode: 'minor',
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
      const preview = await previewInSlices<ImportPreview>(
        state.rows,
        (slice) => ({ channel: state.channel, mode: state.mode, rows: slice, futureStarIds: futureStars }),
        (progress) => patch({ progress }),
      );
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
      const result = await confirmInSlices<ImportConfirm>(
        state.rows,
        (slice) => ({ channel: state.channel, mode: state.mode, rows: slice, futureStarIds: futureStars }),
        (progress) => patch({ progress }),
      );
      patch({ result, armed: false, preview: null, rows: [], fileName: '', confirmBusy: false, progress: '' });
      show(`落库完成：${result?.written ?? 0} 行已写入。`);
    } catch (err) {
      patch({ armed: false, confirmBusy: false, progress: '' });
      show(err instanceof Error ? err.message : '落库失败', true);
    }
  }

  const preview = state.preview;

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
        换版模式（增量 22：决定覆盖已有球员时平台成长怎么算；新插入球员两模式等价）
        <div className="seg" role="radiogroup" aria-label="换版模式">
          <button
            type="button"
            className={state.mode === 'minor' ? 'on' : ''}
            onClick={() => patch({ mode: 'minor', preview: null, result: null, armed: false })}
          >
            小换版 · 成长全保留
          </button>
          <button
            type="button"
            className={state.mode === 'major' ? 'on' : ''}
            onClick={() => patch({ mode: 'major', preview: null, result: null, armed: false })}
          >
            大换版 · 经验清零，CA/徽章各留 1/3
          </button>
        </div>
        {state.mode === 'major' && (
          <span className="hint bad-text">大换版不可轻点：覆盖球员的成长经验清零、成长所得 CA 与徽章各保留 1/3（向上取整）。确认前先看预览统计。</span>
        )}
      </label>

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
        <ConfirmButton
          label="第二步 · 确认落库"
          confirmLabel="再点一次确认落库"
          busyLabel={state.progress || '落库中…'}
          busy={state.confirmBusy}
          disabled={preview === null || (preview.stats.error ?? 0) > 0 || state.rows.length === 0}
          onConfirm={runConfirm}
        />
      </div>

      {state.result && (
        <div className="banner info">
          落库完成（{state.result.mode === 'major' ? '大换版' : '小换版'}）：写入 {state.result.written} 行（新增约 {state.result.insertedEstimate}、覆盖约{' '}
          {state.result.updatedEstimate}，其中成长中球员 {state.result.growthPlayers} 人），分 {state.result.batches} 批。重复导入安全，运营数据不受影响。
        </div>
      )}

      {preview && (
        <ImportPreviewBlock
          preview={preview}
          sampleKey={(s) => s.fcId}
          sampleColumns={[
            { label: 'ID', num: true, render: (s) => s.fcId },
            { label: '姓名', render: (s) => s.name },
            { label: 'CA', num: true, render: (s) => s.ca },
            { label: 'PA', num: true, render: (s) => s.pa },
            { label: '年龄', num: true, render: (s) => s.age ?? '—' },
            { label: '位置', render: (s) => s.position ?? '—' },
            { label: '惯用脚', render: (s) => (s.foot === 1 ? '右脚' : '左脚') },
            { label: '中国计划', render: (s) => (s.chinaPlan ? '是' : '—') },
            { label: '未来之星', render: (s) => (s.futureStar ? '是' : '—') },
          ]}
        />
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

function ContractsSection() {
  const { show, toastNode } = useToast();
  const { data: clubs = [] } = useQuery({ queryKey: ADMIN_CLUBS_KEY, queryFn: fetchAdminClubs });
  const [clubId, setClubId] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ContractImportPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [result, setResult] = useState<ContractImportConfirm | null>(null);
  const [progress, setProgress] = useState('');

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
      const agg = await previewInSlices<ContractImportPreview>(
        rows,
        (slice) => ({ channel: 'C', clubId: Number(clubId), rows: slice }),
        setProgress,
      );
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
      const agg = await confirmInSlices<ContractImportConfirm>(
        rows,
        (slice) => ({ channel: 'C', clubId: Number(clubId), rows: slice }),
        setProgress,
      );
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
        <ConfirmButton
          label="第二步 · 确认落库"
          confirmLabel="再点一次确认落库"
          busyLabel={progress || '落库中…'}
          busy={confirmBusy}
          disabled={preview === null || (preview.stats.error ?? 0) > 0 || rows.length === 0 || !clubId}
          onConfirm={runConfirm}
        />
      </div>

      {result && (
        <div className="banner info">
          落库完成：写入 {result.written} 行（新建/认领约 {result.insertedEstimate}、覆盖约 {result.updatedEstimate}），分 {result.batches} 批。
          重复导入安全，现行合同按球员唯一键覆盖。
        </div>
      )}

      {preview && (
        <ImportPreviewBlock
          preview={preview}
          insertLabel="新建/认领"
          sampleKey={(s) => s.uid}
          sampleColumns={[
            { label: 'uid', num: true, render: (s) => s.uid },
            { label: '球员', render: (s) => s.playerName ?? '—' },
            { label: '违约金', num: true, render: (s) => s.releaseFee },
            { label: '工资', num: true, render: (s) => s.wage },
            { label: '类型', render: (s) => (s.contractType === 'trainee' ? '训练营' : '正式') },
            { label: '效力起点', render: (s) => s.effectiveFrom },
            { label: '动作', render: (s) => (s.outcome === 'create' ? '新建' : s.outcome === 'update' ? '覆盖' : '认领') },
          ]}
        />
      )}
    </section>
  );
}
