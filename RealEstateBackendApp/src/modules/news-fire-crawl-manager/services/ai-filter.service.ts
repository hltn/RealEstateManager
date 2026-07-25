import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import { AiPromptConfigService } from './ai-prompt-config.service';

@Injectable()
export class AIFilterService {
  private readonly logger = new Logger(AIFilterService.name);
  private ai: GoogleGenAI;

  constructor(
    private configService: ConfigService,
    private aiPromptConfigService: AiPromptConfigService,
  ) {
    this.ai = new GoogleGenAI({
      apiKey: this.configService.get<string>('GEMINI_API_KEY') || 'dummy',
    });
  }

  async filterAndRank(filePath: string): Promise<any[]> {
    this.logger.log(`Starting Job 2: AI Filter & Ranking on file ${filePath}`);

    const rawData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // Check OpenRouter first, fallback to Gemini
    const openRouterApiKey =
      this.configService.get<string>('OPENROUTER_API_KEY') ||
      process.env.OPENROUTER_API_KEY;
    const model =
      this.configService.get<string>('OPENROUTER_AI_MODEL') ||
      process.env.OPENROUTER_AI_MODEL ||
      'google/gemini-2.5-flash';

    const geminiApiKey = this.configService.get<string>('GEMINI_API_KEY');

    if (
      !openRouterApiKey &&
      (!geminiApiKey || geminiApiKey === 'your_gemini_api_key_here')
    ) {
      this.logger.error(
        'No valid AI API Key found (neither OpenRouter nor Gemini).',
      );
      throw new BadRequestException('AI API Key is not set or invalid.');
    }

    try {
      this.logger.log(
        `Sending data to AI API for filtering and ranking (Model: ${model})`,
      );

      // Take the first article's content for demonstration to avoid context limits
      // In a real scenario, you'd chunk this or use Gemini's large context window for multiple articles
      const contentToAnalyze = rawData
        .map(
          (d: any) => `URL: ${d.url}\nTitle: ${d.title}\nContent: ${d.content}`,
        )
        .join('\n\n---\n\n')
        .substring(0, 30000);

      const prompt = `${this.aiPromptConfigService.getPromptByName('FILTER_AND_RANK_PROMPT')}${contentToAnalyze}`;

      let resultText = '[]';

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      try {
        if (openRouterApiKey) {
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
        } else {
          this.logger.log('Using Gemini Native API');
          const response = await this.ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
          });
          resultText = response.text || '[]';
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          throw new Error('AI API request timed out after 60 seconds');
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }

      // Cleanup potential markdown wrappers
      resultText = resultText
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();

      const finalTop5 = JSON.parse(resultText);
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
      const timeoutId = setTimeout(() => controller.abort(), 60000);

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
          throw new Error('AI API request timed out after 60 seconds');
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }

      resultText = resultText
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();

      try {
        const parsed = JSON.parse(resultText);
        return parsed;
      } catch (parseError: any) {
        throw new Error(
          `JSON parsing failed: ${parseError.message}. Raw text: ${resultText.substring(0, 100)}...`,
        );
      }
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
    const geminiApiKey =
      this.configService.get<string>('GEMINI_API_KEY') ||
      process.env.GEMINI_API_KEY;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

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
        } else if (
          geminiApiKey &&
          geminiApiKey !== 'your_gemini_api_key_here'
        ) {
          this.logger.log('Using Gemini Native API for cleaning');
          const response = await this.ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
          });
          resultText = response.text || '';
        } else {
          throw new BadRequestException('No AI platform configured');
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          throw new Error('AI API request timed out after 60 seconds');
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

  async analyzeMarketTrends(
    systemPrompt: string,
    contentData: string,
  ): Promise<string> {
    this.logger.log(`Starting Market Trends Analysis with AI`);
    if (!contentData || contentData.trim() === '') return '';

    const activePlatform =
      this.configService.get<string>('ACTIVE_AI_PLATFORM') ||
      process.env.ACTIVE_AI_PLATFORM ||
      'OpenRouter';

    // const fullPrompt = `${systemPrompt}\n\nHere is the data:\n${contentData}`;

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
    const geminiApiKey =
      this.configService.get<string>('GEMINI_API_KEY') ||
      process.env.GEMINI_API_KEY;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 minutes for large data

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
        } else if (
          geminiApiKey &&
          geminiApiKey !== 'your_gemini_api_key_here'
        ) {
          this.logger.log('Using Gemini Native API for analysis');
          const response = await this.ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: contentData,
            config: {
              systemInstruction: systemPrompt,
            },
          });
          resultText = response.text || '';
        } else {
          throw new BadRequestException('No AI platform configured');
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          throw new Error('AI API request timed out after 180 seconds');
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
        `Error in analyzeMarketTrends: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(`Error in AI analysis: ${error.message}`);
    }
  }
}
