import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import type { AccessContext } from '../customers/access/customer-access.service';
import type { CatalogRef } from '../customers/customer-refs.service';
import { AppointmentType } from './appointment.constants';
import type { AppointmentLean } from './appointment.mapper';
import { AppointmentsWriteService } from './appointments-write.service';

const session = { id: 'session' } as never;
const oid = () => new Types.ObjectId();
const userId = oid();
const customerId = oid();

const ctx = {
  actor: {
    userId,
    role: UserRole.STAFF,
    roles: [UserRole.STAFF],
    displayName: 'A',
    teamId: null,
    teamIds: [],
    managedTeamIds: [],
  },
  scope: {},
} as unknown as AccessContext;

const projectA: CatalogRef = {
  id: oid(),
  code: 'QTERRA',
  label: 'Q Terra',
};
const projectB: CatalogRef = {
  id: oid(),
  code: 'VINHOMES',
  label: 'Vinhomes',
};

/** Chuỗi query Mongoose giả: `.session().lean().exec()` ... đều trả về cùng một kết quả. */
const chain = <T>(result: T) => {
  const query: Record<string, jest.Mock> = {};
  for (const name of ['session', 'lean', 'sort', 'select']) {
    query[name] = jest.fn(() => query);
  }
  query.exec = jest.fn(() => Promise.resolve(result));
  return query;
};

