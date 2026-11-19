import katex from 'katex';
import { useMemo } from 'react';

interface MathRendererProps {
  latex: string;
  displayMode?: boolean;
  className?: string;
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

function stripDelimiters(raw: string): string {
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
  const eqMatch = s.match(/^\\begin\{(equation\*?|displaymath)\}([\s\S]*)\\end\{\1\}$/);
  if (eqMatch) {
    s = eqMatch[2].trim();
  }
  s = s
    .replace(/\uEF02/g, '\\,')
    .replace(/\uEF03/g, '\\;')
    .replace(/\uEF04/g, '\\quad ')
    .replace(/\uEF05/g, '\\qquad ')
    .replace(/[\uEF00\u200B-\u200F\u2060-\u2064\uFEFF]/g, '')
    .replace(/[\uEF01\uEF06-\uEF0F\uF020]/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uE000-\uF8FF\uFFFD]/g, '')
    .replace(/\\label\{[^}]*\}/g, '')
    .replace(/\\tag\*?\{[^}]*\}/g, '')
    .replace(/\\(?:nonumber|notag|noindent)(?![a-zA-Z])\s*/g, '')
    .replace(/\\intertext\{([^}]*)\}/g, '\\\\ \\text{$1} \\\\')
    .replace(/\\shortintertext\{([^}]*)\}/g, '\\\\ \\text{$1} \\\\')
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
    })
    .replace(/\\begin\{alignat\*?\}\s*\{[^}]*\}/g, '\\begin{aligned}')
    .replace(/\\end\{alignat\*?\}/g, '\\end{aligned}')
    .replace(/\\begin\{alignedat\}\s*\{[^}]*\}/g, '\\begin{aligned}')
    .replace(/\\end\{alignedat\}/g, '\\end{aligned}')
    .replace(/\\begin\{(align\*?|flalign\*?|eqnarray\*?|split)\}/g, '\\begin{aligned}')
    .replace(/\\end\{(align\*?|flalign\*?|eqnarray\*?|split)\}/g, '\\end{aligned}')
    .replace(/\\begin\{(gather\*?|multline\*?)\}/g, '\\begin{gathered}')
    .replace(/\\end\{(gather\*?|multline\*?)\}/g, '\\end{gathered}');

  s = expandBalancedMacro(s, 'heva', (inner) => `\\begin{cases} ${inner} \\end{cases}`);
  s = expandBalancedMacro(
    s,
    'hoac',
    (inner) => `\\left[\\begin{aligned} ${inner} \\end{aligned}\\right.`
  );
  s = expandBalancedMacro(s, 'wideparen', (inner) => `\\widehat{${inner}}`);
  s = s.replace(
    /\\(lim|limsup|liminf)(?![a-zA-Z])(?!\s*\\(?:no)?limits(?![a-zA-Z]))(?=\s*_)/g,
    '\\$1\\limits'
  );
  return fixDoubleScripts(s.trim());
}

function readScriptArgument(s: string, startIdx: number): { endIdx: number; text: string } {
  let i = startIdx;
  while (i < s.length && s[i] === ' ') i++;
  if (i >= s.length) return { endIdx: i, text: '' };
  if (s[i] === '{') {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === '\\' && j + 1 < s.length) {
        j++;
        continue;
      }
      if (s[j] === '{') depth++;
      else if (s[j] === '}') {
        depth--;
        if (depth === 0) {
          return { endIdx: j + 1, text: s.slice(i, j + 1) };
        }
      }
    }
    return { endIdx: s.length, text: s.slice(i) };
  }
  if (s[i] === '\\') {
    const m = s.slice(i).match(/^\\[a-zA-Z]+|^\\./);
    if (m) {
      return { endIdx: i + m[0].length, text: m[0] };
    }
  }
  return { endIdx: i + 1, text: s[i] };
}

