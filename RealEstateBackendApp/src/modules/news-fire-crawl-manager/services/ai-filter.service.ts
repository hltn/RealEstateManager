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

    // Check OpenRouter first, fallback to Gemini
    const openRouterApiKey = this.configService.get<string>('OPENROUTER_API_KEY') || process.env.OPENROUTER_API_KEY;
    const model = this.configService.get<string>('AI_MODEL') || process.env.AI_MODEL || 'google/gemini-2.5-flash';
    
    const geminiApiKey = this.configService.get<string>('GEMINI_API_KEY');
    
    if (!openRouterApiKey && (!geminiApiKey || geminiApiKey === 'your_gemini_api_key_here')) {
      this.logger.error('No valid AI API Key found (neither OpenRouter nor Gemini).');
      throw new BadRequestException('AI API Key is not set or invalid.');
    }

    try {
        this.logger.log(`Sending data to AI API for filtering and ranking (Model: ${model})`);

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

        let resultText = '[]';

        if (openRouterApiKey) {
          this.logger.log('Using OpenRouter API');
          const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openRouterApiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: model,
              messages: [{ role: 'user', content: prompt }]
            })
          });

          if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`OpenRouter API error: ${res.status} - ${errBody}`);
          }
          
          const data = await res.json();
          resultText = data.choices?.[0]?.message?.content || '[]';
        } else {
          this.logger.log('Using Gemini Native API');
          const response = await this.ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
          });
          resultText = response.text || '[]';
        }

        // Cleanup potential markdown wrappers
        resultText = resultText
          .replace(/```json/g, '')
          .replace(/```/g, '')
          .trim();

        const finalTop5 = JSON.parse(resultText);
        this.logger.log(
          `Job 2 completed. Extracted ${finalTop5.length} articles via AI.`,
        );
        return finalTop5;
      } catch (error: any) {
      this.logger.error(
        `Error in AI filtering: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(`Error in AI filtering: ${error.message}`);
    }
  }
}
