// never run inside someone else's page: a hidden frame is how people trick you into tapping things
if (window.top !== window.self) { document.documentElement.style.display = "none"; try { window.top.location = window.self.location; } catch (e) {} }
setTimeout(() => { const b = document.getElementById("boot"); if (b) b.remove(); }, 6000);
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
// identical reads that are asked for at the same moment (boot starts several parts of the app that each need the same row) share one network call.
// Only GET and HEAD join, only while the first one is still in flight, and any write clears the list, so a read that starts after a write never gets an older answer.
const sbInflight = new Map();
function sbFetch(input, init) {
  const f = (...a) => fetch(...a);
  try {
    const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      // cleared when the write starts and again when it ends, so a read that began while it ran cannot be joined by one that starts after it
      sbInflight.clear();
      const r = f(input, init);
      const done = () => sbInflight.clear();
      r.then(done, done);
      return r;
    }
    if (typeof input !== "string" || !init || init.signal || init.body) return f(input, init);
    const hd = init.headers instanceof Headers ? [...init.headers.entries()] : Object.entries(init.headers || {});
    const key = method + " " + input + " " + JSON.stringify(hd.map(([k, v]) => [String(k).toLowerCase(), v]).sort());
    let p = sbInflight.get(key);
    if (!p) {
      p = f(input, init);
      sbInflight.set(key, p);
      const drop = () => { if (sbInflight.get(key) === p) sbInflight.delete(key); };
      p.then(drop, drop);
    }
    return p.then(r => r.clone());
  } catch (e) { return f(input, init); }
}
const sb = window.supabase ? window.supabase.createClient(SB_URL, SB_KEY, { global: { fetch: sbFetch }, auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }) : null;
function resetNonceGet() {
  try {
    const o = JSON.parse(localStorage.getItem("nook-reset-nonce") || "null");
    if (o && typeof o.n === "string" && o.n.length >= 16 && Date.now() - Number(o.t) < 2 * 3600 * 1000) return o.n;
  } catch (e) {}
  return "";
}
// a device-bound nonce goes out inside the reset link's address and must come back unchanged on the same phone
function resetNonceMake() {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  const n = btoa(String.fromCharCode.apply(null, a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  try { localStorage.setItem("nook-reset-nonce", JSON.stringify({ n, t: Date.now() })); localStorage.setItem("nook-reset-asked", String(Date.now())); } catch (e) { return ""; }
  return n;
}
async function takeHashLogin() {
  const raw = location.hash;
  if (!/access_token=/.test(raw)) return;
  const p = new URLSearchParams(raw.replace(/^#/, ""));
  let rn = "";
  try { const q = new URLSearchParams(location.search); rn = q.get("rn") || ""; q.delete("rn"); const qs = q.toString(); history.replaceState(history.state, "", location.pathname + (qs ? "?" + qs : "")); } catch (e) { history.replaceState(history.state, "", location.pathname + location.search); }
  const mine = resetNonceGet();
  if (p.get("type") !== "recovery" || !p.get("access_token") || !p.get("refresh_token")) return;
  // fail closed: the link has to carry the nonce made when the reset was asked for on this phone
  if (!mine || !rn || rn.length !== mine.length || (() => { let d = 0; for (let i = 0; i < rn.length; i++) d |= rn.charCodeAt(i) ^ mine.charCodeAt(i); return d !== 0; })()) {
    setTimeout(() => { try { toast("That link was not requested on this phone, so it was not used. Ask for a new reset link here"); } catch (e) {} }, 800);
    return;
  }
  if (!sb) { setTimeout(() => { try { toast("Could not check the reset link. Check your connection, or ask for a new link"); } catch (e) {} }, 1500); return; }
  // the token must at least be a live one issued by this project for a signed in user; the server checks the rest
  let claims = null;
  try { claims = JSON.parse(decodeURIComponent(escape(atob(p.get("access_token").split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))))); } catch (e) {}
  if (!claims || claims.iss !== SB_URL + "/auth/v1" || claims.role !== "authenticated" || !claims.sub || !(claims.exp * 1000 > Date.now() - 300000)) { setTimeout(() => { try { toast("That reset link is not valid. Ask for a new one"); } catch (e) {} }, 1500); return; }
  const { error } = await sb.auth.setSession({ access_token: p.get("access_token"), refresh_token: p.get("refresh_token") });
  if (!error) { RECOVERY = true; try { localStorage.removeItem("nook-reset-asked"); localStorage.removeItem("nook-reset-nonce"); } catch (e) {} }
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
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  cloudOff: '<path d="M2 2l20 20M5.78 5.78A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.31-.19M21.53 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7 7 0 0 0 10 5.07"/>',
  bellOff: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21h4"/><path d="M3 3l18 18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>'
};

// [E3] each icon (name, size, fill) is built once and every use is a deep copy of it: the same svg as before, without
// building and parsing it again; a home feed of thousands of posts draws six icons on every card
const icTpl = new Map();
function ic(n, s, fill) {
  const key = n + "|" + (s || 22) + "|" + (fill ? 1 : 0);
  let v = icTpl.get(key);
  if (!v) {
    v = document.createElementNS(NS, "svg");
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
    icTpl.set(key, v);
  }
  return v.cloneNode(true);
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
  if (u) { urlCache.delete(src); urlCache.set(src, u); }
  if (!u) {
    try {
      const b64 = src.slice(src.indexOf(",") + 1);
      let arr;
      // the browser's own decoder is many times faster than a loop, which matters when a sheet or list shows a lot of pictures at once
      if (typeof Uint8Array.fromBase64 === "function") arr = Uint8Array.fromBase64(b64);
      else {
        const bin = atob(b64);
        arr = new Uint8Array(bin.length);
        for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
      }
      u = URL.createObjectURL(new Blob([arr], { type: (/^data:(image\/[^;,]+)/.exec(src) || [0, "image/jpeg"])[1] }));
    } catch (e) { u = src; }
    urlCache.set(src, u);
    // the least recently used addresses are let go (a little later) once there are a lot of them; a picture shown from one falls back to its own data
    if (urlCache.size > 400) for (const [k, v] of urlCache) { if (urlCache.size <= 360) break; urlCache.delete(k); if (v !== k) setTimeout(() => { try { URL.revokeObjectURL(v); } catch (e) {} }, 30000); }
  }
  return u;
}
function wireImg(i, src, cls) {
  // a picture that did not load (a cold connection after a long break) is asked for again up to three times, a little later each time
  let tries = 0;
  i.onerror = () => {
    if (tries < 3) { tries++; setTimeout(() => { i.src = /^https?:/.test(src) ? src + (src.includes("?") ? "&" : "?") + "r=" + tries : src; }, 1200 * tries); return; }
    i.onerror = () => { if (!cls && i.parentNode) i.replaceWith(h("div", { class: "dmgone" }, "Photo not available")); };
    i.src = src;
  };
  i.src = view(src);
}
// only the pictures that are close to the screen are fetched from the store
let lazyIO = null;
const lazyJobs = new WeakMap();
function lazyWatch(el, fn) {
  if (typeof IntersectionObserver === "undefined") { fn(); return; }
  if (!lazyIO) lazyIO = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    lazyIO.unobserve(e.target);
    const f = lazyJobs.get(e.target);
    lazyJobs.delete(e.target);
    if (f) f();
  }), { rootMargin: "400px 0px" });
  lazyJobs.set(el, fn);
  lazyIO.observe(el);
}
// the box of a picture that is not filled in yet: its own shape when it has been seen (imgAR, see "picture shapes" below), 4:3 otherwise;
// the box is kept until the real pixels have arrived and then replaced by the picture itself, which has the same shape
function arHold(i, id) {
  const r = imgAR.get(id);
  if (r) i.style.setProperty("--ar", String(r));
  i.classList.add("lz");
  i.addEventListener("load", () => {
    if (i.naturalWidth && i.naturalHeight) arSet(id, i.naturalWidth, i.naturalHeight);
    i.classList.remove("lz");
    i.style.removeProperty("--ar");
    if (!i.getAttribute("style")) i.removeAttribute("style");
  }, { once: true });
}
function mkImg(src, cls, on) {
  if (isImgId(src)) {
    const hit = imgPeek(src);
    if (hit !== undefined) { const i = mkImg(hit, cls, on); if (!cls && i.tagName === "IMG") arHold(i, src); return i; }
    // a placeholder of the same box (see .lz in the style sheet) that is filled in once it is near the screen
    const i = h("img", { alt: "", decoding: "async", class: cls || "lz", "data-iid": src });
    if (!cls) arHold(i, src);
    if (on) i.addEventListener("click", on);
    lazyWatch(i, () => imgReal(src).then(real => {
      if (!real) { if (!cls && i.parentNode) i.replaceWith(h("div", { class: "dmgone" }, "Photo not available")); return; }
      i.removeAttribute("data-iid");
      wireImg(i, real, cls);
    }));
    return i;
  }
  const i = h("img", { alt: "", decoding: "async", loading: "lazy", class: cls || null });
  wireImg(i, src, cls);
  if (on) i.addEventListener("click", on);
  return i;
}
const picImg = src => mkImg(src, "pic");
// pictures of other people are only loaded from our own storage or inline data, never from an address they chose
const ownMedia = u => typeof u === "string" && (/^data:image\//.test(u) || u.startsWith(SB_URL + "/storage/v1/object/public/media/"));

// the hint for Zenith's name shows while "@zen..." is typed, not once "@zenith" is complete
const zenHint = v => { const m = /@\w*$/.exec(v); return !!m && m[0].toLowerCase() !== "@zenith"; };
const APP_VERSION = "3.39.0";
const PH = ["What's up?", "What's on your mind?", "Quick update", "What's new today?", "Jot down a thought", "Note to future self", "Today I learned", "Something that made you laugh", "Something you love right now", "Favorite song this week", "What are you listening to?", "What did you dream about?", "What are you eating?", "Weird thought of the day", "Dump your brain here", "Idea for later", "Sketch a quick thought", "Log today's mood", "Small win today", "Brag a little", "How's your day going?", "Random thought", "Pin a reminder", "Something you're looking forward to", "What are you watching?", "Write something nice to yourself"];
let S = null;
let zenSyncOn = false, zenTimer = null, zenBusySync = false;
// a changed copy is told apart from an unchanged one by a cheap hash, so documents that did not change are never turned into text again
const zenHashes = new Map();
class ZenSeen extends Map {
  set(k, v) { zenHashes.delete(k); return super.set(k, v); }
  delete(k) { zenHashes.delete(k); return super.delete(k); }
  clear() { zenHashes.clear(); return super.clear(); }
}
const zenSeen = new ZenSeen();
// long strings (avatar data urls, about 80 KB, copied into every post of the same author) are hashed once per distinct content:
// the Map lookup uses the engine's native string hash, so repeated copies cost far less than the character loop
const bigMemo = new Map();
function bigHash(v) {
  let h = bigMemo.get(v);
  if (h === undefined) {
    let a = 0x811c9dc5, b = 0x5bd1e995;
    for (let i = 0; i < v.length; i++) { const c = v.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = (Math.imul(b ^ c, 0x01000193) + i) | 0; }
    h = (a >>> 0).toString(36) + "." + (b >>> 0).toString(36);
    if (v.length < 400000) {
      if (bigMemo.size >= 64) bigMemo.delete(bigMemo.keys().next().value);
      bigMemo.set(v, h);
    }
  }
  return h;
}
function zenHash(o) {
  let a = 0x811c9dc5, b = 0x5bd1e995, n = 0;
  const mix = str => { for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = (Math.imul(b ^ c, 0x01000193) + i) | 0; } n += str.length; };
  const walk = v => {
    if (v === null || v === undefined) { mix("n"); return; }
    const t = typeof v;
    if (t === "string") { if (v.length > 2048) mix("L" + v.length + ":" + bigHash(v)); else { mix("s" + v.length + ":"); mix(v); } }
    else if (t === "number" || t === "boolean") mix("p" + v);
    else if (Array.isArray(v)) { mix("["); v.forEach(walk); mix("]"); }
    else if (t === "object") { mix("{"); for (const k in v) { if (v[k] === undefined) continue; mix(k + "="); walk(v[k]); } mix("}"); }
  };
  walk(o);
  return n.toString(36) + "-" + (a >>> 0).toString(36) + "-" + (b >>> 0).toString(36);
}
let db = null;
let timer = null;
// ---- lazy pictures ----
// in memory a saved picture is just its id (the same id the image store uses as key); the bytes come from the store on demand
// and stay in a small least-recently-used cache. Anything that needs real bytes (share, backup, upload, sync) awaits imgReal.
const IMG_ID = /^i[0-9a-z]+-[0-9a-z]+-[0-9a-z]+$/;
const isImgId = v => typeof v === "string" && v.length < 64 && IMG_ID.test(v);
const IMG_CACHE_CHARS = 16e6, IMG_CACHE_N = 48;
const imgCache = new Map(), imgPending = new Map();
let imgCacheChars = 0;
function imgPeek(id) {
  const v = imgCache.get(id);
  if (v !== undefined) { imgCache.delete(id); imgCache.set(id, v); }
  return v;
}
function imgPut(id, v) {
  if (imgCache.has(id)) imgCacheChars -= imgCache.get(id).length;
  imgCache.delete(id);
  imgCache.set(id, v);
  imgCacheChars += v.length;
  // the newest picture always stays, however big it is
  for (const [k, x] of imgCache) { if (imgCache.size <= 1 || (imgCache.size <= IMG_CACHE_N && imgCacheChars <= IMG_CACHE_CHARS)) break; imgCache.delete(k); imgCacheChars -= x.length; }
}
function idbGetImg(id) {
  return new Promise((res, rej) => {
    const q = db.transaction("img").objectStore("img").get(id);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
// the real picture (a data address or a link) for a stored value; anything that is not an id is already real
function imgReal(v) {
  if (!isImgId(v)) return Promise.resolve(v == null ? null : v);
  const hit = imgPeek(v);
  if (hit !== undefined) return Promise.resolve(hit);
  if (!db) return Promise.resolve(null);
  let p = imgPending.get(v);
  if (!p) {
    // videos are not supported any more, so an old one counts as gone
    p = idbGetImg(v).then(r => { if (typeof r === "string" && !r.startsWith("data:video/")) { imgPut(v, r); return r; } return null; }).catch(() => null).finally(() => imgPending.delete(v));
    imgPending.set(v, p);
  }
  return p;
}
const imgList = a => Promise.all((a || []).map(imgReal)).then(l => l.filter(Boolean));
const getImgs = p => imgList(p && p.imgs);
// ---- picture shapes ----
// width/height of every stored picture, kept in one small record ("imgar" in the kv store, beside state2; older builds simply ignore it),
// so a placeholder can have the right box before the picture is read. It is filled when a picture is first saved (read from the file header),
// when a picture is shown (its natural size) and, for pictures saved before this existed, in idle time a few at a time.
const imgAR = new Map();
let arDirty = false, arTimer = null, arBusy = false;
function arSet(id, w, hgt) {
  if (!isImgId(id) || !(w > 0) || !(hgt > 0)) return;
  const r = Math.round(w / hgt * 1000) / 1000;
  if (!(r > 0.02 && r < 50) || imgAR.get(id) === r) return;
  imgAR.set(id, r);
  arDirty = true;
  clearTimeout(arTimer);
  arTimer = setTimeout(arSave, 2000);
}
function arSave() {
  clearTimeout(arTimer);
  if (!arDirty || !db || noSave) return;
  arDirty = false;
  const o = { v: 1, r: Object.fromEntries(imgAR) };
  try {
    const t = db.transaction("kv", "readwrite");
    t.objectStore("kv").put(o, "imgar");
    t.onerror = t.onabort = () => { arDirty = true; };
  } catch (e) { arDirty = true; }
}
function arLoad(o) {
  if (!o || typeof o !== "object" || !o.r || typeof o.r !== "object") return;
  for (const k in o.r) { const v = o.r[k]; if (isImgId(k) && typeof v === "number" && v > 0.02 && v < 50) imgAR.set(k, v); }
}
// size from the first bytes of a png, jpeg, webp or gif file (no decoding); null when it cannot be told
function imgDims(b) {
  const n = b.length;
  if (n > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { w: ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0, h: ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0 };
  if (n > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) };
  if (n > 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const k = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (k === "VP8 ") return { w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff };
    if (k === "VP8L") return { w: 1 + (((b[22] & 0x3f) << 8) | b[21]), h: 1 + (((b[24] & 0xf) << 10) | (b[23] << 2) | (b[22] >> 6)) };
    if (k === "VP8X") return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    return null;
  }
  if (n > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let p = 2;
    while (p + 9 < n) {
      if (b[p] !== 0xff) { p++; continue; }
      const m = b[p + 1];
      if (m === 0xff) { p++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[p + 5] << 8) | b[p + 6], w: (b[p + 7] << 8) | b[p + 8] };
      p += 2 + ((b[p + 2] << 8) | b[p + 3]);
    }
  }
  return null;
}
// the same from a data address: only the first part of the text is turned into bytes
function dataDims(src) {
  const m = /^data:image\/[a-z0-9.+-]+;base64,/i.exec(src || "");
  if (!m) return null;
  try {
    const t = src.slice(m[0].length, m[0].length + 131072);
    const bin = atob(t.slice(0, t.length - (t.length % 4)));
    const b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return imgDims(b);
  } catch (e) { return null; }
}
async function arMeasure(id, src) {
  const d = dataDims(src);
  if (d && d.w && d.h) { arSet(id, d.w, d.h); return; }
  if (window.createImageBitmap && typeof src === "string") {
    try { const bm = await createImageBitmap(await (await fetch(src)).blob()); arSet(id, bm.width, bm.height); if (bm.close) bm.close(); } catch (e) {}
  }
}
// pictures saved before shapes were kept: a few per idle slot, one record at a time, never all in memory
const arTried = new Set();
function arBackfill() {
  if (arBusy || !db) return;
  const todo = [];
  const add = id => { if (isImgId(id) && !imgAR.has(id) && !arTried.has(id) && knownIds.has(id)) todo.push(id); };
  if (S) { (S.posts || []).forEach(p => (p.imgs || []).forEach(add)); (S.chats || []).forEach(c => (c.msgs || []).forEach(m => (m.imgs || []).forEach(add))); }
  knownIds.forEach(add);
  if (!todo.length) return;
  arBusy = true;
  const idle = window.requestIdleCallback ? fn => requestIdleCallback(fn, { timeout: 4000 }) : fn => setTimeout(() => fn({ timeRemaining: () => 8 }), 200);
  const pending = Array.from(new Set(todo));
  const step = dl => {
    (async () => {
      let n = 0;
      while (pending.length && n < 4 && (n === 0 || dl.timeRemaining() > 6)) {
        const id = pending.shift();
        arTried.add(id);
        n++;
        try { const v = imgPeek(id) !== undefined ? imgPeek(id) : await idbGetImg(id); if (typeof v === "string") await arMeasure(id, v); } catch (e) {}
      }
    })().then(() => { if (pending.length) idle(step); else arBusy = false; }, () => { arBusy = false; });
  };
  idle(step);
}
// a copy of everything with real pictures in it, for the places that keep a whole copy (account snapshot, plain storage fallback)
async function fullState() {
  const res = async a => (Array.isArray(a) && a.some(isImgId) ? imgList(a) : a);
  const out = { ...S, posts: [], chats: [] };
  for (const p of S.posts) if (!(p && p._prov)) out.posts.push(p && p.imgs ? { ...p, imgs: await res(p.imgs) } : p);
  for (const c of S.chats) { const msgs = []; for (const m of c.msgs || []) msgs.push(m && m.imgs ? { ...m, imgs: await res(m.imgs) } : m); out.chats.push({ ...c, msgs }); }
  return out;
}
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
// posts and chats are kept as one record each (p:<id>, c:<id>) beside a small "state2" record, so a save only writes the ones that changed;
// phones that still hold the old single "state" record are read as before and moved over by their first save
const idbSig = new Map();
let idbMetaSig = "", idbLegacy = false;
function idbLoad(d) {
  return new Promise((res, rej) => {
    const t = d.transaction(["kv", "img"]);
    const kv = t.objectStore("kv");
    const a = kv.get("state2");
    const o = kv.get("state");
    const pr = kv.getAll(IDBKeyRange.bound("p:", "p;", false, true));
    const cr = kv.getAll(IDBKeyRange.bound("c:", "c;", false, true));
    // only the names of the pictures are read here; the pictures themselves are fetched one by one when a screen needs them (imgReal)
    const ik = t.objectStore("img").getAllKeys();
    const ar = kv.get("imgar");
    t.oncomplete = () => res({ meta: a.result || o.result || null, v2: !!a.result, posts: pr.result, chats: cr.result, keys: ik.result, ar: ar.result });
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
function idbSave(d, meta, fresh, drop, puts, dels, dropLegacy) {
  // a save that never finishes is given up after a while, so the queue behind it keeps moving
  let tm;
  return Promise.race([idbSaveNow(d, meta, fresh, drop, puts, dels, dropLegacy), new Promise((_, rej) => { tm = setTimeout(() => rej(new Error("slow save")), 10000); })]).finally(() => clearTimeout(tm));
}
function idbSaveNow(d, meta, fresh, drop, puts, dels, dropLegacy) {
  return new Promise((res, rej) => {
    const t = d.transaction(["kv", "img"], "readwrite");
    const kv = t.objectStore("kv");
    if (meta) kv.put(meta, "state2");
    puts.forEach(f => kv.put(f[1], f[0]));
    dels.forEach(k => kv.delete(k));
    if (dropLegacy) kv.delete("state");
    const im = t.objectStore("img");
    fresh.forEach(f => im.put(f[1], f[0]));
    drop.forEach(id => im.delete(id));
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
// [E6] a draft is only kept on this phone: it is in neither the notes copy nor the Zenith copy, so typing it does not arm their syncs
// (each keystroke re-armed zenSync 2.5 s and notesSync 3 s ahead, and the pull/push they run lands right after the last key)
function persistDraft() {
  clearTimeout(timer);
  timer = setTimeout(flush, 250);
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
// [E2] a record whose content is the same as at the last save is not walked and hashed again.
// jsnap keeps a private copy of what a record looked like, jsame compares the live data against it (a property compare, no strings built);
// the compare sees exactly the kind of change the hash sees (plain values, lists and objects), so nothing that was saved before is skipped
function jsnap(v) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) { const a = new Array(v.length); for (let i = 0; i < v.length; i++) a[i] = jsnap(v[i]); return a; }
  const o = {};
  for (const k in v) o[k] = jsnap(v[k]);
  return o;
}
function jsame(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a !== a && b !== b;
  const ar = Array.isArray(a);
  if (ar !== Array.isArray(b)) return false;
  if (ar) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (!jsame(a[i], b[i])) return false; return true; }
  let n = 0;
  for (const k in b) { n++; if (!(k in a) || !jsame(a[k], b[k])) return false; }
  let m = 0;
  for (const k in a) m++;
  return n === m;
}
const flushMemo = new Map();
let metaMemo = null;
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
        // a picture that was never loaded is still just its id: it is already in the store
        if (isImgId(src)) { used.add(src); return src; }
        const id = memo.get(src) || hashMemo.get(src) || srcHash(src);
        memo.set(src, id);
        used.add(id);
        if (!knownIds.has(id)) { fresh.set(id, src); if (!imgAR.has(id)) arMeasure(id, src); }
        return id;
      };
      // only records whose content differs from what was last written are sent to the database
      const puts = [], seenKeys = new Set(), sigs = new Map();
      const rec = (key, r) => {
        seenKeys.add(key);
        const sg = zenHash(r);
        if (idbSig.get(key) !== sg) { puts.push([key, r]); sigs.set(key, sg); }
        return sg;
      };
      // [E2] src is the live post or chat, build makes the record to save from it (with its pictures turned into ids).
      // When src is unchanged since the last save and that save is what the database holds, the record is neither built nor hashed:
      // the pictures it used are counted as used and the picture-hash memo keeps its entries.
      const recMemo = (key, src, build) => {
        const m = flushMemo.get(key);
        if (m && idbSig.get(key) === m.sig && jsame(m.snap, src)) {
          seenKeys.add(key);
          m.ids.forEach(id => used.add(id));
          m.pairs.forEach(([a, id]) => memo.set(a, id));
          return;
        }
        const ids = [], pairs = [];
        const track = a => { const id = idFor(a); if (id) { ids.push(id); if (!isImgId(a)) pairs.push([a, id]); } return id; };
        const sg = rec(key, build(track));
        flushMemo.set(key, { snap: jsnap(src), sig: sg, ids, pairs });
      };
      const pids = [], cids = [];
      S.posts.forEach(p => { if (!p || p._prov || typeof p.id !== "string") return; pids.push(p.id); recMemo("p:" + p.id, p, tr => ({ ...p, imgs: (p.imgs || []).map(tr) })); });
      S.chats.forEach(c => { if (!c || typeof c.id !== "string") return; cids.push(c.id); recMemo("c:" + c.id, c, tr => ({ ...c, msgs: (c.msgs || []).map(m => ({ ...m, imgs: (m.imgs || []).map(tr) })) })); });
      const profile = { ...S.profile, avatar: idFor(S.profile.avatar), banner: idFor(S.profile.banner) };
      const dels = Array.from(idbSig.keys()).filter(k => !seenKeys.has(k));
      const drop = Array.from(knownIds).filter(id => !used.has(id));
      flushMemo.forEach((_, k) => { if (!seenKeys.has(k)) flushMemo.delete(k); });
      const rest = { ...S, profile, split: 2, pids, cids };
      delete rest.posts; delete rest.chats;
      // [E2] the settings part (it holds the sync bookkeeping of every note, thousands of entries) is compared, not hashed, when it did not change
      let msig;
      if (metaMemo && jsame(metaMemo.snap, rest)) msig = metaMemo.sig;
      else { msig = zenHash(rest); metaMemo = { snap: jsnap(rest), sig: msig }; }
      const metaOut = msig !== idbMetaSig || idbLegacy || puts.length || dels.length ? rest : null;
      if (metaOut || puts.length || dels.length || fresh.size || drop.length || idbLegacy) {
        await idbSave(db, metaOut, Array.from(fresh), drop, puts, dels, idbLegacy);
      }
      sigs.forEach((v, k) => idbSig.set(k, v));
      dels.forEach(k => idbSig.delete(k));
      idbMetaSig = msig;
      idbLegacy = false;
      fresh.forEach((_, id) => knownIds.add(id));
      drop.forEach(id => knownIds.delete(id));
      // shapes of pictures that are gone are forgotten
      let gone = false;
      imgAR.forEach((_, id) => { if (!knownIds.has(id)) { imgAR.delete(id); gone = true; } });
      if (gone) { arDirty = true; clearTimeout(arTimer); arTimer = setTimeout(arSave, 2000); }
      hashMemo = memo;
      return;
    } catch (e) {
      // a save that was only slow may still finish; the localStorage copy is not made for it, and it is tried again shortly
      if (e && e.message === "slow save") { clearTimeout(timer); timer = setTimeout(flush, 4000); return; }
    }
  }
  try { localStorage.setItem("tiny-posts-v3", JSON.stringify(S.posts.some(p => p && (p.imgs || []).some(isImgId)) || S.chats.some(c => (c.msgs || []).some(m => (m.imgs || []).some(isImgId))) ? await fullState() : S)); } catch (e) { toast("storage is full"); }
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
// --bg of each look is read once (the read forces a full style pass) and remembered; a look not seen yet is read in the next frame, the very first one at once
const barBg = new Map();
let barQ = 0;
const barKey = () => { const t = S && S.ui && S.ui.theme; return t === "dark" || t === "light" ? t : window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; };
function barRead() {
  const m = document.querySelector('meta[name="theme-color"]');
  if (!m) return;
  const v = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  barBg.set(barKey(), v);
  m.setAttribute("content", v);
}
function syncBar() {
  const m = document.querySelector('meta[name="theme-color"]');
  if (!m) return;
  const k = barKey();
  if (barBg.has(k)) m.setAttribute("content", barBg.get(k));
  else if (!barBg.size) barRead();
  else if (!barQ) barQ = requestAnimationFrame(() => { barQ = 0; if (!barBg.has(barKey())) barRead(); else syncBar(); });
}
if (window.matchMedia) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  if (mq.addEventListener) mq.addEventListener("change", syncBar);
}

// id and parent indexes over S.posts, rebuilt when the list changes and dropped at the end of the current task
let postIdx = null;
function postIndex() {
  const L = S.posts;
  if (postIdx && postIdx.L === L && postIdx.n === L.length && postIdx.last === L[L.length - 1]) return postIdx;
  const ids = new Map(), par = new Map();
  for (const p of L) {
    if (!ids.has(p.id)) ids.set(p.id, p);
    if (p.parent != null) { const a = par.get(p.parent); if (a) a.push(p); else par.set(p.parent, [p]); }
  }
  postIdx = { L, n: L.length, last: L[L.length - 1], ids, par };
  Promise.resolve().then(() => { postIdx = null; });
  return postIdx;
}
const dropPostIndex = () => { postIdx = null; };
const byId = id => { const h = postIndex().ids.get(id); return h && h.id === id ? h : S.posts.find(p => p.id === id); };
const kids = id => { const a = postIndex().par.get(id); return a ? a.filter(p => p.parent === id) : []; };
// true when one of his own posts is above this one, however far up
const zenThread = p => { for (let q = p && p.parent ? byId(p.parent) : null, n = 0; q && n < 60; q = q.parent ? byId(q.parent) : null, n++) if (q.ai) return true; return false; };
// a post that shows a link card does not also print the link; the copy button in the menu still has the whole text
const cardless = p => { if (!p.text || (p.imgs && p.imgs.length) || !firstUrl(p.text)) return p.text; return p.text.replace(/https?:\/\/[^\s<>"]+/i, "").replace(/[ \t]{2,}/g, " ").trim(); };
// every reply under a post counts, the ones to replies too
const replyTotal = id => { const pi = postIndex(); pi.rt = pi.rt || new Map(); if (!pi.rt.has(id)) pi.rt.set(id, flat(id, 0, []).length); return pi.rt.get(id); };
function flat(id, d, out, seen) {
  seen = seen || new Set([id]);
  // a parent loop in stored data must not run forever
  kids(id).sort((a, b) => a.t - b.t).forEach(k => { if (seen.has(k.id)) return; seen.add(k.id); out.push({ p: k, d }); flat(k.id, d + 1, out, seen); });
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
const LANG_MEMO = new Map();
function langOf(text) {
  if (typeof text !== "string" || text.length < 3) return null;
  if (LANG_MEMO.has(text)) return LANG_MEMO.get(text);
  const r = langOfRaw(text);
  if (LANG_MEMO.size > 2000) LANG_MEMO.clear();
  LANG_MEMO.set(text, r);
  return r;
}
function langOfRaw(text) {
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
  if (hit && hit.key === key) return hit.ids.map(id => byId(id)).filter(p => p && !hidden.has(p.id));
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
  const items = [{ label: "Automatic", keep: true, left: true, on: !sel.size, fn: b => { sel.clear(); save(b); } }];
  LANGS.forEach(l => items.push({ label: l[1], keep: true, left: true, on: sel.has(l[0]), fn: b => { if (sel.has(l[0])) sel.delete(l[0]); else sel.add(l[0]); save(b); } }));
  items.push({ label: "Done", cancel: true });
  sheet(items, "Languages I read (pick as many as you like)", () => { if (changed) render(); });
}
const langText = () => { const ids = new Set(LANGS.map(l => l[0])); const l = Array.isArray(S.ui.langs) ? S.ui.langs.filter(x => ids.has(x)) : []; return l.length ? l.map(id => LANGS.find(x => x[0] === id)[1]).sort().join(", ") : "Automatic"; };
// a very long text is cut with a Show more button, so one huge post can never fill the page
// cuts on whole characters and never in the middle of a link: a link that would be cut is left out whole (or kept whole when it is the first thing)
function cutText(text, n) {
  const cp = [...String(text)];
  if (cp.length <= n) return cp.join("");
  const head = cp.slice(0, n).join(""), full = String(text);
  const m = /https?:\/\/\S*$/.exec(head);
  if (m && /\S/.test(full.charAt(head.length))) {
    if (m.index > 0) return head.slice(0, m.index).replace(/\s+$/, "");
    const e = /^\S*/.exec(full.slice(head.length))[0];
    return head + e;
  }
  return head;
}
// edited: a post whose words were changed ends with a small "Edited" right after its text
function txBody(text, extra, edited) {
  const box = h("div", { class: "tx" + extra });
  const LIMIT = 700;
  const tag = () => (edited ? [" ", h("span", { class: "pe" }, "Edited")] : []);
  if (String(text).length <= LIMIT) { box.append(...rich(text), ...tag()); return box; }
  const more = h("button", { class: "tbtn", type: "button", style: "padding:6px 0;color:var(--lnk)", onclick: e => { e.stopPropagation(); box.textContent = ""; box.append(...rich(text), ...tag()); } }, "Show more");
  box.append(...rich(cutText(text, 600) + "…"), h("div", {}, more));
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
    if (i % 2 === 0) {
      // words between two pairs of stars are bold
      part.split(/\*\*([^*\n]+?)\*\*/).forEach((seg, j) => {
        if (!seg) return;
        if (j % 2) { out.push(h("b", {}, seg)); return; }
        // one star on each side slants the words
        seg.split(/\*([^*\s](?:[^*\n]*[^*\s])?)\*/).forEach((w, k) => { if (w) out.push(k % 2 ? h("i", {}, w) : w); });
      });
      return;
    }
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
// "/claude": the little mascots jump in from the bottom and from both sides of the screen, fast and in every direction, in arcs, for 40
// seconds in all (not 40 seconds for each one). Some of them move (hop, hearts, sparkles, typing). The bottom is the top of the keyboard
// while it is open. One "/claude" every 30 seconds; in a chat with a person the message is sent too and their phone plays it when it
// arrives; in a note nothing is sent. The drawings are the same as in the app (o body, k eyes, h hearts, s stars, g c d the laptop,
// t a tear, b a blush); "ms" is how long each frame stays.
const CLAUDE_SPRITES = [{"cols":13,"rows":8,"ax":6.5,"ay":4,"frames":[["..ooooooooo..","..ooooooooo..","ooookoookoooo","ooookoookoooo","..ooooooooo..","..ooooooooo..","..o.o...o.o..","..o.o...o.o.."]],"ms":[1000]},{"cols":13,"rows":8,"ax":6.5,"ay":4,"frames":[["..ooooooooo..","..ooooooooo..","ooookoookoooo","oookokokokooo","..ooooooooo..","..ooooooooo..","..o.o...o.o..","..o.o...o.o.."]],"ms":[1000]},{"cols":13,"rows":8,"ax":6.5,"ay":4,"frames":[["..ooooooooo..","..ooooooooo..","ooookoooooooo","ooookookkkooo","..ooooooooo..","..ooooooooo..","..o.o...o.o..","..o.o...o.o.."]],"ms":[1000]},{"cols":13,"rows":8,"ax":6.5,"ay":4,"frames":[["..ooooooooo..","..ooooooooo..","ooohohohohooo","ooohhhohhhooo","..oohooohoo..","..ooooooooo..","..o.o...o.o..","..o.o...o.o.."]],"ms":[1000]},{"cols":13,"rows":8,"ax":6.5,"ay":4,"frames":[["..ooooooooo..","..oosooosoo..","ooosssosssooo","oooosooosoooo","..ooooooooo..","..ooooooooo..","..o.o...o.o..","..o.o...o.o.."]],"ms":[1000]},{"cols":13,"rows":8,"ax":6.5,"ay":4,"frames":[["..ooooooooo..","..ooooooooo..","ooookoookoooo","ooookoookoooo","..bbooooobb..","..ooooooooo..","..o.o...o.o..","..o.o...o.o.."]],"ms":[1000]},{"cols":13,"rows":8,"ax":6.5,"ay":4,"frames":[["..ooooooooo..","..ooooooooo..","ooookoookoooo","ooookokokoooo","..ooookoooo..","..ooooooooo..","..o.o...o.o..","..o.o...o.o.."]],"ms":[1000]},{"cols":13,"rows":8,"ax":6.5,"ay":4,"frames":[["..ooooooooo..","..okoooooko..","ooookoookoooo","ooookokokoooo","..oookokooo..","..ooooooooo..","..o.o...o.o..","..o.o...o.o.."]],"ms":[1000]},{"cols":13,"rows":8,"ax":6.5,"ay":4,"frames":[["..ooooooooo..","..ooooooooo..","ooookoookoooo","ooookokokoooo","..ootkokooo..","..ooooooooo..","..o.o...o.o..","..o.o...o.o.."]],"ms":[1000]},{"cols":13,"rows":8,"ax":6.5,"ay":4,"frames":[["..ooooooooo..","..ooooooooo..","oooookoookooo","oooookoookooo","..ooooooooo..","..ooooooooo..","..o.o...o.o..","..o.o...o.o.."]],"ms":[1000]},{"cols":22,"rows":18,"ax":9.5,"ay":11,"frames":[["......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...ooookoookoooo......","...ooookoookoooo......",".....ooooooooo........",".....ooooooooo........",".....o.o...o.o........",".....o.o...o.o........","......................","......................","......................"],["......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...ooookoookoooo......","...ooookoookoooo......",".....ooooooooo........",".....ooooooooo........",".....o.o...o.o........",".....o.o...o.o........","......................","......................","......................"],["......................","......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...ooookoookoooo......","...ooookoookoooo......",".....ooooooooo........",".....ooooooooo........",".....o.o...o.o........",".....o.o...o.o........","......................","......................"],["......................","......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...ooookoookoooo......","...ooookoookoooo......",".....ooooooooo........",".....ooooooooo........",".....o.o...o.o........",".....o.o...o.o........","......................","......................"],["......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...oookoookooooo......","...oookoookooooo......",".....ooooooooo........",".....ooooooooo........",".....o.o...o.o........",".....o.o...o.o........","......................","......................","......................"],["......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...oookoookooooo......","...oookoookooooo......",".....ooooooooo........",".....ooooooooo........",".....o.o...o.o........",".....o.o...o.o........","......................","......................","......................"],["......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...ooookoookoooo......","...ooookoookoooo......",".....ooooooooo........",".....ooooooooo........",".....o.o...o.o........",".....o.o...o.o........","......................","......................","......................"],["......................","......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...ooooooooooooo......","...oookkoookkooo......",".....ooooooooo........",".....ooooooooo........",".....o.o...o.o........",".....o.o...o.o........","......................","......................"],["......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...ooookoookoooo......","...ooookoookoooo......",".....ooooooooo........",".....ooooooooo........",".....o.o...o.o........",".....o.o...o.o........","......................","......................","......................"],["......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...ooookoookoooo......","...ooookoookoooo......",".....ooooooooo........",".....ooooooooo........",".....o.o...o.o........",".....o.o...o.o........","......................","......................","......................"],["......................","......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...oooookoookooo......","...oooookoookooo......",".....ooooooooo........",".....ooooooooo........",".....o.o...o.o........",".....o.o...o.o........","......................","......................"],["......................","......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...oooookoookooo......","...oooookoookooo......",".....ooooooooo........",".....ooooooooo........",".....o.o...o.o........",".....o.o...o.o........","......................","......................"]],"ms":[180,180,180,180,180,180,180,180,180,180,180,180]},{"cols":22,"rows":18,"ax":9.5,"ay":11,"frames":[["......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...ooookoookoooo......","...ooookoookoooo......",".....ooooooooo........",".....ooooooooo........",".....o.o...o.o........",".....o.o...o.o........","......................","......................","......................"],["......................","......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...ooookoookoooo......","...ooookoookoooo......",".....ooooooooo........",".....ooooooooo........",".....o.o...o.o........","......................","......................","......................"],["......................","......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...ooookoookoooo......","...ooookoookoooo......",".....ooooooooo........",".....ooooooooo........",".....o.o...o.o........","......................","......................","......................"],["......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...ooookoookoooo......","...oookokokokooo......",".....ooooooooo........",".....ooooooooo........",".....o.o...o.o........",".....o.o...o.o........","......................","......................","......................","......................"],["......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...ooookoookoooo......","...oookokokokooo......",".....ooooooooo........",".....ooooooooo........",".....o.o...o.o........",".....o.o...o.o........","......................","......................","......................","......................","......................","......................"],["......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...ooookoookoooo......","...oookokokokooo......",".....ooooooooo........",".....ooooooooo........",".....o.o...o.o........",".....o.o...o.o........","......................","......................","......................","......................","......................","......................","......................"],["......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...ooookoookoooo......","...oookokokokooo......",".....ooooooooo........",".....ooooooooo........",".....o.o...o.o........",".....o.o...o.o........","......................","......................","......................","......................","......................","......................"],["......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...ooookoookoooo......","...ooookoookoooo......",".....ooooooooo........",".....ooooooooo........",".....o.o...o.o........",".....o.o...o.o........","......................","......................","......................","......................"],["......................","......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...ooookoookoooo......","...ooookoookoooo......",".....ooooooooo........",".....ooooooooo........",".....o.o...o.o........","......................","......................","......................"],["......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...ooookoookoooo......","...ooookoookoooo......",".....ooooooooo........",".....ooooooooo........",".....o.o...o.o........",".....o.o...o.o........","......................","......................","......................"],["......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...ooookoookoooo......","...ooookoookoooo......",".....ooooooooo........",".....ooooooooo........",".....o.o...o.o........",".....o.o...o.o........","......................","......................","......................"]],"ms":[150,90,90,70,70,120,70,70,100,100,250]},{"cols":22,"rows":18,"ax":9.5,"ay":11,"frames":[["......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........",".h.hoohohohohooo......",".hhhoohhhohhhooo......","..h..oohooohoo........",".....ooooooooo........",".....o.o...o.o....h.h.",".....o.o...o.o....hhh.","...................h..","......................","......................"],["......................","......................","......................","......................","......................","......................","......................","......................",".h.h.ooooooooo........",".hhh.ooooooooo........","..hooohohohohooo......","...ooohhhohhhooo......",".....oohooohoo....h.h.",".....ooooooooo....hhh.",".....o.o...o.o.....h..",".....o.o...o.o........","......................","......................"],["......................","......................","......................","......................","......................","......................","......................",".h.h.ooooooooo........",".hhh.ooooooooo........","..hooohohohohooo......","...ooohhhohhhooo......",".....oohooohoo....h.h.",".....ooooooooo....hhh.",".....o.o...o.o.....h..",".....o.o...o.o........","......................","......................","......................"],["......................","......................","......................","......................","......................","......................",".h.h..................",".hhh..................","..h..ooooooooo........",".....ooooooooo........","...ooohohohohooo..h.h.","...ooohhhohhhooo..hhh.",".....oohooohoo.....h..",".....ooooooooo........",".....o.o...o.o........",".....o.o...o.o........","......................","......................"],["......................","......................","......................","......................","......................",".h.h..................",".hhh..................","..h..ooooooooo........",".....ooooooooo........","...ooohohohohooo..h.h.","...ooohhhohhhooo..hhh.",".....oohooohoo.....h..",".....ooooooooo........",".....o.o...o.o........",".....o.o...o.o........","......................","......................","......................"],["......................","......................","......................","......................","......................","......................","......................","......................",".....ooooooooo....h.h.",".....ooooooooo....hhh.","...ooohohohohooo...h..","...ooohhhohhhooo......",".....oohooohoo........",".h.h.ooooooooo........",".hhh.o.o...o.o........","..h..o.o...o.o........","......................","......................"],["......................","......................","......................","......................","......................","......................","......................",".....ooooooooo....h.h.",".....ooooooooo....hhh.","...ooohohohohooo...h..","...ooohhhohhhooo......",".....oohooohoo........",".h.h.ooooooooo........",".hhh.o.o...o.o........","..h..o.o...o.o........","......................","......................","......................"],["......................","......................","......................","......................","......................","......................","..................h.h.","..................hhh.",".....ooooooooo.....h..",".....ooooooooo........","...ooohohohohooo......",".h.hoohhhohhhooo......",".hhh.oohooohoo........","..h..ooooooooo........",".....o.o...o.o........",".....o.o...o.o........","......................","......................"],["......................","......................","......................","......................","......................","..................h.h.","..................hhh.",".....ooooooooo.....h..",".....ooooooooo........","...ooohohohohooo......",".h.hoohhhohhhooo......",".hhh.oohooohoo........","..h..ooooooooo........",".....o.o...o.o........",".....o.o...o.o........","......................","......................","......................"]],"ms":[150,150,150,150,150,150,150,150,150]},{"cols":22,"rows":18,"ax":9.5,"ay":11,"frames":[["......................","......................","......................","......................","......................",".................s....","................sss...",".s...ooooooooo...s....","sss..oosooosoo........",".s.ooosssosssooo......","...oooosooosoooo......",".....ooooooooo........",".....ooooooooo........",".....o.o...o.o........",".....o.o...o.o........","......................","......................","......................"],["......................","......................","......................","......................",".................s....",".................s....","...............sssss..",".................s....",".....ooooooooo...s....",".....oosooosoo........","...ooosssosssooo......","...oooosooosoooo......",".....ooooooooo........",".....ooooooooo........",".....o.o...o.o........",".....o.o...o.o........","......................","......................"],["......................","......................","......................","......................","......................",".................s....","................sss...",".....ooooooooo...s....",".....oosooosoo........","...ooosssosssooo......","...oooosooosoooo......",".....ooooooooo....s...",".....ooooooooo...sss..",".....o.o...o.o....s...",".....o.o...o.o........","......................","......................","......................"],["......................","......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....oosooosoo........","...ooosssosssooo..s...","...oooosooosoooo..s...",".....ooooooooo..sssss.",".....ooooooooo....s...",".....o.o...o.o....s...",".....o.o...o.o........","......................","......................"],["......................","......................","......................","......................","......................","......................","......................",".s...ooooooooo........","sss..oosooosoo........",".s.ooosssosssooo......","...oooosooosoooo......",".....ooooooooo....s...",".....ooooooooo...sss..",".....o.o...o.o....s...",".....o.o...o.o........","......................","......................","......................"],["......................","......................","......................","......................","......................","......................",".s....................",".s....................","ssss.ooooooooo........",".s...oosooosoo........",".s.ooosssosssooo......","...oooosooosoooo......",".....ooooooooo........",".....ooooooooo........",".....o.o...o.o........",".....o.o...o.o........","......................","......................"]],"ms":[200,200,200,200,200,200]},{"cols":22,"rows":18,"ax":9.5,"ay":11,"frames":[["......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...ooookoookoooo......","...ooookoookoooo......",".....ooooooooo........",".....gcccddccg........",".....gdddccccgo.......","....oggggggggg........","....ggggggggggg.......","......................","......................"],["......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...ooookoookoooo......","...ooookoookoooo......",".....ooooooooo........",".....gdcdccccg........","....ogddcdcccg........",".....gggggggggo.......","....ggggggggggg.......","......................","......................"],["......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...ooookoookoooo......","...ooookoookoooo......",".....ooooooooo........",".....gdccccccg........",".....gddcdcddgo.......","....oggggggggg........","....ggggggggggg.......","......................","......................"],["......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...ooookoookoooo......","...ooookoookoooo......",".....ooooooooo........",".....gdcdcdddg........","....ogdddccccg........",".....gggggggggo.......","....ggggggggggg.......","......................","......................"],["......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...ooookoookoooo......","...ooookoookoooo......",".....ooooooooo........",".....gdcdddccg........",".....gdcdccccgo.......","....oggggggggg........","....ggggggggggg.......","......................","......................"],["......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...ooookoookoooo......","...ooookoookoooo......",".....ooooooooo........",".....gdddccccg........","....ogdddcdddg........",".....gggggggggo.......","....ggggggggggg.......","......................","......................"],["......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...ooookoookoooo......","...ooookoookoooo......",".....ooooooooo........",".....gcccccccg........",".....gdcdddccgo.......","....oggggggggg........","....ggggggggggg.......","......................","......................"],["......................","......................","......................","......................","......................","......................","......................",".....ooooooooo........",".....ooooooooo........","...ooookoookoooo......","...ooookoookoooo......",".....ooooooooo........",".....gcccddccg........","....ogccdccccg........",".....gggggggggo.......","....ggggggggggg.......","......................","......................"]],"ms":[140,140,140,140,140,140,140,140]}];
const CLAUDE_STATIC = 10;
const CLAUDE_PAL = { o: "#D97757", k: "#1D1B1A", h: "#EE5A7A", s: "#FFD54A", t: "#7CC4FF", b: "#F29A9A", g: "#6B7280", c: "#A5E8FF", d: "#2B6F86" };
const CLAUDE_MS = 40000, CLAUDE_EVERY = 30000;
let claudeAt = 0, claudeRun = 0, claudeCv = null;
// "no" when the text is not the command, "stop" when it was taken or refused (the caller stops; in a note the box is emptied when it was
// taken), "go" when it was taken in a chat with a person (the message is sent as usual and the mascots start at once)
function claudeCmd(ta, done, send) {
  const t = ta.value.trim();
  if (/\/claude[\s\S]*\/claude/i.test(t)) { toast("Write /claude only once"); return "stop"; }
  if (!/^\/claude$/i.test(t)) return "no";
  if (claudeAt && Date.now() - claudeAt < CLAUDE_EVERY) { toast("Only one /claude every 30 seconds"); return "stop"; }
  claudeFly();
  if (send) return "go";
  ta.value = "";
  if (done) done();
  return "stop";
}
// a "/claude" that came in from the other person: played when it is fresh and the last one is over 30 seconds ago
function claudeReceived(sentAt) {
  if (Date.now() - sentAt > 60000) return;
  if (claudeAt && Date.now() - claudeAt < CLAUDE_EVERY) return;
  claudeFly();
}
function claudeFly() {
  claudeAt = Date.now();
  const run = ++claudeRun;
  if (claudeCv) claudeCv.remove();
  // a small seeded random, so the plan is made once and the frames only move things
  let seed = Date.now() >>> 0;
  const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const flyers = [];
  // the places they come from are dealt like cards, so they are spread over the left, the right and the whole bottom instead of landing in
  // one corner: 0 left, 1 right, 2 and 3 bottom, 4 bottom going straight up
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  let kinds = [], slots = [];
  const nextKind = () => { if (!kinds.length) kinds = shuffle([0, 0, 1, 1, 2, 2, 3, 4]); return kinds.pop(); };
  const nextSlot = () => { if (!slots.length) slots = shuffle([0, 1, 2, 3, 4, 5]); return (slots.pop() + 0.15 + rnd() * 0.7) / 6; };
  const add = t => {
    const s = nextKind();
    const f = { at: t, dur: 1700 + Math.floor(rnd() * 1500), size: 40 + rnd() * 56, spin: (60 + Math.floor(rnd() * 260)) * (rnd() < 0.5 ? 1 : -1), phase: Math.floor(rnd() * 2000),
      sprite: rnd() < 0.45 ? CLAUDE_STATIC + Math.floor(rnd() * (CLAUDE_SPRITES.length - CLAUDE_STATIC)) : Math.floor(rnd() * CLAUDE_STATIC) };
    if (s === 0) Object.assign(f, { sx: -0.15, ex: 0.25 + rnd() * 0.85, sy: 0.15 + rnd() * 0.85, ey: 1.25, apex: 0.1 + rnd() * 0.55 });
    else if (s === 1) Object.assign(f, { sx: 1.15, ex: 0.75 - rnd() * 0.85, sy: 0.15 + rnd() * 0.85, ey: 1.25, apex: 0.1 + rnd() * 0.55 });
    else if (s === 4) { const x0 = nextSlot(); Object.assign(f, { sx: x0, ex: x0 + (rnd() - 0.5) * 0.1, sy: 1.15, ey: 1.15, apex: 0.6 + rnd() * 0.6 }); }
    else { const x0 = nextSlot(), dx = (0.15 + rnd() * 0.5) * (rnd() < 0.5 ? 1 : -1); Object.assign(f, { sx: x0, ex: Math.max(-0.2, Math.min(1.2, x0 + dx)), sy: 1.15, ey: 1.15, apex: 0.4 + rnd() * 0.7 }); }
    flyers.push(f);
  };
  // a burst of four at the start, then one (sometimes two) every 0.5 to 0.8 s until second 36, each in the air 1.7 to 3.2 seconds
  for (let i = 0; i < 4; i++) add(i * 60);
  for (let t = 500; t < 36300; t += 500 + Math.floor(rnd() * 300)) for (let n = rnd() < 0.2 ? 2 : 1; n > 0; n--) add(t);
  // every frame of every drawing as horizontal runs of one colour: fewer rectangles in every frame
  const sprites = CLAUDE_SPRITES.map(d => ({ d, cycle: d.ms.reduce((a, b) => a + b, 0), frames: d.frames.map(rows => {
    const out = [];
    rows.forEach((row, y) => { let x = 0; while (x < row.length) { const ch = row[x]; if (ch === ".") { x++; continue; } let e = x; while (e + 1 < row.length && row[e + 1] === ch) e++; out.push([x, y, e - x + 1, CLAUDE_PAL[ch]]); x = e + 1; } });
    return out;
  }) }));
  const cv = document.createElement("canvas");
  claudeCv = cv;
  cv.style.cssText = "position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2147483000";
  cv.setAttribute("aria-hidden", "true");
  document.body.append(cv);
  const ctx = cv.getContext("2d");
  const t0 = performance.now();
  const frame = now => {
    if (run !== claudeRun) return;
    const ms = now - t0;
    const dpr = window.devicePixelRatio || 1, w = window.innerWidth, h = window.innerHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // the floor is the top of the keyboard while it is open
    const vv = window.visualViewport, floor = vv ? vv.offsetTop + vv.height : h;
    for (const f of flyers) {
      const e = ms - f.at;
      if (e < 0 || e > f.dur) continue;
      const p = e / f.dur;
      const cx = (f.sx + (f.ex - f.sx) * p) * w, cy = (f.sy + (f.ey - f.sy) * p - 4 * f.apex * p * (1 - p)) * floor;
      const sp = sprites[f.sprite], cell = f.size / 13;
      let fi = 0;
      if (sp.frames.length > 1) { let m = (e + f.phase) % sp.cycle; while (m >= sp.d.ms[fi]) { m -= sp.d.ms[fi]; fi++; } }
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((f.spin * (2 * p - 1)) * Math.PI / 180);
      for (const [x, y, len, col] of sp.frames[fi]) { ctx.fillStyle = col; ctx.fillRect((x - sp.d.ax) * cell, (y - sp.d.ay) * cell, len * cell + 0.6, cell + 0.6); }
      ctx.restore();
    }
    if (ms < CLAUDE_MS) requestAnimationFrame(frame);
    else { cv.remove(); if (claudeCv === cv) claudeCv = null; }
  };
  requestAnimationFrame(frame);
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
    try { if (!document.execCommand("copy")) throw new Error("copy"); done(); } catch (e) { toast("Could not copy"); }
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
  // the pictures of people in a list are put in after the sheet has slid in, a few at a time, so opening it never waits for them
  const late = [];
  const lateAv = ra => { const a = rAv({ ...ra, avatar: null }, 32); if (ownMedia(ra.avatar)) late.push([a, ra.avatar]); return a; };
  const fillLate = () => {
    const batch = late.splice(0, 2);
    batch.forEach(([a, src]) => { if (!a.isConnected) return; const im = picImg(src); im.loading = "eager"; a.prepend(im); });
    if (late.length) requestAnimationFrame(fillLate);
  };
  // an item with keep stays open when tapped, so several can be chosen one after another
  const row = i => h("button", { class: "si" + (i.danger ? " danger" : "") + (i.on ? " on" : "") + (i.left ? " left" : i.icon || i.av ? "" : " plain"), onclick: e => { if (i.keep) i.fn(e.currentTarget); else close(i.fn ? () => i.fn() : undefined); } }, i.av ? h("span", { class: "sic" }, lateAv(i.av)) : i.icon ? h("span", { class: "sic" }, ic(i.icon, 20)) : null, h("span", {}, i.label), i.trail ? h("span", { class: "trail" }, i.trail) : null, i.keep ? h("span", { class: "trail ck" }, ic("check", 18)) : null);
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
  if (late.length) setTimeout(fillLate, 260);
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
  // the body is read before the timer stops, so an answer that stalls half way is cut off too
  try { const r = await fetch(u, { signal: ac.signal }); if (!r.ok) throw new Error("bad"); const txt = await r.text(); return { json: () => JSON.parse(txt), text: () => txt }; } finally { clearTimeout(t); }
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
  // our own endpoint reads the page (https only, no private addresses, size and time caps) and needs a signed in user
  try {
    if (!sbUser) return null;
    const r = await callFn("preview", { url });
    const d = r.ok && r.body;
    if (!d || (!d.title && !d.image)) throw new Error("x");
    const pic = String(d.image || "");
    return { t: String(d.title || ""), d: String(d.description || ""), i: /^https:\/\//i.test(pic) ? pic : "", s: String(d.site || host), v: 2 };
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
        if (k.length > 150) { delete S.previews[k[0]]; pvMem.delete(k[0]); }
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
  let n = i, closeLb, first = true;
  const track = h("div", { class: "lbt" });
  const fail = () => h("p", { class: "note", style: "color:#fff;text-align:center" }, "Photo not available");
  const fill = (slide, k) => {
    const put = src => {
      slide.textContent = "";
      if (!src) { slide.append(fail()); return; }
      const el = h("img", { alt: "" });
      el.onerror = () => { el.onerror = () => { slide.textContent = ""; slide.append(fail()); }; el.src = src; };
      el.src = view(src);
      el.addEventListener("click", e => e.stopPropagation());
      slide.append(el);
    };
    const cached = isImgId(imgs[k]) ? imgPeek(imgs[k]) : imgs[k];
    if (cached !== undefined) put(cached); else imgReal(imgs[k]).then(put);
  };
  // positions are in whole slide widths plus a pixel drag, so a neighbour can never peek in at the edge
  const baseIdx = () => (n > 0 ? 1 : 0);
  const slide = (idx, px, ms) => { track.style.transition = ms ? `transform ${ms}ms cubic-bezier(.25,.8,.25,1)` : "none"; track.style.transform = `translate3d(calc(${-idx} * 100% + ${px}px),0,0)`; };
  const show = () => {
    track.textContent = "";
    for (let k = Math.max(0, n - 1); k <= Math.min(imgs.length - 1, n + 1); k++) {
      const s = h("div", { class: "lbs" });
      track.append(s);
      fill(s, k);
    }
    slide(baseIdx(), 0, 0);
    if (!first) lb.classList.add("sw");
    first = false;
  };
  const lb = h("div", { class: "lb", onclick: () => closeLb() });
  const x = h("button", { class: "ib x", "aria-label": "Close", onclick: () => closeLb() }, ic("close", 22));
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
  // a sideways swipe drags the photos with the finger and settles on the next one; a quick flick is enough
  let sx = 0, sy = 0, st = 0, swipe = false, drag = false, busy = false;
  lb.addEventListener("touchstart", e => { swipe = !busy && e.touches.length === 1; drag = false; if (swipe) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now(); } }, { passive: true });
  lb.addEventListener("touchmove", e => {
    if (!swipe) return;
    const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
    if (!drag && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) drag = true;
    if (!drag) return;
    const edge = (dx > 0 && n === 0) || (dx < 0 && n === imgs.length - 1);
    slide(baseIdx(), edge ? Math.sign(dx) * Math.min(36, Math.abs(dx) / 4) : dx, 0);
  }, { passive: true });
  lb.addEventListener("touchend", e => {
    if (!swipe || !drag) { swipe = false; return; }
    swipe = false; drag = false;
    const dx = e.changedTouches[0].clientX - sx, d = dx < 0 ? 1 : -1;
    const fast = Math.abs(dx) / Math.max(1, Date.now() - st) > 0.35 && Math.abs(dx) > 24;
    if (!(fast || Math.abs(dx) > window.innerWidth * .18) || n + d < 0 || n + d >= imgs.length) { slide(baseIdx(), 0, 140); return; }
    busy = true;
    slide(baseIdx() + d, 0, 150);
    setTimeout(() => { n += d; show(); busy = false; }, 150);
  });
  lb.append(...[track, x, del, cap ? h("div", { class: "cap" }, cap) : null].filter(Boolean));
  closeLb = trackLayer(() => dismiss(lb));
  layer.append(lb);
  show();
}

let stack = [{ r: "home" }];
const scrolls = [];
// a page that was left comes back to the same spot even when its pictures are still loading: the spot is set again until the page is tall enough
let settleOff = null;
function settleScroll(y) {
  if (settleOff) settleOff();
  main.scrollTop = y;
  if (!y) return;
  let n = 0, stop = false;
  const off = () => { stop = true; if (settleOff === off) settleOff = null; main.removeEventListener("touchstart", off); main.removeEventListener("wheel", off); };
  settleOff = off;
  main.addEventListener("touchstart", off, { passive: true });
  main.addEventListener("wheel", off, { passive: true });
  const tick = () => {
    if (stop || n++ > 120) { off(); return; }
    if (Math.abs(main.scrollTop - y) > 1 && main.scrollHeight - main.clientHeight >= y - 1) main.scrollTop = y;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
// a post and one reply opened from it is as deep as it goes, so nobody can wander down one chain forever
const MAX_OPEN_POSTS = 2;
function go(r) {
  if (r && r.r === "thread" && stack.filter(x => x.r === "thread").length >= MAX_OPEN_POSTS) return;
  scrolls.push(main.scrollTop); stack.push(r); hist(false); render("fwd");
  // a chat puts itself at its newest message; the others start at the top
  if (r.r !== "conv" && r.r !== "dm") main.scrollTop = 0;
}
function back() { if (stack.length > 1) history.back(); }
function hist(replace) { const st = { s: JSON.parse(JSON.stringify(stack)), sc: scrolls.slice() }; try { if (replace) history.replaceState(st, ""); else history.pushState(st, ""); } catch (e) {} }
// after the app was closed and opened again the browser has one history entry but the screen has several levels: every level gets its own entry, so one back press goes up one level
function histSync() {
  const cs = history.state;
  if (stack.length < 2 || (cs && Array.isArray(cs.s) && cs.s.length === stack.length)) { hist(true); return; }
  const full = JSON.parse(JSON.stringify(stack)), sc = scrolls.slice();
  try {
    for (let i = 1; i <= full.length; i++) {
      const st = { s: full.slice(0, i), sc: sc.slice(0, i - 1) };
      if (i === 1) history.replaceState(st, ""); else history.pushState(st, "");
    }
  } catch (e) {}
}
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
// back to the top: a long page first jumps close to it, so the glide is short and stays smooth
function scrollMainTop() { if (main.scrollTop > main.clientHeight * 3) main.scrollTop = main.clientHeight * 3; main.scrollTo({ top: 0, behavior: "smooth" }); }
const bar = (l, c, r) => h("div", { class: "bar", onclick: e => { if (!e.target.closest("button, a, input")) scrollMainTop(); } }, l || h("span"), c, r || h("span"));
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
  return new Promise(res => { const i = new Image(); if (cors) i.crossOrigin = "anonymous"; i.referrerPolicy = "no-referrer"; const t = setTimeout(() => res(null), 8000); i.onload = () => { clearTimeout(t); res(i); }; i.onerror = () => { clearTimeout(t); res(null); }; i.src = src; });
}
async function postPic(p) {
  const W = 960, pad = 56, av = 80, fs = 34, lh = 48, cs = getComputedStyle(document.documentElement);
  const bg = cs.getPropertyValue("--bg").trim() || "#161e27", fg = cs.getPropertyValue("--fg").trim() || "#f1f3f5", mu = cs.getPropertyValue("--muted").trim() || "#8d9bae", ac = cs.getPropertyValue("--accent").trim() || "#208bfe";
  const m = document.createElement("canvas").getContext("2d");
  m.font = "400 " + fs + "px system-ui, -apple-system, sans-serif";
  const cw = W - pad * 2;
  const lines = p.text ? wrapLines(m, cleanText(p.text), cw) : [];
  const src = p.imgs && p.imgs.length ? await imgReal(p.imgs[0]) : null;
  const who = p.ai ? { name: "Zenith", handle: "zenith", avatar: (S.zen && S.zen.pfp) || null } : p.ra ? { name: p.ra.name, handle: p.ra.handle, avatar: p.ra.avatar } : { name: S.profile.name, handle: S.profile.handle, avatar: S.profile.avatar };
  // the picture and the avatar load side by side
  const mePromise = who && who.avatar ? loadPicImg(view(who.avatar), /^https?:/.test(view(who.avatar))) : Promise.resolve(null);
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
  const me = await mePromise;
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
  const name = p.ai ? "Zenith" : (who.name || who.handle || "user"), handle = p.ai ? "@zenith" : "@" + who.handle;
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
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); return true; } catch (e) { if (e && e.name === "AbortError") return; } }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "nook-post.png";
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("Picture saved");
    return true;
  } catch (e) {
    if (e && e.name === "AbortError") return false;
    toast("Could not make picture");
    return false;
  }
}
// who a link can be sent to: my own notes, and people who follow me while I follow them
async function messageTargets() {
  const out = [];
  S.chats.filter(c => !(c.msgs || []).some(m => m.ai)).forEach(c => out.push({ kind: "note", id: c.id, name: c.name }));
  if (sbUser) {
    const [a, b, k1, k2] = await Promise.all([
      pageAll((f, t) => sb.from("follows").select("followee_id").eq("follower_id", sbUser.id).order("followee_id").range(f, t)),
      pageAll((f, t) => sb.from("follows").select("follower_id").eq("followee_id", sbUser.id).order("follower_id").range(f, t)),
      pageAll((f, t) => sb.from("blocks").select("blocked_id").eq("blocker_id", sbUser.id).order("blocked_id").range(f, t)),
      pageAll((f, t) => sb.from("blocks").select("blocker_id").eq("blocked_id", sbUser.id).order("blocker_id").range(f, t))
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
// a share of a post that lives on the server is counted once per person
function countShare(p) {
  if (!p.remote || !sbUser) return;
  sb.from("post_shares").upsert({ post_id: p.remote, user_id: sbUser.id }, { onConflict: "post_id,user_id", ignoreDuplicates: true }).then(r => {
    if (r && r.error) return;
    if (!p.sharedByMe) { p.sharedByMe = true; p.shc = (p.shc || 0) + 1; refreshActs(p); }
  }, () => {});
}
async function sharePost(p) {
  const targets = await messageTargets().catch(() => []);
  const pic = async () => { toast("Making picture..."); try { return await postPic(p); } catch (e) { toast("Could not make picture"); return null; } };
  sheet([
    { icon: "edit", label: "Post", fn: async () => { const b = await pic(); if (b) openCompose({ files: [new File([b], "nook-post.png", { type: "image/png" })] }); } },
    ...(targets.length ? [{ icon: "chat", label: "Message", fn: () => chooseTarget(targets, async t => {
      if (p.ai && t.kind === "user") { try { const pu = await zenPfpUrl(); await sendDm(t.id, ZPOST + JSON.stringify({ x: p.text, t: p.t, ...(pu ? { a: pu } : {}) }), [], []); toast("Sent to " + t.name); } catch (e) { toast("Could not send"); } return; }
      if (p.remote && t.kind === "user") { try { await sendDm(t.id, RPOST + JSON.stringify({ id: p.remote, u: p.ra ? p.ra.id : sbUser.id }), [], []); countShare(p); toast("Sent to " + t.name); } catch (e) { toast("Could not send. " + plainErr(e, "Try again")); } return; }
      if (t.kind === "note") {
        // a post goes into notes as the post itself, the way it goes to a person, not as a picture of it
        const chat = S.chats.find(x => x.id === t.id);
        if (!chat) return;
        const m = { id: uid(), text: "", t: Date.now(), imgs: [] };
        if (p.ai) { const pu = await zenPfpUrl().catch(() => null); m.zpost = { x: String(p.text || "").slice(0, 600), t: p.t, a: pu || null }; }
        else if (p.remote) { m.rpost = { id: p.remote, u: p.ra ? p.ra.id : sbUser.id }; countShare(p); }
        else { m.text = p.text || ""; m.imgs = (p.imgs || []).slice(); }
        chat.msgs.push(m); persist(); toast("Saved in " + t.name);
        return;
      }
      const b = await pic(); if (b) sendPicTo(t, b, true).catch(() => toast("Could not send"));
    }) }] : []),
    { icon: "share", label: "Another app", fn: () => { sharePic(p).then(ok => { if (ok) countShare(p); }, () => {}); } },
    { label: "Cancel", cancel: true }], "Share post");
}
// nc: inside an opened reply the list is flat and the numbers would only count down the chain, so the comment icon shows alone
function acts(p, big, nc) {
  const n = nc ? 0 : Math.max(p.ra ? (p.rp || 0) : 0, replyTotal(p.id));
  const ab = (cls, name, cnt, on, fn, label, fill) => h("button", { class: "ab " + cls + (on ? " on" : "") + (bump === p.id + cls ? " bump" : ""), "aria-label": label, onclick: e => { e.stopPropagation(); fn(); } }, ic(name, big ? 24 : 20, fill && on), cnt ? h("span", {}, cnt) : null);
  if (p.ra) return h("div", { class: "acts" + (big ? " big" : ""), "data-pid": p.id, "data-nc": nc ? "1" : null },
    ab("rl", "reply", n, false, () => openCompose({ parent: p.id }), "Reply"),
    ab("rp", "repost", p.rpc || 0, p.reposted, () => toggleRemoteRepost(p, big), "Repost"),
    ab("like", "heart", p.lc || 0, p.liked, () => toggleRemoteLike(p, big), "Like", true),
    ab("bm", "bookmark", p.svc || 0, p.saved, () => { setSaved(p, !p.saved); bump = p.id + "bm"; persist(); refresh(p, big); toast(p.saved ? "Saved" : "Removed from saved"); }, "Save", true),
    ab("sh", "share", p.shc || 0, false, () => sharePost(p), "Share post"),
    ab("mo", "dots", 0, false, () => sheet([...(typeof p.text === "string" && p.text ? [{ icon: "copy", label: "Copy post text", fn: () => copy(p.text || "") }] : []), { icon: "eyeoff", label: "Not interested", danger: true, fn: () => lessLikeThis(p) }, zenithOfOwner(p) ? { icon: "trash", label: "Delete post", danger: true, fn: () => confirmSheet("Delete this post of Zenith and its replies?", "Delete", () => deleteZenithPost(p)) } : { icon: "flag", label: "Report post", danger: true, fn: () => reportPost(p) }]), "More"));
  return h("div", { class: "acts" + (big ? " big" : ""), "data-pid": p.id, "data-nc": nc ? "1" : null },
    ab("rl", "reply", n, false, () => openCompose({ parent: p.id }), "Reply"),
    ab("rp", "repost", p.ai ? 0 : p.rpc || 0, p.reposted, () => (p.remote ? toggleRemoteRepost(p, big) : (p.reposted = !p.reposted, p.rpAt = p.reposted ? Date.now() : 0, bump = p.id + "rp", persist(), refresh(p, big))), "Repost"),
    ab("like", "heart", p.ai ? (p.zenLike ? 1 : 0) : p.lc || 0, p.liked, () => (p.remote ? toggleRemoteLike(p, big) : (p.liked = !p.liked, bump = p.id + "like", persist(), refresh(p, big))), "Like", true),
    ab("bm", "bookmark", p.svc || 0, p.saved, () => { setSaved(p, !p.saved); bump = p.id + "bm"; persist(); refresh(p, big); toast(p.saved ? "Saved" : "Removed from saved"); }, "Save", true),
    ab("sh", "share", p.shc || 0, false, () => sharePost(p), "Share post"),
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
  if (cardless(p)) col.append(txBody(cardless(p), "", p.edited));
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
// [E3] a long list is drawn in slices: the first screenful at once, the rest in short slices of the main thread after it, appended in order
// behind the last card, so the page ends up the same but never blocks for seconds (2500 cards took 3.6 s in one piece at 4x CPU).
// The slices stop by themselves when the list is taken off the page (another screen was drawn).
const POST_FIRST = 12, POST_SLICE_MS = 8;
function postList(arr, opt) {
  opt = opt || {};
  if (!arr.length) return opt.empty;
  const f = document.createDocumentFragment();
  const n = arr.length > POST_FIRST + 24 ? POST_FIRST : arr.length;
  for (let i = 0; i < n; i++) f.append(postCard(arr[i], opt));
  if (n < arr.length) {
    let last = f.lastChild, i = n;
    // postCard reads these two while the page is being drawn; they are put back around each slice
    const fr = fresh, bp = bump;
    let waits = 0;
    const slice = () => {
      // a list that is not on the page yet (a caller that attaches it a little later) is waited for, a few times; one taken off is dropped
      if (!last.isConnected) { if (++waits <= 20) setTimeout(slice, 250); return; }
      const sf = fresh, sb = bump, g = document.createDocumentFragment(), t0 = performance.now();
      fresh = fr; bump = bp;
      try { do g.append(postCard(arr[i++], opt)); while (i < arr.length && performance.now() - t0 < POST_SLICE_MS); }
      finally { fresh = sf; bump = sb; }
      const e = g.lastChild;
      last.after(g);
      last = e;
      if (i < arr.length) setTimeout(slice, 0);
    };
    setTimeout(slice, 0);
  }
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
// the owner takes down what Zenith posts in public (everybody else can only report it); the server checks the owner again
const zenithOfOwner = p => !!(p.ra && p.remote && isOwner() && S.zen && S.zen.id && p.ra.id === S.zen.id);
async function deleteZenithPost(p) {
  const { data, error } = await sb.rpc("nook_owner_delete_zenith_post", { p_id: p.remote });
  if (error || data !== true) { toast("Could not delete the post"); return; }
  const gone = new Set([p.id, ...flat(p.id, 0, []).map(x => x.p.id)]);
  S.posts = S.posts.filter(x => !gone.has(x.id));
  S.lists.forEach(l => { l.ids = l.ids.filter(i => !gone.has(i)); });
  persist();
  while (stack.length > 1 && stack[stack.length - 1].r === "thread" && gone.has(stack[stack.length - 1].id)) { stack.pop(); scrolls.pop(); }
  render();
  toast("Post deleted");
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
  await Promise.all(items.map(async x => {
    const key = x.ai ? "post:" + x.id : "flag:" + (x.remote || x.id);
    const k = zenKey(key);
    const { error } = await sb.from("zenith_docs").delete().eq("owner_id", sbUser.id).eq("kind", k.kind).eq("doc_id", k.doc_id);
    if (!error) zenSeen.delete(key);
  }));
}
async function deleteRemote(items) {
  if (!sbUser) return;
  const own = items.filter(x => x.remote && !x.ra && !x.ai);
  if (!own.length) return;
  const ids = own.map(x => x.remote);
  const paths = [];
  own.forEach(x => (x.media || []).forEach(u => { const p = storagePath(u, "media"); if (p && p.startsWith(sbUser.id + "/")) paths.push(p); }));
  const { data: rows } = await sb.from("posts").select("id, media_url").in("id", ids).eq("user_id", sbUser.id);
  (rows || []).forEach(r => parseMedia(r.media_url).forEach(u => { const p = storagePath(u, "media"); if (p && p.startsWith(sbUser.id + "/")) paths.push(p); }));
  const { data: kids } = await sb.from("posts").select("id, media_url").in("parent_id", ids).eq("user_id", sbUser.id);
  (kids || []).forEach(r => parseMedia(r.media_url).forEach(u => { const p = storagePath(u, "media"); if (p && p.startsWith(sbUser.id + "/")) paths.push(p); }));
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
  let up = [];
  try { up = added.length ? await uploadMedia(added) : []; } catch (e) { up = null; }
  if (!up) { toast("Could not upload the photo. The edit was not saved"); return false; }
  const all = kept.concat(up);
  const { error } = await sb.from("posts").update({ body: text, media_url: all.length ? JSON.stringify(all) : null }).eq("id", ed.remote);
  if (error) {
    toast(/rate_limited/.test(error.message || "") ? "Wait a few seconds before editing again. The edit was not saved" : "The edit was not saved. " + plainErr(error, "Try again"));
    return false;
  }
  const dropped = (ed.media || []).filter(u => !all.includes(u)).map(u => storagePath(u, "media")).filter(Boolean);
  ed.media = all; persist();
  if (dropped.length) sb.storage.from("media").remove(dropped).then(() => {}, () => {});
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
      cardless(p) ? txBody(cardless(p), " big", p.edited) : null,
      p.imgs.length ? imgGrid(p.imgs) : firstUrl(p.text) ? linkCard(firstUrl(p.text)) : null,
      h("div", { class: "when" }, new Date(p.t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))),
    st.length ? h("div", { class: "stats" }, st) : null,
    h("div", { class: "mp", style: "padding-top:0" }, acts(p, true)));
}
function threadV(c) {
  const p = byId(c.id);
  topEl.append(bar(backBtn(), ttl("Post")));
  if (!p) { main.append(emptyState("smile", "This post is gone.")); return; }
  const anc = [];
  let q = p.parent ? byId(p.parent) : null;
  while (q && q !== p && anc.length < 60 && !anc.includes(q)) { anc.unshift(q); q = q.parent ? byId(q.parent) : null; }
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
  if (pr.bannerTheme === "avatar" && (pr.banner || pr.avatar)) bn.append(mkImg(pr.banner || pr.avatar, "pic blur")); else if (pr.banner) bn.append(picImg(pr.banner));
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
        h("button", { class: "ghost", "aria-label": "More", onclick: () => sheet([{ icon: "copy", label: "Copy handle", fn: () => copy("@" + pr.handle) }, { icon: "sliders", label: "Settings", fn: () => root("settings") }, { label: "Cancel", cancel: true }]) }, ic("dots", 20)))),
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
  // rows of the same shape as the chats shimmer until the real ones are drawn, so the page never looks empty
  const skelRows = () => Array.from({ length: Math.max(1, Math.min(6, Number((() => { try { return localStorage.getItem("nook-inbox-n"); } catch (e) { return 0; } })()) || 1)) }, () => h("div", { class: "lrow skelrow" }, h("div", { class: "sk av48 skel" }), h("div", { class: "nm" }, h("div", { class: "sk l1 skel" }), h("div", { class: "sk l2 skel" }))));
  const emptyBox = h("div");
  let inboxN = -1;
  const showEmpty = () => {
    emptyBox.textContent = "";
    if (inboxN === 0 && !S.chats.length) emptyBox.append(emptyState("smile", "Say hi to yourself.", h("button", { class: "pri", onclick: newChat }, "New chat")));
  };
  const inboxHit = sbUser ? cacheRead("inbox:" + sbUser.id) : null;
  if (!inboxHit) dmBox.append(...skelRows());
  main.append(dmBox);
  let paintSeq = 0;
  const paintInbox = convos => {
    const seq = ++paintSeq;
    // nothing is waited for before the rows are drawn: names, pictures and times come from this phone, the message previews open a moment later
    if (sbUser) { primeDmMutes(); loadDmMutes().then(() => { if (seq === paintSeq) dmBox.querySelectorAll(".lrow[data-uid]").forEach(r => { if (dmHideSet.has(r.dataset.uid)) r.remove(); }); }); }
    convos = convos.filter(cv => !dmHideSet.has(cv.other)).sort((a, b) => (dmPinned(b.other) ? 1 : 0) - (dmPinned(a.other) ? 1 : 0));
    dmBox.textContent = "";
    inboxN = convos.length; showEmpty();
    try { localStorage.setItem("nook-inbox-n", String(convos.length)); } catch (e) {}
    convos.forEach(cv => dmBox.append(dmRow(cv, "")));
    convos.forEach(cv => {
      if (!cv.last) return;
      openText(cv.other, cv.last.body, true).then(zUn).then(b => {
        if (seq !== paintSeq) return;
        const sub = dmBox.querySelector('[data-uid="' + cv.other + '"] .sub');
        if (sub && !sub.classList.contains("tp")) sub.textContent = dmGist(b, cv.last.media, cv.last.sender_id === sbUser.id);
      }).catch(() => {});
    });
    // the newest chats are downloaded in the background, so tapping one shows its messages right away
    convos.slice(0, 3).forEach(cv => {
      const k = "thread:" + sbUser.id + ":" + cv.other, hit = cacheRead(k);
      if (hit && Date.now() - hit.t < 60000) return;
      dmThread(cv.other).then(rows => cacheWrite(k, rows.slice(-100)), () => {});
      sharedKey(cv.other).catch(() => {});
    });
  };
  if (sbUser) {
    const hit = cacheRead("inbox:" + sbUser.id);
    if (hit) paintInbox(hit.v);
    let sig = hit ? JSON.stringify(hit.v) : "";
    const pull = () => dmInbox().then(convos => {
      refreshBadge();
      if (!dmBox.isConnected) return;
      const next = JSON.stringify(convos);
      if (next !== sig) { sig = next; cacheWrite("inbox:" + sbUser.id, convos); paintInbox(convos); }
    }, () => { if (!hit && dmBox.isConnected) { dmBox.textContent = ""; inboxN = 0; showEmpty(); } });
    refreshChat = pull;
    let busy = false, polledAt = Date.now();
    const iv = setInterval(() => { if (!document.hidden && !busy && Date.now() - polledAt >= pollGap() - 500) { polledAt = Date.now(); busy = true; Promise.resolve(pull()).finally(() => { busy = false; }); } }, 5000);
    pageStop = () => clearInterval(iv);
    pull();
  }
  main.append(emptyBox);
  if (!sbUser) { inboxN = 0; showEmpty(); }
  const mine = S.chats.slice().sort((a, b) => lastT(b) - lastT(a)).map(c => {
    const last = c.msgs[c.msgs.length - 1];
    return h("div", { class: "lrow", onclick: () => go({ r: "conv", id: c.id }) }, avatar(48), h("div", { class: "nm" }, h("b", {}, c.name), h("span", { class: "sub" }, last ? last.text || (last.rpost || last.zpost ? "Shared a post" : "Sent a photo") : "No messages yet")), last ? h("span", { class: "time" }, ago(last.t)) : null);
  });
  main.append(...mine);
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
  if (!chat) { go({ r: "chat" }); return; }
  topEl.append(h("div", { class: "bar chb" }, backBtn(),
    h("div", { class: "who" }, avatar(36), h("div", { class: "wn" }, h("b", {}, chat.name), h("span", {}, "@" + S.profile.handle))),
    ibtn("dots", "Chat options", () => sheet([
      { icon: "edit", label: "Rename chat", fn: () => renameChat(chat) },
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
  // only the newest 80 messages are drawn at first; older ones are added above on request
  let shownFrom = Math.max(0, chat.msgs.length - 80);
  const earlier = h("button", { class: "ghost", type: "button", style: "margin:8px auto;display:block" }, "Show earlier messages");
  earlier.addEventListener("click", () => {
    const upto = shownFrom, from = Math.max(0, upto - 80), h0 = main.scrollHeight, t0 = main.scrollTop;
    const frag = document.createDocumentFragment();
    chat.msgs.slice(from, upto).forEach(m => frag.append(bubble(m)));
    earlier.after(frag);
    shownFrom = from;
    if (!from) earlier.remove();
    main.scrollTop = t0 + (main.scrollHeight - h0);
  });
  if (shownFrom) list.append(earlier);
  chat.msgs.slice(shownFrom).forEach(m => list.append(bubble(m)));
  const jobs = [], pend = [];
  const strip = h("div", { class: "cpend", hidden: true });
  const ta = h("textarea", { rows: 1, placeholder: "Message", "aria-label": "Message", enterkeyhint: "send", autocomplete: "off" });
  ta.value = chat.draft || "";
  fillReply = pre => { if (!ta.value.toLowerCase().startsWith(pre.trim())) ta.value = pre + ta.value; chat.draft = ta.value; persistDraft(); sync(); ta.focus(); };
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
    if (!pend.length && claudeCmd(ta, () => { chat.draft = ""; persistDraft(); sync(); }) !== "no") return;
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
  zpop.addEventListener("click", () => { ta.value = ta.value.replace(/@\w*$/, "@zenith "); zpop.classList.remove("on"); chat.draft = ta.value; persistDraft(); sync(); ta.focus(); });
  const dock = h("div", { class: "cdock" }, zpop, strip, h("div", { class: "cin" }, att, ta, send));
  ta.addEventListener("input", () => { chat.draft = ta.value; persistDraft(); zpop.classList.toggle("on", zOn() && zenHint(ta.value)); });
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
  // while the chat is opening it is held at its newest message, whatever the layout does underneath, until the person scrolls it themselves
  const born = Date.now();
  let touched = false;
  ["touchstart", "wheel"].forEach(ev => main.addEventListener(ev, () => { touched = true; }, { passive: true }));
  const opening = () => !touched && Date.now() - born < 2500;
  main.scrollTop = main.scrollHeight;
  main.onscroll = () => { stick = opening() || main.scrollHeight - main.scrollTop - main.clientHeight < 120; };
  let roRaf = 0;
  convRO = new ResizeObserver(() => { if (!(stick || opening()) || roRaf) return; roRaf = requestAnimationFrame(() => { roRaf = 0; main.scrollTop = main.scrollHeight; }); });
  convRO.observe(list);
  convRO.observe(main);
  requestAnimationFrame(() => { if (stick) main.scrollTop = main.scrollHeight; });
  [120, 400, 900].forEach(ms => setTimeout(() => { if (opening() && main.isConnected && list.isConnected) main.scrollTop = main.scrollHeight; }, ms));
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
  if (!l) { go({ r: "lists" }); return; }
  topEl.append(bar(backBtn(), ttl(l.name), ibtn("dots", "List options", () => sheet([
    { icon: "edit", label: "Edit list", fn: () => listForm(l) },
    { icon: "trash", label: "Delete list", danger: true, fn: () => confirmSheet("Delete this list? The posts stay.", "Delete", () => { S.lists = S.lists.filter(x => x !== l); persist(); back(); }) }]))));
  const a = l.ids.map(byId).filter(Boolean).sort((x, y) => y.t - x.t);
  main.append(postList(a, { replyTo: true, empty: emptyState("list", "Empty list. Use the three dots on a post and pick Add to list.") }));
}

async function wipeServerExtras() {
  if (!sbUser) return;
  const me = sbUser.id;
  const { data: msgs, error: mErr } = await pageAll((a, b) => sb.from("messages").select("sender_id, recipient_id").or("sender_id.eq." + me + ",recipient_id.eq." + me).order("created_at").order("id").range(a, b));
  if (mErr) throw mErr;
  const others = [...new Set((msgs || []).map(m => (m.sender_id === me ? m.recipient_id : m.sender_id)))];
  for (const r of await Promise.all(others.map(o => sb.rpc("clear_chat", { p_other: o })))) if (r.error) throw r.error;
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
// the pictures of one record are fetched side by side (at most 4 at once) and added to the zip in their own order
async function zipMediaAll(files, srcs, folder, base) {
  const list = srcs || [], paths = new Array(list.length).fill(null), got = list.map(() => []);
  let next = 0;
  const worker = async () => { while (next < list.length) { const i = next++; const real = await imgReal(list[i]); if (real) paths[i] = await zipMedia(got[i], real, folder, base + "-" + i); else backupSkipped++; } };
  await Promise.all(Array.from({ length: Math.min(4, list.length) }, worker));
  got.forEach(g => g.forEach(f => files.push(f)));
  return paths;
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
    rec.media = await zipMediaAll(files, p.imgs, "posts/images", p.id);
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
      rec.media = await zipMediaAll(files, m.imgs, folder + "/images", m.id);
      msgs.push(rec); mi++;
    }
    files.push({ name: folder + "/messages.json", data: enc(JSON.stringify({ name: c.name, id: c.id, t: c.t, messages: msgs }, null, 2)) });
  }
  const pr = S.profile;
  const profile = { name: pr.name, handle: pr.handle, bio: pr.bio || "", bannerTheme: pr.bannerTheme || "default", avatar: null, banner: null };
  if (pr.avatar) profile.avatar = await zipMedia(files, await imgReal(pr.avatar), "profile", "avatar");
  if (pr.banner) profile.banner = await zipMedia(files, await imgReal(pr.banner), "profile", "banner");
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
// the output is counted while it streams out and the stream is cut off at the cap, so a tiny file cannot grow into the phone's memory
async function inflateRaw(raw, cap) {
  const rd = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    n += value.length;
    if (n > cap) { rd.cancel().catch(() => {}); throw new Error("too big"); }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of parts) { out.set(c, o); o += c.length; }
  return out;
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
    out[name] = method === 0 ? raw : method === 8 ? await inflateRaw(raw, Math.min(200 * 1024 * 1024, 400 * 1024 * 1024 - total, usize + 65536)) : null;
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
      (Array.isArray(d.lists) ? d.lists : []).forEach(l => { if (l && typeof l.id === "string" && Array.isArray(l.ids) && !S.lists.some(x => x.id === l.id)) { S.lists.push({ id: l.id, name: String(l.name || "List"), desc: String(l.desc || ""), ids: l.ids.filter(i => typeof i === "string") }); n++; } });
    } else {
      const files = await readZip(await file.arrayBuffer());
      const text = path => (files[path] ? new TextDecoder().decode(files[path]) : null);
      const media = path => { if (!path || !files[path]) return null; return bytesToDataURL(files[path], MIMES[path.split(".").pop().toLowerCase()] || "application/octet-stream"); };
      const postsJ = text("posts/posts.json"), repJ = text("posts/comments/replies.json");
      const all = [...(postsJ ? JSON.parse(postsJ) : []), ...(repJ ? JSON.parse(repJ) : [])];
      for (const r of all) {
        if (!r || typeof r.id !== "string") continue;
        if (byId(r.id)) continue;
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
        (d.lists || []).forEach(l => { if (l && Array.isArray(l.ids) && !S.lists.some(x => x.id === l.id)) { S.lists.push({ id: l.id, name: String(l.name || "List"), desc: String(l.desc || ""), ids: l.ids.filter(i => typeof i === "string") }); n++; } });
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
  return fetch(SB_URL + "/functions/v1/zenith", { method: "POST", headers: { "content-type": "application/json", apikey: SB_KEY, ...(tok ? { authorization: "Bearer " + tok } : {}) }, body: JSON.stringify(body) , signal: AbortSignal.timeout ? AbortSignal.timeout(body.stream ? 90000 : 25000) : undefined });
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
async function zAsk(chat, list, bubble, m) {
  if (!zOn() || !/@zenith/i.test(m.text)) return;
  const hist0 = chat.msgs.filter(x => x.text || (x.imgs && x.imgs.length)).slice(-30);
  // only the newest pictures can be sent along, so only those are brought out of the store
  let found = 0;
  for (let i = hist0.length - 1; i >= 0 && found < 6; i--) {
    const x = hist0[i];
    if (!x.imgs || !x.imgs.length) continue;
    const real = await Promise.all(x.imgs.map(s => imgReal(s).then(r => r || "")));
    hist0[i] = { ...x, imgs: real };
    found += real.filter(s => /^data:image\//.test(s)).length;
  }
  const hist = hist0.filter(x => x.text || (x.imgs && x.imgs.some(s => /^data:image\//.test(s))));
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
  // the empty answer is only on the screen while it streams; it joins the chat once there is something to keep
  const ai = { id: uid(), text: "", t: Date.now(), imgs: [], ai: true };
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
      if (!zScrollQ) zScrollQ = requestAnimationFrame(() => { zScrollQ = 0; main.scrollTop = main.scrollHeight; });
      setTimeout(step, 10 + Math.random() * 3);
      return;
    }
    if (finished) {
      // an error line stays on the screen but is never saved as something Zenith said
      if (failed) { chat.msgs = chat.msgs.filter(x => x !== ai); persist(); return; }
      ai.text = full; if (!chat.msgs.includes(ai)) chat.msgs.push(ai); persist(); return;
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
// everything Zenith writes in public is PG-13, while the chats where the owner talks to him stay 18+
const ZPUB = ZSYS.replace("your age rating is 18+", "your age rating is PG-13") + " Everyone can read this, so keep it PG-13: nothing sexual or crude, no strong swearing and no talk about drugs.";
const ZSYS_POST_PUB = ZSYS_POST.replace(ZSYS, ZPUB);
const ZSYS_REPLY_PUB = ZSYS_REPLY.replace(ZSYS, ZPUB);
const ZSYS_LIKE = "Answer with only YES or NO. Answer YES only if you genuinely like this post.";
const ZEN_SVG = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="zgrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14466f"/><stop offset="1" stop-color="#208bfe"/></linearGradient></defs><circle cx="50" cy="50" r="50" fill="url(#zgrad)"/><text x="50" y="52" text-anchor="middle" dominant-baseline="central" font-size="50" font-weight="700" fill="#ffffff" font-family="Inter,system-ui,sans-serif">Z</text></svg>';
// [E3] the Z badge is parsed once and copied
let zenAvTpl = null;
function zenAv(size) {
  const a = h("div", { class: "av zenav" });
  if (S && S.zen && S.zen.pfp) { const im = h("img", { alt: "", decoding: "async" }); im.src = S.zen.pfp; a.append(im); }
  else {
    if (!zenAvTpl) { zenAvTpl = document.createElement("div"); zenAvTpl.innerHTML = ZEN_SVG; }
    zenAvTpl.childNodes.forEach(n => a.append(n.cloneNode(true)));
  }
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
    const n = Math.max(p.ra ? (p.rp || 0) : 0, replyTotal(p.id));
    let sp = b.querySelector("span");
    if (n) { if (!sp) { sp = h("span", {}); b.append(sp); } sp.textContent = String(n); } else if (sp) sp.remove();
  });
}
// chats that came from the saved copy while the chat list is open show up at once
const chatListRefresh = () => { const cur = stack[stack.length - 1]; if (cur && cur.r === "chat" && !layer.childElementCount) render(); };
const zenRefresh = () => {
  const sig = S.posts.length + ":" + S.posts.filter(p => p.zenLike).length;
  if (sig === zenSig) return;
  const cur = stack[stack.length - 1];
  if (layer.childElementCount || cur.r === "conv") return;
  zenSig = sig;
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
// his answers come from the server now and are real posts everybody can see; the phone only brings in the copies kept for his older posts
async function zenTick() {
  if (zenBusy || !S || !zOn() || !zenSyncOn || document.visibilityState !== "visible") return;
  zenBusy = true;
  try {
    if (Date.now() - zenPulled > 45000) { zenPulled = Date.now(); if (await zenPull()) { zenRefresh(); chatListRefresh(); } }
  } catch (e) {} finally { zenBusy = false; }
}
// asks the server to look at the owner's new posts right away instead of at its next minute
let zenNudgeAt = 0;
async function zenNudge() {
  if (!sbUser || !S || !zOn() || !isOwner() || Date.now() - zenNudgeAt < 8000) return;
  zenNudgeAt = Date.now();
  try {
    const r = await zFetch({ action: "tick" });
    const j = await r.json().catch(() => null);
    if (j && (j.owner || j.liked)) loadFeed().catch(() => {});
  } catch (e) {}
}
// Zenith's posts, replies, likes and chats are mirrored into a table that only the owner can read,
// so they follow the owner to every device and nobody else can see or touch them.
const zenJson = o => JSON.stringify(o);
function zenDocs() {
  const out = new Map();
  out.set("state:main", { z: S.zen });
  // the instructions for his own posts go along, so the server writes in the same voice while the app is closed
  out.set("state:prompt", { post: ZSYS_POST_PUB, reply: ZSYS_REPLY_PUB, tz: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || "Asia/Muscat" });
  S.posts.forEach(p => {
    if (p.ai) { const rest = Object.assign({}, p); delete rest.imgs; out.set("post:" + p.id, rest); }
    else if (p.zenReplied || p.zenAnswered || p.zenLikeChecked || p.zenLike) out.set("flag:" + (p.remote || p.id), { local: p.id, remote: p.remote || null, zenReplied: !!p.zenReplied, zenAnswered: !!p.zenAnswered, zenLikeChecked: !!p.zenLikeChecked, zenLike: !!p.zenLike });
  });
  S.chats.forEach(c => { if (c.msgs.some(m => m.ai)) out.set("chat:" + c.id, { id: c.id, name: c.name, t: c.t, msgs: c.msgs.map(m => ({ id: m.id, text: m.text, t: m.t, ai: !!m.ai, ph: (m.imgs || []).map(imgH) })) }); });
  return out;
}
// the sealed chat is bound to its own row, so the server cannot hand one chat back as another; copies sealed before that still open
const zenRowId = key => "zenith:" + (sbUser ? sbUser.id : "") + ":" + key;
const zenKey = k => { const i = k.indexOf(":"); return { kind: k.slice(0, i), doc_id: k.slice(i + 1) }; };
// the pictures of a chat with Zenith go up locked with the owner's key, like the notes, and come back with the text
async function zenChatMedia(d) {
  const k = await sharedKey(sbUser.id);
  const c = S.chats.find(x => x.id === d.id);
  const msgs = [];
  for (const m of d.msgs) {
    const lm = c && c.msgs.find(x => x.id === m.id);
    const media = [];
    if (lm && (lm.imgs || []).length) {
      const have = lm.zm || [];
      for (const src of lm.imgs) {
        const hsh = imgH(src);
        let e = have.find(x => x.h === hsh);
        if (!e) { const real = await imgReal(src); if (!/^data:/.test(real || "")) continue; e = { h: hsh, d: await notePicOut(k, real) }; }
        media.push(e);
      }
      lm.zm = media;
    }
    const rest = Object.assign({}, m); delete rest.ph;
    msgs.push(Object.assign(rest, { media: media.map(e => e.d) }));
  }
  return msgs;
}
// [E3] a document that is the same as at the last look keeps its hash (compared against a private copy, see jsame), so a sync that
// changed nothing no longer walks and hashes thousands of posts
const zenDocMemo = new Map();
function zenDocHash(key, data) {
  const m = zenDocMemo.get(key);
  if (m && jsame(m.snap, data)) return m.hh;
  const hh = zenHash(data);
  zenDocMemo.set(key, { snap: jsnap(data), hh });
  return hh;
}
async function zenSync() {
  if (!zenSyncOn || zenBusySync || !sbUser || !S || !isOwner()) return;
  zenBusySync = true;
  try {
    const now = zenDocs();
    const up = [], del = [];
    zenDocMemo.forEach((_, k) => { if (!now.has(k)) zenDocMemo.delete(k); });
    now.forEach((data, key) => {
      const hh = zenDocHash(key, data);
      if (zenHashes.get(key) === hh && zenSeen.has(key)) return;
      const j = zenJson(data);
      if (zenSeen.get(key) !== j) up.push({ key, data, j, hh }); else zenHashes.set(key, hh);
    });
    // a wiped device must never wipe the copy on the server
    if (S.posts.length || S.chats.length) zenSeen.forEach((j, key) => { if (!now.has(key) && !/"pub":/.test(j || "")) del.push(key); });
    // his chats are sealed with the owner's own chat key before the copy leaves the phone, so the server cannot read them
    let seal = null;
    if (up.some(u => u.key.startsWith("chat:"))) { try { const k = await sharedKey(sbUser.id); seal = (o, key) => noteSeal(k, o, zenRowId(key)); } catch (e) { seal = null; } }
    for (let i = 0; i < up.length; i += 100) {
      const part = up.slice(i, i + 100).filter(u => seal || !u.key.startsWith("chat:"));
      if (!part.length) continue;
      for (const u of part) if (u.key.startsWith("chat:")) u.sealed = { id: u.data.id, enc: await seal({ name: u.data.name, t: u.data.t, msgs: await zenChatMedia(u.data) }, u.key) };
      const rows = part.map(u => Object.assign({ owner_id: sbUser.id, data: u.sealed || u.data, updated_at: new Date().toISOString() }, zenKey(u.key)));
      const { error } = await sb.from("zenith_docs").upsert(rows, { onConflict: "owner_id,kind,doc_id" });
      if (error) throw error;
      part.forEach(u => { zenSeen.set(u.key, u.j); zenHashes.set(u.key, u.hh); });
    }
    for (const key of del) {
      const k = zenKey(key);
      const { error } = await sb.from("zenith_docs").delete().eq("owner_id", sbUser.id).eq("kind", k.kind).eq("doc_id", k.doc_id);
      if (!error) zenSeen.delete(key);
    }
  } catch (e) {} finally { zenBusySync = false; }
}
// sealed chat rows that were opened and merged once are not opened again until the server copy changes
const zenEncDone = new Map();
let zenPullSig = "", zenPullAt = 0, zenFullAt = 0, zenPulledIso = "", zenFullNext = false;
const zenDelKey = () => "nook-zdel-" + (sbUser ? sbUser.id : "");
// copies he removed on another device go from this one too; a missing table (older server) simply means nothing is removed
async function zenApplyDeleted() {
  let cur = "";
  try { cur = localStorage.getItem(zenDelKey()) || ""; } catch (e) {}
  let q = sb.from("zenith_deleted").select("kind, doc_id, deleted_at").eq("owner_id", sbUser.id).order("deleted_at", { ascending: true }).limit(1000);
  if (cur) q = q.gt("deleted_at", cur);
  const { data, error } = await q;
  if (error || !data || !data.length) return false;
  let changed = false;
  const gonePosts = new Set(), goneChats = new Set();
  data.forEach(r => {
    zenSeen.delete(r.kind + ":" + r.doc_id);
    if (r.kind === "post") gonePosts.add(r.doc_id); else if (r.kind === "chat") goneChats.add(r.doc_id);
  });
  const gone = new Set(S.posts.filter(x => x.ai && gonePosts.has(x.id)).map(x => x.id));
  if (gone.size) {
    for (let grew = true; grew;) { grew = false; S.posts.forEach(x => { if (x.ai && x.parent && gone.has(x.parent) && !gone.has(x.id)) { gone.add(x.id); grew = true; } }); }
    S.zen.gone = (S.zen.gone || []).concat([...gone]).slice(-500);
    S.posts = S.posts.filter(x => !gone.has(x.id));
    S.lists.forEach(l => { l.ids = l.ids.filter(i => !gone.has(i)); });
    dropPostIndex();
    changed = true;
  }
  if (S.chats.some(c => goneChats.has(c.id))) { S.chats = S.chats.filter(c => !goneChats.has(c.id)); changed = true; }
  try { localStorage.setItem(zenDelKey(), data[data.length - 1].deleted_at); } catch (e) {}
  if (changed) persist();
  return changed;
}
async function zenPull() {
  if (!sbUser || !S || !isOwner()) return;
  // a small check first: when the newest change and the row count are the same as at the last full pull, and that pull was lately, nothing is downloaded
  let sig = "";
  try {
    const [nw, ct] = await Promise.all([
      sb.from("zenith_docs").select("updated_at").eq("owner_id", sbUser.id).order("updated_at", { ascending: false }).limit(1),
      sb.from("zenith_docs").select("doc_id", { count: "exact", head: true }).eq("owner_id", sbUser.id)
    ]);
    if (!nw.error && !ct.error && typeof ct.count === "number") sig = sbUser.id + "|" + ((nw.data && nw.data[0] && nw.data[0].updated_at) || "") + "|" + ct.count;
  } catch (e) { sig = ""; }
  if (sig && sig === zenPullSig && Date.now() - zenPullAt < 300000) return false;
  // only documents changed since the last pull are downloaded; a full pull still runs now and then (and after a failure) in case a clock was off
  const incr = !!(zenPulledIso && !zenFullNext && Date.now() - zenFullAt < 600000);
  // removals made on another device are read from the tombstones written since the last pull
  const delChanged = await zenApplyDeleted();
  const { data, error } = await pageAll((a, b) => { let q = sb.from("zenith_docs").select("kind, doc_id, data, updated_at").eq("owner_id", sbUser.id); if (incr) q = q.gte("updated_at", zenPulledIso); return q.order("kind").order("doc_id").range(a, b); });
  if (error) return;
  let newest = incr ? zenPulledIso : "";
  for (const r of data || []) if (r.updated_at && r.updated_at > newest) newest = r.updated_at;
  const byLocal = new Map(S.posts.map(p => [p.id, p]));
  const byRemote = new Map(S.posts.filter(p => p.remote).map(p => [p.remote, p]));
  let changed = delChanged;
  // sealed chats are opened first; a copy from before sealing is used as it is and sealed again by the next sync
  const chatOpen = new Map();
  const encStale = r => r.kind === "chat" && r.data && r.data.enc && zenEncDone.get(r.doc_id) === r.data.enc;
  for (const r of data || []) if (r.kind === "chat" && r.data && r.data.enc && !encStale(r)) { try { const k = await sharedKey(sbUser.id); chatOpen.set(r.doc_id, Object.assign({ id: r.data.id }, await noteOpen(k, r.data.enc, zenRowId("chat:" + r.doc_id)))); } catch (e) {} }
  // the pictures that belong to the sealed chats are opened first; one that cannot be fetched is left out and tried again at the next pull
  const zenPics = new Map();
  const picFail = new Set();
  {
    // every picture of every sealed chat is signed in one request and fetched side by side
    const jobs = [];
    for (const [cdoc, dd] of chatOpen) for (const m of dd.msgs || []) if (Array.isArray(m.media) && m.media.length && typeof m.id === "string") jobs.push([cdoc, m]);
    dmSignBatch(jobs.flatMap(([, m]) => m.media));
    await Promise.all(jobs.map(async ([cdoc, m]) => {
      try {
        const k = await sharedKey(sbUser.id);
        // one picture that cannot be fetched is left out, the others of the message still show; the chat is tried again at the next pull
        const got = await Promise.allSettled(m.media.map(md => notePicIn(k, md)));
        const imgs = [], zm = [];
        got.forEach((g, n) => { if (g.status === "fulfilled") { imgs.push(g.value); zm.push({ h: imgH(g.value), d: m.media[n] }); } else picFail.add(cdoc); });
        if (imgs.length) zenPics.set(m.id, { imgs, zm });
      } catch (e) { picFail.add(cdoc); }
    }));
  }
  const chatById = new Map(S.chats.map(x => [x.id, x]));
  (data || []).forEach(r => {
    const key = r.kind + ":" + r.doc_id; let d = r.data || {};
    if (r.kind === "post") {
      zenSeen.set(key, zenJson(d));
      if ((S.zen.gone || []).includes(d.id)) { sb.from("zenith_docs").delete().eq("owner_id", sbUser.id).eq("kind", "post").eq("doc_id", r.doc_id).then(() => { zenSeen.delete(key); }, () => {}); return; }
      if (d.parentRemote) { const par = byRemote.get(d.parentRemote); if (!par) return; d.parent = par.id; dropPostIndex(); if (!par.zenReplied) { par.zenReplied = true; changed = true; } }
      if (!byLocal.has(d.id) && !d.pub) { const p = Object.assign({ imgs: [], liked: false, reposted: false, saved: false, pinned: false }, d, { imgs: [], ai: true }); S.posts.push(p); byLocal.set(p.id, p); changed = true; }
      else if (d.pub && byLocal.get(d.id) && byLocal.get(d.id).pub !== d.pub) { byLocal.get(d.id).pub = d.pub; changed = true; }
    } else if (r.kind === "flag") {
      const p = (d.remote && byRemote.get(d.remote)) || byLocal.get(d.local);
      if (!p) return;
      zenSeen.set(key, zenJson(d));
      ["zenReplied", "zenAnswered", "zenLikeChecked", "zenLike"].forEach(f => { if (d[f] && !p[f]) { p[f] = true; changed = true; } });
    } else if (r.kind === "chat") {
      const sealedRow = !!(r.data && r.data.enc);
      if (sealedRow && encStale(r)) return;
      if (sealedRow && chatOpen.get(r.doc_id) && !picFail.has(r.doc_id)) zenEncDone.set(r.doc_id, r.data.enc);
      if (sealedRow) { const dd = chatOpen.get(r.doc_id); if (!dd) return; if (legacySeen.has(zenRowId(key))) { legacySeen.delete(zenRowId(key)); zenSeen.delete(key); } else zenSeen.set(key, zenJson({ id: dd.id, name: dd.name, t: dd.t, msgs: (dd.msgs || []).map(m => ({ id: m.id, text: m.text, t: m.t, ai: !!m.ai, ph: ((zenPics.get(m.id) || {}).zm || []).map(e => e.h) })) })); d = dd; }
      const c = chatById.get(d.id);
      const msgs = (d.msgs || []).map(m => ({ id: m.id, text: m.text || "", t: m.t, ai: !!m.ai, imgs: (zenPics.get(m.id) || {}).imgs || [], zm: (zenPics.get(m.id) || {}).zm }));
      if (!c) { S.chats.push({ id: d.id, name: d.name, t: d.t, msgs }); chatById.set(d.id, S.chats[S.chats.length - 1]); changed = true; }
      else {
        const have = new Set(c.msgs.map(m => m.id)); const add = msgs.filter(m => !have.has(m.id)); if (add.length) { c.msgs = c.msgs.concat(add).sort((a, b) => a.t - b.t); changed = true; }
        // a message that lost its pictures on this phone gets them back from the saved copy
        c.msgs.forEach(m => { const z = zenPics.get(m.id); if (z && z.imgs.length && !(m.imgs || []).length) { m.imgs = z.imgs; m.zm = z.zm; changed = true; } });
      }
    } else if (r.kind === "state" && d.z) {
      zenSeen.set(key, zenJson(d));
      const z = S.zen, sz = d.z;
      z.next = Math.max(z.next || 0, sz.next || 0);
      z.since = Math.min(z.since || Date.now(), sz.since || Date.now());
      z.log = Array.from(new Set((z.log || []).concat(sz.log || [])));
      if (typeof sz.pics === "boolean") z.pics = sz.pics;
      if ((sz.pfpAt || 0) > (z.pfpAt || 0)) { if (sz.pfp) z.pfp = sz.pfp; else delete z.pfp; if (sz.bn) z.bn = sz.bn; else delete z.bn; if (sz.bnr) z.bnr = sz.bnr; else delete z.bnr; z.pfpAt = sz.pfpAt; }
      changed = true;
    }
  });
  // his old posts that are public now come back as the real ones, so the copies kept on the phone go; replies under them follow
  const pubd = S.posts.filter(p => p.ai && p.pub);
  if (pubd.length) {
    pubd.forEach(lp => S.posts.forEach(k => { if (k.parent === lp.id) k.parent = "r" + lp.pub; }));
    dropPostIndex();
    // a like, repost or save you gave the private copy moves to the public one
    pubd.forEach(lp => { if (lp.saved) { S.sv = S.sv || {}; S.sv[lp.pub] = 1; } });
    // a copy whose like or repost could not be moved stays, so the next pull tries again
    const failedMove = new Set();
    await Promise.all(pubd.map(async lp => {
      const bad = r => r && r.error && r.error.code !== "23505";
      try {
        if (lp.liked && bad(await sb.from("likes").insert({ user_id: sbUser.id, post_id: lp.pub }))) failedMove.add(lp.id);
        if (lp.reposted && bad(await sb.from("reposts").insert({ user_id: sbUser.id, post_id: lp.pub }))) failedMove.add(lp.id);
      } catch (e) { failedMove.add(lp.id); }
    }));
    const gone = new Set(pubd.filter(p => !failedMove.has(p.id)).map(p => p.id));
    S.posts = S.posts.filter(p => !gone.has(p.id));
    changed = true;
  }
  if (changed) persist();
  notePicMemo.clear();
  zenPullSig = picFail.size ? "" : sig;
  zenPullAt = Date.now();
  if (!incr) zenFullAt = zenPullAt;
  zenFullNext = picFail.size > 0;
  if (newest) zenPulledIso = newest;
  return changed;
}
async function zenStart() {
  if (zenSyncOn || !sbUser || !isOwner()) return;
  const pulled = await zenPull();
  zenSyncOn = true;
  zenSync();
  // his account is looked up each time, so a remade account is never mixed up with the old one; the profile picture goes up again for a new one
  sb.from("accounts").select("id").eq("username", "zenith").maybeSingle().then(({ data }) => {
    if (!data || data.id === S.zen.id) return;
    S.zen.id = data.id; S.zen.pfpPushed = -1; persist();
    zenPushProfile();
    if (stack[stack.length - 1].r === "zen") render();
  }, () => {});
  if (S.zen.pfpPushed !== (S.zen.pfpAt || 0)) zenPushProfile();
  const top = stack[stack.length - 1].r;
  if (!layer.childElementCount && (top === "zen" || (stack.length === 1 && top === "home"))) render();
  else if (pulled) chatListRefresh();
}
// his picture and banner style only: no name and no bio
// his public account gets the same picture and banner style the owner chose
async function zenPushProfile() {
  if (!sbUser || !isOwner()) return;
  try {
    const url = S.zen.pfp ? await zenPfpUrl() : null;
    if (S.zen.pfp && !url) return;
    const burl = S.zen.bnr ? await zenBnrUrl() : null;
    if (S.zen.bnr && !burl) return;
    const r = await zFetch({ action: "profile", avatar: url, banner: burl, theme: S.zen.bn === "avatar" ? "avatar" : "" });
    const j = await r.json().catch(() => null);
    if (j && j.ok) { S.zen.pfpPushed = S.zen.pfpAt || 0; persist(); }
  } catch (e) {}
}
function zenEdit() {
  let pfp = S.zen.pfp || null, bnr = S.zen.bnr || null, bnVal = S.zen.bn === "avatar" ? "avatar" : "default";
  const bn = h("div", { class: "ebanner" });
  const av = h("div", { class: "av zenav" });
  const paint = () => {
    bn.querySelectorAll(":scope > img.pic").forEach(i => i.remove());
    if (bnVal === "avatar" && (bnr || pfp)) bn.prepend(mkImg(bnr || pfp, "pic blur")); else if (bnr) bn.prepend(picImg(bnr));
    av.textContent = "";
    if (pfp) { const im = h("img", { alt: "", decoding: "async" }); im.src = pfp; av.append(im); } else av.innerHTML = ZEN_SVG;
  };
  const picker = (label, size, opts, set, has, remove, removeLabel) => {
    const inp = h("input", { type: "file", accept: "image/*", class: "vh", "aria-label": label });
    inp.addEventListener("change", async () => {
      const f = inp.files && inp.files[0];
      inp.value = "";
      if (!f) return;
      if (isVideo(f)) { toast("Videos are not supported"); return; }
      try {
        const out = isGif(f) ? await cropGif(f, opts) : await openCropper(f, opts);
        if (out) { set(out); paint(); drawSeg(); }
      } catch (e) { toast("Could not use that picture"); }
    });
    const lab = h("label", { class: "pick", title: label }, ic("camera", size), inp);
    lab.addEventListener("click", e => {
      if (!has()) return;
      e.preventDefault();
      sheet([{ label: "Choose a photo", icon: "image", fn: () => inp.click() }, { label: removeLabel, icon: "trash", danger: true, fn: () => { remove(); paint(); drawSeg(); } }, { label: "Cancel", cancel: true }], removeLabel === "Remove banner" ? "Banner" : "Picture");
    });
    return lab;
  };
  bn.append(picker("Change banner", 18, { w: 1000, h: 330, gw: 600, gh: 198, title: "Crop banner" }, d => { bnr = d; bnVal = "default"; }, () => bnr, () => { bnr = null; if (!pfp) bnVal = "default"; }, "Remove banner"));
  const eav = h("div", { class: "eav" }, av, picker("Change picture", 16, { w: 320, h: 320, gw: 240, gh: 240, round: true, title: "Crop picture" }, d => { pfp = d; }, () => pfp, () => { pfp = null; if (!bnr) bnVal = "default"; }, "Remove picture"));
  const seg = h("div", { class: "seg" });
  const drawSeg = () => { seg.textContent = ""; [["default", bnr ? "Custom" : "Default"], ["avatar", "Blurred photo"]].forEach(([v, t]) => seg.append(h("button", { class: v === bnVal ? "on" : "", onclick: () => { if (v === "avatar" && !bnr && !pfp) { toast("Pick a picture first"); return; } bnVal = v; paint(); drawSeg(); } }, t))); };
  drawSeg();
  paint();
  modal({
    top: true,
    title: "Edit Zenith",
    body: [bn, eav, h("div", { class: "fld" }, h("label", {}, "Banner style"), seg)],
    onAction: close => {
      if (pfp) S.zen.pfp = pfp; else delete S.zen.pfp;
      if (bnr) S.zen.bnr = bnr; else delete S.zen.bnr;
      if (bnVal === "avatar" && (bnr || pfp)) S.zen.bn = "avatar"; else delete S.zen.bn;
      S.zen.pfpAt = Date.now();
      persist(); close(); render();
      zenPushProfile();
    }
  });
}
// his page is his real profile now, the same one everybody sees
function zenV() {
  if (S.zen.id) {
    // the page checks that it is still the one on screen, so it gets the real entry of the stack
    const top = stack[stack.length - 1]; top.id = S.zen.id;
    userV(top);
    // a stale id (his account was remade) is corrected, and the page opens again with the right one
    if (!zenIdChecked) { zenIdChecked = true; sb.from("accounts").select("id").eq("username", "zenith").maybeSingle().then(({ data }) => { if (data && data.id !== S.zen.id) { S.zen.id = data.id; S.zen.pfpPushed = -1; persist(); zenPushProfile(); if (stack[stack.length - 1].r === "zen") render(); } }, () => { zenIdChecked = false; }); }
    return;
  }
  topEl.append(bar(menuBtn(), ttl("Zenith")));
  main.append(loadingEl());
  const noZen = () => { if (stack[stack.length - 1].r !== "zen" || S.zen.id) return; main.textContent = ""; main.append(h("div", { class: "sec" }, "Could not load Zenith")); };
  sb.from("accounts").select("id").eq("username", "zenith").maybeSingle().then(({ data }) => {
    if (!data) { noZen(); return; }
    S.zen.id = data.id; persist();
    if (stack[stack.length - 1].r === "zen") render();
  }, noZen);
}
let zenIdChecked = false;
const rowSubs = {};
function settingsV() {
  topEl.append(bar(menuBtn(), ttl("Settings")));
  const sec = t => h("div", { class: "sec" }, t);
  const row = (lead, label, sub, fn, cls) => h("button", { class: "srow" + (cls ? " " + cls : ""), onclick: fn }, lead, h("div", { class: "nm" }, h("b", {}, label), sub ? h("span", { class: "sub" }, sub) : null));
  main.append(sec("Appearance"));
  main.append(h("div", { class: "seg" }, [["system", "System"], ["dark", "Dark"], ["light", "Light"]].map(t => h("button", { class: S.ui.theme === t[0] ? "on" : "", onclick: e => { S.ui.theme = t[0]; applyTheme(); persist(); e.currentTarget.parentNode.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === e.currentTarget)); } }, t[1]))));
  main.append(sec("Account"));
  const swRow = row(ic("userswap", 22), "Switch account", "Add or switch accounts", openAccounts);
  main.append(h("div", { class: "group" }, row(avatar(36), "Edit profile", "@" + S.profile.handle, editProfile), swRow, row(ic("usercut", 22), "Sign out", "Log out from this device", () => confirmSheet("Sign out of @" + S.profile.handle + " on this phone?", "Sign out", signOutNow))));
  main.append(sec("Login"));
  const totpRow = row(ic("shield", 22), "Authenticator app", rowSubs.totp || "Checking...", async () => {
    if (totpOn === null) {
      toast("Checking...");
      callFn("totp", { action: "status" }).then(r => { totpOn = r.ok ? !!r.body.enabled : null; const sub = totpRow.querySelector(".sub"); if (sub) sub.textContent = !r.ok ? "Couldn't check. Tap to retry" : totpOn ? "On" : "Off"; if (r.ok) rowSubs.totp = totpOn ? "On" : "Off"; });
      return;
    }
    if (totpOn) sheet([{ icon: "close", label: "Turn off authenticator", danger: true, fn: authenticatorOff }], "Authenticator is on");
    else { await authenticatorSetup(); render(); }
  });
  callFn("totp", { action: "status" }).then(r => {
    totpOn = r.ok ? !!r.body.enabled : null;
    const sub = totpRow.querySelector(".sub");
    if (sub) sub.textContent = !r.ok ? "Couldn't check" : totpOn ? "On" : "Off";
    if (r.ok) rowSubs.totp = totpOn ? "On" : "Off";
  }).catch(() => { const sub = totpRow.querySelector(".sub"); if (sub) sub.textContent = "Couldn't check"; });
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
      rowSubs.key = keyState === "locked" ? "Locked. Tap to unlock" : keyState === "off" ? "Off" : modes.includes("login") ? "On" : "On, recovery password";
      if (sub) sub.textContent = keyState === "locked" ? "Locked. Tap to unlock" : keyState === "off" ? "Off" : modes.includes("login") ? "On" : "On, recovery password";
    } catch (e) { if (sub) sub.textContent = "Couldn't check. Tap to retry"; }
  };
  loadKeyState();
  let pkRows = null;
  const pkRow = row(ic("lock", 22), pkLabel(), pkOk() ? "Checking..." : "Not available here", async () => {
    if (!pkOk()) { toast("This phone cannot do that"); return; }
    if (!pkRows) { toast("Checking, try again in a moment"); Promise.resolve(sb.from("passkeys").select("id, name").order("created_at")).then(r => { if (r && !r.error) { pkRows = r.data || []; const sb2 = pkRow.querySelector(".sub"); if (sb2) sb2.textContent = pkRows.length ? "On" : "Off"; } }, () => {}); return; }
    sheet([
      ...(pkRows.length ? [] : [{ label: "Add this phone", fn: async () => { if (await passkeyAdd()) { toast("Saved. You can sign in with it now"); render(); } } }]),
      ...pkRows.map(k => ({ icon: "close", label: pkRows.length > 1 ? "Remove " + (k.name || "key") : "Remove", danger: true, fn: async () => {
        const { error } = await sb.from("passkeys").delete().eq("id", k.id);
        toast(error ? "Could not remove it" : "Removed"); if (!error) render();
      } })),
      { label: "Cancel", cancel: true }], pkLabel());
  });
  if (pkOk()) Promise.resolve(sb.from("passkeys").select("id, name").order("created_at")).then(r => {
    const sub = pkRow.querySelector(".sub");
    if (!r || r.error) { if (sub) sub.textContent = "Couldn't check"; return; }
    pkRows = r.data || [];
    if (sub) sub.textContent = pkRows.length ? "On for " + pkRows.length + (pkRows.length === 1 ? " phone" : " phones") : "Off";
  }, () => { const sub = pkRow.querySelector(".sub"); if (sub) sub.textContent = "Couldn't check"; });
  main.append(h("div", { class: "group" },
    row(ic("user", 22), "Account info", "Email, created, phones", () => go({ r: "account" })),
    row(ic("pass", 22), "Change password", "Update your password", () => changePassV()),
    row(ic("mail", 22), "Change email", "Update your email", () => changeEmailV()),
    pkRow,
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
    if (!pushOk()) { put("Not available. On iPhone, add Nook to the home screen first"); return; }
    if (Notification.permission === "denied") { put("Blocked in phone settings"); return; }
    const cur = await pushSub();
    put(cur && Notification.permission === "granted" ? "On" : "Off");
  };
  paintPush();
  main.append(h("div", { class: "group" }, pushRowEl));
  main.append(sec("Your account"));
  main.append(h("div", { class: "group" },
    row(ic("close", 22), "Blocked accounts", "People you blocked", () => go({ r: "blocked" })),
    row(ic("eyeoff", 22), "Hidden chats", "Chats you hid", () => go({ r: "hidden" })),
    row(ic("moon", 22), "Deactivate account", "Hidden until you sign back in", () => confirmSheet("Hide your account until you sign in again?", "Deactivate", async () => {
      const { error } = await sb.rpc("set_my_deactivated", { flag: true });
      if (error) { toast("Could not deactivate"); return; }
      await pushDetach().catch(() => {});
      await leaveThisAccount(true);
    }))));
  main.append(sec("Your data"));
  main.append(h("div", { class: "group" },
    row(ic("copy", 22), "Download backup", "Posts, notes and media", () => downloadBackup())));
  main.append(sec("Updates"));
  main.append(h("div", { class: "group" }, row(ic("refresh", 22), "Check for updates", "Version " + APP_VERSION, () => {
    if (!window.nookCheckUpdate) { toast("Not available right now"); return; }
    if (window.nookPtr) window.nookPtr.spin();
    const done = () => { if (window.nookPtr) window.nookPtr.stop(); };
    setTimeout(done, 15000);
    Promise.resolve(window.nookCheckUpdate()).catch(() => {}).then(done);
  })));
  main.append(sec("Legal"));
  main.append(h("div", { class: "group" },
    row(ic("eyeoff", 22), "Privacy Policy", "What we collect", () => go({ r: "privacy" })),
    row(ic("list", 22), "Terms of Use", "The rules of Nook", () => go({ r: "terms" }))));
  main.append(sec("Danger zone"));
  main.append(h("div", { class: "group" }, row(ic("trash", 22), "Delete account", "Deleted after 30 days", () => {
    const doDelete = async () => {
      const r = await callFn("delete-account");
      if (!r.ok) return failText(r, "Could not delete the account. Try again");
      await pushDetach().catch(() => {});
      await wipeLocal();
      await leaveThisAccount();
    };
    // the email and password come first; then the person is asked if they want a copy of their data
    let saved = false;
    confirmLogin("Delete account", "Your account is hidden for 30 days. Sign in during that time to get it back. After that it is deleted for good.", "Delete", async () => {
      if (saved) return doDelete();
      sheet([
        { icon: "copy", label: "Download my data first", fn: async () => { await downloadBackup(); saved = true; toast("Saved. Tap Delete to finish"); } },
        { icon: "trash", label: "Delete without downloading", danger: true, fn: async () => { const e = await doDelete(); if (e) toast(e); } },
        { label: "Cancel", cancel: true }], "Want a copy of your data first?");
      // false: the screen stays open and says nothing
      return false;
    });
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
  // the file is turned into text only when it is the one that is returned
  const orig = async () => (await readDataURL(f)).replace(/^data:[^,]*/, "data:image/gif;base64");
  if (f.size <= 1.5 * 1048576 || !window.ImageDecoder) {
    if (f.size > 12582912) throw new Error("gif over 12 MB");
    return orig();
  }
  try {
    const dec = new ImageDecoder({ data: await f.arrayBuffer(), type: "image/gif" });
    await dec.tracks.ready;
    const count = dec.tracks.selectedTrack.frameCount;
    if (!(count > 1)) return orig();
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
    // frames are held in memory until the gif is made again, so a big picture keeps fewer of them (about 96 MB at most)
    const step = 1e6 / 12, maxFrames = Math.max(36, Math.min(12 * 15, Math.floor(96e6 / (w * h2 * 4))));
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
    if (!fr.length) return orig();
    const blob = await gifEncode(fr, w, h2, 12, p => onp && onp(0.5 + p * 0.5));
    if (blob.size < f.size) return await readDataURL(blob);
  } catch (e) {}
  if (f.size > 12582912) throw new Error("gif over 12 MB");
  return orig();
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
  const k = Math.min(1, (o.round ? 256 : 360) / Math.max(o.w, o.h));
  const W = Math.max(2, Math.round(o.w * k)), H = Math.max(2, Math.round(o.h * k));
  if (f.size > 12582912) { toast("That GIF is too big to crop (over 12 MB)"); return null; }
  toast("Cropping your GIF...");
  let dec = null;
  try {
    dec = new ImageDecoder({ data: await f.arrayBuffer(), type: "image/gif" });
    await dec.tracks.ready;
    const count = dec.tracks.selectedTrack.frameCount;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d", { willReadFrequently: true });
    // a gif with one frame is still cropped to the chosen area
    if (!(count > 1)) {
      const one = await dec.decode({ frameIndex: 0 });
      dec.close();
      x.fillStyle = "#fff"; x.fillRect(0, 0, W, H);
      x.drawImage(one.image, r.x, r.y, r.w, r.h, 0, 0, W, H);
      one.image.close();
      return await readDataURL(await gifEncode([x.getImageData(0, 0, W, H).data], W, H, 12));
    }
    const fr = [];
    let tAt = 0, nextAt = 0;
    // the frames are all held in memory until the gif is made again, so a larger crop keeps fewer of them (about 48 MB at most)
    const step = 1e6 / 12, maxFrames = Math.max(24, Math.min(12 * 8, Math.floor(48e6 / (W * H * 4))));
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
  } catch (e) { try { if (dec) dec.close(); } catch (e2) {} toast("Could not crop that GIF"); return null; }
}
async function addMedia(files, arr, jobs, max, redraw) {
  let bad = 0, why = "";
  for (const f of Array.from(files)) {
    if (arr.length + jobs.length >= max) { toast("Only " + max + " allowed, extra ones skipped"); break; }
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
    if (!/^data:/.test(src)) im.crossOrigin = "anonymous";
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
      try { res(c.toDataURL("image/png")); } catch (e) { res(null); }
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
// counts are asked for in small groups, so a long list of ids never makes the address too long
// the server hands out at most 1000 rows per call, so a long list is read page by page
async function pageAll(mk) {
  const out = [];
  for (let from = 0; from < 20000; from += 1000) {
    const r = await mk(from, from + 999);
    if (!r || r.error) return { data: null, error: (r && r.error) || new Error("page") };
    out.push(...(r.data || []));
    if ((r.data || []).length < 1000) break;
  }
  return { data: out, error: null };
}
// every group of ids is read page by page, and one group that fails fails the whole answer, so a count is never silently short
async function rowsFor(table, ids) {
  const parts = [];
  for (let i = 0; i < ids.length; i += 80) parts.push(ids.slice(i, i + 80));
  const res = await Promise.all(parts.map(c => pageAll((a, b) => sb.from(table).select("post_id, user_id").in("post_id", c).order("post_id").order("user_id").range(a, b))));
  const bad = res.find(r => !r || r.error);
  if (bad) return { data: null, error: (bad && bad.error) || new Error("rows") };
  return { data: res.flatMap(r => r.data || []), error: null };
}
// counts of shares and saves (plus this person's own flags) come from one server call, because the rows of other people are not readable
async function shareSaveStats(ids) {
  const out = { sh: new Map(), sv: new Map(), myShared: new Set(), mySaved: new Set() };
  const parts = [];
  for (let i = 0; i < ids.length; i += 400) parts.push(ids.slice(i, i + 400));
  const res = await Promise.all(parts.map(c => Promise.resolve(sb.rpc("post_share_save_stats", { p_ids: c })).catch(() => null)));
  res.forEach(r => ((r && r.data) || []).forEach(x => {
    out.sh.set(x.post_id, x.shares || 0); out.sv.set(x.post_id, x.saves || 0);
    if (x.i_shared) out.myShared.add(x.post_id);
    if (x.i_saved) out.mySaved.add(x.post_id);
  }));
  return out;
}
let feedBusy = null, feedAgain = false;
// The reads that do not depend on each other start together (and, on a phone that was signed in before, while the ban and age checks are still running);
// nothing from them is shown before those checks have passed, because loadFeed is only called after them.
// the answer for the first ids was asked for early; only the ids added since (reposted posts older than the newest 300) are asked for now
function withExtra(p0, ids0, ids, ask, table) {
  const extra = ids.slice(ids0.length);
  if (!extra.length) return p0;
  return Promise.all([p0, ask(table, extra)]).then(([a, b]) => {
    if (a && a.sh instanceof Map) {
      b.sh.forEach((v, k) => a.sh.set(k, v)); b.sv.forEach((v, k) => a.sv.set(k, v));
      b.myShared.forEach(k => a.myShared.add(k)); b.mySaved.forEach(k => a.mySaved.add(k));
      return a;
    }
    if (!a || a.error) return a;
    if (!b || b.error) return b;
    return { data: a.data.concat(b.data), error: null };
  });
}
let feedPre = null;
// a prefetch that will not be used (ban, age screen, sign out) is marked dead, so it also stops before it saves anybody's profile on this phone
const dropPre = () => { if (feedPre) feedPre.dead = true; feedPre = null; };
function feedPrefetch() {
  if (feedPre || !sbUser || !sb) return;
  const f = feedFetchStart();
  feedPre = f;
  // a prefetch that is never used (ban, age screen, sign out) must not leave an unhandled error behind
  Object.values(f).forEach(v => { if (v && v.catch) v.catch(() => {}); });
}
// posts.edited_at (when the words of a post were changed) came later: a server without it refuses the column (42703),
// and the read is made again without it
let editedCol = true;
async function postsRead(cols, run) {
  let r = await run(editedCol ? cols + ", edited_at" : cols);
  if (editedCol && r && r.error && (r.error.code === "42703" || /edited_at/.test(r.error.message || ""))) { editedCol = false; r = await run(cols); }
  return r;
}
function feedFetchStart() {
  const uid = sbUser.id, f = { t: Date.now(), uid };
  f.posts = (async () => {
    let pq = await sb.from("posts_feed").select("id, user_id, body, created_at, parent_id, media_url, media_inline, edited_at").order("created_at", { ascending: false }).limit(300);
    if (pq.error) pq = await sb.from("posts_feed").select("id, user_id, body, created_at, parent_id, media_url, media_inline").order("created_at", { ascending: false }).limit(300);
    if (pq.error) pq = await sb.from("posts").select("id, user_id, body, created_at, parent_id, media_url").order("created_at", { ascending: false }).limit(300);
    if (pq.error) pq = await sb.from("posts").select("id, user_id, body, created_at").order("created_at", { ascending: false }).limit(300);
    return pq;
  })();
  f.follows = pageAll((a, b) => sb.from("follows").select("followee_id").eq("follower_id", uid).order("followee_id").range(a, b));
  f.myLikes = pageAll((a, b) => sb.from("likes").select("post_id").eq("user_id", uid).order("post_id").range(a, b));
  f.myReposts = pageAll((a, b) => sb.from("reposts").select("post_id, created_at").eq("user_id", uid).order("post_id").range(a, b));
  f.blocksOut = pageAll((a, b) => sb.from("blocks").select("blocked_id").eq("blocker_id", uid).order("blocked_id").range(a, b));
  f.blocksIn = pageAll((a, b) => sb.from("blocks").select("blocker_id").eq("blocked_id", uid).order("blocker_id").range(a, b));
  f.mutes = pageAll((a, b) => sb.from("mutes").select("muted_id").eq("muter_id", uid).order("muted_id").range(a, b));
  f.meRow = sb.from("accounts").select(ACC_COLS).eq("id", uid).maybeSingle();
  // the profiles of the authors are asked for as soon as the posts and the block lists are in, so they are ready when the checks have passed
  f.prov = (async () => {
    const pq = await f.posts;
    if (!pq || !pq.data) return null;
    const [bo, bi, mu] = await Promise.all([f.blocksOut, f.blocksIn, f.mutes]);
    if (!bo || !bi || !mu || bo.error || bi.error || mu.error) return null;
    if (f.dead) return null;
    const hid = new Set([...(bo.data || []).map(x => x.blocked_id), ...(bi.data || []).map(x => x.blocker_id), ...(mu.data || []).map(x => x.muted_id)]);
    const shownP = pq.data.filter(p => !hid.has(p.user_id));
    if (f.dead) return null;
    const who0 = await cachedAccounts([...new Set(shownP.filter(p => p.user_id !== uid).map(p => p.user_id))]);
    return { shownP, who0 };
  })();
  return f;
}
function loadFeed() {
  if (feedBusy) { feedAgain = true; return feedBusy; }
  const pre = feedPre && feedPre.uid === (sbUser && sbUser.id) && Date.now() - feedPre.t < 20000 ? feedPre : null;
  feedPre = null;
  feedBusy = loadFeedNow(pre).finally(() => {
    // whatever happened above, a screen that was drawn ahead of the counts never stays in the saved state
    if (S && S.posts.some(p => p._prov)) { S.posts = S.posts.filter(p => !p._prov); rankCache.clear(); if (stack.length === 1 && stack[0].r === "home") render(); }
    feedBusy = null; if (feedAgain) { feedAgain = false; loadFeed().catch(() => {}); } });
  return feedBusy;
}
async function loadFeedNow(pre) {
  if (!sbUser || !S) return;
  // taps made after the first read started are newer than the rows, even when the read began before this function was called
  const feedT0 = pre ? pre.t : Date.now();
  // the list view leaves out photos stored inline in the row (old posts), so 300 rows never pull hundreds of MB; the newest few are fetched below
  const f = pre || feedFetchStart();
  const pq = await f.posts;
  const posts = pq.data;
  if (!posts) { feedFail(); return; }
  // the counts and the reposts of the people followed only need the ids, so they start now, beside the profiles of the authors
  const ids0 = posts.map(p => p.id);
  const likeRowsP = rowsFor("likes", ids0), repostRowsP = rowsFor("reposts", ids0), statsP = shareSaveStats(ids0);
  [likeRowsP, repostRowsP, statsP].forEach(v => v.catch(() => {}));
  // a phone with nothing from the server yet draws the posts as soon as the posts, the block lists and the profiles of the authors are in;
  // likes, reposts and counts follow below, and the end state is the same
  let provisional = null;
  if (!S.posts.some(p => p.remote)) {
    try {
      const pv = await f.prov;
      if (pv) {
        const { who0 } = pv;
        // only the newest posts are drawn ahead (building all 300 takes about 300 ms on a phone); the full list replaces them a moment later
        const shownP = pv.shownP.slice(0, 40);
        if (!who0.failed && !S.posts.some(p => p.remote) && stack.length === 1 && stack[0].r === "home") {
          const rt = new Map();
          shownP.filter(p => p.parent_id).forEach(p => rt.set(p.parent_id, (rt.get(p.parent_id) || 0) + 1));
          const ids = new Set(shownP.map(p => p.id));
          const mk = p => ({ remote: p.id, text: p.body || "", t: Date.parse(p.created_at), imgs: p._imgs || parseMedia(p.media_url), liked: false, reposted: false, rpAt: 0, saved: !!(S.sv && S.sv[p.id]), lc: 0, rpc: 0, shc: 0, svc: 0, sharedByMe: false, rp: rt.get(p.id) || 0, edited: !!p.edited_at, _prov: true });
          const par = p => (p.parent_id ? (ids.has(p.parent_id) ? p.parent_id : null) : null);
          const mine = shownP.filter(p => p.user_id === sbUser.id && !(S.pendDel || []).includes(p.id)).map(p => Object.assign(mk(p), { id: "m" + p.id, parent: par(p) ? "m" + p.parent_id : p.parent_id ? "r" + p.parent_id : null, media: p._imgs || parseMedia(p.media_url), pinned: false }));
          const others0 = shownP.filter(p => p.user_id !== sbUser.id && who0.get(p.user_id)).map(p => {
            const a = who0.get(p.user_id);
            return Object.assign(mk(p), { id: "r" + p.id, parent: p.parent_id ? "r" + p.parent_id : null, ra: { id: p.user_id, name: a.display_name == null ? a.username : a.display_name, handle: a.username, avatar: a.avatar || null }, rpBy: null, pinned: false });
          });
          provisional = mine.concat(others0);
          S.posts = S.posts.concat(provisional);
          render();
        }
      }
    } catch (e) { provisional = null; }
  }
  // the order of the screen is kept for as long as the posts stay the same, so the order worked out without the likes must not be kept
  const dropProv = () => { if (provisional) { S.posts = S.posts.filter(p => !p._prov); provisional = null; rankCache.clear(); } };
  // photos already held from an earlier load are reused; the newest few missing ones are fetched now, the rest one small group at a time afterwards
  const prevImgs = new Map(S.posts.filter(p => !p._prov && p.remote && p.imgs && p.imgs.length).map(p => [p.remote, p.imgs]));
  const inlAll = posts.filter(p => p.media_inline && !prevImgs.has(p.id));
  // the newest few photos load while the follows and reposts below are being read
  const inlP = (async () => {
    try {
      const inl = inlAll.slice(0, 12);
      if (inl.length) {
        const full = await sb.from("posts").select("id, media_url").in("id", inl.map(p => p.id));
        const m = new Map((full.data || []).map(r => [r.id, r.media_url]));
        inl.forEach(p => { if (m.has(p.id)) { p.media_url = m.get(p.id); p.media_inline = false; } });
      }
    } catch (e) {}
  })();
  posts.forEach(p => { if (p.media_inline && prevImgs.has(p.id)) { p.media_inline = false; p._imgs = prevImgs.get(p.id); } });
  // what the people you follow reposted comes in too, even when the post itself is older than the newest 300
  let rpRows = [], rpFailed = false;
  try {
    const fq = await f.follows;
    if (fq.error) throw fq.error;
    const fids = (fq.data || []).map(r => r.followee_id);
    if (fids.length) {
      // the ids go in small groups, or the address gets too long
      const rparts = [];
      for (let i = 0; i < fids.length; i += 80) rparts.push(fids.slice(i, i + 80));
      const rqs = await Promise.all(rparts.map(c => sb.from("reposts").select("user_id, post_id, created_at").in("user_id", c).order("created_at", { ascending: false }).limit(60)));
      // one group that fails must not make the reposts of those people quietly vanish
      if (rqs.some(r => !r || r.error)) throw new Error("reposts");
      const rq = { data: rqs.flatMap(r => (r && r.data) || []).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 60) };
      rpRows = (rq.data || []).filter(r => r.user_id !== sbUser.id);
      const have = new Set(posts.map(p => p.id));
      const miss = [...new Set(rpRows.map(r => r.post_id))].filter(id => !have.has(id)).slice(0, 60);
      if (miss.length) {
        const mq = await postsRead("id, user_id, body, created_at, parent_id, media_url", c => sb.from("posts").select(c).in("id", miss));
        (mq.data || []).forEach(p => { if (!p.parent_id) posts.push(p); });
      }
    }
  } catch (e) { rpRows = []; rpFailed = true; }
  await inlP;
  const inlLater = inlAll.filter(p => p.media_inline).map(p => p.id);
  const pend = new Set(S.pendDel || []);
  if (S.pendDel && S.pendDel.length) { try { await deleteRemote(S.pendDel.map(r => ({ remote: r }))); } catch (e) {} }
  const ids = posts.map(p => p.id);
  const feedRes = await Promise.all([
    f.myLikes,
    f.myReposts,
    f.blocksOut,
    f.blocksIn,
    withExtra(likeRowsP, ids0, ids, rowsFor, "likes"),
    withExtra(repostRowsP, ids0, ids, rowsFor, "reposts"),
    withExtra(statsP, ids0, ids, (_, x) => shareSaveStats(x)),
    f.meRow,
    f.follows,
    f.mutes
  ]);
  // a failed answer is not an empty one: nothing is changed (a blocked or muted person must not come back, and counts must not fall short, because a call failed)
  if (rpFailed || [0, 1, 2, 3, 4, 5, 9].some(i => !feedRes[i] || feedRes[i].error)) { dropProv(); feedFail(); return; }
  dropProv();
  feedStatus = "ok"; feedTries = 0;
  const [{ data: myLikes }, { data: myReposts }, { data: blocksOut }, { data: blocksIn }, { data: likeRows }, { data: repostRows }, shareStats, { data: meRow }, { data: myFollows }, { data: myMutes }] = feedRes;
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
  const lc = tally(likeRows), rc = tally(repostRows), shc = shareStats.sh, svc = shareStats.sv;
  backfillSaves(shareStats.mySaved, ids);
  const shMine = shareStats.myShared;
  const liked = new Set((myLikes || []).map(x => x.post_id));
  const reposted = new Set((myReposts || []).map(x => x.post_id));
  const rpTime = new Map((myReposts || []).map(x => [x.post_id, Date.parse(x.created_at) || 0]));
  const muted = (myMutes || []).map(x => x.muted_id);
  const hidden = new Set([...(blocksOut || []).map(x => x.blocked_id), ...(blocksIn || []).map(x => x.blocker_id), ...muted]);
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
  // posts whose words were changed after they went up (the server marks it; removing a photo does not count)
  const editedIds = new Set(shown.filter(p => p.edited_at).map(p => p.id));
  S.posts.forEach(p => {
    if (!p.remote || p.ra) return;
    if (editedIds.has(p.remote)) p.edited = true;
    p.lc = lc.get(p.remote) || 0;
    p.rpc = rc.get(p.remote) || 0;
    p.svc = svc.get(p.remote) || 0; p.shc = shc.get(p.remote) || 0; p.sharedByMe = shMine.has(p.remote);
    p.rp = replyTally.get(p.remote) || 0;
    p.liked = liked.has(p.remote);
    p.reposted = reposted.has(p.remote);
    p.rpAt = p.reposted ? rpTime.get(p.remote) || p.rpAt || 0 : 0;
  });
  const remote = others.map(p => {
    const a = who.get(p.user_id) || { username: "user", avatar: null };
    return {
      id: "r" + p.id, remote: p.id, parent: p.parent_id ? (localByRemote.get(p.parent_id) || "r" + p.parent_id) : null,
      text: p.body || "", t: Date.parse(p.created_at), imgs: p._imgs || parseMedia(p.media_url),
      ra: { id: p.user_id, name: a.display_name == null ? a.username : a.display_name, handle: a.username, avatar: a.avatar || null },
      liked: liked.has(p.id), reposted: reposted.has(p.id), rpAt: rpTime.get(p.id) || 0, rpBy: rpBy(p.id), saved: savedMap.get(p.id) || !!(S.sv && S.sv[p.id]),
      lc: lc.get(p.id) || 0, rpc: rc.get(p.id) || 0, shc: shc.get(p.id) || 0, svc: svc.get(p.id) || 0, sharedByMe: shMine.has(p.id), rp: replyTally.get(p.id) || 0, pinned: false, edited: !!p.edited_at
    };
  });
  // my posts that only the server has (made on another device, or lost from this one) come back
  const known = new Set(S.posts.filter(p => p.remote && !p.ra && !p._prov).map(p => p.remote));
  const mineBack = shown.filter(p => p.user_id === sbUser.id && !known.has(p.id) && !pend.has(p.id));
  const backIds = new Set(mineBack.map(p => p.id));
  const back = mineBack.map(p => ({
    id: "m" + p.id, remote: p.id, parent: p.parent_id ? (localByRemote.get(p.parent_id) || (backIds.has(p.parent_id) ? "m" + p.parent_id : "r" + p.parent_id)) : null,
    text: p.body || "", t: Date.parse(p.created_at), imgs: p._imgs || parseMedia(p.media_url), media: p._imgs || parseMedia(p.media_url),
    liked: liked.has(p.id), reposted: reposted.has(p.id), saved: !!(S.sv && S.sv[p.id]), lc: lc.get(p.id) || 0, rpc: rc.get(p.id) || 0, shc: shc.get(p.id) || 0, svc: svc.get(p.id) || 0, sharedByMe: shMine.has(p.id), rp: replyTally.get(p.id) || 0,
    pinned: !!meRow && meRow.pinned_post_id === p.id, edited: !!p.edited_at
  }));
  // what this person saved or liked stays, even when the post is older than the newest 300
  const seen = new Set(remote.map(r => r.remote));
  let kept = S.posts.filter(p => p.ra && (p.saved || p.liked || (p.sharedAt && Date.now() - p.sharedAt < 864e5)) && !seen.has(p.remote) && !hidden.has(p.ra.id)).slice(0, 100);
  if (kept.length) {
    // only the ones the server still has (the author may have deleted them)
    const { data: still, error: se } = await sb.from("posts").select("id").in("id", kept.map(p => p.remote));
    kept = se ? [] : kept.filter(p => (still || []).some(r => r.id === p.remote));
  }
  // a like or repost tapped while this load was running is newer than the rows read before it
  for (const arr of [back, remote]) arr.forEach(x => { const tp = x.remote && tapAt.get(x.remote); if (tp && tp.t >= feedT0) { if (tp.l) { x.liked = tp.l.v; x.lc = tp.l.c; } if (tp.r) { x.reposted = tp.r.v; x.rpc = tp.r.c; } } });
  S.posts = S.posts.filter(p => !p.ra).concat(back, remote, kept);
  // where the real Zenith has answered a post, his older private answer under the same post goes, so there is one answer and not two
  if (S.zen && S.zen.id) {
    const answered = new Set(S.posts.filter(p => p.ra && p.ra.id === S.zen.id && p.parent).map(p => p.parent));
    // nothing is thrown away: the older private answers are kept aside, only the display changes
    const hide = S.posts.filter(p => p.ai && p.parent && answered.has(p.parent));
    if (hide.length) {
      const kept = new Set((S.zen.old || []).map(p => p.id));
      S.zen.old = (S.zen.old || []).concat(hide.filter(p => !kept.has(p.id)).map(p => ({ id: p.id, text: p.text, t: p.t, parent: p.parent })));
      const gone = new Set(hide.map(p => p.id));
      S.posts = S.posts.filter(p => !gone.has(p.id));
    }
  }
  // what was saved or put in a list on another phone, and is older than the newest 300 posts, is fetched now
  try { await fillWanted(); } catch (e) {}
  persist();
  // when the answer left everything the home screen shows as it was (the usual case on a phone that already had the posts), the screen is not built a second time
  if (stack.length === 1 && stack[0].r === "home" && !(homeSig && homeSig === homeSigNow())) render();
  if (inlLater.length) fillInlinePhotos(inlLater);
}
let inlineRun = 0;
let zScrollQ = 0;
// old posts keep their photo inside the row: those come one small group at a time so a phone never holds hundreds of MB at once
async function fillInlinePhotos(ids) {
  const run = ++inlineRun;
  let changed = false;
  for (let i = 0; i < ids.length && run === inlineRun; i += 4) {
    try {
      const { data, error } = await sb.from("posts").select("id, media_url").in("id", ids.slice(i, i + 4));
      if (error || !data || run !== inlineRun) continue;
      const m = new Map(data.map(r => [r.id, r.media_url]));
      let ch = false;
      S.posts.forEach(p => { if (p.remote && m.has(p.remote) && !(p.imgs && p.imgs.length)) { const im = parseMedia(m.get(p.remote)); if (im && im.length) { p.imgs = im; if (!p.ra) p.media = im; ch = true; } } });
      if (ch) changed = true;
    } catch (e) {}
  }
  if (changed) { persist(); if (stack.length === 1 && stack[0].r === "home") render(); }
}
function rAv(ra, size) {
  const seed = String((ra && (ra.name || ra.handle)) || "?");
  let hsh = 7;
  for (const c of seed) hsh = (hsh * 31 + c.charCodeAt(0)) >>> 0;
  const a = h("div", { class: "av", style: "background:hsl(" + (hsh % 360) + " 45% 42%)" }, seed.trim().charAt(0).toUpperCase() || "?");
  if (ra && ownMedia(ra.avatar)) { const im = picImg(ra.avatar); im.loading = "eager"; a.prepend(im); }
  // Zenith without a picture shows his own Z, not a letter
  else if (ra && ((ra.handle || "").toLowerCase() === "zenith" || (S && S.zen && S.zen.id && ra.id === S.zen.id))) { a.className = "av zenav"; a.style.background = ""; a.innerHTML = ZEN_SVG; }
  if (size) { a.style.width = size + "px"; a.style.height = size + "px"; a.style.fontSize = Math.round(size * 0.4) + "px"; }
  return a;
}
const busyTaps = new Set();
const tapAt = new Map();
function noteTap(p, k) { if (!p.remote) return; const e = tapAt.get(p.remote) || {}; e.t = Date.now(); e[k] = k === "l" ? { v: p.liked, c: p.lc || 0 } : { v: p.reposted, c: p.rpc || 0 }; tapAt.set(p.remote, e); if (tapAt.size > 200) tapAt.delete(tapAt.keys().next().value); }
async function toggleRemoteLike(p, big) {
  // a post drawn early (before its counts have arrived) cannot be liked yet: the full list replaces it a moment later
  if (!sbUser || p._prov || busyTaps.has("l" + p.id)) return;
  busyTaps.add("l" + p.id);
  try { await toggleRemoteLikeNow(p, big); } finally { busyTaps.delete("l" + p.id); }
}
async function toggleRemoteLikeNow(p, big) {
  const on = !p.liked;
  p.liked = on; p.lc = Math.max(0, (p.lc || 0) + (on ? 1 : -1));
  bump = p.id + "like"; noteTap(p, "l"); persist(); refresh(p, big);
  const { error } = on
    ? await sb.from("likes").insert({ user_id: sbUser.id, post_id: p.remote })
    : await sb.from("likes").delete().eq("user_id", sbUser.id).eq("post_id", p.remote);
  if (error && !(on && error.code === "23505")) {
    p.liked = !on; p.lc = Math.max(0, (p.lc || 0) + (on ? -1 : 1));
    // a lost answer can hide that the server did take the tap: the real state is read back
    const { data: truth, error: te } = await sb.from("likes").select("post_id").eq("user_id", sbUser.id).eq("post_id", p.remote).maybeSingle();
    if (!te && !!truth !== p.liked) { p.liked = !!truth; p.lc = Math.max(0, (p.lc || 0) + (p.liked ? 1 : -1)); }
    noteTap(p, "l"); persist(); refresh(p, big); toast("Could not update like");
  }
}
async function toggleRemoteRepost(p, big) {
  if (!sbUser || p._prov || busyTaps.has("r" + p.id)) return;
  busyTaps.add("r" + p.id);
  try { await toggleRemoteRepostNow(p, big); } finally { busyTaps.delete("r" + p.id); }
}
async function toggleRemoteRepostNow(p, big) {
  const on = !p.reposted;
  p.reposted = on; p.rpAt = on ? Date.now() : 0; p.rpc = Math.max(0, (p.rpc || 0) + (on ? 1 : -1));
  bump = p.id + "rp"; noteTap(p, "r"); persist(); refresh(p, big);
  const { error } = on
    ? await sb.from("reposts").insert({ user_id: sbUser.id, post_id: p.remote })
    : await sb.from("reposts").delete().eq("user_id", sbUser.id).eq("post_id", p.remote);
  if (error && !(on && error.code === "23505")) { p.reposted = !on; p.rpc = Math.max(0, (p.rpc || 0) + (on ? -1 : 1)); noteTap(p, "r"); persist(); refresh(p, big); toast("Could not update repost"); }
}
// posts fetched by id or by author become part of the phone's posts the same way the feed makes them
async function mapRemotePosts(rows) {
  const have = new Set(S.posts.filter(p => p.remote).map(p => p.remote));
  const fresh = (rows || []).filter(r => !have.has(r.id));
  if (!fresh.length) return 0;
  const ids = fresh.map(r => r.id), authors = [...new Set(fresh.map(r => r.user_id).filter(u => u !== sbUser.id))];
  const [lk, rp, myLk, myRp, kidsQ, who, sst] = await Promise.all([
    sb.from("likes").select("post_id").in("post_id", ids),
    sb.from("reposts").select("post_id").in("post_id", ids),
    sb.from("likes").select("post_id").eq("user_id", sbUser.id).in("post_id", ids),
    sb.from("reposts").select("post_id").eq("user_id", sbUser.id).in("post_id", ids),
    sb.from("posts").select("parent_id").in("parent_id", ids),
    authors.length ? cachedAccounts(authors) : new Map(),
    shareSaveStats(ids)
  ]);
  const tally = (q, k) => { const m = new Map(); ((q && q.data) || []).forEach(r => m.set(r[k], (m.get(r[k]) || 0) + 1)); return m; };
  const lc = tally(lk, "post_id"), rc = tally(rp, "post_id"), kc = tally(kidsQ, "parent_id"), shc = sst.sh, svc = sst.sv;
  backfillSaves(sst.mySaved, ids);
  const shMine = sst.myShared;
  const mineL = new Set(((myLk && myLk.data) || []).map(r => r.post_id)), mineR = new Set(((myRp && myRp.data) || []).map(r => r.post_id));
  const localByRemote = new Map(S.posts.filter(p => p.remote && !p.ra).map(p => [p.remote, p.id]));
  let n = 0;
  fresh.forEach(p => {
    const mine = p.user_id === sbUser.id, a = who.get(p.user_id);
    if (!mine && !a) return;
    const base = {
      remote: p.id, parent: p.parent_id ? (localByRemote.get(p.parent_id) || (mine ? "m" : "r") + p.parent_id) : null,
      text: p.body || "", t: Date.parse(p.created_at), imgs: parseMedia(p.media_url),
      liked: mineL.has(p.id), reposted: mineR.has(p.id), saved: !!(S.sv && S.sv[p.id]), lc: lc.get(p.id) || 0, rpc: rc.get(p.id) || 0, shc: shc.get(p.id) || 0, svc: svc.get(p.id) || 0, sharedByMe: shMine.has(p.id), rp: kc.get(p.id) || 0, pinned: false, edited: !!p.edited_at
    };
    if (mine) S.posts.push(Object.assign(base, { id: "m" + p.id, media: base.imgs }));
    else S.posts.push(Object.assign(base, { id: "r" + p.id, ra: { id: p.user_id, name: a.display_name == null ? a.username : a.display_name, handle: a.username, avatar: a.avatar || null } }));
    n++;
  });
  if (n) persist();
  return n;
}
// the feed only holds the newest posts of everybody, so when a profile opens the person's own newest posts are fetched too
async function loadUserPosts(id) {
  if (!sbUser) return false;
  const { data: rows, error } = await postsRead("id, user_id, body, created_at, parent_id, media_url", c => sb.from("posts").select(c).eq("user_id", id).order("created_at", { ascending: false }).limit(80));
  if (error || !rows || !rows.length) return false;
  return (await mapRemotePosts(rows)) > 0;
}
function userV(cur) {
  const found = S.posts.find(p => p.ra && p.ra.id === cur.id);
  const who = found ? found.ra : { id: cur.id, name: "user", handle: "user", avatar: null };
  // opened from the menu (his page is a root page) there is nothing to go back to, so the menu button shows
  const titleEl = ttl(who.name || "@" + who.handle);
  topEl.append(bar(cur.r === "zen" ? menuBtn() : backBtn(), titleEl));
  const bn = h("div", { class: "banner" });
  const av = rAv(who, 0);
  av.className = "av xl";
  av.style.width = ""; av.style.height = ""; av.style.fontSize = "";
  const bio = h("p", { class: "pbio" }, "");
  const stat = h("div", { class: "pstat" });
  const followBtn = h("button", { class: "fbtn", disabled: true }, "Follow");
  const msgBtn = h("button", { class: "ghost", style: "display:none", onclick: () => openDm(cur.id) }, "Message");
  const moreBtn = h("button", { class: "ghost", disabled: true, "aria-label": "More" }, ic("dots", 20));
  const pnEl = h("h1", { class: "pname" }, who.name), phEl = h("p", { class: "phand" }, "@" + who.handle);
  // on his own profile the owner changes how Zenith looks; everybody else can follow or block him like anyone
  const ownerOfZen = !!(S.zen && cur.id === S.zen.id && isOwner());
  const info = h("div", { class: "pinfo" },
    h("div", { class: "arow" }, av, h("div", { class: "btns" }, ownerOfZen ? [followBtn, h("button", { class: "ghost", onclick: zenEdit }, "Edit Profile")] : [followBtn, msgBtn, moreBtn])),
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
    pageAll((f, t) => sb.from(table).select("post_id").eq("user_id", cur.id).order("post_id").range(f, t)).then(({ data, error }) => {
      // a failed read is shown as a failure (or leaves the saved list as it was), never as an empty list
      if (error || !data) { if (tab === name && !hit) { listEl.textContent = ""; failBox(listEl, "Could not load this list. Check your connection.", () => idsTab(name, table, empty, icon)); } return; }
      const ids = data.map(x => x.post_id);
      cacheWrite(key, ids);
      if (tab === name) showIds(ids, empty, icon);
    }, () => { if (tab === name && !hit) { listEl.textContent = ""; failBox(listEl, "Could not load this list. Check your connection.", () => idsTab(name, table, empty, icon)); } });
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
      const byRemote = new Map(S.posts.filter(x => x.remote).map(x => [x.remote, x]));
      (theirReposts || []).forEach(r => { const p = byRemote.get(r.post_id); if (p && !p.parent && !had.has(p.remote) && !(p.ra && p.ra.id === cur.id)) items.push({ p, t: r.t, pin: 0, rp: true }); });
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
  loadUserPosts(cur.id).then(ch => { if (ch && listEl.isConnected) { drawList(); paintStat(); } }, () => {});
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
    moreBtn.disabled = !st;
  };
  const paintAcc = acc => {
    av.querySelectorAll(":scope > img.pic").forEach(i => i.remove());
    // the page may have been drawn with a stand-in name ("user"), so the letter and its color are taken again from the real one
    if ((acc.username || "").toLowerCase() !== "zenith" && !av.classList.contains("zenav")) {
      const real = rAv({ name: acc.display_name != null ? acc.display_name : acc.username, handle: acc.username }, 0);
      av.style.background = real.style.background;
      av.textContent = real.textContent;
    }
    if (ownMedia(acc.avatar)) av.prepend(picImg(acc.avatar));
    else if ((acc.username || "").toLowerCase() === "zenith") { av.classList.add("zenav"); av.style.background = ""; av.innerHTML = ZEN_SVG; }
    bn.textContent = "";
    if (acc.banner_theme === "avatar" && (ownMedia(acc.banner) || ownMedia(acc.avatar))) bn.append(mkImg(ownMedia(acc.banner) ? acc.banner : acc.avatar, "pic blur")); else if (ownMedia(acc.banner)) bn.append(picImg(acc.banner));
    pnEl.textContent = acc.display_name != null ? acc.display_name : (acc.username || who.name);
    if (pnEl.textContent) titleEl.textContent = pnEl.textContent;
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
    sb.from("blocks").select("blocker_id").eq("blocker_id", cur.id).eq("blocked_id", sbUser.id),
    // the mute answer travels with the rest, and when it fails only the mute state is left as it was
    Promise.resolve(sb.from("mutes").select("muted_id").eq("muter_id", sbUser.id).eq("muted_id", cur.id).maybeSingle()).catch(() => ({ data: null, error: true }))
  ]).then(all => {
    const results = all.slice(0, 5), mr = all[5];
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
    applyState(Object.assign({ acc, following: !!(fol && fol.length), followsMe: !!(folMe && folMe.length), blocked: !!(blk && blk.length) }, st && st.muted ? { muted: true } : {}));
    if (mr && !mr.error) st.muted = !!mr.data;
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
    if (error && !(on && error.code === "23505")) { st.following = !on; counts.followers += on ? -1 : 1; paintFollow(); paintStat(); saveState(); toast("Could not update follow"); }
  };
  const toggleBlock = async () => {
    if (!st) return;
    const on = !st.blocked;
    st.blocked = on; paintFollow(); saveState();
    if (!(await setBlocked(cur.id, on))) { st.blocked = !on; paintFollow(); saveState(); toast("Could not update block"); return; }
    st.following = false; st.followsMe = false;
    countsOf(cur.id, c => { counts = c; paintStat(); });
    paintFollow(); saveState(); paintStat();
    toast(on ? "Blocked" : "Unblocked");
  };
  const toggleMute = async () => {
    if (!st) return;
    const on = !st.muted;
    const { error } = on
      ? await sb.from("mutes").insert({ muter_id: sbUser.id, muted_id: cur.id })
      : await sb.from("mutes").delete().eq("muter_id", sbUser.id).eq("muted_id", cur.id);
    if (error && !(on && error.code === "23505")) { toast("Could not update mute"); return; }
    st.muted = on; saveState();
    toast(on ? "Muted. Their posts are hidden from your feed" : "Unmuted");
    loadFeed().catch(() => {});
  };
  moreBtn.onclick = () => {
    if (!st) return;
    sheet([
      { icon: "eyeoff", label: st.muted ? "Unmute account" : "Mute account", fn: toggleMute },
      { icon: "flag", label: "Report account", danger: true, fn: () => reportAccount(cur.id) },
      { icon: "close", label: st.blocked ? "Unblock" : "Block", danger: !st.blocked, fn: toggleBlock },
      { label: "Cancel", cancel: true }], "@" + (st.acc && st.acc.username || who.handle));
  };
}
// blocking also ends the follows between the two people; the feed is asked again afterwards
async function setBlocked(id, on) {
  const { error } = on
    ? await sb.from("blocks").insert({ blocker_id: sbUser.id, blocked_id: id })
    : await sb.from("blocks").delete().eq("blocker_id", sbUser.id).eq("blocked_id", id);
  if (error && !(on && error.code === "23505")) return false;
  if (on) {
    await sb.from("follows").delete().eq("follower_id", sbUser.id).eq("followee_id", id);
    await sb.from("follows").delete().eq("follower_id", id).eq("followee_id", sbUser.id);
  }
  loadFeed().catch(() => {});
  return true;
}
// tell us an account breaks the rules
function reportAccount(id) {
  const why = [["harassment", "Bullying or harassment"], ["hate", "Hate speech"], ["threats", "Threats or violence"], ["selfharm", "Self harm"], ["sexual", "Sexual content"], ["impersonation", "Pretending to be someone"], ["spam", "Spam or scam"], ["other", "Something else"]];
  sheet([...why.map(w => ({ label: w[1], fn: async () => {
    const { error } = await sb.from("user_reports").insert({ reporter_id: sbUser.id, reported_id: id, reason: w[0] });
    if (error && error.code !== "23505") { toast("Could not send the report"); return; }
    toast("Thanks, we will check it");
  } })), { label: "Cancel", cancel: true }], "Why are you reporting this account?");
}


// a moving profile photo cannot be shrunk to a picture, so it is stored as a file like the banner
async function avatarValue(src) {
  if (!src) return null;
  if (!/^data:image\/gif/.test(src)) return (await shrinkImg(src, 160)) || undefined;
  if (!sbUser) return undefined;
  const blob = await (await fetch(src)).blob();
  const path = sbUser.id + "/avatar-" + Date.now() + ".gif";
  const { error } = await sb.storage.from("media").upload(path, blob, { contentType: "image/gif" });
  if (error) return undefined;
  return sb.storage.from("media").getPublicUrl(path).data.publicUrl;
}
// what the server holds now for a picture of this account, read before it is replaced
async function oldFileOf(id, col) {
  try { const { data } = await sb.from("accounts").select(col).eq("id", id).single(); return data ? data[col] : null; } catch (e) { return null; }
}
// a replaced or removed banner or moving picture is deleted from storage so old ones do not pile up
function dropOldFile(old, url) {
  if (!old || old === url) return;
  const p = storagePath(old, "media");
  if (p && /\/(banner|avatar)-\d+\./.test(p)) sb.storage.from("media").remove([p]).then(() => {}, () => {});
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
    const real = await imgReal(srcs[i]);
    if (!real) continue;
    const blob = await (await fetch(real)).blob();
    const ext = (blob.type.split("/")[1] || "bin").replace("jpeg", "jpg");
    const path = sbUser.id + "/" + Date.now() + "-" + i + "." + ext;
    const { error } = await sb.storage.from("media").upload(path, blob, { contentType: blob.type });
    if (error) { if (urls.length) sb.storage.from("media").remove(urls.map(u => storagePath(u, "media")).filter(Boolean)).catch(() => {}); return null; }
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
  if (!error && data) { np.remote = data.id; np.media = urls || []; persist(); if (isOwner()) { setTimeout(zenNudge, 22000); setTimeout(zenNudge, 50000); } }
  else {
    // a lost reply (no error code) may still have stored the post, so its photos are kept
    if (urls && urls.length && error && error.code) sb.storage.from("media").remove(urls.map(u => storagePath(u, "media")).filter(Boolean)).then(() => {}, () => {});
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
        // only a change of the words marks it as edited (removing or adding a photo does not)
        ed.edited = !!ed.edited || text !== was.text;
        ed.text = text; ed.imgs = imgs.slice();
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
      onBack: () => resolve(null),
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
    // moves are drawn once per frame, not once per event
    let rq = 0;
    const schedule = () => { if (!rq) rq = requestAnimationFrame(() => { rq = 0; draw(); }); };
    const zoomAt = (g, px, py) => {
      const ns = Math.min(Math.max(s * g, minS), minS * 4);
      const f = ns / s;
      cx = px + (cx - px) * f; cy = py + (cy - py) * f; s = ns;
      clamp(); schedule();
    };
    const pts = new Map();
    cv.addEventListener("pointerdown", e => { try { cv.setPointerCapture(e.pointerId); } catch (x) {} pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
    cv.addEventListener("pointermove", e => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      const np = { x: e.clientX, y: e.clientY };
      if (pts.size === 1) { cx += np.x - p.x; cy += np.y - p.y; clamp(); schedule(); }
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
          clamp(); schedule();
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
  const paintBanner = (el, banner, theme, avatar) => { el.querySelectorAll(":scope > img.pic").forEach(i => i.remove()); if (theme === "avatar" && (banner || avatar)) el.prepend(mkImg(banner || avatar, "pic blur")); else if (banner) el.prepend(picImg(banner)); };
  const paint = () => {
    paintBanner(bn, bannerData, themeVal, avatarData);
    setPic(av, avatarData);
    avl.textContent = (name.value || handle.value || "?").trim().charAt(0).toUpperCase();
  };
  const pickImg = (label, size, opts, set, has, remove, removeLabel) => {
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
    const lab = h("label", { class: "pick", title: label }, ic("camera", size), inp);
    // with a photo already in place the button asks first: choose another one or remove it
    if (has) lab.addEventListener("click", e => {
      if (!has()) return;
      e.preventDefault();
      sheet([{ label: "Choose a photo", icon: "image", fn: () => inp.click() }, { label: removeLabel, icon: "trash", danger: true, fn: () => { remove(); paint(); } }, { label: "Cancel", cancel: true }], removeLabel === "Remove banner" ? "Banner" : "Profile photo");
    });
    return lab;
  };
  name.addEventListener("input", () => { avl.textContent = (name.value || handle.value || "?").trim().charAt(0).toUpperCase(); });
  bn.append(pickImg("Change banner", 18, { w: 1000, h: 330, gw: 600, gh: 198, title: "Crop banner" }, d => { bannerData = d; themeVal = "default"; drawSeg(); }, () => bannerData, () => { bannerData = null; }, "Remove banner"));
  const eav = h("div", { class: "eav" }, av, pickImg("Change avatar", 16, { w: 320, h: 320, gw: 240, gh: 240, round: true, title: "Crop profile photo" }, d => { avatarData = d; }, () => avatarData, () => { avatarData = null; if (themeVal === "avatar" && !bannerData) themeVal = "default"; drawSeg(); }, "Remove photo"));
  const seg = h("div", { class: "seg" });
  const drawSeg = () => { seg.textContent = ""; [["default", bannerData ? "Custom" : "Default"], ["avatar", "Blurred photo"]].forEach(([v, t]) => seg.append(h("button", { class: v === themeVal ? "on" : "", onclick: () => { if (v === "avatar" && !bannerData && !avatarData) { toast("Pick a picture first"); return; } themeVal = v; paint(); drawSeg(); } }, t))); };
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
          // a picture already saved on the server (same as the last saved one) is not sent again
          const avSrc = pr.avatar;
          if (avSrc === was.avatar && pr.avSynced === avSrc) { /* unchanged and already saved */ } else avatarValue(pr.avatar).then(async small => {
            if (small === undefined) { toast("Could not upload profile photo"); return; }
            const oldAv = await oldFileOf(uid0, "avatar");
            if (sbUser) sb.from("accounts").update({ avatar: small }).eq("id", uid0).then(({ error }) => { if (error) toast("The new picture was not saved. " + plainErr(error, "Try again later")); else { pr.avSynced = avSrc; dropOldFile(oldAv, small); persist(); } loadFeed(); if (sbUser && sbUser.id === uid0) rememberAccount({ username: pr.handle, name: pr.name || pr.handle, avatar: small }).catch(() => {}); });
          });
          const src = pr.banner;
          if (src === was.banner && pr.bnSynced === src) { /* unchanged and already saved */ } else bannerUrl(src).then(async url => {
            if (url === undefined) { toast("Could not upload banner"); return; }
            const oldBn = await oldFileOf(uid0, "banner");
            sb.from("accounts").update({ banner: url }).eq("id", uid0).then(({ error }) => { if (error) toast("The new banner was not saved. " + plainErr(error, "Try again later")); else if (pr.banner === src || pr.banner === url) { pr.bnSynced = url || null; dropOldFile(oldBn, url); persist(); } });
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
// two short screens, one field each: the first asks for the current password, the last for the new value.
// next(value, valueOfTheFirstScreen) answers a line to show when something is wrong
function stepModal(title, steps) {
  const box = h("div");
  const msg = h("p", { class: "note", role: "alert" });
  let i = 0, busy = false, cur = null, keep = "";
  const m = modal({
    title, action: steps[0].label, body: [box, msg],
    onAction: async close => {
      if (busy) return;
      msg.textContent = "";
      const v = cur.input.value;
      busy = true; m.act.disabled = true;
      try {
        const err = await steps[i].next(v, keep);
        if (typeof err === "string" && err) { msg.textContent = err; return; }
        if (i < steps.length - 1) { keep = v; i++; draw(); return; }
        close();
        if (steps[i].done) toast(steps[i].done());
      } finally { busy = false; m.act.disabled = false; }
    }
  });
  const draw = () => {
    const s = steps[i];
    box.textContent = "";
    cur = s.field();
    box.append(h("p", { class: "note" }, s.note), cur.wrap);
    m.act.textContent = s.label;
    cur.input.addEventListener("keydown", e => { if (e.key === "Enter") m.act.click(); });
    setTimeout(() => cur.input.focus(), 0);
  };
  draw();
}
const firstStep = () => ({
  note: "Type your current password to start.", label: "Next",
  field: () => pwField("Current password", "current-password"),
  next: async v => { if (!v) return "Type your current password"; const vp = await verifyPassword(v); if (!vp.ok) return vp.msg; }
});
function changePassV() {
  let kr = "";
  stepModal("Change password", [firstStep(), {
    note: "Choose a new password. Use 8 or more characters. It must be one you never used before.", label: "Save",
    field: () => pwField("New password", "new-password"),
    next: async (raw, cur) => {
      // spaces at the ends (usually from pasting) are not part of a password
      const nw = raw.trim();
      if (!nw) return "Type a new password";
      if (nw.length < 8) return "New password needs 8 or more characters";
      if (pwBytes(nw) > 72) return "New password is too long (72 bytes at most)";
      if (nw === cur.trim()) return "Pick a different password";
      if (await pwnedPassword(nw)) return PWNED_MSG;
      const pr = await callFn("signin", { action: "setpw", current: cur, password: nw }).catch(() => null);
      if (!pr) return "Could not reach Nook. Check your connection";
      if (!pr.ok) return setpwMsg(pr);
      await takeSession(pr);
      kr = await loginBackup(nw, { reseal: true });
    },
    done: () => kr === "fail" ? "Password changed. Your message key could not be saved with it" : "Password changed"
  }]);
}
function changeEmailV() {
  let sent = "";
  stepModal("Change email", [firstStep(), {
    note: "Type the new email. We send a link there, and the email changes when you open it.", label: "Send link",
    field: () => { const input = h("input", { class: "in", type: "email", placeholder: "New email", autocomplete: "email", "aria-label": "New email" }); return { input, wrap: h("div", { class: "fld" }, input) }; },
    next: async raw => {
      const e = raw.trim().toLowerCase();
      if (!e) return "Type the new email";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return "That email does not look real";
      if (e === (sbUser.email || "").toLowerCase()) return "That is already your email";
      const { error } = await sb.auth.updateUser({ email: e }, { emailRedirectTo: location.origin + location.pathname });
      if (error) {
        const c = error.code || "", m = error.message || "";
        if (c === "email_exists" || c === "user_already_exists" || /already (been )?registered/i.test(m)) return "That email is already used by another account";
        if (c === "over_email_send_rate_limit" || error.status === 429) return "Too many emails were sent. Wait a few minutes and try again";
        return authMsg(error);
      }
      sent = e;
    },
    done: () => "Confirmation link sent to " + sent
  }]);
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
    // the page that is already open is left out of the menu
    ...[["search", "Search", "search"], ["lists", "Lists", "list"], ["settings", "Settings", "sliders"]].filter(x => x[0] !== stack[0].r).map(x => item(...x)));
  const close = trackLayer(() => dismiss(scrim, dr));
  layer.append(scrim, dr);
}

const BAN_EMAIL = "nook-banned-email";
// the address is only kept for this visit; the copy older versions left in permanent storage is removed
try { localStorage.removeItem(BAN_EMAIL); } catch (e) {}
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
    memCache.clear();
    sessionStorage.removeItem("nook-route");
  } catch (e) {}
  // the chat key stays while a banned person can still download their backup, so old messages can be opened
  try { if ("caches" in window) caches.delete("nook-share"); } catch (e) {}
  // only the key of the account being cleared goes; other accounts on this phone keep theirs
  if (!keepKeys) { try { if (sbUser) { const kdb = await keyDb(); await new Promise(res => { const t = kdb.transaction("k", "readwrite"); t.objectStore("k").delete(sbUser.id); t.oncomplete = res; t.onerror = res; t.onabort = res; }); } else { let mk = null; try { mk = localStorage.getItem(LOCAL_UID); } catch (x) {} if (mk) { const kdb = await keyDb(); await new Promise(res => { const t = kdb.transaction("k", "readwrite"); t.objectStore("k").delete(mk); t.oncomplete = res; t.onerror = res; t.onabort = res; }); } } } catch (e) {} }
}
let banShown = false;
function showBanned(email) {
  if (banShown) return;
  banShown = true;
  try {
    const mail = email || (sbUser && sbUser.email) || "";
    if (mail) sessionStorage.setItem(BAN_EMAIL, mail);
  } catch (e) {}
  if (rtChan) { try { sb.removeChannel(rtChan); } catch (e) {} rtChan = null; rtOk = false; }
  stopDelChan();
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
  const leave = () => { wipeLocal(false); try { sessionStorage.removeItem(BAN_EMAIL); } catch (e) {} banShown = false; stack = [{ r: "auth" }]; scrolls.length = 0; render(); };
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
  day.addEventListener("keydown", e => { if (e.key === "Enter" && !go1.disabled) send(); });
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
const pwBytes = v => new TextEncoder().encode(String(v)).length;
const extFromType = t => ({ "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" })[t] || "bin";
// the chat key of this browser, only if it is still here; used to open old messages in the backup
async function banChatKey(uid, peerKey) {
  try {
    if (!uid || !peerKey || !crypto.subtle) return null;
    const kdb = await keyDb();
    let rec;
    try { rec = await new Promise((res, rej) => { const q = kdb.transaction("k").objectStore("k").get(uid); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); } finally { try { kdb.close(); } catch (e) {} }
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
  const todo = (j.files || []).slice();
  const pool = async () => {
    while (todo.length) {
      const f = todo.shift();
      try { const r = await fetch(f.url); if (r.ok) got.set(f.bucket + "/" + f.name, new Uint8Array(await r.arrayBuffer())); } catch (e) {}
      say("Getting your files " + (++n) + " of " + j.files.length);
    }
  };
  await Promise.all([pool(), pool(), pool(), pool()]);
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

  let sealed = 0, chatNo = 0;
  for (const c of d.chats || []) {
    if (!(c.messages || []).length) continue;
    const key = await banChatKey(uid, c.peer_public_key);
    const who = (++chatNo) + "-" + safeName(c.person);
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
  try { saved = sessionStorage.getItem(BAN_EMAIL) || ""; } catch (e) {}
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
    // the code box only appears once the key is shown, so it is clear what the code is for
    const codeFld = h("div", { class: "fld", hidden: true }, h("label", {}, "Then type the 6 digit code it shows"), code);
    const msg = h("p", { class: "note", role: "alert" });
    let done = false, stage = "pw", pwIn = null;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    const m = modal({
      title: "Authenticator app",
      action: "Continue",
      body: [box, codeFld, msg],
      onBack: () => finish(false),
      onCancel: close => { close(); finish(false); },
      onAction: async close => {
        // first the password, then the code
        if (stage === "pw") { msg.textContent = ""; if (!pwIn || !pwIn.value) { msg.textContent = "Type your password"; return; } begin(pwIn.value); return; }
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
    const askPw = note => {
      const pw = pwField("Your password", "current-password");
      pw.input.maxLength = 200;
      pw.input.setAttribute("enterkeyhint", "go");
      pwIn = pw.input;
      stage = "pw";
      m.act.textContent = "Continue";
      m.act.disabled = false;
      codeFld.hidden = true;
      pw.input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); m.act.click(); } });
      box.textContent = "";
      box.append(h("p", { class: "note" }, note || "Type your password to start."), pw.wrap);
      setTimeout(() => { try { pw.input.focus(); } catch (e) {} }, 50);
    };
    const begin = pw => {
      m.act.disabled = true;
      box.textContent = "";
      box.append(h("p", { class: "note" }, "Getting your key..."));
      return callFn("totp", { action: "begin", password: pw }).then(r => {
        box.textContent = "";
        if (!r.ok) { askPw(failText(r, "Could not start the setup.")); return; }
        codeFld.hidden = false;
        stage = "code";
        m.act.textContent = "Turn on";
        box.append(
          h("a", { class: "pri sbtn big", href: r.body.uri }, "Add Nook to the app"),
          h("p", { class: "note" }, "If that does not open the app, add it by hand with this key. Tap the key to copy it."),
          h("button", { class: "keybox", type: "button", onclick: () => copy(r.body.secret) }, r.body.secret));
        m.act.disabled = false;
      });
    };
    askPw();
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
  const code = codeInput();
  code.placeholder = "Authenticator code (only if you use one)";
  code.setAttribute("aria-label", "Authenticator code, optional");
  const msg = h("p", { class: "note", role: "alert" });
  const alt = h("button", { class: "tbtn", type: "button", onclick: () => { const v = ident.value.trim(); m.close(() => recoverCodeModal(v)); } }, "Use my authenticator code instead");
  const m = modal({
    title: "Reset password",
    action: "Send link",
    body: [h("p", { class: "note" }, "We will email you a link to choose a new password. If you turned on an authenticator app, type its code too."), h("div", { class: "fld" }, ident), h("div", { class: "fld" }, code), msg, h("div", { class: "ctr" }, alt)],
    onAction: async close => {
      msg.textContent = "";
      const id = ident.value.trim();
      if (!id) { msg.textContent = "Type your email or username"; return; }
      m.act.disabled = true;
      try {
        const rn = resetNonceMake();
        const r = await callFn("totp", { action: "reset", ident: id, code: code.value.replace(/\s+/g, ""), redirectTo: location.origin + location.pathname + (rn ? "?rn=" + rn : "") });
        if (!r.ok) { msg.textContent = "Could not send the link. Try again later."; return; }
        close();
        toast("If that account exists and the code fits, a reset link is on its way");
      } catch (e) { msg.textContent = "Could not reach the server. Try again later."; }
      finally { m.act.disabled = false; }
    }
  });
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
      if (pwBytes(pw.value) > 72) { msg.textContent = "New password can be 72 bytes at most (fewer for emoji or accents)"; return; }
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
      if (pwBytes(pw.value) > 72) { msg.textContent = "New password is too long (72 bytes at most)"; return; }
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
      const { data, error: qe } = await sb.from("push_subs").select("endpoint").eq("endpoint", sub.endpoint).maybeSingle();
      if (!qe && !data) { try { await sub.unsubscribe(); } catch (e) {} sub = null; }
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
// one connection is kept and reused instead of opening a new one for every call
let acctDbP = null;
function acctDb() {
  return acctDbP || (acctDbP = new Promise((res, rej) => {
    const r = indexedDB.open("nook-accts", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("a");
    r.onsuccess = () => { const d = r.result; d.onclose = () => { acctDbP = null; }; d.onversionchange = () => { d.close(); acctDbP = null; }; res(d); };
    r.onerror = () => { acctDbP = null; rej(r.error); };
  }));
}
async function acctGet(k) {
  const db = await acctDb();
  return new Promise((res, rej) => { const q = db.transaction("a").objectStore("a").get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
async function acctPut(k, v) {
  if (k === "list" && Array.isArray(v)) v = await Promise.all(v.map(async a => (a && typeof a.rt === "string") ? Object.assign({}, a, { rt: await rtSeal(a.rt) }) : a));
  const db = await acctDb();
  return new Promise((res, rej) => { const t = db.transaction("a", "readwrite"); t.objectStore("a").put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}
async function acctDel(k) {
  const db = await acctDb();
  return new Promise((res, rej) => { const t = db.transaction("a", "readwrite"); t.objectStore("a").delete(k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}
// refresh tokens are sealed with AES-GCM under a non-extractable key kept in the same database; plain values from older versions are still read and sealed on the next write
const RT_PFX = "s1:";
let rtKeyP = null;
function rtKey() {
  if (rtKeyP) return rtKeyP;
  rtKeyP = (async () => {
    if (!(window.crypto && crypto.subtle)) return null;
    const have = await acctGet("rtkey").catch(() => null);
    if (have && typeof have === "object") return have;
    const k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const db = await acctDb();
    // add never overwrites, so two tabs racing end up with one key
    await new Promise(res => { const t = db.transaction("a", "readwrite"); t.objectStore("a").add(k, "rtkey").onerror = e => { e.preventDefault(); }; t.oncomplete = () => res(); t.onerror = () => res(); t.onabort = () => res(); });
    return (await acctGet("rtkey").catch(() => null)) || k;
  })().catch(() => { rtKeyP = null; return null; });
  return rtKeyP;
}
async function rtSeal(v) {
  if (typeof v !== "string" || !v || v.startsWith(RT_PFX)) return v;
  try {
    const k = await rtKey();
    if (!k) return v;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(v)));
    const all = new Uint8Array(12 + ct.length); all.set(iv); all.set(ct, 12);
    let bin = ""; for (let i = 0; i < all.length; i++) bin += String.fromCharCode(all[i]);
    return RT_PFX + btoa(bin);
  } catch (e) { return v; }
}
async function rtOpen(v) {
  if (typeof v !== "string" || !v.startsWith(RT_PFX)) return v;
  try {
    const k = await rtKey();
    if (!k) return "";
    const bin = atob(v.slice(RT_PFX.length)), all = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) all[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, k, all.slice(12)));
  } catch (e) { return ""; }
}
let rtMigrated = false;
async function acctList() {
  try {
    const l = await acctGet("list");
    if (!Array.isArray(l)) return [];
    const out = await Promise.all(l.map(async a => (a && typeof a.rt === "string") ? Object.assign({}, a, { rt: await rtOpen(a.rt) }) : a));
    // old plain tokens are sealed once, and only if the stored list did not change in the meantime
    if (!rtMigrated && l.some(a => a && typeof a.rt === "string" && a.rt && !a.rt.startsWith(RT_PFX))) {
      rtMigrated = true;
      (async () => {
        const sealed = await Promise.all(out.map(async a => (a && typeof a.rt === "string") ? Object.assign({}, a, { rt: await rtSeal(a.rt) }) : a));
        if (sealed.every((a, i) => !a || a.rt === l[i].rt)) return;
        const db = await acctDb(), before = JSON.stringify(l);
        await new Promise(res => { const t = db.transaction("a", "readwrite"), st = t.objectStore("a"); const q = st.get("list"); q.onsuccess = () => { if (JSON.stringify(q.result) === before) st.put(sealed, "list"); }; t.oncomplete = t.onerror = t.onabort = () => res(); });
      })().catch(() => {});
    }
    return out;
  } catch (e) { return []; }
}
// the saved account list is read, changed and written back, so these run one after another and never write back a spent token
let listQ = Promise.resolve();
const withList = fn => (listQ = listQ.then(fn, fn));
async function rememberAccount(info) {
  if (!sbUser) return;
  const { data } = await sb.auth.getSession();
  const ss = data && data.session;
  if (!ss || ss.user.id !== sbUser.id) return;
  await withList(async () => {
  const list = await acctList();
  const old = list.find(a => a.id === sbUser.id) || {};
  const av = info && typeof info.avatar === "string" && info.avatar.length < 400000 ? info.avatar : (info ? null : old.avatar || null);
  // the first account saved on this phone is the main one and cannot be removed from the list
  const entry = { id: sbUser.id, rt: ss.refresh_token, username: (info && info.username) || old.username || "", name: (info && info.name) || old.name || "", avatar: av, main: old.main === true || (!list.some(a => a.id === sbUser.id) && list.length === 0) };
  const at = list.findIndex(a => a.id === sbUser.id);
  if (at >= 0) list[at] = entry; else list.push(entry);
  await acctPut("list", list);
  });
}
const mainAccountId = list => ((list.find(a => a.main) || list[0]) || {}).id;
async function forgetAccount(id, keepSnap) {
  await withList(async () => { const list = await acctList(); await acctPut("list", list.filter(a => a.id !== id)); });
  if (!keepSnap) await acctDel("snap:" + id).catch(() => {});
}
async function saveSnap(id) { await acctPut("snap:" + id, JSON.stringify(await fullState())); }
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
    const rp = sb.auth.refreshSession({ refresh_token: entry.rt });
    const got = await Promise.race([rp, wait(12000).then(() => null)]);
    if (!got) {
      // a late answer still rotated the login, so the new one is kept or the saved one is spent
      rp.then(async r => { if (r && r.data && r.data.session) await withList(async () => acctPut("list", (await acctList()).map(x => x.id === entry.id ? Object.assign({}, x, { rt: r.data.session.refresh_token }) : x))); }).catch(() => {});
      enterFail = "offline"; return false;
    }
    const { data, error } = got;
    // only a real refusal of the saved login removes the account; a bad connection, a busy server or a limit never does
    if (error && error.status === 429) { enterFail = "busy"; return false; }
    if (error && !(error.status === 400 || error.status === 401 || error.status === 403)) { enterFail = "offline"; return false; }
    if (error || !data || !data.session) { enterFail = "login"; await forgetAccount(entry.id); return false; }
    // the login rotated, so the new one is saved at once
    await withList(async () => acctPut("list", (await acctList()).map(x => x.id === entry.id ? Object.assign({}, x, { rt: data.session.refresh_token }) : x))).catch(() => {});
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
// keep: nothing of this account is deleted from the phone (deactivating); its saved copy waits for the day it signs back in
async function leaveThisAccount(keep) {
  leaving = true;
  const me = sbUser.id;
  if (keep) await saveSnap(me).catch(() => {});
  await forgetAccount(me, !!keep);
  // the saved copies of this account's inbox and chats leave the phone with it
  // the saved follows, nicknames, inbox and follower counts never stay behind on the phone after a sign out, even when the rest is kept
  try { Object.keys(localStorage).filter(k => k.startsWith(CACHE_PFX) && (!keep && k.includes(me) || /^nook-cache:(follows|fl|ids|nicks|clears|inbox|fc|rpt|ui):/.test(k))).forEach(k => localStorage.removeItem(k)); } catch (e) {}
  memCache.clear();
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
  const say = t => { msg.textContent = ""; if (t) toast(t); };
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
      if (pwBytes(p) > 72) { say("Password is too long (72 bytes at most)"); return; }
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
        let keyFail = false;
        try {
          const rec = await makeKeyPair();
          await saveLocalKeys(await keyDb(), id, rec);
          const row = await sealKeyBackup(rec.priv, rec.pub, p, "login");
          row.user_id = id;
          const kb = await tmp.from("key_backups").upsert(row, { onConflict: "user_id,mode" });
          const ku = await tmp.from("accounts").update({ public_key: rec.pub }).eq("id", id);
          if (kb.error || ku.error) keyFail = true;
        } catch (x) { keyFail = true; }
        await withList(async () => { const list = await acctList(); await acctPut("list", list.filter(x => x.id !== id).concat({ id, rt: sr.body.session.refresh_token, username: u, name: n, avatar: null, main: false })); });
        linkSavedAccounts(id, sr.body.session.access_token).catch(() => {});
        close();
        // the key is made again the first time this account is opened, so this is only a heads up
        toast(keyFail ? "Account created. Its message key is set up when you open it" : "Account created");
        setTimeout(openAccounts, 350);
      } catch (x) { say("Something went wrong. Try again"); } finally { go1.disabled = false; }
  };
}
// a different account that signs in here may be hidden from other people (deactivated): its own login reads it and brings it back
async function infoForSession(sess, uid) {
  const cols = "id,username,display_name,avatar,deactivated";
  const head = { apikey: SB_KEY, authorization: "Bearer " + sess.access_token, "content-type": "application/json" };
  try {
    const r = await fetch(SB_URL + "/rest/v1/accounts?select=" + cols + "&id=eq." + uid, { headers: head });
    const rows = r.ok ? await r.json() : [];
    const row = rows[0] || null;
    if (row && row.deactivated) {
      await Promise.all([fetch(SB_URL + "/rest/v1/rpc/nook_restore_account", { method: "POST", headers: head, body: "{}" }), fetch(SB_URL + "/rest/v1/rpc/set_my_deactivated", { method: "POST", headers: head, body: JSON.stringify({ flag: false }) })]);
    }
    return row;
  } catch (e) { return null; }
}
function addAccountModal() {
  passkeyWarm();
  const email = h("input", { class: "in", type: "email", placeholder: "Email", autocomplete: "email", "aria-label": "Email", "data-pm": "1" });
  const pw = pwField("Password", "current-password");
  const pass = pw.input;
  const msg = h("p", { class: "note", role: "alert" });
  // the message also shows as a toast, because the keyboard can cover the line under the fields
  const say = t => { msg.textContent = ""; if (t) toast(t); };
  const go1 = h("button", { class: "pri" }, "Sign in");
  const m = modal({
    title: "",
    action: "Add",
    body: [h("div", { class: "auth", style: "padding-top:max(4vh,16px)" },
      h("h1", {}, "Nook"),
      h("p", { class: "sub" }, "Sign in to continue"),
      email, pw.wrap, msg, go1,
      pkOk() ? h("button", { class: "ghost", onclick: async e => {
        const b = e.currentTarget; msg.textContent = ""; b.disabled = true;
        try {
          const r = await passkeyAsk();
          if (!r.session) { if (r.err) say(r.err); return; }
          const u = { user: jwtUser(r.session.access_token) };
          if (!u.user) { say("Could not sign in. Try again"); return; }
          if (u.user.id === sbUser.id) { say("That is the account you are in"); return; }
          const info = await infoForSession(r.session, u.user.id);
          if (!info || !info.username) { say("Could not load that account. Try again"); return; }
          await withList(async () => { const list = await acctList(); await acctPut("list", list.filter(a => a.id !== info.id).concat({ id: info.id, rt: r.session.refresh_token, username: info.username, name: info.display_name || info.username, avatar: typeof info.avatar === "string" && info.avatar.length < 400000 ? info.avatar : null, main: false })); });
          linkSavedAccounts(info.id, r.session.access_token).catch(() => {});
          m.close();
          toast("Account added");
          setTimeout(openAccounts, 350);
        } finally { b.disabled = false; }
      } }, "Sign in with " + pkLabel()) : null,
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
        const info = await infoForSession(r.body.session, u.user.id);
        if (!info || !info.username) { say("Could not load that account. Try again"); return; }
        await withList(async () => { const list = await acctList(); await acctPut("list", list.filter(a => a.id !== info.id).concat({ id: info.id, rt: r.body.session.refresh_token, username: info.username, name: info.display_name || info.username, avatar: typeof info.avatar === "string" && info.avatar.length < 400000 ? info.avatar : null, main: false })); });
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
  // written onto the list as it is now, so a login that rotated while this ran is not put back
  if (changed) await acctPut("list", (await acctList()).map(x => { const a = list.find(y => y.id === x.id); return a ? Object.assign({}, x, { username: a.username, name: a.name, avatar: a.avatar }) : x; }));
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
    const rotated = new Map();
    await Promise.all(list.filter(a => a.id !== sbUser.id && a.id !== newId && a.rt).map(async a => {
      const r = await tmp.auth.refreshSession({ refresh_token: a.rt });
      if (r.data && r.data.session) { tokens.push(r.data.session.access_token); rotated.set(a.id, r.data.session.refresh_token); }
    }));
    // written onto the list as it is now, so accounts added while this ran are not lost
    if (rotated.size) await withList(async () => acctPut("list", (await acctList()).map(x => rotated.has(x.id) ? Object.assign({}, x, { rt: rotated.get(x.id) }) : x)));
    await fetch(SB_URL + "/functions/v1/link-accounts", { method: "POST", headers: { "content-type": "application/json", apikey: SB_KEY, authorization: "Bearer " + mine.access_token }, body: JSON.stringify({ tokens }) });
  } catch (e) {}
}
// a linked account that is not on this phone yet: its password opens it here
function linkedLoginModal(x) {
  passkeyWarm();
  const pw = pwField("Password");
  const msg = h("p", { class: "note", role: "alert" });
  // the message also shows as a toast, because the keyboard can cover the line under the fields
  const say = t => { msg.textContent = ""; if (t) toast(t); };
  const m = modal({
    title: "@" + x.username,
    action: "Switch",
    body: [pw.wrap, msg, pkOk() ? h("button", { class: "ghost", onclick: async e => {
      const b = e.currentTarget; msg.textContent = ""; b.disabled = true;
      try {
        const r = await passkeyAsk();
        if (!r.session) { if (r.err) say(r.err); return; }
        const { data: u } = await sb.auth.getUser(r.session.access_token);
        if (!u || !u.user || u.user.id !== x.id) { say("That key belongs to a different account"); return; }
        await withList(async () => { const list = await acctList(); await acctPut("list", list.filter(a => a.id !== x.id).concat({ id: x.id, rt: r.session.refresh_token, username: x.username, name: x.name, avatar: x.avatar, main: false })); });
        m.close(() => switchAccount(x.id));
      } finally { b.disabled = false; }
    } }, "Use " + pkLabel()) : null],
    onAction: async close => {
      msg.textContent = "";
      if (!pw.input.value) { say("Enter the password"); return; }
      m.act.disabled = true;
      try {
        const r = await callFn("signin", { action: "linked", target: x.id, password: pw.input.value }).catch(() => null);
        if (!r) { say("Could not reach Nook. Check your connection"); return; }
        if (r.body && r.body.error === "banned") { say("That account is banned"); return; }
        if (!r.ok) { say(r.body && r.body.error === "not_linked" ? "That account is not linked anymore" : signinMsg(r)); return; }
        if (!(r.body && r.body.session)) { say("Could not sign in. Try again"); return; }
        await withList(async () => { const list = await acctList(); await acctPut("list", list.filter(a => a.id !== x.id).concat({ id: x.id, rt: r.body.session.refresh_token, username: x.username, name: x.name, avatar: x.avatar, main: false })); });
        close(() => switchAccount(x.id));
      } finally { m.act.disabled = false; }
    }
  });
}
async function openAccounts() {
  // the linked-accounts query starts now and runs beside the others
  const linksP = Promise.race([sb.from("account_links").select("b").eq("a", sbUser.id), wait(1200).then(() => ({ data: null }))]);
  linksP.catch(() => {});
  const all0 = await acctList();
  const all = await Promise.race([refreshAcctEntries(all0).catch(() => all0), wait(700).then(() => all0)]);
  // the linked accounts that are not on this phone yet
  let others = [], linkedIds = new Set();
  try {
    const { data: ls } = await linksP;
    linkedIds = new Set((ls || []).map(r => r.b));
    const missing = [...linkedIds].filter(id => !all.some(a => a.id === id));
    if (missing.length) {
      const m = await Promise.race([cachedAccounts(missing), wait(1200).then(() => new Map())]);
      others = missing.map(id => { const x = m.get(id) || {}; return { id, username: x.username || "", name: x.display_name || x.username || "", avatar: ownMedia(x.avatar) && x.avatar.length < 400000 ? x.avatar : null }; }).filter(x => x.username);
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
  else if (v.startsWith("post:") && /^[0-9a-f-]{36}$/i.test(v.slice(5))) openSharedPost(v.slice(5)).catch(() => { toast("Could not open this post"); });
  else if (v.startsWith("user:") && /^[0-9a-f-]{36}$/i.test(v.slice(5))) go({ r: "user", id: v.slice(5) });
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
  passkeyWarm();
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
        if (pwBytes(p) > 72) { msg.textContent = "Password is too long (72 bytes at most)"; return; }
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
        try { sessionStorage.removeItem(BAN_EMAIL); } catch (x) {}
        // the typed password opens the saved chat key on a new phone, and locks it for this account when none is saved yet; both run at once and never hold the sign in for long
        if (sd && sd.user) sbUser = sd.user;
        // an account that was deleted less than 30 days ago comes back here; the plain wake up runs after it for older setups
        await Promise.race([Promise.all([Promise.resolve(sb.rpc("nook_restore_account")).then(a => { if (a && a.data === true) { try { sessionStorage.setItem("nook-welcome-back", "1"); } catch (x) {} } }).catch(() => {}).then(() => sb.rpc("set_my_deactivated", { flag: false })).catch(() => {}), sd && sd.user ? loginBackup(p, { fast: true }).catch(() => {}) : null]), wait(10000)]);
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
    ...fields, agreeRow, msg, btn, up || !pkOk() ? null : h("button", { class: "ghost", onclick: async e => {
      const b = e.currentTarget; msg.textContent = ""; b.disabled = true;
      try {
        const r = await passkeyAsk();
        if (!r.session) { if (r.banned) { showBanned(); return; } msg.textContent = r.err || ""; return; }
        const { data: sd, error } = await sb.auth.setSession({ access_token: r.session.access_token, refresh_token: r.session.refresh_token });
        if (error || !sd || !sd.user) { msg.textContent = "Could not sign in. Try again"; return; }
        sbUser = sd.user;
        // an account that was deactivated or deleted less than 30 days ago comes back, like with a password
        await Promise.race([Promise.all([Promise.resolve(sb.rpc("nook_restore_account")).catch(() => {}), Promise.resolve(sb.rpc("set_my_deactivated", { flag: false })).catch(() => {})]), new Promise(r2 => setTimeout(r2, 8000))]);
        location.reload();
      } finally { b.disabled = false; }
    } }, "Sign in with " + pkLabel()), forgot, flip, SIGNUP_OPEN ? null : h("p", { class: "note" }, "New accounts are closed for now"),
    h("p", { class: "note" }, legalLink("terms", "Terms"), " · ", legalLink("privacy", "Privacy"))));
}

const DM_BUCKET = "dm-media";
// the bucket is private: stored links (old public style or new) are turned into the object path and a short signed link
function dmPathOf(url) {
  if (typeof url !== "string") return null;
  for (const k of ["public", "sign", "authenticated"]) {
    const pre = SB_URL + "/storage/v1/object/" + k + "/" + DM_BUCKET + "/";
    if (url.startsWith(pre)) { try { return decodeURIComponent(url.slice(pre.length).split(/[?#]/)[0]); } catch (e) { return null; } }
  }
  return null;
}
const dmSigned = new Map();
function dmSignedUrl(url) {
  if (/^(blob|data):/.test(url || "")) return Promise.resolve(url);
  const path = dmPathOf(url);
  if (!path) return Promise.reject(new Error("gone"));
  const hit = dmSigned.get(path);
  if (hit && hit.t > Date.now()) return hit.p;
  dmSigned.delete(path);
  const e = { t: Date.now() + 3000000, p: Promise.resolve(sb.storage.from(DM_BUCKET).createSignedUrl(path, 3600)).then(r => { if (!r || r.error || !r.data) throw new Error("gone"); return r.data.signedUrl; }) };
  dmSigned.set(path, e);
  e.p.catch(() => { if (dmSigned.get(path) === e) dmSigned.delete(path); });
  return e.p;
}
// many photos are signed in one request instead of one each
function dmSignBatch(mediaList) {
  const paths = [...new Set(mediaList.map(md => dmPathOf(md && md.url)).filter(p => p && !(dmSigned.get(p) && dmSigned.get(p).t > Date.now())))];
  if (paths.length < 2) return;
  const bp = Promise.resolve(sb.storage.from(DM_BUCKET).createSignedUrls(paths, 3600));
  const t = Date.now() + 3000000;
  paths.forEach(p => {
    const e = { t, p: bp.then(r => { const row = r && r.data && r.data.find(x => x.path === p); if (!row || !row.signedUrl) throw new Error("gone"); return row.signedUrl; }) };
    dmSigned.set(p, e);
    e.p.catch(() => { if (dmSigned.get(p) === e) dmSigned.delete(p); });
  });
}
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
// who follows whom (and who liked or reposted what) is never written to the phone's storage; it lives in memory until the page closes or the account leaves
const memCache = new Map();
const MEM_KEYS = /^(follows|fl|ids|rpt):/;
function cacheRead(k) {
  if (MEM_KEYS.test(k)) { const m = memCache.get(k); return m ? { v: m.v, t: m.t } : undefined; }
  try { const r = JSON.parse(localStorage.getItem(CACHE_PFX + k) || "null"); return r || undefined; } catch (e) { return undefined; }
}
function cacheWrite(k, v) {
  if (MEM_KEYS.test(k)) { memCache.set(k, { v, t: Date.now() }); return; }
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
const avKeep = [];
async function preloadAvatars(own) {
  const urls = new Set();
  const add = u => { if (typeof u === "string" && u) urls.add(u); };
  try {
    add(own);
    add(S && S.profile && S.profile.avatar);
    Object.keys(localStorage).filter(k => k.startsWith(CACHE_PFX + "acct:")).slice(0, 40).forEach(k => { try { const r = JSON.parse(localStorage.getItem(k)); add(r && r.v && r.v.avatar); } catch (e) {} });
    const inbox = cacheRead("inbox:" + sbUser.id);
    ((inbox && inbox.v) || []).forEach(cv => add(cv.avatar));
  } catch (e) {}
  const load = u => new Promise(res => {
    const i = new Image();
    // the decoded picture is kept, so a list that shows it later has it at once
    avKeep.push(i); if (avKeep.length > 80) avKeep.shift();
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
  return Promise.all(Array.from({ length: Math.ceil(miss.length / 80) }, (_, i) => pull(miss.slice(i * 80, i * 80 + 80)))).then(() => out);
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
    if (paint && !a.error && !b.error) paint(v);
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
let socialP = null, socialOwner = null;
function loadSocial(force) {
  if (!sbUser) return Promise.resolve();
  // another account in the same page must not see the last one's nicknames or chat clears
  if (socialOwner !== sbUser.id) { socialOwner = sbUser.id; socialP = null; nickMap.clear(); clearMap.clear(); }
  if (!socialP) {
    const nk = cacheRead("nicks:" + sbUser.id);
    if (nk && nk.v) Object.keys(nk.v).forEach(k => nickMap.set(k, nk.v[k]));
    const ck = cacheRead("clears:" + sbUser.id);
    if (ck && ck.v) Object.keys(ck.v).forEach(k => clearMap.set(k, ck.v[k]));
  }
  // [E4] a forced reload is at most every 30 s (was 15 s): the chat list and every open-chat pull ask with force, nicknames and clears rarely change
  if (socialP && !(force && Date.now() - socialAt > 30000)) return socialP;
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
  if (c === "reused_password" || c === "weekly_limit") return m;
  if (/network|fetch/i.test(m)) return "Could not reach Nook. Check your connection";
  // anything else says what the server said when it is a short plain line
  if (m.trim() && m.length < 120 && !/[{<]/.test(m)) return /\.$/.test(m.trim()) ? m.trim() : m.trim() + ".";
  return "Something went wrong. Try again";
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
  if (e === "no_account") return "Wrong email or password. You can tap Forgot password";
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
async function callFn(name, body, token) {
  // a lost connection or a timeout is an answer with status 0, never a thrown error
  try {
    const { data } = await sb.auth.getSession();
    const tok = token || (data && data.session ? data.session.access_token : null);
    const r = await fetch(SB_URL + "/functions/v1/" + name, { method: "POST", headers: { "content-type": "application/json", apikey: SB_KEY, ...(tok ? { authorization: "Bearer " + tok } : {}) }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout ? AbortSignal.timeout(25000) : undefined });
    let j = null;
    try { j = await r.json(); } catch (e) {}
    return { ok: r.ok, status: r.status, body: j || {} };
  } catch (e) { return { ok: false, status: 0, body: { error: "network" } }; }
}
// ---- Face ID and fingerprint sign in (passkeys): the phone keeps the private key, the server only checks its signature ----
// the account id is inside the signed login ticket; the server already checked it, so no extra request is made
const jwtUser = t => { try { const j = JSON.parse(atob(String(t).split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); return j && j.sub ? { id: j.sub } : null; } catch (e) { return null; } };
// iPhones ask for the face, Android phones for the fingerprint
const pkLabel = () => { const u = navigator.userAgent || ""; return /iPhone|iPad|iPod/.test(u) ? "Face ID" : /Android/.test(u) ? "Fingerprint" : "Fingerprint or Face ID"; };
const pkOk = () => !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
const pkBuf = s => { const b = atob(String(s).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(s).length / 4) * 4, "=")); return Uint8Array.from(b, c => c.charCodeAt(0)).buffer; };
const pkStr = buf => toB64(new Uint8Array(buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const pkName = () => { const u = navigator.userAgent || ""; return (/iPhone/.test(u) ? "iPhone" : /iPad/.test(u) ? "iPad" : /Android/.test(u) ? "Android phone" : "This device") + " " + new Date().toLocaleDateString([], { month: "short", day: "numeric" }); };
const pkMsg = (e, d) => (e === "server" || e === "failed") && d ? "Could not sign in (" + d + ")" : e === "banned" ? "That account is banned" : e === "busy" ? "Too many tries. Wait a minute" : e === "unknown_key" ? "This phone's key is not saved on any account. Sign in with your password and set it up again" : "Could not sign in with that. Try again";
async function passkeyAdd() {
  if (!pkOk()) { toast("This phone cannot do that"); return false; }
  const r = await callFn("passkey", { action: "reg-start" });
  if (!r.ok) { toast(r.body && r.body.error === "too_many" ? "You can save up to 5 keys. Remove one first" : "Could not start. Try again"); return false; }
  const o = r.body;
  let cred = null;
  try {
    cred = await navigator.credentials.create({ publicKey: {
      challenge: pkBuf(o.challenge), rp: o.rp, user: { id: pkBuf(o.user.id), name: o.user.name, displayName: o.user.displayName },
      pubKeyCredParams: o.pubKeyCredParams, timeout: 60000, attestation: "none", authenticatorSelection: o.authenticatorSelection,
      excludeCredentials: (o.excludeCredentials || []).map(c => ({ type: "public-key", id: pkBuf(c.id), transports: c.transports }))
    } });
  } catch (e) { if (!e || e.name !== "NotAllowedError") toast(e && e.name === "InvalidStateError" ? "This phone already has a key saved" : "Could not set it up on this phone"); return false; }
  if (!cred) return false;
  const resp = { id: cred.id, rawId: pkStr(cred.rawId), type: "public-key", authenticatorAttachment: cred.authenticatorAttachment || undefined, clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    response: { clientDataJSON: pkStr(cred.response.clientDataJSON), attestationObject: pkStr(cred.response.attestationObject), transports: cred.response.getTransports ? cred.response.getTransports() : [] } };
  const f = await callFn("passkey", { action: "reg-finish", response: resp, name: pkName() });
  if (!f.ok) { toast(f.body && f.body.error === "already" ? "That key is already saved" : "Could not save the key. Try again"); return false; }
  return true;
}
// asks the phone for the face or fingerprint; answers with a session, or a short text that says what went wrong ("" when the person just cancelled)
// nothing is asked from the server before the phone's own window opens: the challenge is made here (random bytes and the time),
// the server only accepts a fresh one, once. The sign in page also wakes the server up in the background.
let pkWarmAt = 0;
function passkeyWarm() {
  if (!pkOk() || Date.now() - pkWarmAt < 2 * 60000) return;
  pkWarmAt = Date.now();
  callFn("passkey", { action: "ping" }).catch(() => {});
}
function pkChallenge() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  new DataView(b.buffer).setFloat64(16, Date.now());
  return b.buffer;
}
async function passkeyAsk() {
  if (!pkOk()) return { err: "This phone cannot do that" };
  const s = { body: { rpId: location.hostname } };
  let cred = null;
  try { cred = await navigator.credentials.get({ publicKey: { challenge: pkChallenge(), rpId: s.body.rpId, timeout: 60000, userVerification: "required", allowCredentials: [] } }); }
  catch (e) { return { err: e && e.name === "NotAllowedError" ? "" : "Could not use the face or fingerprint here" }; }
  if (!cred) return { err: "" };
  const a = cred.response;
  const resp = { id: cred.id, rawId: pkStr(cred.rawId), type: "public-key", authenticatorAttachment: cred.authenticatorAttachment || undefined, clientExtensionResults: {},
    response: { authenticatorData: pkStr(a.authenticatorData), clientDataJSON: pkStr(a.clientDataJSON), signature: pkStr(a.signature), userHandle: a.userHandle ? pkStr(a.userHandle) : undefined } };
  const f = await callFn("passkey", { action: "auth-finish", response: resp });
  if (!f.ok || !f.body.session) return { err: pkMsg(f.body && f.body.error, f.body && f.body.detail), banned: !!(f.body && f.body.error === "banned") };
  return { session: f.body.session };
}
let badgeT = 0, badgeForce = false;
// [E4] the bell count and the mute list are only asked for again when something said they changed (force: a new notification arrived,
// the notifications were read, the app came back to the front) or after 30 s; the unread chats always come from the (shared) inbox call.
// The chat list used to ask for all three every 5 s.
function refreshBadge(force) {
  clearTimeout(badgeT);
  if (force) badgeForce = true;
  badgeT = setTimeout(refreshBadgeNow, 400);
}
let badgeNotifAt = 0, badgeMuteAt = 0;
function refreshBadgeNow() {
  if (!sbUser) return;
  const force = badgeForce; badgeForce = false;
  const nowT = Date.now();
  if (force || nowT - badgeNotifAt > 30000) {
    badgeNotifAt = nowT;
    sb.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", sbUser.id).neq("kind", "message").is("read_at", null).then(a => {
      unreadN = a.count || 0;
      paintBell();
    });
  }
  const askMutes = force || nowT - badgeMuteAt > 30000;
  if (askMutes) badgeMuteAt = nowT;
  // the server counts the unread chats itself (dm_inbox); an older server without it is asked the old way, with at most 500 rows
  const unreadQ = async () => {
    if (badgeRpc !== false) {
      const r = await inboxRpc().catch(() => ({ error: true }));
      if (!r.error) { badgeRpc = true; return { ids: (r.data || []).filter(x => x.unread > 0).map(x => x.other_id), error: null }; }
      if (badgeRpc === undefined && r.error && ["PGRST202", "42883"].includes(r.error.code)) badgeRpc = false;
    }
    const q = await sb.from("messages").select("sender_id").eq("recipient_id", sbUser.id).is("read_at", null).limit(500);
    return { ids: (q.data || []).map(x => x.sender_id), error: q.error };
  };
  Promise.all([
    unreadQ(),
    askMutes ? Promise.resolve(sb.from("dm_mutes").select("target_id, until_at, hidden").eq("owner_id", sbUser.id)).catch(() => ({ data: null })) : { data: null }
  ]).then(([{ ids, error }, mu]) => {
    if (error) return;
    if (mu && mu.data) { dmMuteSet.clear(); dmHideSet.clear(); mu.data.forEach(r => { if (r.hidden) dmHideSet.add(r.target_id); else dmMuteSet.set(r.target_id, r.until_at ? Date.parse(r.until_at) : 0); }); }
    const n = new Set(ids.filter(id => !dmMuted(id))).size;
    if (n !== unreadPeople) { unreadPeople = n; buildNav(null); }
  });
}
let badgeRpc;
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
    try {
      const n = new Notification(title, { body, icon: "icon-192.png", tag: "nook" });
      n.onclick = () => { window.focus(); n.close(); if (onTap) onTap(); };
    } catch (e) {
      navigator.serviceWorker.ready.then(r => r.showNotification(title, { body, icon: "icon-192.png", tag: "nook" })).catch(() => {});
    }
  } else toast(title + ": " + body);
}
function markRead(ids) {
  if (!ids.length || !sbUser) return;
  sb.from("messages").update({ read_at: new Date().toISOString() }).in("id", ids).eq("recipient_id", sbUser.id).then(() => { inboxStale(); refreshBadge(true); });
}
// [E5] callers that ask for the same chat while the first answer is still on its way share that one request;
// a caller that needs the very latest rows (after a failed send) passes fresh
const threadRuns = new Map();
function dmThread(otherId, fresh) {
  if (!fresh && threadRuns.has(otherId)) return threadRuns.get(otherId);
  const p = dmThreadNow(otherId);
  threadRuns.set(otherId, p);
  const clear = () => { if (threadRuns.get(otherId) === p) threadRuns.delete(otherId); };
  p.then(clear, clear);
  return p;
}
// [E5] the same for the inbox call: refreshBadge, the chat list and the boot warm-up all ask for it within moments of each other.
// An answer is shared while it is on its way and for 1.5 s after, unless something that changes it happened in between (inboxStale)
let inboxGen = 0, inboxRun = null;
const inboxStale = () => { inboxGen++; };
function inboxRpc() {
  const r0 = inboxRun;
  if (r0 && r0.gen === inboxGen && (!r0.done || Date.now() - r0.done < 1500)) return r0.p;
  const run = { gen: inboxGen, done: 0, p: null };
  run.p = Promise.resolve(sb.rpc("dm_inbox")).then(r => { run.done = Date.now(); if (r && r.error && inboxRun === run) inboxRun = null; return r; }, e => { if (inboxRun === run) inboxRun = null; throw e; });
  inboxRun = run;
  return run.p;
}
async function dmThreadNow(otherId) {
  // the id goes into a filter string, so it must look like an id
  if (!/^[0-9a-f-]{36}$/i.test(String(otherId))) throw new Error("bad id");
  // the nicknames and clears load beside the messages, not before them
  const [, { data, error }] = await Promise.all([loadSocial(true), sb.from("messages").select("id, sender_id, recipient_id, body, media, created_at, read_at")
    .or("and(sender_id.eq." + sbUser.id + ",recipient_id.eq." + otherId + "),and(sender_id.eq." + otherId + ",recipient_id.eq." + sbUser.id + ")")
    .order("created_at", { ascending: false }).limit(300)]);
  if (error) throw error;
  // the newest 300 are kept, oldest first
  return (data || []).reverse().filter(m => visibleMsg(m, otherId));
}
// [E4] the open chat's 5 s poll asks only for the rows after the newest id this phone has (one small request, usually empty).
// Nothing on screen shows whether a sent message was read (a bubble is redrawn only when its text or pictures change, see dmSig),
// so read marks are not polled. Removals and new nicknames/clears are caught by the full pull, which still runs when the chat opens,
// when the app comes back to the front and at least once a minute (a removal normally arrives at once on the delete channel).
async function dmThreadAfter(otherId, afterId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(otherId))) throw new Error("bad id");
  const { data, error } = await sb.from("messages").select("id, sender_id, recipient_id, body, media, created_at, read_at")
    .or("and(sender_id.eq." + sbUser.id + ",recipient_id.eq." + otherId + "),and(sender_id.eq." + otherId + ",recipient_id.eq." + sbUser.id + ")")
    .gt("id", afterId).order("id", { ascending: true }).limit(300);
  if (error) throw error;
  return (data || []).filter(m => visibleMsg(m, otherId));
}
async function warmInbox() {
  const convos = await dmInbox();
  cacheWrite("inbox:" + sbUser.id, convos);
  convos.forEach(c => { if (c.avatar && /^https?:/.test(c.avatar)) new Image().src = c.avatar; });
}
async function dmInbox() {
  // the server answers with the last message and the unread count of every chat, however long the history is; nicknames and clears load beside it
  const [, { data, error }] = await Promise.all([loadSocial(true), inboxRpc()]);
  // a failed load keeps what is on the screen and in the cache
  if (error) throw error;
  const convos = new Map();
  (data || []).forEach(m => {
    const other = m.other_id;
    if (!visibleMsg(m, other)) return;
    convos.set(other, { other, last: m, unread: m.unread || 0 });
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
const e2eAt = new Map();
const e2eEnc = new Map();
const toB64 = u8 => { let s = ""; u8.forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };
// [E2] the browser's own decoder where it has one (Chrome 140+, Safari 18.2+); the fallback gives the same bytes without a callback per byte
const fromB64 = s => { if (Uint8Array.fromBase64) return Uint8Array.fromBase64(s); const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
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
let e2eOkAt = 0;
function lockKeys() {
  e2eLocked = true;
  e2eOkAt = 0;
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
// the backup format is told apart by its iteration count (the only version field the table has):
// 600000 and below is the old PBKDF2-SHA256 copy, above that is PBKDF2-SHA512 with the account and mode bound in as extra data
const KDF_ITERS = 1000000, KDF_OLD_MAX = 600000;
const kbV2 = iters => iters > KDF_OLD_MAX;
async function recoveryKey(pw, salt, iters) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iters, hash: kbV2(iters) ? "SHA-512" : "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
const kbAad = (uid, mode) => new TextEncoder().encode("nook-key-backup-v2:" + uid + ":" + mode);
// the key is sealed on this phone with the recovery password: the server only ever holds the sealed copy
async function sealKeyBackup(priv, pub, pw, mode) {
  // a copy locked with the login password is only ever made with the strong lock (never the old weak one) and a password of a sane length
  if ((mode || "recovery") === "login" && (!kbV2(KDF_ITERS) || typeof pw !== "string" || pw.length < 8)) throw new Error("weak lock");
  const jwk = await crypto.subtle.exportKey("jwk", priv);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await recoveryKey(pw, salt, KDF_ITERS);
  const m = mode || "recovery";
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: kbAad(sbUser.id, m) }, key, new TextEncoder().encode(JSON.stringify(jwk)));
  return { user_id: sbUser.id, mode: m, salt: toB64(salt), iv: toB64(iv), ct: toB64(new Uint8Array(ct)), iters: KDF_ITERS, pub, updated_at: new Date().toISOString() };
}
async function openKeyBackup(row, pw) {
  const key = await recoveryKey(pw, fromB64(row.salt), row.iters);
  const alg = { name: "AES-GCM", iv: fromB64(row.iv) };
  if (kbV2(row.iters)) alg.additionalData = kbAad(sbUser.id, row.mode || "recovery");
  const plain = await crypto.subtle.decrypt(alg, key, fromB64(row.ct));
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
        try {
          const rec = await openKeyBackup(login, pw);
          await saveLocalKeys(await keyDb(), sbUser.id, rec);
          resetKeyCaches();
          // a copy that was made with the old weaker lock is locked again with the strong one now that it is open
          if (!kbV2(login.iters)) { try { await sb.from("key_backups").upsert(await sealKeyBackup(rec.priv, rec.pub, pw, "login"), { onConflict: "user_id,mode" }); } catch (e2) {} }
          return "restored";
        } catch (e) { return "locked"; }
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
      if (opt.fast && kbV2(login.iters)) return "saved";
      // already saved: only locked again when the saved copy no longer opens with this password, or is in the old weaker format
      try { await openKeyBackup(login, pw); if (kbV2(login.iters)) return "saved"; } catch (e) {}
    }
    const up = await sb.from("key_backups").upsert(await sealKeyBackup(mine.priv, mine.pub, pw, "login"), { onConflict: "user_id,mode" });
    if (!up.error && opt.enable) await sb.from("key_backups").delete().eq("user_id", sbUser.id).eq("mode", "off");
    return up.error ? "fail" : "saved";
  } catch (e) { return "fail"; }
}
const dropEncUrls = () => { const old = [...e2eEnc.values()]; e2eEnc.clear(); setTimeout(() => old.forEach(p => p.then(u => { if (u) URL.revokeObjectURL(u); }, () => {})), 60000); };
const resetKeyCaches = () => { e2eOkAt = 0; e2eMine.delete(sbUser.id); e2eShared.clear(); e2eReady.clear(); dropEncUrls(); };
// danger actions ask for the account email and the login password first
function confirmLogin(title, warn, label, fn) {
  const em = h("input", { class: "in", type: "email", placeholder: "Email", autocomplete: "off", autocapitalize: "off", "aria-label": "Email" });
  const pw = pwField("Password");
  const msg = h("p", { class: "note", role: "alert" });
  const say = t => { msg.textContent = ""; if (t) toast(t); };
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
      if (err === false) return;
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
  let stop = false, linkId = null, polls = 0;
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
      await new Promise(r => setTimeout(r, document.visibilityState === "visible" ? Math.min(8000, 2000 + 250 * ++polls) : 15000));
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
let linkTimer = 0, linkIdle = 0;
const linkShown = new Set();
async function checkLinks() {
  if (document.visibilityState !== "visible" || !sbUser || e2eLocked) return;
  try {
    const since = new Date(Date.now() - LINK_MIN * 60000).toISOString();
    const { data } = await sb.from("key_links").select("id, req_pub").eq("status", "pending").gt("created_at", since).order("created_at", { ascending: false }).limit(1);
    if (data && data[0]) linkIdle = 0; else linkIdle++;
    if (data && data[0] && !linkShown.has(data[0].id)) { linkShown.add(data[0].id); approveLinkModal(data[0]).catch(() => {}); }
  } catch (e) {}
}
let linkWatching = false;
function watchLinks() {
  if (linkWatching) return;
  linkWatching = true;
  // asks every 8 s at first, then less often once nobody has asked for a while; nothing is asked while the tab is hidden, and coming back to the tab asks at once
  const tick = () => {
    clearTimeout(linkTimer); linkTimer = 0;
    if (document.visibilityState !== "visible") return;
    // [E4] 8 s for the first dozen empty answers (about 100 s), then 20 s, then 60 s; was 8 s for the first 40 (5 minutes). Coming back to the app still asks at once.
    linkTimer = setTimeout(() => { linkTimer = 0; checkLinks().finally(tick); }, linkIdle > 200 ? 60000 : linkIdle > 12 ? 20000 : 8000);
  };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { linkIdle = 0; checkLinks().finally(tick); } else { clearTimeout(linkTimer); linkTimer = 0; } });
  checkLinks().finally(tick);
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
        const { data: row, error } = await sb.from("key_backups").select("mode, salt, iv, ct, iters, pub").eq("user_id", sbUser.id).eq("mode", login ? "login" : "recovery").maybeSingle();
        if (error || !row) { msg.textContent = "Could not load the saved key. Try again"; return; }
        let rec;
        try { rec = await openKeyBackup(row, pw.input.value); } catch (e) { msg.textContent = "That is not the right password"; return; }
        // a saved key that is not the key of the account is an old one: it must never replace the account's key
        const { data: me, error: me_err } = await sb.from("accounts").select("public_key").eq("id", sbUser.id).maybeSingle();
        if (me_err) { msg.textContent = "Could not reach Nook. Check your connection and try again"; return; }
        if (me && me.public_key && me.public_key !== rec.pub) { msg.textContent = "That saved key is older than the one on your account. Use another way"; return; }
        if (!me || !me.public_key) {
          const up = await sb.from("accounts").update({ public_key: rec.pub }).eq("id", sbUser.id);
          if (up.error) { msg.textContent = "Could not reach Nook. Try again"; return; }
        }
        await saveLocalKeys(await keyDb(), sbUser.id, rec);
        e2eLocked = false;
        close();
        toast("Messages unlocked");
        setTimeout(() => location.reload(), 500);
      } catch (e) { msg.textContent = "Something went wrong. Try again"; } finally { m.act.disabled = false; }
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
// a changed key of a person is never trusted by itself: reading still works, sending waits until it is confirmed here
const keyUntrusted = new Map();
function keyChangedNotice(otherId) {
  const a = acctCache.get(otherId) || {};
  const who = nickOf(otherId) || a.name || "This person";
  sheet([
    { label: "Trust the new key", fn: () => { const nk = keyUntrusted.get(otherId); if (nk) { try { localStorage.setItem("nook-pin:" + sbUser.id + ":" + otherId, nk); } catch (e) {} keyUntrusted.delete(otherId); toast("New key trusted"); } } },
    { label: "Not now", cancel: true }], who + " has a new security key. That happens with a new phone or a reset. If you did not expect it, do not trust it. Nothing is sent to them until you do.");
}
function keyGate(otherId) {
  if (keyUntrusted.has(otherId)) { setTimeout(() => keyChangedNotice(otherId), 100); throw new Error("Their security key changed. Confirm it first"); }
}
// [E5] the public key of a person is still asked from the server every time a key is worked out (the pinned-key check below is unchanged),
// but the people asked for within the same few milliseconds share one request (id in (...)) instead of one request each
const pubWait = new Map();
let pubTimer = 0;
function peerPublicKey(otherId) {
  return new Promise((res, rej) => {
    const w = pubWait.get(otherId);
    if (w) w.push([res, rej]); else pubWait.set(otherId, [[res, rej]]);
    if (!pubTimer) pubTimer = setTimeout(flushPub, 12);
  });
}
function flushPub() {
  pubTimer = 0;
  const all = [...pubWait.keys()];
  const waits = new Map(pubWait);
  pubWait.clear();
  for (let i = 0; i < all.length; i += 80) {
    const ids = all.slice(i, i + 80);
    const done = (rows, err) => ids.forEach(id => {
      const row = rows ? rows.find(x => String(x.id).toLowerCase() === String(id).toLowerCase()) : null;
      waits.get(id).forEach(([res, rej]) => { if (err) rej(err); else res({ data: row ? { public_key: row.public_key } : null }); });
    });
    // a single person is asked exactly as before
    const q = ids.length === 1 ? sb.from("accounts").select("id, public_key").eq("id", ids[0]) : sb.from("accounts").select("id, public_key").in("id", ids);
    Promise.resolve(q).then(r => done((r && r.data) || [], null), e => done(null, e));
  }
}
function sharedKey(otherId) {
  if (!e2eShared.has(otherId) || Date.now() - (e2eAt.get(otherId) || 0) > 60000) {
    e2eAt.set(otherId, Date.now());
    const p = (async () => {
      const mine = await myKeys();
      const { data } = await peerPublicKey(otherId);
      if (!data || !data.public_key) throw new Error("they need to open nook once first");
      // the first key seen from a person is remembered; a different one later is shown, never silent
      const pinName = "nook-pin:" + sbUser.id + ":" + otherId;
      let pinned = null;
      try { pinned = localStorage.getItem(pinName); } catch (e) {}
      if (!pinned) { try { localStorage.setItem(pinName, data.public_key); } catch (e) {} }
      if (pinned && pinned !== data.public_key && otherId !== sbUser.id) { keyUntrusted.set(otherId, data.public_key); setTimeout(() => keyChangedNotice(otherId), 600); }
      else keyUntrusted.delete(otherId);
      const peer = await crypto.subtle.importKey("raw", fromB64(data.public_key), E2E_ALG, false, []);
      return crypto.subtle.deriveKey({ name: "ECDH", public: peer }, mine.priv, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    })();
    e2eShared.set(otherId, p);
    p.catch(() => e2eShared.delete(otherId));
  }
  return e2eShared.get(otherId);
}
// reading uses the key this phone already worked out and refreshes it behind the scenes, so no message waits for a round trip to the server
const e2eReady = new Map();
function sharedKeyFast(otherId) {
  const hit = e2eReady.get(otherId);
  const fresh = sharedKey(otherId).then(k => { e2eReady.set(otherId, k); return k; });
  if (hit) { fresh.catch(() => {}); return Promise.resolve(hit); }
  // first time in this session: the key remembered for this person (the first one ever seen) opens messages without waiting for the server, which still checks it behind the scenes
  let pinned = null;
  try { pinned = localStorage.getItem("nook-pin:" + sbUser.id + ":" + otherId); } catch (e) {}
  if (!pinned || otherId === sbUser.id) return fresh;
  fresh.catch(() => {});
  const early = (async () => {
    const mine = await myKeys();
    const peer = await crypto.subtle.importKey("raw", fromB64(pinned), E2E_ALG, false, []);
    const k = await crypto.subtle.deriveKey({ name: "ECDH", public: peer }, mine.priv, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    if (!e2eReady.has(otherId)) e2eReady.set(otherId, k);
    return k;
  })();
  return early.catch(() => fresh);
}
async function sealText(otherId, text) {
  const key = await sharedKey(otherId);
  keyGate(otherId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
  return "e2e1:" + toB64(iv) + "." + toB64(new Uint8Array(ct));
}
const ZMARK = "\u2063Z\u2063";
const ZPOST = "\u2063P\u2063";
// the mark and the post card only count when they come from the owner's account, so nobody else can pose as Zenith
const OWNER_ID = "8a5d16ec-1050-40d2-8a7d-bcb75dc75bba";
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
      postsRead(cols, c => sb.from("posts").select(c).eq("id", id).maybeSingle()),
      postsRead(cols, c => sb.from("posts").select(c).eq("parent_id", id).order("created_at", { ascending: true }).limit(100))
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
        ra: { id: r.user_id, name: a.display_name || a.username || "user", handle: a.username, avatar: a.avatar || null },
        liked: false, reposted: false, saved: false, lc: 0, rpc: 0, rp: r.id === id ? rows.length - 1 : 0, pinned: false, sharedAt: now, edited: !!r.edited_at
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
let zPfpChecked = "", zPfpBusy = null;
// callers that overlap share one run, so a stale link is not uploaded again for each of them
function zenPfpUrl() { return zPfpBusy || (zPfpBusy = zenPfpOnce().finally(() => { zPfpBusy = null; })); }
async function zenPfpOnce() {
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
// his banner goes up the same way as his picture (kept as a link, checked once per session)
let zBnrChecked = "";
async function zenBnrUrl() {
  if (!S.zen.bnr) return null;
  if (S.zen.bnrUrl && S.zen.bnrUrlAt === S.zen.pfpAt) {
    if (zBnrChecked === S.zen.bnrUrl) return S.zen.bnrUrl;
    try { const r = await fetch(S.zen.bnrUrl, { method: "HEAD" }); if (r.ok) { zBnrChecked = S.zen.bnrUrl; return S.zen.bnrUrl; } } catch (e) { return S.zen.bnrUrl; }
  }
  try {
    const urls = await uploadMedia([S.zen.bnr]);
    if (!urls) return null;
    S.zen.bnrUrl = urls[0]; S.zen.bnrUrlAt = S.zen.pfpAt; persist();
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
// flag: a body that is not sealed is shown with a visible mark, so plain text put in by the server or a stranger never looks like a private message
async function openText(otherId, raw, flag) {
  if (!raw) return "";
  if (raw.slice(0, 5) !== "e2e1:") return flag ? "[not encrypted] " + raw : raw;
  try {
    const parts = raw.slice(5).split(".");
    const key = await sharedKeyFast(otherId);
    // the remembered key can be an old one after somebody changed phone: the checked key is tried before giving up
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(parts[0]) }, key, fromB64(parts[1])).catch(async () => crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(parts[0]) }, await sharedKey(otherId), fromB64(parts[1])));
    return new TextDecoder().decode(pt);
  } catch (e) { return e2eLocked ? "Locked. Unlock your messages in Settings" : "Can't open this one (the chat key changed)"; }
}
function loadEncMedia(md, otherId) {
  if (!e2eEnc.has(md.url)) {
    const p = (async () => {
      const key = await sharedKeyFast(otherId);
      // a peer chooses this link, so only this app's own storage is fetched
      const res = await fetch(await dmSignedUrl(md.url));
      if (!res.ok) throw new Error("gone");
      const buf = await res.arrayBuffer();
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(md.iv) }, key, buf);
      return URL.createObjectURL(new Blob([pt], { type: md.type || "application/octet-stream" }));
    })();
    e2eEnc.set(md.url, p);
    p.catch(() => e2eEnc.delete(md.url));
    // oldest decrypted pictures are let go after a delay, so memory does not grow with every chat photo seen
    if (e2eEnc.size > 300) { const first = e2eEnc.keys().next().value; const gone = e2eEnc.get(first); e2eEnc.delete(first); setTimeout(() => gone.then(u => { if (u) URL.revokeObjectURL(u); }, () => {}), 60000); }
  }
  return e2eEnc.get(md.url);
}
async function openRows(rows, otherId, waitFor, wait) {
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
  // a row that never went through the sealed format is marked, so a server or a stranger cannot pass plain text off as a private message
  out.forEach(m => { if (typeof m.body === "string" && m.body && m.body.slice(0, 5) !== "e2e1:" && !m.ai && !m.rpost && !m.zpost) m.plain = true; });
  // photos are opened before their bubbles show, so no grey box sits on the screen while they load (only the newest ones are waited for when there are many)
  dmSignBatch(rows.flatMap(m => m.media || []));
  const jobs = [];
  rows.slice(-(waitFor || rows.length)).forEach(m => (m.media || []).forEach(md => { if (md.iv && !/^video\//.test(md.type || "")) jobs.push(loadEncMedia(md, otherId).catch(() => {})); }));
  // shared posts are fetched, and their first photo loaded, before the bubbles show
  out.slice(-(waitFor || out.length)).forEach(m => { if (m.rpost) jobs.push(loadRPost(m.rpost.id, m.rpost.u).then(d => (d && d.imgs[0] ? preloadImg(d.imgs[0]) : null)).catch(() => {})); });
  // the bubbles show at once with their picture frames; photos and shared posts fill in as they arrive (a caller that wants them first asks with wait)
  if (jobs.length && wait) await Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, 6000))]);
  return out;
}
async function sendDm(otherId, text, srcs, dims) {
  // the key of this phone must be known to the other person before a message is sealed with it
  // checked at most once a minute, not for every message
  if (Date.now() - e2eOkAt > 60000) { let ok = true; await ensureE2E().catch(() => { ok = false; }); if (ok) e2eOkAt = Date.now(); }
  const media = [];
  const paths = [];
  const key = srcs.length ? await sharedKey(otherId) : null;
  if (srcs.length) keyGate(otherId);
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
    inboxStale(); threadRuns.delete(otherId);
    return data;
  } catch (e) {
    if (paths.length && e && e.code) sb.storage.from(DM_BUCKET).remove(paths).then(() => {}, () => {});
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
  const wrap = h("div", { class: "dmw wait" });
  if (/^video\//.test(md.type || "")) { wrap.classList.remove("wait"); wrap.append(h("div", { class: "dmgone" }, "Videos are not supported")); return wrap; }
  const el = h("img", { alt: "", decoding: "async", class: "dmm" });
  if (md.w && md.h) { el.style.setProperty("--ar", md.w / md.h); wrap.style.setProperty("--ar", md.w / md.h); }
  // until the picture is in, a shimmering frame of the same size holds its place
  el.addEventListener("load", () => wrap.classList.remove("wait"));
  const gone = () => { wrap.classList.remove("wait"); wrap.textContent = ""; wrap.append(h("div", { class: "dmgone" }, "Photo not available")); };
  el.addEventListener("error", () => { if (el.getAttribute("src") && !/^(blob|data):/.test(el.getAttribute("src"))) gone(); });
  if (onOpen) el.addEventListener("click", () => onOpen(el));
  if (md.iv) loadEncMedia(md, otherId).then(u => { if (u) el.src = u; }).catch(gone);
  else if (/^(blob|data):/.test(md.url || "")) el.src = md.url;
  else dmSignedUrl(md.url).then(u => { el.src = u; }).catch(gone);
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
  sb.from("messages").delete().eq("id", m.id).select("id").then(({ data, error }) => {
    if (error || !data || !data.length) { toast(error ? "Could not delete that message. " + plainErr(error, "Try again") : "Could not delete that message"); render(); return; }
    // the caches only forget it once the server has
    threadDrop(otherId, m.id);
    inboxDrop(otherId, m.id);
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
  // all photos are fetched side by side, then kept in their original order
  const jobs = [];
  for (let i = 0; i < (m.media || []).length; i++) {
    const md = m.media[i];
    if (/^video\//.test(md.type || "")) continue;
    jobs.push({ i, p: Promise.resolve().then(() => md.iv ? loadEncMedia(md, row._other) : dmSignedUrl(md.url)) });
  }
  const got = await Promise.allSettled(jobs.map(j => j.p));
  got.forEach((r, n) => { if (r.status === "fulfilled") { urls.push(r.value); map.push(jobs[n].i); } });
  const start = map.indexOf(idx);
  if (start < 0 || !urls.length) return;
  lightbox(urls, start, null, null);
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
// [E1] one date formatter for every bubble: toLocaleString builds a new formatter on each call, which was about a third of the time per bubble
let bubbleFmt = null;
function bubbleTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  if (!bubbleFmt) bubbleFmt = new Intl.DateTimeFormat([], { dateStyle: "medium", timeStyle: "short" });
  return bubbleFmt.format(d);
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
    row.append(h("div", { class: "mmeta" }, h("div", { class: "mmi" }, h("span", {}, bubbleTime(msg.created_at)), msg.plain ? h("span", { class: "unenc", style: "margin-left:6px;color:#c0392b" }, "Not encrypted") : null)));
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
    o = { ch: sb.channel("tp-" + otherId, { config: { private: true } }), ready: false, last: 0, sentOn: false };
    typeOut.set(otherId, o);
    o.ch.subscribe(st => {
      if (st === "SUBSCRIBED") o.ready = true;
      // a channel this person may not join (not a chat partner, or the rule is missing) is dropped quietly and tried again later
      else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT" || st === "CLOSED") { o.ready = false; clearTimeout(o.idle); if (typeOut.get(otherId) === o) { typeOut.delete(otherId); try { sb.removeChannel(o.ch); } catch (e) {} } }
    });
    // only a handful of partner channels are open at once
    if (typeOut.size > 8) { const old = typeOut.keys().next().value; const oo = typeOut.get(old); if (oo && oo !== o) { typeOut.delete(old); clearTimeout(oo.idle); try { sb.removeChannel(oo.ch); } catch (e) {} } }
  }
  // a channel nobody typed on for a while is closed, so partners do not pile up as open channels
  clearTimeout(o.idle);
  o.idle = setTimeout(() => { if (typeOut.get(otherId) === o) typeOut.delete(otherId); try { sb.removeChannel(o.ch); } catch (e) {} }, 90000);
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
const typeSeen = new Map();
function onTyping(from, on) {
  if (!sbUser || !from || from === sbUser.id || typeof from !== "string" || !/^[0-9a-f-]{36}$/i.test(from) || !peerKnown(from)) return;
  // a sender that floods the channel, or a chat that is muted or hidden, is not shown
  const nowT = Date.now();
  if (nowT - (typeSeen.get(from) || 0) < 400) return;
  typeSeen.set(from, nowT);
  if (typeSeen.size > 300) typeSeen.delete(typeSeen.keys().next().value);
  if (dmMuteSet.has(from) || dmHideSet.has(from)) return;
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
// people whose chat is muted: no alert and no number for them (the list comes with the unread check)
const dmMuteSet = new Map();
const dmHideSet = new Set();
const dmMuted = id => { if (dmHideSet.has(id)) return true; if (!dmMuteSet.has(id)) return false; const u = dmMuteSet.get(id); return !u || u > Date.now(); };
let dmMuteAt = 0, dmMuteP = null, dmMuteOwner = null;
// the last known mute and hide lists are put back from this phone at once, the server then confirms them
function primeDmMutes() {
  if (dmMuteOwner === sbUser.id) return;
  dmMuteOwner = sbUser.id;
  dmMuteSet.clear(); dmHideSet.clear();
  const c = cacheRead("dmmutes:" + sbUser.id);
  if (c && c.v) { (c.v.m || []).forEach(x => dmMuteSet.set(x[0], x[1])); (c.v.h || []).forEach(x => dmHideSet.add(x)); }
}
function loadDmMutes(force) {
  primeDmMutes();
  if (!force && dmMuteP && Date.now() - dmMuteAt < 15000) return dmMuteP;
  dmMuteAt = Date.now();
  dmMuteP = Promise.resolve(sb.from("dm_mutes").select("target_id, until_at, hidden").eq("owner_id", sbUser.id)).then(r => {
    if (r && r.data) {
      dmMuteSet.clear(); dmHideSet.clear();
      r.data.forEach(x => { if (x.hidden) dmHideSet.add(x.target_id); else dmMuteSet.set(x.target_id, x.until_at ? Date.parse(x.until_at) : 0); });      cacheWrite("dmmutes:" + sbUser.id, { m: [...dmMuteSet], h: [...dmHideSet] });
    }
  }, () => {});
  return dmMuteP;
}
const dmPinned = id => (S.ui.dmPins || []).includes(id);
async function dmMenu(cv, inChat) {
  let blocked = false;
  const hidden = dmHideSet.has(cv.other);
  const muted = !hidden && dmMuted(cv.other);
  try { const r = await withTimeout(Promise.resolve(sb.from("blocks").select("blocked_id").eq("blocker_id", sbUser.id).eq("blocked_id", cv.other).maybeSingle()), 3000); blocked = !!(r && r.data); } catch (e) {}
  const pinned = dmPinned(cv.other);
  sheet([
    { icon: "pin", label: pinned ? "Unpin chat" : "Pin chat", fn: () => {
      const pins = (S.ui.dmPins || []).filter(x => x !== cv.other);
      if (!pinned) pins.unshift(cv.other);
      S.ui.dmPins = pins.slice(0, 5);
      persist(); render();
      toast(pinned ? "Unpinned" : "Pinned to the top");
    } },
    { icon: "edit", label: "Nickname", fn: () => nicknameModal(cv) },
    hidden ? { icon: "eyeoff", label: "Unhide chat", fn: () => {
      sb.from("dm_mutes").delete().eq("owner_id", sbUser.id).eq("target_id", cv.other).then(({ error }) => {
        if (error) { toast("Could not unhide chat"); return; }
        dmHideSet.delete(cv.other); refreshBadge(); if (!inChat) render(); toast("Chat unhidden");
      });
    } } : { icon: "bellOff", label: muted ? "Unmute messages" : "Mute messages", fn: () => {
      const done = () => { refreshBadge(); if (!inChat) render(); };
      const setMute = async (ms, label) => {
        const until = ms ? new Date(Date.now() + ms).toISOString() : null;
        const { error } = await sb.from("dm_mutes").upsert({ owner_id: sbUser.id, target_id: cv.other, until_at: until, hidden: false }, { onConflict: "owner_id,target_id" });
        if (error) { toast("Could not update mute"); return; }
        dmMuteSet.set(cv.other, ms ? Date.now() + ms : 0);
        done(); toast("Messages muted " + label);
      };
      if (muted) {
        sb.from("dm_mutes").delete().eq("owner_id", sbUser.id).eq("target_id", cv.other).then(({ error }) => {
          if (error) { toast("Could not update mute"); return; }
          dmMuteSet.delete(cv.other); done(); toast("Messages unmuted");
        });
        return;
      }
      const H = 3600000;
      sheet([
        { icon: "bellOff", label: "For 1 hour", fn: () => setMute(H, "for 1 hour") },
        { icon: "bellOff", label: "For 8 hours", fn: () => setMute(8 * H, "for 8 hours") },
        { icon: "bellOff", label: "For 1 day", fn: () => setMute(24 * H, "for 1 day") },
        { icon: "bellOff", label: "For 1 week", fn: () => setMute(168 * H, "for 1 week") },
        { icon: "bellOff", label: "Until I turn it back on", fn: () => setMute(0, "until you turn it back on") },
        { label: "Cancel", cancel: true }], "Mute messages");
    } },
    hidden ? null : { icon: "eyeoff", label: "Hide chat", fn: async () => {
      const { error } = await sb.from("dm_mutes").upsert({ owner_id: sbUser.id, target_id: cv.other, until_at: null, hidden: true }, { onConflict: "owner_id,target_id" });
      if (error) { toast("Could not hide chat"); return; }
      dmHideSet.add(cv.other); dmMuteSet.delete(cv.other);
      refreshBadge();
      if (inChat) back(); else render();
      toast("Chat hidden. Unhide it in Settings");
    } },
    { icon: "trash", label: "Delete chat", danger: true, fn: () => confirmSheet("Delete this chat for you? The other person keeps theirs.", "Delete chat", () => deleteChat(cv, inChat)) },
    { icon: "close", label: blocked ? "Unblock" : "Block", danger: !blocked, fn: async () => { toast((await setBlocked(cv.other, !blocked)) ? (blocked ? "Unblocked" : "Blocked") : "Could not update block"); } }
  ].filter(Boolean), nickOf(cv.other) || cv.name);
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
  socialAt = 0; inboxStale(); threadRuns.clear();
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
function openDm(id) {
  // the chat opens at once from what this phone already holds; the newest messages load inside it
  go({ r: "dm", id });
}
function dmV(c) {
  if (e2eLocked) promptUnlock();
  // the key of this chat is worked out while everything else loads
  sharedKeyFast(c.id).catch(() => {});
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
  // the chat stays glued to the bottom while pictures, cards and shared posts are still loading in, until the person scrolls themselves
  let stick = true, stickT = 0;
  const stickFor = ms => { stick = true; clearTimeout(stickT); stickT = setTimeout(() => { stick = false; }, ms); };
  stickFor(3500);
  // both are let go when the chat closes, so opening many chats does not pile them up
  const dmRo = typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (stick || (atEnd && list.querySelector(".dmw.wait"))) scrollEnd(); }) : null;
  if (dmRo) dmRo.observe(list);
  const dmAc = new AbortController();
  ["touchstart", "wheel"].forEach(ev => main.addEventListener(ev, () => { stick = false; }, { passive: true, signal: dmAc.signal }));
  const nearEnd = () => main.scrollHeight - main.scrollTop - main.clientHeight < 160;
  // when the keyboard opens or closes the page changes height: a chat that was at its end stays at its end, so the newest messages are never hidden behind the keyboard
  let atEnd = true;
  main.addEventListener("scroll", () => { atEnd = nearEnd(); }, { passive: true, signal: dmAc.signal });
  const mainRo = typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (atEnd || stick) scrollEnd(); }) : null;
  if (mainRo) mainRo.observe(main);
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
  ta.addEventListener("input", () => zpop.classList.toggle("on", zOn() && zenHint(ta.value)));
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
  // [E4] the follow and block check (four requests) runs when the chat opens, when the app comes back to the front (at most every 10 s),
  // after a failed send, and otherwise at most once a minute
  let statusAt = 0;
  const refreshStatus = () => { statusAt = Date.now(); return dmStatus(c.id).then(st => { if (liveDm && liveDm.id === c.id) applyLock(dmLockText(st)); }).catch(() => {}); };

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
    // [E1] the typing dots are put away once per batch, before the first bubble goes in, instead of once per incoming bubble:
    // typing() reads the scroll size, and a read right after an insert forces a full layout for every one of 300 bubbles
    let dotsAway = false;
    let swept = false;
    // [E1] ids on screen are listed once, instead of one selector search through the whole list per row (300 x 300 checks)
    const onScreen = new Set();
    list.querySelectorAll("[data-mid]").forEach(el => onScreen.add(el.dataset.mid));
    opened.forEach(m => {
      const key = String(m.id);
      if (have.has(key)) { have.get(key).refill(m); return; }
      if (onScreen.has(key)) return;
      const mine = m.sender_id === me;
      const row = dmBubble(m, mine, c.id);
      if (!mine && !o.initial) {
        row.classList.add("new");
        if (/^\/claude$/i.test((m.text || "").trim())) claudeReceived(Date.parse(m.created_at));
        if (!dotsAway) {
          dotsAway = true;
          // the typing dots go away at once so nothing slides when the message lands
          tEl.classList.add("snap");
          typing(false);
          requestAnimationFrame(() => requestAnimationFrame(() => tEl.classList.remove("snap")));
        }
      }
      // [E1] the empty-state sweep runs once per batch, not once per bubble
      if (!swept) { swept = true; list.querySelectorAll(".empty").forEach(e => e.remove()); }
      list.insertBefore(row, tEl);
      onScreen.add(key);
      added = true;
    });
    if (!list.querySelector("[data-mid], .tmpm")) hint("No messages yet. Say hi.");
    const unread = rows.filter(m => m.recipient_id === me && !m.read_at).map(m => m.id);
    if (unread.length) markRead(unread);
    if (added && (near || o.initial)) { scrollEnd(); stickFor(1500); }
  };

  // only the owner can call Zenith in a chat: the answer is sent as a normal message with a hidden mark inside the sealed text, so both people see it as Zenith
  const zenInDm = async (sentText, sentP, srcs) => {
    // what the other person wrote never leaves the sealed chat: Zenith only gets the owner's words and his own, the rest is a blank turn
    const hist = Array.from(list.querySelectorAll("[data-mid]")).map(r => r._m).filter(m => m && m.text).slice(-20)
      .map(m => m.ai ? "Zenith: " + m.text : m.sender_id === me ? "Person A: " + m.text.replace(/@zenith/gi, "Zenith") + ((m.media || []).length ? " (sent a photo)" : "") : "Person B: (a private message you cannot read)");
    hist.push("Person A: " + (sentText.replace(/@zenith/gi, "Zenith") || "(photo only)") + ((srcs || []).length ? " (the photo is attached)" : ""));
    const ghost = h("div", { class: "mrow zdm tmpm" }, h("div", { class: "bub typing" }, h("i"), h("i"), h("i")));
    pushRow(ghost);
    let reply = "";
    try {
      reply = await zGen(ZSYS_REPLY + " This is a chat between two people, Person A and Person B, and Zenith is in it. Answer the last message that mentions Zenith. In this chat you may ask a short question back, this overrides the earlier rule about questions.", hist.join("\n"), (srcs || []).slice(0, 3));
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
    if (!pend.length && !busy && !jobs.length && claudeCmd(ta, null, true) === "stop") return;
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
      row._sig = dmSig(saved);
      row._m = Object.assign({}, saved, { text });
    };
    try {
      // a link is sent after its preview is ready, so the other person gets the card at once
      const lk = firstUrl(text);
      if (lk && !(S.previews[lk] && S.previews[lk].v)) await Promise.race([getPreview(lk), new Promise(r => setTimeout(r, 4500))]);
      const sentP = sendDm(c.id, text, srcs, dims);
      if (zOn() && /@zenith/i.test(text)) zenInDm(text, sentP, srcs);
      const saved = await sentP;
      landed(saved);
    } catch (e) {
      // the answer may have been lost after the server saved the message: the chat is checked before the text is given back, so it is never sent twice
      if (!srcs.length) {
        try {
          const rows = await withTimeout(dmThread(c.id, true), 6000);
          const recent = rows.filter(m => m.sender_id === me && Date.now() - Date.parse(m.created_at) < 120000 && !list.querySelector('[data-mid="' + m.id + '"]'));
          for (const m of recent.reverse()) { if ((await openText(c.id, m.body)) === text) { landed(m); busy = false; draw(); return; } }
        } catch (x) {}
      }
      row.remove();
      if (!list.querySelector("[data-mid], .tmpm")) hint("No messages yet. Say hi.");
      // what was typed in the meantime is never overwritten
      ta.value = ta.value.trim() ? text + "\n" + ta.value : text;
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
  ta.addEventListener("focus", () => { if (atEnd) setTimeout(scrollEnd, 320); });
  ta.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) { e.preventDefault(); doSend(); }
  });

  const tkey = "thread:" + me + ":" + c.id;
  // [E4] the rows of the last full pull (raw, newest 300), kept so the small polls can be merged into them
  let known = [], fullAt = 0;
  const pull = () => dmThread(c.id).then(rows => {
    if (!liveDm || liveDm.id !== c.id) return;
    known = rows; fullAt = Date.now();
    cacheWrite(tkey, rows.slice(-100));
    return syncRows(rows, { prune: true });
  });
  const pullNew = async () => {
    const after = known.reduce((a, r) => Math.max(a, Number(r.id) || 0), 0);
    const nw = await dmThreadAfter(c.id, after);
    if (!liveDm || liveDm.id !== c.id) return;
    const have = new Set(known.map(r => r.id));
    const add = nw.filter(r => !have.has(r.id));
    if (!add.length) return;
    known = known.concat(add).slice(-300);
    cacheWrite(tkey, known.slice(-100));
    return syncRows(add, {});
  };
  let pulling = false;
  let polledAt = 0;
  const poll = setInterval(() => {
    if (busy || pulling || document.hidden || !liveDm || liveDm.id !== c.id) return;
    if (Date.now() - polledAt < pollGap() - 500) return;
    polledAt = Date.now();
    pulling = true;
    const small = fullAt && Date.now() - fullAt < 30000;
    (small ? pullNew().catch(() => pull()) : pull()).catch(() => {}).finally(() => { pulling = false; });
    if (Date.now() - statusAt > 60000) refreshStatus();
  }, 5000);
  const onVis = () => { if (document.visibilityState === "visible" && liveDm && liveDm.id === c.id) { pull().catch(() => {}); if (Date.now() - statusAt > 10000) refreshStatus(); } };
  document.addEventListener("visibilitychange", onVis);
  liveDm = {
    id: c.id,
    fill: pre => { if (locked) return; if (!ta.value.toLowerCase().startsWith(pre.trim())) ta.value = pre + ta.value; sync(); ta.focus(); },
    add: async m => { threadPush(c.id, m); if (!known.some(r => r.id === m.id)) known.push(m); await syncRows([m], {}); },
    drop: id => {
      const el = list.querySelector('[data-mid="' + String(id) + '"]');
      const after = () => { if (!list.querySelector("[data-mid], .tmpm")) hint("No messages yet. Say hi."); };
      threadDrop(c.id, id);
      if (el) foldAway(el, after); else after();
    },
    typing,
    stop: () => { clearInterval(poll); document.removeEventListener("visibilitychange", onVis); if (dmRo) dmRo.disconnect(); if (mainRo) mainRo.disconnect(); dmAc.abort(); cancelAnimationFrame(tRaf); sendTyping(c.id, false); }
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

function hiddenChatsV() {
  topEl.append(bar(backBtn(), ttl("Hidden chats")));
  const list = h("div");
  main.append(list);
  list.append(loadingEl());
  const showNone = () => { list.textContent = ""; list.append(emptyState("user", "You have no hidden chats.")); };
  withTimeout(loadDmMutes(true)).then(() => {
    const ids = [...dmHideSet];
    return cachedAccounts(ids).then(m => {
      list.textContent = "";
      if (!ids.length) { showNone(); return; }
      ids.forEach(id => {
        const a = m.get(id) || { username: "user", display_name: null, avatar: null };
        const nm = nickOf(id) || a.display_name || a.username;
        const btn = h("button", { class: "ghost", onclick: e => {
          e.stopPropagation();
          btn.disabled = true;
          sb.from("dm_mutes").delete().eq("owner_id", sbUser.id).eq("target_id", id).then(({ error: err }) => {
            if (err) { btn.disabled = false; toast("Could not unhide"); return; }
            dmHideSet.delete(id);
            row.remove();
            refreshBadge();
            toast("Chat is back in your list");
            if (!list.querySelector(".lrow")) showNone();
          });
        } }, "Unhide");
        const row = h("div", { class: "lrow", onclick: () => openDm(id) },
          rAv({ name: nm, avatar: a.avatar }, 48),
          h("div", { class: "nm" }, h("b", {}, nm), h("span", { class: "sub" }, "@" + a.username)),
          btn);
        list.append(row);
      });
    });
  }).catch(() => failBox(list, "Could not load hidden chats.", () => render()));
}
// the email, the day the account was made and the phones that can sign in with their fingerprint.
// The password is not shown: the server only keeps a scrambled copy of it that nobody can turn back into the password.
function accountV() {
  topEl.append(bar(backBtn(), ttl("Account info")));
  const sec = t => h("div", { class: "sec" }, t);
  const row = (lead, label, sub) => h("div", { class: "srow" }, lead, h("div", { class: "nm" }, h("b", {}, label), sub ? h("span", { class: "sub" }, sub) : null));
  const day = t => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const made = row(ic("user", 22), "Account made", "Loading...");
  const list = h("div", { class: "group" }, row(null, "Loading..."));
  main.append(sec("Account"), h("div", { class: "group" }, row(ic("mail", 22), "Email", sbUser.email || ""), made, row(ic("pass", 22), "Password", "Hidden. Nobody can read it, not even Nook")), sec("Phones with fingerprint sign in"), list);
  sb.auth.getUser().then(({ data }) => { const s = made.querySelector(".sub"); if (s) s.textContent = data && data.user && data.user.created_at ? day(data.user.created_at) : ""; }, () => {});
  Promise.resolve(sb.from("passkeys").select("id, name, created_at").order("created_at")).then(r => {
    list.textContent = "";
    const rows = r && !r.error ? r.data || [] : [];
    if (!rows.length) { list.append(row(null, "No phones saved", "Add one in Settings, under Fingerprint")); return; }
    rows.forEach(k => list.append(row(ic("lock", 22), k.name || "Phone", "Added " + day(k.created_at))));
  }, () => { list.textContent = ""; list.append(row(null, "Could not load")); });
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
    if (error) { list.textContent = ""; list.append(emptyState("user", "Could not load people.")); timer = setTimeout(() => { if (document.body.contains(list) && !box.value.trim()) suggest(); }, 15000); return; }
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
      pageAll((f, t) => sb.from("follows").select(col).eq(keyCol, c.id).order(col).range(f, t)),
      pageAll((f, t) => sb.from("blocks").select("blocker_id, blocked_id").or("blocker_id.eq." + sbUser.id + ",blocked_id.eq." + sbUser.id).order("blocker_id").order("blocked_id").range(f, t))
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
    h("div", { class: "nm" }, h("b", {}, nickOf(cv.other) || cv.name, dmPinned(cv.other) ? h("span", { style: "margin-left:6px;opacity:.6;display:inline-flex;vertical-align:middle" }, ic("pin", 13)) : null), sub),
    last ? h("span", { class: "time" }, ago(Date.parse(last.created_at))) : null,
    cv.unread && !dmMuted(cv.other) ? h("span", { class: "nbadge" }, String(cv.unread)) : null);
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
  el.addEventListener("transitionend", e => { if (e.target === el && e.propertyName === "height") end(); });
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
const NOTE_WHAT = { follow: "followed you", reply: "replied to your post", like: "liked your post", repost: "reposted your post", message: "sent you a message", post: "posted something new" };
function openNotif(n) {
  if (n.kind === "message") { openDm(n.actor_id); return; }
  if (n.post_id && n.kind !== "follow") {
    const lp = S.posts.find(x => x.remote === n.post_id);
    if (lp) { go({ r: "thread", id: lp.id }); return; }
    // a post this phone does not have yet (a reply of somebody, a new post of a person you follow) is fetched and opened
    openSharedPost(n.post_id).catch(() => { toast("Could not open this post"); });
    return;
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
  sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", sbUser.id).neq("kind", "message").is("read_at", null).then(() => refreshBadge(true));
}
function onIncomingMsg(payload) {
  const m = payload.new;
  inboxStale(); threadRuns.delete(m.sender_id);
  refreshBadge();
  if (refreshChat) refreshChat();
  if (liveDm && liveDm.id === m.sender_id) { liveDm.add(m); return; }
  Promise.all([acctsFor([m.sender_id]), loadSocial()]).then(() => {
    const a = acctCache.get(m.sender_id) || { name: "user" };
    openText(m.sender_id, m.body, true).then(zUn).then(t => alertMe(nickOf(m.sender_id) || a.name, dmGist(t, m.media, false), () => openDm(m.sender_id)));
  });
}
function onIncomingNote(payload) {
  const n = payload.new;
  refreshBadge(true);
  if (n.kind === "message") return;
  Promise.all([acctsFor([n.actor_id]), loadSocial()]).then(() => {
    const a = acctCache.get(n.actor_id) || { name: "user" };
    alertMe(nickOf(n.actor_id) || a.name, NOTE_WHAT[n.kind] || "", () => openNotif(n));
  });
}
function onDeletedMsg(payload) {
  const id = payload && payload.old ? payload.old.id : null;
  if (id == null) return;
  inboxStale(); threadRuns.clear();
  if (liveDm) liveDm.drop(id);
  // deletes of everybody's messages arrive here, so a burst is answered with one refresh
  clearTimeout(delMsgT);
  // many deletes in a short time (everybody's arrive here) are answered more slowly, so a busy server does not make every phone refresh over and over
  const nw = Date.now();
  if (nw - delMsgWin > 3000) { delMsgWin = nw; delMsgN = 0; }
  delMsgN++;
  delMsgT = setTimeout(() => { refreshBadge(); if (refreshChat) refreshChat(); }, delMsgN > 5 ? 2500 : 300);
}
let delMsgT = 0, delMsgWin = 0, delMsgN = 0;
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
  if (n.kind === "exposed") { try { if (n.post_id) dropLocalPosts([n.post_id]); } catch (e) {} showExposedNotice(n); return; }
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
  // on Android the real app is offered instead of the shortcut
  const android = /Android/i.test(navigator.userAgent);
  const text = android ? "Get the Nook app for Android. It is faster and gives you notifications. Download it, open the file and tap Install."
    : ios ? "Open Nook in Safari, tap the Share button, then tap Add to Home Screen. Then open Nook from your home screen to get the full app."
    : installEv ? "Install Nook to open it like a normal app, full screen, with notifications."
    : "Open your browser menu and tap Install app or Add to Home screen. Then open Nook from your home screen.";
  const sh = h("div", { class: "sheet", role: "dialog" },
    h("div", { class: "grab" }, h("i")),
    h("div", { class: "st" }, "Get the Nook app"),
    h("p", { class: "note" }, text),
    android ? h("div", { class: "sg" }, h("a", { class: "si plain", href: "apk/nook.apk", download: "nook.apk", style: "text-decoration:none", onclick: () => { hide(7); setTimeout(close, 300); } }, h("span", {}, "Download the app"))) : null,
    !ios && !android && installEv ? h("div", { class: "sg" }, h("button", { class: "si plain", onclick: async () => { close(); try { installEv.prompt(); await installEv.userChoice; } catch (e) {} installEv = null; } }, h("span", {}, "Install"))) : null,
    h("button", { class: "sx", onclick: () => { hide(7); close(); } }, "Not now"));
  layer.append(scrim, sh);
}
let rtBackoff = 2000, rtTimer = null;
// deleted DMs arrive on a private channel only the two people in the chat can listen to; if it cannot be opened it is tried again later, with no unfiltered fallback
let delChan = null, delFallback = null, delErrN = 0;
function startDelChan() {
  if (!sbUser) return;
  if (delChan) { try { sb.removeChannel(delChan); } catch (e) {} delChan = null; }
  const me = sbUser.id;
  const ch = sb.channel("dmdel-" + me, { config: { private: true } })
    .on("broadcast", { event: "del" }, ({ payload }) => onDeletedMsg({ old: payload }))
    .subscribe(st => {
      if (delChan !== ch) return;
      if (st === "SUBSCRIBED") {
        delErrN = 0;
        if (delFallback) { try { sb.removeChannel(delFallback); } catch (e) {} delFallback = null; }
        return;
      }
      if (st === "CHANNEL_ERROR" || st === "TIMED_OUT") {
        delErrN++;
        // the private channel is tried again later in case it was only a passing failure
        setTimeout(() => { if (delChan === ch && delErrN > 0 && sbUser && sbUser.id === me) startDelChan(); }, Math.min(300000, 15000 * delErrN * delErrN));
      }
    });
  delChan = ch;
}
function stopDelChan() {
  [delChan, delFallback].forEach(c => { if (c) { try { sb.removeChannel(c); } catch (e) {} } });
  delChan = delFallback = null; delErrN = 0;
}
// [E4] the chat list and the open chat poll every 5 s as a safety net; with the live connection up that is stretched to every 15 s
// (a new message still shows at once through the connection; a dropped connection brings the 5 s polls back)
let rtOk = false;
const pollGap = () => (rtOk ? 15000 : 5000);
function startRealtime() {
  if (!sbUser || rtChan) return;
  // a dropped connection is opened again by itself, a little later each time it fails
  const ch = sb.channel("nook-" + sbUser.id)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: "recipient_id=eq." + sbUser.id }, onIncomingMsg)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "user_id=eq." + sbUser.id }, onIncomingNote)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "bans", filter: "user_id=eq." + sbUser.id }, () => showBanned())
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "mod_notices", filter: "user_id=eq." + sbUser.id }, p => showModNotice(p.new))
    .subscribe(st => {
      // [E4] while the live connection is up, incoming messages arrive by themselves and the 5 s polls only back it up (see pollGap)
      if (rtChan === ch || !rtChan) rtOk = st === "SUBSCRIBED";
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
  startDelChan();
  if (tpChan) { try { sb.removeChannel(tpChan); } catch (e) {} }
  tpChan = sb.channel("tp-" + sbUser.id, { config: { private: true } })
    .on("broadcast", { event: "typing" }, ({ payload }) => onTyping(payload && payload.from, payload ? payload.on : undefined))
    .subscribe();
}

const VIEWS = { privacy: legalV, terms: legalV, auth: authV, user: userV, home: homeV, thread: threadV, profile: profileV, chat: chatV, conv: convV, saved: savedV, tag: tagV, lists: listsV, list: listV, settings: settingsV, zen: zenV, dm: dmV, notifs: notifsV, followers: c => followListV(c, "followers"), following: c => followListV(c, "following"), blocked: blockedV, account: accountV, hidden: hiddenChatsV, banned: bannedV, age: ageV, search: searchV };
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
      if (on && stack.length === 1) scrollMainTop(); else root(t[0]);
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
  if (pr.bannerTheme === "avatar" && (pr.banner || pr.avatar)) bn.append(mkImg(pr.banner || pr.avatar, "pic blur")); else if (pr.banner) bn.append(picImg(pr.banner));
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
// Screenshot guard. A web page cannot block the system screenshot or recorder, so while a chat is open
// the screen goes black whenever the page loses focus, is hidden, is printed, or a capture shortcut is pressed.
const SHIELD_ROUTES = new Set(["chat", "conv", "dm", "hidden"]);
let shieldRoute = false, shieldHold = 0, shieldTimer = 0;
let shieldBlur = false;
const shieldDesk = !matchMedia("(pointer: coarse)").matches;
function shieldApply() { document.documentElement.classList.toggle("shield-on", shieldRoute && (document.hidden || (shieldDesk && shieldBlur) || Date.now() < shieldHold)); }
function shieldFlash(ms) { shieldHold = Date.now() + ms; shieldApply(); clearTimeout(shieldTimer); shieldTimer = setTimeout(shieldApply, ms + 30); }
window.addEventListener("blur", () => { shieldBlur = true; shieldApply(); });
window.addEventListener("focus", () => { shieldBlur = false; shieldApply(); });
["pagehide", "pageshow", "beforeprint", "afterprint"].forEach(ev => window.addEventListener(ev, shieldApply));
document.addEventListener("visibilitychange", shieldApply);
const shieldKey = e => {
  const k = (e.key || "").toLowerCase();
  if (k === "printscreen" || k === "snapshot" || (e.metaKey && e.shiftKey && /^[345s]$/.test(k)) || (e.metaKey && e.shiftKey && /^[345]$/.test(e.code ? e.code.slice(-1) : "")) || (e.ctrlKey && k === "p")) {
    shieldFlash(2500);
    if (k === "printscreen") try { navigator.clipboard.writeText(" "); } catch (x) {}
  }
};
window.addEventListener("keydown", shieldKey, true);
window.addEventListener("keyup", shieldKey, true);
let ageGate = false;
// a short fingerprint of everything the home screen is drawn from: every field of every post (long strings such as pictures by their length and ends), the follows, and the feed status while no post is on the screen (it only shows in the empty state)
let homeSig = null;
function homeSigNow() {
  const out = [main.querySelector(".post") ? "" : feedStatus, followSet ? [...followSet].join(",") : "", sbUser ? sbUser.id : ""];
  const put = v => {
    if (typeof v === "string") out.push(v.length > 200 ? v.length + ":" + v.slice(0, 40) + v.slice(-40) : v);
    else if (v && typeof v === "object") { out.push("{"); if (Array.isArray(v)) v.forEach(put); else Object.keys(v).sort().forEach(k => { const x = v[k]; if (x == null || x === false || x === 0 || x === "" || (Array.isArray(x) && !x.length)) return; out.push(k); put(x); }); out.push("}"); }
    else out.push(String(v));
  };
  // a field that is empty, 0 or false counts the same as a missing one, and the order of the list does not matter to the posts shown (the screen sorts them)
  put(S.posts.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  put(S.profile && [S.profile.handle, S.profile.name, S.profile.avatar]);
  return out.join("\u0001");
}
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
  // a scroll position being restored for the page we leave must not fight the next page
  if (settleOff) settleOff();
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
  shieldRoute = SHIELD_ROUTES.has(cur.r); shieldApply();
  VIEWS[cur.r](cur);
  homeSig = cur.r === "home" && stack.length === 1 ? homeSigNow() : null;
  buildNav(cur);
  if (cur.r === "auth" || cur.r === "banned") railEl.textContent = ""; else renderRail();
  main.className = "";
  if (anim) { void getComputedStyle(main).animationName; main.className = "go-" + anim; }
  fresh = null;
  bump = null;
}

async function boot() {
  try {
    db = await idbOpen();
    const r = await idbLoad(db);
    if (r.meta) {
      S = r.meta;
      if (r.v2) {
        // one record per post and chat; the saved order is kept, and a record that is missing is simply left out
        const pm = new Map(r.posts.filter(x => x && typeof x.id === "string").map(x => ["p:" + x.id, x]));
        const cm = new Map(r.chats.filter(x => x && typeof x.id === "string").map(x => ["c:" + x.id, x]));
        pm.forEach((x, k) => idbSig.set(k, zenHash(x)));
        cm.forEach((x, k) => idbSig.set(k, zenHash(x)));
        S.posts = (Array.isArray(S.pids) ? S.pids : []).map(i => pm.get("p:" + i)).filter(Boolean);
        S.chats = (Array.isArray(S.cids) ? S.cids : []).map(i => cm.get("c:" + i)).filter(Boolean);
        delete S.pids; delete S.cids;
      } else idbLegacy = true;
      // pictures stay as ids (a name that is missing from the store is dropped, as before); only the profile pictures are loaded now
      const have = new Set(r.keys);
      const hy = v => (typeof v === "string" && !v.startsWith("data:") ? (have.has(v) ? v : null) : v);
      (S.posts || []).forEach(p => { p.imgs = (p.imgs || []).map(hy).filter(Boolean); });
      (S.chats || []).forEach(c => (c.msgs || []).forEach(m => { m.imgs = (m.imgs || []).map(hy).filter(Boolean); }));
      if (S.profile) { S.profile.avatar = await imgReal(hy(S.profile.avatar)); S.profile.banner = await imgReal(hy(S.profile.banner)); }
      r.keys.forEach(k => knownIds.add(k));
      arLoad(r.ar);
      setTimeout(arBackfill, 3000);
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
  try { ["tiny-bsky-v2", "zenith-pw", "nook-banned"].forEach(k => localStorage.removeItem(k)); Object.keys(localStorage).filter(k => /^nook-cache:(follows|fl|ids|rpt):/.test(k)).forEach(k => localStorage.removeItem(k)); } catch (e) {}
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
      feedPrefetch();
      histSync();
      render();
      earlySig = [S.profile.handle, S.profile.name, S.profile.avatar].join("|");
    }
  } catch (e) { early = false; sbUser = null; }
  const earlyUser = early ? sbUser : null;
  let slowLogin = false;
  // only a real refusal (400, 401, 403) means signed out; a failed call or a network error keeps the saved login like a slow answer does
  const { data: sess } = await Promise.race([sb.auth.getSession().then(r => { if (r && r.error && ![400, 401, 403].includes(r.error.status)) slowLogin = true; return r; }).catch(() => { slowLogin = true; return { data: { session: null } }; }), new Promise(r => setTimeout(() => { slowLogin = true; r({ data: { session: null } }); }, 6000))]);
  // a slow connection is not a sign out: the saved login stays until the server says no
  sbUser = sess && sess.session ? sess.session.user : slowLogin ? earlyUser : null;
  let ageHeld = false, ownAvatar = null;
  if (sbUser) {
    // the age answer is asked for beside the ban and account reads (it is only read, and used below exactly as before), not one round trip after them
    const okKey = "nook-age-ok:" + sbUser.id;
    let verified = false;
    try { verified = localStorage.getItem(okKey) === "1"; } catch (e) {}
    const ageP = verified ? null : Promise.resolve(sb.rpc("my_age_verified")).catch(e => ({ error: e }));
    const [{ data: ban }, { data: acct, error: aerr }] = await Promise.all([sb.from("bans").select("user_id").eq("user_id", sbUser.id).maybeSingle(), sb.from("accounts").select("id, deactivated, username, avatar, display_name").eq("id", sbUser.id).maybeSingle()]);
    if (ban) { dropPre(); hist(true); showBanned(); return; }
    if (acct) ownAvatar = acct.avatar || null;
    // if the check cannot be made the answer is "held": the age screen stays up until the server says otherwise
    if (acct) {
      // an account that passed the age check can never be put on hold, so after that one answer nothing is asked again
      if (!verified) {
        const v = await ageP;
        if (!v.error && v.data === true) { verified = true; try { localStorage.setItem(okKey, "1"); } catch (e) {} }
      }
      if (verified) acct.age_hold = false;
      else { const { data: held, error: he } = await sb.rpc("my_age_hold"); acct.age_hold = he ? navigator.onLine !== false : held === true; }
    }
    // when the account could not be read at all, the age check cannot be made either: only a phone that already passed it is let through
    let ageKnown = false;
    if (aerr) { try { ageKnown = localStorage.getItem("nook-age-ok:" + sbUser.id) === "1"; } catch (e) {} }
    // no connection is not an age hold: the offline page is shown instead, and the check is made when the connection is back
    const noNet = navigator.onLine === false || (!!aerr && !acct && !aerr.status && !aerr.code);
    ageHeld = !!(acct && acct.age_hold) || (!!aerr && !acct && !ageKnown && !noNet);
    if (noNet && !acct) offlineShow(true);
    if (ageHeld) dropPre();
    if (!aerr && (!acct || acct.deactivated)) { try { sessionStorage.setItem("nook-notice", acct ? "That account is deactivated. Sign in again to bring it back." : "Your account could not be loaded. Sign in again."); } catch (e) {} dropPre(); await sb.auth.signOut({ scope: "local" }).catch(() => {}); sbUser = null; }
    else if (sbUser && await foreignLocalData(acct)) {
      // an account that was deactivated here comes back with everything it had on this phone
      let raw = null;
      try { raw = await acctGet("snap:" + sbUser.id); } catch (e) {}
      if (raw) await loadSnap(sbUser.id); else await wipeLocal(true);
      try { localStorage.setItem(LOCAL_UID, sbUser.id); } catch (e) {}
      location.reload(); return;
    }
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
  histSync();
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
  setInterval(() => { if (document.visibilityState === "visible") checkBan(); }, 60000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { checkBan(); refreshBadge(true); checkModNotices().catch(() => {}); } });
}
// ---- notes to self: sealed on this phone and kept on every phone ----
// each chat and each message is one row the server cannot read; nothing here ever makes the screen wait
const isNoteChat = c => !(c.msgs || []).some(m => m.ai);
const noteHash = new Map();
const imgH = src => { if (isImgId(src)) return src; let v = noteHash.get(src); if (!v) { v = srcHash(src); if (noteHash.size > 200) noteHash.clear(); noteHash.set(src, v); } return v; };
const noteCSig = c => srcHash("c|" + (c.name || "") + "|" + (c.t || 0));
const noteImgSig = m => (m.imgs || []).map(imgH).join(",");
const noteMSig = m => srcHash("m|" + (m.text || "") + "|" + (m.t || 0) + "|" + noteImgSig(m) + "|" + JSON.stringify(m.rpost || null) + JSON.stringify(m.zpost || null));
let notesPushed = false;
let notesOn = false, notesBusy = false, notesAgain = false, notesTimer = 0, notesQuiet = false;
function noteState() {
  const n = S.notesSync;
  if (!n || n.uid !== sbUser.id) S.notesSync = { uid: sbUser.id, cursor: "", pushed: {}, pm: {} };
  return S.notesSync;
}
// ---- the rest of what lives on the phone: settings, saved posts and lists, sealed the same way ----
const REMOTE_ID = /^[0-9a-f-]{36}$/i;
function setSaved(p, on) {
  p.saved = on;
  if (!p.remote) return;
  S.sv = S.sv || {};
  if (on) S.sv[p.remote] = 1; else delete S.sv[p.remote];
  // the number under the bookmark counts people, so it follows this person's choice
  if (sbUser) {
    p.svc = Math.max(0, (p.svc || 0) + (on ? 1 : -1));
    // writes for one post run in the order of the taps, so a quick save then unsave ends as unsaved on the server too
    const run = () => (on ? sb.from("post_saves").upsert({ post_id: p.remote, user_id: sbUser.id }, { onConflict: "post_id,user_id", ignoreDuplicates: true }) : sb.from("post_saves").delete().eq("post_id", p.remote).eq("user_id", sbUser.id));
    const seq = (saveSeq.get(p.remote) || 0) + 1;
    saveSeq.set(p.remote, seq);
    // a write that fails is undone on screen, but only when no later tap came after it, so the screen always matches the last thing the server accepted
    const undo = () => {
      if (saveSeq.get(p.remote) !== seq) return;
      p.saved = !on;
      if (on) delete S.sv[p.remote]; else S.sv[p.remote] = 1;
      p.svc = Math.max(0, (p.svc || 0) + (on ? -1 : 1));
      persist();
      try { refreshActs(p); } catch (e) {}
      toast("Could not " + (on ? "save" : "remove") + " that post. Check your connection");
    };
    const q = (saveQ.get(p.remote) || Promise.resolve()).then(run).then(r => { if (r && r.error) undo(); }, undo);
    saveQ.set(p.remote, q);
    q.then(() => { if (saveQ.get(p.remote) === q) { saveQ.delete(p.remote); saveSeq.delete(p.remote); } });
  }
}
const saveSeq = new Map();
const saveQ = new Map();
// saves made before the counter existed are added once, for the posts that are on screen
function backfillSaves(mySaved, ids) {
  if (!sbUser || !S.sv) return;
  const have = mySaved instanceof Set ? mySaved : new Set();
  const add = ids.filter(id => S.sv[id] && !have.has(id)).map(id => ({ post_id: id, user_id: sbUser.id }));
  if (add.length) sb.from("post_saves").upsert(add, { onConflict: "post_id,user_id", ignoreDuplicates: true }).then(() => {}, () => {});
}
function idToRemote(id) {
  const p = byId(id);
  if (p && p.remote) return p.remote;
  const m = /^[rm]([0-9a-f-]{36})$/i.exec(String(id));
  return m ? m[1] : null;
}
const remoteToId = r => { const p = S.posts.find(x => x.remote === r); return p ? p.id : "r" + r; };
const xDocs = () => ({
  "x:ui": { theme: S.ui.theme || "system", homeTab: S.ui.homeTab || "latest", profTab: S.ui.profTab || "posts", langs: S.ui.langs || null, less: S.ui.less || null, hidden: S.ui.hidden || [], dmPins: S.ui.dmPins || [] },
  "x:saved": { ids: Object.keys(S.sv || {}).sort() },
  "x:lists": { lists: S.lists.map(l => ({ id: l.id, name: l.name, desc: l.desc || "", rids: l.ids.map(idToRemote).filter(Boolean) })) }
});
const xSig = d => srcHash(JSON.stringify(d));
function xApply(id, p, first) {
  if (id === "x:ui") {
    if (typeof p.theme === "string") S.ui.theme = p.theme;
    if (typeof p.homeTab === "string") S.ui.homeTab = p.homeTab;
    if (typeof p.profTab === "string") S.ui.profTab = p.profTab;
    S.ui.langs = Array.isArray(p.langs) ? p.langs.map(String).slice(0, 60) : null;
    if (p.less && typeof p.less === "object") S.ui.less = { a: p.less.a || {}, w: p.less.w || {} };
    if (Array.isArray(p.hidden)) S.ui.hidden = p.hidden.map(String).slice(-300);
    if (Array.isArray(p.dmPins)) S.ui.dmPins = p.dmPins.map(String).slice(0, 5);
    applyTheme();
  } else if (id === "x:saved") {
    const next = {};
    (Array.isArray(p.ids) ? p.ids : []).forEach(x => { if (typeof x === "string" && REMOTE_ID.test(x)) next[x] = 1; });
    // the first time this phone meets the server copy, what was saved here stays too
    if (first) Object.keys(S.sv || {}).forEach(x => { next[x] = 1; });
    S.sv = next;
    S.posts.forEach(q => { if (q.remote) q.saved = !!next[q.remote]; });
  } else if (id === "x:lists") {
    const incoming = (Array.isArray(p.lists) ? p.lists : []).filter(l => l && typeof l.id === "string").map(l => ({ id: l.id, name: String(l.name || "").slice(0, 80), desc: String(l.desc || "").slice(0, 300), ids: (Array.isArray(l.rids) ? l.rids : []).filter(x => typeof x === "string" && REMOTE_ID.test(x)).map(remoteToId) }));
    if (first) incoming.forEach(l => { const ex = S.lists.find(x => x.id === l.id); if (!ex) S.lists.push(l); else l.ids.forEach(i => { if (!ex.ids.includes(i)) ex.ids.push(i); }); });
    else S.lists = incoming;
  }
}
// replies that only live on this phone (they sit under a private answer of Zenith and cannot be posted) are kept sealed on the server too
const privPosts = () => { const withRemote = new Set(S.posts.filter(x => x.remote).map(x => x.id)); return S.posts.filter(p => !p.ra && !p.ai && !p.remote && p.parent && !withRemote.has(p.parent)); };
const privSig = p => srcHash("p|" + (p.text || "") + "|" + (p.t || 0) + "|" + (p.parent || "") + "|" + (p.liked ? 1 : 0) + (p.reposted ? 1 : 0) + (p.saved ? 1 : 0));
async function notePriv(ns, key, r) {
  const lid = r.id.slice(2), here = S.posts.find(x => x.id === lid);
  if (r.deleted) {
    if (here && !here.remote && ns.pushed[r.id] === privSig(here)) { S.posts = S.posts.filter(x => x !== here); ns.pushed[r.id] = "gone"; return true; }
    if (!here) delete ns.pushed[r.id];
    return false;
  }
  // known on this phone but gone from it: the removal goes up, it is not brought back
  if (ns.pushed[r.id] && !here) return false;
  if (here && ns.pushed[r.id] !== privSig(here)) return false;
  const p = await noteOpenP(key, r.body, r.id);
  const text = String(p.x || "").slice(0, 5000), t = Number(p.t) || Date.now(), pa = typeof p.pa === "string" ? p.pa : null;
  if (here) {
    if (here.text === text && here.t === t && (here.parent || null) === pa && !!here.liked === !!p.l && !!here.reposted === !!p.r && !!here.saved === !!p.s) return false;
    here.text = text; here.t = t; here.parent = pa; dropPostIndex(); here.liked = !!p.l; here.reposted = !!p.r; here.saved = !!p.s;
    ns.pushed[r.id] = privSig(here);
    return true;
  }
  const np = { id: lid, text, t, imgs: [], parent: pa, liked: !!p.l, reposted: !!p.r, saved: !!p.s, pinned: false };
  S.posts.push(np);
  ns.pushed[r.id] = privSig(np);
  return true;
}
async function noteExtra(ns, key, r) {
  const docs = xDocs();
  if (r.deleted || !docs[r.id]) return false;
  const known = ns.pushed[r.id], cur = docs[r.id];
  // changed on this phone since the last sync: this phone wins and the change goes up
  if (known && known !== xSig(cur)) return false;
  const p = await noteOpenP(key, r.body, r.id);
  if (JSON.stringify(p) === JSON.stringify(cur)) { ns.pushed[r.id] = xSig(cur); return false; }
  xApply(r.id, p, !known);
  ns.pushed[r.id] = xSig(xDocs()[r.id]);
  ns.extra = true;
  return true;
}
// saved posts and list entries that are not among the newest posts are fetched, and the flags follow the posts that are here
// ids the server did not return (removed or hidden posts) are not asked for again during this visit, so the next hundred get their turn
const wantGone = new Set();
async function fillWanted() {
  if (!sbUser || !S) return false;
  const want = new Set(Object.keys(S.sv || {}));
  S.lists.forEach(l => l.ids.forEach(i => { const r = idToRemote(i); if (r) want.add(r); }));
  const have = new Set(S.posts.filter(p => p.remote).map(p => p.remote));
  const miss = [...want].filter(r => !have.has(r) && !wantGone.has(r)).slice(0, 100);
  let changed = false;
  if (miss.length) {
    const { data, error } = await postsRead("id, user_id, body, created_at, parent_id, media_url", c => sb.from("posts").select(c).in("id", miss));
    if (!error) { const got = new Set((data || []).map(d => d.id)); miss.forEach(r => { if (!got.has(r)) wantGone.add(r); }); }
    changed = (await mapRemotePosts(data || [])) > 0;
  }
  S.posts.forEach(p => { if (p.remote && S.sv && S.sv[p.remote] && !p.saved) { p.saved = true; changed = true; } });
  S.lists.forEach(l => { l.ids = l.ids.map(i => { const r = idToRemote(i); return r ? remoteToId(r) : i; }); });
  return changed;
}
const blobToData = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
// the row id is bound to the sealed text, so the server cannot hand one note back as another; rows sealed before that are still opened and sealed again on the next push
const legacySeen = new Set();
async function noteOpen(key, raw, rid) {
  const parts = String(raw).slice(5).split("."), iv = fromB64(parts[0]), ct = fromB64(parts[1]);
  let pt;
  if (typeof rid === "string" && rid) {
    try { pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(rid) }, key, ct); }
    catch (e) { pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct); legacySeen.add(rid); }
  } else pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(pt));
}
const noteTE = new TextEncoder(), noteTD = new TextDecoder();
// [E2] noteOpenNow does what noteOpen does, but answers { p } (the opened note, plus legacy: true when the row was sealed without its id)
// or { e } (the error noteOpen would have thrown). noteOpenP is what the pull uses: the answer that was started ahead of time for exactly
// this row when there is one, else noteOpen itself (the legacy mark is set at the moment the row is taken in, as before).
async function noteOpenNow(key, raw, rid) {
  try {
    const parts = String(raw).slice(5).split("."), iv = fromB64(parts[0]), ct = fromB64(parts[1]);
    let pt, legacy = false;
    try { pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: noteTE.encode(rid) }, key, ct); }
    catch (e) { pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct); legacy = true; }
    return { p: JSON.parse(noteTD.decode(pt)), legacy };
  } catch (e) { return { e }; }
}
const noteMemo = new Map();
async function noteOpenP(key, raw, rid) {
  const m = typeof rid === "string" && rid ? noteMemo.get(rid) : null;
  if (!m || m.raw !== raw || m.key !== key) return noteOpen(key, raw, rid);
  noteMemo.delete(rid);
  const r = await m.pr;
  if (r.e) throw r.e;
  if (r.legacy) legacySeen.add(rid);
  return r.p;
}
// the next rows of a page are opened side by side a few dozen at a time while the earlier ones are being taken in
function noteAhead(key, rows, from) {
  for (let i = from; i < rows.length && i < from + 48; i++) {
    const r = rows[i];
    if (!r || r.deleted || typeof r.body !== "string" || typeof r.id !== "string" || noteMemo.has(r.id)) continue;
    noteMemo.set(r.id, { raw: r.body, key, pr: noteOpenNow(key, r.body, r.id) });
  }
}
// a page in the background has its timers slowed to a crawl, so it does not wait for them
const yieldMain = () => (document.hidden ? Promise.resolve() : typeof scheduler !== "undefined" && scheduler.yield ? scheduler.yield() : new Promise(r => setTimeout(r, 0)));
// whether a chat holds a message of Zenith, remembered per chat during a pull and only looked at again for messages added since
const noteAiMemo = new Map();
function noteIsChat(c) {
  const ms = c.msgs || [];
  let e = noteAiMemo.get(c);
  if (!e || e.arr !== ms || e.len > ms.length) e = { arr: ms, len: 0, ai: false };
  if (!e.ai) for (let i = e.len; i < ms.length; i++) if (ms[i] && ms[i].ai) { e.ai = true; break; }
  e.len = ms.length;
  noteAiMemo.set(c, e);
  return !e.ai;
}
// chats whose messages were sorted during this pull: a message that belongs at the end is then just added there
const noteSorted = new Set();
async function noteSeal(key, obj, rid) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const alg = typeof rid === "string" && rid ? { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(rid) } : { name: "AES-GCM", iv };
  const ct = await crypto.subtle.encrypt(alg, key, new TextEncoder().encode(JSON.stringify(obj)));
  return "e2e1:" + toB64(iv) + "." + toB64(new Uint8Array(ct));
}
// a picture asked for twice in one pull (started early for speed, read again in order) is fetched once; the list is emptied when the pull ends
const notePicMemo = new Map();
function notePicIn(key, md) {
  const k = md && md.url;
  if (k && notePicMemo.has(k)) return notePicMemo.get(k);
  const p = (async () => {
    const res = await fetch(await dmSignedUrl(md.url));
    if (!res.ok) throw new Error("gone");
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(md.iv) }, key, await res.arrayBuffer());
    return blobToData(new Blob([pt], { type: md.type || "image/jpeg" }));
  })();
  if (k) { notePicMemo.set(k, p); p.catch(() => notePicMemo.delete(k)); }
  return p;
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
// ids of the chats and messages on this phone while a pull runs, so each row is not looked up by scanning every chat
let noteKnown = null;
const noteFails = new Map();
const noteHere = (isChat, rid) => noteKnown ? noteKnown.has((isChat ? "c:" : "m:") + rid) : (isChat ? S.chats.some(x => x.id === rid) : S.chats.some(c => (c.msgs || []).some(x => x.id === rid)));
async function noteTake(ns, key, r) {
  if (r.id.startsWith("x:")) return noteExtra(ns, key, r);
  if (r.id.startsWith("p:")) return notePriv(ns, key, r);
  const isChat = r.id.startsWith("c:"), rid = r.id.slice(2);
  if (r.deleted) {
    if (isChat) {
      const c = S.chats.find(x => x.id === rid);
      if (c && isNoteChat(c) && (ns.pushed[r.id] === noteCSig(c))) { S.chats = S.chats.filter(x => x !== c); ns.pushed[r.id] = "gone"; if (noteKnown) noteKnown.delete("c:" + rid); return true; }
    } else {
      const f = noteFind(rid);
      if (f && isNoteChat(f.c) && ns.pushed[r.id] === noteMSig(f.m)) { f.c.msgs = f.c.msgs.filter(x => x !== f.m); ns.pushed[r.id] = "gone"; delete ns.pm[r.id]; if (noteKnown) noteKnown.delete("m:" + rid); if (noteIdx) noteIdx.delete(rid); return true; }
    }
    // a removal this phone never had needs no marker: nothing here can come back from it
    if (!noteHere(true, rid) && !noteHere(false, rid)) delete ns.pushed[r.id];
    return false;
  }
  // a note this phone already knew but no longer has was removed here: the removal goes up, it is not brought back
  if (ns.pushed[r.id] && !noteHere(isChat, rid)) return false;
  const p = await noteOpenP(key, r.body, r.id);
  if (isChat) {
    let c = S.chats.find(x => x.id === rid);
    if (c && (!noteIsChat(c) || ns.pushed[r.id] !== noteCSig(c))) return false;
    const name = String(p.n || "Notes to self").slice(0, 200), t = Number(p.t) || Date.now();
    if (c && c.name === name && c.t === t) return false;
    if (!c) { c = { id: rid, name, msgs: [], t }; S.chats.push(c); if (noteKnown) noteKnown.add("c:" + rid); } else { c.name = name; c.t = t; }
    ns.pushed[r.id] = noteCSig(c);
    return true;
  }
  const cid = String(p.c || "");
  if (!cid) return false;
  let c = S.chats.find(x => x.id === cid);
  if (c && !noteIsChat(c)) return false;
  const fm = noteFind(rid);
  let m = c && fm && fm.c === c ? fm.m : null;
  if (m && ns.pushed[r.id] !== noteMSig(m)) return false;
  const text = String(p.x || ""), t = Number(p.t) || Date.now();
  const media = Array.isArray(r.media) ? r.media : [];
  const have = ns.pm[r.id];
  const rp = p.rp && typeof p.rp.id === "string" && /^[0-9a-f-]{36}$/i.test(p.rp.id) ? { id: p.rp.id, u: typeof p.rp.u === "string" && /^[0-9a-f-]{36}$/i.test(p.rp.u) ? p.rp.u : null } : null;
  const zp = p.zp && typeof p.zp.x === "string" ? { x: p.zp.x.slice(0, 600), t: Number(p.zp.t) || Date.now(), a: typeof p.zp.a === "string" && p.zp.a.startsWith(SB_URL + "/storage/v1/object/public/media/") && p.zp.a.length < 400 ? p.zp.a : null } : null;
  if (m && m.text === text && m.t === t && have && JSON.stringify(have.e) === JSON.stringify(media) && JSON.stringify(m.rpost || null) === JSON.stringify(rp) && JSON.stringify(m.zpost || null) === JSON.stringify(zp)) return false;
  // a photo that cannot be fetched stops the pull here, and it is tried again on the next round
  const imgs = [];
  // unless it has been missing for three rounds in a row, then the note comes in without that photo
  for (const md of media) { try { imgs.push(await notePicIn(key, md)); } catch (e) { if (!(e && e.message === "gone" && (noteFails.get(r.id) || 0) >= 3)) throw e; } }
  if (!c) { c = { id: cid, name: "Notes to self", msgs: [], t }; S.chats.push(c); if (noteKnown) noteKnown.add("c:" + cid); ns.pushed["c:" + cid] = noteCSig(c); }
  noteFails.delete(r.id);
  if (!m) {
    m = { id: rid, text, t, imgs }; c.msgs.push(m);
    // [E2] sorting the whole chat for every row of a pull is 5000 sorts; after the first one the order is known, and a row that is not older than the last one stays at the end
    const n = c.msgs.length;
    if (!(noteSorted.has(c) && n > 1 && c.msgs[n - 2].t <= t)) { c.msgs.sort((a, b) => a.t - b.t); noteSorted.add(c); }
    if (noteKnown) noteKnown.add("m:" + rid); if (noteIdx) noteIdx.set(rid, { c, m }); } else { m.text = text; m.t = t; m.imgs = imgs; }
  if (rp) m.rpost = rp; else delete m.rpost;
  if (zp) m.zpost = zp; else delete m.zpost;
  ns.pushed[r.id] = noteMSig(m);
  ns.pm[r.id] = { h: noteImgSig(m), e: media };
  return true;
}
const noteBad = new Map();
// during one pull every message is looked up by id in a map instead of scanning all chats for each row
let noteIdx = null;
function noteFind(rid) {
  if (noteIdx) { const e = noteIdx.get(rid); return e || null; }
  for (const c of S.chats) { const m = (c.msgs || []).find(x => x.id === rid); if (m) return { c, m }; }
  return null;
}
async function notesPull(ns, key) {
  let changed = false, stuck = false, okRows = 0;
  ns.pullOk = false;
  noteKnown = new Set();
  noteIdx = new Map();
  S.chats.forEach(c => { noteKnown.add("c:" + c.id); (c.msgs || []).forEach(m => { noteKnown.add("m:" + m.id); noteIdx.set(m.id, { c, m }); }); });
  try {
  // a little overlap, so a row saved a moment before the last pull is never missed; what is already here is skipped
  const from = ns.cursor ? new Date(Date.parse(ns.cursor) - 300000).toISOString() : "1970-01-01T00:00:00Z";
  for (let off = 0; off < 40000; off += 500) {
    const { data, error } = await sb.from("notes_self").select("id, body, media, deleted, updated_at").gte("updated_at", from).order("updated_at", { ascending: true }).order("id", { ascending: true }).range(off, off + 499);
    if (error) throw error;
    // the pictures of this page are signed in one request and downloaded side by side while the rows are read in order
    const pics = (data || []).flatMap(r => Array.isArray(r.media) ? r.media : []).filter(md => md && md.url && md.iv).slice(0, 24);
    dmSignBatch(pics);
    pics.forEach(md => notePicIn(key, md).catch(() => {}));
    // [E2] the rows of a page are opened a few dozen ahead (side by side), and the main thread is given back every 24 rows so a page of 500
    // never runs as one long task
    let idx = 0;
    for (const r of data || []) {
      if (idx++ % 24 === 0) { noteAhead(key, data, idx - 1); await yieldMain(); }
      try { if (await noteTake(ns, key, r)) changed = true; noteBad.delete(r.id); okRows++; }
      catch (e) {
        if (e && e.message === "gone") noteFails.set(r.id, (noteFails.get(r.id) || 0) + 1);
        // a row that can never be read (damaged, or its photo is gone) is passed over after five rounds in a row; the cursor stays behind it so it is tried again later
        const unreadable = e && (e.message === "gone" || e.name === "OperationError" || e.name === "SyntaxError");
        const n = (noteBad.get(r.id) || 0) + 1;
        noteBad.set(r.id, n);
        if (!unreadable || n < 5) return changed;
        stuck = true; continue;
      }
      // a row that was sealed without its id is marked as not yet pushed, so the next push seals it again
      if (legacySeen.delete(r.id) && ns.pushed[r.id] && ns.pushed[r.id] !== "gone") ns.pushed[r.id] = "reseal";
      if (!stuck && (!ns.cursor || r.updated_at > ns.cursor)) ns.cursor = r.updated_at;
    }
    if (!data || data.length < 500) break;
  }
  // rows passed over count only when the key opened others in this round, so a locked key never looks like a finished pull
  if (stuck && !okRows) return changed;
  ns.pullOk = true;
  return changed;
  } finally { noteKnown = null; noteIdx = null; notePicMemo.clear(); noteMemo.clear(); noteAiMemo.clear(); noteSorted.clear(); }
}
async function notesPush(ns, key) {
  const exist = new Set();
  S.chats.forEach(c => { exist.add("c:" + c.id); (c.msgs || []).forEach(m => { if (!m.id) m.id = uid(); exist.add("m:" + m.id); }); });
  // the settings, saved and list copies are kept as they are, never marked as removed
  Object.keys(xDocs()).forEach(id => exist.add(id));
  const priv = privPosts();
  priv.forEach(p => exist.add("p:" + p.id));
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
          if (!media) { media = []; for (const s0 of x.m.imgs || []) { const src = await imgReal(s0); if (!/^data:/.test(src || "")) throw new Error("photo not ready"); media.push(await notePicOut(key, src)); } }
          rows.push({ owner_id: sbUser.id, id: x.id, body: await noteSeal(key, { c: x.c.id, t: x.m.t, x: x.m.text || "", ...(x.m.rpost ? { rp: x.m.rpost } : {}), ...(x.m.zpost ? { zp: x.m.zpost } : {}) }, x.id), media, deleted: false });
          done.push({ x, pm: { h, e: media } });
        } else {
          rows.push({ owner_id: sbUser.id, id: x.id, body: await noteSeal(key, { n: x.c.name, t: x.c.t }, x.id), media: [], deleted: false });
          done.push({ x });
        }
      } catch (e) { /* this one is tried again on the next round */ }
    }
    if (!rows.length) continue;
    const { error } = await sb.from("notes_self").upsert(rows, { onConflict: "owner_id,id" });
    if (error) throw error;
    notesPushed = true;
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
    notesPushed = true;
    part.forEach(id => { const o = ns.pm[id]; if (o) o.e.forEach(md => { const pth = notePath(md); if (pth) stale.push(pth); }); ns.pushed[id] = "gone"; delete ns.pm[id]; });
  }
  // settings, saved posts and lists go up only after the server copy has been read, so a fresh phone never wipes them
  if (ns.pullOk) {
    const xd = xDocs(), xrows = [];
    for (const id of Object.keys(xd)) {
      const sig = xSig(xd[id]);
      if (ns.pushed[id] !== sig) xrows.push({ id, sig, row: { owner_id: sbUser.id, id, body: await noteSeal(key, xd[id], id), media: [], deleted: false } });
    }
    for (const p of priv) {
      const id = "p:" + p.id, sig = privSig(p);
      if (ns.pushed[id] !== sig) xrows.push({ id, sig, row: { owner_id: sbUser.id, id, body: await noteSeal(key, { i: p.id, pa: p.parent, x: p.text || "", t: p.t, l: !!p.liked, r: !!p.reposted, s: !!p.saved }, id), media: [], deleted: false } });
    }
    if (xrows.length) {
      const { error } = await sb.from("notes_self").upsert(xrows.map(x => x.row), { onConflict: "owner_id,id" });
      if (error) throw error;
      notesPushed = true;
      xrows.forEach(x => { ns.pushed[x.id] = x.sig; });
    }
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
function extrasRefreshUI() {
  if (layer.childElementCount) return;
  const a = document.activeElement;
  if (a && /^(TEXTAREA|INPUT)$/.test(a.tagName)) return;
  render();
}
async function notesSync() {
  if (!notesOn || !sbUser || !S || !crypto.subtle || e2eLocked) return;
  if (notesBusy) { notesAgain = true; return; }
  notesBusy = true;
  try {
    await ensureE2E();
    const key = await sharedKey(sbUser.id);
    const ns = noteState();
    let moved = false;
    if (!S.sv) { S.sv = {}; S.posts.forEach(p => { if (p.saved && p.remote) S.sv[p.remote] = 1; }); moved = true; }
    const cur0 = ns.cursor;
    notesPushed = false;
    const changed = await notesPull(ns, key);
    if (ns.extra) { ns.extra = false; moved = true; try { await fillWanted(); } catch (e) {} }
    await notesPush(ns, key);
    // the phone is only written again when this round moved something
    if (moved || changed || ns.cursor !== cur0 || notesPushed) { notesQuiet = true; persist(); notesQuiet = false; }
    if (changed) { if (stack[stack.length - 1].r === "chat" || stack[stack.length - 1].r === "conv") notesRefreshUI(); else extrasRefreshUI(); }
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
      clearTimeout(timer); await Promise.all([Promise.race([flush(), wait(2500)]), wait(350)]);
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
  // a gesture the system took over, or going to the background, drops the pull instead of reloading the app
  const cancel = () => { const was = live; y0 = null; live = false; pull = 0; if (was) reset(); };
  document.addEventListener("touchcancel", cancel, true);
  // and a pull that nobody finishes is dropped after a moment
  let lastMove = 0;
  main.addEventListener("touchmove", () => { lastMove = Date.now(); }, { passive: true });
  setInterval(() => { if (live && !busy && Date.now() - lastMove > 2500) end(); }, 1000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && live && !busy) cancel(); });
})();
window.addEventListener("pagehide", flush);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
boot();
setInterval(zenTick, 10000);
setInterval(retryUnsent, 45000);
// ---- the offline page: only on screen while the phone has no connection ----
let offEl = null, offBoot = false;
function offlineShow(atBoot) {
  if (atBoot) offBoot = true;
  if (offEl) return;
  const retry = h("button", { class: "pri", onclick: () => { if (navigator.onLine === false) { toast("Still offline"); return; } location.reload(); } }, "Try again");
  offEl = h("div", { id: "offline", role: "alert" }, h("div", { class: "empty" }, ic("cloudOff", 56), h("h1", { class: "pname", style: "margin:0;color:var(--fg)" }, "You are offline"), retry));
  document.body.append(offEl);
}
function offlineHide() { if (offEl) { offEl.remove(); offEl = null; } }
window.addEventListener("offline", () => offlineShow());
// back online: the page goes, and a start that could not be made is made again
window.addEventListener("online", () => { const again = offBoot; offBoot = false; offlineHide(); if (again) location.reload(); });
if (navigator.onLine === false) offlineShow();
window.addEventListener("online", () => setTimeout(() => { retryUnsent(); feedTries = 0; if (sbUser && S) loadFeed().catch(() => {}); }, 800));
window.addEventListener("load", () => setTimeout(retryUnsent, 6000));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") zenTick(); });
window.addEventListener("load", () => setTimeout(zenTick, 1500));
