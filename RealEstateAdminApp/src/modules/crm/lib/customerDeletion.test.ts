import { describe, expect, it } from 'vitest';
import type { ApiError } from '@crm/api';
import { canAccessView } from '../navigation';
import {
  canOfferBulkDelete,
  clampPage,
  describeBulkDeleteError,
  describeDeleteBatchError,
  describePurgeError,
  describeRestoreError,
  getPageAfterRemoval,
  hasVisibleChar,
  isPurgeAlreadyDone,
  validateDeleteReason,
} from './customerDeletion';

const customer = (listGroup: 'DROPPED' | 'INTERESTED', primaryUserId: string | null = null) =>
  ({ status: { listGroup }, primaryAssignee: primaryUserId ? { id: primaryUserId, displayName: 'P' } : null }) as Parameters<typeof canOfferBulkDelete>[1][number];

const error = (statusCode: number, errorCode: string, message = 'x'): ApiError => ({ statusCode, errorCode, message });

describe('canOfferBulkDelete - khi nào hiện option "Xóa"', () => {
  const admin = { role: 'ADMIN' as const, userId: 'a', managedTeamIds: [] };
  const manager = { role: 'MANAGER' as const, userId: 'm', managedTeamIds: ['t1'] };
  const staff = { role: 'STAFF' as const, userId: 's', managedTeamIds: [] };

  it('chỉ khi MỌI khách chọn thuộc "Bỏ": lẫn một khách chưa Bỏ, chưa có dữ liệu hoặc chưa chọn ai thì ẩn', () => {
    expect(canOfferBulkDelete(admin, [customer('DROPPED'), customer('DROPPED')])).toBe(true);
    expect(canOfferBulkDelete(admin, [customer('DROPPED'), customer('INTERESTED')])).toBe(false);
    expect(canOfferBulkDelete(admin, [customer('DROPPED'), undefined])).toBe(false);
    expect(canOfferBulkDelete(admin, [])).toBe(false);
  });

  it('Nhân viên: chỉ khi là phụ trách chính của TỪNG khách', () => {
    expect(canOfferBulkDelete(staff, [customer('DROPPED', 's'), customer('DROPPED', 's')])).toBe(true);
    expect(canOfferBulkDelete(staff, [customer('DROPPED', 's'), customer('DROPPED', 'khac')])).toBe(false);
    expect(canOfferBulkDelete(staff, [customer('DROPPED', null)])).toBe(false);
  });

  it('Quản lý: hiện (backend kiểm nhóm từng khách) nhưng ẩn khi không quản lý nhóm nào', () => {
    expect(canOfferBulkDelete(manager, [customer('DROPPED', 'khac')])).toBe(true);
    expect(canOfferBulkDelete({ ...manager, managedTeamIds: [] }, [customer('DROPPED', 'm')])).toBe(false);
  });
});

describe('hasVisibleChar / validateDeleteReason - cùng quy tắc với backend', () => {
  it('chữ, số, dấu câu, ký hiệu/emoji tính là nhìn thấy; khoảng trắng, zero-width, dấu kết hợp đơn lẻ và ký tự trống giả dạng thì không', () => {
    for (const text of ['a', 'Đ', '7', '.', '😀', '  x  ']) expect(hasVisibleChar(text), text).toBe(true);
    // ZWSP, ZWNJ, ZWJ, word joiner, BOM, Hangul filler, Hangul half-width filler, Braille blank, combining grapheme joiner, NBSP, tab.
    for (const text of ['', '   ', '​', '‌‍', '⁠', '﻿', 'ᅟ', 'ᅠ', 'ㅤ', 'ﾠ', '⠀', '͏', ' ', '\t\n']) {
      expect(hasVisibleChar(text), JSON.stringify(text)).toBe(false);
    }
  });

  it('rỗng -> yêu cầu nhập; chỉ có ký tự vô hình -> cần chữ nhìn thấy được; tối đa 500 ký tự', () => {
    expect(validateDeleteReason('')).toMatch(/nhập lý do/);
    expect(validateDeleteReason('   ')).toMatch(/nhập lý do/);
    expect(validateDeleteReason('​ㅤ')).toBe('Lý do cần có ít nhất một chữ hoặc ký tự nhìn thấy được.');
    expect(validateDeleteReason('Khách trùng')).toBeNull();
    expect(validateDeleteReason('a'.repeat(500))).toBeNull();
    expect(validateDeleteReason('a'.repeat(501))).toMatch(/500/);
  });
});

