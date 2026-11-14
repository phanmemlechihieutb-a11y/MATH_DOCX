import type {
  BlockAlignment,
  DocumentBlock,
  InlineSegment,
  PageExtraction,
  TableCellData,
} from '../types/document';

export type LatexPasteMode = 'auto' | 'bare_latex';

const DISPLAY_MATH_ENVS = new Set([
  'equation',
  'equation*',
  'align',
  'align*',
  'aligned',
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
  /\\(?:frac|dfrac|tfrac|binom|dbinom|sqrt|int|iint|iiint|oint|sum|prod|lim|limsup|liminf|vec|overrightarrow|overleftarrow|widehat|widetilde|overline|underline|bar|tilde|hat|mathbb|mathcal|mathfrak|mathrm|text|sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|log|ln|lg|exp|max|min|sup|inf|alpha|beta|gamma|delta|Delta|epsilon|varepsilon|zeta|eta|theta|vartheta|lambda|mu|nu|xi|pi|rho|sigma|tau|phi|varphi|chi|psi|omega|Omega|Gamma|Theta|Lambda|Sigma|Phi|Psi|infty|partial|nabla|leq|geq|neq|approx|equiv|sim|simeq|cong|propto|pm|mp|times|cdot|div|ast|star|circ|bullet|in|notin|ni|subset|subseteq|supset|supseteq|cup|cap|setminus|emptyset|varnothing|forall|exists|nexists|neg|land|lor|Rightarrow|Leftrightarrow|Leftarrow|rightarrow|leftarrow|leftrightarrow|to|mapsto|implies|iff|begin\{)/;

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

interface ParserContext {
  sectionCount: number;
  subsectionCount: number;
  subsubsectionCount: number;
  counters: Record<string, number>;
}

function createParserContext(): ParserContext {
  return {
    sectionCount: 0,
    subsectionCount: 0,
    subsubsectionCount: 0,
    counters: {},
  };
}

function nextCounter(ctx: ParserContext, name: string): number {
  ctx.counters[name] = (ctx.counters[name] ?? 0) + 1;
  return ctx.counters[name];
}

function resolveLatexColor(raw: string): string | undefined {
  const c = raw.trim().toLowerCase();
  if (!c) return undefined;
  if (LATEX_COLOR_MAP[c]) return LATEX_COLOR_MAP[c];
  if (/^#?[0-9a-f]{6}$/i.test(c)) {
    return c.startsWith('#') ? c.toUpperCase() : `#${c.toUpperCase()}`;
  }
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
  const lines = raw.split('\n');
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
  return cleanedLines.join('\n');
}

interface ExtractedMacro {
  name: string;
  argCount: number;
  body: string;
}

function preprocessDocumentAndMacros(raw: string): {
  body: string;
  title?: string;
  author?: string;
  date?: string;
  isFullLatexDoc: boolean;
} {
  const normalized = stripLatexComments(raw.replace(/\r\n/g, '\n'));
  const hasDocBegin = /\\begin\{document\}/.test(normalized);

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
    const re = new RegExp(`\\\\${cmd}\\s*\\{`);
    const m = re.exec(combinedMetaSrc);
    if (!m) return undefined;
    const br = readBalancedBraces(combinedMetaSrc, m.index + m[0].length - 1);
    return br ? br.content.trim() : undefined;
  };

  const title = extractMetaCmd('title');
  const author = extractMetaCmd('author');
  const date = extractMetaCmd('date');

  // Remove \title{...}, \author{...}, \date{...} from body if they appeared inside body
  const stripMetaCmd = (src: string, cmd: string): string => {
    const re = new RegExp(`\\\\${cmd}\\s*\\{`);
    let out = src;
    let m: RegExpExecArray | null;
    while ((m = re.exec(out)) !== null) {
      const br = readBalancedBraces(out, m.index + m[0].length - 1);
      if (!br) break;
      out = out.slice(0, m.index) + out.slice(br.endIdx + 1);
    }
    return out;
  };
  body = stripMetaCmd(stripMetaCmd(stripMetaCmd(body, 'title'), 'author'), 'date');

  // Parse simple \newcommand{\name}[n]{body} or \renewcommand from preamble
  const macros: ExtractedMacro[] = [];
  if (preamble) {
    const cmdRe = /\\(?:re)?newcommand\*?\s*\{\\([a-zA-Z]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = cmdRe.exec(preamble)) !== null) {
      const name = m[1];
      let pos = skipSpaces(preamble, m.index + m[0].length);
      let argCount = 0;
      if (preamble[pos] === '[') {
        const brk = readBalancedBrackets(preamble, pos);
        if (brk) {
          argCount = Math.max(0, Math.min(2, parseInt(brk.content.trim(), 10) || 0));
          pos = skipSpaces(preamble, brk.endIdx + 1);
        }
      }
      if (preamble[pos] === '{') {
        const br = readBalancedBraces(preamble, pos);
        if (br) {
          macros.push({ name, argCount, body: br.content });
        }
      }
    }

    const opRe = /\\DeclareMathOperator\*?\s*\{\\([a-zA-Z]+)\}\s*\{/g;
    while ((m = opRe.exec(preamble)) !== null) {
      const name = m[1];
      const br = readBalancedBraces(preamble, m.index + m[0].length - 1);
      if (br) {
        macros.push({ name, argCount: 0, body: `\\operatorname{${br.content}}` });
      }
    }
  }

  // Strip stray preamble-only commands if pasted without \begin{document}
  body = body
    .replace(/\\documentclass(?:\[[^\]]*\])?\{[^}]*\}/g, '')
    .replace(/\\usepackage(?:\[[^\]]*\])?\{[^}]*\}/g, '')
    .replace(/\\geometry\{[^}]*\}/g, '')
    .replace(/\\(?:pagestyle|thispagestyle|bibliographystyle|hypersetup)\{[^}]*\}/g, '')
    .replace(/\\(?:setlength|addtolength|setcounter)\{[^}]*\}\{[^}]*\}/g, '');

  // Expand collected 0-arg and 1-arg macros
  for (const macro of macros) {
    if (macro.argCount === 0) {
      const re = new RegExp(`\\\\${macro.name}(?![a-zA-Z])`, 'g');
      body = body.replace(re, macro.body);
    } else if (macro.argCount === 1) {
      const re = new RegExp(`\\\\${macro.name}\\s*\\{`);
      let safety = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(body)) !== null && safety < 200) {
        safety++;
        const br = readBalancedBraces(body, match.index + match[0].length - 1);
        if (!br) break;
        const expanded = macro.body.replace(/#1/g, br.content);
        body = body.slice(0, match.index) + expanded + body.slice(br.endIdx + 1);
      }
    }
  }

  const isFullLatexDoc =
    hasDocBegin ||
    /\\(?:section|subsection|begin\{(?:enumerate|itemize|table|tabular|tabularx|longtable|ex|bt|vd|theorem|proof|center|align))/.test(
      normalized
    );

  return { body, title, author, date, isFullLatexDoc };
}

