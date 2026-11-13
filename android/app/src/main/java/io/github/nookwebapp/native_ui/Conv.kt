package io.github.nookwebapp.native_ui

import androidx.compose.ui.zIndex
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
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
import kotlinx.coroutines.launch
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll

// convV: a chat on this phone. Messages sit at the bottom, a tap shows a message's time, a hold offers copy and delete;
// the text box keeps what was typed (the draft) and up to four photos can go with a message.
@Composable
fun ConvScreen(id: String) {
    val app = LocalApp.current
    val c = LocalNook.current
    val s = app.store
    val chat = s.chats.firstOrNull { it.id == id }
    if (chat == null) { LaunchedEffect(Unit) { app.pop() }; return }
    val fill = remember(chat.id) { arrayOfNulls<(String) -> Unit>(1) }
    // opening a chat wakes Zenith's server up, so the first answer does not wait for it
    LaunchedEffect(chat.id) { if (zOn()) runCatching { Sb.fn("zenith", org.json.JSONObject().put("action", "ping")) } }
    // the token of a call is asked for ahead of time, so the call starts without that wait
    LaunchedEffect(chat.id) { if (zOn()) runCatching { CallWarm.prefetch() } }
    var open by remember { mutableStateOf<String?>(null) }
    var shownFrom by remember(chat.id) { mutableIntStateOf(maxOf(0, chat.msgs.size - 80)) }
    val list = rememberLazyListState()
    // the messages already there when the chat opened come in without an animation
    val had = remember(chat.id) { chat.msgs.map { it.id }.toHashSet() }
    // a new message takes the view to the bottom; deleting one leaves the view where it is
    val atBottom by rememberAtBottom(list)
    var seenCount by remember(chat.id) { mutableIntStateOf(chat.msgs.size) }
    var unread by remember(chat.id) { mutableIntStateOf(0) }
    LaunchedEffect(atBottom) { if (atBottom) unread = 0 }
    LaunchedEffect(chat.msgs.size) {
        val grew = chat.msgs.size > seenCount
        val added = chat.msgs.size - seenCount
        seenCount = chat.msgs.size
        if (chat.msgs.isEmpty()) return@LaunchedEffect
        val mine = chat.msgs.lastOrNull()?.let { !it.ai } == true
        if (grew && !mine && !atBottom) unread += added
        // what I send always takes the view down; an answer or a delete only follows when the view is at the bottom already
        if (grew && mine) { list.scrollToItem(chat.msgs.size - shownFrom + 1); list.pinBottom() }
        else if (atBottom) { if (grew) list.scrollToItem(chat.msgs.size - shownFrom + 1); list.pinBottom() }
    }
    KeepAtBottom(list)
    Page({
        // .bar.chb: back, the chat's picture, name and handle, and its options
        Row(Modifier.fillMaxWidth().height(54.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(44.dp).offset(x = (-10).dp)) { IB("back") { app.pop() } }
            Row(Modifier.weight(1f).padding(start = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                MyAvatar(36.dp)
                Column {
                    T(chat.name, Fs.lg, FontWeight.Bold, maxLines = 1, lineHeight = (16 * 1.2).sp)
                    T("@" + s.profile.handle, Fs.sm, color = c.muted, maxLines = 1, lineHeight = (13 * 1.2).sp)
                }
            }
            // the call with Zenith: only the owner has it
            if (zOn()) Box(Modifier.width(44.dp)) { IB("phone") { app.callChatId = chat.id; app.startCall() } }
            Box(Modifier.width(44.dp)) {
                IB("dots") {
                    app.open(listOf(
                        SheetItem("Rename chat", "edit") { app.panels.add(Panel.RenameChat(chat)) },
                        SheetItem("Delete chat", "close", danger = true) { app.confirm("Delete this chat?", "Delete") { s.chats.remove(chat); app.persist(); app.pop() } },
                    ))
                }
            }
        }
    }) {
        val typing = app.zenTyping[chat.id]
        // the length of his answer is read in an effect, so each streamed piece does not redraw the screen
        LaunchedEffect(chat.id) { snapshotFlow { app.zenTyping[chat.id]?.text?.length }.collect { if (it != null && atBottom) list.scrollToItem(chat.msgs.size - shownFrom + 2) } }
        Box(Modifier.weight(1f).fillMaxWidth()) {
        ToBottomButton(list, unread, Modifier.align(Alignment.BottomEnd).padding(end = 10.dp).zIndex(2f))
        LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), state = list, verticalArrangement = Arrangement.Bottom, contentPadding = PaddingValues(top = 14.dp, bottom = 8.dp)) {
            if (chat.msgs.isEmpty()) item { Empty("smile", "Nothing here yet. Say something to yourself.", iconSize = 48.dp) }
            if (shownFrom > 0) item { Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) { Pill("Show earlier messages", Btn.Ghost) { shownFrom = maxOf(0, shownFrom - 80) } } }
            items(chat.msgs.drop(shownFrom), key = { it.id }) { m ->
                // pulling one of Zenith's messages to the right starts an answer to him
                val anim = remember(m.id) { if (m.id in had || m.id in app.zenNoAnim) MsgAnim.None else if (m.ai) MsgAnim.In else MsgAnim.Send }
                FoldAway(m.leaving) { Box(Modifier.padding(bottom = 6.dp).msgIn(anim, !m.ai)) { SwipeReply(m.ai, { fill[0]?.invoke("@zenith ") }) { Bubble(m, open == m.id, onTap = { open = if (open == m.id) null else m.id }) {
                    app.open(listOfNotNull(
                        if (m.text.isNotEmpty()) SheetItem("Copy message", "copy") { app.clipboard(m.text) } else null,
                        SheetItem("Delete message", "trash", danger = true) {
                            // the command and every card it brought in go together (a post with several files has one message per file)
                            val first = m.mcard?.let { it.optInt("n") == 0 && it.optInt("x") != 1 } == true
                            val group = if (first) chat.msgs.filter { x -> x.mcard != null && x.text == m.text && x.t >= m.t && x.t <= m.t + 40 } else listOf(m)
                            group.forEach { g -> app.foldOut(chat.msgs, g) { g.leaving = it } }
                        },
                    ))
                } } } }
            }
            // his answer while it is still being typed out
            // (the same key as the message it becomes, so the finished message takes the place of the typed one without a jump)
            if (typing != null && chat.msgs.none { it.id == typing.id }) item(key = typing.id) {
                Box(Modifier.padding(bottom = 6.dp).msgIn(MsgAnim.In, false).animateContentSize(tween(120))) { if (typing.text.isEmpty()) Box(Modifier.fillMaxWidth()) { TypingBubble() } else Bubble(typing, false, {}) {} }
            }
        }
        }
        ConvDock(chat, fill)
    }
}

