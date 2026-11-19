import type {
  ChoiceLayoutMode,
  DocumentBlock,
  InlineSegment,
  PageExtraction,
  TableCellData,
} from '../types/document.ts';

export interface PageGeometry {
  pageWidthPt: number;
  pageHeightPt: number;
  pageWidthTwips: number;
  pageHeightTwips: number;
  marginTopPt: number;
  marginRightPt: number;
  marginBottomPt: number;
  marginLeftPt: number;
  marginTopTwips: number;
  marginRightTwips: number;
  marginBottomTwips: number;
  marginLeftTwips: number;
  contentWidthPt: number;
  contentWidthTwips: number;
  isLandscape: boolean;
}

export type VisualBand =
  | {
      kind: 'single';
      block: DocumentBlock;
      spaceBeforePt: number;
      indentLeftPt: number;
      indentRightPt: number;
      firstLineIndentPt: number;
    }
  | {
      kind: 'sideBySide';
      left: DocumentBlock;
      right: DocumentBlock;
      leftWidthPct: number;
      rightWidthPct: number;
      spaceBeforePt: number;
      indentLeftPt: number;
      indentRightPt: number;
    };

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function cleanLatexDelimiters(raw: string): string {
  let s = (raw ?? '').trim();
  if (s.startsWith('$$') && s.endsWith('$$') && s.length >= 4) {
    s = s.slice(2, -2).trim();
  } else if (s.startsWith('$') && s.endsWith('$') && s.length >= 2) {
    s = s.slice(1, -1).trim();
  } else if (
    (s.startsWith('\\[') && s.endsWith('\\]')) ||
    (s.startsWith('\\(') && s.endsWith('\\)'))
  ) {
    s = s.slice(2, -2).trim();
  }
  return s;
}

export function isValidBox(box?: number[] | null): box is [number, number, number, number] {
  return (
    Array.isArray(box) &&
    box.length === 4 &&
    box.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    box[2] > box[0] &&
    box[3] > box[1]
  );
}

export function computePageGeometry(page: PageExtraction): PageGeometry {
  const wPx = page.pageWidthPx ?? 1240;
  const hPx = page.pageHeightPx ?? 1754;
  const isLandscape =
    typeof page.is_landscape === 'boolean' ? page.is_landscape : wPx > hPx;
  const aspect = wPx / Math.max(1, hPx);

  const a4Aspect = isLandscape ? 11.69 / 8.27 : 8.27 / 11.69;
  const letterAspect = isLandscape ? 11 / 8.5 : 8.5 / 11;
  const useLetter =
    page.page_size === 'letter' ||
    (page.page_size !== 'a4' &&
      page.page_size !== 'a5' &&
      Math.abs(aspect - letterAspect) < Math.abs(aspect - a4Aspect));

  let portraitW = useLetter ? 612 : 595.3;
  let portraitH = useLetter ? 792 : 841.9;
  if (page.page_size === 'a5') {
    portraitW = 419.5;
    portraitH = 595.3;
  }

  const pageWidthPt = isLandscape ? portraitH : portraitW;
  const pageHeightPt = isLandscape ? portraitW : portraitH;

  let minY = Infinity;
  let minX = Infinity;
  let maxY = -Infinity;
  let maxX = -Infinity;
  let hasAnyBox = false;

  for (const blk of page.blocks) {
    if (!isValidBox(blk.box_2d)) continue;
    hasAnyBox = true;
    const [ymin, xmin, ymax, xmax] = blk.box_2d;
    if (ymin < minY) minY = ymin;
    if (xmin < minX) minX = xmin;
    if (ymax > maxY) maxY = ymax;
    if (xmax > maxX) maxX = xmax;
  }

  const defaultMarginPt = 54;
  const explicitLeft =
    typeof page.margin_left_pt === 'number' && Number.isFinite(page.margin_left_pt)
      ? clamp(page.margin_left_pt, 14, 180)
      : null;
  const explicitRight =
    typeof page.margin_right_pt === 'number' && Number.isFinite(page.margin_right_pt)
      ? clamp(page.margin_right_pt, 14, 180)
      : null;
  const explicitTop =
    typeof page.margin_top_pt === 'number' && Number.isFinite(page.margin_top_pt)
      ? clamp(page.margin_top_pt, 14, 180)
      : null;
  const explicitBottom =
    typeof page.margin_bottom_pt === 'number' && Number.isFinite(page.margin_bottom_pt)
      ? clamp(page.margin_bottom_pt, 14, 180)
      : null;

  const marginLeftPt =
    explicitLeft !== null
      ? explicitLeft
      : hasAnyBox
      ? clamp((minX / 1000) * pageWidthPt, 24, 96)
      : defaultMarginPt;
  const marginRightPt =
    explicitRight !== null
      ? explicitRight
      : hasAnyBox
      ? clamp(((1000 - maxX) / 1000) * pageWidthPt, 24, 96)
      : defaultMarginPt;
  const marginTopPt =
    explicitTop !== null
      ? explicitTop
      : hasAnyBox
      ? clamp((minY / 1000) * pageHeightPt, 24, 96)
      : defaultMarginPt;
  const marginBottomPt =
    explicitBottom !== null
      ? explicitBottom
      : hasAnyBox
      ? clamp(((1000 - maxY) / 1000) * pageHeightPt, 28, 96)
      : defaultMarginPt;

  const pageWidthTwips = Math.round(pageWidthPt * 20);
  const pageHeightTwips = Math.round(pageHeightPt * 20);
  const marginTopTwips = Math.round(marginTopPt * 20);
  const marginRightTwips = Math.round(marginRightPt * 20);
  const marginBottomTwips = Math.round(marginBottomPt * 20);
  const marginLeftTwips = Math.round(marginLeftPt * 20);

  return {
    pageWidthPt,
    pageHeightPt,
    pageWidthTwips,
    pageHeightTwips,
    marginTopPt,
    marginRightPt,
    marginBottomPt,
    marginLeftPt,
    marginTopTwips,
    marginRightTwips,
    marginBottomTwips,
    marginLeftTwips,
    contentWidthPt: pageWidthPt - marginLeftPt - marginRightPt,
    contentWidthTwips: pageWidthTwips - marginLeftTwips - marginRightTwips,
    isLandscape,
  };
}

const CHOICE_LABEL_REGEX = /^[A-Da-d][\.\)\:](\s|$)/;

export function hasLeadingChoiceLabel(segs?: InlineSegment[] | null): boolean {
  if (!segs || segs.length === 0) return false;
  const plain = segs
    .map((s) => s.content ?? '')
    .join('')
    .trim();
  if (CHOICE_LABEL_REGEX.test(plain)) return true;

  let textPrefix = '';
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].type === 'math') {
      return /^[A-Da-d][\.\)\:]$/.test(textPrefix.trim());
    }
    textPrefix += segs[i].content ?? '';
    if (textPrefix.trim().length > 4) break;
  }
  return false;
}

