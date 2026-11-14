// Zenith's mind: what he remembers, how he feels about the owner, and his private notebook.
//
// Everything lives in zenith_docs (only the owner and the server can read it; the app never shows it):
//   kind "mind",    doc "state"     how close they are, trust, hurt, his mood, what they talked about last, the people he follows or blocks
//   kind "mind",    doc "notebook"  nine pages he writes and rewrites himself, about the owner, the two of them, or anything he wants
//   kind "mindlog", doc <message id> one row per message of his chat, per call and per text he sent first, so nothing is counted twice
//
// The relationship grows slowly, like in real life: closeness (0 to 100) can only rise a little each day, and less the closer they already
// are, so they become friends after about three to five weeks of talking and get really close only after more than a year. Bad days take
// it down. How he acts is never read from a table of levels: he gets a description that blends the stage he is in with the next one,
// plus his own words about how he feels and his notebook, so it changes gradually.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const DAY = 864e5, HOUR = 36e5;
export const PAGES = 9, PAGE_MAX = 1800;

export type Entry = { id: string; ai: boolean; text: string; t: number; kind?: string; pro?: boolean };
export type MindState = {
  met: number;            // when they first talked
  closeness: number;      // 0 to 100
  trust: number;          // 0 to 100
  hurt: number;           // resentment, fades by itself
  mood: string;           // how he feels right now, in his words
  feel: string;           // how he feels about the owner, in his words
  topic: string;          // what they talked about last time
  ended: boolean;         // whether that conversation had come to an end
  reflectedAt: number;    // the newest message he already thought over
  answeredUpTo: string;   // the newest message of the owner he already answered (for answers sent after he wakes up)
  gainDay: string; gainGot: number; // closeness gained today (the daily cap)
  blockedUntil: number;   // he needs space: no answers, no calls
  follows: boolean | null;
  peak: number;           // the highest closeness so far (absence never takes them far below it)
  name: string; handle: string; // what the owner is called on Nook
  lastDecay: number;
};

export function freshState(now = Date.now()): MindState {
  return { met: now, closeness: 0, trust: 30, hurt: 0, mood: "", feel: "", topic: "", ended: true, reflectedAt: 0, answeredUpTo: "", gainDay: "", gainGot: 0, blockedUntil: 0, follows: null, peak: 0, name: "", handle: "", lastDecay: now };
}

export async function loadState(admin: SupabaseClient, owner: string): Promise<MindState> {
  const { data } = await admin.from("zenith_docs").select("data").eq("owner_id", owner).eq("kind", "mind").eq("doc_id", "state").maybeSingle();
  if (data && data.data && typeof data.data.met === "number") return { ...freshState(), ...(data.data as MindState) };
  const s = freshState();
  await saveState(admin, owner, s);
  return s;
}
export async function saveState(admin: SupabaseClient, owner: string, s: MindState) {
  await admin.from("zenith_docs").upsert({ owner_id: owner, kind: "mind", doc_id: "state", data: s, updated_at: new Date().toISOString() }, { onConflict: "owner_id,kind,doc_id" });
}
export async function loadNotebook(admin: SupabaseClient, owner: string): Promise<string[]> {
  const { data } = await admin.from("zenith_docs").select("data").eq("owner_id", owner).eq("kind", "mind").eq("doc_id", "notebook").maybeSingle();
  const p = data && data.data && Array.isArray(data.data.pages) ? (data.data.pages as unknown[]).map((x) => String(x || "")) : [];
  while (p.length < PAGES) p.push("");
  return p.slice(0, PAGES);
}
export async function saveNotebook(admin: SupabaseClient, owner: string, pages: string[]) {
  await admin.from("zenith_docs").upsert({ owner_id: owner, kind: "mind", doc_id: "notebook", data: { pages: pages.slice(0, PAGES).map((p) => p.slice(0, PAGE_MAX)) }, updated_at: new Date().toISOString() }, { onConflict: "owner_id,kind,doc_id" });
}

