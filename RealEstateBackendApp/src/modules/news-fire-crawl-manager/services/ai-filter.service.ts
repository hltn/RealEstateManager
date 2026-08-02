import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import { AiPromptConfigService } from './ai-prompt-config.service';

@Injectable()
export class AIFilterService {
  private readonly logger = new Logger(AIFilterService.name);

  constructor(
    private configService: ConfigService,
    private aiPromptConfigService: AiPromptConfigService,
  ) {}

  /**
   * Validate & ép giá trị parsed về dạng mảng article.
   * - Nếu đã là mảng → trả về nguyên.
   * - Nếu là object wrapper (VD: `{ data: [...] }`, `{ articles: [...] }`)
   *   → trả về giá trị mảng đầu tiên tìm được bên trong.
   * - Nếu là primitive hoặc object không chứa mảng con → throw Error rõ ràng
   *   (fail-fast) kèm contextLabel + 200 ký tự raw để caller biết contract bị
   *   vi phạm, KHÔNG fallback bọc `[parsed]` gây silent data corruption.
   */
  private extractArray(
    parsed: any,
    contextLabel: string,
    rawText: string,
  ): any[] {
    if (Array.isArray(parsed)) return parsed;
    if (parsed !== null && typeof parsed === 'object') {
      const innerArray = Object.values(parsed).find((v) => Array.isArray(v));
      if (innerArray) return innerArray as any[];
    }
    throw new Error(
      `AI response is not a JSON array and contains no nested array ${contextLabel}. Raw text: ${rawText.substring(0, 200)}...`,
    );
  }

  /**
   * Extract & parse a JSON array từ text response của AI, chịu được
   * preamble/văn dẫn nhập bao quanh. Tìm '[' đầu tiên và ']' cuối cùng,
   * parse slice đó. Throw Error có message rõ ràng nếu không parse được.
   */
  private parseJsonArrayResponse(
    rawText: string,
    contextLabel: string,
  ): any[] {
    const cleaned = rawText
      .replace(/```json/gi, '')
      .replace(/```/gi, '')
      .trim();

    // Parse JSON: thử trực tiếp trước, nếu lỗi thì fallback trích slice
    // từ '[' đầu tiên đến ']' cuối cùng.
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

    // Validate & ép về mảng (fail-fast nếu contract bị vi phạm).
    return this.extractArray(parsed, contextLabel, cleaned);
  }

