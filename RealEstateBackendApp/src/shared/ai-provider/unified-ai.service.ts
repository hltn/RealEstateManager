import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ExternalLogService,
  LogAiInput,
} from '../../modules/external-log/services/external-log.service';

/**
 * Resolved provider configuration — everything needed to make an AI API call.
 * Returned by resolveProvider() or resolveFromConfig().
 */
export interface AiProviderConfig {
  /** Human-readable provider name for logging (e.g. 'Must1c', '9Router'). */
  name: string;
  /** Full chat/completions URL. */
  url: string;
  /** API key. */
  apiKey: string;
  /** Model identifier. */
  model: string;
}

/**
 * Options for callChatCompletion() — provider config + metadata for logging.
 */
export interface CallAiOptions {
  /** Provider config (from resolveProvider or resolveFromConfig). */
  provider: AiProviderConfig;
  /** Label for ExternalLogService metadata (e.g. 'filterAndRank', 'generateContent'). */
  contextLabel: string;
  /** The full prompt text (system + user merged) for logging. */
  prompt: string;
  /** AbortSignal for timeout control. */
  signal: AbortSignal;
  /**
   * Default timeout in ms. Used by caller to create AbortController,
   * but we also support this as a convenience parameter.
   * Default: 300000 (5 minutes).
   */
  timeoutMs?: number;
}

// ── Default provider configs ──────────────────────────────
const MUST1C_DEFAULTS = {
  url: 'https://htmustc.id.vn/v1/chat/completions',
  model: 'gemini-3.6-flash',
};

const NINEROUTER_DEFAULTS = {
  baseUrl: 'http://127.0.0.1:20128/v1',
  model: 'google/gemini-3.6-flash',
};

// ── Error description map ─────────────────────────────────
const HTTP_ERROR_DESCRIPTIONS: Record<number, string> = {
  400: 'Invalid request or missing parameter (invalid_request_error)',
  401: 'Invalid API key (authentication_error)',
  402: 'Insufficient wallet balance (insufficient_quota)',
  403: 'Key lacks permission (permission_error)',
  429: 'Rate limit exceeded (rate_limit_error)',
  500: 'Internal gateway/upstream error (api_error)',
  502: 'Internal gateway/upstream error (api_error)',
};

/**
 * Unified AI service — single reusable entry point for all AI API calls.
 *
 * Provides:
 * 1. Provider resolution from env vars (for services using ConfigService)
 * 2. Provider resolution from external config (for services using DB config)
 * 3. Single `callChatCompletion()` method — the ONLY place that makes HTTP
 *    calls to AI providers, with built-in ExternalLogService integration.
 *
 * Supports ONLY: Must1c and 9Router providers.
 * All agentgw.cloud references have been removed.
 */
@Injectable()
export class UnifiedAiService {
  private readonly logger = new Logger(UnifiedAiService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly externalLogService: ExternalLogService,
  ) {}

  // ── Provider resolution ─────────────────────────────────

  /**
   * Resolve the active AI provider from environment variables / ConfigService.
   * Reads ACTIVE_AI_PLATFORM env to determine which provider to use.
   *
   * Supports only: 'Must1c', '9Router'.
   * Throws BadRequestException if active platform is not configured or
   * API key is missing.
   */
  resolveProvider(): AiProviderConfig {
    const activePlatform =
      this.configService.get<string>('ACTIVE_AI_PLATFORM') ||
      process.env.ACTIVE_AI_PLATFORM;

    if (!activePlatform) {
      throw new BadRequestException(
        'No AI platform configured. Set ACTIVE_AI_PLATFORM to "Must1c" or "9Router".',
      );
    }

    switch (activePlatform) {
      case 'Must1c':
        return this.resolveMust1c();
      case '9Router':
      case '9router':
        return this.resolve9Router();
      default:
        throw new BadRequestException(
          `Unsupported AI platform "${activePlatform}". Only "Must1c" and "9Router" are supported.`,
        );
    }
  }

  /**
   * Resolve provider from an external config object (DB-based config).
   * Used by services that read provider/model from MongoDB (e.g. AiWritingService).
   *
   * @param config.provider - Provider name: 'Must1c' or '9Router'
   * @param config.model - Model to use (optional, falls back to provider default)
   * @param config.baseUrl - Custom base URL (optional, for 9Router)
   */
  resolveFromConfig(config: {
    provider: string;
    model?: string;
    baseUrl?: string;
    apiKey?: string;
  }): AiProviderConfig {
    switch (config.provider?.toLowerCase()) {
      case 'must1c':
        return this.resolveMust1cFromConfig(config);
      case '9router':
        return this.resolve9RouterFromConfig(config);
      default:
        throw new BadRequestException(
          `Unsupported AI provider "${config.provider}". Only "Must1c" and "9Router" are supported.`,
        );
    }
  }

  // ── Private provider resolvers ───────────────────────────

  private resolveMust1c(): AiProviderConfig {
    const apiKey =
      this.configService.get<string>('MUST1C_API_KEY') ||
      process.env.MUST1C_API_KEY;
    if (!apiKey) {
      throw new BadRequestException(
        'Must1c API key not configured. Set MUST1C_API_KEY environment variable.',
      );
    }
    const url =
      this.configService.get<string>('MUST1C_API_URL') ||
      process.env.MUST1C_API_URL ||
      MUST1C_DEFAULTS.url;
    const model =
      this.configService.get<string>('MUST1C_MODEL') ||
      process.env.MUST1C_MODEL ||
      MUST1C_DEFAULTS.model;
    return { name: 'Must1c', url, apiKey, model };
  }

