package io.github.nookwebapp.native_ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.layout.layout
import androidx.compose.foundation.ExperimentalFoundationApi

// The pages, one per route. Each draws its own top area (Top) and its scrolling body, like each view in the web app.

@Composable private fun MenuBtn() { val app = LocalApp.current; IB("menu") { app.drawer = true } }
@Composable private fun BackBtn() { val app = LocalApp.current; IB("back") { app.back() } }
@Composable private fun BellBtn() { val app = LocalApp.current; IB("bell") { app.go(Route.Notifs) } }
// a page reached from another one gets a back arrow, a first page the menu
@Composable private fun Lead() { if (LocalApp.current.stack.size > 1) BackBtn() else MenuBtn() }

@Composable
fun Page(top: @Composable ColumnScope.() -> Unit, body: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize().background(LocalNook.current.bg)) {
        Top(top)
        Column(Modifier.weight(1f).fillMaxWidth(), content = body)
    }
}

@Composable
fun HomeScreen() {
    val app = LocalApp.current
    Page({
        Bar("Nook", { MenuBtn() }, { BellBtn() })
        Tabs(listOf("For you", "Media"), app.homeTab) { app.homeTab = it }
    }) {
        val shown = if (app.homeTab == 1) Sample.posts.filter { it.pic && it.parent == null } else Sample.posts.filter { it.parent == null }
        LazyColumn(Modifier.fillMaxSize()) {
            item { ComposerRow() }
            if (shown.isEmpty()) item { Empty("smile", if (app.homeTab == 1) "No media posts yet." else "No posts yet. Write your first one.") }
            items(shown, key = { it.id }) { PostCard(it, label = it.repostedBy?.let { n -> "$n reposted" }) }
        }
    }
}

@Composable
fun ThreadScreen(id: String) {
    val app = LocalApp.current
    val p = app.post(id)
    Page({ Bar("Post", { BackBtn() }) }) {
        if (p == null) { Empty(null, "This post is gone."); return@Page }
        LazyColumn(Modifier.fillMaxSize()) {
            item { MainPost(p) }
            items(Sample.posts.filter { it.parent == p.id }, key = { it.id }) { PostCard(it, depth = 0) }
        }
    }
}

// own profile and someone else's share this layout (.banner, .pinfo, .ptabs)
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ProfileBody(who: Person, own: Boolean) {
    val app = LocalApp.current
    val c = LocalNook.current
    val mine = Sample.posts.filter { it.author.id == who.id }
    val tabs = listOf("Posts", "Replies", "Reposts", "Media", "Likes")
    val shown = when (app.profileTab) {
        0 -> mine.filter { it.parent == null }; 1 -> mine.filter { it.parent != null }
        2 -> Sample.posts.filter { it.reposted }; 3 -> mine.filter { it.pic }; else -> Sample.posts.filter { it.liked }
    }
    var following by remember(who.id) { mutableStateOf(false) }
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Box(Modifier.fillMaxWidth().aspectRatio(1000f / 330f).background(Brush.linearGradient(listOf(c.b1, c.b2))))
            Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 8.dp)) {
                Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                    Avatar(who, 88.dp, ring = c.bg, modifier = Modifier.offset(y = 0.dp).layoutOffsetUp(44.dp))
                    Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (own) Pill("Edit Profile", Btn.Ghost, small = true) { app.panel = Panel.EditProfile }
                        else Pill(if (following) "Following" else "Follow", if (following) Btn.FOn else Btn.F, small = true) { following = !following }
                        // the more button is an outlined pill with the dots, like the Edit Profile one
                        Box(Modifier.height(32.dp).clip(RoundedCornerShape(Rad.pill)).border(1.dp, c.line, RoundedCornerShape(Rad.pill)).tap(RoundedCornerShape(Rad.pill)) { profileSheet(app, who, own) }.padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
                            NIcon("dots", 20.dp, c.fg)
                        }
                    }
                }
                T(who.name, Fs.x3, FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
                T("@" + who.handle, color = c.muted)
                if (who.bio.isNotEmpty()) T(who.bio, modifier = Modifier.padding(top = 10.dp))
                Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Stat(mine.count { it.parent == null }, "post", "posts") {}
                    Stat(if (following) 1 else 0, "follower", "followers") { app.go(Route.Follows(who.id, true)) }
                    Stat(0, "following", "following") { app.go(Route.Follows(who.id, false)) }
                }
            }
        }
        stickyHeader { Box(Modifier.background(c.bg).lineBelow(c.line)) { Tabs(tabs, app.profileTab, scroll = true) { app.profileTab = it } } }
        if (own && app.profileTab == 0) item { ComposerRow() }
        if (shown.isEmpty()) item { Empty("smile", if (app.profileTab == 0) "No posts yet." else "Nothing here yet.") }
        items(shown, key = { it.id }) { PostCard(it) }
    }
}

