import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { ProjectSummary } from '@short-drama/shared';
import { api } from '../api';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return '刚刚更新';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

/** 项目状态角标（视觉稿 ② 的 mark 体系）。 */
function StatusMark({ project }: { project: ProjectSummary }): JSX.Element | null {
  if (!project.latestEpisodeNo) return null;
  if (project.latestStatus === 'running') return <span className="mark run">第 {project.latestEpisodeNo} 集 · 制作中</span>;
  if (project.latestStatus === 'completed') return <span className="mark ok">✓ 第 {project.latestEpisodeNo} 集已完成</span>;
  if (project.latestStatus === 'partial_failed') return <span className="mark warn">第 {project.latestEpisodeNo} 集 · 部分完成可重试</span>;
  if (project.latestStatus === 'failed') return <span className="mark warn">第 {project.latestEpisodeNo} 集 · 生成失败</span>;
  return <span className="mark">第 {project.latestEpisodeNo} 集 · 已登记</span>;
}

/** 项目列表 = 日志索引页（视觉稿 ②）。 */
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
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>
      <div className="page-head">
        <div className="logo">短剧分镜制作助手</div>
        <div style={{ flex: 1 }} />
        <div className="admin-menu">
          <button className="icon" title="更多" aria-label="更多" onClick={() => setAdminOpen((open) => !open)}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="3" cy="8" r="1.6" fill="currentColor" /><circle cx="8" cy="8" r="1.6" fill="currentColor" /><circle cx="13" cy="8" r="1.6" fill="currentColor" />
            </svg>
          </button>
          {adminOpen ? (
            <div className="admin-pop">
              <h6>管理员设置</h6>
              <input className="pw" type="password" placeholder="管理员口令" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} />
              <button className="btn" style={{ width: '100%' }} onClick={() => reset.mutate(adminToken)}>重置 Demo 数据</button>
              <div className="warn">{adminMsg || '将清空全部访客的项目、剧本与登记结果，不可恢复。'}</div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="projects-body">
        <div className="projects-inner">
          <div className="share-note">公共 Demo：以下项目所有访客共享，均可登记、修改、导出；清空仅限管理员。</div>
          <div className="projects-top">
            <h3>项目索引</h3>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-3)' }}>按最近更新</span>
            <div style={{ flex: 1 }} />
            <button className="btn primary" onClick={() => setCreating(true)}>＋ 登记新项目</button>
          </div>

          {creating ? (
            <div className="prow new" style={{ borderBottom: '1px solid var(--rule)', alignItems: 'center' }}>
              <span className="no">＋</span>
              <div className="main" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  type="text"
                  autoFocus
                  placeholder="项目名称（如：城市心跳）"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && name.trim()) create.mutate(name.trim());
                  }}
                  style={{ flex: 1, fontSize: 14 }}
                />
                <button className="btn primary" disabled={!name.trim()} onClick={() => create.mutate(name.trim())}>创建</button>
                <button className="btn" onClick={() => setCreating(false)}>取消</button>
              </div>
            </div>
          ) : null}

          {projects.map((project, index) => (
            <div key={project.id} className="prow" onClick={() => navigate(`/projects/${project.id}`)}>
              <span className="no">{String(index + 1).padStart(2, '0')}</span>
              <div className="main">
                <div className="r1">
                  <span className="name">{project.name}</span>
                  <span className="ep">{project.episodeCount} 集</span>
                  <span className="when">{relativeTime(project.updatedAt)}</span>
                </div>
                <div className="r2">
                  <StatusMark project={project} />
                  {!project.latestEpisodeNo ? <span style={{ color: 'var(--ink-3)' }}>待登记剧本</span> : null}
                  {project.openIssueCount > 0 ? <span className="mark warn">{project.openIssueCount} 穿帮待处理</span> : null}
                </div>
              </div>
            </div>
          ))}

          {!creating ? (
            <div className="prow new" onClick={() => setCreating(true)}>
              <span className="no">{String(projects.length + 1).padStart(2, '0')}</span>
              <div className="main"><div className="r1"><span className="txt">登记新项目——粘贴完整剧本（可一份含多集）即可开始…</span></div></div>
            </div>
          ) : null}

          {projects.length === 0 && creating ? null : null}
        </div>
      </div>
    </div>
  );
}
