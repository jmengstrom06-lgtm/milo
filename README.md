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
- [ ] Phase 3: Help Me / Do It For Me, real computer actions, memory (Supabase)
- [ ] Phase 4: Accounts, TCU network, shared study room with two Milos
- [ ] Phase 5: Polish, signed Mac beta
