// "Lịch sử thay đổi" của khách (X4, `GET /crm/customers/:id/histories`): ai, lúc nào, đổi gì (cũ -> mới).
// Gồm mọi lần đổi tình trạng, người chăm sóc, tiêu chí, chân dung. Mục xem CCCD chỉ Quản lý/Quản trị thấy.
import { History } from 'lucide-react';
import { useCustomerHistories } from '@crm/api';
import { formatVnDateTime } from '@crm/lib/dateTime';
import { CARD_CLASS, CHIP_SMALL_CLASS, CHIP_TONE_CLASS, INSET_CLASS, MUTED_TEXT_CLASS } from '@crm/lib/uiClasses';
import type { ChangeAction } from '@crm/types/crm';
import { CardHeading } from './DetailParts';

const CHANGE_ACTION_LABELS: Record<ChangeAction, string> = {
  CUSTOMER_CREATED: 'Tạo khách',
  CUSTOMER_UPDATED: 'Sửa hồ sơ',
  STATUS_CHANGED: 'Đổi tình trạng',
  CRITERIA_UPDATED: 'Cập nhật tiêu chí',
  PERSONA_UPDATED: 'Cập nhật chân dung',
  CARE_TEAM_MEMBER_ADDED: 'Thêm người chăm sóc',
  CARE_TEAM_MEMBER_REMOVED: 'Gỡ người chăm sóc',
  PRIMARY_CHANGED: 'Đổi phụ trách chính',
  NATIONAL_ID_UPDATED: 'Cập nhật CCCD',
  NATIONAL_ID_VIEWED: 'Xem CCCD đầy đủ',
  PHONE_VIEWED: 'Xem số điện thoại đầy đủ',
  CARE_LOG_CREATED: 'Ghi nhật ký',
  FOLLOW_UP_COMPLETED: 'Hoàn thành bước tiếp theo',
  APPOINTMENT_CREATED: 'Tạo lịch hẹn',
  APPOINTMENT_UPDATED: 'Cập nhật lịch hẹn',
  JOIN_REQUEST_CREATED: 'Đề nghị tham gia nhóm',
  JOIN_REQUEST_RESOLVED: 'Xử lý đề nghị tham gia',
  CUSTOMER_IMPORTED: 'Nhập từ file',
};

interface HistoryListProps {
  customerId: string;
  isFramed?: boolean;
}

export const HistoryList = ({ customerId, isFramed = true }: HistoryListProps) => {
  const { data: entries } = useCustomerHistories(customerId);

  const list =
    entries.length === 0 ? (
      <p className={`py-6 text-center ${MUTED_TEXT_CLASS}`}>Chưa có thay đổi nào được ghi lại.</p>
    ) : (
      <ol className="space-y-3">
        {entries.map((entry) => (
          <li key={entry.id} className={`${INSET_CLASS} space-y-1.5 p-3`}>
            <div className="flex flex-wrap items-center gap-2 text-theme-xs">
              <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.brand}`}>{CHANGE_ACTION_LABELS[entry.action]}</span>
              <span className="font-semibold text-gray-800 dark:text-white/90">{entry.actor.displayName}</span>
              <time dateTime={entry.createdAt} className="text-gray-500 dark:text-gray-400">
                {formatVnDateTime(entry.createdAt)}
              </time>
              {entry.source === 'IMPORT' && <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.gray}`}>Nhập file</span>}
            </div>
            {(entry.changes ?? []).length > 0 && (
              <ul className="space-y-0.5 text-theme-xs text-gray-600 dark:text-gray-400">
                {(entry.changes ?? []).map((change, index) => (
                  <li key={`${change.field}-${index}`}>
                    <span className="font-medium text-gray-700 dark:text-gray-300">{change.field}:</span>{' '}
                    {change.from ? (
                      <>
                        <span className="line-through decoration-gray-400">{change.from}</span> → <span>{change.to}</span>
                      </>
                    ) : (
                      change.to
                    )}
                  </li>
                ))}
              </ul>
            )}
            {entry.reason && <p className="text-theme-xs italic text-gray-500">Lý do: {entry.reason}</p>}
          </li>
        ))}
      </ol>
    );

  if (!isFramed) return list;
  return (
    <section aria-label="Lịch sử thay đổi" className={`${CARD_CLASS} space-y-4 p-5`}>
      <CardHeading icon={History} title="Lịch sử thay đổi" as="h3" />
      {list}
    </section>
  );
};
