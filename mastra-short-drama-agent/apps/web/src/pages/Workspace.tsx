import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Snapshot, MessageDto } from '@short-drama/shared';
import { PIPELINE_STAGES, STAGE_LABELS, type PipelineStage } from '@short-drama/shared';
import { api } from '../api';
import { subscribeEvents } from '../sse';
import { WorkspaceBoard } from './WorkspaceBoard';
import { Circ } from '../Circ';

function ImpactCard({ message }: { message: MessageDto }): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const meta = (message.meta ?? {}) as unknown as {
    assetName: string; before: string; after: string;
    impact: { episodeNo: number; shots: number; prompts: number }[];
    mode?: string;
  };
  const [busy, setBusy] = useState(false);
  const confirm = async (mode: 'regenerate' | 'setting_only' | 'cancel'): Promise<void> => {
    if (mode === 'cancel') {
      setBusy(true);
      setTimeout(() => setBusy(false), 300);
      return;
    }
    setBusy(true);
    try {
      await api(`/projects/${id}/asset-changes/confirm`, {
        method: 'POST',
        body: JSON.stringify({ messageId: message.id, mode }),
      });
      void queryClient.invalidateQueries({ queryKey: ['snapshot', id] });
    } finally {
      setBusy(false);
    }
  };
  const decided = meta.mode && meta.mode !== 'pending';
  return (
    <div className="impact">
      <div className="hd">勘误范围{decided ? '' : ' · 待确认'}<span className="st">跨集</span></div>
      <div className="bd">
        <div style={{ fontSize: 14, padding: '8px 10px', background: 'var(--paper)', borderRadius: 2, marginBottom: 10 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--ink-2)', display: 'block', marginBottom: 3 }}>
            项目级设定 · {meta.assetName} · 服装
          </span>
          <del style={{ color: 'var(--red)', background: 'var(--red-wash)', borderRadius: 2, padding: '0 3px', textDecorationThickness: 1.5 }}>{String(meta.before).slice(0, 20)}</del>
          {' → '}
          <ins style={{ color: 'var(--blue-deep)', background: 'var(--blue-wash)', borderRadius: 2, padding: '0 3px', fontWeight: 600, textDecoration: 'none' }}>{String(meta.after)}</ins>
        </div>
        <div className="scope">
          {(meta.impact ?? []).map((row) => (
            <div key={row.episodeNo}>
              <b>第 {row.episodeNo} 集</b><span className="n">{row.shots} 镜</span> · {row.prompts} Prompt
            </div>
          ))}
        </div>
        {!decided ? (
          <div className="acts">
            <button className="btn primary" disabled={busy} onClick={() => void confirm('regenerate')}>确认全部重生成</button>
            <button className="btn" disabled={busy} onClick={() => void confirm('setting_only')}>仅修改设定</button>
            <button className="btn" disabled={busy} onClick={() => void confirm('cancel')}>取消</button>
          </div>
        ) : (
          <div style={{ marginTop: 10, fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--ink-3)' }}>
            {meta.mode === 'regenerate' ? '✓ 已确认并触发重生成' : meta.mode === 'setting_only' ? '✓ 仅更新设定' : '已取消'}
          </div>
        )}
      </div>
    </div>
  );
}

interface SplitSegment {
  episodeNo: number;
  title: string | null;
  scenes: number;
  summary?: string | null;
}

/** 拆分确认卡（视觉稿 ⑤ impact 卡语言）。 */
function SplitPreviewCard({ message, pending, onDecide }: { message: MessageDto; pending: boolean; onDecide: (text: string) => void }): JSX.Element {
  const meta = (message.meta ?? {}) as {
    source?: string;
    reviewIssues?: { episodeNo: number | null; issue: string; suggestion: string }[];
    segments?: SplitSegment[];
  };
  const segments = meta.segments ?? [];
  const issues = meta.reviewIssues ?? [];
  return (
    <div className="impact">
      <div className="hd">拆分确认 · 共 {segments.length} 集<span className="st">{meta.source === 'rules' ? '规则拆分' : '模型拆分'}</span></div>
      <div className="bd">
        {segments.map((segment) => (
          <div key={segment.episodeNo} className="ep-line">
            <span className="no">第 {segment.episodeNo} 集</span>
            {segment.title ? <b>{segment.title}</b> : null}
            <span className="cnt">{segment.scenes} 场</span>
            {segment.summary ? <span className="sum">{segment.summary}</span> : null}
          </div>
        ))}
        {issues.length > 0 ? (
          <div className="issue" style={{ marginTop: 10 }}>
            {issues.map((issue, index) => (
              <div key={index}>⚠ {issue.episodeNo ? `第 ${issue.episodeNo} 集：` : ''}{issue.issue}（建议：{issue.suggestion}）</div>
            ))}
          </div>
        ) : null}
        {pending ? (
          <div className="acts">
            <button className="btn primary" onClick={() => onDecide('确认')}>确认开始制作</button>
            <button className="btn" onClick={() => onDecide('取消')}>取消</button>
          </div>
        ) : (
          <div style={{ marginTop: 10, fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--ink-3)' }}>✓ 已处理</div>
        )}
      </div>
    </div>
  );
}

interface TaskProgress {
  stage: PipelineStage | 'done';
  stages: Partial<Record<PipelineStage, string>>;
  shotsDone: number;
  shotsTotal: number;
}

/** 制作进度卡（视觉稿 ③ 的 prog 卡：圈码当前阶段 + 进度条 + 取消）。 */
function ProgressCard({ taskId, progress }: { taskId: string; progress: TaskProgress }): JSX.Element {
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const [cancelling, setCancelling] = useState(false);
  const stageIndex = PIPELINE_STAGES.indexOf(progress.stage as PipelineStage);
  const isShots = progress.stage === 'shots';
  const percent = isShots && progress.shotsTotal > 0
    ? Math.round((progress.shotsDone / progress.shotsTotal) * 100)
    : Math.round(((stageIndex + 1) / PIPELINE_STAGES.length) * 100);
  const label = isShots && progress.shotsTotal > 0
    ? `分镜生成 ${progress.shotsDone} / ${progress.shotsTotal}`
    : `${STAGE_LABELS[progress.stage as PipelineStage] ?? '制作中'} · 阶段 ${stageIndex + 1}/${PIPELINE_STAGES.length}`;

  const cancel = async (): Promise<void> => {
    setCancelling(true);
    try {
      await api(`/tasks/${taskId}/cancel`, { method: 'POST' });
      void queryClient.invalidateQueries({ queryKey: ['snapshot', id] });
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="prog">
      <div className="row">
        <Circ n={String(stageIndex + 1)} cur />
        <b>{label}</b>
        <span className="t">{percent}%</span>
      </div>
      <div className="bar"><i style={{ width: `${percent}%` }} /></div>
      <div className="sub">
        <span>完成后自动连续检查 · 同项目一次制作一集</span>
        <span className="lnk" style={cancelling ? { color: 'var(--ink-3)', pointerEvents: 'none' } : undefined} onClick={() => void cancel()}>
          取消制作
        </span>
      </div>
    </div>
  );
}

function MessageBubble({ message, isLatest, onDecide }: { message: MessageDto; isLatest: boolean; onDecide: (text: string) => void }): JSX.Element {
  const meta = (message.meta ?? {}) as { kind?: string; splitSource?: string; content?: string };
  if (message.role === 'user') {
    const isScript = message.kind === 'script';
    return (
      <div className="u-msg">
        <div className="who">登记{isScript ? ' · 剧本' : ' · 回复'}</div>
        <div className="txt">
          {isScript ? (
            <details>
              <summary style={{ cursor: 'pointer', color: 'var(--ink-2)' }}>{message.content} · 展开 ▸</summary>
              <pre>{meta.content ?? ''}</pre>
            </details>
          ) : (
            message.content
          )}
        </div>
      </div>
    );
  }
  if (message.kind === 'impact_confirm') {
    return <ImpactCard message={message} />;
  }
  if (message.kind === 'question' && meta.kind === 'split_confirm') {
    return <SplitPreviewCard message={message} pending={isLatest} onDecide={onDecide} />;
  }
  // 拆分结果 note：明细由确认卡承载，这里只留标题行避免重复
  if (message.kind === 'note' && meta.splitSource) {
    return (
      <div className="a-note">
        {message.content.split('\n')[0]}
        <div className="kai" style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>拆分明细见下方确认卡。</div>
      </div>
    );
  }
  const isQuestion = message.kind === 'question';
  const hint =
    meta.kind === 'episode_no' ? '回复数字，例如「2」'
    : meta.kind === 'split_confirm' ? '点上方确认卡按钮，或回复「确认」/「取消」'
    : null;
  return (
    <div className="a-note" style={isQuestion ? { borderBottom: 'none' } : undefined}>
      <span className={isQuestion ? 'kai' : undefined}>{message.content}</span>
      {isQuestion && hint ? <span style={{ color: 'var(--blue)', fontWeight: 600 }}>（{hint}）</span> : null}
    </div>
  );
}

export function Workspace(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [tick, setTick] = useState(0);
  const [error, setError] = useState('');
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);
  const followRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: snapshot } = useQuery({
    queryKey: ['snapshot', id],
    queryFn: () => api<Snapshot>(`/projects/${id}/snapshot`),
    enabled: Boolean(id),
  });

  // SSE：事件到达 → 刷新快照（对话与工件实时生长）
  useEffect(() => {
    if (!snapshot || !id) return;
    const unsubscribe = subscribeEvents(id, snapshot.lastSeq, () => {
      void queryClient.invalidateQueries({ queryKey: ['snapshot', id] });
      setTick((value) => value + 1);
    });
    return unsubscribe;
  }, [id, snapshot?.lastSeq, queryClient, snapshot]);

  const activeTask = snapshot?.activeTask ?? null;
  useEffect(() => {
    if (activeTask?.episodeId) followRef.current = activeTask.episodeId;
  }, [activeTask?.episodeId]);

  // 当前查看的集：用户点选 > 正在制作的集 > 最近跟随的集 > 最后一集
  const activeEpisodeId =
    selectedEpisodeId
    ?? activeTask?.episodeId
    ?? followRef.current
    ?? snapshot?.episodes.at(-1)?.id
    ?? null;
  const activeEpisode = snapshot?.episodes.find((ep) => ep.id === activeEpisodeId) ?? null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [snapshot?.messages.length]);

  const send = useMutation({
    mutationFn: (payload: { content: string; meta?: Record<string, unknown> }) =>
      api<{ messages: MessageDto[] }>(`/projects/${id}/messages`, { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => {
      setDraft('');
      setError('');
      void queryClient.invalidateQueries({ queryKey: ['snapshot', id] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : '发送失败'),
  });

  const exportZip = async (): Promise<void> => {
    const res = await fetch(`/api/exports/${id}`, { method: 'POST', credentials: 'same-origin' });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${snapshot?.project.name ?? '短剧'}-生产包.zip`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const submit = (): void => {
    const content = draft.trim();
    if (!content) return;
    send.mutate({ content });
  };

  const onFile = (file: File): void => {
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result ?? '');
      if (content.trim()) send.mutate({ content, meta: { fileName: file.name } });
    };
    reader.readAsText(file);
  };

  const pendingQuestion = snapshot?.messages.at(-1);
  const pendingKind = pendingQuestion?.kind === 'question'
    ? ((pendingQuestion.meta ?? {}) as { kind?: string }).kind
    : null;
  const composerHint = pendingKind === 'episode_no'
    ? '回复集数（数字），或直接粘贴新一集剧本'
    : pendingKind === 'split_confirm'
      ? '点上方确认卡按钮，或回复「确认」/「取消」'
      : '直接打字修改，或粘贴完整剧本（可一份包含多集）';

  const taskProgress = activeTask && activeTask.kind === 'production' && activeTask.status === 'running'
    ? (activeTask.progress as TaskProgress)
    : null;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="work-head">
        <span className="back" onClick={() => navigate('/projects')}>← 项目</span>
        <span className="pname">{snapshot?.project.name ?? '…'}</span>
        {(snapshot?.episodes.length ?? 0) > 0 ? (
          <select
            className="ep-select"
            value={activeEpisodeId ?? ''}
            onChange={(event) => setSelectedEpisodeId(event.target.value)}
          >
            {snapshot!.episodes.map((ep) => {
              const isRunning = activeTask?.episodeId === ep.id && activeTask.status === 'running';
              const state = isRunning ? '制作中'
                : ep.status === 'completed' ? '已完成'
                : ep.status === 'partial_failed' ? '部分完成'
                : ep.status === 'failed' ? '失败'
                : activeTask?.episodeId === ep.id ? '即将制作'
                : '已登记';
              return <option key={ep.id} value={ep.id}>第 {ep.episodeNo} 集 · {state}</option>;
            })}
          </select>
        ) : null}
        <span className="sp" />
        <button className={activeEpisode && (activeEpisode.status === 'completed' || activeEpisode.status === 'partial_failed') ? 'btn primary' : 'btn'} onClick={() => void exportZip()}>
          导出项目 ZIP
        </button>
      </div>
      <div className="work-body">
        <div className="convo">
          <div className="convo-scroll">
            {(snapshot?.messages ?? []).map((message, index, all) => (
              <MessageBubble
                key={message.id}
                message={message}
                isLatest={index === all.length - 1}
                onDecide={(text) => send.mutate({ content: text })}
              />
            ))}
            {taskProgress ? <ProgressCard taskId={activeTask!.id} progress={taskProgress} /> : null}
            {(snapshot?.messages.length ?? 0) === 0 ? (
              <div style={{ fontFamily: 'var(--kai)', color: 'var(--ink-2)', fontSize: 14 }}>
                把完整剧本贴进来吧（可一份包含多集）——我来拆分成集，确认后依次自动制作。
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
          <div className="composer">
            <div className="box">
              <div className="line">
                <textarea
                  rows={1}
                  placeholder={
                    pendingKind === 'episode_no' ? '回复集数（数字）…'
                    : pendingKind === 'split_confirm' ? '点上方确认卡按钮，或回复「确认」/「取消」…'
                    : '直接打字修改，或粘贴完整剧本（可一份包含多集）…'
                  }
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      submit();
                    }
                  }}
                />
                <button className="send" disabled={!draft.trim() || send.isPending} onClick={submit}>登记</button>
              </div>
            </div>
            <div className="hint">
              {composerHint} · <span className="lnk" onClick={() => fileRef.current?.click()}>上传 .md / .txt</span>
              <input
                ref={fileRef}
                type="file"
                accept=".md,.txt"
                style={{ display: 'none' }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onFile(file);
                  event.target.value = '';
                }}
              />
            </div>
            {error ? <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 6 }}><span className="stamp" style={{ fontSize: 10.5, marginRight: 8 }}>错误</span>{error}</div> : null}
          </div>
        </div>
        <WorkspaceBoard projectId={id ?? ''} activeEpisodeId={activeEpisodeId} invalidateKey={tick} onExport={() => void exportZip()} />
      </div>
    </div>
  );
}