function normalizeMathContent(latex: string): string {
  let s = latex.trim();
  const eqMatch = s.match(/^\\begin\{(equation\*?|displaymath)\}([\s\S]*)\\end\{\1\}$/);
  if (eqMatch) {
    s = eqMatch[2].trim();
  }
  return s
    .replace(/\\label\{[^}]*\}/g, '')
    .replace(/\\nonumber\b/g, '')
    .replace(/\\begin\{(align\*?|flalign\*?|eqnarray\*?)\}/g, '\\begin{aligned}')
    .replace(/\\end\{(align\*?|flalign\*?|eqnarray\*?)\}/g, '\\end{aligned}')
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

function unescapeLatexTextProse(s: string): string {
  return s
    .replace(/\\textbackslash(?:\{\}|\s)?/g, '\\')
    .replace(/\\(?:ldots|dots)(?:\{\})?/g, '…')
    .replace(/\\textasciitilde(?:\{\})?/g, '~')
    .replace(/\\textasciicircum(?:\{\})?/g, '^')
    .replace(/\\([%&_#${}])/g, '$1')
    .replace(/\\(?:qquad)/g, '    ')
    .replace(/\\(?:quad|enspace)/g, '  ')
    .replace(/\\[,;:! ]/g, ' ')
    .replace(/~/g, ' ')
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/``/g, '“')
    .replace(/''/g, '”');
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

function parseInlineSegmentText(
  text: string,
  baseStyle: InlineStyle = {},
  mode: LatexPasteMode = 'auto'
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
          const cleanTxt = unescapeLatexTextProse(part.content);
          if (cleanTxt) out.push(makeTextSegment(cleanTxt, currentStyle));
        }
      }
    } else {
      const cleanTxt = unescapeLatexTextProse(textBuffer);
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

    // Group { \bf ... }, { \it ... }, { \color{red} ... }, { \Large ... }
    if (text[i] === '{') {
      const br = readBalancedBraces(text, i);
      if (br) {
        const innerTrimmed = br.content.trimStart();
        const switchMatch = innerTrimmed.match(
          /^\\(bfseries|bf|itshape|it|em|slshape|sl|tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge)(?![a-zA-Z])\s*/
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
            const hex = resolveLatexColor(colorSwitchMatch[1]);
            if (hex) groupStyle.color = hex;
          }
          out.push(...parseInlineSegmentText(bodyStr, groupStyle, mode));
          i = br.endIdx + 1;
          continue;
        }
      }
    }

    if (text[i] === '\\') {
      const rest = text.slice(i);

      // \textcolor{color}{content}
      const tcMatch = rest.match(/^\\textcolor\s*\{([^}]+)\}\s*\{/);
      if (tcMatch) {
        const braceStart = i + tcMatch[0].length - 1;
        const br = readBalancedBraces(text, braceStart);
        if (br) {
          flushText();
          const hex = resolveLatexColor(tcMatch[1]);
          out.push(
            ...parseInlineSegmentText(
              br.content,
              { ...currentStyle, ...(hex ? { color: hex } : {}) },
              mode
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
              mode
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

      // \textbf{}, \textit{}, \emph{}, \underline{}, \textrm{}, \textsf{}, \texttt{}
      const styleMatch = rest.match(
        /^\\(textbf|textit|emph|underline|textrm|textsf|texttt|text|mbox)\s*\{/
      );
      if (styleMatch) {
        const braceStart = i + styleMatch[0].length - 1;
        const br = readBalancedBraces(text, braceStart);
        if (br) {
          flushText();
          const cmd = styleMatch[1];
          const nextStyle: InlineStyle = {
            ...currentStyle,
            bold: currentStyle.bold || cmd === 'textbf',
            italic: currentStyle.italic || cmd === 'textit' || cmd === 'emph',
            underline: currentStyle.underline || cmd === 'underline',
          };
          out.push(...parseInlineSegmentText(br.content, nextStyle, mode));
          i = br.endIdx + 1;
          continue;
        }
      }

      // Inline switch without braces: \bfseries, \itshape, \Large, \color{...}
      const inlineSwMatch = rest.match(
        /^\\(bfseries|bf|itshape|it|em|tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge)(?![a-zA-Z])\s*/
      );
      if (inlineSwMatch) {
        flushText();
        const sw = inlineSwMatch[1];
        if (sw === 'bf' || sw === 'bfseries') currentStyle = { ...currentStyle, bold: true };
        else if (sw === 'it' || sw === 'itshape' || sw === 'em') {
          currentStyle = { ...currentStyle, italic: true };
        } else if (FONT_SIZE_PT_MAP[sw]) {
          currentStyle = { ...currentStyle, font_size_pt: FONT_SIZE_PT_MAP[sw] };
        }
        i += inlineSwMatch[0].length;
        continue;
      }

      const inlineColorMatch = rest.match(/^\\color\{([^}]+)\}\s*/);
      if (inlineColorMatch) {
        flushText();
        const hex = resolveLatexColor(inlineColorMatch[1]);
        if (hex) currentStyle = { ...currentStyle, color: hex };
        i += inlineColorMatch[0].length;
        continue;
      }

      // Explicit line break \\ or \newline
      if (text.slice(i, i + 2) === '\\\\') {
        flushText();
        let after = i + 2;
        if (text[after] === '[') {
          const brk = readBalancedBrackets(text, after);
          if (brk) after = brk.endIdx + 1;
        }
        textBuffer += '\n';
        i = after;
        continue;
      }

      const nlMatch = rest.match(/^\\newline(?![a-zA-Z])\s*/);
      if (nlMatch) {
        textBuffer += '\n';
        i += nlMatch[0].length;
        continue;
      }

      // Ignore benign layout/spacing macros in inline text
      const noopMatch = rest.match(
        /^\\(?:noindent|centering|raggedright|raggedleft|label\{[^}]*\}|ref\{[^}]*\}|hspace\*?\{[^}]*\}|vspace\*?\{[^}]*\}|hfill|vfill|smallskip|medskip|bigskip|par(?![a-zA-Z]))\s*/
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
  if (/^\\begin\{/.test(trimmed)) return true;

  const hasVietnameseWords =
    /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(
      trimmed
    );
  if (hasVietnameseWords) return false;

  if (
    /^\\(?:frac|dfrac|tfrac|sqrt|int|iint|sum|prod|lim|left|vec|overrightarrow|widehat|overline)/.test(
      trimmed
    )
  ) {
    return true;
  }
  const hasMathStructure =
    BARE_LATEX_CMD_RE.test(trimmed) || /[=<>≤≥≠]|[\^_]\{?[\w+-]+\}?/.test(trimmed);
  const words = trimmed.replace(/\\[a-zA-Z]+/g, '').match(/[a-zA-Z]{4,}/g) ?? [];
  return hasMathStructure && words.length === 0;
}

function tryParseInlineChoiceRow(line: string, mode: LatexPasteMode): DocumentBlock | null {
  const markerRe = /(?:^|\s)([A-D]\.|[a-d]\))\s+/g;
  const matches: Array<{ index: number; markerStart: number; label: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(line)) !== null) {
    const trimmedStart = m[0].startsWith(' ') || m[0].startsWith('\t') ? m.index + 1 : m.index;
    matches.push({
      index: m.index + m[0].length,
      markerStart: Math.max(0, trimmedStart),
      label: m[1],
    });
  }
  if (matches.length < 2) return null;
  if (matches[0].markerStart > 4) return null;

  const rowCells: TableCellData[] = [];
  const pct = Math.round((100 / matches.length) * 10) / 10;
  for (let idx = 0; idx < matches.length; idx++) {
    const start = matches[idx].markerStart;
    const end = idx + 1 < matches.length ? matches[idx + 1].markerStart : line.length;
    const cellText = line.slice(start, end).trim();
    const labelMatch = cellText.match(/^([A-D]\.|[a-d]\))\s*([\s\S]*)$/);
    const segs: InlineSegment[] = labelMatch
      ? [
          { type: 'text', content: `${labelMatch[1]} `, bold: true },
          ...parseInlineSegmentText(labelMatch[2], {}, mode),
        ]
      : parseInlineSegmentText(cellText, {}, mode);
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

function parseTabularEnvironment(
  colSpecRaw: string,
  bodyRaw: string,
  mode: LatexPasteMode
): DocumentBlock | null {
  const hasVertBorders = colSpecRaw.includes('|');
  const colAligns: BlockAlignment[] = [];
  for (let i = 0; i < colSpecRaw.length; i++) {
    const ch = colSpecRaw[i];
    if (ch === 'l') colAligns.push('left');
    else if (ch === 'c') colAligns.push('center');
    else if (ch === 'r') colAligns.push('right');
    else if (ch === 'p' || ch === 'm' || ch === 'b') {
      colAligns.push('left');
      if (colSpecRaw[i + 1] === '{') {
        const br = readBalancedBraces(colSpecRaw, i + 1);
        if (br) i = br.endIdx;
      }
    } else if (ch === 'X') {
      colAligns.push('left');
    }
  }

  const hasHline = /\\(?:hline|toprule|midrule|bottomrule|cline)/.test(bodyRaw);
  const rawRows = splitUnescaped(bodyRaw, '\\\\');
  const tableRows: TableCellData[][] = [];

  for (let rIdx = 0; rIdx < rawRows.length; rIdx++) {
    const cleanedRow = rawRows[rIdx]
      .replace(/\\(?:hline|toprule|midrule|bottomrule)\b/g, '')
      .replace(/\\cline\{[^}]*\}/g, '')
      .trim();
    if (!cleanedRow) continue;

    const rawCells = splitUnescaped(cleanedRow, '&');
    const rowCells: TableCellData[] = [];
    let colIdx = 0;

    for (const rawCell of rawCells) {
      const cellTrimmed = rawCell.trim();
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
        const content = br ? br.content : cellTrimmed;
        rowCells.push({
          segments: parseInlineSegmentText(content, {}, mode),
          alignment: mcAlign,
          col_span: span,
          is_header: false,
        });
        colIdx += span;
      } else {
        const align = colAligns[colIdx] ?? 'left';
        rowCells.push({
          segments: parseInlineSegmentText(cellTrimmed, {}, mode),
          alignment: align,
          is_header: false,
        });
        colIdx++;
      }
    }

    if (rowCells.length > 0) {
      tableRows.push(rowCells);
    }
  }

  if (tableRows.length === 0) return null;

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

function isLineBreakBoundary(prevLine: string, nextLine: string): boolean {
  if (!prevLine || !nextLine) return true;
  if (/\\\\(?:\[[^\]]*\])?\s*$/.test(prevLine) || /\\newline\s*$/.test(prevLine)) return true;
  if (/^\\(?:section|subsection|subsubsection|chapter|part|item|begin|end|hline|hrule|newpage|clearpage|pagebreak|maketitle)/.test(nextLine)) {
    return true;
  }
  if (/^\\(?:section|subsection|subsubsection|chapter|part|hline|hrule|maketitle)/.test(prevLine)) {
    return true;
  }
  if (/^(?:---|\$\$|\\\[)/.test(nextLine) || /(?:\$\$|\\\])$/.test(prevLine)) return true;
  if (/^(?:Câu|Bài|Ví dụ|Phần|Mục|Lời giải|Hướng dẫn giải|Đáp án|Chứng minh)\b/i.test(nextLine)) {
    return true;
  }
  if (/^([A-D]\.|[a-d]\))\s+/.test(nextLine)) return true;
  if (isPureBareLatexLine(nextLine) || isPureBareLatexLine(prevLine)) return true;
  return false;
}

