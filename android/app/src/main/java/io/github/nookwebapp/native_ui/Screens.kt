package io.github.nookwebapp.native_ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.layout
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import kotlin.math.roundToInt

// The pages, one per route, each the copy of a view in app.js (named in its comment). Every page draws its own top area
// and its scrolling body; a page reached from another one gets a back arrow, a first page the menu button.

@Composable fun MenuBtn() { val app = LocalApp.current; IB("menu") { app.drawer = true } }
@Composable fun BackBtn() { val app = LocalApp.current; IB("back") { app.pop() } }
// .bellb: the bell, with a dot while there are unread notifications
@Composable fun BellBtn() {
    val app = LocalApp.current
    val c = LocalNook.current
    Box {
        IB("bell") { app.askNotifs(); app.go(Route.Notifs) }
        if (app.on.unreadN > 0) Box(Modifier.align(Alignment.TopEnd).padding(top = 9.dp, end = 9.dp).size(9.dp).clip(CircleShape).background(c.accent))
    }
}
@Composable fun Lead() { if (LocalApp.current.stack.size > 1) BackBtn() else MenuBtn() }

@Composable
fun Page(top: @Composable ColumnScope.() -> Unit, fab: (@Composable () -> Unit)? = null, body: @Composable ColumnScope.() -> Unit) {
    Box(Modifier.fillMaxSize().background(LocalNook.current.bg)) {
        Column(Modifier.fillMaxSize()) {
            Top(top)
            Column(Modifier.weight(1f).fillMaxWidth(), content = body)
        }
        if (fab != null) Box(Modifier.align(Alignment.BottomEnd).padding(end = 16.dp, bottom = 16.dp)) { fab() }
    }
}

// .fab: the round accent button at the bottom right (the page leaves 88dp free under its list for it)
@Composable
fun Fab(icon: String, onClick: () -> Unit) {
    val c = LocalNook.current
    Box(Modifier.size(56.dp).shadow(18.dp, CircleShape, ambientColor = Color(0x59000000), spotColor = Color(0x59000000)).clip(CircleShape).background(c.accent).pressTap(CircleShape, onClick = onClick), contentAlignment = Alignment.Center) {
        NIcon(icon, 26.dp, c.on)
    }
}

// postList(): the posts, or the empty state when there are none
fun LazyListScope.postList(a: List<LPost>, empty: @Composable () -> Unit, lab: ((LPost) -> String?)? = null, pin: Boolean = false, replyTo: Boolean = false) {
    if (a.isEmpty()) item { empty() }
    items(a, key = { it.id }) { PostCard(it, lab = lab?.invoke(it), pin = pin, replyTo = replyTo) }
}

// .empty with "Loading..."
@Composable fun Loading() = Empty(null, "Loading...")
// failBox(): a short message and a Try again button where a list should be
@Composable fun Fail(text: String, retry: () -> Unit) = Empty(null, text) { Pill("Try again", Btn.Ghost, onClick = retry) }

// homeV
@Composable
fun HomeScreen() {
    val app = LocalApp.current
    val s = app.store
    val photos = s.homeTab == "photos"
    Page({
        Bar("Nook", { MenuBtn() }, { BellBtn() })
        Tabs(listOf("For you", "Media"), if (photos) 1 else 0) { s.homeTab = if (it == 1) "photos" else "latest"; app.persist() }
    }) {
        val feed = s.posts.filter { it.parent == null && (!photos || it.imgs.isNotEmpty()) }.sortedByDescending { ft(it) }
        val ranked = rankFeed(s, app.on.follows, feed, if (photos) "photos" else "latest")
        LazyColumn(Modifier.fillMaxSize(), state = app.listStateFor(LocalPage.current)) {
            item { ComposerRow() }
            postList(ranked, { FeedEmpty(photos) }, lab = { p -> p.rpBy?.let { it.name + " reposted" } })
        }
    }
}

