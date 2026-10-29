package io.github.nookwebapp.native_ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.layout
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// The pages, one per route, each the copy of a view in app.js (named in its comment). Every page draws its own top area
// and its scrolling body; a page reached from another one gets a back arrow, a first page the menu button.

@Composable private fun MenuBtn() { val app = LocalApp.current; IB("menu") { app.drawer = true } }
@Composable private fun BackBtn() { val app = LocalApp.current; IB("back") { app.pop() } }
@Composable private fun BellBtn() { val app = LocalApp.current; IB("bell") { app.go(Route.Notifs) } }
@Composable private fun Lead() { if (LocalApp.current.stack.size > 1) BackBtn() else MenuBtn() }

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

// rankFeed() for posts that are all the owner's: newest first, fading by half every ten hours, with the words of
// "less like this" posts pushing a post down and hidden ones left out
fun rankFeed(s: Store, arr: List<LPost>): List<LPost> {
    val now = Clock.now()
    return arr.filter { it.id !in s.hidden }.map { p ->
        var sc = Math.pow(0.5, maxOf(0L, now - p.t) / 36e5 / 10) * 1.4
        val hit = wordsOf(p.text).count { (s.lessWords[it] ?: 0) > 0 }
        if (hit > 0) sc *= maxOf(0.3, 1 - 0.25 * hit)
        p to sc
    }.sortedByDescending { it.second }.map { it.first }
}

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
        val feed = s.posts.filter { it.parent == null && (!photos || it.imgs.isNotEmpty()) }.sortedByDescending { it.t }
        LazyColumn(Modifier.fillMaxSize(), state = app.listState()) {
            item { ComposerRow() }
            postList(rankFeed(s, feed), { Empty("smile", if (photos) "No media posts yet." else "No posts yet. Write your first one.") })
        }
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
        val anc = mutableListOf<LPost>()
        var q = s.byId(p.parent)
        while (q != null && q !== p && anc.size < 60 && q !in anc) { anc.add(0, q); q = s.byId(q.parent) }
        val reps = if (p.parent != null) s.flat(p.id) else s.kids(p.id).sortedBy { it.t }.map { it to 0 }
        LazyColumn(Modifier.fillMaxSize(), state = app.listState()) {
            items(anc, key = { "a" + it.id }) { PostCard(it, line = true, compact = true) }
            item(key = "main") { MainPost(p) }
            items(reps, key = { it.first.id }) { (r, d) -> PostCard(r, rep = true, d = d, nc = p.parent != null, replyTo = d > 0) }
        }
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
    Page({ Bar("Profile", { Lead() }) }) {
        LazyColumn(Modifier.fillMaxSize(), state = app.listState()) {
            item(key = "head") {
                Box(Modifier.fillMaxWidth().aspectRatio(1000f / 330f).background(Brush.linearGradient(listOf(c.b1, c.b2), androidx.compose.ui.geometry.Offset.Zero, androidx.compose.ui.geometry.Offset.Infinite))) {
                    BannerPic(pr.banner, pr.avatar, pr.bannerTheme)
                }
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
                    val n = s.posts.size
                    Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        Stat(n, "post", "posts") {}
                        Stat(0, "followers", "followers") { app.go(Route.Follows(true)) }
                        Stat(0, "following", "following") { app.go(Route.Follows(false)) }
                    }
                    if (pr.bio.isNotEmpty()) Tx(pr.bio, modifier = Modifier.padding(top = 10.dp))
                }
            }
            stickyHeader(key = "tabs") { Box(Modifier.background(c.bg).lineBelow(c.line)) { Tabs(tabs.map { it.second }, tabs.indexOfFirst { it.first == tab }.coerceAtLeast(0), scroll = true) { s.profTab = tabs[it].first; app.persist() } } }
            when (tab) {
                "replies" -> postList(s.posts.filter { it.parent != null }.sortedByDescending { it.t }, { Empty("reply", "No replies yet. Reply to one of your own posts.") }, replyTo = true)
                "reposts" -> postList(s.posts.filter { it.reposted && it.parent == null }.sortedByDescending { it.t }, { Empty("repost", "Posts you repost show up here.") })
                "media" -> {
                    val tiles = s.posts.sortedByDescending { it.t }.flatMap { p -> p.imgs.map { p to it } }
                    if (tiles.isEmpty()) item { Empty("image", "No photos yet.") }
                    else items(tiles.chunked(3)) { row ->
                        // .mg: three square tiles a row with 3dp gaps; a tile opens its post
                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 3.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                            row.forEach { (p, src) -> Pic(src, Modifier.weight(1f).aspectRatio(1f).clip(RoundedCornerShape(Rad.xs)).tap { app.go(Route.Thread(p.id)) }, want = 480) }
                            repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                }
                "likes" -> postList(s.posts.filter { it.liked }.sortedByDescending { it.t }, { Empty("heart", "Posts you like show up here.") }, replyTo = true)
                else -> {
                    item(key = "cr") { ComposerRow() }
                    postList(s.posts.filter { it.parent == null }.sortedWith(compareByDescending<LPost> { if (it.pinned) 1 else 0 }.thenByDescending { it.t }), { Empty("smile", "No posts yet.") }, pin = true)
                }
            }
        }
    }
}

