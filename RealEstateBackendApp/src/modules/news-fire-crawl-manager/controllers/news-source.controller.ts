import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { NewsSourceService } from '../services/news-source.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import {
  CreateNewsSourceDto,
  UpdateNewsSourceDto,
} from '../dtos/news-source.dto';
import { buildPaginationMeta } from '../../../common/utils/pagination.util';

@ApiTags('News Sources')
@Controller('news-sources')
export class NewsSourceController {
  constructor(private readonly newsSourceService: NewsSourceService) {}

  @Get()
  @ApiOperation({
    summary: 'Get all news sources',
    description: 'Get all news sources',
  })
  async findAll() {
    const sources = await this.newsSourceService.findAll();
    // Controller này trả toàn bộ sources (không phân trang thật), nhưng vẫn
    // phải tuân shape { data, meta: { total, page, limit, totalPages } }.
    // Dùng buildPaginationMeta để totalPages đúng (Math.ceil) thay vì
    // hardcode totalPages: 1 — khi total=0 → totalPages=0 (không NaN).
    const total = sources.length;
    const page = 1;
    const limit = total;
    const meta = buildPaginationMeta(total, page, limit);
    return { data: sources, meta };
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new news source',
    description: 'Create a new news source',
  })
  async create(@Body() createDto: CreateNewsSourceDto) {
    const source = await this.newsSourceService.create(createDto);
    return {
      message: 'Source created successfully',
      data: source,
    };
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Update a news source',
    description: 'Update a news source',
  })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateNewsSourceDto,
  ) {
    const source = await this.newsSourceService.update(id, updateDto);
    return {
      message: 'Source updated successfully',
      data: source,
    };
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a news source',
    description: 'Delete a news source',
  })
  async remove(@Param('id') id: string) {
    const source = await this.newsSourceService.remove(id);
    return {
      message: 'Source deleted successfully',
      data: source,
    };
  }
}
