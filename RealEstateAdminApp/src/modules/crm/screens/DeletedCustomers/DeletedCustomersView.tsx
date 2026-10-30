/**
 * Màn "Khách đã xóa" (Sửa đổi D — chỉ Quản trị; `CrmLayout` chặn vai trò khác). Dùng chung desktop + mobile.
 * Danh sách phân trang (có tìm) khách đã xóa mềm: Khôi phục (xác nhận nhẹ) hoặc Xóa vĩnh viễn (xác nhận 2 bước, không hoàn tác).
 * Sau mỗi thao tác ghi, danh sách khách/đếm/khách đã xóa được làm mới bởi lớp API (`crmKeys.data`).
 */
import { useId, useState } from 'react';
import { RotateCcw, Search, Trash2 } from 'lucide-react';
import { useCrmApi, useDeletedCustomers, type DeletedCustomerItem, type PurgeResult } from '@crm/api';
import { DialogFrame } from '@crm/components/DialogFrame';
import { CrmModuleTabs } from '@crm/components/CrmModuleTabs';
import { TextInput } from '@crm/components/form/TextInput';
import { useDebouncedValue } from '@crm/hooks/useDebouncedValue';
import { describePurgeError, describeRestoreError, getPageAfterRemoval, isPurgeAlreadyDone } from '@crm/lib/customerDeletion';
import { formatVnDateTime } from '@crm/lib/dateTime';
import { BUTTON_OUTLINE_CLASS, BUTTON_PRIMARY_CLASS, BUTTON_SOFT_SM_CLASS, CARD_CLASS, CHIP_SMALL_CLASS, CHIP_TONE_CLASS, DANGER_SOFT_SM_BUTTON_CLASS, MUTED_TEXT_CLASS, PAGE_DESCRIPTION_CLASS, PAGE_TITLE_CLASS, PAGE_TITLE_MOBILE_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import { Pagination } from '../../../../components/common/Pagination';
import { PurgeCustomerDialog } from './PurgeCustomerDialog';

const PAGE_SIZE = 10;

interface DeletedCustomersViewProps {
  variant: 'desktop' | 'mobile';
}

/** Tóm tắt số dữ liệu con đã xóa vĩnh viễn cho toast (chỉ nêu mục có số > 0). */
const summarizePurge = ({ purged }: PurgeResult): string => {
  const parts = [
    [purged.careLogs, 'nhật ký'],
    [purged.attachments, 'ảnh'],
    [purged.files, 'tệp'],
    [purged.appointments, 'lịch hẹn'],
    [purged.careTeamRequests, 'yêu cầu nhóm chăm sóc'],
    [purged.reminders, 'nhắc việc'],
  ]
    .filter(([count]) => Number(count) > 0)
    .map(([count, label]) => `${count} ${label}`);
  return `${parts.length > 0 ? `Đã dọn ${parts.join(', ')}. ` : ''}Số điện thoại đã được giải phóng.`;
};

export const DeletedCustomersView = ({ variant }: DeletedCustomersViewProps) => {
  const isDesktop = variant === 'desktop';
  const api = useCrmApi();
  const restoreDescriptionId = useId();
  const { showToast } = useCrmActions();
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const keyword = useDebouncedValue(searchText.trim(), 350);
  const { data, isLoading, isFetching, isError, error, refetch } = useDeletedCustomers({ page, limit, q: keyword || undefined });
  const [restoring, setRestoring] = useState<DeletedCustomerItem | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [purging, setPurging] = useState<DeletedCustomerItem | null>(null);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const [isPurging, setIsPurging] = useState(false);
  const { meta } = data;

  /** Khách vừa rời danh sách (khôi phục/xóa vĩnh viễn): nếu là khách duy nhất của trang thì lùi một trang. */
  const stepBackIfPageEmptied = () => setPage(getPageAfterRemoval(page, data.data.length));

  const confirmRestore = async () => {
    if (!restoring || isRestoring) return;
    const customer = restoring;
    setIsRestoring(true);
    setRestoreError(null);
    const result = await api.restoreCustomer(customer.id);
    setIsRestoring(false);
    if (!result.ok) {
      setRestoreError(describeRestoreError(result.error));
      return;
    }
    setRestoring(null);
    showToast({ title: `Đã khôi phục khách ${customer.fullName}`, message: 'Khách đã trở lại danh sách khách hàng.' });
    stepBackIfPageEmptied();
  };

  const confirmPurge = async () => {
    if (!purging || isPurging) return;
    const customer = purging;
    setIsPurging(true);
    setPurgeError(null);
    const result = await api.purgeDeletedCustomer(customer.id);
    setIsPurging(false);
    if (result.ok) {
      setPurging(null);
      showToast({ title: `Đã xóa vĩnh viễn khách ${customer.fullName}`, message: summarizePurge(result.data) });
      stepBackIfPageEmptied();
      return;
    }
    if (isPurgeAlreadyDone(result.error)) {
      // 404 ngay sau khi bấm = lần xóa trước đã hoàn tất: coi là xong (danh sách đã được làm mới).
      setPurging(null);
      showToast({ title: `Khách ${customer.fullName} đã được xóa vĩnh viễn`, message: 'Danh sách đã được làm mới.' });
      stepBackIfPageEmptied();
      return;
    }
    // 503 (kho tệp lỗi, chưa xóa gì) và các lỗi khác: giữ hộp mở để bấm thử lại.
    setPurgeError(describePurgeError(result.error));
  };

  const openRestore = (customer: DeletedCustomerItem) => {
    setRestoreError(null);
    setRestoring(customer);
  };

  const openPurge = (customer: DeletedCustomerItem) => {
    setPurgeError(null);
    setPurging(customer);
  };

  return (
    // `data-focus-fallback`: đóng hộp khi hàng vừa thao tác đã biến mất thì tiêu điểm về vùng này (không rơi về BODY).
    <div data-focus-fallback tabIndex={-1} className="flex w-full flex-col gap-6 outline-none">
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-2">
          <h2 className={isDesktop ? PAGE_TITLE_CLASS : PAGE_TITLE_MOBILE_CLASS}>Khách đã xóa</h2>
          <p className={`${PAGE_DESCRIPTION_CLASS} max-w-2xl`}>Khách bị xóa mềm. Khôi phục để đưa khách trở lại danh sách, hoặc xóa vĩnh viễn (không hoàn tác, giải phóng số điện thoại).</p>
        </header>
        {isDesktop && <CrmModuleTabs />}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <TextInput
          icon={Search}
          value={searchText}
          placeholder="Tìm theo tên hoặc số điện thoại"
          aria-label="Tìm khách đã xóa"
          wrapperClassName="sm:w-80"
          onChange={(event) => {
            setSearchText(event.target.value);
            setPage(1);
          }}
        />
        <p className={MUTED_TEXT_CLASS}>{meta.total} khách đã xóa</p>
      </div>

      {isLoading && <div aria-busy="true" aria-label="Đang tải khách đã xóa" className="h-40 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800" />}
      {isError && (
        <div role="alert" className={`${CARD_CLASS} flex flex-col items-start gap-3 p-5`}>
          <p className="text-theme-sm text-gray-700 dark:text-gray-300">{error?.message}</p>
          <button type="button" onClick={refetch} className={BUTTON_OUTLINE_CLASS}>
            Thử lại
          </button>
        </div>
      )}
      {!isLoading && !isError && data.data.length === 0 && (
        <p className={`${CARD_CLASS} p-8 text-center ${MUTED_TEXT_CLASS}`}>{keyword ? 'Không có khách đã xóa nào khớp từ khóa.' : 'Chưa có khách nào bị xóa.'}</p>
      )}

      {data.data.length > 0 && (
        <ul aria-label="Danh sách khách đã xóa" className={`${CARD_CLASS} divide-y divide-gray-100 dark:divide-white/[0.05] ${isFetching && !isLoading ? 'opacity-70' : ''}`}>
          {data.data.map((customer) => (
            <li key={customer.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="[overflow-wrap:anywhere] text-sm font-semibold text-gray-800 dark:text-white/90">{customer.fullName}</p>
                  <span className="text-theme-sm text-gray-500 dark:text-gray-400">{customer.phoneMasked}</span>
                  {customer.anonymizedAt && <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.gray}`}>Đã ẩn danh hóa</span>}
                  {customer.purgeInProgress && <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.warning}`}>Đang xóa dở — bấm Xóa vĩnh viễn để hoàn tất</span>}
                </div>
                <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                  Xóa lúc {formatVnDateTime(customer.deletedAt)} · bởi {customer.deletedBy?.displayName ?? 'Hệ thống'}
                </p>
                <p className="[overflow-wrap:anywhere] text-theme-xs text-gray-600 dark:text-gray-400">
                  {customer.deleteReason ? `Lý do: ${customer.deleteReason}` : customer.anonymizedAt ? 'Lý do xóa đã được ẩn cùng dữ liệu cá nhân.' : 'Không ghi lý do.'}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => openRestore(customer)}
                  disabled={Boolean(customer.anonymizedAt) || customer.purgeInProgress}
                  title={customer.anonymizedAt ? 'Khách đã ẩn danh hóa nên không khôi phục được' : customer.purgeInProgress ? 'Khách đang xóa vĩnh viễn dở dang nên không khôi phục được' : undefined}
                  aria-label={`Khôi phục ${customer.fullName}`}
                  className={`${BUTTON_SOFT_SM_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <RotateCcw size={12} aria-hidden="true" />
                  Khôi phục
                </button>
                <button type="button" onClick={() => openPurge(customer)} aria-label={`Xóa vĩnh viễn ${customer.fullName}`} className={DANGER_SOFT_SM_BUTTON_CLASS}>
                  <Trash2 size={12} aria-hidden="true" />
                  Xóa vĩnh viễn
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {meta.totalPages > 0 && (
        <Pagination
          meta={meta}
          onPageChange={setPage}
          onLimitChange={(next) => {
            setLimit(next);
            setPage(1);
          }}
          isDisabled={isFetching}
          itemLabel="khách"
        />
      )}

      <DialogFrame isOpen={restoring !== null} title={`Khôi phục khách ${restoring?.fullName ?? ''}?`} describedById={restoreDescriptionId} onClose={() => (isRestoring ? undefined : setRestoring(null))}>
        <p id={restoreDescriptionId} className="text-theme-sm leading-relaxed text-gray-600 dark:text-gray-400">
          Khách sẽ trở lại danh sách khách hàng với tình trạng trước khi xóa.
        </p>
        {restoreError && (
          <p role="alert" className="rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700 dark:bg-error-500/10 dark:text-error-400">
            {restoreError}
          </p>
        )}
        <div className="flex justify-end gap-3 pt-1">
          <button type="button" onClick={() => setRestoring(null)} disabled={isRestoring} className={BUTTON_OUTLINE_CLASS}>
            Huỷ
          </button>
          <button type="button" data-autofocus onClick={() => void confirmRestore()} disabled={isRestoring} className={BUTTON_PRIMARY_CLASS}>
            {isRestoring ? 'Đang khôi phục…' : 'Khôi phục'}
          </button>
        </div>
      </DialogFrame>
      <PurgeCustomerDialog customer={purging} isSubmitting={isPurging} error={purgeError} onConfirm={() => void confirmPurge()} onCancel={() => setPurging(null)} />
    </div>
  );
};
