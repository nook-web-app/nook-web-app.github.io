package io.github.nookwebapp.native_ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.FirstBaseline
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// the clock the screens read; the screenshot tests freeze it
object Clock { var now: () -> Long = System::currentTimeMillis }

// ago() of app.js: now, 5m, 3h, 2d, then the date
fun ago(t: Long): String {
    val m = (Clock.now() - t) / 60000
    if (m < 1) return "now"
    if (m < 60) return "${m}m"
    val h = m / 60
    if (h < 24) return "${h}h"
    val d = h / 24
    if (d < 30) return "${d}d"
    return monDay.get()!!.format(java.util.Date(t))
}
// one formatter per thread, built once instead of for every post older than 30 days
private val monDay = java.lang.ThreadLocal.withInitial { java.text.SimpleDateFormat("MMM d", java.util.Locale.getDefault()) }
private val whenFmt = java.lang.ThreadLocal.withInitial { java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.MEDIUM, java.text.DateFormat.SHORT) }
// toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
fun whenText(t: Long): String = whenFmt.get()!!.format(java.util.Date(t))

private val URL_RE = Regex("https?://[^\\s<>\"]+", RegexOption.IGNORE_CASE)
private val URL_TAIL = Regex("[.,!?)\\]]+$")
fun firstUrl(text: String) = URL_RE.find(text)?.value?.replace(URL_TAIL, "")

private val RICH_RE = Regex("(https?://\\S+|#[\\p{L}\\p{N}_]+)")
private val BOLD_RE = Regex("\\*\\*([^*\\n]+?)\\*\\*")
private val ITALIC_RE = Regex("\\*([^*\\s](?:[^*\\n]*[^*\\s])?)\\*")
private val LINK_TAIL = Regex("[.,!?)]+$")
private val SCHEME_RE = Regex("^https?://")
private val CUT_LINK_RE = Regex("https?://\\S*$")
private val NON_SPACE_RE = Regex("^\\S*")

// rich() of app.js: links (shortened to 34 characters), #tags that open the tag page, **bold** and *slanted* words
fun rich(text: String, accent: Color): AnnotatedString = buildAnnotatedString {
    val parts = RICH_RE.let { re ->
        val out = mutableListOf<Pair<String, Boolean>>(); var at = 0
        re.findAll(text).forEach { m -> out.add(text.substring(at, m.range.first) to false); out.add(m.value to true); at = m.range.last + 1 }
        out.add(text.substring(at) to false); out
    }
    parts.forEach { (part, special) ->
        if (!special) {
            // words between two pairs of stars are bold, one star on each side slants them
            var i = 0
            BOLD_RE.findAll(part).forEach { m ->
                italics(part.substring(i, m.range.first))
                withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(m.groupValues[1]) }
                i = m.range.last + 1
            }
            italics(part.substring(i))
            return@forEach
        }
        if (part.startsWith("#")) {
            pushStringAnnotation("tag", part); withStyle(SpanStyle(color = accent)) { append(part) }; pop()
            return@forEach
        }
        val raw = part.replace(LINK_TAIL, "")
        val tail = part.substring(raw.length)
        // the link is shown and opened without its tracking parameters, like cleanUrl in app.js
        val clean = cleanUrl(raw)
        val shown = clean.replace(SCHEME_RE, "")
        pushStringAnnotation("url", clean); withStyle(SpanStyle(color = accent)) { append(if (shown.length > 34) shown.take(33) + "…" else shown) }; pop()
        append(tail)
    }
}
private fun AnnotatedString.Builder.italics(s: String) {
    val re = ITALIC_RE
    var i = 0
    re.findAll(s).forEach { m -> append(s.substring(i, m.range.first)); withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(m.groupValues[1]) }; i = m.range.last + 1 }
    append(s.substring(i))
}