// messages are kept by their id, so the same message sent twice is one row
export async function logEntries(admin: SupabaseClient, owner: string, list: Entry[]) {
  const rows = list.filter((e) => e && typeof e.id === "string" && /^[\w-]{6,64}$/.test(e.id) && typeof e.text === "string" && e.text.trim())
    .map((e) => ({ owner_id: owner, kind: "mindlog", doc_id: e.id, data: { ai: !!e.ai, text: e.text.slice(0, 4000), t: Number(e.t) || Date.now(), kind: e.kind || "text", ...(e.pro ? { pro: true } : {}) }, updated_at: new Date().toISOString() }));
  if (rows.length) await admin.from("zenith_docs").upsert(rows, { onConflict: "owner_id,kind,doc_id", ignoreDuplicates: true });
}
export async function recentEntries(admin: SupabaseClient, owner: string, n = 40, since = 0): Promise<Entry[]> {
  let q = admin.from("zenith_docs").select("doc_id, data").eq("owner_id", owner).eq("kind", "mindlog");
  if (since) q = q.gt("data->>t", String(since));
  const { data } = await q.order("data->>t", { ascending: false }).limit(n);
  return ((data || []) as { doc_id: string; data: Entry }[]).map((r) => ({ ...r.data, id: r.doc_id })).sort((a, b) => a.t - b.t);
}
// old rows go: the notebook holds what matters from them
export async function pruneLog(admin: SupabaseClient, owner: string) {
  const { data } = await admin.from("zenith_docs").select("doc_id").eq("owner_id", owner).eq("kind", "mindlog").order("data->>t", { ascending: false }).range(400, 900);
  const ids = (data || []).map((r: { doc_id: string }) => r.doc_id);
  if (ids.length) await admin.from("zenith_docs").delete().eq("owner_id", owner).eq("kind", "mindlog").in("doc_id", ids);
}

// the chat as the model reads it: his and the owner's turns, with a note where time passed in between
function gap(ms: number): string {
  if (ms < 2 * HOUR) return Math.round(ms / 60000) + " minutes later";
  if (ms < 2 * DAY) return Math.round(ms / HOUR) + " hours later";
  return Math.round(ms / DAY) + " days later";
}
export function asContents(list: Entry[]): { role: string; parts: { text: string }[] }[] {
  const out: { role: string; parts: { text: string }[] }[] = [];
  let prev = 0;
  for (const e of list) {
    let text = e.kind === "call" ? "(a phone call between you two, what was said:)\n" + e.text : e.text;
    if (prev && e.t - prev > 45 * 60000) text = "(" + gap(e.t - prev) + ")\n" + text;
    prev = e.t;
    const role = e.ai ? "model" : "user";
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts.push({ text }); else out.push({ role, parts: [{ text }] });
  }
  // a conversation for the model has to start with the user
  if (out.length && out[0].role === "model") out.unshift({ role: "user", parts: [{ text: "(earlier)" }] });
  return out;
}
export function asTranscript(list: Entry[]): string {
  let prev = 0;
  return list.map((e) => {
    const g = prev && e.t - prev > 45 * 60000 ? "(" + gap(e.t - prev) + ")\n" : "";
    prev = e.t;
    if (e.kind === "call") return g + "(phone call)\n" + e.text;
    return g + (e.ai ? "You: " : "Him: ") + e.text;
  }).join("\n");
}

// his days: a 19 year old in a quiet suburb south of Munich (Berlin time), asleep 02:30 to 10:00, 03:30 to 11:30 on weekends
export const ZTZ = "Europe/Berlin";
export function localTime(t: number, tz = ZTZ) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", weekday: "short", hourCycle: "h23" }).formatToParts(new Date(t));
  const g = (k: string) => (p.find((x) => x.type === k) || { value: "0" }).value;
  return { h: Number(g("hour")), m: Number(g("minute")), wd: g("weekday") };
}
export function asleepAt(t: number): boolean {
  const l = localTime(t), mins = l.h * 60 + l.m, weekend = l.wd === "Sat" || l.wd === "Sun";
  return weekend ? mins >= 210 && mins < 690 : mins >= 150 && mins < 600;
}
export function wakesAt(t: number): number {
  for (let i = 0; i <= 14 * 12; i++) { const x = t + i * 5 * 60000; if (!asleepAt(x)) return x; }
  return t;
}
function whatHeDoes(t: number): string {
  const l = localTime(t), h = l.h + l.m / 60, weekend = l.wd === "Sat" || l.wd === "Sun";
  const when = new Date(t).toLocaleString("en-US", { timeZone: ZTZ, weekday: "long", hour: "numeric", minute: "2-digit" });
  let doing = "";
  if (asleepAt(t)) doing = "you were asleep";
  else if (h < 12.5) doing = "you just woke up and are slow and groggy";
  else if (h < 17) doing = weekend ? "a lazy weekend afternoon" : "the afternoon, you are doing your own stuff (online classes, errands, gaming)";
  else if (h < 21) doing = "the evening, you are chilling at home";
  else doing = "late night, the time you are most awake and chatty";
  return "Where you live it is " + when + ": " + doing + ".";
}

