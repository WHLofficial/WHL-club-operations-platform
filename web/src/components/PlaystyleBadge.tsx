// PlayStyle 徽章（v6.34.0 自 pages/Player.tsx 提取为共享件）：ps-badge / ps-gold 类名 + webp 图标
// + 金/银标记 + 中文名。详情页（属性页签 / 成长页签 / 中国计划徽章墙）与球员对比页徽章行共用。
// props / DOM / 类名 / 文案 / aria 逐字保持，两页渲染输出零变化；名称查 ref 表，查不到回落 `PS {psid}`。
//
// v6.35.0 compact 形态：表格 ps 列（球员库 / 球队页两张表）用。一枚球员最多 15 个槽，
// 表格里铺 webp 图标等于每格多出 N 个请求，所以 compact 只留 🥇/🥈 + 名称：不铺 pill 底、
// 不拉图标，独立类名 ps-badge-compact（不挂 ps-badge，免得跟 pill 的 padding/radius 打架）；
// 金徽走 --badge-gold-* token 上色，银徽只留文字（一列十几枚银徽全上底色太吵）。
// 金/银判定与名称口径仍与整徽同源。
import { playstyleById, playstyleIconUrl } from '../lib/ref.ts';

export function PlaystyleBadge({ psid, gold, compact = false }: { psid: number; gold: boolean; compact?: boolean }) {
  const row = playstyleById.get(psid);
  const label = row?.chs ?? row?.en ?? `PS ${psid}`;
  const title = gold ? `${label}（金）` : label;
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
    </span>
  );
}
