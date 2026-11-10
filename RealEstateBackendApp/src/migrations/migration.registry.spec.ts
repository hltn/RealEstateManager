import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  MIGRATIONS,
  parseMigrationNumber,
  validateMigrationRegistry,
} from './migration.registry';
import { getMigrationPhase } from './migration-phase';
import type { Migration } from './migration.types';

const make = (id: string): Migration => ({
  id,
  description: `mô tả ${id}`,
  up: () => Promise.resolve(),
});

describe('migration registry', () => {
  describe('registry thật (MIGRATIONS)', () => {
    it('hợp lệ: không trùng, không hở số, bắt đầu từ 007', () => {
      expect(validateMigrationRegistry(MIGRATIONS)).toEqual([]);
    });

    it('FR-21: liền số 007..011, đúng thứ tự id', () => {
      expect(MIGRATIONS.map((m) => m.id)).toEqual([
        '007_crm_catalog_codes',
        '008_crm_project_property_type_codes',
        '009_notification_attachment_indexes',
        '010_crm_customer_code_index',
        '011_crm_drop_unique_phone',
      ]);
    });

    it('không chứa migration cũ 002..006 (đã chạy tay, chỉ ghi sổ bằng baseline)', () => {
      const numbers = MIGRATIONS.map((m) => parseMigrationNumber(m.id));
      expect(numbers.every((n) => n !== null && n >= 7)).toBe(true);
    });

    it('khớp với các file trong thư mục versions/ (mỗi file NNN_ten.ts phải có trong registry và ngược lại)', () => {
      const dir = join(__dirname, 'versions');
      const files = existsSync(dir)
        ? readdirSync(dir)
            .filter((f) => /^\d{3}_.+\.ts$/.test(f) && !f.endsWith('.spec.ts'))
            .map((f) => f.replace(/\.ts$/, ''))
            .sort()
        : [];
      expect(files).toEqual(MIGRATIONS.map((m) => m.id).sort());
    });
  });

  describe('thuộc tính phase (FR-21)', () => {
    it('FR-21: phase của migration thật chỉ là pre-up/post-up hoặc bỏ trống', () => {
      for (const migration of MIGRATIONS) {
        expect([undefined, 'pre-up', 'post-up']).toContain(migration.phase);
      }
    });

    it('FR-21: 007..009 giữ mặc định pre-up (không đổi hành vi cũ)', () => {
      const legacy = MIGRATIONS.filter((migration) =>
        ['007', '008', '009'].includes(migration.id.slice(0, 3)),
      );
      expect(legacy).toHaveLength(3);
      for (const migration of legacy) {
        expect(getMigrationPhase(migration)).toBe('pre-up');
      }
    });

    it('FR-21: 011 là post-up; 010 không khai báo phase (mặc định pre-up)', () => {
      const byId = (prefix: string) =>
        MIGRATIONS.find((migration) => migration.id.startsWith(prefix));
      expect(getMigrationPhase(byId('010')!)).toBe('pre-up');
      expect(byId('011')?.phase).toBe('post-up');
      expect(byId('011')?.description).toContain('MỘT CHIỀU');
    });

    it('FR-21: validateMigrationRegistry không bị ảnh hưởng bởi phase', () => {
      expect(
        validateMigrationRegistry([
          make('007_a'),
          { ...make('008_b'), phase: 'post-up' },
        ]),
      ).toEqual([]);
    });
  });

  describe('validateMigrationRegistry', () => {
    it('chấp nhận dãy liên tiếp từ 007', () => {
      expect(
        validateMigrationRegistry([
          make('007_a'),
          make('008_b'),
          make('009_c'),
        ]),
      ).toEqual([]);
    });

    it('chấp nhận registry rỗng', () => {
      expect(validateMigrationRegistry([])).toEqual([]);
    });

    it('phát hiện trùng số thứ tự (khác tên)', () => {
      const errors = validateMigrationRegistry([make('007_a'), make('007_b')]);
      expect(errors.join(' ')).toContain('trùng');
    });

    it('phát hiện trùng id', () => {
      const errors = validateMigrationRegistry([make('007_a'), make('007_a')]);
      expect(errors.join(' ')).toContain('trùng');
    });

    it('phát hiện hở số', () => {
      const errors = validateMigrationRegistry([make('007_a'), make('009_c')]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('liên tiếp');
    });

    it('phát hiện sai thứ tự (không tăng dần)', () => {
      expect(
        validateMigrationRegistry([make('008_b'), make('007_a')]).length,
      ).toBeGreaterThan(0);
    });

    it('từ chối migration < 007 (không đưa 002..006 vào registry)', () => {
      const errors = validateMigrationRegistry([make('006_areas')]);
      expect(errors.join(' ')).toContain('007 trở đi');
    });

    it('từ chối id sai định dạng', () => {
      expect(validateMigrationRegistry([make('7_a')])).toHaveLength(1);
      expect(validateMigrationRegistry([make('007_A')])).toHaveLength(1);
      expect(validateMigrationRegistry([make('007')])).toHaveLength(1);
    });

    it('bắt đầu không phải 007 (008 đầu tiên) là hở số', () => {
      expect(validateMigrationRegistry([make('008_a')])).toHaveLength(1);
    });
  });
});
