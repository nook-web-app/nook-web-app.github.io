package io.github.nookwebapp.native_ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

// userV: somebody else's profile. The page shows what this phone remembers at once and is brought up to date
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun UserScreen(id: String, fromMenu: Boolean = false) {
    val app = LocalApp.current
    val c = LocalNook.current
    val s = app.store
    val on = app.on
    val pg = remember(id) { UserPage(id) }
    LaunchedEffect(id) { on.loadUser(pg) }
    // the pull down to refresh reads this profile again
    DisposableEffect(id) {
        val hook: suspend () -> Unit = { on.loadUser(pg); on.loadUserPosts(id); kotlinx.coroutines.delay(900) }
        app.pullHook = hook
        onDispose { if (app.pullHook === hook) app.pullHook = null }
    }
    var autoTry by remember(id) { mutableIntStateOf(0) }
    LaunchedEffect(pg.state) { if (pg.state == "fail" && autoTry < 3) { kotlinx.coroutines.delay(2500); autoTry++; pg.state = ""; on.loadUser(pg) } }
    pg.version
    val found = s.posts.firstOrNull { it.ra?.id == id }?.ra
    val acc = pg.st?.acc
    // what this phone already knows about the person (from a list of people) shows while the page loads
    val known = on.acctCache[id]
    val name = acc?.let { if (it.isNull("display_name")) it.optString("username") else it.optString("display_name") } ?: found?.name ?: known?.optString("name")?.ifEmpty { null } ?: "user"
    val handle = acc?.optString("username") ?: found?.handle ?: known?.optString("username")?.ifEmpty { null } ?: "user"
    val avatar = acc?.optStr("avatar") ?: found?.avatar ?: known?.optStr("avatar")
    var tab by remember(id) { mutableStateOf("posts") }
    val ownerOfZen = on.zenId() == id && on.isOwner()
    Page({ Bar(name.ifEmpty { "@$handle" }, { if (fromMenu) MenuBtn() else BackBtn() }) }) {
        when (pg.state) {
            "gone", "blockedMe", "fail" -> {
                Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).vpad(6.dp, 10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    T(found?.name ?: name, weight = FontWeight.Bold)
                    T(when (pg.state) { "gone" -> "This account is not available"; "blockedMe" -> "This account blocked you"; else -> "Could not load this profile. Check your connection." }, Fs.md, color = c.muted)
                    if (pg.state == "fail") Pill("Try again", Btn.Ghost) { pg.state = ""; on.loadUser(pg) }
                }
                return@Page
            }
        }
        // worked out again only when a post it reads changes, not on every recomposition of the page
        val mine by remember(id) { derivedStateOf { s.posts.filter { it.ra?.id == id }.sortedByDescending { it.t } } }
        val byRem by remember { derivedStateOf { HashMap<String, LPost>().also { m -> s.posts.forEach { p -> p.remote?.let { m.putIfAbsent(it, p) } } } } }
        // the lists of reposts and likes are fetched again each time the tab opens, not each time its row scrolls into view
        LaunchedEffect(id, tab) { if (tab == "reposts" || tab == "likes") on.idsTab(pg, tab) }
        LazyColumn(Modifier.fillMaxSize(), state = app.listStateFor(LocalPage.current)) {
            item(key = "head") {
                BannerBox(acc?.optStr("banner"), avatar, acc?.optString("banner_theme") ?: "default")
                Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 8.dp)) {
                    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                        Box(Modifier.layoutOffsetUp(44.dp).size(88.dp).clip(CircleShape).background(c.bg).padding(4.dp)) { RAv(name, handle, avatar, 80.dp, id, letter = 34.sp) }
                        Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (ownerOfZen) {
                                val st = pg.st
                                // the owner can follow Zenith like everybody else, the button first as on every profile
                                if (st?.blocked != true) Pill(if (st?.following == true) "Following" else "Follow", if (st?.following == true) Btn.FOn else Btn.F, small = true, enabled = st != null) { on.toggleFollow(pg) }
                                Pill("Edit Profile", Btn.Ghost, small = true) { app.panels.add(Panel.ZenEdit) }
                            } else {
                                val st = pg.st
                                if (st?.blocked != true) Pill(if (st?.following == true) "Following" else if (st?.followsMe == true) "Follow back" else "Follow", if (st?.following == true) Btn.FOn else Btn.F, small = true, enabled = st != null) { on.toggleFollow(pg) }
                                if (st != null && st.following && st.followsMe && !st.blocked) Pill("Message", Btn.Ghost, small = true) { on.openDm(id) }
                                GhostIcon("dots", enabled = st != null) {
                                    val x = pg.st ?: return@GhostIcon
                                    app.open(listOf(
                                        SheetItem(if (x.muted) "Unmute account" else "Mute account", "eyeoff") { on.toggleMute(pg) },
                                        SheetItem("Report account", "flag", danger = true) { on.reportAccount(id) },
                                        SheetItem(if (x.blocked) "Unblock" else "Block", "close", danger = !x.blocked) { on.toggleBlock(pg) },
                                        SheetItem("Cancel", cancel = true)), "@$handle")
                                }
                            }
                        }
                    }
                    if (name.isNotEmpty()) T(name, Fs.x3, FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
                    T("@$handle", color = c.muted)
                    Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        Stat(mine.count { it.parent == null }, "post", "posts") {}
                        Stat(pg.followers, "followers", "followers") { app.go(Route.Follows(id, true)) }
                        Stat(pg.following, "following", "following") { app.go(Route.Follows(id, false)) }
                    }
                    acc?.optString("bio")?.takeIf { it.isNotEmpty() }?.let { T(it, modifier = Modifier.padding(top = 10.dp)) }
                }
            }
            val tabs = listOf("posts" to "Posts", "replies" to "Replies", "reposts" to "Reposts", "media" to "Media", "likes" to "Likes")
            item(key = "tabs") { Box(Modifier.background(c.bg).lineBelow(c.line)) { Tabs(tabs.map { it.second }, tabs.indexOfFirst { it.first == tab }.coerceAtLeast(0), scroll = true) { tab = tabs[it].first } } }
            when (tab) {
                "replies" -> postList(mine.filter { it.parent != null }, { Empty("reply", "No replies yet.") }, replyTo = true)
                "media" -> mediaTiles(app, mine)
                "reposts", "likes" -> {
                    val ids = pg.tabIds[tab]
                    if (ids == null && tab !in pg.tabFail) item { Loading() }
                    else if (ids == null) item { Fail("Could not load this list. Check your connection.") { pg.tabFail.remove(tab); pg.version++; app.scope.launch { on.idsTab(pg, tab) } } }
                    else {
                        val set = ids.toSet()
                        postList(s.posts.filter { it.remote != null && it.remote in set }.sortedByDescending { it.t }, { if (tab == "reposts") Empty("repost", "No reposts yet.") else Empty("heart", "No likes yet.") })
                    }
                }
                else -> {
                    // what this person reposted sits in their posts too, at the time they reposted it
                    val items = mine.filter { it.parent == null }.map { Triple(it, it.t, if (it.pinned) 1 else 0) }.toMutableList()
                    val had = items.map { it.first.remote }.toSet()
                    val reposted = HashSet<String>()
                    pg.theirReposts.forEach { (pid, t) -> val p = byRem[pid]; if (p != null && p.parent == null && p.remote !in had && p.ra?.id != id) { items.add(Triple(p, t, 0)); reposted.add(p.id) } }
                    postList(items.sortedWith(compareByDescending<Triple<LPost, Long, Int>> { it.third }.thenByDescending { it.second }).map { it.first }, { Empty("smile", "No posts yet.") },
                        lab = { p -> if (p.id in reposted) name.ifEmpty { "They" } + " reposted" else null }, pin = true)
                }
            }
        }
    }
}

