import JSZip from 'jszip';
import type {
  ChoiceLayoutMode,
  DocumentBlock,
  InlineSegment,
  LatexExportFormat,
  PageExtraction,
  TableCellData,
} from '../types/document.ts';
import {
  cleanLatexDelimiters,
  computePageGeometry,
  computeSafeTableColPcts,
  groupBlocksIntoVisualBands,
  hasLeadingChoiceLabel,
  isChoiceTableBlock,
  isValidBox,
  normalizeBoxHexColor,
  normalizeHexColor,
  normalizeTableBlockGrid,
  splitSegmentsIntoChoiceGroups,
  type PageGeometry,
  type VisualBand,
} from './layoutMetrics.ts';

export interface LatexZipBuildOptions {
  format?: LatexExportFormat;
  filename?: string;
  addPageBreaks?: boolean;
  choiceLayout?: ChoiceLayoutMode;
  convertImageToPng?: (dataUrl: string, w?: number, h?: number) => Promise<string>;
}

export interface LatexProjectImage {
  zipPath: string;
  filename: string;
  mimeType: string;
  dataUrl: string;
  widthPx: number;
  heightPx: number;
}

export interface LatexProjectResult {
  mode: 'basic' | 'ex_test';
  isExamDetected: boolean;
  hasSolutions: boolean;
  files: Array<{ path: string; content: string }>;
  images: LatexProjectImage[];
}

export interface LatexZipArchiveResult {
  blob: Blob;
  zipFileName: string;
  mode: 'basic' | 'ex_test';
  isExamDetected: boolean;
  hasSolutions: boolean;
  imageCount: number;
  fileCount: number;
}

interface ImageRegistry {
  byDataUrl: Map<string, LatexProjectImage>;
  list: LatexProjectImage[];
}

const UNICODE_TEXT_MATH_MAP: Record<string, string> = {
  '≤': '$\\le$',
  '≥': '$\\ge$',
  '≠': '$\\neq$',
  '≈': '$\\approx$',
  '≡': '$\\equiv$',
  '∞': '$\\infty$',
  '±': '$\\pm$',
  '∓': '$\\mp$',
  '×': '$\\times$',
  '÷': '$\\div$',
  '∈': '$\\in$',
  '∉': '$\\notin$',
  '⊂': '$\\subset$',
  '⊆': '$\\subseteq$',
  '∪': '$\\cup$',
  '∩': '$\\cap$',
  '∅': '$\\emptyset$',
  '∀': '$\\forall$',
  '∃': '$\\exists$',
  '⇒': '$\\Rightarrow$',
  '⇔': '$\\Leftrightarrow$',
  '⇐': '$\\Leftarrow$',
  '→': '$\\to$',
  '←': '$\\leftarrow$',
  '↔': '$\\leftrightarrow$',
  '°': '$^\\circ$',
  '∠': '$\\angle$',
  '△': '$\\triangle$',
  '∥': '$\\parallel$',
  '⊥': '$\\perp$',
  '−': '-',
  '–': '--',
  '—': '---',
  '’': "'",
  '‘': '`',
  '“': '``',
  '”': "''",
  '…': '\\ldots{}',
};

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function escapeLatexText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (UNICODE_TEXT_MATH_MAP[ch]) {
      out += UNICODE_TEXT_MATH_MAP[ch];
      continue;
    }
    switch (ch) {
      case '\\':
        out += '\\textbackslash{}';
        break;
      case '{':
        out += '\\{';
        break;
      case '}':
        out += '\\}';
        break;
      case '%':
        out += '\\%';
        break;
      case '&':
        out += '\\&';
        break;
      case '#':
        out += '\\#';
        break;
      case '_':
        out += '\\_';
        break;
      case '$':
        out += '\\$';
        break;
      case '^':
        out += '\\textasciicircum{}';
        break;
      case '~':
        out += '\\textasciitilde{}';
        break;
      default:
        out += ch;
        break;
    }
  }
  return out;
}

