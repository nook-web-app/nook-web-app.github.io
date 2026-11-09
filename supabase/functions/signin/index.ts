import { createClient } from "npm:@supabase/supabase-js@2";
import { pepper } from "./pepper.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const mk = () => createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MAX_TRIES = 5;
// all the tries on one email, from any place: far looser, so strangers cannot lock a person out with a few guesses
const MAX_TRIES_ALL = 200;
// all the failed tries from one place on any email: one stranger cannot spray or use up the email-wide count alone
const MAX_TRIES_IP = 30;
// the email-wide lock (only after many different places failed) starts short and is capped at 1 hour
const ALL_FIRST = 10;
const ALL_CAP = 60;
// the email-wide lock only applies once this many different places have failed on the email inside an hour
const ALL_MIN_IPS = 10;

// a short fingerprint of the caller's network address; the address itself is never stored
async function ipTag(req: Request): Promise<string> {
  // the first x-forwarded-for entry is written by the caller, so the last hop (added by the proxy) is used; cf-connecting-ip is not trusted, a caller can set it
  const fwd = (req.headers.get("x-forwarded-for") || "").split(",").map((x) => x.trim()).filter(Boolean);
  const raw = fwd[fwd.length - 1] || "none";
  if (raw === "none") return "none";
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("nook-ip|" + raw)));
  return Array.from(d.slice(0, 6), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function ipTag2(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("nook-dummy|" + s)));
  return Array.from(d.slice(0, 6), (b) => b.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
const iso = (t: unknown) => new Date(String(t)).toISOString();
const okEmail = (e: string) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// the only place that checks a password for the app. Every try is counted per email: 5 are free, then the waits grow 45 minutes, 90 minutes, 3 hours ... up to 48 hours.
// Passwords are stored mixed with a server secret (see pepper.ts), so the login service cannot be used to guess them directly.
// Actions: login (default), check (a signed in person proves the current password), signup, setpw (change or reset the password).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body: { action?: unknown; email?: unknown; password?: unknown; current?: unknown; check?: unknown; target?: unknown };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  if (!body || typeof body !== "object") return json({ error: "bad_request" }, 400);
  const ip = await ipTag(req);
  const action = typeof body.action === "string" ? body.action : body.check === true ? "check" : "login";
  const password = typeof body.password === "string" ? body.password : "";

  try {
    if (action === "signup") return await signup(typeof body.email === "string" ? body.email.trim().toLowerCase() : "", password, ip);

    // everything else needs an email: the one in the request (login) or the one of the signed in person
    let email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    let user: { id: string; email?: string } | null = null;
    let jwt = "";
    if (action !== "login") {
      jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const { data, error } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null }, error: true };
      if (error || !data || !data.user || !data.user.email) return json({ error: "not_signed_in" }, 401);
      user = data.user;
      email = data.user.email!.trim().toLowerCase();
    }

    // a linked account of the signed in person opens with its own password, checked with the same limits as a normal login
    if (action === "linked") {
      const target = typeof body.target === "string" && /^[0-9a-f-]{36}$/i.test(body.target) ? body.target : "";
      if (!target || !password) return json({ error: "bad_request" }, 400);
      const { data: link } = await admin.from("account_links").select("a").eq("a", user!.id).eq("b", target).maybeSingle();
      if (!link) return json({ error: "not_linked" }, 403);
      const { data: tu } = await admin.auth.admin.getUserById(target);
      const tEmail = tu && tu.user && tu.user.email ? tu.user.email.trim().toLowerCase() : "";
      if (!tEmail) return json({ error: "no_account" }, 404);
      const got = await proveOld(tEmail, password, ip);
      if (got instanceof Response) return got;
      return json({ session: { access_token: got.access_token, refresh_token: got.refresh_token } });
    }

    if (action === "setpw") {
      // spaces at the ends (usually from pasting) are not part of a password
      const next = password.trim();
      if (next.length < 8 || next.length > 72) return json({ error: "setpw_failed", message: "Password needs 8 to 72 characters." , code: "weak_password" }, 400);
      // somebody who just opened the link of a reset email may set a new password without the old one; everybody else must prove the old one
      if (!recovering(jwt, user)) {
        const current = typeof body.current === "string" ? body.current : "";
        if (!current) return json({ error: "no_password" }, 400);
        if (current.trim() === next) return json({ error: "setpw_failed", code: "same_password", message: "New password should be different from the old password." }, 400);
        const bad = await proveOld(email, current, ip);
        if (bad instanceof Response) return bad;
        // the password in use now counts as an old one too, from the first change on
        for (const c of new Set([current, current.trim()])) await admin.rpc("nook_pw_add", { p_user: user!.id, p_mixed: await pepper(admin, c), p_kind: "seed" });
      }
      const mixedNew = await pepper(admin, next);
      // no going back to an older password; a change once a week (a reset by email is not held to the week)
      const reset = recovering(jwt, user);
      const chk = await admin.rpc("nook_pw_check", { p_user: user!.id, p_mixed: mixedNew, p_week: !reset });
      if (chk.error) return json({ error: "server" }, 500);
      if (chk.data === "reused") return json({ error: "setpw_failed", code: "reused_password", message: "You already used this password before. Pick a new one." }, 400);
      if (typeof chk.data === "string" && chk.data.startsWith("week:")) {
        const until = chk.data.slice(5);
        const day = new Date(until).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
        return json({ error: "setpw_failed", code: "weekly_limit", until, message: "You can change your password once a week. Try again on " + day + "." }, 400);
      }
      const upd = await admin.auth.admin.updateUserById(user!.id, { password: mixedNew });
      if (upd.error) return json({ error: "setpw_failed", code: (upd.error as { code?: string }).code || "", message: upd.error.message }, 400);
      await admin.rpc("nook_pw_add", { p_user: user!.id, p_mixed: mixedNew, p_kind: reset ? "reset" : "change" });
      // changing the password ends the old sessions, so the person gets a fresh one
      const fresh = await mk().auth.signInWithPassword({ email, password: mixedNew });
      return json({ ok: true, session: fresh.data && fresh.data.session ? { access_token: fresh.data.session.access_token, refresh_token: fresh.data.session.refresh_token } : null });
    }

    if (!email) return json({ error: "no_email" }, 400);
    if (!okEmail(email)) return json({ error: "bad_email" }, 400);
    if (!password) return json({ error: "no_password" }, 400);
    const res = await proveOld(email, password, ip);
    if (res instanceof Response) return res;
    // an account that was just upgraded lost its sessions, so the person gets the fresh one
    if (action === "check") return json(res.upgraded ? { ok: true, session: { access_token: res.access_token, refresh_token: res.refresh_token } } : { ok: true });
    return json({ session: { access_token: res.access_token, refresh_token: res.refresh_token } });
  } catch (_e) {
    return json({ error: "server" }, 500);
  }
});

