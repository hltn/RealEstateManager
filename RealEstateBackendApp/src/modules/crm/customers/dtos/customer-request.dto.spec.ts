import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCustomerDto, UpdateCustomerDto } from './customer-request.dto';

/** Giống `ValidationPipe` toàn cục ở main.ts: `whitelist` + `forbidNonWhitelisted` (field lạ => 400). */
const errorsOf = async <T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
) =>
  validate(plainToInstance(cls, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('CreateCustomerDto', () => {
  it('FR-10: gửi careTeam bị từ chối (forbidNonWhitelisted => 400)', async () => {
    const errors = await errorsOf(CreateCustomerDto, {
      fullName: 'A',
      careTeam: { memberIds: [], primaryUserId: '507f1f77bcf86cd799439011' },
    });
    expect(errors.map((e) => e.property)).toEqual(['careTeam']);
    expect(errors[0].constraints).toHaveProperty('whitelistValidation');
  });

  it('FR-01: chỉ cần fullName (không phone) vẫn hợp lệ', async () => {
    expect(await errorsOf(CreateCustomerDto, { fullName: 'A' })).toEqual([]);
  });

  it.each([
    ['null', null],
    ['chuỗi rỗng', ''],
    ['chỉ khoảng trắng (được trim)', '   '],
    ['số hợp lệ', '0912 345 678'],
  ])('FR-01: phone %s hợp lệ ở tầng DTO', async (_n, phone) => {
    expect(await errorsOf(CreateCustomerDto, { fullName: 'A', phone })).toEqual(
      [],
    );
  });

  it('FR-01: phone không phải chuỗi hoặc quá 30 ký tự bị từ chối', async () => {
    const notString = await errorsOf(CreateCustomerDto, {
      fullName: 'A',
      phone: 912345678,
    });
    expect(notString.map((e) => e.property)).toEqual(['phone']);
    const tooLong = await errorsOf(CreateCustomerDto, {
      fullName: 'A',
      phone: '1'.repeat(31),
    });
    expect(tooLong.map((e) => e.property)).toEqual(['phone']);
  });

  it('FR-01: fullName vẫn bắt buộc', async () => {
    const errors = await errorsOf(CreateCustomerDto, { phone: '0912345678' });
    expect(errors.map((e) => e.property)).toEqual(['fullName']);
  });
});

describe('UpdateCustomerDto', () => {
  it.each([
    ['null (xóa SĐT)', null],
    ['chuỗi rỗng (xóa SĐT)', ''],
    ['số hợp lệ', '0912345678'],
  ])('FR-01: phone %s hợp lệ', async (_n, phone) => {
    expect(await errorsOf(UpdateCustomerDto, { version: 1, phone })).toEqual(
      [],
    );
  });

  it('FR-01: vắng phone (giữ nguyên) hợp lệ; phone không phải chuỗi bị từ chối', async () => {
    expect(await errorsOf(UpdateCustomerDto, { version: 1 })).toEqual([]);
    const errors = await errorsOf(UpdateCustomerDto, { version: 1, phone: 5 });
    expect(errors.map((e) => e.property)).toEqual(['phone']);
  });
});
