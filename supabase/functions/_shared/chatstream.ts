// The chat model is told it has a search tool. This looks at the start of its answer (a streamed one, or a whole answer that is not
// streamed) and says whether it asked for a search, and with which words. When it did not, the answer is handed back untouched, so a
// normal reply still streams to the phone as it is written.
type Part = { text?: unknown; thought?: unknown; functionCall?: { name?: unknown; args?: unknown } };
// deno-lint-ignore no-explicit-any
function partsOf(j: any): Part[] {
  const c = j && j.candidates && j.candidates[0];
  return c && c.content && Array.isArray(c.content.parts) ? c.content.parts : [];
}
function findSearch(parts: Part[]): { query: string } | null {
  for (const p of parts) {
    const fc = p && p.functionCall;
    if (fc && fc.name === "search") {
      const a = (fc.args || {}) as { query?: unknown };
      return { query: typeof a.query === "string" ? a.query.trim().slice(0, 200) : "" };
    }
  }
  return null;
}
// what was read so far is played again first, then the rest of the answer follows
function replay(seen: Uint8Array[], reader: ReadableStreamDefaultReader<Uint8Array> | null, status: number, type: string): Response {
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(c) {
      if (i < seen.length) { c.enqueue(seen[i++]); return; }
      if (!reader) { c.close(); return; }
      const { done, value } = await reader.read();
      if (done) c.close(); else c.enqueue(value!);
    },
    async cancel() { try { await reader?.cancel(); } catch { /* ignore */ } },
  });
  return new Response(body, { status, headers: { "content-type": type } });
}

// empty: the answer ended without a single written word (for example a thinking model that used all its room for thinking)
export async function peekForSearch(up: Response, stream: boolean): Promise<{ search: { query: string } | null; replay: Response | null; empty: boolean }> {
  const type = up.headers.get("content-type") || "application/json";
  if (!stream || !type.includes("text/event-stream") || !up.body) {
    const raw = await up.text();
    let j: unknown = null;
    try { j = JSON.parse(raw); } catch { /* not json: handed on as it is */ }
    const hit = findSearch(partsOf(j));
    if (hit) return { search: hit, replay: null, empty: false };
    const wrote = partsOf(j).some((p) => typeof p.text === "string" && p.text.trim() !== "" && !p.thought);
    // an answer that is not json (or an error body) is handed on as it is; only a real answer without words counts as empty
    return { search: null, replay: new Response(raw, { status: up.status, headers: { "content-type": type } }), empty: up.ok && j !== null && !wrote };
  }
  const reader = up.body.getReader();
  const dec = new TextDecoder();
  const seen: Uint8Array[] = [];
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen.push(value);
    buf += dec.decode(value, { stream: true });
    for (let m = /\r?\n\r?\n/.exec(buf); m; m = /\r?\n\r?\n/.exec(buf)) {
      const ev = buf.slice(0, m.index);
      buf = buf.slice(m.index + m[0].length);
      const data = ev.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (!data) continue;
      let j: unknown = null;
      try { j = JSON.parse(data); } catch { continue; }
      const parts = partsOf(j);
      const hit = findSearch(parts);
      if (hit) { try { await reader.cancel(); } catch { /* ignore */ } return { search: hit, replay: null, empty: false }; }
      // the first written words: it is a normal reply
      if (parts.some((p) => typeof p.text === "string" && p.text !== "" && !p.thought)) return { search: null, replay: replay(seen, reader, up.status, type), empty: false };
    }
  }
  return { search: null, replay: replay(seen, null, up.status, type), empty: true };
}
