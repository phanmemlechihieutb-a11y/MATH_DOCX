import temml from 'temml';
import { DOMParser } from '@xmldom/xmldom';
import type { Element as XmlElement, Node as XmlNode } from '@xmldom/xmldom';

const NARY_CHARS = new Set(['∫', '∬', '∭', '∮', '∑', '∏', '∐', '⋃', '⋂', '⋁', '⋀']);
const ACCENT_CHARS = new Set(['→', '⃗', '¯', '^', 'ˆ', '˜', '˙', '¨', '˘', 'ˇ', '‾']);
const RELATION_BREAK_CHARS = new Set(['=', '<', '>', '≤', '≥', '≠', '≈', '≡', '⇒', '⇔', '→']);
const INVISIBLE_MATH_CHARS_RE = /[\u2061-\u2064\u200B\uFEFF]/g;
const LIMIT_FUNC_BASES = new Set(['lim', 'limsup', 'liminf', 'max', 'min', 'sup', 'inf']);
const FUNC_ARG_BREAK_CHARS = new Set([
  '=', '<', '>', '≤', '≥', '≠', '≈', '≡', '⇒', '⇔', '→',
  ',', ';', ':', '|', '.', ')', ']', '}',
]);
const BINARY_BREAK_CHARS = new Set(['+', '-', '−', '±', '∓']);

export function cleanLatex(raw: string): string {
  let s = (raw ?? '').trim();
  if (s.startsWith('$$') && s.endsWith('$$') && s.length >= 4) {
    s = s.slice(2, -2).trim();
  } else if (s.startsWith('$') && s.endsWith('$') && s.length >= 2) {
    s = s.slice(1, -1).trim();
  } else if (
    (s.startsWith('\\[') && s.endsWith('\\]')) ||
    (s.startsWith('\\(') && s.endsWith('\\)'))
  ) {
    s = s.slice(2, -2).trim();
  }
  return s;
}

function expandBalancedMacro(
  src: string,
  macroName: string,
  transform: (inner: string) => string
): string {
  const re = new RegExp(`\\\\${macroName}\\s*\\{`);
  let out = src;
  let safety = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(out)) !== null && safety < 50) {
    safety++;
    const braceStart = m.index + m[0].length - 1;
    let depth = 0;
    let endIdx = -1;
    for (let i = braceStart; i < out.length; i++) {
      if (out[i] === '\\' && i + 1 < out.length) {
        i++;
        continue;
      }
      if (out[i] === '{') depth++;
      else if (out[i] === '}') {
        depth--;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
    }
    if (endIdx === -1) break;
    const inner = out.slice(braceStart + 1, endIdx);
    out = out.slice(0, m.index) + transform(inner) + out.slice(endIdx + 1);
  }
  return out;
}

const CSS_COLOR_HEX_MAP: Record<string, string> = {
  black: '000000',
  white: 'FFFFFF',
  red: 'DC2626',
  crimson: 'DC143C',
  darkred: '991B1B',
  maroon: '800000',
  blue: '2563EB',
  darkblue: '1E3A8A',
  navy: '1E3A8A',
  royalblue: '1D4ED8',
  green: '16A34A',
  darkgreen: '15803D',
  forestgreen: '15803D',
  teal: '0D9488',
  cyan: '0891B2',
  orange: 'EA580C',
  purple: '9333EA',
  violet: '7C3AED',
  magenta: 'DB2777',
  pink: 'EC4899',
  brown: '92400E',
  gray: '64748B',
  grey: '64748B',
  yellow: 'CA8A04',
  olive: '65A30D',
  lime: '84CC16',
};

