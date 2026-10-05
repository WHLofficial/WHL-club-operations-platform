// v6.31.0 广告板：没有付费加权（emphasis = 0）的名单球员按「时间桶」轮换展示顺序。
// 桶号 = floor(now / TRANSFER_BOARD_ROTATE_MS)；洗牌在 routes/market.ts 的缓存**之外**做
// （缓存键只有 limit，桶号不进键 —— 见那里的注释与 docs/test-plans §7.4 读量核算），所以同一个
// 桶里所有访客看到同一份乱序，桶过了才换一批。付费档（推荐 / 置顶）不参与轮换，始终按着重度与挂出时间排前面。
//
// 为什么是「种子化洗牌」而不是每次 Math.random()：同一份缓存值会被多个 isolate / colo 读到，
// 它们必须算出同一个排列，否则同一时刻不同 isolate 给出的顺序不一致（用户刷新一下顺序就变）。
export const TRANSFER_BOARD_ROTATE_MS = 5 * 60_000;

/** 时间桶号：5 分钟一桶（同一桶 = 同一份乱序） */
export function transferBoardBucket(nowMs: number): number {
  return Math.floor(nowMs / TRANSFER_BOARD_ROTATE_MS);
}

/** mulberry32：小、快、够均匀的种子发生器（不引依赖，纯函数、可复现） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates 洗牌（种子化；不改原数组） */
export function shuffleWithSeed<T>(rows: readonly T[], seed: number): T[] {
  const out = rows.slice();
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}
