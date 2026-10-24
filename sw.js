const VERSION = "nook-3.2.26";
const SHARE_CACHE = "nook-share";
const SHELL = ["./", "index.html", "app.js", "update.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).catch(() => {}));
});
self.addEventListener("message", e => { if (e.data === "skip") self.skipWaiting(); });
async function handleShare(request) {
  const home = new URL("./index.html", self.registration.scope).href;
  try {
    const data = await request.formData();
    const c = await caches.open(SHARE_CACHE);
    await Promise.all((await c.keys()).map(k => c.delete(k)));
    const files = data.getAll("media").filter(f => f && typeof f.arrayBuffer === "function");
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
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) caches.open(VERSION).then(c => c.put(e.request, r.clone())).catch(() => {});
    return r;
  }).catch(() => caches.match(e.request)));
});
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) {}
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.some(w => w.visibilityState === "visible" && w.focused)) return;
    await self.registration.showNotification(d.title || "Nook", {
      body: d.body || "",
      icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      badge: "icon-192.png",
      tag: d.tag || "nook",
      renotify: true,
      silent: false,
      vibrate: [120, 60, 120],
      data: { open: d.open || "notifs" }
    });
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
