import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class WordPressService {
  private readonly logger = new Logger(WordPressService.name);

  async pushToWordPress(article: any): Promise<number> {
    this.logger.log(
      `Starting Job 4: Push to WordPress for article: ${article.title}`,
    );

    // Simulate API delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Generate a mock WordPress post ID
    const mockWpPostId = Math.floor(Math.random() * 100000) + 1;

    this.logger.log(
      `Job 4 completed. Article pushed successfully. Mock WP Post ID: ${mockWpPostId}`,
    );
    return mockWpPostId;
  }
}
