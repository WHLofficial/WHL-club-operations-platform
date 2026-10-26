// @vitest-environment jsdom
// v6.54.0 步骤 8 · 超帽确认弹窗（设计 §10.5 rev18 五件套 / TC-RD-38）：
// - 五件齐备：标题+副行 / 数字行（超额 danger 红）/ 驱动明细（≤3 + 查看全部）/ 后果句 / 双动作
// - 「仍要提交」两段式：第一次只变红改文案，第二次才回调 onConfirm
// - 「去处理」= 主路径（回调 onProcess）；✕ / 遮罩 / Esc 都是取消（不提交）
// - 浮层壳复用 useOverlayShell：jsdom 里打桩 matchMedia（与既有前端测试同一口径）
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { OverCapDialog, type OverCapDriver } from './OverCapDialog.tsx';

beforeEach(() => {
  // 桌面口径（恒 false）：底部抽屉分支由 CSS/真机走查兜，这里钉结构
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(cleanup);

const DRIVERS: OverCapDriver[] = [
  { id: 7, fcId: 7007, name: '张三', delta: 1.2, source: '球员要求' },
  { id: 8, fcId: null, name: '李四', delta: 0.3, source: '普通续约' },
  { id: 9, fcId: 7009, name: '王五', delta: 0.2, source: '保护期调整' },
  { id: 10, fcId: 7010, name: '赵六', delta: 0.1, source: '球员要求' },
];

function renderDialog(over: Partial<Parameters<typeof OverCapDialog>[0]> = {}) {
  const props = {
    current: 66.6,
    projected: 68.1,
    cap: 68,
    drivers: DRIVERS,
    onProcess: vi.fn(),
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  };
  const view = render(
    <MemoryRouter>
      <OverCapDialog {...props} />
    </MemoryRouter>,
  );
  return { ...view, props };
}

describe('OverCapDialog 五件套（v6.54.0 §10.5 / TC-RD-38）', () => {
  it('标题、副行、数字行（超额红）、后果句齐全；cap bar 带完整 aria-label', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('关窗后将超过工资帽')).toBeTruthy();
    expect(within(dialog).getByText('当前窗合规；问题出在待生效合同')).toBeTruthy();
    // 数字行：66.60 → 68.10 / 帽 68.00 · 超 0.10（超额单独一段，danger 色由 .oc-over 给）
    expect(within(dialog).getByText('66.60')).toBeTruthy();
    expect(within(dialog).getByText('68.10')).toBeTruthy();
    expect(within(dialog).getByText('68.00')).toBeTruthy();
    const over = within(dialog).getByText('超 0.10');
    expect(over.className).toContain('oc-over');
    expect(
      within(dialog).getByRole('img', { name: '当前工资 66.60，待生效 68.10，工资帽 68.00' }),
    ).toBeTruthy();
    expect(within(dialog).getByText(/关窗时必须强制拍卖球员降到帽下/)).toBeTruthy();
    expect(within(dialog).getByText('去处理（看待生效明细）')).toBeTruthy();
    expect(within(dialog).getByText('仍要提交')).toBeTruthy();
  });

  it('驱动明细最多 3 条 + 「查看全部」展开（球员名可点进档案，来源与 +Δ 同列）', () => {
    renderDialog();
    const list = screen.getByRole('list', { name: '把关窗后工资顶过帽的待生效合同' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(list.textContent).toContain('张三');
    expect(list.textContent).toContain('+1.20');
    expect(list.textContent).toContain('球员要求');
    // 姓名链接走 playerPath：有 fcId 用 fcId，没有回退内部 id
    expect(within(list).getByText('张三').closest('a')!.getAttribute('href')).toBe('/players/7007');
    // createPortal 渲染到 body，查询要走 document（render 的 container 里是空的）
    expect(document.querySelectorAll('.oc-more')).toHaveLength(1);

    const more = screen.getByText('查看全部 4 条');
    fireEvent.click(more);
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    expect(within(list).getByText('赵六')).toBeTruthy();
    expect(screen.getByText('收起')).toBeTruthy();
  });

  it('「仍要提交」两段式：第一次只变红改文案，第二次才真的提交', () => {
    const { props } = renderDialog();
    const confirm = screen.getByRole('button', { name: '仍要提交' });
    fireEvent.click(confirm);
    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(confirm.className).toContain('btn-armed');
    const armed = screen.getByRole('button', { name: '再点一次确认提交' });
    fireEvent.click(armed);
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('「去处理」走主路径回调；✕ / 遮罩 / Esc 都只是取消', () => {
    const { props } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '去处理（看待生效明细）' }));
    expect(props.onProcess).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);

    // 遮罩点击：面板内的点击被 stopPropagation，遮罩层本身才关
    const mask = document.querySelector('.mkt-ov') as HTMLElement;
    fireEvent.click(mask);
    expect(props.onCancel).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onCancel).toHaveBeenCalledTimes(3);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('数字与明细按调用方传入（不做二次计算）：超帽额 = projected − cap', () => {
    renderDialog({ current: 60, projected: 70.25, cap: 68, drivers: [DRIVERS[0]!] });
    expect(screen.getByText('超 2.25')).toBeTruthy();
    // 只有 1 条驱动 ⇒ 不挂「查看全部」
    expect(screen.queryByText(/查看全部/)).toBeNull();
  });
});
