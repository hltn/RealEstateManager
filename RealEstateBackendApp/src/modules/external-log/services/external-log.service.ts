import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { PaginatedResult } from '../../../common/dto/paginated-response.dto';
import { normalizePagination } from '../../../common/utils/pagination.util';
import { QueryExternalLogDto } from '../dtos/query-external-log.dto';
import {
  ExternalRequestLog,
  ExternalRequestType,
  TokenUsage,
} from '../schemas/external-request-log.schema';
import { ExternalLogSanitizerService } from './external-log-sanitizer.service';

/** Input cho logCrawl() — contract §8.3 spec. */
export interface LogCrawlInput {
  /** Tên trang báo (VD: 'VnExpress', 'Batdongsan.com.vn'). */
  targetService: string;
  url: string;
  method: string;
  statusCode?: number;
  durationMs: number;
  requestHeaders?: Record<string, any>;
  requestQuery?: Record<string, any>;
  requestParams?: Record<string, any>;
  requestBody?: any;
  responseHeaders?: Record<string, any>;
  responseBody?: any;
  error?: { message?: string; code?: string; stack?: string };
  metadata?: Record<string, any>;
  /** Mặc định 'CustomCrawlerService'. */
  sourceModule?: string;
}

/** Input cho logAi() — contract §8.3 spec. */
export interface LogAiInput {
  /** Tên AI provider: 'OpenRouter' | 'Must1c'. */
  provider: string;
  /** → metadata.model. */
  model?: string;
  url: string;
  method: string;
  statusCode?: number;
  durationMs: number;
  /** Prompt đầy đủ (system + content đã ghép) → request.prompt. */
  prompt: string;
  requestHeaders?: Record<string, any>;
  requestQuery?: Record<string, any>;
  requestParams?: Record<string, any>;
  /** Payload chat/completions gửi đi. */
  requestBody?: any;
  responseHeaders?: Record<string, any>;
  responseBody?: any;
  /** Token usage (đã map snake_case → camelCase ở caller, hoặc để service tự map phòng thủ). */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; code?: string; stack?: string };
  metadata?: Record<string, any>;
  /** Mặc định 'AIFilterService'. */
  sourceModule?: string;
}

/**
 * Core logger cho mọi outgoing request (crawl + AI).
 * - Fire-and-forget (§12): KHÔNG await, KHÔNG re-throw — lỗi ghi log chỉ ghi vào
 *   Logger, không bao giờ làm hỏng operation chính (crawl/AI vẫn chạy tiếp).
 * - Thứ tự xử lý (§5.6): sanitize → map usage snake_case→camelCase → truncate → create.
 * - ENABLE_EXTERNAL_LOGGING=false → early return trước cả sanitize.
 * - Sanitizer lỗi → fallback log raw kèm cảnh báo (ưu tiên có log hơn là mất log).
 */
@Injectable()
export class ExternalLogService {
  private readonly logger = new Logger(ExternalLogService.name);
  private readonly enabled: boolean;
  private readonly maxLogBodyBytes: number;

  constructor(
    @InjectModel(ExternalRequestLog.name)
    private readonly externalRequestLogModel: Model<ExternalRequestLog>,
    private readonly configService: ConfigService,
    private readonly sanitizerService: ExternalLogSanitizerService,
  ) {
    // Env §11: ENABLE_EXTERNAL_LOGGING (default true), MAX_LOG_BODY_BYTES (default 51200).
    this.enabled =
      (this.configService.get<string>('ENABLE_EXTERNAL_LOGGING') ?? 'true') !==
      'false';
    const maxBytes = Number.parseInt(
      this.configService.get<string>('MAX_LOG_BODY_BYTES') ?? '',
      10,
    );
    this.maxLogBodyBytes =
      Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : 51200;
  }