export function sanitizeMathForTex(rawLatex: string): string {
  let inner = cleanLatexDelimiters(rawLatex ?? '');
  if (!inner) return '';
  inner = inner
    .replace(/−/g, '-')
    .replace(/–/g, '-')
    .replace(/’/g, "'")
    .replace(/\\textcolor\s*\{#([0-9A-Fa-f]{6})\}/g, (_, hex: string) => `\\textcolor[HTML]{${hex.toUpperCase()}}`)
    .replace(/\\color\s*\{#([0-9A-Fa-f]{6})\}/g, (_, hex: string) => `\\color[HTML]{${hex.toUpperCase()}}`)
    .replace(/\\textcolor\s*\{#([0-9A-Fa-f]{3})\}/g, (_, hex: string) => {
      const full = hex.split('').map((c) => c + c).join('').toUpperCase();
      return `\\textcolor[HTML]{${full}}`;
    })
    .replace(/\\color\s*\{#([0-9A-Fa-f]{3})\}/g, (_, hex: string) => {
      const full = hex.split('').map((c) => c + c).join('').toUpperCase();
      return `\\color[HTML]{${full}}`;
    });
  return inner.trim();
}

function getRelativeSizeCommand(fontSizePt?: number | null, baseFontPt = 12): string | null {
  if (typeof fontSizePt !== 'number' || !Number.isFinite(fontSizePt)) return null;
  const diff = fontSizePt - baseFontPt;
  if (diff >= 8) return '\\Huge';
  if (diff >= 5) return '\\LARGE';
  if (diff >= 3.5) return '\\Large';
  if (diff >= 1.5) return '\\large';
  if (diff <= -3) return '\\footnotesize';
  if (diff <= -1.5) return '\\small';
  return null;
}

function formatTextSegmentForTex(seg: InlineSegment, baseFontPt = 12): string {
  const raw = seg.content ?? '';
  if (!raw) return '';

  const leadMatch = raw.match(/^\s*/);
  const trailMatch = raw.match(/\s*$/);
  const lead = leadMatch ? leadMatch[0] : '';
  const trail = trailMatch && trailMatch[0].length < raw.length ? trailMatch[0] : '';
  const core = raw.slice(lead.length, raw.length - trail.length);

  if (!core) return raw;

  let out = escapeLatexText(core).replace(/\r\n?|\n/g, ' \\\\\n');
  if (seg.underline) out = `\\underline{${out}}`;
  if (seg.italic) out = `\\textit{${out}}`;
  if (seg.bold) out = `\\textbf{${out}}`;

  const hex = normalizeHexColor(seg.color);
  if (hex) {
    out = `\\textcolor[HTML]{${hex}}{${out}}`;
  }

  const sizeCmd = getRelativeSizeCommand(seg.font_size_pt, baseFontPt);
  if (sizeCmd) {
    out = `{${sizeCmd} ${out}}`;
  }

  return `${lead}${out}${trail}`;
}

export function segmentsToCompilableLatex(
  segments?: InlineSegment[] | null,
  options: { inTableCell?: boolean; baseFontPt?: number } = {}
): string {
  if (!segments || segments.length === 0) return '';
  const { inTableCell = false, baseFontPt = 12 } = options;

  const parts: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    let tabPrefix = '';
    if (seg.tab_before) {
      if (typeof seg.tab_width_pt === 'number' && Number.isFinite(seg.tab_width_pt) && seg.tab_width_pt > 0) {
        tabPrefix = `\\hspace*{${Math.round(seg.tab_width_pt * 10) / 10}pt}`;
      } else if (seg.tab_leader === 'dot') {
        const repeatCount = Math.max(1, Math.min(4, Math.round(seg.tab_weight ?? 1)));
        tabPrefix = ` ${'\\dotfill'.repeat(repeatCount)} `;
      } else if (seg.tab_leader === 'underscore') {
        tabPrefix = ' \\hrulefill ';
      } else if (inTableCell) {
        tabPrefix = ' \\quad ';
      } else {
        tabPrefix = ' \\hfill ';
      }
    }

    if (seg.type === 'math') {
      const inner = sanitizeMathForTex(seg.content ?? '');
      if (!inner) continue;
      let mathOut = `$${inner}$`;
      if (seg.underline) mathOut = `\\underline{${mathOut}}`;
      if (seg.italic) mathOut = `\\textit{${mathOut}}`;
      if (seg.bold) mathOut = `{\\boldmath ${mathOut}}`;
      const hex = normalizeHexColor(seg.color);
      if (hex) {
        mathOut = `\\textcolor[HTML]{${hex}}{${mathOut}}`;
      }
      parts.push(`${tabPrefix}${mathOut}`);
    } else {
      let textOut = formatTextSegmentForTex(seg, baseFontPt);
      if (inTableCell) {
        textOut = textOut.replace(/ \\\\\n/g, ' ');
      }
      parts.push(`${tabPrefix}${textOut}`);
    }
  }

  return parts
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getBlockPlainText(blk: DocumentBlock): string {
  const segText = (blk.segments ?? []).map((s) => s.content ?? '').join('');
  if (segText.trim()) return segText.trim();
  if (blk.table_rows) {
    return blk.table_rows
      .map((r) =>
        r
          .map((c) => {
            const ct = (c.segments ?? []).map((s) => s.content ?? '').join('');
            const bt = (c.blocks ?? []).map(getBlockPlainText).join(' ');
            return `${ct} ${bt}`.trim();
          })
          .join(' ')
      )
      .join(' ')
      .trim();
  }
  return '';
}

function registerBlockImages(
  blk: DocumentBlock,
  registry: ImageRegistry
): void {
  if (blk.block_type === 'figure' && blk.croppedImageDataUrl) {
    if (!registry.byDataUrl.has(blk.croppedImageDataUrl)) {
      const idx = registry.list.length + 1;
      const numStr = String(idx).padStart(2, '0');
      const mimeMatch = blk.croppedImageDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+)[;,]/i);
      const mime = (mimeMatch?.[1] ?? 'image/png').toLowerCase();
      const ext = mime === 'image/jpeg' || mime === 'image/jpg' ? 'jpg' : 'png';
      const filename = `hinh_${numStr}.${ext}`;
      const item: LatexProjectImage = {
        zipPath: `images/${filename}`,
        filename,
        mimeType: ext === 'jpg' ? 'image/jpeg' : 'image/png',
        dataUrl: blk.croppedImageDataUrl,
        widthPx: blk.croppedWidthPx ?? 420,
        heightPx: blk.croppedHeightPx ?? 300,
      };
      registry.byDataUrl.set(blk.croppedImageDataUrl, item);
      registry.list.push(item);
    }
  }

  if (blk.table_rows) {
    for (const row of blk.table_rows) {
      for (const cell of row) {
        for (const nested of cell.blocks ?? []) {
          registerBlockImages(nested, registry);
        }
      }
    }
  }
}

function collectAllImages(pages: PageExtraction[]): ImageRegistry {
  const registry: ImageRegistry = {
    byDataUrl: new Map(),
    list: [],
  };
  for (const page of pages) {
    for (const blk of page.blocks) {
      registerBlockImages(blk, registry);
    }
  }
  return registry;
}

function computeFigureWidthSpec(
  blk: DocumentBlock,
  page: PageExtraction,
  unit: '\\textwidth' | '\\linewidth' = '\\textwidth',
  maxFrac = 0.9
): string {
  if (isValidBox(blk.box_2d)) {
    const rawSpan = (blk.box_2d[3] - blk.box_2d[1]) / 1000;
    const frac = clamp(rawSpan / 0.82, 0.18, maxFrac);
    return `${frac.toFixed(2)}${unit}`;
  }
  if (typeof blk.croppedWidthPx === 'number' && blk.croppedWidthPx > 0) {
    const pageW = page.pageWidthPx ?? 1240;
    const frac = clamp(blk.croppedWidthPx / (pageW * 0.82), 0.18, maxFrac);
    return `${frac.toFixed(2)}${unit}`;
  }
  return `${Math.min(0.55, maxFrac).toFixed(2)}${unit}`;
}

function renderFigureLatex(
  blk: DocumentBlock,
  page: PageExtraction,
  registry: ImageRegistry,
  opts: { inContainer?: boolean; wrapAlign?: boolean } = {}
): string {
  const img = blk.croppedImageDataUrl ? registry.byDataUrl.get(blk.croppedImageDataUrl) : undefined;
  const { inContainer = false, wrapAlign = true } = opts;

  if (!img) {
    if (blk.caption) {
      return `\\textit{${escapeLatexText(blk.caption)}}`;
    }
    return '';
  }

  const widthSpec = computeFigureWidthSpec(
    blk,
    page,
    inContainer ? '\\linewidth' : '\\textwidth',
    inContainer ? 0.95 : 0.88
  );

  const captionPart = blk.caption
    ? `\n\\\\[4pt]\n\\textit{${escapeLatexText(blk.caption)}}`
    : '';
  const body = `\\includegraphics[width=${widthSpec}]{${img.zipPath}}${captionPart}`;

  if (!wrapAlign) return body;
  if (blk.alignment === 'left') return `\\begin{flushleft}\n${body}\n\\end{flushleft}`;
  if (blk.alignment === 'right') return `\\begin{flushright}\n${body}\n\\end{flushright}`;
  return `\\begin{center}\n${body}\n\\end{center}`;
}

function renderTableLatex(
  blk: DocumentBlock,
  page: PageExtraction,
  registry: ImageRegistry
): string {
  const normBlk = normalizeTableBlockGrid(blk);
  const rows = normBlk.table_rows;
  if (!rows || rows.length === 0) return '';
  const baseFontPt = normBlk.font_size_pt ?? page.base_font_size_pt ?? 12;

  // Choice table in basic LaTeX mode: keep crisp multi-column layout
  if (isChoiceTableBlock(blk)) {
    const maxCols = Math.max(
      1,
      ...rows.map((r) => r.reduce((acc, c) => acc + Math.max(1, c.col_span ?? 1), 0))
    );
    const colSpec = Array.from({ length: maxCols }, () => 'l').join(' @{\\hspace{1.2em}} ');
    const lines = rows.map((row) => {
      const cells = row.map((cell) => segmentsToCompilableLatex(cell.segments, { inTableCell: true, baseFontPt }) || ' ');
      return `  ${cells.join(' & ')} \\\\`;
    });
    return `\\noindent\\begin{tabular}{@{}${colSpec}@{}}\n${lines.join('\n')}\n\\end{tabular}`;
  }

  const colCount = Math.max(
    1,
    ...rows.map((r) => r.reduce((acc, c) => acc + Math.max(1, c.col_span ?? 1), 0))
  );

  const hasNestedBlocks = rows.some((r) => r.some((c) => Array.isArray(c.blocks) && c.blocks.length > 0));
  const hasLongCells = rows.some((r) =>
    r.some((c) => {
      const txt = (c.segments ?? []).map((s) => s.content ?? '').join('');
      return txt.length > 36;
    })
  );

  const isBorderless = blk.table_borderless === true || blk.table_style === 'borderless';
  const isBooktabs = !isBorderless && blk.table_style === 'booktabs';
  const isBox = !isBorderless && blk.table_style === 'box';

  const geom = computePageGeometry(page);
  const safeColPcts = computeSafeTableColPcts(rows, colCount, geom.contentWidthPt, isBorderless);

  const getColumnAlign = (cIdx: number): 'left' | 'center' | 'right' => {
    // Prefer body row alignment over row 0 header alignment when body rows exist
    const bodyAlignCounts = { left: 0, center: 0, right: 0 };
    const startR = rows.length > 1 ? 1 : 0;
    for (let r = startR; r < rows.length; r++) {
      let cursor = 0;
      for (const cell of rows[r]) {
        const sp = Math.max(1, cell.col_span ?? 1);
        if (cursor === cIdx && sp === 1 && cell.alignment) {
          if (cell.alignment === 'center') bodyAlignCounts.center++;
          else if (cell.alignment === 'right') bodyAlignCounts.right++;
          else bodyAlignCounts.left++;
        }
        cursor += sp;
      }
    }
    if (bodyAlignCounts.center > bodyAlignCounts.left && bodyAlignCounts.center >= bodyAlignCounts.right) {
      return 'center';
    }
    if (bodyAlignCounts.right > bodyAlignCounts.left && bodyAlignCounts.right > bodyAlignCounts.center) {
      return 'right';
    }
    const sampleAlign = rows[0]?.[cIdx]?.alignment;
    return sampleAlign === 'center' ? 'center' : sampleAlign === 'right' ? 'right' : 'left';
  };

  const alignPrefixForP = (a: 'left' | 'center' | 'right'): string =>
    a === 'center'
      ? '>{\\centering\\arraybackslash}'
      : a === 'right'
      ? '>{\\raggedleft\\arraybackslash}'
      : '>{\\raggedright\\arraybackslash}';

  const useProportionalWidths =
    Boolean(safeColPcts) && (hasNestedBlocks || hasLongCells || (!isBorderless && colCount >= 2));
  const useTabularX = !useProportionalWidths && (hasNestedBlocks || hasLongCells);

  let colAligns: string[];
  if (useProportionalWidths && safeColPcts) {
    // Deduct ~2\tabcolsep per column (~12pt per column) so total table width matches \linewidth exactly without overfull hbox
    const tabcolsepOverheadFrac = Math.min(0.22, (colCount * 12) / Math.max(240, geom.contentWidthPt));
    const usableFrac = 1 - tabcolsepOverheadFrac;
    colAligns = safeColPcts.map((pct, cIdx) => {
      const a = getColumnAlign(cIdx);
      const frac = Math.max(0.05, (pct / 100) * usableFrac).toFixed(3);
      return `${alignPrefixForP(a)}p{${frac}\\linewidth}`;
    });
  } else if (useTabularX) {
    const maxColLen = Array.from({ length: colCount }, () => 0);
    for (const row of rows) {
      let cursor = 0;
      for (const cell of row) {
        const sp = Math.max(1, cell.col_span ?? 1);
        if (sp === 1 && cursor < colCount) {
          const hasBlocks = Array.isArray(cell.blocks) && cell.blocks.length > 0;
          const len = hasBlocks
            ? 80
            : (cell.segments ?? []).reduce((sum, s) => sum + (s.content ?? '').length, 0);
          if (len > maxColLen[cursor]) maxColLen[cursor] = len;
        }
        cursor += sp;
      }
    }
    const wideFlags = maxColLen.map((len) => len > 18);
    if (!wideFlags.some(Boolean)) {
      const widestIdx = maxColLen.indexOf(Math.max(...maxColLen));
      if (widestIdx >= 0) wideFlags[widestIdx] = true;
    }
    colAligns = Array.from({ length: colCount }, (_, cIdx) => {
      const a = getColumnAlign(cIdx);
      if (!wideFlags[cIdx]) {
        return a === 'center' ? 'c' : a === 'right' ? 'r' : 'l';
      }
      return a === 'center'
        ? '>{\\centering\\arraybackslash}X'
        : a === 'right'
        ? '>{\\raggedleft\\arraybackslash}X'
        : '>{\\raggedright\\arraybackslash}X';
    });
  } else {
    colAligns = Array.from({ length: colCount }, (_, cIdx) => {
      const a = getColumnAlign(cIdx);
      return a === 'center' ? 'c' : a === 'right' ? 'r' : 'l';
    });
  }

  let colSpec: string;
  if (isBorderless || isBooktabs) {
    colSpec = colAligns.join(' ');
  } else if (isBox) {
    colSpec = `|${colAligns.join(' ')}|`;
  } else {
    colSpec = `|${colAligns.join('|')}|`;
  }

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

  const rowStrings = rows.map((row, rIdx) => {
    const cellTexList: string[] = [];
    let colCursor = 0;
    for (let cIdx = 0; cIdx < row.length; cIdx++) {
      const cell = row[cIdx];
      const startCol = colCursor;
      const span = Math.max(1, cell.col_span ?? 1);
      colCursor += span;

      if (cell.v_merge === 'continue') {
        cellTexList.push(' ');
        continue;
      }

      let cellInner = '';
      if (Array.isArray(cell.blocks) && cell.blocks.length > 0) {
        const nestedParts = cell.blocks
          .map((nb) => renderSingleBlockBasicLatex(nb, page, registry, { inContainer: true }))
          .filter(Boolean);
        cellInner = nestedParts.join(' \\par ');
      } else {
        cellInner = segmentsToCompilableLatex(cell.segments, { inTableCell: true, baseFontPt });
      }

      if (cell.v_merge === 'restart') {
        let rowSpanCount = 1;
        for (let nr = rIdx + 1; nr < rows.length; nr++) {
          const below = getCellAtCol(rows[nr], startCol);
          if (below && below.v_merge === 'continue') rowSpanCount += 1;
          else break;
        }
        if (rowSpanCount > 1) {
          cellInner = `\\multirow{${rowSpanCount}}{*}{${cellInner || ' '}}`;
        }
      }

      const fillHex = normalizeBoxHexColor(cell.fill_color);
      if (fillHex && fillHex !== 'FFFFFF') {
        cellInner = `\\cellcolor[HTML]{${fillHex}}${cellInner || ' '}`;
      }

      const colDefaultAlign = getColumnAlign(startCol);
      const cellExplicitAlign = cell.alignment ?? colDefaultAlign;
      const needsAlignOverride =
        span === 1 &&
        cellExplicitAlign !== colDefaultAlign &&
        cellExplicitAlign !== 'justify';

      if (span > 1) {
        const alignChar = cellExplicitAlign === 'center' ? 'c' : cellExplicitAlign === 'right' ? 'r' : 'l';
        const spanSpec = isBorderless || isBooktabs ? alignChar : `|${alignChar}|`;
        cellTexList.push(`\\multicolumn{${span}}{${spanSpec}}{${cellInner || ' '}}`);
      } else if (needsAlignOverride) {
        const alignChar = cellExplicitAlign === 'center' ? 'c' : cellExplicitAlign === 'right' ? 'r' : 'l';
        const spanSpec = isBorderless || isBooktabs ? alignChar : `|${alignChar}|`;
        cellTexList.push(`\\multicolumn{1}{${spanSpec}}{${cellInner || ' '}}`);
      } else {
        cellTexList.push(cellInner || ' ');
      }
    }
    return `  ${cellTexList.join(' & ')} \\\\`;
  });

  // For bordered grid tables with vertical merges (v_merge='continue'), emit \cline instead of \hline where merged
  let body: string;
  if (isBorderless) {
    body = rowStrings.join('\n');
  } else if (isBooktabs) {
    if (rowStrings.length > 1) {
      body = `  \\toprule\n${rowStrings[0]}\n  \\midrule\n${rowStrings.slice(1).join('\n')}\n  \\bottomrule`;
    } else {
      body = `  \\toprule\n${rowStrings.join('\n')}\n  \\bottomrule`;
    }
  } else if (isBox) {
    body = `  \\hline\n${rowStrings.join('\n')}\n  \\hline`;
  } else {
    const joinedRows: string[] = ['  \\hline'];
    for (let rIdx = 0; rIdx < rowStrings.length; rIdx++) {
      joinedRows.push(rowStrings[rIdx]);
      if (rIdx < rows.length - 1) {
        const nextRow = rows[rIdx + 1];
        const mergedCols = new Set<number>();
        let cc = 0;
        for (const c of nextRow) {
          const sp = Math.max(1, c.col_span ?? 1);
          if (c.v_merge === 'continue') {
            for (let k = 0; k < sp; k++) mergedCols.add(cc + k + 1);
          }
          cc += sp;
        }
        if (mergedCols.size > 0 && mergedCols.size < colCount) {
          const clines: string[] = [];
          let startC = -1;
          for (let col1 = 1; col1 <= colCount; col1++) {
            if (!mergedCols.has(col1)) {
              if (startC === -1) startC = col1;
            } else if (startC !== -1) {
              clines.push(`\\cline{${startC}-${col1 - 1}}`);
              startC = -1;
            }
          }
          if (startC !== -1) clines.push(`\\cline{${startC}-${colCount}}`);
          joinedRows.push(`  ${clines.join('')}`);
        } else {
          joinedRows.push('  \\hline');
        }
      } else {
        joinedRows.push('  \\hline');
      }
    }
    body = joinedRows.join('\n');
  }

  const envName = useTabularX ? 'tabularx' : 'tabular';
  const openEnv = useTabularX
    ? `\\begin{tabularx}{\\linewidth}{${colSpec}}`
    : `\\begin{tabular}{${colSpec}}`;
  const tbl = `${openEnv}\n${body}\n\\end{${envName}}`;

  if (blk.alignment === 'center') {
    return `\\begin{center}\n${tbl}\n\\end{center}`;
  }
  if (blk.alignment === 'right') {
    return `\\begin{flushright}\n${tbl}\n\\end{flushright}`;
  }
  return `\\noindent${tbl}`;
}

function renderExamHeaderTableLatex(
  blk: DocumentBlock,
  page: PageExtraction,
  registry: ImageRegistry
): string {
  const rows = blk.table_rows;
  if (!rows || rows.length === 0) return '';
  const baseFontPt = blk.font_size_pt ?? page.base_font_size_pt ?? 12;
  const colCount = Math.max(
    1,
    ...rows.map((r) => r.reduce((acc, c) => acc + Math.max(1, c.col_span ?? 1), 0))
  );
  const colAligns = Array.from({ length: colCount }, (_, cIdx) => {
    const sampleAlign = rows[0]?.[cIdx]?.alignment;
    if (sampleAlign === 'center' || sampleAlign === 'right' || sampleAlign === 'left') {
      return sampleAlign === 'center' ? 'c' : sampleAlign === 'right' ? 'r' : 'l';
    }
    if (colCount === 3) return cIdx === 0 ? 'l' : cIdx === 1 ? 'c' : 'r';
    if (colCount === 2) return cIdx === 0 ? 'l' : 'r';
    return 'l';
  });

  const rowStrings = rows.map((row) => {
    const cells = row.map((cell) => {
      if (Array.isArray(cell.blocks) && cell.blocks.length > 0) {
        return (
          cell.blocks
            .map((nb) => renderSingleBlockBasicLatex(nb, page, registry, { inContainer: true }))
            .filter(Boolean)
            .join(' ') || ' '
        );
      }
      const txt = segmentsToCompilableLatex(cell.segments, { inTableCell: true, baseFontPt });
      return txt || ' ';
    });
    return `\t${cells.join(' & ')} \\\\`;
  });

  return [
    '\\noindent',
    `\\begin{tabular*}{\\textwidth}{@{\\extracolsep{\\fill}}${colAligns.join('')}@{}}`,
    ...rowStrings,
    '\\end{tabular*}',
  ].join('\n');
}

function wrapBlockAlignment(content: string, alignment: DocumentBlock['alignment']): string {
  if (!content) return '';
  if (alignment === 'center') return `\\begin{center}\n${content}\n\\end{center}`;
  if (alignment === 'right') return `\\begin{flushright}\n${content}\n\\end{flushright}`;
  return content;
}

function renderSingleBlockBasicLatex(
  blk: DocumentBlock,
  page: PageExtraction,
  registry: ImageRegistry,
  opts: {
    inContainer?: boolean;
    indentLeftPt?: number;
    indentRightPt?: number;
    firstLineIndentPt?: number;
  } = {}
): string {
  const {
    inContainer = false,
    indentLeftPt = blk.indent_left_pt ?? 0,
    indentRightPt = blk.indent_right_pt ?? 0,
    firstLineIndentPt = blk.first_line_indent_pt ?? 0,
  } = opts;
  const baseFontPt = page.base_font_size_pt ?? 12;

  if (blk.block_type === 'horizontal_rule') {
    return '\\noindent\\rule{\\linewidth}{0.4pt}';
  }

  if (blk.block_type === 'equation') {
    const inner = sanitizeMathForTex(blk.latex ?? '');
    if (!inner) return '';
    const eqHex = normalizeHexColor(blk.color);
    const prefixes: string[] = [];
    if (blk.bold) prefixes.push('\\boldmath\\bfseries');
    if (blk.italic) prefixes.push('\\itshape');
    if (eqHex) prefixes.push(`\\color[HTML]{${eqHex}}`);
    const eqStr =
      blk.alignment === 'left'
        ? `\\noindent\\ensuremath{\\displaystyle ${inner}}`
        : blk.alignment === 'right'
        ? `\\begin{flushright}\n$\\displaystyle ${inner}$\n\\end{flushright}`
        : `\\[\n${inner}\n\\]`;
    return prefixes.length > 0 ? `{${prefixes.join(' ')}\n${eqStr}\n}` : eqStr;
  }

  if (blk.block_type === 'figure') {
    return renderFigureLatex(blk, page, registry, {
      inContainer,
      wrapAlign: !inContainer,
    });
  }

  if (blk.block_type === 'table') {
    return renderTableLatex(blk, page, registry);
  }

  if (blk.block_type === 'heading') {
    const inner = segmentsToCompilableLatex(blk.segments, { baseFontPt });
    if (!inner) return '';
    const sizeCmd =
      getRelativeSizeCommand(blk.font_size_pt, baseFontPt) ??
      (blk.heading_level === 1 ? '\\Large' : blk.heading_level === 3 ? '\\normalsize' : '\\large');
    const sized = `{${sizeCmd} ${inner}}`;
    if (blk.alignment === 'center') {
      return `\\begin{center}\n${sized}\n\\end{center}`;
    }
    if (blk.alignment === 'right') {
      return `\\begin{flushright}\n${sized}\n\\end{flushright}`;
    }
    if (!inContainer && indentLeftPt > 3) {
      return `{\\leftskip=${Math.round(indentLeftPt * 10) / 10}pt ${sized}\\par}`;
    }
    return `\\noindent ${sized}`;
  }

  const text = segmentsToCompilableLatex(blk.segments, {
    inTableCell: inContainer,
    baseFontPt,
  });
  if (!text) return '';

  const blockSizeCmd = getRelativeSizeCommand(blk.font_size_pt, baseFontPt);
  let sizedText = blockSizeCmd ? `{${blockSizeCmd} ${text}}` : text;

  if (!inContainer && blk.alignment !== 'center' && blk.alignment !== 'right') {
    if (firstLineIndentPt > 3) {
      sizedText = `\\hspace*{${Math.round(firstLineIndentPt * 10) / 10}pt}${sizedText}`;
    }
    const leftSkip = indentLeftPt > 3 ? Math.round(indentLeftPt * 10) / 10 : 0;
    const rightSkip = indentRightPt > 3 ? Math.round(indentRightPt * 10) / 10 : 0;
    const hangPt = firstLineIndentPt < -3 ? Math.round(Math.abs(firstLineIndentPt) * 10) / 10 : 0;
    if (leftSkip > 0 || rightSkip > 0 || hangPt > 0) {
      const prefixCmds: string[] = [];
      if (leftSkip > 0) prefixCmds.push(`\\leftskip=${leftSkip}pt`);
      if (rightSkip > 0) prefixCmds.push(`\\rightskip=${rightSkip}pt`);
      if (hangPt > 0) prefixCmds.push(`\\hangindent=${hangPt}pt\\hangafter=1`);
      return `{${prefixCmds.join(' ')} ${sizedText}\\par}`;
    }
  }

  return inContainer ? sizedText : wrapBlockAlignment(sizedText, blk.alignment);
}

function isChoiceParagraph(blk: DocumentBlock): boolean {
  if (blk.block_type !== 'paragraph') return false;
  return hasLeadingChoiceLabel(blk.segments);
}

export function detectIsExamDocument(pages: PageExtraction[]): boolean {
  let questionCount = 0;
  let choiceBlockCount = 0;
  let accumulatedPartialChoices = 0;
  let hasExamHeaderKeyword = false;

  const EXAM_KEYWORD_RE =
    /\b(?:ĐỀ\s+(?:THI|KIỂM\s+TRA|KHẢO\s+SÁT|ÔN\s+TẬP|MINH\s+HỌA|CHÍNH\s+THỨC|CƯƠNG)|MÃ\s+ĐỀ|PHẦN\s+(?:I|II|III|IV|1|2|3|4)|TRẮC\s+NGHIỆM|ĐÚNG\s+SAI|TRẢ\s+LỜI\s+NGẮN|Thời\s+gian\s+làm\s+bài)\b/i;
  const QUESTION_START_RE = /^\s*(?:Câu|Bài)\s+\d+\s*[.:)]?(?:\s|$)/i;

  for (const page of pages) {
    for (const blk of page.blocks) {
      const plain = getBlockPlainText(blk);
      if (plain && EXAM_KEYWORD_RE.test(plain)) {
        hasExamHeaderKeyword = true;
      }

      if (blk.block_type === 'table' && (blk.is_choice_block || isChoiceTableBlock(blk))) {
        const nonEmptyChoiceCells = (blk.table_rows ?? [])
          .flat()
          .filter((c) => hasLeadingChoiceLabel(c.segments));
        if (nonEmptyChoiceCells.length >= 4) {
          choiceBlockCount += 1;
          accumulatedPartialChoices = 0;
        } else {
          accumulatedPartialChoices += nonEmptyChoiceCells.length;
          if (accumulatedPartialChoices >= 4) {
            choiceBlockCount += 1;
            accumulatedPartialChoices = 0;
          }
        }
        continue;
      }

      if (blk.block_type === 'paragraph' || blk.block_type === 'heading') {
        if (QUESTION_START_RE.test(plain)) {
          questionCount += 1;
          accumulatedPartialChoices = 0;
          continue;
        }
        const multiGroups = splitSegmentsIntoChoiceGroups(blk.segments ?? []);
        if (multiGroups && multiGroups.length >= 2) {
          accumulatedPartialChoices += multiGroups.length;
          if (accumulatedPartialChoices >= 4) {
            choiceBlockCount += 1;
            accumulatedPartialChoices = 0;
          }
          continue;
        }
        if (isChoiceParagraph(blk)) {
          accumulatedPartialChoices += 1;
          if (accumulatedPartialChoices >= 4) {
            choiceBlockCount += 1;
            accumulatedPartialChoices = 0;
          }
          continue;
        }
      }
      accumulatedPartialChoices = 0;
    }
  }

  if (questionCount >= 1 && choiceBlockCount >= 1) return true;
  if (questionCount >= 2) return true;
  if (choiceBlockCount >= 2) return true;
  if (hasExamHeaderKeyword && (questionCount >= 1 || choiceBlockCount >= 1)) return true;
  return false;
}

function buildMainPreamble(
  pages: PageExtraction[],
  isExTest: boolean,
  hasSolutions: boolean,
  hasHeaderFile: boolean,
  contentFilename: string
): string {
  const firstPage = pages[0];

  if (isExTest) {
    const lines: string[] = [
      '% Biên dịch bằng pdfLaTeX (TeXstudio / Overleaf) - Định dạng đề thi gói ex_test',
      hasSolutions
        ? '% Đổi [color,loigiai] thành [color,dethi] nếu muốn ẩn lời giải chi tiết'
        : '% Đổi [color,loigiai] thành [color,dethi] nếu muốn ẩn khung lời giải',
      '\\documentclass[12pt,a4paper,oneside]{book}',
      '\\usepackage[utf8]{vietnam}',
      '\\usepackage{fouriernc}',
      '\\usepackage{pgffor}',
      '\\usepackage{graphicx}',
      '\\usepackage[table,dvipsnames,svgnames]{xcolor}',
      '\\usepackage[color,loigiai]{ex_test}',
      '\\usepackage{amsmath,amssymb,physics}',
      '\\usepackage{tikz}',
      '\\usetikzlibrary{calc,angles,quotes,patterns}',
      '\\usepackage[top=1.5cm, bottom=1.8cm, left=1.5cm, right=1.5cm]{geometry}',
      '\\usepackage{array,booktabs,multirow,tabularx}',
      '',
      '\\graphicspath{{images/}{./}}',
      '',
      '\\begin{document}',
    ];
    if (hasHeaderFile) {
      lines.push('\t\\input{thong_tin_de.tex}', '');
    }
    lines.push(`\t\\input{${contentFilename}}`, '', '\\end{document}', '');
    return lines.join('\n');
  }

  const paperOpt =
    firstPage?.page_size === 'a5'
      ? 'a5paper'
      : firstPage?.page_size === 'letter'
      ? 'letterpaper'
      : 'a4paper';
  const landscapeOpt = firstPage?.is_landscape ? ',landscape' : '';
  const baseFont =
    typeof firstPage?.base_font_size_pt === 'number' && firstPage.base_font_size_pt <= 10.5
      ? '10pt'
      : typeof firstPage?.base_font_size_pt === 'number' && firstPage.base_font_size_pt <= 11.5
      ? '11pt'
      : '12pt';

  const geom = firstPage ? computePageGeometry(firstPage) : null;
  const ptToCm = (pt: number) => `${(pt / 28.3465).toFixed(2)}cm`;
  const geoOpts = geom
    ? `top=${ptToCm(clamp(geom.marginTopPt, 18, 144))},bottom=${ptToCm(
        clamp(geom.marginBottomPt, 18, 144)
      )},left=${ptToCm(clamp(geom.marginLeftPt, 18, 144))},right=${ptToCm(
        clamp(geom.marginRightPt, 18, 144)
      )}`
    : 'top=2cm,bottom=2cm,left=2cm,right=1.5cm';

  const lines: string[] = [
    '% Biên dịch bằng pdfLaTeX (TeXstudio / Overleaf) - Tài liệu LaTeX cơ bản',
    `\\documentclass[${baseFont},${paperOpt}${landscapeOpt}]{article}`,
    '\\usepackage[utf8]{vietnam}',
    '\\usepackage{amsmath,amssymb,amsfonts,mathrsfs}',
    '\\usepackage{graphicx}',
    '\\usepackage[table,dvipsnames,svgnames]{xcolor}',
    `\\usepackage[${geoOpts}]{geometry}`,
    '\\usepackage{enumitem}',
    '\\usepackage{array,booktabs,multirow,tabularx}',
    '\\usepackage{setspace}',
    '\\usepackage{hyperref}',
    '',
    '\\setlength{\\parindent}{0pt}',
    '\\setlength{\\parskip}{0pt}',
    '\\graphicspath{{images/}{./}}',
    '',
    '\\begin{document}',
    `\\input{${contentFilename}}`,
    '\\end{document}',
    '',
  ];

  return lines.join('\n');
}

function generateBasicLatexFiles(
  pages: PageExtraction[],
  registry: ImageRegistry,
  addPageBreaks: boolean
): Array<{ path: string; content: string }> {
  const pageChunks: string[] = [];

  for (const page of pages) {
    const geom = computePageGeometry(page);
    const bands = groupBlocksIntoVisualBands(page.blocks, geom);
    const bandChunks: string[] = [];

    for (let bIdx = 0; bIdx < bands.length; bIdx++) {
      const band = bands[bIdx];
      const vspacePrefix =
        bIdx > 0 && band.spaceBeforePt > 2.5
          ? `\\vspace{${Math.round(band.spaceBeforePt * 10) / 10}pt}\n`
          : '';

      if (band.kind === 'sideBySide') {
        const leftFrac = clamp(band.leftWidthPct / 100 - 0.02, 0.22, 0.74).toFixed(2);
        const rightFrac = clamp(band.rightWidthPct / 100 - 0.02, 0.22, 0.74).toFixed(2);
        const leftTex = renderSingleBlockBasicLatex(band.left, page, registry, { inContainer: true });
        const rightTex = renderSingleBlockBasicLatex(band.right, page, registry, { inContainer: true });
        if (leftTex || rightTex) {
          bandChunks.push(
            vspacePrefix +
              [
                `\\noindent\\begin{minipage}[t]{${leftFrac}\\textwidth}`,
                leftTex || ' ',
                '\\end{minipage}\\hfill',
                `\\begin{minipage}[t]{${rightFrac}\\textwidth}`,
                rightTex || ' ',
                '\\end{minipage}',
              ].join('\n')
          );
        }
      } else {
        const tex = renderSingleBlockBasicLatex(band.block, page, registry, {
          inContainer: false,
          indentLeftPt: band.indentLeftPt,
          indentRightPt: band.indentRightPt,
          firstLineIndentPt: band.firstLineIndentPt,
        });
        if (tex) bandChunks.push(`${vspacePrefix}${tex}`);
      }
    }

    if (bandChunks.length > 0) {
      pageChunks.push(bandChunks.join('\n\n'));
    }
  }

  const bodyContent = pageChunks.join(addPageBreaks ? '\n\n\\newpage\n\n' : '\n\n');
  const mainTex = buildMainPreamble(pages, false, false, false, 'noi_dung.tex');

  return [
    { path: 'main.tex', content: mainTex },
    { path: 'noi_dung.tex', content: bodyContent ? `${bodyContent}\n` : '% Tài liệu trống\n' },
  ];
}

// ---------- EX_TEST EXAM FORMATTER ----------

type FlatBandEntry = { band: VisualBand; page: PageExtraction; geom: PageGeometry };

interface ParsedChoiceOption {
  contentLatex: string;
  isTrue: boolean;
  isTF: boolean;
}

function stripLeadingMarkerFromSegments(
  segments: InlineSegment[],
  pattern: RegExp
): InlineSegment[] {
  const cloned = segments.map((s) => ({ ...s }));
  let leadingText = '';
  let leadingTextSegCount = 0;
  for (let i = 0; i < cloned.length; i++) {
    if (cloned[i].type !== 'text') break;
    leadingText += cloned[i].content ?? '';
    leadingTextSegCount += 1;
  }

  const m = leadingText.match(pattern);
  if (!m) {
    return cloned.filter((s) => s.type === 'math' || (s.content ?? '').length > 0);
  }

  let toConsume = m[0].length;
  for (let i = 0; i < leadingTextSegCount && toConsume > 0; i++) {
    const content = cloned[i].content ?? '';
    if (content.length <= toConsume) {
      toConsume -= content.length;
      cloned[i].content = '';
    } else {
      cloned[i].content = content.slice(toConsume);
      toConsume = 0;
    }
  }

  return cloned.filter((s) => s.type === 'math' || (s.content ?? '').length > 0);
}

function isOptionUnderlined(segs: InlineSegment[]): boolean {
  for (const s of segs) {
    if (s.underline) return true;
    const content = (s.content ?? '').trim();
    if (/^\\underline\s*\{/.test(content)) return true;
  }
  return false;
}

function findExclusiveColorIndex(cells: InlineSegment[][]): number {
  const coloredFlags = cells.map((segs) => {
    const nonSpace = segs.filter((s) => (s.content ?? '').trim().length > 0);
    if (nonSpace.length === 0) return false;
    return Boolean(normalizeHexColor(nonSpace[0].color));
  });
  const trueCount = coloredFlags.filter(Boolean).length;
  return trueCount === 1 ? coloredFlags.findIndex(Boolean) : -1;
}

function unwrapOuterUnderlineCommand(raw: string): string {
  const trimmed = raw.trim();
  const m = trimmed.match(/^\\underline\s*\{([\s\S]*)\}$/);
  if (!m) return raw;
  // Verify the opening brace at the end of \underline{ matches the final }
  const openIdx = trimmed.indexOf('{');
  let depth = 0;
  for (let i = openIdx; i < trimmed.length; i++) {
    if (trimmed[i] === '\\') {
      i += 1;
      continue;
    }
    if (trimmed[i] === '{') depth += 1;
    else if (trimmed[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return i === trimmed.length - 1 ? m[1].trim() : raw;
      }
    }
  }
  return raw;
}

function stripTrailingChoicePeriod(latex: string): string {
  let s = latex.trim();
  if (!s) return s;

  // Preserve ellipsis (\ldots, \dots, \cdots, or ...)
  if (/(?:\.\.\.|\\(?:ldots|dots|cdots)(?:\{\})?)\s*$/.test(s)) {
    return s;
  }

  // Case 1: trailing '.' outside math/braces (e.g. "$x = 2$.", "Hàm số đồng biến.", "12 .")
  if (/(?<!\.)\.$/.test(s)) {
    s = s.slice(0, -1).trimEnd();
    if (!s) return '~';
    return s;
  }

  // Case 2: trailing '.' immediately before closing '$' (e.g. "$12.$" -> "$12$")
  if (/(?<!\.)\.\$$/.test(s) && !/(?:\.\.\.|\\(?:ldots|dots|cdots))\$$/.test(s)) {
    const inner = s.slice(0, -2).trimEnd();
    return inner && !inner.endsWith('$') ? `${inner}$` : inner || '~';
  }

  // Case 3: trailing '.' inside closing formatting/color/math braces (e.g. "\textbf{Sai.}", "\textcolor[HTML]{DC2626}{$12.$}")
  const braceMatch = s.match(/^(.*?)(?<!\.)\.(\s*\$?\s*\}+)$/);
  if (braceMatch && !/(?:\.\.\.|\\(?:ldots|dots|cdots))$/.test(braceMatch[1])) {
    const body = braceMatch[1].trimEnd();
    const closes = braceMatch[2].replace(/^\s+/, '');
    return body ? `${body}${closes}` : '~';
  }

  return s;
}

function extractChoicesFromCells(
  cellSegLists: InlineSegment[][],
  baseFontPt: number,
  forceTF = false,
  explicitCorrectFlags?: boolean[]
): ParsedChoiceOption[] | null {
  if (cellSegLists.length !== 4) return null;
  const plainTexts = cellSegLists.map((segs) => segs.map((s) => s.content ?? '').join('').trim());
  const isLowerTF = plainTexts.every((t) => /^[a-d][\.\)\:]/.test(t));
  const isUpperABCD = plainTexts.every((t) => /^[A-D][\.\)\:]/.test(t));
  if (!isLowerTF && !isUpperABCD) return null;
  const isTF = forceTF || isLowerTF;

  const underlinedFlags = cellSegLists.map((segs) => isOptionUnderlined(segs));
  const anyUnderlined = underlinedFlags.some(Boolean);
  const anyExplicitCorrect = Boolean(explicitCorrectFlags?.some(Boolean));
  const exclusiveColorIdx =
    anyUnderlined || anyExplicitCorrect ? -1 : findExclusiveColorIndex(cellSegLists);

  return cellSegLists.map((segs, idx) => {
    const isUnderlined = underlinedFlags[idx];
    let cleaned = stripLeadingMarkerFromSegments(segs, /^\s*[A-Da-d][\.\)\:]\s*/);

    if (isUnderlined) {
      const nonSpaceBody = cleaned.filter(
        (s) => (s.content ?? '').trim().length > 0 && !/^\s*\.\s*$/.test(s.content ?? '')
      );
      const allBodyUnderlined =
        nonSpaceBody.length > 0 &&
        nonSpaceBody.every((s) => Boolean(s.underline) || /^\\underline\s*\{/.test((s.content ?? '').trim()));
      const labelWasUnderlined =
        segs.some((s) => Boolean(s.underline) && /^[A-Da-d][\.\)\:]?$/.test((s.content ?? '').trim())) ||
        Boolean(segs[0]?.underline);

      if (allBodyUnderlined || labelWasUnderlined) {
        cleaned = cleaned.map((s) => {
          const next = { ...s, underline: false };
          if (typeof next.content === 'string' && /^\\underline\s*\{/.test(next.content.trim())) {
            next.content = unwrapOuterUnderlineCommand(next.content);
          }
          return next;
        });
      }
    }

    let contentLatex = segmentsToCompilableLatex(cleaned, { inTableCell: true, baseFontPt }) || '~';
    const explicitTrue = /\\True\b/.test(contentLatex);
    if (explicitTrue) {
      contentLatex = contentLatex.replace(/\\True\s*/g, '').trim();
    }
    contentLatex = stripTrailingChoicePeriod(contentLatex) || '~';

    return {
      contentLatex,
      isTrue:
        explicitTrue ||
        Boolean(explicitCorrectFlags?.[idx]) ||
        isUnderlined ||
        idx === exclusiveColorIdx,
      isTF,
    };
  });
}

