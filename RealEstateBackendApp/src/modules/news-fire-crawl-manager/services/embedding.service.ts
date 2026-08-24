import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Max characters for embedding input (~120-150 tokens) */
const EMBEDDING_INPUT_MAX_LENGTH = 500;

const OPENROUTER_EMBEDDINGS_URL = 'https://openrouter.ai/api/v1/embeddings';
const DEFAULT_EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const DEFAULT_EMBEDDING_DIMENSIONS = 512;

interface OpenRouterEmbeddingResponse {
  data: { embedding: number[] }[];
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly dimensions: number;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('OPENROUTER_API_KEY', '');
    this.model =
      this.configService.get<string>(
        'EMBEDDING_MODEL',
        DEFAULT_EMBEDDING_MODEL,
      );
    this.dimensions = Number(
      this.configService.get<number>(
        'EMBEDDING_DIMENSIONS',
        DEFAULT_EMBEDDING_DIMENSIONS,
      ),
    );

    if (!this.apiKey) {
      this.logger.warn(
        'OPENROUTER_API_KEY is not set — embedding calls will fail',
      );
    }
  }

  /**
   * Generate embedding vector for a single text.
   * Calls OpenRouter API (OpenAI-compatible) with text-embedding-3-small.
   * Returns a number[] of configured dimensions (default 512).
   */
  async createEmbedding(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new Error('Cannot create embedding for empty text');
    }

    const response = await fetch(OPENROUTER_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
        dimensions: this.dimensions,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Embedding API error (${response.status}): ${errorBody}`,
      );
    }

    const data: OpenRouterEmbeddingResponse = await response.json();

    if (!data.data?.[0]?.embedding) {
      throw new Error('Embedding API returned no embedding data');
    }

    return data.data[0].embedding;
  }

  /**
   * Generate embedding vectors for multiple texts in a single API call.
   * OpenAI embeddings API supports array input for batch processing.
   */
  async createEmbeddingBatch(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) {
      return [];
    }

    const nonEmptyTexts = texts.filter((t) => t && t.trim().length > 0);
    if (nonEmptyTexts.length === 0) {
      throw new Error('All texts are empty — cannot create embeddings');
    }

    const response = await fetch(OPENROUTER_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: nonEmptyTexts,
        dimensions: this.dimensions,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Embedding API error (${response.status}): ${errorBody}`,
      );
    }

    const data: OpenRouterEmbeddingResponse = await response.json();

    if (!data.data || data.data.length === 0) {
      throw new Error('Embedding API returned no embedding data');
    }

    return data.data.map((d) => d.embedding);
  }

  /**
   * Prepare input text for embedding.
   * Combines title + summary/description, limited to 500 chars.
   * Priority: summary > description > content (first 300 chars) > empty string.
   */
  prepareEmbeddingInput(article: {
    title: string;
    summary?: string;
    description?: string;
    content?: string;
  }): string {
    const secondary =
      article.summary ||
      article.description ||
      article.content?.substring(0, 300) ||
      '';

    const input = `${article.title}. ${secondary}`.trim();
    return input.substring(0, EMBEDDING_INPUT_MAX_LENGTH);
  }

  /** The model name used for embedding (for display/storage) */
  getEmbeddingModelName(): string {
    return this.model;
  }

  /** The configured vector dimensions */
  getEmbeddingDimensions(): number {
    return this.dimensions;
  }
}
