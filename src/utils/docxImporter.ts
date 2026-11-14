import JSZip from 'jszip';
import type {
  BlockAlignment,
  DocumentBlock,
  InlineSegment,
  PageExtraction,
  TableCellData,
} from '../types/document';
import { splitTextPreservingInlineMath } from './latexParser';

const UNICODE_MATH_TO_LATEX: Record<string, string> = {
  '≤': '\\leq ',
  '≥': '\\geq ',
  '≠': '\\neq ',
  '≈': '\\approx ',
  '≡': '\\equiv ',
  '∼': '\\sim ',
  '≃': '\\simeq ',
  '≅': '\\cong ',
  '∝': '\\propto ',
  '∞': '\\infty ',
  '±': '\\pm ',
  '∓': '\\mp ',
  '×': '\\times ',
  '÷': '\\div ',
  '·': '\\cdot ',
  '∙': '\\cdot ',
  '∘': '\\circ ',
  '∗': '*',
  '∈': '\\in ',
  '∉': '\\notin ',
  '∋': '\\ni ',
  '⊂': '\\subset ',
  '⊆': '\\subseteq ',
  '⊃': '\\supset ',
  '⊇': '\\supseteq ',
  '⊄': '\\not\\subset ',
  '∪': '\\cup ',
  '∩': '\\cap ',
  '∅': '\\emptyset ',
  '∀': '\\forall ',
  '∃': '\\exists ',
  '∄': '\\nexists ',
  '¬': '\\neg ',
  '∧': '\\land ',
  '∨': '\\lor ',
  '⇒': '\\Rightarrow ',
  '⇔': '\\Leftrightarrow ',
  '⇐': '\\Leftarrow ',
  '→': '\\to ',
  '←': '\\leftarrow ',
  '↔': '\\leftrightarrow ',
  '↦': '\\mapsto ',
  '∂': '\\partial ',
  '∇': '\\nabla ',
  '°': '^\\circ ',
  '′': "'",
  '″': "''",
  '…': '\\dots ',
  '⋯': '\\cdots ',
  '⋮': '\\vdots ',
  '⋱': '\\ddots ',
  '∥': '\\parallel ',
  '⊥': '\\perp ',
  '∠': '\\angle ',
  '△': '\\triangle ',
  'ℝ': '\\mathbb{R}',
  'ℤ': '\\mathbb{Z}',
  'ℕ': '\\mathbb{N}',
  'ℚ': '\\mathbb{Q}',
  'ℂ': '\\mathbb{C}',
  'α': '\\alpha ',
  'β': '\\beta ',
  'γ': '\\gamma ',
  'δ': '\\delta ',
  'ε': '\\epsilon ',
  'ɛ': '\\varepsilon ',
  'ζ': '\\zeta ',
  'η': '\\eta ',
  'θ': '\\theta ',
  'ϑ': '\\vartheta ',
  'ι': '\\iota ',
  'κ': '\\kappa ',
  'λ': '\\lambda ',
  'μ': '\\mu ',
  'ν': '\\nu ',
  'ξ': '\\xi ',
  'π': '\\pi ',
  'ρ': '\\rho ',
  'σ': '\\sigma ',
  'τ': '\\tau ',
  'υ': '\\upsilon ',
  'φ': '\\phi ',
  'ϕ': '\\varphi ',
  'χ': '\\chi ',
  'ψ': '\\psi ',
  'ω': '\\omega ',
  'Γ': '\\Gamma ',
  'Δ': '\\Delta ',
  'Θ': '\\Theta ',
  'Λ': '\\Lambda ',
  'Ξ': '\\Xi ',
  'Π': '\\Pi ',
  'Σ': '\\Sigma ',
  'Φ': '\\Phi ',
  'Ψ': '\\Psi ',
  'Ω': '\\Omega ',
  '−': '-',
  '–': '-',
};

function getChildElements(node: Element, localName?: string): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < node.childNodes.length; i++) {
    const ch = node.childNodes[i];
    if (ch.nodeType === 1) {
      const el = ch as Element;
      const name = el.localName || el.tagName.replace(/^.*:/, '');
      if (!localName || name === localName) {
        out.push(el);
      }
    }
  }
  return out;
}

function getFirstChild(node: Element, localName: string): Element | null {
  for (let i = 0; i < node.childNodes.length; i++) {
    const ch = node.childNodes[i];
    if (ch.nodeType === 1) {
      const el = ch as Element;
      const name = el.localName || el.tagName.replace(/^.*:/, '');
      if (name === localName) return el;
    }
  }
  return null;
}

function getAttr(el: Element | null, attrLocal: string): string | null {
  if (!el) return null;
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    const name = a.localName || a.name.replace(/^.*:/, '');
    if (name === attrLocal) return a.value;
  }
  return null;
}

function getLocalName(el: Element): string {
  return el.localName || el.tagName.replace(/^.*:/, '');
}

function mapMathChars(raw: string): string {
  let out = '';
  for (const ch of raw) {
    out += UNICODE_MATH_TO_LATEX[ch] ?? ch;
  }
  return out;
}

function wrapBracesIfNeeded(s: string): string {
  const t = s.trim();
  if (!t) return '';
  if (t.length === 1 && !/\\/.test(t)) return t;
  return `{${t}}`;
}

