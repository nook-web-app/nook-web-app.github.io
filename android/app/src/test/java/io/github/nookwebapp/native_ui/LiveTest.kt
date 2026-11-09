package io.github.nookwebapp.native_ui

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.util.concurrent.Executors

// The app's own server code against the real Nook server, with two throwaway accounts: sign up, post, post a photo,
// reply, edit, pin, follow, like, repost, save, message (end to end encrypted), read the message back, unlike, delete,
// and delete the accounts. Every step is checked in the database itself, not in what the app shows.
// Runs only when asked: NOOK_LIVE=1 ./g.sh :app:testDebugUnitTest --tests '*LiveTest*'
class LiveTest {
    private val fails = ArrayList<String>()
    private fun check(name: String, ok: Boolean, info: Any? = null) { println((if (ok) "PASS " else "FAIL ") + name + (info?.let { " ($it)" } ?: "")); if (!ok) fails.add(name) }
    private suspend fun waitFor(ms: Long = 20_000, cond: suspend () -> Boolean): Boolean { val end = System.currentTimeMillis() + ms; while (System.currentTimeMillis() < end) { if (cond()) return true; delay(250) }; return cond() }
    private suspend fun row(table: String, col: String, v: Any, cols: String = "id, user_id, body, parent_id, media_url") = Sb.get(Q(table).select(cols).eq(col, v)).one
    private fun app(): AppState { val d = java.nio.file.Files.createTempDirectory("nook").toFile(); return AppState(Store(d)).also { AppState.current = it } }
    private suspend fun use(s: Session) { Sb.takeSession(s.access, s.refresh) }

    @Test fun live() {
        assumeTrue(System.getenv("NOOK_LIVE") == "1")
        Vault.plainForTests = true
        Dispatchers.setMain(Executors.newSingleThreadExecutor().asCoroutineDispatcher())
        runBlocking(Dispatchers.Main) { run() }
        if (fails.isNotEmpty()) throw AssertionError("failed: " + fails.joinToString())
    }

