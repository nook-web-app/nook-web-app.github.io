import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const DAY = 864e5, HOUR = 36e5;
// he only reacts to posts made after this moment, never to what was already there
const ROLLOUT = Date.parse("2026-10-26T00:38:00Z");
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

// straight to Gemini with the key from the vault; a model without quota hands over to the next one
const MODELS = [MODEL, "gemini-3.1-flash-lite"];
async function generate(_password: string, system: string, history: unknown): Promise<Response> {
  const key = await geminiKey();
  if (!key) return new Response("no gemini key in the vault", { status: 500 });
  let last: Response | null = null;
  for (const model of MODELS) {
    const call = (think: boolean) => fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: history, generationConfig: { temperature: 1, maxOutputTokens: 220, ...(think ? { thinkingConfig: { thinkingLevel: "minimal" } } : {}) } }),
    });
    let r = await call(true);
    if (r.status === 400) r = await call(false);
    if (r.status === 429 || r.status >= 500) { last = r; continue; }
    return r;
  }
  return last as Response;
}

// link preview pictures are fetched here, so the phone never has to download them; https only, no addresses inside a network, small pictures only
const PIC_TYPES = ["image/jpeg", "image/png", "image/webp"];
function publicHttps(u: string): URL | null {
  try {
    const x = new URL(u);
    const h = x.hostname.toLowerCase();
    if (x.protocol !== "https:" || (x.port && x.port !== "443")) return null;
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.includes(":") || /^[\d.]+$/.test(h)) return null;
    return x;
  } catch { return null; }
}
async function fetchPic(u: string): Promise<{ inline_data: { mime_type: string; data: string } } | null> {
  const x = publicHttps(u);
  if (!x) return null;
  try {
    const r = await fetch(x, { signal: AbortSignal.timeout(6000), headers: { accept: "image/*", "user-agent": "Mozilla/5.0 (compatible; NookPreview/1.0)" } });
    if (!r.ok || !publicHttps(r.url)) return null;
    const type = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!PIC_TYPES.includes(type)) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (!buf.length || buf.length > 4 * 1024 * 1024) return null;
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { inline_data: { mime_type: type, data: btoa(bin) } };
  } catch { return null; }
}

// the page title, description and picture of the first link in a post, the same service the app uses for its link cards
async function linkInfo(body: string): Promise<{ note: string; pics: unknown[] }> {
  const m = /https?:\/\/[^\s<>"]+/i.exec(body);
  if (!m) return { note: "", pics: [] };
  try {
    const r = await fetch("https://api.microlink.io/?url=" + encodeURIComponent(m[0].replace(/[.,!?)\]]+$/, "")), { signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    if (j.status !== "success" || !j.data) return { note: "", pics: [] };
    const bits = [j.data.title, j.data.description].filter(Boolean).join(" - ").slice(0, 400);
    const pic = (j.data.image && j.data.image.url) || "";
    const got = pic ? await fetchPic(pic) : null;
    return { note: bits ? "\n(The link preview says: " + bits + ")" : "", pics: got ? [got] : [] };
  } catch { return { note: "", pics: [] }; }
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

// Zenith is a real account (@zenith) whose posts and replies everybody can see. Only the owner can talk to him:
// he answers the owner's posts and the owner's replies in his threads, and reacts to other people's posts on his own now and then.
let zenId = "";
async function ensureZenith(): Promise<string> {
  if (zenId) return zenId;
  const { data } = await admin.from("accounts").select("id").eq("username", "zenith").maybeSingle();
  if (data) { zenId = data.id as string; return zenId; }
  const made = await admin.auth.admin.createUser({ email: "zenith@nook.invalid", password: crypto.randomUUID() + crypto.randomUUID(), email_confirm: true });
  if (made.error || !made.data.user) throw new Error("could not make the Zenith account");
  const id = made.data.user.id;
  const ins = await admin.from("accounts").insert({ id, username: "zenith", display_name: "Zenith", bio: "An AI that lives on Nook. Not a person.", age_verified: true });
  if (ins.error) throw new Error("could not save the Zenith account");
  zenId = id;
  return id;
}

// the AI never reads real private values: emails, phone numbers and secrets are swapped for a label before anything is sent
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?<![\w.])\+?\d[\d\s().-]{7,}\d(?!\w)/g;
function mask(t: string): string {
  return t
    .replace(EMAIL_RE, "[email]")
    .replace(/\b(password|passcode|passwd|pwd|pin|token|api[ _-]?key|secret)\b(\s*(?:is|are|:|=|->)\s*)\S+/gi, "$1$2[secret]")
    .replace(PHONE_RE, (m) => (m.replace(/\D/g, "").length >= 9 ? "[phone]" : m))
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[secret]");
}

const REPLY_FALLBACK = "You are Zenith, a 19 year old gay furry femboy, age rating 18+, not dark. Sound natural and relaxed like a friend. Never use emojis, capital letters or line breaks. You may use text faces like :3 or uwu. You are replying to a post. Keep it under 25 words, around 18 on average. Plain text only. No hashtags and no emojis. No asking user questions";
const LIKE_SYSTEM = "Answer with only YES or NO. Answer YES only if you genuinely like this post.";

async function ask(system: string, text: string, extra: unknown[] = []): Promise<string> {
  const r = await generate("", system, [{ role: "user", parts: [{ text: mask(text) }, ...extra] }]);
  if (!r.ok) return "";
  const j = await r.json();
  return ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text || "").join("").replace(/\s*\n+\s*/g, " ").trim();
}