// zenV: his page is his real profile, the same one everybody sees
@Composable
fun ZenScreen() {
    val app = LocalApp.current
    app.zenVersion
    val id = app.on.zenId()
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        val r = Sb.get(Q("accounts").select("id").eq("username", "zenith"))
        val got = r.one?.optString("id")
        if (got == null) { if (id == null) failed = true; return@LaunchedEffect }
        if (got != id) { app.store.zen.put("id", got); app.persist(); app.zenVersion++ }
    }
    if (id != null) { UserScreen(id, fromMenu = app.stack.size == 1); return }
    Page({ Bar("Zenith", { MenuBtn() }) }) { if (failed) Sec("Could not load Zenith") else Loading() }
}

// settingsV
@Composable
fun SettingsScreen() {
    val app = LocalApp.current
    val s = app.store
    val on = app.on
    val ic: (String, Dp) -> @Composable () -> Unit = { n, sz -> { NIcon(n, sz, androidx.compose.material3.LocalContentColor.current) } }
    var totp by remember { mutableStateOf(totpOn?.let { if (it) "On" else "Off" } ?: "Checking...") }
    var key by remember { mutableStateOf<Pair<String, List<String>>?>(null) }
    var keyText by remember { mutableStateOf("Checking...") }
    var push by remember { mutableStateOf("Checking...") }
    var pk by remember { mutableStateOf<List<org.json.JSONObject>?>(null) }
    var pkText by remember { mutableStateOf(if (Passkey.ok()) "Checking..." else "Not available here") }
    var tick by remember { mutableIntStateOf(0) }
    val ctx = app.ctx
    LaunchedEffect(tick) {
        val r = Sb.fn("totp", org.json.JSONObject().put("action", "status"))
        totpOn = if (r.ok) r.body.optBoolean("enabled") else null
        totp = if (!r.ok) "Couldn't check" else if (totpOn == true) "On" else "Off"
    }
    LaunchedEffect(tick) {
        val k = on.keyState()
        key = k
        keyText = when { k == null -> "Couldn't check. Tap to retry"; k.first == "locked" -> "Locked. Tap to unlock"; k.first == "off" -> "Off"; "login" in k.second -> "On"; else -> "On, recovery password" }
    }
    LaunchedEffect(tick) {
        if (!Passkey.ok()) return@LaunchedEffect
        val r = on.passkeys()
        pk = r
        pkText = if (r == null) "Couldn't check" else if (r.isEmpty()) "Off" else "On for " + r.size + if (r.size == 1) " phone" else " phones"
    }
    LaunchedEffect(tick, app.foreground) {
        push = if (ctx == null) "Off" else if (!Notify.allowed(ctx) && Notify.on(ctx)) "Blocked in phone settings" else if (Notify.on(ctx) && Notify.allowed(ctx)) "On" else "Off"
    }
    Page({ Bar("Settings", { Lead() }) }) {
        Column(Modifier.verticalScroll(app.settingsScroll).padding(bottom = 24.dp)) {
            Sec("Appearance")
            Seg(listOf("System", "Dark", "Light"), s.theme.ordinal) { s.theme = ThemeMode.entries[it]; app.persist() }
            Sec("Account")
            Group {
                SRow({ MyAvatar(36.dp) }, "Edit profile", "@" + s.profile.handle) { app.panels.add(Panel.EditProfile) }
                SRow(ic("user", 22.dp), "Account info", "Made on, email, devices") { app.go(Route.AccountInfo) }
                SRow(ic("userswap", 22.dp), "Switch account", "Add or switch accounts") { on.openAccounts() }
                SRow(ic("usercut", 22.dp), "Sign out", "Log out from this device", last = true) { app.confirm("Sign out of @${s.profile.handle} on this phone?", "Sign out") { on.signOutNow() } }
            }
            Sec("Login")
            Group {
                SRow(ic("pass", 22.dp), "Change password", "Update your password") { app.panels.add(Panel.ChangePassword) }
                SRow(ic("mail", 22.dp), "Change email", "Update your email") { app.panels.add(Panel.ChangeEmail) }
                SRow(ic("lock", 22.dp), "Fingerprint", pkText) {
                    val rows = pk
                    when {
                        !Passkey.ok() -> app.say("This phone cannot do that")
                        rows == null -> { app.say("Checking, try again in a moment"); tick++ }
                        else -> app.open(
                            (if (rows.isEmpty()) listOf(SheetItem("Add this phone") { app.scope.launch { if (on.passkeyAdd()) { app.say("Saved. You can sign in with it now"); tick++ } } }) else emptyList()) +
                                rows.map { k ->
                                    SheetItem(if (rows.size > 1) "Remove " + k.optString("name").ifEmpty { "key" } else "Remove", "close", danger = true) {
                                        app.scope.launch { val r = Sb.delete(Q("passkeys").eq("id", k.optString("id"))); app.say(if (r.ok) "Removed" else "Could not remove it"); if (r.ok) tick++ }
                                    }
                                } + SheetItem("Cancel", cancel = true), "Fingerprint")
                    }
                }
                SRow(ic("shield", 22.dp), "Authenticator app", totp) {
                    when (totpOn) {
                        null -> { app.say("Checking..."); tick++ }
                        true -> app.open(listOf(SheetItem("Turn off authenticator", "close", danger = true) { app.panels.add(Panel.TotpOff) }), "Authenticator is on")
                        false -> app.panels.add(Panel.TotpSetup)
                    }
                }
                SRow(ic("backup", 22.dp), "Message key backup", keyText, last = true) {
                    val k = key
                    when {
                        k == null -> { app.say("Checking..."); tick++ }
                        k.first == "locked" -> on.unlockSheet()
                        else -> {
                            val items = ArrayList<SheetItem>()
                            if ("recovery" in k.second) {
                                items.add(SheetItem("Change recovery password", "lock") { app.panels.add(Panel.BackupSetup(true)) })
                                items.add(SheetItem("Remove recovery password", "close", danger = true) {
                                    app.confirm("Remove the recovery password?", "Remove") { app.scope.launch { val r = Sb.delete(Q("key_backups").eq("user_id", on.uid ?: "").eq("mode", "recovery")); app.say(if (r.ok) "Recovery password removed" else "Could not remove it"); tick++ } }
                                })
                            } else items.add(SheetItem("Add a recovery password", "lock") { app.panels.add(Panel.BackupSetup(false)) })
                            if ("login" in k.second) items.add(SheetItem("Stop saving", "close", danger = true) {
                                app.confirm("Stop saving your message key? Signing in on a new phone will not open your messages by itself anymore.", "Stop saving") { app.scope.launch { on.stopSaving(); tick++ } }
                            }) else items.add(SheetItem("Start saving", "check") { app.panels.add(Panel.StartSaving) })
                            items.add(SheetItem("Cancel", cancel = true))
                            app.open(items, "Message key backup")
                        }
                    }
                }
            }
            Sec("Feed")
            Group { SRow(ic("list", 22.dp), "Languages I read", langText(s), last = true) { langSheet(app) } }
            Sec("Notifications")
            Group {
                SRow(ic("bell", 24.dp), "Phone notifications", push, last = true) {
                    val c = ctx ?: return@SRow
                    if (Notify.on(c) && Notify.allowed(c)) { Notify.setOn(c, false); app.say("Phone notifications are off"); tick++ }
                    else { app.askNotifs(); tick++ }
                }
            }
            Sec("Your account")
            Group {
                SRow(ic("close", 22.dp), "Blocked accounts", "People you blocked") { app.go(Route.Blocked) }
                SRow(ic("eyeoff", 22.dp), "Hidden chats", "Chats you hid") { app.go(Route.Hidden) }
                SRow(ic("moon", 22.dp), "Deactivate account", "Hidden until you sign back in", last = true) { app.panels.add(Panel.Deactivate) }
            }
            Sec("Your data")
            Group { SRow(ic("copy", 22.dp), "Download data", "Posts, notes and media", last = true) { app.backup() } }
            Sec("Updates")
            Group {
                SRow(ic("refresh", 22.dp), "Check for updates", if (app.updProgress != null) "Updating..." else "Version $APP_VERSION", last = true) { if (app.updProgress == null && !app.updBusy) app.checkUpdate(true) }
            }
            Sec("Legal")
            Group {
                SRow(ic("eyeoff", 22.dp), "Privacy Policy", "What we collect") { app.go(Route.Legal(false)) }
                SRow(ic("list", 22.dp), "Terms of Use", "The rules of Nook", last = true) { app.go(Route.Legal(true)) }
            }
            Sec("Danger zone")
            Group {
                SRow(ic("trash", 22.dp), "Delete account", "Deleted after 30 days", danger = true, last = true) { app.panels.add(Panel.DeleteAccount) }
            }
        }
    }
}