// .cdock: the pending photos and the text box with its photo and send buttons. The typed text lives here, so a keystroke
// redraws the dock and not the messages. fill is given a way to put a word (Zenith's name) into the box.
@Composable
private fun ConvDock(chat: LChat, fill: Array<((String) -> Unit)?>) {
    val app = LocalApp.current
    val c = LocalNook.current
    // the text and where the cursor is: a word put in by the app (Zenith's name) leaves the cursor after it
    var tv by remember(chat.id) { mutableStateOf(TextFieldValue(chat.draft, TextRange(chat.draft.length))) }
    val text = tv.text
    fun setText(t: String) { tv = TextFieldValue(t, TextRange(t.length)); chat.draft = t; app.persist() }
    val focus = remember { FocusRequester() }
    val pend = remember { mutableStateListOf<String>() }
    val picker = rememberPicker(4 - pend.size) { got -> pend.addAll(got.take(4 - pend.size)) }
    fill[0] = { pre -> val cur = tv.text; if (!cur.startsWith(pre.trim(), true)) setText(pre + cur); runCatching { focus.requestFocus() } }
    // .cdock: the pending photos and the text box with its photo and send buttons
    Column(Modifier.fillMaxWidth().background(c.bg).lineAbove(c.line).navigationBarsPadding().padding(bottom = 10.dp)) {
        ZenPopHost(zOn() && zenHint(text)) { setText(text.replace(ZEN_AT, "@zenith ")) }
        if (pend.isNotEmpty()) Row(Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            pend.forEachIndexed { i, src ->
                Box(Modifier.size(64.dp).clip(RoundedCornerShape(Rad.s))) {
                    Pic(src, Modifier.fillMaxSize(), want = 200)
                    Box(Modifier.align(Alignment.TopEnd).padding(3.dp).size(22.dp).clip(CircleShape).background(Color(0xA6000000)).tap(CircleShape) { pend.removeAt(i) }, contentAlignment = Alignment.Center) { NIcon("close", 14.dp, Color.White) }
                }
            }
        }
        Row(Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            IB("image", tint = c.accent, box = 40.dp, height = 42.dp, enabled = pend.size < 4) { picker.gallery() }
            BasicTextField(
                tv, { v -> val changed = v.text != tv.text; tv = v; if (changed) { chat.draft = v.text; app.persist() } },
                Modifier.weight(1f).focusRequester(focus).heightIn(min = 42.dp, max = 140.dp).clip(RoundedCornerShape(Rad.bubble)).background(c.bg2).padding(horizontal = 14.dp, vertical = 10.dp),
                textStyle = LocalTextStyle.current.copy(color = c.fg, fontSize = Fs.lg, lineHeight = (16 * 1.35).sp), cursorBrush = SolidColor(c.accent),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                decorationBox = { inner -> Box { if (text.isEmpty()) T("Message", Fs.lg, color = c.muted, lineHeight = (16 * 1.35).sp); inner() } },
            )
            val can = text.isNotBlank() || pend.isNotEmpty()
            Box(Modifier.size(42.dp).alpha(if (can) 1f else 0.45f).clip(CircleShape).background(c.fill).pressTap(CircleShape, enabled = can) {
                if (pend.isEmpty()) { val fx = ClaudeFx.handle(app, text); if (fx != 0) { if (fx == 1) setText(""); return@pressTap } }
                // "/media <link>" in a note: the card of the video is made instead of a message with the words
                // (any chat of the notes list, also one that holds an answer of Zenith: earlier messages never stop the command)
                val cmd = MediaGrab.normalize(text)
                val links = if (pend.isEmpty()) MediaGrab.commandLinks(cmd) else null
                if (links != null) {
                    val audio = MediaGrab.isAudio(cmd)
                    val folder = MediaGrab.folder(cmd)
                    val qtext = if (audio) "audio" else MediaGrab.quality(cmd)
                    when {
                        links.isEmpty() && folder.isNotEmpty() -> {
                            // no link, only a folder: it is kept, and every download after it goes there
                            app.ctx?.let { MediaGrab.setDefaultFolder(it, audio, folder) }
                            setText("")
                            app.say(if (folder == "default") (if (audio) "/audio goes to the usual folder again" else "/media goes to the usual folders again") else (if (audio) "/audio saves in " else "/media saves in ") + folder)
                        }
                        links.isEmpty() -> app.say(if (audio) "Type /audio and a link" else "Type /media and a link")
                        links.any { MediaGrab.site(it) == null } -> app.say("Use links that start with https://")
                        else -> {
                            val typed = text
                            setText("")
                            app.say("Getting media...")
                            app.scope.launch {
                                // every link is read at the same time; the cards come in the order the links were pasted (the command shows on the first card only)
                                val done = links.map { link -> async { runCatching { MediaGrab.resolveAll(link, if (audio || MediaGrab.site(link) == "youtube") qtext else "") } } }.awaitAll()
                                val t0 = Clock.now(); var k = 0; var failed: Throwable? = null
                                val cmdText = (if (audio) "/audio " else "/media " + (if (links.any { MediaGrab.site(it) == "youtube" } && qtext.isNotEmpty()) "/$qtext " else "")) + (if (folder.isNotEmpty()) "/folder/$folder " else "") + links.joinToString(" ")
                                done.forEachIndexed { li, r ->
                                    val items = r.getOrNull()
                                    if (items == null) { failed = failed ?: r.exceptionOrNull(); return@forEachIndexed }
                                    val link = links[li]
                                    val qual = if (audio || MediaGrab.site(link) == "youtube") qtext else ""
                                    items.forEachIndexed { n, it ->
                                        val card = MediaGrab.card(link, it.info, qual, n, items.size)
                                        if (k > 0 && n == 0) card.put("x", 1)
                                        if (folder.isNotEmpty()) card.put("f", folder)
                                        if (k == 0 && links.size > 1) card.put("l", org.json.JSONArray(links))
                                        val m = LMsg(uid(), cmdText, t0 + k, emptyList()).also { x -> x.mcard = MediaGrab.cleanCard(card) }
                                        chat.msgs.add(m); k++
                                    }
                                }
                                if (k > 0) app.persist() else setText(typed)
                                failed?.let { e -> app.say(if (e is MediaGrab.Fail) e.message ?: "Could not get it" else "Could not get it (" + (e.message ?: e.javaClass.simpleName).lineSequence().first().take(80) + ")") }
                            }
                        }
                    }
                    return@pressTap
                }
                val m = LMsg(uid(), cleanText(text.trim()), Clock.now(), pend.toList())
                chat.msgs.add(m)
                pend.clear(); setText("")
                app.on.zAsk(chat, m)
            }, contentAlignment = Alignment.Center) { NIcon("send", 20.dp, c.on) }
        }
    }
}

