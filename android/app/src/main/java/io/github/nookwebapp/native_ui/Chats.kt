package io.github.nookwebapp.native_ui

import kotlinx.coroutines.flow.collectLatest
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.zIndex
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.LocalTextStyle
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

// chatV: the chats with people (the server's inbox, newest first, pinned ones on top) and then the chats on this phone
@Composable
fun ChatsScreen() {
    val app = LocalApp.current
    val s = app.store
    val on = app.on
    val dm = app.dm
    var inboxFailed by remember { mutableStateOf(false) }
    // the chats this phone remembers are in place before the first frame, so a page opened after a long break (the phone restored
    // a chat and the person went back) is not drawn empty and then filled in, which moved every row
    remember { if (dm.inbox == null && on.me != null) on.cachedInbox()?.let { dm.inbox = it }; true }
    LaunchedEffect(Unit) { if (dm.locked) on.promptUnlock() }
    LaunchedEffect(on.me) {
        if (on.me == null) { dm.inboxN = 0; return@LaunchedEffect }
        if (dm.inbox == null) on.cachedInbox()?.let { dm.inbox = it }
        on.loadDmMutes()
        var first = true; var lastJson = ""
        while (true) {
            try {
                val c = on.dmInbox()
                on.refreshBadge(false)
                JSONArray(c.map { it.json() }).let { a -> val t = a.toString(); if (t != lastJson) { lastJson = t; Cache.write("inbox:" + on.uid, a) } }
                dm.inbox = c; inboxFailed = false
                // the newest chats are downloaded in the background, so tapping one shows its messages right away
                if (first) c.take(3).forEach { cv -> app.scope.launch { runCatching { val k = "thread:" + on.uid + ":" + cv.other; if ((Cache.fresh(k, 60_000)) == null) Cache.write(k, JSONArray(on.dmThread(cv.other).takeLast(100))); on.sharedKey(cv.other) } } }
                first = false
            } catch (e: Exception) { if (dm.inbox == null) { dm.inbox = emptyList(); inboxFailed = true } }
            delay(if (dm.rtOk) 15_000 else 5000)
            while (!app.foreground) delay(1000)
        }
    }
    val convos = (dm.inbox ?: emptyList()).filter { it.other !in dm.hideSet }.sortedByDescending { if (it.other in s.dmPins) 1 else 0 }
    val local = s.chats.sortedByDescending { c -> c.msgs.lastOrNull()?.t ?: c.t }
    Page({ Bar("Chats", { Lead() }) }, fab = { Fab("plus") { app.newChat() } }) {
        LazyColumn(Modifier.fillMaxSize(), state = app.listStateFor(LocalPage.current), contentPadding = PaddingValues(bottom = 88.dp)) {
            // rows of the same shape as the chats shimmer until the real ones are drawn, so the page never looks empty
            if (dm.inbox == null && on.me != null) items((Cache.read("inbox-n")?.v as? Int ?: 1).coerceIn(1, 6)) { SkelRow() }
            items(convos, key = { "d" + it.other }) { cv -> ConvoRow(cv) }
            if ((dm.inbox != null || on.me == null) && convos.isEmpty() && s.chats.isEmpty() && inboxFailed) item { Empty("smile", "Could not load your chats. Pull to try again, or check the connection.") }
            else if ((dm.inbox != null || on.me == null) && convos.isEmpty() && s.chats.isEmpty()) item { Empty("smile", "Say hi to yourself.") { Pill("New chat") { app.newChat() } } }
            items(local, key = { it.id }) { ch ->
                val last = ch.msgs.lastOrNull()
                LRow({ MyAvatar(48.dp) }, ch.name, if (last == null) "No messages yet" else last.text.ifEmpty { if (last.rpost != null || last.zpost != null) "Shared a post" else "Sent a photo" }, last?.let { ago(it.t) }) { app.go(Route.Conv(ch.id)) }
            }
        }
    }
    LaunchedEffect(convos.size) { if (dm.inbox != null) Cache.write("inbox-n", convos.size) }
}

// .skelrow: a chat row that shimmers while the chats load
@Composable
private fun SkelRow() {
    val c = LocalNook.current
    Row(Modifier.fillMaxWidth().lineBelow(c.line).padding(horizontal = 16.dp).vpad(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Modifier.size(48.dp).clip(CircleShape).background(c.bg2).shimmer())
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.fillMaxWidth(0.45f).height(14.dp).clip(RoundedCornerShape(Rad.s)).background(c.bg2).shimmer())
            Box(Modifier.fillMaxWidth(0.75f).height(12.dp).clip(RoundedCornerShape(Rad.s)).background(c.bg2).shimmer())
        }
    }
}

