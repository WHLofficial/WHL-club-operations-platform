// 收件篮（v2.4.0，UI_DESIGN「通知中心」；v6.40.0：类目页签 + 徽章 + 未读置顶/日期分组 +
// 整行跳转 + 见过即已读）。口径见 docs/test-plans/v6.40.0-notification-badges.md。
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { NOTIFY_CATEGORIES, NOTIFY_META, type NotifyCategoryId } from '../../../src/core/notify-meta.ts';
import EmptyState from '../components/EmptyState.tsx';
import type { NotificationItem } from '../lib/api.ts';
import { useTimeFmt } from '../lib/datetime.ts';
import { notificationLink } from '../lib/notify-links.ts';
import { useMarkNotificationsRead, useNotificationList, useUnreadByCategory, useUnreadCount } from '../lib/queries.ts';

const TONE_OF = new Map(NOTIFY_CATEGORIES.map((c) => [c.id, c.tone]));

/** 模板徽章：4 字中文 + 类目配色（title 挂原始模板名，不丢信息）；未知模板退化无修饰色 + 原文。 */
function NotifyBadge({ template }: { template: string }) {
  const meta = NOTIFY_META[template];
  if (!meta) {
    return (
      <span className="badge" title={template}>
        {template}
      </span>
    );
  }
  const tone = TONE_OF.get(meta.category);
  return (
    <span className={tone ? `badge ${tone}` : 'badge'} title={template}>
      {meta.label}
    </span>
  );
}

/**
 * 见过即已读（v6.40.0）：行进入视口即批量标已读（120px 预读余量——滚到眼前就算见过）。
 * 合批只发一次 POST；jsdom / 老浏览器没有 IntersectionObserver 时退化为「渲染即标记」。
 */