const wrong = (e: { code?: string; status?: number }) => String(e.code || "") === "invalid_credentials" || (!e.code && e.status === 400);

// true for a session that came from the link in a reset email, which GoTrue marks in the token (as "otp"; the app has no other sign in by link)
function recovering(jwt: string, user: { app_metadata?: Record<string, unknown> } | null): boolean {
  try {
    const part = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(part + "=".repeat((4 - (part.length % 4)) % 4)));
    const now = Date.now() / 1000;
    const pk = Number(user && user.app_metadata ? user.app_metadata.pk_at : 0) || 0;
    return Array.isArray(claims.amr) && claims.amr.some((a: { method?: string; timestamp?: number }) => {
      if (!a || (a.method !== "recovery" && a.method !== "otp")) return false;
      const t = Number(a.timestamp || 0);
      // a session that a passkey sign in just made carries the same "otp" mark, but it is not a reset
      if (pk && t >= pk - 5 && t <= pk + 60) return false;
      return now - t < 3600;
    });
  } catch { return false; }
}

async function signup(email: string, password0: string, ip: string): Promise<Response> {
  const password = password0.trim();
  if (!email) return json({ error: "no_email" }, 400);
  if (!okEmail(email)) return json({ error: "bad_email" }, 400);
  if (password.length < 8 || password.length > 72) return json({ error: "signup_failed", code: "weak_password", message: "Password needs 8 to 72 characters." }, 400);
  // per place cap, so accounts cannot be made in bulk from one address
  if (ip !== "none") {
    const g = await admin.rpc("nook_login_gate", { p_key: "s:" + ip, p_max: 20 });
    if (g.error) return json({ error: "server" }, 500);
    if (g.data) return json({ error: "locked", until: iso(g.data) }, 429);
  }
  const { data, error } = await mk().auth.signUp({ email, password: await pepper(admin, password) });
  if (error) {
    const code = (error as { code?: string }).code || "";
    // a taken email gets the same answer as any other failure, so signup cannot be used to find out who has an account
    if (code === "email_exists" || code === "user_already_exists" || /already (been )?registered/i.test(error.message)) return json({ error: "signup_failed", code: "", message: "Could not sign up. Try again later.", status: 400 }, 400);
    return json({ error: "signup_failed", code, message: error.message, status: (error as { status?: number }).status || 400 }, 400);
  }
  return json({ user: { id: data.user ? data.user.id : null }, session: data.session ? { access_token: data.session.access_token, refresh_token: data.session.refresh_token } : null });
}