// dmRow(): the person, what the last message says (opened a moment later), when, and the unread number
@Composable
private fun ConvoRow(cv: Convo) {
    val app = LocalApp.current
    val c = LocalNook.current
    val on = app.on
    on.nickVersion
    val last = cv.last
    val mine = last?.optString("sender_id") == on.uid
    var gist by remember(cv.other, last?.opt("id")) { mutableStateOf(if (last == null) "No messages" else dmGist("", last.optJSONArray("media"), mine)) }
    LaunchedEffect(cv.other, last?.opt("id")) {
        if (last != null) gist = dmGist(zUn(on.openText(cv.other, last.optString("body"), true)), last.optJSONArray("media") ?: runCatching { JSONArray(last.optString("media")) }.getOrNull(), mine)
    }
    // only this person's own typing flag is read, so another person typing does not redraw this row
    val typing = app.dm.typingFlag[cv.other] == true
    val name = on.nickOf(cv.other).ifEmpty { cv.name }
    Row(
        Modifier.fillMaxWidth().lineBelow(c.line).tap { on.openDm(cv.other) }.padding(horizontal = 16.dp).vpad(14.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        RAv(cv.name, "", cv.avatar, 48.dp, cv.other)
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                T(name, weight = FontWeight.Bold, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                if (cv.other in app.store.dmPins) NIcon("pin", 13.dp, c.fg, modifier = Modifier.padding(start = 6.dp).alpha(0.6f))
            }
            T(if (typing) "typing..." else gist, Fs.md, color = if (typing) c.fg else c.muted, maxLines = 1)
        }
        if (last != null) T(ago(parseIso(last.optString("created_at"))), Fs.sm, color = c.muted, modifier = Modifier.align(Alignment.Top).padding(top = 2.dp))
        if (cv.unread > 0 && !on.dmMuted(cv.other)) Badge(cv.unread)
    }
}