  private resolveMust1cFromConfig(config: {
    model?: string;
    apiKey?: string;
  }): AiProviderConfig {
    const apiKey =
      config.apiKey ||
      this.configService.get<string>('MUST1C_API_KEY') ||
      process.env.MUST1C_API_KEY;
    if (!apiKey) {
      throw new BadRequestException(
        'Must1c API key not configured. Set MUST1C_API_KEY environment variable.',
      );
    }
    return {
      name: 'Must1c',
      url:
        this.configService.get<string>('MUST1C_API_URL') ||
        process.env.MUST1C_API_URL ||
        MUST1C_DEFAULTS.url,
      apiKey,
      model:
        config.model ||
        this.configService.get<string>('MUST1C_MODEL') ||
        process.env.MUST1C_MODEL ||
        MUST1C_DEFAULTS.model,
    };
  }

  private resolve9Router(): AiProviderConfig {
    const apiKey =
      this.configService.get<string>('NINEROUTER_API_KEY') ||
      process.env.NINEROUTER_API_KEY;
    if (!apiKey) {
      throw new BadRequestException(
        '9Router API key not configured. Set NINEROUTER_API_KEY environment variable.',
      );
    }
    const baseUrl =
      this.configService.get<string>('NINEROUTER_BASE_URL') ||
      process.env.NINEROUTER_BASE_URL ||
      NINEROUTER_DEFAULTS.baseUrl;
    const model =
      this.configService.get<string>('NINEROUTER_MODEL') ||
      process.env.NINEROUTER_MODEL ||
      NINEROUTER_DEFAULTS.model;
    return {
      name: '9Router',
      url: `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
      apiKey,
      model,
    };
  }

  private resolve9RouterFromConfig(config: {
    model?: string;
    baseUrl?: string;
    apiKey?: string;
  }): AiProviderConfig {
    const apiKey =
      config.apiKey ||
      this.configService.get<string>('NINEROUTER_API_KEY') ||
      process.env.NINEROUTER_API_KEY;
    if (!apiKey) {
      throw new BadRequestException(
        '9Router API key not configured. Set NINEROUTER_API_KEY environment variable.',
      );
    }
    const baseUrl =
      config.baseUrl ||
      this.configService.get<string>('NINEROUTER_BASE_URL') ||
      process.env.NINEROUTER_BASE_URL ||
      NINEROUTER_DEFAULTS.baseUrl;
    return {
      name: '9Router',
      url: `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
      apiKey,
      model:
        config.model ||
        this.configService.get<string>('NINEROUTER_MODEL') ||
        process.env.NINEROUTER_MODEL ||
        NINEROUTER_DEFAULTS.model,
    };
  }

  // ── Error classification ────────────────────────────────

  /**
   * Map HTTP status code to a human-readable error description.
   * Used for structured error messages in callers.
   */
  httpErrorDescription(status: number): string {
    return (
      HTTP_ERROR_DESCRIPTIONS[status] || `Unexpected error (HTTP ${status})`
    );
  }

  // ── Core method ─────────────────────────────────────────

  /**
   * Single reusable method for all AI chat completion calls.
   *
   * This is the ONLY place in the application that makes HTTP requests to
   * AI providers. It handles:
   * - Request construction and execution
   - ExternalLogService integration (fire-and-forget logging)
   * - Response body cloning for logging
   * - Error classification and logging
   *
   * Returns the raw Response — callers are responsible for parsing the
   * response body (res.json() / res.text()) and error handling.
   *
   * @param payload - Standard chat completion payload (model + messages).
   * @param options - Provider config, context label, prompt, and signal.
   * @returns Raw fetch Response.
   */
  async callChatCompletion(
    payload: {
      model: string;
      messages: Array<{ role: string; content: string }>;
    },
    options: CallAiOptions,
  ): Promise<Response> {
    const { provider, contextLabel, prompt, signal } = options;
    const startTime = Date.now();

    const requestBody = {
      model: payload.model,
      messages: payload.messages,
      stream: false,
    };

    const headers = {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    };

    try {
      const res = await fetch(provider.url, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify(requestBody),
      });

      // Clone body for logging — caller still reads res normally.
      let responseBody: any;
      let usage: any;
      const rawBody = await res.clone().text();

      if (res.ok) {
        try {
          const parsed = JSON.parse(rawBody);
          usage = parsed.usage;
          responseBody = parsed;
        } catch {
          responseBody = rawBody;
        }
      } else {
        responseBody = rawBody;
      }

      this.externalLogService.logAi({
        provider: provider.name,
        model: payload.model,
        url: provider.url,
        method: 'POST',
        statusCode: res.status,
        durationMs: Date.now() - startTime,
        prompt,
        requestHeaders: headers,
        requestBody,
        responseHeaders: this.headersToRecord(res.headers),
        responseBody,
        usage,
        metadata: { contextLabel },
      });

      return res;
    } catch (err: any) {
      const isAbort = err.name === 'AbortError';
      this.externalLogService.logAi({
        provider: provider.name,
        model: payload.model,
        url: provider.url,
        method: 'POST',
        durationMs: Date.now() - startTime,
        prompt,
        requestHeaders: headers,
        requestBody,
        error: {
          message: isAbort
            ? `AI API request timed out after ${((Date.now() - startTime) / 1000).toFixed(0)} seconds`
            : err.message,
          code: isAbort ? 'AbortError' : err.code ?? err.name,
          stack: err.stack,
        },
        metadata: { contextLabel },
      });
      throw err;
    }
  }

  // ── Utility ─────────────────────────────────────────────

  /** Convert fetch Headers to a plain Record for logging. */
  private headersToRecord(headers: Headers): Record<string, any> {
    const record: Record<string, any> = {};
    headers.forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }
}
