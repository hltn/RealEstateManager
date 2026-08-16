import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { KnowledgeConfigService } from './knowledge-config.service';

/**
 * AI content generation service.
 * Calls an abstracted AI API — provider/model/endpoint configured via
 * the ai_writing config in KnowledgeConfigService.
 *
 * Supports: OpenRouter, Must1c, 9Router (any OpenAI-compatible endpoint).
 */
@Injectable()
export class AiWritingService {
  private readonly logger = new Logger(AiWritingService.name);

  constructor(
    private readonly configService: KnowledgeConfigService,
  ) {}

  // ── Retry wrapper ───────────────────────────────────────

  private async withRetry<T>(
    fn: () => Promise<T>,
    context: string,
    maxRetries = 3,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;

        // Don't retry on 4xx (except 429)
        const status = error.response?.status;
        if (status && status >= 400 && status < 500 && status !== 429) {
          this.logger.error(`${context}: HTTP ${status} — ${error.message}`);
          throw new InternalServerErrorException(
            `AI API error (${context}): ${error.response?.data?.error?.message || error.message}`,
          );
        }

        if (attempt < maxRetries) {
          const delay = Math.min(1000 * 2 ** (attempt - 1), 10_000);
          this.logger.warn(
            `${context}: Retry ${attempt}/${maxRetries} after ${delay}ms`,
          );
          await this.sleep(delay);
        }
      }
    }

    this.logger.error(
      `${context}: All ${maxRetries} retries exhausted`,
      lastError,
    );
    throw new InternalServerErrorException(
      `AI API failed after ${maxRetries} retries (${context}): ${lastError?.message}`,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ── Provider resolution ─────────────────────────────────

  private async getProviderEndpoint(): Promise<{
    baseUrl: string;
    apiKey: string;
    model: string;
    headers: Record<string, string>;
  }> {
    const config = await this.configService.getAiWritingConfig();
    const provider = (config.provider as string) || 'OpenRouter';
    const model = (config.model as string) || 'google/gemini-2.5-flash';

    switch (provider.toLowerCase()) {
      case 'openrouter': {
        const apiKey =
          process.env.OPENROUTER_API_KEY ||
          (await this.getEnvKey('OPENROUTER_API_KEY'));
        if (!apiKey) {
          throw new InternalServerErrorException(
            'OpenRouter API key not configured',
          );
        }
        return {
          baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
          apiKey,
          model,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'RealEstateManager-Knowledge',
            'Content-Type': 'application/json',
          },
        };
      }
      case 'must1c': {
        const apiKey =
          process.env.MUST1C_API_KEY ||
          (await this.getEnvKey('MUST1C_API_KEY'));
        if (!apiKey) {
          throw new InternalServerErrorException(
            'Must1c API key not configured',
          );
        }
        return {
          baseUrl: 'https://api.must1c.com/v1/chat/completions',
          apiKey,
          model: (config.must1cModel as string) || model,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        };
      }
      case '9router': {
        const baseUrl =
          (config.nineRouterBaseUrl as string) ||
          process.env.NINEROUTER_BASE_URL ||
          'http://127.0.0.1:20128/v1';
        const apiKey =
          process.env.NINEROUTER_API_KEY ||
          (await this.getEnvKey('NINEROUTER_API_KEY'));
        if (!apiKey) {
          throw new InternalServerErrorException(
            '9Router API key not configured',
          );
        }
        return {
          baseUrl: `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
          apiKey,
          model: (config.nineRouterModel as string) || model,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        };
      }
      default:
        throw new InternalServerErrorException(
          `Unknown AI provider: ${provider}. Supported: OpenRouter, Must1c, 9Router`,
        );
    }
  }

  private async getEnvKey(key: string): Promise<string | undefined> {
    return process.env[key] || undefined;
  }

  // ── Core generation ─────────────────────────────────────

  /**
   * Generate article content for a topic.
   * Returns structured article data (title, content, htmlContent, summary, tags).
   */
  async generateContent(params: {
    topic: string;
    category: string;
    topicDescription: string;
  }): Promise<{
    title: string;
    content: string;
    htmlContent: string;
    summary: string;
    tags: string[];
  }> {
    const config = await this.configService.getAiWritingConfig();
    const promptTemplate = config.promptTemplate as string;
    const maxTokens = (config.maxTokens as number) || 4096;
    const temperature = (config.temperature as number) || 0.7;

    if (!promptTemplate) {
      throw new InternalServerErrorException(
        'AI writing prompt template not configured',
      );
    }

    // Interpolate template placeholders
    const prompt = promptTemplate
      .replace(/\{\{topic\}\}/g, params.topic)
      .replace(/\{\{category\}\}/g, params.category)
      .replace(/\{\{topicDescription\}\}/g, params.topicDescription);

    const endpoint = await this.getProviderEndpoint();

    const systemPrompt = `You are a professional real estate content writer for the Vietnamese market. 
Write high-quality, informative articles in Vietnamese.
Always return a JSON object with these fields:
- "title": SEO-friendly article title (Vietnamese)
- "content": Full article content in Markdown format
- "htmlContent": Same content rendered as HTML (with <h2>, <p>, <ul>, <strong> tags)
- "summary": Brief summary (2-3 sentences)
- "tags": Array of relevant tag names (Vietnamese)

Return ONLY the JSON object, no preamble or explanation.`;

    const result = await this.withRetry(async () => {
      const response = await fetch(endpoint.baseUrl, {
        method: 'POST',
        headers: endpoint.headers,
        body: JSON.stringify({
          model: endpoint.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
          max_tokens: maxTokens,
          temperature,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `HTTP ${response.status}: ${errorBody.substring(0, 200)}`,
        );
      }

      return response.json();
    }, `generateContent(${params.topic})`);

    // Parse AI response
    const rawContent = result.choices?.[0]?.message?.content;
    if (!rawContent) {
      throw new InternalServerErrorException(
        'AI returned empty response for content generation',
      );
    }

    try {
      const parsed = JSON.parse(rawContent);

      if (!parsed.title || !parsed.content) {
        throw new Error('AI response missing required fields (title, content)');
      }

      this.logger.log(
        `Content generated for topic: ${params.topic} — title: ${parsed.title}`,
      );

      return {
        title: parsed.title,
        content: parsed.content,
        htmlContent: parsed.htmlContent || this.markdownToHtml(parsed.content),
        summary: parsed.summary || '',
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      };
    } catch (parseError: any) {
      this.logger.error(
        `Failed to parse AI response: ${parseError.message}`,
      );
      throw new InternalServerErrorException(
        `AI returned unparseable content: ${parseError.message}`,
      );
    }
  }

  /**
   * Simple markdown → HTML converter for fallback.
   */
  markdownToHtml(markdown: string): string {
    return markdown
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(.+)$/gm, (line) => {
        if (line.startsWith('<')) return line;
        return `<p>${line}</p>`;
      });
  }
}
