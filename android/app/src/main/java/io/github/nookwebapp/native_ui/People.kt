package io.github.nookwebapp.native_ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject
import kotlin.math.roundToInt

// The pictures and cards of other people's things: their round picture (rAv), Zenith's badge (zenAv), the link card
// under a post or in a chat (linkCard), and the cards of a shared post (rCard, zCard).

// rAv(): the person's picture, or the first letter of their name on a color that comes from the name
@Composable
fun RAv(name: String, handle: String, avatar: String?, size: Dp, id: String? = null, modifier: Modifier = Modifier) {
    val app = LocalApp.current
    val seed = name.ifEmpty { handle }.ifEmpty { "?" }
    val isZen = !Photos.ownMedia(avatar) && (handle.lowercase() == "zenith" || (id != null && id == app.on.zenId()))
    if (isZen) { ZenAv(size, modifier); return }
    Box(modifier.size(size).clip(CircleShape).background(hsl(hueOf(seed), .45f, .42f)), contentAlignment = Alignment.Center) {
        T(seed.trim().take(1).uppercase().ifEmpty { "?" }, size = (size.value * 0.4f).roundToInt().sp, weight = FontWeight.Bold, color = Color.White, lineHeight = (size.value * 0.5f).sp)
        if (Photos.ownMedia(avatar)) Pic(avatar, Modifier.matchParentSize(), want = 320)
    }
}

@Composable
fun AuthorAv(a: Author, size: Dp, modifier: Modifier = Modifier) = RAv(a.name, a.handle, a.avatar, size, a.id, modifier)

// zenAv(): his picture the owner chose, or his own blue Z
@Composable
fun ZenAv(size: Dp, modifier: Modifier = Modifier) {
    val app = LocalApp.current
    app.zenVersion
    val pfp = app.store.zen.optStr("pfp")
    Box(modifier.size(size).clip(CircleShape).background(Brush.linearGradient(listOf(Color(0xFF14466F), Color(0xFF208BFE)))), contentAlignment = Alignment.Center) {
        if (pfp != null) Pic(pfp, Modifier.matchParentSize(), want = 320)
        else T("Z", size = (size.value * 0.5f).roundToInt().sp, weight = FontWeight.Bold, color = Color.White, lineHeight = (size.value * 0.6f).sp)
    }
}

// the avatar of a post: Zenith, the author, or the owner
@Composable
fun PostAv(p: LPost, size: Dp, modifier: Modifier = Modifier) {
    when {
        p.ai -> ZenAv(size, modifier)
        p.ra != null -> AuthorAv(p.ra, size, modifier)
        else -> MyAvatar(size, modifier = modifier)
    }
}

fun nameOf(app: AppState, p: LPost) = if (p.ai) "Zenith" else p.ra?.name ?: app.store.profile.name
fun handleOf(app: AppState, p: LPost) = if (p.ai) "@zenith" else "@" + (p.ra?.handle ?: app.store.profile.handle)

// cardless(): a post that shows a link card does not also print the link
fun cardless(p: LPost): String {
    if (p.text.isEmpty() || p.imgs.isNotEmpty() || firstUrl(p.text) == null) return p.text
    return p.text.replaceFirst(Regex("https?://[^\\s<>\"]+", RegexOption.IGNORE_CASE), "").replace(Regex("[ \\t]{2,}"), " ").trim()
}

// .lc: the card of a link: its picture (placed on the main thing in it, outside chats), title, a line and the site
@Composable
fun LinkCard(url0: String, chat: Boolean = false) {
    val app = LocalApp.current
    val c = LocalNook.current
    val uri = LocalUriHandler.current
    val url = cleanUrl(url0)
    var d by remember(url) { mutableStateOf(app.store.previews[url]?.takeIf { it.has("v") }) }
    var loading by remember(url) { mutableStateOf(d == null) }
    LaunchedEffect(url) { if (d == null) { d = runCatching { app.on.getPreview(url) }.getOrNull(); loading = false } }
    val shape = RoundedCornerShape(if (chat) Rad.bubble else Rad.m)
    val host = hostOf(url)
    Column(
        (if (chat) Modifier.fillMaxWidth(0.82f).widthIn(max = 320.dp) else Modifier.fillMaxWidth().padding(top = 8.dp)).clip(shape).background(c.bg2)
            .then(if (chat) Modifier else Modifier.border(1.dp, c.line, shape)).tap { runCatching { uri.openUri(url) } },
    ) {
        val dd = d
        if (loading && dd == null) { Box(Modifier.fillMaxWidth().height(150.dp).background(c.bg2)); return@Column }
        val (title, cap) = cardText(dd, url)
        val img = dd?.optString("i")?.ifEmpty { null }
        if (img != null) {
            var focus by remember(url) { mutableStateOf<Pair<Float, Float>?>(null) }
            LaunchedEffect(img) { if (!chat) focus = runCatching { app.on.getFocus(url, img) }.getOrNull() }
            Box(Modifier.fillMaxWidth().aspectRatio(if (chat) 1f else 4f / 3f).background(c.bg2)) {
                LinkPic(img, focus)
            }
        }
        Column(Modifier.padding(start = if (chat) 16.dp else 12.dp, end = if (chat) 16.dp else 12.dp, top = if (chat) 14.dp else 8.dp, bottom = if (chat) 14.dp else 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            T(title.ifEmpty { host }, weight = FontWeight.SemiBold, maxLines = 2)
            if (cap.isNotEmpty()) T(cap, Fs.sm, color = c.muted, maxLines = 2)
            T(host, Fs.xs, color = c.muted)
        }
    }
}

// the picture of a link card comes from the linked site itself (not this app's storage), so it is loaded on its own
@Composable
private fun LinkPic(src: String, focus: Pair<Float, Float>?) {
    var bm by remember(src) { mutableStateOf<androidx.compose.ui.graphics.ImageBitmap?>(null) }
    LaunchedEffect(src) {
        bm = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            runCatching {
                Sb.http.newCall(okhttp3.Request.Builder().url(src).header("Referer", "").build()).execute().use { r ->
                    if (!r.isSuccessful) null else r.body?.bytes()?.takeIf { it.size < 8 shl 20 }?.let { Photos.decodeUpright(it, 1024)?.asImageBitmap() }
                }
            }.getOrNull()
        }
    }
    val b = bm ?: return
    val align = focus?.let { (x, y) -> androidx.compose.ui.BiasAlignment((x / 50f - 1f).coerceIn(-1f, 1f), (y / 50f - 1f).coerceIn(-1f, 1f)) } ?: Alignment.Center
    androidx.compose.foundation.Image(b, null, Modifier.fillMaxSize(), alignment = align, contentScale = androidx.compose.ui.layout.ContentScale.Crop)
}