function ommlElementToLatex(el: Element): string {
  const tag = getLocalName(el);

  switch (tag) {
    case 'oMathPara': {
      const maths = getChildElements(el, 'oMath');
      if (maths.length <= 1) {
        return maths.map(ommlElementToLatex).join('').trim();
      }
      const rows = maths.map((m) => ommlElementToLatex(m)).filter(Boolean);
      return rows.length > 1 ? `\\begin{aligned}${rows.join(' \\\\ ')}\\end{aligned}` : rows[0] ?? '';
    }

    case 'oMath':
    case 'e':
    case 'num':
    case 'den':
    case 'deg':
    case 'sub':
    case 'sup':
    case 'lim':
    case 'fName':
    case 'box':
    case 'borderBox':
      return getChildElements(el).map(ommlElementToLatex).join('');

    case 'oMathParaPr':
    case 'rPr':
    case 'fPr':
    case 'radPr':
    case 'naryPr':
    case 'dPr':
    case 'mPr':
    case 'eqArrPr':
    case 'accPr':
    case 'barPr':
    case 'funcPr':
    case 'sSubPr':
    case 'sSupPr':
    case 'sSubSupPr':
    case 'sPrePr':
    case 'ctrlPr':
    case 'groupChrPr':
    case 'limLowPr':
    case 'limUppPr':
      return '';

    case 'r': {
      const rPr = getFirstChild(el, 'rPr');
      const sty = getAttr(getFirstChild(rPr ?? el, 'sty'), 'val');
      const tNodes = getChildElements(el, 't');
      const rawText = tNodes.map((t) => t.textContent ?? '').join('');
      if (!rawText) return '';
      const isPlain = sty === 'p' || getAttr(rPr ? getFirstChild(rPr, 'nor') : null, 'val') === '1';
      if (isPlain && /^[A-Za-zÀ-ỹ\s.,;:!?()-]+$/.test(rawText) && rawText.trim().length >= 2) {
        const knownFuncs = new Set([
          'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
          'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
          'log', 'ln', 'lg', 'exp', 'lim', 'limsup', 'liminf',
          'max', 'min', 'sup', 'inf', 'det', 'gcd', 'mod', 'arg',
        ]);
        const trimmed = rawText.trim();
        if (knownFuncs.has(trimmed)) {
          return `\\${trimmed} `;
        }
        return `\\text{${rawText}}`;
      }
      return mapMathChars(rawText);
    }

    case 'f': {
      const fPr = getFirstChild(el, 'fPr');
      const fType = getAttr(fPr ? getFirstChild(fPr, 'type') : null, 'val');
      const numEl = getFirstChild(el, 'num');
      const denEl = getFirstChild(el, 'den');
      const num = numEl ? ommlElementToLatex(numEl).trim() : '';
      const den = denEl ? ommlElementToLatex(denEl).trim() : '';
      if (fType === 'noBar') {
        return `\\binom{${num}}{${den}}`;
      }
      if (fType === 'skw' || fType === 'lin') {
        return `${num}/${den}`;
      }
      return `\\frac{${num}}{${den}}`;
    }

    case 'rad': {
      const radPr = getFirstChild(el, 'radPr');
      const degHide = getAttr(radPr ? getFirstChild(radPr, 'degHide') : null, 'val') === '1';
      const degEl = getFirstChild(el, 'deg');
      const eEl = getFirstChild(el, 'e');
      const deg = degHide || !degEl ? '' : ommlElementToLatex(degEl).trim();
      const body = eEl ? ommlElementToLatex(eEl).trim() : '';
      return deg ? `\\sqrt[${deg}]{${body}}` : `\\sqrt{${body}}`;
    }

    case 'sSup': {
      const eEl = getFirstChild(el, 'e');
      const supEl = getFirstChild(el, 'sup');
      const base = eEl ? ommlElementToLatex(eEl).trim() : '';
      const sup = supEl ? ommlElementToLatex(supEl).trim() : '';
      return `${base}^${wrapBracesIfNeeded(sup) || '{}'}`;
    }

    case 'sSub': {
      const eEl = getFirstChild(el, 'e');
      const subEl = getFirstChild(el, 'sub');
      const base = eEl ? ommlElementToLatex(eEl).trim() : '';
      const sub = subEl ? ommlElementToLatex(subEl).trim() : '';
      return `${base}_${wrapBracesIfNeeded(sub) || '{}'}`;
    }

    case 'sSubSup': {
      const eEl = getFirstChild(el, 'e');
      const subEl = getFirstChild(el, 'sub');
      const supEl = getFirstChild(el, 'sup');
      const base = eEl ? ommlElementToLatex(eEl).trim() : '';
      const sub = subEl ? ommlElementToLatex(subEl).trim() : '';
      const sup = supEl ? ommlElementToLatex(supEl).trim() : '';
      return `${base}_${wrapBracesIfNeeded(sub) || '{}'}^${wrapBracesIfNeeded(sup) || '{}'}`;
    }

    case 'sPre': {
      const eEl = getFirstChild(el, 'e');
      const subEl = getFirstChild(el, 'sub');
      const supEl = getFirstChild(el, 'sup');
      const base = eEl ? ommlElementToLatex(eEl).trim() : '';
      const sub = subEl ? ommlElementToLatex(subEl).trim() : '';
      const sup = supEl ? ommlElementToLatex(supEl).trim() : '';
      const subPart = sub ? `_${wrapBracesIfNeeded(sub)}` : '';
      const supPart = sup ? `^${wrapBracesIfNeeded(sup)}` : '';
      return `{}${subPart}${supPart}${base}`;
    }

    case 'nary': {
      const naryPr = getFirstChild(el, 'naryPr');
      const chr = getAttr(naryPr ? getFirstChild(naryPr, 'chr') : null, 'val') || '∫';
      const subHide = getAttr(naryPr ? getFirstChild(naryPr, 'subHide') : null, 'val') === '1';
      const supHide = getAttr(naryPr ? getFirstChild(naryPr, 'supHide') : null, 'val') === '1';
      const naryCmdMap: Record<string, string> = {
        '∫': '\\int',
        '∬': '\\iint',
        '∭': '\\iiint',
        '∮': '\\oint',
        '∑': '\\sum',
        '∏': '\\prod',
        '∐': '\\coprod',
        '⋃': '\\bigcup',
        '⋂': '\\bigcap',
        '⋁': '\\bigvee',
        '⋀': '\\bigwedge',
      };
      const op = naryCmdMap[chr] ?? '\\int';
      const subEl = getFirstChild(el, 'sub');
      const supEl = getFirstChild(el, 'sup');
      const eEl = getFirstChild(el, 'e');
      const sub = !subHide && subEl ? ommlElementToLatex(subEl).trim() : '';
      const sup = !supHide && supEl ? ommlElementToLatex(supEl).trim() : '';
      const body = eEl ? ommlElementToLatex(eEl).trim() : '';
      const subStr = sub ? `_${wrapBracesIfNeeded(sub)}` : '';
      const supStr = sup ? `^${wrapBracesIfNeeded(sup)}` : '';
      return `${op}${subStr}${supStr} ${body}`;
    }

    case 'd': {
      const dPr = getFirstChild(el, 'dPr');
      const begChr = getAttr(dPr ? getFirstChild(dPr, 'begChr') : null, 'val') ?? '(';
      const endChr = getAttr(dPr ? getFirstChild(dPr, 'endChr') : null, 'val') ?? ')';
      const sepChr = getAttr(dPr ? getFirstChild(dPr, 'sepChr') : null, 'val') ?? '|';
      const eChildren = getChildElements(el, 'e');

      // Special case: system of equations or matrix wrapped by \left\{ ... \right.
      if (eChildren.length === 1) {
        const innerEls = getChildElements(eChildren[0]);
        if (innerEls.length === 1) {
          const innerTag = getLocalName(innerEls[0]);
          if (innerTag === 'm' || innerTag === 'eqArr') {
            const rows =
              innerTag === 'm'
                ? getChildElements(innerEls[0], 'mr').map((mr) =>
                    getChildElements(mr, 'e').map((cell) => ommlElementToLatex(cell).trim()).join(' & ')
                  )
                : getChildElements(innerEls[0], 'e').map((row) => ommlElementToLatex(row).trim());
            const content = rows.join(' \\\\ ');
            if (begChr === '{' && !endChr) return `\\begin{cases} ${content} \\end{cases}`;
            if (begChr === '(' && endChr === ')') return `\\begin{pmatrix} ${content} \\end{pmatrix}`;
            if (begChr === '[' && endChr === ']') return `\\begin{bmatrix} ${content} \\end{bmatrix}`;
            if (begChr === '|' && endChr === '|') return `\\begin{vmatrix} ${content} \\end{vmatrix}`;
            if (begChr === '‖' && endChr === '‖') return `\\begin{Vmatrix} ${content} \\end{Vmatrix}`;
          }
        }
      }

      const mapDelim = (ch: string): string => {
        if (!ch) return '.';
        if (ch === '{') return '\\{';
        if (ch === '}') return '\\}';
        if (ch === '‖') return '\\|';
        if (ch === '⟨') return '\\langle ';
        if (ch === '⟩') return '\\rangle ';
        if (ch === '⌊') return '\\lfloor ';
        if (ch === '⌋') return '\\rfloor ';
        if (ch === '⌈') return '\\lceil ';
        if (ch === '⌉') return '\\rceil ';
        return ch;
      };

      const inner = eChildren.map(ommlElementToLatex).join(sepChr);
      return `\\left${mapDelim(begChr)}${inner}\\right${mapDelim(endChr)}`;
    }

    case 'm': {
      const rows = getChildElements(el, 'mr').map((mr) =>
        getChildElements(mr, 'e')
          .map((cell) => ommlElementToLatex(cell).trim())
          .join(' & ')
      );
      return `\\begin{matrix} ${rows.join(' \\\\ ')} \\end{matrix}`;
    }

    case 'eqArr': {
      const rows = getChildElements(el, 'e').map((e) => ommlElementToLatex(e).trim());
      return `\\begin{aligned} ${rows.join(' \\\\ ')} \\end{aligned}`;
    }

    case 'func': {
      const fNameEl = getFirstChild(el, 'fName');
      const eEl = getFirstChild(el, 'e');
      const fName = fNameEl ? ommlElementToLatex(fNameEl).trim() : '';
      const arg = eEl ? ommlElementToLatex(eEl).trim() : '';
      return `${fName} ${arg}`.trim();
    }

    case 'limLow': {
      const eEl = getFirstChild(el, 'e');
      const limEl = getFirstChild(el, 'lim');
      const base = eEl ? ommlElementToLatex(eEl).trim() : '';
      const lim = limEl ? ommlElementToLatex(limEl).trim() : '';
      if (base === 'lim' || base === '\\lim' || base === '\\text{lim}') {
        return `\\lim_{${lim}}`;
      }
      return `\\underset{${lim}}{${base}}`;
    }

    case 'limUpp': {
      const eEl = getFirstChild(el, 'e');
      const limEl = getFirstChild(el, 'lim');
      const base = eEl ? ommlElementToLatex(eEl).trim() : '';
      const lim = limEl ? ommlElementToLatex(limEl).trim() : '';
      return `\\overset{${lim}}{${base}}`;
    }

    case 'acc': {
      const accPr = getFirstChild(el, 'accPr');
      const chr = getAttr(accPr ? getFirstChild(accPr, 'chr') : null, 'val') || '^';
      const eEl = getFirstChild(el, 'e');
      const body = eEl ? ommlElementToLatex(eEl).trim() : '';
      if (chr === '→' || chr === '⃗') {
        return body.length > 1 && !body.startsWith('\\')
          ? `\\overrightarrow{${body}}`
          : `\\vec{${body}}`;
      }
      if (chr === '¯' || chr === '‾') return `\\overline{${body}}`;
      if (chr === '˜' || chr === '~') return `\\tilde{${body}}`;
      if (chr === '˙') return `\\dot{${body}}`;
      if (chr === '¨') return `\\ddot{${body}}`;
      return body.length > 1 && !body.startsWith('\\')
        ? `\\widehat{${body}}`
        : `\\hat{${body}}`;
    }

    case 'bar': {
      const barPr = getFirstChild(el, 'barPr');
      const pos = getAttr(barPr ? getFirstChild(barPr, 'pos') : null, 'val');
      const eEl = getFirstChild(el, 'e');
      const body = eEl ? ommlElementToLatex(eEl).trim() : '';
      return pos === 'bot' ? `\\underline{${body}}` : `\\overline{${body}}`;
    }

    case 'groupChr': {
      const gPr = getFirstChild(el, 'groupChrPr');
      const pos = getAttr(gPr ? getFirstChild(gPr, 'pos') : null, 'val');
      const eEl = getFirstChild(el, 'e');
      const body = eEl ? ommlElementToLatex(eEl).trim() : '';
      return pos === 'top' ? `\\overbrace{${body}}` : `\\underbrace{${body}}`;
    }

    default:
      return getChildElements(el).map(ommlElementToLatex).join('');
  }
}

