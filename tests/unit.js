// pure-function tests: functions are cut out of app.js text and run in a vm sandbox (no DOM)
const fs = require("fs"), path = require("path"), vm = require("vm");
const src = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").split("\n");
// take the top-level declaration that starts with `start`, adding lines until it compiles
function grab(start) {
  const i = src.findIndex(l => l.startsWith(start));
  if (i < 0) throw new Error("not found in app.js: " + start);
  let code = "";
  for (let j = i; j < src.length; j++) {
    code += src[j] + "\n";
    try { new vm.Script(code); return code; } catch (e) { /* keep adding lines */ }
  }
  throw new Error("could not cut out: " + start);
}
const el = (tag, props, kids) => ({ tag, props: props || {}, kids });
const sb = { crypto: require("crypto").webcrypto, TextEncoder, TextDecoder, Blob, btoa, atob, URL, Uint8Array, Uint32Array, DataView, ArrayBuffer, JSON, Promise, Set, Map, console,
  h: (tag, props, ...kids) => el(tag, props, kids), go() {}, sbUser: { id: "11111111-2222-3333-4444-555555555555" }, window: {}, legacySeen: new Set() };
sb.window.crypto = sb.crypto;
vm.createContext(sb);
const load = (...starts) => vm.runInContext(starts.map(grab).join("\n") + "\n", sb);
load("const TRACKING", "const PLAIN_HOSTS", "function cleanUrl(", "function rich(", "const cleanText", "const firstUrl", "const hostOf", "const ytId");
load("const CRCT", "function crc32(", "function makeZip(", "const extOf", "const safeName");
load("const E2E_ALG", "const toB64", "const fromB64", "const KDF_ITERS", "const kbV2", "async function recoveryKey(", "const kbAad", "async function sealKeyBackup(", "async function openKeyBackup(");
load("async function noteOpen(", "async function noteSeal(");
load("const RT_PFX", "async function rtSeal(", "async function rtOpen(");
// the stored-login key lives in IndexedDB in the app; here it is a plain in-memory key
vm.runInContext('let _k; function rtKey() { return _k || (_k = crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])); }', sb);

const assert = require("assert");
let fails = 0;
async function t(name, fn) { try { await fn(); console.log("PASS " + name); } catch (e) { fails++; console.log("FAIL " + name + "\n  " + (e && e.stack || e)); } }
const run = code => vm.runInContext(code, sb);
const flat = arr => Array.from(arr).map(x => typeof x === "string" ? x : x.tag === "a" ? "<a " + x.props.href + ">" + x.kids[0] : x.tag === "button" ? "<tag " + x.kids[0] + ">" : "<" + x.tag + ">" + x.kids[0]);

