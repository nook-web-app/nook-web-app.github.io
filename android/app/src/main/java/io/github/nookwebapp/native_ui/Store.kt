package io.github.nookwebapp.native_ui

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

// Everything the app knows lives on this phone, in the same shape as the web app's state S (posts, chats, lists,
// profile, ui): one JSON file in the app's private storage, and the photos as files next to it. Nothing is sent anywhere.

// a post of the owner (the web app's S.posts entries without .ra or .ai)
class LPost(
    val id: String, text: String, val t: Long, imgs: List<String>, val parent: String?,
    liked: Boolean = false, reposted: Boolean = false, rpAt: Long = 0, saved: Boolean = false, pinned: Boolean = false, edited: Boolean = false,
) {
    var text by mutableStateOf(text)
    var imgs by mutableStateOf(imgs)
    var liked by mutableStateOf(liked)
    var reposted by mutableStateOf(reposted)
    var rpAt by mutableLongStateOf(rpAt)
    var saved by mutableStateOf(saved)
    var pinned by mutableStateOf(pinned)
    var edited by mutableStateOf(edited)
}

class LMsg(val id: String, val text: String, val t: Long, val imgs: List<String>)
class LChat(val id: String, name: String, val t: Long, msgs: List<LMsg> = emptyList(), draft: String = "") {
    var name by mutableStateOf(name)
    val msgs = mutableStateListOf<LMsg>().apply { addAll(msgs) }
    var draft by mutableStateOf(draft)
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
    // "less like this": the words a post had (people are only ever this phone's owner while offline)
    val lessWords = mutableMapOf<String, Int>()
    val hidden = mutableStateListOf<String>()
    var draft by mutableStateOf<Pair<String, Long>?>(null)
    // true once someone made an account on this phone (or signed in); until then the sign in page shows
    var signedIn by mutableStateOf(false)

    val mediaDir: File? get() = dir?.let { File(it, "media").apply { mkdirs() } }