function extractPartialChoiceSegsFromBand(
  entry: FlatBandEntry
): Array<{ segments: InlineSegment[]; isCorrect?: boolean }> | null {
  if (entry.band.kind !== 'single') return null;
  const blk = entry.band.block;

  if (blk.block_type === 'table' && blk.table_rows && isChoiceTableBlock(blk)) {
    const flatCells: TableCellData[] = [];
    for (const row of blk.table_rows) {
      for (const cell of row) {
        if ((cell.segments ?? []).some((s) => (s.content ?? '').trim().length > 0)) {
          flatCells.push(cell);
        }
      }
    }
    if (flatCells.length === 0 || flatCells.length > 4) return null;
    const allChoices = flatCells.every((c) => hasLeadingChoiceLabel(c.segments));
    return allChoices
      ? flatCells.map((c) => ({ segments: c.segments ?? [], isCorrect: c.is_correct }))
      : null;
  }

  if (blk.block_type === 'paragraph' && blk.segments) {
    const groups = splitSegmentsIntoChoiceGroups(blk.segments);
    if (groups && groups.length >= 2 && groups.length <= 4) {
      const allChoices = groups.every((g) => hasLeadingChoiceLabel(g));
      if (allChoices) return groups.map((g) => ({ segments: g }));
    }
    if (isChoiceParagraph(blk)) {
      return [{ segments: blk.segments }];
    }
  }

  return null;
}

