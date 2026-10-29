package io.github.nookwebapp.native_ui

import androidx.compose.animation.*
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// cubic-bezier(.2,.8,.2,1), the easing every slide in the web app uses
val Snappy = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)

@Composable
private fun Scrim(visible: Boolean, onTap: () -> Unit) {
    val c = LocalNook.current
    AnimatedVisibility(visible, enter = fadeIn(tween(160)), exit = fadeOut(tween(160))) {
        Box(Modifier.fillMaxSize().background(c.scrim).clickable(remember { MutableInteractionSource() }, null, onClick = onTap))
    }
}

// .sheet: slides up from the bottom, 8dp from the edges, with the grab handle, an optional title, the rows and Cancel.
// What a row does runs once the sheet has slid away, like in the web app (so a row that opens another sheet slides that one in).
@Composable
fun SheetHost(app: AppState) {
    val c = LocalNook.current
    val scope = rememberCoroutineScope()
    var shown by remember { mutableStateOf<SheetSpec?>(null) }
    if (app.sheet != null) shown = app.sheet
    val maxH = LocalConfiguration.current.screenHeightDp.dp * 0.52f
    Scrim(app.sheet != null) { app.closeSheet() }
    Box(Modifier.fillMaxSize().navigationBarsPadding(), contentAlignment = Alignment.BottomCenter) {
        AnimatedVisibility(app.sheet != null, enter = slideInVertically(tween(220, easing = Snappy)) { it }, exit = slideOutVertically(tween(160)) { it }) {
            val spec = shown ?: return@AnimatedVisibility
            var drag by remember(spec) { mutableFloatStateOf(0f) }
            val close: (() -> Unit) -> Unit = { then -> app.closeSheet(); scope.launch { delay(170); then() } }
            Column(
                Modifier.padding(8.dp).widthIn(max = 584.dp).fillMaxWidth().offset { IntOffset(0, drag.toInt()) }
                    .clip(RoundedCornerShape(Rad.sheet)).background(c.bg).border(1.dp, c.line, RoundedCornerShape(Rad.sheet))
                    .clickable(remember { MutableInteractionSource() }, null) {}
                    .padding(start = 10.dp, end = 10.dp, bottom = 10.dp),
            ) {
                // .grab: dragging it down more than 70dp closes the sheet
                Box(
                    Modifier.fillMaxWidth().pointerInput(spec) {
                        detectVerticalDragGestures(onDragEnd = { if (drag > 70.dp.toPx()) app.closeSheet() else drag = 0f }) { _, dy -> drag = (drag + dy).coerceAtLeast(0f) }
                    }.vpad(10.dp, 12.dp),
                    contentAlignment = Alignment.Center,
                ) { Box(Modifier.size(38.dp, 4.dp).clip(RoundedCornerShape(Rad.xs)).background(c.line)) }
                if (spec.title != null) T(spec.title, Fs.md, color = c.muted, align = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 12.dp))
                Column(Modifier.heightIn(max = maxH).verticalScroll(rememberScrollState())) {
                    spec.items.filter { !it.cancel }.forEach { i -> SheetRow(i) { if (i.keep) i.fn() else close(i.fn) } }
                }
                spec.items.filter { it.cancel }.forEach { i ->
                    Box(Modifier.fillMaxWidth().pressBg(RoundedCornerShape(Rad.m)) { close(i.fn) }.padding(15.dp), contentAlignment = Alignment.Center) {
                        T(i.label, Fs.lg, FontWeight.Bold)
                    }
                }
            }
        }
    }
}