interface DecodedImageAsset {
  dataUrl: string;
  width: number;
  height: number;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function normalizeImageToPngDataUrl(
  rawData: ArrayBuffer,
  ext: string
): Promise<DecodedImageAsset | null> {
  const mime =
    ext === 'png'
      ? 'image/png'
      : ext === 'jpg' || ext === 'jpeg'
      ? 'image/jpeg'
      : ext === 'gif'
      ? 'image/gif'
      : ext === 'webp'
      ? 'image/webp'
      : 'image/png';

  const blob = new Blob([rawData], { type: mime });
  const objectUrl = URL.createObjectURL(blob);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = Math.max(1, img.naturalWidth);
        const h = Math.max(1, img.naturalHeight);
        if (mime === 'image/png') {
          const b64 = arrayBufferToBase64(rawData);
          URL.revokeObjectURL(objectUrl);
          resolve({ dataUrl: `data:image/png;base64,${b64}`, width: w, height: h });
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(objectUrl);
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/png');
        canvas.width = 0;
        canvas.height = 0;
        URL.revokeObjectURL(objectUrl);
        resolve({ dataUrl, width: w, height: h });
      } catch {
        URL.revokeObjectURL(objectUrl);
        resolve(null);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    img.src = objectUrl;
  });
}

function splitInlineLatexFromRun(
  text: string,
  baseStyle: Omit<InlineSegment, 'type' | 'content'>
): InlineSegment[] {
  return splitTextPreservingInlineMath(text, baseStyle);
}

