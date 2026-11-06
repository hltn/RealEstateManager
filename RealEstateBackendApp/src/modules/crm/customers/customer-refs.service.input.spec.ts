import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { CatalogItemType } from '../catalogs/catalog.enums';
import { CustomerRefsService } from './customer-refs.service';

/** Query giả của Mongoose: mọi bước chuỗi trả lại chính nó, `exec` trả kết quả. */
const query = <T>(result: T) => {
  const q: Record<string, jest.Mock> = {};
  for (const step of ['select', 'session', 'lean']) {
    q[step] = jest.fn().mockReturnValue(q);
  }
  q.exec = jest.fn().mockResolvedValue(result);
  return q;
};

type Row = Record<string, unknown>;

/** Model giả: `find` lọc `rows` theo `$in` và điều kiện bằng (đủ cho đường dịch và `resolve`). */
const fakeModel = (rows: Row[]) => ({
  find: jest.fn((filter: Record<string, unknown>) => {
    const matched = rows.filter((row) =>
      Object.entries(filter).every(([key, cond]) => {
        if (cond && typeof cond === 'object' && '$in' in cond) {
          const list = (cond as { $in: unknown[] }).$in.map(String);
          return list.includes(String(row[key]));
        }
        if (key === 'deletedAt') return (row.deletedAt ?? null) === cond;
        return row[key] === cond;
      }),
    );
    return query(matched);
  }),
  findOne: jest.fn((filter: Record<string, unknown>) => {
    const found = rows.find((row) =>
      Object.entries(filter).every(([key, cond]) =>
        key === 'deletedAt'
          ? (row.deletedAt ?? null) === cond
          : row[key] === cond,
      ),
    );
    return query(found ?? null);
  }),
});

const mk = (code: string, label: string, extra: Row = {}) => ({
  _id: new Types.ObjectId(),
  code,
  label,
  isActive: true,
  deletedAt: null,
  ...extra,
});

const statusNew = mk('NEW', 'Mới', { isDefault: true });
const statusOff = mk('OLD', 'Cũ', { isActive: false });
const sourceFb = mk('FACEBOOK', 'Facebook', {
  type: CatalogItemType.LEAD_SOURCE,
});
const mkProject = (codeNormalized: string, name: string) => ({
  _id: new Types.ObjectId(),
  codeNormalized,
  name,
  isActive: true,
  deletedAt: null,
});
const projectA = mkProject('VINHOMES', 'Vinhomes');
const projectB = mkProject('MASTERI', 'Masteri');
const areaHn = {
  _id: new Types.ObjectId(),
  code: 'HA_NOI',
  name: 'Hà Nội',
  isActive: true,
  deletedAt: null,
};

const build = (statusRows: Row[] = [statusNew, statusOff]) => {
  const statusModel = fakeModel(statusRows);
  const catalogModel = fakeModel([sourceFb]);
  const areaModel = fakeModel([areaHn]);
  const projectModel = fakeModel([projectA, projectB]);
  const service = new CustomerRefsService(
    {} as never,
    statusModel as never,
    catalogModel as never,
    areaModel as never,
    projectModel as never,
    fakeModel([]) as never,
    fakeModel([]) as never,
  );
  return { service, statusModel, catalogModel, areaModel, projectModel };
};