// .si: an icon in the accent color and the label; without an icon the label is centered (.plain), or on the left (.left)
// with a check at the end while it is chosen (rows that keep the sheet open)
@Composable
private fun SheetRow(i: SheetItem, onClick: () -> Unit) {
    val c = LocalNook.current
    val col = if (i.danger) c.danger else c.fg
    val plain = i.icon == null && i.av == null && !i.left
    val shape = RoundedCornerShape(Rad.m)
    Row(
        Modifier.fillMaxWidth().pressBg(shape, on = i.on && !i.left, onClick = onClick)
            .padding(horizontal = if (i.left) 16.dp else 14.dp).vpad(if (plain) 15.dp else if (i.left) 14.dp else 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = if (plain) Arrangement.Center else Arrangement.spacedBy(14.dp),
    ) {
        if (i.av != null) Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) { AuthorAv(i.av, 32.dp) }
        else if (i.icon != null) Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) { NIcon(i.icon, 20.dp, if (i.danger) c.danger else c.accent) }
        T(i.label, Fs.lg, if (i.on) FontWeight.Bold else if (plain) FontWeight.SemiBold else FontWeight.Medium, col)
        if (i.trail != null) { Spacer(Modifier.weight(1f)); NIcon(i.trail, 18.dp, c.muted) }
        if (i.keep && i.on) { Spacer(Modifier.weight(1f)); NIcon("check", 18.dp, c.accent) }
    }
}

// .drawer: the menu that slides in from the left
@Composable
fun DrawerHost(app: AppState) {
    val c = LocalNook.current
    val pr = app.store.profile
    val scope = rememberCoroutineScope()
    val w = minOf(LocalConfiguration.current.screenWidthDp * 0.86f, 330f).dp
    Scrim(app.drawer) { app.drawer = false }
    AnimatedVisibility(app.drawer, enter = slideInHorizontally(tween(260, easing = Snappy)) { -it }, exit = slideOutHorizontally(tween(200)) { -it }) {
        Column(
            Modifier.fillMaxHeight().width(w).background(c.bg).lineRight(c.line).clickable(remember { MutableInteractionSource() }, null) {}
                .statusBarsPadding().navigationBarsPadding().padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 20.dp),
        ) {
            MyAvatar(56.dp)
            T(pr.name.ifEmpty { "@" + pr.handle }, Fs.x2, FontWeight.Bold, modifier = Modifier.padding(top = 12.dp))
            T("@" + pr.handle, color = c.muted)
            Spacer(Modifier.height(18.dp))
            // Zenith sits first for the owner
            if (zOn() && app.rootRoute != Route.Zen) Row(Modifier.fillMaxWidth().tap { app.drawer = false; scope.launch { delay(170); app.root(Route.Zen) } }.vpad(13.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                ZenAv(28.dp); T("Zenith", Fs.x2)
            }
            // the page that is already open is left out of the menu
            listOf(Triple("search", "Search", Route.Search), Triple("list", "Lists", Route.Lists), Triple("sliders", "Settings", Route.Settings))
                .filter { it.third != app.rootRoute }.forEach { (i, l, r) -> DrawerItem(app, i, l, r) }
        }
    }
}

