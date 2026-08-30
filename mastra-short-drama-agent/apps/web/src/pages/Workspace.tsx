import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Snapshot, MessageDto } from '@short-drama/shared';
import { api } from '../api';
import { subscribeEvents } from '../sse';

function MessageBubble({ message }: { message: MessageDto }): JSX.Element {
  if (message.role === 'user') {
    const meta = (message.meta ?? {}) as { content?: string };
    const isScript = message.kind === 'script';
    return (
      <div style={{ borderBottom: '1px solid var(--rule-2)', padding: '10px 0 12px', marginBottom: 14 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-2)', letterSpacing: 1, marginBottom: 4 }}>
          登记{isScript ? ' · 剧本' : ' · 回复'}
        </div>
        <div style={{ fontSize: 14.5 }}>
          {isScript ? (
            <details>
              <summary style={{ cursor: 'pointer', color: 'var(--ink-2)' }}>{message.content} · 展开 ▸</summary>
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, color: 'var(--ink-2)', marginTop: 8, maxHeight: 240, overflowY: 'auto' }}>
                {meta.content ?? ''}
              </pre>
            </details>
          ) : (
            message.content
          )}
        </div>
      </div>
    );
  }
  const isQuestion = message.kind === 'question';
  const meta = (message.meta ?? {}) as { kind?: string };
  const hint =
    meta.kind === 'episode_no' ? '回复数字，例如「2」'
    : meta.kind === 'shot_count' ? '回复数字；直接回车发送即默认 30'
    : null;
  return (
    <div style={{ padding: '9px 0', borderBottom: isQuestion ? 'none' : '1px solid var(--rule-2)', lineHeight: 1.7, marginBottom: isQuestion ? 0 : 14 }}>
      <div style={{ fontSize: 14.5, fontFamily: isQuestion ? 'var(--kai)' : 'inherit', color: isQuestion ? 'var(--ink)' : 'var(--ink-2)' }}>
        {message.content}
        {isQuestion ? <span style={{ color: 'var(--blue)', marginLeft: 8 }}>（{hint}）</span> : null}
      </div>
    </div>
  );
}

export function Workspace(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
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
    });
    return unsubscribe;
  }, [id, snapshot?.lastSeq, queryClient, snapshot]);

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
  const questionHint =
    pendingQuestion?.kind === 'question'
      ? ((pendingQuestion.meta ?? {}) as { kind?: string }).kind === 'episode_no'
        ? '回复集数（数字）…'
        : '回复镜头数（建议 20–40，默认 30）…'
      : '粘贴一集已完成的剧本，或拖入 .md / .txt 文件…';

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, background: 'var(--paper-2)', borderBottom: '1.5px solid var(--ink)', padding: '11px 32px' }}>
        <span className="lnk" onClick={() => navigate('/projects')}>← 项目</span>
        <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: 1 }}>{snapshot?.project.name ?? '…'}</span>
        {(snapshot?.episodes.length ?? 0) > 0 ? (
          <span style={{ border: '1px solid var(--ink)', borderRadius: 2, padding: '3px 12px', fontSize: 13 }}>
            第 {snapshot?.episodes.at(-1)?.episodeNo} 集 · 已登记
          </span>
        ) : null}
        <div style={{ flex: 1 }} />
        <button className="btn">导出项目 ZIP</button>
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1.5px solid var(--ink)', minWidth: 0 }}>
          <div style={{ flex: 1, padding: '24px 30px', overflowY: 'auto' }}>
            {(snapshot?.messages ?? []).map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            {(snapshot?.messages.length ?? 0) === 0 ? (
              <div style={{ fontFamily: 'var(--kai)', color: 'var(--ink-2)', fontSize: 14 }}>
                把第一集剧本贴进来吧——我会依次确认集数和镜头数，然后开始自动制作。
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
          <div style={{ borderTop: '1px solid var(--rule)', padding: '14px 30px 20px', background: 'var(--paper)' }}>
            <div style={{ border: '1px solid var(--ink)', borderRadius: 2, padding: '11px 14px', background: 'var(--card)' }}>
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
                <button className="btn primary" style={{ padding: '5px 16px' }} disabled={!draft.trim() || send.isPending} onClick={submit}>
                  登记
                </button>
              </div>
            </div>
            {error ? <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 6 }}>{error}</div> : null}
          </div>
        </div>
        <div style={{ width: '44%', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '14px 26px 10px', borderBottom: '1.5px solid var(--ink)' }}>
            <b style={{ fontSize: 15 }}>图版区</b>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-2)', letterSpacing: 1 }}>M3 起实时生长</span>
          </div>
          <div style={{ flex: 1, padding: '18px 26px', overflowY: 'auto', color: 'var(--ink-3)', fontFamily: 'var(--kai)' }}>
            分镜图版、资产、穿帮记录将在制作开始后逐件出现。
            {(snapshot?.episodes.length ?? 0) > 0 ? (
              <div style={{ marginTop: 12, fontFamily: 'var(--mono)', fontSize: 12 }}>
                已登记 {snapshot?.episodes.length} 集 · 目标 {snapshot?.episodes.reduce((sum, ep) => sum + (ep.shotTarget ?? 0), 0)} 镜
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
