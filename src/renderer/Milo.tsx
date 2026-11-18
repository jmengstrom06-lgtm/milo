// Placeholder character drawn in SVG. This gets swapped for the Rive character later;
// each mood maps 1:1 to a state in the Rive state machine we'll build.
export type Mood =
  | "idle"
  | "walking"
  | "jumping"
  | "sitting"
  | "looking"
  | "pointing"
  | "writing"
  | "thinking"
  | "happy"
  | "celebrating";

export default function Milo({
  mood,
  facing,
  speaking,
}: {
  mood: Mood;
  facing: "left" | "right";
  speaking: boolean;
}) {
  return (
    <svg
      className={`milo milo--${mood} ${speaking ? "milo--speaking" : ""}`}
      viewBox="0 0 120 140"
      width={120}
      height={140}
      style={{ transform: facing === "left" ? "scaleX(-1)" : undefined }}
      aria-label="Milo"
    >
      {/* tail */}
      <path className="milo__tail" d="M78 100 C 108 98, 112 70, 96 62" stroke="#7a4a26" strokeWidth="6" fill="none" strokeLinecap="round" />

      {/* legs */}
      <g className="milo__leg milo__leg--back">
        <rect x="46" y="108" width="11" height="22" rx="5" fill="#7a4a26" />
        <ellipse cx="51" cy="131" rx="9" ry="5" fill="#e8c39e" />
      </g>
      <g className="milo__leg milo__leg--front">
        <rect x="63" y="108" width="11" height="22" rx="5" fill="#8b5a2b" />
        <ellipse cx="69" cy="131" rx="9" ry="5" fill="#e8c39e" />
      </g>

      {/* body */}
      <ellipse cx="60" cy="96" rx="24" ry="22" fill="#8b5a2b" />
      <ellipse cx="60" cy="100" rx="15" ry="14" fill="#e8c39e" />

      {/* arms */}
      <g className="milo__arm milo__arm--left">
        <rect x="30" y="82" width="10" height="26" rx="5" fill="#7a4a26" />
      </g>
      <g className="milo__arm milo__arm--right">
        <rect x="80" y="82" width="10" height="26" rx="5" fill="#7a4a26" />
        {/* pencil (writing) */}
        <g className="milo__pencil">
          <rect x="82" y="104" width="5" height="22" rx="1" fill="#f5c542" />
          <polygon points="82,126 87,126 84.5,133" fill="#f0d9b5" />
          <polygon points="83.6,130 85.4,130 84.5,133" fill="#333" />
          <rect x="82" y="101" width="5" height="4" fill="#e88" />
        </g>
      </g>

      {/* head */}
      <g className="milo__head">
        <circle cx="30" cy="44" r="12" fill="#8b5a2b" />
        <circle cx="30" cy="44" r="7" fill="#e8c39e" />
        <circle cx="90" cy="44" r="12" fill="#8b5a2b" />
        <circle cx="90" cy="44" r="7" fill="#e8c39e" />
        <circle cx="60" cy="44" r="30" fill="#8b5a2b" />
        <path d="M38 50 C 38 32, 58 30, 60 40 C 62 30, 82 32, 82 50 C 82 66, 70 72, 60 72 C 50 72, 38 66, 38 50 Z" fill="#e8c39e" />
        <g className="milo__eyes">
          <ellipse cx="51" cy="46" rx="5" ry="6" fill="#2b1a0e" />
          <ellipse cx="69" cy="46" rx="5" ry="6" fill="#2b1a0e" />
          <circle cx="53" cy="44" r="1.8" fill="#fff" />
          <circle cx="71" cy="44" r="1.8" fill="#fff" />
        </g>
        <ellipse cx="60" cy="56" rx="3" ry="2" fill="#5a3418" />
        <path className="milo__smile" d="M52 61 Q 60 67, 68 61" stroke="#5a3418" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <ellipse className="milo__mouth" cx="60" cy="63" rx="5" ry="4" fill="#5a3418" />
        {/* magnifying glass (looking) */}
        <g className="milo__glass">
          <circle cx="69" cy="46" r="11" fill="rgba(180,220,255,0.35)" stroke="#444" strokeWidth="3" />
          <rect x="77" y="53" width="5" height="16" rx="2" fill="#444" transform="rotate(-40 79 61)" />
        </g>
      </g>

      {/* thinking dots */}
      <g className="milo__dots">
        <circle cx="96" cy="14" r="4" fill="#fff" stroke="#c9b8a6" />
        <circle cx="106" cy="6" r="3" fill="#fff" stroke="#c9b8a6" />
        <circle cx="88" cy="22" r="2.5" fill="#fff" stroke="#c9b8a6" />
      </g>
    </svg>
  );
}