// feedEmpty(): an empty home is only called empty after the server answered
@Composable
private fun FeedEmpty(photos: Boolean) {
    val app = LocalApp.current
    val st = app.on.feedStatus
    when {
        st == "ok" || !app.signedIn -> Empty("smile", if (photos) "No media posts yet." else "No posts yet. Write your first one.")
        st == "error" -> Fail("Could not load posts. Check your connection.") { app.on.feedTries = 0; app.on.feedStatus = "loading"; app.on.loadFeed() }
        else -> Loading()
    }
}

// threadV: the posts above (joined by a line), the post itself, then its replies (an opened reply lists everything under it)
@Composable
fun ThreadScreen(id: String) {
    val app = LocalApp.current
    val s = app.store
    val p = s.byId(id)
    Page({ Bar("Post", { BackBtn() }) }) {
        if (p == null) { Empty("smile", "This post is gone."); return@Page }
        // the replies of a post of somebody else that this phone does not have yet are fetched
        LaunchedEffect(p.remote) {
            val r = p.remote ?: return@LaunchedEffect
            if (app.signedIn && p.ra != null) app.on.mapRemotePosts(app.on.postsGet("id, user_id, body, created_at, parent_id, media_url") { Q("posts").select(it).eq("parent_id", r).order("created_at").limit(100) }.rows)
        }
        val anc = mutableListOf<LPost>()
        var q = s.byId(p.parent)
        while (q != null && q !== p && anc.size < 60 && q !in anc) { anc.add(0, q); q = s.byId(q.parent) }
        val reps = if (p.parent != null) s.flat(p.id) else s.kids(p.id).sortedBy { it.t }.map { it to 0 }
        LazyColumn(Modifier.fillMaxSize(), state = app.listStateFor(LocalPage.current)) {
            items(anc, key = { "a" + it.id }) { PostCard(it, line = true, compact = true) }
            item(key = "main") { MainPost(p) }
            items(reps, key = { it.first.id }) { (r, d) -> PostCard(r, rep = true, d = d, nc = p.parent != null, replyTo = d > 0) }
        }
    }
}

// the banner of a profile: its photo, the blurred profile picture, or the gradient
@Composable
fun BannerBox(banner: String?, avatar: String?, theme: String) {
    val c = LocalNook.current
    Box(Modifier.fillMaxWidth().aspectRatio(1000f / 330f)) {
        BannerPic(banner?.takeIf { Photos.ownMedia(it) }, avatar?.takeIf { Photos.ownMedia(it) }, theme)
    }
}

