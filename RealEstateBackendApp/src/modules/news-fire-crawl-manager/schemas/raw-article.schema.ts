import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class RawArticle extends Document {
  @Prop({ required: true })
  title: string;

  @Prop()
  description?: string;

  @Prop()
  content?: string;

  @Prop({ required: true })
  url: string;

  @Prop({ required: true, unique: true, index: true })
  urlHash: string;

  @Prop()
  publishedAt?: string;

  @Prop()
  thumbnailUrl?: string;

  @Prop({ required: true })
  source: string;

  // === DEDUP FIELDS ===

  /** Marks this article as a duplicate of an existing NewsArticle */
  @Prop({ default: false })
  isDuplicate: boolean;

  /** Reference to the original NewsArticle (when isDuplicate: true) */
  @Prop({ type: Types.ObjectId, ref: 'NewsArticle', default: null })
  duplicateOfArticleId: Types.ObjectId | null;

  /** Cosine similarity score with the matched article */
  @Prop({ type: Number, default: null })
  duplicateScore: number | null;

  /** Vector embedding of title + summary (used for semantic dedup) */
  @Prop({ type: [Number], default: null })
  contentEmbedding: number[] | null;

  /** Text used to generate embedding (for debug/re-embed) */
  @Prop({ required: false })
  embeddingInput: string;

  /** Model used to generate embedding */
  @Prop({ required: false })
  embeddingModel: string;

  /** ObjectId of NewsArticle created from this record (when not duplicate) */
  @Prop({ type: Types.ObjectId, ref: 'NewsArticle', default: null })
  savedArticleId: Types.ObjectId | null;
}

export const RawArticleSchema = SchemaFactory.createForClass(RawArticle);

// === Dedup indexes ===
RawArticleSchema.index({ isDuplicate: 1 });
RawArticleSchema.index({ contentEmbedding: 1 }, { sparse: true });
RawArticleSchema.index({ savedArticleId: 1 }, { sparse: true });
RawArticleSchema.index({ isDuplicate: 1, createdAt: -1 });
