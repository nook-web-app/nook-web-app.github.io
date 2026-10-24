import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MAX_TRIES = 5;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
const iso = (t: unknown) => new Date(String(t)).toISOString();

// the only place that checks a password for the app: every try is counted per email, 5 tries are free, then the waits grow 45 minutes, 90 minutes, 3 hours ... up to 48 hours
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body: { email?: unknown; password?: unknown; check?: unknown };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }

  let email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  // check mode: a signed in person proves their current password, always for their own email
  const check = body.check === true;
  if (check) {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data, error } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null }, error: true };
    if (error || !data || !data.user || !data.user.email) return json({ error: "not_signed_in" }, 401);
    email = data.user.email.trim().toLowerCase();
  }
  if (!email) return json({ error: "no_email" }, 400);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "bad_email" }, 400);
  if (!password) return json({ error: "no_password" }, 400);
  if (password.length > 200) return json({ error: "wrong_password", left: 0 }, 401);

  const key = "e:" + email;
  const gate = await admin.rpc("nook_login_gate", { p_key: key, p_max: MAX_TRIES });
  if (gate.error) return json({ error: "server" }, 500);
  if (gate.data) return json({ error: "locked", until: iso(gate.data) }, 429);

  const miss = async (error: string, status: number) => {
    const f = await admin.rpc("nook_login_fail", { p_key: key, p_max: MAX_TRIES });
    const row = Array.isArray(f.data) ? f.data[0] : f.data;
    if (row && row.locked_until) return json({ error: "locked", until: iso(row.locked_until) }, 429);
    return json({ error, left: Math.max(0, MAX_TRIES - (row ? row.used : MAX_TRIES)) }, status);
  };

  const found = await admin.rpc("nook_find_user", { ident: email });
  if (found.error) return json({ error: "server" }, 500);
  if (!found.data) return await miss("no_account", 404);

  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) {
    const code = String((error as { code?: string }).code || "");
    // a banned or unconfirmed account got its password right, so that is not a wrong try
    if (code === "user_banned" || /banned/i.test(error.message || "")) { await admin.rpc("nook_login_ok", { p_key: key }); return json({ error: "banned" }, 403); }
    if (code === "email_not_confirmed") { await admin.rpc("nook_login_ok", { p_key: key }); return json({ error: "not_confirmed" }, 403); }
    if (code === "invalid_credentials" || (error as { status?: number }).status === 400) return await miss("wrong_password", 401);
    return json({ error: "server" }, 500);
  }
  await admin.rpc("nook_login_ok", { p_key: key });
  if (check) return json({ ok: true });
  return json({ session: { access_token: data.session!.access_token, refresh_token: data.session!.refresh_token } });
});