// authV: sign in and make an account
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
    var msg by remember { mutableStateOf(app.notice ?: "") }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { app.notice = null }
    val go = {
        msg = ""
        val e = email.trim(); val u = user.trim(); val n = name.trim()
        when {
            e.isEmpty() && pw.isEmpty() -> msg = "Enter your email and password"
            e.isEmpty() -> msg = "Enter your email"
            !EMAIL_RE.matches(e) -> msg = "That email does not look right. Check for typos"
            pw.isEmpty() -> msg = "Enter your password"
            up && n.isEmpty() -> msg = "Enter a display name"
            up && !agree -> msg = "Agree to the terms and privacy policy to continue"
            up && !Regex("^[A-Za-z0-9._]{1,15}$").matches(u) -> msg = "Username: letters, numbers, dots or underscores, max 15"
            up && pw.length < 8 -> msg = "Password needs at least 8 characters"
            up && pwBytes(pw) > 72 -> msg = "Password is too long (72 bytes at most)"
            busy -> {}
            else -> {
                busy = true
                app.scope.launch {
                    val r = if (up) app.on.signUp(n, u, e, pw) else app.on.signIn(e, pw)
                    if (r != null) msg = r
                    busy = false
                }
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
                Row(Modifier.tap { agree = !agree }) { T("I am 18+ and agree to the ", Fs.md, color = c.muted); Box(Modifier.tap { app.go(Route.Legal(true)) }) { T("Terms", Fs.md, FontWeight.SemiBold, c.lnk) }; T(" and ", Fs.md, color = c.muted); Box(Modifier.tap { app.go(Route.Legal(false)) }) { T("Privacy", Fs.md, FontWeight.SemiBold, c.lnk) } }
            }
            if (msg.isNotEmpty()) T(msg, Fs.md, color = c.muted, align = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            Pill(if (up) "Create account" else "Sign in", Btn.Pri, enabled = !busy, modifier = Modifier.fillMaxWidth()) { go() }
            if (!up && Passkey.ok()) {
                LaunchedEffect(Unit) { app.on.passkeyWarm() }
                Pill("Sign in with Fingerprint", Btn.Ghost, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                    msg = ""; busy = true
                    app.scope.launch { app.on.signInPasskey()?.let { msg = it }; busy = false }
                }
            }
            if (!up) Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { Box(Modifier.tap { app.panels.add(Panel.Recover(email.trim())) }.vpad(8.dp)) { T("Forgot password?", Fs.md, color = c.muted) } }
            Pill(if (up) "I already have an account" else "Make an account", Btn.Ghost, modifier = Modifier.fillMaxWidth()) { app.authUp = !up; msg = "" }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                Box(Modifier.tap { app.go(Route.Legal(true)) }) { T("Terms", Fs.md, color = c.muted) }; T(" · ", Fs.md, color = c.muted); Box(Modifier.tap { app.go(Route.Legal(false)) }) { T("Privacy", Fs.md, color = c.muted) }
            }
        }
    }
}

