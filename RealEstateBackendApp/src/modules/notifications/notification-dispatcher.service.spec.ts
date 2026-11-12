import { Types } from 'mongoose';
import { registerAfterCommit } from '../../shared/database/after-commit.util';
import { QueueNames } from '../../shared/queue/queue.constants';
import {
  NotificationPriority,
  NotificationPushStatus,
  NotificationType,
} from './notification.constants';
import {
  NotificationDispatcher,
  NotificationRequest,
} from './notification-dispatcher.service';
import { getPushCatalogEntry, PushContext } from './push/push-catalog';
import { PushRenderError } from './push/push-content.renderer';
import { PushJobNames, pushSendJobId } from './push/push-queue.constants';

jest.mock('../../shared/database/after-commit.util', () => ({
  registerAfterCommit: jest.fn(),
}));

const registerAfterCommitMock = registerAfterCommit as jest.Mock;

const oid = () => new Types.ObjectId();
const ACTOR = oid();
const CUSTOMER = oid();

interface Operation {
  updateOne: {
    filter: { userId: Types.ObjectId; dedupeKey: string };
    update: { $setOnInsert: Record<string, any> };
    upsert: boolean;
  };
}

/** Dựng Dispatcher với model/provider/queue giả; `upserted` = chỉ số thao tác nào là bản MỚI tạo. */
const build = (
  options: {
    providerStatus?: NotificationPushStatus;
    preferences?: Array<{ userId: Types.ObjectId; types: any }>;
    upsertedIndexes?: number[] | 'all';
    queueAdd?: jest.Mock;
    admins?: Array<{ _id: Types.ObjectId }>;
    adminLookupError?: Error;
    /** Kho tài khoản giả cho lần tra người nhận; bỏ trống = mọi người nhận đều ACTIVE. */
    users?: Array<{
      _id: Types.ObjectId;
      status: string;
      deletedAt: Date | null;
    }>;
  } = {},
) => {
  const preferenceQuery = {
    select: jest.fn().mockReturnThis(),
    session: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(options.preferences ?? []),
  };
  const preferenceModel = { find: jest.fn().mockReturnValue(preferenceQuery) };
  const notificationModel = {
    bulkWrite: jest.fn().mockImplementation((ops: Operation[]) => {
      const indexes =
        options.upsertedIndexes === 'all' ||
        options.upsertedIndexes === undefined
          ? ops.map((_, i) => i)
          : options.upsertedIndexes;
      return Promise.resolve({
        upsertedCount: indexes.length,
        upsertedIds: Object.fromEntries(indexes.map((i) => [i, oid()])),
      });
    }),
  };
  // Truy vấn Quản trị (`roles`) trả `admins`; truy vấn người nhận (`_id: $in`) áp ĐÚNG điều kiện status/deletedAt của
  // bộ lọc lên kho `users` giả để test không phụ thuộc vào việc "tự trả về đúng thứ cần".
  const userModel = {
    find: jest.fn().mockImplementation((filter: Record<string, any>) => {
      const rows = (): Promise<Array<{ _id: Types.ObjectId }>> => {
        if (filter.roles !== undefined) {
          return options.adminLookupError
            ? Promise.reject(options.adminLookupError)
            : Promise.resolve(options.admins ?? []);
        }
        const candidates = filter._id.$in as Types.ObjectId[];
        if (!options.users)
          return Promise.resolve(candidates.map((_id) => ({ _id })));
        return Promise.resolve(
          options.users
            .filter(
              (user) =>
                candidates.some((id) => String(id) === String(user._id)) &&
                user.status === filter.status &&
                user.deletedAt === filter.deletedAt,
            )
            .map((user) => ({ _id: user._id })),
        );
      };
      return {
        select: jest.fn().mockReturnThis(),
        session: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockImplementation(rows),
      };
    }),
  };
  const provider = {
    initialStatus: jest
      .fn()
      .mockReturnValue(
        options.providerStatus ?? NotificationPushStatus.PENDING,
      ),
  };
  const queue = { add: options.queueAdd ?? jest.fn().mockResolvedValue({}) };
  // Mặc định chạy ngay như trường hợp không có transaction.
  registerAfterCommitMock.mockImplementation(
    (_session: unknown, callback: () => Promise<void>) => callback(),
  );
  const dispatcher = new NotificationDispatcher(
    notificationModel as never,
    preferenceModel as never,
    userModel as never,
    provider as never,
    queue as never,
  );
  return {
    dispatcher,
    notificationModel,
    preferenceModel,
    userModel,
    provider,
    queue,
  };
};

