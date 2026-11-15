package io.github.nookwebapp.native_ui

import androidx.compose.ui.zIndex
import androidx.compose.material3.Text
import androidx.compose.ui.layout.layout
import androidx.compose.ui.text.withStyle
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.animateScrollBy
import androidx.compose.foundation.gestures.detectTapGestures
import kotlinx.coroutines.flow.first
import androidx.compose.ui.graphics.graphicsLayer
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
    // this chat wears its own blue (chat menu, Chat color); everything inside it is drawn with it
    val base = LocalNook.current
    val tint = LocalApp.current.store.chats.firstOrNull { it.id == id }?.tint.orEmpty()
    val colors = remember(tint, base) { base.tinted(tint) }
    CompositionLocalProvider(LocalNook provides colors) { ConvScreenBody(id) }
}

@Composable
private fun ConvScreenBody(id: String) {
    val app = LocalApp.current
    val c = LocalNook.current
    val s = app.store
    val chat = s.chats.firstOrNull { it.id == id }
    if (chat == null) { LaunchedEffect(Unit) { app.pop() }; return }
    // his own chat: his picture and name on top, the call button, and every message goes to him
    val isZ = chat.id == ZDM
    val fill = remember(chat.id) { arrayOfNulls<(String) -> Unit>(1) }
    val replyHook = remember(chat.id) { arrayOfNulls<(LMsg) -> Unit>(1) }
    // opening a chat wakes Zenith's server up, so the first answer does not wait for it
    LaunchedEffect(chat.id) {
        if (zOn()) runCatching {
            val r = Sb.fn("zenith", org.json.JSONObject().put("action", "ping"))
            if (isZ && r.ok && r.body.has("calls")) { app.zCalls = r.body.optBoolean("calls"); app.saveZ() }
        }
    }
    // his chat: what he wrote while the phone did not get the push is asked for (when the chat opens, then every little while)
    LaunchedEffect(chat.id) { if (isZ) while (true) { runCatching { app.on.zenPullTexts() }; kotlinx.coroutines.delay(20_000) } }
    // the token of a call is asked for ahead of time, so the call starts without that wait
    LaunchedEffect(chat.id) { if (zOn()) runCatching { CallWarm.prefetch() } }
    var open by remember { mutableStateOf<String?>(null) }
    var shownFrom by remember(chat.id) { mutableIntStateOf(maxOf(0, chat.msgs.size - 80)) }
    val list = rememberLazyListState()
    // a tap on the quote of a reply takes you to the message it answers: it scrolls there with an animation (a far one is first brought near),
    // and the message flashes
    var flashId by remember(chat.id) { mutableStateOf<String?>(null) }
    val jumpScope = rememberCoroutineScope()
    val jumpTo: (String) -> Unit = { rid ->
        jumpScope.launch {
            val idx = chat.msgs.indexOfFirst { it.id == rid }
            if (idx < 0) { app.say("That message is gone"); return@launch }
            if (idx < shownFrom) { shownFrom = maxOf(0, idx - 15); kotlinx.coroutines.delay(60) }
            val at = (if (chat.msgs.isEmpty()) 1 else 0) + (if (shownFrom > 0) 1 else 0) + (idx - shownFrom)
            // a message that is not on the screen is brought into it at once, then everything glides: the message ends a third of the way down.
            // (animateScrollToItem to a far item jerks, because the heights of the messages in between are not known yet)
            if (list.layoutInfo.visibleItemsInfo.none { it.index == at }) list.scrollToItem(at)
            val item = snapshotFlow { list.layoutInfo.visibleItemsInfo.firstOrNull { it.index == at } }.first { it != null } ?: return@launch
            val info = list.layoutInfo
            val want = info.viewportStartOffset + (info.viewportEndOffset - info.viewportStartOffset) / 3
            list.animateScrollBy((item.offset - want).toFloat(), tween(420))
            flashId = rid
            kotlinx.coroutines.delay(1100)
            if (flashId == rid) flashId = null
        }
    }
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
        else if (atBottom) { if (grew) list.glideToBottom() else list.pinBottom() }
    }
    KeepAtBottom(list)
    Page({
        // .bar.chb: back, the chat's picture, name and handle, and its options
        Row(Modifier.fillMaxWidth().height(54.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(44.dp).offset(x = (-10).dp)) { IB("back") { app.pop() } }
            Row(Modifier.weight(1f).padding(start = 4.dp).then(if (isZ) Modifier.tap { app.go(Route.Zen) } else Modifier), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (isZ) ZenAv(36.dp) else MyAvatar(36.dp)
                Column {
                    T(chat.name, Fs.lg, FontWeight.Bold, maxLines = 1, lineHeight = (16 * 1.2).sp)
                    T("@" + (if (isZ) s.zen.optString("handle").ifEmpty { "zenith" } else s.profile.handle), Fs.sm, color = c.muted, maxLines = 1, lineHeight = (13 * 1.2).sp)
                }
            }
            // the call with Zenith: only the owner has it
            // the call button is there only when he is comfortable with calls (he decides, and can change his mind)
            if (zOn() && isZ && app.zCalls) Box(Modifier.width(44.dp)) { IB("phone") { app.startCall() } }
            Box(Modifier.width(44.dp)) {
                IB("dots") {
                    if (isZ) app.open(listOf(
                        // a nickname for him, only on this phone
                        SheetItem("Rename chat", "edit") { app.panels.add(Panel.RenameChat(chat)) },
                        SheetItem("Chat color", "sliders") { app.panels.add(Panel.ChatColor(chat)) },
                        // it only goes for the owner: his chat stays (it is always there) and he still remembers it
                        SheetItem("Delete chat", "close", danger = true) { app.confirm("Delete this chat? It is only deleted for you, he still remembers it.", "Delete") { app.on.zenClearChat(chat); app.persist(); app.on.zenSyncSoon() } },
                    ))
                    else app.open(listOf(
                        SheetItem("Rename chat", "edit") { app.panels.add(Panel.RenameChat(chat)) },
                        SheetItem("Chat color", "sliders") { app.panels.add(Panel.ChatColor(chat)) },
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
            if (chat.msgs.isEmpty()) item { Empty("smile", if (isZ) "Say hi to Zenith." else "Nothing here yet. Say something to yourself.", iconSize = 48.dp) }
            if (shownFrom > 0) item { Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) { Pill("Show earlier messages", Btn.Ghost) { shownFrom = maxOf(0, shownFrom - 80) } } }
            items(chat.msgs.drop(shownFrom), key = { it.id }) { m ->
                // pulling one of Zenith's messages to the right starts an answer to him
                val anim = remember(m.id) { if (m.id in had || m.id in app.zenNoAnim) MsgAnim.None else if (m.ai) MsgAnim.In else MsgAnim.Send }
                FoldAway(m.leaving) { Box(Modifier.padding(bottom = 6.dp).msgIn(anim, !m.ai)) { SwipeBubble(left = m.ai, canReply = m.ai, onReply = { if (isZ) replyHook[0]?.invoke(m) else fill[0]?.invoke("@zenith ") }, onTime = { open = if (open == m.id) null else m.id }) { Bubble(m, open == m.id, onTap = {}, flash = flashId == m.id, onQuote = { rid -> jumpTo(rid) }, onDouble = if (isZ) ({ m.liked = !m.liked; app.persist(); app.scope.launch { runCatching { Sb.fn("zenith", org.json.JSONObject().put("action", "like").put("id", m.id).put("on", m.liked)) } } }) else null) {
                    app.open(listOfNotNull(
                        if (isZ) SheetItem("Reply", "reply") { replyHook[0]?.invoke(m) } else null,
                        if (m.text.isNotEmpty()) SheetItem("Copy message", "copy") { app.clipboard(m.text) } else null,
                        SheetItem(if (isZ && m.ai) "Delete for me" else "Delete message", "trash", danger = true) {
                            // in his chat: his messages go only for the owner; the owner's own go for both (he forgets them too)
                            if (isZ && !m.ai) { val ids = org.json.JSONArray().put(m.id); app.scope.launch { runCatching { Sb.fn("zenith", org.json.JSONObject().put("action", "forget").put("ids", ids)) } } }
                            // the command and every card it brought in go together (a post with several files has one message per file)
                            val first = m.mcard?.let { it.optInt("n") == 0 && it.optInt("x") != 1 } == true
                            val group = if (first) chat.msgs.filter { x -> x.mcard != null && x.text == m.text && x.t >= m.t && x.t <= m.t + 40 } else listOf(m)
                            group.forEach { g -> app.foldOut(chat.msgs, g) { g.leaving = it } }
                        },
                    ))
                } } } }
            }
            // Delivered or Seen under the newest message to him
            val lm = chat.msgs.lastOrNull()
            if (isZ && lm != null && !lm.ai && callLogOf(lm.text) == null && typing == null) item(key = "zstatus") {
                val st = if (lm.t <= app.zSeen) "Seen" else if (lm.t <= app.zUndelivered) "Not delivered" else ""
                if (st.isNotEmpty()) T(st, Fs.xs, color = c.muted, align = TextAlign.End, modifier = Modifier.fillMaxWidth().padding(end = 4.dp, bottom = 2.dp))
            }
            // his answer while it is still being typed out
            // (the same key as the message it becomes, so the finished message takes the place of the typed one without a jump)
            if (typing != null && chat.msgs.none { it.id == typing.id }) item(key = typing.id) {
                Box(Modifier.padding(bottom = 6.dp).msgIn(MsgAnim.In, false).animateContentSize(tween(120))) { if (typing.text.isEmpty()) Box(Modifier.fillMaxWidth()) { TypingBubble() } else Bubble(typing, false, {}) {} }
            }
        }
        }
        ConvDock(chat, fill, replyHook)
    }
}

// .cdock: the pending photos and the text box with its photo and send buttons. The typed text lives here, so a keystroke
// redraws the dock and not the messages. fill is given a way to put a word (Zenith's name) into the box.
@Composable
private fun ConvDock(chat: LChat, fill: Array<((String) -> Unit)?>, replyHook: Array<((LMsg) -> Unit)?>) {
    val app = LocalApp.current
    val c = LocalNook.current
    val isZ = chat.id == ZDM
    // the text and where the cursor is: a word put in by the app (Zenith's name) leaves the cursor after it
    var tv by remember(chat.id) { mutableStateOf(TextFieldValue(chat.draft, TextRange(chat.draft.length))) }
    val text = tv.text
    fun setText(t: String) { tv = TextFieldValue(t, TextRange(t.length)); chat.draft = t; app.persist(); if (t.isEmpty()) ZTyping.at = 0 }
    val focus = remember { FocusRequester() }
    val pend = remember { mutableStateListOf<String>() }
    val picker = rememberPicker(4 - pend.size) { got -> pend.addAll(got.take(4 - pend.size)) }
    // in his chat the typing is noted, so he can see it (he waits for the owner or texts anyway)
    DisposableEffect(chat.id) { if (isZ) ZTyping.open = true; onDispose { if (isZ) { ZTyping.open = false; ZTyping.at = 0 } } }
    var replyTo by remember(chat.id) { mutableStateOf<LMsg?>(null) }
    replyHook[0] = { m -> replyTo = m; runCatching { focus.requestFocus() } }
    fill[0] = { pre -> val cur = tv.text; if (!cur.startsWith(pre.trim(), true)) setText(pre + cur); runCatching { focus.requestFocus() } }
    // .cdock: the pending photos and the text box with its photo and send buttons
    Column(Modifier.fillMaxWidth().background(c.bg).lineAbove(c.line).navigationBarsPadding().padding(bottom = 10.dp)) {
        if (!isZ) ZenPopHost(zOn() && zenHint(text)) { setText(text.replace(ZEN_AT, "@zenith ")) }
        // the message being answered (swipe his message to the right, or hold a message and pick Reply): it slides up above the box
        var lastReply by remember { mutableStateOf<LMsg?>(null) }
        if (replyTo != null) lastReply = replyTo
        AnimatedVisibility(replyTo != null, enter = expandVertically(tween(220)) + fadeIn(tween(200)), exit = shrinkVertically(tween(180)) + fadeOut(tween(140))) {
            lastReply?.let { rt ->
                Row(Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.bg2).padding(start = 10.dp, top = 4.dp, bottom = 4.dp, end = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.width(3.dp).height(26.dp).clip(CircleShape).background(c.accent))
                    Column(Modifier.weight(1f).padding(start = 8.dp)) {
                        T(if (rt.ai) "Zenith" else "You", Fs.xs, FontWeight.Bold, c.accent, maxLines = 1)
                        T(replySnippet(rt), Fs.sm, color = c.muted, maxLines = 1)
                    }
                    IB("close", box = 32.dp) { replyTo = null }
                }
            }
        }
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
                tv, { v -> val changed = v.text != tv.text; tv = v; if (changed) { chat.draft = v.text; app.persist(); if (isZ) ZTyping.at = if (v.text.isEmpty()) 0 else System.currentTimeMillis() } },
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
                val links = if (pend.isEmpty() && !isZ) MediaGrab.commandLinks(cmd) else null
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
                if (isZ) replyTo?.let { rt -> m.reply = ReplyRef(rt.id, replySnippet(rt), rt.ai) }
                replyTo = null
                chat.msgs.add(m)
                pend.clear(); setText("")
                if (isZ) app.on.zDm(chat, m) else app.on.zAsk(chat, m)
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
private fun Bubble(m: LMsg, open: Boolean, onTap: () -> Unit, onDouble: (() -> Unit)? = null, flash: Boolean = false, onQuote: ((String) -> Unit)? = null, onLong: () -> Unit) {
    val c = LocalNook.current
    val w = LocalConfiguration.current.screenWidthDp.dp - 32.dp
    val left = m.ai
    val fx = rememberBubbleFx()
    val opened by rememberUpdatedState(open)
    val tap = { if (!opened) fx.pop(); onTap() }
    // the touch area is the message itself (the row is as wide as its widest part), so a tap beside a message does nothing
    Column(Modifier.fillMaxWidth().wrapContentWidth(if (left) Alignment.Start else Alignment.End).pointerInput(m.id) { detectTapGestures(onTap = { tap() }, onDoubleTap = if (onDouble != null) { _ -> onDouble() } else null, onLongPress = { AppState.current?.buzz(); onLong() }) }, horizontalAlignment = if (left) Alignment.Start else Alignment.End) {
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
            val rp = m.reply
            // the bubble flashes a little when it was jumped to from a reply
            val glow by androidx.compose.animation.core.animateFloatAsState(if (flash) 1f else 0f, tween(if (flash) 220 else 700), label = "glow")
            Box(
                Modifier.padding(top = if (m.imgs.isNotEmpty() || url != null || m.rpost != null) 4.dp else 0.dp).bubbleFx(fx, left).widthIn(max = w * 0.82f)
                    .clip(shape).background(if (left) c.bg2 else c.accent)
                    // one border for both: his has its thin line, and the highlight grows it to 2dp in the accent colour; mine grows from nothing to 2dp in white
                    .border((if (left) 1f + glow else 2f * glow).dp, if (left) androidx.compose.ui.graphics.lerp(c.line, c.accent, glow) else Color.White.copy(alpha = glow), shape).padding(start = 14.dp, end = 14.dp, top = if (rp != null) 6.dp else 9.dp, bottom = 9.dp),
            ) {
                Column {
                    // the message this one answers: one faded line, a tap takes you to it
                    if (rp != null) Text(
                        rp.text.replace(Regex("\\s+"), " "),
                        Modifier.padding(bottom = 1.dp).widthIn(max = 230.dp).clip(RoundedCornerShape(4.dp)).then(if (onQuote != null) Modifier.pointerInput(rp.id) { detectTapGestures(onTap = { onQuote(rp.id) }) } else Modifier),
                        color = (if (left) c.fg else Color.White).copy(alpha = 0.6f), fontSize = 12.5.sp, lineHeight = 17.sp, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                    )
                    Tx(m.text, color = if (left) c.fg else c.on, linkColor = if (left) null else Color.White, onTap = tap, onLong = onLong, cut = false, onDouble = onDouble)
                }
            }
        }
        // the like of a double tap sits on the corner of the bubble
        LikeHeart(m.liked, left)
        // the time, under the message, opens with a swipe (his to the left, mine to the right)
        AnimatedVisibility(open, enter = expandVertically(tween(240)) + fadeIn(tween(200)), exit = shrinkVertically(tween(240)) + fadeOut(tween(200))) {
            T(whenText(m.t), Fs.xs, color = c.muted, modifier = Modifier.padding(top = 4.dp, end = 2.dp, start = 2.dp))
        }
    }
}

// the heart of a like: a soft pink heart (not a circle) that pops in with a bounce, with a bigger one that rises and fades when it is given;
// a ring of the page colour around it keeps it clear of the bubble
@Composable
private fun LikeHeart(liked: Boolean, left: Boolean) {
    val c = LocalNook.current
    val pop by androidx.compose.animation.core.animateFloatAsState(if (liked) 1f else 0f, androidx.compose.animation.core.spring(androidx.compose.animation.core.Spring.DampingRatioMediumBouncy, androidx.compose.animation.core.Spring.StiffnessMedium), label = "heart")
    val burst = remember { androidx.compose.animation.core.Animatable(0f) }
    var first by remember { mutableStateOf(true) }
    LaunchedEffect(liked) { if (first) { first = false; return@LaunchedEffect }; if (liked) { burst.snapTo(0f); burst.animateTo(1f, tween(650)) } }
    if (pop < 0.01f && burst.value <= 0f) return
    val pink = Color(0xFFFF4F79)
    // it sits on the bottom corner of the bubble and only takes a few dp of height, so a liked message does not leave a gap under it
    Box(Modifier.offset(x = if (left) 12.dp else (-12).dp).layout { m, c ->
        val p = m.measure(c)
        // its middle is on the bottom edge of the bubble, and only 8dp of height is kept for it
        layout(p.width, 8.dp.roundToPx()) { p.place(0, -(p.height - 12.dp.roundToPx())) }
    }.size(24.dp), contentAlignment = Alignment.Center) {
        if (burst.value in 0.01f..0.99f) NIcon("heart", 22.dp, pink.copy(alpha = 0.55f * (1f - burst.value)), fill = true, modifier = Modifier.graphicsLayer { scaleX = 1f + burst.value * 1.6f; scaleY = 1f + burst.value * 1.6f; translationY = -burst.value * 18.dp.toPx() })
        Box(Modifier.graphicsLayer { scaleX = pop; scaleY = pop; alpha = pop.coerceIn(0f, 1f) }, contentAlignment = Alignment.Center) {
            NIcon("heart", 23.dp, c.bg, fill = true)
            NIcon("heart", 18.dp, pink, fill = true)
        }
    }
}

// a swipe on a message (nothing moves, only the phone ticks): his message to the right answers it and to the left shows its time,
// mine to the right shows its time
@Composable
private fun SwipeBubble(left: Boolean, canReply: Boolean, onReply: () -> Unit, onTime: () -> Unit, content: @Composable () -> Unit) {
    val haptic = androidx.compose.ui.platform.LocalHapticFeedback.current
    val limit = with(androidx.compose.ui.platform.LocalDensity.current) { 56.dp.toPx() }
    val reply by rememberUpdatedState(onReply)
    val time by rememberUpdatedState(onTime)
    Box(Modifier.fillMaxWidth().pointerInput(left, canReply) {
        var dx = 0f
        detectHorizontalDragGestures(
            onDragStart = { dx = 0f },
            onDragEnd = {
                val tick = androidx.compose.ui.hapticfeedback.HapticFeedbackType.LongPress
                if (left && canReply && dx > limit) { haptic.performHapticFeedback(tick); reply() }
                else if (left && dx < -limit) { haptic.performHapticFeedback(tick); time() }
                else if (!left && dx > limit) { haptic.performHapticFeedback(tick); time() }
            },
        ) { _, amount -> dx += amount }
    }) { content() }
}
