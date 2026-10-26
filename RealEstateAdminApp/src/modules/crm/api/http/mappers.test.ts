import { describe, expect, it } from 'vitest';
import type { PersonaFieldDefinition } from '@crm/types/crm';
import { buildCareLogBody } from './careApi';
import { toArea, toPersonaField, toProject, toStatusTone } from './catalogMappers';
import { toAppointment, toCareLog, toDailyTask, toCustomerDetail, toCustomerPersona, toHistoryEntry, toPersonaValueBody } from './customerMappers';
import { buildCustomerListParams, buildCustomerFilterParams, normalizeSearchTerm } from './customerQuery';
import { toProjectBody } from './projectBody';
import type { CareLogDto, CustomerDetailDto, PersonaFieldDto } from './dto';

const STATUS = { id: 's1', code: 'NOT_CONTACTED', label: 'Chưa tiếp cận', listGroup: 'NOT_CONTACTED' as const, color: 'gray' };

const detailDto = (overrides: Partial<CustomerDetailDto> = {}): CustomerDetailDto => ({
  id: 'c1',
  fullName: 'Nguyễn Văn An',
  phoneMasked: '0912 ••• 678',
  status: STATUS,
  source: null,
  projects: [],
  area: null,
  tags: [],
  progress: 25,
  criteriaDone: { demand: true, motivation: false, finance: false, timing: false },
  primaryAssignee: { id: 'u1', displayName: 'Hạnh' },
  careTeamSize: 2,
  nextAppointmentAt: null,
  lastCareLogAt: null,
  lastUpdatedAt: '2026-10-24T01:00:00.000Z',
  personaCompleteness: 10,
  email: null,
  canViewPhone: true,
  criteria: {
    demand: { isDone: true, description: 'Cần 2PN', updatedAt: null, updatedBy: null },
    motivation: { isDone: false, description: '', updatedAt: null, updatedBy: null },
    finance: { isDone: false, description: '', updatedAt: null, updatedBy: null },
    timing: { isDone: false, description: '', updatedAt: null, updatedBy: null },
  },
  careTeam: [
    { user: { id: 'u1', displayName: 'Hạnh' }, role: 'PRIMARY', addedAt: 't', addedBy: null },
    { user: { id: 'u2', displayName: 'Minh' }, role: 'MEMBER', addedAt: 't', addedBy: { id: 'u1', displayName: 'Hạnh' } },
  ],
  nationalIdMasked: '••••1234',
  hasNationalId: true,
  canRevealNationalId: false,
  dataConsent: { status: 'UNKNOWN', method: null, recordedBy: null, recordedAt: null, note: null },
  lastUpdatedBy: null,
  createdAt: '2026-10-20T01:00:00.000Z',
  createdBy: null,
  createdVia: 'WEB',
  nextActionSuggestions: [],
  permissions: { canEdit: true, canManageCareTeam: false, canChangePrimary: false, canDelete: false },
  version: 3,
  ...overrides,
});

describe('toCustomerDetail', () => {
  it('map email null -> chuỗi rỗng, người hệ thống khi thiếu, quyền theo response + canRevealNationalId ở cấp trên', () => {
    const detail = toCustomerDetail(detailDto(), { actor: { userId: 'u9', role: 'STAFF' } });
    expect(detail.email).toBe('');
    expect(detail.createdBy.displayName).toBe('Hệ thống');
    expect(detail.version).toBe(3);
    expect(detail.permissions).toMatchObject({ canEdit: true, canManageCareTeam: false, canRevealNationalId: false });
    expect(detail.status.tone).toBe('gray');
  });

  it('canReviewJoinRequests: Quản trị/Quản lý hoặc phụ trách chính; thành viên thường thì không', () => {
    const review = (userId: string, role: 'ADMIN' | 'MANAGER' | 'STAFF') => toCustomerDetail(detailDto(), { actor: { userId, role } }).permissions.canReviewJoinRequests;
    expect(review('u1', 'STAFF')).toBe(true); // phụ trách chính
    expect(review('u2', 'STAFF')).toBe(false); // thành viên thường
    expect(review('x', 'MANAGER')).toBe(true);
    expect(review('x', 'ADMIN')).toBe(true);
  });

  it('chức danh thành viên suy từ vai trò khi tra được', () => {
    const detail = toCustomerDetail(detailDto(), { actor: { userId: 'u1', role: 'STAFF' }, roleOf: (id) => (id === 'u2' ? 'MANAGER' : undefined) });
    expect(detail.careTeam[1].user.jobTitle).toBe('Quản lý');
    expect(detail.careTeam[0].user.jobTitle).toBe('');
  });
});

