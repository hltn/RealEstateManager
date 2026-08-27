import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MarketAnalysisHistoryDocument = MarketAnalysisHistory & Document;

@Schema({ timestamps: true })
export class MarketAnalysisHistory {
  @Prop({ required: true })
  content: string;

  @Prop({ type: [{ type: String }], required: true })
  articleIds: string[];

  /**
   * Google Drive export status tracking.
   * Chỉ set khi export thành công.
   * null = chưa export
   */
  @Prop({
    type: {
      documentId: { type: String, required: true },
      documentUrl: { type: String, required: true },
      title: { type: String, required: true },
      exportedAt: { type: Date, required: true },
    },
    default: null,
  })
  googleDriveExport: GoogleDriveExport | null;
}

export interface GoogleDriveExport {
  documentId: string;
  documentUrl: string;
  title: string;
  exportedAt: Date;
}

export const MarketAnalysisHistorySchema = SchemaFactory.createForClass(
  MarketAnalysisHistory,
);
