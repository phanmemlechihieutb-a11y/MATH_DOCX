import JSZip from 'jszip';
import type {
  BlockAlignment,
  ChoiceLayoutMode,
  DocumentBlock,
  InlineSegment,
  MathOutputFormat,
  PageExtraction,
} from '../src/types/document.ts';
import { splitTextPreservingInlineMath } from '../src/utils/latexParser.ts';
import {
  computePageGeometry,
  groupBlocksIntoVisualBands,
  isValidBox,
  normalizeHexColor,
  transformBlocksForChoiceLayout,
  type PageGeometry,
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

function ptToTwips(pt: number): number {
  return Math.max(0, Math.round(pt * 20));
}

function getBlockSizeHalfPt(blk: DocumentBlock): number {
  if (typeof blk.font_size_pt === 'number' && Number.isFinite(blk.font_size_pt)) {
    const clamped = Math.max(7, Math.min(48, blk.font_size_pt));
    return Math.round(clamped * 2);
  }
  if (blk.block_type === 'heading') {
    const level = blk.heading_level === 1 ? 1 : blk.heading_level === 3 ? 3 : 2;
    const sizeMap: Record<number, number> = { 1: 30, 2: 26, 3: 24 };
    return sizeMap[level];
  }
  if (blk.block_type === 'table') return 22;
  return 24;
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
  const sz = Math.max(14, Math.min(96, Math.round(sizeHalfPt)));
  // Strict ECMA-376 CT_RPr order: rFonts -> b -> i -> color -> sz -> szCs -> u
  const rPrParts = [
    '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/>',
  ];
  if (bold) rPrParts.push('<w:b/>');
  if (italic) rPrParts.push('<w:i/>');
  if (colorHex) rPrParts.push(`<w:color w:val="${colorHex}"/>`);
  rPrParts.push(`<w:sz w:val="${sz}"/>`, `<w:szCs w:val="${sz}"/>`);
  if (underline) rPrParts.push('<w:u w:val="single"/>');

  const safeText = escapeXml(text);
  const needsPreserve = /^\s|\s$|\s{2,}/.test(text);
  const preserve = needsPreserve ? ' xml:space="preserve"' : '';
  return `<w:r><w:rPr>${rPrParts.join('')}</w:rPr><w:t${preserve}>${safeText}</w:t></w:r>`;
}

function renderSegmentsXml(
  segments: InlineSegment[] | null | undefined,
  options: { sizeHalfPt?: number; defaultBold?: boolean; mathFormat?: MathOutputFormat } = {}
): string {
  if (!segments || segments.length === 0) return '';
  const { sizeHalfPt = 24, defaultBold = false, mathFormat = 'omml' } = options;
  const out: string[] = [];

  const normalizedSegments: InlineSegment[] = [];
  for (const seg of segments) {
    if (
      mathFormat === 'omml' &&
      seg.type === 'text' &&
      seg.content &&
      (seg.content.includes('$') ||
        seg.content.includes('＄') ||
        seg.content.includes('\\(') ||
        seg.content.includes('\\['))
    ) {
      const { type: _t, content, tab_before, ...style } = seg;
      const split = splitTextPreservingInlineMath(content, style);
      if (tab_before && split.length > 0) {
        split[0] = { ...split[0], tab_before: true };
      }
      normalizedSegments.push(...split);
    } else {
      normalizedSegments.push(seg);
    }
  }

  for (const seg of normalizedSegments) {
    if (seg.tab_before) {
      out.push('<w:r><w:tab/></w:r>');
    }

    const segSizeHalfPt =
      typeof seg.font_size_pt === 'number' && Number.isFinite(seg.font_size_pt)
        ? Math.round(Math.max(7, Math.min(48, seg.font_size_pt)) * 2)
        : sizeHalfPt;
    const colorHex = normalizeHexColor(seg.color);
    const isBold = seg.bold !== undefined ? Boolean(seg.bold) : defaultBold;

    if (seg.type === 'math') {
      if (mathFormat === 'latex') {
        const cleaned = cleanLatex(seg.content);
        if (cleaned) {
          out.push(
            renderRunXml(`$${cleaned}$`, {
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
      const lines = (seg.content ?? '').split('\n');
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
    bottomBorder = false,
  } = options;

  const jc = ALIGN_MAP[align] ?? 'left';
  const keepNextXml = keepNext ? '<w:keepNext/>' : '';
  const borderXml = bottomBorder
    ? '<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="334155"/></w:pBdr>'
    : '';

  const cleanTabStops =
    tabStopsTwip && tabStopsTwip.length > 0
      ? Array.from(
          new Set(tabStopsTwip.filter((p) => Number.isFinite(p) && p > 0).map((p) => Math.round(p)))
        ).sort((a, b) => a - b)
      : [];

  const tabsXml =
    cleanTabStops.length > 0
      ? `<w:tabs>${cleanTabStops
          .map((pos) => `<w:tab w:val="left" w:pos="${pos}"/>`)
          .join('')}</w:tabs>`
      : '';

  const indAttrs: string[] = [];
  if (firstLineIndentTwip < -20) {
    const hanging = Math.round(Math.abs(firstLineIndentTwip));
    indAttrs.push(`w:left="${Math.round(indentLeftTwip + hanging)}"`);
    indAttrs.push(`w:hanging="${hanging}"`);
  } else {
    if (indentLeftTwip > 0) indAttrs.push(`w:left="${Math.round(indentLeftTwip)}"`);
    if (firstLineIndentTwip > 20) indAttrs.push(`w:firstLine="${Math.round(firstLineIndentTwip)}"`);
  }
  if (indentRightTwip > 0) indAttrs.push(`w:right="${Math.round(indentRightTwip)}"`);
  const indXml = indAttrs.length > 0 ? `<w:ind ${indAttrs.join(' ')}/>` : '';

  const spacingXml =
    exactLineHeightTwip !== undefined
      ? `<w:spacing w:before="0" w:after="0" w:line="${Math.max(
          20,
          Math.round(exactLineHeightTwip)
        )}" w:lineRule="exact"/>`
      : `<w:spacing w:before="${Math.round(spaceBeforeTwip)}" w:after="${Math.round(
          spaceAfterTwip
        )}" w:line="${Math.round(lineSpacing240)}" w:lineRule="auto"/>`;

  return `<w:p><w:pPr>${keepNextXml}${borderXml}${tabsXml}${spacingXml}${indXml}<w:jc w:val="${jc}"/></w:pPr>${innerXml}</w:p>`;
}

function renderTableXml(
  block: DocumentBlock,
  options: {
    availableWidthTwips: number;
    indentLeftTwip?: number;
    spaceBeforeTwip?: number;
    mathFormat?: MathOutputFormat;
  }
): string {
  const rows = block.table_rows ?? [];
  if (rows.length === 0) return '';

  const maxCols = Math.max(
    ...rows.map((r) => r.reduce((acc, c) => acc + Math.max(1, c.col_span ?? 1), 0)),
    0
  );
  if (maxCols === 0) return '';

  const {
    availableWidthTwips,
    indentLeftTwip = 0,
    spaceBeforeTwip = 0,
    mathFormat = 'omml',
  } = options;
  const totalWidthDxa = Math.max(2400, Math.round(availableWidthTwips));
  const isBorderless = Boolean(block.table_borderless);

  const colWidthsDxa: number[] = new Array(maxCols).fill(Math.floor(totalWidthDxa / maxCols));
  const rowWithWidths = rows.find(
    (r) =>
      r.length === maxCols &&
      r.every(
        (c) =>
          typeof c.width_pct === 'number' &&
          (c.width_pct ?? 0) > 0 &&
          !(c.col_span && c.col_span > 1)
      )
  );
  if (rowWithWidths) {
    const pctSum = rowWithWidths.reduce((s, c) => s + (c.width_pct ?? 0), 0);
    if (pctSum > 0) {
      let assigned = 0;
      rowWithWidths.forEach((c, idx) => {
        if (idx === maxCols - 1) {
          colWidthsDxa[idx] = Math.max(360, totalWidthDxa - assigned);
        } else {
          const w = Math.max(360, Math.round(((c.width_pct ?? 0) / pctSum) * totalWidthDxa));
          colWidthsDxa[idx] = w;
          assigned += w;
        }
      });
    }
  }

  const gridCols = colWidthsDxa.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  const tblIndXml =
    indentLeftTwip > 20 ? `<w:tblInd w:w="${Math.round(indentLeftTwip)}" w:type="dxa"/>` : '';

  const bordersXml = isBorderless
    ? '<w:tblBorders><w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/></w:tblBorders>'
    : '<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="64748B"/><w:left w:val="single" w:sz="4" w:space="0" w:color="64748B"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="64748B"/><w:right w:val="single" w:sz="4" w:space="0" w:color="64748B"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/></w:tblBorders>';

  const cellMarXml = isBorderless
    ? '<w:tblCellMar><w:top w:w="20" w:type="dxa"/><w:left w:w="40" w:type="dxa"/><w:bottom w:w="20" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tblCellMar>'
    : '<w:tblCellMar><w:top w:w="70" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>';

  const tblPr = `<w:tblPr><w:tblW w:w="${totalWidthDxa}" w:type="dxa"/>${tblIndXml}${bordersXml}${cellMarXml}</w:tblPr>`;

  const defaultSizeHalfPt =
    typeof block.font_size_pt === 'number' && Number.isFinite(block.font_size_pt)
      ? Math.round(Math.max(7, Math.min(48, block.font_size_pt)) * 2)
      : isBorderless
      ? 24
      : 22;

  const lineSpacing240 =
    typeof block.line_spacing === 'number' && Number.isFinite(block.line_spacing)
      ? Math.round(Math.max(0.9, Math.min(2.5, block.line_spacing)) * 240)
      : isBorderless
      ? 264
      : 240;

  const rowsXml = rows
    .map((row) => {
      let colCursor = 0;
      const cellsXml: string[] = [];

      for (const cell of row) {
        if (colCursor >= maxCols) break;
        const span = Math.max(1, Math.min(maxCols - colCursor, cell.col_span ?? 1));
        const cellWidthDxa = colWidthsDxa
          .slice(colCursor, colCursor + span)
          .reduce((a, b) => a + b, 0);
        colCursor += span;

        const isHeader = Boolean(cell.is_header) && !isBorderless;
        const shading = isHeader ? '<w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/>' : '';
        const gridSpanXml = span > 1 ? `<w:gridSpan w:val="${span}"/>` : '';
        const cellAlign: BlockAlignment = cell.alignment ?? (isHeader ? 'center' : 'left');
        const segXml = renderSegmentsXml(cell.segments, {
          sizeHalfPt: defaultSizeHalfPt,
          defaultBold: isHeader,
          mathFormat,
        });
        const cellPara = renderParagraphXml(segXml, {
          align: cellAlign,
          spaceBeforeTwip: 0,
          spaceAfterTwip: 0,
          lineSpacing240,
        });
        cellsXml.push(
          `<w:tc><w:tcPr><w:tcW w:w="${cellWidthDxa}" w:type="dxa"/>${gridSpanXml}${shading}</w:tcPr>${cellPara}</w:tc>`
        );
      }

      while (colCursor < maxCols) {
        const w = colWidthsDxa[colCursor] ?? Math.floor(totalWidthDxa / maxCols);
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
    spaceBeforeTwip > 40
      ? renderParagraphXml('', {
          exactLineHeightTwip: Math.min(2400, spaceBeforeTwip),
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
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cxEmu}" cy="${cyEmu}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${docPrId}" name="${escapeXml(
    name
  )}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${escapeXml(
    name
  )}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cxEmu}" cy="${cyEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
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
    mathFormat?: MathOutputFormat;
  }
): string {
  const {
    spaceBeforeTwip,
    indentLeftTwip,
    indentRightTwip,
    firstLineIndentTwip,
    availableWidthTwips,
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
    const sizeHalfPt = getBlockSizeHalfPt(blk);
    const inner = renderSegmentsXml(blk.segments, {
      sizeHalfPt,
      defaultBold: true,
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
    });
  }

  if (blk.block_type === 'paragraph') {
    const sizeHalfPt = getBlockSizeHalfPt(blk);
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
    });
  }

  if (blk.block_type === 'equation' && blk.latex) {
    const sizeHalfPt = getBlockSizeHalfPt(blk);
    const eqAlign = blk.alignment ?? 'center';
    if (mathFormat === 'latex') {
      const cleaned = cleanLatex(blk.latex);
      return renderParagraphXml(cleaned ? renderRunXml(`$${cleaned}$`, { sizeHalfPt }) : '', {
        align: eqAlign,
        spaceBeforeTwip,
        spaceAfterTwip: 0,
        indentLeftTwip: eqAlign === 'center' ? 0 : indentLeftTwip,
        indentRightTwip: eqAlign === 'center' ? 0 : indentRightTwip,
      });
    }
    const omml = latexToOmmlXml(blk.latex, true, {
      sizeHalfPt,
      align: eqAlign,
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
    return renderParagraphXml(renderRunXml(cleanLatex(blk.latex), { sizeHalfPt }), {
      align: eqAlign,
      spaceBeforeTwip,
      spaceAfterTwip: 0,
      indentLeftTwip: eqAlign === 'center' ? 0 : indentLeftTwip,
    });
  }

  if (blk.block_type === 'table') {
    return renderTableXml(blk, {
      availableWidthTwips: Math.max(2400, availableWidthTwips - indentLeftTwip - indentRightTwip),
      indentLeftTwip,
      spaceBeforeTwip,
      mathFormat,
    });
  }

  if (blk.block_type === 'figure' && blk.croppedImageDataUrl) {
    const base64Match = blk.croppedImageDataUrl.match(/^data:image\/png;base64,(.+)$/);
    if (!base64Match) return '';

    const imgIndex = mediaItems.length + 1;
    const relId = `rIdImg${imgIndex}`;
    const filename = `image${imgIndex}.png`;
    mediaItems.push({
      id: relId,
      filename,
      data: Buffer.from(base64Match[1], 'base64'),
    });

    const widthPx = Math.max(40, blk.croppedWidthPx ?? 600);
    const heightPx = Math.max(40, blk.croppedHeightPx ?? 400);
    const box = isValidBox(blk.box_2d) ? blk.box_2d : null;
    const maxAvailWidthIn = Math.max(1.2, availableWidthTwips / 1440);
    const rawBoxWidthIn = box
      ? ((box[3] - box[1]) / 1000) * (geom.pageWidthPt / 72)
      : maxAvailWidthIn * 0.6;
    const targetWidthIn = Math.max(0.8, Math.min(maxAvailWidthIn * 0.96, rawBoxWidthIn));
    const cxEmu = Math.round(targetWidthIn * 914400);
    const cyEmu = Math.round(cxEmu * (heightPx / widthPx));

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
  return `<w:sectPr><w:pgSz w:w="${geom.pageWidthTwips}" w:h="${geom.pageHeightTwips}"${orientAttr}/><w:pgMar w:top="${geom.marginTopTwips}" w:right="${geom.marginRightTwips}" w:bottom="${geom.marginBottomTwips}" w:left="${geom.marginLeftTwips}" w:header="540" w:footer="540" w:gutter="0"/></w:sectPr>`;
}

export async function buildDocxBuffer(
  pages: PageExtraction[],
  options: {
    addPageBreaks?: boolean;
    choiceLayout?: ChoiceLayoutMode;
    mathFormat?: MathOutputFormat;
  } = {}
): Promise<Buffer> {
  const { addPageBreaks = true, choiceLayout = 'tabs', mathFormat = 'omml' } = options;
  const mediaItems: MediaItem[] = [];
  const bodyChunks: string[] = [];

  const baseGeom = computePageGeometry({
    pageNumber: 1,
    pageWidthPx: pages[0]?.pageWidthPx,
    pageHeightPx: pages[0]?.pageHeightPx,
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

    const transformedBlocks = transformBlocksForChoiceLayout(page.blocks, choiceLayout, geom);
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
      if (band.kind === 'single') {
        const xml = renderSingleBlockXml(band.block, geom, mediaItems, {
          spaceBeforeTwip: ptToTwips(band.spaceBeforePt),
          indentLeftTwip: ptToTwips(band.indentLeftPt),
          indentRightTwip: ptToTwips(band.indentRightPt),
          firstLineIndentTwip: Math.round(band.firstLineIndentPt * 20),
          availableWidthTwips: geom.contentWidthTwips,
          mathFormat,
        });
        if (xml) pushChunk(xml);
      } else {
        const indentLeftTwip = ptToTwips(band.indentLeftPt);
        const indentRightTwip = ptToTwips(band.indentRightPt);
        const totalBandWidth = Math.max(
          2800,
          geom.contentWidthTwips - indentLeftTwip - indentRightTwip
        );
        const leftWidthDxa = Math.round((band.leftWidthPct / 100) * totalBandWidth);
        const rightWidthDxa = Math.max(1000, totalBandWidth - leftWidthDxa);

        const leftXml =
          renderSingleBlockXml(band.left, geom, mediaItems, {
            spaceBeforeTwip: 0,
            indentLeftTwip: 0,
            indentRightTwip: 0,
            firstLineIndentTwip: 0,
            availableWidthTwips: leftWidthDxa,
            mathFormat,
          }) || renderParagraphXml('', { spaceBeforeTwip: 0, spaceAfterTwip: 0 });

        const rightXml =
          renderSingleBlockXml(band.right, geom, mediaItems, {
            spaceBeforeTwip: 0,
            indentLeftTwip: 0,
            indentRightTwip: 0,
            firstLineIndentTwip: 0,
            availableWidthTwips: rightWidthDxa,
            mathFormat,
          }) || renderParagraphXml('', { spaceBeforeTwip: 0, spaceAfterTwip: 0 });

        const tblIndXml =
          indentLeftTwip > 20 ? `<w:tblInd w:w="${indentLeftTwip}" w:type="dxa"/>` : '';
        const tblPr = `<w:tblPr><w:tblW w:w="${totalBandWidth}" w:type="dxa"/>${tblIndXml}<w:tblBorders><w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/></w:tblBorders><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="40" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tblCellMar></w:tblPr>`;
        const grid = `<w:tblGrid><w:gridCol w:w="${leftWidthDxa}"/><w:gridCol w:w="${rightWidthDxa}"/></w:tblGrid>`;
        const rowXml = `<w:tr><w:tc><w:tcPr><w:tcW w:w="${leftWidthDxa}" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>${leftXml}</w:tc><w:tc><w:tcPr><w:tcW w:w="${rightWidthDxa}" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>${rightXml}</w:tc></w:tr>`;

        const spacerBefore =
          band.spaceBeforePt > 2
            ? renderParagraphXml('', {
                exactLineHeightTwip: Math.min(2400, ptToTwips(band.spaceBeforePt)),
              })
            : '';

        pushChunk(`${spacerBefore}<w:tbl>${tblPr}${grid}${rowXml}</w:tbl>`);
      }
    }
  });

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

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-officedocument.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRelsItems = [
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
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
        <w:sz w:val="24"/>
        <w:szCs w:val="24"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr>
      <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/>
      <w:sz w:val="24"/>
      <w:szCs w:val="24"/>
    </w:rPr>
  </w:style>
</w:styles>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypesXml);
  zip.file('_rels/.rels', rootRelsXml);
  zip.file('word/_rels/document.xml.rels', docRelsXml);
  zip.file('word/styles.xml', stylesXml);
  zip.file('word/document.xml', documentXml);

  for (const media of mediaItems) {
    zip.file(`word/media/${media.filename}`, media.data);
  }

  return await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 1 },
  });
}
