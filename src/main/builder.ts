// Build-a-Tool: Claude writes a small, complete web app (one HTML file), streamed so the panel can
// show the code being written live, then runs it in a sandbox.

export type BuildEvent =
  | { type: "code"; delta: string }
  | { type: "done"; title: string; html: string }
  | { type: "error"; text: string };

const SYSTEM = `You build small, polished single-file web tools for a college student, on request.
Return ONLY one complete HTML document. No markdown fences, no explanation before or after.
The very first line must be: <!-- title: Short Tool Name -->

Requirements:
- Everything inline (CSS in <style>, JS in <script>). No external scripts, fonts, images, or network requests.
- It must work immediately with no setup. Pre-fill realistic example values so it looks alive on first open.
- Design: clean and modern. Dark background #0f1018, cards #171826 with 1px rgba(255,255,255,0.08) borders,
  14px radius, text #e9e9f1, muted #8b8ba3, accent #8b5cf6, success #34d399. System font stack
  (-apple-system, BlinkMacSystemFont, "Inter", sans-serif). Generous spacing. No emojis. Professional, not cute.
- Responsive from 360px to 1400px wide. Big readable numbers for results.
- Results update live as inputs change. Validate inputs gently.
- Save the user's data in localStorage inside try/catch (it may be unavailable).
- Keep it focused: one clear job, done really well.`;

function model() {
  return process.env.MILO_BUILD_MODEL || process.env.MILO_MODEL || "claude-sonnet-5-5";
}

export async function buildTool(request: string, emit: (e: BuildEvent) => void, signal?: AbortSignal) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return emit({ type: "error", text: "I need my Anthropic key to build things." });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: model(),
      max_tokens: 12000,
      stream: true,
      system: SYSTEM,
      messages: [{ role: "user", content: `Build this: ${request}` }],
    }),
  }).catch((e) => e as Error);
  if (res instanceof Error) return emit({ type: "error", text: `I couldn't reach my brain: ${res.message}` });
  if (!res.ok || !res.body) return emit({ type: "error", text: `Building hit an error (${res.status}).` });

  let html = "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = chunk
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("");
        if (!data) continue;
        try {
          const evt = JSON.parse(data);
          if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
            html += evt.delta.text;
            emit({ type: "code", delta: evt.delta.text });
          }
        } catch {
          /* keep-alive */
        }
      }
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    return emit({ type: "error", text: `Building stopped: ${(e as Error).message}` });
  }

  html = html.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/, "").trim();
  if (!/<html|<body|<div/i.test(html)) return emit({ type: "error", text: "That build didn't come out right. Try asking again?" });
  const title = html.match(/<!--\s*title:\s*([^>]+?)\s*-->/i)?.[1] || html.match(/<title>([^<]+)<\/title>/i)?.[1] || "New tool";
  emit({ type: "done", title: title.slice(0, 60), html });
}