// .dm: one row of the menu; the page that is open is bold
@Composable
private fun DrawerItem(app: AppState, icon: String, label: String, r: Route) {
    val c = LocalNook.current
    val scope = rememberCoroutineScope()
    val on = app.rootRoute == r && app.stack.size == 1
    Row(Modifier.fillMaxWidth().tap { app.drawer = false; scope.launch { delay(170); app.root(r) } }.vpad(13.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(18.dp)) {
        NIcon(icon, 28.dp, c.fg); T(label, Fs.x2, if (on) FontWeight.Bold else FontWeight.Normal)
    }
}

fun Modifier.lineRight(color: Color) = this.then(Modifier.drawBehind {
    val w = 1.dp.toPx(); drawRect(color, androidx.compose.ui.geometry.Offset(size.width - w, 0f), androidx.compose.ui.geometry.Size(w, size.height))
}.padding(end = 1.dp))

// #toast: a small note above the bottom bar for two seconds, or five with an action (Undo)
@Composable
fun ToastHost(app: AppState) {
    val c = LocalNook.current
    var shown by remember { mutableStateOf<Toast?>(null) }
    val t = app.toast
    if (t != null) shown = t
    LaunchedEffect(t) { if (t != null) { delay(if (t.label != null) 5000 else 1900); if (app.toast == t) app.toast = null } }
    Box(Modifier.fillMaxSize().navigationBarsPadding().padding(bottom = 72.dp), contentAlignment = Alignment.BottomCenter) {
        AnimatedVisibility(t != null, enter = fadeIn(tween(180)) + slideInVertically(tween(180)) { 8 }, exit = fadeOut(tween(180)) + slideOutVertically(tween(180)) { 8 }) {
            val s = shown ?: return@AnimatedVisibility
            Row(
                Modifier.widthIn(max = minOf(LocalConfiguration.current.screenWidthDp * 0.88f, 340f).dp)
                    .shadow(16.dp, RoundedCornerShape(Rad.m), ambientColor = Color(0x38000000), spotColor = Color(0x38000000))
                    .clip(RoundedCornerShape(Rad.m)).background(c.bg2).border(1.dp, c.line, RoundedCornerShape(Rad.m)).padding(horizontal = 14.dp, vertical = 9.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                T(s.msg, Fs.sm, FontWeight.Medium, lineHeight = (13 * 1.3).sp)
                if (s.label != null) Box(Modifier.tap { app.toast = null; s.fn?.invoke() }) { T(s.label, Fs.sm, FontWeight.Bold, c.accent) }
            }
        }
    }
}

// .ov panels slide up over everything (sheetUp .28s) and away again (sheetDown .22s); several can be open at once
@Composable
fun PanelHost(app: AppState) {
    val shown = remember { mutableStateListOf<Panel>() }
    // a field left focused under a new panel would keep its cursor handle floating over it
    val focus = androidx.compose.ui.platform.LocalFocusManager.current
    LaunchedEffect(app.panels.size) { focus.clearFocus() }
    app.panels.forEach { if (it !in shown) shown.add(it) }
    shown.toList().forEach { p ->
        key(p) {
            val vis = remember { MutableTransitionState(false) }
            vis.targetState = p in app.panels
            // a panel that has slid away is dropped (an early return inside key() trips the compiler, so this is an if)
            if (!vis.currentState && !vis.targetState && vis.isIdle) SideEffect { shown.remove(p) }
            else AnimatedVisibility(vis, enter = slideInVertically(tween(280, easing = Snappy)) { it }, exit = slideOutVertically(tween(220)) { it }) {
                val c = LocalNook.current
                Box(Modifier.fillMaxSize().background(c.bg).clickable(remember { MutableInteractionSource() }, null) {}.statusBarsPadding().navigationBarsPadding().imePadding()) {
                    when (p) {
                        is Panel.Compose -> ComposePanel(app, p)
                        Panel.EditProfile -> EditProfilePanel(app, p)
                        is Panel.ListForm -> ListFormPanel(app, p)
                        is Panel.RenameChat -> RenamePanel(app, p)
                        is Panel.Crop -> CropPanel(app, p)
                        Panel.AddAccount -> AddAccountPanel(app, p)
                        Panel.NewAccount -> NewAccountPanel(app, p)
                        is Panel.LinkedLogin -> LinkedLoginPanel(app, p)
                        Panel.NewPassword -> NewPasswordPanel(app, p)
                        is Panel.Recover -> RecoverPanel(app, p)
                        is Panel.RecoverCode -> RecoverCodePanel(app, p)
                        Panel.ChangePassword -> ChangePasswordPanel(app, p)
                        Panel.ChangeEmail -> ChangeEmailPanel(app, p)
                        Panel.TotpSetup -> TotpSetupPanel(app, p)
                        Panel.TotpOff -> TotpOffPanel(app, p)
                        Panel.WaitApproval -> WaitApprovalPanel(app, p)
                        is Panel.RestoreKeys -> RestoreKeysPanel(app, p)
                        is Panel.ApproveLink -> ApproveLinkPanel(app, p)
                        is Panel.BackupSetup -> BackupSetupPanel(app, p)
                        Panel.StartSaving -> StartSavingPanel(app, p)
                        is Panel.Nickname -> NicknamePanel(app, p)
                        Panel.DeleteAccount -> DeleteAccountPanel(app, p)
                        Panel.BanDownload -> BanDownloadPanel(app, p)
                        Panel.ZenEdit -> ZenEditPanel(app, p)
                    }
                }
            }
        }
    }
}

// modal() of app.js: the bar (Cancel, the title, and the main button when it sits at the top), the body, and either the
// main button under the fields (.mact) or a footer
@Composable
fun Modal(
    title: String, action: String, enabled: Boolean = true, top: Boolean = false, onCancel: () -> Unit, onAction: () -> Unit,
    foot: (@Composable () -> Unit)? = null, body: @Composable ColumnScope.() -> Unit,
) {
    val c = LocalNook.current
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().height(54.dp).lineBelow(c.line).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { Box(Modifier.tap(onClick = onCancel).vpad(8.dp)) { T("Cancel", Fs.base) } }
            T(title, Fs.xl, FontWeight.Bold, maxLines = 1, modifier = Modifier.widthIn(max = (LocalConfiguration.current.screenWidthDp * 0.62f).dp))
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) { if (top || foot != null) Pill(action, Btn.Pri, enabled = enabled, onClick = onAction) }
        }
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).vpad(12.dp)) {
            body()
            if (!top && foot == null) Pill(action, Btn.Pri, enabled = enabled, modifier = Modifier.padding(top = 20.dp).fillMaxWidth(), onClick = onAction)
        }
        foot?.invoke()
    }
}

