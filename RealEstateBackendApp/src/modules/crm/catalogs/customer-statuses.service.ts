import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { PaginationMetaDto } from '../../../common/dto/paginated-response.dto';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { isDuplicateKeyError } from '../../../common/utils/mongo-error.util';
import {
  buildPaginationMeta,
  normalizePagination,
} from '../../../common/utils/pagination.util';
import { withTransaction } from '../../../shared/database/with-transaction.util';
import { diffFields } from '../audit-logs/audit-diff.util';
import {
  CrmAuditAction,
  CrmAuditEntityType,
} from '../audit-logs/crm-audit.constants';
import { CrmAuditLogService } from '../audit-logs/crm-audit-log.service';
import { CrmUsageService } from '../common/crm-usage.service';
import { ListGroup } from './catalog.enums';
import {
  CreateCustomerStatusDto,
  CustomerStatusResponseDto,
  ListCustomerStatusesQueryDto,
  UpdateCustomerStatusDto,
} from './dtos/customer-status.dto';
import {
  CustomerStatus,
  CustomerStatusDocument,
} from './schemas/customer-status.schema';

const AUDIT_SUBTYPE = 'CUSTOMER_STATUS';
const AUDIT_FIELDS = [
  'code',
  'label',
  'listGroup',
  'color',
  'order',
  'isDefault',
  'isActive',
] as const;

const validationError = (message: string): BusinessException =>
  new BusinessException(
    ErrorCode.VALIDATION_FAILED,
    message,
    HttpStatus.BAD_REQUEST,
  );

type StatusLean = CustomerStatus & { _id: Types.ObjectId };

export const toCustomerStatusResponse = (
  doc: StatusLean,
): CustomerStatusResponseDto => ({
  id: String(doc._id),
  code: doc.code,
  label: doc.label,
  listGroup: doc.listGroup,
  color: doc.color ?? null,
  order: doc.order,
  isDefault: doc.isDefault,
  isSystem: doc.isSystem,
  isActive: doc.isActive,
});

/**
 * Tình trạng khách (`/crm/customer-statuses`). Bất biến được giữ ở đây:
 * - Luôn có đúng 1 tình trạng mặc định, thuộc nhóm NOT_CONTACTED và đang hoạt động.
 * - Tình trạng hệ thống (isSystem) không xóa, không đổi nhóm.
 * - Không xóa tình trạng đang có khách.
 */
@Injectable()
export class CustomerStatusesService {
  constructor(
    @InjectModel(CustomerStatus.name)
    private readonly statusModel: Model<CustomerStatusDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly usage: CrmUsageService,
    private readonly audit: CrmAuditLogService,
  ) {}

  async list(
    query: ListCustomerStatusesQueryDto,
  ): Promise<{ data: CustomerStatusResponseDto[]; meta: PaginationMetaDto }> {
    const { page, limit, skip } = normalizePagination(query.page, query.limit);
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.listGroup) filter.listGroup = query.listGroup;
    if (query.isActive !== undefined) filter.isActive = query.isActive;

