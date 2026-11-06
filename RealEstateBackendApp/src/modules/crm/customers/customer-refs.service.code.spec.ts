import { Types } from 'mongoose';
import { CatalogItemType } from '../catalogs/catalog.enums';
import { BusinessException } from '../../../common/exceptions/business.exception';
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

/** Model giả: `find` lọc `rows` theo `$in` và các điều kiện bằng (đủ cho đường dịch). */
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
});

const mkStatus = (code: string, label: string, extra: Row = {}) => ({
  _id: new Types.ObjectId(),
  code,
  label,
  isActive: true,
  deletedAt: null,
  ...extra,
});
const statusA = mkStatus('NEW', 'Mới');
const statusB = mkStatus('NET', 'Nét');
const statusOff = mkStatus('OLD', 'Cũ', { isActive: false });
const statusDeleted = mkStatus('GONE', 'Đã xóa', { deletedAt: new Date() });
const projectA = {
  _id: new Types.ObjectId(),
  codeNormalized: 'VINHOMES',
  name: 'Vinhomes',
  isActive: true,
  deletedAt: null,
};

// Hai mục danh mục cùng code `OTHER` khác type (index {type, code} unique cho phép).
const sourceOther = mkStatus('OTHER', 'Nguồn khác', {
  type: CatalogItemType.LEAD_SOURCE,
});
const resultOther = mkStatus('OTHER', 'Kết quả khác', {
  type: CatalogItemType.CONTACT_RESULT,
});

const build = () => {
  const catalogModel = fakeModel([sourceOther, resultOther]);
  const statusModel = fakeModel([statusA, statusB, statusOff, statusDeleted]);
  const service = new CustomerRefsService(
    {} as never,
    statusModel as never,
    catalogModel as never,
    fakeModel([]) as never,
    fakeModel([projectA]) as never,
    {} as never,
    {} as never,
  );
  return { service, statusModel, catalogModel };
};

