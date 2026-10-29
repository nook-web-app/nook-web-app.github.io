package io.github.nookwebapp.native_ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

// Everything the app does with the server, ported from app.js function by function (the name of each one is in its
// comment). The state that the pages draw from is Compose state; the work runs in the app's scope on the main thread
// and every network call hops to a background thread by itself (Sb).
class Online(val app: AppState) {
    val s get() = app.store
    val uid: String? get() = Sb.user?.id
    var me by mutableStateOf<SbUser?>(null)
    // "loading" until the first answer, "error" when the posts could not be fetched, "ok" after a good answer
    var feedStatus by mutableStateOf("loading")
    var feedTries = 0
    private var feedRetry: kotlinx.coroutines.Job? = null
    private var feedBusy = false
    private var feedAgain = false
    var follows by mutableStateOf<Set<String>>(emptySet())
    // the bell's dot and the number on the chats button
    var unreadN by mutableIntStateOf(0)
    var unreadPeople by mutableIntStateOf(0)
    // posting is paused until this time (milliseconds) after posts were taken down
    var lockUntil = 0L
    var lockStrikes = 0
    // a like or repost tapped while a load was running is newer than the rows read before it
    private class Tap(var t: Long = 0, var l: Pair<Boolean, Int>? = null, var r: Pair<Boolean, Int>? = null)
    private val tapAt = LinkedHashMap<String, Tap>()
    private val busyTaps = HashSet<String>()
    // ids the server did not return (removed or hidden posts) are not asked for again during this visit
    private val wantGone = HashSet<String>()
    // nicknames and chat clears (loadSocial)
    val nickMap = HashMap<String, String>()
    val clearMap = HashMap<String, Long>()
    var nickVersion by mutableIntStateOf(0)
    private var socialAt = 0L
    private var socialJob: kotlinx.coroutines.Deferred<Unit>? = null
    // profiles of people as the chats and notifications show them (acctCache): id -> row with "name"
    val acctCache = HashMap<String, JSONObject>()

    fun isOwner() = Sb.isOwner()
    fun nickOf(id: String) = nickMap[id] ?: ""

    // ---- profiles ----

    class Accts(val m: HashMap<String, JSONObject>, var failed: Boolean = false) { fun get(id: String) = m[id] }

    // cachedAccounts(): anything seen before shows at once, old ones are refreshed in the background
    suspend fun cachedAccounts(ids: Collection<String>): Accts {
        val out = Accts(HashMap())
        val miss = ArrayList<String>(); val stale = ArrayList<String>()
        ids.filter { it.isNotEmpty() }.toSet().forEach { id ->
            val r = Cache.read("acct:$id")
            val v = r?.v as? JSONObject
            if (v != null) { out.m[id] = v; if (System.currentTimeMillis() - r.t >= 10 * 60_000) stale.add(id) } else miss.add(id)
        }
        suspend fun pull(list: List<String>) {
            val r = Sb.get(Q("accounts").select(ACC_COLS).inList("id", list))
            if (!r.ok) out.failed = true
            r.rows.forEach { a -> out.m[a.optString("id")] = a; Cache.write("acct:" + a.optString("id"), a) }
        }
        if (stale.isNotEmpty()) app.scope.launch { runCatching { pull(stale) } }
        if (miss.isEmpty()) return out
        coroutineScope { miss.chunked(80).map { c -> async { pull(c) } }.forEach { it.await() } }
        return out
    }

    // acctsFor(): the profiles of the chats and notifications, with their shown name
    suspend fun acctsFor(ids: Collection<String>): HashMap<String, JSONObject> {
        val need = ids.filter { it.isNotEmpty() && !acctCache.containsKey(it) }.toSet()
        if (need.isEmpty()) return acctCache
        val m = cachedAccounts(need)
        need.forEach { id ->
            val a = m.get(id)
            if (a != null) acctCache[id] = JSONObject(a.toString()).put("name", a.optString("display_name").ifEmpty { a.optString("username") })
            else if (!m.failed) acctCache[id] = JSONObject().put("id", id).put("username", "user").put("name", "user")
        }
        return acctCache
    }

    fun nameOf(a: JSONObject?): String = a?.let { if (it.isNull("display_name")) it.optString("username") else it.optString("display_name") } ?: "user"
    fun authorOf(id: String, a: JSONObject) = Author(id, nameOf(a), a.optString("username"), a.optStr("avatar"))

    // countsOf(): followers and following, shown from the cache first
    suspend fun countsOf(id: String, paint: (Int, Int) -> Unit) {
        (Cache.read("fc:$id")?.v as? JSONObject)?.let { paint(it.optInt("followers"), it.optInt("following")) }
        val (a, b) = coroutineScope {
            val x = async { Sb.count(Q("follows").select("follower_id").eq("followee_id", id)) }
            val y = async { Sb.count(Q("follows").select("followee_id").eq("follower_id", id)) }
            x.await() to y.await()
        }
        if (a.ok && b.ok) {
            Cache.write("fc:$id", JSONObject().put("followers", a.count ?: 0).put("following", b.count ?: 0))
            paint(a.count ?: 0, b.count ?: 0)
        }
    }

    // ---- the feed ----

    fun parseMedia(v: Any?): List<String> {
        if (v !is String || v.isEmpty()) return emptyList()
        if (v.startsWith("[")) return runCatching { JSONArray(v).strings() }.getOrDefault(emptyList())
        return listOf(v)
    }

    // rowsFor(): every group of ids is read page by page, and one group that fails fails the whole answer
    private suspend fun rowsFor(table: String, ids: List<String>): List<JSONObject>? = coroutineScope {
        val parts = ids.chunked(80).map { c -> async { Sb.pageAll { Q(table).select("post_id, user_id").inList("post_id", c).order("post_id").order("user_id") } } }.map { it.await() }
        if (parts.any { !it.ok }) null else parts.flatMap { it.rows }
    }

