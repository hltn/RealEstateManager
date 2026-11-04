// "Lịch sử thay đổi" của khách (X4, `GET /crm/customers/:id/histories`): ai, lúc nào, đổi gì (cũ -> mới).
// Gồm mọi lần đổi tình trạng, người chăm sóc, tiêu chí, chân dung. Mục xem CCCD chỉ Quản lý/Quản trị thấy.
// PT-021: dạng thu gọn (accordion, mobile) mặc định ĐÓNG và CHỈ gọi API khi người dùng mở; đóng lại vẫn giữ dữ liệu trong cache (không tải lại khi mở lại).
import { ChevronDown, History } from 'lucide-react';
import { useId, useState } from 'react';
import { useCustomerHistories, type HistoryEntry } from '@crm/api';
import { formatVnDateTime } from '@crm/lib/dateTime';
import { BUTTON_LINK_CLASS, CARD_CLASS, CARD_TITLE_CLASS, CHIP_SMALL_CLASS, CHIP_TONE_CLASS, INSET_CLASS, MUTED_TEXT_CLASS } from '@crm/lib/uiClasses';
import { CardHeading } from './DetailParts';

/** Nhãn mã hành động audit của backend (`crm-audit.constants.ts`); mã lạ hiển thị nguyên văn. */
const CHANGE_ACTION_LABELS: Record<string, string> = {
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
  NATIONAL_ID_REMOVED: 'Xóa CCCD',
  DATA_CONSENT_UPDATED: 'Cập nhật đồng ý xử lý dữ liệu',
  CUSTOMER_DELETED: 'Xóa khách',
  CUSTOMER_RESTORED: 'Khôi phục khách',
  CUSTOMER_ANONYMIZED: 'Ẩn danh hóa',
  CARE_LOG_UPDATED: 'Sửa nhật ký',
  CARE_LOG_DELETED: 'Xóa nhật ký',
  ATTACHMENT_UPLOADED: 'Tải ảnh đính kèm',
  ATTACHMENT_REMOVED: 'Gỡ ảnh đính kèm',
  TAGS_UPDATED: 'Cập nhật thẻ',
  APPOINTMENT_STATUS_CHANGED: 'Đổi trạng thái lịch hẹn',
  APPOINTMENT_DELETED: 'Xóa lịch hẹn',
};

/** PT-023: marker kỹ thuật BE ghi kèm khi tình trạng tự đổi theo tiến độ tiêu chí; không hiện tên field, chỉ hiện chip "Tự động theo tiến độ". */
const AUTO_SOURCE_FIELD = 'statusAutoSource';

interface HistoryEntryListProps {
  entries: HistoryEntry[];
}

const HistoryEntryList = ({ entries }: HistoryEntryListProps) =>
  entries.length === 0 ? (
    <p className={`py-6 text-center ${MUTED_TEXT_CLASS}`}>Chưa có thay đổi nào được ghi lại.</p>
  ) : (
    <ol className="space-y-3">
      {entries.map((entry) => {
        const allChanges = entry.changes ?? [];
        const isAutoByProgress = allChanges.some((change) => change.field === AUTO_SOURCE_FIELD && change.to !== '');
        const changes = allChanges.filter((change) => change.field !== AUTO_SOURCE_FIELD);
        return (
          <li key={entry.id} className={`${INSET_CLASS} space-y-1.5 p-3`}>
            <div className="flex flex-wrap items-center gap-2 text-theme-xs">
              <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.brand}`}>{CHANGE_ACTION_LABELS[entry.action] ?? entry.action}</span>
              <span className="font-semibold text-gray-800 dark:text-white/90">{entry.actor.displayName}</span>
              <time dateTime={entry.createdAt} className="text-gray-500 dark:text-gray-400">
                {formatVnDateTime(entry.createdAt)}
              </time>
              {entry.source === 'IMPORT' && <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.gray}`}>Nhập file</span>}
              {isAutoByProgress && <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.gray}`}>Tự động theo tiến độ</span>}
            </div>
            {changes.length > 0 && (
              <ul className="space-y-0.5 text-theme-xs text-gray-600 dark:text-gray-400">
                {changes.map((change, index) => (
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
        );
      })}
    </ol>
  );

interface HistoryListProps {
  customerId: string;
  /** Có khung thẻ + tiêu đề hay danh sách trần (nằm trong thẻ khác). */
  isFramed?: boolean;
  /**
   * Thu gọn mặc định (accordion, dùng ở mobile): CHỈ gọi API khi mở. `false` = luôn mở (desktop: đã nằm sau tab "Lịch sử thay đổi",
   * chỉ được dựng — tức mới gọi API — khi người dùng bấm tab).
   */
  isCollapsible?: boolean;
}

export const HistoryList = ({ customerId, isFramed = true, isCollapsible = false }: HistoryListProps) => {
  const [isOpen, setIsOpen] = useState(!isCollapsible);
  const panelId = useId();
  // `isOpen` điều khiển `enabled` của truy vấn: đóng thì không gọi mạng nhưng dữ liệu đã tải vẫn còn trong cache.
  const { data: entries, isLoading, isError, refetch } = useCustomerHistories(customerId, isOpen);

  const body = isLoading ? (
    <div aria-busy="true" aria-label="Đang tải lịch sử thay đổi" className="space-y-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="h-14 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
      ))}
    </div>
  ) : isError && entries.length === 0 ? (
    <div role="alert" className="space-y-2 py-4 text-center">
      <p className={MUTED_TEXT_CLASS}>Không tải được lịch sử thay đổi.</p>
      <button type="button" onClick={refetch} className={BUTTON_LINK_CLASS}>
        Thử lại
      </button>
    </div>
  ) : (
    <HistoryEntryList entries={entries} />
  );

  if (!isFramed) return body;

  if (!isCollapsible) {
    return (
      <section aria-label="Lịch sử thay đổi" className={`${CARD_CLASS} space-y-4 p-5`}>
        <CardHeading icon={History} title="Lịch sử thay đổi" as="h3" />
        {body}
      </section>
    );
  }

  return (
    <section aria-label="Lịch sử thay đổi" className={CARD_CLASS}>
      <h3>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => setIsOpen((isCurrentlyOpen) => !isCurrentlyOpen)}
          className="flex w-full items-center justify-between gap-3 p-5 text-left"
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400">
              <History size={18} aria-hidden="true" />
            </span>
            <span className={CARD_TITLE_CLASS}>Lịch sử thay đổi</span>
          </span>
          <ChevronDown size={18} aria-hidden="true" className={`shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </h3>
      {isOpen && (
        <div id={panelId} className="space-y-4 px-5 pb-5">
          {body}
        </div>
      )}
    </section>
  );
};
