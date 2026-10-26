/**
 * Helper dựng dữ liệu cho spec bằng REST API thật của stack E2E (token ký sẵn ở globalSetup), không bấm UI để dựng.
 * Mọi hàm chỉ chạy được khi stack cô lập đang sống (cổng 3100). Tên/SĐT có hậu tố ngẫu nhiên để spec độc lập nhau.
 */
import crypto from 'node:crypto';
import { URLS, type RoleKey } from '../env';
import type { SeedState } from './seed';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Hậu tố ngẫu nhiên ngắn, chữ + số (an toàn cho tên, mã dự án). */
export const uid = (): string => crypto.randomBytes(3).toString('hex').toUpperCase();

let phoneCounter = 0;
/** SĐT di động VN hợp lệ (09 + 8 số), không trùng trong cùng tiến trình và rất khó trùng giữa các spec. */
export const vnPhone = (): string => {
  phoneCounter += 1;
  const tail = String(crypto.randomInt(0, 9_999_000) + phoneCounter).padStart(7, '0').slice(-7);
  return `093${tail}`;
};

/** Hiển thị SĐT dạng `0931 234 567` như giao diện. */
export const formatPhone = (phone: string): string => `${phone.slice(0, 4)} ${phone.slice(4, 7)} ${phone.slice(7)}`;

export class Api {
  constructor(private readonly seed: SeedState) {}

  private token(role: RoleKey): string {
    return this.seed.users[role].accessToken;
  }

