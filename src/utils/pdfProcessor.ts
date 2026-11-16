import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { RenderedPage } from '../types/document';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function encodeJpegWithCap(
  canvas: HTMLCanvasElement,
  maxBytes = 1_800_000
): string {
  const qualities = [0.86, 0.78, 0.68, 0.56];
  for (const q of qualities) {
    const url = canvas.toDataURL('image/jpeg', q);
    if (url.length <= maxBytes) return url;
  }
  return canvas.toDataURL('image/jpeg', 0.48);
}

function createOcrDataUrl(sourceCanvas: HTMLCanvasElement, maxDim = 1650): string {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  if (w <= maxDim && h <= maxDim) {
    return encodeJpegWithCap(sourceCanvas);
  }
  const ratio = Math.min(maxDim / w, maxDim / h);
  const targetW = Math.max(1, Math.round(w * ratio));
  const targetH = Math.max(1, Math.round(h * ratio));
  const smallCanvas = document.createElement('canvas');
  smallCanvas.width = targetW;
  smallCanvas.height = targetH;
  const sCtx = smallCanvas.getContext('2d');
  if (!sCtx) {
    return encodeJpegWithCap(sourceCanvas);
  }
  sCtx.fillStyle = '#ffffff';
  sCtx.fillRect(0, 0, targetW, targetH);
  sCtx.drawImage(sourceCanvas, 0, 0, targetW, targetH);
  const url = encodeJpegWithCap(smallCanvas);
  smallCanvas.width = 0;
  smallCanvas.height = 0;
  return url;
}

export async function loadFileAsPages(file: File, dpi = 250): Promise<RenderedPage[]> {
  const isPdf =
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  if (isPdf) {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const pages: RenderedPage[] = [];
    const scale = dpi / 72;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);

      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvasContext: ctx,
        viewport,
        canvas,
      }).promise;

      const dataUrl = canvas.toDataURL('image/jpeg', 0.93);
      const ocrDataUrl = createOcrDataUrl(canvas);
      const pageW = canvas.width;
      const pageH = canvas.height;

      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();

      pages.push({
        pageNumber: pageNum,
        dataUrl,
        ocrDataUrl,
        width: pageW,
        height: pageH,
      });
    }

    return pages;
  }

  // Handle single image file (PNG / JPG / JPEG)
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const maxDim = 2400;
        let targetW = img.naturalWidth;
        let targetH = img.naturalHeight;
        if (targetW > maxDim || targetH > maxDim) {
          const ratio = Math.min(maxDim / targetW, maxDim / targetH);
          targetW = Math.round(targetW * ratio);
          targetH = Math.round(targetH * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Không thể khởi tạo canvas xử lý ảnh.'));
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.drawImage(img, 0, 0, targetW, targetH);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.93);
        const ocrDataUrl = createOcrDataUrl(canvas);
        canvas.width = 0;
        canvas.height = 0;

        resolve([
          {
            pageNumber: 1,
            dataUrl,
            ocrDataUrl,
            width: targetW,
            height: targetH,
          },
        ]);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Không thể đọc tệp ảnh đã chọn.'));
    };
    img.src = objectUrl;
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function cropFiguresFromPage(
  page: RenderedPage,
  boxes: number[][],
  padRatio = 0.014
): Promise<Array<{ dataUrl: string; width: number; height: number } | null>> {
  if (boxes.length === 0) return [];
  const img = await loadImageElement(page.dataUrl);
  if (!img) return boxes.map(() => null);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return boxes.map(() => null);

  const padX = Math.round(page.width * padRatio);
  const padY = Math.round(page.height * padRatio);

  const results = boxes.map((box2d) => {
    if (!box2d || box2d.length !== 4) return null;
    const [ymin, xmin, ymax, xmax] = box2d;

    const left = Math.max(0, Math.floor((xmin * page.width) / 1000) - padX);
    const top = Math.max(0, Math.floor((ymin * page.height) / 1000) - padY);
    const right = Math.min(page.width, Math.ceil((xmax * page.width) / 1000) + padX);
    const bottom = Math.min(page.height, Math.ceil((ymax * page.height) / 1000) + padY);

    const cropW = right - left;
    const cropH = bottom - top;
    if (cropW < 20 || cropH < 20) return null;

    const maxCropDim = 1200;
    const scaleDown =
      cropW > maxCropDim || cropH > maxCropDim
        ? Math.min(maxCropDim / cropW, maxCropDim / cropH)
        : 1;
    const outW = Math.max(20, Math.round(cropW * scaleDown));
    const outH = Math.max(20, Math.round(cropH * scaleDown));

    canvas.width = outW;
    canvas.height = outH;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(img, left, top, cropW, cropH, 0, 0, outW, outH);
    return {
      dataUrl: canvas.toDataURL('image/png'),
      width: outW,
      height: outH,
    };
  });

  canvas.width = 0;
  canvas.height = 0;
  return results;
}

