import {
  Injectable,
  Logger,
  InternalServerErrorException,
  OnModuleInit,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { KnowledgeConfigService } from './knowledge-config.service';
import { PipelineService } from './pipeline.service';

const NL_TO_CRON_PROMPT = `You are a cron expression parser. Convert the user's natural language schedule description into a standard Unix cron expression.

Rules:
- Default timezone: Asia/Ho_Chi_Minh (UTC+7)
- If no time specified, default to 08:00
- "hàng ngày" = every day
- "ngày làm việc" / "thứ 2 đến thứ 6" = Mon-Fri
- "mỗi tuần" = once a week
- "mỗi tháng" = once a month
- Support Vietnamese and English input

Return ONLY a JSON object:
{
  "cron": "<cron expression (5 fields)>",
  "explanation": "<human-readable explanation in Vietnamese>",
  "schedule": {
    "frequency": "daily|weekdays|weekly|monthly",
    "time": "HH:MM",
    "timezone": "Asia/Ho_Chi_Minh"
  },
  "articlesPerBatch": <number, default 3>,
  "categories": ["<optional category names if mentioned>"]
}`;

/**
 * Natural language -> Cron expression service.
 * Uses AI to parse Vietnamese/English schedule descriptions,
 * then registers the cron job with SchedulerRegistry.
 *
 * Features:
 * - AI-powered NL -> cron parsing with config validation
 * - Preview output for user confirmation before activation
 * - Track lastRunAt and nextRunAt
 * - Auto-restore cron schedule on module init
 * - Concurrent run prevention via PipelineService lock
 */
@Injectable()
export class NlCronService implements OnModuleInit {
  private readonly logger = new Logger(NlCronService.name);
  private static readonly CRON_JOB_NAME = 'knowledge_articles_daily';
  /**
   * C-02: all cron expressions are authored in Vietnam local time (ICT, UTC+7),
   * so the CronJob is registered with this IANA timezone. Without it, `cron`
   * uses the server's local timezone and jobs fire up to 7h off.
   */
  private static readonly CRON_TIMEZONE = 'Asia/Ho_Chi_Minh';

  constructor(
    private readonly knowledgeConfigService: KnowledgeConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly pipelineService: PipelineService,
  ) {}

  /**
   * On module init, restore cron schedule from config if active.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.initFromConfig();
    } catch (error: any) {
      this.logger.warn(
        `Failed to restore cron schedule on init: ${error.message}`,
      );
    }
  }

  // ── NL -> Cron Parsing ───────────────────────────────────

  /**
   * Parse natural language description to cron expression via AI.
   * Returns cron expression, explanation, schedule details, and optional
   * articlesPerBatch and categories extracted from the NL input.
   */
  async parseDescription(description: string): Promise<{
    cronExpression: string;
    explanation: string;
    schedule: {
      frequency: string;
      time: string;
      timezone: string;
    };
    articlesPerBatch: number;
    categories: string[];
  }> {
    // Build the request — uses same provider as AI writing
    const config =
      await this.knowledgeConfigService.getAiWritingConfig();
    const provider = (config.provider as string) || 'OpenRouter';
    const model = (config.model as string) || 'google/gemini-2.5-flash';

    let baseUrl: string;
    let apiKey: string;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    switch (provider.toLowerCase()) {
      case 'openrouter':
        baseUrl = 'https://openrouter.ai/api/v1/chat/completions';
        apiKey = process.env.OPENROUTER_API_KEY || '';
        headers['Authorization'] = `Bearer ${apiKey}`;
        headers['HTTP-Referer'] = 'http://localhost:3000';
        headers['X-Title'] = 'RealEstateManager-Knowledge';
        break;
      case 'must1c':
        baseUrl = 'https://api.must1c.com/v1/chat/completions';
        apiKey = process.env.MUST1C_API_KEY || '';
        headers['Authorization'] = `Bearer ${apiKey}`;
        break;
      case '9router': {
        const base =
          (config.nineRouterBaseUrl as string) ||
          process.env.NINEROUTER_BASE_URL ||
          'http://127.0.0.1:20128/v1';
        baseUrl = `${base.replace(/\/+$/, '')}/chat/completions`;
        apiKey = process.env.NINEROUTER_API_KEY || '';
        headers['Authorization'] = `Bearer ${apiKey}`;
        break;
      }
      default:
        throw new InternalServerErrorException(
          `Unknown AI provider: ${provider}`,
        );
    }

    if (!apiKey) {
      throw new InternalServerErrorException(
        'AI API key not configured for NL -> cron parsing',
      );
    }

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: NL_TO_CRON_PROMPT },
          { role: 'user', content: description },
        ],
        max_tokens: 512,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(
        `AI API error (NL parse): HTTP ${response.status} — ${errorBody.substring(0, 200)}`,
      );
    }

    const result = await response.json();
    const rawContent = result.choices?.[0]?.message?.content;

    if (!rawContent) {
      throw new InternalServerErrorException('AI returned empty NL parse response');
    }

    try {
      const parsed = JSON.parse(rawContent);

      // Validate the parsed cron expression
      this.validateCronExpression(parsed.cron);

      this.logger.log(
        `NL parsed: "${description}" -> cron: ${parsed.cron}`,
      );
      return {
        cronExpression: parsed.cron,
        explanation: parsed.explanation,
        schedule: parsed.schedule,
        articlesPerBatch: parsed.articlesPerBatch || 3,
        categories: parsed.categories || [],
      };
    } catch (error: any) {
      throw new InternalServerErrorException(
        `Failed to parse AI response as JSON: ${error.message}`,
      );
    }
  }

  // ── Schedule Preview ────────────────────────────────────

  /**
   * Preview next N execution times from a cron expression.
   * Uses the cron-parser library pattern (manual calculation).
   */
  previewSchedule(
    cronExpression: string,
    count = 5,
  ): { nextRuns: string[] } {
    try {
      // Validate before previewing
      this.validateCronExpression(cronExpression);

      const nextRuns = this.calculateNextRuns(cronExpression, count);
      return { nextRuns };
    } catch (error: any) {
      throw new InternalServerErrorException(
        `Invalid cron expression: ${error.message}`,
      );
    }
  }

  /**
   * Validate a cron expression format.
   * Throws if invalid.
   */
  private validateCronExpression(expression: string): void {
    if (!expression || typeof expression !== 'string') {
      throw new Error('Cron expression is required');
    }

    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(
        `Expected 5 fields, got ${parts.length}: "${expression}"`,
      );
    }

    // Validate each field has valid characters
    const validCronRegex = /^[\d\*\/\,\-]+$/;
    for (const part of parts) {
      if (!validCronRegex.test(part)) {
        throw new Error(`Invalid cron field: "${part}"`);
      }
    }

    // Validate ranges
    const [minute, hour, , , dow] = parts;

    // Validate minute range (0-59)
    const minuteParts = minute.split(',');
    for (const part of minuteParts) {
      const rangeMatch = part.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        if (start < 0 || start > 59 || end < 0 || end > 59) {
          throw new Error(`Minute out of range: ${part}`);
        }
      } else if (part !== '*' && !part.startsWith('*/')) {
        const minuteVal = parseInt(part.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(minuteVal) && (minuteVal < 0 || minuteVal > 59)) {
          throw new Error(`Minute out of range: ${minuteVal}`);
        }
      }
    }

    // Validate hour range (0-23)
    const hourParts = hour.split(',');
    for (const part of hourParts) {
      const rangeMatch = part.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        if (start < 0 || start > 23 || end < 0 || end > 23) {
          throw new Error(`Hour out of range: ${part}`);
        }
      } else if (part !== '*' && !part.startsWith('*/')) {
        const hourVal = parseInt(part.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(hourVal) && (hourVal < 0 || hourVal > 23)) {
          throw new Error(`Hour out of range: ${hourVal}`);
        }
      }
    }

    // Validate DOW range (0-6 or 7 for Sunday)
    const dowParts = dow.split(',');
    for (const part of dowParts) {
      const rangeMatch = part.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        if (start < 0 || start > 7 || end < 0 || end > 7) {
          throw new Error(`Day of week out of range: ${part}`);
        }
      } else if (part !== '*') {
        const dowVal = parseInt(part.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(dowVal) && (dowVal < 0 || dowVal > 7)) {
          throw new Error(`Day of week out of range: ${dowVal}`);
        }
      }
    }
  }

  /**
   * Calculate next N run times from a cron expression.
   * C-02: interprets the cron fields in Asia/Ho_Chi_Minh (ICT, UTC+7).
   */
  private calculateNextRuns(cronExpression: string, count: number): string[] {
    const parts = cronExpression.trim().split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(
        `Expected 5 fields, got ${parts.length}: "${cronExpression}"`,
      );
    }

    const [minuteField, hourField, , , dayOfWeekField] = parts;

    const now = new Date();
    const runs: string[] = [];
    const maxIterations = 366 * 24 * 60; // Safety limit

    let cursor = new Date(now);
    cursor.setSeconds(0);
    cursor.setMilliseconds(0);
    cursor.setMinutes(cursor.getMinutes() + 1); // Start from next minute

    for (let i = 0; i < maxIterations && runs.length < count; i++) {
      if (this.matchesCron(cursor, minuteField, hourField, dayOfWeekField)) {
        runs.push(cursor.toISOString());
      }
      cursor.setMinutes(cursor.getMinutes() + 1);
    }

    return runs;
  }

  /**
   * C-02: matches cron fields against ICT (Asia/Ho_Chi_Minh, UTC+7) local time,
   * not server-local or UTC. This ensures previewSchedule output aligns with the
   * registered CronJob which also runs on ICT via its timezone parameter.
   */
  private matchesCron(
    date: Date,
    minuteField: string,
    hourField: string,
    dowField: string,
  ): boolean {
    // Convert to ICT (UTC+7) for field matching
    const ictDate = new Date(date.getTime() + 7 * 60 * 60 * 1000);
    const minute = ictDate.getUTCMinutes();
    const hour = ictDate.getUTCHours();
    const dow = ictDate.getUTCDay(); // 0=Sun

    if (!this.matchesField(minuteField, minute, 0, 59)) return false;
    if (!this.matchesField(hourField, hour, 0, 23)) return false;
    if (!this.matchesField(dowField, dow, 0, 6)) return false;

    return true;
  }

  private matchesField(
    field: string,
    value: number,
    min: number,
    max: number,
  ): boolean {
    if (field === '*') return true;

    // Handle ranges: 1-5
    const rangeMatch = field.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      return value >= parseInt(rangeMatch[1]) && value <= parseInt(rangeMatch[2]);
    }

    // Handle step: */2 or 1-5/2
    const stepMatch = field.match(/^(.+)\/(\d+)$/);
    if (stepMatch) {
      const step = parseInt(stepMatch[2]);
      if (stepMatch[1] === '*') {
        return (value - min) % step === 0;
      }
      const rangeParts = stepMatch[1].match(/^(\d+)-(\d+)$/);
      if (rangeParts) {
        const rangeMin = parseInt(rangeParts[1]);
        const rangeMax = parseInt(rangeParts[2]);
        return (
          value >= rangeMin &&
          value <= rangeMax &&
          (value - rangeMin) % step === 0
        );
      }
    }

    // Handle comma-separated: 1,3,5
    const values = field.split(',').map((v) => parseInt(v.trim()));
    return values.includes(value);
  }

  // ── Activate / Deactivate ───────────────────────────────

  /**
   * Save schedule to config and register cron job with SchedulerRegistry.
   * Validates the cron expression before activating.
   */
  async activateSchedule(
    cronExpression: string,
    nlDescription: string,
  ): Promise<{
    message: string;
    nextRuns: string[];
  }> {
    // Validate cron expression
    this.validateCronExpression(cronExpression);

    // Preview next runs
    const preview = this.previewSchedule(cronExpression, 5);

    // Save to config
    await this.knowledgeConfigService.updateCronConfig({
      isActive: true,
      frequency: cronExpression,
      nlDescription,
      parsedCron: cronExpression,
      lastRunAt: null,
      nextRunAt: preview.nextRuns[0] || null,
    });

    // Remove existing cron job if any
    this.removeCronJob();

    // Register new cron job
    this.registerCronJob(cronExpression);

    this.logger.log(`Cron schedule activated: ${cronExpression}`);
    return {
      message: 'Cron schedule activated successfully',
      nextRuns: preview.nextRuns,
    };
  }

  /**
   * Deactivate the cron schedule.
   */
  async deactivateSchedule(): Promise<void> {
    this.removeCronJob();

    await this.knowledgeConfigService.updateCronConfig({
      isActive: false,
    });

    this.logger.log('Cron schedule deactivated');
  }

  /**
   * Get current schedule status including last run and next run.
   */
  async getScheduleStatus(): Promise<{
    isActive: boolean;
    cronExpression: string | null;
    nlDescription: string | null;
    lastRunAt: string | null;
    nextRunAt: string | null;
    isRunning: boolean;
  }> {
    const config = await this.knowledgeConfigService.getCronConfig();
    return {
      isActive: (config.isActive as boolean) || false,
      cronExpression: (config.parsedCron as string) || null,
      nlDescription: (config.nlDescription as string) || null,
      lastRunAt: (config.lastRunAt as string) || null,
      nextRunAt: (config.nextRunAt as string) || null,
      isRunning: this.pipelineService.isPipelineRunning(),
    };
  }

  private registerCronJob(cronExpression: string): void {
    // C-02: pass ICT timezone so the CronJob fires at Vietnam local time,
    // matching the previewSchedule output which also interprets fields in ICT.
    const job = new CronJob(
      cronExpression,
      async () => {
        this.logger.log('Cron triggered — starting pipeline...');

        // Update lastRunAt
        const now = new Date().toISOString();
        const preview = this.previewSchedule(cronExpression, 1);

        await this.knowledgeConfigService.updateCronConfig({
          lastRunAt: now,
          nextRunAt: preview.nextRuns[0] || null,
        });

        try {
          await this.pipelineService.startPipeline({ source: 'cron' });
        } catch (error: any) {
          this.logger.error(`Cron pipeline failed: ${error.message}`, error);
        }
      },
      undefined, // onComplete
      false,     // start (we call .start() below)
      NlCronService.CRON_TIMEZONE,
    );

    this.schedulerRegistry.addCronJob(
      NlCronService.CRON_JOB_NAME,
      job,
    );
    job.start();
  }

  private removeCronJob(): void {
    try {
      this.schedulerRegistry.deleteCronJob(NlCronService.CRON_JOB_NAME);
    } catch {
      // Job doesn't exist — ignore
    }
  }

  /**
   * Initialize cron on module init if config is active.
   * Call from the module's onModuleInit.
   */
  async initFromConfig(): Promise<void> {
    const config = await this.knowledgeConfigService.getCronConfig();
    if (config.isActive && config.parsedCron) {
      this.logger.log(`Restoring cron schedule: ${config.parsedCron}`);
      this.registerCronJob(config.parsedCron as string);
    }
  }
}
