import { Types } from 'mongoose';
import { CrmUsageService } from './crm-usage.service';

const build = () => {
  const countDocuments = jest.fn().mockResolvedValue(3);
  const collection = jest.fn().mockReturnValue({ countDocuments });
  const service = new CrmUsageService({ collection } as never);
  return { service, collection, countDocuments };
};

const id = new Types.ObjectId();

describe('CrmUsageService: đếm theo id HOẶC code (FR-40)', () => {
  it('FR-40: tình trạng đếm bằng $or để bản ghi thiếu code vẫn được tính', async () => {
    const { service, collection, countDocuments } = build();
    await expect(service.countCustomersByStatus(id, 'NEW')).resolves.toBe(3);
    expect(collection).toHaveBeenCalledWith('customers');
    expect(countDocuments).toHaveBeenCalledWith({
      $or: [{ statusCode: 'NEW' }, { statusId: id }],
    });
  });

  it('FR-40: không có code (danh mục cũ) thì chỉ đếm theo id', async () => {
    const { service, countDocuments } = build();
    await service.countCustomersBySource(id);
    expect(countDocuments).toHaveBeenCalledWith({ sourceId: id });
    await service.countCustomersByArea(id, null);
    expect(countDocuments).toHaveBeenLastCalledWith({ areaId: id });
  });

  it('FR-40: khu vực của khách và dự án đều có $or, dự án giữ deletedAt null', async () => {
    const { service, countDocuments } = build();
    await service.countCustomersByArea(id, 'HA_NOI');
    expect(countDocuments).toHaveBeenLastCalledWith({
      $or: [{ areaCode: 'HA_NOI' }, { areaId: id }],
    });
    await service.countProjectsByArea(id, 'HA_NOI');
    expect(countDocuments).toHaveBeenLastCalledWith({
      $or: [{ areaCode: 'HA_NOI' }, { areaId: id }],
      deletedAt: null,
    });
  });

  it('FR-40: kết quả liên hệ trên nhật ký chăm sóc', async () => {
    const { service, collection, countDocuments } = build();
    await service.countCareLogsByContactResult(id, 'NO_ANSWER');
    expect(collection).toHaveBeenCalledWith('care_logs');
    expect(countDocuments).toHaveBeenCalledWith({
      $or: [{ contactResultCode: 'NO_ANSWER' }, { contactResultId: id }],
      deletedAt: null,
    });
  });

  it('FR-40: dự án đang có khách quan tâm đếm theo mã hoặc id, truyền session', async () => {
    const { service, countDocuments } = build();
    const session = {} as never;
    await service.countActiveCustomersByProject(id, session, 'VINHOMES');
    expect(countDocuments).toHaveBeenCalledWith(
      {
        $or: [
          { interestedProjectCodes: 'VINHOMES' },
          { interestedProjectIds: id },
        ],
        deletedAt: null,
      },
      { session },
    );
  });
});