(async () => {
  await t("cleanUrl strips tracking params but keeps real ones", () => {
    assert.strictEqual(run('cleanUrl("https://ex.com/p?utm_source=a&id=5&fbclid=z#h")'), "https://ex.com/p?id=5#h");
    assert.strictEqual(run('cleanUrl("https://ex.com/p?utm_x=1")'), "https://ex.com/p");
    assert.strictEqual(run('cleanUrl("https://www.instagram.com/p/abc?igsh=1&x=2")'), "https://www.instagram.com/p/abc");
    assert.strictEqual(run('cleanUrl("https://ex.com/p")'), "https://ex.com/p");
  });
  await t("rich() parses links, trailing punctuation, hashtags, bold and italics", () => {
    assert.deepStrictEqual(flat(run('rich("see https://ex.com/a?utm_medium=x, ok")')), ["see ", "<a https://ex.com/a>ex.com/a", ",", " ok"]);
    assert.deepStrictEqual(flat(run('rich("hi #nook_1 there")')), ["hi ", "<tag #nook_1>", " there"]);
    assert.deepStrictEqual(flat(run('rich("a **bold** and *slant* b")')), ["a ", "<b>bold", " and ", "<i>slant", " b"]);
    assert.deepStrictEqual(flat(run('rich("2 * 3 * 4")')), ["2 * 3 * 4"]);
    assert.strictEqual(run("rich(null)").length, 0);
    const long = flat(run('rich("https://example.com/' + "x".repeat(80) + '")'))[0];
    assert.ok(long.endsWith("…"), "long link text is shortened");
  });
  await t("rich() never makes a link from javascript: text", () => {
    const out = run('rich("javascript:alert(1) data:text/html,x")');
    assert.ok(out.every(x => typeof x === "string"));
  });
  await t("firstUrl, hostOf, ytId, cleanText", () => {
    assert.strictEqual(run('firstUrl("go to https://a.com/x?utm_a=1.")'), "https://a.com/x");
    assert.strictEqual(run('hostOf("https://www.a.com/x")'), "a.com");
    assert.strictEqual(run('ytId("https://youtu.be/dQw4w9WgXcQ")'), "dQw4w9WgXcQ");
    assert.strictEqual(run('ytId("https://example.com")'), null);
    assert.strictEqual(run('cleanText("x https://a.com/?fbclid=1) y")'), "x https://a.com/) y");
  });
  await t("makeZip writes a valid stored zip (entries, sizes, crc32)", async () => {
    assert.strictEqual(run("crc32(new TextEncoder().encode('123456789'))"), 0xCBF43926);
    const files = [{ name: "a.txt", data: new TextEncoder().encode("hello") }, { name: "dir/é.bin", data: new Uint8Array([0, 1, 2, 255]) }];
    sb.__f = files;
    const blob = run("makeZip(__f)");
    const u8 = new Uint8Array(await blob.arrayBuffer()), dv = new DataView(u8.buffer);
    const eocd = u8.length - 22;
    assert.strictEqual(dv.getUint32(eocd, true), 0x06054b50);
    assert.strictEqual(dv.getUint16(eocd + 10, true), 2);
    let p = dv.getUint32(eocd + 16, true); const got = [];
    for (let i = 0; i < 2; i++) {
      assert.strictEqual(dv.getUint32(p, true), 0x02014b50);
      const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 24, true), nl = dv.getUint16(p + 28, true), off = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.slice(p + 46, p + 46 + nl));
      assert.strictEqual(dv.getUint32(off, true), 0x04034b50);
      const data = u8.slice(off + 30 + nl, off + 30 + nl + size);
      assert.strictEqual(sb.crc32(data), crc);
      got.push([name, Array.from(data)]);
      p += 46 + nl;
    }
    assert.deepStrictEqual(got, [["a.txt", Array.from(files[0].data)], ["dir/é.bin", [0, 1, 2, 255]]]);
    const tmp = path.join(require("os").tmpdir(), "nook-test-" + process.pid + ".zip");
    fs.writeFileSync(tmp, u8);
    const r = require("child_process").spawnSync("unzip", ["-tq", tmp], { encoding: "utf8" });
    fs.unlinkSync(tmp);
    if (!r.error) assert.strictEqual(r.status, 0, "unzip -t: " + r.stdout + r.stderr);
  });
  await t("extOf and safeName", () => {
    assert.strictEqual(run('extOf("data:image/jpeg;base64,xx")'), "jpg");
    assert.strictEqual(run('extOf("data:video/mp4;base64,xx")'), "mp4");
    assert.strictEqual(run('extOf("https://x/y")'), "bin");
    assert.strictEqual(run('safeName("a/b:c*?")'), "a_b_c__");
    assert.strictEqual(run('safeName("")'), "chat");
  });
  await t("base64 helpers round trip", () => {
    const b = new Uint8Array(300).map((_, i) => i * 7);
    sb.__b = b;
    assert.deepStrictEqual(Array.from(run("fromB64(toB64(__b))")), Array.from(b));
  });
  const { webcrypto } = require("crypto");
  const kp = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
  const pubB64 = Buffer.from(await webcrypto.subtle.exportKey("raw", kp.publicKey)).toString("base64");
  // PBKDF2 at 1,000,000 iterations is slow but real: it is what the phone runs
  await t("key backup seal/open round trip (v2, bound to account and mode)", async () => {
    sb.__kp = kp; sb.__pub = pubB64;
    const row = await run('sealKeyBackup(__kp.privateKey, __pub, "correct horse", "login")');
    assert.strictEqual(row.iters, 1000000);
    assert.strictEqual(row.mode, "login");
    assert.ok(!JSON.stringify(row).includes("\"d\":"), "no private key material in the row");
    sb.__row = row;
    const rec = await run('openKeyBackup(__row, "correct horse")');
    assert.strictEqual(rec.pub, pubB64);
    await assert.rejects(run('openKeyBackup(__row, "wrong")'));
    sb.__row2 = Object.assign({}, row, { mode: "recovery" });
    await assert.rejects(run('openKeyBackup(__row2, "correct horse")'), "mode is bound in as extra data");
    vm.runInContext("sbUser = { id: 'other' }", sb);
    await assert.rejects(run('openKeyBackup(__row, "correct horse")'), "account is bound in as extra data");
    vm.runInContext("sbUser = { id: '11111111-2222-3333-4444-555555555555' }", sb);
  });
  await t("key backup: password is NFKC normalised", async () => {
    sb.__kp = kp; sb.__pub = pubB64;
    sb.__row = await run('sealKeyBackup(__kp.privateKey, __pub, "caf\\u00e9", "recovery")');
    await run('openKeyBackup(__row, "cafe\\u0301")');
  });
  await t("key backup: old v1 format (SHA-256, 600000, no extra data) still opens", async () => {
    const jwk = await webcrypto.subtle.exportKey("jwk", kp.privateKey);
    const salt = webcrypto.getRandomValues(new Uint8Array(16)), iv = webcrypto.getRandomValues(new Uint8Array(12));
    const base = await webcrypto.subtle.importKey("raw", Buffer.from("pw1"), "PBKDF2", false, ["deriveKey"]);
    const key = await webcrypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, Buffer.from(JSON.stringify(jwk))));
    sb.__old = { salt: Buffer.from(salt).toString("base64"), iv: Buffer.from(iv).toString("base64"), ct: Buffer.from(ct).toString("base64"), iters: 600000, pub: pubB64 };
    assert.strictEqual((await run('openKeyBackup(__old, "pw1")')).pub, pubB64);
  });
  await t("note seal/open round trip, with and without record id binding", async () => {
    const key = await webcrypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    sb.__key = key;
    const obj = { t: "title ☃", b: "body", n: [1, 2, 3] };
    sb.__obj = obj;
    const s = await run('noteSeal(__key, __obj, "rid-1")');
    assert.ok(s.startsWith("e2e1:"));
    sb.__s = s;
    assert.deepStrictEqual(await run('noteOpen(__key, __s, "rid-1")'), obj);
    await assert.rejects(run('noteOpen(__key, __s, "rid-2")'), "bound to the record id");
    const legacy = await run("noteSeal(__key, __obj)");
    sb.__l = legacy;
    assert.deepStrictEqual(await run('noteOpen(__key, __l, "rid-9")'), obj);
    assert.ok(run('legacySeen.has("rid-9")'), "legacy copy is noticed");
    assert.notStrictEqual(await run("noteSeal(__key, __obj)"), legacy, "fresh iv every time");
  });
  await t("saved-login token seal/open (rtSeal, rtOpen)", async () => {
    const s = await run('rtSeal("refresh-token-abc")');
    assert.ok(s.startsWith(run("RT_PFX")) && !s.includes("refresh-token-abc"));
    sb.__s = s;
    assert.strictEqual(await run("rtOpen(__s)"), "refresh-token-abc");
    assert.strictEqual(await run("rtSeal(__s)"), s, "already sealed values are left alone");
    assert.strictEqual(await run('rtOpen("plain")'), "plain");
    assert.strictEqual(await run('rtOpen(RT_PFX + "AAAA")'), "", "garbage opens to empty, not a throw");
    assert.strictEqual(await run('rtSeal("")'), "");
  });
  console.log(fails ? fails + " unit test(s) failed" : "all unit tests passed");
  process.exit(fails ? 1 : 0);
})();
