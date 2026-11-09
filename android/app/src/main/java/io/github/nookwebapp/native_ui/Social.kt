package io.github.nookwebapp.native_ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

// Other people: their profile page (userV), following, blocking, muting and reporting them, the lists of followers,
// search, and the link cards (previews) the posts and chats show.

// what a profile page knows about the person and how this account stands with them
class UserSt(val acc: JSONObject, var following: Boolean, var followsMe: Boolean, var blocked: Boolean, var muted: Boolean = false) {
    fun json(): JSONObject = JSONObject().put("acc", acc).put("following", following).put("followsMe", followsMe).put("blocked", blocked).put("muted", muted)
    companion object { fun of(j: JSONObject?) = j?.optJSONObject("acc")?.let { UserSt(it, j.optBoolean("following"), j.optBoolean("followsMe"), j.optBoolean("blocked"), j.optBoolean("muted")) } }
}

// the page of one person, kept while it is open
class UserPage(val id: String) {
    var st by mutableStateOf<UserSt?>(null)
    // "" while loading; "fail" when it could not load; "gone" when the account is not available; "blockedMe"
    var state by mutableStateOf("")
    var followers by mutableStateOf(0)
    var following by mutableStateOf(0)
    var theirReposts by mutableStateOf<List<Pair<String, Long>>>(emptyList())
    var version by mutableStateOf(0)
    var tabIds = HashMap<String, List<String>?>()
    var tabFail = HashSet<String>()
    var busy = false
    var queued = false
}

fun Online.loadUser(pg: UserPage) {
    val me = uid ?: return
    (Cache.read("ui:" + pg.id)?.v as? JSONObject)?.let { UserSt.of(it)?.let { st -> pg.st = st } }
    (Cache.read("rpt:" + pg.id)?.v as? JSONArray)?.let { a -> pg.theirReposts = a.objs().map { it.optString("post_id") to it.optLong("t") } }
    app.scope.launch { countsOf(pg.id) { a, b -> pg.followers = a; pg.following = b } }
    app.scope.launch { if (loadUserPosts(pg.id)) pg.version++ }
    app.scope.launch {
        val r = Sb.get(Q("reposts").select("post_id, created_at").eq("user_id", pg.id).order("created_at", false).limit(100))
        if (r.ok) {
            pg.theirReposts = r.rows.map { it.optString("post_id") to parseIso(it.optString("created_at")) }
            Cache.write("rpt:" + pg.id, JSONArray(pg.theirReposts.map { JSONObject().put("post_id", it.first).put("t", it.second) }))
        }
    }
    app.scope.launch {
        val acc = Sb.get(Q("accounts").select(ACC_COLS).eq("id", pg.id))
        val fol = Sb.get(Q("follows").select("followee_id").eq("follower_id", me).eq("followee_id", pg.id))
        val folMe = Sb.get(Q("follows").select("follower_id").eq("follower_id", pg.id).eq("followee_id", me))
        val blk = Sb.get(Q("blocks").select("blocked_id").eq("blocker_id", me).eq("blocked_id", pg.id))
        val theyBlock = Sb.get(Q("blocks").select("blocker_id").eq("blocker_id", pg.id).eq("blocked_id", me))
        val mu = Sb.get(Q("mutes").select("muted_id").eq("muter_id", me).eq("muted_id", pg.id))
        if (listOf(acc, fol, folMe, blk, theyBlock).any { !it.ok }) { if (pg.st == null) pg.state = "fail"; return@launch }
        val a = acc.one ?: run { pg.state = "gone"; return@launch }
        if (theyBlock.rows.isNotEmpty()) { pg.state = "blockedMe"; return@launch }
        val st = UserSt(a, fol.rows.isNotEmpty(), folMe.rows.isNotEmpty(), blk.rows.isNotEmpty(), if (mu.ok) mu.one != null else pg.st?.muted == true)
        pg.st = st; pg.state = "ok"
        Cache.write("ui:" + pg.id, st.json())
        // the posts of this person show their pinned one first
        val pin = a.optStr("pinned_post_id")
        s.posts.forEach { p -> if (p.ra?.id == pg.id) p.pinned = pin != null && p.remote == pin }
    }
}

