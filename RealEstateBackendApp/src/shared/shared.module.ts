import { Module } from '@nestjs/common';
import { UnifiedAiService } from './ai-provider/unified-ai.service';
import { ExternalLogModule } from '../modules/external-log/external-log.module';

@Module({
  imports: [ExternalLogModule],
  providers: [UnifiedAiService],
  exports: [UnifiedAiService],
})
export class SharedModule {}