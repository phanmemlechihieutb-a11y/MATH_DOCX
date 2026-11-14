import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { PageExtraction } from './src/types/document.ts';
import { buildDocxBuffer } from './server/docxBuilder.ts';
import { latexToOmmlXml } from './server/omml.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

let cachedAiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('MISSING_API_KEY');
  }
  if (!cachedAiClient) {
    cachedAiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedAiClient;
}

const inlineSegmentSchema = {
  type: Type.OBJECT,
  properties: {
    type: {
      type: Type.STRING,
      description: "Exactly 'text' for normal prose or 'math' for inline LaTeX math.",
    },
    content: {
      type: Type.STRING,
      description: 'Text content or pure LaTeX without $ or \\( \\) delimiters.',
    },
    bold: { type: Type.BOOLEAN },
    italic: { type: Type.BOOLEAN },
    underline: { type: Type.BOOLEAN },
    font_size_pt: {
      type: Type.NUMBER,
      description: 'Optional font size in pt when different from block font_size_pt.',
    },
    color: {
      type: Type.STRING,
      description: 'Optional 6-digit hex color like #1D4ED8 if not black.',
    },
    tab_before: {
      type: Type.BOOLEAN,
      description: 'True if a tab stop precedes this segment on the same line.',
    },
  },
  required: ['type', 'content'],
};

const pageExtractionSchema = {
  type: Type.OBJECT,
  properties: {
    blocks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          block_type: {
            type: Type.STRING,
            description:
              "One of: 'heading', 'paragraph', 'equation', 'table', 'figure', 'horizontal_rule'.",
          },
          alignment: {
            type: Type.STRING,
            description: "One of: 'left', 'center', 'right', 'justify'.",
          },
          heading_level: {
            type: Type.INTEGER,
            description: '1, 2, or 3 when block_type is heading.',
          },
          font_size_pt: {
            type: Type.NUMBER,
            description: 'Estimated font size in points (e.g., 11, 12, 13, 14, 16) matching the PDF.',
          },
          line_spacing: {
            type: Type.NUMBER,
            description: 'Line spacing multiplier (e.g., 1.0, 1.15, 1.3, 1.5).',
          },
          indent_left_pt: {
            type: Type.NUMBER,
            description: 'Extra left indentation in points relative to the main page left margin.',
          },
          first_line_indent_pt: {
            type: Type.NUMBER,
            description:
              'First-line indent in points (positive for indented paragraph, negative for hanging indent like Câu 1.).',
          },
          tab_stops_pt: {
            type: Type.ARRAY,
            items: { type: Type.NUMBER },
            description: 'Tab stop X positions in points from the page left margin if tabs are used.',
          },
          segments: {
            type: Type.ARRAY,
            items: inlineSegmentSchema,
            description: 'Ordered inline text/math segments for heading or paragraph.',
          },
          latex: {
            type: Type.STRING,
            description: 'Pure LaTeX for standalone display equation (without $$).',
          },
          table_borderless: {
            type: Type.BOOLEAN,
            description:
              'True when using a borderless grid to preserve multi-column headers, 2-col/4-col answer choices (A, B, C, D), or side-by-side layout.',
          },
          is_choice_block: {
            type: Type.BOOLEAN,
            description:
              'True when this block represents multiple-choice options (e.g. A., B., C., D. or a), b), c), d)).',
          },
          table_rows: {
            type: Type.ARRAY,
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  segments: {
                    type: Type.ARRAY,
                    items: inlineSegmentSchema,
                  },
                  is_header: { type: Type.BOOLEAN },
                  alignment: {
                    type: Type.STRING,
                    description: "Cell horizontal alignment: 'left', 'center', 'right', 'justify'.",
                  },
                  width_pct: {
                    type: Type.NUMBER,
                    description: 'Approximate column width percentage (0..100) matching the PDF.',
                  },
                  col_span: {
                    type: Type.INTEGER,
                    description: 'Number of columns spanned by this cell (default 1).',
                  },
                },
                required: ['segments'],
              },
            },
          },
          box_2d: {
            type: Type.ARRAY,
            items: { type: Type.INTEGER },
            description:
              'Normalized bounding box [ymin, xmin, ymax, xmax] in range 0..1000 for EVERY block on the page (essential for exact positions, spacing, margins, and figure cropping).',
          },
          caption: {
            type: Type.STRING,
            description: 'Optional caption below figure.',
          },
        },
        required: ['block_type', 'alignment', 'box_2d'],
      },
    },
  },
  required: ['blocks'],
};