function tryConsumeFourChoices(
  examBands: FlatBandEntry[],
  startIdx: number,
  forceTF = false
): { choices: ParsedChoiceOption[]; nextIdx: number } | null {
  const collected: Array<{ segments: InlineSegment[]; isCorrect?: boolean }> = [];
  let k = startIdx;
  while (k < examBands.length && collected.length < 4) {
    const part = extractPartialChoiceSegsFromBand(examBands[k]);
    if (!part || collected.length + part.length > 4) break;
    collected.push(...part);
    k += 1;
  }
  if (collected.length !== 4) return null;
  const choices = extractChoicesFromCells(
    collected.map((c) => c.segments),
    examBands[startIdx].page.base_font_size_pt ?? 12,
    forceTF,
    collected.map((c) => Boolean(c.isCorrect))
  );
  if (!choices) return null;
  return { choices, nextIdx: k };
}

const QUESTION_PREFIX_RE = /^\s*(Câu|Bài|Ví\s*dụ)\s+(\d+)\s*[.:)]?\s*/i;
const PART_HEADING_RE =
  /^\s*(?:PHẦN\s+(?:I|II|III|IV|V|1|2|3|4)|(?:I|II|III|IV|V)\.\s+(?:CÂU\s+)?(?:TRẮC\s+NGHIỆM|ĐÚNG|TRẢ\s+LỜI|TỰ\s+LUẬN|BÀI\s+TẬP)|(?:A|B|C)\.\s+(?:TRẮC\s+NGHIỆM|TỰ\s+LUẬN))\b/i;