// follow / unfollow; a tap while one is running waits its turn instead of being lost
fun Online.toggleFollow(pg: UserPage) {
    val st = pg.st ?: return
    val me = uid ?: return
    if (pg.busy) { pg.queued = true; return }
    pg.busy = true
    app.scope.launch {
        try {
            do {
                pg.queued = false
                val on = !st.following
                st.following = on; pg.followers += if (on) 1 else -1; pg.version++
                Cache.write("ui:" + pg.id, st.json())
                val r = if (on) Sb.insert("follows", JSONObject().put("follower_id", me).put("followee_id", pg.id)) else Sb.delete(Q("follows").eq("follower_id", me).eq("followee_id", pg.id))
                val e = r.error
                if (e != null && !(on && e.code == "23505")) { st.following = !on; pg.followers += if (on) -1 else 1; pg.version++; Cache.write("ui:" + pg.id, st.json()); app.say("Could not update follow") }
                else { follows = if (on) follows + pg.id else follows - pg.id }
            } while (pg.queued)
        } finally { pg.busy = false }
    }
}

// setBlocked(): blocking also ends the follows between the two people; the feed is asked again afterwards
suspend fun Online.setBlocked(id: String, on: Boolean): Boolean {
    val me = uid ?: return false
    val r = if (on) Sb.insert("blocks", JSONObject().put("blocker_id", me).put("blocked_id", id)) else Sb.delete(Q("blocks").eq("blocker_id", me).eq("blocked_id", id))
    val e = r.error
    if (e != null && !(on && e.code == "23505")) return false
    if (on) {
        Sb.delete(Q("follows").eq("follower_id", me).eq("followee_id", id))
        Sb.delete(Q("follows").eq("follower_id", id).eq("followee_id", me))
    }
    loadFeed()
    return true
}

fun Online.toggleBlock(pg: UserPage) {
    val st = pg.st ?: return
    app.scope.launch {
        val on = !st.blocked
        st.blocked = on; pg.version++
        if (!setBlocked(pg.id, on)) { st.blocked = !on; pg.version++; app.say("Could not update block"); return@launch }
        st.following = false; st.followsMe = false; pg.version++
        Cache.write("ui:" + pg.id, st.json())
        countsOf(pg.id) { a, b -> pg.followers = a; pg.following = b }
        app.say(if (on) "Blocked" else "Unblocked")
    }
}

fun Online.toggleMute(pg: UserPage) {
    val st = pg.st ?: return
    val me = uid ?: return
    app.scope.launch {
        val on = !st.muted
        val r = if (on) Sb.insert("mutes", JSONObject().put("muter_id", me).put("muted_id", pg.id)) else Sb.delete(Q("mutes").eq("muter_id", me).eq("muted_id", pg.id))
        val e = r.error
        if (e != null && !(on && e.code == "23505")) { app.say("Could not update mute"); return@launch }
        st.muted = on; Cache.write("ui:" + pg.id, st.json())
        app.say(if (on) "Muted. Their posts are hidden from your feed" else "Unmuted")
        loadFeed()
    }
}

// reportAccount(): tell us an account breaks the rules
fun Online.reportAccount(id: String) {
    val me = uid ?: return
    val why = listOf("harassment" to "Bullying or harassment", "hate" to "Hate speech", "threats" to "Threats or violence", "selfharm" to "Self harm",
        "sexual" to "Sexual content", "impersonation" to "Pretending to be someone", "spam" to "Spam or scam", "other" to "Something else")
    app.open(why.map { (k, label) ->
        SheetItem(label) {
            app.scope.launch {
                val r = Sb.insert("user_reports", JSONObject().put("reporter_id", me).put("reported_id", id).put("reason", k))
                if (r.error != null && r.error.code != "23505") { app.say("Could not send the report"); return@launch }
                app.say("Thanks, we will check it")
            }
        }
    } + SheetItem("Cancel", cancel = true), "Why are you reporting this account?")
}

// the reposts and likes tabs of a profile: the ids of the posts, read page by page
suspend fun Online.idsTab(pg: UserPage, name: String): List<String>? {
    val key = "ids:$name:" + pg.id
    (Cache.read(key)?.v as? JSONArray)?.let { pg.tabIds[name] = it.strings() }
    val r = Sb.pageAll { Q(name).select("post_id").eq("user_id", pg.id).order("post_id") }
    if (!r.ok) { if (pg.tabIds[name] == null) pg.tabFail.add(name); pg.version++; return pg.tabIds[name] }
    val ids = r.rows.map { it.optString("post_id") }
    Cache.write(key, JSONArray(ids))
    pg.tabIds[name] = ids; pg.tabFail.remove(name)
    // the posts behind the ids that this phone does not have yet are fetched
    val have = s.posts.mapNotNull { it.remote }.toSet()
    val miss = ids.filter { it !in have }.take(100)
    if (miss.isNotEmpty()) mapRemotePosts(postsGet("id, user_id, body, created_at, parent_id, media_url") { Q("posts").select(it).inList("id", miss) }.rows)
    pg.version++
    return ids
}

