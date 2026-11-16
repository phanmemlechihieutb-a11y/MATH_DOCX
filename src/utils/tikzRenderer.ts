export interface RenderedLatexFigure {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
}

interface Point2D {
  x: number;
  y: number;
}

interface DrawStyle {
  stroke: string;
  strokeWidth: number;
  dashArray?: string;
  fill: string;
  fillOpacity: number;
  strokeOpacity: number;
  arrowStart?: boolean;
  arrowEnd?: boolean;
  pattern?: string;
  patternColor?: string;
  fontSize?: number;
  fontWeight?: string;
  fontStyle?: string;
  align?: string;
  anchor?: string;
  pos?: number;
  shiftX?: number;
  shiftY?: number;
  shiftXPx?: number;
  shiftYPx?: number;
  isClip?: boolean;
  circle?: boolean;
  innerSep?: number;
  roundedCorners?: number;
}

interface SvgItem {
  kind: 'path' | 'circle' | 'ellipse' | 'rect' | 'line' | 'text' | 'polyline' | 'polygon';
  svg: string;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  clipId?: string;
}

interface TikzScopeState {
  scaleX: number;
  scaleY: number;
  shiftX: number;
  shiftY: number;
  shiftXPx?: number;
  shiftYPx?: number;
  rotateDeg: number;
  color: string;
  lineWidth: number;
  dashArray?: string;
  fill: string;
  fillOpacity: number;
  clipId?: string;
  clipBounds?: { minX: number; minY: number; maxX: number; maxY: number };
}

const COLOR_MAP: Record<string, string> = {
  black: '#0F172A',
  white: '#FFFFFF',
  red: '#DC2626',
  blue: '#2563EB',
  green: '#16A34A',
  darkgreen: '#15803D',
  forestgreen: '#15803D',
  orange: '#EA580C',
  purple: '#9333EA',
  violet: '#7C3AED',
  magenta: '#DB2777',
  cyan: '#0891B2',
  teal: '#0D9488',
  brown: '#92400E',
  gray: '#64748B',
  grey: '#64748B',
  darkgray: '#334155',
  lightgray: '#CBD5E1',
  navy: '#1E3A8A',
  maroon: '#991B1B',
  yellow: '#CA8A04',
  olive: '#65A30D',
  pink: '#EC4899',
  lime: '#84CC16',
};

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function readBalanced(
  src: string,
  openIdx: number,
  openCh: string,
  closeCh: string
): { content: string; endIdx: number } | null {
  if (src[openIdx] !== openCh) return null;
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '\\' && i + 1 < src.length) {
      i++;
      continue;
    }
    if (src[i] === openCh) depth++;
    else if (src[i] === closeCh) {
      depth--;
      if (depth === 0) {
        return { content: src.slice(openIdx + 1, i), endIdx: i };
      }
    }
  }
  return null;
}

function splitTopLevel(src: string, sep: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let brace = 0;
  let bracket = 0;
  let paren = 0;
  let inMath = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length) {
      cur += ch + src[i + 1];
      i++;
      continue;
    }
    if (ch === '$') {
      inMath = !inMath;
    } else if (!inMath) {
      if (ch === '{') brace++;
      else if (ch === '}') brace = Math.max(0, brace - 1);
      else if (ch === '[') bracket++;
      else if (ch === ']') bracket = Math.max(0, bracket - 1);
      else if (ch === '(') paren++;
      else if (ch === ')') paren = Math.max(0, paren - 1);
    }

    if (
      !inMath &&
      brace === 0 &&
      bracket === 0 &&
      paren === 0 &&
      src.slice(i, i + sep.length) === sep
    ) {
      parts.push(cur);
      cur = '';
      i += sep.length - 1;
      continue;
    }
    cur += ch;
  }
  if (cur.trim() || parts.length > 0) parts.push(cur);
  return parts;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, '0')).join('')
  );
}

function resolveTikzColor(raw: string, customColors: Record<string, string>): string | undefined {
  const s = raw.trim().toLowerCase();
  if (!s) return undefined;
  if (s === 'none') return 'none';
  if (customColors[s]) return customColors[s];
  if (COLOR_MAP[s]) return COLOR_MAP[s];
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toUpperCase();

  // Support color mixing like blue!30 or red!50!yellow
  if (s.includes('!')) {
    const parts = s.split('!').map((p) => p.trim());
    const c1 = resolveTikzColor(parts[0], customColors);
    if (!c1 || c1 === 'none') return undefined;
    const pct = parseFloat(parts[1]);
    if (!Number.isFinite(pct)) return c1;
    const w = Math.max(0, Math.min(100, pct)) / 100;
    const c2 = parts[2] ? resolveTikzColor(parts[2], customColors) ?? '#FFFFFF' : '#FFFFFF';
    if (c2 === 'none') return c1;
    const [r1, g1, b1] = hexToRgb(c1);
    const [r2, g2, b2] = hexToRgb(c2);
    return rgbToHex(r1 * w + r2 * (1 - w), g1 * w + g2 * (1 - w), b1 * w + b2 * (1 - w));
  }
  return undefined;
}

function parseLengthToTikzUnits(raw: string, unitPx = 42): number | null {
  const s = raw.trim();
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(cm|mm|pt|em|ex|in)?$/i);
  if (!m) return null;
  const val = parseFloat(m[1]);
  const unit = (m[2] || '').toLowerCase();
  if (!unit) return val;
  const cmToUnits = 37.795 / unitPx;
  if (unit === 'cm') return val * cmToUnits;
  if (unit === 'mm') return (val / 10) * cmToUnits;
  if (unit === 'pt') return (val * 1.3333) / unitPx;
  if (unit === 'in') return val * 2.54 * cmToUnits;
  if (unit === 'em' || unit === 'ex') return (val * 10) / unitPx;
  return val;
}

function parseLengthToPx(raw: string, unitPx = 42): number | null {
  const s = raw.trim();
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(cm|mm|pt|em|ex|in|px)?$/i);
  if (!m) return null;
  const val = parseFloat(m[1]);
  const unit = (m[2] || '').toLowerCase();
  if (!unit) return val * unitPx;
  if (unit === 'px') return val;
  if (unit === 'cm') return val * 37.795;
  if (unit === 'mm') return val * 3.7795;
  if (unit === 'pt') return val * 1.3333;
  if (unit === 'in') return val * 96;
  if (unit === 'em' || unit === 'ex') return val * 12;
  return val * unitPx;
}

// Safe recursive-descent math expression evaluator
function evalMathExpr(
  rawExpr: string,
  vars: Record<string, number> = {},
  trigRadDefault = false
): number | null {
  let expr = rawExpr.trim();
  if (!expr) return null;

  // Replace common LaTeX math constructs inside expressions
  expr = expr
    .replace(/\*\*/g, '^')
    .replace(/\\left\s*\(/g, '(')
    .replace(/\\right\s*\)/g, ')')
    .replace(/\\cdot|\\times/g, '*')
    .replace(/\\div/g, '/')
    .replace(/\\pi(?![a-zA-Z])/g, 'pi')
    .replace(/\\(?:d|t)?frac(?:\s*\{([^}]+)\}|\s*([0-9a-zA-Z]))(?:\s*\{([^}]+)\}|\s*([0-9a-zA-Z]))/g, (_m, a1, a2, b1, b2) => `((${a1 ?? a2})/(${b1 ?? b2}))`)
    .replace(/\\sqrt(?:\s*\{([^}]+)\}|\s*([0-9a-zA-Z]))/g, (_m, a1, a2) => `sqrt(${a1 ?? a2})`)
    .replace(/\\sin(?![a-zA-Z])/g, 'sin')
    .replace(/\\cos(?![a-zA-Z])/g, 'cos')
    .replace(/\\tan(?![a-zA-Z])/g, 'tan')
    .replace(/\\ln(?![a-zA-Z])/g, 'ln')
    .replace(/\\log(?![a-zA-Z])/g, 'log10')
    .replace(/\\exp(?![a-zA-Z])/g, 'exp')
    .replace(/\\abs(?![a-zA-Z])/g, 'abs')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')');

  // Normalize \x style variable references to x, \t -> t, etc.
  for (const k of Object.keys(vars)) {
    const cleanName = k.replace(/^\\/, '');
    if (k.startsWith('\\')) {
      expr = expr.replace(new RegExp(`\\\\${cleanName}(?![a-zA-Z])`, 'g'), cleanName);
    }
  }

  // Handle TikZ radian suffix like (x r) or (\x r) or 2 r -> (x)*(180/pi) if trig is degrees,
  // or directly treat 'r' postfix as *1 when trigRadDefault is handled cleanly:
  // Actually simpler: pass `rad` conversion by replacing `(\w|\))\s+r\b` with `($1)*57.29577951308232` when !trigRadDefault,
  // or better yet: handle `r` suffix directly in tokenizer so `sin(\x r)` works in both modes!
  const cleanVars: Record<string, number> = { pi: Math.PI, e: Math.E };
  for (const [k, v] of Object.entries(vars)) {
    cleanVars[k.replace(/^\\/, '')] = v;
  }

  type Tok =
    | { type: 'num'; v: number }
    | { type: 'id'; v: string }
    | { type: 'op'; v: string }
    | { type: 'lp' }
    | { type: 'rp' }
    | { type: 'comma' };

  const tokens: Tok[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < expr.length && /[0-9.]/.test(expr[j])) j++;
      if (expr[j] === 'e' || expr[j] === 'E') {
        if (/[0-9+-]/.test(expr[j + 1] ?? '')) {
          j++;
          if (expr[j] === '+' || expr[j] === '-') j++;
          while (j < expr.length && /[0-9]/.test(expr[j])) j++;
        }
      }
      const num = parseFloat(expr.slice(i, j));
      if (!Number.isFinite(num)) return null;
      tokens.push({ type: 'num', v: num });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < expr.length && /[a-zA-Z0-9_]/.test(expr[j])) j++;
      const id = expr.slice(i, j);
      // Radian postfix `r` after space e.g. `sin(x r)`
      if (id === 'r' && tokens.length > 0) {
        const prev = tokens[tokens.length - 1];
        if (prev.type === 'num' || prev.type === 'id' || prev.type === 'rp') {
          if (!trigRadDefault) {
            tokens.push({ type: 'op', v: '*' });
            tokens.push({ type: 'num', v: 180 / Math.PI });
          }
          i = j;
          continue;
        }
      }
      tokens.push({ type: 'id', v: id });
      i = j;
      continue;
    }
    if ('+-*/^'.includes(ch)) {
      tokens.push({ type: 'op', v: ch });
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lp' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rp' });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'comma' });
      i++;
      continue;
    }
    return null;
  }

  // Insert implicit multiplication (e.g. 2x -> 2*x, 2(x) -> 2*(x), )( -> )*( )
  const expanded: Tok[] = [];
  const fnNames = new Set([
    'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'asin', 'acos', 'atan', 'atan2',
    'sinh', 'cosh', 'tanh', 'exp', 'ln', 'log', 'log10', 'log2', 'sqrt', 'abs',
    'floor', 'ceil', 'round', 'min', 'max', 'pow', 'sign', 'mod', 'deg', 'rad',
  ]);
  for (let idx = 0; idx < tokens.length; idx++) {
    const cur = tokens[idx];
    const prev = expanded[expanded.length - 1];
    if (prev) {
      const prevVal = prev.type === 'num' || prev.type === 'rp' || (prev.type === 'id' && !fnNames.has(prev.v));
      const curVal = cur.type === 'num' || cur.type === 'lp' || cur.type === 'id';
      if (prevVal && curVal) {
        expanded.push({ type: 'op', v: '*' });
      }
    }
    expanded.push(cur);
  }

  let pos = 0;
  const peek = () => expanded[pos];
  const consume = () => expanded[pos++];

  const toRad = (degOrRad: number) => (trigRadDefault ? degOrRad : (degOrRad * Math.PI) / 180);
  const fromRad = (rad: number) => (trigRadDefault ? rad : (rad * 180) / Math.PI);

  function parseAdd(): number {
    let left = parseMul();
    while (peek()?.type === 'op' && (peek() as { type: 'op'; v: string }).v in { '+': 1, '-': 1 }) {
      const op = (consume() as { type: 'op'; v: string }).v;
      const right = parseMul();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseMul(): number {
    let left = parseUnary();
    while (peek()?.type === 'op' && (peek() as { type: 'op'; v: string }).v in { '*': 1, '/': 1 }) {
      const op = (consume() as { type: 'op'; v: string }).v;
      const right = parseUnary();
      left = op === '*' ? left * right : left / right;
    }
    return left;
  }

  function parseUnary(): number {
    const t = peek();
    if (t?.type === 'op' && (t.v === '+' || t.v === '-')) {
      consume();
      const val = parseUnary();
      return t.v === '-' ? -val : val;
    }
    return parsePow();
  }

  function parsePow(): number {
    const base = parsePrimary();
    if (peek()?.type === 'op' && (peek() as { type: 'op'; v: string }).v === '^') {
      consume();
      const exp = parseUnary();
      return Math.pow(base, exp);
    }
    return base;
  }

  function parsePrimary(): number {
    const t = peek();
    if (!t) return NaN;
    if (t.type === 'num') {
      consume();
      return t.v;
    }
    if (t.type === 'lp') {
      consume();
      const v = parseAdd();
      if (peek()?.type === 'rp') consume();
      return v;
    }
    if (t.type === 'id') {
      consume();
      const name = t.v;
      if (peek()?.type === 'lp') {
        consume();
        const args: number[] = [];
        if (peek()?.type !== 'rp') {
          args.push(parseAdd());
          while (peek()?.type === 'comma') {
            consume();
            args.push(parseAdd());
          }
        }
        if (peek()?.type === 'rp') consume();
        const a0 = args[0] ?? 0;
        const a1 = args[1] ?? 0;
        switch (name) {
          case 'sin': return Math.sin(toRad(a0));
          case 'cos': return Math.cos(toRad(a0));
          case 'tan': return Math.tan(toRad(a0));
          case 'cot': return 1 / Math.tan(toRad(a0));
          case 'sec': return 1 / Math.cos(toRad(a0));
          case 'csc': return 1 / Math.sin(toRad(a0));
          case 'asin': return fromRad(Math.asin(a0));
          case 'acos': return fromRad(Math.acos(a0));
          case 'atan': return fromRad(Math.atan(a0));
          case 'atan2': return fromRad(Math.atan2(a0, a1));
          case 'sinh': return Math.sinh(a0);
          case 'cosh': return Math.cosh(a0);
          case 'tanh': return Math.tanh(a0);
          case 'exp': return Math.exp(a0);
          case 'ln': return Math.log(a0);
          case 'log': return Math.log(a0);
          case 'log10': return Math.log10(a0);
          case 'log2': return Math.log2(a0);
          case 'sqrt': return Math.sqrt(a0);
          case 'abs': return Math.abs(a0);
          case 'floor': return Math.floor(a0);
          case 'ceil': return Math.ceil(a0);
          case 'round': return Math.round(a0);
          case 'min': return Math.min(...args);
          case 'max': return Math.max(...args);
          case 'pow': return Math.pow(a0, a1);
          case 'sign': return Math.sign(a0);
          case 'mod': return a0 % a1;
          case 'deg': return (a0 * 180) / Math.PI;
          case 'rad': return (a0 * Math.PI) / 180;
          default: return NaN;
        }
      }
      if (name in cleanVars) return cleanVars[name];
      return NaN;
    }
    return NaN;
  }

  try {
    const out = parseAdd();
    if (pos !== expanded.length || !Number.isFinite(out)) return null;
    return out;
  } catch {
    return null;
  }
}

interface FormattedLabel {
  tspans: string;
  plainLength: number;
}

function formatLatexPieceToTspans(
  raw: string,
  italicVars: boolean,
  baseFontSize: number
): FormattedLabel {
  let s = raw.trim();
  // Strip wrappers
  s = s
    .replace(
      /\\(?:displaystyle|textstyle|scriptstyle|tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge|bfseries|itshape|mdseries|upshape|centering|ensuremath)\b/g,
      ''
    )
    .replace(/\\(?:left|right|big|Big|bigg|Bigg)(?=[()[\]{}|.])/g, '')
    .replace(/\\[,;:! ]/g, ' ')
    .replace(/\\quad/g, '  ')
    .replace(/\\qquad/g, '    ')
    .replace(/\\infty(?![a-zA-Z])/g, '∞')
    .replace(/\\pm(?![a-zA-Z])/g, '±')
    .replace(/\\mp(?![a-zA-Z])/g, '∓')
    .replace(/\\times(?![a-zA-Z])/g, '×')
    .replace(/\\cdot(?![a-zA-Z])/g, '·')
    .replace(/\\div(?![a-zA-Z])/g, '÷')
    .replace(/\\leq?(?:slant)?(?![a-zA-Z])/g, '≤')
    .replace(/\\geq?(?:slant)?(?![a-zA-Z])/g, '≥')
    .replace(/\\neq?(?![a-zA-Z])/g, '≠')
    .replace(/\\approx(?![a-zA-Z])/g, '≈')
    .replace(/\\equiv(?![a-zA-Z])/g, '≡')
    .replace(/\\parallel(?![a-zA-Z])/g, '∥')
    .replace(/\\perp(?![a-zA-Z])/g, '⊥')
    .replace(/\\angle(?![a-zA-Z])/g, '∠')
    .replace(/\\triangle(?![a-zA-Z])/g, '△')
    .replace(/\\prime(?![a-zA-Z])/g, '′')
    .replace(/\\in(?![a-zA-Z])/g, '∈')
    .replace(/\\notin(?![a-zA-Z])/g, '∉')
    .replace(/\\subset(?![a-zA-Z])/g, '⊂')
    .replace(/\\cup(?![a-zA-Z])/g, '∪')
    .replace(/\\cap(?![a-zA-Z])/g, '∩')
    .replace(/\\emptyset(?![a-zA-Z])/g, '∅')
    .replace(/\\varnothing(?![a-zA-Z])/g, '∅')
    .replace(/\\forall(?![a-zA-Z])/g, '∀')
    .replace(/\\exists(?![a-zA-Z])/g, '∃')
    .replace(/\\rightarrow|\\to(?![a-zA-Z])/g, '→')
    .replace(/\\leftarrow(?![a-zA-Z])/g, '←')
    .replace(/\\Rightarrow(?![a-zA-Z])/g, '⇒')
    .replace(/\\Leftrightarrow(?![a-zA-Z])/g, '⇔')
    .replace(/\\degree(?![a-zA-Z])/g, '°')
    .replace(/\\circ(?![a-zA-Z])/g, '°')
    .replace(/\\alpha(?![a-zA-Z])/g, 'α')
    .replace(/\\beta(?![a-zA-Z])/g, 'β')
    .replace(/\\gamma(?![a-zA-Z])/g, 'γ')
    .replace(/\\delta(?![a-zA-Z])/g, 'δ')
    .replace(/\\Delta(?![a-zA-Z])/g, 'Δ')
    .replace(/\\varepsilon|\\epsilon(?![a-zA-Z])/g, 'ε')
    .replace(/\\theta(?![a-zA-Z])/g, 'θ')
    .replace(/\\lambda(?![a-zA-Z])/g, 'λ')
    .replace(/\\mu(?![a-zA-Z])/g, 'μ')
    .replace(/\\pi(?![a-zA-Z])/g, 'π')
    .replace(/\\rho(?![a-zA-Z])/g, 'ρ')
    .replace(/\\sigma(?![a-zA-Z])/g, 'σ')
    .replace(/\\varphi|\\phi(?![a-zA-Z])/g, 'φ')
    .replace(/\\omega(?![a-zA-Z])/g, 'ω')
    .replace(/\\Omega(?![a-zA-Z])/g, 'Ω')
    .replace(/\\mathbb\{R\}/g, 'ℝ')
    .replace(/\\mathbb\{N\}/g, 'ℕ')
    .replace(/\\mathbb\{Z\}/g, 'ℤ')
    .replace(/\\mathbb\{Q\}/g, 'ℚ')
    .replace(/\\mathbb\{C\}/g, 'ℂ')
    .replace(
      /\\(?:d|t)?frac(?:\s*\{([^}]*)\}|\s*([0-9a-zA-Z]))(?:\s*\{([^}]*)\}|\s*([0-9a-zA-Z]))/g,
      (_m, a1: string | undefined, a2: string | undefined, b1: string | undefined, b2: string | undefined) => {
        const ca = (a1 ?? a2 ?? '').trim();
        const cb = (b1 ?? b2 ?? '').trim();
        const sa = ca.length > 2 && /[+-]/.test(ca) ? `(${ca})` : ca;
        const sb = cb.length > 2 && /[+-]/.test(cb) ? `(${cb})` : cb;
        return `${sa}/${sb}`;
      }
    )
    .replace(
      /\\sqrt(?:\s*\[([^\]]*)\])?(?:\s*\{([^}]*)\}|\s*([0-9a-zA-Z]))/g,
      (_m, deg: string | undefined, a1: string | undefined, a2: string | undefined) => {
        const inner = (a1 ?? a2 ?? '').trim();
        const rootSym = deg === '3' ? '∛' : deg ? `${deg}√` : '√';
        return a1 !== undefined || inner.length > 1 ? `${rootSym}(${inner})` : `${rootSym}${inner}`;
      }
    )
    .replace(/\\(?:overrightarrow|vec)\s*\{([^}]*)\}/g, '$1⃗')
    .replace(/\\widehat\s*\{([^}]*)\}/g, '$1̂')
    .replace(/\\overline\s*\{([^}]*)\}/g, '$1̄')
    .replace(/\\(?:text|mathrm|mathbf|mathit|textbf)\s*\{([^}]*)\}/g, '$1')
    .replace(/\\([a-zA-Z]+)/g, '$1')
    .replace(/\\([{}$%&_])/g, '$1');

  if (italicVars) {
    s = s.replace(/-/g, '−');
  }

  let out = '';
  let plainLen = 0;
  let i = 0;
  const subSize = Math.round(baseFontSize * 0.72 * 10) / 10;

  while (i < s.length) {
    if ((s[i] === '^' || s[i] === '_') && i + 1 < s.length) {
      const isSup = s[i] === '^';
      let content = '';
      if (s[i + 1] === '{') {
        const br = readBalanced(s, i + 1, '{', '}');
        if (br) {
          content = br.content;
          i = br.endIdx + 1;
        } else {
          content = s[i + 1];
          i += 2;
        }
      } else {
        content = s[i + 1];
        i += 2;
      }
      const dy = isSup ? -Math.round(baseFontSize * 0.34) : Math.round(baseFontSize * 0.22);
      const resetDy = -dy;
      out += `<tspan dy="${dy}" font-size="${subSize}">${escapeXmlAttr(content)}</tspan><tspan dy="${resetDy}">&#8203;</tspan>`;
      plainLen += content.length * 0.7;
      continue;
    }

    if (s[i] === '{' || s[i] === '}') {
      i++;
      continue;
    }

    if (italicVars && /[a-zA-Z]/.test(s[i])) {
      let j = i;
      while (j < s.length && /[a-zA-Z]/.test(s[j])) j++;
      const word = s.slice(i, j);
      const knownFuncs = new Set(['sin', 'cos', 'tan', 'cot', 'log', 'ln', 'exp', 'lim', 'max', 'min']);
      if (word.length === 1 || !knownFuncs.has(word)) {
        out += `<tspan font-style="italic">${escapeXmlAttr(word)}</tspan>`;
      } else {
        out += escapeXmlAttr(word);
      }
      plainLen += word.length;
      i = j;
      continue;
    }

    out += escapeXmlAttr(s[i]);
    plainLen += 1;
    i++;
  }

  return { tspans: out, plainLength: plainLen };
}

