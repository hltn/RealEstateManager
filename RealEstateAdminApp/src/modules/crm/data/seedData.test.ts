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

describe('v1.0.5 dữ liệu mẫu cho định danh khách', () => {
  const customers = buildSeedData(new Date('2026-10-22T03:00:00.000Z')).customers;

  it('có khách chưa có SĐT (phone null) và mọi khách đều có customerCode KH-###### duy nhất', () => {
    expect(customers.some((customer) => customer.phone === null)).toBe(true);
    const codes = customers.map((customer) => customer.customerCode);
    expect(codes.every((code) => /^KH-\d{6}$/.test(code ?? ''))).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('có ít nhất 2 khách trùng SĐT nhau (SĐT không còn là khóa duy nhất)', () => {
    const phones = customers.map((customer) => customer.phone).filter((phone): phone is string => phone !== null);
    const duplicated = phones.filter((phone, index) => phones.indexOf(phone) !== index);
    expect(duplicated.length).toBeGreaterThan(0);
  });
});
