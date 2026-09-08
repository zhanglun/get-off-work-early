import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Snapshot, MessageDto } from '@short-drama/shared';
import { api } from '../api';
import { subscribeEvents } from '../sse';
import { WorkspaceBoard } from './WorkspaceBoard';

function CheckGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" style={{ flex: 'none' }}>
      <path d="M2 6.5 L5 9.5 L10 2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/* ── 勘误格：修改影响确认（划掉→替换 + 跨集清点）── */
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
    <div style={{ border: '2px solid var(--ink)', background: 'var(--panel)', margin: '16px 0', boxShadow: '4px 4px 0 var(--gutter)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '2px solid var(--ink)', fontWeight: 900, fontSize: 13.5, background: 'var(--yellow-wash)' }}>
        勘误范围 · 待确认
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-2)', fontWeight: 400 }}>跨集</span>
      </div>
      <div style={{ padding: '12px 14px' }}>
        <div style={{ border: '1px solid var(--rule)', padding: '8px 10px', marginBottom: 10, fontSize: 13.5, background: 'var(--page)' }}>
          <span style={{ fontSize: 11, color: 'var(--ink-2)', display: 'block', marginBottom: 3 }}>
            项目级设定 · {meta.assetName} · 服装
          </span>
          <del style={{ color: 'var(--red-deep)', background: 'var(--red-wash)', padding: '0 3px' }}>{String(meta.before).slice(0, 20)}</del>
          {' → '}
          <ins style={{ color: 'var(--cyan-deep)', background: 'var(--cyan-wash)', padding: '0 3px', fontWeight: 700, textDecoration: 'none' }}>{String(meta.after)}</ins>
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 2 }}>
          {(meta.impact ?? []).map((row) => (
            <div key={row.episodeNo}>
              <b style={{ fontWeight: 400, marginRight: 8 }}>第 {row.episodeNo} 集</b>
              <span style={{ color: 'var(--cyan-deep)' }}>{row.shots} 镜</span> · {row.prompts} Prompt
            </div>
          ))}
        </div>
        {!decided ? (
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn primary" disabled={busy} onClick={() => void confirm('regenerate')}>确认全部重生成</button>
            <button className="btn" disabled={busy} onClick={() => void confirm('setting_only')}>仅修改设定</button>
            <button className="btn" disabled={busy} onClick={() => void confirm('cancel')}>取消</button>
          </div>
        ) : (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <CheckGlyph />
            {meta.mode === 'regenerate' ? '已确认并触发重生成' : meta.mode === 'setting_only' ? '仅更新设定' : '已取消'}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 分集预告页：拆分确认卡（每集一小格，确认即逐格上墨）── */
interface SplitSegment {
  episodeNo: number;
  title: string | null;
  scenes: number;
  summary?: string | null;
}

function SplitPreviewCard({ message, pending, onDecide }: { message: MessageDto; pending: boolean; onDecide: (text: string) => void }): JSX.Element {
  const meta = (message.meta ?? {}) as {
    source?: string;
    reviewIssues?: { episodeNo: number | null; issue: string; suggestion: string }[];
    segments?: SplitSegment[];
  };
  const segments = meta.segments ?? [];
  const issues = meta.reviewIssues ?? [];
  return (
    <div style={{ border: '2px solid var(--ink)', background: 'var(--panel)', margin: '16px 0', boxShadow: '4px 4px 0 var(--gutter)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '2px solid var(--ink)', fontWeight: 900, fontSize: 13.5 }}>
        拆分确认 · 共 {segments.length} 集
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--cyan-deep)', fontWeight: 700 }}>
          {meta.source === 'rules' ? '规则拆分' : '模型拆分'}
        </span>
      </div>
      <div style={{ padding: '10px 14px' }}>
        {segments.map((segment, index) => (
          <div key={segment.episodeNo} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '6px 0', borderBottom: index < segments.length - 1 ? '1px dashed var(--rule)' : 'none', fontSize: 13, minWidth: 0 }}>
            <span style={{ flex: 'none', background: 'var(--ink)', color: '#fff', fontFamily: 'var(--mono)', fontSize: 11.5, fontWeight: 700, padding: '1px 7px' }}>
              第{segment.episodeNo}集
            </span>
            {segment.title ? <b>{segment.title}</b> : null}
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-2)', flex: 'none' }}>{segment.scenes} 场</span>
            {segment.summary ? (
              <span style={{ color: 'var(--ink-2)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{segment.summary}</span>
            ) : null}
          </div>
        ))}
        {issues.length > 0 ? (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--red-deep)', background: 'var(--red-wash)', border: '1px solid var(--red)', padding: '7px 10px', lineHeight: 1.7 }}>
            {issues.map((issue, index) => (
              <div key={index} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <svg viewBox="0 0 14 12" width="13" height="11" style={{ flex: 'none', transform: 'translateY(1px)' }} aria-hidden="true">
                  <path d="M7 1 L13 11 L1 11 Z" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  <line x1="7" y1="5" x2="7" y2="8" stroke="currentColor" strokeWidth="1.6" />
                  <circle cx="7" cy="9.7" r="0.9" fill="currentColor" />
                </svg>
                <span>{issue.episodeNo ? `第 ${issue.episodeNo} 集：` : ''}{issue.issue}（建议：{issue.suggestion}）</span>
              </div>
            ))}
          </div>
        ) : null}
        {pending ? (
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn primary" onClick={() => onDecide('确认')}>确认开始制作（逐格上墨）</button>
            <button className="btn" onClick={() => onDecide('取消')}>取消</button>
          </div>
        ) : (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 5 }}><CheckGlyph /> 已处理</div>
        )}
      </div>
    </div>
  );
}

