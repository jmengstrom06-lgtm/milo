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

const GREEK = "alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|rho|sigma|tau|phi|chi|omega|Delta|Sigma|Omega|Pi|Theta|Lambda|Phi";
const GREEK_CHAR: Record<string, string> = { alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", theta: "θ", lambda: "λ", mu: "μ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", chi: "χ", omega: "ω", Delta: "Δ", Sigma: "Σ", Omega: "Ω", Pi: "Π", Theta: "Θ", Lambda: "Λ", Phi: "Φ" };

function plainMath(inner: string, voice: boolean): string {
  const g = (name: string) => (voice ? ` ${name.toLowerCase()} ` : GREEK_CHAR[name] ?? name);
  return inner
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, voice ? " $1 over $2 " : "($1)/($2)")
    .replace(/\\sqrt\{([^}]*)\}/g, voice ? " the square root of $1 " : "√($1)")
    .replace(/\\bar\{([^}]*)\}/g, voice ? " $1 bar " : "$1̄")
    .replace(/\\hat\{([^}]*)\}/g, voice ? " $1 hat " : "$1̂")
    .replace(new RegExp(`\\\\(${GREEK})\\b`, "g"), (_m, n: string) => g(n))
    .replace(/\\(cdot|times)/g, voice ? " times " : "*")
    .replace(/\\(le|leq)\b/g, voice ? " is at most " : "≤")
    .replace(/\\(ge|geq)\b/g, voice ? " is at least " : "≥")
    .replace(/\\(ne|neq)\b/g, voice ? " is not " : "≠")
    .replace(/\\pm\b/g, voice ? " plus or minus " : "±")
    .replace(/\\approx\b/g, voice ? " about " : "≈")
    .replace(/\\(left|right)/g, "")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Plain text version (for clipboard / screen text): \mu -> μ.
export function stripMath(text: string) {
  return text.replace(/\$([^$]+)\$/g, (_m, inner: string) => plainMath(inner, false));
}

// For Milo's voice: \mu -> "mu", \frac{a}{b} -> "a over b", so no symbol is silently dropped.
export function speakMath(text: string) {
  return text.replace(/\$([^$]+)\$/g, (_m, inner: string) => plainMath(inner, true)).replace(/\s+([?.,!])/g, "$1").replace(/\s{2,}/g, " ");
}
