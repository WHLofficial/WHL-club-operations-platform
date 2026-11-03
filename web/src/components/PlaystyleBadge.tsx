// PlayStyle 徽章（v6.34.0 自 pages/Player.tsx 提取为共享件）：ps-badge / ps-gold 类名 + webp 图标
// + 金/银标记 + 中文名。详情页（属性页签 / 成长页签 / 中国计划徽章墙）与球员对比页徽章行共用。
// props / DOM / 类名 / 文案 / aria 逐字保持，两页渲染输出零变化；名称查 ref 表，查不到回落 `PS {psid}`。
//
// v6.35.0 compact 形态：表格 ps 列（球员库 / 球队页两张表）用。一枚球员最多 15 个槽，
// 表格里铺 webp 图标等于每格多出 N 个请求，所以 compact 只留 🥇/🥈 + 名称：不铺 pill 底、
// 不拉图标，独立类名 ps-badge-compact（不挂 ps-badge，免得跟 pill 的 padding/radius 打架）；
// 金徽走 --badge-gold-* token 上色，银徽只留文字（一列十几枚银徽全上底色太吵）。
// 金/银判定与名称口径仍与整徽同源。
//
// v6.63.0 来源角标（Q2）：source 非 'fc' 时在 pill 尾部挂小标（悬停出全称）——「成长 / 中国计划 /
// 商店 / 外部 / 管理组」；compact（表格）不标。
//
// v6.69.0 描述：整徽的 title 追加定位句 + 当前档位效果（桌面宽屏走原生 tooltip）；
// openable 的整徽在窄屏（≤640px）渲染成按钮，点开 PlaystyleSheet 看三段文案 ——
// 窄屏没有 hover，title 等于不可达。compact 保持原样（表格里一列十几枚，不加长文案）。
//
// v6.74.1 图标即档位：72 枚 webp 补齐后，「图标 + 🥇/🥈」是同一信息的两次表达，整徽去掉 emoji
// （compact 无图标，🥇/🥈 保留）；图标按 ps-icon-silver / ps-icon-gold 显式上色，门将素材
// （黑字形）再加 ps-icon-gk 走另一套 filter。
import { useEffect, useRef, useState } from 'react';
import { isGkPlaystyle, playstyleById, playstyleDescOf, playstyleEffectOf, playstyleIconUrl } from '../lib/ref.ts';
import { PlaystyleSheet } from './PlaystyleSheet.tsx';

/** 发放来源的全称（角标悬停用；'fc' = FC 档案自带，不挂角标） */
export const PLAYSTYLE_SOURCE_LABEL: Record<string, string> = {
  fc: 'FC 档案',
  growth: '成长',
  china: '中国计划',
  shop: '商店',
  external: '外部',
  manual: '管理组',
};

// 与 styles.css 的移动断点同值（max-width: 640px）
const NARROW_QUERY = '(max-width: 640px)';

function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

export function PlaystyleBadge({
  psid,
  gold,
  compact = false,
  source,
  openable = false,
}: {
  psid: number;
  gold: boolean;
  compact?: boolean;
  source?: string;
  /** 窄屏把整徽渲染成按钮并弹出说明（详情页徽章墙用；不要放进已有 button 里） */
  openable?: boolean;
}) {
  const row = playstyleById.get(psid);
  const label = row?.chs ?? row?.en ?? `PS ${psid}`;
  const sourceLabel = source !== undefined && source !== 'fc' ? (PLAYSTYLE_SOURCE_LABEL[source] ?? source) : null;
  // title 恒带来源（compact 表格里悬停仍可读）；角标只在非 compact 的 pill 形态渲染（Q2）
  const baseTitle = `${label}（${gold ? '金' : '银'}）${sourceLabel !== null ? ` · 来源：${sourceLabel}` : ''}`;
  const desc = playstyleDescOf(psid);
  const effect = playstyleEffectOf(psid, gold);
  const title = desc === null ? baseTitle : `${baseTitle}\n${desc.info}\n${gold ? '金' : '银'}：${effect ?? ''}`;
  const narrow = useNarrowViewport();
  const [iconFailed, setIconFailed] = useState(false);
  const isGk = isGkPlaystyle(psid);
  const iconClass = `ps-icon ${gold ? 'ps-icon-gold' : 'ps-icon-silver'}${isGk ? ' ps-icon-gk' : ''}`;
  const [open, setOpen] = useState(false);
  const openRef = useRef<HTMLButtonElement>(null);

  /** 关弹层时把焦点还给触发它的徽章（否则移动端焦点掉回 body） */
  const closeSheet = () => {
    setOpen(false);
    openRef.current?.focus();
  };

  if (compact) {
    return (
      <span className={`ps-badge-compact${gold ? ' ps-badge-compact-gold' : ''}`} title={baseTitle}>
        <span aria-hidden="true">{gold ? '🥇' : '🥈'}</span>
        <span>{label}</span>
      </span>
    );
  }

  const inner = (
    <>
      {iconFailed ? (
        <span aria-hidden="true">{gold ? '🥇' : '🥈'}</span>
      ) : (
        <img
          className={iconClass}
          src={playstyleIconUrl(psid)}
          alt=""
          loading="lazy"
          onError={() => setIconFailed(true)}
        />
      )}
      <span>{label}</span>
      {sourceLabel !== null && <span className="ps-badge-source">{sourceLabel}</span>}
    </>
  );

  if (openable && narrow) {
    return (
      <>
        <button
          ref={openRef}
          type="button"
          className={`ps-badge ps-badge-open${gold ? ' ps-gold' : ''}`}
          title={title}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          {inner}
        </button>
        {open && <PlaystyleSheet psid={psid} gold={gold} onClose={closeSheet} />}
      </>
    );
  }

  return (
    <span className={`ps-badge${gold ? ' ps-gold' : ''}`} title={title}>
      {inner}
    </span>
  );
}
