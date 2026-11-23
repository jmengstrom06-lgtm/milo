// Milo, the purple horned frog. One vector character with moods and outfits, drawn in SVG so it's
// crisp at any size and needs no assets. Blinks, bobs and sways his tail on his own. When the Rive
// file arrives it can replace this component behind the same props.

export type FrogMood = "idle" | "happy" | "wave" | "celebrate" | "think" | "focus" | "write" | "listen" | "sad" | "worried" | "sleep";
export type FrogOutfit = "none" | "beanie" | "headphones" | "scarf" | "gradcap";

const MOUTH: Record<FrogMood, string> = {
  idle: "M90 110 Q100 117 110 110",
  happy: "M86 108 Q100 123 114 108",
  wave: "M86 108 Q100 123 114 108",
  celebrate: "M85 106 Q100 128 115 106 Z",
  think: "M94 113 Q102 110 109 114",
  focus: "M93 112 L107 112",
  write: "M93 112 Q100 115 107 112",
  listen: "M96 112 a4.5 4.5 0 1 0 9 0 a4.5 4.5 0 1 0 -9 0",
  sad: "M88 117 Q100 106 112 117",
  worried: "M89 114 Q94 109 100 114 Q106 119 111 114",
  sleep: "M95 112 Q100 115 105 112",
};
const LOOK: Partial<Record<FrogMood, [number, number]>> = { think: [4, -5], focus: [3, 4], write: [5, 5], listen: [-5, 0], sad: [0, 4], worried: [-2, 1] };
const BROW: Partial<Record<FrogMood, string>> = {
  focus: "M64 73 L88 79 M136 73 L112 79",
  write: "M64 73 L88 79 M136 73 L112 79",
  sad: "M64 79 L88 72 M136 79 L112 72",
  worried: "M64 79 L88 72 M136 79 L112 72",
  think: "M66 74 Q78 66 90 73",
};
const BOB: Partial<Record<FrogMood, [string, string]>> = {
  celebrate: ["0 0;0 -14;0 0", "0.7s"],
  sleep: ["0 0;0 2;0 0", "4s"],
  wave: ["0 0;0 -3;0 0", "1.4s"],
  happy: ["0 0;0 -4;0 0", "1.8s"],
  worried: ["0 0;-2 0;2 0;0 0", "0.5s"],
};

const ARM = "#5a2f94";
const Loop = (p: { type: "translate" | "rotate"; values: string; dur: string }) => (
  <animateTransform attributeName="transform" type={p.type} values={p.values} dur={p.dur} repeatCount="indefinite" />
);

