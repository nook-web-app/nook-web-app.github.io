import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const WORKER = "https://ai-nook-chat.haythamzoubi960-322.workers.dev/";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// the app owner talks to Zenith through here, so the password only ever lives in the ZENITH_PASSWORD secret
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "not signed in" }, 401);
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) return json({ error: "not signed in" }, 401);
  const owner = await admin.from("app_owner").select("user_id").eq("user_id", data.user.id).maybeSingle();
  if (owner.error || !owner.data) return json({ error: "not allowed" }, 403);

  const password = Deno.env.get("ZENITH_PASSWORD");
  if (!password) return json({ error: "no ZENITH_PASSWORD secret" }, 500);
  let body: { system?: unknown; history?: unknown; stream?: unknown } = {};
  try { body = await req.json(); } catch { return json({ error: "bad request" }, 400); }

  try {
    const up = await fetch(WORKER, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password, system: body.system, history: body.history, stream: body.stream === true }),
    });
    return new Response(up.body, { status: up.status, headers: { ...cors, "Content-Type": up.headers.get("content-type") || "application/json" } });
  } catch (e) {
    return json({ error: "could not reach Zenith" }, 502);
  }
});
