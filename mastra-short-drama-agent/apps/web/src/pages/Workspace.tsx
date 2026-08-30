import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Snapshot } from '@short-drama/shared';
import { api } from '../api';

export function Workspace(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: snapshot } = useQuery({
    queryKey: ['snapshot', id],
    queryFn: () => api<Snapshot>(`/projects/${id}/snapshot`),
    enabled: Boolean(id),
  });

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, background: 'var(--paper-2)', borderBottom: '1.5px solid var(--ink)', padding: '11px 32px' }}>
        <span className="lnk" onClick={() => navigate('/projects')}>← 项目</span>
        <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: 1 }}>{snapshot?.project.name ?? '…'}</span>
        <div style={{ flex: 1 }} />
        <button className="btn">导出项目 ZIP</button>
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1.5px solid var(--ink)', minWidth: 0 }}>
          <div style={{ flex: 1, padding: '24px 30px', overflowY: 'auto' }}>
            <div style={{ fontFamily: 'var(--kai)', color: 'var(--ink-2)', fontSize: 14 }}>
              {snapshot?.messages.length ? '对话记录将在此展开' : '把第一集剧本贴进来吧——我会依次确认项目名、集数和镜头数，然后开始自动制作。'}
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--rule)', padding: '14px 30px 20px', background: 'var(--paper)' }}>
            <div style={{ border: '1px solid var(--ink)', borderRadius: 2, padding: '11px 14px', background: 'var(--card)' }}>
              <textarea placeholder="粘贴一集已完成的剧本，或拖入 .md / .txt 文件…" style={{ width: '100%', border: 'none', outline: 'none', resize: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 14, minHeight: 21 }} rows={1} />
            </div>
          </div>
        </div>
        <div style={{ width: '44%', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '14px 26px 10px', borderBottom: '1.5px solid var(--ink)' }}>
            <b style={{ fontSize: 15 }}>图版区</b>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-2)', letterSpacing: 1 }}>M3 起实时生长</span>
          </div>
          <div style={{ flex: 1, padding: '18px 26px', overflowY: 'auto', color: 'var(--ink-3)', fontFamily: 'var(--kai)' }}>
            分镜图版、资产、穿帮记录将在导入剧本后逐件出现。
          </div>
        </div>
      </div>
    </div>
  );
}
