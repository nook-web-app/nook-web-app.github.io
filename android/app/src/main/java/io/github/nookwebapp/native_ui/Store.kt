package io.github.nookwebapp.native_ui

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

// What the app keeps on this phone, in the same shape as the web app's state S (posts, chats, lists, profile, ui):
// one JSON file in the app's private storage, and the photos as files next to it. The posts of other people that the
// feed brought in sit in the same list, marked with their author (ra), like in the web app.

// the author of a post of somebody else (p.ra)
data class Author(val id: String, val name: String, val handle: String, val avatar: String?)
// who that you follow reposted it, and when (p.rpBy)
data class RpBy(val id: String, val name: String, val t: Long)

class LPost(
    val id: String, text: String, val t: Long, imgs: List<String>, parent: String?,
    liked: Boolean = false, reposted: Boolean = false, rpAt: Long = 0, saved: Boolean = false, pinned: Boolean = false, edited: Boolean = false,
    remote: String? = null, val ra: Author? = null, val ai: Boolean = false,
) {
    var text by mutableStateOf(text)
    var imgs by mutableStateOf(imgs)
    var parent by mutableStateOf(parent)
    var liked by mutableStateOf(liked)
    var reposted by mutableStateOf(reposted)
    var rpAt by mutableLongStateOf(rpAt)
    var saved by mutableStateOf(saved)
    var pinned by mutableStateOf(pinned)
    var edited by mutableStateOf(edited)
    // the id of the post on the server, once it is there
    var remote by mutableStateOf(remote)
    // the id made before the first send, so a send repeated after a lost answer can never make a second post
    var rid: String? = null
    // the links of the photos as the server keeps them (own posts)
    var media: List<String> = emptyList()
    var rpBy by mutableStateOf<RpBy?>(null)
    // likes, reposts, shares, saves and replies as the server counts them
    var lc by mutableIntStateOf(0)
    var rpc by mutableIntStateOf(0)
    var shc by mutableIntStateOf(0)
    var svc by mutableIntStateOf(0)
    var rp by mutableIntStateOf(0)
    var sharedByMe by mutableStateOf(false)
    var sharedAt = 0L
    // drawn early, before the counts arrived: never saved and replaced by the full list a moment later
    var prov = false
    var sending = false
    var noRetry = false
    // Zenith's bookkeeping (the owner's phone only)
    var zenReplied = false
    var zenAnswered = false
    var zenLikeChecked = false
    var zenLike by mutableStateOf(false)
    var pub: String? = null
    val mine get() = ra == null && !ai
}

data class RPost(val id: String, val u: String?)
data class ZPost(val x: String, val t: Long, val a: String?)

class LMsg(val id: String, text: String, t: Long, imgs: List<String>, val ai: Boolean = false, rpost: RPost? = null, zpost: ZPost? = null) {
    var text by mutableStateOf(text)
    var t by mutableLongStateOf(t)
    var imgs by mutableStateOf(imgs)
    var rpost by mutableStateOf(rpost)
    var zpost by mutableStateOf(zpost)
    // the copies of the photos of a chat with Zenith that went up to the server: [{ h, d }]
    var zm: JSONArray? = null
}
class LChat(val id: String, name: String, t: Long, msgs: List<LMsg> = emptyList(), draft: String = "") {
    var name by mutableStateOf(name)
    var t by mutableLongStateOf(t)
    val msgs = mutableStateListOf<LMsg>().apply { addAll(msgs) }
    var draft by mutableStateOf(draft)
    // a chat with a message of Zenith in it is his chat; every other one is notes to self
    val isNotes get() = msgs.none { it.ai }
}
class LList(val id: String, name: String, desc: String, ids: List<String>) {
    var name by mutableStateOf(name)
    var desc by mutableStateOf(desc)
    val ids = mutableStateListOf<String>().apply { addAll(ids) }
}

