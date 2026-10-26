import { createClient } from "npm:@supabase/supabase-js@2";
import { pagePreview } from "../_shared/preview.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const hits = new Map<string, number[]>();
// a verified token is trusted for a few minutes, and a finished preview is shared for ten, so repeated asks cost no network
const okTok = new Map<string, { id: string; until: number }>();
const seen = new Map<string, { until: number; p: unknown }>();
// link card info for the app: needs a signed in user, takes { url }, answers { title, description, image, site }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  let uid = "";
  const tok = okTok.get(jwt);
  if (jwt && tok && tok.until > Date.now()) uid = tok.id;
  else {
    const { data: u, error: ue } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null }, error: true };
    if (ue || !u || !u.user) return json({ error: "not signed in" }, 401);
    uid = u.user.id;
    if (okTok.size > 200) okTok.clear();
    okTok.set(jwt, { id: uid, until: Date.now() + 5 * 60000 });
  }
  // 20 a minute for each person, like focus
  const now = Date.now();
  const mine = (hits.get(uid) || []).filter((t) => now - t < 60000);
  if (mine.length >= 20) return json({ error: "slow down" }, 429);
  mine.push(now);
  hits.set(uid, mine);
  if (hits.size > 500) hits.clear();
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url || url.length > 2000) return json({ error: "bad url" }, 400);
  const hit = seen.get(url);
  if (hit && hit.until > now) return json(hit.p);
  const p = await pagePreview(url);
  if (!p) return json({ error: "no preview" }, 404);
  if (seen.size > 200) seen.clear();
  seen.set(url, { until: now + 10 * 60000, p });
  return json(p);
});
