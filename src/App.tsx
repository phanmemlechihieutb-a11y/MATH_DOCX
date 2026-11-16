import { useCallback, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardPaste,
  Code2,
  Crop,
  Download,
  FileImage,
  FileText,
  Layers,
  Loader2,
  Play,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { DocumentPreview } from './components/DocumentPreview';
import { MathRenderer } from './components/MathRenderer';
import type {
  ChoiceLayoutMode,
  DocumentBlock,
  ExtractedEquationItem,
  MathOutputFormat,
  PageExtraction,
  RenderedPage,
} from './types/document';
import { parseDocxFileToPages } from './utils/docxImporter';
import { normalizePagesInlineMath, parsePastedLatexToPages } from './utils/latexParser';
import {
  cropFiguresFromPage,
  generateSampleMathWorksheet,
  loadFileAsPages,
} from './utils/pdfProcessor';
import { createNewBlock, mutatePageBlock } from './utils/previewEditor';

type ActiveTab = 'preview' | 'original' | 'equations' | 'figures';

interface CroppedFigureItem {
  id: number;
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
  caption?: string | null;
}

async function parseJsonResponseSafe<T>(res: Response): Promise<T> {
  const raw = await res.text();
  try {
    return (raw ? JSON.parse(raw) : {}) as T;
  } catch {
    if (res.status === 413) {
      throw new Error('Dung lượng dữ liệu gửi lên vượt quá giới hạn máy chủ (HTTP 413).');
    }
    if (res.status === 504) {
      throw new Error('Máy chủ xử lý quá thời gian cho phép (HTTP 504). Vui lòng thử lại.');
    }
    const snippet = raw.replace(/\s+/g, ' ').trim().slice(0, 120);
    throw new Error(
      `Máy chủ trả về phản hồi không hợp lệ (HTTP ${res.status})${snippet ? `: ${snippet}` : ''}`
    );
  }
}

async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  maxRetries = 2
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(input, init);
      const isTransientStatus =
        res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;
      if (isTransientStatus && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
    }
  }
  const rawMsg = lastError instanceof Error ? lastError.message : String(lastError || '');
  if (/failed to fetch|networkerror|load failed/i.test(rawMsg)) {
    throw new Error(
      'Kết nối tới máy chủ xử lý bị gián đoạn (Failed to fetch). Vui lòng thử lại hoặc chọn độ phân giải 200 DPI.'
    );
  }
  throw lastError instanceof Error ? lastError : new Error(rawMsg || 'Lỗi kết nối máy chủ.');
}