    private suspend fun run() {
        Cache.open(File(java.nio.file.Files.createTempDirectory("c").toFile(), "cache.json"))
        val tag = uid().takeLast(6).lowercase()
        val pw = "Nook-live-" + java.util.UUID.randomUUID().toString().take(12)
        val pic = File("../tools/fixture/sample_pic.png")

        // ---- account A ----
        val a = app()
        val ea = "nook.live.a.$tag@example.com"
        val ra = a.on.signUp("Live A", "lva_$tag", ea, pw)
        check("sign up A", ra == null && Sb.user != null, ra)
        val aId = Sb.user!!.id; val aS = Sb.session!!
        // the message key is made while this account's session is the active one, so the sign up's own background call cannot race with the switches below
        runCatching { a.on.ensureE2E() }.onFailure { println("A keys: $it") }
        check("A row", row("accounts", "id", aId, "username")?.optString("username") == "lva_$tag")

        // the card of a post on X comes from its embed data (the page itself has no picture or text for a browserless fetch)
        val pv = Sb.fn("preview", org.json.JSONObject().put("url", "https://x.com/jack/status/20"))
        check("X link preview", pv.ok && pv.body.optString("title").contains("(@jack) on X") && pv.body.optString("description").contains("twttr"), pv.body.toString().take(160))

        a.newPost("hello from the live test $tag", emptyList(), null)
        val p = a.store.posts.last()
        check("post saved", waitFor { p.remote != null } && row("posts", "id", p.remote!!)?.optString("body") == "hello from the live test $tag")

        val f = File(a.store.mediaDir, "pic.png").apply { writeBytes(pic.readBytes()) }
        a.newPost("photo $tag", listOf(f.absolutePath), null)
        val ph = a.store.posts.last()
        waitFor { ph.remote != null }
        val media = ph.remote?.let { row("posts", "id", it)?.optString("media_url") } ?: ""
        val url = a.on.parseMedia(media).firstOrNull()
        check("photo post saved", url != null && url.startsWith(SB_URL), media)
        check("photo is in storage", url != null && Sb.bytes(url)?.size == pic.length().toInt())

        a.newPost("reply $tag", emptyList(), p.id)
        val rep = a.store.posts.last()
        check("reply saved under the post", waitFor { rep.remote != null } && row("posts", "id", rep.remote!!)?.optString("parent_id") == p.remote)

        delay(16_000) // the server allows one edit per post every 15 s
        a.saveEdit(p, "edited words $tag", p.imgs)
        check("text edit saved", waitFor { row("posts", "id", p.remote!!)?.optString("body") == "edited words $tag" })
        val ed = row("posts", "id", p.remote!!, "edited_at")
        check("text edit marked edited", ed?.optStr("edited_at") != null && p.edited, ed)

        a.saveEdit(ph, ph.text, emptyList())
        check("photo removed", waitFor { row("posts", "id", ph.remote!!)?.isNull("media_url") == true })
        check("photo removal is not an edit", row("posts", "id", ph.remote!!, "edited_at")?.optStr("edited_at") == null && !ph.edited)
        check("removed photo leaves storage", url != null && waitFor(15_000) { Sb.bytes(url + "?fresh=" + uid()) == null })

        a.on.togglePin(p)
        check("pinned", waitFor { row("accounts", "id", aId, "pinned_post_id")?.optString("pinned_post_id") == p.remote })

        // ---- account B ----
        val b = app()
        val eb = "nook.live.b.$tag@example.com"
        val rb = b.on.signUp("Live B", "lvb_$tag", eb, pw)
        check("sign up B", rb == null && Sb.user?.id != aId, rb)
        val bId = Sb.user!!.id; val bS = Sb.session!!
        runCatching { b.on.ensureE2E() }.onFailure { println("B keys: $it") }

        val pgA = UserPage(aId)
        b.on.loadUser(pgA)
        waitFor { pgA.st != null }
        b.on.toggleFollow(pgA)
        check("B follows A", waitFor { Sb.get(Q("follows").select("follower_id").eq("follower_id", bId).eq("followee_id", aId)).one != null })

        b.on.loadFeed()
        val seen = waitFor { b.store.posts.any { it.remote == p.remote } }
        val bp = b.store.posts.firstOrNull { it.remote == p.remote }
        check("B sees A's post in the feed", seen && bp?.ra?.id == aId)
        check("B sees it as edited", bp?.edited == true)
        check("B sees A's photo post", b.store.posts.any { it.remote == ph.remote })
        if (bp != null) {
            b.on.toggleLike(bp)
            check("like saved", waitFor { Sb.get(Q("likes").select("post_id").eq("user_id", bId).eq("post_id", p.remote!!)).one != null })
            b.on.toggleRepost(bp)
            check("repost saved", waitFor { Sb.get(Q("reposts").select("post_id").eq("user_id", bId).eq("post_id", p.remote!!)).one != null })
            b.on.setSaved(bp, true)
            check("save saved", waitFor { Sb.get(Q("post_saves").select("post_id").eq("user_id", bId).eq("post_id", p.remote!!)).one != null })
            b.newPost("B answers $tag", emptyList(), bp.id)
            val br = b.store.posts.last()
            check("B's reply saved", waitFor { br.remote != null } && row("posts", "id", br.remote!!)?.optString("parent_id") == p.remote)
        }

        // ---- messages: A follows B back, B writes, A reads ----
        use(aS)
        val pgB = UserPage(bId)
        a.on.loadUser(pgB)
        waitFor { pgB.st != null }
        a.on.toggleFollow(pgB)
        check("A follows B", waitFor { Sb.get(Q("follows").select("follower_id").eq("follower_id", aId).eq("followee_id", bId)).one != null })
        check("A got notifications", waitFor { (Sb.get(Q("notifications").select("kind").eq("user_id", aId)).rows.map { it.optString("kind") }.toSet()).containsAll(listOf("like", "reply")) },
            Sb.get(Q("notifications").select("kind").eq("user_id", aId)).rows.map { it.optString("kind") })
        runCatching { a.on.ensureE2E() }.onFailure { println("A keys: $it") }

        use(bS)
        runCatching { b.on.ensureE2E() }.onFailure { println("B keys: $it") }
        val sent = runCatching { b.on.sendDm(aId, "secret hi $tag") }
        check("message sent", sent.isSuccess, sent.exceptionOrNull())
        val msg = sent.getOrNull()?.id?.let { row("messages", "id", it, "body") }
        check("message is sealed on the server", msg?.optString("body")?.startsWith("e2e1:") == true, msg?.optString("body")?.take(12))

        use(aS)
        val th = runCatching { a.on.dmThread(bId) }.getOrNull() ?: emptyList()
        val last = th.lastOrNull()
        val plain = last?.let { runCatching { a.on.openText(bId, it.optString("body")) }.getOrNull() }
        check("A reads the message", plain == "secret hi $tag", plain)

        // ---- B takes the like back ----
        use(bS)
        if (bp != null) {
            b.on.toggleLike(bp)
            check("unlike saved", waitFor { Sb.get(Q("likes").select("post_id").eq("user_id", bId).eq("post_id", p.remote!!)).one == null })
        }

        // ---- a new post of A reaches B (who follows A) as a notification that points at the post ----
        use(aS)
        a.newPost("followers hear about this $tag", emptyList(), null)
        val np = a.store.posts.last()
        waitFor { np.remote != null }
        use(bS)
        val got = waitFor(170_000) { Sb.get(Q("notifications").select("kind, post_id").eq("user_id", bId).eq("kind", "post")).rows.any { it.optString("post_id") == np.remote } }
        check("B is told about A's new post", got, np.remote)
        val zid = Sb.get(Q("accounts").select("id").eq("username", "zenith")).one?.optString("id")
        if (zid != null) {
            val zf = Sb.insert("follows", JSONObject().put("follower_id", bId).put("followee_id", zid))
            check("B can follow Zenith", zf.ok, zf.error?.message)
            Sb.delete(Q("follows").eq("follower_id", bId).eq("followee_id", zid))
        }

        // ---- A deletes the posts ----
        use(aS)
        a.deletePost(np)
        a.deletePost(p)
        check("post deleted on the server", waitFor(25_000) { Sb.get(Q("posts").select("id").eq("id", p.remote!!)).ok && row("posts", "id", p.remote!!) == null })
        check("own reply under it deleted", row("posts", "id", rep.remote!!) == null)
        a.deletePost(ph)
        check("photo post deleted", waitFor(25_000) { row("posts", "id", ph.remote!!) == null })

        // ---- both accounts go ----
        val da = a.on.checkDeleteLogin(ea, pw) ?: a.on.deleteAccount()
        check("A deleted", da == null, da)
        use(bS)
        val db = b.on.checkDeleteLogin(eb, pw) ?: b.on.deleteAccount()
        check("B deleted", db == null, db)
        println("accounts: $aId $bId")
        withContext(Dispatchers.IO) { File("build/live-accounts.txt").writeText("$aId\n$bId\n") }
    }
}