export function isChoiceTableBlock(blk: DocumentBlock): boolean {
  if (blk.block_type !== 'table' || !blk.table_rows || blk.table_rows.length === 0) return false;
  // Tuyệt đối không phá vỡ bảng có khung viền, bảng có tiêu đề, bảng booktabs/box, bảng lồng khối hoặc bảng có ô gộp cột (col_span)
  if (blk.table_borderless !== true) return false;
  if (blk.table_style === 'box' || blk.table_style === 'booktabs' || blk.table_style === 'grid') {
    return false;
  }

  const hasHeaderMergedOrNested = blk.table_rows.some((row) =>
    row.some(
      (c) =>
        c.is_header === true ||
        (c.col_span ?? 1) > 1 ||
        (Array.isArray(c.blocks) && c.blocks.length > 0)
    )
  );
  if (hasHeaderMergedOrNested) return false;

  let choiceCellCount = 0;
  for (const row of blk.table_rows) {
    for (const cell of row) {
      if (hasLeadingChoiceLabel(cell.segments)) {
        choiceCellCount++;
      }
    }
  }
  if (choiceCellCount >= 2) return true;
  return Boolean(blk.is_choice_block) && choiceCellCount >= 1;
}

function sliceSegmentsByTextRanges(
  segments: InlineSegment[],
  splitOffsets: number[]
): InlineSegment[][] {
  if (splitOffsets.length === 0) return [segments.map((s) => ({ ...s, tab_before: false }))];

  const sorted = Array.from(new Set(splitOffsets.filter((n) => n > 0))).sort((a, b) => a - b);
  const groups: InlineSegment[][] = [];
  let current: InlineSegment[] = [];
  let cursor = 0;
  let splitIdx = 0;

  for (const seg of segments) {
    const content = seg.content ?? '';
    if (seg.type !== 'text') {
      while (splitIdx < sorted.length && cursor >= sorted[splitIdx]) {
        groups.push(current);
        current = [];
        splitIdx += 1;
      }
      current.push({ ...seg, tab_before: false });
      cursor += content.length;
      continue;
    }

    let localOffset = 0;
    while (localOffset < content.length) {
      const nextSplit = splitIdx < sorted.length ? sorted[splitIdx] : Infinity;
      const segEndGlobal = cursor + content.length;
      if (nextSplit <= cursor) {
        groups.push(current);
        current = [];
        splitIdx += 1;
        continue;
      }
      if (nextSplit < segEndGlobal) {
        const cut = nextSplit - cursor;
        const part = content.slice(localOffset, cut);
        if (part.length > 0) {
          current.push({ ...seg, content: part, tab_before: false });
        }
        groups.push(current);
        current = [];
        localOffset = cut;
        splitIdx += 1;
      } else {
        const part = content.slice(localOffset);
        if (part.length > 0) {
          current.push({ ...seg, content: part, tab_before: false });
        }
        break;
      }
    }
    cursor += content.length;
  }

  groups.push(current);

  return groups
    .map((g) => {
      const cloned = g.map((s) => ({ ...s }));
      while (cloned.length > 0 && cloned[0].type === 'text') {
        const trimmed = cloned[0].content.trimStart();
        if (trimmed.length === 0) {
          cloned.shift();
        } else {
          cloned[0].content = trimmed;
          break;
        }
      }
      while (cloned.length > 0 && cloned[cloned.length - 1].type === 'text') {
        const last = cloned[cloned.length - 1];
        const trimmed = last.content.trimEnd();
        if (trimmed.length === 0) {
          cloned.pop();
        } else {
          last.content = trimmed;
          break;
        }
      }
      return cloned;
    })
    .filter((g) => g.length > 0);
}

export function splitSegmentsIntoChoiceGroups(segments: InlineSegment[]): InlineSegment[][] | null {
  if (!segments || segments.length === 0) return null;

  const hasTabs = segments.some((s) => s.tab_before);
  let initialGroups: InlineSegment[][];
  if (hasTabs) {
    initialGroups = [];
    let current: InlineSegment[] = [];
    for (const seg of segments) {
      if (seg.tab_before && current.length > 0) {
        initialGroups.push(current);
        current = [{ ...seg, tab_before: false }];
      } else {
        current.push({ ...seg, tab_before: false });
      }
    }
    if (current.length > 0) initialGroups.push(current);
  } else {
    initialGroups = [segments];
  }

  // Further split each group if it contains multi-space or newline separated choice labels across runs
  const finalGroups: InlineSegment[][] = [];
  for (const grp of initialGroups) {
    let fullPlain = '';
    const isTextRanges: Array<{ start: number; end: number; isText: boolean }> = [];
    for (const seg of grp) {
      const len = (seg.content ?? '').length;
      isTextRanges.push({ start: fullPlain.length, end: fullPlain.length + len, isText: seg.type === 'text' });
      fullPlain += seg.content ?? '';
    }

    const splitOffsets: number[] = [];
    const markerRe = /(\n|\s{2,})([A-Da-d][\.\)\:])(?=\s|$)/g;
    let m: RegExpExecArray | null;
    while ((m = markerRe.exec(fullPlain)) !== null) {
      const labelPos = m.index + m[1].length;
      const insideMath = isTextRanges.some((r) => !r.isText && labelPos >= r.start && labelPos < r.end);
      if (!insideMath && labelPos > 0) {
        splitOffsets.push(labelPos);
      }
    }

    if (splitOffsets.length > 0) {
      finalGroups.push(...sliceSegmentsByTextRanges(grp, splitOffsets));
    } else {
      finalGroups.push(grp.map((s) => ({ ...s, tab_before: false })));
    }
  }

  const choiceCount = finalGroups.filter((g) => hasLeadingChoiceLabel(g)).length;

  return finalGroups.length >= 2 && choiceCount >= 2 ? finalGroups : null;
}

function computeTabStopsForColCount(
  colCount: number,
  availWidthPt: number,
  indentLeftPt: number,
  widthPcts?: number[] | null
): number[] {
  if (colCount <= 1) return [];

  if (widthPcts && widthPcts.length === colCount) {
    const sum = widthPcts.reduce((a, b) => a + b, 0);
    if (sum > 0) {
      const stops: number[] = [];
      let acc = indentLeftPt;
      for (let c = 0; c < colCount - 1; c++) {
        const colW = clamp((widthPcts[c] / sum) * availWidthPt, availWidthPt * 0.14, availWidthPt * 0.72);
        acc += colW;
        stops.push(Math.round(acc * 10) / 10);
      }
      return stops;
    }
  }

  const step = availWidthPt / colCount;
  const stops: number[] = [];
  for (let c = 1; c < colCount; c++) {
    stops.push(Math.round((indentLeftPt + step * c) * 10) / 10);
  }
  return stops;
}

