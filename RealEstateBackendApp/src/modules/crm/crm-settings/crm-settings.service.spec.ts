import { DEFAULT_CRM_SETTINGS } from './dtos/crm-settings.dto';
import { mergeWithDefaults } from './crm-settings.service';

describe('mergeWithDefaults (cấu hình CRM singleton)', () => {
  it('chưa có bản ghi thì trả đúng mặc định của tài liệu 04 mục 3.7', () => {
    expect(mergeWithDefaults(null)).toEqual(DEFAULT_CRM_SETTINGS);
  });

  it('field đã lưu ghi đè mặc định, field còn lại giữ mặc định (thêm field cấu hình mới không cần migration)', () => {
    const merged = mergeWithDefaults({
      staleCustomerDays: 30,
      occasionLeadDays: [0, 3],
    });
    expect(merged.staleCustomerDays).toBe(30);
    expect(merged.occasionLeadDays).toEqual([0, 3]);
    expect(merged.phoneViewAlertPerHour).toBe(200);
  });

  it('không trả chung tham chiếu mảng mặc định (sửa kết quả không làm hỏng hằng số)', () => {
    const merged = mergeWithDefaults(null);
    merged.occasionLeadDays.push(99);
    expect(mergeWithDefaults(null).occasionLeadDays).toEqual([0, 1]);
  });
});
