/**
 * Dialog Thêm / Sửa dự án (chỉ Quản trị — 04 §4.2, X7). Desktop = modal giữa màn, mobile = bottom sheet.
 * Kiểm lỗi theo từng trường ngay ở client (cùng `getProjectErrors` với lớp dữ liệu), rồi gọi `createProject`/`updateProject`.
 */
import { useState, type FormEvent } from 'react';
import { Building2, Save } from 'lucide-react';
import { Modal } from '../../../../components/ui/modal';
import { useCatalogs, useCrmApi } from '@crm/api';
import { BottomSheet } from '@crm/components/BottomSheet';
import { getFieldA11yProps } from '@crm/components/form/FieldError';
import { FormField, getErrorId } from '@crm/components/form/FormField';
import { ProjectFormFields } from '@crm/components/form/ProjectFormFields';
import { TextInput } from '@crm/components/form/TextInput';
import { ToggleSwitch } from '@crm/components/form/ToggleSwitch';
import { useIsMobile } from '@crm/hooks/useIsMobile';
import { createId } from '@crm/lib/id';
import { toProjectBody } from '@crm/api/http/projectBody';
import { createEmptyProject, getFirstProjectError, getProjectErrors, normalizeProject, PROJECT_NAME_MAX_LENGTH, type ProjectErrors } from '@crm/lib/projectRules';
import { BUTTON_OUTLINE_CLASS, BUTTON_PRIMARY_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import type { Project } from '@crm/types/crm';

const FORM_ID = 'crm-project-form';
const TITLE_ID = 'crm-project-form-title';
const ID_PREFIX = 'project-form';

interface ProjectFormDialogProps {
  /** Dự án đang sửa; `null` = thêm mới. */
  project: Project | null;
  onClose: () => void;
}

export const ProjectFormDialog = ({ project: editingProject, onClose }: ProjectFormDialogProps) => {
  const api = useCrmApi();
  const { catalogs } = useCatalogs();
  const { showToast } = useCrmActions();
  const isMobile = useIsMobile();
  const isNew = editingProject === null;
  const [draft, setDraft] = useState<Project>(() => editingProject ?? createEmptyProject(createId('proj')));
  const [errors, setErrors] = useState<ProjectErrors>({});

  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSaving) return;
    const normalized = normalizeProject(draft);
    const nextErrors = getProjectErrors(catalogs.projects, normalized);
    setErrors(nextErrors);
    if (getFirstProjectError(nextErrors)) return;
    setIsSaving(true);
    // POST không nhận `isActive` (dự án mới luôn hoạt động): tắt hoạt động khi tạo = tạo xong rồi PATCH.
    const result = isNew ? await api.createProject(toProjectBody(normalized, { isCreate: true })) : await api.updateProject(normalized.id, toProjectBody(normalized));
    if (result.ok && isNew && !normalized.isActive) await api.updateProject(result.data.id, { isActive: false });
    setIsSaving(false);
    if (!result.ok) {
      showToast({ type: 'error', title: result.error.message });
      return;
    }
    showToast({ title: isNew ? `Đã thêm dự án "${result.data.name}"` : `Đã lưu dự án "${result.data.name}"` });
    onClose();
  };

  const form = (
    <form id={FORM_ID} onSubmit={handleSubmit} noValidate className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField inputId={`${ID_PREFIX}-name`} label="Tên dự án (tên ngắn)" isRequired error={errors.name}>
          <TextInput
            id={`${ID_PREFIX}-name`}
            value={draft.name}
            maxLength={PROJECT_NAME_MAX_LENGTH}
            autoFocus
            hasError={Boolean(errors.name)}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            {...getFieldA11yProps(getErrorId(`${ID_PREFIX}-name`), errors.name)}
          />
        </FormField>
        <ProjectFormFields project={draft} areas={catalogs.areas} errors={errors} idPrefix={ID_PREFIX} onChange={setDraft} />
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3 dark:border-white/[0.05]">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800 dark:text-white/90">Đang hoạt động</p>
          <p className="text-theme-xs text-gray-500 dark:text-gray-400">Tắt = ngừng hoạt động: ẩn khỏi lựa chọn mới, khách đã gắn vẫn giữ.</p>
        </div>
        <ToggleSwitch isChecked={draft.isActive} onChange={(isActive) => setDraft({ ...draft, isActive })} label="Đang hoạt động" size="sm" />
      </div>
    </form>
  );

  const actions = (
    <div className="flex justify-end gap-3">
      <button type="button" onClick={onClose} className={BUTTON_OUTLINE_CLASS}>
        Huỷ
      </button>
      <button type="submit" form={FORM_ID} disabled={isSaving} className={BUTTON_PRIMARY_CLASS}>
        <Save size={16} aria-hidden="true" />
        {isSaving ? 'Đang lưu…' : isNew ? 'Thêm dự án' : 'Lưu thay đổi'}
      </button>
    </div>
  );
  const title = isNew ? 'Thêm dự án' : `Sửa dự án — ${editingProject.name}`;

  if (isMobile) {
    return (
      <BottomSheet titleId={TITLE_ID} title={title} onClose={onClose} footer={actions}>
        {form}
      </BottomSheet>
    );
  }
  return (
    <Modal isOpen onClose={onClose} className="mx-4 max-w-2xl p-6">
      <div role="dialog" aria-modal="true" aria-labelledby={TITLE_ID} className="max-h-[85vh] overflow-y-auto">
        <div className="mb-5 flex items-center gap-3 pr-12">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400">
            <Building2 size={20} aria-hidden="true" />
          </span>
          <h3 id={TITLE_ID} className="text-lg font-semibold text-gray-800 dark:text-white/90">
            {title}
          </h3>
        </div>
        {form}
        <div className="mt-6">{actions}</div>
      </div>
    </Modal>
  );
};
