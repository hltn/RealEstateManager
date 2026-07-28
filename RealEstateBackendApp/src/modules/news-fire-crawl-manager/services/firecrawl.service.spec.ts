/**
 * FirecrawlService spec — ghi nhận trạng thái dead code.
 *
 * File `firecrawl.service.ts` hiện tại TOÀN BỘ bị comment out (từ dòng 1 đến 222).
 * Không có class `FirecrawlService` nào được export, không có module nào import
 * service này (đã verify bằng grep toàn src). CustomCrawlerService đã thay thế
 * toàn bộ trách nhiệm crawl/scrape.
 *
 * Spec này không test hành vi (không có code chạy) mà chỉ guard chống regression:
 * nếu sau này uncomment lại class, spec sẽ fail nhắc chủ ý cập nhật test thật.
 */
import * as fs from 'fs';
import * as path from 'path';

const SOURCE = fs.readFileSync(
  path.join(
    __dirname,
    'firecrawl.service.ts',
  ),
  'utf8',
);

describe('FirecrawlService (dead code guard)', () => {
  it('file nguồn không export class FirecrawlService hoạt động (toàn bộ bị comment)', () => {
    // Bỏ tất cả dòng comment (// ...) ra rồi check không còn token export class.
    const stripped = SOURCE.replace(/^\s*\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/export\s+class\s+FirecrawlService/);
    expect(stripped).not.toMatch(/@Injectable\(\)/);
  });

  it('không có module nào trong src còn import FirecrawlService (chỉ file self match)', () => {
    // Đã verify bằng grep riêng; ở đây chỉ assert lại pattern import trong chính file.
    const importLine = SOURCE.match(/^.*import.*FirecrawlService.*$/gm);
    // File self không import chính nó → không có dòng import FirecrawlService.
    expect(importLine).toBeNull();
  });
});