// pulls the avatar up over the banner by the given amount without leaving a gap under it (margin-top:-44px)
fun Modifier.layoutOffsetUp(by: androidx.compose.ui.unit.Dp) = this.then(Modifier.layout { m, cons ->
    val pl = m.measure(cons)
    val up = by.roundToPx()
    layout(pl.width, pl.height - up) { pl.place(0, -up) }
})

@Composable
private fun Stat(n: Int, one: String, many: String, onClick: () -> Unit) {
    val c = LocalNook.current
    Row(Modifier.tap(onClick = onClick)) { T(n.toString(), weight = FontWeight.Bold); T(" " + if (n == 1) one else many, color = c.muted) }
}

fun profileSheet(app: AppState, who: Person, own: Boolean) {
    if (own) app.open(listOf(
        SheetItem("Copy handle", "copy") { app.say("Copied") }, SheetItem("Settings", "sliders") { app.root(Route.Settings) }, SheetItem("Cancel", cancel = true),
    ), "@" + who.handle)
    else app.open(listOf(
        SheetItem("Mute account", "eyeoff") { app.say("Muted. Their posts are hidden from your feed") },
        SheetItem("Report account", "flag", danger = true) {},
        SheetItem("Block", "close", danger = true) { app.say("Blocked") },
        SheetItem("Cancel", cancel = true),
    ), "@" + who.handle)
}

@Composable
fun ProfileScreen() = Page({ Bar("Profile", { Lead() }) }) { ProfileBody(Sample.me, true) }

@Composable
fun UserScreen(id: String) {
    val who = LocalApp.current.person(id) ?: Person(id, "user", "user")
    Page({ Bar(who.name, { Lead() }) }) { ProfileBody(who, false) }
}

@Composable
fun SavedScreen() {
    val saved = Sample.posts.filter { it.saved }
    Page({ Bar("Saved", { Lead() }) }) {
        LazyColumn(Modifier.fillMaxSize()) {
            if (saved.isEmpty()) item { Empty("bookmark", "Nothing saved yet.") }
            items(saved, key = { it.id }) { PostCard(it) }
        }
    }
}

// the list of chats only: the conversations themselves come later
@Composable
fun ChatsScreen() {
    val app = LocalApp.current
    val c = LocalNook.current
    Page({ Bar("Chats", { Lead() }, { IB("edit") { app.say("New chat") } }) }) {
        LazyColumn(Modifier.fillMaxSize()) {
            if (app.chats.isEmpty()) item { Empty("smile", "Say hi to yourself.") { Pill("New chat") {} } }
            items(app.chats, key = { it.id }) { ch ->
                LRow(
                    { if (ch.note) Sq("edit") else Avatar(ch.who, 48.dp) },
                    if (ch.note) "Notes" else ch.who.name, ch.last, ch.time, subStrong = ch.unread > 0,
                    trail = if (ch.unread > 0) ({ Badge(ch.unread) }) else if (ch.muted) ({ NIcon("bellOff", 16.dp, c.muted) }) else null,
                ) { app.say("Chats come in the next step") }
            }
        }
    }
}

@Composable
fun NotifsScreen() = Page({ Bar("Notifications", { Lead() }) }) {
    Column(Modifier.verticalScroll(rememberScrollState())) { Empty("bell", "No notifications yet.") }
}