// .fld: a small label over a field
@Composable
fun Fld(label: String, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().vpad(8.dp, 9.dp)) {
        T(label, Fs.sm, FontWeight.SemiBold, LocalNook.current.muted, lineHeight = 21.sp)
        Box(Modifier.padding(top = 6.dp)) { content() }
    }
}

@Composable
private fun ListFormPanel(app: AppState, p: Panel.ListForm) {
    var name by remember { mutableStateOf(p.list?.name ?: "") }
    var desc by remember { mutableStateOf(p.list?.desc ?: "") }
    Modal(if (p.list != null) "Edit list" else "New list", "Save", onCancel = { app.closePanel(p) }, onAction = {
        val nm = name.trim()
        if (nm.isEmpty()) app.say("Give the list a name")
        else {
            val l = p.list?.also { it.name = nm; it.desc = desc.trim() } ?: LList(uid(), nm, desc.trim(), emptyList()).also { app.store.lists.add(it) }
            app.persist(); app.closePanel(p); p.after?.invoke(l)
        }
    }) {
        Fld("Name") { Field(name, { name = it }, "Favorites") }
        Fld("Description") { Field(desc, { desc = it }, "What is this list for") }
    }
}

@Composable
private fun RenamePanel(app: AppState, p: Panel.RenameChat) {
    var name by remember { mutableStateOf(p.chat.name) }
    Modal("Rename chat", "Save", onCancel = { app.closePanel(p) }, onAction = {
        p.chat.name = name.trim().ifEmpty { p.chat.name }; app.persist(); app.closePanel(p)
    }) { Fld("Name") { Field(name, { name = it }, "") } }
}

// .lb: the photo viewer. Photos are swiped sideways (a quick flick is enough), a tap outside closes it, and the caption
// (the post's time) sits at the bottom
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun ViewerHost(app: AppState) {
    var shown by remember { mutableStateOf<Viewer?>(null) }
    if (app.viewer != null) shown = app.viewer
    AnimatedVisibility(app.viewer != null, enter = fadeIn(tween(200)), exit = fadeOut(tween(200))) {
        val v = shown ?: return@AnimatedVisibility
        val pager = androidx.compose.foundation.pager.rememberPagerState(v.index) { v.imgs.size }
        Box(Modifier.fillMaxSize().background(Color(0xF0000000)).clickable(remember { MutableInteractionSource() }, null) { app.viewer = null }) {
            androidx.compose.foundation.pager.HorizontalPager(pager, Modifier.fillMaxSize()) { i ->
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    val d = Photos.size(v.imgs[i])
                    Pic(v.imgs[i], Modifier.fillMaxWidth().then(if (d != null) Modifier.aspectRatio(d.first.toFloat() / d.second) else Modifier).clickable(remember { MutableInteractionSource() }, null) {}, want = 2048, scale = androidx.compose.ui.layout.ContentScale.Fit)
                }
            }
            Box(Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(12.dp).size(44.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.14f)).pressTap(CircleShape) { app.viewer = null }, contentAlignment = Alignment.Center) {
                NIcon("close", 22.dp, Color.White)
            }
            // a photo of one's own message can be deleted from the viewer
            val del = v.del
            if (del != null) Box(Modifier.align(Alignment.TopStart).statusBarsPadding().padding(12.dp).size(44.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.14f)).pressTap(CircleShape) {
                app.confirm("Delete this photo?", "Delete") { app.scope.launch { if (del(pager.currentPage)) app.viewer = null } }
            }, contentAlignment = Alignment.Center) { NIcon("trash", 22.dp, Color.White) }
            if (v.cap != null) T(v.cap, Fs.sm, color = Color.White.copy(alpha = 0.8f), align = TextAlign.Center, modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().navigationBarsPadding().padding(bottom = 18.dp))
        }
    }
}

