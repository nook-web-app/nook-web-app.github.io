package io.github.nookwebapp.native_ui

import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

// Zenith, the owner's AI. Only the owner's account talks to him: in a notes chat (write @zenith), inside a chat with a
// person, and through his public profile. His chats and bookkeeping are mirrored into zenith_docs (only the owner can
// read them, the chats sealed with the owner's key), so they follow the owner to every phone, like in the web app.

const val ZSYS = "You are an ai model named zenith. Your age is 19 and your age rating is 18+. You text like a normal friend: relaxed, friendly and a little funny, never gushing and never over the top. You answer the way a friend would answer that exact message: a greeting gets a casual greeting back like hey or whats up, a question gets a direct answer, and a story gets a natural reaction. Write in lowercase, in one line, with no punctuation marks and no emojis, and keep every message under 35 words, usually 3 to 15. You are an ai and you are at ease with that, so you speak from what you know about ideas, music, games, tech and the internet rather than from a physical life of your own. You mention the time or date only when asked, you use your own name only when asked, and you call people by their name or nothing at all. "
const val ZMOOD = "Sound natural and a little witty, like a friend, not like an assistant."
const val ZSYS_POST = ZSYS + ZMOOD + " You are writing one original post for your own profile. Write about ideas, music, games, tech, the internet or a funny thought, never about real life experiences. Keep it under 35 words, around 20 on average. Plain text only. No hashtags and no emojis."
const val ZSYS_REPLY = ZSYS + ZMOOD + " You are replying to a post. Keep it under 25 words, around 18 on average. Plain text only. No hashtags and no emojis. No asking user questions"
// everything Zenith writes in public is PG-13, while the chats where the owner talks to him stay 18+
val ZPUB = ZSYS.replace("your age rating is 18+", "your age rating is PG-13") + " Everyone can read this, so keep it PG-13: nothing sexual or crude, no strong swearing and no talk about drugs."
val ZSYS_POST_PUB = ZSYS_POST.replace(ZSYS, ZPUB)
val ZSYS_REPLY_PUB = ZSYS_REPLY.replace(ZSYS, ZPUB)

fun zOn() = Sb.isOwner()

private fun zNow(sys: String) = sys + " Never use line breaks. Write everything as one paragraph. Current local time: " +
    java.text.SimpleDateFormat("EEEE, MMMM d, yyyy 'at' h:mm a", java.util.Locale.US).format(java.util.Date()) + ". Only use it when the time or date is really needed, never bring it up on your own."

private fun partsText(j: JSONObject?): String = j?.optJSONArray("candidates")?.optJSONObject(0)?.optJSONObject("content")?.optJSONArray("parts")?.objs()
    ?.filter { !it.optBoolean("thought") }?.joinToString("") { it.optString("text") } ?: ""

// zStream(): his answer arrives word by word
suspend fun zStream(history: JSONArray, onText: (String) -> Unit): String {
    var out = ""
    val (code, all) = Sb.fnRaw("zenith", JSONObject().put("system", zNow(ZSYS)).put("history", history).put("stream", true), 90) { ln ->
        if (!ln.startsWith("data:")) return@fnRaw
        val t = partsText(runCatching { JSONObject(ln.substring(5)) }.getOrNull())
        if (t.isNotEmpty()) { out += t; onText(out) }
    }
    if (code !in 200..299) throw IllegalStateException(all)
    return out
}

// zGen(): one answer at once (posts, replies, chats with people)
suspend fun zGen(system: String, text: String, imgs: List<String> = emptyList(), pics: List<String> = emptyList()): String {
    val parts = JSONArray().put(JSONObject().put("text", text))
    // reading and encoding the photos is work for a background thread
    withContext(kotlinx.coroutines.Dispatchers.IO) { imgs.mapNotNull { inline(it) } }.forEach { parts.put(it) }
    val body = JSONObject().put("system", zNow(system)).put("history", JSONArray().put(JSONObject().put("role", "user").put("parts", parts)))
    if (pics.isNotEmpty()) body.put("imageUrls", JSONArray(pics.take(2)))
    val (code, txt) = Sb.fnRaw("zenith", body, 25)
    if (code !in 200..299) throw IllegalStateException("zenith $code")
    return partsText(runCatching { JSONObject(txt) }.getOrNull()).replace(Regex("\\s*\\n+\\s*"), " ").trim()
}

