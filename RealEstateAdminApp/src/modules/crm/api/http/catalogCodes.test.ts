/**
 * FR-40: adapter đọc/gửi danh mục theo `code` (id của UI = `code` của backend), tương thích ngược khi backend chưa trả `code`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.fn();
vi.mock('../../../../api/axios', () => ({ default: { request: (config: unknown) => request(config) } }));

import type { Project } from '@crm/types/crm';
import { patchStatus, postCustomer, patchCustomer, fetchListCounts } from './customerApi';
import { buildCareLogBody, postBulkOperation } from './careApi';
import { clearCatalogIdRegistry, isLegacyServerId, refListParam, refParam, rememberCatalogId, requireServerCatalogId, toServerCatalogId, toUiCatalogId } from './catalogIds';
import { toApiError } from './crmErrors';
import { toArea, toAreaList, toCatalogItem, toCatalogRef, toContactResult, toProject, toStatusItem, toStatusRef } from './catalogMappers';
import { toAppointment, toCustomerListItem, toDailyTask } from './customerMappers';
import { buildCustomerFilterParams } from './customerQuery';
import { toProjectBody } from './projectBody';
import { createCatalogItem, deleteCatalogItem, deleteProject, patchProject, updateCatalogItem } from './adminApi';
import { postAppointment, fetchAppointments } from './schedulingApi';
import { resetIdempotencyKeys, toResult } from './crmHttp';
import type { AreaDto, CustomerListItemDto, ProjectDto } from './dto';

const OBJECT_ID = '66f1a2b3c4d5e6f708192a3b';
const OBJECT_ID_2 = '66f1a2b3c4d5e6f708192a3c';
const FRESH_ID = '66f1a2b3c4d5e6f708192a3d';
const sent = () => request.mock.calls[0][0] as { method: string; url: string; data?: Record<string, unknown>; params?: Record<string, unknown> };

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({ data: { data: {}, meta: { total: 0, page: 1, limit: 100, totalPages: 1 } } });
  resetIdempotencyKeys();
  clearCatalogIdRegistry();
});

describe('catalogIds (FR-40)', () => {
  it('FR-40: nhận ra ObjectId cũ, không nhận nhầm code', () => {
    expect(isLegacyServerId(OBJECT_ID)).toBe(true);
    expect(isLegacyServerId('FACEBOOK_ADS')).toBe(false);
    expect(isLegacyServerId('66F1A2B3C4D5E6F708192A3B')).toBe(false);
    expect(isLegacyServerId('abc')).toBe(false);
  });

  it('FR-40: bảng tra hai chiều id thật <-> code; chưa biết thì giữ nguyên; không có code thì dùng id cũ', () => {
    expect(rememberCatalogId('areas', OBJECT_ID, 'HA_NOI')).toBe('HA_NOI');
    expect(toUiCatalogId('areas', OBJECT_ID)).toBe('HA_NOI');
    expect(toServerCatalogId('areas', 'HA_NOI')).toBe(OBJECT_ID);
    expect(toServerCatalogId('areas', 'CHUA_BIET')).toBe('CHUA_BIET');
    expect(toUiCatalogId('areas', OBJECT_ID_2)).toBe(OBJECT_ID_2);
    expect(rememberCatalogId('areas', OBJECT_ID_2, undefined)).toBe(OBJECT_ID_2);
    // Loại danh mục tách biệt: cùng code ở loại khác không lẫn.
    expect(toServerCatalogId('projects', 'HA_NOI')).toBe('HA_NOI');
  });

  it('FR-40: refParam gửi `…Code` cho code, `…Id` cho ObjectId cũ, giữ null và undefined', () => {
    expect(refParam('statusCode', 'statusId', 'NET')).toEqual({ statusCode: 'NET' });
    expect(refParam('statusCode', 'statusId', OBJECT_ID)).toEqual({ statusId: OBJECT_ID });
    expect(refParam('sourceCode', 'sourceId', null)).toEqual({ sourceCode: null });
    expect(refParam('sourceCode', 'sourceId', undefined)).toEqual({});
  });

  it('FR-40: refListParam luôn trả đúng MỘT khóa: toàn code -> …Codes, toàn ObjectId -> …Ids, rỗng -> …Codes: [], undefined -> không gửi', () => {
    expect(refListParam('projectCodes', 'projectIds', ['QTERRA', 'VHOP'], 'projects')).toEqual({ projectCodes: ['QTERRA', 'VHOP'] });
    expect(refListParam('projectCodes', 'projectIds', [OBJECT_ID], 'projects')).toEqual({ projectIds: [OBJECT_ID] });
    expect(refListParam('projectCodes', 'projectIds', [], 'projects')).toEqual({ projectCodes: [] });
    expect(refListParam('projectCodes', 'projectIds', undefined, 'projects')).toEqual({});
  });

  it('FR-40: refListParam: ObjectId đã biết code thì đổi sang code (không trộn hai khóa)', () => {
    rememberCatalogId('projects', OBJECT_ID, 'QTERRA');
    expect(refListParam('projectCodes', 'projectIds', [OBJECT_ID, 'VHOP'], 'projects')).toEqual({ projectCodes: ['QTERRA', 'VHOP'] });
  });

  it('FR-40: refListParam: trộn code với ObjectId chưa biết code -> đổi hết về ObjectId, chỉ gửi …Ids (backend không nhận hai khóa lệch nhau)', () => {
    rememberCatalogId('projects', OBJECT_ID_2, 'VHOP');
    const params = refListParam('projectCodes', 'projectIds', ['VHOP', OBJECT_ID], 'projects');
    expect(params).toEqual({ projectIds: [OBJECT_ID_2, OBJECT_ID] });
    expect(params).not.toHaveProperty('projectCodes');
  });

  it('FR-40: requireServerCatalogId: ObjectId cũ và code đã biết thì trả id thật; code chưa biết thì chặn sớm với lỗi tiếng Việt', () => {
    rememberCatalogId('projects', OBJECT_ID, 'QTERRA');
    expect(requireServerCatalogId('projects', 'QTERRA')).toBe(OBJECT_ID);
    expect(requireServerCatalogId('projects', OBJECT_ID_2)).toBe(OBJECT_ID_2);
    let caught: unknown;
    try {
      requireServerCatalogId('projects', 'CHUA_TAI');
    } catch (error) {
      caught = error;
    }
    expect(toApiError(caught)).toMatchObject({ errorCode: 'CATALOG_ID_UNRESOLVED', message: expect.stringContaining('tải lại') });
  });
});

describe('catalogMappers đọc code (FR-40)', () => {
  it('FR-40: tình trạng, nguồn, kết quả liên hệ: id của UI = code', () => {
    expect(toStatusRef({ id: OBJECT_ID, code: 'NET', label: 'Khách net', listGroup: 'NET', color: 'warning' })).toMatchObject({ id: 'NET', code: 'NET', tone: 'warning' });
    expect(toStatusItem({ id: OBJECT_ID, code: 'NET', label: 'Khách net', listGroup: 'NET', color: null, order: 1, isDefault: false, isSystem: true, isActive: true }).id).toBe('NET');
    expect(toCatalogItem({ id: OBJECT_ID, code: 'FACEBOOK_ADS', label: 'Facebook', order: 1, isActive: true })).toMatchObject({ id: 'FACEBOOK_ADS', code: 'FACEBOOK_ADS' });
    expect(toContactResult({ id: OBJECT_ID, code: 'PRICE_QUOTE', label: 'Giá', order: 1, isActive: true, suggestedFollowUpDays: 2, suggestionText: '' }).id).toBe('PRICE_QUOTE');
  });

  it('FR-40: Ref có code -> id = code; chưa có code (chưa migrate) -> giữ id cũ; Ref đã gặp trước đó có code thì dùng code', () => {
    expect(toCatalogRef('leadSources', { id: OBJECT_ID, code: 'WEBSITE', label: 'Website' })).toEqual({ id: 'WEBSITE', label: 'Website' });
    expect(toCatalogRef('leadSources', { id: OBJECT_ID_2, label: 'Cũ' })).toEqual({ id: OBJECT_ID_2, label: 'Cũ' });
    toCatalogItem({ id: OBJECT_ID_2, code: 'OLD_SRC', label: 'Cũ', order: 1, isActive: true });
    expect(toCatalogRef('leadSources', { id: OBJECT_ID_2, label: 'Cũ' }).id).toBe('OLD_SRC');
  });

  it('FR-40: khu vực: id = code, parentId đổi sang code của cha kể cả khi cha đứng SAU con trong danh sách', () => {
    const child: AreaDto = { id: OBJECT_ID_2, code: 'THU_DUC', label: 'Thủ Đức', name: 'Thủ Đức', type: 'DISTRICT', parentId: OBJECT_ID, path: [{ id: OBJECT_ID, label: 'TP. HCM' }], adminCode: null, isLegacy: false, order: 2, isActive: true };
    const parent: AreaDto = { id: OBJECT_ID, code: 'TP_HO_CHI_MINH', label: 'TP. HCM', name: 'TP. HCM', type: 'PROVINCE', parentId: null, path: [], adminCode: null, isLegacy: false, order: 1, isActive: true };
    const areas = toAreaList([child, parent]);
    expect(areas.map((area) => area.id)).toEqual(['THU_DUC', 'TP_HO_CHI_MINH']);
    expect(areas[0].parentId).toBe('TP_HO_CHI_MINH');
    expect(areas[1].parentId).toBeNull();
    // Backend cũ chưa trả code: id cũ vẫn dùng được.
    expect(toArea({ ...parent, id: OBJECT_ID_2, code: undefined }).id).toBe(OBJECT_ID_2);
  });

  const projectDto = (overrides: Partial<ProjectDto> = {}): ProjectDto => ({
    id: OBJECT_ID,
    name: "Q'Terra",
    code: ' qterra ',
    developer: null,
    location: null,
    area: { id: OBJECT_ID_2, label: 'TP. HCM' },
    propertyTypes: ['Căn hộ'],
    priceFrom: null,
    priceTo: null,
    status: 'SELLING',
    isActive: true,
    customerCount: 0,
    deletedAt: null,
    ...overrides,
  });

  it('FR-40: dự án: id = mã chuẩn hóa HOA, giữ `code` gốc để hiển thị; areaId ưu tiên `areaCode`, rồi `area.code`, rồi id cũ', () => {
    expect(toProject(projectDto({ areaCode: 'TP_HO_CHI_MINH' }))).toMatchObject({ id: 'QTERRA', code: ' qterra ', areaId: 'TP_HO_CHI_MINH' });
    expect(toProject(projectDto({ area: { id: OBJECT_ID_2, label: 'x', code: 'HA_NOI' } })).areaId).toBe('HA_NOI');
    expect(toProject(projectDto({ area: { id: FRESH_ID, label: 'x' } })).areaId).toBe(FRESH_ID);
    expect(toProject(projectDto({ area: null })).areaId).toBeNull();
  });

  it('FR-40: dự án: chuyển `propertyTypeCodes` và `unmappedPropertyTypes` khi backend trả, bỏ qua khi không có', () => {
    const withCodes = toProject(projectDto({ propertyTypeCodes: ['APARTMENT'], unmappedPropertyTypes: ['Đất nền'] }));
    expect(withCodes.propertyTypeCodes).toEqual(['APARTMENT']);
    expect(withCodes.unmappedPropertyTypes).toEqual(['Đất nền']);
    expect(toProject(projectDto())).not.toHaveProperty('propertyTypeCodes');
  });

  it('FR-40: khách: nguồn, dự án, khu vực trong danh sách đọc code', () => {
    const dto = {
      id: 'c1', fullName: 'An', phoneMasked: '', status: { id: OBJECT_ID, code: 'NET', label: 'Net', listGroup: 'NET', color: null },
      source: { id: OBJECT_ID, code: 'WEBSITE', label: 'Website' },
      projects: [{ id: OBJECT_ID, code: 'QTERRA', label: "Q'Terra" }, { id: OBJECT_ID_2, label: 'Cũ' }],
      area: { id: OBJECT_ID, code: 'HA_NOI', label: 'Hà Nội' },
      tags: [], progress: 0, criteriaDone: { demand: false, motivation: false, finance: false, timing: false }, primaryAssignee: null,
      careTeamSize: 0, nextAppointmentAt: null, lastCareLogAt: null, lastUpdatedAt: 't', personaCompleteness: 0,
    } as CustomerListItemDto;
    const item = toCustomerListItem(dto);
    expect(item.status.id).toBe('NET');
    expect(item.source).toEqual({ id: 'WEBSITE', label: 'Website' });
    expect(item.projects.map((project) => project.id)).toEqual(['QTERRA', OBJECT_ID_2]);
    expect(item.area).toEqual({ id: 'HA_NOI', label: 'Hà Nội' });
  });

  it('FR-40: lịch hẹn và việc hôm nay: dự án đọc code', () => {
    const status = { id: OBJECT_ID, code: 'NET', label: 'Net', listGroup: 'NET' as const, color: null };
    const project = { id: OBJECT_ID, code: 'VHOP', label: 'VHOP' };
    const user = { id: 'u1', displayName: 'Hạnh' };
    const appointment = toAppointment({
      id: 'a1', customer: { id: 'c1', fullName: 'An', phoneMasked: '', status }, type: 'SITE_VISIT', title: '', startAt: 't', endAt: null, location: '', note: '',
      project, assignee: user, remindBeforeMinutes: [], status: 'SCHEDULED', completedAt: null, outcome: null, createdBy: user, version: 1, canDelete: true,
    } as never);
    expect(appointment.project).toEqual({ id: 'VHOP', label: 'VHOP' });
    const task = toDailyTask({
      id: 't1', kind: 'APPOINTMENT', dueAt: 't', group: 'TODAY', customer: { id: 'c1', fullName: 'An', phoneMasked: '', status, projects: [project] }, project,
      title: '', lastCareLog: null, suggestion: null, appointmentId: null, careLogId: null, assignee: null, isPrimary: true,
    } as never);
    expect(task.project?.id).toBe('VHOP');
    expect(task.customer.projects[0].id).toBe('VHOP');
  });
});

describe('request gửi …Code (FR-40)', () => {
  it('FR-40: bộ lọc khách gửi statusCodes/sourceCodes/projectCodes/areaCodes (CSV), ObjectId cũ gửi …Ids', () => {
    expect(buildCustomerFilterParams({ statusIds: ['NET', 'DROPPED'], sourceIds: ['WEBSITE'], projectIds: ['QTERRA'], areaIds: ['HA_NOI'] })).toMatchObject({
      statusCodes: ['NET', 'DROPPED'], sourceCodes: ['WEBSITE'], projectCodes: ['QTERRA'], areaCodes: ['HA_NOI'],
    });
    const legacy = buildCustomerFilterParams({ statusIds: [OBJECT_ID] });
    expect(legacy).toMatchObject({ statusIds: [OBJECT_ID] });
    expect(legacy).not.toHaveProperty('statusCodes');
  });

  it('FR-40: tạo khách gửi statusCode, sourceCode, areaCode, projectCodes (không gửi …Id)', async () => {
    request.mockResolvedValue({ data: { data: { id: 'c1' } } });
    await postCustomer({ fullName: 'An', phone: '0900000000', statusId: 'INTERESTED', sourceId: 'WEBSITE', areaId: 'HA_NOI', interestedProjectIds: ['QTERRA'] }, { actor: { userId: 'u', role: 'ADMIN' } }).catch(() => undefined);
    expect(sent().url).toBe('/crm/customers');
    expect(sent().data).toMatchObject({ statusCode: 'INTERESTED', sourceCode: 'WEBSITE', areaCode: 'HA_NOI', projectCodes: ['QTERRA'] });
    for (const key of ['statusId', 'sourceId', 'areaId', 'interestedProjectIds']) expect(sent().data).not.toHaveProperty(key);
  });

  it('FR-40: tạo khách với ObjectId cũ vẫn gửi trường id tương ứng (tương thích ngược)', async () => {
    request.mockResolvedValue({ data: { data: { id: 'c1' } } });
    await postCustomer({ fullName: 'An', phone: '0900000000', statusId: OBJECT_ID, sourceId: OBJECT_ID, areaId: OBJECT_ID_2, interestedProjectIds: [OBJECT_ID] }, { actor: { userId: 'u', role: 'ADMIN' } }).catch(() => undefined);
    expect(sent().data).toMatchObject({ statusId: OBJECT_ID, sourceId: OBJECT_ID, areaId: OBJECT_ID_2, interestedProjectIds: [OBJECT_ID] });
    expect(sent().data).not.toHaveProperty('statusCode');
  });

  it('FR-40: sửa khách: bỏ nguồn/khu vực gửi null theo khóa Code, bỏ hết dự án gửi projectCodes rỗng', async () => {
    request.mockResolvedValue({ data: { data: { id: 'c1' } } });
    await patchCustomer('c1', { version: 3, sourceId: null, areaId: null, interestedProjectIds: [] }, { actor: { userId: 'u', role: 'ADMIN' } }).catch(() => undefined);
    expect(sent().data).toMatchObject({ version: 3, sourceCode: null, areaCode: null, projectCodes: [] });
  });

  it('FR-40: đổi tình trạng gửi statusCode và đổi previousStatusId về code', async () => {
    rememberCatalogId('statuses', OBJECT_ID, 'INTERESTED');
    request.mockResolvedValue({ data: { data: { status: { id: OBJECT_ID_2, code: 'NET', label: 'Net', listGroup: 'NET', color: null }, previousStatusId: OBJECT_ID, version: 4, lastUpdatedAt: 't' } } });
    const result = await patchStatus('c1', { statusId: 'NET', version: 3, reason: 'x' });
    expect(sent().data).toEqual({ statusCode: 'NET', version: 3, reason: 'x' });
    expect(result.previousStatusId).toBe('INTERESTED');
    expect(result.status.id).toBe('NET');
  });

  it('FR-40: list-counts: byStatus[].statusId của UI = statusCode; thiếu statusCode thì suy từ id', async () => {
    rememberCatalogId('statuses', OBJECT_ID_2, 'DROPPED');
    request.mockResolvedValue({ data: { data: { NOT_CONTACTED: 0, INTERESTED: 0, NET: 0, DROPPED: 1, ALL: 3, byStatus: [{ statusId: OBJECT_ID, statusCode: 'NET', count: 2 }, { statusId: OBJECT_ID_2, count: 1 }] } } });
    const counts = await fetchListCounts({});
    expect(counts.byStatus).toEqual([{ statusId: 'NET', count: 2 }, { statusId: 'DROPPED', count: 1 }]);
  });

  it('FR-40: nhật ký gửi contactResultCode; ObjectId cũ gửi contactResultId; không chọn thì không gửi', () => {
    expect(buildCareLogBody({ content: 'a', contactChannel: 'CALL', contactResultId: 'PRICE_QUOTE' })).toMatchObject({ contactResultCode: 'PRICE_QUOTE' });
    expect(buildCareLogBody({ content: 'a', contactChannel: 'CALL', contactResultId: 'PRICE_QUOTE' })).not.toHaveProperty('contactResultId');
    expect(buildCareLogBody({ content: 'a', contactChannel: 'CALL', contactResultId: OBJECT_ID })).toMatchObject({ contactResultId: OBJECT_ID });
    expect(buildCareLogBody({ content: 'a', contactChannel: 'CALL', contactResultId: null })).not.toHaveProperty('contactResultCode');
  });

  it('FR-40: nhật ký kèm lịch hẹn: projectId lồng đổi về id thật qua bảng tra', () => {
    rememberCatalogId('projects', OBJECT_ID, 'QTERRA');
    const body = buildCareLogBody({ content: 'a', contactChannel: 'CALL', nextAction: { suggestion: 'x', dueAt: null, appointment: { type: 'SITE_VISIT', projectId: 'QTERRA' } } });
    expect(body.nextAction).toMatchObject({ appointment: { projectId: OBJECT_ID } });
  });

  it('FR-40: thao tác hàng loạt đổi tình trạng gửi payload.statusCode', async () => {
    request.mockResolvedValue({ data: { data: { succeeded: [], failed: [] } } });
    await postBulkOperation({ type: 'CHANGE_STATUS', customerIds: ['c1'], statusId: 'DROPPED' });
    expect(sent().data).toEqual({ type: 'CHANGE_STATUS', customerIds: ['c1'], payload: { statusCode: 'DROPPED' } });
  });

  it('FR-40: lịch hẹn: tạo gửi projectCode; lọc theo dự án gửi id thật qua bảng tra', async () => {
    rememberCatalogId('projects', OBJECT_ID, 'QTERRA');
    request.mockResolvedValue({ data: { data: [], meta: { total: 0, page: 1, limit: 100, totalPages: 1 } } });
    await fetchAppointments({ from: '2026-10-01', to: '2026-10-31', projectId: 'QTERRA' });
    expect(sent().params).toMatchObject({ projectId: OBJECT_ID });

    request.mockReset();
    request.mockResolvedValue({ data: { data: {} } });
    await postAppointment({ customerId: 'c1', type: 'SITE_VISIT', startAt: 't', projectId: 'QTERRA' }).catch(() => undefined);
    expect(sent().data).toMatchObject({ projectCode: 'QTERRA' });
  });
});

describe('adapter quản trị dùng id thật cho URL (FR-40)', () => {
  const baseProject: Project = {
    id: 'QTERRA', code: 'QTERRA', name: "Q'Terra", fullName: "Q'Terra", developer: '', location: '', areaId: 'HA_NOI', propertyTypes: ['Căn hộ'],
    priceFrom: null, priceTo: null, priceUnit: 'TOTAL', status: 'SELLING', segment: '', isActive: true, deletedAt: null,
  };

  it('FR-40: body dự án gửi areaCode và vẫn gửi nhãn propertyTypes (không gửi propertyTypeCodes)', () => {
    const body = toProjectBody({ ...baseProject, propertyTypeCodes: ['APARTMENT'] }, { isCreate: true });
    expect(body).toMatchObject({ areaCode: 'HA_NOI', propertyTypes: ['Căn hộ'] });
    expect(body).not.toHaveProperty('areaId');
    expect(body).not.toHaveProperty('propertyTypeCodes');
    expect(toProjectBody({ ...baseProject, areaId: null }).areaCode).toBeNull();
    expect(toProjectBody({ ...baseProject, areaId: OBJECT_ID })).toMatchObject({ areaId: OBJECT_ID });
  });

  it('FR-40: sửa/xóa danh mục: URL dùng ObjectId thật của code', async () => {
    rememberCatalogId('leadSources', OBJECT_ID, 'WEBSITE');
    await updateCatalogItem('lead-sources', 'WEBSITE', { label: 'x' });
    expect(sent().url).toBe(`/crm/lead-sources/${OBJECT_ID}`);
    request.mockClear();
    await deleteCatalogItem('lead-sources', 'WEBSITE');
    expect(sent().url).toBe(`/crm/lead-sources/${OBJECT_ID}`);
  });

  it('FR-40: tạo/sửa khu vực: parentId (code) đổi về ObjectId của cha', async () => {
    rememberCatalogId('areas', OBJECT_ID, 'TP_HO_CHI_MINH');
    await createCatalogItem('areas', { name: 'Thủ Đức', type: 'DISTRICT', parentId: 'TP_HO_CHI_MINH' });
    expect(sent().data).toMatchObject({ parentId: OBJECT_ID });
    request.mockClear();
    await createCatalogItem('areas', { name: 'Gốc', parentId: null });
    expect(sent().data).toMatchObject({ parentId: null });
  });

  it('FR-40: chưa biết id thật của code: sửa/xóa/lọc bị chặn sớm, KHÔNG gửi request chứa code vào chỗ cần ObjectId', async () => {
    expect((await toResult(() => updateCatalogItem('areas', 'CHUA_TAI', {}))).ok).toBe(false);
    expect((await toResult(() => deleteProject('CHUA_TAI'))).ok).toBe(false);
    expect((await toResult(() => createCatalogItem('areas', { name: 'x', parentId: 'CHUA_TAI' }))).ok).toBe(false);
    expect((await toResult(() => fetchAppointments({ projectId: 'CHUA_TAI' }))).ok).toBe(false);
    expect(request).not.toHaveBeenCalled();
    const result = await toResult(() => patchProject('CHUA_TAI', { name: 'x' }));
    expect(result.ok === false && result.error.message).toContain('tải lại');
  });

  it('FR-40: sửa dự án: URL dùng ObjectId thật; ObjectId cũ (chưa migrate) giữ nguyên', async () => {
    rememberCatalogId('projects', OBJECT_ID, 'QTERRA');
    request.mockResolvedValue({ data: { data: { id: OBJECT_ID, name: 'x', code: 'QTERRA', area: null, propertyTypes: [], priceFrom: null, priceTo: null, status: 'SELLING', isActive: true, customerCount: 0, deletedAt: null } } });
    await patchProject('QTERRA', { name: 'x' });
    expect(sent().url).toBe(`/crm/projects/${OBJECT_ID}`);
    request.mockClear();
    await patchProject(OBJECT_ID_2, { name: 'x' });
    expect(sent().url).toBe(`/crm/projects/${OBJECT_ID_2}`);
  });
});