@Composable
fun ListsScreen() {
    val app = LocalApp.current
    Page({ Bar("Lists", { Lead() }) }) {
        LazyColumn(Modifier.fillMaxSize()) {
            if (app.lists.isEmpty()) item { Empty("list", "Make your first list.") { Pill("New list") {} } }
            items(app.lists, key = { it.id }) { l ->
                LRow({ Sq("list") }, l.name, "${l.count} " + if (l.count == 1) "post" else "posts") { app.go(Route.ListPage(l.id)) }
            }
            if (app.lists.isNotEmpty()) item { Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { Pill("New list") {} } }
        }
    }
}

@Composable
fun ListScreen(id: String) {
    val l = LocalApp.current.lists.firstOrNull { it.id == id }
    Page({ Bar(l?.name ?: "List", { BackBtn() }) }) {
        LazyColumn(Modifier.fillMaxSize()) { items(Sample.posts.take(3), key = { it.id }) { PostCard(it) } }
    }
}

@Composable
fun SearchScreen() {
    val app = LocalApp.current
    val c = LocalNook.current
    var q by remember { mutableStateOf("") }
    Page({ Bar("Search", { Lead() }) }) {
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.padding(start = 16.dp, end = 16.dp, top = 18.dp)) { Field(q, { q = it }, "Search people") }
            T("Suggested people, refreshed often", Fs.sm, color = c.muted, align = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp))
            LazyColumn(Modifier.weight(1f)) {
                val found = app.suggested.filter { q.isBlank() || it.name.contains(q, true) || it.handle.contains(q, true) }
                if (found.isEmpty()) item { Empty("user", if (q.isBlank()) "No one to suggest yet." else "No one found.") }
                items(found, key = { it.id }) { p ->
                    var on by remember { mutableStateOf(false) }
                    LRow({ Avatar(p, 44.dp) }, p.name, "@" + p.handle, trail = { Pill(if (on) "Following" else "Follow", if (on) Btn.FOn else Btn.F, small = true) { on = !on } }) { app.go(Route.User(p.id)) }
                }
            }
        }
    }
}

@Composable
fun FollowsScreen(r: Route.Follows) {
    val app = LocalApp.current
    Page({ Bar(if (r.followers) "Followers" else "Following", { BackBtn() }) }) {
        LazyColumn(Modifier.fillMaxSize()) {
            val list = if (r.followers) emptyList() else emptyList<Person>()
            if (list.isEmpty()) item { Empty(null, if (r.followers) "No followers yet." else "Not following anyone yet.") }
            items(list) { p -> LRow({ Avatar(p, 44.dp) }, p.name, "@" + p.handle) { app.go(Route.User(p.id)) } }
        }
    }
}

@Composable
fun BlockedScreen() = Page({ Bar("Blocked accounts", { BackBtn() }) }) { Empty(null, "You have not blocked anyone.") }

@Composable
fun HiddenScreen() = Page({ Bar("Hidden chats", { BackBtn() }) }) { Empty(null, "No hidden chats.") }

@Composable
fun LegalScreen(terms: Boolean) = Page({ Bar(if (terms) "Terms of Use" else "Privacy Policy", { BackBtn() }) }) {
    val c = LocalNook.current
    Column(Modifier.verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 48.dp)) {
        T("Last updated October 2026", Fs.sm, color = c.muted)
        T(if (terms) "The rules of Nook" else "What we collect", Fs.xl, FontWeight.Bold, modifier = Modifier.padding(top = 22.dp, bottom = 6.dp))
        T("The full text is read from the web app when the screens are wired up.", lineHeight = (15 * 1.55).sp)
    }
}


