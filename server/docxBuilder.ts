import JSZip from 'jszip';
import type {
  BlockAlignment,
  ChoiceLayoutMode,
  DocumentBlock,
  InlineSegment,
  MathOutputFormat,
  PageExtraction,
  TabStopSpec,
} from '../src/types/document.ts';
import { normalizeSegmentListInlineMath } from '../src/utils/latexParser.ts';
import {
  computePageGeometry,
  computeSafeTableColPcts,
  groupBlocksIntoVisualBands,
  isValidBox,
  normalizeBoxHexColor,
  normalizeHexColor,
  normalizeTableBlockGrid,
  transformBlocksForChoiceLayout,
  type PageGeometry,
  type VisualBand,
} from '../src/utils/layoutMetrics.ts';
import { cleanLatex, escapeXml, latexToOmmlXml } from './omml.ts';

interface MediaItem {
  id: string;
  filename: string;
  data: Buffer;
}

const ALIGN_MAP: Record<BlockAlignment, string> = {
  left: 'left',
  center: 'center',
  right: 'right',
  justify: 'both',
};

function finiteInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function ptToTwips(pt: number): number {
  return finiteInt(pt * 20, 0, 0, 200_000);
}

function getBlockSizeHalfPt(blk: DocumentBlock, pageBaseFontPt = 12): number {
  if (typeof blk.font_size_pt === 'number' && Number.isFinite(blk.font_size_pt)) {
    return finiteInt(blk.font_size_pt * 2, 24, 14, 96);
  }
  const baseHalfPt = finiteInt(pageBaseFontPt * 2, 24, 14, 48);
  if (blk.block_type === 'heading') {
    const level = blk.heading_level === 1 ? 1 : blk.heading_level === 3 ? 3 : 2;
    const delta = baseHalfPt - 24;
    const sizeMap: Record<number, number> = { 1: 30 + delta, 2: 26 + delta, 3: 24 + delta };
    return finiteInt(sizeMap[level], 26, 16, 72);
  }
  if (blk.block_type === 'table') return Math.min(baseHalfPt, 22);
  return baseHalfPt;
}

function renderRunXml(
  text: string,
  options: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    sizeHalfPt?: number;
    colorHex?: string | null;
  } = {}
): string {
  const {
    bold = false,
    italic = false,
    underline = false,
    sizeHalfPt = 24,
    colorHex = null,
  } = options;
  const sz = finiteInt(sizeHalfPt, 24, 14, 96);
  const safeColor = colorHex && /^[0-9A-Fa-f]{6}$/.test(colorHex) ? colorHex.toUpperCase() : '000000';
  // Strict ECMA-376 CT_RPr order: rFonts -> b -> bCs -> i -> iCs -> color -> sz -> szCs -> u
  const rPrParts = [
    '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/>',
  ];
  if (bold) {
    rPrParts.push('<w:b/>', '<w:bCs/>');
  } else {
    rPrParts.push('<w:b w:val="0"/>', '<w:bCs w:val="0"/>');
  }
  if (italic) {
    rPrParts.push('<w:i/>', '<w:iCs/>');
  } else {
    rPrParts.push('<w:i w:val="0"/>', '<w:iCs w:val="0"/>');
  }
  rPrParts.push(`<w:color w:val="${safeColor}"/>`);
  rPrParts.push(`<w:sz w:val="${sz}"/>`, `<w:szCs w:val="${sz}"/>`);
  if (underline) rPrParts.push('<w:u w:val="single"/>');

  const cleanText = text.replace(/\r\n?|\n/g, ' ');
  const safeText = escapeXml(cleanText);
  const needsPreserve = /^\s|\s$|\s{2,}/.test(cleanText);
  const preserve = needsPreserve ? ' xml:space="preserve"' : '';
  return `<w:r><w:rPr>${rPrParts.join('')}</w:rPr><w:t${preserve}>${safeText}</w:t></w:r>`;
}

function renderSegmentsXml(
  segments: InlineSegment[] | null | undefined,
  options: {
    sizeHalfPt?: number;
    defaultBold?: boolean;
    mathFormat?: MathOutputFormat;
    isTableCell?: boolean;
  } = {}
): string {
  if (!segments || segments.length === 0) return '';
  const { sizeHalfPt = 24, defaultBold = false, mathFormat = 'omml', isTableCell = false } = options;
  const out: string[] = [];

  const normalizedSegments = normalizeSegmentListInlineMath(segments, { isTableCell }) ?? segments;

  for (const seg of normalizedSegments) {
    const segSizeHalfPt =
      typeof seg.font_size_pt === 'number' && Number.isFinite(seg.font_size_pt)
        ? finiteInt(seg.font_size_pt * 2, sizeHalfPt, 14, 96)
        : sizeHalfPt;

    if (seg.tab_before) {
      out.push(
        `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/><w:sz w:val="${segSizeHalfPt}"/><w:szCs w:val="${segSizeHalfPt}"/></w:rPr><w:tab/></w:r>`
      );
    }
    const colorHex = normalizeHexColor(seg.color);
    const isBold = seg.bold !== undefined ? Boolean(seg.bold) : defaultBold;

    if (seg.type === 'math') {
      if (mathFormat === 'latex') {
        const cleaned = cleanLatex(seg.content);
        if (cleaned) {
          out.push(
            renderRunXml('${' + cleaned + '}$', {
              sizeHalfPt: segSizeHalfPt,
              colorHex,
              bold: isBold,
              italic: Boolean(seg.italic),
              underline: Boolean(seg.underline),
            })
          );
        }
      } else {
        const omml = latexToOmmlXml(seg.content, false, {
          sizeHalfPt: segSizeHalfPt,
          colorHex,
          bold: isBold,
          italic: Boolean(seg.italic),
        });
        if (omml) {
          out.push(omml);
        } else {
          out.push(
            renderRunXml(` ${cleanLatex(seg.content)} `, {
              sizeHalfPt: segSizeHalfPt,
              colorHex,
              bold: isBold,
              italic: Boolean(seg.italic),
            })
          );
        }
      }
    } else {
      const lines = (seg.content ?? '').replace(/\r\n?/g, '\n').split('\n');
      lines.forEach((line, idx) => {
        if (line.length > 0) {
          out.push(
            renderRunXml(line, {
              bold: isBold,
              italic: Boolean(seg.italic),
              underline: Boolean(seg.underline),
              sizeHalfPt: segSizeHalfPt,
              colorHex,
            })
          );
        }
        if (idx < lines.length - 1) {
          out.push('<w:r><w:br/></w:r>');
        }
      });
    }
  }

  return out.join('');
}

