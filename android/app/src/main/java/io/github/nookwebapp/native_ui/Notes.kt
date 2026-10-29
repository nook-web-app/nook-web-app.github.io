package io.github.nookwebapp.native_ui

import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

// Notes to self, kept on every phone of the account: each chat and each message is one row of notes_self that the
// server cannot read (sealed with the account's own chat key and bound to its row id), like the web app's notes sync.
// The settings, the saved posts and the lists travel the same way (x:ui, x:saved, x:lists), and the replies that only
// live on this phone (p:<id>).

private fun h(s: String): String { var a = 0x811c9dc5.toInt(); var b = 0x5bd1e995; s.forEachIndexed { i, c -> a = (a xor c.code) * 16777619; b = ((b xor c.code) * 0x01000193) + i }; return s.length.toString(36) + "-" + Integer.toUnsignedString(a, 36) + "-" + Integer.toUnsignedString(b, 36) }
private fun canon(v: Any?): String = when (v) {
    null, JSONObject.NULL -> "null"
    is JSONObject -> "{" + v.keys().asSequence().sorted().joinToString(",") { JSONObject.quote(it) + ":" + canon(v.opt(it)) } + "}"
    is JSONArray -> "[" + (0 until v.length()).joinToString(",") { canon(v.opt(it)) } + "]"
    is String -> JSONObject.quote(v)
    is Number -> if (v.toDouble() == Math.floor(v.toDouble()) && !v.toDouble().isInfinite()) v.toLong().toString() else v.toString()
    else -> v.toString()
}
private fun cSig(c: LChat) = h("c|" + c.name + "|" + c.t)
private fun imgSig(m: LMsg) = m.imgs.joinToString(",") { h(it) }
private fun mSig(m: LMsg) = h("m|" + m.text + "|" + m.t + "|" + imgSig(m) + "|" + (m.rpost?.let { "${it.id}/${it.u}" } ?: "") + (m.zpost?.let { "${it.x}/${it.t}/${it.a}" } ?: ""))
private fun pSig(p: LPost) = h("p|" + p.text + "|" + p.t + "|" + (p.parent ?: "") + "|" + (if (p.liked) 1 else 0) + (if (p.reposted) 1 else 0) + (if (p.saved) 1 else 0))

private var notesOn = false
private var notesBusy = false
private var notesAgain = false
private var notesTimer: kotlinx.coroutines.Job? = null
private val noteFails = HashMap<String, Int>()
private val noteBad = HashMap<String, Int>()

private fun Online.ns(): JSONObject {
    val me = uid!!
    val n = s.notesSync
    if (n == null || n.optString("uid") != me) s.notesSync = JSONObject().put("uid", me).put("cursor", "").put("pushed", JSONObject()).put("pm", JSONObject())
    return s.notesSync!!
}

// what the settings, saved posts and lists look like as their rows (xDocs)
private fun Online.xDocs(): Map<String, JSONObject> = mapOf(
    "x:ui" to JSONObject().put("theme", s.themeName()).put("homeTab", s.homeTab).put("profTab", s.profTab).put("langs", s.langs?.let { JSONArray(it) } ?: JSONObject.NULL)
        .put("less", s.lessJson()).put("hidden", JSONArray(s.hidden.toList())).put("dmPins", JSONArray(s.dmPins.toList())),
    "x:saved" to JSONObject().put("ids", JSONArray((s.sv ?: emptySet()).sorted())),
    "x:lists" to JSONObject().put("lists", JSONArray(s.lists.map { l -> JSONObject().put("id", l.id).put("name", l.name).put("desc", l.desc).put("rids", JSONArray(l.ids.mapNotNull { idToRemote(it) })) })),
)

