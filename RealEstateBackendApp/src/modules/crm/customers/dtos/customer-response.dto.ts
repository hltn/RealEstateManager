import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CatalogRefDto,
  RefDto,
  UserRefDto,
} from '../../../../common/dto/ref.dto';
import { UserRole } from '../../../../common/enums/user-role.enum';
import { ListGroup } from '../../catalogs/catalog.enums';
import {
  CareRole,
  ConsentMethod,
  ConsentStatus,
  CreatedVia,
} from '../customer.constants';

export class StatusRefDto {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty() label: string;
  @ApiProperty({ enum: ListGroup }) listGroup: ListGroup;
  @ApiProperty({ nullable: true, type: String }) color: string | null;
}

export class CriteriaDoneDto {
  @ApiProperty() demand: boolean;
  @ApiProperty() motivation: boolean;
  @ApiProperty() finance: boolean;
  @ApiProperty() timing: boolean;
}

export class CriterionResponseDto {
  @ApiProperty() isDone: boolean;
  @ApiProperty() description: string;
  @ApiProperty({ nullable: true, type: String }) updatedAt: string | null;
  @ApiProperty({ nullable: true, type: UserRefDto })
  updatedBy: UserRefDto | null;
}

export class CriteriaResponseDto {
  @ApiProperty({ type: CriterionResponseDto }) demand: CriterionResponseDto;
  @ApiProperty({ type: CriterionResponseDto }) motivation: CriterionResponseDto;
  @ApiProperty({ type: CriterionResponseDto }) finance: CriterionResponseDto;
  @ApiProperty({ type: CriterionResponseDto }) timing: CriterionResponseDto;
}

/** `UserRef` của thành viên nhóm chăm sóc: thêm role hệ thống để FE tra vai trò mà không gọi danh sách người dùng. */
export class CareTeamUserRefDto extends UserRefDto {
  @ApiPropertyOptional({
    enum: UserRole,
    nullable: true,
    description:
      'Role cao nhất của tài khoản (ADMIN > MANAGER > STAFF > EDITOR); null/thiếu khi không xác định được',
  })
  role?: UserRole | null;
}

export class CareTeamMemberDto {
  @ApiProperty({ type: CareTeamUserRefDto }) user: CareTeamUserRefDto;
  @ApiProperty({ enum: CareRole }) role: CareRole;
  @ApiProperty() addedAt: string;
  @ApiProperty({ nullable: true, type: UserRefDto }) addedBy: UserRefDto | null;
}

export class DataConsentResponseDto {
  @ApiProperty({ enum: ConsentStatus }) status: ConsentStatus;
  @ApiProperty({ enum: ConsentMethod, nullable: true })
  method: ConsentMethod | null;
  @ApiProperty({ nullable: true, type: UserRefDto })
  recordedBy: UserRefDto | null;
  @ApiProperty({ nullable: true, type: String }) recordedAt: string | null;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
}

