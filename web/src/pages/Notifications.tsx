// 收件篮（增量 18，UI_DESIGN「通知中心」）：mono 时间 + 模板摘要，未读 sky 小蓝点，点行标已读
import { useInfiniteQuery } from '@tanstack/react-query';
import { api, type NotificationsPage } from '../lib/api.ts';
import { qk, useMarkNotificationsRead } from '../lib/queries.ts';
import EmptyState from '../components/EmptyState.tsx';

function fmtTime(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

export default function Notifications() {
  const inboxQuery = useInfiniteQuery({
    queryKey: qk.notifications,
    queryFn: ({ pageParam }) =>
      api<NotificationsPage>(`/api/notifications${pageParam !== null ? `?cursor=${pageParam}` : ''}`),
    initialPageParam: null as number | null,
    // nextCursor 到底时是 null；v5 里 null 仍是合法游标，必须转 undefined 才算「没有下一页」
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const markRead = useMarkNotificationsRead();

  const items = inboxQuery.data ? inboxQuery.data.pages.flatMap((p) => p.items) : [];
  const lastPage = inboxQuery.data?.pages[inboxQuery.data.pages.length - 1] ?? null;
  const nextCursor = inboxQuery.hasNextPage ? (lastPage?.nextCursor ?? null) : null;
  const unread = lastPage?.unread ?? 0;
  const loaded = !inboxQuery.isPending;
  const busy = inboxQuery.isFetching;
  const error = inboxQuery.isError
    ? inboxQuery.error instanceof Error
      ? inboxQuery.error.message
      : '收件篮读不出来，稍后再试'
    : null;

  async function markOne(id: number, isRead: boolean) {
    if (isRead) return;
    try {
      await markRead({ ids: [id] });
    } catch {
      // 标已读失败不打断浏览：下次轮询/进入页面自然纠正
    }
  }

  return (
    <div className="container">
      <h1>
        收件篮
        {unread > 0 && (
          <>
            {' '}
            <span className="badge sky">{unread} 条未读</span>
          </>
        )}
      </h1>
      <div className="card">
        <div className="inbox-toolbar">
          <span className="muted">赛果确认、升级完成等平台消息都会进这里。</span>
          {unread > 0 && (
            <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => void markRead({ all: true })}>
              全部已读
            </button>
          )}
        </div>
        {error && <p className="error-msg">{error}</p>}
        {loaded && items.length === 0 && !error ? (
          <EmptyState>还没有站内信。赛事有动静的时候，这里会一封一封落进来。</EmptyState>
        ) : (
          <ul className="inbox-list">
            {items.map((n) => (
              <li key={n.id} className={`inbox-item${n.readAt ? '' : ' is-unread'}`}>
                <button type="button" onClick={() => void markOne(n.id, n.readAt !== null)}>
                  {!n.readAt && <span className="inbox-dot" aria-label="未读" />}
                  <span className="badge">{n.template === 'result_confirmed' ? '赛果' : n.template === 'levelup' ? '成长' : n.template}</span>
                  <span className="inbox-text">{n.text}</span>
                  <span className="mono inbox-time">{fmtTime(n.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {nextCursor !== null && (
          <button className="btn" type="button" disabled={busy} onClick={() => void inboxQuery.fetchNextPage()}>
            {busy ? '读取中…' : '再看 30 条'}
          </button>
        )}
      </div>
    </div>
  );
}