describe('toCareLog / toAppointment / toHistoryEntry', () => {
  const careLogDto: CareLogDto = {
    id: 'l1',
    customerId: 'c1',
    author: { id: 'u1', displayName: 'Hạnh' },
    occurredAt: 't',
    content: 'Đã gọi',
    attachments: [{ id: 'a1', thumbUrl: 'https://s3/x', url: 'https://s3/x?sig', mimeType: 'image/png', size: 10 }],
    contactChannel: 'CALL',
    contactResult: null,
    nextAction: { suggestion: null, dueAt: '2026-10-30T02:00:00.000Z', appointmentId: null },
    source: 'MANUAL',
    editedAt: null,
    canEdit: true,
  };

  it('dấu "Chính" chỉ khi tác giả là phụ trách chính hiện tại; ảnh dùng signed URL; gợi ý rỗng -> chuỗi rỗng', () => {
    const log = toCareLog(careLogDto, 'u1');
    expect(log.isPrimaryAuthor).toBe(true);
    expect(toCareLog(careLogDto, 'u2').isPrimaryAuthor).toBe(false);
    expect(toCareLog(careLogDto, null).isPrimaryAuthor).toBe(false);
    expect(log.images[0].src).toBe('https://s3/x?sig');
    expect(log.attachmentIds).toEqual(['a1']);
    expect(log.nextAction).toMatchObject({ suggestion: '', dueAt: '2026-10-30T02:00:00.000Z' });
  });

  it('lịch hẹn giữ version + canDelete; loại ký cọc là DEPOSIT_CONTRACT', () => {
    const appointment = toAppointment({
      id: 'p1',
      customer: { id: 'c1', fullName: 'An', phoneMasked: '0912 ••• 678', status: STATUS },
      type: 'DEPOSIT_CONTRACT',
      title: '',
      startAt: 't',
      endAt: null,
      location: '',
      note: '',
      assignee: { id: 'u1', displayName: 'Hạnh' },
      remindBeforeMinutes: [60],
      status: 'SCHEDULED',
      completedAt: null,
      outcome: null,
      createdBy: { id: 'u1', displayName: 'Hạnh' },
      version: 4,
      canDelete: true,
    });
    expect(appointment).toMatchObject({ version: 4, canDelete: true, type: 'DEPOSIT_CONTRACT' });
    expect(appointment.customer.phoneMasked).toBe('0912 ••• 678');
  });

  it('dự án của lịch (G7): response `label` thành tên hiển thị; null hoặc thiếu (lịch cũ) thành null', () => {
    const base = {
      id: 'p1',
      customer: { id: 'c1', fullName: 'An', phoneMasked: '0912 ••• 678', status: STATUS },
      type: 'SITE_VISIT' as const,
      title: '',
      startAt: 't',
      endAt: null,
      location: '',
      note: '',
      assignee: { id: 'u1', displayName: 'Hạnh' },
      remindBeforeMinutes: [60],
      status: 'SCHEDULED' as const,
      completedAt: null,
      outcome: null,
      createdBy: { id: 'u1', displayName: 'Hạnh' },
      version: 1,
      canDelete: true,
    };
    expect(toAppointment({ ...base, project: { id: 'pr1', label: "Q'Terra" } }).project).toEqual({ id: 'pr1', label: "Q'Terra" });
    expect(toAppointment({ ...base, project: null }).project).toBeNull();
    expect(toAppointment(base).project).toBeNull();
  });

  it('việc hôm nay (G7): `project` riêng của task giữ label; thiếu/null thành null; customer.projects giữ nguyên', () => {
    const dto = {
      id: 't1',
      kind: 'APPOINTMENT' as const,
      dueAt: 't',
      group: 'TODAY' as const,
      customer: { id: 'c1', fullName: 'An', phoneMasked: '0912 ••• 678', status: STATUS, projects: [{ id: 'pa', label: 'A' }] },
      title: '',
      lastCareLog: null,
      suggestion: '',
      assignee: null,
      isPrimary: true,
      editedAt: null,
      canEdit: false,
    };
    const withProject = toDailyTask({ ...dto, project: { id: 'pb', label: 'B' } } as never);
    expect(withProject.project).toEqual({ id: 'pb', label: 'B' });
    expect(withProject.customer.projects).toEqual([{ id: 'pa', label: 'A' }]);
    expect(toDailyTask({ ...dto, project: null } as never).project).toBeNull();
    expect(toDailyTask(dto as never).project).toBeNull();
  });

  it('lịch sử: before/after bất kỳ kiểu -> chuỗi hiển thị, không có "undefined"/"[object Object]"', () => {
    const entry = toHistoryEntry({
      id: 'h1',
      action: 'CUSTOMER_UPDATED',
      actor: null,
      actorRole: null,
      reason: null,
      source: 'WEB',
      createdAt: 't',
      changes: [
        { field: 'Dự án', from: ['A', 'B'], to: null },
        { field: 'Cần vay', from: true, to: false },
        { field: 'Giá', from: 5, to: undefined },
      ],
    });
    expect(entry.actor.displayName).toBe('Hệ thống');
    expect(entry.changes).toEqual([
      { field: 'Dự án', from: 'A, B', to: '' },
      { field: 'Cần vay', from: 'Có', to: 'Không' },
      { field: 'Giá', from: '5', to: '' },
    ]);
  });
});

