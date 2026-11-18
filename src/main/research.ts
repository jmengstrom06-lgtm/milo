// Milo's research: Claude with the built-in web search tool, streamed so the panel can show
// each search, each source, and the answer as it's written.

export type ResearchEvent =
  | { type: "status"; text: string }
  | { type: "query"; text: string }
  | { type: "sources"; items: { url: string; title: string; age?: string }[] }
  | { type: "reset" } // new search started: clear any half-written answer
  | { type: "text"; delta: string }
  | { type: "cite"; url: string; title: string }
  | { type: "done"; answer: string; top: string | null; live: boolean }
  | { type: "error"; text: string };

const SYSTEM = `You are Milo, a friendly study companion doing live research for a college student.
Search the web as needed (be quick: 1 to 3 searches is usually enough). Do not write anything before your searches.
Then answer in this exact shape:
- First line: the direct answer in ONE short sentence under 20 words (this is read aloud, so no symbols or links).
- Then 2 to 5 short bullet points with the key facts (numbers, dates, names).
No preamble, no "according to my search", no closing questions.
This may be a follow-up in an ongoing research thread: use the earlier questions and answers to work out who or what "he", "she", "it", "that" refers to, and search for the new part specifically.`;

export type Turn = { q: string; a: string };
const thread = (history: Turn[], question: string) => [
  ...history.slice(-4).flatMap((t) => [
    { role: "user", content: t.q },
    { role: "assistant", content: t.a || "(no answer)" },
  ]),
  { role: "user", content: question },
];

function model() {
  return process.env.MILO_MODEL || "claude-sonnet-5-5";
}

export async function research(question: string, emit: (e: ResearchEvent) => void, signal?: AbortSignal, history: Turn[] = []) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return emit({ type: "error", text: "I need my Anthropic key to research." });

  emit({ type: "status", text: "Thinking about where to look" });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: model(),
      max_tokens: 1400,
      stream: true,
      system: SYSTEM,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
      messages: thread(history, question),
    }),
  }).catch((e) => e as Error);

  if (res instanceof Error) return emit({ type: "error", text: `I couldn't reach the internet: ${res.message}` });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    // Web search not turned on for this account: answer from memory instead.
    if (res.status === 400 && /web_search|web search|tool/i.test(detail)) return fallback(question, emit, key, history);
    return emit({ type: "error", text: `Research hit an error (${res.status}).` });
  }

  const blocks = new Map<number, { type: string; name?: string; json: string }>();
  let answer = "";
  let top: string | null = null;
  let firstSource: string | null = null;
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buf = "";

  const handle = (evt: any) => {
    switch (evt.type) {
      case "content_block_start": {
        const b = evt.content_block;
        blocks.set(evt.index, { type: b.type, name: b.name, json: "" });
        if (b.type === "server_tool_use") {
          emit({ type: "reset" });
          answer = "";
        }
        if (b.type === "web_search_tool_result") {
          const items = Array.isArray(b.content)
            ? b.content
                .filter((r: any) => r.type === "web_search_result" && r.url)
                .slice(0, 8)
                .map((r: any) => ({ url: r.url, title: r.title || r.url, age: r.page_age }))
            : [];
          if (items.length) {
            firstSource = firstSource ?? items[0].url;
            emit({ type: "sources", items });
            emit({ type: "status", text: "Reading sources" });
          }
        }
        break;
      }
      case "content_block_delta": {
        const blk = blocks.get(evt.index);
        const d = evt.delta;
        if (d.type === "input_json_delta" && blk) blk.json += d.partial_json;
        if (d.type === "text_delta") {
          answer += d.text;
          emit({ type: "text", delta: d.text });
        }
        if (d.type === "citations_delta" && d.citation?.url) {
          top = top ?? d.citation.url;
          emit({ type: "cite", url: d.citation.url, title: d.citation.title || d.citation.url });
        }
        break;
      }
      case "content_block_stop": {
        const blk = blocks.get(evt.index);
        if (blk?.type === "server_tool_use") {
          try {
            const q = JSON.parse(blk.json || "{}").query;
            if (q) emit({ type: "query", text: q });
          } catch {
            /* partial */
          }
          emit({ type: "status", text: "Searching the web" });
        }
        break;
      }
      case "message_delta":
        break;
      case "error":
        emit({ type: "error", text: evt.error?.message || "Research error" });
        break;
    }
  };

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
          handle(JSON.parse(data));
        } catch {
          /* ignore keep-alives */
        }
      }
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    return emit({ type: "error", text: `Research stopped: ${(e as Error).message}` });
  }

  emit({ type: "done", answer: answer.trim(), top: top ?? firstSource, live: true });
}

async function fallback(question: string, emit: (e: ResearchEvent) => void, key: string, history: Turn[] = []) {
  emit({ type: "status", text: "Answering from what I know" });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: model(), max_tokens: 900, system: SYSTEM, messages: thread(history, question) }),
  });
  if (!res.ok) return emit({ type: "error", text: `Research hit an error (${res.status}).` });
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const answer = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  emit({ type: "text", delta: answer });
  emit({ type: "done", answer, top: `https://www.google.com/search?q=${encodeURIComponent(question)}`, live: false });
}
