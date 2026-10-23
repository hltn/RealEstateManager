import { Types } from 'mongoose';
import { CrmAuditChange } from '../../audit-logs/crm-audit.constants';
import { maskPhone } from '../../common/utils/phone-normalizer.util';
import type { RefMaps } from '../customer-refs.service';

export interface ProfileSnapshot {
  fullName: string | null;
  phone: string | null;
  email: string | null;
  sourceId: Types.ObjectId | null;
  areaId: Types.ObjectId | null;
  interestedProjectIds: Types.ObjectId[];
}

export const EMPTY_PROFILE: ProfileSnapshot = {
  fullName: null,
  phone: null,
  email: null,
  sourceId: null,
  areaId: null,
  interestedProjectIds: [],
};

const sameIds = (a: Types.ObjectId[], b: Types.ObjectId[]): boolean =>
  a.length === b.length &&
  [...a].map(String).sort().join(',') === [...b].map(String).sort().join(',');

/**
 * Các thay đổi hồ sơ cơ bản cho audit (`changes` lưu GIÁ TRỊ trường — tài liệu 04 mục 7.3, quyết định #34):
 * họ tên/email/SĐT cũ -> mới ĐẦY ĐỦ khi SỬA hồ sơ; danh mục (nguồn, khu vực, dự án) ghi bằng nhãn cho dễ đọc.
 *
 * Riêng lúc TẠO (`maskPhoneValue = true`) SĐT được che: tài liệu không quy định ghi số đầy đủ cho sự kiện tạo, và
 * ghi đầy đủ sẽ cho người chỉ được xem lịch sử đọc được số mà không để lại `PHONE_VIEWED`.
 * CCCD không bao giờ nằm trong `changes`.
 */
export const buildProfileChanges = (
  before: ProfileSnapshot,
  after: ProfileSnapshot,
  refs: RefMaps,
  maskPhoneValue = false,
): CrmAuditChange[] => {
  const changes: CrmAuditChange[] = [];
  const scalar = (field: 'fullName' | 'phone' | 'email') => {
    if (before[field] === after[field]) return;
    const show = (value: string | null) =>
      field === 'phone' && maskPhoneValue && value ? maskPhone(value) : value;
    changes.push({ field, from: show(before[field]), to: show(after[field]) });
  };
  scalar('fullName');
  scalar('phone');
  scalar('email');

  if (String(before.sourceId ?? '') !== String(after.sourceId ?? '')) {
    changes.push({
      field: 'source',
      from: before.sourceId
        ? (refs.sources.get(String(before.sourceId)) ?? null)
        : null,
      to: after.sourceId
        ? (refs.sources.get(String(after.sourceId)) ?? null)
        : null,
    });
  }
  if (String(before.areaId ?? '') !== String(after.areaId ?? '')) {
    changes.push({
      field: 'area',
      from: before.areaId
        ? (refs.areas.get(String(before.areaId)) ?? null)
        : null,
      to: after.areaId ? (refs.areas.get(String(after.areaId)) ?? null) : null,
    });
  }
  if (!sameIds(before.interestedProjectIds, after.interestedProjectIds)) {
    const labels = (ids: Types.ObjectId[]) =>
      ids.map((id) => refs.projects.get(String(id)) ?? String(id));
    changes.push({
      field: 'projects',
      from: labels(before.interestedProjectIds),
      to: labels(after.interestedProjectIds),
    });
  }
  return changes;
};