// dmV: a chat with a person. Messages are opened on this phone; the dock is off while messaging is not possible
@Composable
fun DmScreen(id: String) {
    val app = LocalApp.current
    val c = LocalNook.current
    val on = app.on
    val l = remember(id) { on.openLive(id) }
    DisposableEffect(id) { onDispose { on.closeLive(l) } }
    on.nickVersion
    var acct by remember(id) { mutableStateOf(on.acctCache[id]) }
    LaunchedEffect(id) { acct = on.acctsFor(listOf(id))[id]; on.loadSocial(); acct = on.acctCache[id] }
    val name = on.nickOf(id).ifEmpty { acct?.optString("name") ?: "user" }
    var open by remember { mutableStateOf<DmMsg?>(null) }
    val list = rememberLazyListState()
    // the chat stays at its newest message while new ones come in
    // a new message (or the typing dots) takes the view to the bottom; deleting a message leaves the view where it is
    // somebody else's new message or typing never pulls the view down while it is scrolled up; what I send always does
    val atBottom by rememberAtBottom(list)
    var seenRows by remember(id) { mutableIntStateOf(l.rows.size) }
    var unread by remember(id) { mutableIntStateOf(0) }
    LaunchedEffect(atBottom) { if (atBottom) unread = 0 }
    LaunchedEffect(l.rows.size, l.typing) {
        val grew = l.rows.size > seenRows
        val added = l.rows.size - seenRows
        seenRows = l.rows.size
        val mine = l.rows.lastOrNull()?.let { it.sender == app.on.uid && !it.ai } == true
        if (grew && !mine && !atBottom) unread += added
        if (l.rows.isEmpty()) return@LaunchedEffect
        if (grew && mine) { list.scrollToItem(l.rows.size + 1); list.pinBottom() }
        else if (atBottom) { if (grew || l.typing) list.scrollToItem(l.rows.size + 1); list.pinBottom() }
    }
    KeepAtBottom(list)
    Page({
        // .bar.chb: back, the person's picture, name and handle, and the chat's options
        Row(Modifier.fillMaxWidth().height(54.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(44.dp).offset(x = (-10).dp)) { IB("back") { app.pop() } }
            Row(Modifier.weight(1f).padding(start = 4.dp).tap { app.go(Route.User(id)) }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                RAv(acct?.optString("name") ?: "?", acct?.optString("username") ?: "", acct?.optStr("avatar"), 36.dp, id)
                Column {
                    T(name, Fs.lg, FontWeight.Bold, maxLines = 1, lineHeight = (16 * 1.2).sp)
                    T("@" + (acct?.optString("username") ?: "user"), Fs.sm, color = c.muted, maxLines = 1, lineHeight = (13 * 1.2).sp)
                }
            }
            Box(Modifier.width(44.dp)) { IB("dots") { on.dmMenu(id, acct?.optString("name") ?: "user", true) } }
        }
    }) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
        ToBottomButton(list, unread, Modifier.align(Alignment.BottomEnd).padding(end = 10.dp).zIndex(2f))
        LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), state = list, verticalArrangement = Arrangement.Bottom, contentPadding = PaddingValues(top = 14.dp, bottom = 8.dp)) {
            if (!l.loaded && l.rows.isEmpty()) item { Loading() }
            else if (l.failed && l.rows.isEmpty()) item { Empty(null, "Could not load messages. Trying again...") }
            else if (l.rows.isEmpty()) item { Empty("chat", "No messages yet. Say hi.", iconSize = 48.dp) }
            items(l.rows, key = { it.id?.toString() ?: ("t" + System.identityHashCode(it)) }) { m ->
                // one of Zenith's messages pulled to the right starts an answer to him (the owner's chats only)
                val mineM = m.sender == on.uid && !m.ai
                val anim = remember(m) { (if (!m.fresh) MsgAnim.None else if (!mineM) MsgAnim.In else if (m.tmp) MsgAnim.Send else MsgAnim.Land).also { m.fresh = false } }
                FoldAway(m.leaving) { Box(Modifier.padding(bottom = 6.dp).msgIn(anim, mineM)) { SwipeReply(m.ai && zOn(), { l.fill?.invoke("@zenith ") }) { DmBubble(m, id, open === m, onTap = { open = if (open === m) null else m }) {
                    val body = m.text ?: m.body
                    app.open(listOfNotNull(
                        if (body.isNotEmpty()) SheetItem("Copy message", "copy") { app.clipboard(body) } else null,
                        if (m.sender == on.uid && m.id != null) SheetItem("Delete message", "trash", danger = true) { app.confirm("Delete this message?", "Delete") { on.deleteDm(m, id) } } else null,
                    ).ifEmpty { return@DmBubble })
                } } } }
            }
            // .trow: the typing dots, in a slot that grows smoothly
            item(key = "typing") {
                androidx.compose.animation.AnimatedVisibility(visible = l.typing, enter = expandVertically(tween(300, easing = TROW_EASE)) + fadeIn(tween(250, easing = CSS_EASE)), exit = shrinkVertically(tween(300, easing = TROW_EASE)) + fadeOut(tween(250, easing = CSS_EASE))) {
                    Box(Modifier.fillMaxWidth().padding(bottom = 6.dp)) { TypingBubble(Modifier.align(Alignment.CenterStart)) }
                }
            }
        }
        }
        DmDock(id, l)
    }
}

