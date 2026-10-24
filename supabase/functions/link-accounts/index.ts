import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// Links accounts to each other. Every account in the call has to prove itself with its own live login (an access token),
// so nobody can link an account they do not hold. All of them end up linked to each other, in both directions.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body: { tokens?: unknown };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: me, error } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null }, error: true };
  if (error || !me || !me.user) return json({ error: "not_signed_in" }, 401);
  const ids = new Set<string>([me.user.id]);
  const tokens = Array.isArray(body.tokens) ? body.tokens.slice(0, 9) : [];
  for (const t of tokens) {
    if (typeof t !== "string" || t.length > 4000) continue;
    const { data } = await admin.auth.getUser(t);
    if (data && data.user) ids.add(data.user.id);
  }
  const { data: have } = await admin.from("accounts").select("id").in("id", [...ids]);
  const list = (have || []).map((r) => r.id as string);
  if (list.length < 2) return json({ ok: true, linked: 0 });
  const rows: { a: string; b: string }[] = [];
  for (const a of list) for (const b of list) if (a !== b) rows.push({ a, b });
  const up = await admin.from("account_links").upsert(rows, { onConflict: "a,b", ignoreDuplicates: true });
  if (up.error) return json({ error: "server" }, 500);
  return json({ ok: true, linked: list.length });
});