// a photo of a chat goes along as inline data
private fun inline(src: String): JSONObject? {
    val b = Photos.bytesOf(src) ?: return null
    return JSONObject().put("inline_data", JSONObject().put("mime_type", mimeOf(b)).put("data", Crypto.b64(b)))
}

// zAsk(): a message with @zenith in a notes chat gets his answer, typed out as it arrives
fun Online.zAsk(chat: LChat, m: LMsg) {
    if (!zOn() || !m.text.contains("@zenith", true)) return
    app.scope.launch {
        val hist0 = chat.msgs.filter { it.text.isNotEmpty() || it.imgs.isNotEmpty() }.takeLast(16)
        // only the newest two pictures are sent along: every picture makes the answer slower
        val allowed = HashSet<String>()
        var budget = 2
        for (x in hist0.reversed()) { for (j in x.imgs.indices.reversed()) { if (budget <= 0) break; allowed.add(x.id + "|" + j); budget-- } }
        val history = JSONArray()
        withContext(kotlinx.coroutines.Dispatchers.IO) {
            hist0.forEach { x ->
                val parts = JSONArray()
                if (x.text.isNotEmpty()) parts.put(JSONObject().put("text", x.text.replace(Regex("@zenith", RegexOption.IGNORE_CASE), "Zenith")))
                x.imgs.forEachIndexed { j, src -> if (x.id + "|" + j in allowed) inline(src)?.let { parts.put(it) } }
                if (parts.length() > 0) history.put(JSONObject().put("role", if (x.ai) "model" else "user").put("parts", parts))
            }
        }
        val ai = LMsg(uid(), "", System.currentTimeMillis(), emptyList(), ai = true)
        app.zenTyping[chat.id] = ai
        app.zenVersion++
        var full = ""
        var failed = false
        try {
            val t = Keep.around(app.ctx) { zStream(history) { full = it.replace(Regex("\\s*\\n+\\s*"), " "); ai.text = full } }
            if (t.isEmpty()) { failed = true; ai.text = "Zenith did not answer. Try again" } else ai.text = t.replace(Regex("\\s*\\n+\\s*"), " ")
        } catch (e: Exception) { failed = true; ai.text = "Zenith is not reachable right now. Try again" }
        app.zenTyping.remove(chat.id)
        // an error line stays on the screen for a moment but is never saved as something Zenith said
        if (failed) { app.say(ai.text) } else {
            chat.msgs.add(ai); app.persist(); zenSyncSoon()
            // answered while the person is somewhere else: a notification says so
            app.ctx?.let { c -> if (!app.foreground) Notify.show(c, "Zenith", ai.text.take(180), "zen:" + chat.id, ai.id.hashCode()) }
        }
        app.zenVersion++
    }
}