const SOLUTION_START_RE = /^\s*(?:Lời\s+giải|Hướng\s+dẫn\s+giải|Giải)\s*[.:]?\s*/i;
const SHORT_ANSWER_RE = /^\s*(?:Đáp\s+án|Đáp\s+số|Trả\s+lời)\s*[:.]\s*/i;
const PART_INSTRUCTION_HINT_RE = /\b(?:Thí\s+sinh|Mỗi\s+câu\s+hỏi|Điền\s+kết\s+quả|Phần\s+Thí\s+sinh)\b/i;
const SUBITEM_ALPHA_RE = /^\s*[a-z]\)\s+/i;

type ExamSectionType = 'choice' | 'tf' | 'short' | 'essay' | null;

function inferSectionTypeFromTitle(plain: string): ExamSectionType {
  if (/TỰ\s+LUẬN|BÀI\s+TẬP\s+TỰ\s+LUẬN|\b(?:PHẦN\s+(?:IV|4)|IV\.)\b/i.test(plain)) return 'essay';
  if (/TRẢ\s+LỜI\s+NGẮN|\b(?:PHẦN\s+(?:III|3)|III\.)\b/i.test(plain)) return 'short';
  if (/ĐÚNG\s*[-–—\/]?\s*SAI|\b(?:PHẦN\s+(?:II|2)|II\.)\b/i.test(plain)) return 'tf';
  if (/NHIỀU\s+PHƯƠNG\s+ÁN|TRẮC\s+NGHIỆM|\b(?:PHẦN\s+(?:I|1)|I\.)\b/i.test(plain)) return 'choice';
  return null;
}

