// Link preview fetching shared by the preview function and zenith-tick.
// https only, port 443 only, no addresses inside a network (checked on the name, on what it resolves to, and on every redirect hop),
// a time cap and a size cap on every page.
const MAX_HOPS = 4;
const MAX_BYTES = 512 * 1024;
const TOTAL_MS = 7000;

function v4Private(a: number[]): boolean {
  const [x, y] = a;
  return x === 0 || x === 10 || x === 127 || (x === 100 && y >= 64 && y <= 127) || (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31) ||
    (x === 192 && y === 168) || (x === 192 && y === 0) || (x === 198 && (y === 18 || y === 19)) || x >= 224;
}
export function privateIp(ip: string): boolean {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const m4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (m4) return v4Private(m4.slice(1).map(Number));
  if (s.includes(":")) {
    const mapped = /^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
    if (mapped) return v4Private(mapped.slice(1).map(Number));
    if (s.startsWith("::ffff:")) return true;
    if (s === "::" || s === "::1") return true;
    return /^(fc|fd|fe[89ab]|ff|64:ff9b|2001:db8|2002:)/.test(s);
  }
  return true;
}
// the address must be a public https page; names are resolved and every answer must be public
async function checkUrl(u: string): Promise<URL | null> {
  let x: URL;
  try { x = new URL(u); } catch { return null; }
  const h = x.hostname.toLowerCase();
  if (x.protocol !== "https:" || (x.port && x.port !== "443") || x.username || x.password) return null;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".") && !h.includes(":")) return null;
  if (/^[\d.]+$/.test(h) || h.startsWith("[") || h.includes(":")) return privateIp(h) ? null : x;
  try {
    const ips: string[] = [];
    const found = await Promise.all((["A", "AAAA"] as const).map(async (t) => {
      try { return (await Deno.resolveDns(h, t)) as string[]; } catch { return [] as string[]; /* no records of this type */ }
    }));
    for (const f of found) ips.push(...f);
    if (!ips.length || ips.some(privateIp)) return null;
  } catch { return null; }
  return x;
}
// one request that follows redirects by hand so every hop is checked again
async function get(u: string, accept: string, deadline: number): Promise<{ res: Response; url: URL } | null> {
  let cur: URL | null = await checkUrl(u);
  for (let hop = 0; cur && hop <= MAX_HOPS; hop++) {
    const left = deadline - Date.now();
    if (left < 300) return null;
    const res = await fetch(cur.href, { redirect: "manual", signal: AbortSignal.timeout(left), headers: { accept, "user-agent": "Mozilla/5.0 (compatible; NookPreview/1.0)" } });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      try { await res.body?.cancel(); } catch { /* ignore */ }
      if (!loc) return null;
      let next: string;
      try { next = new URL(loc, cur).href; } catch { return null; }
      cur = await checkUrl(next);
      continue;
    }
    return { res, url: cur };
  }
  return null;
}
async function readCapped(res: Response, max: number, deadline: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const parts: Uint8Array[] = [];
  let n = 0;
  while (n < max && Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    parts.push(value);
    n += value.length;
  }
  try { await reader.cancel(); } catch { /* ignore */ }
  const out = new Uint8Array(Math.min(n, max));
  let o = 0;
  for (const p of parts) { const take = Math.min(p.length, out.length - o); out.set(p.subarray(0, take), o); o += take; if (o >= out.length) break; }
  return out;
}
const decodeEnt = (s: string) => s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|#39);/gi, (_m, e: string) => {
  const l = e.toLowerCase();
  if (l === "amp") return "&"; if (l === "lt") return "<"; if (l === "gt") return ">"; if (l === "quot") return '"'; if (l === "apos") return "'";
  const c = l[1] === "x" ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
  try { return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ""; } catch { return ""; }
});
function metaOf(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\s+([^>]*?)\/?>/gi)) {
    const attrs: Record<string, string> = {};
    for (const a of m[1].matchAll(/([a-z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? "";
    const k = (attrs.property || attrs.name || "").toLowerCase();
    if (k && attrs.content && !(k in out)) out[k] = decodeEnt(attrs.content).trim();
  }
  return out;
}
export type Preview = { title: string; description: string; image: string; site: string };
export async function pagePreview(url: string): Promise<Preview | null> {
  const deadline = Date.now() + TOTAL_MS;
  try {
    const got = await get(url, "text/html,application/xhtml+xml", deadline);
    if (!got || !got.res.ok) return null;
    const type = (got.res.headers.get("content-type") || "").toLowerCase();
    if (type && !/text\/html|application\/xhtml/.test(type)) return null;
    const html = new TextDecoder("utf-8", { fatal: false }).decode(await readCapped(got.res, MAX_BYTES, deadline));
    const m = metaOf(html.slice(0, MAX_BYTES));
    const tt = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    const title = (m["og:title"] || m["twitter:title"] || (tt ? decodeEnt(tt[1]).replace(/\s+/g, " ").trim() : "")).slice(0, 300);
    const description = (m["og:description"] || m["twitter:description"] || m["description"] || "").slice(0, 600);
    let image = m["og:image"] || m["og:image:url"] || m["twitter:image"] || m["twitter:image:src"] || "";
    if (image) { try { const iu = new URL(image, got.url); image = iu.protocol === "https:" ? iu.href : ""; } catch { image = ""; } }
    if (image.length > 1000) image = "";
    if (!title && !image) return null;
    return { title, description, image, site: (m["og:site_name"] || "").slice(0, 120) || got.url.hostname.replace(/^www\./, "") };
  } catch { return null; }
}
// a small picture, for the model; null when it is not a safe public picture
export async function fetchImage(url: string, types: string[], max: number): Promise<{ type: string; bytes: Uint8Array } | null> {
  const deadline = Date.now() + 6000;
  try {
    const got = await get(url, "image/*", deadline);
    if (!got || !got.res.ok) return null;
    const type = (got.res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!types.includes(type)) return null;
    if (Number(got.res.headers.get("content-length") || 0) > max) return null;
    const bytes = await readCapped(got.res, max + 1, deadline);
    return bytes.length && bytes.length <= max ? { type, bytes } : null;
  } catch { return null; }
}
