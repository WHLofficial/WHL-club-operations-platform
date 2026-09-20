// 管理端导入共用解析件（原 Admin.tsx 顶部 helper，增量 15 拆出供球员导入/合同导入两页共用）
// 每个请求带的行数上限：Worker 侧校验 + 落库都按小批走，前端切片
import { apiPost } from './api.ts';

export const IMPORT_SLICE = 1000;
export const REQUIRED_A = ['ID', 'Name', 'Age', 'CA', 'PA', 'naID', 'PosID1', 'FootID'];
export const REQUIRED_B = ['playerid', 'overallrating', 'potential', 'Position', 'preferredfoot'];
export const REQUIRED_C = ['uid', 'releaseFee', 'wage', 'effectiveFrom', 'contractType'];

// 通道 C 的 CSV 表头别名（文档口径：uid/RC/工资/效力起点/类型）→ 规范键
export const C_HEADER_ALIASES: Record<string, string> = {
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

export type Channel = 'A' | 'B' | 'C';

export function toCanonicalContractRow(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = C_HEADER_ALIASES[k.trim().toLowerCase()];
    if (key) out[key] = v;
  }
  return out;
}

export async function parseXlsx(file: File, channel: Channel): Promise<Record<string, unknown>[]> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', raw: false });
  const sheetName = channel === 'A' && wb.SheetNames.includes('Base') ? 'Base' : wb.SheetNames[0];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: null });
}

export function requiredColumns(channel: Channel): string[] {
  return channel === 'A' ? REQUIRED_A : channel === 'B' ? REQUIRED_B : REQUIRED_C;
}

// 分片预览 + 聚合（增量 15 commit 4 抽出：原 A/B/C 三处几乎相同的切片循环）
// buildBody 决定通道差异（futureStarIds / clubId），进度文案沿用原口径；
// 泛型兼容 ImportPreview（A/B）与 ContractImportPreview（C）
interface PreviewAggLike {
  stats: {
    total: number;
    valid: number;
    error: number;
    insertEstimate: number;
    updateEstimate: number;
    warning?: number;
    growthPlayers?: number;
    xpToWipe?: number;
  };
  errors: { row: number; field: string; message: string }[];
  warnings?: { row: number; field: string; message: string }[];
  samples: unknown[];
}

export async function previewInSlices<P extends PreviewAggLike>(
  rows: Record<string, unknown>[],
  buildBody: (slice: Record<string, unknown>[]) => Record<string, unknown>,
  onProgress: (text: string) => void,
): Promise<P> {
  let agg: P | null = null;
  for (let i = 0; i < rows.length; i += IMPORT_SLICE) {
    const slice = rows.slice(i, i + IMPORT_SLICE);
    const res = (await apiPost<P>('/api/admin/players/import/preview', buildBody(slice))) as P & PreviewAggLike;
    if (agg === null) {
      agg = res;
    } else {
      agg.stats.total += res.stats.total;
      agg.stats.valid += res.stats.valid;
      agg.stats.error += res.stats.error;
      agg.stats.insertEstimate += res.stats.insertEstimate;
      agg.stats.updateEstimate += res.stats.updateEstimate;
      agg.stats.warning = (agg.stats.warning ?? 0) + (res.stats.warning ?? 0);
      agg.stats.growthPlayers = (agg.stats.growthPlayers ?? 0) + (res.stats.growthPlayers ?? 0);
      agg.stats.xpToWipe = Math.round(((agg.stats.xpToWipe ?? 0) + (res.stats.xpToWipe ?? 0)) * 100) / 100;
      agg.errors.push(...res.errors);
      agg.warnings?.push(...(res.warnings ?? []));
      if (agg.samples.length < 5) agg.samples.push(...res.samples.slice(0, 5 - agg.samples.length));
    }
    onProgress(`预览 ${Math.min(i + IMPORT_SLICE, rows.length)} / ${rows.length} 行`);
  }
  return agg!;
}

// 分片落库 + 聚合（只累加 written，原三通道口径一致）
export async function confirmInSlices<C extends { written: number }>(
  rows: Record<string, unknown>[],
  buildBody: (slice: Record<string, unknown>[]) => Record<string, unknown>,
  onProgress: (text: string) => void,
): Promise<C> {
  let agg: C | null = null;
  for (let i = 0; i < rows.length; i += IMPORT_SLICE) {
    const slice = rows.slice(i, i + IMPORT_SLICE);
    const res = await apiPost<C>('/api/admin/players/import/confirm', buildBody(slice));
    if (agg === null) agg = res;
    else agg.written += res.written;
    onProgress(`落库 ${Math.min(i + IMPORT_SLICE, rows.length)} / ${rows.length} 行`);
  }
  return agg!;
}