function formatTikzLabelToSvg(rawLabel: string, baseFontSize = 13): FormattedLabel {
  const s = rawLabel.trim();
  if (!s) return { tspans: '', plainLength: 0 };

  // Split by $...$ or \(...\)
  let out = '';
  let plainLen = 0;
  let i = 0;
  while (i < s.length) {
    if (s[i] === '$') {
      const end = s.indexOf('$', i + 1);
      if (end !== -1) {
        const inner = s.slice(i + 1, end);
        const f = formatLatexPieceToTspans(inner, true, baseFontSize);
        out += f.tspans;
        plainLen += f.plainLength;
        i = end + 1;
        continue;
      }
    }
    if (s[i] === '\\' && s[i + 1] === '(') {
      const end = s.indexOf('\\)', i + 2);
      if (end !== -1) {
        const inner = s.slice(i + 2, end);
        const f = formatLatexPieceToTspans(inner, true, baseFontSize);
        out += f.tspans;
        plainLen += f.plainLength;
        i = end + 2;
        continue;
      }
    }
    // Plain text until next math delimiter
    let j = i;
    while (j < s.length && s[j] !== '$' && !(s[j] === '\\' && s[j + 1] === '(')) j++;
    const chunk = s.slice(i, j);
    const f = formatLatexPieceToTspans(chunk, false, baseFontSize);
    out += f.tspans;
    plainLen += f.plainLength;
    i = j;
  }

  return { tspans: out, plainLength: plainLen };
}

function expandForeachLoops(
  src: string,
  vars: Record<string, number> = {}
): string {
  let out = src;
  const re = /\\foreach\s+(\\[a-zA-Z]+(?:\s*\/\s*\\[a-zA-Z]+)*)\s*(?:\[[^\]]*\])?\s*in\s*\{/;
  let safety = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(out)) !== null && safety < 40) {
    safety++;
    const varNames = m[1].split('/').map((v) => v.trim());
    const listBr = readBalanced(out, m.index + m[0].length - 1, '{', '}');
    if (!listBr) break;

    let pos = listBr.endIdx + 1;
    while (pos < out.length && /\s/.test(out[pos])) pos++;
    let bodyStr = '';
    let endPos = pos;

    if (out[pos] === '{') {
      const bodyBr = readBalanced(out, pos, '{', '}');
      if (!bodyBr) break;
      bodyStr = bodyBr.content;
      endPos = bodyBr.endIdx + 1;
    } else {
      // Single statement terminated by ;
      const semi = out.indexOf(';', pos);
      if (semi === -1) break;
      bodyStr = out.slice(pos, semi + 1);
      endPos = semi + 1;
    }

    const rawItems = splitTopLevel(listBr.content, ',').map((x) => x.trim()).filter(Boolean);
    const items: string[] = [];

    // Expand `a, b, ..., c` or `a, ..., c`
    for (let idx = 0; idx < rawItems.length; idx++) {
      if (rawItems[idx] === '...' && idx > 0 && idx + 1 < rawItems.length) {
        const endVal = evalMathExpr(rawItems[idx + 1], vars);
        const startVal = evalMathExpr(rawItems[idx - 1], vars);
        const prevVal = idx >= 2 ? evalMathExpr(rawItems[idx - 2], vars) : null;
        if (startVal !== null && endVal !== null) {
          const step =
            prevVal !== null && startVal !== prevVal
              ? startVal - prevVal
              : endVal >= startVal
              ? 1
              : -1;
          if (Math.abs(step) > 1e-6) {
            let cur = startVal + step;
            let guard = 0;
            while (
              guard < 200 &&
              (step > 0 ? cur <= endVal + 1e-6 : cur >= endVal - 1e-6)
            ) {
              items.push(String(Math.round(cur * 1e6) / 1e6));
              cur += step;
              guard++;
            }
          }
          idx++; // skip endVal since loop pushed up to endVal
          continue;
        }
      }
      items.push(rawItems[idx]);
    }

    let expanded = '';
    for (const item of items) {
      const vals = item.split('/').map((v) => v.trim());
      let rep = bodyStr;
      varNames.forEach((vn, vIdx) => {
        const val = vals[vIdx] ?? vals[0] ?? '';
        const escName = vn.replace('\\', '\\\\');
        rep = rep.replace(new RegExp(`${escName}(?![a-zA-Z])`, 'g'), val);
      });
      expanded += `${rep}\n`;
    }

    out = out.slice(0, m.index) + expanded + out.slice(endPos);
  }

  return out;
}

function parseOptionsString(
  rawOpts: string,
  base: TikzScopeState,
  customColors: Record<string, string>,
  unitPx = 42
): DrawStyle & {
  scaleX?: number;
  scaleY?: number;
  rotateDeg?: number;
  domain?: [number, number];
  samples?: number;
  step?: number;
  labelSpec?: string;
} {
  const parts = splitTopLevel(rawOpts, ',').map((p) => p.trim()).filter(Boolean);
  const style: DrawStyle & {
    scaleX?: number;
    scaleY?: number;
    rotateDeg?: number;
    domain?: [number, number];
    samples?: number;
    step?: number;
    labelSpec?: string;
  } = {
    stroke: base.color,
    strokeWidth: base.lineWidth,
    dashArray: base.dashArray,
    fill: base.fill,
    fillOpacity: base.fillOpacity,
    strokeOpacity: 1,
  };

  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    const key = (eqIdx === -1 ? part : part.slice(0, eqIdx)).trim();
    const val = (eqIdx === -1 ? '' : part.slice(eqIdx + 1)).trim();
    const cleanVal = val.startsWith('{') && val.endsWith('}') ? val.slice(1, -1).trim() : val;

    if (key === '->' || key === '-latex' || key === '-stealth' || key === '->>') {
      style.arrowEnd = true;
    } else if (key === '<-' || key === 'latex-' || key === 'stealth-') {
      style.arrowStart = true;
    } else if (key === '<->' || key === 'latex-latex' || key === 'stealth-stealth') {
      style.arrowStart = true;
      style.arrowEnd = true;
    } else if (key === 'clip') {
      style.isClip = true;
    } else if (key === 'ultra thin') style.strokeWidth = 0.5;
    else if (key === 'very thin') style.strokeWidth = 0.7;
    else if (key === 'thin') style.strokeWidth = 1.0;
    else if (key === 'semithick') style.strokeWidth = 1.3;
    else if (key === 'thick') style.strokeWidth = 1.8;
    else if (key === 'very thick') style.strokeWidth = 2.4;
    else if (key === 'ultra thick') style.strokeWidth = 3.2;
    else if (key === 'line width' && cleanVal) {
      const px = parseLengthToPx(cleanVal);
      if (px !== null) style.strokeWidth = Math.max(0.4, px);
    } else if (key === 'dashed') style.dashArray = '6,4';
    else if (key === 'densely dashed') style.dashArray = '4,2.5';
    else if (key === 'loosely dashed') style.dashArray = '6,6';
    else if (key === 'dotted') style.dashArray = '1.8,3.2';
    else if (key === 'densely dotted') style.dashArray = '1.6,2';
    else if (key === 'loosely dotted') style.dashArray = '1.8,5.5';
    else if (key === 'solid') style.dashArray = undefined;
    else if (key === 'circle') style.circle = true;
    else if (key === 'color' && cleanVal) {
      const c = resolveTikzColor(cleanVal, customColors);
      if (c) style.stroke = c;
    } else if (key === 'draw' && cleanVal) {
      const c = resolveTikzColor(cleanVal, customColors);
      if (c) style.stroke = c;
    } else if (key === 'fill') {
      if (!cleanVal) style.fill = style.stroke;
      else {
        const c = resolveTikzColor(cleanVal, customColors);
        if (c) style.fill = c;
      }
    } else if (key === 'fill opacity' && cleanVal) {
      const op = parseFloat(cleanVal);
      if (Number.isFinite(op)) style.fillOpacity = Math.max(0, Math.min(1, op));
    } else if (key === 'opacity' && cleanVal) {
      const op = parseFloat(cleanVal);
      if (Number.isFinite(op)) {
        style.fillOpacity = Math.max(0, Math.min(1, op));
        style.strokeOpacity = style.fillOpacity;
      }
    } else if (key === 'pattern' && cleanVal) {
      style.pattern = cleanVal.toLowerCase();
    } else if (key === 'pattern color' && cleanVal) {
      const c = resolveTikzColor(cleanVal, customColors);
      if (c) style.patternColor = c;
    } else if (key === 'x' && cleanVal) {
      const u = parseLengthToTikzUnits(cleanVal, unitPx);
      if (u !== null && u > 0) style.scaleX = (style.scaleX ?? 1) * u;
    } else if (key === 'y' && cleanVal) {
      const u = parseLengthToTikzUnits(cleanVal, unitPx);
      if (u !== null && u > 0) style.scaleY = (style.scaleY ?? 1) * u;
    } else if (key === 'scale' && cleanVal) {
      const sc = parseFloat(cleanVal);
      if (Number.isFinite(sc)) {
        style.scaleX = (style.scaleX ?? 1) * sc;
        style.scaleY = (style.scaleY ?? 1) * sc;
      }
    } else if (key === 'xscale' && cleanVal) {
      const sc = parseFloat(cleanVal);
      if (Number.isFinite(sc)) style.scaleX = (style.scaleX ?? 1) * sc;
    } else if (key === 'yscale' && cleanVal) {
      const sc = parseFloat(cleanVal);
      if (Number.isFinite(sc)) style.scaleY = (style.scaleY ?? 1) * sc;
    } else if (key === 'rotate' && cleanVal) {
      const deg = parseFloat(cleanVal);
      if (Number.isFinite(deg)) style.rotateDeg = (style.rotateDeg ?? 0) + deg;
    } else if (key === 'domain' && cleanVal) {
      const dParts = cleanVal.split(':');
      if (dParts.length === 2) {
        const d0 = evalMathExpr(dParts[0]);
        const d1 = evalMathExpr(dParts[1]);
        if (d0 !== null && d1 !== null) style.domain = [d0, d1];
      }
    } else if (key === 'samples' && cleanVal) {
      const smp = parseInt(cleanVal, 10);
      if (Number.isFinite(smp) && smp >= 2) style.samples = Math.min(400, smp);
    } else if (key === 'step' && cleanVal) {
      const st = parseLengthToTikzUnits(cleanVal, unitPx);
      if (st !== null && st > 0) style.step = st;
    } else if (key === 'pos' && cleanVal) {
      const p = parseFloat(cleanVal);
      if (Number.isFinite(p)) style.pos = p;
    } else if (key === 'midway') style.pos = 0.5;
    else if (key === 'near start') style.pos = 0.25;
    else if (key === 'near end') style.pos = 0.75;
    else if (key === 'at start') style.pos = 0;
    else if (key === 'at end') style.pos = 1;
    else if (
      key === 'above' ||
      key === 'below' ||
      key === 'left' ||
      key === 'right' ||
      key === 'above left' ||
      key === 'above right' ||
      key === 'below left' ||
      key === 'below right'
    ) {
      style.anchor = key;
    } else if (key === 'anchor' && cleanVal) {
      const anchorMap: Record<string, string> = {
        north: 'below',
        south: 'above',
        east: 'left',
        west: 'right',
        'north east': 'below left',
        'north west': 'below right',
        'south east': 'above left',
        'south west': 'above right',
        center: 'center',
      };
      if (anchorMap[cleanVal.toLowerCase()]) {
        style.anchor = anchorMap[cleanVal.toLowerCase()];
      }
    } else if (key === 'xshift' && cleanVal) {
      const px = parseLengthToPx(cleanVal, unitPx);
      if (px !== null) style.shiftXPx = (style.shiftXPx ?? 0) + px;
    } else if (key === 'yshift' && cleanVal) {
      const px = parseLengthToPx(cleanVal, unitPx);
      if (px !== null) style.shiftYPx = (style.shiftYPx ?? 0) - px;
    } else if (key === 'shift' && cleanVal) {
      if (cleanVal.startsWith('(') && cleanVal.endsWith(')')) {
        const coords = splitTopLevel(cleanVal.slice(1, -1), ',');
        if (coords.length === 2) {
          const sx = parseLengthToTikzUnits(coords[0], unitPx) ?? evalMathExpr(coords[0]);
          const sy = parseLengthToTikzUnits(coords[1], unitPx) ?? evalMathExpr(coords[1]);
          if (sx !== null && sy !== null) {
            style.shiftX = (style.shiftX ?? 0) + sx;
            style.shiftY = (style.shiftY ?? 0) + sy;
          }
        }
      }
    } else if (key === 'label' && cleanVal) {
      style.labelSpec = cleanVal;
    } else if (key === 'font' && cleanVal) {
      if (cleanVal.includes('bf') || cleanVal.includes('bold')) style.fontWeight = 'bold';
      if (cleanVal.includes('small') || cleanVal.includes('footnotesize')) style.fontSize = 11;
      if (cleanVal.includes('tiny') || cleanVal.includes('scriptsize')) style.fontSize = 10;
      if (cleanVal.includes('large') || cleanVal.includes('Large')) style.fontSize = 15;
    } else if (key === 'inner sep' && cleanVal) {
      const px = parseLengthToPx(cleanVal, unitPx);
      if (px !== null) style.innerSep = px;
    } else if (key === 'rounded corners') {
      style.roundedCorners = cleanVal ? parseLengthToPx(cleanVal, unitPx) ?? 4 : 4;
    } else if (eqIdx === -1) {
      const c = resolveTikzColor(key, customColors);
      if (c) style.stroke = c;
    }
  }

  return style;
}