describe('CustomerRefsService: dịch id/code (FR-40)', () => {
  it('FR-40: resolveByCodes dùng đúng một find $in cho cả lô (không N+1)', async () => {
    const { service, statusModel } = build();
    const refs = await service.resolveByCodes('status', ['NEW', 'NET', 'NEW']);
    expect(statusModel.find).toHaveBeenCalledTimes(1);
    expect(refs.map((r) => r.code).sort()).toEqual(['NET', 'NEW']);
    expect(refs.find((r) => r.code === 'NEW')).toEqual({
      id: statusA._id,
      code: 'NEW',
      label: 'Mới',
    });
  });

  it('FR-40: resolveByIds dùng một find $in và vẫn trả bản ngừng/xóa mềm để hiển thị', async () => {
    const { service, statusModel } = build();
    const refs = await service.resolveByIds('status', [
      statusA._id,
      statusOff._id,
      statusDeleted._id,
      null,
    ]);
    expect(statusModel.find).toHaveBeenCalledTimes(1);
    expect(refs).toHaveLength(3);
  });

  it('FR-40: không có giá trị thì không gọi DB', async () => {
    const { service, statusModel } = build();
    expect(await service.resolveByCodes('status', [null, undefined])).toEqual(
      [],
    );
    expect(statusModel.find).not.toHaveBeenCalled();
  });

  it('FR-40: mã dự án so theo codeNormalized (chữ HOA)', async () => {
    const { service } = build();
    const [ref] = await service.resolveByCodes('project', ['vinhomes']);
    expect(ref).toEqual({
      id: projectA._id,
      code: 'VINHOMES',
      label: 'Vinhomes',
    });
  });

  it('FR-40: resolveForAssign nhận chỉ id hoặc chỉ code', async () => {
    const { service } = build();
    const byId = await service.resolveForAssign(
      'status',
      { ids: [statusA._id] },
      'statusId',
    );
    const byCode = await service.resolveForAssign(
      'status',
      { codes: ['NEW'] },
      'statusCode',
    );
    expect(byId[0].code).toBe('NEW');
    expect(byCode[0].id).toEqual(statusA._id);
  });

  it('FR-40: id và code cùng một bản ghi thì hợp lệ', async () => {
    const { service } = build();
    const ref = await service.resolveOneForAssign(
      'status',
      { id: statusA._id, code: 'NEW' },
      'statusId',
    );
    expect(ref?.code).toBe('NEW');
  });

  it('FR-40: id lệch code thì 400 VALIDATION_FAILED', async () => {
    const { service } = build();
    const promise = service.resolveOneForAssign(
      'status',
      { id: statusA._id, code: 'NET' },
      'statusId',
    );
    await expect(promise).rejects.toBeInstanceOf(BusinessException);
    await expect(promise).rejects.toMatchObject({ status: 400 });
  });

  it('FR-40: danh sách id và code khác tập thì 400', async () => {
    const { service } = build();
    await expect(
      service.resolveForAssign(
        'status',
        { ids: [statusA._id, statusB._id], codes: ['NEW'] },
        'x',
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    ['ngừng hoạt động', 'OLD'],
    ['xóa mềm', 'GONE'],
    ['không tồn tại', 'NOPE'],
  ])('FR-40: code %s khi gán mới bị từ chối 400', async (_name, code) => {
    const { service } = build();
    const promise = service.resolveOneForAssign(
      'status',
      { code },
      'statusCode',
    );
    await expect(promise).rejects.toMatchObject({ status: 400 });
    await expect(promise).rejects.toThrow(
      'không tồn tại hoặc đã ngừng hoạt động',
    );
  });

  it('FR-40: id của bản ngừng hoạt động khi gán mới cũng bị từ chối', async () => {
    const { service } = build();
    await expect(
      service.resolveOneForAssign('status', { id: statusOff._id }, 'statusId'),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('FR-40: không gửi gì thì trả null', async () => {
    const { service } = build();
    expect(
      await service.resolveOneForAssign('status', {}, 'statusId'),
    ).toBeNull();
  });

  it('FR-40: nguồn khách lọc đúng type LEAD_SOURCE khi trùng code với kết quả liên hệ', async () => {
    const { service, catalogModel } = build();
    const refs = await service.resolveByCodes('source', ['OTHER']);
    expect(refs).toEqual([
      { id: sourceOther._id, code: 'OTHER', label: 'Nguồn khác' },
    ]);
    expect(catalogModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ type: CatalogItemType.LEAD_SOURCE }),
    );
  });

  it('FR-40: kết quả liên hệ lọc đúng type CONTACT_RESULT khi trùng code với nguồn khách', async () => {
    const { service, catalogModel } = build();
    const refs = await service.resolveByCodes('contactResult', ['OTHER']);
    expect(refs).toEqual([
      { id: resultOther._id, code: 'OTHER', label: 'Kết quả khác' },
    ]);
    expect(catalogModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ type: CatalogItemType.CONTACT_RESULT }),
    );
  });

  it('FR-40: id của nguồn khách không được dùng làm kết quả liên hệ (sai type bị từ chối)', async () => {
    const { service } = build();
    await expect(
      service.resolveOneForAssign(
        'contactResult',
        { id: sourceOther._id },
        'contactResultId',
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('FR-40: mã dự án chuẩn hóa HOA rồi mới khử trùng lặp (vinhomes và VINHOMES là một)', async () => {
    const { service } = build();
    const refs = await service.resolveByCodes('project', [
      'vinhomes',
      'VINHOMES',
    ]);
    expect(refs).toHaveLength(1);
    const assigned = await service.resolveForAssign(
      'project',
      { codes: ['vinhomes', 'VINHOMES'] },
      'projectCodes',
    );
    expect(assigned).toHaveLength(1);
    expect(assigned[0].code).toBe('VINHOMES');
  });

  it('FR-40: id và code (khác hoa/thường) của cùng dự án vẫn khớp nhau', async () => {
    const { service } = build();
    const ref = await service.resolveOneForAssign(
      'project',
      { id: projectA._id, code: 'vinhomes' },
      'projectId',
    );
    expect(ref?.id).toEqual(projectA._id);
  });
});