@Composable
fun SettingsScreen() {
    val app = LocalApp.current
    val c = LocalNook.current
    val ic: (String) -> @Composable () -> Unit = { n -> { NIcon(n, 22.dp, LocalNook.current.muted) } }
    Page({ Bar("Settings", { Lead() }) }) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
            Sec("Appearance")
            Seg(listOf("System", "Dark", "Light"), app.theme.ordinal) { app.theme = ThemeMode.entries[it] }
            Sec("Account")
            Group {
                SRow({ Avatar(Sample.me, 36.dp) }, "Edit profile", "@" + Sample.me.handle) { app.panel = Panel.EditProfile }
                SRow(ic("userswap"), "Switch account", "Add or switch accounts") { app.open(listOf(SheetItem(Sample.me.name, person = Sample.me, on = true), SheetItem("Add account", "plus"), SheetItem("Cancel", cancel = true)), "Switch account") }
                SRow(ic("usercut"), "Sign out", "Log out from this device", last = true) { app.confirm("Sign out of this device?", "Sign out") { app.root(Route.Auth) } }
            }
            Sec("Login")
            Group {
                SRow(ic("pass"), "Change password", "Update your password")
                SRow(ic("mail"), "Change email", "Update your email")
                SRow(ic("lock"), "Fingerprint", "Off")
                SRow(ic("shield"), "Authenticator app", "Off")
                SRow(ic("backup"), "Message key backup", "On", last = true)
            }
            Sec("Feed")
            Group { SRow(ic("list"), "Languages I read", "Automatic", last = true) }
            Sec("Notifications")
            Group { SRow(ic("bell"), "Phone notifications", "Blocked in phone settings", last = true) }
            Sec("Your account")
            Group {
                SRow(ic("close"), "Blocked accounts", "People you blocked") { app.go(Route.Blocked) }
                SRow(ic("eyeoff"), "Hidden chats", "Chats you hid") { app.go(Route.Hidden) }
                SRow(ic("moon"), "Deactivate account", "Hidden until you sign back in", last = true)
            }
            Sec("Your data")
            Group { SRow(ic("copy"), "Download backup", "Posts, notes and media", last = true) }
            Sec("Updates")
            Group { SRow(ic("refresh"), "Check for updates", "Version 0.1 (native)", last = true) { app.say("Up to date") } }
            Sec("Legal")
            Group {
                SRow(ic("eyeoff"), "Privacy Policy", "What we collect") { app.go(Route.Legal(false)) }
                SRow(ic("list"), "Terms of Use", "The rules of Nook", last = true) { app.go(Route.Legal(true)) }
            }
            Sec("Danger zone")
            Group { SRow(ic("trash"), "Delete account", "Deleted after 30 days", danger = true, last = true) { app.confirm("Delete your account?", "Delete") {} } }
        }
    }
}

// sign in and make an account (.auth)
@Composable
fun AuthScreen() {
    val app = LocalApp.current
    val c = LocalNook.current
    var signUp by remember { mutableStateOf(false) }
    var email by remember { mutableStateOf("") }
    var pw by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var user by remember { mutableStateOf("") }
    var show by remember { mutableStateOf(false) }
    BoxWithConstraints(Modifier.fillMaxSize().background(c.bg)) {
        val topPad = maxOf(32.dp, maxHeight * 0.1f)
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).widthIn(max = 400.dp).align(Alignment.TopCenter).padding(start = 16.dp, end = 16.dp, top = topPad, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            T("Nook", Fs.x3, FontWeight.Bold, align = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 4.dp))
            T(if (signUp) "Make your account" else "Sign in to continue", color = c.muted, align = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp))
            Field(email, { email = it }, "Email", border = true)
            Field(pw, { pw = it }, "Password", border = true, trailing = { Box(Modifier.tap { show = !show }) { T(if (show) "Hide" else "Show", Fs.md, FontWeight.SemiBold, c.muted) } })
            if (signUp) {
                Field(name, { name = it }, "Display name", border = true)
                Field(user, { user = it }, "Username", border = true)
            }
            Pill(if (signUp) "Make account" else "Sign in", Btn.Pri, modifier = Modifier.fillMaxWidth()) { app.root(Route.Home) }
            if (!signUp) {
                Pill("Sign in with Fingerprint", Btn.Ghost, modifier = Modifier.fillMaxWidth()) {}
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { Box(Modifier.tap {}.padding(vertical = 8.dp)) { T("Forgot password?", Fs.md, color = c.muted) } }
            }
            Pill(if (signUp) "I have an account" else "Make an account", Btn.Ghost, modifier = Modifier.fillMaxWidth()) { signUp = !signUp }
            T("Terms · Privacy", Fs.md, color = c.muted, align = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
        }
    }
}
