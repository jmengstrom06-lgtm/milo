// Placeholder characters drawn in SVG. These get swapped for Rive characters later;
// each mood maps 1:1 to a state in the Rive state machine we'll build.
// Every character uses the same part names (milo__arm--left, milo__eyes, ...) so all moods work for all of them.
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
  | "celebrating"
  | "listening";

export type Character = "frog" | "monkey";

export const CHARACTERS: Record<Character, { label: string; persona: string; accent: string; soft: string; deep: string }> = {
  frog: {
    label: "Horned Frog",
    persona: "a small purple horned frog (a horned lizard) with a spiky crown",
    accent: "#5b2d90",
    soft: "#ece3f7",
    deep: "#3b1a63",
  },
  monkey: {
    label: "Monkey",
    persona: "a small brown monkey",
    accent: "#8b5a2b",
    soft: "#f3e7da",
    deep: "#5a3418",
  },
};

export default function Milo({
  mood,
  facing,
  speaking,
  character,
}: {
  mood: Mood;
  facing: "left" | "right";
  speaking: boolean;
  character: Character;
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
      {character === "frog" ? <Frog /> : <Monkey />}

      {/* thinking dots (shared) */}
      <g className="milo__dots">
        <circle cx="96" cy="14" r="4" fill="#fff" stroke="#c9b8a6" />
        <circle cx="106" cy="6" r="3" fill="#fff" stroke="#c9b8a6" />
        <circle cx="88" cy="22" r="2.5" fill="#fff" stroke="#c9b8a6" />
      </g>
    </svg>
  );
}

function Pencil() {
  return (
    <g className="milo__pencil">
      <rect x="82" y="104" width="5" height="22" rx="1" fill="#f5c542" />
      <polygon points="82,126 87,126 84.5,133" fill="#f0d9b5" />
      <polygon points="83.6,130 85.4,130 84.5,133" fill="#333" />
      <rect x="82" y="101" width="5" height="4" fill="#e88" />
    </g>
  );
}

