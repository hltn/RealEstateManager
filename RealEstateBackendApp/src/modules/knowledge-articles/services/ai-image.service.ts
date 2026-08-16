import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { KnowledgeConfigService } from './knowledge-config.service';

/**
 * AI image generation service.
 * Calls an abstracted image generation API — provider/model/endpoint configured
 * via the ai_image config in KnowledgeConfigService.
 *
 * Supports: OpenRouter (DALL-E compatible), ComfyUI, or any
 * OpenAI-compatible image generation endpoint.
 */
@Injectable()
export class AiImageService {
  private readonly logger = new Logger(AiImageService.name);

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

        const status = error.response?.status || error.status;
        if (status && status >= 400 && status < 500 && status !== 429) {
          this.logger.error(`${context}: HTTP ${status} — ${error.message}`);
          throw new InternalServerErrorException(
            `Image API error (${context}): ${error.message}`,
          );
        }

        if (attempt < maxRetries) {
          const delay = Math.min(1000 * 2 ** (attempt - 1), 15_000);
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
      `Image API failed after ${maxRetries} retries (${context}): ${lastError?.message}`,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ── Provider resolution ─────────────────────────────────

  private async getProviderConfig(): Promise<{
    baseUrl: string;
    apiKey: string;
    model: string;
    width: number;
    height: number;
    headers: Record<string, string>;
  }> {
    const config = await this.configService.getAiImageConfig();
    const provider = (config.provider as string) || 'OpenRouter';
    const model = (config.model as string) || 'openai/dall-e-3';
    const width = (config.width as number) || 1024;
    const height = (config.height as number) || 1024;

    switch (provider.toLowerCase()) {
      case 'openrouter': {
        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) {
          throw new InternalServerErrorException(
            'OpenRouter API key not configured for image generation',
          );
        }
        return {
          baseUrl: 'https://openrouter.ai/api/v1/images/generations',
          apiKey,
          model,
          width,
          height,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'RealEstateManager-Knowledge',
            'Content-Type': 'application/json',
          },
        };
      }
      case 'comfyui': {
        const baseUrl =
          (config.baseUrl as string) ||
          process.env.COMFYUI_URL ||
          'http://127.0.0.1:8188';
        return {
          baseUrl: `${baseUrl.replace(/\/+$/, '')}/api/v1/image`,
          apiKey: '',
          model,
          width,
          height,
          headers: {
            'Content-Type': 'application/json',
          },
        };
      }
      default:
        throw new InternalServerErrorException(
          `Unknown image provider: ${provider}. Supported: OpenRouter, ComfyUI`,
        );
    }
  }

  // ── Core generation ─────────────────────────────────────

  /**
   * Build the image prompt from the template.
   */
  private buildPrompt(
    template: string,
    params: { title: string; contentSummary: string; style?: string },
  ): string {
    return template
      .replace(/\{\{title\}\}/g, params.title)
      .replace(/\{\{content_summary\}\}/g, params.contentSummary)
      .replace(/\{\{style\}\}/g, params.style || 'realistic');
  }

  /**
   * Generate featured image for an article.
   * Returns { imageUrl, buffer }.
   */
  async generateFeaturedImage(params: {
    title: string;
    contentSummary: string;
  }): Promise<{ imageUrl: string; buffer: Buffer }> {
    const config = await this.configService.getAiImageConfig();

    if (config.enabled === false) {
      this.logger.log('Image generation disabled, skipping featured image');
      return { imageUrl: '', buffer: Buffer.alloc(0) };
    }

    const promptTemplate =
      (config.promptTemplate as string) ||
      'Generate a professional real estate image for an article titled: {{title}}. Summary: {{content_summary}}';
    const style = (config.style as string) || 'realistic';

    const prompt = this.buildPrompt(promptTemplate, {
      title: params.title,
      contentSummary: params.contentSummary,
      style,
    });

    const providerConfig = await this.getProviderConfig();

    this.logger.log(
      `Generating featured image for: ${params.title.substring(0, 50)}...`,
    );

    const result = await this.withRetry(async () => {
      const response = await fetch(providerConfig.baseUrl, {
        method: 'POST',
        headers: providerConfig.headers,
        body: JSON.stringify({
          model: providerConfig.model,
          prompt,
          n: 1,
          size: `${providerConfig.width}x${providerConfig.height}`,
          response_format: 'url',
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `HTTP ${response.status}: ${errorBody.substring(0, 300)}`,
        );
      }

      return response.json();
    }, `generateFeaturedImage(${params.title.substring(0, 30)})`);

    // Extract image URL from response
    const imageData = result.data?.[0];
    const imageUrl = imageData?.url || imageData?.b64_json || '';

    if (!imageUrl) {
      throw new InternalServerErrorException(
        'Image API returned no image data',
      );
    }

    // Download image to buffer
    let buffer: Buffer;
    if (imageUrl.startsWith('data:') || imageUrl.startsWith('http')) {
      const imgResponse = await fetch(imageUrl);
      const arrayBuffer = await imgResponse.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } else {
      // Assume base64
      buffer = Buffer.from(imageUrl, 'base64');
    }

    this.logger.log(
      `Featured image generated: ${buffer.length} bytes for "${params.title.substring(0, 40)}"`,
    );

    return {
      imageUrl: imageData?.url || '',
      buffer,
    };
  }

  /**
   * Generate inline images for content sections.
   * Returns array of { imageUrl, buffer, forSection }.
   */
  async generateInlineImages(params: {
    sections: Array<{ heading: string; description: string }>;
  }): Promise<
    Array<{ imageUrl: string; buffer: Buffer; forSection: string }>
  > {
    const config = await this.configService.getAiImageConfig();

    if (config.enabled === false) {
      return [];
    }

    const results: Array<{
      imageUrl: string;
      buffer: Buffer;
      forSection: string;
    }> = [];

    for (const section of params.sections) {
      try {
        const prompt = `Generate a relevant image for a section titled "${section.heading}": ${section.description}`;

        const providerConfig = await this.getProviderConfig();

        const result = await this.withRetry(async () => {
          const response = await fetch(providerConfig.baseUrl, {
            method: 'POST',
            headers: providerConfig.headers,
            body: JSON.stringify({
              model: providerConfig.model,
              prompt,
              n: 1,
              size: `${providerConfig.width}x${providerConfig.height}`,
              response_format: 'url',
            }),
            signal: AbortSignal.timeout(60_000),
          });

          if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(
              `HTTP ${response.status}: ${errorBody.substring(0, 200)}`,
            );
          }

          return response.json();
        }, `generateInlineImage(${section.heading.substring(0, 30)})`);

        const imageData = result.data?.[0];
        const imageUrl = imageData?.url || '';

        if (imageUrl) {
          const imgResponse = await fetch(imageUrl);
          const arrayBuffer = await imgResponse.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          results.push({
            imageUrl,
            buffer,
            forSection: section.heading,
          });
        }
      } catch (error: any) {
        this.logger.warn(
          `Failed to generate inline image for "${section.heading}": ${error.message}`,
        );
        // Don't fail the whole batch — skip individual inline images
      }
    }

    this.logger.log(
      `Generated ${results.length}/${params.sections.length} inline images`,
    );

    return results;
  }
}
