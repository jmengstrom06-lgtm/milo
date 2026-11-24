// Google sign-in for Milo, done on the server so the Google client SECRET never ships inside the app.
// The app keeps the student's tokens on their Mac; this only trades a sign-in code for tokens and refreshes them.
// Routes (POST unless noted):
//   GET  /milo-google/config   -> { configured, clientId }        (client ID is public by design)
//   POST /milo-google/token    { code, code_verifier, redirect_uri } -> Google's token response
//   POST /milo-google/refresh  { refresh_token }                       -> Google's token response
// Secrets (Supabase → Edge Functions → Secrets): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const ID = () => (Deno.env.get("GOOGLE_CLIENT_ID") ?? "").trim();
const SECRET = () => (Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "").trim();

const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

async function google(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: ID(), client_secret: SECRET(), ...params }),
  });
  const body = await res.json().catch(() => ({}));
  // pass Google's answer through (tokens or its error), never the secret
  return json(res.status, body);
}

Deno.serve(async (req: Request) => {
  const route = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  if (route === "config") return json(200, { configured: !!ID() && !!SECRET(), clientId: ID() });
  if (req.method !== "POST") return json(405, { error: "post_only" });
  if (!ID() || !SECRET()) return json(503, { error: "not_configured", text: "Google sign-in isn't set up on Milo's server yet." });

  // only signed-in Milo students can use this (not an open proxy)
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return json(401, { error: "signed_out", text: "Sign in to Milo first." });

  const b = await req.json().catch(() => null);
  try {
    if (route === "token") {
      const code = typeof b?.code === "string" ? b.code : "";
      const verifier = typeof b?.code_verifier === "string" ? b.code_verifier : "";
      const redirect = typeof b?.redirect_uri === "string" ? b.redirect_uri : "";
      // the app's sign-in page only ever runs on this Mac
      if (!code || !verifier || !/^http:\/\/127\.0\.0\.1:\d{2,5}\/google$/.test(redirect)) return json(400, { error: "bad_request" });
      return await google({ code, code_verifier: verifier, redirect_uri: redirect, grant_type: "authorization_code" });
    }
    if (route === "refresh") {
      const rt = typeof b?.refresh_token === "string" ? b.refresh_token : "";
      if (!rt || rt.length > 2000) return json(400, { error: "bad_request" });
      return await google({ refresh_token: rt, grant_type: "refresh_token" });
    }
    return json(404, { error: "no_route" });
  } catch (e) {
    console.error(route, (e as Error).message);
    return json(500, { error: "server_error" });
  }
});