// followListV(): followers or following, without people who blocked or were blocked
suspend fun Online.followIds(id: String, followers: Boolean): List<String>? {
    val me = uid ?: return null
    val col = if (followers) "follower_id" else "followee_id"
    val keyCol = if (followers) "followee_id" else "follower_id"
    val a = Sb.pageAll { Q("follows").select(col).eq(keyCol, id).order(col) }
    val b = Sb.pageAll { Q("blocks").select("blocker_id, blocked_id").or("blocker_id.eq.$me,blocked_id.eq.$me").order("blocker_id").order("blocked_id") }
    if (!a.ok || !b.ok) return null
    val hidden = b.rows.map { if (it.optString("blocker_id") == me) it.optString("blocked_id") else it.optString("blocker_id") }.toSet()
    val ids = a.rows.map { it.optString(col) }.filter { it !in hidden }
    Cache.write("fl:" + (if (followers) "followers" else "following") + ":" + id, JSONArray(ids))
    return ids
}

// searchV(): suggested people (a mix that changes every 15 to 25 minutes) or the people a search finds
private var discSeed: Pair<String, Long>? = null
suspend fun Online.suggest(): Pair<List<JSONObject>?, Long> {
    val d = discSeed?.takeIf { it.second > System.currentTimeMillis() } ?: (uid() to System.currentTimeMillis() + ((15 + Math.random() * 10) * 60_000).toLong()).also { discSeed = it }
    val r = Sb.rpc("discover_accounts", JSONObject().put("p_seed", d.first).put("p_n", 12))
    if (!r.ok) return null to 15_000
    val rows = r.rows
    return rows to if (rows.isNotEmpty()) maxOf(1000, d.second - System.currentTimeMillis()) + 500 else 15_000
}
suspend fun Online.searchPeople(q: String): List<JSONObject>? { val r = Sb.rpc("search_accounts", JSONObject().put("p_q", q)); return if (r.ok) r.rows else null }

suspend fun Online.blockedIds(): List<String>? {
    val me = uid ?: return null
    val r = Sb.get(Q("blocks").select("blocked_id").eq("blocker_id", me))
    return if (r.ok) r.rows.map { it.optString("blocked_id") }.filter { it.isNotEmpty() } else null
}
suspend fun Online.unblock(id: String): Boolean {
    val me = uid ?: return false
    val r = Sb.delete(Q("blocks").eq("blocker_id", me).eq("blocked_id", id))
    if (!r.ok) { app.say("Could not unblock"); return false }
    app.say("Unblocked"); loadFeed(); return true
}
suspend fun Online.unhide(id: String): Boolean {
    val me = uid ?: return false
    val r = Sb.delete(Q("dm_mutes").eq("owner_id", me).eq("target_id", id))
    if (!r.ok) { app.say("Could not unhide"); return false }
    dm.hideSet.remove(id); refreshBadge(false); app.say("Chat is back in your list"); return true
}

// ---- link cards ----

