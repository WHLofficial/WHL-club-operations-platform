// 球员档案的链接地址（v4.0.0）。
//
// 为什么不是直接 `/players/${p.id}`：`/api/players/:id` 现在按 **FC26 ID（fc_id）** 寻址，
// 内部主键只是回落路径（见 src/worker/player-ref.ts）。fc_id 才是跨系统稳定的身份——
// 赛事平台的 `player.id`、导入模板里的 ID、分享出去的链接都用它；内部 id 会随重导入变化。
//
// 一条规则只写一处：任何「点球员名进档案」的地方都走 playerPath()，别再手写模板串。
// fcId 为空（老数据 / 派生不到）时回落内部 id —— 详情端点两条路都认，链接不会断。
export interface PlayerRefLike {
  id: number;
  fcId?: number | null;
}

export function playerPath(p: PlayerRefLike): string {
  return `/players/${p.fcId ?? p.id}`;
}
