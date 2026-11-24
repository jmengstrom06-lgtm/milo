# Milo backend functions (Supabase Edge Functions, project ptfvptkhzxnpvdhgnfcp)

Copies of what's deployed, so changes are reviewed like the app.

- `milo-google/` – Google sign-in on the server. The Google client SECRET lives only in Supabase secrets
  (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`); the app gets the public client ID from `/config` and trades
  codes / refreshes tokens through `/token` and `/refresh`. Signed-in Milo users only.
