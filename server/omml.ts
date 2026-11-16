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

export function escapeXml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toSingleOmmlChar(raw: string, fallback = ''): string {
  const cleaned = raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .trim();
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
  if (style?.colorHex) {
    parts.push(`<w:color w:val="${style.colorHex}"/>`);
  }
  if (style?.sizeHalfPt) {
    parts.push(`<w:sz w:val="${style.sizeHalfPt}"/>`, `<w:szCs w:val="${style.sizeHalfPt}"/>`);
  }
  return `<w:rPr>${parts.join('')}</w:rPr>`;
}

function makeMathRun(text: string, plain = false, style?: OmmlStyleOptions): string {
  if (!text) return '';
  const rPr = plain ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : '';
  const wRPr = buildWordRunPr(style);
  const preserve = text.startsWith(' ') || text.endsWith(' ') ? ' xml:space="preserve"' : '';
  return `<m:r>${rPr}${wRPr}<m:t${preserve}>${escapeXml(text)}</m:t></m:r>`;
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

function convertChildren(node: XmlNode): string {
  return getElementChildren(node).map(convertNode).join('');
}

function convertMrowList(children: XmlElement[]): string {
  let result = '';
  let i = 0;

  while (i < children.length) {
    const ch = children[i];
    const tag = ch.localName || ch.tagName;

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
            subXml = `<m:sub>${convertNode(subChildren[1])}</m:sub>`;
            supXml = `<m:sup>${convertNode(subChildren[2])}</m:sup>`;
          } else if ((tag === 'msub' || tag === 'munder') && subChildren.length >= 2) {
            supHide = '<m:supHide m:val="1"/>';
            subXml = `<m:sub>${convertNode(subChildren[1])}</m:sub>`;
          } else if ((tag === 'msup' || tag === 'mover') && subChildren.length >= 2) {
            subHide = '<m:subHide m:val="1"/>';
            supXml = `<m:sup>${convertNode(subChildren[1])}</m:sup>`;
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

          const bodyXml = bodyNodes.map(convertNode).join('');
          const naryChr = toSingleOmmlChar(baseText, '∫');
          result += `<m:nary><m:naryPr><m:chr m:val="${escapeXml(naryChr)}"/><m:limLoc m:val="${limLoc}"/>${subHide}${supHide}</m:naryPr>${subXml}${supXml}<m:e>${bodyXml}</m:e></m:nary>`;
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
        const bodyXml = bodyNodes.map(convertNode).join('');
        const naryChr = toSingleOmmlChar(opText, '∫');
        result += `<m:nary><m:naryPr><m:chr m:val="${escapeXml(naryChr)}"/><m:limLoc m:val="subSup"/><m:subHide m:val="1"/><m:supHide m:val="1"/></m:naryPr><m:sub/><m:sup/><m:e>${bodyXml}</m:e></m:nary>`;
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
        const fNameXml = convertNode(ch);
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
          const bodyXml = convertMrowList(bodyNodes);
          result += `<m:func><m:funcPr/><m:fName>${fNameXml}</m:fName><m:e>${bodyXml}</m:e></m:func>`;
          i = j;
          continue;
        }

        result += fNameXml;
        i = j;
        continue;
      }
    }

    result += convertNode(ch);
    i++;
  }

  return result;
}