function renderParagraphXml(
  innerXml: string,
  options: {
    align?: BlockAlignment;
    spaceBeforeTwip?: number;
    spaceAfterTwip?: number;
    lineSpacing240?: number;
    exactLineHeightTwip?: number;
    keepNext?: boolean;
    indentLeftTwip?: number;
    indentRightTwip?: number;
    firstLineIndentTwip?: number;
    tabStopsTwip?: number[];
    tabStopSpecs?: TabStopSpec[];
    availableWidthTwips?: number;
    bottomBorder?: boolean;
  } = {}
): string {
  const {
    align = 'left',
    spaceBeforeTwip = 0,
    spaceAfterTwip = 0,
    lineSpacing240 = 264,
    exactLineHeightTwip,
    keepNext = false,
    indentLeftTwip = 0,
    indentRightTwip = 0,
    firstLineIndentTwip = 0,
    tabStopsTwip,
    tabStopSpecs,
    availableWidthTwips = 9360,
    bottomBorder = false,
  } = options;

  const jc = ALIGN_MAP[align] ?? 'left';
  const keepNextXml = keepNext ? '<w:keepNext/>' : '';
  const borderXml = bottomBorder
    ? '<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="334155"/></w:pBdr>'
    : '';

  let tabsXml = '';
  if (tabStopSpecs && tabStopSpecs.length > 0) {
    const rightEdgeTwips = Math.max(
      800,
      finiteInt(availableWidthTwips, 9360, 600, 40_000) - finiteInt(indentRightTwip, 0, 0, 20_000)
    );
    const seenPos = new Set<number>();
    const resolvedTabs: Array<{ pos: number; val: string; leader: string }> = [];
    tabStopSpecs.forEach((spec) => {
      const val =
        spec.align === 'center' ? 'center' : spec.align === 'right' ? 'right' : 'left';
      let pos =
        typeof spec.pos_pt === 'number' && Number.isFinite(spec.pos_pt) && spec.pos_pt > 0
          ? finiteInt(spec.pos_pt * 20, rightEdgeTwips, 60, rightEdgeTwips)
          : rightEdgeTwips;
      while (seenPos.has(pos) && pos > 120) {
        pos -= 60;
      }
      seenPos.add(pos);
      const leader =
        spec.leader === 'dot'
          ? ' w:leader="dot"'
          : spec.leader === 'underscore'
          ? ' w:leader="underscore"'
          : '';
      resolvedTabs.push({ pos, val, leader });
    });
    resolvedTabs.sort((a, b) => a.pos - b.pos);
    tabsXml = `<w:tabs>${resolvedTabs
      .map((t) => `<w:tab w:val="${t.val}"${t.leader} w:pos="${t.pos}"/>`)
      .join('')}</w:tabs>`;
  } else {
    const cleanTabStops =
      tabStopsTwip && tabStopsTwip.length > 0
        ? Array.from(
            new Set(
              tabStopsTwip
                .filter((p) => typeof p === 'number' && Number.isFinite(p) && p > 0)
                .map((p) => finiteInt(p, 0, 1, 50_000))
            )
          ).sort((a, b) => a - b)
        : [];

    tabsXml =
      cleanTabStops.length > 0
        ? `<w:tabs>${cleanTabStops
            .map((pos) => `<w:tab w:val="left" w:pos="${pos}"/>`)
            .join('')}</w:tabs>`
        : '';
  }

  const safeLeft = finiteInt(indentLeftTwip, 0, 0, 50_000);
  const safeRight = finiteInt(indentRightTwip, 0, 0, 50_000);
  const safeFirstLine = finiteInt(firstLineIndentTwip, 0, -50_000, 50_000);

  const indAttrs: string[] = [];
  if (safeFirstLine < -20) {
    const hanging = Math.abs(safeFirstLine);
    indAttrs.push(`w:left="${safeLeft + hanging}"`);
    indAttrs.push(`w:hanging="${hanging}"`);
  } else {
    if (safeLeft > 0) indAttrs.push(`w:left="${safeLeft}"`);
    if (safeFirstLine > 20) indAttrs.push(`w:firstLine="${safeFirstLine}"`);
  }
  if (safeRight > 0) indAttrs.push(`w:right="${safeRight}"`);
  const indXml = indAttrs.length > 0 ? `<w:ind ${indAttrs.join(' ')}/>` : '';

  const spacingXml =
    exactLineHeightTwip !== undefined
      ? `<w:spacing w:before="0" w:after="0" w:line="${finiteInt(
          exactLineHeightTwip,
          20,
          20,
          20_000
        )}" w:lineRule="exact"/>`
      : `<w:spacing w:before="${finiteInt(
          spaceBeforeTwip,
          0,
          0,
          20_000
        )}" w:after="${finiteInt(spaceAfterTwip, 0, 0, 20_000)}" w:line="${finiteInt(
          lineSpacing240,
          264,
          120,
          2400
        )}" w:lineRule="auto"/>`;

  return `<w:p><w:pPr>${keepNextXml}${borderXml}${tabsXml}${spacingXml}${indXml}<w:jc w:val="${jc}"/></w:pPr>${innerXml}</w:p>`;
}

function borderSideXml(
  side: 'top' | 'left' | 'bottom' | 'right',
  active: boolean,
  szEighthPt: number,
  colorHex: string
): string {
  if (!active) {
    return `<w:${side} w:val="none" w:sz="0" w:space="0" w:color="auto"/>`;
  }
  return `<w:${side} w:val="single" w:sz="${finiteInt(
    szEighthPt,
    6,
    2,
    48
  )}" w:space="0" w:color="${colorHex}"/>`;
}

