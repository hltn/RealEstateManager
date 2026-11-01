/**
 * Bản MOCK còn lại của lớp truy cập dữ liệu CRM — CHỈ cho phần giai đoạn 2 (M8) chưa có API: nhập file và xuất file,
 * chạy trên store Zustand trong trình duyệt với DỮ LIỆU MẪU (bật bằng cờ `VITE_CRM_MOCK_IMPORT_EXPORT`, xem `config/featureFlags.ts`).
 * Mọi thao tác nghiệp vụ khác (khách, chăm sóc, lịch hẹn, danh mục...) đã chuyển sang API thật ở `httpCrmApi.ts`.
 * Quy ước kết quả: `{ ok: true, data }` hoặc `{ ok: false, error: { statusCode, errorCode, message } }`. Gỡ file này khi M8 xong.
 */
import { buildCareTeam, buildSearchText, createEmptyCriteria, getDefaultStatus, getPrimaryUserId } from '@crm/lib/customerRules';
import { createId } from '@crm/lib/id';
import { checkImportLimits } from '@crm/lib/importCustomers';
import { normalizePhone } from '@crm/lib/phone';
import type { CrmAction, CrmState } from '@crm/store/crmReducer';
import { selectCurrentUser } from '@crm/store/selectors';
import type { AuditLog, Customer } from '@crm/types/crm';
import { buildActor, canExportCustomers, canImportCustomers, type CrmActor } from './access';
import { buildCustomerExport, type CustomerExportFile } from './exports';
import { lookupPhone } from './queries';
import type { ApiResult, CustomerListQuery } from './types';

export interface MockCrmApiDependencies {
  getState: () => CrmState;
  dispatch: (action: CrmAction) => void;
  now?: () => Date;
  generateId?: (prefix: string) => string;
}

export interface ImportCustomerRow {
  fullName: string;
  phone: string;
  statusId?: string;
  sourceId?: string | null;
  interestedProjectIds?: string[];
  areaId?: string | null;
  primaryUserId?: string | null;
  notes?: string;
}

/** Trường nhập của dự án (không gồm id) — dùng ở `lib/projectRules`. */
export type ProjectInput = Omit<import('@crm/types/crm').Project, 'id' | 'isActive' | 'deletedAt'> & { isActive?: boolean };

const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data });
const fail = <T>(statusCode: number, errorCode: string, message: string): ApiResult<T> => ({ ok: false, error: { statusCode, errorCode, message } });

export const createMockCrmApi = ({ getState, dispatch, now = () => new Date(), generateId = createId }: MockCrmApiDependencies) => {
  const getActor = (): CrmActor => {
    const state = getState();
    return buildActor(selectCurrentUser(state), state.teams);
  };

  return {
    /** Xuất CSV (mô phỏng `POST /crm/customer-exports`): chỉ Quản trị/Quản lý; áp bộ lọc + phạm vi; ghi 1 audit mỗi lần xuất. */
    createCustomerExport: (query: CustomerListQuery): ApiResult<CustomerExportFile> => {
      const actor = getActor();
      if (!canExportCustomers(actor.role)) return fail(403, 'INSUFFICIENT_ROLE', 'Chỉ Quản trị/Quản lý được xuất danh sách khách.');
      const file = buildCustomerExport(getState(), actor, query, now());
      const user = getState().users.find((item) => item.id === actor.userId);
      const log: AuditLog = {
        id: generateId('AUD'),
        action: 'CUSTOMER_EXPORTED',
        entityType: 'CUSTOMER_EXPORT',
        entityId: null,
        actorId: actor.userId,
        actorName: user?.displayName ?? 'Hệ thống',
        actorRole: actor.role,
        changes: [
          { field: 'Số khách xuất', from: '', to: String(file.rowCount) },
          { field: 'Tệp', from: '', to: file.fileName },
        ],
        createdAt: now().toISOString(),
      };
      dispatch({ type: 'auditLogs/add', log });
      return ok(file);
    },

    /** Nhập khách từ file đã xem trước + xác nhận (mô phỏng job `customer-imports`). Chỉ Quản trị. */
    importCustomers: (rows: ImportCustomerRow[]): ApiResult<{ created: number; skipped: { row: number; message: string }[] }> => {
      const actor = getActor();
      if (!canImportCustomers(actor.role)) return fail(403, 'INSUFFICIENT_ROLE', 'Chỉ Quản trị được nhập dữ liệu.');
      const limitError = checkImportLimits(0, rows.length);
      if (limitError) return fail(400, 'IMPORT_TOO_LARGE', limitError);
      const skipped: { row: number; message: string }[] = [];
      let created = 0;
      rows.forEach((row, index) => {
        const state = getState();
        const { catalogs } = state;
        const phone = normalizePhone(row.phone);
        if (!row.fullName.trim() || !phone) {
          skipped.push({ row: index + 1, message: 'Thiếu họ tên hoặc số điện thoại không hợp lệ.' });
          return;
        }
        if (lookupPhone(state, actor, phone)?.exists) {
          skipped.push({ row: index + 1, message: 'Số điện thoại đã có trong hệ thống.' });
          return;
        }
        const isHidden =
          (row.statusId && !catalogs.statuses.some((item) => item.id === row.statusId && item.isActive)) ||
          (row.sourceId && !catalogs.leadSources.some((item) => item.id === row.sourceId && item.isActive)) ||
          (row.areaId && !catalogs.areas.some((item) => item.id === row.areaId && item.isActive)) ||
          (row.interestedProjectIds ?? []).some((id) => !catalogs.projects.some((item) => item.id === id && item.isActive));
        if (isHidden) {
          skipped.push({ row: index + 1, message: 'Danh mục (tình trạng/nguồn/khu vực/dự án) không tồn tại hoặc đã ngừng dùng.' });
          return;
        }
        const timestamp = now().toISOString();
        const careTeam = buildCareTeam(row.primaryUserId ?? null, [], actor.userId, timestamp);
        const fullName = row.fullName.trim();
        const customer: Customer = {
          id: generateId('CUST'),
          fullName,
          phone,
          email: '',
          statusId: (row.statusId || getDefaultStatus(catalogs.statuses)?.id) ?? '',
          statusChangedAt: timestamp,
          sourceId: row.sourceId ?? null,
          interestedProjectIds: [...new Set(row.interestedProjectIds ?? [])],
          areaId: row.areaId ?? null,
          tagIds: [],
          nationalIdLast4: null,
          hasNationalId: false,
          criteria: createEmptyCriteria(),
          careTeam,
          primaryAssigneeId: getPrimaryUserId(careTeam),
          persona: [],
          occasions: [],
          personaCompleteness: 0,
          shouldRemindOccasions: true,
          notes: row.notes?.trim() ?? '',
          lastCareLogAt: null,
          nextAppointmentAt: null,
          searchText: buildSearchText({ fullName, phone }),
          createdAt: timestamp,
          createdBy: actor.userId,
          createdVia: 'IMPORT',
          lastUpdatedAt: timestamp,
          lastUpdatedBy: actor.userId,
          version: 1,
        };
        dispatch({ type: 'customers/create', customer, meta: { actorId: actor.userId, now: timestamp, changeLogId: generateId('CHG'), source: 'IMPORT' }, action: 'CUSTOMER_IMPORTED' });
        created += 1;
      });
      return ok({ created, skipped });
    },
  };
};

export type MockCrmApi = ReturnType<typeof createMockCrmApi>;
