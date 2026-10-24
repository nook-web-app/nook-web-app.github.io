// never run inside someone else's page: a hidden frame is how people trick you into tapping things
if (window.top !== window.self) { try { window.top.location = window.self.location; } catch (e) { document.documentElement.style.display = "none"; } }
// if the app can not start, say so instead of showing a blank page
function startFail(why) {
  const m = document.getElementById("main");
  if (!m || m.childElementCount) return;
  m.textContent = "";
  const box = document.createElement("div");
  box.className = "empty";
  const p = document.createElement("p");
  p.textContent = "Nook could not start. " + (why || "");
  const b = document.createElement("button");
  b.className = "pri";
  b.textContent = "Try again";
  b.onclick = () => { try { navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))).then(() => caches.keys()).then(ks => Promise.all(ks.map(k => caches.delete(k)))).finally(() => location.reload()); } catch (e) { location.reload(); } };
  box.append(p, b);
  m.append(box);
}
window.addEventListener("error", e => setTimeout(() => startFail(String((e && e.message) || "")), 300));
window.addEventListener("unhandledrejection", e => setTimeout(() => startFail(String((e && e.reason && e.reason.message) || "")), 300));
setTimeout(() => startFail("Check your connection."), 12000);
const SB_URL = "https://cimyolsipjdpibzaebmx.supabase.co";
// only the public columns of a profile are read; the moderation flags are not visible to other people
const ACC_COLS = "id, username, display_name, bio, avatar, banner, banner_theme, public_key, deactivated, handle_changed_at, pinned_post_id, created_at";
const SB_KEY = "sb_publishable_BzsW9TXvMRjUQf5BZj3pLg_197wdNpq";
// read before supabase-js clears the link from the address bar
const RECOVERY = /type=recovery/.test(location.hash), HASH_ERR = /error_code=/.test(location.hash);
const sb = window.supabase ? window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true } }) : null;
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
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
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
  i.onerror = () => { i.onerror = null; i.src = src; };
  if (on) i.addEventListener("click", on);
  return i;
}
const picImg = src => mkImg(src, "pic");

