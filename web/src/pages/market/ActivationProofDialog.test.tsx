// @vitest-environment jsdom
// v6.60.0 激活通知截图弹窗（TC-P / TC-F / TC-V / TC-C）：
// 文案讲清三样信息、点选与拖拽都能预览、类型/大小/空文件客户端拦下、失败留在弹窗可重试。
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivationProofDialog } from './ActivationProofDialog.tsx';

const createObjectURL = vi.fn(() => 'blob:proof-preview');
const revokeObjectURL = vi.fn();

beforeEach(() => {
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  Object.assign(URL, { createObjectURL, revokeObjectURL });
});

afterEach(() => {
  cleanup();
});

function imageFile(name = 'proof.png', type = 'image/png', size = 1024): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function renderDialog(overrides: Partial<Parameters<typeof ActivationProofDialog>[0]> = {}) {
  const onClose = vi.fn();
  const onConfirm = vi.fn(() => Promise.resolve());
  render(
    <ActivationProofDialog
      playerName="阿切尔比"
      opponentClubName="国际米兰"
      myClubName="利物浦"
      onClose={onClose}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { onClose, onConfirm };
}

function pick(file: File) {
  fireEvent.change(screen.getByLabelText('选择激活通知截图'), { target: { files: [file] } });
}

describe('ActivationProofDialog', () => {
  it('讲清激活前要做的事与截图里的三样信息', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: '上传激活通知截图' });
    expect(dialog.textContent).toContain('先在 QQ 私信对方主教练');
    expect(dialog.textContent).toContain('你的俱乐部名');
    expect(dialog.textContent).toContain('球员名');
    expect(dialog.textContent).toContain('一句提醒：竞价结束后请选择是否匹配');
    expect(dialog.textContent).toContain('利物浦主教练');
  });

  it('没有我的队名时用规则原文示例，不拼出半截句子', () => {
    renderDialog({ myClubName: null });
    fireEvent.click(screen.getByText('看一条示例'));
    expect(screen.getByText(/国际米兰主教练您好，我是利物浦主教练/)).toBeTruthy();
  });

  it('点选图片后显示预览，确认才调用 onConfirm', async () => {
    const { onConfirm } = renderDialog();
    const file = imageFile();
    pick(file);

    expect(await screen.findByAltText('激活通知截图预览')).toBeTruthy();
    expect(screen.getByText('proof.png')).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '确认激活' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(file));
  });

  it('拖拽文件同样进入预览，多文件只取第一张', async () => {
    renderDialog();
    fireEvent.drop(screen.getByRole('button', { name: /把截图拖到这里/ }), {
      dataTransfer: { files: [imageFile('first.webp', 'image/webp'), imageFile('second.png')] },
    });
    expect(await screen.findByAltText('激活通知截图预览')).toBeTruthy();
    expect(screen.getByText('first.webp')).toBeTruthy();
    expect(screen.queryByText('second.png')).toBeNull();
  });

  it('空 drop 不改变状态、不报错', () => {
    renderDialog();
    fireEvent.drop(screen.getByRole('button', { name: /把截图拖到这里/ }), { dataTransfer: { files: [] } });
    expect(screen.queryByAltText('激活通知截图预览')).toBeNull();
    expect(screen.getByRole('button', { name: '确认激活' })).toHaveProperty('disabled', true);
  });

  it('重新选择会换图并释放旧 object URL', async () => {
    createObjectURL.mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
    renderDialog();
    pick(imageFile('a.png'));
    expect(await screen.findByAltText('激活通知截图预览')).toBeTruthy();
    expect((screen.getByAltText('激活通知截图预览') as HTMLImageElement).src).toContain('blob:first');

    const input = screen.getByLabelText('选择激活通知截图') as HTMLInputElement;
    const openPicker = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: '重新选择' }));
    expect(openPicker).toHaveBeenCalledTimes(1);
    pick(imageFile('b.webp', 'image/webp'));

    expect(await screen.findByText('b.webp')).toBeTruthy();
    expect((screen.getByAltText('激活通知截图预览') as HTMLImageElement).src).toContain('blob:second');
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:first'));
  });

  it('正好 5MB 的图片放行', async () => {
    renderDialog();
    pick(imageFile('edge.jpg', 'image/jpeg', 5 * 1024 * 1024));
    expect(await screen.findByAltText('激活通知截图预览')).toBeTruthy();
    expect((screen.getByRole('button', { name: '确认激活' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('空文件、类型不对、超过 5MB 都在客户端拦下且不能确认', () => {
    renderDialog();
    pick(imageFile('empty.png', 'image/png', 0));
    expect(screen.getByRole('alert').textContent).toBe('截图是空的，换一张试试');

    pick(imageFile('notes.txt', 'text/plain'));
    expect(screen.getByRole('alert').textContent).toBe('只支持 png、jpg、webp 图片');

    pick(imageFile('big.jpg', 'image/jpeg', 5 * 1024 * 1024 + 1));
    expect(screen.getByRole('alert').textContent).toBe('截图超过 5MB，压缩后再传');
    expect((screen.getByRole('button', { name: '确认激活' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('取消不发请求', () => {
    const { onClose, onConfirm } = renderDialog();
    pick(imageFile());
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('上传失败留在弹窗显示错误，恢复后可重试', async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(new Error('上传失败，请重试')).mockResolvedValueOnce(undefined);
    renderDialog({ onConfirm });
    pick(imageFile());

    fireEvent.click(screen.getByRole('button', { name: '确认激活' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '上传失败，请重试');
    const retry = screen.getByRole('button', { name: '确认激活' }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);

    fireEvent.click(retry);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
  });

  it('提交中锁住取消与关闭，Esc 也不关', async () => {
    let resolveConfirm: () => void = () => {};
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    const { onClose } = renderDialog({ onConfirm });
    pick(imageFile());

    fireEvent.click(screen.getByRole('button', { name: '确认激活' }));
    const submitting = await screen.findByRole('button', { name: '提交中…' });
    expect((submitting as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    resolveConfirm();
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });
});
