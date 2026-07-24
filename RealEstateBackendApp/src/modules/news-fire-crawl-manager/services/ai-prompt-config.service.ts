import { Injectable, OnModuleInit, InternalServerErrorException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface AiPrompt {
  api_ai_name: string;
  api_ai_path: string;
  prompt: string;
}

@Injectable()
export class AiPromptConfigService implements OnModuleInit {
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
        console.warn(`Prompts file not found at ${this.promptsFilePath}`);
        this.prompts = [];
      }
    } catch (error) {
      console.error('Error loading AI prompts from JSON:', error);
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
    this.prompts = newPrompts;
    try {
      await fs.promises.writeFile(
        this.promptsFilePath,
        JSON.stringify(this.prompts, null, 2),
        'utf8',
      );
    } catch (error) {
      console.error('Error saving AI prompts to JSON:', error);
      throw new InternalServerErrorException('Could not save AI prompts');
    }
  }
}