    class Stats(val sh: HashMap<String, Int> = HashMap(), val sv: HashMap<String, Int> = HashMap(), val myShared: HashSet<String> = HashSet(), val mySaved: HashSet<String> = HashSet())
    // shareSaveStats(): counts of shares and saves (plus this person's own) from one server call
    suspend fun shareSaveStats(ids: List<String>): Stats = coroutineScope {
        val out = Stats()
        ids.chunked(400).map { c -> async { Sb.rpc("post_share_save_stats", JSONObject().put("p_ids", JSONArray(c))) } }.map { it.await() }.forEach { r ->
            r.rows.forEach { x ->
                val id = x.optString("post_id")
                out.sh[id] = x.optInt("shares"); out.sv[id] = x.optInt("saves")
                if (x.optBoolean("i_shared")) out.myShared.add(id)
                if (x.optBoolean("i_saved")) out.mySaved.add(id)
            }
        }
        out
    }

    private fun feedFail() {
        feedStatus = "error"
        if (feedRetry == null && feedTries < 8) {
            feedTries++
            feedRetry = app.scope.launch { delay(minOf(30_000L, 4000L * feedTries)); feedRetry = null; loadFeed() }
        }
    }

    // loadFeed(): one load at a time; a call while one runs makes one more afterwards
    fun loadFeed() {
        if (uid == null) return
        if (feedBusy) { feedAgain = true; return }
        feedBusy = true
        app.scope.launch {
            try { loadFeedNow() } catch (e: Exception) { feedFail() }
            finally { feedBusy = false; if (feedAgain) { feedAgain = false; loadFeed() } }
        }
    }