// counts the try, checks the password, answers with a Response when something is wrong and with the session when it is right
async function proveOld(email: string, password: string, ip: string): Promise<Response | { access_token: string; refresh_token: string; upgraded: boolean }> {
  if (password.length > 200) return json({ error: "wrong_password", left: 0 }, 401);
  // the strict count is per email and place, so somebody far away cannot use up the tries of the real owner
  const key = "e:" + email + "|" + ip;
  const all = "a:" + email;
  // per-place tier over every email (skipped when no address is known, so unknown callers do not share one bucket)
  const perIp = ip === "none" ? "" : "i:" + ip;
  const gate = await admin.rpc("nook_login_gate", { p_key: key, p_max: MAX_TRIES });
  if (gate.error) return json({ error: "server" }, 500);
  if (gate.data) return json({ error: "locked", until: iso(gate.data) }, 429);
  if (perIp) {
    const gateIp = await admin.rpc("nook_login_gate", { p_key: perIp, p_max: MAX_TRIES_IP });
    if (gateIp.error) return json({ error: "server" }, 500);
    if (gateIp.data) return json({ error: "locked", until: iso(gateIp.data) }, 429);
  }
  // the email-wide lock is for an attack from many places; one place (or a few) can never lock the real owner out for everyone
  const spread = await admin.rpc("nook_login_distinct_ips", { p_key: email, p_window: "1 hour" });
  const wide = !spread.error && typeof spread.data === "number" && spread.data >= ALL_MIN_IPS;
  if (wide) {
    const gateAll = await admin.rpc("nook_login_gate", { p_key: all, p_max: MAX_TRIES_ALL, p_first: ALL_FIRST, p_cap: ALL_CAP });
    if (gateAll.error) return json({ error: "server" }, 500);
    if (gateAll.data) return json({ error: "locked", until: iso(gateAll.data) }, 429);
  }

  const miss = async (error: string, status: number) => {
    const [f, , g, gi] = await Promise.all([
      admin.rpc("nook_login_fail", { p_key: key, p_max: MAX_TRIES }),
      perIp ? admin.rpc("nook_login_note_ip", { p_key: email, p_ip: ip }) : null,
      wide ? admin.rpc("nook_login_fail", { p_key: all, p_max: MAX_TRIES_ALL, p_first: ALL_FIRST, p_cap: ALL_CAP }) : { data: null },
      // the place count is never reset by a success, so a sprayer cannot clear it by signing in to an account of its own
      perIp ? admin.rpc("nook_login_fail", { p_key: perIp, p_max: MAX_TRIES_IP }) : null,
    ]);
    const rowIp = gi ? (Array.isArray(gi.data) ? gi.data[0] : gi.data) : null;
    const row = Array.isArray(f.data) ? f.data[0] : f.data;
    const rowAll = Array.isArray(g.data) ? g.data[0] : g.data;
    if (rowIp && rowIp.locked_until) return json({ error: "locked", until: iso(rowIp.locked_until) }, 429);
    if (rowAll && rowAll.locked_until) return json({ error: "locked", until: iso(rowAll.locked_until) }, 429);
    if (row && row.locked_until) return json({ error: "locked", until: iso(row.locked_until) }, 429);
    return json({ error, left: Math.max(0, MAX_TRIES - (row ? row.used : MAX_TRIES)) }, status);
  };

  const found = await admin.rpc("nook_find_user", { ident: email });
  if (found.error) return json({ error: "server" }, 500);
  if (!found.data) {
    // same answer and similar work as a wrong password, so the reply does not tell whether the email has an account
    await pepper(admin, password);
    await mk().auth.signInWithPassword({ email: "nobody-" + (await ipTag2(email)) + "@invalid.example", password: "x".repeat(64) }).catch(() => {});
    await mk().auth.signInWithPassword({ email: "nobody-" + (await ipTag2(email)) + "@invalid.example", password: "x".repeat(64) }).catch(() => {});
    return await miss("wrong_password", 401);
  }

  const mixed = await pepper(admin, password);
  let upgraded = false;
  let r = await mk().auth.signInWithPassword({ email, password: mixed });
  if (r.error && wrong(r.error)) {
    // an account that was not upgraded yet still has its plain password stored: if that one fits, upgrade it now
    r = await mk().auth.signInWithPassword({ email, password });
    if (!r.error && r.data.user) {
      const up = await admin.auth.admin.updateUserById(r.data.user.id, { password: mixed });
      // the upgrade ends every session that exists, so a fresh one is made
      if (!up.error) { r = await mk().auth.signInWithPassword({ email, password: mixed }); upgraded = true; }
    }
  }
  if (r.error && wrong(r.error) && password !== password.trim() && password.trim()) {
    const m2 = await pepper(admin, password.trim());
    const r2 = await mk().auth.signInWithPassword({ email, password: m2 });
    if (!r2.error) r = r2;
  }
  if (r.error) {
    const code = String((r.error as { code?: string }).code || "");
    // a banned or unconfirmed account got its password right, so that is not a wrong try
    if (code === "user_banned" || /banned/i.test(r.error.message || "")) { await admin.rpc("nook_login_ok", { p_key: key }); return json({ error: "banned" }, 403); }
    if (code === "email_not_confirmed") { await admin.rpc("nook_login_ok", { p_key: key }); return json({ error: "not_confirmed" }, 403); }
    if (wrong(r.error)) return await miss("wrong_password", 401);
    if (code === "over_request_rate_limit" || (r.error as { status?: number }).status === 429) return json({ error: "busy" }, 429);
    return json({ error: "server" }, 500);
  }
  await Promise.all([
    admin.rpc("nook_login_ok", { p_key: key }),
    admin.rpc("nook_login_ok", { p_key: all }),
    admin.rpc("nook_login_clear_ips", { p_key: email }),
  ]);
  return { access_token: r.data.session!.access_token, refresh_token: r.data.session!.refresh_token, upgraded };
}