export async function cropFigureFromPage(
  page: RenderedPage,
  box2d: number[],
  padRatio = 0.012
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const [res] = await cropFiguresFromPage(page, [box2d], padRatio);
  return res ?? null;
}

export function generateSampleMathWorksheet(): RenderedPage {
  const width = 1240;
  const height = 1754;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Header
  ctx.fillStyle = '#0f172a';
  ctx.textAlign = 'center';
  ctx.font = 'bold 34px "Times New Roman", serif';
  ctx.fillText('ĐỀ ÔN TẬP GIẢI TÍCH & HÌNH HỌC KHÔNG GIAN', width / 2, 120);

  ctx.font = 'italic 24px "Times New Roman", serif';
  ctx.fillText('Thời gian làm bài: 60 phút — Tài liệu mẫu kiểm thử OCR & OMML', width / 2, 165);

  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(140, 195);
  ctx.lineTo(width - 140, 195);
  ctx.stroke();

  // Question 1
  ctx.textAlign = 'left';
  ctx.font = 'bold 26px "Times New Roman", serif';
  ctx.fillText('Câu 1.', 110, 270);
  ctx.font = '26px "Times New Roman", serif';
  ctx.fillText('Tính tích phân xác định sau:', 210, 270);

  // Integral formula drawn cleanly
  ctx.font = 'italic 44px "Times New Roman", serif';
  ctx.fillText('∫', 450, 365);
  ctx.font = '22px "Times New Roman", serif';
  ctx.fillText('1', 468, 325);
  ctx.fillText('0', 462, 385);

  ctx.font = '28px "Times New Roman", serif';
  ctx.fillText('I =', 390, 358);
  ctx.fillText('2x + 1', 515, 338);
  ctx.beginPath();
  ctx.moveTo(505, 348);
  ctx.lineTo(615, 348);
  ctx.stroke();
  ctx.fillText('x² + x + 1', 508, 378);
  ctx.fillText('dx', 630, 358);

  // Choices
  ctx.font = '25px "Times New Roman", serif';
  ctx.fillText('A. I = ln 3', 150, 445);
  ctx.fillText('B. I = 2 ln 3', 420, 445);
  ctx.fillText('C. I = ln 2', 690, 445);
  ctx.fillText('D. I = 1/2 ln 3', 930, 445);

  // Question 2
  ctx.font = 'bold 26px "Times New Roman", serif';
  ctx.fillText('Câu 2.', 110, 535);
  ctx.font = '26px "Times New Roman", serif';
  ctx.fillText(
    'Cho hàm số y = f(x) có đồ thị parabol như hình vẽ bên dưới. Xác định giá trị cực tiểu:',
    210,
    535
  );

  // Coordinate graph figure
  const gx = 620;
  const gy = 870;
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2;
  // Ox
  ctx.beginPath();
  ctx.moveTo(350, gy);
  ctx.lineTo(890, gy);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(880, gy - 7);
  ctx.lineTo(892, gy);
  ctx.lineTo(880, gy + 7);
  ctx.stroke();
  // Oy
  ctx.beginPath();
  ctx.moveTo(gx, 980);
  ctx.lineTo(gx, 600);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(gx - 7, 612);
  ctx.lineTo(gx, 598);
  ctx.lineTo(gx + 7, 612);
  ctx.stroke();

  // Parabola y = (x-1)^2 - 1 scaled
  ctx.strokeStyle = '#1d4ed8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let px = -140; px <= 210; px += 2) {
    const xVal = px / 70;
    const yVal = (xVal - 0.8) * (xVal - 0.8) - 0.8;
    const screenX = gx + px;
    const screenY = gy - yVal * 90;
    if (px === -140) ctx.moveTo(screenX, screenY);
    else ctx.lineTo(screenX, screenY);
  }
  ctx.stroke();

  ctx.fillStyle = '#0f172a';
  ctx.font = 'italic 22px "Times New Roman", serif';
  ctx.fillText('y', gx + 14, 615);
  ctx.fillText('x', 885, gy + 26);
  ctx.fillText('O', gx - 24, gy + 26);

  ctx.font = 'italic 22px "Times New Roman", serif';
  ctx.textAlign = 'center';
  ctx.fillText('Hình 1: Đồ thị hàm số bậc hai y = f(x)', gx, 1025);

  // Question 3 - System of equations
  ctx.textAlign = 'left';
  ctx.font = 'bold 26px "Times New Roman", serif';
  ctx.fillText('Câu 3.', 110, 1130);
  ctx.font = '26px "Times New Roman", serif';
  ctx.fillText('Giải hệ phương trình sau trên tập số thực ℝ:', 210, 1130);

  ctx.font = '76px "Times New Roman", serif';
  ctx.fillText('{', 390, 1245);
  ctx.font = '27px "Times New Roman", serif';
  ctx.fillText('x² + y² = 13', 440, 1212);
  ctx.fillText('x + y = 5', 440, 1255);

  return {
    pageNumber: 1,
    dataUrl: canvas.toDataURL('image/png'),
    width,
    height,
  };
}