function convertChoiceTableToTabParagraphs(
  blk: DocumentBlock,
  geom: PageGeometry
): DocumentBlock[] {
  const rows = blk.table_rows ?? [];
  if (rows.length === 0) return [blk];

  const box = isValidBox(blk.box_2d) ? blk.box_2d : null;
  const { indentLeftPt, indentRightPt } = computeBlockHorizontalOffsets(blk, geom);
  const availWidthPt = Math.max(140, geom.contentWidthPt - indentLeftPt - indentRightPt);

  const out: DocumentBlock[] = [];
  const totalRows = rows.length;

  rows.forEach((row, rIdx) => {
    const colCount = row.length;
    const widthPcts = row.every((c) => typeof c.width_pct === 'number' && (c.width_pct ?? 0) > 0)
      ? row.map((c) => c.width_pct as number)
      : null;

    const tabStopsPt = computeTabStopsForColCount(colCount, availWidthPt, indentLeftPt, widthPcts);
    const mergedSegments: InlineSegment[] = [];

    row.forEach((cell, cIdx) => {
      const segs = (cell.segments ?? []).map((s) => ({ ...s, tab_before: false }));
      if (cIdx > 0) {
        if (segs.length > 0) {
          segs[0] = { ...segs[0], tab_before: true };
          mergedSegments.push(...segs);
        } else {
          mergedSegments.push({ type: 'text', content: '', tab_before: true });
        }
      } else {
        mergedSegments.push(...segs);
      }
    });

    let rowBox: number[] | null = null;
    if (box) {
      const totalH = box[2] - box[0];
      const stepH = totalH / totalRows;
      const y1 = Math.round(box[0] + rIdx * stepH);
      const y2 = Math.round(rIdx === totalRows - 1 ? box[2] : box[0] + (rIdx + 1) * stepH - 2);
      rowBox = [y1, box[1], Math.max(y1 + 4, y2), box[3]];
    }

    out.push({
      block_type: 'paragraph',
      alignment: 'left',
      segments: mergedSegments,
      box_2d: rowBox,
      font_size_pt: blk.font_size_pt,
      line_spacing: blk.line_spacing,
      indent_left_pt: indentLeftPt > 0 ? indentLeftPt : blk.indent_left_pt,
      first_line_indent_pt: 0,
      tab_stops_pt: tabStopsPt,
      is_choice_block: true,
    });
  });

  return out;
}

function convertChoiceParagraphToTable(blk: DocumentBlock): DocumentBlock | null {
  const segs = blk.segments ?? [];
  if (segs.length === 0) return null;
  const groups = splitSegmentsIntoChoiceGroups(segs);
  if (!groups || groups.length < 2) return null;

  let rows: TableCellData[][];
  if (groups.length === 4 && groups.every((g) => !g.some((s) => s.content.includes('\n')))) {
    rows = [
      groups.map((g) => ({
        segments: g,
        alignment: 'left' as const,
        width_pct: 25,
      })),
    ];
  } else if (groups.length === 4) {
    rows = [
      [
        { segments: groups[0], alignment: 'left', width_pct: 50 },
        { segments: groups[1], alignment: 'left', width_pct: 50 },
      ],
      [
        { segments: groups[2], alignment: 'left', width_pct: 50 },
        { segments: groups[3], alignment: 'left', width_pct: 50 },
      ],
    ];
  } else {
    const pct = Math.round((100 / groups.length) * 10) / 10;
    rows = [
      groups.map((g) => ({
        segments: g,
        alignment: 'left' as const,
        width_pct: pct,
      })),
    ];
  }

  return {
    block_type: 'table',
    alignment: 'left',
    table_borderless: true,
    is_choice_block: true,
    table_rows: rows,
    box_2d: blk.box_2d,
    font_size_pt: blk.font_size_pt,
    line_spacing: blk.line_spacing,
    indent_left_pt: blk.indent_left_pt,
  };
}

function estimateMathWidthPt(latex: string, fontSizePt: number): number {
  let s = latex.trim();
  // Collapse innermost \frac{a}{b} / \dfrac{a}{b} / \tfrac{a}{b} to wider branch
  for (let pass = 0; pass < 4; pass++) {
    const next = s.replace(
      /\\(?:d|t)?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g,
      (_m, a: string, b: string) => (a.length >= b.length ? a : b) + ' '
    );
    if (next === s) break;
    s = next;
  }
  s = s
    .replace(/\\(?:left|right|displaystyle|textstyle|scriptstyle|nolimits|limits)\b/g, '')
    .replace(/\\sqrt(?:\s*\[[^\]]*\])?\s*\{([^{}]*)\}/g, '√$1 ')
    .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\mathbb\{([A-Z])\}/g, '$1')
    .replace(/\\[a-zA-Z]+/g, 'M')
    .replace(/[{}\^_\\]/g, '');
  return Math.max(fontSizePt * 0.6, s.length * fontSizePt * 0.56 + 4);
}

function estimateSegmentsWidthPt(segments: InlineSegment[], fontSizePt: number): number {
  let maxLineW = 0;
  let curLineW = 0;
  for (const seg of segments) {
    const sz = seg.font_size_pt ?? fontSizePt;
    if (seg.type === 'math') {
      curLineW += estimateMathWidthPt(seg.content ?? '', sz);
    } else {
      const lines = (seg.content ?? '').split('\n');
      const factor = seg.bold ? 0.56 : 0.50;
      lines.forEach((line, idx) => {
        if (idx > 0) {
          if (curLineW > maxLineW) maxLineW = curLineW;
          curLineW = 0;
        }
        curLineW += line.length * sz * factor;
      });
    }
  }
  return Math.max(maxLineW, curLineW);
}

function reflowChoiceTableIfNeeded(blk: DocumentBlock, geom: PageGeometry): DocumentBlock {
  if (!isChoiceTableBlock(blk) || !blk.table_rows || blk.table_rows.length === 0) return blk;
  const rows = blk.table_rows;
  const currentCols = Math.max(...rows.map((r) => r.length));
  if (currentCols <= 1) return blk;

  const { indentLeftPt, indentRightPt } = computeBlockHorizontalOffsets(blk, geom);
  const availWidthPt = Math.max(140, geom.contentWidthPt - indentLeftPt - indentRightPt);
  const fontSizePt = blk.font_size_pt ?? 12;

  const cells = rows.flat();
  if (cells.length === 0) return blk;

  const maxCellW = Math.max(
    ...cells.map((c) => estimateSegmentsWidthPt(c.segments ?? [], fontSizePt))
  );
  const colAvail = availWidthPt / currentCols - 10;
  const allowTolerance = blk.preserve_col_count ? 1.38 : 1.0;
  if (maxCellW <= colAvail * allowTolerance) return blk;

  const twoColAvail = availWidthPt / 2 - 12;
  if (cells.length === 4 && currentCols >= 3 && maxCellW <= twoColAvail) {
    return {
      ...blk,
      table_rows: [
        [
          { ...cells[0], width_pct: 50 },
          { ...cells[1], width_pct: 50 },
        ],
        [
          { ...cells[2], width_pct: 50 },
          { ...cells[3], width_pct: 50 },
        ],
      ],
    };
  }

  if (currentCols > 2 && cells.length % 2 === 0 && maxCellW <= twoColAvail) {
    const newRows: TableCellData[][] = [];
    for (let k = 0; k < cells.length; k += 2) {
      newRows.push([
        { ...cells[k], width_pct: 50 },
        { ...cells[k + 1], width_pct: 50 },
      ]);
    }
    return { ...blk, table_rows: newRows };
  }

  return {
    ...blk,
    table_rows: cells.map((c) => [{ ...c, width_pct: 100 }]),
  };
}

