import type {
  BlockAlignment,
  DocumentBlock,
  InlineSegment,
  PageExtraction,
  TableCellData,
} from '../types/document.ts';
import { renderLatexPictureToSvgDataUrl } from './tikzRenderer.ts';

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
  /\\(?:(?:frac|dfrac|tfrac|binom|dbinom|sqrt|int|iint|iiint|oint|sum|prod|lim|limsup|liminf|vec|overrightarrow|overleftarrow|widehat|widetilde|overline|bar|tilde|hat|heva|hoac|mathbb|mathcal|mathfrak|mathrm|sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|log|ln|lg|exp|max|min|sup|inf|alpha|beta|gamma|delta|Delta|epsilon|varepsilon|zeta|eta|theta|vartheta|lambda|mu|nu|xi|pi|rho|sigma|tau|phi|varphi|chi|psi|omega|Omega|Gamma|Theta|Lambda|Sigma|Phi|Psi|infty|partial|nabla|leq|geq|neq|approx|equiv|sim|simeq|cong|propto|pm|mp|times|cdot|div|ast|star|circ|bullet|in|notin|ni|subset|subseteq|supset|supseteq|cup|cap|setminus|emptyset|varnothing|forall|exists|nexists|neg|land|lor|Rightarrow|Leftrightarrow|Leftarrow|rightarrow|leftarrow|leftrightarrow|to|mapsto|implies|iff)(?![a-zA-Z])|begin\{)/;

const LATEX_COLOR_MAP: Record<string, string> = {
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
  black: '#0F172A',
  navy: '#1E3A8A',
  maroon: '#991B1B',
  yellow: '#CA8A04',
  olive: '#65A30D',
  pink: '#EC4899',
  lime: '#84CC16',
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
  font_size_pt?: number;
  color?: string;
}

interface CustomTheoremDef {
  envName: string;
  title: string;
  unnumbered: boolean;
  sharedCounter?: string;
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
}

function createParserContext(
  initial?: Partial<
    Pick<ParserContext, 'isVietnamese' | 'labels' | 'labelKinds' | 'cites' | 'customTheorems' | 'customColors'>
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

function resolveLatexColor(raw: string, customColors?: Record<string, string>): string | undefined {
  const c = raw.trim().toLowerCase();
  if (!c) return undefined;
  if (customColors && customColors[c]) return customColors[c];
  if (LATEX_COLOR_MAP[c]) return LATEX_COLOR_MAP[c];
  if (/^#?[0-9a-f]{6}$/i.test(c)) {
    return c.startsWith('#') ? c.toUpperCase() : `#${c.toUpperCase()}`;
  }
  const base = c.split('!')[0]?.trim();
  if (base && customColors && customColors[base]) return customColors[base];
  if (base && LATEX_COLOR_MAP[base]) return LATEX_COLOR_MAP[base];
  return undefined;
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

  const lines = protectedRaw.split('\n');
  const cleanedLines = lines.map((line) => {
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '\\') {
        i++;
        continue;
      }
      if (line[i] === '%') {
        return line.slice(0, i);
      }
    }
    return line;
  });

  let joined = cleanedLines.join('\n');
  for (let idx = 0; idx < verbatimStore.length; idx++) {
    joined = joined.replace(`\x00VERBATIM_${idx}\x00`, () => verbatimStore[idx]);
  }
  return joined;
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

function preprocessDocumentAndMacros(raw: string): {
  body: string;
  title?: string;
  author?: string;
  date?: string;
  isFullLatexDoc: boolean;
  isVietnamese: boolean;
  customTheorems: Record<string, CustomTheoremDef>;
  customColors: Record<string, string>;
} {
  const normalized = stripLatexComments(raw.replace(/\r\n/g, '\n'));
  const hasDocBegin = /\\begin\{document\}/.test(normalized);

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

  const macros: ExtractedMacro[] = [];
  const envMacros: ExtractedEnvMacro[] = [];
  const customTheorems: Record<string, CustomTheoremDef> = {};
  const customColors: Record<string, string> = {};

  const macroSrc = preamble ? `${preamble}\n${body}` : body;

  // Parse \newcommand / \renewcommand / \providecommand / \DeclareRobustCommand (0..9 args)
  // Supports both \newcommand{\name}[n]{body} and \newcommand\name[n]{body}
  const cmdRe = /\\(?:(?:re|provide)?newcommand|DeclareRobustCommand)\*?\s*(?:\{\\([a-zA-Z]+)\}|\\([a-zA-Z]+))/g;
  let m: RegExpExecArray | null;
  while ((m = cmdRe.exec(macroSrc)) !== null) {
    const name = m[1] || m[2];
    if (!name) continue;
    let pos = skipSpaces(macroSrc, m.index + m[0].length);
    let argCount = 0;
    let defaultOpt: string | undefined;
    if (macroSrc[pos] === '[') {
      const brk = readBalancedBrackets(macroSrc, pos);
      if (brk) {
        argCount = Math.max(0, Math.min(9, parseInt(brk.content.trim(), 10) || 0));
        pos = skipSpaces(macroSrc, brk.endIdx + 1);
      }
    }
    if (macroSrc[pos] === '[') {
      const defOpt = readBalancedBrackets(macroSrc, pos);
      if (defOpt) {
        defaultOpt = defOpt.content;
        pos = skipSpaces(macroSrc, defOpt.endIdx + 1);
      }
    }
    if (macroSrc[pos] === '{') {
      const br = readBalancedBraces(macroSrc, pos);
      if (br) {
        macros.push({ name, argCount, defaultOpt, body: br.content });
      }
    }
  }

  // Parse \def\name#1#2...{body}
  const defRe = /\\(?:g|e|x)?def\\([a-zA-Z]+)\s*((?:#[1-9]\s*)*)\{/g;
  while ((m = defRe.exec(macroSrc)) !== null) {
    const name = m[1];
    const params = m[2] ? m[2].match(/#[1-9]/g) ?? [] : [];
    const argCount = Math.min(9, params.length);
    const br = readBalancedBraces(macroSrc, m.index + m[0].length - 1);
    if (br) {
      macros.push({ name, argCount, body: br.content });
    }
  }

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

  // Parse \DeclareMathOperator(*)?{\op}{text}
  const opRe = /\\DeclareMathOperator(\*?)\s*\{\\([a-zA-Z]+)\}\s*\{/g;
  while ((m = opRe.exec(macroSrc)) !== null) {
    const starred = Boolean(m[1]);
    const name = m[2];
    const br = readBalancedBraces(macroSrc, m.index + m[0].length - 1);
    if (br) {
      macros.push({
        name,
        argCount: 0,
        body: starred ? `\\operatorname*{${br.content}}` : `\\operatorname{${br.content}}`,
      });
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

  // Parse \definecolor{name}{model}{spec}
  const colRe = /\\definecolor\s*\{([^}]+)\}\s*\{([^}]+)\}\s*\{([^}]+)\}/g;
  while ((m = colRe.exec(macroSrc)) !== null) {
    const cname = m[1].trim().toLowerCase();
    const model = m[2].trim();
    const val = m[3].trim();
    if (model.toUpperCase() === 'HTML' && /^[0-9a-fA-F]{6}$/.test(val)) {
      customColors[cname] = `#${val.toUpperCase()}`;
    } else if (model === 'RGB') {
      const parts = val.split(',').map((p) => Math.max(0, Math.min(255, parseInt(p.trim(), 10) || 0)));
      if (parts.length === 3) {
        customColors[cname] =
          '#' + parts.map((n) => n.toString(16).padStart(2, '0').toUpperCase()).join('');
      }
    } else if (model === 'rgb') {
      const parts = val.split(',').map((p) => Math.max(0, Math.min(1, parseFloat(p.trim()) || 0)));
      if (parts.length === 3) {
        customColors[cname] =
          '#' +
          parts
            .map((n) => Math.round(n * 255).toString(16).padStart(2, '0').toUpperCase())
            .join('');
      }
    }
  }

  // Safely strip preamble-only commands with balanced braces so nested braces never leak
  const preambleThreeArgCmds = /\\(?:definecolor|DeclareMathAlphabet|SetMathAlphabet)(?![a-zA-Z])/;
  const preambleTwoArgCmds =
    /\\(?:setlength|addtolength|setcounter|addtocounter|numberwithin|DeclareMathOperator\*?|renewcommand\*?|newcommand\*?|providecommand\*?|DeclareRobustCommand\*?|colorlet|fontsize|lstdefinestyle|DeclareTColorBox|newtcbox)(?![a-zA-Z])/;
  const preambleOneArgCmds =
    /\\(?:documentclass|usepackage|RequirePackage|geometry|hypersetup|lstset|tikzset|pgfplotsset|tcbset|tcbuselibrary|setlist|pagestyle|thispagestyle|pagenumbering|bibliographystyle|bibliography|addbibresource|linespread|theoremstyle|newtheoremstyle|graphicspath|DeclareUnicodeCharacter|sisetup|captionsetup|AtBeginDocument|fancyhf|fancyhead|fancyfoot|rhead|lhead|chead|rfoot|lfoot|cfoot|setmainfont|setsansfont|setmonofont|newfontfamily|selectlanguage|usetikzlibrary|usepgfplotslibrary|tkzSetUpPoint|tkzSetUpLine|tkzSetUpLabel|tkzSetUpStyle|tkzTabSetup|titleformat|titlespacing|newtheorem\*?|input|include|allowdisplaybreaks|qedsymbol)(?![a-zA-Z])/;
  const preambleZeroArgCmds =
    /\\(?:onehalfspacing|doublespacing|singlespacing|frenchspacing|makeatletter|makeatother|tableofcontents|listoffigures|listoftables|printbibliography|phantomsection|frontmatter|mainmatter|backmatter|sloppy|fussy|raggedbottom|flushbottom|selectfont)(?![a-zA-Z])\s*/g;

  body = stripBalancedCommand(body, /\\(?:re)?newenvironment\*?(?![a-zA-Z])/, 3, true);
  body = stripBalancedCommand(body, /\\(?:g|e|x)?def(?![a-zA-Z])/, 2, false, true);
  body = stripBalancedCommand(body, preambleThreeArgCmds, 3, true);
  body = stripBalancedCommand(body, preambleTwoArgCmds, 2, true);
  body = stripBalancedCommand(body, preambleOneArgCmds, 1, true);
  body = body.replace(preambleZeroArgCmds, '');

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
      body = body.slice(0, match.index) + `${beg}\n${inner}\n${end}` + body.slice(endIdx + closeLen);
    }
  }

  // Expand collected macros (up to 4 passes for nested macros, supporting 0..9 args + optional [default])
  const builtinCmdNames = new Set([
    'textbf', 'textit', 'emph', 'underline', 'textrm', 'textsf', 'texttt', 'textsc',
    'textsl', 'textnormal', 'textup', 'sout', 'uline', 'text', 'mbox', 'hbox', 'makebox',
    'framebox', 'parbox', 'fbox', 'textcolor', 'color', 'section', 'subsection',
    'subsubsection', 'paragraph', 'title', 'author', 'date', 'caption', 'label',
    'ref', 'eqref', 'cite', 'frac', 'dfrac', 'tfrac', 'sqrt', 'begin', 'end', 'tikz',
  ]);

  for (let pass = 0; pass < 4; pass++) {
    let changedInPass = false;
    for (const macro of macros) {
      if (builtinCmdNames.has(macro.name)) continue;
      if (macro.argCount === 0) {
        const re = new RegExp(`\\\\${macro.name}(?![a-zA-Z])`, 'g');
        const endsWithLetter = /[a-zA-Z]$/.test(macro.body);
        const nextBody = body.replace(re, (_full, offset: number) => {
          changedInPass = true;
          const nextCh = body[offset + 1 + macro.name.length] ?? '';
          return endsWithLetter && /[a-zA-Z0-9]/.test(nextCh) ? `${macro.body} ` : macro.body;
        });
        body = nextBody;
      } else {
        const re =
          macro.argCount === 1 && macro.defaultOpt !== undefined
            ? new RegExp(`\\\\${macro.name}(?![a-zA-Z])`)
            : new RegExp(`\\\\${macro.name}(?![a-zA-Z])\\s*(?:\\[|\\{)`);
        let safety = 0;
        let match: RegExpExecArray | null;
        while ((match = re.exec(body)) !== null && safety < 300) {
          safety++;
          let pos = match.index + 1 + macro.name.length;
          const postCmdSpace = skipSpaces(body, pos);
          const args: string[] = [];
          let neededBraces = macro.argCount;

          if (macro.defaultOpt !== undefined) {
            if (body[postCmdSpace] === '[') {
              const optBr = readBalancedBrackets(body, postCmdSpace);
              if (optBr) {
                args.push(optBr.content);
                pos = optBr.endIdx + 1;
              } else {
                args.push(macro.defaultOpt);
              }
            } else {
              args.push(macro.defaultOpt);
            }
            neededBraces = macro.argCount - 1;
          } else {
            pos = postCmdSpace;
          }

          if (neededBraces > 0) {
            const extracted = extractBalancedMacroArgs(body, pos, neededBraces);
            if (!extracted) break;
            args.push(...extracted.args);
            pos = extracted.endIdx;
          }

          let expanded = macro.body;
          args.forEach((argVal, idx) => {
            expanded = expanded.replace(new RegExp(`#${idx + 1}`, 'g'), () => argVal);
          });
          body = body.slice(0, match.index) + expanded + body.slice(pos);
          changedInPass = true;
        }
      }
    }
    if (!changedInPass) break;
  }

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

  // Break mid-line \noindent (e.g., "Chọn B.\noindent\textbf{Câu 5:}") onto a new line, then strip remaining \noindent
  body = body.replace(/([^\s\n{[\\%])\s*\\noindent(?![a-zA-Z])\s*/g, '$1\n');
  body = body.replace(/\\noindent(?![a-zA-Z])\s*/g, '');

  const isFullLatexDoc =
    hasDocBegin ||
    Boolean(title || author) ||
    /\\(?:section|subsection|paragraph|maketitle|makebox|dotfill|tikz|immini|begin\{(?:enumerate|itemize|description|tasks|table|tabular|tabularx|longtable|figure|tikzpicture|pgfpicture|picture|abstract|verbatim|lstlisting|tcolorbox|ex|bt|vd|theorem|lemma|definition|proposition|corollary|proof|center|align|subequations|thebibliography))/.test(
      normalized
    ) ||
    Object.keys(customTheorems).some((env) => normalized.includes(`\\begin{${env}}`));

  return {
    body,
    title,
    author,
    date,
    isFullLatexDoc,
    isVietnamese,
    customTheorems,
    customColors,
  };
}

function normalizeMathContent(latex: string): string {
  let s = latex.trim();
  const eqMatch = s.match(/^\\begin\{(equation\*?|displaymath)\}([\s\S]*)\\end\{\1\}$/);
  if (eqMatch) {
    s = eqMatch[2].trim();
  }
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
      const rest = text.slice(i);
      const cmdMatch = rest.match(/^\\([a-zA-Z]+)\*?/);
      if (cmdMatch) {
        const cmd = cmdMatch[1];
        if (
          cmd === 'textbf' ||
          cmd === 'textit' ||
          cmd === 'emph' ||
          cmd === 'underline' ||
          cmd === 'textcolor'
        ) {
          i++;
          continue;
        }
        if (BARE_LATEX_CMD_RE.test(`\\${cmd}`)) {
          let end = i + cmdMatch[0].length;
          let progressed = true;
          while (progressed && end < text.length) {
            progressed = false;
            while (end < text.length && (text[end] === ' ' || text[end] === '\t')) {
              const nextChar = text[end + 1];
              if (nextChar === '{' || nextChar === '[' || nextChar === '^' || nextChar === '_') {
                end++;
              } else {
                break;
              }
            }
            if (text[end] === '[') {
              const closeBr = text.indexOf(']', end + 1);
              if (closeBr !== -1) {
                end = closeBr + 1;
                progressed = true;
                continue;
              }
            }
            if (text[end] === '{') {
              const br = readBalancedBraces(text, end);
              if (br) {
                end = br.endIdx + 1;
                progressed = true;
                continue;
              }
            }
            if (text[end] === '^' || text[end] === '_') {
              end++;
              if (text[end] === '{') {
                const br = readBalancedBraces(text, end);
                if (br) end = br.endIdx + 1;
              } else if (end < text.length) {
                end++;
              }
              progressed = true;
            }
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
    .replace(/\\[,;:! ]/g, ' ')
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
    ...(style.font_size_pt ? { font_size_pt: style.font_size_pt } : {}),
    ...(style.color ? { color: style.color } : {}),
  };
}

function makeMathSegment(content: string, style: InlineStyle): InlineSegment {
  return {
    type: 'math',
    content: normalizeMathContent(content),
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
          out.push(makeMathSegment(part.content, currentStyle));
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
        if (inner) out.push(makeMathSegment(inner, currentStyle));
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
        if (inner) out.push(makeMathSegment(inner, currentStyle));
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
        if (inner) out.push(makeMathSegment(inner, currentStyle));
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
        if (inner) out.push(makeMathSegment(inner, currentStyle));
        i = closeIdx + 1;
        continue;
      }
    }

    // Group { \bf ... }, { \it ... }, { \color{red} ... }, { \Large ... }, or plain {...}
    if (text[i] === '{') {
      const br = readBalancedBraces(text, i);
      if (br) {
        const innerTrimmed = br.content.trimStart();
        const switchMatch = innerTrimmed.match(
          /^\\(bfseries|bf|itshape|it|em|slshape|sl|ttfamily|tt|scshape|sc|sffamily|rmfamily|tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge)(?![a-zA-Z])\s*/
        );
        const colorSwitchMatch = innerTrimmed.match(/^\\color\{([^}]+)\}\s*/);
        if (switchMatch || colorSwitchMatch) {
          flushText();
          const groupStyle: InlineStyle = { ...currentStyle };
          let bodyStr = innerTrimmed;
          if (switchMatch) {
            const sw = switchMatch[1];
            bodyStr = innerTrimmed.slice(switchMatch[0].length);
            if (sw === 'bf' || sw === 'bfseries') groupStyle.bold = true;
            else if (sw === 'it' || sw === 'itshape' || sw === 'em' || sw === 'sl' || sw === 'slshape') {
              groupStyle.italic = true;
            } else if (FONT_SIZE_PT_MAP[sw]) {
              groupStyle.font_size_pt = FONT_SIZE_PT_MAP[sw];
            }
          } else if (colorSwitchMatch) {
            bodyStr = innerTrimmed.slice(colorSwitchMatch[0].length);
            const hex = resolveLatexColor(colorSwitchMatch[1], ctx?.customColors);
            if (hex) groupStyle.color = hex;
          }
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

      // \textcolor{color}{content} or \colorbox{color}{content}
      const tcMatch = rest.match(/^\\(?:textcolor|colorbox)\s*\{([^}]+)\}\s*\{/);
      if (tcMatch) {
        const braceStart = i + tcMatch[0].length - 1;
        const br = readBalancedBraces(text, braceStart);
        if (br) {
          flushText();
          const hex = rest.startsWith('\\textcolor')
            ? resolveLatexColor(tcMatch[1], ctx?.customColors)
            : undefined;
          out.push(
            ...parseInlineSegmentText(
              br.content,
              { ...currentStyle, ...(hex ? { color: hex } : {}) },
              mode,
              ctx
            )
          );
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
      const boxCmdMatch = rest.match(/^\\(makebox|framebox)\*?(?:\s*\[[^\]]*\])*\s*\{/);
      if (boxCmdMatch) {
        const braceStart = i + boxCmdMatch[0].length - 1;
        const br = readBalancedBraces(text, braceStart);
        if (br) {
          flushText();
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
            out.push(makeMathSegment(`\\mathrm{${br.content}}`, currentStyle));
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

      // \textbf{}, \textit{}, \emph{}, \underline{}, \fbox{}, \boxed{}, \textrm{}, \textsf{}, \texttt{}, \textsc{}, \textsl{}, \textnormal{}, \textup{}, \sout{}, \text{}, \mbox{}, \thead{}, \makecell{}, \textsuperscript{}, \textsubscript{}, \centerline{}, \leftline{}, \rightline{}, \uline{}, \cancel{}
      const styleMatch = rest.match(
        /^\\(textbf|textit|emph|underline|fbox|boxed|textrm|textsf|texttt|textsc|textsl|textnormal|textup|sout|uline|uwave|st|cancel|bcancel|xcancel|ul|text|mbox|hbox|thead|makecell|textsuperscript|textsubscript|centerline|leftline|rightline)(?:\[[^\]]*\])?\s*\{/
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
          const nextStyle: InlineStyle = {
            ...currentStyle,
            bold: currentStyle.bold || cmd === 'textbf' || cmd === 'thead',
            italic:
              currentStyle.italic ||
              cmd === 'textit' ||
              cmd === 'emph' ||
              cmd === 'textsl',
            underline: currentStyle.underline || cmd === 'underline' || cmd === 'ul' || cmd === 'uline',
            ...(cmd === 'textsuperscript' || cmd === 'textsubscript'
              ? { font_size_pt: Math.max(8, (currentStyle.font_size_pt ?? 12) - 3) }
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

      // Inline switch without braces: \bfseries, \itshape, \Large, \color{...}
      const inlineSwMatch = rest.match(
        /^\\(bfseries|bf|itshape|it|em|slshape|sl|ttfamily|tt|scshape|sc|sffamily|rmfamily|mdseries|upshape|normalfont|selectfont|tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge)(?![a-zA-Z])\s*/
      );
      if (inlineSwMatch) {
        flushText();
        const sw = inlineSwMatch[1];
        if (sw === 'bf' || sw === 'bfseries') currentStyle = { ...currentStyle, bold: true };
        else if (sw === 'it' || sw === 'itshape' || sw === 'em' || sw === 'sl' || sw === 'slshape') {
          currentStyle = { ...currentStyle, italic: true };
        } else if (sw === 'normalfont' || sw === 'mdseries' || sw === 'upshape') {
          currentStyle = { ...baseStyle };
        } else if (FONT_SIZE_PT_MAP[sw]) {
          currentStyle = { ...currentStyle, font_size_pt: FONT_SIZE_PT_MAP[sw] };
        }
        i += inlineSwMatch[0].length;
        continue;
      }

      const inlineColorMatch = rest.match(/^\\color\{([^}]+)\}\s*/);
      if (inlineColorMatch) {
        flushText();
        const hex = resolveLatexColor(inlineColorMatch[1], ctx?.customColors);
        if (hex) currentStyle = { ...currentStyle, color: hex };
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

      // Ignore benign layout/spacing macros in inline text
      const noopMatch = rest.match(
        /^\\(?:noindent|indent|centering|raggedright|raggedleft|hspace\*?\{[^}]*\}|vspace\*?\{[^}]*\}|phantom\*?\{[^}]*\}|hphantom\{[^}]*\}|vphantom\{[^}]*\}|fontsize\{[^}]*\}\{[^}]*\}|hfill|vfill|smallskip|medskip|bigskip|par(?![a-zA-Z])|index\{[^}]*\}|phantomsection|protect|relax|ignorespaces|strut|leavevmode|null)\s*/
      );
      if (noopMatch) {
        if (noopMatch[0].startsWith('\\hfill')) {
          flushText();
          out.push({ type: 'text', content: '    ', tab_before: true });
        }
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
    /^\\(?:frac|dfrac|tfrac|sqrt|int|iint|sum|prod|lim|left|vec|overrightarrow|widehat|overline)(?![a-zA-Z])/.test(
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
          const m = normalizedLine.slice(i).match(/^([A-D]\.|[a-d]\))(?:\s+|(?=\$))/);
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
  ctx?: ParserContext
): DocumentBlock | null {
  const expandedSpec = expandColumnSpec(colSpecRaw);
  const hasVertBorders = expandedSpec.includes('|');
  const colAligns: BlockAlignment[] = [];
  for (let i = 0; i < expandedSpec.length; i++) {
    const ch = expandedSpec[i];
    if (ch === 'l') colAligns.push('left');
    else if (ch === 'c') colAligns.push('center');
    else if (ch === 'r' || ch === 'S') colAligns.push(ch === 'S' ? 'right' : 'right');
    else if (ch === 'p' || ch === 'm' || ch === 'b' || ch === 'X') {
      colAligns.push('left');
      if (expandedSpec[i + 1] === '{') {
        const br = readBalancedBraces(expandedSpec, i + 1);
        if (br) i = br.endIdx;
      }
    } else if ((ch === '>' || ch === '<' || ch === '@' || ch === '!') && expandedSpec[i + 1] === '{') {
      const br = readBalancedBraces(expandedSpec, i + 1);
      if (br) i = br.endIdx;
    }
  }

  const hasHline = /\\(?:hline|toprule|midrule|bottomrule|cline|cmidrule|specialrule)/.test(bodyRaw);
  const hasMidrule = /\\midrule\b/.test(bodyRaw);

  // Strip longtable header/footer markers and \caption inside longtable
  let cleanedBody = bodyRaw
    .replace(/\\(?:endfirsthead|endhead|endfoot|endlastfoot)(?![a-zA-Z])/g, '')
    .replace(/\\addlinespace(?:\[[^\]]*\])?/g, '')
    .replace(/\\specialrule\{[^}]*\}\{[^}]*\}\{[^}]*\}/g, '');
  cleanedBody = stripBalancedCommand(cleanedBody, /\\caption\*?(?![a-zA-Z])/, 1, true);

  const rawRows = splitUnescaped(cleanedBody, '\\\\');
  const tableRows: TableCellData[][] = [];
  const rowHadRuleAfter: boolean[] = [];

  for (let rIdx = 0; rIdx < rawRows.length; rIdx++) {
    const rawRow = rawRows[rIdx].replace(/^\*?\s*\[[^\]]*\]\s*/, '');
    const cleanedRow = rawRow
      .replace(/\\(?:hline|toprule|midrule|bottomrule)(?![a-zA-Z])(?:\[[^\]]*\])?/g, '')
      .replace(/\\(?:Xhline|Xcline|cline)\{[^}]*\}/g, '')
      .replace(/\\cmidrule(?:\([^)]*\))?\{[^}]*\}/g, '')
      .replace(/\\rowcolor(?:\[[^\]]*\])?\{[^}]*\}/g, '')
      .trim();

    if (!cleanedRow) {
      if (/\\(?:midrule|hline)\b/.test(rawRow) && rowHadRuleAfter.length > 0) {
        rowHadRuleAfter[rowHadRuleAfter.length - 1] = true;
      }
      continue;
    }

    const nextRow = (rawRows[rIdx + 1] ?? '').replace(/^\*?\s*\[[^\]]*\]\s*/, '');
    const nextStartsWithRule = /^\s*\\(?:midrule|hline)\b/.test(nextRow);

    const rawCells = splitUnescaped(cleanedRow, '&');
    const rowCells: TableCellData[] = [];
    let colIdx = 0;

    for (const rawCell of rawCells) {
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
        rowCells.push({
          segments: parseInlineSegmentText(content, {}, mode, ctx),
          alignment: mcAlign,
          col_span: span,
          is_header: false,
        });
        colIdx += span;
      } else {
        const align = colAligns[colIdx] ?? 'left';
        rowCells.push({
          segments: parseInlineSegmentText(cellTrimmed, {}, mode, ctx),
          alignment: align,
          is_header: false,
        });
        colIdx++;
      }
    }

    if (rowCells.length > 0) {
      tableRows.push(rowCells);
      rowHadRuleAfter.push(nextStartsWithRule);
    }
  }

  if (tableRows.length === 0) return null;

  // Mark header row if booktabs \midrule or \hline separates row 0 from data rows
  if (tableRows.length > 1 && (hasMidrule || rowHadRuleAfter[0])) {
    tableRows[0] = tableRows[0].map((c) => ({ ...c, is_header: true }));
  }

  return {
    block_type: 'table',
    alignment: 'center',
    table_borderless: !(hasVertBorders || hasHline),
    font_size_pt: 11,
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
        const itemM = rest.match(/^\\item(?![a-zA-Z])/);
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
  while (s !== prev && guard < 8) {
    prev = s;
    guard++;
    s = s
      .replace(/^\\(?:noindent|indent|centering|raggedright|raggedleft|par)(?![a-zA-Z])\s*/, '')
      .replace(/^\{\s*\\(?:bf|bfseries|it|itshape|em|large|Large|LARGE|normalsize)\b\s*/, '')
      .replace(/^\\(?:textbf|textit|emph|underline|text|mbox|centerline)\s*\{/, '')
      .replace(/^\\textcolor\s*\{[^}]*\}\s*\{/, '')
      .trim();
  }
  return s;
}

function isLineBreakBoundary(prevLine: string, nextLine: string): boolean {
  if (!prevLine || !nextLine) return true;
  if (/\\\\(?:\[[^\]]*\])?\s*$/.test(prevLine) || /\\newline\s*$/.test(prevLine)) return true;
  if (
    /^\\(?:section|subsection|subsubsection|paragraph|subparagraph|chapter|part|item|bibitem|begin|end|hline|hrule|newpage|clearpage|cleardoublepage|pagebreak|maketitle|appendix|tableofcontents|listoffigures|listoftables|caption|includegraphics|makebox|framebox|parbox)/.test(
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
  if (/^([A-D]\.|[a-d]\))\s+/.test(cleanNext)) return true;
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
    /^\\(?:section|subsection|subsubsection|chapter|part|begin\{(?:ex|bt|vd|theorem|lemma|definition|proposition|corollary|proof|figure|table|enumerate|itemize)\})/.test(
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
  mode: LatexPasteMode
): DocumentBlock[] {
  const blocks: DocumentBlock[] = [];
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
          font_size_pt: 12,
          line_spacing: 1.15,
          segments: [
            { type: 'text', content: 'Đáp án: ', bold: true, color: '#B91C1C' },
            ...parseInlineSegmentText(ansRaw, { bold: true, color: '#B91C1C' }, mode, ctx),
          ],
        };
      }
    }
  }

  // Extract \choice[cols]{A}{B}{C}{D}, \choiceTF[cols]{A}{B}{C}{D}, \motcot{...}, \haicot{...}, \boncot{...}
  const chMatch = /\\(choice(?:TF)?|motcot|haicot|boncot)\s*(?:\[\s*(\d+)\s*\])?\s*\{/.exec(remaining);
  if (chMatch) {
    const cmdName = chMatch[1];
    const isTF = cmdName === 'choiceTF';
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
      const colHint = chMatch[2]
        ? parseInt(chMatch[2], 10)
        : isTF || cmdName === 'motcot'
        ? 1
        : cmdName === 'haicot'
        ? 2
        : 4;
      const cells: TableCellData[] = extracted.args.map((arg, idx) => ({
        segments: [
          { type: 'text', content: `${labels[idx]} `, bold: true },
          ...parseInlineSegmentText(arg.replace(/\\True\b/g, '').trim(), {}, mode, ctx),
        ],
        alignment: 'left',
        width_pct: colHint === 1 ? 100 : colHint === 2 ? 50 : 25,
      }));
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
        font_size_pt: 12,
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
    indentLeftPt: 0,
  });

  if (stemPages.length > 0 && stemPages[0].length > 0) {
    const firstBlk = stemPages[0][0];
    if (firstBlk.block_type === 'paragraph' && firstBlk.segments) {
      firstBlk.segments = [
        { type: 'text', content: labelPrefix, bold: true },
        ...firstBlk.segments,
      ];
    } else {
      blocks.push({
        block_type: 'paragraph',
        alignment: 'left',
        font_size_pt: 12,
        segments: [{ type: 'text', content: labelPrefix.trim(), bold: true }],
      });
    }
    blocks.push(...stemPages.flat());
  } else {
    blocks.push({
      block_type: 'paragraph',
      alignment: 'left',
      font_size_pt: 12,
      segments: [{ type: 'text', content: labelPrefix.trim(), bold: true }],
    });
  }

  if (choiceBlock) blocks.push(choiceBlock);
  if (shortAnsBlock) blocks.push(shortAnsBlock);

  if (loigiaiBody) {
    const solPages = parseBodyBlocks(loigiaiBody, ctx, mode, {
      defaultAlign: 'justify',
      isFullLatexDoc: true,
      listDepth: 0,
      indentLeftPt: 0,
    });
    const flatSol = solPages.flat();
    if (flatSol.length > 0 && flatSol[0].block_type === 'paragraph' && flatSol[0].segments) {
      flatSol[0].segments = [
        { type: 'text', content: 'Lời giải. ', bold: true, italic: true },
        ...flatSol[0].segments,
      ];
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

function formatEnumItemBullet(
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
  if (enumLabelOpt) {
    if (/\\alph\*/.test(enumLabelOpt)) {
      const ch = String.fromCharCode(97 + (itemIdx % 26));
      return `${enumLabelOpt.replace(/\\alph\*/, ch).trim()} `;
    }
    if (/\\Alph\*/.test(enumLabelOpt)) {
      const ch = String.fromCharCode(65 + (itemIdx % 26));
      return `${enumLabelOpt.replace(/\\Alph\*/, ch).trim()} `;
    }
    if (/\\roman\*/.test(enumLabelOpt)) {
      const romans = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];
      const r = romans[itemIdx] ?? String(itemIdx + 1);
      return `${enumLabelOpt.replace(/\\roman\*/, r).trim()} `;
    }
    if (/\\arabic\*/.test(enumLabelOpt)) {
      return `${enumLabelOpt.replace(/\\arabic\*/, String(itemIdx + 1)).trim()} `;
    }
  }
  return nextDepth === 1
    ? `${itemIdx + 1}. `
    : `(${String.fromCharCode(97 + (itemIdx % 26))}) `;
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
  const pages: DocumentBlock[][] = [[]];
  const pushBlock = (blk: DocumentBlock) => {
    pages[pages.length - 1].push(blk);
  };
  const pushPageBreak = () => {
    if (pages[pages.length - 1].length > 0) {
      pages.push([]);
    }
  };

  let textStart = 0;
  let i = 0;

  const flushTextSlice = (endIdx: number) => {
    if (endIdx <= textStart) return;
    const rawSlice = src.slice(textStart, endIdx);
    const mergedParagraphs = mergeWrappedProseLines(rawSlice, opts.isFullLatexDoc);

    let pIdx = 0;
    while (pIdx < mergedParagraphs.length) {
      const pLine = mergedParagraphs[pIdx];

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
          const segs = applyQuestionLabelBold(parseInlineSegmentText(st, {}, mode, ctx));
          if (segs.length > 0) {
            pushBlock({
              block_type: 'paragraph',
              alignment: opts.defaultAlign === 'left' && st.length > 55 ? 'justify' : opts.defaultAlign,
              font_size_pt: 12,
              line_spacing: 1.18,
              indent_left_pt: opts.indentLeftPt > 0 ? opts.indentLeftPt : undefined,
              segments: segs,
            });
          }
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
        pIdx++;
        continue;
      }

      if (isPureBareLatexLine(pLine)) {
        pushBlock({
          block_type: 'equation',
          alignment: 'center',
          latex: normalizeMathContent(pLine),
          font_size_pt: 12,
        });
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
            font_size_pt: 12,
            line_spacing: 1.15,
            indent_left_pt: opts.indentLeftPt > 0 ? opts.indentLeftPt : undefined,
            table_rows: combinedRows,
          });
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
        pIdx++;
        continue;
      }

      if (
        pIdx + 3 < mergedParagraphs.length &&
        /^A[\.\)]\s+/.test(mergedParagraphs[pIdx]) &&
        /^B[\.\)]\s+/.test(mergedParagraphs[pIdx + 1]) &&
        /^C[\.\)]\s+/.test(mergedParagraphs[pIdx + 2]) &&
        /^D[\.\)]\s+/.test(mergedParagraphs[pIdx + 3])
      ) {
        const cells: TableCellData[] = [0, 1, 2, 3].map((offset) => {
          const optText = mergedParagraphs[pIdx + offset];
          const lm = optText.match(/^([A-D][\.\)])\s*([\s\S]*)$/);
          const segs: InlineSegment[] = lm
            ? [
                { type: 'text', content: `${lm[1]} `, bold: true },
                ...parseInlineSegmentText(lm[2], {}, mode, ctx),
              ]
            : parseInlineSegmentText(optText, {}, mode, ctx);
          return {
            segments: segs,
            alignment: 'left',
            width_pct: 25,
          };
        });
        pushBlock({
          block_type: 'table',
          alignment: 'left',
          table_borderless: true,
          is_choice_block: true,
          font_size_pt: 12,
          line_spacing: 1.15,
          indent_left_pt: opts.indentLeftPt > 0 ? opts.indentLeftPt : undefined,
          table_rows: [cells],
        });
        pIdx += 4;
        continue;
      }

      const segs = applyQuestionLabelBold(parseInlineSegmentText(pLine, {}, mode, ctx));
      if (segs.length > 0) {
        const plainLen = segs.reduce((s, item) => s + item.content.length, 0);
        const align: BlockAlignment =
          opts.defaultAlign !== 'left'
            ? opts.defaultAlign
            : opts.isFullLatexDoc && plainLen > 45
            ? 'justify'
            : 'left';
        pushBlock({
          block_type: 'paragraph',
          alignment: align,
          font_size_pt: 12,
          line_spacing: 1.18,
          indent_left_pt: opts.indentLeftPt > 0 ? opts.indentLeftPt : undefined,
          segments: segs,
        });
      }
      pIdx++;
    }
  };

  const hasBlockContainerInside = (snippet: string): boolean =>
    /\\begin\{(?:tikzpicture|pgfpicture|picture|tabular|tabular\*|tabularx|longtable|enumerate|itemize|description|figure|table|verbatim|lstlisting|minted|axis|ex|bt|vd|center|flushleft|flushright|minipage|tcolorbox)\}|\\(?:section|subsection|subsubsection|chapter|part|par(?![a-zA-Z]))|\n\s*\n/.test(
      snippet
    );

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
              latex: normalizeMathContent(inner),
              font_size_pt: 12,
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
            latex: normalizeMathContent(inner),
            font_size_pt: 12,
          });
        }
        i = closeIdx + 2;
        textStart = i;
        continue;
      }
    }

    if (src[i] === '\\') {
      const rest = src.slice(i);

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
      if (standaloneLabelMatch && isOnlySpacesBeforeOnLine(src, i)) {
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

      // Keep inline boxes/styling commands (\makebox, \framebox, \textbf, etc.) intact when they contain no block containers
      const inlineBoxCmdM = rest.match(
        /^\\(?:makebox|framebox)\*?(?:\s*\[[^\]]*\])*\s*\{|^\\(?:textbf|textit|emph|underline|fbox|boxed|textrm|textsf|texttt|textsc|textsl|textnormal|textup|sout|uline|text|mbox|hbox|centerline|leftline|rightline)(?:\s*\[[^\]]*\])?\s*\{|^\\(?:parbox|raisebox|scalebox|textcolor|colorbox)(?:\s*\[[^\]]*\])*\s*\{[^}]*\}(?:\s*\[[^\]]*\])*\s*\{|^\\resizebox\*?\s*\{[^}]*\}\s*\{[^}]*\}\s*\{/
      );
      if (inlineBoxCmdM) {
        const br = readBalancedBraces(src, i + inlineBoxCmdM[0].length - 1);
        if (br && !hasBlockContainerInside(br.content)) {
          i = br.endIdx + 1;
          continue;
        }
      }

      // \tikz[opts]{...}
      const tikzInlineMatch = rest.match(/^\\tikz(?:\s*\[([^\]]*)\])?\s*\{/);
      if (tikzInlineMatch) {
        const braceIdx = i + tikzInlineMatch[0].length - 1;
        const br = readBalancedBraces(src, braceIdx);
        if (br) {
          flushTextSlice(i);
          const tikzBody = tikzInlineMatch[1]
            ? `[${tikzInlineMatch[1]}]\n${br.content}`
            : br.content;
          const rendered = renderLatexPictureToSvgDataUrl('tikzpicture', tikzBody, ctx.customColors);
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

      // \immini[opts]{text}{figure} (popular in Vietnamese ex_test exams)
      const imminiMatch = rest.match(/^\\immini(?:\s*\[[^\]]*\])?\s*\{/);
      if (imminiMatch) {
        const extracted = extractBalancedMacroArgs(src, i + imminiMatch[0].length - 1, 2);
        if (extracted) {
          flushTextSlice(i);
          const leftPages = parseBodyBlocks(extracted.args[0], ctx, mode, opts);
          const rightPages = parseBodyBlocks(extracted.args[1], ctx, mode, {
            ...opts,
            defaultAlign: 'center',
          });
          const leftBlocks = leftPages.flat();
          const rightBlocks = rightPages.flat();
          if (
            leftBlocks.length === 1 &&
            rightBlocks.length === 1 &&
            rightBlocks[0].block_type === 'figure'
          ) {
            // Preserve side-by-side layout cleanly via borderless 2-column band or sequential blocks
            leftBlocks.forEach(pushBlock);
            rightBlocks.forEach(pushBlock);
          } else {
            leftPages.forEach((pg, pIdx) => {
              if (pIdx > 0) pushPageBreak();
              pg.forEach(pushBlock);
            });
            rightPages.forEach((pg) => pg.forEach(pushBlock));
          }
          i = extracted.endIdx;
          textStart = i;
          continue;
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
            { bold: true, font_size_pt: sizePt },
            mode,
            ctx
          );
          if (prefix) {
            segs.unshift({ type: 'text', content: prefix, bold: true, font_size_pt: sizePt });
          }
          pushBlock({
            block_type: 'heading',
            alignment: kind === 'part' || kind === 'chapter' ? 'center' : 'left',
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
              latex: normalizeMathContent(fullMath),
              font_size_pt: 12,
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
            const tblBlock = parseTabularEnvironment(colSpec, envRawBody.slice(pos), mode, ctx);
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
            let pos = skipSpaces(envRawBody, 0);
            while (envRawBody[pos] === '[') {
              const optBr = readBalancedBrackets(envRawBody, pos);
              if (!optBr) break;
              pos = skipSpaces(envRawBody, optBr.endIdx + 1);
            }
            if (envRawBody[pos] === '{') {
              const widthBr = readBalancedBraces(envRawBody, pos);
              if (widthBr) pos = widthBr.endIdx + 1;
            }
            const innerPages = parseBodyBlocks(envRawBody.slice(pos), ctx, mode, opts);
            innerPages.forEach((pg, pIdx) => {
              if (pIdx > 0) pushPageBreak();
              pg.forEach(pushBlock);
            });
            i = endIdx + closeToken.length;
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
            envName === 'quote' ||
            envName === 'quotation' ||
            envName === 'abstract' ||
            envName === 'tcolorbox' ||
            envName === 'framed' ||
            envName === 'mdframed' ||
            envName === 'shaded'
          ) {
            flushTextSlice(i);
            let boxBody = envRawBody.trimStart();
            if (envName === 'tcolorbox' && boxBody.startsWith('[')) {
              const optBr = readBalancedBrackets(boxBody, 0);
              if (optBr) {
                const titleM = optBr.content.match(/title\s*=\s*(?:\{([^}]*)\}|([^,\]]+))/);
                const boxTitle = (titleM?.[1] ?? titleM?.[2] ?? '').trim();
                if (boxTitle) {
                  pushBlock({
                    block_type: 'paragraph',
                    alignment: 'left',
                    font_size_pt: 12,
                    indent_left_pt: opts.indentLeftPt + 16,
                    segments: parseInlineSegmentText(boxTitle, { bold: true }, mode, ctx),
                  });
                }
                boxBody = boxBody.slice(optBr.endIdx + 1);
              }
            }
            if (envName === 'abstract') {
              pushBlock({
                block_type: 'heading',
                alignment: 'center',
                heading_level: 3,
                font_size_pt: 12,
                segments: [
                  {
                    type: 'text',
                    content: ctx.isVietnamese ? 'Tóm tắt' : 'Abstract',
                    bold: true,
                    font_size_pt: 12,
                  },
                ],
              });
            }
            const childPages = parseBodyBlocks(boxBody, ctx, mode, {
              ...opts,
              defaultAlign: 'justify',
              indentLeftPt: opts.indentLeftPt + 24,
            });
            childPages.forEach((pg, pIdx) => {
              if (pIdx > 0) pushPageBreak();
              pg.forEach(pushBlock);
            });
            i = endIdx + closeToken.length;
            textStart = i;
            continue;
          }

          if (envName === 'enumerate' || envName === 'itemize' || envName === 'description') {
            flushTextSlice(i);
            let listBody = envRawBody.trimStart();
            let enumLabelOpt: string | undefined;
            if (listBody.startsWith('[')) {
              const optBr = readBalancedBrackets(listBody, 0);
              if (optBr) {
                const rawOpt = optBr.content.trim();
                const lblM = rawOpt.match(/label\s*=\s*(?:\{([^}]*)\}|([^\s,\]]+))/);
                if (lblM) {
                  enumLabelOpt = (lblM[1] ?? lblM[2])?.trim();
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

            items.forEach((item, itemIdx) => {
              const bullet =
                envName === 'description'
                  ? item.customLabel
                    ? `${item.customLabel} `
                    : '• '
                  : formatEnumItemBullet(
                      enumLabelOpt,
                      envName,
                      nextDepth,
                      itemIdx,
                      item.customLabel
                    );

              const itemPages = parseBodyBlocks(item.content, ctx, mode, {
                ...opts,
                listDepth: nextDepth,
                indentLeftPt: listIndentPt,
              });
              const flat = itemPages.flat();
              if (flat.length > 0 && flat[0].block_type === 'paragraph' && flat[0].segments) {
                flat[0].first_line_indent_pt = -16;
                flat[0].segments = [
                  {
                    type: 'text',
                    content: bullet,
                    bold: envName === 'enumerate' || envName === 'description',
                  },
                  ...flat[0].segments,
                ];
              } else {
                pushBlock({
                  block_type: 'paragraph',
                  alignment: 'left',
                  font_size_pt: 12,
                  indent_left_pt: listIndentPt,
                  first_line_indent_pt: -16,
                  segments: [
                    {
                      type: 'text',
                      content: bullet,
                      bold: envName === 'enumerate' || envName === 'description',
                    },
                  ],
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
            const exBlocks = parseExEnvironment(envRawBody, envName, ctx, mode);
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
            const innerBlocks = parseBodyBlocks(mBody, ctx, mode, opts).flat();
            if (innerBlocks.length > 0) {
              const rowCells: TableCellData[] = [];
              const rows: TableCellData[][] = [];
              const pct = Math.round((100 / cols) * 10) / 10;
              innerBlocks.forEach((b) => {
                const segs =
                  b.segments ??
                  (b.block_type === 'equation' && b.latex
                    ? [{ type: 'math' as const, content: b.latex }]
                    : []);
                rowCells.push({
                  segments: segs,
                  alignment: 'left',
                  width_pct: pct,
                });
                if (rowCells.length === cols) {
                  rows.push([...rowCells]);
                  rowCells.length = 0;
                }
              });
              if (rowCells.length > 0) rows.push(rowCells);
              pushBlock({
                block_type: 'table',
                alignment: 'left',
                table_borderless: true,
                font_size_pt: 12,
                line_spacing: 1.15,
                table_rows: rows,
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
              ctx.customColors
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
            if (tBody.startsWith('[')) {
              const optBr = readBalancedBrackets(tBody, 0);
              if (optBr) tBody = tBody.slice(optBr.endIdx + 1).trimStart();
            }
            const colParenM = tBody.match(/^\((\d+)\)/);
            if (colParenM) {
              cols = Math.max(1, Math.min(4, parseInt(colParenM[1], 10) || 2));
              tBody = tBody.slice(colParenM[0].length);
            }
            const taskParts = tBody.split(/\\task\*?(?:\[[^\]]*\])?(?![a-zA-Z])\s*/).slice(1);
            if (taskParts.length > 0) {
              const rows: TableCellData[][] = [];
              let currentRow: TableCellData[] = [];
              const pct = Math.round((100 / cols) * 10) / 10;
              taskParts.forEach((tp, idx) => {
                const lbl = `${String.fromCharCode(97 + (idx % 26))}) `;
                currentRow.push({
                  segments: [
                    { type: 'text', content: lbl, bold: true },
                    ...parseInlineSegmentText(tp.trim(), {}, mode, ctx),
                  ],
                  alignment: 'left',
                  width_pct: pct,
                });
                if (currentRow.length === cols) {
                  rows.push(currentRow);
                  currentRow = [];
                }
              });
              if (currentRow.length > 0) rows.push(currentRow);
              pushBlock({
                block_type: 'table',
                alignment: 'left',
                table_borderless: true,
                font_size_pt: 12,
                line_spacing: 1.15,
                table_rows: rows,
              });
            }
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
            const innerPages = parseBodyBlocks(envRawBody, ctx, mode, opts);
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
  return pages.filter((p) => p.length > 0);
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
    const b0 = text.match(/^[ \t]*-(?=[ \t]+(?!\d|[+-−]|\\|∞)[^\s])/);
    if (b0) spans.push([0, b0[0].length]);
  }
  addMatchSpans(/\n([ \t]*-)(?=[ \t]+(?!\d|[+-−]|\\|∞)[^\s])/g, 1);
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
    const infMatch = chunk.match(/^([+-−]\s*)?∞(?![\p{L}\p{N}_])/u);
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
        /^(?:[+-−](?=\d))?\d+(?:[.,]\d+)?(?![\p{L}\p{N}_])(?:\s*[+-−]\s*\d+(?:[.,]\d+)?(?![\p{L}\p{N}_]))*/u
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

    if (seg.type === 'text' && seg.content) {
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
      prevTextTail = '';
      atBlockLineStart = false;
    }
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
    const split = splitTextPreservingInlineMath(content, style);
    if (tab_before && split.length > 0) {
      split[0] = { ...split[0], tab_before: true };
    }
    splitResult.push(...split);
  }
  return promoteNumbersAndSignsToMathSegments(splitResult, options);
}

export function normalizePagesInlineMath(pages: PageExtraction[]): PageExtraction[] {
  return pages.map((page) => ({
    ...page,
    blocks: page.blocks.map((blk) => ({
      ...blk,
      ...(blk.segments ? { segments: normalizeSegmentListInlineMath(blk.segments) } : {}),
      ...(blk.table_rows
        ? {
            table_rows: blk.table_rows.map((row) =>
              row.map((cell) => ({
                ...cell,
                segments:
                  normalizeSegmentListInlineMath(cell.segments, { isTableCell: true }) ?? [],
              }))
            ),
          }
        : {}),
    })),
  }));
}

export function parsePastedLatexToPages(
  rawText: string,
  mode: LatexPasteMode = 'auto'
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
  } = preprocessDocumentAndMacros(rawText);
  if (!body.trim()) return [];

  const baseInit = {
    isVietnamese,
    customTheorems,
    customColors,
  };
  const parseOpts: BlockParseOptions = {
    defaultAlign: 'left',
    isFullLatexDoc,
    listDepth: 0,
    indentLeftPt: 0,
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

  const pages: PageExtraction[] = pageBlockGroups.map((blocks, idx) => ({
    pageNumber: idx + 1,
    pageWidthPx: 1240,
    pageHeightPx: 1754,
    blocks,
  }));

  return normalizePagesInlineMath(pages);
}
