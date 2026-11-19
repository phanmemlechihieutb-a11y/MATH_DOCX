import type {
  BlockAlignment,
  DocumentBlock,
  InlineSegment,
  PageExtraction,
  TableCellData,
} from '../types/document.ts';
import { splitTextPreservingInlineMath } from './latexParser.ts';
import { cleanLatexDelimiters, normalizeHexColor } from './layoutMetrics.ts';

export interface TextColorSwatch {
  label: string;
  hex: string; // 6-digit uppercase hex without '#'
}

export const TEXT_COLOR_SWATCHES: TextColorSwatch[] = [
  { label: 'Đen mặc định', hex: '000000' },
  { label: 'Đỏ tươi', hex: 'FF0000' },
  { label: 'Đỏ đô', hex: 'C00000' },
  { label: 'Xanh dương', hex: '0000FF' },
  { label: 'Xanh Word', hex: '0070C0' },
  { label: 'Xanh đậm', hex: '002060' },
  { label: 'Xanh lá', hex: '008000' },
  { label: 'Tím', hex: '7030A0' },
  { label: 'Cam đậm', hex: 'E36C0A' },
];

type InlineStyleAttrs = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  font_size_pt?: number;
  color?: string;
};

function isDefaultBlackHex(hex?: string | null): boolean {
  const norm = normalizeHexColor(hex);
  return !norm || norm === '000000';
}

function getEffectiveStyleKey(seg: InlineSegment): string {
  const hex = isDefaultBlackHex(seg.color) ? '' : (normalizeHexColor(seg.color) ?? '');
  return `${seg.bold ? 1 : 0}|${seg.italic ? 1 : 0}|${seg.underline ? 1 : 0}|${hex}`;
}

function wrapStyledRun(
  rawInner: string,
  style: { bold: boolean; italic: boolean; underline: boolean; color: string }
): string {
  if (!rawInner) return '';
  const hasStyle = style.bold || style.italic || style.underline || Boolean(style.color);
  if (!hasStyle) return rawInner;

  // Keep leading/trailing plain spaces outside inline formatting markers so markers
  // stay clean and unambiguous (e.g. "**Câu 1.** " instead of "**Câu 1. **").
  const leadMatch = rawInner.match(/^(\s*)/);
  const trailMatch = rawInner.match(/(\s*)$/);
  const lead = leadMatch ? leadMatch[1] : '';
  const trail = trailMatch ? trailMatch[1] : '';
  const coreEnd = rawInner.length - trail.length;
  const core = coreEnd > lead.length ? rawInner.slice(lead.length, coreEnd) : '';

  if (!core) {
    return rawInner;
  }

  let out = core;
  if (style.underline) {
    out = `__${out}__`;
  }
  if (style.bold && style.italic) {
    out = `***${out}***`;
  } else if (style.bold) {
    out = `**${out}**`;
  } else if (style.italic) {
    out = `*${out}*`;
  }
  if (style.color) {
    out = `[#${style.color}]{${out}}`;
  }

  return `${lead}${out}${trail}`;
}

/**
 * Serializes InlineSegment[] into a human-readable, lossless editable string
 * supporting $...$ inline math plus inline **bold**, *italic*, __underline__,
 * and [#RRGGBB]{...} text color.
 */
export function segmentsToEditableString(segments?: InlineSegment[] | null): string {
  if (!segments || segments.length === 0) return '';

  const parts: string[] = [];
  let runContent = '';
  let runKey = '';
  let runStyle = { bold: false, italic: false, underline: false, color: '' };

  const flushRun = () => {
    if (!runContent) return;
    parts.push(wrapStyledRun(runContent, runStyle));
    runContent = '';
    runKey = '';
  };

  segments.forEach((seg, idx) => {
    if (seg.tab_before && idx > 0) {
      flushRun();
      parts.push('\t');
    }

    const piece =
      seg.type === 'math'
        ? `$${cleanLatexDelimiters(seg.content ?? '')}$`
        : (seg.content ?? '');

    if (!piece) return;

    const hex = isDefaultBlackHex(seg.color) ? '' : (normalizeHexColor(seg.color) ?? '');
    const key = getEffectiveStyleKey(seg);

    if (runContent && key === runKey) {
      runContent += piece;
    } else {
      flushRun();
      runContent = piece;
      runKey = key;
      runStyle = {
        bold: Boolean(seg.bold),
        italic: Boolean(seg.italic),
        underline: Boolean(seg.underline),
        color: hex,
      };
    }
  });

  flushRun();
  return parts.join('');
}

