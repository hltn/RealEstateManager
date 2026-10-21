import { newsSources, type MockNewsSource } from '../data/news';
import type { MockRoute } from '../types';
import { fail, mockObjectId, ok } from '../utils';
import { asRecord, readString } from './shared';

/** Đọc `crawlConfig` dạng object từ body (bỏ qua nếu sai kiểu). */
const readCrawlConfig = (body: unknown): Record<string, unknown> | undefined => {
  const value = asRecord(body).crawlConfig;
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
};

/** `/news-sources` — CRUD nguồn tin. GET trả `{ data: NewsSource[] }`, POST/PUT trả object nguồn trực tiếp. */
export const newsSourcesRoutes: MockRoute[] = [
  { method: 'GET', pattern: /^\/news-sources$/, handler: () => ok({ data: newsSources }) },
  {
    method: 'POST',
    pattern: /^\/news-sources$/,
    handler: ({ body, path }) => {
      const name = readString(body, 'name')?.trim();
      const url = readString(body, 'url')?.trim();
      if (!name || !url) return fail(400, 'Tên và URL nguồn tin không được để trống', path);
      if (newsSources.some((source) => source.url === url)) return fail(409, 'URL nguồn tin đã tồn tại', path);
      const created: MockNewsSource = {
        _id: mockObjectId(),
        name,
        url,
        rssUrl: readString(body, 'rssUrl') || undefined,
        crawlConfig: readCrawlConfig(body) ?? {},
        isActive: true,
      };
      newsSources.push(created);
      return { data: created, status: 201 };
    },
  },
  {
    method: 'PUT',
    pattern: /^\/news-sources\/([^/]+)$/,
    handler: ({ params, body, path }) => {
      const source = newsSources.find((item) => item._id === params[0]);
      if (!source) return fail(404, 'Không tìm thấy nguồn tin', path);
      // Cập nhật từng phần: chỉ ghi đè field có trong body (vd toggle chỉ gửi `isActive`).
      const payload = asRecord(body);
      if (typeof payload.name === 'string') source.name = payload.name;
      if (typeof payload.url === 'string') source.url = payload.url;
      if (typeof payload.rssUrl === 'string') source.rssUrl = payload.rssUrl || undefined;
      if (typeof payload.isActive === 'boolean') source.isActive = payload.isActive;
      const crawlConfig = readCrawlConfig(body);
      if (crawlConfig) source.crawlConfig = crawlConfig;
      return ok(source);
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/news-sources\/([^/]+)$/,
    handler: ({ params, path }) => {
      const index = newsSources.findIndex((item) => item._id === params[0]);
      if (index < 0) return fail(404, 'Không tìm thấy nguồn tin', path);
      newsSources.splice(index, 1);
      return ok({ message: 'Đã xóa nguồn tin' });
    },
  },
];
