import {
  Injectable,
  Logger,
  OnModuleInit,
  InternalServerErrorException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface AiPrompt {
  api_ai_name: string;
  api_ai_path: string;
  prompt: string;
}

@Injectable()
export class AiPromptConfigService implements OnModuleInit {
  private readonly logger = new Logger(AiPromptConfigService.name);
  private prompts: AiPrompt[] = [];
  private readonly promptsFilePath = path.join(
    process.cwd(),
    'src/modules/news-fire-crawl-manager/constants/ai-prompts.json',
  );

  onModuleInit() {
    this.loadPrompts();
  }

  private loadPrompts() {
    try {
      if (fs.existsSync(this.promptsFilePath)) {
        const fileContent = fs.readFileSync(this.promptsFilePath, 'utf8');
        this.prompts = JSON.parse(fileContent);
      } else {
        this.logger.warn(`Prompts file not found at ${this.promptsFilePath}`);
        this.prompts = [];
      }
    } catch (error) {
      this.logger.error('Error loading AI prompts from JSON:', error);
    }
  }

  getPrompts(): AiPrompt[] {
    return this.prompts;
  }

  getPromptByName(name: string): string {
    const found = this.prompts.find((p) => p.api_ai_name === name);
    return found ? found.prompt : '';
  }

  async updatePrompts(newPrompts: AiPrompt[]) {
    // Snapshot state cũ để rollback nếu writeFile fail — tránh race khi
    // in-memory đã cập nhật nhưng file ghi lỗi (state lệch nhau).
    const previousPrompts = this.prompts;
    this.prompts = newPrompts;
    try {
      await fs.promises.writeFile(
        this.promptsFilePath,
        JSON.stringify(this.prompts, null, 2),
        'utf8',
      );
    } catch (error) {
      // Rollback in-memory state về giá trị cũ để giữ tính nhất quán.
      this.prompts = previousPrompts;
      this.logger.error('Error saving AI prompts to JSON:', error);
      throw new InternalServerErrorException('Could not save AI prompts');
    }
  }
}
