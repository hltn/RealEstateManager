/** Thêm / Sửa / Xoá mềm / Khôi phục dự án + audit log ở lớp dữ liệu: chỉ Quản trị, validate, xoá an toàn khi còn khách tham chiếu. */
import { describe, expect, it } from 'vitest';
import { createTestHarness } from '@crm/test/fixtures';
import type { ProjectInput } from './mockCrmApi';

const NEW_PROJECT: ProjectInput = {
  name: 'Sky Park',
  code: 'skypark',
  fullName: '',
  developer: 'ABC Land',
  location: 'Quận 7, TP.HCM',
  areaId: 'area-q7',
  propertyTypes: ['Căn hộ'],
  priceFrom: 3_500_000_000,
  priceTo: 6_000_000_000,
  priceUnit: 'TOTAL',
  status: 'UPCOMING',
  segment: '',
};

const errorCode = (result: { ok: boolean; error?: { errorCode: string } }) => (result.ok ? undefined : result.error?.errorCode);
const statusOf = (result: { ok: boolean; error?: { statusCode: number } }) => (result.ok ? 200 : result.error?.statusCode);
const isUsed = (harness: ReturnType<typeof createTestHarness>, projectId: string) =>
  harness.getState().customers.filter((customer) => customer.interestedProjectIds.includes(projectId)).length;
const auditActions = (harness: ReturnType<typeof createTestHarness>) => harness.getState().auditLogs.map((log) => log.action);

describe('createProject', () => {
  it('Quản trị thêm được: chuẩn hoá mã viết hoa, tên đầy đủ mặc định, đang hoạt động, chưa xoá; ghi PROJECT_CREATED', () => {
    const harness = createTestHarness('admin');
    const result = harness.api.createProject(NEW_PROJECT);
    expect(result.ok && result.data).toMatchObject({ name: 'Sky Park', code: 'SKYPARK', fullName: 'Sky Park', developer: 'ABC Land', propertyTypes: ['Căn hộ'], status: 'UPCOMING', priceFrom: 3_500_000_000, isActive: true, deletedAt: null });
    expect(harness.getState().catalogs.projects.some((project) => project.code === 'SKYPARK')).toBe(true);
    expect(harness.getState().auditLogs[0]).toMatchObject({ action: 'PROJECT_CREATED', entityType: 'PROJECT', actorId: 'admin', actorRole: 'ADMIN' });
  });

  it.each(['hanh', 'thao'])('%s (không phải Quản trị) bị từ chối 403, không thêm gì, không ghi audit', (userId) => {
    const harness = createTestHarness(userId);
    const before = harness.getState().catalogs.projects.length;
    expect(harness.api.createProject(NEW_PROJECT)).toMatchObject({ ok: false, error: { statusCode: 403 } });
    expect(harness.getState().catalogs.projects).toHaveLength(before);
    expect(harness.getState().auditLogs).toHaveLength(0);
  });

  it('thiếu tên/mã, trùng tên, giá from > to -> 400 VALIDATION_FAILED; trùng mã -> 409 PROJECT_CODE_DUPLICATED (không phân biệt hoa thường)', () => {
    const harness = createTestHarness('admin');
    const [first] = harness.getState().catalogs.projects;
    expect(errorCode(harness.api.createProject({ ...NEW_PROJECT, name: '  ' }))).toBe('VALIDATION_FAILED');
    expect(errorCode(harness.api.createProject({ ...NEW_PROJECT, code: '' }))).toBe('VALIDATION_FAILED');
    expect(errorCode(harness.api.createProject({ ...NEW_PROJECT, name: first.name }))).toBe('VALIDATION_FAILED');
    const duplicated = harness.api.createProject({ ...NEW_PROJECT, code: first.code.toLowerCase() });
    expect(duplicated).toMatchObject({ ok: false, error: { statusCode: 409, errorCode: 'PROJECT_CODE_DUPLICATED' } });
    // Lỗi nhập báo trước lỗi trùng mã.
    expect(errorCode(harness.api.createProject({ ...NEW_PROJECT, name: '', code: first.code }))).toBe('VALIDATION_FAILED');
    expect(errorCode(harness.api.createProject({ ...NEW_PROJECT, priceFrom: 9_000_000_000, priceTo: 1_000_000_000 }))).toBe('VALIDATION_FAILED');
    expect(harness.getState().auditLogs).toHaveLength(0);
  });

  it('khu vực không tồn tại bị từ chối', () => {
    const harness = createTestHarness('admin');
    expect(errorCode(harness.api.createProject({ ...NEW_PROJECT, areaId: 'area-ghost' }))).toBe('INVALID_CATALOG_REF');
  });

  it('id do client gửi KHÔNG ghi đè dự án có sẵn: luôn sinh id mới, dự án cũ giữ nguyên', () => {
    const harness = createTestHarness('admin');
    const target = harness.getState().catalogs.projects[0];
    const before = structuredClone(target);
    const result = harness.api.createProject({ ...NEW_PROJECT, id: target.id, deletedAt: '2026-01-01T00:00:00.000Z' } as unknown as ProjectInput);
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.id).not.toBe(target.id);
    expect(result.ok && result.data.deletedAt).toBeNull();
    expect(harness.getState().catalogs.projects.find((project) => project.id === target.id)).toEqual(before);
    expect(harness.getState().catalogs.projects).toHaveLength(9);
  });

  it('không tạo trùng mã với dự án đã xoá mềm (mã là duy nhất kể cả dự án đã xoá)', () => {
    const harness = createTestHarness('admin');
    const created = harness.api.createProject(NEW_PROJECT);
    if (!created.ok) throw new Error('setup');
    expect(harness.api.deleteProject(created.data.id).ok).toBe(true);
    expect(errorCode(harness.api.createProject({ ...NEW_PROJECT, name: 'Tên khác' }))).toBe('PROJECT_CODE_DUPLICATED');
  });
});

