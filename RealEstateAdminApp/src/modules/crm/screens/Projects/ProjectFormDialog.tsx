/**
 * Dialog Thêm / Sửa dự án (chỉ Quản trị — 04 §4.2, X7). Desktop = modal giữa màn, mobile = bottom sheet.
 * Kiểm lỗi theo từng trường ngay ở client (cùng `getProjectErrors` với lớp dữ liệu), rồi gọi `createProject`/`updateProject`.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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
import {
  createEmptyProject,
  getFirstProjectError,
  getProjectErrors,
  listProjectPropertyTypeOptions,
  normalizeProject,
  PROJECT_NAME_MAX_LENGTH,
  PROPERTY_TYPE_FIELD_KEY,
  suggestProjectCode,
  type ProjectErrors,
} from '@crm/lib/projectRules';
import { BUTTON_OUTLINE_CLASS, BUTTON_PRIMARY_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import type { Project } from '@crm/types/crm';

const FORM_ID = 'crm-project-form';
const TITLE_ID = 'crm-project-form-title';
const ID_PREFIX = 'project-form';
/** Số lần tự sinh mã kế tiếp rồi gửi lại khi BE báo trùng mã mà mã còn là mã tự điền (không tính lần gửi đầu). */
const MAX_CODE_RETRIES = 5;
const CODE_RETRY_EXHAUSTED_MESSAGE = 'Không tạo được mã dự án không trùng từ tên này. Hãy đổi tên dự án hoặc nhập mã khác rồi thử lại.';

interface ProjectFormDialogProps {
  /** Dự án đang sửa; `null` = thêm mới. */
  project: Project | null;
  onClose: () => void;
}

