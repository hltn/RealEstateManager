import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import axios from 'axios';

export class ArticleExtractorUtil {
  /**
   * Extracts the main article content from a given URL, cleaning it
   * and converting it into Markdown. Also extracts thumbnail and publish date as fallbacks.
   *
   * @param url The URL of the article to extract.
   * @returns An object containing markdown content, and optional thumbnailUrl and publishDate.
   */
  static async extractArticle(url: string): Promise<{ markdown: string, thumbnailUrl?: string, publishDate?: string }> {
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });

      const html = response.data;
      const doc = new JSDOM(html, { url });
      
      let thumbnailUrl: string | undefined;
      const ogImage = doc.window.document.querySelector('meta[property="og:image"]');
      if (ogImage) {
         thumbnailUrl = ogImage.getAttribute('content') || undefined;
      }

      let publishDate: string | undefined;
      const articlePublishedTime = doc.window.document.querySelector('meta[property="article:published_time"]');
      if (articlePublishedTime) {
         publishDate = articlePublishedTime.getAttribute('content') || undefined;
      }

      const reader = new Readability(doc.window.document);
      const article = reader.parse();

      if (!article || !article.content) {
        throw new Error('Failed to parse article content using Readability.');
      }

      const turndownService = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
      });

      const markdown = turndownService.turndown(article.content);

      return { markdown, thumbnailUrl, publishDate };
    } catch (error) {
      console.error(`[ArticleExtractorUtil] Error extracting from ${url}:`, error);
      throw error;
    }
  }
}
