import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export enum NewsStatus {
  SAVED = 'SAVED',
  POSTED_WP = 'POSTED_WP',
  ERROR = 'ERROR',
}

@Schema({ timestamps: true })
export class NewsArticle extends Document {
  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  summary: string;

  @Prop({ required: true })
  importanceReason: string;

  @Prop({ required: true, enum: ['Rất cao', 'Cao', 'Trung bình'] })
  impactLevel: string;

  @Prop({ type: [String], required: true })
  targetAudience: string[];

  @Prop({ required: true })
  expertOpinion: string;

  @Prop({ required: true })
  publishDate: string;

  @Prop({ required: true })
  source: string;

  @Prop({ required: true })
  url: string;

  @Prop({ type: [String], required: true })
  keywords: string[];

  @Prop({ required: true, unique: true, index: true })
  urlHash: string;

  @Prop({ default: null })
  wpPostId: number;

  @Prop({ type: String, enum: NewsStatus, default: NewsStatus.SAVED })
  status: NewsStatus;
}

export const NewsArticleSchema = SchemaFactory.createForClass(NewsArticle);