function convertNode(node: XmlElement): string {
  const tag = node.localName || node.tagName;

  if (tag === 'mi' || tag === 'mn' || tag === 'mo' || tag === 'mtext' || tag === 'ms') {
    const txt = getNodeText(node).replace(INVISIBLE_MATH_CHARS_RE, '');
    if (!txt) return '';
    const isPlain =
      tag === 'mn' || tag === 'mtext' || tag === 'ms' || (tag === 'mi' && txt.length > 1);
    return makeMathRun(txt, isPlain);
  }

  if (tag === 'mspace') {
    const widthAttr = (node.getAttribute('width') ?? '').trim();
    const emMatch = widthAttr.match(/^([\d.]+)em$/i);
    if (emMatch) {
      const emVal = parseFloat(emMatch[1]);
      if (emVal <= 0.05) return '';
      if (emVal <= 0.22) return makeMathRun('\u2009', true);
    }
    return makeMathRun(' ', true);
  }

  if (tag === 'math' || tag === 'mstyle' || tag === 'mpadded' || tag === 'semantics') {
    return convertMrowList(getElementChildren(node));
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
          return `<m:d><m:dPr><m:begChr m:val="{"/><m:endChr m:val=""/></m:dPr><m:e>${convertNode(children[1])}</m:e></m:d>`;
        }
      }

      if (isLeftDelim && isRightDelim && children.length >= 3) {
        const inner = convertMrowList(children.slice(1, -1));
        const beg = toSingleOmmlChar(firstTxt, '(');
        const end = toSingleOmmlChar(lastTxt, '');
        return `<m:d><m:dPr><m:begChr m:val="${escapeXml(beg)}"/><m:endChr m:val="${escapeXml(end)}"/></m:dPr><m:e>${inner}</m:e></m:d>`;
      }
    }

    return convertMrowList(children);
  }

  if (tag === 'mfenced') {
    const openChr = toSingleOmmlChar(node.getAttribute('open') ?? '(', '(');
    const closeChr = toSingleOmmlChar(node.getAttribute('close') ?? ')', ')');
    const children = getElementChildren(node);
    const elementsXml = children.map((ch) => `<m:e>${convertNode(ch)}</m:e>`).join('');
    return `<m:d><m:dPr><m:begChr m:val="${escapeXml(openChr)}"/><m:endChr m:val="${escapeXml(closeChr)}"/></m:dPr>${elementsXml || '<m:e/>'}</m:d>`;
  }

  if (tag === 'mfrac') {
    const children = getElementChildren(node);
    if (children.length >= 2) {
      const linethickness = node.getAttribute('linethickness');
      const fPr =
        linethickness === '0' || linethickness === '0px'
          ? '<m:fPr><m:type m:val="noBar"/></m:fPr>'
          : '';
      return `<m:f>${fPr}<m:num>${convertNode(children[0])}</m:num><m:den>${convertNode(children[1])}</m:den></m:f>`;
    }
  }

  if (tag === 'msqrt') {
    return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${convertMrowList(getElementChildren(node))}</m:e></m:rad>`;
  }

  if (tag === 'mroot') {
    const children = getElementChildren(node);
    if (children.length >= 2) {
      return `<m:rad><m:radPr/><m:deg>${convertNode(children[1])}</m:deg><m:e>${convertNode(children[0])}</m:e></m:rad>`;
    }
  }

  if (tag === 'msup') {
    const children = getElementChildren(node);
    if (children.length >= 2) {
      return `<m:sSup><m:e>${convertNode(children[0])}</m:e><m:sup>${convertNode(children[1])}</m:sup></m:sSup>`;
    }
  }

  if (tag === 'msub') {
    const children = getElementChildren(node);
    if (children.length >= 2) {
      return `<m:sSub><m:e>${convertNode(children[0])}</m:e><m:sub>${convertNode(children[1])}</m:sub></m:sSub>`;
    }
  }

  if (tag === 'msubsup') {
    const children = getElementChildren(node);
    if (children.length >= 3) {
      return `<m:sSubSup><m:e>${convertNode(children[0])}</m:e><m:sub>${convertNode(children[1])}</m:sub><m:sup>${convertNode(children[2])}</m:sup></m:sSubSup>`;
    }
  }

  if (tag === 'munder') {
    const children = getElementChildren(node);
    if (children.length >= 2) {
      return `<m:limLow><m:limLowPr/><m:e>${convertNode(children[0])}</m:e><m:lim>${convertNode(children[1])}</m:lim></m:limLow>`;
    }
  }

  if (tag === 'mover') {
    const children = getElementChildren(node);
    if (children.length >= 2) {
      const overText = getNodeText(children[1]).trim();
      if (overText === '¯' || overText === '‾') {
        return `<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${convertNode(children[0])}</m:e></m:bar>`;
      }
      if (ACCENT_CHARS.has(overText)) {
        const mapped = overText === '→' ? '⃗' : overText === '^' ? '̂' : overText;
        const accChr = toSingleOmmlChar(mapped, '⃗');
        return `<m:acc><m:accPr><m:chr m:val="${escapeXml(accChr)}"/></m:accPr><m:e>${convertNode(children[0])}</m:e></m:acc>`;
      }
      return `<m:limUpp><m:e>${convertNode(children[0])}</m:e><m:lim>${convertNode(children[1])}</m:lim></m:limUpp>`;
    }
  }

  if (tag === 'munderover') {
    const children = getElementChildren(node);
    if (children.length >= 3) {
      const low = `<m:limLow><m:e>${convertNode(children[0])}</m:e><m:lim>${convertNode(children[1])}</m:lim></m:limLow>`;
      return `<m:limUpp><m:e>${low}</m:e><m:lim>${convertNode(children[2])}</m:lim></m:limUpp>`;
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
      .map((cells) => {
        const cellEntries = cells.map(
          (cell) => `<m:e>${convertMrowList(getElementChildren(cell))}</m:e>`
        );
        while (cellEntries.length < maxCols) {
          cellEntries.push('<m:e/>');
        }
        return `<m:mr>${cellEntries.join('')}</m:mr>`;
      })
      .join('');
    const mPrXml = `<m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="${maxCols}"/><m:mcJc m:val="left"/></m:mcPr></m:mc></m:mcs></m:mPr>`;
    return `<m:m>${mPrXml}${rowsXml}</m:m>`;
  }

  if (tag === 'annotation' || tag === 'annotation-xml') {
    return '';
  }

  return convertChildren(node);
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

    let innerOmml = convertNode(root);
    if (!innerOmml) return null;

    if (style?.sizeHalfPt || style?.colorHex || style?.bold || style?.italic) {
      const styledWrPr = buildWordRunPr(style);
      const defaultWrPr = buildWordRunPr();
      innerOmml = innerOmml.split(defaultWrPr).join(styledWrPr);
    }

    if (style?.bold) {
      innerOmml = innerOmml
        .replace(/<m:rPr><m:sty m:val="p"\/><\/m:rPr>/g, '<m:rPr><m:sty m:val="b"/></m:rPr>')
        .replace(/<m:r><w:rPr>/g, '<m:r><m:rPr><m:sty m:val="bi"/></m:rPr><w:rPr>');
    } else if (style?.italic) {
      innerOmml = innerOmml.replace(
        /<m:rPr><m:sty m:val="p"\/><\/m:rPr>/g,
        '<m:rPr><m:sty m:val="i"/></m:rPr>'
      );
    }

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
