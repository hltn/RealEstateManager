import { Types } from 'mongoose';
import { requestContextStorage } from '../../../common/services/request-context.service';
import {
  NotificationPriority,
  NotificationType,
} from '../../notifications/notification.constants';
import { CareRole } from '../customers/customer.constants';
import { CareTeamMutation, CareTeamService } from './care-team.service';
import { planAddMembers } from './care-team.rules';

/**
 * T-34: thông báo `CUSTOMER_ASSIGNED` của nhóm chăm sóc đi qua `NotificationDispatcher` với `origin`, `careRole`,
 * `dedupeKey` đúng bảng 5.2; hộp thông báo (title/body/priority) giữ như trước.
 */
const oid = () => new Types.ObjectId();
const ACTOR = oid();
const PRIMARY = oid();
const MEMBER_A = oid();
const MEMBER_B = oid();
const CUSTOMER = String(oid());

const buildService = (before: { careTeam: any[]; __v: number }) => {
  const dispatch = jest.fn().mockResolvedValue({ created: 0 });
  const repo = {
    findOne: jest.fn().mockResolvedValue({
      ...before,
      teamIds: [],
      fullName: 'Anh Minh',
    }),
    updateOne: jest.fn().mockResolvedValue(true),
  };
  const refs = { resolve: jest.fn().mockResolvedValue({ users: new Map() }) };
  const assignees = {
    load: jest.fn().mockResolvedValue(new Map()),
    assertAssignable: jest.fn(),
    lock: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new CareTeamService(
    {} as never,
    repo as never,
    {} as never,
    refs as never,
    assignees as never,
    audit as never,
    { dispatch } as never,
  );
  return { service, dispatch };
};

const ctx = {
  actor: { userId: ACTOR, displayName: 'Lan' },
  scope: {},
} as never;

const addMutation = (
  origin: CareTeamMutation['origin'],
  userIds: Types.ObjectId[],
  primaryUserId?: Types.ObjectId,
): CareTeamMutation => ({
  authorize: () => undefined,
  plan: (current, now) =>
    planAddMembers(current, { userIds, primaryUserId }, ACTOR, now, {
      skipExisting: true,
      allowPrimaryChange: true,
    }),
  restrictToActorScope: true,
  source: 'WEB' as never,
  origin,
});

const existingTeam = () => [
  {
    userId: PRIMARY,
    role: CareRole.PRIMARY,
    addedBy: null,
    addedAt: new Date(),
  },
];

describe('CareTeamService thông báo CUSTOMER_ASSIGNED qua Dispatcher (T-34)', () => {
  it('thêm người cùng phụ trách (TEAM_ADD): MEMBER, dedupeKey theo __v sau thay đổi, vars đủ, in-app như cũ', async () => {
    const { service, dispatch } = buildService({
      careTeam: existingTeam(),
      __v: 4,
    });
    const session = { id: 's' } as never;
    await service.applyInSession(
      ctx,
      CUSTOMER,
      addMutation('TEAM_ADD', [MEMBER_A]),
      session,
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
    const [requests, usedSession] = dispatch.mock.calls[0];
    expect(usedSession).toBe(session);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      type: NotificationType.CUSTOMER_ASSIGNED,
      recipientIds: [MEMBER_A],
      inApp: {
        title: 'Bạn được phân chăm sóc khách mới',
        body: 'Bạn được phân chăm sóc khách Anh Minh',
        priority: NotificationPriority.NORMAL,
      },
      vars: { actorName: 'Lan', customerName: 'Anh Minh' },
      context: { careRole: 'MEMBER', origin: 'TEAM_ADD' },
      dedupeKey: `ASSIGN:ADD:${CUSTOMER}:5`,
    });
    expect(requests[0].data.deepLink).toBe(`/crm/customers/${CUSTOMER}`);
    expect(requests[0].context.groupKey).toBeUndefined();
  });

  it('duyệt đề nghị (REQUEST_APPROVED) mang origin tương ứng', async () => {
    const { service, dispatch } = buildService({
      careTeam: existingTeam(),
      __v: 0,
    });
    await service.applyInSession(
      ctx,
      CUSTOMER,
      addMutation('REQUEST_APPROVED', [MEMBER_A]),
      {} as never,
    );
    expect(dispatch.mock.calls[0][0][0].context).toEqual({
      careRole: 'MEMBER',
      origin: 'REQUEST_APPROVED',
    });
  });

  it('nhóm đang rỗng, người đầu tiên là PRIMARY (HIGH) và careRole PRIMARY để Dispatcher không push', async () => {
    const { service, dispatch } = buildService({ careTeam: [], __v: 1 });
    await service.applyInSession(
      ctx,
      CUSTOMER,
      addMutation('TEAM_ADD', [MEMBER_A], MEMBER_A),
      {} as never,
    );
    const [request] = dispatch.mock.calls[0][0];
    expect(request.context.careRole).toBe('PRIMARY');
    expect(request.inApp.priority).toBe(NotificationPriority.HIGH);
  });

  it('một lần thêm cả người cùng phụ trách và phụ trách chính: mỗi người một yêu cầu đúng vai trò, cùng dedupeKey', async () => {
    const { service, dispatch } = buildService({
      careTeam: existingTeam(),
      __v: 2,
    });
    await service.applyInSession(
      ctx,
      CUSTOMER,
      addMutation('TEAM_ADD', [MEMBER_A, MEMBER_B], MEMBER_B),
      {} as never,
    );
    const requests = dispatch.mock.calls[0][0];
    const byUser = new Map(
      requests.map((r: any) => [String(r.recipientIds[0]), r]),
    ) as Map<string, any>;
    expect(byUser.get(String(MEMBER_A))!.context.careRole).toBe('MEMBER');
    expect(byUser.get(String(MEMBER_B))!.context.careRole).toBe('PRIMARY');
    expect(byUser.get(String(MEMBER_B))!.inApp.priority).toBe(
      NotificationPriority.HIGH,
    );
    expect(new Set(requests.map((r: any) => r.dedupeKey)).size).toBe(1);
  });

  it('người thực hiện tự thêm mình thì không gửi cho chính mình (không yêu cầu nào)', async () => {
    const { service, dispatch } = buildService({
      careTeam: existingTeam(),
      __v: 0,
    });
    await service.applyInSession(
      ctx,
      CUSTOMER,
      addMutation('TEAM_ADD', [ACTOR]),
      {} as never,
    );
    expect(dispatch.mock.calls[0][0]).toEqual([]);
  });

  it('thêm hàng loạt (BULK_ADD) đặt groupKey = BULK:{X-Request-ID}', async () => {
    const { service, dispatch } = buildService({
      careTeam: existingTeam(),
      __v: 0,
    });
    await requestContextStorage.run({ requestId: 'req-42' }, () =>
      service.applyInSession(
        ctx,
        CUSTOMER,
        addMutation('BULK_ADD', [MEMBER_A]),
        {} as never,
      ),
    );
    expect(dispatch.mock.calls[0][0][0].context).toEqual({
      careRole: 'MEMBER',
      origin: 'BULK_ADD',
      groupKey: 'BULK:req-42',
    });
  });

  it('BULK_ADD với X-Request-ID quá dài: groupKey cắt phần requestId còn 128 ký tự', async () => {
    const { service, dispatch } = buildService({
      careTeam: existingTeam(),
      __v: 0,
    });
    await requestContextStorage.run({ requestId: 'r'.repeat(300) }, () =>
      service.applyInSession(
        ctx,
        CUSTOMER,
        addMutation('BULK_ADD', [MEMBER_A]),
        {} as never,
      ),
    );
    expect(dispatch.mock.calls[0][0][0].context.groupKey).toBe(
      `BULK:${'r'.repeat(128)}`,
    );
  });

  it('BULK_ADD ngoài ngữ cảnh HTTP (không có request id) thì không đặt groupKey', async () => {
    const { service, dispatch } = buildService({
      careTeam: existingTeam(),
      __v: 0,
    });
    await service.applyInSession(
      ctx,
      CUSTOMER,
      addMutation('BULK_ADD', [MEMBER_A]),
      {} as never,
    );
    expect(dispatch.mock.calls[0][0][0].context.groupKey).toBeUndefined();
  });

  it('không có thay đổi thì không gọi Dispatcher', async () => {
    const { service, dispatch } = buildService({
      careTeam: existingTeam(),
      __v: 0,
    });
    await service.applyInSession(
      ctx,
      CUSTOMER,
      addMutation('TEAM_ADD', [PRIMARY]),
      {} as never,
    );
    expect(dispatch).not.toHaveBeenCalled();
  });
});