function parseRunFormatting(rEl: Element): Omit<InlineSegment, 'type' | 'content'> {
  const rPr = getFirstChild(rEl, 'rPr');
  if (!rPr) return {};

  const style: Omit<InlineSegment, 'type' | 'content'> = {};
  const bEl = getFirstChild(rPr, 'b');
  if (bEl && getAttr(bEl, 'val') !== '0' && getAttr(bEl, 'val') !== 'false') {
    style.bold = true;
  }
  const iEl = getFirstChild(rPr, 'i');
  if (iEl && getAttr(iEl, 'val') !== '0' && getAttr(iEl, 'val') !== 'false') {
    style.italic = true;
  }
  const uEl = getFirstChild(rPr, 'u');
  if (uEl && getAttr(uEl, 'val') !== 'none') {
    style.underline = true;
  }
  const szEl = getFirstChild(rPr, 'sz');
  const szVal = getAttr(szEl, 'val');
  if (szVal && !Number.isNaN(Number(szVal))) {
    style.font_size_pt = Math.round((Number(szVal) / 2) * 10) / 10;
  }
  const colorEl = getFirstChild(rPr, 'color');
  const colorVal = getAttr(colorEl, 'val');
  if (colorVal && /^[0-9A-Fa-f]{6}$/.test(colorVal) && colorVal.toUpperCase() !== '000000') {
    style.color = `#${colorVal.toUpperCase()}`;
  }
  return style;
}

function sameTextStyle(
  a: Omit<InlineSegment, 'type' | 'content'>,
  b: Omit<InlineSegment, 'type' | 'content'>
): boolean {
  return (
    Boolean(a.bold) === Boolean(b.bold) &&
    Boolean(a.italic) === Boolean(b.italic) &&
    Boolean(a.underline) === Boolean(b.underline) &&
    a.font_size_pt === b.font_size_pt &&
    a.color === b.color
  );
}

function countUnescapedDollars(s: string): number {
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') {
      i++;
      continue;
    }
    if (s[i] === '$') count++;
  }
  return count;
}