// .cdock of a chat with a person. The typed text lives here, so a keystroke redraws the dock and not the messages.
@Composable
private fun DmDock(id: String, l: LiveDm) {
    val app = LocalApp.current
    val c = LocalNook.current
    val on = app.on
    var tv by remember(id) { mutableStateOf(TextFieldValue("")) }
    val text = tv.text
    fun setText(t: String) { tv = TextFieldValue(t, TextRange(t.length)) }
    val focus = remember { FocusRequester() }
    val pend = remember(id) { mutableStateListOf<String>() }
    var busy by remember { mutableStateOf(false) }
    val picker = rememberPicker(4 - pend.size) { got -> val room = 4 - pend.size; pend.addAll(got.take(room)); if (got.size > room) app.say("Only 4 allowed, extra ones skipped") }
    l.fill = { pre -> if (l.locked.isEmpty()) { if (!text.startsWith(pre.trim(), true)) setText(pre + text); runCatching { focus.requestFocus() } } }
    // .cdock: the note when messaging is off, the pending photos, and the text box with its photo and send buttons
    Column(Modifier.fillMaxWidth().background(c.bg).lineAbove(c.line).navigationBarsPadding().padding(bottom = 10.dp)) {
        ZenPopHost(zOn() && zenHint(text)) { setText(text.replace(ZEN_AT, "@zenith ")) }
        if (l.locked.isNotEmpty()) T(l.locked, Fs.sm, color = c.muted, align = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 8.dp))
        if (pend.isNotEmpty()) PendStrip(pend)
        val off = l.locked.isNotEmpty()
        Row(Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp).alpha(if (off) 0.4f else 1f), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            IB("image", tint = c.accent, box = 40.dp, height = 42.dp, enabled = !off && pend.size < 4) { picker.gallery() }
            BasicTextField(
                tv, { v -> val changed = v.text != tv.text; tv = v; if (changed) on.sendTyping(id, v.text.isNotBlank()) },
                Modifier.weight(1f).focusRequester(focus).heightIn(min = 42.dp, max = 140.dp).clip(RoundedCornerShape(Rad.bubble)).background(if (off) c.line else c.bg2).padding(horizontal = 14.dp, vertical = 10.dp),
                enabled = !off, textStyle = LocalTextStyle.current.copy(color = c.fg, fontSize = Fs.lg, lineHeight = (16 * 1.35).sp), cursorBrush = SolidColor(c.accent),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                decorationBox = { inner -> Box { if (text.isEmpty()) T(if (off) "Messaging is off" else "Message", Fs.lg, color = c.muted, lineHeight = (16 * 1.35).sp); inner() } },
            )
            val can = !busy && !off && (text.isNotBlank() || pend.isNotEmpty())
            Box(Modifier.size(42.dp).alpha(if (can) 1f else 0.45f).clip(CircleShape).background(c.fill).pressTap(CircleShape, enabled = can) {
                // "/claude" is sent like any message, and starts the mascots here at once (one every 30 seconds)
                if (pend.isEmpty() && ClaudeFx.handle(app, text, send = true) == 2) return@pressTap
                val t = cleanText(text.trim()); val srcs = pend.toList()
                busy = true; setText(""); pend.clear()
                // the app's own scope and the keep-alive: leaving the chat or the app never cancels a message on its way
                app.scope.launch {
                    if (!Keep.around(app.ctx) { on.doSendDm(l, t, srcs) }) { setText(if (text.isNotBlank()) t + "\n" + tv.text else t); pend.addAll(srcs) }
                    busy = false
                }
            }, contentAlignment = Alignment.Center) { NIcon("send", 20.dp, c.on) }
        }
    }
}

// true while the view sits at the newest message. It is not changed in the same moment the list changes size, so a new message
// that lands does not make a reader at the bottom look like somebody who scrolled up
@Composable
fun rememberAtBottom(list: androidx.compose.foundation.lazy.LazyListState): State<Boolean> {
    val at = remember { mutableStateOf(true) }
    LaunchedEffect(list) {
        var lastCount = -1
        snapshotFlow { Triple(list.layoutInfo.totalItemsCount, list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1, !list.canScrollForward) }
            .collect { (n, last, end) -> if (n == lastCount) at.value = end || last >= n - 1; lastCount = n }
    }
    return at
}

// keeps the view on the newest message while the new one (or the typing row, or a message folding away) changes its height,
// so the chat moves once, smoothly, and not "to the place, stop, a little more"
suspend fun androidx.compose.foundation.lazy.LazyListState.pinBottom(ms: Long = 380) {
    val end = System.nanoTime() + ms * 1_000_000
    while (System.nanoTime() < end) {
        androidx.compose.runtime.withFrameNanos { }
        if (canScrollForward) scrollBy(1_000_000f)
    }
}