class Profile {
    var name by mutableStateOf("Me")
    var handle by mutableStateOf("me")
    var bio by mutableStateOf("")
    var avatar by mutableStateOf<String?>(null)
    var banner by mutableStateOf<String?>(null)
    var bannerTheme by mutableStateOf("default")
    var handleChangedAt: String? = null
    // the picture and banner that are already on the server, so they are not sent again
    var avSynced: String? = null
    var bnSynced: String? = null
    // what the server held for the picture and the banner the last time they were read: a different value there (changed
    // on another phone or in the web app) replaces this phone's copy, unless a change made here is still on its way
    var avSrv: String? = null
    var bnSrv: String? = null
}

// a new id, made the same way as uid() in app.js
fun uid(): String = java.lang.Long.toString((Math.random() * 2176782336.0).toLong(), 36).padStart(6, '0').takeLast(6) + java.lang.Long.toString(System.currentTimeMillis(), 36)

class Store(private val dir: File?) {
    val profile = Profile()
    val posts = mutableStateListOf<LPost>()
    val chats = mutableStateListOf<LChat>()
    val lists = mutableStateListOf<LList>()
    var theme by mutableStateOf(ThemeMode.System)
    var homeTab by mutableStateOf("latest")
    var profTab by mutableStateOf("posts")
    var langs by mutableStateOf<List<String>?>(null)
    // "less like this": the people (a) and the words (w) that go down
    val lessA = mutableMapOf<String, Int>()
    val lessWords = mutableMapOf<String, Int>()
    val hidden = mutableStateListOf<String>()
    var draft by mutableStateOf<Pair<String, Long>?>(null)
    // the chats pinned to the top of the chat list (S.ui.dmPins)
    val dmPins = mutableStateListOf<String>()
    // the server ids of the saved posts (S.sv)
    var sv: MutableSet<String>? = null
    // own posts deleted here that the server still has to drop (S.pendDel)
    val pendDel = mutableListOf<String>()
    // link previews: url -> { t, d, i, s, v, f }
    val previews = LinkedHashMap<String, JSONObject>()
    // Zenith's state (S.zen) and the notes sync bookkeeping (S.notesSync), kept as the web app keeps them
    var zen = JSONObject().put("log", JSONArray()).put("next", 0).put("since", System.currentTimeMillis())
    var notesSync: JSONObject? = null
    // the account this phone's data belongs to (LOCAL_UID)
    var localUid: String? = null
    var signedIn by mutableStateOf(false)

    val mediaDir: File? get() = dir?.let { File(it, "media").apply { mkdirs() } }
    val filesDir: File? get() = dir

    fun byId(id: String?) = if (id == null) null else posts.firstOrNull { it.id == id }
    fun byRemote(r: String?) = if (r == null) null else posts.firstOrNull { it.remote == r }
    fun kids(id: String) = posts.filter { it.parent == id }
    // every reply under a post, the replies to replies too, oldest first at each level (flat() in app.js)
    fun flat(id: String, d: Int = 0, out: MutableList<Pair<LPost, Int>> = mutableListOf(), seen: MutableSet<String> = mutableSetOf(id)): MutableList<Pair<LPost, Int>> {
        kids(id).sortedBy { it.t }.forEach { k -> if (seen.add(k.id)) { out.add(k to d); flat(k.id, d + 1, out, seen) } }
        return out
    }
    fun replyTotal(id: String) = flat(id).size

    fun load() {
        val f = dir?.let { File(it, "state.json") } ?: return
        if (!f.exists()) return
        val j = try { JSONObject(f.readText()) } catch (e: Exception) { return }
        fromJson(j)
    }

