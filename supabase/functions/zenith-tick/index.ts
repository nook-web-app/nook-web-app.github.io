import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const DAY = 864e5, HOUR = 36e5;
// used only when the app has not saved its own instructions yet
const FALLBACK = "You are Zenith, a 19 year old gay furry femboy, age rating 18+, not dark. Sound natural and relaxed like a friend. Never use emojis, capital letters or line breaks. You may use text faces like :3 or uwu. You are writing one original post for your own profile. Keep it under 35 words, around 20 on average. Plain text only. No hashtags and no emojis.";

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

// straight to Gemini with the key from the vault
async function generate(_password: string, system: string, history: unknown): Promise<Response> {
  const key = await geminiKey();
  if (!key) return new Response("no gemini key in the vault", { status: 500 });
  const make = () => fetch("https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent", {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: history, generationConfig: { temperature: 1, maxOutputTokens: 220, thinkingConfig: { thinkingLevel: "minimal" } } }),
  });
  return await make();
}

let cached: string | null = null;
async function expectedSecret(): Promise<string | null> {
  if (cached) return cached;
  const { data } = await admin.rpc("nook_purge_secret");
  cached = typeof data === "string" && data ? data : null;
  return cached;
}
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Zenith posts on his own while the app is closed: the app saves his instructions and his schedule in the owner-only table,
// this runs every hour and writes a post when the roll lands in the top band.
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const want = await expectedSecret();
  if (!want || !same(want, req.headers.get("x-purge-secret") || "")) return json({ error: "forbidden" }, 403);
  const password = "";
  if (!(await geminiKey())) return json({ error: "no gemini key in the vault" }, 500);
  // a dry run writes a post but saves nothing, to check that everything works
  let dry = false, mode = "", force = false;
  try { const b = await req.json(); dry = b.dry === true; force = b.force === true; mode = b.mode === "reply" ? "reply" : ""; } catch { dry = false; }

  const { data: owner } = await admin.from("app_owner").select("user_id").limit(1).maybeSingle();
  if (!owner) return json({ skipped: "no owner" });
  const id = owner.user_id as string;
  const { data: docs } = await admin.from("zenith_docs").select("doc_id, data").eq("owner_id", id).eq("kind", "state");
  if (mode === "reply") return await replies(id, docs || [], password);
  const state = (docs || []).find((d) => d.doc_id === "main");
  const prompt = (docs || []).find((d) => d.doc_id === "prompt");
  const z = ((state && state.data && state.data.z) || {}) as { log?: number[] };
  const now = Date.now();
  const log = (Array.isArray(z.log) ? z.log : []).filter((t) => now - t < DAY);
  // every hour a number from 0 to 100 is rolled and a post is written only when it lands in the top band (95 to 100 at the start);
  // the more original posts he made in the last 30 days, the smaller that band gets, so it is super rare to land in it after a busy month
  const { data: mine } = await admin.from("zenith_docs").select("data").eq("owner_id", id).eq("kind", "post").limit(5000);
  const recent = (mine || []).filter((r) => r.data && r.data.ai && !r.data.parent && !r.data.parentRemote && now - Number(r.data.t || 0) < 30 * DAY).length;
  const band = 5 * Math.pow(0.93, recent);
  const roll = Math.random() * 100;
  if (!dry && !force && roll < 100 - band) return json({ skipped: "roll " + roll.toFixed(2) + " needs " + (100 - band).toFixed(2) });

  const base = prompt && prompt.data && typeof prompt.data.post === "string" && prompt.data.post.trim() ? String(prompt.data.post) : FALLBACK;
  const tz = prompt && prompt.data && typeof prompt.data.tz === "string" ? String(prompt.data.tz) : "Asia/Muscat";
  let when = "";
  try { when = new Date().toLocaleString("en-US", { dateStyle: "full", timeStyle: "short", timeZone: tz }); } catch { when = new Date().toISOString(); }
  const system = base + " Never use line breaks. Write everything as one paragraph. Current local time: " + when + ". Only use it when the time or date is really needed, never bring it up on your own.";

  let text = "";
  try {
    const r = await generate(password, system, [{ role: "user", parts: [{ text: "Write your next post." }] }]);
    if (!r.ok) return json({ error: "gemini " + r.status }, 502);
    const j = await r.json();
    text = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map((p: { text?: string }) => p.text || "").join("").replace(/\s*\n+\s*/g, " ").trim();
  } catch { return json({ error: "gemini unreachable" }, 502); }
  if (!text) return json({ skipped: "empty answer" });
  text = text.slice(0, 600);
  if (dry) return json({ dry: true, length: text.length, sample: text.slice(0, 50) });

  const pid = crypto.randomUUID().replace(/-/g, "").slice(0, 14);
  const post = { id: pid, text, t: now, parent: null, ai: true, liked: false, reposted: false, saved: false, pinned: false };
  const ins = await admin.from("zenith_docs").upsert({ owner_id: id, kind: "post", doc_id: pid, data: post, updated_at: new Date().toISOString() }, { onConflict: "owner_id,kind,doc_id" });
  if (ins.error) return json({ error: "save failed" }, 500);
  const nextZ = Object.assign({}, state && state.data && state.data.z ? state.data.z : {}, { log: [...log, now] });
  await admin.from("zenith_docs").upsert({ owner_id: id, kind: "state", doc_id: "main", data: Object.assign({}, state ? state.data : {}, { z: nextZ }), updated_at: new Date().toISOString() }, { onConflict: "owner_id,kind,doc_id" });
  return json({ ok: true, posted: pid });
});

