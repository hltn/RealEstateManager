/**
 * news-manager.dto spec — class-validator exact (mục 16.4).
 *
 * Đây là file DTO mà controller thực tế import. Bao phủ:
 * - UpdateCronConfigDto: isActive IsBoolean, frequency IsString (bắt buộc).
 * - BulkIdsDto: ids IsArray + IsString each.
 * - AnalyzeRawArticlesDto / SaveArticlesDto: articles IsArray (Record<string, any>[]).
 * - TriggerManualAnalyzeDto: filePath IsString bắt buộc.
 * - TriggerManualCrawlDto: days IsNumber optional, startDate/endDate IsString optional.
 * - GetRawArticlesQueryDto: sort @IsIn(['newest','oldest']) + kế thừa page/limit IsInt/Min/Max.
 * - GetArticlesQueryDto: date optional.
 * - AiPromptDto: 3 field IsString bắt buộc.
 */
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import {
  UpdateCronConfigDto,
  BulkIdsDto,
  AnalyzeRawArticlesDto,
  SaveArticlesDto,
  TriggerManualAnalyzeDto,
  TriggerManualCrawlDto,
  GetRawArticlesQueryDto,
  GetArticlesQueryDto,
  AiPromptDto,
} from './news-manager.dto';

function messages(errors: ValidationError[]): string[] {
  const out: string[] = [];
  for (const e of errors) {
    if (!e.constraints) continue;
    out.push(...Object.values(e.constraints));
  }
  return out;
}

