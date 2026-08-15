import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { LlmService } from '../llm/llm.service';
import type { LlmRole } from '../llm/llm.service';
import { LlmModule } from '../llm/llm.module';
import { Module } from '@nestjs/common';

// prompt 外置加载器：队友 B 只改 prompts/*.md，不碰 TS（architecture.md §2 并行策略）
const PROMPTS_DIR = join(process.cwd(), 'src', 'prompts');

export function loadSystemPrompt(role: LlmRole): string {
  const file = join(PROMPTS_DIR, `${role}.system.md`);
  return readFileSync(file, 'utf-8');
}

// ===== LegacyImporter：调旧系统接口拿分镜+旧提示词（v1 沿用旧切分）=====
@Injectable()
export class CoreService {
  private readonly logger = new Logger(CoreService.name);

  constructor(private readonly llm: LlmService) {}

  // ---- 旧系统导入（mock：读 samples/legacy-response.json；real：调 LEGACY_BASE_URL）----
  async importLegacyShots(scriptText: string): Promise<{
    shots: { seq: number; sceneNo: number; scriptExcerpt: string; durationSec: number; legacyPrompt: string }[];
  }> {
    if (process.env.LEGACY_MODE === 'real') {
      return this.callRealLegacy(scriptText);
    }
    // mock：固定样例（周一替换为真实接口）
    const file = join(process.cwd(), 'samples', 'legacy-response.json');
    const raw = JSON.parse(readFileSync(file, 'utf-8'));
    return { shots: raw.shots };
  }

  private async callRealLegacy(scriptText: string): Promise<never> {
    throw new Error('[legacy] real 模式未实现——待旧接口文档（architecture.md §9 风险2）');
  }

  // ---- 轻量角色提取（demo 后由完整 Parser 替代）----
  async extractCharacters(scriptText: string): Promise<{ name: string; canonical: string }[]> {
    const zChars = z.array(z.object({ name: z.string(), canonical: z.string() }));
    const { data } = await this.llm.complete({
      role: 'director',
      systemPrompt: '从剧本提取角色卡。输出 JSON 数组 [{"name":"","canonical":"完整外观描述串"}]',
      userPrompt: scriptText.slice(0, 4000),
      schema: zChars,
    });
    return data;
  }

  async loadPrompt(role: LlmRole): Promise<string> {
    return loadSystemPrompt(role);
  }
}

@Module({
  imports: [LlmModule],
  providers: [CoreService],
  exports: [CoreService],
})
export class CoreModule {}