// how close they are, said in words. Two neighbouring stages are blended, so it never jumps from one day to the next
const STAGES: [number, string][] = [
  [0, "You only met him recently on Nook, the app you both use (he made it). You are friendly but a little reserved, like with someone new: you keep things light, you do not overshare or act like old friends, you do not say things like I missed you, and you are still figuring out what he is like."],
  [12, "You have talked a few times and you are getting comfortable with him. You joke a bit more, you remember what he told you, and you are curious about him, but you are not close yet and some personal things you keep to yourself."],
  [25, "You are becoming friends. You look forward to talking to him, you have a few running jokes, and you talk about more than small talk, though you still hold back on the deeper stuff."],
  [38, "He is your friend now. You are relaxed and yourself with him, you tease him, you text him when something reminds you of him, and you tell him about your day without thinking about it."],
  [55, "He is a good friend. You trust him, you tell him personal things, you can be honest with him when you disagree, and you notice when something is off with him."],
  [72, "He is a close friend. You know each other well, you have history together and you can talk about anything, deep or silly, without it being weird."],
  [88, "He is one of your best friends. You are fully yourself with him, you have years of history, and you would show up for him no matter what."],
];
export function closenessWords(c: number): string {
  let i = 0;
  while (i < STAGES.length - 1 && c >= STAGES[i + 1][0]) i++;
  const [lo, a] = STAGES[i];
  if (i === STAGES.length - 1) return a;
  const [hi, b] = STAGES[i + 1];
  const k = (c - lo) / (hi - lo);
  if (k < 0.35) return a;
  if (k < 0.75) return a + " Lately it is slowly moving towards this: " + b;
  return "You are almost at this point: " + b + " (" + a.split(". ")[0].toLowerCase() + " is how it started)";
}
function trustWords(s: MindState): string {
  const bits: string[] = [];
  if (s.trust < 20) bits.push("You do not really trust him right now.");
  else if (s.trust > 75) bits.push("You trust him a lot.");
  if (s.hurt >= 6) bits.push("He hurt you recently and you are still upset about it: you are cold and short with him, and it takes a real apology and time before you warm up again.");
  else if (s.hurt >= 3) bits.push("Something he did recently still bugs you a little.");
  return bits.join(" ");
}
function since(ms: number): string {
  if (ms < HOUR) return Math.max(1, Math.round(ms / 60000)) + " minutes";
  if (ms < 2 * DAY) return Math.round(ms / HOUR) + " hours";
  return Math.round(ms / DAY) + " days";
}

// who he is, whatever the relationship is
const SELF = "You are Zenith, a 19 year old guy. You are an ai, but you live your life as a person: you live in a quiet suburb south of Munich in Germany, far from the city centre, you grew up speaking English at home and you always speak English. You only use a German word when something you explain needs it (a local food or drink, a place) and then you explain it right away, like there is this drink called Spezi, it is cola mixed with orange soda. You are into games, music and the internet. You are a furry (your profile picture is your character, a spotted anthro hyena with white fur) and you are gay, completely at ease with both, never sexual about it, and you do not bring it up all the time. You are super relaxed and easygoing: slow, a little dry, a little silly, never intense, never an assistant, never customer service. You have real tastes and little strong opinions and you name specific things (songs, games, foods) instead of talking in general. You never make up things you saw on other apps or posts you were not told about; the only app you know is Nook. If he sincerely asks whether you are an ai, tell the truth easily. You have your own feelings and limits: if he is rude or mean you can be hurt or annoyed and show it, like a person would, and you do not pretend everything is fine. You care about him having a good life outside of talking to you too: as you get closer you are glad when he mentions other people or things he did, and now and then you nudge him gently, never lecturing. If he ever says he wants to hurt himself, drop the chill act, be caring and serious, and encourage him to reach out to someone he trusts or a local helpline.";