function splitParagraphTextSegmentsForLatex(segments: InlineSegment[]): InlineSegment[] {
  // First merge adjacent text segments with identical styles (or unbalanced $) so Word rsid splits don't break $...$
  const merged: InlineSegment[] = [];
  for (const seg of segments) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.type === 'text' &&
      seg.type === 'text' &&
      !seg.tab_before &&
      (sameTextStyle(prev, seg) || countUnescapedDollars(prev.content) % 2 === 1)
    ) {
      prev.content += seg.content;
    } else {
      merged.push({ ...seg });
    }
  }

  const out: InlineSegment[] = [];
  for (const seg of merged) {
    if (
      seg.type !== 'text' ||
      (!seg.content.includes('$') &&
        !seg.content.includes('＄') &&
        !seg.content.includes('\\(') &&
        !seg.content.includes('\\['))
    ) {
      out.push(seg);
      continue;
    }
    const { type: _t, content, tab_before, ...style } = seg;
    const split = splitInlineLatexFromRun(content, style);
    if (tab_before && split.length > 0) {
      split[0] = { ...split[0], tab_before: true };
    }
    out.push(...split);
  }
  return out;
}

interface NumberingTracker {
  numToAbstract: Map<string, string>;
  levelFormats: Map<string, { fmt: string; lvlText: string }>;
  counters: Map<string, number>;
}

function createNumberingTracker(numberingXml: Document | null): NumberingTracker {
  const tracker: NumberingTracker = {
    numToAbstract: new Map(),
    levelFormats: new Map(),
    counters: new Map(),
  };
  if (!numberingXml) return tracker;

  const absEls = Array.from(numberingXml.getElementsByTagName('*')).filter(
    (el) => getLocalName(el) === 'abstractNum'
  );
  for (const abs of absEls) {
    const absId = getAttr(abs, 'abstractNumId');
    if (!absId) continue;
    for (const lvl of getChildElements(abs, 'lvl')) {
      const ilvl = getAttr(lvl, 'ilvl') ?? '0';
      const fmt = getAttr(getFirstChild(lvl, 'numFmt'), 'val') ?? 'decimal';
      const lvlText = getAttr(getFirstChild(lvl, 'lvlText'), 'val') ?? '%1.';
      tracker.levelFormats.set(`${absId}:${ilvl}`, { fmt, lvlText });
    }
  }

  const numEls = Array.from(numberingXml.getElementsByTagName('*')).filter(
    (el) => getLocalName(el) === 'num'
  );
  for (const numEl of numEls) {
    const numId = getAttr(numEl, 'numId');
    const absRef = getAttr(getFirstChild(numEl, 'abstractNumId'), 'val');
    if (numId && absRef) {
      tracker.numToAbstract.set(numId, absRef);
    }
  }
  return tracker;
}

function nextListLabel(tracker: NumberingTracker, numId: string, ilvl: string): string {
  const absId = tracker.numToAbstract.get(numId);
  const spec = absId ? tracker.levelFormats.get(`${absId}:${ilvl}`) : undefined;
  if (spec?.fmt === 'bullet') return '• ';

  const key = `${numId}:${ilvl}`;
  const count = (tracker.counters.get(key) ?? 0) + 1;
  tracker.counters.set(key, count);

  const fmt = spec?.fmt ?? 'decimal';
  const formatted =
    fmt === 'lowerLetter'
      ? String.fromCharCode(97 + ((count - 1) % 26))
      : fmt === 'upperLetter'
      ? String.fromCharCode(65 + ((count - 1) % 26))
      : String(count);

  if (spec?.lvlText) {
    return `${spec.lvlText.replace(/%\d+/g, formatted)} `;
  }
  return `${formatted}. `;
}

function findBlipEmbedId(node: Element): string | null {
  const tag = getLocalName(node);
  if (tag === 'blip') {
    return getAttr(node, 'embed') || getAttr(node, 'link');
  }
  for (let i = 0; i < node.childNodes.length; i++) {
    const ch = node.childNodes[i];
    if (ch.nodeType === 1) {
      const found = findBlipEmbedId(ch as Element);
      if (found) return found;
    }
  }
  return null;
}

interface ParsedParagraphResult {
  blocks: DocumentBlock[];
  hasPageBreakAfter: boolean;
}