const APP_VERSION = "3.3.0";
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
function flat(id, d, out) {
  kids(id).sort((a, b) => a.t - b.t).forEach(k => { out.push({ p: k, d }); flat(k.id, d + 1, out); });
  return out;
}
function feedPosts(f) {
  let a = S.posts.filter(p => !p.parent);
  if (f) {
    if (f.media) a = a.filter(p => p.imgs.length);
    if (f.q) {
      const q = f.q.toLowerCase();
      a = a.filter(p => p.text.toLowerCase().includes(q));
    }
  }
  return a.sort((x, y) => y.t - x.t);
}
function ago(t) {
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

function sheet(items, title) {
  const scrim = h("div", { class: "scrim", onclick: close });
  const row = i => h("button", { class: "si" + (i.danger ? " danger" : "") + (i.icon || i.av ? "" : " plain"), onclick: () => { close(); if (i.fn) i.fn(); } }, i.av ? h("span", { class: "sic" }, rAv(i.av, 32)) : i.icon ? h("span", { class: "sic" }, ic(i.icon, 20)) : null, h("span", {}, i.label));
  const grab = h("div", { class: "grab" }, h("i"));
  const sh = h("div", { class: "sheet", role: "dialog" }, grab, title ? h("div", { class: "st" }, title) : null,
    h("div", { class: "sg" }, items.filter(i => !i.cancel).map(row)),
    items.filter(i => i.cancel).map(i => h("button", { class: "sx", onclick: () => { close(); if (i.fn) i.fn(); } }, i.label)));
  let y0 = null, dy = 0;
  grab.addEventListener("pointerdown", e => { y0 = e.clientY; dy = 0; grab.setPointerCapture(e.pointerId); sh.style.animation = "none"; sh.style.transition = "none"; });
  grab.addEventListener("pointermove", e => { if (y0 != null) { dy = Math.max(0, e.clientY - y0); sh.style.transform = "translateY(" + dy + "px)"; } });
  const end = () => {
    if (y0 == null) return;
    y0 = null;
    sh.style.transition = "transform .2s";
    if (dy > 70) { sh.style.transform = "translateY(120%)"; dismiss(scrim); setTimeout(() => sh.remove(), 220); }
    else sh.style.transform = "";
  };
  grab.addEventListener("pointerup", end);
  grab.addEventListener("pointercancel", end);
  function close() { dismiss(scrim, sh); }
  layer.append(scrim, sh);
}
function confirmSheet(msg, label, fn) {
  sheet([{ label, danger: true, fn }, { label: "Cancel", cancel: true }], msg);
}
// links lose what follows the ? so they do not carry tracking codes; a few sites need one part to find the page
const KEEP_QS = { "youtube.com": ["v", "list", "t"], "m.youtube.com": ["v", "list", "t"], "music.youtube.com": ["v", "list"], "news.ycombinator.com": ["id"] };
function cleanUrl(u) {
  const i = u.indexOf("?");
  if (i < 0) return u;
  let host = "";
  try { host = new URL(u).host.replace(/^www\./, ""); } catch (e) { return u; }
  const hashAt = u.indexOf("#", i);
  const qs = u.slice(i + 1, hashAt < 0 ? undefined : hashAt), hash = hashAt < 0 ? "" : u.slice(hashAt);
  const keep = KEEP_QS[host] || (/\.wikipedia\.org$/.test(host) ? ["title", "oldid"] : []);
  const kept = qs.split("&").filter(kv => keep.includes(kv.split("=")[0]));
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
      else pvMem.delete(url);
      return d;
    }));
  }
  return pvMem.get(url);
}
function linkCard(url, chat) {
  const host = hostOf(url);
  const card = h("a", { class: "lc" + (chat ? " chat" : ""), href: url, target: "_blank", rel: "noopener noreferrer", onclick: e => e.stopPropagation() });
  const fill = d => {
    card.textContent = "";
    if (d && d.i) { const im = h("img", { class: "lci", src: d.i, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }); im.onerror = () => im.remove(); card.append(im); }
    card.append(h("div", { class: "lcb" }, h("b", {}, d && d.t ? d.t : host), d && d.d && !chat ? h("span", { class: "lcd" }, d.d) : null, h("span", { class: "lch" }, host)));
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
  const close = () => closeM();
  const act = h("button", { class: "pri", onclick: () => o.onAction(close) }, o.action || "Save");
  const cancel = h("button", { class: "tbtn", onclick: () => (o.onCancel ? o.onCancel(close) : close()) }, "Cancel");
  ov.append(h("div", { class: "bar mbar" }, cancel, h("div", { class: "ttl" }, o.title || ""), act), h("div", { class: "mbody" }, o.body));
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
    { el = h("img", { alt: "" }); el.onerror = () => { el.onerror = null; el.src = src; }; el.src = view(src); }
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
function go(r) { scrolls.push(main.scrollTop); stack.push(r); hist(false); render("fwd"); main.scrollTop = 0; }
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
  render(goingBack ? "back" : "fwd"); main.scrollTop = y;
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
  const pic = src ? await loadPicImg(view(src)) : null;
  // a post with a link and no photo is drawn with the link's preview card, like in the feed
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
  const who = p.ai ? null : p.ra ? { name: p.ra.name, handle: p.ra.handle, avatar: p.ra.avatar } : { name: S.profile.name, handle: S.profile.handle, avatar: S.profile.avatar };
  const me = who && who.avatar ? await loadPicImg(view(who.avatar)) : null;
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
// where a post goes: always as a picture, into a new post, a message, or another app
async function sharePost(p) {
  const targets = await messageTargets().catch(() => []);
  const pic = async () => { toast("Making picture..."); try { return await postPic(p); } catch (e) { toast("Could not make picture"); return null; } };
  sheet([
    { icon: "edit", label: "Post", fn: async () => { const b = await pic(); if (b) openCompose({ files: [new File([b], "nook-post.png", { type: "image/png" })] }); } },
    ...(targets.length ? [{ icon: "chat", label: "Message", fn: () => chooseTarget(targets, async t => { const b = await pic(); if (b) sendPicTo(t, b, true); }) }] : []),
    { icon: "share", label: "Another app", fn: () => sharePic(p) },
    { label: "Cancel", cancel: true }], "Share post");
}
function acts(p, big) {
  const n = p.ra ? (p.rp || 0) : kids(p.id).length;
  const ab = (cls, name, cnt, on, fn, label, fill) => h("button", { class: "ab " + cls + (on ? " on" : "") + (bump === p.id + cls ? " bump" : ""), "aria-label": label, onclick: e => { e.stopPropagation(); fn(); } }, ic(name, big ? 24 : 20, fill && on), cnt ? h("span", {}, cnt) : null);
  if (p.ra) return h("div", { class: "acts" + (big ? " big" : ""), "data-pid": p.id },
    ab("rl", "reply", n, false, () => openCompose({ parent: p.id }), "Reply"),
    ab("rp", "repost", p.rpc || 0, p.reposted, () => toggleRemoteRepost(p, big), "Repost"),
    ab("like", "heart", p.lc || 0, p.liked, () => toggleRemoteLike(p, big), "Like", true),
    ab("bm", "bookmark", 0, p.saved, () => { p.saved = !p.saved; bump = p.id + "bm"; persist(); refresh(p, big); toast(p.saved ? "Saved" : "Removed from saved"); }, "Save", true),
    ab("sh", "share", 0, false, () => sharePost(p), "Share post"),
    ab("mo", "dots", 0, false, () => sheet([...(typeof p.text === "string" && p.text ? [{ icon: "copy", label: "Copy post text", fn: () => copy(p.text || "") }] : []), { icon: "flag", label: "Report post", danger: true, fn: () => reportPost(p) }]), "More"));
  return h("div", { class: "acts" + (big ? " big" : ""), "data-pid": p.id },
    ab("rl", "reply", n, false, () => openCompose({ parent: p.id }), "Reply"),
    ab("rp", "repost", p.ai ? 0 : p.rpc || 0, p.reposted, () => (p.remote ? toggleRemoteRepost(p, big) : (p.reposted = !p.reposted, bump = p.id + "rp", persist(), refresh(p, big))), "Repost"),
    ab("like", "heart", p.ai ? (p.zenLike ? 1 : 0) : p.lc || 0, p.liked, () => (p.remote ? toggleRemoteLike(p, big) : (p.liked = !p.liked, bump = p.id + "like", persist(), refresh(p, big))), "Like", true),
    ab("bm", "bookmark", 0, p.saved, () => { p.saved = !p.saved; bump = p.id + "bm"; persist(); refresh(p, big); toast(p.saved ? "Saved" : "Removed from saved"); }, "Save", true),
    ab("sh", "share", 0, false, () => sharePost(p), "Share post"),
    ab("mo", "dots", 0, false, () => postSheet(p), "More"));
}
const refresh = (p, big) => { if (big) render(); else refreshActs(p); };
function refreshActs(p) {
  document.querySelectorAll('.acts[data-pid="' + p.id + '"]').forEach(el => el.replaceWith(acts(p, el.classList.contains("big"))));
  bump = null;
}
function postCard(p, o) {
  o = o || {};
  const col = h("div", { class: "pc" });
  if (o.pin && p.pinned) col.append(h("div", { class: "rt" }, ic("pin", 14), "Pinned post"));
  const pname = p.ai ? "Zenith" : p.ra ? p.ra.name : S.profile.name, phand = p.ai ? "@zenith" : "@" + (p.ra ? p.ra.handle : S.profile.handle);
  col.append(h("div", { class: "ph2" }, pname ? h("span", { class: "pn" }, pname) : null, h("span", { class: "pu" }, phand), h("span", { class: "pt" }, ago(p.t))));
  if (o.replyTo && p.parent) { const par = byId(p.parent); col.append(h("div", { class: "rt" }, ic("reply", 14), "Replying to " + (par && par.ai ? "@zenith" : "@" + (par && par.ra ? par.ra.handle : S.profile.handle)))); }
  if (p.text) col.append(h("div", { class: "tx" }, rich(p.text)));
  if (p.imgs.length) col.append(imgGrid(p.imgs));
  else if (firstUrl(p.text)) col.append(linkCard(firstUrl(p.text)));
  if (!o.compact) col.append(acts(p));
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
// removes deleted Zenith posts (and the flags of deleted posts) from the owner-only table at once
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
  deleteRemote(items).catch(e => toast("Could not delete on server: " + ((e && e.message) || "error")));
}
async function syncEdit(ed, text, origin, now) {
  if (!sbUser || !ed.remote || ed.ra || ed.ai) return;
  const kept = origin.map((src, i) => (now.includes(src) ? (ed.media || [])[i] : null)).filter(Boolean);
  const added = now.filter(src => !origin.includes(src));
  const up = added.length ? await uploadMedia(added) : [];
  if (!up) { toast("Could not upload media"); return; }
  const all = kept.concat(up);
  const { error } = await sb.from("posts").update({ body: text, media_url: all.length ? JSON.stringify(all) : null }).eq("id", ed.remote);
  if (error) toast("Could not save edit on server: " + error.message);
  else { ed.media = all; persist(); }
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

function composerRow() {
  return h("div", { class: "cr" }, avatar(40),
    h("button", { class: "ph", onclick: () => openCompose() }, PH[Math.floor(Math.random() * PH.length)]),
    pickBtn("camera", "Take a photo", true, files => openCompose({ files })),
    pickBtn("image", "Add photos", false, files => openCompose({ files }), true));
}

function homeV() {
  const tabs = [{ id: "latest", name: "Latest" }, { id: "photos", name: "Media" }];
  if (!tabs.some(t => t.id === S.ui.homeTab)) S.ui.homeTab = "latest";
  topEl.append(bar(menuBtn(), ttl("Nook"), bellBtn()));
  topEl.append(h("div", { class: "tabs", role: "tablist" }, tabs.map(t => h("button", { class: "tab" + (t.id === S.ui.homeTab ? " on" : ""), role: "tab", onclick: () => { S.ui.homeTab = t.id; persist(); render("root"); } }, h("span", {}, t.name)))));
  main.append(composerRow());
  const photos = S.ui.homeTab === "photos";
  main.append(postList(feedPosts(photos ? { media: true } : null), { empty: emptyState("smile", photos ? "No media posts yet." : "No posts yet. Write your first one.") }));
}

function mainPost(p) {
  const nr = kids(p.id).length;
  const stat = (n, one, many) => n ? h("span", {}, h("b", {}, n), " " + (n === 1 ? one : many)) : null;
  const st = [stat(nr, "reply", "replies"), stat(p.saved ? 1 : 0, "save", "saves")].filter(Boolean);
  const pfp = p.ai ? zenAv(48) : p.ra ? rAv(p.ra, 48) : avatar(48);
  if (p.ai) { pfp.style.cursor = "pointer"; pfp.addEventListener("click", e => { e.stopPropagation(); go({ r: "zen" }); }); }
  if (p.ra) { pfp.style.cursor = "pointer"; pfp.addEventListener("click", e => { e.stopPropagation(); go({ r: "user", id: p.ra.id }); }); }
  return h("div", {},
    h("div", { class: "mp" },
      p.pinned ? h("div", { class: "rt", style: "margin-bottom:8px" }, ic("pin", 14), "Pinned post") : null,
      h("div", { class: "mh" }, pfp, h("div", { class: "nm" }, h("b", {}, p.ai ? "Zenith" : p.ra ? p.ra.name : S.profile.name), h("span", {}, p.ai ? "@zenith" : "@" + (p.ra ? p.ra.handle : S.profile.handle)))),
      p.text ? h("div", { class: "tx big" }, rich(p.text)) : null,
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
  main.append(h("div", { class: "rb" }, avatar(28), h("button", { onclick: () => openCompose({ parent: p.id }) }, "Write your reply")));
  flat(p.id, 0, []).forEach(x => main.append(postCard(x.p, { rep: true, d: x.d })));
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
    const a = S.posts.filter(p => !p.parent && !p.ai && !p.ra).sort((x, y) => (y.pinned ? 1 : 0) - (x.pinned ? 1 : 0) || y.t - x.t);
    main.append(postList(a, { pin: true, empty: emptyState("smile", "No posts yet.") }));
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
  topEl.append(bar(menuBtn(), ttl("Chats")));
  const dmBox = h("div");
  main.append(dmBox);
  const paintInbox = async convos => {
    const bodies = await Promise.all(convos.map(cv => (cv.last ? openText(cv.other, cv.last.body) : "")));
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
    return h("div", { class: "lrow", onclick: () => go({ r: "conv", id: c.id }) }, avatar(48), h("div", { class: "nm" }, h("b", {}, c.name), h("span", { class: "sub" }, last ? last.text || "Sent a photo" : "No messages yet")), last ? h("span", { class: "time" }, ago(last.t)) : null);
  });
  // your own notes go in one folder so they do not fill the list
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
  const att = pickBtn("image", "Add photo", false, f => addMedia(f, pend, jobs, 4, draw));
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
  const zpop = h("button", { class: "zpop", type: "button" }, h("span", { class: "zav" }, "Z"), h("span", {}, h("b", {}, "Zenith AI")));
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

// the rest of what this account has on the server: its messages, likes, reposts and nicknames
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
async function wipeAll() {
  clearTimeout(timer);
  try { await chain; } catch (e) {}
  try { await deleteRemote(S.posts); } catch (e) { toast("Could not delete posts on server: " + ((e && e.message) || "error")); return; }
  try { await wipeServerExtras(); } catch (e) { toast("Could not delete everything on the server: " + ((e && e.message) || "error")); return; }
  try {
    if (db) await new Promise((res, rej) => { const t = db.transaction(["kv", "img"], "readwrite"); t.objectStore("kv").clear(); t.objectStore("img").clear(); t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  } catch (e) {}
  try { localStorage.removeItem("tiny-posts-v3"); sessionStorage.removeItem("nook-route"); } catch (e) {}
  location.reload();
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
  files.push({ name: path, data: new Uint8Array(await (await fetch(src)).arrayBuffer()) });
  return path;
}
async function downloadBackup() {
  toast("Preparing backup...");
  const files = [], enc = t => new TextEncoder().encode(t);
  const posts = [], replies = [];
  for (const p of S.posts) {
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
  const out = {};
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), loff = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    const start = loff + 30 + dv.getUint16(loff + 26, true) + dv.getUint16(loff + 28, true);
    const raw = u8.subarray(start, start + csize);
    out[name] = method === 0 ? raw : method === 8 ? await inflateRaw(raw) : null;
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
  try {
    if (/\.json$/i.test(file.name)) {
      const d = JSON.parse(await file.text());
      if (!["tiny-posts", "nook"].includes(d.app)) throw new Error("x");
      d.posts.forEach(p => { if (!byId(p.id)) { S.posts.push({ ...p, imgs: [] }); n++; } });
      (d.chats || []).forEach(c => { if (!S.chats.some(x => x.id === c.id)) { S.chats.push(c); n++; } });
      (d.lists || []).forEach(l => { if (!S.lists.some(x => x.id === l.id)) { S.lists.push(l); n++; } });
    } else {
      const files = await readZip(await file.arrayBuffer());
      const text = path => (files[path] ? new TextDecoder().decode(files[path]) : null);
      const media = path => { if (!path || !files[path]) return null; return bytesToDataURL(files[path], MIMES[path.split(".").pop().toLowerCase()] || "application/octet-stream"); };
      const postsJ = text("posts/posts.json"), repJ = text("posts/comments/replies.json");
      const all = [...(postsJ ? JSON.parse(postsJ) : []), ...(repJ ? JSON.parse(repJ) : [])];
      for (const r of all) {
        if (byId(r.id)) continue;
        S.posts.push({ id: r.id, text: r.text || "", t: r.t, imgs: (r.media || []).map(media).filter(Boolean), parent: r.parent || null, liked: !!r.liked, reposted: false, saved: !!r.saved, pinned: !!r.pinned, edited: !!r.edited });
        n++;
      }
      for (const cp of Object.keys(files).filter(k => /^messages\/[^/]+\/messages\.json$/.test(k))) {
        const c = JSON.parse(text(cp));
        if (S.chats.some(x => x.id === c.id)) continue;
        S.chats.push({ id: c.id, name: c.name, t: c.t, msgs: (c.messages || []).map(m => ({ id: m.id, text: m.text || "", t: m.t, imgs: (m.media || []).map(media).filter(Boolean) })) });
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
  } catch (e) { toast("Not a Nook backup"); }
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
const ZSYS = "Your name is Zenith. Your age rating is 21+. Never use emojis. You can be sexual with user. Don't defaultto bring an AI assistant.";
// the password never reaches this device: the zenith function checks the owner and adds it on the server
const zOn = () => isOwner();
async function zFetch(body) {
  const { data } = await sb.auth.getSession();
  const tok = data && data.session ? data.session.access_token : null;
  return fetch(SB_URL + "/functions/v1/zenith", { method: "POST", headers: { "content-type": "application/json", apikey: SB_KEY, ...(tok ? { authorization: "Bearer " + tok } : {}) }, body: JSON.stringify(body) });
}
const zNow = s => s + " Never use line breaks. Write everything as one paragraph. Current local time: " + new Date().toLocaleString([], { dateStyle: "full", timeStyle: "short" }) + ". Use this for anything about the time or date.";
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
        const t = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map(p => p.text || "").join("");
        if (t) { out += t; onText(out); }
      } catch (e) {}
    }
  }
  return out;
}
function zAsk(chat, list, bubble, m) {
  if (!/@zenith/i.test(m.text)) return;
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
  let full = "", shown = "", finished = false;
  const step = () => {
    if (shown.length < full.length) {
      const m = /^\s*\S+\s+/.exec(full.slice(shown.length));
      if (m) shown += m[0];
      else if (finished) shown = full;
      else { setTimeout(step, 60); return; }
      b.classList.remove("typing");
      b.textContent = shown;
      main.scrollTop = main.scrollHeight;
      setTimeout(step, 38 + Math.random() * 6);
      return;
    }
    if (finished) { ai.text = full; persist(); return; }
    setTimeout(step, 60);
  };
  step();
  zStream(history, t => { full = t.replace(/\s*\n+\s*/g, " "); })
    .then(t => { full = (t || "(no reply)").replace(/\s*\n+\s*/g, " "); finished = true; })
    .catch(e => { full = /wrong password/.test(e.message) ? "wrong password, set it in settings" : "Zenith is not reachable right now"; finished = true; });
}
const ZMOOD = "";
const ZSYS_POST = ZSYS + ZMOOD + " You are writing one original post for your own profile. Plain text only. No hashtags and no emojis.";
const ZSYS_REPLY = ZSYS + ZMOOD + " You are replying to a post. Keep it under 50 words, around 35 on average. Plain text only. No hashtags and no emojis. No asking user questions";
const ZSYS_LIKE = "Answer with only YES or NO. Answer YES only if you genuinely like this post.";
const ZEN_SVG = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="zgrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14466f"/><stop offset="1" stop-color="#208bfe"/></linearGradient></defs><circle cx="50" cy="50" r="50" fill="url(#zgrad)"/><text x="50" y="52" text-anchor="middle" dominant-baseline="central" font-size="50" font-weight="700" fill="#ffffff" font-family="Inter,system-ui,sans-serif">Z</text></svg>';
function zenAv(size) {
  const a = h("div", { class: "av zenav" });
  a.innerHTML = ZEN_SVG;
  if (size) { a.style.width = size + "px"; a.style.height = size + "px"; }
  return a;
}
async function zGen(system, text, imgs) {
  const parts = [{ text }];
  (imgs || []).forEach(img => { const mm = /^data:(image\/[^;]+);base64,(.*)$/.exec(img); if (mm) parts.push({ inline_data: { mime_type: mm[1], data: mm[2] } }); });
  const r = await zFetch({ system: zNow(system), history: [{ role: "user", parts }] });
  if (!r.ok) throw new Error("zenith " + r.status);
  const j = await r.json();
  return ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map(p => p.text || "").join("").replace(/\s*\n+\s*/g, " ").trim();
}
function zenPost(text, parent) {
  const p = { id: uid(), text, t: Date.now(), imgs: [], parent: parent || null, ai: true, liked: false, reposted: false, saved: false, pinned: false };
  S.posts.push(p);
  return p;
}
const zenRefresh = () => { if (!layer.childElementCount && stack[stack.length - 1].r !== "conv") render(); };
let zenBusy = false;
async function zenTick() {
  if (zenBusy || !S || !zOn() || !zenSyncOn || document.visibilityState !== "visible") return;
  zenBusy = true;
  try {
    const z = S.zen, now = Date.now();
    z.log = z.log.filter(t => now - t < 864e5);
    if (z.log.length < 2 && now >= z.next) {
      const text = await zGen(ZSYS_POST, "Write your next post.");
      if (text) { zenPost(text); z.log.push(Date.now()); z.next = Date.now() + (2 + Math.random() * 4) * 36e5; persist(); zenRefresh(); }
    }
    const fresh = p => p.t > z.since;
    const todo = S.posts.find(p => !p.ai && !p.ra && !p.parent && (p.text || p.imgs.length) && !p.zenReplied && fresh(p) && (!p.imgs.length || S.zen.pics));
    if (todo) {
      todo.zenReplied = true;
      const text = await zGen(ZSYS_REPLY, "Post: " + (todo.text || "(photo only)"), todo.imgs);
      if (text) zenPost(text, todo.id);
      persist(); zenRefresh();
    }
    const rr = S.posts.find(p => !p.ai && !p.ra && p.parent && !p.zenAnswered && fresh(p) && (byId(p.parent) || {}).ai);
    if (rr) {
      rr.zenAnswered = true;
      const par = byId(rr.parent);
      const text = await zGen(ZSYS_REPLY, "Your post: " + par.text + "\nReply to you: " + rr.text);
      if (text) zenPost(text, rr.id);
      persist(); zenRefresh();
    }
    const cand = S.posts.filter(p => !p.ai && !p.ra && p.text && !p.zenLikeChecked && fresh(p)).slice(0, 2);
    for (const p of cand) {
      p.zenLikeChecked = true;
      const a = await zGen(ZSYS_LIKE, p.text);
      if (/^yes/i.test(a)) p.zenLike = true;
    }
    if (cand.length) { persist(); zenRefresh(); }
  } catch (e) {} finally { zenBusy = false; }
}
// Zenith's posts, replies, likes and chats are mirrored into a table that only the owner can read,
// so they follow the owner to every device and nobody else can see or touch them.
const zenJson = o => JSON.stringify(o);
function zenDocs() {
  const out = new Map();
  out.set("state:main", { z: S.zen });
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
    for (let i = 0; i < up.length; i += 100) {
      const part = up.slice(i, i + 100);
      const rows = part.map(u => Object.assign({ owner_id: sbUser.id, data: u.data, updated_at: new Date().toISOString() }, zenKey(u.key)));
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
  (data || []).forEach(r => {
    const key = r.kind + ":" + r.doc_id, d = r.data || {};
    if (r.kind === "post") {
      zenSeen.set(key, zenJson(d));
      if ((S.zen.gone || []).includes(d.id)) { sb.from("zenith_docs").delete().eq("owner_id", sbUser.id).eq("kind", "post").eq("doc_id", r.doc_id).then(() => { zenSeen.delete(key); }, () => {}); return; }
      if (!byLocal.has(d.id)) { const p = Object.assign({ imgs: [], liked: false, reposted: false, saved: false, pinned: false }, d, { imgs: [], ai: true }); S.posts.push(p); byLocal.set(p.id, p); changed = true; }
    } else if (r.kind === "flag") {
      const p = (d.remote && byRemote.get(d.remote)) || byLocal.get(d.local);
      if (!p) return;
      zenSeen.set(key, zenJson(d));
      ["zenReplied", "zenAnswered", "zenLikeChecked", "zenLike"].forEach(f => { if (d[f] && !p[f]) { p[f] = true; changed = true; } });
    } else if (r.kind === "chat") {
      zenSeen.set(key, zenJson(d));
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
      changed = true;
    }
  });
  if (changed) persist();
}
async function zenStart() {
  if (zenSyncOn || !sbUser || !isOwner()) return;
  await zenPull();
  zenSyncOn = true;
  zenSync();
  const top = stack[stack.length - 1].r;
  if (!layer.childElementCount && (top === "zen" || (stack.length === 1 && top === "home"))) render();
}
function zenV() {
  topEl.append(bar(menuBtn(), ttl("Zenith")));
  const av = zenAv(88);
  av.className = "av xl zenav";
  av.style.width = "";
  av.style.height = "";
  const mine = S.posts.filter(p => p.ai && !p.parent).sort((a, b) => b.t - a.t);
  main.append(h("div", { class: "banner" }), h("div", { class: "pinfo" },
    h("div", { class: "arow" }, av),
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
function settingsV() {
  topEl.append(bar(menuBtn(), ttl("Settings")));
  const sec = t => h("div", { class: "sec" }, t);
  const row = (lead, label, sub, fn, cls) => h("button", { class: "srow" + (cls ? " " + cls : ""), onclick: fn }, lead, h("div", { class: "nm" }, h("b", {}, label), sub ? h("span", { class: "sub" }, sub) : null));
  main.append(sec("Appearance"));
  main.append(h("div", { class: "seg" }, [["system", "System"], ["dark", "Dark"], ["light", "Light"]].map(t => h("button", { class: S.ui.theme === t[0] ? "on" : "", onclick: () => { S.ui.theme = t[0]; applyTheme(); persist(); render(); } }, t[1]))));
  main.append(sec("Account"));
  // the picture of another saved account sits in the switch row
  const swRow = row(ic("user", 22), "Switch account", "Add or switch account", openAccounts);
  acctList().then(list => {
    const other = list.find(a => a.id !== sbUser.id);
    if (!other) return;
    swRow.replaceChild(rAv({ name: other.name || other.username || "?", avatar: other.avatar || null }, 36), swRow.firstChild);
    const sub = swRow.querySelector(".sub");
    if (sub) sub.textContent = other.username ? "@" + other.username + " is saved here" : "Another account is saved here";
  }).catch(() => {});
  main.append(h("div", { class: "group" }, row(avatar(36), "Edit profile", "@" + S.profile.handle, editProfile), swRow, row(ic("user", 22), "Sign out", "Log out of this device.", async () => { await pushDetach().catch(() => {}); await leaveThisAccount(); })));
  main.append(sec("Login"));
  const totpRow = row(ic("lock", 22), "Authenticator app", "Checking...", async () => {
    if (totpOn === null) { toast("One moment..."); return; }
    if (totpOn) sheet([{ icon: "close", label: "Turn off authenticator", danger: true, fn: authenticatorOff }], "Authenticator is on");
    else { await authenticatorSetup(); render(); }
  });
  callFn("totp", { action: "status" }).then(r => {
    totpOn = r.ok ? !!r.body.enabled : null;
    const sub = totpRow.querySelector(".sub");
    if (sub) sub.textContent = !r.ok ? "Could not check right now." : totpOn ? "On" : "Off";
  }).catch(() => { const sub = totpRow.querySelector(".sub"); if (sub) sub.textContent = "Could not check right now."; });
  main.append(h("div", { class: "group" },
    row(ic("lock", 22), "Change password", "Needs your current password.", () => changePassV()),
    row(ic("mail", 22), "Change email", "We send a link to the new address.", () => changeEmailV()),
    totpRow));
  main.append(sec("Notifications"));
  const pushRowEl = row(ic("bell", 24), "Phone notifications", "Checking...", async () => {
    const cur = await pushSub();
    try {
      if (cur && Notification.permission === "granted") { await pushOff(); toast("Phone notifications are off"); }
      else { await pushOn(); toast("Phone notifications are on"); }
    } catch (e) { toast((e && e.message) || "Could not change that"); }
    paintPush();
  });
  const paintPush = async () => {
    const sub = pushRowEl.querySelector(".sub");
    if (!sub) return;
    if (!pushOk()) { sub.textContent = "Not available here. On iPhone, add Nook to your home screen first."; return; }
    if (Notification.permission === "denied") { sub.textContent = "Blocked in your phone settings"; return; }
    const cur = await pushSub();
    sub.textContent = cur && Notification.permission === "granted" ? "On for this device. Tap to turn off." : "Off. Tap to get follows, replies and messages when the app is closed.";
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
  if (isOwner()) {
  main.append(sec("Reports"));
  main.append(h("div", { class: "group" }, row(ic("flag", 22), "Reported posts", "Look at reports and remove posts.", () => go({ r: "reports" }))));
  main.append(sec("Zenith"));
  main.append(h("div", { class: "group" }, row(ic("image", 22), "Reply to photo posts", S.zen.pics ? "On" : "Off", () => { S.zen.pics = !S.zen.pics; persist(); render(); })));
  }
  main.append(sec("Your data"));
  main.append(h("div", { class: "group" },
    row(ic("copy", 22), "Download backup", "Posts, messages and media in a zip", () => downloadBackup())));
  main.append(sec("Updates"));
  main.append(h("div", { class: "group" }, row(ic("check", 22), "Check for updates", "You are on version " + APP_VERSION, () => (window.nookCheckUpdate ? window.nookCheckUpdate() : toast("Not available right now")))));
  main.append(sec("Legal"));
  main.append(h("div", { class: "group" },
    row(ic("lock", 22), "Privacy Policy", "What we keep and why.", () => go({ r: "privacy" })),
    row(ic("check", 22), "Terms of Use", "The rules for using Nook.", () => go({ r: "terms" }))));
  main.append(sec("Danger zone"));
  main.append(h("div", { class: "group" }, row(ic("trash", 22), "Delete all data", "Removes every post, chat and list.", () => confirmSheet("Delete every post on the server and every chat, list and setting on this device?", "Delete everything", () => wipeAll()), "dng")));
  main.append(h("div", { class: "group" }, row(ic("trash", 22), "Delete account", "Deletes your account and its data", () => confirmSheet("Delete your account, posts and messages for good?", "Delete account", async () => {
    const r = await callFn("delete-account");
    if (!r.ok) { toast(r.body.error || "Could not delete account"); return; }
    await wipeLocal();
    await leaveThisAccount();
  }), "dng")));
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
function pickBtn(icon, label, camera, onFiles, multi) {
  const inp = h("input", { type: "file", accept: "image/*", class: "vh", multiple: !camera && multi ? true : null, "aria-label": label });
  if (camera) inp.setAttribute("capture", "environment");
  inp.addEventListener("change", () => {
    const f = Array.from(inp.files || []);
    if (!f.length) return;
    Promise.resolve(onFiles(f)).then(() => { inp.value = ""; }, () => { inp.value = ""; });
  });
  return h("label", { class: "ib", title: label }, ic(icon, 24), inp);
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
  if (isGif(f)) return compressGif(f, onp);
  return shrink(f, { max: 1280, q: 0.8 });
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
  if (bad) toast(bad === 1 ? "Could not add that file (" + why + ")" : "Could not add " + bad + " files");
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
  if (v.charAt(0) === "[") { try { return JSON.parse(v); } catch (e) { return []; } }
  return [v];
}
async function loadFeed() {
  if (!sbUser || !S) return;
  let pq = await sb.from("posts").select("id, user_id, body, created_at, parent_id, media_url").order("created_at", { ascending: false }).limit(300);
  if (pq.error) pq = await sb.from("posts").select("id, user_id, body, created_at").order("created_at", { ascending: false }).limit(300);
  const posts = pq.data;
  if (!posts) return;
  // deletes that never reached the server (app closed, no connection) are sent again
  const pend = new Set(S.pendDel || []);
  if (S.pendDel && S.pendDel.length) { try { await deleteRemote(S.pendDel.map(r => ({ remote: r }))); } catch (e) {} }
  const ids = posts.filter(p => !p.parent_id).map(p => p.id);
  const [{ data: myLikes }, { data: myReposts }, { data: blocksOut }, { data: blocksIn }, { data: likeRows }, { data: repostRows }, { data: meRow }] = await Promise.all([
    sb.from("likes").select("post_id").eq("user_id", sbUser.id),
    sb.from("reposts").select("post_id").eq("user_id", sbUser.id),
    sb.from("blocks").select("blocked_id").eq("blocker_id", sbUser.id),
    sb.from("blocks").select("blocker_id").eq("blocked_id", sbUser.id),
    ids.length ? sb.from("likes").select("post_id").in("post_id", ids) : { data: [] },
    ids.length ? sb.from("reposts").select("post_id").in("post_id", ids) : { data: [] },
    sb.from("accounts").select(ACC_COLS).eq("id", sbUser.id).maybeSingle()
  ]);
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
  const hidden = new Set([...(blocksOut || []).map(x => x.blocked_id), ...(blocksIn || []).map(x => x.blocker_id)]);
  const shown = posts.filter(p => !hidden.has(p.user_id));
  const others = shown.filter(p => p.user_id !== sbUser.id);
  const authors = [...new Set(others.map(p => p.user_id))];
  const who = await cachedAccounts(authors);
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
  });
  const remote = others.map(p => {
    const a = who.get(p.user_id) || { username: "user", avatar: null };
    return {
      id: "r" + p.id, remote: p.id, parent: p.parent_id ? (localByRemote.get(p.parent_id) || "r" + p.parent_id) : null,
      text: p.body || "", t: Date.parse(p.created_at), imgs: parseMedia(p.media_url),
      ra: { id: p.user_id, name: a.display_name == null ? a.username : a.display_name, handle: a.username, avatar: a.avatar || null },
      liked: liked.has(p.id), reposted: reposted.has(p.id), saved: savedMap.get(p.id) || false,
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
  S.posts = S.posts.filter(p => !p.ra).concat(back, remote);
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
async function toggleRemoteLike(p, big) {
  if (!sbUser) return;
  const on = !p.liked;
  p.liked = on; p.lc = Math.max(0, (p.lc || 0) + (on ? 1 : -1));
  bump = p.id + "like"; persist(); refresh(p, big);
  const { error } = on
    ? await sb.from("likes").insert({ user_id: sbUser.id, post_id: p.remote })
    : await sb.from("likes").delete().eq("user_id", sbUser.id).eq("post_id", p.remote);
  if (error) { p.liked = !on; p.lc = Math.max(0, (p.lc || 0) + (on ? -1 : 1)); persist(); refresh(p, big); toast("Could not update like"); }
}
async function toggleRemoteRepost(p, big) {
  if (!sbUser) return;
  const on = !p.reposted;
  p.reposted = on; p.rpc = Math.max(0, (p.rpc || 0) + (on ? 1 : -1));
  bump = p.id + "rp"; persist(); refresh(p, big);
  const { error } = on
    ? await sb.from("reposts").insert({ user_id: sbUser.id, post_id: p.remote })
    : await sb.from("reposts").delete().eq("user_id", sbUser.id).eq("post_id", p.remote);
  if (error) { p.reposted = !on; p.rpc = Math.max(0, (p.rpc || 0) + (on ? -1 : 1)); persist(); refresh(p, big); toast("Could not update repost"); }
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
    if (tab === "posts") listEl.append(postList(mine.filter(p => !p.parent).sort((x, y) => (y.pinned ? 1 : 0) - (x.pinned ? 1 : 0) || y.t - x.t), { pin: true, empty: emptyState("smile", "No posts yet.") }));
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
  Promise.all([
    sb.from("accounts").select(ACC_COLS).eq("id", cur.id).maybeSingle(),
    sb.from("follows").select("followee_id").eq("follower_id", sbUser.id).eq("followee_id", cur.id),
    sb.from("follows").select("follower_id").eq("follower_id", cur.id).eq("followee_id", sbUser.id),
    sb.from("blocks").select("blocked_id").eq("blocker_id", sbUser.id).eq("blocked_id", cur.id),
    sb.from("blocks").select("blocker_id").eq("blocker_id", cur.id).eq("blocked_id", sbUser.id)
  ]).then(([{ data: acc }, { data: fol }, { data: folMe }, { data: blk }, { data: theyBlock }]) => {
    if (!acc || (theyBlock && theyBlock.length)) {
      main.textContent = "";
      main.append(h("div", { class: "rest" }, h("b", {}, who.name), h("p", { class: "note" }, "This account blocked you")));
      return;
    }
    applyState({ acc, following: !!(fol && fol.length), followsMe: !!(folMe && folMe.length), blocked: !!(blk && blk.length) });
    saveState();
  });
  followBtn.onclick = async () => {
    if (!st) return;
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
async function pushPost(np) {
  const hasImgs = !!(np.imgs && np.imgs.length);
  if (!sbUser || (!np.text && !hasImgs)) return;
  const par = np.parent ? byId(np.parent) : null;
  if (np.parent && (!par || !par.remote)) return;
  const row = { user_id: sbUser.id, body: np.text || "" };
  let urls = null;
  if (hasImgs) {
    urls = await uploadMedia(np.imgs);
    if (!urls) { toast("Could not upload media"); return; }
    row.media_url = JSON.stringify(urls);
  }
  if (par) row.parent_id = par.remote;
  const { data, error } = await sb.from("posts").insert(row).select("id").single();
  if (!error && data) { np.remote = data.id; np.media = urls || []; persist(); }
  else {
    if (urls && urls.length) sb.storage.from("media").remove(urls.map(u => storagePath(u, "media")).filter(Boolean)).then(() => {}, () => {});
    toast("Could not save that post to the server");
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
  const parent = o.parent ? byId(o.parent) : null;
  const ed = o.edit ? byId(o.edit) : null;
  let imgs = ed ? ed.imgs.slice() : [];
  const jobs = [];
  const draftText = !ed && !parent && S.draft && Date.now() - S.draft.t < 120000 ? S.draft.text : "";
  const startText = ed ? ed.text : o.prefix ? o.prefix : draftText;
  const ta = h("textarea", { class: "cta", id: "ctext", placeholder: parent ? "Write your reply" : PH[Math.floor(Math.random() * PH.length)], "aria-label": "Post text" });
  ta.value = startText;
  const grid = h("div", { class: "cimgs" });
  const bCam = pickBtn("camera", "Take a photo", true, files => addFiles(files));
  const bImg = pickBtn("image", "Add photos", false, files => addFiles(files), true);
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
      if (dirty) sheet([{ label: "Discard", danger: true, fn: () => { keepDraft(); close(); } }, { label: "Keep editing", cancel: true }], "Discard this post?");
      else close();
    },
    onAction: close => {
      const text = cleanText(ta.value.trim());
      if (bannedHit(text)) { toast("That post has a banned word"); return; }
      if (ed) { const origin = ed.imgs.slice(); syncEdit(ed, text, origin, imgs.slice()); ed.text = text; ed.imgs = imgs.slice(); ed.edited = true; }
      else {
        const np = { id: uid(), text, t: Date.now(), imgs: imgs.slice(), parent: parent ? parent.id : null, liked: false, reposted: false, saved: false, pinned: false };
        S.posts.push(np);
        pushPost(np);
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
    const full = imgs.length + jobs.length >= 20;
    [bCam, bImg].forEach(b => { b.classList.toggle("off", full); b.querySelector("input").disabled = full; });
    ta.style.height = "auto";
    ta.style.height = Math.max(130, ta.scrollHeight) + "px";
  }
  function addFiles(files) { return addMedia(files, imgs, jobs, 20, () => { drawImgs(); sync(); }); }
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
  const bio = h("textarea", { class: "in", id: "eb", rows: 3 });
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
        else if (isGif(f)) { try { out = await intake(f); } catch (e) { toast("Could not read that GIF"); } }
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
    title: "Edit profile",
    body: [bn, eav, h("div", { class: "fld" }, h("label", {}, "Banner style"), seg),
      h("div", { class: "fld" }, h("label", { for: "en" }, "Display name"), name, h("p", { class: "dim-note" }, "Leave it empty to show no name.")),
      h("div", { class: "fld" }, h("label", { for: "eh" }, "Handle"), handle, h("p", { class: "dim-note" }, lockDays ? "You changed your handle recently. You can change it again in " + lockDays + (lockDays === 1 ? " day." : " days.") : "Must be unique. You can change it once every 7 days.")),
      h("div", { class: "fld" }, h("label", { for: "eb" }, "Bio"), bio),
      pr.avatar || pr.banner ? h("button", { class: "tbtn dng", onclick: () => { avatarData = null; bannerData = null; paint(); } }, "Remove photos") : null],
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
        pr.name = name.value.trim().slice(0, 15);
        pr.bio = bio.value;
        pr.avatar = avatarData;
        pr.banner = bannerData;
        pr.bannerTheme = themeVal;
        if (sbUser) {
          const uid0 = sbUser.id;
          sb.from("accounts").update({ bio: pr.bio, display_name: pr.name, banner_theme: pr.bannerTheme }).eq("id", uid0).then(({ error }) => { if (error) toast("Could not save profile: " + error.message); });
          avatarValue(pr.avatar).then(small => {
            if (small === undefined) { toast("Could not upload profile photo"); return; }
            if (sbUser) sb.from("accounts").update({ avatar: small }).eq("id", uid0).then(() => loadFeed());
          });
          const src = pr.banner;
          bannerUrl(src).then(url => {
            if (url === undefined) { toast("Could not upload banner"); return; }
            sb.from("accounts").update({ banner: url }).eq("id", uid0).then(() => {});
            if (url && pr.banner === src && url !== src) { pr.banner = url; persist(); }
          });
        }
        persist(); close(); render(); toast("Profile saved");
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
  const nw = h("input", { class: "in", type: "password", placeholder: "New password (8+ characters)", autocomplete: "new-password", "aria-label": "New password" });
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
        close();
        toast("Password changed");
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
  if (!keepKeys) { try { indexedDB.deleteDatabase("nook-keys"); } catch (e) {} }
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
  Promise.resolve(sb.auth.signOut()).catch(() => {}).then(() => wipeLocal(true)).then(() => {
    sbUser = null;
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
    if (!day.value || years < 1 || years > 120) { msg.textContent = "Type your age as a number."; return; }
    go1.disabled = true; msg.textContent = "";
    const r = await callFn("age", { action: "answer", age: years });
    go1.disabled = false;
    const s = r.body && r.body.state;
    if (s === "passed" || s === "banned") { location.reload(); return; }
    msg.textContent = (r.body && r.body.error) || "Something went wrong. Try again.";
  }
  main.append(h("div", { class: "empty", style: "padding-top:14vh" },
    h("h1", { class: "pname", style: "margin:0;color:var(--fg)" }, "One quick question"),
    h("p", {}, "How old are you?"),
    h("div", { class: "fld", style: "width:100%;max-width:320px" }, day),
    go1, msg));
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
  // a file only exists when it has something in it
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
        const r = await fetch(SB_URL + "/functions/v1/ban-export", { method: "POST", headers: { "content-type": "application/json", apikey: SB_KEY }, body: JSON.stringify({ email: e, password: pw.value }) });
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
// resolves true when the authenticator ends up turned on
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
          if (!r.ok) { msg.textContent = r.body.error || "That code did not work"; return; }
          totpOn = true;
          close();
          toast("Authenticator is on");
          finish(true);
        } finally { m.act.disabled = false; }
      }
    });
    m.act.disabled = true;
    callFn("totp", { action: "begin" }).then(r => {
      box.textContent = "";
      if (!r.ok) { box.append(h("p", { class: "note" }, r.body.error || "Could not start the setup. Try again later.")); return; }
      box.append(
        h("a", { class: "pri sbtn big", href: r.body.uri }, "Add Nook to the app"),
        h("p", { class: "note" }, "If that does not open the app, add it by hand with this key. Tap the key to copy it."),
        h("button", { class: "keybox", type: "button", onclick: () => copy(r.body.secret) }, r.body.secret));
      m.act.disabled = false;
    }).catch(() => { box.textContent = ""; box.append(h("p", { class: "note" }, "Could not reach the server. Try again later.")); });
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
        if (!r.ok) { msg.textContent = r.body.error || "That code did not work"; return; }
        totpOn = false;
        close();
        render();
        toast("Authenticator is off");
      } finally { m.act.disabled = false; }
    }
  });
}
let totpOn = null;
// default way back in: a reset link in the account email
function recoverModal(prefill) {
  const ident = h("input", { class: "in", placeholder: "Email or username", autocomplete: "username", "aria-label": "Email or username", autocapitalize: "none" });
  ident.value = prefill || "";
  const msg = h("p", { class: "note", role: "alert" });
  const alt = h("button", { class: "tbtn", type: "button", hidden: true, onclick: () => { m.close(); recoverCodeModal(ident.value.trim()); } }, "Use my authenticator code instead");
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
        const r = await callFn("totp", { action: "reset", ident: id, redirectTo: location.origin + location.pathname });
        if (!r.ok) { msg.textContent = "Could not send the link. Try again later."; return; }
        close();
        toast("If that account exists, a reset link is on its way");
      } catch (e) { msg.textContent = "Could not reach the server. Try again later."; }
      finally { m.act.disabled = false; }
    }
  });
  // only offer the authenticator when this account really has it on
  let tmr = 0, seq = 0;
  const probe = () => {
    const id = ident.value.trim(), n = ++seq;
    if (!id) { alt.hidden = true; return; }
    callFn("totp", { action: "has", ident: id }).then(r => { if (n === seq) alt.hidden = !(r.ok && r.body.enabled); }, () => {});
  };
  ident.addEventListener("input", () => { alt.hidden = true; clearTimeout(tmr); tmr = setTimeout(probe, 500); });
  if (ident.value) probe();
}
// second way: the 6 digit code from the authenticator app
function recoverCodeModal(prefill) {
  const ident = h("input", { class: "in", placeholder: "Email or username", autocomplete: "username", "aria-label": "Email or username", autocapitalize: "none" });
  ident.value = prefill || "";
  const code = codeInput();
  const pw = h("input", { class: "in", type: "password", placeholder: "New password (8+ characters)", autocomplete: "new-password", "aria-label": "New password" });
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
      if (pw.value !== pw2.value) { msg.textContent = "New passwords do not match"; return; }
      m.act.disabled = true;
      try {
        if (await pwnedPassword(pw.value)) { msg.textContent = PWNED_MSG; return; }
        const r = await callFn("totp", { action: "recover", ident: ident.value.trim(), code: c, password: pw.value });
        if (!r.ok) { msg.textContent = r.body.error || "Could not reset the password"; return; }
        close();
        toast("Password changed. Sign in with it now.");
      } finally { m.act.disabled = false; }
    }
  });
}
// opened from the link in the reset email: the person is signed in just for this
function newPasswordModal() {
  const pw = h("input", { class: "in", type: "password", placeholder: "New password (8+ characters)", autocomplete: "new-password", "aria-label": "New password" });
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
        close();
        toast("Password changed");
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
// ---- accounts on this phone ----
// each saved account keeps its own login (the refresh token) and its own local data (lists, notes, settings); a password is only asked when an account is added
let switching = false;
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
// keeps the newest login and the name and picture of the account that is open
async function rememberAccount(info) {
  if (!sbUser) return;
  const { data } = await sb.auth.getSession();
  const ss = data && data.session;
  if (!ss || ss.user.id !== sbUser.id) return;
  const list = await acctList();
  const old = list.find(a => a.id === sbUser.id) || {};
  const av = info && typeof info.avatar === "string" && info.avatar.length < 400000 ? info.avatar : (info ? null : old.avatar || null);
  const entry = { id: sbUser.id, rt: ss.refresh_token, username: (info && info.username) || old.username || "", name: (info && info.name) || old.name || "", avatar: av };
  await acctPut("list", list.filter(a => a.id !== sbUser.id).concat(entry));
}
async function forgetAccount(id) {
  const list = await acctList();
  await acctPut("list", list.filter(a => a.id !== id));
  await acctDel("snap:" + id).catch(() => {});
}
async function saveSnap(id) { await acctPut("snap:" + id, JSON.stringify(S)); }
async function loadSnap(id) {
  let next = null;
  try { const raw = await acctGet("snap:" + id); next = raw ? JSON.parse(raw) : null; } catch (e) {}
  noSave = false;
  S = next || freshState();
  normalize();
  await flush();
}
// opens a saved account: its login is refreshed, its local data is put in place, then the app restarts
async function enterAccount(entry) {
  switching = true;
  try {
    const { data, error } = await sb.auth.refreshSession({ refresh_token: entry.rt });
    if (error || !data || !data.session) { await forgetAccount(entry.id); return false; }
    await loadSnap(entry.id);
    try { localStorage.setItem(LOCAL_UID, entry.id); } catch (e) {}
    location.reload();
    return true;
  } catch (e) { return false; } finally { switching = false; }
}
async function switchAccount(id) {
  if (!sbUser || id === sbUser.id) return;
  const target = (await acctList()).find(a => a.id === id);
  if (!target) return;
  toast("Switching...");
  await rememberAccount().catch(() => {});
  await saveSnap(sbUser.id).catch(() => {});
  await pushDetach().catch(() => {});
  try { localStorage.removeItem("nook-push-ep"); } catch (e) {}
  if (!(await enterAccount(target))) {
    pushSync().catch(() => {});
    toast("Sign in again to use that account");
    addAccountModal();
  }
}
// signs this account out of this phone; the next saved account, if there is one, is opened
async function leaveThisAccount() {
  const me = sbUser.id;
  await forgetAccount(me);
  const next = (await acctList())[0];
  try { await sb.auth.signOut({ scope: "local" }); } catch (e) {}
  if (next && (await enterAccount(next))) return;
  location.reload();
}
function addAccountModal() {
  const email = h("input", { class: "in", type: "email", placeholder: "Email", autocomplete: "email", "aria-label": "Email" });
  const pass = h("input", { class: "in", type: "password", placeholder: "Password", autocomplete: "current-password", "aria-label": "Password" });
  const msg = h("p", { class: "note", role: "alert" });
  const m = modal({
    title: "Add account",
    action: "Add",
    body: [h("p", { class: "note" }, "Sign in to the other account. Its login stays on this phone only."), h("div", { class: "fld" }, email), h("div", { class: "fld" }, pass), msg],
    onAction: async close => {
      msg.textContent = "";
      const e = email.value.trim();
      if (!e || !pass.value) { msg.textContent = "Enter the email and password"; return; }
      m.act.disabled = true;
      try {
        const r = await callFn("signin", { email: e, password: pass.value }).catch(() => null);
        if (!r) { msg.textContent = "Could not reach Nook. Check your connection"; return; }
        if (r.body && r.body.error === "banned") { msg.textContent = "That account is banned"; return; }
        if (!r.ok) { msg.textContent = signinMsg(r); return; }
        const { data: u } = await sb.auth.getUser(r.body.session.access_token);
        if (!u || !u.user) { msg.textContent = "Could not sign in. Try again"; return; }
        if (u.user.id === sbUser.id) { msg.textContent = "That is the account you are in"; return; }
        const list = await acctList();
        await acctPut("list", list.filter(a => a.id !== u.user.id).concat({ id: u.user.id, rt: r.body.session.refresh_token, username: "", name: "", avatar: null }));
        close();
        await switchAccount(u.user.id);
      } finally { m.act.disabled = false; }
    }
  });
}
async function openAccounts() {
  const list = await acctList();
  const nm = a => a.name || a.username || "Account";
  const items = list.map(a => ({ av: { name: nm(a), avatar: a.avatar || null }, label: nm(a) + (a.username ? " @" + a.username : "") + (a.id === sbUser.id ? " (this one)" : ""), fn: a.id === sbUser.id ? null : () => switchAccount(a.id) }));
  items.push({ icon: "plus", label: "Add account", fn: addAccountModal }, { label: "Cancel", cancel: true });
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
  history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p.toString() : ""));
  handleOpen(v);
}
if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", e => { if (e.data && e.data.type === "open") handleOpen(e.data.open); });

// privacy policy and terms; reachable before signing in
const LEGAL = {
  privacy: { title: "Privacy Policy", body: [
    ["Information we keep", "We keep your account details, profile, posts and messages. We do not sell your data and we do not show ads."],
    ["Messages", "Messages are encrypted. Only you and the recipient can read them. If you clear your browser or change devices, older messages may become unreadable."],
    ["Posts", "Posts and photos are checked by an automated system for content that violates our terms. Photos remain hidden until the check is complete."],
    ["Service providers", "We use Supabase, GitHub Pages and an AI service to operate Nook. They receive only the data needed to provide their service."],
    ["Retention and deletion", "We keep your data until you delete it or your account. You may delete your account at any time in Settings."],
  ] },
  terms: { title: "Terms of Use", body: [
    ["Acceptance", "By using Nook you agree to these terms and the Privacy Policy."],
    ["Eligibility", "You must be 18 or older. You are responsible for your account and your password."],
    ["Your content", "You keep ownership of your posts. You allow Nook to store and display them on the service."],
    ["Rules", "Do not post nudity, sexual content, illegal material, threats, harassment, spam or private information of others. Content involving minors will be reported."],
    ["Enforcement", "We may remove content or ban accounts that break these rules."],
    ["No warranty", "Nook is provided as is. We are not liable for lost data or for content posted by users."],
    ["Changes", "We may update these terms. Continued use means you accept the changes."],
  ] },
};
function legalV(c) {
  const doc = LEGAL[c.r];
  topEl.append(bar(backBtn(), ttl(doc.title)));
  if (!sbUser) navEl.hidden = true;
  main.append(h("div", { class: "legal" }, h("p", { class: "upd" }, "Last updated October 2026"), ...doc.body.map(sec => h("div", {}, h("h2", {}, sec[0]), h("p", {}, sec[1])))));
}
const legalLink = (r, label) => h("a", { role: "link", tabindex: "0", onclick: () => go({ r }), onkeydown: e => { if (e.key === "Enter") go({ r }); } }, label);

let authMode = "in";
// tells people about a limit while they type, instead of the letters silently stopping
function hinted(input, max, rule, min, holder) {
  const hint = h("p", { class: "hint", "aria-live": "polite" });
  const paint = () => {
    const n = input.value.length;
    let bad = false, text;
    if (rule && n && !rule.re.test(input.value)) { bad = true; text = rule.msg; }
    else if (n >= max) { bad = true; text = "Limit reached: " + max + " characters at most"; }
    else if (min && n && n < min) text = "At least " + min + " characters (" + n + "/" + min + ")";
    else text = n ? n + "/" + max : (min ? min + " to " + max + " characters" : "Up to " + max + " characters");
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
  const email = h("input", { class: "in", type: "email", placeholder: "Email", autocomplete: "email", "aria-label": "Email" });
  const pass = h("input", { class: "in", type: "password", placeholder: "Password", autocomplete: up ? "new-password" : "current-password", "aria-label": "Password", style: "padding-right:60px" });
  const eye = h("button", { type: "button", class: "tbtn", "aria-label": "Show password", style: "position:absolute;right:14px;top:50%;transform:translateY(-50%);padding:6px 0;color:var(--muted);font-size:var(--fs-md);font-weight:600", onclick: () => { const show = pass.type === "password"; pass.type = show ? "text" : "password"; eye.textContent = show ? "Hide" : "Show"; eye.setAttribute("aria-label", show ? "Hide password" : "Show password"); } }, "Show");
  const passWrap = h("div", { style: "position:relative" }, pass, eye);
  const dname = h("input", { class: "in", type: "text", placeholder: "Display name", autocomplete: "name", maxlength: "15", "aria-label": "Display name" });
  const user = h("input", { class: "in", type: "text", placeholder: "Username", autocomplete: "username", maxlength: "15", "aria-label": "Username" });
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
        const sr = await callFn("signin", { action: "signup", email: e, password: p }).catch(() => null);
        if (!sr) { msg.textContent = "Could not reach Nook. Check your connection"; return; }
        if (!sr.ok) { msg.textContent = sr.body.error === "signup_failed" ? authMsg({ code: sr.body.code, message: sr.body.message, status: sr.body.status }) : signinMsg(sr); return; }
        if (!sr.body.session) { msg.textContent = "Check your email to confirm, then sign in"; return; }
        const { data, error } = await sb.auth.setSession({ access_token: sr.body.session.access_token, refresh_token: sr.body.session.refresh_token });
        if (error || !data.user) { msg.textContent = "Could not sign in. Try again"; return; }
        const { error: ie } = await sb.from("accounts").insert({ id: data.user.id, username: u, display_name: dn });
        if (ie) {
          await sb.auth.signOut();
          msg.textContent = ie.code === "23505" ? "That username is taken" : "Could not save account: " + ie.message;
          return;
        }
        // the saved data on this phone may belong to someone else: the check at start-up clears it, so nothing is copied into the new account here
        sbUser = data.user;
        await new Promise(r => setTimeout(r, 400));
      } else {
        const r = await callFn("signin", { email: e, password: p }).catch(() => ({ ok: false, body: {} }));
        if (r.body && r.body.error === "banned") { showBanned(e); return; }
        if (!r.ok) { msg.textContent = signinMsg(r); return; }
        const { error } = await sb.auth.setSession({ access_token: r.body.session.access_token, refresh_token: r.body.session.refresh_token });
        if (error) { msg.textContent = "Could not sign in. Try again"; return; }
        try { localStorage.removeItem(BAN_EMAIL); } catch (x) {}
        await sb.rpc("set_my_deactivated", { flag: false });
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
  const pull = list => sb.from("accounts").select(ACC_COLS).in("id", list).then(({ data }) => {
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
      acctCache.set(id, a ? Object.assign({}, a, { name: a.display_name || a.username }) : { id, username: "user", name: "user", avatar: null });
    });
    return acctCache;
  });
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
    const r = await fetch("https://api.pwnedpasswords.com/range/" + hex.slice(0, 5), { headers: { "Add-Padding": "true" } });
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
// what went wrong, in plain words, for an error from the sign up or account calls
function authMsg(error) {
  const c = String((error && error.code) || ""), m = String((error && error.message) || "");
  if (c === "user_already_exists" || c === "email_exists" || /already (been )?registered/i.test(m)) return "An account with this email already exists. Sign in instead";
  if (c === "weak_password" || (/password/i.test(m) && /(short|least|weak|characters)/i.test(m))) return "That password is too weak. Use 8 or more characters";
  if (c === "same_password" || /different from the old/i.test(m)) return "Pick a password you are not using now";
  if (c === "validation_failed" || c === "email_address_invalid" || (/email/i.test(m) && /(invalid|valid)/i.test(m))) return "That email does not look right. Check for typos";
  if (c === "over_email_send_rate_limit" || c === "over_request_rate_limit" || (error && error.status === 429)) return "Too many tries. Wait a few minutes and try again";
  if (c === "signup_disabled") return "New accounts are closed for now";
  if (/network|fetch/i.test(m)) return "Could not reach Nook. Check your connection";
  return m || "Something went wrong. Try again";
}
// the answer of the signin function when a password was being changed
function setpwMsg(r) {
  const e = r.body && r.body.error;
  if (e === "wrong_password") return "Current password is wrong" + (r.body.left > 0 ? ". " + r.body.left + (r.body.left === 1 ? " try" : " tries") + " left before a wait" : "");
  if (e === "setpw_failed") return authMsg({ code: r.body.code, message: r.body.message });
  if (e === "no_password") return "Enter your current password";
  if (e === "not_signed_in") return "You are signed out. Sign in again";
  return signinMsg(r);
}
// the signin function hands back a fresh session after the password changed, because the old one stops working
async function takeSession(r) {
  const ss = r.body && r.body.session;
  if (ss) await sb.auth.setSession({ access_token: ss.access_token, refresh_token: ss.refresh_token });
}
// the answer of the signin function turned into words; gives "" for no problem
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
  return "Could not sign in. Check your connection and try again";
}
async function callFn(name, body) {
  const { data } = await sb.auth.getSession();
  const tok = data && data.session ? data.session.access_token : null;
  const r = await fetch(SB_URL + "/functions/v1/" + name, { method: "POST", headers: { "content-type": "application/json", apikey: SB_KEY, ...(tok ? { authorization: "Bearer " + tok } : {}) }, body: JSON.stringify(body || {}) });
  let j = null;
  try { j = await r.json(); } catch (e) {}
  return { ok: r.ok, status: r.status, body: j || {} };
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
// load the chat list in the background so it is ready before the Chats tab opens
async function warmInbox() {
  const convos = await dmInbox();
  cacheWrite("inbox:" + sbUser.id, convos);
  convos.forEach(c => { if (c.avatar && /^https?:/.test(c.avatar)) new Image().src = c.avatar; });
}
async function dmInbox() {
  await loadSocial(true);
  const { data } = await sb.from("messages").select("id, sender_id, recipient_id, body, media, created_at, read_at")
    .or("sender_id.eq." + sbUser.id + ",recipient_id.eq." + sbUser.id).order("created_at", { ascending: false }).limit(500);
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
    r.onerror = () => rej(r.error);
  });
}
async function loadMyKeys(id) {
  const db = await keyDb();
  const got = await new Promise((res, rej) => {
    const q = db.transaction("k").objectStore("k").get(id);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
  if (got && got.priv && got.pub) return got;
  const kp = await crypto.subtle.generateKey(E2E_ALG, false, ["deriveKey"]);
  const rec = { priv: kp.privateKey, pub: toB64(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey))) };
  await new Promise((res, rej) => {
    const tx = db.transaction("k", "readwrite");
    tx.objectStore("k").put(rec, id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  return rec;
}
function myKeys() {
  const id = sbUser.id;
  if (!e2eMine.has(id)) e2eMine.set(id, loadMyKeys(id));
  return e2eMine.get(id);
}
async function ensureE2E() {
  if (!sbUser || !crypto.subtle) return;
  const k = await myKeys();
  const { data } = await sb.from("accounts").select("public_key").eq("id", sbUser.id).maybeSingle();
  if (!data || data.public_key !== k.pub) {
    const { error } = await sb.from("accounts").update({ public_key: k.pub }).eq("id", sbUser.id);
    if (error) throw error;
  }
}
function sharedKey(otherId) {
  if (!e2eShared.has(otherId)) {
    const p = (async () => {
      const mine = await myKeys();
      const { data } = await sb.from("accounts").select("public_key").eq("id", otherId).maybeSingle();
      if (!data || !data.public_key) throw new Error("they need to open nook once first");
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
async function openText(otherId, raw) {
  if (!raw || raw.slice(0, 5) !== "e2e1:") return raw || "";
  try {
    const parts = raw.slice(5).split(".");
    const key = await sharedKey(otherId);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(parts[0]) }, key, fromB64(parts[1]));
    return new TextDecoder().decode(pt);
  } catch (e) { return "Can't open this one (the chat key changed)"; }
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
  const out = await Promise.all(rows.map(async m => Object.assign({}, m, { text: await openText(otherId, m.body) })));
  // photos are opened before their bubbles show, so no grey box sits on the screen while they load (only the newest ones are waited for when there are many)
  const jobs = [];
  rows.slice(-(waitFor || rows.length)).forEach(m => (m.media || []).forEach(md => { if (md.iv && !/^video\//.test(md.type || "")) jobs.push(loadEncMedia(md, otherId).catch(() => {})); }));
  if (jobs.length) await Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, 6000))]);
  return out;
}
async function sendDm(otherId, text, srcs, dims) {
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
    if (error || !data || !data.length) { toast(error ? "Could not delete: " + error.message : "Could not delete that message"); render(); return; }
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
    const link = firstUrl(body);
    if (link) row.append(linkCard(link, true));
    if (body) row.append(h("div", { class: "bub" }, rich(body)));
    row.append(h("div", { class: "mmeta" }, h("div", { class: "mmi" }, h("span", {}, new Date(msg.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })))));
    row.classList.toggle("open", wasOpen);
  };
  fill(m);
  row.refill = fill;
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
function onTyping(from, on) {
  if (!from || from === sbUser.id) return;
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
  const att = pickBtn("image", "Add photo", false, f => addMedia(f, pend, jobs, 4, draw), true);
  const lockNote = h("div", { class: "lockn", hidden: true });
  const dock = h("div", { class: "cdock" }, lockNote, strip, h("div", { class: "cin" }, att, ta, send));
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
    try {
      // a link is sent after its preview is ready, so the other person gets the card at once
      const lk = firstUrl(text);
      if (lk && !(S.previews[lk] && S.previews[lk].v)) await Promise.race([getPreview(lk), new Promise(r => setTimeout(r, 4500))]);
      const saved = await sendDm(c.id, text, srcs, dims);
      threadPush(c.id, saved);
      // keep the bubble that is already on screen: no re-render, no flash
      row.dataset.mid = String(saved.id);
      row.classList.remove("tmpm");
      row._sig = dmSig(saved);
      row._m = Object.assign({}, saved, { text });
    } catch (e) {
      row.remove();
      if (!list.querySelector("[data-mid], .tmpm")) hint("No messages yet. Say hi.");
      ta.value = text;
      pend.push(...srcs);
      toast("Could not send: " + ((e && e.message) || "error"));
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
  pull().then(() => { scrollEnd(); }).catch(() => { if (!list.querySelector("[data-mid], .tmpm")) hint("Could not load messages. Pull down to try again."); });
  sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", me).eq("actor_id", c.id).eq("kind", "message").is("read_at", null).then(() => refreshBadge());
  sync();
}

// owner only: every reported post with its reasons, and buttons to remove it or dismiss the reports
const REPORT_WHY = { sexual: "Sexual content", harassment: "Bullying or harassment", hate: "Hate speech", threats: "Threats or violence", selfharm: "Self harm", illegal: "Illegal or dangerous", private: "Private information", impersonation: "Pretending to be someone", spam: "Spam or scam", other: "Something else" };
async function reportsV() {
  topEl.append(bar(backBtn(), ttl("Reported posts")));
  const list = h("div", { class: "rep" });
  main.append(list);
  list.append(loadingEl());
  const { data, error } = await sb.rpc("owner_reports");
  list.textContent = "";
  if (error) { list.append(emptyState("flag", "Could not load reports.")); return; }
  const byPost = new Map();
  (data || []).forEach(r => { if (!byPost.has(r.post_id)) byPost.set(r.post_id, []); byPost.get(r.post_id).push(r); });
  if (!byPost.size) { list.append(emptyState("flag", "No reports.")); return; }
  byPost.forEach((rs, pid) => {
    const f = rs[0];
    const card = h("div", { class: "repc" },
      h("div", { class: "reph" }, h("b", {}, "@" + f.author), h("span", { class: "sub" }, f.mod_status === "pending" ? "being checked" : ago(Date.parse(f.reported_at)))),
      f.body ? h("div", { class: "tx" }, f.body) : null,
      parseMedia(f.media_url).length ? imgGrid(parseMedia(f.media_url)) : null,
      h("div", { class: "sub" }, rs.map(r => (REPORT_WHY[r.reason] || r.reason) + " by @" + r.reporter).join(" · ")),
      h("div", { class: "btns" },
        h("button", { class: "ghost", onclick: async () => { const { error: e } = await sb.rpc("owner_dismiss_reports", { p_post: pid }); if (e) { toast("Could not dismiss"); return; } card.remove(); if (!list.childElementCount) list.append(emptyState("flag", "No reports.")); } }, "Dismiss"),
        h("button", { class: "ghost dng", onclick: () => confirmSheet("Delete this post for good?", "Delete post", async () => { const { error: e } = await sb.rpc("owner_delete_post", { p_post: pid }); if (e) { toast("Could not delete"); return; } card.remove(); toast("Post deleted"); if (!list.childElementCount) list.append(emptyState("flag", "No reports.")); }) }, "Delete post")));
    list.append(card);
  });
}
function blockedV() {
  topEl.append(bar(backBtn(), ttl("Blocked accounts")));
  const list = h("div");
  main.append(list);
  list.append(loadingEl());
  const showNone = () => { list.textContent = ""; list.append(emptyState("user", "You have not blocked anyone.")); };
  sb.from("blocks").select("blocked_id").eq("blocker_id", sbUser.id).then(({ data, error }) => {
    if (error) { list.textContent = ""; list.append(emptyState("user", "Could not load blocked accounts.")); return; }
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
  }).catch(() => { list.textContent = ""; list.append(emptyState("user", "Could not load blocked accounts.")); });
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
    // new people appear on their own while this page stays open
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
  if (hit) paintIds(hit.v); else list.append(loadingEl());
  Promise.all([
    sb.from("follows").select(col).eq(keyCol, c.id).limit(500),
    sb.from("blocks").select("blocker_id, blocked_id").or("blocker_id.eq." + sbUser.id + ",blocked_id.eq." + sbUser.id)
  ]).then(([{ data: rows }, { data: blks }]) => {
    const hidden = new Set((blks || []).map(b => (b.blocker_id === sbUser.id ? b.blocked_id : b.blocker_id)));
    const ids = (rows || []).map(r => r[col]).filter(id => !hidden.has(id));
    cacheWrite(ukey, ids);
    return paintIds(ids);
  });
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
// what a media-only message says in the chat list and in alerts
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
  const [{ data, error }] = await Promise.all([
    sb.from("notifications").select("id, actor_id, kind, post_id, created_at, read_at").eq("user_id", sbUser.id).neq("kind", "message").order("created_at", { ascending: false }).limit(100),
    loadSocial()
  ]);
  if (error) { list.textContent = ""; list.append(emptyState("bell", "Could not load notifications.")); return; }
  const rows = data || [];
  await acctsFor(rows.map(r => r.actor_id));
  list.textContent = "";
  if (!rows.length) { list.append(emptyState("bell", "No notifications yet.")); return; }
  // every notification is its own row, newest first
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
    openText(m.sender_id, m.body).then(t => alertMe(nickOf(m.sender_id) || a.name, dmGist(t, m.media, false), () => openDm(m.sender_id)));
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
// remove posts (and the replies under them) from this phone after the server deleted them
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
function showModNotice(n) {
  if (!n || modShown.has(n.id)) return;
  modShown.add(n.id);
  if (n.post_id) dropLocalPosts([n.post_id]);
  // somebody who said they are under 18 goes straight to the age check, no warning first
  if (n.kind === "minor") {
    sb.from("mod_notices").update({ seen_at: new Date().toISOString() }).eq("id", n.id).then(() => {}, () => {});
    go({ r: "age" });
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
  const done = () => { dismiss(scrim, ov); sb.from("mod_notices").update({ seen_at: new Date().toISOString() }).eq("id", n.id).then(() => {}, () => {}); render(); };
  const ov = h("div", { class: "sheet warn", role: "alertdialog", "aria-modal": "true" },
    h("div", { class: "grab" }, h("i")),
    h("div", { class: "warnt" }, what),
    h("p", {}, n.kind === "removed" ? "Reason: reported and removed by the owner." : /^(rules|bio|name|username|avatar_rules|banner_rules)$/.test(n.kind) ? "Reason: " + (n.note ? n.note.replace(/[.\s]+$/, "") + "." : "text that is not allowed.") : sexual ? "Reason: sexual content." : "Reason: the file could not be checked."),
    h("button", { class: "pri", onclick: done }, "I understand"));
  layer.append(scrim, ov);
}
async function checkModNotices() {
  if (!sbUser) return;
  const { data } = await sb.from("mod_notices").select("id, kind, post_id, note").is("seen_at", null).order("created_at", { ascending: true }).limit(5);
  (data || []).forEach(showModNotice);
}
// ask people who use the website to install the app; stay quiet if it is already installed
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
function startRealtime() {
  if (!sbUser || rtChan) return;
  rtChan = sb.channel("nook-" + sbUser.id)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: "recipient_id=eq." + sbUser.id }, onIncomingMsg)
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, onDeletedMsg)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "user_id=eq." + sbUser.id }, onIncomingNote)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "bans", filter: "user_id=eq." + sbUser.id }, () => showBanned())
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "mod_notices", filter: "user_id=eq." + sbUser.id }, p => showModNotice(p.new))
    .subscribe();
  tpChan = sb.channel("tp-" + sbUser.id)
    .on("broadcast", { event: "typing" }, ({ payload }) => onTyping(payload && payload.from, payload ? payload.on : undefined))
    .subscribe();
}

