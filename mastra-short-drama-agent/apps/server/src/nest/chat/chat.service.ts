import { Injectable, Inject } from '@nestjs/common';
import type { QuestionKind, MessageDto } from '@short-drama/shared';
import { PrismaService } from '../prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { parseScriptMarkdown } from '../../domain/markdown-script-parser.ts';
import {
  splitEpisodesByRules,
  validateEpisodeGroups,
  segmentsFromGroups,
  type EpisodeSegment,
  type EpisodeGroup,
} from '../../domain/episode-splitter.ts';
import { splitEpisodesByModel, reviewEpisodeSplit } from '../llm/agents.ts';
import { ImpactService } from '../projects/impact.service.js';

interface PreviewSegment {
  episodeNo: number;
  title: string | null;
  content: string;
  scenes: number;
  summary: string | null;
}

function looksLikeScript(content: string): boolean {
  const text = content.trim();
  if (text.length >= 40 && text.split('\n').filter((line) => line.trim()).length >= 3) return true;
  if (/^#{1,6}\s*(?:第\s*)?\d+\s*场/m.test(text)) return true;
  if (/^\d+\.\s*(?:INT\.|EXT\.|内|外)/m.test(text)) return true;
  return false;
}

function guessEpisodeNo(content: string, title: string | null): number | null {
  const source = `${title ?? ''}\n${content.slice(0, 400)}`;
  const match = source.match(/第\s*(\d+)\s*[集话回]/);
  return match ? Number(match[1]) : null;
}

@Injectable()
export class ChatService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(ImpactService) private readonly impact: ImpactService,
  ) {}

  /** 对话统一入口：意图路由（导入 / 回答补问 / 普通文本）。 */
  async sendMessage(projectId: string, content: string, meta: Record<string, unknown> | null): Promise<{ messages: MessageDto[] }> {
    const conversation = await this.prisma.conversation.findUnique({ where: { projectId } });
    if (!conversation) throw new Error(`会话不存在: ${projectId}`);
    const history = await this.prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
    });
    const pending = this.pendingQuestion(history);

    if (pending) {
      const replies = await this.answerQuestion(projectId, conversation.id, pending, content, history);
      return { messages: replies };
    }

    if (looksLikeScript(content)) {
      return { messages: await this.acceptScript(projectId, conversation.id, content, typeof meta?.fileName === 'string' ? meta.fileName : null) };
    }

    // 修改意图：命中资产 → 影响分析确认卡
    const impactMessage = await this.impact.analyze(projectId, content);
    if (impactMessage) return { messages: [impactMessage] };

    const guidance = await this.append(projectId, conversation.id, 'assistant', 'note', this.guidanceText(history));
    return { messages: [guidance] };
  }

  private pendingQuestion(history: { id: string; role: string; kind: string; meta: unknown }[]): QuestionKind | null {
    const last = history[history.length - 1];
    if (!last || last.role !== 'assistant' || last.kind !== 'question') return null;
    const meta = (last.meta ?? {}) as { kind?: QuestionKind };
    return meta.kind ?? null;
  }

  private guidanceText(history: { role: string }[]): string {
    const hasScript = history.some((message) => message.role === 'user');
    return hasScript
      ? '把要补充的要求直接打字告诉我；要登记新一集，直接把剧本贴进来。'
      : '把完整剧本粘贴进来（可一份包含多集；或点输入框旁的「上传」选择 .md / .txt 文件），我来拆分成集并依次制作。';
  }

  /** 收到剧本：多集拆分（规则优先 → 模型辅助 → 审查）或单集登记。 */
  private async acceptScript(
    projectId: string,
    conversationId: string,
    content: string,
    fileName: string | null,
  ): Promise<MessageDto[]> {
    const parsed = parseScriptMarkdown(content);
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new Error('项目不存在');
    const episodes = await this.prisma.episode.findMany({ where: { projectId }, orderBy: { episodeNo: 'asc' } });

    await this.append(projectId, conversationId, 'user', 'script', fileName ? `剧本文件 ${fileName}` : `剧本 · ${content.length.toLocaleString()} 字`, { content, fileName, parsedTitle: parsed.title });

    const out: MessageDto[] = [];
    const guessed = parsed.title ? guessEpisodeNo(content, parsed.title) : guessEpisodeNo(content, null);
    const nextNo = (episodes.at(-1)?.episodeNo ?? 0) + 1;

    out.push(await this.append(projectId, conversationId, 'assistant', 'note',
      `剧本登记完毕${parsed.title ? `《${parsed.title}》` : ''}：${content.length.toLocaleString()} 字 · 识别 ${parsed.scenes.length} 场${parsed.warnings.length ? ` · ${parsed.warnings.length} 条解析提示` : ''}。`,
      { parsedTitle: parsed.title, sceneCount: parsed.scenes.length }));

    // ── 多集拆分：规则优先 → 模型辅助 → 审查复查 ──
    const ruleSplit = splitEpisodesByRules(content, parsed);
    // 少于两场、或体量过小（片段而非完整剧本）→ 单集登记；模型拆分只服务真正的全本
    const fragmentLike = parsed.scenes.length < 4 || content.length < 600;
    if (parsed.scenes.length < 2 || (ruleSplit.segments.length < 2 && fragmentLike)) {
      if (guessed && !episodes.some((episode) => episode.episodeNo === guessed)) {
        return [...out, ...await this.registerAndAnnounce(projectId, conversationId, content, fileName, guessed, parsed.title)];
      }
      out.push(await this.append(projectId, conversationId, 'assistant', 'question',
        `这准备登记第几集？`, { kind: 'episode_no', guessed: nextNo }));
      return out;
    }

    let groups: EpisodeGroup[] | null = null;
    let segments: EpisodeSegment[] | null = null;
    let source: 'rules' | 'model' = 'model';

    if (ruleSplit.segments.length >= 2) {
      const ruleGroups = ruleSplit.segments.map((segment) => ({
        episodeNo: segment.episodeNo, title: segment.title, sceneIndexes: segment.sceneIndexes, summary: '',
      }));
      if (validateEpisodeGroups(ruleGroups, parsed.scenes.length).ok) {
        groups = ruleGroups;
        segments = ruleSplit.segments;
        source = 'rules';
      }
    }

    if (!groups) {
      try {
        groups = await splitEpisodesByModel(parsed);
        source = 'model';
      } catch (error) {
        console.error(JSON.stringify({ event: 'episode_split_failed', error: error instanceof Error ? error.message : String(error) }));
        return [await this.append(projectId, conversationId, 'assistant', 'note',
          '拆集失败：模型连续多次未能给出有效分集。可重新发送剧本重试，或按单集逐次粘贴登记。')];
      }
    }

    let review = { passed: true, issues: [] as { episodeNo: number | null; issue: string; suggestion: string }[] };
    try {
      const reviewResult = await reviewEpisodeSplit(groups, parsed);
      if (reviewResult.groups !== groups) {
        segments = segmentsFromGroups(content, reviewResult.groups, parsed);
        groups = reviewResult.groups;
      }
      review = { passed: reviewResult.passed, issues: reviewResult.issues };
    } catch (error) {
      console.error(JSON.stringify({ event: 'episode_split_review_unavailable', error: error instanceof Error ? error.message : String(error) }));
      out.push(await this.append(projectId, conversationId, 'assistant', 'note',
        '拆分审查暂时不可用，已按当前拆分结果进入预览。'));
    }

    const finalSegments = segments ?? segmentsFromGroups(content, groups, parsed);
    const summaries = new Map(groups.map((group) => [group.episodeNo, group.summary] as const));
    const preview: PreviewSegment[] = finalSegments.map((segment) => ({
      episodeNo: segment.episodeNo,
      title: segment.title,
      content: segment.content,
      scenes: segment.sceneIndexes.length,
      summary: summaries.get(segment.episodeNo) ?? null,
    }));

    const listText = preview.map((segment, index) =>
      `${index + 1}. 第 ${segment.episodeNo} 集${segment.title ? `《${segment.title}》` : ''} · ${segment.scenes} 场 · ${segment.content.length.toLocaleString()} 字${segment.summary ? ` · ${segment.summary}` : ''}`
    ).join('\n');
    const issuesText = review.issues.length
      ? `\n⚠ 拆分审查提示：\n${review.issues.map((item) => `· ${item.episodeNo ? `第 ${item.episodeNo} 集：` : ''}${item.issue}（建议：${item.suggestion}）`).join('\n')}`
      : '';

    out.push(await this.append(projectId, conversationId, 'assistant', 'note',
      `识别为多集剧本（${source === 'rules' ? '规则拆分' : '模型拆分'} · 共 ${preview.length} 集）：\n${listText}${issuesText}`,
      { splitSource: source, reviewPassed: review.passed, episodeCount: preview.length }));

    out.push(await this.append(projectId, conversationId, 'assistant', 'question',
      `确认后将为 ${preview.length} 集登记剧本并按顺序自动制作（同一项目一次只制作一集）。回复「确认」开始；回复「取消」放弃本次导入。`,
      { kind: 'split_confirm', source, reviewIssues: review.issues, segments: preview }));
    return out;
  }

  /** 回答补问：集数 → 登记；拆分预览 → 批量登记；兼容旧镜头数补问。 */
  private async answerQuestion(
    projectId: string,
    conversationId: string,
    question: QuestionKind,
    content: string,
    history: { id: string; role: string; kind: string; content: string; meta: unknown }[],
  ): Promise<MessageDto[]> {
    if (question === 'episode_no') {
      const match = content.match(/\d+/);
      const episodeNo = match ? Number(match[0]) : null;
      if (!episodeNo || episodeNo < 1 || episodeNo > 999) {
        return [await this.append(projectId, conversationId, 'assistant', 'question', '没太看懂——请直接回复数字，例如「2」表示第 2 集。', { kind: 'episode_no' })];
      }
      const exists = await this.prisma.episode.findFirst({ where: { projectId, episodeNo } });
      if (exists) {
        return [await this.append(projectId, conversationId, 'assistant', 'question', `第 ${episodeNo} 集已经登记过了。回复其它集数，或回复「下一集」登记第 ${episodeNo + 1} 集。`, { kind: 'episode_no' })];
      }
      await this.append(projectId, conversationId, 'user', 'text', content);
      const script = [...history].reverse().find((message) => message.kind === 'script');
      const scriptMeta = (script?.meta ?? {}) as { content?: string; fileName?: string | null; parsedTitle?: string | null };
      const scriptContent = scriptMeta.content ?? script?.content ?? '';
      return this.registerAndAnnounce(projectId, conversationId, scriptContent, scriptMeta.fileName ?? null, episodeNo, scriptMeta.parsedTitle ?? null);
    }

    // 兼容历史会话中未完成的镜头数补问：镜头数已改为模型规划，直接登记。
    if (question === 'shot_count') {
      const lastQuestion = [...history].reverse().find((message) => message.kind === 'question' && ((message.meta ?? {}) as { episodeNo?: number }).episodeNo);
      const episodeNo = ((lastQuestion?.meta ?? {}) as { episodeNo?: number }).episodeNo
        ?? (await this.prisma.episode.count({ where: { projectId } })) + 1;
      const script = [...history].reverse().find((message) => message.kind === 'script');
      const scriptMeta = (script?.meta ?? {}) as { content?: string; fileName?: string | null; parsedTitle?: string | null };
      await this.append(projectId, conversationId, 'user', 'text', content);
      return this.registerAndAnnounce(projectId, conversationId, scriptMeta.content ?? '', scriptMeta.fileName ?? null, episodeNo, scriptMeta.parsedTitle ?? null);
    }

    if (question === 'split_confirm') {
      const trimmed = content.trim();
      if (/^(取消|放弃|算了|不(要|行|用|确认)?|no|cancel)/i.test(trimmed)) {
        await this.append(projectId, conversationId, 'user', 'text', content);
        const note = await this.append(projectId, conversationId, 'assistant', 'note', '已放弃本次导入。要重新开始，直接粘贴或上传剧本即可。');
        return [note];
      }
      if (!/^(确认|确定|是的?|好(的)?|ok|开始|同意|y(es)?)/i.test(trimmed)) {
        return [await this.append(projectId, conversationId, 'assistant', 'question', '请回复「确认」开始依次制作，或回复「取消」放弃本次导入。', { kind: 'split_confirm' })];
      }
      await this.append(projectId, conversationId, 'user', 'text', content);
      const questionMessage = [...history].reverse().find((message) => message.kind === 'question' && ((message.meta ?? {}) as { segments?: PreviewSegment[] }).segments);
      const segments = ((questionMessage?.meta ?? {}) as { segments?: PreviewSegment[] }).segments ?? [];
      if (!segments.length) {
        return [await this.append(projectId, conversationId, 'assistant', 'note', '找不到拆分预览数据，请重新粘贴剧本。')];
      }

      const episodes = await this.prisma.episode.findMany({ where: { projectId }, orderBy: { episodeNo: 'asc' } });
      const used = new Set(episodes.map((episode) => episode.episodeNo));
      const registered: { episodeNo: number; scenes: number; chars: number }[] = [];
      const adjusted: string[] = [];
      for (const segment of segments) {
        let episodeNo = segment.episodeNo;
        if (used.has(episodeNo)) {
          episodeNo = Math.max(0, ...used) + 1;
          adjusted.push(`第 ${segment.episodeNo} 集已存在，改登记为第 ${episodeNo} 集`);
        }
        used.add(episodeNo);
        const result = await this.registerEpisode(projectId, segment.content, null, episodeNo, segment.title);
        registered.push({ episodeNo, scenes: result.scenes, chars: result.chars });
      }
      const rangeText = registered.length
        ? `第 ${registered[0]!.episodeNo}${registered.length > 1 ? `–${registered[registered.length - 1]!.episodeNo}` : ''} 集`
        : '';
      const note = await this.append(projectId, conversationId, 'assistant', 'note',
        `已登记 ${registered.length} 集（${rangeText}，原文只读存档），已按顺序排队制作——同一项目一次只制作一集，镜头数由模型按剧本内容规划。${adjusted.length ? `\n${adjusted.join('；')}` : ''}`,
        { episodeIds: registered.map((item) => item.episodeNo), adjusted });
      return [note];
    }

    return [];
  }

  /** 单集登记 + 完成播报。 */
  private async registerAndAnnounce(
    projectId: string,
    conversationId: string,
    content: string,
    fileName: string | null,
    episodeNo: number,
    title: string | null,
  ): Promise<MessageDto[]> {
    const result = await this.registerEpisode(projectId, content, fileName, episodeNo, title);
    const note = await this.append(projectId, conversationId, 'assistant', 'note',
      `第 ${episodeNo} 集已登记（原文只读存档）：${result.chars.toLocaleString()} 字 · ${result.scenes} 场 · 镜头数将由模型按剧本内容规划。接下来将自动开始制作——生成过程会在这里实时滚动。`,
      { episodeId: result.episodeId, scriptVersionId: result.scriptVersionId, episodeNo, sceneCount: result.scenes });
    return [note];
  }

  /** 信息齐备：建 Episode + ScriptVersion（原文只读）+ 排队制作任务。 */
  private async registerEpisode(
    projectId: string,
    content: string,
    fileName: string | null,
    episodeNo: number,
    title: string | null,
  ): Promise<{ episodeId: string; scriptVersionId: string; chars: number; scenes: number }> {
    const parsed = parseScriptMarkdown(content);
    const episode = await this.prisma.episode.create({
      data: { projectId, episodeNo, title, status: 'imported', shotTarget: null },
    });
    const scriptVersion = await this.prisma.scriptVersion.create({
      data: {
        episodeId: episode.id,
        version: 1,
        format: parsed.format,
        content,
        sourceFileName: fileName,
      },
    });
    await this.prisma.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } });
    await this.prisma.domainTask.create({
      data: {
        kind: 'production',
        status: 'queued',
        progress: { stage: 'parse', stages: {}, shotsDone: 0, shotsTotal: 0 },
        projectId,
        episodeId: episode.id,
        inputRef: JSON.stringify({ scriptVersionId: scriptVersion.id, scriptText: content, shotTarget: null }),
      },
    });
    await this.events.append(projectId, 'episode_created', { episodeId: episode.id, episodeNo, shotTarget: null });
    await this.events.append(projectId, 'artifact_created', { artifact: 'script_version', episodeId: episode.id, scriptVersionId: scriptVersion.id, chars: content.length });
    return { episodeId: episode.id, scriptVersionId: scriptVersion.id, chars: content.length, scenes: parsed.scenes.length };
  }

  private async append(
    projectId: string,
    conversationId: string,
    role: 'user' | 'assistant',
    kind: string,
    content: string,
    meta?: Record<string, unknown>,
  ): Promise<MessageDto> {
    const message = await this.prisma.message.create({
      data: { conversationId, role, kind, content, meta: (meta ?? {}) as object },
    });
    await this.events.append(projectId, 'message', { messageId: message.id, role, kind });
    return {
      id: message.id,
      role,
      kind,
      content: message.content,
      meta: message.meta,
      createdAt: message.createdAt.toISOString(),
    };
  }
}