    private suspend fun loadFeedNow() = coroutineScope {
        val me = uid ?: return@coroutineScope
        val feedT0 = System.currentTimeMillis()
        val postsQ = async {
            var pq = Sb.get(Q("posts_feed").select("id, user_id, body, created_at, parent_id, media_url, media_inline, edited_at").order("created_at", false).limit(300))
            if (!pq.ok) pq = Sb.get(Q("posts_feed").select("id, user_id, body, created_at, parent_id, media_url, media_inline").order("created_at", false).limit(300))
            if (!pq.ok) pq = Sb.get(Q("posts").select("id, user_id, body, created_at, parent_id, media_url").order("created_at", false).limit(300))
            pq
        }
        val followsQ = async { Sb.pageAll { Q("follows").select("followee_id").eq("follower_id", me).order("followee_id") } }
        val myLikesQ = async { Sb.pageAll { Q("likes").select("post_id").eq("user_id", me).order("post_id") } }
        val myRepostsQ = async { Sb.pageAll { Q("reposts").select("post_id, created_at").eq("user_id", me).order("post_id") } }
        val blocksOutQ = async { Sb.pageAll { Q("blocks").select("blocked_id").eq("blocker_id", me).order("blocked_id") } }
        val blocksInQ = async { Sb.pageAll { Q("blocks").select("blocker_id").eq("blocked_id", me).order("blocker_id") } }
        val mutesQ = async { Sb.pageAll { Q("mutes").select("muted_id").eq("muter_id", me).order("muted_id") } }
        val meRowQ = async { Sb.get(Q("accounts").select(ACC_COLS).eq("id", me)) }
        val pq = postsQ.await()
        if (!pq.ok) { feedFail(); return@coroutineScope }
        val posts = pq.rows.toMutableList()
        val ids0 = posts.map { it.optString("id") }
        val likeRowsP = async { rowsFor("likes", ids0) }
        val repostRowsP = async { rowsFor("reposts", ids0) }
        val statsP = async { shareSaveStats(ids0) }
        // photos already held from an earlier load are reused; the newest few missing ones are fetched now, the rest afterwards
        val prevImgs = HashMap<String, List<String>>()
        s.posts.forEach { p -> if (!p.prov && p.remote != null && p.imgs.isNotEmpty()) prevImgs[p.remote!!] = p.imgs }
        val inlAll = posts.filter { it.optBoolean("media_inline") && !prevImgs.containsKey(it.optString("id")) }
        val inlP = async {
            val inl = inlAll.take(12)
            if (inl.isNotEmpty()) {
                val full = Sb.get(Q("posts").select("id, media_url").inList("id", inl.map { it.optString("id") }))
                val m = full.rows.associate { it.optString("id") to it.opt("media_url") }
                inl.forEach { p -> if (m.containsKey(p.optString("id"))) { p.put("media_url", m[p.optString("id")]); p.put("media_inline", false) } }
            }
        }
        val imgsOf = HashMap<String, List<String>>()
        posts.forEach { p -> val id = p.optString("id"); if (p.optBoolean("media_inline") && prevImgs.containsKey(id)) { p.put("media_inline", false); imgsOf[id] = prevImgs[id]!! } }
        // what the people you follow reposted comes in too, even when the post itself is older than the newest 300
        var rpRows = listOf<JSONObject>(); var rpFailed = false
        try {
            val fq = followsQ.await()
            if (!fq.ok) throw IllegalStateException("follows")
            val fids = fq.rows.map { it.optString("followee_id") }
            if (fids.isNotEmpty()) {
                val rqs = fids.chunked(80).map { c -> async { Sb.get(Q("reposts").select("user_id, post_id, created_at").inList("user_id", c).order("created_at", false).limit(60)) } }.map { it.await() }
                if (rqs.any { !it.ok }) throw IllegalStateException("reposts")
                rpRows = rqs.flatMap { it.rows }.sortedByDescending { parseIso(it.optString("created_at")) }.take(60).filter { it.optString("user_id") != me }
                val have = posts.map { it.optString("id") }.toSet()
                val miss = rpRows.map { it.optString("post_id") }.distinct().filter { it !in have }.take(60)
                if (miss.isNotEmpty()) postsGet("id, user_id, body, created_at, parent_id, media_url") { Q("posts").select(it).inList("id", miss) }.rows.forEach { p -> if (p.isNull("parent_id") || p.optString("parent_id").isEmpty()) posts.add(p) }
            }
        } catch (e: Exception) { rpRows = emptyList(); rpFailed = true }
        inlP.await()
        val inlLater = inlAll.filter { it.optBoolean("media_inline") }.map { it.optString("id") }
        val pend = s.pendDel.toSet()
        if (s.pendDel.isNotEmpty()) runCatching { deleteRemote(s.pendDel.toList().map { r -> LPost("x", "", 0, emptyList(), null, remote = r) }) }
        val ids = posts.map { it.optString("id") }
        val extra = ids.drop(ids0.size)
        val likeRows = likeRowsP.await()?.let { a -> if (extra.isEmpty()) a else rowsFor("likes", extra)?.let { a + it } }
        val repostRows = repostRowsP.await()?.let { a -> if (extra.isEmpty()) a else rowsFor("reposts", extra)?.let { a + it } }
        val shareStats = statsP.await().also { st -> if (extra.isNotEmpty()) shareSaveStats(extra).let { b -> st.sh.putAll(b.sh); st.sv.putAll(b.sv); st.myShared.addAll(b.myShared); st.mySaved.addAll(b.mySaved) } }
        val myLikes = myLikesQ.await(); val myReposts = myRepostsQ.await(); val blocksOut = blocksOutQ.await(); val blocksIn = blocksInQ.await()
        val meRow = meRowQ.await(); val myFollows = followsQ.await(); val myMutes = mutesQ.await()
        // a failed answer is not an empty one: nothing is changed (a blocked or muted person must not come back because a call failed)
        if (rpFailed || !myLikes.ok || !myReposts.ok || !blocksOut.ok || !blocksIn.ok || likeRows == null || repostRows == null || !myMutes.ok) { feedFail(); return@coroutineScope }
        if (uid != me) return@coroutineScope
        feedStatus = "ok"; feedTries = 0
        if (myFollows.ok) { follows = myFollows.rows.map { it.optString("followee_id") }.toSet(); Cache.write("follows:$me", JSONArray(follows.toList())) }
        meRow.one?.let { takeMeRow(it) }
        // posts of mine that the server no longer has (removed by the AI check or deleted elsewhere) go away here too
        val mine = s.posts.filter { it.remote != null && it.mine && System.currentTimeMillis() - it.t > 120_000 }.take(200)
        if (mine.isNotEmpty()) {
            val alive = Sb.get(Q("posts").select("id").inList("id", mine.map { it.remote!! }))
            if (alive.ok) { val okIds = alive.rows.map { it.optString("id") }.toSet(); dropLocalPosts(mine.filter { it.remote !in okIds }.map { it.remote!! }) }
        }
        val lcM = HashMap<String, Int>(); likeRows.forEach { r -> val k = r.optString("post_id"); lcM[k] = (lcM[k] ?: 0) + 1 }
        val rcM = HashMap<String, Int>(); repostRows.forEach { r -> val k = r.optString("post_id"); rcM[k] = (rcM[k] ?: 0) + 1 }
        backfillSaves(shareStats.mySaved, ids)
        val liked = myLikes.rows.map { it.optString("post_id") }.toSet()
        val reposted = myReposts.rows.map { it.optString("post_id") }.toSet()
        val rpTime = myReposts.rows.associate { it.optString("post_id") to parseIso(it.optString("created_at")) }
        val hidden = HashSet<String>().apply {
            blocksOut.rows.forEach { add(it.optString("blocked_id")) }; blocksIn.rows.forEach { add(it.optString("blocker_id")) }; myMutes.rows.forEach { add(it.optString("muted_id")) }
        }
        val shown = posts.filter { it.optString("user_id") !in hidden }
        val postIds = shown.map { it.optString("id") }.toSet()
        val rpFirst = LinkedHashMap<String, JSONObject>()
        rpRows.forEach { r -> val pid = r.optString("post_id"); if (r.optString("user_id") !in hidden && pid in postIds && !rpFirst.containsKey(pid)) rpFirst[pid] = r }
        val authors = (shown.filter { it.optString("user_id") != me }.map { it.optString("user_id") } + rpFirst.values.map { it.optString("user_id") }).distinct()
        val who = cachedAccounts(authors)
        // a deleted account has no profile to show: its posts are left out instead of appearing as "user"
        val others = shown.filter { it.optString("user_id") != me && (who.failed || who.get(it.optString("user_id")) != null) }
        fun rpBy(id: String): RpBy? { val r = rpFirst[id] ?: return null; val a = who.get(r.optString("user_id")) ?: return null; return RpBy(r.optString("user_id"), nameOf(a), parseIso(r.optString("created_at"))) }
        val replyTally = HashMap<String, Int>()
        shown.forEach { p -> p.optStr("parent_id")?.let { replyTally[it] = (replyTally[it] ?: 0) + 1 } }
        val savedMap = s.posts.filter { it.ra != null }.associate { it.remote to it.saved }
        val localByRemote = s.posts.filter { it.remote != null && it.ra == null }.associate { it.remote!! to it.id }
        val sv = s.sv
        // posts whose words were changed after they went up (the server marks it; removing a photo does not count)
        val editedIds = shown.filter { it.optStr("edited_at") != null }.map { it.optString("id") }.toSet()
        s.posts.forEach { p ->
            val r = p.remote ?: return@forEach
            if (p.ra != null) return@forEach
            if (r in editedIds) p.edited = true
            p.lc = lcM[r] ?: 0; p.rpc = rcM[r] ?: 0; p.svc = shareStats.sv[r] ?: 0; p.shc = shareStats.sh[r] ?: 0; p.sharedByMe = r in shareStats.myShared
            p.rp = replyTally[r] ?: 0; p.liked = r in liked; p.reposted = r in reposted
            p.rpAt = if (p.reposted) rpTime[r]?.takeIf { it > 0 } ?: p.rpAt else 0
        }
        val remote = others.map { p ->
            val id = p.optString("id"); val u = p.optString("user_id")
            val a = who.get(u) ?: JSONObject().put("username", "user")
            LPost("r$id", p.optString("body"), parseIso(p.optString("created_at")), imgsOf[id] ?: parseMedia(p.opt("media_url")),
                p.optStr("parent_id")?.let { localByRemote[it] ?: "r$it" }, id in liked, id in reposted, rpTime[id] ?: 0,
                savedMap[id] ?: (sv?.contains(id) == true), false, p.optStr("edited_at") != null, id, authorOf(u, a)).apply {
                rpBy = rpBy(id); this.lc = lcM[id] ?: 0; this.rpc = rcM[id] ?: 0; shc = shareStats.sh[id] ?: 0; svc = shareStats.sv[id] ?: 0; sharedByMe = id in shareStats.myShared; rp = replyTally[id] ?: 0
            }
        }
        // my posts that only the server has (made on another device, or lost from this one) come back
        val known = s.posts.filter { it.remote != null && it.ra == null && !it.prov }.map { it.remote }.toSet()
        val mineBack = shown.filter { it.optString("user_id") == me && it.optString("id") !in known && it.optString("id") !in pend }
        val backIds = mineBack.map { it.optString("id") }.toSet()
        val pinnedId = meRow.one?.optStr("pinned_post_id")
        val back = mineBack.map { p ->
            val id = p.optString("id"); val im = imgsOf[id] ?: parseMedia(p.opt("media_url"))
            LPost("m$id", p.optString("body"), parseIso(p.optString("created_at")), im,
                p.optStr("parent_id")?.let { localByRemote[it] ?: if (it in backIds) "m$it" else "r$it" }, id in liked, id in reposted, 0, sv?.contains(id) == true, pinnedId == id, p.optStr("edited_at") != null, id).apply {
                media = im; this.lc = lcM[id] ?: 0; this.rpc = rcM[id] ?: 0; shc = shareStats.sh[id] ?: 0; svc = shareStats.sv[id] ?: 0; sharedByMe = id in shareStats.myShared; rp = replyTally[id] ?: 0
            }
        }
        // what this person saved or liked stays, even when the post is older than the newest 300
        val seen = remote.map { it.remote }.toSet()
        var kept = s.posts.filter { p -> p.ra != null && (p.saved || p.liked || (p.sharedAt > 0 && System.currentTimeMillis() - p.sharedAt < 86_400_000)) && p.remote !in seen && p.ra.id !in hidden }.take(100)
        if (kept.isNotEmpty()) {
            val still = Sb.get(Q("posts").select("id").inList("id", kept.map { it.remote!! }))
            kept = if (!still.ok) emptyList() else { val ok = still.rows.map { it.optString("id") }.toSet(); kept.filter { it.remote in ok } }
        }
        for (x in back + remote) { val tp = x.remote?.let { tapAt[it] } ?: continue; if (tp.t >= feedT0) { tp.l?.let { x.liked = it.first; x.lc = it.second }; tp.r?.let { x.reposted = it.first; x.rpc = it.second } } }
        val ownLocal = s.posts.filter { it.ra == null }
        s.posts.clear(); s.posts.addAll(ownLocal + back + remote + kept)
        // where the real Zenith has answered a post, his older private answer under the same post goes, so there is one answer
        zenId()?.let { zid ->
            val answered = s.posts.filter { it.ra?.id == zid && it.parent != null }.map { it.parent }.toSet()
            val hide = s.posts.filter { it.ai && it.parent != null && it.parent in answered }
            if (hide.isNotEmpty()) {
                val old = s.zen.optJSONArray("old") ?: JSONArray().also { s.zen.put("old", it) }
                val have = old.objs().map { it.optString("id") }.toSet()
                hide.filter { it.id !in have }.forEach { p -> old.put(JSONObject().put("id", p.id).put("text", p.text).put("t", p.t).put("parent", p.parent)) }
                val gone = hide.map { it.id }.toSet()
                s.posts.removeAll { it.id in gone }
            }
        }
        runCatching { fillWanted() }
        app.persist()
        if (inlLater.isNotEmpty()) fillInlinePhotos(inlLater)
    }

