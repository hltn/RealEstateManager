import { Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import type { CatalogRef } from '../customers/customer-refs.service';
import { AppointmentType } from './appointment.constants';
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
  return { service, appointmentModel, refs };
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