  async filterAndRank(filePath: string): Promise<any[]> {
    this.logger.log(`Starting Job 2: AI Filter & Ranking on file ${filePath}`);

    const openRouterApiKey =
      this.configService.get<string>('OPENROUTER_API_KEY') ||
      process.env.OPENROUTER_API_KEY;
    const model =
      this.configService.get<string>('OPENROUTER_AI_MODEL') ||
      process.env.OPENROUTER_AI_MODEL ||
      'google/gemini-2.5-flash';

    if (!openRouterApiKey) {
      this.logger.error('No valid AI API Key found (OpenRouter key missing).');
      throw new BadRequestException('AI API Key is not set or invalid.');
    }

    try {
      // Đọc + parse file tạm BÊN TRONG try-catch để lỗi (file missing/JSON sai)
      // được bọc trong BadRequestException thay vì ném Error/SyntaxError gốc.
      const rawData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      this.logger.log(
        `Sending data to AI API for filtering and ranking (Model: ${model})`,
      );

      const contentToAnalyze = rawData
        .map(
          (d: any) => `URL: ${d.url}\nTitle: ${d.title}\nContent: ${d.content}`,
        )
        .join('\n\n---\n\n')
        .substring(0, 30000);

      const prompt = `${this.aiPromptConfigService.getPromptByName('FILTER_AND_RANK_PROMPT')}${contentToAnalyze}`;

      let resultText = '[]';

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000);

      try {
        this.logger.log('Using OpenRouter API');
        const res = await fetch(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${openRouterApiKey}`,
              'Content-Type': 'application/json',
            },
            signal: controller.signal,
            body: JSON.stringify({
              model: model,
              messages: [{ role: 'user', content: prompt }],
            }),
          },
        );

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`OpenRouter API error: ${res.status} - ${errBody}`);
        }

        const data = await res.json();
        resultText = data.choices?.[0]?.message?.content || '[]';
      } catch (err: any) {
        if (err.name === 'AbortError') {
          throw new Error('AI API request timed out after 300 seconds');
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }

      // Parse phòng thủ: chịu được văn dẫn nhập/markdown wrapper quanh JSON
      const finalTop5 = this.parseJsonArrayResponse(resultText, 'filterAndRank');
      this.logger.log(
        `Job 2 completed. Extracted ${finalTop5.length} articles via AI.`,
      );
      return finalTop5;
    } catch (error: any) {
      this.logger.error(`Error in AI filtering: ${error.message}`, error.stack);
      throw new BadRequestException(`Error in AI filtering: ${error.message}`);
    }
  }

  async filterRawArticles(articles: any[]): Promise<any[]> {
    this.logger.log(`Starting AI Filter Raw Articles`);
    if (!articles || articles.length === 0) return [];

    const activePlatform =
      this.configService.get<string>('ACTIVE_AI_PLATFORM') ||
      process.env.ACTIVE_AI_PLATFORM ||
      'OpenRouter';

    const contentToAnalyze = articles
      .map(
        (d: any) =>
          `urlHash: ${d.urlHash || d._id}\nTitle: ${d.title}\nDescription: ${d.description || ''}`,
      )
      .join('\n\n---\n\n')
      .substring(0, 60000); // chunk if needed

    this.logger.log(`Sending raw articles to AI for filtering`);

    const prompt = `${this.aiPromptConfigService.getPromptByName('RAW_ARTICLES_PROMPT')}\n\nHere are the raw articles to analyze:\n${contentToAnalyze}`;

    let resultText = '[]';

    const openRouterApiKey =
      this.configService.get<string>('OPENROUTER_API_KEY') ||
      process.env.OPENROUTER_API_KEY;
    const openRouterModel =
      this.configService.get<string>('OPENROUTER_AI_MODEL') ||
      process.env.OPENROUTER_AI_MODEL ||
      'google/gemini-2.5-flash';

    const must1cApiKey =
      this.configService.get<string>('MUST1C_API_KEY') ||
      process.env.MUST1C_API_KEY;
    const must1cModel =
      this.configService.get<string>('MUST1C_MODEL') ||
      process.env.MUST1C_MODEL;
    const must1cApiUrl =
      this.configService.get<string>('MUST1C_API_URL') ||
      process.env.MUST1C_API_URL ||
      'https://htmustc.id.vn/v1/chat/completions';

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes for raw article filtering

      try {
        if (activePlatform === 'Must1c' && must1cApiKey) {
          this.logger.log('Using Must1c API');
          const res = await fetch(must1cApiUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${must1cApiKey}`,
              'Content-Type': 'application/json',
            },
            signal: controller.signal,
            body: JSON.stringify({
              model: must1cModel || 'gemini-3.6-flash',
              messages: [{ role: 'user', content: prompt }],
            }),
          });

          if (!res.ok) {
            const errBody = await res.text();
            let errorMessage = errBody;
            try {
              const parsed = JSON.parse(errBody);
              errorMessage = parsed.error?.message || errBody;
            } catch {
              // ignore non-json error body
            }

            let errorDesc = 'Unknown error';
            switch (res.status) {
              case 400:
                errorDesc =
                  'Invalid request or missing parameter (invalid_request_error)';
                break;
              case 401:
                errorDesc = 'Invalid API key (authentication_error)';
                break;
              case 402:
                errorDesc = 'Insufficient wallet balance (insufficient_quota)';
                break;
              case 403:
                errorDesc = 'Key lacks permission (permission_error)';
                break;
              case 429:
                errorDesc = 'Rate limit exceeded (rate_limit_error)';
                break;
              case 500:
              case 502:
                errorDesc = 'Internal gateway/upstream error (api_error)';
                break;
            }
            throw new Error(
              `Must1c API error: ${res.status} - ${errorDesc}. Details: ${errorMessage}`,
            );
          }