function ensureTabStopsOnChoiceParagraph(
  blk: DocumentBlock,
  geom: PageGeometry
): DocumentBlock[] {
  if (blk.block_type !== 'paragraph' || !blk.segments || blk.segments.length === 0) return [blk];
  if (Array.isArray(blk.tab_stop_specs) && blk.tab_stop_specs.length > 0) return [blk];
  const groups = splitSegmentsIntoChoiceGroups(blk.segments);
  if (!groups || groups.length < 2) return [blk];

  const { indentLeftPt, indentRightPt } = computeBlockHorizontalOffsets(blk, geom);
  const availWidthPt = Math.max(140, geom.contentWidthPt - indentLeftPt - indentRightPt);
  const fontSizePt = blk.font_size_pt ?? 12;
  const maxGroupW = Math.max(...groups.map((g) => estimateSegmentsWidthPt(g, fontSizePt)));

  if (maxGroupW > availWidthPt / groups.length - 10) {
    const asTable = convertChoiceParagraphToTable(blk);
    if (asTable) {
      const reflowed = reflowChoiceTableIfNeeded(asTable, geom);
      return convertChoiceTableToTabParagraphs(reflowed, geom);
    }
  }

  const hasExplicitTabs = blk.segments.some((s) => s.tab_before);
  if (hasExplicitTabs && Array.isArray(blk.tab_stops_pt) && blk.tab_stops_pt.length >= groups.length - 1) {
    return [blk];
  }

  const tabStopsPt = computeTabStopsForColCount(groups.length, availWidthPt, indentLeftPt, null);
  const mergedSegments: InlineSegment[] = [];
  groups.forEach((g, idx) => {
    const cleaned = g.map((s) => ({ ...s, tab_before: false }));
    if (idx > 0 && cleaned.length > 0) {
      cleaned[0] = { ...cleaned[0], tab_before: true };
    }
    mergedSegments.push(...cleaned);
  });

  return [
    {
      ...blk,
      segments: mergedSegments,
      tab_stops_pt: tabStopsPt,
      is_choice_block: true,
    },
  ];
}

function getCellPlainText(cell: TableCellData): string {
  return (cell.segments ?? [])
    .map((s) => s.content ?? '')
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeTableSpan(val?: number | null): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return 1;
  return Math.max(1, Math.min(20, Math.round(val)));
}

const SCORE_HEADER_RE =
  /^(?:điểm|thang\s*điểm|số\s*điểm|biểu\s*điểm|tỉ\s*lệ|tỷ\s*lệ|%|đáp\s*án|kết\s*quả|ghi\s*chú)$/i;
const SCORE_CELL_RE = /^\d+(?:[.,]\d+)?(?:\s*(?:đ|điểm|%))?$/i;
const INDEX_HEADER_RE =
  /^(?:bài|câu|stt|tt|phần|mục|chương|chủ\s*đề|ý|bước|lệnh|vấn\s*đề)$/i;
const INDEX_CELL_RE =
  /^(?:(?:bài|câu|phần|mục|ý|chương)\s*(?:\d+|[IVXLCDM]+|[a-zA-Z])(?:\.\d+)?[.:)]?|(?:\d+|[IVXLCDM]+)[.:)]?)$/i;
const CONTENT_HEADER_RE =
  /^(?:nội\s*dung|hướng\s*dẫn|lời\s*giải|yêu\s*cầu|diễn\s*giải|mô\s*tả|đề\s*bài|câu\s*hỏi|trả\s*lời|kiến\s*thức|nhiệm\s*vụ|chi\s*tiết)/i;

interface ColumnProfile {
  headerText: string;
  widthPct: number | null;
  bodyAlign: 'left' | 'center' | 'right' | 'justify' | null;
  avgBodyLen: number;
  isScoreCol: boolean;
  isIndexCol: boolean;
  isContentCol: boolean;
}

function buildColumnProfiles(rows: TableCellData[][], maxCols: number): ColumnProfile[] {
  const headerTexts: string[] = new Array(maxCols).fill('');
  const widthSamples: number[][] = Array.from({ length: maxCols }, () => []);
  const alignCounts: Array<Record<string, number>> = Array.from({ length: maxCols }, () => ({}));
  const bodyLens: number[][] = Array.from({ length: maxCols }, () => []);
  const bodyTexts: string[][] = Array.from({ length: maxCols }, () => []);

  rows.forEach((row, rIdx) => {
    const rowSpanSum = row.reduce((s, c) => s + safeTableSpan(c.col_span), 0);
    if (rowSpanSum !== maxCols) return;

    const allSingleWidth =
      row.length === maxCols &&
      row.every(
        (c) =>
          typeof c.width_pct === 'number' &&
          Number.isFinite(c.width_pct) &&
          (c.width_pct ?? 0) > 0 &&
          safeTableSpan(c.col_span) === 1
      );
    const widthSum = allSingleWidth
      ? row.reduce((s, c) => s + (c.width_pct ?? 0), 0)
      : 0;

    let colCursor = 0;
    for (const cell of row) {
      const span = safeTableSpan(cell.col_span);
      if (span === 1 && colCursor < maxCols) {
        const txt = getCellPlainText(cell);
        if (rIdx === 0 && !headerTexts[colCursor]) {
          headerTexts[colCursor] = txt;
        }
        if (allSingleWidth && widthSum > 0) {
          widthSamples[colCursor].push(((cell.width_pct ?? 0) / widthSum) * 100);
        }
        if (rIdx > 0 || rows.length === 1) {
          if (cell.alignment) {
            alignCounts[colCursor][cell.alignment] =
              (alignCounts[colCursor][cell.alignment] ?? 0) + 1;
          }
          if (txt.length > 0) {
            bodyLens[colCursor].push(txt.length);
            bodyTexts[colCursor].push(txt);
          }
        }
      }
      colCursor += span;
    }
  });

  return Array.from({ length: maxCols }, (_, c) => {
    const hTxt = headerTexts[c];
    const wList = widthSamples[c];
    const widthPct =
      wList.length > 0
        ? wList.slice().sort((a, b) => a - b)[Math.floor(wList.length / 2)]
        : null;

    let bodyAlign: ColumnProfile['bodyAlign'] = null;
    let bestAlignCnt = 0;
    for (const [k, cnt] of Object.entries(alignCounts[c])) {
      if (cnt > bestAlignCnt) {
        bestAlignCnt = cnt;
        bodyAlign = k as ColumnProfile['bodyAlign'];
      }
    }

    const lens = bodyLens[c];
    const avgBodyLen =
      lens.length > 0 ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
    const texts = bodyTexts[c];
    const scoreMatches = texts.filter((t) => SCORE_CELL_RE.test(t)).length;
    const indexMatches = texts.filter((t) => INDEX_CELL_RE.test(t)).length;

    const isScoreCol =
      SCORE_HEADER_RE.test(hTxt) ||
      (texts.length >= 1 &&
        scoreMatches / texts.length >= 0.65 &&
        !INDEX_HEADER_RE.test(hTxt) &&
        !CONTENT_HEADER_RE.test(hTxt));
    const isIndexCol =
      INDEX_HEADER_RE.test(hTxt) ||
      (c === 0 &&
        texts.length >= 1 &&
        indexMatches / texts.length >= 0.65 &&
        !SCORE_HEADER_RE.test(hTxt) &&
        !CONTENT_HEADER_RE.test(hTxt));
    const isContentCol =
      CONTENT_HEADER_RE.test(hTxt) ||
      (!isScoreCol &&
        !isIndexCol &&
        ((widthPct !== null && widthPct >= 42) || avgBodyLen >= 22));

    return {
      headerText: hTxt,
      widthPct,
      bodyAlign,
      avgBodyLen,
      isScoreCol,
      isIndexCol,
      isContentCol,
    };
  });
}

