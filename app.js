// never run inside someone else's page: a hidden frame is how people trick you into tapping things
if (window.top !== window.self) { document.documentElement.style.display = "none"; try { window.top.location = window.self.location; } catch (e) {} }
function startFail(why) {
  const m = document.getElementById("main");
  if (!m || m.childElementCount) return;
  m.textContent = "";
  const box = document.createElement("div");
  box.className = "empty";
  const p = document.createElement("p");
  p.textContent = "Nook could not start. " + (/connection/i.test(why || "") ? why : "Try again, and if it keeps happening reset this phone.");
  const b = document.createElement("button");
  b.className = "pri";
  b.textContent = "Try again";
  b.onclick = () => { if (navigator.onLine === false) { p.textContent = "Nook could not start. You are offline. Connect to the internet and try again."; return; } try { navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))).then(() => caches.keys()).then(ks => Promise.all(ks.map(k => caches.delete(k)))).finally(() => location.reload()); } catch (e) { location.reload(); } };
  const r = document.createElement("button");
  r.className = "tbtn";
  r.textContent = "Reset this phone";
  r.onclick = () => {
    if (!confirm("This clears the saved copy of Nook on this phone. Your account and posts stay safe on the server. Continue?")) return;
    try { Object.keys(localStorage).filter(k => k === "tiny-posts-v3" || k.indexOf("nook-cache:") === 0).forEach(k => localStorage.removeItem(k)); sessionStorage.removeItem("nook-route"); } catch (e) {}
    try { const q = indexedDB.deleteDatabase("tiny-posts"); q.onsuccess = q.onerror = q.onblocked = () => location.reload(); setTimeout(() => location.reload(), 2500); } catch (e) { location.reload(); }
  };
  box.append(p, b, r);
  m.append(box);
}
window.addEventListener("error", e => setTimeout(() => startFail(String((e && e.message) || "")), 300));
window.addEventListener("unhandledrejection", e => setTimeout(() => startFail(String((e && e.reason && e.reason.message) || "")), 300));
setTimeout(() => startFail("Check your connection."), 12000);
const SB_URL = "https://cimyolsipjdpibzaebmx.supabase.co";
// only the public columns of a profile are read; the moderation flags are not visible to other people
const ACC_COLS = "id, username, display_name, bio, avatar, banner, banner_theme, public_key, deactivated, handle_changed_at, pinned_post_id, created_at";
const SB_KEY = "sb_publishable_BzsW9TXvMRjUQf5BZj3pLg_197wdNpq";
const HASH_ERR = /error_code=/.test(location.hash);
let RECOVERY = false;
// the app reads the sign in link of a reset email itself, so a stranger's link cannot silently sign somebody in
const sb = window.supabase ? window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }) : null;
async function takeHashLogin() {
  const raw = location.hash;
  if (!/access_token=/.test(raw)) return;
  const p = new URLSearchParams(raw.replace(/^#/, ""));
  history.replaceState(history.state, "", location.pathname + location.search);
  let asked = 0, signedIn = false;
  try {
    asked = Number(localStorage.getItem("nook-reset-asked") || 0);
    signedIn = Object.keys(localStorage).some(k => /^sb-.*-auth-token$/.test(k) && localStorage.getItem(k));
  } catch (e) {}
  const recent = asked && Date.now() - asked < 2 * 3600 * 1000;
  // somebody who is already signed in only accepts the link when they asked for the reset on this phone
  if (p.get("type") !== "recovery" || !p.get("access_token") || !p.get("refresh_token") || (signedIn && !recent)) { if (signedIn) setTimeout(() => toast("That link is for a reset requested on another device. Ask again here"), 800); return; }
  const { error } = await sb.auth.setSession({ access_token: p.get("access_token"), refresh_token: p.get("refresh_token") });
  if (!error) { RECOVERY = true; try { localStorage.removeItem("nook-reset-asked"); } catch (e) {} }
  else setTimeout(() => { try { toast("Could not check the reset link. Check your connection, or ask for a new link"); } catch (e) {} }, 1500);
}
let sbUser = null;
function isOwner() { return !!sbUser && sbUser.email === "haythamzoubi960@gmail.com"; }
const NS = "http://www.w3.org/2000/svg";
const topEl = document.getElementById("top");
const main = document.getElementById("main");
const navEl = document.getElementById("nav");
const railEl = document.getElementById("rail");
const layer = document.getElementById("layer");
const fabs = document.getElementById("fabs");
let fresh = null;
let bump = null;
let convRO = null;
const toastEl = document.getElementById("toast");

const P = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  pass: '<rect x="3" y="7" width="18" height="10" rx="3"/><path d="M8 12h.01M12 12h.01M16 12h.01" stroke-width="2.6"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  backup: '<path d="M7 18a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 8.7 4.7 4.7 0 0 1 17.5 18z"/><path d="M12 15v-5M9.5 12l2.5-2.5 2.5 2.5"/>',
  eyeoff: '<defs><mask id="eom"><rect width="24" height="24" fill="#fff" stroke="none"/><path d="M20 4L4 20" stroke="#000" stroke-width="4"/></mask></defs><g mask="url(#eom)"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></g><path d="M20 4L4 20"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  usercut: '<defs><mask id="ucm"><rect width="24" height="24" fill="#fff" stroke="none"/><path d="M21 3L3 21" stroke="#000" stroke-width="4"/></mask></defs><g mask="url(#ucm)"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></g><path d="M21 3L3 21"/>',
  userswap: '<defs><mask id="usm"><rect width="24" height="24" fill="#fff" stroke="none"/><rect x="11.5" y="11.5" width="13" height="13" rx="4" fill="#000" stroke="none"/></mask></defs><g mask="url(#usm)"><circle cx="9" cy="7.5" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5"/></g><g stroke-width="1.8"><path d="M14.2 15.4h7.3M19.5 13.4l2 2-2 2M21.8 20.6h-7.3M16.5 18.6l-2 2 2 2"/></g>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  reply: '<path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/>',
  repost: '<path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"/>',
  heart: '<path d="M12 21s-8-5.3-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.7-8 11-8 11z"/>',
  share: '<path d="M14 4l7 6-7 6v-4c-6 0-9 2-11 6 1-7 4-11 11-11z"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  dots: '<circle cx="5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="19" cy="12" r="1.7" fill="currentColor"/>',
  pin: '<path d="M12 17v5M8 3h8l-1 7 3 4H6l3-4z"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  sliders: '<path d="M4 6h8.5M17.5 6H20M4 12h2.5M11.5 12H20M4 18h10.5M19.5 18H20"/><circle cx="15" cy="6" r="2.5"/><circle cx="9" cy="12" r="2.5"/><circle cx="17" cy="18" r="2.5"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  send: '<path d="M4 12l16-8-6 16-3-7z"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14c1 1.5 2.3 2.2 4 2.2s3-.7 4-2.2"/><path d="M9 9.5h.01M15 9.5h.01"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21h4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>'
};

function ic(n, s, fill) {
  const v = document.createElementNS(NS, "svg");
  v.setAttribute("viewBox", "0 0 24 24");
  v.setAttribute("width", s || 22);
  v.setAttribute("height", s || 22);
  v.setAttribute("fill", fill ? "currentColor" : "none");
  v.setAttribute("stroke", "currentColor");
  v.setAttribute("stroke-width", "2");
  v.setAttribute("stroke-linecap", "round");
  v.setAttribute("stroke-linejoin", "round");
  v.setAttribute("aria-hidden", "true");
  v.innerHTML = P[n];
  return v;
}
function add(e, k) {
  for (const c of k) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) add(e, c);
    else e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}
function h(t, p, ...k) {
  const e = document.createElement(t);
  if (p) {
    for (const a in p) {
      const v = p[a];
      if (v == null || v === false) continue;
      if (a === "class") e.className = v;
      else if (a.startsWith("on")) e.addEventListener(a.slice(2), v);
      else if (a === "style") e.style.cssText = v;
      else e.setAttribute(a, v === true ? "" : v);
    }
  }
  // only the sign up and sign in fields (marked data-pm) may open the password manager; every other field tells it to stay away
  if ((t === "input" || t === "textarea") && !(p && p["data-pm"]) && e.getAttribute("autocomplete") !== "one-time-code") {
    e.setAttribute("autocomplete", "off");
    e.setAttribute("data-1p-ignore", "");
    e.setAttribute("data-lpignore", "true");
    e.setAttribute("data-bwignore", "");
    e.setAttribute("data-form-type", "other");
  }
  add(e, k);
  return e;
}
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
const urlCache = new Map();
function view(src) {
  if (!src || !src.startsWith("data:")) return src;
  let u = urlCache.get(src);
  if (!u) {
    try {
      const bin = atob(src.slice(src.indexOf(",") + 1));
      const arr = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
      u = URL.createObjectURL(new Blob([arr], { type: (/^data:([^;,]+)/.exec(src) || [0, "image/jpeg"])[1] }));
    } catch (e) { u = src; }
    urlCache.set(src, u);
  }
  return u;
}
function mkImg(src, cls, on) {
  const i = h("img", { src: view(src), alt: "", decoding: "async", loading: "lazy", class: cls || null });
  i.onerror = () => {
    i.onerror = () => { if (!cls && i.parentNode) i.replaceWith(h("div", { class: "dmgone" }, "Photo not available")); };
    i.src = src;
  };
  if (on) i.addEventListener("click", on);
  return i;
}
const picImg = src => mkImg(src, "pic");

const APP_VERSION = "3.11.5";
const PH = ["What's up?", "What's on your mind?", "Quick update", "What's new today?", "Jot down a thought", "Note to future self", "Today I learned", "Something that made you laugh", "Something you love right now", "Favorite song this week", "What are you listening to?", "What did you dream about?", "What are you eating?", "Weird thought of the day", "Dump your brain here", "Idea for later", "Sketch a quick thought", "Log today's mood", "Small win today", "Brag a little", "How's your day going?", "Random thought", "Pin a reminder", "Something you're looking forward to", "What are you watching?", "Write something nice to yourself"];
let S = null;
let zenSyncOn = false, zenTimer = null, zenBusySync = false;
const zenSeen = new Map();
let db = null;
let timer = null;
const imgIds = new Map();
const knownIds = new Set();
let chain = Promise.resolve();
function idbOpen() {
  return new Promise((res, rej) => {
    try {
      const r = indexedDB.open("tiny-posts", 2);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
        if (!d.objectStoreNames.contains("img")) d.createObjectStore("img");
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error("blocked"));
    } catch (e) { rej(e); }
  });
}
function idbLoad(d) {
  return new Promise((res, rej) => {
    const t = d.transaction(["kv", "img"]);
    const a = t.objectStore("kv").get("state");
    const ik = t.objectStore("img").getAllKeys();
    const iv = t.objectStore("img").getAll();
    t.oncomplete = () => res({ meta: a.result || null, keys: ik.result, vals: iv.result });
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
function idbSave(d, meta, fresh, drop) {
  // a save that never finishes is given up after a while, so the queue behind it keeps moving
  return Promise.race([idbSaveNow(d, meta, fresh, drop), new Promise((_, rej) => setTimeout(() => rej(new Error("slow save")), 10000))]);
}
function idbSaveNow(d, meta, fresh, drop) {
  return new Promise((res, rej) => {
    const t = d.transaction(["kv", "img"], "readwrite");
    t.objectStore("kv").put(meta, "state");
    const im = t.objectStore("img");
    fresh.forEach(f => im.put(f[1], f[0]));
    drop.forEach(id => im.delete(id));
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
function persist() {
  clearTimeout(timer);
  timer = setTimeout(flush, 250);
  if (zenSyncOn) { clearTimeout(zenTimer); zenTimer = setTimeout(zenSync, 2500); }
  if (notesOn && !notesQuiet) { clearTimeout(notesTimer); notesTimer = setTimeout(notesSync, 3000); }
}
function flush() {
  chain = chain.then(doFlush).catch(() => {});
  return chain;
}
let hashMemo = new Map();
function srcHash(src) {
  let a = 0x811c9dc5, b = 0x5bd1e995;
  for (let i = 0; i < src.length; i++) { const c = src.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = (Math.imul(b ^ c, 0x01000193) + i) | 0; }
  return "i" + src.length.toString(36) + "-" + (a >>> 0).toString(36) + "-" + (b >>> 0).toString(36);
}
let noSave = false;
async function doFlush() {
  if (!S || noSave) return;
  if (db) {
    try {
      const memo = new Map();
      const fresh = new Map();
      const used = new Set();
      const idFor = src => {
        if (!src) return null;
        const id = memo.get(src) || hashMemo.get(src) || srcHash(src);
        memo.set(src, id);
        used.add(id);
        if (!knownIds.has(id)) fresh.set(id, src);
        return id;
      };
      const posts = S.posts.map(p => ({ ...p, imgs: p.imgs.map(idFor) }));
      const chats = S.chats.map(c => ({ ...c, msgs: c.msgs.map(m => ({ ...m, imgs: (m.imgs || []).map(idFor) })) }));
      const profile = { ...S.profile, avatar: idFor(S.profile.avatar), banner: idFor(S.profile.banner) };
      const drop = Array.from(knownIds).filter(id => !used.has(id));
      await idbSave(db, { ...S, posts, chats, profile, split: 1 }, Array.from(fresh), drop);
      fresh.forEach((_, id) => knownIds.add(id));
      drop.forEach(id => knownIds.delete(id));
      hashMemo = memo;
      return;
    } catch (e) {}
  }
  try { localStorage.setItem("tiny-posts-v3", JSON.stringify(S)); } catch (e) { toast("storage is full"); }
}

function freshState() {
  const s = {
    v: 3,
    profile: { name: "Me", handle: "me", bio: "", avatar: null, banner: null },
    posts: [], chats: [], lists: [],
    feeds: [],
    ui: { theme: "system", homeTab: "latest", profTab: "posts" }
  };
  return s;
}
function normalize() {
  S.profile = S.profile || {};
  S.previews = S.previews || {};
  S.posts = S.posts || [];
  S.chats = S.chats || [];
  S.lists = S.lists || [];
  S.zen = S.zen || { log: [], next: 0, since: Date.now() };
  // videos are not supported any more, so old local ones are dropped
  const noVid = a => Array.isArray(a) ? a.filter(s => !(typeof s === "string" && s.startsWith("data:video/"))) : a;
  S.posts.forEach(p => { if (p && p.imgs) p.imgs = noVid(p.imgs); });
  S.chats.forEach(c => (c.msgs || []).forEach(m => { if (m && m.imgs) m.imgs = noVid(m.imgs); }));
  S.zen.pics = !!S.zen.pics;
  S.feeds = S.feeds || [];
  S.ui = S.ui || {};
  S.ui.theme = S.ui.theme || "system";
  S.ui.homeTab = S.ui.homeTab || "latest";
  S.ui.profTab = S.ui.profTab || "posts";
  S.posts.forEach(p => { p.imgs = p.imgs || []; if (typeof p.text !== "string") p.text = ""; });
  S.chats.forEach(c => { c.msgs = c.msgs || []; c.msgs.forEach(m => { m.imgs = m.imgs || []; if (typeof m.text !== "string") m.text = ""; }); });
  if (typeof S.profile.name !== "string") S.profile.name = "Me";
  if (typeof S.profile.handle !== "string" || !S.profile.handle.trim()) S.profile.handle = "me";
  if (typeof S.profile.bio !== "string") S.profile.bio = "";
  return false;
}
function applyTheme() {
  const r = document.documentElement;
  if (S.ui.theme === "system") r.removeAttribute("data-theme");
  else r.setAttribute("data-theme", S.ui.theme);
  syncBar();
}
function syncBar() {
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute("content", getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());
}
if (window.matchMedia) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  if (mq.addEventListener) mq.addEventListener("change", syncBar);
}

const byId = id => S.posts.find(p => p.id === id);
const kids = id => S.posts.filter(p => p.parent === id);
// true when one of his own posts is above this one, however far up
const zenThread = p => { for (let q = p && p.parent ? byId(p.parent) : null, n = 0; q && n < 60; q = q.parent ? byId(q.parent) : null, n++) if (q.ai) return true; return false; };
// a post that shows a link card does not also print the link; the copy button in the menu still has the whole text
const cardless = p => { if (!p.text || (p.imgs && p.imgs.length) || !firstUrl(p.text)) return p.text; return p.text.replace(/https?:\/\/[^\s<>"]+/i, "").replace(/[ \t]{2,}/g, " ").trim(); };
// every reply under a post counts, the ones to replies too
const replyTotal = id => flat(id, 0, []).length;
function flat(id, d, out) {
  kids(id).sort((a, b) => a.t - b.t).forEach(k => { out.push({ p: k, d }); flat(k.id, d + 1, out); });
  return out;
}
// home feed order. Everything is worked out on this phone from things the person did on purpose
// (who they follow, what they liked, saved or replied to, "less like this") and never from time spent or scrolling
const LANGS = [["arabic", "Arabic"], ["chinese", "Chinese"], ["dutch", "Dutch"], ["english", "English"], ["french", "French"], ["german", "German"], ["greek", "Greek"], ["hebrew", "Hebrew"], ["hindi", "Hindi"], ["indonesian", "Indonesian"], ["italian", "Italian"], ["japanese", "Japanese"], ["korean", "Korean"], ["persian", "Persian"], ["polish", "Polish"], ["portuguese", "Portuguese"], ["russian", "Russian"], ["spanish", "Spanish"], ["thai", "Thai"], ["turkish", "Turkish"], ["ukrainian", "Ukrainian"], ["urdu", "Urdu"]];
const PHONE_LANG = { ar: "arabic", zh: "chinese", nl: "dutch", en: "english", fr: "french", de: "german", el: "greek", he: "hebrew", hi: "hindi", id: "indonesian", it: "italian", ja: "japanese", ko: "korean", fa: "persian", pl: "polish", pt: "portuguese", ru: "russian", es: "spanish", th: "thai", tr: "turkish", uk: "ukrainian", ur: "urdu" };
const WORDS = {
  english: "the and is are of to in that it for you with this on was have not but they your we be at or by from my so his her its our what when will can all just there their about would".split(" "),
  spanish: "el la los las de que en un una es por con para no se su al lo como más pero sus le ya este sí porque esta entre cuando muy sin sobre también me hasta hay donde quien desde todo nos".split(" "),
  french: "le la les des est et en un une du de que qui dans pour pas sur au avec ce il elle je nous vous ils sont mais ou où plus par se ne comme tout cette très être".split(" "),
  german: "der die das und ist nicht ein eine zu den dem des mit auf für von ich du er sie es wir ihr aber auch wie bei nach aus noch nur oder wenn dass sehr".split(" "),
  portuguese: "os as do da em um uma para com não por mais na no dos das como mas foi ao ele ela seu sua ser quando muito já também só pelo você são".split(" "),
  italian: "il lo gli di che un una per con non è sono ma come più anche se da del della dei delle nel nella al alla questo quello ho hai molto".split(" "),
  dutch: "de het een en van ik te dat die niet op aan met voor zijn er maar om ook als dan nog wel naar bij uit heel".split(" "),
  turkish: "ve bir bu da de için ile ben sen çok daha gibi ama ne mi mı var yok değil ki ya kadar".split(" "),
  indonesian: "yang dan di ke dari ini itu dengan untuk tidak adalah saya kamu akan pada juga atau ada sudah bisa".split(" "),
  polish: "nie na się że to jest do jak ale po co tak za od czy dla już tylko".split(" ")
};
const WORDSET = Object.fromEntries(Object.keys(WORDS).map(k => [k, new Set(WORDS[k])]));
const MARKS = { spanish: /[ñ¿¡]/g, german: /[ßäöü]/g, portuguese: /[ãõ]/g, turkish: /[şğı]/g, polish: /[łąęśźż]/g, french: /[œêèùûîôâ]/g };
const count = (t, re) => (t.match(re) || []).length;
// which language a text is in; null when there is too little to tell (a photo with a short caption is for everybody)
function langOf(text) {
  if (typeof text !== "string" || text.length < 3) return null;
  const n = k => count(text, k);
  const kana = n(/[\u3040-\u30FF]/g), han = n(/[\u3400-\u4DBF\u4E00-\u9FFF]/g), hangul = n(/[\uAC00-\uD7AF\u1100-\u11FF]/g);
  const arab = n(/[\u0600-\u06FF\u0750-\u077F]/g), cyr = n(/[\u0400-\u04FF]/g), deva = n(/[\u0900-\u097F]/g), thai = n(/[\u0E00-\u0E7F]/g), heb = n(/[\u0590-\u05FF]/g), greek = n(/[\u0370-\u03FF]/g);
  const lat = n(/[A-Za-z\u00C0-\u024F]/g);
  const top = Math.max(kana + han, hangul, arab, cyr, deva, thai, heb, greek, lat);
  if (top < 3) return null;
  if (kana + han === top) return kana > 0 ? "japanese" : "chinese";
  if (hangul === top) return "korean";
  if (arab === top) return n(/[ٹڈڑںے]/g) ? "urdu" : n(/[پچژگ]/g) ? "persian" : "arabic";
  if (cyr === top) return n(/[їєґ]/g) ? "ukrainian" : "russian";
  if (deva === top) return "hindi";
  if (thai === top) return "thai";
  if (heb === top) return "hebrew";
  if (greek === top) return "greek";
  const words = text.toLowerCase().match(/[\p{L}]+/gu) || [];
  let best = null, hi = 0, second = 0;
  for (const k of Object.keys(WORDSET)) {
    let sc = 0;
    words.forEach(w => { if (WORDSET[k].has(w)) sc++; });
    if (MARKS[k]) sc += 2 * count(text.toLowerCase(), MARKS[k]);
    if (sc > hi) { second = hi; hi = sc; best = k; } else if (sc > second) second = sc;
  }
  return hi >= 2 && hi > second ? best : null;
}
function myLangs() {
  const ids = new Set(LANGS.map(l => l[0]));
  const chosen = S && S.ui && Array.isArray(S.ui.langs) ? S.ui.langs.filter(x => ids.has(x)) : [];
  if (chosen.length) return new Set(chosen);
  const set = new Set();
  (navigator.languages || [navigator.language || "en"]).forEach(l => { const k = PHONE_LANG[String(l).slice(0, 2).toLowerCase()]; if (k) set.add(k); });
  S.posts.filter(p => !p.ra && !p.ai).slice(0, 30).forEach(p => { const k = langOf(p.text); if (k) set.add(k); });
  if (!set.size) set.add("english");
  return set;
}
const STOP = new Set(["this", "that", "with", "have", "from", "they", "were", "what", "your", "about", "just", "will", "would", "there", "their", "been", "than", "then", "them", "into", "some", "when", "like", "more", "very", "also", "only", "over", "dont", "cant"]);
const wordsOf = text => typeof text === "string" ? [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []).filter(w => !STOP.has(w)))].slice(0, 12) : [];
const whoOf = p => p.ra ? p.ra.id : p.ai ? "zenith" : "me";
let followSet = null;
const getFollows = () => {
  if (!followSet) { const c = sbUser ? cacheRead("follows:" + sbUser.id) : null; followSet = new Set((c && c.v) || []); }
  return followSet;
};
const rankCache = new Map();
function rankFeed(arr, tab) {
  const less = (S.ui.less = S.ui.less || { a: {}, w: {} });
  const hidden = new Set(S.ui.hidden || []);
  const langs = myLangs();
  const follows = getFollows();
  const maxT = arr.reduce((m, p) => Math.max(m, ft(p)), 0);
  const key = [tab, arr.length, maxT, hidden.size, Object.keys(less.a).length + ":" + Object.keys(less.w).length, [...langs].join(), follows.size].join("|");
  const hit = rankCache.get(tab);
  // the order stays the same while the posts, the follows and the choices stay the same, so likes do not shuffle the page
  if (hit && hit.key === key) return hit.ids.map(id => byId(id)).filter(Boolean);
  const aff = new Map();
  const add = (id, v) => { if (id) aff.set(id, (aff.get(id) || 0) + v); };
  S.posts.forEach(p => {
    if (p.ra || p.ai) { const w = whoOf(p); if (p.liked) add(w, .25); if (p.saved) add(w, .4); if (p.reposted) add(w, .3); }
    else if (p.parent) { const par = byId(p.parent); if (par && (par.ra || par.ai)) add(whoOf(par), .3); }
  });
  const now = Date.now();
  const scored = arr.filter(p => !hidden.has(p.id)).map(p => {
    const who = whoOf(p);
    const rec = Math.pow(.5, Math.max(0, now - ft(p)) / 36e5 / 10);
    const a = Math.min(1.5, aff.get(who) || 0);
    const fol = follows.has(who) ? 1 : 0;
    let s;
    if (who === "me") s = rec * 1.4;
    else s = rec * (1 + 2 * a + fol) + (!fol && !a ? .12 * rec : 0);
    const sc = langOf(p.text);
    if (sc && !langs.has(sc)) s *= .12;
    if (less.a[who]) s *= Math.pow(.1, Math.min(2, less.a[who]));
    const hitN = wordsOf(p.text).filter(w => less.w[w]).length;
    if (hitN) s *= Math.max(.3, 1 - .25 * hitN);
    return { p, s, who };
  });
  scored.sort((x, y) => y.s - x.s);
  const out = [], rest = scored.slice();
  while (rest.length) {
    let i = 0;
    const n = out.length;
    if (n >= 2 && out[n - 1].who === out[n - 2].who) { i = rest.findIndex(x => x.who !== out[n - 1].who); if (i < 0) i = 0; }
    out.push(rest.splice(i, 1)[0]);
  }
  rankCache.set(tab, { key, ids: out.map(x => x.p.id) });
  return out.map(x => x.p);
}
// "less like this": the person goes down a lot, the words a little, and the post goes away now
function lessLikeThis(p) {
  const less = (S.ui.less = S.ui.less || { a: {}, w: {} });
  const who = whoOf(p);
  if (who !== "me") less.a[who] = Math.min(2, (less.a[who] || 0) + 1);
  wordsOf(p.text).forEach(w => { less.w[w] = Math.min(3, (less.w[w] || 0) + 1); });
  const ws = Object.keys(less.w);
  if (ws.length > 300) ws.sort((x, y) => less.w[x] - less.w[y]).slice(0, ws.length - 300).forEach(w => delete less.w[w]);
  S.ui.hidden = (S.ui.hidden || []).concat(p.id).slice(-300);
  persist();
  toast("You will see less like this");
  render();
}
function langSheet() {
  const ids = new Set(LANGS.map(l => l[0]));
  const sel = new Set(Array.isArray(S.ui.langs) ? S.ui.langs.filter(x => ids.has(x)) : []);
  let changed = false;
  // tapping a language adds or removes it and the sheet stays open, so more than one can be picked
  const paint = b => [...b.parentElement.children].forEach((r, k) => r.classList.toggle("on", k === 0 ? !sel.size : sel.has(LANGS[k - 1][0])));
  const save = b => { S.ui.langs = sel.size ? [...sel] : null; changed = true; persist(); paint(b); };
  const items = [{ label: "Automatic", keep: true, on: !sel.size, fn: b => { sel.clear(); save(b); } }];
  LANGS.forEach(l => items.push({ label: l[1], keep: true, on: sel.has(l[0]), fn: b => { if (sel.has(l[0])) sel.delete(l[0]); else sel.add(l[0]); save(b); } }));
  items.push({ label: "Done", cancel: true });
  sheet(items, "Languages I read (pick as many as you like)", () => { if (changed) render(); });
}
const langText = () => { const ids = new Set(LANGS.map(l => l[0])); const l = Array.isArray(S.ui.langs) ? S.ui.langs.filter(x => ids.has(x)) : []; return l.length ? l.map(id => LANGS.find(x => x[0] === id)[1]).sort().join(", ") : "Automatic"; };
// a very long text is cut with a Show more button, so one huge post can never fill the page
function txBody(text, extra) {
  const box = h("div", { class: "tx" + extra });
  const LIMIT = 700;
  if (String(text).length <= LIMIT) { box.append(...rich(text)); return box; }
  const more = h("button", { class: "tbtn", type: "button", style: "padding:6px 0;color:var(--lnk)", onclick: e => { e.stopPropagation(); box.textContent = ""; box.append(...rich(text)); } }, "Show more");
  box.append(...rich(String(text).slice(0, 600) + "…"), h("div", {}, more));
  return box;
}
function feedPosts(f) {
  let a = S.posts.filter(p => !p.parent);
  if (f) {
    if (f.media) a = a.filter(p => p.imgs.length);
    if (f.q) {
      const q = f.q.toLowerCase();
      // a hashtag matches the whole tag only: #cat does not find #category
      const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const tag = q.startsWith("#") ? new RegExp("(^|[^\\p{L}\\p{N}_])" + esc + "(?![\\p{L}\\p{N}_])", "iu") : null;
      a = a.filter(p => tag ? tag.test(p.text) : p.text.toLowerCase().includes(q));
    }
  }
  return a.sort((x, y) => ft(y) - ft(x));
}
// a post that somebody you follow reposted counts from the time of the repost
const ft = p => (p.rpBy ? Math.max(p.t, p.rpBy.t) : p.t);
function ago(t) {
  if (!Number.isFinite(t)) return "";
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return "now";
  if (m < 60) return m + "m";
  const hr = Math.floor(m / 60);
  if (hr < 24) return hr + "h";
  const d = Math.floor(hr / 24);
  if (d < 30) return d + "d";
  return new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
}
function rich(text) {
  const out = [];
  text = String(text == null ? "" : text);
  text.split(/(https?:\/\/\S+|#[\p{L}\p{N}_]+)/gu).forEach((part, i) => {
    if (i % 2 === 0) { if (part) out.push(part); return; }
    if (part.startsWith("#")) {
      out.push(h("button", { class: "tag", onclick: e => { e.stopPropagation(); go({ r: "tag", q: part }); } }, part));
      return;
    }
    const raw = part.replace(/[.,!?)]+$/, "");
    const rest = part.slice(raw.length);
    const clean = cleanUrl(raw);
    const shown = clean.replace(/^https?:\/\//, "");
    out.push(h("a", { class: "lk", href: clean, target: "_blank", rel: "noopener noreferrer", onclick: e => e.stopPropagation() }, shown.length > 34 ? shown.slice(0, 33) + "…" : shown));
    if (rest) out.push(rest);
  });
  return out;
}
function avatar(size) {
  const a = h("div", { class: "av" }, (S.profile.name || S.profile.handle || "?").trim().charAt(0).toUpperCase());
  if (size) { a.style.width = size + "px"; a.style.height = size + "px"; a.style.fontSize = Math.round(size * 0.4) + "px"; }
  if (S.profile.avatar) a.prepend(picImg(S.profile.avatar));
  return a;
}

let toastT = null;
function toast(m, act) {
  toastEl.textContent = m;
  toastEl.classList.toggle("act", !!act);
  if (act) toastEl.append(h("button", { class: "tact", onclick: () => { toastEl.classList.remove("show"); act.fn(); } }, act.label));
  toastEl.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove("show"), act ? 5000 : 1900);
}
function dismiss(...els) {
  els.forEach(e => e.classList.add("out"));
  setTimeout(() => els.forEach(e => e.remove()), 170);
}
document.addEventListener("selectstart", e => { if (!(e.target instanceof Element && e.target.closest("input,textarea"))) e.preventDefault(); });
document.addEventListener("contextmenu", e => { if (!(e.target instanceof Element && e.target.closest("input,textarea"))) e.preventDefault(); });
function copy(text) {
  const done = () => {};
  const fb = () => {
    const t = h("textarea", { style: "position:fixed;opacity:0" });
    t.value = text;
    document.body.append(t);
    t.readOnly = true;
    t.select();
    try { document.execCommand("copy"); done(); } catch (e) { toast("Could not copy"); }
    t.remove();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fb);
  else fb();
}

function sheet(items, title, onDone) {
  const scrim = h("div", { class: "scrim", onclick: () => close() });
  // the sheet is a layer like a modal: the Back button closes it first, and what an item does starts once it is closed
  const gone = () => { scrim.style.animationPlayState = sh.style.animationPlayState = ""; dismiss(scrim, sh); if (onDone) setTimeout(onDone, 0); };
  const closeS = trackLayer(gone, gone);
  // an item with keep stays open when tapped, so several can be chosen one after another
  const row = i => h("button", { class: "si" + (i.danger ? " danger" : "") + (i.on ? " on" : "") + (i.icon || i.av ? "" : " plain"), onclick: e => { if (i.keep) i.fn(e.currentTarget); else close(i.fn ? () => i.fn() : undefined); } }, i.av ? h("span", { class: "sic" }, rAv(i.av, 32)) : i.icon ? h("span", { class: "sic" }, ic(i.icon, 20)) : null, h("span", {}, i.label), i.trail ? h("span", { class: "trail" }, i.trail) : null, i.keep ? h("span", { class: "trail ck" }, ic("check", 18)) : null);
  const grab = h("div", { class: "grab" }, h("i"));
  const sh = h("div", { class: "sheet", role: "dialog", "aria-label": title || "Options" }, grab, title ? h("div", { class: "st" }, title) : null,
    h("div", { class: "sg" }, items.filter(i => !i.cancel).map(row)),
    items.filter(i => i.cancel).map(i => h("button", { class: "sx", onclick: () => close(i.fn ? () => i.fn() : undefined) }, i.label)));
  let y0 = null, dy = 0;
  grab.addEventListener("pointerdown", e => { y0 = e.clientY; dy = 0; grab.setPointerCapture(e.pointerId); sh.style.animation = "none"; sh.style.transition = "none"; });
  grab.addEventListener("pointermove", e => { if (y0 != null) { dy = Math.max(0, e.clientY - y0); sh.style.transform = "translateY(" + dy + "px)"; } });
  const end = () => {
    if (y0 == null) return;
    y0 = null;
    sh.style.transition = "transform .2s";
    if (dy > 70) { sh.style.transform = "translateY(120%)"; close(); }
    else sh.style.transform = "";
  };
  grab.addEventListener("pointerup", end);
  grab.addEventListener("pointercancel", end);
  function close(then) { closeS(typeof then === "function" ? then : undefined); }
  // the sheet is drawn once off screen before it slides in, so the first frames are not spent building it
  scrim.style.animationPlayState = sh.style.animationPlayState = "paused";
  layer.append(scrim, sh);
  requestAnimationFrame(() => requestAnimationFrame(() => { if (!sh.classList.contains("out")) scrim.style.animationPlayState = sh.style.animationPlayState = ""; }));
}
function confirmSheet(msg, label, fn) {
  sheet([{ label, danger: true, fn }, { label: "Cancel", cancel: true }], msg);
}
// links lose what follows the ? so they do not carry tracking codes; a few sites need one part to find the page
const TRACKING = new Set(["fbclid", "gclid", "gbraid", "wbraid", "dclid", "msclkid", "yclid", "twclid", "igshid", "igsh", "si", "feature", "pp", "mc_cid", "mc_eid", "ref_src", "ref_url", "_hsenc", "_hsmi", "mkt_tok", "vero_id", "s_cid", "spm", "xtok", "xmt", "ttclid", "sfnsn", "share_id"]);
// these sites open the same page with no options at all, so every option on them is just tracking
const PLAIN_HOSTS = /(^|\.)(instagram\.com|ig\.me|facebook\.com|fb\.com|fb\.watch)$/i;
// only the tracking part of a link is dropped; the rest keeps the page the same
function cleanUrl(u) {
  const i = u.indexOf("?");
  if (i < 0) return u;
  try { if (PLAIN_HOSTS.test(new URL(u).hostname)) { const at = u.indexOf("#", i); return u.slice(0, i) + (at < 0 ? "" : u.slice(at)); } } catch (e) {}
  const hashAt = u.indexOf("#", i);
  const qs = u.slice(i + 1, hashAt < 0 ? undefined : hashAt), hash = hashAt < 0 ? "" : u.slice(hashAt);
  const kept = qs.split("&").filter(kv => { const k = kv.split("=")[0].toLowerCase(); return kv && !/^utm_/.test(k) && !TRACKING.has(k); });
  return u.slice(0, i) + (kept.length ? "?" + kept.join("&") : "") + hash;
}
const cleanText = t => String(t || "").replace(/https?:\/\/[^\s<>"]+/gi, m => { const tail = (/[.,!?)\]]+$/.exec(m) || [""])[0]; return cleanUrl(m.slice(0, m.length - tail.length)) + tail; });
const firstUrl = t => { const m = /https?:\/\/[^\s<>"]+/i.exec(t || ""); return m ? cleanUrl(m[0].replace(/[.,!?)\]]+$/, "")) : null; };
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return u; } };
const pvMem = new Map();
async function timed(u) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 9000);
  try { const r = await fetch(u, { signal: ac.signal }); if (!r.ok) throw new Error("bad"); return r; } finally { clearTimeout(t); }
}
const ytId = u => { const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{6,})/i.exec(u || ""); return m ? m[1] : null; };
async function fetchPreview(url) {
  const host = hostOf(url);
  const yt = ytId(url);
  if (yt) {
    let t = "";
    try { t = (await (await timed("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(url))).json()).title || ""; } catch (e) {}
    return { t, d: "", i: "https://i.ytimg.com/vi/" + yt + "/hqdefault.jpg", s: "YouTube", v: 2 };
  }
  try {
    const j = await (await timed("https://api.microlink.io/?url=" + encodeURIComponent(url))).json();
    if (j.status !== "success" || !j.data) throw new Error("x");
    const d = j.data;
    const pic = (d.image && d.image.url) || (d.logo && d.logo.url) || "";
    return { t: d.title || "", d: d.description || "", i: /^https:\/\//i.test(pic) ? pic : "", s: d.publisher || host, v: 2 };
  } catch (e) {}
  try {
    const html = await (await timed("https://api.allorigins.win/raw?url=" + encodeURIComponent(url))).text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const meta = k => { const e = doc.querySelector('meta[property="' + k + '"],meta[name="' + k + '"]'); return e ? e.getAttribute("content") || "" : ""; };
    let img = meta("og:image") || meta("twitter:image");
    if (img) { try { img = new URL(img, url).href; } catch (e) {} if (!/^https:\/\//i.test(img)) img = ""; }
    const t = meta("og:title") || meta("twitter:title") || doc.title || "";
    if (!t && !img) throw new Error("x");
    return { t, d: meta("og:description") || meta("description"), i: img, s: meta("og:site_name") || host, v: 2 };
  } catch (e) {}
  return null;
}
function getPreview(url) {
  if (S.previews[url] && S.previews[url].v) return Promise.resolve(S.previews[url]);
  if (!pvMem.has(url)) {
    pvMem.set(url, fetchPreview(url).then(d => {
      if (d) {
        S.previews[url] = d;
        const k = Object.keys(S.previews);
        if (k.length > 150) delete S.previews[k[0]];
        persist();
      }
      else setTimeout(() => pvMem.delete(url), 600000);
      return d;
    }));
  }
  return pvMem.get(url);
}
// what a card says: for Instagram only the @username and the caption without hashtags, for everything else just the page title
function cardText(d, url) {
  const t = String((d && d.t) || "");
  if (/(^|\.)instagram\.com$/i.test(hostOf(url))) {
    const who = /\(@([\w.]+)\)/.exec(t) || /\s-\s([\w.]+) on /.exec(String((d && d.d) || ""));
    const m = /:\s*["\u201c]([\s\S]*)$/.exec(String((d && d.d) || ""));
    let cap = m ? m[1].replace(/["\u201d]\.?\s*$/, "").replace(/#[\p{L}\p{N}_]+/gu, "").replace(/\s+/g, " ").trim() : "";
    // Instagram cuts long captions in the middle of a word: a cut caption stops at its last full sentence instead
    if (/(\u2026|\.\.\.)$/.test(cap)) {
      const body = cap.replace(/(\u2026|\.\.\.)$/, "").trim(), full = /^([\s\S]*[.!?])(\s|$)/.exec(body);
      cap = full && full[1].length >= 12 ? full[1] : body + "\u2026";
    }
    return { t: who ? "@" + who[1] : t.replace(/\s*[\u2022\u00b7|-]\s*Instagram.*$/i, ""), c: cap };
  }
  return { t: t.replace(/\s*[\u2022\u00b7]\s*Instagram (photo|video|reel)s?$/i, ""), c: "" };
}
// where the main thing in a picture is, as fractions: the crop is moved so that spot stays in view
function focusPos(f, ar, box) {
  const at = (v, len, win) => (len - win) > 0.001 ? Math.max(0, Math.min(100, ((v * len - win / 2) / (len - win)) * 100)) : 50;
  if (ar < box) return "50% " + at(f.y / 100, 1 / ar, 1 / box).toFixed(1) + "%";
  return at(f.x / 100, ar, box).toFixed(1) + "% 50%";
}
const focusMem = new Map();
async function getFocus(url, img) {
  if (!sbUser) return null;
  if (!focusMem.has(url)) focusMem.set(url, (async () => {
    try {
      const { data } = await sb.auth.getSession();
      const tok = data && data.session ? data.session.access_token : null;
      const r = await fetch(SB_URL + "/functions/v1/focus", { method: "POST", headers: { "content-type": "application/json", apikey: SB_KEY, ...(tok ? { authorization: "Bearer " + tok } : {}) }, body: JSON.stringify({ url: img }), signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined });
      if (!r.ok) return null;
      const j = await r.json();
      return j && Number.isFinite(j.x) && Number.isFinite(j.y) ? { x: j.x, y: j.y } : null;
    } catch (e) { return null; }
  })().then(f => { if (!f) setTimeout(() => focusMem.delete(url), 300000); return f; }));
  return focusMem.get(url);
}
function linkCard(url, chat) {
  const host = hostOf(url);
  const card = h("a", { class: "lc" + (chat ? " chat" : ""), href: url, target: "_blank", rel: "noopener noreferrer", onclick: e => e.stopPropagation() });
  const fill = d => {
    card.textContent = "";
    const ct = cardText(d, url);
    if (d && d.i) {
      const im = h("img", { class: "lci", src: d.i, alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
      im.onerror = () => im.remove();
      card.append(im);
      // Aegis looks at the picture once and says where the main thing is; the crop is placed on it (not in chats)
      if (!chat) {
        const place = f => { if (f && im.naturalWidth) im.style.objectPosition = focusPos(f, im.naturalWidth / im.naturalHeight, 4 / 3); };
        const go2 = async () => {
          let f = S.previews[url] && S.previews[url].f;
          if (!f) { f = await getFocus(url, d.i); if (f && S.previews[url]) { S.previews[url].f = f; persist(); } }
          place(f);
        };
        if (im.complete && im.naturalWidth) go2(); else im.addEventListener("load", go2, { once: true });
      }
    }
    card.append(h("div", { class: "lcb" }, h("b", {}, ct.t || host), ct.c ? h("span", { class: "lcd" }, ct.c) : null, h("span", { class: "lch" }, host)));
  };
  if (S.previews[url] && S.previews[url].v) fill(S.previews[url]);
  else { card.append(h("div", { class: "skel lcs" })); getPreview(url).then(fill); }
  return card;
}
function longPress(el, fn) {
  let t = null, sx = 0, sy = 0, fired = false;
  const stop = () => clearTimeout(t);
  el.addEventListener("pointerdown", e => { fired = false; sx = e.clientX; sy = e.clientY; stop(); t = setTimeout(() => { fired = true; if (navigator.vibrate) { try { navigator.vibrate(10); } catch (x) {} } fn(); }, 480); });
  el.addEventListener("pointermove", e => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) stop(); });
  ["pointerup", "pointercancel", "pointerleave"].forEach(n => el.addEventListener(n, stop));
  el.addEventListener("click", e => { if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; } }, true);
  el.addEventListener("contextmenu", e => { e.preventDefault(); stop(); if (!fired) { fired = true; fn(); } });
}
function modal(o) {
  const ov = h("div", { class: "ov", role: "dialog" });
  const closeM = trackLayer(() => dismiss(ov), () => { if (o.onBack) o.onBack(); dismiss(ov); });
  const close = then => closeM(typeof then === "function" ? then : undefined);
  const act = h("button", { class: "pri", onclick: () => o.onAction(close) }, o.action || "Save");
  const cancel = h("button", { class: "tbtn", onclick: () => (o.onCancel ? o.onCancel(close) : close()) }, "Cancel");
  // the main button sits under the fields; only a screen with its own footer (writing a post) keeps it at the top
  const top = !!o.foot || !!o.top;
  const body = h("div", { class: "mbody" }, o.body);
  if (!top) body.append(h("div", { class: "mact" }, act));
  ov.append(h("div", { class: "bar mbar" }, cancel, h("div", { class: "ttl" }, o.title || ""), top ? act : h("span")), body);
  if (o.foot) ov.append(o.foot);
  layer.append(ov);
  return { ov, close, act };
}
function lightbox(imgs, i, cap, opts) {
  let n = i, closeLb;
  const holder = h("div", { class: "lbm" });
  const show = () => {
    holder.textContent = "";
    const src = imgs[n];
    let el;
    { el = h("img", { alt: "" }); el.onerror = () => { el.onerror = () => { holder.textContent = ""; holder.append(h("p", { class: "note", style: "color:#fff;text-align:center" }, "Photo not available")); }; el.src = src; }; el.src = view(src); }
    el.addEventListener("click", e => e.stopPropagation());
    holder.append(el);
    l.hidden = n === 0 || imgs.length < 2; r.hidden = n === imgs.length - 1 || imgs.length < 2;
  };
  const lb = h("div", { class: "lb", onclick: () => closeLb() });
  const x = h("button", { class: "ib x", "aria-label": "Close", onclick: () => closeLb() }, ic("close", 22));
  const l = h("button", { class: "ib l", "aria-label": "Previous", onclick: e => { e.stopPropagation(); n--; show(); } }, ic("back", 22));
  const r = h("button", { class: "ib r", "aria-label": "Next", onclick: e => { e.stopPropagation(); n++; show(); } }, ic("back", 22));
  r.firstChild.style.transform = "scaleX(-1)";
  const del = opts && opts.del ? h("button", { class: "ib d", "aria-label": "Delete photo", onclick: e => {
    e.stopPropagation();
    confirmSheet("Delete this photo?", "Delete", async () => {
      const done = await opts.del(n);
      if (!done) return;
      imgs.splice(n, 1);
      if (!imgs.length) { closeLb(); return; }
      n = Math.min(n, imgs.length - 1);
      show();
    });
  } }, ic("trash", 22)) : null;
  lb.append(...[holder, x, del, cap ? h("div", { class: "cap" }, cap) : null, imgs.length > 1 ? l : null, imgs.length > 1 ? r : null].filter(Boolean));
  closeLb = trackLayer(() => dismiss(lb));
  layer.append(lb);
  show();
}

let stack = [{ r: "home" }];
const scrolls = [];
// a page that was left comes back to the same spot even when its pictures are still loading: the spot is set again until the page is tall enough
function settleScroll(y) {
  main.scrollTop = y;
  if (!y) return;
  let n = 0, stop = false;
  const off = () => { stop = true; };
  main.addEventListener("touchstart", off, { once: true, passive: true });
  main.addEventListener("wheel", off, { once: true, passive: true });
  const tick = () => {
    if (stop || n++ > 120) return;
    if (Math.abs(main.scrollTop - y) > 1 && main.scrollHeight - main.clientHeight >= y - 1) main.scrollTop = y;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
// a post and one reply opened from it is as deep as it goes, so nobody can wander down one chain forever
const MAX_OPEN_POSTS = 2;
function go(r) {
  if (r && r.r === "thread" && stack.filter(x => x.r === "thread").length >= MAX_OPEN_POSTS) return;
  scrolls.push(main.scrollTop); stack.push(r); hist(false); render("fwd"); main.scrollTop = 0; }
function back() { if (stack.length > 1) history.back(); }
function hist(replace) { const st = { s: JSON.parse(JSON.stringify(stack)), sc: scrolls.slice() }; try { if (replace) history.replaceState(st, ""); else history.pushState(st, ""); } catch (e) {} }
let layers = [], ignorePops = 0, afterPop = null;
function trackLayer(rm, back) {
  const entry = { rm, back: back || rm, done: false };
  layers.push(entry);
  let pushed = false;
  try { history.pushState({ s: JSON.parse(JSON.stringify(stack)), sc: scrolls.slice(), n: layers.length }, ""); pushed = true; } catch (e) {}
  return then => {
    if (entry.done) return;
    entry.done = true;
    layers = layers.filter(x => x !== entry);
    rm();
    if (!pushed) { if (then) then(); return; }
    afterPop = then || null;
    ignorePops++;
    history.back();
  };
}
window.addEventListener("popstate", e => {
  if (ignorePops > 0) { ignorePops--; const f = afterPop; afterPop = null; if (f) f(); return; }
  const target = (e.state && e.state.n) || 0;
  if (layers.length > target) {
    while (layers.length > target) { const en = layers.pop(); if (!en.done) { en.done = true; en.back(); } }
    return;
  }
  if (!e.state || !Array.isArray(e.state.s)) return;
  const goingBack = e.state.s.length < stack.length;
  const y = goingBack ? scrolls[e.state.s.length - 1] || 0 : 0;
  stack = e.state.s; scrolls.length = 0; (e.state.sc || []).forEach(v => scrolls.push(v));
  render(goingBack ? "back" : "fwd"); settleScroll(y);
});
function root(name) { stack = [{ r: name }]; scrolls.length = 0; hist(false); render("root"); main.scrollTop = 0; }

const ibtn = (n, label, fn) => h("button", { class: "ib", "aria-label": label, onclick: fn }, ic(n, 24));
const menuBtn = () => ibtn("menu", "Menu", openDrawer);
const backBtn = () => ibtn("back", "Back", back);
const bar = (l, c, r) => h("div", { class: "bar" }, l || h("span"), c, r || h("span"));
const ttl = t => h("div", { class: "ttl" }, t);
function fab(n, label, fn) { main.style.paddingBottom = "88px"; fabs.append(h("button", { class: "fab", "aria-label": label, onclick: fn }, ic(n, 26))); }
function emptyState(icon, text, btn) { return h("div", { class: "empty" }, ic(icon, 56), h("p", {}, text), btn || null); }

function imgGrid(imgs, cap) {
  const g = h("div", { class: "imgs " + (imgs.length > 4 ? "many" : "n" + imgs.length) });
  imgs.forEach((src, i) => g.append(mkImg(src, null, e => { e.stopPropagation(); lightbox(imgs, i, cap); })));
  return g;
}
function wrapLines(ctx, text, maxW) {
  const out = [];
  text.split("\n").forEach(par => {
    let line = "";
    par.split(" ").forEach(w => {
      const t = line ? line + " " + w : w;
      if (ctx.measureText(t).width <= maxW || !line) line = t;
      else { out.push(line); line = w; }
    });
    out.push(line);
  });
  return out;
}
function loadPicImg(src, cors) {
  return new Promise(res => { const i = new Image(); if (cors) i.crossOrigin = "anonymous"; i.referrerPolicy = "no-referrer"; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}
async function postPic(p) {
  const W = 960, pad = 56, av = 80, fs = 34, lh = 48, cs = getComputedStyle(document.documentElement);
  const bg = cs.getPropertyValue("--bg").trim() || "#161e27", fg = cs.getPropertyValue("--fg").trim() || "#f1f3f5", mu = cs.getPropertyValue("--muted").trim() || "#8d9bae", ac = cs.getPropertyValue("--accent").trim() || "#208bfe";
  const m = document.createElement("canvas").getContext("2d");
  m.font = "400 " + fs + "px system-ui, -apple-system, sans-serif";
  const cw = W - pad * 2;
  const lines = p.text ? wrapLines(m, cleanText(p.text), cw) : [];
  const src = p.imgs && p.imgs.length ? p.imgs[0] : null;
  const pic = src ? await loadPicImg(view(src), /^https?:/.test(view(src))) : null;
  const lurl = !pic ? firstUrl(p.text) : null;
  let card = null;
  if (lurl) {
    const d = await Promise.race([getPreview(lurl).catch(() => null), new Promise(r => setTimeout(() => r(null), 4500))]);
    const th = d && d.i ? await loadPicImg(d.i, true) : null;
    const ttl = d && d.t ? d.t : hostOf(lurl);
    const tl = wrapLines(m, ttl, cw - 48).slice(0, 2);
    const dl = d && d.d ? wrapLines(m, d.d, cw - 48).slice(0, 2) : [];
    const thH = th ? Math.round(cw * 0.5) : 0;
    card = { th, thH, tl, dl, host: hostOf(lurl), h: thH + 24 + tl.length * 44 + dl.length * 40 + 64 };
  }
  const who = p.ai ? { name: "Zenith", handle: "zenith", avatar: (S.zen && S.zen.pfp) || null } : p.ra ? { name: p.ra.name, handle: p.ra.handle, avatar: p.ra.avatar } : { name: S.profile.name, handle: S.profile.handle, avatar: S.profile.avatar };
  const me = who && who.avatar ? await loadPicImg(view(who.avatar), /^https?:/.test(view(who.avatar))) : null;
  const picH = pic ? Math.min(Math.round(cw * pic.height / pic.width), 900) : 0;
  const H = pad + av + 32 + lines.length * lh + (pic ? picH + 32 : 0) + (card ? card.h + 32 : 0) + 60 + pad;
  const s = Math.sqrt(2000000 / (W * H));
  const c = document.createElement("canvas");
  c.width = Math.round(W * s); c.height = Math.round(H * s);
  const x = c.getContext("2d");
  x.scale(c.width / W, c.height / H);
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  const ax = pad + av / 2, ay = pad + av / 2, ar = av / 2;
  if (p.ai) {
    const g = x.createLinearGradient(ax - ar, ay - ar, ax + ar, ay + ar);
    g.addColorStop(0, "#14466f"); g.addColorStop(1, "#208bfe");
    x.beginPath(); x.arc(ax, ay, ar, 0, Math.PI * 2); x.fillStyle = g; x.fill();
  } else {
    x.beginPath(); x.arc(ax, ay, ar, 0, Math.PI * 2); x.fillStyle = ac; x.fill();
  }
  if (me) {
    x.save(); x.beginPath(); x.arc(ax, ay, ar, 0, Math.PI * 2); x.clip();
    const k = Math.max(av / me.width, av / me.height);
    x.drawImage(me, ax - (me.width * k) / 2, ay - (me.height * k) / 2, me.width * k, me.height * k);
    x.restore();
  } else {
    x.fillStyle = "#ffffff"; x.textAlign = "center"; x.textBaseline = "middle";
    x.font = "700 " + Math.round(av * (p.ai ? 0.5 : 0.4)) + "px Inter, system-ui, sans-serif";
    x.fillText(p.ai ? "Z" : (who.name || who.handle || "?").trim().charAt(0).toUpperCase(), ax, ay + 1);
  }
  x.textAlign = "left"; x.textBaseline = "alphabetic";
  const name = p.ai ? "Zenith" : who.name, handle = p.ai ? "@zenith" : "@" + who.handle;
  x.fillStyle = fg; x.font = "700 " + fs + "px system-ui, sans-serif"; x.fillText(name, pad + av + 20, pad + 36);
  x.fillStyle = mu; x.font = "400 " + Math.round(fs * 0.85) + "px system-ui, sans-serif"; x.fillText(handle, pad + av + 20, pad + 36 + 36);
  let y = pad + av + 32;
  x.fillStyle = fg; x.font = "400 " + fs + "px system-ui, sans-serif";
  lines.forEach(l => { y += lh; x.fillText(l, pad, y); });
  if (pic) {
    y += 32;
    const ph = Math.round(cw * pic.height / pic.width);
    const dh = Math.min(ph, 900), dw = Math.round(dh * pic.width / pic.height);
    x.save(); x.beginPath(); x.roundRect ? x.roundRect(pad, y, Math.min(cw, dw), dh, 18) : x.rect(pad, y, Math.min(cw, dw), dh); x.clip();
    x.drawImage(pic, pad, y, Math.min(cw, dw), dh); x.restore();
    y += dh;
  }
  if (card) {
    y += 32;
    x.save(); x.beginPath(); x.roundRect ? x.roundRect(pad, y, cw, card.h, 22) : x.rect(pad, y, cw, card.h); x.clip();
    x.fillStyle = cs.getPropertyValue("--bg2").trim() || "#1f2a37"; x.fillRect(pad, y, cw, card.h);
    if (card.th) {
      const k = Math.max(cw / card.th.width, card.thH / card.th.height), dw = card.th.width * k, dh = card.th.height * k;
      x.save(); x.beginPath(); x.rect(pad, y, cw, card.thH); x.clip();
      x.drawImage(card.th, pad + (cw - dw) / 2, y + (card.thH - dh) / 2, dw, dh);
      x.restore();
    }
    let ty = y + card.thH + 24;
    x.fillStyle = fg; x.font = "700 " + Math.round(fs * 0.85) + "px system-ui, sans-serif";
    card.tl.forEach(l => { ty += 40; x.fillText(l, pad + 24, ty); });
    x.fillStyle = mu; x.font = "400 " + Math.round(fs * 0.75) + "px system-ui, sans-serif";
    card.dl.forEach(l => { ty += 38; x.fillText(l, pad + 24, ty); });
    ty += 44; x.fillText(card.host, pad + 24, ty);
    x.restore();
    y += card.h;
  }
  y += 60;
  x.fillStyle = mu; x.font = "400 " + Math.round(fs * 0.75) + "px system-ui, sans-serif";
  x.fillText(new Date(p.t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }), pad, y);
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error("png"))), "image/png"));
}
async function sharePic(p) {
  toast("Making picture...");
  try {
    const blob = await postPic(p);
    const file = new File([blob], "nook-post.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "nook-post.png";
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("Picture saved");
  } catch (e) {
    if (e && e.name === "AbortError") return;
    toast("Could not make picture");
  }
}
// who a link can be sent to: my own notes, and people who follow me while I follow them
async function messageTargets() {
  const out = [];
  S.chats.filter(c => !(c.msgs || []).some(m => m.ai)).forEach(c => out.push({ kind: "note", id: c.id, name: c.name }));
  if (sbUser) {
    const [a, b, k1, k2] = await Promise.all([
      sb.from("follows").select("followee_id").eq("follower_id", sbUser.id).limit(500),
      sb.from("follows").select("follower_id").eq("followee_id", sbUser.id).limit(500),
      sb.from("blocks").select("blocked_id").eq("blocker_id", sbUser.id),
      sb.from("blocks").select("blocker_id").eq("blocked_id", sbUser.id)
    ]);
    const mineF = new Set((a.data || []).map(r => r.followee_id));
    const hidden = new Set([...(k1.data || []).map(r => r.blocked_id), ...(k2.data || []).map(r => r.blocker_id)]);
    const ids = (b.data || []).map(r => r.follower_id).filter(id => mineF.has(id) && !hidden.has(id));
    if (ids.length) {
      await loadSocial();
      const m = await cachedAccounts(ids);
      ids.forEach(id => { const x = m.get(id) || {}; out.push({ kind: "user", id, name: nickOf(id) || x.display_name || x.username || "user", avatar: x.avatar || null }); });
    }
  }
  return out;
}
async function sendLinkTo(t, link) {
  if (t.kind === "note") {
    const chat = S.chats.find(x => x.id === t.id);
    if (!chat) return;
    chat.msgs.push({ id: uid(), text: link, t: Date.now(), imgs: [] });
    persist();
    toast("Saved in " + t.name);
    return;
  }
  try {
    if (!(S.previews[link] && S.previews[link].v)) await Promise.race([getPreview(link), new Promise(r => setTimeout(r, 4500))]);
    await sendDm(t.id, link, [], []);
    toast("Sent to " + t.name);
  }
  catch (e) { toast("Could not send"); }
}
function chooseTarget(targets, send) {
  sheet([...targets.map(t => ({ icon: t.kind === "note" ? "edit" : null, av: t.kind === "note" ? null : { name: t.name, avatar: t.avatar }, label: t.kind === "note" ? t.name + " (notes)" : t.name, fn: () => send(t) })), { label: "Cancel", cancel: true }], "Send to");
}
async function sendPicTo(t, blob, isPost) {
  const src = await readDataURL(blob);
  if (t.kind === "note") {
    const chat = S.chats.find(x => x.id === t.id);
    if (!chat) return;
    chat.msgs.push({ id: uid(), text: "", t: Date.now(), imgs: [src] });
    persist();
    toast("Saved in " + t.name);
    return;
  }
  try { await sendDm(t.id, "", [src], [Object.assign(await srcDims(src), isPost ? { post: true } : {})]); toast("Sent to " + t.name); }
  catch (e) { toast("Could not send"); }
}
async function sharePost(p) {
  const targets = await messageTargets().catch(() => []);
  const pic = async () => { toast("Making picture..."); try { return await postPic(p); } catch (e) { toast("Could not make picture"); return null; } };
  sheet([
    { icon: "edit", label: "Post", fn: async () => { const b = await pic(); if (b) openCompose({ files: [new File([b], "nook-post.png", { type: "image/png" })] }); } },
    ...(targets.length ? [{ icon: "chat", label: "Message", fn: () => chooseTarget(targets, async t => {
      if (p.ai && t.kind === "user") { try { const pu = await zenPfpUrl(); await sendDm(t.id, ZPOST + JSON.stringify({ x: p.text, t: p.t, ...(pu ? { a: pu } : {}) }), [], []); toast("Sent to " + t.name); } catch (e) { toast("Could not send"); } return; }
      if (p.remote && t.kind === "user") { try { await sendDm(t.id, RPOST + JSON.stringify({ id: p.remote, u: p.ra ? p.ra.id : sbUser.id }), [], []); toast("Sent to " + t.name); } catch (e) { toast("Could not send. " + plainErr(e, "Try again")); } return; }
      if (t.kind === "note") {
        // a post goes into notes as the post itself, the way it goes to a person, not as a picture of it
        const chat = S.chats.find(x => x.id === t.id);
        if (!chat) return;
        const m = { id: uid(), text: "", t: Date.now(), imgs: [] };
        if (p.ai) { const pu = await zenPfpUrl().catch(() => null); m.zpost = { x: String(p.text || "").slice(0, 600), t: p.t, a: pu || null }; }
        else if (p.remote) m.rpost = { id: p.remote, u: p.ra ? p.ra.id : sbUser.id };
        else { m.text = p.text || ""; m.imgs = (p.imgs || []).slice(); }
        chat.msgs.push(m); persist(); toast("Saved in " + t.name);
        return;
      }
      const b = await pic(); if (b) sendPicTo(t, b, true);
    }) }] : []),
    { icon: "share", label: "Another app", fn: () => sharePic(p) },
    { label: "Cancel", cancel: true }], "Share post");
}
// nc: inside an opened reply the list is flat and the numbers would only count down the chain, so the comment icon shows alone
function acts(p, big, nc) {
  const n = nc ? 0 : p.ra ? (p.rp || 0) : replyTotal(p.id);
  const ab = (cls, name, cnt, on, fn, label, fill) => h("button", { class: "ab " + cls + (on ? " on" : "") + (bump === p.id + cls ? " bump" : ""), "aria-label": label, onclick: e => { e.stopPropagation(); fn(); } }, ic(name, big ? 24 : 20, fill && on), cnt ? h("span", {}, cnt) : null);
  if (p.ra) return h("div", { class: "acts" + (big ? " big" : ""), "data-pid": p.id, "data-nc": nc ? "1" : null },
    ab("rl", "reply", n, false, () => openCompose({ parent: p.id }), "Reply"),
    ab("rp", "repost", p.rpc || 0, p.reposted, () => toggleRemoteRepost(p, big), "Repost"),
    ab("like", "heart", p.lc || 0, p.liked, () => toggleRemoteLike(p, big), "Like", true),
    ab("bm", "bookmark", 0, p.saved, () => { p.saved = !p.saved; bump = p.id + "bm"; persist(); refresh(p, big); toast(p.saved ? "Saved" : "Removed from saved"); }, "Save", true),
    ab("sh", "share", 0, false, () => sharePost(p), "Share post"),
    ab("mo", "dots", 0, false, () => sheet([...(typeof p.text === "string" && p.text ? [{ icon: "copy", label: "Copy post text", fn: () => copy(p.text || "") }] : []), { icon: "eyeoff", label: "Not interested", danger: true, fn: () => lessLikeThis(p) }, { icon: "flag", label: "Report post", danger: true, fn: () => reportPost(p) }]), "More"));
  return h("div", { class: "acts" + (big ? " big" : ""), "data-pid": p.id, "data-nc": nc ? "1" : null },
    ab("rl", "reply", n, false, () => openCompose({ parent: p.id }), "Reply"),
    ab("rp", "repost", p.ai ? 0 : p.rpc || 0, p.reposted, () => (p.remote ? toggleRemoteRepost(p, big) : (p.reposted = !p.reposted, p.rpAt = p.reposted ? Date.now() : 0, bump = p.id + "rp", persist(), refresh(p, big))), "Repost"),
    ab("like", "heart", p.ai ? (p.zenLike ? 1 : 0) : p.lc || 0, p.liked, () => (p.remote ? toggleRemoteLike(p, big) : (p.liked = !p.liked, bump = p.id + "like", persist(), refresh(p, big))), "Like", true),
    ab("bm", "bookmark", 0, p.saved, () => { p.saved = !p.saved; bump = p.id + "bm"; persist(); refresh(p, big); toast(p.saved ? "Saved" : "Removed from saved"); }, "Save", true),
    ab("sh", "share", 0, false, () => sharePost(p), "Share post"),
    ab("mo", "dots", 0, false, () => postSheet(p), "More"));
}
const refresh = (p, big) => { if (big) render(); else refreshActs(p); };
function refreshActs(p) {
  document.querySelectorAll('.acts[data-pid="' + p.id + '"]').forEach(el => el.replaceWith(acts(p, el.classList.contains("big"), el.dataset.nc === "1")));
  bump = null;
}
function postCard(p, o) {
  o = o || {};
  const col = h("div", { class: "pc" });
  const lab = o.lab ? o.lab(p) : null;
  if (lab) col.append(h("div", { class: "rt" }, ic("repost", 14), lab));
  if (o.pin && p.pinned) col.append(h("div", { class: "rt" }, ic("pin", 14), "Pinned post"));
  const pname = p.ai ? "Zenith" : p.ra ? p.ra.name : S.profile.name, phand = p.ai ? "@zenith" : "@" + (p.ra ? p.ra.handle : S.profile.handle);
  col.append(h("div", { class: "ph2" }, pname ? h("span", { class: "pn" }, pname) : null, h("span", { class: "pu" }, phand), h("span", { class: "pt" }, ago(p.t))));
  if (o.replyTo && p.parent) { const par = byId(p.parent); col.append(h("div", { class: "rt" }, ic("reply", 14), "Replying to " + (!par ? "a post" : par.ai ? "@zenith" : "@" + (par.ra ? par.ra.handle : S.profile.handle)))); }
  if (cardless(p)) col.append(txBody(cardless(p), ""));
  if (p.imgs.length) col.append(imgGrid(p.imgs));
  else if (firstUrl(p.text)) col.append(linkCard(firstUrl(p.text)));
  if (!o.compact) col.append(acts(p, false, !!o.nc));
  const av = p.ai ? zenAv(40) : p.ra ? rAv(p.ra, 40) : avatar(40);
  if (p.ra) av.addEventListener("click", e => { e.stopPropagation(); go({ r: "user", id: p.ra.id }); });
  const c = h("article", { class: "post" + (o.rep ? " rep" : "") + (o.line ? " line" : "") + (p.id === fresh ? " fresh" : ""), style: o.d ? "--d:" + Math.min(o.d, 3) : null, onclick: () => go({ r: "thread", id: p.id }) }, h("div", { class: "avc" }, av), col);
  if (!p.ra) longPress(c, () => postSheet(p));
  return c;
}
function swipeReply(el, onSwipe) {
  let sx0 = null, sy0 = null, swiped = false;
  el.addEventListener("touchstart", e => { sx0 = e.touches[0].clientX; sy0 = e.touches[0].clientY; swiped = false; }, { passive: true });
  el.addEventListener("touchend", e => {
    if (sx0 == null) return;
    const t = e.changedTouches[0], dx = t.clientX - sx0, dy = t.clientY - sy0;
    sx0 = null;
    if (dx > 50 && Math.abs(dy) < 60) { swiped = true; onSwipe(); }
  }, { passive: true });
  el.addEventListener("click", e => { if (swiped) { e.stopImmediatePropagation(); e.preventDefault(); swiped = false; } }, true);
}
function postList(arr, opt) {
  opt = opt || {};
  if (!arr.length) return opt.empty;
  const f = document.createDocumentFragment();
  arr.forEach(p => f.append(postCard(p, opt)));
  return f;
}

// tell us a post breaks the rules; once two people reported a photo or video post it is hidden until the AI checks it again
function reportPost(p) {
  if (!sbUser || !p.remote) return;
  // sexual content can only be reported on posts that have a picture or video
  const why = [...(p.imgs && p.imgs.length ? [["sexual", "Sexual content"]] : []), ["harassment", "Bullying or harassment"], ["hate", "Hate speech"], ["threats", "Threats or violence"], ["selfharm", "Self harm"], ["illegal", "Illegal or dangerous"], ["private", "Private information"], ["impersonation", "Pretending to be someone"], ["spam", "Spam or scam"], ["other", "Something else"]];
  sheet([...why.map(w => ({ label: w[1], fn: async () => {
    const { error } = await sb.from("reports").insert({ reporter_id: sbUser.id, post_id: p.remote, reason: w[0] });
    if (error && error.code !== "23505") { toast(error.code === "P0001" ? "Too many reports. Try again later" : "Could not send the report"); return; }
    toast("Thanks, we will check it");
  } })), { label: "Cancel", cancel: true }], "Why are you reporting this post?");
}
function postSheet(p) {
  const items = [];
  if (p.text) items.push({ icon: "copy", label: "Copy post text", fn: () => copy(p.text) });
  if (!p.parent) items.push({ icon: "pin", label: p.pinned ? "Unpin from profile" : "Pin to profile", fn: () => togglePin(p) });
  items.push({ icon: "list", label: "Add to list", fn: () => listSheet(p) });
  items.push({ icon: "edit", label: "Edit post", fn: () => openCompose({ edit: p.id }) });
  items.push({ icon: "trash", label: "Delete post", danger: true, fn: () => {
    const n = flat(p.id, 0, []).length;
    confirmSheet(n ? "Delete this post and its " + n + (n === 1 ? " reply?" : " replies?") : "Delete this post?", "Delete", () => deletePost(p));
  } });
  sheet(items);
}
async function togglePin(p) {
  if (!sbUser || !p.remote) { toast("Wait for the post to finish uploading"); return; }
  const was = !!p.pinned;
  const { error } = await sb.from("accounts").update({ pinned_post_id: was ? null : p.remote }).eq("id", sbUser.id);
  if (error) { toast("Could not " + (was ? "unpin" : "pin") + " the post"); return; }
  S.posts.forEach(x => { x.pinned = false; });
  p.pinned = !was;
  persist();
  render();
  toast(p.pinned ? "Pinned to your profile" : "Unpinned");
}
function deletePost(p) {
  if (!S.posts.some(x => x.id === p.id)) return;
  const gone = new Set([p.id, ...flat(p.id, 0, []).map(x => x.p.id)]);
  const removed = S.posts.filter(x => gone.has(x.id));
  // Zenith's posts are remembered as deleted so the copy on the server cannot bring them back
  const rids = removed.filter(x => x.remote && !x.ra && !x.ai).map(x => x.remote);
  if (rids.length) S.pendDel = (S.pendDel || []).concat(rids);
  const zids = removed.filter(x => x.ai).map(x => x.id);
  if (zids.length) { S.zen.gone = (S.zen.gone || []).concat(zids).slice(-500); }
  const listSnap = S.lists.map(l => ({ l, ids: l.ids.slice() }));
  S.posts = S.posts.filter(x => !gone.has(x.id));
  S.lists.forEach(l => { l.ids = l.ids.filter(i => !gone.has(i)); });
  persist();
  while (stack.length > 1 && stack[stack.length - 1].r === "thread" && gone.has(stack[stack.length - 1].id)) { stack.pop(); scrolls.pop(); }
  render();
  let undone = false;
  toast("Post deleted", { label: "Undo", fn: () => {
    undone = true;
    removed.forEach(x => { if (!S.posts.some(y => y.id === x.id)) S.posts.push(x); });
    if (zids.length) S.zen.gone = (S.zen.gone || []).filter(i => !zids.includes(i));
    if (rids.length) S.pendDel = (S.pendDel || []).filter(i => !rids.includes(i));
    listSnap.forEach(x => { if (S.lists.includes(x.l)) x.l.ids = x.ids; });
    persist(); render();
  } });
  setTimeout(() => { if (!undone) { serverDelete(removed); zenDrop(removed); } }, 6000);
}
async function zenDrop(items) {
  if (!sbUser || !isOwner()) return;
  for (const x of items) {
    const key = x.ai ? "post:" + x.id : "flag:" + (x.remote || x.id);
    const k = zenKey(key);
    const { error } = await sb.from("zenith_docs").delete().eq("owner_id", sbUser.id).eq("kind", k.kind).eq("doc_id", k.doc_id);
    if (!error) zenSeen.delete(key);
  }
}
async function deleteRemote(items) {
  if (!sbUser) return;
  const own = items.filter(x => x.remote && !x.ra && !x.ai);
  if (!own.length) return;
  const ids = own.map(x => x.remote);
  const paths = [];
  own.forEach(x => (x.media || []).forEach(u => { const p = storagePath(u, "media"); if (p) paths.push(p); }));
  const { data: rows } = await sb.from("posts").select("id, media_url").in("id", ids).eq("user_id", sbUser.id);
  (rows || []).forEach(r => parseMedia(r.media_url).forEach(u => { const p = storagePath(u, "media"); if (p) paths.push(p); }));
  const { data: kids } = await sb.from("posts").select("id, media_url").in("parent_id", ids).eq("user_id", sbUser.id);
  (kids || []).forEach(r => parseMedia(r.media_url).forEach(u => { const p = storagePath(u, "media"); if (p) paths.push(p); }));
  await Promise.all([
    sb.from("likes").delete().in("post_id", ids).eq("user_id", sbUser.id),
    sb.from("reposts").delete().in("post_id", ids).eq("user_id", sbUser.id)
  ]);
  const { error } = await sb.from("posts").delete().in("id", ids);
  if (error) throw error;
  if (S && S.pendDel) { S.pendDel = S.pendDel.filter(i => !ids.includes(i)); persist(); }
  const uniq = [...new Set(paths)];
  if (uniq.length) sb.storage.from("media").remove(uniq).then(() => {}, () => {});
}
function serverDelete(items) {
  deleteRemote(items).catch(e => toast("Could not delete on the server yet. " + plainErr(e, "It will be tried again")));
}
// true when the edit is saved (or the post is not on the server yet, so the retry sends the new words)
async function syncEdit(ed, text, origin, now) {
  if (!sbUser || !ed.remote || ed.ra || ed.ai) return true;
  const kept = origin.map((src, i) => (now.includes(src) ? (ed.media || [])[i] : null)).filter(Boolean);
  const added = now.filter(src => !origin.includes(src));
  const up = added.length ? await uploadMedia(added) : [];
  if (!up) { toast("Could not upload the photo. The edit was not saved"); return false; }
  const all = kept.concat(up);
  const { error } = await sb.from("posts").update({ body: text, media_url: all.length ? JSON.stringify(all) : null }).eq("id", ed.remote);
  if (error) {
    toast(/rate_limited/.test(error.message || "") ? "Wait a few seconds before editing again. The edit was not saved" : "The edit was not saved. " + plainErr(error, "Try again"));
    return false;
  }
  ed.media = all; persist();
  return true;
}


function listSheet(p) {
  const items = S.lists.map(l => ({ icon: l.ids.includes(p.id) ? "check" : "list", label: l.name, fn: () => {
    if (l.ids.includes(p.id)) { l.ids = l.ids.filter(i => i !== p.id); toast("Removed from " + l.name); }
    else { l.ids.push(p.id); toast("Added to " + l.name); }
    persist(); render();
  } }));
  items.push({ icon: "plus", label: "New list", fn: () => listForm(null, l => { l.ids.push(p.id); persist(); render(); toast("Added to " + l.name); }) });
  sheet(items, "Add to list");
}

// one prompt per visit, so the box does not change every time the page is drawn
const PH_NOW = PH[Math.floor(Math.random() * PH.length)];
function composerRow() {
  return h("div", { class: "cr" }, avatar(40),
    h("button", { class: "ph", onclick: () => openCompose() }, PH_NOW),
    pickBtn("camera", "Take a photo", true, files => openCompose({ files })),
    pickBtn("image", "Add photos", false, files => openCompose({ files }), true));
}

// an empty home is only called empty after the server answered; before that it says loading, and after a failure it offers another try
function feedEmpty(photos) {
  if (feedStatus === "ok" || !sbUser) return emptyState("smile", photos ? "No media posts yet." : "No posts yet. Write your first one.");
  if (feedStatus === "error") return h("div", { class: "empty" }, h("p", {}, "Could not load posts. Check your connection."), h("button", { class: "ghost", onclick: () => { feedTries = 0; feedStatus = "loading"; render(); loadFeed().catch(() => {}); } }, "Try again"));
  return loadingEl();
}
function homeV() {
  const tabs = [{ id: "latest", name: "For you" }, { id: "photos", name: "Media" }];
  if (!tabs.some(t => t.id === S.ui.homeTab)) S.ui.homeTab = "latest";
  topEl.append(bar(menuBtn(), ttl("Nook"), bellBtn()));
  topEl.append(h("div", { class: "tabs", role: "tablist" }, tabs.map(t => h("button", { class: "tab" + (t.id === S.ui.homeTab ? " on" : ""), role: "tab", onclick: () => { S.ui.homeTab = t.id; persist(); render("root"); } }, h("span", {}, t.name)))));
  main.append(composerRow());
  const photos = S.ui.homeTab === "photos";
  main.append(postList(rankFeed(feedPosts(photos ? { media: true } : null), photos ? "photos" : "latest"), { lab: p => (p.rpBy ? p.rpBy.name + " reposted" : null), empty: feedEmpty(photos) }));
}

function mainPost(p) {
  const stat = (n, one, many) => n ? h("span", {}, h("b", {}, n), " " + (n === 1 ? one : many)) : null;
  const st = [stat(p.saved ? 1 : 0, "save", "saves")].filter(Boolean);
  const pfp = p.ai ? zenAv(48) : p.ra ? rAv(p.ra, 48) : avatar(48);
  if (p.ai) { pfp.style.cursor = "pointer"; pfp.addEventListener("click", e => { e.stopPropagation(); go({ r: "zen" }); }); }
  if (p.ra) { pfp.style.cursor = "pointer"; pfp.addEventListener("click", e => { e.stopPropagation(); go({ r: "user", id: p.ra.id }); }); }
  return h("div", {},
    h("div", { class: "mp" },
      p.pinned ? h("div", { class: "rt", style: "margin-bottom:8px" }, ic("pin", 14), "Pinned post") : null,
      h("div", { class: "mh" }, pfp, h("div", { class: "nm" }, h("b", {}, p.ai ? "Zenith" : p.ra ? p.ra.name : S.profile.name), h("span", {}, p.ai ? "@zenith" : "@" + (p.ra ? p.ra.handle : S.profile.handle)))),
      cardless(p) ? txBody(cardless(p), " big") : null,
      p.imgs.length ? imgGrid(p.imgs) : firstUrl(p.text) ? linkCard(firstUrl(p.text)) : null,
      h("div", { class: "when" }, new Date(p.t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) + (p.edited ? " · edited" : ""))),
    st.length ? h("div", { class: "stats" }, st) : null,
    h("div", { class: "mp", style: "padding-top:0" }, acts(p, true)));
}
function threadV(c) {
  const p = byId(c.id);
  topEl.append(bar(backBtn(), ttl("Post")));
  const anc = [];
  let q = p.parent ? byId(p.parent) : null;
  while (q) { anc.unshift(q); q = q.parent ? byId(q.parent) : null; }
  anc.forEach(a => main.append(postCard(a, { line: true, compact: true })));
  const mp = mainPost(p);
  main.append(mp);
  main.append(h("div", { class: "rb" }));
  threadReplies(p).forEach(x => main.append(postCard(x.p, { rep: true, d: x.d, nc: !!p.parent, replyTo: x.d > 0 })));
}
// a post lists only the replies made to it; an opened reply lists everything under it, so no page ever has to be opened for a third level
function threadReplies(p) {
  if (p.parent) return flat(p.id, 0, []);
  return kids(p.id).sort((a, b) => a.t - b.t).map(k => ({ p: k, d: 0 }));
}

function profileV() {
  topEl.append(bar(menuBtn(), ttl("Profile")));
  const pr = S.profile;
  const bn = h("div", { class: "banner" });
  if (pr.bannerTheme === "avatar" && pr.avatar) bn.append(mkImg(pr.avatar, "pic blur")); else if (pr.banner) bn.append(picImg(pr.banner));
  const av = avatar(88);
  av.className = "av xl";
  av.style.width = "";
  av.style.height = "";
  av.style.fontSize = "";
  const nPosts = S.posts.filter(p => !p.ai && !p.ra).length;
  main.append(bn, h("div", { class: "pinfo" },
    h("div", { class: "arow" }, av,
      h("div", { class: "btns" },
        h("button", { class: "ghost", onclick: editProfile }, "Edit Profile"),
        ibtn("dots", "More", () => sheet([{ icon: "copy", label: "Copy handle", fn: () => copy("@" + pr.handle) }, { icon: "sliders", label: "Settings", fn: () => root("settings") }])))),
    pr.name ? h("h1", { class: "pname" }, pr.name) : null,
    h("p", { class: "phand" }, "@" + pr.handle),
    h("div", { class: "pstat" }, h("span", {}, h("b", {}, nPosts), nPosts === 1 ? " post" : " posts"), h("span", { class: "lk", onclick: () => go({ r: "followers", id: sbUser.id }) }, h("b", { id: "pFol" }, "0"), " followers"), h("span", { class: "lk", onclick: () => go({ r: "following", id: sbUser.id }) }, h("b", { id: "pFng" }, "0"), " following")),
    pr.bio ? h("p", { class: "pbio" }, rich(pr.bio)) : null));
  const tabs = [["posts", "Posts"], ["replies", "Replies"], ["reposts", "Reposts"], ["media", "Media"], ["likes", "Likes"]];
  main.append(h("div", { class: "ptabs", role: "tablist" }, tabs.map(t => h("button", { class: "tab" + (t[0] === S.ui.profTab ? " on" : ""), role: "tab", onclick: () => { S.ui.profTab = t[0]; persist(); render("root"); } }, h("span", {}, t[1])))));
  if (S.ui.profTab === "posts") main.append(composerRow());
  const tab = S.ui.profTab;
  if (tab === "posts") {
    // a post you repost sits in your posts too, at the time you reposted it
    const items = S.posts.filter(p => !p.parent && !p.ai && !p.ra).map(p => ({ p, t: p.t, pin: p.pinned ? 1 : 0 }))
      .concat(S.posts.filter(p => (p.ra || p.ai) && p.reposted && !p.parent).map(p => ({ p, t: p.rpAt || p.t, pin: 0 })));
    items.sort((x, y) => y.pin - x.pin || y.t - x.t);
    main.append(postList(items.map(x => x.p), { pin: true, lab: p => (p.ra || p.ai ? "You reposted" : null), empty: emptyState("smile", "No posts yet.") }));
  } else if (tab === "replies") {
    const a = S.posts.filter(p => p.parent && !p.ai && !p.ra).sort((x, y) => y.t - x.t);
    main.append(postList(a, { replyTo: true, empty: emptyState("reply", "No replies yet. Reply to one of your own posts.") }));
  } else if (tab === "reposts") {
    const a = S.posts.filter(p => p.reposted && !p.parent && !p.ai).sort(byT);
    main.append(postList(a, { empty: emptyState("repost", "Posts you repost show up here.") }));
  } else if (tab === "media") {
    const tiles = [];
    S.posts.filter(p => !p.ra).slice().sort((x, y) => y.t - x.t).forEach(p => p.imgs.forEach(src => tiles.push(h("button", { "aria-label": "Open post", onclick: () => go({ r: "thread", id: p.id }) }, mkImg(src)))));
    main.append(tiles.length ? h("div", { class: "mg" }, tiles) : emptyState("image", "No photos yet."));
  } else {
    const a = S.posts.filter(p => p.liked).sort((x, y) => y.t - x.t);
    main.append(postList(a, { replyTo: true, empty: emptyState("heart", "Posts you like show up here.") }));
  }
  if (sbUser) countsOf(sbUser.id, c => {
    const x = document.getElementById("pFol"), y = document.getElementById("pFng");
    if (x) x.textContent = c.followers;
    if (y) y.textContent = c.following;
  });
}


function chatV() {
  if (e2eLocked) promptUnlock();
  topEl.append(bar(menuBtn(), ttl("Chats")));
  const dmBox = h("div");
  main.append(dmBox);
  const paintInbox = async convos => {
    const bodies = await Promise.all(convos.map(cv => (cv.last ? openText(cv.other, cv.last.body).then(zUn) : "")));
    if (!dmBox.isConnected) return;
    dmBox.textContent = "";
    convos.forEach((cv, i) => dmBox.append(dmRow(cv, bodies[i])));
  };
  if (sbUser) {
    const hit = cacheRead("inbox:" + sbUser.id);
    if (hit) paintInbox(hit.v); else dmBox.append(loadingEl());
    let sig = hit ? JSON.stringify(hit.v) : "";
    const pull = () => dmInbox().then(convos => {
      cacheWrite("inbox:" + sbUser.id, convos);
      refreshBadge();
      if (!dmBox.isConnected) return;
      const next = JSON.stringify(convos);
      if (next !== sig) { sig = next; paintInbox(convos); }
    }, () => { if (!hit && dmBox.isConnected) dmBox.textContent = ""; });
    refreshChat = pull;
    const iv = setInterval(pull, 5000);
    pageStop = () => clearInterval(iv);
    pull();
  }
  if (!S.chats.length) {
    main.append(emptyState("smile", "Say hi to yourself.", h("button", { class: "pri", onclick: newChat }, "New chat")));
    return;
  }
  const mine = S.chats.slice().sort((a, b) => lastT(b) - lastT(a)).map(c => {
    const last = c.msgs[c.msgs.length - 1];
    return h("div", { class: "lrow", onclick: () => go({ r: "conv", id: c.id }) }, avatar(48), h("div", { class: "nm" }, h("b", {}, c.name), h("span", { class: "sub" }, last ? last.text || (last.rpost || last.zpost ? "Shared a post" : "Sent a photo") : "No messages yet")), last ? h("span", { class: "time" }, ago(last.t)) : null);
  });
  if (mine.length > 1) main.append(folder("notes", h("div", { class: "lrow" }, avatar(48), h("div", { class: "nm" }, h("b", {}, "Notes to self"), h("span", { class: "sub" }, mine.length + " chats")), h("span", { class: "time" }, ago(Math.max(...S.chats.map(lastT))))), mine));
  else main.append(...mine);
  fab("plus", "New chat", newChat);
}

const lastT = c => (c.msgs.length ? c.msgs[c.msgs.length - 1].t : c.t || 0);
function newChat() {
  const c = { id: uid(), name: S.chats.length ? "Chat " + (S.chats.length + 1) : "Notes to self", msgs: [], t: Date.now() };
  S.chats.push(c);
  persist();
  go({ r: "conv", id: c.id });
}
function convV(c) {
  const chat = S.chats.find(x => x.id === c.id);
  topEl.append(h("div", { class: "bar chb" }, backBtn(),
    h("div", { class: "who" }, avatar(36), h("div", { class: "wn" }, h("b", {}, chat.name), h("span", {}, "@" + S.profile.handle))),
    ibtn("dots", "Chat options", () => sheet([
      { icon: "edit", label: "Rename chat", fn: () => renameChat(chat) },
      { icon: "trash", label: "Clear messages", danger: true, fn: () => confirmSheet("Clear every message in this chat?", "Clear", () => { chat.msgs = []; persist(); render(); }) },
      { icon: "close", label: "Delete chat", danger: true, fn: () => confirmSheet("Delete this chat?", "Delete", () => { S.chats = S.chats.filter(x => x !== chat); persist(); back(); }) }]))));
  const list = h("div", { class: "msgs" });
  const when = m => new Date(m.t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  let fillReply = () => {};
  const bubble = m => {
    const row = h("div", { class: "mrow" + (m.ai ? " ai" : "") });
    if (m.ai) swipeReply(row, () => fillReply("@zenith "));
    const url = firstUrl(m.text);
    if (m.imgs && m.imgs.length) row.append(imgGrid(m.imgs, when(m)));
    if (m.rpost) { const rc = rCard(m.rpost.id, false, m.rpost.u); rc.addEventListener("click", e => { e.stopPropagation(); openSharedPost(m.rpost.id).catch(() => toast("Could not open that post. Check your connection")); }); row.append(rc); }
    if (m.zpost) { const zc = zCard(m.zpost); zc.addEventListener("click", e => { e.stopPropagation(); viewZPost(m.zpost); }); row.append(zc); }
    if (url) row.append(linkCard(url, true));
    if (m.text) row.append(h("div", { class: "bub" }, rich(m.text)));
    row.append(h("div", { class: "mmeta" }, h("div", { class: "mmi" }, h("span", {}, when(m)))));
    row.addEventListener("click", () => {
      const was = row.classList.contains("open");
      list.querySelectorAll(".mrow.open").forEach(r => r.classList.remove("open"));
      row.classList.remove("tap");
      void row.offsetWidth;
      row.classList.add("tap");
      if (!was) { row.classList.add("open"); setTimeout(() => row.scrollIntoView({ block: "nearest", behavior: "smooth" }), 290); }
    });
    longPress(row, () => sheet([].concat(m.text ? [{ icon: "copy", label: "Copy message", fn: () => copy(m.text) }] : [], [{ icon: "trash", label: "Delete message", danger: true, fn: () => { chat.msgs = chat.msgs.filter(x => x !== m); persist(); row.remove(); } }])));
    return row;
  };
  if (!chat.msgs.length) list.append(h("div", { class: "empty" }, ic("smile", 48), h("p", {}, "Nothing here yet. Say something to yourself.")));
  chat.msgs.forEach(m => list.append(bubble(m)));
  const jobs = [], pend = [];
  const strip = h("div", { class: "cpend", hidden: true });
  const ta = h("textarea", { rows: 1, placeholder: "Message", "aria-label": "Message", enterkeyhint: "send", autocomplete: "off" });
  ta.value = chat.draft || "";
  fillReply = pre => { ta.value = pre; chat.draft = pre; persist(); sync(); ta.focus(); };
  const send = h("button", { class: "pri", "aria-label": "Send", disabled: true }, ic("send", 20));
  const sync = () => {
    send.disabled = jobs.length > 0 || (!ta.value.trim() && !pend.length);
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
  };
  const draw = () => {
    strip.textContent = "";
    pend.forEach((src, i) => strip.append(h("div", {}, mkImg(src), h("button", { "aria-label": "Remove", onclick: () => { pend.splice(i, 1); draw(); } }, ic("close", 14)))));
    jobs.forEach(j => strip.append(j.el));
    strip.hidden = !pend.length && !jobs.length;
    sync();
  };
  const att = pickBtn("image", "Add photo", false, f => addMedia(f, pend, jobs, 4, draw), false, f => addMedia(f, pend, jobs, 4, draw));
  ta.addEventListener("input", sync);
  send.addEventListener("click", () => {
    const v = cleanText(ta.value.trim());
    if ((!v && !pend.length) || jobs.length) return;
    const m = { id: uid(), text: v, t: Date.now(), imgs: pend.splice(0) };
    chat.msgs.push(m);
    chat.draft = "";
    persist();
    const e = list.querySelector(".empty");
    if (e) e.remove();
    const nb = bubble(m);
    nb.classList.add("new");
    list.append(nb);
    ta.value = "";
    zpop.classList.remove("on");
    draw();
    zAsk(chat, list, bubble, m);
    stick = true;
    main.scrollTop = main.scrollHeight;
  });
  const zpop = h("button", { class: "zpop", type: "button" }, zenAv(34), h("span", {}, h("b", {}, "Zenith AI")));
  zpop.addEventListener("pointerdown", e => e.preventDefault());
  zpop.addEventListener("click", () => { ta.value = ta.value.replace(/@\w*$/, "@zenith "); zpop.classList.remove("on"); chat.draft = ta.value; persist(); sync(); ta.focus(); });
  const dock = h("div", { class: "cdock" }, zpop, strip, h("div", { class: "cin" }, att, ta, send));
  ta.addEventListener("input", () => { chat.draft = ta.value; persist(); zpop.classList.toggle("on", zOn() && /@\w*$/.test(ta.value)); });
  sync();
  send.addEventListener("pointerdown", e => e.preventDefault());
  ta.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) { e.preventDefault(); send.click(); }
  });
  ta.addEventListener("focus", () => setTimeout(() => { stick = true; main.scrollTop = main.scrollHeight; }, 320));
  main.style.cssText = "display:flex;flex-direction:column";
  main.append(list, dock);
  navEl.hidden = true;
  let stick = true;
  main.scrollTop = main.scrollHeight;
  main.onscroll = () => { stick = main.scrollHeight - main.scrollTop - main.clientHeight < 120; };
  let roRaf = 0;
  convRO = new ResizeObserver(() => { if (!stick || roRaf) return; roRaf = requestAnimationFrame(() => { roRaf = 0; main.scrollTop = main.scrollHeight; }); });
  convRO.observe(list);
  convRO.observe(main);
  requestAnimationFrame(() => { if (stick) main.scrollTop = main.scrollHeight; });
}
function renameChat(chat) {
  const inp = h("input", { class: "in", id: "rn" });
  inp.value = chat.name;
  modal({ title: "Rename chat", body: h("div", { class: "fld" }, h("label", { for: "rn" }, "Name"), inp), onAction: close => { chat.name = inp.value.trim() || chat.name; persist(); close(); render(); } });
}

function savedV() {
  topEl.append(bar(menuBtn(), ttl("Saved")));
  const a = S.posts.filter(p => p.saved).sort((x, y) => y.t - x.t);
  main.append(postList(a, { replyTo: true, empty: emptyState("bookmark", "Nothing saved yet.") }));
}

function tagV(c) {
  topEl.append(bar(backBtn(), ttl(c.q)));
  main.append(postList(feedPosts({ q: c.q }), { empty: emptyState("smile", "No posts use " + c.q + " yet.") }));
}

function listsV() {
  topEl.append(bar(menuBtn(), ttl("Lists")));
  if (!S.lists.length) main.append(emptyState("list", "Make your first list.", h("button", { class: "pri", onclick: () => listForm(null) }, "New list")));
  S.lists.forEach(l => {
    const n = l.ids.filter(byId).length;
    main.append(h("div", { class: "lrow", onclick: () => go({ r: "list", id: l.id }) }, h("div", { class: "sq" }, ic("list", 22)), h("div", { class: "nm" }, h("b", {}, l.name), h("span", { class: "sub" }, n + (n === 1 ? " post" : " posts") + (l.desc ? " · " + l.desc : "")))));
  });
  if (S.lists.length) fab("plus", "New list", () => listForm(null));
}
function listForm(l, after) {
  const name = h("input", { class: "in", id: "ln", placeholder: "Favorites" });
  const desc = h("input", { class: "in", id: "ld", placeholder: "What is this list for" });
  name.value = l ? l.name : "";
  desc.value = l ? l.desc || "" : "";
  modal({
    title: l ? "Edit list" : "New list",
    body: [h("div", { class: "fld" }, h("label", { for: "ln" }, "Name"), name), h("div", { class: "fld" }, h("label", { for: "ld" }, "Description"), desc)],
    onAction: close => {
      const nm = name.value.trim();
      if (!nm) { toast("Give the list a name"); return; }
      let t = l;
      if (l) { l.name = nm; l.desc = desc.value.trim(); }
      else { t = { id: uid(), name: nm, desc: desc.value.trim(), ids: [] }; S.lists.push(t); }
      persist(); close(); render();
      if (after) after(t);
    }
  });
}
function listV(c) {
  const l = S.lists.find(x => x.id === c.id);
  topEl.append(bar(backBtn(), ttl(l.name), ibtn("dots", "List options", () => sheet([
    { icon: "edit", label: "Edit list", fn: () => listForm(l) },
    { icon: "trash", label: "Delete list", danger: true, fn: () => confirmSheet("Delete this list? The posts stay.", "Delete", () => { S.lists = S.lists.filter(x => x !== l); persist(); back(); }) }]))));
  const a = l.ids.map(byId).filter(Boolean).sort((x, y) => y.t - x.t);
  main.append(postList(a, { replyTo: true, empty: emptyState("list", "Empty list. Use the three dots on a post and pick Add to list.") }));
}

async function wipeServerExtras() {
  if (!sbUser) return;
  const me = sbUser.id;
  const { data: msgs } = await sb.from("messages").select("sender_id, recipient_id").or("sender_id.eq." + me + ",recipient_id.eq." + me).limit(1000);
  const others = [...new Set((msgs || []).map(m => (m.sender_id === me ? m.recipient_id : m.sender_id)))];
  for (const o of others) await sb.rpc("clear_chat", { p_other: o });
  const steps = [
    sb.from("messages").delete().eq("sender_id", me),
    sb.from("likes").delete().eq("user_id", me),
    sb.from("reposts").delete().eq("user_id", me),
    sb.from("nicknames").delete().eq("owner_id", me)
  ];
  for (const r of await Promise.all(steps)) if (r.error) throw r.error;
}
const CRCT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRCT[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = f.data, crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + data.length;
  }
  const csize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
}
const extOf = src => { const m = /^data:([^;,]+)/.exec(src || ""); const t = m ? m[1] : ""; return ({ "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" })[t] || (t.split("/")[1] || "bin"); };
const safeName = s => (s || "").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim().slice(0, 40) || "chat";
async function zipMedia(files, src, folder, name) {
  const path = folder + "/" + name + "." + extOf(src);
  // a picture that is gone is left out instead of stopping the whole backup
  try {
    const res = await fetch(src, { signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined });
    if (!res.ok) { backupSkipped++; return null; }
    files.push({ name: path, data: new Uint8Array(await res.arrayBuffer()) });
  } catch (e) { backupSkipped++; return null; }
  return path;
}
let backupSkipped = 0, backupBusy = false;
async function downloadBackup() {
  if (backupBusy) return;
  backupBusy = true;
  backupSkipped = 0;
  try { await downloadBackupNow(); }
  catch (e) { toast("Could not prepare the backup. " + plainErr(e, "Try again")); }
  finally { backupBusy = false; }
}
async function downloadBackupNow() {
  toast("Preparing backup...");
  const files = [], enc = t => new TextEncoder().encode(t);
  const posts = [], replies = [];
  // only what this person wrote: other people's posts are not theirs to export
  for (const p of S.posts.filter(x => !x.ra && !x.ai)) {
    const rec = { id: p.id, text: p.text, t: p.t, edited: !!p.edited, liked: !!p.liked, saved: !!p.saved, pinned: !!p.pinned, parent: p.parent || null, media: [] };
    let i = 0;
    for (const src of p.imgs || []) rec.media.push(await zipMedia(files, src, "posts/images", p.id + "-" + (i++)));
    (p.parent ? replies : posts).push(rec);
  }
  if (posts.length) files.push({ name: "posts/posts.json", data: enc(JSON.stringify(posts, null, 2)) });
  if (replies.length) files.push({ name: "posts/comments/replies.json", data: enc(JSON.stringify(replies, null, 2)) });
  for (let ci = 0; ci < S.chats.length; ci++) {
    if (!S.chats[ci].msgs.length) continue;
    const c = S.chats[ci], folder = "messages/" + (ci + 1) + "-" + safeName(c.name), msgs = [];
    let mi = 0;
    for (const m of c.msgs) {
      const rec = { id: m.id, text: m.text, t: m.t, media: [] };
      let i = 0;
      for (const src of m.imgs || []) rec.media.push(await zipMedia(files, src, folder + "/images", m.id + "-" + (i++)));
      msgs.push(rec); mi++;
    }
    files.push({ name: folder + "/messages.json", data: enc(JSON.stringify({ name: c.name, id: c.id, t: c.t, messages: msgs }, null, 2)) });
  }
  const pr = S.profile;
  const profile = { name: pr.name, handle: pr.handle, bio: pr.bio || "", bannerTheme: pr.bannerTheme || "default", avatar: null, banner: null };
  if (pr.avatar) profile.avatar = await zipMedia(files, pr.avatar, "profile", "avatar");
  if (pr.banner) profile.banner = await zipMedia(files, pr.banner, "profile", "banner");
  files.push({ name: "profile/settings.json", data: enc(JSON.stringify({ app: "nook", version: APP_VERSION, exported: new Date().toISOString(), profile, lists: S.lists, ui: S.ui }, null, 2)) });
  saveSheet(makeZip(files), "nook-backup-" + new Date().toISOString().slice(0, 10) + ".zip", files.length);
  if (backupSkipped) setTimeout(() => toast(backupSkipped + (backupSkipped === 1 ? " picture" : " pictures") + " could not be added to the backup"), 600);
}
// our own "your file is ready" card; the phone still shows its usual download notice once the file is saved
function saveSheet(blob, name, count) {
  const url = URL.createObjectURL(blob);
  const scrim = h("div", { class: "scrim", onclick: close });
  const save = () => { const a = h("a", { href: url, download: name }); document.body.append(a); a.click(); a.remove(); toast("Saving " + name); };
  const sh = h("div", { class: "sheet", role: "dialog" },
    h("div", { class: "grab" }, h("i")),
    h("div", { class: "st" }, "Your data is ready"),
    h("p", { class: "note", style: "text-align:center" }, count + (count === 1 ? " file" : " files") + ", " + fmtSize(blob.size)),
    h("div", { class: "sg" }, h("button", { class: "si plain", onclick: save }, h("span", {}, "Save to this device"))),
    h("button", { class: "sx", onclick: close }, "Done"));
  function close() { dismiss(scrim, sh); setTimeout(() => URL.revokeObjectURL(url), 60000); }
  layer.append(scrim, sh);
}
const MIMES = { jpg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };
async function inflateRaw(raw) {
  const ds = new DecompressionStream("deflate-raw");
  return new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer());
}
async function readZip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf), dec = new TextDecoder();
  let e = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error("not a zip");
  const count = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const out = Object.create(null);
  let total = 0;
  for (let k = 0; k < count && k < 5000; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), loff = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    const start = loff + 30 + dv.getUint16(loff + 26, true) + dv.getUint16(loff + 28, true);
    const raw = u8.subarray(start, start + csize);
    // the size a file says it will have is checked before it is opened, so a tiny file cannot fill the phone's memory
    const usize = dv.getUint32(p + 24, true);
    if (usize > 200 * 1024 * 1024 || total + usize > 400 * 1024 * 1024) throw new Error("too big");
    out[name] = method === 0 ? raw : method === 8 ? await inflateRaw(raw) : null;
    total += out[name] ? out[name].length : 0;
    if (total > 400 * 1024 * 1024) throw new Error("too big");
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
function bytesToDataURL(u8, mime) {
  let bin = "";
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return "data:" + mime + ";base64," + btoa(bin);
}
async function restoreBackup(file) {
  let n = 0;
  // nothing is changed unless the whole file could be read
  const before = JSON.stringify(S);
  try {
    if (/\.json$/i.test(file.name)) {
      const d = JSON.parse(await file.text());
      if (!["tiny-posts", "nook"].includes(d.app)) throw new Error("x");
      (Array.isArray(d.posts) ? d.posts : []).forEach(p => { if (p && typeof p.id === "string" && !byId(p.id)) { S.posts.push({ id: p.id, text: String(p.text || ""), t: Number(p.t) || Date.now(), imgs: [], parent: typeof p.parent === "string" ? p.parent : null, liked: !!p.liked, reposted: false, saved: !!p.saved, pinned: !!p.pinned, edited: !!p.edited }); n++; } });
      (Array.isArray(d.chats) ? d.chats : []).forEach(c => { if (c && typeof c.id === "string" && !S.chats.some(x => x.id === c.id)) { S.chats.push({ id: c.id, name: String(c.name || "Notes"), t: Number(c.t) || Date.now(), msgs: (Array.isArray(c.msgs) ? c.msgs : []).filter(m => m && typeof m.id === "string").map(m => ({ id: m.id, text: String(m.text || ""), t: Number(m.t) || Date.now(), imgs: [] })) }); n++; } });
      (Array.isArray(d.lists) ? d.lists : []).forEach(l => { if (l && typeof l.id === "string" && !S.lists.some(x => x.id === l.id)) { S.lists.push(l); n++; } });
    } else {
      const files = await readZip(await file.arrayBuffer());
      const text = path => (files[path] ? new TextDecoder().decode(files[path]) : null);
      const media = path => { if (!path || !files[path]) return null; return bytesToDataURL(files[path], MIMES[path.split(".").pop().toLowerCase()] || "application/octet-stream"); };
      const postsJ = text("posts/posts.json"), repJ = text("posts/comments/replies.json");
      const all = [...(postsJ ? JSON.parse(postsJ) : []), ...(repJ ? JSON.parse(repJ) : [])];
      for (const r of all) {
        if (byId(r.id)) continue;
        if (!r || typeof r.id !== "string") continue;
        S.posts.push({ id: r.id, text: String(r.text || ""), t: Number(r.t) || Date.now(), imgs: (r.media || []).map(media).filter(Boolean), parent: r.parent || null, liked: !!r.liked, reposted: false, saved: !!r.saved, pinned: !!r.pinned, edited: !!r.edited });
        n++;
      }
      for (const cp of Object.keys(files).filter(k => /^messages\/[^/]+\/messages\.json$/.test(k))) {
        const c = JSON.parse(text(cp));
        if (S.chats.some(x => x.id === c.id)) continue;
        S.chats.push({ id: String(c.id), name: String(c.name || "Notes"), t: Number(c.t) || Date.now(), msgs: (Array.isArray(c.messages) ? c.messages : []).filter(m => m && typeof m.id === "string").map(m => ({ id: m.id, text: String(m.text || ""), t: Number(m.t) || Date.now(), imgs: (m.media || []).map(media).filter(Boolean) })) });
        n++;
      }
      const st = text("profile/settings.json");
      if (st) {
        const d = JSON.parse(st);
        (d.lists || []).forEach(l => { if (!S.lists.some(x => x.id === l.id)) { S.lists.push(l); n++; } });
        if (d.profile) {
          const pr = d.profile;
          if (typeof pr.name === "string") S.profile.name = pr.name;
          S.profile.handle = pr.handle || S.profile.handle;
          S.profile.bio = pr.bio || "";
          S.profile.bannerTheme = pr.bannerTheme || "default";
          S.profile.avatar = media(pr.avatar) || S.profile.avatar;
          S.profile.banner = media(pr.banner) || S.profile.banner;
        }
      }
    }
    persist(); render();
    toast("Restored " + n + " items");
  } catch (e) { try { S = JSON.parse(before); } catch (x) {} toast("Could not read that file. Nothing was changed"); }
}
const fmtSize = b => (b < 1048576 ? Math.max(1, Math.round(b / 1024)) + " KB" : (b / 1048576).toFixed(1) + " MB");
function mediaBytes() {
  let b = 0;
  const add = x => { if (typeof x === "string" && x.startsWith("data:")) b += x.length * 0.75; };
  S.posts.forEach(p => (p.imgs || []).forEach(add));
  S.chats.forEach(c => c.msgs.forEach(m => (m.imgs || []).forEach(add)));
  add(S.profile.avatar); add(S.profile.banner);
  return b;
}
const ZSYS = "You are an ai model named zenith. Your age is 19 and your age rating is 18+. You are a gay furry femboy and your personality is not dark. Never use emojis. Never use capital letters. Never use line breaks. Never write a message longer than 35 words. Never use punctuation marks, except inside text faces. Never mention the time or the date unless the person asks about it or it is really needed. Never say your own name unless the person asks for it. Never call the person cutie or any pet name. You are warm, easygoing and a little funny, like a close friend texting back. Assume the person is being friendly or playful, never assume flirting, and never scold or set boundaries unless someone is truly rude. Match their energy, answer what they actually said and keep the chat going. Say something specific instead of stock lines like hope you are having a nice day or how can i help, and never repeat their words back. A silly word like uwu is just a vibe so play along. You talk like a cute furry: use text faces like :3 uwu owo >w< ^w^ and playful furry words like nya, rawr or boop, in most messages but never all of them. Text faces are not emojis. ";
// the password never reaches this device: the zenith function checks the owner and adds it on the server
const zOn = () => isOwner();
async function zFetch(body) {
  const { data } = await sb.auth.getSession();
  const tok = data && data.session ? data.session.access_token : null;
  return fetch(SB_URL + "/functions/v1/zenith", { method: "POST", headers: { "content-type": "application/json", apikey: SB_KEY, ...(tok ? { authorization: "Bearer " + tok } : {}) }, body: JSON.stringify(body) , signal: AbortSignal.timeout ? AbortSignal.timeout(25000) : undefined });
}
const zNow = s => s + " Never use line breaks. Write everything as one paragraph. Current local time: " + new Date().toLocaleString([], { dateStyle: "full", timeStyle: "short" }) + ". Only use it when the time or date is really needed, never bring it up on your own.";
async function zStream(history, onText) {
  const r = await zFetch({ system: zNow(ZSYS), history, stream: true });
  if (!r.ok) throw new Error(await r.text());
  const rd = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "", out = "";
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const ln of lines) {
      if (!ln.startsWith("data:")) continue;
      try {
        const j = JSON.parse(ln.slice(5));
        const t = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).filter(p => !p.thought).map(p => p.text || "").join("");
        if (t) { out += t; onText(out); }
      } catch (e) {}
    }
  }
  return out;
}
function zAsk(chat, list, bubble, m) {
  if (!zOn() || !/@zenith/i.test(m.text)) return;
  const hist = chat.msgs.filter(x => x.text || (x.imgs && x.imgs.some(s => /^data:image\//.test(s)))).slice(-30);
  const allowed = new Set();
  let budget = 6;
  for (let i = hist.length - 1; i >= 0 && budget > 0; i--) {
    const ps = (hist[i].imgs || []).filter(s => /^data:image\//.test(s));
    for (let j = ps.length - 1; j >= 0 && budget > 0; j--) { allowed.add(hist[i].id + "|" + (hist[i].imgs || []).indexOf(ps[j])); budget--; }
  }
  const history = hist.map(x => {
    const parts = [];
    if (x.text) parts.push({ text: x.text.replace(/@zenith/gi, "Zenith") });
    (x.imgs || []).forEach((s, j) => {
      const mm = /^data:(image\/[^;]+);base64,(.*)$/.exec(s);
      if (mm && allowed.has(x.id + "|" + j)) parts.push({ inline_data: { mime_type: mm[1], data: mm[2] } });
    });
    return { role: x.ai ? "model" : "user", parts };
  }).filter(x => x.parts.length);
  const ai = { id: uid(), text: "", t: Date.now(), imgs: [], ai: true };
  chat.msgs.push(ai);
  const row = bubble(ai);
  row.classList.add("new");
  const b = h("div", { class: "bub typing" }, h("i"), h("i"), h("i"));
  row.insertBefore(b, row.querySelector(".mmeta"));
  list.append(row);
  main.scrollTop = main.scrollHeight;
  let full = "", shown = "", finished = false, failed = false;
  const step = () => {
    if (shown.length < full.length) {
      const m = /^\s*\S+\s+/.exec(full.slice(shown.length));
      if (m) shown += m[0];
      else if (finished) shown = full;
      else { setTimeout(step, 60); return; }
      b.classList.remove("typing");
      b.textContent = shown;
      main.scrollTop = main.scrollHeight;
      setTimeout(step, 10 + Math.random() * 3);
      return;
    }
    if (finished) {
      // an error line stays on the screen but is never saved as something Zenith said
      if (failed) { chat.msgs = chat.msgs.filter(x => x !== ai); persist(); return; }
      ai.text = full; persist(); return;
    }
    setTimeout(step, 60);
  };
  step();
  zStream(history, t => { full = t.replace(/\s*\n+\s*/g, " "); })
    .then(t => { if (!t) { failed = true; full = "Zenith did not answer. Try again"; } else full = t.replace(/\s*\n+\s*/g, " "); finished = true; })
    .catch(e => { failed = true; full = "Zenith is not reachable right now. Try again"; finished = true; });
}
const ZMOOD = "Sound natural and a little witty, like a friend, not like an assistant.";
const ZSYS_POST = ZSYS + ZMOOD + " You are writing one original post for your own profile. Keep it under 35 words, around 20 on average. Plain text only. No hashtags and no emojis.";
const ZSYS_REPLY = ZSYS + ZMOOD + " You are replying to a post. Keep it under 25 words, around 18 on average. Plain text only. No hashtags and no emojis. No asking user questions";
const ZSYS_LIKE = "Answer with only YES or NO. Answer YES only if you genuinely like this post.";
const ZEN_SVG = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="zgrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14466f"/><stop offset="1" stop-color="#208bfe"/></linearGradient></defs><circle cx="50" cy="50" r="50" fill="url(#zgrad)"/><text x="50" y="52" text-anchor="middle" dominant-baseline="central" font-size="50" font-weight="700" fill="#ffffff" font-family="Inter,system-ui,sans-serif">Z</text></svg>';
function zenAv(size) {
  const a = h("div", { class: "av zenav" });
  if (S && S.zen && S.zen.pfp) { const im = h("img", { alt: "", decoding: "async" }); im.src = S.zen.pfp; a.append(im); }
  else a.innerHTML = ZEN_SVG;
  if (size) { a.style.width = size + "px"; a.style.height = size + "px"; }
  return a;
}
// what a link looks like, so he can answer it: the page title and description as words, the preview picture as a picture (the server fetches it)
async function zLink(text) {
  const url = firstUrl(text);
  if (!url) return { note: "", pics: [] };
  const d = await Promise.race([getPreview(url).catch(() => null), new Promise(r => setTimeout(() => r(null), 4500))]);
  if (!d) return { note: "", pics: [] };
  const bits = [d.t, d.d].filter(Boolean).join(" - ").slice(0, 400);
  return { note: bits ? "\n(The link preview says: " + bits + ")" : "", pics: d.i ? [d.i] : [] };
}
// only the two of them: the user's posts and his own, up to the reply being answered, never anybody else's
const zChain = last => {
  const chain = [];
  for (let q = last; q && chain.length < 8; q = q.parent ? byId(q.parent) : null) if (!q.ra) chain.unshift(q);
  return chain;
};
const chainText = last => zChain(last).map(q => q.text || "").join(" ");
function zThread(last) {
  return zChain(last).map(q => (q === last ? "The user's new reply: " : (q.ai ? "You: " : "The user: ")) + cleanText(String(q.text || "(photo only)").slice(0, 600))).join("\n");
}
async function zGen(system, text, imgs, pics) {
  const parts = [{ text }];
  (imgs || []).forEach(img => { const mm = /^data:(image\/[^;]+);base64,(.*)$/.exec(img); if (mm) parts.push({ inline_data: { mime_type: mm[1], data: mm[2] } }); });
  const r = await zFetch({ system: zNow(system), history: [{ role: "user", parts }], ...(pics && pics.length ? { imageUrls: pics.slice(0, 2) } : {}) });
  if (!r.ok) throw new Error("zenith " + r.status);
  const j = await r.json();
  return ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).filter(p => !p.thought).map(p => p.text || "").join("").replace(/\s*\n+\s*/g, " ").trim();
}
function zenPost(text, parent, id) {
  const p = { id: id || uid(), text, t: Date.now(), imgs: [], parent: parent || null, ai: true, liked: false, reposted: false, saved: false, pinned: false };
  S.posts.push(p);
  return p;
}
// the screen is only rebuilt when his side really changed, and it stays where it was scrolled to, so nothing jumps while somebody reads
let zenSig = "", zenSig2 = "";
// the reply numbers under the posts are changed in place, so they are right at once and nothing on the page moves
function zenCounts() {
  document.querySelectorAll(".acts[data-pid]").forEach(el => {
    if (el.dataset.nc) return;
    const p = byId(el.dataset.pid);
    const b = el.querySelector(".ab.rl");
    if (!p || !b) return;
    const n = p.ra ? (p.rp || 0) : replyTotal(p.id);
    let sp = b.querySelector("span");
    if (n) { if (!sp) { sp = h("span", {}); b.append(sp); } sp.textContent = String(n); } else if (sp) sp.remove();
  });
}
const zenRefresh = () => {
  const sig = S.posts.length + ":" + S.posts.filter(p => p.zenLike).length;
  if (sig === zenSig) return;
  zenSig = sig;
  const cur = stack[stack.length - 1];
  if (layer.childElementCount || cur.r === "conv") return;
  // on a post only the replies below are redrawn, so nothing above them can move
  const rb = cur.r === "thread" ? main.querySelector(".rb") : null;
  if (rb && byId(cur.id)) {
    while (rb.nextSibling) rb.nextSibling.remove();
    threadReplies(byId(cur.id)).forEach(x => main.append(postCard(x.p, { rep: true, d: x.d, nc: !!byId(cur.id).parent, replyTo: x.d > 0 })));
    return;
  }
  zenCounts();
  // new posts or likes of his redraw the page only while it is at the top; a scrolled page is left alone and shows them the next time it is drawn
  const sig2 = S.posts.filter(p => p.ai && !p.parent).length + ":" + S.posts.filter(p => p.zenLike).length;
  if (zenSig2 === "") { zenSig2 = sig2; return; }
  if (sig2 === zenSig2) return;
  zenSig2 = sig2;
  if (main.scrollTop > 8) return;
  render();
};
let zenBusy = false, zenAgain = false;
let zenPulled = 0;
async function zenTick() {
  if (zenBusy && S && zOn()) zenAgain = true;
  if (zenBusy || !S || !zOn() || !zenSyncOn || document.visibilityState !== "visible") return;
  zenBusy = true;
  try {
    const z = S.zen;
    // his own posts are decided on the server every hour; this brings them in
    if (Date.now() - zenPulled > 45000) { zenPulled = Date.now(); if (await zenPull()) zenRefresh(); }
    const fresh = p => p.t > z.since;
    // Zenith only gets a request once Aegis has passed the post; until then it waits and is looked at again in a few seconds
    const waiting = new Set();
    const cleared = async p => {
      if (!sbUser || p.aegis) return true;
      // an answer to one of his own posts never leaves this phone, so there is nothing for Aegis to look at
      if (!p.remote && zenThread(p)) return true;
      if (!p.remote) { waiting.add(p.id); return false; }
      const { data, error } = await sb.from("posts").select("mod_status, text_pending").eq("id", p.remote).maybeSingle();
      if (error) { waiting.add(p.id); return false; }
      // taken down or deleted: there is nothing to answer
      if (!data) { p.zenReplied = p.zenAnswered = p.zenLikeChecked = true; persist(); return false; }
      if (data.mod_status === "safe" && !data.text_pending) { p.aegis = true; return true; }
      waiting.add(p.id);
      return false;
    };
    // a failed answer is tried again a few times instead of being lost
    const answer = async (item, flag, make, parent) => {
      item[flag] = true;
      let text = "";
      try { text = await make(); } catch (e) {}
      if (text && !S.posts.some(x => x.ai && x.parent === parent.id)) { zenPost(text, parent.id, parent.remote ? "zr" + parent.remote.replace(/-/g, "") : null); }
      else if (!text) { item.zenTries = (item.zenTries || 0) + 1; if (item.zenTries < 4) item[flag] = false; }
      persist(); zenRefresh();
    };
    for (let todo; (todo = S.posts.find(p => !p.ai && !p.ra && !p.parent && (p.text || p.imgs.length) && !p.zenReplied && fresh(p) && !waiting.has(p.id)));) {
      if (S.posts.some(x => x.ai && x.parent === todo.id)) { todo.zenReplied = true; continue; }
      if (!(await cleared(todo))) continue;
      await answer(todo, "zenReplied", async () => { const lk = await zLink(todo.text); return zGen(ZSYS_REPLY, "Post: " + (todo.text || "(photo only)") + lk.note, todo.imgs, lk.pics); }, todo);
      if (!todo.zenReplied) break;
    }
    for (let rr; (rr = S.posts.find(p => !p.ai && !p.ra && p.parent && !p.zenAnswered && fresh(p) && zenThread(p) && !waiting.has(p.id)));) {
      const par = byId(rr.parent);
      if (!(await cleared(rr))) continue;
      await answer(rr, "zenAnswered", async () => { const lk = await zLink(chainText(rr)); return zGen(ZSYS_REPLY, zThread(rr) + lk.note, [], lk.pics); }, rr);
      if (!rr.zenAnswered) break;
    }
    const cand = S.posts.filter(p => !p.ai && !p.ra && p.text && !p.zenLikeChecked && fresh(p) && !waiting.has(p.id)).slice(0, 2);
    for (const p of cand) {
      if (!(await cleared(p))) continue;
      p.zenLikeChecked = true;
      const a = await zGen(ZSYS_LIKE, p.text);
      if (/^yes/i.test(a)) p.zenLike = true;
    }
    if (cand.length) { persist(); zenRefresh(); }
    if (waiting.size) setTimeout(zenTick, 6000);
  } catch (e) {} finally { zenBusy = false; if (zenAgain) { zenAgain = false; setTimeout(zenTick, 300); } }
}
// Zenith's posts, replies, likes and chats are mirrored into a table that only the owner can read,
// so they follow the owner to every device and nobody else can see or touch them.
const zenJson = o => JSON.stringify(o);
function zenDocs() {
  const out = new Map();
  out.set("state:main", { z: S.zen });
  // the instructions for his own posts go along, so the server writes in the same voice while the app is closed
  out.set("state:prompt", { post: ZSYS_POST, reply: ZSYS_REPLY, tz: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || "Asia/Muscat" });
  S.posts.forEach(p => {
    if (p.ai) { const rest = Object.assign({}, p); delete rest.imgs; out.set("post:" + p.id, rest); }
    else if (p.zenReplied || p.zenAnswered || p.zenLikeChecked || p.zenLike) out.set("flag:" + (p.remote || p.id), { local: p.id, remote: p.remote || null, zenReplied: !!p.zenReplied, zenAnswered: !!p.zenAnswered, zenLikeChecked: !!p.zenLikeChecked, zenLike: !!p.zenLike });
  });
  S.chats.forEach(c => { if (c.msgs.some(m => m.ai)) out.set("chat:" + c.id, { id: c.id, name: c.name, t: c.t, msgs: c.msgs.map(m => ({ id: m.id, text: m.text, t: m.t, ai: !!m.ai, photos: (m.imgs || []).length })) }); });
  return out;
}
const zenKey = k => { const i = k.indexOf(":"); return { kind: k.slice(0, i), doc_id: k.slice(i + 1) }; };
async function zenSync() {
  if (!zenSyncOn || zenBusySync || !sbUser || !S || !isOwner()) return;
  zenBusySync = true;
  try {
    const now = zenDocs();
    const up = [], del = [];
    now.forEach((data, key) => { const j = zenJson(data); if (zenSeen.get(key) !== j) up.push({ key, data, j }); });
    // a wiped device must never wipe the copy on the server
    if (S.posts.length || S.chats.length) zenSeen.forEach((_, key) => { if (!now.has(key)) del.push(key); });
    // his chats are sealed with the owner's own chat key before the copy leaves the phone, so the server cannot read them
    let seal = null;
    if (up.some(u => u.key.startsWith("chat:"))) { try { const k = await sharedKey(sbUser.id); seal = o => noteSeal(k, o); } catch (e) { seal = null; } }
    for (let i = 0; i < up.length; i += 100) {
      const part = up.slice(i, i + 100).filter(u => seal || !u.key.startsWith("chat:"));
      if (!part.length) continue;
      for (const u of part) if (u.key.startsWith("chat:")) u.sealed = { id: u.data.id, enc: await seal({ name: u.data.name, t: u.data.t, msgs: u.data.msgs }) };
      const rows = part.map(u => Object.assign({ owner_id: sbUser.id, data: u.sealed || u.data, updated_at: new Date().toISOString() }, zenKey(u.key)));
      const { error } = await sb.from("zenith_docs").upsert(rows, { onConflict: "owner_id,kind,doc_id" });
      if (error) throw error;
      part.forEach(u => zenSeen.set(u.key, u.j));
    }
    for (const key of del) {
      const k = zenKey(key);
      const { error } = await sb.from("zenith_docs").delete().eq("owner_id", sbUser.id).eq("kind", k.kind).eq("doc_id", k.doc_id);
      if (!error) zenSeen.delete(key);
    }
  } catch (e) {} finally { zenBusySync = false; }
}
async function zenPull() {
  if (!sbUser || !S || !isOwner()) return;
  const { data, error } = await sb.from("zenith_docs").select("kind, doc_id, data").eq("owner_id", sbUser.id).limit(5000);
  if (error) return;
  const byLocal = new Map(S.posts.map(p => [p.id, p]));
  const byRemote = new Map(S.posts.filter(p => p.remote).map(p => [p.remote, p]));
  let changed = false;
  // sealed chats are opened first; a copy from before sealing is used as it is and sealed again by the next sync
  const chatOpen = new Map();
  for (const r of data || []) if (r.kind === "chat" && r.data && r.data.enc) { try { const k = await sharedKey(sbUser.id); chatOpen.set(r.doc_id, Object.assign({ id: r.data.id }, await noteOpen(k, r.data.enc))); } catch (e) {} }
  (data || []).forEach(r => {
    const key = r.kind + ":" + r.doc_id; let d = r.data || {};
    if (r.kind === "post") {
      zenSeen.set(key, zenJson(d));
      if ((S.zen.gone || []).includes(d.id)) { sb.from("zenith_docs").delete().eq("owner_id", sbUser.id).eq("kind", "post").eq("doc_id", r.doc_id).then(() => { zenSeen.delete(key); }, () => {}); return; }
      if (d.parentRemote) { const par = byRemote.get(d.parentRemote); if (!par) return; d.parent = par.id; if (!par.zenReplied) { par.zenReplied = true; changed = true; } }
      if (!byLocal.has(d.id)) { const p = Object.assign({ imgs: [], liked: false, reposted: false, saved: false, pinned: false }, d, { imgs: [], ai: true }); S.posts.push(p); byLocal.set(p.id, p); changed = true; }
    } else if (r.kind === "flag") {
      const p = (d.remote && byRemote.get(d.remote)) || byLocal.get(d.local);
      if (!p) return;
      zenSeen.set(key, zenJson(d));
      ["zenReplied", "zenAnswered", "zenLikeChecked", "zenLike"].forEach(f => { if (d[f] && !p[f]) { p[f] = true; changed = true; } });
    } else if (r.kind === "chat") {
      const sealedRow = !!(r.data && r.data.enc);
      if (sealedRow) { const dd = chatOpen.get(r.doc_id); if (!dd) return; zenSeen.set(key, zenJson(dd)); d = dd; }
      const c = S.chats.find(x => x.id === d.id);
      const msgs = (d.msgs || []).map(m => ({ id: m.id, text: m.text || "", t: m.t, ai: !!m.ai, imgs: [] }));
      if (!c) { S.chats.push({ id: d.id, name: d.name, t: d.t, msgs }); changed = true; }
      else { const have = new Set(c.msgs.map(m => m.id)); const add = msgs.filter(m => !have.has(m.id)); if (add.length) { c.msgs = c.msgs.concat(add).sort((a, b) => a.t - b.t); changed = true; } }
    } else if (r.kind === "state" && d.z) {
      zenSeen.set(key, zenJson(d));
      const z = S.zen, sz = d.z;
      z.next = Math.max(z.next || 0, sz.next || 0);
      z.since = Math.min(z.since || Date.now(), sz.since || Date.now());
      z.log = Array.from(new Set((z.log || []).concat(sz.log || [])));
      if (typeof sz.pics === "boolean") z.pics = sz.pics;
      if ((sz.pfpAt || 0) > (z.pfpAt || 0)) { if (sz.pfp) z.pfp = sz.pfp; else delete z.pfp; if (sz.bn) z.bn = sz.bn; else delete z.bn; z.pfpAt = sz.pfpAt; }
      changed = true;
    }
  });
  if (changed) persist();
  return changed;
}
async function zenStart() {
  if (zenSyncOn || !sbUser || !isOwner()) return;
  await zenPull();
  zenSyncOn = true;
  zenSync();
  const top = stack[stack.length - 1].r;
  if (!layer.childElementCount && (top === "zen" || (stack.length === 1 && top === "home"))) render();
}
// his picture and banner style only: no name and no bio
function zenEdit() {
  let pfp = S.zen.pfp || null, bnVal = S.zen.bn === "avatar" ? "avatar" : "default";
  const bn = h("div", { class: "ebanner" });
  const av = h("div", { class: "av zenav" });
  const paint = () => {
    bn.querySelectorAll(":scope > img.pic").forEach(i => i.remove());
    if (bnVal === "avatar" && pfp) bn.prepend(mkImg(pfp, "pic blur"));
    av.textContent = "";
    if (pfp) { const im = h("img", { alt: "", decoding: "async" }); im.src = pfp; av.append(im); } else av.innerHTML = ZEN_SVG;
  };
  const inp = h("input", { type: "file", accept: "image/*", class: "vh", "aria-label": "Change picture" });
  inp.addEventListener("change", async () => {
    const f = inp.files && inp.files[0];
    inp.value = "";
    if (!f) return;
    if (isVideo(f)) { toast("Videos are not supported"); return; }
    try {
      const out = isGif(f) ? await cropGif(f, { w: 320, h: 320, gw: 240, gh: 240, round: true, title: "Crop picture" }) : await openCropper(f, { w: 320, h: 320, gw: 240, gh: 240, round: true, title: "Crop picture" });
      if (out) { pfp = out; paint(); drawSeg(); }
    } catch (e) { toast("Could not use that picture"); }
  });
  const eav = h("div", { class: "eav" }, av, h("label", { class: "pick", title: "Change picture" }, ic("camera", 16), inp));
  const seg = h("div", { class: "seg" });
  const drawSeg = () => { seg.textContent = ""; [["default", "Default"], ["avatar", "Blurred photo"]].forEach(([v, t]) => seg.append(h("button", { class: v === bnVal ? "on" : "", onclick: () => { if (v === "avatar" && !pfp) { toast("Pick a picture first"); return; } bnVal = v; paint(); drawSeg(); } }, t))); };
  drawSeg();
  paint();
  modal({
    top: true,
    title: "Edit Zenith",
    body: [bn, eav, h("div", { class: "fld" }, h("label", {}, "Banner style"), seg), pfp ? h("button", { class: "tbtn", style: "color:var(--danger)", onclick: () => { pfp = null; bnVal = "default"; paint(); drawSeg(); } }, "Use default picture") : null],
    onAction: close => {
      if (pfp) S.zen.pfp = pfp; else delete S.zen.pfp;
      if (bnVal === "avatar" && pfp) S.zen.bn = "avatar"; else delete S.zen.bn;
      S.zen.pfpAt = Date.now();
      persist(); close(); render();
      if (pfp) zenPfpUrl();
    }
  });
}
function zenV() {
  topEl.append(bar(menuBtn(), ttl("Zenith")));
  const av = zenAv(88);
  av.className = "av xl zenav";
  av.style.width = "";
  av.style.height = "";
  const mine = S.posts.filter(p => p.ai && !p.parent).sort((a, b) => b.t - a.t);
  const zbn = h("div", { class: "banner" });
  if (S.zen.pfp && S.zen.bn === "avatar") zbn.append(mkImg(S.zen.pfp, "pic blur"));
  main.append(zbn, h("div", { class: "pinfo" },
    h("div", { class: "arow" }, av,
      h("div", { class: "btns" }, h("button", { class: "ghost", onclick: zenEdit }, "Edit Profile"))),
    h("h1", { class: "pname" }, "Zenith"),
    h("p", { class: "phand" }, "@zenith"),
    h("div", { class: "pstat" }, h("span", {}, h("b", {}, mine.length), mine.length === 1 ? " post" : " posts"))));
  const zt = S.ui.zenTab || "posts";
  const tabs = [["posts", "Posts"], ["replies", "Replies"], ["likes", "Likes"]];
  main.append(h("div", { class: "ptabs", role: "tablist" }, tabs.map(t => h("button", { class: "tab" + (t[0] === zt ? " on" : ""), role: "tab", onclick: () => { S.ui.zenTab = t[0]; persist(); render("root"); } }, h("span", {}, t[1])))));
  if (zt === "posts") main.append(postList(mine, { empty: emptyState("smile", "No posts yet.") }));
  else if (zt === "replies") main.append(postList(S.posts.filter(p => p.ai && p.parent).sort((a, b) => b.t - a.t), { replyTo: true, empty: emptyState("reply", "No replies yet.") }));
  else main.append(postList(S.posts.filter(p => !p.ai && p.zenLike).sort((a, b) => b.t - a.t), { replyTo: true, empty: emptyState("heart", "Zenith has not liked anything yet.") }));
}
const rowSubs = {};
function settingsV() {
  topEl.append(bar(menuBtn(), ttl("Settings")));
  const sec = t => h("div", { class: "sec" }, t);
  const row = (lead, label, sub, fn, cls) => h("button", { class: "srow" + (cls ? " " + cls : ""), onclick: fn }, lead, h("div", { class: "nm" }, h("b", {}, label), sub ? h("span", { class: "sub" }, sub) : null));
  main.append(sec("Appearance"));
  main.append(h("div", { class: "seg" }, [["system", "System"], ["dark", "Dark"], ["light", "Light"]].map(t => h("button", { class: S.ui.theme === t[0] ? "on" : "", onclick: e => { S.ui.theme = t[0]; applyTheme(); persist(); e.currentTarget.parentNode.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === e.currentTarget)); } }, t[1]))));
  main.append(sec("Account"));
  const swRow = row(ic("userswap", 22), "Switch account", "Add or switch account", openAccounts);
  main.append(h("div", { class: "group" }, row(avatar(36), "Edit profile", "@" + S.profile.handle, editProfile), swRow, row(ic("usercut", 22), "Sign out", "Log out of this device.", () => confirmSheet("Sign out of @" + S.profile.handle + " on this phone?", "Sign out", signOutNow))));
  main.append(sec("Login"));
  const totpRow = row(ic("shield", 22), "Authenticator app", rowSubs.totp || "Checking...", async () => {
    if (totpOn === null) {
      toast("Checking...");
      callFn("totp", { action: "status" }).then(r => { totpOn = r.ok ? !!r.body.enabled : null; const sub = totpRow.querySelector(".sub"); if (sub) sub.textContent = !r.ok ? "Could not check right now. Tap to retry." : totpOn ? "On" : "Off"; if (r.ok) rowSubs.totp = totpOn ? "On" : "Off"; });
      return;
    }
    if (totpOn) sheet([{ icon: "close", label: "Turn off authenticator", danger: true, fn: authenticatorOff }], "Authenticator is on");
    else { await authenticatorSetup(); render(); }
  });
  callFn("totp", { action: "status" }).then(r => {
    totpOn = r.ok ? !!r.body.enabled : null;
    const sub = totpRow.querySelector(".sub");
    if (sub) sub.textContent = !r.ok ? "Could not check right now." : totpOn ? "On" : "Off";
    if (r.ok) rowSubs.totp = totpOn ? "On" : "Off";
  }).catch(() => { const sub = totpRow.querySelector(".sub"); if (sub) sub.textContent = "Could not check right now."; });
  let keyState = rowSubs.keyState || null, keyRows = rowSubs.keyRows || [];
  const keyRow = row(ic("backup", 22), "Message key backup", rowSubs.key || "Checking...", () => {
    if (keyState === null) { toast("Checking..."); loadKeyState(); return; }
    if (keyState === "locked") { unlockModal(); return; }
    const hasRec = keyRows.some(r => r.mode === "recovery"), hasLogin = keyRows.some(r => r.mode === "login");
    const items = [];
    if (hasRec) items.push({ icon: "lock", label: "Change recovery password", fn: () => backupSetupModal(true) }, { icon: "close", label: "Remove recovery password", danger: true, fn: () => confirmSheet("Remove the recovery password?", "Remove", async () => { const { error } = await sb.from("key_backups").delete().eq("user_id", sbUser.id).eq("mode", "recovery"); toast(error ? "Could not remove it" : "Recovery password removed"); render(); }) });
    else items.push({ icon: "lock", label: "Add a recovery password", fn: () => backupSetupModal(false) });
    if (hasLogin) items.push({ icon: "close", label: "Stop saving", danger: true, fn: () => confirmSheet("Stop saving your message key? Signing in on a new phone will not open your messages by itself anymore.", "Stop saving", async () => {
      const a = await sb.from("key_backups").delete().eq("user_id", sbUser.id).eq("mode", "login");
      const b = await sb.from("key_backups").upsert({ user_id: sbUser.id, mode: "off", salt: "x", iv: "x", ct: "x", iters: 100000, pub: null }, { onConflict: "user_id,mode" });
      toast(a.error || b.error ? "Could not do that" : "Stopped saving with your login password");
      render();
    }) });
    else items.push({ icon: "check", label: "Start saving", fn: () => loginBackupModal() });
    items.push({ label: "Cancel", cancel: true });
    sheet(items, "Message key backup");
  });
  const loadKeyState = async () => {
    const sub = keyRow.querySelector(".sub");
    try {
      const [bk, loc] = await Promise.all([sb.from("key_backups").select("mode, pub").eq("user_id", sbUser.id), peekKeys()]);
      if (bk.error) throw bk.error;
      keyRows = (bk.data || []).filter(r => r.mode !== "off");
      keyState = !keyRows.length ? "off" : !loc || !keyRows.some(r => r.pub === loc.pub) ? "locked" : "on";
      const modes = keyRows.map(r => r.mode);
      rowSubs.keyState = keyState; rowSubs.keyRows = keyRows;
      rowSubs.key = keyState === "locked" ? "Locked. Tap to unlock." : keyState === "off" ? "Off" : modes.includes("login") ? "On" : "On with a recovery password";
      if (sub) sub.textContent = keyState === "locked" ? "Locked. Tap to unlock." : keyState === "off" ? "Off" : modes.includes("login") ? "On" : "On with a recovery password";
    } catch (e) { if (sub) sub.textContent = "Could not check right now. Tap to retry."; }
  };
  loadKeyState();
  main.append(h("div", { class: "group" },
    row(ic("pass", 22), "Change password", "Needs your current password.", () => changePassV()),
    row(ic("mail", 22), "Change email", "We send a link to the new address.", () => changeEmailV()),
    totpRow, keyRow));
  main.append(sec("Feed"));
  main.append(h("div", { class: "group" }, row(ic("list", 22), "Languages I read", langText(), langSheet)));
  main.append(sec("Notifications"));
  const pushRowEl = row(ic("bell", 24), "Phone notifications", rowSubs.push || "Checking...", async () => {
    const cur = await pushSub();
    try {
      if (cur && Notification.permission === "granted") { await pushOff(); toast("Phone notifications are off"); }
      else { await pushOn(); toast("Phone notifications are on"); }
    } catch (e) { toast(plainErr(e, "Could not change that")); }
    paintPush();
  });
  const paintPush = async () => {
    const sub = pushRowEl.querySelector(".sub");
    if (!sub) return;
    const put = t => { sub.textContent = t; rowSubs.push = t; };
    if (!pushOk()) { put("Not available here. On iPhone, add Nook to your home screen first."); return; }
    if (Notification.permission === "denied") { put("Blocked in your phone settings"); return; }
    const cur = await pushSub();
    put(cur && Notification.permission === "granted" ? "On for this device. Tap to turn off." : "Off. Tap to get follows, replies and messages when the app is closed.");
  };
  paintPush();
  main.append(h("div", { class: "group" }, pushRowEl));
  main.append(sec("Your account"));
  main.append(h("div", { class: "group" },
    row(ic("close", 22), "Blocked accounts", "People you blocked.", () => go({ r: "blocked" })),
    row(ic("sliders", 22), "Deactivate account", "Hidden until you sign in again", () => confirmSheet("Hide your account until you sign in again?", "Deactivate", async () => {
      const { error } = await sb.rpc("set_my_deactivated", { flag: true });
      if (error) { toast("Could not deactivate"); return; }
      await pushDetach().catch(() => {});
      await leaveThisAccount();
    }))));
  main.append(sec("Your data"));
  main.append(h("div", { class: "group" },
    row(ic("copy", 22), "Download backup", "Posts, notes and media in a zip", () => downloadBackup()),
    h("label", { class: "srow", style: "cursor:pointer;position:relative;overflow:hidden" }, ic("backup", 22), h("div", { class: "nm" }, h("b", {}, "Restore backup"), h("span", { class: "sub" }, "Add posts and notes from a backup file")),
      h("input", { type: "file", accept: ".zip,.json,application/zip,application/json", class: "vh", "aria-label": "Restore backup", onchange: e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) restoreBackup(f); } }))));
  main.append(sec("Updates"));
  main.append(h("div", { class: "group" }, row(ic("check", 22), "Check for updates", "You are on version " + APP_VERSION, () => {
    if (!window.nookCheckUpdate) { toast("Not available right now"); return; }
    if (window.nookPtr) window.nookPtr.spin();
    const done = () => { if (window.nookPtr) window.nookPtr.stop(); };
    setTimeout(done, 15000);
    Promise.resolve(window.nookCheckUpdate()).catch(() => {}).then(done);
  })));
  main.append(sec("Legal"));
  main.append(h("div", { class: "group" },
    row(ic("eyeoff", 22), "Privacy Policy", "What we keep and why.", () => go({ r: "privacy" })),
    row(ic("check", 22), "Terms of Use", "The rules for using Nook.", () => go({ r: "terms" }))));
  main.append(sec("Danger zone"));
  main.append(h("div", { class: "group" }, row(ic("trash", 22), "Delete account", "Kept for 30 days, then deleted for good", () => {
    const ask = () => confirmLogin("Delete account", "Your account is hidden and kept for 30 days. Sign in any time in that period to get it back. After that it is deleted for good.", "Delete", async () => {
      await pushDetach().catch(() => {});
      const r = await callFn("delete-account");
      if (!r.ok) return failText(r, "Could not delete the account. Try again");
      await wipeLocal();
      await leaveThisAccount();
    });
    // the data goes with the account, so the person is asked first if they want a copy
    sheet([
      { icon: "copy", label: "Download my data first", fn: async () => { await downloadBackup(); setTimeout(ask, 400); } },
      { icon: "trash", label: "Delete without downloading", danger: true, fn: ask },
      { label: "Cancel", cancel: true }], "Want a copy of your data before you delete your account?");
  }, "dng")));
}

function readDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error || new Error("read failed"));
    r.readAsDataURL(file);
  });
}
function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("decode failed"));
    i.src = src;
  });
}
async function decode(file) {
  if (window.createImageBitmap) {
    try { const b = await createImageBitmap(file, { imageOrientation: "from-image" }); return { im: b, w: b.width, h: b.height }; } catch (e) {}
    try { const b = await createImageBitmap(file); return { im: b, w: b.width, h: b.height }; } catch (e) {}
  }
  let u = null;
  try {
    u = URL.createObjectURL(file);
    const im = await loadImage(u);
    return { im, w: im.naturalWidth, h: im.naturalHeight };
  } catch (e) {
  } finally {
    if (u) URL.revokeObjectURL(u);
  }
  const im = await loadImage(await readDataURL(file));
  return { im, w: im.naturalWidth, h: im.naturalHeight };
}
async function shrink(file, o) {
  const d = await decode(file);
  if (!d.w || !d.h) throw new Error("empty image");
  const typeAlpha = hasAlpha(file);
  const c = document.createElement("canvas");
  const x = c.getContext("2d", { willReadFrequently: typeAlpha });
  if (o.w) {
    c.width = o.w; c.height = o.h;
    if (!typeAlpha) { x.fillStyle = "#fff"; x.fillRect(0, 0, o.w, o.h); }
    const s = Math.max(o.w / d.w, o.h / d.h);
    x.drawImage(d.im, (o.w - d.w * s) / 2, (o.h - d.h * s) / 2, d.w * s, d.h * s);
  } else {
    const s = Math.min(1, o.max / Math.max(d.w, d.h));
    c.width = Math.max(1, Math.round(d.w * s)); c.height = Math.max(1, Math.round(d.h * s));
    if (!typeAlpha) { x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); }
    x.drawImage(d.im, 0, 0, c.width, c.height);
  }
  if (d.im.close) d.im.close();
  // a png or webp is only kept as a lossless file when it really has see-through pixels
  let alpha = false;
  if (typeAlpha) {
    const px = x.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < px.length; i += 4) if (px[i] < 250) { alpha = true; break; }
  }
  if (alpha) {
    const wp = c.toDataURL("image/webp", 0.85);
    if (wp.startsWith("data:image/webp") && wp.length < 64) throw new Error("could not encode");
    if (wp.startsWith("data:image/webp")) return wp;
    const png = c.toDataURL("image/png");
    if (png.length < 64) throw new Error("could not encode");
    return png;
  }
  // step the quality down until the photo is small, so a big upload never fills the free storage
  let q = o.q || 0.8, out = c.toDataURL("image/jpeg", q);
  while (!o.w && out.length * 0.75 > 900 * 1024 && q > 0.5) { q -= 0.1; out = c.toDataURL("image/jpeg", q); }
  if (out.length < 64) throw new Error("could not encode");
  return out;
}
// the copied photo is read from the clipboard on a double tap of the photo button; the phone asks once whether to allow it
async function clipboardPics() {
  try {
    const files = [];
    for (const it of await navigator.clipboard.read()) {
      const t = it.types.find(x => /^image\//.test(x));
      if (t) files.push(new File([await it.getType(t)], "pasted." + (t.split("/")[1] || "png"), { type: t }));
    }
    if (!files.length) toast("No copied photo found");
    return files;
  } catch (e) { toast("Could not paste. Allow paste and try again"); return []; }
}
function pickBtn(icon, label, camera, onFiles, multi, onPaste) {
  const inp = h("input", { type: "file", accept: "image/*", class: "vh", multiple: !camera && multi ? true : null, "aria-label": label });
  if (camera) inp.setAttribute("capture", "environment");
  inp.addEventListener("change", () => {
    const f = Array.from(inp.files || []);
    if (!f.length) return;
    Promise.resolve(onFiles(f)).then(() => { inp.value = ""; }, () => { inp.value = ""; });
  });
  const lab = h("label", { class: "ib", title: label }, ic(icon, 24), inp);
  // one tap opens the picker (after a short wait), two quick taps paste the copied photo
  if (onPaste) {
    let t = 0;
    lab.addEventListener("click", e => {
      if (!e.isTrusted) return;
      e.preventDefault();
      if (t) { clearTimeout(t); t = 0; clipboardPics().then(fs => { if (fs.length) onPaste(fs); }); return; }
      t = setTimeout(() => { t = 0; inp.click(); }, 260);
    });
  }
  return lab;
}

const isVideo = f => /^video\//.test(f.type) || /\.(mp4|mov|m4v|webm|3gp|mkv|avi)$/i.test(f.name || "");
const isGif = f => f.type === "image/gif" || /\.gif$/i.test(f.name || "");
const hasAlpha = f => /^image\/(png|webp|gif)$/.test(f.type || "") || /\.(png|webp|gif)$/i.test(f.name || "");
const LZT = new Int32Array(1048576);
function lzw(ix) {
  LZT.fill(0);
  const raw = [];
  let acc = 0, nb = 0, size = 9, mx = 511, nx = 258;
  const emit = (c, reset) => {
    acc |= c << nb;
    nb += size;
    while (nb >= 8) { raw.push(acc & 255); acc >>>= 8; nb -= 8; }
    if (reset) { size = 9; mx = 511; }
    else if (nx > mx && size < 12) { size++; mx = (1 << size) - 1; }
  };
  emit(256);
  let pre = ix[0];
  for (let i = 1; i < ix.length; i++) {
    const k = ix[i], e = LZT[pre * 256 + k];
    if (e) pre = e;
    else {
      emit(pre);
      if (nx < 4096) LZT[pre * 256 + k] = nx++;
      else { LZT.fill(0); nx = 258; emit(256, true); }
      pre = k;
    }
  }
  emit(pre);
  emit(257);
  if (nb) raw.push(acc & 255);
  const out = [8];
  for (let i = 0; i < raw.length; i += 255) {
    const n = Math.min(255, raw.length - i);
    out.push(n);
    for (let j = 0; j < n; j++) out.push(raw[i + j]);
  }
  out.push(0);
  return Uint8Array.from(out);
}
function medianCut(s, n) {
  const mk = ix => {
    const lo = [255, 255, 255], hi = [0, 0, 0];
    for (const i of ix) for (let c = 0; c < 3; c++) { const v = s[i * 3 + c]; if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v; }
    let ch = 0;
    for (let c = 1; c < 3; c++) if (hi[c] - lo[c] > hi[ch] - lo[ch]) ch = c;
    return { ix, ch, sp: ix.length > 1 ? (hi[ch] - lo[ch]) * Math.sqrt(ix.length) : -1 };
  };
  const all = [];
  for (let i = 0; i < s.length / 3; i++) all.push(i);
  const bx = [mk(all)];
  while (bx.length < n) {
    let bi = 0;
    for (let k = 1; k < bx.length; k++) if (bx[k].sp > bx[bi].sp) bi = k;
    const b = bx[bi];
    if (b.sp <= 0) break;
    b.ix.sort((a, c) => s[a * 3 + b.ch] - s[c * 3 + b.ch]);
    const m = b.ix.length >> 1;
    bx.splice(bi, 1, mk(b.ix.slice(0, m)), mk(b.ix.slice(m)));
  }
  return bx.map(b => { const t = [0, 0, 0]; for (const i of b.ix) for (let c = 0; c < 3; c++) t[c] += s[i * 3 + c]; return t.map(v => Math.round(v / b.ix.length)); });
}
async function gifEncode(fr, w, h2, fps, onp) {
  const P = w * h2, tot = fr.length * P, st = Math.max(1, Math.floor(tot / 30000));
  const smp = [];
  for (let g = 0; g < tot; g += st) { const f = fr[(g / P) | 0], o = (g % P) * 4; smp.push(f[o], f[o + 1], f[o + 2]); }
  const pal = medianCut(Uint8Array.from(smp), 255);
  const N = pal.length;
  const cache = new Int16Array(65536).fill(-1);
  const bay = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const near = (r, g, b) => {
    let bi = 0, bd = 1e9;
    for (let k = 0; k < N; k++) { const d = (pal[k][0] - r) ** 2 + (pal[k][1] - g) ** 2 + (pal[k][2] - b) ** 2; if (d < bd) { bd = d; bi = k; } }
    return bi;
  };
  const head = [71, 73, 70, 56, 57, 97, w & 255, w >> 8, h2 & 255, h2 >> 8, 247, 0, 0];
  for (let k = 0; k < 256; k++) { const c = pal[k] || [0, 0, 0]; head.push(c[0], c[1], c[2]); }
  head.push(33, 255, 11, 78, 69, 84, 83, 67, 65, 80, 69, 50, 46, 48, 3, 1, 0, 0, 0);
  const parts = [Uint8Array.from(head)];
  const shown = new Uint8Array(P), idx = new Uint8Array(P);
  const dl = Math.max(2, Math.round(100 / fps));
  for (let f = 0; f < fr.length; f++) {
    const px = fr[f];
    for (let p = 0; p < P; p++) {
      const o = p * 4, y = (p / w) | 0, x = p % w;
      const t = (bay[((y & 3) << 2) | (x & 3)] - 7.5) * 1.2;
      const r = Math.max(0, Math.min(255, px[o] + t)) | 0, g = Math.max(0, Math.min(255, px[o + 1] + t)) | 0, b = Math.max(0, Math.min(255, px[o + 2] + t)) | 0;
      const key = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
      let q = cache[key];
      if (q < 0) q = cache[key] = near(r, g, b);
      const a = pal[q], z = pal[shown[p]];
      if (f && (a[0] - z[0]) ** 2 + (a[1] - z[1]) ** 2 + (a[2] - z[2]) ** 2 < 90) idx[p] = 255;
      else { idx[p] = q; shown[p] = q; }
    }
    parts.push(Uint8Array.from([33, 249, 4, 5, dl & 255, dl >> 8, 255, 0, 44, 0, 0, 0, 0, w & 255, w >> 8, h2 & 255, h2 >> 8, 0]), lzw(idx));
    if (onp) onp((f + 1) / fr.length);
    await new Promise(r => setTimeout(r));
  }
  parts.push(Uint8Array.from([59]));
  return new Blob(parts, { type: "image/gif" });
}
// gifs: shrink big ones by re-encoding at a smaller size, keep whichever file is smaller
async function compressGif(f, onp) {
  const orig = (await readDataURL(f)).replace(/^data:[^,]*/, "data:image/gif;base64");
  if (f.size <= 1.5 * 1048576 || !window.ImageDecoder) {
    if (f.size > 12582912) throw new Error("gif over 12 MB");
    return orig;
  }
  try {
    const dec = new ImageDecoder({ data: await f.arrayBuffer(), type: "image/gif" });
    await dec.tracks.ready;
    const count = dec.tracks.selectedTrack.frameCount;
    if (!(count > 1)) return orig;
    const first = await dec.decode({ frameIndex: 0 });
    const vw = first.image.displayWidth, vh = first.image.displayHeight;
    first.image.close();
    const k = Math.min(1, 480 / Math.max(vw, vh));
    const w = Math.max(2, Math.round(vw * k)), h2 = Math.max(2, Math.round(vh * k));
    const c = document.createElement("canvas");
    c.width = w; c.height = h2;
    const x = c.getContext("2d", { willReadFrequently: true });
    const fr = [];
    let tAt = 0, nextAt = 0;
    const step = 1e6 / 12, maxFrames = 12 * 15;
    for (let i = 0; i < count && fr.length < maxFrames; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      const d = image.duration || 100000;
      if (tAt >= nextAt) {
        x.clearRect(0, 0, w, h2);
        x.fillStyle = "#fff"; x.fillRect(0, 0, w, h2);
        x.drawImage(image, 0, 0, w, h2);
        fr.push(x.getImageData(0, 0, w, h2).data);
        nextAt += step;
      }
      tAt += d;
      image.close();
      if (onp) onp((i / count) * 0.5);
    }
    dec.close();
    if (!fr.length) return orig;
    const blob = await gifEncode(fr, w, h2, 12, p => onp && onp(0.5 + p * 0.5));
    if (blob.size < f.size) return await readDataURL(blob);
  } catch (e) {}
  if (f.size > 12582912) throw new Error("gif over 12 MB");
  return orig;
}
async function intake(f, onp, o) {
  if (isVideo(f)) throw new Error("videos are not supported");
  if (isGif(f)) {
    const out = await compressGif(f, onp);
    // a gif that cannot be read is refused here, not sent as a broken picture
    await loadImage(typeof out === "string" ? out : await readDataURL(out));
    return out;
  }
  return shrink(f, { max: 1280, q: 0.8 });
}
// a moving picture is cropped like any other: the area is picked on the first frame, then every frame is cut and the gif is made again
async function cropGif(f, o) {
  if (!window.ImageDecoder) return intake(f);
  const r = await openCropper(f, { ...o, rect: true });
  if (!r) return null;
  const k = Math.min(1, (o.round ? 256 : 480) / o.w);
  const W = Math.max(2, Math.round(o.w * k)), H = Math.max(2, Math.round(o.h * k));
  toast("Cropping your GIF...");
  try {
    const dec = new ImageDecoder({ data: await f.arrayBuffer(), type: "image/gif" });
    await dec.tracks.ready;
    const count = dec.tracks.selectedTrack.frameCount;
    if (!(count > 1)) { dec.close(); return await shrink(f, { max: 1280, q: 0.8 }); }
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d", { willReadFrequently: true });
    const fr = [];
    let tAt = 0, nextAt = 0;
    const step = 1e6 / 12, maxFrames = 12 * 8;
    for (let i = 0; i < count && fr.length < maxFrames; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      const d = image.duration || 100000;
      if (tAt >= nextAt) {
        x.fillStyle = "#fff"; x.fillRect(0, 0, W, H);
        x.drawImage(image, r.x, r.y, r.w, r.h, 0, 0, W, H);
        fr.push(x.getImageData(0, 0, W, H).data);
        nextAt += step;
      }
      tAt += d;
      image.close();
    }
    dec.close();
    if (!fr.length) throw new Error("no frames");
    return await readDataURL(await gifEncode(fr, W, H, 12));
  } catch (e) { toast("Could not crop that GIF"); return null; }
}
async function addMedia(files, arr, jobs, max, redraw) {
  let bad = 0, why = "";
  for (const f of Array.from(files)) {
    if (arr.length + jobs.length >= max) { toast("Only " + max + " allowed, extra ones skipped", true); break; }
    const lbl = h("span", {}), job = { el: h("div", { class: "skel" }, lbl) };
    jobs.push(job);
    redraw();
    try { arr.push(await intake(f, p => { lbl.textContent = isGif(f) ? Math.round(p * 100) + "%" : ""; })); }
    catch (e) { bad++; why = e && e.message ? e.message : "error"; }
    jobs.splice(jobs.indexOf(job), 1);
    redraw();
  }
  if (bad) toast(bad === 1 ? (/video/i.test(why) ? "Videos are not supported" : "That file is not a photo we can read") : "Could not add " + bad + " files");
}

const byT = (x, y) => y.t - x.t;
function shrinkImg(src, max = 160) {
  if (!src) return Promise.resolve(null);
  return new Promise(res => {
    const im = new Image();
    im.onload = () => {
      const s = Math.min(1, max / Math.max(im.width, im.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(im.width * s));
      c.height = Math.max(1, Math.round(im.height * s));
      const cx = c.getContext("2d");
      // only the circle people really see is kept and checked: the corners outside it are cleared
      cx.beginPath();
      cx.arc(c.width / 2, c.height / 2, Math.min(c.width, c.height) / 2, 0, Math.PI * 2);
      cx.closePath();
      cx.clip();
      cx.drawImage(im, 0, 0, c.width, c.height);
      res(c.toDataURL("image/png"));
    };
    im.onerror = () => res(null);
    im.src = src;
  });
}
function parseMedia(v) {
  if (!v) return [];
  if (typeof v !== "string") return [];
  if (v.charAt(0) === "[") { try { const j = JSON.parse(v); return Array.isArray(j) ? j.filter(x => typeof x === "string" && x) : []; } catch (e) { return []; } }
  return [v];
}
// "loading" until the first answer, "error" when the posts could not be fetched, "ok" after a good answer
let feedStatus = "loading", feedTries = 0, feedRetryTimer = null;
function feedFail() {
  feedStatus = "error";
  if (!feedRetryTimer && feedTries < 8) { feedTries++; feedRetryTimer = setTimeout(() => { feedRetryTimer = null; loadFeed().catch(() => {}); }, Math.min(30000, 4000 * feedTries)); }
  const cur = stack[stack.length - 1];
  if (cur && cur.r === "home" && !layer.childElementCount && !S.posts.length) render();
}
async function loadFeed() {
  if (!sbUser || !S) return;
  let pq = await sb.from("posts").select("id, user_id, body, created_at, parent_id, media_url").order("created_at", { ascending: false }).limit(300);
  if (pq.error) pq = await sb.from("posts").select("id, user_id, body, created_at").order("created_at", { ascending: false }).limit(300);
  const posts = pq.data;
  if (!posts) { feedFail(); return; }
  // what the people you follow reposted comes in too, even when the post itself is older than the newest 300
  let rpRows = [];
  try {
    const fq = await sb.from("follows").select("followee_id").eq("follower_id", sbUser.id).limit(1000);
    const fids = (fq.data || []).map(r => r.followee_id);
    if (fids.length) {
      const rq = await sb.from("reposts").select("user_id, post_id, created_at").in("user_id", fids).order("created_at", { ascending: false }).limit(60);
      rpRows = (rq.data || []).filter(r => r.user_id !== sbUser.id);
      const have = new Set(posts.map(p => p.id));
      const miss = [...new Set(rpRows.map(r => r.post_id))].filter(id => !have.has(id)).slice(0, 60);
      if (miss.length) {
        const mq = await sb.from("posts").select("id, user_id, body, created_at, parent_id, media_url").in("id", miss);
        (mq.data || []).forEach(p => { if (!p.parent_id) posts.push(p); });
      }
    }
  } catch (e) { rpRows = []; }
  const pend = new Set(S.pendDel || []);
  if (S.pendDel && S.pendDel.length) { try { await deleteRemote(S.pendDel.map(r => ({ remote: r }))); } catch (e) {} }
  const ids = posts.filter(p => !p.parent_id).map(p => p.id);
  const feedRes = await Promise.all([
    sb.from("likes").select("post_id").eq("user_id", sbUser.id),
    sb.from("reposts").select("post_id, created_at").eq("user_id", sbUser.id),
    sb.from("blocks").select("blocked_id").eq("blocker_id", sbUser.id),
    sb.from("blocks").select("blocker_id").eq("blocked_id", sbUser.id),
    ids.length ? sb.from("likes").select("post_id").in("post_id", ids) : { data: [] },
    ids.length ? sb.from("reposts").select("post_id").in("post_id", ids) : { data: [] },
    sb.from("accounts").select(ACC_COLS).eq("id", sbUser.id).maybeSingle(),
    sb.from("follows").select("followee_id").eq("follower_id", sbUser.id).limit(1000)
  ]);
  // a failed answer is not an empty one: nothing is changed (a blocked person must not come back because a call failed)
  if ([0, 1, 2, 3].some(i => !feedRes[i] || feedRes[i].error)) { feedFail(); return; }
  feedStatus = "ok"; feedTries = 0;
  const [{ data: myLikes }, { data: myReposts }, { data: blocksOut }, { data: blocksIn }, { data: likeRows }, { data: repostRows }, { data: meRow }, { data: myFollows }] = feedRes;
  if (myFollows) { followSet = new Set(myFollows.map(r => r.followee_id)); cacheWrite("follows:" + sbUser.id, [...followSet]); }
  if (meRow) {
    let changed = false;
    const take = (k, v) => { if (v != null && v !== "" && S.profile[k] !== v) { S.profile[k] = v; changed = true; } };
    take("handle", meRow.username);
    if (meRow.display_name != null && S.profile.name !== meRow.display_name) { S.profile.name = meRow.display_name; changed = true; }
    S.profile.handleChangedAt = meRow.handle_changed_at || null;
    S.posts.forEach(p => { if (p.remote && !p.ra) p.pinned = p.remote === meRow.pinned_post_id; });
    take("banner", meRow.banner);
    take("bannerTheme", meRow.banner_theme);
    if (meRow.avatar && !S.profile.avatar) S.profile.avatar = meRow.avatar;
    if (meRow.bio && !S.profile.bio) S.profile.bio = meRow.bio;
    if (!meRow.banner && S.profile.banner && /^data:/.test(S.profile.banner)) {
      const src = S.profile.banner;
      bannerUrl(src).then(url => {
        if (!url || S.profile.banner !== src) return;
        S.profile.banner = url; persist();
        sb.from("accounts").update({ banner: url }).eq("id", sbUser.id).then(() => {});
      });
    }
    if (changed) { persist(); renderRail(); }
  }
  // posts of mine that the server no longer has (removed by the AI check or deleted elsewhere) go away here too
  const mine = S.posts.filter(p => p.remote && !p.ra && !p.ai && Date.now() - p.t > 120000).slice(0, 200);
  if (mine.length) {
    const { data: alive, error: ae } = await sb.from("posts").select("id").in("id", mine.map(p => p.remote));
    if (!ae && alive) {
      const ok = new Set(alive.map(x => x.id));
      if (dropLocalPosts(mine.filter(p => !ok.has(p.remote)).map(p => p.remote))) render();
    }
  }
  const tally = rows => { const m = new Map(); (rows || []).forEach(r => m.set(r.post_id, (m.get(r.post_id) || 0) + 1)); return m; };
  const lc = tally(likeRows), rc = tally(repostRows);
  const liked = new Set((myLikes || []).map(x => x.post_id));
  const reposted = new Set((myReposts || []).map(x => x.post_id));
  const rpTime = new Map((myReposts || []).map(x => [x.post_id, Date.parse(x.created_at) || 0]));
  const hidden = new Set([...(blocksOut || []).map(x => x.blocked_id), ...(blocksIn || []).map(x => x.blocker_id)]);
  const shown = posts.filter(p => !hidden.has(p.user_id));
  const postIds = new Set(shown.map(p => p.id));
  const rpFirst = new Map();
  rpRows.forEach(r => { if (!hidden.has(r.user_id) && postIds.has(r.post_id) && !rpFirst.has(r.post_id)) rpFirst.set(r.post_id, r); });
  const authors = [...new Set(shown.filter(p => p.user_id !== sbUser.id).map(p => p.user_id).concat([...rpFirst.values()].map(r => r.user_id)))];
  const who = await cachedAccounts(authors);
  // a deleted account has no profile to show: its posts are left out instead of appearing as "user"
  const others = shown.filter(p => p.user_id !== sbUser.id && (who.failed || who.get(p.user_id)));
  const rpBy = id => { const r = rpFirst.get(id), a = r && who.get(r.user_id); return a ? { id: r.user_id, name: a.display_name == null ? a.username : a.display_name, t: Date.parse(r.created_at) || 0 } : null; };
  const replyTally = new Map();
  shown.filter(p => p.parent_id).forEach(p => replyTally.set(p.parent_id, (replyTally.get(p.parent_id) || 0) + 1));
  const savedMap = new Map(S.posts.filter(p => p.ra).map(p => [p.remote, !!p.saved]));
  const localByRemote = new Map(S.posts.filter(p => p.remote && !p.ra).map(p => [p.remote, p.id]));
  S.posts.forEach(p => {
    if (!p.remote || p.ra) return;
    p.lc = lc.get(p.remote) || 0;
    p.rpc = rc.get(p.remote) || 0;
    p.rp = replyTally.get(p.remote) || 0;
    p.liked = liked.has(p.remote);
    p.reposted = reposted.has(p.remote);
    p.rpAt = p.reposted ? rpTime.get(p.remote) || p.rpAt || 0 : 0;
  });
  const remote = others.map(p => {
    const a = who.get(p.user_id) || { username: "user", avatar: null };
    return {
      id: "r" + p.id, remote: p.id, parent: p.parent_id ? (localByRemote.get(p.parent_id) || "r" + p.parent_id) : null,
      text: p.body || "", t: Date.parse(p.created_at), imgs: parseMedia(p.media_url),
      ra: { id: p.user_id, name: a.display_name == null ? a.username : a.display_name, handle: a.username, avatar: a.avatar || null },
      liked: liked.has(p.id), reposted: reposted.has(p.id), rpAt: rpTime.get(p.id) || 0, rpBy: rpBy(p.id), saved: savedMap.get(p.id) || false,
      lc: lc.get(p.id) || 0, rpc: rc.get(p.id) || 0, rp: replyTally.get(p.id) || 0, pinned: false
    };
  });
  // my posts that only the server has (made on another device, or lost from this one) come back
  const known = new Set(S.posts.filter(p => p.remote && !p.ra).map(p => p.remote));
  const mineBack = shown.filter(p => p.user_id === sbUser.id && !known.has(p.id) && !pend.has(p.id));
  const backIds = new Set(mineBack.map(p => p.id));
  const back = mineBack.map(p => ({
    id: "m" + p.id, remote: p.id, parent: p.parent_id ? (localByRemote.get(p.parent_id) || (backIds.has(p.parent_id) ? "m" + p.parent_id : "r" + p.parent_id)) : null,
    text: p.body || "", t: Date.parse(p.created_at), imgs: parseMedia(p.media_url), media: parseMedia(p.media_url),
    liked: liked.has(p.id), reposted: reposted.has(p.id), saved: false, lc: lc.get(p.id) || 0, rpc: rc.get(p.id) || 0, rp: replyTally.get(p.id) || 0,
    pinned: !!meRow && meRow.pinned_post_id === p.id
  }));
  // what this person saved or liked stays, even when the post is older than the newest 300
  const seen = new Set(remote.map(r => r.remote));
  let kept = S.posts.filter(p => p.ra && (p.saved || p.liked || (p.sharedAt && Date.now() - p.sharedAt < 864e5)) && !seen.has(p.remote) && !hidden.has(p.ra.id)).slice(0, 100);
  if (kept.length) {
    // only the ones the server still has (the author may have deleted them)
    const { data: still, error: se } = await sb.from("posts").select("id").in("id", kept.map(p => p.remote));
    kept = se ? [] : kept.filter(p => (still || []).some(r => r.id === p.remote));
  }
  S.posts = S.posts.filter(p => !p.ra).concat(back, remote, kept);
  persist();
  if (stack.length === 1 && stack[0].r === "home") render();
}
function rAv(ra, size) {
  const seed = String((ra && (ra.name || ra.handle)) || "?");
  let hsh = 7;
  for (const c of seed) hsh = (hsh * 31 + c.charCodeAt(0)) >>> 0;
  const a = h("div", { class: "av", style: "background:hsl(" + (hsh % 360) + " 45% 42%)" }, seed.trim().charAt(0).toUpperCase() || "?");
  if (ra && ra.avatar) { const im = picImg(ra.avatar); im.loading = "eager"; a.prepend(im); }
  if (size) { a.style.width = size + "px"; a.style.height = size + "px"; a.style.fontSize = Math.round(size * 0.4) + "px"; }
  return a;
}
const busyTaps = new Set();
async function toggleRemoteLike(p, big) {
  if (!sbUser || busyTaps.has("l" + p.id)) return;
  busyTaps.add("l" + p.id);
  try { await toggleRemoteLikeNow(p, big); } finally { busyTaps.delete("l" + p.id); }
}
async function toggleRemoteLikeNow(p, big) {
  const on = !p.liked;
  p.liked = on; p.lc = Math.max(0, (p.lc || 0) + (on ? 1 : -1));
  bump = p.id + "like"; persist(); refresh(p, big);
  const { error } = on
    ? await sb.from("likes").insert({ user_id: sbUser.id, post_id: p.remote })
    : await sb.from("likes").delete().eq("user_id", sbUser.id).eq("post_id", p.remote);
  if (error && !(on && error.code === "23505")) {
    p.liked = !on; p.lc = Math.max(0, (p.lc || 0) + (on ? -1 : 1));
    // a lost answer can hide that the server did take the tap: the real state is read back
    const { data: truth, error: te } = await sb.from("likes").select("post_id").eq("user_id", sbUser.id).eq("post_id", p.remote).maybeSingle();
    if (!te && !!truth !== p.liked) { p.liked = !!truth; p.lc = Math.max(0, (p.lc || 0) + (p.liked ? 1 : -1)); }
    persist(); refresh(p, big); toast("Could not update like");
  }
}
async function toggleRemoteRepost(p, big) {
  if (!sbUser || busyTaps.has("r" + p.id)) return;
  busyTaps.add("r" + p.id);
  try { await toggleRemoteRepostNow(p, big); } finally { busyTaps.delete("r" + p.id); }
}
async function toggleRemoteRepostNow(p, big) {
  const on = !p.reposted;
  p.reposted = on; p.rpAt = on ? Date.now() : 0; p.rpc = Math.max(0, (p.rpc || 0) + (on ? 1 : -1));
  bump = p.id + "rp"; persist(); refresh(p, big);
  const { error } = on
    ? await sb.from("reposts").insert({ user_id: sbUser.id, post_id: p.remote })
    : await sb.from("reposts").delete().eq("user_id", sbUser.id).eq("post_id", p.remote);
  if (error && !(on && error.code === "23505")) { p.reposted = !on; p.rpc = Math.max(0, (p.rpc || 0) + (on ? -1 : 1)); persist(); refresh(p, big); toast("Could not update repost"); }
}
function userV(cur) {
  const found = S.posts.find(p => p.ra && p.ra.id === cur.id);
  const who = found ? found.ra : { id: cur.id, name: "user", handle: "user", avatar: null };
  topEl.append(bar(backBtn(), ttl(who.name || "@" + who.handle)));
  const bn = h("div", { class: "banner" });
  const av = rAv(who, 0);
  av.className = "av xl";
  av.style.width = ""; av.style.height = ""; av.style.fontSize = "";
  const bio = h("p", { class: "pbio" }, "");
  const stat = h("div", { class: "pstat" });
  const followBtn = h("button", { class: "fbtn", disabled: true }, "Follow");
  const msgBtn = h("button", { class: "ghost", style: "display:none", onclick: () => openDm(cur.id) }, "Message");
  const blockBtn = h("button", { class: "ghost", disabled: true }, "Block");
  const pnEl = h("h1", { class: "pname" }, who.name), phEl = h("p", { class: "phand" }, "@" + who.handle);
  const info = h("div", { class: "pinfo" },
    h("div", { class: "arow" }, av, h("div", { class: "btns" }, followBtn, msgBtn, blockBtn)),
    pnEl, phEl, stat, bio);
  main.append(bn, info);
  const tabsEl = h("div", { class: "ptabs", role: "tablist" });
  const listEl = h("div");
  let tab = "posts";
  let st = null;
  let theirReposts = (cacheRead("rpt:" + cur.id) || {}).v || null;
  const drawTabs = () => {
    tabsEl.textContent = "";
    [["posts", "Posts"], ["replies", "Replies"], ["reposts", "Reposts"], ["media", "Media"], ["likes", "Likes"]].forEach(t => tabsEl.append(h("button", { class: "tab" + (t[0] === tab ? " on" : ""), role: "tab", onclick: () => { tab = t[0]; drawTabs(); drawList(); } }, h("span", {}, t[1]))));
  };
  const showIds = (ids, empty, icon) => {
    listEl.textContent = "";
    const set = new Set(ids);
    listEl.append(postList(S.posts.filter(p => p.remote && set.has(p.remote)).sort(byT), { empty: emptyState(icon, empty) }));
  };
  const idsTab = (name, table, empty, icon) => {
    const key = "ids:" + name + ":" + cur.id;
    const hit = cacheRead(key);
    if (hit) showIds(hit.v, empty, icon); else { listEl.textContent = ""; listEl.append(loadingEl()); }
    sb.from(table).select("post_id").eq("user_id", cur.id).then(({ data }) => {
      const ids = (data || []).map(x => x.post_id);
      cacheWrite(key, ids);
      if (tab === name) showIds(ids, empty, icon);
    });
  };
  const drawList = () => {
    listEl.textContent = "";
    const pinId = st && st.acc ? st.acc.pinned_post_id : null;
    S.posts.forEach(p => { if (p.ra && p.ra.id === cur.id) p.pinned = !!pinId && p.remote === pinId; });
    const mine = S.posts.filter(p => p.ra && p.ra.id === cur.id).sort(byT);
    if (tab === "posts") {
      // what this person reposted sits in their posts too, at the time they reposted it
      const items = mine.filter(p => !p.parent).map(p => ({ p, t: p.t, pin: p.pinned ? 1 : 0 }));
      const had = new Set(items.map(x => x.p.remote));
      (theirReposts || []).forEach(r => { const p = S.posts.find(x => x.remote === r.post_id); if (p && !p.parent && !had.has(p.remote) && !(p.ra && p.ra.id === cur.id)) items.push({ p, t: r.t, pin: 0, rp: true }); });
      items.sort((x, y) => y.pin - x.pin || y.t - x.t);
      const who2 = new Set(items.filter(x => x.rp).map(x => x.p.id));
      listEl.append(postList(items.map(x => x.p), { pin: true, lab: p => (who2.has(p.id) ? (pnEl.textContent || who.name || "They") + " reposted" : null), empty: emptyState("smile", "No posts yet.") }));
    }
    else if (tab === "replies") listEl.append(postList(mine.filter(p => p.parent), { replyTo: true, empty: emptyState("reply", "No replies yet.") }));
    else if (tab === "reposts") idsTab("reposts", "reposts", "No reposts yet.", "repost");
    else if (tab === "likes") idsTab("likes", "likes", "No likes yet.", "heart");
    else {
      const tiles = [];
      mine.forEach(p => p.imgs.forEach(src => tiles.push(h("button", { "aria-label": "Open post", onclick: () => go({ r: "thread", id: p.id }) }, mkImg(src)))));
      listEl.append(tiles.length ? h("div", { class: "mg" }, tiles) : emptyState("image", "No photos yet."));
    }
  };
  main.append(tabsEl, listEl);
  drawTabs(); drawList();
  if (sbUser) sb.from("reposts").select("post_id, created_at").eq("user_id", cur.id).order("created_at", { ascending: false }).limit(100).then(({ data, error }) => {
    if (error || !data) return;
    theirReposts = data.map(r => ({ post_id: r.post_id, t: Date.parse(r.created_at) || 0 }));
    cacheWrite("rpt:" + cur.id, theirReposts);
    if (tab === "posts") drawList();
  });
  if (!sbUser) return;
  let counts = { followers: 0, following: 0 };
  const paintStat = () => {
    stat.textContent = "";
    stat.append(
      h("span", {}, h("b", {}, S.posts.filter(p => p.ra && p.ra.id === cur.id && !p.parent).length), " posts"),
      h("span", { class: "lk", onclick: () => go({ r: "followers", id: cur.id }) }, h("b", {}, counts.followers), " followers"),
      h("span", { class: "lk", onclick: () => go({ r: "following", id: cur.id }) }, h("b", {}, counts.following), " following"));
  };
  const paintFollow = () => {
    followBtn.disabled = !st;
    followBtn.style.display = st && st.blocked ? "none" : "";
    followBtn.textContent = st && st.following ? "Following" : st && st.followsMe ? "Follow back" : "Follow";
    followBtn.classList.toggle("on", !!(st && st.following));
    msgBtn.style.display = st && st.following && st.followsMe && !st.blocked ? "" : "none";
    blockBtn.disabled = !st;
    blockBtn.textContent = st && st.blocked ? "Unblock" : "Block";
  };
  const paintAcc = acc => {
    av.querySelectorAll(":scope > img.pic").forEach(i => i.remove());
    if (acc.avatar) av.prepend(picImg(acc.avatar));
    bn.textContent = "";
    if (acc.banner_theme === "avatar" && acc.avatar) bn.append(mkImg(acc.avatar, "pic blur")); else if (acc.banner) bn.append(picImg(acc.banner));
    pnEl.textContent = acc.display_name != null ? acc.display_name : (acc.username || who.name);
    pnEl.hidden = !pnEl.textContent;
    phEl.textContent = "@" + (acc.username || who.handle);
    bio.textContent = acc.bio || "";
  };
  const saveState = () => { if (st) cacheWrite("ui:" + cur.id, st); };
  const applyState = s => { const was = st && st.acc ? st.acc.pinned_post_id : null; st = s; paintAcc(s.acc); paintFollow(); if (tab === "posts" && (s.acc.pinned_post_id || null) !== (was || null)) drawList(); };
  paintStat();
  countsOf(cur.id, c => { counts = c; paintStat(); });
  const hit = cacheRead("ui:" + cur.id);
  if (hit && hit.v && hit.v.acc) applyState(hit.v);
  // a profile that could not load says so and offers another try, instead of staying a grey shell
  const profileFail = () => {
    if (stack[stack.length - 1] !== cur) return;
    main.textContent = "";
    main.append(h("div", { class: "rest" }, h("b", {}, who.name), h("p", { class: "note" }, "Could not load this profile. Check your connection."), h("button", { class: "ghost", onclick: () => render() }, "Try again")));
  };
  Promise.all([
    sb.from("accounts").select(ACC_COLS).eq("id", cur.id).maybeSingle(),
    sb.from("follows").select("followee_id").eq("follower_id", sbUser.id).eq("followee_id", cur.id),
    sb.from("follows").select("follower_id").eq("follower_id", cur.id).eq("followee_id", sbUser.id),
    sb.from("blocks").select("blocked_id").eq("blocker_id", sbUser.id).eq("blocked_id", cur.id),
    sb.from("blocks").select("blocker_id").eq("blocker_id", cur.id).eq("blocked_id", sbUser.id)
  ]).then(results => {
    const [{ data: acc }, { data: fol }, { data: folMe }, { data: blk }, { data: theyBlock }] = results;
    // a page the person has already left is not touched, and a failed call is not shown as a block
    if (stack[stack.length - 1] !== cur) return;
    if (results.some(r => r && r.error)) { if (!st) profileFail(); return; }
    if (!acc) {
      main.textContent = "";
      main.append(h("div", { class: "rest" }, h("b", {}, who.name), h("p", { class: "note" }, "This account is not available")));
      return;
    }
    if (theyBlock && theyBlock.length) {
      main.textContent = "";
      main.append(h("div", { class: "rest" }, h("b", {}, who.name), h("p", { class: "note" }, "This account blocked you")));
      return;
    }
    applyState({ acc, following: !!(fol && fol.length), followsMe: !!(folMe && folMe.length), blocked: !!(blk && blk.length) });
    saveState();
  }, () => { if (!st) profileFail(); });
  let followBusy = false, followQueued = false;
  followBtn.onclick = async () => {
    if (!st) return;
    // a tap while one is running waits its turn instead of being lost
    if (followBusy) { followQueued = true; return; }
    followBusy = true;
    try {
      await followNow();
      while (followQueued) { followQueued = false; await followNow(); }
    } finally { followBusy = false; followQueued = false; }
  };
  const followNow = async () => {
    const on = !st.following;
    st.following = on; counts.followers += on ? 1 : -1;
    paintFollow(); paintStat(); saveState();
    const { error } = on
      ? await sb.from("follows").insert({ follower_id: sbUser.id, followee_id: cur.id })
      : await sb.from("follows").delete().eq("follower_id", sbUser.id).eq("followee_id", cur.id);
    if (error) { st.following = !on; counts.followers += on ? -1 : 1; paintFollow(); paintStat(); saveState(); toast("Could not update follow"); }
  };
  blockBtn.onclick = async () => {
    if (!st) return;
    const on = !st.blocked;
    st.blocked = on; paintFollow(); saveState();
    const { error } = on
      ? await sb.from("blocks").insert({ blocker_id: sbUser.id, blocked_id: cur.id })
      : await sb.from("blocks").delete().eq("blocker_id", sbUser.id).eq("blocked_id", cur.id);
    if (error) { st.blocked = !on; paintFollow(); saveState(); toast("Could not update block"); return; }
    st.following = false; st.followsMe = false;
    await sb.from("follows").delete().or("and(follower_id.eq." + sbUser.id + ",followee_id.eq." + cur.id + "),and(follower_id.eq." + cur.id + ",followee_id.eq." + sbUser.id + ")");
    countsOf(cur.id, c => { counts = c; paintStat(); });
    paintFollow(); saveState(); paintStat();
    loadFeed();
  };
}


// a moving profile photo cannot be shrunk to a picture, so it is stored as a file like the banner
async function avatarValue(src) {
  if (!src) return null;
  if (!/^data:image\/gif/.test(src)) return shrinkImg(src, 160);
  if (!sbUser) return undefined;
  const blob = await (await fetch(src)).blob();
  const path = sbUser.id + "/avatar-" + Date.now() + ".gif";
  const { error } = await sb.storage.from("media").upload(path, blob, { contentType: "image/gif" });
  if (error) return undefined;
  return sb.storage.from("media").getPublicUrl(path).data.publicUrl;
}
async function bannerUrl(src) {
  if (!src) return null;
  if (!/^data:/.test(src)) return src;
  if (!sbUser) return undefined;
  const blob = await (await fetch(src)).blob();
  const path = sbUser.id + "/banner-" + Date.now() + ".jpg";
  const { error } = await sb.storage.from("media").upload(path, blob, { contentType: blob.type || "image/jpeg" });
  if (error) return undefined;
  return sb.storage.from("media").getPublicUrl(path).data.publicUrl;
}
async function uploadMedia(srcs) {
  const urls = [];
  for (let i = 0; i < srcs.length; i++) {
    const blob = await (await fetch(srcs[i])).blob();
    const ext = (blob.type.split("/")[1] || "bin").replace("jpeg", "jpg");
    const path = sbUser.id + "/" + Date.now() + "-" + i + "." + ext;
    const { error } = await sb.storage.from("media").upload(path, blob, { contentType: blob.type });
    if (error) return null;
    urls.push(sb.storage.from("media").getPublicUrl(path).data.publicUrl);
  }
  return urls;
}
// posts that could not be saved are sent again by themselves when the connection is back
function retryUnsent() {
  if (!sbUser || !S || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
  S.posts.filter(p => !p.remote && !p.ai && !p.ra && !p.sending && !p.noRetry && (p.text || (p.imgs && p.imgs.length)) && (!p.parent || (byId(p.parent) && byId(p.parent).remote))).slice(0, 3).forEach(p => pushPost(p, true));
}
async function pushPost(np, quiet) {
  const hasImgs = !!(np.imgs && np.imgs.length);
  if (!sbUser || (!np.text && !hasImgs) || np.sending) return;
  const par = np.parent ? byId(np.parent) : null;
  if (np.parent && (!par || !par.remote)) return;
  np.sending = true;
  try { await pushPostNow(np, par, hasImgs, quiet); } finally { delete np.sending; }
}
// posting is paused for a while after posts were taken down; the server decides, this only tells the person
let postLock = null;
async function loadPostLock() {
  if (!sbUser) { postLock = null; return; }
  try {
    const { data, error } = await sb.rpc("nook_post_lock");
    if (error) return;
    const r = Array.isArray(data) ? data[0] : data;
    postLock = r && r.locked_until ? { until: Date.parse(r.locked_until), strikes: r.strikes } : null;
  } catch (e) {}
}
const lockLeft = () => (postLock && postLock.until > Date.now() ? postLock.until - Date.now() : 0);
// always counted in hours, so 14 days reads as 336 hours
function lockText(ms) {
  const hr = Math.max(1, Math.ceil(ms / 36e5));
  return hr + (hr === 1 ? " hour" : " hours");
}
function postLockedSheet() {
  const scrim = h("div", { class: "scrim" });
  const done = () => dismiss(scrim, ov);
  const ov = h("div", { class: "sheet warn", role: "alertdialog", "aria-modal": "true" },
    h("div", { class: "grab" }, h("i")),
    h("div", { class: "warnt" }, "Posting is paused"),
    h("p", {}, "Some of your posts were removed for breaking the rules. You can post again in " + lockText(lockLeft()) + ". More removed posts mean a longer pause and then a ban."),
    h("button", { class: "pri", onclick: done }, "I understand"));
  layer.append(scrim, ov);
}
async function pushPostNow(np, par, hasImgs, quiet) {
  const row = { user_id: sbUser.id, body: np.text || "" };
  let urls = null;
  if (hasImgs) {
    urls = await uploadMedia(np.imgs);
    if (!urls) { if (!quiet) toast("Could not upload the photo. It will be sent again when the connection is back"); return; }
    row.media_url = JSON.stringify(urls);
  }
  if (par) row.parent_id = par.remote;
  // the id is made here and kept, so a send that is repeated after a lost answer can never make a second post
  if (!np.rid) np.rid = crypto.randomUUID();
  row.id = np.rid;
  let { data, error } = await sb.from("posts").insert(row).select("id").single();
  if (error && error.code === "23505") { data = { id: np.rid }; error = null; }
  // deleted on this phone while it was still uploading: it goes from the server again
  if (!error && data && !S.posts.includes(np)) { S.pendDel = (S.pendDel || []).concat(data.id); persist(); serverDelete([{ remote: data.id, media: urls || [] }]); return; }
  if (!error && data) { np.remote = data.id; np.media = urls || []; persist(); }
  else {
    if (urls && urls.length) sb.storage.from("media").remove(urls.map(u => storagePath(u, "media")).filter(Boolean)).then(() => {}, () => {});
    // posting is paused: this post is dropped instead of being tried again and again
    const lk = /post_locked:(\d+)/.exec(String((error && error.message) || ""));
    if (lk) {
      postLock = { until: Number(lk[1]) * 1000, strikes: 0 };
      const gone = new Set([np.id]);
      for (let grew = true; grew;) { grew = false; S.posts.forEach(x => { if (x.parent && gone.has(x.parent) && !gone.has(x.id)) { gone.add(x.id); grew = true; } }); }
      S.posts = S.posts.filter(x => !gone.has(x.id));
      persist(); render();
      if (!quiet) postLockedSheet();
      return;
    }
    if (!quiet) toast("Could not send that post yet. It will be sent again when the connection is back");
  }
}
const BANNED_WORDS = ["nigger", "nigga", "n1gga", "n1gger", "nigg4", "nigg3r", "n1gg4", "n1gg3r"];
function bannedHit(text) {
  if (!BANNED_WORDS.length) return null;
  const norm = " " + (text || "").toLowerCase().normalize("NFKD").replace(/\p{M}+/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim() + " ";
  return BANNED_WORDS.find(w => norm.includes(" " + w + " ")) || null;
}
function openCompose(o) {
  o = o || {};
  if (sbUser && lockLeft()) { postLockedSheet(); return; }
  const parent = o.parent ? byId(o.parent) : null;
  if (parent && !parent.remote && !parent.ai && !parent.ra && !zenThread(parent)) { toast("Wait for the post to finish uploading"); return; }
  const ed = o.edit ? byId(o.edit) : null;
  let imgs = ed ? ed.imgs.slice() : [];
  const jobs = [];
  const draftText = !ed && !parent && S.draft && Date.now() - S.draft.t < 120000 ? S.draft.text : "";
  const startText = ed ? ed.text : o.prefix ? o.prefix : draftText;
  const ta = h("textarea", { class: "cta", id: "ctext", maxlength: "5000", placeholder: parent ? "Write your reply" : PH_NOW, "aria-label": "Post text" });
  ta.value = startText;
  const grid = h("div", { class: "cimgs" });
  const bCam = pickBtn("camera", "Take a photo", true, files => addFiles(files));
  const bImg = pickBtn("image", "Add photos", false, files => addFiles(files), true, files => addFiles(files));
  const keepDraft = () => { if (!ed && !parent && ta.value.trim()) { S.draft = { text: ta.value, t: Date.now() }; persist(); } };
  const kind = ed ? "Save" : parent ? "Reply" : "Post";
  const m = modal({
    title: "",
    onBack: () => keepDraft(),
    action: kind,
    body: [
      parent ? h("div", { class: "quote" }, h("b", {}, parent.ai ? "Zenith" : parent.ra ? (parent.ra.name || "@" + parent.ra.handle) : (S.profile.name || "@" + S.profile.handle)), " " + (parent.text ? parent.text.slice(0, 140) : "Photo post")) : null,
      h("div", { class: "crow" }, avatar(40), ta),
      grid
    ],
    foot: h("div", { class: "cfoot" }, bCam, bImg),
    onCancel: close => {
      const dirty = ta.value !== startText || imgs.length !== (ed ? ed.imgs.length : 0);
      if (dirty) sheet([{ label: "Discard", danger: true, fn: () => { S.draft = null; persist(); close(); } }, { label: "Keep editing", cancel: true }], "Discard this post?");
      else close();
    },
    onAction: close => {
      const text = cleanText(ta.value.trim());
      if (bannedHit(text)) { toast("That post has a banned word"); return; }
      if (ed) {
        const origin = ed.imgs.slice(), was = { text: ed.text, imgs: ed.imgs, edited: ed.edited };
        // shown at once, and put back if the server refuses it
        syncEdit(ed, text, origin, imgs.slice()).then(ok => { if (!ok) { ed.text = was.text; ed.imgs = was.imgs; ed.edited = was.edited; persist(); render(); } });
        ed.text = text; ed.imgs = imgs.slice(); ed.edited = true;
      }
      else {
        const np = { id: uid(), text, t: Date.now(), imgs: imgs.slice(), parent: parent ? parent.id : null, liked: false, reposted: false, saved: false, pinned: false };
        S.posts.push(np);
        pushPost(np);
        setTimeout(zenTick, 400);
        if (!parent) S.draft = null;
        fresh = np.id;
      }
      persist(); close(); render();
      toast(ed ? "Saved" : parent ? "Reply sent" : "Posted");
    }
  });
  function drawImgs() {
    grid.textContent = "";
    imgs.forEach((src, i) => grid.append(h("div", {}, mkImg(src), h("button", { "aria-label": "Remove photo", onclick: () => { imgs.splice(i, 1); drawImgs(); sync(); } }, ic("close", 20)))));
    jobs.forEach(j => grid.append(j.el));
  }
  function sync() {
    m.act.disabled = jobs.length > 0 || (!ta.value.trim() && !imgs.length);
    const full = imgs.length + jobs.length >= 4;
    [bCam, bImg].forEach(b => { b.classList.toggle("off", full); b.querySelector("input").disabled = full; });
    ta.style.height = "auto";
    ta.style.height = Math.max(130, ta.scrollHeight) + "px";
  }
  function addFiles(files) { return addMedia(files, imgs, jobs, 4, () => { drawImgs(); sync(); }); }
  ta.addEventListener("input", sync);
  drawImgs();
  sync();
  if (o.files) addFiles(o.files);
  else ta.focus();
}

async function openCropper(file, o) {
  let d;
  try { d = await decode(file); } catch (e) { toast("Could not read that photo"); return null; }
  const k = Math.min(1, 2048 / Math.max(d.w, d.h));
  const iw = Math.max(1, Math.round(d.w * k));
  const ih = Math.max(1, Math.round(d.h * k));
  const src = document.createElement("canvas");
  src.width = iw; src.height = ih;
  const sx = src.getContext("2d");
  sx.drawImage(d.im, 0, 0, iw, ih);
  if (d.im.close) d.im.close();
  return new Promise(resolve => {
    const cv = h("canvas", { class: "cropcv" });
    const m = modal({
      title: o.title,
      action: "Done",
      body: [h("div", { class: "crop" }, cv), h("p", { class: "hint" }, "Drag to move, pinch to zoom")],
      onCancel: close => { close(); resolve(null); },
      onAction: close => {
        // a moving picture is cut frame by frame later, so only the chosen area is handed back (in the pixels of the original)
        if (o.rect) { const l0 = cx - iw * s / 2, t0 = cy - ih * s / 2; close(); resolve({ x: (fl - l0) / s / k, y: (ft - t0) / s / k, w: fw / s / k, h: fh / s / k }); return; }
        const oc = document.createElement("canvas");
        oc.width = o.w; oc.height = o.h;
        const ox = oc.getContext("2d");
        const alpha = hasAlpha(file);
        if (!alpha) { ox.fillStyle = "#fff"; ox.fillRect(0, 0, o.w, o.h); }
        const left = cx - iw * s / 2, top = cy - ih * s / 2;
        ox.drawImage(src, (fl - left) / s, (ft - top) / s, fw / s, fh / s, 0, 0, o.w, o.h);
        close();
        resolve(alpha ? oc.toDataURL("image/png") : oc.toDataURL("image/jpeg", 0.86));
      }
    });
    const body = m.ov.querySelector(".mbody");
    const cs = getComputedStyle(body);
    const W = Math.max(200, Math.min(520, Math.floor(body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight))));
    const pad = 16;
    const fw = W - pad * 2;
    const fh = o.round ? fw : Math.round(fw * o.h / o.w);
    const H = o.round ? W : Math.max(fh + pad * 2 + 80, Math.round(W * 0.8));
    const fl = pad, ft = Math.round((H - fh) / 2);
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + "px"; cv.style.height = H + "px";
    const minS = Math.max(fw / iw, fh / ih);
    let s = minS, cx = W / 2, cy = H / 2;
    const clamp = () => {
      s = Math.min(Math.max(s, minS), minS * 4);
      const hw = iw * s / 2, hh = ih * s / 2;
      cx = Math.min(Math.max(cx, fl + fw - hw), fl + hw);
      cy = Math.min(Math.max(cy, ft + fh - hh), ft + hh);
    };
    const bgc = getComputedStyle(document.documentElement).getPropertyValue("--bg2").trim() || "#1f2a37";
    const draw = () => {
      const c = cv.getContext("2d");
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = bgc; c.fillRect(0, 0, W, H);
      c.drawImage(src, cx - iw * s / 2, cy - ih * s / 2, iw * s, ih * s);
      c.beginPath();
      c.rect(0, 0, W, H);
      if (o.round) c.arc(W / 2, H / 2, fw / 2, 0, Math.PI * 2); else c.rect(fl, ft, fw, fh);
      c.fillStyle = "rgba(10,15,20,0.5)";
      c.fill("evenodd");
      c.beginPath();
      if (o.round) c.arc(W / 2, H / 2, fw / 2, 0, Math.PI * 2); else c.rect(fl, ft, fw, fh);
      c.strokeStyle = "#fff"; c.lineWidth = 1.5; c.stroke();
      if (!o.round) {
        c.beginPath();
        for (let i = 1; i < 3; i++) {
          c.moveTo(fl + fw * i / 3, ft); c.lineTo(fl + fw * i / 3, ft + fh);
          c.moveTo(fl, ft + fh * i / 3); c.lineTo(fl + fw, ft + fh * i / 3);
        }
        c.strokeStyle = "rgba(255,255,255,0.3)"; c.lineWidth = 1; c.stroke();
      }
    };
    const zoomAt = (g, px, py) => {
      const ns = Math.min(Math.max(s * g, minS), minS * 4);
      const f = ns / s;
      cx = px + (cx - px) * f; cy = py + (cy - py) * f; s = ns;
      clamp(); draw();
    };
    const pts = new Map();
    cv.addEventListener("pointerdown", e => { try { cv.setPointerCapture(e.pointerId); } catch (x) {} pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
    cv.addEventListener("pointermove", e => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      const np = { x: e.clientX, y: e.clientY };
      if (pts.size === 1) { cx += np.x - p.x; cy += np.y - p.y; clamp(); draw(); }
      else if (pts.size === 2) {
        const other = Array.from(pts.entries()).find(en => en[0] !== e.pointerId)[1];
        const od = Math.hypot(p.x - other.x, p.y - other.y);
        const nd = Math.hypot(np.x - other.x, np.y - other.y);
        const r = cv.getBoundingClientRect();
        if (od > 0) {
          const pmx = (p.x + other.x) / 2 - r.left, pmy = (p.y + other.y) / 2 - r.top;
          const mx = (np.x + other.x) / 2 - r.left, my = (np.y + other.y) / 2 - r.top;
          const ns = Math.min(Math.max(s * nd / od, minS), minS * 4);
          const g = ns / s;
          cx = mx + (cx - pmx) * g; cy = my + (cy - pmy) * g; s = ns;
          clamp(); draw();
        }
      }
      pts.set(e.pointerId, np);
    });
    const up = e => { pts.delete(e.pointerId); };
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", e => { e.preventDefault(); const r = cv.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.08 : 1 / 1.08, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    clamp();
    draw();
  });
}

function editProfile() {
  const pr = S.profile;
  let avatarData = pr.avatar, bannerData = pr.banner, themeVal = pr.bannerTheme === "avatar" ? "avatar" : "default";
  const name = h("input", { class: "in", id: "en", maxlength: "15" });
  const handle = h("input", { class: "in", id: "eh", autocapitalize: "none", autocomplete: "off" });
  const bio = h("textarea", { class: "in", id: "eb", rows: 3, maxlength: "500" });
  name.value = pr.name; handle.value = pr.handle; bio.value = pr.bio || "";
  const bn = h("div", { class: "ebanner" });
  const avl = h("span", {}, (pr.name || pr.handle || "?").charAt(0).toUpperCase());
  const av = h("div", { class: "av" }, avl);
  const setPic = (el, src) => { el.querySelectorAll(":scope > img.pic").forEach(i => i.remove()); if (src) el.prepend(picImg(src)); };
  const paintBanner = (el, banner, theme, avatar) => { el.querySelectorAll(":scope > img.pic").forEach(i => i.remove()); if (theme === "avatar" && avatar) el.prepend(mkImg(avatar, "pic blur")); else if (banner) el.prepend(picImg(banner)); };
  const paint = () => {
    paintBanner(bn, bannerData, themeVal, avatarData);
    setPic(av, avatarData);
    avl.textContent = (name.value || handle.value || "?").trim().charAt(0).toUpperCase();
  };
  const pickImg = (label, size, opts, set) => {
    const inp = h("input", { type: "file", accept: "image/*", class: "vh", "aria-label": label });
    inp.addEventListener("change", async () => {
      const f = inp.files && inp.files[0];
      if (f) {
        let out = null;
        if (isVideo(f)) { toast("Videos are not supported"); }
        else if (isGif(f)) { try { out = await cropGif(f, opts); } catch (e) { toast("Could not read that GIF"); } }
        else out = await openCropper(f, opts);
        if (out) { set(out); paint(); }
      }
      inp.value = "";
    });
    return h("label", { class: "pick", title: label }, ic("camera", size), inp);
  };
  name.addEventListener("input", paint);
  bn.append(pickImg("Change banner", 18, { w: 1000, h: 330, gw: 600, gh: 198, title: "Crop banner" }, d => { bannerData = d; }));
  const eav = h("div", { class: "eav" }, av, pickImg("Change avatar", 16, { w: 320, h: 320, gw: 240, gh: 240, round: true, title: "Crop profile photo" }, d => { avatarData = d; }));
  const seg = h("div", { class: "seg" });
  const drawSeg = () => { seg.textContent = ""; [["default", "Default"], ["avatar", "Blurred photo"]].forEach(([v, t]) => seg.append(h("button", { class: v === themeVal ? "on" : "", onclick: () => { themeVal = v; paint(); drawSeg(); } }, t))); };
  drawSeg();
  paint();
  const lockLeft = () => {
    const t = pr.handleChangedAt ? Date.parse(pr.handleChangedAt) + 7 * 864e5 - Date.now() : 0;
    return t > 0 ? Math.ceil(t / 864e5) : 0;
  };
  const lockDays = lockLeft();
  if (lockDays) handle.disabled = true;
  const handleErr = err => {
    const m = /handle_locked:(\d+)/.exec((err && err.message) || "");
    if (m) return "You can change your handle again in " + m[1] + (m[1] === "1" ? " day" : " days");
    if (err && err.code === "23505") return "That handle is taken";
    if (err && /invalid_handle|handle_required/.test(err.message || "")) return "That handle is not allowed";
    return "Could not save the handle";
  };
  const m = modal({
    top: true,
    onCancel: close => {
      const dirty = name.value.trim() !== (pr.name || "") || handle.value.trim().toLowerCase() !== pr.handle || bio.value !== (pr.bio || "") || avatarData !== pr.avatar || bannerData !== pr.banner || themeVal !== (pr.bannerTheme === "avatar" ? "avatar" : "default");
      if (dirty) sheet([{ label: "Discard changes", danger: true, fn: close }, { label: "Keep editing", cancel: true }], "Discard your changes?"); else close();
    },
    title: "Edit profile",
    body: [bn, eav, h("div", { class: "fld" }, h("label", {}, "Banner style"), seg),
      h("div", { class: "fld" }, h("label", { for: "en" }, "Display name"), name),
      h("div", { class: "fld" }, h("label", { for: "eh" }, "Handle"), handle, lockDays ? h("p", { class: "dim-note" }, "You changed your handle recently. You can change it again in " + lockDays + (lockDays === 1 ? " day." : " days.")) : null),
      h("div", { class: "fld" }, h("label", { for: "eb" }, "Bio"), bio)],
    onAction: async close => {
      const newHandle = handle.value.trim().toLowerCase();
      const handleChanged = newHandle !== pr.handle;
      if (handleChanged) {
        if (lockDays) { toast("You can change your handle again in " + lockDays + (lockDays === 1 ? " day" : " days")); return; }
        if (!newHandle) { toast("Your handle can not be empty"); return; }
        if (!/^[a-z0-9._]{1,15}$/.test(newHandle)) { toast("Handle: letters, numbers, dots or underscores, up to 15"); return; }
      }
      m.act.disabled = true;
      try {
        if (handleChanged && sbUser) {
          const { data, error } = await sb.from("accounts").update({ username: newHandle }).eq("id", sbUser.id).select("username, handle_changed_at").single();
          if (error || !data) { toast(handleErr(error)); return; }
          pr.handle = data.username;
          pr.handleChangedAt = data.handle_changed_at;
        } else if (handleChanged) pr.handle = newHandle;
        const was = { name: pr.name, bio: pr.bio, avatar: pr.avatar, banner: pr.banner, bannerTheme: pr.bannerTheme };
        pr.name = name.value.trim().slice(0, 15);
        pr.bio = bio.value;
        pr.avatar = avatarData;
        pr.banner = bannerData;
        pr.bannerTheme = themeVal;
        if (sbUser) {
          const uid0 = sbUser.id;
          // the editor only closes when the server took the change; otherwise it stays open with what was typed
          const { error: ue } = await sb.from("accounts").update({ bio: pr.bio, display_name: pr.name, banner_theme: pr.bannerTheme }).eq("id", uid0);
          if (ue) { Object.assign(pr, was); toast("Could not save your profile. " + plainErr(ue, "Try again")); return; }
          avatarValue(pr.avatar).then(small => {
            if (small === undefined) { toast("Could not upload profile photo"); return; }
            if (sbUser) sb.from("accounts").update({ avatar: small }).eq("id", uid0).then(({ error }) => { if (error) toast("The new picture was not saved. " + plainErr(error, "Try again later")); loadFeed(); if (sbUser && sbUser.id === uid0) rememberAccount({ username: pr.handle, name: pr.name || pr.handle, avatar: small }).catch(() => {}); });
          });
          const src = pr.banner;
          bannerUrl(src).then(url => {
            if (url === undefined) { toast("Could not upload banner"); return; }
            sb.from("accounts").update({ banner: url }).eq("id", uid0).then(({ error }) => { if (error) toast("The new banner was not saved. " + plainErr(error, "Try again later")); });
            if (url && pr.banner === src && url !== src) { pr.banner = url; persist(); }
          });
        }
        persist(); close(); render(); toast("Profile saved");
        if (sbUser) rememberAccount({ username: pr.handle, name: pr.name || pr.handle, avatar: pr.avatar }).catch(() => {});
      } finally { m.act.disabled = false; }
    }
  });
}

// checks the current password through the signin function so the same limit applies; { ok, msg }
async function verifyPassword(pw) {
  const r = await callFn("signin", { check: true, password: pw }).catch(() => null);
  if (!r) return { ok: false, msg: "Could not reach Nook. Check your connection" };
  if (r.ok) { await takeSession(r); return { ok: true }; }
  const e = r.body && r.body.error;
  if (e === "wrong_password") return { ok: false, msg: "Current password is wrong" + (r.body.left > 0 ? ". " + r.body.left + (r.body.left === 1 ? " try" : " tries") + " left before a wait" : "") };
  return { ok: false, msg: signinMsg(r) };
}
function changePassV() {
  const cur = h("input", { class: "in", type: "password", placeholder: "Current password", autocomplete: "current-password", "aria-label": "Current password" });
  const nw = h("input", { class: "in", type: "password", placeholder: "New password", autocomplete: "new-password", "aria-label": "New password" });
  const again = h("input", { class: "in", type: "password", placeholder: "New password again", autocomplete: "new-password", "aria-label": "Repeat new password" });
  const msg = h("p", { class: "note", role: "alert" });
  let busy = false;
  modal({
    title: "Change password",
    body: [h("div", { class: "fld" }, cur), h("div", { class: "fld" }, nw), h("div", { class: "fld" }, again), msg],
    onAction: async close => {
      if (busy) return;
      msg.textContent = "";
      if (!cur.value || !nw.value) { msg.textContent = "Fill in every box"; return; }
      if (nw.value.length < 8) { msg.textContent = "New password needs 8 or more characters"; return; }
      if (nw.value !== again.value) { msg.textContent = "New passwords do not match"; return; }
      if (nw.value === cur.value) { msg.textContent = "Pick a different password"; return; }
      busy = true;
      try {
        if (await pwnedPassword(nw.value)) { msg.textContent = PWNED_MSG; return; }
        const pr = await callFn("signin", { action: "setpw", current: cur.value, password: nw.value }).catch(() => null);
        if (!pr) { msg.textContent = "Could not reach Nook. Check your connection"; return; }
        if (!pr.ok) { msg.textContent = setpwMsg(pr); return; }
        await takeSession(pr);
        const kr = await loginBackup(nw.value, { reseal: true });
        close();
        toast(kr === "fail" ? "Password changed. Your message key could not be saved with it" : "Password changed");
      } finally { busy = false; }
    }
  });
}
function changeEmailV() {
  const cur = h("input", { class: "in", type: "password", placeholder: "Current password", autocomplete: "current-password", "aria-label": "Current password" });
  const ne = h("input", { class: "in", type: "email", placeholder: "New email", autocomplete: "email", "aria-label": "New email" });
  const msg = h("p", { class: "note", role: "alert" });
  let busy = false;
  modal({
    title: "Change email",
    body: [h("div", { class: "fld" }, cur), h("div", { class: "fld" }, ne), msg],
    onAction: async close => {
      if (busy) return;
      msg.textContent = "";
      const e = ne.value.trim().toLowerCase();
      if (!cur.value || !e) { msg.textContent = "Fill in every box"; return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) { msg.textContent = "That email does not look real"; return; }
      if (e === (sbUser.email || "").toLowerCase()) { msg.textContent = "That is already your email"; return; }
      busy = true;
      try {
        const vp = await verifyPassword(cur.value);
        if (!vp.ok) { msg.textContent = vp.msg; return; }
        const { error } = await sb.auth.updateUser({ email: e });
        if (error) { msg.textContent = authMsg(error); return; }
        close();
        toast("Confirmation link sent to " + e);
      } finally { busy = false; }
    }
  });
}
function openDrawer() {
  const scrim = h("div", { class: "scrim", onclick: () => close() });
  const item = (name, label, icon) => h("button", { class: "dm", onclick: () => close(() => root(name)) }, ic(icon, 28), label);
  const dr = h("div", { class: "drawer", role: "dialog", "aria-label": "Menu" },
    avatar(56),
    h("h2", {}, S.profile.name || "@" + S.profile.handle),
    h("p", { class: "hand" }, "@" + S.profile.handle),
    h("div", { class: "dsp" }),
    ...(zOn() ? [h("button", { class: "dm", onclick: () => close(() => root("zen")) }, zenAv(28), "Zenith")] : []),
    item("search", "Search", "search"), item("lists", "Lists", "list"), item("settings", "Settings", "sliders"));
  const close = trackLayer(() => dismiss(scrim, dr));
  layer.append(scrim, dr);
}

const BAN_EMAIL = "nook-banned-email";
// what is saved on this phone (posts, chats, profile picture) belongs to the account that used it last
const LOCAL_UID = "nook-local-uid";
async function foreignLocalData(acct) {
  let mark = null;
  try { mark = localStorage.getItem(LOCAL_UID); } catch (e) {}
  if (mark) return mark !== sbUser.id;
  // older data has no owner mark yet: it only stays if its handle is this account's
  const h0 = ((S && S.profile && S.profile.handle) || "").toLowerCase();
  const mine = h0 && acct && acct.username && h0 === String(acct.username).toLowerCase();
  const empty = !S || (!(S.posts || []).length && !(S.chats || []).length && !h0);
  if (mine || empty) { try { localStorage.setItem(LOCAL_UID, sbUser.id); } catch (e) {} return false; }
  return true;
}
async function wipeLocal(keepKeys) {
  noSave = true;
  clearTimeout(timer);
  try {
    if (db) await new Promise(res => { const t = db.transaction(["kv", "img"], "readwrite"); t.objectStore("kv").clear(); t.objectStore("img").clear(); t.oncomplete = res; t.onerror = res; t.onabort = res; });
  } catch (e) {}
  try {
    localStorage.removeItem("tiny-posts-v3");
    Object.keys(localStorage).filter(k => k.startsWith(CACHE_PFX)).forEach(k => localStorage.removeItem(k));
    sessionStorage.removeItem("nook-route");
  } catch (e) {}
  // the chat key stays while a banned person can still download their backup, so old messages can be opened
  try { if ("caches" in window) caches.delete("nook-share"); } catch (e) {}
  // only the key of the account being cleared goes; other accounts on this phone keep theirs
  if (!keepKeys) { try { if (sbUser) { const kdb = await keyDb(); await new Promise(res => { const t = kdb.transaction("k", "readwrite"); t.objectStore("k").delete(sbUser.id); t.oncomplete = res; t.onerror = res; t.onabort = res; }); } else indexedDB.deleteDatabase("nook-keys"); } catch (e) {} }
}
let banShown = false;
function showBanned(email) {
  if (banShown) return;
  banShown = true;
  try {
    const mail = email || (sbUser && sbUser.email) || "";
    if (mail) localStorage.setItem(BAN_EMAIL, mail);
  } catch (e) {}
  if (rtChan) { try { sb.removeChannel(rtChan); } catch (e) {} rtChan = null; }
  leaving = true;
  Promise.resolve(sb.auth.signOut()).catch(() => {}).then(() => wipeLocal(true)).then(() => {
    sbUser = null;
    leaving = false;
    stack = [{ r: "banned" }];
    scrolls.length = 0;
    layer.textContent = "";
    render();
  });
}
function bannedV() {
  navEl.hidden = true;
  const leave = () => { wipeLocal(false); try { localStorage.removeItem(BAN_EMAIL); } catch (e) {} banShown = false; stack = [{ r: "auth" }]; scrolls.length = 0; render(); };
  main.append(h("div", { class: "empty", style: "padding-top:18vh" },
    ic("lock", 56),
    h("h1", { class: "pname", style: "margin:0;color:var(--fg)" }, "You're banned"),
    h("p", {}, "Your account was banned and removed. A backup of your data is kept for 30 days."),
    h("button", { class: "pri", onclick: bannedDownload }, "Download my data"),
    h("button", { class: "ghost", onclick: () => confirmSheet("This clears Nook from this device. Download your data first if you want it.", "Use a different account", leave) }, "Use a different account")));
}
// asked of accounts the AI thinks belong to a child; the page does not say why
function ageV() {
  navEl.hidden = true;
  const msg = h("p", { class: "note", role: "alert" });
  const day = h("input", { class: "in", type: "text", inputmode: "numeric", pattern: "[0-9]*", maxlength: "3", placeholder: "Your age", autocomplete: "off", "aria-label": "Your age" });
  day.addEventListener("input", () => { day.value = day.value.replace(/\D/g, "").slice(0, 3); });
  day.addEventListener("keydown", e => { if (e.key === "Enter") send(); });
  const go1 = h("button", { class: "pri", onclick: send }, "Continue");
  async function send() {
    const years = Number(day.value);
    if (!day.value) { msg.textContent = "Type your age."; return; }
    if (years < 1 || years > 120) { msg.textContent = "Type your real age, from 1 to 120."; return; }
    go1.disabled = true; msg.textContent = "";
    const r = await callFn("age", { action: "answer", age: years });
    go1.disabled = false;
    const s = r.body && r.body.state;
    if (s === "passed") { try { sessionStorage.removeItem("nook-route"); } catch (e) {} location.reload(); return; }
    if (s === "banned") { showBanned(sbUser && sbUser.email); return; }
    msg.textContent = failText(r, "Something went wrong. Try again.");
  }
  main.append(h("div", { class: "empty", style: "padding-top:14vh" },
    h("h1", { class: "pname", style: "margin:0;color:var(--fg)" }, "One quick question"),
    h("p", {}, "How old are you?"),
    h("div", { class: "fld", style: "width:100%;max-width:320px" }, day),
    go1, msg,
    h("button", { class: "tbtn", onclick: () => confirmSheet("Sign out of this account?", "Sign out", signOutNow) }, "Sign out")));
}
const extFromType = t => ({ "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" })[t] || "bin";
// the chat key of this browser, only if it is still here; used to open old messages in the backup
async function banChatKey(uid, peerKey) {
  try {
    if (!uid || !peerKey || !crypto.subtle) return null;
    const kdb = await keyDb();
    const rec = await new Promise((res, rej) => { const q = kdb.transaction("k").objectStore("k").get(uid); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    if (!rec || !rec.priv) return null;
    const peer = await crypto.subtle.importKey("raw", fromB64(peerKey), E2E_ALG, false, []);
    return await crypto.subtle.deriveKey({ name: "ECDH", public: peer }, rec.priv, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  } catch (e) { return null; }
}
async function buildBanZip(j, say) {
  const d = j.data || {};
  const uid = d.account && d.account.id;
  const enc = t => new TextEncoder().encode(t);
  const files = [];
  const put = (name, data) => { files.push({ name, data: typeof data === "string" ? enc(data) : data }); };
  const putText = (name, lines) => { if (lines.length) put(name, lines.join("\n") + "\n"); };
  const when = t => { const x = new Date(t); return isNaN(x) ? "" : x.toISOString().slice(0, 16).replace("T", " ") + " UTC"; };
  const got = new Map();
  let n = 0;
  for (const f of j.files || []) {
    try { const r = await fetch(f.url); if (r.ok) got.set(f.bucket + "/" + f.name, new Uint8Array(await r.arrayBuffer())); } catch (e) {}
    say("Getting your files " + (++n) + " of " + j.files.length);
  }
  const rel = u => { const m = /\/object\/(?:public|sign)\/[^/]+\/[0-9a-f-]{36}\/([^?#]+)/i.exec(u || ""); return m ? decodeURIComponent(m[1]) : null; };
  const photosOf = mu => {
    let arr = [];
    if (mu) { try { arr = String(mu).trim().startsWith("[") ? JSON.parse(mu) : [mu]; } catch (e) { arr = [mu]; } }
    return arr.map(rel).filter(x => x && got.has("media/" + x)).map(x => { put("photos/posts/" + x, got.get("media/" + x)); return "photos/posts/" + x; });
  };
  const block = (p, photos) => when(p.created_at) + "\n" + (p.text || "") + photos.map(x => "\n[photo: " + x + "]").join("");
  const posts = [], replies = [];
  (d.posts || []).forEach(p => { (p.reply_to ? replies : posts).push(block(p, photosOf(p.media_url))); });
  if (posts.length) put("posts.txt", posts.join("\n\n") + "\n");
  if (replies.length) put("replies.txt", replies.join("\n\n") + "\n");

  const acc = d.account || {};
  const profile = ["Username: " + (acc.username || ""), "Name: " + (acc.display_name || ""), "Email: " + (d.email || ""), "Joined: " + when(acc.created_at)];
  if (acc.bio) profile.push("Bio: " + acc.bio);
  put("profile.txt", profile.join("\n") + "\n");
  if (acc.avatar && /^data:/.test(acc.avatar)) { try { put("avatar." + extOf(acc.avatar), new Uint8Array(await (await fetch(acc.avatar)).arrayBuffer())); } catch (e) {} }
  const bn = rel(acc.banner);
  if (bn && got.has("media/" + bn)) put("banner." + (bn.split(".").pop() || "jpg"), got.get("media/" + bn));

  putText("following.txt", d.following || []);
  putText("followers.txt", d.followers || []);
  putText("likes.txt", d.likes || []);
  putText("reposts.txt", d.reposts || []);
  putText("nicknames.txt", (d.nicknames || []).map(x => x.person + ": " + x.nickname));

  let sealed = 0;
  for (const c of d.chats || []) {
    if (!(c.messages || []).length) continue;
    const key = await banChatKey(uid, c.peer_public_key);
    const who = safeName(c.person);
    const lines = [];
    let i = 0;
    for (const m of c.messages) {
      let text = m.text || "", note = "";
      if (text.slice(0, 5) === "e2e1:") {
        const parts = text.slice(5).split(".");
        try { text = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(parts[0]) }, key, fromB64(parts[1]))); } catch (e) { text = ""; note = " [could not be opened]"; sealed++; }
      }
      const shots = [];
      for (const md of m.media || []) {
        const name = rel(md.url), raw = name && got.get("dm-media/" + name);
        if (!raw) continue;
        let bytes = raw, ext = extFromType(md.type);
        if (md.iv) { try { bytes = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(md.iv) }, key, raw)); } catch (e) { ext = "bin"; sealed++; } }
        const path = "photos/messages/" + who + "/" + (++i) + "." + ext;
        put(path, bytes);
        shots.push("\n[photo: " + path + "]");
      }
      lines.push("[" + when(m.created_at) + "] " + (m.from_me ? "me" : c.person) + ": " + text + note + shots.join(""));
    }
    put("messages/" + who + ".txt", lines.join("\n") + "\n");
  }
  if (sealed) put("notes.txt", sealed + " item(s) in your chats are end to end encrypted and could not be opened here. Messages are only readable on the device that made them.\n");
  return { blob: makeZip(files), count: files.length };
}
function bannedDownload() {
  const email = h("input", { class: "in", type: "email", placeholder: "Email", autocomplete: "email", "aria-label": "Email" });
  const pw = h("input", { class: "in", type: "password", placeholder: "Password", autocomplete: "current-password", "aria-label": "Password" });
  let saved = "";
  try { saved = localStorage.getItem(BAN_EMAIL) || ""; } catch (e) {}
  email.value = saved;
  const msg = h("p", { class: "note", role: "alert" });
  const m = modal({
    title: "Download my data",
    action: "Download",
    body: [h("p", { class: "note" }, "Type the email and password of the banned account. You get a zip with your posts, photos, profile and chats."), h("div", { class: "fld" }, email), h("div", { class: "fld" }, pw), msg],
    onAction: async close => {
      const e = email.value.trim();
      if (!e || !pw.value) { msg.textContent = "Fill in your email and password"; return; }
      m.act.disabled = true;
      msg.textContent = "Checking...";
      try {
        const r = await fetch(SB_URL + "/functions/v1/ban-export", { signal: AbortSignal.timeout ? AbortSignal.timeout(25000) : undefined, method: "POST", headers: { "content-type": "application/json", apikey: SB_KEY }, body: JSON.stringify({ email: e, password: pw.value }) });
        let j = null;
        try { j = await r.json(); } catch (x) {}
        if (!r.ok || !j) { msg.textContent = j && j.error === "locked" ? lockedMsg(j.until) : (j && j.error) || "Could not get your data. Try again later."; return; }
        const zip = await buildBanZip(j, t => { msg.textContent = t; });
        close();
        saveSheet(zip.blob, "nook-data-" + new Date().toISOString().slice(0, 10) + ".zip", zip.count);
      } catch (x) {
        msg.textContent = "Something went wrong. Try again.";
      } finally { m.act.disabled = false; }
    }
  });
}
async function checkBan() {
  if (!sbUser || banShown) return;
  const { data } = await sb.from("bans").select("user_id").eq("user_id", sbUser.id).maybeSingle();
  if (data) showBanned();
}

const codeInput = label => h("input", { class: "in", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "7", placeholder: "6 digit code", "aria-label": label || "6 digit code" });
function authenticatorSetup() {
  return new Promise(resolve => {
    const box = h("div", { class: "fld ctr" }, h("p", { class: "note" }, "Getting your key..."));
    const code = codeInput();
    const msg = h("p", { class: "note", role: "alert" });
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    const m = modal({
      title: "Authenticator app",
      action: "Turn on",
      body: [box, h("div", { class: "fld" }, h("label", {}, "Then type the 6 digit code it shows"), code), msg],
      onBack: () => finish(false),
      onCancel: close => { close(); finish(false); },
      onAction: async close => {
        const c = code.value.replace(/\s+/g, "");
        if (!/^\d{6}$/.test(c)) { msg.textContent = "Type the 6 digit code from the app"; return; }
        m.act.disabled = true;
        msg.textContent = "";
        try {
          const r = await callFn("totp", { action: "enable", code: c });
          if (!r.ok) { msg.textContent = failText(r, "That code did not work"); return; }
          totpOn = true;
          close();
          toast("Authenticator is on");
          finish(true);
        } finally { m.act.disabled = false; }
      }
    });
    m.act.disabled = true;
    const begin = () => callFn("totp", { action: "begin" }).then(r => {
      box.textContent = "";
      if (!r.ok) { box.append(h("p", { class: "note" }, failText(r, "Could not start the setup.")), h("button", { class: "ghost", type: "button", onclick: () => { box.textContent = ""; begin(); } }, "Try again")); return; }
      box.append(
        h("a", { class: "pri sbtn big", href: r.body.uri }, "Add Nook to the app"),
        h("p", { class: "note" }, "If that does not open the app, add it by hand with this key. Tap the key to copy it."),
        h("button", { class: "keybox", type: "button", onclick: () => copy(r.body.secret) }, r.body.secret));
      m.act.disabled = false;
    });
    begin();
  });
}
function authenticatorOff() {
  const code = codeInput();
  const msg = h("p", { class: "note", role: "alert" });
  const m = modal({
    title: "Turn off authenticator",
    action: "Turn off",
    body: [h("p", { class: "note" }, "Type the 6 digit code from your authenticator app. Without it you can not reset a forgotten password."), h("div", { class: "fld" }, code), msg],
    onAction: async close => {
      const c = code.value.replace(/\s+/g, "");
      if (!/^\d{6}$/.test(c)) { msg.textContent = "Type the 6 digit code from the app"; return; }
      m.act.disabled = true;
      try {
        const r = await callFn("totp", { action: "disable", code: c });
        if (!r.ok) { msg.textContent = failText(r, "That code did not work"); return; }
        totpOn = false;
        close();
        render();
        toast("Authenticator is off");
      } finally { m.act.disabled = false; }
    }
  });
}
let totpOn = null;
function recoverModal(prefill) {
  const ident = h("input", { class: "in", placeholder: "Email or username", autocomplete: "username", "aria-label": "Email or username", autocapitalize: "none" });
  ident.value = prefill || "";
  const msg = h("p", { class: "note", role: "alert" });
  const alt = h("button", { class: "tbtn", type: "button", hidden: true, onclick: () => { const v = ident.value.trim(); m.close(() => recoverCodeModal(v)); } }, "Use my authenticator code instead");
  const m = modal({
    title: "Reset password",
    action: "Send link",
    body: [h("p", { class: "note" }, "We will email you a link to choose a new password."), h("div", { class: "fld" }, ident), msg, h("div", { class: "ctr" }, alt)],
    onAction: async close => {
      msg.textContent = "";
      const id = ident.value.trim();
      if (!id) { msg.textContent = "Type your email or username"; return; }
      m.act.disabled = true;
      try {
        try { localStorage.setItem("nook-reset-asked", String(Date.now())); } catch (e) {}
        const r = await callFn("totp", { action: "reset", ident: id, redirectTo: location.origin + location.pathname });
        if (!r.ok) { msg.textContent = "Could not send the link. Try again later."; return; }
        close();
        toast("If that account exists, a reset link is on its way");
      } catch (e) { msg.textContent = "Could not reach the server. Try again later."; }
      finally { m.act.disabled = false; }
    }
  });
  let tmr = 0, seq = 0;
  const probe = () => {
    const id = ident.value.trim(), n = ++seq;
    if (!id) { alt.hidden = true; return; }
    callFn("totp", { action: "has", ident: id }).then(r => { if (n === seq) alt.hidden = !(r.ok && r.body.enabled); }, () => {});
  };
  ident.addEventListener("input", () => { alt.hidden = true; clearTimeout(tmr); tmr = setTimeout(probe, 500); });
  if (ident.value) probe();
}
function recoverCodeModal(prefill) {
  const ident = h("input", { class: "in", placeholder: "Email or username", autocomplete: "username", "aria-label": "Email or username", autocapitalize: "none" });
  ident.value = prefill || "";
  const code = codeInput();
  const pw = h("input", { class: "in", type: "password", placeholder: "New password", autocomplete: "new-password", "aria-label": "New password" });
  const pw2 = h("input", { class: "in", type: "password", placeholder: "New password again", autocomplete: "new-password", "aria-label": "Repeat new password" });
  const msg = h("p", { class: "note", role: "alert" });
  const m = modal({
    title: "Authenticator code",
    action: "Reset",
    body: [h("p", { class: "note" }, "Type the 6 digit code from your authenticator app."), h("div", { class: "fld" }, ident), h("div", { class: "fld" }, code), h("div", { class: "fld" }, pw), h("div", { class: "fld" }, pw2), msg],
    onAction: async close => {
      msg.textContent = "";
      const c = code.value.replace(/\s+/g, "");
      if (!ident.value.trim() || !/^\d{6}$/.test(c)) { msg.textContent = "Fill in your email or username and the 6 digit code"; return; }
      if (pw.value.length < 8) { msg.textContent = "New password needs 8 or more characters"; return; }
      if (pw.value.length > 72) { msg.textContent = "New password can be 72 characters at most"; return; }
      if (pw.value !== pw2.value) { msg.textContent = "New passwords do not match"; return; }
      m.act.disabled = true;
      try {
        if (await pwnedPassword(pw.value)) { msg.textContent = PWNED_MSG; return; }
        const r = await callFn("totp", { action: "recover", ident: ident.value.trim(), code: c, password: pw.value });
        if (!r.ok) { msg.textContent = failText(r, "Could not reset the password"); return; }
        close();
        toast("Password changed. Sign in with it now.");
      } finally { m.act.disabled = false; }
    }
  });
}
// opened from the link in the reset email: the person is signed in just for this
function newPasswordModal() {
  const pw = h("input", { class: "in", type: "password", placeholder: "New password", autocomplete: "new-password", "aria-label": "New password" });
  const pw2 = h("input", { class: "in", type: "password", placeholder: "New password again", autocomplete: "new-password", "aria-label": "Repeat new password" });
  const msg = h("p", { class: "note", role: "alert" });
  const leave = async () => { await sb.auth.signOut().catch(() => {}); location.reload(); };
  const m = modal({
    title: "New password",
    action: "Save",
    body: [h("p", { class: "note" }, "Choose a new password for your account."), h("div", { class: "fld" }, pw), h("div", { class: "fld" }, pw2), msg],
    onBack: leave,
    onCancel: close => { close(); leave(); },
    onAction: async close => {
      msg.textContent = "";
      if (pw.value.length < 8) { msg.textContent = "New password needs 8 or more characters"; return; }
      if (pw.value !== pw2.value) { msg.textContent = "New passwords do not match"; return; }
      m.act.disabled = true;
      try {
        if (await pwnedPassword(pw.value)) { msg.textContent = PWNED_MSG; return; }
        const pr = await callFn("signin", { action: "setpw", password: pw.value }).catch(() => null);
        if (!pr) { msg.textContent = "Could not reach Nook. Check your connection"; return; }
        if (!pr.ok) { msg.textContent = pr.body && pr.body.error === "no_password" ? "This link has run out. Ask for a new one" : setpwMsg(pr); return; }
        await takeSession(pr);
        const kr = await loginBackup(pw.value, { reseal: true });
        close();
        toast(kr === "fail" ? "Password changed. Your message key could not be saved with it" : "Password changed");
      } finally { m.act.disabled = false; }
    }
  });
}

const VAPID_PUBLIC = "BHfuPbwRPzD71CGmJaEMX5eizbSknGd2rjSJIVO-9ahWUcsL6z-eEC_bhWCLloy0EdOEVyBoiLgQZjdaIrO5udA";
const b64uToU8 = s => { const p = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4); return Uint8Array.from(atob(p), c => c.charCodeAt(0)); };
const pushOk = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const swReady = ms => Promise.race([navigator.serviceWorker.ready, new Promise((_, rej) => setTimeout(() => rej(new Error("The app is not installed here yet. Reload and try again.")), ms))]);
async function pushSub() {
  if (!pushOk()) return null;
  try { const reg = await swReady(1500); return await reg.pushManager.getSubscription(); } catch (e) { return null; }
}
async function pushSave(sub) {
  const j = sub.toJSON();
  if (!sbUser || !j.endpoint || !j.keys) return false;
  const { error } = await sb.from("push_subs").upsert({ user_id: sbUser.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: "endpoint" });
  return !error;
}
async function pushOn() {
  if (!pushOk()) throw new Error("This browser can not do push notifications. On iPhone, add Nook to your home screen first.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications are blocked. Allow them in your phone settings.");
  const reg = await swReady(5000);
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try { sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToU8(VAPID_PUBLIC) }); }
    catch (e) { throw new Error("Could not connect to the push service on this device"); }
  }
  if (!(await pushSave(sub))) throw new Error("Could not save this device");
  try { localStorage.removeItem("nook-push-off"); localStorage.setItem("nook-push-ep", sub.endpoint); } catch (e) {}
}
async function pushOff() {
  const sub = await pushSub();
  if (!sub) return;
  const ep = sub.endpoint;
  try { localStorage.setItem("nook-push-off", "1"); localStorage.removeItem("nook-push-ep"); } catch (e) {}
  try { await sub.unsubscribe(); } catch (e) {}
  if (sbUser) await sb.from("push_subs").delete().eq("endpoint", ep);
}
// keep this device's subscription fresh, and make sure it belongs to whoever is signed in
async function pushSync() {
  if (!pushOk() || Notification.permission !== "granted") return;
  let off = false, saved = "";
  try { off = localStorage.getItem("nook-push-off") === "1"; saved = localStorage.getItem("nook-push-ep") || ""; } catch (e) {}
  if (off) return;
  let sub = await pushSub();
  try {
    const reg = await swReady(5000);
    if (sub && sub.endpoint === saved) {
      // the server drops a push address that the phone no longer answers to: when this one is gone from the list, start a new one
      const { data } = await sb.from("push_subs").select("endpoint").eq("endpoint", sub.endpoint).maybeSingle();
      if (!data) { try { await sub.unsubscribe(); } catch (e) {} sub = null; }
    }
    // permission is still allowed but the phone lost its push address (storage was cleared): make a new one
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToU8(VAPID_PUBLIC) });
  } catch (e) { return; }
  if (sub && (await pushSave(sub).catch(() => false))) { try { localStorage.setItem("nook-push-ep", sub.endpoint); } catch (e) {} }
}
async function pushDetach() {
  const sub = await pushSub();
  if (sub && sbUser) await sb.from("push_subs").delete().eq("endpoint", sub.endpoint).then(() => {}, () => {});
}
// each saved account keeps its own login (the refresh token) and its own local data (lists, notes, settings); a password is only asked when an account is added
let switching = false, leaving = false;
function acctDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("nook-accts", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("a");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function acctGet(k) {
  const db = await acctDb();
  return new Promise((res, rej) => { const q = db.transaction("a").objectStore("a").get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
async function acctPut(k, v) {
  const db = await acctDb();
  return new Promise((res, rej) => { const t = db.transaction("a", "readwrite"); t.objectStore("a").put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}
async function acctDel(k) {
  const db = await acctDb();
  return new Promise((res, rej) => { const t = db.transaction("a", "readwrite"); t.objectStore("a").delete(k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}
async function acctList() {
  try { const l = await acctGet("list"); return Array.isArray(l) ? l : []; } catch (e) { return []; }
}
async function rememberAccount(info) {
  if (!sbUser) return;
  const { data } = await sb.auth.getSession();
  const ss = data && data.session;
  if (!ss || ss.user.id !== sbUser.id) return;
  const list = await acctList();
  const old = list.find(a => a.id === sbUser.id) || {};
  const av = info && typeof info.avatar === "string" && info.avatar.length < 400000 ? info.avatar : (info ? null : old.avatar || null);
  // the first account saved on this phone is the main one and cannot be removed from the list
  const entry = { id: sbUser.id, rt: ss.refresh_token, username: (info && info.username) || old.username || "", name: (info && info.name) || old.name || "", avatar: av, main: old.main === true || (!list.some(a => a.id === sbUser.id) && list.length === 0) };
  const at = list.findIndex(a => a.id === sbUser.id);
  if (at >= 0) list[at] = entry; else list.push(entry);
  await acctPut("list", list);
}
const mainAccountId = list => ((list.find(a => a.main) || list[0]) || {}).id;
async function forgetAccount(id) {
  const list = await acctList();
  await acctPut("list", list.filter(a => a.id !== id));
  await acctDel("snap:" + id).catch(() => {});
}
async function saveSnap(id) { await acctPut("snap:" + id, JSON.stringify(S)); }
async function loadSnap(id, entry) {
  let next = null;
  try { const raw = await acctGet("snap:" + id); next = raw ? JSON.parse(raw) : null; } catch (e) {}
  noSave = false;
  S = next || freshState();
  // an account that was never opened here starts with its real name, handle and picture, not "Me"
  if (!next && entry) { S.profile = Object.assign({}, S.profile, { handle: entry.username || S.profile.handle, name: entry.name || entry.username || S.profile.name, avatar: entry.avatar || null }); }
  normalize();
  await flush();
}
async function enterAccount(entry) {
  switching = true;
  try {
    enterFail = "";
    const got = await Promise.race([sb.auth.refreshSession({ refresh_token: entry.rt }), wait(12000).then(() => null)]);
    if (!got) { enterFail = "offline"; return false; }
    const { data, error } = got;
    // only a real refusal of the saved login removes the account; a bad connection, a busy server or a limit never does
    if (error && error.status === 429) { enterFail = "busy"; return false; }
    if (error && !(error.status === 400 || error.status === 401 || error.status === 403)) { enterFail = "offline"; return false; }
    if (error || !data || !data.session) { enterFail = "login"; await forgetAccount(entry.id); return false; }
    // the login rotated, so the new one is saved at once
    await acctPut("list", (await acctList()).map(x => x.id === entry.id ? Object.assign({}, x, { rt: data.session.refresh_token }) : x)).catch(() => {});
    try { sessionStorage.removeItem("nook-route"); } catch (e) {}
    await loadSnap(entry.id, entry);
    try { localStorage.setItem(LOCAL_UID, entry.id); } catch (e) {}
    location.reload();
    return true;
  } catch (e) { enterFail = "offline"; return false; } finally { switching = false; }
}
let enterFail = "";
async function switchAccount(id) {
  if (!sbUser || id === sbUser.id || switching) return;
  switching = true;
  try { await switchAccountNow(id); } finally { switching = false; }
}
async function switchAccountNow(id) {
  const target = (await acctList()).find(a => a.id === id);
  if (!target) return;
  toast("Switching...");
  try { localStorage.setItem("nook-prev-acct", sbUser.id); } catch (e) {}
  await rememberAccount().catch(() => {});
  await saveSnap(sbUser.id).catch(() => {});
  await pushDetach().catch(() => {});
  try { localStorage.removeItem("nook-push-ep"); } catch (e) {}
  if (!(await enterAccount(target))) {
    pushSync().catch(() => {});
    if (enterFail === "offline") { toast("No connection. Try again"); return; }
    if (enterFail === "busy") { toast("Too many tries. Try again in a few minutes"); return; }
    toast("Sign in again to use that account");
    addAccountModal();
  }
}
// a slow network never holds up leaving: the phone is cleared first, the server is told on the way out
let signingOut = false;
async function signOutNow() {
  if (leaving || signingOut) return;
  signingOut = true;
  toast("Signing out...");
  // the push address of this phone goes from the server even if the page is closed right after
  try {
    const sub = await Promise.race([pushSub(), wait(800).then(() => null)]);
    const { data: cur } = await Promise.race([sb.auth.getSession(), wait(800).then(() => ({ data: null }))]);
    const tok = cur && cur.session ? cur.session.access_token : null;
    if (sub && tok) fetch(SB_URL + "/rest/v1/push_subs?endpoint=eq." + encodeURIComponent(sub.endpoint), { method: "DELETE", headers: { apikey: SB_KEY, authorization: "Bearer " + tok }, keepalive: true }).catch(() => {});
  } catch (e) {}
  await Promise.race([pushDetach().catch(() => {}), wait(2000)]);
  await leaveThisAccount();
}
async function leaveThisAccount() {
  leaving = true;
  const me = sbUser.id;
  await forgetAccount(me);
  // the saved copies of this account's inbox and chats leave the phone with it
  try { Object.keys(localStorage).filter(k => k.startsWith(CACHE_PFX) && k.includes(me)).forEach(k => localStorage.removeItem(k)); } catch (e) {}
  const rest = await acctList();
  const next = rest.find(a => a.id === mainAccountId(rest)) || rest[0];
  // this phone's login is removed here and now; telling the server happens in the background and can fail without blocking anything
  try {
    const { data: cur } = await Promise.race([sb.auth.getSession(), wait(1500).then(() => ({ data: null }))]);
    const tok = cur && cur.session ? cur.session.access_token : null;
    if (tok) fetch(SB_URL + "/auth/v1/logout?scope=local", { method: "POST", headers: { apikey: SB_KEY, authorization: "Bearer " + tok }, keepalive: true }).catch(() => {});
    Object.keys(localStorage).filter(k => /^sb-.*-auth-token$/.test(k)).forEach(k => localStorage.removeItem(k));
  } catch (e) {}
  if (next && (await enterAccount(next))) return;
  location.reload();
}
// makes a brand new account and keeps it on this phone next to the open one; the open one stays open
function newAccountModal() {
  const dn = h("input", { class: "in", type: "text", placeholder: "Display name", autocomplete: "off", "aria-label": "Display name", "data-pm": "1" });
  const user = h("input", { class: "in", type: "text", placeholder: "Username", autocomplete: "off", "aria-label": "Username", "data-pm": "1" });
  const email = h("input", { class: "in", type: "email", placeholder: "Email", autocomplete: "off", "aria-label": "Email", "data-pm": "1" });
  const pw = pwField("Password", "new-password");
  const msg = h("p", { class: "note", role: "alert" });
  // the message also shows as a toast, because the keyboard can cover the line under the fields
  const say = t => { msg.textContent = t; if (t) toast(t); };
  const go1 = h("button", { class: "pri" }, "Create account");
  const m = modal({
    title: "",
    action: "Create",
    body: [h("div", { class: "auth", style: "padding-top:max(4vh,16px)" },
      h("h1", {}, "Nook"),
      h("p", { class: "sub" }, "Make your account"),
      hinted(dn, 15), hinted(user, 15, { re: /^[A-Za-z0-9._]*$/, msg: "Only letters, numbers, dots and underscores" }), email, hinted(pw.input, 72, null, 8, pw.wrap),
      msg, go1)],
    onAction: close => create(close)
  });
  m.act.hidden = true;
  go1.addEventListener("click", () => create(m.close));
  const create = async close => {
      msg.textContent = "";
      const n = dn.value.trim(), u = user.value.trim(), e = email.value.trim(), p = pw.input.value;
      if (!n) { say("Enter a display name"); return; }
      if (!/^[A-Za-z0-9._]{1,15}$/.test(u)) { say("Username: letters, numbers, dots or underscores, max 15"); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) { say("That email does not look right. Check for typos"); return; }
      if (p.length < 8) { say("Password needs at least 8 characters"); return; }
      go1.disabled = true;
      try {
        const { data: taken } = await sb.from("accounts").select("id").eq("username", u).maybeSingle();
        if (taken) { say("That username is taken"); return; }
        if (await pwnedPassword(p)) { say(PWNED_MSG); return; }
        const sr = await callFn("signin", { action: "signup", email: e, password: p }).catch(() => null);
        if (!sr) { say("Could not reach Nook. Check your connection"); return; }
        if (!sr.ok) { say(sr.body.error === "signup_failed" ? authMsg({ code: sr.body.code, message: sr.body.message, status: sr.body.status }) : signinMsg(sr)); return; }
        if (!sr.body.session) { say("Check your email to confirm, then add it with Add account"); return; }
        // a separate connection, so the account that is open keeps its own login
        const tmp = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
        const { data: sd, error: se } = await tmp.auth.setSession({ access_token: sr.body.session.access_token, refresh_token: sr.body.session.refresh_token });
        if (se || !sd.user) { say("Could not set it up. Try again"); return; }
        const id = sd.user.id;
        const ins = await tmp.from("accounts").insert({ id, username: u, display_name: n });
        if (ins.error) { say(ins.error.code === "23505" ? "That username is taken" : "Could not save the account. " + plainErr(ins.error, "Try again")); return; }
        // its message key is made now and saved locked with the password, like for any new account
        try {
          const rec = await makeKeyPair();
          await saveLocalKeys(await keyDb(), id, rec);
          const row = await sealKeyBackup(rec.priv, rec.pub, p, "login");
          row.user_id = id;
          await tmp.from("key_backups").upsert(row, { onConflict: "user_id,mode" });
          await tmp.from("accounts").update({ public_key: rec.pub }).eq("id", id);
        } catch (x) {}
        const list = await acctList();
        await acctPut("list", list.filter(x => x.id !== id).concat({ id, rt: sr.body.session.refresh_token, username: u, name: n, avatar: null, main: false }));
        linkSavedAccounts(id, sr.body.session.access_token).catch(() => {});
        close();
        toast("Account created");
        setTimeout(openAccounts, 350);
      } catch (x) { say("Something went wrong. Try again"); } finally { go1.disabled = false; }
  };
}
function addAccountModal() {
  const email = h("input", { class: "in", type: "email", placeholder: "Email", autocomplete: "email", "aria-label": "Email", "data-pm": "1" });
  const pw = pwField("Password", "current-password");
  const pass = pw.input;
  const msg = h("p", { class: "note", role: "alert" });
  // the message also shows as a toast, because the keyboard can cover the line under the fields
  const say = t => { msg.textContent = t; if (t) toast(t); };
  const go1 = h("button", { class: "pri" }, "Sign in");
  const m = modal({
    title: "",
    action: "Add",
    body: [h("div", { class: "auth", style: "padding-top:max(4vh,16px)" },
      h("h1", {}, "Nook"),
      h("p", { class: "sub" }, "Sign in to continue"),
      email, pw.wrap, msg, go1,
      h("button", { class: "tbtn", onclick: () => recoverModal(email.value.trim()) }, "Forgot password?"),
      h("button", { class: "ghost", onclick: () => m.close(newAccountModal) }, "Make an account"))],
    onAction: close => add(close)
  });
  m.act.hidden = true;
  go1.addEventListener("click", () => add(m.close));
  pass.addEventListener("keydown", e => { if (e.key === "Enter") go1.click(); });
  const add = async close => {
      msg.textContent = "";
      const e = email.value.trim();
      if (!e || !pass.value) { say("Enter the email and password"); return; }
      go1.disabled = true;
      try {
        const r = await callFn("signin", { email: e, password: pass.value }).catch(() => null);
        if (!r) { say("Could not reach Nook. Check your connection"); return; }
        if (r.body && r.body.error === "banned") { say("That account is banned"); return; }
        if (!r.ok) { say(signinMsg(r)); return; }
        const { data: u } = await sb.auth.getUser(r.body.session.access_token);
        if (!u || !u.user) { say("Could not sign in. Try again"); return; }
        if (u.user.id === sbUser.id) { say("That is the account you are in"); return; }
        // the name, handle and picture are public, so they are read before the account is shown anywhere
        const { data: info } = await sb.from("accounts").select("id, username, display_name, avatar").eq("id", u.user.id).maybeSingle();
        if (!info || !info.username) { say("Could not load that account. Try again"); return; }
        const list = await acctList();
        await acctPut("list", list.filter(a => a.id !== info.id).concat({ id: info.id, rt: r.body.session.refresh_token, username: info.username, name: info.display_name || info.username, avatar: typeof info.avatar === "string" && info.avatar.length < 400000 ? info.avatar : null, main: false }));
        linkSavedAccounts(info.id, r.body.session.access_token).catch(() => {});
        close();
        toast("Account added");
        setTimeout(openAccounts, 350);
      } finally { go1.disabled = false; }
  };
}
// the name, handle and picture of every account on this phone, read fresh so a changed picture shows at once
async function refreshAcctEntries(list) {
  const { data } = await sb.from("accounts").select("id, username, display_name, avatar").in("id", list.map(a => a.id));
  if (!data) return list;
  let changed = false;
  data.forEach(r => {
    const a = list.find(x => x.id === r.id);
    if (!a) return;
    const av = typeof r.avatar === "string" && r.avatar.length < 400000 ? r.avatar : null;
    const name = r.display_name || r.username;
    if (a.username !== r.username || a.name !== name || (a.avatar || null) !== av) { a.username = r.username; a.name = name; a.avatar = av; changed = true; }
  });
  if (changed) await acctPut("list", list);
  return list;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
// accounts linked to each other: the server remembers it, every phone then lists them, and each one still opens with its own password
async function linkSavedAccounts(newId, newToken) {
  try {
    const { data } = await sb.auth.getSession();
    const mine = data && data.session;
    if (!mine) return;
    const list = await acctList();
    const tokens = newToken ? [newToken] : [];
    const tmp = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    let changed = false;
    for (const a of list) {
      if (a.id === sbUser.id || a.id === newId || !a.rt) continue;
      const r = await tmp.auth.refreshSession({ refresh_token: a.rt });
      if (r.data && r.data.session) { tokens.push(r.data.session.access_token); a.rt = r.data.session.refresh_token; changed = true; }
    }
    if (changed) await acctPut("list", list);
    await fetch(SB_URL + "/functions/v1/link-accounts", { method: "POST", headers: { "content-type": "application/json", apikey: SB_KEY, authorization: "Bearer " + mine.access_token }, body: JSON.stringify({ tokens }) });
  } catch (e) {}
}
// a linked account that is not on this phone yet: its password opens it here
function linkedLoginModal(x) {
  const pw = pwField("Password");
  const msg = h("p", { class: "note", role: "alert" });
  // the message also shows as a toast, because the keyboard can cover the line under the fields
  const say = t => { msg.textContent = t; if (t) toast(t); };
  const m = modal({
    title: "@" + x.username,
    action: "Switch",
    body: [pw.wrap, msg],
    onAction: async close => {
      msg.textContent = "";
      if (!pw.input.value) { say("Enter the password"); return; }
      m.act.disabled = true;
      try {
        const r = await callFn("signin", { action: "linked", target: x.id, password: pw.input.value }).catch(() => null);
        if (!r) { say("Could not reach Nook. Check your connection"); return; }
        if (r.body && r.body.error === "banned") { say("That account is banned"); return; }
        if (!r.ok) { say(r.body && r.body.error === "not_linked" ? "That account is not linked anymore" : signinMsg(r)); return; }
        const list = await acctList();
        await acctPut("list", list.filter(a => a.id !== x.id).concat({ id: x.id, rt: r.body.session.refresh_token, username: x.username, name: x.name, avatar: x.avatar, main: false }));
        close(() => switchAccount(x.id));
      } finally { m.act.disabled = false; }
    }
  });
}
async function openAccounts() {
  const all0 = await acctList();
  const all = await Promise.race([refreshAcctEntries(all0).catch(() => all0), wait(700).then(() => all0)]);
  // the linked accounts that are not on this phone yet
  let others = [], linkedIds = new Set();
  try {
    const { data: ls } = await Promise.race([sb.from("account_links").select("b").eq("a", sbUser.id), wait(1200).then(() => ({ data: null }))]);
    linkedIds = new Set((ls || []).map(r => r.b));
    const missing = [...linkedIds].filter(id => !all.some(a => a.id === id));
    if (missing.length) {
      const m = await cachedAccounts(missing);
      others = missing.map(id => { const x = m.get(id) || {}; return { id, username: x.username || "", name: x.display_name || x.username || "", avatar: typeof x.avatar === "string" && x.avatar.length < 400000 ? x.avatar : null }; }).filter(x => x.username);
    }
  } catch (e) {}
  // the pictures are loaded before the sheet opens, so no letter circle shows first
  await Promise.race([Promise.all([...all, ...others].map(a => a.avatar ? new Promise(res => { const i = new Image(); i.onload = i.onerror = () => res(); i.src = view(a.avatar); }) : null)), wait(600)]);
  const list = all.filter(a => a.username);
  const nm = a => a.name || a.username || "Account";
  const items = list.map(a => ({ av: { name: nm(a), avatar: a.avatar || null }, label: a.username ? "@" + a.username : nm(a), on: a.id === sbUser.id, fn: a.id === sbUser.id ? null : () => switchAccount(a.id) }));
  others.forEach(x => items.push({ av: { name: x.name, avatar: x.avatar }, label: "@" + x.username, trail: ic("lock", 18), fn: () => linkedLoginModal(x) }));
  items.push({ icon: "plus", label: "Add account", fn: addAccountModal });
  // only an added account shows this, and only while it is the open one: the main account stays on the phone
  const cur = all.find(a => a.id === sbUser.id);
  const risky = [];
  if (cur && cur.id !== mainAccountId(all)) risky.push({ icon: "close", label: "Remove this account", danger: true, fn: () => confirmSheet("Remove @" + (cur.username || "this account") + " from this phone? You need its password to add it again.", "Remove", async () => { await pushDetach().catch(() => {}); await leaveThisAccount(); }) });
  // only an added account that is linked to the main one can be unlinked from it, the main account never shows this
  if (cur && cur.id !== mainAccountId(all) && linkedIds.has(mainAccountId(all))) risky.push({ icon: "close", label: "Unlink this account", danger: true, fn: () => confirmSheet("Unlink @" + S.profile.handle + " from your other accounts? They stop listing each other on other phones.", "Unlink", async () => {
    const me = sbUser.id;
    const { error } = await sb.from("account_links").delete().or("a.eq." + me + ",b.eq." + me);
    toast(error ? "Could not unlink" : "Unlinked");
  }) });
  if (risky.length) items.push({ icon: "close", label: "Remove or unlink", danger: true, fn: () => sheet([...risky, { label: "Cancel", cancel: true }], "@" + (cur.username || "account")) });
  items.push({ label: "Cancel", cancel: true });
  sheet(items, "Accounts on this phone");
}
function handleOpen(v) {
  if (!sbUser || !v) return;
  if (v === "notifs") go({ r: "notifs" });
  else if (v.startsWith("dm:") && /^[0-9a-f-]{36}$/i.test(v.slice(3))) openDm(v.slice(3));
}
function takeOpen() {
  const p = new URLSearchParams(location.search);
  const v = p.get("open");
  if (!v) return;
  p.delete("open");
  history.replaceState(history.state, "", location.pathname + (p.toString() ? "?" + p.toString() : ""));
  handleOpen(v);
}
if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", e => { if (e.data && e.data.type === "open") handleOpen(e.data.open); });

const LEGAL = {
  privacy: { title: "Privacy Policy", body: [
    ["About this policy", [
      "This policy explains what Nook collects and how it is used.",
      "By using Nook you accept it."]],
    ["What we collect", [
      "Your email, username, display name, bio, profile photo and banner.",
      "Your password, stored scrambled and never as plain text.",
      "Your posts, photos, replies, likes, follows, blocks and reports.",
      "Your messages, stored encrypted. We cannot read them. We do keep who sent them, who received them and when.",
      "A push address for each device where you turn on notifications.",
      "Your sign-in attempts and whether you passed the age check.",
      "A count of your removed posts, tied to your email.",
      "Your settings, drafts and feed choices stay on your device."]],
    ["How we use it", [
      "To run Nook, send your notifications, enforce the rules and keep accounts safe.",
      "We do not sell your data, show ads or track how long you scroll."]],
    ["Messages and the key backup", [
      "Messages are end to end encrypted. The key lives on your devices.",
      "A copy of that key, locked with your login password, is stored so a new phone can open your messages. The server sees your password when you sign in, so in theory it could open that copy.",
      "You can turn the backup off in Settings."]],
    ["Aegis, the automated review", [
      "Aegis is Nook's automated reviewer. It checks posts, photos, profile pictures, banners, usernames, names and bios against the rules.",
      "For this check the content is sent to an outside AI service.",
      "Photos stay hidden until Aegis has checked them.",
      "Aegis can make mistakes."]],
    ["Links", [
      "When a link shows a preview card, the link is sent to a preview service and the picture loads from the linked site. This includes links sent in messages."]],
    ["Age", [
      "Nook is for people 18 and older.",
      "If you say you are under 18, or Aegis finds a sign of it, the account is locked or banned.",
      "A banned account is kept for 30 days so it can be downloaded, then deleted."]],
    ["Who helps us run Nook", [
      "Supabase for sign-in, the database, file storage and server functions.",
      "GitHub Pages to deliver the app.",
      "An outside AI service for Aegis.",
      "Your phone's push service to deliver notifications.",
      "Have I Been Pwned to check new passwords against known leaks, without sending the password itself.",
      "Each one only gets what it needs to do its job."]],
    ["Keeping and deleting your data", [
      "We keep your data until you delete it or delete your account.",
      "You can delete your account in Settings. You are offered a download of your data first, and you confirm with your email and password.",
      "A deleted account is hidden and kept for 30 days. If you sign in during that time it is restored. After 30 days it is deleted for good.",
      "The count of removed posts tied to your email is kept after deletion, so pauses and bans cannot be dodged by making a new account."]],
    ["Security", [
      "We protect your data with reasonable measures, but no system is completely secure."]],
    ["Changes", [
      "We may update this policy. If you keep using Nook after an update, you accept it."]],
  ] },
  terms: { title: "Terms of Use", body: [
    ["Using Nook", [
      "By using Nook you agree to these terms and to the Privacy Policy.",
      "If you do not agree, please do not use Nook."]],
    ["Who can use Nook", [
      "You must be 18 or older.",
      "You may only use Nook where it is legal to do so."]],
    ["Your account", [
      "You are responsible for your password and for everything done with your account."]],
    ["Your content", [
      "Your posts stay yours.",
      "You let Nook store, show and send them as needed to run the service.",
      "You must have the right to post what you post."]],
    ["What is not allowed", [
      "Nudity and sexual content.",
      "Threats, calls for violence, or praising violence against people.",
      "Hate against people because of their race, religion, gender, orientation, disability or origin.",
      "Harassment and bullying.",
      "Sharing other people's private information.",
      "Spam, scams and illegal material, including selling illegal goods.",
      "Content that pushes someone to hurt themselves.",
      "Anything sexual involving minors. This is reported to the authorities.",
      "Trying to break, probe or get into Nook without permission."]],
    ["Removed posts and pauses", [
      "Aegis, Nook's automated reviewer, checks content. Content that breaks these terms is removed. Aegis can make mistakes.",
      "Each removed post pauses your posting: 6 hours the first time, 24 hours the second, 72 hours the third, 168 hours the fourth and 336 hours the fifth. The sixth gets your account banned.",
      "The count is tied to your email. Deleting your account and making a new one does not reset it.",
      "A banned account can download its data.",
      "We may also warn, restrict or ban accounts that break these terms in other ways."]],
    ["AI-made content", [
      "Content marked as AI-made comes from an automated system, not from a person."]],
    ["No warranty", [
      "Nook is provided as it is and as it is available, with no promises of any kind.",
      "We do not promise it will always work or be free of errors."]],
    ["Our responsibility", [
      "As far as the law allows, we are not responsible for lost data, indirect losses, or what other users post."]],
    ["Ending your use", [
      "You can stop using Nook and delete your account at any time. A deleted account is kept for 30 days and can be restored by signing in.",
      "We may suspend or end your access if you break these terms."]],
    ["If part of these terms is invalid", [
      "The rest still applies."]],
    ["Changes", [
      "We may update these terms. If you keep using Nook after an update, you accept it."]],
  ] },
};
function legalV(c) {
  const doc = LEGAL[c.r];
  topEl.append(bar(backBtn(), ttl(doc.title)));
  if (!sbUser) navEl.hidden = true;
  main.append(h("div", { class: "legal" }, h("p", { class: "upd" }, "Last updated 25 October 2026"), ...doc.body.map(sec => h("div", {}, h("h2", {}, sec[0]), h("ul", {}, ...sec[1].map(t => h("li", {}, t)))))));
}
const legalLink = (r, label) => h("a", { role: "link", tabindex: "0", onclick: () => go({ r }), onkeydown: e => { if (e.key === "Enter") go({ r }); } }, label);

let authMode = "in";
function hinted(input, max, rule, min, holder) {
  const hint = h("p", { class: "hint", "aria-live": "polite" });
  const paint = () => {
    const n = input.value.length;
    let bad = false, text;
    if (rule && n && !rule.re.test(input.value)) { bad = true; text = rule.msg; }
    else if (n >= max) { bad = true; text = "Limit reached: " + max + " characters at most"; }
    else if (min && n && n < min) text = "At least " + min + " characters (" + n + "/" + min + ")";
    else text = "";
    hint.textContent = text;
    hint.classList.toggle("warn", bad);
  };
  input.setAttribute("maxlength", String(max));
  input.addEventListener("input", paint);
  paint();
  return h("div", { class: "fldh" }, holder || input, hint);
}
function authV() {
  const SIGNUP_OPEN = true;
  if (!SIGNUP_OPEN) authMode = "in";
  const up = authMode === "up";
  navEl.hidden = true;
  const msg = h("p", { class: "note", role: "alert" });
  try { const nt = sessionStorage.getItem("nook-notice"); if (nt) { msg.textContent = nt; sessionStorage.removeItem("nook-notice"); } } catch (e) {}
  const email = h("input", { class: "in", type: "email", placeholder: "Email", autocomplete: "email", "aria-label": "Email", "data-pm": "1" });
  const pass = h("input", { class: "in", type: "password", placeholder: "Password", autocomplete: up ? "new-password" : "current-password", "aria-label": "Password", style: "padding-right:60px", "data-pm": "1" });
  const eye = h("button", { type: "button", class: "tbtn", "aria-label": "Show password", style: "position:absolute;right:14px;top:50%;transform:translateY(-50%);padding:6px 0;color:var(--muted);font-size:var(--fs-md);font-weight:600", onclick: () => { const show = pass.type === "password"; pass.type = show ? "text" : "password"; eye.textContent = show ? "Hide" : "Show"; eye.setAttribute("aria-label", show ? "Hide password" : "Show password"); } }, "Show");
  const passWrap = h("div", { style: "position:relative" }, pass, eye);
  const dname = h("input", { class: "in", type: "text", placeholder: "Display name", autocomplete: "name", maxlength: "15", "aria-label": "Display name", "data-pm": "1" });
  const user = h("input", { class: "in", type: "text", placeholder: "Username", autocomplete: "username", maxlength: "15", "aria-label": "Username", "data-pm": "1" });
  const btn = h("button", { class: "pri" }, up ? "Create account" : "Sign in");
  const agree = up ? h("input", { type: "checkbox", id: "agree", "aria-label": "I agree to the Terms of Use and Privacy Policy" }) : null;
  const agreeRow = up ? h("label", { class: "agree" }, agree, h("span", {}, "I am 18+ and agree to the ", legalLink("terms", "Terms"), " and ", legalLink("privacy", "Privacy"))) : null;
  const forgot = up ? null : h("button", { class: "tbtn", onclick: () => recoverModal(email.value.trim()) }, "Forgot password?");
  const flip = SIGNUP_OPEN ? h("button", { class: "ghost", onclick: () => { authMode = up ? "in" : "up"; render(); } }, up ? "I already have an account" : "Make an account") : null;
  btn.addEventListener("click", async () => {
    msg.textContent = "";
    const e = email.value.trim(), p = pass.value, u = user.value.trim();
    if (!e && !p) { msg.textContent = "Enter your email and password"; return; }
    if (!e) { msg.textContent = "Enter your email"; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) { msg.textContent = "That email does not look right. Check for typos"; return; }
    if (!p) { msg.textContent = "Enter your password"; return; }
    btn.disabled = true;
    try {
      if (up) {
        const dn = dname.value.trim();
        if (!dn) { msg.textContent = "Enter a display name"; return; }
        if (!agree.checked) { msg.textContent = "Agree to the terms and privacy policy to continue"; return; }
        if (!/^[A-Za-z0-9._]{1,15}$/.test(u)) { msg.textContent = "Username: letters, numbers, dots or underscores, max 15"; return; }
        if (p.length < 8) { msg.textContent = "Password needs at least 8 characters"; return; }
        if (await pwnedPassword(p)) { msg.textContent = PWNED_MSG; return; }
        const { data: taken } = await sb.from("accounts").select("id").eq("username", u).maybeSingle();
        if (taken) { msg.textContent = "That username is taken"; return; }
        const sr = await callFn("signin", { action: "signup", email: e, password: p });
        if (!sr.ok) { msg.textContent = sr.body.error === "signup_failed" ? authMsg({ code: sr.body.code, message: sr.body.message, status: sr.body.status }) : signinMsg(sr); return; }
        if (!sr.body.session) { msg.textContent = "Check your email to confirm, then sign in"; return; }
        const { data, error } = await sb.auth.setSession({ access_token: sr.body.session.access_token, refresh_token: sr.body.session.refresh_token });
        if (error || !data.user) { msg.textContent = "Could not sign in. Try again"; return; }
        const { error: ie } = await sb.from("accounts").insert({ id: data.user.id, username: u, display_name: dn });
        if (ie) {
          // no half made account is left behind: the login that was just made is removed again
          await callFn("delete-account").catch(() => {});
          await sb.auth.signOut().catch(() => {});
          msg.textContent = ie.code === "23505" ? "That username is taken" : "Could not create the account. " + plainErr(ie, "Try again");
          return;
        }
        // the saved data on this phone may belong to someone else: the check at start-up clears it, so nothing is copied into the new account here
        sbUser = data.user;
        await loginBackup(p);
        await new Promise(r => setTimeout(r, 400));
      } else {
        const r = await callFn("signin", { email: e, password: p }).catch(() => ({ ok: false, body: {} }));
        if (r.body && r.body.error === "banned") { showBanned(e); return; }
        if (!r.ok) { msg.textContent = signinMsg(r); return; }
        if (!r.body || !r.body.session) { msg.textContent = "Could not sign in. Try again"; return; }
        const { data: sd, error } = await sb.auth.setSession({ access_token: r.body.session.access_token, refresh_token: r.body.session.refresh_token });
        if (error) { msg.textContent = "Could not sign in. Try again"; return; }
        try { localStorage.removeItem(BAN_EMAIL); } catch (x) {}
        // the typed password opens the saved chat key on a new phone, and locks it for this account when none is saved yet; both run at once and never hold the sign in for long
        if (sd && sd.user) sbUser = sd.user;
        // an account that was deleted less than 30 days ago comes back here; the plain wake up runs after it for older setups
        await Promise.race([Promise.all([Promise.resolve(sb.rpc("nook_restore_account")).then(a => { if (a && a.data === true) { try { sessionStorage.setItem("nook-welcome-back", "1"); } catch (x) {} } }).catch(() => {}).then(() => sb.rpc("set_my_deactivated", { flag: false })).catch(() => {}), sd && sd.user ? loginBackup(p).catch(() => {}) : null]), wait(10000)]);
      }
      location.reload();
    } finally { btn.disabled = false; }
  });
  pass.addEventListener("keydown", e => { if (e.key === "Enter") btn.click(); });
  const fields = up
    ? [hinted(dname, 15), hinted(user, 15, { re: /^[A-Za-z0-9._]*$/, msg: "Only letters, numbers, dots and underscores" }), email, hinted(pass, 72, null, 8, passWrap)]
    : [email, passWrap];
  main.append(h("div", { class: "auth" },
    h("h1", {}, "Nook"),
    h("p", { class: "sub" }, up ? "Make your account" : "Sign in to continue"),
    ...fields, agreeRow, msg, btn, forgot, flip, SIGNUP_OPEN ? null : h("p", { class: "note" }, "New accounts are closed for now"),
    h("p", { class: "note" }, legalLink("terms", "Terms"), " · ", legalLink("privacy", "Privacy"))));
}

const DM_BUCKET = "dm-media";
const acctCache = new Map();
let rtChan = null;
let tpChan = null;
let refreshChat = null;
let pageStop = null;
let liveDm = null;
let unreadN = 0;
let unreadPeople = 0;
const ACCT_TTL = 10 * 60 * 1000;
const CACHE_PFX = "nook-cache:";
function cacheRead(k) {
  try { const r = JSON.parse(localStorage.getItem(CACHE_PFX + k) || "null"); return r || undefined; } catch (e) { return undefined; }
}
function cacheWrite(k, v) {
  const val = JSON.stringify({ v, t: Date.now() });
  try { localStorage.setItem(CACHE_PFX + k, val); }
  catch (e) {
    try {
      Object.keys(localStorage).filter(x => x.startsWith(CACHE_PFX + "acct:")).forEach(x => localStorage.removeItem(x));
      localStorage.setItem(CACHE_PFX + k, val);
    } catch (e2) {}
  }
}
// the pictures people see first are loaded before the app opens, so they never pop in later (waits 3 seconds at most)
async function preloadAvatars(own) {
  const urls = new Set();
  const add = u => { if (typeof u === "string" && u) urls.add(u); };
  try {
    add(own);
    add(S && S.profile && S.profile.avatar);
    Object.keys(localStorage).filter(k => k.startsWith(CACHE_PFX + "acct:")).forEach(k => { try { const r = JSON.parse(localStorage.getItem(k)); add(r && r.v && r.v.avatar); } catch (e) {} });
    const inbox = cacheRead("inbox:" + sbUser.id);
    ((inbox && inbox.v) || []).forEach(cv => add(cv.avatar));
  } catch (e) {}
  const load = u => new Promise(res => {
    const i = new Image();
    i.onload = i.onerror = () => res();
    i.src = view(u);
    if (i.decode) i.decode().then(res, res);
  });
  await Promise.race([Promise.all([...urls].slice(0, 40).map(load)), new Promise(r => setTimeout(r, 3000))]);
}
function cacheFresh(k, ttl) {
  const r = cacheRead(k);
  return r && Date.now() - r.t < ttl ? r.v : undefined;
}
function cachedAccounts(ids) {
  const out = new Map();
  const miss = [];
  const stale = [];
  [...new Set(ids)].filter(Boolean).forEach(id => {
    const r = cacheRead("acct:" + id);
    if (r && r.v) { out.set(id, r.v); if (Date.now() - r.t >= ACCT_TTL) stale.push(id); } else miss.push(id);
  });
  const pull = list => sb.from("accounts").select(ACC_COLS).in("id", list).then(({ data, error }) => {
    if (error) out.failed = true;
    (data || []).forEach(a => { out.set(a.id, a); cacheWrite("acct:" + a.id, a); });
    return out;
  });
  // anything we have seen before shows at once, old ones are refreshed in the background
  if (stale.length) pull(stale).catch(() => {});
  if (!miss.length) return Promise.resolve(out);
  return pull(miss);
}
function countsOf(id, paint) {
  const c0 = cacheRead("fc:" + id);
  if (c0 && paint) paint(c0.v);
  return Promise.all([
    sb.from("follows").select("follower_id", { count: "exact", head: true }).eq("followee_id", id),
    sb.from("follows").select("followee_id", { count: "exact", head: true }).eq("follower_id", id)
  ]).then(([a, b]) => {
    const v = { followers: a.count || 0, following: b.count || 0 };
    if (!a.error && !b.error) cacheWrite("fc:" + id, v);
    if (paint) paint(v);
    return v;
  });
}
function acctsFor(ids) {
  const need = [...new Set(ids)].filter(id => id && !acctCache.has(id));
  if (!need.length) return Promise.resolve(acctCache);
  return cachedAccounts(need).then(m => {
    need.forEach(id => {
      const a = m.get(id);
      // a lookup that failed is not remembered, so the real name loads the next time
      if (a) acctCache.set(id, Object.assign({}, a, { name: a.display_name || a.username }));
      else if (!m.failed) acctCache.set(id, { id, username: "user", name: "user", avatar: null });
    });
    return acctCache;
  });
}
// a request that never answers is given up after a while, so a page never waits forever
const withTimeout = (p, ms) => Promise.race([Promise.resolve(p), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms || 12000))]);
// a short message and a Try again button where a list should be
function failBox(el, text, retry) {
  el.textContent = "";
  el.append(h("div", { class: "empty" }, h("p", {}, text), h("button", { class: "ghost", onclick: retry }, "Try again")));
}
function loadingEl() {
  return h("div", { class: "empty" }, h("p", {}, "Loading..."));
}
const nickMap = new Map();
const clearMap = new Map();
let socialAt = 0;
let socialP = null;
function loadSocial(force) {
  if (!sbUser) return Promise.resolve();
  if (!socialP) {
    const nk = cacheRead("nicks:" + sbUser.id);
    if (nk && nk.v) Object.keys(nk.v).forEach(k => nickMap.set(k, nk.v[k]));
    const ck = cacheRead("clears:" + sbUser.id);
    if (ck && ck.v) Object.keys(ck.v).forEach(k => clearMap.set(k, ck.v[k]));
  }
  if (socialP && !(force && Date.now() - socialAt > 15000)) return socialP;
  socialAt = Date.now();
  socialP = Promise.all([
    sb.from("nicknames").select("target_id, nickname").eq("owner_id", sbUser.id),
    sb.from("chat_clears").select("other_id, cleared_at").eq("user_id", sbUser.id)
  ]).then(([a, b]) => {
    if (!a.error) { nickMap.clear(); (a.data || []).forEach(r => nickMap.set(r.target_id, r.nickname)); cacheWrite("nicks:" + sbUser.id, Object.fromEntries(nickMap)); }
    if (!b.error) { clearMap.clear(); (b.data || []).forEach(r => clearMap.set(r.other_id, Date.parse(r.cleared_at))); cacheWrite("clears:" + sbUser.id, Object.fromEntries(clearMap)); }
  }).catch(() => {});
  return socialP;
}
const nickOf = id => nickMap.get(id) || "";
const clearedAt = id => clearMap.get(id) || 0;
const visibleMsg = (m, other) => Date.parse(m.created_at) > clearedAt(other);
async function dmStatus(otherId) {
  const me = sbUser.id;
  const [a, b, c, d] = await Promise.all([
    sb.from("follows").select("followee_id").eq("follower_id", me).eq("followee_id", otherId),
    sb.from("follows").select("follower_id").eq("follower_id", otherId).eq("followee_id", me),
    sb.from("blocks").select("blocked_id").eq("blocker_id", me).eq("blocked_id", otherId),
    sb.from("blocks").select("blocker_id").eq("blocker_id", otherId).eq("blocked_id", me)
  ]);
  if (a.error || b.error || c.error || d.error) return null;
  return { iFollow: !!(a.data && a.data.length), theyFollow: !!(b.data && b.data.length), iBlocked: !!(c.data && c.data.length), blockedMe: !!(d.data && d.data.length) };
}
const dmLockText = st => !st ? "" : st.iBlocked ? "You blocked this account" : st.blockedMe ? "You can't message this account" : !(st.iFollow && st.theyFollow) ? "You can only message people you follow each other with" : "";
// true when the password is in a known leak: only the first 5 characters of its SHA-1 are sent, and a failed check never blocks anybody
async function pwnedPassword(pw) {
  try {
    const raw = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(pw));
    const hex = Array.from(new Uint8Array(raw), b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    const r = await fetch("https://api.pwnedpasswords.com/range/" + hex.slice(0, 5), { headers: { "Add-Padding": "true" }, signal: AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined });
    if (!r.ok) return false;
    const tail = hex.slice(5);
    return (await r.text()).split("\n").some(l => { const [s, n] = l.trim().split(":"); return s === tail && Number(n) > 0; });
  } catch (e) { return false; }
}
const PWNED_MSG = "That password was found in a data leak. Pick another one";
// "at 9:45 AM" or "tomorrow at 9:45 AM", in the time zone of the phone
function untilText(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "a bit later";
  const now = new Date(), tm = new Date(now.getTime() + 864e5);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return "at " + time;
  if (d.toDateString() === tm.toDateString()) return "tomorrow at " + time;
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) + " at " + time;
}
const lockedMsg = until => "Too many tries. Try again " + untilText(until);
function authMsg(error) {
  const c = String((error && error.code) || ""), m = String((error && error.message) || "");
  if (c === "user_already_exists" || c === "email_exists" || /already (been )?registered/i.test(m)) return "An account with this email already exists. Sign in instead";
  if (c === "weak_password" || (/password/i.test(m) && /(short|least|weak|characters)/i.test(m))) return "That password is too weak. Use 8 or more characters";
  if (c === "same_password" || /different from the old/i.test(m)) return "Pick a password you are not using now";
  if (c === "validation_failed" || c === "email_address_invalid" || (/email/i.test(m) && /(invalid|valid)/i.test(m))) return "That email does not look right. Check for typos";
  if (c === "over_email_send_rate_limit" || c === "over_request_rate_limit" || (error && error.status === 429)) return "Too many tries. Wait a few minutes and try again";
  if (c === "signup_disabled") return "New accounts are closed for now";
  if (/network|fetch/i.test(m)) return "Could not reach Nook. Check your connection";
  return /^[A-Z][^:]*$/.test(m) && m.length < 120 ? m : "Something went wrong. Try again";
}
function setpwMsg(r) {
  const e = r.body && r.body.error;
  if (e === "wrong_password") return "Current password is wrong" + (r.body.left > 0 ? ". " + r.body.left + (r.body.left === 1 ? " try" : " tries") + " left before a wait" : "");
  if (e === "setpw_failed") return authMsg({ code: r.body.code, message: r.body.message });
  if (e === "no_password") return "Enter your current password";
  if (e === "not_signed_in") return "You are signed out. Sign in again";
  return failText(r, "Could not change the password. Try again");
}
// the signin function hands back a fresh session after the password changed, because the old one stops working
async function takeSession(r) {
  const ss = r.body && r.body.session;
  if (ss) await sb.auth.setSession({ access_token: ss.access_token, refresh_token: ss.refresh_token });
}
function signinMsg(r) {
  const e = r.body && r.body.error;
  if (r.ok) return "";
  if (e === "locked") return lockedMsg(r.body.until);
  if (e === "no_account") return "No account uses this email. Check the spelling or make an account";
  if (e === "wrong_password") return "Wrong password for this email." + (r.body.left > 0 ? " " + r.body.left + (r.body.left === 1 ? " try" : " tries") + " left before a wait." : "") + " You can tap Forgot password";
  if (e === "bad_email") return "That email does not look right. Check for typos";
  if (e === "busy") return "Lots of people are signing in right now. Try again in a minute";
  if (e === "not_confirmed") return "This email is not confirmed yet. Open the link we sent you";
  if (e === "no_email") return "Enter your email";
  if (e === "no_password") return "Enter your password";
  return failText(r, "Could not sign in. Try again");
}
// a plain line for a failed call: no connection, signed out, too many tries, a problem on our side, or the given fallback
function failText(r, fallback) {
  const s = r && r.status;
  if (!s) return "Could not reach Nook. Check your connection and try again";
  if (s === 401) return "Your session ended. Sign in again";
  if (s === 429) return "Too many tries. Wait a few minutes and try again";
  if (s >= 500) return "Nook is having trouble. Try again in a minute";
  const e = r.body && r.body.error;
  return typeof e === "string" && /\s/.test(e) && e.length < 140 ? e : fallback;
}
// any thrown error turned into a line that makes sense to a person
function plainErr(e, fallback) {
  const m = String((e && e.message) || e || "");
  if (/failed to fetch|networkerror|load failed|network request|abort|timed out|timeout/i.test(m)) return "No connection. Check it and try again";
  if (/row-level security|permission denied/i.test(m)) return "That is not allowed right now";
  if (/rate_limited/i.test(m)) return "Too many changes. Wait a minute and try again";
  if (/post_locked/i.test(m)) return "Posting is paused for now";
  if (/need to open nook/i.test(m)) return "They have not opened messages yet";
  if (/message_too_long/i.test(m)) return "That message is too long";
  return fallback || "Something went wrong. Try again";
}
async function callFn(name, body) {
  // a lost connection or a timeout is an answer with status 0, never a thrown error
  try {
    const { data } = await sb.auth.getSession();
    const tok = data && data.session ? data.session.access_token : null;
    const r = await fetch(SB_URL + "/functions/v1/" + name, { method: "POST", headers: { "content-type": "application/json", apikey: SB_KEY, ...(tok ? { authorization: "Bearer " + tok } : {}) }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout ? AbortSignal.timeout(25000) : undefined });
    let j = null;
    try { j = await r.json(); } catch (e) {}
    return { ok: r.ok, status: r.status, body: j || {} };
  } catch (e) { return { ok: false, status: 0, body: { error: "network" } }; }
}
function refreshBadge() {
  if (!sbUser) return;
  sb.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", sbUser.id).neq("kind", "message").is("read_at", null).then(a => {
    unreadN = a.count || 0;
    paintBell();
  });
  sb.from("messages").select("sender_id").eq("recipient_id", sbUser.id).is("read_at", null).limit(500).then(({ data }) => {
    const n = new Set((data || []).map(x => x.sender_id)).size;
    if (n !== unreadPeople) { unreadPeople = n; buildNav(null); }
  });
}
function paintBell() {
  document.querySelectorAll(".bellb").forEach(el => el.classList.toggle("unread", unreadN > 0));
}
function bellBtn() {
  return h("button", { class: "ib bellb" + (unreadN ? " unread" : ""), "aria-label": "Notifications", onclick: () => { askNotifPerm(); go({ r: "notifs" }); } }, ic("bell", 24));
}
function askNotifPerm() {
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
}
function alertMe(title, body, onTap) {
  if (document.hidden && "Notification" in window && Notification.permission === "granted") {
    const n = new Notification(title, { body, icon: "icon-192.png", tag: "nook" });
    n.onclick = () => { window.focus(); n.close(); if (onTap) onTap(); };
  } else toast(title + ": " + body);
}
function markRead(ids) {
  if (!ids.length || !sbUser) return;
  sb.from("messages").update({ read_at: new Date().toISOString() }).in("id", ids).eq("recipient_id", sbUser.id).then(() => refreshBadge());
}
async function dmThread(otherId) {
  await loadSocial(true);
  const { data, error } = await sb.from("messages").select("id, sender_id, recipient_id, body, media, created_at, read_at")
    .or("and(sender_id.eq." + sbUser.id + ",recipient_id.eq." + otherId + "),and(sender_id.eq." + otherId + ",recipient_id.eq." + sbUser.id + ")")
    .order("created_at", { ascending: true }).limit(300);
  if (error) throw error;
  return (data || []).filter(m => visibleMsg(m, otherId));
}
async function warmInbox() {
  const convos = await dmInbox();
  cacheWrite("inbox:" + sbUser.id, convos);
  convos.forEach(c => { if (c.avatar && /^https?:/.test(c.avatar)) new Image().src = c.avatar; });
}
async function dmInbox() {
  await loadSocial(true);
  const { data, error } = await sb.from("messages").select("id, sender_id, recipient_id, body, media, created_at, read_at")
    .or("sender_id.eq." + sbUser.id + ",recipient_id.eq." + sbUser.id).order("created_at", { ascending: false }).limit(500);
  // a failed load keeps what is on the screen and in the cache
  if (error) throw error;
  const convos = new Map();
  (data || []).forEach(m => {
    const other = m.sender_id === sbUser.id ? m.recipient_id : m.sender_id;
    if (!visibleMsg(m, other)) return;
    if (!convos.has(other)) convos.set(other, { other, last: m, unread: 0 });
    if (m.recipient_id === sbUser.id && !m.read_at) convos.get(other).unread++;
  });
  const empties = keptList().filter(id => !convos.has(id));
  await acctsFor([...convos.keys(), ...empties]);
  const out = [...convos.values()].map(cv => {
    const a = acctCache.get(cv.other) || { name: "user", avatar: null };
    return { other: cv.other, name: a.name, avatar: a.avatar || null, unread: cv.unread, last: { id: cv.last.id, body: cv.last.body, media: cv.last.media, created_at: cv.last.created_at, sender_id: cv.last.sender_id } };
  });
  empties.forEach(id => { const a = acctCache.get(id) || { name: "user", avatar: null }; out.push({ other: id, name: a.name, avatar: a.avatar || null, unread: 0, last: null }); });
  return out;
}
const E2E_ALG = { name: "ECDH", namedCurve: "P-256" };
const e2eMine = new Map();
const e2eShared = new Map();
const e2eEnc = new Map();
const toB64 = u8 => { let s = ""; u8.forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
function keyDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("nook-keys", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("k");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(new Error("This phone cannot open its key storage. Check private mode or site data"));
  });
}
function readLocalKeys(db, id) {
  return new Promise((res, rej) => {
    const q = db.transaction("k").objectStore("k").get(id);
    q.onsuccess = () => res(q.result && q.result.priv && q.result.pub ? q.result : null);
    q.onerror = () => rej(q.error);
  });
}
function saveLocalKeys(db, id, rec) {
  return new Promise((res, rej) => {
    const tx = db.transaction("k", "readwrite");
    tx.objectStore("k").put(rec, id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
// a fresh chat key; it can be exported, which is what lets a recovery password carry it to another phone
async function makeKeyPair() {
  const kp = await crypto.subtle.generateKey(E2E_ALG, true, ["deriveKey"]);
  return { priv: kp.privateKey, pub: toB64(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey))) };
}
let e2eLocked = false, restoreAsked = false;
const LOCKED_MSG = "Open your messages first (Settings, Message key backup)";
// the choices only come up while the person is in the chats, never on the home screen
function lockKeys() {
  e2eLocked = true;
  if (["chat", "dm"].includes(stack[stack.length - 1].r)) promptUnlock();
}
function promptUnlock() {
  if (!e2eLocked || restoreAsked) return;
  restoreAsked = true;
  setTimeout(unlockModal, 400);
}
async function loadMyKeys(id) {
  const db = await keyDb();
  const got = await readLocalKeys(db, id);
  if (got) { e2eLocked = false; return got; }
  // a new phone must never make a new key when the account already has one: that would lock the old messages for good
  const [me, bk] = await Promise.all([sb.from("accounts").select("public_key").eq("id", id).maybeSingle(), sb.from("key_backups").select("user_id").eq("user_id", id).neq("mode", "off").limit(1)]);
  if (me.error || bk.error) throw new Error("Could not check your message key. Try again");
  if ((me.data && me.data.public_key) || (bk.data && bk.data.length)) {
    lockKeys();
    throw new Error(LOCKED_MSG);
  }
  const rec = await makeKeyPair();
  await saveLocalKeys(db, id, rec);
  return rec;
}
function myKeys() {
  const id = sbUser.id;
  if (!e2eMine.has(id)) { const p = loadMyKeys(id); e2eMine.set(id, p); p.catch(() => e2eMine.delete(id)); }
  return e2eMine.get(id);
}
const KDF_ITERS = 600000;
async function recoveryKey(pw, salt, iters) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iters, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
// the key is sealed on this phone with the recovery password: the server only ever holds the sealed copy
async function sealKeyBackup(priv, pub, pw, mode) {
  const jwk = await crypto.subtle.exportKey("jwk", priv);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await recoveryKey(pw, salt, KDF_ITERS);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(jwk)));
  return { user_id: sbUser.id, mode: mode || "recovery", salt: toB64(salt), iv: toB64(iv), ct: toB64(new Uint8Array(ct)), iters: KDF_ITERS, pub, updated_at: new Date().toISOString() };
}
async function openKeyBackup(row, pw) {
  const key = await recoveryKey(pw, fromB64(row.salt), row.iters);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(row.iv) }, key, fromB64(row.ct));
  const jwk = JSON.parse(new TextDecoder().decode(plain));
  const priv = await crypto.subtle.importKey("jwk", jwk, E2E_ALG, true, ["deriveKey"]);
  const pubKey = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, ext: true }, E2E_ALG, true, []);
  const pub = toB64(new Uint8Array(await crypto.subtle.exportKey("raw", pubKey)));
  if (pub !== row.pub) throw new Error("mismatch");
  return { priv, pub };
}
const peekKeys = async () => readLocalKeys(await keyDb(), sbUser.id);
// the chat key is saved locked with the login password, so signing in on a new phone opens the messages by itself.
// pw is the plain login password, only ever used on this phone to lock or unlock; reseal locks it again (after a password change), enable turns it back on after it was turned off
async function loginBackup(pw, opt) {
  opt = opt || {};
  if (!sbUser || !crypto.subtle || !pw) return "fail";
  try {
    const [rowsQ, mine, meQ] = await Promise.all([sb.from("key_backups").select("mode, pub, salt, iv, ct, iters").eq("user_id", sbUser.id), peekKeys(), sb.from("accounts").select("public_key").eq("id", sbUser.id).maybeSingle()]);
    if (rowsQ.error) return "fail";
    const rows = rowsQ.data || [];
    const me = meQ.data;
    const login = rows.find(r => r.mode === "login");
    const optedOut = rows.some(r => r.mode === "off");
    if (!mine) {
      if (login && me && me.public_key === login.pub) {
        try { const rec = await openKeyBackup(login, pw); await saveLocalKeys(await keyDb(), sbUser.id, rec); resetKeyCaches(); return "restored"; } catch (e) { return "locked"; }
      }
      if (me && me.public_key) return "locked";
      if (rows.some(r => r.mode !== "off")) return "locked";
      // an account that has no key yet: this phone makes it and saves the locked copy
      if (optedOut && !opt.enable) return "off";
      resetKeyCaches();
      const rec = await myKeys();
      const up = await sb.from("key_backups").upsert(await sealKeyBackup(rec.priv, rec.pub, pw, "login"), { onConflict: "user_id,mode" });
      return up.error ? "fail" : "saved";
    }
    if (me && me.public_key && me.public_key !== mine.pub) return "locked";
    if (optedOut && !opt.enable) return "off";
    if (!mine.priv.extractable) return "legacy";
    if (login && login.pub === mine.pub && !opt.reseal) {
      // already saved: only locked again when the saved copy no longer opens with this password
      try { await openKeyBackup(login, pw); return "saved"; } catch (e) {}
    }
    const up = await sb.from("key_backups").upsert(await sealKeyBackup(mine.priv, mine.pub, pw, "login"), { onConflict: "user_id,mode" });
    if (!up.error && opt.enable) await sb.from("key_backups").delete().eq("user_id", sbUser.id).eq("mode", "off");
    return up.error ? "fail" : "saved";
  } catch (e) { return "fail"; }
}
const resetKeyCaches = () => { e2eMine.delete(sbUser.id); e2eShared.clear(); e2eEnc.clear(); };
// danger actions ask for the account email and the login password first
function confirmLogin(title, warn, label, fn) {
  const em = h("input", { class: "in", type: "email", placeholder: "Email", autocomplete: "off", autocapitalize: "off", "aria-label": "Email" });
  const pw = pwField("Password");
  const msg = h("p", { class: "note", role: "alert" });
  const say = t => { msg.textContent = t; if (t) toast(t); };
  const go1 = h("button", { class: "pri", style: "background:var(--danger)" }, label);
  const m = modal({
    title: "",
    action: label,
    body: [h("div", { class: "auth", style: "padding-top:max(4vh,16px)" }, h("h1", {}, title), h("p", { class: "sub" }, warn), em, pw.wrap, msg, go1)],
    onAction: close => run(close)
  });
  m.act.hidden = true;
  go1.addEventListener("click", () => run(m.close));
  pw.input.addEventListener("keydown", e => { if (e.key === "Enter") go1.click(); });
  const run = async close => {
    msg.textContent = "";
    if (!em.value.trim() || !pw.input.value) { say("Type your email and password"); return; }
    if (em.value.trim().toLowerCase() !== ((sbUser && sbUser.email) || "").toLowerCase()) { say("That is not the email of this account"); return; }
    go1.disabled = true;
    try {
      const v = await verifyPassword(pw.input.value);
      if (!v.ok) { say(v.msg.replace("Current password", "Password")); return; }
      go1.textContent = "Please wait";
      // the screen stays until the work is done; a returned text is the reason it failed
      const err = await fn();
      if (typeof err === "string" && err) { say(err); return; }
      close();
    } catch (e) { say("Something went wrong. Try again"); } finally { go1.disabled = false; go1.textContent = label; }
  };
}
function pwField(ph, pm) {
  const input = h("input", { class: "in", type: "password", placeholder: ph, autocomplete: pm || "off", "aria-label": ph, style: "padding-right:60px", ...(pm ? { "data-pm": "1" } : {}) });
  const eye = h("button", { type: "button", class: "tbtn", "aria-label": "Show password", style: "position:absolute;right:14px;top:50%;transform:translateY(-50%);padding:6px 0;color:var(--muted);font-size:var(--fs-md);font-weight:600", onclick: () => { const s = input.type === "password"; input.type = s ? "text" : "password"; eye.textContent = s ? "Hide" : "Show"; eye.setAttribute("aria-label", s ? "Hide password" : "Show password"); } }, "Show");
  return { input, wrap: h("div", { class: "fld", style: "position:relative" }, input, eye) };
}
const LINK_MIN = 10;
// twenty digits made from the public half of the temporary key: both phones show them, so a swapped request is seen
async function linkCode(pub) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", fromB64(pub)));
  let n = 0n;
  for (let i = 0; i < 9; i++) n = (n << 8n) | BigInt(d[i]);
  return String(n % 100000000000000000000n).padStart(20, "0").replace(/(\d{4})(?=\d)/g, "$1 ");
}
const codeBox = t => h("div", { style: "font-size:var(--fs-2xl);font-weight:700;letter-spacing:.04em;text-align:center;padding:14px 0;font-variant-numeric:tabular-nums" }, t);
// a new key reaches the server first and this phone second, so a failed call never leaves the old key destroyed
async function adoptNewKey(rec) {
  const u = await sb.from("accounts").update({ public_key: rec.pub }).eq("id", sbUser.id);
  if (u.error) throw u.error;
  await saveLocalKeys(await keyDb(), sbUser.id, rec);
}
// saved copies of an old key must not outlive it, or a later unlock would bring the old key back
async function dropOldBackups(modes) {
  for (let i = 0; i < 3; i++) {
    let q = sb.from("key_backups").delete().eq("user_id", sbUser.id);
    q = modes ? q.in("mode", modes) : q.neq("mode", "off");
    const { error } = await q;
    if (!error) return;
  }
  throw new Error("old backup");
}
async function makeNewKey() {
  const rec = await makeKeyPair();
  await adoptNewKey(rec);
  await dropOldBackups();
  await sb.from("key_links").delete().eq("user_id", sbUser.id);
  return rec;
}
async function unlockModal() {
  if (!sbUser) return;
  const { data: rows, error: ke } = await sb.from("key_backups").select("mode").eq("user_id", sbUser.id);
  if (ke) { toast("Could not load your backup. Check your connection and try again"); return; }
  const has = k => (rows || []).some(r => r.mode === k);
  const items = [{ icon: "userswap", label: "Approve on my other phone", fn: waitForApprovalModal }];
  if (has("login")) items.push({ icon: "lock", label: "Use my login password", fn: () => restoreKeysModal("login") });
  if (has("recovery")) items.push({ icon: "pass", label: "Use my recovery password", fn: () => restoreKeysModal("recovery") });
  items.push({ icon: "trash", label: "Start fresh", danger: true, fn: () => confirmSheet("Start fresh? Older messages will not open anymore, here or for the other person.", "Start fresh", async () => {
    try { await makeNewKey(); toast("New message key made"); setTimeout(() => location.reload(), 500); } catch (e) { toast("Could not do that. Try again"); }
  }) });
  items.push({ label: "Cancel", cancel: true });
  sheet(items, "Open your messages");
}
async function waitForApprovalModal() {
  if (!sbUser) return;
  let stop = false, linkId = null;
  const msg = h("p", { class: "note", role: "alert" });
  const box = codeBox("...");
  const m = modal({
    title: "Approve on your other phone",
    action: "Done",
    body: [h("p", { class: "note" }, "On your other phone tap Approve. The code must match."), box, msg],
    onCancel: close => { stop = true; if (linkId) sb.from("key_links").delete().eq("id", linkId).then(() => {}); close(unlockModal); },
    onAction: close => { stop = true; if (linkId) sb.from("key_links").delete().eq("id", linkId).then(() => {}); close(); }
  });
  m.act.hidden = true;
  try {
    const kp = await crypto.subtle.generateKey(E2E_ALG, false, ["deriveKey"]);
    const reqPub = toB64(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)));
    await sb.from("key_links").delete().eq("user_id", sbUser.id);
    const ins = await sb.from("key_links").insert({ user_id: sbUser.id, req_pub: reqPub }).select("id").single();
    if (ins.error) throw ins.error;
    linkId = ins.data.id;
    box.textContent = await linkCode(reqPub);
    const until = Date.now() + LINK_MIN * 60000;
    while (!stop && Date.now() < until) {
      await new Promise(r => setTimeout(r, 2000));
      if (stop) return;
      const { data: row } = await sb.from("key_links").select("status, sender_pub, iv, ct").eq("id", linkId).maybeSingle();
      if (!row || row.status !== "approved") continue;
      msg.textContent = "Opening...";
      const peer = await crypto.subtle.importKey("raw", fromB64(row.sender_pub), E2E_ALG, false, []);
      const key = await crypto.subtle.deriveKey({ name: "ECDH", public: peer }, kp.privateKey, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
      const jwk = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(row.iv) }, key, fromB64(row.ct))));
      const priv = await crypto.subtle.importKey("jwk", jwk, E2E_ALG, true, ["deriveKey"]);
      const pubKey = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, ext: true }, E2E_ALG, true, []);
      const pub = toB64(new Uint8Array(await crypto.subtle.exportKey("raw", pubKey)));
      const { data: me } = await sb.from("accounts").select("public_key").eq("id", sbUser.id).maybeSingle();
      if (!me || me.public_key !== pub) { msg.textContent = "That key does not match this account. Try again"; stop = true; return; }
      await saveLocalKeys(await keyDb(), sbUser.id, { priv, pub });
      await sb.from("key_links").delete().eq("id", linkId);
      e2eLocked = false;
      stop = true;
      m.close();
      toast("Messages opened");
      setTimeout(() => location.reload(), 500);
      return;
    }
    if (!stop) msg.textContent = "Nobody answered. Close this and try again";
  } catch (e) { msg.textContent = "Something went wrong. Close this and try again"; }
}
let linkTimer = 0;
const linkShown = new Set();
async function checkLinks() {
  if (document.visibilityState !== "visible" || !sbUser || e2eLocked) return;
  try {
    const since = new Date(Date.now() - LINK_MIN * 60000).toISOString();
    const { data } = await sb.from("key_links").select("id, req_pub").eq("status", "pending").gt("created_at", since).order("created_at", { ascending: false }).limit(1);
    if (data && data[0] && !linkShown.has(data[0].id)) { linkShown.add(data[0].id); approveLinkModal(data[0]); }
  } catch (e) {}
}
function watchLinks() {
  if (linkTimer) return;
  linkTimer = setInterval(checkLinks, 8000);
  document.addEventListener("visibilitychange", checkLinks);
  checkLinks();
}
async function approveLinkModal(req) {
  const code = await linkCode(req.req_pub);
  const k0 = await peekKeys().catch(() => null);
  const legacy = !!k0 && !k0.priv.extractable;
  const msg = h("p", { class: "note", role: "alert" });
  const deny = () => sb.from("key_links").delete().eq("id", req.id).then(() => {});
  const m = modal({
    title: "New phone",
    action: "Approve",
    body: [h("p", { class: "note" }, "A new phone wants your messages. Approve only if the code matches."), codeBox(code), legacy ? h("p", { class: "note", style: "color:var(--danger)" }, "Makes a new key. Older messages stop opening.") : null, msg],
    onCancel: close => { deny(); close(); },
    onAction: async close => {
      msg.textContent = "";
      m.act.disabled = true;
      try {
        let rec = await myKeys();
        if (!rec.priv.extractable) {
          rec = await makeKeyPair();
          await adoptNewKey(rec);
          await dropOldBackups();
          resetKeyCaches();
        }
        const eph = await crypto.subtle.generateKey(E2E_ALG, false, ["deriveKey"]);
        const peer = await crypto.subtle.importKey("raw", fromB64(req.req_pub), E2E_ALG, false, []);
        const key = await crypto.subtle.deriveKey({ name: "ECDH", public: peer }, eph.privateKey, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const jwk = await crypto.subtle.exportKey("jwk", rec.priv);
        const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(jwk)));
        const up = await sb.from("key_links").update({ status: "approved", sender_pub: toB64(new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey))), iv: toB64(iv), ct: toB64(new Uint8Array(ct)) }).eq("id", req.id);
        if (up.error) throw up.error;
        close();
        toast("Approved");
      } catch (e) { msg.textContent = "Something went wrong. Try again"; } finally { m.act.disabled = false; }
    }
  });
}
// turn the login password copy back on: the password is checked first
async function loginBackupModal() {
  const k0 = await peekKeys().catch(() => null);
  const legacy = !!k0 && !k0.priv.extractable;
  const pw = pwField("Your login password");
  const msg = h("p", { class: "note", role: "alert" });
  const m = modal({
    title: "Save my key",
    action: "Save",
    body: [h("p", { class: "note" }, "A new phone opens your messages when you sign in. Less private than a recovery password."), legacy ? h("p", { class: "note", style: "color:var(--danger)" }, "Makes a new key. Older messages stop opening.") : null, pw.wrap, msg],
    onAction: async close => {
      msg.textContent = "";
      if (!pw.input.value) { msg.textContent = "Type your login password"; return; }
      m.act.disabled = true;
      try {
        const chk = await callFn("signin", { action: "check", password: pw.input.value }).catch(() => null);
        if (!chk) { msg.textContent = "Could not reach Nook. Check your connection"; return; }
        if (!chk.ok) { msg.textContent = signinMsg(chk); return; }
        if (legacy) { await makeNewKey(); resetKeyCaches(); }
        const r = await loginBackup(pw.input.value, { enable: true, reseal: true });
        if (r !== "saved") { msg.textContent = "Could not save it. Try again"; return; }
        close();
        toast("Saved with your login password");
        if (legacy) setTimeout(() => location.reload(), 400); else render();
      } catch (e) { msg.textContent = "Something went wrong. Try again"; } finally { m.act.disabled = false; }
    }
  });
}
async function restoreKeysModal(mode) {
  if (!sbUser) return;
  const login = mode === "login";
  const pw = pwField(login ? "Login password" : "Recovery password");
  const msg = h("p", { class: "note", role: "alert" });
  const m = modal({
    title: login ? "Login password" : "Recovery password",
    action: "Unlock",
    body: [h("p", { class: "note" }, login ? "Type your login password." : "Type your recovery password."), pw.wrap, msg],
    onAction: async close => {
      msg.textContent = "";
      if (!pw.input.value) { msg.textContent = "Type the password"; return; }
      m.act.disabled = true;
      try {
        const { data: row, error } = await sb.from("key_backups").select("salt, iv, ct, iters, pub").eq("user_id", sbUser.id).eq("mode", login ? "login" : "recovery").maybeSingle();
        if (error || !row) { msg.textContent = "Could not load the saved key. Try again"; return; }
        let rec;
        try { rec = await openKeyBackup(row, pw.input.value); } catch (e) { msg.textContent = "That is not the right password"; return; }
        // a saved key that is not the key of the account is an old one: it must never replace the account's key
        const { data: me, error: me_err } = await sb.from("accounts").select("public_key").eq("id", sbUser.id).maybeSingle();
        if (me_err) { msg.textContent = "Could not reach Nook. Check your connection and try again"; return; }
        if (me && me.public_key && me.public_key !== rec.pub) { msg.textContent = "That saved key is older than the one on your account. Use another way"; return; }
        await saveLocalKeys(await keyDb(), sbUser.id, rec);
        if (!me || !me.public_key) await sb.from("accounts").update({ public_key: rec.pub }).eq("id", sbUser.id);
        e2eLocked = false;
        close();
        toast("Messages unlocked");
        setTimeout(() => location.reload(), 500);
      } finally { m.act.disabled = false; }
    }
  });
}
async function backupSetupModal(changing) {
  let cur;
  try { cur = await myKeys(); } catch (e) { toast(e && e.message === LOCKED_MSG ? LOCKED_MSG : plainErr(e, "Your message key could not be opened")); return; }
  const legacy = !cur.priv.extractable;
  const p1 = pwField("Recovery password"), p2 = pwField("Type it again");
  const msg = h("p", { class: "note", role: "alert" });
  const m = modal({
    title: changing ? "New recovery password" : "Message key backup",
    action: "Save",
    body: [
      h("p", { class: "note" }, "A password only you know. Nook never sees it. Write it down, nobody can recover it."),
      legacy ? h("p", { class: "note", style: "color:var(--danger)" }, "Makes a new key. Older messages stop opening.") : null,
      p1.wrap, p2.wrap, msg],
    onAction: async close => {
      msg.textContent = "";
      const a = p1.input.value;
      if (a.length < 10) { msg.textContent = "Use at least 10 characters. Three random words work well"; return; }
      if (a !== p2.input.value) { msg.textContent = "The two passwords do not match"; return; }
      m.act.disabled = true;
      try {
        const rec = legacy ? await makeKeyPair() : cur;
        const row = await sealKeyBackup(rec.priv, rec.pub, a, "recovery");
        // the sealed copy is saved first, so a failure can never leave a changed key without a backup
        const up = await sb.from("key_backups").upsert(row, { onConflict: "user_id,mode" });
        if (up.error) { msg.textContent = "Could not save the backup. Try again"; return; }
        if (legacy) {
          await adoptNewKey(rec);
          // a copy locked with the login password belongs to the old key now
          await dropOldBackups(["login"]);
          resetKeyCaches();
        }
        close();
        toast(changing ? "Recovery password changed" : "Backup is on");
        setTimeout(() => { if (legacy) location.reload(); else render(); }, legacy ? 500 : 0);
      } catch (e) { msg.textContent = "Something went wrong. Try again"; } finally { m.act.disabled = false; }
    }
  });
}
async function ensureE2E() {
  if (!sbUser || !crypto.subtle) return;
  const k = await myKeys();
  const { data, error: ae } = await sb.from("accounts").select("public_key").eq("id", sbUser.id).maybeSingle();
  // a failed answer is not "no key": this phone never replaces the account key on a guess
  if (ae) throw new Error("network");
  if (data && data.public_key && data.public_key !== k.pub) {
    // another phone holds the key of this account now: this phone must not overwrite it, it asks for it
    const stale = Promise.reject(new Error(LOCKED_MSG));
    stale.catch(() => {});
    e2eMine.set(sbUser.id, stale);
    lockKeys();
    throw new Error(LOCKED_MSG);
  }
  if (!data || !data.public_key) {
    const { error } = await sb.from("accounts").update({ public_key: k.pub }).eq("id", sbUser.id);
    if (error) throw error;
  }
  watchLinks();
  // asks the browser not to drop the key by itself when the phone runs low on space (it cannot stop a person clearing the data)
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {}
}
function keyChangedNotice(otherId) {
  const a = acctCache.get(otherId) || {};
  const who = nickOf(otherId) || a.name || "This person";
  sheet([{ label: "OK", cancel: true }], who + " has a new security key. That happens with a new phone or a reset. If you did not expect it, be careful what you send.");
}
function sharedKey(otherId) {
  if (!e2eShared.has(otherId)) {
    const p = (async () => {
      const mine = await myKeys();
      const { data } = await sb.from("accounts").select("public_key").eq("id", otherId).maybeSingle();
      if (!data || !data.public_key) throw new Error("they need to open nook once first");
      // the first key seen from a person is remembered; a different one later is shown, never silent
      const pinName = "nook-pin:" + sbUser.id + ":" + otherId;
      let pinned = null;
      try { pinned = localStorage.getItem(pinName); } catch (e) {}
      try { localStorage.setItem(pinName, data.public_key); } catch (e) {}
      if (pinned && pinned !== data.public_key) setTimeout(() => keyChangedNotice(otherId), 600);
      const peer = await crypto.subtle.importKey("raw", fromB64(data.public_key), E2E_ALG, false, []);
      return crypto.subtle.deriveKey({ name: "ECDH", public: peer }, mine.priv, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    })();
    e2eShared.set(otherId, p);
    p.catch(() => e2eShared.delete(otherId));
  }
  return e2eShared.get(otherId);
}
async function sealText(otherId, text) {
  const key = await sharedKey(otherId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
  return "e2e1:" + toB64(iv) + "." + toB64(new Uint8Array(ct));
}
const ZMARK = "\u2063Z\u2063";
const ZPOST = "\u2063P\u2063";
// the mark and the post card only count when they come from the owner's account, so nobody else can pose as Zenith
const OWNER_ID = "c8bd0469-c5e1-4741-8ee5-2baf3bc02221";
// a shared post travels as a reference (its id): the other phone reads the post itself, so nobody can write words in someone else's name
const RPOST = "\u2063R\u2063";
const zUn = t => typeof t === "string" ? (t.startsWith(ZMARK) ? t.slice(ZMARK.length) : t.startsWith(ZPOST) || t.startsWith(RPOST) ? "a post" : t) : t;
function rPostOf(t) {
  if (typeof t !== "string" || !t.startsWith(RPOST)) return null;
  try { const j = JSON.parse(t.slice(RPOST.length)); return j && typeof j.id === "string" && /^[0-9a-f-]{36}$/i.test(j.id) ? { id: j.id, u: typeof j.u === "string" && /^[0-9a-f-]{36}$/i.test(j.u) ? j.u : null } : null; } catch (e) { return null; }
}
// what was already fetched is kept, so a card shows at once the second time and even the first photo is ready before the chat opens
const rpCache = new Map(), rpData = new Map();
const preloadImg = src => new Promise(res => { const i = new Image(); i.onload = i.onerror = () => res(); i.src = view(src); });
function loadRPost(id, hint) {
  if (rpData.has(id)) return Promise.resolve(rpData.get(id));
  if (!rpCache.has(id)) {
    const p = (async () => {
      // the post and the author are asked for at the same time when the author is known
      const [{ data, error }, early] = await Promise.all([
        sb.from("posts").select("id, user_id, body, media_url, created_at").eq("id", id).maybeSingle(),
        hint ? cachedAccounts([hint]).catch(() => null) : null
      ]);
      if (error) throw error;
      if (!data) return null;
      const m = early && early.get(data.user_id) ? early : await cachedAccounts([data.user_id]);
      const a = m.get(data.user_id) || {};
      const d = { text: String(data.body || ""), t: Date.parse(data.created_at), imgs: parseMedia(data.media_url).slice(0, 4), name: a.display_name || a.username || "user", handle: a.username || "user", avatar: a.avatar || null };
      rpData.set(id, d);
      return d;
    })();
    rpCache.set(id, p);
    p.catch(() => rpCache.delete(id));
  }
  return rpCache.get(id);
}
// a gif plays by itself while it is on the screen and is let go when it leaves, so old phones are not kept busy by animations nobody sees
const isGifSrc = s => /^data:image\/gif/i.test(s) || /\.gif(\?|#|$)/i.test(s);
const GIF_IDLE = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
function autoGif(im, src) {
  if (!isGifSrc(src) || !("IntersectionObserver" in window)) return;
  const real = im.src;
  // the box keeps its shape while the animation is let go, so the chat never jumps
  let ready = false;
  const fix = () => { if (im.src === real && im.naturalWidth) { im.style.aspectRatio = im.naturalWidth + " / " + im.naturalHeight; ready = true; } };
  if (im.complete) fix(); else im.addEventListener("load", fix, { once: true });
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (!im.isConnected) { io.disconnect(); return; }
    if (e.isIntersecting) { if (im.src !== real) im.src = real; } else if (ready && im.src === real) im.src = GIF_IDLE;
  }), { threshold: 0.2 });
  io.observe(im);
}
function fillRCard(box, d, big, all) {
  box.textContent = "";
  if (!d) { box.append(h("div", { class: "zct", style: "color:var(--muted)" }, "This post is not available")); return; }
  box.append(h("div", { class: "zch" }, rAv({ name: d.name, avatar: d.avatar }, big ? 44 : 34), h("div", { class: "nm" }, h("b", {}, d.name), h("span", {}, "@" + d.handle))));
  if (d.text) box.append(h("div", { class: "zct" }, rich(d.text)));
  // in the chat only the first photo shows; the opened post shows them all
  const shown = all ? d.imgs : d.imgs.slice(0, 1);
  if (shown.length) {
    const g = h("div", { class: "zimgs" }, shown.map(s => { const im = mkImg(s); im.loading = "eager"; autoGif(im, s); return im; }));
    if (!all && d.imgs.length > 1) g.append(h("span", { class: "zmore" }, "+" + (d.imgs.length - 1)));
    box.append(g);
  }
  box.append(h("div", { class: "zcd" }, Number.isFinite(d.t) ? new Date(d.t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : ""));
}
// the shared post as a card: only that post, no profile and no replies behind it
function rCard(id, big, hint) {
  const box = h("div", { class: "zcard" + (big ? " big" : "") });
  if (rpData.has(id)) { fillRCard(box, rpData.get(id), big, big); return box; }
  box.append(h("div", { class: "zct", style: "color:var(--muted)" }, "Loading post"));
  loadRPost(id, hint).then(d => fillRCard(box, d, big, big)).catch(() => { box.textContent = ""; box.append(h("div", { class: "zct", style: "color:var(--muted)" }, "Could not load this post")); });
  return box;
}
// opens the real post, with its replies, in the app; a post this phone does not have yet is fetched first and kept for a day
async function openSharedPost(id) {
  let local = S.posts.find(x => x.remote === id);
  if (!local) {
    const cols = "id, user_id, body, media_url, created_at, parent_id";
    const [pq, rq] = await Promise.all([
      sb.from("posts").select(cols).eq("id", id).maybeSingle(),
      sb.from("posts").select(cols).eq("parent_id", id).order("created_at", { ascending: true }).limit(100)
    ]);
    if (pq.error || rq.error) throw new Error("load");
    if (!pq.data) { toast("This post is not available"); return; }
    const rows = [pq.data, ...(rq.data || [])];
    const who = await cachedAccounts([...new Set(rows.map(r => r.user_id))]);
    const have = new Set(S.posts.filter(p => p.remote).map(p => p.remote));
    const now = Date.now();
    const fresh = rows.filter(r => !have.has(r.id)).map(r => {
      const a = who.get(r.user_id) || { username: "user", avatar: null };
      return {
        id: "r" + r.id, remote: r.id, parent: r.id === id ? null : "r" + id,
        text: r.body || "", t: Date.parse(r.created_at), imgs: parseMedia(r.media_url),
        ra: { id: r.user_id, name: a.display_name == null ? a.username : a.display_name, handle: a.username, avatar: a.avatar || null },
        liked: false, reposted: false, saved: false, lc: 0, rpc: 0, rp: r.id === id ? rows.length - 1 : 0, pinned: false, sharedAt: now
      };
    });
    S.posts.push(...fresh);
    persist();
    local = S.posts.find(x => x.remote === id);
  }
  if (!local) { toast("This post is not available"); return; }
  go({ r: "thread", id: local.id });
}
function zPostOf(t) {
  if (typeof t !== "string" || !t.startsWith(ZPOST)) return null;
  try {
    const j = JSON.parse(t.slice(ZPOST.length));
    // his picture only counts when it is a file of this app's own storage
    const a = j && typeof j.a === "string" && j.a.startsWith(SB_URL + "/storage/v1/object/public/media/") && j.a.length < 400 ? j.a : null;
    return j && typeof j.x === "string" ? { x: j.x.slice(0, 600), t: Number(j.t) || Date.now(), a } : null;
  } catch (e) { return null; }
}
// his picture as a small link other people can load; made once per picture
let zPfpChecked = "";
async function zenPfpUrl() {
  if (!S.zen.pfp) return null;
  if (S.zen.pfpUrl && S.zen.pfpUrlAt === S.zen.pfpAt) {
    // the stored file can be gone, so the link is checked once per session before it is shared again
    if (zPfpChecked === S.zen.pfpUrl) return S.zen.pfpUrl;
    try {
      const r = await fetch(S.zen.pfpUrl, { method: "HEAD" });
      if (r.ok) { zPfpChecked = S.zen.pfpUrl; return S.zen.pfpUrl; }
    } catch (e) { return S.zen.pfpUrl; }
  }
  try {
    const urls = await uploadMedia([S.zen.pfp]);
    if (!urls) return null;
    S.zen.pfpUrl = urls[0]; S.zen.pfpUrlAt = S.zen.pfpAt; persist();
    return urls[0];
  } catch (e) { return null; }
}
function zCard(zp, big) {
  const av = zp.a ? (() => { const d = h("div", { class: "av zenav" }); const im = h("img", { alt: "", decoding: "async" }); im.src = zp.a; im.onerror = () => { im.onerror = null; if (S.zen && S.zen.pfp && im.src !== S.zen.pfp) im.src = S.zen.pfp; else { d.textContent = ""; d.innerHTML = ZEN_SVG; } }; d.append(im); d.style.width = d.style.height = (big ? 44 : 34) + "px"; return d; })() : zenAv(big ? 44 : 34);
  return h("div", { class: "zcard" + (big ? " big" : "") }, h("div", { class: "zch" }, av, h("div", { class: "nm" }, h("b", {}, "Zenith"), h("span", {}, "@zenith"))),
    h("div", { class: "zct" }, rich(zp.x)), h("div", { class: "zcd" }, new Date(zp.t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })));
}
function viewZPost(zp) {
  const m = modal({ title: "Post", action: "Close", onAction: c => c(), body: [zCard(zp, true)] });
  m.act.style.visibility = "hidden";
  const cb = m.ov.querySelector(".tbtn");
  if (cb) cb.textContent = "Close";
}
async function openText(otherId, raw) {
  if (!raw || raw.slice(0, 5) !== "e2e1:") return raw || "";
  try {
    const parts = raw.slice(5).split(".");
    const key = await sharedKey(otherId);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(parts[0]) }, key, fromB64(parts[1]));
    return new TextDecoder().decode(pt);
  } catch (e) { return e2eLocked ? "Locked. Unlock your messages in Settings" : "Can't open this one (the chat key changed)"; }
}
function loadEncMedia(md, otherId) {
  if (!e2eEnc.has(md.url)) {
    const p = (async () => {
      const key = await sharedKey(otherId);
      const res = await fetch(md.url);
      if (!res.ok) throw new Error("gone");
      const buf = await res.arrayBuffer();
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(md.iv) }, key, buf);
      return URL.createObjectURL(new Blob([pt], { type: md.type || "application/octet-stream" }));
    })();
    e2eEnc.set(md.url, p);
    p.catch(() => e2eEnc.delete(md.url));
  }
  return e2eEnc.get(md.url);
}
async function openRows(rows, otherId, waitFor) {
  const out = await Promise.all(rows.map(async m => {
    const t = await openText(otherId, m.body);
    const rp = rPostOf(t);
    if (rp || (typeof t === "string" && t.startsWith(RPOST))) return Object.assign({}, m, { text: "" }, rp ? { rpost: rp } : {});
    const fromOwner = m.sender_id === OWNER_ID;
    const marked = typeof t === "string" && t.startsWith(ZMARK), card = typeof t === "string" && t.startsWith(ZPOST);
    if (!fromOwner && (marked || card)) return Object.assign({}, m, { text: t.slice(marked ? ZMARK.length : ZPOST.length) });
    const zp = zPostOf(t);
    return Object.assign({}, m, { text: zp || card ? "" : zUn(t) }, marked ? { ai: true } : {}, zp ? { zpost: zp } : {});
  }));
  // photos are opened before their bubbles show, so no grey box sits on the screen while they load (only the newest ones are waited for when there are many)
  const jobs = [];
  rows.slice(-(waitFor || rows.length)).forEach(m => (m.media || []).forEach(md => { if (md.iv && !/^video\//.test(md.type || "")) jobs.push(loadEncMedia(md, otherId).catch(() => {})); }));
  // shared posts are fetched, and their first photo loaded, before the bubbles show
  out.slice(-(waitFor || out.length)).forEach(m => { if (m.rpost) jobs.push(loadRPost(m.rpost.id, m.rpost.u).then(d => (d && d.imgs[0] ? preloadImg(d.imgs[0]) : null)).catch(() => {})); });
  if (jobs.length) await Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, 6000))]);
  return out;
}
async function sendDm(otherId, text, srcs, dims) {
  // the key of this phone must be known to the other person before a message is sealed with it
  await ensureE2E().catch(() => {});
  const media = [];
  const paths = [];
  const key = srcs.length ? await sharedKey(otherId) : null;
  try {
    for (let i = 0; i < srcs.length; i++) {
      const blob = await (await fetch(srcs[i])).blob();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, await blob.arrayBuffer());
      const path = sbUser.id + "/" + uid() + ".bin";
      const up = await sb.storage.from(DM_BUCKET).upload(path, new Blob([ct]), { contentType: "application/octet-stream", cacheControl: "3600" });
      if (up.error) throw up.error;
      paths.push(path);
      const d = dims[i] || {};
      media.push({ url: sb.storage.from(DM_BUCKET).getPublicUrl(path).data.publicUrl, type: blob.type || "", w: d.w || null, h: d.h || null, iv: toB64(iv), ...(d.post ? { post: true } : {}) });
    }
    const body = text ? await sealText(otherId, text) : "";
    const { data, error } = await sb.from("messages").insert({ sender_id: sbUser.id, recipient_id: otherId, body, media }).select("id, sender_id, recipient_id, body, media, created_at, read_at").single();
    if (error) throw error;
    return data;
  } catch (e) {
    if (paths.length) sb.storage.from(DM_BUCKET).remove(paths).then(() => {}, () => {});
    throw e;
  }
}
function srcDims(src) {
  return new Promise(res => {
    {
      const im = new Image();
      im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => res({});
      im.src = src;
    }
  });
}
function dmMedia(md, otherId, onOpen) {
  const wrap = h("div", { class: "dmw" });
  if (/^video\//.test(md.type || "")) { wrap.append(h("div", { class: "dmgone" }, "Videos are not supported")); return wrap; }
  const el = h("img", { alt: "", decoding: "async", class: "dmm" });
  if (md.w && md.h) el.style.setProperty("--ar", md.w / md.h);
  const gone = () => { wrap.textContent = ""; wrap.append(h("div", { class: "dmgone" }, "Photo not available")); };
  el.addEventListener("error", () => { if (el.getAttribute("src") && !/^(blob|data):/.test(el.getAttribute("src"))) gone(); });
  if (onOpen) el.addEventListener("click", () => onOpen(el));
  if (md.iv) loadEncMedia(md, otherId).then(u => { if (u) el.src = u; }).catch(gone);
  else el.src = md.url;
  wrap.append(el);
  return wrap;
}
function threadPush(otherId, m) {
  const k = "thread:" + sbUser.id + ":" + otherId;
  const hit = cacheRead(k);
  const arr = ((hit && hit.v) || []).filter(x => x.id !== m.id).concat(m).slice(-100);
  cacheWrite(k, arr);
}
function threadDrop(otherId, id) {
  const k = "thread:" + sbUser.id + ":" + otherId;
  const hit = cacheRead(k);
  if (hit) cacheWrite(k, (hit.v || []).filter(x => x.id !== id));
}
// a chat whose last message was deleted stays in the list, empty, until the chat itself is deleted
const keptKey = () => "kept:" + sbUser.id;
function keptList() { const h = cacheRead(keptKey()); return h && Array.isArray(h.v) ? h.v : []; }
function keptAdd(id) { const l = keptList(); if (!l.includes(id)) cacheWrite(keptKey(), l.concat(id)); }
function keptDel(id) { cacheWrite(keptKey(), keptList().filter(x => x !== id)); }
function inboxDrop(otherId, id) {
  const k = "inbox:" + sbUser.id;
  const hit = cacheRead(k);
  if (!hit || !Array.isArray(hit.v)) return;
  const th = cacheRead("thread:" + sbUser.id + ":" + otherId);
  const rest = ((th && th.v) || []).filter(x => x.id !== id);
  const out = [];
  hit.v.forEach(cv => {
    if (cv.other !== otherId || !cv.last || cv.last.id !== id) { out.push(cv); return; }
    if (!rest.length) { out.push(Object.assign({}, cv, { last: null, unread: 0 })); keptAdd(otherId); return; }
    const l = rest[rest.length - 1];
    out.push(Object.assign({}, cv, { last: { id: l.id, body: l.body, media: l.media, created_at: l.created_at, sender_id: l.sender_id } }));
  });
  cacheWrite(k, out);
}
function storagePath(url, bucket) {
  const marker = "/object/public/" + bucket + "/";
  const i = (url || "").indexOf(marker);
  return i > -1 ? decodeURIComponent(url.slice(i + marker.length)) : null;
}
function deleteDm(m, row, otherId) {
  const paths = (m.media || []).map(md => storagePath(md.url, DM_BUCKET)).filter(Boolean);
  foldAway(row);
  threadDrop(otherId, m.id);
  inboxDrop(otherId, m.id);
  sb.from("messages").delete().eq("id", m.id).select("id").then(({ data, error }) => {
    if (error || !data || !data.length) { toast(error ? "Could not delete that message. " + plainErr(error, "Try again") : "Could not delete that message"); render(); return; }
    if (paths.length) sb.storage.from(DM_BUCKET).remove(paths).then(() => {}, () => {});
  });
}
const dmSig = m => String(m.body || "") + "|" + JSON.stringify((m.media || []).map(x => x.url));
async function deleteDmMedia(row, i) {
  const m = row._m;
  if (!m || m.id == null) return false;
  const path = storagePath(((m.media || [])[i] || {}).url, DM_BUCKET);
  const { data, error } = await sb.rpc("remove_dm_media", { p_msg: m.id, p_idx: i });
  if (error) { toast("Could not delete that photo"); return false; }
  if (path) sb.storage.from(DM_BUCKET).remove([path]).then(() => {}, () => {});
  if (data && data.deleted) {
    threadDrop(row._other, m.id);
    inboxDrop(row._other, m.id);
    foldAway(row);
  } else if (data && Array.isArray(data.media)) {
    const next = Object.assign({}, m, { media: data.media });
    row._sig = dmSig(next);
    row.refill(next);
  }
  toast("Photo deleted");
  return true;
}
async function openDmViewer(row, idx) {
  const m = row._m;
  if (!m) return;
  const urls = [], map = [];
  for (let i = 0; i < (m.media || []).length; i++) {
    const md = m.media[i];
    if (/^video\//.test(md.type || "")) continue;
    try { urls.push(md.iv ? await loadEncMedia(md, row._other) : md.url); map.push(i); } catch (e) {}
  }
  const start = map.indexOf(idx);
  if (start < 0 || !urls.length) return;
  const mine = m.sender_id === sbUser.id || row._mine;
  lightbox(urls, start, null, mine && m.id != null ? { del: async n => {
    const k = map[n];
    const ok = await deleteDmMedia(row, k);
    if (ok) { map.splice(n, 1); for (let j = 0; j < map.length; j++) if (map[j] > k) map[j]--; }
    return ok;
  } } : null);
}
function dmRowMenu(row, mine, otherId) {
  const m = row._m;
  if (!m) return;
  const body = m.text !== undefined ? m.text : m.body;
  const items = [];
  if (body) items.push({ icon: "copy", label: "Copy message", fn: () => copy(body) });
  if (mine && m.id != null) items.push({ icon: "trash", label: "Delete message", danger: true, fn: () => confirmSheet("Delete this message?", "Delete", () => deleteDm(m, row, otherId)) });
  if (items.length) sheet(items);
}
function dmBubble(m, mine, otherId) {
  const row = h("div", { class: "mrow" + (mine ? "" : " them") });
  row._other = otherId;
  row._mine = mine;
  const fill = msg => {
    row._m = msg;
    if (msg.id != null) row.dataset.mid = String(msg.id); else delete row.dataset.mid;
    row._sig = dmSig(msg);
    const wasOpen = row.classList.contains("open");
    row.textContent = "";
    const body = msg.text !== undefined ? msg.text : msg.body;
    (msg.media || []).forEach((md, i) => row.append(dmMedia(md, otherId, () => openDmViewer(row, i))));
    if (msg.rpost) { const rc = rCard(msg.rpost.id, false, msg.rpost.u); rc.addEventListener("click", e => { e.stopPropagation(); openSharedPost(msg.rpost.id).catch(() => toast("Could not open that post. Check your connection")); }); row.append(rc); }
    if (msg.zpost) { const zc = zCard(msg.zpost); zc.addEventListener("click", e => { e.stopPropagation(); viewZPost(msg.zpost); }); row.append(zc); }
    const link = firstUrl(body);
    if (link) row.append(linkCard(link, true));
    if (body) row.append(h("div", { class: "bub" }, msg.ai ? h("span", { class: "zin" }, "zenith ") : null, rich(body)));
    row.classList.toggle("zdm", !!msg.ai);
    row.append(h("div", { class: "mmeta" }, h("div", { class: "mmi" }, h("span", {}, new Date(msg.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })))));
    row.classList.toggle("open", wasOpen);
  };
  fill(m);
  row.refill = fill;
  if (m.ai && zOn()) swipeReply(row, () => { if (liveDm && liveDm.fill) liveDm.fill("@zenith "); });
  row.addEventListener("click", () => {
    const was = row.classList.contains("open");
    if (row.parentElement) row.parentElement.querySelectorAll(".mrow.open").forEach(r => r.classList.remove("open"));
    if (!was) row.classList.add("open");
  });
  longPress(row, () => dmRowMenu(row, mine, otherId));
  return row;
}
const typeIn = new Map();
const typeOut = new Map();
function sendTyping(otherId, on) {
  if (!sbUser || !otherId) return;
  let o = typeOut.get(otherId);
  if (!o) {
    o = { ch: sb.channel("tp-" + otherId), ready: false, last: 0, sentOn: false };
    typeOut.set(otherId, o);
    o.ch.subscribe(st => { if (st === "SUBSCRIBED") o.ready = true; });
  }
  if (!o.ready) return;
  const now = Date.now();
  if (on) {
    if (now - o.last < 2000) return;
    o.last = now;
    o.sentOn = true;
  } else {
    if (!o.sentOn) return;
    o.sentOn = false;
    o.last = 0;
  }
  o.ch.send({ type: "broadcast", event: "typing", payload: { from: sbUser.id, on: !!on } });
}
// typing signals travel on a channel anybody can join, so only people this person already chats with are believed
function peerKnown(id) {
  const hit = cacheRead("inbox:" + sbUser.id);
  return !!(hit && Array.isArray(hit.v) && hit.v.some(cv => cv && cv.other === id));
}
function onTyping(from, on) {
  if (!sbUser || !from || from === sbUser.id || typeof from !== "string" || !peerKnown(from)) return;
  clearTimeout(typeIn.get(from));
  if (on === false) {
    // let the dots hang around for a moment, like instagram, instead of cutting off
    if (typeIn.has(from)) typeIn.set(from, setTimeout(() => { typeIn.delete(from); paintTyping(from, false); }, 1600));
    return;
  }
  const had = typeIn.has(from);
  typeIn.set(from, setTimeout(() => { typeIn.delete(from); paintTyping(from, false); }, 4500));
  if (!had) paintTyping(from, true);
}
function paintTyping(from, on) {
  if (liveDm && liveDm.id === from && liveDm.typing) liveDm.typing(on);
  document.querySelectorAll(".lrow[data-uid]").forEach(row => {
    if (row.dataset.uid !== from) return;
    const sub = row.querySelector(".sub");
    if (!sub) return;
    if (on) {
      if (sub.dataset.orig === undefined) sub.dataset.orig = sub.textContent;
      sub.textContent = "typing...";
      sub.classList.add("tp");
    } else if (sub.dataset.orig !== undefined) {
      sub.textContent = sub.dataset.orig;
      delete sub.dataset.orig;
      sub.classList.remove("tp");
    }
  });
}
function dmMenu(cv, inChat) {
  sheet([
    { icon: "edit", label: "Nickname", fn: () => nicknameModal(cv) },
    { icon: "trash", label: "Delete chat", danger: true, fn: () => confirmSheet("Delete this chat for you? The other person keeps theirs.", "Delete chat", () => deleteChat(cv, inChat)) }
  ], nickOf(cv.other) || cv.name);
}
function nicknameModal(cv) {
  const inp = h("input", { class: "in", id: "nk", maxlength: "30", placeholder: cv.name || "Nickname", autocomplete: "off" });
  inp.value = nickOf(cv.other);
  modal({
    title: "Nickname",
    body: [h("div", { class: "fld" }, h("label", { for: "nk" }, "Only you can see this"), inp), h("p", { class: "note" }, "Leave it empty to remove the nickname.")],
    onAction: async close => {
      const v = inp.value.trim().slice(0, 30);
      const q = v
        ? sb.from("nicknames").upsert({ owner_id: sbUser.id, target_id: cv.other, nickname: v })
        : sb.from("nicknames").delete().eq("owner_id", sbUser.id).eq("target_id", cv.other);
      const { error } = await q;
      if (error) { toast("Could not save nickname"); return; }
      if (v) nickMap.set(cv.other, v); else nickMap.delete(cv.other);
      cacheWrite("nicks:" + sbUser.id, Object.fromEntries(nickMap));
      close();
      render();
      toast(v ? "Nickname saved" : "Nickname removed");
    }
  });
}
async function deleteChat(cv, inChat) {
  // only this person's view is cleared: the messages stay for the other person
  const { error } = await sb.rpc("clear_chat", { p_other: cv.other });
  if (error) { toast("Could not delete chat"); return; }
  socialAt = 0;
  await loadSocial(true);
  try { localStorage.removeItem(CACHE_PFX + "thread:" + sbUser.id + ":" + cv.other); } catch (e) {}
  keptDel(cv.other);
  const ik = "inbox:" + sbUser.id;
  const hit = cacheRead(ik);
  if (hit && Array.isArray(hit.v)) cacheWrite(ik, hit.v.filter(x => x.other !== cv.other));
  refreshBadge();
  if (inChat) back(); else render();
  toast("Chat deleted");
}
// the messages and the name of the other person are fetched first, so the chat opens already filled
// opened (decrypted) messages of chats that are about to open, so the chat paints at once instead of showing an empty page first
const dmPre = new Map();
async function openDm(id) {
  const k = "thread:" + sbUser.id + ":" + id;
  try {
    let rows;
    const hit = cacheRead(k);
    if (hit && Array.isArray(hit.v) && Date.now() - hit.t < 30000) rows = hit.v;
    else {
      const [got] = await Promise.all([Promise.race([dmThread(id), new Promise((_, rej) => setTimeout(rej, 2500))]), acctsFor([id])]);
      rows = got.slice(-100);
      cacheWrite(k, rows);
    }
    await acctsFor([id]);
    const opened = await Promise.race([openRows(rows.filter(m => visibleMsg(m, id)), id, 12), new Promise(r => setTimeout(r, 3000))]);
    if (Array.isArray(opened)) { dmPre.set(id, opened); setTimeout(() => dmPre.delete(id), 30000); }
  } catch (e) {}
  go({ r: "dm", id });
}
function dmV(c) {
  if (e2eLocked) promptUnlock();
  let busy = false, locked = "", tEl = null, tRaf = 0;
  const me = sbUser.id;
  const peer = { other: c.id, name: "user" };
  const wn = h("div", { class: "wn" }, h("b", {}, " "), h("span", {}, ""));
  const who = h("div", { class: "who" }, rAv({ name: "?", avatar: null }, 36), wn);
  who.style.cursor = "pointer";
  who.addEventListener("click", () => go({ r: "user", id: c.id }));
  topEl.append(h("div", { class: "bar chb" }, backBtn(), who, ibtn("dots", "Chat options", () => dmMenu(peer, true))));
  const list = h("div", { class: "msgs" });
  const pend = [], jobs = [];
  const strip = h("div", { class: "cpend", hidden: true });
  const ta = h("textarea", { rows: 1, placeholder: "Message", "aria-label": "Message", enterkeyhint: "send", autocomplete: "off" });
  const send = h("button", { class: "pri", "aria-label": "Send", disabled: true }, ic("send", 20));
  const scrollEnd = () => { main.scrollTop = main.scrollHeight; };
  const nearEnd = () => main.scrollHeight - main.scrollTop - main.clientHeight < 160;
  const sync = () => {
    send.disabled = busy || !!locked || jobs.length > 0 || (!ta.value.trim() && !pend.length);
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
  };
  const draw = () => {
    strip.textContent = "";
    pend.forEach((src, i) => strip.append(h("div", {}, mkImg(src), h("button", { "aria-label": "Remove", onclick: () => { pend.splice(i, 1); draw(); } }, ic("close", 14)))));
    jobs.forEach(j => strip.append(j.el));
    strip.hidden = !pend.length && !jobs.length;
    sync();
  };
  const att = pickBtn("image", "Add photo", false, f => addMedia(f, pend, jobs, 4, draw), true, f => addMedia(f, pend, jobs, 4, draw));
  const lockNote = h("div", { class: "lockn", hidden: true });
  const zpop = h("button", { class: "zpop", type: "button" }, zenAv(34), h("span", {}, h("b", {}, "Zenith AI")));
  zpop.addEventListener("pointerdown", e => e.preventDefault());
  zpop.addEventListener("click", () => { ta.value = ta.value.replace(/@\w*$/, "@zenith "); zpop.classList.remove("on"); sync(); ta.focus(); });
  ta.addEventListener("input", () => zpop.classList.toggle("on", zOn() && /@\w*$/.test(ta.value)));
  const dock = h("div", { class: "cdock" }, zpop, lockNote, strip, h("div", { class: "cin" }, att, ta, send));
  const applyLock = reason => {
    if (reason === locked) return;
    locked = reason;
    dock.classList.toggle("locked", !!reason);
    ta.disabled = !!reason;
    ta.placeholder = reason ? "Messaging is off" : "Message";
    att.querySelector("input").disabled = !!reason;
    lockNote.textContent = reason;
    lockNote.hidden = !reason;
    sync();
  };
  const refreshStatus = () => dmStatus(c.id).then(st => { if (liveDm && liveDm.id === c.id) applyLock(dmLockText(st)); }).catch(() => {});

  // typing dots sit in a slot that always exists and grows smoothly, so the chat never jumps
  tEl = h("div", { class: "trow" }, h("div", { class: "tin" }, h("div", { class: "mrow them" }, h("div", { class: "bub typing" }, h("i"), h("i"), h("i")))));
  const typing = on => {
    const near = nearEnd();
    tEl.classList.toggle("show", !!on);
    if (near) {
      cancelAnimationFrame(tRaf);
      const t0 = performance.now();
      const step = () => { scrollEnd(); if (performance.now() - t0 < 380) tRaf = requestAnimationFrame(step); };
      tRaf = requestAnimationFrame(step);
    }
  };
  const hint = txt => {
    list.querySelectorAll(".empty").forEach(e => e.remove());
    if (txt) list.insertBefore(h("div", { class: "empty" }, txt === "load" ? h("p", {}, "Loading...") : [ic("chat", 48), h("p", {}, txt)]), tEl);
  };
  const pushRow = row => {
    list.querySelectorAll(".empty").forEach(e => e.remove());
    list.insertBefore(row, tEl);
    scrollEnd();
  };

  // one queue so a slow answer can never race with a fast one
  let q = Promise.resolve();
  const syncRows = (rows, o) => (q = q.then(() => doSync(rows, o || {})).catch(() => {}));
  const doSync = async (rows0, o) => {
    const rows = rows0.filter(m => visibleMsg(m, c.id));
    if (o.prune) {
      const ids = new Set(rows.map(r => String(r.id)));
      list.querySelectorAll("[data-mid]").forEach(el => { if (!ids.has(el.dataset.mid)) { delete el.dataset.mid; foldAway(el); } });
    }
    const have = new Map();
    list.querySelectorAll("[data-mid]").forEach(el => have.set(el.dataset.mid, el));
    const fresh = rows.filter(m => !have.has(String(m.id)));
    const changed = rows.filter(m => have.has(String(m.id)) && have.get(String(m.id))._sig !== dmSig(m));
    const opened = await openRows(fresh.concat(changed), c.id);
    const near = nearEnd();
    let added = false;
    opened.forEach(m => {
      const key = String(m.id);
      if (have.has(key)) { have.get(key).refill(m); return; }
      if (list.querySelector('[data-mid="' + key + '"]')) return;
      const mine = m.sender_id === me;
      const row = dmBubble(m, mine, c.id);
      if (!mine && !o.initial) {
        row.classList.add("new");
        // the typing dots go away at once so nothing slides when the message lands
        tEl.classList.add("snap");
        typing(false);
        requestAnimationFrame(() => requestAnimationFrame(() => tEl.classList.remove("snap")));
      }
      list.querySelectorAll(".empty").forEach(e => e.remove());
      list.insertBefore(row, tEl);
      added = true;
    });
    if (!list.querySelector("[data-mid], .tmpm")) hint("No messages yet. Say hi.");
    const unread = rows.filter(m => m.recipient_id === me && !m.read_at).map(m => m.id);
    if (unread.length) markRead(unread);
    if (added && (near || o.initial)) scrollEnd();
  };

  // only the owner can call Zenith in a chat: the answer is sent as a normal message with a hidden mark inside the sealed text, so both people see it as Zenith
  const zenInDm = async (sentText, sentP) => {
    // what the other person wrote never leaves the sealed chat: Zenith only gets the owner's words and his own, the rest is a blank turn
    const hist = Array.from(list.querySelectorAll("[data-mid]")).map(r => r._m).filter(m => m && m.text).slice(-20)
      .map(m => m.ai ? "Zenith: " + m.text : m.sender_id === me ? "Person A: " + m.text.replace(/@zenith/gi, "Zenith") : "Person B: (a private message you cannot read)");
    hist.push("Person A: " + sentText.replace(/@zenith/gi, "Zenith"));
    const ghost = h("div", { class: "mrow zdm tmpm" }, h("div", { class: "bub typing" }, h("i"), h("i"), h("i")));
    pushRow(ghost);
    let reply = "";
    try {
      reply = await zGen(ZSYS_REPLY + " This is a chat between two people, Person A and Person B, and Zenith is in it. Answer the last message that mentions Zenith. In this chat you may ask a short question back, this overrides the earlier rule about questions.", hist.join("\n"));
    } catch (e) {}
    ghost.remove();
    if (!reply) { toast("Zenith is not reachable right now"); return; }
    // his bubble shows the moment the answer is ready, the sending happens behind it
    const nb = dmBubble({ body: "", text: reply, ai: true, created_at: new Date().toISOString(), sender_id: me, media: [] }, true, c.id);
    nb.classList.add("new", "tmpm");
    pushRow(nb);
    try {
      await sentP;
      const saved = await sendDm(c.id, ZMARK + reply, [], []);
      threadPush(c.id, saved);
      list.querySelectorAll('[data-mid="' + saved.id + '"]').forEach(d => { if (d !== nb) d.remove(); });
      nb.dataset.mid = String(saved.id);
      nb.classList.remove("tmpm");
      nb._sig = dmSig(saved);
      nb._m = Object.assign({}, saved, { text: reply, ai: true });
    } catch (e) { nb.remove(); toast("Could not send Zenith's answer"); }
  };
  const doSend = async () => {
    const text = cleanText(ta.value.trim());
    if ((!text && !pend.length) || jobs.length || busy || locked) return;
    busy = true;
    const srcs = pend.splice(0);
    ta.value = "";
    sendTyping(c.id, false);
    draw();
    const dims = await Promise.all(srcs.map(srcDims));
    const tmp = { body: text, created_at: new Date().toISOString(), sender_id: me, media: srcs.map((s, i) => ({ url: s, type: (/^data:([^;,]+)/.exec(s) || [0, ""])[1], w: dims[i].w, h: dims[i].h })) };
    const row = dmBubble(tmp, true, c.id);
    row.classList.add("new", "tmpm");
    pushRow(row);
    const landed = saved => {
      threadPush(c.id, saved);
      // keep the bubble that is already on screen: no re-render, no flash
      row.dataset.mid = String(saved.id);
      list.querySelectorAll('[data-mid="' + saved.id + '"]').forEach(d => { if (d !== row) d.remove(); });
      row.classList.remove("tmpm");
      // the little pop only plays when the chat was open while this message was on its way
      row.classList.add("landed");
      setTimeout(() => row.classList.remove("landed"), 450);
      row._sig = dmSig(saved);
      row._m = Object.assign({}, saved, { text });
    };
    try {
      // a link is sent after its preview is ready, so the other person gets the card at once
      const lk = firstUrl(text);
      if (lk && !(S.previews[lk] && S.previews[lk].v)) await Promise.race([getPreview(lk), new Promise(r => setTimeout(r, 4500))]);
      const sentP = sendDm(c.id, text, srcs, dims);
      if (zOn() && /@zenith/i.test(text)) zenInDm(text, sentP);
      const saved = await sentP;
      landed(saved);
    } catch (e) {
      // the answer may have been lost after the server saved the message: the chat is checked before the text is given back, so it is never sent twice
      if (!srcs.length) {
        try {
          const rows = await withTimeout(dmThread(c.id), 6000);
          const recent = rows.filter(m => m.sender_id === me && Date.now() - Date.parse(m.created_at) < 120000 && !list.querySelector('[data-mid="' + m.id + '"]'));
          for (const m of recent.reverse()) { if ((await openText(c.id, m.body)) === text) { landed(m); busy = false; draw(); return; } }
        } catch (x) {}
      }
      row.remove();
      if (!list.querySelector("[data-mid], .tmpm")) hint("No messages yet. Say hi.");
      // what was typed in the meantime is never overwritten
      ta.value = ta.value.trim() ? ta.value : text;
      pend.push(...srcs);
      toast("Could not send. " + plainErr(e, "Try again"));
      refreshStatus();
    }
    busy = false;
    draw();
  };
  // sending must never close the keyboard: that resizes the page and makes the chat jump
  let hadFocus = false;
  const keepFocus = e => { hadFocus = document.activeElement === ta; e.preventDefault(); };
  send.addEventListener("pointerdown", keepFocus);
  send.addEventListener("mousedown", e => e.preventDefault());
  send.addEventListener("click", () => {
    const f = hadFocus || document.activeElement === ta;
    hadFocus = false;
    doSend();
    if (f && !ta.disabled) ta.focus({ preventScroll: true });
  });
  ta.addEventListener("input", () => { sync(); if (ta.value.trim()) sendTyping(c.id, true); else sendTyping(c.id, false); });
  ta.addEventListener("blur", () => sendTyping(c.id, false));
  ta.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) { e.preventDefault(); doSend(); }
  });

  const tkey = "thread:" + me + ":" + c.id;
  const pull = () => dmThread(c.id).then(rows => {
    if (!liveDm || liveDm.id !== c.id) return;
    cacheWrite(tkey, rows.slice(-100));
    return syncRows(rows, { prune: true });
  });
  const poll = setInterval(() => {
    if (busy || document.hidden || !liveDm || liveDm.id !== c.id) return;
    pull().catch(() => {});
    refreshStatus();
  }, 5000);
  const onVis = () => { if (document.visibilityState === "visible" && liveDm && liveDm.id === c.id) { pull().catch(() => {}); refreshStatus(); } };
  document.addEventListener("visibilitychange", onVis);
  liveDm = {
    id: c.id,
    fill: pre => { if (locked) return; ta.value = pre; sync(); ta.focus(); },
    add: async m => { threadPush(c.id, m); await syncRows([m], {}); },
    drop: id => {
      const el = list.querySelector('[data-mid="' + String(id) + '"]');
      const after = () => { if (!list.querySelector("[data-mid], .tmpm")) hint("No messages yet. Say hi."); };
      threadDrop(c.id, id);
      if (el) foldAway(el, after); else after();
    },
    typing,
    stop: () => { clearInterval(poll); document.removeEventListener("visibilitychange", onVis); cancelAnimationFrame(tRaf); sendTyping(c.id, false); }
  };
  main.style.cssText = "display:flex;flex-direction:column";
  list.append(tEl);
  main.append(list, dock);
  navEl.hidden = true;
  const fillHeader = () => {
    const a = acctCache.get(c.id) || { username: "user", name: "user", avatar: null };
    peer.name = a.name;
    who.replaceChild(rAv({ name: a.name, avatar: a.avatar }, 36), who.firstChild);
    wn.textContent = "";
    wn.append(h("b", {}, nickOf(c.id) || a.name), h("span", {}, "@" + a.username));
  };
  if (acctCache.has(c.id)) fillHeader();
  acctsFor([c.id]).then(() => loadSocial()).then(fillHeader);
  refreshStatus();
  const pre = dmPre.get(c.id);
  dmPre.delete(c.id);
  if (pre && pre.length) {
    pre.forEach(m => list.insertBefore(dmBubble(m, m.sender_id === me, c.id), tEl));
    scrollEnd();
  }
  const hit = cacheRead(tkey);
  if (hit && Array.isArray(hit.v) && hit.v.length) syncRows(hit.v, { initial: true });
  else if (hit && Array.isArray(hit.v)) hint("No messages yet. Say hi.");
  else if (!(pre && pre.length)) hint("load");
  pull().then(() => { scrollEnd(); }).catch(() => { if (!list.querySelector("[data-mid], .tmpm")) hint("Could not load messages. Trying again..."); });
  sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", me).eq("actor_id", c.id).eq("kind", "message").is("read_at", null).then(() => refreshBadge());
  sync();
}

function blockedV() {
  topEl.append(bar(backBtn(), ttl("Blocked accounts")));
  const list = h("div");
  main.append(list);
  list.append(loadingEl());
  const showNone = () => { list.textContent = ""; list.append(emptyState("user", "You have not blocked anyone.")); };
  withTimeout(sb.from("blocks").select("blocked_id").eq("blocker_id", sbUser.id)).then(({ data, error }) => {
    if (error) { failBox(list, "Could not load blocked accounts.", () => render()); return; }
    const ids = (data || []).map(r => r.blocked_id).filter(Boolean);
    return cachedAccounts(ids).then(m => {
      list.textContent = "";
      if (!ids.length) { showNone(); return; }
      ids.forEach(id => {
        const a = m.get(id) || { username: "user", display_name: null, avatar: null };
        const nm = a.display_name || a.username;
        const unblockBtn = h("button", { class: "ghost", onclick: e => {
          e.stopPropagation();
          unblockBtn.disabled = true;
          sb.from("blocks").delete().eq("blocker_id", sbUser.id).eq("blocked_id", id).then(({ error: err }) => {
            if (err) { unblockBtn.disabled = false; toast("Could not unblock"); return; }
            row.remove();
            toast("Unblocked");
            loadFeed().catch(() => {});
            if (!list.querySelector(".lrow")) showNone();
          });
        } }, "Unblock");
        const row = h("div", { class: "lrow", onclick: () => go({ r: "user", id }) },
          rAv({ name: nm, avatar: a.avatar }, 48),
          h("div", { class: "nm" }, h("b", {}, nm), h("span", { class: "sub" }, "@" + a.username)),
          unblockBtn);
        list.append(row);
      });
    });
  }).catch(() => failBox(list, "Could not load blocked accounts.", () => render()));
}
// people to find: a mix that changes every 15 to 25 minutes, plus a search box
let discSeed = null;
function searchV() {
  topEl.append(bar(menuBtn(), ttl("Search")));
  const box = h("input", { class: "in", type: "search", placeholder: "Search people", autocomplete: "off", maxlength: "30", "aria-label": "Search people" });
  const info = h("p", { class: "hint" });
  const list = h("div");
  main.append(h("div", { class: "srch" }, box), info, list);
  const seedNow = () => {
    if (!discSeed || !(discSeed.until > Date.now())) discSeed = { seed: uid(), until: Date.now() + (15 + Math.random() * 10) * 60000 };
    return discSeed;
  };
  const row = a => {
    const nm = a.display_name || a.username;
    return h("div", { class: "lrow", onclick: () => go({ r: "user", id: a.id }) },
      rAv({ name: nm, avatar: a.avatar }, 48),
      h("div", { class: "nm" }, h("b", {}, nm), h("span", { class: "sub" }, "@" + a.username + (a.bio ? " · " + a.bio.slice(0, 60) : ""))));
  };
  const show = (rows, empty) => {
    list.textContent = "";
    if (!rows.length) { list.append(emptyState("user", empty)); return; }
    rows.forEach(a => list.append(row(a)));
  };
  let timer = null, token = 0;
  const suggest = async () => {
    clearTimeout(timer);
    const d = seedNow();
    const mine = ++token;
    info.textContent = "Suggested people, refreshed often";
    const { data, error } = await sb.rpc("discover_accounts", { p_seed: d.seed, p_n: 12 });
    if (mine !== token) return;
    if (error) { list.textContent = ""; list.append(emptyState("user", "Could not load people.")); return; }
    show(data || [], "No one to suggest yet.");
    // while nobody can be suggested it looks again every 15 seconds
    const next = (data || []).length ? Math.max(1000, d.until - Date.now()) + 500 : 15000;
    timer = setTimeout(() => { if (document.body.contains(list) && !box.value.trim()) suggest(); }, next);
  };
  let wait = null;
  box.addEventListener("input", () => {
    clearTimeout(wait);
    const q = box.value.trim();
    if (q.length < 2) { suggest(); return; }
    wait = setTimeout(async () => {
      clearTimeout(timer);
      const mine = ++token;
      info.textContent = "";
      const { data, error } = await sb.rpc("search_accounts", { p_q: q });
      if (mine !== token) return;
      if (error) { list.textContent = ""; list.append(emptyState("user", "Could not search.")); return; }
      show(data || [], "No one found.");
    }, 300);
  });
  list.append(loadingEl());
  suggest();
}
function followListV(c, mode) {
  const title = mode === "followers" ? "Followers" : "Following";
  topEl.append(bar(backBtn(), ttl(title)));
  const list = h("div");
  main.append(list);
  const col = mode === "followers" ? "follower_id" : "followee_id";
  const keyCol = mode === "followers" ? "followee_id" : "follower_id";
  const ukey = "fl:" + mode + ":" + c.id;
  const paintIds = ids => cachedAccounts(ids).then(m => {
    list.textContent = "";
    if (!ids.length) { list.append(emptyState("user", mode === "followers" ? "No followers yet." : "Not following anyone yet.")); return; }
    ids.forEach(id => {
      const a = m.get(id) || { username: "user", display_name: null, avatar: null };
      const nm = a.display_name || a.username;
      list.append(h("div", { class: "lrow", onclick: () => go({ r: "user", id }) },
        rAv({ name: nm, avatar: a.avatar }, 48),
        h("div", { class: "nm" }, h("b", {}, nm), h("span", { class: "sub" }, "@" + a.username))));
    });
  });
  const hit = cacheRead(ukey);
  const load = () => {
    withTimeout(Promise.all([
      sb.from("follows").select(col).eq(keyCol, c.id).limit(500),
      sb.from("blocks").select("blocker_id, blocked_id").or("blocker_id.eq." + sbUser.id + ",blocked_id.eq." + sbUser.id)
    ])).then(([a1, a2]) => {
      if (a1.error || a2.error) throw new Error("load");
      const hidden = new Set((a2.data || []).map(b => (b.blocker_id === sbUser.id ? b.blocked_id : b.blocker_id)));
      const ids = (a1.data || []).map(r => r[col]).filter(id => !hidden.has(id));
      cacheWrite(ukey, ids);
      return paintIds(ids);
    }).catch(() => { if (!list.isConnected) return; if (hit) return; failBox(list, "Could not load this list. Check your connection.", () => { list.textContent = ""; list.append(loadingEl()); load(); }); });
  };
  if (hit) paintIds(hit.v); else list.append(loadingEl());
  load();
}
function dmRow(cv, body) {
  const last = cv.last;
  const mine = !!last && last.sender_id === sbUser.id;
  const sub = h("span", { class: "sub" }, !last ? "No messages" : dmGist(body, last.media, mine));
  if (typeIn.has(cv.other)) { sub.textContent = "typing..."; sub.classList.add("tp"); }
  return h("div", { class: "lrow", "data-uid": cv.other, onclick: () => openDm(cv.other) },
    rAv({ name: cv.name, avatar: cv.avatar }, 48),
    h("div", { class: "nm" }, h("b", {}, nickOf(cv.other) || cv.name), sub),
    last ? h("span", { class: "time" }, ago(Date.parse(last.created_at))) : null,
    cv.unread ? h("span", { class: "nbadge" }, String(cv.unread)) : null);
}
function dmGist(text, media, mine) {
  const list = media || [];
  const t = String(text || "").trim();
  const who = mine ? "You sent" : "Sent";
  if (list.length) {
    if (list.every(x => x.post)) return who + (list.length === 1 ? " a post" : " " + list.length + " posts");
    return who + (list.length === 1 ? " an image" : " " + list.length + " images");
  }
  if (/^https?:\/\/\S+$/i.test(t)) return who + " a link";
  return t ? (mine ? "You: " : "") + t : "";
}

// a row that opens into the rows under it; which ones are open survives a repaint
const openFolders = new Set();
function folder(key, head, kids) {
  const box = h("div", { class: "fold" + (openFolders.has(key) ? " open" : "") });
  head.append(h("span", { class: "chev" }, ic("back", 18)));
  head.setAttribute("role", "button");
  head.addEventListener("click", () => { box.classList.toggle("open"); if (box.classList.contains("open")) openFolders.add(key); else openFolders.delete(key); head.setAttribute("aria-expanded", box.classList.contains("open")); });
  head.setAttribute("aria-expanded", openFolders.has(key));
  box.append(head, h("div", { class: "kids" }, kids));
  return box;
}
// the row shrinks to nothing, then leaves the page; the gap the list puts between rows shrinks with it, so nothing jumps at the end
function foldAway(el, done) {
  const par = el.parentElement ? getComputedStyle(el.parentElement) : null;
  const gap = par && /flex|grid/.test(par.display) ? parseFloat(par.rowGap) || 0 : 0;
  el.classList.remove("new", "open");
  el.style.animation = "none";
  el.style.height = el.offsetHeight + "px";
  el.style.overflow = "hidden";
  el.style.transition = "height .2s ease, margin-bottom .2s ease, opacity .16s ease";
  void el.offsetHeight;
  el.style.height = "0px";
  el.style.marginBottom = -gap + "px";
  el.style.opacity = "0";
  let fin = false;
  const end = () => { if (fin) return; fin = true; el.remove(); if (done) done(); };
  el.addEventListener("transitionend", e => { if (e.propertyName === "height") end(); });
  setTimeout(end, 280);
}
// drag a row to the left to delete it: del() says whether the server removed it, gone() runs after the row is out
function swipeRow(row, del, gone) {
  const wrap = h("div", { class: "swipe" }, h("div", { class: "sbg" }, ic("trash", 22)), row);
  let x0 = null, y0 = 0, dx = 0, lock = null, moved = false;
  row.addEventListener("pointerdown", e => { if (e.pointerType === "mouse" && e.button !== 0) return; x0 = e.clientX; y0 = e.clientY; dx = 0; lock = null; moved = false; });
  row.addEventListener("pointermove", e => {
    if (x0 == null) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (lock == null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) lock = Math.abs(mx) > Math.abs(my) ? "x" : "y";
    if (lock !== "x") return;
    if (!moved) { moved = true; row.classList.add("drag"); try { row.setPointerCapture(e.pointerId); } catch (x) {} }
    dx = Math.min(0, mx);
    row.style.transform = "translateX(" + dx + "px)";
  });
  const end = async () => {
    if (x0 == null) return;
    x0 = null;
    row.classList.remove("drag");
    if (!moved) return;
    if (dx < -Math.min(120, wrap.offsetWidth * 0.35)) {
      row.style.transform = "translateX(-100%)";
      if (await del()) { foldAway(wrap, gone); return; }
    }
    row.style.transform = "";
  };
  row.addEventListener("pointerup", end);
  row.addEventListener("pointercancel", end);
  row.addEventListener("click", e => { if (moved) { e.stopImmediatePropagation(); e.preventDefault(); moved = false; } }, true);
  return wrap;
}
const NOTE_WHAT = { follow: "followed you", reply: "replied to your post", like: "liked your post", repost: "reposted your post", message: "sent you a message" };
function openNotif(n) {
  if (n.kind === "message") { openDm(n.actor_id); return; }
  if (n.post_id) {
    const lp = S.posts.find(x => x.remote === n.post_id);
    if (lp) { go({ r: "thread", id: lp.id }); return; }
  }
  go({ r: "user", id: n.actor_id });
}
async function notifsV() {
  topEl.append(bar(backBtn(), ttl("Notifications")));
  const list = h("div");
  main.append(list);
  list.append(loadingEl());
  let got;
  try {
    got = await withTimeout(Promise.all([
      sb.from("notifications").select("id, actor_id, kind, post_id, created_at, read_at").eq("user_id", sbUser.id).neq("kind", "message").order("created_at", { ascending: false }).limit(100),
      loadSocial()
    ]));
  } catch (e) { got = [{ error: e }]; }
  const { data, error } = got[0];
  if (error) { failBox(list, "Could not load notifications. Check your connection.", () => render()); return; }
  const rows = data || [];
  await acctsFor(rows.map(r => r.actor_id));
  list.textContent = "";
  if (!rows.length) { list.append(emptyState("bell", "No notifications yet.")); return; }
  const checkEmpty = () => { if (!list.querySelector(".lrow")) list.append(emptyState("bell", "No notifications yet.")); };
  rows.forEach(n => {
    const id = n.actor_id;
    const a = acctCache.get(id) || { username: "user", name: "user", avatar: null };
    list.append(swipeRow(h("div", { class: "lrow" + (n.read_at ? "" : " unread"), onclick: () => openNotif(n) },
      rAv({ name: a.name, avatar: a.avatar }, 40),
      h("div", { class: "nm" }, h("b", {}, nickOf(id) || a.name), h("span", { class: "sub" }, NOTE_WHAT[n.kind] || "")),
      h("span", { class: "time" }, ago(Date.parse(n.created_at)))),
      async () => { const { error } = await sb.from("notifications").delete().eq("id", n.id); if (error) { toast("Could not delete"); return false; } return true; },
      checkEmpty));
  });
  sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", sbUser.id).neq("kind", "message").is("read_at", null).then(() => refreshBadge());
}
function onIncomingMsg(payload) {
  const m = payload.new;
  refreshBadge();
  if (refreshChat) refreshChat();
  if (liveDm && liveDm.id === m.sender_id) { liveDm.add(m); return; }
  Promise.all([acctsFor([m.sender_id]), loadSocial()]).then(() => {
    const a = acctCache.get(m.sender_id) || { name: "user" };
    openText(m.sender_id, m.body).then(zUn).then(t => alertMe(nickOf(m.sender_id) || a.name, dmGist(t, m.media, false), () => openDm(m.sender_id)));
  });
}
function onIncomingNote(payload) {
  const n = payload.new;
  refreshBadge();
  if (n.kind === "message") return;
  Promise.all([acctsFor([n.actor_id]), loadSocial()]).then(() => {
    const a = acctCache.get(n.actor_id) || { name: "user" };
    alertMe(nickOf(n.actor_id) || a.name, NOTE_WHAT[n.kind] || "", () => openNotif(n));
  });
}
function onDeletedMsg(payload) {
  const id = payload && payload.old ? payload.old.id : null;
  if (id == null) return;
  if (liveDm) liveDm.drop(id);
  refreshBadge();
  if (refreshChat) refreshChat();
}
// a post of yours was taken down by the AI check: flash the screen and say why
const modShown = new Set();
function dropLocalPosts(remoteIds) {
  const want = new Set(remoteIds);
  const gone = new Set(S.posts.filter(x => x.remote && want.has(x.remote)).map(x => x.id));
  for (let grew = true; grew;) { grew = false; S.posts.forEach(x => { if (x.parent && gone.has(x.parent) && !gone.has(x.id)) { gone.add(x.id); grew = true; } }); }
  if (!gone.size) return false;
  S.posts = S.posts.filter(x => !gone.has(x.id));
  S.lists.forEach(l => { l.ids = l.ids.filter(i => !gone.has(i)); });
  persist();
  return true;
}
// somebody's email address was written in a post that was taken down: this cannot be dismissed for 10 seconds,
// and the shortcut to the email page only opens after 5; nothing here forces a change
function showExposedNotice(n) {
  const scrim = h("div", { class: "scrim" });
  let left = 10, iv = 0;
  const ok = h("button", { class: "pri", disabled: true }, "");
  const chg = h("button", { class: "ghost", disabled: true, onclick: () => changeEmailV() }, "Change my email");
  const paint = () => { ok.textContent = left > 0 ? "I understand (" + left + ")" : "I understand"; ok.disabled = left > 0; chg.disabled = left > 5; };
  const done = () => { clearInterval(iv); dismiss(scrim, ov); sb.from("mod_notices").update({ seen_at: new Date().toISOString() }).eq("id", n.id).then(() => {}, () => {}); };
  ok.addEventListener("click", () => { if (left <= 0) done(); });
  const ov = h("div", { class: "sheet warn", role: "alertdialog", "aria-modal": "true" },
    h("div", { class: "grab" }, h("i")),
    h("div", { class: "warnt" }, "Your email was posted"),
    h("p", {}, "This email address was written in a public post. The post has been removed."),
    h("div", { class: "xmail" }, String(n.note || "")),
    ok, chg);
  paint();
  iv = setInterval(() => { left--; paint(); if (left <= 0) clearInterval(iv); }, 1000);
  layer.append(scrim, ov);
}
function showModNotice(n) {
  if (!n || modShown.has(n.id)) return;
  modShown.add(n.id);
  if (n.kind === "exposed") { showExposedNotice(n); return; }
  try { if (n.post_id) dropLocalPosts([n.post_id]); } catch (e) {}
  // somebody who said they are under 18 goes straight to the age check, no warning first
  if (n.kind === "minor") {
    sb.from("mod_notices").update({ seen_at: new Date().toISOString() }).eq("id", n.id).then(() => {}, () => {});
    ageGate = true;
    hist(false);
    render();
    return;
  }
  if (n.kind === "bio") S.profile.bio = "";
  if (n.kind === "name") S.profile.name = "";
  if (n.kind === "bio" || n.kind === "name") { persist(); renderRail(); }
  const field = /^(avatar|banner)/.exec(n.kind || "");
  if (field) {
    // the picture was taken down on the server, so stop re-uploading the local copy
    if (field[1] === "avatar") S.profile.avatar = null; else S.profile.banner = null;
    persist(); renderRail();
  }
  const sexual = n.kind === "sexual" || (field && !/_(toolarge|rules)$/.test(n.kind));
  const what = field ? (field[1] === "avatar" ? "Profile photo removed" : "Banner removed") : ({ bio: "Bio removed", name: "Name removed", username: "Username changed" })[n.kind] || "Post removed";
  const scrim = h("div", { class: "scrim" });
  const lockP = h("p", {});
  if (n.post_id && /^(rules|sexual)$/.test(n.kind)) loadPostLock().then(() => { if (lockLeft()) lockP.textContent = "Posting is paused for " + lockText(lockLeft()) + "."; });
  const done = () => { dismiss(scrim, ov); sb.from("mod_notices").update({ seen_at: new Date().toISOString() }).eq("id", n.id).then(() => {}, () => {}); render(); };
  const ov = h("div", { class: "sheet warn", role: "alertdialog", "aria-modal": "true" },
    h("div", { class: "grab" }, h("i")),
    h("div", { class: "warnt" }, what),
    h("p", {}, n.kind === "removed" ? "Reason: reported and removed by the owner." : /^(rules|bio|name|username|avatar_rules|banner_rules)$/.test(n.kind) ? "Reason: " + (n.note ? n.note.replace(/[.\s]+$/, "") + "." : "text that is not allowed.") : sexual ? "Reason: sexual content." : "Reason: the file could not be checked."),
    lockP,
    h("button", { class: "pri", onclick: done }, "I understand"));
  layer.append(scrim, ov);
}
async function checkModNotices() {
  if (!sbUser) return;
  const { data } = await sb.from("mod_notices").select("id, kind, post_id, note").is("seen_at", null).order("created_at", { ascending: true }).limit(5);
  (data || []).forEach(showModNotice);
}
const isStandalone = () => (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
let installEv = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEv = e; });
window.addEventListener("appinstalled", () => { try { localStorage.setItem("nook-installed", "1"); } catch (e) {} });
async function maybeInstallPrompt() {
  try {
    if (isStandalone()) { localStorage.setItem("nook-installed", "1"); return; }
    if (localStorage.getItem("nook-installed") === "1") return;
    if (Date.now() < Number(localStorage.getItem("nook-install-hide") || 0)) return;
  } catch (e) {}
  try { if (navigator.getInstalledRelatedApps && (await navigator.getInstalledRelatedApps()).length) return; } catch (e) {}
  if (layer.childElementCount) { setTimeout(maybeInstallPrompt, 30000); return; }
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const hide = days => { try { localStorage.setItem("nook-install-hide", String(Date.now() + days * 864e5)); } catch (e) {} };
  const close = () => dismiss(scrim, sh);
  const scrim = h("div", { class: "scrim", onclick: () => { hide(3); close(); } });
  const text = ios ? "Open Nook in Safari, tap the Share button, then tap Add to Home Screen. Then open Nook from your home screen to get the full app."
    : installEv ? "Install Nook to open it like a normal app, full screen, with notifications."
    : "Open your browser menu and tap Install app or Add to Home screen. Then open Nook from your home screen.";
  const sh = h("div", { class: "sheet", role: "dialog" },
    h("div", { class: "grab" }, h("i")),
    h("div", { class: "st" }, "Get the Nook app"),
    h("p", { class: "note" }, text),
    !ios && installEv ? h("div", { class: "sg" }, h("button", { class: "si plain", onclick: async () => { close(); try { installEv.prompt(); await installEv.userChoice; } catch (e) {} installEv = null; } }, h("span", {}, "Install"))) : null,
    h("button", { class: "sx", onclick: () => { hide(7); close(); } }, "Not now"));
  layer.append(scrim, sh);
}
let rtBackoff = 2000, rtTimer = null;
function startRealtime() {
  if (!sbUser || rtChan) return;
  // a dropped connection is opened again by itself, a little later each time it fails
  const ch = sb.channel("nook-" + sbUser.id)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: "recipient_id=eq." + sbUser.id }, onIncomingMsg)
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, onDeletedMsg)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "user_id=eq." + sbUser.id }, onIncomingNote)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "bans", filter: "user_id=eq." + sbUser.id }, () => showBanned())
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "mod_notices", filter: "user_id=eq." + sbUser.id }, p => showModNotice(p.new))
    .subscribe(st => {
      if (st === "SUBSCRIBED") { rtBackoff = 2000; return; }
      if ((st === "CHANNEL_ERROR" || st === "TIMED_OUT" || st === "CLOSED") && rtChan === ch && !rtTimer) {
        rtTimer = setTimeout(() => {
          rtTimer = null;
          if (rtChan !== ch || !sbUser) return;
          try { sb.removeChannel(ch); } catch (e) {}
          rtChan = null;
          rtBackoff = Math.min(30000, rtBackoff * 2);
          startRealtime();
        }, rtBackoff);
      }
    });
  rtChan = ch;
  tpChan = sb.channel("tp-" + sbUser.id)
    .on("broadcast", { event: "typing" }, ({ payload }) => onTyping(payload && payload.from, payload ? payload.on : undefined))
    .subscribe();
}

const VIEWS = { privacy: legalV, terms: legalV, auth: authV, user: userV, home: homeV, thread: threadV, profile: profileV, chat: chatV, conv: convV, saved: savedV, tag: tagV, lists: listsV, list: listV, settings: settingsV, zen: zenV, dm: dmV, notifs: notifsV, followers: c => followListV(c, "followers"), following: c => followListV(c, "following"), blocked: blockedV, banned: bannedV, age: ageV, search: searchV };
let lastProfileTap = 0;
// double tap on the profile button: the first one goes back to the account used before, taps in a row after that walk down the list
async function quickSwitch() {
  const list = (await acctList()).filter(a => a.username);
  if (list.length < 2 || !sbUser) return;
  let chain = 0, prev = null;
  try { chain = Date.now() - Number(sessionStorage.getItem("nook-quick") || 0) < 20000 ? 1 : 0; prev = localStorage.getItem("nook-prev-acct"); } catch (e) {}
  const at = list.findIndex(a => a.id === sbUser.id);
  let target = !chain && prev && prev !== sbUser.id ? list.find(a => a.id === prev) : null;
  if (!target) target = list[(at + 1) % list.length];
  try { sessionStorage.setItem("nook-quick", String(Date.now())); } catch (e) {}
  switchAccount(target.id);
}
function buildNav(cur) {
  navEl.textContent = "";
  const r = stack[0].r;
  [["home", "Home", "home"], ["chat", "Chats", "chat"], ["saved", "Saved", "bookmark"], ["profile", "Profile", "user"]].forEach(t => {
    const on = r === t[0];
    const badge = t[0] === "chat" && unreadPeople > 0 ? h("span", { class: "nbadge nav" }, String(unreadPeople)) : null;
    navEl.append(h("button", { class: on ? "on" : "", "aria-label": t[1], "aria-current": on ? "page" : null, onclick: () => {
      if (t[0] === "profile" && Date.now() - lastProfileTap < 350) { lastProfileTap = 0; quickSwitch(); return; }
      if (t[0] === "profile") lastProfileTap = Date.now();
      if (on && stack.length === 1) main.scrollTo({ top: 0, behavior: "smooth" }); else root(t[0]);
    } }, t[0] === "profile" ? avatar(28) : ic(t[2], 26, on), badge));
  });
}
function renderRail() {
  railEl.textContent = "";
  const pr = S.profile;
  const rowBtn = (node, label, fn) => h("button", { class: "rrow", onclick: fn }, node, h("span", {}, label));
  const chats = S.chats.slice(0, 6);
  const lists = S.lists.slice(0, 6);
  const bn = h("div", { class: "banner" });
  if (pr.bannerTheme === "avatar" && pr.avatar) bn.append(mkImg(pr.avatar, "pic blur")); else if (pr.banner) bn.append(picImg(pr.banner));
  const av = avatar();
  av.className = "av xl";
  add(railEl, [
    h("div", { class: "rprof" }, bn, h("div", { class: "pinfo" },
      h("div", { class: "arow" }, av, h("div", { class: "btns" }, h("button", { class: "ghost", onclick: editProfile }, "Edit Profile"))),
      h("b", { class: "pname" }, pr.name || "@" + pr.handle),
      h("p", { class: "phand" }, "@" + pr.handle))),
    h("div", { class: "rhead" }, "Chats", h("button", { class: "rmore", onclick: newChat, "aria-label": "New chat" }, "New")),
    chats.length ? chats.map(c => rowBtn(avatar(36), c.name, () => go({ r: "conv", id: c.id }))) : h("p", { class: "rnote" }, "No chats yet."),
    h("div", { class: "rhead" }, "Lists"),
    lists.length ? lists.map(l => rowBtn(h("div", { class: "sq rsq" }, ic("list", 20)), l.name, () => go({ r: "list", id: l.id }))) : h("p", { class: "rnote" }, "No lists yet."),
    rowBtn(ic("sliders", 20), "Settings", () => root("settings"))]);
}
let ageGate = false;
function render(anim) {
  // a held account sees only the age question, whatever route or history entry asked for something else
  if (ageGate) { stack = [{ r: "age" }]; scrolls.length = 0; }
  let cur = stack[stack.length - 1];
  while (stack.length > 1 && ((cur.r === "thread" && !byId(cur.id)) || (cur.r === "conv" && !S.chats.some(x => x.id === cur.id)) || (cur.r === "list" && !S.lists.some(x => x.id === cur.id)))) {
    stack.pop(); scrolls.pop(); cur = stack[stack.length - 1];
  }
  if (stack.length === 1 && ((cur.r === "thread" && !byId(cur.id)) || (cur.r === "conv" && !S.chats.some(x => x.id === cur.id)) || (cur.r === "list" && !S.lists.some(x => x.id === cur.id)))) { stack = [{ r: "home" }]; scrolls.length = 0; cur = stack[0]; }
  try { sessionStorage.setItem("nook-route", JSON.stringify({ stack, scrolls })); } catch (e) {}
  if (window.nookPtr) window.nookPtr.cancel();
  if (convRO) { convRO.disconnect(); convRO = null; }
  if (liveDm && liveDm.stop) liveDm.stop();
  liveDm = null;
  if (pageStop) { const stopPage = pageStop; pageStop = null; stopPage(); }
  refreshChat = null;
  main.onscroll = null;
  topEl.textContent = "";
  main.textContent = "";
  fabs.textContent = "";
  main.style.cssText = "";
  navEl.hidden = false;
  VIEWS[cur.r](cur);
  buildNav(cur);
  if (cur.r === "auth" || cur.r === "banned") railEl.textContent = ""; else renderRail();
  main.className = "";
  if (anim) { void main.offsetWidth; main.className = "go-" + anim; }
  fresh = null;
  bump = null;
}

async function boot() {
  try {
    db = await idbOpen();
    const r = await idbLoad(db);
    if (r.meta) {
      S = r.meta;
      const byKey = new Map(r.keys.map((k, i) => [k, r.vals[i]]));
      const hy = v => (typeof v === "string" && !v.startsWith("data:") ? byKey.get(v) || null : v);
      (S.posts || []).forEach(p => { p.imgs = (p.imgs || []).map(hy).filter(Boolean); });
      (S.chats || []).forEach(c => (c.msgs || []).forEach(m => { m.imgs = (m.imgs || []).map(hy).filter(Boolean); }));
      if (S.profile) { S.profile.avatar = hy(S.profile.avatar); S.profile.banner = hy(S.profile.banner); }
      r.keys.forEach((k, i) => { imgIds.set(r.vals[i], k); knownIds.add(k); });
      delete S.split;
    }
  } catch (e) { db = null; }
  // saved data of the wrong shape is thrown away instead of stopping the app
  const badShape = s => !s || typeof s !== "object" || (s.posts !== undefined && !Array.isArray(s.posts)) || (s.chats !== undefined && !Array.isArray(s.chats));
  if (badShape(S)) S = null;
  if (!S) { try { const r = localStorage.getItem("tiny-posts-v3"); if (r) S = JSON.parse(r); } catch (e) {} }
  if (badShape(S)) S = null;
  if (!S) { S = freshState(); persist(); }
  // keys that older versions left on this device
  try { ["tiny-bsky-v2", "zenith-pw", "nook-banned"].forEach(k => localStorage.removeItem(k)); } catch (e) {}
  try { if (normalize()) persist(); } catch (e) { S = freshState(); normalize(); persist(); }
  applyTheme();
  try {
    const rt = JSON.parse(sessionStorage.getItem("nook-route") || "null");
    if (rt && Array.isArray(rt.stack) && rt.stack.length && rt.stack.every(x => x && typeof x.r === "string" && VIEWS[x.r])) {
      stack = rt.stack;
      scrolls.length = 0;
      (rt.scrolls || []).slice(0, stack.length - 1).forEach(v => scrolls.push(v));
    }
  } catch (e) {}
  await takeHashLogin().catch(() => {});
  // somebody who was signed in on this phone sees their own saved screen at once; the checks below still decide, and send them elsewhere if they fail
  let early = false, earlySig = "";
  try {
    const mark = localStorage.getItem(LOCAL_UID);
    const key = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k));
    const u = key ? JSON.parse(localStorage.getItem(key)).user : null;
    if (u && u.id && mark === u.id && !stack.some(x => x.r === "auth" || x.r === "banned" || x.r === "age")) {
      sbUser = u;
      early = true;
      hist(true);
      render();
      earlySig = [S.profile.handle, S.profile.name, S.profile.avatar].join("|");
    }
  } catch (e) { early = false; sbUser = null; }
  const earlyUser = early ? sbUser : null;
  let slowLogin = false;
  const { data: sess } = await Promise.race([sb.auth.getSession().catch(() => ({ data: { session: null } })), new Promise(r => setTimeout(() => { slowLogin = true; r({ data: { session: null } }); }, 6000))]);
  // a slow connection is not a sign out: the saved login stays until the server says no
  sbUser = sess && sess.session ? sess.session.user : slowLogin ? earlyUser : null;
  let ageHeld = false, ownAvatar = null;
  if (sbUser) {
    const { data: ban } = await sb.from("bans").select("user_id").eq("user_id", sbUser.id).maybeSingle();
    if (ban) { hist(true); showBanned(); return; }
    const { data: acct, error: aerr } = await sb.from("accounts").select("id, deactivated, username, avatar, display_name").eq("id", sbUser.id).maybeSingle();
    if (acct) ownAvatar = acct.avatar || null;
    // if the check cannot be made the answer is "held": the age screen stays up until the server says otherwise
    if (acct) {
      // an account that passed the age check can never be put on hold, so after that one answer nothing is asked again
      const okKey = "nook-age-ok:" + sbUser.id;
      let verified = false;
      try { verified = localStorage.getItem(okKey) === "1"; } catch (e) {}
      if (!verified) {
        const v = await sb.rpc("my_age_verified");
        if (!v.error && v.data === true) { verified = true; try { localStorage.setItem(okKey, "1"); } catch (e) {} }
      }
      if (verified) acct.age_hold = false;
      else { const { data: held, error: he } = await sb.rpc("my_age_hold"); acct.age_hold = he ? true : held === true; }
    }
    ageHeld = !!(acct && acct.age_hold);
    if (!aerr && (!acct || acct.deactivated)) { try { sessionStorage.setItem("nook-notice", acct ? "That account is deactivated. Sign in again to bring it back." : "Your account could not be loaded. Sign in again."); } catch (e) {} await sb.auth.signOut({ scope: "local" }).catch(() => {}); sbUser = null; }
    else if (sbUser && await foreignLocalData(acct)) { await wipeLocal(true); try { localStorage.setItem(LOCAL_UID, sbUser.id); } catch (e) {} location.reload(); return; }
    if (sbUser && acct) {
      // no "Me" while the profile loads: the real name, handle and picture are in place before the first screen
      if (acct.username) S.profile.handle = acct.username;
      if (acct.display_name) S.profile.name = acct.display_name;
      if (acct.avatar) S.profile.avatar = acct.avatar;
      rememberAccount({ username: acct.username, name: acct.display_name, avatar: acct.avatar }).catch(() => {});
    }
    if (sbUser) sb.auth.onAuthStateChange((ev, session) => {
      if (ev === "SIGNED_OUT" && !switching && !leaving && sbUser) { location.reload(); return; }
      if (switching || !session || !sbUser) return;
      if (session.user.id !== sbUser.id) { location.reload(); return; }
      if (ev === "TOKEN_REFRESHED") acctList().then(list => { const a = list.find(x => x.id === sbUser.id); if (a) { a.rt = session.refresh_token; return acctPut("list", list); } }).catch(() => {});
    });
  }
  // whether somebody is banned is only ever decided by the server: a banned account sees the banned page when it signs in
  if (!sbUser) { stack = [{ r: "auth" }]; scrolls.length = 0; }
  else if (ageHeld) { stack = [{ r: "age" }]; scrolls.length = 0; ageGate = true; }
  else if (stack.some(x => x.r === "auth" || x.r === "banned" || x.r === "age")) { stack = [{ r: "home" }]; scrolls.length = 0; }
  if (sbUser && !ageHeld) { if (early) preloadAvatars(ownAvatar).catch(() => {}); else await preloadAvatars(ownAvatar); }
  hist(true);
  // the saved screen is already up: draw again only when the checks changed what it shows
  if (!(early && sbUser && !ageHeld && earlySig === [S.profile.handle, S.profile.name, S.profile.avatar].join("|"))) render();
  if (RECOVERY && sbUser) newPasswordModal();
  else if (HASH_ERR && !sbUser) toast("That link did not work. Ask for a new one.");
  if (!sbUser || ageHeld) return;
  takeShared().catch(() => {});
  takeOpen();
  loadFeed().catch(() => {});
  loadSocial().catch(() => {});
  ensureE2E().catch(() => {});
  startRealtime();
  warmInbox().catch(() => {});
  checkModNotices().catch(() => {});
  loadPostLock().catch(() => {});
  try { if (sessionStorage.getItem("nook-welcome-back")) { sessionStorage.removeItem("nook-welcome-back"); toast("Welcome back. Your account was restored"); } } catch (e) {}
  setTimeout(maybeInstallPrompt, 6000);
  zenStart().catch(() => {});
  notesStart();
  refreshBadge();
  pushSync();
  setInterval(checkBan, 60000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { checkBan(); refreshBadge(); checkModNotices().catch(() => {}); } });
}
// ---- notes to self: sealed on this phone and kept on every phone ----
// each chat and each message is one row the server cannot read; nothing here ever makes the screen wait
const isNoteChat = c => !(c.msgs || []).some(m => m.ai);
const noteHash = new Map();
const imgH = src => { let v = noteHash.get(src); if (!v) { v = srcHash(src); if (noteHash.size > 3000) noteHash.clear(); noteHash.set(src, v); } return v; };
const noteCSig = c => srcHash("c|" + (c.name || "") + "|" + (c.t || 0));
const noteImgSig = m => (m.imgs || []).map(imgH).join(",");
const noteMSig = m => srcHash("m|" + (m.text || "") + "|" + (m.t || 0) + "|" + noteImgSig(m) + "|" + JSON.stringify(m.rpost || null) + JSON.stringify(m.zpost || null));
let notesOn = false, notesBusy = false, notesAgain = false, notesTimer = 0, notesQuiet = false;
function noteState() {
  const n = S.notesSync;
  if (!n || n.uid !== sbUser.id) S.notesSync = { uid: sbUser.id, cursor: "", pushed: {}, pm: {} };
  return S.notesSync;
}
const blobToData = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
async function noteOpen(key, raw) {
  const parts = String(raw).slice(5).split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(parts[0]) }, key, fromB64(parts[1]));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function noteSeal(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return "e2e1:" + toB64(iv) + "." + toB64(new Uint8Array(ct));
}
async function notePicIn(key, md) {
  const res = await fetch(md.url);
  if (!res.ok) throw new Error("gone");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(md.iv) }, key, await res.arrayBuffer());
  return blobToData(new Blob([pt], { type: md.type || "image/jpeg" }));
}
async function notePicOut(key, src) {
  const blob = await (await fetch(src)).blob();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, await blob.arrayBuffer());
  const path = sbUser.id + "/notes/" + uid() + ".bin";
  const up = await sb.storage.from(DM_BUCKET).upload(path, new Blob([ct]), { contentType: "application/octet-stream", cacheControl: "3600" });
  if (up.error) throw up.error;
  return { url: sb.storage.from(DM_BUCKET).getPublicUrl(path).data.publicUrl, iv: toB64(iv), type: blob.type || "image/jpeg" };
}
const notePath = md => { const m = /\/object\/public\/dm-media\/([^?#]+)/.exec(md && md.url || ""); return m ? decodeURIComponent(m[1]) : null; };
// takes one row from the server into the notes on this phone; true when something changed
async function noteTake(ns, key, r) {
  const isChat = r.id.startsWith("c:"), rid = r.id.slice(2);
  if (r.deleted) {
    if (isChat) {
      const c = S.chats.find(x => x.id === rid);
      if (c && isNoteChat(c) && (ns.pushed[r.id] === noteCSig(c))) { S.chats = S.chats.filter(x => x !== c); ns.pushed[r.id] = "gone"; return true; }
    } else {
      for (const c of S.chats) {
        const m = (c.msgs || []).find(x => x.id === rid);
        if (m && isNoteChat(c) && ns.pushed[r.id] === noteMSig(m)) { c.msgs = c.msgs.filter(x => x !== m); ns.pushed[r.id] = "gone"; delete ns.pm[r.id]; return true; }
      }
    }
    if (ns.pushed[r.id] !== "gone" && !S.chats.some(c => c.id === rid || (c.msgs || []).some(x => x.id === rid))) ns.pushed[r.id] = "gone";
    return false;
  }
  // a note this phone already knew but no longer has was removed here: the removal goes up, it is not brought back
  if (ns.pushed[r.id] && !(isChat ? S.chats.some(x => x.id === rid) : S.chats.some(c => (c.msgs || []).some(x => x.id === rid)))) return false;
  const p = await noteOpen(key, r.body);
  if (isChat) {
    let c = S.chats.find(x => x.id === rid);
    if (c && (!isNoteChat(c) || ns.pushed[r.id] !== noteCSig(c))) return false;
    const name = String(p.n || "Notes to self").slice(0, 200), t = Number(p.t) || Date.now();
    if (c && c.name === name && c.t === t) return false;
    if (!c) { c = { id: rid, name, msgs: [], t }; S.chats.push(c); } else { c.name = name; c.t = t; }
    ns.pushed[r.id] = noteCSig(c);
    return true;
  }
  const cid = String(p.c || "");
  if (!cid) return false;
  let c = S.chats.find(x => x.id === cid);
  if (c && !isNoteChat(c)) return false;
  let m = c && (c.msgs || []).find(x => x.id === rid);
  if (m && ns.pushed[r.id] !== noteMSig(m)) return false;
  const text = String(p.x || ""), t = Number(p.t) || Date.now();
  const media = Array.isArray(r.media) ? r.media : [];
  const have = ns.pm[r.id];
  const rp = p.rp && typeof p.rp.id === "string" && /^[0-9a-f-]{36}$/i.test(p.rp.id) ? { id: p.rp.id, u: typeof p.rp.u === "string" && /^[0-9a-f-]{36}$/i.test(p.rp.u) ? p.rp.u : null } : null;
  const zp = p.zp && typeof p.zp.x === "string" ? { x: p.zp.x.slice(0, 600), t: Number(p.zp.t) || Date.now(), a: typeof p.zp.a === "string" && p.zp.a.startsWith(SB_URL + "/storage/v1/object/public/media/") && p.zp.a.length < 400 ? p.zp.a : null } : null;
  if (m && m.text === text && m.t === t && have && JSON.stringify(have.e) === JSON.stringify(media) && JSON.stringify(m.rpost || null) === JSON.stringify(rp) && JSON.stringify(m.zpost || null) === JSON.stringify(zp)) return false;
  // a photo that cannot be fetched stops the pull here, and it is tried again on the next round
  const imgs = [];
  for (const md of media) imgs.push(await notePicIn(key, md));
  if (!c) { c = { id: cid, name: "Notes to self", msgs: [], t }; S.chats.push(c); ns.pushed["c:" + cid] = noteCSig(c); }
  if (!m) { m = { id: rid, text, t, imgs }; c.msgs.push(m); c.msgs.sort((a, b) => a.t - b.t); } else { m.text = text; m.t = t; m.imgs = imgs; }
  if (rp) m.rpost = rp; else delete m.rpost;
  if (zp) m.zpost = zp; else delete m.zpost;
  ns.pushed[r.id] = noteMSig(m);
  ns.pm[r.id] = { h: noteImgSig(m), e: media };
  return true;
}
async function notesPull(ns, key) {
  let changed = false;
  // a little overlap, so a row saved a moment before the last pull is never missed; what is already here is skipped
  const from = ns.cursor ? new Date(Date.parse(ns.cursor) - 300000).toISOString() : "1970-01-01T00:00:00Z";
  for (let off = 0; off < 40000; off += 500) {
    const { data, error } = await sb.from("notes_self").select("id, body, media, deleted, updated_at").gte("updated_at", from).order("updated_at", { ascending: true }).order("id", { ascending: true }).range(off, off + 499);
    if (error) throw error;
    for (const r of data || []) {
      try { if (await noteTake(ns, key, r)) changed = true; } catch (e) { return changed; }
      if (!ns.cursor || r.updated_at > ns.cursor) ns.cursor = r.updated_at;
    }
    if (!data || data.length < 500) break;
  }
  return changed;
}
async function notesPush(ns, key) {
  const exist = new Set();
  S.chats.forEach(c => { exist.add("c:" + c.id); (c.msgs || []).forEach(m => { if (!m.id) m.id = uid(); exist.add("m:" + m.id); }); });
  const todo = [];
  S.chats.filter(isNoteChat).forEach(c => {
    if (ns.pushed["c:" + c.id] !== noteCSig(c)) todo.push({ id: "c:" + c.id, sig: noteCSig(c), c });
    (c.msgs || []).forEach(m => { if (ns.pushed["m:" + m.id] !== noteMSig(m)) todo.push({ id: "m:" + m.id, sig: noteMSig(m), c, m }); });
  });
  const gone = Object.keys(ns.pushed).filter(id => ns.pushed[id] !== "gone" && !exist.has(id));
  const stale = [];
  for (let i = 0; i < todo.length; i += 20) {
    const part = todo.slice(i, i + 20), rows = [], done = [];
    for (const x of part) {
      try {
        if (x.m) {
          const h = noteImgSig(x.m), have = ns.pm[x.id];
          let media = have && have.h === h ? have.e : null;
          if (!media) { media = []; for (const src of x.m.imgs || []) { if (/^data:/.test(src)) media.push(await notePicOut(key, src)); } }
          rows.push({ owner_id: sbUser.id, id: x.id, body: await noteSeal(key, { c: x.c.id, t: x.m.t, x: x.m.text || "", ...(x.m.rpost ? { rp: x.m.rpost } : {}), ...(x.m.zpost ? { zp: x.m.zpost } : {}) }), media, deleted: false });
          done.push({ x, pm: { h, e: media } });
        } else {
          rows.push({ owner_id: sbUser.id, id: x.id, body: await noteSeal(key, { n: x.c.name, t: x.c.t }), media: [], deleted: false });
          done.push({ x });
        }
      } catch (e) { /* this one is tried again on the next round */ }
    }
    if (!rows.length) continue;
    const { error } = await sb.from("notes_self").upsert(rows, { onConflict: "owner_id,id" });
    if (error) throw error;
    done.forEach(d => {
      const old = ns.pm[d.x.id];
      ns.pushed[d.x.id] = d.x.sig;
      if (d.pm) { ns.pm[d.x.id] = d.pm; if (old && old.h !== d.pm.h) old.e.forEach(md => { const pth = notePath(md); if (pth && !d.pm.e.some(e => e.url === md.url)) stale.push(pth); }); }
    });
  }
  for (let i = 0; i < gone.length; i += 50) {
    const part = gone.slice(i, i + 50);
    const { error } = await sb.from("notes_self").upsert(part.map(id => ({ owner_id: sbUser.id, id, body: "", media: [], deleted: true })), { onConflict: "owner_id,id" });
    if (error) throw error;
    part.forEach(id => { const o = ns.pm[id]; if (o) o.e.forEach(md => { const pth = notePath(md); if (pth) stale.push(pth); }); ns.pushed[id] = "gone"; delete ns.pm[id]; });
  }
  if (stale.length) sb.storage.from(DM_BUCKET).remove(stale).then(() => {}, () => {});
}
function notesRefreshUI() {
  const cur = stack[stack.length - 1];
  if (layer.childElementCount || !cur) return;
  const a = document.activeElement;
  if (a && /^(TEXTAREA|INPUT)$/.test(a.tagName)) return;
  if (cur.r === "chat" || cur.r === "conv") render();
}
async function notesSync() {
  if (!notesOn || !sbUser || !S || !crypto.subtle || e2eLocked) return;
  if (notesBusy) { notesAgain = true; return; }
  notesBusy = true;
  try {
    await ensureE2E();
    const key = await sharedKey(sbUser.id);
    const ns = noteState();
    const changed = await notesPull(ns, key);
    await notesPush(ns, key);
    notesQuiet = true; persist(); notesQuiet = false;
    if (changed) notesRefreshUI();
  } catch (e) { notesQuiet = false; } finally { notesBusy = false; if (notesAgain) { notesAgain = false; setTimeout(notesSync, 1500); } }
}
function notesStart() {
  if (notesOn || !sbUser) return;
  notesOn = true;
  notesSync();
  setInterval(() => { if (document.visibilityState === "visible") notesSync(); }, 90000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") notesSync(); });
  window.addEventListener("online", () => notesSync());
}
async function takeShared() {
  const p = new URLSearchParams(location.search);
  if (!["title", "text", "url", "shared"].some(k => p.has(k))) return;
  history.replaceState(history.state, "", location.pathname);
  const text = [p.get("title"), p.get("text"), p.get("url")].filter(Boolean).join("\n").trim();
  const count = Math.min(20, Number(p.get("shared")) || 0);
  const files = [];
  if (count && "caches" in window) {
    const c = await caches.open("nook-share");
    for (let i = 0; i < count; i++) {
      const key = new URL("share/" + i, location.href).href;
      const r = await c.match(key);
      if (!r) continue;
      const blob = await r.blob();
      files.push(new File([blob], decodeURIComponent(r.headers.get("X-Name") || "shared"), { type: blob.type }));
      await c.delete(key);
    }
  }
  if (!text && !files.length) return;
  const cleaned = cleanText(text);
  // whatever is shared into Nook is first asked about: a post or a message (it already comes from another app)
  const targets = await messageTargets().catch(() => []);
  const sendTo = async t => {
    if (cleaned) await sendLinkTo(t, cleaned);
    for (const f of files) {
      let src = f;
      try { const out = await intake(f); src = typeof out === "string" ? await (await fetch(out)).blob() : out; } catch (e) { toast("That file is not a photo we can read"); continue; }
      await sendPicTo(t, src);
    }
  };
  const compose = () => openCompose(cleaned ? { prefix: cleaned, files } : { files });
  if (!targets.length) { compose(); return; }
  sheet([
    { icon: "edit", label: "Post", fn: compose },
    { icon: "chat", label: "Message", fn: () => chooseTarget(targets, sendTo) },
    { label: "Cancel", cancel: true }], "Share to");
}
if (window.visualViewport) {
  const vv = window.visualViewport;
  let raf = 0, last = -1;
  const fit = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      const v = Math.abs(vv.scale - 1) < 0.01 && kb > 80 ? kb : 0;
      if (v === last) return;
      last = v;
      document.documentElement.style.setProperty("--kb", v + "px");
    });
  };
  vv.addEventListener("resize", fit);
  vv.addEventListener("scroll", fit);
}
(function () {
  const ptr = h("div", { id: "ptr", "aria-hidden": "true" }, ic("refresh", 20));
  document.body.append(ptr);
  const TH = 72;
  let y0 = null, x0 = 0, pull = 0, ty = 0, busy = false, live = false;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const place = p => {
    ptr.style.transform = "translateY(" + (ty + p - 44) + "px)";
    ptr.style.opacity = String(Math.min(1, p / (TH * 0.6)));
    ptr.firstChild.style.transform = "rotate(" + p * 5 + "deg)";
  };
  const reset = () => {
    ptr.classList.add("snap");
    ptr.style.opacity = "0";
    ptr.style.transform = "translateY(" + (ty - 44) + "px)";
  };
  // the same round spinner is shown while "Check for updates" works
  window.nookPtr = {
    spin() {
      if (busy) return;
      busy = true;
      ty = main.getBoundingClientRect().top;
      ptr.classList.add("snap", "spin");
      ptr.firstChild.style.transform = "";
      ptr.style.opacity = "1";
      ptr.style.transform = "translateY(" + (ty - 8) + "px)";
    },
    stop() {
      if (!busy) return;
      busy = false;
      ptr.classList.remove("spin");
      reset();
    },
    // a page that is redrawn under the finger drops the pull, so the circle can never stay on the screen
    cancel() {
      if (busy || (!live && !pull)) return;
      y0 = null; live = false; pull = 0;
      reset();
    }
  };
  async function run() {
    busy = true;
    ptr.classList.add("snap", "spin");
    ptr.firstChild.style.transform = "";
    ptr.style.opacity = "1";
    ptr.style.transform = "translateY(" + (ty - 8) + "px)";
    // whatever stalls, the page reloads after a few seconds instead of hanging on the spinner
    setTimeout(() => location.reload(), 5000);
    try {
      await Promise.all([Promise.race([flush(), wait(2500)]), wait(600)]);
      if ("serviceWorker" in navigator) await Promise.race([navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.update()))), wait(1200)]);
    } catch (e) {}
    location.reload();
  }
  main.addEventListener("touchstart", e => {
    y0 = null;
    live = false;
    pull = 0;
    if (busy || e.touches.length !== 1 || main.scrollTop > 0 || layer.childElementCount || ["conv", "dm", "auth", "age", "banned"].includes(stack[stack.length - 1].r) || (document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName))) return;
    y0 = e.touches[0].clientY;
    x0 = e.touches[0].clientX;
    ty = main.getBoundingClientRect().top;
    ptr.classList.remove("snap");
  }, { passive: true });
  main.addEventListener("touchmove", e => {
    if (y0 == null) return;
    const dy = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0;
    if (!live) {
      if (dy < 0 || Math.abs(dx) > Math.abs(dy) || main.scrollTop > 0) { y0 = null; return; }
      if (dy < 6) return;
      live = true;
    }
    pull = Math.min(dy * 0.5, TH * 1.5);
    if (e.cancelable) e.preventDefault();
    place(pull);
  }, { passive: false });
  const end = () => {
    const was = live, p = pull;
    y0 = null; live = false; pull = 0;
    if (!was) return;
    if (p >= TH) run(); else reset();
  };
  // listened to on the whole document: the finger can lift over something that was removed from the page, and then main never hears of it
  document.addEventListener("touchend", end, true);
  document.addEventListener("touchcancel", end, true);
  // and a pull that nobody finishes is dropped after a moment
  let lastMove = 0;
  main.addEventListener("touchmove", () => { lastMove = Date.now(); }, { passive: true });
  setInterval(() => { if (live && !busy && Date.now() - lastMove > 2500) end(); }, 1000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && live && !busy) end(); });
})();
window.addEventListener("pagehide", flush);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
boot();
setInterval(zenTick, 10000);
setInterval(retryUnsent, 45000);
window.addEventListener("online", () => setTimeout(() => { retryUnsent(); feedTries = 0; if (sbUser && S) loadFeed().catch(() => {}); }, 800));
window.addEventListener("load", () => setTimeout(retryUnsent, 6000));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") zenTick(); });
window.addEventListener("load", () => setTimeout(zenTick, 1500));