// "/media link" and "/audio link" are commands: the link in them never gets a preview card of its own
private val MEDIA_CMD = Regex("^/(media|audio)\\b", RegexOption.IGNORE_CASE)
private fun isMediaCmd(t: String) = MEDIA_CMD.containsMatchIn(t.trim())

// .mrow: my message on the right in an accent bubble (photos above it), Zenith's on the left (.mrow.ai), and the time
// under it while it is open
@Composable
private fun Bubble(m: LMsg, open: Boolean, onTap: () -> Unit, onLong: () -> Unit) {
    val c = LocalNook.current
    val w = LocalConfiguration.current.screenWidthDp.dp - 32.dp
    val left = m.ai
    val fx = rememberBubbleFx()
    val opened by rememberUpdatedState(open)
    val tap = { if (!opened) fx.pop(); onTap() }
    Column(Modifier.fillMaxWidth().pointerInput(m.id) { detectTapGestures(onTap = { tap() }, onLongPress = { AppState.current?.buzz(); onLong() }) }, horizontalAlignment = if (left) Alignment.Start else Alignment.End) {
        if (m.imgs.isNotEmpty()) Box(Modifier.width(minOf(w * 0.82f, 320.dp)).clip(RoundedCornerShape(Rad.bubble))) { ImgGrid(m.imgs, whenText(m.t), framed = false) }
        // "/media link": the command stays in view with its link shortened, and the card of the video answers on the left
        m.mcard?.let { card ->
            val shown = card.optInt("n") == 0 && card.optInt("x") != 1
            if (shown) MediaCmd(card.optString("u"), card.optString("s"), card.optString("q"), tap, onLong, card.optJSONArray("l")?.let { a -> (0 until a.length()).map { a.optString(it) } }.orEmpty(), card.optString("f"))
            Box(Modifier.align(Alignment.Start).padding(top = if (shown) 4.dp else 0.dp)) { MediaCard(m, tap, onLong) }
        }
        m.rpost?.let { Box(Modifier.padding(top = if (m.imgs.isNotEmpty()) 4.dp else 0.dp)) { RCard(it.id, it.u) } }
        m.zpost?.let { Box(Modifier.padding(top = 4.dp)) { ZCard(it) } }
        // the text of a "/media" message is only its link (it is what the web app shows), the card is drawn instead
        val url = remember(m.text, m.mcard) { if (m.mcard != null || isMediaCmd(m.text)) null else firstUrl(m.text) }
        if (url != null) Box(Modifier.padding(top = if (m.imgs.isNotEmpty() || m.rpost != null) 4.dp else 0.dp)) { LinkCard(url, chat = true) }
        val clog = remember(m.text) { callLogOf(m.text) }
        if (clog != null) Box(Modifier.padding(top = 4.dp)) { CallLogCard(clog.first, clog.second, whenText(m.t)) }
        else if (m.text.isNotEmpty() && m.mcard == null) {
            val shape = if (left) RoundedCornerShape(Rad.bubble, Rad.bubble, Rad.bubble, Rad.xs) else RoundedCornerShape(Rad.bubble, Rad.bubble, Rad.xs, Rad.bubble)
            Box(
                Modifier.padding(top = if (m.imgs.isNotEmpty() || url != null || m.rpost != null) 4.dp else 0.dp).bubbleFx(fx, left).widthIn(max = w * 0.82f)
                    .clip(shape).background(if (left) c.bg2 else c.accent).then(if (left) Modifier.border(1.dp, c.line, shape) else Modifier).padding(horizontal = 14.dp, vertical = 9.dp),
            ) { Tx(m.text, color = if (left) c.fg else c.on, linkColor = if (left) null else Color.White, onTap = tap, onLong = onLong, cut = false) }
        }
        AnimatedVisibility(open, enter = expandVertically(tween(240)) + fadeIn(tween(200)), exit = shrinkVertically(tween(240)) + fadeOut(tween(200))) {
            T(whenText(m.t), Fs.xs, color = c.muted, align = if (left || m.mcard != null) TextAlign.Start else TextAlign.End, modifier = Modifier.fillMaxWidth().padding(top = 4.dp, end = 2.dp, start = 2.dp))
        }
    }
}
