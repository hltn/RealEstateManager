import { Types } from 'mongoose';
import { NotificationType } from '../../notifications/notification.constants';
import { shouldSendPush } from '../../notifications/push/push-catalog';
import { CareRole } from '../customers/customer.constants';
import { CareTeamRequestStatus } from './care-team.constants';
import { CareTeamRequestsService } from './care-team-requests.service';

/** T-34: hai điểm thông báo của đề nghị tham gia đi qua Dispatcher, có `dedupeKey` `JOINREQ`/`JOINRES`, không push. */
const oid = () => new Types.ObjectId();
const ACTOR = oid();
const PRIMARY = oid();
const MANAGER = oid();
const CUSTOMER = oid();
const REQUEST = oid();
const REQUESTER = oid();

const build = (managerIds: Types.ObjectId[] = [MANAGER]) => {
  const dispatch = jest.fn().mockResolvedValue({ created: 0 });
  const teamQuery = {
    select: jest.fn().mockReturnThis(),
    session: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([{ managerIds }]),
  };
  const teamModel = { find: jest.fn().mockReturnValue(teamQuery) };
  const service = new CareTeamRequestsService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { dispatch } as never,
    teamModel as never,
  );
  return { service, dispatch };
};

const session = { id: 's' } as never;

describe('CareTeamRequestsService thông báo qua Dispatcher (T-34)', () => {
  it('notifyReviewers: một yêu cầu CARE_TEAM_JOIN_REQUESTED, bỏ người gửi và bỏ trùng, dedupeKey JOINREQ, không push', async () => {
    const { service, dispatch } = build([MANAGER, PRIMARY, ACTOR]);
    await (service as any).notifyReviewers(
      { actor: { userId: ACTOR, displayName: 'Lan' } },
      {
        careTeam: [{ userId: PRIMARY, role: CareRole.PRIMARY }],
        teamIds: [oid()],
      },
      CUSTOMER,
      REQUEST,
      session,
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
    const [requests, usedSession] = dispatch.mock.calls[0];
    expect(usedSession).toBe(session);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      type: NotificationType.CARE_TEAM_JOIN_REQUESTED,
      inApp: {
        title: 'Có đề nghị tham gia chăm sóc khách',
        body: 'Lan đề nghị tham gia nhóm chăm sóc một khách bạn quản lý',
      },
      data: {
        customerId: CUSTOMER,
        requestId: REQUEST,
        deepLink: '/crm/care-team-requests',
      },
      dedupeKey: `JOINREQ:${String(REQUEST)}`,
    });
    expect(requests[0].recipientIds.map(String).sort()).toEqual(
      [String(PRIMARY), String(MANAGER)].sort(),
    );
    expect(shouldSendPush(requests[0].type, requests[0].context)).toBe(false);
  });

  it.each([
    [
      CareTeamRequestStatus.APPROVED,
      'Đề nghị tham gia được duyệt',
      `/crm/customers/${String(CUSTOMER)}`,
      true,
    ],
    [
      CareTeamRequestStatus.REJECTED,
      'Đề nghị tham gia bị từ chối',
      '/crm/care-team-requests',
      false,
    ],
  ])(
    'notifyRequester (%s): tiêu đề, deep link và dedupeKey JOINRES, không push',
    async (status, title, deepLink, hasCustomer) => {
      const { service, dispatch } = build();
      await (service as any).notifyRequester(
        { _id: REQUEST, requesterId: REQUESTER, customerId: CUSTOMER },
        status,
        session,
      );
      const [requests, usedSession] = dispatch.mock.calls[0];
      expect(usedSession).toBe(session);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        type: NotificationType.CARE_TEAM_JOIN_RESOLVED,
        recipientIds: [REQUESTER],
        inApp: { title },
        dedupeKey: `JOINRES:${String(REQUEST)}`,
      });
      expect(requests[0].data.deepLink).toBe(deepLink);
      expect(requests[0].data.requestId).toBe(REQUEST);
      expect(requests[0].data.customerId).toEqual(
        hasCustomer ? CUSTOMER : undefined,
      );
      expect(shouldSendPush(requests[0].type, requests[0].context)).toBe(false);
    },
  );
});