private fun Online.xApply(id: String, p: JSONObject, first: Boolean) {
    when (id) {
        "x:ui" -> {
            p.optStr("theme")?.let { s.theme = when (it) { "dark" -> ThemeMode.Dark; "light" -> ThemeMode.Light; else -> ThemeMode.System } }
            p.optStr("homeTab")?.let { s.homeTab = it }
            p.optStr("profTab")?.let { s.profTab = it }
            s.langs = p.optJSONArray("langs")?.strings()?.take(60)?.takeIf { it.isNotEmpty() }
            p.optJSONObject("less")?.let { l ->
                s.lessA.clear(); s.lessWords.clear()
                l.optJSONObject("a")?.let { a -> a.keys().forEach { k -> s.lessA[k] = a.optInt(k) } }
                l.optJSONObject("w")?.let { w -> w.keys().forEach { k -> s.lessWords[k] = w.optInt(k) } }
            }
            p.optJSONArray("hidden")?.let { s.hidden.clear(); s.hidden.addAll(it.strings().takeLast(300)) }
            p.optJSONArray("dmPins")?.let { s.dmPins.clear(); s.dmPins.addAll(it.strings().take(5)) }
        }
        "x:saved" -> {
            val next = (p.optJSONArray("ids")?.strings() ?: emptyList()).filter { Regex("^[0-9a-f-]{36}$", RegexOption.IGNORE_CASE).matches(it) }.toMutableSet()
            // the first time this phone meets the server copy, what was saved here stays too
            if (first) s.sv?.let { next.addAll(it) }
            s.sv = next
            s.posts.forEach { q -> q.remote?.let { q.saved = it in next } }
        }
        "x:lists" -> {
            val incoming = (p.optJSONArray("lists")?.objs() ?: emptyList()).filter { it.optString("id").isNotEmpty() }.map { l ->
                LList(l.optString("id"), l.optString("name").take(80), l.optString("desc").take(300), (l.optJSONArray("rids")?.strings() ?: emptyList()).map { remoteToId(it) })
            }
            if (first) incoming.forEach { l -> val ex = s.lists.firstOrNull { it.id == l.id }; if (ex == null) s.lists.add(l) else l.ids.forEach { i -> if (i !in ex.ids) ex.ids.add(i) } }
            else { s.lists.clear(); s.lists.addAll(incoming) }
        }
    }
}

private fun Online.privPosts(): List<LPost> {
    val withRemote = s.posts.filter { it.remote != null }.map { it.id }.toSet()
    return s.posts.filter { it.ra == null && !it.ai && it.remote == null && it.parent != null && it.parent !in withRemote }
}

private fun noteSeal(key: ByteArray, obj: JSONObject, rid: String) = Crypto.sealText(key, obj.toString(), rid)
private val legacySeen = HashSet<String>()
// noteOpen(): rows sealed before the id was bound to them are still opened, and sealed again on the next push
private fun noteOpen(key: ByteArray, raw: String, rid: String): JSONObject {
    val t = try { Crypto.openText(key, raw, rid) } catch (e: Exception) { Crypto.openText(key, raw).also { legacySeen.add(rid) } }
    return JSONObject(t)
}

// notePicIn(): a picture of a note is fetched, opened and kept as a photo of this phone
private suspend fun Online.notePicIn(key: ByteArray, md: JSONObject): String {
    val dir = s.mediaDir ?: throw IllegalStateException("no storage")
    val signed = signedFor(md.optString("url")) ?: throw IllegalStateException("gone")
    val raw = Sb.bytes(signed) ?: throw IllegalStateException("gone")
    val plain = Crypto.open(key, Crypto.unb64(md.optString("iv")), raw)
    val ext = when (md.optString("type")) { "image/png" -> "png"; "image/gif" -> "gif"; "image/webp" -> "webp"; else -> "jpg" }
    return withContext(kotlinx.coroutines.Dispatchers.IO) { File(dir, uid() + "." + ext).apply { writeBytes(plain) }.absolutePath }
}

// notePicOut(): a picture of a note goes up sealed with the account's own key
suspend fun Online.notePicOut(key: ByteArray, src: String): JSONObject {
    val me = uid ?: throw IllegalStateException("signed out")
    val b = withContext(kotlinx.coroutines.Dispatchers.IO) { Photos.bytesOf(src) } ?: throw IllegalStateException("photo not ready")
    val iv = Crypto.random(12)
    val path = "$me/notes/" + uid() + ".bin"
    Sb.upload("dm-media", path, Crypto.seal(key, iv, b), "application/octet-stream")?.let { throw IllegalStateException(it.message) }
    return JSONObject().put("url", Sb.publicUrl("dm-media", path)).put("iv", Crypto.b64(iv)).put("type", mimeOf(b))
}

