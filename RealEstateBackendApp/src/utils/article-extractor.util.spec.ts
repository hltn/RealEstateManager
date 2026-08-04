/**
 * ArticleExtractorUtil unit spec — contract mục 1 (DRY) + mục 4 (HTTP ra ngoài
 * cần timeout/retry; ở đây verify boundary mock).
 *
 * Bao phủ:
 * - Happy path: fetch HTML → parse og:image + article:published_time →
 *   Readability.parse → TurndownService → markdown.
 * - Anti-bot bypass: challenge detected → extract D1N cookie → retry with cookie → success.
 * - Anti-bot challenge without extractable cookie → proceed with original body.
 * - Readability trả null → throw "Failed to parse article content...".
 * - Readability trả { content: null } → throw.
 * - axios ném error → re-throw sau khi log.
 *
 * Mock toàn bộ thư viện: axios, jsdom, @mozilla/readability, turndown, https.
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

// Mock https.Agent — không cần hành vi thực tế, chỉ cần constructor.
const httpsAgentMock = jest.fn();
jest.mock('https', () => ({
  Agent: httpsAgentMock,
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

      // axios.get gọi với User-Agent header chuẩn + httpsAgent + timeout.
      expect(axios.get).toHaveBeenCalledWith(
        'https://example.com/post/1',
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': expect.stringContaining('Mozilla'),
          }),
          timeout: 30000,
          responseType: 'text',
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

  describe('extractArticle — anti-bot bypass', () => {
    const CHALLENGE_HTML = `<script>document.cookie="D1N=eb79e4a01234567890abcdef1234567"+" expires=Fri, 31 Dec 2099 23:59:59 GMT; path=/";window.location.reload(true);</script>`;
    const REAL_HTML = '<html><head><meta property="og:image" content="https://img.laodong.vn/a.jpg"/><meta property="article:published_time" content="2025-06-01T10:00:00Z"/></head><body><p>real content</p></body></html>';

    it('detect challenge D1N → extract cookie → retry with Cookie header → parse real HTML', async () => {
      // Lần 1: challenge; lần 2: real HTML
      axiosGetMock
        .mockResolvedValueOnce({ data: CHALLENGE_HTML })
        .mockResolvedValueOnce({ data: REAL_HTML });

      querySelectorMock
        .mockReturnValueOnce({
          getAttribute: jest.fn().mockReturnValue('https://img.laodong.vn/a.jpg'),
        })
        .mockReturnValueOnce({
          getAttribute: jest.fn().mockReturnValue('2025-06-01T10:00:00Z'),
        });
      parseMock.mockReturnValue({ content: '<p>real content</p>' });
      turndownMock.mockReturnValue('real content');

      const result = await ArticleExtractorUtil.extractArticle(
        'https://laodong.vn/bai-viet/123',
      );

      // Verify axios.get được gọi 2 lần.
      expect(axios.get).toHaveBeenCalledTimes(2);

      // Lần 1: request thường.
      expect(axios.get).toHaveBeenNthCalledWith(
        1,
        'https://laodong.vn/bai-viet/123',
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': expect.stringContaining('Mozilla'),
          }),
          timeout: 30000,
          responseType: 'text',
        }),
      );

      // Lần 2: retry với Cookie header chứa D1N cookie.
      expect(axios.get).toHaveBeenNthCalledWith(
        2,
        'https://laodong.vn/bai-viet/123',
        expect.objectContaining({
          headers: expect.objectContaining({
            Cookie: 'D1N=eb79e4a01234567890abcdef1234567',
          }),
        }),
      );

      // JSDOM được gọi với real HTML (lần 2).
      expect(JSDOM).toHaveBeenCalledWith(REAL_HTML, {
        url: 'https://laodong.vn/bai-viet/123',
      });

      expect(result).toEqual({
        markdown: 'real content',
        thumbnailUrl: 'https://img.laodong.vn/a.jpg',
        publishDate: '2025-06-01T10:00:00Z',
      });
    });

    it('detect challenge with generic cookie pattern (no D1N) → extract generic → retry', async () => {
      const genericChallengeHtml =
        '<script>document.cookie="SOME_COOKIE=xyz789"+" path=/";window.location.reload(true);</script>';
      const realHtml = '<html><body><p>generic bypass ok</p></body></html>';

      axiosGetMock
        .mockResolvedValueOnce({ data: genericChallengeHtml })
        .mockResolvedValueOnce({ data: realHtml });

      querySelectorMock.mockReturnValue(null);
      parseMock.mockReturnValue({ content: '<p>generic bypass ok</p>' });
      turndownMock.mockReturnValue('generic bypass ok');

      const result = await ArticleExtractorUtil.extractArticle(
        'https://some-news.vn/bai/456',
      );

      expect(axios.get).toHaveBeenCalledTimes(2);

      // Lần 2: retry với generic cookie.
      expect(axios.get).toHaveBeenNthCalledWith(
        2,
        'https://some-news.vn/bai/456',
        expect.objectContaining({
          headers: expect.objectContaining({
            Cookie: 'SOME_COOKIE=xyz789',
          }),
        }),
      );

      // JSDOM gọi với real HTML.
      expect(JSDOM).toHaveBeenCalledWith(realHtml, {
        url: 'https://some-news.vn/bai/456',
      });

      expect(result.markdown).toBe('generic bypass ok');
    });

    it('detect challenge but cookie NOT extractable → proceed with original challenge body', async () => {
      // Body chứa "document.cookie=" nhưng không có pattern extractable (không có dấu nháy kép sau =)
      const unparseableChallenge = '<script>document.cookie=something;window.location.reload();</script>';

      axiosGetMock.mockResolvedValue({ data: unparseableChallenge });

      querySelectorMock.mockReturnValue(null);
      // Readability.parse sẽ trả null vì body là challenge script
      parseMock.mockReturnValue(null);

      await expect(
        ArticleExtractorUtil.extractArticle('https://bad-challenge.vn/x'),
      ).rejects.toThrow('Failed to parse article content using Readability.');

      // Chỉ gọi axios.get 1 lần (không retry vì không extract được cookie).
      expect(axios.get).toHaveBeenCalledTimes(1);
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
