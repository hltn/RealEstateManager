import { Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { UpdateProjectDto } from './dtos/project.dto';
import { ProjectsService } from './projects.service';

const projectId = new Types.ObjectId();
const jwt = { sub: new Types.ObjectId().toHexString() } as JwtPayload;

/** `code = null` mô phỏng dữ liệu rất cũ thiếu mã (và thiếu `codeNormalized`). */
const projectDoc = (code: string | null) => ({
  _id: projectId,
  name: 'Dự án',
  code,
  codeNormalized: code?.toUpperCase(),
  developer: null,
  location: null,
  areaId: null,
  propertyTypes: [],
  priceFrom: null,
  priceTo: null,
  status: 'UPCOMING',
  isActive: true,
  deletedAt: null,
  description: null,
});

/** Lỗi E11000 của MongoDB khi vi phạm unique index `codeNormalized`. */
const duplicateKeyError = (): Error =>
  Object.assign(new Error('E11000 duplicate key'), { code: 11000 });

type SetPayload = { $set: Record<string, unknown> };

/** Dựng service với model giả: `findOne` trả dự án hiện có, `findOneAndUpdate` trả bản sau khi $set. */
const buildService = (currentCode: string | null) => {
  const findOneAndUpdate = jest.fn((_filter: unknown, update: SetPayload) => ({
    lean: () => ({
      exec: () =>
        Promise.resolve({ ...projectDoc(currentCode), ...update.$set }),
    }),
  }));
  const projectModel = {
    findOne: jest.fn(() => ({
      session: () => ({
        lean: () => ({
          exec: () => Promise.resolve(projectDoc(currentCode)),
        }),
      }),
    })),
    findOneAndUpdate,
    create: jest.fn(),
  };
  const connection = {
    transaction: (work: (session: unknown) => Promise<unknown>) => work({}),
  };
  const usage = {
    countActiveCustomersByProjects: jest.fn().mockResolvedValue(new Map()),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new ProjectsService(
    projectModel as never,
    null as never,
    connection as never,
    usage as never,
    audit as never,
    null as never,
  );
  return { service, projectModel, findOneAndUpdate };
};

const patch = (code: string): UpdateProjectDto => ({ code });

const updatePayload = (findOneAndUpdate: jest.Mock): Record<string, unknown> =>
  (findOneAndUpdate.mock.calls[0] as [unknown, SetPayload])[1].$set;

describe('ProjectsService.update: kiểm mã dự án (PT-031)', () => {
  it('PATCH gửi lại đúng mã cũ có "_" (khác hoa thường) => qua và ghi $set', async () => {
    const { service, findOneAndUpdate } = buildService('OLD_CODE');
    const result = await service.update(
      jwt,
      String(projectId),
      patch('old_code'),
    );
    expect(result.code).toBe('old_code');
    expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(updatePayload(findOneAndUpdate)).toMatchObject({
      code: 'old_code',
      codeNormalized: 'OLD_CODE',
    });
  });

  it('đổi sang mã mới hợp lệ => qua, codeNormalized viết hoa', async () => {
    const { service, findOneAndUpdate } = buildService('OLD_CODE');
    await service.update(jwt, String(projectId), patch('Skypark2'));
    expect(updatePayload(findOneAndUpdate)).toMatchObject({
      code: 'Skypark2',
      codeNormalized: 'SKYPARK2',
    });
  });

  it('PATCH code: null => 400 details.fields=["code"] trước khi đụng DB (DTO cho null qua IsOptional)', async () => {
    const { service, projectModel, findOneAndUpdate } =
      buildService('OLD_CODE');
    const error = await service
      .update(jwt, String(projectId), { code: null } as never)
      .catch((e: unknown) => e);
    expect((error as BusinessException).getStatus()).toBe(400);
    expect((error as BusinessException).details).toEqual({ fields: ['code'] });
    expect(projectModel.findOne).not.toHaveBeenCalled();
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('mã cũ đúng 20 ký tự gửi lại (khác hoa thường) => qua; đổi sang mã mới sai => 400 mang details.fields=["code"]', async () => {
    const legacy = 'LEG_ACY-CODE_20-CHAR';
    const { service, findOneAndUpdate } = buildService(legacy);
    await service.update(jwt, String(projectId), patch(legacy.toLowerCase()));
    expect(updatePayload(findOneAndUpdate)).toMatchObject({
      codeNormalized: legacy,
    });
    const error = await service
      .update(jwt, String(projectId), patch('LEG_ACY-CODE_20-CHAR2'))
      .catch((e: unknown) => e);
    expect((error as BusinessException).details).toEqual({ fields: ['code'] });
    expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('dữ liệu rất cũ thiếu code (null): không 500, mã gửi lên rơi vào kiểm chặt', async () => {
    const { service, findOneAndUpdate } = buildService(null);
    const error = await service
      .update(jwt, String(projectId), patch('OLD_CODE'))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BusinessException);
    expect((error as BusinessException).errorCode).toBe(
      ErrorCode.VALIDATION_FAILED,
    );
    expect(findOneAndUpdate).not.toHaveBeenCalled();

    await service.update(jwt, String(projectId), patch('NEWCODE'));
    expect(updatePayload(findOneAndUpdate)).toMatchObject({
      codeNormalized: 'NEWCODE',
    });
  });

  it.each(['NEW_CODE', 'NEW-CODE'])(
    'đổi sang mã mới có "-"/"_" (%p) => 400 và không ghi DB',
    async (code) => {
      const { service, findOneAndUpdate } = buildService('OLD_CODE');
      const error = await service
        .update(jwt, String(projectId), patch(code))
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BusinessException);
      expect((error as BusinessException).errorCode).toBe(
        ErrorCode.VALIDATION_FAILED,
      );
      expect((error as BusinessException).getStatus()).toBe(400);
      expect(findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  it('không gửi code (chỉ sửa tên) trên dự án mã cũ => không bị kiểm mã', async () => {
    const { service, findOneAndUpdate } = buildService('OLD_CODE');
    await service.update(jwt, String(projectId), { name: 'Tên mới' });
    const set = updatePayload(findOneAndUpdate);
    expect(set).toMatchObject({ name: 'Tên mới' });
    expect(set).not.toHaveProperty('code');
  });

  it('đổi sang mã trùng (E11000) => 409 PROJECT_CODE_DUPLICATED', async () => {
    const { service, findOneAndUpdate } = buildService('ABC');
    findOneAndUpdate.mockImplementation(() => ({
      lean: () => ({ exec: () => Promise.reject(duplicateKeyError()) }),
    }));
    const error = await service
      .update(jwt, String(projectId), patch('XYZ'))
      .catch((e: unknown) => e);
    expect((error as BusinessException).errorCode).toBe(
      ErrorCode.PROJECT_CODE_DUPLICATED,
    );
    expect((error as BusinessException).getStatus()).toBe(409);
  });
});

describe('ProjectsService.create: trùng mã không phân biệt hoa thường', () => {
  it('lưu code như người gửi, codeNormalized viết hoa; E11000 => 409 PROJECT_CODE_DUPLICATED', async () => {
    const { service, projectModel } = buildService('X');
    projectModel.create.mockRejectedValue(duplicateKeyError());
    const error = await service
      .create(jwt, { name: 'A', code: 'skypark' })
      .catch((e: unknown) => e);
    expect(projectModel.create).toHaveBeenCalledTimes(1);
    const payload = (projectModel.create.mock.calls[0] as unknown[][])[0][0];
    expect(payload).toMatchObject({
      code: 'skypark',
      codeNormalized: 'SKYPARK',
    });
    expect((error as BusinessException).errorCode).toBe(
      ErrorCode.PROJECT_CODE_DUPLICATED,
    );
    expect((error as BusinessException).getStatus()).toBe(409);
  });
});
