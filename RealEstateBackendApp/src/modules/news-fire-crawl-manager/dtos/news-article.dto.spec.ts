/**
 * news-article.dto spec — class-validator exact (mục 16.4).
 *
 * Lưu ý contract: file này định nghĩa AnalyzeRawArticlesDto, SaveArticlesDto,
 * AnalyzeMarketTrendsDto, BulkActionDto. Trong khi news-manager.dto.ts CŨNG định nghĩa
 * AnalyzeRawArticlesDto + SaveArticlesDto (controller thực tế import từ news-manager.dto).
 * Đây là duplicate DTO — ghi nhận trong báo cáo.
 */
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import {
  AnalyzeRawArticlesDto,
  AnalyzeMarketTrendsDto,
  SaveArticlesDto,
  BulkActionDto,
} from './news-article.dto';

function messages(errors: ValidationError[]): string[] {
  const out: string[] = [];
  for (const e of errors) {
    if (!e.constraints) continue;
    out.push(...Object.values(e.constraints));
  }
  return out;
}

describe('AnalyzeRawArticlesDto (news-article.dto)', () => {
  it('mảng bài viết hợp lệ → pass', async () => {
    const dto = plainToInstance(AnalyzeRawArticlesDto, { articles: [{ url: 'x' }] });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('articles không phải mảng → fail', async () => {
    const errors = await validate(
      plainToInstance(AnalyzeRawArticlesDto, { articles: 'not-array' }),
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(messages(errors).some((m) => /array/i.test(m))).toBe(true);
  });

  it('thiếu articles → fail', async () => {
    const errors = await validate(plainToInstance(AnalyzeRawArticlesDto, {}));
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('SaveArticlesDto (news-article.dto)', () => {
  it('mảng hợp lệ → pass', async () => {
    const errors = await validate(plainToInstance(SaveArticlesDto, { articles: [{ a: 1 }] }));
    expect(errors).toHaveLength(0);
  });

  it('articles null → fail', async () => {
    const errors = await validate(plainToInstance(SaveArticlesDto, { articles: null }));
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('AnalyzeMarketTrendsDto (news-article.dto)', () => {
  it('mảng string ids hợp lệ → pass', async () => {
    const errors = await validate(
      plainToInstance(AnalyzeMarketTrendsDto, { ids: ['1', '2'] }),
    );
    expect(errors).toHaveLength(0);
  });

  it('mảng chứa phần tử không phải string → fail (IsString each)', async () => {
    const errors = await validate(
      plainToInstance(AnalyzeMarketTrendsDto, { ids: ['1', 2] }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('ids rỗng vẫn pass (IsArray, không require min)', async () => {
    const errors = await validate(plainToInstance(AnalyzeMarketTrendsDto, { ids: [] }));
    expect(errors).toHaveLength(0);
  });
});

describe('BulkActionDto (news-article.dto)', () => {
  it('mảng string hợp lệ → pass', async () => {
    const errors = await validate(plainToInstance(BulkActionDto, { ids: ['a', 'b'] }));
    expect(errors).toHaveLength(0);
  });

  it('phần tử số → fail IsString each', async () => {
    const errors = await validate(plainToInstance(BulkActionDto, { ids: [1] }));
    expect(errors.length).toBeGreaterThan(0);
  });
});
