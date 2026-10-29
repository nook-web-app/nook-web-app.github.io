package io.github.nookwebapp.native_ui

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
    LaunchedEffect(Unit) { if (dm.locked) on.promptUnlock() }
    LaunchedEffect(on.me) {
        if (on.me == null) { dm.inboxN = 0; return@LaunchedEffect }
        if (dm.inbox == null) on.cachedInbox()?.let { dm.inbox = it }
        on.loadDmMutes()
        var first = true
        while (true) {
            try {
                val c = on.dmInbox()
                on.refreshBadge(false)
                Cache.write("inbox:" + on.uid, JSONArray(c.map { it.json() }))
                dm.inbox = c
                // the newest chats are downloaded in the background, so tapping one shows its messages right away
                if (first) c.take(3).forEach { cv -> app.scope.launch { runCatching { val k = "thread:" + on.uid + ":" + cv.other; if ((Cache.fresh(k, 60_000)) == null) Cache.write(k, JSONArray(on.dmThread(cv.other).takeLast(100))); on.sharedKey(cv.other) } } }
                first = false
            } catch (e: Exception) { if (dm.inbox == null) dm.inbox = emptyList() }
            delay(if (dm.rtOk) 15_000 else 5000)
            while (!app.foreground) delay(1000)
        }
    }
    val convos = (dm.inbox ?: emptyList()).filter { it.other !in dm.hideSet }.sortedByDescending { if (it.other in s.dmPins) 1 else 0 }
    val local = s.chats.sortedByDescending { c -> c.msgs.lastOrNull()?.t ?: c.t }
    Page({ Bar("Chats", { Lead() }) }, fab = if (s.chats.isNotEmpty()) ({ Fab("plus") { app.newChat() } }) else null) {
        LazyColumn(Modifier.fillMaxSize(), state = app.listState(), contentPadding = PaddingValues(bottom = if (s.chats.isNotEmpty()) 88.dp else 0.dp)) {
            // rows of the same shape as the chats shimmer until the real ones are drawn, so the page never looks empty
            if (dm.inbox == null && on.me != null) items((Cache.read("inbox-n")?.v as? Int ?: 1).coerceIn(1, 6)) { SkelRow() }
            items(convos, key = { "d" + it.other }) { cv -> ConvoRow(cv) }
            if ((dm.inbox != null || on.me == null) && convos.isEmpty() && s.chats.isEmpty()) item { Empty("smile", "Say hi to yourself.") { Pill("New chat") { app.newChat() } } }
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
        Box(Modifier.size(48.dp).clip(CircleShape).background(c.bg2))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.fillMaxWidth(0.45f).height(14.dp).clip(RoundedCornerShape(Rad.s)).background(c.bg2))
            Box(Modifier.fillMaxWidth(0.75f).height(12.dp).clip(RoundedCornerShape(Rad.s)).background(c.bg2))
        }
    }
}