const buildService = () => {
  const appointmentModel = {
    create: jest.fn(),
    findOne: jest.fn(() => chain(null)),
    findOneAndUpdate: jest.fn(),
  };
  const userModel = { exists: jest.fn(() => chain({ _id: userId })) };
  const repo = {
    findOne: jest.fn().mockResolvedValue({
      _id: customerId,
      fullName: 'Khách A',
      statusId: oid(),
      careTeam: [{ userId }],
      primaryAssigneeId: userId,
    }),
    updateOne: jest.fn().mockResolvedValue(undefined),
  };
  const refs = {
    resolveOneForAssign: jest.fn().mockResolvedValue(null),
    resolveByIds: jest.fn().mockResolvedValue([]),
    lockAndAssert: jest.fn().mockResolvedValue(undefined),
    resolve: jest.fn().mockResolvedValue({ users: new Map() }),
  };
  const settings = {
    get: jest
      .fn()
      .mockResolvedValue({ defaultAppointmentReminderMinutes: [60] }),
  };
  const reminders = { syncAppointment: jest.fn().mockResolvedValue(undefined) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new AppointmentsWriteService(
    appointmentModel as never,
    userModel as never,
    repo as never,
    refs as never,
    settings as never,
    reminders as never,
    audit as never,
  );
  return { service, appointmentModel, refs, audit };
};

const startAt = () => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

describe('AppointmentsWriteService.createInSession: ghi kép projectId + projectCode (FR-40)', () => {
  const createdDoc = (extra: Record<string, unknown> = {}) => ({
    toObject: () => ({
      _id: oid(),
      customerId,
      type: AppointmentType.SITE_VISIT,
      title: '',
      startAt: startAt(),
      assigneeId: userId,
      remindBeforeMinutes: [60],
      ...extra,
    }),
  });

  it('FR-40: gửi projectCode => dịch về id, ghi cả projectId lẫn projectCode, khóa ghi dự án, audit ghi nhãn', async () => {
    const { service, appointmentModel, refs, audit } = buildService();
    refs.resolveOneForAssign.mockResolvedValue(projectA);
    appointmentModel.create.mockResolvedValue([createdDoc()]);

    await service.createInSession(
      ctx,
      {
        customerId,
        type: AppointmentType.SITE_VISIT,
        startAt: startAt(),
        projectCode: 'qterra',
      },
      'WEB',
      session,
    );

    expect(refs.resolveOneForAssign).toHaveBeenCalledWith(
      'project',
      { id: undefined, code: 'qterra' },
      'projectCode',
      session,
    );
    expect(refs.lockAndAssert).toHaveBeenCalledWith(
      { appointmentProjectId: projectA.id },
      session,
    );
    const [[doc]] = appointmentModel.create.mock.calls[0] as [
      [Record<string, unknown>],
    ];
    expect(doc).toMatchObject({
      projectId: projectA.id,
      projectCode: 'QTERRA',
    });
    const changes = (audit.record.mock.calls[0] as [{ changes: unknown[] }])[0]
      .changes;
    expect(changes).toContainEqual({
      field: 'appointment.project',
      from: null,
      to: 'Q Terra',
    });
  });

  it('FR-40 (tương thích): chỉ gửi projectId (PWA cũ) => vẫn ghi kép, details.field là projectId', async () => {
    const { service, appointmentModel, refs } = buildService();
    refs.resolveOneForAssign.mockResolvedValue(projectA);
    appointmentModel.create.mockResolvedValue([createdDoc()]);

    await service.createInSession(
      ctx,
      {
        customerId,
        type: AppointmentType.SITE_VISIT,
        startAt: startAt(),
        projectId: projectA.id,
      },
      'WEB',
      session,
    );

    expect(refs.resolveOneForAssign).toHaveBeenCalledWith(
      'project',
      { id: projectA.id, code: undefined },
      'projectId',
      session,
    );
    const [[doc]] = appointmentModel.create.mock.calls[0] as [
      [Record<string, unknown>],
    ];
    expect(doc).toMatchObject({
      projectId: projectA.id,
      projectCode: 'QTERRA',
    });
  });

  it('FR-40: không gắn dự án => projectId và projectCode đều null, không thêm dòng audit project', async () => {
    const { service, appointmentModel, audit } = buildService();
    appointmentModel.create.mockResolvedValue([createdDoc()]);

    await service.createInSession(
      ctx,
      {
        customerId,
        type: AppointmentType.SITE_VISIT,
        startAt: startAt(),
      },
      'WEB',
      session,
    );

    const [[doc]] = appointmentModel.create.mock.calls[0] as [
      [Record<string, unknown>],
    ];
    expect(doc).toMatchObject({ projectId: null, projectCode: null });
    const changes = (
      audit.record.mock.calls[0] as [{ changes: Array<{ field: string }> }]
    )[0].changes;
    expect(changes.map((change) => change.field)).not.toContain(
      'appointment.project',
    );
  });

  it('FR-40: dự án không hợp lệ (ném 400 từ CustomerRefsService) => KHÔNG tạo lịch', async () => {
    const { service, appointmentModel, refs } = buildService();
    refs.resolveOneForAssign.mockRejectedValue(new Error('400 từ refs'));

    await expect(
      service.createInSession(
        ctx,
        {
          customerId,
          type: AppointmentType.SITE_VISIT,
          startAt: startAt(),
          projectCode: 'KHONGCO',
        },
        'WEB',
        session,
      ),
    ).rejects.toThrow('400 từ refs');
    expect(appointmentModel.create).not.toHaveBeenCalled();
  });
});

describe('AppointmentsWriteService.updateInSession: đổi dự án ghi kép (FR-40)', () => {
  const baseAppointment = (extra: Partial<AppointmentLean> = {}) =>
    ({
      _id: oid(),
      customerId,
      type: AppointmentType.SITE_VISIT,
      title: '',
      location: '',
      note: '',
      startAt: startAt(),
      endAt: null,
      assigneeId: userId,
      remindBeforeMinutes: [60],
      status: 'SCHEDULED',
      projectId: projectA.id,
      projectCode: 'QTERRA',
      createdBy: userId,
      __v: 3,
      ...extra,
    }) as unknown as AppointmentLean;

  const setup = (appointment: AppointmentLean) => {
    const built = buildService();
    built.appointmentModel.findOne.mockImplementation(() => chain(appointment));
    built.appointmentModel.findOneAndUpdate.mockImplementation(() =>
      chain({ ...appointment, __v: appointment.__v + 1 }),
    );
    built.refs.resolveByIds.mockResolvedValue([projectA]);
    return built;
  };

  /** `$set` mà service gửi xuống `findOneAndUpdate` (undefined nếu không ghi). */
  const writtenSet = (appointmentModel: {
    findOneAndUpdate: jest.Mock;
  }): Record<string, unknown> | undefined =>
    (
      appointmentModel.findOneAndUpdate.mock.calls[0] as
        | [unknown, { $set: Record<string, unknown> }]
        | undefined
    )?.[1].$set;

  it('FR-40: đổi sang dự án khác bằng projectCode => $set projectId + projectCode mới, khóa ghi, audit từ nhãn cũ sang nhãn mới', async () => {
    const { service, appointmentModel, refs, audit } = setup(baseAppointment());
    refs.resolveOneForAssign.mockResolvedValue(projectB);

    await service.updateInSession(
      ctx,
      String(oid()),
      { projectCode: 'vinhomes' },
      'WEB',
      session,
    );

    expect(writtenSet(appointmentModel)).toMatchObject({
      projectId: projectB.id,
      projectCode: 'VINHOMES',
    });
    expect(refs.lockAndAssert).toHaveBeenCalledWith(
      { appointmentProjectId: projectB.id },
      session,
    );
    const changes = (audit.record.mock.calls[0] as [{ changes: unknown[] }])[0]
      .changes;
    expect(changes).toContainEqual({
      field: 'appointment.project',
      from: 'Q Terra',
      to: 'Vinhomes',
    });
  });

  it('FR-40: gỡ dự án bằng projectCode null => projectId và projectCode cùng về null', async () => {
    const { service, appointmentModel, refs } = setup(baseAppointment());

    await service.updateInSession(
      ctx,
      String(oid()),
      { projectCode: null },
      'WEB',
      session,
    );

    expect(writtenSet(appointmentModel)).toMatchObject({
      projectId: null,
      projectCode: null,
    });
    expect(refs.resolveOneForAssign).not.toHaveBeenCalled();
  });

  it('FR-40: gỡ dự án khi lịch chưa gắn dự án => không ghi gì', async () => {
    const { service, appointmentModel } = setup(
      baseAppointment({ projectId: null, projectCode: null }),
    );
    await service.updateInSession(
      ctx,
      String(oid()),
      { projectId: null },
      'WEB',
      session,
    );
    expect(appointmentModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['projectCode (khác hoa/thường)', { projectCode: 'qterra' }],
    ['projectId', { projectId: String(projectA.id) }],
    [
      'cả hai cùng dự án',
      { projectId: String(projectA.id), projectCode: 'QTERRA' },
    ],
  ])(
    'FR-40: gửi lại đúng dự án hiện có (%s) => bỏ qua kiểm "còn hoạt động", không ghi, không khóa',
    async (_label, dto) => {
      const { service, appointmentModel, refs } = setup(baseAppointment());

      await service.updateInSession(ctx, String(oid()), dto, 'WEB', session);

      expect(refs.resolveOneForAssign).not.toHaveBeenCalled();
      expect(refs.lockAndAssert).not.toHaveBeenCalled();
      expect(appointmentModel.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  // Architecture 5.1.8a: dự án đã xóa cứng (không còn trong danh mục => resolveByIds trả rỗng) hoặc xóa mềm
  // (resolveByIds vẫn trả về) mà client gửi lại đúng giá trị đang lưu thì KHÔNG được 400.
  it.each([
    ['xóa cứng, gửi projectCode', { projectCode: 'qterra' }],
    ['xóa cứng, gửi projectId', { projectId: String(projectA.id) }],
    [
      'xóa cứng, gửi cả hai',
      { projectId: String(projectA.id), projectCode: 'QTERRA' },
    ],
  ])(
    'FR-40: dự án đã bị %s đúng giá trị đang lưu => không đổi, không 400, không ghi',
    async (_label, dto) => {
      const { service, appointmentModel, refs } = setup(baseAppointment());
      refs.resolveByIds.mockResolvedValue([]);

      await service.updateInSession(ctx, String(oid()), dto, 'WEB', session);

      expect(refs.resolveOneForAssign).not.toHaveBeenCalled();
      expect(refs.lockAndAssert).not.toHaveBeenCalled();
      expect(appointmentModel.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  it('FR-40: dự án đã xóa mềm (vẫn tra được) + gửi lại đúng projectCode => không đổi, không 400, không ghi', async () => {
    const { service, appointmentModel, refs } = setup(baseAppointment());
    refs.resolveByIds.mockResolvedValue([projectA]);

    await service.updateInSession(
      ctx,
      String(oid()),
      { projectCode: 'QTERRA' },
      'WEB',
      session,
    );

    expect(refs.resolveOneForAssign).not.toHaveBeenCalled();
    expect(appointmentModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('FR-40: dự án hiện tại đã xóa cứng nhưng client gửi mã dự án KHÁC => vẫn đi qua kiểm gán mới (ghi nhận dự án mới)', async () => {
    const { service, appointmentModel, refs } = setup(baseAppointment());
    refs.resolveByIds.mockResolvedValue([]);
    refs.resolveOneForAssign.mockResolvedValue(projectB);

    await service.updateInSession(
      ctx,
      String(oid()),
      { projectCode: projectB.code },
      'WEB',
      session,
    );

    expect(refs.resolveOneForAssign).toHaveBeenCalledTimes(1);
    expect(writtenSet(appointmentModel)).toMatchObject({
      projectId: projectB.id,
      projectCode: projectB.code,
    });
  });

  it('FR-40: gửi id của dự án hiện có nhưng code của dự án khác => đi qua kiểm chặt của CustomerRefsService (400), không ghi', async () => {
    const { service, appointmentModel, refs } = setup(baseAppointment());
    refs.resolveOneForAssign.mockRejectedValue(new Error('id và code lệch'));

    await expect(
      service.updateInSession(
        ctx,
        String(oid()),
        { projectId: String(projectA.id), projectCode: 'VINHOMES' },
        'WEB',
        session,
      ),
    ).rejects.toThrow('id và code lệch');
    expect(appointmentModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['projectId null + projectCode có', { projectId: null, projectCode: 'X' }],
    [
      'projectId có + projectCode null',
      { projectId: String(projectB.id), projectCode: null },
    ],
  ])(
    'FR-40: %s => 400 VALIDATION_FAILED (field projectCode), không ghi',
    async (_label, dto) => {
      const { service, appointmentModel } = setup(baseAppointment());

      await expect(
        service.updateInSession(ctx, String(oid()), dto, 'WEB', session),
      ).rejects.toMatchObject({ details: { field: 'projectCode' } });
      expect(appointmentModel.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  it('FR-40: không gửi projectId/projectCode => giữ nguyên dự án, không tra danh mục', async () => {
    const { service, appointmentModel, refs } = setup(baseAppointment());
    await service.updateInSession(
      ctx,
      String(oid()),
      { title: 'Đổi tiêu đề' },
      'WEB',
      session,
    );
    expect(refs.resolveByIds).not.toHaveBeenCalled();
    expect(writtenSet(appointmentModel)).not.toHaveProperty('projectId');
    expect(writtenSet(appointmentModel)).not.toHaveProperty('projectCode');
  });
});
