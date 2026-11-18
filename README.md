# Milo

An animated AI companion that lives on your screen.

## Run it (Mac)

1. Install Node 20+ from nodejs.org (one time)
2. In Terminal, inside this folder:
   ```
   npm install
   cp .env.example .env
   ```
3. Open `.env` and paste your Anthropic API key after `ANTHROPIC_API_KEY=`
4. Start Milo:
   ```
   npm run dev
   ```

## Using him

### Talk to him
- **Cmd+Shift+Space** (or the Talk button): say what you want. "Teach me number 4", "do this one for me" (hover the question), "the one about variance"
- **Hands-free** (chip in the chat header): always listening, just start with "Milo, ..."
- During a lesson: "do it for me", "give me a hint", "teach me", "show me the answer", "copy it", "more like this",
  "say that again", "skip", "no, number 3", "thanks" (closes). When he asks "what do you get?", just say your answer.
- Other questions on screen get number tags; click one or say its number to switch.
- First time: allow **Terminal** under System Settings > Privacy & Security > **Microphone**.
- Speech-to-text uses ElevenLabs (the milo key needs Text to Speech + Speech to Text access).

### Let him use your computer
- "Hey Milo, open Claude and type your name", "type a paragraph about photosynthesis in my Google Doc", "search for TCU basketball"
- In a lesson: "type it in" puts the answer in the blank
- He hops to each spot, clicks and types, and says what he's doing. **Esc**, the Stop button, or "stop" halts him
- He asks before anything that sends, submits, buys or deletes. Say "yes" or "no"
- First time: allow **Terminal** under System Settings > Privacy & Security > **Accessibility**

"Hey Milo" (hands-free) is on by default; turn it off with the Hands-free chip.

### Final boss features
- **Worksheet Sweep:** "do this whole worksheet". Every question solved, answers typed into each box or pinned on the page, progress bar, summary with Copy all
- **Build-a-Tool:** "make me a final grade calculator". Watch the code write itself, then use the app; save to My Tools
- **Watch Me Work:** "watch me work" / "check my work". Flags real mistakes with an amber ring and a hint
- **Quiz Mode:** "quiz me on this". 6 questions from what's on screen, answer out loud, score + review
- **Daily Brief:** greets you by name once a day and reads what's due from D2L (sign in once inside Milo)
- Subtle sounds (toggle in the chat panel), visible live typing, "call me Jake"

### Research
- "Hey Milo, look up…", "who is…", "what's the weather in…", "research…", "search for…"
- A research panel opens next to Milo: each search, the sources he reads, and the answer appear live; he reads the answer out loud
- The page he found loads live inside the panel. Resize: compact / half screen / full screen (or say "full screen", "half screen", "smaller"); Open in Chrome; Copy; Esc or "thanks" closes
- Uses Claude's web search tool. If your Anthropic account has web search turned off, he answers from memory and says so

### Keys and clicks

- **Cmd+Shift+Y** from any app: Milo looks at your screen, jumps to the question, spotlights it, and teaches it in his notebook
- **Click Milo** to open the chat: pick Teach me / Hint / Do it for me, then hit **Look at my screen**
- Or type things like "teach me this" or "just do number 4 for me"
- In the notebook: answer his check question (confetti if you nail it), "Just show me the answer", Copy, or "3 more like this"
- **Esc** closes the lesson and Milo hops back to his corner
- Clicks anywhere else go straight through to your apps

First time you use Look: macOS asks for Screen Recording. Turn on **Terminal** (and Electron if listed) in
System Settings > Privacy & Security > Screen & System Audio Recording, then restart Milo.

## How it's built

| Piece | File |
|---|---|
| Transparent always-on-top window, click-through, global shortcut | `src/main/main.ts` |
| Milo's brain (Anthropic API, key stays in main process) | `src/main/brain.ts` |
| Safe bridge between window and brain | `src/main/preload.ts` |
| Movement, wandering, chat panel | `src/renderer/App.tsx` |
| Screen capture (Milo hides himself from the shot) + vision lesson, answer check, practice | `src/main/main.ts`, `src/main/brain.ts` |
| Notebook (handwritten steps, LaTeX math, check, practice) | `src/renderer/Notebook.tsx`, `MathText.tsx` |
| Spotlight ring, confetti, speech bubble | `src/renderer/Effects.tsx` |
| Placeholder character + moods (idle, walk, jump, look, point, write, think, celebrate) | `src/renderer/Milo.tsx`, `styles.css` |

## Roadmap (beta by Jan 18)

- [x] Phase 1a: Milo on screen, walks, chats with Claude
- [ ] Phase 1b: Rive character replaces the SVG placeholder
- [x] Phase 2: Screen vision, jump to the question, spotlight, animated notebook, Teach / Hint / Do it modes, answer check, practice
- [x] Phase 2.5: Voice, hands-free, computer control, research, worksheet sweep, tools, watch, quiz, daily brief
- [ ] Phase 3: Help Me / Do It For Me, real computer actions, memory (Supabase)
- [ ] Phase 4: Accounts, TCU network, shared study room with two Milos
- [ ] Phase 5: Polish, signed Mac beta

## Black-box log
Everything Milo hears, decides and does is written to **~/Milo Logs** (one file per launch, plus the last 40 voice clips). Nothing leaves your Mac.
- Something went wrong? Say **"Milo, flag that"** or press **Cmd+Shift+B** right after. That marks the moment.
- Open the folder from the **Logs** chip in the chat panel, then send the newest `session-…jsonl` file (and clips if it's a hearing problem).

## Chrome extension (fast web tasks)
Milo reads web pages' real buttons and text boxes instead of guessing from screenshots.
1. Open **chrome://extensions** in Chrome and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick the **extension** folder inside your milo folder.
3. Start Milo. The chat panel shows **Chrome ✓** when it's connected.
Pages that can't be read as elements (Google Docs, Sheets, Slides) automatically use screen mode.

## Milo's Kit (his own apps)
Say **"Milo, what can you do?"** (or click **Kit** in the chat panel) to see them fan out around him. "Your notes", "your sketch pad" etc. always mean Milo's apps.
- **Study**
  - "Teach me z-scores": a mini-lesson, then a worked example, then problems for you.
  - "Make a stats problem and solve it": solved step by step, written as he says it, with a self-drawing graph.
  - "Give me 5 practice problems on this": answer out loud or typed; **Show my work** and he points to the exact line you went wrong.
  - Misses offer an **Easier one**; three in a row offers **Harder ones**. Mastery bars per skill.
  - "Practice test on this": timed, silent, then a full question-by-question breakdown. Also flashcards.
- **Sketch**: "graph y = a(x-h)^2 + k" (with sliders), "shade P(X > 78) for N(70, 5)" (drag the mean/cutoff, the area updates), "draw a plant cell / the water cycle / a house" (Milo draws it live, free). Say "shade above 80" or "add labels" to change it. Photo-real images optional with an OpenAI key.
- **Notes**: "make notes on this page", "add to my notes: ...", "save that to my notes", "what did I write about z-scores?". **Quiz me on this** / **Flashcards** on every note; **Send to Apple Notes**.
- **Sheet**: "put these scores in a table", then talk to it: "add a z-score column", "sort by score", "only show above average", "graph hours vs score", "who's above average?". Milo computes every number himself. **Copy for Excel**.
- **Planner**: "plan my week for Exam 3" (uses your D2L due dates). Check blocks off, **Practice** any block, **Add to Calendar** (with reminders).
- **Pocket**: select text, "hold this"; later "drop it in ChatGPT" or "paste what you're holding".