function resolveCoordinateExpr(
  rawCoord: string,
  namedCoords: Record<string, Point2D>,
  prevPoint: Point2D,
  isRelativeMove: boolean,
  vars: Record<string, number>
): Point2D | null {
  let s = rawCoord.trim();
  if (s.startsWith('axis cs:')) s = s.slice('axis cs:'.length).trim();

  // Named coordinate
  if (namedCoords[s]) {
    return { ...namedCoords[s] };
  }

  // Orthogonal intersection: (A |- B) -> (A.x, B.y), (A -| B) -> (B.x, A.y)
  const orthoM = s.match(/^(.+?)\s*(\|-|-\|)\s*(.+)$/);
  if (orthoM) {
    const p1 = resolveCoordinateExpr(orthoM[1], namedCoords, prevPoint, false, vars);
    const p2 = resolveCoordinateExpr(orthoM[3], namedCoords, prevPoint, false, vars);
    if (p1 && p2) {
      return orthoM[2] === '|-' ? { x: p1.x, y: p2.y } : { x: p2.x, y: p1.y };
    }
  }

  // Calc syntax: $(A)!0.5!(B)$ or $(A) + (B)$ or $(A)!t!angle:(B)$
  if (s.startsWith('$') && s.endsWith('$')) {
    const inner = s.slice(1, -1).trim();
    const interpM = inner.match(/^\(([^)]+)\)!([^!]+)!\(([^)]+)\)$/);
    if (interpM) {
      const p1 = resolveCoordinateExpr(interpM[1], namedCoords, prevPoint, false, vars);
      const p2 = resolveCoordinateExpr(interpM[3], namedCoords, prevPoint, false, vars);
      const t = evalMathExpr(interpM[2], vars);
      if (p1 && p2 && t !== null) {
        return { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
      }
    }
    // Projection $(A)!(P)!(B)$
    const projM = inner.match(/^\(([^)]+)\)!\(([^)]+)\)!\(([^)]+)\)$/);
    if (projM) {
      const a = resolveCoordinateExpr(projM[1], namedCoords, prevPoint, false, vars);
      const p = resolveCoordinateExpr(projM[2], namedCoords, prevPoint, false, vars);
      const b = resolveCoordinateExpr(projM[3], namedCoords, prevPoint, false, vars);
      if (a && p && b) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        if (len2 > 1e-9) {
          const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
          return { x: a.x + t * dx, y: a.y + t * dy };
        }
      }
    }
    // Sum/diff of coordinates: $(A)+(B)$ or $(A)+(1,2)$
    const addM = inner.match(/^\(([^)]+)\)\s*([+-])\s*(?:(\d+(?:\.\d+)?)\s*\*\s*)?\(([^)]+)\)$/);
    if (addM) {
      const p1 = resolveCoordinateExpr(addM[1], namedCoords, prevPoint, false, vars);
      const p2 = resolveCoordinateExpr(addM[4], namedCoords, prevPoint, false, vars);
      const factor = addM[3] ? parseFloat(addM[3]) : 1;
      const sign = addM[2] === '-' ? -1 : 1;
      if (p1 && p2) {
        return { x: p1.x + sign * factor * p2.x, y: p1.y + sign * factor * p2.y };
      }
    }
  }

  // Polar: (angle:radius)
  const colonParts = splitTopLevel(s, ':');
  if (colonParts.length === 2) {
    const angDeg = evalMathExpr(colonParts[0], vars);
    const rad =
      parseLengthToTikzUnits(colonParts[1]) ?? evalMathExpr(colonParts[1], vars);
    if (angDeg !== null && rad !== null) {
      const radAngle = (angDeg * Math.PI) / 180;
      const pt = { x: rad * Math.cos(radAngle), y: rad * Math.sin(radAngle) };
      return isRelativeMove ? { x: prevPoint.x + pt.x, y: prevPoint.y + pt.y } : pt;
    }
  }

  // Cartesian: (x, y)
  const xyParts = splitTopLevel(s, ',');
  if (xyParts.length === 2) {
    const x = parseLengthToTikzUnits(xyParts[0]) ?? evalMathExpr(xyParts[0], vars);
    const y = parseLengthToTikzUnits(xyParts[1]) ?? evalMathExpr(xyParts[1], vars);
    if (x !== null && y !== null) {
      return isRelativeMove ? { x: prevPoint.x + x, y: prevPoint.y + y } : { x, y };
    }
  }

  return null;
}

function getAnchorOffsets(anchor: string | undefined, w: number, h: number): {
  dx: number;
  dy: number;
  textAnchor: 'start' | 'middle' | 'end';
} {
  const pad = 7;
  switch (anchor) {
    case 'above':
      return { dx: 0, dy: -pad - 3, textAnchor: 'middle' };
    case 'below':
      return { dx: 0, dy: pad + h * 0.85, textAnchor: 'middle' };
    case 'left':
      return { dx: -pad, dy: h * 0.32, textAnchor: 'end' };
    case 'right':
      return { dx: pad, dy: h * 0.32, textAnchor: 'start' };
    case 'above left':
      return { dx: -pad * 0.85, dy: -pad * 0.8, textAnchor: 'end' };
    case 'above right':
      return { dx: pad * 0.85, dy: -pad * 0.8, textAnchor: 'start' };
    case 'below left':
      return { dx: -pad * 0.85, dy: pad + h * 0.75, textAnchor: 'end' };
    case 'below right':
      return { dx: pad * 0.85, dy: pad + h * 0.75, textAnchor: 'start' };
    default:
      return { dx: 0, dy: h * 0.32, textAnchor: 'middle' };
  }
}