/** `CustomerListItem` (tài liệu 05 mục 1.6). KHÔNG có `phone` đầy đủ, CCCD hay `searchText`. */
export class CustomerListItemDto {
  @ApiProperty() id: string;
  @ApiProperty({
    example: 'KH-000123',
    nullable: true,
    type: String,
    description:
      'Mã khách tự sinh (FR-07), hiện cho mọi vai trò (không nhạy cảm); null khi khách chưa được bù mã (dữ liệu cũ)',
  })
  customerCode: string | null;
  @ApiProperty() fullName: string;
  @ApiProperty({
    example: '0912 ••• 678',
    nullable: true,
    type: String,
    description: 'null khi khách không có SĐT hoặc đã ẩn danh',
  })
  phoneMasked: string | null;
  @ApiProperty({
    type: [String],
    example: ['LIVING', 'INVEST_RENT'],
    description:
      'Mã lựa chọn trường chân dung "Mục đích mua" (purchase_purposes); rỗng khi chưa có hoặc khách đã ẩn danh. FE dịch mã sang nhãn theo cấu hình trường',
  })
  purchasePurposes: string[];
  @ApiProperty({ type: StatusRefDto }) status: StatusRefDto;
  @ApiProperty({ nullable: true, type: CatalogRefDto })
  source: CatalogRefDto | null;
  @ApiProperty({ type: [CatalogRefDto] }) projects: CatalogRefDto[];
  @ApiProperty({ nullable: true, type: CatalogRefDto })
  area: CatalogRefDto | null;
  @ApiProperty({ type: [RefDto], description: 'Thẻ sở thích/nghề nghiệp' })
  tags: RefDto[];
  @ApiProperty({ enum: [0, 25, 50, 75, 100] }) progress: number;
  @ApiProperty({ type: CriteriaDoneDto }) criteriaDone: CriteriaDoneDto;
  @ApiProperty({ nullable: true, type: UserRefDto })
  primaryAssignee: UserRefDto | null;
  @ApiProperty() careTeamSize: number;
  @ApiProperty({ nullable: true, type: String }) nextAppointmentAt:
    | string
    | null;
  @ApiProperty({ nullable: true, type: String }) lastCareLogAt: string | null;
  @ApiProperty() lastUpdatedAt: string;
  @ApiProperty() personaCompleteness: number;
}

export class CustomerPermissionsDto {
  @ApiProperty() canEdit: boolean;
  @ApiProperty() canManageCareTeam: boolean;
  @ApiProperty() canChangePrimary: boolean;
  @ApiProperty() canDelete: boolean;
}

/** `CustomerDetail` (tài liệu 05 mục 1.6). `version` là `__v` dùng cho khóa lạc quan khi PATCH. */
export class CustomerDetailDto extends CustomerListItemDto {
  @ApiProperty({ nullable: true, type: String }) email: string | null;
  @ApiProperty() canViewPhone: boolean;
  @ApiProperty({ type: CriteriaResponseDto }) criteria: CriteriaResponseDto;
  @ApiProperty({ type: [CareTeamMemberDto] }) careTeam: CareTeamMemberDto[];
  @ApiProperty({ nullable: true, example: '••••1234', type: String })
  nationalIdMasked: string | null;
  @ApiProperty() hasNationalId: boolean;
  @ApiProperty() canRevealNationalId: boolean;
  @ApiProperty({ type: DataConsentResponseDto })
  dataConsent: DataConsentResponseDto;
  @ApiProperty({ nullable: true, type: UserRefDto })
  lastUpdatedBy: UserRefDto | null;
  @ApiProperty() createdAt: string;
  @ApiProperty({ nullable: true, type: UserRefDto })
  createdBy: UserRefDto | null;
  @ApiProperty({ enum: CreatedVia }) createdVia: CreatedVia;
  @ApiProperty({
    type: [String],
    description: 'Gợi ý bước tiếp theo (M3): hiện rỗng',
  })
  nextActionSuggestions: string[];
  @ApiProperty({ type: CustomerPermissionsDto })
  permissions: CustomerPermissionsDto;
  @ApiProperty({ description: 'Gửi lại khi PATCH (khóa lạc quan)' })
  version: number;
}

export class DeletedCustomerListItemDto extends CustomerListItemDto {
  @ApiProperty() deletedAt: string;
  @ApiProperty({ nullable: true, type: UserRefDto })
  deletedBy: UserRefDto | null;
  @ApiProperty({ nullable: true, type: String }) anonymizedAt: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Lý do xóa (từ audit CUSTOMER_DELETED mới nhất); null nếu khách đã ẩn danh hóa (lý do bị xóa cùng PII)',
  })
  deleteReason: string | null;
  @ApiProperty({
    description:
      'true khi đang xóa vĩnh viễn dở (lần xóa trước lỗi hoặc đang chạy): FE hiện "đang xóa dở, bấm Xóa vĩnh viễn để hoàn tất" và vô hiệu nút Khôi phục (khôi phục sẽ bị 409 CUSTOMER_PURGE_IN_PROGRESS)',
  })
  purgeInProgress: boolean;
}