// cutText(): a long text is cut on whole characters and never in the middle of a link
fun cutText(text: String, n: Int): String {
    val cp = text.codePoints().toArray()
    if (cp.size <= n) return text
    val head = String(cp, 0, n)
    val m = CUT_LINK_RE.find(head)
    if (m != null && text.length > head.length && !text[head.length].isWhitespace()) {
        if (m.range.first > 0) return head.substring(0, m.range.first).trimEnd()
        return head + NON_SPACE_RE.find(text.substring(head.length))!!.value
    }
    return head
}

// .tx: the words of a post; taps on a link or a tag open it, a tap anywhere else falls through to the post
@Composable
fun Tx(text: String, big: Boolean = false, modifier: Modifier = Modifier, onTap: (() -> Unit)? = null, onLong: (() -> Unit)? = null, color: Color? = null, linkColor: Color? = null, cut: Boolean = true, edited: Boolean = false) {
    val app = LocalApp.current
    val c = LocalNook.current
    val uri = LocalUriHandler.current
    var full by remember(text) { mutableStateOf(!cut || text.length <= 700) }
    val shown = remember(text, full) { if (full) text else cutText(text, 600) + "…" }
    // a post whose words were changed ends with a small muted "Edited" right after its text
    val ann = remember(shown, c.accent, c.muted, linkColor, edited) {
        val base = rich(shown, linkColor ?: c.accent)
        if (!edited) base else androidx.compose.ui.text.buildAnnotatedString {
            append(base); append(" ")
            withStyle(androidx.compose.ui.text.SpanStyle(color = c.muted, fontSize = Fs.sm)) { append("Edited") }
        }
    }
    val size = if (big) Fs.x2 else Fs.base
    val lh = if (big) (20 * 1.35).sp else (15 * 1.38).sp
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    Column(modifier) {
        Text(
            ann, Modifier.pointerInput(ann) {
                detectTapGestures(onLongPress = { onLong?.invoke() }) { pos ->
                    val l = layout ?: return@detectTapGestures
                    val o = l.getOffsetForPosition(pos)
                    ann.getStringAnnotations("tag", o, o).firstOrNull()?.let { app.go(Route.Tag(it.item)); return@detectTapGestures }
                    ann.getStringAnnotations("url", o, o).firstOrNull()?.let { runCatching { uri.openUri(it.item) }; return@detectTapGestures }
                    onTap?.invoke()
                }
            },
            style = LocalTextStyle.current.copy(fontSize = size, lineHeight = lh, color = color ?: c.fg), onTextLayout = { layout = it },
        )
        if (!full) Box(Modifier.tap { full = true }.padding(vertical = 6.dp)) { T("Show more", color = c.lnk) }
    }
}

// .ab: one action of a post; the count sits 6dp after the icon
@Composable
private fun Ab(icon: String, n: Int, on: Boolean, onColor: Color, big: Boolean, fill: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val c = LocalNook.current
    val col = if (on) onColor else c.muted
    Row(
        modifier.defaultMinSize(minHeight = 38.dp).tap(RoundedCornerShape(Rad.pill), onClick = onClick).padding(horizontal = 8.dp).vpad(8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp, if (big) Alignment.CenterHorizontally else Alignment.Start),
    ) {
        NIcon(icon, if (big) 24.dp else 20.dp, col, fill && on)
        if (n > 0) T(n.toString(), Fs.sm, color = col, lineHeight = 16.sp)
    }
}