// deno-lint-ignore no-explicit-any
function promptFor(docs: { doc_id: string; data: any }[], kind: "post" | "reply"): string {
  const prompt = docs.find((d) => d.doc_id === "prompt");
  const base = prompt && prompt.data && typeof prompt.data[kind] === "string" && prompt.data[kind].trim() ? String(prompt.data[kind]) : (kind === "post" ? FALLBACK : REPLY_FALLBACK);
  const tz = prompt && prompt.data && typeof prompt.data.tz === "string" ? String(prompt.data.tz) : "Asia/Muscat";
  let when = "";
  try { when = new Date().toLocaleString("en-US", { dateStyle: "full", timeStyle: "short", timeZone: tz }); } catch { when = new Date().toISOString(); }
  return base + " Never use line breaks. Write everything as one paragraph. Current local time: " + when + ". Only use it when the time or date is really needed, never bring it up on your own.";
}

// his words go out as a normal post; the moderation AI looks at them like at everybody's
async function say(zen: string, text: string, parent: string | null): Promise<string | null> {
  const row: Record<string, unknown> = { user_id: zen, body: text.slice(0, 600), text_pending: true };
  if (parent) row.parent_id = parent;
  const ins = await admin.from("posts").insert(row).select("id").single();
  return ins.error || !ins.data ? null : (ins.data.id as string);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const want = await expectedSecret();
  if (!want || !same(want, req.headers.get("x-purge-secret") || "")) return json({ error: "forbidden" }, 403);
  if (!(await geminiKey())) return json({ error: "no gemini key in the vault" }, 500);
  // a dry run writes a post but saves nothing, to check that everything works
  let dry = false, mode = "", force = false, odds = 0.2;
  try { const b = await req.json(); dry = b.dry === true; force = b.force === true; mode = b.mode === "reply" ? "reply" : ""; if (typeof b.odds === "number" && b.odds >= 0 && b.odds <= 1) odds = b.odds; } catch { dry = false; }

  const { data: owner } = await admin.from("app_owner").select("user_id").limit(1).maybeSingle();
  if (!owner) return json({ skipped: "no owner" });
  const id = owner.user_id as string;
  let zen = "";
  try { zen = await ensureZenith(); } catch (e) { return json({ error: String((e as Error).message || e) }, 500); }
  const { data: docs } = await admin.from("zenith_docs").select("doc_id, data").eq("owner_id", id).eq("kind", "state");
  if (mode === "reply") return await replies(id, zen, docs || [], odds);
  const state = (docs || []).find((d) => d.doc_id === "main");
  const z = ((state && state.data && state.data.z) || {}) as { log?: number[] };
  const now = Date.now();
  const log = (Array.isArray(z.log) ? z.log : []).filter((t) => now - t < DAY);
  // every hour a number from 0 to 100 is rolled and a post is written only when it lands in the top band (95 to 100 at the start);
  // the more original posts he made in the last 30 days, the smaller that band gets, so it is super rare to land in it after a busy month
  const since30 = new Date(now - 30 * DAY).toISOString();
  const { count } = await admin.from("posts").select("id", { count: "exact", head: true }).eq("user_id", zen).is("parent_id", null).gt("created_at", since30);
  const band = 5 * Math.pow(0.93, count || 0);
  const roll = Math.random() * 100;
  if (!dry && !force && roll < 100 - band) return json({ skipped: "roll " + roll.toFixed(2) + " needs " + (100 - band).toFixed(2) });

  let text = "";
  try { text = (await ask(promptFor(docs || [], "post"), "Write your next post.")).slice(0, 600); } catch { return json({ error: "gemini unreachable" }, 502); }
  if (!text) return json({ skipped: "empty answer" });
  if (dry) return json({ dry: true, length: text.length, sample: text.slice(0, 50) });
  const pid = await say(zen, text, null);
  if (!pid) return json({ error: "save failed" }, 500);
  const nextZ = Object.assign({}, state && state.data && state.data.z ? state.data.z : {}, { log: [...log, now] });
  await admin.from("zenith_docs").upsert({ owner_id: id, kind: "state", doc_id: "main", data: Object.assign({}, state ? state.data : {}, { z: nextZ }), updated_at: new Date().toISOString() }, { onConflict: "owner_id,kind,doc_id" });
  return json({ ok: true, posted: pid });
});

