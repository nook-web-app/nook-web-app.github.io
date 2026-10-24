import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const WORKER = "https://ai-nook-chat.haythamzoubi960-322.workers.dev/";
const DAY = 864e5, HOUR = 36e5;
// used only when the app has not saved its own instructions yet
const FALLBACK = "You are Zenith. You are writing one original post for your own profile. Keep it under 35 words, around 20 on average. Plain text only. No hashtags and no emojis.";

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
// this reads them every half hour, writes a post when one is due and moves the schedule on, so the app and this never post twice in a row.
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const want = await expectedSecret();
  if (!want || !same(want, req.headers.get("x-purge-secret") || "")) return json({ error: "forbidden" }, 403);
  const password = Deno.env.get("ZENITH_PASSWORD");
  if (!password) return json({ error: "no password" }, 500);
  // a dry run writes a post but saves nothing, to check that everything works
  let dry = false;
  try { dry = (await req.json()).dry === true; } catch { dry = false; }

  const { data: owner } = await admin.from("app_owner").select("user_id").limit(1).maybeSingle();
  if (!owner) return json({ skipped: "no owner" });
  const id = owner.user_id as string;
  const { data: docs } = await admin.from("zenith_docs").select("doc_id, data").eq("owner_id", id).eq("kind", "state");
  const state = (docs || []).find((d) => d.doc_id === "main");
  const prompt = (docs || []).find((d) => d.doc_id === "prompt");
  const z = ((state && state.data && state.data.z) || {}) as { log?: number[]; next?: number };
  const now = Date.now();
  const log = (Array.isArray(z.log) ? z.log : []).filter((t) => now - t < DAY);
  if (!dry && (log.length >= 2 || now < Number(z.next || 0))) return json({ skipped: "not due" });

  const base = prompt && prompt.data && typeof prompt.data.post === "string" && prompt.data.post.trim() ? String(prompt.data.post) : FALLBACK;
  const tz = prompt && prompt.data && typeof prompt.data.tz === "string" ? String(prompt.data.tz) : "Asia/Muscat";
  let when = "";
  try { when = new Date().toLocaleString("en-US", { dateStyle: "full", timeStyle: "short", timeZone: tz }); } catch { when = new Date().toISOString(); }
  const system = base + " Never use line breaks. Write everything as one paragraph. Current local time: " + when + ". Only use it when the time or date is really needed, never bring it up on your own.";

  let text = "";
  try {
    const r = await fetch(WORKER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password, system, history: [{ role: "user", parts: [{ text: "Write your next post." }] }] }) });
    if (!r.ok) return json({ error: "worker " + r.status }, 502);
    const j = await r.json();
    text = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map((p: { text?: string }) => p.text || "").join("").replace(/\s*\n+\s*/g, " ").trim();
  } catch { return json({ error: "worker unreachable" }, 502); }
  if (!text) return json({ skipped: "empty answer" });
  text = text.slice(0, 600);
  if (dry) return json({ dry: true, length: text.length, sample: text.slice(0, 50) });

  const pid = crypto.randomUUID().replace(/-/g, "").slice(0, 14);
  const post = { id: pid, text, t: now, parent: null, ai: true, liked: false, reposted: false, saved: false, pinned: false };
  const ins = await admin.from("zenith_docs").upsert({ owner_id: id, kind: "post", doc_id: pid, data: post, updated_at: new Date().toISOString() }, { onConflict: "owner_id,kind,doc_id" });
  if (ins.error) return json({ error: "save failed" }, 500);
  const nextZ = Object.assign({}, state && state.data && state.data.z ? state.data.z : {}, { log: [...log, now], next: now + (2 + Math.random() * 4) * HOUR });
  await admin.from("zenith_docs").upsert({ owner_id: id, kind: "state", doc_id: "main", data: Object.assign({}, state ? state.data : {}, { z: nextZ }), updated_at: new Date().toISOString() }, { onConflict: "owner_id,kind,doc_id" });
  return json({ ok: true, posted: pid });
});
