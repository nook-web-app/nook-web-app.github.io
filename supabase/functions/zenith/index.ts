import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchImage } from "../_shared/preview.ts";
// Zenith is the name of the owner-only AI; the moderation AI is called Aegis

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
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
const MODEL = Deno.env.get("ZENITH_MODEL") || "gemini-3.5-flash-lite";

// link preview pictures are fetched here, so the phone never has to download them; https only, no addresses inside a network, small pictures only
const PIC_TYPES = ["image/jpeg", "image/png", "image/webp"];
async function fetchPic(u: string): Promise<{ inline_data: { mime_type: string; data: string } } | null> {
  // the shared fetcher also resolves the name and refuses private addresses
  const got = await fetchImage(u, PIC_TYPES, 4 * 1024 * 1024);
  if (!got) return null;
  let bin = "";
  for (let i = 0; i < got.bytes.length; i += 0x8000) bin += String.fromCharCode(...got.bytes.subarray(i, i + 0x8000));
  return { inline_data: { mime_type: got.type, data: btoa(bin) } };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// an owner check that was already done for this login is remembered for a few minutes, so a message does not wait for it again
const okUntil = new Map<string, number>();

// the answer comes straight from Gemini; when a model has no quota left (429) or is overloaded the next one in the list answers
const MODELS = [MODEL, "gemini-3.1-flash-lite"];
async function gemini(key: string, system: unknown, history: unknown, stream: boolean): Promise<Response> {
  let last: Response | null = null;
  for (const model of MODELS) {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + (stream ? ":streamGenerateContent?alt=sse" : ":generateContent");
    const call = (think: boolean) => fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      signal: AbortSignal.timeout(50000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: String(system || "") }] },
        contents: history,
        generationConfig: { temperature: 1, maxOutputTokens: 220, ...(think ? { thinkingConfig: { thinkingLevel: "minimal" } } : {}) },
      }),
    });
    let r = await call(true);
    if (r.status === 400) r = await call(false);
    if (r.status === 429 || r.status >= 500) { last = r; continue; }
    return r;
  }
  return last as Response;
}

// the app owner talks to Zenith through here, so the Gemini key never reaches the phone
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "not signed in" }, 401);
  let body: { system?: unknown; history?: unknown; stream?: unknown; imageUrls?: unknown; action?: unknown; avatar?: unknown; theme?: unknown } = {};
  const parse = req.json().then((b) => { body = b; return true; }, () => false);
  if (!((okUntil.get(jwt) || 0) > Date.now())) {
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data.user) return json({ error: "not signed in" }, 401);
    const owner = await admin.from("app_owner").select("user_id").eq("user_id", data.user.id).maybeSingle();
    if (owner.error || !owner.data) return json({ error: "not allowed" }, 403);
    if (okUntil.size > 50) okUntil.clear();
    okUntil.set(jwt, Date.now() + 5 * 60000);
  }
  await parse;
  // the owner can change how his public account looks, and ask for his answers now instead of at the next minute
  if (body.action === "profile") {
    const base = Deno.env.get("SUPABASE_URL")! + "/storage/v1/object/public/media/";
    const src = typeof body.avatar === "string" && body.avatar.startsWith(base) && body.avatar.length < 400 ? body.avatar : null;
    const bsrc = typeof body.banner === "string" && body.banner.startsWith(base) && body.banner.length < 400 ? body.banner : null;
    const { data: za } = await admin.from("accounts").select("id, avatar, banner").eq("username", "zenith").maybeSingle();
    if (!za) return json({ ok: false, why: "no account yet" });
    // an account may only show pictures from its own folder, so the owner's file is copied into his (a copy inside storage,
    // so the picture never travels through this function)
    const take = async (from: string | null, tag: string): Promise<string | null | undefined> => {
      if (!from) return null;
      let spath = "";
      try { spath = decodeURIComponent(from.slice(base.length).split("?")[0]); } catch { return undefined; }
      const dest = za.id + "/zenith-" + tag + "-" + Date.now() + ".jpg";
      const up = await admin.storage.from("media").copy(spath, dest);
      return up.error ? undefined : base + dest;
    };
    const avatar = await take(src, "a");
    if (avatar === undefined) return json({ ok: false, why: "could not save the picture" });
    const banner = await take(bsrc, "b");
    if (banner === undefined) return json({ ok: false, why: "could not save the banner" });
    const upd = await admin.from("accounts").update({ avatar, banner, banner_theme: body.theme === "avatar" && (banner || avatar) ? "avatar" : null }).eq("id", za.id);
    // the previous copies are removed once the new ones are saved, so the bucket does not grow with every save
    if (!upd.error) {
      for (const [old, now] of [[za.avatar, avatar], [za.banner, banner]] as [unknown, string | null][]) {
        if (typeof old === "string" && old !== now && old.startsWith(base + za.id + "/zenith-")) {
          try { await admin.storage.from("media").remove([decodeURIComponent(old.slice(base.length).split("?")[0])]); } catch { /* an old file left behind is harmless */ }
        }
      }
    }
    return json({ ok: !upd.error, why: upd.error ? upd.error.message : "" });
  }
  if (body.action === "tick") {
    const { data: secret } = await admin.rpc("nook_purge_secret");
    if (typeof secret !== "string" || !secret) return json({ error: "no secret" }, 500);
    const r = await fetch(Deno.env.get("SUPABASE_URL")! + "/functions/v1/zenith-tick", { method: "POST", headers: { "content-type": "application/json", "x-purge-secret": secret }, body: JSON.stringify({ mode: "reply" }), signal: AbortSignal.timeout(50000) }).catch(() => null);
    return json(r ? await r.json().catch(() => ({ ok: false })) : { ok: false });
  }
  if (!Array.isArray(body.history)) return json({ error: "bad request" }, 400);

  try {
    const key = await geminiKey();
    if (!key) return json({ error: "no gemini key in the vault" }, 500);
    // the pictures of a link join the last message
    const urls = Array.isArray(body.imageUrls) ? body.imageUrls.filter((u) => typeof u === "string").slice(0, 2) as string[] : [];
    const last = (body.history as { parts?: unknown[] }[])[(body.history as unknown[]).length - 1];
    if (urls.length && last && Array.isArray(last.parts)) {
      const pics = (await Promise.all(urls.map(fetchPic))).filter(Boolean);
      last.parts.push(...pics);
    }
    const up = await gemini(key, body.system, body.history, body.stream === true);
    return new Response(up.body, { status: up.status, headers: { ...cors, "Content-Type": up.headers.get("content-type") || "application/json" } });
  } catch (_e) {
    return json({ error: "could not reach Zenith" }, 502);
  }
});