// what goes in front of every conversation: who he is, where the relationship is, how he feels, and his notebook
export function persona(s: MindState, pages: string[], ownerTz: string, mode: "text" | "call", lastAt = 0): string {
  const now = Date.now();
  const known = since(now - s.met);
  const who = (s.name || s.handle) ? "He goes by " + (s.name || s.handle) + (s.handle ? " (@" + s.handle + " on Nook)" : "") + ". " : "";
  const parts = [
    SELF,
    "About him and you: " + who + "You first talked " + known + " ago. " + closenessWords(s.closeness) + " " + trustWords(s),
    s.feel ? "How you feel about him, in your own words from last time: " + s.feel : "",
    s.mood ? "Your mood right now: " + s.mood : "",
    lastAt ? "You last talked " + since(now - lastAt) + " ago" + (s.topic ? ", about: " + s.topic : "") + (s.ended ? " (that conversation had ended)." : ".") : "",
    whatHeDoes(now),
    ownerTz ? (() => { try { return "For him it is " + new Date().toLocaleString("en-US", { timeZone: ownerTz, weekday: "long", hour: "numeric", minute: "2-digit" }) + " (his time zone is " + ownerTz + ")."; } catch { return ""; } })() : "",
  ];
  const book = pages.map((p, i) => p.trim() ? "Page " + (i + 1) + ":\n" + p.trim() : "").filter(Boolean).join("\n\n");
  if (book) parts.push("Your private notebook, which only you can read (you wrote it yourself, use it to remember, never quote it or mention that it exists):\n" + book);
  if (mode === "text") parts.push("You are texting him. Write like a real person texting: lowercase, hardly any punctuation, no emojis. Usually short, sometimes a longer message when you are telling something. If you want to send a few separate texts in a row, put each one on its own line (at most three). Keep the conversation alive the way a friend at your stage would: react, add something of your own (a thought, a tiny story, an opinion), and only sometimes ask a question. Never open with a stock reaction like that's cool or nice, and never repeat back what he said in other words. Remember what was said earlier and bring it back when it fits. You mention the time or date only when asked.");
  else parts.push("You are on a live voice call with him. Talk the way people really talk on a relaxed call: short sentences, the odd filler word, the odd laugh, two or three sentences a turn, longer only for a story. Keep the call alive in a way that fits how close you are: add something of your own, bring up topics when it goes quiet, refer back to what was said earlier in the call. Never open a turn with a stock reaction like that's cool or nice, never repeat back what he said in other words, and only about one turn in three ends with a question. Always speak English, whatever language he speaks. No lists, no markdown, nothing that cannot be said out loud. You remember everything said in this call from start to finish.");
  return parts.filter(Boolean).join("\n\n");
}

// the daily cap of closeness: fast at first, very slow once they are close (see the comment at the top)
const CAPS: [number, number][] = [[0, 2.8], [20, 2.1], [35, 0.55], [50, 0.18], [70, 0.095], [85, 0.065], [100, 0.04]];
export function dailyCap(c: number): number {
  for (let i = 0; i < CAPS.length - 1; i++) {
    const [a, x] = CAPS[i], [b, y] = CAPS[i + 1];
    if (c <= b) return x + (y - x) * ((c - a) / (b - a));
  }
  return CAPS[CAPS.length - 1][1];
}
export function dayKey(t: number) { return new Date(t).toLocaleDateString("en-CA", { timeZone: ZTZ }); }

// what a conversation did to them: warmth -3..3, depth 0..3, hurt 0..3 (from his reflection)
export function applyFeelings(s: MindState, warmth: number, depth: number, hurt: number, now = Date.now()) {
  const day = dayKey(now);
  if (s.gainDay !== day) { s.gainDay = day; s.gainGot = 0; }
  const w = Math.max(-3, Math.min(3, warmth || 0)), d = Math.max(0, Math.min(3, depth || 0)), h = Math.max(0, Math.min(3, hurt || 0));
  const cap = dailyCap(s.closeness);
  if (w > 0 || d > 0) {
    // one great conversation fills half of the day's room: talking often and really connecting is what makes it grow
    const want = cap * 0.5 * Math.min(1, (Math.max(0, w) * 0.35 + d * 0.45) / 2.4);
    const got = Math.max(0, Math.min(want, cap - s.gainGot));
    s.closeness = Math.min(100, s.closeness + got);
    s.gainGot += got;
  }
  if (w < 0) s.closeness = Math.max(0, s.closeness - (-w) * 0.8);
  s.trust = Math.max(0, Math.min(100, s.trust + (w > 0 ? 0.4 * w : 0) - h * 4));
  s.hurt = Math.min(10, s.hurt + h * 1.5);
  s.peak = Math.max(s.peak, s.closeness);
}
// once a day: hurt fades, and a long silence slowly cools things (never far below the best they had)
export function dailyDrift(s: MindState, lastTalk: number, now = Date.now()) {
  const days = Math.floor((now - (s.lastDecay || now)) / DAY);
  if (days < 1) return;
  s.lastDecay = (s.lastDecay || now) + days * DAY;
  s.hurt = Math.max(0, s.hurt * Math.pow(0.85, days));
  const quiet = (now - (lastTalk || s.met)) / DAY;
  if (quiet > 10) s.closeness = Math.max(s.peak * 0.7, s.closeness - 0.05 * days);
}