    fun zenId(): String? = s.zen.optStr("id")

    // posts.edited_at (when the words of a post were changed) came later: a server without it refuses the column (42703),
    // and the read is made again without it
    private var editedCol = true
    suspend fun postsGet(cols: String, mk: (String) -> Q): Res {
        var r = Sb.get(mk(if (editedCol) "$cols, edited_at" else cols))
        if (editedCol && !r.ok && (r.error?.code == "42703" || r.error?.message?.contains("edited_at") == true)) { editedCol = false; r = Sb.get(mk(cols)) }
        return r
    }

    // the profile row of this account: the handle, name, banner and pinned post the server has
    fun takeMeRow(m: JSONObject) {
        val pr = s.profile
        m.optStr("username")?.let { pr.handle = it }
        if (!m.isNull("display_name")) pr.name = m.optString("display_name")
        pr.handleChangedAt = m.optStr("handle_changed_at")
        val pin = m.optStr("pinned_post_id")
        s.posts.forEach { p -> if (p.remote != null && p.ra == null) p.pinned = p.remote == pin }
        m.optStr("banner")?.let { pr.banner = it }
        m.optStr("banner_theme")?.let { pr.bannerTheme = it }
        if (pr.avatar == null) m.optStr("avatar")?.let { pr.avatar = it }
        if (pr.bio.isEmpty()) m.optStr("bio")?.let { pr.bio = it }
        app.persist()
    }

    // old posts keep their photo inside the row: those come one small group at a time
    private fun fillInlinePhotos(ids: List<String>) = app.scope.launch {
        var changed = false
        for (c in ids.chunked(4)) {
            val r = Sb.get(Q("posts").select("id, media_url").inList("id", c))
            if (!r.ok) continue
            val m = r.rows.associate { it.optString("id") to it.opt("media_url") }
            s.posts.forEach { p -> val rr = p.remote; if (rr != null && m.containsKey(rr) && p.imgs.isEmpty()) { val im = parseMedia(m[rr]); if (im.isNotEmpty()) { p.imgs = im; if (p.ra == null) p.media = im; changed = true } } }
        }
        if (changed) app.persist()
    }