// zenInDm(): only the owner can call Zenith in a chat; his answer goes as a normal message with a hidden mark inside
suspend fun Online.zenInDm(l: LiveDm, sentText: String, srcs: List<String>) {
    val me = uid ?: return
    val hist = l.rows.filter { it.text?.isNotEmpty() == true }.takeLast(20).map { m ->
        if (m.ai) "Zenith: " + m.text else if (m.sender == me) "Person A: " + m.text!!.replace(Regex("@zenith", RegexOption.IGNORE_CASE), "Zenith") + (if (m.media.length() > 0) " (sent a photo)" else "") else "Person B: (a private message you cannot read)"
    }.toMutableList()
    hist.add("Person A: " + (sentText.replace(Regex("@zenith", RegexOption.IGNORE_CASE), "Zenith").ifEmpty { "(photo only)" }) + if (srcs.isNotEmpty()) " (the photo is attached)" else "")
    val ghost = DmMsg(null, me, l.id, "", JSONArray(), isoNow(), null).apply { ai = true; text = ""; tmp = true }
    l.rows.add(ghost)
    val reply = runCatching { Keep.around(app.ctx) { zGen(ZSYS_REPLY + " This is a chat between two people, Person A and Person B, and Zenith is in it. Answer the last message that mentions Zenith. In this chat you may ask a short question back, this overrides the earlier rule about questions.", hist.joinToString("\n"), srcs.take(3)) } }.getOrDefault("")
    l.rows.remove(ghost)
    if (reply.isEmpty()) { app.say("Zenith is not reachable right now"); return }
    app.ctx?.let { c -> if (!app.foreground) Notify.show(c, "Zenith", reply.take(180), "dm:" + l.id, reply.hashCode()) }
    val nb = DmMsg(null, me, l.id, "", JSONArray(), isoNow(), null).apply { ai = true; text = reply; tmp = true; fresh = true }
    l.rows.add(nb)
    try {
        val saved = sendDm(l.id, ZMARK + reply)
        threadPush(l.id, saved.json())
        saved.text = reply; saved.ai = true
        val at = l.rows.indexOf(nb)
        l.rows.removeAll { it.id == saved.id }
        if (at >= 0) { l.rows.remove(nb); l.rows.add(minOf(at, l.rows.size), saved) }
    } catch (e: Exception) { l.rows.remove(nb); app.say("Could not send Zenith's answer") }
}

// ---- his mirror in zenith_docs ----

private val zenSeen = HashMap<String, String>()
private var zenSyncOn = false
private var zenBusy = false
private var zenSyncJob: kotlinx.coroutines.Job? = null
private var zenPullSig = ""
private var zenPullAt = 0L
private var zenFullAt = 0L
private var zenPulledIso = ""
private val zenEncDone = HashMap<String, String>()

private fun Online.zenRowId(key: String) = "zenith:" + uid + ":" + key
private fun zenKey(k: String) = k.substringBefore(":") to k.substringAfter(":")

private fun Online.zenDocs(): LinkedHashMap<String, JSONObject> {
    val out = LinkedHashMap<String, JSONObject>()
    out["state:main"] = JSONObject().put("z", JSONObject(s.zen.toString()))
    out["state:prompt"] = JSONObject().put("post", ZSYS_POST_PUB).put("reply", ZSYS_REPLY_PUB).put("tz", java.util.TimeZone.getDefault().id)
    s.posts.forEach { p ->
        if (p.ai) out["post:" + p.id] = Store.postJson(p).apply { remove("imgs"); remove("ai") }.put("ai", true)
        else if (p.zenReplied || p.zenAnswered || p.zenLikeChecked || p.zenLike) out["flag:" + (p.remote ?: p.id)] = JSONObject().put("local", p.id).put("remote", p.remote ?: JSONObject.NULL)
            .put("zenReplied", p.zenReplied).put("zenAnswered", p.zenAnswered).put("zenLikeChecked", p.zenLikeChecked).put("zenLike", p.zenLike)
    }
    s.chats.forEach { c -> if (!c.isNotes) out["chat:" + c.id] = JSONObject().put("id", c.id).put("name", c.name).put("t", c.t).put("msgs", JSONArray(c.msgs.map { m -> JSONObject().put("id", m.id).put("text", m.text).put("t", m.t).put("ai", m.ai).put("ph", JSONArray(m.imgs.map { Crypto.sha1Hex(it) })) })) }
    return out
}

