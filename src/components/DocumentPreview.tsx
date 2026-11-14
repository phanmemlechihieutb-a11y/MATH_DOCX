import type { CSSProperties } from 'react';
import type {
  ChoiceLayoutMode,
  DocumentBlock,
  InlineSegment,
  MathOutputFormat,
  PageExtraction,
} from '../types/document';
import {
  cleanLatexDelimiters,
  computePageGeometry,
  groupBlocksIntoVisualBands,
  groupSegmentsByTabs,
  isValidBox,
  normalizeHexColor,
  transformBlocksForChoiceLayout,
  type PageGeometry,
} from '../utils/layoutMetrics';
import { MathRenderer } from './MathRenderer';

interface DocumentPreviewProps {
  pages: PageExtraction[];
  choiceLayout?: ChoiceLayoutMode;
  mathFormat?: MathOutputFormat;
  onSelectEquation?: (latex: string, isDisplay: boolean) => void;
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
  onSelectEquation,
}: {
  segments?: InlineSegment[] | null;
  defaultBold?: boolean;
  baseFontPt?: number;
  scale?: number;
  mathFormat?: MathOutputFormat;
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
                className="inline-flex items-center px-0.5 mx-0.5 rounded hover:bg-blue-50 hover:ring-1 hover:ring-blue-300 transition-colors align-baseline cursor-pointer"
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
          defaultBold={true}
          baseFontPt={baseFontPt}
          scale={scale}
          mathFormat={mathFormat}
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
          <button
            type="button"
            onClick={() => onSelectEquation?.(blk.latex ?? '', true)}
            title="Công thức LaTeX bọc $...$ — nhấn để xem chi tiết"
            className="font-mono px-2 py-1 rounded-md bg-amber-50 text-slate-900 border border-amber-200/80 hover:bg-amber-100/80 transition-colors cursor-pointer"
          >
            {latexText}
          </button>
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
        <button
          type="button"
          onClick={() => onSelectEquation?.(blk.latex ?? '', true)}
          title="Nhấn để xem mã LaTeX và XML OMML"
          className="px-2 py-1 rounded-md hover:bg-blue-50 hover:ring-1 hover:ring-blue-300 transition-colors cursor-pointer"
        >
          <MathRenderer latex={blk.latex} displayMode={true} />
        </button>
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
                        defaultBold={isHeader}
                        baseFontPt={isBorderless ? baseFontPt : Math.min(baseFontPt, 11)}
                        scale={scale}
                        mathFormat={mathFormat}
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
}: DocumentPreviewProps) {
  if (pages.length === 0) {
    return null;
  }

  return (
    <div className="space-y-6">
      {pages.map((page) => {
        const geom = computePageGeometry(page);
        const transformedBlocks = transformBlocksForChoiceLayout(page.blocks, choiceLayout, geom);
        const bands = groupBlocksIntoVisualBands(transformedBlocks, geom);
        const previewWidthPx = geom.isLandscape ? 880 : 780;
        const scale = previewWidthPx / geom.pageWidthPt;

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
                    <RenderSingleBlock
                      key={idx}
                      blk={band.block}
                      pageNumber={page.pageNumber}
                      geom={geom}
                      scale={scale}
                      spaceBeforePt={band.spaceBeforePt}
                      indentLeftPt={band.indentLeftPt}
                      indentRightPt={band.indentRightPt}
                      firstLineIndentPt={band.firstLineIndentPt}
                      mathFormat={mathFormat}
                      onSelectEquation={onSelectEquation}
                    />
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
                      <RenderSingleBlock
                        blk={band.left}
                        pageNumber={page.pageNumber}
                        geom={geom}
                        scale={scale}
                        spaceBeforePt={0}
                        indentLeftPt={0}
                        indentRightPt={0}
                        firstLineIndentPt={0}
                        mathFormat={mathFormat}
                        onSelectEquation={onSelectEquation}
                      />
                    </div>
                    <div>
                      <RenderSingleBlock
                        blk={band.right}
                        pageNumber={page.pageNumber}
                        geom={geom}
                        scale={scale}
                        spaceBeforePt={0}
                        indentLeftPt={0}
                        indentRightPt={0}
                        firstLineIndentPt={0}
                        mathFormat={mathFormat}
                        onSelectEquation={onSelectEquation}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        );
      })}
    </div>
  );
}