// profileV
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ProfileScreen() {
    val app = LocalApp.current
    val c = LocalNook.current
    val s = app.store
    val pr = s.profile
    val tabs = listOf("posts" to "Posts", "replies" to "Replies", "reposts" to "Reposts", "media" to "Media", "likes" to "Likes")
    val tab = s.profTab
    var fol by remember { mutableStateOf(0) }
    var fng by remember { mutableStateOf(0) }
    val me = app.on.me?.id
    LaunchedEffect(me) { if (me != null) app.on.countsOf(me) { a, b -> fol = a; fng = b } }
    Page({ Bar("Profile", { Lead() }) }) {
        LazyColumn(Modifier.fillMaxSize(), state = app.listStateFor(LocalPage.current)) {
            item(key = "head") {
                BannerBox(pr.banner, pr.avatar, pr.bannerTheme)
                Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 8.dp)) {
                    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                        MyAvatar(88.dp, ring = c.bg, modifier = Modifier.layoutOffsetUp(44.dp))
                        Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Pill("Edit Profile", Btn.Ghost, small = true) { app.panels.add(Panel.EditProfile) }
                            GhostIcon("dots") {
                                app.open(listOf(SheetItem("Copy handle", "copy") { app.clipboard("@" + pr.handle) }, SheetItem("Settings", "sliders") { app.root(Route.Settings) }, SheetItem("Cancel", cancel = true)), "@" + pr.handle)
                            }
                        }
                    }
                    if (pr.name.isNotEmpty()) T(pr.name, Fs.x3, FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
                    T("@" + pr.handle, color = c.muted)
                    val n = s.posts.count { it.mine }
                    Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        Stat(n, "post", "posts") {}
                        Stat(fol, "followers", "followers") { if (me != null) app.go(Route.Follows(me, true)) }
                        Stat(fng, "following", "following") { if (me != null) app.go(Route.Follows(me, false)) }
                    }
                    if (pr.bio.isNotEmpty()) Tx(pr.bio, modifier = Modifier.padding(top = 10.dp))
                }
            }
            stickyHeader(key = "tabs") { Box(Modifier.background(c.bg).lineBelow(c.line)) { Tabs(tabs.map { it.second }, tabs.indexOfFirst { it.first == tab }.coerceAtLeast(0), scroll = true) { s.profTab = tabs[it].first; app.persist() } } }
            when (tab) {
                "replies" -> postList(s.posts.filter { it.parent != null && it.mine }.sortedByDescending { it.t }, { Empty("reply", "No replies yet. Reply to one of your own posts.") }, replyTo = true)
                "reposts" -> postList(s.posts.filter { it.reposted && it.parent == null && !it.ai }.sortedByDescending { it.t }, { Empty("repost", "Posts you repost show up here.") })
                "media" -> mediaTiles(app, s.posts.filter { it.ra == null }.sortedByDescending { it.t })
                "likes" -> postList(s.posts.filter { it.liked }.sortedByDescending { it.t }, { Empty("heart", "Posts you like show up here.") }, replyTo = true)
                else -> {
                    item(key = "cr") { ComposerRow() }
                    // a post you repost sits in your posts too, at the time you reposted it
                    val items = s.posts.filter { it.parent == null && it.mine }.map { Triple(it, it.t, if (it.pinned) 1 else 0) } +
                        s.posts.filter { (it.ra != null || it.ai) && it.reposted && it.parent == null }.map { Triple(it, if (it.rpAt > 0) it.rpAt else it.t, 0) }
                    postList(items.sortedWith(compareByDescending<Triple<LPost, Long, Int>> { it.third }.thenByDescending { it.second }).map { it.first }, { Empty("smile", "No posts yet.") },
                        lab = { p -> if (p.ra != null || p.ai) "You reposted" else null }, pin = true)
                }
            }
        }
    }
}

// .mg: three square tiles a row with 3dp gaps; a tile opens its post
fun LazyListScope.mediaTiles(app: AppState, posts: List<LPost>) {
    val tiles = posts.flatMap { p -> p.imgs.map { p to it } }
    if (tiles.isEmpty()) item { Empty("image", "No photos yet.") }
    else items(tiles.chunked(3)) { row ->
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 3.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            row.forEach { (p, src) -> Pic(src, Modifier.weight(1f).aspectRatio(1f).clip(RoundedCornerShape(Rad.xs)).tap { app.go(Route.Thread(p.id)) }, want = 480) }
            repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
        }
    }
}

// .btns .ghost with an icon: the outlined pill with the three dots
@Composable
fun GhostIcon(icon: String, enabled: Boolean = true, onClick: () -> Unit) {
    val c = LocalNook.current
    val shape = RoundedCornerShape(Rad.pill)
    Box(Modifier.height(32.dp).alpha(if (enabled) 1f else 0.45f).clip(shape).border(1.dp, c.line, shape).pressTap(shape, enabled, onClick).padding(horizontal = 14.dp), contentAlignment = Alignment.Center) { NIcon(icon, 20.dp, c.fg) }
}

// pulls the avatar up over the banner by the given amount without leaving a gap under it (margin-top:-44px)
fun Modifier.layoutOffsetUp(by: Dp) = this.then(Modifier.layout { m, cons ->
    val pl = m.measure(cons)
    val up = by.roundToPx()
    layout(pl.width, pl.height - up) { pl.place(0, -up) }
})

@Composable
fun Stat(n: Int, one: String, many: String, onClick: () -> Unit) {
    val c = LocalNook.current
    Row(Modifier.tap(onClick = onClick)) { T(n.toString(), weight = FontWeight.Bold); T(" " + if (n == 1) one else many, color = c.muted) }
}