    fun byId(id: String?) = if (id == null) null else posts.firstOrNull { it.id == id }
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
        signedIn = j.optBoolean("signedIn", false)
        j.optJSONObject("profile")?.let { p ->
            profile.name = p.optString("name", "Me"); profile.handle = p.optString("handle", "me").ifBlank { "me" }
            profile.bio = p.optString("bio", ""); profile.avatar = p.optStr("avatar"); profile.banner = p.optStr("banner")
            profile.bannerTheme = p.optString("bannerTheme", "default")
        }
        posts.clear()
        j.optJSONArray("posts")?.forEachObj { p ->
            posts.add(LPost(p.getString("id"), p.optString("text", ""), p.optLong("t"), p.optJSONArray("imgs").strings(), p.optStr("parent"),
                p.optBoolean("liked"), p.optBoolean("reposted"), p.optLong("rpAt"), p.optBoolean("saved"), p.optBoolean("pinned"), p.optBoolean("edited")))
        }
        chats.clear()
        j.optJSONArray("chats")?.forEachObj { c ->
            val msgs = mutableListOf<LMsg>()
            c.optJSONArray("msgs")?.forEachObj { m -> msgs.add(LMsg(m.getString("id"), m.optString("text", ""), m.optLong("t"), m.optJSONArray("imgs").strings())) }
            chats.add(LChat(c.getString("id"), c.optString("name", "Chat"), c.optLong("t"), msgs, c.optString("draft", "")))
        }
        lists.clear()
        j.optJSONArray("lists")?.forEachObj { l -> lists.add(LList(l.getString("id"), l.optString("name"), l.optString("desc", ""), l.optJSONArray("ids").strings())) }
        j.optJSONObject("ui")?.let { u ->
            theme = when (u.optString("theme")) { "dark" -> ThemeMode.Dark; "light" -> ThemeMode.Light; else -> ThemeMode.System }
            homeTab = u.optString("homeTab", "latest"); profTab = u.optString("profTab", "posts")
            langs = u.optJSONArray("langs")?.strings()?.takeIf { it.isNotEmpty() }
            hidden.clear(); hidden.addAll(u.optJSONArray("hidden").strings())
            lessWords.clear(); u.optJSONObject("less")?.let { l -> l.keys().forEach { k -> lessWords[k] = l.optInt(k) } }
        }
        j.optJSONObject("draft")?.let { d -> draft = d.optString("text") to d.optLong("t") }
    }

    // written to a new file first and then moved over the old one, so a crash in the middle never leaves half a file
    fun save() {
        val d = dir ?: return
        val j = JSONObject()
        j.put("v", 3).put("signedIn", signedIn)
        j.put("profile", JSONObject().put("name", profile.name).put("handle", profile.handle).put("bio", profile.bio)
            .put("avatar", profile.avatar ?: JSONObject.NULL).put("banner", profile.banner ?: JSONObject.NULL).put("bannerTheme", profile.bannerTheme))
        j.put("posts", JSONArray().apply {
            posts.forEach { p ->
                put(JSONObject().put("id", p.id).put("text", p.text).put("t", p.t).put("imgs", JSONArray(p.imgs)).put("parent", p.parent ?: JSONObject.NULL)
                    .put("liked", p.liked).put("reposted", p.reposted).put("rpAt", p.rpAt).put("saved", p.saved).put("pinned", p.pinned).put("edited", p.edited))
            }
        })
        j.put("chats", JSONArray().apply {
            chats.forEach { c ->
                put(JSONObject().put("id", c.id).put("name", c.name).put("t", c.t).put("draft", c.draft).put("msgs", JSONArray().apply {
                    c.msgs.forEach { m -> put(JSONObject().put("id", m.id).put("text", m.text).put("t", m.t).put("imgs", JSONArray(m.imgs))) }
                }))
            }
        })
        j.put("lists", JSONArray().apply { lists.forEach { l -> put(JSONObject().put("id", l.id).put("name", l.name).put("desc", l.desc).put("ids", JSONArray(l.ids.toList()))) } })
        j.put("ui", JSONObject().put("theme", when (theme) { ThemeMode.Dark -> "dark"; ThemeMode.Light -> "light"; else -> "system" })
            .put("homeTab", homeTab).put("profTab", profTab).put("langs", langs?.let { JSONArray(it) } ?: JSONObject.NULL)
            .put("hidden", JSONArray(hidden.toList())).put("less", JSONObject(lessWords as Map<*, *>)))
        draft?.let { (t, at) -> j.put("draft", JSONObject().put("text", t).put("t", at)) }
        val tmp = File(d, "state.json.tmp")
        tmp.writeText(j.toString())
        tmp.renameTo(File(d, "state.json"))
    }

    // the whole phone copy is removed: posts, chats, lists, photos (Delete account while offline)
    fun wipe() {
        posts.clear(); chats.clear(); lists.clear(); hidden.clear(); lessWords.clear(); draft = null
        profile.name = "Me"; profile.handle = "me"; profile.bio = ""; profile.avatar = null; profile.banner = null; profile.bannerTheme = "default"
        signedIn = false
        mediaDir?.listFiles()?.forEach { it.delete() }
        save()
    }

    // photos no post, chat or profile points at any more are removed from storage
    fun sweepMedia() {
        val used = HashSet<String>()
        posts.forEach { used.addAll(it.imgs) }
        chats.forEach { c -> c.msgs.forEach { used.addAll(it.imgs) } }
        profile.avatar?.let { used.add(it) }; profile.banner?.let { used.add(it) }
        mediaDir?.listFiles()?.forEach { f -> if (f.absolutePath !in used && System.currentTimeMillis() - f.lastModified() > 60_000) f.delete() }
    }

    companion object {
        fun open(ctx: Context) = Store(ctx.filesDir).apply { load() }
    }
}

private fun JSONObject.optStr(k: String): String? = if (isNull(k)) null else optString(k, "").ifEmpty { null }
private fun JSONArray?.strings(): List<String> = if (this == null) emptyList() else (0 until length()).mapNotNull { optString(it, "").ifEmpty { null } }
private inline fun JSONArray.forEachObj(f: (JSONObject) -> Unit) { for (i in 0 until length()) optJSONObject(i)?.let(f) }