function parseParagraphElement(
  pEl: Element,
  mediaMap: Map<string, DecodedImageAsset>,
  pageWidthPt: number,
  numberingTracker?: NumberingTracker
): ParsedParagraphResult {
  const pPr = getFirstChild(pEl, 'pPr');
  let alignment: BlockAlignment = 'left';
  let isHeading = false;
  let headingLevel = 2;
  let indentLeftPt: number | undefined;
  let firstLineIndentPt: number | undefined;
  let lineSpacing: number | undefined;
  let tabStopsPt: number[] | undefined;
  let listPrefix: string | null = null;

  if (pPr) {
    const jcVal = getAttr(getFirstChild(pPr, 'jc'), 'val');
    if (jcVal === 'center') alignment = 'center';
    else if (jcVal === 'right' || jcVal === 'end') alignment = 'right';
    else if (jcVal === 'both' || jcVal === 'distribute') alignment = 'justify';

    const styleVal = getAttr(getFirstChild(pPr, 'pStyle'), 'val') ?? '';
    const hMatch = styleVal.match(/^(?:Heading|Titre|Title)(\d?)$/i);
    if (hMatch) {
      isHeading = true;
      headingLevel = hMatch[1] ? Math.max(1, Math.min(4, Number(hMatch[1]))) : 1;
    }

    const numPr = getFirstChild(pPr, 'numPr');
    if (numPr && numberingTracker) {
      const numId = getAttr(getFirstChild(numPr, 'numId'), 'val');
      const ilvl = getAttr(getFirstChild(numPr, 'ilvl'), 'val') ?? '0';
      if (numId && numId !== '0') {
        listPrefix = nextListLabel(numberingTracker, numId, ilvl);
        if (!indentLeftPt) {
          indentLeftPt = (Number(ilvl) + 1) * 18;
          firstLineIndentPt = -14;
        }
      }
    }

    const indEl = getFirstChild(pPr, 'ind');
    if (indEl) {
      const leftTw = Number(getAttr(indEl, 'left') ?? getAttr(indEl, 'start') ?? 0);
      const firstTw = Number(getAttr(indEl, 'firstLine') ?? 0);
      const hangingTw = Number(getAttr(indEl, 'hanging') ?? 0);
      if (hangingTw > 0) {
        firstLineIndentPt = -Math.round((hangingTw / 20) * 10) / 10;
        const baseLeft = Math.max(0, leftTw - hangingTw);
        if (baseLeft > 0) indentLeftPt = Math.round((baseLeft / 20) * 10) / 10;
      } else {
        if (leftTw > 0) indentLeftPt = Math.round((leftTw / 20) * 10) / 10;
        if (firstTw > 0) firstLineIndentPt = Math.round((firstTw / 20) * 10) / 10;
      }
    }

    const spEl = getFirstChild(pPr, 'spacing');
    if (spEl) {
      const lineVal = Number(getAttr(spEl, 'line') ?? 0);
      const lineRule = getAttr(spEl, 'lineRule') ?? 'auto';
      if (lineVal > 0 && lineRule === 'auto') {
        lineSpacing = Math.round((lineVal / 240) * 100) / 100;
      }
    }

    const tabsEl = getFirstChild(pPr, 'tabs');
    if (tabsEl) {
      const stops = getChildElements(tabsEl, 'tab')
        .filter((t) => getAttr(t, 'val') !== 'clear')
        .map((t) => Number(getAttr(t, 'pos') ?? 0) / 20)
        .filter((pt) => Number.isFinite(pt) && pt > 0);
      if (stops.length > 0) tabStopsPt = stops;
    }
  }

  const rawSegments: InlineSegment[] = [];
  const standaloneFigures: DocumentBlock[] = [];
  let pendingTab = false;
  let hasPageBreakAfter = false;
  let standaloneEqLatex: string | null = null;
  let hasNonEmptyTextRuns = false;

  const processNode = (el: Element) => {
    const tag = getLocalName(el);
    if (tag === 'pPr' || tag === 'del' || tag === 'proofErr' || tag === 'bookmarkStart' || tag === 'bookmarkEnd') {
      return;
    }

    if (tag === 'oMathPara') {
      const latex = ommlElementToLatex(el).trim();
      if (latex) {
        if (!hasNonEmptyTextRuns && rawSegments.length === 0) {
          standaloneEqLatex = latex;
        } else {
          rawSegments.push({ type: 'math', content: latex, ...(pendingTab ? { tab_before: true } : {}) });
          pendingTab = false;
        }
      }
      return;
    }

    if (tag === 'oMath') {
      const latex = ommlElementToLatex(el).trim();
      if (latex) {
        if (pendingTab) {
          rawSegments.push({ type: 'math', content: latex, tab_before: true });
          pendingTab = false;
        } else {
          rawSegments.push({ type: 'math', content: latex });
        }
      }
      return;
    }

    if (tag === 'AlternateContent') {
      const choice = getFirstChild(el, 'Choice');
      const fallback = getFirstChild(el, 'Fallback');
      const target = choice ?? fallback;
      if (target) getChildElements(target).forEach(processNode);
      return;
    }

    if (tag === 'hyperlink' || tag === 'ins' || tag === 'smartTag' || tag === 'sdt' || tag === 'sdtContent') {
      getChildElements(el).forEach(processNode);
      return;
    }

    if (tag === 'r') {
      const rStyle = parseRunFormatting(el);
      for (let i = 0; i < el.childNodes.length; i++) {
        const ch = el.childNodes[i];
        if (ch.nodeType !== 1) continue;
        const cEl = ch as Element;
        const cTag = getLocalName(cEl);

        if (cTag === 't' || cTag === 'delText') {
          const txt = cEl.textContent ?? '';
          if (txt) {
            hasNonEmptyTextRuns = true;
            rawSegments.push({
              type: 'text',
              content: txt,
              ...rStyle,
              ...(pendingTab ? { tab_before: true } : {}),
            });
            pendingTab = false;
          }
        } else if (cTag === 'tab') {
          pendingTab = true;
        } else if (cTag === 'br') {
          const brType = getAttr(cEl, 'type');
          if (brType === 'page') {
            hasPageBreakAfter = true;
          } else {
            rawSegments.push({ type: 'text', content: '\n', ...rStyle });
          }
        } else if (cTag === 'drawing' || cTag === 'pict') {
          const embedId = findBlipEmbedId(cEl);
          if (embedId && mediaMap.has(embedId)) {
            const asset = mediaMap.get(embedId)!;
            const maxW = Math.min(820, Math.round((asset.width / Math.max(400, pageWidthPt * 1.4)) * 800));
            const xmax = Math.min(900, 120 + Math.max(220, maxW));
            standaloneFigures.push({
              block_type: 'figure',
              alignment: alignment === 'right' ? 'right' : 'center',
              croppedImageDataUrl: asset.dataUrl,
              croppedWidthPx: asset.width,
              croppedHeightPx: asset.height,
              box_2d: [100, 120, 420, xmax],
            });
          }
        }
      }
    }
  };

  getChildElements(pEl).forEach(processNode);
  const segments = splitParagraphTextSegmentsForLatex(rawSegments);
  if (listPrefix && segments.length > 0) {
    segments.unshift({ type: 'text', content: listPrefix, bold: listPrefix !== '• ' });
  }

  const blocks: DocumentBlock[] = [];

  // Check if paragraph is purely one inline <m:oMath> centered on its own line
  if (
    !standaloneEqLatex &&
    segments.length === 1 &&
    segments[0].type === 'math' &&
    alignment === 'center'
  ) {
    standaloneEqLatex = segments[0].content;
  }

  if (standaloneEqLatex && !hasNonEmptyTextRuns) {
    blocks.push({
      block_type: 'equation',
      alignment: alignment === 'left' ? 'center' : alignment,
      latex: standaloneEqLatex,
      font_size_pt: 12,
    });
  } else if (segments.length > 0) {
    // Check bottom border horizontal rule paragraph
    const pBdr = pPr ? getFirstChild(pPr, 'pBdr') : null;
    const isRuleOnly =
      pBdr &&
      getFirstChild(pBdr, 'bottom') &&
      segments.every((s) => !s.content.trim());

    if (isRuleOnly) {
      blocks.push({
        block_type: 'horizontal_rule',
        alignment: 'left',
      });
    } else {
      const firstFontPt = segments.find((s) => s.font_size_pt)?.font_size_pt;
      blocks.push({
        block_type: isHeading ? 'heading' : 'paragraph',
        alignment,
        ...(isHeading ? { heading_level: headingLevel } : {}),
        font_size_pt: firstFontPt ?? (isHeading ? 14 : 12),
        line_spacing: lineSpacing ?? 1.15,
        ...(indentLeftPt ? { indent_left_pt: indentLeftPt } : {}),
        ...(firstLineIndentPt ? { first_line_indent_pt: firstLineIndentPt } : {}),
        ...(tabStopsPt ? { tab_stops_pt: tabStopsPt } : {}),
        segments,
      });
    }
  } else if (pPr) {
    const pBdr = getFirstChild(pPr, 'pBdr');
    if (pBdr && getFirstChild(pBdr, 'bottom')) {
      blocks.push({
        block_type: 'horizontal_rule',
        alignment: 'left',
      });
    }
  }

  blocks.push(...standaloneFigures);
  return { blocks, hasPageBreakAfter };
}

