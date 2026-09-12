// API 约定（附录 A）：错误统一 {error, code?}；前端消费的 DTO 在此层冻结
export interface MeUser {
  id: number;
  name: string;
  role: 'admin' | 'coach' | 'viewer';
  locked: boolean;
  mustChangePw: boolean;
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? '请求失败', body?.code);
  }
  return body as T;
}

export async function apiSend<T>(method: 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? '请求失败', data?.code);
  }
  return data as T;
}

export const apiPost = <T,>(path: string, body?: unknown) => apiSend<T>('POST', path, body);
export const apiPatch = <T,>(path: string, body?: unknown) => apiSend<T>('PATCH', path, body);

export const TOUR_SITE_URL = 'https://whleague.win/';

// ---- 增量 1 DTO（附录 A〔1〕）----

export interface ClubDto {
  id: number;
  name: string;
  leagueTier: string;
  status: string;
  createdAt?: string;
}

export interface MyClubOverview {
  club: { id: number; name: string; leagueTier: string; logoKey: string | null; status: string } | null;
  balance: number | null;
  squadCount: number | null;
  window: { season: number; windowSeq: number } | null;
}

export interface PlayerListItem {
  id: number;
  uid: string;
  name: string;
  clubId: number | null;
  position: string | null;
  age: number | null;
  ca: number;
  pa: number;
  prestige: number | null;
  marketValue: number | null;
  status: string;
  growthTier: number;
  isFutureStar: boolean;
  chinaPlan: boolean;
  agentTier: number;
  badgesSilver: number;
  badgesGold: number;
}

export interface ContractDto {
  id: number;
  clubId: number | null;
  releaseFee: number | null;
  wage: number | null;
  contractType: string;
  source: string | null;
  signedAt: string | null;
  effectiveFrom: string | null;
  protectedUntil: string | null;
}

export interface PlayerDetail {
  player: PlayerListItem & {
    foot: number;
    growable: boolean;
    growthXp: number;
    gameAttrs: Record<string, unknown> | null;
    createdAt: string;
    updatedAt: string;
  };
  club: { id: number; name: string } | null;
  contract: ContractDto | null;
}

export interface AdminClubRow {
  id: number;
  name: string;
  leagueTier: string;
  status: string;
  createdAt: string;
  binding: { userId: number; userName: string | null; boundAt: string } | null;
  latestCode: { expiresAt: string | null; usedBy: number | null; usedAt: string | null; createdAt: string } | null;
}

export interface ImportPreview {
  channel: 'A' | 'B';
  stats: { total: number; valid: number; error: number; insertEstimate: number; updateEstimate: number };
  errors: { row: number; field: string; message: string }[];
  samples: {
    fcId: number;
    uid: string;
    name: string;
    ca: number;
    pa: number;
    age: number | null;
    foot: number;
    position: string | null;
    prestige: number | null;
    chinaPlan: boolean;
    futureStar: boolean;
  }[];
}

export interface ImportConfirm {
  written: number;
  insertedEstimate: number;
  updatedEstimate: number;
  batches: number;
  channel: 'A' | 'B';
}

export interface OpeningImportResult {
  written: number;
  skipped: number;
}

export interface ConfigRow {
  key: string;
  value: string | null;
  secret: boolean;
}