// bannedV
@Composable
fun BannedScreen() {
    val app = LocalApp.current
    val c = LocalNook.current
    // .empty p: at most 30 characters wide (max-width: 30ch, the width of thirty zeros), like Empty()
    val measurer = androidx.compose.ui.text.rememberTextMeasurer()
    val style = androidx.compose.material3.LocalTextStyle.current
    val ch = remember(style) { measurer.measure("0".repeat(30), style.copy(fontSize = Fs.base)).size.width }
    val maxW = with(androidx.compose.ui.platform.LocalDensity.current) { ch.toDp() }
    Column(Modifier.fillMaxSize().background(c.bg).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(top = (LocalConfigurationHeight() * 0.18f).dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        NIcon("lock", 56.dp, c.muted)
        T("You're banned", Fs.x3, FontWeight.Bold, align = TextAlign.Center)
        T("Your account was banned and removed. A backup of your data is kept for 30 days.", color = c.muted, align = TextAlign.Center, modifier = Modifier.widthIn(max = maxW))
        Pill("Download my data", Btn.Pri) { app.panels.add(Panel.BanDownload) }
        Pill("Use a different account", Btn.Ghost) {
            app.confirm("This clears Nook from this device. Download your data first if you want it.", "Use a different account") { app.store.wipe(); app.on.dropMyKeys(); app.banEmail = ""; app.root(Route.Auth) }
        }
    }
}

@Composable private fun LocalConfigurationHeight() = androidx.compose.ui.platform.LocalConfiguration.current.screenHeightDp

// ageV: asked of accounts the AI thinks belong to a child; the page does not say why
@Composable
fun AgeScreen() {
    val app = LocalApp.current
    val c = LocalNook.current
    var age by remember { mutableStateOf("") }
    var msg by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(c.bg).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(top = (LocalConfigurationHeight() * 0.14f).dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        T("One quick question", Fs.x3, FontWeight.Bold, align = TextAlign.Center)
        T("How old are you?", color = c.muted)
        Box(Modifier.widthIn(max = 320.dp).vpad(8.dp)) { Box(Modifier.padding(top = 6.dp)) { Field(age, { age = it.filter { ch -> ch.isDigit() }.take(3) }, "Your age") } }
        Pill("Continue", Btn.Pri, enabled = !busy) {
            val y = age.toIntOrNull()
            when {
                age.isEmpty() -> msg = "Type your age."
                y == null || y < 1 || y > 120 -> msg = "Type your real age, from 1 to 120."
                else -> { busy = true; msg = ""; app.scope.launch { app.on.answerAge(y)?.let { msg = it }; busy = false } }
            }
        }
        if (msg.isNotEmpty()) T(msg, Fs.md, color = c.muted, align = TextAlign.Center)
        Box(Modifier.tap { app.confirm("Sign out of this account?", "Sign out") { app.on.signOutNow() } }.vpad(8.dp)) { T("Sign out", Fs.base, color = c.fg) }
    }
}

// accountInfoV: the day the account was made, the email (a tap changes it) and the devices signed in to the account.
// The password is not shown: the server only keeps a scrambled copy of it that nobody can turn back into the password.
@Composable
fun AccountInfoScreen() {
    val app = LocalApp.current
    val ic: (String, Dp) -> @Composable () -> Unit = { n, sz -> { NIcon(n, sz, androidx.compose.material3.LocalContentColor.current) } }
    var created by remember { mutableStateOf<String?>(null) }
    var email by remember { mutableStateOf(Sb.user?.email ?: "") }
    var devs by remember { mutableStateOf<List<org.json.JSONObject>?>(null) }
    var tick by remember { mutableStateOf(0) }
    val mine = remember { app.ctx?.let { Dev.id(it) } ?: "" }
    // the email and the day come from the login server, so a changed email shows without signing in again
    LaunchedEffect(Unit) {
        val u = Sb.me()
        created = u?.optString("created_at")?.takeIf { it.isNotEmpty() }?.let { dayText(parseIso(it)) } ?: ""
        u?.optString("email")?.takeIf { it.isNotEmpty() }?.let { email = it }
    }
    LaunchedEffect(tick) {
        val r = Sb.get(Q("devices").select("id, device_id, name, platform, last_seen").eq("revoked", false).order("last_seen", false))
        devs = if (r.ok) r.rows else emptyList()
    }
    Page({ Bar("Account info", { BackBtn() }) }) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
            Sec("Account")
            Group {
                SRow(ic("user", 22.dp), "Account made", created ?: "Loading...") {}
                SRow(ic("mail", 22.dp), "Email", email, last = true) { app.panels.add(Panel.ChangeEmail) }
            }
            Sec("Devices")
            Group {
                val k = devs
                when {
                    k == null -> SRow(null, "Loading...", last = true) {}
                    k.isEmpty() -> SRow(null, "No devices yet", "This phone shows up the next time you open Nook", last = true) {}
                    else -> k.forEachIndexed { i, x ->
                        val here = x.optString("device_id") == mine
                        SRow(ic(if (here) "check" else "lock", 22.dp), x.optString("name").ifEmpty { "Unknown device" } + if (here) " (this phone)" else "", "Last used " + dayText(parseIso(x.optString("last_seen"))), last = i == k.size - 1) {
                            if (here) app.say("This is the phone you are using")
                            else app.open(listOf(
                                SheetItem("Log out of this device", "usercut", danger = true) {
                                    app.scope.launch {
                                        val r = Sb.update(Q("devices").eq("id", x.optString("id")), org.json.JSONObject().put("revoked", true))
                                        app.say(if (r.ok) "Logged out. It signs out the next time it opens Nook" else "Could not log it out. Try again")
                                        tick++
                                    }
                                },
                                SheetItem("Cancel", cancel = true)), x.optString("name"))
                        }
                    }
                }
            }
        }
    }
}

// a day with no clock time: 9 Nov 2026
fun dayText(ms: Long): String = java.text.SimpleDateFormat("d MMM yyyy", java.util.Locale.getDefault()).format(java.util.Date(ms))
