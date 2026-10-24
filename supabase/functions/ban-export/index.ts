import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ARCHIVE = "ban-archive";
const BUCKETS = ["media", "dm-media"];
const MAX_FILES = 1000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

async function listFolder(folder: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; out.length < MAX_FILES; offset += 100) {
    const { data, error } = await admin.storage.from(ARCHIVE).list(folder, { limit: 100, offset });
    if (error) throw error;
    const rows = data || [];
    rows.forEach((r) => { if (r.id) out.push(folder + "/" + r.name); });
    if (rows.length < 100) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body: { email?: unknown; password?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  if (typeof body.email !== "string" || typeof body.password !== "string") return json({ error: "Enter your email and password" }, 400);

  const { data: chk, error: le } = await admin.rpc("nook_ban_check", { p_email: body.email, p_password: body.password });
  if (le) return json({ error: "Something went wrong. Try again later." }, 500);
  const res = Array.isArray(chk) ? chk[0] : chk;
  if (res && res.locked_until) return json({ error: "locked", until: new Date(res.locked_until).toISOString() }, 429);
  const uid = res ? res.uid : null;
  if (!uid) return json({ error: "Wrong email or password, or there is no backup for this account." }, 401);

  const { data: row, error: re } = await admin.from("ban_archive").select("data, expires_at, banned_at").eq("user_id", uid).maybeSingle();
  if (re || !row) return json({ error: "There is no backup for this account." }, 404);

  const files: { bucket: string; name: string; url: string }[] = [];
  try {
    for (const bucket of BUCKETS) {
      const paths = await listFolder(uid + "/" + bucket);
      for (let i = 0; i < paths.length; i += 100) {
        const chunk = paths.slice(i, i + 100);
        const { data: signed, error: se } = await admin.storage.from(ARCHIVE).createSignedUrls(chunk, 3600);
        if (se) throw se;
        (signed || []).forEach((s, k) => { if (s.signedUrl) files.push({ bucket, name: chunk[k].slice((uid + "/" + bucket + "/").length), url: s.signedUrl }); });
      }
    }
  } catch (_e) {
    return json({ error: "Could not read the saved files. Try again later." }, 500);
  }
  return json({ expires_at: row.expires_at, banned_at: row.banned_at, data: row.data, files });
});
