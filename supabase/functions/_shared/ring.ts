// Zenith calls the owner: a push to the phone (type call) through send-push, which holds the Firebase keys. The phone rings for 30 seconds.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export async function ringPhone(admin: SupabaseClient, owner: string, reason: string): Promise<boolean> {
  try {
    const { data: secret } = await admin.rpc("nook_purge_secret");
    if (typeof secret !== "string" || !secret) return false;
    const r = await fetch(Deno.env.get("SUPABASE_URL")! + "/functions/v1/send-push", {
      method: "POST",
      headers: { "content-type": "application/json", "x-purge-secret": secret },
      body: JSON.stringify({ call: { user_id: owner, reason: reason.slice(0, 400) } }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await r.json().catch(() => ({}));
    // a note of what happened, so a ring that did not arrive can be looked up: select * from ai_usage where model like 'debug:ring%'
    try { await admin.rpc("nook_ai_full", { p_model: "debug:ring:" + new Date().toISOString().slice(11, 16) + ":" + r.status + ":sent " + (j.sent ?? "none") + (j.error ? ":" + String(j.error).slice(0, 40) : ""), p_limit: 1 }); } catch { /* only a note */ }
    return r.ok && Number(j.sent) > 0;
  } catch (e) {
    try { await admin.rpc("nook_ai_full", { p_model: "debug:ring:error:" + String((e as Error).message || e).replace(/[^\w .,:'-]+/g, " ").slice(0, 80), p_limit: 1 }); } catch { /* only a note */ }
    return false;
  }
}

// a heads up some minutes before a call: the phone looks for an app update and only says something when there is one
export async function warnPhone(admin: SupabaseClient, owner: string): Promise<void> {
  try {
    const { data: secret } = await admin.rpc("nook_purge_secret");
    if (typeof secret !== "string" || !secret) return;
    await fetch(Deno.env.get("SUPABASE_URL")! + "/functions/v1/send-push", {
      method: "POST",
      headers: { "content-type": "application/json", "x-purge-secret": secret },
      body: JSON.stringify({ precall: { user_id: owner } }),
      signal: AbortSignal.timeout(20000),
    });
  } catch { /* only a heads up */ }
}

// a text from Zenith that starts a chat: the phone puts it in the chat and shows it as a notification
export async function textPhone(admin: SupabaseClient, owner: string, text: string, id = ""): Promise<boolean> {
  try {
    const { data: secret } = await admin.rpc("nook_purge_secret");
    if (typeof secret !== "string" || !secret) return false;
    const r = await fetch(Deno.env.get("SUPABASE_URL")! + "/functions/v1/send-push", {
      method: "POST",
      headers: { "content-type": "application/json", "x-purge-secret": secret },
      body: JSON.stringify({ ztext: { user_id: owner, text: text.slice(0, 300), id } }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok && Number(j.sent) > 0;
  } catch { return false; }
}

// a small signal to the phone with nothing to show: he read the messages (zseen), or he changed whether calls are allowed (zperm)
export async function signalPhone(admin: SupabaseClient, owner: string, data: Record<string, string>): Promise<void> {
  try {
    const { data: secret } = await admin.rpc("nook_purge_secret");
    if (typeof secret !== "string" || !secret) return;
    await fetch(Deno.env.get("SUPABASE_URL")! + "/functions/v1/send-push", {
      method: "POST",
      headers: { "content-type": "application/json", "x-purge-secret": secret },
      body: JSON.stringify({ zsig: { user_id: owner, ...data } }),
      signal: AbortSignal.timeout(15000),
    });
  } catch { /* only a signal */ }
}
