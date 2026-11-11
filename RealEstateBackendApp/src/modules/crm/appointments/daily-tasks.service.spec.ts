import { Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { ListGroup } from '../catalogs/catalog.enums';
import type { CatalogRef } from '../customers/customer-refs.service';
import { AppointmentType } from './appointment.constants';
import { DailyTasksService } from './daily-tasks.service';
import { DailyTaskKind } from './daily-task.rules';

const jwt = { sub: 'user-1' } as JwtPayload;
const oid = () => new Types.ObjectId();
const userId = oid();

/** Chuỗi query Mongoose giả: các bước trung gian trả lại chính nó, `.exec()` trả kết quả. */
const chain = <T>(result: T) => {
  const query: Record<string, jest.Mock> = {};
  for (const name of ['select', 'lean', 'session', 'sort']) {
    query[name] = jest.fn(() => query);
  }
  query.exec = jest.fn(() => Promise.resolve(result));
  return query;
};

const ref = (code: string, label: string): CatalogRef => ({
  id: oid(),
  code,
  label,
});

const buildService = () => {
  const statuses = [
    { _id: oid(), code: 'NET' },
    { _id: oid(), code: 'INTERESTED' },
    { _id: oid(), code: 'LATE_NET' },
  ];
  const appointmentModel = { aggregate: jest.fn() };
  const careLogModel = { aggregate: jest.fn(() => chain([])) };
  const statusModel = { find: jest.fn(() => chain(statuses)) };
  const personaFieldModel = { find: jest.fn(() => chain([])) };
  const access = {
    resolve: jest.fn().mockResolvedValue({
      scope: {},
      actor: {
        userId,
        role: UserRole.STAFF,
        roles: [UserRole.STAFF],
      },
    }),
  };
  const repo = {
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    buildFilter: jest.fn().mockReturnValue({}),
  };
  const refs = {
    resolve: jest.fn().mockResolvedValue({
      statuses: new Map(),
      users: new Map(),
    }),
    resolveByCodes: jest.fn().mockResolvedValue([]),
    resolveByIds: jest.fn().mockResolvedValue([]),
  };
  const settings = {
    get: jest.fn().mockResolvedValue({
      occasionLeadDays: [0],
      staleCustomerDays: 14,
    }),
  };
  const service = new DailyTasksService(
    appointmentModel as never,
    careLogModel as never,
    statusModel as never,
    personaFieldModel as never,
    access as never,
    repo as never,
    refs as never,
    settings as never,
  );
  return {
    service,
    statusModel,
    appointmentModel,
    careLogModel,
    access,
    repo,
    refs,
    statuses,
  };
};

describe('DailyTasksService: lọc tình trạng theo statusCode (FR-40)', () => {
  it('FR-40: khách lâu chưa chăm sóc lọc theo statusCode của nhóm NOT_CONTACTED/INTERESTED, dự phòng statusId cho khách chưa backfill', async () => {
    const { service, statusModel, repo, statuses } = buildService();

    await service.list(jwt, { kinds: [DailyTaskKind.STALE_CUSTOMER] });

    expect(statusModel.find).toHaveBeenCalledWith({
      listGroup: { $in: [ListGroup.NOT_CONTACTED, ListGroup.INTERESTED] },
    });
    const [, filter] = repo.count.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(filter.$and).toContainEqual({
      $or: [
        { statusCode: { $in: ['NET', 'INTERESTED', 'LATE_NET'] } },
        {
          statusCode: null,
          statusId: { $in: statuses.map((status) => status._id) },
        },
      ],
    });
    const [, findFilter, options] = repo.find.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
      { projection: string },
    ];
    expect(findFilter.$and).toBeDefined();
    expect(options.projection).toContain('statusId');
  });

  it('FR-40: dịp đặc biệt loại khách theo statusCode thuộc nhóm DROPPED, kể cả khách chưa backfill (theo statusId)', async () => {
    const { service, statusModel, repo } = buildService();
    const dropped = { _id: oid(), code: 'DROPPED' };
    statusModel.find.mockImplementation(() => chain([dropped]));

    await service.list(jwt, { kinds: [DailyTaskKind.OCCASION] });

    expect(statusModel.find).toHaveBeenCalledWith({
      listGroup: { $in: [ListGroup.DROPPED] },
    });
    const [, filter] = repo.find.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(filter.$nor).toEqual([
      { statusCode: { $in: ['DROPPED'] } },
      { statusCode: null, statusId: { $in: [dropped._id] } },
    ]);
  });
});

