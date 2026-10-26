// lazy pictures: boot reads no picture bytes, a picture is fetched when it scrolls into view, a backup still holds every picture
// the data is written straight into the app's own IndexedDB (the on-disk format of the per-record image store), then the app is booted on a phone viewport
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium, devices } = require("playwright");
const root = path.join(__dirname, "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".json": "application/json", ".txt": "text/plain" };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end("nope"); }
  res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(p).pipe(res);
});
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const b64u = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const UID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const jwt = b64u({ alg: "HS256", typ: "JWT" }) + "." + b64u({ sub: UID, role: "authenticated", aud: "authenticated", email: "t@example.com", exp: 4102444800, iat: 1700000000, user_metadata: {}, app_metadata: {} }) + ".sig";
const USER = { id: UID, aud: "authenticated", role: "authenticated", email: "t@example.com", app_metadata: {}, user_metadata: {}, created_at: "2024-01-01T00:00:00Z" };
const SESSION = { access_token: jwt, refresh_token: "fake-refresh", token_type: "bearer", expires_in: 3600000, expires_at: 4102444800, user: USER };
const N = 40;

async function mock(context) {
  await context.route(u => !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(u.href) && !/^(data|blob):/.test(u.href), async route => {
    const url = new URL(route.request().url()), m = route.request().method();
    const hdr = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
    const json = (body, status = 200, extra = {}) => route.fulfill({ status, contentType: "application/json", headers: { ...hdr, ...extra }, body: JSON.stringify(body) });
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: hdr });
    if (/supabase\.co$/.test(url.hostname)) {
      if (url.pathname.startsWith("/auth/v1/token")) return json(SESSION);
      if (url.pathname.startsWith("/auth/v1/user")) return json(USER);
      if (url.pathname.startsWith("/auth/v1/")) return json({});
      if (url.pathname.startsWith("/rest/v1/")) {
        const table = url.pathname.replace("/rest/v1/", "");
        if (table === "rpc/my_age_verified") return json(true);
        if (table.startsWith("rpc/")) return json(null);
        if (table === "accounts") return json([{ id: UID, username: "tester", display_name: "Tester", avatar: null, deactivated: false, public_key: null, created_at: "2024-01-01T00:00:00Z" }], 200, { "content-range": "0-0/1" });
        return json([], 200, { "content-range": "*/0" });
      }
      return json({});
    }
    return route.fulfill({ status: 200, contentType: "application/json", headers: hdr, body: "{}" });
  });
}