/* ── 对话流：用户=对白气泡（右），助手=旁白框（左），剧本=登记格 ── */
function MessageBubble({ message, isLatest, onDecide }: { message: MessageDto; isLatest: boolean; onDecide: (text: string) => void }): JSX.Element {
  const meta = (message.meta ?? {}) as { kind?: string; splitSource?: string; content?: string };

  if (message.role === 'user') {
    const isScript = message.kind === 'script';
    if (isScript) {
      return (
        <div style={{ margin: '14px 0 18px', border: '2px solid var(--ink)', background: 'var(--panel)', boxShadow: '4px 4px 0 var(--gutter)' }}>
          <div className="halftone" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 12px', borderBottom: '2px solid var(--ink)', fontSize: 12, color: 'var(--cyan-deep)', fontWeight: 700 }}>
            登记剧本
            <span style={{ marginLeft: 'auto', fontWeight: 400, color: 'var(--ink-2)' }}>{message.content}</span>
          </div>
          <details>
            <summary style={{ cursor: 'pointer', padding: '7px 12px', fontSize: 12.5, color: 'var(--ink-2)', display: 'flex', alignItems: 'center', gap: 6, listStyle: 'none' }}>
              <svg viewBox="0 0 8 10" width="7" height="9" aria-hidden="true"><path d="M1.5 1 L6.5 5 L1.5 9 Z" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
              查看原文
            </summary>
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, color: 'var(--ink-2)', padding: '0 12px 10px', maxHeight: 240, overflowY: 'auto' }}>
              {meta.content ?? ''}
            </pre>
          </details>
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '12px 0' }}>
        <div style={{
          position: 'relative', maxWidth: '78%', border: '2px solid var(--ink)', background: 'var(--panel)',
          padding: '8px 13px', fontSize: 14, boxShadow: '3px 3px 0 var(--gutter)',
        }}>
          <span style={{ position: 'absolute', right: -7, top: 12, width: 12, height: 12, background: 'var(--panel)', borderRight: '2px solid var(--ink)', borderTop: '2px solid var(--ink)', transform: 'rotate(45deg)' }} />
          {message.content}
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
  /* 拆分结果 note：明细由确认卡承载，这里只留标题行避免重复 */
  if (message.kind === 'note' && meta.splitSource) {
    return (
      <div style={{ margin: '14px 0' }}>
        <div style={{ border: '2px solid var(--ink)', background: 'var(--panel)', padding: '10px 13px 8px', fontSize: 14, position: 'relative' }}>
          <span style={{ position: 'absolute', top: -10, left: 10, background: 'var(--cyan)', color: '#fff', fontSize: 10.5, fontWeight: 700, letterSpacing: 2, padding: '0 7px' }}>旁白</span>
          {message.content.split('\n')[0]}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 3, paddingLeft: 2 }}>拆分明细见下方确认卡。</div>
      </div>
    );
  }

  const isQuestion = message.kind === 'question';
  const hint =
    meta.kind === 'episode_no' ? '回复数字，例如「2」'
    : meta.kind === 'shot_count' ? '回复数字；直接回车发送即默认 30'
    : meta.kind === 'split_confirm' ? '回复「确认」或「取消」'
    : null;
  /* 助手 = 旁白框（左对齐矩形，问题框加重） */
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', margin: isQuestion ? '14px 0' : '12px 0' }}>
      <div style={{
        position: 'relative', maxWidth: '85%', background: isQuestion ? 'var(--yellow-wash)' : 'var(--panel)',
        border: '2px solid var(--ink)', padding: '8px 13px', fontSize: isQuestion ? 14.5 : 13.5,
        fontWeight: isQuestion ? 700 : 400, color: isQuestion ? 'var(--ink)' : 'var(--ink-2)',
        boxShadow: isQuestion ? '3px 3px 0 var(--yellow)' : '3px 3px 0 var(--gutter)',
      }}>
        <span style={{ position: 'absolute', left: -7, top: 12, width: 12, height: 12, background: 'inherit', borderLeft: '2px solid var(--ink)', borderBottom: '2px solid var(--ink)', transform: 'rotate(45deg)' }} />
        {message.content}
        {isQuestion ? <span style={{ color: 'var(--cyan-deep)', marginLeft: 8, fontWeight: 400 }}>（{hint}）</span> : null}
      </div>
    </div>
  );
}