// the round button at the bottom right of a chat that has been scrolled away from its newest message: it shows a moment after
// the view moved well away (a short scroll up does nothing), takes the view back down, and carries a count of the messages that
// came in meanwhile
@Composable
fun ToBottomButton(list: androidx.compose.foundation.lazy.LazyListState, unread: Int, modifier: Modifier = Modifier) {
    val c = LocalNook.current
    val scope = rememberCoroutineScope()
    val density = androidx.compose.ui.platform.LocalDensity.current
    val far by remember(list) {
        derivedStateOf {
            val li = list.layoutInfo
            val last = li.visibleItemsInfo.lastOrNull()
            list.canScrollForward && last != null &&
                (li.totalItemsCount - 1 - last.index >= 2 || (last.offset + last.size - li.viewportEndOffset) > with(density) { 220.dp.toPx() })
        }
    }
    var show by remember { mutableStateOf(false) }
    LaunchedEffect(list) { snapshotFlow { far }.collectLatest { f -> if (f) { kotlinx.coroutines.delay(400); show = true } else show = false } }
    androidx.compose.animation.AnimatedVisibility(show, modifier = modifier, enter = fadeIn(tween(160)) + androidx.compose.animation.scaleIn(tween(160), 0.8f), exit = fadeOut(tween(140)) + androidx.compose.animation.scaleOut(tween(140), 0.8f)) {
        Box(Modifier.padding(end = 6.dp, bottom = 10.dp)) {
            Box(
                Modifier.size(44.dp).shadow(14.dp, CircleShape, ambientColor = Color(0x38000000), spotColor = Color(0x38000000)).clip(CircleShape).background(c.bg2).border(1.dp, c.line, CircleShape)
                    .pressTap(CircleShape) {
                        scope.launch {
                            val n = list.layoutInfo.totalItemsCount
                            if (n - 1 - list.firstVisibleItemIndex > 8) list.scrollToItem(maxOf(0, n - 6))
                            list.animateScrollToItem(maxOf(0, n - 1))
                            list.pinBottom(250)
                        }
                    },
                contentAlignment = Alignment.Center,
            ) { NIcon("back", 22.dp, c.fg, modifier = Modifier.rotate(-90f)) }
            if (unread > 0) Box(
                Modifier.align(Alignment.BottomEnd).offset(x = 6.dp, y = 6.dp).defaultMinSize(minWidth = 22.dp, minHeight = 22.dp).clip(CircleShape).background(c.accent).padding(horizontal = 6.dp),
                contentAlignment = Alignment.Center,
            ) { T(if (unread > 99) "99+" else unread.toString(), Fs.xs, FontWeight.Bold, c.on) }
        }
    }
}

// the end of what is typed, when it is an @ with some letters
val ZEN_AT = Regex("@\\w*$")
// the hint only shows while the word is still being typed: not when "@zenith" is already written in full
fun zenHint(text: String) = ZEN_AT.find(text)?.value?.equals("@zenith", true) == false

// .zpop: typing @ offers Zenith (the owner's chats only)
@Composable
fun ZenPop(onPick: () -> Unit) {
    val c = LocalNook.current
    Box(Modifier.padding(start = 16.dp)) {
        Row(Modifier.clip(RoundedCornerShape(Rad.m)).background(c.bg2).border(1.dp, c.line, RoundedCornerShape(Rad.m)).tap(onClick = onPick).padding(start = 8.dp, end = 14.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ZenAv(34.dp); T("Zenith AI", weight = FontWeight.Bold)
        }
    }
}

// .zpop sits above the dock, over the messages, and fades and scales in from its lower left corner
private class AboveDock(val gap: Int) : androidx.compose.ui.window.PopupPositionProvider {
    override fun calculatePosition(anchorBounds: androidx.compose.ui.unit.IntRect, windowSize: androidx.compose.ui.unit.IntSize, layoutDirection: androidx.compose.ui.unit.LayoutDirection, popupContentSize: androidx.compose.ui.unit.IntSize) =
        androidx.compose.ui.unit.IntOffset(anchorBounds.left, anchorBounds.top - popupContentSize.height - gap)
}
@Composable
fun ZenPopHost(show: Boolean, onPick: () -> Unit) {
    val vis = remember { androidx.compose.animation.core.MutableTransitionState(false) }
    vis.targetState = show
    if (!vis.currentState && !vis.targetState) return
    val gap = with(androidx.compose.ui.platform.LocalDensity.current) { 6.dp.roundToPx() }
    androidx.compose.ui.window.Popup(AboveDock(gap), properties = androidx.compose.ui.window.PopupProperties(focusable = false, clippingEnabled = false)) {
        AnimatedVisibility(vis, enter = fadeIn(tween(180)) + androidx.compose.animation.scaleIn(tween(180), transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0f, 1f)), exit = fadeOut(tween(120))) { ZenPop(onPick) }
    }
}

// .cpend: the photos picked for a message, each with a remove button
@Composable
fun PendStrip(pend: MutableList<String>) {
    Row(Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        pend.forEachIndexed { i, src ->
            Box(Modifier.size(64.dp).clip(RoundedCornerShape(Rad.s))) {
                Pic(src, Modifier.fillMaxSize(), want = 200)
                Box(Modifier.align(Alignment.TopEnd).padding(3.dp).size(22.dp).clip(CircleShape).background(Color(0xA6000000)).tap(CircleShape) { pend.removeAt(i) }, contentAlignment = Alignment.Center) { NIcon("close", 14.dp, Color.White) }
            }
        }
    }
}