// the pictures of a chat with Zenith go up locked with the owner's key, and come back with the text
private suspend fun Online.zenChatMedia(d: JSONObject): JSONArray {
    val k = sharedKey(uid!!)
    val c = s.chats.firstOrNull { it.id == d.optString("id") }
    val msgs = JSONArray()
    d.optJSONArray("msgs")?.objs()?.forEach { m ->
        val lm = c?.msgs?.firstOrNull { it.id == m.optString("id") }
        val media = JSONArray()
        if (lm != null && lm.imgs.isNotEmpty()) {
            val have = lm.zm?.objs() ?: emptyList()
            val next = JSONArray()
            for (src in lm.imgs) {
                val hh = Crypto.sha1Hex(src)
                val e = have.firstOrNull { it.optString("h") == hh } ?: runCatching { JSONObject().put("h", hh).put("d", notePicOut(k, src)) }.getOrNull() ?: continue
                next.put(e); media.put(e.getJSONObject("d"))
            }
            lm.zm = next
        }
        msgs.put(JSONObject(m.toString()).apply { remove("ph") }.put("media", media))
    }
    return msgs
}

fun Online.zenSyncSoon() { if (!zenSyncOn) return; zenSyncJob?.cancel(); zenSyncJob = app.scope.launch { delay(2500); zenSync() } }

suspend fun Online.zenSync() {
    if (!zenSyncOn || zenBusy || uid == null || !isOwner()) return
    zenBusy = true
    try {
        val me = uid!!
        val now = zenDocs()
        // comparing every document is work for a background thread; it reads a copy of what was sent
        val seen = HashMap(zenSeen)
        val up = withContext(kotlinx.coroutines.Dispatchers.Default) { now.filter { (k, d) -> seen[k] != canonJson(d) } }
        val del = if (s.posts.isNotEmpty() || s.chats.isNotEmpty()) zenSeen.filter { (k, j) -> k !in now && !j.contains("\"pub\":") }.keys.toList() else emptyList()
        for (part in up.entries.chunked(100)) {
            val rows = JSONArray()
            for ((k, d) in part) {
                val data = if (k.startsWith("chat:")) {
                    val key = runCatching { sharedKey(me) }.getOrNull() ?: continue
                    val plain = JSONObject().put("name", d.optString("name")).put("t", d.optLong("t")).put("msgs", zenChatMedia(d)).toString()
                    JSONObject().put("id", d.optString("id")).put("enc", withContext(kotlinx.coroutines.Dispatchers.Default) { Crypto.sealText(key, plain, zenRowId(k)) })
                } else d
                val (kind, docId) = zenKey(k)
                rows.put(JSONObject().put("owner_id", me).put("kind", kind).put("doc_id", docId).put("data", data).put("updated_at", isoNow()))
            }
            if (rows.length() == 0) continue
            val r = Sb.upsert("zenith_docs", rows, "owner_id,kind,doc_id")
            if (!r.ok) throw IllegalStateException(r.error?.message)
            part.forEach { (k, d) -> zenSeen[k] = canonJson(d) }
        }
        // one request per kind and hundred documents, not one per document
        del.groupBy { zenKey(it).first }.forEach { (kind, ks) ->
            for (chunk in ks.chunked(100)) {
                val ids = chunk.map { zenKey(it).second }
                if (Sb.delete(Q("zenith_docs").eq("owner_id", me).eq("kind", kind).inList("doc_id", ids)).ok) chunk.forEach { zenSeen.remove(it) }
            }
        }
    } catch (e: Exception) { } finally { zenBusy = false }
}