    // mapRemotePosts(): posts fetched by id or by author become part of the phone's posts the same way the feed makes them
    suspend fun mapRemotePosts(rows: List<JSONObject>): Int = coroutineScope {
        val me = uid ?: return@coroutineScope 0
        val have = s.posts.mapNotNull { it.remote }.toSet()
        val fresh = rows.filter { it.optString("id") !in have }
        if (fresh.isEmpty()) return@coroutineScope 0
        val ids = fresh.map { it.optString("id") }
        val authors = fresh.map { it.optString("user_id") }.filter { it != me }.distinct()
        val lk = async { Sb.get(Q("likes").select("post_id").inList("post_id", ids)) }
        val rpQ = async { Sb.get(Q("reposts").select("post_id").inList("post_id", ids)) }
        val myLk = async { Sb.get(Q("likes").select("post_id").eq("user_id", me).inList("post_id", ids)) }
        val myRp = async { Sb.get(Q("reposts").select("post_id").eq("user_id", me).inList("post_id", ids)) }
        val kidsQ = async { Sb.get(Q("posts").select("parent_id").inList("parent_id", ids)) }
        val whoQ = async { if (authors.isNotEmpty()) cachedAccounts(authors) else Accts(HashMap()) }
        val sstQ = async { shareSaveStats(ids) }
        fun tally(r: Res, k: String) = HashMap<String, Int>().apply { r.rows.forEach { x -> val v = x.optString(k); this[v] = (this[v] ?: 0) + 1 } }
        val lcM = tally(lk.await(), "post_id"); val rcM = tally(rpQ.await(), "post_id"); val kc = tally(kidsQ.await(), "parent_id")
        val sst = sstQ.await(); val who = whoQ.await()
        backfillSaves(sst.mySaved, ids)
        val mineL = myLk.await().rows.map { it.optString("post_id") }.toSet(); val mineR = myRp.await().rows.map { it.optString("post_id") }.toSet()
        val localByRemote = s.posts.filter { it.remote != null && it.ra == null }.associate { it.remote!! to it.id }
        var n = 0
        fresh.forEach { p ->
            val id = p.optString("id"); val u = p.optString("user_id"); val mineP = u == me; val a = who.get(u)
            if (!mineP && a == null) return@forEach
            if (s.posts.any { it.remote == id }) return@forEach
            val im = parseMedia(p.opt("media_url"))
            val par = p.optStr("parent_id")?.let { localByRemote[it] ?: (if (mineP) "m" else "r") + it }
            val np = LPost((if (mineP) "m" else "r") + id, p.optString("body"), parseIso(p.optString("created_at")), im, par, id in mineL, id in mineR, 0,
                s.sv?.contains(id) == true, false, p.optStr("edited_at") != null, id, if (mineP) null else authorOf(u, a!!)).apply {
                if (mineP) media = im
                this.lc = lcM[id] ?: 0; this.rpc = rcM[id] ?: 0; shc = sst.sh[id] ?: 0; svc = sst.sv[id] ?: 0; sharedByMe = id in sst.myShared; this.rp = kc[id] ?: 0
            }
            s.posts.add(np); n++
        }
        if (n > 0) app.persist()
        n
    }

    // loadUserPosts(): the feed only holds the newest posts of everybody, so a profile fetches the person's own newest posts
    suspend fun loadUserPosts(id: String): Boolean {
        if (uid == null) return false
        val r = postsGet("id, user_id, body, created_at, parent_id, media_url") { Q("posts").select(it).eq("user_id", id).order("created_at", false).limit(80) }
        if (!r.ok || r.rows.isEmpty()) return false
        return mapRemotePosts(r.rows) > 0
    }

    // fillWanted(): saved posts and list entries that are not among the newest posts are fetched
    suspend fun fillWanted(): Boolean {
        if (uid == null) return false
        val want = HashSet<String>(s.sv ?: emptySet())
        s.lists.forEach { l -> l.ids.forEach { i -> idToRemote(i)?.let { want.add(it) } } }
        val have = s.posts.mapNotNull { it.remote }.toSet()
        val miss = want.filter { it !in have && it !in wantGone }.take(100)
        var changed = false
        if (miss.isNotEmpty()) {
            val r = postsGet("id, user_id, body, created_at, parent_id, media_url") { Q("posts").select(it).inList("id", miss) }
            if (r.ok) { val got = r.rows.map { it.optString("id") }.toSet(); miss.forEach { if (it !in got) wantGone.add(it) } }
            changed = mapRemotePosts(r.rows) > 0
        }
        s.posts.forEach { p -> if (p.remote != null && s.sv?.contains(p.remote) == true && !p.saved) { p.saved = true; changed = true } }
        s.lists.forEach { l -> val next = l.ids.map { i -> idToRemote(i)?.let { remoteToId(it) } ?: i }; if (next != l.ids.toList()) { l.ids.clear(); l.ids.addAll(next) } }
        return changed
    }

    fun idToRemote(id: String): String? {
        s.byId(id)?.remote?.let { return it }
        return Regex("^[rm]([0-9a-f-]{36})$", RegexOption.IGNORE_CASE).find(id)?.groupValues?.get(1)
    }
    fun remoteToId(r: String) = s.byRemote(r)?.id ?: "r$r"

    // dropLocalPosts(): posts the server took down go from this phone, with the replies under them
    fun dropLocalPosts(remoteIds: Collection<String>): Boolean {
        val want = remoteIds.toSet()
        val gone = s.posts.filter { it.remote != null && it.remote in want }.map { it.id }.toMutableSet()
        var grew = true
        while (grew) { grew = false; s.posts.forEach { x -> if (x.parent != null && x.parent in gone && x.id !in gone) { gone.add(x.id); grew = true } } }
        if (gone.isEmpty()) return false
        s.posts.removeAll { it.id in gone }
        s.lists.forEach { l -> l.ids.removeAll { it in gone } }
        app.persist()
        return true
    }

    // ---- likes, reposts, saves, shares ----

    private fun noteTap(p: LPost, k: Char) {
        val r = p.remote ?: return
        val e = tapAt.getOrPut(r) { Tap() }
        e.t = System.currentTimeMillis()
        if (k == 'l') e.l = p.liked to p.lc else e.r = p.reposted to p.rpc
        if (tapAt.size > 200) tapAt.remove(tapAt.keys.first())
    }

