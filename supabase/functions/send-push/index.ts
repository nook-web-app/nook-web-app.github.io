import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { SignJWT, importPKCS8 } from "npm:jose@5.9.6";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const VAPID_PUBLIC = "BHfuPbwRPzD71CGmJaEMX5eizbSknGd2rjSJIVO-9ahWUcsL6z-eEC_bhWCLloy0EdOEVyBoiLgQZjdaIrO5udA";
const SUBJECT = "https://github.com/haythamidk/nook.github.io";
const WHAT: Record<string, string> = {
  follow: "followed you",
  reply: "replied to your post",
  like: "liked your post",
  repost: "reposted your post",
  message: "sent you a message",
  post: "posted something new",
};
let secretCache: string | null = null;
let ready = false;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function setup(): Promise<boolean> {
  if (ready) return true;
  const { data } = await admin.rpc("nook_vapid_private");
  if (typeof data !== "string" || !data) return false;
  webpush.setVapidDetails(SUBJECT, VAPID_PUBLIC, data);
  ready = true;
  return true;
}

// Android phones: Firebase Cloud Messaging (HTTP v1). The service account of the Firebase project is a secret of this function.
let fcmTok: { t: string; exp: number } | null = null;
let fcmSa: { client_email: string; private_key: string; project_id: string } | null = null;
async function fcmToken(): Promise<string | null> {
  if (fcmTok && fcmTok.exp > Date.now() + 60000) return fcmTok.t;
  if (!fcmSa) { try { fcmSa = JSON.parse(Deno.env.get("FCM_SERVICE_ACCOUNT") || ""); } catch { return null; } }
  if (!fcmSa || !fcmSa.private_key) return null;
  const key = await importPKCS8(fcmSa.private_key, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" }).setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(fcmSa.client_email).setSubject(fcmSa.client_email).setAudience("https://oauth2.googleapis.com/token").setIssuedAt(now).setExpirationTime(now + 3000).sign(key);
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }) });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) return null;
  fcmTok = { t: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3000) * 1000 };
  return fcmTok.t;
}
// the phone builds the notification itself from this data (the words of a chat message are never sent)
async function sendFcm(tokens: { token: string }[], data: Record<string, string>): Promise<{ sent: number; dead: string[] }> {
  const at = await fcmToken();
  if (!at || !fcmSa) return { sent: 0, dead: [] };
  let sent = 0;
  const dead: string[] = [];
  await Promise.all(tokens.map(async (t) => {
    try {
      const r = await fetch("https://fcm.googleapis.com/v1/projects/" + fcmSa!.project_id + "/messages:send", {
        method: "POST", headers: { authorization: "Bearer " + at, "content-type": "application/json" },
        body: JSON.stringify({ message: { token: t.token, data, android: { priority: "HIGH", ttl: "3600s" } } }),
      });
      if (r.ok) sent++;
      else if (r.status === 404 || r.status === 400) { const j = await r.json().catch(() => ({})); const st = JSON.stringify(j); if (/UNREGISTERED|INVALID_ARGUMENT|NOT_FOUND/.test(st)) dead.push(t.token); }
    } catch (_e) { /* the next notification tries again */ }
  }));
  return { sent, dead };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!secretCache) {
    const { data } = await admin.rpc("nook_purge_secret");
    secretCache = typeof data === "string" ? data : null;
  }
  const got = req.headers.get("x-purge-secret") || "";
  if (!secretCache || !same(secretCache, got)) return json({ error: "forbidden" }, 403);
  if (!(await setup())) return json({ error: "push keys missing" }, 500);

  let body: { notification_id?: string };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  if (!body || typeof body !== "object") return json({ error: "bad json" }, 400);
  const id = String(body.notification_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "bad id" }, 400);

  const { data: n } = await admin.from("notifications").select("id, user_id, actor_id, kind, post_id, created_at").eq("id", id).maybeSingle();
  if (!n) return json({ sent: 0 });
  // a muted chat gets no alert
  if (n.kind === "message") {
    const { data: mu } = await admin.from("dm_mutes").select("owner_id, until_at, hidden").eq("owner_id", n.user_id).eq("target_id", n.actor_id).maybeSingle();
    if (mu && (mu.hidden || !mu.until_at || Date.parse(mu.until_at) > Date.now())) return json({ sent: 0, muted: true });
  }
  const { data: actor } = await admin.from("accounts").select("display_name, username, public_key").eq("id", n.actor_id).maybeSingle();
  const { data: subs } = await admin.from("push_subs").select("id, endpoint, p256dh, auth").eq("user_id", n.user_id);
  const { data: fcm } = await admin.from("fcm_tokens").select("token").eq("user_id", n.user_id);
  if ((!subs || !subs.length) && (!fcm || !fcm.length)) return json({ sent: 0 });

  const name = (actor && (actor.display_name || actor.username)) || "Someone";
  // a tap opens what the notification is about: the chat, the post (a reply, a like, a repost, a new post), or the person
  const open = n.kind === "message" ? "dm:" + n.actor_id
    : n.post_id && ["reply", "like", "repost", "post"].includes(n.kind) ? "post:" + n.post_id
    : n.kind === "follow" ? "user:" + n.actor_id : "notifs";
  const msg: Record<string, unknown> = {};
  if (n.kind === "message") {
    // the words of a chat message stay end to end encrypted: only the sealed text goes along, and the phone opens it with its own key
    const { data: m } = await admin.from("messages").select("body, media").eq("sender_id", n.actor_id).eq("recipient_id", n.user_id).lte("created_at", n.created_at).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (m) {
      const text = typeof m.body === "string" ? m.body : "";
      const hasPhoto = Array.isArray(m.media) && m.media.length > 0;
      if (!text) { if (hasPhoto) msg.photo = true; }
      else if (text.startsWith("e2e1:")) {
        const a = actor;
        if (text.length <= 2400 && a && a.public_key) { msg.enc = text; msg.key = a.public_key; msg.uid = n.user_id; }
      }
    }
  }
  const payload = JSON.stringify({
    title: name,
    body: WHAT[n.kind] || "sent you something",
    open,
    tag: n.kind + ":" + n.actor_id,
    ...msg,
  });

  let sent = 0;
  const dead: string[] = [];
  if (fcm && fcm.length) {
    const r = await sendFcm(fcm, { title: name, body: WHAT[n.kind] || "sent you something", open, id: n.id });
    sent += r.sent;
    if (r.dead.length) await admin.from("fcm_tokens").delete().in("token", r.dead);
  }
  await Promise.all((subs || []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: "high" });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) dead.push(s.id);
    }
  }));
  if (dead.length) await admin.from("push_subs").delete().in("id", dead);
  return json({ sent, removed: dead.length });
});