function scoreCellAtColumn(cell: TableCellData, colIdx: number, profile: ColumnProfile): number {
  const txt = getCellPlainText(cell);
  const len = txt.length;
  let score = 0;

  if (len === 0) {
    return 0;
  }

  // 1. Width similarity when both cell and profile have width_pct
  if (
    typeof cell.width_pct === 'number' &&
    Number.isFinite(cell.width_pct) &&
    cell.width_pct > 0 &&
    profile.widthPct !== null
  ) {
    const diff = Math.abs(cell.width_pct - profile.widthPct);
    if (diff <= 8) score += 6;
    else if (diff <= 18) score += 2;
    else score -= Math.min(10, diff / 6);
  }

  // 2. Numeric / score pattern
  const isScore = SCORE_CELL_RE.test(txt);
  if (isScore && profile.isScoreCol) score += 10;
  else if (isScore && profile.isContentCol && !profile.isScoreCol) score -= 7;
  else if (!isScore && len >= 14 && profile.isScoreCol) score -= 10;

  // 3. Index / question label pattern ("Bài 1", "Câu 2", "1", "I")
  const isIndex = INDEX_CELL_RE.test(txt);
  if (isIndex && profile.isIndexCol) score += 9;
  else if (isIndex && profile.isContentCol) score -= 5;
  else if (!isIndex && profile.isIndexCol) {
    if (len >= 16) score -= 10;
    else if (len >= 8) score -= 7;
    else if (/^[a-d]\)\s*/i.test(txt)) score -= 6;
  }

  // 4. Long content / prose placement
  if (len >= 15 && profile.isContentCol) score += 8;
  else if (len >= 8 && profile.isContentCol && !isScore && !isIndex) score += 4;
  if (len >= 10 && profile.widthPct !== null && profile.widthPct < 16) score -= 6;
  if (len >= 10 && profile.widthPct !== null && profile.widthPct >= 40) score += 4;

  // 5. Horizontal alignment match
  if (cell.alignment && profile.bodyAlign) {
    if (cell.alignment === profile.bodyAlign) {
      score += 2;
    } else if (
      (cell.alignment === 'center' && profile.bodyAlign === 'left') ||
      (cell.alignment === 'left' && profile.bodyAlign === 'center')
    ) {
      score -= 2;
    }
  }

  return score;
}

function alignShortRowToColumns(
  row: TableCellData[],
  maxCols: number,
  profiles: ColumnProfile[]
): TableCellData[] {
  const m = row.length;
  const spans = row.map((c) => safeTableSpan(c.col_span));
  const totalSpan = spans.reduce((a, b) => a + b, 0);
  if (totalSpan >= maxCols || m === 0 || maxCols > 12 || maxCols - totalSpan > 6) {
    return row;
  }

  // Compute default left-aligned slots and score
  const defaultSlots: number[] = [];
  let defCursor = 0;
  let defaultScore = 0;
  for (let i = 0; i < m; i++) {
    defaultSlots.push(defCursor);
    defaultScore += scoreCellAtColumn(row[i], defCursor, profiles[defCursor]) - 0.01 * defCursor;
    defCursor += spans[i];
  }

  let bestScore = -Infinity;
  let bestSlots: number[] = defaultSlots;
  const currentSlots: number[] = new Array(m).fill(0);

  const suffixSpan = new Array(m + 1).fill(0);
  for (let i = m - 1; i >= 0; i--) {
    suffixSpan[i] = suffixSpan[i + 1] + spans[i];
  }

  const dfs = (cellIdx: number, minSlot: number, accScore: number) => {
    if (cellIdx === m) {
      if (accScore > bestScore) {
        bestScore = accScore;
        bestSlots = currentSlots.slice();
      }
      return;
    }
    const maxSlot = maxCols - suffixSpan[cellIdx];
    const cell = row[cellIdx];
    const span = spans[cellIdx];
    for (let slot = minSlot; slot <= maxSlot; slot++) {
      currentSlots[cellIdx] = slot;
      const cellScore =
        span === 1
          ? scoreCellAtColumn(cell, slot, profiles[slot]) - 0.01 * slot
          : -0.01 * slot;
      dfs(cellIdx + 1, slot + span, accScore + cellScore);
    }
  };

  dfs(0, 0, 0);

  const changed = bestSlots.some((s, i) => s !== defaultSlots[i]);
  const chosenSlots = changed && bestScore > defaultScore + 1.5 ? bestSlots : defaultSlots;

  const aligned: TableCellData[] = [];
  let cursor = 0;
  for (let i = 0; i < m; i++) {
    const targetSlot = chosenSlots[i];
    while (cursor < targetSlot) {
      const prof = profiles[cursor];
      aligned.push({
        segments: [],
        alignment: prof?.bodyAlign ?? 'left',
        ...(prof?.widthPct ? { width_pct: Math.round(prof.widthPct * 10) / 10 } : {}),
      });
      cursor += 1;
    }
    aligned.push(row[i]);
    cursor += spans[i];
  }
  while (cursor < maxCols) {
    const prof = profiles[cursor];
    aligned.push({
      segments: [],
      alignment: prof?.bodyAlign ?? 'left',
      ...(prof?.widthPct ? { width_pct: Math.round(prof.widthPct * 10) / 10 } : {}),
    });
    cursor += 1;
  }

  return aligned;
}