// .zcard: a post shared into a chat, as a card: only that post, no profile and no replies behind it
@Composable
fun RCard(id: String, hint: String?, big: Boolean = false) {
    val app = LocalApp.current
    val c = LocalNook.current
    val scope = rememberCoroutineScope()
    var d by remember(id) { mutableStateOf<JSONObject?>(null) }
    var state by remember(id) { mutableStateOf(if (app.dm.rp.containsKey(id)) (if (app.dm.rp[id] == null) "gone" else "ok") else "load") }
    LaunchedEffect(id) {
        if (app.dm.rp.containsKey(id)) d = app.dm.rp[id]
        else try { d = app.on.loadRPost(id, hint); state = if (d == null) "gone" else "ok" } catch (e: Exception) { state = "fail" }
        if (d != null) state = "ok"
    }
    CardBox(big, onClick = if (big) null else ({ scope.launch { try { app.on.openSharedPost(id) } catch (e: Exception) { app.say("Could not open that post. Check your connection") } } })) {
        val x = d
        when {
            state == "load" -> T("Loading post", color = c.muted)
            state == "fail" -> T("Could not load this post", color = c.muted)
            x == null -> T("This post is not available", color = c.muted)
            else -> {
                Row(Modifier.padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    RAv(x.optString("name"), x.optString("handle"), x.optStr("avatar"), if (big) 44.dp else 34.dp)
                    Column { T(x.optString("name"), weight = FontWeight.Bold, maxLines = 1); T("@" + x.optString("handle"), Fs.xs, color = c.muted, maxLines = 1) }
                }
                if (x.optString("text").isNotEmpty()) Tx(x.optString("text"))
                val imgs = x.optJSONArray("imgs").strings()
                val shown = if (big) imgs else imgs.take(1)
                if (shown.isNotEmpty()) Box(Modifier.padding(top = 8.dp)) {
                    ImgGrid(shown, framed = false)
                    if (!big && imgs.size > 1) Box(Modifier.align(Alignment.BottomEnd).padding(8.dp).clip(RoundedCornerShape(Rad.pill)).background(Color(0x99000000)).padding(horizontal = 8.dp, vertical = 2.dp)) { T("+" + (imgs.size - 1), Fs.sm, FontWeight.Bold, Color.White) }
                }
                T(whenText(x.optLong("t")), Fs.xs, color = c.muted, modifier = Modifier.padding(top = 8.dp))
            }
        }
    }
}

// a post of Zenith shared into a chat (his posts on the owner's phone are not on the server)
@Composable
fun ZCard(z: ZPost, big: Boolean = false) {
    val app = LocalApp.current
    val c = LocalNook.current
    CardBox(big, onClick = if (big) null else ({ app.zcard = z })) {
        Row(Modifier.padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (z.a != null) Box(Modifier.size(if (big) 44.dp else 34.dp).clip(CircleShape)) { Pic(z.a, Modifier.matchParentSize(), want = 200) } else ZenAv(if (big) 44.dp else 34.dp)
            Column { T("Zenith", weight = FontWeight.Bold); T("@zenith", Fs.xs, color = c.muted) }
        }
        Tx(z.x)
        T(whenText(z.t), Fs.xs, color = c.muted, modifier = Modifier.padding(top = 8.dp))
    }
}

@Composable
private fun CardBox(big: Boolean, onClick: (() -> Unit)?, content: @Composable ColumnScope.() -> Unit) {
    val c = LocalNook.current
    val shape = RoundedCornerShape(Rad.m)
    Column((if (big) Modifier.fillMaxWidth() else Modifier.fillMaxWidth(0.82f).widthIn(max = 320.dp)).clip(shape).border(1.dp, c.line, shape).background(c.bg2)
        .then(if (onClick != null) Modifier.tap(onClick = onClick) else Modifier).padding(horizontal = 14.dp, vertical = 12.dp), content = content)
}