// .btns .ghost with an icon: the outlined pill with the three dots
@Composable
fun GhostIcon(icon: String, onClick: () -> Unit) {
    val c = LocalNook.current
    val shape = RoundedCornerShape(Rad.pill)
    Box(Modifier.height(32.dp).clip(shape).border(1.dp, c.line, shape).pressTap(shape, onClick = onClick).padding(horizontal = 14.dp), contentAlignment = Alignment.Center) { NIcon(icon, 20.dp, c.fg) }
}

// pulls the avatar up over the banner by the given amount without leaving a gap under it (margin-top:-44px)
fun Modifier.layoutOffsetUp(by: Dp) = this.then(Modifier.layout { m, cons ->
    val pl = m.measure(cons)
    val up = by.roundToPx()
    layout(pl.width, pl.height - up) { pl.place(0, -up) }
})

@Composable
private fun Stat(n: Int, one: String, many: String, onClick: () -> Unit) {
    val c = LocalNook.current
    Row(Modifier.tap(onClick = onClick)) { T(n.toString(), weight = FontWeight.Bold); T(" " + if (n == 1) one else many, color = c.muted) }
}

// savedV
@Composable
fun SavedScreen() {
    val app = LocalApp.current
    Page({ Bar("Saved", { Lead() }) }) {
        LazyColumn(Modifier.fillMaxSize(), state = app.listState()) {
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
        LazyColumn(Modifier.fillMaxSize(), state = app.listState()) {
            postList(app.store.posts.filter { it.parent == null && re.containsMatchIn(it.text) }.sortedByDescending { it.t }, { Empty("smile", "No posts use $q yet.") })
        }
    }
}

// chatV: the chats on this phone (messages with people come when the app goes online)
@Composable
fun ChatsScreen() {
    val app = LocalApp.current
    val s = app.store
    Page({ Bar("Chats", { Lead() }) }, fab = if (s.chats.isNotEmpty()) ({ Fab("plus") { app.newChat() } }) else null) {
        LazyColumn(Modifier.fillMaxSize(), state = app.listState(), contentPadding = PaddingValues(bottom = if (s.chats.isNotEmpty()) 88.dp else 0.dp)) {
            if (s.chats.isEmpty()) item { Empty("smile", "Say hi to yourself.") { Pill("New chat") { app.newChat() } } }
            items(s.chats.sortedByDescending { c -> c.msgs.lastOrNull()?.t ?: c.t }, key = { it.id }) { ch ->
                val last = ch.msgs.lastOrNull()
                LRow({ MyAvatar(48.dp) }, ch.name, if (last == null) "No messages yet" else last.text.ifEmpty { "Sent a photo" }, last?.let { ago(it.t) }) { app.go(Route.Conv(ch.id)) }
            }
        }
    }
}

// listsV
@Composable
fun ListsScreen() {
    val app = LocalApp.current
    val s = app.store
    Page({ Bar("Lists", { Lead() }) }, fab = if (s.lists.isNotEmpty()) ({ Fab("plus") { app.panels.add(Panel.ListForm(null)) } }) else null) {
        LazyColumn(Modifier.fillMaxSize(), state = app.listState(), contentPadding = PaddingValues(bottom = if (s.lists.isNotEmpty()) 88.dp else 0.dp)) {
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
        LazyColumn(Modifier.fillMaxSize(), state = app.listState()) {
            postList(l.ids.mapNotNull { s.byId(it) }.sortedByDescending { it.t }, { Empty("list", "Empty list. Use the three dots on a post and pick Add to list.") }, replyTo = true)
        }
    }
}

// searchV: suggestions and search need the server, so offline there is nobody to show
@Composable
fun SearchScreen() {
    val c = LocalNook.current
    var q by remember { mutableStateOf("") }
    Page({ Bar("Search", { Lead() }) }) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            Box(Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp)) { Field(q, { if (it.length <= 30) q = it }, "Search people", Modifier.padding(top = 6.dp)) }
            val typed = q.trim().length >= 2
            T(if (typed) "" else "Suggested people, refreshed often", Fs.sm, color = c.muted, align = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 12.dp, bottom = 8.dp))
            Empty("user", if (typed) "No one found." else "No one to suggest yet.")
        }
    }
}

