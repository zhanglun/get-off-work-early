import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { PipelineStage } from '@short-drama/shared';
import { PIPELINE_STAGES, STAGE_LABELS } from '@short-drama/shared';
import { api } from '../api';
import { Circ } from '../Circ';

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

/** 全局镜号：场次按顺序累计（视觉稿 margin 的「场 2 · 05–12」区间）。 */
function sceneRanges(scenes: BoardData['scenes']): { sceneNo: number; from: number; to: number }[] {
  let offset = 1;
  return scenes.map((scene) => {
    const from = offset;
    const to = offset + scene.shots.length - 1;
    offset += scene.shots.length;
    return { sceneNo: scene.sceneNo, from, to };
  });
}

export function WorkspaceBoard({ projectId, activeEpisodeId, invalidateKey, onExport }: {
  projectId: string;
  activeEpisodeId: string | null;
  invalidateKey: number;
  onExport: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['board', activeEpisodeId] });
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

  const { data: board } = useQuery({
    queryKey: ['board', activeEpisodeId, invalidateKey],
    queryFn: () => api<BoardData>(`/episodes/${activeEpisodeId}/board`),
    enabled: Boolean(activeEpisodeId),
  });
  void projectId;

  if (!activeEpisodeId) {
    return (
      <div className="plates">
        <div style={{ flex: 1, padding: '18px 26px', color: 'var(--ink-3)', fontFamily: 'var(--kai)' }}>
          导入剧本后，制作过程与图版将在这里实时生长。
        </div>
      </div>
    );
  }

  const currentStage = (board?.stages.stage ?? 'parse') as PipelineStage;
  const done = board?.taskStatus === 'completed' || board?.taskStatus === 'partial_failed';
  const ranges = sceneRanges(board?.scenes ?? []);
  const totalShots = (board?.scenes ?? []).reduce((sum, scene) => sum + scene.shots.length, 0);
  const openIssues = (board?.issues ?? []).filter((issue) => issue.status === 'open').length;
  const episodeDone = board?.episode.status === 'completed' || board?.episode.status === 'partial_failed';

  const stageValue = (stage: PipelineStage): string => {
    const state = board?.stages.stages[stage];
    if (stage === 'shots') {
      if (state === 'completed' || done) return String(board?.stages.shotsTotal || 0);
      if (state === 'running') return `${board?.stages.shotsDone}/${board?.stages.shotsTotal}`;
      return '—';
    }
    if (stage === 'package') return done ? '就绪' : '—';
    if (state === 'completed') return '✓';
    if (state === 'running') return '·';
    return '—';
  };

  return (
    <div className="plates" style={{ display: 'flex', flexDirection: 'row', minWidth: 0 }}>
      {/* 编号边栏：场次镜号区间 + 阶段账（视觉稿 margin） */}
      <div className="margin">
        {(board?.scenes ?? []).map((scene) => {
          const range = ranges.find((item) => item.sceneNo === scene.sceneNo);
          const rangeText = range && range.to >= range.from ? `${String(range.from).padStart(2, '0')}–${String(range.to).padStart(2, '0')}` : '—';
          return (
            <div key={scene.sceneNo} className="no">
              场 {scene.sceneNo}<b>{rangeText}</b>
            </div>
          );
        })}
        {(board?.scenes.length ?? 0) > 0 ? <div className="grp" /> : null}
        {PIPELINE_STAGES.map((stage) => (
          <div key={stage} className={!done && board?.stages.stage === stage ? 'no on' : 'no'}>
            {STAGE_LABELS[stage]}<b>{stageValue(stage)}</b>
          </div>
        ))}
        <div className="no">穿帮<b>{board ? openIssues : '—'}</b></div>
      </div>

      {/* 图版区 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div className="plate-head">
          <b>{board ? `第 ${board.episode.episodeNo} 集 · 图版` : '图版区'}</b>
          <span className="cnt">{board ? `${totalShots} 镜` : '…'}</span>
        </div>
        <div className="plates-scroll">
          {!board ? <div style={{ color: 'var(--ink-3)', fontFamily: 'var(--kai)' }}>读取图版…</div> : null}
          {board && board.scenes.length === 0 && board.taskStatus !== 'running' ? (
            <div style={{ color: 'var(--ink-3)', fontFamily: 'var(--kai)' }}>尚未开始制作。</div>
          ) : null}

          {(board?.scenes ?? []).map((scene, sceneIndex) => {
            const range = ranges[sceneIndex]!;
            return (
              <div key={scene.sceneNo}>
                <div className="sec">
                  <span>场{scene.sceneNo} · {scene.heading.slice(0, 18)}</span>
                  <span style={{ fontFamily: 'var(--mono)' }}>{scene.shots.length} 镜</span>
                </div>
                {scene.shots.map((shot) => {
                  const shotNo = range.from + shot.sequence - 1;
                  const draft = shot.draft as Partial<{ shotSize: string; cameraMove: string; imagePrompt: string; videoPrompt: string; composition: string }>;
                  return (
                    <div key={shot.sequence} className="frame">
                      <div className="top">
                        <Circ n={String(shotNo).padStart(2, '0')} />
                        <div className="specs">
                          {draft.shotSize ? <span>{draft.shotSize}</span> : null}
                          {draft.cameraMove ? <span>{draft.cameraMove}</span> : null}
                        </div>
                        <div className="acts">
                          <span className="mframe">预览占位帧</span>
                          {shot.promptVersions > 0 ? <span className="ver">v{shot.promptVersions}</span> : null}
                          {shot.status !== 'done' ? <span className="mark warn">{shot.status === 'failed' ? '失败' : '待审'}</span> : null}
                        </div>
                      </div>
                      {draft.imagePrompt ? (
                        <>
                          <div className="desc">{draft.composition ?? ''}</div>
                          <div className="cont"><b>IMAGE PROMPT</b>{draft.imagePrompt}</div>
                          <div className="cont"><b>VIDEO PROMPT</b>{draft.videoPrompt}</div>
                        </>
                      ) : (
                        <div className="desc" style={{ color: 'var(--red)' }}>生成失败——可从下方穿帮记录单项重试。</div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* 项目级资产 */}
          {(board?.projectAssets.length ?? 0) > 0 ? (
            <>
              <div className="sec"><span>项目级资产</span><span style={{ fontFamily: 'var(--mono)' }}>PROJECT</span></div>
              {board!.projectAssets.map((asset) => (
                <div key={asset.id} className="asset-log">
                  <b>{asset.name}</b>
                  <span className="lv">{asset.kind === 'character' ? '项目级' : asset.kind}</span>
                  <span className="d">{String((asset.data as { canonicalDescription?: string }).canonicalDescription ?? '').slice(0, 40)}</span>
                </div>
              ))}
            </>
          ) : null}

          {/* 穿帮记录 */}
          {(board?.issues.length ?? 0) > 0 ? (
            <>
              <div className="sec"><span>穿帮记录</span><span style={{ fontFamily: 'var(--mono)' }}>{openIssues} 待处理</span></div>
              {board!.issues.map((issue) => {
                const [sn, sq] = issue.targetId.split(':').map(Number);
                const open = issue.status === 'open';
                const kindLabel = issue.kind === 'wording' ? '措辞' : issue.kind === 'fact' ? '事实' : '失败';
                return (
                  <div key={issue.id} className={issue.kind === 'wording' ? 'issue word' : 'issue'} style={{ opacity: open ? 1 : 0.62 }}>
                    <div className="ih">
                      <span className="tag">{kindLabel}</span>
                      <span>{issue.issue}</span>
                      <span className="ia">
                        {!open ? (
                          <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5 }}>
                            {issue.status === 'ignored' ? '已忽略' : issue.status === 'auto_fixed' ? '已修订' : '已解决'}
                          </span>
                        ) : (
                          <>
                            {issue.kind === 'failure' ? <button className="btn" onClick={() => retryShot.mutate({ sceneNo: sn!, sequence: sq! })}>重试镜 {sn}-{sq}</button> : null}
                            {issue.kind === 'wording' ? <button className="btn primary" onClick={() => autoFix.mutate(issue.id)}>自动修订</button> : null}
                            {issue.kind === 'fact' ? <button className="btn" disabled>需人工</button> : null}
                            {issue.kind !== 'failure' ? <button className="btn" onClick={() => ignoreIssue.mutate(issue.id)}>忽略</button> : null}
                          </>
                        )}
                      </span>
                    </div>
                    {issue.suggestion ? <div className="why">{issue.suggestion}</div> : null}
                  </div>
                );
              })}
            </>
          ) : null}

          {/* 生产包 */}
          {board && episodeDone ? (
            <>
              <div className="sec"><span>生产包</span><span style={{ fontFamily: 'var(--mono)' }}>整项目 ZIP</span></div>
              <div className="pkg">
                <div className="files">
                  <b>{board.episode.episodeNo} 集</b>已就绪<br />
                  ├ project-assets.md<br />
                  └ episode-{String(board.episode.episodeNo).padStart(2, '0')}/<span className="d">5 文件</span>
                </div>
                <div className="exp">
                  <button className="btn primary" onClick={onExport}>导出项目 ZIP</button>
                  <span>被忽略的穿帮将记录在 manifest.json</span>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
