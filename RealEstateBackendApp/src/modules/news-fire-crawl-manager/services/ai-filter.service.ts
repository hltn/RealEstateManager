import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import { GoogleGenAI } from '@google/genai';

const RAW_ARTICLES_PROMPT = `Từ bây giờ, hãy đóng vai một Chief Real Estate Intelligence Analyst với hơn 20 năm kinh nghiệm trong lĩnh vực:
- Bất động sản Việt Nam.
- Bất động sản Hà Nội.
- Phân tích kinh tế vĩ mô.
- Chính sách tiền tệ.
- Quy hoạch đô thị.
- Quy hoạch giao thông.
- Hạ tầng.
- Đầu tư.
- Luật Đất đai.
- Luật Nhà ở.
- Luật Kinh doanh bất động sản.
- Quy hoạch vùng Thủ đô.
- Phân tích dữ liệu.
- Báo chí.

Dựa trên tiêu đề, mô tả (nếu có) hãy lọc ra các tin tức có liên quan tới các chủ đề sau:
Nhóm 1 – Bất động sản (Chính sách mới, Dự án lớn, Giá nhà, Giá đất, Chung cư, Biệt thự, Nhà phố, Văn phòng, Khách sạn, Bất động sản công nghiệp, Đấu giá đất, Đấu thầu dự án, Thanh tra, Nguồn cung, Giao dịch, Tín dụng bất động sản).
Nhóm 2 – Kinh tế vĩ mô (Lãi suất, Tăng trưởng GDP, CPI, Tỷ giá, Tín dụng, Trái phiếu, Đầu tư công, FDI, Thuế, Ngân hàng).
Nhóm 3 – Chính trị (Nghị quyết, Quyết định, Chỉ thị, Chủ trương, Phiên họp Chính phủ, Quốc hội, UBND Hà Nội).
Nhóm 4 – Quy hoạch (Quy hoạch Hà Nội, Quy hoạch phân khu, Quy hoạch chi tiết, Quy hoạch đô thị, Điều chỉnh quy hoạch, Thành phố mới, Vành đai, Cầu, Metro, Cao tốc, Đường sắt, Sân bay).
Nhóm 5 – Pháp luật (Luật Đất đai, Luật Nhà ở, Luật Kinh doanh bất động sản, Thuế bất động sản, Quy định cấp sổ, Chuyển mục đích sử dụng đất, Bồi thường, Giải phóng mặt bằng, Đấu giá, Định giá đất).

Các tin mang chủ đề vi mô cần tập trung vào hà nội, các địa danh liên quan tới hà nội, tránh lan man ra các tỉnh thành khác. 

Sau khi xác định xong các tin với yêu cầu trên hãy trả về dữ liệu json dạng mảng chứa các object:
{
"urlHash": "",
"title":""
}`;

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
    const model = this.configService.get<string>('OPENROUTER_AI_MODEL') || process.env.OPENROUTER_AI_MODEL || 'google/gemini-2.5-flash';
    
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
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);

        try {
          if (openRouterApiKey) {
            this.logger.log('Using OpenRouter API');
            const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${openRouterApiKey}`,
                'Content-Type': 'application/json'
              },
              signal: controller.signal as any,
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
        } catch (err: any) {
          if (err.name === 'AbortError') {
            throw new Error('AI API request timed out after 60 seconds');
          }
          throw err;
        } finally {
          clearTimeout(timeoutId);
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

  async filterRawArticles(articles: any[]): Promise<any[]> {
    this.logger.log(`Starting AI Filter Raw Articles`);
    if (!articles || articles.length === 0) return [];

    const activePlatform = this.configService.get<string>('ACTIVE_AI_PLATFORM') || process.env.ACTIVE_AI_PLATFORM || 'OpenRouter';

    const contentToAnalyze = articles
      .map(
        (d: any) =>
          `urlHash: ${d.urlHash || d._id}\nTitle: ${d.title}\nDescription: ${d.description || ''}`,
      )
      .join('\n\n---\n\n')
      .substring(0, 60000); // chunk if needed

    const fullPrompt = `${RAW_ARTICLES_PROMPT}\n\nData to analyze:\n${contentToAnalyze}`;

    let resultText = '[]';
    
    const openRouterApiKey = this.configService.get<string>('OPENROUTER_API_KEY') || process.env.OPENROUTER_API_KEY;
    const openRouterModel = this.configService.get<string>('OPENROUTER_AI_MODEL') || process.env.OPENROUTER_AI_MODEL || 'google/gemini-2.5-flash';
    
    const must1cApiKey = this.configService.get<string>('MUST1C_API_KEY') || process.env.MUST1C_API_KEY;
    const must1cModel = this.configService.get<string>('MUST1C_MODEL') || process.env.MUST1C_MODEL;
    const must1cApiUrl = this.configService.get<string>('MUST1C_API_URL') || process.env.MUST1C_API_URL || 'https://htmustc.id.vn/v1/chat/completions';

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      try {
        if (activePlatform === 'Must1c' && must1cApiKey) {
          this.logger.log('Using Must1c API');
          const res = await fetch(must1cApiUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${must1cApiKey}`,
              'Content-Type': 'application/json'
            },
            signal: controller.signal as any,
            body: JSON.stringify({
              model: must1cModel || 'gemini-3.6-flash',
              messages: [{ role: 'user', content: fullPrompt }]
            })
          });

          if (!res.ok) {
            const errBody = await res.text();
            let errorMessage = errBody;
            try {
              const parsed = JSON.parse(errBody);
              errorMessage = parsed.error?.message || errBody;
            } catch (e) {}

            let errorDesc = 'Unknown error';
            switch (res.status) {
              case 400: errorDesc = 'Invalid request or missing parameter (invalid_request_error)'; break;
              case 401: errorDesc = 'Invalid API key (authentication_error)'; break;
              case 402: errorDesc = 'Insufficient wallet balance (insufficient_quota)'; break;
              case 403: errorDesc = 'Key lacks permission (permission_error)'; break;
              case 429: errorDesc = 'Rate limit exceeded (rate_limit_error)'; break;
              case 500:
              case 502: errorDesc = 'Internal gateway/upstream error (api_error)'; break;
            }
            throw new Error(`Must1c API error: ${res.status} - ${errorDesc}. Details: ${errorMessage}`);
          }
          
          const data = await res.json();
          resultText = data.choices?.[0]?.message?.content || '[]';
        } else if (openRouterApiKey) {
          this.logger.log('Using OpenRouter API');
          const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openRouterApiKey}`,
              'Content-Type': 'application/json'
            },
            signal: controller.signal as any,
            body: JSON.stringify({
              model: openRouterModel,
              messages: [{ role: 'user', content: fullPrompt }]
            })
          });

          if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`OpenRouter API error: ${res.status} - ${errBody}`);
          }
          
          const data = await res.json();
          resultText = data.choices?.[0]?.message?.content || '[]';
        } else {
           throw new BadRequestException('No AI platform configured');
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          throw new Error('AI API request timed out after 60 seconds');
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }

      resultText = resultText
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();
        
      try {
        const parsed = JSON.parse(resultText);
        return parsed;
      } catch (parseError: any) {
        throw new Error(`JSON parsing failed: ${parseError.message}. Raw text: ${resultText.substring(0, 100)}...`);
      }
    } catch (error: any) {
      this.logger.error(`Error in filterRawArticles: ${error.message}`, error.stack);
      throw new BadRequestException(`Error in AI filter: ${error.message}`);
    }
  }
}
