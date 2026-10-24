import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

let key: CryptoKey | null = null;

// the plain password never goes to the login service: it is mixed with a secret that only the server knows first,
// so nobody can guess passwords by talking to the login service directly
export async function pepper(admin: SupabaseClient, password: string): Promise<string> {
  if (!key) {
    const { data } = await admin.rpc("nook_pepper");
    if (typeof data !== "string" || !data) throw new Error("no pepper");
    key = await crypto.subtle.importKey("raw", new TextEncoder().encode(data), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  }
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(password)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}
