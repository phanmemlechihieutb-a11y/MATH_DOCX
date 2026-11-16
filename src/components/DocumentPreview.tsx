import { useEffect, useState, type CSSProperties } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Bold,
  Check,
  FileDown,
  Italic,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import type {
  BlockAlignment,
  ChoiceLayoutMode,
  DocumentBlock,
  InlineSegment,
  MathOutputFormat,
  PageExtraction,
  TableCellData,
} from '../types/document';
import {
  cleanLatexDelimiters,
  computePageGeometry,
  groupBlocksIntoVisualBands,
  groupSegmentsByTabs,
  isChoiceTableBlock,
  isValidBox,
  normalizeHexColor,
  transformBlocksForChoiceLayout,
  type PageGeometry,
} from '../utils/layoutMetrics';
import {
  editableStringToSegments,
  isUniformBlockStyle,
  segmentsToEditableString,
} from '../utils/previewEditor';
import { MathRenderer } from './MathRenderer';

interface DocumentPreviewProps {
  pages: PageExtraction[];
  choiceLayout?: ChoiceLayoutMode;
  mathFormat?: MathOutputFormat;
  onSelectEquation?: (latex: string, isDisplay: boolean) => void;
  editable?: boolean;
  isEditMode?: boolean;
  onToggleEditMode?: () => void;
  hasEdits?: boolean;
  onResetEdits?: () => void;
  onSyncWord?: () => void;
  isSyncingWord?: boolean;
  hasWordOutput?: boolean;
  onUpdateBlock?: (pageNumber: number, blockIndex: number, nextBlock: DocumentBlock) => void;
  onDeleteBlock?: (pageNumber: number, blockIndex: number) => void;
  onInsertBlock?: (
    pageNumber: number,
    afterBlockIndex: number,
    kind: 'paragraph' | 'heading' | 'equation'
  ) => void;
  onMoveBlock?: (pageNumber: number, blockIndex: number, direction: -1 | 1) => void;
}

const ALIGN_CLASS_MAP: Record<DocumentBlock['alignment'], string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
  justify: 'text-justify',
};

const JUSTIFY_FLEX_MAP: Record<DocumentBlock['alignment'], string> = {
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end',
  justify: 'justify-start',
};

function getBlockFontSizePt(blk: DocumentBlock): number {
  if (typeof blk.font_size_pt === 'number' && Number.isFinite(blk.font_size_pt)) {
    return Math.max(7, Math.min(48, blk.font_size_pt));
  }
  if (blk.block_type === 'heading') {
    return blk.heading_level === 1 ? 15 : blk.heading_level === 3 ? 12 : 13;
  }
  if (blk.block_type === 'table') return 11;
  return 12;
}

function RenderSegments({
  segments,
  defaultBold = false,
  baseFontPt = 12,
  scale = 1.28,
  mathFormat = 'omml',
  disableEquationInspect = false,
  onSelectEquation,
}: {
  segments?: InlineSegment[] | null;
  defaultBold?: boolean;
  baseFontPt?: number;
  scale?: number;
  mathFormat?: MathOutputFormat;
  disableEquationInspect?: boolean;
  onSelectEquation?: (latex: string, isDisplay: boolean) => void;
}) {
  if (!segments || segments.length === 0) return null;

  return (
    <>
      {segments.map((seg, idx) => {
        const segFontPt =
          typeof seg.font_size_pt === 'number' && Number.isFinite(seg.font_size_pt)
            ? Math.max(7, Math.min(48, seg.font_size_pt))
            : baseFontPt;
        const hex = normalizeHexColor(seg.color);
        const isBold = seg.bold !== undefined ? Boolean(seg.bold) : defaultBold;

        const tabPrefix = seg.tab_before ? (
          <span className="inline-block w-8" aria-hidden="true" />
        ) : null;

        if (seg.type === 'math') {
          if (mathFormat === 'latex') {
            const latexText = `$${cleanLatexDelimiters(seg.content)}$`;
            if (disableEquationInspect) {
              return (
                <span key={idx}>
                  {tabPrefix}
                  <span
                    style={{
                      fontSize: `${segFontPt * scale * 0.92}px`,
                      color: hex ? `#${hex}` : undefined,
                    }}
                    className="inline font-mono px-1 mx-0.5 rounded bg-amber-50 text-slate-900 border border-amber-200/80"
                  >
                    {latexText}
                  </span>
                </span>
              );
            }
            return (
              <span key={idx}>
                {tabPrefix}
                <button
                  type="button"
                  onClick={() => onSelectEquation?.(seg.content, false)}
                  title="Công thức LaTeX bọc $...$ — nhấn để xem chi tiết"
                  style={{
                    fontSize: `${segFontPt * scale * 0.92}px`,
                    color: hex ? `#${hex}` : undefined,
                  }}
                  className="inline font-mono px-1 mx-0.5 rounded bg-amber-50 text-slate-900 border border-amber-200/80 hover:bg-amber-100/80 transition-colors cursor-pointer"
                >
                  {latexText}
                </button>
              </span>
            );
          }

          const mathStyleClass = [
            isBold ? 'font-bold' : '',
            seg.italic ? 'italic' : '',
            seg.underline ? 'underline' : '',
          ]
            .filter(Boolean)
            .join(' ');

          if (disableEquationInspect) {
            return (
              <span key={idx}>
                {tabPrefix}
                <span
                  style={{
                    fontSize: `${segFontPt * scale}px`,
                    color: hex ? `#${hex}` : undefined,
                  }}
                  className={`inline-flex items-center px-[1px] align-baseline ${mathStyleClass}`}
                >
                  <MathRenderer latex={seg.content} displayMode={false} />
                </span>
              </span>
            );
          }

          return (
            <span key={idx}>
              {tabPrefix}
              <button
                type="button"
                onClick={() => onSelectEquation?.(seg.content, false)}
                title="Nhấn để xem mã LaTeX và XML OMML"
                style={{
                  fontSize: `${segFontPt * scale}px`,
                  color: hex ? `#${hex}` : undefined,
                }}
                className={`inline-flex items-center px-[1px] rounded hover:bg-blue-50 hover:ring-1 hover:ring-blue-300 transition-colors align-baseline cursor-pointer ${mathStyleClass}`}
              >
                <MathRenderer latex={seg.content} displayMode={false} />
              </button>
            </span>
          );
        }

        const lines = (seg.content ?? '').split('\n');
        const textClass = [
          isBold ? 'font-bold' : 'font-normal',
          seg.italic ? 'italic' : '',
          seg.underline ? 'underline' : '',
        ]
          .filter(Boolean)
          .join(' ');

        const segStyle: CSSProperties = {
          fontSize: `${segFontPt * scale}px`,
          color: hex ? `#${hex}` : undefined,
        };

        return (
          <span key={idx} className={textClass} style={segStyle}>
            {tabPrefix}
            {lines.map((line, lIdx) => (
              <span key={lIdx} className="whitespace-pre-wrap">
                {line}
                {lIdx < lines.length - 1 && <br />}
              </span>
            ))}
          </span>
        );
      })}
    </>
  );
}

