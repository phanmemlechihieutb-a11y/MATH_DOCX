import 'dotenv/config';
import express from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { PageExtraction } from '../src/types/document.ts';
import { normalizePagesInlineMath } from '../src/utils/latexParser.ts';
import { buildDocxBuffer } from './docxBuilder.ts';
import { latexToOmmlXml } from './omml.ts';

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
    bold: {
      type: Type.BOOLEAN,
      description:
        'True ONLY if the visual stroke weight in the PDF is clearly boldface (thicker/heavier than normal body text). Must be false or omitted for normal-weight text, including non-bold headings, subtitles, italic notes, table headers without bold strokes, and body text after "Câu 1." or "A.".',
    },
    italic: {
      type: Type.BOOLEAN,
      description: 'True only if the text in the PDF is visually italicized/slanted.',
    },
    underline: {
      type: Type.BOOLEAN,
      description: 'True only if the text in the PDF has an explicit underline stroke.',
    },
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
              "One of: 'heading', 'paragraph', 'equation', 'table', 'figure', 'horizontal_rule'. IMPORTANT: Always use 'figure' (never 'table') for variation tables (bảng biến thiên with x, y', y and arrows).",
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
              'Normalized bounding box [ymin, xmin, ymax, xmax] in range 0..1000 for EVERY block on the page. For figure blocks (diagrams, graphs, and variation tables / bảng biến thiên), box_2d MUST tightly yet completely enclose the entire outer border frame, arrows, and all boundary labels/numbers so nothing is clipped.',
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
2. ĐỊNH DẠNG IN ĐẬM / IN NGHIÊNG / GẠCH CHÂN / CỠ CHỮ / MÀU SẮC (ĐÚNG 100% THEO TRANG PDF GỐC):
   - Quan sát kỹ độ dày nét chữ (stroke weight) trên ảnh PDF: CHỈ đặt bold=true cho các từ/cụm từ THỰC SỰ IN ĐẬM (nét chữ dày đậm rõ rệt hơn văn bản thường).
   - MỌI chữ có nét mảnh/bình thường trên PDF — kể cả tiêu đề phụ, dòng căn giữa, dòng cỡ chữ lớn hơn, chữ in nghiêng, ghi chú trong ngoặc, hàng tiêu đề bảng không in đậm, phần đề bài sau "Câu 1.", hoặc nội dung đáp án sau "A.", "B.", "C.", "D." — TUYỆT ĐỐI KHÔNG được gán bold=true (bắt buộc để bold=false hoặc bỏ qua thuộc tính bold).
   - BẮT BUỘC tách thành các segment riêng mỗi khi đổi định dạng trên cùng một dòng! Ví dụ:
     + "Câu 1. Cho hàm số..." -> segment 1 ("Câu 1. ", bold: true), segment 2 ("Cho hàm số...", bold: false). Không được gán bold=true cho cả câu.
     + "A. x = 2" -> nếu chỉ "A." in đậm thì tách segment 1 ("A. ", bold: true) và segment 2 (math "x = 2"); nếu "A." không in đậm thì KHÔNG gán bold=true.
     + Trong block heading hoặc ô bảng is_header=true: hệ thống KHÔNG tự động tô đậm. Chỉ segment nào thực sự in đậm trên PDF mới đặt bold=true; segment nét thường hoặc chỉ in nghiêng phải để bold=false.
3. CĂN LỀ, THỤT ĐẦU DÒNG & BỐ CỤC NHIỀU CỘT:
   - Nhận diện đúng alignment ('left', 'center', 'right', 'justify') cho từng khối và từng ô bảng.
   - Ghi nhận first_line_indent_pt (số dương nếu thụt đầu dòng đoạn văn, số âm như -24 nếu thụt lề treo như "Câu 1. ..."), indent_left_pt nếu cả khối thụt vào so với lề trái chung, và line_spacing (ví dụ 1.15, 1.3).
   - Khi nhiều phần tử nằm ngang hàng trên CÙNG MỘT DÒNG nhưng chia thành các cột rõ rệt (ví dụ: tiêu đề 2 cột "SỞ GD&ĐT... | ĐỀ THI...", hoặc hàng đáp án 4 cột "A. ...  B. ...  C. ...  D. ...", hoặc 2x2 đáp án), HÃY xuất thành block_type="table" với table_borderless=true, kèm width_pct và alignment cho từng ô để vị trí ngang khớp 100% với bản PDF.
   - Với đường kẻ ngang phân cách (như dưới tiêu đề đề thi), xuất block_type="horizontal_rule" kèm box_2d.
