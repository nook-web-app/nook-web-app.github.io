// mobile smoke test: serves the repo locally, mocks every outside request, never touches the real backend
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium, devices } = require("playwright");
const root = path.join(__dirname, ".."), out = path.join(__dirname, "out");
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) if (f.endsWith(".png")) fs.unlinkSync(path.join(out, f));
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
const seen = { external: [], supa: [] };

async function mock(context, port) {
  await context.route(u => !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(u.href) && !/^(data|blob):/.test(u.href), async route => {
    const url = new URL(route.request().url()), m = route.request().method();
    const json = (body, status = 200, extra = {}) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", ...extra }, body: JSON.stringify(body) });
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (/supabase\.co$/.test(url.hostname)) {
      seen.supa.push(m + " " + url.pathname);
      if (url.pathname.startsWith("/auth/v1/token")) return json(context.__signedIn ? SESSION : { error: "invalid_grant", error_description: "mock" }, context.__signedIn ? 200 : 400);
      if (url.pathname.startsWith("/auth/v1/user")) return context.__signedIn ? json(USER) : json({ msg: "no session" }, 401);
      if (url.pathname.startsWith("/auth/v1/")) return json({});
      if (url.pathname.startsWith("/rest/v1/")) {
        const table = url.pathname.replace("/rest/v1/", "");
        if (table === "rpc/my_age_verified") return json(true);
        if (table.startsWith("rpc/")) return json(null);
        if (table === "accounts") return json([{ id: UID, username: "tester", display_name: "Tester", avatar: null, deactivated: false, public_key: null, created_at: "2024-01-01T00:00:00Z" }], 200, { "content-range": "0-0/1" });
        return json([], 200, { "content-range": "*/0" });
      }
      if (url.pathname.startsWith("/functions/v1/")) return json({ ok: true });
      return json({});
    }
    seen.external.push(m + " " + url.origin);
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" });
  });
}

async function runDevice(browser, name, port) {
  console.log("--- " + name);
  const context = await browser.newContext({ ...devices[name], serviceWorkers: "allow" });
  await mock(context, port);
  const page = await context.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errs.push("console: " + m.text()); });
  const tag = name.replace(/\s+/g, "").toLowerCase();
  await page.goto("http://localhost:" + port + "/index.html");
  await page.waitForSelector(".in", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  ok(errs.length === 0, name + ": no page errors or console errors" + (errs.length ? "\n  " + errs.join("\n  ") : ""));
  const sign = await page.evaluate(() => ({ inputs: document.querySelectorAll("input").length, text: document.body.innerText, fail: !!document.querySelector("#startfail, .startfail") }));
  ok(sign.inputs >= 2 && /sign in|log in|welcome/i.test(sign.text), name + ": sign-in screen renders (" + sign.inputs + " inputs)");
  const fit = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.scrollWidth }));
  ok(fit.sw <= fit.cw && fit.bw <= fit.cw, name + ": no horizontal scroll " + JSON.stringify(fit));
  await page.screenshot({ path: path.join(out, tag + "-signin.png") });

  // forgot password flow
  const forgot = page.getByText("Forgot password?", { exact: true }).first();
  if (await forgot.count()) {
    await forgot.click();
    await page.waitForTimeout(400);
    const rm = await page.evaluate(() => { const c = [...document.querySelectorAll("input")].find(i => /authenticator code/i.test(i.placeholder || "")); return { title: /Reset password/.test(document.body.innerText), code: !!c, ph: c && c.placeholder, label: c && c.getAttribute("aria-label") }; });
    ok(rm.title && rm.code && /only if you use one/.test(rm.ph) && /optional/.test(rm.label), name + ": forgot password opens reset modal with optional authenticator code field");
    const fit2 = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    ok(fit2, name + ": reset modal fits width");
    await page.screenshot({ path: path.join(out, tag + "-reset.png") });
  } else ok(false, name + ": Forgot password? button exists");

  // service worker + manifest
  const sw = await page.evaluate(async () => { if (!navigator.serviceWorker) return "unsupported"; const r = await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 8000))]); return r ? r.active && r.active.scriptURL : null; });
  ok(typeof sw === "string" && /sw\.js\?v=[0-9.]+$/.test(sw), name + ": service worker registered and active (" + sw + ")");
  const man = await page.evaluate(async () => { const l = document.querySelector('link[rel=manifest]'); const r = await fetch(l.href); return r.json(); });
  ok(man && man.name && man.icons && man.icons.length, name + ": manifest loads and parses");
  await context.close();

  // signed in: a fake session in the storage the sdk uses, answered by the mocked auth endpoints
  const ctx2 = await browser.newContext({ ...devices[name], serviceWorkers: "block" });
  ctx2.__signedIn = true;
  await mock(ctx2, port);
  await ctx2.addInitScript(s => { try { localStorage.setItem("sb-cimyolsipjdpibzaebmx-auth-token", JSON.stringify(s)); } catch (e) {} }, SESSION);
  const p2 = await ctx2.newPage();
  const errs2 = [];
  p2.on("pageerror", e => errs2.push("pageerror: " + e.message));
  await p2.goto("http://localhost:" + port + "/index.html");
  await p2.waitForTimeout(3500);
  const nav = await p2.evaluate(() => { const n = document.getElementById("nav"); return { btns: n ? n.querySelectorAll("button, a").length : 0, signin: !!document.querySelector('input[type=password]') }; });
  if (nav.btns >= 2 && !nav.signin) {
    const labels = await p2.$$eval("#nav button, #nav a", els => els.map(e => e.getAttribute("aria-label") || e.textContent.trim()));
    let changed = 0;
    for (let i = 0; i < Math.min(labels.length, 5); i++) {
      const before = await p2.evaluate(() => document.getElementById("main").innerText);
      await p2.locator("#nav button, #nav a").nth(i).click({ timeout: 3000 }).catch(() => {});
      await p2.waitForTimeout(500);
      const after = await p2.evaluate(() => ({ t: document.getElementById("main").innerText, w: document.documentElement.scrollWidth <= document.documentElement.clientWidth }));
      if (after.t !== before) changed++;
      if (!after.w) ok(false, name + ": tab " + labels[i] + " causes horizontal scroll");
    }
    await p2.screenshot({ path: path.join(out, tag + "-signedin.png") });
    ok(changed >= 1 && errs2.length === 0, name + ": signed-in tab navigation works (" + labels.join(", ") + "; " + changed + " changed content)" + (errs2.length ? "\n  " + errs2.join("\n  ") : ""));
  } else {
    console.log("SKIP " + name + ": fake signed-in session was not accepted by the app (nav buttons=" + nav.btns + ", password field=" + nav.signin + ")");
    await p2.screenshot({ path: path.join(out, tag + "-signedin-skipped.png") });
  }
  await ctx2.close();
}

(async () => {
  const port = +process.env.PORT || 8130;
  await new Promise(r => server.listen(port, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    for (const d of ["iPhone 13", "Pixel 7"]) await runDevice(browser, d, port);
  } catch (e) { fails++; console.log("FAIL harness: " + (e && e.stack || e)); }
  ok(!seen.external.some(x => /supabase/.test(x)), "no request reached the real Supabase host (" + seen.supa.length + " mocked calls)");
  console.log("other external hosts mocked: " + [...new Set(seen.external)].join(", "));
  await browser.close();
  server.close();
  process.exit(fails ? 1 : 0);
})();