    const [docs, total] = await Promise.all([
      this.statusModel
        .find(filter)
        .sort({ order: 1, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.statusModel.countDocuments(filter).exec(),
    ]);
    return {
      data: docs.map(toCustomerStatusResponse),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async create(
    jwt: JwtPayload,
    dto: CreateCustomerStatusDto,
  ): Promise<CustomerStatusResponseDto> {
    try {
      const created = await withTransaction(
        this.connection,
        async (session) => {
          const order = dto.order ?? (await this.nextOrder(session));
          const [doc] = await this.statusModel.create(
            [
              {
                code: dto.code,
                label: dto.label,
                listGroup: dto.listGroup,
                color: dto.color ?? null,
                order,
                isDefault: false,
                isSystem: false,
                isActive: true,
              },
            ],
            { session },
          );
          await this.audit.record(
            {
              entityType: CrmAuditEntityType.CATALOG,
              entitySubtype: AUDIT_SUBTYPE,
              entityId: doc._id,
              action: CrmAuditAction.CATALOG_CREATED,
              actor: jwt,
              changes: diffFields({}, doc.toObject(), AUDIT_FIELDS),
            },
            session,
          );
          return doc.toObject();
        },
      );
      return toCustomerStatusResponse(created);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new BusinessException(
          ErrorCode.CATALOG_DUPLICATED,
          `Mã tình trạng "${dto.code}" đã tồn tại`,
          HttpStatus.CONFLICT,
          { field: 'code', value: dto.code },
        );
      }
      throw error;
    }
  }

  async update(
    jwt: JwtPayload,
    id: string,
    dto: UpdateCustomerStatusDto,
  ): Promise<CustomerStatusResponseDto> {
    const updated = await withTransaction(this.connection, async (session) => {
      const statusId = new Types.ObjectId(id);
      const before = await this.statusModel
        .findOne({ _id: statusId, deletedAt: null })
        .session(session)
        .lean()
        .exec();
      if (!before) throw this.notFound();

      const next = this.applyChanges(before, dto);
      const patch: Partial<CustomerStatus> = {
        label: next.label,
        color: next.color,
        order: next.order,
        listGroup: next.listGroup,
        isDefault: next.isDefault,
        isActive: next.isActive,
      };

      // Đặt làm mặc định => gỡ cờ mặc định ở các tình trạng khác (cùng transaction).
      if (next.isDefault && !before.isDefault) {
        await this.statusModel
          .updateMany(
            { _id: { $ne: statusId }, isDefault: true },
            { $set: { isDefault: false } },
            { session },
          )
          .exec();
      }

      const after = await this.statusModel
        .findOneAndUpdate(
          { _id: statusId },
          { $set: patch },
          { returnDocument: 'after', session },
        )
        .lean()
        .exec();
      if (!after) throw this.notFound();

      const changes = diffFields(before, after, AUDIT_FIELDS);
      if (changes.length > 0) {
        await this.audit.record(
          {
            entityType: CrmAuditEntityType.CATALOG,
            entitySubtype: AUDIT_SUBTYPE,
            entityId: statusId,
            action: CrmAuditAction.CATALOG_UPDATED,
            actor: jwt,
            changes,
          },
          session,
        );
      }
      return after;
    });
    return toCustomerStatusResponse(updated);
  }

  /** Xóa mềm: chặn tình trạng hệ thống, mặc định hoặc đang có khách tham chiếu. */
  async remove(jwt: JwtPayload, id: string): Promise<void> {
    const statusId = new Types.ObjectId(id);
    await withTransaction(this.connection, async (session) => {
      const status = await this.statusModel
        .findOne({ _id: statusId, deletedAt: null })
        .session(session)
        .lean()
        .exec();
      if (!status) throw this.notFound();

      if (status.isSystem) {
        throw new BusinessException(
          ErrorCode.CATALOG_SYSTEM,
          'Không thể xóa tình trạng hệ thống, hãy tắt hoạt động nếu không dùng',
          HttpStatus.CONFLICT,
        );
      }
      if (status.isDefault) {
        throw validationError(
          'Không thể xóa tình trạng mặc định, hãy đặt tình trạng khác làm mặc định trước',
        );
      }
      const usageCount = await this.usage.countCustomersByStatus(statusId);
      if (usageCount > 0) {
        throw new BusinessException(
          ErrorCode.CATALOG_IN_USE,
          'Tình trạng đang có khách, hãy tắt hoạt động thay vì xóa',
          HttpStatus.CONFLICT,
          { usageCount },
        );
      }

      await this.statusModel
        .updateOne(
          { _id: statusId },
          { $set: { deletedAt: new Date() } },
          { session },
        )
        .exec();
      await this.audit.record(
        {
          entityType: CrmAuditEntityType.CATALOG,
          entitySubtype: AUDIT_SUBTYPE,
          entityId: statusId,
          action: CrmAuditAction.CATALOG_DELETED,
          actor: jwt,
          changes: [{ field: 'code', from: status.code, to: null }],
        },
        session,
      );
    });
  }

  /**
   * Áp thay đổi lên bản hiện tại và kiểm các bất biến; ném lỗi nghiệp vụ nếu vi phạm.
   * Hàm thuần (không đụng DB) nên dễ kiểm thử riêng.
   */
  applyChanges(
    before: StatusLean,
    dto: UpdateCustomerStatusDto,
  ): Pick<
    CustomerStatus,
    'label' | 'color' | 'order' | 'listGroup' | 'isDefault' | 'isActive'
  > {
    const next = {
      label: dto.label ?? before.label,
      color: dto.color === undefined ? (before.color ?? null) : dto.color,
      order: dto.order ?? before.order,
      listGroup: dto.listGroup ?? before.listGroup,
      isDefault: dto.isDefault ?? before.isDefault,
      isActive: dto.isActive ?? before.isActive,
    };

    if (next.listGroup !== before.listGroup && before.isSystem) {
      throw new BusinessException(
        ErrorCode.CATALOG_SYSTEM,
        'Không đổi được nhóm danh sách của tình trạng hệ thống',
        HttpStatus.CONFLICT,
      );
    }
    if (before.isDefault && !next.isDefault) {
      throw validationError(
        'Phải có một tình trạng mặc định, hãy đặt tình trạng khác làm mặc định thay vì bỏ cờ này',
      );
    }
    if (next.isDefault && next.listGroup !== ListGroup.NOT_CONTACTED) {
      throw validationError(
        'Tình trạng mặc định phải thuộc nhóm "Chưa tiếp cận" (NOT_CONTACTED)',
      );
    }
    if (next.isDefault && !next.isActive) {
      throw validationError('Tình trạng mặc định phải đang hoạt động');
    }
    return next;
  }

  private async nextOrder(session: ClientSession): Promise<number> {
    const last = await this.statusModel
      .findOne({})
      .sort({ order: -1 })
      .select('order')
      .session(session)
      .lean()
      .exec();
    return (last?.order ?? 0) + 1;
  }

  private notFound(): NotFoundException {
    return new NotFoundException('Không tìm thấy tình trạng khách');
  }
}
