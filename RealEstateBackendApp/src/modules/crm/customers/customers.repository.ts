import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  ClientSession,
  Model,
  PipelineStage,
  ProjectionType,
  Types,
} from 'mongoose';
import { CustomerScope } from './access/customer-scope';
import { Customer, CustomerDocument } from './schemas/customer.schema';

export type CustomerLean = Customer & { _id: Types.ObjectId };

/** `exclude`: chỉ khách chưa xóa mềm (mặc định); `only`: chỉ khách đã xóa mềm; `any`: cả hai. */
export type DeletedMode = 'exclude' | 'only' | 'any';

export interface FindOptions {
  deleted?: DeletedMode;
  session?: ClientSession;
  projection?: ProjectionType<Customer>;
}

export interface ListOptions extends FindOptions {
  sort?: Record<string, 1 | -1>;
  skip?: number;
  limit?: number;
  collation?: { locale: string };
}

/**
 * Tầng truy vấn `customers` (tài liệu 04 mục 4.3): MỌI hàm đọc/ghi nhận `scope: CustomerScope` và gộp vào bộ
 * lọc — thiếu phạm vi là lỗi biên dịch vì `CustomerScope` chỉ `buildCustomerScope` tạo được.
 * Ngoại lệ không có scope chỉ gồm `findByPhoneForDuplicateCheck` (SĐT duy nhất toàn hệ thống nên phải tra
 * cả khách ngoài phạm vi để báo trùng) và `findByIdForJoinRequest` (đề nghị tham gia nhóm của người chưa thấy khách);
 * cả hai chỉ trả field tối thiểu.
 */
@Injectable()
export class CustomersRepository {
  constructor(
    @InjectModel(Customer.name)
    private readonly model: Model<CustomerDocument>,
  ) {}

  /** Bộ lọc cuối cùng = phạm vi AND điều kiện nghiệp vụ AND điều kiện xóa mềm. */
  buildFilter(
    scope: CustomerScope,
    filter: Record<string, unknown> = {},
    deleted: DeletedMode = 'exclude',
  ): Record<string, unknown> {
    const parts: Record<string, unknown>[] = [];
    if (Object.keys(scope).length > 0) parts.push({ ...scope });
    if (Object.keys(filter).length > 0) parts.push(filter);
    if (deleted === 'exclude') parts.push({ deletedAt: null });
    if (deleted === 'only') parts.push({ deletedAt: { $ne: null } });
    if (parts.length === 0) return {};
    return parts.length === 1 ? parts[0] : { $and: parts };
  }

  async findOne(
    scope: CustomerScope,
    id: string | Types.ObjectId,
    options: FindOptions = {},
  ): Promise<CustomerLean | null> {
    const query = this.model.findOne(
      this.buildFilter(
        scope,
        { _id: new Types.ObjectId(String(id)) },
        options.deleted,
      ),
      options.projection,
    );
    if (options.session) query.session(options.session);
    return await query.lean().exec();
  }

  async find(
    scope: CustomerScope,
    filter: Record<string, unknown>,
    options: ListOptions = {},
  ): Promise<CustomerLean[]> {
    const query = this.model.find(
      this.buildFilter(scope, filter, options.deleted),
      options.projection,
    );
    if (options.sort) query.sort(options.sort);
    if (options.skip) query.skip(options.skip);
    if (options.limit) query.limit(options.limit);
    if (options.collation) query.collation(options.collation);
    if (options.session) query.session(options.session);
    return await query.lean().exec();
  }

  count(
    scope: CustomerScope,
    filter: Record<string, unknown>,
    deleted: DeletedMode = 'exclude',
  ): Promise<number> {
    return this.model
      .countDocuments(this.buildFilter(scope, filter, deleted))
      .exec();
  }

  aggregate<T>(
    scope: CustomerScope,
    filter: Record<string, unknown>,
    tail: PipelineStage[],
    deleted: DeletedMode = 'exclude',
  ): Promise<T[]> {
    return this.model
      .aggregate<T>([
        { $match: this.buildFilter(scope, filter, deleted) },
        ...tail,
      ])
      .exec();
  }