function parseCssColorToHex(raw: string): string | null | undefined {
  const s = raw.trim().toLowerCase();
  if (!s) return undefined;
  if (s === 'black' || s === '#000' || s === '#000000' || s === 'rgb(0, 0, 0)' || s === 'rgb(0,0,0)') {
    return null;
  }
  if (CSS_COLOR_HEX_MAP[s]) return CSS_COLOR_HEX_MAP[s];
  const hex6 = s.match(/^#([0-9a-f]{6})$/i);
  if (hex6) return hex6[1].toUpperCase();
  const hex3 = s.match(/^#([0-9a-f]{3})$/i);
  if (hex3) {
    return hex3[1]
      .split('')
      .map((c) => c + c)
      .join('')
      .toUpperCase();
  }
  const rgbM = s.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
  if (rgbM) {
    const hex = [rgbM[1], rgbM[2], rgbM[3]]
      .map((n) => Math.max(0, Math.min(255, parseInt(n, 10) || 0)).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    return hex === '000000' ? null : hex;
  }
  return undefined;
}

function extractNodeColorHex(node: XmlElement): string | null | undefined {
  const mathColor = node.getAttribute('mathcolor');
  if (mathColor) {
    const parsed = parseCssColorToHex(mathColor);
    if (parsed !== undefined) return parsed;
  }
  const styleAttr = node.getAttribute('style');
  if (styleAttr) {
    const colM = styleAttr.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
    if (colM) {
      const parsed = parseCssColorToHex(colM[1]);
      if (parsed !== undefined) return parsed;
    }
  }
  return undefined;
}

function normalizeMathColorsForTemml(s: string): string {
  return s.replace(
    /\\(textcolor|color)\s*\[([^\]]+)\]\s*\{([^}]+)\}/g,
    (full, cmd: string, modelRaw: string, specRaw: string) => {
      const model = modelRaw.trim();
      const spec = specRaw.trim();
      if (model.toUpperCase() === 'HTML') {
        const cleaned = spec.replace(/^#/, '').toUpperCase();
        if (/^[0-9A-F]{6}$/.test(cleaned)) return `\\${cmd}{#${cleaned}}`;
        if (/^[0-9A-F]{3}$/.test(cleaned)) {
          return `\\${cmd}{#${cleaned.split('').map((c) => c + c).join('')}}`;
        }
      } else if (model === 'RGB') {
        const parts = spec.split(',').map((p) => Math.max(0, Math.min(255, parseInt(p.trim(), 10) || 0)));
        if (parts.length === 3) {
          return `\\${cmd}{#${parts.map((n) => n.toString(16).padStart(2, '0').toUpperCase()).join('')}}`;
        }
      } else if (model === 'rgb') {
        const parts = spec.split(',').map((p) => Math.max(0, Math.min(1, parseFloat(p.trim()) || 0)));
        if (parts.length === 3) {
          return `\\${cmd}{#${parts.map((n) => Math.round(n * 255).toString(16).padStart(2, '0').toUpperCase()).join('')}}`;
        }
      } else if (model.toLowerCase() === 'gray') {
        const g = Math.max(0, Math.min(1, parseFloat(spec) || 0));
        const h = Math.round(g * 255).toString(16).padStart(2, '0').toUpperCase();
        return `\\${cmd}{#${h}${h}${h}}`;
      } else if (model.toLowerCase() === 'named') {
        return `\\${cmd}{${spec}}`;
      }
      return full;
    }
  );
}

function sanitizeLatexForTemml(latex: string): string {
  let s = cleanLatex(latex)
    .replace(/\\label\{[^}]*\}/g, '')
    .replace(/\\tag\*?\{[^}]*\}/g, '')
    .replace(/\\(?:nonumber|notag|noindent)(?![a-zA-Z])\s*/g, '')
    .replace(/\\intertext\{([^}]*)\}/g, '\\\\ \\text{$1} \\\\')
    .replace(/\\shortintertext\{([^}]*)\}/g, '\\\\ \\text{$1} \\\\')
    .replace(/\\allowbreak\b/g, '')
    .replace(/\\(lim|limsup|liminf)(?![a-zA-Z])(?!\s*\\(?:no)?limits(?![a-zA-Z]))(?=\s*_)/g, '\\$1\\limits')
    .replace(/\\implies/g, '\\Rightarrow')
    .replace(/\\iff/g, '\\Leftrightarrow')
    .replace(/\\leqslant/g, '\\leq')
    .replace(/\\geqslant/g, '\\geq')
    .replace(/\\arctg(?![a-zA-Z])/g, '\\arctan')
    .replace(/\\arccotg(?![a-zA-Z])/g, '\\operatorname{arccot}')
    .replace(/\\cotg(?![a-zA-Z])/g, '\\cot')
    .replace(/\\tg(?![a-zA-Z])/g, '\\tan')
    .replace(/\\degree(?![a-zA-Z])/g, '^\\circ')
    .replace(/\\dx(?![a-zA-Z])/g, '\\,dx')
    .replace(/\\(?:SI|qty)(?:\[[^\]]*\])?\s*\{([^}]*)\}\s*\{([^}]*)\}/g, (_m, v: string, u: string) => {
      const unit = u.replace(/\\per\b/g, '/').replace(/\\([a-zA-Z]+)/g, '$1').trim();
      return `${v.trim()}\\,\\mathrm{${unit}}`;
    })
    .replace(/\\num(?:\[[^\]]*\])?\s*\{([^}]*)\}/g, '$1')
    .replace(/\\(?:si|unit)(?:\[[^\]]*\])?\s*\{([^}]*)\}/g, (_m, u: string) => {
      const unit = u.replace(/\\per\b/g, '/').replace(/\\([a-zA-Z]+)/g, '$1').trim();
      return `\\mathrm{${unit}}`;
    });

  s = normalizeMathColorsForTemml(s);
  s = expandBalancedMacro(s, 'heva', (inner) => `\\begin{cases} ${inner} \\end{cases}`);
  s = expandBalancedMacro(
    s,
    'hoac',
    (inner) => `\\left[\\begin{aligned} ${inner} \\end{aligned}\\right.`
  );
  s = expandBalancedMacro(s, 'wideparen', (inner) => `\\widehat{${inner}}`);

  const eqMatch = s.match(/^\\begin\{(equation\*?|displaymath)\}([\s\S]*)\\end\{\1\}$/);
  if (eqMatch) {
    s = eqMatch[2].trim();
  }

  s = s
    .replace(/\\begin\{alignat\*?\}\s*\{[^}]*\}/g, '\\begin{aligned}')
    .replace(/\\end\{alignat\*?\}/g, '\\end{aligned}')
    .replace(/\\begin\{alignedat\}\s*\{[^}]*\}/g, '\\begin{aligned}')
    .replace(/\\end\{alignedat\}/g, '\\end{aligned}')
    .replace(/\\begin\{(align\*?|flalign\*?|eqnarray\*?|split)\}/g, '\\begin{aligned}')
    .replace(/\\end\{(align\*?|flalign\*?|eqnarray\*?|split)\}/g, '\\end{aligned}')
    .replace(/\\begin\{(gather\*?|multline\*?)\}/g, '\\begin{gathered}')
    .replace(/\\end\{(gather\*?|multline\*?)\}/g, '\\end{gathered}');

  return s.trim();
}

