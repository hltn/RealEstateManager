import { describe, expect, it } from 'vitest';
import { createTestHarness, createTestState } from '@crm/test/fixtures';
import { countCatalogUsage, validateCatalogItem, validateSettings, validateUser } from './catalogAdmin';

describe('validateCatalogItem', () => {
  const { catalogs } = createTestState('admin');

  it('bắt tên rỗng và trùng tên (không phân biệt dấu/hoa thường)', () => {
    const source = catalogs.leadSources[0];
    expect(validateCatalogItem(catalogs, 'leadSources', { ...source, id: 'src-new', label: '  ' })).toBe('Vui lòng nhập tên.');
    const otherLabel = catalogs.leadSources[1].label;
    expect(validateCatalogItem(catalogs, 'leadSources', { ...source, label: otherLabel.toUpperCase() })).toContain('Đã có mục');
    // Sửa chính nó (cùng id) không tính là trùng.
    expect(validateCatalogItem(catalogs, 'leadSources', source)).toBeNull();
  });

  it('không cho ẩn tình trạng mặc định hoặc tình trạng cuối cùng của 1 danh sách', () => {
    const defaultStatus = catalogs.statuses.find((status) => status.isDefault)!;
    expect(validateCatalogItem(catalogs, 'statuses', { ...defaultStatus, isActive: false })).toContain('mặc định');
    const dropped = catalogs.statuses.find((status) => status.listGroup === 'DROPPED')!;
    expect(validateCatalogItem(catalogs, 'statuses', { ...dropped, isActive: false })).toContain('ít nhất 1');
    const interested = catalogs.statuses.find((status) => status.id === 'st-interested')!;
    expect(validateCatalogItem(catalogs, 'statuses', { ...interested, isActive: false })).toBeNull();
  });

  it('mã dự án không trùng', () => {
    const [first, second] = catalogs.projects;
    expect(validateCatalogItem(catalogs, 'projects', { ...second, code: first.code.toLowerCase() })).toContain('đã tồn tại');
  });
});

describe('validateUser / validateSettings', () => {
  const state = createTestState('admin');
  const admin = state.users.find((user) => user.id === 'admin')!;
  const hanh = state.users.find((user) => user.id === 'hanh')!;
  const vy = state.users.find((user) => user.id === 'vy')!;

  it('chặn tự khoá / tự hạ quyền', () => {
    expect(validateUser(state, { ...admin, isActive: false }, 'admin')).toContain('tự khoá');
    expect(validateUser(state, { ...admin, role: 'MANAGER', teamId: 'team-1' }, 'admin')).toContain('hạ quyền');
  });

  it('nhân viên phải có nhóm; không khoá người đang phụ trách chính', () => {
    expect(validateUser(state, { ...vy, teamId: null }, 'admin')).toContain('thuộc một nhóm');
    expect(validateUser(state, { ...hanh, isActive: false }, 'admin')).toContain('phụ trách chính 5 khách');
    expect(validateUser(state, { ...vy, isActive: false }, 'admin')).toBeNull();
  });

  it('giới hạn cài đặt', () => {
    expect(validateSettings({ occasionLeadDays: 0 })).toBeNull();
    expect(validateSettings({ occasionLeadDays: -1 })).toContain('từ 0 đến 60');
    expect(validateSettings({ staleCustomerDays: 1.5 })).toContain('số nguyên');
  });
});

describe('mock API quản trị', () => {
  it('nhân viên không sửa được danh mục; Quản trị ẩn nguồn đang dùng vẫn giữ dữ liệu khách', () => {
    const harness = createTestHarness('thao');
    const source = harness.getState().catalogs.leadSources[0];
    expect(harness.api.upsertCatalogItem('leadSources', { ...source, isActive: false })).toMatchObject({ ok: false, error: { statusCode: 403 } });
    harness.switchUser('admin');
    const usage = countCatalogUsage(harness.getState(), 'leadSources', source.id);
    expect(harness.api.upsertCatalogItem('leadSources', { ...source, isActive: false }).ok).toBe(true);
    expect(harness.getState().catalogs.leadSources.find((item) => item.id === source.id)?.isActive).toBe(false);
    expect(countCatalogUsage(harness.getState(), 'leadSources', source.id)).toBe(usage);
  });

  it('đổi vai trò người dùng đồng bộ quản lý nhóm (phạm vi QT6)', () => {
    const harness = createTestHarness('admin');
    const thao = harness.getState().users.find((user) => user.id === 'thao')!;
    expect(harness.api.upsertUser({ ...thao, role: 'MANAGER' }).ok).toBe(true);
    expect(harness.getState().teams.find((team) => team.id === thao.teamId)?.managerIds).toContain('thao');
    expect(harness.api.upsertUser({ ...thao, role: 'STAFF' }).ok).toBe(true);
    expect(harness.getState().teams.find((team) => team.id === thao.teamId)?.managerIds).not.toContain('thao');
  });

  it('đặt tình trạng mặc định mới gỡ cờ ở tình trạng cũ; mặc định phải thuộc Đang chăm sóc', () => {
    const harness = createTestHarness('admin');
    const interested = harness.getState().catalogs.statuses.find((status) => status.id === 'st-interested')!;
    const net = harness.getState().catalogs.statuses.find((status) => status.id === 'st-net')!;
    expect(harness.api.upsertCatalogItem('statuses', { ...net, isDefault: true }).ok).toBe(false);
    expect(harness.api.upsertCatalogItem('statuses', { ...interested, isDefault: true }).ok).toBe(true);
    expect(harness.getState().catalogs.statuses.filter((status) => status.isDefault).map((status) => status.id)).toEqual(['st-interested']);
  });

  it('cài đặt sai giới hạn bị từ chối, đúng thì lưu', () => {
    const harness = createTestHarness('admin');
    expect(harness.api.updateSettings({ upcomingDays: 0 }).ok).toBe(false);
    expect(harness.api.updateSettings({ occasionLeadDays: 5 }).ok).toBe(true);
    expect(harness.getState().settings.occasionLeadDays).toBe(5);
  });
});