// the easings of the style sheet: .trow grows with cubic-bezier(.2,.8,.2,1), opacity uses "ease", the dots "ease-in-out"
val TROW_EASE = androidx.compose.animation.core.CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)
val CSS_EASE = androidx.compose.animation.core.CubicBezierEasing(0.25f, 0.1f, 0.25f, 1f)
private val EASE_IN_OUT = androidx.compose.animation.core.CubicBezierEasing(0.42f, 0f, 0.58f, 1f)

// .bub.typing: three dots that bob
@Composable
fun TypingBubble(modifier: Modifier = Modifier) {
    val c = LocalNook.current
    val tr = rememberInfiniteTransition(label = "dots")
    Row(modifier.clip(RoundedCornerShape(Rad.bubble, Rad.bubble, Rad.bubble, Rad.xs)).background(c.bg2).border(1.dp, c.line, RoundedCornerShape(Rad.bubble, Rad.bubble, Rad.bubble, Rad.xs)).padding(horizontal = 16.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        repeat(3) { i ->
            val y by tr.animateFloat(0f, 1f, infiniteRepeatable(tween(1000, easing = androidx.compose.animation.core.LinearEasing), RepeatMode.Restart, initialStartOffset = androidx.compose.animation.core.StartOffset(i * 150)), label = "d$i")
            // zdot: each dot lifts 4dp during the first 30 percent of the second, then rests
            // the keyframes (0, 30, 60, 100 percent) each ease in and out, as the style sheet's animation does
            val k = if (y < 0.3f) EASE_IN_OUT.transform(y / 0.3f) else if (y < 0.6f) 1f - EASE_IN_OUT.transform((y - 0.3f) / 0.3f) else 0f
            Box(Modifier.offset(y = (-4 * k).dp).size(7.dp).alpha(0.35f + 0.65f * k).clip(CircleShape).background(c.muted))
        }
    }
}

// style.css .bub:active and tapPop: a bubble sinks to 97 percent while it is held, and pops (95, 102, 100 percent over
// 340 ms) when a tap opens its time
class BubbleFx(private val scope: kotlinx.coroutines.CoroutineScope) {
    private val pop = androidx.compose.animation.core.Animatable(1f)
    private val hold = androidx.compose.animation.core.Animatable(1f)
    val scale get() = pop.value * hold.value
    fun press(down: Boolean) { scope.launch { hold.animateTo(if (down) 0.97f else 1f, tween(120)) } }
    fun pop() { scope.launch { pop.snapTo(0.95f); pop.animateTo(1f, androidx.compose.animation.core.keyframes { durationMillis = 340; 1.02f at 204 }) } }
}
@Composable
fun rememberBubbleFx(): BubbleFx { val scope = rememberCoroutineScope(); return remember { BubbleFx(scope) } }
// the press is only watched (nothing is consumed), so the text inside still gets its own taps
fun Modifier.bubbleFx(fx: BubbleFx, left: Boolean): Modifier = this
    .graphicsLayer { transformOrigin = androidx.compose.ui.graphics.TransformOrigin(if (left) 0f else 1f, 1f); scaleX = fx.scale; scaleY = fx.scale }
    .pointerInput(fx) {
        awaitEachGesture {
            awaitFirstDown(requireUnconsumed = false, pass = androidx.compose.ui.input.pointer.PointerEventPass.Initial)
            fx.press(true)
            waitForUpOrCancellation(androidx.compose.ui.input.pointer.PointerEventPass.Initial)
            fx.press(false)
        }
    }

// dmBubble(): photos, a shared post, a link card, the text, and the time under it while it is open
@Composable
fun DmBubble(m: DmMsg, other: String, open: Boolean, onTap: () -> Unit, onLong: () -> Unit) {
    val app = LocalApp.current
    val c = LocalNook.current
    val mine = m.sender == app.on.uid && !m.ai
    val left = !mine
    val w = LocalConfiguration.current.screenWidthDp.dp - 32.dp
    val body = m.text ?: ""
    val fx = rememberBubbleFx()
    val opened by rememberUpdatedState(open)
    val tap = { if (!opened) fx.pop(); onTap() }
    val url = remember(body) { firstUrl(body) }
    Column(Modifier.fillMaxWidth().alpha(if (m.tmp && mine) 0.7f else 1f).pointerInput(m) { detectTapGestures(onTap = { tap() }, onLongPress = { AppState.current?.buzz(); onLong() }) }, horizontalAlignment = if (left) Alignment.Start else Alignment.End) {
        val media = (0 until m.media.length()).mapNotNull { m.media.optJSONObject(it) }
        media.forEachIndexed { i, md -> DmMedia(md, other, m, i, Modifier.padding(top = if (i > 0) 4.dp else 0.dp)) }
        m.rpost?.let { Box(Modifier.padding(top = if (media.isNotEmpty()) 4.dp else 0.dp)) { RCard(it.id, it.u) } }
        m.zpost?.let { Box(Modifier.padding(top = 4.dp)) { ZCard(it) } }
        url?.let { Box(Modifier.padding(top = if (media.isNotEmpty() || m.rpost != null) 4.dp else 0.dp)) { LinkCard(it, chat = true) } }
        // Zenith's answer is still being written: the dots show, like .bub.typing of the web app
        if (m.ai && m.tmp && body.isEmpty()) TypingBubble()
        else if (body.isNotEmpty()) {
            val shape = if (left) RoundedCornerShape(Rad.bubble, Rad.bubble, Rad.bubble, Rad.xs) else RoundedCornerShape(Rad.bubble, Rad.bubble, Rad.xs, Rad.bubble)
            Box(Modifier.padding(top = if (media.isNotEmpty() || m.rpost != null || url != null) 4.dp else 0.dp).bubbleFx(fx, left).widthIn(max = w * 0.82f).clip(shape)
                .background(if (left) c.bg2 else c.accent).then(if (left) Modifier.border(1.dp, c.line, shape) else Modifier).padding(horizontal = 14.dp, vertical = 9.dp)) {
                Tx(if (m.ai) "zenith $body" else body, color = if (left) c.fg else c.on, linkColor = if (left) null else Color.White, onTap = tap, onLong = onLong, cut = false)
            }
        }
        AnimatedVisibility(open, enter = expandVertically(tween(240)) + fadeIn(tween(200)), exit = shrinkVertically(tween(240)) + fadeOut(tween(200))) {
            // .mmi span is a block: the note sits under the time
            Column(Modifier.fillMaxWidth().padding(top = 4.dp, start = 2.dp, end = 2.dp), horizontalAlignment = if (left) Alignment.Start else Alignment.End) {
                T(whenText(m.t), Fs.xs, color = c.muted)
                if (m.plain) T("Not encrypted", Fs.xs, color = Color(0xFFC0392B), modifier = Modifier.padding(top = 4.dp))
            }
        }
    }
}

// dmMedia(): a sealed photo, opened on this phone; until it is in, a frame of the same size holds its place
@Composable
private fun DmMedia(md: JSONObject, other: String, m: DmMsg, i: Int, modifier: Modifier) {
    val app = LocalApp.current
    val c = LocalNook.current
    val conf = LocalConfiguration.current
    // a local file path is only believed on my own photo that is still on its way
    val ownLocal = m.tmp && m.sender == app.on.uid
    val local = md.optString("url").takeIf { it.startsWith("/") && ownLocal }
    var path by remember(md.optString("url")) { mutableStateOf(local) }
    var gone by remember(md.optString("url")) { mutableStateOf(false) }
    LaunchedEffect(md.optString("url")) {
        if (path == null) {
            if (md.optString("type").startsWith("video/")) { gone = true; return@LaunchedEffect }
            path = runCatching { app.on.encMedia(md) { app.on.sharedKeyFast(other) } }.getOrNull()
            if (path == null) gone = true
        }
    }
    if (gone) { Box(modifier.clip(RoundedCornerShape(Rad.m)).background(c.bg2).border(1.dp, c.line, RoundedCornerShape(Rad.m)).padding(horizontal = 16.dp, vertical = 14.dp)) { T(if (md.optString("type").startsWith("video/")) "Videos are not supported" else "Photo not available", Fs.md, color = c.muted) }; return }
    val dims = path?.let { Photos.size(it) } ?: if (md.optInt("w") > 0) md.optInt("w") to md.optInt("h") else null
    val ar = dims?.let { it.first.toFloat() / it.second }
    val maxW = minOf(conf.screenWidthDp * 0.72f, 360f).let { if (ar != null) minOf(it, conf.screenHeightDp * 0.56f * ar) else it }.dp
    Box(modifier.width(maxW).then(if (ar != null) Modifier.aspectRatio(ar) else Modifier.heightIn(min = 140.dp)).clip(RoundedCornerShape(Rad.m)).background(c.bg2).then(if (path == null) Modifier.shimmer() else Modifier)) {
        val p = path
        if (p != null) Pic(p, Modifier.matchParentSize().tap {
            app.scope.launch {
                val all = (0 until m.media.length()).mapNotNull { k -> m.media.optJSONObject(k) }.mapNotNull { x -> x.optString("url").takeIf { it.startsWith("/") && ownLocal } ?: runCatching { app.on.encMedia(x) { app.on.sharedKeyFast(other) } }.getOrNull() }
                val mine = m.sender == app.on.uid && m.id != null
                app.viewer = Viewer(all, all.indexOf(p).coerceAtLeast(0), del = if (mine) ({ k -> app.on.deleteDmMedia(m, k, other) }) else null)
            }
        }, want = 1080, scale = androidx.compose.ui.layout.ContentScale.Fit)
    }
}

// swipeReply() of app.js: a message pulled more than 50dp to the right (and not much up or down) calls onSwipe. Nothing
// moves on the screen, like in the web app; the phone ticks once when it counts.
@Composable
fun SwipeReply(on: Boolean, onSwipe: () -> Unit, content: @Composable () -> Unit) {
    if (!on) { content(); return }
    val haptic = androidx.compose.ui.platform.LocalHapticFeedback.current
    val limit = with(androidx.compose.ui.platform.LocalDensity.current) { 50.dp.toPx() }
    val swipe by rememberUpdatedState(onSwipe)
    Box(Modifier.fillMaxWidth().pointerInput(Unit) {
        var dx = 0f
        detectHorizontalDragGestures(onDragStart = { dx = 0f }, onDragEnd = { if (dx > limit) { haptic.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.LongPress); swipe() } }) { _, amount -> dx += amount }
    }) { content() }
}

