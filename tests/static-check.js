// syntax check of every .js, version number match, sanity of sw.js and the manifest
const fs = require("fs"), path = require("path"), cp = require("child_process");
const root = path.join(__dirname, "..");
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
  if (["node_modules", ".git", "tests", "supabase"].includes(e.name)) return [];
  const p = path.join(d, e.name);
  return e.isDirectory() ? walk(p) : [p];
});
for (const f of walk(root).filter(f => f.endsWith(".js") && !/supabase\.js$/.test(f))) {
  const r = cp.spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
  ok(r.status === 0, "node --check " + path.relative(root, f) + (r.status ? "\n" + r.stderr : ""));
}
const rd = f => fs.readFileSync(path.join(root, f), "utf8");
const sw = rd("sw.js"), app = rd("app.js"), notes = rd("CLAUDE_READ_THIS.txt");
ok(sw.length > 2000, "sw.js is not empty or tiny");
ok(/addEventListener\(\s*["']fetch["']/.test(sw) && /addEventListener\(\s*["']install["']/.test(sw) && /addEventListener\(\s*["']activate["']/.test(sw), "sw.js has install, activate and fetch handlers");
const v = { app: (/APP_VERSION = "([0-9.]+)"/.exec(app) || [])[1], notes: ((/^## (.*)$/m.exec(notes) || [])[1] || "").replace(/ *!$/, "") };
ok(v.app && v.app === v.notes, "app and notes version numbers match " + JSON.stringify(v));
ok(/searchParams\.get\(["']v["']\)/.test(sw), "sw.js takes its cache version from its address");
ok(/register\(\s*["']sw\.js\?v=["']\s*\+\s*encodeURIComponent\(APP_VERSION\)/.test(rd("update.js")), "update.js registers sw.js with APP_VERSION in the address");
let man; try { man = JSON.parse(rd("manifest.webmanifest")); } catch (e) {}
ok(man && man.name && man.start_url && man.display && Array.isArray(man.icons) && man.icons.length > 0, "manifest.webmanifest is valid JSON with name, start_url, display, icons");
if (man) for (const i of man.icons || []) ok(fs.existsSync(path.join(root, i.src)), "manifest icon exists: " + i.src);
const html = rd("index.html");
for (const m of html.matchAll(/(?:src|href)="([^":#]+\.(?:js|css|png|woff2|webmanifest))"/g)) ok(fs.existsSync(path.join(root, m[1])), "index.html reference exists: " + m[1]);
process.exit(fails ? 1 : 0);
