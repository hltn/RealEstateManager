import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { PaginationMetaDto } from '../../../common/dto/paginated-response.dto';
import {
  buildPaginationMeta,
  normalizePagination,
} from '../../../common/utils/pagination.util';
import { withTransaction } from '../../../shared/database/with-transaction.util';
import { ContactChannel } from '../care-logs/care-log.constants';
import { CareLogsService } from '../care-logs/care-logs.service';
import { CareLogResponseDto } from '../care-logs/dtos/care-log.dto';
import { CrmActor } from '../common/access/crm-actor';
import { parseSort } from '../common/utils/sort-parser.util';
import { CustomerAccessService } from '../customers/access/customer-access.service';
import { resolveClientSource } from '../customers/customer.errors';
import {
  CatalogRef,
  CustomerRefsService,
} from '../customers/customer-refs.service';
import { CustomersRepository } from '../customers/customers.repository';
import {
  APPOINTMENT_TYPE_LABELS,
  AppointmentStatus,
  AppointmentType,
} from './appointment.constants';
import {
  AppointmentCustomerLean,
  AppointmentLean,
  canDeleteAppointment,
  toAppointmentResponse,
} from './appointment.mapper';
import {
  assertProjectInputConsistent,
  assertRangeValid,
  invalidField,
  parseRangeBoundary,
} from './appointment.rules';
import { AppointmentsWriteService } from './appointments-write.service';
import { customerScopeStages } from './customer-scope-stages.util';
import {
  AppointmentResponseDto,
  AppointmentWithCareLogResponseDto,
  ChangeAppointmentStatusDto,
  CreateAppointmentDto,
  ListAppointmentsQueryDto,
  UpdateAppointmentDto,
} from './dtos/appointment.dto';
import { Appointment, AppointmentDocument } from './schemas/appointment.schema';

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

const SORTABLE_FIELDS = ['startAt'] as const;

/** Lịch của dự án theo `projectCode`, hoặc lịch chưa backfill `projectCode` nhưng có `projectId` tương ứng. */
const projectCodeCondition = (
  code: string,
  projectId?: Types.ObjectId,
): Record<string, unknown> =>
  projectId
    ? { $or: [{ projectCode: code }, { projectCode: null, projectId }] }
    : { projectCode: code };

/** Kênh liên hệ của nhật ký tự sinh khi hoàn thành lịch hẹn. */
const CHANNEL_BY_TYPE: Record<AppointmentType, ContactChannel> = {
  [AppointmentType.SITE_VISIT]: ContactChannel.SITE_VISIT,
  [AppointmentType.MEETING]: ContactChannel.MEETING,
  [AppointmentType.DEPOSIT_CONTRACT]: ContactChannel.MEETING,
  [AppointmentType.CALLBACK]: ContactChannel.CALL,
  [AppointmentType.OTHER]: ContactChannel.OTHER,
};

type AppointmentRow = AppointmentLean & {
  customer: Array<AppointmentCustomerLean>;
};

/**
 * Lịch hẹn (`/crm/appointments`, tài liệu 05 mục 2.9). Phạm vi theo KHÁCH của người gọi: Nhân viên thấy lịch của mọi
 * khách mình có trong nhóm chăm sóc, Quản lý theo nhóm mình quản lý (hoặc nhóm chăm sóc có mình), Quản trị tất cả;
 * người bị gỡ khỏi khách thì không còn thấy lịch của khách đó. Mọi thao tác ghi chạy trong MỘT transaction
 * (lịch + khách + nhắc việc + audit) — xem `AppointmentsWriteService`.
 */
