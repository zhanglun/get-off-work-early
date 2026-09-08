import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

/** 登录页 = 日志本首页登记（视觉稿 ①）。 */
export function Login(): JSX.Element {
  const navigate = useNavigate();
  const [username, setUsername] = useState('demo');
  const [password, setPassword] = useState('demo123');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      navigate('/projects');
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>
      <div className="login-stage">
        <div className="reg-card">
          <div className="reg-brand">短剧分镜制作助手</div>
          <div className="reg-sub">SCRIPT CONTINUITY LOG</div>
          <div className="reg-row">
            <span className="k">Demo 账号</span>
            <input type="text" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
          </div>
          <div className="reg-row">
            <span className="k">Demo 密码</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
          </div>
          <button className="btn primary big" disabled={busy} onClick={() => void submit()}>
            {busy ? '进入中…' : '进入 Demo'}
          </button>
          {error ? (
            <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--red)' }}>
              <span className="stamp" style={{ fontSize: 11, marginRight: 8 }}>错误</span>{error}
            </div>
          ) : null}
          <div className="reg-hint">登录保持 7 天 · 所有访客共享同一本日志</div>
        </div>
      </div>
    </div>
  );
}
