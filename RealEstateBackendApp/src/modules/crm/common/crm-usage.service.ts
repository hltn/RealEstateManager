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
  countCustomersByStatus(
    statusId: Types.ObjectId,
    statusCode?: string | null,
  ): Promise<number> {
    return this.countCustomers(
      idOrCode('statusId', statusId, 'statusCode', statusCode),
    );
  }

  countCustomersBySource(
    sourceId: Types.ObjectId,
    sourceCode?: string | null,
  ): Promise<number> {
    return this.countCustomers(
      idOrCode('sourceId', sourceId, 'sourceCode', sourceCode),
    );
  }

  countCustomersByArea(
    areaId: Types.ObjectId,
    areaCode?: string | null,
  ): Promise<number> {
    return this.countCustomers(
      idOrCode('areaId', areaId, 'areaCode', areaCode),
    );
  }

  /** Số dự án chưa xóa mềm gắn với khu vực (chặn xóa khu vực đang dùng). */
  countProjectsByArea(
    areaId: Types.ObjectId,
    areaCode?: string | null,
  ): Promise<number> {
    return this.connection.collection('projects').countDocuments({
      ...idOrCode('areaId', areaId, 'areaCode', areaCode),
      deletedAt: null,
    });
  }

  countCareLogsByContactResult(
    contactResultId: Types.ObjectId,
    contactResultCode?: string | null,
  ): Promise<number> {
    return this.connection.collection('care_logs').countDocuments({
      ...idOrCode(
        'contactResultId',
        contactResultId,
        'contactResultCode',
        contactResultCode,
      ),
      deletedAt: null,
    });
  }

  /** Số khách CHƯA xóa mềm đang quan tâm một dự án (quy tắc xóa dự án, tài liệu 04 mục 3.3). */
  async countActiveCustomersByProject(
    projectId: Types.ObjectId,
    session?: ClientSession,
    projectCode?: string | null,
  ): Promise<number> {
    return this.connection.collection('customers').countDocuments(
      {
        ...idOrCode(
          'interestedProjectIds',
          projectId,
          'interestedProjectCodes',
          projectCode,
        ),
        deletedAt: null,
      },
      { session },
    );
  }

  /**
   * Số khách chưa xóa mềm theo từng dự án, gom bằng 1 aggregate (chống N+1 khi liệt kê dự án).
   * Dự án không có khách vắng mặt trong Map (đọc bằng `?? 0`; khóa là id dạng chuỗi).
   *
   * FR-40 (ghi kép): khách khớp dự án theo id HOẶC `code` (`interestedProjectCodes` chứa `codeNormalized`), để khách
   * chỉ có id (bản ghi cũ/image v1.0.3 ghi) lẫn khách chỉ có code đều được đếm. Mỗi khách được quy về TẬP id dự án
   * mà nó khớp (hợp của khớp-id và khớp-code, khử trùng) trước khi `$unwind`, nên khách có cả id lẫn code của cùng một
   * dự án chỉ được đếm MỘT lần.
   */
  async countActiveCustomersByProjects(
    projects: Array<{ _id: Types.ObjectId; codeNormalized?: string | null }>,
  ): Promise<Map<string, number>> {
    if (projects.length === 0) return new Map();
    const projectIds = projects.map((project) => project._id);
    const pairs = projects.flatMap((project) =>
      project.codeNormalized
        ? [{ id: project._id, code: project.codeNormalized }]
        : [],
    );
    const codes = pairs.map((pair) => pair.code);
    const rows = await this.connection
      .collection('customers')
      .aggregate<{ _id: Types.ObjectId; count: number }>([
        {
          $match: {
            deletedAt: null,
            $or: [
              { interestedProjectIds: { $in: projectIds } },
              ...(codes.length > 0
                ? [{ interestedProjectCodes: { $in: codes } }]
                : []),
            ],
          },
        },
        {
          $project: {
            matched: {
              $setUnion: [
                {
                  $setIntersection: [
                    { $ifNull: ['$interestedProjectIds', []] },
                    projectIds,
                  ],
                },
                {
                  $map: {
                    input: {
                      $filter: {
                        input: { $literal: pairs },
                        as: 'pair',
                        cond: {
                          $in: [
                            '$$pair.code',
                            { $ifNull: ['$interestedProjectCodes', []] },
                          ],
                        },
                      },
                    },
                    as: 'pair',
                    in: '$$pair.id',
                  },
                },
              ],
            },
          },
        },
        { $unwind: '$matched' },
        { $group: { _id: '$matched', count: { $sum: 1 } } },
      ])
      .toArray();
    return new Map(rows.map((row) => [String(row._id), row.count]));
  }

  private countCustomers(filter: Record<string, unknown>): Promise<number> {
    return this.connection.collection('customers').countDocuments(filter);
  }
}

/**
 * Điều kiện "dùng danh mục" trong giai đoạn ghi kép (FR-40): khớp theo id HOẶC `code`, để bản ghi chưa kịp điền
 * `code` vẫn được đếm (chặn xóa đúng). Không có `code` thì chỉ dùng id.
 */
const idOrCode = (
  idField: string,
  id: Types.ObjectId,
  codeField: string,
  code?: string | null,
): Record<string, unknown> =>
  code
    ? { $or: [{ [codeField]: code }, { [idField]: id }] }
    : { [idField]: id };