export function normalizeTableBlockGrid(blk: DocumentBlock): DocumentBlock {
  if (blk.block_type !== 'table' || !blk.table_rows || blk.table_rows.length === 0) {
    return blk;
  }

  // First recursively normalize any nested table blocks inside cells
  let rows: TableCellData[][] = blk.table_rows.map((row) =>
    row.map((cell) => {
      if (Array.isArray(cell.blocks) && cell.blocks.length > 0) {
        return {
          ...cell,
          blocks: cell.blocks.map((b) =>
            b.block_type === 'table' ? normalizeTableBlockGrid(b) : b
          ),
        };
      }
      return { ...cell };
    })
  );

  let maxCols = Math.max(
    1,
    ...rows.map((r) => r.reduce((acc, c) => acc + safeTableSpan(c.col_span), 0))
  );

  // Pass 1: Expand explicit row_span > 1 into v_merge ('restart' / 'continue') placeholder cells
  const hasAnyRowSpan = rows.some((r) =>
    r.some((c) => typeof c.row_span === 'number' && c.row_span > 1)
  );
  if (hasAnyRowSpan && maxCols >= 2) {
    const activeSpans: Array<{
      remaining: number;
      alignment?: TableCellData['alignment'];
      width_pct?: number | null;
    }> = Array.from({ length: maxCols }, () => ({ remaining: 0 }));

    rows = rows.map((row) => {
      const rowSpanSum = row.reduce((acc, c) => acc + safeTableSpan(c.col_span), 0);
      const occupiedCols = activeSpans.reduce((acc, s) => acc + (s.remaining > 0 ? 1 : 0), 0);
      const needsInsertion = occupiedCols > 0 && rowSpanSum + occupiedCols <= maxCols;

      const outRow: TableCellData[] = [];
      let srcIdx = 0;
      let col = 0;

      while (col < maxCols) {
        if (activeSpans[col].remaining > 0) {
          if (needsInsertion) {
            outRow.push({
              segments: [],
              v_merge: 'continue',
              alignment: activeSpans[col].alignment ?? 'left',
              ...(activeSpans[col].width_pct ? { width_pct: activeSpans[col].width_pct } : {}),
            });
            activeSpans[col].remaining -= 1;
            col += 1;
            continue;
          } else if (srcIdx < row.length) {
            const existing = row[srcIdx];
            const span = safeTableSpan(existing.col_span);
            if (getCellPlainText(existing) === '' && span === 1) {
              outRow.push({ ...existing, v_merge: 'continue' });
              activeSpans[col].remaining -= 1;
              srcIdx += 1;
              col += 1;
              continue;
            }
          }
        }

        if (srcIdx >= row.length) break;
        const cell = { ...row[srcIdx++] };
        const span = safeTableSpan(cell.col_span);
        const rSpan =
          typeof cell.row_span === 'number' && Number.isFinite(cell.row_span)
            ? Math.max(1, Math.round(cell.row_span))
            : 1;
        if (rSpan > 1) {
          cell.v_merge = 'restart';
          for (let k = 0; k < span && col + k < maxCols; k++) {
            activeSpans[col + k] = {
              remaining: rSpan - 1,
              alignment: cell.alignment,
              width_pct: span === 1 ? cell.width_pct : null,
            };
          }
        }
        outRow.push(cell);
        col += span;
      }

      while (srcIdx < row.length) {
        outRow.push(row[srcIdx++]);
      }

      return outRow;
    });

    maxCols = Math.max(
      1,
      ...rows.map((r) => r.reduce((acc, c) => acc + safeTableSpan(c.col_span), 0))
    );
  }

  // Pass 2: Repair short rows where empty leading/middle cells were omitted (e.g. OCR skipped merged col 0)
  if (maxCols >= 2 && rows.length >= 2) {
    const hasShortRow = rows.some(
      (r) => r.reduce((acc, c) => acc + safeTableSpan(c.col_span), 0) < maxCols
    );
    if (hasShortRow) {
      const profiles = buildColumnProfiles(rows, maxCols);
      rows = rows.map((row) => {
        const spanSum = row.reduce((acc, c) => acc + safeTableSpan(c.col_span), 0);
        if (spanSum < maxCols) {
          return alignShortRowToColumns(row, maxCols, profiles);
        }
        return row;
      });
    }
  }

  // Pass 3: Sanitize orphaned v_merge='continue' (must have restart/continue directly above)
  const prevRowMergeAtCol: boolean[] = new Array(maxCols).fill(false);
  rows = rows.map((row) => {
    const nextMergeAtCol: boolean[] = new Array(maxCols).fill(false);
    let col = 0;
    const cleanedRow = row.map((cell) => {
      const span = safeTableSpan(cell.col_span);
      let nextCell = cell;
      if (cell.v_merge === 'continue' && !prevRowMergeAtCol[col]) {
        nextCell = { ...cell, v_merge: null };
      }
      if (nextCell.v_merge === 'restart' || nextCell.v_merge === 'continue') {
        for (let k = 0; k < span && col + k < maxCols; k++) {
          nextMergeAtCol[col + k] = true;
        }
      }
      col += span;
      return nextCell;
    });
    for (let k = 0; k < maxCols; k++) prevRowMergeAtCol[k] = nextMergeAtCol[k];
    return cleanedRow;
  });

  return {
    ...blk,
    table_rows: rows,
  };
}

export function normalizePagesTableGrids(pages: PageExtraction[]): PageExtraction[] {
  return pages.map((page) => ({
    ...page,
    blocks: page.blocks.map((blk) =>
      blk.block_type === 'table' ? normalizeTableBlockGrid(blk) : blk
    ),
  }));
}

export function computeSafeTableColPcts(
  rows: TableCellData[][],
  maxCols: number,
  availWidthPt: number,
  isBorderless: boolean
): number[] | null {
  if (maxCols <= 0 || rows.length === 0) return null;

  // Prefer a full row whose single-span cells all have valid width_pct
  const fullWidthRows = rows.filter(
    (r) =>
      r.length === maxCols &&
      r.every(
        (c) =>
          typeof c.width_pct === 'number' &&
          Number.isFinite(c.width_pct) &&
          (c.width_pct ?? 0) > 0 &&
          safeTableSpan(c.col_span) === 1
      )
  );
  if (fullWidthRows.length === 0) return null;

  // Use median per column across all rows with explicit widths for stability
  const normalizedRows = fullWidthRows.map((r) => {
    const sum = r.reduce((s, c) => s + (c.width_pct ?? 0), 0);
    return r.map((c) => ((c.width_pct ?? 0) / Math.max(1, sum)) * 100);
  });

  const colPcts = Array.from({ length: maxCols }, (_, c) => {
    const vals = normalizedRows.map((r) => r[c]).sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)];
  });

  const sumPct = colPcts.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(sumPct) || sumPct <= 0) return null;
  for (let c = 0; c < maxCols; c++) {
    colPcts[c] = (colPcts[c] / sumPct) * 100;
  }

  // For bordered tables, prevent narrow columns (e.g. "Bài", "Điểm", "0,25") from clipping single-token headers/numbers
  if (!isBorderless && maxCols >= 2 && availWidthPt > 120) {
    const minNeededPct = new Array(maxCols).fill(0);
    const cellPadPt = 16;

    for (let c = 0; c < maxCols; c++) {
      let maxTokenWidthPt = 0;
      for (let rIdx = 0; rIdx < rows.length; rIdx++) {
        const row = rows[rIdx];
        let col = 0;
        for (const cell of row) {
          const span = safeTableSpan(cell.col_span);
          if (col === c && span === 1) {
            const txt = getCellPlainText(cell);
            if (txt.length > 0 && txt.length <= 12) {
              const tokens = txt.split(/\s+/).filter(Boolean);
              const longestTok = tokens.reduce((m, t) => Math.max(m, t.length), 0);
              const estPt = longestTok * 6.4 + cellPadPt;
              if (estPt > maxTokenWidthPt) maxTokenWidthPt = estPt;
            }
          }
          col += span;
        }
      }
      if (maxTokenWidthPt > 0) {
        const capPct = Math.min(14, 100 / (maxCols + 0.5));
        minNeededPct[c] = Math.min(capPct, (maxTokenWidthPt / availWidthPt) * 100);
      }
    }

    let deficit = 0;
    const adjusted = colPcts.slice();
    for (let c = 0; c < maxCols; c++) {
      if (adjusted[c] < minNeededPct[c]) {
        deficit += minNeededPct[c] - adjusted[c];
        adjusted[c] = minNeededPct[c];
      }
    }

    if (deficit > 0) {
      const donorIndices = adjusted
        .map((pct, idx) => ({ idx, surplus: pct - Math.max(minNeededPct[idx], 22) }))
        .filter((d) => d.surplus > 1);
      const totalSurplus = donorIndices.reduce((s, d) => s + d.surplus, 0);
      if (totalSurplus > 0) {
        const take = Math.min(deficit, totalSurplus);
        for (const d of donorIndices) {
          adjusted[d.idx] -= take * (d.surplus / totalSurplus);
        }
        const finalSum = adjusted.reduce((a, b) => a + b, 0);
        return adjusted.map((p) => (p / finalSum) * 100);
      }
    }
  }

  return colPcts;
}

