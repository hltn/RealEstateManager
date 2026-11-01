import { describe, expect, it } from 'vitest';
import { buildSeedData } from './mockData';
import { SEED_CATALOGS, SEED_USERS } from './seedCatalogs';

describe('TB5 dữ liệu mẫu không phụ thuộc ảnh ngoài (Stitch/googleusercontent)', () => {
  it('seed khách, nhật ký, người dùng, danh mục không chứa URL ảnh bên ngoài', () => {
    const json = JSON.stringify({ seed: buildSeedData(new Date('2026-10-22T03:00:00.000Z')), SEED_USERS, SEED_CATALOGS });
    expect(json).not.toContain('googleusercontent');
    expect(json).not.toMatch(/https?:\/\/[^"]+\.(png|jpe?g|webp|gif)/i);
  });
});
