// creditUse 动用额口径（v6.57.0 设计 §2.3）：三态 + 旧冻结回加 + 快照缺失。
// 纯函数直测——「口径与服务端预检一致」的同源锁在 tests/expected-income.test.ts（后端侧）。
import { describe, expect, it } from 'vitest';
import { creditUse, round2m } from './credit-line.ts';

const snap = (available: number | null, creditLine: number | null) => ({ available, creditLine });

describe('creditUse（v6.57.0 动用预期收入）', () => {
  it('正好够（现金部分足够）：动用额 0', () => {
    // available=130 已含额度 40 ⇒ 现金自由 = 90；支出 90 恰好用完现金
    expect(creditUse(90, snap(130, 40))).toBe(0);
  });

  it('差一点用额度：超出现金自由的部分才是动用额', () => {
    // 现金自由 90，支出 120 ⇒ 动用 30（≤ creditLine 40）
    expect(creditUse(120, snap(130, 40))).toBe(30);
  });

  it('旧冻结回加（抬价/改标顶替口径）：不回加会把动用额算大一整个旧冻结', () => {
    // 现金自由 90、本人本单旧冻结 30 ⇒ 净差额基准 = 120；支出 120 动用 0
    expect(creditUse(120, snap(130, 40), 30)).toBe(0);
    // 支出 140：净差额 20，其中现金 120 已覆盖 ⇒ 动用 20
    expect(creditUse(140, snap(130, 40), 30)).toBe(20);
    // 对照：不传 oldHold 时同一笔支出动用 50（整整多算一个旧冻结 30）
    expect(creditUse(140, snap(130, 40))).toBe(50);
  });

  it('快照缺失（available / creditLine 为 null）回 0——展示层整行不渲染，不冒充判断', () => {
    expect(creditUse(120, null)).toBe(0);
    expect(creditUse(120, snap(null, 40))).toBe(0);
    expect(creditUse(120, snap(130, null))).toBe(0);
  });

  it('round2m 与服务端同口径（0.1+0.2 类浮点不漂移）', () => {
    expect(round2m(0.1 + 0.2)).toBe(0.3);
    expect(round2m(1.005)).toBe(1.01);
  });
});
