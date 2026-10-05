// PlayStyle 徽章（v6.34.0 自 pages/Player.tsx 提取为共享件）：ps-badge / ps-gold 类名 + webp 图标
// + 金/银标记 + 中文名。详情页（属性页签 / 成长页签 / 中国计划徽章墙）与球员对比页徽章行共用。
// props / DOM / 类名 / 文案 / aria 逐字保持，两页渲染输出零变化；名称查 ref 表，查不到回落 `PS {psid}`。
import { playstyleById, playstyleIconUrl } from '../lib/ref.ts';

export function PlaystyleBadge({ psid, gold }: { psid: number; gold: boolean }) {
  const row = playstyleById.get(psid);
  const label = row?.chs ?? row?.en ?? `PS ${psid}`;
  return (
    <span className={`ps-badge${gold ? ' ps-gold' : ''}`} title={gold ? `${label}（金）` : label}>
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
