import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import { AiPromptConfigService } from './ai-prompt-config.service';
import { UnifiedAiService } from '../../../shared/ai-provider/unified-ai.service';

/**
 * AI filtering service — uses UnifiedAiService for all AI API calls.
 *
 * This service is responsible for:
 * - Filtering and ranking news articles via AI
 * - Filtering raw articles by relevance
 * - Cleaning markdown content
 * - Generic AI completion calls
 *
 * All HTTP calls to AI providers go through UnifiedAiService.callChatCompletion(),
 * which provides ExternalLogService integration, error logging, and timeout handling.
 */
@Injectable()
export class AIFilterService {
  private readonly logger = new Logger(AIFilterService.name);

  constructor(
    private readonly unifiedAiService: UnifiedAiService,
    private readonly aiPromptConfigService: AiPromptConfigService,
  ) {}

  // ── JSON parsing utilities ──────────────────────────────

  /**
   * Validate & extract array from parsed AI response.
   * - If already an array → return as-is.
   * - If object wrapper (e.g. `{ data: [...] }`, `{ articles: [...] }`)
   *   → return the first array value found.
   * - If primitive or no nested array → throw Error with context.
   */
  private extractArray(
    parsed: any,
    contextLabel: string,
    rawText: string,
  ): any[] {
    if (Array.isArray(parsed)) return parsed;
    if (parsed !== null && typeof parsed === 'object') {
      const innerArray = Object.values(parsed).find((v) => Array.isArray(v));
      if (innerArray) return innerArray;
    }
    throw new Error(
      `AI response is not a JSON array and contains no nested array ${contextLabel}. Raw text: ${rawText.substring(0, 200)}...`,
    );
  }

  /**
   * Extract & parse a JSON array from AI text response, tolerating
   * preamble/markdown wrappers. Finds first '[' and last ']', parses
   * the slice. Throws Error with clear message on parse failure.
   */
  private parseJsonArrayResponse(rawText: string, contextLabel: string): any[] {
    const cleaned = rawText
      .replace(/```json/gi, '')
      .replace(/```/gi, '')
      .trim();

    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const start = cleaned.indexOf('[');
      const end = cleaned.lastIndexOf(']');
      if (start !== -1 && end !== -1 && end > start) {
        try {
          parsed = JSON.parse(cleaned.substring(start, end + 1));
        } catch {
          throw new Error(
            `JSON parsing failed: ${contextLabel}. Raw text: ${cleaned.substring(0, 200)}...`,
          );
        }
      } else {
        throw new Error(
          `JSON parsing failed: ${contextLabel}. Raw text: ${cleaned.substring(0, 200)}...`,
        );
      }
    }

