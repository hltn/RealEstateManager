import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class NewsSource extends Document {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  url: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  rssUrl?: string;

  @Prop({ type: Object, default: {} })
  crawlConfig: Record<string, any>;
}

export const NewsSourceSchema = SchemaFactory.createForClass(NewsSource);
