/**
 * ArticleExtractorUtil unit spec — contract mục 1 (DRY) + mục 4 (HTTP ra ngoài
 * cần timeout/retry; ở đây verify boundary mock).
 *
 * Bao phủ:
 * - Happy path: fetch HTML → parse og:image + article:published_time →
 *   Readability.parse → TurndownService → markdown.
 * - Readability trả null → throw "Failed to parse article content...".
 * - Readability trả { content: null } → throw.
 * - axios ném error → re-throw sau khi log.
 *
 * Mock toàn bộ 4 thư viện: axios, jsdom, @mozilla/readability, turndown.
 */

// --- Mocks phải khai báo trước import source (jest hoisting) ---
const axiosGetMock = jest.fn();
jest.mock('axios', () => ({
  __esModule: true,
  default: { get: axiosGetMock },
}));

const querySelectorMock = jest.fn();
jest.mock('jsdom', () => ({
  JSDOM: jest.fn(() => ({
    window: { document: { querySelector: querySelectorMock } },
  })),
}));

const parseMock = jest.fn();
jest.mock('@mozilla/readability', () => ({
  Readability: jest.fn(() => ({ parse: parseMock })),
}));

const turndownMock = jest.fn();
jest.mock('turndown', () => ({
  __esModule: true,
  default: jest.fn(() => ({ turndown: turndownMock })),
}));

import { ArticleExtractorUtil } from './article-extractor.util';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import axios from 'axios';

describe('ArticleExtractorUtil (contract mục 1/4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('extractArticle — happy path', () => {
    it('trả { markdown, thumbnailUrl, publishDate } đúng pipeline', async () => {
      axiosGetMock.mockResolvedValue({ data: '<html>...</html>' });
      // Lần 1: og:image; lần 2: article:published_time.
      querySelectorMock
        .mockReturnValueOnce({
          getAttribute: jest.fn().mockReturnValue('https://img.example.com/a.jpg'),
        })
        .mockReturnValueOnce({
          getAttribute: jest.fn().mockReturnValue('2025-01-02T03:04:05Z'),
        });
      parseMock.mockReturnValue({ content: '<p>hello</p>' });
      turndownMock.mockReturnValue('hello');

      const result = await ArticleExtractorUtil.extractArticle(
        'https://example.com/post/1',
      );

      // axios.get gọi với User-Agent header chuẩn.
      expect(axios.get).toHaveBeenCalledWith(
        'https://example.com/post/1',
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': expect.stringContaining('Mozilla'),
          }),
        }),
      );
      // JSDOM construct với html + url.
      expect(JSDOM).toHaveBeenCalledWith('<html>...</html>', {
        url: 'https://example.com/post/1',
      });
      // querySelector cho 2 meta.
      expect(querySelectorMock).toHaveBeenCalledWith(
        'meta[property="og:image"]',
      );
      expect(querySelectorMock).toHaveBeenCalledWith(
        'meta[property="article:published_time"]',
      );
      // Readability nhận document.
      expect(Readability).toHaveBeenCalledWith({ querySelector: querySelectorMock });
      expect(parseMock).toHaveBeenCalled();
      // TurndownService nhận article.content.
      expect(TurndownService).toHaveBeenCalledWith({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
      });
      expect(turndownMock).toHaveBeenCalledWith('<p>hello</p>');

      expect(result).toEqual({
        markdown: 'hello',
        thumbnailUrl: 'https://img.example.com/a.jpg',
        publishDate: '2025-01-02T03:04:05Z',
      });
    });

    it('thiếu og:image meta → thumbnailUrl undefined, KHÔNG throw', async () => {
      axiosGetMock.mockResolvedValue({ data: '<html>...' });
      querySelectorMock.mockReturnValue(null); // og:image không có
      parseMock.mockReturnValue({ content: '<p>x</p>' });
      turndownMock.mockReturnValue('x');

      const result = await ArticleExtractorUtil.extractArticle('https://x.com/a');

      expect(result.thumbnailUrl).toBeUndefined();
      expect(result.publishDate).toBeUndefined();
      expect(result.markdown).toBe('x');
    });

    it('og:image rỗng content → thumbnailUrl undefined (getAttribute falsy)', async () => {
      axiosGetMock.mockResolvedValue({ data: '<html>' });
      querySelectorMock
        .mockReturnValueOnce({ getAttribute: () => '' })
        .mockReturnValueOnce({ getAttribute: () => '' });
      parseMock.mockReturnValue({ content: '<p>x</p>' });
      turndownMock.mockReturnValue('x');

      const result = await ArticleExtractorUtil.extractArticle('https://x.com/a');
      expect(result.thumbnailUrl).toBeUndefined();
      expect(result.publishDate).toBeUndefined();
    });
  });

  describe('extractArticle — error paths', () => {
    it('Readability.parse trả null → throw "Failed to parse article content..."', async () => {
      axiosGetMock.mockResolvedValue({ data: '<html>' });
      querySelectorMock.mockReturnValue(null);
      parseMock.mockReturnValue(null);

      await expect(
        ArticleExtractorUtil.extractArticle('https://x.com/a'),
      ).rejects.toThrow('Failed to parse article content using Readability.');
      // Sau fix: source dùng Logger thay vì console.error — không còn spy console.
      // Chỉ verify re-throw đúng message.
    });

    it('Readability.parse trả { content: null } → throw', async () => {
      axiosGetMock.mockResolvedValue({ data: '<html>' });
      querySelectorMock.mockReturnValue(null);
      parseMock.mockReturnValue({ content: null });

      await expect(
        ArticleExtractorUtil.extractArticle('https://x.com/a'),
      ).rejects.toThrow('Failed to parse article content using Readability.');
    });

    it('axios ném network error → re-throw nguyên lỗi sau khi log', async () => {
      const err = new Error('ETIMEDOUT');
      axiosGetMock.mockRejectedValue(err);

      await expect(
        ArticleExtractorUtil.extractArticle('https://x.com/down'),
      ).rejects.toThrow('ETIMEDOUT');
    });
  });
});
