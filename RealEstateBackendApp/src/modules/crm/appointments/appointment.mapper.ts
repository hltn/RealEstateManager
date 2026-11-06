import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { CrmActor } from '../common/access/crm-actor';
import { toPhoneMasked } from '../customers/customer.mapper';
import { CatalogRefDto } from '../../../common/dto/ref.dto';
import { StatusRefDto } from '../customers/dtos/customer-response.dto';
import type { CatalogRef, RefMaps } from '../customers/customer-refs.service';
import { toUserRef } from '../customers/customer-refs.service';
import { AppointmentResponseDto } from './dtos/appointment.dto';
import { Appointment } from './schemas/appointment.schema';

export type AppointmentLean = Appointment & { _id: Types.ObjectId };

/** Phần thông tin khách nhúng trong lịch hẹn. */
export interface AppointmentCustomerLean {
  _id: Types.ObjectId;
  fullName: string;
  statusId: Types.ObjectId;
  /** SĐT E.164 chỉ để che (`phoneMasked`), KHÔNG bao giờ trả nguyên ra API. */
  phone?: string;
  anonymizedAt?: Date | null;
}

const emptyStatus = (id: Types.ObjectId): StatusRefDto => ({
  id: String(id),
  code: '',
  label: '',
  listGroup: undefined as never,
  color: null,
});

/** Quản trị, Quản lý (trong phạm vi) xóa được mọi lịch; Nhân viên chỉ xóa lịch do mình tạo (ma trận 04 mục 4.2, "TG"). */
export const canDeleteAppointment = (
  actor: CrmActor,
  appointment: Pick<Appointment, 'createdBy'>,
): boolean =>
  actor.role === UserRole.ADMIN ||
  actor.role === UserRole.MANAGER ||
  appointment.createdBy.equals(actor.userId);

/**
 * `{ id, code, label }` của dự án (FR-40). `code` lấy từ mã đã ghi kép trên bản ghi (`storedCode`); bản ghi cũ chưa
 * có thì dịch từ id qua `projects`. Dự án đã bị xóa cứng (không còn trong `projects`): `label` rỗng, `code` có thể rỗng.
 */
export const toProjectRef = (
  projectId: Types.ObjectId | null | undefined,
  storedCode: string | null | undefined,
  projects: ReadonlyMap<string, CatalogRef>,
): CatalogRefDto | null => {
  if (!projectId) return null;
  const ref = projects.get(String(projectId));
  return {
    id: String(projectId),
    code: storedCode || ref?.code || '',
    label: ref?.label ?? '',
  };
};

export const toAppointmentResponse = (
  row: AppointmentLean,
  customer: AppointmentCustomerLean,
  maps: RefMaps,
  actor: CrmActor,
  projects: ReadonlyMap<string, CatalogRef>,
): AppointmentResponseDto => ({
  id: String(row._id),
  customer: {
    id: String(customer._id),
    fullName: customer.fullName,
    phoneMasked: toPhoneMasked(customer),
    status:
      maps.statuses.get(String(customer.statusId)) ??
      emptyStatus(customer.statusId),
  },
  type: row.type,
  title: row.title,
  startAt: row.startAt.toISOString(),
  endAt: row.endAt ? row.endAt.toISOString() : null,
  location: row.location,
  note: row.note,
  assignee: toUserRef(row.assigneeId, maps.users)!,
  project: toProjectRef(row.projectId, row.projectCode, projects),
  remindBeforeMinutes: row.remindBeforeMinutes,
  status: row.status,
  completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  outcome: row.outcome ?? null,
  createdBy: toUserRef(row.createdBy, maps.users)!,
  version: row.__v,
  canDelete: canDeleteAppointment(actor, row),
});
