import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import App from './App.tsx';
import { AuthProvider } from './lib/auth.tsx';
import './styles.css';

// 管理端数据层默认口径（v2.1.0）：失败不重试（管理操作都是显式的）、不跟窗口聚焦重拉
// v3.2.0 加 staleTime：同一页反复挂载/切走再回来不该重发请求——每次未命中都是 D1 实读，
// 而写路径有失效钩子（服务端代际键 purge），显式改数据的地方仍走 invalidateQueries 强制重取。
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