    // toggleRemoteLike(): shown at once; a refusal puts it back as the server has it
    fun toggleLike(p: LPost) {
        val me = uid ?: return
        if (p.prov || !busyTaps.add("l" + p.id)) return
        app.scope.launch {
            try {
                val on = !p.liked
                p.liked = on; p.lc = maxOf(0, p.lc + if (on) 1 else -1)
                noteTap(p, 'l'); app.persist()
                val r = if (on) Sb.insert("likes", JSONObject().put("user_id", me).put("post_id", p.remote))
                else Sb.delete(Q("likes").eq("user_id", me).eq("post_id", p.remote!!))
                val e = r.error
                if (e != null && !(on && e.code == "23505")) {
                    p.liked = !on; p.lc = maxOf(0, p.lc + if (on) -1 else 1)
                    // a lost answer can hide that the server did take the tap: the real state is read back
                    val truth = Sb.get(Q("likes").select("post_id").eq("user_id", me).eq("post_id", p.remote!!))
                    if (truth.ok && (truth.one != null) != p.liked) { p.liked = truth.one != null; p.lc = maxOf(0, p.lc + if (p.liked) 1 else -1) }
                    noteTap(p, 'l'); app.persist(); app.say("Could not update like")
                }
            } finally { busyTaps.remove("l" + p.id) }
        }
    }

    fun toggleRepost(p: LPost) {
        val me = uid ?: return
        if (p.prov || !busyTaps.add("r" + p.id)) return
        app.scope.launch {
            try {
                val on = !p.reposted
                p.reposted = on; p.rpAt = if (on) System.currentTimeMillis() else 0; p.rpc = maxOf(0, p.rpc + if (on) 1 else -1)
                noteTap(p, 'r'); app.persist()
                val r = if (on) Sb.insert("reposts", JSONObject().put("user_id", me).put("post_id", p.remote))
                else Sb.delete(Q("reposts").eq("user_id", me).eq("post_id", p.remote!!))
                val e = r.error
                if (e != null && !(on && e.code == "23505")) { p.reposted = !on; p.rpc = maxOf(0, p.rpc + if (on) -1 else 1); noteTap(p, 'r'); app.persist(); app.say("Could not update repost") }
            } finally { busyTaps.remove("r" + p.id) }
        }
    }

    private val saveSeq = HashMap<String, Int>()
    private val saveQ = HashMap<String, kotlinx.coroutines.Job>()
    // setSaved(): the number under the bookmark counts people, so it follows this person's choice; taps go out in order
    fun setSaved(p: LPost, on: Boolean) {
        p.saved = on
        val r = p.remote ?: return
        val sv = s.sv ?: HashSet<String>().also { s.sv = it }
        if (on) sv.add(r) else sv.remove(r)
        val me = uid ?: return
        p.svc = maxOf(0, p.svc + if (on) 1 else -1)
        val seq = (saveSeq[r] ?: 0) + 1
        saveSeq[r] = seq
        val prev = saveQ[r]
        val job = app.scope.launch {
            prev?.join()
            val res = if (on) Sb.upsert("post_saves", JSONObject().put("post_id", r).put("user_id", me), "post_id,user_id", ignoreDuplicates = true)
            else Sb.delete(Q("post_saves").eq("post_id", r).eq("user_id", me))
            if (!res.ok && saveSeq[r] == seq) {
                p.saved = !on
                if (on) sv.remove(r) else sv.add(r)
                p.svc = maxOf(0, p.svc + if (on) -1 else 1)
                app.persist()
                app.say("Could not " + (if (on) "save" else "remove") + " that post. Check your connection")
            }
        }
        saveQ[r] = job
        job.invokeOnCompletion { if (saveQ[r] === job) { saveQ.remove(r); saveSeq.remove(r) } }
    }

    // backfillSaves(): saves made before the counter existed are added once
    private fun backfillSaves(mySaved: Set<String>, ids: List<String>) {
        val me = uid ?: return
        val sv = s.sv ?: return
        val add = ids.filter { it in sv && it !in mySaved }
        if (add.isNotEmpty()) app.scope.launch { Sb.upsert("post_saves", JSONArray(add.map { JSONObject().put("post_id", it).put("user_id", me) }), "post_id,user_id", ignoreDuplicates = true) }
    }

    // countShare(): a share of a post that lives on the server is counted once per person
    fun countShare(p: LPost) {
        val r = p.remote ?: return
        val me = uid ?: return
        app.scope.launch {
            val res = Sb.upsert("post_shares", JSONObject().put("post_id", r).put("user_id", me), "post_id,user_id", ignoreDuplicates = true)
            if (res.ok && !p.sharedByMe) { p.sharedByMe = true; p.shc += 1 }
        }
    }

    // ---- writing posts ----

    // uploadMedia(): the photos of a post go to storage first; one that fails removes the ones already up
    suspend fun uploadMedia(srcs: List<String>): List<String>? {
        val me = uid ?: return null
        val urls = ArrayList<String>()
        for ((i, src) in srcs.withIndex()) {
            if (src.startsWith("http")) { urls.add(src); continue }
            val b = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { Photos.bytesOf(src) } ?: continue
            val type = mimeOf(b)
            val ext = type.substringAfter("/").replace("jpeg", "jpg")
            val path = "$me/${System.currentTimeMillis()}-$i.$ext"
            val e = Sb.upload("media", path, b, type)
            if (e != null) {
                if (urls.isNotEmpty()) app.scope.launch { Sb.remove("media", urls.mapNotNull { Sb.pathOf(it, "media") }) }
                return null
            }
            urls.add(Sb.publicUrl("media", path))
        }
        return urls
    }

    fun lockLeft() = maxOf(0L, lockUntil - System.currentTimeMillis())