// savedV
@Composable
fun SavedScreen() {
    val app = LocalApp.current
    Page({ Bar("Saved", { Lead() }) }) {
        LazyColumn(Modifier.fillMaxSize(), state = app.listStateFor(LocalPage.current)) {
            postList(app.store.posts.filter { it.saved }.sortedByDescending { it.t }, { Empty("bookmark", "Nothing saved yet.") }, replyTo = true)
        }
    }
}

// tagV: every post that uses the tag (the whole tag only: #cat does not find #category)
@Composable
fun TagScreen(q: String) {
    val app = LocalApp.current
    val re = Regex("(^|[^\\p{L}\\p{N}_])" + Regex.escape(q) + "(?![\\p{L}\\p{N}_])", RegexOption.IGNORE_CASE)
    Page({ Bar(q, { BackBtn() }) }) {
        LazyColumn(Modifier.fillMaxSize(), state = app.listStateFor(LocalPage.current)) {
            postList(app.store.posts.filter { it.parent == null && re.containsMatchIn(it.text) }.sortedByDescending { ft(it) }, { Empty("smile", "No posts use $q yet.") })
        }
    }
}

// listsV
@Composable
fun ListsScreen() {
    val app = LocalApp.current
    val s = app.store
    Page({ Bar("Lists", { Lead() }) }, fab = if (s.lists.isNotEmpty()) ({ Fab("plus") { app.panels.add(Panel.ListForm(null)) } }) else null) {
        LazyColumn(Modifier.fillMaxSize(), state = app.listStateFor(LocalPage.current), contentPadding = PaddingValues(bottom = if (s.lists.isNotEmpty()) 88.dp else 0.dp)) {
            if (s.lists.isEmpty()) item { Empty("list", "Make your first list.") { Pill("New list") { app.panels.add(Panel.ListForm(null)) } } }
            items(s.lists, key = { it.id }) { l ->
                val n = l.ids.count { s.byId(it) != null }
                LRow({ Sq("list") }, l.name, "$n " + (if (n == 1) "post" else "posts") + if (l.desc.isNotEmpty()) " · " + l.desc else "") { app.go(Route.ListPage(l.id)) }
            }
        }
    }
}

// listV
@Composable
fun ListScreen(id: String) {
    val app = LocalApp.current
    val s = app.store
    val l = s.lists.firstOrNull { it.id == id }
    if (l == null) { LaunchedEffect(Unit) { app.pop() }; return }
    Page({
        Bar(l.name, { BackBtn() }, {
            IB("dots") {
                app.open(listOf(
                    SheetItem("Edit list", "edit") { app.panels.add(Panel.ListForm(l)) },
                    SheetItem("Delete list", "trash", danger = true) { app.confirm("Delete this list? The posts stay.", "Delete") { s.lists.remove(l); app.persist(); app.pop() } },
                ))
            }
        })
    }) {
        LazyColumn(Modifier.fillMaxSize(), state = app.listStateFor(LocalPage.current)) {
            postList(l.ids.mapNotNull { s.byId(it) }.sortedByDescending { it.t }, { Empty("list", "Empty list. Use the three dots on a post and pick Add to list.") }, replyTo = true)
        }
    }
}

// a person in a list: their picture, name and handle (or a line about them)
@Composable
fun PersonRow(id: String, a: JSONObject?, sub: String? = null, trail: (@Composable () -> Unit)? = null, onClick: () -> Unit) {
    val app = LocalApp.current
    val nm = app.on.nickOf(id).ifEmpty { a?.optString("display_name")?.ifEmpty { null } ?: a?.optString("username") ?: "user" }
    LRow({ RAv(nm, a?.optString("username") ?: "", a?.optStr("avatar"), 48.dp, id) }, nm, sub ?: ("@" + (a?.optString("username") ?: "user")), trail = trail, onClick = onClick)
}