@Injectable()
export class AppointmentsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<AppointmentDocument>,
    private readonly access: CustomerAccessService,
    private readonly repo: CustomersRepository,
    private readonly refs: CustomerRefsService,
    private readonly writer: AppointmentsWriteService,
    private readonly careLogs: CareLogsService,
  ) {}

  async list(
    jwt: JwtPayload,
    query: ListAppointmentsQueryDto,
  ): Promise<{ data: AppointmentResponseDto[]; meta: PaginationMetaDto }> {
    const ctx = await this.access.resolve(jwt);
    const from = parseRangeBoundary(query.from, 'from');
    const to = parseRangeBoundary(query.to, 'to');
    assertRangeValid(from, to);
    const sort = parseSort(query.sort, SORTABLE_FIELDS, {
      field: 'startAt',
      direction: 1,
    });
    const { page, limit, skip } = normalizePagination(query.page, query.limit);
    const projectFilter = await this.projectFilter(query);

    const match: Record<string, unknown> = {
      deletedAt: null,
      startAt: { $gte: from, $lte: to },
      ...(query.customerId && { customerId: oid(query.customerId) }),
      ...projectFilter,
      ...(query.assigneeIds?.length && {
        assigneeId: { $in: query.assigneeIds.map(oid) },
      }),
      ...(query.types?.length && { type: { $in: query.types } }),
      ...(query.status && { status: query.status }),
    };
    const [result] = await this.appointmentModel
      .aggregate<{ rows: AppointmentRow[]; total: Array<{ count: number }> }>([
        { $match: match },
        ...customerScopeStages(this.repo, ctx, {
          fullName: 1,
          statusId: 1,
          phone: 1,
          anonymizedAt: 1,
        }),
        { $sort: { startAt: sort.direction, _id: sort.direction } },
        {
          $facet: {
            rows: [{ $skip: skip }, { $limit: limit }],
            total: [{ $count: 'count' }],
          },
        },
      ])
      .exec();
    const total = result.total[0]?.count ?? 0;
    return {
      data: await this.toResponses(result.rows, ctx.actor),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async get(jwt: JwtPayload, id: string): Promise<AppointmentResponseDto> {
    const ctx = await this.access.resolve(jwt);
    const { appointment, customer } = await this.writer.loadInScope(ctx, id);
    return this.toResponse(appointment, customer, ctx.actor);
  }

  async create(
    jwt: JwtPayload,
    dto: CreateAppointmentDto,
    clientType?: string,
  ): Promise<AppointmentResponseDto> {
    assertProjectInputConsistent(dto.projectId, dto.projectCode);
    const ctx = await this.access.resolve(jwt);
    const { auditSource } = resolveClientSource(clientType);
    const { appointment, customer } = await withTransaction(
      this.connection,
      (session) =>
        this.writer.createInSession(
          ctx,
          {
            customerId: oid(dto.customerId),
            type: dto.type,
            startAt: new Date(dto.startAt),
            endAt: dto.endAt ? new Date(dto.endAt) : null,
            title: dto.title,
            location: dto.location,
            note: dto.note,
            assigneeId: dto.assigneeId ? oid(dto.assigneeId) : undefined,
            remindBeforeMinutes: dto.remindBeforeMinutes,
            projectId: dto.projectId ? oid(dto.projectId) : null,
            projectCode: dto.projectCode ?? null,
          },
          auditSource,
          session,
        ),
    );
    return this.toResponse(appointment, customer, ctx.actor);
  }

  async update(
    jwt: JwtPayload,
    id: string,
    dto: UpdateAppointmentDto,
    clientType?: string,
  ): Promise<AppointmentResponseDto> {
    const ctx = await this.access.resolve(jwt);
    const { auditSource } = resolveClientSource(clientType);
    const { appointment, customer } = await withTransaction(
      this.connection,
      (session) =>
        this.writer.updateInSession(ctx, id, dto, auditSource, session),
    );
    return this.toResponse(appointment, customer, ctx.actor);
  }

  /** Hoàn thành / hủy / mở lại; `createCareLog` (chỉ khi sang DONE) ghi luôn nhật ký kết quả trong cùng transaction. */
  async changeStatus(
    jwt: JwtPayload,
    id: string,
    dto: ChangeAppointmentStatusDto,
    clientType?: string,
  ): Promise<AppointmentWithCareLogResponseDto> {
    if (dto.createCareLog && dto.status !== AppointmentStatus.DONE) {
      throw invalidField(
        'createCareLog chỉ dùng khi hoàn thành lịch hẹn (status = DONE)',
        'createCareLog',
      );
    }
    const ctx = await this.access.resolve(jwt);
    const { auditSource } = resolveClientSource(clientType);

    const { appointment, customer, careLog } = await withTransaction(
      this.connection,
      async (session) => {
        const result = await this.writer.changeStatusInSession(
          ctx,
          id,
          dto,
          auditSource,
          session,
        );
        const log =
          result.changed && dto.createCareLog
            ? await this.careLogs.createInSession(
                ctx,
                String(result.appointment.customerId),
                {
                  content: this.outcomeContent(result.appointment, dto.outcome),
                  contactChannel: CHANNEL_BY_TYPE[result.appointment.type],
                },
                auditSource,
                session,
              )
            : null;
        return { ...result, careLog: log };
      },
    );
    const response = await this.toResponse(appointment, customer, ctx.actor);
    const careLogResponse: CareLogResponseDto | undefined = careLog
      ? await this.careLogs.toResponse(careLog, ctx)
      : undefined;
    return {
      ...response,
      ...(careLogResponse && { careLog: careLogResponse }),
    };
  }

  async remove(
    jwt: JwtPayload,
    id: string,
    clientType?: string,
  ): Promise<void> {
    const ctx = await this.access.resolve(jwt);
    const { auditSource } = resolveClientSource(clientType);
    await withTransaction(this.connection, (session) =>
      this.writer.deleteInSession(
        ctx,
        id,
        null,
        auditSource,
        session,
        (appointment) => canDeleteAppointment(ctx.actor, appointment),
      ),
    );
  }

  // --------------------------------------------------------------------------------------------

  /**
   * Điều kiện lọc theo dự án (FR-40). `projectCode` (mới, không phân biệt hoa thường) lọc theo mã bất biến đã ghi kép,
   * dùng index `{ projectCode, startAt }`, KÈM nhánh `projectId` của dự án đó cho lịch chưa backfill `projectCode`
   * (Architecture Q3). Dịch mã sang id bằng MỘT lượt `resolveByCodes` (không N+1); dự án đã xóa cứng (không còn id)
   * thì chỉ còn nhánh mã. Chỉ `projectId` (cũ, deprecated) giữ nguyên lọc theo id để PWA cũ không đổi kết quả.
   * Gửi cả hai mà khác dự án: 400 `VALIDATION_FAILED`.
   */
  private async projectFilter(
    query: ListAppointmentsQueryDto,
  ): Promise<Record<string, unknown>> {
    const { projectId, projectCode } = query;
    if (!projectCode) return projectId ? { projectId: oid(projectId) } : {};
    const code = projectCode.trim().toUpperCase();
    if (projectId) {
      const [ref] = await this.refs.resolveByIds('project', [oid(projectId)]);
      if (ref?.code !== code) {
        throw invalidField(
          'projectId và projectCode không cùng một dự án',
          'projectCode',
        );
      }
      return projectCodeCondition(code, ref.id);
    }
    const [ref] = await this.refs.resolveByCodes('project', [code]);
    return projectCodeCondition(code, ref?.id);
  }

  private outcomeContent(
    appointment: AppointmentLean,
    outcome: string | undefined,
  ): string {
    if (outcome) return outcome;
    const label =
      appointment.title || APPOINTMENT_TYPE_LABELS[appointment.type];
    return `Đã hoàn thành lịch hẹn: ${label}`;
  }

  private async toResponse(
    appointment: AppointmentLean,
    customer: AppointmentCustomerLean,
    actor: CrmActor,
  ): Promise<AppointmentResponseDto> {
    const [response] = await this.toResponses(
      [{ ...appointment, customer: [customer] }],
      actor,
    );
    return response;
  }

  /** Dựng response theo lô: nhãn tình trạng/tên người một lần `$in` mỗi loại (không N+1). */
  private async toResponses(
    rows: AppointmentRow[],
    actor: CrmActor,
  ): Promise<AppointmentResponseDto[]> {
    const [maps, projectRefs] = await Promise.all([
      this.refs.resolve({
        statusIds: rows.map((row) => row.customer[0].statusId),
        userIds: rows.flatMap((row) => [row.assigneeId, row.createdBy]),
      }),
      this.refs.resolveByIds(
        'project',
        rows.map((row) => row.projectId),
      ),
    ]);
    const projects = new Map<string, CatalogRef>(
      projectRefs.map((ref) => [String(ref.id), ref]),
    );
    return rows.map((row) =>
      toAppointmentResponse(row, row.customer[0], maps, actor, projects),
    );
  }
}