function renderAxisEnvToItems(
  axisOptsRaw: string,
  axisBody: string,
  unitPx: number,
  customColors: Record<string, string>,
  items: SvgItem[],
  arrowMarkerIds: Map<string, string>
): void {
  const opts: Record<string, string> = {};
  for (const part of splitTopLevel(axisOptsRaw, ',')) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      if (part.trim()) opts[part.trim()] = 'true';
    } else {
      const k = part.slice(0, eq).trim();
      let v = part.slice(eq + 1).trim();
      if (v.startsWith('{') && v.endsWith('}')) v = v.slice(1, -1).trim();
      opts[k] = v;
    }
  }

  let xmin = opts.xmin ? evalMathExpr(opts.xmin) ?? -5 : -5;
  let xmax = opts.xmax ? evalMathExpr(opts.xmax) ?? 5 : 5;
  let ymin = opts.ymin ? evalMathExpr(opts.ymin) ?? -5 : -5;
  let ymax = opts.ymax ? evalMathExpr(opts.ymax) ?? 5 : 5;
  if (xmax <= xmin) xmax = xmin + 10;
  if (ymax <= ymin) ymax = ymin + 10;

  const plotW = 300;
  const plotH = 240;
  const toSvgX = (x: number) => ((x - xmin) / (xmax - xmin)) * plotW;
  const toSvgY = (y: number) => plotH - ((y - ymin) / (ymax - ymin)) * plotH;

  const ensureArrow = (color: string) => {
    if (!arrowMarkerIds.has(color)) {
      arrowMarkerIds.set(color, `arr_${arrowMarkerIds.size + 1}`);
    }
    return arrowMarkerIds.get(color)!;
  };

  // Grid
  if (opts.grid === 'major' || opts.grid === 'both') {
    const xStep = Math.max(0.5, Math.pow(10, Math.floor(Math.log10((xmax - xmin) / 5))));
    const yStep = Math.max(0.5, Math.pow(10, Math.floor(Math.log10((ymax - ymin) / 5))));
    for (let x = Math.ceil(xmin / xStep) * xStep; x <= xmax + 1e-6; x += xStep) {
      const sx = toSvgX(x);
      items.push({
        kind: 'line',
        svg: `<line x1="${sx.toFixed(1)}" y1="0" x2="${sx.toFixed(1)}" y2="${plotH}" stroke="#E2E8F0" stroke-width="0.8"/>`,
        bounds: { minX: sx, minY: 0, maxX: sx, maxY: plotH },
      });
    }
    for (let y = Math.ceil(ymin / yStep) * yStep; y <= ymax + 1e-6; y += yStep) {
      const sy = toSvgY(y);
      items.push({
        kind: 'line',
        svg: `<line x1="0" y1="${sy.toFixed(1)}" x2="${plotW}" y2="${sy.toFixed(1)}" stroke="#E2E8F0" stroke-width="0.8"/>`,
        bounds: { minX: 0, minY: sy, maxX: plotW, maxY: sy },
      });
    }
  }

  const axisLines = opts['axis lines'] || opts['axis x line'] || 'box';
  const isMiddle = axisLines === 'middle' || axisLines === 'center';
  const axisX = isMiddle ? toSvgY(0) : plotH;
  const axisY = isMiddle ? toSvgX(0) : 0;
  const arrId = ensureArrow('#0F172A');

  if (isMiddle) {
    if (ymin <= 0 && ymax >= 0) {
      items.push({
        kind: 'line',
        svg: `<line x1="0" y1="${axisX.toFixed(1)}" x2="${plotW}" y2="${axisX.toFixed(1)}" stroke="#0F172A" stroke-width="1.2" marker-end="url(#${arrId})"/>`,
        bounds: { minX: 0, minY: axisX - 4, maxX: plotW + 6, maxY: axisX + 4 },
      });
    }
    if (xmin <= 0 && xmax >= 0) {
      items.push({
        kind: 'line',
        svg: `<line x1="${axisY.toFixed(1)}" y1="${plotH}" x2="${axisY.toFixed(1)}" y2="0" stroke="#0F172A" stroke-width="1.2" marker-end="url(#${arrId})"/>`,
        bounds: { minX: axisY - 4, minY: -6, maxX: axisY + 4, maxY: plotH },
      });
    }
    if (xmin <= 0 && xmax >= 0 && ymin <= 0 && ymax >= 0) {
      items.push({
        kind: 'text',
        svg: `<text x="${(axisY - 8).toFixed(1)}" y="${(axisX + 14).toFixed(1)}" font-size="12" font-family="Times New Roman, serif" font-style="italic" text-anchor="end" fill="#0F172A">O</text>`,
        bounds: { minX: axisY - 18, minY: axisX + 2, maxX: axisY - 4, maxY: axisX + 16 },
      });
    }
  } else {
    items.push({
      kind: 'rect',
      svg: `<rect x="0" y="0" width="${plotW}" height="${plotH}" fill="none" stroke="#0F172A" stroke-width="1.1"/>`,
      bounds: { minX: 0, minY: 0, maxX: plotW, maxY: plotH },
    });
  }

  // Ticks
  const parseTicks = (spec: string | undefined, minV: number, maxV: number): number[] => {
    if (spec === '\\empty' || spec === 'none') return [];
    if (spec && spec !== 'true') {
      const out: number[] = [];
      for (const tok of spec.split(',')) {
        const v = evalMathExpr(tok);
        if (v !== null && v >= minV - 1e-6 && v <= maxV + 1e-6) out.push(v);
      }
      if (out.length > 0) return out;
    }
    const span = maxV - minV;
    const rawStep = span / 5;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / mag;
    const step = (norm <= 1.5 ? 1 : norm <= 3.5 ? 2 : norm <= 7.5 ? 5 : 10) * mag;
    const ticks: number[] = [];
    for (let v = Math.ceil(minV / step) * step; v <= maxV + 1e-9; v += step) {
      const r = Math.round(v * 1e6) / 1e6;
      if (!isMiddle || Math.abs(r) > 1e-6) ticks.push(r);
    }
    return ticks;
  };

  for (const xv of parseTicks(opts.xtick, xmin, xmax)) {
    const sx = toSvgX(xv);
    const ty = isMiddle && ymin <= 0 && ymax >= 0 ? axisX : plotH;
    items.push({
      kind: 'line',
      svg: `<line x1="${sx.toFixed(1)}" y1="${(ty - 3).toFixed(1)}" x2="${sx.toFixed(1)}" y2="${(ty + 3).toFixed(1)}" stroke="#0F172A" stroke-width="0.9"/>`,
      bounds: { minX: sx, minY: ty - 3, maxX: sx, maxY: ty + 3 },
    });
    items.push({
      kind: 'text',
      svg: `<text x="${sx.toFixed(1)}" y="${(ty + 15).toFixed(1)}" font-size="11" font-family="Times New Roman, serif" text-anchor="middle" fill="#0F172A">${escapeXmlAttr(String(xv).replace('-', '−'))}</text>`,
      bounds: { minX: sx - 12, minY: ty + 4, maxX: sx + 12, maxY: ty + 18 },
    });
  }

  for (const yv of parseTicks(opts.ytick, ymin, ymax)) {
    const sy = toSvgY(yv);
    const tx = isMiddle && xmin <= 0 && xmax >= 0 ? axisY : 0;
    items.push({
      kind: 'line',
      svg: `<line x1="${(tx - 3).toFixed(1)}" y1="${sy.toFixed(1)}" x2="${(tx + 3).toFixed(1)}" y2="${sy.toFixed(1)}" stroke="#0F172A" stroke-width="0.9"/>`,
      bounds: { minX: tx - 3, minY: sy, maxX: tx + 3, maxY: sy },
    });
    items.push({
      kind: 'text',
      svg: `<text x="${(tx - 7).toFixed(1)}" y="${(sy + 4).toFixed(1)}" font-size="11" font-family="Times New Roman, serif" text-anchor="end" fill="#0F172A">${escapeXmlAttr(String(yv).replace('-', '−'))}</text>`,
      bounds: { minX: tx - 26, minY: sy - 7, maxX: tx - 4, maxY: sy + 6 },
    });
  }

  // Axis labels & title
  if (opts.xlabel) {
    const f = formatTikzLabelToSvg(opts.xlabel, 13);
    const lx = isMiddle ? plotW + 10 : plotW / 2;
    const ly = isMiddle ? axisX + 4 : plotH + 28;
    items.push({
      kind: 'text',
      svg: `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="13" font-family="Times New Roman, serif" text-anchor="${isMiddle ? 'start' : 'middle'}" fill="#0F172A">${f.tspans}</text>`,
      bounds: { minX: lx - 15, minY: ly - 12, maxX: lx + 25, maxY: ly + 6 },
    });
  }
  if (opts.ylabel) {
    const f = formatTikzLabelToSvg(opts.ylabel, 13);
    const lx = isMiddle ? axisY + 8 : -28;
    const ly = isMiddle ? -6 : plotH / 2;
    items.push({
      kind: 'text',
      svg: `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="13" font-family="Times New Roman, serif" text-anchor="${isMiddle ? 'start' : 'middle'}" fill="#0F172A">${f.tspans}</text>`,
      bounds: { minX: lx - 12, minY: ly - 14, maxX: lx + 22, maxY: ly + 4 },
    });
  }
  if (opts.title) {
    const f = formatTikzLabelToSvg(opts.title, 14);
    items.push({
      kind: 'text',
      svg: `<text x="${(plotW / 2).toFixed(1)}" y="-14" font-size="14" font-weight="bold" font-family="Times New Roman, serif" text-anchor="middle" fill="#0F172A">${f.tspans}</text>`,
      bounds: { minX: 20, minY: -30, maxX: plotW - 20, maxY: -8 },
    });
  }

  // Parse statements inside axis (\addplot, \draw, \node)
  const trigRad = opts['trig format plots'] === 'rad' || opts['trig format'] === 'rad';
  const defaultDomain: [number, number] = (() => {
    if (opts.domain) {
      const dp = opts.domain.split(':');
      if (dp.length === 2) {
        const a = evalMathExpr(dp[0]);
        const b = evalMathExpr(dp[1]);
        if (a !== null && b !== null) return [a, b];
      }
    }
    return [xmin, xmax];
  })();
  const defaultSamples = opts.samples ? Math.max(10, Math.min(300, parseInt(opts.samples, 10) || 80)) : 80;
  const palette = ['#2563EB', '#DC2626', '#16A34A', '#9333EA', '#EA580C'];
  let plotCount = 0;

  const stmts = splitTopLevel(expandForeachLoops(axisBody), ';');
  const clipId = `axis_clip_${items.length + 1}`;
  let clipRegistered = false;
  const ensureClip = () => {
    if (!clipRegistered) {
      clipRegistered = true;
      items.push({
        kind: 'path',
        svg: `<defs><clipPath id="${clipId}"><rect x="0" y="0" width="${plotW}" height="${plotH}"/></clipPath></defs>`,
        bounds: { minX: 0, minY: 0, maxX: plotW, maxY: plotH },
      });
    }
    return clipId;
  };

  for (const rawStmt of stmts) {
    const stmt = rawStmt.trim();
    if (!stmt) continue;

    const addPlotM = stmt.match(/^\\addplot3?\+?\s*(?:\[([^\]]*)\])?\s*([\s\S]+)$/);
    if (addPlotM) {
      const pOptsRaw = addPlotM[1] || '';
      const pBody = addPlotM[2].trim();
      const baseState: TikzScopeState = {
        scaleX: 1,
        scaleY: 1,
        shiftX: 0,
        shiftY: 0,
        rotateDeg: 0,
        color: palette[plotCount % palette.length],
        lineWidth: 1.8,
        fill: 'none',
        fillOpacity: 1,
      };
      plotCount++;
      const pStyle = parseOptionsString(pOptsRaw, baseState, customColors);
      const dmn = pStyle.domain ?? defaultDomain;
      const smp = pStyle.samples ?? defaultSamples;
      const ptsList: Point2D[][] = [];

      if (/^coordinates\s*\{/.test(pBody)) {
        const br = readBalanced(pBody, pBody.indexOf('{'), '{', '}');
        if (br) {
          const cur: Point2D[] = [];
          const coordRe = /\(([^,]+),([^)]+)\)/g;
          let cm: RegExpExecArray | null;
          while ((cm = coordRe.exec(br.content)) !== null) {
            const px = evalMathExpr(cm[1]);
            const py = evalMathExpr(cm[2]);
            if (px !== null && py !== null) cur.push({ x: px, y: py });
          }
          if (cur.length > 0) ptsList.push(cur);
        }
      } else {
        let exprStr = pBody.replace(/^(?:expression\s*)?/, '').trim();
        if (exprStr.startsWith('{') && exprStr.endsWith('}')) {
          exprStr = exprStr.slice(1, -1).trim();
        }
        let segment: Point2D[] = [];
        const spanY = ymax - ymin;
        let prevY: number | null = null;
        for (let k = 0; k <= smp; k++) {
          const x = dmn[0] + ((dmn[1] - dmn[0]) * k) / smp;
          const y = evalMathExpr(exprStr, { x }, trigRad);
          if (y === null || !Number.isFinite(y) || Math.abs(y) > Math.max(Math.abs(ymax), Math.abs(ymin)) * 10 + 50) {
            if (segment.length >= 2) ptsList.push(segment);
            segment = [];
            prevY = null;
            continue;
          }
          if (prevY !== null && Math.abs(y - prevY) > spanY * 1.8) {
            if (segment.length >= 2) ptsList.push(segment);
            segment = [];
          }
          segment.push({ x, y });
          prevY = y;
        }
        if (segment.length >= 2) ptsList.push(segment);
      }

      const cid = ensureClip();
      const dashAttr = pStyle.dashArray ? ` stroke-dasharray="${pStyle.dashArray}"` : '';
      for (const seg of ptsList) {
        const dStr = seg
          .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${toSvgX(p.x).toFixed(2)} ${toSvgY(p.y).toFixed(2)}`)
          .join(' ');
        items.push({
          kind: 'path',
          svg: `<path d="${dStr}" fill="none" stroke="${pStyle.stroke}" stroke-width="${pStyle.strokeWidth}"${dashAttr} stroke-linecap="round" stroke-linejoin="round" clip-path="url(#${cid})"/>`,
          bounds: { minX: 0, minY: 0, maxX: plotW, maxY: plotH },
        });
      }
      continue;
    }

    // \draw or \node inside axis using (x,y) or (axis cs:x,y)
    const nodeM = stmt.match(/^\\node(?:\s*\[([^\]]*)\])?\s*(?:\(([^)]+)\))?\s*at\s*\(([^)]+)\)\s*\{/);
    if (nodeM) {
      const br = readBalanced(stmt, stmt.indexOf('{', nodeM[0].length - 1), '{', '}');
      if (br) {
        const rawC = nodeM[3].replace(/^axis cs:/, '').trim();
        const xy = splitTopLevel(rawC, ',');
        const nx = xy.length === 2 ? evalMathExpr(xy[0]) : null;
        const ny = xy.length === 2 ? evalMathExpr(xy[1]) : null;
        if (nx !== null && ny !== null) {
          const sx = toSvgX(nx);
          const sy = toSvgY(ny);
          const st = parseOptionsString(
            nodeM[1] || '',
            {
              scaleX: 1,
              scaleY: 1,
              shiftX: 0,
              shiftY: 0,
              rotateDeg: 0,
              color: '#0F172A',
              lineWidth: 1,
              fill: 'none',
              fillOpacity: 1,
            },
            customColors
          );
          const f = formatTikzLabelToSvg(br.content, st.fontSize ?? 12);
          const off = getAnchorOffsets(st.anchor, 14, 14);
          items.push({
            kind: 'text',
            svg: `<text x="${(sx + off.dx).toFixed(1)}" y="${(sy + off.dy).toFixed(1)}" font-size="${st.fontSize ?? 12}" font-family="Times New Roman, serif" text-anchor="${off.textAnchor}" fill="${st.stroke}">${f.tspans}</text>`,
            bounds: {
              minX: sx + off.dx - f.plainLength * 4,
              minY: sy + off.dy - 12,
              maxX: sx + off.dx + f.plainLength * 4,
              maxY: sy + off.dy + 4,
            },
          });
        }
      }
    }
  }
  void unitPx;
}

function renderTkzTabToItems(
  body: string,
  items: SvgItem[],
  arrowMarkerIds: Map<string, string>
): boolean {
  if (!/\\tkzTab(?:Init|Line|Var|Ima)/.test(body)) return false;

  // Parse \tkzTabInit[...]{rows}{xCols}
  const initM = /\\tkzTabInit(?:\s*\[([^\]]*)\])?\s*\{/.exec(body);
  if (!initM) return false;
  const rowsBr = readBalanced(body, initM.index + initM[0].length - 1, '{', '}');
  if (!rowsBr) return false;
  let pos = rowsBr.endIdx + 1;
  while (pos < body.length && /\s/.test(body[pos])) pos++;
  const xColsBr = body[pos] === '{' ? readBalanced(body, pos, '{', '}') : null;
  if (!xColsBr) return false;

  const rowSpecs = splitTopLevel(rowsBr.content, ',').map((r) => {
    const slashIdx = r.lastIndexOf('/');
    if (slashIdx === -1) return { label: r.trim(), hFactor: 1 };
    return {
      label: r.slice(0, slashIdx).trim(),
      hFactor: Math.max(0.8, parseFloat(r.slice(slashIdx + 1).trim()) || 1),
    };
  });
  const xLabels = splitTopLevel(xColsBr.content, ',').map((x) => x.trim());
  const numCols = Math.max(2, xLabels.length);

  const labelColW = 72;
  const colStepW = Math.max(72, Math.min(115, 420 / numCols));
  const totalW = labelColW + (numCols - 1) * colStepW + 56;
  const headerH = Math.round(34 * (rowSpecs[0]?.hFactor ?? 1));

  // Column X positions inside table
  const colX = (idx: number) => labelColW + 28 + idx * colStepW;

  let curY = 0;

  // Header row (x values)
  const hY = curY;
  const xHeader = formatTikzLabelToSvg(rowSpecs[0]?.label || '$x$', 13);
  items.push({
    kind: 'rect',
    svg: `<rect x="0" y="${hY}" width="${totalW}" height="${headerH}" fill="none" stroke="#0F172A" stroke-width="1.1"/>`,
    bounds: { minX: 0, minY: hY, maxX: totalW, maxY: hY + headerH },
  });
  items.push({
    kind: 'line',
    svg: `<line x1="${labelColW}" y1="${hY}" x2="${labelColW}" y2="${hY + headerH}" stroke="#0F172A" stroke-width="1.1"/>`,
    bounds: { minX: labelColW, minY: hY, maxX: labelColW, maxY: hY + headerH },
  });
  items.push({
    kind: 'text',
    svg: `<text x="${(labelColW / 2).toFixed(1)}" y="${(hY + headerH / 2 + 5).toFixed(1)}" font-size="13" font-family="Times New Roman, serif" text-anchor="middle" fill="#0F172A">${xHeader.tspans}</text>`,
    bounds: { minX: 4, minY: hY, maxX: labelColW - 4, maxY: hY + headerH },
  });

  xLabels.forEach((xl, idx) => {
    const f = formatTikzLabelToSvg(xl, 13);
    items.push({
      kind: 'text',
      svg: `<text x="${colX(idx).toFixed(1)}" y="${(hY + headerH / 2 + 5).toFixed(1)}" font-size="13" font-family="Times New Roman, serif" text-anchor="middle" fill="#0F172A">${f.tspans}</text>`,
      bounds: { minX: colX(idx) - 24, minY: hY, maxX: colX(idx) + 24, maxY: hY + headerH },
    });
  });

  curY += headerH;

  // Extract \tkzTabLine and \tkzTabVar in document order
  const cmdRe = /\\tkzTab(Line|Var|Ima)(?:\s*\[([^\]]*)\])?\s*\{/g;
  let cm: RegExpExecArray | null;
  let rowSpecIdx = 1;
  let lastVarYTop = 0;
  let lastVarYBot = 0;
  let lastVarRowH = 0;
  let lastVarNodes: Array<{ col: number; level: 'top' | 'mid' | 'bot' }> = [];

  if (!arrowMarkerIds.has('#0F172A')) {
    arrowMarkerIds.set('#0F172A', `arr_${arrowMarkerIds.size + 1}`);
  }
  const arrId = arrowMarkerIds.get('#0F172A')!;

  while ((cm = cmdRe.exec(body)) !== null) {
    const kind = cm[1];
    const br = readBalanced(body, cm.index + cm[0].length - 1, '{', '}');
    if (!br) continue;

    if (kind === 'Line') {
      const spec = rowSpecs[rowSpecIdx] ?? { label: "$f'(x)$", hFactor: 1 };
      rowSpecIdx++;
      const rowH = Math.round(34 * spec.hFactor);
      const rY = curY;

      items.push({
        kind: 'rect',
        svg: `<rect x="0" y="${rY}" width="${totalW}" height="${rowH}" fill="none" stroke="#0F172A" stroke-width="1.1"/>`,
        bounds: { minX: 0, minY: rY, maxX: totalW, maxY: rY + rowH },
      });
      items.push({
        kind: 'line',
        svg: `<line x1="${labelColW}" y1="${rY}" x2="${labelColW}" y2="${rY + rowH}" stroke="#0F172A" stroke-width="1.1"/>`,
        bounds: { minX: labelColW, minY: rY, maxX: labelColW, maxY: rY + rowH },
      });

      const lblF = formatTikzLabelToSvg(spec.label, 13);
      items.push({
        kind: 'text',
        svg: `<text x="${(labelColW / 2).toFixed(1)}" y="${(rY + rowH / 2 + 5).toFixed(1)}" font-size="13" font-family="Times New Roman, serif" text-anchor="middle" fill="#0F172A">${lblF.tspans}</text>`,
        bounds: { minX: 4, minY: rY, maxX: labelColW - 4, maxY: rY + rowH },
      });

      const tokens = splitTopLevel(br.content, ',').map((t) => t.trim());
      // tkzTabLine format: token 0 is before x0, token 1 is at x0, token 2 is between x0 and x1, token 3 is at x1...
      tokens.forEach((tok, idx) => {
        if (!tok) return;
        const isAtNode = idx % 2 === 1;
        const k = Math.floor((idx - 1) / 2);
        const cx = isAtNode ? colX(k) : idx === 0 ? labelColW + 14 : (colX(k) + colX(k + 1)) / 2;

        if (tok === 'd' || tok === '||') {
          items.push({
            kind: 'line',
            svg: `<line x1="${(cx - 2).toFixed(1)}" y1="${rY}" x2="${(cx - 2).toFixed(1)}" y2="${rY + rowH}" stroke="#0F172A" stroke-width="1.1"/><line x1="${(cx + 2).toFixed(1)}" y1="${rY}" x2="${(cx + 2).toFixed(1)}" y2="${rY + rowH}" stroke="#0F172A" stroke-width="1.1"/>`,
            bounds: { minX: cx - 3, minY: rY, maxX: cx + 3, maxY: rY + rowH },
          });
        } else if (tok === 'z') {
          items.push({
            kind: 'line',
            svg: `<line x1="${cx.toFixed(1)}" y1="${rY}" x2="${cx.toFixed(1)}" y2="${rY + rowH}" stroke="#0F172A" stroke-width="0.9"/>`,
            bounds: { minX: cx, minY: rY, maxX: cx, maxY: rY + rowH },
          });
          items.push({
            kind: 'rect',
            svg: `<rect x="${(cx - 5.5).toFixed(1)}" y="${(rY + rowH / 2 - 7.5).toFixed(1)}" width="11" height="15" fill="#FFFFFF" stroke="none"/>`,
            bounds: { minX: cx - 5.5, minY: rY + rowH / 2 - 7.5, maxX: cx + 5.5, maxY: rY + rowH / 2 + 7.5 },
          });
          items.push({
            kind: 'text',
            svg: `<text x="${cx.toFixed(1)}" y="${(rY + rowH / 2 + 5).toFixed(1)}" font-size="13" font-family="Times New Roman, serif" text-anchor="middle" fill="#0F172A">0</text>`,
            bounds: { minX: cx - 6, minY: rY, maxX: cx + 6, maxY: rY + rowH },
          });
        } else if (tok === 't') {
          items.push({
            kind: 'line',
            svg: `<line x1="${cx.toFixed(1)}" y1="${rY}" x2="${cx.toFixed(1)}" y2="${rY + rowH}" stroke="#64748B" stroke-width="0.9" stroke-dasharray="3,3"/>`,
            bounds: { minX: cx, minY: rY, maxX: cx, maxY: rY + rowH },
          });
        } else if (tok === 'h') {
          const xStart = idx === 0 ? labelColW : colX(Math.max(0, k));
          const xEnd = idx === 0 ? colX(0) : colX(Math.min(numCols - 1, k + 1));
          items.push({
            kind: 'rect',
            svg: `<rect x="${xStart.toFixed(1)}" y="${rY}" width="${Math.max(10, xEnd - xStart).toFixed(1)}" height="${rowH}" fill="url(#pat_ne)" stroke="none"/>`,
            bounds: { minX: xStart, minY: rY, maxX: xEnd, maxY: rY + rowH },
          });
        } else {
          const tf = formatTikzLabelToSvg(tok === '+' || tok === '-' ? `$${tok}$` : tok, 14);
          items.push({
            kind: 'text',
            svg: `<text x="${cx.toFixed(1)}" y="${(rY + rowH / 2 + 5).toFixed(1)}" font-size="14" font-family="Times New Roman, serif" text-anchor="middle" fill="#0F172A">${tf.tspans}</text>`,
            bounds: { minX: cx - 10, minY: rY, maxX: cx + 10, maxY: rY + rowH },
          });
        }
      });

      curY += rowH;
    } else if (kind === 'Var') {
      const spec = rowSpecs[rowSpecIdx] ?? { label: '$f(x)$', hFactor: 2 };
      rowSpecIdx++;
      const rowH = Math.round(44 * Math.max(1.6, spec.hFactor));
      const rY = curY;
      const topY = rY + 18;
      const botY = rY + rowH - 12;
      const midY = (topY + botY) / 2;
      lastVarYTop = topY;
      lastVarYBot = botY;
      lastVarRowH = rowH;
      lastVarNodes = [];

      items.push({
        kind: 'rect',
        svg: `<rect x="0" y="${rY}" width="${totalW}" height="${rowH}" fill="none" stroke="#0F172A" stroke-width="1.1"/>`,
        bounds: { minX: 0, minY: rY, maxX: totalW, maxY: rY + rowH },
      });
      items.push({
        kind: 'line',
        svg: `<line x1="${labelColW}" y1="${rY}" x2="${labelColW}" y2="${rY + rowH}" stroke="#0F172A" stroke-width="1.1"/>`,
        bounds: { minX: labelColW, minY: rY, maxX: labelColW, maxY: rY + rowH },
      });

      const lblF = formatTikzLabelToSvg(spec.label, 13);
      items.push({
        kind: 'text',
        svg: `<text x="${(labelColW / 2).toFixed(1)}" y="${(rY + rowH / 2 + 5).toFixed(1)}" font-size="13" font-family="Times New Roman, serif" text-anchor="middle" fill="#0F172A">${lblF.tspans}</text>`,
        bounds: { minX: 4, minY: rY, maxX: labelColW - 4, maxY: rY + rowH },
      });

      const varEntries = splitTopLevel(br.content, ',').map((t) => t.trim());
      interface VarPoint {
        col: number;
        x: number;
        y: number;
        level: 'top' | 'mid' | 'bot';
        offset?: number;
        skipArrow?: boolean;
      }
      const leftPts: Array<VarPoint | null> = [];
      const rightPts: Array<VarPoint | null> = [];

      varEntries.forEach((entry, idx) => {
        if (!entry || idx >= numCols) {
          leftPts.push(null);
          rightPts.push(null);
          return;
        }
        const cx = colX(idx);
        const parts = splitTopLevel(entry, '/');
        const tag = (parts[0] || '').trim();
        const val1 = (parts[1] || '').trim();
        const val2 = (parts[2] || '').trim();

        const yForChar = (ch: string): { y: number; level: 'top' | 'mid' | 'bot' } =>
          ch === '+'
            ? { y: topY, level: 'top' }
            : ch === '-'
            ? { y: botY, level: 'bot' }
            : { y: midY, level: 'mid' };

        if (/[DdH]|\|\|/.test(tag)) {
          // Double vertical bar discontinuity
          items.push({
            kind: 'line',
            svg: `<line x1="${(cx - 2).toFixed(1)}" y1="${rY}" x2="${(cx - 2).toFixed(1)}" y2="${rY + rowH}" stroke="#0F172A" stroke-width="1.1"/><line x1="${(cx + 2).toFixed(1)}" y1="${rY}" x2="${(cx + 2).toFixed(1)}" y2="${rY + rowH}" stroke="#0F172A" stroke-width="1.1"/>`,
            bounds: { minX: cx - 3, minY: rY, maxX: cx + 3, maxY: rY + rowH },
          });
          const chars = tag.replace(/[^+-]/g, '');
          const lInfo = yForChar(chars[0] || '+');
          const rInfo = yForChar(chars[1] || chars[0] || '-');
          let lWidth = 10;
          if (val1) {
            const f1 = formatTikzLabelToSvg(val1, 12);
            lWidth = Math.max(10, Math.min(28, f1.plainLength * 7.2));
            items.push({
              kind: 'text',
              svg: `<text x="${(cx - 7).toFixed(1)}" y="${lInfo.y.toFixed(1)}" font-size="12" font-family="Times New Roman, serif" text-anchor="end" fill="#0F172A">${f1.tspans}</text>`,
              bounds: { minX: cx - 7 - lWidth, minY: rY, maxX: cx - 4, maxY: rY + rowH },
            });
          }
          const rightLabel = val2 || (/^[DdH]/.test(tag) ? val1 : '');
          let rWidth = 10;
          if (rightLabel) {
            const f2 = formatTikzLabelToSvg(rightLabel, 12);
            rWidth = Math.max(10, Math.min(28, f2.plainLength * 7.2));
            items.push({
              kind: 'text',
              svg: `<text x="${(cx + 7).toFixed(1)}" y="${rInfo.y.toFixed(1)}" font-size="12" font-family="Times New Roman, serif" text-anchor="start" fill="#0F172A">${f2.tspans}</text>`,
              bounds: { minX: cx + 4, minY: rY, maxX: cx + 7 + rWidth, maxY: rY + rowH },
            });
          }
          leftPts.push({ col: idx, x: cx - 9 - lWidth, y: lInfo.y - 4, level: lInfo.level, offset: 0 });
          rightPts.push({ col: idx, x: cx + 9 + rWidth, y: rInfo.y - 4, level: rInfo.level, offset: 0 });
          lastVarNodes.push({ col: idx, level: lInfo.level });
        } else if (tag === 'R' || tag.startsWith('R')) {
          leftPts.push(null);
          rightPts.push(null);
        } else {
          const posChar = tag[0] === '+' || tag[0] === '-' ? tag[0] : '0';
          const info = yForChar(posChar);
          let halfW = 14;
          if (val1) {
            const f1 = formatTikzLabelToSvg(val1, 13);
            halfW = Math.max(12, Math.min(24, f1.plainLength * 4.2));
            items.push({
              kind: 'text',
              svg: `<text x="${cx.toFixed(1)}" y="${info.y.toFixed(1)}" font-size="13" font-family="Times New Roman, serif" text-anchor="middle" fill="#0F172A">${f1.tspans}</text>`,
              bounds: { minX: cx - halfW - 4, minY: rY, maxX: cx + halfW + 4, maxY: rY + rowH },
            });
          }
          const pt: VarPoint = { col: idx, x: cx, y: info.y - 4, level: info.level, offset: halfW + 3 };
          leftPts.push(pt);
          rightPts.push(pt);
          lastVarNodes.push({ col: idx, level: info.level });
        }
      });

      // Connect arrows between valid consecutive var points
      for (let idx = 0; idx < numCols - 1; idx++) {
        const p1 = rightPts[idx];
        const p2 = leftPts[idx + 1];
        if (!p1 || !p2) continue;
        const x1 = p1.x + (p1.offset ?? 8);
        const x2 = p2.x - (p2.offset ?? 8);
        if (x2 <= x1 + 4) continue;
        items.push({
          kind: 'line',
          svg: `<line x1="${x1.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${p2.y.toFixed(1)}" stroke="#0F172A" stroke-width="1.2" marker-end="url(#${arrId})"/>`,
          bounds: { minX: x1, minY: rY, maxX: x2, maxY: rY + rowH },
        });
      }

      curY += rowH;
    } else if (kind === 'Ima') {
      // \tkzTabIma{startCol}{endCol}{posCol}{label}
      const imaMatch = /\\tkzTabIma(?:\s*\[[^\]]*\])?\s*\{([^}]*)\}\s*\{([^}]*)\}\s*\{([^}]*)\}\s*\{([^}]*)\}/.exec(
        body.slice(cm.index)
      );
      if (imaMatch && lastVarRowH > 0) {
        const cStart = Math.max(0, (parseInt(imaMatch[1], 10) || 1) - 1);
        const cEnd = Math.max(0, (parseInt(imaMatch[2], 10) || 2) - 1);
        const cPos = Math.max(0, (parseInt(imaMatch[3], 10) || 1) - 1);
        const frac = cEnd !== cStart ? (cPos - cStart) / (cEnd - cStart) : 0.5;
        const nStart = lastVarNodes.find((n) => n.col === cStart);
        const nEnd = lastVarNodes.find((n) => n.col === cEnd);
        const yS = nStart?.level === 'top' ? lastVarYTop : nStart?.level === 'bot' ? lastVarYBot : (lastVarYTop + lastVarYBot) / 2;
        const yE = nEnd?.level === 'top' ? lastVarYTop : nEnd?.level === 'bot' ? lastVarYBot : (lastVarYTop + lastVarYBot) / 2;
        const iy = yS + (yE - yS) * frac;
        const ix = colX(cPos);
        const f = formatTikzLabelToSvg(imaMatch[4], 12);
        items.push({
          kind: 'rect',
          svg: `<rect x="${(ix - 12).toFixed(1)}" y="${(iy - 11).toFixed(1)}" width="24" height="15" fill="#FFFFFF" stroke="none"/>`,
          bounds: { minX: ix - 12, minY: iy - 11, maxX: ix + 12, maxY: iy + 4 },
        });
        items.push({
          kind: 'text',
          svg: `<text x="${ix.toFixed(1)}" y="${iy.toFixed(1)}" font-size="12" font-family="Times New Roman, serif" text-anchor="middle" fill="#0F172A">${f.tspans}</text>`,
          bounds: { minX: ix - 12, minY: iy - 11, maxX: ix + 12, maxY: iy + 4 },
        });
      }
    }
  }

  return items.length > 0;
}

function preprocessTkzEuclide(body: string): {
  body: string;
  presetCoords: Record<string, Point2D>;
} {
  const presetCoords: Record<string, Point2D> = {};
  let out = body;

  // \tkzDefPoint(x,y){A}
  out = out.replace(
    /\\tkzDefPoint(?:\[[^\]]*\])?\s*\(([^,]+),([^)]+)\)\s*\{([^}]+)\}/g,
    (_m, xStr: string, yStr: string, name: string) => {
      const x = evalMathExpr(xStr);
      const y = evalMathExpr(yStr);
      if (x !== null && y !== null) presetCoords[name.trim()] = { x, y };
      return '';
    }
  );

  // \tkzDefPoints{0/0/A, 4/0/B}
  out = out.replace(/\\tkzDefPoints\s*\{([^}]+)\}/g, (_m, list: string) => {
    for (const item of list.split(',')) {
      const p = item.trim().split('/');
      if (p.length >= 3) {
        const x = evalMathExpr(p[0]);
        const y = evalMathExpr(p[1]);
        if (x !== null && y !== null) presetCoords[p[2].trim()] = { x, y };
      }
    }
    return '';
  });

  // \tkzDefMidPoint(A,B)\tkzGetPoint{M}
  out = out.replace(
    /\\tkzDefMidPoint\s*\(([^,]+),([^)]+)\)\s*\\tkzGetPoint\s*\{([^}]+)\}/g,
    (_m, a: string, b: string, target: string) => {
      const pa = presetCoords[a.trim()];
      const pb = presetCoords[b.trim()];
      if (pa && pb) {
        presetCoords[target.trim()] = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
      }
      return '';
    }
  );

  // \tkzDrawPolygon[opts](A,B,C) -> \draw[opts] (A)--(B)--(C)--cycle;
  out = out.replace(
    /\\tkzDrawPolygon(?:\[([^\]]*)\])?\s*\(([^)]+)\)/g,
    (_m, opts: string | undefined, pts: string) => {
      const names = pts.split(',').map((s) => `(${s.trim()})`).join(' -- ');
      return `\\draw[${opts || ''}] ${names} -- cycle;`;
    }
  );

  // \tkzDrawSegments[opts](A,B C,D)
  out = out.replace(
    /\\tkzDrawSegments(?:\[([^\]]*)\])?\s*\(([^)]+)\)/g,
    (_m, opts: string | undefined, segs: string) => {
      return segs
        .trim()
        .split(/\s+/)
        .map((pair) => {
          const [a, b] = pair.split(',');
          return a && b ? `\\draw[${opts || ''}] (${a.trim()}) -- (${b.trim()});` : '';
        })
        .join('\n');
    }
  );

  // \tkzDrawSegment[opts](A,B)
  out = out.replace(
    /\\tkzDrawSegment(?:\[([^\]]*)\])?\s*\(([^,]+),([^)]+)\)/g,
    (_m, opts: string | undefined, a: string, b: string) =>
      `\\draw[${opts || ''}] (${a.trim()}) -- (${b.trim()});`
  );

  // \tkzDrawPoints[opts](A,B,C)
  out = out.replace(
    /\\tkzDrawPoints(?:\[[^\]]*\])?\s*\(([^)]+)\)/g,
    (_m, pts: string) =>
      pts
        .split(',')
        .map((p) => `\\fill (${p.trim()}) circle (2pt);`)
        .join('\n')
  );

  // \tkzLabelPoints[above](A,B,C)
  out = out.replace(
    /\\tkzLabelPoints(?:\[([^\]]*)\])?\s*\(([^)]+)\)/g,
    (_m, opts: string | undefined, pts: string) =>
      pts
        .split(',')
        .map((p) => `\\node[${opts || 'below'}] at (${p.trim()}) {$${p.trim()}$};`)
        .join('\n')
  );

  // \tkzDrawCircle[R](O,2cm) or \tkzDrawCircle(O,A)
  out = out.replace(
    /\\tkzDrawCircle(?:\[([^\]]*)\])?\s*\(([^,]+),([^)]+)\)/g,
    (_m, opts: string | undefined, oName: string, second: string) => {
      const oPt = presetCoords[oName.trim()];
      if (!oPt) return '';
      if (opts && /\bR\b/.test(opts)) {
        return `\\draw (${oName.trim()}) circle (${second.trim()});`;
      }
      const aPt = presetCoords[second.trim()];
      if (aPt) {
        const r = Math.hypot(aPt.x - oPt.x, aPt.y - oPt.y);
        return `\\draw (${oName.trim()}) circle (${r.toFixed(4)});`;
      }
      return '';
    }
  );

  // \tkzMarkRightAngle(B,A,C)
  out = out.replace(
    /\\tkzMarkRightAngle(?:\[[^\]]*\])?\s*\(([^,]+),([^,]+),([^)]+)\)/g,
    (_m, bName: string, aName: string, cName: string) => {
      const pb = presetCoords[bName.trim()];
      const pa = presetCoords[aName.trim()];
      const pc = presetCoords[cName.trim()];
      if (!pa || !pb || !pc) return '';
      const lb = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
      const lc = Math.hypot(pc.x - pa.x, pc.y - pa.y) || 1;
      const sz = 0.25;
      const u = { x: ((pb.x - pa.x) / lb) * sz, y: ((pb.y - pa.y) / lb) * sz };
      const v = { x: ((pc.x - pa.x) / lc) * sz, y: ((pc.y - pa.y) / lc) * sz };
      const p1 = { x: pa.x + u.x, y: pa.y + u.y };
      const p2 = { x: pa.x + u.x + v.x, y: pa.y + u.y + v.y };
      const p3 = { x: pa.x + v.x, y: pa.y + v.y };
      return `\\draw[thin] (${p1.x.toFixed(3)},${p1.y.toFixed(3)}) -- (${p2.x.toFixed(3)},${p2.y.toFixed(3)}) -- (${p3.x.toFixed(3)},${p3.y.toFixed(3)});`;
    }
  );

  // Support tkz-fct commands (\tkzInit, \tkzClip, \tkzAxeXY, \tkzDrawX, \tkzDrawY, \tkzFct)
  let tkzBounds = { xmin: -4, xmax: 4, ymin: -4, ymax: 4 };
  out = out.replace(/\\tkzInit(?:\s*\[([^\]]*)\])?\s*;?/g, (_m, optsRaw: string | undefined) => {
    if (optsRaw) {
      for (const part of splitTopLevel(optsRaw, ',')) {
        const eq = part.indexOf('=');
        if (eq === -1) continue;
        const k = part.slice(0, eq).trim();
        const v = evalMathExpr(part.slice(eq + 1).trim());
        if (v !== null) {
          if (k === 'xmin') tkzBounds.xmin = v;
          else if (k === 'xmax') tkzBounds.xmax = v;
          else if (k === 'ymin') tkzBounds.ymin = v;
          else if (k === 'ymax') tkzBounds.ymax = v;
        }
      }
    }
    return '';
  });
  out = out.replace(
    /\\tkzClip(?:\s*\[[^\]]*\])?\s*;?/g,
    () => `\\clip (${tkzBounds.xmin},${tkzBounds.ymin}) rectangle (${tkzBounds.xmax},${tkzBounds.ymax});`
  );
  out = out.replace(
    /\\tkzDrawX(?:\s*\[[^\]]*\])?\s*;?/g,
    () => `\\draw[->] (${tkzBounds.xmin},0) -- (${tkzBounds.xmax},0) node[below]{$x$};`
  );
  out = out.replace(
    /\\tkzDrawY(?:\s*\[[^\]]*\])?\s*;?/g,
    () => `\\draw[->] (0,${tkzBounds.ymin}) -- (0,${tkzBounds.ymax}) node[left]{$y$};`
  );
  out = out.replace(/\\tkzAxeXY(?:\s*\[[^\]]*\])?\s*;?/g, () => {
    const cmds = [
      `\\draw[->] (${tkzBounds.xmin},0) -- (${tkzBounds.xmax},0) node[below]{$x$};`,
      `\\draw[->] (0,${tkzBounds.ymin}) -- (0,${tkzBounds.ymax}) node[left]{$y$};`,
      `\\node[below left] at (0,0) {$O$};`,
    ];
    return cmds.join('\n');
  });
  out = out.replace(
    /\\tkzFct(?:\s*\[([^\]]*)\])?\s*\{([^}]*)\}\s*;?/g,
    (_m, optsRaw: string | undefined, expr: string) => {
      const o = optsRaw ? `${optsRaw},domain=${tkzBounds.xmin}:${tkzBounds.xmax}` : `domain=${tkzBounds.xmin}:${tkzBounds.xmax}`;
      const normExpr = expr.replace(/\\x\b/g, 'x').replace(/\bx\b/g, '\\x');
      return `\\draw[${o}] plot(\\x, {${normExpr}});`;
    }
  );

  return { body: out, presetCoords };
}

function executeTikzStatements(
  rawBody: string,
  scope: TikzScopeState,
  namedCoords: Record<string, Point2D>,
  customColors: Record<string, string>,
  items: SvgItem[],
  arrowMarkerIds: Map<string, string>,
  patternsUsed: Map<string, string>,
  unitPx: number
): void {
  const expandedBody = expandForeachLoops(rawBody);

  // Extract \begin{axis}...\end{axis} first
  let body = expandedBody;
  const axisRe = /\\begin\{axis\}\s*(?:\[([^\]]*)\])?/;
  let axisM: RegExpExecArray | null;
  while ((axisM = axisRe.exec(body)) !== null) {
    const startInner = axisM.index + axisM[0].length;
    const endIdx = body.indexOf('\\end{axis}', startInner);
    if (endIdx === -1) break;
    renderAxisEnvToItems(
      axisM[1] || '',
      body.slice(startInner, endIdx),
      unitPx,
      customColors,
      items,
      arrowMarkerIds
    );
    body = body.slice(0, axisM.index) + body.slice(endIdx + '\\end{axis}'.length);
  }

  // Handle \begin{scope}...\end{scope} recursively
  const scopeRe = /\\begin\{scope\}\s*(?:\[([^\]]*)\])?/;
  let scopeM: RegExpExecArray | null;
  while ((scopeM = scopeRe.exec(body)) !== null) {
    const startInner = scopeM.index + scopeM[0].length;
    // Find matching \end{scope}
    let depth = 1;
    let cursor = startInner;
    let foundEnd = -1;
    while (cursor < body.length) {
      if (body.startsWith('\\begin{scope}', cursor)) {
        depth++;
        cursor += 13;
        continue;
      }
      if (body.startsWith('\\end{scope}', cursor)) {
        depth--;
        if (depth === 0) {
          foundEnd = cursor;
          break;
        }
        cursor += 11;
        continue;
      }
      cursor++;
    }
    if (foundEnd === -1) break;
    const st = parseOptionsString(scopeM[1] || '', scope, customColors, unitPx);
    const childScope: TikzScopeState = {
      ...scope,
      scaleX: scope.scaleX * (st.scaleX ?? 1),
      scaleY: scope.scaleY * (st.scaleY ?? 1),
      shiftX: scope.shiftX + (st.shiftX ?? 0),
      shiftY: scope.shiftY + (st.shiftY ?? 0),
      shiftXPx: (scope.shiftXPx ?? 0) + (st.shiftXPx ?? 0),
      shiftYPx: (scope.shiftYPx ?? 0) + (st.shiftYPx ?? 0),
      rotateDeg: scope.rotateDeg + (st.rotateDeg ?? 0),
      color: st.stroke,
      lineWidth: st.strokeWidth,
      dashArray: st.dashArray,
      fill: st.fill,
      fillOpacity: st.fillOpacity,
    };
    executeTikzStatements(
      body.slice(startInner, foundEnd),
      childScope,
      namedCoords,
      customColors,
      items,
      arrowMarkerIds,
      patternsUsed,
      unitPx
    );
    body = body.slice(0, scopeM.index) + body.slice(foundEnd + '\\end{scope}'.length);
  }

  const scopeToSvgPt = (pt: Point2D, sc: TikzScopeState): Point2D => {
    let x = pt.x * sc.scaleX + sc.shiftX;
    let y = pt.y * sc.scaleY + sc.shiftY;
    if (sc.rotateDeg !== 0) {
      const r = (sc.rotateDeg * Math.PI) / 180;
      const rx = x * Math.cos(r) - y * Math.sin(r);
      const ry = x * Math.sin(r) + y * Math.cos(r);
      x = rx;
      y = ry;
    }
    return {
      x: x * unitPx + (sc.shiftXPx ?? 0),
      y: -y * unitPx + (sc.shiftYPx ?? 0),
    };
  };
  const toSvgPt = (pt: Point2D): Point2D => scopeToSvgPt(pt, scope);

  const ensureArrow = (color: string) => {
    if (!arrowMarkerIds.has(color)) {
      arrowMarkerIds.set(color, `arr_${arrowMarkerIds.size + 1}`);
    }
    return arrowMarkerIds.get(color)!;
  };

  const ensurePattern = (patName: string, color: string) => {
    const key = `${patName}::${color}`;
    if (!patternsUsed.has(key)) {
      patternsUsed.set(key, `pat_${patternsUsed.size + 1}`);
    }
    return patternsUsed.get(key)!;
  };

  const statements = splitTopLevel(body, ';');
  for (const rawStmt of statements) {
    const stmt = rawStmt.trim();
    if (!stmt) continue;

    // \coordinate[opts] (name) at (x,y)
    const coordM = stmt.match(
      /^\\coordinate(?:\s*\[([^\]]*)\])?\s*\(([^)]+)\)\s*at\s*\(([^)]+)\)$/
    );
    if (coordM) {
      const pt = resolveCoordinateExpr(coordM[3], namedCoords, { x: 0, y: 0 }, false, {});
      if (pt) {
        namedCoords[coordM[2].trim()] = pt;
        if (coordM[1]) {
          const st = parseOptionsString(coordM[1], scope, customColors);
          if (st.labelSpec) {
            const sp = toSvgPt(pt);
            const parts = st.labelSpec.split(':');
            const anchor = parts.length === 2 ? parts[0].trim() : 'above';
            const lbl = parts.length === 2 ? parts[1].trim() : st.labelSpec;
            const f = formatTikzLabelToSvg(lbl, 13);
            const off = getAnchorOffsets(anchor, 12, 12);
            items.push({
              kind: 'text',
              svg: `<text x="${(sp.x + off.dx).toFixed(1)}" y="${(sp.y + off.dy).toFixed(1)}" font-size="13" font-family="Times New Roman, serif" text-anchor="${off.textAnchor}" fill="${st.stroke}">${f.tspans}</text>`,
              bounds: {
                minX: sp.x + off.dx - f.plainLength * 4.5,
                minY: sp.y + off.dy - 13,
                maxX: sp.x + off.dx + f.plainLength * 4.5,
                maxY: sp.y + off.dy + 5,
              },
            });
          }
        }
      }
      continue;
    }

    // \node[opts] (name)? at (x,y) {text}
    const nodeM = stmt.match(
      /^\\node(?:\s*\[([^\]]*)\])?\s*(?:\(([^)]+)\))?\s*(?:at\s*\(([^)]+)\))?\s*\{/
    );
    if (nodeM) {
      const braceIdx = stmt.indexOf('{', nodeM[0].length - 1);
      const br = readBalanced(stmt, braceIdx, '{', '}');
      if (br) {
        const pt = nodeM[3]
          ? resolveCoordinateExpr(nodeM[3], namedCoords, { x: 0, y: 0 }, false, {})
          : { x: 0, y: 0 };
        if (pt) {
          if (nodeM[2]) namedCoords[nodeM[2].trim()] = pt;
          const st = parseOptionsString(nodeM[1] || '', scope, customColors, unitPx);
          const sp = toSvgPt(pt);
          const f = formatTikzLabelToSvg(br.content, st.fontSize ?? 13);
          const off = getAnchorOffsets(st.anchor, 14, 14);
          const tx = sp.x + off.dx + (st.shiftXPx ?? 0) + (st.shiftX ?? 0) * unitPx;
          const ty = sp.y + off.dy + (st.shiftYPx ?? 0) - (st.shiftY ?? 0) * unitPx;
          const fw = st.fontWeight ? ` font-weight="${st.fontWeight}"` : '';
          const halfW = Math.max(8, f.plainLength * 4.5);
          items.push({
            kind: 'text',
            svg: `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" font-size="${st.fontSize ?? 13}" font-family="Times New Roman, serif"${fw} text-anchor="${off.textAnchor}" fill="${st.stroke}">${f.tspans}</text>`,
            bounds: {
              minX:
                off.textAnchor === 'middle'
                  ? tx - halfW
                  : off.textAnchor === 'end'
                  ? tx - halfW * 2
                  : tx,
              minY: ty - 14,
              maxX:
                off.textAnchor === 'middle'
                  ? tx + halfW
                  : off.textAnchor === 'start'
                  ? tx + halfW * 2
                  : tx,
              maxY: ty + 5,
            },
          });
        }
      }
      continue;
    }

    // \draw, \fill, \filldraw, \path, \shadedraw, \clip
    const drawM = stmt.match(
      /^\\(draw|filldraw|fill|path|shadedraw|shade|clip)(?:\s*\[([^\]]*)\])?\s*([\s\S]+)$/
    );
    if (!drawM) continue;

    const cmd = drawM[1];
    const st = parseOptionsString(drawM[2] || '', scope, customColors, unitPx);
    const isClipStmt = cmd === 'clip' || Boolean(st.isClip);
    if (cmd === 'fill' || cmd === 'filldraw' || cmd === 'shadedraw' || cmd === 'shade') {
      if (st.fill === 'none') st.fill = st.stroke;
    }
    const doStroke = cmd !== 'fill' && cmd !== 'clip' && cmd !== 'path';
    const doFill =
      cmd === 'fill' ||
      cmd === 'filldraw' ||
      cmd === 'shadedraw' ||
      cmd === 'shade' ||
      st.fill !== 'none' ||
      Boolean(st.pattern);

    const drawScope: TikzScopeState = {
      ...scope,
      scaleX: scope.scaleX * (st.scaleX ?? 1),
      scaleY: scope.scaleY * (st.scaleY ?? 1),
      shiftX: scope.shiftX + (st.shiftX ?? 0),
      shiftY: scope.shiftY + (st.shiftY ?? 0),
      shiftXPx: (scope.shiftXPx ?? 0) + (st.shiftXPx ?? 0),
      shiftYPx: (scope.shiftYPx ?? 0) + (st.shiftYPx ?? 0),
      rotateDeg: scope.rotateDeg + (st.rotateDeg ?? 0),
    };
    const localToSvgPt = (pt: Point2D): Point2D => scopeToSvgPt(pt, drawScope);

    const pathStr = drawM[3].trim();
    let idx = 0;
    let curPt: Point2D = { x: 0, y: 0 };
    let startPt: Point2D = { x: 0, y: 0 };
    let hasSubpath = false;
    let dCmds: string[] = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const expandBBox = (sx: number, sy: number, pad = 2) => {
      if (sx - pad < minX) minX = sx - pad;
      if (sy - pad < minY) minY = sy - pad;
      if (sx + pad > maxX) maxX = sx + pad;
      if (sy + pad > maxY) maxY = sy + pad;
    };

    let lastSegFrom = curPt;
    let lastSegTo = curPt;

    while (idx < pathStr.length) {
      while (idx < pathStr.length && /\s/.test(pathStr[idx])) idx++;
      if (idx >= pathStr.length) break;

      // Relative prefix + or ++
      let relMode = false;
      let updateCur = true;
      if (pathStr.slice(idx, idx + 2) === '++') {
        relMode = true;
        idx += 2;
      } else if (pathStr[idx] === '+') {
        relMode = true;
        updateCur = false;
        idx += 1;
      }

      // Coordinate (...)
      if (pathStr[idx] === '(') {
        const paren = readBalanced(pathStr, idx, '(', ')');
        if (!paren) break;
        const pt = resolveCoordinateExpr(paren.content, namedCoords, curPt, relMode, {});
        idx = paren.endIdx + 1;
        if (pt) {
          const sp = localToSvgPt(pt);
          expandBBox(sp.x, sp.y);
          if (!hasSubpath) {
            dCmds.push(`M ${sp.x.toFixed(2)} ${sp.y.toFixed(2)}`);
            startPt = pt;
            hasSubpath = true;
          } else {
            dCmds.push(`M ${sp.x.toFixed(2)} ${sp.y.toFixed(2)}`);
          }
          if (updateCur) {
            lastSegFrom = curPt;
            lastSegTo = pt;
            curPt = pt;
          }
        }
        continue;
      }

      // Connectors: --, |-, -|
      if (
        pathStr.startsWith('--', idx) ||
        pathStr.startsWith('|-', idx) ||
        pathStr.startsWith('-|', idx)
      ) {
        const conn = pathStr.slice(idx, idx + 2);
        idx += 2;
        while (idx < pathStr.length && /\s/.test(pathStr[idx])) idx++;

        if (pathStr.startsWith('cycle', idx)) {
          idx += 5;
          dCmds.push('Z');
          curPt = startPt;
          continue;
        }

        let rMode = false;
        let uCur = true;
        if (pathStr.slice(idx, idx + 2) === '++') {
          rMode = true;
          idx += 2;
        } else if (pathStr[idx] === '+') {
          rMode = true;
          uCur = false;
          idx += 1;
        }
        while (idx < pathStr.length && /\s/.test(pathStr[idx])) idx++;

        if (pathStr[idx] === '(') {
          const paren = readBalanced(pathStr, idx, '(', ')');
          if (!paren) break;
          const nextPt = resolveCoordinateExpr(paren.content, namedCoords, curPt, rMode, {});
          idx = paren.endIdx + 1;
          if (nextPt) {
            if (conn === '|-') {
              const mid = localToSvgPt({ x: curPt.x, y: nextPt.y });
              expandBBox(mid.x, mid.y);
              dCmds.push(`L ${mid.x.toFixed(2)} ${mid.y.toFixed(2)}`);
            } else if (conn === '-|') {
              const mid = localToSvgPt({ x: nextPt.x, y: curPt.y });
              expandBBox(mid.x, mid.y);
              dCmds.push(`L ${mid.x.toFixed(2)} ${mid.y.toFixed(2)}`);
            }
            const sp = localToSvgPt(nextPt);
            expandBBox(sp.x, sp.y);
            dCmds.push(`L ${sp.x.toFixed(2)} ${sp.y.toFixed(2)}`);
            lastSegFrom = curPt;
            lastSegTo = nextPt;
            if (uCur) curPt = nextPt;
          }
        }
        continue;
      }

      // Cubic/Quadratic Bezier: .. controls (c1) [and (c2)] .. (end)
      if (pathStr.startsWith('..', idx)) {
        const ctrlM = pathStr
          .slice(idx)
          .match(
            /^\.\.\s*controls\s*\(([^)]+)\)\s*(?:and\s*\(([^)]+)\)\s*)?\.\.\s*(?:(\+\+|\+))?\s*\(([^)]+)\)/
          );
        if (ctrlM) {
          const c1 = resolveCoordinateExpr(ctrlM[1], namedCoords, curPt, false, {});
          const c2 = ctrlM[2]
            ? resolveCoordinateExpr(ctrlM[2], namedCoords, curPt, false, {})
            : c1;
          const endPt = resolveCoordinateExpr(
            ctrlM[4],
            namedCoords,
            curPt,
            Boolean(ctrlM[3]),
            {}
          );
          if (c1 && c2 && endPt) {
            const sc1 = localToSvgPt(c1);
            const sc2 = localToSvgPt(c2);
            const se = localToSvgPt(endPt);
            expandBBox(sc1.x, sc1.y);
            expandBBox(sc2.x, sc2.y);
            expandBBox(se.x, se.y);
            dCmds.push(
              `C ${sc1.x.toFixed(2)} ${sc1.y.toFixed(2)}, ${sc2.x.toFixed(2)} ${sc2.y.toFixed(2)}, ${se.x.toFixed(2)} ${se.y.toFixed(2)}`
            );
            lastSegFrom = curPt;
            lastSegTo = endPt;
            curPt = endPt;
          }
          idx += ctrlM[0].length;
          continue;
        }
      }

      // rectangle (x2, y2)
      if (pathStr.startsWith('rectangle', idx)) {
        const restR = pathStr.slice(idx + 9).trimStart();
        const parenIdx = pathStr.indexOf('(', idx + 9);
        if (parenIdx !== -1 && restR.startsWith('(')) {
          const paren = readBalanced(pathStr, parenIdx, '(', ')');
          if (paren) {
            const p2 = resolveCoordinateExpr(paren.content, namedCoords, curPt, false, {});
            if (p2) {
              const s1 = localToSvgPt(curPt);
              const s2 = localToSvgPt(p2);
              const rx = Math.min(s1.x, s2.x);
              const ry = Math.min(s1.y, s2.y);
              const rw = Math.abs(s2.x - s1.x);
              const rh = Math.abs(s2.y - s1.y);
              expandBBox(rx, ry);
              expandBBox(rx + rw, ry + rh);
              dCmds.push(
                `M ${rx.toFixed(2)} ${ry.toFixed(2)} L ${(rx + rw).toFixed(2)} ${ry.toFixed(2)} L ${(rx + rw).toFixed(2)} ${(ry + rh).toFixed(2)} L ${rx.toFixed(2)} ${(ry + rh).toFixed(2)} Z`
              );
              curPt = p2;
            }
            idx = paren.endIdx + 1;
            continue;
          }
        }
      }

      // circle (r) or circle [radius=r]
      if (pathStr.startsWith('circle', idx)) {
        let rPx: number | null = null;
        let nextIdx = idx + 6;
        while (nextIdx < pathStr.length && /\s/.test(pathStr[nextIdx])) nextIdx++;
        if (pathStr[nextIdx] === '(') {
          const paren = readBalanced(pathStr, nextIdx, '(', ')');
          if (paren) {
            rPx =
              parseLengthToPx(paren.content, unitPx * Math.abs(drawScope.scaleX)) ??
              (evalMathExpr(paren.content) ?? 0) * unitPx * Math.abs(drawScope.scaleX);
            nextIdx = paren.endIdx + 1;
          }
        } else if (pathStr[nextIdx] === '[') {
          const brk = readBalanced(pathStr, nextIdx, '[', ']');
          if (brk) {
            const radM = brk.content.match(/radius\s*=\s*([^,\]]+)/);
            if (radM) {
              rPx =
                parseLengthToPx(radM[1], unitPx * Math.abs(drawScope.scaleX)) ??
                (evalMathExpr(radM[1]) ?? 0) * unitPx * Math.abs(drawScope.scaleX);
            }
            nextIdx = brk.endIdx + 1;
          }
        }
        if (rPx !== null && rPx > 0) {
          const c = localToSvgPt(curPt);
          expandBBox(c.x - rPx, c.y - rPx);
          expandBBox(c.x + rPx, c.y + rPx);
          // Emit circle via SVG path so fill/stroke/clip share one pipeline cleanly
          dCmds.push(
            `M ${(c.x - rPx).toFixed(2)} ${c.y.toFixed(2)} A ${rPx.toFixed(2)} ${rPx.toFixed(2)} 0 1 0 ${(c.x + rPx).toFixed(2)} ${c.y.toFixed(2)} A ${rPx.toFixed(2)} ${rPx.toFixed(2)} 0 1 0 ${(c.x - rPx).toFixed(2)} ${c.y.toFixed(2)} Z`
          );
        }
        idx = nextIdx;
        continue;
      }

      // arc (start:end:r) or arc [start angle=..., end angle=..., radius=...]
      if (pathStr.startsWith('arc', idx)) {
        let nextIdx = idx + 3;
        while (nextIdx < pathStr.length && /\s/.test(pathStr[nextIdx])) nextIdx++;
        let aStart: number | null = null;
        let aEnd: number | null = null;
        let rUnits: number | null = null;
        if (pathStr[nextIdx] === '(') {
          const paren = readBalanced(pathStr, nextIdx, '(', ')');
          if (paren) {
            const parts = paren.content.split(':');
            if (parts.length === 3) {
              aStart = evalMathExpr(parts[0]);
              aEnd = evalMathExpr(parts[1]);
              rUnits = parseLengthToTikzUnits(parts[2], unitPx) ?? evalMathExpr(parts[2]);
            }
            nextIdx = paren.endIdx + 1;
          }
        } else if (pathStr[nextIdx] === '[') {
          const brk = readBalanced(pathStr, nextIdx, '[', ']');
          if (brk) {
            const sm = brk.content.match(/start angle\s*=\s*([^,\]]+)/);
            const em = brk.content.match(/end angle\s*=\s*([^,\]]+)/);
            const rm = brk.content.match(/radius\s*=\s*([^,\]]+)/);
            if (sm && em && rm) {
              aStart = evalMathExpr(sm[1]);
              aEnd = evalMathExpr(em[1]);
              rUnits = parseLengthToTikzUnits(rm[1], unitPx) ?? evalMathExpr(rm[1]);
            }
            nextIdx = brk.endIdx + 1;
          }
        }
        if (aStart !== null && aEnd !== null && rUnits !== null && rUnits > 0) {
          const r1 = (aStart * Math.PI) / 180;
          const r2 = (aEnd * Math.PI) / 180;
          const center: Point2D = {
            x: curPt.x - rUnits * Math.cos(r1),
            y: curPt.y - rUnits * Math.sin(r1),
          };
          const endPt: Point2D = {
            x: center.x + rUnits * Math.cos(r2),
            y: center.y + rUnits * Math.sin(r2),
          };
          const steps = 28;
          for (let k = 1; k <= steps; k++) {
            const ang = r1 + ((r2 - r1) * k) / steps;
            const sp = localToSvgPt({
              x: center.x + rUnits * Math.cos(ang),
              y: center.y + rUnits * Math.sin(ang),
            });
            expandBBox(sp.x, sp.y);
            dCmds.push(`L ${sp.x.toFixed(2)} ${sp.y.toFixed(2)}`);
          }
          curPt = endPt;
        }
        idx = nextIdx;
        continue;
      }

      // grid (x2, y2)
      if (pathStr.startsWith('grid', idx)) {
        let nextIdx = idx + 4;
        while (nextIdx < pathStr.length && /\s/.test(pathStr[nextIdx])) nextIdx++;
        if (pathStr[nextIdx] === '(') {
          const paren = readBalanced(pathStr, nextIdx, '(', ')');
          if (paren) {
            const p2 = resolveCoordinateExpr(paren.content, namedCoords, curPt, false, {});
            if (p2) {
              const step = st.step ?? 1;
              const x0 = Math.min(curPt.x, p2.x);
              const x1 = Math.max(curPt.x, p2.x);
              const y0 = Math.min(curPt.y, p2.y);
              const y1 = Math.max(curPt.y, p2.y);
              for (let gx = x0; gx <= x1 + 1e-6; gx += step) {
                const a = localToSvgPt({ x: gx, y: y0 });
                const b = localToSvgPt({ x: gx, y: y1 });
                expandBBox(a.x, a.y);
                expandBBox(b.x, b.y);
                dCmds.push(`M ${a.x.toFixed(2)} ${a.y.toFixed(2)} L ${b.x.toFixed(2)} ${b.y.toFixed(2)}`);
              }
              for (let gy = y0; gy <= y1 + 1e-6; gy += step) {
                const a = localToSvgPt({ x: x0, y: gy });
                const b = localToSvgPt({ x: x1, y: gy });
                expandBBox(a.x, a.y);
                expandBBox(b.x, b.y);
                dCmds.push(`M ${a.x.toFixed(2)} ${a.y.toFixed(2)} L ${b.x.toFixed(2)} ${b.y.toFixed(2)}`);
              }
            }
            idx = paren.endIdx + 1;
            continue;
          }
        }
      }

      // plot[domain=..., samples=...] (\x, {expr}) or plot coordinates {...}
      if (pathStr.startsWith('plot', idx)) {
        let nextIdx = idx + 4;
        let plotOptsRaw = '';
        while (nextIdx < pathStr.length && /\s/.test(pathStr[nextIdx])) nextIdx++;
        if (pathStr[nextIdx] === '[') {
          const brk = readBalanced(pathStr, nextIdx, '[', ']');
          if (brk) {
            plotOptsRaw = brk.content;
            nextIdx = brk.endIdx + 1;
          }
        }
        const pStyle = parseOptionsString(plotOptsRaw, drawScope, customColors, unitPx);
        while (nextIdx < pathStr.length && /\s/.test(pathStr[nextIdx])) nextIdx++;
        if (pathStr.startsWith('coordinates', nextIdx)) {
          const braceIdx = pathStr.indexOf('{', nextIdx);
          if (braceIdx !== -1) {
            const br = readBalanced(pathStr, braceIdx, '{', '}');
            if (br) {
              const coordRe = /\(([^,]+),([^)]+)\)/g;
              let cm: RegExpExecArray | null;
              let first = true;
              while ((cm = coordRe.exec(br.content)) !== null) {
                const px = evalMathExpr(cm[1]);
                const py = evalMathExpr(cm[2]);
                if (px !== null && py !== null) {
                  const sp = localToSvgPt({ x: px, y: py });
                  expandBBox(sp.x, sp.y);
                  dCmds.push(`${first ? 'M' : 'L'} ${sp.x.toFixed(2)} ${sp.y.toFixed(2)}`);
                  first = false;
                }
              }
              idx = br.endIdx + 1;
              continue;
            }
          }
        } else if (pathStr[nextIdx] === '(') {
          const paren = readBalanced(pathStr, nextIdx, '(', ')');
          if (paren) {
            const xy = splitTopLevel(paren.content, ',');
            if (xy.length === 2) {
              const varMatch = xy[0].match(/\\[a-zA-Z]+/);
              const varName = varMatch ? varMatch[0] : 'x';
              const dmn = pStyle.domain ?? st.domain ?? [-3, 3];
              const smp = Math.max(80, pStyle.samples ?? st.samples ?? 120);
              const cb = scope.clipBounds;
              const yMinPx = cb ? cb.minY - 40 : -650;
              const yMaxPx = cb ? cb.maxY + 40 : 650;
              const maxAbsY = cb ? 400 : Math.max(16, Math.abs(dmn[1] - dmn[0]) * 2.5);

              let first = true;
              let prevY: number | null = null;
              let prevSp: Point2D | null = null;
              for (let k = 0; k <= smp; k++) {
                const t = dmn[0] + ((dmn[1] - dmn[0]) * k) / smp;
                const vars = { [varName]: t, x: t, t };
                const px = evalMathExpr(xy[0], vars);
                const py = evalMathExpr(xy[1], vars);
                if (px === null || py === null || !Number.isFinite(py) || Math.abs(py) > maxAbsY) {
                  first = true;
                  prevY = null;
                  prevSp = null;
                  continue;
                }
                const sp = localToSvgPt({ x: px, y: py });
                const isAsymptoteJump =
                  prevY !== null &&
                  (Math.abs(py - prevY) > 15 || (prevY * py < 0 && Math.abs(py - prevY) > 6));
                if (isAsymptoteJump) {
                  first = true;
                  prevSp = null;
                }

                const spInRange = sp.y >= yMinPx && sp.y <= yMaxPx;
                if (!spInRange) {
                  if (!first && prevSp && prevSp.y >= yMinPx && prevSp.y <= yMaxPx) {
                    const edgeY = sp.y < yMinPx ? yMinPx : yMaxPx;
                    const denom = sp.y - prevSp.y;
                    if (Math.abs(denom) > 1e-6) {
                      const frac = (edgeY - prevSp.y) / denom;
                      const edgeX = prevSp.x + (sp.x - prevSp.x) * frac;
                      expandBBox(edgeX, edgeY);
                      dCmds.push(`L ${edgeX.toFixed(2)} ${edgeY.toFixed(2)}`);
                    }
                  }
                  first = true;
                  prevY = py;
                  prevSp = sp;
                  continue;
                }

                if (first && prevSp && (prevSp.y < yMinPx || prevSp.y > yMaxPx) && !isAsymptoteJump) {
                  const edgeY = prevSp.y < yMinPx ? yMinPx : yMaxPx;
                  const denom = sp.y - prevSp.y;
                  if (Math.abs(denom) > 1e-6) {
                    const frac = (edgeY - prevSp.y) / denom;
                    const edgeX = prevSp.x + (sp.x - prevSp.x) * frac;
                    expandBBox(edgeX, edgeY);
                    dCmds.push(`M ${edgeX.toFixed(2)} ${edgeY.toFixed(2)}`);
                    first = false;
                  }
                }

                expandBBox(sp.x, sp.y);
                dCmds.push(`${first ? 'M' : 'L'} ${sp.x.toFixed(2)} ${sp.y.toFixed(2)}`);
                first = false;
                prevY = py;
                prevSp = sp;
              }
            }
            idx = paren.endIdx + 1;
            continue;
          }
        }
      }

      // Inline node[...] {...} along path
      if (pathStr.startsWith('node', idx)) {
        const restN = pathStr.slice(idx);
        const nm = restN.match(/^node(?:\s*\[([^\]]*)\])?\s*(?:\(([^)]+)\))?\s*\{/);
        if (nm) {
          const braceIdx = idx + nm[0].length - 1;
          const br = readBalanced(pathStr, braceIdx, '{', '}');
          if (br) {
            const nStyle = parseOptionsString(nm[1] || '', drawScope, customColors, unitPx);
            const tPos = nStyle.pos ?? 1;
            const anchorPt: Point2D =
              nStyle.pos !== undefined
                ? {
                    x: lastSegFrom.x + (lastSegTo.x - lastSegFrom.x) * tPos,
                    y: lastSegFrom.y + (lastSegTo.y - lastSegFrom.y) * tPos,
                  }
                : curPt;
            const sp = localToSvgPt(anchorPt);
            const f = formatTikzLabelToSvg(br.content, nStyle.fontSize ?? 13);
            const off = getAnchorOffsets(nStyle.anchor, 14, 14);
            const tx = sp.x + off.dx + (nStyle.shiftXPx ?? 0) + (nStyle.shiftX ?? 0) * unitPx;
            const ty = sp.y + off.dy + (nStyle.shiftYPx ?? 0) - (nStyle.shiftY ?? 0) * unitPx;
            const halfW = Math.max(8, f.plainLength * 4.5);
            items.push({
              kind: 'text',
              svg: `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" font-size="${nStyle.fontSize ?? 13}" font-family="Times New Roman, serif" text-anchor="${off.textAnchor}" fill="${nStyle.stroke}">${f.tspans}</text>`,
              bounds: {
                minX:
                  off.textAnchor === 'middle'
                    ? tx - halfW
                    : off.textAnchor === 'end'
                    ? tx - halfW * 2
                    : tx,
                minY: ty - 14,
                maxX:
                  off.textAnchor === 'middle'
                    ? tx + halfW
                    : off.textAnchor === 'start'
                    ? tx + halfW * 2
                    : tx,
                maxY: ty + 5,
              },
            });
            idx = br.endIdx + 1;
            continue;
          }
        }
      }

      // Inline coordinate (name)
      if (pathStr.startsWith('coordinate', idx)) {
        const cm = pathStr.slice(idx).match(/^coordinate(?:\s*\[[^\]]*\])?\s*\(([^)]+)\)/);
        if (cm) {
          namedCoords[cm[1].trim()] = { ...curPt };
          idx += cm[0].length;
          continue;
        }
      }

      // to[...] (pt)
      if (pathStr.startsWith('to', idx) && !/[a-zA-Z]/.test(pathStr[idx + 2] || '')) {
        let nextIdx = idx + 2;
        let bendDeg = 0;
        while (nextIdx < pathStr.length && /\s/.test(pathStr[nextIdx])) nextIdx++;
        if (pathStr[nextIdx] === '[') {
          const brk = readBalanced(pathStr, nextIdx, '[', ']');
          if (brk) {
            const bl = brk.content.match(/bend left(?:\s*=\s*(-?\d+(?:\.\d+)?))?/);
            const brr = brk.content.match(/bend right(?:\s*=\s*(-?\d+(?:\.\d+)?))?/);
            if (bl) bendDeg = parseFloat(bl[1] ?? '30') || 30;
            if (brr) bendDeg = -(parseFloat(brr[1] ?? '30') || 30);
            nextIdx = brk.endIdx + 1;
          }
        }
        while (nextIdx < pathStr.length && /\s/.test(pathStr[nextIdx])) nextIdx++;
        if (pathStr[nextIdx] === '(') {
          const paren = readBalanced(pathStr, nextIdx, '(', ')');
          if (paren) {
            const nextPt = resolveCoordinateExpr(paren.content, namedCoords, curPt, false, {});
            if (nextPt) {
            const s1 = localToSvgPt(curPt);
            const s2 = localToSvgPt(nextPt);
            if (bendDeg !== 0) {
              const mx = (s1.x + s2.x) / 2;
              const my = (s1.y + s2.y) / 2;
              const dx = s2.x - s1.x;
              const dy = s2.y - s1.y;
              const k = Math.tan((bendDeg * Math.PI) / 360) * 0.65;
              const cx = mx + dy * k;
              const cy = my - dx * k;
              expandBBox(cx, cy);
              expandBBox(s2.x, s2.y);
              dCmds.push(`Q ${cx.toFixed(2)} ${cy.toFixed(2)}, ${s2.x.toFixed(2)} ${s2.y.toFixed(2)}`);
            } else {
              expandBBox(s2.x, s2.y);
              dCmds.push(`L ${s2.x.toFixed(2)} ${s2.y.toFixed(2)}`);
            }
            lastSegFrom = curPt;
            lastSegTo = nextPt;
            curPt = nextPt;
          }
          idx = paren.endIdx + 1;
          continue;
        }
      }
    }

    idx++;
  }

    if (dCmds.length > 0 && minX < Infinity) {
      const dStr = dCmds.join(' ');
      if (isClipStmt) {
        const clipId = `clip_${items.length + 1}`;
        const rawBounds = { minX, minY, maxX, maxY };
        const clippedBounds = scope.clipBounds
          ? {
              minX: Math.max(scope.clipBounds.minX, rawBounds.minX),
              minY: Math.max(scope.clipBounds.minY, rawBounds.minY),
              maxX: Math.min(scope.clipBounds.maxX, rawBounds.maxX),
              maxY: Math.min(scope.clipBounds.maxY, rawBounds.maxY),
            }
          : rawBounds;
        scope.clipId = clipId;
        scope.clipBounds = clippedBounds;
        items.push({
          kind: 'path',
          svg: `<defs><clipPath id="${clipId}"><path d="${dStr}"/></clipPath></defs>`,
          bounds: clippedBounds,
        });
      }

      if (!isClipStmt || cmd === 'draw' || cmd === 'filldraw') {
        const arrowPad = st.arrowStart || st.arrowEnd ? 6 : 0;
        let itemBounds = {
          minX: minX - arrowPad,
          minY: minY - arrowPad,
          maxX: maxX + arrowPad,
          maxY: maxY + arrowPad,
        };
        if (scope.clipBounds && !isClipStmt) {
          const cb = scope.clipBounds;
          itemBounds = {
            minX: Math.max(cb.minX, itemBounds.minX),
            minY: Math.max(cb.minY, itemBounds.minY),
            maxX: Math.min(cb.maxX, itemBounds.maxX),
            maxY: Math.min(cb.maxY, itemBounds.maxY),
          };
          if (itemBounds.minX > itemBounds.maxX || itemBounds.minY > itemBounds.maxY) {
            continue;
          }
        }
        let fillAttr = 'none';
        let fillOpAttr = '';
        if (doFill && !isClipStmt) {
          if (st.pattern) {
            const patId = ensurePattern(st.pattern, st.patternColor ?? st.stroke);
            fillAttr = `url(#${patId})`;
          } else {
            fillAttr = st.fill;
            if (st.fillOpacity < 1) fillOpAttr = ` fill-opacity="${st.fillOpacity}"`;
          }
        }
        const strokeAttr = doStroke ? st.stroke : 'none';
        const dashAttr = st.dashArray ? ` stroke-dasharray="${st.dashArray}"` : '';
        const opAttr = st.strokeOpacity < 1 ? ` stroke-opacity="${st.strokeOpacity}"` : '';
        const mStart =
          doStroke && st.arrowStart ? ` marker-start="url(#${ensureArrow(st.stroke)})"` : '';
        const mEnd =
          doStroke && st.arrowEnd ? ` marker-end="url(#${ensureArrow(st.stroke)})"` : '';
        const clipAttr = scope.clipId && !isClipStmt ? ` clip-path="url(#${scope.clipId})"` : '';

        items.push({
          kind: 'path',
          svg: `<path d="${dStr}" fill="${fillAttr}"${fillOpAttr} stroke="${strokeAttr}" stroke-width="${st.strokeWidth}"${dashAttr}${opAttr} stroke-linecap="round" stroke-linejoin="round"${mStart}${mEnd}${clipAttr}/>`,
          bounds: itemBounds,
        });
      }
    }
  }
}

