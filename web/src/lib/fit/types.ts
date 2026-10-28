// FIT 引擎输入的球员附加信息类型——自 WHL-tournament-management-system/shared/types.ts 的
// PlayerMeta 原样复制（fit 引擎移植；tour 仓 types.ts 里其余 DTO 与本仓无关，不随迁）。
// tour 侧语境：player 表只有 id/name/number，这几个字段来自 player_meta 表（随名册同步镜像），
// 查不到就整条不返回，前端「有才渲染」。
export interface PlayerMeta {
  /** game_attrs 原样镜像：英文键 → 0-99 数值。属性键是 ./roleFit.ts 的 FIT_ATTR_KEYS（权重键
   *  并集派生）；另含 RoleID1-5 / PosID1-4（熟悉度与位置 id，fitScore 加分项输入）与展示参考
   *  用的 CA/PA（fitScore 引擎不读、不参与计算与排序）。 */
  attrs?: Record<string, number>;
  /** FC26 PlayStyle id（金徽 = 基础 id + 100，与本仓 src/core/fc26.ts 的金银段口径一致；可能是银也可能是金） */
  playstyles?: number[];
  /** 身高 cm；取不到时为 null（game_attrs.height 可作回退来源） */
  height?: number | null;
}
