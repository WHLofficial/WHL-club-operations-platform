// 管理端对话框式 prompt（增量 15 commit 4）：替代 window.prompt（浏览器原生框无样式且不可控）。
// 用法：const { ask, promptNode } = usePrompt(); const reason = await ask('原因：'); cancel 返回 null。
import { useState } from 'react';

interface PromptState {
  message: string;
  resolve: (value: string | null) => void;
}

export function usePrompt() {
  const [state, setState] = useState<PromptState | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  function ask(message: string): Promise<string | null> {
    setValue('');
    setError('');
    return new Promise((resolve) => setState({ message, resolve }));
  }

  function finish(resolve: (v: string | null) => void, out: string | null) {
    resolve(out);
    setState(null);
  }

  function submit() {
    if (!state) return;
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setError('至少写两个字，原因会进审计。');
      return;
    }
    finish(state.resolve, trimmed);
  }

  const promptNode = state ? (
    <div className="modal-mask" role="dialog" aria-modal="true" aria-label={state.message}>
      <div className="modal-card card">
        <p>{state.message}</p>
        <input
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') finish(state.resolve, null);
          }}
        />
        {error && <p className="error-msg">{error}</p>}
        <div className="actions">
          <button className="btn" type="button" onClick={submit}>
            确认
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => finish(state.resolve, null)}>
            取消
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { ask, promptNode };
}
