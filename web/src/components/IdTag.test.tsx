// @vitest-environment jsdom
// v6.68.0 期 A：IdTag = 灰色 `#编号` 文本按钮，点一下复制。
// 两条硬口径：①复制的是纯数字（不带 #），管理端粘贴到「填 ID」的框里能直接用；
// ②复制失败不能静默——必须标红 + toast 带上编号，让用户手动抄。
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdTag } from './IdTag.tsx';

const copyText = vi.fn<(text: string) => Promise<boolean>>();
vi.mock('../lib/clipboard.ts', () => ({ copyText: (text: string) => copyText(text) }));

afterEach(() => {
  cleanup();
  copyText.mockReset();
});

describe('IdTag', () => {
  it('渲染 #编号，点击后复制纯数字并 toast 提示', async () => {
    copyText.mockResolvedValue(true);
    render(<IdTag kind="挂牌" value={18} />);

    const btn = screen.getByRole('button', { name: '挂牌 #18，点击复制' });
    expect(btn.textContent).toBe('#18');

    fireEvent.click(btn);

    await waitFor(() => expect(copyText).toHaveBeenCalledWith('18'));
    await waitFor(() => expect(screen.getByText('已复制 挂牌 #18')).toBeTruthy());
    expect(btn.className).not.toContain('failed');
  });

  it('复制失败：标红 + 提示手动选择（编号照样可见）', async () => {
    copyText.mockResolvedValue(false);
    render(<IdTag kind="谈判" value={96} />);

    const btn = screen.getByRole('button', { name: '谈判 #96，点击复制' });
    fireEvent.click(btn);

    await waitFor(() => expect(btn.className).toContain('failed'));
    await waitFor(() => expect(screen.getByText('复制失败，请手动选择 #96')).toBeTruthy());
  });
});
