import { Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { UpdateProjectDto } from './dtos/project.dto';
import { ProjectsService } from './projects.service';

const projectId = new Types.ObjectId();
const jwt = { sub: new Types.ObjectId().toHexString() } as JwtPayload;
const hanoiId = new Types.ObjectId();
const hcmId = new Types.ObjectId();

/** `code = null` mô phỏng dữ liệu rất cũ thiếu mã (và thiếu `codeNormalized`). */
const projectDoc = (code: string | null) => ({
  _id: projectId,
  name: 'Dự án',
  code,
  codeNormalized: code?.toUpperCase(),
  developer: null,
  location: null,
  areaId: null as Types.ObjectId | null,
  areaCode: null as string | null | undefined,
  propertyTypes: [] as string[],
  propertyTypeCodes: [] as string[] | undefined,
  unmappedPropertyTypes: [] as string[] | undefined,
  priceFrom: null,
  priceTo: null,
  status: 'UPCOMING',
  isActive: true,
  deletedAt: null,
  description: null,
});

type ProjectDocShape = ReturnType<typeof projectDoc>;

const PERSONA_OPTIONS = [
  { value: 'APARTMENT', label: 'Căn hộ chung cư', isActive: true },
  { value: 'TOWNHOUSE', label: 'Nhà phố / Shophouse', isActive: true },
  { value: 'LAND', label: 'Đất nền', isActive: false },
];

/** Khu vực mẫu; `hcm` mô phỏng khu vực chưa được migration 007 điền `code`. */
const AREAS: { _id: Types.ObjectId; code?: string }[] = [
  { _id: hanoiId, code: 'HA_NOI' },
  { _id: hcmId },
];

/** Lỗi E11000 của MongoDB khi vi phạm unique index `codeNormalized`. */
const duplicateKeyError = (): Error =>
  Object.assign(new Error('E11000 duplicate key'), { code: 11000 });

type SetPayload = { $set: Record<string, unknown> };
interface Chain {
  select: () => Chain;
  lean: () => Chain;
  exec: () => Promise<unknown>;
}

const chain = (result: unknown): Chain => {
  const self: Chain = {
    select: () => self,
    lean: () => self,
    exec: () => Promise.resolve(result),
  };
  return self;
};

interface BuildOptions {
  /** Lựa chọn của `property_type` trong persona_fields; `null` = chưa có trường (mặc định có 3 lựa chọn). */
  personaOptions?: typeof PERSONA_OPTIONS | null;
  before?: Partial<ProjectDocShape>;
}

/** Dựng service với model giả: `findOne` trả dự án hiện có, `findOneAndUpdate` trả bản sau khi $set. */
const buildService = (currentCode: string | null, opts: BuildOptions = {}) => {
  const existing = (): ProjectDocShape => ({
    ...projectDoc(currentCode),
    ...opts.before,
  });
  const findOneAndUpdate = jest.fn((_filter: unknown, update: SetPayload) => ({
    lean: () => ({
      exec: () => Promise.resolve({ ...existing(), ...update.$set }),
    }),
  }));
  const projectModel = {
    findOne: jest.fn(() => ({
      session: () => ({
        lean: () => ({ exec: () => Promise.resolve(existing()) }),
      }),
    })),
    findOneAndUpdate,
    create: jest.fn(),
  };
  const areaModel = {
    findOne: jest.fn((filter: { _id?: Types.ObjectId; code?: string }) =>
      chain(
        AREAS.find((area) =>
          filter._id ? area._id.equals(filter._id) : area.code === filter.code,
        ) ?? null,
      ),
    ),
    find: jest.fn(() => chain(AREAS.map((area) => ({ ...area, name: 'Khu' })))),
  };
  const personaOptions =
    opts.personaOptions === undefined ? PERSONA_OPTIONS : opts.personaOptions;
  const personaFieldModel = {
    findOne: jest.fn(() =>
      chain(personaOptions ? { options: personaOptions } : null),
    ),
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
    areaModel as never,
    connection as never,
    usage as never,
    audit as never,
    null as never,
    personaFieldModel as never,
  );
  return { service, projectModel, findOneAndUpdate, areaModel };
};

const patch = (code: string): UpdateProjectDto => ({ code });

const updatePayload = (findOneAndUpdate: jest.Mock): Record<string, unknown> =>
  (findOneAndUpdate.mock.calls[0] as [unknown, SetPayload])[1].$set;

const createPayload = (create: jest.Mock): Record<string, unknown> =>
  (create.mock.calls[0] as unknown[][])[0][0] as Record<string, unknown>;

const errorOf = (promise: Promise<unknown>): Promise<BusinessException> =>
  promise.catch((e: unknown) => e) as Promise<BusinessException>;

describe('ProjectsService.update: mã dự án bất biến (FR-40, Q1)', () => {
  it('FR-40: PATCH gửi lại đúng mã (chỉ đổi hoa/thường, mã cũ có "_") => qua và ghi $set', async () => {
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

  it('FR-40: PATCH đổi sang mã khác => 400 PROJECT_CODE_IMMUTABLE, không ghi DB', async () => {
    const { service, findOneAndUpdate } = buildService('OLD_CODE');
    const error = await errorOf(
      service.update(jwt, String(projectId), patch('Skypark2')),
    );
    expect(error).toBeInstanceOf(BusinessException);
    expect(error.errorCode).toBe(ErrorCode.PROJECT_CODE_IMMUTABLE);
    expect(error.getStatus()).toBe(400);
    expect(error.details).toEqual({ fields: ['code'] });
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it.each(['NEW_CODE', 'NEW-CODE'])(
    'FR-40: đổi sang mã mới có "-"/"_" (%p) => 400 PROJECT_CODE_IMMUTABLE và không ghi DB',
    async (code) => {
      const { service, findOneAndUpdate } = buildService('OLD_CODE');
      const error = await errorOf(
        service.update(jwt, String(projectId), patch(code)),
      );
      expect(error.errorCode).toBe(ErrorCode.PROJECT_CODE_IMMUTABLE);
      expect(findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  it('FR-40 (biên): mã gửi lên có khoảng trắng thừa nhưng cùng mã => qua', async () => {
    const { service, findOneAndUpdate } = buildService('ABC');
    await service.update(jwt, String(projectId), patch(' abc '));
    expect(updatePayload(findOneAndUpdate)).toMatchObject({
      codeNormalized: 'ABC',
    });
  });

  it('FR-40 (biên): mã rỗng/khoảng trắng khác mã hiện có => 400 PROJECT_CODE_IMMUTABLE', async () => {
    const { service, findOneAndUpdate } = buildService('ABC');
    const error = await errorOf(
      service.update(jwt, String(projectId), patch('   ')),
    );
    expect(error.errorCode).toBe(ErrorCode.PROJECT_CODE_IMMUTABLE);
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('FR-40 (biên): PATCH code: null => 400 details.fields=["code"] trước khi đụng DB', async () => {
    const { service, projectModel, findOneAndUpdate } =
      buildService('OLD_CODE');
    const error = await errorOf(
      service.update(jwt, String(projectId), { code: null } as never),
    );
    expect(error.getStatus()).toBe(400);
    expect(error.details).toEqual({ fields: ['code'] });
    expect(projectModel.findOne).not.toHaveBeenCalled();
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('FR-40 (biên): dự án thiếu codeNormalized nhưng có code => so với code thô (cùng mã qua, khác mã 400)', async () => {
    const { service, findOneAndUpdate } = buildService('Abc', {
      before: { codeNormalized: undefined },
    });
    await service.update(jwt, String(projectId), patch('ABC'));
    expect(updatePayload(findOneAndUpdate)).toMatchObject({
      codeNormalized: 'ABC',
    });
    const error = await errorOf(
      service.update(jwt, String(projectId), patch('XYZ')),
    );
    expect(error.errorCode).toBe(ErrorCode.PROJECT_CODE_IMMUTABLE);
  });

  it('FR-40 (biên): dự án rất cũ thiếu cả code (null) => không 500; đặt mã lần đầu theo quy tắc A-Z/0-9', async () => {
    const { service, findOneAndUpdate } = buildService(null);
    const error = await errorOf(
      service.update(jwt, String(projectId), patch('OLD_CODE')),
    );
    expect(error.errorCode).toBe(ErrorCode.VALIDATION_FAILED);
    expect(findOneAndUpdate).not.toHaveBeenCalled();

    await service.update(jwt, String(projectId), patch('NEWCODE'));
    expect(updatePayload(findOneAndUpdate)).toMatchObject({
      codeNormalized: 'NEWCODE',
    });
  });

  it('FR-40: không gửi code (chỉ sửa tên) => không kiểm mã, không $set code/areaCode/propertyTypeCodes', async () => {
    const { service, findOneAndUpdate } = buildService('OLD_CODE');
    await service.update(jwt, String(projectId), { name: 'Tên mới' });
    const set = updatePayload(findOneAndUpdate);
    expect(set).toMatchObject({ name: 'Tên mới' });
    expect(set).not.toHaveProperty('code');
    expect(set).not.toHaveProperty('areaCode');
    expect(set).not.toHaveProperty('propertyTypeCodes');
  });

  it('FR-40: E11000 khi ghi vẫn => 409 PROJECT_CODE_DUPLICATED', async () => {
    const { service, findOneAndUpdate } = buildService('ABC');
    findOneAndUpdate.mockImplementation(() => ({
      lean: () => ({ exec: () => Promise.reject(duplicateKeyError()) }),
    }));
    const error = await errorOf(
      service.update(jwt, String(projectId), patch('abc')),
    );
    expect(error.errorCode).toBe(ErrorCode.PROJECT_CODE_DUPLICATED);
    expect(error.getStatus()).toBe(409);
  });
});

describe('ProjectsService.create: trùng mã không phân biệt hoa thường', () => {
  it('FR-40: lưu code như người gửi, codeNormalized viết hoa; E11000 => 409 PROJECT_CODE_DUPLICATED', async () => {
    const { service, projectModel } = buildService('X');
    projectModel.create.mockRejectedValue(duplicateKeyError());
    const error = await errorOf(
      service.create(jwt, { name: 'A', code: 'skypark' }),
    );
    expect(projectModel.create).toHaveBeenCalledTimes(1);
    expect(createPayload(projectModel.create)).toMatchObject({
      code: 'skypark',
      codeNormalized: 'SKYPARK',
    });
    expect(error.errorCode).toBe(ErrorCode.PROJECT_CODE_DUPLICATED);
    expect(error.getStatus()).toBe(409);
  });
});

describe('ProjectsService: ghi kép khu vực areaId + areaCode (FR-40)', () => {
  it('FR-40: PATCH chỉ gửi areaCode => $set cả areaId lẫn areaCode', async () => {
    const { service, findOneAndUpdate } = buildService('ABC');
    await service.update(jwt, String(projectId), { areaCode: 'HA_NOI' });
    expect(updatePayload(findOneAndUpdate)).toMatchObject({
      areaId: hanoiId,
      areaCode: 'HA_NOI',
    });
  });

  it('FR-40: PATCH chỉ gửi areaId (cũ) => vẫn ghi cả areaCode', async () => {
    const { service, findOneAndUpdate } = buildService('ABC');
    await service.update(jwt, String(projectId), { areaId: String(hanoiId) });
    expect(updatePayload(findOneAndUpdate)).toMatchObject({
      areaId: hanoiId,
      areaCode: 'HA_NOI',
    });
  });

  it('FR-40: gửi cả areaId và areaCode cùng khu vực => qua', async () => {
    const { service, findOneAndUpdate } = buildService('ABC');
    await service.update(jwt, String(projectId), {
      areaId: String(hanoiId),
      areaCode: 'HA_NOI',
    });
    expect(updatePayload(findOneAndUpdate)).toMatchObject({
      areaId: hanoiId,
      areaCode: 'HA_NOI',
    });
  });

  it('FR-40: areaId và areaCode trỏ hai khu vực khác nhau => 400 VALIDATION_FAILED, không ghi', async () => {
    const { service, findOneAndUpdate } = buildService('ABC');
    const error = await errorOf(
      service.update(jwt, String(projectId), {
        areaId: String(hcmId),
        areaCode: 'HA_NOI',
      }),
    );
    expect(error.errorCode).toBe(ErrorCode.VALIDATION_FAILED);
    expect(error.details).toEqual({ fields: ['areaId', 'areaCode'] });
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('FR-40 (biên): một bên null bên kia có giá trị => 400 VALIDATION_FAILED', async () => {
    const { service } = buildService('ABC');
    const error = await errorOf(
      service.update(jwt, String(projectId), {
        areaId: null,
        areaCode: 'HA_NOI',
      }),
    );
    expect(error.errorCode).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('FR-40 (biên): areaId không tồn tại => 404, không ghi', async () => {
    const { service, findOneAndUpdate } = buildService('ABC');
    await expect(
      service.update(jwt, String(projectId), {
        areaId: String(new Types.ObjectId()),
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('FR-40 (biên): areaCode không tồn tại/đã xóa mềm (truy vấn lọc deletedAt: null) => 404', async () => {
    const { service, areaModel, findOneAndUpdate } = buildService('ABC');
    await expect(
      service.update(jwt, String(projectId), { areaCode: 'KHONG_CO' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(areaModel.findOne).toHaveBeenCalledWith({
      code: 'KHONG_CO',
      deletedAt: null,
    });
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('FR-40 (biên): khu vực chưa có code (chưa migration) => ghi areaId và areaCode = null, không lỗi', async () => {
    const { service, findOneAndUpdate } = buildService('ABC');
    await service.update(jwt, String(projectId), { areaId: String(hcmId) });
    expect(updatePayload(findOneAndUpdate)).toMatchObject({
      areaId: hcmId,
      areaCode: null,
    });
  });

  it('FR-40: areaId: null (xóa khu vực) => xóa cả areaId lẫn areaCode', async () => {
    const { service, findOneAndUpdate } = buildService('ABC');
    await service.update(jwt, String(projectId), { areaId: null });
    expect(updatePayload(findOneAndUpdate)).toMatchObject({
      areaId: null,
      areaCode: null,
    });
  });

  it('FR-40: create ghi kép areaId + areaCode', async () => {
    const { service, projectModel } = buildService('X');
    projectModel.create.mockRejectedValue(duplicateKeyError());
    await errorOf(
      service.create(jwt, { name: 'A', code: 'AB', areaCode: 'HA_NOI' }),
    );
    expect(createPayload(projectModel.create)).toMatchObject({
      areaId: hanoiId,
      areaCode: 'HA_NOI',
    });
  });
});

describe('ProjectsService: loại hình propertyTypeCodes / unmappedPropertyTypes (FR-46)', () => {
  it('FR-46: chữ cũ khớp => vào propertyTypeCodes, propertyTypes ghi lại là nhãn; không khớp => unmappedPropertyTypes', async () => {
    const { service, findOneAndUpdate } = buildService('ABC');
    await service.update(jwt, String(projectId), {
      propertyTypes: ['Căn hộ', 'Officetel', 'shophouse'],
    });
    expect(updatePayload(findOneAndUpdate)).toMatchObject({
      propertyTypeCodes: ['APARTMENT', 'TOWNHOUSE'],
      unmappedPropertyTypes: ['Officetel'],
      propertyTypes: ['Căn hộ chung cư', 'Nhà phố / Shophouse', 'Officetel'],
    });
  });

  it('FR-46: response propertyTypes = nhãn suy ra (+ chữ chưa khớp), kèm propertyTypeCodes/unmapped/areaCode', async () => {
    const { service } = buildService('ABC');
    const result = await service.update(jwt, String(projectId), {
      propertyTypes: ['Căn hộ', 'Officetel'],
      areaCode: 'HA_NOI',
    });
    expect(result.propertyTypes).toEqual(['Căn hộ chung cư', 'Officetel']);
    expect(result.propertyTypeCodes).toEqual(['APARTMENT']);
    expect(result.unmappedPropertyTypes).toEqual(['Officetel']);
    expect(result.areaCode).toBe('HA_NOI');
  });

  it('FR-46: PATCH propertyTypeCodes hợp lệ => ghi kép và xóa unmappedPropertyTypes (Quản trị đã chọn lại)', async () => {
    const { service, findOneAndUpdate } = buildService('ABC', {
      before: { propertyTypeCodes: [], unmappedPropertyTypes: ['Officetel'] },
    });
    await service.update(jwt, String(projectId), {
      propertyTypeCodes: ['TOWNHOUSE', 'TOWNHOUSE', 'APARTMENT'],
    });
    expect(updatePayload(findOneAndUpdate)).toMatchObject({
      propertyTypeCodes: ['TOWNHOUSE', 'APARTMENT'],
      unmappedPropertyTypes: [],
      propertyTypes: ['Nhà phố / Shophouse', 'Căn hộ chung cư'],
    });
  });

  it('FR-46 (biên): propertyTypeCodes chứa mã không tồn tại => 400 VALIDATION_FAILED, không ghi', async () => {
    const { service, findOneAndUpdate } = buildService('ABC');
    const error = await errorOf(
      service.update(jwt, String(projectId), { propertyTypeCodes: ['XYZ'] }),
    );
    expect(error.errorCode).toBe(ErrorCode.VALIDATION_FAILED);
    expect(error.details).toEqual({ fields: ['propertyTypeCodes'] });
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('FR-46 (biên): lựa chọn đã tắt: gán mới bị từ chối, nhưng dự án đã dùng sẵn thì giữ được', async () => {
    const fresh = buildService('ABC');
    const error = await errorOf(
      fresh.service.update(jwt, String(projectId), {
        propertyTypeCodes: ['LAND'],
      }),
    );
    expect(error.errorCode).toBe(ErrorCode.VALIDATION_FAILED);

    const used = buildService('ABC', {
      before: { propertyTypeCodes: ['LAND'] },
    });
    await used.service.update(jwt, String(projectId), {
      propertyTypeCodes: ['LAND'],
    });
    expect(updatePayload(used.findOneAndUpdate)).toMatchObject({
      propertyTypeCodes: ['LAND'],
    });
  });

  it('FR-46 (biên): chưa có trường property_type => chữ cũ vào unmapped hết, không lỗi; gửi mã thì 400', async () => {
    const { service, findOneAndUpdate } = buildService('ABC', {
      personaOptions: null,
    });
    await service.update(jwt, String(projectId), { propertyTypes: ['Căn hộ'] });
    expect(updatePayload(findOneAndUpdate)).toMatchObject({
      propertyTypeCodes: [],
      unmappedPropertyTypes: ['Căn hộ'],
      propertyTypes: ['Căn hộ'],
    });
    const error = await errorOf(
      service.update(jwt, String(projectId), {
        propertyTypeCodes: ['APARTMENT'],
      }),
    );
    expect(error.errorCode).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('FR-46 (biên): propertyTypes: [] => xóa sạch cả codes lẫn unmapped', async () => {
    const { service, findOneAndUpdate } = buildService('ABC');
    await service.update(jwt, String(projectId), { propertyTypes: [] });
    expect(updatePayload(findOneAndUpdate)).toMatchObject({
      propertyTypeCodes: [],
      unmappedPropertyTypes: [],
      propertyTypes: [],
    });
  });

  it('FR-46: create ghi kép propertyTypeCodes + propertyTypes (nhãn) + unmappedPropertyTypes', async () => {
    const { service, projectModel } = buildService('X');
    projectModel.create.mockRejectedValue(duplicateKeyError());
    await errorOf(
      service.create(jwt, {
        name: 'A',
        code: 'AB',
        propertyTypes: ['Căn hộ', 'Officetel'],
      }),
    );
    expect(createPayload(projectModel.create)).toMatchObject({
      propertyTypeCodes: ['APARTMENT'],
      unmappedPropertyTypes: ['Officetel'],
      propertyTypes: ['Căn hộ chung cư', 'Officetel'],
    });
  });

  it('FR-46 (biên): propertyTypeCodes=[] (mặc định schema) kèm chữ cũ => response vẫn trả chữ cũ', async () => {
    const { service } = buildService('ABC', {
      before: {
        propertyTypes: ['Căn hộ'],
        propertyTypeCodes: [],
        unmappedPropertyTypes: [],
      },
    });
    const result = await service.update(jwt, String(projectId), {
      name: 'Tên mới',
    });
    expect(result.propertyTypes).toEqual(['Căn hộ']);
  });

  it('FR-46 (biên): chữ cũ khớp lựa chọn đã tắt => vào unmapped, trừ khi dự án đã dùng sẵn mã đó', async () => {
    const fresh = buildService('ABC');
    await fresh.service.update(jwt, String(projectId), {
      propertyTypes: ['Đất nền'],
    });
    expect(updatePayload(fresh.findOneAndUpdate)).toMatchObject({
      propertyTypeCodes: [],
      unmappedPropertyTypes: ['Đất nền'],
    });

    const used = buildService('ABC', {
      before: { propertyTypeCodes: ['LAND'] },
    });
    await used.service.update(jwt, String(projectId), {
      propertyTypes: ['Đất nền'],
    });
    expect(updatePayload(used.findOneAndUpdate)).toMatchObject({
      propertyTypeCodes: ['LAND'],
      unmappedPropertyTypes: [],
    });
  });

  it('FR-40 (biên): PATCH dự án không tồn tại kèm areaCode sai => 404 dự án, không tra khu vực', async () => {
    const { service, projectModel, areaModel } = buildService('ABC');
    projectModel.findOne.mockReturnValueOnce({
      session: () => ({ lean: () => ({ exec: () => Promise.resolve(null) }) }),
    } as never);
    await expect(
      service.update(jwt, String(projectId), { areaCode: 'KHONG_CO' }),
    ).rejects.toMatchObject({ message: 'Không tìm thấy dự án' });
    expect(areaModel.findOne).not.toHaveBeenCalled();
  });

  it('FR-46 (biên): dự án cũ chưa có propertyTypeCodes => response giữ chữ cũ, areaCode suy từ areaId', async () => {
    const { service } = buildService('ABC', {
      before: {
        areaId: hanoiId,
        areaCode: undefined,
        propertyTypes: ['Căn hộ'],
        propertyTypeCodes: undefined,
        unmappedPropertyTypes: undefined,
      },
    });
    const result = await service.update(jwt, String(projectId), {
      name: 'Tên mới',
    });
    expect(result.propertyTypes).toEqual(['Căn hộ']);
    expect(result.propertyTypeCodes).toEqual([]);
    expect(result.unmappedPropertyTypes).toEqual([]);
    expect(result.areaCode).toBe('HA_NOI');
  });
});
