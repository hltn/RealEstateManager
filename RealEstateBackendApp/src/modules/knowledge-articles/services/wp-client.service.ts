import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { KnowledgeConfigService } from './knowledge-config.service';
import axios, { AxiosInstance } from 'axios';

/**
 * WordPress REST API client.
 * Uses Application Passwords (Basic Auth) for authentication.
 * All external calls are abstracted — no hardcoded provider/endpoint.
 */
@Injectable()
export class WpClientService {
  private readonly logger = new Logger(WpClientService.name);
  private httpClient: AxiosInstance | null = null;
  private cachedSiteUrl: string | null = null;

  constructor(
    private readonly configService: KnowledgeConfigService,
  ) {}

  // ── HTTP Client Setup ───────────────────────────────────

  private async getClient(): Promise<AxiosInstance> {
    const config = await this.configService.getWpConfig();
    const siteUrl = config.siteUrl as string | undefined;
    const username = config.username as string | undefined;
    const appPassword = config.appPassword as string | undefined;

    if (!siteUrl || !username || !appPassword) {
      throw new InternalServerErrorException(
        'WordPress connection not configured. Please set siteUrl, username, and appPassword in WP config.',
      );
    }

    // Rebuild client if siteUrl changed
    if (!this.httpClient || this.cachedSiteUrl !== siteUrl) {
      const auth = Buffer.from(`${username}:${appPassword}`).toString('base64');
      this.httpClient = axios.create({
        baseURL: `${siteUrl.replace(/\/+$/, '')}/wp-json/wp/v2`,
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        timeout: 30_000,
      });
      this.cachedSiteUrl = siteUrl;
    }

    return this.httpClient;
  }

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
        const status = error.response?.status;

        // Do not retry on 4xx (except 429 rate limit)
        if (status && status >= 400 && status < 500 && status !== 429) {
          this.logger.error(
            `${context}: HTTP ${status} — ${error.message}`,
          );
          throw new InternalServerErrorException(
            `WP API error (${context}): ${error.response?.data?.message || error.message}`,
          );
        }

        // Rate limit: wait longer
        if (status === 429) {
          const retryAfter = parseInt(
            error.response?.headers?.['retry-after'] || '5',
            10,
          );
          this.logger.warn(
            `${context}: Rate limited, waiting ${retryAfter}s (attempt ${attempt}/${maxRetries})`,
          );
          await this.sleep(retryAfter * 1000);
          continue;
        }

        // Other errors (network, 5xx): exponential backoff
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * 2 ** (attempt - 1), 10_000);
          this.logger.warn(
            `${context}: Retry ${attempt}/${maxRetries} after ${delay}ms — ${error.message}`,
          );
          await this.sleep(delay);
          continue;
        }
      }
    }

    this.logger.error(
      `${context}: All ${maxRetries} retries exhausted`,
      lastError,
    );
    throw new InternalServerErrorException(
      `WP API failed after ${maxRetries} retries (${context}): ${lastError?.message}`,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ── Public API ──────────────────────────────────────────

  /**
   * Create a new WP post.
   * Returns { postId, postUrl }.
   */
  async createPost(post: {
    title: string;
    content: string;
    status: 'publish' | 'draft';
    categories: number[];
    tags: number[];
    featuredMedia?: number;
  }): Promise<{ postId: number; postUrl: string }> {
    const client = await this.getClient();
    const config = await this.configService.getWpConfig();
    const siteUrl = (config.siteUrl as string).replace(/\/+$/, '');

    const result = await this.withRetry(async () => {
      const response = await client.post('/posts', {
        title: post.title,
        content: post.content,
        status: post.status,
        categories: post.categories,
        tags: post.tags,
        ...(post.featuredMedia ? { featured_media: post.featuredMedia } : {}),
      });
      return response.data;
    }, `createPost(${post.title})`);

    this.logger.log(`WP post created: ${result.id} — ${post.title}`);

    return {
      postId: result.id,
      postUrl: result.link || `${siteUrl}/?p=${result.id}`,
    };
  }

  /**
   * Update an existing WP post.
   * Returns { postId, postUrl }.
   */
  async updatePost(
    postId: number,
    post: Partial<{
      title: string;
      content: string;
      categories: number[];
      tags: number[];
      featuredMedia: number;
    }>,
  ): Promise<{ postId: number; postUrl: string }> {
    const client = await this.getClient();
    const config = await this.configService.getWpConfig();
    const siteUrl = (config.siteUrl as string).replace(/\/+$/, '');

    const payload: Record<string, unknown> = {};
    if (post.title !== undefined) payload.title = post.title;
    if (post.content !== undefined) payload.content = post.content;
    if (post.categories !== undefined) payload.categories = post.categories;
    if (post.tags !== undefined) payload.tags = post.tags;
    if (post.featuredMedia !== undefined)
      payload.featured_media = post.featuredMedia;

    const result = await this.withRetry(async () => {
      const response = await client.post(`/posts/${postId}`, payload);
      return response.data;
    }, `updatePost(${postId})`);

    this.logger.log(`WP post updated: ${postId}`);

    return {
      postId: result.id,
      postUrl: result.link || `${siteUrl}/?p=${result.id}`,
    };
  }

  /**
   * Upload media to WordPress.
   * Returns { mediaId, mediaUrl }.
   */
  async uploadMedia(
    file: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<{ mediaId: number; mediaUrl: string }> {
    const client = await this.getClient();

    const result = await this.withRetry(async () => {
      const response = await client.post(
        '/media',
        file,
        {
          headers: {
            'Content-Type': mimeType,
            'Content-Disposition': `attachment; filename="${filename}"`,
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        },
      );
      return response.data;
    }, `uploadMedia(${filename})`);

    this.logger.log(`WP media uploaded: ${result.id} — ${filename}`);

    return {
      mediaId: result.id,
      mediaUrl: result.source_url,
    };
  }

  /**
   * Get all categories from WP.
   */
  async getCategories(): Promise<
    Array<{ id: number; name: string; slug: string }>
  > {
    const client = await this.getClient();

    const result = await this.withRetry(async () => {
      const response = await client.get('/categories', {
        params: { per_page: 100 },
      });
      return response.data;
    }, 'getCategories');

    return result.map((cat: any) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
    }));
  }

  /**
   * Get or create a tag by name. Returns tag ID.
   */
  async getOrCreateTag(name: string): Promise<number> {
    const client = await this.getClient();

    // First, search for existing tag
    const existing = await this.withRetry(async () => {
      const response = await client.get('/tags', {
        params: { search: name, per_page: 10 },
      });
      return response.data;
    }, `getOrCreateTag-search(${name})`);

    const match = existing.find(
      (tag: any) => tag.name.toLowerCase() === name.toLowerCase(),
    );
    if (match) {
      return match.id;
    }

    // Create new tag
    const created = await this.withRetry(async () => {
      const response = await client.post('/tags', { name });
      return response.data;
    }, `getOrCreateTag-create(${name})`);

    this.logger.log(`WP tag created: ${created.id} — ${name}`);
    return created.id;
  }

  /**
   * Verify WP connection (health check).
   */
  async verifyConnection(): Promise<{
    valid: boolean;
    siteName?: string;
    error?: string;
  }> {
    try {
      const client = await this.getClient();
      const response = await client.get('/');
      return {
        valid: true,
        siteName: response.data?.name,
      };
    } catch (error: any) {
      return {
        valid: false,
        error: error.message,
      };
    }
  }
}
