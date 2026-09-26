import type { CSSProperties } from 'react';
import { mediaUrl } from '../lib/api.ts';

// 队徽（v3.4.0）：镜像赛事平台 src/components/TeamLogo.tsx —— 有队徽出图，没有就按队名取固定色块 + 首字。
// 颜色按队名哈希而不是按 id：同一个队在列表、详情、赛事平台三处必须同色（换 id 也不变色）。
// 色板是球场记分牌色系，刻意与本站主色（焦橙/巧克力棕）区分开，免得队徽和按钮抢眼。
// v6.4.0 改动 7：圆形改为可选（默认保留）——用户裁决「除了球队列表，其他都去掉」，
// Clubs 列表照旧圆形，ClubDetail 与球员页传 circle={false} 出方形徽。
const PALETTE = ['#0e7a46', '#e8590c', '#1971c2', '#9c36b5', '#e64980', '#f08c00'];

function colorOf(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export function TeamLogo({
  name,
  logoKey,
  size = 24,
  circle = true,
}: {
  name: string;
  logoKey?: string | null;
  size?: number;
  circle?: boolean;
}) {
  const box: CSSProperties = { width: size, height: size };
  const shape = circle ? 'team-logo team-logo-round' : 'team-logo';
  const url = mediaUrl(logoKey);
  if (url) {
    return <img className={shape} src={url} alt={name} style={box} />;
  }
  return (
    <span
      className={`${shape} team-logo-fallback`}
      style={{ ...box, background: colorOf(name), fontSize: Math.max(10, Math.round(size * 0.46)) }}
    >
      {name.slice(0, 1)}
    </span>
  );
}