const request = (
  overrides: Partial<NotificationRequest> = {},
): NotificationRequest => ({
  type: NotificationType.CUSTOMER_ASSIGNED,
  recipientIds: [oid()],
  inApp: { title: 'Bạn được thêm vào khách', body: 'Nội dung trong app' },
  vars: { actorName: 'Lan', customerName: 'Anh Minh' },
  data: {
    customerId: CUSTOMER,
    deepLink: `/crm/customers/${String(CUSTOMER)}`,
  },
  context: { careRole: 'MEMBER', origin: 'TEAM_ADD' },
  dedupeKey: `ASSIGN:ADD:${String(CUSTOMER)}:2`,
  ...overrides,
});

/** Tài liệu ghi cho thao tác thứ `index` của lần `bulkWrite` đầu tiên. */
const writtenDoc = (notificationModel: { bulkWrite: jest.Mock }, index = 0) => {
  const operations = notificationModel.bulkWrite.mock
    .calls[0][0] as Operation[];
  return operations[index].updateOne.update.$setOnInsert;
};

describe('NotificationDispatcher.dispatch', () => {
  beforeEach(() => jest.clearAllMocks());

  it('không có yêu cầu thì không đụng DB', async () => {
    const { dispatcher, notificationModel } = build();
    await expect(dispatcher.dispatch([])).resolves.toEqual({ created: 0 });
    expect(notificationModel.bulkWrite).not.toHaveBeenCalled();
  });

  describe('pushWhen của CUSTOMER_ASSIGNED theo từng tình huống', () => {
    it.each<[string, PushContext, boolean]>([
      [
        'thêm người cùng phụ trách (TEAM_ADD)',
        { careRole: 'MEMBER', origin: 'TEAM_ADD' },
        true,
      ],
      [
        'duyệt đề nghị (REQUEST_APPROVED)',
        { careRole: 'MEMBER', origin: 'REQUEST_APPROVED' },
        true,
      ],
      [
        'thêm hàng loạt (BULK_ADD)',
        { careRole: 'MEMBER', origin: 'BULK_ADD', groupKey: 'BULK:req-1' },
        true,
      ],
      [
        'đặt làm phụ trách chính (TEAM_ADD)',
        { careRole: 'PRIMARY', origin: 'TEAM_ADD' },
        false,
      ],
      [
        'tạo khách có phân người (CUSTOMER_CREATED)',
        { careRole: 'MEMBER', origin: 'CUSTOMER_CREATED' },
        false,
      ],
      [
        'đổi phụ trách chính hàng loạt (BULK_ADD, PRIMARY)',
        { careRole: 'PRIMARY', origin: 'BULK_ADD', groupKey: 'BULK:req-1' },
        false,
      ],
      ['không có context', {}, false],
    ])('%s -> push=%s', async (_label, context, hasPush) => {
      const { dispatcher, notificationModel, queue } = build();
      await dispatcher.dispatch([request({ context })]);

      const doc = writtenDoc(notificationModel);
      expect(doc.pushStatus).toBe(
        hasPush
          ? NotificationPushStatus.PENDING
          : NotificationPushStatus.SKIPPED,
      );
      expect(doc.push).toEqual(
        hasPush
          ? expect.objectContaining({
              title: 'Bạn được mời cùng phụ trách một khách',
              body: 'Lan đã thêm bạn vào nhóm chăm sóc khách Anh Minh.',
              url: `/crm/customers/${String(CUSTOMER)}`,
            })
          : null,
      );
      expect(queue.add).toHaveBeenCalledTimes(hasPush ? 1 : 0);
    });

    it('thêm hàng loạt lưu pushGroupKey do nơi gọi truyền; thông báo SKIPPED thì không lưu', async () => {
      const bulk = build();
      await bulk.dispatcher.dispatch([
        request({
          context: {
            careRole: 'MEMBER',
            origin: 'BULK_ADD',
            groupKey: 'BULK:req-9',
          },
        }),
      ]);
      expect(writtenDoc(bulk.notificationModel).pushGroupKey).toBe(
        'BULK:req-9',
      );

      const skipped = build();
      await skipped.dispatcher.dispatch([
        request({
          context: {
            careRole: 'PRIMARY',
            origin: 'BULK_ADD',
            groupKey: 'BULK:req-9',
          },
        }),
      ]);
      expect(writtenDoc(skipped.notificationModel).pushGroupKey).toBeNull();
    });
  });

  it('loại có push luôn (CARE_LOG_ADDED) và loại ngoài danh mục (FOLLOW_UP_DUE) không có push', async () => {
    const { dispatcher, notificationModel } = build();
    await dispatcher.dispatch([
      request({
        type: NotificationType.CARE_LOG_ADDED,
        context: undefined,
        dedupeKey: 'CARE_LOG:1',
      }),
      request({
        type: NotificationType.FOLLOW_UP_DUE,
        vars: undefined,
        context: undefined,
        dedupeKey: 'FOLLOW:1',
      }),
    ]);
    expect(writtenDoc(notificationModel, 0).pushStatus).toBe(
      NotificationPushStatus.PENDING,
    );
    const outsider = writtenDoc(notificationModel, 1);
    expect(outsider.pushStatus).toBe(NotificationPushStatus.SKIPPED);
    expect(outsider.push).toBeNull();
  });

  describe('khóa chống trùng', () => {
    it('upsert theo (userId, dedupeKey) với $setOnInsert, không bao giờ insert thẳng', async () => {
      const recipient = oid();
      const { dispatcher, notificationModel } = build();
      await dispatcher.dispatch([request({ recipientIds: [recipient] })]);

      const [operation] = notificationModel.bulkWrite.mock
        .calls[0][0] as Operation[];
      expect(operation.updateOne.filter).toEqual({
        userId: recipient,
        dedupeKey: `ASSIGN:ADD:${String(CUSTOMER)}:2`,
      });
      expect(operation.updateOne.upsert).toBe(true);
      expect(Object.keys(operation.updateOne.update)).toEqual(['$setOnInsert']);
    });

    it('bản trùng (không upsert mới) không xếp job và không tính vào created', async () => {
      const { dispatcher, queue } = build({ upsertedIndexes: [] });
      await expect(dispatcher.dispatch([request()])).resolves.toEqual({
        created: 0,
      });
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('thiếu dedupeKey là lỗi lập trình: ném trước khi ghi', async () => {
      const { dispatcher, notificationModel } = build();
      await expect(
        dispatcher.dispatch([request({ dedupeKey: '' })]),
      ).rejects.toThrow('dedupeKey');
      expect(notificationModel.bulkWrite).not.toHaveBeenCalled();
    });
  });

  describe('người nhận', () => {
    it('bỏ người thực hiện (excludeUserIds) và bỏ trùng', async () => {
      const other = oid();
      const { dispatcher, notificationModel } = build();
      await dispatcher.dispatch([
        request({
          recipientIds: [
            ACTOR,
            other,
            other,
            new Types.ObjectId(String(other)),
          ],
          excludeUserIds: [ACTOR],
        }),
      ]);
      const operations = notificationModel.bulkWrite.mock
        .calls[0][0] as Operation[];
      expect(operations).toHaveLength(1);
      expect(operations[0].updateOne.filter.userId).toEqual(other);
    });

    it('chỉ còn người thực hiện thì không ghi gì', async () => {
      const { dispatcher, notificationModel } = build();
      await expect(
        dispatcher.dispatch([
          request({ recipientIds: [ACTOR], excludeUserIds: [ACTOR] }),
        ]),
      ).resolves.toEqual({ created: 0 });
      expect(notificationModel.bulkWrite).not.toHaveBeenCalled();
    });

    it('người tắt inApp bị bỏ hẳn (không thông báo, không push), người khác vẫn nhận', async () => {
      const muted = oid();
      const normal = oid();
      const { dispatcher, notificationModel } = build({
        preferences: [
          {
            userId: muted,
            types: { CUSTOMER_ASSIGNED: { push: true, inApp: false } },
          },
        ],
      });
      await dispatcher.dispatch([request({ recipientIds: [muted, normal] })]);
      const operations = notificationModel.bulkWrite.mock
        .calls[0][0] as Operation[];
      expect(operations.map((o) => o.updateOne.filter.userId)).toEqual([
        normal,
      ]);
    });
  });

  describe('FR-16/FR-18: tài khoản bị khóa không nhận thông báo', () => {
    const user = (
      status: 'ACTIVE' | 'BLOCKED',
      deletedAt: Date | null = null,
    ) => ({ _id: oid(), status, deletedAt });
    const written = (notificationModel: { bulkWrite: jest.Mock }): string[] =>
      notificationModel.bulkWrite.mock.calls.length === 0
        ? []
        : (notificationModel.bulkWrite.mock.calls[0][0] as Operation[]).map(
            (o) => String(o.updateOne.filter.userId),
          );

    it('FR-18 người nhận BLOCKED bị loại: không hộp thông báo, không push', async () => {
      const blocked = user('BLOCKED');
      const { dispatcher, notificationModel, queue } = build({
        users: [blocked],
      });
      await expect(
        dispatcher.dispatch([request({ recipientIds: [blocked._id] })]),
      ).resolves.toEqual({ created: 0 });
      expect(notificationModel.bulkWrite).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('FR-16 người được mời ACTIVE nhận CUSTOMER_ASSIGNED kèm push PENDING', async () => {
      const invitee = user('ACTIVE');
      const { dispatcher, notificationModel, queue } = build({
        users: [invitee],
      });
      await expect(
        dispatcher.dispatch([request({ recipientIds: [invitee._id] })]),
      ).resolves.toEqual({ created: 1 });
      expect(written(notificationModel)).toEqual([String(invitee._id)]);
      expect(writtenDoc(notificationModel)).toMatchObject({
        type: NotificationType.CUSTOMER_ASSIGNED,
        pushStatus: NotificationPushStatus.PENDING,
      });
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('FR-18 danh sách lẫn ACTIVE và BLOCKED: chỉ ACTIVE nhận, đúng thứ tự', async () => {
      const a = user('ACTIVE');
      const blocked = user('BLOCKED');
      const b = user('ACTIVE');
      const { dispatcher, notificationModel, queue } = build({
        users: [a, blocked, b],
      });
      await expect(
        dispatcher.dispatch([
          request({ recipientIds: [a._id, blocked._id, b._id] }),
        ]),
      ).resolves.toEqual({ created: 2 });
      expect(written(notificationModel)).toEqual([
        String(a._id),
        String(b._id),
      ]);
      expect(queue.add).toHaveBeenCalledTimes(2);
    });

    it('FR-18 mở khóa lại thì nhận lại ở lần gửi sau (cùng người, đổi trạng thái)', async () => {
      const staff = user('BLOCKED');
      const { dispatcher, notificationModel } = build({ users: [staff] });
      await dispatcher.dispatch([request({ recipientIds: [staff._id] })]);
      expect(notificationModel.bulkWrite).not.toHaveBeenCalled();

      staff.status = 'ACTIVE';
      await expect(
        dispatcher.dispatch([request({ recipientIds: [staff._id] })]),
      ).resolves.toEqual({ created: 1 });
      expect(written(notificationModel)).toEqual([String(staff._id)]);
    });

    it('FR-18 tất cả đều BLOCKED: không gửi gì, không ném lỗi, không tải cài đặt', async () => {
      const x = user('BLOCKED');
      const y = user('BLOCKED');
      const { dispatcher, notificationModel, preferenceModel } = build({
        users: [x, y],
      });
      await expect(
        dispatcher.dispatch([request({ recipientIds: [x._id, y._id] })]),
      ).resolves.toEqual({ created: 0 });
      expect(notificationModel.bulkWrite).not.toHaveBeenCalled();
      expect(preferenceModel.find).not.toHaveBeenCalled();
    });

    it('FR-18 tài khoản xóa mềm hoặc không tồn tại bị loại như BLOCKED', async () => {
      const deleted = user('ACTIVE', new Date());
      const active = user('ACTIVE');
      const ghost = oid();
      const { dispatcher, notificationModel } = build({
        users: [deleted, active],
      });
      await expect(
        dispatcher.dispatch([
          request({ recipientIds: [deleted._id, ghost, active._id] }),
        ]),
      ).resolves.toEqual({ created: 1 });
      expect(written(notificationModel)).toEqual([String(active._id)]);
    });

    it('FR-18 truy vấn users đúng điều kiện ACTIVE + chưa xóa, chỉ lấy _id, cùng session', async () => {
      const staff = user('ACTIVE');
      const { dispatcher, userModel } = build({ users: [staff] });
      const session = { id: 's' } as never;
      await dispatcher.dispatch(
        [request({ recipientIds: [staff._id] })],
        session,
      );
      expect(userModel.find).toHaveBeenCalledWith({
        _id: { $in: [staff._id] },
        status: 'ACTIVE',
        deletedAt: null,
      });
      const query = userModel.find.mock.results[0].value;
      expect(query.select).toHaveBeenCalledWith('_id');
      expect(query.session).toHaveBeenCalledWith(session);
    });

    it('FR-18 nhiều yêu cầu một lượt: chỉ MỘT truy vấn users theo lô (không N+1), mỗi yêu cầu lọc riêng', async () => {
      const a = user('ACTIVE');
      const blocked = user('BLOCKED');
      const c = user('ACTIVE');
      const { dispatcher, notificationModel, userModel } = build({
        users: [a, blocked, c],
      });
      await expect(
        dispatcher.dispatch([
          request({ recipientIds: [a._id, blocked._id], dedupeKey: 'K1' }),
          request({ recipientIds: [blocked._id, c._id], dedupeKey: 'K2' }),
        ]),
      ).resolves.toEqual({ created: 2 });
      expect(userModel.find).toHaveBeenCalledTimes(1);
      const operations = notificationModel.bulkWrite.mock
        .calls[0][0] as Operation[];
      expect(
        operations.map((o) => [
          String(o.updateOne.filter.userId),
          o.updateOne.filter.dedupeKey,
        ]),
      ).toEqual([
        [String(a._id), 'K1'],
        [String(c._id), 'K2'],
      ]);
    });

    it('FR-16 người thực hiện (người mời) không nhận thông báo dù ACTIVE', async () => {
      const inviter = user('ACTIVE');
      const invitee = user('ACTIVE');
      const { dispatcher, notificationModel } = build({
        users: [inviter, invitee],
      });
      await dispatcher.dispatch([
        request({
          recipientIds: [inviter._id, invitee._id],
          excludeUserIds: [inviter._id],
        }),
      ]);
      expect(written(notificationModel)).toEqual([String(invitee._id)]);
    });

    it('FR-18 chỉ tải cài đặt của người đã qua lọc (BLOCKED không bị tra cài đặt)', async () => {
      const blocked = user('BLOCKED');
      const active = user('ACTIVE');
      const { dispatcher, preferenceModel } = build({
        users: [blocked, active],
      });
      await dispatcher.dispatch([
        request({ recipientIds: [blocked._id, active._id] }),
      ]);
      expect(preferenceModel.find).toHaveBeenCalledWith({
        userId: { $in: [active._id] },
      });
    });

    it.each(Object.values(NotificationType))(
      'FR-18 loại %s cũng đi qua cùng điểm lọc: BLOCKED bị loại, ACTIVE nhận',
      async (type) => {
        const blocked = user('BLOCKED');
        const active = user('ACTIVE');
        const { dispatcher, notificationModel } = build({
          users: [blocked, active],
        });
        // Biến đủ cho mẫu push của loại (loại ngoài danh mục không có biến).
        const allowedVars = getPushCatalogEntry(type)?.allowedVars ?? [];
        await dispatcher.dispatch([
          request({
            type,
            recipientIds: [blocked._id, active._id],
            vars: Object.fromEntries(allowedVars.map((name) => [name, 'Lan'])),
          }),
        ]);
        expect(written(notificationModel)).toEqual([String(active._id)]);
      },
    );
  });

  describe('cài đặt push và cờ', () => {
    it('người tắt push cho loại này: vẫn có thông báo trong app nhưng SKIPPED, không xếp job', async () => {
      const user = oid();
      const { dispatcher, notificationModel, queue } = build({
        preferences: [
          {
            userId: user,
            types: { CUSTOMER_ASSIGNED: { push: false, inApp: true } },
          },
        ],
      });
      await dispatcher.dispatch([request({ recipientIds: [user] })]);
      const doc = writtenDoc(notificationModel);
      expect(doc.pushStatus).toBe(NotificationPushStatus.SKIPPED);
      expect(doc.push).toBeNull();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('tắt push một loại không ảnh hưởng loại khác của cùng người', async () => {
      const user = oid();
      const { dispatcher, notificationModel } = build({
        preferences: [
          {
            userId: user,
            types: { CUSTOMER_ASSIGNED: { push: false, inApp: true } },
          },
        ],
      });
      await dispatcher.dispatch([
        request({
          type: NotificationType.CARE_LOG_ADDED,
          recipientIds: [user],
          context: undefined,
          dedupeKey: 'CARE_LOG:1',
        }),
      ]);
      expect(writtenDoc(notificationModel).pushStatus).toBe(
        NotificationPushStatus.PENDING,
      );
    });

    it('cờ push tắt (provider SKIPPED): mọi thông báo SKIPPED, không xếp job, vẫn ghi hộp thông báo', async () => {
      const { dispatcher, notificationModel, queue } = build({
        providerStatus: NotificationPushStatus.SKIPPED,
      });
      await expect(dispatcher.dispatch([request()])).resolves.toEqual({
        created: 1,
      });
      expect(writtenDoc(notificationModel).pushStatus).toBe(
        NotificationPushStatus.SKIPPED,
      );
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('xếp job sau commit', () => {
    it('đăng ký afterCommit với session và xếp push.send đúng jobId, queue push', async () => {
      const queueAdd = jest.fn().mockResolvedValue({});
      const { dispatcher } = build({ queueAdd });
      const session = { id: 'session' } as never;
      await dispatcher.dispatch([request()], session);

      expect(registerAfterCommitMock).toHaveBeenCalledTimes(1);
      expect(registerAfterCommitMock.mock.calls[0][0]).toBe(session);
      expect(queueAdd).toHaveBeenCalledTimes(1);
      const [queueName, jobName, data, options] = queueAdd.mock.calls[0];
      expect(queueName).toBe(QueueNames.PUSH);
      expect(jobName).toBe(PushJobNames.SEND);
      expect(options.jobId).toBe(pushSendJobId(String(data.notificationId)));
      expect(options.jobId).not.toContain(':');
    });

    it('chỉ hàm hoãn: queue chưa được gọi khi afterCommit chưa chạy (rollback thì không bao giờ gọi)', async () => {
      const { dispatcher, queue } = build();
      registerAfterCommitMock.mockImplementation(() => undefined);
      await dispatcher.dispatch([request()], {} as never);
      expect(registerAfterCommitMock).toHaveBeenCalledTimes(1);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('lỗi Redis chỉ ghi log: dispatch không ném và thông báo vẫn được tính là đã tạo (PENDING)', async () => {
      const queueAdd = jest.fn().mockRejectedValue(new Error('redis down'));
      const { dispatcher, notificationModel } = build({ queueAdd });
      await expect(dispatcher.dispatch([request()])).resolves.toEqual({
        created: 1,
      });
      expect(writtenDoc(notificationModel).pushStatus).toBe(
        NotificationPushStatus.PENDING,
      );
    });
  });

  describe('lỗi lập trình và PII', () => {
    it('biến lạ ném PushRenderError và không ghi gì', async () => {
      const { dispatcher, notificationModel } = build();
      await expect(
        dispatcher.dispatch([
          request({ vars: { customerPhone: '0901234567' } as never }),
        ]),
      ).rejects.toBeInstanceOf(PushRenderError);
      expect(notificationModel.bulkWrite).not.toHaveBeenCalled();
    });

    it('biến lạ vẫn bị bắt khi tình huống không push (PRIMARY) để lỗi lộ ra sớm', async () => {
      const { dispatcher } = build();
      await expect(
        dispatcher.dispatch([
          request({
            context: { careRole: 'PRIMARY', origin: 'TEAM_ADD' },
            vars: { secret: 'x' } as never,
          }),
        ]),
      ).rejects.toBeInstanceOf(PushRenderError);
    });

    it('deepLink ngoài nội bộ không đi vào push.url: url dựng lại từ mẫu + customerId', async () => {
      const { dispatcher, notificationModel } = build();
      await dispatcher.dispatch([
        request({
          data: { customerId: CUSTOMER, deepLink: 'https://evil.example/x' },
        }),
      ]);
      expect(writtenDoc(notificationModel).push.url).toBe(
        `/crm/customers/${String(CUSTOMER)}`,
      );
    });

    it('dữ liệu bẫy (tên chứa số điện thoại) rơi về nội dung chung, vẫn là push hợp lệ', async () => {
      const { dispatcher, notificationModel } = build();
      await dispatcher.dispatch([
        request({
          vars: { actorName: 'Lan', customerName: 'Minh 0901234567' },
        }),
      ]);
      const doc = writtenDoc(notificationModel);
      expect(doc.push.title).toBe('Bạn có thông báo mới');
      expect(doc.push.body).toBe('Bạn có thông báo mới');
      expect(JSON.stringify(doc.push)).not.toContain('0901234567');
    });
  });

  it('ghi đúng trường hộp thông báo: priority mặc định NORMAL, readAt null, pushSentAt null, createdAt do server', async () => {
    const { dispatcher, notificationModel } = build();
    await dispatcher.dispatch([request()]);
    const doc = writtenDoc(notificationModel);
    expect(doc).toMatchObject({
      type: NotificationType.CUSTOMER_ASSIGNED,
      priority: NotificationPriority.NORMAL,
      readAt: null,
      pushSentAt: null,
    });
    expect(doc.createdAt).toBeInstanceOf(Date);
    const options = notificationModel.bulkWrite.mock.calls[0][1];
    expect(options).toMatchObject({ ordered: false, timestamps: false });
  });

  it('truyền session cho cả truy vấn cài đặt lẫn bulkWrite (cùng transaction)', async () => {
    const { dispatcher, notificationModel, preferenceModel } = build();
    const session = { id: 's' } as never;
    await dispatcher.dispatch([request()], session);
    const query = preferenceModel.find.mock.results[0].value;
    expect(query.session).toHaveBeenCalledWith(session);
    expect(notificationModel.bulkWrite.mock.calls[0][1].session).toBe(session);
  });
});

describe('NotificationDispatcher.notifyAdmins (T-35: cảnh báo bảo mật không push)', () => {
  beforeEach(() => jest.clearAllMocks());

  const alert = {
    type: NotificationType.SECURITY_ALERT,
    inApp: {
      title: 'Cảnh báo truy cập bất thường',
      body: 'Lan: vượt ngưỡng',
      priority: NotificationPriority.HIGH,
    },
    data: { deepLink: '/crm/audit-logs?actorId=u1&actions=X' },
    dedupeKey: 'ALERT:X:u1:1',
  };

  it('chỉ tìm Quản trị đang hoạt động, chưa xóa, rồi ghi hộp thông báo cho từng người, không có push', async () => {
    const adminA = oid();
    const adminB = oid();
    const { dispatcher, notificationModel, userModel, queue } = build({
      admins: [{ _id: adminA }, { _id: adminB }],
    });
    const session = { id: 's' } as never;
    await expect(dispatcher.notifyAdmins(alert, session)).resolves.toBe(2);
    expect(userModel.find).toHaveBeenCalledWith({
      roles: 'ADMIN',
      status: 'ACTIVE',
      deletedAt: null,
    });
    const operations = notificationModel.bulkWrite.mock
      .calls[0][0] as Operation[];
    expect(operations.map((op) => String(op.updateOne.filter.userId))).toEqual([
      String(adminA),
      String(adminB),
    ]);
    const doc = writtenDoc(notificationModel);
    expect(doc).toMatchObject({
      type: NotificationType.SECURITY_ALERT,
      priority: NotificationPriority.HIGH,
      pushStatus: NotificationPushStatus.SKIPPED,
      push: null,
      dedupeKey: 'ALERT:X:u1:1',
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('Quản trị đã lọc ACTIVE ở bước tìm nên không truy vấn users lần hai', async () => {
    const { dispatcher, userModel } = build({ admins: [{ _id: oid() }] });
    await dispatcher.notifyAdmins(alert);
    expect(userModel.find).toHaveBeenCalledTimes(1);
  });

  it('không có Quản trị nào thì không ghi gì và trả 0', async () => {
    const { dispatcher, notificationModel } = build({ admins: [] });
    await expect(dispatcher.notifyAdmins(alert)).resolves.toBe(0);
    expect(notificationModel.bulkWrite).not.toHaveBeenCalled();
  });

  it('lỗi khi tìm Quản trị chỉ ghi log và trả 0 (không làm hỏng nghiệp vụ gốc)', async () => {
    const { dispatcher, notificationModel } = build({
      adminLookupError: new Error('mất kết nối'),
    });
    await expect(dispatcher.notifyAdmins(alert)).resolves.toBe(0);
    expect(notificationModel.bulkWrite).not.toHaveBeenCalled();
  });
});