/* ── 连载进度条：每集一格，状态即上墨 ── */
function episodeCellState(ep: { id: string; status: string }, activeTask: Snapshot['activeTask']): { label: string; cls: string; style: CSSProperties } {
  if (activeTask && activeTask.episodeId === ep.id) {
    if (activeTask.status === 'running') return { label: '制作中', cls: 'halftone speedlines', style: { color: 'var(--cyan-deep)' } };
    if (activeTask.status === 'queued') return { label: '即将制作', cls: '', style: { background: 'var(--yellow-wash)', color: 'var(--ink)' } };
  }
  if (ep.status === 'completed') return { label: '完成', cls: '', style: { background: 'var(--ink)', color: '#fff' } };
  if (ep.status === 'partial_failed') return { label: '部分完成', cls: '', style: { background: 'var(--red-wash)', color: 'var(--red-deep)', borderColor: 'var(--red)' } };
  if (ep.status === 'failed') return { label: '失败', cls: '', style: { background: 'var(--red-wash)', color: 'var(--red-deep)', borderColor: 'var(--red)', boxShadow: '2px 0 0 var(--cyan) inset' } };
  return { label: '已登记', cls: '', style: { color: 'var(--ink-2)' } };
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
  const questionHint =
    pendingKind === 'episode_no'
      ? '回复集数（数字）…'
      : pendingKind === 'split_confirm'
        ? '点上方确认卡按钮，或回复「确认」/「取消」…'
        : pendingKind === 'shot_count'
          ? '回复镜头数（建议 20–40，默认 30）…'
          : '粘贴完整剧本（可一份包含多集），或拖入 .md / .txt 文件…';

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* 顶栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, borderBottom: '3px solid var(--ink)', padding: '10px 26px', background: 'var(--page)' }}>
        <span className="lnk" onClick={() => navigate('/projects')}>← 目录</span>
        <span className="mast ws-top-mast" style={{ fontSize: 14 }}>短剧分镜制作助手</span>
        <span className="ws-top-vol" style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--cyan-deep)', fontWeight: 700 }}>VOL.1</span>
        <span className="ws-top-sep" style={{ color: 'var(--rule)' }}>/</span>
        <span style={{ fontSize: 17, fontWeight: 900, letterSpacing: 0.5 }}>{snapshot?.project.name ?? '…'}</span>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={() => void exportZip()}>导出合订本 ZIP</button>
      </div>
      {/* 连载进度条：每集一格，状态即上墨 */}
      {(snapshot?.episodes.length ?? 0) > 0 ? (
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 6, padding: '8px 26px', borderBottom: '2px solid var(--ink)', background: 'var(--gutter)', overflowX: 'auto' }}>
          <span style={{ flex: 'none', alignSelf: 'center', fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', marginRight: 4 }}>连载</span>
          {snapshot!.episodes.map((ep) => {
            const state = episodeCellState(ep, activeTask);
            const isActive = ep.id === activeEpisodeId;
            return (
              <button
                key={ep.id}
                type="button"
                onClick={() => setSelectedEpisodeId(ep.id)}
                className={`ink-step ${state.cls}`}
                style={{
                  flex: 'none', width: 84, border: '2px solid var(--ink)', borderRadius: 0,
                  padding: '3px 8px', cursor: 'pointer', textAlign: 'left',
                  ...(isActive ? { boxShadow: '3px 3px 0 var(--ink)', transform: 'translate(-1px, -1px)' } : {}),
                  ...state.style,
                }}
              >
                <span style={{ display: 'block', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13, lineHeight: 1.3 }}>第{ep.episodeNo}集</span>
                <span style={{ display: 'block', fontSize: 10, lineHeight: 1.4, fontFamily: 'var(--sans)' }}>{state.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="ws-root" style={{ flex: 1, display: 'flex', minHeight: 0, gap: 0 }}>
        {/* 对话列：气泡流 */}
        <div className="ws-main" style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '2px solid var(--ink)', minWidth: 0, background: 'var(--page)' }}>
          <div style={{ flex: 1, padding: '20px 26px', overflowY: 'auto' }}>
            {(snapshot?.messages ?? []).map((message, index, all) => (
              <MessageBubble
                key={message.id}
                message={message}
                isLatest={index === all.length - 1}
                onDecide={(text) => send.mutate({ content: text })}
              />
            ))}
            {(snapshot?.messages.length ?? 0) === 0 ? (
              <div style={{ border: '2px solid var(--ink)', background: 'var(--panel)', padding: '12px 14px', fontSize: 14, maxWidth: 460, position: 'relative' }}>
                <span style={{ position: 'absolute', top: -10, left: 10, background: 'var(--cyan)', color: '#fff', fontSize: 10.5, fontWeight: 700, letterSpacing: 2, padding: '0 7px' }}>旁白</span>
                把完整剧本贴进来吧（可一份包含多集）——我来拆分成集，确认后逐格上墨、依次制作。
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
          <div style={{ borderTop: '2px solid var(--ink)', padding: '13px 26px 18px', background: 'var(--page)' }}>
            <div style={{ border: '2px solid var(--ink)', background: 'var(--panel)', padding: '10px 13px' }}>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
                placeholder={questionHint}
                style={{ width: '100%', border: 'none', outline: 'none', resize: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 14, minHeight: 21, maxHeight: 160 }}
                rows={2}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                <span className="lnk" style={{ fontSize: 12.5 }} onClick={() => fileRef.current?.click()}>上传 .md / .txt</span>
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
                <div style={{ flex: 1 }} />
                <button className="btn primary" style={{ padding: '5px 18px' }} disabled={!draft.trim() || send.isPending} onClick={submit}>
                  登记 →
                </button>
              </div>
            </div>
            {error ? <div style={{ color: 'var(--red-deep)', fontSize: 12, marginTop: 6 }}><span className="stamp" style={{ fontSize: 10.5, marginRight: 8 }}>错误</span>{error}</div> : null}
          </div>
        </div>
        <WorkspaceBoard projectId={id ?? ''} activeEpisodeId={activeEpisodeId} invalidateKey={tick} />
      </div>
    </div>
  );
}
