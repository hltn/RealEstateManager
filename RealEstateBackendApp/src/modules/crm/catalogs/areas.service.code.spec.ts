import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { generateAreaCode } from '../common/utils/area-code.util';
import { AreasService } from './areas.service';
import { AreaType } from './catalog.enums';
import { UpdateAreaDto } from './dtos/area.dto';

const jwt = { sub: new Types.ObjectId().toHexString() } as JwtPayload;

const areaDoc = (name: string, code: string) => {
  const doc = {
    _id: new Types.ObjectId(),
    name,
    code,
    nameNormalized: name.toLowerCase(),
    type: AreaType.PROVINCE,
    parentId: null,
    ancestorIds: [],
    adminCode: null,
    isLegacy: false,
    order: 1,
    isActive: true,
  };
  return { ...doc, toObject: () => doc };
};

/** Query giả của Mongoose: mọi bước chuỗi trả lại chính nó, `exec` trả kết quả. */
const query = <T>(result: T) => {
  const q: Record<string, jest.Mock> = {};
  for (const step of ['select', 'session', 'sort', 'lean']) {
    q[step] = jest.fn().mockReturnValue(q);
  }
  q.exec = jest.fn().mockResolvedValue(result);
  return q;
};

const connection = {
  transaction: (work: (session: unknown) => Promise<unknown>) => work({}),
};

