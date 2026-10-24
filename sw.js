const VERSION = "nook-3.4.17";
const SHARE_CACHE = "nook-share";
const SHELL = ["./", "index.html", "app.js", "update.js", "supabase.js", "fonts/inter-latin.woff2", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
self.addEventListener("install", e => {
  // the app files are fetched fresh (not from the browser's own cache) and kept under this version, so a version is always whole
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))));
});
self.addEventListener("message", e => { if (e.data === "skip") self.skipWaiting(); });
async function handleShare(request) {
  const home = new URL("./index.html", self.registration.scope).href;
  // a share comes from the phone's share menu; a form sent by another website is ignored
  if (request.headers.get("sec-fetch-site") === "cross-site") return Response.redirect(home, 303);
  try {
    const data = await request.formData();
    const c = await caches.open(SHARE_CACHE);
    await Promise.all((await c.keys()).map(k => c.delete(k)));
    const files = data.getAll("media").filter(f => f && typeof f.arrayBuffer === "function" && /^image\//.test(f.type || "") && f.size <= 20 * 1024 * 1024).slice(0, 20);
    await Promise.all(files.map((f, i) => c.put(new URL("share/" + i, self.registration.scope).href, new Response(f, { headers: { "Content-Type": f.type || "application/octet-stream", "X-Name": encodeURIComponent(f.name || "shared") } }))));
    const q = new URLSearchParams();
    ["title", "text", "url"].forEach(k => { const v = data.get(k); if (v) q.set(k, String(v)); });
    q.set("shared", String(files.length));
    return Response.redirect(home + "?" + q.toString(), 303);
  } catch (err) {
    return Response.redirect(home, 303);
  }
}
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method === "POST" && url.origin === self.location.origin && url.pathname.endsWith("/index.html")) {
    e.respondWith(handleShare(e.request));
    return;
  }
  if (e.request.method !== "GET") return;
  // only the app files are kept offline: data from the server (messages, profiles, signed links) must never sit in a cache that the next person on this phone could read
  if (url.origin !== self.location.origin) return;
  // the notes file is how the app learns about a new version: always from the server
  if (url.pathname.endsWith("/CLAUDE_READ_THIS.txt")) return;
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const hit = await c.match(e.request, e.request.mode === "navigate" ? { ignoreSearch: true } : undefined);
    if (hit) return hit;
    try {
      const r = await fetch(e.request);
      if (r.ok) c.put(e.request, r.clone()).catch(() => {});
      return r;
    } catch (err) {
      if (e.request.mode === "navigate") { const home = await c.match("index.html"); if (home) return home; }
      return (await caches.match(e.request)) || Response.error();
    }
  })());
});
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
// a chat message arrives sealed: the key of this phone opens it here, nothing is sent anywhere
async function messageText(d) {
  if (d.text) return d.text;
  if (d.photo) return "sent a photo";
  if (!d.enc || !d.key || !d.uid) return "";
  try {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("nook-keys", 1);
      r.onupgradeneeded = () => r.transaction.abort();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const rec = await new Promise((res, rej) => { const q = db.transaction("k").objectStore("k").get(d.uid); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    if (!rec || !rec.priv) return "";
    const peer = await crypto.subtle.importKey("raw", b64(d.key), { name: "ECDH", namedCurve: "P-256" }, false, []);
    const aes = await crypto.subtle.deriveKey({ name: "ECDH", public: peer }, rec.priv, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const parts = d.enc.slice(5).split(".");
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(parts[0]) }, aes, b64(parts[1])));
  } catch (e) { return ""; }
}
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) {}
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.some(w => w.visibilityState === "visible" && w.focused)) return;
    const tag = d.tag || "nook";
    let title = d.title || "Nook", body = d.body || "";
    let lines = [];
    if (/^message:/.test(tag)) {
      const text = await messageText(d);
      if (text) {
        // messages of the same person pile up in one notification, newest at the bottom
        const prev = (await self.registration.getNotifications({ tag })).filter(n => n.data && Array.isArray(n.data.lines) && Date.now() - (n.data.t || 0) < 600000);
        lines = (prev[0] ? prev[0].data.lines : []).concat(text.length > 160 ? text.slice(0, 157) + "..." : text).slice(-6);
        body = lines.join("\n");
        if (lines.length > 1) title += " (" + lines.length + " messages)";
      }
    }
    const opts = {
      body,
      // a fully see through picture: with none at all the phone draws a letter tile, with a coloured one it draws a coloured square
      icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
      tag,
      renotify: true,
      vibrate: [120, 60, 120],
      data: { open: d.open || "notifs", lines, t: Date.now() }
    };
    // a notification must always come out: if the phone refuses one of the extras, show it again with only the basics
    try { await self.registration.showNotification(title, opts); }
    catch (err) { await self.registration.showNotification(title, { body: opts.body, tag: opts.tag, data: opts.data }); }
  })());
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const open = (e.notification.data && e.notification.data.open) || "notifs";
  const target = new URL("./index.html?open=" + encodeURIComponent(open), self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if ("focus" in w) {
        await w.focus();
        w.postMessage({ type: "open", open });
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