// searchV: suggestions that change every 15 to 25 minutes, or the people a search finds
@Composable
fun SearchScreen() {
    val app = LocalApp.current
    val c = LocalNook.current
    var q by remember { mutableStateOf("") }
    var rows by remember { mutableStateOf<List<JSONObject>?>(null) }
    var info by remember { mutableStateOf("") }
    var empty by remember { mutableStateOf("") }
    LaunchedEffect(q.trim()) {
        val t = q.trim()
        if (t.length < 2) {
            while (true) {
                info = "Suggested people, refreshed often"
                val (got, next) = app.on.suggest()
                if (got == null) { rows = emptyList(); empty = "Could not load people." } else { rows = got; empty = "No one to suggest yet." }
                delay(next)
            }
        } else {
            delay(300)
            info = ""
            val got = app.on.searchPeople(t)
            if (got == null) { rows = emptyList(); empty = "Could not search." } else { rows = got; empty = "No one found." }
        }
    }
    Page({ Bar("Search", { Lead() }) }) {
        LazyColumn(Modifier.fillMaxSize()) {
            item { Box(Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp)) { Field(q, { if (it.length <= 30) q = it }, "Search people") } }
            item { T(info, Fs.sm, color = c.muted, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 8.dp, bottom = 8.dp)) }
            val r = rows
            if (r == null) item { Loading() }
            else if (r.isEmpty()) item { Empty("user", empty) }
            else items(r, key = { it.optString("id") }) { a ->
                PersonRow(a.optString("id"), a, "@" + a.optString("username") + (a.optString("bio").takeIf { it.isNotEmpty() }?.let { " · " + it.take(60) } ?: "")) { app.go(Route.User(a.optString("id"))) }
            }
        }
    }
}

// notifsV: the newest 100; a row dragged to the left is deleted
@Composable
fun NotifsScreen() {
    val app = LocalApp.current
    val c = LocalNook.current
    var notes by remember { mutableStateOf<List<Note>?>(null) }
    var fail by remember { mutableStateOf(false) }
    var tries by remember { mutableIntStateOf(0) }
    LaunchedEffect(tries) { val r = app.on.loadNotes(); if (r == null) fail = true else { notes = r; fail = false } }
    val scope = rememberCoroutineScope()
    Page({ Bar("Notifications", { BackBtn() }) }) {
        val n = notes
        LazyColumn(Modifier.fillMaxSize()) {
            when {
                fail && n == null -> item { Fail("Could not load notifications. Check your connection.") { fail = false; tries++ } }
                n == null -> item { Loading() }
                n.isEmpty() -> item { Empty("bell", "No notifications yet.") }
                else -> items(n, key = { it.id }) { x ->
                    val a = app.on.acctCache[x.actor]
                    SwipeRow({ app.on.deleteNote(x.id) }, { notes = notes?.filter { it.id != x.id } }) {
                        Box(Modifier.background(if (x.read) c.bg else c.accent.copy(alpha = 0.09f).compositeOver(c.bg))) {
                            LRow({ RAv(a?.optString("name") ?: "user", a?.optString("username") ?: "", a?.optStr("avatar"), 40.dp, x.actor) }, app.on.nickOf(x.actor).ifEmpty { a?.optString("name") ?: "user" }, NOTE_WHAT[x.kind] ?: "", ago(parseIso(x.created))) { app.on.openNote(x) }
                        }
                    }
                }
            }
        }
    }
}

private fun Color.compositeOver(bg: Color): Color { val a = alpha; return Color(red * a + bg.red * (1 - a), green * a + bg.green * (1 - a), blue * a + bg.blue * (1 - a), 1f) }

// swipeRow(): drag a row to the left to delete it; del() says whether the server removed it, gone() runs after the row is out
@Composable
fun SwipeRow(del: suspend () -> Boolean, gone: () -> Unit, content: @Composable () -> Unit) {
    val c = LocalNook.current
    val scope = rememberCoroutineScope()
    var dx by remember { mutableFloatStateOf(0f) }
    var w by remember { mutableFloatStateOf(1f) }
    Box(Modifier.fillMaxWidth().background(c.danger).onSizeChanged { w = it.width.toFloat() }) {
        Box(Modifier.matchParentSize().padding(end = 22.dp), contentAlignment = Alignment.CenterEnd) { NIcon("trash", 22.dp, Color.White) }
        Box(Modifier.offset { IntOffset(dx.roundToInt(), 0) }.background(c.bg).pointerInput(Unit) {
            detectHorizontalDragGestures(onDragEnd = {
                if (dx < -minOf(120.dp.toPx(), w * 0.35f)) { dx = -w; scope.launch { if (del()) gone() else dx = 0f } } else dx = 0f
            }, onDragCancel = { dx = 0f }) { _, d -> dx = minOf(0f, dx + d) }
        }) { content() }
    }
}