4. CÔNG THỨC TOÁN, CHỮ SỐ, DẤU +/- & BẢNG BIỂU:
   - MỌI biểu thức toán học, ký hiệu biến số, phân số, căn thức, tích phân, giới hạn, ma trận, hệ phương trình PHẢI tách thành segment type="math" (nếu nằm cùng dòng với chữ) hoặc block_type="equation" (nếu đứng riêng một dòng độc lập, giữ đúng alignment của công thức). Luôn xuất mã LaTeX chuẩn xác, KHÔNG bọc bằng $, $$, \\[ \\] hay \\( \\).
   - BẮT BUỘC đưa TẤT CẢ các số mang ý nghĩa toán học (số nguyên, số thập phân, số âm/dương như 0, 1, -2, +3, 2,5...) và các dấu cộng (+), dấu trừ (-) đứng riêng hoặc gắn với số (ví dụ: "dấu +", "dấu -", "+∞", "-∞") vào segment type="math" (KHÔNG để ở type="text"). Chỉ giữ trong type="text" các số thứ tự nhãn như "Câu 1.", "Bài 2.", "Hình 1", "Bảng 1".
   - Bảng số liệu thông thường (bảng thống kê, bảng tần số, bảng điểm, bảng giá trị chỉ gồm chữ/số trong ô, KHÔNG có mũi tên biến thiên): BẮT BUỘC giữ nguyên thành block_type="table" với table_borderless=false và is_choice_block=false, ghi đủ 100% số hàng/cột, col_span, is_header và segments.
   - TUYỆT ĐỐI KHÔNG chuyển Bảng biến thiên (bảng có dòng x, y'/f'(x), y/f(x) kèm mũi tên tăng giảm ↗ ↘ hoặc hai gạch đứng ∥) thành block_type="table".