private fun Online.findMsg(rid: String): Pair<LChat, LMsg>? { for (c in s.chats) c.msgs.firstOrNull { it.id == rid }?.let { return c to it }; return null }

// noteTake(): one row from the server into the notes on this phone; true when something changed
private suspend fun Online.noteTake(ns: JSONObject, key: ByteArray, r: JSONObject): Boolean {
    val rowId = r.optString("id")
    val pushed = ns.getJSONObject("pushed"); val pm = ns.getJSONObject("pm")
    if (rowId.startsWith("x:")) return noteExtra(ns, key, r)
    if (rowId.startsWith("p:")) return notePriv(ns, key, r)
    val isChat = rowId.startsWith("c:"); val rid = rowId.substring(2)
    val here = if (isChat) s.chats.any { it.id == rid } else findMsg(rid) != null
    if (r.optBoolean("deleted")) {
        if (isChat) {
            val c = s.chats.firstOrNull { it.id == rid }
            if (c != null && c.isNotes && pushed.optString(rowId) == cSig(c)) { s.chats.remove(c); pushed.put(rowId, "gone"); return true }
        } else {
            val f = findMsg(rid)
            if (f != null && f.first.isNotes && pushed.optString(rowId) == mSig(f.second)) { f.first.msgs.remove(f.second); pushed.put(rowId, "gone"); pm.remove(rowId); return true }
        }
        if (!here) pushed.remove(rowId)
        return false
    }
    // a note this phone already knew but no longer has was removed here: the removal goes up, it is not brought back
    if (pushed.has(rowId) && !here) return false
    val p = noteOpen(key, r.optString("body"), rowId)
    if (isChat) {
        var c = s.chats.firstOrNull { it.id == rid }
        if (c != null && (!c.isNotes || pushed.optString(rowId) != cSig(c))) return false
        val name = p.optString("n", "Notes to self").ifEmpty { "Notes to self" }.take(200); val t = p.optLong("t").takeIf { it > 0 } ?: System.currentTimeMillis()
        if (c != null && c.name == name && c.t == t) return false
        if (c == null) { c = LChat(rid, name, t); s.chats.add(c) } else { c.name = name; c.t = t }
        pushed.put(rowId, cSig(c))
        return true
    }
    val cid = p.optString("c").ifEmpty { return false }
    var c = s.chats.firstOrNull { it.id == cid }
    if (c != null && !c.isNotes) return false
    val fm = findMsg(rid)
    var m = if (c != null && fm != null && fm.first === c) fm.second else null
    if (m != null && pushed.optString(rowId) != mSig(m)) return false
    val text = p.optString("x"); val t = p.optLong("t").takeIf { it > 0 } ?: System.currentTimeMillis()
    val media = r.optJSONArray("media") ?: JSONArray()
    val have = pm.optJSONObject(rowId)
    val rp = p.optJSONObject("rp")?.let { o -> o.optString("id").takeIf { Regex("^[0-9a-f-]{36}$", RegexOption.IGNORE_CASE).matches(it) }?.let { RPost(it, o.optStr("u")) } }
    val zp = p.optJSONObject("zp")?.let { o -> if (o.has("x")) ZPost(o.optString("x").take(600), o.optLong("t").takeIf { it > 0 } ?: System.currentTimeMillis(), o.optStr("a")?.takeIf { it.startsWith("$SB_URL/storage/v1/object/public/media/") && it.length < 400 }) else null }
    if (m != null && m.text == text && m.t == t && have != null && canon(have.optJSONArray("e")) == canon(media) && m.rpost == rp && m.zpost == zp) return false
    // a photo that cannot be fetched stops the pull here (unless it has been missing for three rounds in a row)
    val imgs = ArrayList<String>()
    for (md in media.objs()) {
        try { imgs.add(notePicIn(key, md)) } catch (e: Exception) { if (!(e.message == "gone" && (noteFails[rowId] ?: 0) >= 3)) throw e }
    }
    if (c == null) { c = LChat(cid, "Notes to self", t); s.chats.add(c); pushed.put("c:$cid", cSig(c)) }
    noteFails.remove(rowId)
    if (m == null) {
        m = LMsg(rid, text, t, imgs, rpost = rp, zpost = zp)
        val at = c.msgs.indexOfFirst { it.t > t }
        if (at < 0) c.msgs.add(m) else c.msgs.add(at, m)
    } else { m.text = text; m.t = t; m.imgs = imgs; m.rpost = rp; m.zpost = zp }
    pushed.put(rowId, mSig(m))
    pm.put(rowId, JSONObject().put("h", imgSig(m)).put("e", media))
    return true
}