// when the keyboard comes up the chat stays on its newest message (the page gets shorter from the bottom), like the web app
@Composable
fun KeepAtBottom(list: androidx.compose.foundation.lazy.LazyListState) {
    // the keyboard height is read in an effect, so the frames of its animation do not redraw the screen
    val insets = WindowInsets.ime
    val density = androidx.compose.ui.platform.LocalDensity.current
    LaunchedEffect(list) {
        var last = -1
        snapshotFlow { insets.getBottom(density) }.collect { ime ->
            val n = list.layoutInfo.totalItemsCount
            if (last >= 0 && ime > last && n > 0) { list.scrollToItem(n - 1); list.scrollBy(100_000f) }
            last = ime
        }
    }
    // the chat stays on its newest message while content grows under it (a preview or photo that loads late, a bubble that
    // opens); once the person scrolls up it stays where they left it, and sticks again when they come back down
    LaunchedEffect(list) {
        var stuck = true
        launch { snapshotFlow { list.isScrollInProgress }.collect { moving -> if (!moving) stuck = !list.canScrollForward } }
        snapshotFlow { val li = list.layoutInfo; li.totalItemsCount to (li.visibleItemsInfo.lastOrNull()?.let { it.offset + it.size } ?: 0) }.collect {
            if (stuck && list.canScrollForward) list.scrollBy(100_000f)
        }
    }
}