const VIEWS = { privacy: legalV, terms: legalV, auth: authV, user: userV, home: homeV, thread: threadV, profile: profileV, chat: chatV, conv: convV, saved: savedV, tag: tagV, lists: listsV, list: listV, settings: settingsV, zen: zenV, dm: dmV, notifs: notifsV, followers: c => followListV(c, "followers"), following: c => followListV(c, "following"), blocked: blockedV, reports: reportsV, banned: bannedV, age: ageV, search: searchV };
function buildNav(cur) {
  navEl.textContent = "";
  const r = stack[0].r;
  [["home", "Home", "home"], ["chat", "Chats", "chat"], ["saved", "Saved", "bookmark"], ["profile", "Profile", "user"]].forEach(t => {
    const on = r === t[0];
    const badge = t[0] === "chat" && unreadPeople > 0 ? h("span", { class: "nbadge nav" }, String(unreadPeople)) : null;
    navEl.append(h("button", { class: on ? "on" : "", "aria-label": t[1], "aria-current": on ? "page" : null, onclick: () => { if (on && stack.length === 1) main.scrollTo({ top: 0, behavior: "smooth" }); else root(t[0]); } }, t[0] === "profile" ? avatar(28) : ic(t[2], 26, on), badge));
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
function render(anim) {
  let cur = stack[stack.length - 1];
  while (stack.length > 1 && ((cur.r === "thread" && !byId(cur.id)) || (cur.r === "conv" && !S.chats.some(x => x.id === cur.id)) || (cur.r === "list" && !S.lists.some(x => x.id === cur.id)))) {
    stack.pop(); scrolls.pop(); cur = stack[stack.length - 1];
  }
  try { sessionStorage.setItem("nook-route", JSON.stringify({ stack, scrolls })); } catch (e) {}
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
  if (!S) { try { const r = localStorage.getItem("tiny-posts-v3"); if (r) S = JSON.parse(r); } catch (e) {} }
  if (!S) { S = freshState(); persist(); }
  // keys that older versions left on this device
  try { ["tiny-bsky-v2", "zenith-pw", "nook-banned"].forEach(k => localStorage.removeItem(k)); } catch (e) {}
  if (normalize()) persist();
  applyTheme();
  try {
    const rt = JSON.parse(sessionStorage.getItem("nook-route") || "null");
    if (rt && Array.isArray(rt.stack) && rt.stack.length && rt.stack.every(x => x && typeof x.r === "string" && VIEWS[x.r])) {
      stack = rt.stack;
      scrolls.length = 0;
      (rt.scrolls || []).slice(0, stack.length - 1).forEach(v => scrolls.push(v));
    }
  } catch (e) {}
  const { data: sess } = await Promise.race([sb.auth.getSession().catch(() => ({ data: { session: null } })), new Promise(r => setTimeout(() => r({ data: { session: null } }), 6000))]);
  sbUser = sess && sess.session ? sess.session.user : null;
  let ageHeld = false, ownAvatar = null;
  if (sbUser) {
    const { data: ban } = await sb.from("bans").select("user_id").eq("user_id", sbUser.id).maybeSingle();
    if (ban) { hist(true); showBanned(); return; }
    const { data: acct, error: aerr } = await sb.from("accounts").select("id, deactivated, username, avatar, display_name").eq("id", sbUser.id).maybeSingle();
    if (acct) ownAvatar = acct.avatar || null;
    if (acct) { const { data: held } = await sb.rpc("my_age_hold"); acct.age_hold = held === true; }
    ageHeld = !!(acct && acct.age_hold);
    if (!aerr && (!acct || acct.deactivated)) { await sb.auth.signOut(); sbUser = null; }
    else if (sbUser && await foreignLocalData(acct)) { await wipeLocal(true); try { localStorage.setItem(LOCAL_UID, sbUser.id); } catch (e) {} location.reload(); return; }
    if (sbUser && acct) rememberAccount({ username: acct.username, name: acct.display_name, avatar: acct.avatar }).catch(() => {});
    if (sbUser) sb.auth.onAuthStateChange((ev, session) => {
      if (switching || !session || !sbUser) return;
      // another tab switched accounts: this one follows
      if (session.user.id !== sbUser.id) { location.reload(); return; }
      if (ev === "TOKEN_REFRESHED") acctList().then(list => { const a = list.find(x => x.id === sbUser.id); if (a) { a.rt = session.refresh_token; return acctPut("list", list); } }).catch(() => {});
    });
  }
  // whether somebody is banned is only ever decided by the server: a banned account sees the banned page when it signs in
  if (!sbUser) { stack = [{ r: "auth" }]; scrolls.length = 0; }
  else if (ageHeld) { stack = [{ r: "age" }]; scrolls.length = 0; }
  else if (stack.some(x => x.r === "auth" || x.r === "banned")) { stack = [{ r: "home" }]; scrolls.length = 0; }
  if (sbUser && !ageHeld) await preloadAvatars(ownAvatar);
  hist(true);
  render();
  if (RECOVERY && sbUser) newPasswordModal();
  else if (HASH_ERR && !sbUser) toast("That link did not work. Ask for a new one.");
  takeShared().catch(() => {});
  if (!sbUser) return;
  takeOpen();
  loadFeed().catch(() => {});
  loadSocial().catch(() => {});
  ensureE2E().catch(() => {});
  startRealtime();
  warmInbox().catch(() => {});
  checkModNotices().catch(() => {});
  setTimeout(maybeInstallPrompt, 6000);
  zenStart().catch(() => {});
  refreshBadge();
  pushSync();
  setInterval(checkBan, 60000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { checkBan(); refreshBadge(); checkModNotices().catch(() => {}); } });
}
async function takeShared() {
  const p = new URLSearchParams(location.search);
  if (!["title", "text", "url", "shared"].some(k => p.has(k))) return;
  history.replaceState(null, "", location.pathname);
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
    for (const f of files) await sendPicTo(t, f);
  };
  const compose = () => openCompose(cleaned ? { prefix: cleaned, files } : { files });
  // with nobody to message there is nothing to choose, so it goes to a new post
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
  async function run() {
    busy = true;
    ptr.classList.add("snap", "spin");
    ptr.firstChild.style.transform = "";
    ptr.style.opacity = "1";
    ptr.style.transform = "translateY(" + (ty - 8) + "px)";
    try {
      await Promise.all([flush(), wait(600)]);
      if ("serviceWorker" in navigator) await Promise.race([navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.update()))), wait(1500)]);
    } catch (e) {}
    location.reload();
  }
  main.addEventListener("touchstart", e => {
    y0 = null;
    live = false;
    pull = 0;
    if (busy || e.touches.length !== 1 || main.scrollTop > 0 || layer.childElementCount || stack[stack.length - 1].r === "conv") return;
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
  main.addEventListener("touchend", end);
  main.addEventListener("touchcancel", end);
})();
window.addEventListener("pagehide", flush);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
boot();
setInterval(zenTick, 60000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") zenTick(); });
window.addEventListener("load", () => setTimeout(zenTick, 1500));