    fun fromJson(j: JSONObject) {
        signedIn = j.optBoolean("signedIn", false)
        localUid = j.optStr("localUid")
        j.optJSONObject("profile")?.let { p ->
            profile.name = p.optString("name", "Me"); profile.handle = p.optString("handle", "me").ifBlank { "me" }
            profile.bio = p.optString("bio", ""); profile.avatar = p.optStr("avatar"); profile.banner = p.optStr("banner")
            profile.bannerTheme = p.optString("bannerTheme", "default")
            profile.handleChangedAt = p.optStr("handleChangedAt"); profile.avSynced = p.optStr("avSynced"); profile.bnSynced = p.optStr("bnSynced")
            profile.avSrv = p.optStr("avSrv"); profile.bnSrv = p.optStr("bnSrv")
        }
        posts.clear()
        j.optJSONArray("posts")?.forEachObj { p -> postOf(p)?.let { posts.add(it) } }
        chats.clear()
        j.optJSONArray("chats")?.forEachObj { c ->
            val msgs = mutableListOf<LMsg>()
            c.optJSONArray("msgs")?.forEachObj { m -> msgs.add(msgOf(m)) }
            chats.add(LChat(c.getString("id"), c.optString("name", "Chat"), c.optLong("t"), msgs, c.optString("draft", "")))
        }
        lists.clear()
        j.optJSONArray("lists")?.forEachObj { l -> lists.add(LList(l.getString("id"), l.optString("name"), l.optString("desc", ""), l.optJSONArray("ids").strings())) }
        j.optJSONObject("ui")?.let { u ->
            theme = when (u.optString("theme")) { "dark" -> ThemeMode.Dark; "light" -> ThemeMode.Light; else -> ThemeMode.System }
            homeTab = u.optString("homeTab", "latest"); profTab = u.optString("profTab", "posts")
            langs = u.optJSONArray("langs")?.strings()?.takeIf { it.isNotEmpty() }
            hidden.clear(); hidden.addAll(u.optJSONArray("hidden").strings())
            lessWords.clear(); lessA.clear()
            u.optJSONObject("less")?.let { l ->
                // older copies kept only the words, straight in "less"
                if (l.has("w") || l.has("a")) {
                    l.optJSONObject("w")?.let { w -> w.keys().forEach { k -> lessWords[k] = w.optInt(k) } }
                    l.optJSONObject("a")?.let { a -> a.keys().forEach { k -> lessA[k] = a.optInt(k) } }
                } else l.keys().forEach { k -> lessWords[k] = l.optInt(k) }
            }
            dmPins.clear(); dmPins.addAll(u.optJSONArray("dmPins").strings())
        }
        j.optJSONObject("draft")?.let { d -> draft = d.optString("text") to d.optLong("t") }
        sv = j.optJSONObject("sv")?.let { o -> o.keys().asSequence().toMutableSet() }
        pendDel.clear(); pendDel.addAll(j.optJSONArray("pendDel").strings())
        previews.clear(); j.optJSONObject("previews")?.let { o -> o.keys().forEach { k -> o.optJSONObject(k)?.let { previews[k] = it } } }
        j.optJSONObject("zen")?.let { zen = it }
        notesSync = j.optJSONObject("notesSync")
    }

    // written to a new file first and then moved over the old one, so a crash in the middle never leaves half a file
    fun save() {
        val d = dir ?: return
        val txt = toJson().toString()
        val tmp = File(d, "state.json.tmp")
        tmp.writeText(txt)
        tmp.renameTo(File(d, "state.json"))
    }

    fun toJson(): JSONObject {
        val j = JSONObject()
        j.put("v", 3).put("signedIn", signedIn).put("localUid", localUid ?: JSONObject.NULL)
        j.put("profile", JSONObject().put("name", profile.name).put("handle", profile.handle).put("bio", profile.bio)
            .put("avatar", profile.avatar ?: JSONObject.NULL).put("banner", profile.banner ?: JSONObject.NULL).put("bannerTheme", profile.bannerTheme)
            .put("handleChangedAt", profile.handleChangedAt ?: JSONObject.NULL).put("avSynced", profile.avSynced ?: JSONObject.NULL).put("bnSynced", profile.bnSynced ?: JSONObject.NULL)
            .put("avSrv", profile.avSrv ?: JSONObject.NULL).put("bnSrv", profile.bnSrv ?: JSONObject.NULL))
        j.put("posts", JSONArray().apply { posts.toList().forEach { p -> if (!p.prov) put(postJson(p)) } })
        j.put("chats", JSONArray().apply {
            chats.toList().forEach { c ->
                put(JSONObject().put("id", c.id).put("name", c.name).put("t", c.t).put("draft", c.draft).put("msgs", JSONArray().apply { c.msgs.toList().forEach { m -> put(msgJson(m)) } }))
            }
        })
        j.put("lists", JSONArray().apply { lists.toList().forEach { l -> put(JSONObject().put("id", l.id).put("name", l.name).put("desc", l.desc).put("ids", JSONArray(l.ids.toList()))) } })
        j.put("ui", JSONObject().put("theme", themeName()).put("homeTab", homeTab).put("profTab", profTab).put("langs", langs?.let { JSONArray(it) } ?: JSONObject.NULL)
            .put("hidden", JSONArray(hidden.toList())).put("less", lessJson()).put("dmPins", JSONArray(dmPins.toList())))
        draft?.let { (t, at) -> j.put("draft", JSONObject().put("text", t).put("t", at)) }
        sv?.let { s -> j.put("sv", JSONObject().apply { s.toList().forEach { put(it, 1) } }) }
        j.put("pendDel", JSONArray(pendDel.toList()))
        j.put("previews", JSONObject().apply { previews.toList().forEach { (k, v) -> put(k, v) } })
        j.put("zen", zen)
        notesSync?.let { j.put("notesSync", it) }
        return j
    }