function findClosingInlineMath(text: string, openDollarIdx: number): number {
  const isDouble = text[openDollarIdx + 1] === '$';
  const step = isDouble ? 2 : 1;
  let i = openDollarIdx + step;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (isDouble) {
      if (text[i] === '$' && text[i + 1] === '$') return i;
    } else if (text[i] === '$') {
      return i;
    }
    i += 1;
  }
  return -1;
}

function findMatchingBrace(text: string, openBraceIdx: number): number {
  let depth = 0;
  let i = openBraceIdx;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === '$') {
      const closeMath = findClosingInlineMath(text, i);
      if (closeMath !== -1) {
        i = closeMath + (text[i + 1] === '$' ? 2 : 1);
        continue;
      }
    }
    if (text[i] === '{') {
      depth += 1;
    } else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

function findClosingMarker(
  text: string,
  fromIdx: number,
  marker: '***' | '**' | '__' | '*'
): number {
  const mLen = marker.length;
  let i = fromIdx;
  while (i <= text.length - mLen) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === '$') {
      const closeMath = findClosingInlineMath(text, i);
      if (closeMath !== -1) {
        i = closeMath + (text[i + 1] === '$' ? 2 : 1);
        continue;
      }
    }
    const colorMatch = text.slice(i).match(/^\[#[0-9A-Fa-f]{6}\]\{/);
    if (colorMatch) {
      const openBrace = i + colorMatch[0].length - 1;
      const closeBrace = findMatchingBrace(text, openBrace);
      if (closeBrace !== -1) {
        i = closeBrace + 1;
        continue;
      }
    }

    if (text.startsWith(marker, i)) {
      if (marker === '*') {
        // Single '*' must not match '**' and must not follow whitespace
        const prevChar = i > fromIdx ? text[i - 1] : '';
        const nextChar = text[i + 1] ?? '';
        if (nextChar === '*') {
          // Skip over embedded '**...**'
          const innerBoldClose = findClosingMarker(text, i + 2, '**');
          if (innerBoldClose !== -1) {
            i = innerBoldClose + 2;
            continue;
          }
        }
        if (i > fromIdx && !/\s/.test(prevChar)) {
          return i;
        }
      } else if (i > fromIdx) {
        return i;
      }
    }
    i += 1;
  }
  return -1;
}

