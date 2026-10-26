import { createClient } from "npm:@supabase/supabase-js@2";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "npm:@simplewebauthn/server@13.1.1";
// Face ID and fingerprint sign in. The phone proves it holds the private key; only then does this make a session.

const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const mk = () => createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const RP_ID = "nook-web-app.github.io";
const ORIGIN = "https://nook-web-app.github.io";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
const toU8 = (s: string): Uint8Array => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const fromU8 = (u: Uint8Array): string => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// the challenge the phone signed is inside its client data
function challengeOf(resp: { response?: { clientDataJSON?: string } }): string {
  try { return JSON.parse(new TextDecoder().decode(toU8(String(resp.response!.clientDataJSON)))).challenge || ""; } catch { return ""; }
}
// a short fingerprint of the caller's network address (cf-connecting-ip, else the last proxy hop); the address itself is never stored
async function ipTag(req: Request): Promise<string | null> {
  const fwd = (req.headers.get("x-forwarded-for") || "").split(",").map((x) => x.trim()).filter(Boolean);
  const raw = (req.headers.get("cf-connecting-ip") || "").trim() || fwd[fwd.length - 1] || "";
  if (!raw) return null;
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("nook-ip|" + raw)));
  return Array.from(d.slice(0, 6), (b) => b.toString(16).padStart(2, "0")).join("");
}
async function keep(challenge: string, purpose: string, user: string | null, ip: string | null = null) {
  await admin.from("passkey_challenges").delete().lt("created_at", new Date(Date.now() - 5 * 60000).toISOString());
  const ins = await admin.from("passkey_challenges").insert({ challenge, purpose, user_id: user, ip });
  // before the ip column exists the insert is refused; store the row without it
  if (ins.error) await admin.from("passkey_challenges").insert({ challenge, purpose, user_id: user });
}
// a challenge made by the phone itself (32 bytes, the time in bytes 16 to 23): accepted when it is fresh and was never used before.
// Nothing has to be asked from this server before the phone's own window opens, so the window comes up at once.
async function claimFresh(challenge: string, ip: string | null): Promise<boolean> {
  let b: Uint8Array;
  try { b = toU8(challenge); } catch { return false; }
  if (b.length !== 32) return false;
  const age = Date.now() - new DataView(b.buffer, b.byteOffset, 32).getFloat64(16);
  if (!(age > -60000 && age < 5 * 60000)) return false;
  if (Math.random() < 0.1) await admin.from("passkey_challenges").delete().lt("created_at", new Date(Date.now() - 10 * 60000).toISOString());
  const ins = await admin.from("passkey_challenges").insert({ challenge, purpose: "auth", user_id: null, ip });
  if (!ins.error) return true;
  if (ins.error.code === "23505") return false;
  // before the ip column exists the insert is refused; store the row without it
  return !(await admin.from("passkey_challenges").insert({ challenge, purpose: "auth", user_id: null })).error;
}
// a challenge works once, for the right purpose, and only for a few minutes
async function take(challenge: string, purpose: string): Promise<{ user_id: string | null } | null> {
  if (!challenge) return null;
  const { data } = await admin.from("passkey_challenges").delete().eq("challenge", challenge).eq("purpose", purpose).gt("created_at", new Date(Date.now() - 5 * 60000).toISOString()).select("user_id").maybeSingle();
  return data || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body: { action?: string; response?: any; name?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  if (!body || typeof body !== "object") return json({ error: "bad_request" }, 400);
  try {
    // wakes this function up while the sign in page is open, so the real sign in does not wait for a cold start
    if (body.action === "ping") return json({ ok: true });
    if (body.action === "auth-start") {
      // a flood of sign in tries is slowed down
      const since = new Date(Date.now() - 60000).toISOString();
      const ip = await ipTag(req);
      if (ip) {
        // per address first, so one noisy caller cannot make everybody else wait
        const mine = await admin.from("passkey_challenges").select("challenge", { count: "exact", head: true }).eq("purpose", "auth").eq("ip", ip).gt("created_at", since);
        if (!mine.error && (mine.count || 0) > 30) return json({ error: "busy" }, 429);
      }
      const recent = await admin.from("passkey_challenges").select("challenge", { count: "exact", head: true }).eq("purpose", "auth").gt("created_at", since);
      if ((recent.count || 0) > 1000) return json({ error: "busy" }, 429);
      const o = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: "required", timeout: 60000 });
      await keep(o.challenge, "auth", null, ip);
      return json(o);
    }
    if (body.action === "auth-finish") {
      const resp = body.response;
      if (!resp || typeof resp.id !== "string") return json({ error: "bad_request" }, 400);
      const chal = challengeOf(resp);
      const [fresh, pkq] = await Promise.all([
        claimFresh(chal, await ipTag(req)),
        admin.from("passkeys").select("id, user_id, credential_id, public_key, counter, transports").eq("credential_id", resp.id).maybeSingle(),
      ]);
      if (!fresh) return json({ error: "expired" }, 400);
      const pk = pkq.data;
      if (!pk) return json({ error: "unknown_key" }, 404);
      let why = "";
      const v = await verifyAuthenticationResponse({
        response: resp, expectedChallenge: challengeOf(resp), expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: true,
        credential: { id: pk.credential_id, publicKey: toU8(pk.public_key), counter: Number(pk.counter), transports: pk.transports || undefined },
      }).catch((e) => { why = String((e as Error).message || e).slice(0, 140); return null; });
      if (!v || !v.verified) { console.error("verify", why || "not verified"); return json({ error: "failed" }, 401); }
      const [, ban, ur] = await Promise.all([
        admin.from("passkeys").update({ counter: v.authenticationInfo.newCounter }).eq("id", pk.id),
        admin.from("bans").select("user_id").eq("user_id", pk.user_id).maybeSingle(),
        admin.auth.admin.getUserById(pk.user_id),
      ]);
      if (ban.data) return json({ error: "banned" }, 403);
      const u = ur.data;
      if (!u || !u.user || !u.user.email) return json({ error: "failed" }, 401);
      // marks this sign in as made by a passkey, so signin never mistakes the session for a password reset link
      // (the marker and the link are made at the same time; the session is only made after both)
      const [, link] = await Promise.all([
        admin.auth.admin.updateUserById(pk.user_id, { app_metadata: { ...(u.user.app_metadata || {}), pk_at: Math.floor(Date.now() / 1000) } }).catch(() => {}),
        admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email }),
      ]);
      const hashed = link.data && link.data.properties ? link.data.properties.hashed_token : "";
      if (link.error || !hashed) { console.error("link", link.error ? link.error.message : "no token"); return json({ error: "server" }, 500); }
      // the newer name for a magic link is "email"; the old one is tried when it is refused
      let s = await mk().auth.verifyOtp({ token_hash: hashed, type: "email" });
      if (s.error || !s.data.session) {
        const code0 = String((s.error as { code?: string } | null)?.code || "");
        if (code0 === "user_banned") return json({ error: "banned" }, 403);
        const link2 = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
        const h2 = link2.data && link2.data.properties ? link2.data.properties.hashed_token : "";
        s = h2 ? await mk().auth.verifyOtp({ token_hash: h2, type: "magiclink" }) : s;
      }
      if (s.error || !s.data.session) {
        const code = String((s.error as { code?: string } | null)?.code || "");
        { console.error("otp", s.error ? s.error.message : "no session"); return json({ error: code === "user_banned" ? "banned" : "server" }, code === "user_banned" ? 403 : 500); }
      }
      return json({ session: { access_token: s.data.session.access_token, refresh_token: s.data.session.refresh_token } });
    }

    // adding a key needs a signed in person
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data, error } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null }, error: true };
    if (error || !data || !data.user) return json({ error: "not_signed_in" }, 401);
    const user = data.user;

    if (body.action === "reg-start") {
      const mineRes = await admin.from("passkeys").select("credential_id, transports").eq("user_id", user.id);
      if (mineRes.error) return json({ error: "server" }, 500);
      const mine = mineRes.data || [];
      if (mine.length >= 5) return json({ error: "too_many" }, 400);
      const o = await generateRegistrationOptions({
        rpName: "Nook", rpID: RP_ID, userName: user.email || user.id, userDisplayName: user.email || "Nook", userID: new TextEncoder().encode(user.id),
        attestationType: "none", timeout: 60000,
        excludeCredentials: mine.map((m: { credential_id: string; transports: string[] | null }) => ({ id: m.credential_id, transports: (m.transports || undefined) as never })),
        authenticatorSelection: { residentKey: "required", userVerification: "required", authenticatorAttachment: "platform" },
      });
      await keep(o.challenge, "reg", user.id);
      return json(o);
    }
    if (body.action === "reg-finish") {
      const resp = body.response;
      if (!resp || typeof resp.id !== "string") return json({ error: "bad_request" }, 400);
      const ch = await take(challengeOf(resp), "reg");
      if (!ch || ch.user_id !== user.id) return json({ error: "expired" }, 400);
      const v = await verifyRegistrationResponse({ response: resp, expectedChallenge: challengeOf(resp), expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: true }).catch(() => null);
      if (!v || !v.verified || !v.registrationInfo) return json({ error: "failed" }, 400);
      const c = v.registrationInfo.credential;
      const ins = await admin.from("passkeys").insert({ user_id: user.id, credential_id: c.id, public_key: fromU8(c.publicKey), counter: c.counter, transports: c.transports || null, name: String(body.name || "This device").slice(0, 40) });
      if (ins.error) return json({ error: ins.error.code === "23505" ? "already" : "server" }, 400);
      return json({ ok: true });
    }
    return json({ error: "bad_request" }, 400);
  } catch (e) {
    console.error("passkey", String((e as Error).message || e).slice(0, 120));
    return json({ error: "server" }, 500);
  }
});
