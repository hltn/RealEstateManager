/**
 * Ô "Dự án" của lịch hẹn (tuỳ chọn): dự án khách sẽ xem / ký / trao đổi. Chỉ liệt kê dự án đang hoạt động.
 * Là ô chọn MỘT có tìm kiếm tích hợp (`SearchableSelect`): gõ để lọc tên dự án không dấu; "Không chọn" = lịch không gắn dự án.
 * Dự án khách quan tâm xếp đầu danh sách (khi chưa gõ từ khoá), rồi tới các dự án khác theo thứ tự gốc.
 * Loại lịch Xem nhà mẫu / Ký cọc: có chip "Nên chọn" (các loại khác vẫn hiện nhưng ít nhấn mạnh).
 */
import { useMemo } from 'react';
import { Building2 } from 'lucide-react';
import { getFieldA11yProps } from '@crm/components/form/FieldError';
import { FormField, getErrorId } from '@crm/components/form/FormField';
import { SearchableSelect } from '@crm/components/form/SearchableSelect';
import { CHIP_CLASS, CHIP_TONE_CLASS } from '@crm/lib/uiClasses';
import { getFieldId, isProjectEmphasizedType } from '../createAppointmentForm';
import type { CreateAppointmentForm } from '../useCreateAppointmentForm';

interface ProjectFieldProps {
  form: CreateAppointmentForm;
}

export const ProjectField = ({ form }: ProjectFieldProps) => {
  const { values, errors, setField, selectedCustomer, selectableProjects } = form;
  const inputId = getFieldId('projectId');
  const isEmphasized = isProjectEmphasizedType(values.type);

  // Dự án khách quan tâm lên đầu, giữ nguyên thứ tự gốc trong từng nhóm.
  const options = useMemo(() => {
    const interestedIds = new Set((selectedCustomer?.projects ?? []).map((project) => project.id));
    const interested = selectableProjects.filter((project) => interestedIds.has(project.id));
    const others = selectableProjects.filter((project) => !interestedIds.has(project.id));
    return [...interested, ...others].map((project) => ({ value: project.id, label: project.name }));
  }, [selectedCustomer, selectableProjects]);

  return (
    <FormField
      inputId={inputId}
      label="Dự án"
      error={errors.projectId}
      hint={isEmphasized ? 'Nên chọn dự án khách sẽ xem hoặc ký để lịch hiển thị đúng dự án.' : 'Tuỳ chọn: gắn lịch với một dự án.'}
      labelAddon={isEmphasized ? <span className={`${CHIP_CLASS} ${CHIP_TONE_CLASS.brand}`}>Nên chọn</span> : undefined}
    >
      <SearchableSelect
        id={inputId}
        icon={Building2}
        options={options}
        value={values.projectId}
        onChange={(projectId) => setField('projectId', projectId)}
        emptyLabel="Không chọn"
        listLabel="Danh sách dự án"
        hasError={Boolean(errors.projectId)}
        isViewportAware
        {...getFieldA11yProps(getErrorId(inputId), errors.projectId)}
      />
    </FormField>
  );
};