function applyUnderlineToChoiceCell(cell: TableCellData): TableCellData {
  if (!cell.is_correct || !cell.segments || cell.segments.length === 0) return cell;
  const firstIdx = cell.segments.findIndex((s) => s.type === 'text' && (s.content ?? '').length > 0);
  if (firstIdx !== 0) return cell;

  const firstSeg = cell.segments[0];
  const m = (firstSeg.content ?? '').match(/^(\s*)([A-Da-d])([\.\)\:][\s\S]*)$/);
  if (!m) return cell;

  const [, lead, letter, rest] = m;
  const nextSegments: InlineSegment[] = [];
  if (lead) {
    nextSegments.push({ ...firstSeg, content: lead, underline: false });
  }
  nextSegments.push({ ...firstSeg, content: letter, underline: true });
  if (rest) {
    nextSegments.push({ ...firstSeg, content: rest, underline: false });
  }
  nextSegments.push(...cell.segments.slice(1));

  return {
    ...cell,
    segments: nextSegments,
  };
}

function applyUnderlineToChoiceTable(blk: DocumentBlock): DocumentBlock {
  if (blk.block_type !== 'table' || !blk.table_rows) return blk;
  const hasAnyCorrect = blk.table_rows.some((row) => row.some((c) => c.is_correct));
  if (!hasAnyCorrect) return blk;
  return {
    ...blk,
    table_rows: blk.table_rows.map((row) => row.map(applyUnderlineToChoiceCell)),
  };
}

export function transformBlocksForChoiceLayout(
  blocks: DocumentBlock[],
  choiceLayout: ChoiceLayoutMode,
  geom: PageGeometry,
  underlineCorrectChoice = false
): DocumentBlock[] {
  const result: DocumentBlock[] = [];

  for (const rawBlk of blocks) {
    const blk = rawBlk.block_type === 'table' ? normalizeTableBlockGrid(rawBlk) : rawBlk;

    if (blk.block_type === 'table' && blk.table_rows && blk.table_rows.some((r) => r.some((c) => c.blocks && c.blocks.length > 0))) {
      const transformedRows = blk.table_rows.map((row) => {
        const totalPct = row.reduce((s, c) => s + (c.width_pct ?? 0), 0) || 100;
        return row.map((cell) => {
          if (!cell.blocks || cell.blocks.length === 0) return cell;
          const frac = cell.width_pct && cell.width_pct > 0 ? cell.width_pct / totalPct : 1 / Math.max(1, row.length);
          const cellContentWidthPt = Math.max(110, geom.contentWidthPt * frac - 12);
          const cellGeom: PageGeometry = {
            ...geom,
            contentWidthPt: cellContentWidthPt,
            contentWidthTwips: Math.round(cellContentWidthPt * 20),
          };
          return {
            ...cell,
            blocks: transformBlocksForChoiceLayout(
              cell.blocks,
              choiceLayout,
              cellGeom,
              underlineCorrectChoice
            ),
          };
        });
      });
      result.push({ ...blk, table_rows: transformedRows });
      continue;
    }

    if (choiceLayout === 'tabs') {
      if (isChoiceTableBlock(blk)) {
        const prepared = underlineCorrectChoice ? applyUnderlineToChoiceTable(blk) : blk;
        const reflowed = reflowChoiceTableIfNeeded(prepared, geom);
        result.push(...convertChoiceTableToTabParagraphs(reflowed, geom));
        continue;
      }
      if (blk.block_type === 'paragraph') {
        result.push(...ensureTabStopsOnChoiceParagraph(blk, geom));
        continue;
      }
    } else if (choiceLayout === 'table') {
      if (isChoiceTableBlock(blk)) {
        const prepared = underlineCorrectChoice ? applyUnderlineToChoiceTable(blk) : blk;
        result.push(reflowChoiceTableIfNeeded(prepared, geom));
        continue;
      }
      if (blk.block_type === 'paragraph') {
        const asTable = convertChoiceParagraphToTable(blk);
        if (asTable) {
          result.push(reflowChoiceTableIfNeeded(asTable, geom));
          continue;
        }
      }
    }

    result.push(blk);
  }

  return result;
}

export function groupSegmentsByTabs(segments: InlineSegment[]): InlineSegment[][] {
  const groups: InlineSegment[][] = [];
  let current: InlineSegment[] = [];
  for (const seg of segments) {
    if (seg.tab_before) {
      groups.push(current);
      current = [{ ...seg, tab_before: false }];
    } else {
      current.push(seg);
    }
  }
  groups.push(current);
  return groups;
}

function computeBlockHorizontalOffsets(
  blk: DocumentBlock,
  geom: PageGeometry
): { indentLeftPt: number; indentRightPt: number; firstLineIndentPt: number } {
  const box = isValidBox(blk.box_2d) ? blk.box_2d : null;
  let indentLeftPt = 0;
  let indentRightPt = 0;

  if (typeof blk.indent_left_pt === 'number' && Number.isFinite(blk.indent_left_pt)) {
    indentLeftPt = clamp(blk.indent_left_pt, 0, geom.contentWidthPt * 0.65);
  } else if (
    box &&
    (blk.alignment === 'left' || blk.alignment === 'justify' || blk.block_type === 'horizontal_rule')
  ) {
    const rawOffset = (box[1] / 1000) * geom.pageWidthPt - geom.marginLeftPt;
    if (rawOffset > 3) {
      indentLeftPt = clamp(rawOffset, 0, geom.contentWidthPt * 0.65);
    }
  }

  if (typeof blk.indent_right_pt === 'number' && Number.isFinite(blk.indent_right_pt)) {
    indentRightPt = clamp(blk.indent_right_pt, 0, geom.contentWidthPt * 0.65);
  } else if (box && (blk.alignment === 'right' || blk.block_type === 'horizontal_rule')) {
    const rawRight = geom.pageWidthPt - geom.marginRightPt - (box[3] / 1000) * geom.pageWidthPt;
    if (rawRight > 3) {
      indentRightPt = clamp(rawRight, 0, geom.contentWidthPt * 0.65);
    }
  }

  let firstLineIndentPt = 0;
  if (typeof blk.first_line_indent_pt === 'number' && Number.isFinite(blk.first_line_indent_pt)) {
    if (blk.first_line_indent_pt < 0) {
      firstLineIndentPt = clamp(blk.first_line_indent_pt, -72, 0);
    } else {
      firstLineIndentPt = clamp(blk.first_line_indent_pt, 0, 120);
    }
  }

  return { indentLeftPt, indentRightPt, firstLineIndentPt };
}

function shouldGroupSideBySide(a: DocumentBlock, b: DocumentBlock): boolean {
  if (!isValidBox(a.box_2d) || !isValidBox(b.box_2d)) return false;
  if (a.block_type === 'horizontal_rule' || b.block_type === 'horizontal_rule') return false;
  if (a.block_type === 'table' || b.block_type === 'table') return false;

  const [ay1, ax1, ay2, ax2] = a.box_2d;
  const [by1, bx1, by2, bx2] = b.box_2d;

  const aLeftOfB = ax2 <= bx1 + 25;
  const bLeftOfA = bx2 <= ax1 + 25;
  if (!aLeftOfB && !bLeftOfA) return false;

  const overlapY = Math.min(ay2, by2) - Math.max(ay1, by1);
  const minH = Math.min(ay2 - ay1, by2 - by1);
  if (minH <= 0) return false;

  const involvesFigure = a.block_type === 'figure' || b.block_type === 'figure';
  return involvesFigure ? overlapY / minH >= 0.35 : overlapY / minH >= 0.65;
}

