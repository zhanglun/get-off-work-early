import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { PipelineStage } from '@short-drama/shared';
import { api } from '../api';

function CheckGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" style={{ flex: 'none' }}>
      <path d="M2 6.5 L5 9.5 L10 2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export interface BoardData {
  episode: { id: string; episodeNo: number; status: string; shotTarget: number | null };
  stages: { stage: string; stages: Partial<Record<PipelineStage, string>>; shotsDone: number; shotsTotal: number };
  taskStatus: string | null;
  scenes: {
    sceneNo: number; heading: string; timeLabel: string | null; locationLabel: string | null; objective: string;
    shots: { sequence: number; status: string; draft: Record<string, unknown>; promptVersions: number }[];
  }[];
  issues: { id: string; kind: string; severity: string; issue: string; suggestion: string | null; targetId: string; status: string }[];
  projectAssets: { id: string; kind: string; name: string; data: Record<string, unknown> }[];
}

const STAGE_ORDER: PipelineStage[] = ['parse', 'assets', 'scenes', 'shots', 'review', 'package'];
const STAGE_TEXT: Record<PipelineStage, string> = {
  parse: '剧本', assets: '资产', scenes: '场次', shots: '分镜', review: '检查', package: '包',
};

/** 分格角标：黑底白字方块（漫画页码/格号位置），当前项为青色网点 */
function Tag({ n, current }: { n: string; current?: boolean }): JSX.Element {
  return (
    <span
      className={`ink-step ${current ? 'halftone' : ''}`}
      style={{
        flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 26, height: 26, background: current ? undefined : 'var(--ink)',
        color: current ? 'var(--cyan-deep)' : '#fff', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 12,
      }}
    >
      {n}
    </span>
  );
}

