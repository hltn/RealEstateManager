/**
 * "Hành động hàng loạt" của bảng khách (02 §4.2, `POST /crm/customer-bulk-operations`):
 * đổi tình trạng, gắn thẻ, thêm thành viên phụ vào nhóm chăm sóc (Quản lý/Quản trị; không còn đặt PRIMARY hàng loạt), XÓA khách "Bỏ" (Sửa đổi D: chỉ hiện khi mọi khách chọn thuộc "Bỏ" và có thể xóa),
 * xuất CSV các dòng đã chọn (chỉ khi bật mock xuất file, M8).
 * Backend xử lý đồng bộ, mỗi khách một transaction: khách lỗi không kéo khách khác (trả `succeeded` + `failed`).
 */
import { useEffect, useState } from 'react';
import { CheckSquare, X } from 'lucide-react';
import { canBulkAssign, canExportCustomers, useCatalogs, useCrmActor, useCrmApi, type BulkResult, type CareTeamInvitee, type CustomerListItem } from '@crm/api';
import { useCustomerExport } from '@crm/api/mockHooks';
import { CareTeamInvitePicker } from '@crm/components/CareTeamInvitePicker';
import { ConfirmDialog } from '@crm/components/ConfirmDialog';
import { DeleteReasonDialog } from '@crm/components/DeleteReasonDialog';
import { CRM_FEATURE_FLAGS } from '@crm/config/featureFlags';
import { describeBulkAssignError, MAX_CARE_TEAM_MEMBERS } from '@crm/lib/careTeamRules';
import { BULK_DELETE_LIMIT, canOfferBulkDelete, describeDeleteBatchError } from '@crm/lib/customerDeletion';
import { isDroppedStatus } from '@crm/lib/customerRules';
import { groupTagsByCategory } from '@crm/lib/tagCategories';
import { downloadCsv } from '@crm/lib/csv';
import { BUTTON_PRIMARY_CLASS, DANGER_BUTTON_CLASS, FILTER_INPUT_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';

type BulkKind = '' | 'CHANGE_STATUS' | 'ADD_TAGS' | 'ASSIGN' | 'DELETE' | 'EXPORT';

interface BulkActionBarProps {
  selectedIds: string[];
  onClear: () => void;
  /** Bỏ chọn riêng các khách này (vd khách đã xóa thành công; khách lỗi vẫn được giữ chọn). */
  onDeselect: (customerIds: string[]) => void;
  /**
   * Có khách xóa lỗi: báo kết quả theo từng khách cho CẤP DANH SÁCH hiển thị (hộp kết quả không nằm trong thanh này vì thanh có thể
   * biến mất khi mọi khách còn lại đều đã bị bỏ chọn).
   */
  onDeleteResult: (result: BulkResult) => void;
  /** Dòng khách (từ các trang đã tải) của khách đã chọn: Hoàn tác đổi tình trạng, xét quyền Xóa, tên khách trong kết quả. */
  getCustomer: (customerId: string) => CustomerListItem | undefined;
}

/** Lý do khách không áp dụng được cho đổi tình trạng / gắn thẻ (thêm thành viên dùng `describeBulkAssignError`). */
const ERROR_NOTES: Record<string, string> = {
  CUSTOMER_NOT_FOUND: 'không còn trong phạm vi của bạn',
  CARE_TEAM_ACTION_FORBIDDEN: 'bạn không có quyền với khách này',
  VALIDATION_FAILED: 'dữ liệu không hợp lệ (vd vượt 30 thẻ/khách)',
};

export const BulkActionBar = ({ selectedIds, onClear, onDeselect, onDeleteResult, getCustomer }: BulkActionBarProps) => {
  const api = useCrmApi();
  const actor = useCrmActor();
  const exportCustomers = useCustomerExport();
  const { catalogs } = useCatalogs();
  const { showToast } = useCrmActions();
  const [selectedKind, setSelectedKind] = useState<BulkKind>('');
  const [value, setValue] = useState('');
  /** Người được chọn để thêm vào nhóm chăm sóc (hành động "Thêm thành viên"). */
  const [assignees, setAssignees] = useState<CareTeamInvitee[]>([]);
  /** Kết quả thêm thành viên THEO TỪNG KHÁCH khi có khách lỗi (hết hạn mức 10, chưa có PRIMARY...). */
  const [assignFailures, setAssignFailures] = useState<BulkResult['failed']>([]);
  // Kết quả lỗi chỉ còn hiệu lực với khách VẪN đang chọn (bỏ chọn khách lỗi thì dòng báo của khách đó biến mất); riêng `CUSTOMER_NOT_FOUND`
  // đã tự bị bỏ chọn từ lúc báo nên vẫn giữ trong kết quả cho tới khi đổi hành động / người được chọn.
  const visibleAssignFailures = assignFailures.filter((item) => item.errorCode === 'CUSTOMER_NOT_FOUND' || selectedIds.includes(item.customerId));
  const [isConfirmingDrop, setIsConfirmingDrop] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const canDelete = canOfferBulkDelete(actor, selectedIds.map(getCustomer));
  // Đổi lựa chọn khách làm mất quyền xóa thì hành động Xóa tự về "chưa chọn" (không để select trỏ vào option đã biến mất).
  const kind: BulkKind = selectedKind === 'DELETE' && !canDelete ? '' : selectedKind;
  // Option Xóa biến mất thì xóa luôn lựa chọn đã lưu: không để "Xóa" tự bật lại im lặng khi tập khách chọn đủ điều kiện trở lại.
  useEffect(() => {
    if (selectedKind === 'DELETE' && !canDelete) setSelectedKind('');
  }, [selectedKind, canDelete]);
  const isOverDeleteLimit = kind === 'DELETE' && selectedIds.length > BULK_DELETE_LIMIT;
  const needsValue = kind === 'CHANGE_STATUS' || kind === 'ADD_TAGS';
  const isMissingValue = kind === 'ASSIGN' ? assignees.length === 0 : needsValue && !value;
  /** Đổi người được chọn = bắt đầu lượt thêm mới, kết quả lỗi của lượt trước hết giá trị. */
  const changeAssignees = (next: CareTeamInvitee[]) => {
    setAssignees(next);
    setAssignFailures([]);
  };
  const canExport = canExportCustomers(actor.role) && CRM_FEATURE_FLAGS.isMockImportExportEnabled;

  const valueOptions =
    kind === 'CHANGE_STATUS'
      ? catalogs.statuses.filter((status) => status.isActive).map((status) => ({ value: status.id, label: status.label }))
      : [];
  // Gắn thẻ: gom theo nhóm (Sở thích, Nghề nghiệp, Khác) bằng `<optgroup>` (FR-48).
  const tagGroups = kind === 'ADD_TAGS' ? groupTagsByCategory(catalogs.tags.filter((tag) => tag.isActive)) : [];

  const finish = () => {
    setSelectedKind('');
    setValue('');
    setAssignees([]);
    setAssignFailures([]);
    onClear();
  };

  /** Hoàn tác đổi tình trạng hàng loạt: trả từng khách về tình trạng cũ (gom theo tình trạng). */
  const undoStatusChange = async (previousStatusIds: Record<string, string>) => {
    const byStatus = new Map<string, string[]>();
    Object.entries(previousStatusIds).forEach(([customerId, statusId]) => byStatus.set(statusId, [...(byStatus.get(statusId) ?? []), customerId]));
    const results = await Promise.all([...byStatus].map(([statusId, customerIds]) => api.bulkOperation({ type: 'CHANGE_STATUS', customerIds, statusId })));
    const failedResult = results.find((result) => !result.ok);
    showToast(failedResult && !failedResult.ok ? { type: 'error', title: failedResult.error.message } : { title: `Đã hoàn tác ${Object.keys(previousStatusIds).length} khách` });
  };

  const run = async () => {
    setIsRunning(true);
    const previousStatusIds: Record<string, string> = {};
    selectedIds.forEach((id) => {
      const statusId = getCustomer(id)?.status.id;
      if (statusId) previousStatusIds[id] = statusId;
    });
    const result =
      kind === 'CHANGE_STATUS'
        ? await api.bulkOperation({ type: 'CHANGE_STATUS', customerIds: selectedIds, statusId: value })
        : kind === 'ADD_TAGS'
          ? await api.bulkOperation({ type: 'ADD_TAGS', customerIds: selectedIds, tagIds: [value] })
          : await api.bulkOperation({ type: 'ASSIGN', customerIds: selectedIds, memberIds: assignees.map((invitee) => invitee.id) });
    setIsRunning(false);
    if (!result.ok) {
      showToast({ type: 'error', title: result.error.message });
      return;
    }
    const { succeeded, failed } = result.data;
    const failedReasons = [...new Set(failed.map((item) => (kind === 'ASSIGN' ? describeBulkAssignError(item.errorCode) : ERROR_NOTES[item.errorCode])).filter(Boolean))];
    const notes = failed.length > 0 ? [`${failed.length} khách không áp dụng được${failedReasons.length > 0 ? ` (${failedReasons.join('; ')})` : ''}`] : [];
    const undoable = Object.fromEntries(Object.entries(previousStatusIds).filter(([id]) => succeeded.includes(id)));
    showToast({
      type: succeeded.length === 0 ? 'error' : 'success',
      title: `Đã áp dụng cho ${succeeded.length} khách`,
      message: notes.length > 0 ? `${notes.join('; ')}.` : undefined,
      action: kind === 'CHANGE_STATUS' && Object.keys(undoable).length > 0 ? { label: 'Hoàn tác', onClick: () => void undoStatusChange(undoable) } : undefined,
      durationMs: kind === 'CHANGE_STATUS' ? 8000 : undefined,
    });
    if (failed.length === 0) {
      finish();
      return;
    }
    if (kind === 'ASSIGN') {
      // Kết quả theo từng khách; khách đã thêm xong hoặc không còn trong phạm vi được bỏ chọn, khách lỗi giữ chọn để xử lý tiếp.
      setAssignFailures(failed);
      onDeselect([...succeeded, ...failed.filter((item) => item.errorCode === 'CUSTOMER_NOT_FOUND').map((item) => item.customerId)]);
    }
  };

  const apply = () => {
    if (!kind || isMissingValue || isRunning || isOverDeleteLimit) return;
    if (kind === 'DELETE') {
      setDeleteError(null);
      setIsDeleteOpen(true);
      return;
    }
    if (kind === 'EXPORT') {
      const result = exportCustomers({ listGroup: 'ALL', customerIds: selectedIds, limit: selectedIds.length });
      if (!result.ok) {
        showToast({ type: 'error', title: result.error.message });
        return;
      }
      const file = result.data;
      downloadCsv(file.fileName, file.content);
      showToast({ title: `Đã xuất ${file.rowCount} khách ra CSV (dữ liệu mẫu)`, message: 'CCCD chỉ ghi 4 số cuối.' });
      return;
    }
    // Chuyển nhiều khách sang nhóm "Bỏ" phải xác nhận như ở màn chi tiết (02 §5).
    if (kind === 'CHANGE_STATUS' && isDroppedStatus(catalogs.statuses.find((status) => status.id === value))) {
      setIsConfirmingDrop(true);
      return;
    }
    void run();
  };

  /** Xóa mềm các khách đã chọn với một lý do chung; kết quả theo từng khách, khách lỗi vẫn được giữ chọn. */
  const runDelete = async (reason: string) => {
    setIsRunning(true);
    setDeleteError(null);
    const result = await api.bulkOperation({ type: 'DELETE', customerIds: selectedIds, reason });
    setIsRunning(false);
    if (!result.ok) {
      // Lỗi cả lô (vd quá 200 khách, lý do không hợp lệ): giữ hộp mở với lý do đã nhập để sửa/thử lại.
      setDeleteError(describeDeleteBatchError(result.error));
      return;
    }
    const { succeeded, failed } = result.data;
    setIsDeleteOpen(false);
    showToast({
      type: succeeded.length === 0 ? 'error' : 'success',
      title: `Đã xóa ${succeeded.length} khách${failed.length > 0 ? `, ${failed.length} khách không xóa được` : ''}`,
      message: succeeded.length > 0 ? 'Quản trị có thể khôi phục ở màn "Khách đã xóa".' : undefined,
    });
    if (failed.length === 0) {
      finish();
      return;
    }
    // Bỏ chọn khách đã xóa và khách không còn trong phạm vi (CUSTOMER_NOT_FOUND: không tồn tại/ngoài phạm vi, sẽ không có hàng nào); khách lỗi khác vẫn được giữ chọn.
    onDeselect([...succeeded, ...failed.filter((item) => item.errorCode === 'CUSTOMER_NOT_FOUND').map((item) => item.customerId)]);
    setSelectedKind('');
    onDeleteResult(result.data);
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-brand-100 bg-brand-50 p-3 sm:flex-row sm:flex-wrap sm:items-center dark:border-brand-500/25 dark:bg-brand-500/10">
      <span className="flex items-center gap-2 text-theme-sm font-medium text-brand-600 dark:text-brand-400">
        <CheckSquare size={16} aria-hidden="true" />
        Đã chọn {selectedIds.length} khách
      </span>
      <label htmlFor="bulk-action" className="sr-only">
        Hành động hàng loạt
      </label>
      <select
        id="bulk-action"
        value={kind}
        onChange={(event) => {
          setSelectedKind(event.target.value as BulkKind);
          setValue('');
          setAssignees([]);
          setAssignFailures([]);
        }}
        className={`${FILTER_INPUT_CLASS} dark:[color-scheme:dark]`}
      >
        <option value="">Hành động hàng loạt…</option>
        <option value="CHANGE_STATUS">Đổi tình trạng</option>
        <option value="ADD_TAGS">Gắn thẻ</option>
        {canBulkAssign(actor.role) && <option value="ASSIGN">Thêm thành viên</option>}
        {canDelete && <option value="DELETE">Xóa</option>}
        {canExport && <option value="EXPORT">Xuất CSV các dòng đã chọn</option>}
      </select>
      {needsValue && (
        <select value={value} onChange={(event) => setValue(event.target.value)} aria-label="Giá trị áp dụng" className={`${FILTER_INPUT_CLASS} dark:[color-scheme:dark]`}>
          <option value="">— Chọn —</option>
          {valueOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          {tagGroups.map((group) => (
            <optgroup key={group.category} label={group.title}>
              {group.tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  #{tag.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
      {kind === 'ASSIGN' && (
        <div className="w-full space-y-2 sm:basis-full">
          <p className="text-theme-xs text-gray-600 dark:text-gray-400">Chọn người để thêm vào nhóm chăm sóc của {selectedIds.length} khách (chỉ thêm thành viên phụ, không đổi người chăm sóc chính).</p>
          <CareTeamInvitePicker selected={assignees} onChange={changeAssignees} maxSelectable={MAX_CARE_TEAM_MEMBERS} isDisabled={isRunning} />
        </div>
      )}
      {visibleAssignFailures.length > 0 && (
        <section aria-label="Khách không thêm được thành viên" className="w-full space-y-1 sm:basis-full">
          <p className="text-theme-xs font-medium text-error-600 dark:text-error-400">{visibleAssignFailures.length} khách không thêm được thành viên:</p>
          <ul className="space-y-1 text-theme-xs text-gray-700 dark:text-gray-300">
            {visibleAssignFailures.map((item) => (
              <li key={item.customerId}>
                <strong className="font-medium">{getCustomer(item.customerId)?.fullName ?? 'Khách không rõ'}</strong>: {describeBulkAssignError(item.errorCode)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {isOverDeleteLimit && (
        <p role="alert" className="text-theme-xs font-medium text-error-600 dark:text-error-400">
          Mỗi lần chỉ xóa tối đa {BULK_DELETE_LIMIT} khách; bạn đang chọn {selectedIds.length}. Hãy bỏ bớt khách đã chọn.
        </p>
      )}
      <button type="button" onClick={apply} disabled={!kind || isMissingValue || isRunning || isOverDeleteLimit} className={`${kind === 'DELETE' ? DANGER_BUTTON_CLASS : BUTTON_PRIMARY_CLASS} h-10`}>
        {kind === 'DELETE' ? 'Xóa' : isRunning ? 'Đang áp dụng…' : 'Áp dụng'}
      </button>
      <button type="button" onClick={onClear} className="inline-flex items-center gap-1 text-theme-xs font-medium text-gray-600 hover:text-gray-800 sm:ml-auto dark:text-gray-400">
        <X size={14} aria-hidden="true" />
        Bỏ chọn
      </button>
      <DeleteReasonDialog
        isOpen={isDeleteOpen}
        title={`Xóa ${selectedIds.length} khách?`}
        description={
          <>
            <p>
              <strong>{selectedIds.length} khách</strong> thuộc danh sách Bỏ sẽ bị xóa khỏi mọi danh sách (xóa mềm). Quản trị có thể khôi phục hoặc xóa vĩnh viễn ở màn "Khách đã xóa".
            </p>
            <p className="mt-2">Hệ thống kiểm quyền từng khách: khách nào bạn không được xóa sẽ được báo riêng, các khách còn lại vẫn được xóa.</p>
          </>
        }
        confirmLabel={`Xóa ${selectedIds.length} khách`}
        isSubmitting={isRunning}
        error={deleteError}
        onCancel={() => setIsDeleteOpen(false)}
        onConfirm={(reason) => void runDelete(reason)}
      />
      <ConfirmDialog
        isOpen={isConfirmingDrop}
        tone="danger"
        title="Chuyển sang danh sách Bỏ?"
        description={`${selectedIds.length} khách sẽ chuyển sang tình trạng thuộc danh sách Bỏ. Bạn có thể Hoàn tác ngay sau đó.`}
        confirmLabel="Chuyển sang Bỏ"
        onCancel={() => setIsConfirmingDrop(false)}
        onConfirm={() => {
          setIsConfirmingDrop(false);
          void run();
        }}
      />
    </div>
  );
};
