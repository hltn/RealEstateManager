import {
  Controller,
  Delete,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { ApiDataResponse } from '../../../common/decorators/api-response.decorators';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CRM_ROLES } from '../../../common/enums/user-role.enum';
import { CrmAttachmentsFeatureGuard } from '../../../common/guards/crm-attachments-feature.guard';
import { CrmFeatureGuard } from '../../../common/guards/crm-feature.guard';
import { ParseObjectIdPipe } from '../../../common/pipes/parse-object-id.pipe';
import { ATTACHMENT_IMAGE_POLICY } from '../../../shared/storage/file-validation';
import { CareLogAttachmentsService } from './care-log-attachments.service';
import { AttachmentUploadResponseDto } from './dtos/care-log.dto';
import { readSingleFile } from './utils/multipart-upload.util';

const CLIENT_TYPE_HEADER = 'x-client-type';

/**
 * Ảnh đính kèm nhật ký (tài liệu 05 mục 2.6): tải từng ảnh lên trước, rồi gắn vào ghi chú bằng `attachmentIds`
 * khi lưu nhật ký. Bật bằng `FEATURE_CRM_ATTACHMENTS`; tắt => 404.
 */
@ApiTags('CRM - Care log attachments')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard, CrmAttachmentsFeatureGuard)
@Controller('crm/customers/:id/care-log-attachments')
export class CareLogAttachmentsController {
  constructor(private readonly attachments: CareLogAttachmentsService) {}

  @Post()
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Tải một ảnh (jpeg/png/webp, tối đa 5 MB, kiểm magic bytes, bỏ Exif/GPS, đổi tên UUID); giới hạn 30 lần/phút/người',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiDataResponse(AttachmentUploadResponseDto, HttpStatus.CREATED)
  @ApiResponse({ status: 413, description: 'FILE_TOO_LARGE' })
  @ApiResponse({ status: 415, description: 'ATTACHMENT_TYPE_INVALID' })
  async upload(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Req() request: FastifyRequest,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ) {
    return {
      data: await this.attachments.upload(
        user,
        id,
        () => readSingleFile(request, ATTACHMENT_IMAGE_POLICY.maxSizeBytes),
        clientType,
      ),
    };
  }

  @Delete(':attachmentId')
  @Roles(...CRM_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Gỡ ảnh: chưa gắn => người tải lên/Quản trị/Quản lý; đã gắn => tác giả trong 24 giờ/Quản trị/Quản lý',
  })
  @ApiResponse({ status: 204, description: 'Đã gỡ' })
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('attachmentId', ParseObjectIdPipe) attachmentId: string,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ): Promise<void> {
    await this.attachments.remove(user, id, attachmentId, clientType);
  }
}
