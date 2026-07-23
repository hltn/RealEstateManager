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

@Controller('news-manager/sources')
export class NewsSourceController {
  constructor(private readonly newsSourceService: NewsSourceService) {}

  @Get()
  async findAll() {
    const sources = await this.newsSourceService.findAll();
    return {
      message: 'Sources fetched successfully',
      data: sources,
    };
  }

  @Post()
  async create(@Body() createDto: any) {
    const source = await this.newsSourceService.create(createDto);
    return {
      message: 'Source created successfully',
      data: source,
    };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() updateDto: any) {
    const source = await this.newsSourceService.update(id, updateDto);
    return {
      message: 'Source updated successfully',
      data: source,
    };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const source = await this.newsSourceService.remove(id);
    return {
      message: 'Source deleted successfully',
      data: source,
    };
  }
}
