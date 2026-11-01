import { normalizeVietnamese } from '../common/utils/vietnamese-text.util';
import {
  provinceSeedKey,
  SEED_PROJECTS,
  SEED_PROVINCES,
} from './crm-seed.data';

describe('seed khu vực: 34 tỉnh/thành', () => {
  it('đủ 34 mục, không trùng tên (kể cả khi bỏ dấu) và khóa seed duy nhất', () => {
    expect(SEED_PROVINCES).toHaveLength(34);
    expect(new Set(SEED_PROVINCES.map(normalizeVietnamese)).size).toBe(34);
    expect(new Set(SEED_PROVINCES.map(provinceSeedKey)).size).toBe(34);
  });

  it('không còn tỉnh/đơn vị cũ hoặc mục ngoài danh sách 34', () => {
    expect(SEED_PROVINCES).not.toContain('Bình Dương');
    expect(SEED_PROVINCES).not.toContain('Nước ngoài');
  });

  it('khóa seed giữ nguyên dạng cũ (AREA:<tên không dấu>) để bản ghi đã seed trước đó không bị tạo trùng', () => {
    expect(provinceSeedKey('TP. Hồ Chí Minh')).toBe('AREA:tp. ho chi minh');
    expect(provinceSeedKey('Hà Nội')).toBe('AREA:ha noi');
  });

  it('mọi dự án mẫu có khu vực đều trỏ vào một tỉnh trong 34', () => {
    for (const project of SEED_PROJECTS) {
      if (project.areaName === null) continue;
      expect([project.code, SEED_PROVINCES.includes(project.areaName)]).toEqual(
        [project.code, true],
      );
    }
  });
});