// .acts: reply, repost, like, save, share, more. The first three share the room (at most 84dp each) and the
// last three sit at the right, like margin-left:auto on the fourth does; in a thread they are spread out evenly.
// nc: inside an opened reply the list is flat and the numbers would only count down the chain, so the reply icon shows alone
@Composable
fun Acts(p: LPost, big: Boolean = false, nc: Boolean = false) {
    val app = LocalApp.current
    val c = LocalNook.current
    val n = remember(p.id, p.rp, nc, app.store.posts.size) { if (nc) 0 else maxOf(if (p.ra != null) p.rp else 0, app.store.replyTotal(p.id)) }
    val reply = { if (app.canPost()) app.panels.add(Panel.Compose(parent = p.id)) }
    val save = { app.toggleSave(p) }
    val items: List<@Composable (Modifier) -> Unit> = if (p.ra != null) listOf(
        { m -> Ab("reply", n, false, c.accent, big, false, m, reply) },
        { m -> Ab("repost", p.rpc, p.reposted, c.good, big, false, m) { app.on.toggleRepost(p) } },
        { m -> Ab("heart", p.lc, p.liked, c.like, big, true, m) { app.on.toggleLike(p) } },
        { m -> Ab("bookmark", p.svc, p.saved, c.accent, big, true, m, save) },
        { m -> Ab("share", p.shc, false, c.accent, big, false, m) { app.on.sharePost(p) } },
        { m -> Ab("dots", 0, false, c.accent, big, false, m) { otherSheet(app, p) } },
    ) else listOf(
        { m -> Ab("reply", n, false, c.accent, big, false, m, reply) },
        { m -> Ab("repost", if (p.ai) 0 else p.rpc, p.reposted, c.good, big, false, m) { app.toggleRepost(p) } },
        { m -> Ab("heart", if (p.ai) (if (p.zenLike) 1 else 0) else p.lc, p.liked, c.like, big, true, m) { app.toggleLike(p) } },
        { m -> Ab("bookmark", p.svc, p.saved, c.accent, big, true, m, save) },
        { m -> Ab("share", p.shc, false, c.accent, big, false, m) { app.on.sharePost(p) } },
        { m -> Ab("dots", 0, false, c.accent, big, false, m) { postSheet(app, p) } },
    )
    if (big) {
        // six equal slots: a count appearing or growing (a like) never moves the other buttons
        Row(Modifier.fillMaxWidth().padding(top = 4.dp).vpad(4.dp)) { items.forEach { it(Modifier.weight(1f)) } }
        return
    }
    // the row starts 8dp left of the text (margin-left:-8px), so it is 8dp wider than the column. Like flex, the last
    // three keep their own width (a count next to share or save never squeezes the dots), and the first three share
    // what is left, at most 84dp each
    androidx.compose.ui.layout.Layout(
        content = { items.forEach { it(Modifier) } },
        modifier = Modifier.fillMaxWidth().vpad(2.dp, 0.dp).probe("acts:" + p.id),
    ) { ms, cons ->
        val w = cons.maxWidth + 8.dp.roundToPx()
        val right = ms.drop(3).map { it.measure(androidx.compose.ui.unit.Constraints()) }
        val rw = right.sumOf { it.width }
        val share = ((w - rw) / 3).coerceIn(0, 84.dp.roundToPx())
        val left = ms.take(3).map { it.measure(androidx.compose.ui.unit.Constraints(minWidth = share)) }
        val h = (left + right).maxOf { it.height }
        layout(cons.maxWidth, h) {
            var x = -8.dp.roundToPx()
            left.forEach { it.place(x, (h - it.height) / 2); x += it.width }
            var rx = w - 8.dp.roundToPx() - rw
            right.forEach { it.place(rx, (h - it.height) / 2); rx += it.width }
        }
    }
}

// the more sheet of somebody else's post: copy, not interested, and report (the owner deletes Zenith's posts instead)
fun otherSheet(app: AppState, p: LPost) {
    app.open(listOfNotNull(
        if (p.text.isNotEmpty()) SheetItem("Copy post text", "copy") { app.clipboard(p.text) } else null,
        SheetItem("Not interested", "eyeoff", danger = true) { app.lessLikeThis(p) },
        if (app.on.zenithOfOwner(p)) SheetItem("Delete post", "trash", danger = true) { app.confirm("Delete this post of Zenith and its replies?", "Delete") { app.on.deleteZenithPost(p) } }
        else SheetItem("Report post", "flag", danger = true) { app.on.reportPost(p) },
    ), "More")
}

