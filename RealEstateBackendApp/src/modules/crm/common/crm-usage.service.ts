import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection, Types } from 'mongoose';

/**
 * Đếm số bản ghi nghiệp vụ đang THAM CHIẾU tới danh mục/dự án — để chặn xóa khi đang dùng
 * (`PROJECT_IN_USE`, `CATALOG_IN_USE`).
 *
 * Đọc thẳng collection `customers` / `care_logs` (schema của chúng thuộc M2/M3) qua driver thay vì
 * import schema chưa tồn tại: collection chưa có thì kết quả là 0, M2/M3 chỉ cần giữ nguyên tên
 * collection và tên field (`statusId`, `sourceId`, `areaId`, `interestedProjectIds`, `contactResultId`).
 * Chỉ ĐỌC, không bao giờ ghi vào các collection này.
 */
@Injectable()
export class CrmUsageService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /** Số khách (kể cả đã xóa mềm — khôi phục lại vẫn cần danh mục) đang dùng một tình trạng. */
  countCustomersByStatus(statusId: Types.ObjectId): Promise<number> {
    return this.countCustomers({ statusId });
  }

  countCustomersBySource(sourceId: Types.ObjectId): Promise<number> {
    return this.countCustomers({ sourceId });
  }

  countCustomersByArea(areaId: Types.ObjectId): Promise<number> {
    return this.countCustomers({ areaId });
  }

  /** Số dự án chưa xóa mềm gắn với khu vực (chặn xóa khu vực đang dùng). */
  countProjectsByArea(areaId: Types.ObjectId): Promise<number> {
    return this.connection
      .collection('projects')
      .countDocuments({ areaId, deletedAt: null });
  }

  countCareLogsByContactResult(
    contactResultId: Types.ObjectId,
  ): Promise<number> {
    return this.connection
      .collection('care_logs')
      .countDocuments({ contactResultId, deletedAt: null });
  }

  /** Số khách CHƯA xóa mềm đang quan tâm một dự án (quy tắc xóa dự án, tài liệu 04 mục 3.3). */
  async countActiveCustomersByProject(
    projectId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<number> {
    return this.connection
      .collection('customers')
      .countDocuments(
        { interestedProjectIds: projectId, deletedAt: null },
        { session },
      );
  }

  /**
   * Số khách chưa xóa mềm theo từng dự án, gom bằng 1 aggregate (chống N+1 khi liệt kê dự án).
   * Dự án không có khách vắng mặt trong Map (đọc bằng `?? 0`).
   */
  async countActiveCustomersByProjects(
    projectIds: Types.ObjectId[],
  ): Promise<Map<string, number>> {
    if (projectIds.length === 0) return new Map();
    const rows = await this.connection
      .collection('customers')
      .aggregate<{ _id: Types.ObjectId; count: number }>([
        {
          $match: {
            interestedProjectIds: { $in: projectIds },
            deletedAt: null,
          },
        },
        { $unwind: '$interestedProjectIds' },
        { $match: { interestedProjectIds: { $in: projectIds } } },
        { $group: { _id: '$interestedProjectIds', count: { $sum: 1 } } },
      ])
      .toArray();
    return new Map(rows.map((row) => [String(row._id), row.count]));
  }

  private countCustomers(filter: Record<string, unknown>): Promise<number> {
    return this.connection.collection('customers').countDocuments(filter);
  }
}