async function downscalePngDataUrl(dataUrl: string, scale: number): Promise<string> {
  if (!dataUrl.startsWith('data:image/')) return dataUrl;
  return await new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = Math.max(24, Math.round(img.naturalWidth * scale));
      const h = Math.max(24, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const out = canvas.toDataURL('image/png');
      canvas.width = 0;
      canvas.height = 0;
      resolve(out.length < dataUrl.length ? out : dataUrl);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [sourceFilename, setSourceFilename] = useState<string>('');
  const [renderedPages, setRenderedPages] = useState<RenderedPage[]>([]);
  const [selectedPageNum, setSelectedPageNum] = useState<number>(1);
  const [renderDpi, setRenderDpi] = useState<number>(250);
  const [addPageBreaks, setAddPageBreaks] = useState<boolean>(true);
  const [autoCropFigures, setAutoCropFigures] = useState<boolean>(true);
  const [choiceLayout, setChoiceLayout] = useState<ChoiceLayoutMode>('tabs');
  const [mathFormat, setMathFormat] = useState<MathOutputFormat>('omml');
  const [inputSource, setInputSource] = useState<'file' | 'paste' | 'docx'>('file');

  const [pendingDocxPages, setPendingDocxPages] = useState<PageExtraction[]>([]);
  const [pastedLatex, setPastedLatex] = useState<string>('');
  const [isExportingPaste, setIsExportingPaste] = useState<boolean>(false);

  const [isLoadingFile, setIsLoadingFile] = useState<boolean>(false);
  const [isConverting, setIsConverting] = useState<boolean>(false);
  const [progressPct, setProgressPct] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [extractedPages, setExtractedPages] = useState<PageExtraction[]>([]);
  const [editedPages, setEditedPages] = useState<PageExtraction[] | null>(null);
  const [isPreviewEditMode, setIsPreviewEditMode] = useState<boolean>(false);
  const [isSyncingEditedWord, setIsSyncingEditedWord] = useState<boolean>(false);
  const syncRequestIdRef = useRef<number>(0);

  const [ommlMap, setOmmlMap] = useState<Record<string, string>>({});
  const [docxDownloadUrl, setDocxDownloadUrl] = useState<string | null>(null);
  const [docxFileName, setDocxFileName] = useState<string>('tai_lieu_toan.docx');

  const [activeTab, setActiveTab] = useState<ActiveTab>('preview');
  const [inspectedEq, setInspectedEq] = useState<{
    latex: string;
    isDisplay: boolean;
    omml: string;
  } | null>(null);

  const resetResults = useCallback(() => {
    syncRequestIdRef.current += 1;
    setExtractedPages([]);
    setEditedPages(null);
    setIsPreviewEditMode(false);
    setIsSyncingEditedWord(false);
    setOmmlMap({});
    setProgressPct(0);
    setStatusMessage('');
    setErrorMessage(null);
    setInspectedEq(null);
    setDocxDownloadUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const handleFileSelected = useCallback(
    async (file: File) => {
      resetResults();
      setIsLoadingFile(true);
      setSourceFilename(file.name);
      const lowerName = file.name.toLowerCase();

      try {
        if (lowerName.endsWith('.doc') && !lowerName.endsWith('.docx')) {
          throw new Error(
            'Định dạng .doc cũ chưa được hỗ trợ trực tiếp. Vui lòng lưu tệp dưới dạng .docx trong Microsoft Word rồi tải lên lại.'
          );
        }

        if (
          lowerName.endsWith('.docx') ||
          file.type ===
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ) {
          const pages = await parseDocxFileToPages(file);
          setRenderedPages([]);
          setPastedLatex('');
          setPendingDocxPages(pages);
          setInputSource('docx');
          setActiveTab('preview');
          setStatusMessage(
            `Đã đọc ${pages.length} trang từ tệp Word. Nhấn "Bắt đầu chuyển đổi" để xuất file.`
          );
          return;
        }

        if (
          lowerName.endsWith('.txt') ||
          lowerName.endsWith('.tex') ||
          lowerName.endsWith('.ltx') ||
          file.type.startsWith('text/')
        ) {
          const rawText = (await file.text()).replace(/^\uFEFF/, '');
          if (!rawText.trim()) {
            throw new Error('Tệp văn bản / LaTeX trống, không có nội dung để chuyển đổi.');
          }
          setRenderedPages([]);
          setPendingDocxPages([]);
          setPastedLatex(rawText);
          setInputSource('paste');
          setActiveTab('preview');
          setStatusMessage(
            'Đã biên dịch bản xem trước LaTeX bên phải. Nhấn "Bắt đầu chuyển đổi" để xuất file Word (.docx).'
          );
          return;
        }

        const pages = await loadFileAsPages(file, renderDpi);
        setPendingDocxPages([]);
        setRenderedPages(pages);
        setInputSource('file');
        setSelectedPageNum(1);
        setActiveTab('original');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Không thể đọc tệp đã chọn.';
        setErrorMessage(msg);
      } finally {
        setIsLoadingFile(false);
      }
    },
    [renderDpi, resetResults]
  );

  const svgDataUrlToPngDataUrl = useCallback(
    async (svgUrl: string, fallbackW = 420, fallbackH = 300): Promise<string> => {
      if (!svgUrl.startsWith('data:image/svg+xml')) return svgUrl;
      return await new Promise<string>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const w = Math.max(40, img.naturalWidth || fallbackW);
          const h = Math.max(40, img.naturalHeight || fallbackH);
          const scale = 2.5;
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(svgUrl);
            return;
          }
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => resolve(svgUrl);
        img.src = svgUrl;
      });
    },
    []
  );

  const rebuildDocxExport = useCallback(
    async (
      pagesToExport: PageExtraction[],
      filename: string,
      pageBreaks: boolean,
      layout: ChoiceLayoutMode,
      format: MathOutputFormat
    ) => {
      const preparedPages: PageExtraction[] = await Promise.all(
        pagesToExport.map(async (page) => ({
          ...page,
          blocks: await Promise.all(
            page.blocks.map(async (blk) => {
              if (
                blk.block_type === 'figure' &&
                blk.croppedImageDataUrl?.startsWith('data:image/svg+xml')
              ) {
                const pngUrl = await svgDataUrlToPngDataUrl(
                  blk.croppedImageDataUrl,
                  blk.croppedWidthPx ?? 420,
                  blk.croppedHeightPx ?? 300
                );
                return { ...blk, croppedImageDataUrl: pngUrl };
              }
              return blk;
            })
          ),
        }))
      );

      let exportPayload = JSON.stringify({
        pages: preparedPages,
        filename,
        addPageBreaks: pageBreaks,
        choiceLayout: layout,
        mathFormat: format,
      });

      if (exportPayload.length > 3_600_000) {
        for (const scale of [0.68, 0.5]) {
          const compactPages: PageExtraction[] = await Promise.all(
            preparedPages.map(async (page) => ({
              ...page,
              blocks: await Promise.all(
                page.blocks.map(async (blk) => {
                  if (
                    blk.block_type === 'figure' &&
                    blk.croppedImageDataUrl &&
                    blk.croppedImageDataUrl.length > 180_000
                  ) {
                    const smaller = await downscalePngDataUrl(blk.croppedImageDataUrl, scale);
                    return { ...blk, croppedImageDataUrl: smaller };
                  }
                  return blk;
                })
              ),
            }))
          );
          exportPayload = JSON.stringify({
            pages: compactPages,
            filename,
            addPageBreaks: pageBreaks,
            choiceLayout: layout,
            mathFormat: format,
          });
          if (exportPayload.length <= 3_600_000) break;
        }
      }

      const exportRes = await fetchWithRetry(
        '/api/export/docx',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: exportPayload,
        },
        2
      );

      if (!exportRes.ok) {
        const errData = await parseJsonResponseSafe<{ error?: string }>(exportRes);
        throw new Error(errData.error || 'Không thể tạo tệp Word.');
      }

      const blob = await exportRes.blob();
      const url = URL.createObjectURL(blob);
      const baseName = filename.replace(/\.[^.]+$/, '') || 'tai_lieu_toan';
      const suffix = format === 'latex' ? 'LaTeX' : 'OMML';

      setDocxDownloadUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setDocxFileName(`${baseName}_${suffix}.docx`);
    },
    [svgDataUrlToPngDataUrl]
  );

  const syncPagesToWordAndOmml = useCallback(
    async (pagesToSync: PageExtraction[], successMsg: string) => {
      const reqId = ++syncRequestIdRef.current;
      setErrorMessage(null);
      setIsSyncingEditedWord(true);
      setStatusMessage('Đang cập nhật nội dung đã chỉnh sửa sang file Word...');

      try {
        const normalizedPages = normalizePagesInlineMath(pagesToSync);
        const seenEqKeys = new Set<string>();
        const eqQueries: Array<{ latex: string; isDisplay: boolean }> = [];
        const addEq = (latex: string, isDisplay: boolean) => {
          const key = `${isDisplay ? 'D' : 'I'}:${latex}`;
          if (!seenEqKeys.has(key)) {
            seenEqKeys.add(key);
            eqQueries.push({ latex, isDisplay });
          }
        };

        for (const p of normalizedPages) {
          for (const blk of p.blocks) {
            if (blk.block_type === 'equation' && blk.latex) addEq(blk.latex, true);
            for (const seg of blk.segments ?? []) {
              if (seg.type === 'math' && seg.content) addEq(seg.content, false);
            }
            for (const row of blk.table_rows ?? []) {
              for (const cell of row) {
                for (const seg of cell.segments ?? []) {
                  if (seg.type === 'math' && seg.content) addEq(seg.content, false);
                }
              }
            }
          }
        }

        const ommlPreviewPromise =
          eqQueries.length > 0
            ? fetchWithRetry(
                '/api/omml/preview',
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ equations: eqQueries }),
                },
                1
              )
                .then(async (ommlRes) => {
                  if (!ommlRes.ok || reqId !== syncRequestIdRef.current) return;
                  const ommlJson = (await ommlRes.json()) as {
                    results: Array<{ latex: string; isDisplay: boolean; omml: string }>;
                  };
                  const map: Record<string, string> = {};
                  for (const item of ommlJson.results) {
                    map[`${item.isDisplay ? 'D' : 'I'}:${item.latex}`] = item.omml;
                  }
                  if (reqId === syncRequestIdRef.current) {
                    setOmmlMap(map);
                  }
                })
                .catch(() => undefined)
            : Promise.resolve();

        const fallbackName = inputSource === 'docx' ? 'tai_lieu_word' : 'tai_lieu_latex';
        await Promise.all([
          ommlPreviewPromise,
          rebuildDocxExport(
            normalizedPages,
            sourceFilename || fallbackName,
            addPageBreaks,
            choiceLayout,
            mathFormat
          ),
        ]);

        if (reqId === syncRequestIdRef.current) {
          setProgressPct(100);
          setStatusMessage(successMsg);
        }
      } catch (err) {
        if (reqId === syncRequestIdRef.current) {
          const msg = err instanceof Error ? err.message : 'Không thể cập nhật tệp Word.';
          setErrorMessage(msg);
        }
      } finally {
        if (reqId === syncRequestIdRef.current) {
          setIsSyncingEditedWord(false);
        }
      }
    },
    [addPageBreaks, choiceLayout, inputSource, mathFormat, rebuildDocxExport, sourceFilename]
  );

  const handleChoiceLayoutChange = async (nextLayout: ChoiceLayoutMode) => {
    setChoiceLayout(nextLayout);
    const activePages =
      editedPages ?? (extractedPages.length > 0 ? extractedPages : []);
    if (activePages.length > 0 && !isConverting && !isExportingPaste) {
      try {
        setStatusMessage('Đang cập nhật bố cục phương án trả lời trong file Word...');
        await rebuildDocxExport(
          activePages,
          sourceFilename || 'tai_lieu_toan',
          addPageBreaks,
          nextLayout,
          mathFormat
        );
        setStatusMessage('Đã cập nhật file Word theo định dạng phương án đã chọn.');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Không thể cập nhật tệp Word.';
        setErrorMessage(msg);
      }
    }
  };

  const handleConvertStructuredPages = async (
    pages: PageExtraction[],
    targetFormat: MathOutputFormat,
    filenameFallback: string,
    successMsgOmml: string,
    successMsgLatex: string
  ) => {
    setErrorMessage(null);
    setMathFormat(targetFormat);
    setIsExportingPaste(true);
    setProgressPct(25);
    setStatusMessage('Đang phân tích cấu trúc & công thức Toán...');

    try {
      const normalizedPages = normalizePagesInlineMath(pages);
      setExtractedPages(normalizedPages);
      setActiveTab('preview');

      const seenEqKeys = new Set<string>();
      const eqQueries: Array<{ latex: string; isDisplay: boolean }> = [];
      const addEq = (latex: string, isDisplay: boolean) => {
        const key = `${isDisplay ? 'D' : 'I'}:${latex}`;
        if (!seenEqKeys.has(key)) {
          seenEqKeys.add(key);
          eqQueries.push({ latex, isDisplay });
        }
      };

      for (const p of normalizedPages) {
        for (const blk of p.blocks) {
          if (blk.block_type === 'equation' && blk.latex) addEq(blk.latex, true);
          for (const seg of blk.segments ?? []) {
            if (seg.type === 'math' && seg.content) addEq(seg.content, false);
          }
          for (const row of blk.table_rows ?? []) {
            for (const cell of row) {
              for (const seg of cell.segments ?? []) {
                if (seg.type === 'math' && seg.content) addEq(seg.content, false);
              }
            }
          }
        }
      }

      const ommlPreviewPromise =
        eqQueries.length > 0
          ? fetchWithRetry(
              '/api/omml/preview',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ equations: eqQueries }),
              },
              1
            )
              .then(async (ommlRes) => {
                if (!ommlRes.ok) return;
                const ommlJson = (await ommlRes.json()) as {
                  results: Array<{ latex: string; isDisplay: boolean; omml: string }>;
                };
                const map: Record<string, string> = {};
                for (const item of ommlJson.results) {
                  map[`${item.isDisplay ? 'D' : 'I'}:${item.latex}`] = item.omml;
                }
                setOmmlMap(map);
              })
              .catch(() => undefined)
          : Promise.resolve();

      await Promise.all([
        ommlPreviewPromise,
        rebuildDocxExport(
          normalizedPages,
          sourceFilename || filenameFallback,
          addPageBreaks,
          choiceLayout,
          targetFormat
        ),
      ]);

      setProgressPct(100);
      setStatusMessage(targetFormat === 'latex' ? successMsgLatex : successMsgOmml);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể chuyển đổi nội dung.';
      setErrorMessage(msg);
      setProgressPct(0);
      setStatusMessage('');
    } finally {
      setIsExportingPaste(false);
    }
  };

  const handleConvertPastedLatex = async (targetFormat: MathOutputFormat = mathFormat) => {
    const pages = editedPages ?? parsePastedLatexToPages(pastedLatex, 'auto');
    if (pages.length === 0) {
      setErrorMessage(
        'Vui lòng dán hoặc tải lên nội dung có công thức Toán ($...$ hoặc LaTeX căn bản) trước khi chuyển đổi.'
      );
      return;
    }

    await handleConvertStructuredPages(
      pages,
      targetFormat,
      'tai_lieu_latex',
      'Đã chuyển nội dung sang tệp Word Equation (OMML) thành công!',
      'Đã tạo tệp Word với công thức LaTeX bọc $...$.'
    );
  };

  const handleUseSampleWorksheet = () => {
    resetResults();
    setPendingDocxPages([]);
    setInputSource('file');
    const sample = generateSampleMathWorksheet();
    setSourceFilename('De_on_tap_Toan_mau.png');
    setRenderedPages([sample]);
    setSelectedPageNum(1);
    setActiveTab('original');
  };

  const handleStartConversion = async () => {
    const hasFile = renderedPages.length > 0;
    const hasDocx = pendingDocxPages.length > 0;
    const hasPaste = pastedLatex.trim().length > 0;

    if (inputSource === 'docx' && hasDocx) {
      await handleConvertStructuredPages(
        editedPages ?? pendingDocxPages,
        mathFormat,
        'tai_lieu_word',
        'Đã xử lý tệp Word sang Word Equation (OMML) thành công!',
        'Đã chuyển công thức trong tệp Word sang LaTeX bọc $...$.'
      );
      return;
    }

    if ((inputSource === 'paste' && hasPaste) || (!hasFile && !hasDocx && hasPaste)) {
      await handleConvertPastedLatex(mathFormat);
      return;
    }

    if (!hasFile && hasDocx) {
      await handleConvertStructuredPages(
        editedPages ?? pendingDocxPages,
        mathFormat,
        'tai_lieu_word',
        'Đã xử lý tệp Word sang Word Equation (OMML) thành công!',
        'Đã chuyển công thức trong tệp Word sang LaTeX bọc $...$.'
      );
      return;
    }

    if (!hasFile) return;

    resetResults();
    setIsConverting(true);
    setProgressPct(5);

    try {
      const total = renderedPages.length;
      const processedPages: Array<PageExtraction | undefined> = new Array(total);
      let nextIndex = 0;
      let completedCount = 0;
      let abortedError: Error | null = null;

      setStatusMessage(
        total > 1
          ? `Đang nhận dạng song song ${total} trang tài liệu...`
          : 'Đang nhận dạng OCR & công thức trang 1/1...'
      );

      const processSinglePage = async (idx: number) => {
        const page = renderedPages[idx];
        const ocrRes = await fetchWithRetry(
          '/api/ocr/page',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageDataUrl: page.ocrDataUrl || page.dataUrl,
              pageNumber: page.pageNumber,
            }),
          },
          2
        );

        const ocrJson = await parseJsonResponseSafe<{
          blocks?: PageExtraction['blocks'];
          error?: string;
        }>(ocrRes);
        if (!ocrRes.ok) {
          throw new Error(ocrJson.error || `Lỗi OCR trang ${page.pageNumber}`);
        }

        const blocks = Array.isArray(ocrJson.blocks) ? ocrJson.blocks : [];

        if (autoCropFigures) {
          const figureBlocks = blocks.filter(
            (blk): blk is DocumentBlock & { box_2d: number[] } =>
              blk.block_type === 'figure' && Array.isArray(blk.box_2d)
          );
          if (figureBlocks.length > 0) {
            const croppedList = await cropFiguresFromPage(
              page,
              figureBlocks.map((b) => b.box_2d)
            );
            figureBlocks.forEach((blk, fIdx) => {
              const cropped = croppedList[fIdx];
              if (cropped) {
                blk.croppedImageDataUrl = cropped.dataUrl;
                blk.croppedWidthPx = cropped.width;
                blk.croppedHeightPx = cropped.height;
              }
            });
          }
        }

        processedPages[idx] = {
          pageNumber: page.pageNumber,
          pageWidthPx: page.width,
          pageHeightPx: page.height,
          blocks,
        };

        completedCount += 1;
        setExtractedPages(processedPages.filter((p): p is PageExtraction => Boolean(p)));
        setProgressPct(Math.round((completedCount / (total + 1)) * 82));
        setStatusMessage(`Đã nhận dạng xong ${completedCount}/${total} trang...`);
      };

      const concurrency = Math.min(2, total);
      const workers = Array.from({ length: concurrency }, async () => {
        while (!abortedError) {
          const idx = nextIndex++;
          if (idx >= total) break;
          try {
            await processSinglePage(idx);
          } catch (err) {
            abortedError = err instanceof Error ? err : new Error(String(err));
            break;
          }
        }
      });

      await Promise.all(workers);
      if (abortedError) {
        throw abortedError;
      }

      const finalPages = normalizePagesInlineMath(
        processedPages.filter((p): p is PageExtraction => Boolean(p))
      );

      // Deduplicate equations before populating OMML XML inspector
      const seenEqKeys = new Set<string>();
      const eqQueries: Array<{ latex: string; isDisplay: boolean }> = [];
      const addEqQuery = (latex: string, isDisplay: boolean) => {
        const key = `${isDisplay ? 'D' : 'I'}:${latex}`;
        if (!seenEqKeys.has(key)) {
          seenEqKeys.add(key);
          eqQueries.push({ latex, isDisplay });
        }
      };

      for (const p of finalPages) {
        for (const blk of p.blocks) {
          if (blk.block_type === 'equation' && blk.latex) {
            addEqQuery(blk.latex, true);
          }
          if (blk.segments) {
            for (const seg of blk.segments) {
              if (seg.type === 'math' && seg.content) {
                addEqQuery(seg.content, false);
              }
            }
          }
          if (blk.table_rows) {
            for (const row of blk.table_rows) {
              for (const cell of row) {
                for (const seg of cell.segments ?? []) {
                  if (seg.type === 'math' && seg.content) {
                    addEqQuery(seg.content, false);
                  }
                }
              }
            }
          }
        }
      }

      setProgressPct(88);
      setStatusMessage(
        mathFormat === 'latex'
          ? 'Đang đóng gói tệp Word (.docx) với công thức LaTeX ($...$)...'
          : 'Đang đóng gói tệp Word (.docx) với Equation OMML...'
      );

      const ommlPreviewPromise =
        eqQueries.length > 0
          ? fetchWithRetry(
              '/api/omml/preview',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ equations: eqQueries }),
              },
              1
            )
              .then(async (ommlRes) => {
                if (!ommlRes.ok) return;
                const ommlJson = (await ommlRes.json()) as {
                  results: Array<{ latex: string; isDisplay: boolean; omml: string }>;
                };
                const map: Record<string, string> = {};
                for (const item of ommlJson.results) {
                  map[`${item.isDisplay ? 'D' : 'I'}:${item.latex}`] = item.omml;
                }
                setOmmlMap(map);
              })
              .catch(() => undefined)
          : Promise.resolve();

      await Promise.all([
        ommlPreviewPromise,
        rebuildDocxExport(finalPages, sourceFilename, addPageBreaks, choiceLayout, mathFormat),
      ]);

      setProgressPct(100);
      setStatusMessage('Hoàn tất chuyển đổi! File Word đã sẵn sàng để tải xuống.');
      setActiveTab('preview');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Đã xảy ra lỗi khi chuyển đổi.';
      setErrorMessage(msg);
      setStatusMessage('Chuyển đổi bị gián đoạn');
    } finally {
      setIsConverting(false);
    }
  };

  const liveLatexPreviewPages = useMemo<PageExtraction[]>(() => {
    if (inputSource !== 'paste' || !pastedLatex.trim()) return [];
    try {
      return normalizePagesInlineMath(parsePastedLatexToPages(pastedLatex, 'auto'));
    } catch {
      return [];
    }
  }, [inputSource, pastedLatex]);

  const basePreviewPages = useMemo<PageExtraction[]>(() => {
    if (inputSource === 'file' && extractedPages.length > 0) return extractedPages;
    if (inputSource === 'paste' && liveLatexPreviewPages.length > 0) return liveLatexPreviewPages;
    if (inputSource === 'docx' && pendingDocxPages.length > 0) return pendingDocxPages;
    if (extractedPages.length > 0) return extractedPages;
    return [];
  }, [extractedPages, inputSource, liveLatexPreviewPages, pendingDocxPages]);

  const displayPreviewPages = editedPages ?? basePreviewPages;

  const applyEditedPagesChange = useCallback(
    (nextPages: PageExtraction[]) => {
      setEditedPages(nextPages);
      if (docxDownloadUrl) {
        void syncPagesToWordAndOmml(
          nextPages,
          'Đã cập nhật nội dung đã chỉnh sửa vào file Word!'
        );
      } else {
        setStatusMessage(
          'Đã lưu chỉnh sửa trên bản xem trước. Nhấn "Xuất ra file Word" hoặc "Bắt đầu chuyển đổi" để tạo tệp Word.'
        );
      }
    },
    [docxDownloadUrl, syncPagesToWordAndOmml]
  );

  const handleUpdatePreviewBlock = useCallback(
    (pageNumber: number, blockIndex: number, nextBlock: DocumentBlock) => {
      const nextPages = mutatePageBlock(displayPreviewPages, pageNumber, (blocks) => {
        if (blockIndex < 0 || blockIndex >= blocks.length) return blocks;
        blocks[blockIndex] = nextBlock;
        return blocks;
      });
      applyEditedPagesChange(nextPages);
    },
    [applyEditedPagesChange, displayPreviewPages]
  );

  const handleDeletePreviewBlock = useCallback(
    (pageNumber: number, blockIndex: number) => {
      const nextPages = mutatePageBlock(displayPreviewPages, pageNumber, (blocks) =>
        blocks.filter((_, idx) => idx !== blockIndex)
      );
      applyEditedPagesChange(nextPages);
    },
    [applyEditedPagesChange, displayPreviewPages]
  );

  const handleInsertPreviewBlock = useCallback(
    (
      pageNumber: number,
      afterBlockIndex: number,
      kind: 'paragraph' | 'heading' | 'equation'
    ) => {
      const newBlock = createNewBlock(kind);
      const nextPages = mutatePageBlock(displayPreviewPages, pageNumber, (blocks) => {
        const insertAt = Math.max(0, Math.min(blocks.length, afterBlockIndex + 1));
        blocks.splice(insertAt, 0, newBlock);
        return blocks;
      });
      applyEditedPagesChange(nextPages);
    },
    [applyEditedPagesChange, displayPreviewPages]
  );

  const handleMovePreviewBlock = useCallback(
    (pageNumber: number, blockIndex: number, direction: -1 | 1) => {
      const nextPages = mutatePageBlock(displayPreviewPages, pageNumber, (blocks) => {
        const targetIdx = blockIndex + direction;
        if (
          blockIndex < 0 ||
          blockIndex >= blocks.length ||
          targetIdx < 0 ||
          targetIdx >= blocks.length
        ) {
          return blocks;
        }
        const temp = blocks[blockIndex];
        blocks[blockIndex] = blocks[targetIdx];
        blocks[targetIdx] = temp;
        return blocks;
      });
      applyEditedPagesChange(nextPages);
    },
    [applyEditedPagesChange, displayPreviewPages]
  );

  const handleResetPreviewEdits = useCallback(() => {
    setEditedPages(null);
    if (inputSource !== 'file') {
      setExtractedPages([]);
    }
    if (docxDownloadUrl && basePreviewPages.length > 0) {
      void syncPagesToWordAndOmml(
        basePreviewPages,
        'Đã khôi phục nội dung gốc và cập nhật lại file Word.'
      );
    } else {
      setStatusMessage('Đã khôi phục nội dung gốc trên bản xem trước.');
    }
  }, [basePreviewPages, docxDownloadUrl, inputSource, syncPagesToWordAndOmml]);

  const handleSyncPreviewWord = useCallback(() => {
    if (displayPreviewPages.length === 0) return;
    void syncPagesToWordAndOmml(
      displayPreviewPages,
      'Đã xuất file Word theo nội dung trên bản xem trước!'
    );
  }, [displayPreviewPages, syncPagesToWordAndOmml]);

  const equationsList = useMemo<ExtractedEquationItem[]>(() => {
    const items: ExtractedEquationItem[] = [];
    let counter = 1;
    for (const page of displayPreviewPages) {
      for (const blk of page.blocks) {
        if (blk.block_type === 'equation' && blk.latex) {
          items.push({
            id: counter++,
            pageNumber: page.pageNumber,
            isDisplay: true,
            latex: blk.latex,
            ommlPreview: ommlMap[`D:${blk.latex}`],
          });
        }
        if (blk.segments) {
          for (const seg of blk.segments) {
            if (seg.type === 'math' && seg.content) {
              items.push({
                id: counter++,
                pageNumber: page.pageNumber,
                isDisplay: false,
                latex: seg.content,
                ommlPreview: ommlMap[`I:${seg.content}`],
              });
            }
          }
        }
        if (blk.table_rows) {
          for (const row of blk.table_rows) {
            for (const cell of row) {
              for (const seg of cell.segments ?? []) {
                if (seg.type === 'math' && seg.content) {
                  items.push({
                    id: counter++,
                    pageNumber: page.pageNumber,
                    isDisplay: false,
                    latex: seg.content,
                    ommlPreview: ommlMap[`I:${seg.content}`],
                  });
                }
              }
            }
          }
        }
      }
    }
    return items;
  }, [displayPreviewPages, ommlMap]);

  const figuresList = useMemo<CroppedFigureItem[]>(() => {
    const list: CroppedFigureItem[] = [];
    let counter = 1;
    for (const page of displayPreviewPages) {
      for (const blk of page.blocks) {
        if (blk.block_type === 'figure' && blk.croppedImageDataUrl) {
          list.push({
            id: counter++,
            pageNumber: page.pageNumber,
            dataUrl: blk.croppedImageDataUrl,
            width: blk.croppedWidthPx ?? 0,
            height: blk.croppedHeightPx ?? 0,
            caption: blk.caption,
          });
        }
      }
    }
    return list;
  }, [displayPreviewPages]);

  const tableCount = useMemo(() => {
    let count = 0;
    for (const p of displayPreviewPages) {
      for (const b of p.blocks) {
        if (b.block_type === 'table') count++;
      }
    }
    return count;
  }, [displayPreviewPages]);

  const currentOriginalPage = useMemo(
    () => renderedPages.find((p) => p.pageNumber === selectedPageNum) ?? renderedPages[0],
    [renderedPages, selectedPageNum]
  );

  const currentPageFigureBoxes = useMemo(() => {
    const match = displayPreviewPages.find((p) => p.pageNumber === selectedPageNum);
    if (!match) return [];
    return match.blocks
      .filter((b) => b.block_type === 'figure' && Array.isArray(b.box_2d) && b.box_2d.length === 4)
      .map((b) => ({ box: b.box_2d as number[], caption: b.caption }));
  }, [displayPreviewPages, selectedPageNum]);

  const handleInspectEquation = (latex: string, isDisplay: boolean) => {
    const key = `${isDisplay ? 'D' : 'I'}:${latex}`;
    setInspectedEq({
      latex,
      isDisplay,
      omml: ommlMap[key] || '(Chưa có dữ liệu XML OMML cho công thức này)',
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="text-lg font-bold tracking-tight text-red-600 whitespace-nowrap shrink-0 lg:w-[346px]"
          >
            MathDocx_viết code: Lê Chí Hiếu
          </a>

          <nav className="hidden md:flex flex-1 items-center justify-center gap-6 text-sm font-medium text-slate-600">
            <button
              type="button"
              onClick={() => setActiveTab('original')}
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Tài liệu gốc
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('preview')}
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Xem trước Word
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('equations')}
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Công thức OMML
            </button>
            <a
              href="#omml-guide"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Cơ chế OMML
            </a>
          </nav>

          <div className="flex items-center shrink-0">
            {docxDownloadUrl ? (
              <a
                href={docxDownloadUrl}
                download={docxFileName}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-4 h-4" />
                Tải xuống file Word
              </a>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="hidden"
              >
                <Upload className="w-4 h-4" />
                Chọn tài liệu
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Split Workspace: Left Controls/Options/Formatting — Right Content Display */}
      <main id="top" className="flex-1 flex flex-col md:flex-row w-full max-w-[1600px] mx-auto">
        {/* Left Sidebar: Sticky Controls, Options & Formatting */}
        <aside className="w-full md:w-[340px] lg:w-[370px] shrink-0 bg-white border-b md:border-b-0 md:border-r border-slate-200 md:sticky md:top-16 md:h-[calc(100vh-4rem)] md:overflow-y-auto divide-y divide-slate-200">
          {/* 1. Tài liệu đầu vào */}
          <section className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-900">1. Tài liệu đầu vào</h2>
              <button
                type="button"
                onClick={handleUseSampleWorksheet}
                disabled={isConverting || isLoadingFile}
                className="text-xs font-medium text-blue-700 hover:text-blue-800 hover:underline disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                Dùng đề toán mẫu
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,.tex,.ltx,.png,.jpg,.jpeg,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/x-tex,image/png,image/jpeg"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFileSelected(file);
                e.target.value = '';
              }}
            />

            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) void handleFileSelected(file);
              }}
              className="border border-dashed border-slate-300 hover:border-blue-500 hover:bg-blue-50/40 rounded-lg p-5 text-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              {isLoadingFile ? (
                <div className="flex flex-col items-center gap-2 py-2">
                  <Loader2 className="w-6 h-6 text-blue-700 animate-spin" />
                  <span className="text-sm font-medium text-slate-700">
                    Đang đọc nội dung tài liệu...
                  </span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1.5">
                  <Upload className="w-6 h-6 text-slate-500" />
                  <div className="text-sm font-medium text-slate-800">
                    Kéo thả hoặc nhấn để chọn PDF, Docx, TXT, TEX, Ảnh
                  </div>
                  <div className="text-xs text-slate-500">
                    Hỗ trợ PDF, Docx (.docx), .txt, .tex, PNG, JPG, JPEG
                  </div>
                </div>
              )}
            </div>

            {sourceFilename && (
              <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                <span className="font-medium text-slate-800 truncate max-w-[210px]">
                  {sourceFilename}
                </span>
                <span className="tabular-nums shrink-0 text-slate-500">
                  {renderedPages.length > 0
                    ? `${renderedPages.length} trang`
                    : pendingDocxPages.length > 0
                    ? `${pendingDocxPages.length} trang Docx`
                    : pastedLatex.trim()
                    ? `${pastedLatex.split('\n').length} dòng`
                    : 'Đã chọn'}
                </span>
              </div>
            )}
          </section>

          {/* Dán công thức Toán (LaTeX bọc $...$ hoặc LaTeX căn bản) */}
          <section className="p-5 space-y-2.5">
            <div className="flex items-center gap-2">
              <ClipboardPaste className="w-4 h-4 text-blue-700 shrink-0" />
              <h2 className="text-xs font-semibold text-slate-900">
                Dán công thức Toán (<code className="font-mono">$...$</code> hoặc LaTeX căn bản)
              </h2>
            </div>

            <textarea
              value={pastedLatex}
              onChange={(e) => {
                const nextVal = e.target.value;
                if (extractedPages.length > 0 || editedPages !== null || docxDownloadUrl) {
                  resetResults();
                }
                setRenderedPages([]);
                setPendingDocxPages([]);
                setPastedLatex(nextVal);
                setInputSource('paste');
                setActiveTab('preview');
              }}
              rows={5}
              placeholder={
                'Dán văn bản Toán học có công thức bọc $...$, $$...$$, \\(...\\), \\[...\\] hoặc mã LaTeX căn bản tại đây...'
              }
              className="w-full p-3 text-xs font-mono text-slate-800 bg-slate-50/70 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white resize-y"
            />
          </section>

          {/* 2. Tùy chọn chuyển đổi & Định dạng */}
          <section className="p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900">2. Tùy chọn chuyển đổi</h2>

            <div>
              <label
                htmlFor="dpi-select"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Độ phân giải xử lý PDF
              </label>
              <select
                id="dpi-select"
                value={renderDpi}
                onChange={(e) => setRenderDpi(Number(e.target.value))}
                disabled={isConverting}
                className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value={200}>200 DPI (Nhanh)</option>
                <option value={250}>250 DPI (Khuyên dùng)</option>
                <option value={300}>300 DPI (Sắc nét tối đa)</option>
              </select>
            </div>

            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={addPageBreaks}
                onChange={(e) => setAddPageBreaks(e.target.checked)}
                disabled={isConverting}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
              />
              <span className="text-sm text-slate-700">
                Ngắt trang Word tương ứng từng trang PDF gốc
              </span>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoCropFigures}
                onChange={(e) => setAutoCropFigures(e.target.checked)}
                disabled={isConverting}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
              />
              <span className="text-sm text-slate-700">
                Tự động nhận diện &amp; cắt chèn hình vẽ / đồ thị / bảng biến thiên
              </span>
            </label>

            <div>
              <span className="block text-xs font-medium text-slate-700 mb-1.5">
                Định dạng phương án trả lời (A, B, C, D)
              </span>
              <div className="space-y-2">
                <label
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition-colors cursor-pointer select-none ${
                    choiceLayout === 'table'
                      ? 'border-blue-600 bg-blue-50/40'
                      : 'border-slate-200 hover:border-blue-400'
                  }`}
                >
                  <input
                    type="radio"
                    name="choice-layout"
                    value="table"
                    checked={choiceLayout === 'table'}
                    onChange={() => void handleChoiceLayoutChange('table')}
                    disabled={isConverting}
                    className="mt-0.5 h-4 w-4 border-slate-300 text-blue-700 focus:ring-blue-600"
                  />
                  <span className="text-xs leading-relaxed text-slate-700">
                    <strong className="block text-slate-900 font-semibold">
                      Nằm trong bảng
                    </strong>
                    Chia cột bằng bảng không viền, giữ thẳng hàng tuyệt đối
                  </span>
                </label>
                <label
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition-colors cursor-pointer select-none ${
                    choiceLayout === 'tabs'
                      ? 'border-blue-600 bg-blue-50/40'
                      : 'border-slate-200 hover:border-blue-400'
                  }`}
                >
                  <input
                    type="radio"
                    name="choice-layout"
                    value="tabs"
                    checked={choiceLayout === 'tabs'}
                    onChange={() => void handleChoiceLayoutChange('tabs')}
                    disabled={isConverting}
                    className="mt-0.5 h-4 w-4 border-slate-300 text-blue-700 focus:ring-blue-600"
                  />
                  <span className="text-xs leading-relaxed text-slate-700">
                    <strong className="block text-slate-900 font-semibold">
                      Không trong bảng (đặt Tab)
                    </strong>
                    Xuất đoạn văn chuẩn đặt điểm dừng Tab phù hợp từng cột
                  </span>
                </label>
              </div>
            </div>

            <div className="pt-2 space-y-3">
              <button
                type="button"
                onClick={handleStartConversion}
                disabled={
                  (renderedPages.length === 0 &&
                    pendingDocxPages.length === 0 &&
                    !pastedLatex.trim()) ||
                  isConverting ||
                  isExportingPaste ||
                  isLoadingFile
                }
                className="w-full h-11 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:bg-slate-300 disabled:text-slate-500 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                {isConverting || isExportingPaste ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Đang xử lý...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Bắt đầu chuyển đổi
                  </>
                )}
              </button>

              {/* Progress Bar */}
              {(isConverting || isExportingPaste || progressPct > 0) && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-600 tabular-nums">
                    <span className="truncate pr-2">
                      {statusMessage || 'Đang chuẩn bị...'}
                    </span>
                    <span className="font-semibold text-slate-900 shrink-0">
                      {progressPct}%
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                    <div
                      className="h-full bg-blue-700 transition-all duration-200"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              )}

              {errorMessage && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2 text-xs text-red-800">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {docxDownloadUrl && (
                <div className="pt-1 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Tạo tệp Word thành công</span>
                  </div>
                  <a
                    href={docxDownloadUrl}
                    download={docxFileName}
                    className="w-full h-11 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Tải xuống file Word
                  </a>
                </div>
              )}
            </div>

            {displayPreviewPages.length > 0 && (
              <div className="pt-3 border-t border-slate-100 grid grid-cols-3 gap-2 text-center tabular-nums">
                <div>
                  <div className="text-base font-bold text-slate-900">
                    {equationsList.length}
                  </div>
                  <div className="text-xs text-slate-500">Công thức</div>
                </div>
                <div>
                  <div className="text-base font-bold text-slate-900">
                    {figuresList.length}
                  </div>
                  <div className="text-xs text-slate-500">Hình vẽ</div>
                </div>
                <div>
                  <div className="text-base font-bold text-slate-900">{tableCount}</div>
                  <div className="text-xs text-slate-500">Bảng biểu</div>
                </div>
              </div>
            )}
          </section>

          {/* Page Thumbnails */}
          {renderedPages.length > 1 && (
            <section className="p-5">
              <h2 className="text-sm font-semibold text-slate-900 mb-3">
                Danh sách trang ({renderedPages.length})
              </h2>
              <div className="grid grid-cols-3 gap-2.5 max-h-[260px] overflow-y-auto pr-1">
                {renderedPages.map((pg) => (
                  <button
                    key={pg.pageNumber}
                    type="button"
                    onClick={() => setSelectedPageNum(pg.pageNumber)}
                    className={`p-1.5 rounded-lg border text-center transition-colors cursor-pointer ${
                      selectedPageNum === pg.pageNumber
                        ? 'border-blue-600 bg-blue-50/50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <img
                      src={pg.dataUrl}
                      alt={`Trang ${pg.pageNumber}`}
                      referrerPolicy="no-referrer"
                      className="w-full h-20 object-contain bg-white rounded"
                    />
                    <span className="mt-1 block text-xs font-medium text-slate-700 tabular-nums">
                      Trang {pg.pageNumber}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </aside>

        {/* Right Content Display Area */}
        <div className="flex-1 min-w-0 px-6 py-6 space-y-6">
          {/* Compact Workspace Intro Header (hidden per user selection) */}
          <div className="hidden">
            <div className="max-w-2xl">
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900 text-balance">
                Chuyển đổi Tài liệu Toán học sang Word Equation
              </h1>
              <p className="mt-1.5 text-sm text-slate-600">
                Tải lên đề thi, giáo trình dạng PDF hoặc ảnh chụp. Hệ thống tự động giữ nguyên bố
                cục, cắt chèn hình vẽ và chuyển công thức sang chuẩn OMML chỉnh sửa trực tiếp trong
                Microsoft Word.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500 tabular-nums shrink-0">
              <span>Định dạng hỗ trợ: PDF, PNG, JPG</span>
              <span aria-hidden="true">·</span>
              <span>Xuất chuẩn DOCX (OMML)</span>
            </div>
          </div>


          {/* Right Viewport: Tabs & Document / Equation / Figure Inspection */}
          <section className="space-y-4">
            {/* Segmented Tab Bar (hidden per user selection) */}
            <div className="hidden">
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setActiveTab('preview')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeTab === 'preview'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  Xem trước Word
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('original')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeTab === 'original'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <FileImage className="w-3.5 h-3.5" />
                  Tài liệu gốc
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('equations')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeTab === 'equations'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Code2 className="w-3.5 h-3.5" />
                  Công thức OMML ({equationsList.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('figures')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeTab === 'figures'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Crop className="w-3.5 h-3.5" />
                  Hình vẽ đã cắt ({figuresList.length})
                </button>
              </div>

              {renderedPages.length > 0 && (
                <div className="text-xs text-slate-500 px-2 tabular-nums whitespace-nowrap">
                  Trang {selectedPageNum} / {renderedPages.length}
                </div>
              )}
            </div>

            {/* Viewport Content */}
            {renderedPages.length === 0 &&
            pendingDocxPages.length === 0 &&
            !pastedLatex.trim() &&
            displayPreviewPages.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
                <Layers className="w-10 h-10 text-slate-400 mx-auto mb-3" />
                <h3 className="text-base font-semibold text-slate-900">
                  Chưa có tài liệu nào được tải lên
                </h3>
                <p className="mt-1.5 text-sm text-slate-600 max-w-md mx-auto">
                  Hãy chọn file PDF, Docx (.docx), .txt, .tex hoặc ảnh chụp bài toán bên trái, hoặc
                  dán trực tiếp mã LaTeX vào khung bên trái.
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer"
                  >
                    <Upload className="w-4 h-4" />
                    Tải file PDF, Docx, TXT, TEX, Ảnh
                  </button>
                  <button
                    type="button"
                    onClick={handleUseSampleWorksheet}
                    className="hidden"
                  >
                    <Sparkles className="w-4 h-4" />
                    Dùng đề toán mẫu
                  </button>
                </div>
              </div>
            ) : activeTab === 'original' ? (
              renderedPages.length > 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  {currentOriginalPage && (
                    <div className="relative max-w-[780px] mx-auto border border-slate-200 rounded overflow-hidden bg-white">
                      <img
                        src={currentOriginalPage.dataUrl}
                        alt={`Trang gốc ${currentOriginalPage.pageNumber}`}
                        referrerPolicy="no-referrer"
                        className="w-full h-auto block"
                      />
                      {currentPageFigureBoxes.map((fig, idx) => {
                        const [ymin, xmin, ymax, xmax] = fig.box;
                        return (
                          <div
                            key={idx}
                            style={{
                              top: `${ymin / 10}%`,
                              left: `${xmin / 10}%`,
                              height: `${(ymax - ymin) / 10}%`,
                              width: `${(xmax - xmin) / 10}%`,
                            }}
                            className="absolute border-2 border-blue-600 bg-blue-500/10 pointer-events-none"
                          >
                            <span className="absolute -top-5 left-0 bg-blue-700 text-white text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap">
                              Hình cắt #{idx + 1}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
                  <p className="text-sm text-slate-600">
                    Tệp đang chọn là tài liệu văn bản / Word / LaTeX. Nhấn{' '}
                    <strong className="text-slate-900">Bắt đầu chuyển đổi</strong> ở cột bên trái
                    hoặc chọn tab <strong className="text-slate-900">Xem trước Word</strong>.
                  </p>
                </div>
              )
            ) : activeTab === 'preview' ? (
              displayPreviewPages.length > 0 ? (
                <DocumentPreview
                  pages={displayPreviewPages}
                  choiceLayout={choiceLayout}
                  mathFormat={mathFormat}
                  onSelectEquation={handleInspectEquation}
                  editable={!isConverting && !isExportingPaste}
                  isEditMode={isPreviewEditMode}
                  onToggleEditMode={() => setIsPreviewEditMode((v) => !v)}
                  hasEdits={editedPages !== null}
                  onResetEdits={handleResetPreviewEdits}
                  onSyncWord={handleSyncPreviewWord}
                  isSyncingWord={isSyncingEditedWord}
                  hasWordOutput={Boolean(docxDownloadUrl)}
                  onUpdateBlock={handleUpdatePreviewBlock}
                  onDeleteBlock={handleDeletePreviewBlock}
                  onInsertBlock={handleInsertPreviewBlock}
                  onMoveBlock={handleMovePreviewBlock}
                />
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
                  <p className="text-sm text-slate-600">
                    Tài liệu đã sẵn sàng. Nhấn{' '}
                    <strong className="text-slate-900">Bắt đầu chuyển đổi</strong> ở cột bên trái
                    để nhận dạng nội dung và xem trước bản Word tại đây.
                  </p>
                </div>
              )
            ) : activeTab === 'equations' ? (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                {equationsList.length === 0 ? (
                  <div className="p-10 text-center text-sm text-slate-500">
                    Chưa có công thức nào được trích xuất. Hãy chạy chuyển đổi trước.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                          <th className="py-3 px-4 w-14">#</th>
                          <th className="py-3 px-4 w-20">Trang</th>
                          <th className="py-3 px-4">Hiển thị Toán học</th>
                          <th className="py-3 px-4">Mã LaTeX</th>
                          <th className="py-3 px-4 w-28 text-right">XML OMML</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {equationsList.map((eq) => (
                          <tr key={eq.id} className="hover:bg-slate-50/70">
                            <td className="py-3 px-4 tabular-nums text-slate-500">{eq.id}</td>
                            <td className="py-3 px-4 tabular-nums text-slate-600">
                              {eq.pageNumber} · {eq.isDisplay ? 'Khối' : 'Dòng'}
                            </td>
                            <td className="py-3 px-4">
                              <MathRenderer latex={eq.latex} displayMode={false} />
                            </td>
                            <td className="py-3 px-4 font-mono text-xs text-slate-700 max-w-[260px] truncate">
                              {eq.latex}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <button
                                type="button"
                                onClick={() => handleInspectEquation(eq.latex, eq.isDisplay)}
                                className="text-xs font-semibold text-blue-700 hover:text-blue-800 hover:underline cursor-pointer whitespace-nowrap"
                              >
                                Xem XML
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                {figuresList.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">
                    Không phát hiện hình vẽ/biểu đồ nào hoặc chưa chạy chuyển đổi.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {figuresList.map((fig) => (
                      <div
                        key={fig.id}
                        className="border border-slate-200 rounded-lg p-3 flex flex-col items-center bg-slate-50/50"
                      >
                        <img
                          src={fig.dataUrl}
                          alt={fig.caption || `Hình vẽ #${fig.id}`}
                          referrerPolicy="no-referrer"
                          className="max-h-56 object-contain bg-white rounded border border-slate-200 p-1"
                        />
                        <div className="mt-2.5 w-full flex items-center justify-between text-xs text-slate-600 tabular-nums">
                          <span className="font-medium text-slate-800">
                            Hình #{fig.id} (Trang {fig.pageNumber})
                          </span>
                          <span>
                            {fig.width} × {fig.height} px
                          </span>
                        </div>
                        {fig.caption && (
                          <p className="mt-1 text-xs italic text-slate-600 text-center">
                            {fig.caption}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Technical OMML Explanation Section */}
          <section
            id="omml-guide"
            className="bg-white border border-slate-200 rounded-xl p-6 md:p-8"
          >
            <h2 className="text-lg font-bold text-slate-900">
              Cơ chế chuyển công thức Toán sang Word Equation (OMML)
            </h2>
            <p className="hidden">
              Trong tệp Word (<code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">.docx</code>),
              công thức toán chỉnh sửa được không phải là ảnh mà là các thẻ XML theo chuẩn{' '}
              <strong>Office Math Markup Language (OMML)</strong> thuộc namespace{' '}
              <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                http://schemas.openxmlformats.org/officeDocument/2006/math
              </code>
              . Ứng dụng thực hiện quy trình 3 bước hoàn toàn tự động:
            </p>
            <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-6 text-sm text-slate-700">
              <div>
                <h3 className="font-semibold text-slate-900">
                  01. Bóc tách cấu trúc & LaTeX
                </h3>
                <p className="mt-1.5 text-slate-600 leading-relaxed">
                  Mỗi trang PDF được render ở độ phân giải cao (200–300 DPI). AI Vision nhận diện văn
                  bản, căn lề, định dạng đậm/nghiêng, tách công thức thành mã LaTeX chuẩn xác và trả
                  về tọa độ chuẩn hóa để cắt hình vẽ/đồ thị.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">
                  02. LaTeX → MathML → XML OMML
                </h3>
                <p className="mt-1.5 text-slate-600 leading-relaxed">
                  Máy chủ biên dịch LaTeX sang cây MathML XML rồi dịch đệ quy sang các thẻ OMML chuẩn
                  Word: phân số (<code className="text-xs">m:f</code>), căn thức (
                  <code className="text-xs">m:rad</code>), tích phân/tổng (
                  <code className="text-xs">m:nary</code>), chỉ số (<code className="text-xs">m:sSubSup</code>)
                  và hệ phương trình/ma trận (<code className="text-xs">m:d</code>,{' '}
                  <code className="text-xs">m:m</code>).
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">
                  03. Đóng gói OOXML (.docx)
                </h3>
                <p className="mt-1.5 text-slate-600 leading-relaxed">
                  Mọi node <code className="text-xs">&lt;m:oMath&gt;</code> (cùng dòng) và{' '}
                  <code className="text-xs">&lt;m:oMathPara&gt;</code> (độc lập) được nhúng trực tiếp
                  vào <code className="text-xs">word/document.xml</code> kèm font{' '}
                  <em>Cambria Math</em>, văn bản <em>Times New Roman</em> và các hình PNG đã cắt.
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* OMML XML Inspector Modal */}
      {inspectedEq && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          onClick={() => setInspectedEq(null)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full p-6 shadow-lg space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">
                Chi tiết công thức Word Equation (OMML)
              </h3>
              <button
                type="button"
                onClick={() => setInspectedEq(null)}
                className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 cursor-pointer"
                aria-label="Đóng"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg flex justify-center overflow-x-auto">
              <MathRenderer latex={inspectedEq.latex} displayMode={true} />
            </div>

            <div>
              <div className="text-xs font-semibold text-slate-600 mb-1">Mã LaTeX gốc</div>
              <pre className="p-3 bg-slate-900 text-slate-100 rounded-lg text-xs overflow-x-auto font-mono">
                {inspectedEq.latex}
              </pre>
            </div>

            <div>
              <div className="text-xs font-semibold text-slate-600 mb-1">
                Mã XML OMML nhúng trong Word (.docx)
              </div>
              <pre className="p-3 bg-slate-900 text-emerald-300 rounded-lg text-xs overflow-x-auto max-h-60 font-mono whitespace-pre-wrap break-all">
                {inspectedEq.omml}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
