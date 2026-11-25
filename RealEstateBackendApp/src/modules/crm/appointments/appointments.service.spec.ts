import { Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { fakeConnection } from '../customers/access/customer-rights.fixture';
import type { CatalogRef } from '../customers/customer-refs.service';
import { AppointmentType } from './appointment.constants';
import { assigneeFilter } from './appointment-assignee';
import { AppointmentsService } from './appointments.service';
import type { ListAppointmentsQueryDto } from './dtos/appointment.dto';

const jwt = { sub: 'user-1' } as JwtPayload;
const oid = () => new Types.ObjectId();
const userId = oid();
const projectA: CatalogRef = { id: oid(), code: 'QTERRA', label: 'Q Terra' };

const buildService = () => {
  const appointmentModel = {
    aggregate: jest.fn((): { exec: () => Promise<unknown[]> } => ({
      exec: () => Promise.resolve([{ rows: [], total: [] }]),
    })),
  };
  const access = {
    resolve: jest.fn().mockResolvedValue({
      scope: {},
      actor: { userId, role: UserRole.STAFF, roles: [UserRole.STAFF] },
    }),
  };
  const repo = { buildFilter: jest.fn().mockReturnValue({}) };
  const refs = {
    resolve: jest.fn().mockResolvedValue({
      statuses: new Map(),
      users: new Map(),
    }),
    resolveByIds: jest.fn().mockResolvedValue([]),
    resolveByCodes: jest.fn().mockResolvedValue([]),
  };
  const writer = { createInSession: jest.fn() };
  const service = new AppointmentsService(
    {} as never,
    appointmentModel as never,
    access as never,
    repo as never,
    refs as never,
    writer as never,
    {} as never,
  );
  return { service, appointmentModel, refs, writer };
};

const query = (extra: Partial<ListAppointmentsQueryDto>) => ({
  from: '2026-10-01',
  to: '2026-10-31',
  ...extra,
});

/** `$match` đầu tiên của pipeline `aggregate` lần gọi đầu. */
const firstMatch = (appointmentModel: { aggregate: jest.Mock }) =>
  (
    (appointmentModel.aggregate.mock.calls[0] as unknown[][])[0] as Array<{
      $match: Record<string, unknown>;
    }>
  )[0].$match;

describe('AppointmentsService.list: lọc theo dự án (FR-40)', () => {
  it('FR-40: projectCode (không phân biệt hoa thường) lọc theo mã đã ghi kép KÈM nhánh projectId cho lịch chưa backfill, dịch mã bằng một lượt', async () => {
    const { service, appointmentModel, refs } = buildService();
    refs.resolveByCodes.mockResolvedValue([projectA]);

    await service.list(jwt, query({ projectCode: 'qterra' }));

    expect(refs.resolveByCodes).toHaveBeenCalledTimes(1);
    expect(refs.resolveByCodes).toHaveBeenCalledWith('project', ['QTERRA']);
    expect(firstMatch(appointmentModel)).toMatchObject({
      $or: [
        { projectCode: 'QTERRA' },
        { projectCode: null, projectId: projectA.id },
      ],
    });
    expect(firstMatch(appointmentModel)).not.toHaveProperty('projectId');
  });

  it('FR-40: projectCode của dự án không còn tồn tại (xóa cứng) chỉ lọc theo mã', async () => {
    const { service, appointmentModel } = buildService();

    await service.list(jwt, query({ projectCode: 'qterra' }));

    expect(firstMatch(appointmentModel)).toMatchObject({
      projectCode: 'QTERRA',
    });
    expect(firstMatch(appointmentModel)).not.toHaveProperty('$or');
  });

  it('FR-40 (tương thích): chỉ projectId (PWA cũ) giữ nguyên lọc theo id, kể cả lịch chưa có projectCode', async () => {
    const { service, appointmentModel } = buildService();

    await service.list(jwt, query({ projectId: String(projectA.id) }));

    const match = firstMatch(appointmentModel);
    expect(String(match.projectId)).toBe(String(projectA.id));
    expect(match).not.toHaveProperty('projectCode');
  });

  it('FR-40: không gửi gì => không lọc theo dự án', async () => {
    const { service, appointmentModel } = buildService();
    await service.list(jwt, query({}));
    const match = firstMatch(appointmentModel);
    expect(match).not.toHaveProperty('projectId');
    expect(match).not.toHaveProperty('projectCode');
  });

  it('FR-40: gửi cả hai cùng một dự án => lọc theo projectCode', async () => {
    const { service, appointmentModel, refs } = buildService();
    refs.resolveByIds.mockResolvedValue([projectA]);

    await service.list(
      jwt,
      query({ projectId: String(projectA.id), projectCode: 'QTERRA' }),
    );

    expect(firstMatch(appointmentModel)).toMatchObject({
      $or: [
        { projectCode: 'QTERRA' },
        { projectCode: null, projectId: projectA.id },
      ],
    });
  });

  it.each([
    ['khác dự án', [{ id: oid(), code: 'KHAC', label: 'Khác' }]],
    ['id không tồn tại', []],
  ])(
    'FR-40: gửi cả hai mà %s => 400 VALIDATION_FAILED (field projectCode), không truy vấn lịch',
    async (_label, resolved) => {
      const { service, appointmentModel, refs } = buildService();
      refs.resolveByIds.mockResolvedValue(resolved);

      await expect(
        service.list(
          jwt,
          query({ projectId: String(projectA.id), projectCode: 'QTERRA' }),
        ),
      ).rejects.toMatchObject({ details: { field: 'projectCode' } });
      expect(appointmentModel.aggregate).not.toHaveBeenCalled();
    },
  );

  it('FR-40: response dịch dự án của cả trang bằng MỘT lô resolveByIds (không N+1)', async () => {
    const { service, appointmentModel, refs } = buildService();
    const customer = { _id: oid(), fullName: 'A', statusId: oid() };
    const row = (projectId: Types.ObjectId | null) => ({
      _id: oid(),
      customer: [customer],
      customerId: customer._id,
      type: AppointmentType.SITE_VISIT,
      title: '',
      startAt: new Date(),
      endAt: null,
      location: '',
      note: '',
      assigneeId: userId,
      remindBeforeMinutes: [],
      status: 'SCHEDULED',
      completedAt: null,
      outcome: null,
      createdBy: userId,
      projectId,
      projectCode: projectId ? 'QTERRA' : null,
      __v: 0,
    });
    appointmentModel.aggregate.mockReturnValue({
      exec: () =>
        Promise.resolve([
          {
            rows: [row(projectA.id), row(projectA.id), row(null)],
            total: [{ count: 3 }],
          },
        ]),
    });
    refs.resolveByIds.mockResolvedValue([projectA]);
    refs.resolve.mockResolvedValue({
      statuses: new Map(),
      users: new Map([[String(userId), 'A']]),
    });

    const { data } = await service.list(jwt, query({}));

    expect(refs.resolveByIds).toHaveBeenCalledTimes(1);
    expect(data.map((item) => item.project)).toEqual([
      { id: String(projectA.id), code: 'QTERRA', label: 'Q Terra' },
      { id: String(projectA.id), code: 'QTERRA', label: 'Q Terra' },
      null,
    ]);
  });
});

describe('AppointmentsService.create: projectId/projectCode mâu thuẫn (FR-40)', () => {
  it.each([
    [null, 'QTERRA'],
    [String(oid()), null],
  ])(
    'FR-40: (%p, %p) => 400 VALIDATION_FAILED trước khi mở transaction',
    async (projectId, projectCode) => {
      const { service } = buildService();
      await expect(
        service.create(jwt, {
          customerId: String(oid()),
          type: AppointmentType.SITE_VISIT,
          startAt: new Date().toISOString(),
          projectId,
          projectCode,
        }),
      ).rejects.toMatchObject({ details: { field: 'projectCode' } });
    },
  );
});

describe('AppointmentsService.list: lọc theo người thực hiện qua assigneeFilter (FR-30)', () => {
  const assigneeA = oid();
  const assigneeB = oid();

  it('FR-30: chỉ assigneeIds => một $or của assigneeFilter (nhánh assigneeIds + nhánh lịch chưa backfill), ids ép ObjectId', async () => {
    const { service, appointmentModel } = buildService();
    await service.list(
      jwt,
      query({ assigneeIds: [String(assigneeA), String(assigneeB)] }),
    );
    const match = firstMatch(appointmentModel);
    expect(match.$and).toEqual([{}, assigneeFilter([assigneeA, assigneeB])]);
    expect(match).not.toHaveProperty('assigneeId');
    expect(match).not.toHaveProperty('$or');
  });

  it('FR-30: projectCode + assigneeIds cùng lúc => $and gộp hai $or, KHÔNG đè nhau (lỗi trải chung khóa $or)', async () => {
    const { service, appointmentModel, refs } = buildService();
    refs.resolveByCodes.mockResolvedValue([projectA]);
    await service.list(
      jwt,
      query({ projectCode: 'qterra', assigneeIds: [String(assigneeA)] }),
    );
    const match = firstMatch(appointmentModel);
    expect(match).not.toHaveProperty('$or');
    expect(match.$and).toEqual([
      {
        $or: [
          { projectCode: 'QTERRA' },
          { projectCode: null, projectId: projectA.id },
        ],
      },
      assigneeFilter([assigneeA]),
    ]);
  });

  it('FR-30: không lọc người thực hiện => KHÔNG có $and (truy vấn cũ giữ nguyên, kể cả bộ lọc dự án)', async () => {
    const { service, appointmentModel, refs } = buildService();
    refs.resolveByCodes.mockResolvedValue([projectA]);
    await service.list(jwt, query({ projectCode: 'qterra' }));
    expect(firstMatch(appointmentModel)).not.toHaveProperty('$and');
  });

  it('FR-30: dịch tên người thực hiện theo lô cho MỌI người của mọi lịch (assigneeIds ?? [assigneeId]), một lần resolve', async () => {
    const { service, appointmentModel, refs } = buildService();
    const customer = {
      _id: oid(),
      fullName: 'K',
      statusId: oid(),
      phone: null,
    };
    const base = {
      customer: [customer],
      customerId: customer._id,
      type: AppointmentType.SITE_VISIT,
      title: '',
      startAt: new Date(),
      endAt: null,
      location: '',
      note: '',
      remindBeforeMinutes: [],
      status: 'SCHEDULED',
      completedAt: null,
      outcome: null,
      createdBy: userId,
      projectId: null,
      projectCode: null,
      __v: 0,
    };
    appointmentModel.aggregate.mockReturnValue({
      exec: () =>
        Promise.resolve([
          {
            rows: [
              {
                ...base,
                _id: oid(),
                assigneeId: assigneeA,
                assigneeIds: [assigneeA, assigneeB],
              },
              // Lịch cũ chưa backfill: chỉ có assigneeId.
              { ...base, _id: oid(), assigneeId: assigneeB },
            ],
            total: [{ count: 2 }],
          },
        ]),
    });
    refs.resolve.mockResolvedValue({
      statuses: new Map(),
      users: new Map([
        [String(assigneeA), 'A'],
        [String(assigneeB), 'B'],
        [String(userId), 'U'],
      ]),
    });

    const { data } = await service.list(jwt, query({}));

    expect(refs.resolve).toHaveBeenCalledTimes(1);
    const asked = (
      refs.resolve.mock.calls[0][0] as { userIds: Types.ObjectId[] }
    ).userIds.map(String);
    expect(asked).toEqual(
      expect.arrayContaining([String(assigneeA), String(assigneeB)]),
    );
    expect(data[0].assignees.map((u) => u.displayName)).toEqual(['A', 'B']);
    expect(data[1].assignees.map((u) => u.displayName)).toEqual(['B']);
  });
});

describe('AppointmentsService.create: chuyển assigneeIds/assigneeId xuống writer (FR-30)', () => {
  it('FR-30: gửi assigneeIds (chuỗi) => writer nhận ObjectId; assigneeId cũ vẫn chuyển để writer áp luật "assigneeIds thắng"', async () => {
    const { service, writer } = buildService();
    // `create` mở transaction và dựng response: giả lập hai phần này, chỉ kiểm dữ liệu đưa xuống writer.
    (service as unknown as { connection: unknown }).connection =
      fakeConnection();
    writer.createInSession.mockResolvedValue({ appointment: {}, customer: {} });
    jest.spyOn(service as never, 'toResponse').mockResolvedValue({} as never);
    const a = oid();
    const b = oid();
    await service.create(jwt, {
      customerId: String(oid()),
      type: AppointmentType.SITE_VISIT,
      startAt: new Date().toISOString(),
      assigneeIds: [String(a), String(b)],
      assigneeId: String(b),
    });
    const input = writer.createInSession.mock.calls[0][1] as {
      assigneeIds: Types.ObjectId[];
      assigneeId: Types.ObjectId;
    };
    expect(input.assigneeIds.map(String)).toEqual([String(a), String(b)]);
    expect(String(input.assigneeId)).toBe(String(b));
  });
});