describe('DailyTasksService: dự án của việc trả CatalogRefDto (FR-40)', () => {
  const customerId = oid();
  const projectA = ref('QTERRA', 'Q Terra');
  const projectB = ref('VINHOMES', 'Vinhomes');

  const setupAppointmentTask = (
    customerExtra: Record<string, unknown>,
    appointmentExtra: Record<string, unknown>,
  ) => {
    const built = buildService();
    const startAt = new Date();
    built.appointmentModel.aggregate.mockReturnValue({
      exec: () =>
        Promise.resolve([
          {
            rows: [
              {
                _id: oid(),
                customerId,
                type: AppointmentType.SITE_VISIT,
                title: 'Xem nhà',
                note: '',
                startAt,
                assigneeId: userId,
                ...appointmentExtra,
              },
            ],
            total: [{ count: 1 }],
          },
        ]),
    });
    built.repo.find.mockResolvedValue([
      {
        _id: customerId,
        fullName: 'Khách A',
        statusId: oid(),
        ...customerExtra,
      },
    ]);
    return built;
  };

  const run = async (built: ReturnType<typeof buildService>) => {
    const result = await built.service.list(jwt, {
      kinds: [DailyTaskKind.APPOINTMENT],
      scope: 'mine',
    } as never);
    return result.data[0];
  };

  it('FR-40: dự án của lịch trả { id, code, label } (code từ projectCode ghi kép); khách quan tâm theo interestedProjectCodes, đúng thứ tự', async () => {
    const built = setupAppointmentTask(
      { interestedProjectCodes: ['VINHOMES', 'QTERRA'] },
      { projectId: projectA.id, projectCode: 'QTERRA' },
    );
    built.refs.resolveByCodes.mockResolvedValue([projectA, projectB]);
    built.refs.resolveByIds.mockResolvedValue([projectA]);

    const task = await run(built);

    expect(task.project).toEqual({
      id: String(projectA.id),
      code: 'QTERRA',
      label: 'Q Terra',
    });
    expect(task.customer.projects).toEqual([
      { id: String(projectB.id), code: 'VINHOMES', label: 'Vinhomes' },
      { id: String(projectA.id), code: 'QTERRA', label: 'Q Terra' },
    ]);
    // Một lô `$in` mỗi loại: không N+1.
    expect(built.refs.resolveByCodes).toHaveBeenCalledTimes(1);
    expect(built.refs.resolveByIds).toHaveBeenCalledTimes(1);
  });

  it('FR-40 (dữ liệu cũ): khách chưa có interestedProjectCodes thì dùng interestedProjectIds; lịch chưa có projectCode thì dịch code từ id', async () => {
    const built = setupAppointmentTask(
      { interestedProjectIds: [projectB.id] },
      { projectId: projectA.id },
    );
    built.refs.resolveByIds.mockResolvedValue([projectA, projectB]);

    const task = await run(built);

    expect(task.project).toMatchObject({
      id: String(projectA.id),
      code: 'QTERRA',
    });
    expect(task.customer.projects).toEqual([
      { id: String(projectB.id), code: 'VINHOMES', label: 'Vinhomes' },
    ]);
  });

  it('FR-40: lịch không gắn dự án => project null; mã dự án khách không còn tồn tại bị bỏ, không lỗi', async () => {
    const built = setupAppointmentTask(
      { interestedProjectCodes: ['DAXOA'] },
      {},
    );

    const task = await run(built);

    expect(task.project).toBeNull();
    expect(task.customer.projects).toEqual([]);
  });
});

