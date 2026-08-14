import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

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

  // === DEDUP FIELDS ===

  /** Vector embedding of title + summary (used as dedup candidate) */
  @Prop({ type: [Number], default: null })
  contentEmbedding: number[] | null;

  /** Text used to generate embedding */
  @Prop({ required: false })
  embeddingInput: string;

  /** Model used to generate embedding */
  @Prop({ required: false })
  embeddingModel: string;

  // === RETROACTIVE DEDUP MARKING ===

  /** Whether this article is a duplicate of an older article (retroactive scan) */
  @Prop({ default: false, index: true })
  isDuplicate: boolean;

  /** Reference to the original NewsArticle that this one duplicates */
  @Prop({ type: Types.ObjectId, default: null, index: true })
  duplicateOf: Types.ObjectId | null;

  /** Cosine similarity score against the original article */
  @Prop({ type: Number, default: null })
  duplicateScore: number | null;
}

export const NewsArticleSchema = SchemaFactory.createForClass(NewsArticle);

// === Dedup indexes ===
NewsArticleSchema.index({ publishDate: -1 });
NewsArticleSchema.index({ contentEmbedding: 1 }, { sparse: true });
NewsArticleSchema.index({ publishDate: -1, contentEmbedding: 1 }, { sparse: true });
