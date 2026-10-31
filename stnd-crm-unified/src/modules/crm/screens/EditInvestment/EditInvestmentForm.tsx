import { EditPersonaForm, type PersonaScreenConfig } from '../EditPersona/EditPersonaForm';

/**
 * Màn "Nhu cầu BĐS": nhóm trường chân dung có cấu trúc (loại hình, mục đích, ngân sách, thời điểm dự kiến mua...)
 * dùng chung bộ form chân dung động. Không có trường bắt buộc (QT9); không tự đánh dấu tiêu chí khi chọn dự án.
 */
const INVESTMENT_SCREEN: PersonaScreenConfig = {
  title: 'Cập nhật Nhu cầu BĐS',
  breadcrumbLabel: 'Cập nhật nhu cầu BĐS',
  description: 'Loại hình, mục đích mua, ngân sách và thời điểm dự kiến mua. Mọi trường đều không bắt buộc.',
  groupCodes: ['REAL_ESTATE'],
  hasBasicInfo: false,
  submitLabel: 'Lưu nhu cầu',
  successToastTitle: 'Đã cập nhật nhu cầu BĐS',
};

interface EditInvestmentFormProps {
  variant: 'desktop' | 'mobile';
}

export const EditInvestmentForm = ({ variant }: EditInvestmentFormProps) => <EditPersonaForm variant={variant} config={INVESTMENT_SCREEN} />;
