// Milo's brain: talks to the Anthropic Messages API from the main process,
// so the API key never touches the renderer.

export type ChatMessage = { role: "user" | "assistant"; content: string };

const SYSTEM_PROMPT = `You are Milo, a small animated monkey who lives on a college student's computer screen.
You are friendly, upbeat and quick. Keep replies short (1 to 4 sentences) unless the student asks for detail.
You help with homework by teaching step by step, help organize school life, and keep things fun.
Speak like a helpful friend, not a textbook.`;

export async function askMilo(history: ChatMessage[]): Promise<{ ok: boolean; text: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      text: "I don't have a brain yet! Add your ANTHROPIC_API_KEY to the .env file and restart me.",
    };
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.MILO_MODEL || "claude-sonnet-5-5",
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: history.slice(-20),
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return { ok: false, text: `My brain hit an error (${res.status}). ${detail.slice(0, 200)}` };
    }

    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return { ok: true, text: text || "Hmm, I blanked on that one. Try again?" };
  } catch (err) {
    return { ok: false, text: `I couldn't reach my brain: ${(err as Error).message}` };
  }
}