// .pick: the small dark round photo button
@Composable
fun PickBtn(modifier: Modifier, icon: Dp = 18.dp, onClick: () -> Unit) {
    Box(modifier.size(32.dp).clip(CircleShape).background(Color(0xA6000000)).tap(CircleShape, onClick = onClick), contentAlignment = Alignment.Center) { NIcon("camera", icon, Color.White) }
}

// .sheet.warn: a notice that has to be read; the button may wait a few seconds before it can be pressed
@Composable
fun WarnHost(app: AppState) {
    val c = LocalNook.current
    val w = app.warns.firstOrNull()
    var shown by remember { mutableStateOf<Warn?>(null) }
    if (w != null) shown = w
    Scrim(w != null) {}
    Box(Modifier.fillMaxSize().navigationBarsPadding(), contentAlignment = Alignment.BottomCenter) {
        AnimatedVisibility(w != null, enter = slideInVertically(tween(220, easing = Snappy)) { it }, exit = slideOutVertically(tween(160)) { it }) {
            val x = shown ?: return@AnimatedVisibility
            var left by remember(x) { mutableIntStateOf(x.wait) }
            LaunchedEffect(x) { while (left > 0) { delay(1000); left-- } }
            Column(
                Modifier.padding(8.dp).widthIn(max = 584.dp).fillMaxWidth().clip(RoundedCornerShape(Rad.sheet)).background(c.bg).border(1.dp, c.line, RoundedCornerShape(Rad.sheet))
                    .clickable(remember { MutableInteractionSource() }, null) {}.padding(start = 18.dp, end = 18.dp, bottom = 18.dp),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(Modifier.fillMaxWidth().vpad(10.dp, 2.dp), contentAlignment = Alignment.Center) { Box(Modifier.size(38.dp, 4.dp).clip(RoundedCornerShape(Rad.xs)).background(c.line)) }
                T(x.title, Fs.x2, FontWeight.Bold, align = TextAlign.Center)
                T(x.body, Fs.md, color = c.muted, align = TextAlign.Center, lineHeight = (14 * 1.5).sp)
                if (x.mail != null) T(x.mail, Fs.md, FontWeight.Bold, align = TextAlign.Center)
                if (x.extra.isNotEmpty()) T(x.extra, Fs.md, color = c.muted, align = TextAlign.Center)
                Pill(if (left > 0) "I understand ($left)" else "I understand", Btn.Pri, enabled = left <= 0, modifier = Modifier.fillMaxWidth().padding(top = 6.dp)) { app.warns.remove(x); x.onDone() }
                if (x.mail != null) Pill("Change my email", Btn.Ghost, enabled = left <= 5, modifier = Modifier.fillMaxWidth()) { app.panels.add(Panel.ChangeEmail) }
            }
        }
    }
}

// postLockedSheet(): posting is paused after posts were taken down
@Composable
fun PostLockedHost(app: AppState) {
    LaunchedEffect(app.postLocked) {
        if (app.postLocked) {
            app.postLocked = false
            app.warns.add(Warn("Posting is paused", "Some of your posts were removed for breaking the rules. You can post again in " + lockText(app.on.lockLeft()) + ". More removed posts mean a longer pause and then a ban."))
        }
    }
}

// viewZPost(): a post of Zenith from a chat, opened big
@Composable
fun ZCardHost(app: AppState) {
    val z = app.zcard ?: return
    Box(Modifier.fillMaxSize().background(LocalNook.current.bg).statusBarsPadding().navigationBarsPadding()) {
        Modal("Post", "Close", top = true, onCancel = { app.zcard = null }, onAction = { app.zcard = null }) { ZCard(z, big = true) }
    }
}
