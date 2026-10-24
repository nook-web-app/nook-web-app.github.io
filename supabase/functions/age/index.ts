import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ADULT = 18;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function ageOf(birth: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birth);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d)) age--;
  return age >= 0 && age <= 120 ? age : null;
}

// a locked account answers one question; an adult answer opens it, any other answer bans it (the data stays 30 days for download)
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u, error: ue } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null }, error: true };
  if (ue || !u || !u.user) return json({ error: "not signed in" }, 401);
  const id = u.user.id;
  const { data: a } = await admin.from("accounts").select("age_hold").eq("id", id).maybeSingle();
  if (!a) return json({ error: "no account" }, 404);
  if (String(body.action || "") !== "answer") return json({ hold: !!a.age_hold });
  if (!a.age_hold) return json({ state: "passed" });
  const age = ageOf(String(body.birth || ""));
  if (age === null) return json({ error: "Enter a real date." }, 400);
  if (age >= ADULT) {
    await admin.from("accounts").update({ age_hold: false, age_verified: true }).eq("id", id).eq("age_hold", true);
    return json({ state: "passed" });
  }
  await admin.auth.admin.updateUserById(id, { ban_duration: "876000h" });
  return json({ state: "banned" });
});
