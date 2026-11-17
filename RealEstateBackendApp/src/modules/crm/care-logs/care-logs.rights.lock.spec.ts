import { Types } from 'mongoose';
import { AppointmentType } from '../appointments/appointment.constants';
import { AppointmentsWriteService } from '../appointments/appointments-write.service';
import {
  buildAccess,
  buildCustomer,
  buildScopedRepo,
  chain,
  ctxOf,
  fakeConnection,
  IN_SCOPE_KEYS,
  jwtOf,
  OUT_OF_SCOPE_KEYS,
  REJECTS,
  USERS,
  type UserKey,
} from '../customers/access/customer-rights.fixture';
import { AttachmentStatus } from './care-log.constants';
import { CareLogAttachmentsService } from './care-log-attachments.service';
import { CareLogsService } from './care-logs.service';

/**
 * T-54 (FR-31): KHÓA HIỆN TRẠNG quyền nhật ký chăm sóc và ảnh đính kèm bằng `buildCustomerScope` +
 * `CustomersRepository` THẬT.
 * - (a, b, c): ngoài phạm vi bị chặn; trong phạm vi (cả R8, e3) tạo được nhật ký kèm `nextAction.appointment`.
 * - (e): sửa/xóa nhật ký và gỡ ảnh: Admin/Manager trong phạm vi hoặc tác giả; Staff không phải tác giả bị chặn.
 * Hậu tố `[đảo ở T-56]` = hành vi hiện tại sẽ đổi ở T-56; test không hậu tố phải xanh đến hết T-61.
 */

const future = (): Date => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

/** Nhật ký do STAFF_MEMBER viết: "người khác" với mọi vai trò còn lại. */
const makeLog = (customerId: Types.ObjectId) => ({
  _id: new Types.ObjectId(),
  customerId,
  authorId: USERS.STAFF_MEMBER.userId,
  authorName: USERS.STAFF_MEMBER.displayName,
  occurredAt: new Date('2026-10-20T03:00:00Z'),
  content: 'Nội dung cũ',
  contactChannel: 'CALL',
  contactResultId: null,
  contactResultCode: null,
  attachments: [],
  nextAction: null,
  source: 'MANUAL',
  editedAt: null,
  deletedAt: null,
  __v: 0,
});

const exec = <T>(result: T) => ({ exec: () => Promise.resolve(result) });

