import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MarketAnalysisHistoryDocument = MarketAnalysisHistory & Document;

@Schema({ timestamps: true })
export class MarketAnalysisHistory {
  @Prop({ required: true })
  content: string;

  @Prop({ type: [{ type: String }], required: true })
  articleIds: string[];
}

export const MarketAnalysisHistorySchema = SchemaFactory.createForClass(
  MarketAnalysisHistory,
);
