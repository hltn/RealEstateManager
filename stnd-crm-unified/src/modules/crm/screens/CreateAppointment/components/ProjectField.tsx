/**
 * Ô "Dự án" của lịch hẹn (tuỳ chọn): dự án khách sẽ xem / ký / trao đổi. Chỉ liệt kê dự án đang hoạt động.
 * Dự án khách quan tâm xếp đầu trong nhóm "Khách quan tâm"; "Không chọn" = lịch không gắn dự án.
 * Loại lịch Xem nhà mẫu / Ký cọc: có chip "Nên chọn" (các loại khác vẫn hiện nhưng ít nhấn mạnh).
 */
import { Building2 } from 'lucide-react';
import { getFieldA11yProps } from '@crm/components/form/FieldError';
import { FormField, getErrorId } from '@crm/components/form/FormField';
import { CHIP_CLASS, CHIP_TONE_CLASS, getSelectClass, INPUT_ICON_CLASS } from '@crm/lib/uiClasses';
import { getFieldId, isProjectEmphasizedType } from '../createAppointmentForm';
import type { CreateAppointmentForm } from '../useCreateAppointmentForm';

interface ProjectFieldProps {
  form: CreateAppointmentForm;
}

export const ProjectField = ({ form }: ProjectFieldProps) => {
  const { values, errors, setField, selectedCustomer, selectableProjects } = form;
  const inputId = getFieldId('projectId');
  const isEmphasized = isProjectEmphasizedType(values.type);
  const interestedIds = new Set((selectedCustomer?.projects ?? []).map((project) => project.id));
  const interested = selectableProjects.filter((project) => interestedIds.has(project.id));
  const others = selectableProjects.filter((project) => !interestedIds.has(project.id));

  return (
    <FormField
      inputId={inputId}
      label="Dự án"
      error={errors.projectId}
      hint={isEmphasized ? 'Nên chọn dự án khách sẽ xem hoặc ký để lịch hiển thị đúng dự án.' : 'Tuỳ chọn: gắn lịch với một dự án.'}
      labelAddon={isEmphasized ? <span className={`${CHIP_CLASS} ${CHIP_TONE_CLASS.brand}`}>Nên chọn</span> : undefined}
    >
      <div className="relative">
        <Building2 size={18} aria-hidden="true" className={`${INPUT_ICON_CLASS} z-10`} />
        <select
          id={inputId}
          value={values.projectId}
          onChange={(event) => setField('projectId', event.target.value)}
          className={getSelectClass({ hasError: Boolean(errors.projectId), hasLeftIcon: true })}
          {...getFieldA11yProps(getErrorId(inputId), errors.projectId)}
        >
          <option value="">Không chọn</option>
          {interested.length > 0 ? (
            <>
              <optgroup label="Khách quan tâm">
                {interested.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </optgroup>
              {others.length > 0 && (
                <optgroup label="Dự án khác">
                  {others.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </>
          ) : (
            others.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))
          )}
        </select>
      </div>
    </FormField>
  );
};