// .imgs: one photo at its own shape (at most min(460dp, 60% of the screen) tall), two side by side, three with the first
// one tall, four in a square grid, more in two columns of squares; 3dp gaps, a 1dp line and rounded corners
@Composable
fun ImgGrid(imgs: List<String>, cap: String? = null, framed: Boolean = true) {
    val app = LocalApp.current
    val c = LocalNook.current
    val shape = RoundedCornerShape(Rad.m)
    val maxH = minOf(460f, LocalConfiguration.current.screenHeightDp * 0.6f).dp
    val open = { i: Int -> app.viewer = Viewer(imgs, i, cap) }
    // .imgs.n1 img { height: auto }: one photo takes its own shape once it is in (and at once when it is known)
    var one by remember(imgs.firstOrNull()) { mutableStateOf(imgs.firstOrNull()?.let { Photos.size(it) }) }
    val cell = @Composable { i: Int, m: Modifier -> Pic(imgs[i], m.tap { open(i) }, onLoad = if (i == 0 && imgs.size == 1) ({ w, h -> if (one == null || one!!.first * h != one!!.second * w) one = w to h }) else null) }
    BoxWithConstraints(if (framed) Modifier.padding(top = 8.dp).fillMaxWidth().clip(shape).border(1.dp, c.line, shape).padding(1.dp) else Modifier.fillMaxWidth().clip(RoundedCornerShape(Rad.bubble))) {
        val w = maxWidth
        when {
            imgs.size == 1 -> {
                val d = one
                val h = minOf(if (d != null) w * (d.second.toFloat() / d.first) else w * 0.75f, maxH)
                cell(0, Modifier.fillMaxWidth().height(h))
            }
            imgs.size == 2 -> Row(Modifier.fillMaxWidth().aspectRatio(2f), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                cell(0, Modifier.weight(1f).fillMaxHeight()); cell(1, Modifier.weight(1f).fillMaxHeight())
            }
            imgs.size == 3 -> Row(Modifier.fillMaxWidth().aspectRatio(1.7f), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                cell(0, Modifier.weight(1f).fillMaxHeight())
                Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(3.dp)) { cell(1, Modifier.weight(1f).fillMaxWidth()); cell(2, Modifier.weight(1f).fillMaxWidth()) }
            }
            imgs.size == 4 -> Column(Modifier.fillMaxWidth().aspectRatio(1.7f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                for (r in 0..1) Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(3.dp)) { cell(r * 2, Modifier.weight(1f).fillMaxHeight()); cell(r * 2 + 1, Modifier.weight(1f).fillMaxHeight()) }
            }
            else -> Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                imgs.indices.chunked(2).forEach { pair -> Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) { pair.forEach { cell(it, Modifier.weight(1f).aspectRatio(1f)) }; if (pair.size == 1) Spacer(Modifier.weight(1f)) } }
            }
        }
    }
}

// a just written post slides down 10dp and fades in over .6s (.post.fresh)
@Composable
private fun Modifier.freshIn(on: Boolean): Modifier {
    if (!on) return this
    val a = remember { Animatable(0f) }
    LaunchedEffect(Unit) { a.animateTo(1f, tween(600, easing = androidx.compose.animation.core.LinearOutSlowInEasing)) }
    return this.graphicsLayer { alpha = a.value; translationY = (1 - a.value) * -10.dp.toPx() }
}