  async call(role: RoleKey, method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<{ status: number; data: Json }> {
    const res = await fetch(`${URLS.api}${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token(role)}`, ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as Json) : {};
    return { status: res.status, data: (json.data ?? json) as Json };
  }

  private async ok(role: RoleKey, method: string, path: string, body?: unknown): Promise<Json> {
    const r = await this.call(role, method, path, body);
    if (r.status >= 300) throw new Error(`[E2E api] ${method} ${path} -> ${r.status}: ${JSON.stringify(r.data).slice(0, 400)}`);
    return r.data;
  }

  /** Dự án RIÊNG của spec (hoạt động). Admin tạo. */
  async createProject(label = 'Dự án'): Promise<{ id: string; name: string; code: string }> {
    const s = uid();
    const name = `${label} ${s}`;
    const code = `E2E-${s}`;
    const p = await this.ok('admin', 'POST', '/crm/projects', { name, code, status: 'SELLING', propertyTypes: ['Căn hộ'] });
    return { id: String(p.id ?? p._id), name, code };
  }

  async setProjectActive(projectId: string, isActive: boolean): Promise<void> {
    await this.ok('admin', 'PATCH', `/crm/projects/${projectId}`, { isActive });
  }

  /** Khách mồi do `role` tạo (mặc định staff1): vào nhóm chăm sóc của người tạo. */
  async createCustomer(opts: { role?: RoleKey; label?: string; projectIds?: string[]; phone?: string } = {}): Promise<{ id: string; fullName: string; phone: string }> {
    const fullName = `${opts.label ?? 'Khách-Mẫu'}-${uid()}`;
    const phone = opts.phone ?? vnPhone();
    const c = await this.ok(opts.role ?? 'staff1', 'POST', '/crm/customers', { fullName, phone, interestedProjectIds: opts.projectIds ?? [] });
    return { id: String(c.id ?? c._id), fullName, phone };
  }

  /** Lịch hẹn tạo bằng API: truyền `slot` (xem `todaySlot`/`tomorrowSlot`) hoặc `startAtIso`; KHÔNG gắn cứng ngày giờ. */
  async createAppointment(opts: ({ slot: VnSlot } | { startAtIso: string }) & { role?: RoleKey; customerId: string; remindBeforeMinutes?: number[]; type?: string; location?: string; projectId?: string | null; title?: string }): Promise<Json> {
    return this.ok(opts.role ?? 'staff1', 'POST', '/crm/appointments', {
      customerId: opts.customerId,
      type: opts.type ?? 'SITE_VISIT',
      startAt: 'slot' in opts ? opts.slot.iso : opts.startAtIso,
      ...(opts.remindBeforeMinutes ? { remindBeforeMinutes: opts.remindBeforeMinutes } : {}),
      location: opts.location ?? 'Văn phòng bán hàng',
      ...(opts.title ? { title: opts.title } : {}),
      ...(opts.projectId !== undefined ? { projectId: opts.projectId } : {}),
    });
  }

  async createCareLog(opts: { role?: RoleKey; customerId: string; content: string; channel?: string; nextAction?: Json }): Promise<Json> {
    return this.ok(opts.role ?? 'staff1', 'POST', `/crm/customers/${opts.customerId}/care-logs`, {
      content: opts.content,
      contactChannel: opts.channel ?? 'CALL',
      ...(opts.nextAction ? { nextAction: opts.nextAction } : {}),
    });
  }
}

/** Ngày hôm nay (hoặc lệch `offsetDays` ngày) theo giờ Việt Nam, dạng YYYY-MM-DD. `now` chỉ để kiểm thử hàm bằng đồng hồ giả. */
export const vnToday = (offsetDays = 0, now: Date = new Date()): string => {
  const d = new Date(now.getTime() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(d);
};

// ---------------------------------------------------------------------------------------------------------------------
// Giờ hẹn tính từ "bây giờ" theo múi giờ Việt Nam: spec KHÔNG được gắn cứng giờ (vd "23:55") vì sẽ hỏng khi chạy gần nửa đêm.
// ---------------------------------------------------------------------------------------------------------------------

/** Một mốc hẹn theo giờ VN: ngày `YYYY-MM-DD`, giờ `HH:mm` (đúng như ô nhập của form) và `iso` UTC tương ứng. */
export interface VnSlot {
  date: string;
  time: string;
  iso: string;
}

const MS_PER_MINUTE = 60_000;
/** Mốc "hôm nay" cách bây giờ chừng này phút (luôn ở tương lai, không dựa vào dung sai quá khứ 5 phút của form/backend). */
export const TODAY_SLOT_LEAD_MINUTES = 5;
/** Còn ít hơn khoảng này tới nửa đêm thì chờ qua nửa đêm rồi mới lấy mốc "hôm nay" (test dài vài chục giây không bị cắt ngang ngày). */
export const MIDNIGHT_GUARD_MINUTES = 8;

/** Mốc từ ngày + giờ VN. */
export const vnSlot = (date: string, time: string): VnSlot => ({ date, time, iso: new Date(`${date}T${time}:00+07:00`).toISOString() });

/** Mốc giờ VN của một thời điểm tuyệt đối (làm tròn xuống phút). */
export const vnSlotAt = (instant: Date): VnSlot => {
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant);
  return vnSlot(vnToday(0, instant), time);
};

/** NGÀY MAI lúc `time` (mặc định 09:00) giờ VN: dùng cho mọi chỗ không cần "hôm nay"; không bao giờ ở quá khứ dù chạy lúc nào. */
export const tomorrowSlot = (now: Date = new Date(), time = '09:00'): VnSlot => vnSlot(vnToday(1, now), time);

/**
 * Mốc "HÔM NAY" = bây giờ + 5 phút (dùng khi test cần thấy lịch ở Việc hôm nay / màn Lịch hẹn mặc định).
 * Nếu từ bây giờ tới nửa đêm còn dưới 8 phút thì phải CHỜ qua nửa đêm: `waitMs` là thời gian chờ,
 * `slot` đã tính cho thời điểm sau khi chờ (ngày mới, 00:05).
 */
export const planTodaySlot = (now: Date = new Date()): { slot: VnSlot; waitMs: number } => {
  const crossesMidnight = vnToday(0, new Date(now.getTime() + MIDNIGHT_GUARD_MINUTES * MS_PER_MINUTE)) !== vnToday(0, now);
  if (!crossesMidnight) return { slot: vnSlotAt(new Date(now.getTime() + TODAY_SLOT_LEAD_MINUTES * MS_PER_MINUTE)), waitMs: 0 };
  const afterMidnight = Date.parse(`${vnToday(1, now)}T00:00:02+07:00`);
  return { slot: vnSlotAt(new Date(afterMidnight + TODAY_SLOT_LEAD_MINUTES * MS_PER_MINUTE)), waitMs: afterMidnight - now.getTime() };
};
