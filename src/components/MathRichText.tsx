import React from 'react';
import katex from 'katex';

interface MathRichTextProps {
  text: string;
  displayMathOnly?: boolean;
  className?: string;
}

function renderKatexHtml(latex: string, displayMode: boolean): string {
  const cleaned = latex
    .trim()
    .replace(/^\$\$|\$\$$/g, '')
    .replace(/^\$|\$$/g, '')
    .replace(/[\uEF00\u200B-\u200F\u2060-\u2064\uFEFF]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uE000-\uF8FF\uFFFD]/g, '');
  try {
    return katex.renderToString(cleaned, {
      displayMode,
      throwOnError: false,
      strict: false,
    });
  } catch {
    return cleaned;
  }
}

export const MathRichText: React.FC<MathRichTextProps> = ({
  text,
  displayMathOnly = false,
  className = '',
}) => {
  if (displayMathOnly) {
    return (
      <div
        className={`my-2 overflow-x-auto ${className}`}
        dangerouslySetInnerHTML={{ __html: renderKatexHtml(text, true) }}
      />
    );
  }

  const lines = text.split('\n');
  const tokenRegex = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\*\*[^*\n]+?\*\*|\*[^*\n]+?\*)/g;

  return (
    <span className={className}>
      {lines.map((line, lineIdx) => {
        const parts: React.ReactNode[] = [];
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        tokenRegex.lastIndex = 0;

        while ((match = tokenRegex.exec(line)) !== null) {
          if (match.index > lastIndex) {
            parts.push(
              <React.Fragment key={`t-${lineIdx}-${lastIndex}`}>
                {line.slice(lastIndex, match.index)}
              </React.Fragment>
            );
          }

          const token = match[0];
          const key = `m-${lineIdx}-${match.index}`;
          if (token.startsWith('$$') && token.endsWith('$$')) {
            parts.push(
              <span
                key={key}
                className="inline-block align-middle mx-1"
                dangerouslySetInnerHTML={{ __html: renderKatexHtml(token.slice(2, -2), false) }}
              />
            );
          } else if (token.startsWith('$') && token.endsWith('$')) {
            parts.push(
              <span
                key={key}
                className="inline-block align-middle mx-0.5"
                dangerouslySetInnerHTML={{ __html: renderKatexHtml(token.slice(1, -1), false) }}
              />
            );
          } else if (token.startsWith('**') && token.endsWith('**')) {
            parts.push(
              <strong key={key} className="font-semibold text-slate-900">
                <MathRichText text={token.slice(2, -2)} />
              </strong>
            );
          } else if (token.startsWith('*') && token.endsWith('*')) {
            parts.push(
              <em key={key} className="italic">
                {token.slice(1, -1)}
              </em>
            );
          }

          lastIndex = match.index + token.length;
        }

        if (lastIndex < line.length) {
          parts.push(
            <React.Fragment key={`e-${lineIdx}-${lastIndex}`}>
              {line.slice(lastIndex)}
            </React.Fragment>
          );
        }

        return (
          <React.Fragment key={`line-${lineIdx}`}>
            {lineIdx > 0 && <br />}
            {parts}
          </React.Fragment>
        );
      })}
    </span>
  );
};