describe('danh mục', () => {
  it('màu lạ -> xám; dự án thiếu trường UI -> giá trị mặc định', () => {
    expect(toStatusTone('success')).toBe('success');
    expect(toStatusTone('magenta')).toBe('gray');
    expect(toStatusTone(null)).toBe('gray');
    const project = toProject({ id: 'p', name: "Q'Terra", code: 'QT', developer: null, location: null, area: null, propertyTypes: [], priceFrom: null, priceTo: null, status: 'SELLING', isActive: true, customerCount: 3, deletedAt: null });
    expect(project).toMatchObject({ fullName: "Q'Terra", developer: '', priceUnit: 'TOTAL', segment: '' });
  });

  it('khu vực: tên kèm khu vực cha để phân biệt, giữ tên gốc để sửa', () => {
    const area = toArea({ id: 'a', label: 'Quận 1', name: 'Quận 1', type: 'DISTRICT', parentId: 'p', path: [{ id: 'p', label: 'TP.HCM' }], adminCode: null, isLegacy: false, order: 1, isActive: true });
    expect(area).toMatchObject({ name: 'Quận 1 · TP.HCM', rawName: 'Quận 1', parentId: 'p' });
  });

  it('projectBody: không gửi trường backend không nhận; POST không có isActive; chuỗi rỗng -> null', () => {
    const project = toProject({ id: 'p', name: 'A', code: 'A1', developer: '', location: '', area: null, propertyTypes: ['Căn hộ'], priceFrom: 1, priceTo: 2, status: 'UPCOMING', isActive: false, customerCount: 0, deletedAt: null });
    const create = toProjectBody(project, { isCreate: true });
    expect(create).not.toHaveProperty('isActive');
    expect(create).not.toHaveProperty('fullName');
    expect(create).toMatchObject({ developer: null, location: null, areaId: null, propertyTypes: ['Căn hộ'] });
    expect(toProjectBody(project).isActive).toBe(false);
  });
});