function InlineBlockEditor({
  block,
  mathFormat,
  onSave,
  onCancel,
  onDelete,
}: {
  block: DocumentBlock;
  mathFormat: MathOutputFormat;
  onSave: (nextBlock: DocumentBlock) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const isTabbedParagraph =
    block.block_type === 'paragraph' &&
    Boolean(block.segments?.some((s) => s.tab_before));

  const initialTabColumns = isTabbedParagraph
    ? groupSegmentsByTabs(block.segments ?? []).map((grp) => segmentsToEditableString(grp))
    : [];

  const [blockType, setBlockType] = useState<'paragraph' | 'heading'>(
    block.block_type === 'heading' ? 'heading' : 'paragraph'
  );
  const [headingLevel, setHeadingLevel] = useState<number>(block.heading_level ?? 2);
  const [alignment, setAlignment] = useState<BlockAlignment>(block.alignment ?? 'left');
  const [fontSizePt, setFontSizePt] = useState<number>(getBlockFontSizePt(block));
  const [isBoldAll, setIsBoldAll] = useState<boolean>(
    isUniformBlockStyle(block.segments, 'bold')
  );
  const [isItalicAll, setIsItalicAll] = useState<boolean>(
    isUniformBlockStyle(block.segments, 'italic')
  );

  const [draftText, setDraftText] = useState<string>(() =>
    segmentsToEditableString(block.segments)
  );
  const [draftTabCols, setDraftTabCols] = useState<string[]>(initialTabColumns);

  const [draftLatex, setDraftLatex] = useState<string>(() =>
    cleanLatexDelimiters(block.latex ?? '')
  );

  const [draftRows, setDraftRows] = useState<string[][]>(() =>
    (block.table_rows ?? []).map((row) =>
      row.map((cell) => segmentsToEditableString(cell.segments))
    )
  );
  const [activeCell, setActiveCell] = useState<{ r: number; c: number } | null>(
    block.block_type === 'table' ? { r: 0, c: 0 } : null
  );

  const [draftCaption, setDraftCaption] = useState<string>(block.caption ?? '');

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const buildPreviewParagraphSegments = (): InlineSegment[] => {
    const styleOverride: Partial<InlineSegment> = {
      ...(isBoldAll ? { bold: true } : {}),
      ...(isItalicAll ? { italic: true } : {}),
      font_size_pt: fontSizePt,
    };

    if (isTabbedParagraph && draftTabCols.length > 0) {
      const origGroups = groupSegmentsByTabs(block.segments ?? []);
      const combined: InlineSegment[] = [];
      draftTabCols.forEach((colText, idx) => {
        const parsed = editableStringToSegments(
          colText,
          origGroups[idx] ?? block.segments,
          isBoldAll || isItalicAll ? styleOverride : { font_size_pt: fontSizePt }
        );
        if (parsed.length > 0) {
          if (idx > 0) {
            parsed[0] = { ...parsed[0], tab_before: true };
          }
          combined.push(...parsed);
        } else if (idx > 0) {
          combined.push({ type: 'text', content: '', tab_before: true });
        }
      });
      return combined;
    }

    return editableStringToSegments(
      draftText,
      block.segments,
      isBoldAll || isItalicAll || blockType === 'heading'
        ? styleOverride
        : { font_size_pt: fontSizePt }
    );
  };

  const handleSaveParagraphOrHeading = () => {
    const nextSegments = buildPreviewParagraphSegments();
    const cleanedSegments =
      nextSegments.length > 0
        ? nextSegments
        : [{ type: 'text' as const, content: '' }];

    if (blockType === 'heading') {
      onSave({
        ...block,
        block_type: 'heading',
        heading_level: headingLevel,
        alignment,
        font_size_pt: fontSizePt,
        segments: cleanedSegments,
      });
      return;
    }

    onSave({
      ...block,
      block_type: 'paragraph',
      heading_level: null,
      alignment,
      font_size_pt: fontSizePt,
      segments: cleanedSegments,
    });
  };

  const handleSaveEquation = () => {
    const cleaned = cleanLatexDelimiters(draftLatex);
    if (!cleaned) {
      onDelete?.();
      return;
    }
    onSave({
      ...block,
      block_type: 'equation',
      alignment: alignment === 'justify' ? 'center' : alignment,
      latex: cleaned,
      font_size_pt: fontSizePt,
    });
  };

  const handleSaveTable = () => {
    const origRows = block.table_rows ?? [];
    const nextRows: TableCellData[][] = draftRows.map((row, rIdx) =>
      row.map((cellText, cIdx) => {
        const templateCell = origRows[rIdx]?.[cIdx] ?? origRows[0]?.[cIdx];
        return {
          ...(templateCell ?? {}),
          segments: editableStringToSegments(cellText, templateCell?.segments),
        };
      })
    );
    onSave({
      ...block,
      table_rows: nextRows,
    });
  };

  const handleSaveFigure = () => {
    onSave({
      ...block,
      alignment: alignment === 'justify' ? 'center' : alignment,
      caption: draftCaption.trim() ? draftCaption.trim() : null,
    });
  };

  const alignBtn = (val: BlockAlignment, label: string, Icon: typeof AlignLeft) => (
    <button
      key={val}
      type="button"
      onClick={() => setAlignment(val)}
      title={label}
      className={`p-1.5 rounded border text-xs transition-colors cursor-pointer ${
        alignment === val
          ? 'bg-blue-700 text-white border-blue-700'
          : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );

  if (block.block_type === 'equation') {
    const cleanedPreview = cleanLatexDelimiters(draftLatex);
    return (
      <div
        className="my-2 p-3.5 bg-slate-50 border border-blue-500 rounded-lg shadow-xs font-sans space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-800">
            Chỉnh sửa công thức độc lập (LaTeX)
          </span>
          <div className="flex items-center gap-1.5">
            {alignBtn('left', 'Căn trái', AlignLeft)}
            {alignBtn('center', 'Căn giữa', AlignCenter)}
            {alignBtn('right', 'Căn phải', AlignRight)}
          </div>
        </div>

        <textarea
          autoFocus
          value={draftLatex}
          onChange={(e) => setDraftLatex(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              handleSaveEquation();
            }
          }}
          rows={3}
          placeholder="Nhập mã LaTeX (ví dụ: \frac{-b \pm \sqrt{\Delta}}{2a})..."
          className="w-full p-2.5 text-xs font-mono text-slate-900 bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 resize-y"
        />

        <div className="p-3 bg-white border border-slate-200 rounded-md flex justify-center overflow-x-auto min-h-[44px]">
          {cleanedPreview ? (
            <MathRenderer latex={cleanedPreview} displayMode={true} />
          ) : (
            <span className="text-xs text-slate-400">Xem trước công thức...</span>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-[11px] text-slate-500">
            Ctrl + Enter để lưu · Esc để hủy
          </span>
          <div className="flex items-center gap-2">
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Xóa
              </button>
            )}
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={handleSaveEquation}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Check className="w-3.5 h-3.5" />
              Lưu công thức
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (block.block_type === 'table') {
    const isChoice = isChoiceTableBlock(block);
    const activeCellText =
      activeCell && draftRows[activeCell.r]?.[activeCell.c] !== undefined
        ? draftRows[activeCell.r][activeCell.c]
        : '';
    const activeOrigSegs =
      activeCell && block.table_rows?.[activeCell.r]?.[activeCell.c]?.segments
        ? block.table_rows[activeCell.r][activeCell.c].segments
        : undefined;

    return (
      <div
        className="my-2 p-3.5 bg-slate-50 border border-blue-500 rounded-lg shadow-xs font-sans space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-800">
            {isChoice
              ? 'Chỉnh sửa các phương án trả lời (bọc công thức bằng $...$)'
              : 'Chỉnh sửa nội dung bảng (bọc công thức bằng $...$)'}
          </span>
          {!isChoice && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  setDraftRows((prev) => {
                    const cols = Math.max(1, prev[0]?.length ?? 2);
                    return [...prev, Array.from({ length: cols }, () => '')];
                  })
                }
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 hover:border-slate-400 rounded cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus className="w-3 h-3" />
                Thêm hàng
              </button>
              {draftRows.length > 1 && (
                <button
                  type="button"
                  onClick={() => setDraftRows((prev) => prev.slice(0, -1))}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 hover:border-slate-400 rounded cursor-pointer whitespace-nowrap shrink-0"
                >
                  Xóa hàng cuối
                </button>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2 overflow-x-auto">
          {draftRows.map((row, rIdx) => (
            <div
              key={rIdx}
              style={{
                gridTemplateColumns: `repeat(${Math.max(1, row.length)}, minmax(120px, 1fr))`,
              }}
              className="grid gap-2"
            >
              {row.map((val, cIdx) => (
                <textarea
                  key={`${rIdx}-${cIdx}`}
                  rows={2}
                  value={val}
                  onFocus={() => setActiveCell({ r: rIdx, c: cIdx })}
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    setDraftRows((prev) =>
                      prev.map((r, ri) =>
                        ri !== rIdx ? r : r.map((c, ci) => (ci !== cIdx ? c : nextVal))
                      )
                    );
                  }}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                      e.preventDefault();
                      handleSaveTable();
                    }
                  }}
                  className="w-full p-2 text-xs font-mono text-slate-900 bg-white border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-600 resize-y"
                />
              ))}
            </div>
          ))}
        </div>

        {activeCell && (
          <div className="p-2.5 bg-white border border-slate-200 rounded-md doc-serif text-slate-900">
            <div className="font-sans text-[11px] font-medium text-slate-500 mb-1">
              Xem trước ô [{activeCell.r + 1}, {activeCell.c + 1}]:
            </div>
            <div className="text-sm">
              <RenderSegments
                segments={editableStringToSegments(activeCellText, activeOrigSegs)}
                baseFontPt={11}
                scale={1.25}
                mathFormat={mathFormat}
                disableEquationInspect
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-[11px] text-slate-500">
            Ctrl + Enter để lưu · Esc để hủy
          </span>
          <div className="flex items-center gap-2">
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Xóa bảng
              </button>
            )}
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={handleSaveTable}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Check className="w-3.5 h-3.5" />
              Lưu bảng
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (block.block_type === 'figure') {
    return (
      <div
        className="my-2 p-3.5 bg-slate-50 border border-blue-500 rounded-lg shadow-xs font-sans space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-800">
            Chỉnh sửa hình vẽ &amp; chú thích
          </span>
          <div className="flex items-center gap-1.5">
            {alignBtn('left', 'Căn trái', AlignLeft)}
            {alignBtn('center', 'Căn giữa', AlignCenter)}
            {alignBtn('right', 'Căn phải', AlignRight)}
          </div>
        </div>

        {block.croppedImageDataUrl && (
          <div className="flex justify-center bg-white border border-slate-200 rounded p-2">
            <img
              src={block.croppedImageDataUrl}
              alt={draftCaption || 'Hình vẽ'}
              referrerPolicy="no-referrer"
              className="max-h-48 object-contain"
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Chú thích hình (tùy chọn)
          </label>
          <input
            type="text"
            autoFocus
            value={draftCaption}
            onChange={(e) => setDraftCaption(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSaveFigure();
              }
            }}
            placeholder="Nhập chú thích dưới hình..."
            className="w-full px-3 py-2 text-xs text-slate-900 bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 mr-auto"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Xóa hình
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={handleSaveFigure}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Check className="w-3.5 h-3.5" />
            Lưu
          </button>
        </div>
      </div>
    );
  }

  if (block.block_type === 'horizontal_rule') {
    return (
      <div
        className="my-2 p-3 bg-slate-50 border border-blue-500 rounded-lg font-sans flex items-center justify-between gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-xs font-medium text-slate-700">Đường kẻ ngang phân cách</span>
        <div className="flex items-center gap-2">
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 rounded-md cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Xóa đường kẻ
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    );
  }

  // Paragraph or Heading editor
  const previewSegments = buildPreviewParagraphSegments();

  return (
    <div
      className="my-2 p-3.5 bg-slate-50 border border-blue-500 rounded-lg shadow-xs font-sans space-y-2.5"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={blockType === 'heading' ? `h${headingLevel}` : 'p'}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'p') {
                setBlockType('paragraph');
              } else {
                setBlockType('heading');
                setHeadingLevel(Number(v.slice(1)) || 2);
              }
            }}
            className="h-7 px-2 text-xs font-medium bg-white border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="p">Đoạn văn</option>
            <option value="h1">Tiêu đề 1</option>
            <option value="h2">Tiêu đề 2</option>
            <option value="h3">Tiêu đề 3</option>
          </select>

          <select
            value={Math.round(fontSizePt)}
            onChange={(e) => setFontSizePt(Number(e.target.value))}
            title="Cỡ chữ"
            className="h-7 px-2 text-xs font-medium bg-white border border-slate-300 rounded text-slate-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {[10, 11, 12, 13, 14, 15, 16, 18, 20].map((sz) => (
              <option key={sz} value={sz}>
                {sz} pt
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setIsBoldAll((v) => !v)}
            title="In đậm toàn đoạn"
            className={`p-1.5 rounded border transition-colors cursor-pointer ${
              isBoldAll
                ? 'bg-blue-700 text-white border-blue-700'
                : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'
            }`}
          >
            <Bold className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setIsItalicAll((v) => !v)}
            title="In nghiêng toàn đoạn"
            className={`p-1.5 rounded border transition-colors cursor-pointer ${
              isItalicAll
                ? 'bg-blue-700 text-white border-blue-700'
                : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'
            }`}
          >
            <Italic className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-1">
          {alignBtn('left', 'Căn trái', AlignLeft)}
          {alignBtn('center', 'Căn giữa', AlignCenter)}
          {alignBtn('right', 'Căn phải', AlignRight)}
          {alignBtn('justify', 'Căn đều hai bên', AlignJustify)}
        </div>
      </div>

      {isTabbedParagraph ? (
        <div
          style={{
            gridTemplateColumns: `repeat(${Math.max(1, draftTabCols.length)}, minmax(120px, 1fr))`,
          }}
          className="grid gap-2"
        >
          {draftTabCols.map((colVal, idx) => (
            <div key={idx}>
              <div className="text-[11px] font-medium text-slate-500 mb-1">
                Cột Tab {idx + 1}
              </div>
              <textarea
                autoFocus={idx === 0}
                rows={2}
                value={colVal}
                onChange={(e) => {
                  const next = e.target.value;
                  setDraftTabCols((prev) => prev.map((v, i) => (i === idx ? next : v)));
                }}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    handleSaveParagraphOrHeading();
                  }
                }}
                className="w-full p-2 text-xs font-mono text-slate-900 bg-white border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-600 resize-y"
              />
            </div>
          ))}
        </div>
      ) : (
        <textarea
          autoFocus
          rows={Math.min(8, Math.max(3, Math.ceil(draftText.length / 75) + 1))}
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              handleSaveParagraphOrHeading();
            }
          }}
          placeholder="Nhập văn bản và công thức toán bọc $...$..."
          className="w-full p-2.5 text-xs sm:text-sm font-mono text-slate-900 bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 resize-y"
        />
      )}

      <div className={`p-2.5 bg-white border border-slate-200 rounded-md doc-serif text-slate-900 ${ALIGN_CLASS_MAP[alignment]}`}>
        <div className="font-sans text-[11px] text-slate-400 text-left mb-1">
          Xem trước hiển thị:
        </div>
        {previewSegments.length > 0 ? (
          <RenderSegments
            segments={previewSegments}
            defaultBold={false}
            baseFontPt={fontSizePt}
            scale={1.25}
            mathFormat={mathFormat}
            disableEquationInspect
          />
        ) : (
          <span className="font-sans text-xs text-slate-400">(Trống)</span>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <span className="text-[11px] text-slate-500">
          Dùng <code className="font-mono bg-white px-1 rounded border border-slate-200">$...$</code> cho công thức · Ctrl + Enter để lưu
        </span>
        <div className="flex items-center gap-2">
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Xóa khối
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={handleSaveParagraphOrHeading}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Check className="w-3.5 h-3.5" />
            Lưu thay đổi
          </button>
        </div>
      </div>
    </div>
  );
}

function RenderSingleBlock({
  blk,
  pageNumber,
  geom,
  scale,
  spaceBeforePt,
  indentLeftPt,
  indentRightPt,
  firstLineIndentPt,
  mathFormat = 'omml',
  disableEquationInspect = false,
  onSelectEquation,
}: {
  blk: DocumentBlock;
  pageNumber: number;
  geom: PageGeometry;
  scale: number;
  spaceBeforePt: number;
  indentLeftPt: number;
  indentRightPt: number;
  firstLineIndentPt: number;
  mathFormat?: MathOutputFormat;
  disableEquationInspect?: boolean;
  onSelectEquation?: (latex: string, isDisplay: boolean) => void;
}) {
  const alignClass = ALIGN_CLASS_MAP[blk.alignment] ?? 'text-left';
  const baseFontPt = getBlockFontSizePt(blk);
  const lineHeight =
    typeof blk.line_spacing === 'number' && Number.isFinite(blk.line_spacing)
      ? Math.max(1.0, Math.min(2.4, blk.line_spacing))
      : 1.25;

  const wrapperStyle: CSSProperties = {
    marginTop: `${spaceBeforePt * scale}px`,
    paddingLeft:
      firstLineIndentPt < 0
        ? `${(indentLeftPt + Math.abs(firstLineIndentPt)) * scale}px`
        : indentLeftPt > 0
        ? `${indentLeftPt * scale}px`
        : undefined,
    paddingRight: indentRightPt > 0 ? `${indentRightPt * scale}px` : undefined,
    textIndent:
      firstLineIndentPt !== 0 ? `${firstLineIndentPt * scale}px` : undefined,
    lineHeight,
  };

  if (blk.block_type === 'horizontal_rule') {
    return (
      <div
        style={{
          marginTop: `${spaceBeforePt * scale}px`,
          marginLeft: indentLeftPt > 0 ? `${indentLeftPt * scale}px` : undefined,
          marginRight: indentRightPt > 0 ? `${indentRightPt * scale}px` : undefined,
        }}
        className="border-b border-slate-700"
      />
    );
  }

  if (blk.block_type === 'heading') {
    return (
      <h3 style={wrapperStyle} className={`${alignClass}`}>
        <RenderSegments
          segments={blk.segments}
          defaultBold={false}
          baseFontPt={baseFontPt}
          scale={scale}
          mathFormat={mathFormat}
          disableEquationInspect={disableEquationInspect}
          onSelectEquation={onSelectEquation}
        />
      </h3>
    );
  }

  if (blk.block_type === 'paragraph') {
    const segs = blk.segments ?? [];
    const hasTabs =
      segs.some((s) => s.tab_before) &&
      Array.isArray(blk.tab_stops_pt) &&
      blk.tab_stops_pt.length > 0;

    if (hasTabs) {
      const groups = groupSegmentsByTabs(segs);
      const stops = blk.tab_stops_pt ?? [];
      const availWidth = Math.max(120, geom.contentWidthPt - indentLeftPt - indentRightPt);
      const colWidthsPt: number[] = [];
      let prevPt = indentLeftPt;
      for (let idx = 0; idx < groups.length; idx++) {
        if (idx < stops.length) {
          const w = Math.max(40, stops[idx] - prevPt);
          colWidthsPt.push(w);
          prevPt = stops[idx];
        } else {
          const used = colWidthsPt.reduce((a, b) => a + b, 0);
          colWidthsPt.push(Math.max(40, availWidth - used));
        }
      }
      const sumW = Math.max(1, colWidthsPt.reduce((a, b) => a + b, 0));
      const templateCols = colWidthsPt.map((w) => `${(w / sumW) * 100}%`).join(' ');

      return (
        <p
          style={{
            ...wrapperStyle,
            display: 'grid',
            gridTemplateColumns: templateCols,
            columnGap: '4px',
            alignItems: 'baseline',
          }}
        >
          {groups.map((grp, gIdx) => (
            <span key={gIdx} className="text-left">
              <RenderSegments
                segments={grp}
                baseFontPt={baseFontPt}
                scale={scale}
                mathFormat={mathFormat}
                disableEquationInspect={disableEquationInspect}
                onSelectEquation={onSelectEquation}
              />
            </span>
          ))}
        </p>
      );
    }

    return (
      <p style={wrapperStyle} className={`${alignClass}`}>
        <RenderSegments
          segments={blk.segments}
          baseFontPt={baseFontPt}
          scale={scale}
          mathFormat={mathFormat}
          disableEquationInspect={disableEquationInspect}
          onSelectEquation={onSelectEquation}
        />
      </p>
    );
  }

  if (blk.block_type === 'equation' && blk.latex) {
    const eqAlign = blk.alignment ?? 'center';
    const flexJustify = JUSTIFY_FLEX_MAP[eqAlign] ?? 'justify-center';
    if (mathFormat === 'latex') {
      const latexText = `$${cleanLatexDelimiters(blk.latex)}$`;
      return (
        <div
          style={{
            marginTop: `${spaceBeforePt * scale}px`,
            paddingLeft:
              eqAlign === 'center' || indentLeftPt <= 0 ? undefined : `${indentLeftPt * scale}px`,
            paddingRight:
              eqAlign === 'center' || indentRightPt <= 0 ? undefined : `${indentRightPt * scale}px`,
            fontSize: `${baseFontPt * scale * 0.92}px`,
          }}
          className={`flex ${flexJustify}`}
        >
          {disableEquationInspect ? (
            <span className="font-mono px-2 py-1 rounded-md bg-amber-50 text-slate-900 border border-amber-200/80">
              {latexText}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onSelectEquation?.(blk.latex ?? '', true)}
              title="Công thức LaTeX bọc $...$ — nhấn để xem chi tiết"
              className="font-mono px-2 py-1 rounded-md bg-amber-50 text-slate-900 border border-amber-200/80 hover:bg-amber-100/80 transition-colors cursor-pointer"
            >
              {latexText}
            </button>
          )}
        </div>
      );
    }
    return (
      <div
        style={{
          marginTop: `${spaceBeforePt * scale}px`,
          paddingLeft: eqAlign === 'center' || indentLeftPt <= 0 ? undefined : `${indentLeftPt * scale}px`,
          paddingRight: eqAlign === 'center' || indentRightPt <= 0 ? undefined : `${indentRightPt * scale}px`,
          fontSize: `${baseFontPt * scale}px`,
        }}
        className={`flex ${flexJustify}`}
      >
        {disableEquationInspect ? (
          <span className="px-2 py-1 rounded-md">
            <MathRenderer latex={blk.latex} displayMode={true} />
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onSelectEquation?.(blk.latex ?? '', true)}
            title="Nhấn để xem mã LaTeX và XML OMML"
            className="px-2 py-1 rounded-md hover:bg-blue-50 hover:ring-1 hover:ring-blue-300 transition-colors cursor-pointer"
          >
            <MathRenderer latex={blk.latex} displayMode={true} />
          </button>
        )}
      </div>
    );
  }

  if (blk.block_type === 'table' && blk.table_rows && blk.table_rows.length > 0) {
    const isBorderless = Boolean(blk.table_borderless);
    const maxCols = Math.max(
      ...blk.table_rows.map((r) => r.reduce((acc, c) => acc + Math.max(1, c.col_span ?? 1), 0)),
      1
    );
    const rowWithWidths = blk.table_rows.find(
      (r) =>
        r.length === maxCols &&
        r.every((c) => typeof c.width_pct === 'number' && (c.width_pct ?? 0) > 0 && !(c.col_span && c.col_span > 1))
    );
    const colPcts = rowWithWidths
      ? (() => {
          const sum = rowWithWidths.reduce((s, c) => s + (c.width_pct ?? 0), 0);
          return rowWithWidths.map((c) => ((c.width_pct ?? 0) / Math.max(1, sum)) * 100);
        })()
      : null;

    return (
      <div
        style={{
          marginTop: `${spaceBeforePt * scale}px`,
          paddingLeft: indentLeftPt > 0 ? `${indentLeftPt * scale}px` : undefined,
          paddingRight: indentRightPt > 0 ? `${indentRightPt * scale}px` : undefined,
        }}
        className="overflow-x-auto"
      >
        <table
          className={`w-full border-collapse ${
            isBorderless ? '' : 'border border-slate-400'
          }`}
          style={{ tableLayout: colPcts ? 'fixed' : 'auto' }}
        >
          {colPcts && (
            <colgroup>
              {colPcts.map((pct, cIdx) => (
                <col key={cIdx} style={{ width: `${pct}%` }} />
              ))}
            </colgroup>
          )}
          <tbody>
            {blk.table_rows.map((row, rIdx) => (
              <tr key={rIdx}>
                {row.map((cell, cIdx) => {
                  const isHeader = Boolean(cell.is_header) && !isBorderless;
                  const cellAlign = cell.alignment ?? (isHeader ? 'center' : 'left');
                  const cellAlignClass = ALIGN_CLASS_MAP[cellAlign] ?? 'text-left';
                  return (
                    <td
                      key={cIdx}
                      colSpan={cell.col_span && cell.col_span > 1 ? cell.col_span : undefined}
                      className={`${
                        isBorderless
                          ? 'px-1 py-0.5 align-top'
                          : `border border-slate-300 px-2.5 py-1.5 ${
                              isHeader ? 'bg-slate-100' : ''
                            }`
                      } ${cellAlignClass}`}
                    >
                      <RenderSegments
                        segments={cell.segments}
                        defaultBold={false}
                        baseFontPt={isBorderless ? baseFontPt : Math.min(baseFontPt, 11)}
                        scale={scale}
                        mathFormat={mathFormat}
                        disableEquationInspect={disableEquationInspect}
                        onSelectEquation={onSelectEquation}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (blk.block_type === 'figure' && blk.croppedImageDataUrl) {
    const figAlign = blk.alignment ?? 'center';
    const itemsAlign =
      figAlign === 'left'
        ? 'items-start'
        : figAlign === 'right'
        ? 'items-end'
        : 'items-center';
    const box = isValidBox(blk.box_2d) ? blk.box_2d : null;
    const widthPct = box
      ? Math.max(15, Math.min(96, ((box[3] - box[1]) / 1000) * (geom.pageWidthPt / geom.contentWidthPt) * 100))
      : blk.croppedWidthPx
      ? Math.max(24, Math.min(92, (blk.croppedWidthPx / 620) * 100))
      : 60;

    return (
      <figure
        style={{
          marginTop: `${spaceBeforePt * scale}px`,
          paddingLeft: figAlign === 'center' || indentLeftPt <= 0 ? undefined : `${indentLeftPt * scale}px`,
          paddingRight: figAlign === 'center' || indentRightPt <= 0 ? undefined : `${indentRightPt * scale}px`,
        }}
        className={`flex flex-col ${itemsAlign}`}
      >
        <img
          src={blk.croppedImageDataUrl}
          alt={blk.caption || `Hình minh họa trang ${pageNumber}`}
          referrerPolicy="no-referrer"
          style={{ width: `${widthPct}%` }}
          className="max-w-full object-contain bg-white"
        />
        {blk.caption && (
          <figcaption
            style={{ fontSize: `${11 * scale}px` }}
            className="mt-1.5 italic text-slate-700 text-center"
          >
            {blk.caption}
          </figcaption>
        )}
      </figure>
    );
  }

  return null;
}

export function DocumentPreview({
  pages,
  choiceLayout = 'table',
  mathFormat = 'omml',
  onSelectEquation,
  editable = false,
  isEditMode = false,
  onToggleEditMode,
  hasEdits = false,
  onResetEdits,
  onSyncWord,
  isSyncingWord = false,
  hasWordOutput = false,
  onUpdateBlock,
  onDeleteBlock,
  onInsertBlock,
  onMoveBlock,
}: DocumentPreviewProps) {
  const [editingTarget, setEditingTarget] = useState<{
    pageNumber: number;
    blockIndex: number;
  } | null>(null);

  useEffect(() => {
    if (!editingTarget) return;
    const pg = pages.find((p) => p.pageNumber === editingTarget.pageNumber);
    if (!pg || editingTarget.blockIndex < 0 || editingTarget.blockIndex >= pg.blocks.length) {
      setEditingTarget(null);
    }
  }, [pages, editingTarget]);

  if (pages.length === 0) {
    return null;
  }

  const maxPreviewWidthPx = pages.some(
    (p) => (p.pageWidthPx ?? 1240) > (p.pageHeightPx ?? 1754)
  )
    ? 880
    : 780;

  return (
    <div className="space-y-4">
      {editable && (
        <div
          style={{ maxWidth: `${maxPreviewWidthPx}px` }}
          className="mx-auto bg-white border border-slate-200 rounded-lg px-4 py-2.5 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => {
                if (isEditMode) setEditingTarget(null);
                onToggleEditMode?.();
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isEditMode
                  ? 'bg-blue-700 text-white border-blue-700 hover:bg-blue-800'
                  : 'bg-white text-slate-800 border-slate-300 hover:border-blue-500 hover:text-blue-700'
              }`}
            >
              {isEditMode ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Xong chỉnh sửa
                </>
              ) : (
                <>
                  <Pencil className="w-3.5 h-3.5" />
                  Chỉnh sửa nội dung
                </>
              )}
            </button>
            <span className="text-xs text-slate-500">
              {isEditMode
                ? 'Nhấp vào đoạn văn, công thức hoặc bảng để sửa trực tiếp ($...$ cho công thức)'
                : 'Nhấp đúp vào nội dung bất kỳ hoặc bật chỉnh sửa trước khi xuất Word'}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {hasEdits && onResetEdits && (
              <button
                type="button"
                onClick={() => {
                  setEditingTarget(null);
                  onResetEdits();
                }}
                disabled={isSyncingWord}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Khôi phục gốc
              </button>
            )}

            {onSyncWord && (hasEdits || !hasWordOutput) && (
              <button
                type="button"
                onClick={onSyncWord}
                disabled={isSyncingWord}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isSyncingWord ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Đang cập nhật Word...
                  </>
                ) : (
                  <>
                    <FileDown className="w-3.5 h-3.5" />
                    {hasWordOutput ? 'Cập nhật file Word' : 'Xuất ra file Word'}
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="space-y-6">
        {pages.map((page) => {
          const geom = computePageGeometry(page);
          const sourceIndexMap = new WeakMap<DocumentBlock, number>();
          const transformedBlocks: DocumentBlock[] = [];

          page.blocks.forEach((rawBlk, srcIdx) => {
            const expanded = transformBlocksForChoiceLayout([rawBlk], choiceLayout, geom);
            expanded.forEach((tb) => {
              sourceIndexMap.set(tb, srcIdx);
              transformedBlocks.push(tb);
            });
          });

          const bands = groupBlocksIntoVisualBands(transformedBlocks, geom);
          const previewWidthPx = geom.isLandscape ? 880 : 780;
          const scale = previewWidthPx / geom.pageWidthPt;
          const renderedEditorsForPage = new Set<number>();

          const renderEditableBlockSlot = (
            blk: DocumentBlock,
            options: {
              spaceBeforePt: number;
              indentLeftPt: number;
              indentRightPt: number;
              firstLineIndentPt: number;
            }
          ) => {
            const srcIdx = sourceIndexMap.get(blk);
            const isValidSrc = typeof srcIdx === 'number' && srcIdx >= 0 && srcIdx < page.blocks.length;
            const isEditingThis =
              editable &&
              isValidSrc &&
              editingTarget?.pageNumber === page.pageNumber &&
              editingTarget?.blockIndex === srcIdx;

            if (isEditingThis && isValidSrc) {
              if (renderedEditorsForPage.has(srcIdx)) {
                return null;
              }
              renderedEditorsForPage.add(srcIdx);
              const sourceBlock = page.blocks[srcIdx];
              return (
                <InlineBlockEditor
                  block={sourceBlock}
                  mathFormat={mathFormat}
                  onSave={(nextBlk) => {
                    onUpdateBlock?.(page.pageNumber, srcIdx, nextBlk);
                    setEditingTarget(null);
                  }}
                  onCancel={() => setEditingTarget(null)}
                  onDelete={
                    onDeleteBlock
                      ? () => {
                          onDeleteBlock(page.pageNumber, srcIdx);
                          setEditingTarget(null);
                        }
                      : undefined
                  }
                />
              );
            }

            const content = (
              <RenderSingleBlock
                blk={blk}
                pageNumber={page.pageNumber}
                geom={geom}
                scale={scale}
                spaceBeforePt={options.spaceBeforePt}
                indentLeftPt={options.indentLeftPt}
                indentRightPt={options.indentRightPt}
                firstLineIndentPt={options.firstLineIndentPt}
                mathFormat={mathFormat}
                disableEquationInspect={isEditMode}
                onSelectEquation={onSelectEquation}
              />
            );

            if (!editable || !isValidSrc) {
              return content;
            }

            const totalSrcBlocks = page.blocks.length;

            return (
              <div
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingTarget({ pageNumber: page.pageNumber, blockIndex: srcIdx });
                }}
                onClick={
                  isEditMode
                    ? (e) => {
                        e.stopPropagation();
                        setEditingTarget({ pageNumber: page.pageNumber, blockIndex: srcIdx });
                      }
                    : undefined
                }
                className={`group/blk relative rounded transition-colors ${
                  isEditMode
                    ? 'hover:outline-1 hover:outline-dashed hover:outline-blue-500 hover:bg-blue-50/25 cursor-pointer'
                    : 'hover:ring-1 hover:ring-blue-300/60'
                }`}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="hidden group-hover/blk:flex items-center gap-0.5 absolute -top-3.5 right-1 z-10 bg-white border border-slate-200 shadow-xs rounded px-1 py-0.5 font-sans text-[11px]"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setEditingTarget({ pageNumber: page.pageNumber, blockIndex: srcIdx })
                    }
                    title="Chỉnh sửa khối này"
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 text-blue-700 hover:bg-blue-50 rounded font-medium cursor-pointer"
                  >
                    <Pencil className="w-3 h-3" />
                    Sửa
                  </button>
                  {isEditMode && onMoveBlock && (
                    <>
                      <button
                        type="button"
                        disabled={srcIdx === 0}
                        onClick={() => onMoveBlock(page.pageNumber, srcIdx, -1)}
                        title="Di chuyển lên"
                        className="p-0.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        disabled={srcIdx >= totalSrcBlocks - 1}
                        onClick={() => onMoveBlock(page.pageNumber, srcIdx, 1)}
                        title="Di chuyển xuống"
                        className="p-0.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                    </>
                  )}
                  {isEditMode && onInsertBlock && (
                    <button
                      type="button"
                      onClick={() => {
                        onInsertBlock(page.pageNumber, srcIdx, 'paragraph');
                        setEditingTarget({
                          pageNumber: page.pageNumber,
                          blockIndex: srcIdx + 1,
                        });
                      }}
                      title="Chèn đoạn văn mới bên dưới"
                      className="inline-flex items-center gap-0.5 px-1 py-0.5 text-slate-700 hover:bg-slate-100 rounded cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      Đoạn
                    </button>
                  )}
                  {onDeleteBlock && (
                    <button
                      type="button"
                      onClick={() => onDeleteBlock(page.pageNumber, srcIdx)}
                      title="Xóa khối này"
                      className="p-0.5 text-red-600 hover:bg-red-50 rounded cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {content}
              </div>
            );
          };

          return (
            <article
              key={page.pageNumber}
              style={{
                maxWidth: `${previewWidthPx}px`,
                paddingTop: `${geom.marginTopPt * scale * 0.65}px`,
                paddingRight: `${geom.marginRightPt * scale}px`,
                paddingBottom: `${geom.marginBottomPt * scale}px`,
                paddingLeft: `${geom.marginLeftPt * scale}px`,
              }}
              className="bg-white border border-slate-200 rounded-lg shadow-xs mx-auto doc-serif text-slate-900"
            >
              <div className="flex items-center justify-between pb-2.5 mb-4 border-b border-slate-100 font-sans text-xs text-slate-400">
                <span>Trang {page.pageNumber}</span>
                <span className="tabular-nums">{page.blocks.length} khối nội dung</span>
              </div>

              <div>
                {bands.map((band, idx) => {
                  if (band.kind === 'single') {
                    return (
                      <div key={idx}>
                        {renderEditableBlockSlot(band.block, {
                          spaceBeforePt: band.spaceBeforePt,
                          indentLeftPt: band.indentLeftPt,
                          indentRightPt: band.indentRightPt,
                          firstLineIndentPt: band.firstLineIndentPt,
                        })}
                      </div>
                    );
                  }

                  return (
                    <div
                      key={idx}
                      style={{
                        marginTop: `${band.spaceBeforePt * scale}px`,
                        paddingLeft: band.indentLeftPt > 0 ? `${band.indentLeftPt * scale}px` : undefined,
                        paddingRight: band.indentRightPt > 0 ? `${band.indentRightPt * scale}px` : undefined,
                        display: 'grid',
                        gridTemplateColumns: `${band.leftWidthPct}% ${band.rightWidthPct}%`,
                        gap: '12px',
                        alignItems: 'start',
                      }}
                    >
                      <div>
                        {renderEditableBlockSlot(band.left, {
                          spaceBeforePt: 0,
                          indentLeftPt: 0,
                          indentRightPt: 0,
                          firstLineIndentPt: 0,
                        })}
                      </div>
                      <div>
                        {renderEditableBlockSlot(band.right, {
                          spaceBeforePt: 0,
                          indentLeftPt: 0,
                          indentRightPt: 0,
                          firstLineIndentPt: 0,
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {editable && isEditMode && onInsertBlock && (
                <div className="mt-5 pt-3 border-t border-dashed border-slate-200 flex flex-wrap items-center gap-2 font-sans text-xs">
                  <span className="text-slate-400 mr-1">Thêm vào trang {page.pageNumber}:</span>
                  <button
                    type="button"
                    onClick={() => {
                      const insertAfter = page.blocks.length - 1;
                      onInsertBlock(page.pageNumber, insertAfter, 'paragraph');
                      setEditingTarget({
                        pageNumber: page.pageNumber,
                        blockIndex: page.blocks.length,
                      });
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded transition-colors cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    Đoạn văn
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const insertAfter = page.blocks.length - 1;
                      onInsertBlock(page.pageNumber, insertAfter, 'heading');
                      setEditingTarget({
                        pageNumber: page.pageNumber,
                        blockIndex: page.blocks.length,
                      });
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded transition-colors cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    Tiêu đề
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const insertAfter = page.blocks.length - 1;
                      onInsertBlock(page.pageNumber, insertAfter, 'equation');
                      setEditingTarget({
                        pageNumber: page.pageNumber,
                        blockIndex: page.blocks.length,
                      });
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded transition-colors cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    Công thức độc lập
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