    // pushPost(): a post (or reply) goes to the server; the id is made once so a repeat can never make a second post
    fun pushPost(np: LPost, quiet: Boolean = false) {
        val me = uid ?: return
        if ((np.text.isEmpty() && np.imgs.isEmpty()) || np.sending) return
        val par = np.parent?.let { s.byId(it) }
        if (np.parent != null && par?.remote == null) return
        np.sending = true
        app.scope.launch {
            try {
                val row = JSONObject().put("user_id", me).put("body", np.text)
                var urls: List<String>? = null
                if (np.imgs.isNotEmpty()) {
                    urls = uploadMedia(np.imgs)
                    if (urls == null) { if (!quiet) app.say("Could not upload the photo. It will be sent again when the connection is back"); return@launch }
                    row.put("media_url", JSONArray(urls).toString())
                }
                if (par != null) row.put("parent_id", par.remote)
                if (np.rid == null) np.rid = java.util.UUID.randomUUID().toString()
                row.put("id", np.rid)
                var r = Sb.insert("posts", row, select = "id")
                val gotId = if (r.error?.code == "23505") np.rid else r.one?.optString("id")
                if (r.error?.code == "23505") r = Res(null, null)
                // deleted on this phone while it was still uploading: it goes from the server again
                if (r.ok && gotId != null && s.posts.none { it === np }) {
                    s.pendDel.add(gotId); app.persist()
                    serverDelete(listOf(LPost("x", "", 0, emptyList(), null, remote = gotId).apply { media = urls ?: emptyList() }))
                    return@launch
                }
                if (r.ok && gotId != null) {
                    np.remote = gotId; np.media = urls ?: emptyList(); app.persist()
                    if (isOwner()) { app.scope.launch { delay(22_000); zenNudge() }; app.scope.launch { delay(50_000); zenNudge() } }
                } else {
                    val e = r.error
                    // a lost reply (no error code) may still have stored the post, so its photos are kept
                    if (urls != null && urls.isNotEmpty() && e != null && e.code.isNotEmpty()) app.scope.launch { Sb.remove("media", urls.mapNotNull { Sb.pathOf(it, "media") }) }
                    val lk = Regex("post_locked:(\\d+)").find(e?.message ?: "")
                    if (lk != null) {
                        // posting is paused: this post is dropped instead of being tried again and again
                        lockUntil = lk.groupValues[1].toLong() * 1000
                        val gone = mutableSetOf(np.id)
                        var grew = true
                        while (grew) { grew = false; s.posts.forEach { x -> if (x.parent != null && x.parent in gone && x.id !in gone) { gone.add(x.id); grew = true } } }
                        s.posts.removeAll { it.id in gone }
                        app.persist()
                        if (!quiet) app.postLocked = true
                        return@launch
                    }
                    if (!quiet) app.say("Could not send that post yet. It will be sent again when the connection is back")
                }
            } finally { np.sending = false }
        }
    }

    // retryUnsent(): posts that could not be saved are sent again by themselves when the connection is back
    fun retryUnsent() {
        if (uid == null) return
        s.posts.filter { p -> p.remote == null && p.mine && !p.sending && !p.noRetry && (p.text.isNotEmpty() || p.imgs.isNotEmpty()) && (p.parent == null || s.byId(p.parent)?.remote != null) }
            .take(3).forEach { pushPost(it, true) }
    }

    // loadPostLock(): posting is paused for a while after posts were taken down; the server decides, this only tells
    suspend fun loadPostLock() {
        if (uid == null) { lockUntil = 0; return }
        val r = Sb.rpc("nook_post_lock")
        if (!r.ok) return
        val row = (r.data as? JSONArray)?.optJSONObject(0) ?: r.data as? JSONObject
        lockUntil = row?.optStr("locked_until")?.let { parseIso(it) } ?: 0
        lockStrikes = row?.optInt("strikes") ?: 0
    }

    // deleteRemote(): own posts go from the server with their likes, reposts and photos
    suspend fun deleteRemote(items: List<LPost>) {
        val me = uid ?: return
        val own = items.filter { it.remote != null && it.ra == null && !it.ai }
        if (own.isEmpty()) return
        val ids = own.map { it.remote!! }
        val paths = ArrayList<String>()
        fun addPath(u: String) { Sb.pathOf(u, "media")?.takeIf { it.startsWith("$me/") }?.let { paths.add(it) } }
        own.forEach { x -> x.media.forEach { addPath(it) } }
        Sb.get(Q("posts").select("id, media_url").inList("id", ids).eq("user_id", me)).rows.forEach { r -> parseMedia(r.opt("media_url")).forEach { addPath(it) } }
        Sb.get(Q("posts").select("id, media_url").inList("parent_id", ids).eq("user_id", me)).rows.forEach { r -> parseMedia(r.opt("media_url")).forEach { addPath(it) } }
        coroutineScope {
            val a = async { Sb.delete(Q("likes").inList("post_id", ids).eq("user_id", me)) }
            val b = async { Sb.delete(Q("reposts").inList("post_id", ids).eq("user_id", me)) }
            a.await(); b.await()
        }
        val r = Sb.delete(Q("posts").inList("id", ids))
        if (!r.ok) throw IllegalStateException(r.error?.message ?: "delete")
        s.pendDel.removeAll { it in ids }; app.persist()
        val uniq = paths.distinct()
        if (uniq.isNotEmpty()) app.scope.launch { Sb.remove("media", uniq) }
    }

    fun serverDelete(items: List<LPost>) = app.scope.launch {
        try { deleteRemote(items) } catch (e: Exception) { app.say("Could not delete on the server yet. " + plainErr(e.message, "It will be tried again")) }
    }

    // syncEdit(): true when the edit is saved (or the post is not on the server yet, so the retry sends the new words)
    suspend fun syncEdit(ed: LPost, text: String, origin: List<String>, now: List<String>): Boolean {
        if (uid == null || ed.remote == null || ed.ra != null || ed.ai) return true
        val kept = origin.mapIndexedNotNull { i, src -> if (src in now) ed.media.getOrNull(i) else null }
        val added = now.filter { it !in origin }
        val up = if (added.isNotEmpty()) uploadMedia(added) else emptyList()
        if (up == null) { app.say("Could not upload the photo. The edit was not saved"); return false }
        val all = kept + up
        val r = Sb.update(Q("posts").eq("id", ed.remote!!), JSONObject().put("body", text).put("media_url", if (all.isEmpty()) JSONObject.NULL else JSONArray(all).toString()))
        if (!r.ok) {
            app.say(if (r.error?.message?.contains("rate_limited") == true) "Wait a few seconds before editing again. The edit was not saved" else "The edit was not saved. " + plainErr(r.error?.message, "Try again"))
            return false
        }
        val dropped = ed.media.filter { it !in all }.mapNotNull { Sb.pathOf(it, "media") }
        ed.media = all; app.persist()
        if (dropped.isNotEmpty()) app.scope.launch { Sb.remove("media", dropped) }
        return true
    }