@Composable
fun NotifsScreen() = Page({ Bar("Notifications", { Lead() }) }) {
    Column(Modifier.verticalScroll(rememberScrollState())) { Empty("bell", "No notifications yet.") }
}

@Composable
fun FollowsScreen(r: Route.Follows) = Page({ Bar(if (r.followers) "Followers" else "Following", { BackBtn() }) }) {
    Empty("user", if (r.followers) "No followers yet." else "Not following anyone yet.")
}

@Composable
fun BlockedScreen() = Page({ Bar("Blocked accounts", { BackBtn() }) }) { Empty("user", "You have not blocked anyone.") }

@Composable
fun HiddenScreen() = Page({ Bar("Hidden chats", { BackBtn() }) }) { Empty("user", "You have no hidden chats.") }

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

// settingsV. What needs the server (password, email, fingerprint, authenticator, key backup, phone notifications,
// blocked people) says so while the app is offline; the rest works on this phone.
@Composable
fun SettingsScreen() {
    val app = LocalApp.current
    val s = app.store
    val ic: (String, Dp) -> @Composable () -> Unit = { n, sz -> { NIcon(n, sz, androidx.compose.material3.LocalContentColor.current) } }
    val later = { app.say("This works once the app is online") }
    Page({ Bar("Settings", { Lead() }) }) {
        Column(Modifier.verticalScroll(app.settingsScroll).padding(bottom = 24.dp)) {
            Sec("Appearance")
            Seg(listOf("System", "Dark", "Light"), s.theme.ordinal) { s.theme = ThemeMode.entries[it]; app.persist() }
            Sec("Account")
            Group {
                SRow({ MyAvatar(36.dp) }, "Edit profile", "@" + s.profile.handle) { app.panels.add(Panel.EditProfile) }
                SRow(ic("userswap", 22.dp), "Switch account", "Add or switch accounts") { later() }
                SRow(ic("usercut", 22.dp), "Sign out", "Log out from this device", last = true) { app.confirm("Sign out of @${s.profile.handle} on this phone?", "Sign out") { s.signedIn = false; app.persist(); app.root(Route.Auth) } }
            }
            Sec("Login")
            Group {
                SRow(ic("pass", 22.dp), "Change password", "Update your password") { later() }
                SRow(ic("mail", 22.dp), "Change email", "Update your email") { later() }
                SRow(ic("lock", 22.dp), "Fingerprint", "Off") { later() }
                SRow(ic("shield", 22.dp), "Authenticator app", "Off") { later() }
                SRow(ic("backup", 22.dp), "Message key backup", "Off", last = true) { later() }
            }
            Sec("Feed")
            Group { SRow(ic("list", 22.dp), "Languages I read", langText(s), last = true) { langSheet(app) } }
            Sec("Notifications")
            Group { SRow(ic("bell", 24.dp), "Phone notifications", "Off", last = true) { later() } }
            Sec("Your account")
            Group {
                SRow(ic("close", 22.dp), "Blocked accounts", "People you blocked") { app.go(Route.Blocked) }
                SRow(ic("eyeoff", 22.dp), "Hidden chats", "Chats you hid") { app.go(Route.Hidden) }
                SRow(ic("moon", 22.dp), "Deactivate account", "Hidden until you sign back in", last = true) { later() }
            }
            Sec("Your data")
            Group { SRow(ic("copy", 22.dp), "Download backup", "Posts, notes and media", last = true) { app.backup() } }
            Sec("Updates")
            Group { SRow(ic("refresh", 22.dp), "Check for updates", "Version $APP_VERSION", last = true) { app.say("Up to date") } }
            Sec("Legal")
            Group {
                SRow(ic("eyeoff", 22.dp), "Privacy Policy", "What we collect") { app.go(Route.Legal(false)) }
                SRow(ic("list", 22.dp), "Terms of Use", "The rules of Nook", last = true) { app.go(Route.Legal(true)) }
            }
            Sec("Danger zone")
            Group {
                SRow(ic("trash", 22.dp), "Delete account", "Deleted after 30 days", danger = true, last = true) {
                    app.open(listOf(
                        SheetItem("Download my data first", "copy") { app.backup() },
                        SheetItem("Delete without downloading", "trash", danger = true) {
                            app.confirm("Delete everything on this phone? Posts, chats, lists and photos go for good.", "Delete") { s.wipe(); app.root(Route.Auth) }
                        },
                        SheetItem("Cancel", cancel = true),
                    ), "Want a copy of your data before you delete your account?")
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

// authV: sign in and make an account. Offline, making an account makes the profile on this phone, and signing in
// opens what is already here.
@Composable
fun AuthScreen() {
    val app = LocalApp.current
    val c = LocalNook.current
    val up = app.authUp
    var email by remember { mutableStateOf("") }
    var pw by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var user by remember { mutableStateOf("") }
    var show by remember { mutableStateOf(false) }
    var agree by remember { mutableStateOf(false) }
    var msg by remember { mutableStateOf("") }
    val go = {
        msg = ""
        val e = email.trim(); val u = user.trim()
        when {
            e.isEmpty() && pw.isEmpty() -> msg = "Enter your email and password"
            e.isEmpty() -> msg = "Enter your email"
            !Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$").matches(e) -> msg = "That email does not look right. Check for typos"
            pw.isEmpty() -> msg = "Enter your password"
            up && name.trim().isEmpty() -> msg = "Enter a display name"
            up && !agree -> msg = "Agree to the terms and privacy policy to continue"
            up && !Regex("^[A-Za-z0-9._]{1,15}$").matches(u) -> msg = "Username: letters, numbers, dots or underscores, max 15"
            up && pw.length < 8 -> msg = "Password needs at least 8 characters"
            else -> {
                if (up) { app.store.profile.name = name.trim(); app.store.profile.handle = u.lowercase() }
                app.store.signedIn = true; app.persist(); app.root(Route.Home)
            }
        }
    }
    BoxWithConstraints(Modifier.fillMaxSize().background(c.bg)) {
        val topPad = maxOf(32.dp, maxHeight * 0.1f)
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).widthIn(max = 400.dp).align(Alignment.TopCenter).padding(start = 16.dp, end = 16.dp, top = topPad, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            T("Nook", Fs.x3, FontWeight.Bold, align = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 4.dp))
            T(if (up) "Make your account" else "Sign in to continue", color = c.muted, align = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp))
            if (up) {
                Hinted(name, 15) { Field(name, { if (it.length <= 15) name = it }, "Display name", border = true) }
                Hinted(user, 15, if (user.isNotEmpty() && !Regex("^[A-Za-z0-9._]*$").matches(user)) "Only letters, numbers, dots and underscores" else null) { Field(user, { if (it.length <= 15) user = it }, "Username", border = true) }
            }
            Field(email, { email = it }, "Email", border = true)
            val pwField = @Composable { Field(pw, { if (it.length <= 72) pw = it }, "Password", border = true, password = !show, trailing = { Box(Modifier.tap { show = !show }) { T(if (show) "Hide" else "Show", Fs.md, FontWeight.SemiBold, c.muted) } }) }
            if (up) Hinted(pw, 72, null, 8) { pwField() } else pwField()
            if (up) Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.padding(top = 2.dp).size(20.dp).clip(RoundedCornerShape(6.dp)).background(if (agree) c.fill else c.bg2).border(1.5.dp, if (agree) c.fill else c.muted, RoundedCornerShape(6.dp)).tap { agree = !agree }, contentAlignment = Alignment.Center) {
                    if (agree) NIcon("check", 14.dp, Color.White)
                }
                Row { T("I am 18+ and agree to the ", Fs.md, color = c.muted); Box(Modifier.tap { app.go(Route.Legal(true)) }) { T("Terms", Fs.md, FontWeight.SemiBold, c.lnk) }; T(" and ", Fs.md, color = c.muted); Box(Modifier.tap { app.go(Route.Legal(false)) }) { T("Privacy", Fs.md, FontWeight.SemiBold, c.lnk) } }
            }
            if (msg.isNotEmpty()) T(msg, Fs.md, color = c.muted, align = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            Pill(if (up) "Create account" else "Sign in", Btn.Pri, modifier = Modifier.fillMaxWidth(), onClick = go)
            if (!up) Pill("Sign in with Fingerprint", Btn.Ghost, modifier = Modifier.fillMaxWidth()) { msg = "This works once the app is online" }
            if (!up) Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { Box(Modifier.tap { msg = "This works once the app is online" }.vpad(8.dp)) { T("Forgot password?", Fs.md, color = c.muted) } }
            Pill(if (up) "I already have an account" else "Make an account", Btn.Ghost, modifier = Modifier.fillMaxWidth()) { app.authUp = !up; msg = "" }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                Box(Modifier.tap { app.go(Route.Legal(true)) }) { T("Terms", Fs.md, color = c.muted) }; T(" · ", Fs.md, color = c.muted); Box(Modifier.tap { app.go(Route.Legal(false)) }) { T("Privacy", Fs.md, color = c.muted) }
            }
        }
    }
}

// hinted(): the field with a hint under it once a limit or a rule is hit
@Composable
private fun Hinted(value: String, max: Int, rule: String? = null, min: Int = 0, field: @Composable () -> Unit) {
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