export function WorkspaceBoard({ projectId, activeEpisodeId, invalidateKey }: { projectId: string; activeEpisodeId: string | null; invalidateKey: number }): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [, setLocalTick] = useState(0);
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['board', activeEpisodeId] });
    setLocalTick((value) => value + 1);
  };
  const retryShot = useMutation({
    mutationFn: (scope: { sceneNo: number; sequence: number }) =>
      api(`/episodes/${activeEpisodeId}/retry`, { method: 'POST', body: JSON.stringify({ scope }) }),
    onSuccess: () => refresh(),
  });
  const ignoreIssue = useMutation({
    mutationFn: (issueId: string) => api(`/issues/${issueId}/ignore`, { method: 'POST' }),
    onSuccess: () => refresh(),
  });
  const autoFix = useMutation({
    mutationFn: (issueId: string) => api(`/issues/${issueId}/auto-fix`, { method: 'POST' }),
    onSuccess: () => refresh(),
  });
  const { id } = useParams<{ id: string }>();
  const { data: board } = useQuery({
    queryKey: ['board', activeEpisodeId, invalidateKey],
    queryFn: () => api<BoardData>(`/episodes/${activeEpisodeId}/board`),
    enabled: Boolean(activeEpisodeId),
  });
  void projectId;

  if (!activeEpisodeId) {
    return (
      <div className="ws-board" style={{ width: '44%', borderLeft: '2px solid var(--ink)', padding: '18px 24px', color: 'var(--ink-3)', fontSize: 13.5 }}>
        登记剧本后，分格画廊将在这里逐格生长。
      </div>
    );
  }

  const currentStage = (board?.stages.stage ?? 'parse') as PipelineStage;
  const done = board?.taskStatus === 'completed' || board?.taskStatus === 'partial_failed';

  return (
    <div className="ws-board" style={{ width: '44%', display: 'flex', minWidth: 0, borderLeft: '2px solid var(--ink)' }}>
      {/* 站点账：阶段页码索引 + 场次索引 */}
      <div style={{ width: 118, flex: 'none', background: 'var(--gutter)', padding: '14px 0', overflowY: 'auto', borderRight: '1px solid var(--rule)' }}>
        {STAGE_ORDER.map((stage, index) => {
          const state = board?.stages.stages[stage];
          const isCurrent = !done && currentStage === stage;
          return (
            <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 18px 5px 8px', fontSize: 11.5, color: state === 'completed' ? 'var(--ink-2)' : isCurrent ? 'var(--cyan-deep)' : 'var(--ink-3)', fontWeight: isCurrent ? 700 : 400 }}>
              <Tag n={String(index + 1)} current={isCurrent} />
              <span>
                {STAGE_TEXT[stage]}
                {stage === 'shots' && board?.stages.shotsTotal ? ` ${board.stages.shotsDone}/${board.stages.shotsTotal}` : ''}
              </span>
              <span style={{ marginLeft: 'auto', display: 'inline-flex' }}>{state === 'completed' ? <CheckGlyph /> : isCurrent ? '·' : ''}</span>
            </div>
          );
        })}
        <div style={{ borderTop: '1px solid var(--rule)', margin: '8px 12px 8px 0' }} />
        {(board?.scenes ?? []).map((scene) => (
          <div key={scene.sceneNo} style={{ padding: '4px 18px 4px 8px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-2)', textAlign: 'right' }}>
            场{scene.sceneNo}
            <b style={{ display: 'block', fontSize: 12.5, color: 'var(--ink)' }}>{scene.shots.length} 镜</b>
          </div>
        ))}
        {(board?.issues.length ?? 0) > 0 ? (
          <div style={{ padding: '4px 18px 4px 8px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--red-deep)', textAlign: 'right' }}>
            穿帮<b style={{ display: 'block', fontSize: 12.5 }}>{board!.issues.filter((issue) => issue.status === 'open').length}</b>
          </div>
        ) : null}
      </div>

      {/* 分格画廊 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--page)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '11px 20px 9px', borderBottom: '2px solid var(--ink)' }}>
          <b style={{ fontSize: 14, fontWeight: 900 }}>分格画廊</b>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--ink-2)' }}>
            {board ? `第 ${board.episode.episodeNo} 集 · ${board.scenes.reduce((sum, scene) => sum + scene.shots.length, 0)} 镜` : '…'}
          </span>
          <div style={{ flex: 1 }} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px 40px' }}>
          {/* 项目级资产 */}
          {(board?.projectAssets.length ?? 0) > 0 ? (
            <>
              <div style={{ fontSize: 12, color: 'var(--ink-2)', letterSpacing: 1, borderBottom: '1px solid var(--ink)', paddingBottom: 5, marginBottom: 9, fontWeight: 700 }}>项目级资产 · {board!.projectAssets.length}</div>
              {board!.projectAssets.map((asset) => (
                <div key={asset.id} style={{ background: 'var(--panel)', border: '1px solid var(--rule)', padding: '7px 12px', fontSize: 12.5, marginBottom: 6, display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <b>{asset.name}</b>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--cyan-deep)', border: '1px solid var(--cyan)', padding: '0 4px' }}>{asset.kind === 'character' ? '项目级' : asset.kind}</span>
                  <span style={{ color: 'var(--ink-2)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String((asset.data as { canonicalDescription?: string; clothing?: string }).canonicalDescription ?? '').slice(0, 36)}</span>
                </div>
              ))}
            </>
          ) : null}

          {/* 场次与分镜格 */}
          {(board?.scenes ?? []).map((scene) => (
            <div key={scene.sceneNo}>
              <div style={{ fontSize: 12, color: 'var(--ink-2)', letterSpacing: 1, borderBottom: '1px solid var(--ink)', paddingBottom: 5, margin: '14px 0 9px', display: 'flex', gap: 8, fontWeight: 700 }}>
                <span>场{scene.sceneNo} · {scene.heading.slice(0, 18)}</span>
                <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontWeight: 400 }}>{scene.shots.length} 镜</span>
              </div>
              {scene.shots.map((shot) => {
                const draft = shot.draft as Partial<{ shotSize: string; cameraMove: string; imagePrompt: string; videoPrompt: string; composition: string; lighting: string; emotion: string }>;
                const failed = shot.status === 'failed';
                return (
                  <div
                    key={shot.sequence}
                    className={failed ? undefined : 'speedlines'}
                    style={{
                      background: 'var(--panel)', border: failed ? '2px solid var(--red)' : '2px solid var(--ink)',
                      padding: '10px 14px', marginBottom: 8, position: 'relative',
                      boxShadow: failed ? '3px 0 0 var(--cyan)' : undefined,
                    }}
                  >
                    {/* 镜号角标 */}
                    <span style={{ position: 'absolute', top: -2, left: -2, background: failed ? 'var(--red)' : 'var(--ink)', color: '#fff', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, padding: '1px 7px' }}>
                      {String(shot.sequence).padStart(2, '0')}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, marginLeft: 34 }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-2)' }}>{draft.shotSize ?? '—'} · {draft.cameraMove ?? '—'}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-3)', border: '1px solid var(--rule)', padding: '0 4px', marginLeft: 'auto' }}>预览占位帧</span>
                      {shot.status !== 'done' ? (
                        <span className="stamp" style={{ fontSize: 10.5, padding: '0 6px' }}>{failed ? '失败' : '待审'}</span>
                      ) : null}
                    </div>
                    {draft.imagePrompt ? (
                      <>
                        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>{draft.composition ?? ''}</div>
                        <div style={{ margin: '6px 0 0 18px', fontSize: 11.5, color: 'var(--ink-2)' }}>
                          <b style={{ display: 'block', fontFamily: 'var(--mono)', fontWeight: 400, fontSize: 10, letterSpacing: 1, color: 'var(--cyan-deep)' }}>IMAGE PROMPT</b>
                          {draft.imagePrompt}
                        </div>
                        <div style={{ margin: '4px 0 0 18px', fontSize: 11.5, color: 'var(--ink-2)' }}>
                          <b style={{ display: 'block', fontFamily: 'var(--mono)', fontWeight: 400, fontSize: 10, letterSpacing: 1, color: 'var(--cyan-deep)' }}>VIDEO PROMPT</b>
                          {draft.videoPrompt}
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--red-deep)', marginLeft: 34 }}>生成失败——可单项重试</div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {/* 穿帮记录 */}
          {(board?.issues.length ?? 0) > 0 ? (
            <>
              <div style={{ fontSize: 12, color: 'var(--ink-2)', letterSpacing: 1, borderBottom: '1px solid var(--ink)', paddingBottom: 5, margin: '16px 0 9px', fontWeight: 700 }}>穿帮记录 · {board!.issues.length}</div>
              {board!.issues.map((issue) => {
                const [sn, sq] = issue.targetId.split(':').map(Number);
                const open = issue.status === 'open';
                return (
                  <div key={issue.id} style={{
                    background: issue.kind === 'fact' || issue.kind === 'failure' ? 'var(--red-wash)' : 'var(--yellow-wash)',
                    border: `2px solid ${issue.kind === 'fact' || issue.kind === 'failure' ? 'var(--red)' : 'var(--yellow)'}`,
                    padding: '8px 12px', fontSize: 12.5, marginBottom: 7,
                    color: issue.kind === 'fact' || issue.kind === 'failure' ? 'var(--red-deep)' : 'var(--ink)',
                    opacity: open ? 1 : 0.6,
                  }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, border: '1px solid currentColor', padding: '0 5px', marginRight: 7 }}>
                      {issue.kind === 'wording' ? '措辞' : issue.kind === 'fact' ? '事实' : '失败'}
                    </span>
                    {issue.issue}
                    <span style={{ marginLeft: 8, float: 'right', display: 'flex', gap: 6 }}>
                      {!open ? <span style={{ fontSize: 11 }}>{issue.status === 'ignored' ? '已忽略' : issue.status === 'auto_fixed' ? '已修订' : '已解决'}</span> : (
                        <>
                          {issue.kind === 'failure' ? <button className="btn" style={{ padding: '1px 9px', fontSize: 11.5 }} onClick={() => retryShot.mutate({ sceneNo: sn, sequence: sq })}>重试镜 {sn}-{sq}</button> : null}
                          {issue.kind === 'wording' ? <button className="btn primary" style={{ padding: '1px 9px', fontSize: 11.5 }} onClick={() => autoFix.mutate(issue.id)}>自动修订</button> : null}
                          {issue.kind === 'fact' ? <button className="btn" style={{ padding: '1px 9px', fontSize: 11.5 }} onClick={() => autoFix.mutate(issue.id)} disabled>需人工</button> : null}
                          {issue.kind !== 'failure' ? <button className="btn" style={{ padding: '1px 9px', fontSize: 11.5 }} onClick={() => ignoreIssue.mutate(issue.id)}>忽略</button> : null}
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </>
          ) : null}

          {!board ? <div style={{ color: 'var(--ink-3)', fontSize: 13.5 }}>读取分格…</div> : null}
          {board && board.scenes.length === 0 && board.taskStatus !== 'running' ? (
            <div style={{ color: 'var(--ink-3)', fontSize: 13.5 }}>尚未开始制作。</div>
          ) : null}
        </div>
      </div>
      <span className="lnk" style={{ display: 'none' }} onClick={() => navigate(`/projects/${id}`)} />
    </div>
  );
}