const OCR_SYSTEM_INSTRUCTION = `Bạn là chuyên gia số hóa tài liệu Toán học (OCR & Tái tạo bố cục 100% chuẩn xác) từ PDF/ảnh sang Word (.docx).
Hãy phân tích chính xác trang tài liệu theo đúng thứ tự đọc từ trên xuống dưới và trả về JSON theo đúng schema để bản Word giống hệt trang PDF gốc về vị trí, căn lề và định dạng chữ.

Quy tắc bắt buộc:
1. TỌA ĐỘ & VỊ TRÍ CHÍNH XÁC (box_2d):
   - BẮT BUỘC trả về box_2d=[ymin, xmin, ymax, xmax] trên thang chuẩn hóa 0..1000 cho MỌI khối (heading, paragraph, equation, table, figure, horizontal_rule).
   - Hệ thống dùng box_2d để tính chính xác lề trang, khoảng cách dọc giữa các đoạn, vị trí thụt lề ngang, độ rộng hình vẽ và bố cục đặt cạnh nhau (ví dụ: đề bài bên trái, hình vẽ bên phải).
2. ĐỊNH DẠNG IN ĐẬM / IN NGHIÊNG / GẠCH CHÂN / CỠ CHỮ / MÀU SẮC:
   - Tách từng đoạn chữ có định dạng khác nhau thành các segment riêng biệt với bold, italic, underline, font_size_pt, color chính xác từng từ/cụm từ!
   - TUYỆT ĐỐI KHÔNG tự ý đánh dấu bold=true cho toàn bộ câu nếu chỉ có nhãn "Câu 1.", "Bài 1.", "Lời giải:", "Đáp án:" được in đậm. Ví dụ: segment 1 ("Câu 1. ", bold: true), segment 2 ("Tính tích phân:", bold: false).
   - Với heading cũng phải ghi rõ bold/italic từng segment đúng như bản gốc (ví dụ dòng phụ đề in nghiêng không đậm phải để bold: false, italic: true).
3. CĂN LỀ, THỤT ĐẦU DÒNG & BỐ CỤC NHIỀU CỘT:
   - Nhận diện đúng alignment ('left', 'center', 'right', 'justify') cho từng khối và từng ô bảng.
   - Ghi nhận first_line_indent_pt (số dương nếu thụt đầu dòng đoạn văn, số âm như -24 nếu thụt lề treo như "Câu 1. ..."), indent_left_pt nếu cả khối thụt vào so với lề trái chung, và line_spacing (ví dụ 1.15, 1.3).
   - Khi nhiều phần tử nằm ngang hàng trên CÙNG MỘT DÒNG nhưng chia thành các cột rõ rệt (ví dụ: tiêu đề 2 cột "SỞ GD&ĐT... | ĐỀ THI...", hoặc hàng đáp án 4 cột "A. ...  B. ...  C. ...  D. ...", hoặc 2x2 đáp án), HÃY xuất thành block_type="table" với table_borderless=true, kèm width_pct và alignment cho từng ô để vị trí ngang khớp 100% với bản PDF.
   - Với đường kẻ ngang phân cách (như dưới tiêu đề đề thi), xuất block_type="horizontal_rule" kèm box_2d.
4. CÔNG THỨC TOÁN & BẢNG BIỂU (BẮT BUỘC GIỮ NGUYÊN MỌI BẢNG BIỂU):
   - MỌI biểu thức toán học, ký hiệu biến số, phân số, căn thức, tích phân, giới hạn, ma trận, hệ phương trình phải tách thành segment type="math" (nếu nằm cùng dòng với chữ) hoặc block_type="equation" (nếu đứng riêng một dòng độc lập, giữ đúng alignment của công thức). Luôn xuất mã LaTeX chuẩn xác, KHÔNG bọc bằng $, $$, \\[ \\] hay \\( \\).
   - TUYỆT ĐỐI KHÔNG LÀM MẤT BẢNG BIỂU từ tài liệu gốc: mọi bảng có đường kẻ khung (bảng số liệu, bảng thống kê, bảng tần số, bảng điểm, bảng giá trị, bảng xét dấu, bảng biến thiên, bảng ma trận/so sánh dù 2 cột hay nhiều cột) BẮT BUỘC phải xuất thành block_type="table" với table_borderless=false và is_choice_block=false (KHÔNG bao giờ chuyển bảng có viền thành paragraph hay bỏ qua). Ghi đủ 100% số hàng, số cột (kể cả ô trống dùng segments: []), col_span chính xác khi có ô gộp, is_header=true cho hàng tiêu đề, alignment từng ô và nội dung segments text/math đầy đủ.
5. HÌNH VẼ MINH HỌA:
   - Với mọi hình học không gian/phẳng, đồ thị hàm số, biểu đồ hoặc ảnh chụp nhúng trong trang, xuất block_type="figure", alignment đúng vị trí ('left'/'center'/'right') và box_2d=[ymin, xmin, ymax, xmax] ôm trọn cả nhãn đỉnh (A, B, C, S, O, x, y...) để không bị cắt mất ký hiệu.
6. Giữ nguyên ngôn ngữ gốc, chính tả, dấu câu và không tự ý thêm nội dung không có trên trang.
7. TỐI ƯU TỐC ĐỘ JSON: Chỉ xuất các trường tùy chọn (bold, italic, underline, font_size_pt, color, tab_before, heading_level, indent_left_pt, first_line_indent_pt, tab_stops_pt, table_borderless, is_choice_block, alignment/width_pct/col_span của ô, caption) khi có giá trị thực sự cần thiết (true hoặc khác null/0). BỎ QUA không ghi các thuộc tính giá trị false hoặc null.`;

