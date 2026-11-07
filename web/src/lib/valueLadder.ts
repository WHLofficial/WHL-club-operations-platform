// 身价阶梯（v6.79.0，设计 docs/superpowers/specs/2026-11-07-market-value-admin-design.md §2）：
// 纯函数、无 IO。插件侧同规则实现 services/market_value.py（snap_to_ladder），
// 两端靠同一组对拍样例锁定（valueLadder.test.ts / pytest TestSnapToLadder）。
//
// 档表（升序）：
// - v ≤ 10：整数 1–10（步长 1）
// - 10 < v ≤ 30：固定档 12, 13, 15, 17, 18, 20, 22, 23, 25, 27, 28, 30
// - v > 30：5 的倍数 ≥ 35：35, 40, 45, 50, …（无限延伸）
//
// 语义：
// - snap(x)：与 x 距离最小的档；距离并列取低档；x ≤ 0 → 1。
// - next(x)：档表中最小的大于 x 的档（严格邻档，x 不在档上时同样良定义）。
// - prev(x)：档表中最大的小于 x 的档；1 已是最低档，再往下没有 → null。
// - x 非有限数（NaN / ±Infinity）按 x ≤ 0 处理（防御分支，页面层不传这种值）。

/** 10 < v ≤ 30 的固定档（升序） */
const MID_RUNGS: readonly number[] = [12, 13, 15, 17, 18, 20, 22, 23, 25, 27, 28, 30];
/** v > 30 段的起点档与步长 */
const TOP_START = 35;
const TOP_STEP = 5;

/** 最大的 ≤ x 的档；x < 1 时没有 → null */
function floorRung(x: number): number | null {
  if (x < 1) return null;
  if (x <= 10) return Math.floor(x);
  if (x <= 30) {
    // x ∈ (10, 12) 落回整数段的 10
    let f: number = 10;
    for (const r of MID_RUNGS) {
      if (r <= x) f = r;
      else break;
    }
    return f;
  }
  // x ∈ (30, 35) 时商落在 (-1, 0)，floor 后得 TOP_START - TOP_STEP = 30，恰好是正确低档
  return TOP_START + TOP_STEP * Math.floor((x - TOP_START) / TOP_STEP);
}

/** 最小的 ≥ x 的档（档表无上限，恒有解） */
function ceilRung(x: number): number {
  if (x <= 1) return 1;
  if (x <= 10) return Math.ceil(x);
  if (x <= 30) {
    for (const r of MID_RUNGS) {
      if (r >= x) return r;
    }
    return TOP_START; // 不可达：MID_RUNGS 末档 30 ≥ x
  }
  // x ∈ (30, 35) 时商 ∈ (-1, 0]，ceil 得 0 → TOP_START，恰好是正确高档
  return TOP_START + TOP_STEP * Math.ceil((x - TOP_START) / TOP_STEP);
}

/** 与 x 距离最小的档；距离并列取低档；x ≤ 0（含非有限数）→ 1 */
export function snap(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 1;
  const f = floorRung(x);
  if (f === null) return ceilRung(x); // x ∈ (0, 1)：只有 1 一个候选
  const c = ceilRung(x);
  if (f === c) return f; // x 恰在档上
  return x - f <= c - x ? f : c; // 并列取低档
}

/** 档表中最小的大于 x 的档（严格邻档）；x ≤ 0（含非有限数）→ 最低档 1 */
export function next(x: number): number {
  if (!Number.isFinite(x) || x < 1) return 1;
  const c = ceilRung(x);
  if (c > x) return c;
  // x 恰在档上 → 严格下一档
  if (x < 10) return x + 1;
  if (x === 10) return 12;
  if (x === 30) return 35;
  if (x > 30) return x + TOP_STEP;
  const i = MID_RUNGS.indexOf(x); // x ∈ (10, 30) 且在档上
  return MID_RUNGS[i + 1];
}

/** 档表中最大的小于 x 的档（严格邻档）；1 已是最低档 → null */
export function prev(x: number): number | null {
  if (!Number.isFinite(x) || x <= 1) return null;
  const f = floorRung(x);
  if (f !== null && f < x) return f;
  // x 恰在档上 → 严格上一档
  if (x <= 10) return x - 1;
  if (x === 12) return 10;
  if (x === 30) return 28;
  if (x === 35) return 30;
  if (x > 35) return x - TOP_STEP;
  const i = MID_RUNGS.indexOf(x); // x ∈ (10, 30) 且在档上（12 由上面分支接管）
  return i > 0 ? MID_RUNGS[i - 1] : 10;
}
