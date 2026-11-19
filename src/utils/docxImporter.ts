import JSZip from 'jszip';
import type {
  BlockAlignment,
  DocumentBlock,
  InlineSegment,
  PageExtraction,
  TableCellData,
} from '../types/document';
import { splitTextPreservingInlineMath } from './latexParser';
import {
  extractLatexFromOleBuffer,
  extractLatexFromWmfBuffer,
} from './mtefParser';

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
  '⇌': '\\rightleftharpoons ',
  '⇋': '\\leftrightharpoons ',
  '⇄': '\\rightleftarrows ',
  '⇆': '\\leftrightarrows ',
  '⇀': '\\rightharpoonup ',
  '⇁': '\\rightharpoondown ',
  '↼': '\\leftharpoonup ',
  '↽': '\\leftharpoondown ',
  '⟶': '\\longrightarrow ',
  '⟵': '\\longleftarrow ',
  '⟷': '\\longleftrightarrow ',
  '⟹': '\\Longrightarrow ',
  '⟸': '\\Longleftarrow ',
  '⟺': '\\Longleftrightarrow ',
  '⟨': '\\langle ',
  '⟩': '\\rangle ',
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
    const code = ch.charCodeAt(0);
    if (code === 0x5c) {
      out += '\\setminus ';
    } else if (code === 0xef02) {
      out += '\\,';
    } else if (code === 0xef03) {
      out += '\\;';
    } else if (code === 0xef04) {
      out += '\\quad ';
    } else if (code === 0xef05) {
      out += '\\qquad ';
    } else if (code >= 0xef00 && code <= 0xef0f) {
      out += code === 0xef00 ? '' : ' ';
    } else if ((code >= 0xe000 && code <= 0xf8ff) || (code >= 0x200b && code <= 0x200f) || (code >= 0x2060 && code <= 0x2064) || code === 0xfeff) {
      continue;
    } else {
      out += UNICODE_MATH_TO_LATEX[ch] ?? ch;
    }
  }
  return out;
}

function wrapBracesIfNeeded(s: string): string {
  const t = s.trim();
  if (!t) return '';
  if (t.length === 1 && !/\\/.test(t)) return t;
  return `{${t}}`;
}

function hasTopLevelScript(latex: string): boolean {
  let depth = 0;
  for (let i = 0; i < latex.length; i++) {
    const ch = latex[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (ch === '_' || ch === '^')) return true;
  }
  return false;
}