    fun themeName() = when (theme) { ThemeMode.Dark -> "dark"; ThemeMode.Light -> "light"; else -> "system" }
    fun lessJson(): JSONObject = JSONObject().put("a", JSONObject(lessA as Map<*, *>)).put("w", JSONObject(lessWords as Map<*, *>))

    // the whole phone copy is removed: posts, chats, lists, photos (signing in with another account, a ban)
    fun wipe() {
        posts.clear(); chats.clear(); lists.clear(); hidden.clear(); lessWords.clear(); lessA.clear(); dmPins.clear(); draft = null
        profile.name = "Me"; profile.handle = "me"; profile.bio = ""; profile.avatar = null; profile.banner = null; profile.bannerTheme = "default"
        profile.handleChangedAt = null; profile.avSynced = null; profile.bnSynced = null; profile.avSrv = null; profile.bnSrv = null
        sv = null; pendDel.clear(); previews.clear(); notesSync = null; localUid = null
        zen = JSONObject().put("log", JSONArray()).put("next", 0).put("since", System.currentTimeMillis())
        signedIn = false
        mediaDir?.listFiles()?.forEach { it.delete() }
        save()
    }

    // photos no post, chat or profile points at any more are removed from storage
    fun sweepMedia() {
        val used = HashSet<String>()
        posts.toList().forEach { used.addAll(it.imgs) }
        chats.toList().forEach { c -> c.msgs.toList().forEach { used.addAll(it.imgs) } }
        profile.avatar?.let { used.add(it) }; profile.banner?.let { used.add(it) }
        zen.optString("pfp").takeIf { it.isNotEmpty() }?.let { used.add(it) }
        mediaDir?.listFiles()?.forEach { f -> if (f.absolutePath !in used && System.currentTimeMillis() - f.lastModified() > 60_000) f.delete() }
    }