describe('updateProject', () => {
  it('sửa từng phần và ngừng/dùng lại; khách đã gắn vẫn giữ tham chiếu; ghi PROJECT_DEACTIVATED kèm diff', () => {
    const harness = createTestHarness('admin');
    const target = harness.getState().catalogs.projects[0];
    const usage = isUsed(harness, target.id);
    const updated = harness.api.updateProject(target.id, { developer: 'Chủ đầu tư mới', isActive: false });
    expect(updated.ok && updated.data).toMatchObject({ id: target.id, developer: 'Chủ đầu tư mới', isActive: false, name: target.name, code: target.code });
    expect(isUsed(harness, target.id)).toBe(usage);
    expect(harness.getState().auditLogs[0]).toMatchObject({ action: 'PROJECT_DEACTIVATED', entityId: target.id });
    expect(harness.getState().auditLogs[0].changes.map((change) => change.field)).toEqual(['Chủ đầu tư', 'Đang hoạt động']);
  });

  it('không có gì đổi -> không ghi audit; chỉ đổi thông tin -> PROJECT_UPDATED', () => {
    const harness = createTestHarness('admin');
    const target = harness.getState().catalogs.projects[0];
    expect(harness.api.updateProject(target.id, { name: target.name }).ok).toBe(true);
    expect(harness.getState().auditLogs).toHaveLength(0);
    harness.api.updateProject(target.id, { status: 'SOLD_OUT' });
    expect(auditActions(harness)).toEqual(['PROJECT_UPDATED']);
  });

  it('đổi sang mã của dự án khác bị từ chối; không tồn tại -> 404; không phải Quản trị -> 403; id/deletedAt trong input bị bỏ qua', () => {
    const harness = createTestHarness('admin');
    const [first, second] = harness.getState().catalogs.projects;
    expect(errorCode(harness.api.updateProject(second.id, { code: first.code.toLowerCase() }))).toBe('PROJECT_CODE_DUPLICATED');
    expect(harness.api.updateProject('proj-ghost', { name: 'X' })).toMatchObject({ ok: false, error: { statusCode: 404 } });
    const tampered = harness.api.updateProject(second.id, { developer: 'Z', id: first.id, deletedAt: '2026-01-01T00:00:00.000Z' } as unknown as Partial<ProjectInput>);
    expect(tampered.ok && tampered.data).toMatchObject({ id: second.id, deletedAt: null, developer: 'Z' });
    expect(harness.getState().catalogs.projects.find((project) => project.id === first.id)).toEqual(first);
    harness.switchUser('hanh');
    expect(harness.api.updateProject(first.id, { developer: 'X' })).toMatchObject({ ok: false, error: { statusCode: 403 } });
  });
});