    return this.extractArray(parsed, contextLabel, cleaned);
  }

  // ── Error classification ────────────────────────────────

  /**
   * Map HTTP status code to a human-readable error description.
   */
  httpErrorDescription(status: number): string {
    return this.unifiedAiService.httpErrorDescription(status);
  }

  // ── Helper: extract result text from AI response ────────

  /**
   * Extract the content text from a chat completion response.
   * Parses error bodies and maps status codes to readable messages.
   */
  private async extractResultFromResponse(
    res: Response,
    providerName: string,
  ): Promise<string> {
    if (!res.ok) {
      const errBody = await res.text();
      let errorMessage = errBody;
      try {
        const parsed = JSON.parse(errBody);
        errorMessage = parsed.error?.message || errBody;
      } catch {
        // non-json error body
      }
      throw new Error(
        `${providerName} API error: ${res.status} - ${this.httpErrorDescription(res.status)}. Details: ${errorMessage}`,
      );
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }

  // ── Public API methods ──────────────────────────────────

  async filterAndRank(filePath: string): Promise<any[]> {
    this.logger.log(`Starting Job 2: AI Filter & Ranking on file ${filePath}`);

    const provider = this.unifiedAiService.resolveProvider();

    try {
      const rawData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      this.logger.log(
        `Sending data to AI API for filtering and ranking (Model: ${provider.model}, Provider: ${provider.name})`,
      );

      const contentToAnalyze = rawData
        .map(
          (d: any) => `URL: ${d.url}\nTitle: ${d.title}\nContent: ${d.content}`,
        )
        .join('\n\n---\n\n')
        .substring(0, 30000);

      const prompt = `${this.aiPromptConfigService.getPromptByName('FILTER_AND_RANK_PROMPT')}${contentToAnalyze}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000);

      try {
        this.logger.log(`Using ${provider.name} API`);
        const res = await this.unifiedAiService.callChatCompletion(
          {
            model: provider.model,
            messages: [{ role: 'user', content: prompt }],
          },
          {
            provider,
            contextLabel: 'filterAndRank',
            prompt,
            signal: controller.signal,
          },
        );

        const resultText = await this.extractResultFromResponse(
          res,
          provider.name,
        );

        const finalTop5 = this.parseJsonArrayResponse(
          resultText,
          'filterAndRank',
        );
        this.logger.log(
          `Job 2 completed. Extracted ${finalTop5.length} articles via AI.`,
        );
        return finalTop5;
      } catch (err: any) {
        if (err.name === 'AbortError') {
          throw new Error('AI API request timed out after 300 seconds');
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error: any) {
      this.logger.error(`Error in AI filtering: ${error.message}`, error.stack);
      throw new BadRequestException(`Error in AI filtering: ${error.message}`);
    }
  }

  async filterRawArticles(articles: any[]): Promise<any[]> {
    this.logger.log(`Starting AI Filter Raw Articles`);
    if (!articles || articles.length === 0) return [];

    const provider = this.unifiedAiService.resolveProvider();

    const contentToAnalyze = articles
      .map(
        (d: any) =>
          `urlHash: ${d.urlHash || d._id}\nTitle: ${d.title}\nDescription: ${d.description || ''}`,
      )
      .join('\n\n---\n\n')
      .substring(0, 60000);

    this.logger.log(
      `Sending raw articles to AI for filtering (Provider: ${provider.name})`,
    );
    const prompt = `${this.aiPromptConfigService.getPromptByName('RAW_ARTICLES_PROMPT')}\n\nHere are the raw articles to analyze:\n${contentToAnalyze}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000);

    try {
      this.logger.log(`Using ${provider.name} API`);
      const res = await this.unifiedAiService.callChatCompletion(
        {
          model: provider.model,
          messages: [{ role: 'user', content: prompt }],
        },
        {
          provider,
          contextLabel: 'filterRawArticles',
          prompt,
          signal: controller.signal,
        },
      );

      const resultText = await this.extractResultFromResponse(
        res,
        provider.name,
      );
      return this.parseJsonArrayResponse(resultText, 'filterRawArticles');
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error('AI API request timed out after 300 seconds');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async cleanMarkdownContentWithAI(markdown: string): Promise<string> {
    this.logger.log(`Starting AI Markdown Cleaning`);
    if (!markdown || markdown.trim() === '') return '';

    const provider = this.unifiedAiService.resolveProvider();

    this.logger.log(
      `Cleaning markdown content via AI (Provider: ${provider.name})`,
    );
    const prompt = `${this.aiPromptConfigService.getPromptByName('CLEAN_ARTICLE_PROMPT')}\n${markdown}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000);

    try {
      this.logger.log(`Using ${provider.name} API for cleaning`);
      const res = await this.unifiedAiService.callChatCompletion(
        {
          model: provider.model,
          messages: [{ role: 'user', content: prompt }],
        },
        {
          provider,
          contextLabel: 'cleanMarkdownContentWithAI',
          prompt,
          signal: controller.signal,
        },
      );

      const resultText = await this.extractResultFromResponse(
        res,
        provider.name,
      );

      // Cleanup potential markdown wrappers
      return resultText
        .replace(/^```[a-z]*\n/i, '')
        .replace(/\n```$/i, '')
        .trim();
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error('AI API request timed out after 300 seconds');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Generic AI completion — accepts systemPrompt + contentData, returns text.
   * contextLabel distinguishes the calling context for logging.
   */
  async callAiCompletion(
    systemPrompt: string,
    contentData: string,
    contextLabel: string,
  ): Promise<string> {
    this.logger.log(`Starting AI completion [${contextLabel}]`);
    if (!contentData || contentData.trim() === '') return '';

    this.logger.log(
      `Input size [${contextLabel}]: ${contentData.length} chars (~${Math.ceil(contentData.length / 3)} tokens estimated)`,
    );

    const provider = this.unifiedAiService.resolveProvider();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000);

    try {
      this.logger.log(`Using ${provider.name} API for analysis`);
      const res = await this.unifiedAiService.callChatCompletion(
        {
          model: provider.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: contentData },
          ],
        },
        {
          provider,
          contextLabel,
          prompt: `${systemPrompt}\n${contentData}`,
          signal: controller.signal,
        },
      );

      const resultText = await this.extractResultFromResponse(
        res,
        provider.name,
      );

      // Cleanup potential markdown wrappers
      return resultText
        .replace(/^```[a-z]*\n/i, '')
        .replace(/\n```$/i, '')
        .trim();
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error('AI API request timed out after 300 seconds');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
