/**
 * news-source.dto spec — class-validator exact (mục 16.4).
 *
 * Bao phủ CreateNewsSourceDto (name/url bắt buộc, rssUrl/crawlConfig/isActive optional)
 * và UpdateNewsSourceDto (toàn bộ optional).
 */
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { CreateNewsSourceDto, UpdateNewsSourceDto } from './news-source.dto';

function messages(errors: ValidationError[]): string[] {
  const out: string[] = [];
  for (const e of errors) {
    if (!e.constraints) continue;
    out.push(...Object.values(e.constraints));
  }
  return out;
}

describe('CreateNewsSourceDto', () => {
  const valid = {
    name: 'VnExpress',
    url: 'https://vnexpress.net',
    rssUrl: 'https://vnexpress.net/rss',
  };

  it('payload hợp lệ (đủ name + url) → pass', async () => {
    const errors = await validate(plainToInstance(CreateNewsSourceDto, valid));
    expect(errors).toHaveLength(0);
  });

  it('thiếu name → fail IsNotEmpty', async () => {
    const errors = await validate(
      plainToInstance(CreateNewsSourceDto, { ...valid, name: '' }),
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(messages(errors).some((m) => /empty|name/i.test(m))).toBe(true);
  });

  it('thiếu url → fail', async () => {
    const errors = await validate(
      plainToInstance(CreateNewsSourceDto, { name: 'X' }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('url rỗng whitespace → trim thành "" → fail IsNotEmpty (sau khi thêm @Transform trim)', async () => {
    // Sau fix: @Transform trim '   ' → '' → @IsNotEmpty fail.
    const errors = await validate(
      plainToInstance(CreateNewsSourceDto, { name: 'X', url: '   ' }),
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(messages(errors).some((m) => /empty|url/i.test(m))).toBe(true);
  });

  it('url có whitespace hai đầu → trim thành giá trị sạch → pass', async () => {
    const errors = await validate(
      plainToInstance(CreateNewsSourceDto, {
        name: 'X',
        url: '  https://x.example  ',
      }),
    );
    expect(errors).toHaveLength(0);
  });

  it('rssUrl optional — không có vẫn pass', async () => {
    const errors = await validate(
      plainToInstance(CreateNewsSourceDto, { name: 'X', url: 'https://x.example' }),
    );
    expect(errors).toHaveLength(0);
  });

  it('crawlConfig là object → pass', async () => {
    const errors = await validate(
      plainToInstance(CreateNewsSourceDto, {
        ...valid,
        crawlConfig: { selector: '.article' },
      }),
    );
    expect(errors).toHaveLength(0);
  });

  it('crawlConfig là string → fail IsObject', async () => {
    const errors = await validate(
      plainToInstance(CreateNewsSourceDto, {
        ...valid,
        crawlConfig: 'not-object',
      }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('isActive boolean → pass', async () => {
    const errors = await validate(
      plainToInstance(CreateNewsSourceDto, { ...valid, isActive: true }),
    );
    expect(errors).toHaveLength(0);
  });

  it('isActive là string → fail IsBoolean', async () => {
    const errors = await validate(
      plainToInstance(CreateNewsSourceDto, { ...valid, isActive: 'true' }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('UpdateNewsSourceDto', () => {
  it('payload rỗng → pass (toàn bộ optional)', async () => {
    const errors = await validate(plainToInstance(UpdateNewsSourceDto, {}));
    expect(errors).toHaveLength(0);
  });

  it('chỉ update name → pass', async () => {
    const errors = await validate(
      plainToInstance(UpdateNewsSourceDto, { name: 'New name' }),
    );
    expect(errors).toHaveLength(0);
  });

  it('isActive không hợp lệ → fail', async () => {
    const errors = await validate(
      plainToInstance(UpdateNewsSourceDto, { isActive: 123 }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('crawlConfig sai type → fail', async () => {
    const errors = await validate(
      plainToInstance(UpdateNewsSourceDto, { crawlConfig: [] }),
    );
    // IsObject: array không phải plain object → fail.
    expect(errors.length).toBeGreaterThan(0);
  });

  it('url whitespace → trim "" → fail IsNotEmpty (Update cũng cần trim)', async () => {
    const errors = await validate(
      plainToInstance(UpdateNewsSourceDto, { url: '   ' }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('url hợp lệ có whitespace → trim thành giá trị sạch → pass', async () => {
    const errors = await validate(
      plainToInstance(UpdateNewsSourceDto, { url: '  https://x.example  ' }),
    );
    expect(errors).toHaveLength(0);
  });
});