describe('UpdateCronConfigDto', () => {
  it('payload hợp lệ → pass', async () => {
    const errors = await validate(
      plainToInstance(UpdateCronConfigDto, { isActive: true, frequency: '0 8 * * *' }),
    );
    expect(errors).toHaveLength(0);
  });

  it('isActive không phải boolean → fail', async () => {
    const errors = await validate(
      plainToInstance(UpdateCronConfigDto, { isActive: 'yes', frequency: '0 8 * * *' }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('thiếu frequency → fail', async () => {
    const errors = await validate(
      plainToInstance(UpdateCronConfigDto, { isActive: true }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('BulkIdsDto', () => {
  it('mảng string hợp lệ → pass', async () => {
    const errors = await validate(plainToInstance(BulkIdsDto, { ids: ['1', '2'] }));
    expect(errors).toHaveLength(0);
  });

  it('phần tử số → fail IsString each', async () => {
    const errors = await validate(plainToInstance(BulkIdsDto, { ids: [1, 2] }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('ids không phải mảng → fail', async () => {
    const errors = await validate(plainToInstance(BulkIdsDto, { ids: 'x' }));
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('AnalyzeRawArticlesDto (news-manager.dto)', () => {
  it('mảng object hợp lệ → pass', async () => {
    const errors = await validate(
      plainToInstance(AnalyzeRawArticlesDto, { articles: [{ urlHash: 'h1' }] }),
    );
    expect(errors).toHaveLength(0);
  });

  it('articles không phải mảng → fail', async () => {
    const errors = await validate(
      plainToInstance(AnalyzeRawArticlesDto, { articles: {} }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('SaveArticlesDto (news-manager.dto)', () => {
  it('mảng hợp lệ → pass', async () => {
    const errors = await validate(plainToInstance(SaveArticlesDto, { articles: [{ a: 1 }] }));
    expect(errors).toHaveLength(0);
  });

  it('thiếu articles → fail', async () => {
    const errors = await validate(plainToInstance(SaveArticlesDto, {}));
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('TriggerManualAnalyzeDto', () => {
  it('filePath hợp lệ → pass', async () => {
    const errors = await validate(plainToInstance(TriggerManualAnalyzeDto, { filePath: '/tmp/x.json' }));
    expect(errors).toHaveLength(0);
  });

  it('thiếu filePath → fail', async () => {
    const errors = await validate(plainToInstance(TriggerManualAnalyzeDto, {}));
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('TriggerManualCrawlDto', () => {
  it('payload rỗng → pass (toàn optional)', async () => {
    const errors = await validate(plainToInstance(TriggerManualCrawlDto, {}));
    expect(errors).toHaveLength(0);
  });

  it('days là số → pass', async () => {
    const errors = await validate(plainToInstance(TriggerManualCrawlDto, { days: 7 }));
    expect(errors).toHaveLength(0);
  });

  it('days là string → fail (IsNumber)', async () => {
    const errors = await validate(plainToInstance(TriggerManualCrawlDto, { days: '7' }));
    // Lưu ý: khi class-transformer không whitelist, '7' có thể là string → fail.
    expect(errors.length).toBeGreaterThan(0);
  });

  it('startDate/endDate string → pass', async () => {
    const errors = await validate(
      plainToInstance(TriggerManualCrawlDto, { startDate: '2026-07-01', endDate: '2026-07-31' }),
    );
    expect(errors).toHaveLength(0);
  });
});

describe('GetRawArticlesQueryDto', () => {
  it('query rỗng → pass (kế thừa page/limit default)', async () => {
    const errors = await validate(plainToInstance(GetRawArticlesQueryDto, {}));
    expect(errors).toHaveLength(0);
  });

  it('sort=newest → pass', async () => {
    const errors = await validate(plainToInstance(GetRawArticlesQueryDto, { sort: 'newest' }));
    expect(errors).toHaveLength(0);
  });

  it('sort=oldest → pass', async () => {
    const errors = await validate(plainToInstance(GetRawArticlesQueryDto, { sort: 'oldest' }));
    expect(errors).toHaveLength(0);
  });

  it('sort giá trị khác → fail IsIn', async () => {
    const errors = await validate(plainToInstance(GetRawArticlesQueryDto, { sort: 'ascending' }));
    expect(errors.length).toBeGreaterThan(0);
    expect(messages(errors).some((m) => /newest|oldest/i.test(m))).toBe(true);
  });

  it('page=0 → fail Min(1)', async () => {
    const errors = await validate(plainToInstance(GetRawArticlesQueryDto, { page: 0 }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('limit=200 → fail Max(100)', async () => {
    const errors = await validate(plainToInstance(GetRawArticlesQueryDto, { limit: 200 }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('page=1.5 → fail IsInt', async () => {
    const errors = await validate(plainToInstance(GetRawArticlesQueryDto, { page: 1.5 }));
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('GetArticlesQueryDto', () => {
  it('date string hợp lệ → pass', async () => {
    const errors = await validate(plainToInstance(GetArticlesQueryDto, { date: '2026-07-28' }));
    expect(errors).toHaveLength(0);
  });

  it('status hợp lệ và pagination kế thừa → pass', async () => {
    const errors = await validate(
      plainToInstance(GetArticlesQueryDto, { status: 'POSTED_WP', page: 2, limit: 20 }),
    );
    expect(errors).toHaveLength(0);
  });

  it('status không hỗ trợ → fail IsIn', async () => {
    const errors = await validate(plainToInstance(GetArticlesQueryDto, { status: 'all' }));
    expect(errors.length).toBeGreaterThan(0);
    expect(messages(errors).some((m) => /pending|POSTED_WP/i.test(m))).toBe(true);
  });
});

describe('AiPromptDto', () => {
  it('payload đủ 3 field string → pass', async () => {
    const errors = await validate(
      plainToInstance(AiPromptDto, {
        api_ai_name: 'gemini',
        api_ai_path: '/v1/analyze',
        prompt: 'extract list',
      }),
    );
    expect(errors).toHaveLength(0);
  });

  it('thiếu api_ai_name → fail', async () => {
    const errors = await validate(
      plainToInstance(AiPromptDto, { api_ai_path: '/x', prompt: 'p' }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('prompt rỗng → fail IsNotEmpty (sau khi thêm @IsNotEmpty cho prompt)', async () => {
    const errors = await validate(
      plainToInstance(AiPromptDto, { api_ai_name: 'x', api_ai_path: '/x', prompt: '' }),
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(messages(errors).some((m) => /empty/i.test(m))).toBe(true);
  });

  it('api_ai_path rỗng → fail IsNotEmpty', async () => {
    const errors = await validate(
      plainToInstance(AiPromptDto, { api_ai_name: 'x', api_ai_path: '', prompt: 'p' }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});