function fixDoubleScripts(src: string): string {
  if (!src || (!src.includes('_') && !src.includes('^'))) return src;

  const rewriteSegment = (str: string): string => {
    let out = '';
    let i = 0;
    let atomStartInOut = -1;
    let seenSub = false;
    let seenSup = false;

    const resetAtom = () => {
      atomStartInOut = -1;
      seenSub = false;
      seenSup = false;
    };

    while (i < str.length) {
      const ch = str[i];
      if (ch === '\\') {
        const m = str.slice(i).match(/^\\(?:begin|end)\{[^}]*\}|^\\[a-zA-Z]+|^\\./);
        const tok = m ? m[0] : ch;
        const isSpacingCmd = /^\\(?:,|;|:|!|quad|qquad|\s)$/.test(tok);
        const isOpCmd = /^\\(?:to|leftarrow|rightarrow|leftrightarrow|rightleftharpoons|leftrightharpoons|rightleftarrows|leftrightarrows|xrightarrow|xleftarrow|xleftrightarrow|xrightleftharpoons|Rightarrow|Leftarrow|Leftrightarrow|leq|geq|neq|approx|equiv|sim|pm|mp|times|cdot|div|plus|minus)$/.test(
          tok
        );
        if (isSpacingCmd || isOpCmd) {
          out += tok;
          resetAtom();
        } else {
          atomStartInOut = out.length;
          seenSub = false;
          seenSup = false;
          out += tok;
        }
        i += tok.length;
        continue;
      }

      if (ch === '{') {
        let depth = 0;
        let closeIdx = -1;
        for (let j = i; j < str.length; j++) {
          if (str[j] === '\\' && j + 1 < str.length) {
            j++;
            continue;
          }
          if (str[j] === '{') depth++;
          else if (str[j] === '}') {
            depth--;
            if (depth === 0) {
              closeIdx = j;
              break;
            }
          }
        }
        if (closeIdx !== -1) {
          const inner = rewriteSegment(str.slice(i + 1, closeIdx));
          atomStartInOut = out.length;
          seenSub = false;
          seenSup = false;
          out += `{${inner}}`;
          i = closeIdx + 1;
          continue;
        }
      }

      if (ch === '_' || ch === '^') {
        const arg = readScriptArgument(str, i + 1);
        const fixedInner =
          arg.text.startsWith('{') && arg.text.endsWith('}')
            ? `{${rewriteSegment(arg.text.slice(1, -1))}}`
            : arg.text;
        const alreadyHas = ch === '_' ? seenSub : seenSup;
        if (alreadyHas) {
          if (atomStartInOut >= 0 && atomStartInOut < out.length) {
            out = `${out.slice(0, atomStartInOut)}{${out.slice(atomStartInOut)}}`;
          } else {
            out += '{}';
          }
          seenSub = ch === '_';
          seenSup = ch === '^';
        } else {
          if (atomStartInOut < 0) {
            atomStartInOut = out.length;
          }
          if (ch === '_') seenSub = true;
          else seenSup = true;
        }
        out += `${ch}${fixedInner}`;
        i = arg.endIdx;
        continue;
      }

      if (/\s|[=+\-<>(),;:\[\]|&/]/.test(ch)) {
        out += ch;
        if (!/\s/.test(ch)) {
          resetAtom();
        }
        i++;
        continue;
      }

      atomStartInOut = out.length;
      seenSub = false;
      seenSup = false;
      out += ch;
      i++;
    }

    return out;
  };

  return rewriteSegment(src);
}

export function MathRenderer({ latex, displayMode = false, className = '' }: MathRendererProps) {
  const html = useMemo(() => {
    const cleaned = stripDelimiters(latex);
    if (!cleaned) return '';
    try {
      return katex.renderToString(cleaned, {
        displayMode,
        throwOnError: false,
        strict: false,
      });
    } catch {
      return '';
    }
  }, [latex, displayMode]);

  if (!html) {
    return <span className={`font-mono text-xs text-slate-700 ${className}`}>{latex}</span>;
  }

  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
