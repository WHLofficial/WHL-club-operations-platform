// 显示时区偏好层（v6.25.0）：存储口径不动（四仓一律 UTC ISO TEXT），这里只管「怎么显示」。
// 偏好存 localStorage，三档：北京时间（默认）/ UTC / 跟随浏览器；同页切换走自定义事件、
// 跨标签页走 storage 事件，消费端必须用 useTimeFmt() 订阅，不许只 import 裸函数直读 localStorage。
import { useEffect, useMemo, useState } from 'react';

export type TzPref = 'asia/shanghai' | 'utc' | 'system';

const KEY = 'whl.tz';
const DEFAULT: TzPref = 'asia/shanghai';

/** 偏好变化事件名：setTzPref 派发，useTzPref 监听 */
export const TZ_CHANGE_EVENT = 'whl:tz-change';

export function getTzPref(): TzPref {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === 'utc' || raw === 'system') return raw;
  } catch {
    // jsdom / 隐私模式取不到 localStorage = 默认北京
  }
  return DEFAULT;
}

export function setTzPref(v: TzPref): void {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // 写不进去只影响本次会话，切换照常生效
  }
  window.dispatchEvent(new CustomEvent(TZ_CHANGE_EVENT));
}

export function tzLabel(pref: TzPref): string {
  return pref === 'utc' ? 'UTC' : pref === 'system' ? '本机时区' : '北京时间';
}

/** Intl 的 timeZone 参数；system 档不传 = Intl 默认走本机时区 */
function zoneOf(pref: TzPref): string | undefined {
  if (pref === 'system') return undefined;
  return pref === 'utc' ? 'UTC' : 'Asia/Shanghai';
}

// formatter 按 pref+opts 缓存：Intl.DateTimeFormat 构造贵，切档/同档重复渲染不该重建
const cache = new Map<string, Intl.DateTimeFormat>();