describe('deleteProject (xoá mềm)', () => {
  it('dự án chưa ai quan tâm: xoá mềm (còn trong danh mục với deletedAt, ngừng hoạt động) và ghi PROJECT_DELETED', () => {
    const harness = createTestHarness('admin');
    const created = harness.api.createProject(NEW_PROJECT);
    if (!created.ok) throw new Error('setup');
    expect(harness.api.deleteProject(created.data.id)).toEqual({ ok: true, data: { id: created.data.id } });
    const stored = harness.getState().catalogs.projects.find((project) => project.id === created.data.id);
    expect(stored).toMatchObject({ isActive: false, deletedAt: '2026-10-22T03:00:00.000Z' });
    expect(auditActions(harness)).toEqual(['PROJECT_DELETED', 'PROJECT_CREATED']);
  });

  it('dự án đã xoá mềm coi như không tồn tại cho sửa/xoá lại (404)', () => {
    const harness = createTestHarness('admin');
    const created = harness.api.createProject(NEW_PROJECT);
    if (!created.ok) throw new Error('setup');
    harness.api.deleteProject(created.data.id);
    expect(harness.api.deleteProject(created.data.id)).toMatchObject({ ok: false, error: { statusCode: 404 } });
    expect(harness.api.updateProject(created.data.id, { developer: 'X' })).toMatchObject({ ok: false, error: { statusCode: 404 } });
  });

  it('dự án còn khách quan tâm: 409 PROJECT_IN_USE { customerCount }, KHÔNG đổi gì, không ghi audit', () => {
    const harness = createTestHarness('admin');
    const target = harness.getState().catalogs.projects.find((project) => isUsed(harness, project.id) > 0)!;
    const usage = isUsed(harness, target.id);
    const result = harness.api.deleteProject(target.id);
    expect(result).toMatchObject({ ok: false, error: { statusCode: 409, errorCode: 'PROJECT_IN_USE', details: { customerCount: usage } } });
    expect(harness.getState().catalogs.projects.find((project) => project.id === target.id)).toEqual(target);
    expect(harness.getState().auditLogs).toHaveLength(0);
  });

  it('còn khách thì chuyển ngừng hoạt động qua updateProject(isActive:false) (ghi PROJECT_DEACTIVATED); đã ngừng vẫn không xoá được (409)', () => {
    const harness = createTestHarness('admin');
    const target = harness.getState().catalogs.projects.find((project) => isUsed(harness, project.id) > 0)!;
    const usage = isUsed(harness, target.id);
    expect(harness.api.updateProject(target.id, { isActive: false }).ok).toBe(true);
    expect(harness.getState().catalogs.projects.find((project) => project.id === target.id)).toMatchObject({ isActive: false, deletedAt: null });
    expect(isUsed(harness, target.id)).toBe(usage);
    expect(auditActions(harness)).toEqual(['PROJECT_DEACTIVATED']);
    expect(errorCode(harness.api.deleteProject(target.id))).toBe('PROJECT_IN_USE');
    expect(auditActions(harness)).toEqual(['PROJECT_DEACTIVATED']);
  });

  it('không phải Quản trị -> 403; không tồn tại -> 404; không đổi dữ liệu', () => {
    const harness = createTestHarness('hanh');
    const before = harness.getState().catalogs.projects;
    expect(harness.api.deleteProject(before[0].id)).toMatchObject({ ok: false, error: { statusCode: 403 } });
    harness.switchUser('admin');
    expect(harness.api.deleteProject('proj-ghost')).toMatchObject({ ok: false, error: { statusCode: 404 } });
    expect(harness.getState().catalogs.projects).toEqual(before);
  });
});

