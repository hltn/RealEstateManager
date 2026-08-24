import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { PipelineLogService } from './pipeline-log.service';
import { KnowledgeConfigService } from './knowledge-config.service';

export interface CategoryTopic {
  slug: string;
  name: string;
  description: string;
}

export interface RotationResult {
  topic: CategoryTopic;
  wpCategoryId: number;
  rotationIndex: number;
}

/**
 * Category Rotation Service.
 *
 * Picks the next category using round-robin rotation, ensuring balanced
 * article distribution across configured topics/categories.
 *
 * Rotation strategy:
 * 1. If an explicit category is requested, use it (if valid).
 * 2. Otherwise, look at recent pipeline logs to find which categories were used.
 * 3. Pick the first topic NOT in the recent usage list (round-robin).
 * 4. If all topics were used recently, pick the least-used one by count.
 * 5. Fallback to the first topic if no config is found.
 */
@Injectable()
export class CategoryRotationService {
  private readonly logger = new Logger(CategoryRotationService.name);

  /** In-memory rotation index for deterministic round-robin across restarts */
  private rotationIndex = 0;

  constructor(
    private readonly pipelineLogService: PipelineLogService,
    private readonly knowledgeConfigService: KnowledgeConfigService,
  ) {}

  /**
   * Pick the next category for a pipeline batch.
   *
   * @param overrideSlug - Explicit category slug to use (optional)
   * @param articleCount - Number of articles to generate (used for balance calculation)
   * @returns RotationResult with the selected topic and WP category ID
   */
  async pickCategory(
    overrideSlug?: string,
    articleCount?: number,
  ): Promise<RotationResult> {
    const topics = await this.getTopics();
    if (!topics || topics.length === 0) {
      throw new InternalServerErrorException(
        'No topics configured in AI writing config',
      );
    }

    // If explicit category requested, validate and use it
    if (overrideSlug) {
      const found = topics.find((t) => t.slug === overrideSlug);
      if (found) {
        const wpCategoryId = await this.resolveWpCategoryId(found.slug);
        return {
          topic: found,
          wpCategoryId,
          rotationIndex: this.rotationIndex,
        };
      }
      this.logger.warn(
        `Category "${overrideSlug}" not found in config, falling back to rotation`,
      );
    }

    // Round-robin: find the next topic not recently used
    const nextTopic = await this.rotateCategory(topics);
    const wpCategoryId = await this.resolveWpCategoryId(nextTopic.slug);

    return {
      topic: nextTopic,
      wpCategoryId,
      rotationIndex: this.rotationIndex,
    };
  }

  /**
   * Get the current rotation state (for debugging/display).
   */
  getRotationState(): {
    currentIndex: number;
    totalTopics: number;
  } {
    return {
      currentIndex: this.rotationIndex,
      totalTopics: 0, // Will be set by the caller from config
    };
  }

  /**
   * Reset rotation index to 0.
   */
  resetRotation(): void {
    this.rotationIndex = 0;
    this.logger.log('Category rotation index reset to 0');
  }

  // ── Private helpers ─────────────────────────────────────

  /**
   * Get topics from AI writing config.
   */
  private async getTopics(): Promise<CategoryTopic[]> {
    const aiWritingConfig =
      await this.knowledgeConfigService.getAiWritingConfig();
    const topics = aiWritingConfig.topics as
      | CategoryTopic[]
      | undefined;
    return topics || [];
  }

  /**
   * Resolve WP category ID from the WP config's category mapping.
   */
  private async resolveWpCategoryId(slug: string): Promise<number> {
    const wpConfig = await this.knowledgeConfigService.getWpConfig();
    const categoryMapping = (wpConfig.categoryMapping || []) as Array<{
      slug: string;
      wpCategoryId: number;
      wpCategoryName: string;
    }>;

    const mapped = categoryMapping.find((m) => m.slug === slug);
    if (mapped) {
      return mapped.wpCategoryId;
    }

    return (wpConfig.defaultCategoryId as number) || 1;
  }

  /**
   * Rotate category using round-robin with balance tracking.
   *
   * Strategy:
   * 1. Query recent pipeline logs to find which categories were used recently.
   * 2. Pick the first topic NOT in the recent list.
   * 3. If all topics were used recently, pick the least-used by total count.
   */
  private async rotateCategory(
    topics: CategoryTopic[],
  ): Promise<CategoryTopic> {
    // Get recent logs (one per topic to cover the full rotation cycle)
    const recentLogs = await this.pipelineLogService.listLogs({
      page: 1,
      limit: topics.length,
    });

    const recentlyUsed = recentLogs.data.map((l) => l.categorySlug);

    // Find first topic NOT in recently used (round-robin)
    const nextTopic = topics.find((t) => !recentlyUsed.includes(t.slug));

    if (nextTopic) {
      this.rotationIndex =
        (topics.indexOf(nextTopic) + 1) % topics.length;
      this.logger.log(
        `Category rotation: selected "${nextTopic.slug}" (not used recently)`,
      );
      return nextTopic;
    }

    // All topics used recently — find the one used least by total count
    const usageCounts = new Map<string, number>();
    for (const topic of topics) {
      usageCounts.set(topic.slug, 0);
    }

    // Count all non-running logs
    const allLogs = await this.pipelineLogService.listLogs({
      page: 1,
      limit: 1000, // Get all logs for balance calculation
    });

    for (const log of allLogs.data) {
      const count = usageCounts.get(log.categorySlug) || 0;
      usageCounts.set(log.categorySlug, count + 1);
    }

    // Find the topic with the lowest count
    let minCount = Infinity;
    let leastUsedTopic = topics[0];

    for (const topic of topics) {
      const count = usageCounts.get(topic.slug) || 0;
      if (count < minCount) {
        minCount = count;
        leastUsedTopic = topic;
      }
    }

    this.rotationIndex =
      (topics.indexOf(leastUsedTopic) + 1) % topics.length;
    this.logger.log(
      `Category rotation: selected "${leastUsedTopic.slug}" (least used: ${minCount} times)`,
    );

    return leastUsedTopic;
  }
}