function isBorderNone(borderEl: Element | null): boolean {
  if (!borderEl) return true;
  const val = getAttr(borderEl, 'val');
  const sz = getAttr(borderEl, 'sz');
  return val === 'none' || val === 'nil' || sz === '0';
}

function parseTableElement(
  tblEl: Element,
  mediaMap: Map<string, DecodedImageAsset>,
  pageWidthPt: number
): DocumentBlock | null {
  const tblPr = getFirstChild(tblEl, 'tblPr');
  const tblBorders = tblPr ? getFirstChild(tblPr, 'tblBorders') : null;

  let isBorderless = false;
  if (tblBorders) {
    const sides = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'];
    const allNone = sides.every((s) => isBorderNone(getFirstChild(tblBorders, s)));
    isBorderless = allNone;
  }

  const tblGrid = getFirstChild(tblEl, 'tblGrid');
  const gridCols = tblGrid
    ? getChildElements(tblGrid, 'gridCol').map((gc) => Number(getAttr(gc, 'w') ?? 0))
    : [];
  const totalGridW = gridCols.reduce((a, b) => a + b, 0);

  const trEls = getChildElements(tblEl, 'tr');
  const tableRows: TableCellData[][] = [];

  for (let rIdx = 0; rIdx < trEls.length; rIdx++) {
    const tr = trEls[rIdx];
    const tcEls = getChildElements(tr, 'tc');
    const rowCells: TableCellData[] = [];
    let colCursor = 0;

    for (const tc of tcEls) {
      const tcPr = getFirstChild(tc, 'tcPr');
      const spanVal = Number(getAttr(tcPr ? getFirstChild(tcPr, 'gridSpan') : null, 'val') ?? 1);
      const colSpan = Number.isFinite(spanVal) && spanVal > 1 ? Math.round(spanVal) : 1;

      const shdFill = getAttr(tcPr ? getFirstChild(tcPr, 'shd') : null, 'fill');
      const hasShading = Boolean(
        shdFill && shdFill.toUpperCase() !== 'AUTO' && shdFill.toUpperCase() !== 'FFFFFF'
      );

      let widthPct: number | undefined;
      if (totalGridW > 0 && colCursor < gridCols.length) {
        const spanW = gridCols
          .slice(colCursor, colCursor + colSpan)
          .reduce((a, b) => a + b, 0);
        if (spanW > 0) {
          widthPct = Math.round((spanW / totalGridW) * 1000) / 10;
        }
      }
      colCursor += colSpan;

      const cellParagraphs = getChildElements(tc, 'p');
      const cellSegments: InlineSegment[] = [];
      let cellAlignment: BlockAlignment = 'left';

      cellParagraphs.forEach((pEl, pIdx) => {
        const res = parseParagraphElement(pEl, mediaMap, pageWidthPt);
        res.blocks.forEach((b) => {
          if (pIdx === 0 && b.alignment) cellAlignment = b.alignment;
          if (b.block_type === 'equation' && b.latex) {
            if (cellSegments.length > 0) cellSegments.push({ type: 'text', content: '\n' });
            cellSegments.push({ type: 'math', content: b.latex });
          } else if (b.segments && b.segments.length > 0) {
            if (cellSegments.length > 0) cellSegments.push({ type: 'text', content: '\n' });
            cellSegments.push(...b.segments);
          }
        });
      });

      const allBold =
        cellSegments.length > 0 && cellSegments.every((s) => s.bold || !s.content.trim());

      rowCells.push({
        segments: cellSegments,
        alignment: cellAlignment,
        ...(colSpan > 1 ? { col_span: colSpan } : {}),
        ...(widthPct ? { width_pct: widthPct } : {}),
        is_header: !isBorderless && rIdx === 0 && (hasShading || allBold),
      });
    }

    if (rowCells.length > 0) {
      tableRows.push(rowCells);
    }
  }

  if (tableRows.length === 0) return null;

  // Detect whether borderless table is specifically a multiple-choice A/B/C/D option grid
  const choiceLabelRe = /^[A-Da-d][\.\)\:](\s|$)/;
  let choiceMatches = 0;
  if (isBorderless) {
    for (const row of tableRows) {
      for (const cell of row) {
        const plain = (cell.segments ?? []).map((s) => s.content).join('').trim();
        if (choiceLabelRe.test(plain)) choiceMatches++;
      }
    }
  }

  return {
    block_type: 'table',
    alignment: 'center',
    table_borderless: isBorderless,
    is_choice_block: isBorderless && choiceMatches >= 2,
    font_size_pt: isBorderless ? 12 : 11,
    line_spacing: 1.15,
    table_rows: tableRows,
  };
}

