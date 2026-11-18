# Milo: Rive Character Brief

**Project:** Milo, an AI study companion that lives on a student's Mac screen
**Deliverable:** one interactive Rive character (`milo.riv`) with a state machine, ready for the Rive web runtime
**Budget / timeline:** $150-300, first draft in 5 days, final in 10 days

---

## 1. The character

- **What he is:** Milo, a small **purple horned lizard** (a "horned frog"). An original character, cute but not childish.
- **Look:**
  - Wide, slightly flat head with a **crown of 6 pale-lavender horns** along the back of the head
  - Big expressive eyes with a white highlight; soft pink cheeks
  - Rounded purple body (#6a3aa8 base, #45207a shadow, #8d62c9 highlight) with a cream belly (#f3ead2) with faint horizontal lines
  - Small spikes along both sides of the body, a few darker spots, short tail
  - Short arms and legs, 3 little toes
- **Vibe:** friendly, quick, confident. Think a premium app mascot (Duolingo-level polish, but calmer and more grown-up), **not** a kids' cartoon.
- **Must avoid:** anything resembling TCU's SuperFrog or any university logo, mascot costume, or trademark. Original design only.
- **Reference for proportions and poses:** the current placeholder (see `frog_moods.png` in this repo). Keep the silhouette, upgrade everything else.

## 2. Technical specs

| Item | Spec |
|---|---|
| Artboard | 240 x 280 px, transparent background, character standing on the bottom edge |
| Facing | Drawn facing right (the app mirrors him for left) |
| Style | Vector, flat shading with 1 to 2 subtle shadow tones, no outlines heavier than 2px |
| Performance | Under 300 KB, smooth at 60 fps, no raster images |
| State machine name | `Milo` |

## 3. State machine inputs

| Input | Type | Values |
|---|---|---|
| `mood` | Number | 0 idle, 1 walk, 2 jump, 3 sit, 4 look, 5 point, 6 write, 7 think, 8 happy, 9 celebrate, 10 listen |
| `speaking` | Boolean | true = mouth talks (loop), layered on top of any mood |
| `lookX`, `lookY` | Number | -1 to 1, eyes and slight head turn follow these (we'll feed the mouse or target position) |
| `land` | Trigger | short squash on landing after a jump |

Blink should run on its own every 3-6 seconds (random). The tail should have a gentle idle sway in every state.

## 4. Animations (each loops unless noted)

| # | State | What it looks like |
|---|---|---|
| 0 | **Idle** | Breathing bob, blink, tail sway, occasional glance around |
| 1 | **Walk** | Bouncy 4-frame-feel walk cycle in place (the app moves him across the screen) |
| 2 | **Jump** | Arms up, legs tucked, stretched body (held while airborne). `land` trigger = quick squash and settle |
| 3 | **Sit** | Sits down, legs out, relaxed. Transition in and out (~0.3s) |
| 4 | **Look** | Holds a small magnifying glass to one eye, head scanning left-right |
| 5 | **Point** | Arm extended toward the front, small bounce, confident face |
| 6 | **Write** | Holds a yellow pencil, quick scribbling motion, head tilted toward the work |
| 7 | **Think** | Hand on chin, eyes up, three small thought dots appear |
| 8 | **Happy** | Smile, one small wave |
| 9 | **Celebrate** | Both arms up, two quick hops, eyes closed happy (plays ~1.2s then returns to Happy) |
| 10 | **Listen** | Head tilted, one hand cupped near the side of the head |
| - | **Talking** | Mouth open/close loop with 3 shapes (closed, mid, open), works on top of every state |

Transitions between any two states should blend in **0.15-0.25s**. Nothing should pop.

## 5. What to send back

1. `milo.riv` (and the `.rev` source file)
2. A 20-second screen recording cycling through every state
3. A PNG of the character standing (for the app icon and website)

## 6. How we'll judge it

- Reads clearly at small size (about 120 x 140 on screen)
- Feels alive when idle, never jittery
- Professional enough for a product launch video; not cutesy
- Every input above works in the Rive web runtime

Questions: message the founder (Jake) through the platform.