function renderBandXml(
  band: VisualBand,
  geom: PageGeometry,
  mediaItems: MediaItem[],
  options: {
    availableWidthTwips: number;
    mathFormat: MathOutputFormat;
    pageBaseFontPt: number;
  }
): string {
  const { availableWidthTwips, mathFormat, pageBaseFontPt } = options;

  if (band.kind === 'single') {
    return renderSingleBlockXml(band.block, geom, mediaItems, {
      spaceBeforeTwip: ptToTwips(band.spaceBeforePt),
      indentLeftTwip: ptToTwips(band.indentLeftPt),
      indentRightTwip: ptToTwips(band.indentRightPt),
      firstLineIndentTwip: finiteInt(band.firstLineIndentPt * 20, 0, -50_000, 50_000),
      availableWidthTwips,
      pageBaseFontPt,
      mathFormat,
    });
  }

  const indentLeftTwip = ptToTwips(band.indentLeftPt);
  const indentRightTwip = ptToTwips(band.indentRightPt);
  const totalBandWidth = finiteInt(
    availableWidthTwips - indentLeftTwip - indentRightTwip,
    6000,
    1200,
    30_000
  );
  const minSideW = Math.min(1000, Math.floor(totalBandWidth * 0.25));
  const leftWidthDxa = finiteInt(
    (band.leftWidthPct / 100) * totalBandWidth,
    Math.floor(totalBandWidth / 2),
    minSideW,
    Math.max(minSideW, totalBandWidth - minSideW)
  );
  const rightWidthDxa = Math.max(minSideW, totalBandWidth - leftWidthDxa);
  const resolvedBandWidth = leftWidthDxa + rightWidthDxa;

  const leftXml = ensureCellEndsWithParagraph(
    renderSingleBlockXml(band.left, geom, mediaItems, {
      spaceBeforeTwip: 0,
      indentLeftTwip: 0,
      indentRightTwip: 0,
      firstLineIndentTwip: 0,
      availableWidthTwips: Math.max(600, leftWidthDxa - 80),
      pageBaseFontPt,
      mathFormat,
    })
  );

  const rightXml = ensureCellEndsWithParagraph(
    renderSingleBlockXml(band.right, geom, mediaItems, {
      spaceBeforeTwip: 0,
      indentLeftTwip: 0,
      indentRightTwip: 0,
      firstLineIndentTwip: 0,
      availableWidthTwips: Math.max(600, rightWidthDxa - 80),
      pageBaseFontPt,
      mathFormat,
    })
  );

  const tblIndXml = indentLeftTwip > 20 ? `<w:tblInd w:w="${indentLeftTwip}" w:type="dxa"/>` : '';
  const tblPr = `<w:tblPr><w:tblW w:w="${resolvedBandWidth}" w:type="dxa"/>${tblIndXml}<w:tblBorders><w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/></w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="40" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tblCellMar></w:tblPr>`;
  const grid = `<w:tblGrid><w:gridCol w:w="${leftWidthDxa}"/><w:gridCol w:w="${rightWidthDxa}"/></w:tblGrid>`;
  const rowXml = `<w:tr><w:tc><w:tcPr><w:tcW w:w="${leftWidthDxa}" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>${leftXml}</w:tc><w:tc><w:tcPr><w:tcW w:w="${rightWidthDxa}" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>${rightXml}</w:tc></w:tr>`;

  const spacerBefore =
    band.spaceBeforePt > 2
      ? renderParagraphXml('', {
          exactLineHeightTwip: Math.min(2400, ptToTwips(band.spaceBeforePt)),
        })
      : '';

  return `${spacerBefore}<w:tbl>${tblPr}${grid}${rowXml}</w:tbl>`;
}

