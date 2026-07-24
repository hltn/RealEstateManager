import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export enum NewsStatus {
  POSTED_WP = 'POSTED_WP',
  ERROR = 'ERROR',
  CRAWLED = 'CRAWLED',
}

@Schema({ timestamps: true })
export class NewsArticle extends Document {
  @Prop({ required: true })
  title: string;

  @Prop({ required: false })
  summary: string;

  @Prop({ required: false })
  importanceReason: string;

  @Prop({ required: false, enum: ['Rất cao', 'Cao', 'Trung bình'] })
  impactLevel: string;

  @Prop({ type: [String], required: false })
  targetAudience: string[];

  @Prop({ required: false })
  expertOpinion: string;

  @Prop({ required: false })
  publishDate: string;

  @Prop({ required: false })
  thumbnailUrl: string;

  @Prop({ required: false })
  source: string;

  @Prop({ required: false })
  url: string;

  @Prop({ type: [String], required: false })
  keywords: string[];

  @Prop({ required: true, unique: true, index: true })
  urlHash: string;

  @Prop({ default: null })
  wpPostId: number;

  @Prop({ required: false })
  content: string;

  @Prop({ type: [String], enum: NewsStatus, default: [] })
  status: NewsStatus[];
}

export const NewsArticleSchema = SchemaFactory.createForClass(NewsArticle);