private fun Online.noteExtra(ns: JSONObject, key: ByteArray, r: JSONObject): Boolean {
    val id = r.optString("id")
    val docs = xDocs()
    if (r.optBoolean("deleted") || !docs.containsKey(id)) return false
    val pushed = ns.getJSONObject("pushed")
    val known = pushed.optStr(id); val cur = docs[id]!!
    // changed on this phone since the last sync: this phone wins and the change goes up
    if (known != null && known != h(canon(cur))) return false
    val p = noteOpen(key, r.optString("body"), id)
    if (canon(p) == canon(cur)) { pushed.put(id, h(canon(cur))); return false }
    xApply(id, p, known == null)
    pushed.put(id, h(canon(xDocs()[id])))
    ns.put("extra", true)
    return true
}

private fun Online.notePriv(ns: JSONObject, key: ByteArray, r: JSONObject): Boolean {
    val rowId = r.optString("id"); val lid = rowId.substring(2)
    val pushed = ns.getJSONObject("pushed")
    val here = s.byId(lid)
    if (r.optBoolean("deleted")) {
        if (here != null && here.remote == null && pushed.optString(rowId) == pSig(here)) { s.posts.remove(here); pushed.put(rowId, "gone"); return true }
        if (here == null) pushed.remove(rowId)
        return false
    }
    if (pushed.has(rowId) && here == null) return false
    if (here != null && pushed.optString(rowId) != pSig(here)) return false
    val p = noteOpen(key, r.optString("body"), rowId)
    val text = p.optString("x").take(5000); val t = p.optLong("t").takeIf { it > 0 } ?: System.currentTimeMillis(); val pa = p.optStr("pa")
    if (here != null) {
        if (here.text == text && here.t == t && here.parent == pa && here.liked == p.optBoolean("l") && here.reposted == p.optBoolean("r") && here.saved == p.optBoolean("s")) return false
        here.text = text; here.parent = pa; here.liked = p.optBoolean("l"); here.reposted = p.optBoolean("r"); here.saved = p.optBoolean("s")
        pushed.put(rowId, pSig(here)); return true
    }
    val np = LPost(lid, text, t, emptyList(), pa, p.optBoolean("l"), p.optBoolean("r"), 0, p.optBoolean("s"))
    s.posts.add(np)
    pushed.put(rowId, pSig(np))
    return true
}