const OCR_MODELS_FAST = ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'] as const;
const OCR_MODELS_ACCURATE = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const;
const DAILY_QUOTA_COOLDOWN_MS = 10 * 60 * 1000;
const modelCooldownUntil = new Map<string, number>();

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function isQuotaOrRateLimitError(err: unknown, msg: string): boolean {
  const status = (err as { status?: number })?.status;
  return (
    status === 429 ||
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.toLowerCase().includes('quota')
  );
}

function isDailyQuotaError(msg: string): boolean {
  return (
    msg.includes('PerDay') ||
    msg.includes('GenerateRequestsPerDay') ||
    /retry in \d+[hm]/i.test(msg)
  );
}

function isTransientServerError(err: unknown, msg: string): boolean {
  const status = (err as { status?: number })?.status;
  return status === 503 || msg.includes('503') || msg.includes('UNAVAILABLE');
}

async function generateOcrWithModelFallback(
  ai: GoogleGenAI,
  mimeType: string,
  base64Data: string,
  pageNumber: number,
  speedMode: 'fast' | 'accurate' = 'fast'
) {
  const orderedModels = speedMode === 'accurate' ? OCR_MODELS_ACCURATE : OCR_MODELS_FAST;
  const now = Date.now();
  const activeModels = orderedModels.filter((m) => (modelCooldownUntil.get(m) ?? 0) <= now);
  const modelsToTry = activeModels.length > 0 ? activeModels : [...orderedModels];

  let lastError: unknown;

  for (const model of modelsToTry) {
    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const thinkingLevel =
          model === 'gemini-3.1-flash-lite' ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW;
        return await ai.models.generateContent({
          model,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: base64Data,
                },
              },
              {
                text: `Hãy trích xuất toàn bộ nội dung trang ${pageNumber} theo đúng schema JSON, tách chuẩn công thức LaTeX và tọa độ hình vẽ.`,
              },
            ],
          },
          config: {
            systemInstruction: OCR_SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            responseSchema: pageExtractionSchema,
            thinkingConfig: { thinkingLevel },
          },
        });
      } catch (err: unknown) {
        lastError = err;
        const msg = getErrorMessage(err);

        if (isQuotaOrRateLimitError(err, msg)) {
          if (isDailyQuotaError(msg)) {
            modelCooldownUntil.set(model, Date.now() + DAILY_QUOTA_COOLDOWN_MS);
            break; // Immediately switch to fallback model
          }
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            continue;
          }
          break; // Exhausted retries on this model; try next fallback model
        }

        if (isTransientServerError(err, msg) && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          continue;
        }

        throw err;
      }
    }
  }

  throw lastError;
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  app.post('/api/ocr/page', async (req, res) => {
    try {
      const { imageDataUrl, pageNumber, speedMode } = req.body as {
        imageDataUrl?: string;
        pageNumber?: number;
        speedMode?: 'fast' | 'accurate';
      };

      if (!imageDataUrl || typeof imageDataUrl !== 'string') {
        res.status(400).json({ error: 'Thiếu dữ liệu ảnh trang cần nhận dạng.' });
        return;
      }

      const match = imageDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!match) {
        res.status(400).json({ error: 'Định dạng ảnh base64 không hợp lệ.' });
        return;
      }

      const mimeType = match[1];
      const base64Data = match[2];
      const ai = getGeminiClient();

      const response = await generateOcrWithModelFallback(
        ai,
        mimeType,
        base64Data,
        pageNumber ?? 1,
        speedMode === 'accurate' ? 'accurate' : 'fast'
      );

      const rawJson = (response.text ?? '{"blocks":[]}').trim();
      const parsed = JSON.parse(rawJson) as { blocks?: PageExtraction['blocks'] };
      res.json({
        pageNumber: pageNumber ?? 1,
        blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
      });
    } catch (err: unknown) {
      const message = getErrorMessage(err) || 'Lỗi không xác định khi gọi Gemini OCR.';
      if (message === 'MISSING_API_KEY') {
        res.status(500).json({
          error: 'Chưa cấu hình GEMINI_API_KEY trong bảng Settings > Secrets của AI Studio.',
        });
        return;
      }
      if (message.includes('PERMISSION_DENIED') || message.includes('API_KEY_INVALID')) {
        res.status(403).json({
          error: 'API Key không hợp lệ hoặc bị từ chối quyền. Vui lòng kiểm tra trong Settings > Secrets.',
        });
        return;
      }
      if (isQuotaOrRateLimitError(err, message)) {
        res.status(429).json({
          error:
            'Đã vượt quá hạn mức miễn phí (Quota 429) của Gemini API trên tất cả model khả dụng. Vui lòng thử lại sau ít phút hoặc chọn API Key có bật thanh toán (Billing) trong Settings > Secrets để tăng hạn mức.',
        });
        return;
      }
      res.status(500).json({ error: `Lỗi OCR trang: ${message}` });
    }
  });

  app.post('/api/omml/preview', (req, res) => {
    try {
      const { equations } = req.body as {
        equations?: Array<{ latex: string; isDisplay: boolean }>;
      };
      if (!Array.isArray(equations)) {
        res.status(400).json({ error: 'Thiếu danh sách công thức.' });
        return;
      }
      const results = equations.map((item) => ({
        latex: item.latex,
        isDisplay: Boolean(item.isDisplay),
        omml: latexToOmmlXml(item.latex, Boolean(item.isDisplay)) ?? '',
      }));
      res.json({ results });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Lỗi tạo OMML.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/export/docx', async (req, res) => {
    try {
      const { pages, filename, addPageBreaks, choiceLayout, mathFormat } = req.body as {
        pages?: PageExtraction[];
        filename?: string;
        addPageBreaks?: boolean;
        choiceLayout?: 'table' | 'tabs';
        mathFormat?: 'omml' | 'latex';
      };

      if (!Array.isArray(pages) || pages.length === 0) {
        res.status(400).json({ error: 'Chưa có dữ liệu trang đã OCR để xuất file Word.' });
        return;
      }

      const resolvedMathFormat = mathFormat === 'latex' ? 'latex' : 'omml';

      const buffer = await buildDocxBuffer(pages, {
        addPageBreaks: addPageBreaks !== false,
        choiceLayout: choiceLayout === 'table' ? 'table' : 'tabs',
        mathFormat: resolvedMathFormat,
      });

      const safeBase = (filename || 'tai_lieu_toan')
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_');

      const suffix = resolvedMathFormat === 'latex' ? 'LaTeX' : 'OMML';
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${safeBase}_${suffix}.docx"`);
      res.send(buffer);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Lỗi xuất file Word.';
      res.status(500).json({ error: `Không thể tạo file Word: ${message}` });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MathDocx Studio server listening on http://localhost:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
