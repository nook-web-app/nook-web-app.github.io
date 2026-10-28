// The web app with the shared fixture instead of the real server: a fake session and a tiny PostgREST stand-in,
// a frozen clock, a Pixel 5 window. Takes one screenshot per page and sheet, named like the native Paparazzi shots.
// usage: node tools/refweb.js .. <outdir> [only-name | probe | probe-settings]   (needs playwright)
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium, devices } = require("playwright");
const root = path.resolve(process.argv[2]), OUT = path.resolve(process.argv[3]), ONLY = process.argv[4];
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, "fixture", "fixture.json"), "utf8"));
const PIC = fs.readFileSync(path.join(__dirname, "fixture", "sample_pic.png"));
const NOW = Date.parse(FX.now), UID = FX.me;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".json": "application/json", ".txt": "text/plain", ".ico": "image/x-icon" };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end("nope"); }
  res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(p).pipe(res);
});
const b64u = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = b64u({ alg: "HS256", typ: "JWT" }) + "." + b64u({ sub: UID, role: "authenticated", aud: "authenticated", email: "t@example.com", exp: 4102444800, iat: 1700000000, user_metadata: {}, app_metadata: {} }) + ".sig";
const USER = { id: UID, aud: "authenticated", role: "authenticated", email: "t@example.com", app_metadata: {}, user_metadata: {}, created_at: "2024-01-01T00:00:00Z" };
const SESSION = { access_token: jwt, refresh_token: "r", token_type: "bearer", expires_in: 3600000, expires_at: 4102444800, user: USER };
const MEDIA = "https://cimyolsipjdpibzaebmx.supabase.co/storage/v1/object/public/media/" + UID + "/sample.png";
const TABLES = {
  accounts: FX.people.map(p => ({ id: p.id, username: p.handle, display_name: p.name, avatar: null, banner: null, banner_theme: null, bio: p.bio, pinned_post_id: null, deactivated: false, handle_changed_at: null, public_key: null, age_verified: true, created_at: "2024-01-01T00:00:00Z", avatar_mod: "safe", banner_mod: "safe", text_pending: false })),
  posts: FX.posts.map(p => ({ id: p.id, user_id: FX.people[p.by].id, body: p.body, created_at: new Date(NOW - p.min * 60000).toISOString(), parent_id: p.parent || null, media_url: p.pic ? MEDIA : null, media_inline: false, mod_status: "safe", text_pending: false, last_edit_at: null })),
};
TABLES.posts_feed = TABLES.posts;
// enough of PostgREST for what the app reads: eq, neq, in, is, order, limit, and counts
function query(table, sp) {
  let rows = (TABLES[table] || []).slice();
  for (const [k, v] of sp) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(k)) continue;
    const [op, ...rest] = v.split("."), val = rest.join(".");
    if (op === "eq") rows = rows.filter(r => String(r[k]) === val);
    else if (op === "neq") rows = rows.filter(r => String(r[k]) !== val);
    else if (op === "is") rows = rows.filter(r => (val === "null" ? r[k] == null : String(r[k]) === val));
    else if (op === "in") { const set = new Set(val.replace(/^\(|\)$/g, "").split(",").map(s => s.replace(/^"|"$/g, ""))); rows = rows.filter(r => set.has(String(r[k]))); }
    else if (op === "not") { if (rest[0] === "is" && rest[1] === "null") rows = rows.filter(r => r[k] != null); }
  }
  const order = sp.get("order");
  if (order) { const [col, dir] = order.split(","); const [c, d] = col.split("."); rows.sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (d === "desc" ? -1 : 1)); }
  const lim = sp.get("limit"); if (lim) rows = rows.slice(0, +lim);
  return rows;
}
(async () => {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices["Pixel 5"], serviceWorkers: "block", colorScheme: "dark", timezoneId: "UTC", locale: "en-US" });
  await ctx.route(u => !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(u.href) && !/^(data|blob):/.test(u.href), async route => {
    const req = route.request(), url = new URL(req.url()), m = req.method();
    const hdr = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "content-range" };
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: hdr });
    if (!/supabase\.co$/.test(url.hostname)) return route.fulfill({ status: 200, headers: hdr, body: "{}" });
    const json = (b, s = 200, e = {}) => route.fulfill({ status: s, contentType: "application/json", headers: { ...hdr, ...e }, body: JSON.stringify(b) });
    if (url.pathname.startsWith("/storage/v1/object/public/")) return route.fulfill({ status: 200, contentType: "image/png", headers: hdr, body: PIC });
    if (url.pathname.startsWith("/auth/v1/token")) return json(SESSION);
    if (url.pathname.startsWith("/auth/v1/user")) return json(USER);
    if (url.pathname.startsWith("/auth/v1/")) return json({});
    if (url.pathname.startsWith("/functions/v1/")) return json({});
    if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.replace("/rest/v1/", "");
      if (table === "rpc/my_age_verified") return json(true);
      if (table.startsWith("rpc/")) return json(table === "rpc/dm_inbox" ? [] : null);
      if (m !== "GET" && m !== "HEAD") return json([], 201);
      const rows = query(table, url.searchParams);
      const range = { "content-range": (rows.length ? "0-" + (rows.length - 1) : "*") + "/" + rows.length };
      if ((req.headers()["accept"] || "").includes("vnd.pgrst.object")) return rows.length ? json(rows[0], 200, range) : json({ code: "PGRST116", message: "no rows" }, 406);
      return json(m === "HEAD" ? null : rows, 200, range);
    }
    return json({});
  });
  // a seeded Math.random, so the app picks the same placeholder and order on every run
  await ctx.addInitScript(() => { let a = 1234567; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; });
  await ctx.addInitScript(([s, uid]) => { try { localStorage.setItem("sb-cimyolsipjdpibzaebmx-auth-token", JSON.stringify(s)); localStorage.setItem("nook-local-uid", uid); localStorage.setItem("nook-installed", "1"); } catch (e) {} }, [SESSION, UID]);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOW);
  const errs = []; page.on("pageerror", e => errs.push(e.message));
  await page.goto("http://127.0.0.1:" + port + "/index.html");
  await page.waitForFunction(() => document.querySelectorAll(".post").length >= 4, null, { timeout: 30000 }).catch(() => console.log("feed did not load"));
  await page.waitForTimeout(1500);
  fs.writeFileSync(path.join(OUT, "ph.txt"), await page.evaluate(() => PH_NOW));
  if (ONLY === "probe-settings") {
    await page.evaluate(() => root("settings")); await page.waitForTimeout(800);
    const rows = await page.evaluate(() => {
      const r = e => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map(v => +v.toFixed(2)).join(" "); };
      const out = [];
      document.querySelectorAll("#main .sec, #main .srow").forEach(e => {
        if (e.classList.contains("sec")) out.push("sec:" + e.textContent + " " + r(e));
        else { const b = e.querySelector("b"), s = e.querySelector(".sub"); out.push("srow:" + b.textContent + " " + r(e)); out.push("srow-b:" + b.textContent + " " + r(b)); if (s) out.push("srow-sub:" + b.textContent + " " + r(s)); }
      });
      return out;
    });
    console.log(rows.slice(0, 14).join("\n")); await browser.close(); server.close(); return;
  }
  if (ONLY === "probe") {
    const rows = await page.evaluate(() => [...document.querySelectorAll("#main .post")].slice(0, 4).flatMap((el, i) => {
      const r = e => { if (!e) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map(v => +v.toFixed(2)); };
      return [["post", el], ["av", el.querySelector(".av")], ["name", el.querySelector(".pn")], ["time", el.querySelector(".pt")], ["text", el.querySelector(".tx")], ["acts", el.querySelector(".acts")]].map(([k, e]) => k + ":" + i + " " + (r(e) || []).join(" "));
    }));
    console.log(rows.join("\n")); await browser.close(); server.close(); return;
  }
  const P = n => FX.posts[n].id;
  const shot = async n => { await page.waitForTimeout(600); await page.screenshot({ path: path.join(OUT, n + ".png") }); console.log("shot", n); };
  const steps = [
    ["10-home", 'root("home")'],
    ["11-home-media", 'S.ui.homeTab="photos";render()'], ["x", 'S.ui.homeTab="latest";render()'],
    ["13-drawer", "openDrawer()"], ["x", "history.back()"],
    ["15-thread", `go({r:"thread",id:"m${P(5)}"})`],
    ["16-post-sheet", `root("home");postSheet(S.posts.find(x=>x.remote==="${P(0)}"))`], ["x", "history.back()"],
    ["18-share-sheet", `go({r:"thread",id:"m${P(0)}"});sharePost(S.posts.find(x=>x.remote==="${P(0)}"))`], ["x", "history.back()"],
    ["20-compose", 'root("home");openCompose({})'], ["x", "history.back()"],
    ["22-profile", 'root("profile")'], ["23-edit-profile", "editProfile()"], ["x", "history.back()"],
    ["25-saved", 'root("saved")'], ["26-chats", 'root("chat")'], ["27-notifs", 'root("home");go({r:"notifs"})'],
    ["28-settings", 'root("settings")'], ["29-lists", 'root("lists")'], ["30-search", 'root("search")'],
    ["32-confirm", `root("home");go({r:"user",id:"${FX.people[1].id}"});setTimeout(()=>confirmSheet("Delete this post?","Delete",()=>{}),300)`], ["x", "history.back()"],
    ["48-user", `root("home");go({r:"user",id:"${FX.people[3].id}"})`], ["wait", "void 0"],
    ["49-other-more", `root("home");document.querySelector('.post .ab.mo') && [...document.querySelectorAll(".post")].find(x=>x.textContent.includes("sleetslumber")).querySelector(".ab.mo").click()`], ["x", "history.back()"],
    ["51-report", `reportPost(S.posts.find(x=>x.remote==="${P(4)}"))`], ["x", "history.back()"],
    ["55-light-home", 'S.ui.theme="light";applyTheme();root("home")'], ["56-light-drawer", "openDrawer()"], ["x", "history.back()"],
    ["58-light-settings", 'root("settings")'],
  ];
  for (const [n, js] of steps) {
    try { await page.evaluate(js); } catch (e) { console.log("fail", n, e.message.slice(0, 160)); continue; }
    if (n === "x") { await page.waitForTimeout(450); continue; }
    if (n === "wait") { await page.waitForTimeout(2500); if (!ONLY || ONLY === "48-user") await shot("48-user-late"); continue; }
    if (!ONLY || n === ONLY) await shot(n);
  }
  if (errs.length) console.log("page errors:", errs.slice(0, 5).join(" | "));
  await browser.close(); server.close();
})().catch(e => { console.log("ERR", e.message.slice(0, 500)); process.exit(1); });
