// Zenith calls the owner: a push to the phone (type call) through send-push, which holds the Firebase keys. The phone rings for 30 seconds.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export async function ringPhone(admin: SupabaseClient, owner: string, reason: string): Promise<boolean> {
  try {
    const { data: secret } = await admin.rpc("nook_purge_secret");
    if (typeof secret !== "string" || !secret) return false;
    const r = await fetch(Deno.env.get("SUPABASE_URL")! + "/functions/v1/send-push", {
      method: "POST",
      headers: { "content-type": "application/json", "x-purge-secret": secret },
      body: JSON.stringify({ call: { user_id: owner, reason: reason.slice(0, 200) } }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok && Number(j.sent) > 0;
  } catch { return false; }
}