function parseRichInlineText(
  text: string,
  style: InlineStyleAttrs
): InlineSegment[] {
  const out: InlineSegment[] = [];
  let plainBuf = '';

  const flushPlain = () => {
    if (!plainBuf) return;
    const parsed = splitTextPreservingInlineMath(plainBuf, style);
    out.push(...parsed);
    plainBuf = '';
  };

  let i = 0;
  while (i < text.length) {
    // 1. Color span: [#RRGGBB]{...}
    if (text[i] === '[') {
      const colorMatch = text.slice(i).match(/^\[#([0-9A-Fa-f]{6})\]\{/);
      if (colorMatch) {
        const openBrace = i + colorMatch[0].length - 1;
        const closeBrace = findMatchingBrace(text, openBrace);
        if (closeBrace !== -1) {
          flushPlain();
          const hex = colorMatch[1].toUpperCase();
          const inner = text.slice(openBrace + 1, closeBrace);
          const nextStyle: InlineStyleAttrs = {
            ...style,
            ...(isDefaultBlackHex(hex) ? {} : { color: hex }),
          };
          if (isDefaultBlackHex(hex)) {
            delete nextStyle.color;
          }
          out.push(...parseRichInlineText(inner, nextStyle));
          i = closeBrace + 1;
          continue;
        }
      }
    }

    // 2. Inline math: $...$ or $$...$$
    if (text[i] === '$' && (i === 0 || text[i - 1] !== '\\')) {
      const isDouble = text[i + 1] === '$';
      const step = isDouble ? 2 : 1;
      const closeIdx = findClosingInlineMath(text, i);
      if (closeIdx !== -1) {
        flushPlain();
        const inner = cleanLatexDelimiters(text.slice(i + step, closeIdx));
        if (inner) {
          out.push({
            type: 'math',
            content: inner,
            ...style,
          });
        }
        i = closeIdx + step;
        continue;
      }
    }

    // 3. Bold + Italic: ***...***
    if (text.startsWith('***', i)) {
      const closeIdx = findClosingMarker(text, i + 3, '***');
      if (closeIdx !== -1) {
        flushPlain();
        const inner = text.slice(i + 3, closeIdx);
        out.push(...parseRichInlineText(inner, { ...style, bold: true, italic: true }));
        i = closeIdx + 3;
        continue;
      }
    }

    // 4. Bold: **...**
    if (text.startsWith('**', i)) {
      const closeIdx = findClosingMarker(text, i + 2, '**');
      if (closeIdx !== -1) {
        flushPlain();
        const inner = text.slice(i + 2, closeIdx);
        out.push(...parseRichInlineText(inner, { ...style, bold: true }));
        i = closeIdx + 2;
        continue;
      }
    }

    // 5. Underline: __...__
    if (text.startsWith('__', i)) {
      const closeIdx = findClosingMarker(text, i + 2, '__');
      if (closeIdx !== -1) {
        flushPlain();
        const inner = text.slice(i + 2, closeIdx);
        out.push(...parseRichInlineText(inner, { ...style, underline: true }));
        i = closeIdx + 2;
        continue;
      }
    }

    // 6. Italic: *...* (must not be followed by space or '*')
    if (
      text[i] === '*' &&
      i + 1 < text.length &&
      text[i + 1] !== '*' &&
      !/\s/.test(text[i + 1])
    ) {
      const closeIdx = findClosingMarker(text, i + 1, '*');
      if (closeIdx !== -1) {
        flushPlain();
        const inner = text.slice(i + 1, closeIdx);
        out.push(...parseRichInlineText(inner, { ...style, italic: true }));
        i = closeIdx + 1;
        continue;
      }
    }

    plainBuf += text[i];
    i += 1;
  }

  flushPlain();
  return out;
}

function getBaseFontSize(segments?: InlineSegment[] | null): number | undefined {
  if (!segments || segments.length === 0) return undefined;
  const firstWithSize = segments.find(
    (s) => typeof s.font_size_pt === 'number' && Number.isFinite(s.font_size_pt)
  );
  return typeof firstWithSize?.font_size_pt === 'number'
    ? firstWithSize.font_size_pt
    : undefined;
}

export function editableStringToSegments(
  rawText: string,
  templateSegments?: InlineSegment[] | null,
  styleOverride?: Partial<Pick<InlineSegment, 'bold' | 'italic' | 'underline' | 'font_size_pt' | 'color'>>
): InlineSegment[] {
  if (!rawText) return [];

  const templateFontSize = getBaseFontSize(templateSegments);
  const overrideFontSize =
    typeof styleOverride?.font_size_pt === 'number' && Number.isFinite(styleOverride.font_size_pt)
      ? styleOverride.font_size_pt
      : undefined;
  const effectiveFontSize = overrideFontSize ?? templateFontSize;
  const effectiveColor =
    styleOverride?.color !== undefined
      ? isDefaultBlackHex(styleOverride.color)
        ? undefined
        : (normalizeHexColor(styleOverride.color) ?? undefined)
      : undefined;

  const baseStyle: InlineStyleAttrs = {
    ...(styleOverride?.bold !== undefined ? { bold: Boolean(styleOverride.bold) } : {}),
    ...(styleOverride?.italic !== undefined ? { italic: Boolean(styleOverride.italic) } : {}),
    ...(styleOverride?.underline !== undefined ? { underline: Boolean(styleOverride.underline) } : {}),
    ...(typeof effectiveFontSize === 'number' ? { font_size_pt: effectiveFontSize } : {}),
    ...(effectiveColor ? { color: effectiveColor } : {}),
  };

  // Preserve original tab spacing/leader metadata across edits
  const templateTabMeta = (templateSegments ?? [])
    .filter((s, idx) => Boolean(s.tab_before) && idx > 0)
    .map((s) => ({
      tab_width_pt: s.tab_width_pt,
      tab_leader: s.tab_leader,
    }));

  const tabParts = rawText.split('\t');
  const out: InlineSegment[] = [];

  tabParts.forEach((part, tabIdx) => {
    const parsed = parseRichInlineText(part, baseStyle);
    const tabMeta = tabIdx > 0 ? templateTabMeta[tabIdx - 1] : undefined;
    const tabExtra: Partial<InlineSegment> =
      tabIdx > 0
        ? {
            tab_before: true,
            ...(typeof tabMeta?.tab_width_pt === 'number' ? { tab_width_pt: tabMeta.tab_width_pt } : {}),
            ...(tabMeta?.tab_leader ? { tab_leader: tabMeta.tab_leader } : {}),
          }
        : {};

    if (parsed.length === 0) {
      if (tabIdx > 0) {
        out.push({ type: 'text', content: '', ...tabExtra, ...baseStyle });
      }
      return;
    }

    if (tabIdx > 0) {
      parsed[0] = { ...parsed[0], ...tabExtra };
    }
    out.push(...parsed);
  });

  return out;
}

export function isUniformBlockStyle(
  segments: InlineSegment[] | null | undefined,
  prop: 'bold' | 'italic' | 'underline'
): boolean {
  if (!segments || segments.length === 0) return false;
  const nonEmpty = segments.filter((s) => (s.content ?? '').trim().length > 0);
  if (nonEmpty.length === 0) return false;
  return nonEmpty.every((s) => Boolean(s[prop]));
}

export function getUniformBlockColor(
  segments: InlineSegment[] | null | undefined
): string | null {
  if (!segments || segments.length === 0) return null;
  const nonEmpty = segments.filter((s) => (s.content ?? '').trim().length > 0);
  if (nonEmpty.length === 0) return null;
  const firstHex = isDefaultBlackHex(nonEmpty[0].color)
    ? null
    : (normalizeHexColor(nonEmpty[0].color) ?? null);
  for (let i = 1; i < nonEmpty.length; i++) {
    const hex = isDefaultBlackHex(nonEmpty[i].color)
      ? null
      : (normalizeHexColor(nonEmpty[i].color) ?? null);
    if (hex !== firstHex) return null;
  }
  return firstHex;
}

/**
 * Toggles bold, italic, or underline either on the selected range [start, end)
 * or on the entire editable string when there is no selection.
 */
export function toggleInlineStyleInEditableText(
  text: string,
  start: number,
  end: number,
  prop: 'bold' | 'italic' | 'underline'
): { text: string; start: number; end: number } {
  const safeStart = Math.max(0, Math.min(text.length, start));
  const safeEnd = Math.max(safeStart, Math.min(text.length, end));

  if (safeStart < safeEnd) {
    const marker = prop === 'bold' ? '**' : prop === 'underline' ? '__' : '*';
    const mLen = marker.length;
    const selected = text.slice(safeStart, safeEnd);

    // Check if selection itself is wrapped by marker
    if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length > mLen * 2) {
      const unwrapped = selected.slice(mLen, -mLen);
      return {
        text: text.slice(0, safeStart) + unwrapped + text.slice(safeEnd),
        start: safeStart,
        end: safeStart + unwrapped.length,
      };
    }

    // Check if immediately surrounded by marker outside selection
    if (
      safeStart >= mLen &&
      text.slice(safeStart - mLen, safeStart) === marker &&
      text.slice(safeEnd, safeEnd + mLen) === marker
    ) {
      return {
        text: text.slice(0, safeStart - mLen) + selected + text.slice(safeEnd + mLen),
        start: safeStart - mLen,
        end: safeEnd - mLen,
      };
    }

    // Wrap selection, keeping outer whitespace outside markers
    const leadMatch = selected.match(/^(\s*)/);
    const trailMatch = selected.match(/(\s*)$/);
    const lead = leadMatch ? leadMatch[1] : '';
    const trail = trailMatch ? trailMatch[1] : '';
    const core = selected.slice(lead.length, selected.length - trail.length);
    if (!core) return { text, start: safeStart, end: safeEnd };

    const wrapped = `${lead}${marker}${core}${marker}${trail}`;
    return {
      text: text.slice(0, safeStart) + wrapped + text.slice(safeEnd),
      start: safeStart + lead.length,
      end: safeStart + wrapped.length - trail.length,
    };
  }

  // No selection: toggle across the whole editable string while preserving other styles
  const segs = editableStringToSegments(text);
  if (segs.length === 0) return { text, start: safeStart, end: safeEnd };
  const nextVal = !isUniformBlockStyle(segs, prop);
  const updated = segs.map((s) => ({
    ...s,
    [prop]: nextVal,
  }));
  const nextText = segmentsToEditableString(updated);
  return { text: nextText, start: nextText.length, end: nextText.length };
}

/**
 * Applies a hex color (e.g. 'C00000' or '000000'/null to reset to black)
 * either to the selected range [start, end) or to the entire editable string.
 */
export function applyColorInEditableText(
  text: string,
  start: number,
  end: number,
  hexColor: string | null
): { text: string; start: number; end: number } {
  const safeStart = Math.max(0, Math.min(text.length, start));
  const safeEnd = Math.max(safeStart, Math.min(text.length, end));
  const normHex = isDefaultBlackHex(hexColor) ? null : (normalizeHexColor(hexColor) ?? null);

  if (safeStart < safeEnd) {
    let selected = text.slice(safeStart, safeEnd);
    // Strip an outer [#XXXXXX]{...} if the user selected the whole colored span
    const outerMatch = selected.match(/^\[#[0-9A-Fa-f]{6}\]\{([\s\S]*)\}$/);
    if (outerMatch) {
      selected = outerMatch[1];
    }

    if (!normHex) {
      // Remove color from the selected span
      const segs = editableStringToSegments(selected).map((s) => {
        const copy = { ...s };
        delete copy.color;
        return copy;
      });
      const cleaned = segmentsToEditableString(segs);
      return {
        text: text.slice(0, safeStart) + cleaned + text.slice(safeEnd),
        start: safeStart,
        end: safeStart + cleaned.length,
      };
    }

    const leadMatch = selected.match(/^(\s*)/);
    const trailMatch = selected.match(/(\s*)$/);
    const lead = leadMatch ? leadMatch[1] : '';
    const trail = trailMatch ? trailMatch[1] : '';
    const core = selected.slice(lead.length, selected.length - trail.length);
    if (!core) return { text, start: safeStart, end: safeEnd };

    const wrapped = `${lead}[#${normHex}]{${core}}${trail}`;
    return {
      text: text.slice(0, safeStart) + wrapped + text.slice(safeEnd),
      start: safeStart + lead.length,
      end: safeStart + wrapped.length - trail.length,
    };
  }

  // No selection: apply color to whole editable string while preserving bold/italic/underline/math
  const segs = editableStringToSegments(text);
  if (segs.length === 0) return { text, start: safeStart, end: safeEnd };
  const updated = segs.map((s) => {
    const copy = { ...s };
    if (normHex) {
      copy.color = normHex;
    } else {
      delete copy.color;
    }
    return copy;
  });
  const nextText = segmentsToEditableString(updated);
  return { text: nextText, start: nextText.length, end: nextText.length };
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
