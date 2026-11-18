// Keeps Milo from flooding ElevenLabs. ElevenLabs answers 429 ("too many requests") when an account
// has too many calls in flight, so every call goes through this queue: at most MAX at once,
// listening (high priority) jumps ahead of voice prefetching, and 429s are retried with backoff.

const MAX = Number(process.env.ELEVENLABS_CONCURRENCY || 2);
let active = 0;
const queue: { pri: number; start: () => void }[] = [];

function pump() {
  while (active < MAX && queue.length) {
    queue.sort((a, b) => b.pri - a.pri);
    const next = queue.shift()!;
    active++;
    next.start();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run fetch() through the queue. `pri`: 2 = listening, 1 = speaking now, 0 = prefetch. */
export function limited(pri: number, doFetch: () => Promise<Response>): Promise<Response> {
  return new Promise((resolve, reject) => {
    queue.push({
      pri,
      start: async () => {
        try {
          let res = await doFetch();
          for (let attempt = 0; res.status === 429 && attempt < 4; attempt++) {
            await sleep(500 * 2 ** attempt + Math.random() * 250);
            res = await doFetch();
          }
          resolve(res);
        } catch (e) {
          reject(e);
        } finally {
          active--;
          pump();
        }
      },
    });
    pump();
  });
}
