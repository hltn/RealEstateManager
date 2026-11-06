import { NotificationType } from '../notification.constants';

/**
 * Danh mục loại thông báo push (FR-43, Plan 2.1.1; Architecture 5.2).
 *
 * Danh sách ĐÓNG đúng 4 loại. Thêm loại = thêm một dòng vào `PUSH_CATALOG`, không sửa bộ gửi.
 * Không có mẫu gộp (`groupedBodyTemplate`): Q5 mặc định là giới hạn 3 push/người/đợt, không thêm mẫu.
 * Chỉ chứa cấu hình thuần: việc điền mẫu, cắt độ dài, quét PII thuộc `push-content.renderer.ts` (FR-06).
 */

/** Tên biến mẫu cho phép (đúng danh sách Plan; không biến nào khác, FR-06). */
export const PUSH_ALLOWED_VARS = [
  'customerName',
  'actorName',
  'appointmentTypeLabel',
  'appointmentTimeLabel',
  'newStatusLabel',
] as const;
export type PushVarName = (typeof PUSH_ALLOWED_VARS)[number];

/**
 * Lưới an toàn kỹ thuật (Q12): CHỈ thay nội dung của push vốn thuộc 1 trong 4 loại khi quét PII chặn
 * hoặc payload sai định dạng. KHÔNG phải mẫu thứ năm, không thuộc `PUSH_CATALOG`, không có công tắc.
 */
export const PUSH_FALLBACK_TITLE = 'Bạn có thông báo mới';
export const PUSH_FALLBACK_BODY = 'Bạn có thông báo mới';

export type PushUrgency = 'normal' | 'high';

/** Vai trò của người nhận trong nhóm chăm sóc (do nơi gọi suy ra từ `change.careTeam`). */
export type PushCareRole = 'PRIMARY' | 'MEMBER';
/** Nguồn gây ra thông báo `CUSTOMER_ASSIGNED` (Architecture 5.2, ánh xạ nguồn). */
export type PushOrigin =
  | 'CUSTOMER_CREATED'
  | 'TEAM_ADD'
  | 'REQUEST_APPROVED'
  | 'BULK_ADD';

/** Dữ liệu để `pushWhen` quyết có gửi push hay không. */
export interface PushContext {
  careRole?: PushCareRole;
  origin?: PushOrigin;
  groupKey?: string;
}

export interface PushCatalogEntry {
  readonly type: NotificationType;
  readonly label: string;
  readonly description: string;
  /** Mẫu dùng `{tenBien}`; chỉ biến trong `allowedVars`. */
  readonly titleTemplate: string;
  readonly bodyTemplate: string;
  readonly allowedVars: readonly PushVarName[];
  /** Đường dẫn nội bộ bắt đầu bằng `/`; `:id` là id đối tượng (ObjectId). */
  readonly deepLinkTemplate: string;
  readonly defaultEnabled: boolean;
  readonly canDisable: boolean;
  readonly urgency: PushUrgency;
  readonly ttlSeconds: number;
  /** Có gửi push cho tình huống này không (loại khác luôn `true`). */
  pushWhen(context: PushContext): boolean;
}

const HOUR_SECONDS = 60 * 60;
const DEEP_LINK_CUSTOMER = '/crm/customers/:id';

const always = (): boolean => true;

export const PUSH_CATALOG: readonly PushCatalogEntry[] = Object.freeze([
  {
    type: NotificationType.CUSTOMER_ASSIGNED,
    label: 'Được mời cùng phụ trách một khách',
    description:
      'Khi bạn được thêm vào nhóm chăm sóc của một khách với vai trò người cùng phụ trách.',
    titleTemplate: 'Bạn được mời cùng phụ trách một khách',
    bodyTemplate:
      '{actorName} đã thêm bạn vào nhóm chăm sóc khách {customerName}.',
    allowedVars: ['actorName', 'customerName'],
    deepLinkTemplate: DEEP_LINK_CUSTOMER,
    defaultEnabled: true,
    canDisable: true,
    urgency: 'normal',
    ttlSeconds: 24 * HOUR_SECONDS,
    // Chỉ người cùng phụ trách (thêm đơn, duyệt đề nghị, thêm hàng loạt); không push khi làm phụ trách chính hoặc tạo khách.
    pushWhen: (context) =>
      context.careRole === 'MEMBER' && context.origin !== 'CUSTOMER_CREATED',
  },
  {
    type: NotificationType.CARE_LOG_ADDED,
    label: 'Nhật ký chăm sóc mới',
    description: 'Khi người cùng chăm sóc ghi nhật ký mới cho khách của bạn.',
    titleTemplate: 'Có nhật ký chăm sóc mới',
    bodyTemplate: '{actorName} vừa ghi nhật ký cho khách {customerName}.',
    allowedVars: ['actorName', 'customerName'],
    deepLinkTemplate: DEEP_LINK_CUSTOMER,
    defaultEnabled: true,
    canDisable: true,
    urgency: 'normal',
    ttlSeconds: 24 * HOUR_SECONDS,
    pushWhen: always,
  },
  {
    type: NotificationType.APPOINTMENT_DUE,
    label: 'Nhắc lịch hẹn',
    description: 'Khi sắp đến giờ hẹn của một lịch hẹn của bạn.',
    titleTemplate: 'Sắp đến lịch hẹn',
    bodyTemplate:
      '{appointmentTypeLabel} với khách {customerName} lúc {appointmentTimeLabel}.',
    allowedVars: [
      'appointmentTypeLabel',
      'customerName',
      'appointmentTimeLabel',
    ],
    deepLinkTemplate: DEEP_LINK_CUSTOMER,
    defaultEnabled: true,
    canDisable: true,
    urgency: 'high',
    ttlSeconds: HOUR_SECONDS,
    pushWhen: always,
  },
  {
    type: NotificationType.CUSTOMER_STATUS_AUTO_CHANGED,
    label: 'Tự đổi tình trạng theo tiến độ',
    description:
      'Khi tình trạng của khách trong nhóm chăm sóc của bạn tự thay đổi theo tiến độ tiêu chí.',
    titleTemplate: 'Tình trạng khách tự thay đổi',
    bodyTemplate:
      'Khách {customerName} đã chuyển sang "{newStatusLabel}" theo tiến độ.',
    allowedVars: ['customerName', 'newStatusLabel'],
    deepLinkTemplate: DEEP_LINK_CUSTOMER,
    defaultEnabled: true,
    canDisable: true,
    urgency: 'normal',
    ttlSeconds: 24 * HOUR_SECONDS,
    pushWhen: always,
  },
]);

const CATALOG_BY_TYPE: ReadonlyMap<string, PushCatalogEntry> = new Map(
  PUSH_CATALOG.map((entry) => [entry.type as string, entry]),
);

/** Dòng danh mục của một loại; `undefined` nếu loại ngoài danh sách đóng (không có push). */
export function getPushCatalogEntry(
  type: string,
): PushCatalogEntry | undefined {
  return CATALOG_BY_TYPE.get(type);
}

/** Loại có trong danh mục và đúng tình huống thì mới gửi push; loại ngoài danh mục luôn `false`. */
export function shouldSendPush(
  type: string,
  context: PushContext = {},
): boolean {
  const entry = getPushCatalogEntry(type);
  return entry !== undefined && entry.pushWhen(context);
}