function computeSpaceBeforePt(
  prevBottomNorm: number | null,
  currTopNorm: number | null,
  geom: PageGeometry,
  isFirstOnPage: boolean,
  blockType?: DocumentBlock['block_type'],
  explicitSpaceBeforePt?: number | null
): number {
  if (typeof explicitSpaceBeforePt === 'number' && Number.isFinite(explicitSpaceBeforePt)) {
    return clamp(Math.round(explicitSpaceBeforePt * 10) / 10, 0, 240);
  }

  if (currTopNorm !== null) {
    if (isFirstOnPage) {
      const topGapPt = (currTopNorm / 1000) * geom.pageHeightPt - geom.marginTopPt;
      return clamp(Math.round(topGapPt * 10) / 10, 0, 120);
    }
    if (prevBottomNorm !== null) {
      const gapPt = ((currTopNorm - prevBottomNorm) / 1000) * geom.pageHeightPt;
      if (gapPt <= 1) return 2;
      return clamp(Math.round(gapPt * 10) / 10, 2, 140);
    }
  }

  if (isFirstOnPage) return 0;
  if (blockType === 'heading') return 10;
  if (blockType === 'equation' || blockType === 'figure' || blockType === 'table') return 8;
  return 5;
}

export function groupBlocksIntoVisualBands(
  blocks: DocumentBlock[],
  geom: PageGeometry
): VisualBand[] {
  const bands: VisualBand[] = [];
  let prevBottomNorm: number | null = null;

  let i = 0;
  while (i < blocks.length) {
    const curr = blocks[i];
    const next = i + 1 < blocks.length ? blocks[i + 1] : null;

    if (next && shouldGroupSideBySide(curr, next)) {
      const currBox = curr.box_2d as [number, number, number, number];
      const nextBox = next.box_2d as [number, number, number, number];
      const left = currBox[1] <= nextBox[1] ? curr : next;
      const right = currBox[1] <= nextBox[1] ? next : curr;
      const leftBox = left.box_2d as [number, number, number, number];
      const rightBox = right.box_2d as [number, number, number, number];

      const bandYmin = Math.min(leftBox[0], rightBox[0]);
      const bandYmax = Math.max(leftBox[2], rightBox[2]);
      const bandXmin = Math.min(leftBox[1], rightBox[1]);
      const bandXmax = Math.max(leftBox[3], rightBox[3]);

      const spaceBeforePt = computeSpaceBeforePt(prevBottomNorm, bandYmin, geom, bands.length === 0);
      const indentLeftPt = clamp(
        (bandXmin / 1000) * geom.pageWidthPt - geom.marginLeftPt,
        0,
        geom.contentWidthPt * 0.4
      );
      const indentRightPt = clamp(
        geom.pageWidthPt - geom.marginRightPt - (bandXmax / 1000) * geom.pageWidthPt,
        0,
        geom.contentWidthPt * 0.4
      );

      const splitNorm = (leftBox[3] + rightBox[1]) / 2;
      const spanNorm = Math.max(100, bandXmax - bandXmin);
      const rawLeftPct = Math.round(((splitNorm - bandXmin) / spanNorm) * 100);
      const leftWidthPct = clamp(rawLeftPct, 25, 75);
      const rightWidthPct = 100 - leftWidthPct;

      bands.push({
        kind: 'sideBySide',
        left,
        right,
        leftWidthPct,
        rightWidthPct,
        spaceBeforePt,
        indentLeftPt: indentLeftPt > 6 ? indentLeftPt : 0,
        indentRightPt: indentRightPt > 6 ? indentRightPt : 0,
      });

      prevBottomNorm = bandYmax;
      i += 2;
      continue;
    }

    const currBox = isValidBox(curr.box_2d) ? curr.box_2d : null;
    const spaceBeforePt = computeSpaceBeforePt(
      prevBottomNorm,
      currBox ? currBox[0] : null,
      geom,
      bands.length === 0,
      curr.block_type,
      curr.space_before_pt
    );
    const { indentLeftPt, indentRightPt, firstLineIndentPt } = computeBlockHorizontalOffsets(
      curr,
      geom
    );

    bands.push({
      kind: 'single',
      block: curr,
      spaceBeforePt,
      indentLeftPt,
      indentRightPt,
      firstLineIndentPt,
    });

    if (currBox) {
      prevBottomNorm = currBox[2];
    } else if (prevBottomNorm !== null) {
      prevBottomNorm += 25;
    }
    i += 1;
  }

  return bands;
}

const NAMED_HEX_COLORS: Record<string, string> = {
  red: 'FF0000',
  crimson: 'DC143C',
  darkred: '8B0000',
  maroon: '800000',
  blue: '0000FF',
  darkblue: '00008B',
  navy: '000080',
  royalblue: '4169E1',
  dodgerblue: '1E90FF',
  green: '008000',
  darkgreen: '006400',
  forestgreen: '228B22',
  emerald: '059669',
  teal: '008080',
  cyan: '00FFFF',
  orange: 'FF8000',
  darkorange: 'FF8C00',
  amber: 'D97706',
  gold: 'FFD700',
  yellow: 'FFFF00',
  purple: '800080',
  violet: '800080',
  indigo: '4B0082',
  magenta: 'FF00FF',
  pink: 'FFC0CB',
  brown: '804000',
  olive: '808000',
  lime: '00FF00',
  gray: '808080',
  grey: '808080',
  darkgray: '404040',
  darkgrey: '404040',
  lightgray: 'C0C0C0',
  lightgrey: 'C0C0C0',
  silver: 'C0C0C0',
};

export function normalizeHexColor(color?: string | null): string | null {
  if (!color || typeof color !== 'string') return null;
  const raw = color.trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  if (lower === 'black' || lower === 'auto') return null;
  if (NAMED_HEX_COLORS[lower]) {
    return NAMED_HEX_COLORS[lower];
  }

  const rgbMatch = lower.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
  if (rgbMatch) {
    const r = Math.max(0, Math.min(255, Number(rgbMatch[1])));
    const g = Math.max(0, Math.min(255, Number(rgbMatch[2])));
    const b = Math.max(0, Math.min(255, Number(rgbMatch[3])));
    const hex = [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    if (hex === '000000') return null;
    return hex;
  }

  const cleaned = raw.replace(/^#/, '').toUpperCase();
  if (/^[0-9A-F]{3}$/.test(cleaned)) {
    const expanded = cleaned
      .split('')
      .map((ch) => ch + ch)
      .join('');
    if (expanded === '000000') return null;
    return expanded;
  }
  if (!/^[0-9A-F]{6}$/.test(cleaned)) return null;
  if (cleaned === '000000') return null;
  return cleaned;
}

export function normalizeBoxHexColor(color?: string | null): string | null {
  if (!color || typeof color !== 'string') return null;
  const raw = color.trim();
  if (!raw) return null;
  const cleaned = raw.replace(/^#/, '').toUpperCase();
  if (/^[0-9A-F]{6}$/.test(cleaned)) return cleaned;
  if (/^[0-9A-F]{3}$/.test(cleaned)) {
    return cleaned
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }
  const lower = raw.toLowerCase();
  if (lower === 'white') return 'FFFFFF';
  if (lower === 'black') return '000000';
  if (NAMED_HEX_COLORS[lower]) return NAMED_HEX_COLORS[lower];
  return null;
}
