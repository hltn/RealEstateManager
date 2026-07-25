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
import { CreateNewsSourceDto, UpdateNewsSourceDto } from '../dtos/news-source.dto';

@ApiTags('News Sources')
@Controller('news-sources')
export class NewsSourceController {
  constructor(private readonly newsSourceService: NewsSourceService) {}

  @Get()
  @ApiOperation({ summary: 'Get all news sources', description: 'Get all news sources' })
  async findAll() {
    const sources = await this.newsSourceService.findAll();
    return {
      data: sources,
      meta: {
        total: sources.length,
        page: 1,
        limit: sources.length,
        totalPages: 1
      }
    };
  }

  @Post()
  @ApiOperation({ summary: 'Create a new news source', description: 'Create a new news source' })
  async create(@Body() createDto: CreateNewsSourceDto) {
    const source = await this.newsSourceService.create(createDto);
    return {
      message: 'Source created successfully',
      data: source,
    };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a news source', description: 'Update a news source' })
  async update(@Param('id') id: string, @Body() updateDto: UpdateNewsSourceDto) {
    const source = await this.newsSourceService.update(id, updateDto);
    return {
      message: 'Source updated successfully',
      data: source,
    };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a news source', description: 'Delete a news source' })
  async remove(@Param('id') id: string) {
    const source = await this.newsSourceService.remove(id);
    return {
      message: 'Source deleted successfully',
      data: source,
    };
  }
}
