import { applyDecorators, HttpStatus, Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { PaginationMetaDto } from '../dto/paginated-response.dto';

/** Swagger cho response danh sách chuẩn `{ data: T[], meta: { total, page, limit, totalPages } }`. */
export const ApiPaginatedResponse = <T extends Type<unknown>>(
  model: T,
  status: HttpStatus = HttpStatus.OK,
) =>
  applyDecorators(
    ApiExtraModels(PaginationMetaDto, model),
    ApiResponse({
      status,
      schema: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'array', items: { $ref: getSchemaPath(model) } },
          meta: { $ref: getSchemaPath(PaginationMetaDto) },
        },
      },
    }),
  );

/** Swagger cho response một đối tượng chuẩn `{ data: T }`. */
export const ApiDataResponse = <T extends Type<unknown>>(
  model: T,
  status: HttpStatus = HttpStatus.OK,
) =>
  applyDecorators(
    ApiExtraModels(model),
    ApiResponse({
      status,
      schema: {
        type: 'object',
        required: ['data'],
        properties: { data: { $ref: getSchemaPath(model) } },
      },
    }),
  );