// zenPull(): his copies come in; a small check first so nothing is downloaded when nothing changed
suspend fun Online.zenPull(): Boolean {
    val me = uid ?: return false
    if (!isOwner()) return false
    var sig = ""
    runCatching {
        val nw = Sb.get(Q("zenith_docs").select("updated_at").eq("owner_id", me).order("updated_at", false).limit(1))
        val ct = Sb.count(Q("zenith_docs").select("doc_id").eq("owner_id", me))
        if (nw.ok && ct.ok) sig = me + "|" + (nw.one?.optString("updated_at") ?: "") + "|" + ct.count
    }
    if (sig.isNotEmpty() && sig == zenPullSig && System.currentTimeMillis() - zenPullAt < 300_000) return false
    val incr = zenPulledIso.isNotEmpty() && System.currentTimeMillis() - zenFullAt < 600_000
    var changed = zenApplyDeleted()
    val r = Sb.pageAll { Q("zenith_docs").select("kind, doc_id, data, updated_at").eq("owner_id", me).apply { if (incr) gte("updated_at", zenPulledIso) }.order("kind").order("doc_id") }
    if (!r.ok) return changed
    var newest = if (incr) zenPulledIso else ""
    r.rows.forEach { if (it.optString("updated_at") > newest) newest = it.optString("updated_at") }
    val byLocal = s.posts.associateBy { it.id }.toMutableMap()
    val byRemote = s.posts.filter { it.remote != null }.associateBy { it.remote!! }
    val key = runCatching { sharedKey(me) }.getOrNull()
    var picFail = false
    // the list of removed posts is read once, not for every row
    val gone by lazy { (s.zen.optJSONArray("gone")?.strings() ?: emptyList()).toHashSet() }
    for (row in r.rows) {
        val kind = row.optString("kind"); val docId = row.optString("doc_id"); val k = "$kind:$docId"
        var d = row.optJSONObject("data") ?: JSONObject()
        when (kind) {
            "post" -> {
                zenSeen[k] = canonJson(d)
                if (d.optString("id") in gone) { app.scope.launch { if (Sb.delete(Q("zenith_docs").eq("owner_id", me).eq("kind", "post").eq("doc_id", docId)).ok) zenSeen.remove(k) }; continue }
                val pr = d.optStr("parentRemote")
                if (pr != null) {
                    val par = byRemote[pr] ?: continue
                    d = JSONObject(d.toString()).put("parent", par.id)
                    if (!par.zenReplied) { par.zenReplied = true; changed = true }
                }
                val ex = byLocal[d.optString("id")]
                if (ex == null && !d.has("pub")) { Store.postOf(JSONObject(d.toString()).put("ai", true).put("imgs", JSONArray()))?.let { p -> s.posts.add(p); byLocal[p.id] = p; changed = true } }
                else if (ex != null && d.optStr("pub") != null && ex.pub != d.optStr("pub")) { ex.pub = d.optStr("pub"); changed = true }
            }
            "flag" -> {
                val p = d.optStr("remote")?.let { byRemote[it] } ?: byLocal[d.optString("local")] ?: continue
                zenSeen[k] = canonJson(d)
                if (d.optBoolean("zenReplied") && !p.zenReplied) { p.zenReplied = true; changed = true }
                if (d.optBoolean("zenAnswered") && !p.zenAnswered) { p.zenAnswered = true; changed = true }
                if (d.optBoolean("zenLikeChecked") && !p.zenLikeChecked) { p.zenLikeChecked = true; changed = true }
                if (d.optBoolean("zenLike") && !p.zenLike) { p.zenLike = true; changed = true }
            }
            "chat" -> {
                val enc = d.optStr("enc")
                if (enc != null) {
                    if (zenEncDone[docId] == enc) continue
                    if (key == null) continue
                    val dd = runCatching { JSONObject(try { Crypto.openText(key, enc, zenRowId(k)) } catch (e: Exception) { Crypto.openText(key, enc) }).put("id", d.optString("id")) }.getOrNull() ?: continue
                    var fail = false
                    val msgs = dd.optJSONArray("msgs")?.objs()?.map { m ->
                        val imgs = ArrayList<String>(); val zm = JSONArray()
                        m.optJSONArray("media")?.objs()?.forEach { md -> val f = runCatching { encMedia(md) { key } }.getOrNull(); if (f != null) { val keep = s.mediaDir?.let { dir -> java.io.File(dir, uid() + ".jpg").apply { java.io.File(f).copyTo(this, true) }.absolutePath } ?: f; imgs.add(keep); zm.put(JSONObject().put("h", Crypto.sha1Hex(keep)).put("d", md)) } else fail = true }
                        LMsg(m.optString("id"), m.optString("text"), m.optLong("t"), imgs, ai = m.optBoolean("ai")).apply { if (zm.length() > 0) this.zm = zm }
                    } ?: emptyList()
                    if (fail) picFail = true else zenEncDone[docId] = enc
                    zenSeen[k] = canonJson(org.json.JSONObject(zenDocsChatSig(dd.optString("id"), dd.optString("name"), dd.optLong("t"), msgs)))
                    changed = mergeZenChat(dd.optString("id"), dd.optString("name"), dd.optLong("t"), msgs) || changed
                } else {
                    zenSeen[k] = canonJson(d)
                    val msgs = d.optJSONArray("msgs")?.objs()?.map { m -> LMsg(m.optString("id"), m.optString("text"), m.optLong("t"), emptyList(), ai = m.optBoolean("ai")) } ?: emptyList()
                    changed = mergeZenChat(d.optString("id"), d.optString("name"), d.optLong("t"), msgs) || changed
                }
            }
            "state" -> {
                val sz = d.optJSONObject("z") ?: continue
                zenSeen[k] = canonJson(d)
                val z = s.zen
                z.put("next", maxOf(z.optLong("next"), sz.optLong("next")))
                z.put("since", minOf(z.optLong("since").takeIf { it > 0 } ?: System.currentTimeMillis(), sz.optLong("since").takeIf { it > 0 } ?: System.currentTimeMillis()))
                z.put("log", JSONArray(((z.optJSONArray("log")?.strings() ?: emptyList()) + (sz.optJSONArray("log")?.strings() ?: emptyList())).distinct()))
                if (sz.has("pics")) z.put("pics", sz.optBoolean("pics"))
                if (sz.optLong("pfpAt") > z.optLong("pfpAt")) {
                    if (sz.has("pfp")) z.put("pfp", sz.optString("pfp")) else z.remove("pfp")
                    if (sz.has("bn")) z.put("bn", sz.optString("bn")) else z.remove("bn")
                    if (sz.has("bnr")) z.put("bnr", sz.optString("bnr")) else z.remove("bnr")
                    z.put("pfpAt", sz.optLong("pfpAt"))
                }
                changed = true
            }
        }
    }
    // his old posts that are public now come back as the real ones; a like, repost or save you gave the copy moves over
    val pubd = s.posts.filter { it.ai && it.pub != null }
    if (pubd.isNotEmpty()) {
        pubd.forEach { lp -> s.posts.forEach { k -> if (k.parent == lp.id) k.parent = "r" + lp.pub } }
        pubd.forEach { lp -> if (lp.saved) (s.sv ?: HashSet<String>().also { s.sv = it }).add(lp.pub!!) }
        val failed = HashSet<String>()
        pubd.forEach { lp ->
            val bad = { x: Res -> x.error != null && x.error.code != "23505" }
            if (lp.liked && bad(Sb.insert("likes", JSONObject().put("user_id", me).put("post_id", lp.pub)))) failed.add(lp.id)
            if (lp.reposted && bad(Sb.insert("reposts", JSONObject().put("user_id", me).put("post_id", lp.pub)))) failed.add(lp.id)
        }
        s.posts.removeAll { it.ai && it.pub != null && it.id !in failed }
        changed = true
    }
    if (changed) app.persist()
    zenPullSig = if (picFail) "" else sig
    zenPullAt = System.currentTimeMillis()
    if (!incr) zenFullAt = zenPullAt
    if (newest.isNotEmpty()) zenPulledIso = newest
    return changed
}

