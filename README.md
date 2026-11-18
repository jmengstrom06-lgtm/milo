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

- Milo sits in the bottom-right corner and wanders around on his own
- **Click Milo** to open the chat. Click him again (or press Esc) to hide it
- **Cmd+Shift+M** from any app: Milo runs to the middle of the screen and opens up
- Clicks anywhere else go straight through to your apps
- "Voice on/off" toggles Milo reading answers out loud
- "Quit" closes Milo

## How it's built

| Piece | File |
|---|---|
| Transparent always-on-top window, click-through, global shortcut | `src/main/main.ts` |
| Milo's brain (Anthropic API, key stays in main process) | `src/main/brain.ts` |
| Safe bridge between window and brain | `src/main/preload.ts` |
| Movement, wandering, chat panel | `src/renderer/App.tsx` |
| Placeholder character + moods (idle, walking, sitting, thinking, talking, happy) | `src/renderer/Milo.tsx`, `styles.css` |

## Roadmap (beta by Jan 18)

- [x] Phase 1a: Milo on screen, walks, chats with Claude
- [ ] Phase 1b: Rive character replaces the SVG placeholder
- [ ] Phase 2: Screen capture, Milo walks to the question, animated notebook, Teach Me mode
- [ ] Phase 3: Help Me / Do It For Me, real computer actions, memory (Supabase)
- [ ] Phase 4: Accounts, TCU network, shared study room with two Milos
- [ ] Phase 5: Polish, signed Mac beta
