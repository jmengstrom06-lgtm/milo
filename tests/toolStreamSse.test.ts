import { describe, it, expect, vi } from "vitest";

// a fake Anthropic stream: the tool input arrives in small pieces, like the real one
const input = { understood: "x", answer: "", ops: [{ op: "delete", para: 2 }, { op: "insert", after: 1, paragraphs: [{ text: "Hi {there}" }] }], summary: "done" };
function sse(): Response {
  const json = JSON.stringify(input);
  const events: unknown[] = [
    { type: "message_start", message: {} },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", name: "doc_plan", id: "t" } },
    ...json.match(/.{1,7}/g)!.map((p) => ({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: p } })),
    { type: "content_block_stop", index: 0 },
    { type: "message_stop" },
  ];
  const text = events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join("");
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  const body = new ReadableStream({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, i + 50)); // split mid-event on purpose
      i += 50;
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
vi.mock("../src/main/gateway", () => ({ anthropic: async () => sse(), limitText: async () => null, models: { fast: () => "f", smart: () => "s" } }));

describe("streaming a plan", () => {
  it("hands over each action as it arrives and returns the whole plan", async () => {
    const { streamTool, completedItems } = await import("../src/main/toolStream");
    const counts: number[] = [];
    const r = await streamTool<typeof input>({ model: "s" }, "doc_plan", (j) => counts.push(completedItems(j, "ops").length));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual(input);
    expect(counts).toContain(1); // the first action showed up before the second finished
    expect(counts[counts.length - 1]).toBe(2);
  });
});