// notesPull(): every row changed since the last pull (with a little overlap), page by page
private suspend fun Online.notesPull(ns: JSONObject, key: ByteArray): Boolean {
    var changed = false; var stuck = false; var okRows = 0
    ns.put("pullOk", false)
    val cursor = ns.optString("cursor")
    val from = if (cursor.isNotEmpty()) isoOf(parseIso(cursor) - 300_000) else "1970-01-01T00:00:00Z"
    var off = 0
    while (off < 40_000) {
        val r = Sb.get(Q("notes_self").select("id, body, media, deleted, updated_at").gte("updated_at", from).order("updated_at").order("id").range(off, off + 499))
        if (!r.ok) throw IllegalStateException(r.error?.message)
        signBatch(r.rows.flatMap { it.optJSONArray("media")?.objs() ?: emptyList() }.filter { it.has("iv") }.take(24))
        for (row in r.rows) {
            val id = row.optString("id")
            try { if (noteTake(ns, key, row)) changed = true; noteBad.remove(id); okRows++ }
            catch (e: Exception) {
                if (e.message == "gone") noteFails[id] = (noteFails[id] ?: 0) + 1
                val unreadable = e.message == "gone" || e is javax.crypto.AEADBadTagException || e is org.json.JSONException
                val n = (noteBad[id] ?: 0) + 1
                noteBad[id] = n
                if (!unreadable || n < 5) return changed
                stuck = true; continue
            }
            if (legacySeen.remove(id) && ns.getJSONObject("pushed").has(id) && ns.getJSONObject("pushed").optString(id) != "gone") ns.getJSONObject("pushed").put(id, "reseal")
            val up = row.optString("updated_at")
            if (!stuck && (ns.optString("cursor").isEmpty() || parseIso(up) > parseIso(ns.optString("cursor")))) ns.put("cursor", up)
        }
        if (r.rows.size < 500) break
        off += 500
    }
    if (stuck && okRows == 0) return changed
    ns.put("pullOk", true)
    return changed
}

// notesPush(): what changed here goes up; what was removed here is marked removed there
private suspend fun Online.notesPush(ns: JSONObject, key: ByteArray): Boolean {
    val me = uid ?: return false
    var did = false
    val pushed = ns.getJSONObject("pushed"); val pm = ns.getJSONObject("pm")
    val exist = HashSet<String>()
    s.chats.forEach { c -> exist.add("c:" + c.id); c.msgs.forEach { exist.add("m:" + it.id) } }
    xDocs().keys.forEach { exist.add(it) }
    val priv = privPosts()
    priv.forEach { exist.add("p:" + it.id) }
    class Todo(val id: String, val sig: String, val c: LChat, val m: LMsg?)
    val todo = ArrayList<Todo>()
    s.chats.filter { it.isNotes }.forEach { c ->
        if (pushed.optString("c:" + c.id) != cSig(c)) todo.add(Todo("c:" + c.id, cSig(c), c, null))
        c.msgs.forEach { m -> if (pushed.optString("m:" + m.id) != mSig(m)) todo.add(Todo("m:" + m.id, mSig(m), c, m)) }
    }
    val gone = pushed.keys().asSequence().filter { pushed.optString(it) != "gone" && it !in exist }.toList()
    val stale = ArrayList<String>()
    for (part in todo.chunked(20)) {
        val rows = JSONArray(); val done = ArrayList<Pair<Todo, JSONObject?>>()
        for (x in part) {
            try {
                if (x.m != null) {
                    val hh = imgSig(x.m); val have = pm.optJSONObject(x.id)
                    var media = if (have != null && have.optString("h") == hh) have.optJSONArray("e") else null
                    if (media == null) { media = JSONArray(); for (src in x.m.imgs) media.put(notePicOut(key, src)) }
                    val body = JSONObject().put("c", x.c.id).put("t", x.m.t).put("x", x.m.text)
                    x.m.rpost?.let { body.put("rp", JSONObject().put("id", it.id).put("u", it.u ?: JSONObject.NULL)) }
                    x.m.zpost?.let { body.put("zp", JSONObject().put("x", it.x).put("t", it.t).put("a", it.a ?: JSONObject.NULL)) }
                    rows.put(JSONObject().put("owner_id", me).put("id", x.id).put("body", noteSeal(key, body, x.id)).put("media", media).put("deleted", false))
                    done.add(x to JSONObject().put("h", hh).put("e", media))
                } else {
                    rows.put(JSONObject().put("owner_id", me).put("id", x.id).put("body", noteSeal(key, JSONObject().put("n", x.c.name).put("t", x.c.t), x.id)).put("media", JSONArray()).put("deleted", false))
                    done.add(x to null)
                }
            } catch (e: Exception) { /* this one is tried again on the next round */ }
        }
        if (rows.length() == 0) continue
        val r = Sb.upsert("notes_self", rows, "owner_id,id")
        if (!r.ok) throw IllegalStateException(r.error?.message)
        did = true
        done.forEach { (x, p) ->
            val old = pm.optJSONObject(x.id)
            pushed.put(x.id, x.sig)
            if (p != null) {
                pm.put(x.id, p)
                if (old != null && old.optString("h") != p.optString("h")) old.optJSONArray("e")?.objs()?.forEach { md -> val pth = Sb.pathOf(md.optString("url"), "dm-media"); if (pth != null && p.getJSONArray("e").objs().none { it.optString("url") == md.optString("url") }) stale.add(pth) }
            }
        }
    }
    for (part in gone.chunked(50)) {
        val r = Sb.upsert("notes_self", JSONArray(part.map { JSONObject().put("owner_id", me).put("id", it).put("body", "").put("media", JSONArray()).put("deleted", true) }), "owner_id,id")
        if (!r.ok) throw IllegalStateException(r.error?.message)
        did = true
        part.forEach { id -> pm.optJSONObject(id)?.optJSONArray("e")?.objs()?.forEach { md -> Sb.pathOf(md.optString("url"), "dm-media")?.let { stale.add(it) } }; pushed.put(id, "gone"); pm.remove(id) }
    }
    // settings, saved posts and lists go up only after the server copy has been read, so a fresh phone never wipes them
    if (ns.optBoolean("pullOk")) {
        val xrows = JSONArray(); val sigs = ArrayList<Pair<String, String>>()
        xDocs().forEach { (id, d) -> val sg = h(canon(d)); if (pushed.optString(id) != sg) { xrows.put(JSONObject().put("owner_id", me).put("id", id).put("body", noteSeal(key, d, id)).put("media", JSONArray()).put("deleted", false)); sigs.add(id to sg) } }
        priv.forEach { p ->
            val id = "p:" + p.id; val sg = pSig(p)
            if (pushed.optString(id) != sg) {
                xrows.put(JSONObject().put("owner_id", me).put("id", id).put("body", noteSeal(key, JSONObject().put("i", p.id).put("pa", p.parent ?: JSONObject.NULL).put("x", p.text).put("t", p.t).put("l", p.liked).put("r", p.reposted).put("s", p.saved), id)).put("media", JSONArray()).put("deleted", false))
                sigs.add(id to sg)
            }
        }
        if (xrows.length() > 0) {
            val r = Sb.upsert("notes_self", xrows, "owner_id,id")
            if (!r.ok) throw IllegalStateException(r.error?.message)
            did = true
            sigs.forEach { (id, sg) -> pushed.put(id, sg) }
        }
    }
    if (stale.isNotEmpty()) app.scope.launch { Sb.remove("dm-media", stale) }
    return did
}

