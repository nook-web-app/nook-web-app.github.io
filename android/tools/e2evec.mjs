// Makes test vectors with the web app's own WebCrypto code (copied from app.js), so the native lock is checked against it:
//   node tools/e2evec.mjs > tools/fixture/e2e.json        (make)
//   node tools/e2evec.mjs check app/build/e2e-out.json   (open what the native side sealed)
import { webcrypto as wc } from "node:crypto";
import fs from "node:fs";
const crypto = wc;
const E2E_ALG = { name: "ECDH", namedCurve: "P-256" };
const toB64 = u8 => Buffer.from(u8).toString("base64");
const fromB64 = s => new Uint8Array(Buffer.from(s, "base64"));
const KDF_ITERS = 1000000, KDF_OLD_MAX = 600000;
const kbV2 = iters => iters > KDF_OLD_MAX;
async function recoveryKey(pw, salt, iters) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iters, hash: kbV2(iters) ? "SHA-512" : "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
const kbAad = (uid, mode) => new TextEncoder().encode("nook-key-backup-v2:" + uid + ":" + mode);
async function sealKeyBackup(uid, priv, pub, pw, mode) {
  const jwk = await crypto.subtle.exportKey("jwk", priv);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await recoveryKey(pw, salt, KDF_ITERS);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: kbAad(uid, mode) }, key, new TextEncoder().encode(JSON.stringify(jwk)));
  return { user_id: uid, mode, salt: toB64(salt), iv: toB64(iv), ct: toB64(new Uint8Array(ct)), iters: KDF_ITERS, pub };
}
async function openKeyBackup(uid, row, pw) {
  const key = await recoveryKey(pw, fromB64(row.salt), row.iters);
  const alg = { name: "AES-GCM", iv: fromB64(row.iv) };
  if (kbV2(row.iters)) alg.additionalData = kbAad(uid, row.mode || "recovery");
  const plain = await crypto.subtle.decrypt(alg, key, fromB64(row.ct));
  const jwk = JSON.parse(new TextDecoder().decode(plain));
  const priv = await crypto.subtle.importKey("jwk", jwk, E2E_ALG, true, ["deriveKey"]);
  const pubKey = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, ext: true }, E2E_ALG, true, []);
  const pub = toB64(new Uint8Array(await crypto.subtle.exportKey("raw", pubKey)));
  if (pub !== row.pub) throw new Error("mismatch");
  return { priv, pub };
}
const kp = async () => { const k = await crypto.subtle.generateKey(E2E_ALG, true, ["deriveKey"]); return { priv: k.privateKey, pub: toB64(new Uint8Array(await crypto.subtle.exportKey("raw", k.publicKey))) }; };
const shared = async (priv, pubB64) => crypto.subtle.deriveKey({ name: "ECDH", public: await crypto.subtle.importKey("raw", fromB64(pubB64), E2E_ALG, false, []) }, priv, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
async function sealText(key, text, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(aad ? { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) } : { name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
  return "e2e1:" + toB64(iv) + "." + toB64(new Uint8Array(ct));
}
async function openText(key, raw, aad) {
  const parts = raw.slice(5).split(".");
  const alg = aad ? { name: "AES-GCM", iv: fromB64(parts[0]), additionalData: new TextEncoder().encode(aad) } : { name: "AES-GCM", iv: fromB64(parts[0]) };
  return new TextDecoder().decode(await crypto.subtle.decrypt(alg, key, fromB64(parts[1])));
}
async function linkCode(pub) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", fromB64(pub)));
  let n = 0n;
  for (let i = 0; i < 9; i++) n = (n << 8n) | BigInt(d[i]);
  return String(n % 100000000000000000000n).padStart(20, "0").replace(/(\d{4})(?=\d)/g, "$1 ");
}
if (process.argv[2] === "check") {
  const v = JSON.parse(fs.readFileSync(new URL("./fixture/e2e.json", import.meta.url)));
  const o = JSON.parse(fs.readFileSync(process.argv[3]));
  const b = await crypto.subtle.importKey("jwk", v.b.jwk, E2E_ALG, true, ["deriveKey"]);
  const k = await shared(b, o.pub);
  const t = await openText(k, o.sealed);
  if (t !== v.text) throw new Error("text " + t);
  const t2 = await openText(k, o.sealedAad, "m:abc");
  if (t2 !== v.text) throw new Error("aad " + t2);
  const r = await openKeyBackup(v.uid, o.backup, v.pw);
  if (r.pub !== o.pub) throw new Error("backup pub");
  // the private key carried over works for ECDH too
  const k2 = await shared(r.priv, v.b.pub);
  if ((await openText(k2, o.sealed)) !== v.text) throw new Error("backup key");
  console.log("native output opens with WebCrypto");
} else {
  const a = await kp(), b = await kp();
  const uid = "8a5d16ec-1050-40d2-8a7d-bcb75dc75bba", pw = "Ünïcode pass wörd 123", text = "hi from the web uwu ⁣Z⁣ ✨";
  const k = await shared(a.priv, b.pub);
  const out = {
    uid, pw, text,
    a: { pub: a.pub, jwk: await crypto.subtle.exportKey("jwk", a.priv) },
    b: { pub: b.pub, jwk: await crypto.subtle.exportKey("jwk", b.priv) },
    sealed: await sealText(k, text),
    sealedAad: await sealText(k, text, "c:xyz"),
    backup: await sealKeyBackup(uid, a.priv, a.pub, pw, "login"),
    link: await linkCode(a.pub)
  };
  // the old weaker backup format (PBKDF2-SHA256, 600000 rounds, no extra data)
  {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await recoveryKey(pw, salt, 600000);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(await crypto.subtle.exportKey("jwk", a.priv))));
    out.oldBackup = { user_id: uid, mode: "recovery", salt: toB64(salt), iv: toB64(iv), ct: toB64(new Uint8Array(ct)), iters: 600000, pub: a.pub };
  }
  console.log(JSON.stringify(out, null, 1));
}
