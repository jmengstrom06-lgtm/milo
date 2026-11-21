// One door for every Claude call.
// - Signed in: goes through Milo's backend (keys stay on the server, daily limits apply).
// - Not signed in but a local ANTHROPIC_API_KEY exists (development): calls Anthropic directly.
// Also turns on prompt caching and picks the right model tier.

import { backend } from "./account";
import { log as bb } from "./blackbox";
import { guard, record } from "./usage";

/** Model tiers. Fast = quick decisions and simple replies. Smart = vision, teaching, building. */
export const models = {
  fast: () => process.env.MILO_FAST_MODEL || process.env.MILO_ROUTER_MODEL || "claude-haiku-5-5",
  smart: () => process.env.MILO_MODEL || "claude-sonnet-5-5",
};

type Body = Record<string, unknown>;

/**
 * Mark the stable front of the request (tools + system prompt) as cacheable.
 * Repeat calls then skip re-reading it: faster first token and up to ~90% cheaper on that part.
 * Prompts under the model's minimum size simply aren't cached; nothing breaks.
 */
export function withCache(body: Body): Body {
  const out: Body = { ...body };
  const sys = out.system;
  if (typeof sys === "string" && sys.trim()) {
    out.system = [{ type: "text", text: sys, cache_control: { type: "ephemeral" } }];
  } else if (Array.isArray(sys) && sys.length) {
    const copy = sys.map((b) => ({ ...(b as object) })) as Record<string, unknown>[];
    copy[copy.length - 1].cache_control = { type: "ephemeral" };
    out.system = copy;
  } else if (Array.isArray(out.tools) && out.tools.length) {
    const tools = (out.tools as Record<string, unknown>[]).map((t) => ({ ...t }));
    tools[tools.length - 1].cache_control = { type: "ephemeral" };
    out.tools = tools;
  }
  return out;
}

export class NoBrainError extends Error {}

/** POST to Claude's Messages API. Returns the raw Response (works for streaming too). */
export async function anthropic(body: Body, signal?: AbortSignal): Promise<Response> {
  const full = withCache({ model: models.smart(), ...body });
  let payload = JSON.stringify(full);
  // Cost guardrails: over today's soft budget the small model takes anything without a picture;
  // over the hard budget, no new heavy work today.
  const hasImage = payload.includes('"type":"image"');
  const g = guard(String(full.model), hasImage, full.tools ? "work" : "chat");
  if (g.refuse) return new Response(JSON.stringify({ error: "limit", text: g.refuse }), { status: 429, headers: { "content-type": "application/json" } });
  if (g.model !== full.model) {
    full.model = g.model;
    payload = JSON.stringify(full);
  }
  const res = await send(payload, signal);
  // Meter what it cost (non-streaming answers carry their token counts).
  if (res.ok && !full.stream)
    res
      .clone()
      .json()
      .then((d: { usage?: Record<string, number> }) => record(String(full.model), d?.usage, hasImage))
      .catch(() => {});
  return res;
}

async function send(payload: string, signal?: AbortSignal): Promise<Response> {
  const viaBackend = await backend("claude", { body: payload, signal }).catch((e) => {
    bb("gateway", "backend_network_error", { error: (e as Error).message });
    return null;
  });
  if (viaBackend) {
    // Server not set up yet (no key stored there): fall back to the local key if there is one.
    if (viaBackend.status !== 503 || !process.env.ANTHROPIC_API_KEY) return viaBackend;
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new NoBrainError("Sign in to Milo to wake up my brain.");
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: payload,
  });
}

/** Turn a backend 429 into words Milo can say. */
export async function limitText(res: Response): Promise<string | null> {
  if (res.status !== 429) return null;
  try {
    const d = (await res.clone().json()) as { error?: string; text?: string };
    if (d.error === "limit") return d.text || "You've hit today's limit. It resets at midnight.";
    return "I'm getting a lot of requests. Give me a second.";
  } catch {
    return "I'm getting a lot of requests. Give me a second.";
  }
}