  /** Ghi log crawl — gọi từ choke point crawl (CustomCrawlerService.fetchWithAntiBotBypass). */
  logCrawl(input: LogCrawlInput): void {
    if (!this.enabled) return;

    let doc: Record<string, any>;
    try {
      doc = {
        type: ExternalRequestType.CRAWL_OUTGOING,
        targetService: input.targetService,
        method: input.method,
        url: this.sanitizerService.sanitizeUrl(input.url),
        statusCode: input.statusCode,
        durationMs: input.durationMs,
        request: {
          headers: this.sanitizerService.sanitizeHeaders(
            input.requestHeaders ?? {},
          ),
          query: this.sanitizerService.sanitizeValue(input.requestQuery ?? {}),
          params: this.sanitizerService.sanitizeValue(
            input.requestParams ?? {},
          ),
          body: this.truncate(
            this.sanitizerService.sanitizeValue(input.requestBody ?? null),
          ),
          prompt: '', // crawl không phải AI
        },
        response:
          input.responseBody !== undefined ||
          input.responseHeaders !== undefined
            ? {
                headers: this.sanitizerService.sanitizeHeaders(
                  input.responseHeaders ?? {},
                ),
                body: this.truncate(
                  this.sanitizerService.sanitizeValue(
                    input.responseBody ?? null,
                  ),
                ),
                // Crawl không dùng token — để 0 theo đúng shape §13.1.
                usage: this.zeroUsage(),
              }
            : undefined,
        error: this.buildErrorInfo(input.error),
        sourceModule: input.sourceModule ?? 'CustomCrawlerService',
        metadata: this.sanitizerService.sanitizeValue(input.metadata ?? {}),
      };
    } catch (sanitizeError: any) {
      // §12: sanitize fail → log raw kèm cảnh báo thay vì mất log.
      this.logger.warn(
        `Sanitize crawl log thất bại — fallback log raw: ${sanitizeError.message}`,
        sanitizeError.stack,
      );
      doc = {
        type: ExternalRequestType.CRAWL_OUTGOING,
        targetService: input.targetService,
        method: input.method,
        url: input.url,
        statusCode: input.statusCode,
        durationMs: input.durationMs,
        request: { headers: {}, query: {}, params: {}, body: null, prompt: '' },
        sourceModule: input.sourceModule ?? 'CustomCrawlerService',
        metadata: {
          sanitizeError: sanitizeError.message,
          ...input.metadata,
        },
      };
    }

    this.fireAndForget(doc);
  }

  /** Ghi log AI — gọi từ choke point AI (AIFilterService.callChatCompletion). */
  logAi(input: LogAiInput): void {
    if (!this.enabled) return;

    let doc: Record<string, any>;
    try {
      const usage = this.mapUsage(input.usage);
      doc = {
        type: ExternalRequestType.AI_OUTGOING,
        targetService: input.provider,
        method: input.method,
        url: this.sanitizerService.sanitizeUrl(input.url),
        statusCode: input.statusCode,
        durationMs: input.durationMs,
        request: {
          headers: this.sanitizerService.sanitizeHeaders(
            input.requestHeaders ?? {},
          ),
          query: this.sanitizerService.sanitizeValue(input.requestQuery ?? {}),
          params: this.sanitizerService.sanitizeValue(
            input.requestParams ?? {},
          ),
          body: this.truncate(
            this.sanitizerService.sanitizeValue(input.requestBody ?? null),
          ),
          prompt: this.truncateString(
            this.sanitizerService.sanitizeValue(input.prompt ?? ''),
          ),
        },
        response: {
          headers: this.sanitizerService.sanitizeHeaders(
            input.responseHeaders ?? {},
          ),
          body: this.truncate(
            this.sanitizerService.sanitizeValue(input.responseBody ?? null),
          ),
          // Provider không trả usage → để 0 (§9.2).
          usage: usage ?? this.zeroUsage(),
        },
        error: this.buildErrorInfo(input.error),
        sourceModule: input.sourceModule ?? 'AIFilterService',
        metadata: this.sanitizerService.sanitizeValue({
          ...(input.model ? { model: input.model } : {}),
          ...(input.metadata ?? {}),
        }),
      };
    } catch (sanitizeError: any) {
      // §12: sanitize fail → log raw kèm cảnh báo thay vì mất log.
      this.logger.warn(
        `Sanitize AI log thất bại — fallback log raw: ${sanitizeError.message}`,
        sanitizeError.stack,
      );
      doc = {
        type: ExternalRequestType.AI_OUTGOING,
        targetService: input.provider,
        method: input.method,
        url: input.url,
        statusCode: input.statusCode,
        durationMs: input.durationMs,
        request: { headers: {}, query: {}, params: {}, body: null, prompt: '' },
        sourceModule: input.sourceModule ?? 'AIFilterService',
        metadata: {
          sanitizeError: sanitizeError.message,
          ...(input.model ? { model: input.model } : {}),
          ...input.metadata,
        },
      };
    }

    this.fireAndForget(doc);
  }