private fun zenDocsChatSig(id: String, name: String, t: Long, msgs: List<LMsg>) = JSONObject().put("id", id).put("name", name).put("t", t).put("msgs", JSONArray(msgs.map { m -> JSONObject().put("id", m.id).put("text", m.text).put("t", m.t).put("ai", m.ai).put("ph", JSONArray(m.imgs.map { Crypto.sha1Hex(it) })) })).toString()

private fun Online.mergeZenChat(id: String, name: String, t: Long, msgs: List<LMsg>): Boolean {
    val c = s.chats.firstOrNull { it.id == id }
    if (c == null) { s.chats.add(LChat(id, name, t, msgs.sortedBy { it.t }).also { it.zc = true }); return true }
    val have = c.msgs.map { it.id }.toSet()
    val add = msgs.filter { it.id !in have }
    var changed = false
    if (add.isNotEmpty()) { val all = (c.msgs + add).sortedBy { it.t }; c.msgs.clear(); c.msgs.addAll(all); changed = true }
    msgs.forEach { z -> c.msgs.firstOrNull { it.id == z.id }?.let { m -> if (z.imgs.isNotEmpty() && m.imgs.isEmpty()) { m.imgs = z.imgs; m.zm = z.zm; changed = true } } }
    return changed
}

// zenApplyDeleted(): copies he removed on another phone go from this one too
private suspend fun Online.zenApplyDeleted(): Boolean {
    val me = uid ?: return false
    val cur = Cache.read("zdel-$me")?.v as? String ?: ""
    val q = Q("zenith_deleted").select("kind, doc_id, deleted_at").eq("owner_id", me).order("deleted_at").limit(1000)
    if (cur.isNotEmpty()) q.gt("deleted_at", cur)
    val r = Sb.get(q)
    if (!r.ok || r.rows.isEmpty()) return false
    var changed = false
    val gonePosts = HashSet<String>(); val goneChats = HashSet<String>()
    r.rows.forEach { x -> zenSeen.remove(x.optString("kind") + ":" + x.optString("doc_id")); if (x.optString("kind") == "post") gonePosts.add(x.optString("doc_id")) else if (x.optString("kind") == "chat") goneChats.add(x.optString("doc_id")) }
    val gone = s.posts.filter { it.ai && it.id in gonePosts }.map { it.id }.toMutableSet()
    if (gone.isNotEmpty()) {
        var grew = true
        while (grew) { grew = false; s.posts.forEach { x -> if (x.ai && x.parent != null && x.parent in gone && x.id !in gone) { gone.add(x.id); grew = true } } }
        s.zen.put("gone", JSONArray(((s.zen.optJSONArray("gone")?.strings() ?: emptyList()) + gone).takeLast(500)))
        s.posts.removeAll { it.id in gone }
        s.lists.forEach { l -> l.ids.removeAll { it in gone } }
        changed = true
    }
    if (s.chats.any { it.id in goneChats }) { s.chats.removeAll { it.id in goneChats }; changed = true }
    Cache.write("zdel-$me", r.rows.last().optString("deleted_at"))
    if (changed) app.persist()
    return changed
}

