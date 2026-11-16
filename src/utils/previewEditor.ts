import type {
  BlockAlignment,
  DocumentBlock,
  InlineSegment,
  PageExtraction,
  TableCellData,
} from '../types/document.ts';
import { splitTextPreservingInlineMath } from './latexParser.ts';
import { cleanLatexDelimiters } from './layoutMetrics.ts';

const LEADING_LABEL_REGEX =
  /^(Câu\s+\d+\s*[\.:]?|Bài\s+\d+\s*[\.:]?|Ví dụ\s+\d+\s*[\.:]?|Phần\s+[IVXLC\d]+\s*[\.:]?|Chương\s+\d+\s*[\.:]?|[A-Da-d][\.\):])(?:\s+|$)/i;

function getDominantTextStyle(
  segments?: InlineSegment[] | null
): Omit<InlineSegment, 'type' | 'content' | 'tab_before'> {
  if (!segments || segments.length === 0) return {};
  const textSegs = segments.filter((s) => s.type === 'text' && (s.content ?? '').trim().length > 0);
  const sample = textSegs.length > 0 ? textSegs : segments;
  const first = sample[0];

  const allBold = sample.length > 0 && sample.every((s) => Boolean(s.bold));
  const allItalic = sample.length > 0 && sample.every((s) => Boolean(s.italic));
  const allUnderline = sample.length > 0 && sample.every((s) => Boolean(s.underline));

  return {
    ...(allBold ? { bold: true } : {}),
    ...(allItalic ? { italic: true } : {}),
    ...(allUnderline ? { underline: true } : {}),
    ...(typeof first.font_size_pt === 'number' ? { font_size_pt: first.font_size_pt } : {}),
    ...(first.color ? { color: first.color } : {}),
  };
}

export function segmentsToEditableString(segments?: InlineSegment[] | null): string {
  if (!segments || segments.length === 0) return '';
  return segments
    .map((seg, idx) => {
      const prefix = seg.tab_before && idx > 0 ? '\t' : '';
      if (seg.type === 'math') {
        const inner = cleanLatexDelimiters(seg.content ?? '');
        return `${prefix}$${inner}$`;
      }
      return `${prefix}${seg.content ?? ''}`;
    })
    .join('');
}

export function editableStringToSegments(
  rawText: string,
  templateSegments?: InlineSegment[] | null,
  styleOverride?: Partial<Pick<InlineSegment, 'bold' | 'italic' | 'underline' | 'font_size_pt' | 'color'>>
): InlineSegment[] {
  const baseStyle = {
    ...getDominantTextStyle(templateSegments),
    ...(styleOverride ?? {}),
  };

  if (!rawText) return [];

  const hadBoldLeadingLabel = Boolean(
    templateSegments &&
      templateSegments.length > 1 &&
      templateSegments[0]?.type === 'text' &&
      templateSegments[0]?.bold &&
      LEADING_LABEL_REGEX.test((templateSegments[0].content ?? '').trimStart())
  );

  const tabParts = rawText.split('\t');
  const out: InlineSegment[] = [];

  tabParts.forEach((part, tabIdx) => {
    const parsed = splitTextPreservingInlineMath(part, baseStyle);
    if (parsed.length === 0) {
      if (tabIdx > 0) {
        out.push({ type: 'text', content: '', tab_before: true, ...baseStyle });
      }
      return;
    }

    if (
      hadBoldLeadingLabel &&
      !baseStyle.bold &&
      parsed[0]?.type === 'text' &&
      !parsed[0].bold
    ) {
      const match = parsed[0].content.match(LEADING_LABEL_REGEX);
      if (match && match[0]) {
        const labelLen = match[0].length;
        const labelText = parsed[0].content.slice(0, labelLen);
        const restText = parsed[0].content.slice(labelLen);
        const firstSeg: InlineSegment = {
          ...parsed[0],
          content: labelText,
          bold: true,
          ...(tabIdx > 0 ? { tab_before: true } : {}),
        };
        out.push(firstSeg);
        if (restText.length > 0) {
          out.push({
            ...parsed[0],
            content: restText,
            bold: false,
          });
        }
        out.push(...parsed.slice(1));
        return;
      }
    }

    if (tabIdx > 0) {
      parsed[0] = { ...parsed[0], tab_before: true };
    }
    out.push(...parsed);
  });

  return out;
}

export function isUniformBlockStyle(
  segments: InlineSegment[] | null | undefined,
  prop: 'bold' | 'italic'
): boolean {
  if (!segments || segments.length === 0) return false;
  const nonEmpty = segments.filter((s) => (s.content ?? '').trim().length > 0);
  if (nonEmpty.length === 0) return false;
  return nonEmpty.every((s) => Boolean(s[prop]));
}

export function applyAlignmentToBlock(
  blk: DocumentBlock,
  alignment: BlockAlignment
): DocumentBlock {
  return { ...blk, alignment };
}

export function updateTableCellText(
  blk: DocumentBlock,
  rowIdx: number,
  colIdx: number,
  rawText: string
): DocumentBlock {
  const rows = blk.table_rows ?? [];
  const nextRows: TableCellData[][] = rows.map((row, r) =>
    r !== rowIdx
      ? row
      : row.map((cell, c) =>
          c !== colIdx
            ? cell
            : {
                ...cell,
                segments: editableStringToSegments(rawText, cell.segments),
              }
        )
  );
  return { ...blk, table_rows: nextRows };
}

export function createNewBlock(
  kind: 'paragraph' | 'heading' | 'equation'
): DocumentBlock {
  if (kind === 'equation') {
    return {
      block_type: 'equation',
      alignment: 'center',
      latex: 'x = \\frac{-b \\pm \\sqrt{\\Delta}}{2a}',
      font_size_pt: 12,
      line_spacing: 1.25,
    };
  }
  if (kind === 'heading') {
    return {
      block_type: 'heading',
      alignment: 'left',
      heading_level: 2,
      font_size_pt: 13,
      line_spacing: 1.25,
      segments: [{ type: 'text', content: 'Tiêu đề mới', bold: true }],
    };
  }
  return {
    block_type: 'paragraph',
    alignment: 'left',
    font_size_pt: 12,
    line_spacing: 1.25,
    segments: [{ type: 'text', content: 'Nội dung đoạn văn mới...' }],
  };
}

export function mutatePageBlock(
  pages: PageExtraction[],
  pageNumber: number,
  updater: (blocks: DocumentBlock[]) => DocumentBlock[]
): PageExtraction[] {
  return pages.map((page) =>
    page.pageNumber === pageNumber
      ? { ...page, blocks: updater([...page.blocks]) }
      : page
  );
}
