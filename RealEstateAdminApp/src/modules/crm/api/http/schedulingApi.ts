/**
 * Gọi API lịch hẹn, việc hôm nay, thông báo trong app (05 §2.9, §2.10).
 */
import type { AppointmentListQuery, AppointmentView, CareLogView, CreateAppointmentInput, DailyTask, DailyTaskScope, Paginated } from '../types';
import type { AppointmentDto, DailyTaskDto, NotificationDto } from './dto';
import { crmHttp } from './crmHttp';
import { toAppointment, toCareLog, toDailyTask } from './customerMappers';

const MAX_PAGES = 5;

/**
 * Lịch hẹn trong khoảng ngày VN "YYYY-MM-DD" (backend nhận trực tiếp). Mặc định bỏ lịch ĐÃ HỦY (người dùng đã chủ động hủy:
 * không còn hiện trên lịch, KPI, danh sách); truyền `status: 'CANCELED'` để xem riêng.
 */
export const fetchAppointments = async (query: AppointmentListQuery, signal?: AbortSignal): Promise<AppointmentView[]> => {
  const items: AppointmentView[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await crmHttp.list<AppointmentDto>('/crm/appointments', {
      params: { from: query.from, to: query.to, customerId: query.customerId, projectId: query.projectId, status: query.status, assigneeIds: query.assigneeIds, types: query.types, page, limit: 100 },
      signal,
    });
    items.push(...result.data.map(toAppointment));
    if (page >= result.meta.totalPages) break;
  }
  return query.status === 'CANCELED' ? items : items.filter((appointment) => appointment.status !== 'CANCELED');
};

export const postAppointment = async (input: CreateAppointmentInput): Promise<AppointmentView> => {
  const { customerId, type, startAt, endAt, title, location, note, assigneeId, remindBeforeMinutes, projectId } = input;
  const body = {
    customerId,
    type,
    startAt,
    ...(endAt ? { endAt } : {}),
    ...(title?.trim() ? { title: title.trim() } : {}),
    ...(location?.trim() ? { location: location.trim() } : {}),
    ...(note?.trim() ? { note: note.trim() } : {}),
    ...(assigneeId ? { assigneeId } : {}),
    ...(remindBeforeMinutes ? { remindBeforeMinutes } : {}),
    // null = không gắn dự án (gửi tường minh); bỏ trống thì không gửi.
    ...(projectId !== undefined ? { projectId } : {}),
  };
  return toAppointment(await crmHttp.post<AppointmentDto>('/crm/appointments', body, { isIdempotent: true }));
};

/** `PATCH /crm/appointments/:id` — dời giờ lịch đang chờ (gửi `version` để chống ghi đè; 409 nếu lịch đã đổi). */
export const patchAppointment = async (appointmentId: string, body: { version?: number; startAt?: string; endAt?: string | null }): Promise<AppointmentView> =>
  toAppointment(await crmHttp.patch<AppointmentDto>(`/crm/appointments/${encodeURIComponent(appointmentId)}`, body));

export const patchAppointmentStatus = async (
  appointmentId: string,
  body: { status: 'DONE' | 'CANCELED' | 'SCHEDULED'; version?: number; outcome?: string; createCareLog?: boolean },
  primaryUserId: string | null = null,
): Promise<{ appointment: AppointmentView; careLog: CareLogView | null }> => {
  const dto = await crmHttp.patch<AppointmentDto>(`/crm/appointments/${encodeURIComponent(appointmentId)}/status`, body);
  return { appointment: toAppointment(dto), careLog: dto.careLog ? toCareLog(dto.careLog, primaryUserId) : null };
};

export const deleteAppointment = (appointmentId: string): Promise<void> => crmHttp.del(`/crm/appointments/${encodeURIComponent(appointmentId)}`);

export interface DailyTaskParams {
  scope?: DailyTaskScope;
  group?: 'OVERDUE' | 'TODAY' | 'UPCOMING';
}

/** Gom các trang (tối đa 100/trang) để Kanban/danh sách có đủ việc; scope=team chỉ Quản trị/Quản lý. */
export const fetchDailyTasks = async (params: DailyTaskParams, signal?: AbortSignal): Promise<DailyTask[]> => {
  const items: DailyTask[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result: Paginated<DailyTaskDto> = await crmHttp.list<DailyTaskDto>('/crm/daily-tasks', { params: { scope: params.scope, group: params.group, page, limit: 100 }, signal });
    items.push(...result.data.map(toDailyTask));
    if (page >= result.meta.totalPages) break;
  }
  return items;
};

export const fetchDailyTaskSummary = (scope: DailyTaskScope | undefined, signal?: AbortSignal): Promise<{ overdue: number; today: number; upcoming: number }> =>
  crmHttp.get('/crm/daily-tasks/summary', { params: { scope }, signal });

// --- Thông báo ----------------------------------------------------------------------------------------------------------

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  customerId?: string;
  appointmentId?: string;
  deepLink: string;
  priority: string;
  isRead: boolean;
  createdAt: string;
}

export const toNotification = (dto: NotificationDto): NotificationItem => ({
  id: dto.id,
  type: dto.type,
  title: dto.title,
  body: dto.body,
  customerId: dto.data?.customerId,
  appointmentId: dto.data?.appointmentId,
  deepLink: dto.data?.deepLink ?? '',
  priority: dto.priority,
  isRead: dto.readAt !== null,
  createdAt: dto.createdAt,
});

export const fetchNotifications = async (query: { isRead?: boolean; page?: number; limit?: number }, signal?: AbortSignal): Promise<Paginated<NotificationItem>> => {
  const result = await crmHttp.list<NotificationDto>('/notifications', { params: query, signal });
  return { data: result.data.map(toNotification), meta: result.meta };
};

export const fetchUnreadCount = async (signal?: AbortSignal): Promise<number> => (await crmHttp.get<{ count: number }>('/notifications/unread-count', { signal })).count;

export const patchNotificationRead = (id: string, isRead: boolean): Promise<NotificationDto> => crmHttp.patch(`/notifications/${encodeURIComponent(id)}`, { isRead });

export const patchAllNotificationsRead = (): Promise<{ updated: number }> => crmHttp.patch('/notifications', { isRead: true });
