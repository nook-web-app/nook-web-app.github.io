import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const VAPID_PUBLIC = "BHfuPbwRPzD71CGmJaEMX5eizbSknGd2rjSJIVO-9ahWUcsL6z-eEC_bhWCLloy0EdOEVyBoiLgQZjdaIrO5udA";
const SUBJECT = "https://github.com/haythamidk/nook.github.io";
const WHAT: Record<string, string> = {
  follow: "followed you",
  reply: "replied to your post",
  like: "liked your post",
  repost: "reposted your post",
  message: "sent you a message",
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

  const { data: n } = await admin.from("notifications").select("id, user_id, actor_id, kind, created_at").eq("id", id).maybeSingle();
  if (!n) return json({ sent: 0 });
  // a muted chat gets no alert
  if (n.kind === "message") {
    const { data: mu } = await admin.from("dm_mutes").select("owner_id, until_at, hidden").eq("owner_id", n.user_id).eq("target_id", n.actor_id).maybeSingle();
    if (mu && (mu.hidden || !mu.until_at || Date.parse(mu.until_at) > Date.now())) return json({ sent: 0, muted: true });
  }
  const { data: actor } = await admin.from("accounts").select("display_name, username, public_key").eq("id", n.actor_id).maybeSingle();
  const { data: subs } = await admin.from("push_subs").select("id, endpoint, p256dh, auth").eq("user_id", n.user_id);
  if (!subs || !subs.length) return json({ sent: 0 });

  const name = (actor && (actor.display_name || actor.username)) || "Someone";
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
    open: n.kind === "message" ? "dm:" + n.actor_id : "notifs",
    tag: n.kind + ":" + n.actor_id,
    ...msg,
  });

  let sent = 0;
  const dead: string[] = [];
  await Promise.all(subs.map(async (s) => {
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
