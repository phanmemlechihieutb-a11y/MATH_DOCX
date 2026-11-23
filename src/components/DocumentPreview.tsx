import { useEffect, useRef, useState, type CSSProperties } from 'react';
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
  Underline,
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
  computeSafeTableColPcts,
  groupBlocksIntoVisualBands,
  groupSegmentsByTabs,
  isChoiceTableBlock,
  isValidBox,
  normalizeBoxHexColor,
  normalizeHexColor,
  normalizeTableBlockGrid,
  transformBlocksForChoiceLayout,
  type PageGeometry,
} from '../utils/layoutMetrics';
import {
  TEXT_COLOR_SWATCHES,
  applyColorInEditableText,
  editableStringToSegments,
  getUniformBlockColor,
  isUniformBlockStyle,
  segmentsToEditableString,
  toggleInlineStyleInEditableText,
} from '../utils/previewEditor';
import { MathRenderer } from './MathRenderer';

interface DocumentPreviewProps {
  pages: PageExtraction[];
  choiceLayout?: ChoiceLayoutMode;
  mathFormat?: MathOutputFormat;
  underlineCorrectChoice?: boolean;
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
  onCtrlDoubleClickBlock?: (info: {
    pageNumber: number;
    blockIndex: number;
    block: DocumentBlock;
    clickedText: string;
    clickedMathLatex?: string;
    blockRenderedText: string;
  }) => void;
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

function getBlockFontSizePt(blk: DocumentBlock, pageBaseFontPt = 12): number {
  if (typeof blk.font_size_pt === 'number' && Number.isFinite(blk.font_size_pt)) {
    return Math.max(7, Math.min(48, blk.font_size_pt));
  }
  const base = Number.isFinite(pageBaseFontPt) ? Math.max(8, Math.min(20, pageBaseFontPt)) : 12;
  if (blk.block_type === 'heading') {
    const delta = base - 12;
    return blk.heading_level === 1 ? 15 + delta : blk.heading_level === 3 ? 12 + delta : 13 + delta;
  }
  if (blk.block_type === 'table') return base;
  return base;
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
          typeof seg.tab_width_pt === 'number' && seg.tab_width_pt > 0 ? (
            <span
              className="inline-block"
              style={{ width: `${seg.tab_width_pt * scale}px` }}
              aria-hidden="true"
            />
          ) : (
            <span className="inline-block w-8" aria-hidden="true" />
          )
        ) : null;

        if (seg.type === 'math') {
          const mathStyleClass = [
            isBold ? 'katex-bold-override font-bold' : '',
            seg.italic ? 'italic' : '',
            seg.underline ? 'underline' : '',
          ]
            .filter(Boolean)
            .join(' ');

          if (mathFormat === 'latex') {
            const latexText = '${' + cleanLatexDelimiters(seg.content) + '}$';
            const latexTextStyleClass = [
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
                    data-math-latex={seg.content}
                    style={{
                      fontSize: `${segFontPt * scale * 0.92}px`,
                      color: hex ? `#${hex}` : '#000000',
                    }}
                    className={`inline font-mono px-1 mx-0.5 rounded bg-amber-50 border border-amber-200/80 ${latexTextStyleClass}`}
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
                  data-math-latex={seg.content}
                  onClick={(e) => {
                    if (e.ctrlKey || e.metaKey) return;
                    onSelectEquation?.(seg.content, false);
                  }}
                  title="Công thức Toggle TeX bọc ${...}$ — nhấn để xem chi tiết"
                  style={{
                    fontSize: `${segFontPt * scale * 0.92}px`,
                    color: hex ? `#${hex}` : '#000000',
                  }}
                  className={`inline font-mono px-1 mx-0.5 rounded bg-amber-50 border border-amber-200/80 hover:bg-amber-100/80 transition-colors cursor-pointer ${latexTextStyleClass}`}
                >
                  {latexText}
                </button>
              </span>
            );
          }

          if (disableEquationInspect) {
            return (
              <span key={idx}>
                {tabPrefix}
                <span
                  data-math-latex={seg.content}
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
                data-math-latex={seg.content}
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey) return;
                  onSelectEquation?.(seg.content, false);
                }}
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

        const innerLines = lines.map((line, lIdx) => (
          <span key={lIdx} className="whitespace-pre-wrap">
            {line}
            {lIdx < lines.length - 1 && <br />}
          </span>
        ));

        return (
          <span key={idx}>
            {tabPrefix}
            <span className={textClass} style={segStyle}>
              {seg.vert_align === 'subscript' ? (
                <sub className="text-[0.72em] leading-none">{innerLines}</sub>
              ) : seg.vert_align === 'superscript' ? (
                <sup className="text-[0.72em] leading-none">{innerLines}</sup>
              ) : (
                innerLines
              )}
            </span>
          </span>
        );
      })}
    </>
  );
}

interface BlockPositionDraft {
  spaceBeforePt: number;
  indentLeftPt: number;
  indentRightPt: number;
  firstLineIndentPt: number;
}

