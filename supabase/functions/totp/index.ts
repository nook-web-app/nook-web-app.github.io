import { createClient } from "npm:@supabase/supabase-js@2";
import { pepper } from "./pepper.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP = 30;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const GENERIC = "Wrong code, or too many tries. Wait 15 minutes and try again.";

// seed encryption at rest: "enc1:" + base64(iv + AES-GCM ciphertext), key derived from the env TOTP_ENC_KEY.
// Without the env var nothing is encrypted; plain seeds from before are still read and are encrypted on first use.
const ENC = "enc1:";
let encKey: CryptoKey | null = null;
async function getEncKey(): Promise<CryptoKey | null> {
  const raw = Deno.env.get("TOTP_ENC_KEY");
  if (!raw) return null;
  if (!encKey) {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("nook-totp|" + raw));
    encKey = await crypto.subtle.importKey("raw", d, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  }
  return encKey;
}
async function sealSecret(plain: string): Promise<string> {
  const k = await getEncKey();
  if (!k) return plain;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(plain)));
  const all = new Uint8Array(12 + ct.length);
  all.set(iv); all.set(ct, 12);
  return ENC + btoa(String.fromCharCode(...all));
}
// returns the plain seed, or null when it cannot be read (encrypted but no key, or a wrong key)
async function openSecret(stored: string): Promise<string | null> {
  if (!stored.startsWith(ENC)) return stored;
  const k = await getEncKey();
  if (!k) return null;
  try {
    const all = Uint8Array.from(atob(stored.slice(ENC.length)), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, k, all.slice(12)));
  } catch { return null; }
}

// a short fingerprint of the caller's network address (cf-connecting-ip, else the last proxy hop; never the caller-written first entry)
async function ipTag(req: Request): Promise<string> {
  const fwd = (req.headers.get("x-forwarded-for") || "").split(",").map((x) => x.trim()).filter(Boolean);
  const raw = (req.headers.get("cf-connecting-ip") || "").trim() || fwd[fwd.length - 1] || "none";
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("nook-ip|" + raw)));
  return Array.from(d.slice(0, 6), (b) => b.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function b32encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function b32decode(s: string): Uint8Array {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of s.replace(/=+$/, "").toUpperCase()) {
    const i = B32.indexOf(c);
    if (i < 0) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setBigUint64(0, BigInt(counter));
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, buf));
  const off = sig[19] & 15;
  const bin = ((sig[off] & 0x7f) << 24) | (sig[off + 1] << 16) | (sig[off + 2] << 8) | sig[off + 3];
  return String(bin % 1000000).padStart(6, "0");
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// returns the matching time step or null; steps at or before lastCounter are refused so a code cannot be used twice
async function check(secretB32: string, code: string, lastCounter: number | null): Promise<number | null> {
  if (!secretB32) return null;
  const secret = b32decode(secretB32);
  const now = Math.floor(Date.now() / 1000 / STEP);
  let hit: number | null = null;
  for (const d of [-1, 0, 1]) {
    const c = now + d;
    const ok = same(await hotp(secret, c), code);
    if (ok && (lastCounter == null || c > lastCounter)) hit = c;
  }
  return hit;
}

type Row = { user_id: string; secret: string; enabled: boolean; failed_attempts: number; locked_until: string | null; last_counter: number | null };

async function getRow(id: string): Promise<Row | null> {
  const { data } = await admin.from("totp_secrets").select("*").eq("user_id", id).maybeSingle();
  const row = (data as Row) || null;
  if (!row) return null;
  const stored = row.secret;
  const plain = await openSecret(stored);
  if (plain == null) return { ...row, secret: "" };
  row.secret = plain;
  // an old plain seed is encrypted the first time it is read (only when the key is set and the row has not changed)
  if (!stored.startsWith(ENC) && (await getEncKey())) {
    await admin.from("totp_secrets").update({ secret: await sealSecret(plain) }).eq("user_id", id).eq("secret", stored);
  }
  return row;
}

function lockedNow(row: Row): boolean {
  return !!row.locked_until && Date.parse(row.locked_until) > Date.now();
}

// every try is counted before the code is looked at, in one database step, so many guesses sent at once still hit the lock
async function attempt(row: Row): Promise<boolean> {
  const { data } = await admin.rpc("nook_totp_attempt", { p_user: row.user_id });
  return data === true;
}

// a code is used up by one request only; false means another request already used it
async function claim(row: Row, counter: number, enable = false): Promise<boolean> {
  const { data } = await admin.rpc("nook_totp_claim", { p_user: row.user_id, p_counter: counter, p_enable: enable });
  return data === true;
}

async function userFrom(req: Request) {
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data, error } = await admin.auth.getUser(jwt);
  return error || !data.user ? null : data.user;
}