function renderPictureEnvToItems(
  envOptsRaw: string,
  body: string,
  items: SvgItem[],
  arrowMarkerIds: Map<string, string>
): void {
  // Standard LaTeX \begin{picture}(w,h)...\end{picture}
  const sizeM = envOptsRaw.match(/^\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/);
  const scalePx = sizeM
    ? (() => {
        const w = parseFloat(sizeM[1]) || 10;
        return w > 40 ? 2.5 : 36;
      })()
    : 32;

  const ensureArrow = (c: string) => {
    if (!arrowMarkerIds.has(c)) arrowMarkerIds.set(c, `arr_${arrowMarkerIds.size + 1}`);
    return arrowMarkerIds.get(c)!;
  };

  const putRe = /\\put\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)\s*\{/g;
  let pm: RegExpExecArray | null;
  while ((pm = putRe.exec(body)) !== null) {
    const x = (evalMathExpr(pm[1]) ?? 0) * scalePx;
    const y = -(evalMathExpr(pm[2]) ?? 0) * scalePx;
    const br = readBalanced(body, pm.index + pm[0].length - 1, '{', '}');
    if (!br) continue;
    const inner = br.content.trim();

    const lineM = inner.match(/^\\(line|vector)\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)\s*\{([^}]+)\}$/);
    if (lineM) {
      const isVec = lineM[1] === 'vector';
      const dx = evalMathExpr(lineM[2]) ?? 1;
      const dy = evalMathExpr(lineM[3]) ?? 0;
      const len = (evalMathExpr(lineM[4]) ?? 1) * scalePx;
      const norm = Math.hypot(dx, dy) || 1;
      const x2 = x + (dx / norm) * len;
      const y2 = y - (dy / norm) * len;
      const mEnd = isVec ? ` marker-end="url(#${ensureArrow('#0F172A')})"` : '';
      items.push({
        kind: 'line',
        svg: `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#0F172A" stroke-width="1.3"${mEnd}/>`,
        bounds: {
          minX: Math.min(x, x2) - 4,
          minY: Math.min(y, y2) - 4,
          maxX: Math.max(x, x2) + 4,
          maxY: Math.max(y, y2) + 4,
        },
      });
      continue;
    }

    const circM = inner.match(/^\\circle(\*?)\s*\{([^}]+)\}$/);
    if (circM) {
      const filled = Boolean(circM[1]);
      const r = ((evalMathExpr(circM[2]) ?? 1) * scalePx) / 2;
      items.push({
        kind: 'circle',
        svg: `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${filled ? '#0F172A' : 'none'}" stroke="#0F172A" stroke-width="1.2"/>`,
        bounds: { minX: x - r, minY: y - r, maxX: x + r, maxY: y + r },
      });
      continue;
    }

    const f = formatTikzLabelToSvg(inner, 13);
    if (f.tspans) {
      items.push({
        kind: 'text',
        svg: `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="13" font-family="Times New Roman, serif" fill="#0F172A">${f.tspans}</text>`,
        bounds: { minX: x, minY: y - 13, maxX: x + f.plainLength * 8, maxY: y + 4 },
      });
    }
  }

  const qbezRe = /\\qbezier\s*\(([^,]+),([^)]+)\)\s*\(([^,]+),([^)]+)\)\s*\(([^,]+),([^)]+)\)/g;
  let qm: RegExpExecArray | null;
  while ((qm = qbezRe.exec(body)) !== null) {
    const x1 = (evalMathExpr(qm[1]) ?? 0) * scalePx;
    const y1 = -(evalMathExpr(qm[2]) ?? 0) * scalePx;
    const cx = (evalMathExpr(qm[3]) ?? 0) * scalePx;
    const cy = -(evalMathExpr(qm[4]) ?? 0) * scalePx;
    const x2 = (evalMathExpr(qm[5]) ?? 0) * scalePx;
    const y2 = -(evalMathExpr(qm[6]) ?? 0) * scalePx;
    items.push({
      kind: 'path',
      svg: `<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="#0F172A" stroke-width="1.3"/>`,
      bounds: {
        minX: Math.min(x1, cx, x2),
        minY: Math.min(y1, cy, y2),
        maxX: Math.max(x1, cx, x2),
        maxY: Math.max(y1, cy, y2),
      },
    });
  }
}