describe('input sai kiểu / thiếu key', () => {
  it('key undefined không đè giá trị và không ném lỗi; sai kiểu (null/số) -> 400, không TypeError', () => {
    const harness = createTestHarness('admin');
    const target = harness.getState().catalogs.projects[0];
    const kept = harness.api.updateProject(target.id, { name: undefined, developer: 'Chủ đầu tư mới', location: undefined } as unknown as Partial<ProjectInput>);
    expect(kept.ok && kept.data).toMatchObject({ name: target.name, location: target.location, developer: 'Chủ đầu tư mới' });
    expect(() => harness.api.createProject({ ...NEW_PROJECT, name: null, code: 123 } as unknown as ProjectInput)).not.toThrow();
    expect(statusOf(harness.api.createProject({ ...NEW_PROJECT, name: null, code: 123 } as unknown as ProjectInput))).toBe(400);
    expect(statusOf(harness.api.createProject({ ...NEW_PROJECT, name: undefined, code: undefined } as unknown as ProjectInput))).toBe(400);
    expect(() => harness.api.createProject(undefined as unknown as ProjectInput)).not.toThrow();
    expect(statusOf(harness.api.updateProject(target.id, { name: null } as unknown as Partial<ProjectInput>))).toBe(400);
    expect(harness.getState().catalogs.projects[0]).toMatchObject({ name: target.name, developer: 'Chủ đầu tư mới' });
  });

  it('propertyTypes: chuẩn hoá mảng (cắt, bỏ rỗng/trùng/sai kiểu); mã cho phép bắt đầu bằng _ hoặc -', () => {
    const harness = createTestHarness('admin');
    const result = harness.api.createProject({ ...NEW_PROJECT, code: '_dau-gach', propertyTypes: [' Căn hộ ', 'căn hộ', '', 7 as unknown as string, 'Shophouse'] });
    expect(result.ok && result.data).toMatchObject({ code: '_DAU-GACH', propertyTypes: ['Căn hộ', 'Shophouse'] });
    expect(errorCode(harness.api.createProject({ ...NEW_PROJECT, name: 'Quá nhiều', code: 'MANY', propertyTypes: Array.from({ length: 11 }, (_, index) => `Loại ${index}`) }))).toBe('VALIDATION_FAILED');
  });
});

describe('restoreProject', () => {
  it('khôi phục dự án đã xoá mềm: hoạt động trở lại, deletedAt = null, ghi PROJECT_RESTORED kèm lý do', () => {
    const harness = createTestHarness('admin');
    const created = harness.api.createProject(NEW_PROJECT);
    if (!created.ok) throw new Error('setup');
    harness.api.deleteProject(created.data.id);
    const result = harness.api.restoreProject(created.data.id, 'Xoá nhầm');
    expect(result.ok && result.data).toMatchObject({ isActive: true, deletedAt: null, name: 'Sky Park' });
    expect(harness.getState().auditLogs[0]).toMatchObject({ action: 'PROJECT_RESTORED', entityId: created.data.id, reason: 'Xoá nhầm' });
    expect(harness.api.updateProject(created.data.id, { developer: 'Sửa được lại' }).ok).toBe(true);
  });

  it('chỉ khôi phục dự án ĐÃ xoá: dự án đang dùng hoặc không tồn tại -> 404; không phải Quản trị -> 403', () => {
    const harness = createTestHarness('admin');
    const [first] = harness.getState().catalogs.projects;
    expect(harness.api.restoreProject(first.id)).toMatchObject({ ok: false, error: { statusCode: 404 } });
    expect(harness.api.restoreProject('proj-ghost')).toMatchObject({ ok: false, error: { statusCode: 404 } });
    const created = harness.api.createProject(NEW_PROJECT);
    if (!created.ok) throw new Error('setup');
    harness.api.deleteProject(created.data.id);
    harness.switchUser('hanh');
    expect(harness.api.restoreProject(created.data.id)).toMatchObject({ ok: false, error: { statusCode: 403 } });
    expect(harness.getState().catalogs.projects.find((project) => project.id === created.data.id)?.deletedAt).not.toBeNull();
  });
});

describe('Cài đặt (upsertCatalogItem) dùng chung luồng dự án', () => {
  it('thêm/sửa dự án qua upsert vẫn qua validate + audit; id do hệ thống sinh', () => {
    const harness = createTestHarness('admin');
    const created = harness.api.upsertCatalogItem('projects', { ...NEW_PROJECT, id: 'proj-from-client', isActive: true, deletedAt: null });
    expect(created.ok && created.data).toMatchObject({ code: 'SKYPARK' });
    expect(harness.getState().catalogs.projects.some((project) => project.id === 'proj-from-client')).toBe(false);
    expect(harness.getState().catalogs.projects.find((project) => project.id === 'proj-1')?.code).toBe('QTERRA');
    const existing = harness.getState().catalogs.projects[0];
    expect(harness.api.upsertCatalogItem('projects', { ...existing, isActive: false }).ok).toBe(true);
    expect(auditActions(harness)).toEqual(['PROJECT_DEACTIVATED', 'PROJECT_CREATED']);
    expect(errorCode(harness.api.upsertCatalogItem('projects', { ...existing, code: 'x y' }))).toBe('VALIDATION_FAILED');
    expect(errorCode(harness.api.upsertCatalogItem('projects', { ...harness.getState().catalogs.projects[1], code: existing.code }))).toBe('PROJECT_CODE_DUPLICATED');
  });
});