    companion object {
        fun open(ctx: Context) = Store(ctx.filesDir).apply { load() }

        fun postJson(p: LPost): JSONObject = JSONObject().put("id", p.id).put("text", p.text).put("t", p.t).put("imgs", JSONArray(p.imgs)).put("parent", p.parent ?: JSONObject.NULL)
            .put("liked", p.liked).put("reposted", p.reposted).put("rpAt", p.rpAt).put("saved", p.saved).put("pinned", p.pinned).put("edited", p.edited)
            .apply {
                p.remote?.let { put("remote", it) }
                p.rid?.let { put("rid", it) }
                if (p.media.isNotEmpty()) put("media", JSONArray(p.media))
                p.ra?.let { a -> put("ra", JSONObject().put("id", a.id).put("name", a.name).put("handle", a.handle).put("avatar", a.avatar ?: JSONObject.NULL)) }
                if (p.ai) put("ai", true)
                p.rpBy?.let { r -> put("rpBy", JSONObject().put("id", r.id).put("name", r.name).put("t", r.t)) }
                if (p.lc != 0) put("lc", p.lc); if (p.rpc != 0) put("rpc", p.rpc); if (p.shc != 0) put("shc", p.shc); if (p.svc != 0) put("svc", p.svc); if (p.rp != 0) put("rp", p.rp)
                if (p.sharedByMe) put("sharedByMe", true); if (p.sharedAt != 0L) put("sharedAt", p.sharedAt); if (p.noRetry) put("noRetry", true)
                if (p.zenReplied) put("zenReplied", true); if (p.zenAnswered) put("zenAnswered", true); if (p.zenLikeChecked) put("zenLikeChecked", true); if (p.zenLike) put("zenLike", true)
                p.pub?.let { put("pub", it) }
            }

        fun postOf(p: JSONObject): LPost? {
            val id = p.optString("id").ifEmpty { return null }
            val ra = p.optJSONObject("ra")?.let { a -> Author(a.optString("id"), a.optString("name"), a.optString("handle"), a.optStr("avatar")) }
            return LPost(id, p.optString("text", ""), p.optLong("t"), p.optJSONArray("imgs").strings(), p.optStr("parent"),
                p.optBoolean("liked"), p.optBoolean("reposted"), p.optLong("rpAt"), p.optBoolean("saved"), p.optBoolean("pinned"), p.optBoolean("edited"),
                p.optStr("remote"), ra, p.optBoolean("ai")).apply {
                rid = p.optStr("rid"); media = p.optJSONArray("media").strings()
                rpBy = p.optJSONObject("rpBy")?.let { r -> RpBy(r.optString("id"), r.optString("name"), r.optLong("t")) }
                lc = p.optInt("lc"); rpc = p.optInt("rpc"); shc = p.optInt("shc"); svc = p.optInt("svc"); rp = p.optInt("rp")
                sharedByMe = p.optBoolean("sharedByMe"); sharedAt = p.optLong("sharedAt"); noRetry = p.optBoolean("noRetry")
                zenReplied = p.optBoolean("zenReplied"); zenAnswered = p.optBoolean("zenAnswered"); zenLikeChecked = p.optBoolean("zenLikeChecked"); zenLike = p.optBoolean("zenLike")
                pub = p.optStr("pub")
            }
        }

        fun msgJson(m: LMsg): JSONObject = JSONObject().put("id", m.id).put("text", m.text).put("t", m.t).put("imgs", JSONArray(m.imgs)).apply {
            if (m.ai) put("ai", true)
            m.rpost?.let { put("rpost", JSONObject().put("id", it.id).put("u", it.u ?: JSONObject.NULL)) }
            m.zpost?.let { put("zpost", JSONObject().put("x", it.x).put("t", it.t).put("a", it.a ?: JSONObject.NULL)) }
            m.zm?.let { put("zm", it) }
        }

        fun msgOf(m: JSONObject): LMsg = LMsg(m.optString("id").ifEmpty { uid() }, m.optString("text", ""), m.optLong("t"), m.optJSONArray("imgs").strings(), m.optBoolean("ai"),
            m.optJSONObject("rpost")?.let { RPost(it.optString("id"), it.optStr("u")) }, m.optJSONObject("zpost")?.let { ZPost(it.optString("x"), it.optLong("t"), it.optStr("a")) }).apply { zm = m.optJSONArray("zm") }
    }
}

fun JSONObject.optStr(k: String): String? = if (!has(k) || isNull(k)) null else optString(k, "").ifEmpty { null }
fun JSONArray?.strings(): List<String> = if (this == null) emptyList() else (0 until length()).mapNotNull { optString(it, "").ifEmpty { null } }
inline fun JSONArray.forEachObj(f: (JSONObject) -> Unit) { for (i in 0 until length()) optJSONObject(i)?.let(f) }
fun JSONArray.objs(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }

// the same JSON written the same way whatever order its keys are in (the server's jsonb sorts them), for comparing copies
fun canonJson(v: Any?): String = when (v) {
    null, JSONObject.NULL -> "null"
    is JSONObject -> "{" + v.keys().asSequence().sorted().joinToString(",") { JSONObject.quote(it) + ":" + canonJson(v.opt(it)) } + "}"
    is JSONArray -> "[" + (0 until v.length()).joinToString(",") { canonJson(v.opt(it)) } + "]"
    is String -> JSONObject.quote(v)
    is Number -> if (v.toDouble() == Math.floor(v.toDouble()) && !v.toDouble().isInfinite()) v.toLong().toString() else v.toString()
    else -> v.toString()
}