// .post: avatar, then name, handle and time on one baseline, the text, pictures and actions.
// lab: the small line above (reposted / pinned), rep/d: a reply indented by its depth, line: an earlier post of the
// thread joined to the next by a line under the avatar, compact: no actions
@Composable
fun PostCard(p: LPost, lab: String? = null, pin: Boolean = false, replyTo: Boolean = false, rep: Boolean = false, d: Int = 0, line: Boolean = false, compact: Boolean = false, nc: Boolean = false) {
    val app = LocalApp.current
    val c = LocalNook.current
    val isFresh = app.fresh == p.id
    LaunchedEffect(isFresh) { if (isFresh) { kotlinx.coroutines.delay(700); app.fresh = null } }
    val open = { app.go(Route.Thread(p.id)) }
    // only one's own posts open their sheet with a hold
    val hold: (() -> Unit)? = if (p.ra == null) ({ app.buzz(); postSheet(app, p) }) else null
    Row(
        Modifier.fillMaxWidth().freshIn(isFresh).probe("post:" + p.id).then(if (line) Modifier else Modifier.lineBelow(c.line))
            // .post.line .avc::after: a 2dp line from 4dp under the avatar down to the next post of the thread
            .then(if (!line) Modifier else Modifier.drawBehind {
                val x = (16 + (if (rep) 14 * minOf(d, 3) else 0) + 19).dp.toPx()
                drawRoundRect(c.line, Offset(x, 56.dp.toPx()), androidx.compose.ui.geometry.Size(2.dp.toPx(), size.height - 56.dp.toPx()), androidx.compose.ui.geometry.CornerRadius(1.dp.toPx()))
            })
            .padding(start = (if (rep) (14 * minOf(d, 3)) else 0).dp)
            .combinedTap(onClick = open, onLong = { hold?.invoke() })
            .padding(start = 16.dp, end = 16.dp).vpad(12.dp, 2.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        PostAv(p, 40.dp, Modifier.probe("av:" + p.id).then(when { p.ra != null -> Modifier.tap { app.go(Route.User(p.ra.id)) }; else -> Modifier }))
        Column(Modifier.weight(1f)) {
            if (lab != null || (pin && p.pinned)) Row(Modifier.padding(bottom = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                NIcon(if (lab != null) "repost" else "pin", 14.dp, c.muted); T(lab ?: "Pinned post", Fs.sm, color = c.muted)
            }
            PostHead(nameOf(app, p), handleOf(app, p), ago(p.t), p.id)
            if (replyTo && p.parent != null) Row(Modifier.padding(bottom = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                val par = app.store.byId(p.parent)
                NIcon("reply", 14.dp, c.muted); T("Replying to " + if (par == null) "a post" else handleOf(app, par), Fs.sm, color = c.muted)
            }
            val txt = remember(p.text, p.imgs) { cardless(p) }
            if (txt.isNotEmpty()) Tx(txt, modifier = Modifier.probe("text:" + p.id), onTap = open, onLong = hold, edited = p.edited)
            if (p.imgs.isNotEmpty()) ImgGrid(p.imgs) else remember(p.text) { firstUrl(p.text) }?.let { LinkCard(it) }
            if (!compact) Acts(p, nc = nc)
        }
    }
}

// .ph2: name (at most half the row), handle (cut when long) and time at the right, all on one baseline
@Composable
fun PostHead(name: String, handle: String, time: String, id: String) {
    val c = LocalNook.current
    androidx.compose.ui.layout.Layout(content = {
        if (name.isNotEmpty()) T(name, weight = FontWeight.Bold, maxLines = 1, modifier = Modifier.probe("name:$id")) else Box(Modifier)
        T(handle, color = c.muted, maxLines = 1)
        T(time, Fs.md, color = c.muted, modifier = Modifier.probe("time:$id"))
    }, Modifier.fillMaxWidth()) { ms, cons ->
        val gap = 5.dp.roundToPx()
        val w = cons.maxWidth
        val tm = ms[2].measure(androidx.compose.ui.unit.Constraints())
        val nm = ms[0].measure(androidx.compose.ui.unit.Constraints(maxWidth = w / 2))
        val hm = ms[1].measure(androidx.compose.ui.unit.Constraints(maxWidth = maxOf(0, w - nm.width - tm.width - gap * 2)))
        val base = maxOf(nm[FirstBaseline].takeIf { it > 0 } ?: 0, hm[FirstBaseline], tm[FirstBaseline])
        val top = { p: androidx.compose.ui.layout.Placeable -> base - p[FirstBaseline].coerceAtLeast(0) }
        val h = listOf(nm, hm, tm).maxOf { top(it) + it.height }
        layout(w, h) {
            val nx = if (nm.width > 0) nm.width + gap else 0
            nm.place(0, top(nm))
            hm.place(nx, top(hm)); tm.place(w - tm.width, top(tm))
        }
    }
}

// a tap opens, a hold of about half a second opens the post's sheet (longPress in app.js)
fun Modifier.combinedTap(onClick: () -> Unit, onLong: () -> Unit) = this.pointerInput(onClick, onLong) {
    detectTapGestures(onTap = { onClick() }, onLongPress = { onLong() })
}

// the big post at the top of a thread (mainPost)
@Composable
fun MainPost(p: LPost) {
    val app = LocalApp.current
    val c = LocalNook.current
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 12.dp)) {
        if (p.pinned) Row(Modifier.padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) { NIcon("pin", 14.dp, c.muted); T("Pinned post", Fs.sm, color = c.muted) }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            PostAv(p, 48.dp, when { p.ai -> Modifier.tap { app.go(Route.Zen) }; p.ra != null -> Modifier.tap { app.go(Route.User(p.ra.id)) }; else -> Modifier })
            Column { T(nameOf(app, p), weight = FontWeight.Bold); T(handleOf(app, p), color = c.muted) }
        }
        val txt = cardless(p)
        if (txt.isNotEmpty()) Tx(txt, big = true, modifier = Modifier.padding(top = 12.dp), edited = p.edited)
        if (p.imgs.isNotEmpty()) ImgGrid(p.imgs, whenText(p.t)) else firstUrl(p.text)?.let { LinkCard(it) }
        T(whenText(p.t), Fs.md, color = c.muted, modifier = Modifier.padding(top = 12.dp, bottom = 12.dp))
    }
    if (p.saved) Row(Modifier.padding(horizontal = 16.dp).padding(bottom = 12.dp)) { T("1", Fs.md, FontWeight.Bold); T(" save", Fs.md, color = c.muted) }
    Box(Modifier.padding(horizontal = 16.dp)) { Acts(p, big = true) }
    Box(Modifier.fillMaxWidth().padding(top = 6.dp)) { Line() }
}