private val TRACKING = setOf("fbclid", "gclid", "gbraid", "wbraid", "dclid", "msclkid", "yclid", "twclid", "igshid", "igsh", "si", "feature", "pp", "mc_cid", "mc_eid", "ref_src", "ref_url", "_hsenc", "_hsmi", "mkt_tok", "vero_id", "s_cid", "spm", "xtok", "xmt", "ttclid", "sfnsn", "share_id")
private val PLAIN_HOSTS = Regex("(^|\\.)(instagram\\.com|ig\\.me|facebook\\.com|fb\\.com|fb\\.watch)$", RegexOption.IGNORE_CASE)
// cleanUrl(): links lose what follows the ? when it is only tracking
fun cleanUrl(u: String): String {
    val i = u.indexOf('?')
    if (i < 0) return u
    val host = runCatching { java.net.URI(u).host ?: "" }.getOrDefault("")
    val at = u.indexOf('#', i)
    if (PLAIN_HOSTS.containsMatchIn(host)) return u.substring(0, i) + if (at < 0) "" else u.substring(at)
    val qs = u.substring(i + 1, if (at < 0) u.length else at); val hash = if (at < 0) "" else u.substring(at)
    val kept = qs.split("&").filter { kv -> val k = kv.split("=")[0].lowercase(); kv.isNotEmpty() && !k.startsWith("utm_") && k !in TRACKING }
    return u.substring(0, i) + (if (kept.isNotEmpty()) "?" + kept.joinToString("&") else "") + hash
}
private val TEXT_URL_RE = Regex("https?://[^\\s<>\"]+", RegexOption.IGNORE_CASE)
private val TEXT_URL_TAIL = Regex("[.,!?)\\]]+$")
fun cleanText(t: String): String = TEXT_URL_RE.replace(t) { m ->
    val tail = TEXT_URL_TAIL.find(m.value)?.value ?: ""
    cleanUrl(m.value.dropLast(tail.length)) + tail
}
fun hostOf(u: String) = runCatching { (java.net.URI(u).host ?: u).removePrefix("www.") }.getOrDefault(u)
private val YT_RE = Regex("(?:youtube\\.com/(?:watch\\?(?:.*&)?v=|shorts/|embed/|live/)|youtu\\.be/)([\\w-]{6,})", RegexOption.IGNORE_CASE)
private fun ytId(u: String) = YT_RE.find(u)?.groupValues?.get(1)

private val pvMem = HashMap<String, kotlinx.coroutines.Deferred<JSONObject?>>()
// getPreview(): a card for a link: the title, a line, a picture and the site; kept for the 150 newest links
suspend fun Online.getPreview(url: String): JSONObject? {
    s.previews[url]?.takeIf { it.has("v") }?.let { return it }
    val d = pvMem[url] ?: app.scope.async {
        val yt = ytId(url)
        val got: JSONObject? = if (yt != null) {
            val t = Sb.text("https://www.youtube.com/oembed?format=json&url=" + java.net.URLEncoder.encode(url, "UTF-8"))?.let { runCatching { JSONObject(it).optString("title") }.getOrNull() } ?: ""
            JSONObject().put("t", t).put("d", "").put("i", "https://i.ytimg.com/vi/$yt/hqdefault.jpg").put("s", "YouTube").put("v", 2)
        } else if (uid == null) null else {
            val r = Sb.fn("preview", JSONObject().put("url", url))
            val b = r.body
            if (!r.ok || (b.optString("title").isEmpty() && b.optString("image").isEmpty())) null
            else JSONObject().put("t", b.optString("title")).put("d", b.optString("description")).put("i", b.optString("image").takeIf { it.startsWith("https://", true) } ?: "").put("s", b.optString("site").ifEmpty { hostOf(url) }).put("v", 2)
        }
        if (got != null) {
            s.previews[url] = got
            while (s.previews.size > 150) s.previews.remove(s.previews.keys.first())
        } else app.scope.launch { kotlinx.coroutines.delay(600_000); pvMem.remove(url) }
        got
    }.also { pvMem[url] = it }
    return d.await()
}

// getFocus(): where the main thing in a link's picture is, so the crop keeps it in view (not in chats)
suspend fun Online.getFocus(url: String, img: String): Pair<Float, Float>? {
    s.previews[url]?.optJSONObject("f")?.let { return it.optDouble("x").toFloat() to it.optDouble("y").toFloat() }
    if (uid == null) return null
    val r = Sb.fn("focus", JSONObject().put("url", img), timeoutS = 20)
    if (!r.ok || !r.body.has("x") || !r.body.has("y")) return null
    val f = r.body.optDouble("x").toFloat() to r.body.optDouble("y").toFloat()
    s.previews[url]?.put("f", JSONObject().put("x", f.first).put("y", f.second))
    return f
}

private val IG_HOST = Regex("(^|\\.)instagram\\.com$", RegexOption.IGNORE_CASE)
private val IG_WHO = Regex("\\(@([\\w.]+)\\)")
private val IG_WHO2 = Regex("\\s-\\s([\\w.]+) on ")
private val IG_CAP = Regex(":\\s*[\"\\u201c]([\\s\\S]*)$")
private val IG_CAP_END = Regex("[\"\\u201d]\\.?\\s*$")
private val IG_TAG = Regex("#[\\p{L}\\p{N}_]+")
private val SPACES = Regex("\\s+")
private val ELLIPSIS = Regex("(\\u2026|\\.\\.\\.)$")
private val IG_SENT = Regex("^([\\s\\S]*[.!?])(\\s|$)")
private val IG_TITLE = Regex("\\s*[\\u2022\\u00b7|-]\\s*Instagram.*$", RegexOption.IGNORE_CASE)
private val IG_PLAIN = Regex("\\s*[\\u2022\\u00b7]\\s*Instagram (photo|video|reel)s?$", RegexOption.IGNORE_CASE)

