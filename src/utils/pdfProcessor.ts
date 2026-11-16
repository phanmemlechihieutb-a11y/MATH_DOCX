import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { RenderedPage } from '../types/document';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function encodeJpegWithCap(
  canvas: HTMLCanvasElement,
  maxBytes = 2_300_000
): string {
  const qualities = [0.90, 0.82, 0.72, 0.60];
  for (const q of qualities) {
    const url = canvas.toDataURL('image/jpeg', q);
    if (url.length <= maxBytes) return url;
  }
  return canvas.toDataURL('image/jpeg', 0.50);
}

function createOcrDataUrl(sourceCanvas: HTMLCanvasElement, maxDim = 2000): string {
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

function isInkPixel(
  data: Uint8ClampedArray,
  idx: number,
  threshold = 235
): boolean {
  const r = data[idx];
  const g = data[idx + 1];
  const b = data[idx + 2];
  const a = data[idx + 3];
  if (a < 20) return false;
  return r < threshold || g < threshold || b < threshold;
}

function expandCropToInkBounds(
  ctx: CanvasRenderingContext2D,
  pageW: number,
  pageH: number,
  rawLeft: number,
  rawTop: number,
  rawRight: number,
  rawBottom: number,
  neighborBoxes: number[][] = []
): { left: number; top: number; right: number; bottom: number } {
  const maxLeft = Math.max(0, rawLeft - Math.round(pageW * 0.16));
  const maxRight = Math.min(pageW, rawRight + Math.round(pageW * 0.16));
  const maxTop = Math.max(0, rawTop - Math.round(pageH * 0.12));
  const maxBottom = Math.min(pageH, rawBottom + Math.round(pageH * 0.18));

  let overlappingTopMaxY = -1;

  for (const nb of neighborBoxes) {
    if (!Array.isArray(nb) || nb.length !== 4) continue;
    const [ny1, nx1, ny2, nx2] = nb;
    const nTop = Math.floor((ny1 * pageH) / 1000);
    const nLeft = Math.floor((nx1 * pageW) / 1000);
    const nBottom = Math.ceil((ny2 * pageH) / 1000);
    const nRight = Math.ceil((nx2 * pageW) / 1000);

    const horizOverlap = Math.min(nRight, maxRight) - Math.max(nLeft, maxLeft);
    if (
      horizOverlap > 20 &&
      nTop < rawTop - 4 &&
      nBottom > rawTop &&
      nBottom < rawTop + Math.min(Math.round(pageH * 0.05), (rawBottom - rawTop) * 0.28)
    ) {
      overlappingTopMaxY = Math.max(overlappingTopMaxY, nBottom);
    }
  }

  const roiW = maxRight - maxLeft;
  const roiH = maxBottom - maxTop;
  if (roiW < 20 || roiH < 20) {
    return { left: rawLeft, top: rawTop, right: rawRight, bottom: rawBottom };
  }

  let imgData: ImageData;
  try {
    imgData = ctx.getImageData(maxLeft, maxTop, roiW, roiH);
  } catch {
    return { left: rawLeft, top: rawTop, right: rawRight, bottom: rawBottom };
  }

  const data = imgData.data;
  const inkAt = (rx: number, ry: number, thresh = 235): boolean => {
    if (rx < 0 || rx >= roiW || ry < 0 || ry >= roiH) return false;
    return isInkPixel(data, (ry * roiW + rx) * 4, thresh);
  };

  // Detect >=2 ink pixels OR any 1px thin/gray vertical or horizontal stroke connected along the axis
  const colHasInk = (absX: number, absY1: number, absY2: number): boolean => {
    const rx = absX - maxLeft;
    if (rx < 0 || rx >= roiW) return false;
    const ry1 = Math.max(0, absY1 - maxTop);
    const ry2 = Math.min(roiH - 1, absY2 - maxTop - 1);
    let hits = 0;
    for (let ry = ry1; ry <= ry2; ry++) {
      if (inkAt(rx, ry, 235)) {
        hits++;
        if (hits >= 2) return true;
        if (inkAt(rx, ry, 218) && (inkAt(rx - 1, ry, 232) || inkAt(rx + 1, ry, 232))) {
          return true;
        }
      }
    }
    return false;
  };

  const countRowInk = (absY: number, absX1: number, absX2: number): number => {
    const ry = absY - maxTop;
    if (ry < 0 || ry >= roiH) return 0;
    const rx1 = Math.max(0, absX1 - maxLeft);
    const rx2 = Math.min(roiW - 1, absX2 - maxLeft - 1);
    let hits = 0;
    let hasConnected1px = false;
    for (let rx = rx1; rx <= rx2; rx++) {
      if (inkAt(rx, ry, 235)) {
        hits++;
        if (
          !hasConnected1px &&
          inkAt(rx, ry, 218) &&
          (inkAt(rx, ry - 1, 232) || inkAt(rx, ry + 1, 232))
        ) {
          hasConnected1px = true;
        }
      }
    }
    if (hits >= 2) return hits;
    return hasConnected1px ? 1 : 0;
  };

  const rowHasInk = (absY: number, absX1: number, absX2: number): boolean =>
    countRowInk(absY, absX1, absX2) > 0;

  let curLeft = rawLeft;
  let curTop = rawTop;
  let curRight = rawRight;
  let curBottom = rawBottom;

  // Only trim an overlapping top strip if a clean horizontal white gap separates it
  // from a wide horizontal table border below (never trims floating labels on graphs).
  if (overlappingTopMaxY > curTop) {
    const trimLimit = Math.min(
      curBottom - 20,
      overlappingTopMaxY + Math.round(pageH * 0.02)
    );
    const minTrimGap = Math.max(5, Math.round(pageH * 0.0025));
    const spanW = Math.max(1, curRight - curLeft);
    let seenTopInk = false;
    let gapRun = 0;
    for (let y = curTop; y < trimLimit; y++) {
      const cnt = countRowInk(y, curLeft, curRight);
      if (cnt > 0) {
        if (seenTopInk && gapRun >= minTrimGap && cnt >= spanW * 0.4) {
          curTop = y;
          break;
        }
        seenTopInk = true;
        gapRun = 0;
      } else if (seenTopInk) {
        gapRun++;
      }
    }
  }

  const hGap = Math.max(14, Math.round(pageW * 0.015));
  const vGapTop = Math.max(6, Math.round(pageH * 0.003));
  const vGapBottom = Math.max(12, Math.round(pageH * 0.0055));
  const vGapAfterBorder = Math.max(5, Math.round(pageH * 0.0022));

  const expandHorizontal = () => {
    let leftWhite = 0;
    for (let x = curLeft; x < Math.min(curRight, curLeft + hGap); x++) {
      if (colHasInk(x, curTop, curBottom)) break;
      leftWhite++;
    }
    if (leftWhite < hGap) {
      let whiteRun = leftWhite;
      for (let x = curLeft - 1; x >= maxLeft; x--) {
        if (colHasInk(x, curTop, curBottom)) {
          curLeft = x;
          whiteRun = 0;
        } else {
          whiteRun++;
          if (whiteRun >= hGap) break;
        }
      }
    }

    let rightWhite = 0;
    for (let x = curRight - 1; x >= Math.max(curLeft, curRight - hGap); x--) {
      if (colHasInk(x, curTop, curBottom)) break;
      rightWhite++;
    }
    if (rightWhite < hGap) {
      let whiteRun = rightWhite;
      for (let x = curRight; x < maxRight; x++) {
        if (colHasInk(x, curTop, curBottom)) {
          curRight = x + 1;
          whiteRun = 0;
        } else {
          whiteRun++;
          if (whiteRun >= hGap) break;
        }
      }
    }
  };

  const expandVertical = () => {
    let topWhite = 0;
    for (let y = curTop; y < Math.min(curBottom, curTop + vGapTop); y++) {
      if (rowHasInk(y, curLeft, curRight)) break;
      topWhite++;
    }
    if (topWhite < vGapTop) {
      let whiteRun = topWhite;
      for (let y = curTop - 1; y >= maxTop; y--) {
        if (rowHasInk(y, curLeft, curRight)) {
          curTop = y;
          whiteRun = 0;
        } else {
          whiteRun++;
          if (whiteRun >= vGapTop) break;
        }
      }
    }

    let bottomWhite = 0;
    let sawBottomBorder = false;
    const spanW = Math.max(1, curRight - curLeft);
    for (let y = curBottom - 1; y >= Math.max(curTop, curBottom - vGapBottom); y--) {
      const cnt = countRowInk(y, curLeft, curRight);
      if (cnt > 0) {
        if (cnt >= spanW * 0.45 && bottomWhite <= 3) {
          sawBottomBorder = true;
        }
        break;
      }
      bottomWhite++;
    }
    const effectiveBottomGap = sawBottomBorder ? vGapAfterBorder : vGapBottom;
    if (bottomWhite < effectiveBottomGap) {
      let whiteRun = bottomWhite;
      let localBorderSeen = sawBottomBorder;
      for (let y = curBottom; y < maxBottom; y++) {
        const cnt = countRowInk(y, curLeft, curRight);
        if (cnt > 0) {
          curBottom = y + 1;
          whiteRun = 0;
          localBorderSeen = cnt >= spanW * 0.45;
        } else {
          whiteRun++;
          const limit = localBorderSeen ? vGapAfterBorder : vGapBottom;
          if (whiteRun >= limit) break;
        }
      }
    }
  };

  // Pass 1 & 2: Horizontal first to grab full table width/horizontal rules, then Vertical for all rows/borders
  expandHorizontal();
  expandVertical();
  expandHorizontal();
  expandVertical();

  // Locate tight ink bounds inside [curLeft..curRight, curTop..curBottom]
  let inkLeft = curRight;
  let inkRight = curLeft;
  let inkTop = curBottom;
  let inkBottom = curTop;
  let hasInk = false;

  for (let y = curTop; y < curBottom; y++) {
    if (rowHasInk(y, curLeft, curRight)) {
      inkTop = y;
      hasInk = true;
      break;
    }
  }
  if (hasInk) {
    for (let y = curBottom - 1; y >= inkTop; y--) {
      if (rowHasInk(y, curLeft, curRight)) {
        inkBottom = y + 1;
        break;
      }
    }
    for (let x = curLeft; x < curRight; x++) {
      if (colHasInk(x, inkTop, inkBottom)) {
        inkLeft = x;
        break;
      }
    }
    for (let x = curRight - 1; x >= inkLeft; x--) {
      if (colHasInk(x, inkTop, inkBottom)) {
        inkRight = x + 1;
        break;
      }
    }
  } else {
    inkLeft = curLeft;
    inkRight = curRight;
    inkTop = curTop;
    inkBottom = curBottom;
  }

  // Add breathing-room padding from the true ink edges, stopping safely clear of external ink
  const padX = Math.max(8, Math.round(pageW * 0.005));
  const padY = Math.max(7, Math.round(pageH * 0.004));

  let safePadLeft = 0;
  for (let d = 1; d <= padX && inkLeft - d >= maxLeft; d++) {
    if (colHasInk(inkLeft - d, inkTop, inkBottom)) {
      safePadLeft = Math.max(0, d - 3);
      break;
    }
    safePadLeft = d;
  }
  let safePadRight = 0;
  for (let d = 1; d <= padX && inkRight - 1 + d < maxRight; d++) {
    if (colHasInk(inkRight - 1 + d, inkTop, inkBottom)) {
      safePadRight = Math.max(0, d - 3);
      break;
    }
    safePadRight = d;
  }

  const paddedLeft = inkLeft - safePadLeft;
  const paddedRight = inkRight + safePadRight;

  let safePadTop = 0;
  for (let d = 1; d <= padY && inkTop - d >= maxTop; d++) {
    if (rowHasInk(inkTop - d, paddedLeft, paddedRight)) {
      safePadTop = Math.max(0, d - 3);
      break;
    }
    safePadTop = d;
  }
  let safePadBottom = 0;
  for (let d = 1; d <= padY && inkBottom - 1 + d < maxBottom; d++) {
    if (rowHasInk(inkBottom - 1 + d, paddedLeft, paddedRight)) {
      safePadBottom = Math.max(0, d - 3);
      break;
    }
    safePadBottom = d;
  }

  return {
    left: paddedLeft,
    top: inkTop - safePadTop,
    right: paddedRight,
    bottom: inkBottom + safePadBottom,
  };
}

export async function cropFiguresFromPage(
  page: RenderedPage,
  boxes: number[][],
  padRatio = 0.014,
  neighborBoxes: number[][] = []
): Promise<Array<{ dataUrl: string; width: number; height: number; box2d: number[] } | null>> {
  if (boxes.length === 0) return [];
  const img = await loadImageElement(page.dataUrl);
  if (!img) return boxes.map(() => null);

  const pageCanvas = document.createElement('canvas');
  pageCanvas.width = page.width;
  pageCanvas.height = page.height;
  const pageCtx = pageCanvas.getContext('2d', { willReadFrequently: true });

  const outCanvas = document.createElement('canvas');
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) {
    pageCanvas.width = 0;
    pageCanvas.height = 0;
    return boxes.map(() => null);
  }

  if (pageCtx) {
    pageCtx.fillStyle = '#ffffff';
    pageCtx.fillRect(0, 0, page.width, page.height);
    pageCtx.drawImage(img, 0, 0, page.width, page.height);
  }

  const padX = Math.round(page.width * padRatio);
  const padY = Math.round(page.height * padRatio);

  const results = boxes.map((box2d) => {
    if (!box2d || box2d.length !== 4) return null;
    const [ymin, xmin, ymax, xmax] = box2d;

    const rawLeft = Math.max(0, Math.floor((xmin * page.width) / 1000));
    const rawTop = Math.max(0, Math.floor((ymin * page.height) / 1000));
    const rawRight = Math.min(page.width, Math.ceil((xmax * page.width) / 1000));
    const rawBottom = Math.min(page.height, Math.ceil((ymax * page.height) / 1000));

    if (rawRight - rawLeft < 16 || rawBottom - rawTop < 16) return null;

    const expanded = pageCtx
      ? expandCropToInkBounds(
          pageCtx,
          page.width,
          page.height,
          rawLeft,
          rawTop,
          rawRight,
          rawBottom,
          neighborBoxes
        )
      : {
          left: Math.max(0, rawLeft - padX),
          top: Math.max(0, rawTop - padY),
          right: Math.min(page.width, rawRight + padX),
          bottom: Math.min(page.height, rawBottom + padY),
        };

    const cropW = expanded.right - expanded.left;
    const cropH = expanded.bottom - expanded.top;
    if (cropW < 20 || cropH < 20) return null;

    const maxCropDim = 1200;
    const scaleDown =
      cropW > maxCropDim || cropH > maxCropDim
        ? Math.min(maxCropDim / cropW, maxCropDim / cropH)
        : 1;
    const outW = Math.max(20, Math.round(cropW * scaleDown));
    const outH = Math.max(20, Math.round(cropH * scaleDown));

    outCanvas.width = outW;
    outCanvas.height = outH;
    outCtx.fillStyle = '#ffffff';
    outCtx.fillRect(0, 0, outW, outH);
    outCtx.drawImage(
      img,
      expanded.left,
      expanded.top,
      cropW,
      cropH,
      0,
      0,
      outW,
      outH
    );

    const refinedBox2d = [
      Math.max(0, Math.round((expanded.top / page.height) * 1000)),
      Math.max(0, Math.round((expanded.left / page.width) * 1000)),
      Math.min(1000, Math.round((expanded.bottom / page.height) * 1000)),
      Math.min(1000, Math.round((expanded.right / page.width) * 1000)),
    ];

    return {
      dataUrl: outCanvas.toDataURL('image/png'),
      width: outW,
      height: outH,
      box2d: refinedBox2d,
    };
  });

  pageCanvas.width = 0;
  pageCanvas.height = 0;
  outCanvas.width = 0;
  outCanvas.height = 0;
  return results;
}

export async function cropFigureFromPage(
  page: RenderedPage,
  box2d: number[],
  padRatio = 0.014
): Promise<{ dataUrl: string; width: number; height: number; box2d: number[] } | null> {
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
