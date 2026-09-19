// 登录态上下文（增量 16）：/api/me 全站只拉一次，useAuth() 取代 props 钻透。
// 登录/登出都是整页跳转，会话在页面生命周期内不变 → me 查询永不自动重取。
import { createContext, useContext, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type AuthMode, type MeUser } from './api.ts';

export interface AuthState {
  /** undefined = /api/me 在途（调用方渲染加载态）；null = 匿名 */
  user: MeUser | null | undefined;
  authMode: AuthMode;
  authHome: string | null;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isError } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const d = await api<{ user: MeUser | null; authMode?: AuthMode; authHome?: string | null; syncProbe?: boolean }>('/api/me');
      // 进站即探测：匿名 + oidc 模式 + 不在冷却期（后端 syncProbe 判定）→ 无感同步登录态。
      // 回跳目标由 /api/auth/sync 的 back 参数记录；冷却中 syncProbe 为空，防循环
      if (d.syncProbe) {
        window.location.href = `/api/auth/sync?back=${encodeURIComponent(location.pathname + location.search)}`;
      }
      return d;
    },
    staleTime: Infinity,
    retry: false,
  });

  const value: AuthState = {
    // me 拉失败按匿名处理（旧行为 .catch(() => setUser(null))），不卡加载闸门
    user: data === undefined ? (isError ? null : undefined) : data.user,
    // 旧后端（未发版）不回 authMode：维持 shared 旧行为，前端不因部署顺序而坏
    authMode: data?.authMode ?? 'shared',
    authHome: data?.authHome ?? null,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx === null) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