  /**
   * Cập nhật CÓ phạm vi. `extraFilter` thường là `{ __v: version }` (khóa lạc quan). Trả `true` khi có
   * đúng một bản ghi khớp (cả phạm vi + điều kiện).
   */
  async updateOne(
    scope: CustomerScope,
    id: string | Types.ObjectId,
    extraFilter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: { deleted?: DeletedMode; session: ClientSession },
  ): Promise<boolean> {
    const result = await this.model
      .updateOne(
        this.buildFilter(
          scope,
          { _id: new Types.ObjectId(String(id)), ...extraFilter },
          options.deleted,
        ),
        update,
        { session: options.session },
      )
      .exec();
    return result.matchedCount === 1;
  }

  async insert(
    doc: Partial<Customer> & { _id: Types.ObjectId },
    session: ClientSession,
  ): Promise<void> {
    await this.model.create([doc], { session });
  }

  /**
   * DÀNH RIÊNG CHO WORKER/SCHEDULER (không có người gọi nên không có phạm vi): lấy một lô khách chưa xóa mềm theo
   * điều kiện, sắp theo `_id`, tiếp từ `afterId` (duyệt cả tập lớn theo lô mà không dùng `skip`). Người nhận kết quả
   * (thông báo...) vẫn phải được lọc theo nhóm chăm sóc HIỆN TẠI của khách.
   */
  findForSystemJobBatch(
    filter: Record<string, unknown>,
    options: {
      projection: ProjectionType<Customer>;
      afterId?: Types.ObjectId;
      limit: number;
    },
  ): Promise<CustomerLean[]> {
    return this.model
      .find(
        {
          ...filter,
          deletedAt: null,
          ...(options.afterId && { _id: { $gt: options.afterId } }),
        },
        options.projection,
      )
      .sort({ _id: 1 })
      .limit(options.limit)
      .lean()
      .exec();
  }

  /** DÀNH RIÊNG CHO WORKER: đọc khách theo id (chỉ khách chưa xóa mềm), không phạm vi. */
  findForSystemJobById(
    id: Types.ObjectId,
    projection: ProjectionType<Customer>,
    session?: ClientSession,
  ): Promise<CustomerLean | null> {
    return this.model
      .findOne({ _id: id, deletedAt: null }, projection)
      .session(session ?? null)
      .lean()
      .exec();
  }

  /**
   * NGOẠI LỆ không phạm vi: tra khách theo SĐT chuẩn hóa (kể cả đã xóa mềm) để báo trùng/tra cứu trùng.
   * Chỉ lấy field tối thiểu (không có tên, email, SĐT).
   */
  findByPhoneForDuplicateCheck(
    phone: string,
    session?: ClientSession,
  ): Promise<Pick<
    CustomerLean,
    '_id' | 'careTeam' | 'primaryAssigneeId' | 'teamIds' | 'deletedAt'
  > | null> {
    const query = this.model
      .findOne({ phone })
      .select('careTeam primaryAssigneeId teamIds deletedAt');
    if (session) query.session(session);
    return query.lean().exec();
  }

  /**
   * NGOẠI LỆ không phạm vi thứ hai: tra khách theo `_id` để gửi đề nghị tham gia nhóm chăm sóc. Người gửi đề nghị
   * theo định nghĩa chưa thấy khách (ngoài phạm vi) nhưng đã có `customerRef` từ `phone-lookups`. Chỉ trả field
   * tối thiểu (không có tên, SĐT, email); khách đã xóa mềm/ẩn danh do service xử lý như không tồn tại.
   */
  findByIdForJoinRequest(
    id: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<Pick<
    CustomerLean,
    '_id' | 'careTeam' | 'teamIds' | 'deletedAt' | 'anonymizedAt'
  > | null> {
    const query = this.model
      .findOne({ _id: new Types.ObjectId(String(id)) })
      .select('careTeam teamIds deletedAt anonymizedAt');
    if (session) query.session(session);
    return query.lean().exec();
  }
}