(async () => {
  const port = +process.env.PORT || 8136;
  await new Promise(r => server.listen(port, "127.0.0.1", r));
  const browser = await chromium.launch();
  const errs = [];
  try {
    const ctx = await browser.newContext({ ...devices["iPhone 13"], serviceWorkers: "block" });
    await mock(ctx);
    await ctx.addInitScript(([s, uid]) => {
      try { localStorage.setItem("sb-cimyolsipjdpibzaebmx-auth-token", JSON.stringify(s)); localStorage.setItem("nook-local-uid", uid); } catch (e) {}
      // counts every read of the picture store
      window.__reads = { getAll: 0, keys: 0, get: [] };
      const P = IDBObjectStore.prototype, ga = P.getAll, gk = P.getAllKeys, g = P.get;
      P.getAll = function (...a) { if (this.name === "img") window.__reads.getAll++; return ga.apply(this, a); };
      P.getAllKeys = function (...a) { if (this.name === "img") window.__reads.keys++; return gk.apply(this, a); };
      P.get = function (k) { if (this.name === "img") window.__reads.get.push(String(k)); return g.apply(this, arguments); };
    }, [SESSION, UID]);
    const page = await ctx.newPage();
    page.on("pageerror", e => errs.push("pageerror: " + e.message));
    const base = "http://localhost:" + port + "/";
    // write the saved data in the same shape the app writes it: state2 + p:<id> records + one record per picture
    await page.goto(base + "CLAUDE_READ_THIS.txt");
    await page.evaluate(async n => {
      const png = i => { const c = document.createElement("canvas"); c.width = 240; c.height = 180; const x = c.getContext("2d"); x.fillStyle = "hsl(" + (i * 9) + ",70%,50%)"; x.fillRect(0, 0, 240, 180); x.fillStyle = "#fff"; x.font = "40px sans-serif"; x.fillText("#" + i, 20, 100); return c.toDataURL("image/png"); };
      const db = await new Promise((res, rej) => { const r = indexedDB.open("tiny-posts", 2); r.onupgradeneeded = () => { r.result.createObjectStore("kv"); r.result.createObjectStore("img"); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const t = db.transaction(["kv", "img"], "readwrite"), kv = t.objectStore("kv"), im = t.objectStore("img");
      const pids = [], pics = {};
      for (let i = 0; i < n; i++) {
        const key = "i" + (1000 + i).toString(36) + "-" + i.toString(36) + "-z" + i.toString(36);
        pics[key] = png(i);
        im.put(pics[key], key);
        const id = "post" + i;
        pids.push(id);
        kv.put({ id, text: "post number " + i, t: Date.now() - i * 60000, imgs: [key], liked: false, reposted: false, saved: false, pinned: false, parent: null }, "p:" + id);
      }
      const av = "iavatar-1-2"; im.put(png(99), av);
      kv.put({ v: 3, split: 2, pids, cids: [], profile: { name: "Me", handle: "me", bio: "", avatar: av, banner: null }, lists: [], feeds: [], ui: { theme: "system", homeTab: "latest", profTab: "posts" } }, "state2");
      await new Promise((res, rej) => { t.oncomplete = res; t.onerror = t.onabort = () => rej(t.error); });
      db.close();
    }, N);
    await page.goto(base + "index.html");
    await page.waitForSelector("article.post", { timeout: 15000 });
    await page.waitForTimeout(1200);
    const boot = await page.evaluate(() => ({ reads: window.__reads, posts: S.posts.length, ids: S.posts.filter(p => typeof p.imgs[0] === "string" && !p.imgs[0].startsWith("data:")).length, avatar: String(S.profile.avatar).slice(0, 11), ph: document.querySelectorAll("img[data-iid]").length, loaded: [...document.querySelectorAll(".imgs img")].filter(i => i.src && i.naturalWidth > 0).length, all: document.querySelectorAll(".imgs img").length }));
    ok(boot.posts === N, "boot: all " + N + " posts are in memory (metadata only)");
    ok(boot.reads.getAll === 0, "boot: the picture store is never read with getAll (" + boot.reads.getAll + ")");
    ok(boot.ids === N, "boot: post pictures are kept as ids, not as bytes (" + boot.ids + " of " + N + ")");
    ok(boot.avatar === "data:image/", "boot: only the profile picture is loaded up front");
    ok(boot.reads.get.length < N / 2, "boot: only pictures near the screen were fetched (" + boot.reads.get.length + " of " + N + ")");
    ok(boot.loaded > 0 && boot.loaded < N && boot.ph > 0, "boot: on-screen pictures filled in (" + boot.loaded + "), the rest are placeholders (" + boot.ph + ")");
    const lastSel = "article.post:last-of-type .imgs img";
    const lastBefore = await page.evaluate(sel => { const i = document.querySelector(sel); return i ? { src: i.getAttribute("src"), iid: i.dataset.iid || null } : null; }, lastSel);
    ok(lastBefore && !lastBefore.src && lastBefore.iid, "last post picture is a placeholder before scrolling");
    // placeholders keep a box, so filling in does not push the page around
    const boxBefore = await page.evaluate(sel => document.querySelector(sel).getBoundingClientRect().height, lastSel);
    ok(boxBefore > 40, "placeholder has a real box (" + Math.round(boxBefore) + "px)");
    const getsBefore = boot.reads.get.length;
    // the list may add more posts as it nears the end, so the bottom is visited a few times
    const bottom = () => page.evaluate(() => { const m = document.getElementById("main"); m.scrollTop = m.scrollHeight; });
    for (let k = 0; k < 4; k++) { await bottom(); await page.waitForTimeout(500); }
    await page.waitForFunction(() => { const l = [...document.querySelectorAll(".imgs img")].pop(); return l && l.getAttribute("src") && l.naturalWidth > 0; }, null, { timeout: 8000 }).catch(() => {});
    const after = await page.evaluate(() => { const l = [...document.querySelectorAll(".imgs img")].pop(); return { src: l.getAttribute("src"), w: l.naturalWidth, gets: window.__reads.get.length, getAll: window.__reads.getAll }; });
    ok(after.src && after.w > 0, "after scrolling into view the picture appears");
    ok(after.gets > getsBefore && after.getAll === 0, "scrolling fetched pictures one by one (" + getsBefore + " -> " + after.gets + ")");
    // saving must not lose pictures that were never loaded
    await page.evaluate(() => { S.ui.touched = Date.now(); persist(); });
    await page.waitForTimeout(1500);
    const kept = await page.evaluate(() => new Promise((res, rej) => { const r = indexedDB.open("tiny-posts"); r.onsuccess = () => { const q = r.result.transaction("img").objectStore("img").getAllKeys(); q.onsuccess = () => { r.result.close(); res(q.result.length); }; }; r.onerror = () => rej(r.error); }));
    ok(kept === N + 1, "a save keeps every stored picture, loaded or not (" + kept + ")");
    // export holds every picture even though none of them were loaded
    const exp = await page.evaluate(async n => {
      let zip = null;
      window.saveSheet = (blob, name, count) => { zip = blob; };
      await downloadBackupNow();
      const files = await readZip(await zip.arrayBuffer());
      const orig = await new Promise((res, rej) => { const r = indexedDB.open("tiny-posts"); r.onsuccess = () => { const q = r.result.transaction("img").objectStore("img").getAll(); q.onsuccess = () => { r.result.close(); res(q.result); }; }; r.onerror = () => rej(r.error); });
      const names = Object.keys(files).filter(k => /^posts\/images\//.test(k));
      let same = 0;
      for (const k of names) if (orig.includes(bytesToDataURL(files[k], "image/png"))) same++;
      return { names: names.length, same, avatar: !!files["profile/avatar.png"], posts: JSON.parse(new TextDecoder().decode(files["posts/posts.json"])).filter(p => p.media[0]).length };
    }, N);
    ok(exp.names === N && exp.same === N && exp.posts === N, "export contains all " + N + " pictures with the original bytes (" + exp.names + " files, " + exp.same + " identical)");
    ok(exp.avatar, "export contains the profile picture");
    // a snapshot (account switch) and the plain-storage copy are whole too
    const full = await page.evaluate(async () => { const f = await fullState(); return f.posts.filter(p => /^data:image\//.test(p.imgs[0])).length; });
    ok(full === N, "fullState() brings back every picture (" + full + ")");
    ok(errs.length === 0, "no page errors" + (errs.length ? "\n  " + errs.join("\n  ") : ""));
    await ctx.close();
  } catch (e) { fails++; console.log("FAIL harness: " + (e && e.stack || e)); }
  await browser.close();
  server.close();
  process.exit(fails ? 1 : 0);
})();
