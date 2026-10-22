/**
 * "Hành động hàng loạt" của bảng khách (02 §4.2, `POST /crm/customer-bulk-operations`):
 * đổi tình trạng, gắn thẻ, thêm người chăm sóc (Quản lý/Quản trị), xuất CSV các dòng đã chọn (Quản lý/Quản trị).
 */
import { useState } from 'react';
import { CheckSquare, X } from 'lucide-react';
import { canBulkAssign, canExportCustomers, useAssignableUsers, useCatalogs, useCrmActor, useCrmApi, useCustomerExport } from '@crm/api';
import { ConfirmDialog } from '@crm/components/ConfirmDialog';
import { isDroppedStatus } from '@crm/lib/customerRules';
import { downloadCsv } from '@crm/lib/csv';
import { BUTTON_PRIMARY_CLASS, FILTER_INPUT_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';

type BulkKind = '' | 'CHANGE_STATUS' | 'ADD_TAGS' | 'ASSIGN' | 'EXPORT';

interface BulkActionBarProps {
  selectedIds: string[];
  onClear: () => void;
}

export const BulkActionBar = ({ selectedIds, onClear }: BulkActionBarProps) => {
  const api = useCrmApi();
  const actor = useCrmActor();
  const exportCustomers = useCustomerExport();
  const { catalogs } = useCatalogs();
  const { data: assignableUsers } = useAssignableUsers();
  const { showToast } = useCrmActions();
  const [kind, setKind] = useState<BulkKind>('');
  const [value, setValue] = useState('');
  const [primaryUserId, setPrimaryUserId] = useState('');
  const [isConfirmingDrop, setIsConfirmingDrop] = useState(false);
  const needsValue = kind === 'CHANGE_STATUS' || kind === 'ADD_TAGS' || kind === 'ASSIGN';

  const valueOptions =
    kind === 'CHANGE_STATUS'
      ? catalogs.statuses.filter((status) => status.isActive).map((status) => ({ value: status.id, label: status.label }))
      : kind === 'ADD_TAGS'
        ? catalogs.tags.filter((tag) => tag.isActive).map((tag) => ({ value: tag.id, label: `#${tag.name}` }))
        : kind === 'ASSIGN'
          ? assignableUsers.map((user) => ({ value: user.id, label: user.fullName }))
          : [];

  const finish = () => {
    setKind('');
    setValue('');
    setPrimaryUserId('');
    onClear();
  };

  /** Hoàn tác đổi tình trạng hàng loạt: trả từng khách về tình trạng cũ (gom theo tình trạng). */
  const undoStatusChange = (previousStatusIds: Record<string, string>) => {
    const byStatus = new Map<string, string[]>();
    Object.entries(previousStatusIds).forEach(([customerId, statusId]) => byStatus.set(statusId, [...(byStatus.get(statusId) ?? []), customerId]));
    byStatus.forEach((customerIds, statusId) => api.bulkOperation({ type: 'CHANGE_STATUS', customerIds, statusId }));
    showToast({ title: `Đã hoàn tác ${Object.keys(previousStatusIds).length} khách` });
  };

  const run = () => {
    const result =
      kind === 'CHANGE_STATUS'
        ? api.bulkOperation({ type: 'CHANGE_STATUS', customerIds: selectedIds, statusId: value })
        : kind === 'ADD_TAGS'
          ? api.bulkOperation({ type: 'ADD_TAGS', customerIds: selectedIds, tagIds: [value] })
          : api.bulkOperation({ type: 'ASSIGN', customerIds: selectedIds, memberIds: [value], primaryUserId: primaryUserId || undefined });
    if (!result.ok) {
      showToast({ type: 'error', title: result.error.message });
      return;
    }
    const { succeeded, unchanged, failed, previousStatusIds } = result.data;
    const notes = [
      unchanged.length > 0 ? `${unchanged.length} khách không có thay đổi` : '',
      failed.length > 0 ? `${failed.length} khách không áp dụng được${failed.some((item) => item.errorCode === 'PRIMARY_REQUIRED') ? ' (chưa có phụ trách chính — hãy chọn người phụ trách chính)' : ''}` : '',
    ].filter(Boolean);
    showToast({
      title: `Đã áp dụng cho ${succeeded.length} khách`,
      message: notes.length > 0 ? `${notes.join('; ')}.` : undefined,
      action: kind === 'CHANGE_STATUS' && succeeded.length > 0 ? { label: 'Hoàn tác', onClick: () => undoStatusChange(previousStatusIds) } : undefined,
      durationMs: kind === 'CHANGE_STATUS' ? 8000 : undefined,
    });
    if (failed.length === 0) finish();
  };

  const apply = () => {
    if (!kind || (needsValue && !value)) return;
    if (kind === 'EXPORT') {
      const result = exportCustomers({ listGroup: 'ALL', customerIds: selectedIds, limit: selectedIds.length });
      if (!result.ok) {
        showToast({ type: 'error', title: result.error.message });
        return;
      }
      const file = result.data;
      downloadCsv(file.fileName, file.content);
      showToast({ title: `Đã xuất ${file.rowCount} khách ra CSV`, message: 'CCCD chỉ ghi 4 số cuối.' });
      return;
    }
    // Chuyển nhiều khách sang nhóm "Bỏ" phải xác nhận như ở màn chi tiết (02 §5).
    if (kind === 'CHANGE_STATUS' && isDroppedStatus(catalogs.statuses.find((status) => status.id === value))) {
      setIsConfirmingDrop(true);
      return;
    }
    run();
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
          setKind(event.target.value as BulkKind);
          setValue('');
        }}
        className={`${FILTER_INPUT_CLASS} dark:[color-scheme:dark]`}
      >
        <option value="">Hành động hàng loạt…</option>
        <option value="CHANGE_STATUS">Đổi tình trạng</option>
        <option value="ADD_TAGS">Gắn thẻ</option>
        {canBulkAssign(actor.role) && <option value="ASSIGN">Thêm người chăm sóc</option>}
        {canExportCustomers(actor.role) && <option value="EXPORT">Xuất CSV các dòng đã chọn</option>}
      </select>
      {needsValue && (
        <select value={value} onChange={(event) => setValue(event.target.value)} aria-label="Giá trị áp dụng" className={`${FILTER_INPUT_CLASS} dark:[color-scheme:dark]`}>
          <option value="">— Chọn —</option>
          {valueOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
      {kind === 'ASSIGN' && (
        <select value={primaryUserId} onChange={(event) => setPrimaryUserId(event.target.value)} aria-label="Phụ trách chính cho khách chưa có ai" className={`${FILTER_INPUT_CLASS} dark:[color-scheme:dark]`}>
          <option value="">Phụ trách chính (nếu khách chưa có)</option>
          {assignableUsers.map((user) => (
            <option key={user.id} value={user.id}>
              {user.fullName}
            </option>
          ))}
        </select>
      )}
      <button type="button" onClick={apply} disabled={!kind || (needsValue && !value)} className={`${BUTTON_PRIMARY_CLASS} h-10`}>
        Áp dụng
      </button>
      <button type="button" onClick={onClear} className="inline-flex items-center gap-1 text-theme-xs font-medium text-gray-600 hover:text-gray-800 sm:ml-auto dark:text-gray-400">
        <X size={14} aria-hidden="true" />
        Bỏ chọn
      </button>
      <ConfirmDialog
        isOpen={isConfirmingDrop}
        tone="danger"
        title="Chuyển sang danh sách Bỏ?"
        description={`${selectedIds.length} khách sẽ chuyển sang tình trạng thuộc danh sách Bỏ. Bạn có thể Hoàn tác ngay sau đó.`}
        confirmLabel="Chuyển sang Bỏ"
        onCancel={() => setIsConfirmingDrop(false)}
        onConfirm={() => {
          setIsConfirmingDrop(false);
          run();
        }}
      />
    </div>
  );
};