const cleanCode = (v: unknown) => String(v ?? "").replace(/\s+/g, "");
const validCode = (v: string) => /^\d{6}$/.test(v);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  if (!body || typeof body !== "object") return json({ error: "bad json" }, 400);
  const action = String(body.action || "");

  if (action === "recover") {
    const ident = String(body.ident || "").trim();
    const code = cleanCode(body.code);
    const password = String(body.password || "");
    if (!ident || !validCode(code)) return json({ error: GENERIC }, 400);
    if (password.length < 8 || password.length > 72) return json({ error: "Password needs 8 to 72 characters." }, 400);
    const found = await admin.rpc("nook_find_user", { ident });
    const id = typeof found.data === "string" ? found.data : null;
    const row = id ? await getRow(id) : null;
    if (!row || !row.enabled || !(await attempt(row))) {
      await check("AAAAAAAAAAAAAAAA", code, null);
      return json({ error: GENERIC }, 400);
    }
    const hit = await check(row.secret, code, row.last_counter);
    if (hit == null || !(await claim(row, hit))) return json({ error: GENERIC }, 400);
    const upd = await admin.auth.admin.updateUserById(row.user_id, { password: await pepper(admin, password) });
    if (upd.error) return json({ error: "Could not set the new password." }, 400);
    return json({ ok: true });
  }

  // sends the reset link to the email on the account; the answer is the same whether or not the account exists
  if (action === "reset") {
    const ident = String(body.ident || "").trim();
    // only a link back into the app is allowed
    const redirectTo = typeof body.redirectTo === "string" && body.redirectTo.length < 300 && /^https:\/\/nook-web-app\.github\.io(\/|$)/.test(body.redirectTo) ? body.redirectTo : undefined;
    // everything below runs after the answer is ready, so the reply time is the same whether or not the account exists
    const work = (async () => {
      // a few reset mails per person, then a wait, so nobody can fill an inbox
      const usable = ident.length > 0 && ident.length <= 100;
      if (!usable) return;
      const slow = (await admin.rpc("nook_login_gate", { p_key: "r:" + ident.toLowerCase(), p_max: 3 })).data;
      if (slow) return;
      await admin.rpc("nook_login_fail", { p_key: "r:" + ident.toLowerCase(), p_max: 3 });
      const found = await admin.rpc("nook_find_user", { ident });
      const id = typeof found.data === "string" ? found.data : null;
      if (id) {
        const { data } = await admin.auth.admin.getUserById(id);
        const email = data && data.user ? data.user.email : null;
        if (email) await admin.auth.resetPasswordForEmail(email, { redirectTo }).catch(() => {});
      }
    })().catch(() => {});
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    if (rt && typeof rt.waitUntil === "function") rt.waitUntil(work); else await work;
    return json({ ok: true });
  }

  // tells the reset screen whether to offer the authenticator option
  if (action === "has") {
    const ident = String(body.ident || "").trim();
    if (!ident || ident.length > 100) return json({ enabled: false });
    // each place may ask only so often, so the answer cannot be used to list which people use an authenticator
    const hk = "h:" + (await ipTag(req));
    const hl = await admin.rpc("nook_login_gate", { p_key: hk, p_max: 20, p_first: 5, p_cap: 60 });
    if (hl.data) return json({ enabled: false });
    await admin.rpc("nook_login_fail", { p_key: hk, p_max: 20, p_first: 5, p_cap: 60 });
    const found = await admin.rpc("nook_find_user", { ident });
    const id = typeof found.data === "string" ? found.data : null;
    const r = id ? await getRow(id) : null;
    return json({ enabled: !!(r && r.enabled) });
  }

  const user = await userFrom(req);
  if (!user) return json({ error: "not signed in" }, 401);
  const row = await getRow(user.id);

  if (action === "status") return json({ enabled: !!(row && row.enabled) });

  if (action === "begin") {
    if (row && row.enabled) return json({ error: "Authenticator is already on. Turn it off first." }, 400);
    // starting needs a fresh proof of the password: required when TOTP_BEGIN_NEEDS_PASSWORD=1, checked whenever the app sends one
    const pw = typeof body.password === "string" ? body.password : "";
    if (pw || Deno.env.get("TOTP_BEGIN_NEEDS_PASSWORD") === "1") {
      if (!pw || pw.length > 200 || !user.email) return json({ error: "Enter your password to continue." }, 400);
      const pk = "t:" + user.id;
      const lk = await admin.rpc("nook_login_gate", { p_key: pk, p_max: 5 });
      if (lk.data) return json({ error: GENERIC }, 429);
      const probe = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
      const pr = await probe.auth.signInWithPassword({ email: user.email, password: await pepper(admin, pw) });
      if (pr.error || !pr.data.session) { await admin.rpc("nook_login_fail", { p_key: pk, p_max: 5 }); return json({ error: "That password is wrong." }, 400); }
      await admin.rpc("nook_login_ok", { p_key: pk });
    }
    const secret = b32encode(crypto.getRandomValues(new Uint8Array(20)));
    const { data: acc } = await admin.from("accounts").select("username").eq("id", user.id).maybeSingle();
    const label = encodeURIComponent("Nook:" + ((acc && acc.username) || user.email || "account"));
    const uri = "otpauth://totp/" + label + "?secret=" + secret + "&issuer=Nook&algorithm=SHA1&digits=6&period=" + STEP;
    const { error } = await admin.from("totp_secrets").upsert({ user_id: user.id, secret: await sealSecret(secret), enabled: false, failed_attempts: 0, locked_until: null, last_counter: null });
    if (error) return json({ error: "Could not start the setup. Try again." }, 500);
    return json({ secret, uri });
  }

  const code = cleanCode(body.code);
  if (action === "enable" || action === "disable") {
    if (!row) return json({ error: "Start the setup first." }, 400);
    if (action === "enable" && row.enabled) return json({ ok: true });
    if (action === "disable" && !row.enabled) return json({ ok: true });
    if (!validCode(code)) return json({ error: "Enter the 6 digit code." }, 400);
    if (!(await attempt(row))) return json({ error: GENERIC }, 400);
    const hit = await check(row.secret, code, row.last_counter);
    if (hit == null || !(await claim(row, hit, action === "enable"))) return json({ error: "That code is wrong." }, 400);
    if (action === "enable") return json({ ok: true });
    await admin.from("totp_secrets").delete().eq("user_id", user.id);
    return json({ ok: true });
  }

  return json({ error: "unknown action" }, 400);
});
