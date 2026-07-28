/**
 * UpdateAiConfigDto unit spec — contract mục 3 (Swagger @ApiPropertyOptional +
 * class-validator). Tất cả field optional + string — controller dùng IsOptional+IsString.
 *
 * Bao phủ:
 * - Empty object valid (tất cả optional).
 * - Các field string hợp lệ.
 * - Field non-string → vi phạm @IsString.
 * - Bỏ qua field không khai báo (whitelist).
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateAiConfigDto } from './settings.dto';

async function run(input: Record<string, unknown>) {
  // KHÔNG dùng enableImplicitConversion — test IsString trên raw input số/boolean.
  // Trong app thực, NestJS ValidationPipe có thể transform, nhưng unit test DTO
  // phải verify decorator khai báo đúng (IsOptional + IsString).
  const dto = plainToInstance(UpdateAiConfigDto, input);
  const errs = await validate(dto, { whitelist: true });
  return {
    dto,
    errors: errs.flatMap((e) => Object.values(e.constraints ?? {})),
  };
}

describe('UpdateAiConfigDto (contract mục 3)', () => {
  it('empty object → valid (tất cả field optional)', async () => {
    const { errors } = await run({});
    expect(errors).toHaveLength(0);
  });

  it('đủ 6 field string → valid', async () => {
    const { dto, errors } = await run({
      provider: 'openai',
      model: 'gpt-4',
      apiKey: 'sk-x',
      must1cApiKey: 'm-k',
      must1cModel: 'm-model',
      activePlatform: 'must1c',
    });
    expect(errors).toHaveLength(0);
    expect(dto.provider).toBe('openai');
    expect(dto.model).toBe('gpt-4');
    expect(dto.apiKey).toBe('sk-x');
    expect(dto.must1cApiKey).toBe('m-k');
    expect(dto.must1cModel).toBe('m-model');
    expect(dto.activePlatform).toBe('must1c');
  });

  it('provider=number → vi phạm @IsString', async () => {
    const { errors } = await run({ provider: 123 });
    expect(errors.some((m) => /must be a string/i.test(m))).toBe(true);
  });

  it('model=number → vi phạm @IsString', async () => {
    const { errors } = await run({ model: 42 });
    expect(errors.some((m) => /must be a string/i.test(m))).toBe(true);
  });

  it('apiKey=boolean → vi phạm @IsString', async () => {
    const { errors } = await run({ apiKey: true });
    expect(errors.some((m) => /must be a string/i.test(m))).toBe(true);
  });

  it('must1cApiKey=array → vi phạm @IsString', async () => {
    const { errors } = await run({ must1cApiKey: ['a', 'b'] });
    expect(errors.some((m) => /must be a string/i.test(m))).toBe(true);
  });

  it('must1cModel=object → vi phạm @IsString', async () => {
    const { errors } = await run({ must1cModel: { x: 1 } });
    expect(errors.some((m) => /must be a string/i.test(m))).toBe(true);
  });

  it('activePlatform=null → optional bỏ qua (IsOptional cho phép null? class-validator)', async () => {
    // IsOptional cho phép null/undefined → valid.
    const { errors } = await run({ activePlatform: null });
    expect(errors).toHaveLength(0);
  });

  it('whitelist=true → field lạ bị strip (không khai báo)', async () => {
    const { dto } = await run({ provider: 'p', unknownField: 'x' });
    expect(dto.provider).toBe('p');
    expect((dto as any).unknownField).toBeUndefined();
  });

  it('chuỗi rỗng hợp lệ (IsString, không require min length)', async () => {
    const { dto, errors } = await run({ provider: '' });
    expect(errors).toHaveLength(0);
    expect(dto.provider).toBe('');
  });
});