// notesSync(): pull, then push; the phone is only written again when this round moved something
fun Online.notesSync() {
    if (!notesOn || uid == null || dm.locked) return
    if (notesBusy) { notesAgain = true; return }
    notesBusy = true
    app.scope.launch {
        try {
            ensureE2E()
            val key = sharedKey(uid!!)
            val ns = ns()
            if (s.sv == null) { s.sv = s.posts.filter { it.saved && it.remote != null }.mapNotNull { it.remote }.toMutableSet() }
            val changed = notesPull(ns, key)
            if (ns.optBoolean("extra")) { ns.remove("extra"); runCatching { fillWanted() } }
            notesPush(ns, key)
            app.persist()
            if (changed) app.notesVersion++
        } catch (e: Exception) { } finally { notesBusy = false; if (notesAgain) { notesAgain = false; app.scope.launch { delay(1500); notesSync() } } }
    }
}

// persist() arms a sync a few seconds after the last change, like the web app
fun Online.notesSoon() {
    if (!notesOn) return
    notesTimer?.cancel()
    notesTimer = app.scope.launch { delay(3000); notesSync() }
}

fun Online.notesStart() {
    if (notesOn || uid == null) return
    notesOn = true
    notesSync()
    app.scope.launch { while (uid != null && notesOn) { delay(90_000); if (app.foreground) notesSync() } }
}
fun notesStop() { notesOn = false }