export function renderLatexPictureToSvgDataUrl(
  envName: 'tikzpicture' | 'pgfpicture' | 'picture',
  rawBody: string,
  customColors: Record<string, string> = {}
): RenderedLatexFigure | null {
  const unitPx = 42;
  const items: SvgItem[] = [];
  const arrowMarkerIds = new Map<string, string>();
  const patternsUsed = new Map<string, string>();

  let body = rawBody.trimStart();
  let envOptsRaw = '';

  if (envName === 'picture') {
    const szM = body.match(/^\(\s*[^)]+\s*\)(?:\(\s*[^)]+\s*\))?/);
    if (szM) {
      envOptsRaw = szM[0];
      body = body.slice(szM[0].length);
    }
    renderPictureEnvToItems(envOptsRaw, body, items, arrowMarkerIds);
  } else {
    if (body.startsWith('[')) {
      const optBr = readBalanced(body, 0, '[', ']');
      if (optBr) {
        envOptsRaw = optBr.content;
        body = body.slice(optBr.endIdx + 1);
      }
    }

    const baseScope: TikzScopeState = {
      scaleX: 1,
      scaleY: 1,
      shiftX: 0,
      shiftY: 0,
      rotateDeg: 0,
      color: '#0F172A',
      lineWidth: 1.3,
      fill: 'none',
      fillOpacity: 1,
    };
    if (envOptsRaw) {
      const st = parseOptionsString(envOptsRaw, baseScope, customColors, unitPx);
      baseScope.scaleX = st.scaleX ?? 1;
      baseScope.scaleY = st.scaleY ?? 1;
      baseScope.shiftX = st.shiftX ?? 0;
      baseScope.shiftY = st.shiftY ?? 0;
      baseScope.shiftXPx = st.shiftXPx ?? 0;
      baseScope.shiftYPx = st.shiftYPx ?? 0;
      baseScope.rotateDeg = st.rotateDeg ?? 0;
      baseScope.color = st.stroke;
      baseScope.lineWidth = st.strokeWidth;
      baseScope.dashArray = st.dashArray;
    }

    if (/\\tkzTab(?:Init|Line|Var)/.test(body)) {
      patternsUsed.set('north east lines::#94A3B8', 'pat_ne');
      renderTkzTabToItems(body, items, arrowMarkerIds);
    } else {
      const { body: euclidExpanded, presetCoords } = preprocessTkzEuclide(body);
      executeTikzStatements(
        euclidExpanded,
        baseScope,
        presetCoords,
        customColors,
        items,
        arrowMarkerIds,
        patternsUsed,
        unitPx
      );
    }
  }

  if (items.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const it of items) {
    if (it.bounds.minX < minX) minX = it.bounds.minX;
    if (it.bounds.minY < minY) minY = it.bounds.minY;
    if (it.bounds.maxX > maxX) maxX = it.bounds.maxX;
    if (it.bounds.maxY > maxY) maxY = it.bounds.maxY;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;

  const pad = 16;
  const vbX = Math.floor(minX - pad);
  const vbY = Math.floor(minY - pad);
  const vbW = Math.max(80, Math.ceil(maxX - minX + pad * 2));
  const vbH = Math.max(50, Math.ceil(maxY - minY + pad * 2));

  const defsParts: string[] = [];
  arrowMarkerIds.forEach((id, color) => {
    defsParts.push(
      `<marker id="${id}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M 1 1.5 L 9 5 L 1 8.5 z" fill="${color}"/></marker>`
    );
  });
  patternsUsed.forEach((id, key) => {
    const [patName, color] = key.split('::');
    if (patName.includes('north east')) {
      defsParts.push(
        `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="${color}" stroke-width="1.3"/></pattern>`
      );
    } else if (patName.includes('north west')) {
      defsParts.push(
        `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><line x1="0" y1="0" x2="0" y2="8" stroke="${color}" stroke-width="1.3"/></pattern>`
      );
    } else if (patName.includes('crosshatch')) {
      defsParts.push(
        `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M 0 0 L 8 8 M 8 0 L 0 8" stroke="${color}" stroke-width="1"/></pattern>`
      );
    } else if (patName.includes('dots')) {
      defsParts.push(
        `<pattern id="${id}" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="3.5" cy="3.5" r="1.1" fill="${color}"/></pattern>`
      );
    } else {
      defsParts.push(
        `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse"><line x1="0" y1="4" x2="8" y2="4" stroke="${color}" stroke-width="1.2"/></pattern>`
      );
    }
  });

  const defsXml = defsParts.length > 0 ? `<defs>${defsParts.join('')}</defs>` : '';
  const svgXml = `<svg xmlns="http://www.w3.org/2000/svg" width="${vbW}" height="${vbH}" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" style="background:#FFFFFF">${defsXml}${items.map((it) => it.svg).join('')}</svg>`;
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgXml)}`;

  return {
    dataUrl,
    widthPx: vbW,
    heightPx: vbH,
  };
}