describe('chân dung: đổi qua lại mã lựa chọn <-> nhãn', () => {
  const dto: PersonaFieldDto = {
    id: 'f1',
    key: 'property_type',
    label: 'Loại hình',
    helpText: null,
    placeholder: null,
    groupCode: 'REAL_ESTATE',
    type: 'MULTI_SELECT',
    options: [
      { value: 'APT', label: 'Căn hộ', isActive: true },
      { value: 'OLD', label: 'Loại cũ', isActive: false },
    ],
    order: 1,
    weight: 1,
    suggestPriority: 1,
    isFilterable: true,
    isOccasion: false,
    occasionLabel: null,
    linkedCriterion: 'demand',
    isSensitive: false,
    isSystem: true,
    isActive: true,
  };
  const field: PersonaFieldDefinition = toPersonaField(dto);

  it('lựa chọn đã tắt không hiện khi chọn mới nhưng vẫn đọc được giá trị cũ', () => {
    expect(field.options).toEqual(['Căn hộ']);
    const view = toCustomerPersona(
      { groups: [{ code: 'REAL_ESTATE', label: 'Nhu cầu BĐS', fields: [{ fieldKey: 'property_type', label: 'Loại hình', groupCode: 'REAL_ESTATE', type: 'MULTI_SELECT', value: { valueOptions: ['APT', 'OLD'] }, source: 'STAFF_OBSERVED', updatedAt: 't', updatedBy: { id: 'u1', displayName: 'Hạnh' } }] }], completeness: 50, missingSuggestions: [], version: 9 },
      new Map([['property_type', field]]),
    );
    expect(view.values[0].valueOptions).toEqual(['Căn hộ', 'Loại cũ']);
    expect(view.version).toBe(9);
  });

  it('gửi lên: nhãn -> mã', () => {
    expect(toPersonaValueBody({ valueOptions: ['Căn hộ'] }, field)).toEqual({ valueOptions: ['APT'] });
    expect(toPersonaValueBody({ valueText: 'x' }, undefined)).toEqual({ valueText: 'x' });
  });
});

describe('tham số danh sách khách (05 §2.3)', () => {
  it('q < 2 ký tự không gửi (backend 400); mảng nối phẩy; listGroup=ALL không gửi', () => {
    expect(normalizeSearchTerm(' a ')).toBeUndefined();
    expect(normalizeSearchTerm('  an ')).toBe('an');
    const params = buildCustomerListParams({ q: 'a', listGroup: 'ALL', statusIds: ['1', '2'], progress: [0, 25], page: 2, limit: 20, sort: '-progress', occupation: '  ' });
    expect(params).toMatchObject({ q: undefined, listGroup: undefined, statusIds: ['1', '2'], progress: [0, 25], page: 2, limit: 20, sort: '-progress', occupation: undefined });
    expect(buildCustomerListParams({ listGroup: 'NET' }).listGroup).toBe('NET');
  });

  it('list-counts: không có page/limit/sort/listGroup', () => {
    const params = buildCustomerFilterParams({ q: 'binh', listGroup: 'NET', page: 3, sort: 'fullName' });
    expect(Object.keys(params)).not.toEqual(expect.arrayContaining(['page', 'limit', 'sort', 'listGroup']));
  });
});

describe('body nhật ký (05 §2.6)', () => {
  it('bỏ trường rỗng (backend @OptionalNotNull + forbidNonWhitelisted), giữ lịch hẹn kèm theo', () => {
    expect(buildCareLogBody({ content: 'a', contactChannel: 'CALL', contactResultId: null, attachmentIds: [], nextAction: { suggestion: '  ', dueAt: null } })).toEqual({ content: 'a', contactChannel: 'CALL' });
    const full = buildCareLogBody({ content: 'a', contactChannel: 'ZALO', contactResultId: 'r1', attachmentIds: ['x'], nextAction: { suggestion: ' Gọi lại ', dueAt: '2026-10-30T02:00:00.000Z', appointment: { type: 'CALLBACK' } } });
    expect(full).toEqual({
      content: 'a',
      contactChannel: 'ZALO',
      contactResultId: 'r1',
      attachmentIds: ['x'],
      nextAction: { suggestion: 'Gọi lại', dueAt: '2026-10-30T02:00:00.000Z', appointment: { type: 'CALLBACK' } },
    });
  });
});