// followListV(): followers or following of a person
@Composable
fun FollowsScreen(r: Route.Follows) {
    val app = LocalApp.current
    val key = "fl:" + (if (r.followers) "followers" else "following") + ":" + r.id
    var ids by remember { mutableStateOf((Cache.read(key)?.v as? org.json.JSONArray)?.strings()) }
    var fail by remember { mutableStateOf(false) }
    var tries by remember { mutableIntStateOf(0) }
    var accts by remember { mutableStateOf<Map<String, JSONObject>>(emptyMap()) }
    LaunchedEffect(tries) {
        ids?.let { accts = app.on.cachedAccounts(it).m }
        val got = app.on.followIds(r.id, r.followers)
        if (got == null) { fail = ids == null } else { accts = app.on.cachedAccounts(got).m; ids = got }
    }
    Page({ Bar(if (r.followers) "Followers" else "Following", { BackBtn() }) }) {
        val l = ids
        LazyColumn(Modifier.fillMaxSize()) {
            when {
                l == null && fail -> item { Fail("Could not load this list. Check your connection.") { fail = false; tries++ } }
                l == null -> item { Loading() }
                l.isEmpty() -> item { Empty("user", if (r.followers) "No followers yet." else "Not following anyone yet.") }
                else -> items(l, key = { it }) { id -> PersonRow(id, accts[id]) { app.go(Route.User(id)) } }
            }
        }
    }
}