function InlineBlockEditor({
  block,
  mathFormat,
  initialPosition,
  onSave,
  onCancel,
  onDelete,
}: {
  block: DocumentBlock;
  mathFormat: MathOutputFormat;
  initialPosition: BlockPositionDraft;
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
  const [fontSizeDirty, setFontSizeDirty] = useState<boolean>(false);

  // Position & indentation state (in pt)
  const [spaceBeforePt, setSpaceBeforePt] = useState<number>(
    Math.round(initialPosition.spaceBeforePt * 10) / 10
  );
  const [indentLeftPt, setIndentLeftPt] = useState<number>(
    Math.round(initialPosition.indentLeftPt * 10) / 10
  );
  const [indentRightPt, setIndentRightPt] = useState<number>(
    Math.round(initialPosition.indentRightPt * 10) / 10
  );
  const [firstLineIndentPt, setFirstLineIndentPt] = useState<number>(
    Math.round(initialPosition.firstLineIndentPt * 10) / 10
  );
  const [positionDirty, setPositionDirty] = useState<boolean>(false);

  const [draftText, setDraftText] = useState<string>(() =>
    segmentsToEditableString(block.segments)
  );
  const [draftTabCols, setDraftTabCols] = useState<string[]>(initialTabColumns);
  const [activeTabColIdx, setActiveTabColIdx] = useState<number>(0);

  const mainTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const tabTextareaRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const cellTextareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  // Equation-specific state
  const [draftLatex, setDraftLatex] = useState<string>(() =>
    cleanLatexDelimiters(block.latex ?? '')
  );
  const [eqBold, setEqBold] = useState<boolean>(Boolean(block.bold));
  const [eqItalic, setEqItalic] = useState<boolean>(Boolean(block.italic));
  const [eqColor, setEqColor] = useState<string | null>(() => {
    const h = normalizeHexColor(block.color);
    return h && h !== '000000' ? h : null;
  });

  // Table-specific state
  const [draftRows, setDraftRows] = useState<string[][]>(() =>
    (block.table_rows ?? []).map((row) =>
      row.map((cell) => segmentsToEditableString(cell.segments))
    )
  );
  const [draftCellAligns, setDraftCellAligns] = useState<(BlockAlignment | undefined)[][]>(() =>
    (block.table_rows ?? []).map((row) => row.map((cell) => cell.alignment ?? undefined))
  );
  const [activeCell, setActiveCell] = useState<{ r: number; c: number } | null>(
    block.block_type === 'table' ? { r: 0, c: 0 } : null
  );

  // Figure-specific state
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

  const buildPositionPatch = (includeFirstLine: boolean): Partial<DocumentBlock> => {
    if (!positionDirty) return {};
    return {
      space_before_pt: Math.max(0, Math.min(200, Number.isFinite(spaceBeforePt) ? spaceBeforePt : 0)),
      indent_left_pt: Math.max(0, Math.min(300, Number.isFinite(indentLeftPt) ? indentLeftPt : 0)),
      indent_right_pt: Math.max(0, Math.min(300, Number.isFinite(indentRightPt) ? indentRightPt : 0)),
      ...(includeFirstLine
        ? {
            first_line_indent_pt: Math.max(
              -120,
              Math.min(180, Number.isFinite(firstLineIndentPt) ? firstLineIndentPt : 0)
            ),
          }
        : {}),
    };
  };

  const buildPreviewParagraphSegments = (): InlineSegment[] => {
    const styleOverride = fontSizeDirty ? { font_size_pt: fontSizePt } : undefined;

    if (isTabbedParagraph && draftTabCols.length > 0) {
      const origGroups = groupSegmentsByTabs(block.segments ?? []);
      const combined: InlineSegment[] = [];
      draftTabCols.forEach((colText, idx) => {
        const origFirst = origGroups[idx]?.[0];
        const parsed = editableStringToSegments(
          colText,
          origGroups[idx] ?? block.segments,
          styleOverride
        );
        const tabMeta: Partial<InlineSegment> =
          idx > 0
            ? {
                tab_before: true,
                ...(typeof origFirst?.tab_width_pt === 'number'
                  ? { tab_width_pt: origFirst.tab_width_pt }
                  : {}),
                ...(origFirst?.tab_leader ? { tab_leader: origFirst.tab_leader } : {}),
              }
            : {};

        if (parsed.length > 0) {
          if (idx > 0) {
            parsed[0] = { ...parsed[0], ...tabMeta };
          }
          combined.push(...parsed);
        } else if (idx > 0) {
          combined.push({ type: 'text', content: '', ...tabMeta });
        }
      });
      return combined;
    }

    return editableStringToSegments(draftText, block.segments, styleOverride);
  };

  const applyParagraphInlineAction = (
    transform: (
      text: string,
      start: number,
      end: number
    ) => { text: string; start: number; end: number }
  ) => {
    if (isTabbedParagraph && draftTabCols.length > 0) {
      const idx = Math.max(0, Math.min(draftTabCols.length - 1, activeTabColIdx));
      const el = tabTextareaRefs.current[idx];
      const current = draftTabCols[idx] ?? '';
      const selStart = el ? el.selectionStart : 0;
      const selEnd = el ? el.selectionEnd : 0;
      const res = transform(current, selStart, selEnd);
      setDraftTabCols((prev) => prev.map((v, i) => (i === idx ? res.text : v)));
      requestAnimationFrame(() => {
        const target = tabTextareaRefs.current[idx];
        if (target) {
          target.focus();
          target.setSelectionRange(res.start, res.end);
        }
      });
      return;
    }

    const el = mainTextareaRef.current;
    const selStart = el ? el.selectionStart : 0;
    const selEnd = el ? el.selectionEnd : 0;
    const res = transform(draftText, selStart, selEnd);
    setDraftText(res.text);
    requestAnimationFrame(() => {
      const target = mainTextareaRef.current;
      if (target) {
        target.focus();
        target.setSelectionRange(res.start, res.end);
      }
    });
  };

  const applyActiveCellInlineAction = (
    transform: (
      text: string,
      start: number,
      end: number
    ) => { text: string; start: number; end: number }
  ) => {
    if (!activeCell) return;
    const { r, c } = activeCell;
    const current = draftRows[r]?.[c] ?? '';
    const key = `${r}-${c}`;
    const el = cellTextareaRefs.current[key];
    const selStart = el ? el.selectionStart : 0;
    const selEnd = el ? el.selectionEnd : 0;
    const res = transform(current, selStart, selEnd);
    setDraftRows((prev) =>
      prev.map((row, ri) =>
        ri !== r ? row : row.map((val, ci) => (ci !== c ? val : res.text))
      )
    );
    requestAnimationFrame(() => {
      const target = cellTextareaRefs.current[key];
      if (target) {
        target.focus();
        target.setSelectionRange(res.start, res.end);
      }
    });
  };

  const handleSaveParagraphOrHeading = () => {
    const nextSegments = buildPreviewParagraphSegments();
    const cleanedSegments =
      nextSegments.length > 0
        ? nextSegments
        : [{ type: 'text' as const, content: '' }];
    const posPatch = buildPositionPatch(true);

    if (blockType === 'heading') {
      onSave({
        ...block,
        ...posPatch,
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
      ...posPatch,
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
    const posPatch = buildPositionPatch(false);
    onSave({
      ...block,
      ...posPatch,
      block_type: 'equation',
      alignment: alignment === 'justify' ? 'center' : alignment,
      latex: cleaned,
      font_size_pt: fontSizePt,
      bold: eqBold,
      italic: eqItalic,
      color: eqColor ?? undefined,
    });
  };

  const handleSaveTable = () => {
    const origRows = block.table_rows ?? [];
    const nextRows: TableCellData[][] = draftRows.map((row, rIdx) =>
      row.map((cellText, cIdx) => {
        const templateCell = origRows[rIdx]?.[cIdx] ?? origRows[0]?.[cIdx];
        const nextAlign = draftCellAligns[rIdx]?.[cIdx] ?? templateCell?.alignment;
        return {
          ...(templateCell ?? {}),
          ...(nextAlign ? { alignment: nextAlign } : {}),
          segments: editableStringToSegments(cellText, templateCell?.segments),
        };
      })
    );
    const posPatch = buildPositionPatch(false);
    onSave({
      ...block,
      ...posPatch,
      alignment: alignment === 'justify' ? 'left' : alignment,
      table_rows: nextRows,
    });
  };

  const handleSaveFigure = () => {
    const posPatch = buildPositionPatch(false);
    onSave({
      ...block,
      ...posPatch,
      alignment: alignment === 'justify' ? 'center' : alignment,
      caption: draftCaption.trim() ? draftCaption.trim() : null,
    });
  };

  const alignBtn = (
    val: BlockAlignment,
    label: string,
    Icon: typeof AlignLeft,
    currentVal: BlockAlignment = alignment,
    onChangeVal: (v: BlockAlignment) => void = setAlignment
  ) => (
    <button
      key={val}
      type="button"
      onClick={() => onChangeVal(val)}
      title={label}
      className={`p-1.5 rounded border text-xs transition-colors cursor-pointer ${
        currentVal === val
          ? 'bg-blue-700 text-white border-blue-700'
          : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );

  const renderColorPickerBar = (
    activeHex: string | null,
    onPickHex: (hex: string | null) => void,
    tooltipPrefix = 'Màu chữ'
  ) => {
    const currentInputHex = `#${activeHex ?? '000000'}`;
    return (
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[11px] font-medium text-slate-500 mr-0.5">{tooltipPrefix}:</span>
        {TEXT_COLOR_SWATCHES.map((sw) => {
          const isSelected =
            (sw.hex === '000000' && !activeHex) || activeHex === sw.hex;
          return (
            <button
              key={sw.hex}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPickHex(sw.hex === '000000' ? null : sw.hex)}
              title={`${sw.label} (#${sw.hex})`}
              style={{ backgroundColor: `#${sw.hex}` }}
              className={`w-4 h-4 rounded-sm border transition-transform cursor-pointer ${
                isSelected
                  ? 'ring-2 ring-blue-600 ring-offset-1 border-white scale-110'
                  : 'border-slate-300 hover:scale-110'
              }`}
            />
          );
        })}
        <label
          title="Chọn màu tùy chỉnh"
          className="inline-flex items-center gap-1 ml-0.5 px-1.5 h-5 text-[11px] text-slate-600 bg-white border border-slate-300 rounded cursor-pointer hover:border-slate-400"
        >
          <input
            type="color"
            value={currentInputHex}
            onChange={(e) => {
              const raw = e.target.value.replace(/^#/, '').toUpperCase();
              onPickHex(raw === '000000' ? null : raw);
            }}
            className="w-3.5 h-3.5 border-0 p-0 bg-transparent cursor-pointer"
          />
          <span>Khác</span>
        </label>
      </div>
    );
  };

  const renderPositionControls = (includeFirstLine: boolean) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1 border-t border-slate-200/80 text-[11px] text-slate-600">
      <span className="font-semibold text-slate-700">Vị trí (pt):</span>
      <label className="inline-flex items-center gap-1">
        <span>Thụt trái</span>
        <input
          type="number"
          min={0}
          max={300}
          step={2}
          value={indentLeftPt}
          onChange={(e) => {
            setIndentLeftPt(Number(e.target.value) || 0);
            setPositionDirty(true);
          }}
          className="w-14 h-6 px-1.5 text-xs tabular-nums text-slate-900 bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-600"
        />
      </label>
      {includeFirstLine && (
        <label className="inline-flex items-center gap-1">
          <span>Đầu dòng</span>
          <input
            type="number"
            min={-120}
            max={180}
            step={2}
            value={firstLineIndentPt}
            onChange={(e) => {
              setFirstLineIndentPt(Number(e.target.value) || 0);
              setPositionDirty(true);
            }}
            className="w-14 h-6 px-1.5 text-xs tabular-nums text-slate-900 bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-600"
          />
        </label>
      )}
      <label className="inline-flex items-center gap-1">
        <span>Thụt phải</span>
        <input
          type="number"
          min={0}
          max={300}
          step={2}
          value={indentRightPt}
          onChange={(e) => {
            setIndentRightPt(Number(e.target.value) || 0);
            setPositionDirty(true);
          }}
          className="w-14 h-6 px-1.5 text-xs tabular-nums text-slate-900 bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-600"
        />
      </label>
      <label className="inline-flex items-center gap-1">
        <span>Cách trên</span>
        <input
          type="number"
          min={0}
          max={200}
          step={2}
          value={spaceBeforePt}
          onChange={(e) => {
            setSpaceBeforePt(Number(e.target.value) || 0);
            setPositionDirty(true);
          }}
          className="w-14 h-6 px-1.5 text-xs tabular-nums text-slate-900 bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-600"
        />
      </label>
    </div>
  );

  if (block.block_type === 'equation') {
    const cleanedPreview = cleanLatexDelimiters(draftLatex);
    const eqFlex = JUSTIFY_FLEX_MAP[alignment === 'justify' ? 'center' : alignment] ?? 'justify-center';
    return (
      <div
        className="my-2 p-3.5 bg-slate-50 border border-blue-500 rounded-lg shadow-xs font-sans space-y-2.5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-800 mr-1">
              Công thức độc lập
            </span>
            <select
              value={Math.round(fontSizePt)}
              onChange={(e) => setFontSizePt(Number(e.target.value))}
              title="Cỡ chữ công thức"
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
              onClick={() => setEqBold((v) => !v)}
              title="In đậm công thức"
              className={`p-1.5 rounded border transition-colors cursor-pointer ${
                eqBold
                  ? 'bg-blue-700 text-white border-blue-700'
                  : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'
              }`}
            >
              <Bold className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setEqItalic((v) => !v)}
              title="In nghiêng công thức"
              className={`p-1.5 rounded border transition-colors cursor-pointer ${
                eqItalic
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
          </div>
        </div>

        {renderColorPickerBar(eqColor, setEqColor, 'Màu công thức')}
        {renderPositionControls(false)}

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

        <div
          style={{
            color: eqColor ? `#${eqColor}` : undefined,
            paddingLeft: alignment === 'center' || indentLeftPt <= 0 ? undefined : `${indentLeftPt}px`,
            paddingRight: alignment === 'center' || indentRightPt <= 0 ? undefined : `${indentRightPt}px`,
          }}
          className={`p-3 bg-white border border-slate-200 rounded-md flex ${eqFlex} overflow-x-auto min-h-[44px] ${
            eqBold ? 'katex-bold-override font-bold' : ''
          } ${eqItalic ? 'italic' : ''}`}
        >
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
    const hasNestedContainerBlocks = (block.table_rows ?? []).some((row) =>
      row.some((cell) => Array.isArray(cell.blocks) && cell.blocks.length > 0)
    );
    if (hasNestedContainerBlocks) {
      return (
        <div
          className="my-2 p-3.5 bg-slate-50 border border-blue-500 rounded-lg shadow-xs font-sans space-y-3"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-xs font-semibold text-slate-800">
            Khối bố cục nhiều cột / hộp khung (tcolorbox, minipage, multicols, immini)
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Khối này chứa nhiều đoạn văn, công thức hoặc hình vẽ lồng nhau. Hãy chỉnh sửa trực tiếp ở khung mã LaTeX bên trái để bảo toàn 100% cấu trúc bố cục.
          </p>
          <div className="flex items-center justify-end gap-2 pt-1">
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 rounded-md transition-colors cursor-pointer mr-auto"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Xóa khối
              </button>
            )}
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
            >
              Đóng
            </button>
          </div>
        </div>
      );
    }

    const isChoice = isChoiceTableBlock(block);
    const activeCellText =
      activeCell && draftRows[activeCell.r]?.[activeCell.c] !== undefined
        ? draftRows[activeCell.r][activeCell.c]
        : '';
    const activeOrigSegs =
      activeCell && block.table_rows?.[activeCell.r]?.[activeCell.c]?.segments
        ? block.table_rows[activeCell.r][activeCell.c].segments
        : undefined;
    const activeCellSegs = editableStringToSegments(activeCellText, activeOrigSegs);
    const activeCellBold = isUniformBlockStyle(activeCellSegs, 'bold');
    const activeCellItalic = isUniformBlockStyle(activeCellSegs, 'italic');
    const activeCellUnderline = isUniformBlockStyle(activeCellSegs, 'underline');
    const activeCellColor = getUniformBlockColor(activeCellSegs);
    const activeCellAlign: BlockAlignment =
      (activeCell && draftCellAligns[activeCell.r]?.[activeCell.c]) || 'left';

    const setActiveCellAlign = (nextAlign: BlockAlignment) => {
      if (!activeCell) return;
      setDraftCellAligns((prev) =>
        prev.map((row, ri) =>
          ri !== activeCell.r
            ? row
            : row.map((a, ci) => (ci !== activeCell.c ? a : nextAlign))
        )
      );
    };

    return (
      <div
        className="my-2 p-3.5 bg-slate-50 border border-blue-500 rounded-lg shadow-xs font-sans space-y-2.5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-800">
            {isChoice
              ? 'Chỉnh sửa các phương án trả lời'
              : 'Chỉnh sửa bảng (chọn ô để định dạng đậm/nghiêng/màu/căn lề)'}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {!isChoice && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const cols = Math.max(1, draftRows[0]?.length ?? 2);
                    setDraftRows((prev) => [...prev, Array.from({ length: cols }, () => '')]);
                    setDraftCellAligns((prev) => [
                      ...prev,
                      Array.from({ length: cols }, () => undefined),
                    ]);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 hover:border-slate-400 rounded cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3 h-3" />
                  Thêm hàng
                </button>
                {draftRows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraftRows((prev) => prev.slice(0, -1));
                      setDraftCellAligns((prev) => prev.slice(0, -1));
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 hover:border-slate-400 rounded cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Xóa hàng cuối
                  </button>
                )}
              </>
            )}
            <div className="flex items-center gap-1 pl-1 border-l border-slate-300">
              {alignBtn('left', 'Căn trái bảng', AlignLeft)}
              {alignBtn('center', 'Căn giữa bảng', AlignCenter)}
              {alignBtn('right', 'Căn phải bảng', AlignRight)}
            </div>
          </div>
        </div>

        {activeCell && (
          <div className="p-2 bg-white border border-slate-200 rounded-md space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[11px] font-semibold text-blue-700 mr-1">
                  Ô [{activeCell.r + 1}, {activeCell.c + 1}]:
                </span>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() =>
                    applyActiveCellInlineAction((t, s, e) =>
                      toggleInlineStyleInEditableText(t, s, e, 'bold')
                    )
                  }
                  title="In đậm vùng chọn hoặc cả ô"
                  className={`p-1 rounded border transition-colors cursor-pointer ${
                    activeCellBold
                      ? 'bg-blue-700 text-white border-blue-700'
                      : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'
                  }`}
                >
                  <Bold className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() =>
                    applyActiveCellInlineAction((t, s, e) =>
                      toggleInlineStyleInEditableText(t, s, e, 'italic')
                    )
                  }
                  title="In nghiêng vùng chọn hoặc cả ô"
                  className={`p-1 rounded border transition-colors cursor-pointer ${
                    activeCellItalic
                      ? 'bg-blue-700 text-white border-blue-700'
                      : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'
                  }`}
                >
                  <Italic className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() =>
                    applyActiveCellInlineAction((t, s, e) =>
                      toggleInlineStyleInEditableText(t, s, e, 'underline')
                    )
                  }
                  title="Gạch chân vùng chọn hoặc cả ô"
                  className={`p-1 rounded border transition-colors cursor-pointer ${
                    activeCellUnderline
                      ? 'bg-blue-700 text-white border-blue-700'
                      : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'
                  }`}
                >
                  <Underline className="w-3 h-3" />
                </button>
              </div>
              <div className="flex items-center gap-1">
                {alignBtn('left', 'Căn trái ô', AlignLeft, activeCellAlign, setActiveCellAlign)}
                {alignBtn('center', 'Căn giữa ô', AlignCenter, activeCellAlign, setActiveCellAlign)}
                {alignBtn('right', 'Căn phải ô', AlignRight, activeCellAlign, setActiveCellAlign)}
              </div>
            </div>
            {renderColorPickerBar(
              activeCellColor,
              (hex) =>
                applyActiveCellInlineAction((t, s, e) =>
                  applyColorInEditableText(t, s, e, hex)
                ),
              'Màu ô'
            )}
          </div>
        )}

        {renderPositionControls(false)}

        <div className="space-y-2 overflow-x-auto">
          {draftRows.map((row, rIdx) => (
            <div
              key={rIdx}
              style={{
                gridTemplateColumns: `repeat(${Math.max(1, row.length)}, minmax(120px, 1fr))`,
              }}
              className="grid gap-2"
            >
              {row.map((val, cIdx) => {
                const isActive = activeCell?.r === rIdx && activeCell?.c === cIdx;
                return (
                  <textarea
                    key={`${rIdx}-${cIdx}`}
                    ref={(el) => {
                      cellTextareaRefs.current[`${rIdx}-${cIdx}`] = el;
                    }}
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
                    className={`w-full p-2 text-xs font-mono text-slate-900 bg-white border rounded focus:outline-none focus:ring-2 focus:ring-blue-600 resize-y ${
                      isActive ? 'border-blue-500' : 'border-slate-300'
                    }`}
                  />
                );
              })}
            </div>
          ))}
        </div>

        {activeCell && (
          <div
            className={`p-2.5 bg-white border border-slate-200 rounded-md doc-serif text-slate-900 ${
              ALIGN_CLASS_MAP[activeCellAlign]
            }`}
          >
            <div className="font-sans text-[11px] font-medium text-slate-500 text-left mb-1">
              Xem trước ô [{activeCell.r + 1}, {activeCell.c + 1}]:
            </div>
            <div className="text-sm">
              <RenderSegments
                segments={activeCellSegs}
                baseFontPt={fontSizePt}
                scale={1.25}
                mathFormat={mathFormat}
                disableEquationInspect
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-[11px] text-slate-500">
            Bôi đen chữ trong ô rồi nhấn B/I/U/Màu · Ctrl + Enter để lưu
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
        className="my-2 p-3.5 bg-slate-50 border border-blue-500 rounded-lg shadow-xs font-sans space-y-2.5"
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

        {renderPositionControls(false)}

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
  const uniformBold = isUniformBlockStyle(previewSegments, 'bold');
  const uniformItalic = isUniformBlockStyle(previewSegments, 'italic');
  const uniformUnderline = isUniformBlockStyle(previewSegments, 'underline');
  const uniformColor = getUniformBlockColor(previewSegments);

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
            onChange={(e) => {
              setFontSizePt(Number(e.target.value));
              setFontSizeDirty(true);
            }}
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
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              applyParagraphInlineAction((t, s, e) =>
                toggleInlineStyleInEditableText(t, s, e, 'bold')
              )
            }
            title="In đậm vùng chọn hoặc toàn đoạn (**...**)"
            className={`p-1.5 rounded border transition-colors cursor-pointer ${
              uniformBold
                ? 'bg-blue-700 text-white border-blue-700'
                : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'
            }`}
          >
            <Bold className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              applyParagraphInlineAction((t, s, e) =>
                toggleInlineStyleInEditableText(t, s, e, 'italic')
              )
            }
            title="In nghiêng vùng chọn hoặc toàn đoạn (*...*)"
            className={`p-1.5 rounded border transition-colors cursor-pointer ${
              uniformItalic
                ? 'bg-blue-700 text-white border-blue-700'
                : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'
            }`}
          >
            <Italic className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              applyParagraphInlineAction((t, s, e) =>
                toggleInlineStyleInEditableText(t, s, e, 'underline')
              )
            }
            title="Gạch chân vùng chọn hoặc toàn đoạn (__...__)"
            className={`p-1.5 rounded border transition-colors cursor-pointer ${
              uniformUnderline
                ? 'bg-blue-700 text-white border-blue-700'
                : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'
            }`}
          >
            <Underline className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-1">
          {alignBtn('left', 'Căn trái', AlignLeft)}
          {alignBtn('center', 'Căn giữa', AlignCenter)}
          {alignBtn('right', 'Căn phải', AlignRight)}
          {alignBtn('justify', 'Căn đều hai bên', AlignJustify)}
        </div>
      </div>

      {renderColorPickerBar(
        uniformColor,
        (hex) =>
          applyParagraphInlineAction((t, s, e) =>
            applyColorInEditableText(t, s, e, hex)
          ),
        'Màu chữ'
      )}

      {renderPositionControls(true)}

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
                ref={(el) => {
                  tabTextareaRefs.current[idx] = el;
                }}
                autoFocus={idx === 0}
                rows={2}
                value={colVal}
                onFocus={() => setActiveTabColIdx(idx)}
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
          ref={mainTextareaRef}
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
          placeholder="Nhập văn bản (**đậm**, *nghiêng*, __gạch chân__, [#C00000]{màu}, $công thức$)..."
          className="w-full p-2.5 text-xs sm:text-sm font-mono text-slate-900 bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 resize-y"
        />
      )}

      <div
        className={`p-2.5 bg-white border border-slate-200 rounded-md doc-serif text-slate-900 ${ALIGN_CLASS_MAP[alignment]}`}
      >
        <div className="font-sans text-[11px] text-slate-400 text-left mb-1">
          Xem trước hiển thị:
        </div>
        <div
          style={{
            paddingLeft:
              firstLineIndentPt < 0
                ? `${indentLeftPt + Math.abs(firstLineIndentPt)}px`
                : indentLeftPt > 0
                ? `${indentLeftPt}px`
                : undefined,
            paddingRight: indentRightPt > 0 ? `${indentRightPt}px` : undefined,
            textIndent: firstLineIndentPt !== 0 ? `${firstLineIndentPt}px` : undefined,
          }}
        >
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
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <span className="text-[11px] text-slate-500">
          Bôi đen chữ rồi nhấn B / I / U / Màu · Dùng <code className="font-mono bg-white px-1 rounded border border-slate-200">$...$</code> cho công thức
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
  pageBaseFontPt = 12,
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
  pageBaseFontPt?: number;
  mathFormat?: MathOutputFormat;
  disableEquationInspect?: boolean;
  onSelectEquation?: (latex: string, isDisplay: boolean) => void;
}) {
  const alignClass = ALIGN_CLASS_MAP[blk.alignment] ?? 'text-left';
  const baseFontPt = getBlockFontSizePt(blk, pageBaseFontPt);
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
    const tabSpecs = Array.isArray(blk.tab_stop_specs) ? blk.tab_stop_specs : null;
    if (tabSpecs && tabSpecs.length > 0 && segs.some((s) => s.tab_before)) {
      const groups = groupSegmentsByTabs(segs);
      const hasContent = (grp: InlineSegment[]) =>
        grp.some((s) => s.type === 'math' || (s.content ?? '').length > 0);
      return (
        <p
          style={{
            ...wrapperStyle,
            textIndent: undefined,
            display: 'flex',
            flexWrap: 'nowrap',
            alignItems: 'baseline',
            width: '100%',
            gap: '4px',
          }}
        >
          {groups.map((grp, gIdx) => {
            const spec = gIdx > 0 ? tabSpecs[gIdx - 1] ?? tabSpecs[tabSpecs.length - 1] : null;
            const leader = spec?.leader ?? 'none';
            const leaderBorder =
              leader === 'dot'
                ? '1.5px dotted #334155'
                : leader === 'underscore'
                ? '1px solid #1E293B'
                : undefined;
            const showGroup = hasContent(grp);
            return (
              <span
                key={gIdx}
                className={gIdx > 0 ? 'contents' : 'shrink-0'}
              >
                {gIdx > 0 && (
                  <span
                    className={spec?.fixed_width_pt ? 'shrink-0' : 'min-w-[16px]'}
                    style={
                      spec?.fixed_width_pt
                        ? {
                            width: `${spec.fixed_width_pt * scale}px`,
                            borderBottom: leaderBorder,
                            height: leaderBorder ? '0.82em' : undefined,
                          }
                        : {
                            flexGrow: spec?.weight && spec.weight > 0 ? spec.weight : 1,
                            flexShrink: 1,
                            flexBasis: 0,
                            borderBottom: leaderBorder,
                            height: leaderBorder ? '0.82em' : undefined,
                          }
                    }
                    aria-hidden="true"
                  />
                )}
                {showGroup && (
                  <span className="shrink-0">
                    <RenderSegments
                      segments={grp}
                      baseFontPt={baseFontPt}
                      scale={scale}
                      mathFormat={mathFormat}
                      disableEquationInspect={disableEquationInspect}
                      onSelectEquation={onSelectEquation}
                    />
                  </span>
                )}
              </span>
            );
          })}
        </p>
      );
    }

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
    const eqHex = normalizeHexColor(blk.color);
    const eqBold = Boolean(blk.bold);
    const eqItalic = Boolean(blk.italic);
    if (mathFormat === 'latex') {
      const latexText = '${' + cleanLatexDelimiters(blk.latex) + '}$';
      return (
        <div
          data-math-latex={cleanLatexDelimiters(blk.latex)}
          style={{
            marginTop: `${spaceBeforePt * scale}px`,
            paddingLeft:
              eqAlign === 'center' || indentLeftPt <= 0 ? undefined : `${indentLeftPt * scale}px`,
            paddingRight:
              eqAlign === 'center' || indentRightPt <= 0 ? undefined : `${indentRightPt * scale}px`,
            fontSize: `${baseFontPt * scale * 0.92}px`,
            color: eqHex ? `#${eqHex}` : '#000000',
          }}
          className={`flex ${flexJustify} ${eqBold ? 'font-bold' : ''} ${eqItalic ? 'italic' : ''}`}
        >
          {disableEquationInspect ? (
            <span className="font-mono px-2 py-1 rounded-md bg-amber-50 border border-amber-200/80">
              {latexText}
            </span>
          ) : (
            <button
              type="button"
              data-math-latex={cleanLatexDelimiters(blk.latex)}
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) return;
                onSelectEquation?.(blk.latex ?? '', true);
              }}
              title="Công thức Toggle TeX bọc ${...}$ — nhấn để xem chi tiết"
              className="font-mono px-2 py-1 rounded-md bg-amber-50 border border-amber-200/80 hover:bg-amber-100/80 transition-colors cursor-pointer"
            >
              {latexText}
            </button>
          )}
        </div>
      );
    }
    return (
      <div
        data-math-latex={cleanLatexDelimiters(blk.latex)}
        style={{
          marginTop: `${spaceBeforePt * scale}px`,
          paddingLeft: eqAlign === 'center' || indentLeftPt <= 0 ? undefined : `${indentLeftPt * scale}px`,
          paddingRight: eqAlign === 'center' || indentRightPt <= 0 ? undefined : `${indentRightPt * scale}px`,
          fontSize: `${baseFontPt * scale}px`,
          color: eqHex ? `#${eqHex}` : undefined,
        }}
        className={`flex ${flexJustify} ${eqBold ? 'katex-bold-override font-bold' : ''} ${
          eqItalic ? 'italic' : ''
        }`}
      >
        {disableEquationInspect ? (
          <span className="px-2 py-1 rounded-md">
            <MathRenderer latex={blk.latex} displayMode={true} />
          </span>
        ) : (
          <button
            type="button"
            data-math-latex={cleanLatexDelimiters(blk.latex)}
            onClick={(e) => {
              if (e.ctrlKey || e.metaKey) return;
              onSelectEquation?.(blk.latex ?? '', true);
            }}
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
    const normalizedTable = normalizeTableBlockGrid(blk);
    const tableRows = normalizedTable.table_rows ?? blk.table_rows;
    const tableStyle =
      normalizedTable.table_style ?? (normalizedTable.table_borderless ? 'borderless' : 'grid');
    const isBorderless = tableStyle === 'borderless';
    const isBooktabs = tableStyle === 'booktabs';
    const isBox = tableStyle === 'box';
    const isGrid = tableStyle === 'grid';
    const colBorders = Array.isArray(normalizedTable.table_col_borders)
      ? normalizedTable.table_col_borders
      : null;

    const maxCols = Math.max(
      ...tableRows.map((r) => r.reduce((acc, c) => acc + Math.max(1, c.col_span ?? 1), 0)),
      1
    );
    const availTablePt = Math.max(140, geom.contentWidthPt - indentLeftPt - indentRightPt);
    const colPcts = computeSafeTableColPcts(tableRows, maxCols, availTablePt, isBorderless);

    const totalRows = tableRows.length;

    const getCellAtCol = (row: TableCellData[], targetCol: number): TableCellData | null => {
      let c = 0;
      for (const cell of row) {
        const sp = Math.max(1, cell.col_span ?? 1);
        if (c === targetCol) return cell;
        if (c > targetCol) return null;
        c += sp;
      }
      return null;
    };

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
          className="w-full border-collapse"
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
            {tableRows.map((row, rIdx) => {
              let colCursor = 0;
              const rowWidthSum = row.reduce((s, c) => s + (c.width_pct ?? 0), 0) || 100;
              return (
                <tr key={rIdx}>
                  {row.map((cell, cIdx) => {
                    const span = Math.max(1, cell.col_span ?? 1);
                    const startCol = colCursor;
                    colCursor += span;

                    if (cell.v_merge === 'continue') {
                      return null;
                    }

                    let rowSpanCount = 1;
                    if (cell.v_merge === 'restart') {
                      for (let nr = rIdx + 1; nr < totalRows; nr++) {
                        const below = getCellAtCol(tableRows[nr], startCol);
                        if (below && below.v_merge === 'continue') {
                          rowSpanCount += 1;
                        } else {
                          break;
                        }
                      }
                    }

                    const isHeader = Boolean(cell.is_header) && !isBorderless;
                    const cellAlign = cell.alignment ?? (isHeader && !isBox ? 'center' : 'left');
                    const cellAlignClass = ALIGN_CLASS_MAP[cellAlign] ?? 'text-left';
                    const vAlignClass =
                      cell.v_align === 'center'
                        ? 'align-middle'
                        : cell.v_align === 'bottom'
                        ? 'align-bottom'
                        : isBorderless || isBox || (cell.blocks && cell.blocks.length > 0)
                        ? 'align-top'
                        : 'align-middle';

                    const customFill = normalizeBoxHexColor(cell.fill_color);
                    const defaultHeaderFill = isHeader && isGrid && !colBorders;
                    const borderHex =
                      normalizeBoxHexColor(cell.border_color) ??
                      (isBooktabs ? '0F172A' : isBox ? '334155' : '94A3B8');

                    const cellStyle: CSSProperties = {};
                    if (customFill) {
                      cellStyle.backgroundColor = `#${customFill}`;
                    }

                    if (isBooktabs) {
                      if (cell.border_top) {
                        cellStyle.borderTop = `${rIdx === 0 ? 2 : 1}px solid #${borderHex}`;
                      }
                      if (cell.border_bottom) {
                        cellStyle.borderBottom = `${
                          rIdx === totalRows - 1 ? 2 : 1
                        }px solid #${borderHex}`;
                      }
                      if (cell.border_left) {
                        cellStyle.borderLeft = `1px solid #${borderHex}`;
                      }
                      if (cell.border_right) {
                        cellStyle.borderRight = `1px solid #${borderHex}`;
                      }
                    } else if (isBox) {
                      const drawTop =
                        cell.border_top !== undefined && cell.border_top !== null
                          ? cell.border_top
                          : !blk.table_borderless;
                      const drawBottom =
                        cell.border_bottom !== undefined && cell.border_bottom !== null
                          ? cell.border_bottom
                          : !blk.table_borderless;
                      const drawLeft =
                        cell.border_left !== undefined && cell.border_left !== null
                          ? cell.border_left
                          : !blk.table_borderless;
                      const drawRight =
                        cell.border_right !== undefined && cell.border_right !== null
                          ? cell.border_right
                          : !blk.table_borderless;
                      if (drawTop) cellStyle.borderTop = `1.5px solid #${borderHex}`;
                      if (drawBottom) cellStyle.borderBottom = `1.5px solid #${borderHex}`;
                      if (drawLeft) cellStyle.borderLeft = `1.5px solid #${borderHex}`;
                      if (drawRight) cellStyle.borderRight = `1.5px solid #${borderHex}`;
                    } else if (isGrid) {
                      if (colBorders) {
                        if (cell.border_top) cellStyle.borderTop = `1px solid #${borderHex}`;
                        if (cell.border_bottom) cellStyle.borderBottom = `1px solid #${borderHex}`;
                        const drawLeft =
                          cell.border_left !== undefined && cell.border_left !== null
                            ? cell.border_left
                            : Boolean(colBorders[startCol]);
                        const drawRight =
                          cell.border_right !== undefined && cell.border_right !== null
                            ? cell.border_right
                            : Boolean(colBorders[startCol + span]);
                        if (drawLeft) cellStyle.borderLeft = `1px solid #${borderHex}`;
                        if (drawRight) cellStyle.borderRight = `1px solid #${borderHex}`;
                      } else {
                        cellStyle.borderTop =
                          cell.border_top === false ? 'none' : `1px solid #CBD5E1`;
                        cellStyle.borderBottom =
                          cell.border_bottom === false ? 'none' : `1px solid #CBD5E1`;
                        cellStyle.borderLeft =
                          cell.border_left === false ? 'none' : `1px solid #CBD5E1`;
                        cellStyle.borderRight =
                          cell.border_right === false ? 'none' : `1px solid #CBD5E1`;
                      }
                    } else if (isBorderless) {
                      if (cell.border_top) cellStyle.borderTop = `1px solid #${borderHex}`;
                      if (cell.border_bottom) cellStyle.borderBottom = `1px solid #${borderHex}`;
                      if (cell.border_left) cellStyle.borderLeft = `1px solid #${borderHex}`;
                      if (cell.border_right) cellStyle.borderRight = `1px solid #${borderHex}`;
                    }

                    const hasNestedBlocks = Array.isArray(cell.blocks) && cell.blocks.length > 0;
                    const cellFrac =
                      cell.width_pct && cell.width_pct > 0
                        ? cell.width_pct / rowWidthSum
                        : span / maxCols;
                    const cellContentW = Math.max(110, geom.contentWidthPt * cellFrac - 12);
                    const cellGeom: PageGeometry = {
                      ...geom,
                      contentWidthPt: cellContentW,
                      contentWidthTwips: Math.round(cellContentW * 20),
                    };

                    const padClass = isBox
                      ? isHeader
                        ? 'px-3.5 py-2'
                        : 'px-3.5 py-2.5'
                      : isBorderless
                      ? 'px-1.5 py-0.5'
                      : 'px-2.5 py-1.5';

                    return (
                      <td
                        key={cIdx}
                        colSpan={span > 1 ? span : undefined}
                        rowSpan={rowSpanCount > 1 ? rowSpanCount : undefined}
                        style={cellStyle}
                        className={`${padClass} ${vAlignClass} ${
                          defaultHeaderFill ? 'bg-slate-100' : ''
                        } ${cellAlignClass}`}
                      >
                        {hasNestedBlocks ? (
                          <div>
                            {groupBlocksIntoVisualBands(cell.blocks ?? [], cellGeom).map(
                              (cBand, cbIdx) => {
                                if (cBand.kind === 'single') {
                                  return (
                                    <RenderSingleBlock
                                      key={cbIdx}
                                      blk={cBand.block}
                                      pageNumber={pageNumber}
                                      geom={cellGeom}
                                      scale={scale}
                                      spaceBeforePt={cBand.spaceBeforePt}
                                      indentLeftPt={cBand.indentLeftPt}
                                      indentRightPt={cBand.indentRightPt}
                                      firstLineIndentPt={cBand.firstLineIndentPt}
                                      pageBaseFontPt={pageBaseFontPt}
                                      mathFormat={mathFormat}
                                      disableEquationInspect={disableEquationInspect}
                                      onSelectEquation={onSelectEquation}
                                    />
                                  );
                                }
                                return (
                                  <div
                                    key={cbIdx}
                                    style={{
                                      marginTop: `${cBand.spaceBeforePt * scale}px`,
                                      display: 'grid',
                                      gridTemplateColumns: `${cBand.leftWidthPct}% ${cBand.rightWidthPct}%`,
                                      gap: '10px',
                                      alignItems: 'start',
                                    }}
                                  >
                                    <div>
                                      <RenderSingleBlock
                                        blk={cBand.left}
                                        pageNumber={pageNumber}
                                        geom={cellGeom}
                                        scale={scale}
                                        spaceBeforePt={0}
                                        indentLeftPt={0}
                                        indentRightPt={0}
                                        firstLineIndentPt={0}
                                        pageBaseFontPt={pageBaseFontPt}
                                        mathFormat={mathFormat}
                                        disableEquationInspect={disableEquationInspect}
                                        onSelectEquation={onSelectEquation}
                                      />
                                    </div>
                                    <div>
                                      <RenderSingleBlock
                                        blk={cBand.right}
                                        pageNumber={pageNumber}
                                        geom={cellGeom}
                                        scale={scale}
                                        spaceBeforePt={0}
                                        indentLeftPt={0}
                                        indentRightPt={0}
                                        firstLineIndentPt={0}
                                        pageBaseFontPt={pageBaseFontPt}
                                        mathFormat={mathFormat}
                                        disableEquationInspect={disableEquationInspect}
                                        onSelectEquation={onSelectEquation}
                                      />
                                    </div>
                                  </div>
                                );
                              }
                            )}
                          </div>
                        ) : (
                          <RenderSegments
                            segments={cell.segments}
                            defaultBold={false}
                            baseFontPt={baseFontPt}
                            scale={scale}
                            mathFormat={mathFormat}
                            disableEquationInspect={disableEquationInspect}
                            onSelectEquation={onSelectEquation}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
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
  underlineCorrectChoice = false,
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
  onCtrlDoubleClickBlock,
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
            const expanded = transformBlocksForChoiceLayout(
              [rawBlk],
              choiceLayout,
              geom,
              underlineCorrectChoice
            );
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
                  initialPosition={{
                    spaceBeforePt: options.spaceBeforePt,
                    indentLeftPt: options.indentLeftPt,
                    indentRightPt: options.indentRightPt,
                    firstLineIndentPt: options.firstLineIndentPt,
                  }}
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
                pageBaseFontPt={page.base_font_size_pt ?? 12}
                mathFormat={mathFormat}
                disableEquationInspect={isEditMode}
                onSelectEquation={onSelectEquation}
              />
            );

            if (!isValidSrc || (!editable && !onCtrlDoubleClickBlock)) {
              return content;
            }

            const handleBlockDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
              if ((e.ctrlKey || e.metaKey) && onCtrlDoubleClickBlock) {
                e.preventDefault();
                e.stopPropagation();
                const targetEl = e.target as HTMLElement | null;
                const mathEl = targetEl?.closest('[data-math-latex]') as HTMLElement | null;
                const clickedMathLatex = mathEl?.getAttribute('data-math-latex') || undefined;
                const selectionText = window.getSelection()?.toString().trim() || '';
                const blockRenderedText = (
                  e.currentTarget.innerText ||
                  e.currentTarget.textContent ||
                  ''
                ).trim();
                onCtrlDoubleClickBlock({
                  pageNumber: page.pageNumber,
                  blockIndex: srcIdx,
                  block: page.blocks[srcIdx],
                  clickedText: selectionText,
                  clickedMathLatex,
                  blockRenderedText,
                });
                return;
              }
              if (editable) {
                e.stopPropagation();
                setEditingTarget({ pageNumber: page.pageNumber, blockIndex: srcIdx });
              }
            };

            if (!editable) {
              return (
                <div
                  onDoubleClick={handleBlockDoubleClick}
                  title="Giữ Ctrl + nhấp đúp chuột để nhảy tới vị trí LaTeX bên trái"
                  className="rounded transition-colors hover:bg-blue-50/30"
                >
                  {content}
                </div>
              );
            }

            const totalSrcBlocks = page.blocks.length;

            return (
              <div
                onDoubleClick={handleBlockDoubleClick}
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
                paddingTop: `${geom.marginTopPt * scale}px`,
                paddingRight: `${geom.marginRightPt * scale}px`,
                paddingBottom: `${geom.marginBottomPt * scale}px`,
                paddingLeft: `${geom.marginLeftPt * scale}px`,
              }}
              className="bg-white border border-slate-200 rounded-lg shadow-xs mx-auto doc-serif text-black"
            >
              <div className="flex items-center justify-between gap-2 pb-2.5 mb-4 border-b border-slate-100 font-sans text-xs text-slate-400">
                <span>Trang {page.pageNumber}</span>
                {onCtrlDoubleClickBlock && !editable && (
                  <span className="text-[11px] text-slate-400 hidden sm:inline">
                    Giữ Ctrl + nhấp đúp để định vị sửa LaTeX bên trái
                  </span>
                )}
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
