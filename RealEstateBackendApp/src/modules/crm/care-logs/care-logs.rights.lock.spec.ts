import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';
import { AppointmentType } from '../appointments/appointment.constants';
import { AppointmentsWriteService } from '../appointments/appointments-write.service';
import {
  buildAccess,
  buildCustomer,
  buildScopedRepo,
  buildUserDirectory,
  chain,
  ctxOf,
  defaultCareTeam,
  fakeConnection,
  IN_SCOPE_KEYS,
  jwtOf,
  makeFixtureUser,
  OUT_OF_SCOPE_KEYS,
  REJECTS,
  USERS,
  type UserDirectoryOptions,
  type UserKey,
} from '../customers/access/customer-rights.fixture';
import { CareRole } from '../customers/customer.constants';
import { AttachmentStatus } from './care-log.constants';
import { CareLogAttachmentsService } from './care-log-attachments.service';
import { CareLogsService } from './care-logs.service';

/**
 * T-54 (FR-31) khóa hiện trạng, T-56 (FR-32) đảo phần bản ghi chỉ của mình: quyền nhật ký chăm sóc và ảnh đính kèm bằng `buildCustomerScope` +
 * `CustomersRepository` THẬT.
 * - (a, b, c): ngoài phạm vi bị chặn; trong phạm vi (cả R8, e3) tạo được nhật ký kèm `nextAction.appointment`.
 * - (e): sửa/xóa nhật ký và gỡ ảnh CHỈ tác giả hoặc Admin (ảnh chưa gắn: người tải hoặc Admin); Manager (kể cả
 *   nhóm chủ), người tạo khách, PRIMARY, người được mời bị 403 (ảnh chưa gắn của người khác: 404).
 * Hậu tố `[đảo ở T-56]` = test đã ĐẢO sang luật mới (không xóa); `(giữ ở T-56)` = ý giữ nguyên.
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

const build = (
  customer: ReturnType<typeof buildCustomer> = buildCustomer(),
  directoryOptions: UserDirectoryOptions = {},
) => {
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
  // Người thực hiện đọc từ thư mục tài khoản giả có luật thật (FR-30: careTeam ACTIVE ∪ Manager nhóm chủ ∪ người tạo).
  const directory = buildUserDirectory(directoryOptions);
  const writer = new AppointmentsWriteService(
    appointmentModel as never,
    directory.userModel as never,
    repo,
    refs as never,
    {
      get: jest
        .fn()
        .mockResolvedValue({ defaultAppointmentReminderMinutes: [60] }),
    } as never,
    { syncAppointment: jest.fn().mockResolvedValue(undefined) } as never,
    audit as never,
    directory.ownerTeam,
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
// FR-30 (T-55): người thực hiện của lịch hẹn tạo kèm nhật ký, qua MỘT luật với đường tạo lịch trực tiếp
// ============================================================================================
describe('CareLogsService.createInSession: assigneeIds của nextAction.appointment (FR-30)', () => {
  const dto = (assigneeIds?: string[]) => ({
    content: 'Gọi lần 1',
    contactChannel: 'CALL',
    nextAction: {
      suggestion: 'Dẫn đi xem nhà',
      dueAt: future().toISOString(),
      appointment: {
        type: AppointmentType.SITE_VISIT,
        ...(assigneeIds && { assigneeIds }),
      },
    },
  });
  const create = (
    h: ReturnType<typeof build>,
    key: UserKey,
    assigneeIds?: string[],
  ) =>
    h.service.createInSession(
      ctxOf(key),
      customerIdOf(h),
      dto(assigneeIds) as never,
      'WEB',
      {} as never,
    );
  const apptDoc = (h: ReturnType<typeof build>) => {
    const [[[doc]]] = h.appointmentModel.create.mock.calls as unknown as Array<
      [[Record<string, unknown>]]
    >;
    return doc;
  };
  const ids = (...keys: UserKey[]) =>
    keys.map((key) => String(USERS[key].userId));

  it('FR-30: nhiều người (careTeam + Manager nhóm chủ) được ghi kép: assigneeIds đủ thứ tự, assigneeId = người đầu', async () => {
    const h = build();
    await create(
      h,
      'STAFF_PRIMARY',
      ids('MANAGER_OWNER', 'STAFF_MEMBER', 'STAFF_INVITED'),
    );
    const doc = apptDoc(h);
    expect(doc.assigneeIds).toEqual([
      USERS.MANAGER_OWNER.userId,
      USERS.STAFF_MEMBER.userId,
      USERS.STAFF_INVITED.userId,
    ]);
    expect(doc.assigneeId).toEqual(USERS.MANAGER_OWNER.userId);
  });

  it('FR-30: Manager nhóm chủ ngoài careTeam đặt lịch qua nhật ký và là người thực hiện mặc định của chính mình', async () => {
    const h = build();
    await create(h, 'MANAGER_OWNER');
    const doc = apptDoc(h);
    expect(doc.assigneeIds).toEqual([USERS.MANAGER_OWNER.userId]);
    expect(doc.assigneeId).toEqual(USERS.MANAGER_OWNER.userId);
  });

  it('FR-30: người ghi nhật ký là thành viên careTeam thì mặc định chính mình', async () => {
    const h = build();
    await create(h, 'STAFF_MEMBER');
    expect(apptDoc(h).assigneeIds).toEqual([USERS.STAFF_MEMBER.userId]);
  });

  it('FR-30: Admin không thuộc tập hợp lệ (không phải người tạo) thì mặc định PRIMARY; chỉ định người ngoài tập thì 400', async () => {
    const h = build();
    await create(h, 'ADMIN');
    expect(apptDoc(h).assigneeIds).toEqual([USERS.STAFF_PRIMARY.userId]);

    const h2 = build();
    await expect(create(h2, 'ADMIN', ids('MANAGER_R8'))).rejects.toMatchObject(
      REJECTS.USER_NOT_ASSIGNABLE,
    );
    expect(h2.appointmentModel.create).not.toHaveBeenCalled();
  });

  it('FR-30: người ngoài tập hợp lệ (Manager nhóm khác, Staff ngoài careTeam) bị từ chối cả khi lẫn người hợp lệ', async () => {
    const h = build();
    await expect(
      create(h, 'STAFF_PRIMARY', ids('STAFF_MEMBER', 'STAFF_OUT')),
    ).rejects.toMatchObject(REJECTS.USER_NOT_ASSIGNABLE);
    expect(h.appointmentModel.create).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------------------------------
  // Tiêu chí xong của T-55: đường tạo lịch qua nhật ký dùng CÙNG luật tập hợp lệ với đường tạo lịch trực tiếp
  // ------------------------------------------------------------------------------------------
  const memberEntry = (key: UserKey, role: CareRole) => ({
    userId: USERS[key].userId,
    role,
    addedBy: USERS.STAFF_PRIMARY.userId,
    addedAt: new Date('2026-01-01T00:00:00Z'),
  });
  /** Khách có ADMIN trong careTeam: PRIMARY (kịch bản lỗi staging: Admin tạo khách) hoặc MEMBER (người khác tạo). */
  const customerWithAdminInCareTeam = (role: CareRole) =>
    role === CareRole.PRIMARY
      ? buildCustomer({
          careTeam: [
            memberEntry('ADMIN', CareRole.PRIMARY),
            ...defaultCareTeam()
              .slice(1)
              .map((entry) => ({ ...entry, role: CareRole.MEMBER })),
          ],
          primaryAssigneeId: USERS.ADMIN.userId,
          createdBy: USERS.ADMIN.userId,
        })
      : buildCustomer({
          careTeam: [
            ...defaultCareTeam(),
            memberEntry('ADMIN', CareRole.MEMBER),
          ],
        });
  /** Khách cũ do `creatorId` tạo mà người đó KHÔNG nằm trong careTeam (fixture dựng tay). */
  const customerCreatedBy = (creatorId: Types.ObjectId) =>
    buildCustomer({ createdBy: creatorId });
  const notAssignable = (userIds: string[], reason: string) => ({
    ...REJECTS.USER_NOT_ASSIGNABLE,
    details: { userIds, reason },
  });
  const savedBoth = (h: ReturnType<typeof build>) => {
    expect(h.careLogModel.create).toHaveBeenCalledTimes(1);
    expect(h.appointmentModel.create).toHaveBeenCalledTimes(1);
  };
  const notSaved = (h: ReturnType<typeof build>) => {
    expect(h.appointmentModel.create).not.toHaveBeenCalled();
    expect(h.careLogModel.create).not.toHaveBeenCalled();
  };

  describe.each([
    ['PRIMARY', CareRole.PRIMARY],
    ['MEMBER', CareRole.MEMBER],
  ])('Admin là %s trong careTeam (kịch bản lỗi staging cũ)', (_n, role) => {
    it('FR-30: Admin lưu nhật ký kèm lịch (mặc định chính mình): lưu cả nhật ký lẫn lịch, KHÔNG 400 USER_NOT_ASSIGNABLE', async () => {
      const h = build(customerWithAdminInCareTeam(role));
      const created = await create(h, 'ADMIN');
      expect(created.authorId).toEqual(USERS.ADMIN.userId);
      savedBoth(h);
      expect(apptDoc(h).assigneeIds).toEqual([USERS.ADMIN.userId]);
      expect(apptDoc(h).assigneeId).toEqual(USERS.ADMIN.userId);
    });

    it('FR-30: Admin tự giao lịch cho chính mình, kèm một người khác trong careTeam: được, thứ tự giữ nguyên', async () => {
      const h = build(customerWithAdminInCareTeam(role));
      await create(h, 'ADMIN', ids('ADMIN', 'STAFF_MEMBER'));
      savedBoth(h);
      expect(apptDoc(h).assigneeIds).toEqual([
        USERS.ADMIN.userId,
        USERS.STAFF_MEMBER.userId,
      ]);
    });

    it('FR-30: người khác trong careTeam giao lịch cho Admin (thành viên) qua nhật ký: được', async () => {
      const h = build(customerWithAdminInCareTeam(role));
      await create(h, 'STAFF_MEMBER', ids('ADMIN'));
      savedBoth(h);
      expect(apptDoc(h).assigneeIds).toEqual([USERS.ADMIN.userId]);
    });
  });

  it('FR-30: Admin KHÁC ngoài careTeam (không phải người tạo) tự giao cho mình qua nhật ký => 400 NOT_IN_CARE_TEAM, không lưu gì', async () => {
    const adminInTeam = makeFixtureUser('Admin tạo khách', {
      roles: [UserRole.ADMIN],
    });
    const h = build(
      buildCustomer({
        careTeam: [
          {
            userId: adminInTeam._id,
            role: CareRole.PRIMARY,
            addedBy: adminInTeam._id,
            addedAt: new Date('2026-01-01T00:00:00Z'),
          },
          memberEntry('STAFF_MEMBER', CareRole.MEMBER),
        ],
        primaryAssigneeId: adminInTeam._id,
        createdBy: adminInTeam._id,
      }),
      { extraUsers: [adminInTeam] },
    );
    await expect(create(h, 'ADMIN', ids('ADMIN'))).rejects.toMatchObject(
      notAssignable(ids('ADMIN'), 'NOT_IN_CARE_TEAM'),
    );
    notSaved(h);
  });

  describe('người tạo khách ngoài careTeam, đủ ba vai trò CRM, qua đường nhật ký', () => {
    it.each([
      ['ADMIN', [UserRole.ADMIN]],
      ['STAFF', [UserRole.STAFF]],
      ['MANAGER', [UserRole.MANAGER]],
    ])(
      'FR-30: người tạo %s ngoài careTeam được giao lịch qua nhật ký (khách cũ dựng tay): lưu cả nhật ký lẫn lịch',
      async (_n, roles) => {
        const creator = makeFixtureUser('Người tạo', { roles });
        const h = build(customerCreatedBy(creator._id), {
          extraUsers: [creator],
        });
        await create(h, 'ADMIN', [String(creator._id), ...ids('STAFF_MEMBER')]);
        savedBoth(h);
        expect(apptDoc(h).assigneeIds).toEqual([
          creator._id,
          USERS.STAFF_MEMBER.userId,
        ]);
        expect(apptDoc(h).assigneeId).toEqual(creator._id);
      },
    );
  });

  describe('người tạo không còn hoạt động, qua đường nhật ký', () => {
    it.each([
      ['bị khóa (BLOCKED)', { status: UserStatus.BLOCKED }],
      ['đã xóa mềm', { deletedAt: new Date('2026-02-01T00:00:00Z') }],
    ])(
      'FR-30: người tạo %s => 400 NOT_ACTIVE, không lưu nhật ký lẫn lịch',
      async (_n, over) => {
        const creator = makeFixtureUser('Người tạo', over);
        const h = build(customerCreatedBy(creator._id), {
          extraUsers: [creator],
        });
        await expect(
          create(h, 'ADMIN', [String(creator._id)]),
        ).rejects.toMatchObject(
          notAssignable([String(creator._id)], 'NOT_ACTIVE'),
        );
        notSaved(h);
      },
    );
  });

  describe('nguyên tử: lịch lỗi thì nhật ký không được lưu', () => {
    it('FR-30: người thực hiện ngoài tập hợp lệ => 400 và `careLogModel.create` KHÔNG được gọi (lịch được tạo TRƯỚC nhật ký)', async () => {
      const h = build();
      await expect(
        create(h, 'STAFF_PRIMARY', ids('STAFF_OUT')),
      ).rejects.toMatchObject(REJECTS.USER_NOT_ASSIGNABLE);
      notSaved(h);
    });

    it('FR-30: ghi lịch lỗi bất ngờ (DB) => lỗi nổi lên và `careLogModel.create` KHÔNG được gọi', async () => {
      const h = build();
      h.appointmentModel.create.mockRejectedValueOnce(new Error('DB lỗi'));
      await expect(create(h, 'STAFF_PRIMARY')).rejects.toThrow('DB lỗi');
      expect(h.careLogModel.create).not.toHaveBeenCalled();
    });
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
    'FR-32 (e) [đảo ở T-56]: %s (Manager trong phạm vi, không phải tác giả) sửa nhật ký của người khác => 403 INSUFFICIENT_ROLE, không ghi',
    async (key) => {
      const h = build();
      await expect(edit(h, key)).rejects.toMatchObject(
        REJECTS.INSUFFICIENT_ROLE,
      );
      expect(h.careLogModel.updateOne).not.toHaveBeenCalled();
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
    'FR-32 (e) [đảo ở T-56]: %s (Manager trong phạm vi, không phải tác giả) xóa nhật ký của người khác => 403 INSUFFICIENT_ROLE, không xóa',
    async (key) => {
      const h = build();
      await expect(remove(h, key)).rejects.toMatchObject(
        REJECTS.INSUFFICIENT_ROLE,
      );
      expect(h.careLogModel.updateOne).not.toHaveBeenCalled();
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
      'FR-32 (e) [đảo ở T-56]: %s (Manager trong phạm vi, không phải tác giả) gỡ ảnh đã gắn của người khác => 403 INSUFFICIENT_ROLE, không gỡ và không rút khỏi nhật ký',
      async (key) => {
        const h = attached();
        await expect(removeAttachment(h, key)).rejects.toMatchObject(
          REJECTS.INSUFFICIENT_ROLE,
        );
        expect(h.attachmentModel.updateOne).not.toHaveBeenCalled();
        expect(h.careLogModel.updateOne).not.toHaveBeenCalled();
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
      'FR-32 (e) [đảo ở T-56]: %s (Manager trong phạm vi, không phải người tải lên) gỡ ảnh chưa gắn của người khác => 404 RESOURCE_NOT_FOUND (không lộ sự tồn tại)',
      async (key) => {
        const h = unattached();
        await expect(removeAttachment(h, key)).rejects.toMatchObject(
          REJECTS.RESOURCE_NOT_FOUND,
        );
        expect(h.attachmentModel.updateOne).not.toHaveBeenCalled();
      },
    );

    it('FR-32 (e): Manager LÀ người tải lên thì gỡ được ảnh chưa gắn của chính mình', async () => {
      const h = unattached();
      h.attachment.uploaderId = USERS.MANAGER_OWNER.userId;
      await removeAttachment(h, 'MANAGER_OWNER');
      markedRemoved(h, 'MANAGER_OWNER');
    });
  });
});