function useSeenMarker(markRead: ReturnType<typeof useMarkNotificationsRead>) {
  const ioRef = useRef<IntersectionObserver | null>(null);
  const firstFrameRef = useRef<HTMLElement[]>([]);
  const seenRef = useRef(new Set<number>());
  const queueRef = useRef<number[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markRef = useRef(markRead);
  markRef.current = markRead;

  const flush = useCallback(() => {
    timerRef.current = null;
    const ids = queueRef.current;
    queueRef.current = [];
    if (ids.length === 0) return;
    // keepList：已读只影响未读数，不回改本页视觉（否则刚看过的行当场跳位）
    void markRef.current({ ids }, { keepList: true }).catch(() => {
      // 标已读失败不打断浏览：下次进页面自然纠正
    });
  }, []);

  const markSeen = useCallback(
    (el: HTMLElement) => {
      const id = Number(el.dataset.notifyId);
      if (!Number.isInteger(id) || id <= 0 || seenRef.current.has(id)) return;
      seenRef.current.add(id);
      if (el.dataset.notifyRead === '1') return;
      queueRef.current.push(id);
      if (timerRef.current === null) timerRef.current = setTimeout(flush, 0);
    },
    [flush],
  );

  const hasIO = typeof IntersectionObserver !== 'undefined';

  useEffect(() => {
    const first = firstFrameRef.current;
    firstFrameRef.current = [];
    if (!hasIO) {
      // 无观察器：首帧渲染出来的行直接算见过（组件测试与老浏览器走这条）
      for (const el of first) markSeen(el);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          io.unobserve(el);
          markSeen(el);
        }
      },
      { rootMargin: '120px 0px' },
    );
    ioRef.current = io;
    for (const el of first) io.observe(el);
    return () => {
      io.disconnect();
      ioRef.current = null;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [hasIO, markSeen]);

  // 行 ref：观察器已就位就交给它；首帧（commit 早于 effect）先寄存，无观察器则即时标记
  return useCallback(
    (el: HTMLLIElement | null) => {
      if (!el) return;
      if (!hasIO) {
        markSeen(el);
        return;
      }
      const io = ioRef.current;
      if (io) io.observe(el);
      else firstFrameRef.current.push(el);
    },
    [hasIO, markSeen],
  );
}

/** 行内容：窄屏下「徽章 + 时间」占第一行、正文占第二行（样式在 styles.css 的 ≤640 块）。 */
function RowBody({ n, showGo }: { n: NotificationItem; showGo: boolean }) {
  const { dateTime } = useTimeFmt();
  return (
    <>
      <span className="inbox-head">
        {!n.readAt && <span className="inbox-dot" aria-label="未读" />}
        <NotifyBadge template={n.template} />
      </span>
      <span className="inbox-text">{n.text}</span>
      {showGo && (
        <span className="inbox-go" aria-hidden="true">
          去处理 ›
        </span>
      )}
      <span className="mono inbox-time">{dateTime(n.createdAt)}</span>
    </>
  );
}

export default function Notifications() {
  // v6.25.0：时间显示走共享时区层（默认北京时间，顶栏时钟图标可切）
  const { dayLabel } = useTimeFmt();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rawCat = params.get('cat') ?? '';
  // 页签状态写 URL（?cat=）：非法值一律按「全部」，刷新/分享都还原同一视图
  const cat: NotifyCategoryId | '' = NOTIFY_CATEGORIES.some((c) => c.id === rawCat) ? (rawCat as NotifyCategoryId) : '';

  const listQuery = useNotificationList(cat);
  const markRead = useMarkNotificationsRead();
  const rowRef = useSeenMarker(markRead);
  const unreadTotal = useUnreadCount().data ?? 0;
  const byCat = useUnreadByCategory().data?.byCategory ?? {};

  const items = listQuery.data ? listQuery.data.pages.flatMap((p) => p.items) : [];
  const lastPage = listQuery.data?.pages[listQuery.data.pages.length - 1] ?? null;
  const nextCursor = listQuery.hasNextPage ? (lastPage?.nextCursor ?? null) : null;
  const loaded = !listQuery.isPending;
  const busy = listQuery.isFetching;
  const error = listQuery.isError
    ? listQuery.error instanceof Error
      ? listQuery.error.message
      : '收件篮读不出来，稍后再试'
    : null;

  // 未读置顶 + 日期分组（分界处插一条「以下为已读」）。分组一律走 t.dayLabel：
  // 日历日口径只在 datetime.ts 算，页面不许自己切字符串（tests/datetime-display.test.ts 锁着）
  const groups = useMemo(() => {
    const unread = items.filter((n) => n.readAt === null);
    const ordered = [...unread, ...items.filter((n) => n.readAt !== null)];
    const out: { label: string; items: NotificationItem[]; sep: boolean }[] = [];
    let boundary = unread.length > 0;
    for (const n of ordered) {
      const label = dayLabel(n.createdAt);
      const sep = boundary && n.readAt !== null;
      if (sep) boundary = false;
      const last = out[out.length - 1];
      if (!sep && last && last.label === label) {
        last.items.push(n);
        continue;
      }
      out.push({ label, items: [n], sep });
    }
    return out;
  }, [items, dayLabel]);

  const catUnread = cat === '' ? unreadTotal : (byCat[cat] ?? 0);

  function selectCat(id: NotifyCategoryId | '') {
    setParams(id === '' ? {} : { cat: id });
  }

  return (
    <div className="container">
      <h1>
        收件篮
        {unreadTotal > 0 && (
          <>
            {' '}
            <span className="badge sky">{unreadTotal} 条未读</span>
          </>
        )}
      </h1>
      <div className="card">
        <div className="seg inbox-tabs" role="radiogroup" aria-label="按类目筛选">
          <button type="button" className={cat === '' ? 'on' : ''} onClick={() => selectCat('')}>
            全部
            {unreadTotal > 0 && <span className="inbox-tab-n">{unreadTotal}</span>}
          </button>
          {NOTIFY_CATEGORIES.map((c) => (
            <button key={c.id} type="button" className={cat === c.id ? 'on' : ''} onClick={() => selectCat(c.id)}>
              {c.name}
              {(byCat[c.id] ?? 0) > 0 && <span className="inbox-tab-n">{byCat[c.id]}</span>}
            </button>
          ))}
        </div>
        <div className="inbox-toolbar">
          <span className="muted">看过的信自动标为已读；点一行直接去处理。</span>
          {catUnread > 0 && (
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              disabled={busy}
              onClick={() => void markRead(cat === '' ? { all: true } : { all: true, category: cat }).catch(() => {})}
            >
              {cat === '' ? '全部已读' : '本类全部已读'}
            </button>
          )}
        </div>
        {error && <p className="error-msg">{error}</p>}
        {loaded && items.length === 0 && !error ? (
          <EmptyState>
            {cat === '' ? '还没有站内信。赛事有动静的时候，这里会一封一封落进来。' : '这一类还没有消息。'}
          </EmptyState>
        ) : (
          <ul className="inbox-list">
            {groups.map((g, gi) => (
              <li key={`${g.label}-${gi}`} className="inbox-group">
                {g.sep && <div className="inbox-day is-sep">以下为已读</div>}
                <div className="inbox-day">{g.label}</div>
                <ul className="inbox-rows">
                  {g.items.map((n) => {
                    const link = notificationLink(n);
                    const label = NOTIFY_META[n.template]?.label ?? n.template;
                    return (
                      <li
                        key={n.id}
                        ref={rowRef}
                        className={`inbox-item${n.readAt ? '' : ' is-unread'}`}
                        data-notify-id={n.id}
                        data-notify-read={n.readAt ? '1' : '0'}
                      >
                        {link === null ? (
                          <div className="inbox-row" title={`${label}（没有可跳转的页面）`}>
                            <RowBody n={n} showGo={false} />
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="inbox-row inbox-row-btn"
                            title={`${label}：去处理`}
                            aria-label={`去处理：${label}（${n.text}）`}
                            onClick={() => navigate(link)}
                          >
                            <RowBody n={n} showGo />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {nextCursor !== null && (
          <button className="btn" type="button" disabled={busy} onClick={() => void listQuery.fetchNextPage()}>
            {busy ? '读取中…' : '再看 30 条'}
          </button>
        )}
      </div>
    </div>
  );
}