function Glass({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g className="milo__glass">
      <circle cx={cx} cy={cy} r="11" fill="rgba(180,220,255,0.35)" stroke="#444" strokeWidth="3" />
      <rect x={cx + 8} y={cy + 7} width="5" height="16" rx="2" fill="#444" transform={`rotate(-40 ${cx + 10} ${cy + 15})`} />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Horned frog: purple horned lizard with a crown of horns, side spikes and spots.
function Frog() {
  const body = "#6a3aa8";
  const dark = "#45207a";
  const light = "#8d62c9";
  const belly = "#f3ead2";
  const horn = "#e9dcf7";
  return (
    <>
      {/* stubby tail */}
      <path className="milo__tail" d="M76 110 C 96 116, 108 108, 110 96" stroke={body} strokeWidth="8" fill="none" strokeLinecap="round" />

      {/* legs */}
      <g className="milo__leg milo__leg--back">
        <rect x="45" y="108" width="12" height="20" rx="6" fill={dark} />
        <ellipse cx="50" cy="130" rx="10" ry="5" fill={light} />
        <circle cx="43" cy="131" r="2" fill={light} />
        <circle cx="57" cy="131" r="2" fill={light} />
      </g>
      <g className="milo__leg milo__leg--front">
        <rect x="63" y="108" width="12" height="20" rx="6" fill={body} />
        <ellipse cx="70" cy="130" rx="10" ry="5" fill={light} />
        <circle cx="63" cy="131" r="2" fill={light} />
        <circle cx="77" cy="131" r="2" fill={light} />
      </g>

      {/* body with side spikes */}
      <g>
        {[86, 96, 106].map((y) => (
          <g key={y}>
            <polygon points={`${33},${y - 4} ${26},${y} ${33},${y + 4}`} fill={dark} />
            <polygon points={`${87},${y - 4} ${94},${y} ${87},${y + 4}`} fill={dark} />
          </g>
        ))}
        <ellipse cx="60" cy="97" rx="27" ry="21" fill={body} />
        <ellipse cx="60" cy="101" rx="16" ry="14" fill={belly} />
        <path d="M48 96 H72 M47 102 H73 M49 108 H71" stroke="#e2d4b4" strokeWidth="1.5" />
        <circle cx="42" cy="90" r="3" fill={dark} />
        <circle cx="78" cy="92" r="3.5" fill={dark} />
      </g>

      {/* arms */}
      <g className="milo__arm milo__arm--left">
        <rect x="29" y="82" width="11" height="25" rx="5.5" fill={dark} />
      </g>
      <g className="milo__arm milo__arm--right">
        <rect x="80" y="82" width="11" height="25" rx="5.5" fill={dark} />
        <Pencil />
      </g>

      {/* head */}
      <g className="milo__head">
        {/* crown of horns */}
        {[
          [30, 44, 18, 26, 38, 38],
          [38, 36, 30, 16, 46, 32],
          [50, 31, 47, 10, 58, 29],
          [62, 29, 66, 9, 72, 31],
          [74, 32, 84, 15, 82, 37],
          [83, 38, 99, 25, 89, 45],
        ].map(([x1, y1, x2, y2, x3, y3], i) => (
          <polygon key={i} points={`${x1},${y1} ${x2},${y2} ${x3},${y3}`} fill={horn} stroke={dark} strokeWidth="1.5" strokeLinejoin="round" />
        ))}
        <ellipse cx="60" cy="52" rx="35" ry="24" fill={body} />
        {/* spots */}
        <circle cx="40" cy="44" r="3" fill={dark} />
        <circle cx="80" cy="42" r="2.5" fill={dark} />
        <circle cx="60" cy="38" r="3.5" fill={dark} />
        {/* lighter snout */}
        <ellipse cx="60" cy="62" rx="22" ry="11" fill={light} />
        {/* eyes */}
        <g className="milo__eyes">
          <circle cx="46" cy="47" r="9" fill="#fff" />
          <circle cx="74" cy="47" r="9" fill="#fff" />
          <circle cx="47" cy="48" r="5" fill="#1c1030" />
          <circle cx="75" cy="48" r="5" fill="#1c1030" />
          <circle cx="49" cy="46" r="1.8" fill="#fff" />
          <circle cx="77" cy="46" r="1.8" fill="#fff" />
        </g>
        {/* cheeks + nostrils */}
        <ellipse cx="36" cy="60" rx="5" ry="3" fill="#f2a7c3" opacity="0.6" />
        <ellipse cx="84" cy="60" rx="5" ry="3" fill="#f2a7c3" opacity="0.6" />
        <circle cx="56" cy="58" r="1.3" fill={dark} />
        <circle cx="64" cy="58" r="1.3" fill={dark} />
        <path className="milo__smile" d="M46 64 Q 60 73, 74 64" stroke={dark} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <ellipse className="milo__mouth" cx="60" cy="67" rx="7" ry="4" fill={dark} />
        <Glass cx={74} cy={47} />
      </g>
    </>
  );
}

// ---------------------------------------------------------------------------
function Monkey() {
  return (
    <>
      <path className="milo__tail" d="M78 100 C 108 98, 112 70, 96 62" stroke="#7a4a26" strokeWidth="6" fill="none" strokeLinecap="round" />
      <g className="milo__leg milo__leg--back">
        <rect x="46" y="108" width="11" height="22" rx="5" fill="#7a4a26" />
        <ellipse cx="51" cy="131" rx="9" ry="5" fill="#e8c39e" />
      </g>
      <g className="milo__leg milo__leg--front">
        <rect x="63" y="108" width="11" height="22" rx="5" fill="#8b5a2b" />
        <ellipse cx="69" cy="131" rx="9" ry="5" fill="#e8c39e" />
      </g>
      <ellipse cx="60" cy="96" rx="24" ry="22" fill="#8b5a2b" />
      <ellipse cx="60" cy="100" rx="15" ry="14" fill="#e8c39e" />
      <g className="milo__arm milo__arm--left">
        <rect x="30" y="82" width="10" height="26" rx="5" fill="#7a4a26" />
      </g>
      <g className="milo__arm milo__arm--right">
        <rect x="80" y="82" width="10" height="26" rx="5" fill="#7a4a26" />
        <Pencil />
      </g>
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
        <Glass cx={69} cy={46} />
      </g>
    </>
  );
}
