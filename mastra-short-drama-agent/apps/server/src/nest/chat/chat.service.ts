import { Injectable, Inject } from '@nestjs/common';
import { SHOT_COUNT_RANGE, type QuestionKind, type MessageDto } from '@short-drama/shared';
import { PrismaService } from '../prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { parseScriptMarkdown } from '../../domain/markdown-script-parser.ts';
import { ImpactService } from '../projects/impact.service.js';

const SCRIPT_MIN_CHARS = 160;

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
      : '把第一集剧本直接粘贴进来（或点输入框旁的「上传」选择 .md / .txt 文件），我来依次确认集数和镜头数。';
  }

  /** 收到剧本：识别 → 缺什么问什么（集数 → 镜头数）。 */
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

    const guessed = parsed.title ? guessEpisodeNo(content, parsed.title) : guessEpisodeNo(content, null);
    const nextNo = (episodes.at(-1)?.episodeNo ?? 0) + 1;
    const episodeNo = guessed && !episodes.some((ep) => ep.episodeNo === guessed) ? guessed : nextNo;
    const sceneCount = parsed.scenes.length;
    const out: MessageDto[] = [];

    out.push(await this.append(projectId, conversationId, 'assistant', 'note',
      `剧本登记完毕${parsed.title ? `《${parsed.title}》` : ''}：${content.length.toLocaleString()} 字 · 识别 ${sceneCount} 场${parsed.warnings.length ? ` · ${parsed.warnings.length} 条解析提示` : ''}。`,
      { parsedTitle: parsed.title, sceneCount }));

    // 集数已可推断 → 直接确认并问镜头数；否则先问集数
    if (guessed && !episodes.some((ep) => ep.episodeNo === guessed)) {
      out.push(...await this.finalizeImport(projectId, conversationId, content, fileName, guessed, parsed.title, sceneCount));
      return out;
    }
    out.push(await this.append(projectId, conversationId, 'assistant', 'question',
      `这准备登记第几集？`, { kind: 'episode_no', guessed: nextNo }));
    return out;
  }

  /** 回答补问：集数 → 镜头数 → 完成 ScriptVersion 登记。 */
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
      return [
        await this.append(projectId, conversationId, 'assistant', 'note', `好，登记第 ${episodeNo} 集。`),
        await this.append(projectId, conversationId, 'assistant', 'question',
          `这集希望生成多少个镜头？建议 ${SHOT_COUNT_RANGE.min}–${SHOT_COUNT_RANGE.max} 个，默认 ${SHOT_COUNT_RANGE.default} 个。`, { kind: 'shot_count', episodeNo }),
      ];
    }

    if (question === 'shot_count') {
      const match = content.match(/\d+/);
      const shotTarget = match ? Number(match[0]) : SHOT_COUNT_RANGE.default;
      const clamped = Math.min(120, Math.max(4, shotTarget));
      await this.append(projectId, conversationId, 'user', 'text', content);
      const lastQuestion = [...history].reverse().find((message) => message.kind === 'question' && ((message.meta ?? {}) as { episodeNo?: number }).episodeNo);
      const episodeNo = ((lastQuestion?.meta ?? {}) as { episodeNo?: number }).episodeNo
        ?? (await this.prisma.episode.count({ where: { projectId } })) + 1;
      const script = [...history].reverse().find((message) => message.kind === 'script');
      const scriptMeta = (script?.meta ?? {}) as { content?: string; fileName?: string | null; parsedTitle?: string | null };
      const scriptContent = scriptMeta.content ?? '';
      return this.finalizeImport(projectId, conversationId, scriptContent, scriptMeta.fileName ?? null, episodeNo, scriptMeta.parsedTitle ?? null, undefined, clamped);
    }

    return [];
  }

  /** 信息齐备：建 Episode + ScriptVersion（原文只读）。 */
  private async finalizeImport(
    projectId: string,
    conversationId: string,
    content: string,
    fileName: string | null,
    episodeNo: number,
    title: string | null,
    sceneCount?: number,
    shotTarget?: number,
  ): Promise<MessageDto[]> {
    const parsed = sceneCount === undefined ? parseScriptMarkdown(content) : null;
    const scenes = sceneCount ?? parsed?.scenes.length ?? 0;
    const target = shotTarget ?? SHOT_COUNT_RANGE.default;
    const episode = await this.prisma.episode.create({
      data: { projectId, episodeNo, title, status: 'imported', shotTarget: target },
    });
    const versionCount = 1;
    const scriptVersion = await this.prisma.scriptVersion.create({
      data: {
        episodeId: episode.id,
        version: versionCount,
        format: parsed?.format ?? 'basic-markdown',
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
        inputRef: JSON.stringify({ scriptVersionId: scriptVersion.id, scriptText: content, shotTarget: target }),
      },
    });
    await this.events.append(projectId, 'episode_created', { episodeId: episode.id, episodeNo, shotTarget: target });
    await this.events.append(projectId, 'artifact_created', { artifact: 'script_version', episodeId: episode.id, scriptVersionId: scriptVersion.id, chars: content.length });
    const note = await this.append(projectId, conversationId, 'assistant', 'note',
      `第 ${episodeNo} 集已登记（原文只读存档）：${content.length.toLocaleString()} 字 · ${scenes} 场 · 目标 ${target} 镜。接下来将自动开始制作——生成过程会在这里实时滚动。`,
      { episodeId: episode.id, scriptVersionId: scriptVersion.id, episodeNo, shotTarget: target, sceneCount: scenes });
    return [note];
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
