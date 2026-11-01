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
import { escapeRegex } from '../../../common/utils/regex.util';
import { withTransaction } from '../../../shared/database/with-transaction.util';
import { diffFields } from '../audit-logs/audit-diff.util';
import {
  CrmAuditAction,
  CrmAuditEntityType,
} from '../audit-logs/crm-audit.constants';
import { CrmAuditLogService } from '../audit-logs/crm-audit-log.service';
import { CrmUsageService } from '../common/crm-usage.service';
import { CatalogItemType } from './catalog.enums';
import {
  ContactResultResponseDto,
  LeadSourceResponseDto,
} from './dtos/catalog-item.dto';
import {
  CatalogItem,
  CatalogItemDocument,
} from './schemas/catalog-item.schema';

/** Dữ liệu ghi/sửa chung của danh mục phẳng; `meta` chỉ có với CONTACT_RESULT. */
export interface CatalogItemInput {
  code?: string;
  label?: string;
  order?: number;
  isActive?: boolean;
  suggestedFollowUpDays?: number | null;
  suggestionText?: string;
}

export interface CatalogItemListFilter {
  isActive?: boolean;
  q?: string;
  page?: number;
  limit?: number;
}

type ItemLean = CatalogItem & { _id: Types.ObjectId };

const AUDIT_FIELDS = ['code', 'label', 'order', 'isActive'] as const;
const META_FIELDS = [
  'meta.suggestedFollowUpDays',
  'meta.suggestionText',
] as const;

export const toLeadSourceResponse = (doc: ItemLean): LeadSourceResponseDto => ({
  id: String(doc._id),
  label: doc.label,
  code: doc.code,
  order: doc.order,
  isActive: doc.isActive,
});

export const toContactResultResponse = (
  doc: ItemLean,
): ContactResultResponseDto => ({
  ...toLeadSourceResponse(doc),
  suggestedFollowUpDays: doc.meta?.suggestedFollowUpDays ?? null,
  suggestionText: doc.meta?.suggestionText ?? '',
});

/**
 * Danh mục phẳng dùng chung (`catalog_items`) cho nguồn khách và kết quả liên hệ — MỘT service,
 * phân biệt bằng `type` để không lặp code (DRY). Controller chỉ khác route và dạng response.
 */
@Injectable()
export class CatalogItemsService {
  constructor(
    @InjectModel(CatalogItem.name)
    private readonly itemModel: Model<CatalogItemDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly usage: CrmUsageService,
    private readonly audit: CrmAuditLogService,
  ) {}

