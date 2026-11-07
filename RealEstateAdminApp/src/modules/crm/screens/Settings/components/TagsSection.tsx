/**
 * Quản lý thẻ (FR-42, chỉ Quản trị) qua `/crm/tags`: danh sách kèm số khách đang gắn, đổi tên/nhóm/màu, gộp vào thẻ cùng nhóm
 * (khách chuyển sang thẻ đích, thẻ cũ biến mất), xóa mềm (gỡ khỏi mọi khách). Sau mỗi thao tác `useCrmApi` làm mới danh mục `tags`
 * nên bộ lọc, gắn hàng loạt và form chân dung thấy ngay. Backend vẫn là nguồn sự thật về quyền (403) và quy tắc gộp.
 */
import { useState, type FormEvent } from 'react';
import { GitMerge, Pencil, Trash2 } from 'lucide-react';
import { canViewSettings, useAdminTags, useCrmActor, useCrmApi } from '@crm/api';
import { ConfirmDialog } from '@crm/components/ConfirmDialog';
import { FieldError } from '@crm/components/form/FieldError';
import { FormField } from '@crm/components/form/FormField';
import { SelectInput } from '@crm/components/form/SelectInput';
import { TextInput } from '@crm/components/form/TextInput';
import { includesVietnamese } from '@crm/lib/text';
import { BUTTON_OUTLINE_CLASS, BUTTON_PRIMARY_CLASS, BUTTON_SOFT_SM_CLASS, CARD_CLASS, CARD_TITLE_CLASS, CHIP_SMALL_CLASS, CHIP_TONE_CLASS, INSET_CLASS, MUTED_TEXT_CLASS, type ChipTone } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import type { AdminTag } from '@crm/types/crm';
import { TAG_CATEGORY_LABELS, TAG_CATEGORY_OPTIONS, TAG_COLOR_OPTIONS, TAG_NAME_MAX_LENGTH, buildTagPatch, listMergeTargets, toTagDraft, validateTagDraft, type TagDraft } from '../settingsForms';

const fieldId = (name: string) => `settings-tag-${name}`;

interface EditingState {
  tag: AdminTag;
  draft: TagDraft;
  error: string | null;
}

interface MergingState {
  source: AdminTag;
  targetId: string;
  error: string | null;
}

