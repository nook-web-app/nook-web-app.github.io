import { createClient } from "npm:@supabase/supabase-js@2";
// Google can only sign in to an account that already exists: a login that Google just made on its own is removed again

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "not signed in" }, 401);
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) return json({ error: "not signed in" }, 401);
  const user = data.user;
  const acc = await admin.from("accounts").select("id").eq("id", user.id).maybeSingle();
  if (acc.error) return json({ error: "try again" }, 500);
  if (acc.data) return json({ ok: true });
  // no Nook account behind this login: only a login made by Google alone is removed, never one that is in the middle of a sign up
  const ids = user.identities || [];
  const googleOnly = ids.length > 0 && ids.every((i) => i.provider === "google");
  const fresh = Date.now() - Date.parse(user.created_at) < 10 * 60000;
  if (googleOnly && fresh) await admin.auth.admin.deleteUser(user.id);
  return json({ ok: false, error: "no_account" });
});