5. HÌNH VẼ MINH HỌA & BẢNG BIẾN THIÊN (CHỤP CẮT ẢNH CHÍNH XÁC):
   - Với mọi hình học không gian/phẳng, đồ thị hàm số, biểu đồ, ảnh chụp nhúng VÀ MỌI BẢNG BIẾN THIÊN (có dòng x, y'/f'(x), y/f(x) và mũi tên ↗, ↘, dấu +, -, hai gạch đứng ∥), BẮT BUỘC phải xuất thành block_type="figure", alignment đúng vị trí ('left'/'center'/'right').
   - Tọa độ box_2d=[ymin, xmin, ymax, xmax] phải cực kỳ chính xác: ÔM TRỌN 100% cả 4 cạnh đường viền khung bảng biến thiên/hình vẽ, tất cả nhãn đỉnh (A, B, C, S, O, x, y, y'), mũi tên và các giá trị ở mép trên/dưới (+∞, -∞, cực trị) với một khoảng hở mép ngoài an toàn nhẹ để không bị cắt mất nét viền hay con số, đồng thời KHÔNG lấn vào dòng chữ đề bài phía trên hay đáp án phía dưới.
6. Giữ nguyên ngôn ngữ gốc, chính tả, dấu câu và không tự ý thêm nội dung không có trên trang.
7. TỐI ƯU TỐC ĐỘ JSON: Chỉ xuất các trường tùy chọn (bold, italic, underline, font_size_pt, color, tab_before, heading_level, indent_left_pt, first_line_indent_pt, tab_stops_pt, table_borderless, is_choice_block, alignment/width_pct/col_span của ô, caption) khi có giá trị thực sự là true hoặc khác null/0. TUYỆT ĐỐI KHÔNG gộp segment khiến chữ thường bị gán nhầm bold=true.`;

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
    const maxRetries = 1;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const thinkingLevel = ThinkingLevel.LOW;
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
                text: `Hãy trích xuất toàn bộ nội dung trang ${pageNumber} theo đúng schema JSON, tách chuẩn công thức LaTeX, tọa độ hình vẽ và giữ chính xác tuyệt đối định dạng in đậm/in nghiêng/chữ thường theo bản PDF gốc (chỗ nào không in đậm tuyệt đối không đánh dấu bold=true).`,
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
            break;
          }
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, 600));
            continue;
          }
          break;
        }

        if (isTransientServerError(err, msg) && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }

        throw err;
      }
    }
  }

  throw lastError;
}

export type RequestWithOptionalBody = IncomingMessage & { body?: unknown };

async function readJsonBody<T = Record<string, unknown>>(req: RequestWithOptionalBody): Promise<T> {
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) {
      const txt = req.body.toString('utf8').trim();
      return (txt ? JSON.parse(txt) : {}) as T;
    }
    if (typeof req.body === 'string') {
      const txt = req.body.trim();
      return (txt ? JSON.parse(txt) : {}) as T;
    }
    if (typeof req.body === 'object') {
      return req.body as T;
    }
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return (raw ? JSON.parse(raw) : {}) as T;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export async function handleOcrPage(req: RequestWithOptionalBody, res: ServerResponse): Promise<void> {
  if (req.method && req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  try {
    const body = await readJsonBody<{
      imageDataUrl?: string;
      pageNumber?: number;
      speedMode?: 'fast' | 'accurate';
    }>(req);

    const { imageDataUrl, pageNumber, speedMode } = body;

    if (!imageDataUrl || typeof imageDataUrl !== 'string') {
      sendJson(res, 400, { error: 'Thiếu dữ liệu ảnh trang cần nhận dạng.' });
      return;
    }

    const match = imageDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) {
      sendJson(res, 400, { error: 'Định dạng ảnh base64 không hợp lệ.' });
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
    const rawBlocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
    const [normalizedPage] = normalizePagesInlineMath([
      { pageNumber: pageNumber ?? 1, blocks: rawBlocks },
    ]);
    sendJson(res, 200, {
      pageNumber: pageNumber ?? 1,
      blocks: normalizedPage?.blocks ?? rawBlocks,
    });
  } catch (err: unknown) {
    const message = getErrorMessage(err) || 'Lỗi không xác định khi gọi Gemini OCR.';
    if (message === 'MISSING_API_KEY') {
      sendJson(res, 500, {
        error: 'Chưa cấu hình GEMINI_API_KEY trong biến môi trường của máy chủ (Secrets / Environment Variables).',
      });
      return;
    }
    if (message.includes('PERMISSION_DENIED') || message.includes('API_KEY_INVALID')) {
      sendJson(res, 403, {
        error: 'API Key không hợp lệ hoặc bị từ chối quyền. Vui lòng kiểm tra lại GEMINI_API_KEY.',
      });
      return;
    }
    if (isQuotaOrRateLimitError(err, message)) {
      sendJson(res, 429, {
        error:
          'Đã vượt quá hạn mức miễn phí (Quota 429) của Gemini API trên tất cả model khả dụng. Vui lòng thử lại sau ít phút hoặc dùng API Key có bật thanh toán (Billing).',
      });
      return;
    }
    sendJson(res, 500, { error: `Lỗi OCR trang: ${message}` });
  }
}

export async function handleOmmlPreview(req: RequestWithOptionalBody, res: ServerResponse): Promise<void> {
  if (req.method && req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  try {
    const body = await readJsonBody<{
      equations?: Array<{ latex: string; isDisplay: boolean }>;
    }>(req);

    const { equations } = body;
    if (!Array.isArray(equations)) {
      sendJson(res, 400, { error: 'Thiếu danh sách công thức.' });
      return;
    }
    const results = equations.map((item) => ({
      latex: item.latex,
      isDisplay: Boolean(item.isDisplay),
      omml: latexToOmmlXml(item.latex, Boolean(item.isDisplay)) ?? '',
    }));
    sendJson(res, 200, { results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Lỗi tạo OMML.';
    sendJson(res, 500, { error: message });
  }
}

export async function handleExportDocx(req: RequestWithOptionalBody, res: ServerResponse): Promise<void> {
  if (req.method && req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  try {
    const body = await readJsonBody<{
      pages?: PageExtraction[];
      filename?: string;
      addPageBreaks?: boolean;
      choiceLayout?: 'table' | 'tabs';
      mathFormat?: 'omml' | 'latex';
    }>(req);

    const { pages, filename, addPageBreaks, choiceLayout, mathFormat } = body;

    if (!Array.isArray(pages) || pages.length === 0) {
      sendJson(res, 400, { error: 'Chưa có dữ liệu trang đã OCR để xuất file Word.' });
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
    res.statusCode = 200;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${safeBase}_${suffix}.docx"`);
    res.end(buffer);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Lỗi xuất file Word.';
    sendJson(res, 500, { error: `Không thể tạo file Word: ${message}` });
  }
}

export function createApiApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  app.post('/api/ocr/page', (req, res) => {
    void handleOcrPage(req, res);
  });

  app.post('/api/omml/preview', (req, res) => {
    void handleOmmlPreview(req, res);
  });

  app.post('/api/export/docx', (req, res) => {
    void handleExportDocx(req, res);
  });

  return app;
}
