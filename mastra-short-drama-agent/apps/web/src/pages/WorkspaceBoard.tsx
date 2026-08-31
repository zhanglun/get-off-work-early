import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { PipelineStage } from '@short-drama/shared';
import { api } from '../api';

export interface BoardData {
  episode: { id: string; episodeNo: number; status: string; shotTarget: number | null };
  stages: { stage: string; stages: Partial<Record<PipelineStage, string>>; shotsDone: number; shotsTotal: number; mock: boolean };
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

function Slate({ n, gold }: { n: string; gold?: boolean }): JSX.Element {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 26, flex: 'none', marginRight: 2 }}>
      <svg viewBox="0 0 34 26" style={{ position: 'absolute', inset: 0 }}>
        <ellipse cx="17" cy="13" rx="15" ry="12" fill="none" stroke={gold ? 'var(--gold)' : 'var(--ink)'} strokeWidth={gold ? 1.8 : 1.1} strokeDasharray={gold ? 'none' : 'none'} />
      </svg>
      <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 12, color: gold ? 'var(--gold-deep)' : 'inherit' }}>{n}</span>
    </span>
  );
}

export function WorkspaceBoard({ projectId, activeEpisodeId, invalidateKey }: { projectId: string; activeEpisodeId: string | null; invalidateKey: number }): JSX.Element {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { data: board } = useQuery({
    queryKey: ['board', activeEpisodeId, invalidateKey],
    queryFn: () => api<BoardData>(`/episodes/${activeEpisodeId}/board`),
    enabled: Boolean(activeEpisodeId),
  });
  void projectId;

  if (!activeEpisodeId) {
    return (
      <div style={{ width: '44%', borderLeft: '1.5px solid var(--ink)', padding: '18px 26px', color: 'var(--ink-3)', fontFamily: 'var(--kai)' }}>
        导入剧本后，制作过程与图版将在这里实时生长。
      </div>
    );
  }

  const currentStage = (board?.stages.stage ?? 'parse') as PipelineStage;
  const done = board?.taskStatus === 'completed' || board?.taskStatus === 'partial_failed';

  return (
    <div style={{ width: '44%', display: 'flex', minWidth: 0, borderLeft: '1.5px solid var(--ink)' }}>
      {/* 编号边栏：阶段账 + 场次索引 */}
      <div style={{ width: 118, flex: 'none', background: 'var(--paper-2)', position: 'relative', padding: '14px 0', overflowY: 'auto' }}>
        <div style={{ position: 'absolute', right: 14, top: 0, bottom: 0, width: 1, background: 'rgba(192,57,43,.25)' }} />
        {STAGE_ORDER.map((stage, index) => {
          const state = board?.stages.stages[stage];
          const isCurrent = !done && currentStage === stage;
          return (
            <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 22px 5px 6px', fontSize: 11.5, color: state === 'completed' ? 'var(--ink-2)' : isCurrent ? 'var(--gold-deep)' : 'var(--ink-3)', fontFamily: 'var(--mono)' }}>
              <Slate n={String(index + 1)} gold={isCurrent} />
              <span>
                {STAGE_TEXT[stage]}
                {stage === 'shots' && board?.stages.shotsTotal ? ` ${board.stages.shotsDone}/${board.stages.shotsTotal}` : ''}
              </span>
              <span style={{ marginLeft: 'auto' }}>{state === 'completed' ? '✓' : isCurrent ? '·' : ''}</span>
            </div>
          );
        })}
        <div style={{ borderTop: '1px solid var(--rule)', margin: '8px 14px 8px 0' }} />
        {(board?.scenes ?? []).map((scene) => (
          <div key={scene.sceneNo} style={{ padding: '4px 22px 4px 6px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-2)', textAlign: 'right' }}>
            场{scene.sceneNo}
            <b style={{ display: 'block', fontSize: 12.5, color: 'var(--ink)' }}>{scene.shots.length} 镜</b>
          </div>
        ))}
        {(board?.issues.length ?? 0) > 0 ? (
          <div style={{ padding: '4px 22px 4px 6px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--red)', textAlign: 'right' }}>
            穿帮<b style={{ display: 'block', fontSize: 12.5 }}>{board!.issues.filter((issue) => issue.status === 'open').length}</b>
          </div>
        ) : null}
      </div>

      {/* 图版区 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '12px 20px 9px', borderBottom: '1.5px solid var(--ink)' }}>
          <b style={{ fontSize: 14 }}>图版区</b>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--ink-2)' }}>
            {board ? `第 ${board.episode.episodeNo} 集 · ${board.scenes.reduce((sum, scene) => sum + scene.shots.length, 0)} 镜` : '…'}
          </span>
          <div style={{ flex: 1 }} />
          {board?.stages.mock ? <span className="stamp">MOCK</span> : null}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px 40px' }}>
          {/* 项目级资产 */}
          {(board?.projectAssets.length ?? 0) > 0 ? (
            <>
              <div style={{ fontSize: 12, color: 'var(--ink-2)', letterSpacing: 1, borderBottom: '1px solid var(--ink)', paddingBottom: 5, marginBottom: 9 }}>项目级资产 · {board!.projectAssets.length}</div>
              {board!.projectAssets.map((asset) => (
                <div key={asset.id} style={{ background: 'var(--card)', border: '1px solid var(--rule)', borderRadius: 2, padding: '7px 12px', fontSize: 12.5, marginBottom: 6, display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <Slate n={asset.name.slice(0, 1)} />
                  <b>{asset.name}</b>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--blue)', border: '1px solid var(--blue)', borderRadius: 2, padding: '0 4px' }}>{asset.kind === 'character' ? '项目级' : asset.kind}</span>
                  <span style={{ color: 'var(--ink-2)', fontSize: 12 }}>{String((asset.data as { canonicalDescription?: string; clothing?: string }).canonicalDescription ?? '').slice(0, 36)}</span>
                </div>
              ))}
            </>
          ) : null}

          {/* 场次与分镜图版 */}
          {(board?.scenes ?? []).map((scene) => (
            <div key={scene.sceneNo}>
              <div style={{ fontSize: 12, color: 'var(--ink-2)', letterSpacing: 1, borderBottom: '1px solid var(--ink)', paddingBottom: 5, margin: '14px 0 9px', display: 'flex', gap: 8 }}>
                <span>场{scene.sceneNo} · {scene.heading.slice(0, 18)}</span>
                <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)' }}>{scene.shots.length} 镜</span>
              </div>
              {scene.shots.map((shot) => {
                const draft = shot.draft as Partial<{ shotSize: string; cameraMove: string; imagePrompt: string; videoPrompt: string; composition: string; lighting: string; emotion: string }>;
                return (
                  <div key={shot.sequence} style={{ background: 'var(--card)', border: '1.5px solid var(--ink)', borderRadius: 2, padding: '10px 14px', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                      <Slate n={String(shot.sequence).padStart(2, '0')} />
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-2)' }}>{draft.shotSize ?? '—'} · {draft.cameraMove ?? '—'}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-3)', border: '1px solid var(--rule)', borderRadius: 2, padding: '0 4px', marginLeft: 'auto' }}>模拟帧</span>
                      {shot.status !== 'done' ? <span className="mark warn">{shot.status === 'failed' ? '失败' : '待审'}</span> : null}
                    </div>
                    {draft.imagePrompt ? (
                      <>
                        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>{draft.composition ?? ''}</div>
                        <div style={{ margin: '6px 0 0 18px', fontSize: 11.5, color: 'var(--ink-2)' }}>
                          <b style={{ display: 'block', fontFamily: 'var(--mono)', fontWeight: 400, fontSize: 10, letterSpacing: 1, color: 'var(--ink-3)' }}>IMAGE PROMPT</b>
                          {draft.imagePrompt}
                        </div>
                        <div style={{ margin: '4px 0 0 18px', fontSize: 11.5, color: 'var(--ink-2)' }}>
                          <b style={{ display: 'block', fontFamily: 'var(--mono)', fontWeight: 400, fontSize: 10, letterSpacing: 1, color: 'var(--ink-3)' }}>VIDEO PROMPT</b>
                          {draft.videoPrompt}
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--red)' }}>生成失败——可单项重试</div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {/* 穿帮记录 */}
          {(board?.issues.length ?? 0) > 0 ? (
            <>
              <div style={{ fontSize: 12, color: 'var(--ink-2)', letterSpacing: 1, borderBottom: '1px solid var(--ink)', paddingBottom: 5, margin: '16px 0 9px' }}>穿帮记录 · {board!.issues.length}</div>
              {board!.issues.map((issue) => (
                <div key={issue.id} style={{
                  background: issue.kind === 'fact' || issue.kind === 'failure' ? 'var(--red-wash)' : 'var(--gold-wash)',
                  border: `1px solid ${issue.kind === 'fact' || issue.kind === 'failure' ? '#e5c4bd' : '#e3d4a8'}`,
                  borderRadius: 2, padding: '8px 12px', fontSize: 12.5, marginBottom: 7,
                  color: issue.kind === 'fact' || issue.kind === 'failure' ? 'var(--red)' : 'var(--gold-deep)',
                }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, border: '1px solid currentColor', borderRadius: 2, padding: '0 5px', marginRight: 7 }}>
                    {issue.kind === 'wording' ? '措辞' : issue.kind === 'fact' ? '事实' : '失败'}
                  </span>
                  {issue.issue}
                </div>
              ))}
            </>
          ) : null}

          {!board ? <div style={{ color: 'var(--ink-3)', fontFamily: 'var(--kai)' }}>读取图版…</div> : null}
          {board && board.scenes.length === 0 && board.taskStatus !== 'running' ? (
            <div style={{ color: 'var(--ink-3)', fontFamily: 'var(--kai)' }}>尚未开始制作。</div>
          ) : null}
        </div>
      </div>
      <span className="lnk" style={{ display: 'none' }} onClick={() => navigate(`/projects/${id}`)} />
    </div>
  );
}