function wrapOmmlBaseForScript(base: string, eEl: Element | null): string {
  if (!base) return '{}';
  const children = eEl ? getChildElements(eEl) : [];
  const singleTag = children.length === 1 ? getLocalName(children[0]) : '';
  if (
    singleTag === 'sSub' ||
    singleTag === 'sSup' ||
    singleTag === 'sSubSup' ||
    hasTopLevelScript(base)
  ) {
    return `{${base}}`;
  }
  return base;
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
        const trimmed = rawText.replace(/\u2009/g, ' ').trim();
        const compact = trimmed.replace(/\s+/g, '');
        if (compact === 'limsup' || compact === 'liminf') {
          return `\\${compact} `;
        }
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
      const base = wrapOmmlBaseForScript(eEl ? ommlElementToLatex(eEl).trim() : '', eEl);
      const sup = supEl ? ommlElementToLatex(supEl).trim() : '';
      return `${base}^${wrapBracesIfNeeded(sup) || '{}'}`;
    }

    case 'sSub': {
      const eEl = getFirstChild(el, 'e');
      const subEl = getFirstChild(el, 'sub');
      const base = wrapOmmlBaseForScript(eEl ? ommlElementToLatex(eEl).trim() : '', eEl);
      const sub = subEl ? ommlElementToLatex(subEl).trim() : '';
      return `${base}_${wrapBracesIfNeeded(sub) || '{}'}`;
    }

    case 'sSubSup': {
      const eEl = getFirstChild(el, 'e');
      const subEl = getFirstChild(el, 'sub');
      const supEl = getFirstChild(el, 'sup');
      const base = wrapOmmlBaseForScript(eEl ? ommlElementToLatex(eEl).trim() : '', eEl);
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
      if (base === '\\limsup' || base === 'limsup') return `\\limsup_{${lim}}`;
      if (base === '\\liminf' || base === 'liminf') return `\\liminf_{${lim}}`;
      if (base === '\\max' || base === 'max') return `\\max_{${lim}}`;
      if (base === '\\min' || base === 'min') return `\\min_{${lim}}`;
      if (base === '\\sup' || base === 'sup') return `\\sup_{${lim}}`;
      if (base === '\\inf' || base === 'inf') return `\\inf_{${lim}}`;
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

interface ResolvedRunProps {
  bold?: boolean;
  boldCs?: boolean;
  italic?: boolean;
  italicCs?: boolean;
  underline?: boolean;
  vert_align?: 'subscript' | 'superscript' | null;
  font_size_pt?: number;
  color?: string | null;
}

interface ParagraphStyleEntry {
  basedOn?: string;
  rPr: ResolvedRunProps;
  alignment?: BlockAlignment;
  indentLeftPt?: number;
  firstLineIndentPt?: number;
}

interface TableStyleEntry {
  basedOn?: string;
  rPr: ResolvedRunProps;
  firstRowRPr: ResolvedRunProps;
}

interface DocxStyleContext {
  themeColors: Map<string, string>;
  docDefaultRun: ResolvedRunProps;
  defaultParagraphStyleId?: string;
  paragraphStyles: Map<string, ParagraphStyleEntry>;
  characterStyles: Map<string, { basedOn?: string; rPr: ResolvedRunProps }>;
  tableStyles: Map<string, TableStyleEntry>;
}

const DEFAULT_OFFICE_THEME_COLORS: Record<string, string> = {
  dk1: '000000',
  lt1: 'FFFFFF',
  dk2: '44546A',
  lt2: 'E7E6E6',
  tx1: '000000',
  bg1: 'FFFFFF',
  tx2: '44546A',
  bg2: 'E7E6E6',
  accent1: '4472C4',
  accent2: 'ED7D31',
  accent3: 'A5A5A5',
  accent4: 'FFC000',
  accent5: '5B9BD5',
  accent6: '70AD47',
  hlink: '0563C1',
  folHlink: '954F72',
  dark1: '000000',
  light1: 'FFFFFF',
  dark2: '44546A',
  light2: 'E7E6E6',
  text1: '000000',
  background1: 'FFFFFF',
  text2: '44546A',
  background2: 'E7E6E6',
  hyperlink: '0563C1',
  followedHyperlink: '954F72',
};

function applyThemeTintShade(hex6: string, tintHex?: string | null, shadeHex?: string | null): string {
  const clean = hex6.replace(/^#/, '');
  if (!/^[0-9A-Fa-f]{6}$/.test(clean)) return hex6;
  let r = parseInt(clean.slice(0, 2), 16);
  let g = parseInt(clean.slice(2, 4), 16);
  let b = parseInt(clean.slice(4, 6), 16);

  if (tintHex && /^[0-9A-Fa-f]{2}$/.test(tintHex)) {
    const t = parseInt(tintHex, 16) / 255;
    r = Math.round(r * t + 255 * (1 - t));
    g = Math.round(g * t + 255 * (1 - t));
    b = Math.round(b * t + 255 * (1 - t));
  }
  if (shadeHex && /^[0-9A-Fa-f]{2}$/.test(shadeHex)) {
    const s = parseInt(shadeHex, 16) / 255;
    r = Math.round(r * s);
    g = Math.round(g * s);
    b = Math.round(b * s);
  }
  return [r, g, b]
    .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

function parseThemeColors(themeXml: Document | null): Map<string, string> {
  const map = new Map<string, string>(Object.entries(DEFAULT_OFFICE_THEME_COLORS));
  if (!themeXml) return map;

  const clrScheme = Array.from(themeXml.getElementsByTagName('*')).find(
    (el) => getLocalName(el) === 'clrScheme'
  );
  if (!clrScheme) return map;

  for (const child of getChildElements(clrScheme)) {
    const name = getLocalName(child);
    const srgb = getFirstChild(child, 'srgbClr');
    const sys = getFirstChild(child, 'sysClr');
    const val = (srgb && getAttr(srgb, 'val')) || (sys && (getAttr(sys, 'lastClr') || getAttr(sys, 'val')));
    if (val && /^[0-9A-Fa-f]{6}$/.test(val)) {
      const upper = val.toUpperCase();
      map.set(name, upper);
      if (name === 'dk1') {
        map.set('tx1', upper);
        map.set('dark1', upper);
        map.set('text1', upper);
      } else if (name === 'lt1') {
        map.set('bg1', upper);
        map.set('light1', upper);
        map.set('background1', upper);
      } else if (name === 'dk2') {
        map.set('tx2', upper);
        map.set('dark2', upper);
        map.set('text2', upper);
      } else if (name === 'lt2') {
        map.set('bg2', upper);
        map.set('light2', upper);
        map.set('background2', upper);
      } else if (name === 'hlink') {
        map.set('hyperlink', upper);
      } else if (name === 'folHlink') {
        map.set('followedHyperlink', upper);
      }
    }
  }
  return map;
}

function parseWordToggle(el: Element | null): boolean | undefined {
  if (!el) return undefined;
  const val = getAttr(el, 'val');
  if (val === '0' || val === 'false' || val === 'off') return false;
  return true;
}

function parseRPrElement(rPr: Element | null, themeColors?: Map<string, string>): ResolvedRunProps {
  if (!rPr) return {};
  const style: ResolvedRunProps = {};

  const bEl = getFirstChild(rPr, 'b');
  const bCsEl = getFirstChild(rPr, 'bCs');
  const bVal = parseWordToggle(bEl);
  const bCsVal = parseWordToggle(bCsEl);
  if (bVal !== undefined) {
    style.bold = bVal;
  }
  if (bCsVal !== undefined) {
    style.boldCs = bCsVal;
  }

  const iEl = getFirstChild(rPr, 'i');
  const iCsEl = getFirstChild(rPr, 'iCs');
  const iVal = parseWordToggle(iEl);
  const iCsVal = parseWordToggle(iCsEl);
  if (iVal !== undefined) {
    style.italic = iVal;
  }
  if (iCsVal !== undefined) {
    style.italicCs = iCsVal;
  }

  const uEl = getFirstChild(rPr, 'u');
  if (uEl) {
    const uVal = getAttr(uEl, 'val');
    style.underline = uVal !== 'none' && uVal !== 'false' && uVal !== '0';
  }

  const vertAlignEl = getFirstChild(rPr, 'vertAlign');
  if (vertAlignEl) {
    const vVal = getAttr(vertAlignEl, 'val');
    if (vVal === 'subscript' || vVal === 'superscript') {
      style.vert_align = vVal;
    } else if (vVal === 'baseline') {
      style.vert_align = null;
    }
  }

  const szEl = getFirstChild(rPr, 'sz');
  const szVal = getAttr(szEl, 'val');
  if (szVal && !Number.isNaN(Number(szVal))) {
    style.font_size_pt = Math.round((Number(szVal) / 2) * 10) / 10;
  }

  const colorEl = getFirstChild(rPr, 'color');
  if (colorEl) {
    const colorVal = getAttr(colorEl, 'val');
    const themeColor = getAttr(colorEl, 'themeColor');
    const themeTint = getAttr(colorEl, 'themeTint');
    const themeShade = getAttr(colorEl, 'themeShade');

    if (colorVal && /^[0-9A-Fa-f]{6}$/.test(colorVal)) {
      const upper = colorVal.toUpperCase();
      style.color = upper === '000000' ? null : `#${upper}`;
    } else if (themeColor) {
      const baseHex = themeColors?.get(themeColor) ?? DEFAULT_OFFICE_THEME_COLORS[themeColor];
      if (baseHex) {
        const tinted = applyThemeTintShade(baseHex, themeTint, themeShade);
        style.color = tinted === '000000' ? null : `#${tinted}`;
      }
    } else if (colorVal && colorVal.toLowerCase() === 'auto') {
      style.color = null;
    }
  }

  return style;
}

function mergeRunProps(...layers: Array<ResolvedRunProps | undefined>): ResolvedRunProps {
  const out: ResolvedRunProps = {};
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.bold !== undefined) out.bold = layer.bold;
    if (layer.boldCs !== undefined) out.boldCs = layer.boldCs;
    if (layer.italic !== undefined) out.italic = layer.italic;
    if (layer.italicCs !== undefined) out.italicCs = layer.italicCs;
    if (layer.underline !== undefined) out.underline = layer.underline;
    if (layer.vert_align !== undefined) out.vert_align = layer.vert_align;
    if (layer.font_size_pt !== undefined) out.font_size_pt = layer.font_size_pt;
    if (layer.color !== undefined) out.color = layer.color;
  }
  return out;
}

function resolvedPropsToSegmentStyle(
  props: ResolvedRunProps,
  textSample?: string
): Omit<InlineSegment, 'type' | 'content'> {
  const out: Omit<InlineSegment, 'type' | 'content'> = {};
  const isComplexScriptOnly =
    Boolean(textSample) &&
    /[\u0590-\u077F\u0900-\u0DFF\u0E00-\u0EFF]/.test(textSample!) &&
    !/[A-Za-z0-9\u00C0-\u024F\u1E00-\u1EFF]/.test(textSample!);
  const isBold = isComplexScriptOnly ? Boolean(props.boldCs ?? props.bold) : Boolean(props.bold);
  const isItalic = isComplexScriptOnly ? Boolean(props.italicCs ?? props.italic) : Boolean(props.italic);
  if (isBold) out.bold = true;
  if (isItalic) out.italic = true;
  if (props.underline) out.underline = true;
  if (props.vert_align) out.vert_align = props.vert_align;
  if (props.font_size_pt !== undefined) out.font_size_pt = props.font_size_pt;
  if (props.color) out.color = props.color;
  return out;
}

function parseIndTwipsOrChars(
  indEl: Element,
  twAttr: string,
  charsAttr: string,
  altTwAttr?: string
): number | undefined {
  const twRaw = getAttr(indEl, twAttr) ?? (altTwAttr ? getAttr(indEl, altTwAttr) : null);
  if (twRaw !== null && !Number.isNaN(Number(twRaw))) {
    return Number(twRaw);
  }
  const chRaw = getAttr(indEl, charsAttr);
  if (chRaw !== null && !Number.isNaN(Number(chRaw))) {
    return (Number(chRaw) / 100) * 120;
  }
  return undefined;
}

function parseParagraphIndentFromPPr(pPr: Element | null): {
  indentLeftPt?: number;
  firstLineIndentPt?: number;
} {
  if (!pPr) return {};
  const indEl = getFirstChild(pPr, 'ind');
  if (!indEl) return {};
  const leftTw = parseIndTwipsOrChars(indEl, 'left', 'leftChars', 'start');
  const firstTw = parseIndTwipsOrChars(indEl, 'firstLine', 'firstLineChars');
  const hangingTw = parseIndTwipsOrChars(indEl, 'hanging', 'hangingChars');

  let indentLeftPt: number | undefined;
  let firstLineIndentPt: number | undefined;

  if (hangingTw !== undefined && hangingTw > 0) {
    firstLineIndentPt = -Math.round((hangingTw / 20) * 10) / 10;
    const baseLeft = Math.max(0, (leftTw ?? 0) - hangingTw);
    if (baseLeft > 0) indentLeftPt = Math.round((baseLeft / 20) * 10) / 10;
    else if (leftTw !== undefined) indentLeftPt = 0;
  } else {
    if (leftTw !== undefined && leftTw >= 0) {
      indentLeftPt = Math.round((leftTw / 20) * 10) / 10;
    }
    if (firstTw !== undefined && firstTw >= 0) {
      firstLineIndentPt = Math.round((firstTw / 20) * 10) / 10;
    }
  }
  return { indentLeftPt, firstLineIndentPt };
}

function parseStylesDocument(
  stylesXml: Document | null,
  themeColors: Map<string, string>
): DocxStyleContext {
  const styleCtx: DocxStyleContext = {
    themeColors,
    docDefaultRun: {},
    paragraphStyles: new Map(),
    characterStyles: new Map(),
    tableStyles: new Map(),
  };
  if (!stylesXml) return styleCtx;

  const docDefaults = Array.from(stylesXml.getElementsByTagName('*')).find(
    (el) => getLocalName(el) === 'docDefaults'
  );
  if (docDefaults) {
    const rPrDefault = getFirstChild(docDefaults, 'rPrDefault');
    const rPr = rPrDefault ? getFirstChild(rPrDefault, 'rPr') : null;
    styleCtx.docDefaultRun = parseRPrElement(rPr, themeColors);
  }

  const styleEls = Array.from(stylesXml.getElementsByTagName('*')).filter(
    (el) => getLocalName(el) === 'style'
  );
  for (const sEl of styleEls) {
    const sType = getAttr(sEl, 'type') ?? '';
    const sId = getAttr(sEl, 'styleId');
    if (!sId) continue;
    const basedOn = getAttr(getFirstChild(sEl, 'basedOn'), 'val') ?? undefined;
    const isDefault = getAttr(sEl, 'default') === '1' || getAttr(sEl, 'default') === 'true';
    const rPr = parseRPrElement(getFirstChild(sEl, 'rPr'), themeColors);

    if (sType === 'paragraph') {
      if (isDefault && !styleCtx.defaultParagraphStyleId) {
        styleCtx.defaultParagraphStyleId = sId;
      }
      const pPr = getFirstChild(sEl, 'pPr');
      const jcVal = pPr ? getAttr(getFirstChild(pPr, 'jc'), 'val') : null;
      let alignment: BlockAlignment | undefined;
      if (jcVal === 'center') alignment = 'center';
      else if (jcVal === 'right' || jcVal === 'end') alignment = 'right';
      else if (jcVal === 'both' || jcVal === 'distribute') alignment = 'justify';
      else if (jcVal === 'left' || jcVal === 'start') alignment = 'left';
      const { indentLeftPt, firstLineIndentPt } = parseParagraphIndentFromPPr(pPr);
      styleCtx.paragraphStyles.set(sId, {
        basedOn,
        rPr,
        alignment,
        indentLeftPt,
        firstLineIndentPt,
      });
    } else if (sType === 'character') {
      styleCtx.characterStyles.set(sId, { basedOn, rPr });
    } else if (sType === 'table') {
      let firstRowRPr: ResolvedRunProps = {};
      for (const tblStylePr of getChildElements(sEl, 'tblStylePr')) {
        if (getAttr(tblStylePr, 'type') === 'firstRow') {
          firstRowRPr = parseRPrElement(getFirstChild(tblStylePr, 'rPr'), themeColors);
        }
      }
      styleCtx.tableStyles.set(sId, { basedOn, rPr, firstRowRPr });
    }
  }

  return styleCtx;
}

function resolveParagraphStyleChain(
  styleCtx: DocxStyleContext | undefined,
  styleId: string | undefined
): {
  rPr: ResolvedRunProps;
  alignment?: BlockAlignment;
  indentLeftPt?: number;
  firstLineIndentPt?: number;
} {
  if (!styleCtx || !styleId) return { rPr: {} };
  const chain: ParagraphStyleEntry[] = [];
  const visited = new Set<string>();
  let cur: string | undefined = styleId;
  while (cur && !visited.has(cur)) {
    visited.add(cur);
    const entry = styleCtx.paragraphStyles.get(cur);
    if (!entry) break;
    chain.unshift(entry);
    cur = entry.basedOn;
  }
  let alignment: BlockAlignment | undefined;
  let indentLeftPt: number | undefined;
  let firstLineIndentPt: number | undefined;
  for (const item of chain) {
    if (item.alignment) alignment = item.alignment;
    if (item.indentLeftPt !== undefined) indentLeftPt = item.indentLeftPt;
    if (item.firstLineIndentPt !== undefined) firstLineIndentPt = item.firstLineIndentPt;
  }
  return {
    rPr: mergeRunProps(...chain.map((c) => c.rPr)),
    alignment,
    indentLeftPt,
    firstLineIndentPt,
  };
}

function resolveTableStyleChain(
  styleCtx: DocxStyleContext | undefined,
  styleId: string | undefined | null
): { rPr: ResolvedRunProps; firstRowRPr: ResolvedRunProps } | undefined {
  if (!styleCtx || !styleId) return undefined;
  const chain: TableStyleEntry[] = [];
  const visited = new Set<string>();
  let cur: string | undefined = styleId;
  while (cur && !visited.has(cur)) {
    visited.add(cur);
    const entry = styleCtx.tableStyles.get(cur);
    if (!entry) break;
    chain.unshift(entry);
    cur = entry.basedOn;
  }
  if (chain.length === 0) return undefined;
  return {
    rPr: mergeRunProps(...chain.map((c) => c.rPr)),
    firstRowRPr: mergeRunProps(...chain.map((c) => c.firstRowRPr)),
  };
}

function resolveCharacterStyleChain(
  styleCtx: DocxStyleContext | undefined,
  styleId: string | undefined
): ResolvedRunProps {
  if (!styleCtx || !styleId) return {};
  const chain: ResolvedRunProps[] = [];
  const visited = new Set<string>();
  let cur: string | undefined = styleId;
  while (cur && !visited.has(cur)) {
    visited.add(cur);
    const entry = styleCtx.characterStyles.get(cur);
    if (!entry) break;
    chain.unshift(entry.rPr);
    cur = entry.basedOn;
  }
  return mergeRunProps(...chain);
}

function parseRunFormatting(
  rEl: Element,
  baseRunProps?: ResolvedRunProps,
  styleCtx?: DocxStyleContext,
  textSample?: string
): Omit<InlineSegment, 'type' | 'content'> {
  const rPr = getFirstChild(rEl, 'rPr');
  const rStyleId = rPr ? getAttr(getFirstChild(rPr, 'rStyle'), 'val') ?? undefined : undefined;
  const charStyleProps = resolveCharacterStyleChain(styleCtx, rStyleId);
  const directProps = parseRPrElement(rPr, styleCtx?.themeColors);
  const merged = mergeRunProps(baseRunProps, charStyleProps, directProps);
  return resolvedPropsToSegmentStyle(merged, textSample);
}

function extractOmmlRunStyle(
  mathEl: Element,
  baseRunProps?: ResolvedRunProps,
  styleCtx?: DocxStyleContext
): Omit<InlineSegment, 'type' | 'content'> {
  const mathRuns = Array.from(mathEl.getElementsByTagName('*')).filter(
    (el) => getLocalName(el) === 'r' && (el.prefix === 'm' || el.namespaceURI?.includes('/math'))
  );
  if (mathRuns.length === 0) {
    return resolvedPropsToSegmentStyle(baseRunProps ?? {});
  }

  let nonEmptyCount = 0;
  let boldCount = 0;
  const colorCounts = new Map<string, number>();

  for (const mr of mathRuns) {
    const txt = (mr.textContent ?? '').trim();
    if (!txt) continue;
    nonEmptyCount++;
    const wRPr = getFirstChild(mr, 'rPr');
    const direct = parseRPrElement(wRPr, styleCtx?.themeColors);
    const mRPr = Array.from(mr.childNodes).find(
      (n) =>
        n.nodeType === 1 &&
        getLocalName(n as Element) === 'rPr' &&
        ((n as Element).prefix === 'm' || (n as Element).namespaceURI?.includes('/math'))
    ) as Element | undefined;
    const styVal = mRPr ? getAttr(getFirstChild(mRPr, 'sty'), 'val') : null;
    const isBold =
      direct.bold !== undefined
        ? direct.bold
        : styVal === 'b' || styVal === 'bi'
        ? true
        : styVal
        ? false
        : Boolean(baseRunProps?.bold);
    if (isBold) boldCount++;

    const effectiveColor = direct.color !== undefined ? direct.color : baseRunProps?.color ?? null;
    if (effectiveColor) {
      colorCounts.set(effectiveColor, (colorCounts.get(effectiveColor) ?? 0) + 1);
    }
  }

  const out: Omit<InlineSegment, 'type' | 'content'> = {};
  if (nonEmptyCount > 0 && boldCount === nonEmptyCount) {
    out.bold = true;
  }
  // Apply color if majority of runs in this OMML share the same non-black color
  for (const [col, cnt] of colorCounts.entries()) {
    if (cnt >= Math.ceil(nonEmptyCount * 0.6)) {
      out.color = col;
      break;
    }
  }
  return out;
}

function sameTextStyle(
  a: Omit<InlineSegment, 'type' | 'content'>,
  b: Omit<InlineSegment, 'type' | 'content'>
): boolean {
  return (
    Boolean(a.bold) === Boolean(b.bold) &&
    Boolean(a.italic) === Boolean(b.italic) &&
    Boolean(a.underline) === Boolean(b.underline) &&
    (a.vert_align ?? undefined) === (b.vert_align ?? undefined) &&
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
  levelFormats: Map<string, { fmt: string; lvlText: string; rPr?: ResolvedRunProps }>;
  counters: Map<string, number>;
}

function createNumberingTracker(
  numberingXml: Document | null,
  themeColors?: Map<string, string>
): NumberingTracker {
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
      const lvlRPr = parseRPrElement(getFirstChild(lvl, 'rPr'), themeColors);
      tracker.levelFormats.set(`${absId}:${ilvl}`, { fmt, lvlText, rPr: lvlRPr });
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

function nextListLabel(
  tracker: NumberingTracker,
  numId: string,
  ilvl: string
): { text: string; rPr?: ResolvedRunProps } {
  const absId = tracker.numToAbstract.get(numId);
  const spec = absId ? tracker.levelFormats.get(`${absId}:${ilvl}`) : undefined;
  if (spec?.fmt === 'bullet') return { text: '• ', rPr: spec.rPr };

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
    return { text: `${spec.lvlText.replace(/%\d+/g, formatted)} `, rPr: spec.rPr };
  }
  return { text: `${formatted}. `, rPr: spec?.rPr };
}

function findBlipEmbedId(node: Element): string | null {
  const tag = getLocalName(node);
  if (tag === 'blip') {
    return getAttr(node, 'embed') || getAttr(node, 'link');
  }
  if (tag === 'imagedata') {
    return getAttr(node, 'id') || getAttr(node, 'relid') || getAttr(node, 'pict');
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

function findOleObjectRelId(node: Element): string | null {
  const tag = getLocalName(node);
  if (tag === 'OLEObject') {
    return getAttr(node, 'id');
  }
  for (let i = 0; i < node.childNodes.length; i++) {
    const ch = node.childNodes[i];
    if (ch.nodeType === 1) {
      const found = findOleObjectRelId(ch as Element);
      if (found) return found;
    }
  }
  return null;
}

interface DocxMediaContext {
  mediaMap: Map<string, DecodedImageAsset>;
  oleLatexMap: Map<string, string>;
  wmfLatexMap: Map<string, string>;
  styleCtx?: DocxStyleContext;
}

interface ParsedParagraphResult {
  blocks: DocumentBlock[];
  hasPageBreakAfter: boolean;
}

function parseParagraphElement(
  pEl: Element,
  ctx: DocxMediaContext,
  pageWidthPt: number,
  numberingTracker?: NumberingTracker,
  inheritedTableRunProps?: ResolvedRunProps
): ParsedParagraphResult {
  const pPr = getFirstChild(pEl, 'pPr');
  let alignment: BlockAlignment = 'left';
  let isHeading = false;
  let headingLevel = 2;
  let indentLeftPt: number | undefined;
  let firstLineIndentPt: number | undefined;
  let lineSpacing: number | undefined;
  let tabStopsPt: number[] | undefined;
  let listPrefix: { text: string; rPr?: ResolvedRunProps } | null = null;
  let pStyleId: string | undefined;

  const pStyleAttr = pPr ? getAttr(getFirstChild(pPr, 'pStyle'), 'val') ?? '' : '';
  if (pStyleAttr) pStyleId = pStyleAttr;
  const effectivePStyleId = pStyleId ?? ctx.styleCtx?.defaultParagraphStyleId;
  const resolvedPStyle = resolveParagraphStyleChain(ctx.styleCtx, effectivePStyleId);
  if (resolvedPStyle.alignment) alignment = resolvedPStyle.alignment;
  if (resolvedPStyle.indentLeftPt !== undefined && resolvedPStyle.indentLeftPt > 0) {
    indentLeftPt = resolvedPStyle.indentLeftPt;
  }
  if (resolvedPStyle.firstLineIndentPt !== undefined && resolvedPStyle.firstLineIndentPt !== 0) {
    firstLineIndentPt = resolvedPStyle.firstLineIndentPt;
  }

  if (pPr) {
    const jcVal = getAttr(getFirstChild(pPr, 'jc'), 'val');
    if (jcVal === 'center') alignment = 'center';
    else if (jcVal === 'right' || jcVal === 'end') alignment = 'right';
    else if (jcVal === 'both' || jcVal === 'distribute') alignment = 'justify';
    else if (jcVal === 'left' || jcVal === 'start') alignment = 'left';

    const hMatch = pStyleAttr.match(/^(?:Heading|Titre|Title)(\d?)$/i);
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

    const directIndent = parseParagraphIndentFromPPr(pPr);
    if (directIndent.indentLeftPt !== undefined) {
      indentLeftPt = directIndent.indentLeftPt > 0 ? directIndent.indentLeftPt : undefined;
    }
    if (directIndent.firstLineIndentPt !== undefined) {
      firstLineIndentPt =
        directIndent.firstLineIndentPt !== 0 ? directIndent.firstLineIndentPt : undefined;
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

  const pPrRunProps = pPr ? parseRPrElement(getFirstChild(pPr, 'rPr'), ctx.styleCtx?.themeColors) : undefined;
  const baseRunProps = mergeRunProps(
    ctx.styleCtx?.docDefaultRun,
    inheritedTableRunProps,
    resolvedPStyle.rPr
  );

  const rawSegments: InlineSegment[] = [];
  const standaloneFigures: DocumentBlock[] = [];
  let pendingTab = false;
  let hasPageBreakAfter = false;
  let standaloneEqLatex: string | null = null;
  let standaloneEqStyle: Omit<InlineSegment, 'type' | 'content'> = {};
  let hasNonEmptyTextRuns = false;

  const handleEmbeddedObjectOrImage = (
    el: Element
  ) => {
    const tagName = getLocalName(el);

    if (tagName === 'object') {
      const oleId = findOleObjectRelId(el);
      if (oleId && ctx.oleLatexMap.has(oleId)) {
        const latex = ctx.oleLatexMap.get(oleId)!;
        rawSegments.push({
          type: 'math',
          content: latex,
          ...(pendingTab ? { tab_before: true } : {}),
        });
        pendingTab = false;
        return;
      }
    }

    const embedId = findBlipEmbedId(el);
    if (!embedId) return;

    if (ctx.wmfLatexMap.has(embedId)) {
      const latex = ctx.wmfLatexMap.get(embedId)!;
      rawSegments.push({
        type: 'math',
        content: latex,
        ...(pendingTab ? { tab_before: true } : {}),
      });
      pendingTab = false;
      return;
    }

    if (ctx.mediaMap.has(embedId)) {
      const asset = ctx.mediaMap.get(embedId)!;
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
  };

  const processNode = (el: Element) => {
    const tag = getLocalName(el);
    if (tag === 'pPr' || tag === 'del' || tag === 'proofErr' || tag === 'bookmarkStart' || tag === 'bookmarkEnd') {
      return;
    }

    if (tag === 'oMathPara') {
      const latex = ommlElementToLatex(el).trim();
      if (latex) {
        const mathStyle = extractOmmlRunStyle(el, baseRunProps, ctx.styleCtx);
        if (!hasNonEmptyTextRuns && rawSegments.length === 0) {
          standaloneEqLatex = latex;
          standaloneEqStyle = mathStyle;
        } else {
          rawSegments.push({
            type: 'math',
            content: latex,
            ...mathStyle,
            ...(pendingTab ? { tab_before: true } : {}),
          });
          pendingTab = false;
        }
      }
      return;
    }

    if (tag === 'oMath') {
      const latex = ommlElementToLatex(el).trim();
      if (latex) {
        const mathStyle = extractOmmlRunStyle(el, baseRunProps, ctx.styleCtx);
        if (pendingTab) {
          rawSegments.push({ type: 'math', content: latex, ...mathStyle, tab_before: true });
          pendingTab = false;
        } else {
          rawSegments.push({ type: 'math', content: latex, ...mathStyle });
        }
      }
      return;
    }

    if (tag === 'object' || tag === 'drawing' || tag === 'pict') {
      handleEmbeddedObjectOrImage(el);
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
      const rTextSample = getChildElements(el, 't')
        .concat(getChildElements(el, 'delText'))
        .map((n) => n.textContent ?? '')
        .join('');
      const rStyle = parseRunFormatting(el, baseRunProps, ctx.styleCtx, rTextSample);
      for (let i = 0; i < el.childNodes.length; i++) {
        const ch = el.childNodes[i];
        if (ch.nodeType !== 1) continue;
        const cEl = ch as Element;
        const cTag = getLocalName(cEl);

        if (cTag === 't' || cTag === 'delText') {
          const txt = cEl.textContent ?? '';
          if (txt) {
            if (txt.trim()) hasNonEmptyTextRuns = true;
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
        } else if (cTag === 'drawing' || cTag === 'pict' || cTag === 'object') {
          handleEmbeddedObjectOrImage(cEl);
        } else if (cTag === 'AlternateContent') {
          const choice = getFirstChild(cEl, 'Choice');
          const fallback = getFirstChild(cEl, 'Fallback');
          const target = choice ?? fallback;
          if (target) {
            for (const inner of getChildElements(target)) {
              const iTag = getLocalName(inner);
              if (iTag === 'drawing' || iTag === 'pict' || iTag === 'object') {
                handleEmbeddedObjectOrImage(inner);
              }
            }
          }
        }
      }
    }
  };

  getChildElements(pEl).forEach(processNode);
  const segments = splitParagraphTextSegmentsForLatex(rawSegments);
  if (listPrefix && segments.length > 0) {
    const labelStyle = resolvedPropsToSegmentStyle(
      mergeRunProps(baseRunProps, pPrRunProps, listPrefix.rPr),
      listPrefix.text
    );
    segments.unshift({ type: 'text', content: listPrefix.text, ...labelStyle });
  }

  const blocks: DocumentBlock[] = [];

  // Check if paragraph is purely one inline equation (<m:oMath> or MathType) centered on its own line
  const nonBlankSegments = segments.filter(
    (s) => s.type !== 'text' || s.content.trim() !== ''
  );
  if (
    !standaloneEqLatex &&
    nonBlankSegments.length === 1 &&
    nonBlankSegments[0].type === 'math' &&
    alignment === 'center'
  ) {
    standaloneEqLatex = nonBlankSegments[0].content;
    standaloneEqStyle = {
      ...(nonBlankSegments[0].bold ? { bold: true } : {}),
      ...(nonBlankSegments[0].color ? { color: nonBlankSegments[0].color } : {}),
    };
    hasNonEmptyTextRuns = false;
  }

  if (standaloneEqLatex && !hasNonEmptyTextRuns) {
    blocks.push({
      block_type: 'equation',
      alignment: alignment === 'left' ? 'center' : alignment,
      latex: standaloneEqLatex,
      font_size_pt: 12,
      ...(standaloneEqStyle.bold ? { bold: true } : {}),
      ...(standaloneEqStyle.color ? { color: standaloneEqStyle.color } : {}),
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
  ctx: DocxMediaContext,
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

  const tblStyleId = tblPr ? getAttr(getFirstChild(tblPr, 'tblStyle'), 'val') : null;
  const tblStyleEntry = resolveTableStyleChain(ctx.styleCtx, tblStyleId);
  const tblLook = tblPr ? getFirstChild(tblPr, 'tblLook') : null;
  const tblLookVal = tblLook ? getAttr(tblLook, 'val') : null;
  const tblLookMask = tblLookVal && /^[0-9A-Fa-f]+$/.test(tblLookVal) ? parseInt(tblLookVal, 16) : null;
  const firstRowAttr = tblLook ? getAttr(tblLook, 'firstRow') : null;
  const firstRowEnabled =
    firstRowAttr !== null
      ? firstRowAttr !== '0' && firstRowAttr !== 'false'
      : tblLookMask !== null
      ? Boolean(tblLookMask & 0x0020)
      : false;

  const tblGrid = getFirstChild(tblEl, 'tblGrid');
  const gridCols = tblGrid
    ? getChildElements(tblGrid, 'gridCol').map((gc) => Number(getAttr(gc, 'w') ?? 0))
    : [];
  const totalGridW = gridCols.reduce((a, b) => a + b, 0);

  const trEls = getChildElements(tblEl, 'tr');
  const tableRows: TableCellData[][] = [];

  for (let rIdx = 0; rIdx < trEls.length; rIdx++) {
    const tr = trEls[rIdx];
    const trPr = getFirstChild(tr, 'trPr');
    const hasTblHeader = Boolean(trPr && getFirstChild(trPr, 'tblHeader'));
    const tcEls = getChildElements(tr, 'tc');
    const rowCells: TableCellData[] = [];
    let colCursor = 0;
    const rowInheritedProps =
      tblStyleEntry
        ? rIdx === 0 && (firstRowEnabled || hasTblHeader)
          ? mergeRunProps(tblStyleEntry.rPr, tblStyleEntry.firstRowRPr)
          : tblStyleEntry.rPr
        : undefined;

    for (const tc of tcEls) {
      const tcPr = getFirstChild(tc, 'tcPr');
      const spanVal = Number(getAttr(tcPr ? getFirstChild(tcPr, 'gridSpan') : null, 'val') ?? 1);
      const colSpan = Number.isFinite(spanVal) && spanVal > 1 ? Math.round(spanVal) : 1;

      const vMergeEl = tcPr ? getFirstChild(tcPr, 'vMerge') : null;
      const vMergeAttr = vMergeEl ? getAttr(vMergeEl, 'val') : null;
      const vMerge: 'restart' | 'continue' | undefined = vMergeEl
        ? vMergeAttr === 'restart'
          ? 'restart'
          : 'continue'
        : undefined;

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
        const res = parseParagraphElement(pEl, ctx, pageWidthPt, undefined, rowInheritedProps);
        res.blocks.forEach((b) => {
          if (pIdx === 0 && b.alignment) cellAlignment = b.alignment;
          if (b.block_type === 'equation' && b.latex) {
            if (cellSegments.length > 0) cellSegments.push({ type: 'text', content: '\n' });
            cellSegments.push({
              type: 'math',
              content: b.latex,
              ...(b.bold ? { bold: true } : {}),
              ...(b.color ? { color: b.color } : {}),
            });
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
        ...(vMerge ? { v_merge: vMerge } : {}),
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

  let themeXml: Document | null = null;
  const themeFile = zip.file('word/theme/theme1.xml');
  if (themeFile) {
    const themeStr = await themeFile.async('string');
    themeXml = parser.parseFromString(themeStr, 'application/xml');
  }
  const themeColors = parseThemeColors(themeXml);

  let stylesXml: Document | null = null;
  const stylesFile = zip.file('word/styles.xml');
  if (stylesFile) {
    const stylesStr = await stylesFile.async('string');
    stylesXml = parser.parseFromString(stylesStr, 'application/xml');
  }
  const styleCtx = parseStylesDocument(stylesXml, themeColors);

  let numberingXml: Document | null = null;
  const numberingFile = zip.file('word/numbering.xml');
  if (numberingFile) {
    const numStr = await numberingFile.async('string');
    numberingXml = parser.parseFromString(numStr, 'application/xml');
  }
  const numberingTracker = createNumberingTracker(numberingXml, themeColors);

  // Load relationships -> media assets + MathType OLE / WMF equations
  const mediaMap = new Map<string, DecodedImageAsset>();
  const oleLatexMap = new Map<string, string>();
  const wmfLatexMap = new Map<string, string>();
  const ctx: DocxMediaContext = { mediaMap, oleLatexMap, wmfLatexMap, styleCtx };

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
        if (!id || !target) return;

        const normTarget = target.replace(/\\/g, '/').replace(/^\.\.\//, '');
        const cleanTarget = normTarget.startsWith('/')
          ? normTarget.slice(1)
          : normTarget.startsWith('word/')
          ? normTarget
          : `word/${normTarget.replace(/^\.\//, '')}`;

        if (type.includes('/oleObject')) {
          const oleFile = zip.file(cleanTarget);
          if (!oleFile) return;
          const rawBuf = await oleFile.async('arraybuffer');
          const latex = extractLatexFromOleBuffer(new Uint8Array(rawBuf));
          if (latex) {
            oleLatexMap.set(id, latex);
          }
          return;
        }

        if (!type.includes('/image')) return;

        const imgFile = zip.file(cleanTarget);
        if (!imgFile) return;

        const ext = cleanTarget.split('.').pop()?.toLowerCase() ?? 'png';
        const rawBuf = await imgFile.async('arraybuffer');
        if (ext === 'wmf') {
          const latex = extractLatexFromWmfBuffer(new Uint8Array(rawBuf));
          if (latex) {
            wmfLatexMap.set(id, latex);
          }
          return;
        }
        if (ext === 'emf') {
          return;
        }
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
      const res = parseParagraphElement(child, ctx, pageWidthPt, numberingTracker);
      res.blocks.forEach(pushBlock);
      if (res.hasPageBreakAfter) {
        startNewPage();
      }
    } else if (tag === 'tbl') {
      const tblBlock = parseTableElement(child, ctx, pageWidthPt);
      if (tblBlock) pushBlock(tblBlock);
    } else if (tag === 'sdt') {
      const sdtContent = getFirstChild(child, 'sdtContent');
      if (sdtContent) {
        for (const inner of getChildElements(sdtContent)) {
          const innerTag = getLocalName(inner);
          if (innerTag === 'p') {
            const res = parseParagraphElement(inner, ctx, pageWidthPt, numberingTracker);
            res.blocks.forEach(pushBlock);
          } else if (innerTag === 'tbl') {
            const tblBlock = parseTableElement(inner, ctx, pageWidthPt);
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
