import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { NewsSourceService } from '../services/news-source.service';

@Controller('news-manager/sources')
export class NewsSourceController {
  constructor(private readonly newsSourceService: NewsSourceService) {}

  @Get()
  async findAll() {
    return this.newsSourceService.findAll();
  }

  @Post()
  async create(@Body() createDto: any) {
    return this.newsSourceService.create(createDto);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() updateDto: any) {
    return this.newsSourceService.update(id, updateDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.newsSourceService.remove(id);
  }
}