  /** Query cho Admin API (§10) — trả PaginatedResult<ExternalRequestLog>. */
  async findAll(
    filter: QueryExternalLogDto,
  ): Promise<PaginatedResult<ExternalRequestLog>> {
    const query: Record<string, any> = {};

    if (filter.type) query.type = filter.type;
    if (filter.targetService) query.targetService = filter.targetService;
    if (filter.statusCode) query.statusCode = filter.statusCode;

    if (filter.startDate || filter.endDate) {
      query.createdAt = {};
      if (filter.startDate) query.createdAt.$gte = new Date(filter.startDate);
      if (filter.endDate) query.createdAt.$lte = new Date(filter.endDate);
    }

    const sortObj: Record<string, 1 | -1> =
      filter.sort === 'oldest' ? { createdAt: 1 } : { createdAt: -1 };
    const { skip, limit } = normalizePagination(filter.page, filter.limit);

    const [data, total] = await Promise.all([
      this.externalRequestLogModel
        .find(query)
        .sort(sortObj)
        .skip(skip)
        .limit(limit)
        .exec(),
      this.externalRequestLogModel.countDocuments(query).exec(),
    ]);

    return { data, total };
  }

  /** Lấy log theo id — id không hợp lệ → 400, không tìm thấy → 404 (§10.2). */
  async findById(id: string): Promise<ExternalRequestLog> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid external log ID: ${id}`);
    }
    const log = await this.externalRequestLogModel.findById(id).exec();
    if (!log) {
      throw new NotFoundException(`External log with ID ${id} not found`);
    }
    return log;
  }

  /**
   * Fire-and-forget (§12): KHÔNG await, KHÔNG re-throw.
   * Lỗi ghi log chỉ ghi vào Logger — operation chính không bao giờ bị ảnh hưởng.
   */
  private fireAndForget(doc: Record<string, any>): void {
    void this.externalRequestLogModel
      .create(doc)
      .catch((err) =>
        this.logger.error(
          `Ghi external log thất bại: ${err.message}`,
          err.stack,
        ),
      );
  }

  /** Map usage snake_case → camelCase (OpenAI-compatible provider trả prompt_tokens/...). */
  private mapUsage(usage: LogAiInput['usage']): TokenUsage | undefined {
    if (!usage) return undefined;
    return {
      promptTokens: usage.promptTokens ?? usage.prompt_tokens ?? 0,
      completionTokens: usage.completionTokens ?? usage.completion_tokens ?? 0,
      totalTokens: usage.totalTokens ?? usage.total_tokens ?? 0,
    };
  }

  private buildErrorInfo(error?: {
    message?: string;
    code?: string;
    stack?: string;
  }): { message?: string; code?: string; stack?: string } | undefined {
    if (!error) return undefined;
    return {
      message: this.sanitizerService.sanitizeValue(error.message),
      code: error.code,
      stack: error.stack ? this.truncateString(error.stack) : undefined,
    };
  }

  private zeroUsage(): TokenUsage {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }

  private truncate(value: any): any {
    return this.sanitizerService.truncateBody(value, this.maxLogBodyBytes);
  }

  private truncateString(value: string): string {
    return this.sanitizerService.truncateString(value, this.maxLogBodyBytes);
  }
}