describe('DailyTasksService: "của tôi" theo mọi thành viên careTeam (FR-19)', () => {
  type Stage = Record<string, unknown>;
  const pipelineOf = (mock: jest.Mock): Stage[] =>
    mock.mock.calls[0][0] as Stage[];
  /** Mệnh đề `mine` = stage `$match` có `$or` sau `$lookup` khách. */
  const mineMatchOf = (pipeline: Stage[]) =>
    pipeline.find((stage) => {
      const match = stage.$match as { $or?: unknown } | undefined;
      return !!match?.$or;
    })?.$match as { $or: Array<Record<string, unknown>> } | undefined;
  const lookupProjectOf = (pipeline: Stage[]) => {
    const lookup = pipeline.find((stage) => stage.$lookup)?.$lookup as {
      pipeline: Array<{ $project?: Record<string, number> }>;
    };
    return lookup.pipeline.find((stage) => stage.$project)?.$project;
  };
  const emptyFacet = () => ({
    exec: () => Promise.resolve([{ rows: [], total: [] }]),
  });
  const actAs = (
    built: ReturnType<typeof buildService>,
    role: UserRole,
  ): void => {
    built.access.resolve.mockResolvedValue({
      scope: {},
      actor: { userId, role, roles: [role] },
    });
  };

  it('lịch hẹn mine: assigneeId = tôi HOẶC tôi nằm trong careTeam; không còn so primaryAssigneeId; chỉ chiếu careTeam.userId', async () => {
    const { service, appointmentModel } = buildService();
    appointmentModel.aggregate.mockReturnValue(emptyFacet());

    await service.list(jwt, {
      kinds: [DailyTaskKind.APPOINTMENT],
      scope: 'mine',
    } as never);

    const pipeline = pipelineOf(appointmentModel.aggregate);
    expect(mineMatchOf(pipeline)?.$or).toEqual([
      { assigneeId: userId },
      { 'customer.0.careTeam.userId': userId },
    ]);
    expect(lookupProjectOf(pipeline)).toEqual({ 'careTeam.userId': 1 });
    expect(JSON.stringify(pipeline)).not.toContain('primaryAssigneeId');
  });

  it('lịch hẹn scope=team (Manager): không có điều kiện "của tôi" và không đòi careTeam, nên thấy cả khách nhóm rỗng', async () => {
    const built = buildService();
    actAs(built, UserRole.MANAGER);
    built.appointmentModel.aggregate.mockReturnValue(emptyFacet());

    await built.service.list(jwt, {
      kinds: [DailyTaskKind.APPOINTMENT],
      scope: 'team',
    } as never);

    const pipeline = pipelineOf(built.appointmentModel.aggregate);
    expect(mineMatchOf(pipeline)).toBeUndefined();
    expect(JSON.stringify(pipeline)).not.toContain('careTeam.0');
  });

  it('scope=team với Nhân viên: bị từ chối (không mở rộng quyền)', async () => {
    const built = buildService();
    await expect(
      built.service.list(jwt, { scope: 'team' } as never),
    ).rejects.toBeDefined();
    expect(built.appointmentModel.aggregate).not.toHaveBeenCalled();
  });

  it('việc kế tiếp mine: authorId = tôi HOẶC tôi nằm trong careTeam; chiếu careTeam.userId + lastCareLogAt', async () => {
    const built = buildService();
    built.careLogModel.aggregate.mockReturnValue(emptyFacet() as never);

    await built.service.list(jwt, {
      kinds: [DailyTaskKind.FOLLOW_UP],
      scope: 'mine',
    } as never);

    const pipeline = pipelineOf(built.careLogModel.aggregate);
    expect(mineMatchOf(pipeline)?.$or).toEqual([
      { authorId: userId },
      { 'customer.0.careTeam.userId': userId },
    ]);
    expect(lookupProjectOf(pipeline)).toEqual({
      'careTeam.userId': 1,
      lastCareLogAt: 1,
    });
    expect(JSON.stringify(pipeline)).not.toContain('primaryAssigneeId');
  });

  it('khách lâu chưa chăm mine: lọc careTeam.userId = tôi (không còn primaryAssigneeId) cho cả count lẫn find, vẫn đòi careTeam không rỗng', async () => {
    const { service, repo } = buildService();

    await service.list(jwt, { kinds: [DailyTaskKind.STALE_CUSTOMER] });

    const [, countFilter] = repo.count.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    const [, findFilter] = repo.find.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    for (const filter of [countFilter, findFilter]) {
      expect(filter['careTeam.userId']).toEqual(userId);
      expect(filter['careTeam.0']).toEqual({ $exists: true });
      expect(filter).not.toHaveProperty('primaryAssigneeId');
    }
  });

  it('khách lâu chưa chăm scope=team: không lọc theo người, vẫn loại khách careTeam rỗng (không có ai để giao)', async () => {
    const built = buildService();
    actAs(built, UserRole.ADMIN);

    await built.service.list(jwt, {
      kinds: [DailyTaskKind.STALE_CUSTOMER],
      scope: 'team',
    } as never);

    const [, filter] = built.repo.count.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(filter).not.toHaveProperty('careTeam.userId');
    expect(filter).not.toHaveProperty('primaryAssigneeId');
    expect(filter['careTeam.0']).toEqual({ $exists: true });
  });

  describe('response: isPrimary tính từ primaryAssigneeId, phone null chịu được', () => {
    const customerId = oid();
    const setup = (customerExtra: Record<string, unknown>) => {
      const built = buildService();
      built.appointmentModel.aggregate.mockReturnValue({
        exec: () =>
          Promise.resolve([
            {
              rows: [
                {
                  _id: oid(),
                  customerId,
                  type: AppointmentType.SITE_VISIT,
                  title: 'Xem nhà',
                  note: '',
                  startAt: new Date(),
                  assigneeId: userId,
                },
              ],
              total: [{ count: 1 }],
            },
          ]),
      });
      built.repo.find.mockResolvedValue([
        {
          _id: customerId,
          fullName: 'Khách A',
          statusId: oid(),
          ...customerExtra,
        },
      ]);
      return built;
    };
    const first = async (built: ReturnType<typeof buildService>) =>
      (
        await built.service.list(jwt, {
          kinds: [DailyTaskKind.APPOINTMENT],
          scope: 'mine',
        } as never)
      ).data[0];

    it('MEMBER thấy việc của khách có PRIMARY là người khác: isPrimary=false', async () => {
      const task = await first(setup({ primaryAssigneeId: oid() }));
      expect(task.isPrimary).toBe(false);
    });

    it('khách PRIMARY null (careTeam còn MEMBER): vẫn hiện, isPrimary=false, không lỗi', async () => {
      const task = await first(setup({ primaryAssigneeId: null }));
      expect(task).toBeDefined();
      expect(task.isPrimary).toBe(false);
    });

    it('tôi chính là PRIMARY: isPrimary=true', async () => {
      const task = await first(setup({ primaryAssigneeId: userId }));
      expect(task.isPrimary).toBe(true);
    });

    it('FR-04: khách không SĐT (null hoặc thiếu) hoặc đã ẩn danh: phoneMasked null, không ném lỗi; có SĐT thì che', async () => {
      const masked = async (extra: Record<string, unknown>) =>
        (await first(setup(extra))).customer.phoneMasked;
      expect(await masked({ phone: null })).toBeNull();
      expect(await masked({})).toBeNull();
      expect(
        await masked({ phone: '+84912345678', anonymizedAt: new Date() }),
      ).toBeNull();
      expect(await masked({ phone: '+84912345678' })).toBe('0912 ••• 678');
    });
  });
});
