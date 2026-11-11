import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { CustomerPurgeService } from './customer-purge.service';

/**
 * v1.0.5 T-13: luồng "đề nghị tham gia" đã bỏ nhưng xóa vĩnh viễn khách vẫn phải xóa các bản ghi `care_team_requests`
 * cũ của khách đó (xóa theo `customerId`, trong transaction), không động tới collection.
 */
describe('CustomerPurgeService.purge: dọn care_team_requests (T-13)', () => {
  const customerId = new Types.ObjectId();
  const adminId = new Types.ObjectId();
  const txSession = { id: 'tx' };

  const build = (deletedCounts: Record<string, number> = {}) => {
    const connection = {
      transaction: jest.fn((work: (s: unknown) => unknown) => work(txSession)),
      collection: jest.fn().mockReturnValue({
        deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      }),
    };
    const mkModel = (name: string) => ({
      deleteMany: jest.fn().mockReturnValue({
        exec: jest
          .fn()
          .mockResolvedValue({ deletedCount: deletedCounts[name] ?? 0 }),
      }),
      find: jest.fn().mockReturnValue({
        select: () => ({ lean: () => ({ exec: () => Promise.resolve([]) }) }),
      }),
      updateOne: jest.fn(),
      updateMany: jest.fn(),
    });
    const models = {
      customer: mkModel('customer'),
      careLog: mkModel('careLog'),
      attachment: mkModel('attachment'),
      request: mkModel('request'),
      appointment: mkModel('appointment'),
      reminder: mkModel('reminder'),
      notification: mkModel('notification'),
      tag: mkModel('tag'),
    };
    const repo = {
      updateOne: jest.fn().mockResolvedValue(1),
      findOne: jest
        .fn()
        .mockResolvedValue({ deletedAt: new Date(), tagIds: [] }),
    };
    const access = {
      resolve: jest.fn().mockResolvedValue({
        actor: { role: UserRole.ADMIN, userId: adminId },
        scope: {},
      }),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new CustomerPurgeService(
      connection as never,
      models.customer as never,
      models.careLog as never,
      models.attachment as never,
      models.request as never,
      models.appointment as never,
      models.reminder as never,
      models.notification as never,
      models.tag as never,
      { isConfigured: () => true } as never,
      repo as never,
      access as never,
      audit as never,
    );
    return { service, models, audit, connection };
  };

  const jwt = { sub: String(adminId) } as never;

  it('xóa mọi đề nghị của đúng khách đó (cùng session) và trả số lượng trong purged.careTeamRequests', async () => {
    const { service, models } = build({ request: 3 });
    const result = await service.purge(jwt, String(customerId));
    expect(models.request.deleteMany).toHaveBeenCalledTimes(1);
    expect(models.request.deleteMany).toHaveBeenCalledWith(
      { customerId },
      { session: txSession },
    );
    expect(result.purged.careTeamRequests).toBe(3);
  });

  it('khách không có đề nghị nào (dữ liệu sau v1.0.5): vẫn thành công, careTeamRequests = 0', async () => {
    const { service } = build();
    const result = await service.purge(jwt, String(customerId));
    expect(result.purged.careTeamRequests).toBe(0);
  });

  it('chỉ xóa bản ghi (deleteMany), không drop collection; số lượng đề nghị có trong dòng audit CUSTOMER_PURGED', async () => {
    const { service, audit, connection } = build({ request: 2 });
    await service.purge(jwt, String(customerId));
    expect(connection.collection).toHaveBeenCalledTimes(1);
    expect(connection.collection).toHaveBeenCalledWith('crm_audit_logs');
    const recorded = audit.record.mock.calls[0][0];
    expect(recorded.changes[0].to).toMatchObject({ careTeamRequests: 2 });
  });
});
