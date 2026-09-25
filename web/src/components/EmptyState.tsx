// 管理端空态卡（v2.1.0 commit 4）：统一「还没有数据」的呈现
export default function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="empty-state">
      <p className="muted">{children}</p>
    </div>
  );
}
