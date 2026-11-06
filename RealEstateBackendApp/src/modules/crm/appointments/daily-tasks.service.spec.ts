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
  return { service, statusModel, appointmentModel, repo, refs, statuses };
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