function unwrapOuterBoldCommand(tex: string): string {
  const t = tex.trim();
  const m = t.match(/^\\textbf\{([\s\S]*)\}$/);
  if (!m) return t;
  const openIdx = t.indexOf('{');
  let depth = 0;
  for (let i = openIdx; i < t.length; i++) {
    if (t[i] === '\\') {
      i += 1;
      continue;
    }
    if (t[i] === '{') depth += 1;
    else if (t[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return i === t.length - 1 ? m[1].trim() : t;
      }
    }
  }
  return t;
}

function splitPartHeadingSegments(
  segments: InlineSegment[]
): { titleSegs: InlineSegment[]; instrSegs: InlineSegment[] } {
  const plainAll = segments.map((s) => s.content ?? '').join('');
  const splitMatch = plainAll.match(/(?:\s+(?:Phần\s+)?(?=Thí\s+sinh\b|Mỗi\s+câu\b|Điền\s+kết\s+quả\b))/i);
  if (!splitMatch || splitMatch.index === undefined) {
    return { titleSegs: segments, instrSegs: [] };
  }

  const splitPos = splitMatch.index;
  const titleSegs: InlineSegment[] = [];
  const instrSegs: InlineSegment[] = [];
  let cursor = 0;

  for (const seg of segments) {
    const content = seg.content ?? '';
    const nextCursor = cursor + content.length;
    if (nextCursor <= splitPos) {
      titleSegs.push({ ...seg });
    } else if (cursor >= splitPos) {
      instrSegs.push({ ...seg });
    } else {
      const cut = splitPos - cursor;
      const left = content.slice(0, cut);
      const right = content.slice(cut);
      if (left) titleSegs.push({ ...seg, content: left });
      if (right) instrSegs.push({ ...seg, content: right });
    }
    cursor = nextCursor;
  }

  // Clean stray OCR "Phần " right before "Thí sinh..." and trailing "|"
  const firstInstrText = instrSegs.find((s) => s.type === 'text' && s.content.trim().length > 0);
  if (firstInstrText) {
    firstInstrText.content = firstInstrText.content.replace(/^\s*(?:Phần\s+)?/i, '');
  }
  while (instrSegs.length > 0 && instrSegs[0].type === 'text' && !instrSegs[0].content.trim()) {
    instrSegs.shift();
  }
  if (instrSegs.length > 0) {
    const last = instrSegs[instrSegs.length - 1];
    if (last.type === 'text') {
      last.content = last.content.replace(/\|\s*$/, '').trimEnd();
    }
  }

  return { titleSegs, instrSegs };
}

function normalizeShortAnswerValue(rawLatex: string): string {
  let s = rawLatex.trim();
  // Remove trailing period or pipe
  s = stripTrailingChoicePeriod(s.replace(/\|\s*$/, '').trim());
  // Collapse OCR digit spaces like "1 0" -> "10", "$1 0$" -> "10"
  const unwrapMath = s.match(/^\$([^$]+)\$$/);
  const candidate = unwrapMath ? unwrapMath[1].trim() : s;
  if (/^-?\d+(?:\s+\d+)+$/.test(candidate)) {
    return candidate.replace(/\s+/g, '');
  }
  if (/^-?\d+(?:[.,]\d+)?$/.test(candidate)) {
    return candidate;
  }
  return s;
}

function indentExBodyLines(lines: string[]): string {
  return lines
    .join('\n')
    .split('\n')
    .map((ln) => (ln.trim() ? `\t${ln}` : ''))
    .join('\n');
}

function formatLoigiaiBlock(solutionLines: string[]): string {
  if (solutionLines.length === 0) {
    return '\t\\loigiai{\n\n\t}';
  }
  const inner = solutionLines
    .join('\n\n')
    .split('\n')
    .map((ln) => (ln.trim() ? `\t\t${ln}` : ''))
    .join('\n');
  return `\t\\loigiai{\n${inner}\n\t}`;
}

function formatSubItemsEnumerate(itemBodies: string[]): string {
  const rows = itemBodies.map((body) => `\t\\item ${body}`);
  return ['\\begin{enumerate}[a)]', ...rows, '\\end{enumerate}'].join('\n');
}

function detectQuestionStart(entry: FlatBandEntry): {
  kind: 'ex' | 'bt' | 'vd';
  num: number;
  sideBySideFigure?: DocumentBlock;
  stemBlock: DocumentBlock;
} | null {
  const { band } = entry;
  const candidateBlock = band.kind === 'sideBySide' ? band.left : band.block;
  if (candidateBlock.block_type !== 'paragraph' && candidateBlock.block_type !== 'heading') {
    return null;
  }
  const plain = getBlockPlainText(candidateBlock);
  const m = plain.match(QUESTION_PREFIX_RE);
  if (!m) return null;

  const word = m[1].toLowerCase().replace(/\s+/g, '');
  const kind: 'ex' | 'bt' | 'vd' =
    word === 'bài' ? 'bt' : word === 'vídụ' ? 'vd' : 'ex';
  const num = parseInt(m[2], 10);

  const strippedSegs = stripLeadingMarkerFromSegments(
    candidateBlock.segments ?? [],
    QUESTION_PREFIX_RE
  );
  const stemBlock: DocumentBlock = {
    ...candidateBlock,
    block_type: 'paragraph',
    segments: strippedSegs,
  };

  if (band.kind === 'sideBySide' && band.right.block_type === 'figure') {
    return { kind, num, stemBlock, sideBySideFigure: band.right };
  }
  return { kind, num, stemBlock };
}

function isPartHeadingBand(entry: FlatBandEntry): boolean {
  if (entry.band.kind !== 'single') return false;
  const blk = entry.band.block;
  if (blk.block_type !== 'heading' && blk.block_type !== 'paragraph') return false;
  const plain = getBlockPlainText(blk);
  return PART_HEADING_RE.test(plain);
}