// dmRow(): the person, what the last message says (opened a moment later), when, and the unread number
@Composable
private fun ConvoRow(cv: Convo) {
    val app = LocalApp.current
    val c = LocalNook.current
    val on = app.on
    app.dm.typingVersion
    on.nickVersion
    val last = cv.last
    val mine = last?.optString("sender_id") == on.uid
    var gist by remember(cv.other, last?.opt("id")) { mutableStateOf(if (last == null) "No messages" else dmGist("", last.optJSONArray("media"), mine)) }
    LaunchedEffect(cv.other, last?.opt("id")) {
        if (last != null) gist = dmGist(zUn(on.openText(cv.other, last.optString("body"), true)), last.optJSONArray("media") ?: runCatching { JSONArray(last.optString("media")) }.getOrNull(), mine)
    }
    val typing = on.isTyping(cv.other)
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
    var tv by remember(id) { mutableStateOf(TextFieldValue("")) }
    val text = tv.text
    fun setText(t: String) { tv = TextFieldValue(t, TextRange(t.length)) }
    val focus = remember { FocusRequester() }
    val pend = remember(id) { mutableStateListOf<String>() }
    var busy by remember { mutableStateOf(false) }
    val picker = rememberPicker(4 - pend.size) { got -> val room = 4 - pend.size; pend.addAll(got.take(room)); if (got.size > room) app.say("Only 4 allowed, extra ones skipped") }
    var open by remember { mutableStateOf<DmMsg?>(null) }
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    l.fill = { pre -> if (l.locked.isEmpty()) { setText(if (text.isNotBlank()) text.trimEnd() + " " + pre else pre); runCatching { focus.requestFocus() } } }
    // the chat stays at its newest message while new ones come in
    LaunchedEffect(l.rows.size, l.typing) { if (l.rows.isNotEmpty()) list.animateScrollToItem(l.rows.size + 1) }
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
        LazyColumn(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 16.dp), state = list, verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.Bottom), contentPadding = PaddingValues(vertical = 14.dp)) {
            if (!l.loaded && l.rows.isEmpty()) item { Loading() }
            else if (l.failed && l.rows.isEmpty()) item { Empty(null, "Could not load messages. Trying again...") }
            else if (l.rows.isEmpty()) item { Empty("chat", "No messages yet. Say hi.", iconSize = 48.dp) }
            items(l.rows, key = { it.id?.toString() ?: ("t" + System.identityHashCode(it)) }) { m ->
                // one of Zenith's messages pulled to the right starts an answer to him (the owner's chats only)
                val mineM = m.sender == on.uid && !m.ai
                val anim = remember(m) { (if (!m.fresh) MsgAnim.None else if (!mineM) MsgAnim.In else if (m.tmp) MsgAnim.Send else MsgAnim.Land).also { m.fresh = false } }
                Box(Modifier.msgIn(anim, mineM)) { SwipeReply(m.ai && zOn(), { l.fill?.invoke("@zenith ") }) { DmBubble(m, id, open === m, onTap = { open = if (open === m) null else m }) {
                    val body = m.text ?: m.body
                    app.open(listOfNotNull(
                        if (body.isNotEmpty()) SheetItem("Copy message", "copy") { app.clipboard(body) } else null,
                        if (m.sender == on.uid && m.id != null) SheetItem("Delete message", "trash", danger = true) { app.confirm("Delete this message?", "Delete") { on.deleteDm(m, id) } } else null,
                    ).ifEmpty { return@DmBubble })
                } } }
            }
            // .trow: the typing dots, in a slot that grows smoothly
            item(key = "typing") {
                AnimatedVisibility(l.typing, enter = expandVertically(tween(300)) + fadeIn(tween(250)), exit = shrinkVertically(tween(300)) + fadeOut(tween(250))) {
                    Box(Modifier.fillMaxWidth()) { TypingBubble(Modifier.align(Alignment.CenterStart)) }
                }
            }
        }
        // .cdock: the note when messaging is off, the pending photos, and the text box with its photo and send buttons
        Column(Modifier.fillMaxWidth().background(c.bg).lineAbove(c.line).navigationBarsPadding().padding(bottom = 10.dp)) {
            if (zOn() && Regex("@\\w*$").containsMatchIn(text)) ZenPop { setText(text.replace(Regex("@\\w*$"), "@zenith ")) }
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
                    val t = cleanText(text.trim()); val srcs = pend.toList()
                    busy = true; setText(""); pend.clear()
                    scope.launch {
                        if (!on.doSendDm(l, t, srcs)) { setText(if (text.isNotBlank()) t + "\n" + tv.text else t); pend.addAll(srcs) }
                        busy = false
                    }
                }, contentAlignment = Alignment.Center) { NIcon("send", 20.dp, c.on) }
            }
        }
    }
}