const build = () => {
  const customer = buildCustomer();
  const { repo } = buildScopedRepo([customer]);
  const log = makeLog(customer._id);

  const careLogModel = {
    create: jest.fn(([doc]: Array<Record<string, unknown>>) =>
      Promise.resolve([{ toObject: () => doc }]),
    ),
    findOne: jest.fn((filter: Record<string, unknown>) =>
      chain(
        filter._id &&
          (filter._id as Types.ObjectId).equals(log._id) &&
          filter.deletedAt === null
          ? { ...log }
          : null,
      ),
    ),
    updateOne: jest.fn(() => exec({})),
  };

  // Lịch hẹn tạo kèm nhật ký đi qua writer THẬT (cùng scope), để (a, b) kiểm cả đường `nextAction.appointment`.
  const appointmentModel = {
    // `refreshCustomer` của writer tìm lịch sắp tới của khách: giả lập chưa có lịch nào.
    findOne: jest.fn(() => chain(null)),
    create: jest.fn(([doc]: Array<Record<string, unknown>>) =>
      Promise.resolve([
        {
          toObject: () => ({
            _id: new Types.ObjectId(),
            __v: 0,
            status: 'SCHEDULED',
            remindBeforeMinutes: [60],
            ...doc,
          }),
        },
      ]),
    ),
  };
  const refs = {
    resolveOneForAssign: jest.fn().mockResolvedValue(null),
    resolveByIds: jest.fn().mockResolvedValue([]),
    lockAndAssert: jest.fn().mockResolvedValue(undefined),
    resolve: jest.fn().mockResolvedValue({ users: new Map() }),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const writer = new AppointmentsWriteService(
    appointmentModel as never,
    { exists: jest.fn(() => chain({ _id: new Types.ObjectId() })) } as never,
    repo,
    refs as never,
    {
      get: jest
        .fn()
        .mockResolvedValue({ defaultAppointmentReminderMinutes: [60] }),
    } as never,
    { syncAppointment: jest.fn().mockResolvedValue(undefined) } as never,
    audit as never,
  );

  const attachments = {
    attachToCareLog: jest.fn().mockResolvedValue([]),
    detachFromCareLog: jest.fn().mockResolvedValue([]),
    signUrls: jest.fn().mockResolvedValue(new Map()),
    purgeFiles: jest.fn().mockResolvedValue(undefined),
  };
  const service = new CareLogsService(
    fakeConnection() as never,
    careLogModel as never,
    repo,
    buildAccess() as never,
    refs as never,
    attachments as never,
    audit as never,
    { isEnabled: jest.fn().mockReturnValue(true) } as never,
    writer,
    {
      syncFollowUp: jest.fn().mockResolvedValue(undefined),
      cancelFollowUp: jest.fn().mockResolvedValue(undefined),
    } as never,
    { dispatch: jest.fn().mockResolvedValue(undefined) } as never,
    {
      get: jest.fn().mockResolvedValue({ careLogNotifyDebounceMinutes: 0 }),
    } as never,
  );
  return { service, customer, log, careLogModel, appointmentModel };
};

const customerIdOf = (h: { customer: { _id: Types.ObjectId } }) =>
  String(h.customer._id);

// ============================================================================================
// A9 Tạo nhật ký kèm lịch hẹn (a, b, c, e3)
// ============================================================================================
describe('CareLogsService.createInSession: nhật ký kèm nextAction.appointment (FR-31 a, b, c, e3)', () => {
  const dto = () => ({
    content: 'Gọi lần 1',
    contactChannel: 'CALL',
    nextAction: {
      suggestion: 'Dẫn đi xem nhà',
      dueAt: future().toISOString(),
      appointment: { type: AppointmentType.SITE_VISIT },
    },
  });
  const create = (h: ReturnType<typeof build>, key: UserKey) =>
    h.service.createInSession(
      ctxOf(key),
      customerIdOf(h),
      dto() as never,
      'WEB',
      {} as never,
    );

  it.each(OUT_OF_SCOPE_KEYS)(
    'FR-31 (a, c): %s ngoài phạm vi => 404 CUSTOMER_NOT_FOUND, không tạo nhật ký lẫn lịch hẹn',
    async (key) => {
      const h = build();
      await expect(create(h, key)).rejects.toMatchObject(
        REJECTS.CUSTOMER_NOT_FOUND,
      );
      expect(h.careLogModel.create).not.toHaveBeenCalled();
      expect(h.appointmentModel.create).not.toHaveBeenCalled();
    },
  );

  it.each(IN_SCOPE_KEYS)(
    'FR-31 (b, e3): %s trong phạm vi tạo được nhật ký kèm lịch hẹn, authorId = chính mình (giữ ở T-56; gồm R8 = Manager nhóm khác)',
    async (key) => {
      const h = build();
      const created = await create(h, key);
      expect(created.authorId).toEqual(USERS[key].userId);
      expect(h.careLogModel.create).toHaveBeenCalledTimes(1);
      expect(h.appointmentModel.create).toHaveBeenCalledTimes(1);
    },
  );

  it('FR-31 (e3) D13: R8 (Manager nhóm khác, không trong careTeam) tạo nhật ký kèm lịch; lịch giao cho PRIMARY của khách', async () => {
    const h = build();
    await create(h, 'MANAGER_R8');
    // `Model.create([doc], opts)`: đối số đầu là mảng chứa tài liệu.
    const [[[doc]]] = h.appointmentModel.create.mock.calls as unknown as Array<
      [[Record<string, unknown>]]
    >;
    expect(doc.assigneeId).toEqual(USERS.STAFF_PRIMARY.userId);
    expect(doc.createdBy).toEqual(USERS.MANAGER_R8.userId);
  });
});

// ============================================================================================
// A9/A10 Sửa, xóa nhật ký (e)
// ============================================================================================
describe('CareLogsService.update: sửa nhật ký (FR-31 a, e)', () => {
  const edit = (h: ReturnType<typeof build>, key: UserKey) =>
    h.service.update(
      jwtOf(key),
      customerIdOf(h),
      String(h.log._id),
      { content: 'Nội dung mới' },
      'WEB',
    );

  it.each(OUT_OF_SCOPE_KEYS)(
    'FR-31 (a, c): %s ngoài phạm vi => 404 CUSTOMER_NOT_FOUND, không ghi',
    async (key) => {
      const h = build();
      await expect(edit(h, key)).rejects.toMatchObject(
        REJECTS.CUSTOMER_NOT_FOUND,
      );
      expect(h.careLogModel.updateOne).not.toHaveBeenCalled();
    },
  );

  it.each(['STAFF_MEMBER', 'ADMIN'] as UserKey[])(
    'FR-31 (e): %s (tác giả hoặc Admin) sửa được nhật ký (giữ ở T-56)',
    async (key) => {
      const h = build();
      await edit(h, key);
      expect(h.careLogModel.updateOne).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['STAFF_PRIMARY', 'STAFF_INVITED'] as UserKey[])(
    'FR-31 (e): %s (Staff trong careTeam, không phải tác giả) sửa nhật ký người khác => 403 INSUFFICIENT_ROLE (giữ ở T-56)',
    async (key) => {
      const h = build();
      await expect(edit(h, key)).rejects.toMatchObject(
        REJECTS.INSUFFICIENT_ROLE,
      );
      expect(h.careLogModel.updateOne).not.toHaveBeenCalled();
    },
  );

  it.each(['MANAGER_OWNER', 'MANAGER_R8', 'MANAGER_INCARE'] as UserKey[])(
    'FR-31 (e): %s (Manager trong phạm vi, không phải tác giả) hiện sửa được nhật ký của người khác [đảo ở T-56]',
    async (key) => {
      const h = build();
      await edit(h, key);
      expect(h.careLogModel.updateOne).toHaveBeenCalledTimes(1);
    },
  );
});

describe('CareLogsService.remove: xóa nhật ký (FR-31 a, e)', () => {
  const remove = (h: ReturnType<typeof build>, key: UserKey) =>
    h.service.remove(
      jwtOf(key),
      customerIdOf(h),
      String(h.log._id),
      undefined,
      'WEB',
    );
  const softDeleted = (h: ReturnType<typeof build>, key: UserKey) =>
    expect(h.careLogModel.updateOne).toHaveBeenCalledWith(
      { _id: h.log._id },
      { $set: { deletedAt: expect.any(Date), deletedBy: USERS[key].userId } },
      expect.anything(),
    );

  it.each(OUT_OF_SCOPE_KEYS)(
    'FR-31 (a, c): %s ngoài phạm vi => 404 CUSTOMER_NOT_FOUND, không xóa',
    async (key) => {
      const h = build();
      await expect(remove(h, key)).rejects.toMatchObject(
        REJECTS.CUSTOMER_NOT_FOUND,
      );
      expect(h.careLogModel.updateOne).not.toHaveBeenCalled();
    },
  );

  it.each(['STAFF_MEMBER', 'ADMIN'] as UserKey[])(
    'FR-31 (e): %s (tác giả hoặc Admin) xóa được nhật ký (giữ ở T-56)',
    async (key) => {
      const h = build();
      await remove(h, key);
      softDeleted(h, key);
    },
  );

  it.each(['STAFF_PRIMARY', 'STAFF_INVITED'] as UserKey[])(
    'FR-31 (e): %s (Staff trong careTeam, không phải tác giả) xóa nhật ký người khác => 403 INSUFFICIENT_ROLE (giữ ở T-56)',
    async (key) => {
      const h = build();
      await expect(remove(h, key)).rejects.toMatchObject(
        REJECTS.INSUFFICIENT_ROLE,
      );
      expect(h.careLogModel.updateOne).not.toHaveBeenCalled();
    },
  );

  it.each(['MANAGER_OWNER', 'MANAGER_R8', 'MANAGER_INCARE'] as UserKey[])(
    'FR-31 (e): %s (Manager trong phạm vi, không phải tác giả) hiện xóa được nhật ký của người khác [đảo ở T-56]',
    async (key) => {
      const h = build();
      await remove(h, key);
      softDeleted(h, key);
    },
  );
});

// ============================================================================================
// A11 Gỡ ảnh đính kèm (e)
// ============================================================================================
describe('CareLogAttachmentsService.remove: gỡ ảnh đính kèm (FR-31 a, e)', () => {
  /** Ảnh do STAFF_MEMBER tải lên (và, khi ATTACHED, gắn vào nhật ký do STAFF_MEMBER viết). */
  const buildAttachmentCase = (status: AttachmentStatus) => {
    const base = build();
    const { repo } = buildScopedRepo([base.customer]);
    const attachment = {
      _id: new Types.ObjectId(),
      customerId: base.customer._id,
      status,
      careLogId: status === AttachmentStatus.ATTACHED ? base.log._id : null,
      uploaderId: USERS.STAFF_MEMBER.userId,
      fileKey: 'attachments/a.jpg',
      thumbKey: null,
    };
    const attachmentModel = {
      findOne: jest.fn(() => chain({ ...attachment })),
      updateOne: jest.fn(() => exec({})),
      updateMany: jest.fn(() => exec({})),
    };
    const storage = { delete: jest.fn().mockResolvedValue(undefined) };
    const service = new CareLogAttachmentsService(
      fakeConnection() as never,
      attachmentModel as never,
      base.careLogModel as never,
      storage as never,
      repo,
      buildAccess() as never,
      {} as never,
      { record: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
    );
    return { ...base, attachment, attachmentModel, service };
  };

  const removeAttachment = (
    h: ReturnType<typeof buildAttachmentCase>,
    key: UserKey,
  ) =>
    h.service.remove(
      jwtOf(key),
      customerIdOf(h),
      String(h.attachment._id),
      'WEB',
    );
  const markedRemoved = (
    h: ReturnType<typeof buildAttachmentCase>,
    key: UserKey,
  ) =>
    expect(h.attachmentModel.updateOne).toHaveBeenCalledWith(
      { _id: h.attachment._id },
      {
        $set: {
          status: AttachmentStatus.REMOVED,
          removedAt: expect.any(Date),
          removedBy: USERS[key].userId,
        },
      },
      expect.anything(),
    );

  describe('ảnh ĐÃ gắn vào nhật ký (theo quyền sửa nhật ký)', () => {
    const attached = () => buildAttachmentCase(AttachmentStatus.ATTACHED);

    it.each(OUT_OF_SCOPE_KEYS)(
      'FR-31 (a, c): %s ngoài phạm vi => 404 CUSTOMER_NOT_FOUND, không gỡ',
      async (key) => {
        const h = attached();
        await expect(removeAttachment(h, key)).rejects.toMatchObject(
          REJECTS.CUSTOMER_NOT_FOUND,
        );
        expect(h.attachmentModel.updateOne).not.toHaveBeenCalled();
      },
    );

    it.each(['STAFF_MEMBER', 'ADMIN'] as UserKey[])(
      'FR-31 (e): %s (tác giả nhật ký hoặc Admin) gỡ được ảnh (giữ ở T-56)',
      async (key) => {
        const h = attached();
        await removeAttachment(h, key);
        markedRemoved(h, key);
      },
    );

    it.each(['STAFF_PRIMARY', 'STAFF_INVITED'] as UserKey[])(
      'FR-31 (e): %s (Staff không phải tác giả nhật ký) gỡ ảnh đã gắn => 403 INSUFFICIENT_ROLE (giữ ở T-56)',
      async (key) => {
        const h = attached();
        await expect(removeAttachment(h, key)).rejects.toMatchObject(
          REJECTS.INSUFFICIENT_ROLE,
        );
        expect(h.attachmentModel.updateOne).not.toHaveBeenCalled();
      },
    );

    it.each(['MANAGER_OWNER', 'MANAGER_R8', 'MANAGER_INCARE'] as UserKey[])(
      'FR-31 (e): %s (Manager trong phạm vi, không phải tác giả) hiện gỡ được ảnh đã gắn của người khác [đảo ở T-56]',
      async (key) => {
        const h = attached();
        await removeAttachment(h, key);
        markedRemoved(h, key);
      },
    );
  });

  describe('ảnh CHƯA gắn (theo người tải lên)', () => {
    const unattached = () => buildAttachmentCase(AttachmentStatus.READY);

    it.each(OUT_OF_SCOPE_KEYS)(
      'FR-31 (a, c): %s ngoài phạm vi => 404 CUSTOMER_NOT_FOUND, không gỡ',
      async (key) => {
        const h = unattached();
        await expect(removeAttachment(h, key)).rejects.toMatchObject(
          REJECTS.CUSTOMER_NOT_FOUND,
        );
        expect(h.attachmentModel.updateOne).not.toHaveBeenCalled();
      },
    );

    it.each(['STAFF_MEMBER', 'ADMIN'] as UserKey[])(
      'FR-31 (e): %s (người tải lên hoặc Admin) gỡ được ảnh chưa gắn (giữ ở T-56)',
      async (key) => {
        const h = unattached();
        await removeAttachment(h, key);
        markedRemoved(h, key);
      },
    );

    it.each(['STAFF_PRIMARY', 'STAFF_INVITED'] as UserKey[])(
      'FR-31 (e): %s (Staff không phải người tải lên) gỡ ảnh chưa gắn => 404 RESOURCE_NOT_FOUND (giữ ở T-56)',
      async (key) => {
        const h = unattached();
        await expect(removeAttachment(h, key)).rejects.toMatchObject(
          REJECTS.RESOURCE_NOT_FOUND,
        );
        expect(h.attachmentModel.updateOne).not.toHaveBeenCalled();
      },
    );

    it.each(['MANAGER_OWNER', 'MANAGER_R8', 'MANAGER_INCARE'] as UserKey[])(
      'FR-31 (e): %s (Manager trong phạm vi, không phải người tải lên) hiện gỡ được ảnh chưa gắn của người khác [đảo ở T-56]',
      async (key) => {
        const h = unattached();
        await removeAttachment(h, key);
        markedRemoved(h, key);
      },
    );
  });
});
