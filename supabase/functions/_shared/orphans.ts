// Orphan sweeper: files in the storage buckets that nothing in the database refers to any more are moved (not deleted)
// into ban-archive/orphans/<bucket>/<path>; copies older than 14 days are then removed for good.
// Every doubt aborts the whole run. Nothing outside the "orphans/" prefix of ban-archive is ever touched.
// deno-lint-ignore-file no-explicit-any

const BUCKETS = ["media", "dm-media"];
const ARCHIVE = "ban-archive";
const PREFIX = "orphans/";
const MIN_AGE_MS = 2 * 3600 * 1000;
const KEEP_MS = 14 * 24 * 3600 * 1000;
const MAX_FILES = 500;
const PAGE = 1000;
const DEADLINE_MS = 110 * 1000;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp("^" + UUID + "$", "i");
const PATH_RE = new RegExp(UUID + "/[^\\s\"'\\\\?#)<>,]+", "gi");
const SEG_RE = /\/([^\/\s"'\\?#<>,]{4,200})/g;
const EXT_RE = /[A-Za-z0-9_-]{2,200}\.[A-Za-z0-9]{2,6}(?![A-Za-z0-9])/g;

// every table that can hold a storage url/path, with a stable order for paging (whole rows are scanned, so no column is missed)
const TABLES: { table: string; order: string[] }[] = [
  { table: "accounts", order: ["id"] },                                   // avatar, banner, ...
  { table: "posts", order: ["id"] },                                      // media_url / media list
  { table: "messages", order: ["id"] },                                   // media jsonb [{url,iv,type}]
  { table: "notes_self", order: ["owner_id", "id"] },                     // media jsonb [{url,...}]
  { table: "zenith_docs", order: ["owner_id", "kind", "doc_id"] },        // data jsonb (photos, 'd' paths)
  { table: "ban_archive", order: ["user_id"] },                           // snapshot of banned accounts
];

export type SweepOpts = { apply?: boolean; force?: boolean };

function addText(s: string, paths: Set<string>, names: Set<string>) {
  const texts = [s];
  if (s.includes("%")) { try { texts.push(decodeURIComponent(s)); } catch { /* keep raw */ } }
  if (s.includes("\\/")) texts.push(s.replace(/\\\//g, "/"));
  for (const t of texts) {
    for (const m of t.matchAll(PATH_RE)) paths.add(m[0].toLowerCase());
    for (const m of t.matchAll(SEG_RE)) names.add(m[1].toLowerCase());
    for (const m of t.matchAll(EXT_RE)) names.add(m[0].toLowerCase());
  }
}

async function buildReferenced(admin: any): Promise<{ paths: Set<string>; names: Set<string>; rows: Record<string, number> }> {
  const paths = new Set<string>(), names = new Set<string>(), rows: Record<string, number> = {};
  for (const { table, order } of TABLES) {
    let got = 0, total: number | null = null;
    for (let from = 0; ; from += PAGE) {
      let q = admin.from(table).select("*", { count: "exact" });
      for (const o of order) q = q.order(o, { ascending: true });
      const { data, error, count } = await q.range(from, from + PAGE - 1);
      if (error) throw new Error("query " + table + ": " + (error.message || error.code || "failed"));
      if (typeof count !== "number") throw new Error("query " + table + ": no row count");
      if (total === null) total = count; else if (total !== count) throw new Error("table " + table + " changed while it was read");
      const list: any[] = data || [];
      for (const r of list) addText(JSON.stringify(r), paths, names);
      got += list.length;
      if (list.length < PAGE) break;
    }
    // a page that came back short or truncated must never pass for the whole table
    if (got !== total) throw new Error("table " + table + " incomplete: " + got + " of " + total);
    rows[table] = got;
  }
  return { paths, names, rows };
}

async function listPage(admin: any, bucket: string, folder: string, offset: number): Promise<any[]> {
  const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
  if (error) throw new Error("list " + bucket + "/" + folder + ": " + (error.message || "failed"));
  return data || [];
}

async function listAll(admin: any, bucket: string, folder: string): Promise<any[]> {
  const out: any[] = [];
  for (let off = 0; ; off += 100) {
    const rows = await listPage(admin, bucket, folder, off);
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

const age = (o: any): number => {
  const t = Date.parse(o.created_at || "");
  return Number.isFinite(t) ? Date.now() - t : -1; // unknown time = not eligible
};

async function copyAndRemove(admin: any, bucket: string, paths: string[]): Promise<{ moved: number; failed: number }> {
  let moved = 0, failed = 0;
  for (let i = 0; i < paths.length; i += 20) {
    const done: string[] = [];
    await Promise.all(paths.slice(i, i + 20).map(async (p) => {
      const { error } = await admin.storage.from(bucket).copy(p, PREFIX + bucket + "/" + p, { destinationBucket: ARCHIVE });
      if (!error || /already exists|Duplicate/i.test(error.message || "")) done.push(p); else failed++;
    }));
    if (done.length) {
      const { data, error } = await admin.storage.from(bucket).remove(done);
      if (error) failed += done.length; else { moved += (data || []).length; failed += Math.max(0, done.length - (data || []).length); }
    }
  }
  return { moved, failed };
}

// quarantined copies older than 14 days go for good; only paths under orphans/ are listed or removed
async function dropOld(admin: any, apply: boolean): Promise<{ expired: number; removed: number; samples: string[] }> {
  const old: string[] = [];
  const t0 = Date.now();
  outer: for (const bucket of BUCKETS) {
    const base = PREFIX.slice(0, -1) + "/" + bucket;
    for (const f of await listAll(admin, ARCHIVE, base)) {
      if (f.id || !UUID_RE.test(f.name)) continue;
      for (const o of await listAll(admin, ARCHIVE, base + "/" + f.name)) {
        if (!o.id) continue;
        if (age(o) > KEEP_MS) old.push(base + "/" + f.name + "/" + o.name);
        if (old.length >= MAX_FILES || Date.now() - t0 > DEADLINE_MS) break outer;
      }
    }
  }
  const safe = old.filter((p) => p.startsWith(PREFIX) && !p.includes(".."));
  let removed = 0;
  if (apply) {
    for (let i = 0; i < safe.length; i += 100) {
      const { data, error } = await admin.storage.from(ARCHIVE).remove(safe.slice(i, i + 100));
      if (error) throw new Error("remove quarantine: " + (error.message || "failed"));
      removed += (data || []).length;
    }
  }
  return { expired: safe.length, removed, samples: safe.slice(0, 20) };
}

export async function sweepOrphans(admin: any, opts: SweepOpts): Promise<Record<string, unknown>> {
  const apply = opts.apply === true, force = opts.force === true;
  const res: Record<string, unknown> = { mode: "orphans", apply, force };
  const t0 = Date.now();
  try {
    const ref = await buildReferenced(admin);
    res.referenced = { paths: ref.paths.size, names: ref.names.size, rows: ref.rows };
    // a suspiciously empty reference set means something is wrong with the scan, never "delete everything"
    if (ref.paths.size + ref.names.size === 0) throw new Error("reference set is empty");

    const found: { bucket: string; path: string }[] = [];
    const stats: Record<string, { eligible: number; orphans: number }> = {};
    let partial = false;
    scan: for (const bucket of BUCKETS) {
      stats[bucket] = { eligible: 0, orphans: 0 };
      for (let off = 0; ; off += 100) {
        const folders = await listPage(admin, bucket, "", off);
        for (const f of folders) {
          if (f.id || !UUID_RE.test(f.name)) continue; // only <user_id>/<name>
          for (const o of await listAll(admin, bucket, f.name)) {
            if (!o.id || !o.name) continue;
            const a = age(o);
            if (a < MIN_AGE_MS) continue;
            stats[bucket].eligible++;
            const full = (f.name + "/" + o.name).toLowerCase();
            if (ref.paths.has(full) || ref.names.has(String(o.name).toLowerCase())) continue;
            stats[bucket].orphans++;
            found.push({ bucket, path: f.name + "/" + o.name });
          }
          if (found.length >= MAX_FILES || Date.now() - t0 > DEADLINE_MS) { partial = true; break scan; }
        }
        if (folders.length < 100) break;
      }
    }
    // the cap is a hard limit per run: keep the first MAX_FILES
    const batch = found.slice(0, MAX_FILES);
    const eligible = BUCKETS.reduce((n, b) => n + stats[b].eligible, 0);
    res.per_bucket = stats;
    res.partial_scan = partial;
    res.would_quarantine = batch.length;
    res.samples = batch.slice(0, 20).map((x) => x.bucket + "/" + x.path);

    if (batch.length > 30 && batch.length / Math.max(1, eligible) > 0.5 && !force) {
      throw new Error("more than 50% of " + eligible + " eligible files would be quarantined (" + batch.length + "); repeat with force:true if that is right");
    }

    const old = await dropOld(admin, apply);
    res.expired_quarantine = { count: old.expired, removed: old.removed, samples: old.samples };

    if (apply) {
      const done: Record<string, { moved: number; failed: number }> = {};
      for (const bucket of BUCKETS) {
        const ps = batch.filter((x) => x.bucket === bucket).map((x) => x.path);
        done[bucket] = ps.length ? await copyAndRemove(admin, bucket, ps) : { moved: 0, failed: 0 };
      }
      res.quarantined = done;
    }
    res.aborted = null;
  } catch (e) {
    res.aborted = String((e as Error).message || e);
  }
  return res;
}
