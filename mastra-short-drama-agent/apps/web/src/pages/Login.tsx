import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
      <div style={{
        width: 400, background: 'var(--card)', border: '1.5px solid var(--ink)', borderRadius: 2,
        padding: '38px 36px 30px', position: 'relative',
      }}>
        <div style={{ position: 'absolute', left: 46, top: 0, bottom: 0, width: 1, background: 'rgba(192,57,43,.25)' }} />
        <div style={{ fontSize: 25, fontWeight: 700, letterSpacing: 2 }}>短剧分镜制作助手</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-3)', letterSpacing: 1.5, margin: '6px 0 24px' }}>
          SCRIPT CONTINUITY LOG
        </div>
        <div style={{ borderBottom: '1px solid var(--rule)', padding: '9px 2px', display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
          <span style={{ color: 'var(--ink-2)' }}>Demo 账号</span>
          <span style={{ fontFamily: 'var(--mono)' }}>demo</span>
        </div>
        <div style={{ borderBottom: '1px solid var(--rule)', padding: '9px 2px', display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
          <span style={{ color: 'var(--ink-2)' }}>Demo 密码</span>
          <span style={{ fontFamily: 'var(--mono)' }}>demo123</span>
        </div>
        <button className="btn primary" style={{ marginTop: 24, width: '100%', padding: '10px 22px', fontSize: 14.5 }} disabled={busy} onClick={() => void submit()}>
          {busy ? '进入中…' : '进入 Demo'}
        </button>
        {error ? <div style={{ color: 'var(--red)', fontSize: 12.5, marginTop: 12 }}>{error}</div> : null}
        <div style={{ color: 'var(--ink-3)', fontSize: 12, marginTop: 16, fontFamily: 'var(--kai)', lineHeight: 1.9 }}>
          登录保持 7 天 · 所有访客共享同一本日志
        </div>
      </div>
    </div>
  );
}
