import { describe, expect, it } from 'vitest';
import { CRITERIA_KEYS } from '@crm/lib/customerRules';
import {
  CRITERIA_ITEMS,
  fromDateTimeLocalValue,
  getHiddenImageCount,
  getShortCaption,
  getSuggestedFollowUpIso,
  hasText,
  isCareLogDraftDirty,
  selectUpcomingAppointments,
  toDateTimeLocalValue,
} from './customerDetailUtils';

describe('customerDetailUtils', () => {
  it('mỗi tiêu chí trên giao diện ứng với đúng 1 khoá tiêu chí của lớp quy tắc, đủ 4 và không trùng (C4)', () => {
    expect(CRITERIA_ITEMS.map((item) => item.key)).toEqual([...CRITERIA_KEYS]);
    expect(new Set(CRITERIA_ITEMS.map((item) => item.label)).size).toBe(4);
  });

  it('getShortCaption lấy N từ đầu', () => {
    expect(getShortCaption('  Sa bàn thực tế dự án ')).toBe('Sa bàn');
    expect(getShortCaption('Một', 3)).toBe('Một');
  });

  it('getHiddenImageCount không âm', () => {
    expect(getHiddenImageCount(5, 3)).toBe(2);
    expect(getHiddenImageCount(2, 3)).toBe(0);
  });

  it('hasText: chỉ true khi có chữ thật (null/undefined/rỗng/toàn khoảng trắng đều là không có)', () => {
    expect(hasText('  ')).toBe(false);
    expect(hasText('')).toBe(false);
    expect(hasText(null)).toBe(false);
    expect(hasText(undefined)).toBe(false);
    expect(hasText('Hà Nội')).toBe(true);
  });

  it('mốc hẹn gợi ý = hôm nay (giờ VN) + N ngày lúc 09:00; N null -> không gợi ý', () => {
    // 23:30 ngày 21/10 UTC = 06:30 ngày 22/10 giờ VN -> "hôm nay" là 22/10.
    const now = new Date('2026-10-21T23:30:00.000Z');
    expect(getSuggestedFollowUpIso(2, now)).toBe('2026-10-24T02:00:00.000Z');
    expect(getSuggestedFollowUpIso(null, now)).toBe('');
  });

  it('chuyển đổi datetime-local theo giờ VN 2 chiều', () => {
    expect(toDateTimeLocalValue('2026-10-24T02:00:00.000Z')).toBe('2026-10-24T09:00');
    expect(fromDateTimeLocalValue('2026-10-24T09:00')).toBe('2026-10-24T02:00:00.000Z');
    expect(fromDateTimeLocalValue('')).toBe('');
  });

  it('selectUpcomingAppointments: chỉ lịch đang chờ, chưa quá dung sai 5 phút của backend, gần nhất trước', () => {
    const now = new Date('2026-10-26T03:00:00.000Z');
    const items = [
      { id: 'late', status: 'SCHEDULED', startAt: '2026-10-28T02:00:00.000Z' },
      { id: 'past', status: 'SCHEDULED', startAt: '2026-10-26T02:00:00.000Z' },
      { id: 'justOver', status: 'SCHEDULED', startAt: '2026-10-26T02:54:59.000Z' },
      { id: 'edge', status: 'SCHEDULED', startAt: '2026-10-26T02:55:00.000Z' },
      { id: 'justCreated', status: 'SCHEDULED', startAt: '2026-10-26T02:58:00.000Z' },
      { id: 'done', status: 'DONE', startAt: '2026-10-27T02:00:00.000Z' },
      { id: 'soon', status: 'SCHEDULED', startAt: '2026-10-26T04:00:00.000Z' },
    ];
    expect(selectUpcomingAppointments(items, now).map((item) => item.id)).toEqual(['edge', 'justCreated', 'soon', 'late']);
  });

  describe('isCareLogDraftDirty: còn thay đổi chưa lưu ở form ghi chú?', () => {
    const empty = { content: '', contactChannel: 'CALL', contactResultId: '', nextSuggestion: '', nextDueLocal: '', hasPhotoChanges: false };
    const original = { content: 'Đã gọi', contactChannel: 'ZALO', contactResultId: 'r1' };

    it('thêm mới: form mới mở (kênh mặc định, chưa nhập gì) và chỉ có khoảng trắng đều KHÔNG phải bản nháp', () => {
      expect(isCareLogDraftDirty(empty)).toBe(false);
      expect(isCareLogDraftDirty({ ...empty, content: '   ' })).toBe(false);
      expect(isCareLogDraftDirty({ ...empty, contactChannel: 'ZALO' })).toBe(false);
    });

    it('thêm mới: có nội dung, kết quả liên hệ, việc tiếp theo, thời điểm nhắc hoặc ảnh thì là bản nháp', () => {
      expect(isCareLogDraftDirty({ ...empty, content: 'a' })).toBe(true);
      expect(isCareLogDraftDirty({ ...empty, contactResultId: 'r1' })).toBe(true);
      expect(isCareLogDraftDirty({ ...empty, nextSuggestion: 'Gọi lại' })).toBe(true);
      expect(isCareLogDraftDirty({ ...empty, nextDueLocal: '2026-10-24T09:00' })).toBe(true);
      expect(isCareLogDraftDirty({ ...empty, hasPhotoChanges: true })).toBe(true);
    });

    it('sửa: giống nhật ký gốc thì KHÔNG dirty (kể cả nội dung gốc rỗng/khác khoảng trắng so sánh đúng từng ký tự)', () => {
      expect(isCareLogDraftDirty({ ...empty, ...original }, original)).toBe(false);
    });

    it('sửa: đổi nội dung, kênh, kết quả (kể cả bỏ kết quả) hoặc đổi ảnh thì dirty', () => {
      const same = { ...empty, ...original };
      expect(isCareLogDraftDirty({ ...same, content: 'Đã gọi.' }, original)).toBe(true);
      expect(isCareLogDraftDirty({ ...same, contactChannel: 'CALL' }, original)).toBe(true);
      expect(isCareLogDraftDirty({ ...same, contactResultId: '' }, original)).toBe(true);
      expect(isCareLogDraftDirty({ ...same, hasPhotoChanges: true }, original)).toBe(true);
    });

    it('sửa: ô "việc tiếp theo" không áp dụng (form sửa không có) nên không làm dirty', () => {
      expect(isCareLogDraftDirty({ ...empty, ...original, nextSuggestion: 'x' }, original)).toBe(false);
    });
  });
});
