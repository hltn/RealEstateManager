import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

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
}

export const RawArticleSchema = SchemaFactory.createForClass(RawArticle);
