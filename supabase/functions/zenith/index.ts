import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const WORKER = "https://ai-nook-chat.haythamzoubi960-322.workers.dev/";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// the Gemini key is saved in the database vault (secret name gemini_api_key) or as an edge secret; it is looked up once a minute at most
let keyCache = { v: Deno.env.get("GEMINI_API_KEY") || "", at: 0 };
async function geminiKey(): Promise<string> {
  if (keyCache.v && Deno.env.get("GEMINI_API_KEY")) return keyCache.v;
  if (Date.now() - keyCache.at < 60000) return keyCache.v;
  const { data } = await admin.rpc("nook_gemini_key");
  keyCache = { v: typeof data === "string" ? data : "", at: Date.now() };
  return keyCache.v;
}
const MODEL = Deno.env.get("ZENITH_MODEL") || "gemini-2.5-flash";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// an owner check that was already done for this login is remembered for a few minutes, so a message does not wait for it again
const okUntil = new Map<string, number>();

// with a Gemini key saved as a secret the answer comes straight from Gemini, with the thinking switched off for speed; without it the old worker is used
async function gemini(key: string, system: unknown, history: unknown, stream: boolean): Promise<Response> {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + (stream ? ":streamGenerateContent?alt=sse" : ":generateContent");
  const make = (think: boolean) => fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: String(system || "") }] },
      contents: history,
      generationConfig: { temperature: 1, maxOutputTokens: 220, ...(think ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
    }),
  });
  let r = await make(true);
  if (r.status === 400) r = await make(false);
  return r;
}

// the app owner talks to Zenith through here, so the password only ever lives in the ZENITH_PASSWORD secret
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "not signed in" }, 401);
  let body: { system?: unknown; history?: unknown; stream?: unknown } = {};
  const parse = req.json().then((b) => { body = b; return true; }, () => false);
  if (!((okUntil.get(jwt) || 0) > Date.now())) {
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data.user) return json({ error: "not signed in" }, 401);
    const owner = await admin.from("app_owner").select("user_id").eq("user_id", data.user.id).maybeSingle();
    if (owner.error || !owner.data) return json({ error: "not allowed" }, 403);
    if (okUntil.size > 50) okUntil.clear();
    okUntil.set(jwt, Date.now() + 5 * 60000);
  }
  if (!(await parse) || !Array.isArray(body.history)) return json({ error: "bad request" }, 400);

  try {
    let up: Response;
    const key = await geminiKey();
    if (key) up = await gemini(key, body.system, body.history, body.stream === true);
    else {
      const password = Deno.env.get("ZENITH_PASSWORD");
      if (!password) return json({ error: "no ZENITH_PASSWORD secret" }, 500);
      up = await fetch(WORKER, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, system: body.system, history: body.history, stream: body.stream === true }),
      });
    }
    return new Response(up.body, { status: up.status, headers: { ...cors, "Content-Type": up.headers.get("content-type") || "application/json" } });
  } catch (_e) {
    return json({ error: "could not reach Zenith" }, 502);
  }
});