export class CustomerListCountsDto {
  @ApiProperty() ALL: number;
  @ApiProperty() NOT_CONTACTED: number;
  @ApiProperty() INTERESTED: number;
  @ApiProperty() NET: number;
  @ApiProperty() DROPPED: number;
  @ApiProperty({ type: 'array', items: { type: 'object' } })
  byStatus: Array<{ statusId: string; statusCode: string; count: number }>;
}

export class ChangeStatusResponseDto {
  @ApiProperty({ type: StatusRefDto }) status: StatusRefDto;
  @ApiProperty({ nullable: true, type: String }) previousStatusId:
    | string
    | null;
  @ApiProperty() version: number;
  @ApiProperty() lastUpdatedAt: string;
}

/** PT-023: tình trạng khách vừa được tự chuyển do tiến độ tiêu chí đạt/xuống dưới 3/4. */
export class AutoStatusChangeDto {
  @ApiProperty({ type: StatusRefDto, nullable: true })
  from: StatusRefDto | null;
  @ApiProperty({ type: StatusRefDto }) to: StatusRefDto;
}

export class CriteriaUpdateResponseDto {
  @ApiProperty({ type: CriteriaResponseDto }) criteria: CriteriaResponseDto;
  @ApiProperty() progress: number;
  @ApiProperty({
    description:
      'Version SAU CÙNG (đã tính cả lần tự đổi tình trạng nếu có); gửi lại ở lần PATCH kế tiếp',
  })
  version: number;
  @ApiProperty() lastUpdatedAt: string;
  @ApiPropertyOptional({
    type: AutoStatusChangeDto,
    description:
      'Chỉ có khi tình trạng khách vừa được tự chuyển (đạt 3/4 tiêu chí -> Khách net; xuống dưới 3/4 -> Có quan tâm)',
  })
  autoStatusChange?: AutoStatusChangeDto;
}

export class PhoneViewResponseDto {
  @ApiProperty({ example: '+84912345678' }) phone: string;
  @ApiProperty() viewedAt: string;
}

export class NationalIdSummaryDto {
  @ApiProperty() hasNationalId: boolean;
  @ApiProperty({ nullable: true, example: '••••1234', type: String })
  nationalIdMasked: string | null;
}

export class NationalIdViewResponseDto {
  @ApiProperty() nationalId: string;
  @ApiProperty() viewedAt: string;
}

export class NationalIdViewEntryDto {
  @ApiProperty({ type: UserRefDto }) viewer: UserRefDto;
  @ApiProperty() viewedAt: string;
  @ApiProperty({ nullable: true, type: String }) purpose: string | null;
  @ApiProperty() source: string;
}

export class AnonymizeResponseDto {
  @ApiProperty() customerId: string;
  @ApiProperty() anonymizedAt: string;
}

/** Số bản ghi con đã xóa cùng khách khi xóa vĩnh viễn (không chứa dữ liệu cá nhân). */
export class PurgedCountsDto {
  @ApiProperty() careLogs: number;
  @ApiProperty() attachments: number;
  @ApiProperty({ description: 'File đã xóa khỏi kho lưu trữ (MinIO)' })
  files: number;
  @ApiProperty() appointments: number;
  @ApiProperty() careTeamRequests: number;
  @ApiProperty() reminders: number;
  @ApiProperty() notifications: number;
  @ApiProperty({ description: 'Dòng audit cũ của khách đã xóa' })
  auditLogs: number;
}

export class PurgeCustomerResponseDto {
  @ApiProperty() customerId: string;
  @ApiProperty({ type: PurgedCountsDto }) purged: PurgedCountsDto;
}
