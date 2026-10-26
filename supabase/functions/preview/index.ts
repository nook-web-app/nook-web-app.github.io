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

// link card info for the app: needs a signed in user, takes { url }, answers { title, description, image, site }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u, error: ue } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null }, error: true };
  if (ue || !u || !u.user) return json({ error: "not signed in" }, 401);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url || url.length > 2000) return json({ error: "bad url" }, 400);
  const p = await pagePreview(url);
  if (!p) return json({ error: "no preview" }, 404);
  return json(p);
});
