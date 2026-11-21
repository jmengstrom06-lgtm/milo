// Math and science checker: before Milo gives a numeric answer, he works it out in code and compares.
// The AI writes a tiny program; it runs here in a locked box (no files, no network, 300 ms max).
// If the program and the answer disagree, the lesson is redone with the computed value as a hint.

import vm from "node:vm";
import { log as bb } from "./blackbox";
import { callTool, persona } from "./brain";

/** Run untrusted math code safely: only Math and plain JS, no require, no timers, short time limit. */
export function runMath(code: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    const box = vm.createContext({ Math, Number, parseFloat, parseInt, isFinite, Array, Object, JSON }, { codeGeneration: { strings: false, wasm: false } });
    const value = vm.runInContext(`"use strict";(function(){${code}\n})()`, box, { timeout: 300 });
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Numbers in a text answer: "x = 3.5", "about 12,400", "1/4" -> [3.5, 12400, 0.25]. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  const t = text.replace(/(\d),(?=\d{3}\b)/g, "$1");
  for (const m of t.matchAll(/(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/g)) if (+m[2]) out.push(+m[1] / +m[2]);
  for (const m of t.matchAll(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)) out.push(+m[0]);
  return out.filter((n) => isFinite(n));
}
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-6, 0.005 * Math.max(Math.abs(a), Math.abs(b))); // within 0.5%

/** Does this look like a problem with a number for an answer? */
export const isQuantitative = (problem: string, answer: string) => /\d/.test(answer) && /[\d=+\-*/^√%]|solve|calculate|compute|find|how many|how much|probability|mean|average|derivative|integral|velocity|mass|molar|ph\b/i.test(problem + " " + answer);

const COMPUTE = {
  name: "compute",
  description: "A tiny JavaScript program that computes the answer.",
  input_schema: {
    type: "object",
    properties: {
      code: { type: "string", description: "Plain JavaScript function body that RETURNS the final answer as a number (or an array of numbers for several answers). Only Math and arithmetic, no input, no console. E.g. 'const p = 0.3; return 1 - Math.pow(1 - p, 4);'" },
      checkable: { type: "boolean", description: "False if the answer isn't a number that code can compute (a proof, an explanation, a graph)." },
    },
    required: ["code", "checkable"],
  },
};

export type MathVerdict = { checked: boolean; agree: boolean; computed?: number[] };

/** Work the problem out in code and compare it to Milo's answer. */
export async function checkMath(problem: string, answer: string, jpeg?: string): Promise<MathVerdict> {
  if (!isQuantitative(problem, answer)) return { checked: false, agree: true };
  const r = await callTool<{ code: string; checkable: boolean }>(
    {
      max_tokens: 900,
      system: `${persona()}\nYou check homework math by writing code. Read the problem and write a short JavaScript function body that computes the final numeric answer from the problem's own numbers. Work it out from scratch; don't copy the proposed answer.`,
      tools: [COMPUTE],
      tool_choice: { type: "auto" },
      messages: [
        {
          role: "user",
          content: [
            ...(jpeg ? [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg } }] : []),
            { type: "text", text: `${jpeg ? "The problem is on the screen (the one this lesson is about). " : ""}Problem / lesson: ${problem.slice(0, 3000)}\n\nProposed answer: ${answer.slice(0, 600)}` },
          ],
        },
      ],
    },
    COMPUTE.name
  );
  if (!r.ok || !r.data.checkable || !r.data.code) return { checked: false, agree: true };
  const run = runMath(r.data.code);
  if (!run.ok) {
    bb("mathcheck", "code_failed", { error: run.error });
    return { checked: false, agree: true };
  }
  const computed = (Array.isArray(run.value) ? run.value : [run.value]).map(Number).filter((n) => isFinite(n));
  if (!computed.length) return { checked: false, agree: true };
  const said = numbersIn(answer);
  const agree = computed.every((c) => said.some((s) => close(s, c)));
  bb("mathcheck", "result", { agree, computed: computed.slice(0, 4), said: said.slice(0, 6) });
  return { checked: true, agree, computed };
}