// .zpop: typing @ offers Zenith (the owner's chats only)
@Composable
fun ZenPop(onPick: () -> Unit) {
    val c = LocalNook.current
    Box(Modifier.padding(start = 16.dp, top = 8.dp)) {
        Row(Modifier.clip(RoundedCornerShape(Rad.m)).background(c.bg2).border(1.dp, c.line, RoundedCornerShape(Rad.m)).tap(onClick = onPick).padding(start = 8.dp, end = 14.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ZenAv(34.dp); T("Zenith AI", weight = FontWeight.Bold)
        }
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

// .bub.typing: three dots that bob
@Composable
fun TypingBubble(modifier: Modifier = Modifier) {
    val c = LocalNook.current
    val tr = rememberInfiniteTransition(label = "dots")
    Row(modifier.clip(RoundedCornerShape(Rad.bubble, Rad.bubble, Rad.bubble, Rad.xs)).background(c.bg2).border(1.dp, c.line, RoundedCornerShape(Rad.bubble, Rad.bubble, Rad.bubble, Rad.xs)).padding(horizontal = 16.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        repeat(3) { i ->
            val y by tr.animateFloat(0f, 1f, infiniteRepeatable(tween(1000, delayMillis = 0), RepeatMode.Restart, initialStartOffset = androidx.compose.animation.core.StartOffset(i * 150)), label = "d$i")
            val k = if (y < 0.5f) y * 2 else (1 - y) * 2
            Box(Modifier.offset(y = (-3 * k).dp).size(7.dp).alpha(0.5f + 0.5f * k).clip(CircleShape).background(c.muted))
        }
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
    Column(Modifier.fillMaxWidth().alpha(if (m.tmp && mine) 0.7f else 1f).pointerInput(m) { detectTapGestures(onTap = { onTap() }, onLongPress = { AppState.current?.buzz(); onLong() }) }, horizontalAlignment = if (left) Alignment.Start else Alignment.End) {
        val media = (0 until m.media.length()).mapNotNull { m.media.optJSONObject(it) }
        media.forEachIndexed { i, md -> DmMedia(md, other, m, i, Modifier.padding(top = if (i > 0) 4.dp else 0.dp)) }
        m.rpost?.let { Box(Modifier.padding(top = if (media.isNotEmpty()) 4.dp else 0.dp)) { RCard(it.id, it.u) } }
        m.zpost?.let { Box(Modifier.padding(top = 4.dp)) { ZCard(it) } }
        firstUrl(body)?.let { Box(Modifier.padding(top = if (media.isNotEmpty() || m.rpost != null) 4.dp else 0.dp)) { LinkCard(it, chat = true) } }
        if (body.isNotEmpty()) {
            val shape = if (left) RoundedCornerShape(Rad.bubble, Rad.bubble, Rad.bubble, Rad.xs) else RoundedCornerShape(Rad.bubble, Rad.bubble, Rad.xs, Rad.bubble)
            Box(Modifier.padding(top = if (media.isNotEmpty() || m.rpost != null || firstUrl(body) != null) 4.dp else 0.dp).widthIn(max = w * 0.82f).clip(shape)
                .background(if (left) c.bg2 else c.accent).then(if (left) Modifier.border(1.dp, c.line, shape) else Modifier).padding(horizontal = 14.dp, vertical = 9.dp)) {
                Tx(if (m.ai) "zenith $body" else body, color = if (left) c.fg else c.on, linkColor = if (left) null else Color.White, onTap = onTap, onLong = onLong)
            }
        }
        AnimatedVisibility(open, enter = expandVertically(tween(240)) + fadeIn(tween(200)), exit = shrinkVertically(tween(240)) + fadeOut(tween(200))) {
            Row(Modifier.fillMaxWidth().padding(top = 4.dp, start = 2.dp, end = 2.dp), horizontalArrangement = if (left) Arrangement.Start else Arrangement.End) {
                T(whenText(m.t), Fs.xs, color = c.muted)
                if (m.plain) T("Not encrypted", Fs.xs, color = Color(0xFFC0392B), modifier = Modifier.padding(start = 6.dp))
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
    val local = md.optString("url").takeIf { it.startsWith("/") }
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
    Box(modifier.width(maxW).then(if (ar != null) Modifier.aspectRatio(ar) else Modifier.heightIn(min = 140.dp)).clip(RoundedCornerShape(Rad.m)).background(c.bg2)) {
        val p = path
        if (p != null) Pic(p, Modifier.matchParentSize().tap {
            app.scope.launch {
                val all = (0 until m.media.length()).mapNotNull { k -> m.media.optJSONObject(k) }.mapNotNull { x -> x.optString("url").takeIf { it.startsWith("/") } ?: runCatching { app.on.encMedia(x) { app.on.sharedKeyFast(other) } }.getOrNull() }
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
    val ime = WindowInsets.ime.getBottom(androidx.compose.ui.platform.LocalDensity.current)
    var last by remember { mutableIntStateOf(ime) }
    LaunchedEffect(ime) {
        val n = list.layoutInfo.totalItemsCount
        if (ime > last && n > 0) { list.scrollToItem(n - 1); list.scrollBy(100_000f) }
        last = ime
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
