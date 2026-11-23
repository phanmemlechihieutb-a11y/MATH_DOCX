import type {
  BlockAlignment,
  DocumentBlock,
  InlineSegment,
  PageExtraction,
  TableCellData,
  TabStopSpec,
} from '../types/document.ts';
import {
  computeTdplotMainCoordsStyle,
  evaluateTikzMathExpr,
  extractTikzStylesFromSetBody,
  renderLatexPictureToSvgDataUrl,
} from './tikzRenderer.ts';

export type LatexPasteMode = 'auto' | 'bare_latex';

const DISPLAY_MATH_ENVS = new Set([
  'equation',
  'equation*',
  'align',
  'align*',
  'aligned',
  'alignat',
  'alignat*',
  'alignedat',
  'split',
  'flalign',
  'flalign*',
  'gather',
  'gather*',
  'gathered',
  'multline',
  'multline*',
  'eqnarray',
  'eqnarray*',
  'displaymath',
  'cases',
  'dcases',
  'rcases',
  'pmatrix',
  'bmatrix',
  'vmatrix',
  'Vmatrix',
  'Bmatrix',
  'matrix',
  'smallmatrix',
  'array',
]);

const BARE_LATEX_CMD_RE =
  /\\(?:(?:frac|dfrac|tfrac|cfrac|binom|dbinom|sqrt|int|iint|iiint|oint|sum|prod|lim|limsup|liminf|limits|nolimits|displaystyle|textstyle|scriptstyle|scriptscriptstyle|underset|overset|mathop|operatorname|left|right|vec|overrightarrow|overleftarrow|widehat|widetilde|overline|bar|tilde|hat|heva|hoac|mathbb|mathcal|mathfrak|mathrm|sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|log|ln|lg|exp|max|min|sup|inf|alpha|beta|gamma|delta|Delta|epsilon|varepsilon|zeta|eta|theta|vartheta|lambda|mu|nu|xi|pi|rho|sigma|tau|phi|varphi|chi|psi|omega|Omega|Gamma|Theta|Lambda|Sigma|Phi|Psi|infty|partial|nabla|leq|geq|neq|approx|equiv|sim|simeq|cong|propto|pm|mp|times|cdot|div|ast|star|circ|bullet|in|notin|ni|subset|subseteq|supset|supseteq|cup|cap|setminus|emptyset|varnothing|forall|exists|nexists|neg|land|lor|Rightarrow|Leftrightarrow|Leftarrow|rightarrow|leftarrow|leftrightarrow|to|mapsto|implies|iff|dots|cdots|ldots|vdots|ddots)(?![a-zA-Z])|begin\{)/;

const LATEX_COLOR_MAP: Record<string, string> = {
  red: '#FF0000',
  crimson: '#DC143C',
  darkred: '#8B0000',
  maroon: '#800000',
  blue: '#0000FF',
  darkblue: '#00008B',
  navy: '#000080',
  navyblue: '#000080',
  royalblue: '#4169E1',
  dodgerblue: '#1E90FF',
  midnightblue: '#191970',
  cornflowerblue: '#6495ED',
  cerulean: '#00A2E3',
  skyblue: '#0284C7',
  processblue: '#00B0F0',
  bluegreen: '#00B3B8',
  cadetblue: '#5F9EA0',
  aquamarine: '#00B5BE',
  turquoise: '#00B4CC',
  green: '#008000',
  darkgreen: '#006400',
  forestgreen: '#228B22',
  pinegreen: '#008B72',
  junglegreen: '#00A99D',
  seagreen: '#3FBC9D',
  emerald: '#059669',
  limegreen: '#8DC73F',
  springgreen: '#7BC143',
  greenyellow: '#AFE138',
  yellowgreen: '#98CC70',
  olivegreen: '#3C8031',
  teal: '#008080',
  cyan: '#00FFFF',
  orange: '#FF8000',
  darkorange: '#FF8C00',
  burntorange: '#F7921D',
  redorange: '#F26035',
  orangered: '#FF4500',
  bittersweet: '#C04F17',
  peach: '#F7965A',
  apricot: '#FBB982',
  melon: '#F89E7B',
  salmon: '#F69289',
  yellow: '#FFFF00',
  goldenrod: '#DAA520',
  gold: '#FFD700',
  amber: '#D97706',
  dandelion: '#FDBC42',
  olive: '#808000',
  lime: '#00FF00',
  purple: '#800080',
  violet: '#800080',
  blueviolet: '#473992',
  darkorchid: '#A4538A',
  orchid: '#AF72B0',
  plum: '#92268F',
  mulberry: '#A93C93',
  lavender: '#F49EC4',
  thistle: '#D883B7',
  indigo: '#4B0082',
  periwinkle: '#7977B8',
  magenta: '#FF00FF',
  fuchsia: '#FF00FF',
  rhodamine: '#EF559F',
  rubinered: '#ED017D',
  wildstrawberry: '#EE2967',
  carnationpink: '#F282B4',
  pink: '#FFC0CB',
  redviolet: '#A1246B',
  violetred: '#EF58A0',
  brickred: '#B6321C',
  mahogany: '#A9341F',
  brown: '#804000',
  rawsienna: '#974006',
  sepia: '#671800',
  tan: '#DA9D76',
  gray: '#808080',
  grey: '#808080',
  lightgray: '#C0C0C0',
  lightgrey: '#C0C0C0',
  silver: '#C0C0C0',
  darkgray: '#404040',
  darkgrey: '#404040',
  black: '#000000',
  white: '#FFFFFF',
};

const FONT_SIZE_PT_MAP: Record<string, number> = {
  tiny: 7,
  scriptsize: 8,
  footnotesize: 9,
  small: 10,
  normalsize: 12,
  large: 13,
  Large: 15,
  LARGE: 17,
  huge: 20,
  Huge: 24,
};

interface InlineStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  vert_align?: 'subscript' | 'superscript';
  font_size_pt?: number;
  color?: string;
}

interface CustomTheoremDef {
  envName: string;
  title: string;
  unnumbered: boolean;
  sharedCounter?: string;
}

export interface EmbeddedFigureAsset {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  caption?: string | null;
  box_2d?: number[] | null;
}

export interface DocumentPageConfig {
  pageSize: 'a4' | 'a5' | 'letter';
  isLandscape: boolean;
  marginTopPt: number;
  marginRightPt: number;
  marginBottomPt: number;
  marginLeftPt: number;
  contentWidthPt: number;
  baseFontSizePt: number;
  defaultLineSpacing: number;
  defaultParIndentPt: number;
  defaultParSkipPt: number;
}

function createDefaultPageConfig(): DocumentPageConfig {
  return {
    pageSize: 'a4',
    isLandscape: false,
    marginTopPt: 54,
    marginRightPt: 54,
    marginBottomPt: 54,
    marginLeftPt: 54,
    contentWidthPt: 595.3 - 108,
    baseFontSizePt: 12,
    defaultLineSpacing: 1.18,
    defaultParIndentPt: 0,
    defaultParSkipPt: 0,
  };
}

function parseLatexLengthToPt(
  rawExpr: string,
  containerWidthPt = 487.3,
  baseFontPt = 12
): number | null {
  const s = (rawExpr ?? '').trim();
  if (!s) return null;
  const relMatch = s.match(
    /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))?\s*\\(textwidth|linewidth|columnwidth|hsize|paperwidth|baselineskip)\b/
  );
  if (relMatch) {
    const factor = relMatch[1] !== undefined ? parseFloat(relMatch[1]) : 1;
    if (!Number.isFinite(factor)) return null;
    const unit = relMatch[2];
    if (unit === 'paperwidth') return factor * 595.3;
    if (unit === 'baselineskip') return factor * baseFontPt * 1.2;
    return factor * containerWidthPt;
  }
  const absMatch = s.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(pt|bp|pc|in|cm|mm|em|ex)\b/i);
  if (absMatch) {
    const val = parseFloat(absMatch[1]);
    if (!Number.isFinite(val)) return null;
    const unit = absMatch[2].toLowerCase();
    switch (unit) {
      case 'pt':
      case 'bp':
        return val;
      case 'pc':
        return val * 12;
      case 'in':
        return val * 72;
      case 'cm':
        return val * 28.3465;
      case 'mm':
        return val * 2.83465;
      case 'em':
        return val * baseFontPt;
      case 'ex':
        return val * (baseFontPt * 0.48);
    }
  }
  return null;
}

interface ParserContext {
  sectionCount: number;
  subsectionCount: number;
  subsubsectionCount: number;
  inAppendix: boolean;
  isVietnamese: boolean;
  counters: Record<string, number>;
  labels: Record<string, string>;
  labelKinds: Record<string, string>;
  cites: Record<string, string>;
  lastNumberedTarget: string | null;
  lastNumberedKind: string | null;
  customTheorems: Record<string, CustomTheoremDef>;
  customColors: Record<string, string>;
  customTikzStyles: Record<string, string>;
  defaultTasksLabel?: string;
  figureAssets?: Record<string, EmbeddedFigureAsset>;
  pageConfig: DocumentPageConfig;
}

function createParserContext(
  initial?: Partial<
    Pick<
      ParserContext,
      'isVietnamese' | 'labels' | 'labelKinds' | 'cites' | 'customTheorems' | 'customColors' | 'customTikzStyles' | 'defaultTasksLabel' | 'figureAssets' | 'pageConfig'
    >
  >
): ParserContext {
  return {
    sectionCount: 0,
    subsectionCount: 0,
    subsubsectionCount: 0,
    inAppendix: false,
    isVietnamese: initial?.isVietnamese ?? true,
    counters: {},
    labels: initial?.labels ?? {},
    labelKinds: initial?.labelKinds ?? {},
    cites: initial?.cites ?? {},
    lastNumberedTarget: null,
    lastNumberedKind: null,
    customTheorems: initial?.customTheorems ?? {},
    customColors: initial?.customColors ?? {},
    customTikzStyles: initial?.customTikzStyles ?? {},
    defaultTasksLabel: initial?.defaultTasksLabel,
    figureAssets: initial?.figureAssets,
    pageConfig: initial?.pageConfig ?? createDefaultPageConfig(),
  };
}

function nextCounter(ctx: ParserContext, name: string): number {
  ctx.counters[name] = (ctx.counters[name] ?? 0) + 1;
  return ctx.counters[name];
}

function formatSectionNum(ctx: ParserContext): string {
  if (ctx.inAppendix && ctx.sectionCount >= 1 && ctx.sectionCount <= 26) {
    return String.fromCharCode(64 + ctx.sectionCount);
  }
  return String(ctx.sectionCount);
}

function formatTodayDate(isVietnamese: boolean): string {
  const now = new Date();
  if (isVietnamese) {
    return `Ngày ${now.getDate()} tháng ${now.getMonth() + 1} năm ${now.getFullYear()}`;
  }
  return now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function hexToRgbTuple(hex: string): [number, number, number] | null {
  const c = hex.replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(c)) return null;
  return [
    parseInt(c.slice(0, 2), 16),
    parseInt(c.slice(2, 4), 16),
    parseInt(c.slice(4, 6), 16),
  ];
}

function rgbTupleToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0').toUpperCase())
      .join('')
  );
}

function resolveSimpleColor(name: string, customColors?: Record<string, string>): string | undefined {
  let c = name.trim().toLowerCase();
  if (!c) return undefined;
  let invert = false;
  while (c.startsWith('-')) {
    invert = !invert;
    c = c.slice(1).trim();
  }
  let resolved: string | undefined;
  if (customColors && customColors[c]) resolved = customColors[c];
  else if (LATEX_COLOR_MAP[c]) resolved = LATEX_COLOR_MAP[c];
  else if (/^#?[0-9a-f]{6}$/i.test(c)) {
    resolved = c.startsWith('#') ? c.toUpperCase() : `#${c.toUpperCase()}`;
  } else if (/^#?[0-9a-f]{3}$/i.test(c)) {
    const clean = c.replace(/^#/, '').toUpperCase();
    resolved = `#${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`;
  }
  if (!resolved) return undefined;
  if (invert) {
    const rgb = hexToRgbTuple(resolved);
    if (rgb) return rgbTupleToHex(255 - rgb[0], 255 - rgb[1], 255 - rgb[2]);
  }
  return resolved;
}

function resolveLatexColor(raw: string, customColors?: Record<string, string>): string | undefined {
  const c = raw.trim().toLowerCase();
  if (!c) return undefined;
  const direct = resolveSimpleColor(c, customColors);
  if (direct) return direct;

  if (c.includes('!')) {
    const parts = c.split('!').map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return undefined;
    const firstHex = resolveSimpleColor(parts[0], customColors);
    if (!firstHex) return undefined;
    let acc = hexToRgbTuple(firstHex);
    if (!acc) return firstHex;

    let idx = 1;
    while (idx < parts.length) {
      const pct = parseFloat(parts[idx]);
      if (!Number.isFinite(pct)) break;
      const ratio = Math.max(0, Math.min(100, pct)) / 100;
      const nextPart = parts[idx + 1];
      let targetHex = '#FFFFFF';
      if (nextPart !== undefined && Number.isNaN(Number(nextPart))) {
        const resolvedNext = resolveSimpleColor(nextPart, customColors);
        if (resolvedNext) targetHex = resolvedNext;
        idx += 2;
      } else {
        idx += 1;
      }
      const rgb2 = hexToRgbTuple(targetHex);
      if (rgb2) {
        acc = [
          acc[0] * ratio + rgb2[0] * (1 - ratio),
          acc[1] * ratio + rgb2[1] * (1 - ratio),
          acc[2] * ratio + rgb2[2] * (1 - ratio),
        ];
      }
    }
    return rgbTupleToHex(acc[0], acc[1], acc[2]);
  }
  return undefined;
}

function resolveLatexModelAndSpec(
  modelRaw: string | undefined,
  specRaw: string,
  customColors?: Record<string, string>
): string | undefined {
  const spec = specRaw.trim();
  if (!spec) return undefined;
  if (!modelRaw) {
    return resolveLatexColor(spec, customColors);
  }
  const model = modelRaw.trim();
  const modelUpper = model.toUpperCase();
  if (modelUpper === 'HTML') {
    const cleaned = spec.replace(/^#/, '').toUpperCase();
    if (/^[0-9A-F]{6}$/.test(cleaned)) return `#${cleaned}`;
    if (/^[0-9A-F]{3}$/.test(cleaned)) {
      return `#${cleaned[0]}${cleaned[0]}${cleaned[1]}${cleaned[1]}${cleaned[2]}${cleaned[2]}`;
    }
  } else if (model === 'RGB') {
    const parts = spec.split(/[\s,]+/).filter(Boolean).map((p) => parseFloat(p));
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      return rgbTupleToHex(parts[0], parts[1], parts[2]);
    }
  } else if (model === 'rgb') {
    const parts = spec.split(/[\s,]+/).filter(Boolean).map((p) => parseFloat(p));
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      return rgbTupleToHex(parts[0] * 255, parts[1] * 255, parts[2] * 255);
    }
  } else if (model.toLowerCase() === 'gray') {
    const val = parseFloat(spec);
    if (Number.isFinite(val)) {
      const ratio = model === 'Gray' && val > 1 ? Math.max(0, Math.min(1, val / 15)) : Math.max(0, Math.min(1, val));
      const g = ratio * 255;
      return rgbTupleToHex(g, g, g);
    }
  } else if (modelUpper === 'CMYK') {
    const parts = spec.split(/[\s,]+/).filter(Boolean).map((p) => parseFloat(p));
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      const scale = model === 'CMYK' && parts.some((v) => v > 1) ? 100 : 1;
      const [c, m, y, k] = parts.map((v) => Math.max(0, Math.min(1, v / scale)));
      return rgbTupleToHex(
        255 * (1 - c) * (1 - k),
        255 * (1 - m) * (1 - k),
        255 * (1 - y) * (1 - k)
      );
    }
  } else if (model.toLowerCase() === 'named') {
    return resolveLatexColor(spec, customColors);
  }
  return resolveLatexColor(spec, customColors);
}

function isBlackLatexColor(specRaw: string, resolvedHex?: string): boolean {
  const s = specRaw.trim().toLowerCase();
  if (s === 'black') return true;
  return resolvedHex === '#000000';
}

function readBalancedBraces(
  src: string,
  openIdx: number
): { content: string; endIdx: number } | null {
  if (src[openIdx] !== '{') return null;
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length) {
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return {
          content: src.slice(openIdx + 1, i),
          endIdx: i,
        };
      }
    }
  }
  return null;
}

function readBalancedBrackets(
  src: string,
  openIdx: number
): { content: string; endIdx: number } | null {
  if (src[openIdx] !== '[') return null;
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length) {
      i++;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        return {
          content: src.slice(openIdx + 1, i),
          endIdx: i,
        };
      }
    }
  }
  return null;
}

function skipSpaces(src: string, idx: number): number {
  let i = idx;
  while (i < src.length && (src[i] === ' ' || src[i] === '\t' || src[i] === '\n')) {
    i++;
  }
  return i;
}

function extractBalancedKeyValOption(optStr: string, key: string): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keyRe = new RegExp(`(?:^|,)\\s*${escapedKey}\\s*=\\s*`);
  let depth = 0;
  for (let i = 0; i < optStr.length; i++) {
    const ch = optStr[i];
    if (ch === '\\' && i + 1 < optStr.length) {
      i++;
      continue;
    }
    if (ch === '{') {
      depth++;
      continue;
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) {
      const sub = optStr.slice(i);
      const m = sub.match(keyRe);
      if (m) {
        // Ensure we didn't match right after another comma inside a word unless at start or comma
        const valStart = i + m[0].length;
        const p = skipSpaces(optStr, valStart);
        if (optStr[p] === '{') {
          const br = readBalancedBraces(optStr, p);
          if (br) return br.content.trim();
        }
        let end = p;
        let vDepth = 0;
        while (end < optStr.length) {
          const c = optStr[end];
          if (c === '\\' && end + 1 < optStr.length) {
            end += 2;
            continue;
          }
          if (c === '{') vDepth++;
          else if (c === '}') {
            if (vDepth === 0) break;
            vDepth--;
          } else if (c === ',' && vDepth === 0) {
            break;
          }
          end++;
        }
        return optStr.slice(p, end).trim();
      }
    }
  }
  return undefined;
}

function boldLeadingChoiceMarker(segments: InlineSegment[]): InlineSegment[] {
  if (segments.length === 0) return segments;
  const s0 = segments[0];
  if (s0.type !== 'text') return segments;

  const fullM = s0.content.match(/^(\s*(?:[A-D]\.|[a-d]\))\s*)([\s\S]*)$/);
  if (fullM) {
    const labelPart = fullM[1];
    const restPart = fullM[2];
    const out: InlineSegment[] = [{ ...s0, content: labelPart, bold: true }];
    if (restPart) {
      out.push({ ...s0, content: restPart });
    }
    return [...out, ...segments.slice(1)];
  }

  // Case like \textbf{A}. $(5;2)$ where 'A' and '.' are split across adjacent text segments
  if (/^\s*(?:[A-D]|[a-d])\s*$/.test(s0.content) && segments[1]?.type === 'text') {
    const s1 = segments[1];
    const dotM = s1.content.match(/^([.\)]\s*)([\s\S]*)$/);
    if (dotM) {
      const out: InlineSegment[] = [
        { ...s0, bold: true },
        { ...s1, content: dotM[1], bold: true },
      ];
      if (dotM[2]) {
        out.push({ ...s1, content: dotM[2] });
      }
      return [...out, ...segments.slice(2)];
    }
  }

  return segments;
}

function stripLatexComments(raw: string): string {
  // Preserve verbatim / lstlisting / minted blocks untouched before stripping % comments
  const verbatimStore: string[] = [];
  const protectedRaw = raw.replace(
    /\\begin\{(verbatim\*?|lstlisting|minted)\}([\s\S]*?)\\end\{\1\}/g,
    (full) => {
      const token = `\x00VERBATIM_${verbatimStore.length}\x00`;
      verbatimStore.push(full);
      return token;
    }
  );

  const hasDocClassOrBegin = /\\(?:documentclass|usepackage|begin\{document\})/.test(raw);

  const lines = protectedRaw.split('\n');
  const cleanedLines = lines.map((line) => {
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '\\') {
        i++;
        continue;
      }
      if (line[i] === '%') {
        if (
          !hasDocClassOrBegin &&
          i > 0 &&
          /\d/.test(line[i - 1]) &&
          !/\\(?:def|gdef|edef|xdef|newcommand|renewcommand|pgfmath|draw|fill|path|node|coordinate|foreach|clip|pic)\b/.test(
            line.slice(0, i)
          )
        ) {
          continue;
        }
        return line.slice(0, i);
      }
    }
    return line;
  });

  let joined = cleanedLines.join('\n');
  joined = stripCommentEnvironments(joined, new Set(['comment']));
  for (let idx = 0; idx < verbatimStore.length; idx++) {
    joined = joined.replace(`\x00VERBATIM_${idx}\x00`, () => verbatimStore[idx]);
  }
  return joined;
}

function stripCommentEnvironments(src: string, commentEnvs: Set<string>): string {
  if (commentEnvs.size === 0 || !src.includes('\\begin{')) return src;
  const verbatimStore: string[] = [];
  let out = src.replace(
    /\\begin\{(verbatim\*?|lstlisting|minted)\}([\s\S]*?)\\end\{\1\}/g,
    (full) => {
      const token = `\x00VERBATIM_CMT_${verbatimStore.length}\x00`;
      verbatimStore.push(full);
      return token;
    }
  );

  for (const envName of commentEnvs) {
    const escaped = envName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const openRe = new RegExp(`\\\\begin\\{${escaped}\\}`);
    const closeToken = `\\end{${envName}}`;
    let safety = 0;
    let m: RegExpExecArray | null;
    while ((m = openRe.exec(out)) !== null && safety < 200) {
      safety++;
      const startIdx = m.index;
      const afterOpen = startIdx + m[0].length;
      const endIdx = findMatchingEnvEnd(out, envName, afterOpen);
      if (endIdx !== -1) {
        const afterClose = endIdx + closeToken.length;
        // Avoid synthesizing a blank line when the comment block occupied its own line(s)
        const lineBefore = out.slice(0, startIdx);
        const lineAfter = out.slice(afterClose);
        const startsAtLine = /(?:^|\n)[ \t]*$/.test(lineBefore);
        const endsAtLine = /^[ \t]*\n/.test(lineAfter);
        if (startsAtLine && endsAtLine) {
          out = lineBefore.replace(/[ \t]*$/, '') + lineAfter.replace(/^[ \t]*\n/, '');
        } else {
          out = lineBefore + lineAfter;
        }
      } else {
        // Unclosed \begin{comment} comments out the remainder of the document/snippet
        out = out.slice(0, startIdx).replace(/[ \t]*$/, '');
        break;
      }
    }
    // Strip any stray closing \end{comment}
    out = out.replace(new RegExp(`\\\\end\\{${escaped}\\}[ \\t]*\\n?`, 'g'), '');
  }

  for (let idx = 0; idx < verbatimStore.length; idx++) {
    out = out.replace(`\x00VERBATIM_CMT_${idx}\x00`, () => verbatimStore[idx]);
  }
  return out;
}

interface ExtractedMacro {
  name: string;
  argCount: number;
  defaultOpt?: string;
  body: string;
}

interface ExtractedEnvMacro {
  name: string;
  argCount: number;
  beginBody: string;
  endBody: string;
}

function stripBalancedCommand(
  src: string,
  cmdPattern: RegExp,
  braceArgCount: number,
  allowOptBrackets = true,
  allowDefParams = false
): string {
  let out = src;
  let safety = 0;
  let m: RegExpExecArray | null;
  while ((m = cmdPattern.exec(out)) !== null && safety < 400) {
    safety++;
    let pos = skipSpaces(out, m.index + m[0].length);
    if (allowOptBrackets) {
      while (out[pos] === '[') {
        const opt = readBalancedBrackets(out, pos);
        if (!opt) break;
        pos = skipSpaces(out, opt.endIdx + 1);
      }
    }
    let ok = true;
    for (let k = 0; k < braceArgCount; k++) {
      pos = skipSpaces(out, pos);
      if (out[pos] === '{') {
        const br = readBalancedBraces(out, pos);
        if (!br) {
          ok = false;
          break;
        }
        pos = br.endIdx + 1;
      } else if (k === 0 && out[pos] === '\\') {
        // Single-token macro arg like \setlength\parindent{0pt} or \renewcommand\arraystretch{1.4}
        const tokM = out.slice(pos).match(/^\\[a-zA-Z@]+\*?/);
        if (tokM) {
          pos += tokM[0].length;
        } else {
          ok = false;
          break;
        }
      } else {
        ok = false;
        break;
      }
      if (allowDefParams && k === 0) {
        pos = skipSpaces(out, pos);
        while (out[pos] === '#' && /[1-9]/.test(out[pos + 1] || '')) {
          pos = skipSpaces(out, pos + 2);
        }
      }
      if (allowOptBrackets && k === 0) {
        let optPos = skipSpaces(out, pos);
        while (out[optPos] === '[') {
          const opt2 = readBalancedBrackets(out, optPos);
          if (!opt2) break;
          pos = opt2.endIdx + 1;
          optPos = skipSpaces(out, pos);
        }
      }
    }
    if (!ok && braceArgCount > 0) {
      out = out.slice(0, m.index) + out.slice(m.index + m[0].length);
      cmdPattern.lastIndex = m.index;
      continue;
    }
    out = out.slice(0, m.index) + out.slice(pos);
    cmdPattern.lastIndex = m.index;
  }
  return out;
}

function cleanMetaValue(raw: string | undefined, isVietnamese: boolean): string | undefined {
  if (!raw) return undefined;
  let s = raw.trim();
  s = stripBalancedCommand(s, /\\thanks(?![a-zA-Z])/, 1, true);
  s = stripBalancedCommand(s, /\\footnotemark(?![a-zA-Z])/, 0, true);
  s = s.replace(/\s*\\and(?![a-zA-Z])\s*/g, '  ·  ');
  s = s.replace(/\\today(?![a-zA-Z])/g, formatTodayDate(isVietnamese));
  s = s.replace(/\\inst\{[^}]*\}/g, '');
  s = s.replace(/\\orcidlink\{[^}]*\}/g, '');
  return s.trim() || undefined;
}

function unescapeChatGptMathInner(inner: string, isSingleLineInline = false): string {
  let out = inner
    .replace(/\\\\\\\\/g, '\\\\')
    .replace(/\\\\([,;:!{}|_])/g, '\\$1');
  if (isSingleLineInline && !/\\begin\{/.test(out)) {
    out = out.replace(/\\\\(?=[ \t])/g, '\\');
  }
  return out;
}

function escapeLatexTextLiteral(text: string): string {
  const map: Record<string, string> = {
    '\\': '\\textbackslash{}',
    '{': '\\{',
    '}': '\\}',
    '%': '\\%',
    '$': '\\$',
    '&': '\\&',
    _: '\\_',
    '#': '\\#',
    '~': '\\textasciitilde{}',
    '^': '\\textasciicircum{}',
  };
  return text.replace(/[\\{}%$&_#~^]/g, (ch) => map[ch] ?? ch);
}

function isTexLineBreakSpacingAfterDoubleBackslash(src: string, bracketIdx: number): boolean {
  return /^\s*-?\d+(?:\.\d+)?\s*(?:pt|cm|mm|em|ex|in|pc|bp|dd|cc|sp|px|\\baselineskip|\\linewidth)\s*\]/.test(
    src.slice(bracketIdx + 1)
  );
}

function normalizeChatGptAndMarkdownBody(input: string): string {
  if (!input) return input;

  const protStore: string[] = [];
  const codeStore: string[] = [];
  const mathStore: string[] = [];
  const starStore: string[] = [];

  const pushProt = (val: string) => {
    const tok = `\x00MDPROT_${protStore.length}\x00`;
    protStore.push(val);
    return tok;
  };
  const pushCode = (val: string) => {
    const tok = `\x00MDCODE_${codeStore.length}\x00`;
    codeStore.push(val);
    return tok;
  };
  const pushMath = (val: string) => {
    const tok = `\x00MDMATH_${mathStore.length}\x00`;
    mathStore.push(val);
    return tok;
  };
  const pushStar = (val: string) => {
    const tok = `\x00MDSTAR_${starStore.length}\x00`;
    starStore.push(val);
    return tok;
  };

  // 1. Handle fenced code blocks (unwrap ```latex / ```tex / ```markdown, protect others as verbatim)
  let s = input.replace(
    /^[ \t]*```([a-zA-Z0-9_-]*)[ \t]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm,
    (_full, langRaw: string, codeBody: string) => {
      const lang = langRaw.trim().toLowerCase();
      if (lang === 'latex' || lang === 'tex' || lang === 'markdown' || lang === 'md') {
        return codeBody;
      }
      const trimmed = codeBody.replace(/\n+$/, '');
      return pushProt(`\\begin{verbatim}\n${trimmed}\n\\end{verbatim}`);
    }
  );

  // 2. Protect verbatim / picture / tabular environments cleanly
  const protectedEnvNames = new Set([
    'verbatim',
    'verbatim*',
    'lstlisting',
    'minted',
    'tikzpicture',
    'pgfpicture',
    'picture',
    'axis',
    'circuitikz',
    'tabular',
    'tabular*',
    'tabularx',
    'longtable',
  ]);

  {
    let out = '';
    let cursor = 0;
    let i = 0;
    while (i < s.length) {
      if (s[i] === '\\') {
        const rest = s.slice(i);
        const envM = rest.match(/^\\begin\{([^}]+)\}/);
        if (envM && protectedEnvNames.has(envM[1].trim())) {
          const envName = envM[1].trim();
          const closeTok = `\\end{${envName}}`;
          const endIdx = findMatchingEnvEnd(s, envName, i + envM[0].length);
          if (endIdx !== -1) {
            out += s.slice(cursor, i);
            out += pushProt(s.slice(i, endIdx + closeTok.length));
            i = endIdx + closeTok.length;
            cursor = i;
            continue;
          }
        }
        const verbM = rest.match(/^\\(?:verb\*?|lstinline(?:\[[^\]]*\])?)(.)/);
        if (verbM) {
          const delim = verbM[1];
          const closeIdx = s.indexOf(delim, i + verbM[0].length);
          if (closeIdx !== -1 && !s.slice(i, closeIdx).includes('\n')) {
            out += s.slice(cursor, i);
            out += pushProt(s.slice(i, closeIdx + 1));
            i = closeIdx + 1;
            cursor = i;
            continue;
          }
        }
        const tikzM = rest.match(/^\\tikz(?![a-zA-Z])/);
        if (tikzM) {
          let p = i + tikzM[0].length;
          while (p < s.length && /[ \t]/.test(s[p])) p++;
          if (s[p] === '[') {
            const brk = readBalancedBrackets(s, p);
            if (brk) {
              p = brk.endIdx + 1;
              while (p < s.length && /[ \t]/.test(s[p])) p++;
            }
          }
          if (s[p] === '{') {
            const br = readBalancedBraces(s, p);
            if (br) {
              out += s.slice(cursor, i);
              out += pushProt(s.slice(i, br.endIdx + 1));
              i = br.endIdx + 1;
              cursor = i;
              continue;
            }
          }
        }
        const urlM = rest.match(/^\\url\s*\{/);
        if (urlM) {
          const br = readBalancedBraces(s, i + urlM[0].length - 1);
          if (br) {
            out += s.slice(cursor, i);
            out += pushProt(s.slice(i, br.endIdx + 1));
            i = br.endIdx + 1;
            cursor = i;
            continue;
          }
        }
        const hrefM = rest.match(/^\\href\s*\{/);
        if (hrefM) {
          const br = readBalancedBraces(s, i + hrefM[0].length - 1);
          if (br) {
            out += s.slice(cursor, i + hrefM[0].length - 1);
            out += `{${pushProt(br.content)}}`;
            i = br.endIdx + 1;
            cursor = i;
            continue;
          }
        }
      }
      i++;
    }
    out += s.slice(cursor);
    s = out;
  }

  // Protect bare http/https URLs outside LaTeX commands
  s = s.replace(/https?:\/\/[^\s<>()]+/g, (url) => pushProt(url));

  // 3. Protect inline code `...` before math scanning
  s = s.replace(/(?<!\\)`([^`\n]+)`/g, (_full, inner: string) =>
    pushCode(`\\texttt{${escapeLatexTextLiteral(inner)}}`)
  );

  // 4. Unescape double-escaped ChatGPT math delimiters & math spacing, and protect ALL math spans
  {
    let out = '';
    let i = 0;
    while (i < s.length) {
      if (s[i] === '\\' && s[i + 1] === '$') {
        out += '\\$';
        i += 2;
        continue;
      }

      // Double-escaped display math \\[ ... \\]
      if (
        s.slice(i, i + 3) === '\\\\[' &&
        !isTexLineBreakSpacingAfterDoubleBackslash(s, i + 2)
      ) {
        const closeIdx = s.indexOf('\\\\]', i + 3);
        if (closeIdx !== -1) {
          const nextOpen = s.indexOf('\\\\[', i + 3);
          if (nextOpen === -1 || nextOpen > closeIdx) {
            const inner = s.slice(i + 3, closeIdx);
            out += pushMath(`\\[${unescapeChatGptMathInner(inner, false)}\\]`);
            i = closeIdx + 3;
            continue;
          }
        }
      }

      // Single-escaped display math \[ ... \]
      if (s[i] === '\\' && s[i + 1] === '[' && (i === 0 || s[i - 1] !== '\\')) {
        const closeIdx = s.indexOf('\\]', i + 2);
        if (closeIdx !== -1) {
          const inner = s.slice(i + 2, closeIdx);
          out += pushMath(`\\[${unescapeChatGptMathInner(inner, false)}\\]`);
          i = closeIdx + 2;
          continue;
        }
      }

      // Double-escaped inline math \\( ... \\)
      if (s.slice(i, i + 3) === '\\\\(') {
        const closeIdx = s.indexOf('\\\\)', i + 3);
        if (closeIdx !== -1 && !/\n[ \t]*\n/.test(s.slice(i + 3, closeIdx))) {
          const inner = s.slice(i + 3, closeIdx);
          const isSingleLine = !inner.includes('\n');
          out += pushMath(`\\(${unescapeChatGptMathInner(inner, isSingleLine)}\\)`);
          i = closeIdx + 3;
          continue;
        }
      }

      // Single-escaped inline math \( ... \)
      if (s[i] === '\\' && s[i + 1] === '(' && (i === 0 || s[i - 1] !== '\\')) {
        const closeIdx = s.indexOf('\\)', i + 2);
        if (closeIdx !== -1 && !/\n[ \t]*\n/.test(s.slice(i + 2, closeIdx))) {
          const inner = s.slice(i + 2, closeIdx);
          const isSingleLine = !inner.includes('\n');
          out += pushMath(`\\(${unescapeChatGptMathInner(inner, isSingleLine)}\\)`);
          i = closeIdx + 2;
          continue;
        }
      }

      // Display math environments (\begin{equation}...\end{equation}, align, cases, etc.)
      if (s[i] === '\\') {
        const envM = s.slice(i).match(/^\\begin\{([^}]+)\}/);
        if (envM && DISPLAY_MATH_ENVS.has(envM[1].trim())) {
          const envName = envM[1].trim();
          const closeTok = `\\end{${envName}}`;
          const endIdx = findMatchingEnvEnd(s, envName, i + envM[0].length);
          if (endIdx !== -1) {
            const fullEnv = s.slice(i, endIdx + closeTok.length);
            out += pushMath(unescapeChatGptMathInner(fullEnv, false));
            i = endIdx + closeTok.length;
            continue;
          }
        }
      }

      // $$...$$
      if (s[i] === '$' && s[i + 1] === '$') {
        const closeIdx = s.indexOf('$$', i + 2);
        if (closeIdx !== -1) {
          const inner = s.slice(i + 2, closeIdx);
          out += pushMath(`$$${unescapeChatGptMathInner(inner, false)}$$`);
          i = closeIdx + 2;
          continue;
        }
      }

      // $...$
      if (s[i] === '$' && s[i + 1] !== '$') {
        let braceDepth = 0;
        let closeIdx = -1;
        for (let j = i + 1; j < s.length; j++) {
          if (s[j] === '\\' && j + 1 < s.length) {
            j++;
            continue;
          }
          if (s[j] === '{') {
            braceDepth++;
            continue;
          }
          if (s[j] === '}') {
            braceDepth = Math.max(0, braceDepth - 1);
            continue;
          }
          if (s[j] === '\n' && /^[ \t]*\n/.test(s.slice(j + 1))) {
            break;
          }
          if (s[j] === '$' && s[j + 1] !== '$' && braceDepth === 0) {
            closeIdx = j;
            break;
          }
        }
        if (closeIdx !== -1) {
          const inner = s.slice(i + 1, closeIdx);
          const isSingleLine = !inner.includes('\n');
          out += pushMath(`$${unescapeChatGptMathInner(inner, isSingleLine)}$`);
          i = closeIdx + 1;
          continue;
        }
      }

      out += s[i];
      i++;
    }
    s = out;
  }

  // 5. Protect LaTeX starred commands (\section*, \hspace*, etc.) & escaped \* before Markdown * parsing
  s = s.replace(/\\[a-zA-Z]+\*/g, (m) => pushStar(m));
  s = s.replace(/\\\*/g, () => pushStar('*'));
  s = s.replace(/(?<=\d)\\\.(?=\s|$|\*)/g, '.');
  s = s.replace(/(^|[ \t])\\-(?=[ \t]|$)/gm, '$1-');

  const convertInlineMd = (line: string): string => {
    let t = line;
    t = t.replace(/\*\*\*(?=\S)([^\n]*?\S|\S)\*\*\*/g, '\\textbf{\\textit{$1}}');
    t = t.replace(/\*\*(?=\S)([^\n]*?\S|\S)\*\*/g, '\\textbf{$1}');
    t = t.replace(/(?<![\p{L}\p{N}_\\])__(?=\S)([^\n]*?\S|\S)__(?![\p{L}\p{N}_])/gu, '\\textbf{$1}');
    t = t.replace(/(?<!\*)\*(?!\*)(?=\S)([^\n*]*?\S|\S)\*(?!\*)/g, '\\textit{$1}');
    t = t.replace(/(?<![\p{L}\p{N}_\\])_(?=\S)([^\n_]*?\S|\S)_(?![\p{L}\p{N}_])/gu, '\\textit{$1}');
    t = t.replace(/~~(?=\S)([^\n]*?\S|\S)~~/g, '\\sout{$1}');
    return t;
  };

  // 6. Block-level Markdown conversion line by line
  const lines = s.split('\n');
  const outLines: string[] = [];
  const hrRe = /^[ \t]*(?:-[ \t]*-[ \t]*-[-\t ]*|\*[ \t]*\*[ \t]*\*[*\t ]*|_[ \t]*_[ \t]*_[_\t ]*)$/;
  const mdSepRe = /^[ \t]*\|?(?:\s*:?-{2,}:?\s*\|)+\s*(?::?-{2,}:?\s*\|?)?[ \t]*$/;
  const headingRe = /^[ \t]*(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;

  const parseMdTableRow = (rowLine: string): string[] => {
    let trimmed = rowLine.trim();
    if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
    if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) trimmed = trimmed.slice(0, -1);
    return trimmed.split('|').map((cell) =>
      convertInlineMd(cell.trim()).replace(/(?<!\\)&/g, '\\&')
    );
  };

  const isBulletStart = (line: string): boolean => {
    if (hrRe.test(line)) return false;
    if (/^[ \t]*[*+][ \t]+\S/.test(line)) return true;
    // Allow "- item" bullet if not a bare negative number like "- 5" or isolated "- \x00MDMATH"
    const dashM = line.match(/^[ \t]*-[ \t]+(.+)$/);
    if (!dashM) return false;
    const rhs = dashM[1].trim();
    if (/^\d/.test(rhs)) return false;
    return true;
  };

  let li = 0;
  while (li < lines.length) {
    const line = lines[li];

    // ATX Headings (#, ##, ###, ####...)
    const hm = line.match(headingRe);
    if (hm) {
      const level = hm[1].length;
      let titleText = hm[2].trim();
      // Strip redundant outer **...** on headings since headings already render bold
      if (/^\*\*[^*][\s\S]*\*\*$/.test(titleText) && titleText.slice(2, -2).indexOf('**') === -1) {
        titleText = titleText.slice(2, -2).trim();
      }
      titleText = convertInlineMd(titleText);
      const cmd =
        level === 1
          ? '\\section*'
          : level === 2
          ? '\\subsection*'
          : level === 3
          ? '\\subsubsection*'
          : '\\paragraph*';
      outLines.push(`${cmd}{${titleText}}`);
      li++;
      continue;
    }

    // Horizontal rules (---, ***, ___)
    if (hrRe.test(line)) {
      outLines.push('---');
      li++;
      continue;
    }

    // Markdown pipe tables
    if (
      line.includes('|') &&
      li + 1 < lines.length &&
      mdSepRe.test(lines[li + 1])
    ) {
      const headerCells = parseMdTableRow(line);
      const sepRaw = lines[li + 1].trim().replace(/^\|/, '').replace(/\|$/, '');
      const sepParts = sepRaw.split('|').map((p) => p.trim());
      const colCount = Math.max(headerCells.length, sepParts.length);
      const colAligns: string[] = [];
      for (let c = 0; c < colCount; c++) {
        const sp = sepParts[c] ?? '';
        if (sp.startsWith(':') && sp.endsWith(':')) colAligns.push('c');
        else if (sp.endsWith(':')) colAligns.push('r');
        else colAligns.push('l');
      }

      const bodyRows: string[][] = [];
      let rj = li + 2;
      while (rj < lines.length) {
        const rLine = lines[rj];
        if (!rLine.trim() || !rLine.includes('|') || hrRe.test(rLine) || headingRe.test(rLine)) {
          break;
        }
        bodyRows.push(parseMdTableRow(rLine));
        rj++;
      }

      const padRow = (cells: string[]) => {
        const padded = [...cells];
        while (padded.length < colCount) padded.push('');
        return padded.slice(0, colCount).join(' & ');
      };

      const tabularLines = [
        `\\begin{tabular}{|${colAligns.join('|')}|}`,
        '\\hline',
        `${padRow(headerCells)} \\\\`,
        '\\hline',
        ...bodyRows.map((row) => `${padRow(row)} \\\\`),
        '\\hline',
        '\\end{tabular}',
      ];
      outLines.push(tabularLines.join('\n'));
      li = rj;
      continue;
    }

    // Markdown blockquotes (> ...)
    if (/^[ \t]*>[ \t]?/.test(line)) {
      const quoteLines: string[] = [];
      while (li < lines.length && /^[ \t]*>[ \t]?/.test(lines[li])) {
        const qInner = lines[li].replace(/^[ \t]*>[ \t]?/, '');
        const qHm = qInner.match(headingRe);
        if (qHm) {
          let qTitle = qHm[2].trim();
          if (/^\*\*[^*][\s\S]*\*\*$/.test(qTitle) && qTitle.slice(2, -2).indexOf('**') === -1) {
            qTitle = qTitle.slice(2, -2).trim();
          }
          const qCmd =
            qHm[1].length === 1
              ? '\\section*'
              : qHm[1].length === 2
              ? '\\subsection*'
              : qHm[1].length === 3
              ? '\\subsubsection*'
              : '\\paragraph*';
          quoteLines.push(`${qCmd}{${convertInlineMd(qTitle)}}`);
        } else {
          quoteLines.push(convertInlineMd(qInner));
        }
        li++;
      }
      outLines.push(`\\begin{quote}\n${quoteLines.join('\n')}\n\\end{quote}`);
      continue;
    }

    // Markdown bullet lists (* item, + item, or 2+ / prose - item)
    if (isBulletStart(line)) {
      const isStarOrPlus = /^[ \t]*[*+][ \t]+/.test(line);
      const nextIsBullet = li + 1 < lines.length && isBulletStart(lines[li + 1]);
      const rhsAfterDash = line.replace(/^[ \t]*-[ \t]+/, '').trim();
      const dashStartsWithProse =
        !rhsAfterDash.startsWith('\x00MDMATH_') && !/^[A-D][\.\)]\s/.test(rhsAfterDash);
      if (isStarOrPlus || nextIsBullet || dashStartsWithProse) {
        const items: string[] = [];
        while (li < lines.length && isBulletStart(lines[li])) {
          const itemText = lines[li].replace(/^[ \t]*[-*+][ \t]+/, '').trim();
          items.push(`\\item ${convertInlineMd(itemText)}`);
          li++;
        }
        outLines.push(`\\begin{itemize}\n${items.join('\n')}\n\\end{itemize}`);
        continue;
      }
    }

    outLines.push(convertInlineMd(line));
    li++;
  }

  s = outLines.join('\n');

  // 7. Restore tokens in reverse order
  for (let idx = starStore.length - 1; idx >= 0; idx--) {
    s = s.replace(`\x00MDSTAR_${idx}\x00`, () => starStore[idx]);
  }
  for (let idx = mathStore.length - 1; idx >= 0; idx--) {
    s = s.replace(`\x00MDMATH_${idx}\x00`, () => mathStore[idx]);
  }
  for (let idx = codeStore.length - 1; idx >= 0; idx--) {
    s = s.replace(`\x00MDCODE_${idx}\x00`, () => codeStore[idx]);
  }
  for (let idx = protStore.length - 1; idx >= 0; idx--) {
    s = s.replace(`\x00MDPROT_${idx}\x00`, () => protStore[idx]);
  }

  return s;
}

function parseDocumentPageConfig(src: string): DocumentPageConfig {
  const cfg = createDefaultPageConfig();

  const docClsM = src.match(/\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/);
  if (docClsM && docClsM[1]) {
    const opts = docClsM[1]
      .split(',')
      .map((o) => o.trim().toLowerCase());
    for (const opt of opts) {
      if (opt === '10pt') cfg.baseFontSizePt = 10;
      else if (opt === '11pt') cfg.baseFontSizePt = 11;
      else if (opt === '12pt') cfg.baseFontSizePt = 12;
      else if (opt === 'a4paper') cfg.pageSize = 'a4';
      else if (opt === 'a5paper') cfg.pageSize = 'a5';
      else if (opt === 'letterpaper') cfg.pageSize = 'letter';
      else if (opt === 'landscape') cfg.isLandscape = true;
    }
  }

  const parseGeomSpec = (specStr: string) => {
    const items = specStr.split(',');
    for (const item of items) {
      const trimmed = item.trim();
      if (!trimmed) continue;
      const lower = trimmed.toLowerCase();
      if (lower === 'a4paper') {
        cfg.pageSize = 'a4';
        continue;
      }
      if (lower === 'a5paper') {
        cfg.pageSize = 'a5';
        continue;
      }
      if (lower === 'letterpaper') {
        cfg.pageSize = 'letter';
        continue;
      }
      if (lower === 'landscape') {
        cfg.isLandscape = true;
        continue;
      }
      if (lower === 'portrait') {
        cfg.isLandscape = false;
        continue;
      }
      const kv = trimmed.match(/^([a-zA-Z]+)\s*=\s*(.+)$/);
      if (!kv) continue;
      const key = kv[1].toLowerCase();
      const valPt = parseLatexLengthToPt(kv[2], 487.3, cfg.baseFontSizePt);
      if (valPt === null || !Number.isFinite(valPt) || valPt <= 0) continue;
      if (key === 'top' || key === 'tmargin') cfg.marginTopPt = valPt;
      else if (key === 'bottom' || key === 'bmargin') cfg.marginBottomPt = valPt;
      else if (key === 'left' || key === 'lmargin' || key === 'inner') cfg.marginLeftPt = valPt;
      else if (key === 'right' || key === 'rmargin' || key === 'outer') cfg.marginRightPt = valPt;
      else if (key === 'hmargin') {
        cfg.marginLeftPt = valPt;
        cfg.marginRightPt = valPt;
      } else if (key === 'vmargin') {
        cfg.marginTopPt = valPt;
        cfg.marginBottomPt = valPt;
      } else if (key === 'margin') {
        cfg.marginTopPt = valPt;
        cfg.marginRightPt = valPt;
        cfg.marginBottomPt = valPt;
        cfg.marginLeftPt = valPt;
      }
    }
  };

  const pkgGeomRe = /\\usepackage\s*\[([^\]]+)\]\s*\{geometry\}/g;
  let gm: RegExpExecArray | null;
  while ((gm = pkgGeomRe.exec(src)) !== null) {
    parseGeomSpec(gm[1]);
  }
  const geomCmdRe = /\\geometry\s*\{([^}]+)\}/g;
  while ((gm = geomCmdRe.exec(src)) !== null) {
    parseGeomSpec(gm[1]);
  }

  if (/\\onehalfspacing(?![a-zA-Z])/.test(src)) cfg.defaultLineSpacing = 1.35;
  else if (/\\doublespacing(?![a-zA-Z])/.test(src)) cfg.defaultLineSpacing = 1.75;
  else if (/\\singlespacing(?![a-zA-Z])/.test(src)) cfg.defaultLineSpacing = 1.15;

  const lsM = src.match(/\\linespread\s*\{([^}]+)\}/);
  if (lsM) {
    const f = parseFloat(lsM[1].trim());
    if (Number.isFinite(f) && f > 0.5 && f <= 2.5) {
      cfg.defaultLineSpacing = Math.max(1.0, Math.min(2.4, Math.round(f * 1.15 * 100) / 100));
    }
  }

  if (/\\usepackage(?:\[[^\]]*\])?\{parskip\}/.test(src)) {
    cfg.defaultParIndentPt = 0;
    cfg.defaultParSkipPt = 6;
  }

  const parIndM = src.match(/\\setlength\s*\{\\parindent\}\s*\{([^}]+)\}/);
  if (parIndM) {
    const pt = parseLatexLengthToPt(parIndM[1], 487.3, cfg.baseFontSizePt);
    if (pt !== null) cfg.defaultParIndentPt = Math.max(0, Math.min(72, pt));
  }

  const parSkipM = src.match(/\\setlength\s*\{\\parskip\}\s*\{([^}]+)\}/);
  if (parSkipM) {
    const pt = parseLatexLengthToPt(parSkipM[1], 487.3, cfg.baseFontSizePt);
    if (pt !== null) cfg.defaultParSkipPt = Math.max(0, Math.min(36, pt));
  }

  const portraitW = cfg.pageSize === 'letter' ? 612 : cfg.pageSize === 'a5' ? 419.5 : 595.3;
  const portraitH = cfg.pageSize === 'letter' ? 792 : cfg.pageSize === 'a5' ? 595.3 : 841.9;
  const pageW = cfg.isLandscape ? portraitH : portraitW;
  cfg.contentWidthPt = Math.max(200, pageW - cfg.marginLeftPt - cfg.marginRightPt);

  return cfg;
}

function preprocessDocumentAndMacros(raw: string): {
  body: string;
  title?: string;
  author?: string;
  date?: string;
  isFullLatexDoc: boolean;
  isVietnamese: boolean;
  customTheorems: Record<string, CustomTheoremDef>;
  customColors: Record<string, string>;
  customTikzStyles: Record<string, string>;
  defaultTasksLabel?: string;
  pageConfig: DocumentPageConfig;
} {
  const normalized = stripLatexComments(raw.replace(/\r\n/g, '\n'));
  const hasDocBegin = /\\begin\{document\}/.test(normalized);
  const pageConfig = parseDocumentPageConfig(normalized);

  const isVietnamese =
    /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(normalized) ||
    (/\\usepackage(?:\[[^\]]*\])?\{[^}]*(?:vietnam|vntex|babel)[^}]*\}/i.test(normalized) &&
      /vietnam/i.test(normalized));

  let preamble = '';
  let body = normalized;

  if (hasDocBegin) {
    const startMatch = normalized.match(/\\begin\{document\}/);
    if (startMatch && startMatch.index !== undefined) {
      preamble = normalized.slice(0, startMatch.index);
      body = normalized.slice(startMatch.index + startMatch[0].length);
      const endIdx = body.indexOf('\\end{document}');
      if (endIdx !== -1) {
        body = body.slice(0, endIdx);
      }
    }
  }

  const combinedMetaSrc = preamble ? `${preamble}\n${body}` : body;
  const extractMetaCmd = (cmd: string): string | undefined => {
    const re = new RegExp(`\\\\${cmd}\\s*(?:\\[[^\\]]*\\]\\s*)?\\{`);
    const m = re.exec(combinedMetaSrc);
    if (!m) return undefined;
    const br = readBalancedBraces(combinedMetaSrc, m.index + m[0].length - 1);
    return br ? br.content.trim() : undefined;
  };

  const title = cleanMetaValue(extractMetaCmd('title'), isVietnamese);
  const author = cleanMetaValue(extractMetaCmd('author'), isVietnamese);
  const date = cleanMetaValue(extractMetaCmd('date'), isVietnamese);

  body = stripBalancedCommand(body, /\\title\*?(?![a-zA-Z])/, 1, true);
  body = stripBalancedCommand(body, /\\subtitle(?![a-zA-Z])/, 1, true);
  body = stripBalancedCommand(body, /\\author(?![a-zA-Z])/, 1, true);
  body = stripBalancedCommand(body, /\\date(?![a-zA-Z])/, 1, true);
  body = stripBalancedCommand(body, /\\institute(?![a-zA-Z])/, 1, true);
  body = stripBalancedCommand(body, /\\affiliation(?![a-zA-Z])/, 1, true);

  const preambleMacros = new Map<string, ExtractedMacro>();
  const envMacros: ExtractedEnvMacro[] = [];
  const customTheorems: Record<string, CustomTheoremDef> = {};
  const customColors: Record<string, string> = {};
  const customTikzStyles: Record<string, string> = {};

  const parseMacrosIntoMap = (src: string, target: Map<string, ExtractedMacro>) => {
    // Collect preamble macros in source order (excluding \def\f(#1){...} TikZ function defs)
    const tokenRe = /\\(?:(?:re|provide)?newcommand\*?|DeclareRobustCommand\*?|DeclareMathOperator\*?|(?:g|e|x)?def|pgfmath(?:set|truncate)macro)(?![a-zA-Z])/g;
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(src)) !== null) {
      const cmdRaw = m[0];
      let pos = skipSpaces(src, m.index + cmdRaw.length);

      if (cmdRaw.startsWith('\\DeclareMathOperator')) {
        const starred = cmdRaw.endsWith('*');
        if (src[pos] === '{') {
          const nameBr = readBalancedBraces(src, pos);
          if (nameBr && nameBr.content.trim().startsWith('\\')) {
            const name = nameBr.content.trim().slice(1);
            pos = skipSpaces(src, nameBr.endIdx + 1);
            if (src[pos] === '{') {
              const bodyBr = readBalancedBraces(src, pos);
              if (bodyBr) {
                target.set(name, {
                  name,
                  argCount: 0,
                  body: starred ? `\\operatorname*{${bodyBr.content}}` : `\\operatorname{${bodyBr.content}}`,
                });
              }
            }
          }
        }
        continue;
      }

      if (cmdRaw.startsWith('\\pgfmath')) {
        let name: string | null = null;
        if (src[pos] === '{') {
          const nb = readBalancedBraces(src, pos);
          if (nb && /^\\[a-zA-Z]+$/.test(nb.content.trim())) {
            name = nb.content.trim().slice(1);
            pos = skipSpaces(src, nb.endIdx + 1);
          }
        } else if (src[pos] === '\\') {
          const nm = src.slice(pos).match(/^\\([a-zA-Z]+)/);
          if (nm) {
            name = nm[1];
            pos = skipSpaces(src, pos + nm[0].length);
          }
        }
        if (name && src[pos] === '{') {
          const vb = readBalancedBraces(src, pos);
          if (vb) {
            const val = evaluateTikzMathExpr(vb.content);
            if (val !== null) {
              const finalVal = cmdRaw.includes('truncate') ? Math.trunc(val) : val;
              target.set(name, { name, argCount: 0, body: String(Math.round(finalVal * 1e8) / 1e8) });
            } else {
              target.set(name, { name, argCount: 0, body: vb.content });
            }
          }
        }
        continue;
      }

      if (/^\\(?:g|e|x)?def$/.test(cmdRaw)) {
        const nm = src.slice(pos).match(/^\\([a-zA-Z]+)\s*((?:#[1-9]\s*)*)/);
        if (nm) {
          const name = nm[1];
          const afterNm = skipSpaces(src, pos + nm[0].length);
          if (src[afterNm] === '{') {
            const params = nm[2] ? nm[2].match(/#[1-9]/g) ?? [] : [];
            const argCount = Math.min(9, params.length);
            const br = readBalancedBraces(src, afterNm);
            if (br) {
              target.set(name, { name, argCount, body: br.content });
            }
          }
        }
        continue;
      }

      // \newcommand / \renewcommand / \providecommand / \DeclareRobustCommand
      let name: string | null = null;
      if (src[pos] === '{') {
        const nb = readBalancedBraces(src, pos);
        if (nb && /^\\[a-zA-Z]+$/.test(nb.content.trim())) {
          name = nb.content.trim().slice(1);
          pos = skipSpaces(src, nb.endIdx + 1);
        }
      } else if (src[pos] === '\\') {
        const nm = src.slice(pos).match(/^\\([a-zA-Z]+)/);
        if (nm) {
          name = nm[1];
          pos = skipSpaces(src, pos + nm[0].length);
        }
      }
      if (!name) continue;
      let argCount = 0;
      let defaultOpt: string | undefined;
      if (src[pos] === '[') {
        const brk = readBalancedBrackets(src, pos);
        if (brk) {
          argCount = Math.max(0, Math.min(9, parseInt(brk.content.trim(), 10) || 0));
          pos = skipSpaces(src, brk.endIdx + 1);
        }
      }
      if (src[pos] === '[') {
        const defOpt = readBalancedBrackets(src, pos);
        if (defOpt) {
          defaultOpt = defOpt.content;
          pos = skipSpaces(src, defOpt.endIdx + 1);
        }
      }
      if (src[pos] === '{') {
        const br = readBalancedBraces(src, pos);
        if (br) {
          const isProvide = cmdRaw.startsWith('\\providecommand');
          if (!isProvide || !target.has(name)) {
            target.set(name, { name, argCount, defaultOpt, body: br.content });
          }
        }
      }
    }
  };

  if (preamble) {
    parseMacrosIntoMap(preamble, preambleMacros);
  }

  const macroSrc = preamble ? `${preamble}\n${body}` : body;
  let m: RegExpExecArray | null;

  // Parse \newenvironment(*)?{env}[n]{begin}{end}
  const envDefRe = /\\(?:re)?newenvironment\*?\s*\{([^}]+)\}/g;
  while ((m = envDefRe.exec(macroSrc)) !== null) {
    const name = m[1].trim();
    let pos = skipSpaces(macroSrc, m.index + m[0].length);
    let argCount = 0;
    if (macroSrc[pos] === '[') {
      const brk = readBalancedBrackets(macroSrc, pos);
      if (brk) {
        argCount = Math.max(0, Math.min(9, parseInt(brk.content.trim(), 10) || 0));
        pos = skipSpaces(macroSrc, brk.endIdx + 1);
      }
    }
    if (macroSrc[pos] === '[') {
      const defOpt = readBalancedBrackets(macroSrc, pos);
      if (defOpt) pos = skipSpaces(macroSrc, defOpt.endIdx + 1);
    }
    if (macroSrc[pos] === '{') {
      const begBr = readBalancedBraces(macroSrc, pos);
      if (begBr) {
        const afterBeg = skipSpaces(macroSrc, begBr.endIdx + 1);
        if (macroSrc[afterBeg] === '{') {
          const endBr = readBalancedBraces(macroSrc, afterBeg);
          if (endBr) {
            envMacros.push({
              name,
              argCount,
              beginBody: begBr.content,
              endBody: endBr.content,
            });
          }
        }
      }
    }
  }

  // Parse \newtheorem(*)?{env}[shared]{Title}[within]
  const thmRe = /\\newtheorem(\*?)\s*\{([^}]+)\}/g;
  while ((m = thmRe.exec(macroSrc)) !== null) {
    const unnumbered = Boolean(m[1]);
    const envName = m[2].trim();
    let pos = skipSpaces(macroSrc, m.index + m[0].length);
    let sharedCounter: string | undefined;
    if (macroSrc[pos] === '[') {
      const opt = readBalancedBrackets(macroSrc, pos);
      if (opt) {
        sharedCounter = opt.content.trim();
        pos = skipSpaces(macroSrc, opt.endIdx + 1);
      }
    }
    if (macroSrc[pos] === '{') {
      const titleBr = readBalancedBraces(macroSrc, pos);
      if (titleBr) {
        customTheorems[envName] = {
          envName,
          title: titleBr.content.trim(),
          unnumbered,
          sharedCounter,
        };
      }
    }
  }

  // Parse \definecolor, \providecolor, \xdefinecolor, and \colorlet in source order
  const colDeclRe = /\\(definecolor|providecolor|xdefinecolor|colorlet)(?:\s*\[[^\]]*\])?\s*\{/g;
  while ((m = colDeclRe.exec(macroSrc)) !== null) {
    const cmd = m[1];
    const firstBr = readBalancedBraces(macroSrc, m.index + m[0].length - 1);
    if (!firstBr) continue;
    const cname = firstBr.content.trim().toLowerCase();
    if (!cname) continue;
    let pos = skipSpaces(macroSrc, firstBr.endIdx + 1);
    if (cmd === 'colorlet') {
      if (macroSrc[pos] !== '{') continue;
      const exprBr = readBalancedBraces(macroSrc, pos);
      if (!exprBr) continue;
      const resolved = resolveLatexColor(exprBr.content.trim(), customColors);
      if (resolved) customColors[cname] = resolved;
    } else {
      if (macroSrc[pos] !== '{') continue;
      const modelBr = readBalancedBraces(macroSrc, pos);
      if (!modelBr) continue;
      pos = skipSpaces(macroSrc, modelBr.endIdx + 1);
      if (macroSrc[pos] !== '{') continue;
      const specBr = readBalancedBraces(macroSrc, pos);
      if (!specBr) continue;
      if (cmd === 'providecolor' && customColors[cname]) continue;
      const resolved = resolveLatexModelAndSpec(modelBr.content.trim(), specBr.content.trim(), customColors);
      if (resolved) customColors[cname] = resolved;
    }
  }

  // Parse \tikzset{...}, \tikzstyle{name}=[...], and \tdplotsetmaincoords{theta}{phi}
  const tikzSetDeclRe = /\\tikzset\s*\{/g;
  while ((m = tikzSetDeclRe.exec(macroSrc)) !== null) {
    const br = readBalancedBraces(macroSrc, m.index + m[0].length - 1);
    if (br) extractTikzStylesFromSetBody(br.content, customTikzStyles);
  }
  const tikzStyleDeclRe = /\\tikzstyle\s*\{([^}]+)\}\s*=\s*\[/g;
  while ((m = tikzStyleDeclRe.exec(macroSrc)) !== null) {
    const sName = m[1].trim();
    const brk = readBalancedBrackets(macroSrc, m.index + m[0].length - 1);
    if (sName && brk) customTikzStyles[sName] = brk.content.trim();
  }
  const tdplotDeclRe = /\\tdplotsetmaincoords\s*\{([^}]+)\}\s*\{([^}]+)\}/g;
  while ((m = tdplotDeclRe.exec(macroSrc)) !== null) {
    const th = evaluateTikzMathExpr(m[1]);
    const ph = evaluateTikzMathExpr(m[2]);
    if (th !== null && ph !== null) {
      customTikzStyles['tdplot_main_coords'] = computeTdplotMainCoordsStyle(th, ph);
    }
  }

  // Parse \settasks{label=...}
  let defaultTasksLabel: string | undefined;
  const setTasksRe = /\\settasks\s*\{/g;
  while ((m = setTasksRe.exec(macroSrc)) !== null) {
    const br = readBalancedBraces(macroSrc, m.index + m[0].length - 1);
    if (br) {
      const lbl = extractBalancedKeyValOption(br.content, 'label');
      if (lbl) defaultTasksLabel = lbl;
    }
  }

  // Collect \excludecomment{envName} declarations
  const excludedCommentEnvs = new Set<string>(['comment']);
  const excludeCmtRe = /\\excludecomment\s*\{([^}]+)\}/g;
  while ((m = excludeCmtRe.exec(macroSrc)) !== null) {
    const eName = m[1].trim();
    if (eName) excludedCommentEnvs.add(eName);
  }
  if (excludedCommentEnvs.size > 1) {
    body = stripCommentEnvironments(body, excludedCommentEnvs);
  }

  // Collect declared LaTeX counters (\newcounter{name}[parent] and preamble counter updates)
  const trackedCounters = new Set<string>();
  const counterValues: Record<string, number> = {};
  const counterResetChildren: Record<string, Set<string>> = {};
  const registerCounter = (name: string, parent?: string) => {
    const c = name.trim();
    if (!c) return;
    trackedCounters.add(c);
    if (counterValues[c] === undefined) counterValues[c] = 0;
    if (parent && parent.trim()) {
      const p = parent.trim();
      if (!counterResetChildren[p]) counterResetChildren[p] = new Set();
      counterResetChildren[p].add(c);
    }
  };
  const newCtrDeclRe = /\\newcounter\s*\{([^}]+)\}(?:\s*\[([^\]]*)\])?/g;
  while ((m = newCtrDeclRe.exec(macroSrc)) !== null) {
    registerCounter(m[1], m[2]);
  }
  const refCtrDeclRe = /\\(?:refstepcounter|stepcounter|setcounter|addtocounter)\s*\{([^}]+)\}/g;
  while ((m = refCtrDeclRe.exec(macroSrc)) !== null) {
    const c = m[1].trim();
    if (c && !/^(?:secnumdepth|tocdepth|page|enumi+|mpfootnote|footnote)$/.test(c)) {
      registerCounter(c);
    }
  }
  if (preamble) {
    let preTop = stripBalancedCommand(preamble, /\\(?:re)?newenvironment\*?(?![a-zA-Z])/, 3, true);
    preTop = stripBalancedCommand(
      preTop,
      /\\(?:(?:re|provide)?newcommand\*?|DeclareRobustCommand\*?)(?![a-zA-Z])/,
      2,
      true
    );
    const preCtrOpRe = /\\(setcounter|addtocounter|stepcounter|refstepcounter)\s*\{([^}]+)\}(?:\s*\{([^}]*)\})?/g;
    while ((m = preCtrOpRe.exec(preTop)) !== null) {
      const op = m[1];
      const cname = m[2].trim();
      if (!trackedCounters.has(cname)) continue;
      if (op === 'stepcounter' || op === 'refstepcounter') {
        counterValues[cname] = (counterValues[cname] ?? 0) + 1;
      } else if (op === 'setcounter') {
        const v = parseInt((m[3] ?? '').trim(), 10);
        if (Number.isFinite(v)) counterValues[cname] = v;
      } else if (op === 'addtocounter') {
        const v = parseInt((m[3] ?? '').trim(), 10);
        if (Number.isFinite(v)) counterValues[cname] = (counterValues[cname] ?? 0) + v;
      }
    }
  }

  // Safely strip non-macro preamble commands with balanced braces
  // (macro definitions are processed sequentially in scoped order below so per-figure \def/\pgfmathsetmacro never leaks globally)
  const preambleThreeArgCmds = /\\(?:definecolor|providecolor|xdefinecolor|DeclareMathAlphabet|SetMathAlphabet)(?![a-zA-Z])/;
  const preambleTwoArgCmds =
    /\\(?:setlength|addtolength|numberwithin|colorlet|fontsize|lstdefinestyle|DeclareTColorBox|newtcbox|inputansbox|inputans|tdplotsetmaincoords)(?![a-zA-Z])/;
  const preambleOneArgCmds =
    /\\(?:documentclass|usepackage|RequirePackage|geometry|hypersetup|lstset|tikzset|pgfplotsset|tcbset|tcbuselibrary|setlist|settasks|pagestyle|thispagestyle|pagenumbering|bibliographystyle|bibliography|addbibresource|linespread|theoremstyle|newtheoremstyle|graphicspath|DeclareUnicodeCharacter|sisetup|captionsetup|AtBeginDocument|fancyhf|fancyhead|fancyfoot|rhead|lhead|chead|rfoot|lfoot|cfoot|setmainfont|setsansfont|setmonofont|newfontfamily|selectlanguage|usetikzlibrary|usepgfplotslibrary|tkzSetUpPoint|tkzSetUpLine|tkzSetUpLabel|tkzSetUpStyle|tkzTabSetup|titleformat|titlespacing|newtheorem\*?|input|include|allowdisplaybreaks|qedsymbol|showansEX|showans|hideansEX|hideans|ansEX|Opensolutionfile|Closesolutionfile|writelist|excludecomment|includecomment)(?![a-zA-Z])/;
  const preambleZeroArgCmds =
    /\\(?:onehalfspacing|doublespacing|singlespacing|frenchspacing|makeatletter|makeatother|tableofcontents|listoffigures|listoftables|printbibliography|phantomsection|frontmatter|mainmatter|backmatter|sloppy|fussy|raggedbottom|flushbottom|selectfont|hidesolution|showsolution)(?![a-zA-Z])\s*/g;

  body = stripBalancedCommand(body, /\\(?:re)?newenvironment\*?(?![a-zA-Z])/, 3, true);
  body = stripBalancedCommand(body, preambleThreeArgCmds, 3, true);
  body = stripBalancedCommand(body, preambleTwoArgCmds, 2, true);
  body = stripBalancedCommand(body, preambleOneArgCmds, 1, true);
  body = body.replace(preambleZeroArgCmds, '');

  const customEnvNames = new Set(envMacros.map((em) => em.name));

  // Expand custom \newenvironment usages if not a built-in/theorem environment
  for (const em of envMacros) {
    if (DISPLAY_MATH_ENVS.has(em.name) || customTheorems[em.name]) continue;
    const openRe = new RegExp(`\\\\begin\\{${em.name}\\}`);
    let safety = 0;
    let match: RegExpExecArray | null;
    while ((match = openRe.exec(body)) !== null && safety < 200) {
      safety++;
      const afterOpen = match.index + match[0].length;
      const endIdx = findMatchingEnvEnd(body, em.name, afterOpen);
      if (endIdx === -1) break;
      let innerStart = afterOpen;
      const envArgs: string[] = [];
      if (em.argCount > 0) {
        const extracted = extractBalancedMacroArgs(body, innerStart, em.argCount);
        if (extracted) {
          envArgs.push(...extracted.args);
          innerStart = extracted.endIdx;
        }
      }
      let beg = em.beginBody;
      let end = em.endBody;
      envArgs.forEach((v, idx) => {
        const reArg = new RegExp(`#${idx + 1}`, 'g');
        beg = beg.replace(reArg, () => v);
        end = end.replace(reArg, () => v);
      });
      const inner = body.slice(innerStart, endIdx);
      const closeLen = `\\end{${em.name}}`.length;
      // Preserve inline flow without synthesizing fake blank lines (\n\n) between beg, inner, and end
      const cleanBeg = beg.replace(/\n[ \t]*$/, '');
      const cleanInner = inner.replace(/^[ \t]*\n[ \t]*(?![ \t]*\n)/, ' ').replace(/\n[ \t]*$/, '');
      const cleanEnd = end.replace(/^[ \t]*\n/, '');
      const sepBeg =
        cleanBeg && cleanInner && /\\[a-zA-Z]+$/.test(cleanBeg) && /^[a-zA-Z]/.test(cleanInner)
          ? ' '
          : '';
      const sepEnd =
        cleanInner && cleanEnd && /\\[a-zA-Z]+$/.test(cleanInner) && /^[a-zA-Z]/.test(cleanEnd)
          ? ' '
          : '';
      body =
        body.slice(0, match.index) +
        `${cleanBeg}${sepBeg}${cleanInner}${sepEnd}${cleanEnd}` +
        body.slice(endIdx + closeLen);
    }
  }

  // Expand macros sequentially respecting LaTeX scope/group boundaries ({...} and \begin{env}...\end{env})
  const builtinCmdNames = new Set([
    'textbf', 'textit', 'emph', 'underline', 'textrm', 'textsf', 'texttt', 'textsc',
    'textsl', 'textnormal', 'textup', 'sout', 'uline', 'text', 'mbox', 'hbox', 'makebox',
    'framebox', 'parbox', 'fbox', 'textcolor', 'color', 'section', 'subsection',
    'subsubsection', 'paragraph', 'title', 'author', 'date', 'caption', 'label',
    'ref', 'eqref', 'cite', 'frac', 'dfrac', 'tfrac', 'sqrt', 'begin', 'end', 'tikz',
  ]);
  const mathReservedCmds = new Set([
    'x', 'y', 't', 'pi', 'e', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos',
    'arctan', 'sinh', 'cosh', 'tanh', 'ln', 'log', 'exp', 'sqrt', 'abs', 'floor', 'ceil',
    'frac', 'dfrac', 'tfrac', 'cdot', 'times', 'div', 'left', 'right',
  ]);

  const expandMacrosScoped = (
    input: string,
    initialMap: Map<string, ExtractedMacro>,
    maxOps = 40000
  ): string => {
    const verbatimHolders: string[] = [];
    const safeInput = input.replace(
      /\\begin\{(verbatim\*?|lstlisting|minted)\}([\s\S]*?)\\end\{\1\}/g,
      (full) => {
        const tok = `\x00VERBSC_${verbatimHolders.length}\x00`;
        verbatimHolders.push(full);
        return tok;
      }
    );

    type ScopeFrame = {
      kind: 'root' | 'brace' | 'group' | 'env';
      envName?: string;
      macros: Map<string, ExtractedMacro>;
    };
    const stack: ScopeFrame[] = [{ kind: 'root', macros: new Map(initialMap) }];
    const topMacros = () => stack[stack.length - 1].macros;

    type StreamChunk = { str: string; pos: number; name?: string };
    const chunks: StreamChunk[] = [{ str: safeInput, pos: 0 }];

    const trimChunks = () => {
      while (chunks.length > 0 && chunks[chunks.length - 1].pos >= chunks[chunks.length - 1].str.length) {
        chunks.pop();
      }
    };
    const eof = (): boolean => {
      trimChunks();
      return chunks.length === 0;
    };
    const peekChar = (offset = 0): string => {
      let rem = offset;
      for (let i = chunks.length - 1; i >= 0; i--) {
        const c = chunks[i];
        const avail = c.str.length - c.pos;
        if (rem < avail) return c.str[c.pos + rem];
        rem -= avail;
      }
      return '';
    };
    const peekSlice = (maxLen: number): string => {
      let res = '';
      for (let i = chunks.length - 1; i >= 0 && res.length < maxLen; i--) {
        const c = chunks[i];
        const avail = c.str.length - c.pos;
        if (avail > 0) res += c.str.slice(c.pos, c.pos + (maxLen - res.length));
      }
      return res;
    };
    const consume = (n: number) => {
      let rem = n;
      while (rem > 0 && chunks.length > 0) {
        const top = chunks[chunks.length - 1];
        const avail = top.str.length - top.pos;
        if (rem < avail) {
          top.pos += rem;
          rem = 0;
        } else {
          rem -= avail;
          chunks.pop();
        }
      }
    };
    const readWs = (): string => {
      let ws = '';
      while (!eof()) {
        const ch = peekChar(0);
        if (ch === ' ' || ch === '\t' || ch === '\n') {
          ws += ch;
          consume(1);
        } else {
          break;
        }
      }
      return ws;
    };
    const skipWs = () => {
      while (!eof()) {
        const ch = peekChar(0);
        if (ch === ' ' || ch === '\t' || ch === '\n') consume(1);
        else break;
      }
    };
    const readBalanced = (openCh: string, closeCh: string): { content: string; raw: string } | null => {
      if (peekChar(0) !== openCh) return null;
      let raw = '';
      let depth = 0;
      while (!eof()) {
        const ch = peekChar(0);
        raw += ch;
        consume(1);
        if (ch === '\\' && !eof()) {
          const next = peekChar(0);
          raw += next;
          consume(1);
          continue;
        }
        if (ch === openCh) depth++;
        else if (ch === closeCh) {
          depth--;
          if (depth === 0) {
            return { content: raw.slice(1, -1), raw };
          }
        }
      }
      return null;
    };
    const readCmdOrBraceName = (): string | null => {
      skipWs();
      if (peekChar(0) === '{') {
        const br = readBalanced('{', '}');
        if (!br) return null;
        const inner = br.content.trim();
        return inner.startsWith('\\') ? inner.slice(1).trim() : null;
      }
      const head = peekSlice(80);
      const nm = head.match(/^\\([a-zA-Z]+)/);
      if (nm) {
        consume(nm[0].length);
        return nm[1];
      }
      return null;
    };
    const isExpanding = (name: string): number => {
      let cnt = 0;
      for (const c of chunks) {
        if (c.name === name) cnt++;
      }
      return cnt;
    };

    const expandValueShallow = (valStr: string, map: Map<string, ExtractedMacro>, excludeMath = false): string => {
      if (!valStr.includes('\\')) return valStr;
      let res = valStr;
      for (let p = 0; p < 3; p++) {
        let changed = false;
        res = res.replace(/\\([a-zA-Z]+)(?![a-zA-Z])/g, (full, cmdName: string, offset: number) => {
          if (excludeMath && mathReservedCmds.has(cmdName)) return full;
          if (builtinCmdNames.has(cmdName)) return full;
          const mac = map.get(cmdName);
          if (!mac || mac.argCount > 0) return full;
          changed = true;
          const nextCh = res[offset + full.length] ?? '';
          const endsWithLetter = /[a-zA-Z]$/.test(mac.body);
          return endsWithLetter && /[a-zA-Z0-9]/.test(nextCh) ? `${mac.body} ` : mac.body;
        });
        if (!changed) break;
      }
      return res;
    };

    const outParts: string[] = [];
    let ops = 0;
    let foreachClearVars: string[] | null = null;

    while (!eof() && ops < maxOps) {
      ops++;
      trimChunks();
      if (chunks.length === 0) break;

      const top = chunks[chunks.length - 1];
      const nextSpecial = top.str.slice(top.pos).search(/[\\{}]/);
      if (nextSpecial === -1) {
        outParts.push(top.str.slice(top.pos));
        chunks.pop();
        continue;
      }
      if (nextSpecial > 0) {
        outParts.push(top.str.slice(top.pos, top.pos + nextSpecial));
        top.pos += nextSpecial;
        continue;
      }

      const ch = top.str[top.pos];
      if (ch === '{') {
        const nextMacros = new Map(topMacros());
        if (foreachClearVars) {
          foreachClearVars.forEach((v) => nextMacros.delete(v));
          foreachClearVars = null;
        }
        stack.push({ kind: 'brace', macros: nextMacros });
        outParts.push('{');
        consume(1);
        continue;
      }
      if (ch === '}') {
        if (stack.length > 1 && stack[stack.length - 1].kind === 'brace') {
          stack.pop();
        }
        outParts.push('}');
        consume(1);
        continue;
      }

      // ch === '\\'
      const ahead = peekSlice(96);
      if (ahead.length >= 2 && /[\\{}%$&_# ,;!()[\]]/.test(ahead[1])) {
        outParts.push(ahead.slice(0, 2));
        consume(2);
        continue;
      }

      const cmdMatch = ahead.match(/^\\([a-zA-Z@]+)\*?/);
      if (!cmdMatch) {
        outParts.push('\\');
        consume(1);
        continue;
      }

      const fullCmd = cmdMatch[0];
      const cmd = cmdMatch[1];

      // 1. \begin{env} / \end{env} grouping
      if (cmd === 'begin' || cmd === 'end') {
        consume(fullCmd.length);
        const ws = readWs();
        const envBr = readBalanced('{', '}');
        if (!envBr) {
          outParts.push(fullCmd + ws);
          continue;
        }
        const envName = envBr.content.trim();
        outParts.push(`${fullCmd}${ws}${envBr.raw}`);
        if (cmd === 'begin') {
          stack.push({ kind: 'env', envName, macros: new Map(topMacros()) });
        } else {
          for (let s = stack.length - 1; s >= 1; s--) {
            if (stack[s].kind === 'env' && stack[s].envName === envName) {
              stack.length = s;
              break;
            }
          }
        }
        continue;
      }

      // 2. \begingroup / \endgroup
      if (cmd === 'begingroup') {
        consume(fullCmd.length);
        stack.push({ kind: 'group', macros: new Map(topMacros()) });
        outParts.push(fullCmd);
        continue;
      }
      if (cmd === 'endgroup') {
        consume(fullCmd.length);
        for (let s = stack.length - 1; s >= 1; s--) {
          if (stack[s].kind === 'group') {
            stack.length = s;
            break;
          }
        }
        outParts.push(fullCmd);
        continue;
      }

      // 3. \newcommand / \renewcommand / \providecommand / \DeclareRobustCommand
      if (
        cmd === 'newcommand' ||
        cmd === 'renewcommand' ||
        cmd === 'providecommand' ||
        cmd === 'DeclareRobustCommand'
      ) {
        consume(fullCmd.length);
        const targetName = readCmdOrBraceName();
        if (!targetName) {
          continue;
        }
        skipWs();
        let argCount = 0;
        let defaultOpt: string | undefined;
        if (peekChar(0) === '[') {
          const brk = readBalanced('[', ']');
          if (brk) {
            argCount = Math.max(0, Math.min(9, parseInt(brk.content.trim(), 10) || 0));
            skipWs();
          }
        }
        if (peekChar(0) === '[') {
          const defOpt = readBalanced('[', ']');
          if (defOpt) {
            defaultOpt = defOpt.content;
            skipWs();
          }
        }
        const bodyBr = peekChar(0) === '{' ? readBalanced('{', '}') : null;
        if (bodyBr) {
          if (cmd !== 'providecommand' || !topMacros().has(targetName)) {
            topMacros().set(targetName, {
              name: targetName,
              argCount,
              defaultOpt,
              body: bodyBr.content,
            });
          }
        }
        continue;
      }

      // 4. \DeclareMathOperator(*)?{\op}{text}
      if (cmd === 'DeclareMathOperator') {
        const starred = fullCmd.endsWith('*');
        consume(fullCmd.length);
        const targetName = readCmdOrBraceName();
        skipWs();
        const bodyBr = peekChar(0) === '{' ? readBalanced('{', '}') : null;
        if (targetName && bodyBr) {
          topMacros().set(targetName, {
            name: targetName,
            argCount: 0,
            body: starred ? `\\operatorname*{${bodyBr.content}}` : `\\operatorname{${bodyBr.content}}`,
          });
        }
        continue;
      }

      // 5. \def / \gdef / \edef / \xdef (preserving TikZ \def\f(#1){...} functions!)
      if (cmd === 'def' || cmd === 'gdef' || cmd === 'edef' || cmd === 'xdef') {
        consume(fullCmd.length);
        skipWs();
        const targetHead = peekSlice(80);
        const nm = targetHead.match(/^\\([a-zA-Z]+)/);
        if (!nm) continue;
        const targetName = nm[1];
        consume(nm[0].length);
        skipWs();

        // TikZ math function definition like \def\f(#1){(#1)^2 - 1}
        if (peekChar(0) === '(') {
          const paren = readBalanced('(', ')');
          skipWs();
          const fnBody = peekChar(0) === '{' ? readBalanced('{', '}') : null;
          if (paren && fnBody) {
            const expandedBody = expandValueShallow(fnBody.content, topMacros(), true);
            outParts.push(`\\def\\${targetName}${paren.raw}{${expandedBody}}`);
          }
          continue;
        }

        // Standard TeX \def\name#1#2...{body}
        let argCount = 0;
        while (peekChar(0) === '#' && /[1-9]/.test(peekChar(1))) {
          argCount = Math.min(9, argCount + 1);
          consume(2);
          skipWs();
        }
        const defBody = peekChar(0) === '{' ? readBalanced('{', '}') : null;
        if (defBody) {
          const finalBody =
            cmd === 'edef' || cmd === 'xdef'
              ? expandValueShallow(defBody.content, topMacros())
              : defBody.content;
          const macroObj: ExtractedMacro = { name: targetName, argCount, body: finalBody };
          if (cmd === 'gdef' || cmd === 'xdef') {
            stack.forEach((f) => f.macros.set(targetName, macroObj));
          } else {
            topMacros().set(targetName, macroObj);
          }
        }
        continue;
      }

      // 6. \pgfmathsetmacro / \pgfmathtruncatemacro
      if (cmd === 'pgfmathsetmacro' || cmd === 'pgfmathtruncatemacro') {
        consume(fullCmd.length);
        const targetName = readCmdOrBraceName();
        skipWs();
        const exprBr = peekChar(0) === '{' ? readBalanced('{', '}') : null;
        if (targetName && exprBr) {
          const expandedExpr = expandValueShallow(exprBr.content, topMacros(), false);
          const evaluated = evaluateTikzMathExpr(expandedExpr);
          if (evaluated !== null) {
            const finalNum = cmd === 'pgfmathtruncatemacro' ? Math.trunc(evaluated) : evaluated;
            topMacros().set(targetName, {
              name: targetName,
              argCount: 0,
              body: String(Math.round(finalNum * 1e8) / 1e8),
            });
          } else {
            // Keep runtime variable expression (e.g. depends on \foreach loop variable) for tikzRenderer
            outParts.push(`\\${cmd}{\\${targetName}}{${expandedExpr}}`);
          }
        }
        continue;
      }

      // 7. \foreach \v in {...} -> mask loop variables from outer macros inside loop body
      if (cmd === 'foreach') {
        consume(fullCmd.length);
        outParts.push(fullCmd);
        const restHead = peekSlice(120);
        const feM = restHead.match(/^(\s*(?:\\[a-zA-Z]+(?:\s*\/\s*\\[a-zA-Z]+)*)\s*(?:\[[^\]]*\])?\s*in\s*)/);
        if (feM) {
          outParts.push(feM[1]);
          consume(feM[1].length);
          const varsFound = (feM[1].match(/\\[a-zA-Z]+/g) || []).map((v) => v.slice(1));
          if (peekChar(0) === '{') {
            const listBr = readBalanced('{', '}');
            if (listBr) {
              const expList = expandValueShallow(listBr.content, topMacros(), false);
              outParts.push(`{${expList}}`);
            }
          }
          if (varsFound.length > 0) {
            const wsAfterList = readWs();
            outParts.push(wsAfterList);
            if (peekChar(0) === '{') {
              foreachClearVars = varsFound;
            }
          }
        }
        continue;
      }

      // 8. Active macro expansion
      const macro = !builtinCmdNames.has(cmd) ? topMacros().get(cmd) : undefined;
      if (macro && isExpanding(cmd) < 2 && chunks.length < 24) {
        if (macro.argCount === 0) {
          consume(fullCmd.length);
          const nextCh = peekChar(0);
          const endsWithLetter = /[a-zA-Z]$/.test(macro.body);
          const expansion =
            endsWithLetter && /[a-zA-Z0-9]/.test(nextCh) ? `${macro.body} ` : macro.body;
          chunks.push({ str: expansion, pos: 0, name: cmd });
          continue;
        }

        // Parameterized macro (1..9 args + optional [default])
        const peekedAfter = peekSlice(fullCmd.length + 12).slice(fullCmd.length);
        const firstNonWs = peekedAfter.replace(/^[ \t\n]+/, '')[0] ?? '';
        if ((macro.argCount === 1 && macro.defaultOpt !== undefined) || firstNonWs === '[' || firstNonWs === '{') {
          consume(fullCmd.length);
          let wsAfter = readWs();
          const args: string[] = [];
          let rawConsumed = wsAfter;
          let neededBraces = macro.argCount;

          if (macro.defaultOpt !== undefined) {
            if (peekChar(0) === '[') {
              const optBr = readBalanced('[', ']');
              if (optBr) {
                args.push(optBr.content);
                rawConsumed += optBr.raw;
              } else {
                args.push(macro.defaultOpt);
              }
            } else {
              args.push(macro.defaultOpt);
            }
            neededBraces = macro.argCount - 1;
          }

          let argsOk = true;
          for (let a = 0; a < neededBraces; a++) {
            const gap = readWs();
            rawConsumed += gap;
            if (peekChar(0) === '{') {
              const argBr = readBalanced('{', '}');
              if (argBr) {
                args.push(argBr.content);
                rawConsumed += argBr.raw;
              } else {
                argsOk = false;
                break;
              }
            } else {
              const tokM = peekSlice(40).match(/^\\[a-zA-Z]+/);
              if (tokM) {
                args.push(tokM[0]);
                rawConsumed += tokM[0];
                consume(tokM[0].length);
              } else if (!eof()) {
                const chArg = peekChar(0);
                args.push(chArg);
                rawConsumed += chArg;
                consume(1);
              } else {
                argsOk = false;
                break;
              }
            }
          }

          if (!argsOk) {
            outParts.push(fullCmd + rawConsumed);
            continue;
          }

          let expanded = macro.body;
          args.forEach((argVal, idx) => {
            expanded = expanded.replace(new RegExp(`#${idx + 1}`, 'g'), () => argVal);
          });
          chunks.push({ str: expanded, pos: 0, name: cmd });
          continue;
        }
      }

      // Default command: copy through verbatim
      outParts.push(fullCmd);
      consume(fullCmd.length);
    }

    let joined = outParts.join('');
    for (let i = 0; i < verbatimHolders.length; i++) {
      joined = joined.replace(`\x00VERBSC_${i}\x00`, () => verbatimHolders[i]);
    }
    return joined;
  };

  body = expandMacrosScoped(body, preambleMacros);

  // Evaluate and expand TeX \countN=start \loop\ifnum\countN<limit ... \advance\countN by step ... \repeat
  const evalTexCmp = (a: number, op: string, b: number): boolean => {
    if (op === '<') return a < b;
    if (op === '<=') return a <= b;
    if (op === '>') return a > b;
    if (op === '>=') return a >= b;
    if (op === '=') return a === b;
    return false;
  };
  const whileLoopRe =
    /\\count(\d+)\s*=\s*(-?\d+)\s*\\loop\s*\\ifnum\s*\\count\1\s*(<=|>=|<|>|=)\s*(-?\d+)\b([\s\S]*?)\\repeat(?![a-zA-Z])/g;
  body = body.replace(
    whileLoopRe,
    (_full, reg: string, startStr: string, op: string, limitStr: string, rawLoopBody: string) => {
      let cur = parseInt(startStr, 10);
      const limit = parseInt(limitStr, 10);
      const advRe = new RegExp(`\\\\advance\\s*\\\\count${reg}\\s*(?:by\\s*)?(-?\\d+)\\s*`, 'g');
      const advM = advRe.exec(rawLoopBody);
      const step = advM ? parseInt(advM[1], 10) : 0;
      const cleanBody = rawLoopBody.replace(advRe, '').trim();
      let out = '';
      let iter = 0;
      while (evalTexCmp(cur, op, limit) && iter < 30) {
        iter++;
        cur += step;
        if (cleanBody) {
          const iterChunk = cleanBody.replace(
            new RegExp(`\\\\(?:the|number)\\s*\\\\count${reg}(?![a-zA-Z])`, 'g'),
            String(cur)
          );
          out += `${iterChunk}\n`;
        }
        if (step === 0) break;
      }
      return out;
    }
  );

  const doWhileLoopRe =
    /\\count(\d+)\s*=\s*(-?\d+)\s*\\loop([\s\S]*?)\\ifnum\s*\\count\1\s*(<=|>=|<|>|=)\s*(-?\d+)\b\s*\\repeat(?![a-zA-Z])/g;
  body = body.replace(
    doWhileLoopRe,
    (_full, reg: string, startStr: string, rawLoopBody: string, op: string, limitStr: string) => {
      let cur = parseInt(startStr, 10);
      const limit = parseInt(limitStr, 10);
      const advRe = new RegExp(`\\\\advance\\s*\\\\count${reg}\\s*(?:by\\s*)?(-?\\d+)\\s*`, 'g');
      const advM = advRe.exec(rawLoopBody);
      const step = advM ? parseInt(advM[1], 10) : 1;
      const cleanBody = rawLoopBody.replace(advRe, '').trim();
      let out = '';
      let iter = 0;
      do {
        iter++;
        if (cleanBody) {
          const iterChunk = cleanBody.replace(
            new RegExp(`\\\\(?:the|number)\\s*\\\\count${reg}(?![a-zA-Z])`, 'g'),
            String(cur)
          );
          out += `${iterChunk}\n`;
        }
        cur += step;
        if (step === 0) break;
      } while (evalTexCmp(cur, op, limit) && iter < 30);
      return out;
    }
  );

  // Strip any leftover TeX register / loop primitives so they never leak as text or equations
  body = body
    .replace(/\\newcount\s*\\[a-zA-Z@]+\s*/g, '')
    .replace(/\\count\d+\s*=\s*-?\d+\s*/g, '')
    .replace(/\\advance\s*\\count\d+\s*(?:by\s*)?-?\d+\s*/g, '')
    .replace(/\\loop(?![a-zA-Z])\s*/g, '')
    .replace(/\\ifnum\s*\\count\d+\s*(?:<=|>=|<|>|=)\s*-?\d+\s*/g, '')
    .replace(/\\repeat(?![a-zA-Z])\s*/g, '');

  // Strip any \begin{comment}...\end{comment} or excluded comment envs introduced by macro expansion
  body = stripCommentEnvironments(body, excludedCommentEnvs);

  // Sequentially evaluate LaTeX counters (\newcounter, \setcounter, \addtocounter, \stepcounter, \refstepcounter, \the<name>, \arabic/\alph/\Alph/\roman/\Roman)
  if (
    /\\(?:newcounter|setcounter|addtocounter|stepcounter|refstepcounter|arabic|alph|Alph|roman|Roman)(?![a-zA-Z])/.test(
      body
    ) ||
    trackedCounters.size > 0
  ) {
    const formatCtrVal = (
      n: number,
      fmt: 'arabic' | 'alph' | 'Alph' | 'roman' | 'Roman'
    ): string => {
      if (fmt === 'arabic') return String(n);
      if (fmt === 'alph') return n >= 1 && n <= 26 ? String.fromCharCode(96 + n) : String(n);
      if (fmt === 'Alph') return n >= 1 && n <= 26 ? String.fromCharCode(64 + n) : String(n);
      const toRom = (num: number): string => {
        if (num <= 0 || num >= 4000) return String(num);
        const tbl: Array<[number, string]> = [
          [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
          [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
          [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
        ];
        let r = '';
        let v = num;
        for (const [val, sym] of tbl) {
          while (v >= val) {
            r += sym;
            v -= val;
          }
        }
        return r;
      };
      const rom = toRom(n);
      return fmt === 'roman' ? rom.toLowerCase() : rom;
    };

    const resetChildCounters = (parentName: string) => {
      const children = counterResetChildren[parentName];
      if (!children) return;
      children.forEach((child) => {
        counterValues[child] = 0;
        resetChildCounters(child);
      });
    };

    const ctrProtected: string[] = [];
    const safeCtrSrc = body.replace(
      /\\begin\{(verbatim\*?|lstlisting|minted|tikzpicture|pgfpicture)\}([\s\S]*?)\\end\{\1\}/g,
      (full) => {
        const tok = `\x00CTRPROT_${ctrProtected.length}\x00`;
        ctrProtected.push(full);
        return tok;
      }
    );

    // Match counter commands, \the<tracked>, formatting commands, and section headers (for parent reset)
    const theNames = [...trackedCounters]
      .filter((n) => /^[a-zA-Z]+$/.test(n))
      .sort((a, b) => b.length - a.length)
      .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const theAlt = theNames.length > 0 ? `|\\\\the(?:${theNames.join('|')})(?![a-zA-Z])` : '';
    const ctrTokenRe = new RegExp(
      `\\\\(?:newcounter\\s*\\{([^}]+)\\}(?:\\s*\\[([^\\]]*)\\])?|(?:refstepcounter|stepcounter)\\s*\\{([^}]+)\\}|(setcounter|addtocounter)\\s*\\{([^}]+)\\}\\s*\\{([^}]*)\\}|(arabic|alph|Alph|roman|Roman)\\s*\\{([^}]+)\\}|(section|subsection|subsubsection)\\*?(?![a-zA-Z]))${theAlt}`,
      'g'
    );

    const isBuiltinExCtr = (c: string) =>
      (c === 'ex' || c === 'bt' || c === 'vd') && !customEnvNames.has(c);

    let evalOut = '';
    let lastPos = 0;
    let cm: RegExpExecArray | null;
    while ((cm = ctrTokenRe.exec(safeCtrSrc)) !== null) {
      const fullMatch = cm[0];
      const matchStart = cm.index;
      const matchEnd = matchStart + fullMatch.length;

      // Section/subsection reset hook (keep token intact)
      if (cm[9]) {
        resetChildCounters(cm[9]);
        continue;
      }

      // Preserve \setcounter / \addtocounter for built-in ex/bt/vd environments so parseBodyBlocks updates ctx.counters
      if (cm[4] && isBuiltinExCtr(cm[5].trim())) {
        continue;
      }

      // Skip formatting commands (\arabic{...}, etc.) for untracked counters (e.g. \arabic* in enumitem)
      if (cm[7] && !trackedCounters.has(cm[8].trim())) {
        continue;
      }

      let replacement = '';
      let isSilentCmd = false;

      if (cm[1] !== undefined) {
        // \newcounter{name}[parent]
        registerCounter(cm[1], cm[2]);
        isSilentCmd = true;
      } else if (cm[3] !== undefined) {
        // \stepcounter{name} or \refstepcounter{name}
        const cname = cm[3].trim();
        counterValues[cname] = (counterValues[cname] ?? 0) + 1;
        resetChildCounters(cname);
        isSilentCmd = true;
      } else if (cm[4] !== undefined) {
        // \setcounter{name}{val} or \addtocounter{name}{val}
        const cname = cm[5].trim();
        const v = parseInt(cm[6].trim(), 10);
        if (Number.isFinite(v)) {
          if (cm[4] === 'setcounter') {
            counterValues[cname] = v;
            resetChildCounters(cname);
          } else {
            counterValues[cname] = (counterValues[cname] ?? 0) + v;
          }
        }
        isSilentCmd = true;
      } else if (cm[7] !== undefined) {
        // \arabic{name} / \alph{name} / ...
        const cname = cm[8].trim();
        replacement = formatCtrVal(
          counterValues[cname] ?? 0,
          cm[7] as 'arabic' | 'alph' | 'Alph' | 'roman' | 'Roman'
        );
      } else if (fullMatch.startsWith('\\the')) {
        const cname = fullMatch.slice(4);
        replacement = String(counterValues[cname] ?? 0);
      }

      // When removing a silent counter command that stood alone on its own line, consume trailing newline to avoid creating a fake blank line
      let consumeEnd = matchEnd;
      let prefixSlice = safeCtrSrc.slice(lastPos, matchStart);
      if (isSilentCmd) {
        const trailingRest = safeCtrSrc.slice(matchEnd);
        const beforeHasOnlyIndent = /(?:^|\n)[ \t]*$/.test(evalOut + prefixSlice);
        const afterIsLineEnd = /^[ \t]*\n/.exec(trailingRest);
        if (beforeHasOnlyIndent && afterIsLineEnd) {
          prefixSlice = prefixSlice.replace(/[ \t]*$/, '');
          consumeEnd = matchEnd + afterIsLineEnd[0].length;
          ctrTokenRe.lastIndex = consumeEnd;
        }
      }

      evalOut += prefixSlice + replacement;
      lastPos = consumeEnd;
    }
    evalOut += safeCtrSrc.slice(lastPos);

    for (let idx = 0; idx < ctrProtected.length; idx++) {
      evalOut = evalOut.replace(`\x00CTRPROT_${idx}\x00`, () => ctrProtected[idx]);
    }
    body = evalOut;
  }

  // Break mid-line \noindent (e.g., "Chọn B.\noindent\textbf{Câu 5:}") onto a new line
  body = body.replace(/([^\s\n{[\\%])\s*\\noindent(?![a-zA-Z])\s*/g, '$1\n');
  if (pageConfig.defaultParIndentPt > 0) {
    body = body.replace(/\\noindent(?![a-zA-Z])[ \t]*/g, '\x00NOINDENT\x00');
  } else {
    body = body.replace(/\\noindent(?![a-zA-Z])\s*/g, '');
  }

  const isFullLatexDoc =
    hasDocBegin ||
    Boolean(title || author) ||
    /\\(?:section|subsection|paragraph|maketitle|makebox|dotfill|tikz|immini|begin\{(?:enumerate|itemize|itemchoice|description|tasks|table|tabular|tabularx|longtable|figure|tikzpicture|pgfpicture|picture|abstract|verbatim|lstlisting|tcolorbox|framed|mdframed|shaded|ex|bt|vd|theorem|lemma|definition|proposition|corollary|proof|center|align|subequations|thebibliography|minipage|multicols))/.test(
      normalized
    ) ||
    Object.keys(customTheorems).some((env) => normalized.includes(`\\begin{${env}}`));

  body = normalizeChatGptAndMarkdownBody(body);

  return {
    body,
    title,
    author,
    date,
    isFullLatexDoc,
    isVietnamese,
    customTheorems,
    customColors,
    customTikzStyles,
    defaultTasksLabel,
    pageConfig,
  };
}

function resolveColorsInMath(latex: string, customColors?: Record<string, string>): string {
  if (!latex.includes('color')) return latex;
  return latex.replace(
    /\\(textcolor|color|mathcolor)\s*(?:\[([^\]]+)\])?\s*\{([^}]+)\}/g,
    (full, cmd: string, model: string | undefined, spec: string) => {
      const hex = resolveLatexModelAndSpec(model, spec, customColors);
      if (!hex) return full;
      const mappedCmd = cmd === 'mathcolor' ? 'textcolor' : cmd;
      return `\\${mappedCmd}{${hex}}`;
    }
  );
}

function normalizeMathContent(latex: string, ctx?: ParserContext): string {
  let s = latex.trim();
  const eqMatch = s.match(/^\\begin\{(equation\*?|displaymath)\}([\s\S]*)\\end\{\1\}$/);
  if (eqMatch) {
    s = eqMatch[2].trim();
  }
  s = resolveColorsInMath(s, ctx?.customColors);
  return s
    .replace(/\\label\{[^}]*\}/g, '')
    .replace(/\\tag\*?\{[^}]*\}/g, '')
    .replace(/\\(?:nonumber|notag)(?![a-zA-Z])/g, '')
    .replace(/\\intertext\{([^}]*)\}/g, '\\\\ \\text{$1} \\\\')
    .replace(/\\shortintertext\{([^}]*)\}/g, '\\\\ \\text{$1} \\\\')
    .replace(/\\begin\{alignat\*?\}\s*\{[^}]*\}/g, '\\begin{aligned}')
    .replace(/\\end\{alignat\*?\}/g, '\\end{aligned}')
    .replace(/\\begin\{alignedat\}\s*\{[^}]*\}/g, '\\begin{aligned}')
    .replace(/\\end\{alignedat\}/g, '\\end{aligned}')
    .replace(/\\begin\{(align\*?|flalign\*?|eqnarray\*?|split)\}/g, '\\begin{aligned}')
    .replace(/\\end\{(align\*?|flalign\*?|eqnarray\*?|split)\}/g, '\\end{aligned}')
    .replace(/\\begin\{(gather\*?|multline\*?)\}/g, '\\begin{gathered}')
    .replace(/\\end\{(gather\*?|multline\*?)\}/g, '\\end{gathered}')
    .trim();
}

const BARE_TEXT_STYLE_CMDS = new Set([
  'textbf',
  'textit',
  'emph',
  'underline',
  'textcolor',
  'text',
  'textrm',
  'textsf',
  'texttt',
  'mbox',
  'hbox',
]);

const BARE_PREFIX_MODIFIER_CMDS = new Set([
  'displaystyle',
  'textstyle',
  'scriptstyle',
  'scriptscriptstyle',
  'mathop',
]);

const BARE_LIMIT_EXTEND_CMDS = new Set([
  'lim',
  'limsup',
  'liminf',
]);

const VIETNAMESE_CHAR_RE =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

function readBalancedParens(
  src: string,
  openIdx: number
): { content: string; endIdx: number } | null {
  if (src[openIdx] !== '(') return null;
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length) {
      i++;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return {
          content: src.slice(openIdx + 1, i),
          endIdx: i,
        };
      }
    }
  }
  return null;
}

function isMathGroupContent(inner: string): boolean {
  if (VIETNAMESE_CHAR_RE.test(inner)) return false;
  // Strip LaTeX commands before checking for multi-letter natural-language prose words
  const stripped = inner.replace(/\\[a-zA-Z]+\*?/g, ' ');
  const proseWords = stripped.match(/[a-zA-Z]{2,}/g) ?? [];
  return proseWords.length === 0;
}

function skipHorizontalSpaces(text: string, idx: number): number {
  let i = idx;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) {
    i++;
  }
  return i;
}

function consumeBareLatexCmdChain(
  text: string,
  startIdx: number
): { end: number; cmds: string[] } | null {
  const rest = text.slice(startIdx);
  const firstMatch = rest.match(/^\\([a-zA-Z]+)\*?/);
  if (!firstMatch) return null;
  const firstCmd = firstMatch[1];
  if (BARE_TEXT_STYLE_CMDS.has(firstCmd)) return null;
  if (!BARE_LATEX_CMD_RE.test(`\\${firstCmd}`) && !(firstCmd === 'begin' && rest.startsWith('\\begin{'))) {
    return null;
  }

  const cmds: string[] = [firstCmd];
  let end = startIdx + firstMatch[0].length;
  let lastCmd = firstCmd;

  // Handle \left ... \right pairing if starting on \left
  if (firstCmd === 'left') {
    let depth = 1;
    let p = end;
    while (p < text.length && depth > 0) {
      if (text[p] === '\n') break;
      if (text[p] === '\\') {
        const sub = text.slice(p);
        if (/^\\left(?![a-zA-Z])/.test(sub)) {
          depth++;
          p += 5;
          continue;
        }
        if (/^\\right(?![a-zA-Z])/.test(sub)) {
          depth--;
          p += 6;
          if (depth === 0) {
            // Consume closing delimiter (e.g. ')', '.', '\|', '\}', ']')
            if (text[p] === '\\' && p + 1 < text.length) p += 2;
            else if (p < text.length && !/\s/.test(text[p])) p++;
            end = p;
            break;
          }
          continue;
        }
        p += 2;
        continue;
      }
      p++;
    }
  }

  let progressed = true;
  while (progressed && end < text.length) {
    progressed = false;
    const afterSpaces = skipHorizontalSpaces(text, end);
    const nextChar = text[afterSpaces];
    if (!nextChar || nextChar === '\n') break;

    if (nextChar === '[') {
      const brk = readBalancedBrackets(text, afterSpaces);
      if (brk) {
        end = brk.endIdx + 1;
        progressed = true;
        continue;
      }
    }
    if (nextChar === '{') {
      const br = readBalancedBraces(text, afterSpaces);
      if (br) {
        end = br.endIdx + 1;
        progressed = true;
        continue;
      }
    }
    if (nextChar === '^' || nextChar === '_') {
      let p = afterSpaces + 1;
      if (text[p] === '{') {
        const br = readBalancedBraces(text, p);
        if (br) p = br.endIdx + 1;
      } else if (text[p] === '\\') {
        const cm = text.slice(p).match(/^\\[a-zA-Z]+/);
        p += cm ? cm[0].length : 1;
      } else if (p < text.length && !/\s/.test(text[p])) {
        p++;
      }
      end = p;
      progressed = true;
      continue;
    }

    const limModMatch = text.slice(afterSpaces).match(/^\\(limits|nolimits)(?![a-zA-Z])/);
    if (limModMatch) {
      cmds.push(limModMatch[1]);
      lastCmd = limModMatch[1];
      end = afterSpaces + limModMatch[0].length;
      progressed = true;
      continue;
    }

    if (BARE_PREFIX_MODIFIER_CMDS.has(lastCmd) && text[afterSpaces] === '\\') {
      const subChain = consumeBareLatexCmdChain(text, afterSpaces);
      if (subChain) {
        cmds.push(...subChain.cmds);
        lastCmd = subChain.cmds[subChain.cmds.length - 1] ?? lastCmd;
        end = subChain.end;
        progressed = true;
        continue;
      }
    }
  }

  return { end, cmds };
}

function extendBareLimitExpression(text: string, initialEnd: number): number {
  let end = initialEnd;
  let hasOperand = false;
  let safety = 0;

  while (end < text.length && safety < 80) {
    safety++;
    const p = skipHorizontalSpaces(text, end);
    if (p >= text.length) break;
    const ch = text[p];

    // Hard stop boundaries
    if (ch === '\n' || ch === ';' || ch === ',' || ch === '?' || ch === '!' || ch === ':') {
      break;
    }
    if (ch === '.' && !/^\.\d/.test(text.slice(p))) {
      break;
    }
    if (VIETNAMESE_CHAR_RE.test(ch)) {
      break;
    }

    // Bare LaTeX command (e.g. \frac{...}{...}, \infty, \sin, \left(...\right), \lim...)
    if (ch === '\\') {
      const chain = consumeBareLatexCmdChain(text, p);
      if (!chain) break;
      end = chain.end;
      hasOperand = true;
      continue;
    }

    // Parenthesized / bracketed math group (e.g. (x^2 + 1), [0, 1])
    if (ch === '(') {
      const pr = readBalancedParens(text, p);
      if (!pr || !isMathGroupContent(pr.content)) break;
      let nextEnd = pr.endIdx + 1;
      // Consume trailing ^ / _ / ' (e.g. (x+1)^2 or (x)')
      while (nextEnd < text.length && (text[nextEnd] === '^' || text[nextEnd] === '_' || text[nextEnd] === "'")) {
        if (text[nextEnd] === "'") {
          nextEnd++;
        } else {
          nextEnd++;
          if (text[nextEnd] === '{') {
            const br = readBalancedBraces(text, nextEnd);
            if (br) nextEnd = br.endIdx + 1;
          } else if (nextEnd < text.length && !/\s/.test(text[nextEnd])) {
            nextEnd++;
          }
        }
      }
      end = nextEnd;
      hasOperand = true;
      continue;
    }
    if (ch === '[') {
      const brk = readBalancedBrackets(text, p);
      if (!brk || !isMathGroupContent(brk.content)) break;
      end = brk.endIdx + 1;
      hasOperand = true;
      continue;
    }

    // Absolute value |...|
    if (ch === '|') {
      const closeBar = text.indexOf('|', p + 1);
      if (closeBar === -1 || text.slice(p + 1, closeBar).includes('\n')) break;
      if (!isMathGroupContent(text.slice(p + 1, closeBar))) break;
      end = closeBar + 1;
      hasOperand = true;
      continue;
    }

    // Number (e.g. 1, 2.5, 2x)
    const numM = text.slice(p).match(/^\d+(?:[.,]\d+)?/);
    if (numM) {
      let nextEnd = p + numM[0].length;
      if (
        nextEnd < text.length &&
        /[a-zA-Z]/.test(text[nextEnd]) &&
        !/\p{L}/u.test(text[nextEnd + 1] || '')
      ) {
        nextEnd++;
      }
      end = nextEnd;
      hasOperand = true;
      continue;
    }

    // Single-letter identifier / function call like f(x), g'(x), u_n, x^2, y (never "B." choice marker or "và")
    if (/[a-zA-Z]/.test(ch)) {
      const nextCh = text[p + 1] ?? '';
      if (/\p{L}/u.test(nextCh)) {
        // Multi-letter bare word (including Vietnamese words like "và", "với", "tại") -> stop
        break;
      }
      if (nextCh === '.' && (p + 2 >= text.length || /\s/.test(text[p + 2]))) {
        // Choice marker like "B. " or end-of-sentence single letter
        break;
      }
      let nextEnd = p + 1;
      while (nextEnd < text.length) {
        if (text[nextEnd] === "'") {
          nextEnd++;
        } else if (text[nextEnd] === '^' || text[nextEnd] === '_') {
          nextEnd++;
          if (text[nextEnd] === '{') {
            const br = readBalancedBraces(text, nextEnd);
            if (br) nextEnd = br.endIdx + 1;
          } else if (text[nextEnd] === '\\') {
            const cm = text.slice(nextEnd).match(/^\\[a-zA-Z]+/);
            nextEnd += cm ? cm[0].length : 1;
          } else if (nextEnd < text.length && !/\s/.test(text[nextEnd])) {
            nextEnd++;
          }
        } else if (text[nextEnd] === '(') {
          const pr = readBalancedParens(text, nextEnd);
          if (pr && isMathGroupContent(pr.content)) {
            nextEnd = pr.endIdx + 1;
          } else {
            break;
          }
        } else {
          break;
        }
      }
      end = nextEnd;
      hasOperand = true;
      continue;
    }

    // Math operators / relations (only consume if followed by a valid math token)
    if (ch === '=' || ch === '<' || ch === '>' || ch === '≤' || ch === '≥' || ch === '≠' || ch === '+' || ch === '-' || ch === '−' || ch === '*' || ch === '/') {
      const afterOp = skipHorizontalSpaces(text, p + 1);
      const nextAfterOp = text[afterOp];
      if (!nextAfterOp || nextAfterOp === '\n' || VIETNAMESE_CHAR_RE.test(nextAfterOp)) break;
      const validNext =
        nextAfterOp === '\\' ||
        nextAfterOp === '(' ||
        nextAfterOp === '[' ||
        nextAfterOp === '|' ||
        nextAfterOp === '+' ||
        nextAfterOp === '-' ||
        nextAfterOp === '−' ||
        /\d/.test(nextAfterOp) ||
        (/[a-zA-Z]/.test(nextAfterOp) &&
          !/\p{L}/u.test(text[afterOp + 1] || '') &&
          !(text[afterOp + 1] === '.' && (afterOp + 2 >= text.length || /\s/.test(text[afterOp + 2]))));
      if (!validNext) break;
      if (!hasOperand && (ch === '=' || ch === '<' || ch === '>')) {
        // Don't swallow trailing relation if no operand was seen yet unless unary +/-
        break;
      }
      end = p + 1;
      continue;
    }

    break;
  }

  return end;
}

function splitBareLatexTokens(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let cursor = 0;
  let i = 0;

  const pushText = (s: string) => {
    if (!s) return;
    const prev = segments[segments.length - 1];
    if (prev && prev.type === 'text' && !prev.bold && !prev.italic && !prev.underline) {
      prev.content += s;
    } else {
      segments.push({ type: 'text', content: s });
    }
  };

  while (i < text.length) {
    if (text[i] === '\\') {
      const chain = consumeBareLatexCmdChain(text, i);
      if (chain) {
        let end = chain.end;
        if (chain.cmds.some((c) => BARE_LIMIT_EXTEND_CMDS.has(c))) {
          end = extendBareLimitExpression(text, end);
        }

        if (i > cursor) pushText(text.slice(cursor, i));
        const expr = text.slice(i, end).trim();
        if (expr) {
          segments.push({ type: 'math', content: expr });
        }
        cursor = end;
        i = end;
        continue;
      }
    }
    i++;
  }

  if (cursor < text.length) {
    pushText(text.slice(cursor));
  }
  return segments;
}

const ACCENT_MAP: Record<string, Record<string, string>> = {
  "'": { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', Y: 'Ý', c: 'ć', n: 'ń', s: 'ś', z: 'ź' },
  '`': { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', A: 'À', E: 'È', I: 'Ì', O: 'Ò', U: 'Ù' },
  '^': { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û', A: 'Â', E: 'Ê', I: 'Î', O: 'Ô', U: 'Û' },
  '~': { a: 'ã', n: 'ñ', o: 'õ', A: 'Ã', N: 'Ñ', O: 'Õ' },
  '"': { a: 'ä', e: 'ë', i: 'ï', o: 'ö', u: 'ü', y: 'ÿ', A: 'Ä', E: 'Ë', I: 'Ï', O: 'Ö', U: 'Ü' },
  c: { c: 'ç', C: 'Ç', s: 'ş', S: 'Ş', t: 'ţ', T: 'Ţ' },
  v: { c: 'č', C: 'Č', s: 'š', S: 'Š', z: 'ž', Z: 'Ž', r: 'ř', R: 'Ř', e: 'ě', E: 'Ě' },
  u: { a: 'ă', A: 'Ă', g: 'ğ', G: 'Ğ' },
  '=': { a: 'ā', e: 'ē', i: 'ī', o: 'ō', u: 'ū', A: 'Ā', E: 'Ē', I: 'Ī', O: 'Ō', U: 'Ū' },
  r: { a: 'å', A: 'Å', u: 'ů', U: 'Ů' },
};

function decodeLatexTextAccents(s: string): string {
  return s
    .replace(/\\(['`^~"cuv=r])\{?\\?([a-zA-Z])\}?/g, (full, acc: string, ch: string) => {
      return ACCENT_MAP[acc]?.[ch] ?? full;
    })
    .replace(/\\i(?![a-zA-Z])/g, 'i')
    .replace(/\\j(?![a-zA-Z])/g, 'j')
    .replace(/\\ss(?![a-zA-Z])(?:\{\})?/g, 'ß')
    .replace(/\\ae(?![a-zA-Z])(?:\{\})?/g, 'æ')
    .replace(/\\AE(?![a-zA-Z])(?:\{\})?/g, 'Æ')
    .replace(/\\oe(?![a-zA-Z])(?:\{\})?/g, 'œ')
    .replace(/\\OE(?![a-zA-Z])(?:\{\})?/g, 'Œ')
    .replace(/\\o(?![a-zA-Z])(?:\{\})?/g, 'ø')
    .replace(/\\O(?![a-zA-Z])(?:\{\})?/g, 'Ø')
    .replace(/\\l(?![a-zA-Z])(?:\{\})?/g, 'ł')
    .replace(/\\L(?![a-zA-Z])(?:\{\})?/g, 'Ł');
}

function unescapeLatexTextProse(s: string, isVietnamese = true): string {
  let out = decodeLatexTextAccents(s);
  out = out
    .replace(/\\(?:XeLaTeX|LuaLaTeX|LaTeX|TeX|BibTeX)(?![a-zA-Z])(?:\{\})?/g, (m) =>
      m.replace(/^\\/, '').replace(/\{\}$/, '')
    )
    .replace(/\\today(?![a-zA-Z])(?:\{\})?/g, () => formatTodayDate(isVietnamese))
    .replace(/\\textbackslash(?:\{\}|\s)?/g, '\\')
    .replace(/\\textbar(?:\{\})?/g, '|')
    .replace(/\\textless(?:\{\})?/g, '<')
    .replace(/\\textgreater(?:\{\})?/g, '>')
    .replace(/\\(?:ldots|dots|textellipsis)(?:\{\})?/g, '…')
    .replace(/\\textasciitilde(?:\{\})?/g, '~')
    .replace(/\\textasciicircum(?:\{\})?/g, '^')
    .replace(/\\(?:text)?copyright(?![a-zA-Z])(?:\{\})?/g, '©')
    .replace(/\\textregistered(?![a-zA-Z])(?:\{\})?/g, '®')
    .replace(/\\texttrademark(?![a-zA-Z])(?:\{\})?/g, '™')
    .replace(/\\textbullet(?![a-zA-Z])(?:\{\})?/g, '•')
    .replace(/\\textperiodcentered(?![a-zA-Z])(?:\{\})?/g, '·')
    .replace(/\\textendash(?![a-zA-Z])(?:\{\})?/g, '–')
    .replace(/\\textemdash(?![a-zA-Z])(?:\{\})?/g, '—')
    .replace(/\\textquotedblleft(?![a-zA-Z])(?:\{\})?/g, '“')
    .replace(/\\textquotedblright(?![a-zA-Z])(?:\{\})?/g, '”')
    .replace(/\\textquoteleft(?![a-zA-Z])(?:\{\})?/g, '‘')
    .replace(/\\textquoteright(?![a-zA-Z])(?:\{\})?/g, '’')
    .replace(/\\guillemotleft(?![a-zA-Z])(?:\{\})?/g, '«')
    .replace(/\\guillemotright(?![a-zA-Z])(?:\{\})?/g, '»')
    .replace(/\\S(?![a-zA-Z])(?:\{\})?/g, '§')
    .replace(/\\P(?![a-zA-Z])(?:\{\})?/g, '¶')
    .replace(/\\dag(?![a-zA-Z])(?:\{\})?/g, '†')
    .replace(/\\ddag(?![a-zA-Z])(?:\{\})?/g, '‡')
    .replace(/\\pounds(?![a-zA-Z])(?:\{\})?/g, '£')
    .replace(/\\dotfill(?![a-zA-Z])\s*/g, ' .......................... ')
    .replace(/\\hrulefill(?![a-zA-Z])\s*/g, ' __________________________ ')
    .replace(/\\checkmark(?![a-zA-Z])(?:\{\})?/g, '✓')
    .replace(/\\([%&_#${}])/g, '$1')
    .replace(/\\(?:qquad)/g, '    ')
    .replace(/\\(?:quad|enspace)/g, '  ')
    .replace(/\\[,;:! \t\n]/g, ' ')
    .replace(/~/g, ' ')
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/``/g, '“')
    .replace(/''/g, '”')
    .replace(
      /\\(?:protect|relax|ignorespaces|allowbreak|linebreak|nolinebreak|sloppy|fussy|noindent|indent|centering|center|raggedright|raggedleft|smallskip|medskip|bigskip|vfill|normalfont|mdseries|upshape|rmfamily|sffamily|ttfamily|selectfont|strut|leavevmode|null|penalty\d*)(?![a-zA-Z])(?:\[\d*\])?\s*/g,
      ''
    )
    .replace(
      /\\(?:begin|end)\{(?:center|flushleft|flushright|minipage|figure\*?|table\*?|justify)\}(?:\s*\[[^\]]*\])?(?:\s*\{[^}]*\})?\s*/g,
      ''
    );
  return out;
}

function makeTextSegment(content: string, style: InlineStyle): InlineSegment {
  return {
    type: 'text',
    content,
    ...(style.bold ? { bold: true } : {}),
    ...(style.italic ? { italic: true } : {}),
    ...(style.underline ? { underline: true } : {}),
    ...(style.vert_align ? { vert_align: style.vert_align } : {}),
    ...(style.font_size_pt ? { font_size_pt: style.font_size_pt } : {}),
    ...(style.color ? { color: style.color } : {}),
  };
}

function makeMathSegment(
  content: string,
  style: InlineStyle,
  ctx?: ParserContext
): InlineSegment {
  return {
    type: 'math',
    content: normalizeMathContent(content, ctx),
    ...(style.bold ? { bold: true } : {}),
    ...(style.italic ? { italic: true } : {}),
    ...(style.font_size_pt ? { font_size_pt: style.font_size_pt } : {}),
    ...(style.color ? { color: style.color } : {}),
  };
}

function resolveRefText(
  cmd: string,
  keysRaw: string,
  ctx?: ParserContext
): string {
  const keys = keysRaw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  if (keys.length === 0) return '';

  if (cmd === 'cite' || cmd === 'citep' || cmd === 'citet' || cmd === 'parencite' || cmd === 'textcite') {
    const resolved = keys.map((k) => ctx?.cites[k] || k);
    return `[${resolved.join(', ')}]`;
  }

  const resolvedRefs = keys.map((k) => {
    const val = ctx?.labels[k];
    if (!val) return '?';
    if (cmd === 'eqref') {
      return val.startsWith('(') && val.endsWith(')') ? val : `(${val})`;
    }
    if (cmd === 'autoref' || cmd === 'cref' || cmd === 'Cref') {
      const kind = ctx?.labelKinds[k];
      if (kind) return `${kind} ${val}`;
    }
    return val;
  });
  return resolvedRefs.join(', ');
}

function parseInlineSegmentText(
  text: string,
  baseStyle: InlineStyle = {},
  mode: LatexPasteMode = 'auto',
  ctx?: ParserContext
): InlineSegment[] {
  const out: InlineSegment[] = [];
  let textBuffer = '';
  let currentStyle: InlineStyle = { ...baseStyle };

  const flushText = () => {
    if (!textBuffer) return;
    if (mode === 'bare_latex' || BARE_LATEX_CMD_RE.test(textBuffer)) {
      const split = splitBareLatexTokens(textBuffer);
      for (const part of split) {
        if (part.type === 'math') {
          out.push(makeMathSegment(part.content, currentStyle, ctx));
        } else if (part.content) {
          const cleanTxt = unescapeLatexTextProse(part.content, ctx?.isVietnamese ?? true);
          if (cleanTxt) out.push(makeTextSegment(cleanTxt, currentStyle));
        }
      }
    } else {
      const cleanTxt = unescapeLatexTextProse(textBuffer, ctx?.isVietnamese ?? true);
      if (cleanTxt) out.push(makeTextSegment(cleanTxt, currentStyle));
    }
    textBuffer = '';
  };

  let i = 0;
  while (i < text.length) {
    // Escaped \$
    if (text[i] === '\\' && text[i + 1] === '$') {
      textBuffer += '$';
      i += 2;
      continue;
    }

    // Inline \( ... \)
    if (text[i] === '\\' && text[i + 1] === '(') {
      const closeIdx = text.indexOf('\\)', i + 2);
      if (closeIdx !== -1) {
        flushText();
        const inner = text.slice(i + 2, closeIdx).trim();
        if (inner) out.push(makeMathSegment(inner, currentStyle, ctx));
        i = closeIdx + 2;
        continue;
      }
    }

    // Inline \[ ... \]
    if (text[i] === '\\' && text[i + 1] === '[') {
      const closeIdx = text.indexOf('\\]', i + 2);
      if (closeIdx !== -1) {
        flushText();
        const inner = text.slice(i + 2, closeIdx).trim();
        if (inner) out.push(makeMathSegment(inner, currentStyle, ctx));
        i = closeIdx + 2;
        continue;
      }
    }

    // Inline $$...$$ inside paragraph
    if (text[i] === '$' && text[i + 1] === '$') {
      const closeIdx = text.indexOf('$$', i + 2);
      if (closeIdx !== -1) {
        flushText();
        const inner = text.slice(i + 2, closeIdx).trim();
        if (inner) out.push(makeMathSegment(inner, currentStyle, ctx));
        i = closeIdx + 2;
        continue;
      }
    }

    // Inline $...$
    if (text[i] === '$') {
      let closeIdx = -1;
      for (let j = i + 1; j < text.length; j++) {
        if (text[j] === '\\' && j + 1 < text.length) {
          j++;
          continue;
        }
        if (text[j] === '$') {
          closeIdx = j;
          break;
        }
      }
      if (closeIdx !== -1) {
        flushText();
        const inner = text.slice(i + 1, closeIdx).trim();
        if (inner) out.push(makeMathSegment(inner, currentStyle, ctx));
        i = closeIdx + 1;
        continue;
      }
    }

    // Group { \bf ... }, { \it ... }, { \color{red} ... }, { \Large ... }, or chained switches
    if (text[i] === '{') {
      const br = readBalancedBraces(text, i);
      if (br) {
        let bodyStr = br.content.trimStart();
        const groupStyle: InlineStyle = { ...currentStyle };
        let matchedSwitch = false;
        while (bodyStr.length > 0) {
          const swM = bodyStr.match(
            /^\\(bfseries|bf|boldmath|unboldmath|itshape|it|em|slshape|sl|ttfamily|tt|scshape|sc|sffamily|rmfamily|mdseries|upshape|normalfont|selectfont|normalcolor|tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge)(?![a-zA-Z])\s*/
          );
          if (swM) {
            matchedSwitch = true;
            const sw = swM[1];
            bodyStr = bodyStr.slice(swM[0].length);
            if (sw === 'bf' || sw === 'bfseries' || sw === 'boldmath') groupStyle.bold = true;
            else if (sw === 'mdseries' || sw === 'unboldmath') groupStyle.bold = false;
            else if (sw === 'it' || sw === 'itshape' || sw === 'sl' || sw === 'slshape') {
              groupStyle.italic = true;
            } else if (sw === 'em') {
              groupStyle.italic = !groupStyle.italic;
            } else if (sw === 'upshape') groupStyle.italic = false;
            else if (sw === 'normalfont') {
              groupStyle.bold = baseStyle.bold;
              groupStyle.italic = baseStyle.italic;
              groupStyle.font_size_pt = baseStyle.font_size_pt;
            } else if (sw === 'normalcolor') {
              delete groupStyle.color;
            } else if (FONT_SIZE_PT_MAP[sw]) {
              groupStyle.font_size_pt = FONT_SIZE_PT_MAP[sw];
            }
            continue;
          }
          const colSwM = bodyStr.match(/^\\color(?:\s*\[([^\]]+)\])?\s*\{([^}]+)\}\s*/);
          if (colSwM) {
            matchedSwitch = true;
            bodyStr = bodyStr.slice(colSwM[0].length);
            const hex = resolveLatexModelAndSpec(colSwM[1], colSwM[2], ctx?.customColors);
            if (isBlackLatexColor(colSwM[2], hex)) {
              delete groupStyle.color;
            } else if (hex) {
              groupStyle.color = hex;
            }
            continue;
          }
          break;
        }
        if (matchedSwitch) {
          flushText();
          out.push(...parseInlineSegmentText(bodyStr, groupStyle, mode, ctx));
          i = br.endIdx + 1;
          continue;
        }
      }
    }

    if (text[i] === '\\') {
      const rest = text.slice(i);

      // \verb|...| or \lstinline|...|
      const verbMatch = rest.match(/^\\(?:verb\*?|lstinline(?:\[[^\]]*\])?)(.)/);
      if (verbMatch) {
        const delim = verbMatch[1];
        const startCode = i + verbMatch[0].length;
        const endCode = text.indexOf(delim, startCode);
        if (endCode !== -1) {
          flushText();
          out.push(makeTextSegment(text.slice(startCode, endCode), currentStyle));
          i = endCode + 1;
          continue;
        }
      }

      // \textcolor[model]{spec}{content} or \colorbox[model]{spec}{content}
      const tcMatch = rest.match(/^\\(textcolor|colorbox)(?:\s*\[([^\]]+)\])?\s*\{([^}]+)\}\s*\{/);
      if (tcMatch) {
        const braceStart = i + tcMatch[0].length - 1;
        const br = readBalancedBraces(text, braceStart);
        if (br) {
          flushText();
          let nextStyle: InlineStyle = { ...currentStyle };
          if (tcMatch[1] === 'textcolor') {
            const hex = resolveLatexModelAndSpec(tcMatch[2], tcMatch[3], ctx?.customColors);
            if (isBlackLatexColor(tcMatch[3], hex)) {
              delete nextStyle.color;
            } else if (hex) {
              nextStyle.color = hex;
            }
          }
          out.push(...parseInlineSegmentText(br.content, nextStyle, mode, ctx));
          i = br.endIdx + 1;
          continue;
        }
      }

      // \fcolorbox[model]{border}{bg}{content}
      const fcMatch = rest.match(/^\\fcolorbox(?:\s*\[([^\]]+)\])?\s*\{([^}]+)\}(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}\s*\{/);
      if (fcMatch) {
        const braceStart = i + fcMatch[0].length - 1;
        const br = readBalancedBraces(text, braceStart);
        if (br) {
          flushText();
          out.push(...parseInlineSegmentText(br.content, currentStyle, mode, ctx));
          i = br.endIdx + 1;
          continue;
        }
      }

      // \href{url}{label} or \url{url}
      const hrefMatch = rest.match(/^\\href\s*\{([^}]+)\}\s*\{/);
      if (hrefMatch) {
        const braceStart = i + hrefMatch[0].length - 1;
        const br = readBalancedBraces(text, braceStart);
        if (br) {
          flushText();
          out.push(
            ...parseInlineSegmentText(
              br.content,
              { ...currentStyle, color: currentStyle.color ?? '#1D4ED8', underline: true },
              mode,
              ctx
            )
          );
          i = br.endIdx + 1;
          continue;
        }
      }
      const urlMatch = rest.match(/^\\url\s*\{/);
      if (urlMatch) {
        const br = readBalancedBraces(text, i + urlMatch[0].length - 1);
        if (br) {
          flushText();
          out.push(
            makeTextSegment(br.content, {
              ...currentStyle,
              color: currentStyle.color ?? '#1D4ED8',
              underline: true,
            })
          );
          i = br.endIdx + 1;
          continue;
        }
      }

      // \ref, \eqref, \autoref, \cref, \Cref, \pageref, \cite, \citep, \citet
      const refCiteMatch = rest.match(
        /^\\(eqref|autoref|pageref|cref|Cref|ref|citep|citet|parencite|textcite|cite)\*?(?:\[[^\]]*\])?\s*\{/
      );
      if (refCiteMatch) {
        const braceStart = i + refCiteMatch[0].length - 1;
        const br = readBalancedBraces(text, braceStart);
        if (br) {
          const cmd = refCiteMatch[1];
          const resolved = resolveRefText(cmd, br.content, ctx);
          if (resolved) textBuffer += resolved;
          i = br.endIdx + 1;
          continue;
        }
      }

      // \footnote{...}
      const fnMatch = rest.match(/^\\footnote(?:\[[^\]]*\])?\s*\{/);
      if (fnMatch) {
        const braceStart = i + fnMatch[0].length - 1;
        const br = readBalancedBraces(text, braceStart);
        if (br) {
          flushText();
          const fnSegs = parseInlineSegmentText(
            br.content,
            { ...currentStyle, italic: true, font_size_pt: 10 },
            mode,
            ctx
          );
          out.push(makeTextSegment(' (', { ...currentStyle, font_size_pt: 10 }));
          out.push(...fnSegs);
          out.push(makeTextSegment(')', { ...currentStyle, font_size_pt: 10 }));
          i = br.endIdx + 1;
          continue;
        }
      }

      // \includegraphics[...]{path} inline
      const imgMatch = rest.match(/^\\includegraphics\*?(?:\[[^\]]*\])?\s*\{/);
      if (imgMatch) {
        const braceStart = i + imgMatch[0].length - 1;
        const br = readBalancedBraces(text, braceStart);
        if (br) {
          flushText();
          const fname = br.content.split('/').pop() || br.content;
          const imgLabel = ctx?.isVietnamese ? `[Hình ảnh: ${fname}]` : `[Figure: ${fname}]`;
          out.push(makeTextSegment(imgLabel, { ...currentStyle, italic: true, color: '#475569' }));
          i = br.endIdx + 1;
          continue;
        }
      }

      // \shortans[opts]{value} inline fallback
      const shortAnsInlineMatch = rest.match(/^\\shortans(?:\s*\[[^\]]*\])?\s*\{/);
      if (shortAnsInlineMatch) {
        const braceStart = i + shortAnsInlineMatch[0].length - 1;
        const br = readBalancedBraces(text, braceStart);
        if (br) {
          flushText();
          const ansStyle: InlineStyle = { ...currentStyle, bold: true, color: '#B91C1C' };
          out.push(makeTextSegment(' (Đáp án: ', ansStyle));
          out.push(...parseInlineSegmentText(br.content.trim(), ansStyle, mode, ctx));
          out.push(makeTextSegment(')', ansStyle));
          i = br.endIdx + 1;
          continue;
        }
      }

      // \makebox[w][pos]{content} or \framebox[w][pos]{content}
      const boxCmdMatch = rest.match(/^\\(makebox|framebox)\*?(?:\s*\[([^\]]*)\])?(?:\s*\[([^\]]*)\])?\s*\{/);
      if (boxCmdMatch) {
        const braceStart = i + boxCmdMatch[0].length - 1;
        const br = readBalancedBraces(text, braceStart);
        if (br) {
          flushText();
          const fillOnlyM = br.content.trim().match(/^\\(dotfill|hrulefill|hfill)(?![a-zA-Z])\s*$/);
          if (fillOnlyM) {
            const wPt = boxCmdMatch[2]
              ? parseLatexLengthToPt(boxCmdMatch[2], ctx?.pageConfig.contentWidthPt ?? 487.3, currentStyle.font_size_pt ?? 12)
              : null;
            const kind = fillOnlyM[1];
            const leader: 'none' | 'dot' | 'underscore' =
              kind === 'dotfill' ? 'dot' : kind === 'hrulefill' ? 'underscore' : 'none';
            out.push({
              type: 'text',
              content: '',
              tab_before: true,
              tab_leader: leader,
              ...(wPt && wPt > 0 ? { tab_width_pt: wPt } : {}),
            });
            let after = br.endIdx + 1;
            while (after < text.length && (text[after] === ' ' || text[after] === '\t')) {
              after++;
            }
            i = after;
            continue;
          }
          out.push(...parseInlineSegmentText(br.content, currentStyle, mode, ctx));
          let after = br.endIdx + 1;
          while (after < text.length && (text[after] === ' ' || text[after] === '\t')) {
            after++;
          }
          if (after < text.length && text[after] !== '\n') {
            out.push(makeTextSegment('  ', currentStyle));
          }
          i = after;
          continue;
        }
      }

      // \parbox[pos]{width}{content}, \raisebox{lift}[h][d]{content}, \scalebox{f}[v]{content}
      const parBoxMatch = rest.match(
        /^\\(?:parbox|raisebox|scalebox)(?:\s*\[[^\]]*\])*\s*\{[^}]*\}(?:\s*\[[^\]]*\])*\s*\{/
      );
      if (parBoxMatch) {
        const braceStart = i + parBoxMatch[0].length - 1;
        const br = readBalancedBraces(text, braceStart);
        if (br) {
          flushText();
          out.push(...parseInlineSegmentText(br.content, currentStyle, mode, ctx));
          i = br.endIdx + 1;
          continue;
        }
      }

      // \resizebox{w}{h}{content}
      const resizeMatch = rest.match(/^\\resizebox\*?\s*\{[^}]*\}\s*\{[^}]*\}\s*\{/);
      if (resizeMatch) {
        const braceStart = i + resizeMatch[0].length - 1;
        const br = readBalancedBraces(text, braceStart);
        if (br) {
          flushText();
          out.push(...parseInlineSegmentText(br.content, currentStyle, mode, ctx));
          i = br.endIdx + 1;
          continue;
        }
      }

      // \rule[lift]{width}{height}
      const ruleMatch = rest.match(/^\\rule(?:\s*\[[^\]]*\])?\s*\{[^}]*\}\s*\{[^}]*\}/);
      if (ruleMatch) {
        textBuffer += ' ______________ ';
        i += ruleMatch[0].length;
        continue;
      }

      // \SI{val}{unit}, \qty{val}{unit}, \num{val}, \si{unit}, \unit{unit}, \ce{...}
      const siTwoMatch = rest.match(/^\\(?:SI|qty)(?:\[[^\]]*\])?\s*\{/);
      if (siTwoMatch) {
        const br1 = readBalancedBraces(text, i + siTwoMatch[0].length - 1);
        if (br1) {
          const after1 = skipSpaces(text, br1.endIdx + 1);
          if (text[after1] === '{') {
            const br2 = readBalancedBraces(text, after1);
            if (br2) {
              const unitTxt = br2.content
                .replace(/\\per\b/g, '/')
                .replace(/\\([a-zA-Z]+)/g, '$1')
                .replace(/\s+/g, '');
              textBuffer += `${br1.content.trim()} ${unitTxt}`.trim();
              i = br2.endIdx + 1;
              continue;
            }
          }
        }
      }

      const siOneMatch = rest.match(/^\\(num|si|unit|ce)(?:\[[^\]]*\])?\s*\{/);
      if (siOneMatch) {
        const br = readBalancedBraces(text, i + siOneMatch[0].length - 1);
        if (br) {
          if (siOneMatch[1] === 'ce') {
            flushText();
            out.push(makeMathSegment(`\\mathrm{${br.content}}`, currentStyle, ctx));
          } else {
            textBuffer += br.content
              .replace(/\\per\b/g, '/')
              .replace(/\\([a-zA-Z]+)/g, '$1')
              .trim();
          }
          i = br.endIdx + 1;
          continue;
        }
      }

      // \textbf{}, \textmd{}, \textit{}, \emph{}, \underline{}, \fbox{}, \boxed{}, \textrm{}, \textsf{}, \texttt{}, \textsc{}, \textsl{}, \textnormal{}, \textup{}, \sout{}, \text{}, \mbox{}, \thead{}, \makecell{}, \textsuperscript{}, \textsubscript{}, \centerline{}, \leftline{}, \rightline{}, \uline{}, \cancel{}
      const styleMatch = rest.match(
        /^\\(textbf|textmd|textit|emph|underline|fbox|boxed|textrm|textsf|texttt|textsc|textsl|textnormal|textup|sout|uline|uwave|st|cancel|bcancel|xcancel|ul|text|mbox|hbox|thead|makecell|textsuperscript|textsubscript|centerline|leftline|rightline)(?:\[[^\]]*\])?\s*\{/
      );
      if (styleMatch) {
        const braceStart = i + styleMatch[0].length - 1;
        const br = readBalancedBraces(text, braceStart);
        if (br) {
          flushText();
          const cmd = styleMatch[1];
          if (cmd === 'underline' && /^\\(?:hspace\*?\{[^}]*\}|hfill)\s*$/.test(br.content.trim())) {
            out.push(makeTextSegment(' ______________ ', currentStyle));
            i = br.endIdx + 1;
            continue;
          }
          const nextBold =
            cmd === 'textmd' || cmd === 'textnormal'
              ? false
              : currentStyle.bold || cmd === 'textbf' || cmd === 'thead';
          const nextItalic =
            cmd === 'textup' || cmd === 'textnormal'
              ? false
              : cmd === 'emph'
              ? !currentStyle.italic
              : currentStyle.italic || cmd === 'textit' || cmd === 'textsl';
          const nextStyle: InlineStyle = {
            ...currentStyle,
            bold: nextBold,
            italic: nextItalic,
            underline: currentStyle.underline || cmd === 'underline' || cmd === 'ul' || cmd === 'uline',
            ...(cmd === 'textsuperscript'
              ? { vert_align: 'superscript' as const }
              : cmd === 'textsubscript'
              ? { vert_align: 'subscript' as const }
              : {}),
          };
          const innerContent =
            cmd === 'thead' || cmd === 'makecell'
              ? br.content.replace(/\\\\/g, '\n')
              : br.content;
          out.push(...parseInlineSegmentText(innerContent, nextStyle, mode, ctx));
          i = br.endIdx + 1;
          continue;
        }
      }

      // Inline switch without braces: \bfseries, \boldmath, \itshape, \Large, \normalcolor, \color[model]{spec}
      const inlineSwMatch = rest.match(
        /^\\(bfseries|bf|boldmath|unboldmath|itshape|it|em|slshape|sl|ttfamily|tt|scshape|sc|sffamily|rmfamily|mdseries|upshape|normalfont|selectfont|normalcolor|tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge)(?![a-zA-Z])\s*/
      );
      if (inlineSwMatch) {
        flushText();
        const sw = inlineSwMatch[1];
        if (sw === 'bf' || sw === 'bfseries' || sw === 'boldmath') currentStyle = { ...currentStyle, bold: true };
        else if (sw === 'mdseries' || sw === 'unboldmath') currentStyle = { ...currentStyle, bold: false };
        else if (sw === 'it' || sw === 'itshape' || sw === 'sl' || sw === 'slshape') {
          currentStyle = { ...currentStyle, italic: true };
        } else if (sw === 'em') {
          currentStyle = { ...currentStyle, italic: !currentStyle.italic };
        } else if (sw === 'upshape') currentStyle = { ...currentStyle, italic: false };
        else if (sw === 'normalfont') {
          currentStyle = {
            ...currentStyle,
            bold: baseStyle.bold,
            italic: baseStyle.italic,
            font_size_pt: baseStyle.font_size_pt,
          };
        } else if (sw === 'normalcolor') {
          const { color: _c, ...withoutColor } = currentStyle;
          currentStyle = withoutColor;
        } else if (FONT_SIZE_PT_MAP[sw]) {
          currentStyle = { ...currentStyle, font_size_pt: FONT_SIZE_PT_MAP[sw] };
        }
        i += inlineSwMatch[0].length;
        continue;
      }

      const inlineColorMatch = rest.match(/^\\color(?:\s*\[([^\]]+)\])?\s*\{([^}]+)\}\s*/);
      if (inlineColorMatch) {
        flushText();
        const hex = resolveLatexModelAndSpec(inlineColorMatch[1], inlineColorMatch[2], ctx?.customColors);
        if (isBlackLatexColor(inlineColorMatch[2], hex)) {
          const { color: _c, ...withoutColor } = currentStyle;
          currentStyle = withoutColor;
        } else if (hex) {
          currentStyle = { ...currentStyle, color: hex };
        }
        i += inlineColorMatch[0].length;
        continue;
      }

      // Explicit line break \\, \\*, or \newline
      if (text.slice(i, i + 2) === '\\\\') {
        flushText();
        let after = i + 2;
        if (text[after] === '*') after++;
        if (text[after] === '[') {
          const brk = readBalancedBrackets(text, after);
          if (brk) after = brk.endIdx + 1;
        }
        while (after < text.length && (text[after] === ' ' || text[after] === '\t')) {
          after++;
        }
        if (after < text.trimEnd().length) {
          textBuffer += '\n';
        }
        i = after;
        continue;
      }

      const nlMatch = rest.match(/^\\newline(?![a-zA-Z])\s*/);
      if (nlMatch) {
        textBuffer += '\n';
        i += nlMatch[0].length;
        continue;
      }

      // Record \label{...} if it appears inline (e.g. inside heading or caption)
      const labelMatch = rest.match(/^\\label\s*\{([^}]+)\}\s*/);
      if (labelMatch) {
        if (ctx && ctx.lastNumberedTarget) {
          const key = labelMatch[1].trim();
          ctx.labels[key] = ctx.lastNumberedTarget;
          if (ctx.lastNumberedKind) ctx.labelKinds[key] = ctx.lastNumberedKind;
        }
        i += labelMatch[0].length;
        continue;
      }

      // Handle \hfill, \dotfill, \hrulefill as explicit tab stop markers (coalescing repeats into tab_weight)
      const fillMatch = rest.match(/^\\(hfill|dotfill|hrulefill)(?![a-zA-Z])[ \t]*/);
      if (fillMatch) {
        flushText();
        const kind = fillMatch[1];
        const leader: 'none' | 'dot' | 'underscore' =
          kind === 'dotfill' ? 'dot' : kind === 'hrulefill' ? 'underscore' : 'none';
        let repeatCount = 1;
        let scanPos = i + fillMatch[0].length;
        while (scanPos < text.length) {
          const nextM = text.slice(scanPos).match(/^\\(hfill|dotfill|hrulefill)(?![a-zA-Z])[ \t]*/);
          if (!nextM) break;
          repeatCount++;
          scanPos += nextM[0].length;
        }
        out.push({
          type: 'text',
          content: '',
          tab_before: true,
          tab_leader: leader,
          ...(repeatCount > 1 ? { tab_weight: repeatCount } : {}),
        });
        i = scanPos;
        continue;
      }

      // Preserve explicit horizontal spacing \hspace*{len} / \hspace{len} instead of dropping it
      const hspaceMatch = rest.match(/^\\hspace\*?\s*\{([^}]+)\}[ \t]*/);
      if (hspaceMatch) {
        const pt = parseLatexLengthToPt(
          hspaceMatch[1],
          ctx?.pageConfig.contentWidthPt ?? 487.3,
          currentStyle.font_size_pt ?? 12
        );
        if (pt !== null && pt >= 6) {
          flushText();
          out.push({
            type: 'text',
            content: '',
            tab_before: true,
            tab_leader: 'none',
            tab_width_pt: Math.round(pt * 10) / 10,
          });
        } else if (pt !== null && pt >= 2) {
          textBuffer += ' ';
        }
        i += hspaceMatch[0].length;
        continue;
      }

      // Ignore benign layout/spacing macros in inline text
      const noopMatch = rest.match(
        /^\\(?:noindent|indent|centering|raggedright|raggedleft|vspace\*?\{[^}]*\}|addvspace\{[^}]*\}|phantom\*?\{[^}]*\}|hphantom\{[^}]*\}|vphantom\{[^}]*\}|fontsize\{[^}]*\}\{[^}]*\}|vfill|smallskip|medskip|bigskip|par(?![a-zA-Z])|index\{[^}]*\}|phantomsection|protect|relax|ignorespaces|strut|leavevmode|null)\s*/
      );
      if (noopMatch) {
        i += noopMatch[0].length;
        continue;
      }
    }

    textBuffer += text[i];
    i++;
  }

  flushText();
  return out;
}

function applyQuestionLabelBold(segments: InlineSegment[]): InlineSegment[] {
  if (segments.length === 0) return segments;
  const first = segments[0];
  if (first.type !== 'text' || first.bold) return segments;

  const match = first.content.match(
    /^(\s*(?:Câu|Bài|Ví dụ|Phần|Mục|Định lý|Bổ đề|Định nghĩa|Hệ quả)\s+\d+[\.:]?|\s*(?:Lời giải|Hướng dẫn giải|Giải|Chứng minh|Đáp án|Chú ý|Nhận xét)[\.:]?)\s+([\s\S]*)$/i
  );
  if (!match) return segments;

  const labelPart = `${match[1]} `;
  const restPart = match[2];
  const updated: InlineSegment[] = [{ ...first, content: labelPart, bold: true }];
  if (restPart) {
    updated.push({ ...first, content: restPart });
  }
  return [...updated, ...segments.slice(1)];
}

function isPureBareLatexLine(trimmed: string): boolean {
  if (!trimmed || trimmed.includes('$')) return false;
  if (trimmed.includes('\\(') || trimmed.includes('\\[')) return false;
  if (/^(?:[A-D]\.|[a-d]\))(?:\s|$)/.test(trimmed)) return false;
  if (/#[1-9]/.test(trimmed)) return false;
  if (
    /\\(?:textbf|textit|emph|underline|textcolor|makebox|framebox|parbox|fbox|dotfill|hrulefill|noindent|centering|label|ref|eqref|cite|footnote|includegraphics|url|href|verb|section|subsection|paragraph|count\d*|loop|ifnum|advance|repeat|newcount|par|hfill|vfill)(?![a-zA-Z])/.test(
      trimmed
    )
  ) {
    return false;
  }
  if (/^\\begin\{/.test(trimmed)) return true;

  const hasVietnameseWords =
    /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(
      trimmed
    );
  if (hasVietnameseWords) return false;

  if (
    /^\\(?:frac|dfrac|tfrac|cfrac|sqrt|int|iint|sum|prod|lim|limsup|liminf|displaystyle|textstyle|underset|overset|max|min|sup|inf|left|vec|overrightarrow|widehat|overline)(?![a-zA-Z])/.test(
      trimmed
    )
  ) {
    return true;
  }
  const hasMathStructure =
    BARE_LATEX_CMD_RE.test(trimmed) || /[=<>≤≥≠]|[\^_]\{?[\w+-]+\}?/.test(trimmed);
  const words = trimmed
    .replace(/\\[a-zA-Z]+(?:\[[^\]]*\])?/g, '')
    .match(/[a-zA-Z]{4,}/g) ?? [];
  return hasMathStructure && words.length === 0;
}

function unwrapInlineBoxesForChoiceCheck(line: string): string {
  let out = line;
  let safety = 0;
  const boxRe = /\\(?:makebox|framebox|parbox|fbox|mbox)\*?(?:\s*\[[^\]]*\])*(?:\s*\{[^}]*\}(?=\s*\{))?\s*\{/;
  let m: RegExpExecArray | null;
  while ((m = boxRe.exec(out)) !== null && safety < 40) {
    safety++;
    const br = readBalancedBraces(out, m.index + m[0].length - 1);
    if (!br) break;
    out = `${out.slice(0, m.index)} ${br.content} ${out.slice(br.endIdx + 1)}`;
  }
  out = out
    .replace(/\\textbf\s*\{\s*([A-D]\.|[a-d]\))\s*\}/g, '$1')
    .replace(/\\textbf\s*\{\s*([A-D]|[a-d])\s*\}\s*([.\)])/g, '$1$2')
    .replace(/\{\s*\\(?:bf|bfseries)\s+([A-D]\.|[a-d]\))\s*\}/g, '$1')
    .replace(/\\(?:qquad|quad|hfill|enspace|hspace\*?\{[^}]*\})/g, ' ')
    .replace(/\\\\\*?(?:\s*\[[^\]]*\])?\s*$/, '');
  return out.trim();
}

function splitTopLevelDoubleBackslash(src: string): string[] {
  const parts: string[] = [];
  let current = '';
  let braceDepth = 0;
  let inSingleDollar = false;
  let inDoubleDollar = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') {
      if (src[i + 1] === '\\' && braceDepth === 0 && !inSingleDollar && !inDoubleDollar) {
        parts.push(current);
        current = '';
        i += 2;
        if (src[i] === '*') i++;
        if (src[i] === '[') {
          const brk = readBalancedBrackets(src, i);
          if (brk) i = brk.endIdx + 1;
        }
        i--; // compensate loop i++
        continue;
      }
      if (i + 1 < src.length) {
        current += ch + src[i + 1];
        i++;
        continue;
      }
    }
    if (ch === '$') {
      if (src[i + 1] === '$' && !inSingleDollar) {
        inDoubleDollar = !inDoubleDollar;
        current += '$$';
        i++;
        continue;
      }
      if (!inDoubleDollar) {
        inSingleDollar = !inSingleDollar;
      }
    } else if (!inSingleDollar && !inDoubleDollar) {
      if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

function tryParseInlineChoiceRow(
  line: string,
  mode: LatexPasteMode,
  ctx?: ParserContext
): DocumentBlock | null {
  const normalizedLine = unwrapInlineBoxesForChoiceCheck(line);
  const matches: Array<{ index: number; markerStart: number; label: string }> = [];

  let inSingleDollar = false;
  let inDoubleDollar = false;
  let braceDepth = 0;
  for (let i = 0; i < normalizedLine.length; i++) {
    const ch = normalizedLine[i];
    if (ch === '\\' && i + 1 < normalizedLine.length) {
      i++;
      continue;
    }
    if (ch === '$') {
      if (normalizedLine[i + 1] === '$' && !inSingleDollar) {
        inDoubleDollar = !inDoubleDollar;
        i++;
        continue;
      }
      if (!inDoubleDollar) {
        inSingleDollar = !inSingleDollar;
        continue;
      }
    }
    if (!inSingleDollar && !inDoubleDollar) {
      if (ch === '{') {
        braceDepth++;
        continue;
      }
      if (ch === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
        continue;
      }
      if (braceDepth === 0) {
        const atBoundary = i === 0 || /\s/.test(normalizedLine[i - 1]);
        if (atBoundary) {
          const m = normalizedLine.slice(i).match(/^([A-D]\.|[a-d]\))(?:\s+|(?=\$|\\[\(\[]))/);
          if (m) {
            matches.push({
              index: i + m[0].length,
              markerStart: i,
              label: m[1],
            });
            i += m[0].length - 1;
          }
        }
      }
    }
  }

  if (matches.length < 2) return null;
  if (matches[0].markerStart > 4) return null;

  // Verify sequential choice labels (e.g. A,B,C,D or A,B or C,D or a,b,c,d)
  const seqUpper = matches.map((item) => item.label[0].toUpperCase()).join('');
  if (
    seqUpper !== 'ABCD' &&
    seqUpper !== 'ABC' &&
    seqUpper !== 'AB' &&
    seqUpper !== 'CD'
  ) {
    return null;
  }

  const rowCells: TableCellData[] = [];
  const pct = Math.round((100 / matches.length) * 10) / 10;
  for (let idx = 0; idx < matches.length; idx++) {
    const start = matches[idx].markerStart;
    const end = idx + 1 < matches.length ? matches[idx + 1].markerStart : normalizedLine.length;
    const cellText = normalizedLine.slice(start, end).trim();
    const labelMatch = cellText.match(/^([A-D]\.|[a-d]\))\s*([\s\S]*)$/);
    const segs: InlineSegment[] = labelMatch
      ? [
          { type: 'text', content: `${labelMatch[1]} `, bold: true },
          ...parseInlineSegmentText(labelMatch[2], {}, mode, ctx),
        ]
      : parseInlineSegmentText(cellText, {}, mode, ctx);
    rowCells.push({
      segments: segs,
      alignment: 'left',
      width_pct: pct,
    });
  }

  return {
    block_type: 'table',
    alignment: 'left',
    table_borderless: true,
    is_choice_block: true,
    font_size_pt: 12,
    line_spacing: 1.15,
    table_rows: [rowCells],
  };
}

function splitUnescaped(src: string, delimiter: string): string[] {
  const parts: string[] = [];
  let current = '';
  let braceDepth = 0;
  let inMath = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length) {
      if (src.slice(i, i + delimiter.length) === delimiter && braceDepth === 0 && !inMath) {
        parts.push(current);
        current = '';
        i += delimiter.length - 1;
        continue;
      }
      current += ch + src[i + 1];
      i++;
      continue;
    }
    if (ch === '$' && !(i > 0 && src[i - 1] === '\\')) {
      inMath = !inMath;
    } else if (ch === '{') {
      braceDepth++;
    } else if (ch === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
    }

    if (
      braceDepth === 0 &&
      !inMath &&
      src.slice(i, i + delimiter.length) === delimiter
    ) {
      parts.push(current);
      current = '';
      i += delimiter.length - 1;
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

function expandColumnSpec(colSpecRaw: string): string {
  // Expand *{n}{spec}
  let s = colSpecRaw;
  let safety = 0;
  const starRe = /\*\s*\{(\d+)\}\s*\{/;
  let m: RegExpExecArray | null;
  while ((m = starRe.exec(s)) !== null && safety < 50) {
    safety++;
    const count = Math.max(1, Math.min(30, parseInt(m[1], 10) || 1));
    const br = readBalancedBraces(s, m.index + m[0].length - 1);
    if (!br) break;
    s = s.slice(0, m.index) + br.content.repeat(count) + s.slice(br.endIdx + 1);
  }
  return s;
}

function unwrapMultirowCell(cellStr: string): string {
  const mrRe = /\\multirow\s*(?:\[[^\]]*\])?\s*\{[^}]*\}\s*(?:\[[^\]]*\])?\s*\{/;
  const m = mrRe.exec(cellStr);
  if (!m) return cellStr;
  const widthBr = readBalancedBraces(cellStr, m.index + m[0].length - 1);
  if (!widthBr) return cellStr;
  const afterWidth = skipSpaces(cellStr, widthBr.endIdx + 1);
  if (cellStr[afterWidth] !== '{') return cellStr;
  const contentBr = readBalancedBraces(cellStr, afterWidth);
  if (!contentBr) return cellStr;
  return cellStr.slice(0, m.index) + contentBr.content + cellStr.slice(contentBr.endIdx + 1);
}

function parseTabularEnvironment(
  colSpecRaw: string,
  bodyRaw: string,
  mode: LatexPasteMode,
  ctx?: ParserContext,
  containerWidthPt?: number,
  tableScope?: {
    alignment?: BlockAlignment;
    fontSizePt?: number;
    bold?: boolean;
    italic?: boolean;
    color?: string;
  }
): DocumentBlock | null {
  const expandedSpec = expandColumnSpec(colSpecRaw);
  const availWidthPt = containerWidthPt ?? ctx?.pageConfig.contentWidthPt ?? 487.3;
  const baseFontPt = tableScope?.fontSizePt ?? ctx?.pageConfig.baseFontSizePt ?? 12;

  interface ColSpecInfo {
    align: BlockAlignment;
    widthPt: number | null;
    bold?: boolean;
    italic?: boolean;
  }
  const colsInfo: ColSpecInfo[] = [];
  const colBorders: boolean[] = [false];
  let pendingModAlign: BlockAlignment | null = null;
  let pendingModBold = false;
  let pendingModItalic = false;

  for (let i = 0; i < expandedSpec.length; i++) {
    const ch = expandedSpec[i];
    if (ch === '|') {
      colBorders[colBorders.length - 1] = true;
      continue;
    }
    if (ch === '>' && expandedSpec[i + 1] === '{') {
      const br = readBalancedBraces(expandedSpec, i + 1);
      if (br) {
        if (/\\centering\b/.test(br.content)) pendingModAlign = 'center';
        else if (/\\raggedleft\b/.test(br.content)) pendingModAlign = 'right';
        else if (/\\raggedright\b/.test(br.content)) pendingModAlign = 'left';
        if (/\\(?:bfseries|bf)\b/.test(br.content)) pendingModBold = true;
        if (/\\(?:itshape|it|em)\b/.test(br.content)) pendingModItalic = true;
        i = br.endIdx;
        continue;
      }
    }
    if (ch === '<' || ch === '@' || ch === '!') {
      if (expandedSpec[i + 1] === '{') {
        const br = readBalancedBraces(expandedSpec, i + 1);
        if (br) i = br.endIdx;
      }
      continue;
    }
    if (ch === 'l' || ch === 'c' || ch === 'r' || ch === 'S' || ch === 'p' || ch === 'm' || ch === 'b' || ch === 'X') {
      let widthPt: number | null = null;
      if ((ch === 'p' || ch === 'm' || ch === 'b') && expandedSpec[i + 1] === '{') {
        const br = readBalancedBraces(expandedSpec, i + 1);
        if (br) {
          widthPt = parseLatexLengthToPt(br.content, availWidthPt, baseFontPt);
          i = br.endIdx;
        }
      }
      const align: BlockAlignment =
        pendingModAlign ?? (ch === 'c' ? 'center' : ch === 'r' || ch === 'S' ? 'right' : 'left');
      colsInfo.push({
        align,
        widthPt,
        bold: pendingModBold || undefined,
        italic: pendingModItalic || undefined,
      });
      colBorders.push(false);
      pendingModAlign = null;
      pendingModBold = false;
      pendingModItalic = false;
    }
  }

  const hasVertBorders = colBorders.some(Boolean);
  const hasBooktabs = /\\(?:toprule|midrule|bottomrule|cmidrule)\b/.test(bodyRaw);
  const hasHline = hasBooktabs || /\\(?:hline|cline|Xhline|Xcline|specialrule)\b/.test(bodyRaw);
  const hasMidrule = /\\midrule\b/.test(bodyRaw);

  let cleanedBody = bodyRaw
    .replace(/\\(?:endfirsthead|endhead|endfoot|endlastfoot)(?![a-zA-Z])/g, '')
    .replace(/\\addlinespace(?:\[[^\]]*\])?/g, '')
    .replace(/\\specialrule\{[^}]*\}\{[^}]*\}\{[^}]*\}/g, '');
  cleanedBody = stripBalancedCommand(cleanedBody, /\\caption\*?(?![a-zA-Z])/, 1, true);

  const rawRows = splitUnescaped(cleanedBody, '\\\\');
  const tableRows: TableCellData[][] = [];
  const rowHadRuleAbove: boolean[] = [];
  const rowHadRuleBelow: boolean[] = [];
  const rowRuleColsBelow: Array<Array<[number, number]> | null> = [];

  const extractRuleInfo = (segment: string): { hasFullRule: boolean; clines: Array<[number, number]> } => {
    const hasFullRule = /\\(?:hline|toprule|midrule|bottomrule|Xhline)(?![a-zA-Z])/.test(segment);
    const clines: Array<[number, number]> = [];
    const clineRe = /\\(?:cline|Xcline|cmidrule)(?:\([^)]*\))?(?:\[[^\]]*\])?\s*\{(\d+)\s*-\s*(\d+)\}/g;
    let cm: RegExpExecArray | null;
    while ((cm = clineRe.exec(segment)) !== null) {
      const a = Math.max(0, parseInt(cm[1], 10) - 1);
      const b = Math.max(a, parseInt(cm[2], 10) - 1);
      clines.push([a, b]);
    }
    return { hasFullRule, clines };
  };

  let pendingRuleAboveNextRow = false;

  for (let rIdx = 0; rIdx < rawRows.length; rIdx++) {
    const rawRow = rawRows[rIdx].replace(/^\*?\s*\[[^\]]*\]\s*/, '');
    const rowColorM = rawRow.match(/\\rowcolor(?:\[[^\]]*\])?\{([^}]+)\}/);
    const rowFillHex = rowColorM ? resolveLatexColor(rowColorM[1], ctx?.customColors) : undefined;

    const { hasFullRule: startsWithFullRule, clines: startClines } = extractRuleInfo(rawRow);
    const cleanedRow = rawRow
      .replace(/\\(?:hline|toprule|midrule|bottomrule)(?![a-zA-Z])(?:\[[^\]]*\])?/g, '')
      .replace(/\\(?:Xhline|Xcline|cline)\{[^}]*\}/g, '')
      .replace(/\\cmidrule(?:\([^)]*\))?\{[^}]*\}/g, '')
      .replace(/\\rowcolor(?:\[[^\]]*\])?\{[^}]*\}/g, '')
      .trim();

    if (!cleanedRow) {
      if ((hasFullRuleOnly(rawRow) || startsWithFullRule || startClines.length > 0) && tableRows.length > 0) {
        if (startsWithFullRule) rowHadRuleBelow[rowHadRuleBelow.length - 1] = true;
        if (startClines.length > 0) rowRuleColsBelow[rowRuleColsBelow.length - 1] = startClines;
      } else if (startsWithFullRule) {
        pendingRuleAboveNextRow = true;
      }
      continue;
    }

    const nextRow = (rawRows[rIdx + 1] ?? '').replace(/^\*?\s*\[[^\]]*\]\s*/, '');
    const nextRuleInfo = extractRuleInfo(nextRow);

    const rawCells = splitUnescaped(cleanedRow, '&');
    const rowCells: TableCellData[] = [];
    let colIdx = 0;

    for (const rawCell of rawCells) {
      const cellColorM = rawCell.match(/\\cellcolor(?:\[[^\]]*\])?\{([^}]+)\}/);
      const cellFillHex = cellColorM
        ? resolveLatexColor(cellColorM[1], ctx?.customColors)
        : rowFillHex;

      let cellTrimmed = rawCell
        .replace(/\\cellcolor(?:\[[^\]]*\])?\{[^}]*\}/g, '')
        .trim();
      cellTrimmed = unwrapMultirowCell(cellTrimmed).trim();

      const mcMatch = cellTrimmed.match(/^\\multicolumn\s*\{(\d+)\}\s*\{([^}]*)\}\s*\{/);
      if (mcMatch) {
        const span = Math.max(1, parseInt(mcMatch[1], 10) || 1);
        const mcSpec = mcMatch[2];
        const mcAlign: BlockAlignment = mcSpec.includes('r')
          ? 'right'
          : mcSpec.includes('c')
          ? 'center'
          : 'left';
        const br = readBalancedBraces(cellTrimmed, mcMatch[0].length - 1);
        const content = br ? unwrapMultirowCell(br.content).trim() : cellTrimmed;
        const cInfo = colsInfo[colIdx];
        rowCells.push({
          segments: parseInlineSegmentText(
            content,
            {
              ...(cInfo?.bold || tableScope?.bold ? { bold: true } : {}),
              ...(cInfo?.italic || tableScope?.italic ? { italic: true } : {}),
              ...(tableScope?.color ? { color: tableScope.color } : {}),
            },
            mode,
            ctx
          ),
          alignment: mcAlign,
          col_span: span,
          is_header: false,
          ...(cellFillHex ? { fill_color: cellFillHex } : {}),
        });
        colIdx += span;
      } else {
        const cInfo = colsInfo[colIdx];
        const align = cInfo?.align ?? 'left';
        rowCells.push({
          segments: parseInlineSegmentText(
            cellTrimmed,
            {
              ...(cInfo?.bold || tableScope?.bold ? { bold: true } : {}),
              ...(cInfo?.italic || tableScope?.italic ? { italic: true } : {}),
              ...(tableScope?.color ? { color: tableScope.color } : {}),
            },
            mode,
            ctx
          ),
          alignment: align,
          is_header: false,
          ...(cellFillHex ? { fill_color: cellFillHex } : {}),
        });
        colIdx++;
      }
    }

    if (rowCells.length > 0) {
      const hasTopHere = startsWithFullRule || pendingRuleAboveNextRow;
      pendingRuleAboveNextRow = false;
      const hasBotHere = nextRuleInfo.hasFullRule;
      tableRows.push(rowCells);
      rowHadRuleAbove.push(hasTopHere);
      rowHadRuleBelow.push(hasBotHere);
      rowRuleColsBelow.push(nextRuleInfo.clines.length > 0 ? nextRuleInfo.clines : null);
    }
  }

  function hasFullRuleOnly(s: string): boolean {
    return /\\(?:hline|toprule|midrule|bottomrule|Xhline)(?![a-zA-Z])/.test(s);
  }

  if (tableRows.length === 0) return null;

  const maxCols = Math.max(...tableRows.map((r) => r.reduce((a, c) => a + (c.col_span ?? 1), 0)), 1);

  // Assign width_pct if any column had explicit p{...}/m{...}/b{...} widths
  if (colsInfo.some((c) => c.widthPt !== null && c.widthPt > 0)) {
    const knownPt = colsInfo.reduce((s, c) => s + (c.widthPt ?? 0), 0);
    const unknownCount = colsInfo.filter((c) => c.widthPt === null).length;
    const remPt = Math.max(unknownCount * 42, availWidthPt - knownPt);
    const fallbackW = unknownCount > 0 ? remPt / unknownCount : 0;
    const rawWidths = Array.from({ length: maxCols }, (_, idx) => colsInfo[idx]?.widthPt ?? (fallbackW || 60));
    const totalW = Math.max(1, rawWidths.reduce((a, b) => a + b, 0));
    const pcts = rawWidths.map((w) => Math.round((w / totalW) * 1000) / 10);

    for (const row of tableRows) {
      let cCursor = 0;
      for (const cell of row) {
        const span = cell.col_span ?? 1;
        if (span === 1 && pcts[cCursor] > 0) {
          cell.width_pct = pcts[cCursor];
        }
        cCursor += span;
      }
    }
  }

  const tableStyle: DocumentBlock['table_style'] =
    !hasVertBorders && !hasHline
      ? 'borderless'
      : hasBooktabs && !hasVertBorders
      ? 'booktabs'
      : !hasVertBorders && hasHline
      ? 'booktabs'
      : 'grid';

  // Apply per-cell rule flags (critical for booktabs \toprule / \midrule / \bottomrule / \cline)
  tableRows.forEach((row, rIdx) => {
    const topRule = rowHadRuleAbove[rIdx] || (rIdx === 0 && tableStyle !== 'borderless');
    const botRule = rowHadRuleBelow[rIdx] || (rIdx === tableRows.length - 1 && tableStyle !== 'borderless');
    const clines = rowRuleColsBelow[rIdx];
    let cCursor = 0;
    row.forEach((cell) => {
      const span = cell.col_span ?? 1;
      if (topRule) cell.border_top = true;
      if (botRule) cell.border_bottom = true;
      if (clines) {
        const hitsCline = clines.some(([a, b]) => cCursor <= b && cCursor + span - 1 >= a);
        if (hitsCline) cell.border_bottom = true;
      }
      cCursor += span;
    });
  });

  if (tableRows.length > 1 && (hasMidrule || rowHadRuleBelow[0])) {
    tableRows[0] = tableRows[0].map((c) => ({ ...c, is_header: true }));
  }

  return {
    block_type: 'table',
    alignment: tableScope?.alignment ?? 'left',
    table_borderless: tableStyle === 'borderless',
    table_style: tableStyle,
    ...(colBorders.length === maxCols + 1 ? { table_col_borders: colBorders } : {}),
    font_size_pt: baseFontPt,
    line_spacing: 1.15,
    table_rows: tableRows,
  };
}

function splitListItems(body: string): Array<{ customLabel?: string; content: string }> {
  const items: Array<{ customLabel?: string; content: string }> = [];
  let currentStart = -1;
  let currentLabel: string | undefined;
  let envDepth = 0;
  let i = 0;

  while (i < body.length) {
    if (body[i] === '\\') {
      const rest = body.slice(i);
      const beginM = rest.match(/^\\begin\{([^}]+)\}/);
      if (beginM) {
        envDepth++;
        i += beginM[0].length;
        continue;
      }
      const endM = rest.match(/^\\end\{([^}]+)\}/);
      if (endM) {
        envDepth = Math.max(0, envDepth - 1);
        i += endM[0].length;
        continue;
      }
      if (envDepth === 0) {
        const itemM = rest.match(/^\\item(?:ch)?(?![a-zA-Z])/);
        if (itemM) {
          if (currentStart !== -1) {
            items.push({
              customLabel: currentLabel,
              content: body.slice(currentStart, i).trim(),
            });
          }
          let afterItem = skipSpaces(body, i + itemM[0].length);
          let lbl: string | undefined;
          if (body[afterItem] === '[') {
            const brk = readBalancedBrackets(body, afterItem);
            if (brk) {
              lbl = brk.content.trim();
              afterItem = skipSpaces(body, brk.endIdx + 1);
            }
          }
          currentLabel = lbl;
          currentStart = afterItem;
          i = afterItem;
          continue;
        }
      }
    }
    i++;
  }

  if (currentStart !== -1) {
    items.push({
      customLabel: currentLabel,
      content: body.slice(currentStart).trim(),
    });
  }
  return items;
}

function stripLeadingInlineCommands(line: string): string {
  let s = line.trim();
  let prev = '';
  let guard = 0;
  while (s !== prev && guard < 10) {
    prev = s;
    guard++;
    const styleCmdM = s.match(
      /^\\(?:textbf|textit|emph|underline|text|mbox|hbox|fbox|boxed|centerline|leftline|rightline|makebox|framebox)\*?(?:\s*\[[^\]]*\])*\s*\{/
    );
    if (styleCmdM) {
      const br = readBalancedBraces(s, styleCmdM[0].length - 1);
      if (br) {
        const restAfter = s.slice(br.endIdx + 1);
        const sep = !restAfter || /^[\s.,;:!?)]/.test(restAfter) ? '' : ' ';
        s = `${br.content}${sep}${restAfter}`.trim();
        continue;
      }
    }
    const tcM = s.match(/^\\(?:textcolor|colorbox)(?:\s*\[[^\]]*\])?\s*\{[^}]*\}\s*\{/);
    if (tcM) {
      const br = readBalancedBraces(s, tcM[0].length - 1);
      if (br) {
        const restAfter = s.slice(br.endIdx + 1);
        const sep = !restAfter || /^[\s.,;:!?)]/.test(restAfter) ? '' : ' ';
        s = `${br.content}${sep}${restAfter}`.trim();
        continue;
      }
    }
    const fcM = s.match(/^\\fcolorbox(?:\s*\[[^\]]*\])?\s*\{[^}]*\}(?:\s*\[[^\]]*\])?\s*\{[^}]*\}\s*\{/);
    if (fcM) {
      const br = readBalancedBraces(s, fcM[0].length - 1);
      if (br) {
        const restAfter = s.slice(br.endIdx + 1);
        const sep = !restAfter || /^[\s.,;:!?)]/.test(restAfter) ? '' : ' ';
        s = `${br.content}${sep}${restAfter}`.trim();
        continue;
      }
    }
    s = s
      .replace(/^\\(?:noindent|indent|centering|raggedright|raggedleft|par|normalcolor|normalfont|mdseries|upshape|qquad|quad|enspace)(?![a-zA-Z])\s*/, '')
      .replace(/^\\(?:hspace\*?\{[^}]*\}|color(?:\s*\[[^\]]*\])?\s*\{[^}]*\})\s*/, '')
      .replace(/^\\(?:tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge)(?![a-zA-Z])\s*/, '')
      .replace(/^\{\s*\\(?:bf|bfseries|it|itshape|em|large|Large|LARGE|normalsize|color(?:\[[^\]]*\])?\{[^}]*\})\b\s*/, '')
      .replace(/^~\s*/, '')
      .trim();
  }
  return s;
}

function unwrapOuterLayoutBox(line: string): string {
  let s = line.trim().replace(/\\\\\*?(?:\s*\[[^\]]*\])?\s*$/, '').trim();
  s = s.replace(/\\(?:qquad|quad|hfill|enspace|hspace\*?\{[^}]*\}|par(?![a-zA-Z]))\s*$/, '').trim();
  let guard = 0;
  while (guard < 6) {
    guard++;
    const m = s.match(/^\\(?:makebox|framebox|parbox|fbox|mbox|hbox)\*?(?:\s*\[[^\]]*\])*(?:\s*\{[^}]*\}(?=\s*\{))?\s*\{/);
    if (!m) break;
    const br = readBalancedBraces(s, m[0].length - 1);
    if (!br) break;
    if (s.slice(br.endIdx + 1).trim()) break;
    s = br.content.trim();
  }
  return s;
}

function isLineBreakBoundary(prevLine: string, nextLine: string): boolean {
  if (!prevLine || !nextLine) return true;
  if (/\\\\(?:\[[^\]]*\])?\s*$/.test(prevLine) || /\\(?:newline|par)(?![a-zA-Z])\s*$/.test(prevLine)) {
    return true;
  }
  if (
    /^\\(?:section|subsection|subsubsection|paragraph|subparagraph|chapter|part|item|bibitem|begin|end|hline|hrule|newpage|clearpage|cleardoublepage|pagebreak|maketitle|appendix|tableofcontents|listoffigures|listoftables|caption|includegraphics|makebox|framebox|parbox|centerline|leftline|rightline|vspace|smallskip|medskip|bigskip|par(?![a-zA-Z])|Large|LARGE|large|huge|Huge|bfseries|color(?![a-zA-Z]))/.test(
      nextLine
    )
  ) {
    return true;
  }
  if (
    /^\\(?:section|subsection|subsubsection|paragraph|subparagraph|chapter|part|hline|hrule|maketitle|appendix|caption|includegraphics)/.test(
      prevLine
    )
  ) {
    return true;
  }
  if (/^(?:---|\$\$|\\\[)/.test(nextLine) || /(?:\$\$|\\\])$/.test(prevLine)) return true;

  const cleanNext = stripLeadingInlineCommands(nextLine);
  const cleanPrev = stripLeadingInlineCommands(prevLine);
  if (
    /^(?:Câu|Bài|Ví dụ|Phần|Mục|Bước|Kết luận|Lời giải|Hướng dẫn giải|Đáp án|Chứng minh)\b/i.test(
      cleanNext
    ) ||
    /^(?:[IVX]+\.\s+(?:PHẦN|TRẮC NGHIỆM|TỰ LUẬN|BẢNG|LỜI GIẢI)|[0-9]+\.\s+(?:BẢNG|LỜI GIẢI|HƯỚNG DẪN|ĐÁP ÁN)|[IVX]+\.\s+[A-ZÀ-Ỹ]{2,})/i.test(
      cleanNext
    )
  ) {
    return true;
  }
  if (
    /^(?:\\textbf|\\centerline|\{\s*\\bf)/.test(prevLine) &&
    /^(?:[IVX]+\.\s+|[0-9]+\.\s+(?:BẢNG|LỜI GIẢI|HƯỚNG DẪN|ĐÁP ÁN)|PHẦN\b|HƯỚNG DẪN)/i.test(
      cleanPrev
    )
  ) {
    return true;
  }
  if (/^([A-D]\.|[a-d]\))(?:\s+|(?=\$|\\[\(\[]))/.test(cleanNext)) return true;
  if (isPureBareLatexLine(nextLine) || isPureBareLatexLine(prevLine)) return true;
  return false;
}

function hasUnclosedDelimiter(src: string): boolean {
  let inSingleDollar = false;
  let inDoubleDollar = false;
  let inParen = false;
  let inBracket = false;
  let braceDepth = 0;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') {
      const next = src[i + 1];
      if (!inSingleDollar && !inDoubleDollar && !inParen && !inBracket) {
        if (next === '(') {
          inParen = true;
          i++;
          continue;
        }
        if (next === '[') {
          inBracket = true;
          i++;
          continue;
        }
      } else if (inParen && next === ')') {
        inParen = false;
        i++;
        continue;
      } else if (inBracket && next === ']') {
        inBracket = false;
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (ch === '$' && !inParen && !inBracket) {
      if (src[i + 1] === '$' && !inSingleDollar) {
        inDoubleDollar = !inDoubleDollar;
        i++;
        continue;
      }
      if (!inDoubleDollar) {
        inSingleDollar = !inSingleDollar;
      }
    } else if (!inSingleDollar && !inDoubleDollar && !inParen && !inBracket) {
      if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
    }
  }

  return inSingleDollar || inDoubleDollar || inParen || inBracket || braceDepth > 0;
}

function isHardStructuralQuestionOrSectionStart(line: string): boolean {
  const clean = stripLeadingInlineCommands(line);
  return (
    /^\\(?:section|subsection|subsubsection|chapter|part|begin\{(?:ex|bt|vd|theorem|lemma|definition|proposition|corollary|proof|figure|table|enumerate|itemize|itemchoice)\})/.test(
      line
    ) || /^(?:Câu|Bài)\s+\d+/i.test(clean)
  );
}

function mergeWrappedProseLines(text: string, isFullLatexDoc: boolean): string[] {
  const rawLines = text.split('\n');
  const paragraphs: string[] = [];
  let buffer = '';

  const flush = () => {
    if (buffer.trim()) {
      paragraphs.push(buffer.trim());
    }
    buffer = '';
  };

  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) {
      if (buffer && hasUnclosedDelimiter(buffer)) {
        buffer = `${buffer} `;
      } else {
        flush();
      }
      continue;
    }

    if (!buffer) {
      buffer = line;
      continue;
    }

    if (hasUnclosedDelimiter(buffer)) {
      if (isHardStructuralQuestionOrSectionStart(line)) {
        flush();
        buffer = line;
      } else {
        buffer = `${buffer} ${line}`;
      }
      continue;
    }

    if (isLineBreakBoundary(buffer, line)) {
      flush();
      buffer = line;
      continue;
    }

    // In full LaTeX documents, single newlines inside prose ALWAYS merge into a single justified paragraph
    if (isFullLatexDoc || buffer.length >= 48) {
      buffer = `${buffer} ${line}`;
    } else {
      // Short standalone plain-text lines (e.g., exam headers "SỞ GD&ĐT", "TRƯỜNG THPT") stay separate
      flush();
      buffer = line;
    }
  }

  flush();
  return paragraphs;
}

function findMatchingEnvEnd(src: string, envName: string, searchFrom: number): number {
  const openToken = `\\begin{${envName}}`;
  const closeToken = `\\end{${envName}}`;
  let depth = 1;
  let i = searchFrom;

  while (i < src.length) {
    if (src[i] === '\\') {
      if (src.startsWith(openToken, i)) {
        depth++;
        i += openToken.length;
        continue;
      }
      if (src.startsWith(closeToken, i)) {
        depth--;
        if (depth === 0) {
          return i;
        }
        i += closeToken.length;
        continue;
      }
    }
    i++;
  }
  return -1;
}

function extractBalancedMacroArgs(src: string, startIdx: number, count: number): {
  args: string[];
  endIdx: number;
} | null {
  const args: string[] = [];
  let pos = startIdx;
  for (let k = 0; k < count; k++) {
    pos = skipSpaces(src, pos);
    if (src[pos] !== '{') return null;
    const br = readBalancedBraces(src, pos);
    if (!br) return null;
    args.push(br.content);
    pos = br.endIdx + 1;
  }
  return { args, endIdx: pos };
}

function parseExEnvironment(
  body: string,
  envKind: 'ex' | 'bt' | 'vd',
  ctx: ParserContext,
  mode: LatexPasteMode,
  parentOpts?: BlockParseOptions
): DocumentBlock[] {
  const blocks: DocumentBlock[] = [];
  const baseFontPt = parentOpts?.baseFontSizePt ?? ctx.pageConfig.baseFontSizePt ?? 12;
  const lineSp = parentOpts?.defaultLineSpacing ?? ctx.pageConfig.defaultLineSpacing ?? 1.18;
  const containerW = parentOpts?.containerWidthPt ?? ctx.pageConfig.contentWidthPt;

  const labelPrefix =
    envKind === 'ex'
      ? `Câu ${nextCounter(ctx, 'ex')}. `
      : envKind === 'bt'
      ? `Bài ${nextCounter(ctx, 'bt')}. `
      : `Ví dụ ${nextCounter(ctx, 'vd')}. `;

  let remaining = body.trim();
  let loigiaiBody: string | null = null;
  let choiceBlock: DocumentBlock | null = null;
  let shortAnsBlock: DocumentBlock | null = null;

  // Extract \loigiai{...}
  const lgMatch = /\\loigiai\s*\{/.exec(remaining);
  if (lgMatch) {
    const br = readBalancedBraces(remaining, lgMatch.index + lgMatch[0].length - 1);
    if (br) {
      loigiaiBody = br.content.trim();
      remaining = (remaining.slice(0, lgMatch.index) + remaining.slice(br.endIdx + 1)).trim();
    }
  }

  // Extract \shortans[opts]{value}
  const saMatch = /\\shortans(?:\s*\[[^\]]*\])?\s*\{/.exec(remaining);
  if (saMatch) {
    const br = readBalancedBraces(remaining, saMatch.index + saMatch[0].length - 1);
    if (br) {
      const ansRaw = br.content.trim();
      remaining = (remaining.slice(0, saMatch.index) + remaining.slice(br.endIdx + 1)).trim();
      if (ansRaw) {
        shortAnsBlock = {
          block_type: 'paragraph',
          alignment: 'right',
          font_size_pt: baseFontPt,
          line_spacing: lineSp,
          segments: [
            { type: 'text', content: 'Đáp án: ', bold: true, color: '#B91C1C' },
            ...parseInlineSegmentText(ansRaw, { bold: true, color: '#B91C1C' }, mode, ctx),
          ],
        };
      }
    }
  }

  // Extract \choice[cols]{A}{B}{C}{D}, \choiceTF[cols]{A}{B}{C}{D}, \motcot{...}, \haicot{...}, \boncot{...}
  const chMatch = /\\(choice(?:TF)?|motcot|haicot|boncot)\s*(?:\[\s*([^\]]*)\s*\])?\s*\{/.exec(remaining);
  if (chMatch) {
    const cmdName = chMatch[1];
    const isTF = cmdName === 'choiceTF';
    const numericColOpt = chMatch[2] && /^\d+$/.test(chMatch[2].trim()) ? parseInt(chMatch[2].trim(), 10) : null;
    const extracted = extractBalancedMacroArgs(
      remaining,
      chMatch.index + chMatch[0].length - 1,
      4
    );
    if (extracted) {
      remaining = (
        remaining.slice(0, chMatch.index) + remaining.slice(extracted.endIdx)
      ).trim();
      const labels = isTF ? ['a)', 'b)', 'c)', 'd)'] : ['A.', 'B.', 'C.', 'D.'];
      const colHint = numericColOpt
        ? numericColOpt
        : isTF || cmdName === 'motcot'
        ? 1
        : cmdName === 'haicot'
        ? 2
        : 4;
      const explicitColOverride = Boolean(
        numericColOpt || cmdName === 'motcot' || cmdName === 'haicot' || cmdName === 'boncot' || isTF
      );
      const cells: TableCellData[] = extracted.args.map((arg, idx) => {
        const isCorrect = /\\True(?![a-zA-Z])/.test(arg);
        const cleanedArg = arg.replace(/\\True(?![a-zA-Z])\s*/g, '').trim();
        return {
          segments: [
            { type: 'text', content: `${labels[idx]} `, bold: true },
            ...parseInlineSegmentText(cleanedArg, {}, mode, ctx),
          ],
          alignment: 'left',
          width_pct: colHint === 1 ? 100 : colHint === 2 ? 50 : 25,
          ...(isCorrect ? { is_correct: true } : {}),
        };
      });
      const rows: TableCellData[][] =
        colHint === 1
          ? cells.map((c) => [c])
          : colHint === 2
          ? [cells.slice(0, 2), cells.slice(2, 4)]
          : [cells];
      choiceBlock = {
        block_type: 'table',
        alignment: 'left',
        table_borderless: true,
        is_choice_block: true,
        preserve_col_count: explicitColOverride,
        font_size_pt: baseFontPt,
        line_spacing: 1.15,
        table_rows: rows,
      };
    }
  }

  // Parse question stem
  const stemPages = parseBodyBlocks(remaining, ctx, mode, {
    defaultAlign: 'justify',
    isFullLatexDoc: true,
    listDepth: 0,
    indentLeftPt: parentOpts?.indentLeftPt ?? 0,
    containerWidthPt: containerW,
    baseFontSizePt: baseFontPt,
    defaultLineSpacing: lineSp,
    defaultColor: parentOpts?.defaultColor,
  });

  if (stemPages.length > 0 && stemPages[0].length > 0) {
    const firstBlk = stemPages[0][0];
    if (firstBlk.block_type === 'paragraph' && firstBlk.segments) {
      firstBlk.segments = [
        { type: 'text', content: labelPrefix, bold: true, ...(parentOpts?.defaultColor ? { color: parentOpts.defaultColor } : {}) },
        ...firstBlk.segments,
      ];
    } else if (
      firstBlk.block_type === 'table' &&
      firstBlk.table_rows?.[0]?.[0]?.blocks &&
      firstBlk.table_rows[0][0].blocks.length > 0
    ) {
      const innerFirst = firstBlk.table_rows[0][0].blocks[0];
      if (innerFirst.block_type === 'paragraph' && innerFirst.segments) {
        innerFirst.segments = [
          { type: 'text', content: labelPrefix, bold: true, ...(parentOpts?.defaultColor ? { color: parentOpts.defaultColor } : {}) },
          ...innerFirst.segments,
        ];
      } else {
        firstBlk.table_rows[0][0].blocks.unshift({
          block_type: 'paragraph',
          alignment: 'left',
          font_size_pt: baseFontPt,
          line_spacing: lineSp,
          segments: [{ type: 'text', content: labelPrefix.trim(), bold: true, ...(parentOpts?.defaultColor ? { color: parentOpts.defaultColor } : {}) }],
        });
      }
    } else {
      blocks.push({
        block_type: 'paragraph',
        alignment: 'left',
        font_size_pt: baseFontPt,
        line_spacing: lineSp,
        segments: [{ type: 'text', content: labelPrefix.trim(), bold: true, ...(parentOpts?.defaultColor ? { color: parentOpts.defaultColor } : {}) }],
      });
    }
    blocks.push(...stemPages.flat());
  } else {
    blocks.push({
      block_type: 'paragraph',
      alignment: 'left',
      font_size_pt: baseFontPt,
      line_spacing: lineSp,
      segments: [{ type: 'text', content: labelPrefix.trim(), bold: true, ...(parentOpts?.defaultColor ? { color: parentOpts.defaultColor } : {}) }],
    });
  }

  if (choiceBlock) blocks.push(choiceBlock);
  if (shortAnsBlock) blocks.push(shortAnsBlock);

  if (loigiaiBody) {
    const solPages = parseBodyBlocks(loigiaiBody, ctx, mode, {
      defaultAlign: 'justify',
      isFullLatexDoc: true,
      listDepth: 0,
      indentLeftPt: parentOpts?.indentLeftPt ?? 0,
      containerWidthPt: containerW,
      baseFontSizePt: baseFontPt,
      defaultLineSpacing: lineSp,
      defaultColor: parentOpts?.defaultColor,
    });
    const flatSol = solPages.flat();
    if (flatSol.length > 0) {
      const firstSol = flatSol[0];
      if (
        firstSol.block_type === 'paragraph' &&
        firstSol.segments &&
        !(firstSol.indent_left_pt && firstSol.indent_left_pt > 0) &&
        !(firstSol.first_line_indent_pt && firstSol.first_line_indent_pt < 0)
      ) {
        firstSol.segments = [
          { type: 'text', content: 'Lời giải. ', bold: true, italic: true },
          ...firstSol.segments,
        ];
      } else {
        flatSol.unshift({
          block_type: 'paragraph',
          alignment: 'left',
          font_size_pt: baseFontPt,
          line_spacing: lineSp,
          segments: [{ type: 'text', content: 'Lời giải.', bold: true, italic: true }],
        });
      }
    }
    blocks.push(...flatSol);
  }

  return blocks;
}

interface BlockParseOptions {
  defaultAlign: BlockAlignment;
  isFullLatexDoc: boolean;
  listDepth: number;
  indentLeftPt: number;
  containerWidthPt?: number;
  baseFontSizePt?: number;
  defaultLineSpacing?: number;
  defaultBold?: boolean;
  defaultItalic?: boolean;
  defaultColor?: string;
  meta?: { title?: string; author?: string; date?: string };
}

function isOnlySpacesBeforeOnLine(src: string, idx: number): boolean {
  let j = idx - 1;
  while (j >= 0 && src[j] !== '\n') {
    if (src[j] !== ' ' && src[j] !== '\t') return false;
    j--;
  }
  return true;
}

function isOnlySpacesAfterOnLine(src: string, idx: number): boolean {
  let j = idx;
  while (j < src.length && src[j] !== '\n') {
    if (src[j] !== ' ' && src[j] !== '\t') return false;
    j++;
  }
  return true;
}

function registerLabelsInMath(rawMath: string, envName: string, ctx: ParserContext): void {
  const isStarred = envName.endsWith('*') || envName === 'displaymath';
  const hasNonumber = /\\(?:nonumber|notag)(?![a-zA-Z])/.test(rawMath);
  const labelRe = /\\label\s*\{([^}]+)\}/g;
  const foundLabels: string[] = [];
  let lm: RegExpExecArray | null;
  while ((lm = labelRe.exec(rawMath)) !== null) {
    foundLabels.push(lm[1].trim());
  }

  if (!isStarred && !hasNonumber) {
    const eqNum = nextCounter(ctx, 'equation');
    const labelStr = String(eqNum);
    ctx.lastNumberedTarget = labelStr;
    ctx.lastNumberedKind = ctx.isVietnamese ? 'Phương trình' : 'Equation';
    for (const k of foundLabels) {
      ctx.labels[k] = labelStr;
      ctx.labelKinds[k] = ctx.lastNumberedKind;
    }
  }
}

function expandEnumPattern(
  enumLabelOpt: string | undefined,
  envName: string,
  nextDepth: number,
  itemIdx: number,
  customLabel: string | undefined
): string {
  if (customLabel !== undefined) {
    return `${customLabel} `;
  }
  if (envName === 'itemize') {
    return nextDepth > 1 ? '– ' : '• ';
  }
  if (envName === 'itemchoice' && !enumLabelOpt) {
    return `${String.fromCharCode(97 + (itemIdx % 26))}) `;
  }
  if (enumLabelOpt) {
    let s = enumLabelOpt;
    if (/\\alph\*/.test(s)) {
      s = s.replace(/\\alph\*/g, String.fromCharCode(97 + (itemIdx % 26)));
    }
    if (/\\Alph\*/.test(s)) {
      s = s.replace(/\\Alph\*/g, String.fromCharCode(65 + (itemIdx % 26)));
    }
    if (/\\roman\*/.test(s)) {
      const romans = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];
      s = s.replace(/\\roman\*/g, romans[itemIdx] ?? String(itemIdx + 1));
    }
    if (/\\Roman\*/.test(s)) {
      s = s.replace(/\\Roman\*/g, toRoman(itemIdx + 1));
    }
    if (/\\arabic\*/.test(s)) {
      s = s.replace(/\\arabic\*/g, String(itemIdx + 1));
    }
    return `${s.trim()} `;
  }
  return nextDepth === 1
    ? `${itemIdx + 1}. `
    : `(${String.fromCharCode(97 + (itemIdx % 26))}) `;
}

function buildEnumBulletSegments(
  enumLabelOpt: string | undefined,
  envName: string,
  nextDepth: number,
  itemIdx: number,
  customLabel: string | undefined,
  baseStyle: InlineStyle,
  mode: LatexPasteMode,
  ctx?: ParserContext
): InlineSegment[] {
  const expanded = expandEnumPattern(enumLabelOpt, envName, nextDepth, itemIdx, customLabel);
  const defaultBold =
    (envName === 'enumerate' || envName === 'enumerate*' || envName === 'inparaenum' || envName === 'itemchoice' || envName === 'description') &&
    (!enumLabelOpt || /\\(?:textbf|bfseries|bf)\b/.test(enumLabelOpt));
  const segs = parseInlineSegmentText(expanded, { ...baseStyle, bold: baseStyle.bold || defaultBold }, mode, ctx);
  if (segs.length > 0) return segs;
  return [{ type: 'text', content: expanded, ...baseStyle, ...(defaultBold ? { bold: true } : {}) }];
}

function toRoman(num: number): string {
  const map: Array<[number, string]> = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let n = num;
  let out = '';
  for (const [val, sym] of map) {
    while (n >= val) {
      out += sym;
      n -= val;
    }
  }
  return out || String(num);
}

function parseBodyBlocks(
  src: string,
  ctx: ParserContext,
  mode: LatexPasteMode,
  opts: BlockParseOptions
): DocumentBlock[][] {
  const containerW = opts.containerWidthPt ?? ctx.pageConfig.contentWidthPt ?? 487.3;
  const baseFontPt = opts.baseFontSizePt ?? ctx.pageConfig.baseFontSizePt ?? 12;
  const defaultLineSp = opts.defaultLineSpacing ?? ctx.pageConfig.defaultLineSpacing ?? 1.18;

  let scopeAlign: BlockAlignment = opts.defaultAlign;
  let scopeFontSizePt = baseFontPt;
  let scopeBold = opts.defaultBold ?? false;
  let scopeItalic = opts.defaultItalic ?? false;
  let scopeColor = opts.defaultColor;
  let pendingSpaceBeforePt: number | null = null;

  const pages: DocumentBlock[][] = [[]];
  const pushBlock = (blk: DocumentBlock) => {
    let target = blk;
    if (pendingSpaceBeforePt !== null) {
      target = {
        ...blk,
        space_before_pt:
          typeof blk.space_before_pt === 'number'
            ? blk.space_before_pt + pendingSpaceBeforePt
            : pendingSpaceBeforePt,
      };
      pendingSpaceBeforePt = null;
    }
    pages[pages.length - 1].push(target);
  };
  const pushPageBreak = () => {
    if (pages[pages.length - 1].length > 0) {
      pages.push([]);
    }
  };

  const buildTabStopSpecs = (
    segs: InlineSegment[],
    indentLeftPt: number,
    fontPt: number
  ): TabStopSpec[] | undefined => {
    const tabIndices: number[] = [];
    segs.forEach((s, idx) => {
      if (s.tab_before) tabIndices.push(idx);
    });
    if (tabIndices.length === 0) return undefined;
    const availW = Math.max(120, containerW - indentLeftPt);

    const estimateSegGroupWidthPt = (group: InlineSegment[]): number => {
      let w = 0;
      for (const s of group) {
        const pt = s.font_size_pt ?? fontPt;
        const txt = (s.content ?? '').trim();
        if (!txt) continue;
        if (s.type === 'math') {
          w += Math.max(12, txt.length * pt * 0.42);
        } else {
          w += txt.length * pt * (s.bold ? 0.51 : 0.47);
        }
      }
      return w;
    };

    const groups: InlineSegment[][] = [];
    groups.push(segs.slice(0, tabIndices[0]));
    for (let k = 0; k < tabIndices.length; k++) {
      const start = tabIndices[k];
      const end = k + 1 < tabIndices.length ? tabIndices[k + 1] : segs.length;
      groups.push(segs.slice(start, end));
    }

    const groupWidths = groups.map(estimateSegGroupWidthPt);
    const totalGroupW = groupWidths.reduce((a, b) => a + b, 0);
    const fixedTabsW = tabIndices.reduce((s, tIdx) => s + (segs[tIdx].tab_width_pt ?? 0), 0);
    const totalStretchWeight = Math.max(
      1,
      tabIndices.reduce((s, tIdx) => s + (segs[tIdx].tab_width_pt ? 0 : segs[tIdx].tab_weight ?? 1), 0)
    );
    const remainingStretchW = Math.max(40, availW - totalGroupW - fixedTabsW);

    const specs: TabStopSpec[] = [];
    let cursorPt = indentLeftPt + groupWidths[0];

    for (let k = 0; k < tabIndices.length; k++) {
      const tSeg = segs[tabIndices[k]];
      const leader = tSeg.tab_leader ?? 'none';
      const weight = tSeg.tab_weight ?? 1;
      const fixedW = tSeg.tab_width_pt;
      const tabSpanW =
        fixedW && fixedW > 0
          ? fixedW
          : remainingStretchW * (weight / totalStretchWeight);

      if (k === tabIndices.length - 1) {
        if (fixedW && fixedW > 0) {
          const endPos = Math.min(indentLeftPt + availW, Math.round((cursorPt + fixedW) * 10) / 10);
          specs.push({
            pos_pt: endPos,
            align: 'right',
            leader,
            fixed_width_pt: fixedW,
          });
        } else {
          specs.push({
            pos_pt: null,
            align: 'right',
            leader,
            weight,
          });
        }
      } else {
        const isSymmetricCenterTwoTab =
          tabIndices.length === 2 &&
          k === 0 &&
          !fixedW &&
          !segs[tabIndices[1]].tab_width_pt &&
          groupWidths[2] > 0 &&
          weight === (segs[tabIndices[1]].tab_weight ?? 1);

        if (isSymmetricCenterTwoTab) {
          specs.push({
            pos_pt: Math.round((indentLeftPt + availW * 0.5) * 10) / 10,
            align: 'center',
            leader,
            weight,
          });
        } else {
          const tabEnd = Math.min(indentLeftPt + availW - 24, Math.round((cursorPt + tabSpanW) * 10) / 10);
          specs.push({
            pos_pt: tabEnd,
            align: 'left',
            leader,
            ...(fixedW && fixedW > 0 ? { fixed_width_pt: fixedW } : { weight }),
          });
        }
      }
      cursorPt += tabSpanW + groupWidths[k + 1];
    }

    return specs;
  };

  const splitTabLinesAndPushParagraph = (
    segs: InlineSegment[],
    align: BlockAlignment,
    fontPt: number,
    lineSp: number,
    firstLineIndent?: number
  ) => {
    const hasTabs = segs.some((s) => s.tab_before);
    if (!hasTabs) {
      pushBlock({
        block_type: 'paragraph',
        alignment: align,
        font_size_pt: fontPt,
        line_spacing: lineSp,
        indent_left_pt: opts.indentLeftPt > 0 ? opts.indentLeftPt : undefined,
        ...(firstLineIndent !== undefined ? { first_line_indent_pt: firstLineIndent } : {}),
        segments: segs,
      });
      return;
    }

    // Split segments on '\n' when tab stops are used so each line has independent right/center tab stops
    const lineGroups: InlineSegment[][] = [[]];
    for (const seg of segs) {
      if (seg.type === 'text' && seg.content.includes('\n')) {
        const parts = seg.content.split('\n');
        parts.forEach((p, idx) => {
          if (idx > 0) lineGroups.push([]);
          if (p.length > 0 || (idx === 0 && seg.tab_before)) {
            lineGroups[lineGroups.length - 1].push({
              ...seg,
              content: p,
              tab_before: idx === 0 ? seg.tab_before : false,
            });
          }
        });
      } else {
        lineGroups[lineGroups.length - 1].push(seg);
      }
    }

    lineGroups.forEach((lg, lIdx) => {
      if (lg.length === 0) return;
      const tabSpecs = buildTabStopSpecs(lg, opts.indentLeftPt, fontPt);
      pushBlock({
        block_type: 'paragraph',
        alignment: align,
        font_size_pt: fontPt,
        line_spacing: lineSp,
        ...(lIdx > 0 ? { space_before_pt: 1.5 } : {}),
        indent_left_pt: opts.indentLeftPt > 0 ? opts.indentLeftPt : undefined,
        ...(lIdx === 0 && firstLineIndent !== undefined
          ? { first_line_indent_pt: firstLineIndent }
          : {}),
        ...(tabSpecs ? { tab_stop_specs: tabSpecs } : {}),
        segments: lg,
      });
    });
  };

  let textStart = 0;
  let i = 0;

  const flushTextSlice = (endIdx: number) => {
    if (endIdx <= textStart) return;
    const rawSlice = src.slice(textStart, endIdx);
    const mergedParagraphs = mergeWrappedProseLines(rawSlice, opts.isFullLatexDoc);
    const inlineBaseStyle: InlineStyle = {
      ...(scopeBold ? { bold: true } : {}),
      ...(scopeItalic ? { italic: true } : {}),
      ...(scopeFontSizePt !== 12 ? { font_size_pt: scopeFontSizePt } : {}),
      ...(scopeColor ? { color: scopeColor } : {}),
    };

    let pIdx = 0;
    let prevEndedWithDoubleBackslash = false;

    while (pIdx < mergedParagraphs.length) {
      let pLine = mergedParagraphs[pIdx];
      let hasExplicitNoindent = false;
      if (pLine.includes('\x00NOINDENT\x00')) {
        hasExplicitNoindent = pLine.trimStart().startsWith('\x00NOINDENT\x00');
        pLine = pLine.replace(/\x00NOINDENT\x00/g, '').trim();
        if (!pLine) {
          pIdx++;
          continue;
        }
      }

      // Check trailing \\[len] before parsing
      let nextLineExtraSpacePt: number | null = null;
      const trailingBreakM = pLine.match(/\\\\\*?\s*(?:\[([^\]]+)\])?\s*$/);
      if (trailingBreakM) {
        if (trailingBreakM[1]) {
          const parsedGap = parseLatexLengthToPt(trailingBreakM[1], containerW, scopeFontSizePt);
          if (parsedGap !== null && parsedGap >= 0) nextLineExtraSpacePt = parsedGap;
        }
        pLine = pLine.slice(0, trailingBreakM.index).trim();
      }

      if (!pLine) {
        if (nextLineExtraSpacePt !== null && nextLineExtraSpacePt > 0) {
          pendingSpaceBeforePt = (pendingSpaceBeforePt ?? 0) + nextLineExtraSpacePt;
        }
        prevEndedWithDoubleBackslash = Boolean(trailingBreakM);
        pIdx++;
        continue;
      }

      if (pLine.includes('\\par')) {
        const subParts = pLine.split(/\\par(?![a-zA-Z])\s*/);
        for (const sub of subParts) {
          const st = sub.trim();
          if (!st) continue;
          const subChoice = tryParseInlineChoiceRow(st, mode, ctx);
          if (subChoice) {
            if (opts.indentLeftPt > 0) subChoice.indent_left_pt = opts.indentLeftPt;
            pushBlock(subChoice);
            continue;
          }
          const parsedSubSegs = parseInlineSegmentText(st, inlineBaseStyle, mode, ctx);
          const segs = opts.isFullLatexDoc ? parsedSubSegs : applyQuestionLabelBold(parsedSubSegs);
          if (segs.length > 0) {
            const align: BlockAlignment =
              scopeAlign === 'left' && st.length > 55 ? 'justify' : scopeAlign;
            const parInd =
              !hasExplicitNoindent &&
              ctx.pageConfig.defaultParIndentPt > 0 &&
              opts.indentLeftPt === 0 &&
              (align === 'left' || align === 'justify') &&
              !segs.some((s) => s.tab_before)
                ? ctx.pageConfig.defaultParIndentPt
                : undefined;
            splitTabLinesAndPushParagraph(segs, align, scopeFontSizePt, defaultLineSp, parInd);
          }
        }
        prevEndedWithDoubleBackslash = Boolean(trailingBreakM);
        if (nextLineExtraSpacePt !== null && nextLineExtraSpacePt > 0) {
          pendingSpaceBeforePt = (pendingSpaceBeforePt ?? 0) + nextLineExtraSpacePt;
        }
        pIdx++;
        continue;
      }

      if (pLine === '---' || pLine === '\\hline' || pLine === '\\hrule') {
        pushBlock({
          block_type: 'horizontal_rule',
          alignment: 'left',
          indent_left_pt: opts.indentLeftPt > 0 ? opts.indentLeftPt : undefined,
        });
        prevEndedWithDoubleBackslash = false;
        pIdx++;
        continue;
      }

      if (isPureBareLatexLine(pLine)) {
        pushBlock({
          block_type: 'equation',
          alignment: 'center',
          latex: normalizeMathContent(pLine, ctx),
          font_size_pt: scopeFontSizePt,
          ...(scopeBold ? { bold: true } : {}),
          ...(scopeItalic ? { italic: true } : {}),
          ...(scopeColor ? { color: scopeColor } : {}),
        });
        prevEndedWithDoubleBackslash = Boolean(trailingBreakM);
        pIdx++;
        continue;
      }

      // Support 2x2 boxed choices separated by top-level \\ or \\[0.45cm] inside a single paragraph
      const topLevelParts = splitTopLevelDoubleBackslash(pLine)
        .map((part) => part.trim())
        .filter(Boolean);
      if (topLevelParts.length >= 2) {
        const parsedRows = topLevelParts.map((part) => tryParseInlineChoiceRow(part, mode, ctx));
        if (parsedRows.every((r): r is DocumentBlock => r !== null)) {
          const combinedRows = parsedRows.flatMap((r) => r.table_rows ?? []);
          pushBlock({
            block_type: 'table',
            alignment: 'left',
            table_borderless: true,
            is_choice_block: true,
            font_size_pt: scopeFontSizePt,
            line_spacing: 1.15,
            indent_left_pt: opts.indentLeftPt > 0 ? opts.indentLeftPt : undefined,
            table_rows: combinedRows,
          });
          prevEndedWithDoubleBackslash = Boolean(trailingBreakM);
          pIdx++;
          continue;
        }
      }

      const inlineChoice = tryParseInlineChoiceRow(pLine, mode, ctx);
      if (inlineChoice) {
        if (opts.indentLeftPt > 0) inlineChoice.indent_left_pt = opts.indentLeftPt;
        const currentPage = pages[pages.length - 1];
        const prevBlk = currentPage[currentPage.length - 1];
        if (
          prevBlk &&
          prevBlk.block_type === 'table' &&
          prevBlk.is_choice_block &&
          prevBlk.table_rows &&
          inlineChoice.table_rows &&
          prevBlk.table_rows[0]?.length === inlineChoice.table_rows[0]?.length
        ) {
          prevBlk.table_rows.push(...inlineChoice.table_rows);
        } else {
          pushBlock(inlineChoice);
        }
        prevEndedWithDoubleBackslash = Boolean(trailingBreakM);
        pIdx++;
        continue;
      }

      if (
        pIdx + 3 < mergedParagraphs.length &&
        /^A[\.\)](?:\s+|(?=\$|\\[\(\[]))/.test(unwrapInlineBoxesForChoiceCheck(mergedParagraphs[pIdx])) &&
        /^B[\.\)](?:\s+|(?=\$|\\[\(\[]))/.test(unwrapInlineBoxesForChoiceCheck(mergedParagraphs[pIdx + 1])) &&
        /^C[\.\)](?:\s+|(?=\$|\\[\(\[]))/.test(unwrapInlineBoxesForChoiceCheck(mergedParagraphs[pIdx + 2])) &&
        /^D[\.\)](?:\s+|(?=\$|\\[\(\[]))/.test(unwrapInlineBoxesForChoiceCheck(mergedParagraphs[pIdx + 3]))
      ) {
        const cells: TableCellData[] = [0, 1, 2, 3].map((offset) => {
          const unwrapped = unwrapOuterLayoutBox(mergedParagraphs[pIdx + offset]);
          const parsedSegs = boldLeadingChoiceMarker(
            parseInlineSegmentText(unwrapped, inlineBaseStyle, mode, ctx)
          );
          return {
            segments: parsedSegs,
            alignment: 'left',
            width_pct: 25,
          };
        });
        pushBlock({
          block_type: 'table',
          alignment: 'left',
          table_borderless: true,
          is_choice_block: true,
          font_size_pt: scopeFontSizePt,
          line_spacing: 1.15,
          indent_left_pt: opts.indentLeftPt > 0 ? opts.indentLeftPt : undefined,
          table_rows: [cells],
        });
        prevEndedWithDoubleBackslash = false;
        pIdx += 4;
        continue;
      }

      // Detect explicit leading \hspace*{len} / \hspace{len} at paragraph start -> first_line_indent_pt
      let explicitLeadingIndentPt: number | undefined;
      const leadHsM = pLine.match(/^\\hspace\*?\s*\{([^}]+)\}\s*/);
      if (leadHsM) {
        const hsPt = parseLatexLengthToPt(leadHsM[1], containerW, scopeFontSizePt);
        if (hsPt !== null && hsPt > 0) {
          explicitLeadingIndentPt = Math.round(hsPt * 10) / 10;
          pLine = pLine.slice(leadHsM[0].length);
        }
      }

      const parsedLineSegs = parseInlineSegmentText(pLine, inlineBaseStyle, mode, ctx);
      const segs = opts.isFullLatexDoc ? parsedLineSegs : applyQuestionLabelBold(parsedLineSegs);
      if (segs.length > 0) {
        const plainLen = segs.reduce((s, item) => s + item.content.length, 0);
        const hasTabs = segs.some((s) => s.tab_before);
        const align: BlockAlignment = hasTabs
          ? 'left'
          : scopeAlign !== 'left'
          ? scopeAlign
          : opts.isFullLatexDoc && plainLen > 45
          ? 'justify'
          : 'left';
        if (prevEndedWithDoubleBackslash && pendingSpaceBeforePt === null) {
          pendingSpaceBeforePt = 1.5;
        }
        const parInd =
          explicitLeadingIndentPt !== undefined
            ? explicitLeadingIndentPt
            : !hasExplicitNoindent &&
              !prevEndedWithDoubleBackslash &&
              !hasTabs &&
              ctx.pageConfig.defaultParIndentPt > 0 &&
              opts.indentLeftPt === 0 &&
              (align === 'left' || align === 'justify') &&
              !/^(?:Câu|Bài|Ví dụ|Phần|Mục|Lời giải)\b/i.test(segs[0]?.content ?? '')
            ? ctx.pageConfig.defaultParIndentPt
            : undefined;
        splitTabLinesAndPushParagraph(segs, align, scopeFontSizePt, defaultLineSp, parInd);
      }
      prevEndedWithDoubleBackslash = Boolean(trailingBreakM);
      if (nextLineExtraSpacePt !== null && nextLineExtraSpacePt > 0) {
        pendingSpaceBeforePt = (pendingSpaceBeforePt ?? 0) + nextLineExtraSpacePt;
      }
      pIdx++;
    }
  };

  const hasBlockContainerInside = (snippet: string): boolean =>
    /\\begin\{(?:tikzpicture|pgfpicture|picture|tabular|tabular\*|tabularx|longtable|enumerate\*?|itemize|itemchoice|description|inparaenum|tasks|tabbing|figure|table|verbatim|lstlisting|minted|axis|ex|bt|vd|center|flushleft|flushright|minipage|tcolorbox|framed|mdframed|shaded|multicols|equation\*?|align\*?|gather\*?|multline\*?|displaymath)\}|\\\[|\\(?:section|subsection|subsubsection|chapter|part|par(?![a-zA-Z])|centering|raggedright|raggedleft)|\n\s*\n/.test(
      snippet
    );

  const startsWithBlockScopeSwitch = (snippet: string): boolean =>
    /^\s*\\(?:centering|raggedright|raggedleft|Large|LARGE|large|huge|Huge|small|footnotesize|scriptsize|tiny|normalsize|bfseries|bf|itshape|it|normalfont|mdseries|upshape|normalcolor|color(?:\s*\[[^\]]*\])?\s*\{)(?![a-zA-Z])/.test(
      snippet
    );

  const parseConsecutiveMakeboxBlock = (
    startIdx: number
  ): { block: DocumentBlock; endIdx: number } | null => {
    interface ParsedMakeboxItem {
      widthPt: number | null;
      align: BlockAlignment;
      content: string;
    }
    const lineGroups: Array<{ items: ParsedMakeboxItem[]; explicitBreakAfter: boolean }> = [];
    let scanPos = startIdx;
    let lastValidEnd = startIdx;

    while (scanPos < src.length) {
      const lineStart = scanPos;
      const nlIdx = src.indexOf('\n', scanPos);
      const lineEnd = nlIdx === -1 ? src.length : nlIdx;
      const lineItems: ParsedMakeboxItem[] = [];
      let p = lineStart;
      let explicitBreakAfter = false;
      let invalidToken = false;

      while (p < lineEnd) {
        while (p < lineEnd && (src[p] === ' ' || src[p] === '\t' || src[p] === '~')) p++;
        if (p >= lineEnd) break;
        const sub = src.slice(p);
        const mbM = sub.match(/^\\(makebox|framebox)\*?(?:\s*\[([^\]]*)\])?(?:\s*\[([^\]]*)\])?\s*\{/);
        if (mbM) {
          const br = readBalancedBraces(src, p + mbM[0].length - 1);
          if (!br) {
            invalidToken = true;
            break;
          }
          const wPt = mbM[2] ? parseLatexLengthToPt(mbM[2], containerW, scopeFontSizePt) : null;
          const posOpt = (mbM[3] ?? '').trim().toLowerCase();
          const align: BlockAlignment =
            posOpt === 'c' ? 'center' : posOpt === 'r' ? 'right' : 'left';
          lineItems.push({ widthPt: wPt, align, content: br.content });
          p = br.endIdx + 1;
          if (p > lineEnd) {
            // Balanced braces spanned multiple lines; advance lineEnd to end of line containing br.endIdx
            const nextNl = src.indexOf('\n', p);
            scanPos = nextNl === -1 ? src.length : nextNl + 1;
          }
          continue;
        }
        const spM = sub.match(/^\\(?:hfill|quad|qquad|hspace\*?\{[^}]*\}|enspace)(?![a-zA-Z])/);
        if (spM) {
          p += spM[0].length;
          continue;
        }
        const brkM = sub.match(/^\\\\\*?(?:\s*\[[^\]]*\])?\s*(?=\n|$)/);
        if (brkM) {
          explicitBreakAfter = true;
          p += brkM[0].length;
          break;
        }
        invalidToken = true;
        break;
      }

      if (invalidToken || lineItems.length === 0) break;
      lineGroups.push({ items: lineItems, explicitBreakAfter });
      const actualEndOfLastLine = p > lineEnd ? (src.indexOf('\n', p) === -1 ? src.length : src.indexOf('\n', p) + 1) : nlIdx === -1 ? src.length : nlIdx + 1;
      lastValidEnd = actualEndOfLastLine;
      scanPos = actualEndOfLastLine;
    }

    const totalBoxes = lineGroups.reduce((s, g) => s + g.items.length, 0);
    if (totalBoxes < 2) return null;

    // Organize boxes into visual rows honoring explicit \\ breaks or container width overflow (> 108%)
    const rawRows: ParsedMakeboxItem[][] = [[]];
    let curRowWidth = 0;

    for (const lg of lineGroups) {
      for (const box of lg.items) {
        const estW = box.widthPt ?? containerW / Math.max(2, totalBoxes);
        if (rawRows[rawRows.length - 1].length > 0 && curRowWidth + estW > containerW * 1.08) {
          rawRows.push([]);
          curRowWidth = 0;
        }
        rawRows[rawRows.length - 1].push(box);
        curRowWidth += estW;
      }
      if (lg.explicitBreakAfter && rawRows[rawRows.length - 1].length > 0) {
        rawRows.push([]);
        curRowWidth = 0;
      }
    }

    const nonEmptyRows = rawRows.filter((r) => r.length > 0);
    if (nonEmptyRows.length === 0) return null;

    const allFlat = nonEmptyRows.flat();
    const firstMarkers = allFlat.map((b) => unwrapInlineBoxesForChoiceCheck(b.content));
    const isChoiceBlock =
      allFlat.length >= 2 &&
      allFlat.length <= 4 &&
      firstMarkers.every((t) => /^(?:[A-D]\.|[a-d]\))(?:\s+|(?=\$|\\[\(\[]))/.test(t));

    const maxCols = Math.max(...nonEmptyRows.map((r) => r.length), 1);
    const baseStyle: InlineStyle = {
      ...(scopeBold ? { bold: true } : {}),
      ...(scopeItalic ? { italic: true } : {}),
      ...(scopeFontSizePt !== 12 ? { font_size_pt: scopeFontSizePt } : {}),
      ...(scopeColor ? { color: scopeColor } : {}),
    };

    const tableRows: TableCellData[][] = nonEmptyRows.map((row) => {
      const rowTotalW =
        row.reduce((s, b) => s + (b.widthPt ?? containerW / maxCols), 0) || containerW;
      const cells: TableCellData[] = row.map((b) => {
        const segs = parseInlineSegmentText(b.content.trim(), baseStyle, mode, ctx);
        return {
          segments: isChoiceBlock ? boldLeadingChoiceMarker(segs) : segs,
          alignment: b.align,
          v_align: 'top',
          width_pct: Math.round(((b.widthPt ?? containerW / maxCols) / rowTotalW) * 1000) / 10,
        };
      });
      while (cells.length < maxCols) {
        cells.push({
          segments: [],
          alignment: 'left',
          v_align: 'top',
          width_pct: Math.round((100 / maxCols) * 10) / 10,
        });
      }
      return cells;
    });

    return {
      block: {
        block_type: 'table',
        alignment: 'left',
        table_borderless: true,
        table_style: 'borderless',
        ...(isChoiceBlock ? { is_choice_block: true, preserve_col_count: maxCols > 1 } : {}),
        font_size_pt: scopeFontSizePt,
        line_spacing: defaultLineSp,
        indent_left_pt: opts.indentLeftPt > 0 ? opts.indentLeftPt : undefined,
        table_rows: tableRows,
      },
      endIdx: lastValidEnd,
    };
  };

  while (i < src.length) {
    // Escaped \$
    if (src[i] === '\\' && src[i + 1] === '$') {
      i += 2;
      continue;
    }

    // Standalone or inline $$ ... $$
    if (src[i] === '$' && src[i + 1] === '$') {
      const isLineStart = isOnlySpacesBeforeOnLine(src, i);
      const closeIdx = src.indexOf('$$', i + 2);
      if (closeIdx !== -1) {
        const inner = src.slice(i + 2, closeIdx).trim();
        const isStandalone =
          isLineStart && (isOnlySpacesAfterOnLine(src, closeIdx + 2) || inner.includes('\n'));
        if (isStandalone) {
          flushTextSlice(i);
          if (inner) {
            registerLabelsInMath(inner, 'displaymath', ctx);
            pushBlock({
              block_type: 'equation',
              alignment: 'center',
              latex: normalizeMathContent(inner, ctx),
              font_size_pt: scopeFontSizePt,
              ...(scopeBold ? { bold: true } : {}),
              ...(scopeItalic ? { italic: true } : {}),
              ...(scopeColor ? { color: scopeColor } : {}),
            });
          }
          i = closeIdx + 2;
          textStart = i;
          continue;
        }
        // Inline $$...$$: jump over it so inner \begin{cases} or single $ isn't torn apart
        i = closeIdx + 2;
        continue;
      }
    }

    // Inline single-dollar $ ... $: skip over so \begin{cases}, \begin{aligned}, etc. inside $...$ stay inline
    if (src[i] === '$' && src[i + 1] !== '$') {
      let braceDepth = 0;
      let closeIdx = -1;
      for (let j = i + 1; j < src.length; j++) {
        if (src[j] === '\\' && j + 1 < src.length) {
          j++;
          continue;
        }
        if (src[j] === '{') {
          braceDepth++;
          continue;
        }
        if (src[j] === '}') {
          braceDepth = Math.max(0, braceDepth - 1);
          continue;
        }
        // Stop scanning if we cross a blank paragraph break or structural section
        if (
          src[j] === '\n' &&
          (/^[ \t]*\n/.test(src.slice(j + 1)) ||
            /^[ \t]*\\(?:section|subsection|begin\{(?:ex|bt|vd|document)\}|end\{document\})/.test(
              src.slice(j + 1)
            ))
        ) {
          break;
        }
        if (src[j] === '$' && src[j + 1] !== '$' && braceDepth === 0) {
          closeIdx = j;
          break;
        }
      }
      if (closeIdx !== -1) {
        i = closeIdx + 1;
        continue;
      }
    }

    // Inline \( ... \)
    if (src[i] === '\\' && src[i + 1] === '(') {
      const closeIdx = src.indexOf('\\)', i + 2);
      if (closeIdx !== -1 && !/\n[ \t]*\n/.test(src.slice(i + 2, closeIdx))) {
        i = closeIdx + 2;
        continue;
      }
    }

    // Display \[ ... \]
    if (src[i] === '\\' && src[i + 1] === '[') {
      const closeIdx = src.indexOf('\\]', i + 2);
      if (closeIdx !== -1) {
        flushTextSlice(i);
        const inner = src.slice(i + 2, closeIdx).trim();
        if (inner) {
          registerLabelsInMath(inner, 'displaymath', ctx);
          pushBlock({
            block_type: 'equation',
            alignment: 'center',
            latex: normalizeMathContent(inner, ctx),
            font_size_pt: scopeFontSizePt,
            ...(scopeBold ? { bold: true } : {}),
            ...(scopeItalic ? { italic: true } : {}),
            ...(scopeColor ? { color: scopeColor } : {}),
          });
        }
        i = closeIdx + 2;
        textStart = i;
        continue;
      }
    }

    // Block-level braced group: { \centering ... }, { \Large ... }, or containing blocks
    if (src[i] === '{' && (isOnlySpacesBeforeOnLine(src, i) || i === textStart)) {
      const br = readBalancedBraces(src, i);
      if (
        br &&
        (hasBlockContainerInside(br.content) ||
          (startsWithBlockScopeSwitch(br.content) && isOnlySpacesAfterOnLine(src, br.endIdx + 1)))
      ) {
        flushTextSlice(i);
        const groupPages = parseBodyBlocks(br.content, ctx, mode, {
          ...opts,
          defaultAlign: scopeAlign,
          containerWidthPt: containerW,
          baseFontSizePt: scopeFontSizePt,
          defaultLineSpacing: defaultLineSp,
          defaultBold: scopeBold,
          defaultItalic: scopeItalic,
          defaultColor: scopeColor,
        });
        groupPages.forEach((pg, pIdx) => {
          if (pIdx > 0) pushPageBreak();
          pg.forEach(pushBlock);
        });
        i = br.endIdx + 1;
        textStart = i;
        continue;
      }
    }

    if (src[i] === '\\') {
      const rest = src.slice(i);
      const atFreshSwitchStart = isOnlySpacesBeforeOnLine(src, i) || i === textStart;

      // Page breaks
      const pageBrMatch = rest.match(/^\\(?:newpage|clearpage|cleardoublepage|pagebreak)(?![a-zA-Z])\s*/);
      if (pageBrMatch) {
        flushTextSlice(i);
        pushPageBreak();
        i += pageBrMatch[0].length;
        textStart = i;
        continue;
      }

      // \appendix
      const appendixMatch = rest.match(/^\\appendix(?![a-zA-Z])\s*/);
      if (appendixMatch) {
        flushTextSlice(i);
        ctx.inAppendix = true;
        ctx.sectionCount = 0;
        ctx.subsectionCount = 0;
        ctx.subsubsectionCount = 0;
        i += appendixMatch[0].length;
        textStart = i;
        continue;
      }

      // Standalone \label{key} outside text (associates with previous heading/block)
      const standaloneLabelMatch = rest.match(/^\\label\s*\{([^}]+)\}\s*/);
      if (standaloneLabelMatch && atFreshSwitchStart) {
        if (ctx.lastNumberedTarget) {
          const key = standaloneLabelMatch[1].trim();
          ctx.labels[key] = ctx.lastNumberedTarget;
          if (ctx.lastNumberedKind) ctx.labelKinds[key] = ctx.lastNumberedKind;
        }
        i += standaloneLabelMatch[0].length;
        textStart = i;
        continue;
      }

      // \maketitle
      const makeTitleMatch = rest.match(/^\\maketitle(?![a-zA-Z])\s*/);
      if (makeTitleMatch) {
        flushTextSlice(i);
        if (opts.meta?.title) {
          pushBlock({
            block_type: 'heading',
            alignment: 'center',
            heading_level: 1,
            font_size_pt: 17,
            segments: parseInlineSegmentText(opts.meta.title, { bold: true, font_size_pt: 17 }, mode, ctx),
          });
        }
        if (opts.meta?.author) {
          pushBlock({
            block_type: 'paragraph',
            alignment: 'center',
            font_size_pt: 12,
            segments: parseInlineSegmentText(opts.meta.author, { font_size_pt: 12 }, mode, ctx),
          });
        }
        if (opts.meta?.date) {
          pushBlock({
            block_type: 'paragraph',
            alignment: 'center',
            font_size_pt: 11,
            segments: parseInlineSegmentText(opts.meta.date, { font_size_pt: 11 }, mode, ctx),
          });
        }
        i += makeTitleMatch[0].length;
        textStart = i;
        continue;
      }

      // Block-level scope switches: \centering, \raggedright, \raggedleft
      const scopeAlignM = rest.match(/^\\(centering|raggedright|raggedleft)(?![a-zA-Z])\s*/);
      if (scopeAlignM && atFreshSwitchStart) {
        flushTextSlice(i);
        scopeAlign =
          scopeAlignM[1] === 'centering'
            ? 'center'
            : scopeAlignM[1] === 'raggedleft'
            ? 'right'
            : 'left';
        i += scopeAlignM[0].length;
        textStart = i;
        continue;
      }

      // Block-level font/size/color scope switches (chaining cleanly when consecutive)
      const scopeStyleM = rest.match(
        /^\\(Large|LARGE|large|huge|Huge|small|footnotesize|scriptsize|tiny|normalsize|bfseries|bf|boldmath|unboldmath|itshape|it|slshape|sl|normalfont|mdseries|upshape|normalcolor)(?![a-zA-Z])\s*/
      );
      if (scopeStyleM && atFreshSwitchStart) {
        flushTextSlice(i);
        const sw = scopeStyleM[1];
        if (sw === 'bf' || sw === 'bfseries' || sw === 'boldmath') scopeBold = true;
        else if (sw === 'mdseries' || sw === 'unboldmath') scopeBold = false;
        else if (sw === 'it' || sw === 'itshape' || sw === 'sl' || sw === 'slshape') scopeItalic = true;
        else if (sw === 'upshape') scopeItalic = false;
        else if (sw === 'normalfont') {
          scopeBold = opts.defaultBold ?? false;
          scopeItalic = opts.defaultItalic ?? false;
          scopeFontSizePt = baseFontPt;
        } else if (sw === 'normalcolor') {
          scopeColor = undefined;
        } else if (FONT_SIZE_PT_MAP[sw]) {
          scopeFontSizePt = sw === 'normalsize' ? baseFontPt : FONT_SIZE_PT_MAP[sw];
        }
        i += scopeStyleM[0].length;
        textStart = i;
        continue;
      }

      const scopeColorM = rest.match(/^\\color(?:\s*\[([^\]]+)\])?\s*\{([^}]+)\}\s*/);
      if (scopeColorM && atFreshSwitchStart) {
        flushTextSlice(i);
        const hex = resolveLatexModelAndSpec(scopeColorM[1], scopeColorM[2], ctx.customColors);
        if (isBlackLatexColor(scopeColorM[2], hex)) {
          scopeColor = undefined;
        } else if (hex) {
          scopeColor = hex;
        }
        i += scopeColorM[0].length;
        textStart = i;
        continue;
      }

      // Standalone \centerline{...}, \leftline{...}, \rightline{...}
      const lineBoxM = rest.match(/^\\(centerline|leftline|rightline)\s*\{/);
      if (lineBoxM && atFreshSwitchStart) {
        const br = readBalancedBraces(src, i + lineBoxM[0].length - 1);
        if (br && isOnlySpacesAfterOnLine(src, br.endIdx + 1)) {
          flushTextSlice(i);
          const lineAlign: BlockAlignment =
            lineBoxM[1] === 'centerline' ? 'center' : lineBoxM[1] === 'rightline' ? 'right' : 'left';
          const baseInline: InlineStyle = {
            ...(scopeBold ? { bold: true } : {}),
            ...(scopeItalic ? { italic: true } : {}),
            ...(scopeFontSizePt !== 12 ? { font_size_pt: scopeFontSizePt } : {}),
            ...(scopeColor ? { color: scopeColor } : {}),
          };
          const segs = parseInlineSegmentText(br.content.trim(), baseInline, mode, ctx);
          if (segs.length > 0) {
            splitTabLinesAndPushParagraph(segs, lineAlign, scopeFontSizePt, defaultLineSp);
          }
          i = br.endIdx + 1;
          textStart = i;
          continue;
        }
      }

      // Block-level vertical spacing: \vspace*{len}, \vspace{len}, \addvspace{len}, \smallskip, \medskip, \bigskip
      const vspaceCmdM = rest.match(/^\\(vspace\*?|addvspace)\s*\{([^}]+)\}[ \t]*\n?/);
      if (vspaceCmdM && atFreshSwitchStart) {
        flushTextSlice(i);
        const pt = parseLatexLengthToPt(vspaceCmdM[2], containerW, scopeFontSizePt);
        if (pt !== null && pt > 0) {
          pendingSpaceBeforePt = (pendingSpaceBeforePt ?? 0) + pt;
        }
        i += vspaceCmdM[0].length;
        textStart = i;
        continue;
      }
      const skipCmdM = rest.match(/^\\(smallskip|medskip|bigskip)(?![a-zA-Z])[ \t]*\n?/);
      if (skipCmdM && atFreshSwitchStart) {
        flushTextSlice(i);
        const pt = skipCmdM[1] === 'bigskip' ? 12 : skipCmdM[1] === 'medskip' ? 6 : 3;
        pendingSpaceBeforePt = (pendingSpaceBeforePt ?? 0) + pt;
        i += skipCmdM[0].length;
        textStart = i;
        continue;
      }

      // Built-in counter resets (\setcounter{ex}{0}, \addtocounter{ex}{1})
      const builtinCtrM = rest.match(/^\\(setcounter|addtocounter)\s*\{([^}]+)\}\s*\{([^}]*)\}[ \t]*\n?/);
      if (builtinCtrM) {
        flushTextSlice(i);
        const cname = builtinCtrM[2].trim();
        const val = parseInt(builtinCtrM[3].trim(), 10);
        if (cname && Number.isFinite(val)) {
          if (builtinCtrM[1] === 'setcounter') ctx.counters[cname] = val;
          else ctx.counters[cname] = (ctx.counters[cname] ?? 0) + val;
        }
        i += builtinCtrM[0].length;
        textStart = i;
        continue;
      }

      // Multi-line or single-line consecutive \makebox[w][pos]{...} / \framebox[w][pos]{...} blocks
      if (/^\\(?:makebox|framebox)\*/.test(rest) || /^\\(?:makebox|framebox)(?:\s*\[|\s*\{)/.test(rest)) {
        if (atFreshSwitchStart) {
          const mbResult = parseConsecutiveMakeboxBlock(i);
          if (mbResult) {
            flushTextSlice(i);
            pushBlock(mbResult.block);
            i = mbResult.endIdx;
            textStart = i;
            continue;
          }
        }
      }

      // Unwrap \resizebox / \scalebox / \adjustbox when wrapping block containers (e.g., tabular, tikzpicture)
      const scaleWrapM = rest.match(
        /^\\(?:resizebox\*?\s*\{[^}]*\}\s*\{[^}]*\}|scalebox(?:\s*\[[^\]]*\])?\s*\{[^}]*\}(?:\s*\[[^\]]*\])?|adjustbox\s*\{[^}]*\})\s*\{/
      );
      if (scaleWrapM) {
        const br = readBalancedBraces(src, i + scaleWrapM[0].length - 1);
        if (br && hasBlockContainerInside(br.content)) {
          flushTextSlice(i);
          const innerPages = parseBodyBlocks(br.content, ctx, mode, {
            ...opts,
            defaultAlign: scopeAlign,
            containerWidthPt: containerW,
            baseFontSizePt: scopeFontSizePt,
            defaultLineSpacing: defaultLineSp,
            defaultBold: scopeBold,
            defaultItalic: scopeItalic,
            defaultColor: scopeColor,
          });
          innerPages.forEach((pg, pIdx) => {
            if (pIdx > 0) pushPageBreak();
            pg.forEach(pushBlock);
          });
          i = br.endIdx + 1;
          textStart = i;
          continue;
        }
      }

      // Keep inline boxes/styling commands (\makebox, \framebox, \textbf, etc.) intact when they contain no block containers
      const inlineBoxCmdM = rest.match(
        /^\\(?:makebox|framebox)\*?(?:\s*\[[^\]]*\])*\s*\{|^\\(?:textbf|textmd|textit|emph|underline|fbox|boxed|textrm|textsf|texttt|textsc|textsl|textnormal|textup|sout|uline|text|mbox|hbox|centerline|leftline|rightline)(?:\s*\[[^\]]*\])?\s*\{|^\\(?:parbox|raisebox|scalebox|textcolor|colorbox)(?:\s*\[[^\]]*\])*\s*\{[^}]*\}(?:\s*\[[^\]]*\])*\s*\{|^\\(?:fcolorbox)(?:\s*\[[^\]]*\])?\s*\{[^}]*\}(?:\s*\[[^\]]*\])?\s*\{[^}]*\}\s*\{|^\\resizebox\*?\s*\{[^}]*\}\s*\{[^}]*\}\s*\{/
      );
      if (inlineBoxCmdM) {
        const br = readBalancedBraces(src, i + inlineBoxCmdM[0].length - 1);
        if (br && !hasBlockContainerInside(br.content)) {
          i = br.endIdx + 1;
          continue;
        }
      }

      // Standalone \includegraphics[opts]{assetKey} when matching an extracted PDF/Docx figure asset
      const incGraphMatch = rest.match(/^\\includegraphics\*?(?:\s*\[[^\]]*\])?\s*\{/);
      if (incGraphMatch && isOnlySpacesBeforeOnLine(src, i)) {
        const br = readBalancedBraces(src, i + incGraphMatch[0].length - 1);
        if (br) {
          const assetKey = br.content.trim();
          const asset = ctx.figureAssets?.[assetKey];
          if (asset) {
            flushTextSlice(i);
            let nextIdx = br.endIdx + 1;
            let parsedCaption: string | undefined;

            // Consume optional trailing "\\ \textit{caption}" or "\caption{caption}" emitted by pagesToLatexSource
            const afterImg = src.slice(nextIdx);
            const capLeadMatch = afterImg.match(/^(?:[ \t]*\n?[ \t]*\\\\)?[ \t]*\n?[ \t]*\\(?:textit|caption)\s*\{/);
            if (capLeadMatch) {
              const capBracePos = nextIdx + capLeadMatch[0].length - 1;
              const capBr = readBalancedBraces(src, capBracePos);
              if (capBr) {
                parsedCaption = capBr.content
                  .replace(/\\([%&#_{}$])/g, '$1')
                  .replace(/\\textbackslash\{\}/g, '\\')
                  .trim();
                nextIdx = capBr.endIdx + 1;
              }
            }

            pushBlock({
              block_type: 'figure',
              alignment:
                opts.defaultAlign === 'left' || opts.defaultAlign === 'right'
                  ? opts.defaultAlign
                  : 'center',
              croppedImageDataUrl: asset.dataUrl,
              croppedWidthPx: asset.widthPx,
              croppedHeightPx: asset.heightPx,
              ...(Array.isArray(asset.box_2d) && asset.box_2d.length === 4
                ? { box_2d: asset.box_2d }
                : {}),
              ...(parsedCaption ? { caption: parsedCaption } : {}),
            });
            i = nextIdx;
            textStart = i;
            continue;
          }
        }
      }

      // \tikz[opts]{...}
      const tikzInlineHead = rest.match(/^\\tikz(?![a-zA-Z])/);
      if (tikzInlineHead) {
        let scanIdx = i + tikzInlineHead[0].length;
        let tikzOpts = '';
        while (scanIdx < src.length && /\s/.test(src[scanIdx])) scanIdx++;
        if (src[scanIdx] === '[') {
          const optBrk = readBalancedBrackets(src, scanIdx);
          if (optBrk) {
            tikzOpts = optBrk.content;
            scanIdx = optBrk.endIdx + 1;
            while (scanIdx < src.length && /\s/.test(src[scanIdx])) scanIdx++;
          }
        }
        if (src[scanIdx] === '{') {
          const br = readBalancedBraces(src, scanIdx);
          if (br) {
            flushTextSlice(i);
            const tikzBody = tikzOpts ? `[${tikzOpts}]\n${br.content}` : br.content;
            const rendered = renderLatexPictureToSvgDataUrl('tikzpicture', tikzBody, ctx.customColors, ctx.customTikzStyles);
            if (rendered) {
              pushBlock({
                block_type: 'figure',
                alignment:
                  opts.defaultAlign === 'left' || opts.defaultAlign === 'right'
                    ? opts.defaultAlign
                    : 'center',
                croppedImageDataUrl: rendered.dataUrl,
                croppedWidthPx: rendered.widthPx,
                croppedHeightPx: rendered.heightPx,
              });
            }
            i = br.endIdx + 1;
            textStart = i;
            continue;
          }
        }
      }

      // \immini[opts]{text}{figure} (popular in Vietnamese ex_test exams)
      const imminiMatch = rest.match(/^\\immini(?:\s*\[([^\]]*)\])?\s*\{/);
      if (imminiMatch) {
        const extracted = extractBalancedMacroArgs(src, i + imminiMatch[0].length - 1, 2);
        if (extracted) {
          flushTextSlice(i);
          const imOptsRaw = imminiMatch[1] ?? '';
          const widthOptM = imOptsRaw.match(/width\s*=\s*([^,\]]+)/i);
          const explicitRightPt = widthOptM
            ? parseLatexLengthToPt(widthOptM[1], containerW, scopeFontSizePt)
            : null;

          // First estimate figure width from right content, then parse left content with exact remaining column width
          const rightPagesPre = parseBodyBlocks(extracted.args[1], ctx, mode, {
            ...opts,
            defaultAlign: 'center',
            containerWidthPt: containerW * 0.45,
            baseFontSizePt: scopeFontSizePt,
            defaultLineSpacing: defaultLineSp,
          });
          const rightBlocks = rightPagesPre.flat();
          let rightPct = 36;
          if (explicitRightPt !== null && explicitRightPt > 40) {
            rightPct = Math.max(20, Math.min(55, Math.round((explicitRightPt / containerW) * 100)));
          } else {
            const figBlk = rightBlocks.find((b) => b.block_type === 'figure' && b.croppedWidthPx);
            if (figBlk && figBlk.croppedWidthPx) {
              const estPt = figBlk.croppedWidthPx * (28.3465 / 42) + 14;
              rightPct = Math.max(22, Math.min(50, Math.round((estPt / containerW) * 100)));
            }
          }
          const leftPct = 100 - rightPct;
          const leftColW = Math.max(140, (containerW * leftPct) / 100 - 8);

          const leftPages = parseBodyBlocks(extracted.args[0], ctx, mode, {
            ...opts,
            containerWidthPt: leftColW,
            baseFontSizePt: scopeFontSizePt,
            defaultLineSpacing: defaultLineSp,
          });
          const leftBlocks = leftPages.flat();

          if (leftBlocks.length > 0 && rightBlocks.length > 0) {
            pushBlock({
              block_type: 'table',
              alignment: 'left',
              table_borderless: true,
              table_style: 'borderless',
              font_size_pt: scopeFontSizePt,
              line_spacing: defaultLineSp,
              indent_left_pt: opts.indentLeftPt > 0 ? opts.indentLeftPt : undefined,
              table_rows: [
                [
                  {
                    segments: [],
                    blocks: leftBlocks,
                    alignment: 'left',
                    v_align: 'top',
                    width_pct: leftPct,
                  },
                  {
                    segments: [],
                    blocks: rightBlocks,
                    alignment: 'center',
                    v_align: 'top',
                    width_pct: rightPct,
                  },
                ],
              ],
            });
          } else {
            leftBlocks.forEach(pushBlock);
            rightBlocks.forEach(pushBlock);
          }

          i = extracted.endIdx;
          textStart = i;
          continue;
        }
      }

      // Consecutive side-by-side \parbox[pos]{width}{content}
      if (isOnlySpacesBeforeOnLine(src, i)) {
        const parboxRe = /^\\parbox(?:\s*\[([^\]]*)\])?(?:\s*\[[^\]]*\])*\s*\{([^}]*)\}\s*\{/;
        const pb0 = rest.match(parboxRe);
        if (pb0) {
          const collectedPbs: Array<{ widthPt: number; vAlign: 'top' | 'center' | 'bottom'; content: string }> = [];
          let scanPos = i;
          let lastEnd = i;
          while (scanPos < src.length) {
            const sub = src.slice(scanPos);
            const m = sub.match(parboxRe);
            if (!m) break;
            const br = readBalancedBraces(src, scanPos + m[0].length - 1);
            if (!br) break;
            const vPos = (m[1] ?? '').trim().toLowerCase();
            const vAlign: 'top' | 'center' | 'bottom' =
              vPos === 'c' ? 'center' : vPos === 'b' ? 'bottom' : 'top';
            const wPt = parseLatexLengthToPt(m[2], containerW, scopeFontSizePt) ?? containerW * 0.48;
            collectedPbs.push({ widthPt: wPt, vAlign, content: br.content });
            lastEnd = br.endIdx + 1;
            const gapM = src
              .slice(lastEnd)
              .match(/^(?:[ \t]|\\(?:hfill|quad|qquad|hspace\*?\{[^}]*\})|~|\n(?![ \t]*\n))*/);
            scanPos = lastEnd + (gapM ? gapM[0].length : 0);
          }
          if (collectedPbs.length >= 2) {
            flushTextSlice(i);
            const sumW = Math.max(1, collectedPbs.reduce((s, p) => s + p.widthPt, 0));
            const rowCells: TableCellData[] = collectedPbs.map((pb) => {
              const pct = Math.max(10, Math.round((pb.widthPt / sumW) * 1000) / 10);
              const colBlocks = parseBodyBlocks(pb.content, ctx, mode, {
                ...opts,
                indentLeftPt: 0,
                containerWidthPt: Math.max(100, pb.widthPt),
                baseFontSizePt: scopeFontSizePt,
                defaultLineSpacing: defaultLineSp,
              }).flat();
              return {
                segments: [],
                blocks: colBlocks,
                v_align: pb.vAlign,
                alignment: 'left',
                width_pct: pct,
              };
            });
            pushBlock({
              block_type: 'table',
              alignment: 'left',
              table_borderless: true,
              table_style: 'borderless',
              font_size_pt: scopeFontSizePt,
              line_spacing: defaultLineSp,
              indent_left_pt: opts.indentLeftPt > 0 ? opts.indentLeftPt : undefined,
              table_rows: [rowCells],
            });
            i = lastEnd;
            textStart = i;
            continue;
          }
        }
      }

      // \shortans[opts]{value} standalone in body
      const shortAnsBodyMatch = rest.match(/^\\shortans(?:\s*\[[^\]]*\])?\s*\{/);
      if (shortAnsBodyMatch) {
        const br = readBalancedBraces(src, i + shortAnsBodyMatch[0].length - 1);
        if (br) {
          flushTextSlice(i);
          const ansRaw = br.content.trim();
          if (ansRaw) {
            pushBlock({
              block_type: 'paragraph',
              alignment: 'right',
              font_size_pt: 12,
              line_spacing: 1.15,
              segments: [
                { type: 'text', content: 'Đáp án: ', bold: true, color: '#B91C1C' },
                ...parseInlineSegmentText(ansRaw, { bold: true, color: '#B91C1C' }, mode, ctx),
              ],
            });
          }
          i = br.endIdx + 1;
          textStart = i;
          continue;
        }
      }

      // \captionof{figure|table}{caption}
      const capOfMatch = rest.match(/^\\captionof\s*\{([^}]+)\}\s*(?:\[[^\]]*\])?\s*\{/);
      if (capOfMatch) {
        const br = readBalancedBraces(src, i + capOfMatch[0].length - 1);
        if (br) {
          flushTextSlice(i);
          const kind = capOfMatch[1].trim().toLowerCase();
          const isTbl = kind === 'table';
          const num = nextCounter(ctx, isTbl ? 'table' : 'figure');
          const prefix = isTbl
            ? ctx.isVietnamese
              ? `Bảng ${num}: `
              : `Table ${num}: `
            : ctx.isVietnamese
            ? `Hình ${num}: `
            : `Figure ${num}: `;
          ctx.lastNumberedTarget = String(num);
          ctx.lastNumberedKind = isTbl
            ? ctx.isVietnamese
              ? 'Bảng'
              : 'Table'
            : ctx.isVietnamese
            ? 'Hình'
            : 'Figure';
          pushBlock({
            block_type: 'paragraph',
            alignment: 'center',
            font_size_pt: 11,
            segments: [
              { type: 'text', content: prefix, bold: true, font_size_pt: 11 },
              ...parseInlineSegmentText(br.content, { font_size_pt: 11, italic: true }, mode, ctx),
            ],
          });
          i = br.endIdx + 1;
          textStart = i;
          continue;
        }
      }

      // Headings: \part, \chapter, \section, \subsection, \subsubsection, \paragraph, \subparagraph
      const secMatch = rest.match(
        /^\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)(\*)?\s*(?:\[[^\]]*\])?\s*\{/
      );
      if (secMatch) {
        const braceIdx = i + secMatch[0].length - 1;
        const br = readBalancedBraces(src, braceIdx);
        if (br) {
          flushTextSlice(i);
          const kind = secMatch[1];
          const starred = Boolean(secMatch[2]);
          let prefix = '';
          let level = 2;
          let sizePt = 13;

          if (kind === 'part' || kind === 'chapter') {
            level = 1;
            sizePt = 17;
            if (!starred && kind === 'chapter') {
              const chNum = nextCounter(ctx, 'chapter');
              ctx.sectionCount = 0;
              prefix = `${ctx.isVietnamese ? 'Chương' : 'Chapter'} ${chNum}. `;
              ctx.lastNumberedTarget = String(chNum);
              ctx.lastNumberedKind = ctx.isVietnamese ? 'Chương' : 'Chapter';
            } else if (!starred && kind === 'part') {
              const pNum = nextCounter(ctx, 'part');
              prefix = `${ctx.isVietnamese ? 'Phần' : 'Part'} ${toRoman(pNum)}. `;
              ctx.lastNumberedTarget = toRoman(pNum);
              ctx.lastNumberedKind = ctx.isVietnamese ? 'Phần' : 'Part';
            }
          } else if (kind === 'section') {
            level = 1;
            sizePt = 15;
            if (!starred) {
              ctx.sectionCount += 1;
              ctx.subsectionCount = 0;
              ctx.subsubsectionCount = 0;
              const sStr = formatSectionNum(ctx);
              prefix = `${sStr}. `;
              ctx.lastNumberedTarget = sStr;
              ctx.lastNumberedKind = ctx.isVietnamese ? 'Mục' : 'Section';
            }
          } else if (kind === 'subsection') {
            level = 2;
            sizePt = 13;
            if (!starred) {
              ctx.subsectionCount += 1;
              ctx.subsubsectionCount = 0;
              const sStr = `${formatSectionNum(ctx)}.${ctx.subsectionCount}`;
              prefix = `${sStr}. `;
              ctx.lastNumberedTarget = sStr;
              ctx.lastNumberedKind = ctx.isVietnamese ? 'Mục' : 'Section';
            }
          } else if (kind === 'subsubsection') {
            level = 3;
            sizePt = 12;
            if (!starred) {
              ctx.subsubsectionCount += 1;
              const sStr = `${formatSectionNum(ctx)}.${ctx.subsectionCount}.${ctx.subsubsectionCount}`;
              prefix = `${sStr}. `;
              ctx.lastNumberedTarget = sStr;
              ctx.lastNumberedKind = ctx.isVietnamese ? 'Mục' : 'Section';
            }
          } else {
            // paragraph / subparagraph
            level = 4;
            sizePt = 12;
          }

          const segs = parseInlineSegmentText(
            br.content,
            {
              bold: true,
              font_size_pt: sizePt,
              ...(scopeColor ? { color: scopeColor } : {}),
            },
            mode,
            ctx
          );
          if (prefix) {
            segs.unshift({
              type: 'text',
              content: prefix,
              bold: true,
              font_size_pt: sizePt,
              ...(scopeColor ? { color: scopeColor } : {}),
            });
          }
          pushBlock({
            block_type: 'heading',
            alignment: kind === 'part' || kind === 'chapter' ? 'center' : scopeAlign !== 'left' ? scopeAlign : 'left',
            heading_level: level,
            font_size_pt: sizePt,
            segments: segs,
          });
          i = br.endIdx + 1;
          textStart = i;
          continue;
        }
      }

      // Environments \begin{env} ... \end{env}
      const envBeginMatch = rest.match(/^\\begin\{([^}]+)\}/);
      if (envBeginMatch) {
        const envName = envBeginMatch[1].trim();
        const afterOpen = i + envBeginMatch[0].length;
        const endIdx = findMatchingEnvEnd(src, envName, afterOpen);
        if (endIdx !== -1) {
          const closeToken = `\\end{${envName}}`;
          const innerStart = afterOpen;
          const envRawBody = src.slice(innerStart, endIdx);

          if (DISPLAY_MATH_ENVS.has(envName)) {
            flushTextSlice(i);
            registerLabelsInMath(envRawBody, envName, ctx);
            const fullMath = src.slice(i, endIdx + closeToken.length).trim();
            pushBlock({
              block_type: 'equation',
              alignment: 'center',
              latex: normalizeMathContent(fullMath, ctx),
              font_size_pt: scopeFontSizePt,
              ...(scopeBold ? { bold: true } : {}),
              ...(scopeItalic ? { italic: true } : {}),
              ...(scopeColor ? { color: scopeColor } : {}),
            });
            i = endIdx + closeToken.length;
            textStart = i;
            continue;
          }

          if (envName === 'subequations') {
            flushTextSlice(i);
            const innerPages = parseBodyBlocks(envRawBody, ctx, mode, opts);
            innerPages.forEach((pg, pIdx) => {
              if (pIdx > 0) pushPageBreak();
              pg.forEach(pushBlock);
            });
            i = endIdx + closeToken.length;
            textStart = i;
            continue;
          }

          if (envName === 'verbatim' || envName === 'verbatim*' || envName === 'lstlisting' || envName === 'minted') {
            flushTextSlice(i);
            let codeBody = envRawBody;
            if (envName === 'lstlisting') {
              const trimmed = codeBody.trimStart();
              if (trimmed.startsWith('[')) {
                const brk = readBalancedBrackets(trimmed, 0);
                if (brk) codeBody = trimmed.slice(brk.endIdx + 1);
              }
            } else if (envName === 'minted') {
              let trimmed = codeBody.trimStart();
              if (trimmed.startsWith('[')) {
                const brk = readBalancedBrackets(trimmed, 0);
                if (brk) trimmed = trimmed.slice(brk.endIdx + 1).trimStart();
              }
              if (trimmed.startsWith('{')) {
                const langBr = readBalancedBraces(trimmed, 0);
                if (langBr) codeBody = trimmed.slice(langBr.endIdx + 1);
              }
            }
            const cleanCode = codeBody.replace(/^\n+|\n+$/g, '');
            if (cleanCode) {
              pushBlock({
                block_type: 'paragraph',
                alignment: 'left',
                font_size_pt: 10.5,
                line_spacing: 1.15,
                indent_left_pt: opts.indentLeftPt + 18,
                segments: [{ type: 'text', content: cleanCode, font_size_pt: 10.5 }],
              });
            }
            i = endIdx + closeToken.length;
            textStart = i;
            continue;
          }

          if (envName === 'figure' || envName === 'figure*' || envName === 'wrapfigure' || envName === 'subfigure') {
            flushTextSlice(i);
            let fBody = envRawBody.trimStart();
            if (envName === 'wrapfigure') {
              if (fBody.startsWith('{')) {
                const pBr = readBalancedBraces(fBody, 0);
                if (pBr) fBody = fBody.slice(pBr.endIdx + 1).trimStart();
              }
              if (fBody.startsWith('{')) {
                const wBr = readBalancedBraces(fBody, 0);
                if (wBr) fBody = fBody.slice(wBr.endIdx + 1).trimStart();
              }
            } else if (fBody.startsWith('[')) {
              const posBr = readBalancedBrackets(fBody, 0);
              if (posBr) fBody = fBody.slice(posBr.endIdx + 1).trimStart();
              if (envName === 'subfigure' && fBody.startsWith('{')) {
                const wBr = readBalancedBraces(fBody, 0);
                if (wBr) fBody = fBody.slice(wBr.endIdx + 1).trimStart();
              }
            }

            let captionContent: string | null = null;
            const capMatch = /\\caption\*?\s*(?:\[[^\]]*\]\s*)?\{/.exec(fBody);
            if (capMatch) {
              const capBr = readBalancedBraces(fBody, capMatch.index + capMatch[0].length - 1);
              if (capBr) {
                captionContent = capBr.content.trim();
                fBody = (fBody.slice(0, capMatch.index) + fBody.slice(capBr.endIdx + 1)).trim();
              }
            }

            const figNum = envName === 'subfigure' ? null : nextCounter(ctx, 'figure');
            if (figNum !== null) {
              ctx.lastNumberedTarget = String(figNum);
              ctx.lastNumberedKind = ctx.isVietnamese ? 'Hình' : 'Figure';
            }

            // Register any \label inside figure
            const figLabelMatch = /\\label\s*\{([^}]+)\}/.exec(fBody);
            if (figLabelMatch && figNum !== null) {
              ctx.labels[figLabelMatch[1].trim()] = String(figNum);
              ctx.labelKinds[figLabelMatch[1].trim()] = ctx.isVietnamese ? 'Hình' : 'Figure';
              fBody = fBody.replace(/\\label\s*\{[^}]+\}/g, '').trim();
            }

            const innerPages = parseBodyBlocks(fBody, ctx, mode, {
              ...opts,
              defaultAlign: 'center',
            });
            innerPages.forEach((pg, pIdx) => {
              if (pIdx > 0) pushPageBreak();
              pg.forEach(pushBlock);
            });

            if (captionContent && figNum !== null) {
              const capPrefix = ctx.isVietnamese ? `Hình ${figNum}: ` : `Figure ${figNum}: `;
              pushBlock({
                block_type: 'paragraph',
                alignment: 'center',
                font_size_pt: 11,
                segments: [
                  { type: 'text', content: capPrefix, bold: true, font_size_pt: 11 },
                  ...parseInlineSegmentText(captionContent, { font_size_pt: 11, italic: true }, mode, ctx),
                ],
              });
            }

            i = endIdx + closeToken.length;
            textStart = i;
            continue;
          }

          if (envName === 'table' || envName === 'table*') {
            flushTextSlice(i);
            let tBody = envRawBody.trimStart();
            if (tBody.startsWith('[')) {
              const posBr = readBalancedBrackets(tBody, 0);
              if (posBr) tBody = tBody.slice(posBr.endIdx + 1).trimStart();
            }

            let captionContent: string | null = null;
            const capMatch = /\\caption\*?\s*(?:\[[^\]]*\]\s*)?\{/.exec(tBody);
            if (capMatch) {
              const capBr = readBalancedBraces(tBody, capMatch.index + capMatch[0].length - 1);
              if (capBr) {
                captionContent = capBr.content.trim();
                tBody = (tBody.slice(0, capMatch.index) + tBody.slice(capBr.endIdx + 1)).trim();
              }
            }

            const tblNum = nextCounter(ctx, 'table');
            ctx.lastNumberedTarget = String(tblNum);
            ctx.lastNumberedKind = ctx.isVietnamese ? 'Bảng' : 'Table';

            const tblLabelMatch = /\\label\s*\{([^}]+)\}/.exec(tBody);
            if (tblLabelMatch) {
              ctx.labels[tblLabelMatch[1].trim()] = String(tblNum);
              ctx.labelKinds[tblLabelMatch[1].trim()] = ctx.isVietnamese ? 'Bảng' : 'Table';
              tBody = tBody.replace(/\\label\s*\{[^}]+\}/g, '').trim();
            }

            if (captionContent) {
              const capPrefix = ctx.isVietnamese ? `Bảng ${tblNum}: ` : `Table ${tblNum}: `;
              pushBlock({
                block_type: 'paragraph',
                alignment: 'center',
                font_size_pt: 11,
                segments: [
                  { type: 'text', content: capPrefix, bold: true, font_size_pt: 11 },
                  ...parseInlineSegmentText(captionContent, { font_size_pt: 11 }, mode, ctx),
                ],
              });
            }

            const innerPages = parseBodyBlocks(tBody, ctx, mode, {
              ...opts,
              defaultAlign: 'center',
            });
            innerPages.forEach((pg, pIdx) => {
              if (pIdx > 0) pushPageBreak();
              pg.forEach(pushBlock);
            });

            i = endIdx + closeToken.length;
            textStart = i;
            continue;
          }

          if (envName === 'tabular' || envName === 'tabular*' || envName === 'longtable' || envName === 'tabularx') {
            flushTextSlice(i);
            let pos = skipSpaces(envRawBody, 0);
            if (envName === 'tabular*' || envName === 'tabularx') {
              if (envRawBody[pos] === '{') {
                const widthBr = readBalancedBraces(envRawBody, pos);
                if (widthBr) pos = skipSpaces(envRawBody, widthBr.endIdx + 1);
              }
            }
            if (envRawBody[pos] === '[') {
              const optAlignBr = readBalancedBrackets(envRawBody, pos);
              if (optAlignBr) pos = skipSpaces(envRawBody, optAlignBr.endIdx + 1);
            }
            let colSpec = '';
            if (envRawBody[pos] === '{') {
              const specBr = readBalancedBraces(envRawBody, pos);
              if (specBr) {
                colSpec = specBr.content;
                pos = specBr.endIdx + 1;
              }
            }
            const tblBlock = parseTabularEnvironment(
              colSpec,
              envRawBody.slice(pos),
              mode,
              ctx,
              containerW,
              {
                alignment: scopeAlign,
                fontSizePt: scopeFontSizePt,
                bold: scopeBold,
                italic: scopeItalic,
                color: scopeColor,
              }
            );
            if (tblBlock) {
              if (opts.indentLeftPt > 0) tblBlock.indent_left_pt = opts.indentLeftPt;
              pushBlock(tblBlock);
            }
            i = endIdx + closeToken.length;
            textStart = i;
            continue;
          }

          if (envName === 'minipage') {
            flushTextSlice(i);

            const parseMinipageHeader = (rawBody: string) => {
              let pos = skipSpaces(rawBody, 0);
              let vAlign: 'top' | 'center' | 'bottom' = 'top';
              let optIdx = 0;
              while (rawBody[pos] === '[') {
                const optBr = readBalancedBrackets(rawBody, pos);
                if (!optBr) break;
                if (optIdx === 0) {
                  const v = optBr.content.trim().toLowerCase();
                  if (v === 'c') vAlign = 'center';
                  else if (v === 'b') vAlign = 'bottom';
                }
                optIdx++;
                pos = skipSpaces(rawBody, optBr.endIdx + 1);
              }
              let widthPt = containerW;
              if (rawBody[pos] === '{') {
                const widthBr = readBalancedBraces(rawBody, pos);
                if (widthBr) {
                  widthPt = parseLatexLengthToPt(widthBr.content, containerW, scopeFontSizePt) ?? containerW;
                  pos = widthBr.endIdx + 1;
                }
              }
              return { vAlign, widthPt, innerBody: rawBody.slice(pos) };
            };

            const minipages: Array<{
              vAlign: 'top' | 'center' | 'bottom';
              widthPt: number;
              innerBody: string;
            }> = [parseMinipageHeader(envRawBody)];

            let cursorEnd = endIdx + closeToken.length;
            while (cursorEnd < src.length) {
              const gapMatch = src
                .slice(cursorEnd)
                .match(/^(?:[ \t]|\\(?:hfill|quad|qquad|hspace\*?\{[^}]*\})|~|\n(?![ \t]*\n))*/);
              const nextScanStart = cursorEnd + (gapMatch ? gapMatch[0].length : 0);
              const nextMpOpen = src.slice(nextScanStart).match(/^\\begin\{minipage\}/);
              if (!nextMpOpen) break;
              const nextAfterOpen = nextScanStart + nextMpOpen[0].length;
              const nextEndIdx = findMatchingEnvEnd(src, 'minipage', nextAfterOpen);
              if (nextEndIdx === -1) break;
              const parsedNext = parseMinipageHeader(src.slice(nextAfterOpen, nextEndIdx));
              // Stop if accumulated widths clearly wrap onto the next line (> 108% of container width)
              const accWidth = minipages.reduce((s, mp) => s + mp.widthPt, 0) + parsedNext.widthPt;
              if (minipages.length >= 1 && accWidth > containerW * 1.08 && minipages.length >= 2) {
                break;
              }
              minipages.push(parsedNext);
              cursorEnd = nextEndIdx + '\\end{minipage}'.length;
            }

            if (minipages.length >= 2) {
              const totalMpWidth = Math.max(1, minipages.reduce((s, mp) => s + mp.widthPt, 0));
              const rowCells: TableCellData[] = minipages.map((mp) => {
                const pct = Math.max(10, Math.round((mp.widthPt / totalMpWidth) * 1000) / 10);
                const colBlocks = parseBodyBlocks(mp.innerBody, ctx, mode, {
                  ...opts,
                  indentLeftPt: 0,
                  containerWidthPt: Math.max(100, mp.widthPt),
                  baseFontSizePt: scopeFontSizePt,
                  defaultLineSpacing: defaultLineSp,
                }).flat();
                return {
                  segments: [],
                  blocks: colBlocks,
                  v_align: mp.vAlign,
                  alignment: 'left',
                  width_pct: pct,
                };
              });
              pushBlock({
                block_type: 'table',
                alignment: 'left',
                table_borderless: true,
                table_style: 'borderless',
                font_size_pt: scopeFontSizePt,
                line_spacing: defaultLineSp,
                indent_left_pt: opts.indentLeftPt > 0 ? opts.indentLeftPt : undefined,
                table_rows: [rowCells],
              });
            } else {
              const innerPages = parseBodyBlocks(minipages[0].innerBody, ctx, mode, {
                ...opts,
                containerWidthPt: Math.max(120, minipages[0].widthPt),
                baseFontSizePt: scopeFontSizePt,
                defaultLineSpacing: defaultLineSp,
              });
              innerPages.forEach((pg, pIdx) => {
                if (pIdx > 0) pushPageBreak();
                pg.forEach(pushBlock);
              });
            }

            i = cursorEnd;
            textStart = i;
            continue;
          }

          if (envName === 'center' || envName === 'flushleft' || envName === 'flushright') {
            flushTextSlice(i);
            const childAlign: BlockAlignment =
              envName === 'center' ? 'center' : envName === 'flushright' ? 'right' : 'left';
            const childPages = parseBodyBlocks(envRawBody, ctx, mode, {
              ...opts,
              defaultAlign: childAlign,
              containerWidthPt: containerW,
              baseFontSizePt: scopeFontSizePt,
              defaultLineSpacing: defaultLineSp,
            });
            childPages.forEach((pg, pIdx) => {
              if (pIdx > 0) pushPageBreak();
              pg.forEach(pushBlock);
            });
            i = endIdx + closeToken.length;
            textStart = i;
            continue;
          }

          if (
            envName === 'tcolorbox' ||
            envName === 'framed' ||
            envName === 'mdframed' ||
            envName === 'shaded'
          ) {
            flushTextSlice(i);
            let boxBody = envRawBody.trimStart();
            let boxTitle = '';
            let colBackHex = envName === 'shaded' ? '#F1F5F9' : envName === 'tcolorbox' ? '#F8FAFC' : '#FFFFFF';
            let colFrameHex = envName === 'shaded' ? '' : '#334155';
            let colBackTitleHex = '#334155';
            let colTitleHex = '#FFFFFF';
            let colTextHex: string | undefined = scopeColor;

            if ((envName === 'tcolorbox' || envName === 'mdframed') && boxBody.startsWith('[')) {
              const optBr = readBalancedBrackets(boxBody, 0);
              if (optBr) {
                const optStr = optBr.content;
                boxTitle = extractBalancedKeyValOption(optStr, 'title') ?? '';

                const cbVal =
                  extractBalancedKeyValOption(optStr, 'colback') ??
                  extractBalancedKeyValOption(optStr, 'backgroundcolor');
                if (cbVal) colBackHex = resolveLatexColor(cbVal, ctx.customColors) ?? colBackHex;

                const cfVal =
                  extractBalancedKeyValOption(optStr, 'colframe') ??
                  extractBalancedKeyValOption(optStr, 'linecolor');
                if (cfVal) colFrameHex = resolveLatexColor(cfVal, ctx.customColors) ?? colFrameHex;

                const cbtVal = extractBalancedKeyValOption(optStr, 'colbacktitle');
                if (cbtVal) {
                  colBackTitleHex = resolveLatexColor(cbtVal, ctx.customColors) ?? colBackTitleHex;
                } else if (cfVal && colFrameHex) {
                  colBackTitleHex = colFrameHex;
                }

                const ctVal = extractBalancedKeyValOption(optStr, 'coltitle');
                if (ctVal) colTitleHex = resolveLatexColor(ctVal, ctx.customColors) ?? colTitleHex;

                const ctxtVal = extractBalancedKeyValOption(optStr, 'coltext');
                if (ctxtVal) {
                  const resolvedCtxt = resolveLatexColor(ctxtVal, ctx.customColors);
                  if (isBlackLatexColor(ctxtVal, resolvedCtxt)) colTextHex = undefined;
                  else if (resolvedCtxt) colTextHex = resolvedCtxt;
                }

                boxBody = boxBody.slice(optBr.endIdx + 1);
              }
            }

            const childBlocks = parseBodyBlocks(boxBody, ctx, mode, {
              ...opts,
              defaultAlign: 'justify',
              indentLeftPt: 0,
              containerWidthPt: Math.max(140, containerW - 24),
              baseFontSizePt: scopeFontSizePt,
              defaultLineSpacing: defaultLineSp,
              defaultBold: scopeBold,
              defaultItalic: scopeItalic,
              defaultColor: colTextHex,
            }).flat();

            const boxRows: TableCellData[][] = [];
            if (boxTitle) {
              boxRows.push([
                {
                  segments: parseInlineSegmentText(
                    boxTitle,
                    { bold: true, color: colTitleHex },
                    mode,
                    ctx
                  ),
                  alignment: 'left',
                  is_header: true,
                  fill_color: colBackTitleHex,
                  border_color: colFrameHex || undefined,
                  border_top: Boolean(colFrameHex),
                  border_bottom: Boolean(colFrameHex),
                  border_left: Boolean(colFrameHex),
                  border_right: Boolean(colFrameHex),
                  width_pct: 100,
                },
              ]);
            }
            boxRows.push([
              {
                segments: [],
                blocks:
                  childBlocks.length > 0
                    ? childBlocks
                    : [{ block_type: 'paragraph', alignment: 'left', segments: [] }],
                alignment: 'left',
                v_align: 'top',
                fill_color: colBackHex,
                border_color: colFrameHex || undefined,
                border_top: Boolean(colFrameHex),
                border_bottom: Boolean(colFrameHex),
                border_left: Boolean(colFrameHex),
                border_right: Boolean(colFrameHex),
                width_pct: 100,
              },
            ]);

            pushBlock({
              block_type: 'table',
              alignment: 'left',
              table_borderless: !colFrameHex,
              table_style: 'box',
              font_size_pt: scopeFontSizePt,
              line_spacing: defaultLineSp,
              indent_left_pt: opts.indentLeftPt > 0 ? opts.indentLeftPt : undefined,
              table_rows: boxRows,
            });
            i = endIdx + closeToken.length;
            textStart = i;
            continue;
          }

          if (envName === 'quote' || envName === 'quotation' || envName === 'abstract') {
            flushTextSlice(i);
            if (envName === 'abstract') {
              pushBlock({
                block_type: 'heading',
                alignment: 'center',
                heading_level: 3,
                font_size_pt: scopeFontSizePt,
                segments: [
                  {
                    type: 'text',
                    content: ctx.isVietnamese ? 'Tóm tắt' : 'Abstract',
                    bold: true,
                    font_size_pt: scopeFontSizePt,
                    ...(scopeColor ? { color: scopeColor } : {}),
                  },
                ],
              });
            }
            const childPages = parseBodyBlocks(envRawBody, ctx, mode, {
              ...opts,
              defaultAlign: 'justify',
              indentLeftPt: opts.indentLeftPt + 24,
              containerWidthPt: Math.max(140, containerW - 48),
              baseFontSizePt: scopeFontSizePt,
              defaultLineSpacing: defaultLineSp,
              defaultColor: scopeColor,
            });
            childPages.forEach((pg, pIdx) => {
              if (pIdx > 0) pushPageBreak();
              pg.forEach(pushBlock);
            });
            i = endIdx + closeToken.length;
            textStart = i;
            continue;
          }

          if (envName === 'enumerate*' || envName === 'inparaenum') {
            flushTextSlice(i);
            let listBody = envRawBody.trimStart();
            let enumLabelOpt: string | undefined;
            if (listBody.startsWith('[')) {
              const optBr = readBalancedBrackets(listBody, 0);
              if (optBr) {
                const rawOpt = optBr.content.trim();
                const lblVal = extractBalancedKeyValOption(rawOpt, 'label');
                if (lblVal) {
                  enumLabelOpt = lblVal;
                } else if (/^[aAiI1][.)]?$|^\([aAiI1]\)$/.test(rawOpt)) {
                  enumLabelOpt = rawOpt
                    .replace(/a/g, '\\alph*')
                    .replace(/A/g, '\\Alph*')
                    .replace(/i/g, '\\roman*')
                    .replace(/I/g, '\\Roman*')
                    .replace(/1/g, '\\arabic*');
                }
                listBody = listBody.slice(optBr.endIdx + 1);
              }
            }
            const items = splitListItems(listBody);
            if (items.length > 0) {
              const itemBaseStyle: InlineStyle = {
                ...(scopeBold ? { bold: true } : {}),
                ...(scopeItalic ? { italic: true } : {}),
                ...(scopeFontSizePt !== 12 ? { font_size_pt: scopeFontSizePt } : {}),
                ...(scopeColor ? { color: scopeColor } : {}),
              };
              const isChoiceLike =
                items.length >= 2 &&
                items.length <= 4 &&
                ((enumLabelOpt && /\\(?:Alph|alph)\*/.test(enumLabelOpt)) ||
                  items.every((_, idx) => {
                    const b = expandEnumPattern(enumLabelOpt, envName, opts.listDepth + 1, idx, items[idx].customLabel).trim();
                    return /^(?:[A-D]\.|[a-d]\))$/.test(b);
                  }));

              if (isChoiceLike) {
                const pct = Math.round((100 / items.length) * 10) / 10;
                const rowCells: TableCellData[] = items.map((item, itemIdx) => ({
                  segments: [
                    ...buildEnumBulletSegments(
                      enumLabelOpt,
                      envName,
                      opts.listDepth + 1,
                      itemIdx,
                      item.customLabel,
                      itemBaseStyle,
                      mode,
                      ctx
                    ),
                    ...parseInlineSegmentText(item.content, itemBaseStyle, mode, ctx),
                  ],
                  alignment: 'left',
                  width_pct: pct,
                }));
                pushBlock({
                  block_type: 'table',
                  alignment: 'left',
                  table_borderless: true,
                  is_choice_block: true,
                  font_size_pt: scopeFontSizePt,
                  line_spacing: defaultLineSp,
                  indent_left_pt: opts.indentLeftPt > 0 ? opts.indentLeftPt : undefined,
                  table_rows: [rowCells],
                });
              } else {
                const joinedSegs: InlineSegment[] = [];
                items.forEach((item, itemIdx) => {
                  if (itemIdx > 0) joinedSegs.push({ type: 'text', content: '   ', ...itemBaseStyle });
                  joinedSegs.push(
                    ...buildEnumBulletSegments(
                      enumLabelOpt,
                      envName,
                      opts.listDepth + 1,
                      itemIdx,
                      item.customLabel,
                      itemBaseStyle,
                      mode,
                      ctx
                    ),
                    ...parseInlineSegmentText(item.content, itemBaseStyle, mode, ctx)
                  );
                });
                pushBlock({
                  block_type: 'paragraph',
                  alignment: scopeAlign,
                  font_size_pt: scopeFontSizePt,
                  line_spacing: defaultLineSp,
                  indent_left_pt: opts.indentLeftPt > 0 ? opts.indentLeftPt : undefined,
                  segments: joinedSegs,
                });
              }
            }
            i = endIdx + closeToken.length;
            textStart = i;
            continue;
          }

          if (
            envName === 'enumerate' ||
            envName === 'itemize' ||
            envName === 'itemchoice' ||
            envName === 'description'
          ) {
            flushTextSlice(i);
            let listBody = envRawBody.trimStart();
            let enumLabelOpt: string | undefined;
            if (listBody.startsWith('[')) {
              const optBr = readBalancedBrackets(listBody, 0);
              if (optBr) {
                const rawOpt = optBr.content.trim();
                const lblVal = extractBalancedKeyValOption(rawOpt, 'label');
                if (lblVal) {
                  enumLabelOpt = lblVal;
                } else if (/^[aAiI1][.)]?$|^\([aAiI1]\)$/.test(rawOpt)) {
                  enumLabelOpt = rawOpt
                    .replace(/a/g, '\\alph*')
                    .replace(/A/g, '\\Alph*')
                    .replace(/i/g, '\\roman*')
                    .replace(/I/g, '\\Roman*')
                    .replace(/1/g, '\\arabic*');
                }
                listBody = listBody.slice(optBr.endIdx + 1);
              }
            }
            const items = splitListItems(listBody);
            const nextDepth = opts.listDepth + 1;
            const listIndentPt = opts.indentLeftPt + 20;
            const bulletBaseStyle: InlineStyle = {
              ...(scopeFontSizePt !== 12 ? { font_size_pt: scopeFontSizePt } : {}),
              ...(scopeColor ? { color: scopeColor } : {}),
            };

            items.forEach((item, itemIdx) => {
              const bulletSegs =
                envName === 'description'
                  ? buildEnumBulletSegments(
                      undefined,
                      envName,
                      nextDepth,
                      itemIdx,
                      item.customLabel ?? '•',
                      bulletBaseStyle,
                      mode,
                      ctx
                    )
                  : buildEnumBulletSegments(
                      enumLabelOpt,
                      envName,
                      nextDepth,
                      itemIdx,
                      item.customLabel,
                      bulletBaseStyle,
                      mode,
                      ctx
                    );

              const itemPages = parseBodyBlocks(item.content, ctx, mode, {
                ...opts,
                listDepth: nextDepth,
                indentLeftPt: listIndentPt,
                baseFontSizePt: scopeFontSizePt,
                defaultLineSpacing: defaultLineSp,
                defaultBold: scopeBold,
                defaultItalic: scopeItalic,
                defaultColor: scopeColor,
              });
              const flat = itemPages.flat();
              if (flat.length > 0 && flat[0].block_type === 'paragraph' && flat[0].segments) {
                flat[0].first_line_indent_pt = -16;
                flat[0].segments = [...bulletSegs, ...flat[0].segments];
              } else {
                pushBlock({
                  block_type: 'paragraph',
                  alignment: 'left',
                  font_size_pt: scopeFontSizePt,
                  indent_left_pt: listIndentPt,
                  first_line_indent_pt: -16,
                  segments: bulletSegs,
                });
              }
              flat.forEach(pushBlock);
            });
            i = endIdx + closeToken.length;
            textStart = i;
            continue;
          }

          if (envName === 'thebibliography') {
            flushTextSlice(i);
            let bibBody = envRawBody.trimStart();
            if (bibBody.startsWith('{')) {
              const widthBr = readBalancedBraces(bibBody, 0);
              if (widthBr) bibBody = bibBody.slice(widthBr.endIdx + 1);
            }

            pushBlock({
              block_type: 'heading',
              alignment: 'left',
              heading_level: 1,
              font_size_pt: 15,
              segments: [
                {
                  type: 'text',
                  content: ctx.isVietnamese ? 'Tài liệu tham khảo' : 'References',
                  bold: true,
                  font_size_pt: 15,
                },
              ],
            });

            const bibRe = /\\bibitem(?:\[([^\]]*)\])?\s*\{([^}]+)\}/g;
            const entries: Array<{ label: string; key: string; contentStart: number; matchStart: number }> = [];
            let bm: RegExpExecArray | null;
            while ((bm = bibRe.exec(bibBody)) !== null) {
              const idxNum = entries.length + 1;
              const lbl = bm[1]?.trim() || String(idxNum);
              const key = bm[2].trim();
              ctx.cites[key] = lbl;
              entries.push({
                label: lbl,
                key,
                contentStart: bm.index + bm[0].length,
                matchStart: bm.index,
              });
            }

            for (let eIdx = 0; eIdx < entries.length; eIdx++) {
              const ent = entries[eIdx];
              const contentEnd = eIdx + 1 < entries.length ? entries[eIdx + 1].matchStart : bibBody.length;
              const entContent = bibBody.slice(ent.contentStart, contentEnd).trim();
              const entPages = parseBodyBlocks(entContent, ctx, mode, {
                ...opts,
                indentLeftPt: opts.indentLeftPt + 22,
              });
              const flat = entPages.flat();
              const bullet = `[${ent.label}] `;
              if (flat.length > 0 && flat[0].block_type === 'paragraph' && flat[0].segments) {
                flat[0].first_line_indent_pt = -22;
                flat[0].segments = [
                  { type: 'text', content: bullet, bold: true },
                  ...flat[0].segments,
                ];
              }
              flat.forEach(pushBlock);
            }

            i = endIdx + closeToken.length;
            textStart = i;
            continue;
          }

          if (envName === 'ex' || envName === 'bt' || envName === 'vd') {
            flushTextSlice(i);
            const exBlocks = parseExEnvironment(envRawBody, envName, ctx, mode, {
              ...opts,
              containerWidthPt: containerW,
              baseFontSizePt: scopeFontSizePt,
              defaultLineSpacing: defaultLineSp,
              defaultColor: scopeColor,
            });
            exBlocks.forEach(pushBlock);
            i = endIdx + closeToken.length;
            textStart = i;
            continue;
          }

          const customThm = ctx.customTheorems[envName];
          const builtinTheoremMap: Record<string, { vi: string; en: string }> = {
            theorem: { vi: 'Định lý', en: 'Theorem' },
            dinhly: { vi: 'Định lý', en: 'Định lý' },
            lemma: { vi: 'Bổ đề', en: 'Lemma' },
            bode: { vi: 'Bổ đề', en: 'Bổ đề' },
            definition: { vi: 'Định nghĩa', en: 'Definition' },
            dinhnghia: { vi: 'Định nghĩa', en: 'Định nghĩa' },
            corollary: { vi: 'Hệ quả', en: 'Corollary' },
            hequa: { vi: 'Hệ quả', en: 'Hệ quả' },
            proposition: { vi: 'Mệnh đề', en: 'Proposition' },
            menhde: { vi: 'Mệnh đề', en: 'Mệnh đề' },
            remark: { vi: 'Nhận xét', en: 'Remark' },
            nhanxet: { vi: 'Nhận xét', en: 'Nhận xét' },
            example: { vi: 'Ví dụ', en: 'Example' },
            note: { vi: 'Chú ý', en: 'Note' },
            axiom: { vi: 'Tiên đề', en: 'Axiom' },
            conjecture: { vi: 'Giả thuyết', en: 'Conjecture' },
            proof: { vi: 'Chứng minh', en: 'Proof' },
          };

          if (builtinTheoremMap[envName] || customThm) {
            flushTextSlice(i);
            const isProof = envName === 'proof';
            let bodyTrimmed = envRawBody.trimStart();
            let optTitle = '';
            if (bodyTrimmed.startsWith('[')) {
              const optBr = readBalancedBrackets(bodyTrimmed, 0);
              if (optBr) {
                optTitle = ` (${optBr.content.trim()})`;
                bodyTrimmed = bodyTrimmed.slice(optBr.endIdx + 1);
              }
            }

            const baseTitle = customThm
              ? customThm.title
              : ctx.isVietnamese
              ? builtinTheoremMap[envName].vi
              : builtinTheoremMap[envName].en;

            let label: string;
            if (isProof) {
              label = `${baseTitle}${optTitle}. `;
            } else if (customThm?.unnumbered) {
              label = `${baseTitle}${optTitle}. `;
            } else {
              const counterKey = customThm?.sharedCounter || envName;
              const num = nextCounter(ctx, counterKey);
              ctx.lastNumberedTarget = String(num);
              ctx.lastNumberedKind = baseTitle;
              label = `${baseTitle} ${num}${optTitle}. `;
            }

            const innerPages = parseBodyBlocks(bodyTrimmed, ctx, mode, {
              ...opts,
              defaultAlign: 'justify',
              baseFontSizePt: scopeFontSizePt,
              defaultLineSpacing: defaultLineSp,
              defaultColor: scopeColor,
            });
            const flat = innerPages.flat();
            if (flat.length > 0 && flat[0].block_type === 'paragraph' && flat[0].segments) {
              if (!isProof) {
                flat[0].segments = flat[0].segments.map((seg) =>
                  seg.type === 'text' ? { ...seg, italic: true } : seg
                );
              }
              flat[0].segments = [
                {
                  type: 'text',
                  content: label,
                  bold: !isProof,
                  italic: isProof,
                },
                ...flat[0].segments,
              ];
            } else {
              flat.unshift({
                block_type: 'paragraph',
                alignment: 'left',
                font_size_pt: 12,
                segments: [
                  {
                    type: 'text',
                    content: label.trim(),
                    bold: !isProof,
                    italic: isProof,
                  },
                ],
              });
            }
            if (isProof && flat.length > 0) {
              const lastBlk = flat[flat.length - 1];
              if (lastBlk.block_type === 'paragraph' && lastBlk.segments) {
                lastBlk.segments.push({ type: 'text', content: '  □' });
              }
            }
            flat.forEach(pushBlock);
            i = endIdx + closeToken.length;
            textStart = i;
            continue;
          }

          if (envName === 'multicols') {
            flushTextSlice(i);
            let mBody = envRawBody.trimStart();
            let cols = 2;
            if (mBody.startsWith('{')) {
              const colBr = readBalancedBraces(mBody, 0);
              if (colBr) {
                cols = Math.max(2, Math.min(4, parseInt(colBr.content.trim(), 10) || 2));
                mBody = mBody.slice(colBr.endIdx + 1);
              }
            }
            const colWidthPt = Math.max(100, containerW / cols - 8);
            const colParseOpts: BlockParseOptions = {
              ...opts,
              indentLeftPt: 0,
              containerWidthPt: colWidthPt,
              baseFontSizePt: scopeFontSizePt,
              defaultLineSpacing: defaultLineSp,
            };
            const explicitColParts = mBody.split(/\\columnbreak(?![a-zA-Z])\s*/);
            let columnsBlocks: DocumentBlock[][];

            if (explicitColParts.length >= 2) {
              columnsBlocks = explicitColParts
                .slice(0, cols)
                .map((part) => parseBodyBlocks(part, ctx, mode, colParseOpts).flat());
              while (columnsBlocks.length < cols) columnsBlocks.push([]);
            } else {
              const innerBlocks = parseBodyBlocks(mBody, ctx, mode, colParseOpts).flat();
              const estimateWeight = (b: DocumentBlock): number => {
                if (b.block_type === 'figure') return Math.max(4, (b.croppedHeightPx ?? 160) / 28);
                if (b.block_type === 'equation') return 3.2;
                if (b.block_type === 'table') return (b.table_rows?.length ?? 1) * 2.2;
                const txtLen = (b.segments ?? []).reduce((s, seg) => s + (seg.content?.length ?? 0), 0);
                return Math.max(1.5, Math.ceil(txtLen / 45));
              };
              const weights = innerBlocks.map(estimateWeight);
              const totalWeight = weights.reduce((a, b) => a + b, 0);
              const targetPerCol = totalWeight / cols;
              columnsBlocks = Array.from({ length: cols }, () => []);
              let curCol = 0;
              let curW = 0;
              innerBlocks.forEach((blk, idx) => {
                if (
                  curCol < cols - 1 &&
                  columnsBlocks[curCol].length > 0 &&
                  curW + weights[idx] * 0.5 > targetPerCol
                ) {
                  curCol++;
                  curW = 0;
                }
                columnsBlocks[curCol].push(blk);
                curW += weights[idx];
              });
            }

            if (columnsBlocks.some((col) => col.length > 0)) {
              const pct = Math.round((100 / cols) * 10) / 10;
              const rowCells: TableCellData[] = columnsBlocks.map((colBlks) => ({
                segments: [],
                blocks: colBlks,
                alignment: 'left',
                v_align: 'top',
                width_pct: pct,
              }));
              pushBlock({
                block_type: 'table',
                alignment: 'left',
                table_borderless: true,
                table_style: 'borderless',
                font_size_pt: scopeFontSizePt,
                line_spacing: defaultLineSp,
                indent_left_pt: opts.indentLeftPt > 0 ? opts.indentLeftPt : undefined,
                table_rows: [rowCells],
              });
            }
            i = endIdx + closeToken.length;
            textStart = i;
            continue;
          }

          if (envName === 'tikzpicture' || envName === 'pgfpicture' || envName === 'picture') {
            flushTextSlice(i);
            const rendered = renderLatexPictureToSvgDataUrl(
              envName,
              envRawBody,
              ctx.customColors,
              ctx.customTikzStyles
            );
            if (rendered) {
              pushBlock({
                block_type: 'figure',
                alignment:
                  opts.defaultAlign === 'left' || opts.defaultAlign === 'right'
                    ? opts.defaultAlign
                    : 'center',
                croppedImageDataUrl: rendered.dataUrl,
                croppedWidthPx: rendered.widthPx,
                croppedHeightPx: rendered.heightPx,
              });
            } else {
              pushBlock({
                block_type: 'paragraph',
                alignment: 'center',
                font_size_pt: 11,
                segments: [
                  {
                    type: 'text',
                    content: ctx.isVietnamese ? '[Hình vẽ minh họa (TikZ)]' : '[Illustration (TikZ)]',
                    italic: true,
                    color: '#475569',
                    font_size_pt: 11,
                  },
                ],
              });
            }
            i = endIdx + closeToken.length;
            textStart = i;
            continue;
          }

          if (envName === 'tasks') {
            flushTextSlice(i);
            let tBody = envRawBody.trimStart();
            let cols = 2;
            let hasExplicitCols = false;
            let tasksLabelOpt: string | undefined = ctx.defaultTasksLabel;
            if (tBody.startsWith('[')) {
              const optBr = readBalancedBrackets(tBody, 0);
              if (optBr) {
                const lblVal = extractBalancedKeyValOption(optBr.content, 'label');
                if (lblVal) tasksLabelOpt = lblVal;
                tBody = tBody.slice(optBr.endIdx + 1).trimStart();
              }
            }
            const colParenM = tBody.match(/^\((\d+)\)/);
            if (colParenM) {
              cols = Math.max(1, Math.min(4, parseInt(colParenM[1], 10) || 2));
              hasExplicitCols = true;
              tBody = tBody.slice(colParenM[0].length);
            }
            const effectiveLabelOpt = tasksLabelOpt ?? '\\alph*)';
            const isChoiceTasks =
              /\\(?:Alph|alph)\*/.test(effectiveLabelOpt) ||
              effectiveLabelOpt === '\\alph*)';

            const taskParts = tBody.split(/\\task\*?(?:\[[^\]]*\])?(?![a-zA-Z])\s*/).slice(1);
            if (taskParts.length > 0) {
              const rows: TableCellData[][] = [];
              let currentRow: TableCellData[] = [];
              const pct = Math.round((100 / cols) * 10) / 10;
              const taskBaseStyle: InlineStyle = {
                ...(scopeBold ? { bold: true } : {}),
                ...(scopeItalic ? { italic: true } : {}),
                ...(scopeFontSizePt !== 12 ? { font_size_pt: scopeFontSizePt } : {}),
                ...(scopeColor ? { color: scopeColor } : {}),
              };
              taskParts.forEach((tp, idx) => {
                const lblSegs = buildEnumBulletSegments(
                  effectiveLabelOpt,
                  'enumerate',
                  1,
                  idx,
                  undefined,
                  taskBaseStyle,
                  mode,
                  ctx
                );
                currentRow.push({
                  segments: [
                    ...lblSegs,
                    ...parseInlineSegmentText(tp.trim(), taskBaseStyle, mode, ctx),
                  ],
                  alignment: 'left',
                  width_pct: pct,
                });
                if (currentRow.length === cols) {
                  rows.push(currentRow);
                  currentRow = [];
                }
              });
              if (currentRow.length > 0) {
                while (currentRow.length < cols) {
                  currentRow.push({ segments: [], alignment: 'left', width_pct: pct });
                }
                rows.push(currentRow);
              }
              pushBlock({
                block_type: 'table',
                alignment: 'left',
                table_borderless: true,
                ...(isChoiceTasks ? { is_choice_block: true, preserve_col_count: hasExplicitCols } : {}),
                font_size_pt: scopeFontSizePt,
                line_spacing: defaultLineSp,
                indent_left_pt: opts.indentLeftPt > 0 ? opts.indentLeftPt : undefined,
                table_rows: rows,
              });
            }
            i = endIdx + closeToken.length;
            textStart = i;
            continue;
          }

          if (envName === 'tabbing') {
            flushTextSlice(i);
            const normalizedTabbingBody = envRawBody.replace(/\\kill(?![a-zA-Z])[ \t]*\n?/g, '\x00KILL\x00\\\\');
            const rawLines = splitTopLevelDoubleBackslash(normalizedTabbingBody);
            let rulerWidths: number[] | null = null;
            const parsedLines: string[][] = [];
            for (const rawLine of rawLines) {
              const isKill = rawLine.includes('\x00KILL\x00');
              const cleaned = rawLine
                .replace(/\x00KILL\x00/g, '')
                .replace(/\\(?:pushtabs|poptabs)(?![a-zA-Z])\s*/g, '')
                .replace(/\\[+-](?![a-zA-Z])/g, '');
              if (!cleaned.trim()) continue;
              const cols = cleaned.split(/\\(?:=|>)\\?/);
              if (isKill) {
                rulerWidths = cols.map((c) => {
                  let extraPt = 0;
                  const hsRe = /\\hspace\*?\s*\{([^}]+)\}/g;
                  let hm: RegExpExecArray | null;
                  while ((hm = hsRe.exec(c)) !== null) {
                    const pt = parseLatexLengthToPt(hm[1], containerW, scopeFontSizePt);
                    if (pt && pt > 0) extraPt += pt;
                  }
                  const plainLen = c
                    .replace(/\\hspace\*?\s*\{[^}]+\}/g, '')
                    .replace(/\\[a-zA-Z]+\*?|\$|\{|\}/g, '')
                    .trim().length;
                  return Math.max(24, plainLen * scopeFontSizePt * 0.55 + extraPt);
                });
                continue;
              }
              parsedLines.push(cols);
            }
            if (parsedLines.length > 0) {
              const maxCols = Math.max(...parsedLines.map((r) => r.length), 1);
              const totalRulerW = rulerWidths && rulerWidths.length >= maxCols
                ? rulerWidths.slice(0, maxCols).reduce((a, b) => a + b, 0) || 1
                : 0;
              const tabBaseStyle: InlineStyle = {
                ...(scopeBold ? { bold: true } : {}),
                ...(scopeItalic ? { italic: true } : {}),
                ...(scopeFontSizePt !== 12 ? { font_size_pt: scopeFontSizePt } : {}),
                ...(scopeColor ? { color: scopeColor } : {}),
              };
              const tableRows: TableCellData[][] = parsedLines.map((rowCols) =>
                Array.from({ length: maxCols }, (_, colIdx) => {
                  const pct =
                    totalRulerW > 0 && rulerWidths?.[colIdx]
                      ? Math.round((rulerWidths[colIdx] / totalRulerW) * 1000) / 10
                      : Math.round((100 / maxCols) * 10) / 10;
                  return {
                    segments: parseInlineSegmentText((rowCols[colIdx] ?? '').trim(), tabBaseStyle, mode, ctx),
                    alignment: 'left',
                    v_align: 'top',
                    width_pct: pct,
                  };
                })
              );
              pushBlock({
                block_type: 'table',
                alignment: 'left',
                table_borderless: true,
                table_style: 'borderless',
                font_size_pt: scopeFontSizePt,
                line_spacing: defaultLineSp,
                indent_left_pt: opts.indentLeftPt > 0 ? opts.indentLeftPt : undefined,
                table_rows: tableRows,
              });
            }
            i = endIdx + closeToken.length;
            textStart = i;
            continue;
          }

          if (
            FONT_SIZE_PT_MAP[envName] ||
            envName === 'bfseries' ||
            envName === 'itshape' ||
            envName === 'em' ||
            envName === 'mdseries' ||
            envName === 'upshape' ||
            envName === 'rmfamily' ||
            envName === 'sffamily' ||
            envName === 'ttfamily'
          ) {
            flushTextSlice(i);
            const innerPages = parseBodyBlocks(envRawBody, ctx, mode, {
              ...opts,
              defaultAlign: scopeAlign,
              containerWidthPt: containerW,
              baseFontSizePt: FONT_SIZE_PT_MAP[envName]
                ? envName === 'normalsize'
                  ? baseFontPt
                  : FONT_SIZE_PT_MAP[envName]
                : scopeFontSizePt,
              defaultLineSpacing: defaultLineSp,
              defaultBold:
                envName === 'bfseries' ? true : envName === 'mdseries' ? false : scopeBold,
              defaultItalic:
                envName === 'itshape' || envName === 'em'
                  ? true
                  : envName === 'upshape'
                  ? false
                  : scopeItalic,
              defaultColor: scopeColor,
            });
            innerPages.forEach((pg, pIdx) => {
              if (pIdx > 0) pushPageBreak();
              pg.forEach(pushBlock);
            });
            i = endIdx + closeToken.length;
            textStart = i;
            continue;
          }

          if (envName === 'comment') {
            flushTextSlice(i);
            i = endIdx + closeToken.length;
            textStart = i;
            continue;
          }

          // Fallback: gracefully unwrap any other container environment instead of leaking raw \begin{...}
          if (
            envName === 'document' ||
            envName === 'sloppypar' ||
            envName === 'singlespace' ||
            envName === 'onehalfspace' ||
            envName === 'doublespace' ||
            envName === 'landscape' ||
            envName === 'adjustbox'
          ) {
            flushTextSlice(i);
            const innerPages = parseBodyBlocks(envRawBody, ctx, mode, {
              ...opts,
              defaultAlign: scopeAlign,
              containerWidthPt: containerW,
              baseFontSizePt: scopeFontSizePt,
              defaultLineSpacing: defaultLineSp,
              defaultBold: scopeBold,
              defaultItalic: scopeItalic,
              defaultColor: scopeColor,
            });
            innerPages.forEach((pg, pIdx) => {
              if (pIdx > 0) pushPageBreak();
              pg.forEach(pushBlock);
            });
            i = endIdx + closeToken.length;
            textStart = i;
            continue;
          }
        }
      }
    }

    i++;
  }

  flushTextSlice(src.length);
  return pages
    .map((pg) => consolidateChoiceParagraphRuns(pg))
    .filter((p) => p.length > 0);
}

function consolidateChoiceParagraphRuns(blocks: DocumentBlock[]): DocumentBlock[] {
  if (blocks.length < 4) return blocks;

  const getParaPlainPrefix = (blk: DocumentBlock): string => {
    if (blk.block_type !== 'paragraph' || !blk.segments || blk.segments.length === 0) return '';
    if (blk.segments.some((s) => s.tab_before)) return '';
    let acc = '';
    for (const s of blk.segments) {
      if (s.type === 'text') acc += s.content;
      else if (s.type === 'math') acc += `$${s.content}$`;
      if (acc.length > 220) break;
    }
    return acc.trim();
  };

  const out: DocumentBlock[] = [];
  let idx = 0;

  while (idx < blocks.length) {
    if (idx + 3 < blocks.length) {
      const slice4 = [blocks[idx], blocks[idx + 1], blocks[idx + 2], blocks[idx + 3]];
      const prefixes = slice4.map(getParaPlainPrefix);
      const isUpper4 =
        prefixes.every((p) => p.length > 0 && p.length <= 180) &&
        /^A[\.\)](?:\s+|\$)/.test(prefixes[0]) &&
        /^B[\.\)](?:\s+|\$)/.test(prefixes[1]) &&
        /^C[\.\)](?:\s+|\$)/.test(prefixes[2]) &&
        /^D[\.\)](?:\s+|\$)/.test(prefixes[3]);
      const isLower4 =
        !isUpper4 &&
        prefixes.every((p) => p.length > 0 && p.length <= 80) &&
        /^a\)(?:\s+|\$)/.test(prefixes[0]) &&
        /^b\)(?:\s+|\$)/.test(prefixes[1]) &&
        /^c\)(?:\s+|\$)/.test(prefixes[2]) &&
        /^d\)(?:\s+|\$)/.test(prefixes[3]);

      if (isUpper4 || isLower4) {
        const firstBlk = slice4[0];
        const cells: TableCellData[] = slice4.map((b) => ({
          segments: boldLeadingChoiceMarker(b.segments ?? []),
          alignment: 'left',
          width_pct: 25,
        }));
        out.push({
          block_type: 'table',
          alignment: 'left',
          table_borderless: true,
          is_choice_block: true,
          font_size_pt: firstBlk.font_size_pt ?? 12,
          line_spacing: firstBlk.line_spacing ?? 1.15,
          ...(firstBlk.space_before_pt !== undefined ? { space_before_pt: firstBlk.space_before_pt } : {}),
          ...(firstBlk.indent_left_pt !== undefined ? { indent_left_pt: firstBlk.indent_left_pt } : {}),
          table_rows: [cells],
        });
        idx += 4;
        continue;
      }
    }
    out.push(blocks[idx]);
    idx++;
  }
  return out;
}

export function normalizeTextToDollarLatex(rawText: string): string {
  const pages = parsePastedLatexToPages(rawText, 'bare_latex');
  if (pages.length === 0) return rawText;
  const lines: string[] = [];
  for (const page of pages) {
    for (const blk of page.blocks) {
      if (blk.block_type === 'horizontal_rule') {
        lines.push('---');
      } else if (blk.block_type === 'equation' && blk.latex) {
        lines.push(`$${blk.latex}$`);
      } else if (blk.block_type === 'table' && blk.table_rows) {
        for (const row of blk.table_rows) {
          const cellTexts = row.map((cell) =>
            (cell.segments ?? [])
              .map((s) => (s.type === 'math' ? `$${s.content}$` : s.content))
              .join('')
              .trim()
          );
          lines.push(cellTexts.join('    '));
        }
      } else if (blk.segments) {
        const txt = blk.segments
          .map((s) => (s.type === 'math' ? `$${s.content}$` : s.content))
          .join('');
        lines.push(txt);
      }
    }
  }
  return lines.join('\n');
}

export function splitTextPreservingInlineMath(
  text: string,
  baseStyle: Omit<InlineSegment, 'type' | 'content'> = {}
): InlineSegment[] {
  if (!text) return [];
  const normalizedInput = text.includes('＄') ? text.replace(/＄/g, '$') : text;
  if (
    !normalizedInput.includes('$') &&
    !normalizedInput.includes('\\(') &&
    !normalizedInput.includes('\\[')
  ) {
    return [{ type: 'text', content: text, ...baseStyle }];
  }

  const out: InlineSegment[] = [];
  let textBuf = '';

  const flushText = () => {
    if (!textBuf) return;
    out.push({
      type: 'text',
      content: textBuf,
      ...(baseStyle.bold ? { bold: true } : {}),
      ...(baseStyle.italic ? { italic: true } : {}),
      ...(baseStyle.underline ? { underline: true } : {}),
      ...(baseStyle.font_size_pt ? { font_size_pt: baseStyle.font_size_pt } : {}),
      ...(baseStyle.color ? { color: baseStyle.color } : {}),
    });
    textBuf = '';
  };

  const pushMath = (rawInner: string) => {
    const cleaned = normalizeMathContent(rawInner);
    if (!cleaned) return;
    out.push({
      type: 'math',
      content: cleaned,
      ...(baseStyle.bold ? { bold: true } : {}),
      ...(baseStyle.italic ? { italic: true } : {}),
      ...(baseStyle.font_size_pt ? { font_size_pt: baseStyle.font_size_pt } : {}),
      ...(baseStyle.color ? { color: baseStyle.color } : {}),
    });
  };

  let i = 0;
  while (i < normalizedInput.length) {
    if (normalizedInput[i] === '\\' && normalizedInput[i + 1] === '$') {
      textBuf += '$';
      i += 2;
      continue;
    }

    if (normalizedInput.slice(i, i + 3) === '\\\\(') {
      const closeIdx = normalizedInput.indexOf('\\\\)', i + 3);
      if (closeIdx !== -1) {
        flushText();
        pushMath(unescapeChatGptMathInner(normalizedInput.slice(i + 3, closeIdx), true));
        i = closeIdx + 3;
        continue;
      }
    }

    if (normalizedInput.slice(i, i + 3) === '\\\\[') {
      const closeIdx = normalizedInput.indexOf('\\\\]', i + 3);
      if (closeIdx !== -1) {
        flushText();
        pushMath(unescapeChatGptMathInner(normalizedInput.slice(i + 3, closeIdx), false));
        i = closeIdx + 3;
        continue;
      }
    }

    if (normalizedInput[i] === '\\' && normalizedInput[i + 1] === '(') {
      const closeIdx = normalizedInput.indexOf('\\)', i + 2);
      if (closeIdx !== -1) {
        flushText();
        pushMath(normalizedInput.slice(i + 2, closeIdx));
        i = closeIdx + 2;
        continue;
      }
    }

    if (normalizedInput[i] === '\\' && normalizedInput[i + 1] === '[') {
      const closeIdx = normalizedInput.indexOf('\\]', i + 2);
      if (closeIdx !== -1) {
        flushText();
        pushMath(normalizedInput.slice(i + 2, closeIdx));
        i = closeIdx + 2;
        continue;
      }
    }

    if (normalizedInput[i] === '$' && normalizedInput[i + 1] === '$') {
      const closeIdx = normalizedInput.indexOf('$$', i + 2);
      if (closeIdx !== -1) {
        flushText();
        pushMath(normalizedInput.slice(i + 2, closeIdx));
        i = closeIdx + 2;
        continue;
      }
    }

    if (normalizedInput[i] === '$') {
      let closeIdx = -1;
      for (let j = i + 1; j < normalizedInput.length; j++) {
        if (normalizedInput[j] === '\\' && j + 1 < normalizedInput.length) {
          j++;
          continue;
        }
        if (normalizedInput[j] === '$') {
          closeIdx = j;
          break;
        }
      }
      if (closeIdx !== -1) {
        flushText();
        pushMath(normalizedInput.slice(i + 1, closeIdx));
        i = closeIdx + 1;
        continue;
      }
    }

    textBuf += normalizedInput[i];
    i++;
  }

  flushText();
  return out.length > 0 ? out : [{ type: 'text', content: text, ...baseStyle }];
}

function findProtectedSpansForMathPromotion(
  text: string,
  opts: { prevTextTail?: string; isLineStartAtZero?: boolean }
): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const addMatchSpans = (re: RegExp, groupIdx = 0) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const target = groupIdx > 0 && m[groupIdx] !== undefined ? m[groupIdx] : m[0];
      if (!target) {
        if (m[0].length === 0) re.lastIndex++;
        continue;
      }
      const start =
        groupIdx > 0 && m[groupIdx] !== undefined ? m.index + m[0].indexOf(target) : m.index;
      const end = start + target.length;
      if (end > start) spans.push([start, end]);
    }
  };

  // URLs and emails
  addMatchSpans(/https?:\/\/\S+|www\.\S+|\b[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}\b/gi);
  // Dates like 15/11/2026 or 15-11-2026
  addMatchSpans(/(?<![\p{L}\p{N}])\d{1,2}[/-]\d{1,2}[/-]\d{2,4}(?![\p{L}\p{N}])/gu);
  // Structural Vietnamese labels + number (Câu 1, Bài 2, Hình 1, Bảng 2, Phần 1, Chương 1, Trang 1, Mã đề 101...)
  addMatchSpans(
    /(?<![\p{L}\p{N}_])(?:Câu|Bài|Ví\s+dụ|VD|Hình|Bảng|Biểu\s+đồ|Đồ\s+thị|Chương|Phần|Mục|Trang|Tiết|Tuần|Bước|Đề\s+số|Đề|Mã\s+đề|Phiếu|Tờ)\s+\d+(?:[.,]\d+)?(?![\p{L}\p{N}_])/giu
  );
  // Cross-segment structural label split across bold/regular boundary (e.g. "Câu " + "1.")
  if (
    opts.prevTextTail &&
    /(?:Câu|Bài|Ví\s+dụ|VD|Hình|Bảng|Biểu\s+đồ|Đồ\s+thị|Chương|Phần|Mục|Trang|Tiết|Tuần|Bước|Đề\s+số|Đề|Mã\s+đề|Phiếu|Tờ)\s+$/iu.test(
      opts.prevTextTail
    )
  ) {
    const leadNumM = text.match(/^\s*\d+(?:[.,]\d+)?(?![\p{L}\p{N}_])/u);
    if (leadNumM) {
      spans.push([0, leadNumM[0].length]);
    }
  }
  // Leading numbered list markers at line start ("1. Tìm x", "2) Giải...")
  if (opts.isLineStartAtZero) {
    const m0 = text.match(/^[ \t]*\d+(?:\.\d+)*[\.\)](?=\s|$)/);
    if (m0) spans.push([0, m0[0].length]);
  }
  addMatchSpans(/\n([ \t]*\d+(?:\.\d+)*[\.\)])(?=\s|$)/g, 1);
  // Leading bullet dashes at line start ("- Cho hàm số...", not "-5" or "- 5")
  if (opts.isLineStartAtZero) {
    const b0 = text.match(/^[ \t]*-(?=[ \t]+(?!\d|[+\-−]|\\|∞)[^\s])/);
    if (b0) spans.push([0, b0[0].length]);
  }
  addMatchSpans(/\n([ \t]*-)(?=[ \t]+(?!\d|[+\-−]|\\|∞)[^\s])/g, 1);
  // Hyphenated compound words (e-learning, a-xít, COVID-19, ti-vi)
  addMatchSpans(/[\p{L}]{2,}-[\p{L}\p{N}]+|[\p{L}\p{N}]+-[\p{L}]{2,}/gu);
  // Year range dash (2024 - 2025): protect only the dash between years
  addMatchSpans(/(?:19|20)\d{2}\s*([-–])\s*(?:19|20)\d{2}/g, 1);
  // C++ / ++ tokens
  addMatchSpans(/\+\++/g);

  if (spans.length <= 1) return spans;
  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [spans[0]];
  for (let i = 1; i < spans.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = spans[i];
    if (curr[0] <= prev[1]) {
      if (curr[1] > prev[1]) prev[1] = curr[1];
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

function isContextualMinusSign(
  text: string,
  pos: number,
  opts: {
    prevSegType?: 'text' | 'math';
    nextSegType?: 'text' | 'math';
    prevTextTail?: string;
    isTableCell?: boolean;
  }
): boolean {
  if (opts.isTableCell && text.trim() === '-') return true;
  if (opts.prevSegType === 'math' && opts.nextSegType === 'math' && /^[\s-]*$/.test(text)) {
    return true;
  }
  if (text.trim() === '-' && (opts.prevSegType === 'math' || opts.nextSegType === 'math')) {
    return true;
  }

  const before = (opts.prevTextTail ?? '') + text.slice(0, pos);
  const after = text.slice(pos + 1);

  // Explicit Vietnamese / math cue words immediately before '-'
  if (
    /(?:dấu|dấu\s+hiệu|mang|cộng|trừ|phép|ký\s+hiệu|kí\s+hiệu|đổi\s+dấu|đổi|sang|thành|chiều|hệ\s+số)\s*$/iu.test(
      before
    )
  ) {
    return true;
  }
  // Conjunctions ("từ", "về", "nhận", "là", "bằng", "và", "hay", "hoặc") when '-' ends clause or pairs with +/-
  if (
    /(?:từ|về|nhận|là|bằng|và|hay|hoặc)\s*$/iu.test(before) &&
    (/^[\s.,;:)\]?!]*$/.test(after) ||
      /^\s*(?:đến|sang|thành|tới|và|hoặc|hay|[\+,;.)\]/])/iu.test(after))
  ) {
    return true;
  }
  // Delimiter-wrapped or paired signs: (-), [-], +/-, -/+, +, -, :-, =-
  if (
    /(?:[([{/,;:=]|\+)\s*$/.test(before) &&
    /^\s*(?:[)\]},;.:/+]|$)/.test(after)
  ) {
    return true;
  }
  // Trailing '-' in a sentence that already references '+' or math
  if (/\+\s*(?:và|hay|hoặc|với|,)\s*$/iu.test(before) && /^[\s.,;:)\]?!]*$/.test(after)) {
    return true;
  }

  return false;
}

function promoteSegmentNumbersAndSigns(
  seg: InlineSegment,
  opts: {
    prevSegType?: 'text' | 'math';
    nextSegType?: 'text' | 'math';
    prevTextTail?: string;
    isTableCell?: boolean;
    isLineStartAtZero?: boolean;
  }
): InlineSegment[] {
  if (seg.type !== 'text' || !seg.content) return [seg];
  const text = seg.content;
  const { type: _t, content: _c, tab_before, ...style } = seg;

  const protectedSpans = findProtectedSpansForMathPromotion(text, opts);
  const out: InlineSegment[] = [];
  let textBuf = '';

  const flushText = () => {
    if (!textBuf) return;
    out.push({ type: 'text', content: textBuf, ...style });
    textBuf = '';
  };

  const pushMath = (latex: string) => {
    const cleaned = latex.replace(/−/g, '-').trim();
    if (!cleaned) return;
    out.push({
      type: 'math',
      content: cleaned,
      ...(style.bold ? { bold: true } : {}),
      ...(style.italic ? { italic: true } : {}),
      ...(style.underline ? { underline: true } : {}),
      ...(style.font_size_pt ? { font_size_pt: style.font_size_pt } : {}),
      ...(style.color ? { color: style.color } : {}),
    });
  };

  let spanIdx = 0;
  let pos = 0;

  while (pos < text.length) {
    while (spanIdx < protectedSpans.length && protectedSpans[spanIdx][1] <= pos) {
      spanIdx++;
    }
    if (
      spanIdx < protectedSpans.length &&
      pos >= protectedSpans[spanIdx][0] &&
      pos < protectedSpans[spanIdx][1]
    ) {
      textBuf += text.slice(pos, protectedSpans[spanIdx][1]);
      pos = protectedSpans[spanIdx][1];
      continue;
    }

    const nextSpanStart =
      spanIdx < protectedSpans.length ? protectedSpans[spanIdx][0] : text.length;
    const chunk = text.slice(pos, nextSpanStart);
    const prevChar = pos > 0 ? text[pos - 1] : '';

    // 1. Optional sign + infinity symbol (e.g. -∞, +∞, ∞)
    const infMatch = chunk.match(/^([+\-−]\s*)?∞(?![\p{L}\p{N}_])/u);
    if (infMatch && !/[\p{L}\p{N}_]/u.test(prevChar)) {
      flushText();
      const signPart = infMatch[1] ? infMatch[1].replace(/\s+/g, '').replace(/−/g, '-') : '';
      pushMath(`${signPart}\\infty`);
      pos += infMatch[0].length;
      continue;
    }

    // 2. Number, signed number (+3, -5, -2,5), or arithmetic chain of numbers (2 + 3 - 1)
    if (!/[\p{L}\p{N}_]/u.test(prevChar)) {
      const numMatch = chunk.match(
        /^(?:[+\-−](?=\d))?\d+(?:[.,]\d+)?(?![\p{L}\p{N}_])(?:\s*[+\-−]\s*\d+(?:[.,]\d+)?(?![\p{L}\p{N}_]))*/u
      );
      if (numMatch) {
        flushText();
        pushMath(numMatch[0]);
        pos += numMatch[0].length;
        continue;
      }
    }

    // 3. Standalone '+' or Unicode minus '−'
    if (text[pos] === '+' || text[pos] === '−') {
      flushText();
      pushMath(text[pos] === '−' ? '-' : '+');
      pos += 1;
      continue;
    }

    // 4. Contextual ASCII '-' minus sign
    if (
      text[pos] === '-' &&
      isContextualMinusSign(text, pos, {
        prevSegType: opts.prevSegType,
        nextSegType: opts.nextSegType,
        prevTextTail: opts.prevTextTail,
        isTableCell: opts.isTableCell,
      })
    ) {
      flushText();
      pushMath('-');
      pos += 1;
      continue;
    }

    textBuf += text[pos];
    pos += 1;
  }

  flushText();

  if (out.length === 0) return [seg];
  if (tab_before) {
    out[0] = { ...out[0], tab_before: true };
  }
  return out;
}

export function promoteNumbersAndSignsToMathSegments(
  segments?: InlineSegment[] | null,
  options: { isTableCell?: boolean } = {}
): InlineSegment[] | undefined {
  if (!segments || segments.length === 0) return segments ?? undefined;
  const out: InlineSegment[] = [];
  let prevTextTail = '';
  let atBlockLineStart = true;

  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx];
    const prevSegType = idx > 0 ? segments[idx - 1]?.type : undefined;
    const nextSegType = idx + 1 < segments.length ? segments[idx + 1]?.type : undefined;
    const isLineStartAtZero = atBlockLineStart || Boolean(seg.tab_before);

    if (seg.type === 'text' && seg.content && !seg.vert_align) {
      const promoted = promoteSegmentNumbersAndSigns(seg, {
        prevSegType,
        nextSegType,
        prevTextTail,
        isTableCell: options.isTableCell,
        isLineStartAtZero,
      });
      out.push(...promoted);
      prevTextTail = (prevTextTail + seg.content).slice(-32);
      atBlockLineStart = seg.content.endsWith('\n');
    } else {
      out.push(seg);
      prevTextTail = seg.type === 'text' && seg.content ? (prevTextTail + seg.content).slice(-32) : '';
      atBlockLineStart = seg.type === 'text' && seg.content ? seg.content.endsWith('\n') : false;
    }
  }

  return out;
}

export function fixBareSetBracesInMath(latex: string): string {
  if (!latex || !latex.includes('{')) return latex;
  let out = '';
  let i = 0;
  while (i < latex.length) {
    if (latex[i] === '\\') {
      out += latex.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (latex[i] === '{') {
      const beforeTrim = out.trimEnd();
      const precededBySetOp =
        /(?:=|\\in|\\notin|\\subset|\\subseteq|\\supset|\\supseteq|\\cup|\\cap|\\setminus|\\neq)$/.test(
          beforeTrim
        );
      if (precededBySetOp) {
        // Find matching unescaped closing '}'
        let depth = 1;
        let j = i + 1;
        while (j < latex.length && depth > 0) {
          if (latex[j] === '\\') {
            j += 2;
            continue;
          }
          if (latex[j] === '{') depth++;
          else if (latex[j] === '}') depth--;
          j++;
        }
        if (depth === 0) {
          const closeIdx = j - 1;
          const inner = latex.slice(i + 1, closeIdx);
          const after = latex.slice(closeIdx + 1).trimStart();
          const hasScriptAfter = after.startsWith('^') || after.startsWith('_');
          const looksLikeSet =
            /(?:\\in(?![a-zA-Z])|\\mid(?![a-zA-Z])|\||;|,)/.test(inner) ||
            (/\\setminus$/.test(beforeTrim) && inner.trim().length > 0);
          if (!hasScriptAfter && looksLikeSet) {
            out += '\\{' + fixBareSetBracesInMath(inner) + '\\}';
            i = closeIdx + 1;
            continue;
          }
        }
      }
    }
    out += latex[i];
    i += 1;
  }
  return out;
}

export function normalizeSegmentListInlineMath(
  segments?: InlineSegment[] | null,
  options: { isTableCell?: boolean } = {}
): InlineSegment[] | undefined {
  if (!segments || segments.length === 0) return segments ?? undefined;
  const splitResult: InlineSegment[] = [];
  for (const seg of segments) {
    if (seg.type === 'math') {
      const fixed = fixBareSetBracesInMath(seg.content ?? '');
      splitResult.push(fixed !== seg.content ? { ...seg, content: fixed } : seg);
      continue;
    }
    if (
      seg.type !== 'text' ||
      (!seg.content.includes('$') &&
        !seg.content.includes('＄') &&
        !seg.content.includes('\\(') &&
        !seg.content.includes('\\['))
    ) {
      splitResult.push(seg);
      continue;
    }
    const { type: _t, content, tab_before, ...style } = seg;
    const split = splitTextPreservingInlineMath(content, style).map((s) =>
      s.type === 'math' ? { ...s, content: fixBareSetBracesInMath(s.content) } : s
    );
    if (tab_before && split.length > 0) {
      split[0] = { ...split[0], tab_before: true };
    }
    splitResult.push(...split);
  }
  return promoteNumbersAndSignsToMathSegments(splitResult, options);
}

function normalizeBlockListInlineMath(blocks: DocumentBlock[]): DocumentBlock[] {
  return blocks.map((blk) => ({
    ...blk,
    ...(blk.block_type === 'equation' && blk.latex
      ? { latex: fixBareSetBracesInMath(blk.latex) }
      : {}),
    ...(blk.segments ? { segments: normalizeSegmentListInlineMath(blk.segments) } : {}),
    ...(blk.table_rows
      ? {
          table_rows: blk.table_rows.map((row) =>
            row.map((cell) => ({
              ...cell,
              segments:
                normalizeSegmentListInlineMath(cell.segments, { isTableCell: true }) ?? [],
              ...(cell.blocks && cell.blocks.length > 0
                ? { blocks: normalizeBlockListInlineMath(cell.blocks) }
                : {}),
            }))
          ),
        }
      : {}),
  }));
}

export function normalizePagesInlineMath(pages: PageExtraction[]): PageExtraction[] {
  return pages.map((page) => ({
    ...page,
    blocks: normalizeBlockListInlineMath(page.blocks),
  }));
}

export function parsePastedLatexToPages(
  rawText: string,
  mode: LatexPasteMode = 'auto',
  figureAssets?: Record<string, EmbeddedFigureAsset>
): PageExtraction[] {
  if (!rawText || !rawText.trim()) return [];

  const {
    body,
    title,
    author,
    date,
    isFullLatexDoc,
    isVietnamese,
    customTheorems,
    customColors,
    customTikzStyles,
    defaultTasksLabel,
    pageConfig,
  } = preprocessDocumentAndMacros(rawText);
  if (!body.trim()) return [];

  const baseInit = {
    isVietnamese,
    customTheorems,
    customColors,
    customTikzStyles,
    defaultTasksLabel,
    figureAssets,
    pageConfig,
  };
  const parseOpts: BlockParseOptions = {
    defaultAlign: 'left',
    isFullLatexDoc,
    listDepth: 0,
    indentLeftPt: 0,
    containerWidthPt: pageConfig.contentWidthPt,
    baseFontSizePt: pageConfig.baseFontSizePt,
    defaultLineSpacing: pageConfig.defaultLineSpacing,
    meta: { title, author, date },
  };

  // Pass 1: collect all \label{...} and \bibitem{...} across document
  const pass1Ctx = createParserContext(baseInit);
  parseBodyBlocks(body, pass1Ctx, mode, parseOpts);

  // Pass 2: render with full forward & backward \ref / \eqref / \cite resolution
  const pass2Ctx = createParserContext({
    ...baseInit,
    labels: pass1Ctx.labels,
    labelKinds: pass1Ctx.labelKinds,
    cites: pass1Ctx.cites,
  });
  const pageBlockGroups = parseBodyBlocks(body, pass2Ctx, mode, parseOpts);

  if (pageBlockGroups.length === 0) return [];

  const baseW = pageConfig.pageSize === 'letter' ? 1275 : pageConfig.pageSize === 'a5' ? 874 : 1240;
  const baseH = pageConfig.pageSize === 'letter' ? 1650 : pageConfig.pageSize === 'a5' ? 1240 : 1754;
  const pageWidthPx = pageConfig.isLandscape ? baseH : baseW;
  const pageHeightPx = pageConfig.isLandscape ? baseW : baseH;

  const pages: PageExtraction[] = pageBlockGroups.map((blocks, idx) => ({
    pageNumber: idx + 1,
    pageWidthPx,
    pageHeightPx,
    page_size: pageConfig.pageSize,
    is_landscape: pageConfig.isLandscape,
    margin_top_pt: pageConfig.marginTopPt,
    margin_right_pt: pageConfig.marginRightPt,
    margin_bottom_pt: pageConfig.marginBottomPt,
    margin_left_pt: pageConfig.marginLeftPt,
    base_font_size_pt: pageConfig.baseFontSizePt,
    default_line_spacing: pageConfig.defaultLineSpacing,
    blocks,
  }));

  return normalizePagesInlineMath(pages);
}