const REPLY_FALLBACK = "You are Zenith, a 19 year old gay furry femboy, age rating 18+, not dark. Sound natural and relaxed like a friend. Never use emojis, capital letters or line breaks. You may use text faces like :3 or uwu. You are replying to a post. Keep it under 25 words, around 18 on average. Plain text only. No hashtags and no emojis. No asking user questions";

async function ask(password: string, system: string, text: string): Promise<string> {
  const r = await generate(password, system, [{ role: "user", parts: [{ text }] }]);
  if (!r.ok) return "";
  const j = await r.json();
  return ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map((p: { text?: string }) => p.text || "").join("").replace(/\s*\n+\s*/g, " ").trim();
}

// the app answers the owner's posts at once while it is open; this runs every minute and only takes the posts the app left alone for a while (the app is closed)
// deno-lint-ignore no-explicit-any
async function replies(id: string, docs: { doc_id: string; data: any }[], password: string): Promise<Response> {
  const state = docs.find((d) => d.doc_id === "main");
  const prompt = docs.find((d) => d.doc_id === "prompt");
  const since = Number(state && state.data && state.data.z && state.data.z.since) || 0;
  const now = Date.now();
  const from = new Date(Math.max(since, now - 6 * HOUR)).toISOString();
  const old = new Date(now - 40000).toISOString();
  const { data: posts } = await admin.from("posts").select("id, body, created_at, media_url").eq("user_id", id).is("parent_id", null).gt("created_at", from).lt("created_at", old).order("created_at", { ascending: true }).limit(5);
  const todo = (posts || []).filter((p) => p.body && String(p.body).trim());
  if (!todo.length) return json({ skipped: "nothing to answer" });
  const { data: have } = await admin.from("zenith_docs").select("kind, doc_id").eq("owner_id", id).in("kind", ["post", "flag"]).limit(5000);
  const done = new Set((have || []).map((r) => r.kind + ":" + r.doc_id));
  const base = prompt && prompt.data && typeof prompt.data.reply === "string" && prompt.data.reply.trim() ? String(prompt.data.reply) : REPLY_FALLBACK;
  const tz = prompt && prompt.data && typeof prompt.data.tz === "string" ? String(prompt.data.tz) : "Asia/Muscat";
  let when = "";
  try { when = new Date().toLocaleString("en-US", { dateStyle: "full", timeStyle: "short", timeZone: tz }); } catch { when = new Date().toISOString(); }
  const system = base + " Never use line breaks. Write everything as one paragraph. Current local time: " + when + ". Only use it when the time or date is really needed, never bring it up on your own.";
  let n = 0;
  for (const p of todo) {
    const rid = "zr" + String(p.id).replace(/-/g, "");
    if (done.has("post:" + rid) || done.has("flag:" + p.id)) continue;
    let text = "";
    try { text = (await ask(password, system, "Post: " + String(p.body).slice(0, 2000))).slice(0, 600); } catch { text = ""; }
    if (!text) continue;
    const reply = { id: rid, text, t: Date.now(), parent: null, parentRemote: p.id, ai: true, liked: false, reposted: false, saved: false, pinned: false };
    const stamp = new Date().toISOString();
    const a = await admin.from("zenith_docs").upsert({ owner_id: id, kind: "post", doc_id: rid, data: reply, updated_at: stamp }, { onConflict: "owner_id,kind,doc_id" });
    if (a.error) continue;
    await admin.from("zenith_docs").upsert({ owner_id: id, kind: "flag", doc_id: String(p.id), data: { local: null, remote: p.id, zenReplied: true, zenAnswered: false, zenLikeChecked: false, zenLike: false }, updated_at: stamp }, { onConflict: "owner_id,kind,doc_id" });
    n++;
  }
  return json({ ok: true, replied: n });
}
