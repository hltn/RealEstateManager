import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import { GoogleGenAI } from '@google/genai';

@Injectable()
export class AIFilterService {
  private readonly logger = new Logger(AIFilterService.name);
  private ai: GoogleGenAI;

  constructor(private configService: ConfigService) {
    this.ai = new GoogleGenAI({ apiKey: this.configService.get<string>('GEMINI_API_KEY') || 'dummy' });
  }

  async filterAndRank(filePath: string): Promise<any[]> {
    this.logger.log(`Starting Job 2: AI Filter & Ranking on file ${filePath}`);

    const rawData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    try {
      if (this.configService.get<string>('GEMINI_API_KEY')) {
        this.logger.log('Sending data to Gemini API for filtering and ranking');
        
        // Take the first article's content for demonstration to avoid context limits
        // In a real scenario, you'd chunk this or use Gemini's large context window for multiple articles
        const contentToAnalyze = rawData.map((d: any) => `URL: ${d.url}\nTitle: ${d.title}\nContent: ${d.content}`).join('\n\n---\n\n').substring(0, 30000);

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
        resultText = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
        
        const finalTop5 = JSON.parse(resultText);
        this.logger.log(`Job 2 completed. Extracted ${finalTop5.length} articles via Gemini.`);
        return finalTop5;

      } else {
        this.logger.warn('GEMINI_API_KEY is not set. Using mock data.');
        const mockAiFilteredResults = rawData.map((item: any, index: number) => ({
          title: item.title,
          summary: `Tóm tắt bởi AI cho tin: ${item.title}`,
          importanceReason:
            'Tin tức này ảnh hưởng trực tiếp đến lãi suất và dòng tiền đầu tư.',
          impactLevel: index % 2 === 0 ? 'Rất cao' : 'Cao',
          targetAudience: ['Nhà đầu tư', 'Người mua ở thực'],
          expertOpinion:
            'Chuyên gia nhận định đây là thời điểm tốt để xem xét giải ngân.',
          publishDate: item.publishedAt || new Date().toISOString(),
          source: item.source,
          url: item.url,
          keywords: ['Bất động sản', 'Lãi suất', 'Đầu tư'],
        }));

        while (mockAiFilteredResults.length < 5) {
          mockAiFilteredResults.push({
            ...mockAiFilteredResults[0],
            title: `Tin tức bổ sung ${mockAiFilteredResults.length + 1}`,
            url: `https://example.com/news/extra-${mockAiFilteredResults.length + 1}`,
          });
        }

        const finalTop5 = mockAiFilteredResults.slice(0, 5);
        this.logger.log('Job 2 completed. AI filtering and ranking finished (Mock).');
        return finalTop5;
      }
    } catch (error: any) {
      this.logger.error(`Error in Gemini AI filtering: ${error.message}`, error.stack);
      throw error;
    }
  }
}