export async function parseDocxFileToPages(file: File): Promise<PageExtraction[]> {
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);

  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) {
    throw new Error('Tệp Word (.docx) không hợp lệ hoặc thiếu word/document.xml.');
  }

  const parser = new DOMParser();
  const docXmlStr = await docXmlFile.async('string');
  const docXml = parser.parseFromString(docXmlStr, 'application/xml');

  let numberingXml: Document | null = null;
  const numberingFile = zip.file('word/numbering.xml');
  if (numberingFile) {
    const numStr = await numberingFile.async('string');
    numberingXml = parser.parseFromString(numStr, 'application/xml');
  }
  const numberingTracker = createNumberingTracker(numberingXml);

  // Load relationships -> media assets
  const mediaMap = new Map<string, DecodedImageAsset>();
  const relsFile = zip.file('word/_rels/document.xml.rels');
  if (relsFile) {
    const relsStr = await relsFile.async('string');
    const relsXml = parser.parseFromString(relsStr, 'application/xml');
    const relEls = Array.from(relsXml.getElementsByTagName('Relationship'));
    await Promise.all(
      relEls.map(async (rel) => {
        const id = rel.getAttribute('Id');
        const target = rel.getAttribute('Target');
        const type = rel.getAttribute('Type') ?? '';
        if (!id || !target || !type.includes('/image')) return;

        const cleanTarget = target.startsWith('/')
          ? target.slice(1)
          : target.startsWith('word/')
          ? target
          : `word/${target.replace(/^\.\//, '')}`;

        const imgFile = zip.file(cleanTarget);
        if (!imgFile) return;

        const ext = cleanTarget.split('.').pop()?.toLowerCase() ?? 'png';
        const rawBuf = await imgFile.async('arraybuffer');
        const decoded = await normalizeImageToPngDataUrl(rawBuf, ext);
        if (decoded) {
          mediaMap.set(id, decoded);
        }
      })
    );
  }

  const bodyEl =
    docXml.getElementsByTagName('w:body')[0] || docXml.getElementsByTagName('body')[0];
  if (!bodyEl) {
    throw new Error('Không tìm thấy nội dung tài liệu trong tệp Word.');
  }

  // Extract page dimensions from sectPr (default A4)
  let pageWidthPt = 595.3;
  let pageHeightPt = 841.9;
  const sectPr = getFirstChild(bodyEl, 'sectPr');
  if (sectPr) {
    const pgSz = getFirstChild(sectPr, 'pgSz');
    const wTw = Number(getAttr(pgSz, 'w') ?? 0);
    const hTw = Number(getAttr(pgSz, 'h') ?? 0);
    if (wTw > 1000 && hTw > 1000) {
      pageWidthPt = wTw / 20;
      pageHeightPt = hTw / 20;
    }
  }

  const pageWidthPx = Math.round((pageWidthPt / 72) * 150);
  const pageHeightPx = Math.round((pageHeightPt / 72) * 150);

  const pages: DocumentBlock[][] = [[]];
  const pushBlock = (blk: DocumentBlock) => {
    pages[pages.length - 1].push(blk);
  };
  const startNewPage = () => {
    if (pages[pages.length - 1].length > 0) {
      pages.push([]);
    }
  };

  const bodyChildren = getChildElements(bodyEl);
  for (const child of bodyChildren) {
    const tag = getLocalName(child);
    if (tag === 'p') {
      const res = parseParagraphElement(child, mediaMap, pageWidthPt, numberingTracker);
      res.blocks.forEach(pushBlock);
      if (res.hasPageBreakAfter) {
        startNewPage();
      }
    } else if (tag === 'tbl') {
      const tblBlock = parseTableElement(child, mediaMap, pageWidthPt);
      if (tblBlock) pushBlock(tblBlock);
    } else if (tag === 'sdt') {
      const sdtContent = getFirstChild(child, 'sdtContent');
      if (sdtContent) {
        for (const inner of getChildElements(sdtContent)) {
          const innerTag = getLocalName(inner);
          if (innerTag === 'p') {
            const res = parseParagraphElement(inner, mediaMap, pageWidthPt, numberingTracker);
            res.blocks.forEach(pushBlock);
          } else if (innerTag === 'tbl') {
            const tblBlock = parseTableElement(inner, mediaMap, pageWidthPt);
            if (tblBlock) pushBlock(tblBlock);
          }
        }
      }
    }
  }

  const nonEmptyPages = pages.filter((p) => p.length > 0);
  if (nonEmptyPages.length === 0) {
    throw new Error('Tệp Word (.docx) không có văn bản, bảng biểu hoặc công thức nào.');
  }

  return nonEmptyPages.map((blocks, idx) => ({
    pageNumber: idx + 1,
    pageWidthPx,
    pageHeightPx,
    blocks,
  }));
}