    // togglePin(): one post of yours sits at the top of your profile
    fun togglePin(p: LPost) {
        val me = uid
        if (me == null || p.remote == null) { app.say("Wait for the post to finish uploading"); return }
        app.scope.launch {
            val was = p.pinned
            val r = Sb.update(Q("accounts").eq("id", me), JSONObject().put("pinned_post_id", if (was) JSONObject.NULL else p.remote))
            if (!r.ok) { app.say("Could not " + (if (was) "unpin" else "pin") + " the post"); return@launch }
            s.posts.forEach { it.pinned = false }
            p.pinned = !was
            app.persist()
            app.say(if (p.pinned) "Pinned to your profile" else "Unpinned")
        }
    }

    // reportPost(): tell us a post breaks the rules
    fun reportPost(p: LPost) {
        val me = uid ?: return
        val r = p.remote ?: return
        val why = (if (p.imgs.isNotEmpty()) listOf("sexual" to "Sexual content") else emptyList()) + listOf("harassment" to "Bullying or harassment", "hate" to "Hate speech",
            "threats" to "Threats or violence", "selfharm" to "Self harm", "illegal" to "Illegal or dangerous", "private" to "Private information",
            "impersonation" to "Pretending to be someone", "spam" to "Spam or scam", "other" to "Something else")
        app.open(why.map { (k, label) ->
            SheetItem(label) {
                app.scope.launch {
                    val res = Sb.insert("reports", JSONObject().put("reporter_id", me).put("post_id", r).put("reason", k))
                    val e = res.error
                    if (e != null && e.code != "23505") { app.say(if (e.code == "P0001") "Too many reports. Try again later" else "Could not send the report"); return@launch }
                    app.say("Thanks, we will check it")
                }
            }
        } + SheetItem("Cancel", cancel = true), "Why are you reporting this post?")
    }

    // zenithOfOwner(): the owner takes down what Zenith posts in public (everybody else can only report it)
    fun zenithOfOwner(p: LPost) = p.ra != null && p.remote != null && isOwner() && zenId() != null && p.ra.id == zenId()
    fun deleteZenithPost(p: LPost) = app.scope.launch {
        val r = Sb.rpc("nook_owner_delete_zenith_post", JSONObject().put("p_id", p.remote))
        if (!r.ok || r.data != true) { app.say("Could not delete the post"); return@launch }
        val gone = (listOf(p.id) + s.flat(p.id).map { it.first.id }).toSet()
        s.posts.removeAll { it.id in gone }
        s.lists.forEach { l -> l.ids.removeAll { it in gone } }
        app.persist()
        while (app.stack.size > 1 && (app.stack.last() as? Route.Thread)?.id in gone) app.pop()
        app.say("Post deleted")
    }

    // ---- social reads ----

    // loadSocial(): nicknames and chat clears, reloaded at most every 30 s when forced
    suspend fun loadSocial(force: Boolean = false) {
        val me = uid ?: return
        if (socialAt == 0L) {
            (Cache.read("nicks:$me")?.v as? JSONObject)?.let { o -> o.keys().forEach { k -> nickMap[k] = o.optString(k) } }
            (Cache.read("clears:$me")?.v as? JSONObject)?.let { o -> o.keys().forEach { k -> clearMap[k] = o.optLong(k) } }
        }
        val j = socialJob
        if (j != null && !(force && System.currentTimeMillis() - socialAt > 30_000)) { j.await(); return }
        socialAt = System.currentTimeMillis()
        val nj = app.scope.async {
            val (a, b) = coroutineScope {
                val x = async { Sb.get(Q("nicknames").select("target_id, nickname").eq("owner_id", me)) }
                val y = async { Sb.get(Q("chat_clears").select("other_id, cleared_at").eq("user_id", me)) }
                x.await() to y.await()
            }
            if (a.ok) { nickMap.clear(); a.rows.forEach { nickMap[it.optString("target_id")] = it.optString("nickname") }; Cache.write("nicks:$me", JSONObject(nickMap as Map<*, *>)); nickVersion++ }
            if (b.ok) { clearMap.clear(); b.rows.forEach { clearMap[it.optString("other_id")] = parseIso(it.optString("cleared_at")) }; Cache.write("clears:$me", JSONObject(clearMap as Map<*, *>)) }
            Unit
        }
        socialJob = nj
        runCatching { nj.await() }
    }

    // pwnedPassword(): only the first 5 characters of its SHA-1 are sent, and a failed check never blocks anybody
    suspend fun pwned(pw: String): Boolean {
        val hex = Crypto.sha1Hex(pw)
        val txt = Sb.text("https://api.pwnedpasswords.com/range/" + hex.take(5), mapOf("Add-Padding" to "true"), 3) ?: return false
        val tail = hex.substring(5)
        return txt.lineSequence().any { l -> val (sfx, n) = (l.trim().split(":") + listOf("", "")).take(2); sfx == tail && (n.toIntOrNull() ?: 0) > 0 }
    }
}

// plainErr(): any error turned into a line that makes sense to a person
fun plainErr(m0: String?, fallback: String = "Something went wrong. Try again"): String {
    val m = m0 ?: ""
    return when {
        Regex("failed to fetch|networkerror|load failed|network|abort|timed out|timeout", RegexOption.IGNORE_CASE).containsMatchIn(m) -> "No connection. Check it and try again"
        Regex("row-level security|permission denied", RegexOption.IGNORE_CASE).containsMatchIn(m) -> "That is not allowed right now"
        m.contains("rate_limited", true) -> "Too many changes. Wait a minute and try again"
        m.contains("post_locked", true) -> "Posting is paused for now"
        m.contains("need to open nook", true) -> "They have not opened messages yet"
        m.contains("message_too_long", true) -> "That message is too long"
        else -> fallback
    }
}

// the type of a picture from its first bytes
fun mimeOf(b: ByteArray): String = when {
    b.size > 3 && b[0] == 0x89.toByte() && b[1] == 'P'.code.toByte() -> "image/png"
    b.size > 3 && b[0] == 'G'.code.toByte() && b[1] == 'I'.code.toByte() && b[2] == 'F'.code.toByte() -> "image/gif"
    b.size > 11 && b[0] == 'R'.code.toByte() && b[8] == 'W'.code.toByte() && b[9] == 'E'.code.toByte() -> "image/webp"
    else -> "image/jpeg"
}
