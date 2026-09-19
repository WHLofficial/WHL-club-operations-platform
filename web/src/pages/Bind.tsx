// 认证码绑队（UI_DESIGN §5 登录/建队：档案登记卡文案 + 绑定成功盖 .stamp-ok）
import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { apiPost } from '../lib/api.ts';

export default function Bind() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const qc = useQueryClient();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await apiPost('/api/clubs/bind', { code: code.trim().toUpperCase() });
      // 绑定改变 /api/me/club 的 club 形状，球队中心/市场的缓存全部失效
      void qc.invalidateQueries({ queryKey: ['me', 'club'] });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '绑定失败，请稍后再试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <div className="auth-card">
        <h1>球队登记</h1>
        {done ? (
          <div className="bind-done">
            <div className="stamp stamp-ok">登记完成</div>
            <p>档案已入柜。去球队中心看看你的俱乐部吧。</p>
            <Link className="btn" to="/club">
              去球队中心
            </Link>
          </div>
        ) : (
          <>
            <p className="muted">把管理组给你的 8 位认证码填进来，一表定归属。</p>
            <form onSubmit={submit}>
              <label className="field">
                认证码
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="8 位字母数字"
                  maxLength={8}
                  autoComplete="off"
                  spellCheck={false}
                  className="code-input"
                />
              </label>
              {error && <p className="error-msg">{error}</p>}
              <button className="btn" type="submit" disabled={busy || code.trim().length !== 8}>
                {busy ? '正在登记…' : '提交登记'}
              </button>
            </form>
            <p className="hint">一账号只能绑一支球队；认证码一次有效，过期作废。解绑要找管理组。</p>
          </>
        )}
      </div>
    </div>
  );
}