function hasUnclosedMathDelimiter(src: string): boolean {
  let inSingleDollar = false;
  let inDoubleDollar = false;
  let inParen = false;
  let inBracket = false;

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
    }
  }

  return inSingleDollar || inDoubleDollar || inParen || inBracket;
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
      if (buffer && hasUnclosedMathDelimiter(buffer)) {
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

    if (hasUnclosedMathDelimiter(buffer)) {
      buffer = `${buffer} ${line}`;
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

  // Extract \loigiai{...}
  const lgMatch = /\\loigiai\s*\{/.exec(remaining);
  if (lgMatch) {
    const br = readBalancedBraces(remaining, lgMatch.index + lgMatch[0].length - 1);
    if (br) {
      loigiaiBody = br.content.trim();
      remaining = (remaining.slice(0, lgMatch.index) + remaining.slice(br.endIdx + 1)).trim();
    }
  }

  // Extract \choice{A}{B}{C}{D} or \choiceTF{A}{B}{C}{D}
  const chMatch = /\\choice(TF)?\s*\{/.exec(remaining);
  if (chMatch) {
    const isTF = Boolean(chMatch[1]);
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
      const cells: TableCellData[] = extracted.args.map((arg, idx) => ({
        segments: [
          { type: 'text', content: `${labels[idx]} `, bold: true },
          ...parseInlineSegmentText(arg.replace(/\\True\b/g, '').trim(), {}, mode),
        ],
        alignment: 'left',
        width_pct: 25,
      }));
      choiceBlock = {
        block_type: 'table',
        alignment: 'left',
        table_borderless: true,
        is_choice_block: true,
        font_size_pt: 12,
        line_spacing: 1.15,
        table_rows: [cells],
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

    // Group consecutive single-line A./B./C./D. options if present
    let pIdx = 0;
    while (pIdx < mergedParagraphs.length) {
      const pLine = mergedParagraphs[pIdx];

      // Handle explicit \par inside merged paragraph
      if (pLine.includes('\\par')) {
        const subParts = pLine.split(/\\par(?![a-zA-Z])\s*/);
        for (const sub of subParts) {
          const st = sub.trim();
          if (!st) continue;
          const segs = applyQuestionLabelBold(parseInlineSegmentText(st, {}, mode));
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

      const inlineChoice = tryParseInlineChoiceRow(pLine, mode);
      if (inlineChoice) {
        if (opts.indentLeftPt > 0) inlineChoice.indent_left_pt = opts.indentLeftPt;
        pushBlock(inlineChoice);
        pIdx++;
        continue;
      }

      // Check 4 consecutive separate-line choices A. / B. / C. / D.
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
                ...parseInlineSegmentText(lm[2], {}, mode),
              ]
            : parseInlineSegmentText(optText, {}, mode);
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

      const segs = applyQuestionLabelBold(parseInlineSegmentText(pLine, {}, mode));
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

  while (i < src.length) {
    // Escaped \$
    if (src[i] === '\\' && src[i + 1] === '$') {
      i += 2;
      continue;
    }

    // Standalone $$ ... $$
    if (src[i] === '$' && src[i + 1] === '$') {
      const isLineStart = i === 0 || src[i - 1] === '\n';
      const closeIdx = src.indexOf('$$', i + 2);
      if (closeIdx !== -1) {
        const inner = src.slice(i + 2, closeIdx).trim();
        const after = src[closeIdx + 2];
        const isStandalone = isLineStart && (!after || after === '\n' || inner.includes('\n'));
        if (isStandalone) {
          flushTextSlice(i);
          if (inner) {
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
    }

    // \[ ... \]
    if (src[i] === '\\' && src[i + 1] === '[') {
      const closeIdx = src.indexOf('\\]', i + 2);
      if (closeIdx !== -1) {
        flushTextSlice(i);
        const inner = src.slice(i + 2, closeIdx).trim();
        if (inner) {
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
            segments: parseInlineSegmentText(opts.meta.title, { bold: true, font_size_pt: 17 }, mode),
          });
        }
        if (opts.meta?.author) {
          pushBlock({
            block_type: 'paragraph',
            alignment: 'center',
            font_size_pt: 12,
            segments: parseInlineSegmentText(opts.meta.author, { font_size_pt: 12 }, mode),
          });
        }
        if (opts.meta?.date) {
          pushBlock({
            block_type: 'paragraph',
            alignment: 'center',
            font_size_pt: 11,
            segments: parseInlineSegmentText(opts.meta.date, { font_size_pt: 11 }, mode),
          });
        }
        i += makeTitleMatch[0].length;
        textStart = i;
        continue;
      }

      // Headings: \part, \chapter, \section, \subsection, \subsubsection
      const secMatch = rest.match(
        /^\\(part|chapter|section|subsection|subsubsection)(\*)?\s*(?:\[[^\]]*\])?\s*\{/
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

          if (kind === 'part' || kind === 'chapter' || kind === 'section') {
            level = 1;
            sizePt = kind === 'section' ? 15 : 17;
            if (!starred && kind === 'section') {
              ctx.sectionCount += 1;
              ctx.subsectionCount = 0;
              ctx.subsubsectionCount = 0;
              prefix = `${ctx.sectionCount}. `;
            }
          } else if (kind === 'subsection') {
            level = 2;
            sizePt = 13;
            if (!starred) {
              ctx.subsectionCount += 1;
              ctx.subsubsectionCount = 0;
              prefix = `${ctx.sectionCount}.${ctx.subsectionCount}. `;
            }
          } else {
            level = 3;
            sizePt = 12;
            if (!starred) {
              ctx.subsubsectionCount += 1;
              prefix = `${ctx.sectionCount}.${ctx.subsectionCount}.${ctx.subsubsectionCount}. `;
            }
          }

          const segs = parseInlineSegmentText(
            br.content,
            { bold: true, font_size_pt: sizePt },
            mode
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

          if (envName === 'table' || envName === 'table*') {
            flushTextSlice(i);
            let tBody = envRawBody.trimStart();
            if (tBody.startsWith('[')) {
              const posBr = readBalancedBrackets(tBody, 0);
              if (posBr) tBody = tBody.slice(posBr.endIdx + 1).trimStart();
            }

            let captionContent: string | null = null;
            const capMatch = /\\caption\*?\s*\{/.exec(tBody);
            if (capMatch) {
              const capBr = readBalancedBraces(tBody, capMatch.index + capMatch[0].length - 1);
              if (capBr) {
                captionContent = capBr.content.trim();
                tBody = (tBody.slice(0, capMatch.index) + tBody.slice(capBr.endIdx + 1)).trim();
              }
            }

            if (captionContent) {
              const tblNum = nextCounter(ctx, 'table');
              pushBlock({
                block_type: 'paragraph',
                alignment: 'center',
                font_size_pt: 11,
                segments: [
                  { type: 'text', content: `Bảng ${tblNum}: `, bold: true, font_size_pt: 11 },
                  ...parseInlineSegmentText(captionContent, { font_size_pt: 11 }, mode),
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
            const tblBlock = parseTabularEnvironment(colSpec, envRawBody.slice(pos), mode);
            if (tblBlock) {
              if (opts.indentLeftPt > 0) tblBlock.indent_left_pt = opts.indentLeftPt;
              pushBlock(tblBlock);
            }
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

          if (envName === 'quote' || envName === 'quotation' || envName === 'abstract') {
            flushTextSlice(i);
            if (envName === 'abstract') {
              pushBlock({
                block_type: 'heading',
                alignment: 'center',
                heading_level: 3,
                font_size_pt: 12,
                segments: [{ type: 'text', content: 'Tóm tắt', bold: true, font_size_pt: 12 }],
              });
            }
            const childPages = parseBodyBlocks(envRawBody, ctx, mode, {
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

          if (envName === 'enumerate' || envName === 'itemize') {
            flushTextSlice(i);
            let listBody = envRawBody.trimStart();
            if (listBody.startsWith('[')) {
              const optBr = readBalancedBrackets(listBody, 0);
              if (optBr) listBody = listBody.slice(optBr.endIdx + 1);
            }
            const items = splitListItems(listBody);
            const nextDepth = opts.listDepth + 1;
            const listIndentPt = opts.indentLeftPt + 20;

            items.forEach((item, itemIdx) => {
              const bullet =
                item.customLabel !== undefined
                  ? `${item.customLabel} `
                  : envName === 'itemize'
                  ? nextDepth > 1
                    ? '– '
                    : '• '
                  : nextDepth === 1
                  ? `${itemIdx + 1}. `
                  : `(${String.fromCharCode(97 + (itemIdx % 26))}) `;

              const itemPages = parseBodyBlocks(item.content, ctx, mode, {
                ...opts,
                listDepth: nextDepth,
                indentLeftPt: listIndentPt,
              });
              const flat = itemPages.flat();
              if (flat.length > 0 && flat[0].block_type === 'paragraph' && flat[0].segments) {
                flat[0].first_line_indent_pt = -16;
                flat[0].segments = [
                  { type: 'text', content: bullet, bold: envName === 'enumerate' },
                  ...flat[0].segments,
                ];
              }
              flat.forEach(pushBlock);
            });
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

          if (
            envName === 'theorem' ||
            envName === 'dinhly' ||
            envName === 'lemma' ||
            envName === 'bode' ||
            envName === 'definition' ||
            envName === 'dinhnghia' ||
            envName === 'corollary' ||
            envName === 'hequa' ||
            envName === 'proposition' ||
            envName === 'menhde' ||
            envName === 'remark' ||
            envName === 'nhanxet' ||
            envName === 'proof'
          ) {
            flushTextSlice(i);
            const titleMap: Record<string, string> = {
              theorem: 'Định lý',
              dinhly: 'Định lý',
              lemma: 'Bổ đề',
              bode: 'Bổ đề',
              definition: 'Định nghĩa',
              dinhnghia: 'Định nghĩa',
              corollary: 'Hệ quả',
              hequa: 'Hệ quả',
              proposition: 'Mệnh đề',
              menhde: 'Mệnh đề',
              remark: 'Nhận xét',
              nhanxet: 'Nhận xét',
              proof: 'Chứng minh',
            };
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
            const label = isProof
              ? `Chứng minh${optTitle}. `
              : `${titleMap[envName]} ${nextCounter(ctx, envName)}${optTitle}. `;

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

function normalizeSegmentListInlineMath(segments?: InlineSegment[] | null): InlineSegment[] | undefined {
  if (!segments || segments.length === 0) return segments ?? undefined;
  const result: InlineSegment[] = [];
  for (const seg of segments) {
    if (
      seg.type !== 'text' ||
      (!seg.content.includes('$') &&
        !seg.content.includes('＄') &&
        !seg.content.includes('\\(') &&
        !seg.content.includes('\\['))
    ) {
      result.push(seg);
      continue;
    }
    const { type: _t, content, tab_before, ...style } = seg;
    const split = splitTextPreservingInlineMath(content, style);
    if (tab_before && split.length > 0) {
      split[0] = { ...split[0], tab_before: true };
    }
    result.push(...split);
  }
  return result;
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
                segments: normalizeSegmentListInlineMath(cell.segments) ?? [],
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

  const { body, title, author, date, isFullLatexDoc } = preprocessDocumentAndMacros(rawText);
  if (!body.trim()) return [];

  const ctx = createParserContext();
  const pageBlockGroups = parseBodyBlocks(body, ctx, mode, {
    defaultAlign: 'left',
    isFullLatexDoc,
    listDepth: 0,
    indentLeftPt: 0,
    meta: { title, author, date },
  });

  if (pageBlockGroups.length === 0) return [];

  return pageBlockGroups.map((blocks, idx) => ({
    pageNumber: idx + 1,
    pageWidthPx: 1240,
    pageHeightPx: 1754,
    blocks,
  }));
}