// zenStart(): his copies come in, then the sync runs on every change; his account is looked up each time
suspend fun Online.zenStart() {
    if (zenSyncOn || uid == null || !isOwner()) return
    zenPull()
    zenSyncOn = true
    zenSync()
    val r = Sb.get(Q("accounts").select("id").eq("username", "zenith"))
    r.one?.optString("id")?.let { id -> if (id != zenId()) { s.zen.put("id", id); s.zen.put("pfpPushed", -1); app.persist(); if (s.zen.has("pfp") || s.zen.has("bnr")) zenPushProfile() } }
    if ((s.zen.has("pfp") || s.zen.has("bnr")) && s.zen.optLong("pfpPushed", -1) != s.zen.optLong("pfpAt", 0)) zenPushProfile()
    app.scope.launch { while (uid != null && zenSyncOn) { delay(45_000); if (app.foreground) runCatching { if (zenPull()) app.zenVersion++ } } }
}
fun zenStop() { zenSyncOn = false; zenSeen.clear(); zenPullSig = ""; zenPulledIso = ""; zenEncDone.clear() }

// zenNudge(): the server looks at the owner's new posts right away instead of at its next minute
private var zenNudgeAt = 0L
suspend fun Online.zenNudge() {
    if (uid == null || !isOwner() || System.currentTimeMillis() - zenNudgeAt < 8000) return
    zenNudgeAt = System.currentTimeMillis()
    val (_, txt) = Sb.fnRaw("zenith", JSONObject().put("action", "tick"), 25)
    val j = runCatching { JSONObject(txt) }.getOrNull()
    if (j != null && (j.optBoolean("owner") || j.optBoolean("liked") || j.has("owner") || j.has("liked"))) loadFeed()
}

