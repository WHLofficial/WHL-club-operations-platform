export function expectedWage(level: number, releaseFee: number, a: number, b: number, c: number): number {
  return Math.round(a * level ** b * releaseFee ** c * 100) / 100;
}

export function attemptExpected(base: number, attemptNo: number, mult: number): number {
  if (attemptNo > 1) return Math.round(base * mult * 100) / 100;
  return base;
}

export function successRate(offered: number, expected: number, slope: number, mid: number): number {
  if (offered <= 0 || expected <= 0) return 0;
  const ratio = offered / expected;
  if (ratio >= 1) return 1;
  return 1 / (1 + Math.exp((slope * (ratio - mid)) / 0.4));
}

export function directFail(p: number, threshold: number, probability: number, roll: number): boolean {
  return p < threshold && roll < probability;
}

export function satisfactionText(p: number, lo: number, mid: number, hi: number): string {
  if (p >= hi) return '😍 经纪人非常满意';
  if (p >= mid) return '🙂 经纪人比较满意';
  if (p >= lo) return '😐 经纪人不太满意';
  return '😠 经纪人很不满意';
}