export default function MiloFrog({ mood = "idle", outfit = "none", size = 120, title }: { mood?: FrogMood; outfit?: FrogOutfit; size?: number; title?: string }) {
  const closed = mood === "sleep" || mood === "celebrate" || mood === "happy";
  const [lx, ly] = LOOK[mood] ?? [0, 0];
  const [bob, bobDur] = BOB[mood] ?? ["0 0;0 -3;0 0", "3s"];
  const arm = mood === "celebrate" ? "up" : mood === "wave" ? "wave" : mood === "think" ? "chin" : mood === "listen" ? "ear" : mood === "write" ? "write" : "down";
  const squint = mood === "focus" || mood === "write";
  const leftArmDown = <ellipse cx="57" cy="150" rx="8" ry="14" fill={ARM} transform="rotate(18 57 150)" />;
  const rightArmDown = <ellipse cx="143" cy="150" rx="8" ry="14" fill={ARM} transform="rotate(-18 143 150)" />;
  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ display: "block", overflow: "visible", flex: "none" }}
    >
      <ellipse cx="100" cy="189" rx="50" ry="6" fill="#000" opacity="0.35" />
      <g>
        <Loop type="translate" values={bob} dur={bobDur} />
        <path d="M142 166 Q182 168 188 142 Q190 132 182 136 Q174 156 140 154 Z" fill={ARM}>
          <Loop type="rotate" values="0 140 160;4 140 160;0 140 160" dur="2.6s" />
        </path>
        <ellipse cx="74" cy="181" rx="15" ry="8" fill={ARM} />
        <ellipse cx="126" cy="181" rx="15" ry="8" fill={ARM} />
        {[62, 70, 78, 122, 130, 138].map((x, i) => (
          <circle key={x} cx={x} cy={i === 0 || i === 5 ? 185 : 187} r="3.2" fill="#45207a" />
        ))}

        <path d="M52 128 l-9 4 l9 4 Z M50 142 l-10 4 l10 4 Z M53 156 l-9 4 l9 3 Z M148 128 l9 4 l-9 4 Z M150 142 l10 4 l-10 4 Z M147 156 l9 4 l-9 3 Z" fill="#8d62c9" />
        <ellipse cx="100" cy="144" rx="50" ry="40" fill="#6a3aa8" />
        <ellipse cx="100" cy="151" rx="30" ry="26" fill="#f3ead2" />
        <path d="M80 141 h40 M77 151 h46 M81 161 h38" stroke="#e2d4b4" strokeWidth="2" strokeLinecap="round" />
        <g fill="#45207a" opacity="0.6">
          <circle cx="64" cy="128" r="3.2" />
          <circle cx="136" cy="132" r="3.6" />
          <circle cx="131" cy="160" r="2.6" />
          <circle cx="69" cy="160" r="2.6" />
        </g>

        {outfit === "scarf" && (
          <g>
            <path d="M56 122 Q100 140 144 122 L145 134 Q100 152 55 134 Z" fill="#E8607A" />
            <path d="M118 136 l6 28 l13 -3 l-5 -27 Z" fill="#D04E68" />
          </g>
        )}

        {arm === "down" && (
          <>
            {leftArmDown}
            {rightArmDown}
          </>
        )}
        {arm === "up" && (
          <>
            <ellipse cx="50" cy="106" rx="7.5" ry="15" fill={ARM} transform="rotate(-28 50 106)" />
            <ellipse cx="150" cy="106" rx="7.5" ry="15" fill={ARM} transform="rotate(28 150 106)" />
          </>
        )}
        {arm === "wave" && (
          <>
            {leftArmDown}
            <g>
              <Loop type="rotate" values="0 146 124;-14 146 124;0 146 124" dur="0.9s" />
              <ellipse cx="156" cy="108" rx="7.5" ry="15" fill={ARM} transform="rotate(30 156 108)" />
            </g>
          </>
        )}
        {arm === "chin" && (
          <>
            {leftArmDown}
            <ellipse cx="124" cy="124" rx="7.5" ry="14" fill={ARM} transform="rotate(-40 124 124)" />
          </>
        )}
        {arm === "ear" && (
          <>
            {rightArmDown}
            <ellipse cx="44" cy="100" rx="7.5" ry="13" fill={ARM} transform="rotate(-10 44 100)" />
          </>
        )}
        {arm === "write" && (
          <>
            {leftArmDown}
            <g>
              <Loop type="translate" values="0 0;3 1;-2 0;0 0" dur="0.5s" />
              <ellipse cx="140" cy="140" rx="8" ry="13" fill={ARM} transform="rotate(-50 140 140)" />
              <g transform="rotate(-35 150 132)">
                <rect x="140" y="128" width="36" height="7" rx="1.5" fill="#F5C542" />
                <path d="M176 128 l9 3.5 l-9 3.5 Z" fill="#f3ead2" />
                <rect x="136" y="128" width="5" height="7" rx="1.5" fill="#F2A6C4" />
              </g>
            </g>
          </>
        )}

        {/* crown of six horns, behind the head */}
        <path d="M44 86 L35 58 L61 75 Z M57 71 L55 44 L77 64 Z M77 61 L81 33 L96 59 Z M104 59 L119 33 L123 61 Z M123 64 L145 44 L143 71 Z M139 75 L165 58 L156 86 Z" fill="#d9c8f5" />
        <ellipse cx="100" cy="94" rx="62" ry="42" fill="#6a3aa8" />
        <ellipse cx="92" cy="76" rx="38" ry="13" fill="#8d62c9" opacity="0.55" />

        {closed ? (
          <path
            d={mood === "sleep" ? "M65 93 Q78 101 91 93 M109 93 Q122 101 135 93" : "M65 95 Q78 82 91 95 M109 95 Q122 82 135 95"}
            stroke="#1b0f2e"
            strokeWidth="3.5"
            strokeLinecap="round"
            fill="none"
          />
        ) : (
          <g>
            <circle cx="78" cy="92" r="15" fill="#fff" />
            <circle cx="122" cy="92" r="15" fill="#fff" />
            <circle cx={78 + lx} cy={92 + ly} r="8.5" fill="#1b0f2e" />
            <circle cx={122 + lx} cy={92 + ly} r="8.5" fill="#1b0f2e" />
            <circle cx={81 + lx} cy={88 + ly} r="3" fill="#fff" />
            <circle cx={125 + lx} cy={88 + ly} r="3" fill="#fff" />
            {[78, 122].map((cx) => (
              <ellipse key={cx} cx={cx} cy="92" rx="16.5" ry="0" fill="#6a3aa8">
                <animate attributeName="ry" values="0;0;16.5;0" keyTimes="0;0.93;0.965;1" dur="4.6s" repeatCount="indefinite" />
              </ellipse>
            ))}
            {squint && <path d="M62 92 Q78 76 94 92 Z M106 92 Q122 76 138 92 Z" fill="#6a3aa8" />}
          </g>
        )}
        {BROW[mood] && <path d={BROW[mood]} stroke="#2a1645" strokeWidth="3.5" strokeLinecap="round" fill="none" />}
        <ellipse cx="60" cy="107" rx="9" ry="5.5" fill="#f2a6c4" opacity="0.75" />
        <ellipse cx="140" cy="107" rx="9" ry="5.5" fill="#f2a6c4" opacity="0.75" />
        <path d={MOUTH[mood]} stroke="#2a1645" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" fill={mood === "celebrate" ? "#3a1d5e" : "none"} />

        {outfit === "beanie" && (
          <g>
            <path d="M46 78 Q100 18 154 78 Q100 64 46 78 Z" fill="#F28C5B" />
            <path d="M44 78 Q100 62 156 78 L156 86 Q100 72 44 86 Z" fill="#E07444" />
            <circle cx="100" cy="30" r="9" fill="#FFF3E0" />
          </g>
        )}
        {outfit === "headphones" && (
          <g>
            <path d="M38 94 Q100 6 162 94" stroke="#2B2B33" strokeWidth="8" fill="none" strokeLinecap="round" />
            <rect x="28" y="80" width="18" height="30" rx="7" fill="#7CC7A8" />
            <rect x="154" y="80" width="18" height="30" rx="7" fill="#7CC7A8" />
          </g>
        )}
        {outfit === "gradcap" && (
          <g>
            <path d="M76 52 v14 q24 11 48 0 v-14 Z" fill="#1b1b22" />
            <path d="M56 48 L100 30 L144 48 L100 66 Z" fill="#26262E" />
            <path d="M100 48 L140 52 L140 72" stroke="#F5C542" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            <circle cx="140" cy="74" r="3.5" fill="#F5C542" />
          </g>
        )}

        {mood === "think" && (
          <g fill="#cfc1ea">
            <circle cx="160" cy="58" r="4" />
            <circle cx="172" cy="44" r="5.5" />
            <circle cx="186" cy="27" r="7.5" />
          </g>
        )}
        {mood === "sleep" && (
          <g stroke="#cfc1ea" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none">
            <path d="M150 52 h12 l-12 12 h12" />
            <path d="M168 30 h9 l-9 9 h9" />
          </g>
        )}
        {mood === "celebrate" && (
          <g fill="#F5C542">
            <Loop type="translate" values="0 0;0 -4;0 0" dur="0.6s" />
            <path d="M36 52 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3 Z" />
            <path d="M166 34 l2.5 6 l6 2.5 l-6 2.5 l-2.5 6 l-2.5 -6 l-6 -2.5 l6 -2.5 Z" />
            <path d="M176 96 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 Z" />
          </g>
        )}
        {mood === "worried" && <path d="M156 62 q7 11 0 15 q-7 -4 0 -15 Z" fill="#8FD3F5" />}
        {mood === "listen" && (
          <g stroke="#cfc1ea" strokeWidth="2.5" strokeLinecap="round" fill="none">
            <path d="M22 88 q-6 10 0 20" />
            <path d="M14 82 q-9 16 0 32" />
          </g>
        )}
      </g>
    </svg>
  );
}
