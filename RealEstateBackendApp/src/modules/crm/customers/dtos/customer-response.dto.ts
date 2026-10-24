import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RefDto, UserRefDto } from '../../../../common/dto/ref.dto';
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

export class CareTeamMemberDto {
  @ApiProperty({ type: UserRefDto }) user: UserRefDto;
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
  @ApiProperty() fullName: string;
  @ApiProperty({ example: '0912 ••• 678' }) phoneMasked: string;
  @ApiProperty({ type: StatusRefDto }) status: StatusRefDto;
  @ApiProperty({ nullable: true, type: RefDto }) source: RefDto | null;
  @ApiProperty({ type: [RefDto] }) projects: RefDto[];
  @ApiProperty({ nullable: true, type: RefDto }) area: RefDto | null;
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
}

export class CustomerListCountsDto {
  @ApiProperty() ALL: number;
  @ApiProperty() NOT_CONTACTED: number;
  @ApiProperty() INTERESTED: number;
  @ApiProperty() NET: number;
  @ApiProperty() DROPPED: number;
  @ApiProperty({ type: 'array', items: { type: 'object' } })
  byStatus: Array<{ statusId: string; count: number }>;
}

export class ChangeStatusResponseDto {
  @ApiProperty({ type: StatusRefDto }) status: StatusRefDto;
  @ApiProperty({ nullable: true, type: String }) previousStatusId:
    | string
    | null;
  @ApiProperty() version: number;
  @ApiProperty() lastUpdatedAt: string;
}

export class CriteriaUpdateResponseDto {
  @ApiProperty({ type: CriteriaResponseDto }) criteria: CriteriaResponseDto;
  @ApiProperty() progress: number;
  @ApiProperty() version: number;
  @ApiProperty() lastUpdatedAt: string;
}

export class PhoneLookupResponseDto {
  @ApiProperty({ example: '+84912345678' }) normalizedPhone: string;
  @ApiProperty() exists: boolean;
  @ApiProperty() isAccessible: boolean;
  @ApiPropertyOptional() customerId?: string;
  @ApiPropertyOptional() customerRef?: string;
  @ApiPropertyOptional({ nullable: true, type: String }) caredByName?:
    | string
    | null;
  @ApiProperty() canRequestJoin: boolean;
  @ApiProperty() hasPendingRequest: boolean;
  @ApiPropertyOptional({ description: 'Chỉ Quản trị thấy' })
  isDeleted?: boolean;
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