// cardText(): for Instagram only the @username and the caption without hashtags, for everything else just the page title
fun cardText(d: JSONObject?, url: String): Pair<String, String> {
    val t = d?.optString("t") ?: ""
    val desc = d?.optString("d") ?: ""
    if (IG_HOST.containsMatchIn(hostOf(url))) {
        val who = IG_WHO.find(t)?.groupValues?.get(1) ?: IG_WHO2.find(desc)?.groupValues?.get(1)
        var cap = IG_CAP.find(desc)?.groupValues?.get(1)?.replace(IG_CAP_END, "")?.replace(IG_TAG, "")?.replace(SPACES, " ")?.trim() ?: ""
        if (ELLIPSIS.containsMatchIn(cap)) {
            val body = cap.replace(ELLIPSIS, "").trim()
            val full = IG_SENT.find(body)?.groupValues?.get(1)
            cap = if (full != null && full.length >= 12) full else "$body…"
        }
        return (if (who != null) "@$who" else t.replace(IG_TITLE, "")) to cap
    }
    return t.replace(IG_PLAIN, "") to ""
}

// the banned words a post may not have (bannedHit)
private val BANNED_WORDS = listOf("nigger", "nigga", "n1gga", "n1gger", "nigg4", "nigg3r", "n1gg4", "n1gg3r")
fun bannedHit(text: String): String? {
    val norm = " " + java.text.Normalizer.normalize(text.lowercase(), java.text.Normalizer.Form.NFKD).replace(Regex("\\p{M}+"), "").replace(Regex("[^\\p{L}\\p{N}]+"), " ").trim() + " "
    return BANNED_WORDS.firstOrNull { norm.contains(" $it ") }
}

// ---- the own profile ----

// avatarValue(): a picture becomes a small round PNG kept in the profile row; a moving one is stored as a file instead
suspend fun Online.avatarValue(src: String?): String? {
    if (src == null) return null
    if (src.startsWith("data:") || src.startsWith("http")) return src
    val me = uid ?: return null
    val b = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { Photos.bytesOf(src) } ?: return null
    if (mimeOf(b) == "image/gif") {
        val path = "$me/avatar-" + System.currentTimeMillis() + ".gif"
        if (uploadKept(path, b, "image/gif")) return null
        return Sb.publicUrl("media", path)
    }
    return kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) {
        val bm = Photos.decodeUpright(b, 160) ?: return@withContext null
        val k = minOf(1f, 160f / maxOf(bm.width, bm.height))
        val w = maxOf(1, Math.round(bm.width * k)); val h = maxOf(1, Math.round(bm.height * k))
        val out = android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.ARGB_8888)
        val cv = android.graphics.Canvas(out)
        // only the circle people really see is kept: the corners outside it are cleared
        val path = android.graphics.Path().apply { addCircle(w / 2f, h / 2f, minOf(w, h) / 2f, android.graphics.Path.Direction.CW) }
        cv.clipPath(path)
        cv.drawBitmap(bm, null, android.graphics.Rect(0, 0, w, h), android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG))
        val bos = java.io.ByteArrayOutputStream()
        out.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, bos)
        "data:image/png;base64," + Crypto.b64(bos.toByteArray())
    }
}

// bannerUrl(): a banner picked on this phone goes to storage, and its link to the profile row
suspend fun Online.bannerUrl(src: String?): String? {
    if (src == null || src.startsWith("http")) return src
    val me = uid ?: return null
    val b = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { Photos.bytesOf(src) } ?: return null
    val path = "$me/banner-" + System.currentTimeMillis() + ".jpg"
    if (uploadKept(path, b, mimeOf(b))) return null
    return Sb.publicUrl("media", path)
}