// blockedV
@Composable
fun BlockedScreen() {
    val app = LocalApp.current
    var ids by remember { mutableStateOf<List<String>?>(null) }
    var fail by remember { mutableStateOf(false) }
    var tries by remember { mutableIntStateOf(0) }
    var accts by remember { mutableStateOf<Map<String, JSONObject>>(emptyMap()) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(tries) { val got = app.on.blockedIds(); if (got == null) fail = true else { accts = app.on.cachedAccounts(got).m; ids = got } }
    Page({ Bar("Blocked accounts", { BackBtn() }) }) {
        val l = ids
        LazyColumn(Modifier.fillMaxSize()) {
            when {
                fail -> item { Fail("Could not load blocked accounts.") { fail = false; tries++ } }
                l == null -> item { Loading() }
                l.isEmpty() -> item { Empty("user", "You have not blocked anyone.") }
                else -> items(l, key = { it }) { id ->
                    var busy by remember { mutableStateOf(false) }
                    PersonRow(id, accts[id], trail = { Pill("Unblock", Btn.Ghost, small = true, enabled = !busy) { busy = true; scope.launch { if (app.on.unblock(id)) ids = ids?.minus(id) else busy = false } } }) { app.go(Route.User(id)) }
                }
            }
        }
    }
}

// hiddenChatsV
@Composable
fun HiddenScreen() {
    val app = LocalApp.current
    var ids by remember { mutableStateOf<List<String>?>(null) }
    var fail by remember { mutableStateOf(false) }
    var tries by remember { mutableIntStateOf(0) }
    var accts by remember { mutableStateOf<Map<String, JSONObject>>(emptyMap()) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(tries) {
        runCatching { app.on.loadDmMutes(true) }.onFailure { fail = true }
        val got = app.dm.hideSet.toList()
        accts = app.on.cachedAccounts(got).m; ids = got
    }
    Page({ Bar("Hidden chats", { BackBtn() }) }) {
        val l = ids
        LazyColumn(Modifier.fillMaxSize()) {
            when {
                fail && l == null -> item { Fail("Could not load hidden chats.") { fail = false; tries++ } }
                l == null -> item { Loading() }
                l.isEmpty() -> item { Empty("user", "You have no hidden chats.") }
                else -> items(l, key = { it }) { id ->
                    var busy by remember { mutableStateOf(false) }
                    PersonRow(id, accts[id], trail = { Pill("Unhide", Btn.Ghost, small = true, enabled = !busy) { busy = true; scope.launch { if (app.on.unhide(id)) ids = ids?.minus(id) else busy = false } } }) { app.on.openDm(id) }
                }
            }
        }
    }
}

// legalV: the same text as the web app (Legal.kt is made from it)
@Composable
fun LegalScreen(terms: Boolean) {
    val doc = if (terms) TERMS else PRIVACY
    val c = LocalNook.current
    Page({ Bar(doc.title, { BackBtn() }) }) {
        // the CSS margins collapse: the date 6 under the top, a heading 22 above and 6 below, list items 6 apart
        Column(Modifier.verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 54.dp)) {
            T("Last updated 25 October 2026", Fs.sm, color = c.muted)
            doc.body.forEach { (h, items) ->
                T(h, Fs.xl, FontWeight.Bold, modifier = Modifier.padding(top = 22.dp, bottom = 6.dp))
                items.forEachIndexed { i, t ->
                    Row(Modifier.padding(top = if (i > 0) 6.dp else 0.dp)) {
                        Box(Modifier.width(20.dp), contentAlignment = Alignment.TopCenter) { T("•", lineHeight = (15 * 1.55).sp) }
                        T(t, lineHeight = (15 * 1.55).sp)
                    }
                }
            }
        }
    }
}

// the languages of the feed (langSheet): Automatic, or any number of languages; the sheet stays open while picking
val LANGS = listOf("arabic" to "Arabic", "chinese" to "Chinese", "dutch" to "Dutch", "english" to "English", "french" to "French", "german" to "German", "greek" to "Greek", "hebrew" to "Hebrew", "hindi" to "Hindi", "indonesian" to "Indonesian", "italian" to "Italian", "japanese" to "Japanese", "korean" to "Korean", "persian" to "Persian", "polish" to "Polish", "portuguese" to "Portuguese", "russian" to "Russian", "spanish" to "Spanish", "thai" to "Thai", "turkish" to "Turkish", "ukrainian" to "Ukrainian", "urdu" to "Urdu")
fun langText(s: Store): String = s.langs?.mapNotNull { id -> LANGS.firstOrNull { it.first == id }?.second }?.sorted()?.joinToString(", ")?.ifEmpty { null } ?: "Automatic"
fun langSheet(app: AppState) {
    val s = app.store
    fun items(): List<SheetItem> {
        val sel = s.langs ?: emptyList()
        return listOf(SheetItem("Automatic", left = true, keep = true, on = sel.isEmpty()) { s.langs = null; app.persist(); app.sheet = app.sheet?.copy(items = items()) }) +
            LANGS.map { (id, name) ->
                SheetItem(name, left = true, keep = true, on = id in sel) {
                    val now = (s.langs ?: emptyList()).toMutableList().apply { if (id in this) remove(id) else add(id) }
                    s.langs = now.ifEmpty { null }; app.persist(); app.sheet = app.sheet?.copy(items = items())
                }
            } + SheetItem("Done", cancel = true)
    }
    app.open(items(), "Languages I read (pick as many as you like)")
}

// hinted(): the field with a hint under it once a limit or a rule is hit
@Composable
fun Hinted(value: String, max: Int, rule: String? = null, min: Int = 0, field: @Composable () -> Unit) {
    val c = LocalNook.current
    val n = value.length
    val (text, bad) = when {
        rule != null -> rule to true
        n >= max -> "Limit reached: $max characters at most" to true
        min > 0 && n in 1 until min -> "At least $min characters ($n/$min)" to false
        else -> "" to false
    }
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        field()
        if (text.isNotEmpty()) T(text, Fs.sm, color = if (bad) c.danger else c.muted)
    }
}
