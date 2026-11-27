// Streaming a tool call: the AI's answer arrives a few characters at a time, and every finished item in an
// array (e.g. each action in a plan) is handed over the moment its closing brace arrives, so the student
// sees changes appear while the rest is still being written.

import { anthropic, limitText } from "./gateway";
import { log as bb } from "./blackbox";

/** Every complete object inside the top-level array `key` of a partial JSON text. (pure) */
export function completedItems<T = unknown>(partial: string, key: string): T[] {
  const k = partial.indexOf(`"${key}"`);
  if (k < 0) return [];
  const open = partial.indexOf("[", k);
  if (open < 0) return [];
  const out: T[] = [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let start = -1;
  for (let i = open + 1; i < partial.length; i++) {
    const c = partial[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") {
      if (depth === 0 && c === "{") start = i;
      depth++;
    } else if (c === "}" || c === "]") {
      if (depth === 0 && c === "]") break; // end of the array
      depth--;
      if (depth === 0 && c === "}" && start >= 0) {
        try {
          out.push(JSON.parse(partial.slice(start, i + 1)) as T);
        } catch {
          /* not valid JSON: skip it */
        }
        start = -1;
      }
    }
  }
  return out;
}

/** Call a tool with streaming; `onPartial` gets the tool input's JSON text as it grows. Returns the full input. */
export async function streamTool<T>(body: Record<string, unknown>, toolName: string, onPartial: (json: string) => void): Promise<{ ok: true; data: T } | { ok: false; text: string }> {
  let res: Response;
  try {
    res = await anthropic({ ...body, stream: true, tool_choice: { type: "tool", name: toolName } });
  } catch (e) {
    return { ok: false, text: (e as Error).message };
  }
  if (!res.ok || !res.body) {
    const limit = await limitText(res).catch(() => null);
    return { ok: false, text: limit ?? `stream failed (${res.status})` };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let json = "";
  let idx = -1;
  let lastSent = 0;
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
      let evt: { type: string; index?: number; content_block?: { type: string; name?: string }; delta?: { type: string; partial_json?: string }; error?: { message?: string } };
      try {
        evt = JSON.parse(data);
      } catch {
        continue;
      }
      if (evt.type === "content_block_start" && evt.content_block?.type === "tool_use" && evt.content_block.name === toolName) idx = evt.index ?? 0;
      else if (evt.type === "content_block_delta" && evt.index === idx && evt.delta?.type === "input_json_delta") {
        json += evt.delta.partial_json ?? "";
        // hand over growing text, but not on every few characters
        if (json.length - lastSent > 40) {
          lastSent = json.length;
          onPartial(json);
        }
      } else if (evt.type === "error") {
        bb("stream", "error", { message: evt.error?.message?.slice(0, 160) });
        return { ok: false, text: evt.error?.message ?? "stream error" };
      }
    }
  }
  onPartial(json);
  try {
    return { ok: true, data: JSON.parse(json || "{}") as T };
  } catch {
    return { ok: false, text: "the answer came back cut off" };
  }
}