function renderTableXml(
  block: DocumentBlock,
  geom: PageGeometry,
  mediaItems: MediaItem[],
  options: {
    availableWidthTwips: number;
    indentLeftTwip?: number;
    spaceBeforeTwip?: number;
    pageBaseFontPt?: number;
    mathFormat?: MathOutputFormat;
  }
): string {
  const normalizedBlock = normalizeTableBlockGrid(block);
  const rows = normalizedBlock.table_rows ?? [];
  if (rows.length === 0) return '';

  const safeSpan = (rawSpan: unknown): number => finiteInt(rawSpan, 1, 1, 63);
  const rawMaxCols = Math.max(
    ...rows.map((r) => r.reduce((acc, c) => acc + safeSpan(c.col_span), 0)),
    0
  );
  const maxCols = Math.min(63, rawMaxCols);
  if (maxCols <= 0) return '';

  const {
    availableWidthTwips,
    indentLeftTwip = 0,
    spaceBeforeTwip = 0,
    pageBaseFontPt = 12,
    mathFormat = 'omml',
  } = options;
  const totalWidthDxa = finiteInt(availableWidthTwips, 9360, 1000, 30_000);
  const safeIndentLeft = finiteInt(indentLeftTwip, 0, 0, 20_000);
  const safeSpaceBefore = finiteInt(spaceBeforeTwip, 0, 0, 20_000);

  const tableStyle = normalizedBlock.table_style ?? (normalizedBlock.table_borderless ? 'borderless' : 'grid');
  const isBorderless = tableStyle === 'borderless';
  const isBooktabs = tableStyle === 'booktabs';
  const isBox = tableStyle === 'box';
  const isGrid = tableStyle === 'grid';
  const colBorders = Array.isArray(normalizedBlock.table_col_borders)
    ? normalizedBlock.table_col_borders
    : null;

  const baseColW = Math.max(120, Math.floor(totalWidthDxa / maxCols));
  const colWidthsDxa: number[] = new Array(maxCols).fill(baseColW);
  if (colWidthsDxa.length > 0) {
    const remainder = totalWidthDxa - baseColW * maxCols;
    if (remainder > 0) {
      colWidthsDxa[maxCols - 1] += remainder;
    }
  }

  const safeColPcts = computeSafeTableColPcts(rows, maxCols, totalWidthDxa / 20, isBorderless);
  if (safeColPcts) {
    let assigned = 0;
    const minColW = Math.min(360, Math.max(120, Math.floor(totalWidthDxa / maxCols)));
    safeColPcts.forEach((pct, idx) => {
      if (idx === maxCols - 1) {
        colWidthsDxa[idx] = Math.max(minColW, totalWidthDxa - assigned);
      } else {
        const maxAllow = Math.max(
          minColW,
          totalWidthDxa - assigned - minColW * (maxCols - 1 - idx)
        );
        const w = finiteInt(
          (pct / 100) * totalWidthDxa,
          minColW,
          minColW,
          maxAllow
        );
        colWidthsDxa[idx] = w;
        assigned += w;
      }
    });
  }

  const resolvedTableWidthDxa = colWidthsDxa.reduce((a, b) => a + b, 0);
  const gridCols = colWidthsDxa.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  const tblIndXml =
    safeIndentLeft > 20 ? `<w:tblInd w:w="${safeIndentLeft}" w:type="dxa"/>` : '';

  const useExplicitCellBorders = isBorderless || isBooktabs || isBox || (isGrid && colBorders !== null);
  const bordersXml = useExplicitCellBorders
    ? '<w:tblBorders><w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/></w:tblBorders>'
    : '<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="64748B"/><w:left w:val="single" w:sz="4" w:space="0" w:color="64748B"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="64748B"/><w:right w:val="single" w:sz="4" w:space="0" w:color="64748B"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/></w:tblBorders>';

  const cellMarginLR = isBox ? 340 : isBorderless ? 80 : 200;
  const cellMarXml = isBox
    ? '<w:tblCellMar><w:top w:w="110" w:type="dxa"/><w:left w:w="170" w:type="dxa"/><w:bottom w:w="110" w:type="dxa"/><w:right w:w="170" w:type="dxa"/></w:tblCellMar>'
    : isBorderless
    ? '<w:tblCellMar><w:top w:w="20" w:type="dxa"/><w:left w:w="40" w:type="dxa"/><w:bottom w:w="20" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tblCellMar>'
    : '<w:tblCellMar><w:top w:w="70" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>';

  const tblJcXml =
    safeIndentLeft <= 20 && (normalizedBlock.alignment === 'center' || normalizedBlock.alignment === 'right')
      ? `<w:jc w:val="${normalizedBlock.alignment}"/>`
      : '';
  const tblPr = `<w:tblPr><w:tblW w:w="${resolvedTableWidthDxa}" w:type="dxa"/>${tblJcXml}${tblIndXml}${bordersXml}<w:tblLayout w:type="fixed"/>${cellMarXml}</w:tblPr>`;

  const defaultSizeHalfPt =
    typeof block.font_size_pt === 'number' && Number.isFinite(block.font_size_pt)
      ? finiteInt(block.font_size_pt * 2, 22, 14, 96)
      : isBorderless || isBox
      ? finiteInt(pageBaseFontPt * 2, 24, 14, 48)
      : Math.min(22, finiteInt(pageBaseFontPt * 2, 22, 14, 48));

  const lineSpacing240 =
    typeof block.line_spacing === 'number' && Number.isFinite(block.line_spacing)
      ? finiteInt(block.line_spacing * 240, 264, 216, 600)
      : isBorderless || isBox
      ? 264
      : 240;

  const totalRows = rows.length;

  const rowsXml = rows
    .map((row, rIdx) => {
      let colCursor = 0;
      const cellsXml: string[] = [];

      for (const cell of row) {
        if (colCursor >= maxCols) break;
        const startCol = colCursor;
        const span = Math.max(1, Math.min(maxCols - colCursor, safeSpan(cell.col_span)));
        const cellWidthDxa = colWidthsDxa
          .slice(colCursor, colCursor + span)
          .reduce((a, b) => a + b, 0);
        colCursor += span;

        const isHeader = Boolean(cell.is_header) && !isBorderless;
        const customFill = normalizeBoxHexColor(cell.fill_color);
        const shading = customFill
          ? `<w:shd w:val="clear" w:color="auto" w:fill="${customFill}"/>`
          : isHeader && isGrid && !colBorders
          ? '<w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/>'
          : '';
        const gridSpanXml = span > 1 ? `<w:gridSpan w:val="${span}"/>` : '';
        const vMergeXml =
          cell.v_merge === 'restart'
            ? '<w:vMerge w:val="restart"/>'
            : cell.v_merge === 'continue'
            ? '<w:vMerge/>'
            : '';

        const borderHex =
          normalizeBoxHexColor(cell.border_color) ??
          (isBooktabs ? '0F172A' : isBox ? '334155' : '475569');

        let tcBordersXml = '';
        if (isBooktabs) {
          const topActive = Boolean(cell.border_top);
          const bottomActive = Boolean(cell.border_bottom);
          const leftActive = Boolean(cell.border_left);
          const rightActive = Boolean(cell.border_right);
          const topSz = rIdx === 0 ? 12 : 6;
          const bottomSz = rIdx === totalRows - 1 ? 12 : 6;
          tcBordersXml = `<w:tcBorders>${borderSideXml(
            'top',
            topActive,
            topSz,
            borderHex
          )}${borderSideXml('left', leftActive, 6, borderHex)}${borderSideXml(
            'bottom',
            bottomActive,
            bottomSz,
            borderHex
          )}${borderSideXml('right', rightActive, 6, borderHex)}</w:tcBorders>`;
        } else if (isBox) {
          const defaultEdge = !block.table_borderless;
          const topActive = cell.border_top ?? defaultEdge;
          const bottomActive = cell.border_bottom ?? defaultEdge;
          const leftActive = cell.border_left ?? defaultEdge;
          const rightActive = cell.border_right ?? defaultEdge;
          tcBordersXml = `<w:tcBorders>${borderSideXml(
            'top',
            topActive,
            8,
            borderHex
          )}${borderSideXml('left', leftActive, 8, borderHex)}${borderSideXml(
            'bottom',
            bottomActive,
            8,
            borderHex
          )}${borderSideXml('right', rightActive, 8, borderHex)}</w:tcBorders>`;
        } else if (isGrid && colBorders) {
          const topActive = Boolean(cell.border_top);
          const bottomActive = Boolean(cell.border_bottom);
          const leftActive =
            cell.border_left !== undefined && cell.border_left !== null
              ? Boolean(cell.border_left)
              : Boolean(colBorders[startCol]);
          const rightActive =
            cell.border_right !== undefined && cell.border_right !== null
              ? Boolean(cell.border_right)
              : Boolean(colBorders[startCol + span]);
          tcBordersXml = `<w:tcBorders>${borderSideXml(
            'top',
            topActive,
            4,
            borderHex
          )}${borderSideXml('left', leftActive, 4, borderHex)}${borderSideXml(
            'bottom',
            bottomActive,
            4,
            borderHex
          )}${borderSideXml('right', rightActive, 4, borderHex)}</w:tcBorders>`;
        } else if (
          isBorderless &&
          (cell.border_top || cell.border_bottom || cell.border_left || cell.border_right)
        ) {
          tcBordersXml = `<w:tcBorders>${borderSideXml(
            'top',
            Boolean(cell.border_top),
            6,
            borderHex
          )}${borderSideXml('left', Boolean(cell.border_left), 6, borderHex)}${borderSideXml(
            'bottom',
            Boolean(cell.border_bottom),
            6,
            borderHex
          )}${borderSideXml('right', Boolean(cell.border_right), 6, borderHex)}</w:tcBorders>`;
        }

        const hasNestedBlocks = Array.isArray(cell.blocks) && cell.blocks.length > 0;
        const vAlignVal =
          cell.v_align === 'center'
            ? 'center'
            : cell.v_align === 'bottom'
            ? 'bottom'
            : cell.v_align === 'top' || hasNestedBlocks || isBorderless || isBox
            ? 'top'
            : null;
        const vAlignXml = vAlignVal ? `<w:vAlign w:val="${vAlignVal}"/>` : '';

        let cellContentXml = '';
        if (hasNestedBlocks && cell.blocks) {
          const cellAvailTwips = Math.max(800, cellWidthDxa - cellMarginLR);
          const cellGeom: PageGeometry = {
            ...geom,
            contentWidthPt: cellAvailTwips / 20,
            contentWidthTwips: cellAvailTwips,
          };
          const cellBands = groupBlocksIntoVisualBands(cell.blocks, cellGeom);
          const cellChunks: string[] = [];
          for (const cBand of cellBands) {
            const xml = renderBandXml(cBand, cellGeom, mediaItems, {
              availableWidthTwips: cellAvailTwips,
              mathFormat,
              pageBaseFontPt,
            });
            if (!xml) continue;
            const prevChunk = cellChunks[cellChunks.length - 1];
            if (
              prevChunk &&
              prevChunk.trimEnd().endsWith('</w:tbl>') &&
              xml.trimStart().startsWith('<w:tbl>')
            ) {
              cellChunks.push(renderParagraphXml('', { exactLineHeightTwip: 20 }));
            }
            cellChunks.push(xml);
          }
          cellContentXml = ensureCellEndsWithParagraph(cellChunks.join(''));
        } else {
          const cellAlign: BlockAlignment = cell.alignment ?? (isHeader && !isBox ? 'center' : 'left');
          const cellAvailTwips = Math.max(600, cellWidthDxa - cellMarginLR);
          const cellTabSegs = (cell.segments ?? []).filter((s) => s.tab_before);
          const cellTabStopSpecs: TabStopSpec[] | undefined =
            cellTabSegs.length > 0
              ? cellTabSegs.map((ts, tIdx) => ({
                  pos_pt:
                    tIdx === cellTabSegs.length - 1
                      ? null
                      : Math.round(((cellAvailTwips / 20) * (tIdx + 1)) / cellTabSegs.length),
                  align: 'right' as const,
                  leader: ts.tab_leader ?? 'none',
                }))
              : undefined;
          const segXml = renderSegmentsXml(cell.segments, {
            sizeHalfPt: defaultSizeHalfPt,
            defaultBold: false,
            mathFormat,
            isTableCell: true,
          });
          cellContentXml = renderParagraphXml(segXml, {
            align: cellAlign,
            spaceBeforeTwip: 0,
            spaceAfterTwip: 0,
            lineSpacing240,
            availableWidthTwips: cellAvailTwips,
            tabStopSpecs: cellTabStopSpecs,
          });
        }

        // Strict ECMA-376 CT_TcPrInner child order: tcW -> gridSpan -> vMerge -> tcBorders -> shd -> vAlign
        cellsXml.push(
          `<w:tc><w:tcPr><w:tcW w:w="${cellWidthDxa}" w:type="dxa"/>${gridSpanXml}${vMergeXml}${tcBordersXml}${shading}${vAlignXml}</w:tcPr>${cellContentXml}</w:tc>`
        );
      }

      while (colCursor < maxCols) {
        const w = colWidthsDxa[colCursor] ?? baseColW;
        cellsXml.push(
          `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr>${renderParagraphXml('', {
            spaceBeforeTwip: 0,
            spaceAfterTwip: 0,
          })}</w:tc>`
        );
        colCursor += 1;
      }

      return `<w:tr>${cellsXml.join('')}</w:tr>`;
    })
    .join('');

  const spacerBefore =
    safeSpaceBefore > 40
      ? renderParagraphXml('', {
          exactLineHeightTwip: Math.min(2400, safeSpaceBefore),
        })
      : '';

  return `${spacerBefore}<w:tbl>${tblPr}<w:tblGrid>${gridCols}</w:tblGrid>${rowsXml}</w:tbl>`;
}

