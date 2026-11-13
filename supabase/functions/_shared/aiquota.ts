// The daily request count of every Gemini model, kept in the database (see the migration ai_usage) so the limit holds however many
// copies of a function run, and starts again at the exact moment Google's own daily count does: midnight Pacific time.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type Entry = { model: string; limit: number };

// "model:limit,model:limit" (the secrets of the functions); a limit that is missing or wrong means 19
export function parseChain(text: string): Entry[] {
  return text.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const [model, n] = s.split(":");
    return { model: model.trim(), limit: Number(n) > 0 ? Math.floor(Number(n)) : 19 };
  }).filter((e) => e.model);
}

// true when one more request may be sent to this model today. When the database cannot answer (the function is not installed yet)
// the request is allowed, so a missing table never stops the chat
export async function useModel(admin: SupabaseClient, model: string, limit: number): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc("nook_ai_use", { p_model: model, p_limit: limit, p_want: 1 });
    if (error) return true;
    return typeof data === "number" ? data > 0 : true;
  } catch { return true; }
}

// Google refused a request because the day's limit is used up: no more requests to this model until the reset
export async function markFull(admin: SupabaseClient, model: string, limit: number): Promise<void> {
  try { await admin.rpc("nook_ai_full", { p_model: model, p_limit: limit }); } catch { /* the next request finds out again */ }
}

// whether the text of a 429 answer is about the day's limit and not the minute's
export const dailyLimitHit = (text: string) => /per\s*day|perday|daily/i.test(text);
