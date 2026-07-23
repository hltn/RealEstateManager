import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import { GoogleGenAI } from '@google/genai';

@Injectable()
export class AIFilterService {
  private readonly logger = new Logger(AIFilterService.name);
  private ai: GoogleGenAI;

  constructor(private configService: ConfigService) {
    this.ai = new GoogleGenAI({
      apiKey: this.configService.get<string>('GEMINI_API_KEY') || 'dummy',
    });
  }

  async filterAndRank(filePath: string): Promise<any[]> {
    this.logger.log(`Starting Job 2: AI Filter & Ranking on file ${filePath}`);

    const rawData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    const isApiKeyValid = apiKey && apiKey !== 'your_gemini_api_key_here';

    if (!isApiKeyValid) {
      this.logger.error('GEMINI_API_KEY is not set or invalid.');
      throw new BadRequestException('GEMINI_API_KEY is not set or invalid.');
    }

    try {
        this.logger.log('Sending data to Gemini API for filtering and ranking');

        // Take the first article's content for demonstration to avoid context limits
        // In a real scenario, you'd chunk this or use Gemini's large context window for multiple articles
        const contentToAnalyze = rawData
          .map(
            (d: any) =>
              `URL: ${d.url}\nTitle: ${d.title}\nContent: ${d.content}`,
          )
          .join('\n\n---\n\n')
          .substring(0, 30000);

        const prompt = `
          Analyze the following real estate news articles.
          For each significant news item found in the content, extract the following information and return a JSON array of objects.
          
          Required JSON schema for each object:
          {
            "title": "Clear, concise title",
            "summary": "2-3 sentence summary",
            "importanceReason": "Why is this important for real estate?",
            "impactLevel": "Rất cao" or "Cao" or "Trung bình",
            "targetAudience": ["Nhà đầu tư", "Người mua ở thực", etc],
            "expertOpinion": "Summarized expert opinion if any",
            "publishDate": "ISO date string",
            "source": "Source name",
            "url": "Source URL",
            "keywords": ["Keyword1", "Keyword2"]
          }

          Return ONLY the raw JSON array containing up to 5 most important articles. Do not include markdown formatting or \`\`\`json wrappers.
          
          Data to analyze:
          ${contentToAnalyze}
        `;

        const response = await this.ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
        });

        let resultText = response.text || '[]';
        // Cleanup potential markdown wrappers
        resultText = resultText
          .replace(/```json/g, '')
          .replace(/```/g, '')
          .trim();

        const finalTop5 = JSON.parse(resultText);
        this.logger.log(
          `Job 2 completed. Extracted ${finalTop5.length} articles via Gemini.`,
        );
        return finalTop5;
      } catch (error: any) {
      this.logger.error(
        `Error in Gemini AI filtering: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(`Error in Gemini AI filtering: ${error.message}`);
    }
  }
}
