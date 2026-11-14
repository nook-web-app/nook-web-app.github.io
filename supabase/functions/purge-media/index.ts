import { createClient } from "npm:@supabase/supabase-js@2";
import { sweepOrphans } from "../_shared/orphans.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const BUCKETS = ["media", "dm-media"];
const ARCHIVE = "ban-archive";
let cached: string | null = null;

async function expectedSecret(): Promise<string | null> {
  if (cached) return cached;
  const { data } = await admin.rpc("nook_purge_secret");
  cached = typeof data === "string" && data ? data : null;
  return cached;
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function removeAll(bucket: string, paths: string[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const { data, error } = await admin.storage.from(bucket).remove(chunk);
    if (error) throw error;
    n += (data || []).length;
  }
  return n;
}

async function folderFiles(bucket: string, folder: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 100, offset });
    if (error) throw error;
    const rows = data || [];
    rows.forEach((r) => { if (r.id) out.push(folder + "/" + r.name); });
    if (rows.length < 100) break;
  }
  return out;
}

// copy everything a banned account owns into the private archive bucket; the originals go too, except chat photos (the chats stay, so their photos stay)
async function archiveUser(user: string): Promise<{ copied: number; removed: number; failed: number; partial: boolean }> {
  let copied = 0, removed = 0, failed = 0;
  await Promise.all(BUCKETS.map(async (bucket) => {
    const files = await folderFiles(bucket, user);
    const done: string[] = [];
    // many copies at the same time
    for (let i = 0; i < files.length; i += 25) {
      await Promise.all(files.slice(i, i + 25).map(async (f) => {
        const dest = user + "/" + bucket + "/" + f.slice(user.length + 1);
        const { error } = await admin.storage.from(bucket).copy(f, dest, { destinationBucket: ARCHIVE });
        if (!error || /already exists|Duplicate/i.test(error.message || "")) { done.push(f); copied++; } else failed++;
      }));
    }
    if (done.length && bucket !== "dm-media") {
      const n = await removeAll(bucket, done);
      removed += n;
      // originals that could not be removed after the copy also make the archive run partial
      failed += Math.max(0, done.length - n);
    }
  }));
  return { copied, removed, failed, partial: failed > 0 };
}

// the 30 days are over: remove the archived copies
async function dropArchive(user: string): Promise<number> {
  let n = 0;
  for (const bucket of BUCKETS) {
    const folder = user + "/" + bucket;
    for (let pass = 0; pass < 50; pass++) {
      const files = await folderFiles(ARCHIVE, folder);
      if (!files.length) break;
      const r = await removeAll(ARCHIVE, files);
      n += r;
      if (!r) break;
    }
  }
  return n;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const want = await expectedSecret();
  const got = req.headers.get("x-purge-secret") || "";
  if (!want || !same(want, got)) return json({ error: "forbidden" }, 403);

  let body: { mode?: string; apply?: boolean; force?: boolean; bucket?: string; paths?: unknown; user_id?: string | null; action?: string };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  if (!body || typeof body !== "object") return json({ error: "bad json" }, 400);
  if (body.mode === "orphans") return json(await sweepOrphans(admin, { apply: body.apply === true, force: body.force === true }));
  if (body.action === "archive" || body.action === "drop_archive") {
    if (typeof body.user_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.user_id)) return json({ error: "bad user" }, 400);
    try {
      if (body.action === "archive") return json(await archiveUser(body.user_id));
      return json({ removed: await dropArchive(body.user_id) });
    } catch (e) {
      return json({ error: String((e as Error).message || e) }, 500);
    }
  }
  const bucket = String(body.bucket || "");
  if (!BUCKETS.includes(bucket)) return json({ error: "bad bucket" }, 400);

  let removed = 0;
  try {
    if (typeof body.user_id === "string" && /^[0-9a-f-]{36}$/i.test(body.user_id)) {
      let files = await folderFiles(bucket, body.user_id);
      for (let pass = 0; files.length && pass < 50; pass++) {
        const n = await removeAll(bucket, files);
        removed += n;
        if (!n) break;
        files = await folderFiles(bucket, body.user_id);
      }
    }
    const paths = Array.isArray(body.paths) ? body.paths.filter((p): p is string => typeof p === "string" && p.length > 0 && !p.includes("..")) : [];
    if (paths.length) removed += await removeAll(bucket, paths);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
  return json({ removed });
});
