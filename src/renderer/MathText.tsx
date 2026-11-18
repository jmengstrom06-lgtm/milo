import katex from "katex";

// Renders text where math is wrapped in $...$ (inline LaTeX).
export default function MathText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(\$[^$]+\$)/g).filter(Boolean);
  return (
    <span className={className}>
      {parts.map((p, i) => {
        if (p.startsWith("$") && p.endsWith("$") && p.length > 2) {
          const html = katex.renderToString(p.slice(1, -1), { throwOnError: false, displayMode: false });
          return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />;
        }
        // **bold** in plain text
        return (
          <span key={i}>
            {p.split(/(\*\*[^*]+\*\*)/g).map((q, j) => (q.startsWith("**") && q.endsWith("**") && q.length > 4 ? <b key={j}>{q.slice(2, -2)}</b> : q))}
          </span>
        );
      })}
    </span>
  );
}

// Plain text version (for clipboard / speech).
export function stripMath(text: string) {
  return text.replace(/\$([^$]+)\$/g, (_m, inner: string) =>
    inner
      .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "($1)/($2)")
      .replace(/\\(cdot|times)/g, "*")
      .replace(/\\(left|right)/g, "")
      .replace(/\\[a-zA-Z]+/g, "")
      .replace(/[{}]/g, "")
  );
}
