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
  return s.trim();
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
