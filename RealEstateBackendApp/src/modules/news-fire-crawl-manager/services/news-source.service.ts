import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NewsSource } from '../schemas/news-source.schema';

@Injectable()
export class NewsSourceService {
  constructor(
    @InjectModel(NewsSource.name) private newsSourceModel: Model<NewsSource>,
  ) {}

  async findAll(): Promise<NewsSource[]> {
    return this.newsSourceModel.find().exec();
  }

  async findActive(): Promise<NewsSource[]> {
    return this.newsSourceModel.find({ isActive: true }).exec();
  }

  async create(createDto: Partial<NewsSource>): Promise<NewsSource> {
    const newSource = new this.newsSourceModel(createDto);
    return newSource.save();
  }

  async update(id: string, updateDto: Partial<NewsSource>): Promise<NewsSource> {
    const updatedSource = await this.newsSourceModel
      .findByIdAndUpdate(id, updateDto, { new: true })
      .exec();
    if (!updatedSource) {
      throw new NotFoundException(`NewsSource #${id} not found`);
    }
    return updatedSource;
  }

  async remove(id: string): Promise<NewsSource> {
    const deletedSource = await this.newsSourceModel.findByIdAndDelete(id).exec();
    if (!deletedSource) {
      throw new NotFoundException(`NewsSource #${id} not found`);
    }
    return deletedSource;
  }
}