          const data = await res.json();
          resultText = data.choices?.[0]?.message?.content || '[]';
        } else if (openRouterApiKey) {
          this.logger.log('Using OpenRouter API');
          const res = await fetch(
            'https://openrouter.ai/api/v1/chat/completions',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${openRouterApiKey}`,
                'Content-Type': 'application/json',
              },
              signal: controller.signal,
              body: JSON.stringify({
                model: openRouterModel,
                messages: [{ role: 'user', content: prompt }],
              }),
            },
          );

          if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`OpenRouter API error: ${res.status} - ${errBody}`);
          }

          const data = await res.json();
          resultText = data.choices?.[0]?.message?.content || '[]';
        } else {
          throw new BadRequestException('No AI platform configured');
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          throw new Error('AI API request timed out after 300 seconds');
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }

      // Parse phòng thủ: chịu được văn dẫn nhập/markdown wrapper quanh JSON
      return this.parseJsonArrayResponse(resultText, 'filterRawArticles');
    } catch (error: any) {
      this.logger.error(
        `Error in filterRawArticles: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(`Error in AI filter: ${error.message}`);
    }
  }

  async cleanMarkdownContentWithAI(markdown: string): Promise<string> {
    this.logger.log(`Starting AI Markdown Cleaning`);
    if (!markdown || markdown.trim() === '') return '';

    const activePlatform =
      this.configService.get<string>('ACTIVE_AI_PLATFORM') ||
      process.env.ACTIVE_AI_PLATFORM ||
      'OpenRouter';

    this.logger.log(`Cleaning markdown content via AI`);

    const prompt = `${this.aiPromptConfigService.getPromptByName('CLEAN_ARTICLE_PROMPT')}\n${markdown}`;

    let resultText = '';

    const openRouterApiKey =
      this.configService.get<string>('OPENROUTER_API_KEY') ||
      process.env.OPENROUTER_API_KEY;
    const openRouterModel =
      this.configService.get<string>('OPENROUTER_AI_MODEL') ||
      process.env.OPENROUTER_AI_MODEL ||
      'google/gemini-2.5-flash';

    const must1cApiKey =
      this.configService.get<string>('MUST1C_API_KEY') ||
      process.env.MUST1C_API_KEY;
    const must1cModel =
      this.configService.get<string>('MUST1C_MODEL') ||
      process.env.MUST1C_MODEL;
    const must1cApiUrl =
      this.configService.get<string>('MUST1C_API_URL') ||
      process.env.MUST1C_API_URL ||
      'https://htmustc.id.vn/v1/chat/completions';

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000);

      try {
        if (activePlatform === 'Must1c' && must1cApiKey) {
          this.logger.log('Using Must1c API for cleaning');
          const res = await fetch(must1cApiUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${must1cApiKey}`,
              'Content-Type': 'application/json',
            },
            signal: controller.signal,
            body: JSON.stringify({
              model: must1cModel || 'gemini-3.6-flash',
              messages: [{ role: 'user', content: prompt }],
            }),
          });

          if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`Must1c API error: ${res.status} - ${errBody}`);
          }

          const data = await res.json();
          resultText = data.choices?.[0]?.message?.content || '';
        } else if (openRouterApiKey) {
          this.logger.log('Using OpenRouter API for cleaning');
          const res = await fetch(
            'https://openrouter.ai/api/v1/chat/completions',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${openRouterApiKey}`,
                'Content-Type': 'application/json',
              },
              signal: controller.signal,
              body: JSON.stringify({
                model: openRouterModel,
                messages: [{ role: 'user', content: prompt }],
              }),
            },
          );

          if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`OpenRouter API error: ${res.status} - ${errBody}`);
          }

          const data = await res.json();
          resultText = data.choices?.[0]?.message?.content || '';
        } else {
          throw new BadRequestException('No AI platform configured');
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          throw new Error('AI API request timed out after 300 seconds');
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }

      // Cleanup potential markdown wrappers
      resultText = resultText
        .replace(/^```[a-z]*\n/i, '')
        .replace(/\n```$/i, '')
        .trim();

      return resultText;
    } catch (error: any) {
      this.logger.error(
        `Error in cleanMarkdownContentWithAI: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Error in AI markdown cleaning: ${error.message}`,
      );
    }
  }

  // Hàm generic gọi AI completion, nhận systemPrompt + contentData và trả về text.
  // contextLabel dùng để log phân biệt ngữ cảnh gọi (extract listings / market trends / ...).
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

    const activePlatform =
      this.configService.get<string>('ACTIVE_AI_PLATFORM') ||
      process.env.ACTIVE_AI_PLATFORM ||
      'OpenRouter';

    let resultText = '';

    const openRouterApiKey =
      this.configService.get<string>('OPENROUTER_API_KEY') ||
      process.env.OPENROUTER_API_KEY;
    const openRouterModel =
      this.configService.get<string>('OPENROUTER_AI_MODEL') ||
      process.env.OPENROUTER_AI_MODEL ||
      'google/gemini-2.5-flash';

    const must1cApiKey =
      this.configService.get<string>('MUST1C_API_KEY') ||
      process.env.MUST1C_API_KEY;
    const must1cModel =
      this.configService.get<string>('MUST1C_MODEL') ||
      process.env.MUST1C_MODEL;
    const must1cApiUrl =
      this.configService.get<string>('MUST1C_API_URL') ||
      process.env.MUST1C_API_URL ||
      'https://htmustc.id.vn/v1/chat/completions';

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes for large data

      try {
        if (activePlatform === 'Must1c' && must1cApiKey) {
          this.logger.log('Using Must1c API for analysis');
          const res = await fetch(must1cApiUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${must1cApiKey}`,
              'Content-Type': 'application/json',
            },
            signal: controller.signal,
            body: JSON.stringify({
              model: must1cModel || 'gemini-3.6-flash',
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: contentData },
              ],
            }),
          });

          if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`Must1c API error: ${res.status} - ${errBody}`);
          }

          const data = await res.json();
          resultText = data.choices?.[0]?.message?.content || '';
          this.logger.log(`Must1c usage: prompt=${data.usage?.prompt_tokens ?? 'n/a'}, completion=${data.usage?.completion_tokens ?? 'n/a'}`);
        } else if (openRouterApiKey) {
          this.logger.log('Using OpenRouter API for analysis');
          const res = await fetch(
            'https://openrouter.ai/api/v1/chat/completions',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${openRouterApiKey}`,
                'Content-Type': 'application/json',
              },
              signal: controller.signal,
              body: JSON.stringify({
                model: openRouterModel,
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: contentData },
                ],
              }),
            },
          );

          if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`OpenRouter API error: ${res.status} - ${errBody}`);
          }

          const data = await res.json();
          resultText = data.choices?.[0]?.message?.content || '';
          this.logger.log(`OpenRouter usage: prompt=${data.usage?.prompt_tokens ?? 'n/a'}, completion=${data.usage?.completion_tokens ?? 'n/a'}`);
        } else {
          throw new BadRequestException('No AI platform configured');
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          throw new Error('AI API request timed out after 300 seconds');
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }

      // Cleanup potential markdown wrappers just in case it wraps everything in markdown block
      resultText = resultText
        .replace(/^```[a-z]*\n/i, '')
        .replace(/\n```$/i, '')
        .trim();

      return resultText;
    } catch (error: any) {
      this.logger.error(
        `Error in callAiCompletion [${contextLabel}]: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(`Error in AI analysis: ${error.message}`);
    }
  }
}
