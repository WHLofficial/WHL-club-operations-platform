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

export const TOUR_SITE_URL = 'https://whleague.win/';