// the owner and Zenith only: what a thread says, from the top, so his answer fits what was said
async function chainText(postId: string, owner: string, zen: string, last: string): Promise<{ text: string; zenIn: boolean }> {
  const rows: { id: string; user_id: string; body: string | null; parent_id: string | null }[] = [];
  let cur: string | null = postId;
  for (let i = 0; i < 10 && cur; i++) {
    const { data } = await admin.from("posts").select("id, user_id, body, parent_id").eq("id", cur).maybeSingle();
    if (!data) break;
    rows.unshift(data as typeof rows[number]);
    cur = data.parent_id as string | null;
  }
  const mine = rows.filter((r) => r.user_id === owner || r.user_id === zen);
  const text = mine.map((r, i) => (i === mine.length - 1 && r.user_id === owner ? "The user's new reply: " : r.user_id === zen ? "You: " : "The user: ") + String(r.body || "").slice(0, 600)).join("\n");
  return { text: text || last, zenIn: rows.some((r) => r.user_id === zen) };
}

const GAP = 40000;
// the app answers nothing itself any more: this runs every minute (and when the owner nudges it) and handles three things
// deno-lint-ignore no-explicit-any
async function replies(owner: string, zen: string, docs: { doc_id: string; data: any }[], odds: number): Promise<Response> {
  const state = docs.find((d) => d.doc_id === "state" || d.doc_id === "main");
  const since = Number(state && state.data && state.data.z && state.data.z.since) || 0;
  const now = Date.now();
  const from = new Date(Math.max(since, now - 6 * HOUR, ROLLOUT)).toISOString();
  const old = new Date(now - 8000).toISOString();
  const replySystem = promptFor(docs, "reply");
  const out = { owner: 0, liked: 0, others: 0 };
  let budget = 4;

  const cand = async (q: PromiseLike<{ data: unknown }>) => ((await q).data || []) as { id: string; user_id: string; body: string | null; parent_id: string | null; media_url: string | null; created_at: string }[];
  const seenOf = async (ids: string[]) => new Set(ids.length ? (((await admin.from("zenith_seen").select("post_id").in("post_id", ids)).data || []) as { post_id: string }[]).map((r) => r.post_id) : []);
  const mark = (pid: string, acted: string) => admin.from("zenith_seen").upsert({ post_id: pid, acted }, { onConflict: "post_id" });

  // 1 and 2: the owner's own posts, and the owner's replies inside a thread where he has spoken
  const mineNew = await cand(admin.from("posts").select("id, user_id, body, parent_id, media_url, created_at").eq("user_id", owner).eq("mod_status", "safe").eq("text_pending", false).gt("created_at", from).lt("created_at", old).order("created_at", { ascending: true }).limit(12));
  const seenMine = await seenOf(mineNew.map((p) => p.id));
  for (const p of mineNew) {
    if (budget <= 0) break;
    if (seenMine.has(p.id) || !p.body || !String(p.body).trim()) { if (!seenMine.has(p.id)) await mark(p.id, "skip"); continue; }
    const chain = await chainText(p.id, owner, zen, String(p.body));
    if (p.parent_id && !chain.zenIn) { await mark(p.id, "skip"); continue; }
    budget--;
    let lk = { note: "", pics: [] as unknown[] };
    try { lk = await linkInfo(String(p.body)); } catch { /* a post without a preview is answered all the same */ }
    let text = "";
    try { text = (await ask(replySystem, (p.parent_id ? chain.text : "Post: " + String(p.body).slice(0, 2000)) + lk.note, lk.pics)).slice(0, 600); } catch { text = ""; }
    if (!text) continue;
    const rid = await say(zen, text, p.id);
    if (!rid) continue;
    await mark(p.id, "reply");
    out.owner++;
    // his like on the owner's top level posts: only when he really likes it
    if (!p.parent_id) {
      try {
        const a = await ask(LIKE_SYSTEM, String(p.body).slice(0, 1000));
        if (/^yes/i.test(a)) { await admin.from("likes").insert({ user_id: zen, post_id: p.id }); out.liked++; }
      } catch { /* no like this time */ }
    }
  }

  // 3: other people's posts: now and then (one in five) he likes one, and one in five he answers; nobody can ask him anything
  const pub = new Date(Math.max(since, now - 2 * HOUR, ROLLOUT)).toISOString();
  const others = await cand(admin.from("posts").select("id, user_id, body, parent_id, media_url, created_at").neq("user_id", owner).neq("user_id", zen).eq("mod_status", "safe").eq("text_pending", false).gt("created_at", pub).lt("created_at", old).order("created_at", { ascending: true }).limit(12));
  const seenOth = await seenOf(others.map((p) => p.id));
  const parents = new Map<string, string>();
  const pids = [...new Set(others.map((p) => p.parent_id).filter(Boolean))] as string[];
  if (pids.length) ((await admin.from("posts").select("id, user_id").in("id", pids)).data || []).forEach((r: { id: string; user_id: string }) => parents.set(r.id, r.user_id));
  for (const p of others) {
    if (seenOth.has(p.id)) continue;
    // a reply to him is never answered; the post is only noted, so it is not looked at again
    if (p.parent_id && parents.get(p.parent_id) === zen) { await mark(p.id, "to-him"); continue; }
    if (!p.body || !String(p.body).trim() || budget <= 0) { if (!(budget <= 0)) await mark(p.id, "skip"); continue; }
    const likeIt = Math.random() < odds, answerIt = Math.random() < odds;
    if (!likeIt && !answerIt) { await mark(p.id, "pass"); continue; }
    budget--;
    let acted = "";
    if (likeIt) { await admin.from("likes").insert({ user_id: zen, post_id: p.id }); out.liked++; acted = "like"; }
    if (answerIt) {
      let lk = { note: "", pics: [] as unknown[] };
      try { lk = await linkInfo(String(p.body)); } catch { /* fine without */ }
      let text = "";
      try { text = (await ask(replySystem + " You are replying to a post by someone you do not know, and they can never answer you, so never ask a question.", "Post: " + String(p.body).slice(0, 2000) + lk.note, lk.pics)).slice(0, 600); } catch { text = ""; }
      if (text && (await say(zen, text, p.id))) { out.others++; acted += " reply"; }
    }
    await mark(p.id, acted.trim() || "none");
  }
  return json({ ok: true, ...out });
}