function generateExTestFiles(
  pages: PageExtraction[],
  registry: ImageRegistry
): { files: Array<{ path: string; content: string }>; hasSolutions: boolean } {
  const flatBands: FlatBandEntry[] = [];
  for (const page of pages) {
    const geom = computePageGeometry(page);
    const bands = groupBlocksIntoVisualBands(page.blocks, geom);
    for (const band of bands) {
      flatBands.push({ band, page, geom });
    }
  }

  // Find index where exam body starts (first PHẦN ... or first Câu/Bài/Ví dụ or first question+choice pair)
  let bodyStartIdx = flatBands.length;
  for (let i = 0; i < flatBands.length; i++) {
    if (isPartHeadingBand(flatBands[i]) || detectQuestionStart(flatBands[i])) {
      bodyStartIdx = i;
      break;
    }
  }

  // Fallback if questions had no "Câu N." label (unlabeled stems before choice blocks)
  if (bodyStartIdx === flatBands.length) {
    for (let i = 0; i < flatBands.length; i++) {
      const b = flatBands[i].band;
      if (b.kind === 'single' && (isChoiceTableBlock(b.block) || isChoiceParagraph(b.block))) {
        bodyStartIdx = Math.max(0, i - 1);
        break;
      }
    }
  }

  const headerBands = flatBands.slice(0, bodyStartIdx);
  const examBands = flatBands.slice(bodyStartIdx);

  const renderEntryBasic = (entry: FlatBandEntry): string => {
    const { band, page } = entry;
    if (band.kind === 'sideBySide') {
      const leftFrac = clamp(band.leftWidthPct / 100 - 0.02, 0.22, 0.74).toFixed(2);
      const rightFrac = clamp(band.rightWidthPct / 100 - 0.02, 0.22, 0.74).toFixed(2);
      const leftTex = renderSingleBlockBasicLatex(band.left, page, registry, { inContainer: true });
      const rightTex = renderSingleBlockBasicLatex(band.right, page, registry, { inContainer: true });
      return [
        `\\noindent\\begin{minipage}[t]{${leftFrac}\\textwidth}`,
        leftTex || ' ',
        '\\end{minipage}\\hfill',
        `\\begin{minipage}[t]{${rightFrac}\\textwidth}`,
        rightTex || ' ',
        '\\end{minipage}',
      ].join('\n');
    }
    return renderSingleBlockBasicLatex(band.block, page, registry, { inContainer: false });
  };

  // Render header using tabular* for borderless multi-column exam headers and \hrule
  const headerParts: string[] = [];
  let headerHasRule = false;
  for (const hEntry of headerBands) {
    if (hEntry.band.kind === 'single') {
      const blk = hEntry.band.block;
      if (blk.block_type === 'horizontal_rule') {
        headerHasRule = true;
        headerParts.push('\\vspace{0.2cm}\n\\hrule\n\\vspace{0.4cm}');
        continue;
      }
      if (
        blk.block_type === 'table' &&
        blk.table_borderless &&
        !isChoiceTableBlock(blk) &&
        (blk.table_rows?.[0]?.length ?? 0) >= 2
      ) {
        const tblTex = renderExamHeaderTableLatex(blk, hEntry.page, registry);
        if (tblTex) headerParts.push(tblTex);
        continue;
      }
    }
    const part = renderEntryBasic(hEntry);
    if (part) headerParts.push(part);
  }
  if (headerParts.length > 0 && !headerHasRule) {
    headerParts.push('\\vspace{0.2cm}\n\\hrule\n\\vspace{0.4cm}');
  }

  const hasHeaderFile = headerParts.length > 0;
  const headerContent = headerParts.join('\n\n');

  const bodyParts: string[] = [];
  let hasSolutions = false;
  let currentSectionType: ExamSectionType = null;
  let emittedShowAnsBt = false;
  let isFirstPart = true;
  const lastCounterByKind: Record<'ex' | 'bt' | 'vd', number> = { ex: 0, bt: 0, vd: 0 };

  let i = 0;
  while (i < examBands.length) {
    const entry = examBands[i];

    // 1. Section / Part heading (PHẦN I, PHẦN II, PHẦN III, PHẦN IV, ...)
    if (isPartHeadingBand(entry)) {
      const blk = (entry.band as Extract<VisualBand, { kind: 'single' }>).block;
      const baseFontPt = entry.page.base_font_size_pt ?? 12;
      const { titleSegs, instrSegs } = splitPartHeadingSegments(blk.segments ?? []);

      let titleTex = unwrapOuterBoldCommand(
        segmentsToCompilableLatex(titleSegs, { baseFontPt })
      ).replace(/\.\s*$/, '').trim();
      const plainTitle = titleSegs.map((s) => s.content ?? '').join('').trim();
      const detectedSec = inferSectionTypeFromTitle(plainTitle);
      if (detectedSec) currentSectionType = detectedSec;

      let instrTex =
        instrSegs.length > 0
          ? segmentsToCompilableLatex(instrSegs, { baseFontPt })
              .replace(/^\\textit\{([\s\S]*)\}$/, '$1')
              .trim()
          : '';

      // Check if next block is a standalone instruction paragraph (e.g. "Thí sinh trả lời...")
      if (!instrTex && i + 1 < examBands.length && examBands[i + 1].band.kind === 'single') {
        const nextBlk = (examBands[i + 1].band as Extract<VisualBand, { kind: 'single' }>).block;
        const nextPlain = getBlockPlainText(nextBlk);
        if (
          nextBlk.block_type === 'paragraph' &&
          !isPartHeadingBand(examBands[i + 1]) &&
          !detectQuestionStart(examBands[i + 1]) &&
          PART_INSTRUCTION_HINT_RE.test(nextPlain)
        ) {
          instrTex = segmentsToCompilableLatex(nextBlk.segments, {
            baseFontPt: examBands[i + 1].page.base_font_size_pt ?? 12,
          })
            .replace(/\|\s*$/, '')
            .replace(/^\\textit\{([\s\S]*)\}$/, '$1')
            .trim();
          i += 1;
        }
      }

      const sectionLines: string[] = [];
      if (!isFirstPart) {
        sectionLines.push('\\vspace{0.4cm}');
      }
      isFirstPart = false;

      if (titleTex) {
        if (instrTex) {
          sectionLines.push(`\\noindent\\textbf{\\large ${titleTex}} \\\\`);
          sectionLines.push(`\\textit{${instrTex}}`);
        } else {
          sectionLines.push(`\\noindent\\textbf{\\large ${titleTex}}`);
        }
        sectionLines.push('\\vspace{0.2cm}');
      }

      if (currentSectionType === 'essay' && !emittedShowAnsBt) {
        sectionLines.push('', '\\showansEX{bt}');
        emittedShowAnsBt = true;
      }

      if (sectionLines.length > 0) {
        bodyParts.push(sectionLines.join('\n'));
      }
      i += 1;
      continue;
    }

    // 2. Essay section standalone sub-items a), b), c) without preceding Câu/Bài label
    if (
      currentSectionType === 'essay' &&
      !detectQuestionStart(entry) &&
      entry.band.kind === 'single' &&
      entry.band.block.block_type === 'paragraph' &&
      SUBITEM_ALPHA_RE.test(getBlockPlainText(entry.band.block))
    ) {
      const subItems: string[] = [];
      const solutionLines: string[] = [];
      let inSolution = false;
      let j = i;

      while (j < examBands.length) {
        const cur = examBands[j];
        if (isPartHeadingBand(cur) || detectQuestionStart(cur)) break;
        if (
          cur.band.kind === 'single' &&
          /^\s*[-—–]*\s*HẾT\s*[-—–]*\s*$/i.test(getBlockPlainText(cur.band.block))
        ) {
          break;
        }
        const curPlain = cur.band.kind === 'single' ? getBlockPlainText(cur.band.block) : '';
        if (!inSolution && cur.band.kind === 'single' && SOLUTION_START_RE.test(curPlain)) {
          inSolution = true;
          hasSolutions = true;
          const strippedSol = stripLeadingMarkerFromSegments(
            cur.band.block.segments ?? [],
            SOLUTION_START_RE
          );
          const solTex = segmentsToCompilableLatex(strippedSol, {
            baseFontPt: cur.page.base_font_size_pt ?? 12,
          });
          if (solTex) solutionLines.push(solTex);
          j += 1;
          continue;
        }
        if (inSolution) {
          const solTex = renderEntryBasic(cur);
          if (solTex) solutionLines.push(solTex);
          j += 1;
          continue;
        }
        if (
          cur.band.kind === 'single' &&
          cur.band.block.block_type === 'paragraph' &&
          SUBITEM_ALPHA_RE.test(curPlain)
        ) {
          const strippedItem = stripLeadingMarkerFromSegments(
            cur.band.block.segments ?? [],
            SUBITEM_ALPHA_RE
          );
          const itemTex = segmentsToCompilableLatex(strippedItem, {
            baseFontPt: cur.page.base_font_size_pt ?? 12,
          });
          if (itemTex) subItems.push(itemTex);
          j += 1;
          continue;
        }
        break;
      }

      if (subItems.length > 0) {
        const btLines = [
          '\\begin{bt}',
          indentExBodyLines([formatSubItemsEnumerate(subItems)]),
          formatLoigiaiBlock(solutionLines),
          '\\end{bt}',
        ];
        bodyParts.push(btLines.join('\n'));
        i = j;
        continue;
      }
    }

    // 3. Explicit question environment (Câu N., Bài N., Ví dụ N.)
    const qStart = detectQuestionStart(entry);
    if (qStart) {
      const rawKind = qStart.kind;
      const kind: 'ex' | 'bt' | 'vd' =
        currentSectionType === 'essay' && rawKind === 'ex' ? 'bt' : rawKind;
      const { num, stemBlock, sideBySideFigure } = qStart;
      const baseFontPt = entry.page.base_font_size_pt ?? 12;

      if (num === 1 && lastCounterByKind[kind] >= 1) {
        bodyParts.push(`\\setcounter{${kind}}{0}`);
      }
      lastCounterByKind[kind] = num;

      const stemLines: string[] = [];
      const essaySubItems: string[] = [];
      const firstStemTex = segmentsToCompilableLatex(stemBlock.segments, { baseFontPt });

      if (sideBySideFigure) {
        const figTex = renderFigureLatex(sideBySideFigure, entry.page, registry, {
          inContainer: true,
          wrapAlign: false,
        });
        stemLines.push(`\\immini{${firstStemTex || '~'}}{${figTex}}`);
      } else if (firstStemTex) {
        stemLines.push(firstStemTex);
      }

      let choices: ParsedChoiceOption[] | null = null;
      let shortAnswerTex: string | null = null;
      const solutionLines: string[] = [];
      let inSolution = false;

      let j = i + 1;
      while (j < examBands.length) {
        const nextEntry = examBands[j];
        if (isPartHeadingBand(nextEntry) || detectQuestionStart(nextEntry)) {
          break;
        }

        // Stop if hitting trailing "--- HẾT ---"
        if (
          nextEntry.band.kind === 'single' &&
          /^\s*[-—–]*\s*HẾT\s*[-—–]*\s*$/i.test(getBlockPlainText(nextEntry.band.block))
        ) {
          break;
        }

        const nextPlain =
          nextEntry.band.kind === 'single' ? getBlockPlainText(nextEntry.band.block) : '';

        // Check solution start
        if (!inSolution && nextEntry.band.kind === 'single' && SOLUTION_START_RE.test(nextPlain)) {
          inSolution = true;
          hasSolutions = true;
          const strippedSol = stripLeadingMarkerFromSegments(
            nextEntry.band.block.segments ?? [],
            SOLUTION_START_RE
          );
          const solTex = segmentsToCompilableLatex(strippedSol, {
            baseFontPt: nextEntry.page.base_font_size_pt ?? 12,
          });
          if (solTex) solutionLines.push(solTex);
          j += 1;
          continue;
        }

        if (inSolution) {
          const solTex = renderEntryBasic(nextEntry);
          if (solTex) solutionLines.push(solTex);
          j += 1;
          continue;
        }

        // Check short answer line (explicit label OR single A. <num> / bare number inside short section)
        if (!shortAnswerTex && nextEntry.band.kind === 'single') {
          if (SHORT_ANSWER_RE.test(nextPlain)) {
            const strippedSa = stripLeadingMarkerFromSegments(
              nextEntry.band.block.segments ?? [],
              SHORT_ANSWER_RE
            ).map((s) => (s.type === 'text' ? { ...s, bold: false } : s));
            const saTex = segmentsToCompilableLatex(strippedSa, {
              baseFontPt: nextEntry.page.base_font_size_pt ?? 12,
            });
            if (saTex) shortAnswerTex = normalizeShortAnswerValue(saTex);
            j += 1;
            continue;
          }

          if (
            currentSectionType === 'short' &&
            nextEntry.band.block.block_type === 'paragraph' &&
            (/^\s*[A-Da-d][\.\)]\s*\S+/.test(nextPlain) ||
              /^\s*-?\d+(?:[.,\s]+\d+)*\s*$/.test(nextPlain))
          ) {
            const strippedSa = stripLeadingMarkerFromSegments(
              nextEntry.band.block.segments ?? [],
              /^\s*[A-Da-d][\.\)]\s*/
            ).map((s) => (s.type === 'text' ? { ...s, bold: false } : s));
            const saTex = segmentsToCompilableLatex(strippedSa, {
              baseFontPt: nextEntry.page.base_font_size_pt ?? 12,
            });
            if (saTex) {
              shortAnswerTex = normalizeShortAnswerValue(saTex);
              j += 1;
              continue;
            }
          }
        }

        // Essay sub-items a), b), c) inside \begin{bt}...\end{bt}
        if (
          kind === 'bt' &&
          nextEntry.band.kind === 'single' &&
          nextEntry.band.block.block_type === 'paragraph' &&
          SUBITEM_ALPHA_RE.test(nextPlain)
        ) {
          const strippedItem = stripLeadingMarkerFromSegments(
            nextEntry.band.block.segments ?? [],
            SUBITEM_ALPHA_RE
          );
          const itemTex = segmentsToCompilableLatex(strippedItem, {
            baseFontPt: nextEntry.page.base_font_size_pt ?? 12,
          });
          if (itemTex) essaySubItems.push(itemTex);
          j += 1;
          continue;
        }

        // Check choices across 1..4 consecutive blocks (table, paragraph, or mixed table + paragraph)
        if (!choices && nextEntry.band.kind === 'single' && currentSectionType !== 'short' && currentSectionType !== 'essay') {
          const consumed = tryConsumeFourChoices(examBands, j, currentSectionType === 'tf');
          if (consumed) {
            choices = consumed.choices;
            j = consumed.nextIdx;
            continue;
          }
        }

        // Otherwise belongs to stem (extra paragraph, equation, figure, table)
        if (
          !sideBySideFigure &&
          stemLines.length === 1 &&
          nextEntry.band.kind === 'single' &&
          nextEntry.band.block.block_type === 'figure'
        ) {
          const figTex = renderFigureLatex(nextEntry.band.block, nextEntry.page, registry, {
            inContainer: false,
            wrapAlign: true,
          });
          if (figTex) stemLines.push(figTex);
        } else {
          const extraTex = renderEntryBasic(nextEntry);
          if (extraTex) stemLines.push(extraTex);
        }
        j += 1;
      }

      const envInnerLines: string[] = [];
      if (stemLines.length > 0) {
        envInnerLines.push(stemLines.join('\n\n'));
      }
      if (essaySubItems.length > 0) {
        envInnerLines.push(formatSubItemsEnumerate(essaySubItems));
      }

      if (choices) {
        const isTF = choices.some((c) => c.isTF);
        const macro = isTF ? '\\choiceTF' : '\\choice';
        envInnerLines.push(macro);
        for (const opt of choices) {
          const prefix = opt.isTrue ? '\\True ' : '';
          envInnerLines.push(`{${prefix}${opt.contentLatex}}`);
        }
      }

      if (shortAnswerTex) {
        envInnerLines.push(`\\par\\shortans{${shortAnswerTex}}`);
      }

      const envLines: string[] = [`\\begin{${kind}}`];
      if (envInnerLines.length > 0) {
        envLines.push(indentExBodyLines(envInnerLines));
      }
      envLines.push(formatLoigiaiBlock(solutionLines));
      envLines.push(`\\end{${kind}}`);
      bodyParts.push(envLines.join('\n'));
      i = j;
      continue;
    }

    // 4. Unlabeled stem paragraph followed immediately by a 4-choice sequence
    if (
      entry.band.kind === 'single' &&
      entry.band.block.block_type === 'paragraph' &&
      i + 1 < examBands.length
    ) {
      const consumed = tryConsumeFourChoices(examBands, i + 1, currentSectionType === 'tf');
      if (consumed) {
        const tblChoices = consumed.choices;
        const stemTex = segmentsToCompilableLatex(entry.band.block.segments, {
          baseFontPt: entry.page.base_font_size_pt ?? 12,
        });
        const isTF = tblChoices.some((c) => c.isTF);
        const inner = [
          stemTex || '~',
          isTF ? '\\choiceTF' : '\\choice',
          ...tblChoices.map((o) => `{${o.isTrue ? '\\True ' : ''}${o.contentLatex}}`),
        ];
        const envLines = [
          '\\begin{ex}',
          indentExBodyLines(inner),
          formatLoigiaiBlock([]),
          '\\end{ex}',
        ];
        bodyParts.push(envLines.join('\n'));
        i = consumed.nextIdx;
        continue;
      }
    }

    // 4. Standalone note / instruction / footer
    const standaloneTex = renderEntryBasic(entry);
    if (standaloneTex) {
      bodyParts.push(standaloneTex);
    }
    i += 1;
  }

  const mainTex = buildMainPreamble(pages, true, hasSolutions, hasHeaderFile, 'de_thi.tex');
  const files: Array<{ path: string; content: string }> = [
    { path: 'main.tex', content: mainTex },
  ];

  if (hasHeaderFile) {
    files.push({ path: 'thong_tin_de.tex', content: `${headerContent}\n` });
  }
  files.push({
    path: 'de_thi.tex',
    content: bodyParts.length > 0 ? `${bodyParts.join('\n\n')}\n` : '% Chưa có nội dung đề thi\n',
  });

  return { files, hasSolutions };
}