  async list(
    type: CatalogItemType,
    query: CatalogItemListFilter,
  ): Promise<{ data: ItemLean[]; meta: PaginationMetaDto }> {
    const { page, limit, skip } = normalizePagination(query.page, query.limit);
    const filter: Record<string, unknown> = { type, deletedAt: null };
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.q) {
      const pattern = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ label: pattern }, { code: pattern }];
    }

    const [docs, total] = await Promise.all([
      this.itemModel
        .find(filter)
        .sort({ order: 1, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.itemModel.countDocuments(filter).exec(),
    ]);
    return {
      data: docs,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async create(
    type: CatalogItemType,
    jwt: JwtPayload,
    input: CatalogItemInput,
  ): Promise<ItemLean> {
    try {
      return await withTransaction(this.connection, async (session) => {
        const order = input.order ?? (await this.nextOrder(type, session));
        const [doc] = await this.itemModel.create(
          [
            {
              type,
              code: input.code,
              label: input.label,
              order,
              isActive: true,
              isSystem: false,
              meta:
                type === CatalogItemType.CONTACT_RESULT
                  ? {
                      suggestedFollowUpDays:
                        input.suggestedFollowUpDays ?? null,
                      suggestionText: input.suggestionText ?? '',
                    }
                  : null,
            },
          ],
          { session },
        );
        await this.audit.record(
          {
            entityType: CrmAuditEntityType.CATALOG,
            entitySubtype: type,
            entityId: doc._id,
            action: CrmAuditAction.CATALOG_CREATED,
            actor: jwt,
            changes: diffFields({}, doc.toObject(), AUDIT_FIELDS),
          },
          session,
        );
        return doc.toObject();
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new BusinessException(
          ErrorCode.CATALOG_DUPLICATED,
          `Mã "${input.code}" đã tồn tại`,
          HttpStatus.CONFLICT,
          { field: 'code', value: input.code },
        );
      }
      throw error;
    }
  }

  async update(
    type: CatalogItemType,
    jwt: JwtPayload,
    id: string,
    input: CatalogItemInput,
  ): Promise<ItemLean> {
    return withTransaction(this.connection, async (session) => {
      const itemId = new Types.ObjectId(id);
      const before = await this.itemModel
        .findOne({ _id: itemId, type, deletedAt: null })
        .session(session)
        .lean()
        .exec();
      if (!before) throw this.notFound();

      const patch: Record<string, unknown> = {};
      if (input.label !== undefined) patch.label = input.label;
      if (input.order !== undefined) patch.order = input.order;
      if (input.isActive !== undefined) patch.isActive = input.isActive;
      if (input.suggestedFollowUpDays !== undefined) {
        patch['meta.suggestedFollowUpDays'] = input.suggestedFollowUpDays;
      }
      if (input.suggestionText !== undefined) {
        patch['meta.suggestionText'] = input.suggestionText;
      }

      const after = await this.itemModel
        .findOneAndUpdate(
          { _id: itemId },
          { $set: patch },
          { returnDocument: 'after', session },
        )
        .lean()
        .exec();
      if (!after) throw this.notFound();

      const changes = [
        ...diffFields(before, after, AUDIT_FIELDS),
        ...META_FIELDS.flatMap((path) =>
          diffFields(
            { [path]: this.readPath(before, path) },
            { [path]: this.readPath(after, path) },
            [path],
          ),
        ),
      ];
      if (changes.length > 0) {
        await this.audit.record(
          {
            entityType: CrmAuditEntityType.CATALOG,
            entitySubtype: type,
            entityId: itemId,
            action: CrmAuditAction.CATALOG_UPDATED,
            actor: jwt,
            changes,
          },
          session,
        );
      }
      return after;
    });
  }

  /** Xóa mềm; chặn mục hệ thống hoặc đang được dùng (409 CATALOG_SYSTEM / CATALOG_IN_USE). */
  async remove(
    type: CatalogItemType,
    jwt: JwtPayload,
    id: string,
  ): Promise<void> {
    const itemId = new Types.ObjectId(id);
    await withTransaction(this.connection, async (session) => {
      const item = await this.itemModel
        .findOne({ _id: itemId, type, deletedAt: null })
        .session(session)
        .lean()
        .exec();
      if (!item) throw this.notFound();

      if (item.isSystem) {
        throw new BusinessException(
          ErrorCode.CATALOG_SYSTEM,
          'Không thể xóa mục hệ thống, hãy tắt hoạt động nếu không dùng',
          HttpStatus.CONFLICT,
        );
      }
      const usageCount = await this.countUsage(type, itemId);
      if (usageCount > 0) {
        throw new BusinessException(
          ErrorCode.CATALOG_IN_USE,
          'Mục đang được sử dụng, hãy tắt hoạt động thay vì xóa',
          HttpStatus.CONFLICT,
          { usageCount },
        );
      }

      await this.itemModel
        .updateOne(
          { _id: itemId },
          { $set: { deletedAt: new Date() } },
          { session },
        )
        .exec();
      await this.audit.record(
        {
          entityType: CrmAuditEntityType.CATALOG,
          entitySubtype: type,
          entityId: itemId,
          action: CrmAuditAction.CATALOG_DELETED,
          actor: jwt,
          changes: [{ field: 'code', from: item.code, to: null }],
        },
        session,
      );
    });
  }

  private countUsage(
    type: CatalogItemType,
    itemId: Types.ObjectId,
  ): Promise<number> {
    return type === CatalogItemType.LEAD_SOURCE
      ? this.usage.countCustomersBySource(itemId)
      : this.usage.countCareLogsByContactResult(itemId);
  }

  /** Đọc giá trị theo đường dẫn "a.b" (chỉ dùng cho `meta.*`). */
  private readPath(source: object, path: string): unknown {
    return path
      .split('.')
      .reduce<unknown>(
        (current, key) => (current as Record<string, unknown> | null)?.[key],
        source,
      );
  }

  private async nextOrder(
    type: CatalogItemType,
    session: ClientSession,
  ): Promise<number> {
    const last = await this.itemModel
      .findOne({ type })
      .sort({ order: -1 })
      .select('order')
      .session(session)
      .lean()
      .exec();
    return (last?.order ?? 0) + 1;
  }

  private notFound(): NotFoundException {
    return new NotFoundException('Không tìm thấy mục danh mục');
  }
}