// .cr: the "write a post" row at the top of the feed and of one's own profile
@Composable
fun ComposerRow() {
    val app = LocalApp.current
    val c = LocalNook.current
    Row(Modifier.fillMaxWidth().lineBelow(c.line).padding(horizontal = 16.dp).vpad(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        MyAvatar(40.dp)
        Box(Modifier.weight(1f).tap { if (app.canPost()) app.panels.add(Panel.Compose()) }.vpad(8.dp)) { T(app.ph, Fs.lg, color = c.muted, maxLines = 1) }
        IB("camera", box = 36.dp, height = 44.dp) { if (app.canPost()) app.panels.add(Panel.Compose(pick = "camera")) }
        IB("image", box = 36.dp, height = 44.dp) { if (app.canPost()) app.panels.add(Panel.Compose(pick = "image")) }
    }
}

// the more sheet of a post (postSheet in app.js)
fun postSheet(app: AppState, p: LPost) {
    val clip = app.clipboard
    app.open(listOfNotNull(
        if (p.text.isNotEmpty()) SheetItem("Copy post text", "copy") { clip(p.text) } else null,
        if (p.parent == null) SheetItem(if (p.pinned) "Unpin from profile" else "Pin to profile", "pin") { app.togglePin(p) } else null,
        SheetItem("Add to list", "list") { app.listSheet(p) },
        SheetItem("Edit post", "edit") { app.panels.add(Panel.Compose(edit = p.id)) },
        SheetItem("Delete post", "trash", danger = true) {
            val n = app.store.flat(p.id).size
            app.confirm(if (n > 0) "Delete this post and its $n " + (if (n == 1) "reply?" else "replies?") else "Delete this post?", "Delete") { app.deletePost(p) }
        },
    ))
}

// Share post (sharePost in Dm.kt): as a new post (a picture of it), to a person or into notes, or to another app
fun shareSheet(app: AppState, p: LPost) = app.on.sharePost(p)
