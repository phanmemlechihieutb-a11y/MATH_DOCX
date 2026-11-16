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
  const isLandscape = wPx > hPx;
  const aspect = wPx / Math.max(1, hPx);

  const a4Aspect = isLandscape ? 11.69 / 8.27 : 8.27 / 11.69;
  const letterAspect = isLandscape ? 11 / 8.5 : 8.5 / 11;
  const useLetter = Math.abs(aspect - letterAspect) < Math.abs(aspect - a4Aspect);

  const portraitW = useLetter ? 612 : 595.3;
  const portraitH = useLetter ? 792 : 841.9;

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
  const marginLeftPt = hasAnyBox
    ? clamp((minX / 1000) * pageWidthPt, 24, 96)
    : defaultMarginPt;
  const marginRightPt = hasAnyBox
    ? clamp(((1000 - maxX) / 1000) * pageWidthPt, 24, 96)
    : defaultMarginPt;
  const marginTopPt = hasAnyBox
    ? clamp((minY / 1000) * pageHeightPt, 24, 96)
    : defaultMarginPt;
  const marginBottomPt = hasAnyBox
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

function getCellPlainText(cell: TableCellData): string {
  return (cell.segments ?? [])
    .map((s) => s.content ?? '')
    .join('')
    .trim();
}

export function isChoiceTableBlock(blk: DocumentBlock): boolean {
  if (blk.block_type !== 'table' || !blk.table_rows || blk.table_rows.length === 0) return false;
  // Tuyệt đối không phá vỡ bảng có khung viền, bảng có tiêu đề hoặc bảng có ô gộp cột (col_span)
  if (blk.table_borderless !== true) return false;

  const hasHeaderOrMergedCell = blk.table_rows.some((row) =>
    row.some((c) => c.is_header === true || (c.col_span ?? 1) > 1)
  );
  if (hasHeaderOrMergedCell) return false;

  let choiceCellCount = 0;
  for (const row of blk.table_rows) {
    for (const cell of row) {
      if (CHOICE_LABEL_REGEX.test(getCellPlainText(cell))) {
        choiceCellCount++;
      }
    }
  }
  if (choiceCellCount >= 2) return true;
  return Boolean(blk.is_choice_block) && choiceCellCount >= 1;
}

function splitSegmentsIntoChoiceGroups(segments: InlineSegment[]): InlineSegment[][] | null {
  const hasTabs = segments.some((s) => s.tab_before);
  if (hasTabs) {
    const groups: InlineSegment[][] = [];
    let current: InlineSegment[] = [];
    for (const seg of segments) {
      if (seg.tab_before && current.length > 0) {
        groups.push(current);
        current = [{ ...seg, tab_before: false }];
      } else {
        current.push({ ...seg, tab_before: false });
      }
    }
    if (current.length > 0) groups.push(current);
    const labelMatches = groups.filter((g) => {
      const txt = g
        .map((s) => s.content)
        .join('')
        .trim();
      return CHOICE_LABEL_REGEX.test(txt);
    }).length;
    return groups.length >= 2 && labelMatches >= 2 ? groups : null;
  }

  // Try splitting by explicit multi-space or newline before choice labels A., B., C., D. or a), b), c), d)
  const splitGroups: InlineSegment[][] = [];
  let current: InlineSegment[] = [];

  for (const seg of segments) {
    if (seg.type !== 'text') {
      current.push({ ...seg });
      continue;
    }
    const text = seg.content ?? '';
    const parts = text.split(/(?:(?:\n|\s{2,})(?=[A-Da-d][\.\)\:]\s))/);
    parts.forEach((part, idx) => {
      const cleaned = idx === 0 ? part : part.trimStart();
      if (idx > 0 && current.length > 0) {
        splitGroups.push(current);
        current = [];
      }
      if (cleaned.length > 0) {
        current.push({ ...seg, content: cleaned, tab_before: false });
      }
    });
  }
  if (current.length > 0) splitGroups.push(current);

  const choiceCount = splitGroups.filter((g) =>
    CHOICE_LABEL_REGEX.test(
      g
        .map((s) => s.content)
        .join('')
        .trim()
    )
  ).length;

  return splitGroups.length >= 2 && choiceCount >= 2 ? splitGroups : null;
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
  if (maxCellW <= colAvail) return blk;

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

export function transformBlocksForChoiceLayout(
  blocks: DocumentBlock[],
  choiceLayout: ChoiceLayoutMode,
  geom: PageGeometry
): DocumentBlock[] {
  const result: DocumentBlock[] = [];

  for (const blk of blocks) {
    if (choiceLayout === 'tabs') {
      if (isChoiceTableBlock(blk)) {
        const reflowed = reflowChoiceTableIfNeeded(blk, geom);
        result.push(...convertChoiceTableToTabParagraphs(reflowed, geom));
        continue;
      }
      if (blk.block_type === 'paragraph') {
        result.push(...ensureTabStopsOnChoiceParagraph(blk, geom));
        continue;
      }
    } else if (choiceLayout === 'table') {
      if (isChoiceTableBlock(blk)) {
        result.push(reflowChoiceTableIfNeeded(blk, geom));
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
    if (rawOffset > 6) {
      indentLeftPt = clamp(rawOffset, 0, geom.contentWidthPt * 0.65);
    }
  }

  if (box && (blk.alignment === 'right' || blk.block_type === 'horizontal_rule')) {
    const rawRight = geom.pageWidthPt - geom.marginRightPt - (box[3] / 1000) * geom.pageWidthPt;
    if (rawRight > 6) {
      indentRightPt = clamp(rawRight, 0, geom.contentWidthPt * 0.65);
    }
  }

  let firstLineIndentPt = 0;
  if (typeof blk.first_line_indent_pt === 'number' && Number.isFinite(blk.first_line_indent_pt)) {
    if (blk.first_line_indent_pt < 0) {
      firstLineIndentPt = clamp(blk.first_line_indent_pt, -72, 0);
    } else if (indentLeftPt <= 6) {
      firstLineIndentPt = clamp(blk.first_line_indent_pt, 0, 72);
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
  blockType?: DocumentBlock['block_type']
): number {
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
      curr.block_type
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

export function normalizeHexColor(color?: string | null): string | null {
  if (!color || typeof color !== 'string') return null;
  const cleaned = color.trim().replace(/^#/, '').toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(cleaned)) return null;
  if (cleaned === '000000' || cleaned === '0F172A') return null;
  return cleaned;
}