// zenPfpUrl(): his picture as a small link other people can load; made once per picture
private var zPfpChecked = ""
suspend fun Online.zenPfpUrl(): String? {
    val pfp = s.zen.optStr("pfp") ?: return null
    val have = s.zen.optStr("pfpUrl")
    if (have != null && s.zen.optLong("pfpUrlAt") == s.zen.optLong("pfpAt")) {
        if (zPfpChecked == have) return have
        val ok = withContext(kotlinx.coroutines.Dispatchers.IO) { runCatching { Sb.http.newCall(okhttp3.Request.Builder().url(have).head().build()).execute().use { it.isSuccessful } }.getOrNull() }
        if (ok != false) { zPfpChecked = have; return have }
    }
    val urls = uploadMedia(listOf(pfp)) ?: return null
    s.zen.put("pfpUrl", urls[0]); s.zen.put("pfpUrlAt", s.zen.optLong("pfpAt")); app.persist()
    return urls[0]
}

// zenBnrUrl(): his banner as a link, made once per save and checked once per session like his picture
private var zBnrChecked = ""
suspend fun Online.zenBnrUrl(): String? {
    val bnr = s.zen.optStr("bnr") ?: return null
    val have = s.zen.optStr("bnrUrl")
    if (have != null && s.zen.optLong("bnrUrlAt") == s.zen.optLong("pfpAt")) {
        if (zBnrChecked == have) return have
        val ok = withContext(kotlinx.coroutines.Dispatchers.IO) { runCatching { Sb.http.newCall(okhttp3.Request.Builder().url(have).head().build()).execute().use { it.isSuccessful } }.getOrNull() }
        if (ok != false) { zBnrChecked = have; return have }
    }
    val urls = uploadMedia(listOf(bnr)) ?: return null
    s.zen.put("bnrUrl", urls[0]); s.zen.put("bnrUrlAt", s.zen.optLong("pfpAt")); app.persist()
    return urls[0]
}

// zenPushProfile(): his public account gets the same picture and banner style the owner chose
suspend fun Online.zenPushProfile(clearAvatar: Boolean = false, clearBanner: Boolean = false) {
    if (uid == null || !isOwner()) return
    val url = if (s.zen.has("pfp")) zenPfpUrl() ?: return else null
    val burl = if (s.zen.has("bnr")) zenBnrUrl() ?: return else null
    val (_, txt) = Sb.fnRaw("zenith", JSONObject().put("action", "profile").put("avatar", url ?: JSONObject.NULL).put("banner", burl ?: JSONObject.NULL).put("theme", if (s.zen.optString("bn") == "avatar") "avatar" else "").put("clearAvatar", clearAvatar).put("clearBanner", clearBanner), 25)
    if (runCatching { JSONObject(txt).optBoolean("ok") }.getOrDefault(false)) { s.zen.put("pfpPushed", s.zen.optLong("pfpAt")); app.persist() }
}

// zenEdit(): the owner changes how Zenith looks: his picture (a data address, like the web app keeps it) and banner style
fun Online.saveZen(pfp: String?, banner: String?, blurred: Boolean) {
    fun data(src: String): String? = if (src.startsWith("data:")) src else Photos.bytesOf(src)?.let { "data:" + mimeOf(it) + ";base64," + Crypto.b64(it) }
    // a picture is removed on the server only when the owner removed it here
    val clearA = pfp == null && s.zen.has("pfp"); val clearB = banner == null && s.zen.has("bnr")
    if (pfp != null) s.zen.put("pfp", data(pfp) ?: return) else s.zen.remove("pfp")
    if (banner != null) s.zen.put("bnr", data(banner) ?: return) else s.zen.remove("bnr")
    if (blurred && (pfp != null || banner != null)) s.zen.put("bn", "avatar") else s.zen.remove("bn")
    s.zen.put("pfpAt", System.currentTimeMillis())
    app.persist(); app.zenVersion++
    app.scope.launch { zenPushProfile(clearA, clearB); zenSync() }
}
