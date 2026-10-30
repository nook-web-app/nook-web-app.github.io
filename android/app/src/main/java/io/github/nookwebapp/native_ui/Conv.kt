package io.github.nookwebapp.native_ui

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
    var open by remember { mutableStateOf<String?>(null) }
    var shownFrom by remember(chat.id) { mutableIntStateOf(maxOf(0, chat.msgs.size - 80)) }
    val list = rememberLazyListState()
    // the messages already there when the chat opened come in without an animation
    val had = remember(chat.id) { chat.msgs.map { it.id }.toHashSet() }
    LaunchedEffect(chat.msgs.size) { if (chat.msgs.isNotEmpty()) list.scrollToItem(chat.msgs.size - shownFrom + 1) }
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
            Box(Modifier.width(44.dp)) {
                IB("dots") {
                    app.open(listOf(
                        SheetItem("Rename chat", "edit") { app.panels.add(Panel.RenameChat(chat)) },
                        SheetItem("Clear messages", "trash", danger = true) { app.confirm("Clear every message in this chat?", "Clear") { chat.msgs.clear(); app.persist() } },
                        SheetItem("Delete chat", "close", danger = true) { app.confirm("Delete this chat?", "Delete") { s.chats.remove(chat); app.persist(); app.pop() } },
                    ))
                }
            }
        }
    }) {
        val typing = app.zenTyping[chat.id]
        // the length of his answer is read in an effect, so each streamed piece does not redraw the screen
        LaunchedEffect(chat.id) { snapshotFlow { app.zenTyping[chat.id]?.text?.length }.collect { if (it != null) list.scrollToItem(chat.msgs.size - shownFrom + 2) } }
        LazyColumn(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 16.dp), state = list, verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.Bottom), contentPadding = PaddingValues(vertical = 14.dp)) {
            if (chat.msgs.isEmpty()) item { Empty("smile", "Nothing here yet. Say something to yourself.", iconSize = 48.dp) }
            if (shownFrom > 0) item { Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) { Pill("Show earlier messages", Btn.Ghost) { shownFrom = maxOf(0, shownFrom - 80) } } }
            items(chat.msgs.drop(shownFrom), key = { it.id }) { m ->
                // pulling one of Zenith's messages to the right starts an answer to him
                val anim = remember(m.id) { if (m.id in had) MsgAnim.None else if (m.ai) MsgAnim.In else MsgAnim.Send }
                Box(Modifier.msgIn(anim, !m.ai)) { SwipeReply(m.ai, { fill[0]?.invoke("@zenith ") }) { Bubble(m, open == m.id, onTap = { open = if (open == m.id) null else m.id }) {
                    app.open(listOfNotNull(
                        if (m.text.isNotEmpty()) SheetItem("Copy message", "copy") { app.clipboard(m.text) } else null,
                        SheetItem("Delete message", "trash", danger = true) { chat.msgs.remove(m); app.persist() },
                    ))
                } } }
            }
            // his answer while it is still being typed out
            if (typing != null) item(key = "zen-typing") {
                if (typing.text.isEmpty()) Box(Modifier.fillMaxWidth()) { TypingBubble() } else Bubble(typing, false, {}) {}
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
    fill[0] = { pre -> setText(pre); runCatching { focus.requestFocus() } }
    // .cdock: the pending photos and the text box with its photo and send buttons
    Column(Modifier.fillMaxWidth().background(c.bg).lineAbove(c.line).navigationBarsPadding().padding(bottom = 10.dp)) {
        ZenPopHost(zOn() && ZEN_AT.containsMatchIn(text)) { setText(text.replace(ZEN_AT, "@zenith ")) }
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
                // "/media <link>" in a note: the card of the video is made instead of a message with the words
                val link = if (chat.isNotes && pend.isEmpty()) MediaGrab.command(text) else null
                if (link != null) {
                    when {
                        link.isEmpty() -> app.say("Type /media and a link of YouTube, Instagram or X")
                        MediaGrab.site(link) == null -> app.say("Use a link of YouTube, Instagram or X")
                        else -> {
                            setText("")
                            app.say("Getting the video...")
                            app.scope.launch {
                                try {
                                    val (info, _) = MediaGrab.resolve(link)
                                    val m = LMsg(uid(), link, Clock.now(), emptyList()).also { it.mcard = MediaGrab.cleanCard(MediaGrab.card(link, info)) }
                                    chat.msgs.add(m); app.persist()
                                } catch (e: Exception) {
                                    app.say(if (e is MediaGrab.Fail) e.message ?: "Could not get it" else "Could not get it. Check your connection")
                                }
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
        m.mcard?.let { Box(Modifier.padding(top = if (m.imgs.isNotEmpty()) 4.dp else 0.dp)) { MediaCard(m) } }
        m.rpost?.let { Box(Modifier.padding(top = if (m.imgs.isNotEmpty()) 4.dp else 0.dp)) { RCard(it.id, it.u) } }
        m.zpost?.let { Box(Modifier.padding(top = 4.dp)) { ZCard(it) } }
        // the text of a "/media" message is only its link (it is what the web app shows), the card is drawn instead
        val url = if (m.mcard != null) null else firstUrl(m.text)
        if (url != null) Box(Modifier.padding(top = if (m.imgs.isNotEmpty() || m.rpost != null) 4.dp else 0.dp)) { LinkCard(url, chat = true) }
        if (m.text.isNotEmpty() && m.mcard == null) {
            val shape = if (left) RoundedCornerShape(Rad.bubble, Rad.bubble, Rad.bubble, Rad.xs) else RoundedCornerShape(Rad.bubble, Rad.bubble, Rad.xs, Rad.bubble)
            Box(
                Modifier.padding(top = if (m.imgs.isNotEmpty() || url != null || m.rpost != null) 4.dp else 0.dp).bubbleFx(fx, left).widthIn(max = w * 0.82f)
                    .clip(shape).background(if (left) c.bg2 else c.accent).then(if (left) Modifier.border(1.dp, c.line, shape) else Modifier).padding(horizontal = 14.dp, vertical = 9.dp),
            ) { Tx(m.text, color = if (left) c.fg else c.on, linkColor = if (left) null else Color.White, onTap = tap, onLong = onLong, cut = false) }
        }
        AnimatedVisibility(open, enter = expandVertically(tween(240)) + fadeIn(tween(200)), exit = shrinkVertically(tween(240)) + fadeOut(tween(200))) {
            T(whenText(m.t), Fs.xs, color = c.muted, align = if (left) TextAlign.Start else TextAlign.End, modifier = Modifier.fillMaxWidth().padding(top = 4.dp, end = 2.dp, start = 2.dp))
        }
    }
}