export const ProjectFormDialog = ({ project: editingProject, onClose }: ProjectFormDialogProps) => {
  const api = useCrmApi();
  const { catalogs, personaFields } = useCatalogs();
  const { showToast } = useCrmActions();
  const isMobile = useIsMobile();
  const isNew = editingProject === null;
  const [draft, setDraft] = useState<Project>(() => editingProject ?? createEmptyProject(createId('proj')));
  const [errors, setErrors] = useState<ProjectErrors>({});
  /** Khi Thêm: người dùng đã tự sửa tay ô Mã thì ngừng tự điền theo tên (xoá trống = bật lại). */
  const [isCodeTouched, setIsCodeTouched] = useState(false);
  /** Mã BE đã báo trùng (dự án xoá mềm mà danh sách không có): tránh khi tự tạo mã tiếp, kể cả lúc người dùng gõ lại tên. */
  const [rejectedCodes, setRejectedCodes] = useState<string[]>([]);

  /** FR-46: người dùng đã đụng tới ô Loại hình -> khi Sửa mới gửi `propertyTypeCodes` (backend sẽ xóa `unmappedPropertyTypes`). */
  const [hasPropertyTypesChanged, setHasPropertyTypesChanged] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  /** Dialog đóng (Huỷ/ESC/click nền) giữa lúc đang lưu: ngừng vòng thử lại và không gọi `onClose`/toast nữa (tránh đóng nhầm dialog khác). */
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Lựa chọn đã tắt chỉ hiện khi dự án ĐANG LƯU còn dùng nó (không tính nháp), khớp luật của backend.
  const propertyTypeOptions = useMemo(
    () => listProjectPropertyTypeOptions(personaFields.find((field) => field.key === PROPERTY_TYPE_FIELD_KEY)?.optionItems, editingProject?.propertyTypeCodes ?? []),
    [personaFields, editingProject],
  );

  /** Gõ tên dự án: khi Thêm và chưa chạm tay vào ô Mã thì mã tự cập nhật theo tên (tên trống -> mã trống). Form Sửa không đổi mã. */
  const handleNameChange = (name: string) => {
    const shouldAutofillCode = isNew && !isCodeTouched;
    const code = shouldAutofillCode ? (name.trim() ? suggestProjectCode(name, [...catalogs.projects.map((item) => item.code), ...rejectedCodes]) : '') : draft.code;
    setDraft({ ...draft, name, code });
  };

  /** Đổi các trường khác (gồm ô Mã): nếu ô Mã vừa bị người dùng sửa thì đánh dấu đã chạm tay (xoá trống = chưa chạm). */
  const handleFieldsChange = (next: Project) => {
    if (isNew && next.code !== draft.code) setIsCodeTouched(next.code.trim() !== '');
    if (next.propertyTypeCodes !== draft.propertyTypeCodes) setHasPropertyTypesChanged(true);
    setDraft(next);
  };

  /** Sửa = PATCH. */
  const updateExistingProject = (normalized: Project) =>
    api.updateProject(normalized.id, toProjectBody(normalized, { shouldSendPropertyTypes: hasPropertyTypesChanged }));

  /**
   * Thêm = POST (không nhận `isActive`: dự án mới luôn hoạt động, tắt hoạt động khi tạo = tạo xong rồi PATCH).
   * BE báo 409 `PROJECT_CODE_DUPLICATED` (mã trùng dự án đã xoá mềm mà danh sách không có): nếu mã còn là mã tự điền từ tên thì tự sinh
   * mã kế tiếp (thêm mã vừa trùng vào tập đã dùng) rồi gửi lại, tối đa `MAX_CODE_RETRIES` lần; mã người dùng tự gõ thì KHÔNG tự đổi.
   * Dialog bị đóng giữa chừng (unmount) thì dừng vòng lặp, không gửi thêm và trả `null` (không còn gì để cập nhật/đóng).
   * Trả kết quả cuối, mã đã gửi lần cuối, các mã đã bị BE báo trùng và việc tắt hoạt động (nếu cần) có thành công không.
   */
  const createNewProject = async (normalized: Project) => {
    const rejected = [...rejectedCodes];
    const maxRetries = isCodeTouched ? 0 : MAX_CODE_RETRIES;
    const takenCodes = () => [...catalogs.projects.map((item) => item.code), ...rejected];
    let candidate = normalized;
    for (let retry = 0; ; retry += 1) {
      const result = await api.createProject(toProjectBody(candidate, { isCreate: true }));
      if (!isMountedRef.current) return null;
      const isCodeDuplicated = !result.ok && result.error.errorCode === 'PROJECT_CODE_DUPLICATED';
      if (isCodeDuplicated && !rejected.includes(candidate.code)) rejected.push(candidate.code);
      if (!isCodeDuplicated || retry >= maxRetries) {
        const isDeactivated = result.ok && !candidate.isActive ? (await api.updateProject(result.data.id, { isActive: false })).ok : true;
        if (!isMountedRef.current) return null;
        return { result, code: candidate.code, rejected, isCodeDuplicated, isDeactivated, nextCode: suggestProjectCode(candidate.name, takenCodes()) };
      }
      candidate = { ...candidate, code: suggestProjectCode(candidate.name, takenCodes()) };
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSaving) return;
    const normalized = normalizeProject(draft);
    const nextErrors = getProjectErrors(catalogs.projects, normalized, { originalCode: editingProject?.code });
    setErrors(nextErrors);
    if (getFirstProjectError(nextErrors)) return;
    setIsSaving(true);
    if (!isNew) {
      const result = await updateExistingProject(normalized);
      if (!isMountedRef.current) return;
      setIsSaving(false);
      if (!result.ok) {
        showToast({ type: 'error', title: result.error.message });
        return;
      }
      showToast({ title: `Đã lưu dự án "${result.data.name}"` });
      onClose();
      return;
    }
    const outcome = await createNewProject(normalized);
    if (!outcome) return;
    const { result, code, rejected, isCodeDuplicated, isDeactivated, nextCode } = outcome;
    setIsSaving(false);
    setRejectedCodes(rejected);
    if (!result.ok) {
      if (isCodeDuplicated && !isCodeTouched) {
        // Mã tự điền hết lượt thử vẫn trùng: báo ở ô Tên và đặt sẵn mã kế tiếp CHƯA thử (bấm Thêm lại là thử tiếp, không lặp mã đã trùng).
        setDraft((current) => ({ ...current, code: nextCode }));
        setErrors({ name: CODE_RETRY_EXHAUSTED_MESSAGE });
        showToast({ type: 'error', title: CODE_RETRY_EXHAUSTED_MESSAGE });
        return;
      }
      setDraft((current) => ({ ...current, code }));
      // Mã người dùng tự gõ trùng dự án đã xoá mềm: báo tại ô Mã, giữ form để họ tự đổi mã rồi lưu lại.
      if (isCodeDuplicated) setErrors({ code: `Mã dự án "${code}" đã tồn tại.` });
      showToast({ type: 'error', title: result.error.message });
      return;
    }
    if (isDeactivated) showToast({ title: `Đã thêm dự án "${result.data.name}"` });
    else showToast({ type: 'warning', title: `Đã tạo dự án "${result.data.name}" nhưng chưa tắt được hoạt động`, message: 'Mở lại dự án để tắt "Đang hoạt động".' });
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
            onChange={(event) => handleNameChange(event.target.value)}
            {...getFieldA11yProps(getErrorId(`${ID_PREFIX}-name`), errors.name)}
          />
        </FormField>
        <ProjectFormFields
          project={draft}
          areas={catalogs.areas}
          errors={errors}
          idPrefix={ID_PREFIX}
          propertyTypeOptions={propertyTypeOptions}
          isCodeReadOnly={!isNew}
          onChange={handleFieldsChange}
        />
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