// uploadKept(): true when the file could not be stored. A try whose answer was lost may have worked, so a second try that
// says "already there" counts as done; up to three tries
suspend fun uploadKept(path: String, bytes: ByteArray, type: String): Boolean {
    repeat(3) { i ->
        val e = Sb.upload("media", path, bytes, type) ?: return false
        if (e.status == 409 || Regex("exist|duplicate", RegexOption.IGNORE_CASE).containsMatchIn(e.message)) return false
        kotlinx.coroutines.delay(1200L * (i + 1))
    }
    return true
}

// editProfile(): the editor only closes when the server took the change; the pictures follow behind it
suspend fun Online.saveProfile(name0: String, handle0: String, bio: String, avatar: String?, banner: String?, theme: String): String? {
    val pr = s.profile
    val newHandle = handle0.trim().lowercase()
    val lockDays = pr.handleChangedAt?.let { val t = parseIso(it) + 7 * 86_400_000 - System.currentTimeMillis(); if (t > 0) Math.ceil(t / 86_400_000.0).toInt() else 0 } ?: 0
    val changed = newHandle != pr.handle
    if (changed) {
        if (lockDays > 0) return "You can change your handle again in $lockDays" + if (lockDays == 1) " day" else " days"
        if (newHandle.isEmpty()) return "Your handle can not be empty"
        if (!Regex("^[a-z0-9._]{1,15}$").matches(newHandle)) return "Handle: letters, numbers, dots or underscores, up to 15"
    }
    val me = uid
    if (changed && me != null) {
        val r = Sb.update(Q("accounts").eq("id", me), org.json.JSONObject().put("username", newHandle), select = "username, handle_changed_at")
        val row = r.one
        if (!r.ok || row == null) {
            val m = Regex("handle_locked:(\\d+)").find(r.error?.message ?: "")
            return when {
                m != null -> "You can change your handle again in " + m.groupValues[1] + if (m.groupValues[1] == "1") " day" else " days"
                r.error?.code == "23505" -> "That handle is taken"
                Regex("invalid_handle|handle_required").containsMatchIn(r.error?.message ?: "") -> "That handle is not allowed"
                else -> "Could not save the handle"
            }
        }
        pr.handle = row.optString("username"); pr.handleChangedAt = row.optStr("handle_changed_at")
    } else if (changed) pr.handle = newHandle
    val was = listOf(pr.name, pr.bio, pr.avatar, pr.banner, pr.bannerTheme)
    pr.name = name0.trim().take(15); pr.bio = bio; pr.avatar = avatar; pr.banner = banner; pr.bannerTheme = theme
    if (me != null) {
        val ue = Sb.update(Q("accounts").eq("id", me), org.json.JSONObject().put("bio", pr.bio).put("display_name", pr.name).put("banner_theme", pr.bannerTheme))
        if (!ue.ok) { pr.name = was[0]!!; pr.bio = was[1]!!; pr.avatar = was[2]; pr.banner = was[3]; pr.bannerTheme = was[4]!!; return "Could not save your profile. " + plainErr(ue.error?.message, "Try again") }
        // a picture already saved on the server is not sent again
        if (!(avatar == was[2] && pr.avSynced == avatar)) app.scope.launch {
            val small = if (avatar == null) null else avatarValue(avatar) ?: run { app.say("Could not upload profile photo"); return@launch }
            val r = Sb.update(Q("accounts").eq("id", me), org.json.JSONObject().put("avatar", small ?: org.json.JSONObject.NULL))
            if (!r.ok) app.say("The new picture was not saved. " + plainErr(r.error?.message, "Try again later")) else { pr.avSynced = avatar; app.persist() }
            loadFeed()
            rememberAccount(pr.handle, pr.name.ifEmpty { pr.handle }, small)
        }
        if (!(banner == was[3] && pr.bnSynced == banner)) app.scope.launch {
            val url = if (banner == null) null else bannerUrl(banner) ?: run { app.say("Could not upload banner"); return@launch }
            val r = Sb.update(Q("accounts").eq("id", me), org.json.JSONObject().put("banner", url ?: org.json.JSONObject.NULL))
            if (!r.ok) app.say("The new banner was not saved. " + plainErr(r.error?.message, "Try again later"))
            else if (pr.banner == banner || pr.banner == url) { pr.bnSynced = url; if (url != null && pr.banner == banner) pr.banner = url; app.persist() }
        }
        rememberAccount(pr.handle, pr.name.ifEmpty { pr.handle }, null)
    }
    app.persist()
    app.say("Profile saved")
    return null
}