describe('thông báo lỗi tiếng Việt', () => {
  it('xóa hàng loạt: từng mã lỗi có lý do riêng, mã lạ vẫn có câu chung kèm mã', () => {
    expect(describeBulkDeleteError('CUSTOMER_NOT_DROPPED')).toMatch(/chưa thuộc danh sách Bỏ/);
    expect(describeBulkDeleteError('INSUFFICIENT_ROLE')).toMatch(/không có quyền xóa/);
    expect(describeBulkDeleteError('CUSTOMER_NOT_FOUND')).toMatch(/phạm vi/);
    expect(describeBulkDeleteError('INTERNAL_ERROR')).toMatch(/lỗi hệ thống/);
    expect(describeBulkDeleteError('LẠ')).toContain('LẠ');
  });

  it('400 về lý do của backend được dịch dễ hiểu; lỗi 400 khác giữ nguyên', () => {
    expect(describeDeleteBatchError(error(400, 'VALIDATION_FAILED', 'payload.reason phải có ít nhất một ký tự nhìn thấy được'))).toBe('Lý do cần có ít nhất một chữ hoặc ký tự nhìn thấy được.');
    expect(describeDeleteBatchError(error(400, 'VALIDATION_FAILED', 'Quá 200 khách'))).toBe('Quá 200 khách');
  });

  it('xóa vĩnh viễn: 503 nói rõ CHƯA xóa gì và thử lại được; 404 coi là đã xong; 409/403 có lời riêng', () => {
    expect(describePurgeError(error(503, 'SERVICE_UNAVAILABLE'))).toMatch(/CHƯA xóa gì/);
    expect(isPurgeAlreadyDone(error(404, 'CUSTOMER_NOT_FOUND'))).toBe(true);
    expect(isPurgeAlreadyDone(error(503, 'SERVICE_UNAVAILABLE'))).toBe(false);
    expect(describePurgeError(error(409, 'CUSTOMER_NOT_DELETED'))).toMatch(/chưa ở trạng thái đã xóa/);
    expect(describePurgeError(error(403, 'INSUFFICIENT_ROLE'))).toMatch(/Chỉ Quản trị/);
    expect(describePurgeError(error(409, 'CUSTOMER_PURGE_IN_PROGRESS'))).toMatch(/thử lại sau ít giây/);
  });

  it('khôi phục: khách ẩn danh hóa và khách đang xóa dở đều được giải thích', () => {
    expect(describeRestoreError(error(409, 'CUSTOMER_ANONYMIZED'))).toMatch(/ẩn danh/);
    expect(describeRestoreError(error(409, 'CUSTOMER_PURGE_IN_PROGRESS'))).toMatch(/xóa vĩnh viễn dở dang/);
  });
});

describe('trang sau khi danh sách ngắn lại', () => {
  it('getPageAfterRemoval: gỡ khách duy nhất của trang (không phải trang 1) thì lùi một trang', () => {
    expect(getPageAfterRemoval(3, 1)).toBe(2);
    expect(getPageAfterRemoval(3, 10)).toBe(3);
    expect(getPageAfterRemoval(1, 1)).toBe(1);
  });

  it('clampPage: kẹp về trang cuối còn dữ liệu, tối thiểu 1 (hết khách thì về trang 1)', () => {
    expect(clampPage(5, 3)).toBe(3);
    expect(clampPage(2, 3)).toBe(2);
    expect(clampPage(4, 0)).toBe(1);
  });
});

describe('màn Khách đã xóa chỉ cho Quản trị', () => {
  it('canAccessView deleted_customers', () => {
    expect(canAccessView('deleted_customers', 'ADMIN')).toBe(true);
    expect(canAccessView('deleted_customers', 'MANAGER')).toBe(false);
    expect(canAccessView('deleted_customers', 'STAFF')).toBe(false);
  });
});
