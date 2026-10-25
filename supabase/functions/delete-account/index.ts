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

// deleting an account hides it and keeps everything for 30 days; signing in again in that time brings it back,
// and a nightly job deletes the accounts whose 30 days are over (nook_purge_deleted)
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "not signed in" }, 401);
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) return json({ error: "not signed in" }, 401);
  const id = data.user.id;

  // a login without an account row (a signup that did not finish) has nothing to keep, so it goes at once
  const row = await admin.from("accounts").select("id").eq("id", id).maybeSingle();
  if (!row.error && !row.data) {
    const del = await admin.auth.admin.deleteUser(id);
    if (del.error) return json({ error: "could not delete login: " + del.error.message }, 500);
    return json({ ok: true });
  }
  const hide = await admin.rpc("nook_schedule_delete_user", { p_user: id });
  if (hide.error) return json({ error: "could not delete the account: " + hide.error.message }, 500);
  // every other phone is signed out too
  try { await admin.auth.admin.signOut(jwt, "global"); } catch (_e) { /* the account is already hidden */ }
  return json({ ok: true });
});