function parts(ms: number, opts: Intl.DateTimeFormatOptions) {
  const pref = getTzPref();
  const key = `${pref}|${JSON.stringify(opts)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('zh-CN', { ...opts, timeZone: zoneOf(pref), hourCycle: 'h23' });
    cache.set(key, f);
  }
  const get = (type: string) => f!.formatToParts(ms).find((x) => x.type === type)?.value ?? '';
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), se: get('second') };
}

type Join = (p: ReturnType<typeof parts>) => string;

/** 显示时区下的「第几天」（整数日序）：相对日期的唯一算法口径（fmtAgo / fmtDayLabel 共用）。 */
function dayNo(t: number): number {
  const p = parts(t, D);
  return Date.UTC(Number(p.y), Number(p.mo) - 1, Number(p.d)) / 86_400_000;
}

function fmtIn(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions, join: Join): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  return join(parts(ms, opts));
}

const D = { year: 'numeric', month: '2-digit', day: '2-digit' } as const;
const HM = { hour: '2-digit', minute: '2-digit' } as const;
const HMS = { hour: '2-digit', minute: '2-digit', second: '2-digit' } as const;

/** YYYY-MM-DD HH:mm */
export function fmtDateTime(iso: string | null | undefined): string {
  return fmtIn(iso, { ...D, ...HM }, (p) => `${p.y}-${p.mo}-${p.d} ${p.h}:${p.mi}`);
}

/** MM-DD HH:mm（表格行等窄处，年份由页面语境给）——parts 仍取全年历，只是不拼年 */
export function fmtTime(iso: string | null | undefined): string {
  return fmtIn(iso, { ...D, ...HM }, (p) => `${p.mo}-${p.d} ${p.h}:${p.mi}`);
}

/** YYYY-MM-DD */
export function fmtDate(iso: string | null | undefined): string {
  return fmtIn(iso, D, (p) => `${p.y}-${p.mo}-${p.d}`);
}

/**
 * YYYY-MM-DD HH:mm:ss（v6.40.0 同版本补充：谈判气泡与系统行的秒级时间戳）。
 * 与 fmtDateTime 同源同配置，只多取 second 分片；旧的行内表格仍用 fmtTime / fmtDateTime。
 */
export function fmtDateTimeSec(iso: string | null | undefined): string {
  return fmtIn(iso, { ...D, ...HMS }, (p) => `${p.y}-${p.mo}-${p.d} ${p.h}:${p.mi}:${p.se}`);
}

/**
 * 相对日期（v6.31.0）：今天 / 昨天 / N 天前；缺失或不可解析回「—」。
 * 按**显示时区**的日历日算差（复用 parts 缓存，口径与上方格式化同源）；
 * 页面不得自己算相对时间（守 tests/datetime-display.test.ts 的单点化不变量）。
 * 未来时刻（时钟偏差）一律当「今天」，不出现负数天。
 */
export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const days = dayNo(Date.now()) - dayNo(ms);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  return `${days} 天前`;
}

/**
 * 日期分组标签（v6.40.0 收件篮）：今天 / 昨天 / YYYY-MM-DD，按显示时区的日历日。
 * 与 fmtAgo 同源（一个算差、一个给分组名），页面不许自算日历日。
 */
export function fmtDayLabel(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const days = dayNo(Date.now()) - dayNo(ms);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  return fmtDate(iso);
}

export function useTzPref(): TzPref {
  const [pref, setPref] = useState<TzPref>(() => getTzPref());
  useEffect(() => {
    const sync = () => setPref(getTzPref());
    window.addEventListener(TZ_CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(TZ_CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return pref;
}

export interface TimeFmt {
  label: string;
  time: (iso: string | null | undefined) => string;
  dateTime: (iso: string | null | undefined) => string;
  /** 到秒的完整时间戳（YYYY-MM-DD HH:mm:ss）：谈判对话流的气泡/系统行 */
  dateTimeSec: (iso: string | null | undefined) => string;
  date: (iso: string | null | undefined) => string;
  /** 相对日期（今天 / 昨天 / N 天前）：挂出时间一类「多久以前」一律走它 */
  ago: (iso: string | null | undefined) => string;
  /** 日期分组标签（今天 / 昨天 / YYYY-MM-DD）：列表按天分组的分隔线文案 */
  dayLabel: (iso: string | null | undefined) => string;
}

/** 消费端唯一入口：渲染时间的组件必须走这个 hook（pref 变化即重渲染） */
export function useTimeFmt(): TimeFmt {
  const pref = useTzPref();
  return useMemo<TimeFmt>(
    () => ({
      label: tzLabel(pref),
      time: fmtTime,
      dateTime: fmtDateTime,
      dateTimeSec: fmtDateTimeSec,
      date: fmtDate,
      ago: fmtAgo,
      dayLabel: fmtDayLabel,
    }),
    [pref],
  );
}

// ---- 北京时间墙钟 ↔ UTC（v6.49.0 运营时刻表）----
// 时刻表的具体时间一律按北京时间填写与展示（与 worker 侧 fmtBeijingMinute 的 409 话术同口径）；
// 中国无夏令时 ⇒ 固定 +08:00，不走显示偏好（切 UTC 档也不改这张表的填写口径）。

const ZH_WALL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** datetime-local 的墙钟串（北京时间）→ UTC ISO；非法返回 null（含 2 月 30 日这类会被 Date 归一化的日期） */
export function zhWallToUtcIso(wall: string | null | undefined): string | null {
  const m = ZH_WALL_RE.exec((wall ?? '').trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = Number(m[6] ?? 0);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h - 8, mi, s);
  const back = new Date(ms + 8 * 3600_000);
  if (
    back.getUTCFullYear() !== y ||
    back.getUTCMonth() !== mo - 1 ||
    back.getUTCDate() !== d ||
    back.getUTCHours() !== h ||
    back.getUTCMinutes() !== mi ||
    back.getUTCSeconds() !== s
  ) {
    return null;
  }
  return new Date(ms).toISOString();
}

/** UTC ISO → datetime-local 的墙钟串（北京时间，YYYY-MM-DDTHH:mm）；空/非法返回 '' */
export function utcIsoToZhWall(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const w = new Date(ms + 8 * 3600_000);
  return `${w.getUTCFullYear()}-${pad2(w.getUTCMonth() + 1)}-${pad2(w.getUTCDate())}T${pad2(w.getUTCHours())}:${pad2(w.getUTCMinutes())}`;
}

/**
 * 显示时区在某时刻相对 UTC 的偏移毫秒数（甘特图刻度对齐用）。
 * 日/周刻度必须落在「显示时区的午夜」，UTC 与北京时间差 8h，不校正就会把日期线画在早上 8 点。
 */
export function zoneOffsetMs(ms: number): number {
  const t = Math.floor(ms / 1000) * 1000;
  const p = parts(t, { ...D, ...HMS });
  const wall = Date.UTC(Number(p.y), Number(p.mo) - 1, Number(p.d), Number(p.h), Number(p.mi), Number(p.se));
  return wall - t;
}