export function buildLatexProjectFiles(
  pages: PageExtraction[],
  options: LatexZipBuildOptions = {}
): LatexProjectResult {
  const { format = 'auto', addPageBreaks = true } = options;
  const isExamDetected = detectIsExamDocument(pages);
  const mode: 'basic' | 'ex_test' =
    format === 'ex_test'
      ? 'ex_test'
      : format === 'basic'
      ? 'basic'
      : isExamDetected
      ? 'ex_test'
      : 'basic';

  const registry = collectAllImages(pages);

  if (mode === 'ex_test') {
    const { files, hasSolutions } = generateExTestFiles(pages, registry);
    return {
      mode,
      isExamDetected,
      hasSolutions,
      files,
      images: registry.list,
    };
  }

  const files = generateBasicLatexFiles(pages, registry, addPageBreaks);
  return {
    mode,
    isExamDetected,
    hasSolutions: false,
    files,
    images: registry.list,
  };
}

function decodeBase64ToUint8Array(dataUrl: string): Uint8Array {
  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function normalizePagesForZipImages(
  pages: PageExtraction[],
  convertedMap: Map<string, string>
): PageExtraction[] {
  if (convertedMap.size === 0) return pages;

  const mapBlock = (blk: DocumentBlock): DocumentBlock => {
    let next = blk;
    if (blk.block_type === 'figure' && blk.croppedImageDataUrl) {
      const mappedUrl = convertedMap.get(blk.croppedImageDataUrl);
      if (mappedUrl) {
        next = { ...next, croppedImageDataUrl: mappedUrl };
      }
    }
    if (blk.table_rows) {
      let changed = false;
      const nextRows = blk.table_rows.map((row) =>
        row.map((cell) => {
          if (!Array.isArray(cell.blocks) || cell.blocks.length === 0) return cell;
          changed = true;
          return { ...cell, blocks: cell.blocks.map(mapBlock) };
        })
      );
      if (changed) {
        next = { ...next, table_rows: nextRows };
      }
    }
    return next;
  };

  return pages.map((pg) => ({
    ...pg,
    blocks: pg.blocks.map(mapBlock),
  }));
}

export async function buildLatexZipBlob(
  pages: PageExtraction[],
  options: LatexZipBuildOptions = {}
): Promise<LatexZipArchiveResult> {
  const rawRegistry = collectAllImages(pages);
  const convertedMap = new Map<string, string>();

  if (options.convertImageToPng) {
    for (const img of rawRegistry.list) {
      if (
        img.dataUrl.startsWith('data:image/svg+xml') ||
        img.dataUrl.startsWith('data:image/webp')
      ) {
        const pngDataUrl = await options.convertImageToPng(img.dataUrl, img.widthPx, img.heightPx);
        if (pngDataUrl && pngDataUrl.startsWith('data:image/png')) {
          convertedMap.set(img.dataUrl, pngDataUrl);
        }
      }
    }
  }

  const normalizedPages = normalizePagesForZipImages(pages, convertedMap);
  const project = buildLatexProjectFiles(normalizedPages, options);

  const zip = new JSZip();
  for (const file of project.files) {
    zip.file(file.path, file.content);
  }

  // Always create the images/ directory in the zip archive
  const imagesFolder = zip.folder('images');
  for (const img of project.images) {
    const bytes = decodeBase64ToUint8Array(img.dataUrl);
    if (imagesFolder) {
      imagesFolder.file(img.filename, bytes);
    } else {
      zip.file(img.zipPath, bytes);
    }
  }

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const safeBase = (options.filename || 'tai_lieu_toan')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_') || 'tai_lieu_toan';
  const modeSuffix = project.mode === 'ex_test' ? 'ex_test' : 'LaTeX';

  return {
    blob,
    zipFileName: `${safeBase}_${modeSuffix}.zip`,
    mode: project.mode,
    isExamDetected: project.isExamDetected,
    hasSolutions: project.hasSolutions,
    imageCount: project.images.length,
    fileCount: project.files.length,
  };
}