// How a message comes in (.mrow.new): one of mine pops in from its corner while it is sent (sendPop) and gives a small
// bounce when the server took it (landPop); one from the other side fades in (fadeIn). Each plays once.
enum class MsgAnim { None, In, Send, Land }
fun Modifier.msgIn(kind: MsgAnim, mine: Boolean): Modifier = if (kind == MsgAnim.None) this else composed {
    val a = remember { androidx.compose.animation.core.Animatable(0f) }
    LaunchedEffect(Unit) { a.animateTo(1f, androidx.compose.animation.core.tween(when (kind) { MsgAnim.Land -> 300; MsgAnim.Send -> 200; else -> 180 }, easing = androidx.compose.animation.core.LinearOutSlowInEasing)) }
    this.graphicsLayer {
        val k = a.value
        transformOrigin = androidx.compose.ui.graphics.TransformOrigin(if (mine) 1f else 0f, 1f)
        when (kind) {
            MsgAnim.In -> alpha = k
            MsgAnim.Send -> { alpha = k; val sc = 0.94f + 0.06f * k; scaleX = sc; scaleY = sc }
            MsgAnim.Land -> { val sc = if (k < 0.55f) 0.96f + (1.035f - 0.96f) * (k / 0.55f) else 1.035f - 0.035f * ((k - 0.55f) / 0.45f); scaleX = sc; scaleY = sc }
            else -> {}
        }
    }
}
