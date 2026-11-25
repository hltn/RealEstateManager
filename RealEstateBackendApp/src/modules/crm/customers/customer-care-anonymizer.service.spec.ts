import { Types } from 'mongoose';
import { CareTeamRequestStatus } from '../care-teams/care-team.constants';
import { CustomerCareAnonymizerService } from './customer-care-anonymizer.service';

/**
 * v1.0.5 T-13: luồng "đề nghị tham gia" đã bỏ nhưng dữ liệu `care_team_requests` cũ vẫn phải được dọn khi ẩn danh hóa khách
 * (xóa lời nhắn/ghi chú, hủy đề nghị đang chờ), trong cùng session/transaction và không xóa collection.
 */
describe('CustomerCareAnonymizerService.anonymize: dọn care_team_requests (T-13)', () => {
  const customerId = new Types.ObjectId();
  const now = new Date('2026-11-11T00:00:00.000Z');
  const session = { id: 's' } as never;

  const build = () => {
    const exec = jest.fn().mockResolvedValue({});
    const mk = () => ({
      updateMany: jest.fn().mockReturnValue({ exec }),
      deleteMany: jest.fn(),
    });
    const careLogModel = mk();
    const attachmentModel = mk();
    const requestModel = mk();
    const service = new CustomerCareAnonymizerService(
      careLogModel as never,
      attachmentModel as never,
      requestModel as never,
    );
    return { service, careLogModel, attachmentModel, requestModel };
  };

  it('xóa message/resolutionNote của mọi đề nghị của khách, cùng session, không đụng timestamps', async () => {
    const { service, requestModel } = build();
    await service.anonymize(customerId, now, session);
    expect(requestModel.updateMany).toHaveBeenNthCalledWith(
      1,
      { customerId },
      { $set: { message: null, resolutionNote: null } },
      { session, timestamps: false },
    );
  });

  it('hủy đề nghị PENDING còn lại (CANCELED + resolvedAt), chỉ lọc đúng khách đó', async () => {
    const { service, requestModel } = build();
    await service.anonymize(customerId, now, session);
    expect(requestModel.updateMany).toHaveBeenNthCalledWith(
      2,
      { customerId, status: CareTeamRequestStatus.PENDING },
      {
        $set: {
          status: CareTeamRequestStatus.CANCELED,
          resolvedAt: now,
        },
      },
      { session, timestamps: false },
    );
  });

  it('chỉ cập nhật, không xóa bản ghi/collection đề nghị; vẫn ẩn danh nhật ký và ảnh', async () => {
    const { service, requestModel, careLogModel, attachmentModel } = build();
    await service.anonymize(customerId, now, session);
    expect(requestModel.updateMany).toHaveBeenCalledTimes(2);
    expect(requestModel.deleteMany).not.toHaveBeenCalled();
    expect(careLogModel.updateMany.mock.calls[0][0]).toEqual({ customerId });
    expect(attachmentModel.updateMany.mock.calls[0][0]).toEqual({
      customerId,
    });
  });

  it('lỗi ở một bước thì ném nguyên lỗi (để transaction ẩn danh rollback), không nuốt lỗi', async () => {
    const { service, requestModel } = build();
    requestModel.updateMany.mockReturnValueOnce({
      exec: jest.fn().mockRejectedValue(new Error('db down')),
    });
    await expect(service.anonymize(customerId, now, session)).rejects.toThrow(
      'db down',
    );
    // Bước hủy PENDING không được chạy tiếp sau khi bước trước lỗi.
    expect(requestModel.updateMany).toHaveBeenCalledTimes(1);
  });
});
