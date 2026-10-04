// @vitest-environment jsdom
// v6.30.0 C 段：转会状态四枚手绘线稿图标 + 单元格 + 表下图例。
// 两条硬口径：①单元格只出图标 —— 状态中文只许出现在 title / aria-label 里，可见文本必须为空；
// ②图例行四行俱全 —— 窄屏没有 hover，图例是图标含义的唯一解释来源。
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EuroIcon,
  GavelIcon,
  ListIcon,
  LockIcon,
  TRANSFER_STATUS_GLOSSARY,
  TRANSFER_STATUS_ICON,
  TRANSFER_STATUS_LABEL,
  TRANSFER_STATUS_LEGEND,
  TransferStatusCell,
  TransferStatusLegend,
} from './StatusIcons.tsx';

// vitest 没开 globals，Testing Library 的自动清理不会挂上，得自己来
afterEach(cleanup);

const STATUSES = ['listed', 'transferListed', 'transferPriced', 'notForSale'] as const;

describe('四枚线稿图标', () => {
  it('都是 16×16 单色线稿：viewBox / stroke=currentColor / fill=none / 线宽 2 / aria-hidden', () => {
    for (const [name, Icon] of [
      ['GavelIcon', GavelIcon],
      ['ListIcon', ListIcon],
      ['EuroIcon', EuroIcon],
      ['LockIcon', LockIcon],
    ] as const) {
      const { container } = render(<Icon />);
      const svg = container.querySelector('svg')!;
      expect(svg.getAttribute('viewBox'), name).toBe('0 0 24 24');
      expect(svg.getAttribute('width'), name).toBe('16');
      expect(svg.getAttribute('height'), name).toBe('16');
      expect(svg.getAttribute('fill'), name).toBe('none');
      expect(svg.getAttribute('stroke'), name).toBe('currentColor');
      expect(svg.getAttribute('stroke-width'), name).toBe('2');
      expect(svg.getAttribute('aria-hidden'), name).toBe('true');
      // 手绘线稿：至少有一段可描边内容
      expect(svg.querySelectorAll('path, rect, circle').length, name).toBeGreaterThan(0);
    }
  });

  it('四态各挂自己的图标（映射不串）', () => {
    expect(TRANSFER_STATUS_ICON.listed).toBe(GavelIcon);
    expect(TRANSFER_STATUS_ICON.transferListed).toBe(ListIcon);
    expect(TRANSFER_STATUS_ICON.transferPriced).toBe(EuroIcon);
    expect(TRANSFER_STATUS_ICON.notForSale).toBe(LockIcon);
  });
});

describe('文案与词表', () => {
  it('四态中文名', () => {
    expect(TRANSFER_STATUS_LABEL).toEqual({
      listed: '挂牌中',
      transferListed: '转会名单',
      transferPriced: '已标价',
      notForSale: '非卖品',
    });
  });

  it('表头 title 用的整张词表', () => {
    expect(TRANSFER_STATUS_GLOSSARY).toBe('拍卖锤 挂牌中 · 清单 转会名单 · 欧元 已标价 · 锁 非卖品');
  });

  it('图例顺序与起名', () => {
    expect(TRANSFER_STATUS_LEGEND.map((l) => l.status)).toEqual([...STATUSES]);
    expect(TRANSFER_STATUS_LEGEND.map((l) => l.glyph)).toEqual(['拍卖锤', '清单', '欧元', '锁']);
  });
});

describe('状态单元格：只出图标，不出文字', () => {
  it('title 与 aria-label 都出全称，可见文本是空的', () => {
    const { container } = render(<TransferStatusCell status="listed" />);
    const cell = container.querySelector('.transfer-status')!;
    expect(cell.getAttribute('title')).toBe('挂牌中');
    expect(cell.getAttribute('aria-label')).toBe('挂牌中');
    expect(cell.querySelector('svg')).not.toBeNull();
    expect(cell.textContent).toBe('');
    expect(cell.textContent).not.toContain('挂牌');
  });

  it('四态逐个查：有图标、有全称、无可见中文', () => {
    for (const status of STATUSES) {
      const { container } = render(<TransferStatusCell status={status} />);
      const cell = container.querySelector('.transfer-status')!;
      expect(cell.getAttribute('title'), status).toBe(TRANSFER_STATUS_LABEL[status]);
      expect(cell.getAttribute('aria-label'), status).toBe(TRANSFER_STATUS_LABEL[status]);
      expect(cell.querySelector('svg'), status).not.toBeNull();
      expect(cell.textContent, status).toBe('');
    }
  });

  it('四态全不占 → 灰「—」，没有图标', () => {
    const { container } = render(<TransferStatusCell status={null} />);
    const cell = container.querySelector('.transfer-status')!;
    expect(cell.className).toContain('muted');
    expect(cell.textContent).toBe('—');
    expect(cell.querySelector('svg')).toBeNull();
  });
});

describe('表下一行图例（窄屏没有 hover，靠它解释图标）', () => {
  it('四行俱全：图标 + 人话名字 + 状态词', () => {
    const { container } = render(<TransferStatusLegend />);
    const items = container.querySelectorAll('.transfer-legend-item');
    expect(Array.from(items, (el) => el.textContent)).toEqual([
      '拍卖锤 挂牌中',
      '清单 转会名单',
      '欧元 已标价',
      '锁 非卖品',
    ]);
    // 每行都带自己的图标
    expect(container.querySelectorAll('.transfer-legend-item svg')).toHaveLength(4);
  });

  it('图例整体带 .transfer-status-legend（样式挂钩点）', () => {
    const { container } = render(<TransferStatusLegend />);
    const legend = container.querySelector('p.transfer-status-legend')!;
    expect(legend.textContent).toContain('拍卖锤 挂牌中');
  });
});