const buildForCreate = (existingCodes: string[]) => {
  const created: Array<Record<string, unknown>> = [];
  const areaModel = {
    find: jest
      .fn()
      .mockImplementation((filter: { code: RegExp }) =>
        query(
          existingCodes
            .filter((code) => filter.code.test(code))
            .map((code) => ({ code })),
        ),
      ),
    findOne: jest.fn().mockImplementation(() => query(null)),
    create: jest
      .fn()
      .mockImplementation((docs: Array<{ name: string; code: string }>) => {
        created.push(docs[0]);
        return Promise.resolve([areaDoc(docs[0].name, docs[0].code)]);
      }),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new AreasService(
    areaModel as never,
    connection as never,
    {} as never,
    audit as never,
  );
  return { service, created, areaModel, audit };
};

describe('AreasService: mã khu vực `code` (FR-40)', () => {
  it('FR-40: create sinh code từ tên (bỏ dấu, HA_NOI) và trả code trong response', async () => {
    const { service, created } = buildForCreate([]);
    const result = await service.create(jwt, {
      name: 'Hà Nội',
      type: AreaType.PROVINCE,
    });
    expect(created[0].code).toBe('HA_NOI');
    expect(result.code).toBe('HA_NOI');
  });

  it('FR-40: code trùng (kể cả bản xóa mềm) thì thêm hậu tố _2, _3', async () => {
    const { service, created } = buildForCreate(['HA_NOI', 'HA_NOI_2']);
    await service.create(jwt, { name: 'Hà Nội', type: AreaType.DISTRICT });
    expect(created[0].code).toBe('HA_NOI_3');
  });

  it('FR-40: truy vấn kiểm trùng chỉ lọc theo code, không lọc deletedAt (mã không dùng lại)', async () => {
    const { service, areaModel } = buildForCreate([]);
    await service.create(jwt, { name: 'Hà Nội', type: AreaType.PROVINCE });
    const filter = areaModel.find.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(filter)).toEqual(['code']);
    const pattern = filter.code as RegExp;
    expect(pattern.test('HA_NOI')).toBe(true);
    expect(pattern.test('HA_NOI_12')).toBe(true);
    expect(pattern.test('DA_NANG')).toBe(false);
  });

  it('FR-40: hai tên dài trùng 30 ký tự đầu, lần tạo thứ 3 ra _3 (mã đã cắt vẫn được nhận ra)', async () => {
    const longName = 'Khu đô thị mới Thủ Thiêm phường An Khánh quận Hai';
    const base = generateAreaCode(longName);
    expect(base).toHaveLength(30);
    const second = `${base.slice(0, 28).replace(/_+$/, '')}_2`;
    const { service, created } = buildForCreate([base, second]);
    await service.create(jwt, { name: longName, type: AreaType.WARD });
    const code = created[0].code as string;
    expect(code.endsWith('_3')).toBe(true);
    expect(code.length).toBeLessThanOrEqual(30);
  });

  it('FR-40: đụng unique code 5 lần liên tiếp thì dừng, ném lỗi, create gọi đúng 5 lần', async () => {
    const { service, areaModel } = buildForCreate([]);
    areaModel.create.mockRejectedValue(
      Object.assign(new Error('E11000'), {
        code: 11000,
        keyPattern: { code: 1 },
      }),
    );
    await expect(
      service.create(jwt, { name: 'Hà Nội', type: AreaType.PROVINCE }),
    ).rejects.toBeInstanceOf(BusinessException);
    expect(areaModel.create).toHaveBeenCalledTimes(5);
  });

  it('FR-40: audit CATALOG_CREATED có dòng thay đổi của field code', async () => {
    const { service, audit } = buildForCreate([]);
    await service.create(jwt, { name: 'Hà Nội', type: AreaType.PROVINCE });
    const entry = audit.record.mock.calls[0][0] as {
      changes: Array<{ field: string; to: unknown }>;
    };
    expect(entry.changes).toContainEqual(
      expect.objectContaining({ field: 'code', to: 'HA_NOI' }),
    );
  });

  it('FR-40: đụng unique index code khi tạo đồng thời thì thử lại cả giao dịch', async () => {
    const { service, areaModel, created } = buildForCreate([]);
    areaModel.create.mockRejectedValueOnce(
      Object.assign(new Error('E11000'), {
        code: 11000,
        keyPattern: { code: 1 },
      }),
    );
    await service.create(jwt, { name: 'Hà Nội', type: AreaType.PROVINCE });
    expect(areaModel.create).toHaveBeenCalledTimes(2);
    expect(created).toHaveLength(1);
  });

  it('FR-40: trùng tên (không phải code) trả lỗi nghiệp vụ, không thử lại', async () => {
    const { service, areaModel } = buildForCreate([]);
    areaModel.create.mockRejectedValue(
      Object.assign(new Error('E11000'), {
        code: 11000,
        keyPattern: { parentId: 1, nameNormalized: 1 },
      }),
    );
    await expect(
      service.create(jwt, { name: 'Hà Nội', type: AreaType.PROVINCE }),
    ).rejects.toBeInstanceOf(BusinessException);
    expect(areaModel.create).toHaveBeenCalledTimes(1);
  });

  it('FR-40: DTO sửa không nhận code (ValidationPipe whitelist + forbidNonWhitelisted từ chối)', async () => {
    const dto = plainToInstance(UpdateAreaDto, { name: 'Mới', code: 'HACK' });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.map((e) => e.property)).toEqual(['code']);
  });

  it('FR-40: update đổi tên không đưa code vào $set và response giữ nguyên code', async () => {
    const before = areaDoc('Hà Nội', 'HA_NOI');
    const areaModel = {
      find: jest.fn().mockImplementation(() => query([])),
      findOne: jest.fn().mockImplementation(() => query(before)),
      findOneAndUpdate: jest
        .fn()
        .mockImplementation(() => query({ ...before, name: 'Thủ đô' })),
    };
    const service = new AreasService(
      areaModel as never,
      connection as never,
      {} as never,
      { record: jest.fn().mockResolvedValue(undefined) } as never,
    );
    const result = await service.update(jwt, String(before._id), {
      name: 'Thủ đô',
    });
    const update = areaModel.findOneAndUpdate.mock.calls[0][1] as {
      $set: Record<string, unknown>;
    };
    expect(update.$set).not.toHaveProperty('code');
    expect(update.$set.name).toBe('Thủ đô');
    expect(result.code).toBe('HA_NOI');
  });
});
