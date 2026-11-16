import type {
  DocumentBlock,
  InlineSegment,
  PageExtraction,
} from '../types/document.ts';
import type { EmbeddedFigureAsset } from './latexParser.ts';
import { cleanLatexDelimiters, normalizeHexColor } from './layoutMetrics.ts';

function escapeLatexPlainText(text: string): string {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([%&#_{}])/g, '\\$1')
    .replace(/\$/g, '\\$');
}

function formatTextSegment(seg: InlineSegment): string {
  const raw = seg.content ?? '';
  if (!raw) return '';

  // Keep leading/trailing whitespace outside styling wrappers for cleaner LaTeX
  const leadMatch = raw.match(/^\s*/);
  const trailMatch = raw.match(/\s*$/);
  const lead = leadMatch ? leadMatch[0] : '';
  const trail = trailMatch && trailMatch[0].length < raw.length ? trailMatch[0] : '';
  const core = raw.slice(lead.length, raw.length - trail.length);

  if (!core) return raw;

  let out = escapeLatexPlainText(core).replace(/\n/g, ' \\\\\n');
  if (seg.underline) out = `\\underline{${out}}`;
  if (seg.italic) out = `\\textit{${out}}`;
  if (seg.bold) out = `\\textbf{${out}}`;

  const hex = normalizeHexColor(seg.color);
  if (hex && hex !== '000000' && hex !== '0F172A' && hex !== '111827') {
    out = `\\textcolor{#${hex}}{${out}}`;
  }

  return `${lead}${out}${trail}`;
}

function segmentsToLatex(segments?: InlineSegment[] | null, inTableCell = false): string {
  if (!segments || segments.length === 0) return '';

  const parts: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const tabPrefix = seg.tab_before && i > 0 ? ' \\qquad ' : '';

    if (seg.type === 'math') {
      const inner = cleanLatexDelimiters(seg.content ?? '');
      if (!inner) continue;
      let mathOut = `$${inner}$`;
      const hex = normalizeHexColor(seg.color);
      if (hex && hex !== '000000' && hex !== '0F172A' && hex !== '111827') {
        mathOut = `\\textcolor{#${hex}}{${mathOut}}`;
      }
      parts.push(`${tabPrefix}${mathOut}`);
    } else {
      let textOut = formatTextSegment(seg);
      if (inTableCell) {
        textOut = textOut.replace(/ \\\\\n/g, ' ');
      }
      parts.push(`${tabPrefix}${textOut}`);
    }
  }

  return parts.join('').replace(/[ \t]+\n/g, '\n').trim();
}

function wrapAlignment(content: string, alignment: DocumentBlock['alignment']): string {
  if (!content) return '';
  if (alignment === 'center') {
    return `\\begin{center}\n${content}\n\\end{center}`;
  }
  if (alignment === 'right') {
    return `\\begin{flushright}\n${content}\n\\end{flushright}`;
  }
  return content;
}

export function pagesToLatexSource(pages: PageExtraction[]): {
  latex: string;
  assets: Record<string, EmbeddedFigureAsset>;
} {
  const assets: Record<string, EmbeddedFigureAsset> = {};
  const pageStrings: string[] = [];
  let figCounter = 0;

  for (const page of pages) {
    const blockStrings: string[] = [];

    for (const blk of page.blocks) {
      if (blk.block_type === 'horizontal_rule') {
        blockStrings.push('\\hrule');
        continue;
      }

      if (blk.block_type === 'equation') {
        const inner = cleanLatexDelimiters(blk.latex ?? '');
        if (inner) {
          blockStrings.push(`\\[\n${inner}\n\\]`);
        }
        continue;
      }

      if (blk.block_type === 'figure') {
        if (blk.croppedImageDataUrl) {
          figCounter += 1;
          const key = `hinh_p${page.pageNumber}_${figCounter}`;
          assets[key] = {
            dataUrl: blk.croppedImageDataUrl,
            widthPx: blk.croppedWidthPx ?? 420,
            heightPx: blk.croppedHeightPx ?? 300,
            caption: blk.caption ?? null,
          };
          const body = blk.caption
            ? `\\includegraphics{${key}}\n\\\\\n\\textit{${escapeLatexPlainText(blk.caption)}}`
            : `\\includegraphics{${key}}`;
          blockStrings.push(wrapAlignment(body, blk.alignment === 'left' || blk.alignment === 'right' ? blk.alignment : 'center'));
        } else if (blk.caption) {
          blockStrings.push(wrapAlignment(`\\textit{${escapeLatexPlainText(blk.caption)}}`, 'center'));
        }
        continue;
      }

      if (blk.block_type === 'table' && blk.table_rows && blk.table_rows.length > 0) {
        const colCount = Math.max(
          1,
          ...blk.table_rows.map((row) =>
            row.reduce((acc, cell) => acc + Math.max(1, cell.col_span ?? 1), 0)
          )
        );
        const firstRowAligns = Array.from({ length: colCount }, (_, cIdx) => {
          const align = blk.table_rows?.[0]?.[cIdx]?.alignment;
          return align === 'center' ? 'c' : align === 'right' ? 'r' : 'l';
        });
        const isBorderless = Boolean(blk.table_borderless);
        const colSpec = isBorderless
          ? firstRowAligns.join('')
          : `|${firstRowAligns.join('|')}|`;

        const rowLines = blk.table_rows.map((row) => {
          const cells = row.map((cell) => segmentsToLatex(cell.segments, true) || ' ');
          return `  ${cells.join(' & ')} \\\\`;
        });

        const tableBody = isBorderless
          ? rowLines.join('\n')
          : `  \\hline\n${rowLines.join('\n  \\hline\n')}\n  \\hline`;

        const tblLatex = `\\begin{tabular}{${colSpec}}\n${tableBody}\n\\end{tabular}`;
        blockStrings.push(
          blk.alignment === 'center' ? `\\begin{center}\n${tblLatex}\n\\end{center}` : tblLatex
        );
        continue;
      }

      if (blk.block_type === 'heading') {
        const inner = segmentsToLatex(blk.segments);
        if (!inner) continue;
        const cmd =
          blk.heading_level === 1
            ? `\\section*{${inner}}`
            : blk.heading_level === 3
            ? `\\subsubsection*{${inner}}`
            : `\\subsection*{${inner}}`;
        blockStrings.push(blk.alignment === 'center' ? wrapAlignment(cmd, 'center') : cmd);
        continue;
      }

      const paraText = segmentsToLatex(blk.segments);
      if (paraText) {
        blockStrings.push(wrapAlignment(paraText, blk.alignment));
      }
    }

    if (blockStrings.length > 0) {
      pageStrings.push(blockStrings.join('\n\n'));
    }
  }

  return {
    latex: pageStrings.join('\n\n\\newpage\n\n'),
    assets,
  };
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findWhitespaceFlexibleRegex(
  haystack: string,
  needle: string,
  fromIndex = 0,
  toIndex = haystack.length
): { start: number; end: number } | null {
  const cleanNeedle = needle.trim();
  if (!cleanNeedle) return null;

  const slice = haystack.slice(fromIndex, toIndex);
  const directIdx = slice.indexOf(cleanNeedle);
  if (directIdx !== -1) {
    return {
      start: fromIndex + directIdx,
      end: fromIndex + directIdx + cleanNeedle.length,
    };
  }

  // Try flexible whitespace + optional LaTeX escaping/wrappers between tokens
  const tokens = cleanNeedle.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const pattern = tokens.map((t) => escapeRegExp(t)).join('\\s*');
  try {
    const re = new RegExp(pattern, 'i');
    const m = re.exec(slice);
    if (m) {
      return {
        start: fromIndex + m.index,
        end: fromIndex + m.index + m[0].length,
      };
    }
  } catch {
    // ignore invalid regex
  }

  return null;
}

function extractBlockAnchorStrings(blk: DocumentBlock, renderedFallback: string): string[] {
  const anchors: string[] = [];

  if (blk.block_type === 'equation' && blk.latex) {
    const clean = cleanLatexDelimiters(blk.latex);
    if (clean) anchors.push(clean);
  }

  const segTextParts: string[] = [];
  for (const seg of blk.segments ?? []) {
    if (seg.type === 'math' && seg.content) {
      const clean = cleanLatexDelimiters(seg.content);
      if (clean) anchors.push(clean);
    } else if (seg.type === 'text' && seg.content?.trim()) {
      segTextParts.push(seg.content.trim());
    }
  }

  const joinedText = segTextParts.join(' ').replace(/\s+/g, ' ').trim();
  if (joinedText) {
    if (joinedText.length >= 6) anchors.push(joinedText.slice(0, 48));
    if (joinedText.length >= 4) anchors.push(joinedText.slice(0, 24));
    const leadWords = joinedText.split(/\s+/).slice(0, 4).join(' ');
    if (leadWords.length >= 3) anchors.push(leadWords);
  }

  if (blk.table_rows) {
    for (const row of blk.table_rows.slice(0, 2)) {
      for (const cell of row.slice(0, 3)) {
        for (const seg of cell.segments ?? []) {
          if (seg.type === 'math' && seg.content) {
            const clean = cleanLatexDelimiters(seg.content);
            if (clean) anchors.push(clean);
          } else if (seg.type === 'text' && seg.content?.trim().length >= 3) {
            anchors.push(seg.content.trim().slice(0, 32));
          }
        }
      }
    }
  }

  const cleanFallback = renderedFallback.replace(/\s+/g, ' ').trim();
  if (cleanFallback.length >= 4) {
    anchors.push(cleanFallback.slice(0, 40));
    anchors.push(cleanFallback.slice(0, 18));
  }

  return Array.from(new Set(anchors.filter((a) => a.trim().length >= 2)));
}

export function findLatexCursorForPreviewClick(params: {
  latexSource: string;
  block: DocumentBlock;
  blockFlatIndex: number;
  totalBlocks: number;
  clickedText: string;
  clickedMathLatex?: string;
  blockRenderedText: string;
}): { start: number; end: number } | null {
  const {
    latexSource,
    block,
    blockFlatIndex,
    totalBlocks,
    clickedText,
    clickedMathLatex,
    blockRenderedText,
  } = params;

  if (!latexSource) return null;

  const expectedOffset = Math.round(
    (Math.max(0, blockFlatIndex) / Math.max(1, totalBlocks)) * latexSource.length
  );

  const anchors = extractBlockAnchorStrings(block, blockRenderedText);
  let bestAnchorMatch: { start: number; end: number; score: number } | null = null;

  for (const anchor of anchors) {
    const clean = anchor.trim();
    if (!clean) continue;
    const tokens = clean.split(/\s+/).filter(Boolean);
    const rePattern = tokens.map((t) => escapeRegExp(t)).join('(?:\\s|\\\\[a-zA-Z]+\\{|\\{|\\})*');
    let re: RegExp;
    try {
      re = new RegExp(rePattern, 'gi');
    } catch {
      continue;
    }

    let m: RegExpExecArray | null;
    while ((m = re.exec(latexSource)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      const distRatio = Math.abs(m.index - expectedOffset) / Math.max(1, latexSource.length);
      const lengthBonus = Math.min(clean.length, 40) * 0.015;
      const score = lengthBonus - distRatio;
      if (!bestAnchorMatch || score > bestAnchorMatch.score) {
        bestAnchorMatch = {
          start: m.index,
          end: m.index + m[0].length,
          score,
        };
      }
    }
  }

  const windowStart = bestAnchorMatch ? Math.max(0, bestAnchorMatch.start - 60) : 0;
  const windowEnd = bestAnchorMatch
    ? Math.min(latexSource.length, bestAnchorMatch.end + 420)
    : latexSource.length;

  // 1. If user Ctrl+double-clicked a specific math expression, locate that exact LaTeX inside the block window
  if (clickedMathLatex) {
    const cleanMath = cleanLatexDelimiters(clickedMathLatex);
    if (cleanMath) {
      const inWindow = findWhitespaceFlexibleRegex(latexSource, cleanMath, windowStart, windowEnd);
      if (inWindow) return inWindow;

      // Fallback anywhere closest to expectedOffset
      const anywhere = findWhitespaceFlexibleRegex(latexSource, cleanMath, 0, latexSource.length);
      if (anywhere) return anywhere;
    }
  }

  // 2. If user Ctrl+double-clicked a specific word/phrase, locate that exact word inside the block window
  const cleanWord = clickedText.replace(/\s+/g, ' ').trim();
  if (cleanWord) {
    const inWindow = findWhitespaceFlexibleRegex(latexSource, cleanWord, windowStart, windowEnd);
    if (inWindow) return inWindow;

    // Try shorter first/last token if multi-token selection included punctuation
    const firstWord = cleanWord.split(/[\s,.;:!?()]+/).find((w) => w.length >= 2);
    if (firstWord) {
      const tokenInWindow = findWhitespaceFlexibleRegex(latexSource, firstWord, windowStart, windowEnd);
      if (tokenInWindow) return tokenInWindow;
    }
  }

  // 3. Fallback to the matched block anchor itself
  if (bestAnchorMatch) {
    return { start: bestAnchorMatch.start, end: bestAnchorMatch.end };
  }

  // 4. Final fallback: search clicked word nearest to expectedOffset
  if (cleanWord) {
    const tokens = cleanWord.split(/\s+/).filter(Boolean);
    const re = new RegExp(tokens.map(escapeRegExp).join('\\s*'), 'gi');
    let nearest: { start: number; end: number; dist: number } | null = null;
    let m: RegExpExecArray | null;
    while ((m = re.exec(latexSource)) !== null) {
      const dist = Math.abs(m.index - expectedOffset);
      if (!nearest || dist < nearest.dist) {
        nearest = { start: m.index, end: m.index + m[0].length, dist };
      }
    }
    if (nearest) return { start: nearest.start, end: nearest.end };
  }

  const clamped = Math.max(0, Math.min(latexSource.length, expectedOffset));
  return { start: clamped, end: clamped };
}
