import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { ProjectSummary } from '@short-drama/shared';
import { api } from '../api';

const STATUS_TEXT: Record<ProjectSummary['latestStatus'], string> = {
  running: '生成中',
  completed: '已完成',
  partial_failed: '部分完成',
  failed: '生成失败',
  idle: '空项目',
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return '刚刚更新';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

export function Projects(): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminToken, setAdminToken] = useState('');
  const [adminMsg, setAdminMsg] = useState('');

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<ProjectSummary[]>('/projects'),
  });

  const create = useMutation({
    mutationFn: (projectName: string) => api<{ id: string }>('/projects', { method: 'POST', body: JSON.stringify({ name: projectName }) }),
    onSuccess: (result) => navigate(`/projects/${result.id}`),
  });

  const reset = useMutation({
    mutationFn: (token: string) => api<{ ok: boolean }>('/admin/reset', { method: 'POST', body: JSON.stringify({ token }) }),
    onSuccess: () => {
      setAdminMsg('已清空全部 Demo 数据');
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (err) => setAdminMsg(err instanceof Error ? err.message : '重置失败'),
  });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'var(--paper-2)', borderBottom: '1.5px solid var(--ink)', padding: '13px 26px' }}>
        <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 1 }}>短剧分镜制作助手</div>
        <div style={{ flex: 1 }} />
        <div style={{ position: 'relative' }}>
          <button
            className="btn"
            aria-label="更多"
            onClick={() => setAdminOpen((open) => !open)}
            style={{ border: 'none', fontSize: 17, padding: '4px 10px', color: 'var(--ink-3)' }}
          >
            ⋯
          </button>
          {adminOpen ? (
            <div style={{
              position: 'absolute', right: 0, top: 38, width: 262, zIndex: 40, background: 'var(--card)',
              border: '1.5px solid var(--ink)', borderRadius: 2, padding: 14, boxShadow: '0 4px 14px rgba(34,36,44,.10)',
            }}>
              <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 9 }}>管理员设置</div>
              <input
                type="password"
                placeholder="管理员口令"
                value={adminToken}
                onChange={(event) => setAdminToken(event.target.value)}
                style={{ width: '100%', marginBottom: 9, fontFamily: 'var(--mono)', fontSize: 12.5 }}
              />
              <button className="btn" style={{ width: '100%' }} onClick={() => reset.mutate(adminToken)}>重置 Demo 数据</button>
              <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 9, fontFamily: 'var(--kai)', lineHeight: 1.6 }}>
                {adminMsg || '将清空全部访客的项目、剧本与登记结果，不可恢复。'}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '30px 28px 60px' }}>
          <div style={{ fontFamily: 'var(--kai)', color: 'var(--red)', fontSize: 13, marginBottom: 20, paddingLeft: 14, borderLeft: '1px solid rgba(192,57,43,.25)' }}>
            公共 Demo：以下项目所有访客共享，均可登记、修改、导出；清空仅限管理员。
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 14 }}>
            <h3 style={{ fontSize: 18, letterSpacing: 1 }}>项目索引</h3>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-3)' }}>按最近更新</span>
            <div style={{ flex: 1 }} />
            <button className="btn primary" onClick={() => setCreating(true)}>＋ 登记新项目</button>
          </div>

          {creating ? (
            <div style={{ background: 'var(--card)', border: '1px solid var(--rule)', borderRadius: 2, padding: '14px 16px', marginBottom: 14, display: 'flex', gap: 10 }}>
              <input
                type="text"
                autoFocus
                placeholder="项目名称（如：城市心跳）"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && name.trim()) create.mutate(name.trim());
                }}
                style={{ flex: 1 }}
              />
              <button className="btn primary" disabled={!name.trim()} onClick={() => create.mutate(name.trim())}>创建</button>
              <button className="btn" onClick={() => setCreating(false)}>取消</button>
            </div>
          ) : null}

          {projects.length === 0 ? (
            <div style={{ color: 'var(--ink-3)', fontFamily: 'var(--kai)', padding: '30px 0', textAlign: 'center' }}>
              暂无项目——点击「登记新项目」，粘贴第一集剧本即可开始
            </div>
          ) : null}

          {projects.map((project, index) => (
            <div
              key={project.id}
              onClick={() => navigate(`/projects/${project.id}`)}
              style={{ display: 'flex', gap: 18, borderBottom: '1px solid var(--rule-2)', padding: '15px 4px', cursor: 'pointer' }}
            >
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-3)', width: 34 }}>
                {String(index + 1).padStart(2, '0')}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                  <span style={{ fontSize: 16.5, fontWeight: 700 }}>{project.name}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-3)' }}>{project.episodeCount} 集</span>
                  <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-3)' }}>{relativeTime(project.updatedAt)}</span>
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 7, fontSize: 12.5, color: 'var(--ink-2)', flexWrap: 'wrap' }}>
                  {project.latestEpisodeNo ? (
                    <span className={`mark ${project.latestStatus === 'running' ? 'run' : project.latestStatus === 'partial_failed' || project.latestStatus === 'failed' ? 'warn' : 'ok'}`}>
                      第 {project.latestEpisodeNo} 集 · {STATUS_TEXT[project.latestStatus]}
                    </span>
                  ) : null}
                  {project.openIssueCount > 0 ? <span className="mark warn">{project.openIssueCount} 穿帮待处理</span> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