function renderPictureRunXml(
  relId: string,
  docPrId: number,
  cxEmu: number,
  cyEmu: number,
  name: string
): string {
  const safeCx = finiteInt(cxEmu, 914400, 91440, 20_000_000);
  const safeCy = finiteInt(cyEmu, 914400, 91440, 20_000_000);
  const safeDocId = finiteInt(docPrId, 1, 1, 10_000_000);
  const safePicId = 10_000 + safeDocId;
  const safeName = escapeXml(name);
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${safeCx}" cy="${safeCy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${safeDocId}" name="${safeName}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${safePicId}" name="${safeName}"/><pic:cNvPicPr><a:picLocks noChangeAspect="1" noChangeArrowheads="1"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${safeCx}" cy="${safeCy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

function detectImageExtensionFromBuffer(buf: Buffer): 'png' | 'jpg' | null {
  if (buf.length < 8) return null;
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'png';
  }
  // JPEG signature: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpg';
  }
  return null;
}

function renderSingleBlockXml(
  blk: DocumentBlock,
  geom: PageGeometry,
  mediaItems: MediaItem[],
  opts: {
    spaceBeforeTwip: number;
    indentLeftTwip: number;
    indentRightTwip: number;
    firstLineIndentTwip: number;
    availableWidthTwips: number;
    pageBaseFontPt?: number;
    mathFormat?: MathOutputFormat;
  }
): string {
  const {
    spaceBeforeTwip,
    indentLeftTwip,
    indentRightTwip,
    firstLineIndentTwip,
    availableWidthTwips,
    pageBaseFontPt = 12,
    mathFormat = 'omml',
  } = opts;

  const lineSpacing240 =
    typeof blk.line_spacing === 'number' && Number.isFinite(blk.line_spacing)
      ? Math.round(Math.max(0.9, Math.min(2.5, blk.line_spacing)) * 240)
      : 264;

  const tabStopsTwip = Array.isArray(blk.tab_stops_pt)
    ? blk.tab_stops_pt
        .filter((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)
        .map(ptToTwips)
    : undefined;
  const tabStopSpecs = Array.isArray(blk.tab_stop_specs) && blk.tab_stop_specs.length > 0
    ? blk.tab_stop_specs
    : undefined;

  if (blk.block_type === 'horizontal_rule') {
    return renderParagraphXml('', {
      align: 'left',
      spaceBeforeTwip,
      spaceAfterTwip: 0,
      lineSpacing240: 120,
      indentLeftTwip,
      indentRightTwip,
      bottomBorder: true,
    });
  }

  if (blk.block_type === 'heading') {
    const sizeHalfPt = getBlockSizeHalfPt(blk, pageBaseFontPt);
    const inner = renderSegmentsXml(blk.segments, {
      sizeHalfPt,
      defaultBold: false,
      mathFormat,
    });
    return renderParagraphXml(inner, {
      align: blk.alignment,
      spaceBeforeTwip,
      spaceAfterTwip: 0,
      lineSpacing240,
      keepNext: true,
      indentLeftTwip,
      indentRightTwip,
      firstLineIndentTwip,
      tabStopsTwip,
      tabStopSpecs,
      availableWidthTwips,
    });
  }

  if (blk.block_type === 'paragraph') {
    const sizeHalfPt = getBlockSizeHalfPt(blk, pageBaseFontPt);
    const inner = renderSegmentsXml(blk.segments, { sizeHalfPt, mathFormat });
    return renderParagraphXml(inner, {
      align: blk.alignment,
      spaceBeforeTwip,
      spaceAfterTwip: 0,
      lineSpacing240,
      indentLeftTwip,
      indentRightTwip,
      firstLineIndentTwip,
      tabStopsTwip,
      tabStopSpecs,
      availableWidthTwips,
    });
  }

  if (blk.block_type === 'equation' && blk.latex) {
    const sizeHalfPt = getBlockSizeHalfPt(blk, pageBaseFontPt);
    const eqAlign = blk.alignment ?? 'center';
    const eqColorHex = normalizeHexColor(blk.color);
    const eqBold = Boolean(blk.bold);
    const eqItalic = Boolean(blk.italic);
    if (mathFormat === 'latex') {
      let cleaned = cleanLatex(blk.latex);
      const eqEnvM = cleaned.match(/^\\begin\{(equation\*?|displaymath)\}([\s\S]*)\\end\{\1\}$/);
      if (eqEnvM) cleaned = eqEnvM[2].trim();
      return renderParagraphXml(
        cleaned
          ? renderRunXml('${' + cleaned + '}$', {
              sizeHalfPt,
              colorHex: eqColorHex,
              bold: eqBold,
              italic: eqItalic,
            })
          : '',
        {
          align: eqAlign,
          spaceBeforeTwip,
          spaceAfterTwip: 0,
          indentLeftTwip: eqAlign === 'center' ? 0 : indentLeftTwip,
          indentRightTwip: eqAlign === 'center' ? 0 : indentRightTwip,
        }
      );
    }
    const omml = latexToOmmlXml(blk.latex, true, {
      sizeHalfPt,
      align: eqAlign,
      colorHex: eqColorHex,
      bold: eqBold,
      italic: eqItalic,
    });
    if (omml) {
      return renderParagraphXml(omml, {
        align: eqAlign,
        spaceBeforeTwip,
        spaceAfterTwip: 0,
        indentLeftTwip: eqAlign === 'center' ? 0 : indentLeftTwip,
        indentRightTwip: eqAlign === 'center' ? 0 : indentRightTwip,
      });
    }
    return renderParagraphXml(
      renderRunXml(cleanLatex(blk.latex), {
        sizeHalfPt,
        colorHex: eqColorHex,
        bold: eqBold,
        italic: eqItalic,
      }),
      {
        align: eqAlign,
        spaceBeforeTwip,
        spaceAfterTwip: 0,
        indentLeftTwip: eqAlign === 'center' ? 0 : indentLeftTwip,
        indentRightTwip: eqAlign === 'center' ? 0 : indentRightTwip,
      }
    );
  }

  if (blk.block_type === 'table') {
    return renderTableXml(blk, geom, mediaItems, {
      availableWidthTwips: Math.max(1000, availableWidthTwips - indentLeftTwip - indentRightTwip),
      indentLeftTwip,
      spaceBeforeTwip,
      pageBaseFontPt,
      mathFormat,
    });
  }

  if (blk.block_type === 'figure' && blk.croppedImageDataUrl) {
    const base64Match = blk.croppedImageDataUrl.match(
      /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/i
    );
    if (!base64Match) return '';

    const imgData = Buffer.from(base64Match[2].replace(/\s+/g, ''), 'base64');
    const detectedExt = detectImageExtensionFromBuffer(imgData);
    if (!detectedExt) return '';

    const imgIndex = mediaItems.length + 1;
    const relId = `rId${imgIndex + 2}`;
    const filename = `image${imgIndex}.${detectedExt}`;
    mediaItems.push({
      id: relId,
      filename,
      data: imgData,
    });

    const widthPx = finiteInt(blk.croppedWidthPx ?? 600, 600, 40, 20_000);
    const heightPx = finiteInt(blk.croppedHeightPx ?? 400, 400, 40, 20_000);
    const box = isValidBox(blk.box_2d) ? blk.box_2d : null;
    const maxAvailWidthIn = Math.max(1.2, availableWidthTwips / 1440);
    const maxAvailHeightIn = Math.max(
      2.0,
      ((geom.pageHeightPt - geom.marginTopPt - geom.marginBottomPt) / 72) * 0.78
    );
    const rawBoxWidthIn = box
      ? ((box[3] - box[1]) / 1000) * (geom.pageWidthPt / 72)
      : blk.croppedWidthPx
      ? Math.max(1.5, Math.min(maxAvailWidthIn * 0.94, widthPx / 96))
      : maxAvailWidthIn * 0.6;
    let targetWidthIn = Math.max(0.8, Math.min(maxAvailWidthIn * 0.96, rawBoxWidthIn));
    let targetHeightIn = targetWidthIn * (heightPx / widthPx);
    if (targetHeightIn > maxAvailHeightIn) {
      targetHeightIn = maxAvailHeightIn;
      targetWidthIn = Math.max(0.4, targetHeightIn * (widthPx / heightPx));
    }
    const cxEmu = finiteInt(targetWidthIn * 914400, 1_828_800, 91440, 20_000_000);
    const cyEmu = finiteInt(targetHeightIn * 914400, 1_371_600, 91440, 20_000_000);

    const figAlign = blk.alignment ?? 'center';
    const picRun = renderPictureRunXml(relId, imgIndex, cxEmu, cyEmu, filename);
    const figPara = renderParagraphXml(picRun, {
      align: figAlign,
      spaceBeforeTwip,
      spaceAfterTwip: 0,
      indentLeftTwip: figAlign === 'center' ? 0 : indentLeftTwip,
      indentRightTwip: figAlign === 'center' ? 0 : indentRightTwip,
    });

    if (blk.caption) {
      const capPara = renderParagraphXml(
        renderRunXml(blk.caption, { italic: true, sizeHalfPt: 22 }),
        {
          align: figAlign,
          spaceBeforeTwip: 40,
          spaceAfterTwip: 0,
        }
      );
      return `${figPara}\n    ${capPara}`;
    }
    return figPara;
  }

  return '';
}

function buildSectPrXml(geom: PageGeometry): string {
  const orientAttr = geom.isLandscape ? ' w:orient="landscape"' : '';
  const pgW = finiteInt(geom.pageWidthTwips, 11906, 1440, 31_680);
  const pgH = finiteInt(geom.pageHeightTwips, 16838, 1440, 31_680);
  const mTop = finiteInt(geom.marginTopTwips, 850, 180, 7200);
  const mRight = finiteInt(geom.marginRightTwips, 850, 180, 7200);
  const mBottom = finiteInt(geom.marginBottomTwips, 850, 180, 7200);
  const mLeft = finiteInt(geom.marginLeftTwips, 1020, 180, 7200);
  return `<w:sectPr><w:pgSz w:w="${pgW}" w:h="${pgH}"${orientAttr}/><w:pgMar w:top="${mTop}" w:right="${mRight}" w:bottom="${mBottom}" w:left="${mLeft}" w:header="540" w:footer="540" w:gutter="0"/></w:sectPr>`;
}

function ensureCellEndsWithParagraph(xml: string): string {
  const trimmed = xml.trimEnd();
  if (!trimmed) {
    return renderParagraphXml('', { spaceBeforeTwip: 0, spaceAfterTwip: 0 });
  }
  if (trimmed.endsWith('</w:tbl>')) {
    return `${xml}${renderParagraphXml('', { exactLineHeightTwip: 20 })}`;
  }
  return xml;
}

export async function buildDocxBuffer(
  pages: PageExtraction[],
  options: {
    addPageBreaks?: boolean;
    choiceLayout?: ChoiceLayoutMode;
    mathFormat?: MathOutputFormat;
    underlineCorrectChoice?: boolean;
  } = {}
): Promise<Buffer> {
  const {
    addPageBreaks = true,
    choiceLayout = 'tabs',
    mathFormat = 'omml',
    underlineCorrectChoice = false,
  } = options;
  const mediaItems: MediaItem[] = [];
  const bodyChunks: string[] = [];

  const firstPage = pages[0];
  const defaultPageBaseFontPt =
    typeof firstPage?.base_font_size_pt === 'number' && Number.isFinite(firstPage.base_font_size_pt)
      ? Math.max(8, Math.min(20, firstPage.base_font_size_pt))
      : 12;
  const defaultStyleHalfPt = finiteInt(defaultPageBaseFontPt * 2, 24, 16, 40);

  const baseGeom = computePageGeometry({
    pageNumber: 1,
    pageWidthPx: firstPage?.pageWidthPx,
    pageHeightPx: firstPage?.pageHeightPx,
    page_size: firstPage?.page_size,
    is_landscape: firstPage?.is_landscape,
    margin_top_pt: firstPage?.margin_top_pt,
    margin_right_pt: firstPage?.margin_right_pt,
    margin_bottom_pt: firstPage?.margin_bottom_pt,
    margin_left_pt: firstPage?.margin_left_pt,
    blocks: pages.flatMap((p) => p.blocks),
  });

  const pushChunk = (chunk: string) => {
    if (!chunk) return;
    const prev = bodyChunks[bodyChunks.length - 1];
    if (prev && prev.trimEnd().endsWith('</w:tbl>') && chunk.trimStart().startsWith('<w:tbl>')) {
      bodyChunks.push(renderParagraphXml('', { exactLineHeightTwip: 20 }));
    }
    bodyChunks.push(chunk);
  };

  pages.forEach((page, pageIdx) => {
    const pageGeom = computePageGeometry(page);
    const sameOrientationAndSize =
      pageGeom.pageWidthTwips === baseGeom.pageWidthTwips &&
      pageGeom.pageHeightTwips === baseGeom.pageHeightTwips &&
      pageGeom.isLandscape === baseGeom.isLandscape;
    const geom = sameOrientationAndSize ? baseGeom : pageGeom;
    const pageBaseFontPt =
      typeof page.base_font_size_pt === 'number' && Number.isFinite(page.base_font_size_pt)
        ? Math.max(8, Math.min(20, page.base_font_size_pt))
        : defaultPageBaseFontPt;

    const transformedBlocks = transformBlocksForChoiceLayout(
      page.blocks,
      choiceLayout,
      geom,
      underlineCorrectChoice
    );
    const bands = groupBlocksIntoVisualBands(transformedBlocks, geom);

    if (pageIdx > 0 && addPageBreaks) {
      const prevPageGeom = computePageGeometry(pages[pageIdx - 1]);
      const prevMatchesBase =
        prevPageGeom.pageWidthTwips === baseGeom.pageWidthTwips &&
        prevPageGeom.pageHeightTwips === baseGeom.pageHeightTwips &&
        prevPageGeom.isLandscape === baseGeom.isLandscape;
      const prevGeom = prevMatchesBase ? baseGeom : prevPageGeom;

      if (
        prevGeom.pageWidthTwips !== geom.pageWidthTwips ||
        prevGeom.pageHeightTwips !== geom.pageHeightTwips ||
        prevGeom.isLandscape !== geom.isLandscape
      ) {
        pushChunk(`<w:p><w:pPr>${buildSectPrXml(prevGeom)}</w:pPr></w:p>`);
      } else {
        pushChunk('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
      }
    }

    for (const band of bands) {
      const xml = renderBandXml(band, geom, mediaItems, {
        availableWidthTwips: geom.contentWidthTwips,
        mathFormat,
        pageBaseFontPt,
      });
      if (xml) pushChunk(xml);
    }
  });

  // Microsoft Word requires <w:body> to have at least one paragraph and NEVER end directly with </w:tbl> before <w:sectPr>
  const lastBodyChunk = bodyChunks[bodyChunks.length - 1];
  if (!lastBodyChunk || lastBodyChunk.trimEnd().endsWith('</w:tbl>')) {
    bodyChunks.push(renderParagraphXml('', { exactLineHeightTwip: 20 }));
  }

  const lastPageGeom = computePageGeometry(pages[pages.length - 1] ?? { pageNumber: 1, blocks: [] });
  const lastGeom =
    lastPageGeom.pageWidthTwips === baseGeom.pageWidthTwips &&
    lastPageGeom.pageHeightTwips === baseGeom.pageHeightTwips &&
    lastPageGeom.isLandscape === baseGeom.isLandscape
      ? baseGeom
      : lastPageGeom;
  const sectPr = buildSectPrXml(lastGeom);

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    ${bodyChunks.join('\n    ')}
    ${sectPr}
  </w:body>
</w:document>`;

  const hasPng = mediaItems.some((item) => item.filename.endsWith('.png'));
  const hasJpg = mediaItems.some((item) => item.filename.endsWith('.jpg'));
  const mediaContentTypes = [
    hasPng ? '  <Default Extension="png" ContentType="image/png"/>' : '',
    hasJpg ? '  <Default Extension="jpg" ContentType="image/jpeg"/>' : '',
  ]
    .filter(Boolean)
    .join('\n');

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-officedocument.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>${mediaContentTypes ? `\n${mediaContentTypes}` : ''}
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRelsItems = [
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>',
    ...mediaItems.map(
      (item) =>
        `<Relationship Id="${item.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${item.filename}"/>`
    ),
  ];

  const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${docRelsItems.join('\n  ')}
</Relationships>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/>
        <w:b w:val="0"/>
        <w:bCs w:val="0"/>
        <w:i w:val="0"/>
        <w:iCs w:val="0"/>
        <w:color w:val="000000"/>
        <w:sz w:val="${defaultStyleHalfPt}"/>
        <w:szCs w:val="${defaultStyleHalfPt}"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr/>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/>
      <w:sz w:val="${defaultStyleHalfPt}"/>
      <w:szCs w:val="${defaultStyleHalfPt}"/>
    </w:rPr>
  </w:style>
  <w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont">
    <w:name w:val="Default Paragraph Font"/>
    <w:uiPriority w:val="1"/>
    <w:semiHidden/>
    <w:unhideWhenUsed/>
  </w:style>
  <w:style w:type="table" w:default="1" w:styleId="TableNormal">
    <w:name w:val="Normal Table"/>
    <w:uiPriority w:val="99"/>
    <w:semiHidden/>
    <w:unhideWhenUsed/>
    <w:tblPr>
      <w:tblInd w:w="0" w:type="dxa"/>
      <w:tblCellMar>
        <w:top w:w="0" w:type="dxa"/>
        <w:left w:w="108" w:type="dxa"/>
        <w:bottom w:w="0" w:type="dxa"/>
        <w:right w:w="108" w:type="dxa"/>
      </w:tblCellMar>
    </w:tblPr>
  </w:style>
</w:styles>`;

  const settingsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
  <w:defaultTabStop w:val="720"/>
  <m:mathPr>
    <m:mathFont m:val="Cambria Math"/>
    <m:brkBin m:val="before"/>
    <m:brkBinSub m:val="--"/>
    <m:smallFrac m:val="0"/>
    <m:dispDef/>
    <m:lMargin m:val="0"/>
    <m:rMargin m:val="0"/>
    <m:defJc m:val="centerGroup"/>
    <m:wrapIndent m:val="1440"/>
    <m:intLim m:val="subSup"/>
    <m:naryLim m:val="undOvr"/>
  </m:mathPr>
</w:settings>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypesXml, { createFolders: false });
  zip.file('_rels/.rels', rootRelsXml, { createFolders: false });
  zip.file('word/_rels/document.xml.rels', docRelsXml, { createFolders: false });
  zip.file('word/styles.xml', stylesXml, { createFolders: false });
  zip.file('word/settings.xml', settingsXml, { createFolders: false });
  zip.file('word/document.xml', documentXml, { createFolders: false });

  for (const media of mediaItems) {
    zip.file(`word/media/${media.filename}`, media.data, { createFolders: false });
  }

  return await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 1 },
  });
}
