import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import {
  endOfDayUtc,
  startOfDayUtc,
} from '../../../common/utils/timezone.util';
import {
  APPOINTMENT_MAX_DURATION_MS,
  APPOINTMENT_PAST_TOLERANCE_MS,
  APPOINTMENT_RANGE_MAX_DAYS,
  AppointmentStatus,
} from './appointment.constants';

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const invalidField = (
  message: string,
  field: string,
): BusinessException =>
  new BusinessException(
    ErrorCode.VALIDATION_FAILED,
    message,
    HttpStatus.BAD_REQUEST,
    { field },
  );

/**
 * Không hẹn vào quá khứ: `startAt` không được sớm hơn "bây giờ" quá 5 phút (dung sai lệch đồng hồ).
 * Áp dụng khi tạo và khi dời giờ hẹn (đổi `startAt`); không áp dụng cho sửa ghi chú/địa điểm của lịch đã qua giờ.
 */
export const assertStartNotInPast = (startAt: Date, now: Date): void => {
  if (startAt.getTime() < now.getTime() - APPOINTMENT_PAST_TOLERANCE_MS) {
    throw invalidField('Giờ hẹn không được ở quá khứ', 'startAt');
  }
};

/** `endAt` (nếu có) phải sau `startAt` và cách tối đa 24 giờ. */
export const assertEndAfterStart = (
  startAt: Date,
  endAt: Date | null | undefined,
): void => {
  if (!endAt) return;
  const duration = endAt.getTime() - startAt.getTime();
  if (duration <= 0) {
    throw invalidField('Giờ kết thúc phải sau giờ bắt đầu', 'endAt');
  }
  if (duration > APPOINTMENT_MAX_DURATION_MS) {
    throw invalidField('Lịch hẹn không được kéo dài quá 24 giờ', 'endAt');
  }
};

/** Mốc nhắc: bỏ trùng, sắp giảm dần (nhắc xa trước, gần sau). Không truyền thì dùng mặc định theo cài đặt. */
export const normalizeRemindOffsets = (
  requested: readonly number[] | undefined,
  defaults: readonly number[],
): number[] =>
  [...new Set(requested ?? defaults)].sort((first, second) => second - first);

export interface PlannedReminder {
  offsetMinutes: number;
  fireAt: Date;
}

/**
 * Các mốc nhắc thật sự còn có ý nghĩa: `fireAt = startAt - offset` phải còn ở tương lai (mốc đã qua thì bỏ, không
 * nhắc bù); ngoại lệ: lịch còn ở tương lai mà mọi mốc đã qua thì giữ MỘT nhắc ngay (mốc gần nhất). Hàm thuần.
 */
export const planAppointmentReminders = (
  startAt: Date,
  offsets: readonly number[],
  now: Date,
): PlannedReminder[] => {
  const all = offsets.map((offsetMinutes) => ({
    offsetMinutes,
    fireAt: new Date(startAt.getTime() - offsetMinutes * MS_PER_MINUTE),
  }));
  const upcoming = all.filter(
    (reminder) => reminder.fireAt.getTime() > now.getTime(),
  );
  if (upcoming.length > 0 || startAt.getTime() <= now.getTime())
    return upcoming;
  // Lịch hẹn gần hơn mọi mốc nhắc nhưng chưa diễn ra: vẫn nhắc MỘT lần, ngay lập tức, theo mốc gần nhất (offset nhỏ
  // nhất). Khóa chống trùng chỉ gồm offset + startAt nên ổn định khi đồng bộ lại.
  if (all.length === 0) return [];
  const nearest = all.reduce((a, b) =>
    b.offsetMinutes < a.offsetMinutes ? b : a,
  );
  return [{ offsetMinutes: nearest.offsetMinutes, fireAt: now }];
};

/**
 * Chuyển trạng thái hợp lệ: SCHEDULED -> DONE | CANCELED; DONE | CANCELED -> SCHEDULED (mở lại). Chuyển thẳng
 * DONE <-> CANCELED không hợp lệ (phải mở lại trước). Cùng trạng thái do service coi là không làm gì.
 */
export const canTransitionStatus = (
  from: AppointmentStatus,
  to: AppointmentStatus,
): boolean =>
  from === AppointmentStatus.SCHEDULED
    ? to === AppointmentStatus.DONE || to === AppointmentStatus.CANCELED
    : to === AppointmentStatus.SCHEDULED;

/**
 * Đọc ranh giới của bộ lọc khoảng thời gian: `YYYY-MM-DD` là NGÀY GIỜ VIỆT NAM (đầu ngày cho `from`, cuối ngày cho
 * `to`), chuỗi ISO 8601 đầy đủ là một thời điểm tuyệt đối.
 */
export const parseRangeBoundary = (
  value: string,
  edge: 'from' | 'to',
): Date => {
  if (!DATE_ONLY_PATTERN.test(value)) return new Date(value);
  return edge === 'from' ? startOfDayUtc(value) : endOfDayUtc(value);
};

/** Khoảng xem lịch: `to` không trước `from` và dài tối đa 62 ngày. */
export const assertRangeValid = (from: Date, to: Date): void => {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw invalidField('Khoảng thời gian không hợp lệ', 'from');
  }
  if (to.getTime() < from.getTime()) {
    throw invalidField('to không được trước from', 'to');
  }
  if (to.getTime() - from.getTime() > APPOINTMENT_RANGE_MAX_DAYS * MS_PER_DAY) {
    throw invalidField(
      `Khoảng thời gian tối đa ${APPOINTMENT_RANGE_MAX_DAYS} ngày`,
      'to',
    );
  }
};