/** Chip màu: tên màu thiết kế dùng lớp chip có sẵn; mã `#RRGGBB` (dữ liệu cũ) vẽ chấm màu. */
const TagColorMark = ({ color }: { color: string | null }) => {
  if (!color) return null;
  if (color in CHIP_TONE_CLASS) return <span aria-hidden="true" className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS[color as ChipTone]}`}>Màu</span>;
  return <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full border border-gray-200 dark:border-gray-700" style={{ backgroundColor: color }} />;
};

export const TagsSection = () => {
  const { role } = useCrmActor();
  const isAdmin = canViewSettings(role);
  // Không phải Quản trị thì không gọi API (backend cũng trả 403): chỉ hiện thông báo.
  const { data: tags, isLoading, error: loadError, refetch } = useAdminTags(isAdmin);
  const api = useCrmApi();
  const { showToast } = useCrmActions();
  const [keyword, setKeyword] = useState('');
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [merging, setMerging] = useState<MergingState | null>(null);
  const [isConfirmingMerge, setIsConfirmingMerge] = useState(false);
  const [deleting, setDeleting] = useState<AdminTag | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  if (!isAdmin) {
    return (
      <section className={`${CARD_CLASS} p-4 sm:p-5`}>
        <p role="alert" className={MUTED_TEXT_CLASS}>Chỉ Quản trị mới quản lý được thẻ.</p>
      </section>
    );
  }

  const visibleTags = tags.filter((tag) => includesVietnamese(tag.name, keyword));

  const openEdit = (tag: AdminTag) => {
    setMerging(null);
    setEditing({ tag, draft: toTagDraft(tag), error: null });
  };

  const openMerge = (source: AdminTag) => {
    setEditing(null);
    setMerging({ source, targetId: '', error: null });
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || isSaving) return;
    const { tag, draft } = editing;
    const validationError = validateTagDraft(draft);
    if (validationError) {
      setEditing({ ...editing, error: validationError });
      return;
    }
    const patch = buildTagPatch(tag, draft);
    // Không đổi gì thì không gọi API.
    if (Object.keys(patch).length === 0) {
      setEditing(null);
      return;
    }
    setIsSaving(true);
    const result = await api.updateTag(tag.id, patch);
    setIsSaving(false);
    if (!result.ok) {
      setEditing({ ...editing, error: result.error.message });
      return;
    }
    showToast({ title: `Đã lưu thẻ "${draft.name.trim()}"` });
    setEditing(null);
  };

  const confirmMerge = async () => {
    if (!merging || isSaving) return;
    setIsSaving(true);
    const result = await api.mergeTag(merging.source.id, merging.targetId);
    setIsSaving(false);
    setIsConfirmingMerge(false);
    if (!result.ok) {
      setMerging({ ...merging, error: result.error.message });
      return;
    }
    showToast({ title: `Đã gộp thẻ "${merging.source.name}" vào "${result.data.name}"` });
    setMerging(null);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const result = await api.deleteTag(deleting.id);
    showToast(result.ok ? { title: `Đã xoá thẻ "${deleting.name}"` } : { type: 'error', title: result.error.message });
    setDeleting(null);
  };

  const mergeTargets = merging ? listMergeTargets(tags, merging.source) : [];
  const mergeTarget = mergeTargets.find((tag) => tag.id === merging?.targetId) ?? null;
  // Màu hiện tại có thể là mã `#RRGGBB` (dữ liệu cũ): giữ làm một lựa chọn để lưu form không vô tình xóa màu.
  const colorOptions =
    editing && editing.draft.color !== '' && !TAG_COLOR_OPTIONS.some((option) => option.value === editing.draft.color)
      ? [...TAG_COLOR_OPTIONS, { value: editing.draft.color, label: `Tùy chỉnh (${editing.draft.color})` }]
      : TAG_COLOR_OPTIONS;

  return (
    <section className={`${CARD_CLASS} space-y-4 p-4 sm:p-5`}>
      <p className={`${MUTED_TEXT_CLASS} max-w-2xl`}>
        Thẻ sở thích, nghề nghiệp gắn cho khách. Đổi tên/nhóm/màu có hiệu lực ngay ở mọi nơi; gộp chuyển khách sang thẻ đích (cùng nhóm); xoá sẽ gỡ thẻ khỏi mọi khách.
      </p>

      <div className="max-w-sm">
        <TextInput aria-label="Tìm thẻ" placeholder="Tìm thẻ theo tên" value={keyword} maxLength={TAG_NAME_MAX_LENGTH} onChange={(event) => setKeyword(event.target.value)} />
      </div>

      {editing && (
        <form noValidate onSubmit={(event) => void handleSave(event)} className={`${INSET_CLASS} space-y-4 p-4`} aria-label="Sửa thẻ">
          <h3 className={CARD_TITLE_CLASS}>Sửa thẻ "{editing.tag.name}"</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField inputId={fieldId('name')} label="Tên thẻ" isRequired>
              <TextInput id={fieldId('name')} value={editing.draft.name} maxLength={TAG_NAME_MAX_LENGTH} autoFocus onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, name: event.target.value }, error: null })} />
            </FormField>
            <FormField inputId={fieldId('category')} label="Nhóm">
              <SelectInput id={fieldId('category')} value={editing.draft.category} options={TAG_CATEGORY_OPTIONS} onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, category: event.target.value as TagDraft['category'] }, error: null })} />
            </FormField>
            <FormField inputId={fieldId('color')} label="Màu">
              <SelectInput id={fieldId('color')} value={editing.draft.color} options={colorOptions} onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, color: event.target.value }, error: null })} />
            </FormField>
          </div>
          <FieldError id={fieldId('error')} message={editing.error ?? undefined} />
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setEditing(null)} className={BUTTON_OUTLINE_CLASS}>
              Huỷ
            </button>
            <button type="submit" disabled={isSaving} className={BUTTON_PRIMARY_CLASS}>
              {isSaving ? 'Đang lưu…' : 'Lưu'}
            </button>
          </div>
        </form>
      )}

      {merging && (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!merging.targetId) setMerging({ ...merging, error: 'Vui lòng chọn thẻ đích.' });
            else setIsConfirmingMerge(true);
          }}
          className={`${INSET_CLASS} space-y-4 p-4`}
          aria-label="Gộp thẻ"
        >
          <h3 className={CARD_TITLE_CLASS}>Gộp thẻ "{merging.source.name}"</h3>
          <FormField inputId={fieldId('merge-target')} label={`Gộp vào thẻ (cùng nhóm ${TAG_CATEGORY_LABELS[merging.source.category]})`} isRequired hint="Khách đang gắn thẻ này sẽ chuyển sang thẻ đích; thẻ này bị xoá.">
            <SelectInput
              id={fieldId('merge-target')}
              value={merging.targetId}
              emptyLabel="Chọn thẻ đích"
              options={mergeTargets.map((tag) => ({ value: tag.id, label: tag.name }))}
              onChange={(event) => setMerging({ ...merging, targetId: event.target.value, error: null })}
            />
          </FormField>
          {mergeTargets.length === 0 && <p className={MUTED_TEXT_CLASS}>Chưa có thẻ nào khác cùng nhóm để gộp vào.</p>}
          <FieldError id={fieldId('merge-error')} message={merging.error ?? undefined} />
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setMerging(null)} className={BUTTON_OUTLINE_CLASS}>
              Huỷ
            </button>
            <button type="submit" disabled={isSaving || mergeTargets.length === 0} className={BUTTON_PRIMARY_CLASS}>
              Gộp thẻ
            </button>
          </div>
        </form>
      )}

      {isLoading && <div aria-busy="true" aria-label="Đang tải thẻ" className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />}
      {loadError && (
        <p role="alert" className="text-theme-sm text-error-600 dark:text-error-400">
          {loadError.message}{' '}
          <button type="button" onClick={refetch} className="font-semibold underline">
            Thử lại
          </button>
        </p>
      )}
      {!isLoading && !loadError && tags.length === 0 && <p className={MUTED_TEXT_CLASS}>Chưa có thẻ nào. Thẻ được tạo nhanh khi gắn cho khách.</p>}
      {!isLoading && tags.length > 0 && visibleTags.length === 0 && <p className={MUTED_TEXT_CLASS}>Không có thẻ nào khớp "{keyword}".</p>}
      <ul className="divide-y divide-gray-100 dark:divide-white/[0.05]">
        {visibleTags.map((tag) => (
          <li key={tag.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-800 dark:text-white/90">
                {tag.name}
                <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.gray}`}>{TAG_CATEGORY_LABELS[tag.category]}</span>
                <TagColorMark color={tag.color} />
              </p>
              <p className="text-theme-xs text-gray-500 dark:text-gray-400">{tag.usageCount} khách đang gắn</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={() => openEdit(tag)} className={BUTTON_SOFT_SM_CLASS} aria-label={`Sửa thẻ ${tag.name}`}>
                <Pencil size={12} aria-hidden="true" />
                Sửa
              </button>
              <button type="button" onClick={() => openMerge(tag)} className={BUTTON_SOFT_SM_CLASS} aria-label={`Gộp thẻ ${tag.name}`}>
                <GitMerge size={12} aria-hidden="true" />
                Gộp
              </button>
              <button type="button" onClick={() => setDeleting(tag)} className={BUTTON_SOFT_SM_CLASS} aria-label={`Xoá thẻ ${tag.name}`}>
                <Trash2 size={12} aria-hidden="true" />
                Xoá
              </button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        isOpen={isConfirmingMerge && merging !== null && mergeTarget !== null}
        tone="danger"
        title={`Gộp "${merging?.source.name ?? ''}" vào "${mergeTarget?.name ?? ''}"?`}
        description={`${merging?.source.usageCount ?? 0} khách đang gắn "${merging?.source.name ?? ''}" sẽ chuyển sang "${mergeTarget?.name ?? ''}"; thẻ "${merging?.source.name ?? ''}" bị xoá. Không hoàn tác được.`}
        confirmLabel="Gộp thẻ"
        onCancel={() => setIsConfirmingMerge(false)}
        onConfirm={() => void confirmMerge()}
      />
      <ConfirmDialog
        isOpen={deleting !== null}
        tone="danger"
        title={`Xoá thẻ "${deleting?.name ?? ''}"?`}
        description={`Thẻ bị xoá (xoá mềm) và gỡ khỏi ${deleting?.usageCount ?? 0} khách đang gắn. Có thể tạo lại thẻ cùng tên sau đó.`}
        confirmLabel="Xoá thẻ"
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
};