const expectValidationFailed = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(BusinessException);
  expect((error as BusinessException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
  expect((error as BusinessException).errorCode).toBe(
    ErrorCode.VALIDATION_FAILED,
  );
};

describe('CustomerRefsService.resolveSingleInput (FR-40)', () => {
  it('FR-40: không gửi cả id lẫn code thì provided=false (giữ nguyên giá trị hiện có), không gọi DB', async () => {
    const { service, statusModel } = build();
    const result = await service.resolveSingleInput('status', {}, 'statusCode');
    expect(result).toEqual({ provided: false, ref: null });
    expect(statusModel.find).not.toHaveBeenCalled();
  });

  it('FR-40: null (hoặc cả hai null) nghĩa là xóa: provided=true, ref=null', async () => {
    const { service, catalogModel } = build();
    expect(
      await service.resolveSingleInput('source', { code: null }, 'sourceCode'),
    ).toEqual({ provided: true, ref: null });
    expect(
      await service.resolveSingleInput(
        'source',
        { id: null, code: null },
        'sourceCode',
      ),
    ).toEqual({ provided: true, ref: null });
    expect(catalogModel.find).not.toHaveBeenCalled();
  });

  it('FR-40: chỉ gửi code thì dịch ra { id, code, label } (ghi kép từ cùng một bản ghi)', async () => {
    const { service } = build();
    const { ref } = await service.resolveSingleInput(
      'source',
      { code: 'FACEBOOK' },
      'sourceCode',
    );
    expect(ref).toEqual({
      id: sourceFb._id,
      code: 'FACEBOOK',
      label: 'Facebook',
    });
  });

  it('FR-40: chỉ gửi id (cũ) cũng dịch ra code', async () => {
    const { service } = build();
    const { ref } = await service.resolveSingleInput(
      'status',
      { id: String(statusNew._id) },
      'statusCode',
    );
    expect(ref?.code).toBe('NEW');
  });

  it('FR-40: gửi cả id lẫn code cùng bản ghi thì chấp nhận', async () => {
    const { service } = build();
    const { ref } = await service.resolveSingleInput(
      'status',
      { id: String(statusNew._id), code: 'NEW' },
      'statusCode',
    );
    expect(ref?.id).toEqual(statusNew._id);
  });

  it('FR-40: id và code lệch bản ghi thì 400 VALIDATION_FAILED', async () => {
    const { service } = build();
    await expectValidationFailed(
      service.resolveSingleInput(
        'status',
        { id: String(statusNew._id), code: 'OLD' },
        'statusCode',
      ),
    );
  });

  it('FR-40: một bên null một bên có giá trị thì 400 (không đoán ý)', async () => {
    const { service } = build();
    await expectValidationFailed(
      service.resolveSingleInput(
        'status',
        { id: null, code: 'NEW' },
        'statusCode',
      ),
    );
    await expectValidationFailed(
      service.resolveSingleInput(
        'status',
        { id: String(statusNew._id), code: null },
        'statusCode',
      ),
    );
  });

  it('FR-40: code không tồn tại thì 400', async () => {
    const { service } = build();
    await expectValidationFailed(
      service.resolveSingleInput('status', { code: 'KHONG_CO' }, 'statusCode'),
    );
  });

  it('FR-40: gán MỚI (activeOnly mặc định) từ chối code đã ngừng hoạt động', async () => {
    const { service } = build();
    await expectValidationFailed(
      service.resolveSingleInput('status', { code: 'OLD' }, 'statusCode'),
    );
  });

  it('FR-40: SỬA (activeOnly=false) vẫn dịch được code đã ngừng để khách giữ liên kết cũ', async () => {
    const { service } = build();
    const { ref } = await service.resolveSingleInput(
      'status',
      { code: 'OLD' },
      'statusCode',
      undefined,
      false,
    );
    expect(ref?.id).toEqual(statusOff._id);
  });
});

describe('CustomerRefsService.resolveListInput (FR-40)', () => {
  it('FR-40: giữ ĐÚNG thứ tự code đầu vào và khử trùng lặp (một find $in)', async () => {
    const { service, projectModel } = build();
    const { provided, refs } = await service.resolveListInput(
      'project',
      { codes: ['MASTERI', 'VINHOMES', 'MASTERI'] },
      'projectCodes',
    );
    expect(provided).toBe(true);
    expect(refs.map((ref) => ref.code)).toEqual(['MASTERI', 'VINHOMES']);
    expect(projectModel.find).toHaveBeenCalledTimes(1);
  });

  it('FR-40: mã dự án gửi chữ thường được chuẩn hóa HOA rồi mới dịch', async () => {
    const { service } = build();
    const { refs } = await service.resolveListInput(
      'project',
      { codes: ['vinhomes'] },
      'projectCodes',
    );
    expect(refs).toEqual([
      { id: projectA._id, code: 'VINHOMES', label: 'Vinhomes' },
    ]);
  });

  it('FR-40: gửi id (cũ) thì theo thứ tự id và vẫn trả code', async () => {
    const { service } = build();
    const { refs } = await service.resolveListInput(
      'project',
      { ids: [String(projectB._id), String(projectA._id)] },
      'projectCodes',
    );
    expect(refs.map((ref) => ref.code)).toEqual(['MASTERI', 'VINHOMES']);
  });

  it('FR-40: id và code cùng tập (khác thứ tự) thì chấp nhận; lệch tập thì 400', async () => {
    const { service } = build();
    const same = await service.resolveListInput(
      'project',
      {
        ids: [String(projectA._id), String(projectB._id)],
        codes: ['MASTERI', 'VINHOMES'],
      },
      'projectCodes',
    );
    expect(same.refs).toHaveLength(2);
    await expectValidationFailed(
      service.resolveListInput(
        'project',
        { ids: [String(projectA._id)], codes: ['MASTERI'] },
        'projectCodes',
      ),
    );
  });

  it('FR-40: mảng rỗng nghĩa là xóa hết (provided=true); không gửi gì thì provided=false', async () => {
    const { service, projectModel } = build();
    expect(
      await service.resolveListInput('project', { codes: [] }, 'projectCodes'),
    ).toEqual({ provided: true, refs: [] });
    expect(
      await service.resolveListInput('project', {}, 'projectCodes'),
    ).toEqual({ provided: false, refs: [] });
    expect(projectModel.find).not.toHaveBeenCalled();
  });

  it('FR-40: một bên rỗng một bên có phần tử thì 400', async () => {
    const { service } = build();
    await expectValidationFailed(
      service.resolveListInput(
        'project',
        { ids: [String(projectA._id)], codes: [] },
        'projectCodes',
      ),
    );
  });

  it('FR-40: có một code không tồn tại thì 400 cho cả danh sách', async () => {
    const { service } = build();
    await expectValidationFailed(
      service.resolveListInput(
        'project',
        { codes: ['VINHOMES', 'KHONG_CO'] },
        'projectCodes',
      ),
    );
  });
});

describe('CustomerRefsService: tình trạng mặc định và bản đồ mã (FR-40)', () => {
  it('FR-40: findDefaultStatusRef trả { id, code, label } để ghi kép khi tạo khách không chọn tình trạng', async () => {
    const { service } = build();
    expect(await service.findDefaultStatusRef({} as never)).toEqual({
      id: statusNew._id,
      code: 'NEW',
      label: 'Mới',
    });
  });

  it('FR-40: không có tình trạng mặc định thì 400', async () => {
    const { service } = build([statusOff]);
    await expect(service.findDefaultStatusRef({} as never)).rejects.toThrow(
      BusinessException,
    );
  });

  it('FR-40: resolve() trả thêm codes theo id cho nguồn, khu vực, dự án (codeNormalized); thiếu mã thì không có khóa', async () => {
    const { service } = build();
    const noCode = { _id: new Types.ObjectId(), name: 'Không mã' };
    (service as unknown as { areaModel: unknown }).areaModel = fakeModel([
      areaHn,
      noCode,
    ]);
    const maps = await service.resolve({
      sourceIds: [sourceFb._id],
      areaIds: [areaHn._id, noCode._id],
      projectIds: [projectA._id],
    });
    expect(maps.codes.sources.get(String(sourceFb._id))).toBe('FACEBOOK');
    expect(maps.codes.areas.get(String(areaHn._id))).toBe('HA_NOI');
    expect(maps.codes.areas.has(String(noCode._id))).toBe(false);
    expect(maps.codes.projects.get(String(projectA._id))).toBe('VINHOMES');
    // Map nhãn cũ không đổi.
    expect(maps.sources.get(String(sourceFb._id))).toBe('Facebook');
  });
});