function stripInvalidXmlChars(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      code <= 0x0008 ||
      code === 0x000b ||
      code === 0x000c ||
      (code >= 0x000e && code <= 0x001f) ||
      (code >= 0x007f && code <= 0x0084) ||
      (code >= 0x0086 && code <= 0x009f) ||
      code === 0xfffe ||
      code === 0xffff
    ) {
      continue;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i] + text[i + 1];
        i++;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      continue;
    }
    out += text[i];
  }
  return out;
}

export function escapeXml(text: string): string {
  return stripInvalidXmlChars(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toSingleOmmlChar(raw: string, fallback = ''): string {
  const cleaned = stripInvalidXmlChars(raw).trim();
  if (!cleaned) return fallback;
  if (cleaned === '||') return '‖';
  const chars = Array.from(cleaned);
  return chars[0] ?? fallback;
}

export interface OmmlStyleOptions {
  sizeHalfPt?: number;
  align?: 'left' | 'center' | 'right' | 'justify';
  colorHex?: string | null;
  bold?: boolean;
  italic?: boolean;
}

function buildWordRunPr(style?: OmmlStyleOptions): string {
  const parts = [
    '<w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math" w:cs="Cambria Math"/>',
  ];
  if (style?.bold) {
    parts.push('<w:b/>');
  }
  if (style?.italic) {
    parts.push('<w:i/>');
  }
  if (style?.colorHex && /^[0-9A-Fa-f]{6}$/.test(style.colorHex)) {
    parts.push(`<w:color w:val="${style.colorHex.toUpperCase()}"/>`);
  }
  if (typeof style?.sizeHalfPt === 'number' && Number.isFinite(style.sizeHalfPt)) {
    const sz = Math.max(14, Math.min(96, Math.round(style.sizeHalfPt)));
    parts.push(`<w:sz w:val="${sz}"/>`, `<w:szCs w:val="${sz}"/>`);
  }
  return `<w:rPr>${parts.join('')}</w:rPr>`;
}

function buildCtrlPr(style?: OmmlStyleOptions): string {
  if (!style?.colorHex && !style?.sizeHalfPt && !style?.bold && !style?.italic) return '';
  return `<m:ctrlPr>${buildWordRunPr(style)}</m:ctrlPr>`;
}

function makeMathRun(text: string, plain = false, style?: OmmlStyleOptions): string {
  const normalized = stripInvalidXmlChars(text.replace(/\r\n?|\n/g, ' '));
  if (!normalized) return '';
  let rPr = '';
  if (plain) {
    const sty =
      style?.bold && style?.italic
        ? 'bi'
        : style?.bold
        ? 'b'
        : style?.italic
        ? 'i'
        : 'p';
    rPr = `<m:rPr><m:sty m:val="${sty}"/></m:rPr>`;
  } else if (style?.bold) {
    rPr = '<m:rPr><m:sty m:val="bi"/></m:rPr>';
  }
  const wRPr = buildWordRunPr(style);
  const preserve = /^\s|\s$|\s{2,}/.test(normalized) ? ' xml:space="preserve"' : '';
  return `<m:r>${rPr}${wRPr}<m:t${preserve}>${escapeXml(normalized)}</m:t></m:r>`;
}

function getElementChildren(node: XmlNode): XmlElement[] {
  const out: XmlElement[] = [];
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (child && child.nodeType === 1) {
      out.push(child as XmlElement);
    }
  }
  return out;
}

function getNodeText(node: XmlNode): string {
  return node.textContent ?? '';
}

function convertChildren(node: XmlNode, activeStyle?: OmmlStyleOptions): string {
  return getElementChildren(node)
    .map((ch) => convertNode(ch, activeStyle))
    .join('');
}

function resolveStyleWithNode(
  node: XmlElement,
  activeStyle?: OmmlStyleOptions
): OmmlStyleOptions | undefined {
  const ownColor = extractNodeColorHex(node);
  if (ownColor === undefined) return activeStyle;
  return { ...(activeStyle ?? {}), colorHex: ownColor };
}

function convertMrowList(children: XmlElement[], activeStyle?: OmmlStyleOptions): string {
  let result = '';
  let i = 0;

  while (i < children.length) {
    const ch = children[i];
    const tag = ch.localName || ch.tagName;
    const chStyle = resolveStyleWithNode(ch, activeStyle);

    // Check for n-ary operator (\int, \sum, \prod) with sub/sup bounds
    if (
      tag === 'msubsup' ||
      tag === 'msub' ||
      tag === 'msup' ||
      tag === 'munderover' ||
      tag === 'munder' ||
      tag === 'mover'
    ) {
      const subChildren = getElementChildren(ch);
      if (subChildren.length > 0) {
        const baseText = getNodeText(subChildren[0]).trim();
        if (NARY_CHARS.has(baseText)) {
          const limLoc =
            tag === 'munderover' || tag === 'munder' || tag === 'mover' ? 'undOvr' : 'subSup';
          let subHide = '';
          let supHide = '';
          let subXml = '<m:sub/>';
          let supXml = '<m:sup/>';

          if ((tag === 'msubsup' || tag === 'munderover') && subChildren.length >= 3) {
            subXml = `<m:sub>${convertNode(subChildren[1], chStyle)}</m:sub>`;
            supXml = `<m:sup>${convertNode(subChildren[2], chStyle)}</m:sup>`;
          } else if ((tag === 'msub' || tag === 'munder') && subChildren.length >= 2) {
            supHide = '<m:supHide m:val="1"/>';
            subXml = `<m:sub>${convertNode(subChildren[1], chStyle)}</m:sub>`;
          } else if ((tag === 'msup' || tag === 'mover') && subChildren.length >= 2) {
            subHide = '<m:subHide m:val="1"/>';
            supXml = `<m:sup>${convertNode(subChildren[1], chStyle)}</m:sup>`;
          }

          // Collect integrand / summand until relational boundary (=, <, >, ...)
          const bodyNodes: XmlElement[] = [];
          let j = i + 1;
          while (j < children.length) {
            const nextEl = children[j];
            const nextTag = nextEl.localName || nextEl.tagName;
            const nextText = getNodeText(nextEl).trim();
            if (nextTag === 'mo' && RELATION_BREAK_CHARS.has(nextText)) {
              break;
            }
            bodyNodes.push(nextEl);
            j++;
          }

          const bodyXml = bodyNodes.map((bn) => convertNode(bn, activeStyle)).join('');
          const naryChr = toSingleOmmlChar(baseText, '∫');
          const ctrlPr = buildCtrlPr(chStyle);
          result += `<m:nary><m:naryPr><m:chr m:val="${escapeXml(naryChr)}"/><m:limLoc m:val="${limLoc}"/>${subHide}${supHide}${ctrlPr}</m:naryPr>${subXml}${supXml}<m:e>${bodyXml}</m:e></m:nary>`;
          i = j;
          continue;
        }
      }
    }

    // Check for bare n-ary operator without explicit limits
    if (tag === 'mo') {
      const opText = getNodeText(ch).trim();
      if (NARY_CHARS.has(opText)) {
        const bodyNodes: XmlElement[] = [];
        let j = i + 1;
        while (j < children.length) {
          const nextEl = children[j];
          const nextTag = nextEl.localName || nextEl.tagName;
          const nextText = getNodeText(nextEl).trim();
          if (nextTag === 'mo' && RELATION_BREAK_CHARS.has(nextText)) {
            break;
          }
          bodyNodes.push(nextEl);
          j++;
        }
        const bodyXml = bodyNodes.map((bn) => convertNode(bn, activeStyle)).join('');
        const naryChr = toSingleOmmlChar(opText, '∫');
        const ctrlPr = buildCtrlPr(chStyle);
        result += `<m:nary><m:naryPr><m:chr m:val="${escapeXml(naryChr)}"/><m:limLoc m:val="subSup"/><m:subHide m:val="1"/><m:supHide m:val="1"/>${ctrlPr}</m:naryPr><m:sub/><m:sup/><m:e>${bodyXml}</m:e></m:nary>`;
        i = j;
        continue;
      }
    }

    // Check for limit/extremum operator with limits (\lim_{...}, \limsup_{...}, \max\limits_{...}, etc.)
    if (tag === 'munder' || tag === 'msub' || tag === 'mi') {
      let baseText = '';
      if (tag === 'mi') {
        baseText = getNodeText(ch).replace(INVISIBLE_MATH_CHARS_RE, '').replace(/\s+/g, '').trim();
      } else {
        const subChildren = getElementChildren(ch);
        if (subChildren.length > 0) {
          baseText = getNodeText(subChildren[0])
            .replace(INVISIBLE_MATH_CHARS_RE, '')
            .replace(/\s+/g, '')
            .trim();
        }
      }

      if (LIMIT_FUNC_BASES.has(baseText)) {
        const fNameXml = convertNode(ch, activeStyle);
        let j = i + 1;
        // Skip invisible function-application operators and thin space right after operator
        while (j < children.length) {
          const nextEl = children[j];
          const nextTag = nextEl.localName || nextEl.tagName;
          if (nextTag === 'mo') {
            const cleanedOp = getNodeText(nextEl).replace(INVISIBLE_MATH_CHARS_RE, '').trim();
            if (!cleanedOp) {
              j++;
              continue;
            }
          }
          if (nextTag === 'mspace') {
            const widthAttr = (nextEl.getAttribute('width') ?? '').trim();
            const emMatch = widthAttr.match(/^([\d.]+)em$/i);
            if (!emMatch || parseFloat(emMatch[1]) <= 0.25) {
              j++;
              continue;
            }
          }
          break;
        }

        const bodyNodes: XmlElement[] = [];
        while (j < children.length) {
          const nextEl = children[j];
          const nextTag = nextEl.localName || nextEl.tagName;
          const nextText = getNodeText(nextEl).replace(INVISIBLE_MATH_CHARS_RE, '').trim();
          if (nextTag === 'mo') {
            if (!nextText) {
              j++;
              continue;
            }
            if (FUNC_ARG_BREAK_CHARS.has(nextText)) {
              break;
            }
            if (bodyNodes.length > 0 && BINARY_BREAK_CHARS.has(nextText)) {
              break;
            }
          }
          bodyNodes.push(nextEl);
          j++;
        }

        if (bodyNodes.length > 0) {
          const bodyXml = convertMrowList(bodyNodes, activeStyle);
          const ctrlPr = buildCtrlPr(chStyle);
          result += `<m:func><m:funcPr>${ctrlPr}</m:funcPr><m:fName>${fNameXml}</m:fName><m:e>${bodyXml}</m:e></m:func>`;
          i = j;
          continue;
        }

        result += fNameXml;
        i = j;
        continue;
      }
    }

    result += convertNode(ch, activeStyle);
    i++;
  }

  return result;
}

function convertNode(node: XmlElement, activeStyle?: OmmlStyleOptions): string {
  const tag = node.localName || node.tagName;
  const nextStyle = resolveStyleWithNode(node, activeStyle);

  if (tag === 'mi' || tag === 'mn' || tag === 'mo' || tag === 'mtext' || tag === 'ms') {
    const txt = getNodeText(node).replace(INVISIBLE_MATH_CHARS_RE, '');
    if (!txt) return '';
    const isPlain =
      tag === 'mn' || tag === 'mtext' || tag === 'ms' || (tag === 'mi' && txt.length > 1);
    return makeMathRun(txt, isPlain, nextStyle);
  }

  if (tag === 'mspace') {
    const widthAttr = (node.getAttribute('width') ?? '').trim();
    const emMatch = widthAttr.match(/^([\d.]+)em$/i);
    if (emMatch) {
      const emVal = parseFloat(emMatch[1]);
      if (emVal <= 0.05) return '';
      if (emVal <= 0.22) return makeMathRun('\u2009', true, nextStyle);
    }
    return makeMathRun(' ', true, nextStyle);
  }

  if (tag === 'math' || tag === 'mstyle' || tag === 'mpadded' || tag === 'semantics') {
    return convertMrowList(getElementChildren(node), nextStyle);
  }

  if (tag === 'mrow') {
    const children = getElementChildren(node);
    // Detect stretchy delimiter pairs like \left( ... \right) or \begin{cases}
    if (children.length >= 2) {
      const first = children[0];
      const last = children[children.length - 1];
      const firstTag = first.localName || first.tagName;
      const lastTag = last.localName || last.tagName;
      const firstTxt = getNodeText(first).trim();
      const lastTxt = getNodeText(last).trim();

      const isLeftDelim =
        firstTag === 'mo' &&
        (first.getAttribute('stretchy') === 'true' ||
          ['(', '[', '{', '|', '‖', '⟨'].includes(firstTxt));
      const isRightDelim =
        lastTag === 'mo' &&
        (last.getAttribute('stretchy') === 'true' ||
          [')', ']', '}', '|', '‖', '⟩', ''].includes(lastTxt));

      // Special case: \begin{cases} has '{' at start and mtable inside
      if (firstTag === 'mo' && firstTxt === '{' && children.length === 2) {
        const secondTag = children[1].localName || children[1].tagName;
        if (secondTag === 'mtable') {
          const delimStyle = resolveStyleWithNode(first, nextStyle);
          const ctrlPr = buildCtrlPr(delimStyle);
          return `<m:d><m:dPr><m:begChr m:val="{"/><m:endChr m:val=""/>${ctrlPr}</m:dPr><m:e>${convertNode(children[1], nextStyle)}</m:e></m:d>`;
        }
      }

      if (isLeftDelim && isRightDelim && children.length >= 3) {
        const inner = convertMrowList(children.slice(1, -1), nextStyle);
        const beg = toSingleOmmlChar(firstTxt, '');
        const end = toSingleOmmlChar(lastTxt, '');
        const delimStyle = resolveStyleWithNode(first, nextStyle);
        const ctrlPr = buildCtrlPr(delimStyle);
        return `<m:d><m:dPr><m:begChr m:val="${escapeXml(beg)}"/><m:endChr m:val="${escapeXml(end)}"/>${ctrlPr}</m:dPr><m:e>${inner}</m:e></m:d>`;
      }
    }

    return convertMrowList(children, nextStyle);
  }

  if (tag === 'mfenced') {
    const openChr = toSingleOmmlChar(node.getAttribute('open') ?? '(', '(');
    const closeChr = toSingleOmmlChar(node.getAttribute('close') ?? ')', ')');
    const children = getElementChildren(node);
    const elementsXml = children.map((ch) => `<m:e>${convertNode(ch, nextStyle)}</m:e>`).join('');
    const ctrlPr = buildCtrlPr(nextStyle);
    return `<m:d><m:dPr><m:begChr m:val="${escapeXml(openChr)}"/><m:endChr m:val="${escapeXml(closeChr)}"/>${ctrlPr}</m:dPr>${elementsXml || '<m:e/>'}</m:d>`;
  }

  if (tag === 'mfrac') {
    const children = getElementChildren(node);
    if (children.length >= 2) {
      const linethickness = node.getAttribute('linethickness');
      const typeXml =
        linethickness === '0' || linethickness === '0px'
          ? '<m:type m:val="noBar"/>'
          : '';
      const ctrlPr = buildCtrlPr(nextStyle);
      const fPr = typeXml || ctrlPr ? `<m:fPr>${typeXml}${ctrlPr}</m:fPr>` : '';
      return `<m:f>${fPr}<m:num>${convertNode(children[0], nextStyle)}</m:num><m:den>${convertNode(children[1], nextStyle)}</m:den></m:f>`;
    }
  }

  if (tag === 'msqrt') {
    const ctrlPr = buildCtrlPr(nextStyle);
    return `<m:rad><m:radPr><m:degHide m:val="1"/>${ctrlPr}</m:radPr><m:deg/><m:e>${convertMrowList(getElementChildren(node), nextStyle)}</m:e></m:rad>`;
  }

  if (tag === 'mroot') {
    const children = getElementChildren(node);
    if (children.length >= 2) {
      const ctrlPr = buildCtrlPr(nextStyle);
      const radPr = ctrlPr ? `<m:radPr>${ctrlPr}</m:radPr>` : '<m:radPr/>';
      return `<m:rad>${radPr}<m:deg>${convertNode(children[1], nextStyle)}</m:deg><m:e>${convertNode(children[0], nextStyle)}</m:e></m:rad>`;
    }
  }

  if (tag === 'msup') {
    const children = getElementChildren(node);
    if (children.length >= 2) {
      return `<m:sSup><m:e>${convertNode(children[0], nextStyle)}</m:e><m:sup>${convertNode(children[1], nextStyle)}</m:sup></m:sSup>`;
    }
  }

  if (tag === 'msub') {
    const children = getElementChildren(node);
    if (children.length >= 2) {
      return `<m:sSub><m:e>${convertNode(children[0], nextStyle)}</m:e><m:sub>${convertNode(children[1], nextStyle)}</m:sub></m:sSub>`;
    }
  }

  if (tag === 'msubsup') {
    const children = getElementChildren(node);
    if (children.length >= 3) {
      return `<m:sSubSup><m:e>${convertNode(children[0], nextStyle)}</m:e><m:sub>${convertNode(children[1], nextStyle)}</m:sub><m:sup>${convertNode(children[2], nextStyle)}</m:sup></m:sSubSup>`;
    }
  }

  if (tag === 'munder') {
    const children = getElementChildren(node);
    if (children.length >= 2) {
      const ctrlPr = buildCtrlPr(nextStyle);
      const limLowPr = ctrlPr ? `<m:limLowPr>${ctrlPr}</m:limLowPr>` : '<m:limLowPr/>';
      return `<m:limLow>${limLowPr}<m:e>${convertNode(children[0], nextStyle)}</m:e><m:lim>${convertNode(children[1], nextStyle)}</m:lim></m:limLow>`;
    }
  }

  if (tag === 'mover') {
    const children = getElementChildren(node);
    if (children.length >= 2) {
      const overText = getNodeText(children[1]).trim();
      const ctrlPr = buildCtrlPr(nextStyle);
      if (overText === '¯' || overText === '‾') {
        return `<m:bar><m:barPr><m:pos m:val="top"/>${ctrlPr}</m:barPr><m:e>${convertNode(children[0], nextStyle)}</m:e></m:bar>`;
      }
      if (ACCENT_CHARS.has(overText)) {
        const mapped = overText === '→' ? '⃗' : overText === '^' ? '̂' : overText;
        const accChr = toSingleOmmlChar(mapped, '⃗');
        return `<m:acc><m:accPr><m:chr m:val="${escapeXml(accChr)}"/>${ctrlPr}</m:accPr><m:e>${convertNode(children[0], nextStyle)}</m:e></m:acc>`;
      }
      const limUppPr = ctrlPr ? `<m:limUppPr>${ctrlPr}</m:limUppPr>` : '';
      return `<m:limUpp>${limUppPr}<m:e>${convertNode(children[0], nextStyle)}</m:e><m:lim>${convertNode(children[1], nextStyle)}</m:lim></m:limUpp>`;
    }
  }

  if (tag === 'munderover') {
    const children = getElementChildren(node);
    if (children.length >= 3) {
      const ctrlPr = buildCtrlPr(nextStyle);
      const limLowPr = ctrlPr ? `<m:limLowPr>${ctrlPr}</m:limLowPr>` : '';
      const limUppPr = ctrlPr ? `<m:limUppPr>${ctrlPr}</m:limUppPr>` : '';
      const low = `<m:limLow>${limLowPr}<m:e>${convertNode(children[0], nextStyle)}</m:e><m:lim>${convertNode(children[1], nextStyle)}</m:lim></m:limLow>`;
      return `<m:limUpp>${limUppPr}<m:e>${low}</m:e><m:lim>${convertNode(children[2], nextStyle)}</m:lim></m:limUpp>`;
    }
  }

  if (tag === 'mtable') {
    const rows = getElementChildren(node).filter(
      (r) => (r.localName || r.tagName) === 'mtr' || (r.localName || r.tagName) === 'mlabeledtr'
    );
    if (rows.length === 0) return '';
    const parsedRows = rows.map((row) =>
      getElementChildren(row).filter((c) => (c.localName || c.tagName) === 'mtd')
    );
    const maxCols = Math.max(1, ...parsedRows.map((cells) => cells.length));
    const rowsXml = parsedRows
      .map((cells, rIdx) => {
        const rowStyle = resolveStyleWithNode(rows[rIdx], nextStyle);
        const cellEntries = cells.map((cell) => {
          const cellStyle = resolveStyleWithNode(cell, rowStyle);
          return `<m:e>${convertMrowList(getElementChildren(cell), cellStyle)}</m:e>`;
        });
        while (cellEntries.length < maxCols) {
          cellEntries.push('<m:e/>');
        }
        return `<m:mr>${cellEntries.join('')}</m:mr>`;
      })
      .join('');
    const ctrlPr = buildCtrlPr(nextStyle);
    const mPrXml = `<m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="${maxCols}"/><m:mcJc m:val="left"/></m:mcPr></m:mc></m:mcs>${ctrlPr}</m:mPr>`;
    return `<m:m>${mPrXml}${rowsXml}</m:m>`;
  }

  if (tag === 'annotation' || tag === 'annotation-xml') {
    return '';
  }

  return convertChildren(node, nextStyle);
}

const sharedDomParser = new DOMParser();
const OMML_CACHE_MAX = 2000;
const ommlCache = new Map<string, string | null>();

export function latexToOmmlXml(
  rawLatex: string,
  isDisplay: boolean,
  style?: OmmlStyleOptions
): string | null {
  const sanitized = sanitizeLatexForTemml(rawLatex);
  if (!sanitized) return null;

  const cacheKey = `${isDisplay ? 'D' : 'I'}|${style?.sizeHalfPt ?? ''}|${style?.align ?? ''}|${
    style?.colorHex ?? ''
  }|${style?.bold ? 'B' : ''}${style?.italic ? 'I' : ''}|${sanitized}`;
  if (ommlCache.has(cacheKey)) {
    return ommlCache.get(cacheKey) ?? null;
  }

  try {
    const mathml = temml.renderToString(sanitized, {
      displayMode: isDisplay,
      xml: true,
      throwOnError: false,
    });

    const doc = sharedDomParser.parseFromString(mathml, 'application/xml');
    const root = doc.documentElement;
    if (!root) return null;

    const innerOmml = convertNode(root, style);
    if (!innerOmml) return null;

    const oMath = `<m:oMath>${innerOmml}</m:oMath>`;
    let result: string;
    if (isDisplay) {
      const jcVal =
        style?.align === 'right'
          ? 'right'
          : style?.align === 'left' || style?.align === 'justify'
          ? 'left'
          : 'center';
      result = `<m:oMathPara><m:oMathParaPr><m:jc m:val="${jcVal}"/></m:oMathParaPr>${oMath}</m:oMathPara>`;
    } else {
      result = oMath;
    }

    if (ommlCache.size >= OMML_CACHE_MAX) {
      const oldestKey = ommlCache.keys().next().value;
      if (oldestKey !== undefined) ommlCache.delete(oldestKey);
    }
    ommlCache.set(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}
