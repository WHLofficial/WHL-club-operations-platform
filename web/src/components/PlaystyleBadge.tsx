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
import { playstyleById, playstyleIconUrl } from '../lib/ref.ts';

/** 发放来源的全称（角标悬停用；'fc' = FC 档案自带，不挂角标） */
export const PLAYSTYLE_SOURCE_LABEL: Record<string, string> = {
  fc: 'FC 档案',
  growth: '成长',
  china: '中国计划',
  shop: '商店',
  external: '外部',
  manual: '管理组',
};

export function PlaystyleBadge({
  psid,
  gold,
  compact = false,
  source,
}: {
  psid: number;
  gold: boolean;
  compact?: boolean;
  source?: string;
}) {
  const row = playstyleById.get(psid);
  const label = row?.chs ?? row?.en ?? `PS ${psid}`;
  const sourceLabel = source !== undefined && source !== 'fc' ? (PLAYSTYLE_SOURCE_LABEL[source] ?? source) : null;
  // title 恒带来源（compact 表格里悬停仍可读）；角标只在非 compact 的 pill 形态渲染（Q2）
  const title = `${label}（${gold ? '金' : '银'}）${sourceLabel !== null ? ` · 来源：${sourceLabel}` : ''}`;
  if (compact) {
    return (
      <span className={`ps-badge-compact${gold ? ' ps-badge-compact-gold' : ''}`} title={title}>
        <span aria-hidden="true">{gold ? '🥇' : '🥈'}</span>
        <span>{label}</span>
      </span>
    );
  }
  return (
    <span className={`ps-badge${gold ? ' ps-gold' : ''}`} title={title}>
      <img
        className="ps-icon"
        src={playstyleIconUrl(psid)}
        alt=""
        loading="lazy"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
      <span aria-hidden="true">{gold ? '🥇' : '🥈'}</span>
      <span>{label}</span>
      {sourceLabel !== null && <span className="ps-badge-source">{sourceLabel}</span>}
    </span>
  );
}
