// 管理端导入共用解析件（原 Admin.tsx 顶部 helper，增量 15 拆出供球员导入/合同导入两页共用）
// 每个请求带的行数上限：Worker 侧校验 + 落库都按小批走，前端切片
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
